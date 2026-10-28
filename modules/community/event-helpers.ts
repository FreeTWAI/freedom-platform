import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {z} from 'zod';
import {checkVersion,command,journal,type Command} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {requireCondition} from '../../packages/shared/problem.js';
import type {Actor} from '../identity-membership/service.js';
import {avatarUrl} from '../identity-membership/avatars.js';
import {lockMemberGuilds} from '../positioning/onboarding.js';
import {canAccessGuildEvent,refuseInternGuildExchange} from './events.js';
import {nextEventHelperState,type EventHelperState} from './event-helper-state.js';

const ownInput=z.discriminatedUnion('action',[
  z.object({action:z.literal('offer'),referral_code:z.string().regex(/^[A-Za-z0-9_-]{16,32}$/).nullable().optional()}).strict(),
  z.object({action:z.literal('withdraw')}).strict(),
]);
const decisionInput=z.object({decision:z.enum(['accept','decline'])}).strict();
const pageInput=z.object({limit:z.coerce.number().int().min(1).max(50).default(20),offset:z.coerce.number().int().min(0).default(0)}).strict();
type EventRow={event_id:string;community_id:string;organizer_ref:string;state:string;starts_at:Date;visibility:string;guild_key:string|null;event_kind:string;help_need:string|null};
type HelperRow={helper_id:string;member_ref:string;state:EventHelperState;aggregate_version:string;created_at:Date;updated_at:Date};
export type EventHelperStatus={state:EventHelperState|null;version:number;event_closed:boolean};
export type EventHelperListItem={user_id:string;nickname:string;avatar_url:string|null;state:EventHelperState;version:number;created_at:string;updated_at:string};
export type EventHelperPage={items:EventHelperListItem[];total:number;next_offset:number|null;event_closed:boolean};

