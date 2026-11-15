import type {Pool,PoolClient} from 'pg';
import {privateEventLocationHint} from './events.js';
import {generateEventCalendar} from './event-calendar.js';
export async function exposeEvent(q:PoolClient,event:any){
 // Existing approval notice kind means admission succeeded; copy never claims human approval.
 if(!event.guild_key)return;
 await q.query(`INSERT INTO member_notifications(community_id,recipient_ref,kind,source_key,title,body,action_tab,action_resource_id)
  SELECT $1,m.user_id,'event_approved',$3,'公會有新活動',$4,'events',$5
  FROM positioning_profession_memberships m JOIN users u ON u.user_id=m.user_id AND u.community_id=m.community_id
  WHERE m.community_id=$1 AND m.guild_key=$2 AND m.state='active' AND u.active AND NOT is_verification_test_account(u.user_id)
  ON CONFLICT(community_id,recipient_ref,source_key) DO NOTHING`,[event.community_id,event.guild_key,`event/${event.event_id}/published`,event.title,event.event_id]);
}
export async function publicUpcomingEvents(q:Pool|PoolClient,limit=6){
 return (await q.query(`SELECT event_id,title,starts_at,ends_at,mode FROM community_events WHERE state='published' AND visibility='open' AND starts_at>clock_timestamp()
  AND NOT is_verification_test_account(organizer_ref) ORDER BY starts_at,event_id LIMIT $1`,[limit])).rows;
}
export async function publicEventCalendar(q:Pool|PoolClient){
 const rows=(await q.query(`SELECT event_id,title,description,starts_at,ends_at,mode,location,registration_policy,aggregate_version
  FROM community_events WHERE state='published' AND visibility='open' AND starts_at>clock_timestamp()
    AND NOT is_verification_test_account(organizer_ref) ORDER BY starts_at,event_id LIMIT 100`)).rows;
 const events=rows.map(row=>{
  const location=row.mode==='online'||/https?:\/\//i.test(row.location)?privateEventLocationHint(row):row.location;
  const calendar=generateEventCalendar({...row,location,online_url:null} as Parameters<typeof generateEventCalendar>[0]).calendar;
  return calendar.slice(calendar.indexOf('BEGIN:VEVENT'),calendar.indexOf('END:VEVENT')+10);
 });
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//FreeTWAI//Public Events//ZH-TW','CALSCALE:GREGORIAN',...events,'END:VCALENDAR',''].join('\r\n');
}
