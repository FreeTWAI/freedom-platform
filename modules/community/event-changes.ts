import type {PoolClient} from 'pg';
import {Problem} from '../../packages/shared/problem.js';
import type {Actor} from '../identity-membership/service.js';
import {eventNoticeAccessSql} from '../member-communications/notifications.js';
import {canReadEventParticipationDetails,readEvent} from './events.js';

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
 const details=eventChangeBody(event,true),summary=eventChangeBody(event,false);
 const access=eventNoticeAccessSql.replaceAll('$2','r.user_id');
 // One snapshot applies the same current event audience before updating or
 // inserting any recipient's notification. Keep only the newest legacy unread.
 await q.query(`WITH members AS (
   SELECT user_id FROM community_event_rsvps WHERE event_id=$2::uuid AND state='going'
   UNION SELECT member_ref FROM community_event_waitlist WHERE event_id=$2::uuid AND member_ref IS NOT NULL
     AND status IN ('queued','invited','cancelled') AND $3<>'event_announcement'
  ), eligible AS (
   SELECT r.user_id,CASE WHEN $3<>'event_schedule_changed' THEN $8
    WHEN e.organizer_ref=r.user_id OR (e.state<>'cancelled' AND (
      EXISTS(SELECT 1 FROM community_event_rsvps attending WHERE attending.event_id=e.event_id AND attending.user_id=r.user_id AND attending.state='going')
      OR (e.state='pending' AND e.review_guild_key IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM shares held WHERE held.community_id=e.community_id AND held.kind='event' AND held.ref_id=e.event_id AND held.state='hidden')
        AND EXISTS(SELECT 1 FROM positioning_guild_officers o JOIN positioning_profession_memberships m
          ON m.community_id=o.community_id AND m.guild_key=o.guild_key AND m.user_id=o.user_id AND m.state='active'
          WHERE o.community_id=e.community_id AND o.guild_key=e.review_guild_key AND o.user_id=r.user_id))
    )) THEN $6 ELSE $7 END AS body
   FROM members r JOIN users u ON u.user_id=r.user_id AND u.community_id=$1
   JOIN community_events e ON e.event_id=$2::uuid
   CROSS JOIN LATERAL (SELECT $3::text AS kind,$2::uuid::text AS action_resource_id) n
   WHERE ${access}
  ), unread AS (
   SELECT n.notification_id,r.user_id,r.body,row_number() OVER(PARTITION BY r.user_id ORDER BY n.created_at DESC,n.notification_id DESC) AS rank
   FROM eligible r JOIN member_notifications n ON n.community_id=$1 AND n.recipient_ref=r.user_id
    AND n.action_tab='events' AND n.action_resource_id=$2::uuid::text AND n.kind='event_schedule_changed' AND n.read_at IS NULL
   WHERE $3='event_schedule_changed'
  ), updated AS (
   UPDATE member_notifications n SET body=unread.body,title=$5,read_at=CASE WHEN unread.rank=1 THEN NULL ELSE clock_timestamp() END
   FROM unread WHERE n.notification_id=unread.notification_id RETURNING n.recipient_ref
  ) INSERT INTO member_notifications(community_id,recipient_ref,kind,source_key,title,body,action_tab,action_resource_id)
   SELECT $1,r.user_id,$3,$4,$5,r.body,'events',$2::uuid::text FROM eligible r
   WHERE $3<>'event_schedule_changed' OR NOT EXISTS(SELECT 1 FROM updated WHERE recipient_ref=r.user_id)
   ON CONFLICT(community_id,recipient_ref,source_key) DO NOTHING`,
  [event.community_id,event.event_id,kind,`event/${event.event_id}/${kind}/${event.aggregate_version}`,title,details,summary,commonBody]);

 // Guest capabilities are rechecked against the same legal participation rules
 // as resolveGuestParticipationByEmail. No mail is sent by this transaction.
 await q.query(`WITH guests AS (
   SELECT c.email,CASE WHEN $3<>'event_schedule_changed' THEN $4
     WHEN e.state='published' AND g.state='going' AND (g.email_sent_at IS NOT NULL OR g.confirmed_at IS NOT NULL) THEN $5 ELSE $6 END AS body
   FROM community_event_guest_capabilities c JOIN community_events e ON e.event_id=c.event_id
   LEFT JOIN community_event_guest_rsvps g ON g.event_id=c.event_id AND g.email=c.email
   WHERE c.event_id=$1 AND c.verified_at IS NOT NULL
     AND (g.state='going' OR ($3<>'event_announcement' AND EXISTS(SELECT 1 FROM community_event_waitlist w
       WHERE w.event_id=c.event_id AND w.guest_email=c.email AND w.status IN ('queued','invited','cancelled'))))
     AND ($3<>'event_schedule_changed' OR (e.visibility IN ('open','referral') AND NOT is_verification_test_account(e.organizer_ref)
       AND (e.state='published' OR (e.state='cancelled' AND (g.confirmed_at IS NOT NULL OR g.email_sent_at IS NOT NULL
         OR EXISTS(SELECT 1 FROM community_event_waitlist w WHERE w.event_id=c.event_id AND w.guest_email=c.email))))
       AND (e.state<>'published' OR e.visibility<>'referral' OR EXISTS(SELECT 1 FROM community_event_share_codes code
         WHERE code.event_id=e.event_id AND code.code=c.referral_code AND e.state='published'))))
  ), skipped AS (
   UPDATE community_event_participation_notices n SET status='skipped' FROM guests g
   WHERE $3='event_schedule_changed' AND n.event_id=$1 AND n.guest_email=g.email AND n.kind='event_schedule_changed'
     AND n.event_version<$2 AND n.status IN ('pending','unknown') RETURNING n.notice_id
  ) INSERT INTO community_event_participation_notices(notice_id,event_id,guest_email,event_version,kind,body)
   SELECT gen_random_uuid(),$1,email,$2,$3,body FROM guests ON CONFLICT(event_id,guest_email,event_version,kind) DO NOTHING`,
  [event.event_id,event.aggregate_version,kind,commonBody,details,summary]);
}

/** Media lifecycles already hold the event lock and increment its version. */
export async function recordEventMediaChange(q:PoolClient,id:string,field:string){
 const row=(await q.query('SELECT * FROM community_events WHERE event_id=$1',[id])).rows[0];
 if(row?.state==='published')await recordEventChange(q,{},row,[field]);
}
