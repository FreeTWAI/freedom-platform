import type {PoolClient} from 'pg';
import {Problem} from '../../packages/shared/problem.js';
import type {Actor} from '../identity-membership/service.js';
import {notifyMember} from '../member-communications/notifications.js';
import {canReadEventParticipationDetails,readEvent} from './events.js';
import {resolveGuestParticipationByEmail} from './event-waitlist.js';

type EventRow={event_id:string;community_id:string;aggregate_version:number;title:string;starts_at:Date|string;ends_at:Date|string;location:string|null;online_url:string|null};
export type EventNoticeKind='event_schedule_changed'|'event_cancelled'|'event_announcement';
const fields=['title','description','topic','mode','location','online_url','help_need','prize_details','starts_at','ends_at','capacity','source_cover_url'] as const;
const changeSummary='活動時間或地點有更新，請到活動頁查看。';
const minute=(value:Date|string)=>Math.floor(new Date(value).getTime()/60000);
const location=(value:string)=>value.trim().replace(/\s+/gu,' ');

export function eventChangeBody(event:EventRow,details:boolean):string {
 if(!details)return `「${event.title}」\n${changeSummary}`;
 const time=(value:Date|string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short',hour12:false}).format(new Date(value));
 return `「${event.title}」\n時間：${time(event.starts_at)} ～ ${time(event.ends_at)}（台北）\n地點：${event.location??''}${event.online_url?`\n線上：${event.online_url}`:''}`;
}

/** Re-read the same event projection used by the page, including access revocation. */
export async function memberEventChangeBody(q:Pick<PoolClient,'query'>,actor:Actor,id:string):Promise<string>{
 try{
  const event=await readEvent(q as PoolClient,actor,id);
  return eventChangeBody(event,canReadEventParticipationDetails(event,event.my_rsvp==='going',event.organizer_ref===actor.user_id,event.can_review));
 }catch(error){
  if(error instanceof Problem&&error.status===404)return changeSummary;
  throw error;
 }
}

export async function recordEventChange(q:PoolClient,before:Record<string,any>,after:Record<string,any>,explicit?:string[]){
 const changed=explicit??fields.filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
 if(!changed.length)return;
 await q.query('INSERT INTO community_event_changes(event_id,event_version,changed_fields) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[after.event_id,after.aggregate_version,changed]);
 const material=changed.some(key=>{
  if(key==='starts_at'||key==='ends_at')return minute(before[key])!==minute(after[key]);
  if(key==='location')return location(before[key])!==location(after[key]);
  return key==='online_url'||key==='mode';
 });
 if(material)await notifyEventRegistrants(q,after as EventRow,'event_schedule_changed');
}

/** Callers hold the event lock: edits, coalescing and delivery share that ordering. */
export async function notifyEventRegistrants(q:PoolClient,event:EventRow,kind:EventNoticeKind,announcement?:string){
 const title=kind==='event_cancelled'?'活動已取消':kind==='event_announcement'?'主辦者通知':'活動已更新';
 const commonBody=announcement??`「${event.title}」已取消。`;
 const members=(await q.query("SELECT user_id FROM community_event_rsvps WHERE event_id=$1 AND state='going' UNION SELECT member_ref FROM community_event_waitlist WHERE event_id=$1 AND member_ref IS NOT NULL AND status IN ('queued','invited','cancelled') AND $2<>'event_announcement'",[event.event_id,kind])).rows;
 for(const member of members){
  const body=kind==='event_schedule_changed'?await memberEventChangeBody(q,{user_id:member.user_id,community_id:event.community_id} as Actor,event.event_id):commonBody;
  if(kind==='event_schedule_changed'){
   const updated=await q.query(`UPDATE member_notifications SET body=$3,title=$4 WHERE community_id=$5 AND recipient_ref=$1 AND action_tab='events' AND action_resource_id=$2 AND kind='event_schedule_changed' AND read_at IS NULL`,[member.user_id,event.event_id,body,title,event.community_id]);
   if(updated.rowCount)continue;
  }
  await notifyMember(q,{community_id:event.community_id,recipient_ref:member.user_id,kind,source_key:`event/${event.event_id}/${kind}/${event.aggregate_version}`,title,body,action:{tab:'events',resource_id:event.event_id}});
 }
 const guests=(await q.query(`SELECT email FROM community_event_guest_capabilities c WHERE event_id=$1 AND verified_at IS NOT NULL
 AND (EXISTS(SELECT 1 FROM community_event_guest_rsvps g WHERE g.event_id=c.event_id AND g.email=c.email AND g.state='going')
 OR ($2<>'event_announcement' AND EXISTS(SELECT 1 FROM community_event_waitlist w WHERE w.event_id=c.event_id AND w.guest_email=c.email AND w.status IN ('queued','invited','cancelled'))))`,[event.event_id,kind])).rows;
 for(const guest of guests){
  let body=commonBody;
  if(kind==='event_schedule_changed'){
   const source=await resolveGuestParticipationByEmail(q,event.event_id,guest.email).catch(error=>{if(error instanceof Problem&&error.status===404)return null;throw error;});
   if(!source)continue;
   body=eventChangeBody(source.event,source.going);
   // Keep superseded versions as skipped delivery records, separate from the edit audit.
   await q.query(`UPDATE community_event_participation_notices SET status='skipped' WHERE event_id=$1 AND guest_email=$2 AND kind='event_schedule_changed' AND event_version<$3 AND status IN ('pending','unknown')`,[event.event_id,guest.email,event.aggregate_version]);
  }
  await q.query(`INSERT INTO community_event_participation_notices(notice_id,event_id,guest_email,event_version,kind,body)
   VALUES(gen_random_uuid(),$1,$2,$3,$4,$5) ON CONFLICT(event_id,guest_email,event_version,kind) DO NOTHING`,[event.event_id,guest.email,event.aggregate_version,kind,body]);
 }
}

/** Media lifecycles already hold the event lock and increment its version. */
export async function recordEventMediaChange(q:PoolClient,id:string,field:string){
 const row=(await q.query('SELECT * FROM community_events WHERE event_id=$1',[id])).rows[0];
 if(row?.state==='published')await recordEventChange(q,{},row,[field]);
}
