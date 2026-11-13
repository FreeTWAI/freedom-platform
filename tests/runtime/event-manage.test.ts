import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {tokenHash,type Actor} from '../../modules/identity-membership/service.js';
import {createEvent,updateEvent,cancelEvent,setRsvp} from '../../modules/community/events.js';
import {reportShare} from '../../modules/shares/service.js';
const url=process.env.TEST_DATABASE_URL;assert.ok(url);
const schema=`fp_manage_${randomUUID().replaceAll('-','')}`,admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const actors:Actor[]=[];
const cmd=(actor:Actor,body:unknown,expected?:number)=>({actor,body,expected:expected===undefined?undefined:String(expected),key:randomUUID(),operation:'event-manage-test'});
const fields=(event:any)=>Object.fromEntries(['title','description','starts_at','ends_at','mode','location','capacity','event_kind','topic','online_url','visibility','guild_key','help_need','registration_policy','prize_details'].map(k=>[k,event[k] instanceof Date?event[k].toISOString():event[k]]));
const create=()=>createEvent(pool,cmd(actors[0],{title:`合成管理 ${randomUUID()}`,starts_at:'2099-01-01T10:00:00Z',location:'合成場地'}));
before(async()=>{
 await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);
 for(let i=0;i<5;i++){
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required,created_at) SELECT $1,community_id,$2,'合成會員',password_hash,$3,true,false,now()-interval '8 days' FROM users WHERE user_id=$4`,[id,`manage-${i}@example.com`,randomUUID(),DEMO_USERS[0].user_id]);
  await pool.query(`INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')`,[tokenHash(token),id]);actors.push({user_id:id,community_id:DEMO_COMMUNITY,session_hash:tokenHash(token)} as Actor);
 }
});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
test('organizer edits published fields atomically; capacity, immutable audience and stale versions refuse',async()=>{
 const e=await create();await setRsvp(pool,cmd(actors[1],{going:true}),e.event_id);await setRsvp(pool,cmd(actors[2],{going:true}),e.event_id);
 const current=(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[e.event_id])).rows[0];
 const b={...fields(current),source_cover_url:'https://example.org/cover.png',title:'修改後活動',location:'新場地',starts_at:'2099-01-02T10:00:00Z',ends_at:'2099-01-02T11:00:00Z'};
 await assert.rejects(updateEvent(pool,cmd(actors[0],{...b,capacity:1},current.aggregate_version),e.event_id),{code:'capacity_below_attendees'});
 await assert.rejects(updateEvent(pool,cmd(actors[0],{...b,visibility:'workshop'},current.aggregate_version),e.event_id),{code:'event_review_route_immutable'});
 const command=cmd(actors[0],b,current.aggregate_version),updated=await updateEvent(pool,command,e.event_id);
 assert.equal(updated.source_cover_url,'https://example.org/cover.png');assert.equal(Number(updated.aggregate_version),Number(current.aggregate_version)+1);assert.equal(updated.state,'published');assert.equal(updated.title,b.title);assert.equal(updated.location,b.location);assert.equal(new Date(updated.starts_at).getTime(),Date.parse(b.starts_at));
 assert.deepEqual(await updateEvent(pool,command,e.event_id),JSON.parse(JSON.stringify(updated)));
 await assert.rejects(updateEvent(pool,cmd(actors[0],b,current.aggregate_version),e.event_id),{status:412});
});
test('non-organizers, another community and agent authority cannot update or cancel',async()=>{
 const e=await create();
 for(const actor of [actors[1],actors[2],{...actors[0],community_id:randomUUID()},{...actors[0],agent:{}} as unknown as Actor]){
  await assert.rejects(updateEvent(pool,cmd(actor,fields(e),e.aggregate_version),e.event_id));
  await assert.rejects(cancelEvent(pool,cmd(actor,{},e.aggregate_version),e.event_id));
 }
});
test('report-held event refuses owner edit with the moderation message; pending drafts remain editable',async()=>{
 const e=await create();for(const actor of actors.slice(1,4))await reportShare(pool,cmd(actor,{reason:'合成檢舉'}),e.share_id);
 const current=(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[e.event_id])).rows[0];
 await assert.rejects(updateEvent(pool,cmd(actors[0],fields(current),current.aggregate_version),e.event_id),{status:409,message:'這場活動正在檢舉處理中。'});
 const pending=await create();await pool.query("UPDATE community_events SET state='pending' WHERE event_id=$1",[pending.event_id]);
 assert.equal((await updateEvent(pool,cmd(actors[0],{...fields(pending),title:'保留草稿'},pending.aggregate_version),pending.event_id)).state,'pending');
});
test('published changes persist and mandatory notices deduplicate for members and verified guests with the flag off',async()=>{
 const e=await createEvent(pool,cmd(actors[4],{title:`合成通知 ${randomUUID()}`,starts_at:'2099-02-01T10:00:00Z',location:'舊場地'}));
 await setRsvp(pool,cmd(actors[1],{going:true}),e.event_id);
 const {ensureGuestCapability,processEventNotices}=await import('../../modules/community/event-waitlist.js');
 const {transaction}=await import('../../packages/db/index.js');
 for(const email of ['verified@example.com','unverified@example.com']){
  await transaction(pool,q=>ensureGuestCapability(q,e.event_id,{email,name:'私人訪客'}));
  await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state,confirmed_at) VALUES($1,$2,'私人訪客','going',now())",[e.event_id,email]);
 }
 await pool.query("UPDATE community_event_guest_capabilities SET verified_at=now() WHERE event_id=$1 AND email='verified@example.com'",[e.event_id]);
 const current=(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[e.event_id])).rows[0];
 const command=cmd(actors[4],{...fields(current),location:'更新場地',starts_at:'2099-02-02T10:00:00Z',ends_at:'2099-02-02T11:00:00Z'},current.aggregate_version);
 const changed=await updateEvent(pool,command,e.event_id);await updateEvent(pool,command,e.event_id);
 const notice=(await pool.query('SELECT * FROM member_notifications WHERE recipient_ref=$1 AND action_resource_id=$2',[actors[1].user_id,e.event_id])).rows;
 assert.equal(notice.length,1);assert.match(notice[0].body,/更新場地/);assert.match(notice[0].body,/2099/);assert.ok(!JSON.stringify(notice).includes('example.com'));assert.ok(!JSON.stringify(changed).includes('私人訪客'));
 const changes=(await pool.query('SELECT * FROM community_event_changes WHERE event_id=$1',[e.event_id])).rows;assert.equal(changes.length,1);assert.ok(changes[0].changed_fields.includes('location'));assert.equal(changes[0].event_version,changed.aggregate_version);
 const {readNotificationReminders,saveNotificationPreferences,readNotificationSummary}=await import('../../modules/member-communications/notification-preferences.js');
 const preferences={categories:{friends:'instant',squads:'instant',events:'off',following:'instant'},quiet_hours:{enabled:false,time_zone:'Asia/Taipei',start:'22:00',end:'08:00'},muted_channel_ids:[]};
 await saveNotificationPreferences(pool,cmd(actors[1],preferences,1),false);
 assert.equal((await readNotificationReminders(pool,actors[1],false,new Date())).items.filter(n=>n.kind==='event_schedule_changed').length,0);
 await saveNotificationPreferences(pool,cmd(actors[1],{...preferences,categories:{...preferences.categories,events:'summary'}},2),false);
 assert.ok((await readNotificationSummary(pool,actors[1],false,new Date())).items.some(n=>n.id===notice[0].notification_id&&n.path===`#events/${e.event_id}`));
 const sent:string[]=[];const send=async(to:string,_subject:string,body:string)=>{assert.equal(to,'verified@example.com');sent.push(body);};
 // Both versions can remain queued until after cancellation when transport is unavailable.
 const cancel=cmd(actors[4],{},changed.aggregate_version);await cancelEvent(pool,cancel,e.event_id,false);await cancelEvent(pool,cancel,e.event_id,false);
 await processEventNotices(pool,send,'https://example.org',e.event_id);await processEventNotices(pool,send,'https://example.org',e.event_id);
 assert.equal(sent.length,2);assert.match(sent[0],/更新場地/);assert.ok(sent[0].includes(`/events/${e.event_id}`));assert.match(sent[1],/已取消/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM member_notifications WHERE recipient_ref=$1 AND action_resource_id=$2 AND kind='event_cancelled'",[actors[1].user_id,e.event_id])).rows[0].n,1);
});
test('announcements are owner-only, bounded, replay-safe and limited to three per Taipei day under concurrency',async()=>{
 const {announceEvent}=await import('../../modules/community/events.js');
 const e=await createEvent(pool,cmd(actors[4],{title:`合成公告 ${randomUUID()}`,starts_at:'2099-03-01T10:00:00Z',location:'場地'}));
 await setRsvp(pool,cmd(actors[1],{going:true}),e.event_id);
 for(const actor of [actors[1],actors[2],{...actors[4],community_id:randomUUID()},{...actors[4],agent:{}} as unknown as Actor])await assert.rejects(announceEvent(pool,cmd(actor,{message:'通知'},e.aggregate_version),e.event_id));
 await assert.rejects(announceEvent(pool,cmd(actors[4],{message:'字'.repeat(301)},e.aggregate_version),e.event_id));
 await assert.rejects(announceEvent(pool,cmd(actors[4],{message:'通知',recipients:[actors[2].user_id]},e.aggregate_version),e.event_id));
 const version=async()=>Number((await pool.query('SELECT aggregate_version FROM community_events WHERE event_id=$1',[e.event_id])).rows[0].aggregate_version);
 const {ensureGuestCapability,processEventNotices}=await import('../../modules/community/event-waitlist.js');
 const {transaction}=await import('../../packages/db/index.js');
 await transaction(pool,q=>ensureGuestCapability(q,e.event_id,{email:'announcement@example.com',name:'合成訪客'}));
 await pool.query("UPDATE community_event_guest_capabilities SET verified_at=now() WHERE event_id=$1",[e.event_id]);
 await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state,confirmed_at) VALUES($1,'announcement@example.com','合成訪客','going',now())",[e.event_id]);
 const first=cmd(actors[4],{message:'請帶水。https://example.com/extra'},await version()),receipt=await announceEvent(pool,first,e.event_id);assert.deepEqual(await announceEvent(pool,first,e.event_id),receipt);
 await announceEvent(pool,cmd(actors[4],{message:'第二次'},await version()),e.event_id);
 const expected=await version();const results=await Promise.allSettled([announceEvent(pool,cmd(actors[4],{message:'第三次'},expected),e.event_id),announceEvent(pool,cmd(actors[4],{message:'第四次'},expected),e.event_id)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(announceEvent(pool,cmd(actors[4],{message:'超過次數'},await version()),e.event_id),{status:429,code:'event_announcement_limit'});
 const sent:string[]=[];await processEventNotices(pool,async(to,_subject,body)=>{assert.equal(to,'announcement@example.com');sent.push(body);},'https://example.org',e.event_id);
 await processEventNotices(pool,async()=>{assert.fail('duplicate guest announcement');},'https://example.org',e.event_id);
 assert.equal(sent.length,3);assert.ok(sent.every(body=>body.includes(`/events/${e.event_id}`)));assert.ok(!sent.some(body=>body.includes('https://example.com/extra')));
 assert.equal((await pool.query('SELECT count(*)::int n FROM community_event_announcements WHERE event_id=$1',[e.event_id])).rows[0].n,3);
 assert.equal((await pool.query("SELECT count(*)::int n FROM member_notifications WHERE action_resource_id=$1 AND recipient_ref=$2 AND kind='event_announcement'",[e.event_id,actors[1].user_id])).rows[0].n,3);
 assert.equal((await pool.query("SELECT count(*)::int n FROM member_notifications WHERE action_resource_id=$1 AND recipient_ref=$2",[e.event_id,actors[2].user_id])).rows[0].n,0);
 await pool.query("UPDATE community_event_announcements SET created_at=(date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei')-interval '1 second' WHERE event_id=$1",[e.event_id]);
 assert.equal((await announceEvent(pool,cmd(actors[4],{message:'新的一天'},await version()),e.event_id)).recorded,true);
});