async function scopedHelperEvent(q:PoolClient,actor:Actor,id:string,lock=false):Promise<EventRow>{
  // GET projections do not serialize with event or guild writers. Commands keep
  // the existing guild-before-event lock order and recheck before effects.
  if(lock)await lockMemberGuilds(q,actor);
  const user=(await q.query('SELECT onboarding_required,onboarding_completed_at FROM users WHERE user_id=$1 AND community_id=$2',[actor.user_id,actor.community_id])).rows[0];
  requireCondition(user&&(!user.onboarding_required||user.onboarding_completed_at),403,'onboarding_required','請先完成會員入門。');
  const row=(await q.query(`SELECT event_id,community_id,organizer_ref,state,starts_at,visibility,guild_key,event_kind,help_need FROM community_events WHERE event_id=$1 AND community_id=$2${lock?' FOR UPDATE':''}`,[id,actor.community_id])).rows[0];
  requireCondition(row,404,'not_found','找不到這場活動。');return row;
}
async function eventLock(q:PoolClient,actor:Actor,id:string):Promise<EventRow>{
  return scopedHelperEvent(q,actor,id,true);
}
async function own(q:PoolClient,id:string,memberId:string):Promise<HelperRow|undefined>{
  return (await q.query('SELECT helper_id,member_ref,state,aggregate_version,created_at,updated_at FROM community_event_helpers WHERE event_id=$1 AND member_ref=$2',[id,memberId])).rows[0];
}
async function visible(q:PoolClient,actor:Actor,event:EventRow,history:boolean){
  const hidden=event.organizer_ref!==actor.user_id&&(await q.query('SELECT is_verification_test_account($1) AS hidden',[event.organizer_ref])).rows[0].hidden;
  requireCondition(!hidden&&await canAccessGuildEvent(q,actor,event)&&(event.state==='published'||event.organizer_ref===actor.user_id||history),404,'not_found','找不到這場活動。');
}
async function closed(q:PoolClient,event:EventRow){
  const clock=(await q.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
  return event.state!=='published'||event.starts_at.getTime()<=clock.getTime();
}
async function requireOpen(q:PoolClient,event:EventRow){
  requireCondition(!await closed(q,event),409,'event_closed','活動已開始或關閉，不能新增或決定幫手申請。');
  requireCondition(event.help_need!==null,409,'helper_unavailable','這場活動沒有開放找幫手。');
}
async function status(q:PoolClient,event:EventRow,row?:HelperRow):Promise<EventHelperStatus>{
  return {state:row?.state??null,version:Number(row?.aggregate_version??1),event_closed:await closed(q,event)};
}
async function organizer(q:PoolClient,actor:Actor,event:EventRow){
  requireCondition(event.organizer_ref===actor.user_id,403,'organizer_required','只有主辦者能管理幫手申請。');
}
export async function readEventHelper(pool:Pool,rawActor:Actor,id:string):Promise<EventHelperStatus>{
  const actor={...rawActor};
  return readWithMemberSession(pool,actor,async q=>{
    const event=await scopedHelperEvent(q,actor,id),row=await own(q,id,actor.user_id);
    // A retained personal application remains readable/withdrawable after loss
    // of guild visibility; this projection reveals no event or peer details.
    if(!row)await visible(q,actor,event,false);
    return status(q,event,row);
  });
}
export async function listEventHelpers(pool:Pool,rawActor:Actor,id:string,raw:unknown):Promise<EventHelperPage>{
  const actor={...rawActor},{limit,offset}=pageInput.parse(raw);
  return readWithMemberSession(pool,actor,async q=>{
    const event=await scopedHelperEvent(q,actor,id);await organizer(q,actor,event);
    const rows=(await q.query(`SELECT h.member_ref,h.state,h.aggregate_version,h.created_at,h.updated_at,u.display_name,
      a.present AS avatar_present,a.aggregate_version AS avatar_version
      FROM community_event_helpers h JOIN users u ON u.user_id=h.member_ref AND u.community_id=$2
      LEFT JOIN member_avatar_presence a ON a.user_id=h.member_ref AND a.community_id=$2
      WHERE h.event_id=$1 AND NOT is_verification_test_account(h.member_ref)
      ORDER BY h.created_at,h.member_ref LIMIT $3 OFFSET $4`,[id,actor.community_id,limit+1,offset])).rows;
    const total=Number((await q.query(`SELECT count(*) AS total FROM community_event_helpers h JOIN users u ON u.user_id=h.member_ref AND u.community_id=$2
      WHERE h.event_id=$1 AND NOT is_verification_test_account(h.member_ref)`,[id,actor.community_id])).rows[0].total);
    const items=rows.slice(0,limit).map((r):EventHelperListItem=>({user_id:r.member_ref,nickname:r.display_name,
      avatar_url:r.avatar_present?avatarUrl(r.member_ref,r.avatar_version??'1',true):null,state:r.state,version:Number(r.aggregate_version),
      created_at:r.created_at.toISOString(),updated_at:r.updated_at.toISOString()}));
    return {items,total,next_offset:rows.length>limit?offset+limit:null,event_closed:await closed(q,event)};
  });
}
export async function mutateEventHelper(pool:Pool,rawInput:Command,id:string):Promise<EventHelperStatus>{
  const body=ownInput.parse(rawInput.body),input={...rawInput,actor:{...rawInput.actor},body};
  requireCondition(input.expected,428,'version_required','請重新讀取幫手申請版本。');
  let event:EventRow,newEffect=false;
  return command(pool,input,async q=>{
    event=await eventLock(q,input.actor,id);
    const mine=await own(q,id,input.actor.user_id);
    if(body.action==='withdraw')requireCondition(mine,404,'not_found','找不到你的幫手申請。');
    else {
      await visible(q,input.actor,event,Boolean(mine));
      requireCondition(event.organizer_ref!==input.actor.user_id,409,'helper_self_organizer','主辦者不需要申請自己的幫手。');
    }
  },async q=>{
    const mine=await own(q,id,input.actor.user_id);checkVersion(mine?.aggregate_version??'1',input.expected);
    if(body.action==='offer'){
      await requireOpen(q,event);newEffect=true;
      if(event.visibility==='referral'){
        requireCondition(body.referral_code,422,'share_code_required','請從會員分享的活動連結申請幫手。');
        requireCondition((await q.query('SELECT 1 FROM community_event_share_codes WHERE event_id=$1 AND code=$2',[id,body.referral_code])).rowCount===1,422,'invalid_event_share_code','活動分享連結已無效。');
      }
    }
    requireCondition(!mine||Number(mine.aggregate_version)<Number.MAX_SAFE_INTEGER,409,'helper_version_exhausted','這份幫手申請暫時無法變更，請聯絡主辦者。');
    const next=nextEventHelperState(mine?.state??null,body.action);
    const row=(await q.query(`INSERT INTO community_event_helpers(helper_id,event_id,member_ref,state,aggregate_version)
      VALUES($1,$2,$3,$4,2) ON CONFLICT(event_id,member_ref) DO UPDATE SET state=EXCLUDED.state,
      aggregate_version=community_event_helpers.aggregate_version+1,updated_at=clock_timestamp() RETURNING *`,[mine?.helper_id??randomUUID(),id,input.actor.user_id,next])).rows[0] as HelperRow;
    await journal(q,input.actor,'community_event_helper',row.helper_id,row.aggregate_version,body.action,{event_id:id});
    return status(q,event,row);
  },async q=>{if(newEffect)await requireOpen(q,event);});
}
export async function decideEventHelper(pool:Pool,rawInput:Command,id:string,memberId:string):Promise<EventHelperStatus>{
  const body=decisionInput.parse(rawInput.body),input={...rawInput,actor:{...rawInput.actor},body};
  requireCondition(input.expected,428,'version_required','請重新讀取幫手申請版本。');
  let event:EventRow,newEffect=false;
  return command(pool,input,async q=>{
    // Take the applicant user share and BOTH guild advisories before the event.
    // Own offers already hold their user/guild before waiting for that event;
    // taking the applicant guild after it would invert that order. User shares
    // are compatible with other member requests; no applicant session is used.
    const applicant=(await q.query('SELECT active,onboarding_required,onboarding_completed_at,is_verification_test_account(user_id) AS hidden FROM users WHERE user_id=$1 AND community_id=$2 FOR SHARE',[memberId,input.actor.community_id])).rows[0];
    for(const user_id of [...new Set([input.actor.user_id,memberId])].sort())await lockMemberGuilds(q,{community_id:input.actor.community_id,user_id});
    event=await eventLock(q,input.actor,id);await organizer(q,input.actor,event);await refuseInternGuildExchange(q,input.actor,event);
    requireCondition(applicant&&!applicant.hidden&&await own(q,id,memberId),404,'not_found','找不到這份幫手申請。');
    if(body.decision==='accept'){
      requireCondition(applicant?.active&&(!applicant.onboarding_required||applicant.onboarding_completed_at),409,'helper_member_unavailable','這位會員目前無法擔任幫手。');
      requireCondition(await canAccessGuildEvent(q,{...input.actor,user_id:memberId},event),409,'helper_member_unavailable','這位會員已不符合活動參與範圍。');
    }
  },async q=>{
    const mine=(await own(q,id,memberId))!;checkVersion(mine.aggregate_version,input.expected);await requireOpen(q,event);newEffect=true;
    requireCondition(Number(mine.aggregate_version)<Number.MAX_SAFE_INTEGER,409,'helper_version_exhausted','這份幫手申請暫時無法變更。');
    const next=nextEventHelperState(mine.state,body.decision);
    const row=(await q.query(`UPDATE community_event_helpers SET state=$3,aggregate_version=aggregate_version+1,updated_at=clock_timestamp()
      WHERE event_id=$1 AND member_ref=$2 RETURNING *`,[id,memberId,next])).rows[0] as HelperRow;
    await journal(q,input.actor,'community_event_helper',row.helper_id,row.aggregate_version,body.decision,{event_id:id});
    return status(q,event,row);
  },async q=>{if(newEffect)await requireOpen(q,event);});
}
