import type {PoolClient} from 'pg';
import {notifyMember} from '../member-communications/notifications.js';

type EventRow={event_id:string;community_id:string;aggregate_version:number;title:string;starts_at:Date|string;ends_at:Date|string;location:string;online_url:string|null};
export type EventNoticeKind='event_schedule_changed'|'event_cancelled'|'event_announcement';
const fields=['title','description','topic','location','online_url','help_need','prize_details','starts_at','ends_at','capacity','source_cover_url'] as const;
export async function recordEventChange(q:PoolClient,before:Record<string,any>,after:Record<string,any>,explicit?:string[]){
 const changed=explicit??fields.filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
 if(!changed.length)return;
 await q.query('INSERT INTO community_event_changes(event_id,event_version,changed_fields) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[after.event_id,after.aggregate_version,changed]);
 if(changed.some(key=>['starts_at','ends_at','location','online_url'].includes(key)))await notifyEventRegistrants(q,after as EventRow,'event_schedule_changed');
}
export async function notifyEventRegistrants(q:PoolClient,event:EventRow,kind:EventNoticeKind,announcement?:string){
 const time=(value:Date|string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short',hour12:false}).format(new Date(value));
 const title=kind==='event_cancelled'?'活動已取消':kind==='event_announcement'?'主辦者通知':'活動已更新';
 const body=announcement??(kind==='event_cancelled'?`「${event.title}」已取消。`:`「${event.title}」\n時間：${time(event.starts_at)} ～ ${time(event.ends_at)}（台北）\n地點：${event.location}${event.online_url?`\n線上：${event.online_url}`:''}`);
 const members=(await q.query("SELECT user_id FROM community_event_rsvps WHERE event_id=$1 AND state='going' UNION SELECT member_ref FROM community_event_waitlist WHERE event_id=$1 AND member_ref IS NOT NULL AND status IN ('queued','invited','cancelled') AND $2<>'event_announcement'",[event.event_id,kind])).rows;
 for(const member of members)await notifyMember(q,{community_id:event.community_id,recipient_ref:member.user_id,kind,source_key:`event/${event.event_id}/${kind}/${event.aggregate_version}`,title,body,action:{tab:'events',resource_id:event.event_id}});
 await q.query(`INSERT INTO community_event_participation_notices(notice_id,event_id,guest_email,event_version,kind,body)
 SELECT gen_random_uuid(),$1,email,$2,$3,$4 FROM community_event_guest_capabilities c WHERE event_id=$1 AND verified_at IS NOT NULL
 AND (EXISTS(SELECT 1 FROM community_event_guest_rsvps g WHERE g.event_id=c.event_id AND g.email=c.email AND g.state='going')
 OR ($3<>'event_announcement' AND EXISTS(SELECT 1 FROM community_event_waitlist w WHERE w.event_id=c.event_id AND w.guest_email=c.email AND w.status IN ('queued','invited','cancelled'))))
 ON CONFLICT(event_id,guest_email,event_version,kind) DO NOTHING`,[event.event_id,event.aggregate_version,kind,body]);
}

/** Media lifecycles already hold the event lock and increment its version. */
export async function recordEventMediaChange(q:PoolClient,id:string,field:string){
 const row=(await q.query('SELECT * FROM community_events WHERE event_id=$1',[id])).rows[0];
 if(row?.state==='published')await recordEventChange(q,{},row,[field]);
}
