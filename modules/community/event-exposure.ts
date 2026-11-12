import type {Pool,PoolClient} from 'pg';
import {notifyMember} from '../member-communications/notifications.js';
import {publicEvent} from './events.js';
import {generateEventCalendar} from './event-calendar.js';
export async function exposeEvent(q:PoolClient,event:any){
 // Existing approval notice kind means admission succeeded; copy never claims human approval.
 if(!event.guild_key)return;
 const members=(await q.query(`SELECT m.user_id FROM positioning_profession_memberships m JOIN users u USING(user_id)
  WHERE m.community_id=$1 AND m.guild_key=$2 AND m.state='active' AND u.active AND NOT is_verification_test_account(u.user_id)`,[event.community_id,event.guild_key])).rows;
 for(const member of members)await notifyMember(q,{community_id:event.community_id,recipient_ref:member.user_id,kind:'event_approved',source_key:`event/${event.event_id}/published`,title:'公會有新活動',body:event.title,action:{tab:'events',resource_id:event.event_id}});
}
export async function publicUpcomingEvents(q:Pool|PoolClient,limit=6){
 return (await q.query(`SELECT event_id,title,starts_at,ends_at,mode FROM community_events WHERE state='published' AND visibility='open' AND starts_at>clock_timestamp()
  AND NOT is_verification_test_account(organizer_ref) ORDER BY starts_at,event_id LIMIT $1`,[limit])).rows;
}
export async function publicEventCalendar(q:Pool|PoolClient){
 const rows=await publicUpcomingEvents(q,100),events=[];
 for(const row of rows){const calendar=generateEventCalendar(await publicEvent(q,row.event_id)).calendar;events.push(calendar.slice(calendar.indexOf('BEGIN:VEVENT'),calendar.indexOf('END:VEVENT')+10));}
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//FreeTWAI//Public Events//ZH-TW','CALSCALE:GREGORIAN',...events,'END:VCALENDAR',''].join('\r\n');
}
