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
 // Deliver the confirmed update before cancellation; cancellation is queued independently.
 await processEventNotices(pool,send,'https://example.org',e.event_id);
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

async function noticeFixture(){
 const id=randomUUID();
 await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,online_url,state,visibility,waitlist_enabled,response_window_minutes,capacity)
 VALUES($1,$2,$3,'合成私人活動','合成測試','2099-06-01T10:00:00Z','2099-06-01T11:00:00Z','online','私人會議室','https://example.org/private-meeting','published','open',true,30,4)`,[id,DEMO_COMMUNITY,actors[4].user_id]);
 await setRsvp(pool,cmd(actors[1],{going:true}),id);
 for(const [actor,status] of [[actors[2],'queued'],[actors[3],'invited']] as const)await pool.query(`INSERT INTO community_event_waitlist(entry_id,event_id,member_ref,status,invited_at,expires_at,invitation_id) VALUES(gen_random_uuid(),$1,$2,$3,now(),now()+interval '1 day',gen_random_uuid())`,[id,actor.user_id,status]);
 const {ensureGuestCapability}=await import('../../modules/community/event-waitlist.js');
 const {transaction}=await import('../../packages/db/index.js');
 for(const status of ['going','queued','invited']){
  const email=`${status}@example.com`;
  await transaction(pool,q=>ensureGuestCapability(q,id,{email,name:'合成訪客'}));
  if(status==='going')await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state,confirmed_at) VALUES($1,$2,'合成訪客','going',now())",[id,email]);
  else await pool.query(`INSERT INTO community_event_waitlist(entry_id,event_id,guest_email,status,invited_at,expires_at,invitation_id) VALUES(gen_random_uuid(),$1,$2,$3,now(),now()+interval '1 day',gen_random_uuid())`,[id,email,status]);
 }
 await pool.query('UPDATE community_event_guest_capabilities SET verified_at=now() WHERE event_id=$1',[id]);
 return id;
}
async function editNotice(id:string,patch:Record<string,unknown>){
 const e=(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[id])).rows[0];
 return updateEvent(pool,cmd(actors[4],{...fields(e),...patch},e.aggregate_version),id);
}
const privateNotice=(body:string)=>{assert.match(body,/私人會議室/);assert.match(body,/https:\/\/example.org\/private-meeting/);};
const safeNotice=(body:string)=>{assert.equal(body,'「合成私人活動」\n活動時間或地點有更新，請到活動頁查看。');};
test('change notices apply event reader access to queued, invited and confirmed members, including later revocation',async()=>{
 const id=await noticeFixture();await editNotice(id,{ends_at:'2099-06-01T12:00:00Z'});
 const {listNotifications}=await import('../../modules/member-communications/service.js');
 for(const actor of actors.slice(1,4)){
  const stored=(await pool.query("SELECT body FROM member_notifications WHERE action_resource_id=$1 AND recipient_ref=$2 AND kind='event_schedule_changed'",[id,actor.user_id])).rows[0];
  const delivered=(await listNotifications(pool,actor,{})).items.find(n=>n.action?.resource_id===id)!;
  assert.equal(delivered.action?.tab,'events');
  if(actor===actors[1]){privateNotice(stored.body);privateNotice(delivered.body);}else{safeNotice(stored.body);safeNotice(delivered.body);}
 }
 await setRsvp(pool,cmd(actors[1],{going:false}),id);
 safeNotice((await listNotifications(pool,actors[1],{})).items.find(n=>n.action?.resource_id===id)!.body);
});
test('guest change delivery rechecks queued, invited, confirmed and changed registrations',async()=>{
 const {processEventNotices}=await import('../../modules/community/event-waitlist.js');
 for(const changeStatus of [false,true]){
  const id=await noticeFixture();await editNotice(id,{ends_at:'2099-06-01T12:00:00Z'});
  if(changeStatus){
   await pool.query("UPDATE community_event_guest_rsvps SET state='cancelled' WHERE event_id=$1 AND email='going@example.com'",[id]);
   await pool.query("INSERT INTO community_event_waitlist(entry_id,event_id,guest_email,status) VALUES(gen_random_uuid(),$1,'going@example.com','queued')",[id]);
   await pool.query("INSERT INTO community_event_guest_rsvps(event_id,email,name,state,confirmed_at) VALUES($1,'queued@example.com','合成訪客','going',now())",[id]);
  }
  const sent=new Map<string,string>();await processEventNotices(pool,async(to,_subject,body)=>{sent.set(to,body);},'https://example.org',id);
  assert.equal(sent.size,3);
  for(const [email,body] of sent){
   assert.ok(body.endsWith(`/events/${id}`));
   if(email===(changeStatus?'queued@example.com':'going@example.com'))privateNotice(body);
   else safeNotice(body.slice(0,body.lastIndexOf('\n')));
  }
 }
});
test('insignificant seconds and location whitespace edits retain history without notices; a minute change notifies once',async()=>{
 const id=await noticeFixture();
 await editNotice(id,{ends_at:'2099-06-01T11:00:01Z'});
 assert.equal((await pool.query('SELECT count(*)::int n FROM member_notifications WHERE action_resource_id=$1',[id])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM community_event_participation_notices WHERE event_id=$1',[id])).rows[0].n,0);
 await editNotice(id,{location:'私人會議室  A'});
 await pool.query('DELETE FROM member_notifications WHERE action_resource_id=$1',[id]);
 await pool.query('DELETE FROM community_event_participation_notices WHERE event_id=$1',[id]);
 await editNotice(id,{location:'私人會議室 \t A'});
 assert.equal((await pool.query('SELECT count(*)::int n FROM member_notifications WHERE action_resource_id=$1',[id])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM community_event_participation_notices WHERE event_id=$1',[id])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM community_event_changes WHERE event_id=$1',[id])).rows[0].n,3);
 await editNotice(id,{ends_at:'2099-06-01T11:01:00Z'});
 assert.equal((await pool.query("SELECT count(*)::int n FROM member_notifications WHERE action_resource_id=$1 AND recipient_ref=$2",[id,actors[1].user_id])).rows[0].n,1);
});
test('ten alternating location edits coalesce unread and pending notices while preserving all audit versions',async()=>{
 const id=await noticeFixture();let notificationId:string|undefined;
 for(let i=0;i<10;i++){
  await editNotice(id,{location:`私人會議室${i%2?'甲':'乙'}`});
  const rows=(await pool.query("SELECT notification_id,body FROM member_notifications WHERE action_resource_id=$1 AND recipient_ref=$2 AND kind='event_schedule_changed'",[id,actors[1].user_id])).rows;
  assert.equal(rows.length,1);if(notificationId)assert.equal(rows[0].notification_id,notificationId);notificationId=rows[0].notification_id;
  assert.match(rows[0].body,new RegExp(`私人會議室${i%2?'甲':'乙'}`));
  const pending=(await pool.query("SELECT guest_email,count(*)::int n FROM community_event_participation_notices WHERE event_id=$1 AND status='pending' GROUP BY guest_email",[id])).rows;
  assert.equal(pending.length,3);assert.ok(pending.every(r=>r.n===1));
 }
 assert.equal((await pool.query('SELECT count(*)::int n FROM community_event_changes WHERE event_id=$1',[id])).rows[0].n,10);
 const {processEventNotices}=await import('../../modules/community/event-waitlist.js');let sent=0;
 await Promise.all([1,2].map(()=>processEventNotices(pool,async()=>{sent++;},'https://example.org',id)));
 assert.equal(sent,3);
 assert.equal((await pool.query("SELECT count(*)::int n FROM community_event_participation_notices WHERE event_id=$1 AND status='skipped'",[id])).rows[0].n,27);
});
test('guest change delivery consumes one hourly and three daily slots even across fresh edit versions',async()=>{
 const id=await noticeFixture();const {processEventNotices}=await import('../../modules/community/event-waitlist.js');let sent=0;
 const deliver=()=>processEventNotices(pool,async()=>{sent++;},'https://example.org',id);
 for(let i=0;i<10;i++){await editNotice(id,{location:`私人會議室${i%2?'甲':'乙'}`});await deliver();}
 assert.equal(sent,3);
 for(let slot=2;slot<=3;slot++){
  await pool.query("UPDATE community_event_participation_notices SET attempted_at=attempted_at-interval '61 minutes' WHERE event_id=$1 AND attempted_at IS NOT NULL",[id]);
  await deliver();assert.equal(sent,slot*3);
  await editNotice(id,{location:`私人會議室第${slot}次`});
 }
 await pool.query("UPDATE community_event_participation_notices SET attempted_at=attempted_at-interval '61 minutes' WHERE event_id=$1 AND attempted_at IS NOT NULL",[id]);
 await deliver();assert.equal(sent,9);
 await pool.query("UPDATE community_event_participation_notices SET attempted_at=attempted_at-interval '1 day' WHERE event_id=$1 AND attempted_at IS NOT NULL",[id]);
 await deliver();assert.equal(sent,12);
});
test('queued schedule delivery after cancellation contains no private details and cancellation still delivers',async()=>{
 const id=await noticeFixture();const e=await editNotice(id,{ends_at:'2099-06-01T12:00:00Z'});
 await cancelEvent(pool,cmd(actors[4],{},e.aggregate_version),id,false);
 const {processEventNotices}=await import('../../modules/community/event-waitlist.js');const sent:string[]=[];
 await processEventNotices(pool,async(_to,_subject,body)=>{sent.push(body);},'https://example.org',id);
 assert.ok(sent.some(body=>body.includes('已取消')));
 assert.ok(sent.some(body=>body.includes('活動時間或地點有更新')));
 assert.ok(sent.every(body=>!body.includes('私人會議室')&&!body.includes('private-meeting')));
});
test('a superseding edit between claim and delivery skips the old claim and preserves the latest pending notice',async()=>{
 const id=await noticeFixture();await editNotice(id,{location:'私人會議室舊版'});
 const {processEventNotices}=await import('../../modules/community/event-waitlist.js');
 let intercepted=false;
 const interceptedPool={query:pool.query.bind(pool),connect:async()=>{
  const client=await pool.connect(),query=client.query.bind(client);let claimed=false;
  const wrapper={query:async(...args:any[])=>{
   const result=await (query as any)(...args);
   if(String(args[0]).includes("SET status='unknown',attempted_at")&&result.rowCount)claimed=true;
   if(claimed&&args[0]==='COMMIT'&&!intercepted){intercepted=true;await editNotice(id,{location:'私人會議室最新版'});}
   return result;
  },release:()=>client.release()};return wrapper;
 }} as unknown as Pool;
 const sent:string[]=[];await processEventNotices(interceptedPool,async(_to,_subject,body)=>{sent.push(body);},'https://example.org',id);
 assert.equal(intercepted,true);assert.equal(sent.length,0);
 assert.equal((await pool.query("SELECT count(*)::int n FROM community_event_participation_notices WHERE event_id=$1 AND status='skipped'",[id])).rows[0].n,3);
 await pool.query("UPDATE community_event_participation_notices SET attempted_at=attempted_at-interval '61 minutes' WHERE event_id=$1",[id]);
 await processEventNotices(pool,async(_to,_subject,body)=>{sent.push(body);},'https://example.org',id);
 assert.equal(sent.length,3);assert.ok(sent.every(body=>!body.includes('私人會議室舊版')));assert.ok(sent.some(body=>body.includes('私人會議室最新版')));
});
test('failed and unknown guest attempts consume change budget while announcements retain their own allowance',async()=>{
 const id=await noticeFixture();await editNotice(id,{location:'私人會議室甲'});
 const {processEventNotices}=await import('../../modules/community/event-waitlist.js');
 const failed=await processEventNotices(pool,async()=>{throw Error('synthetic provider outcome');},'https://example.org',id);
 assert.equal(failed.failed,3);
 await pool.query("UPDATE community_event_participation_notices SET status='unknown' WHERE event_id=$1",[id]);
 await editNotice(id,{location:'私人會議室乙'});
 await processEventNotices(pool,async()=>assert.fail('unknown attempt cannot free the hourly slot'),'https://example.org',id);
 const {announceEvent}=await import('../../modules/community/events.js');
 for(let i=0;i<3;i++){
  const e=(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[id])).rows[0];
  await announceEvent(pool,cmd(actors[4],{message:`合成通知${i}`},e.aggregate_version),id);
 }
 const sent:string[]=[];await processEventNotices(pool,async(_to,_subject,body)=>{sent.push(body);},'https://example.org',id);
 assert.equal(sent.length,3);assert.ok(sent.every(body=>body.includes('合成通知')));
});
test('schema208 upgrade leaves legacy notices untouched and a later edit coalesces them',async()=>{
 const {fileURLToPath}=await import('node:url');
 const {readMigrationSources}=await import('../../packages/db/migration-files.mjs');
 const {legacyMigrationProfile}=await import('../../packages/db/migration-plan.mjs');
 const {runMigrationPlan}=await import('../../packages/db/migration-runner.mjs');
 const upgradeSchema=`fp_notice_upgrade_${randomUUID().replaceAll('-','')}`;
 const upgrade=new Pool({connectionString:url,options:`-c search_path=${upgradeSchema}`});
 await admin.query(`CREATE SCHEMA ${upgradeSchema}`);
 try{
  const sources=readMigrationSources(fileURLToPath(new URL('../../migrations/',import.meta.url))).filter(s=>Number(s.name.slice(0,3))<=208);
  await runMigrationPlan(upgrade,{sources,profile:legacyMigrationProfile({first:1,last:208,known_gaps:[22]})});await seedLocal(upgrade);
  const id=randomUUID(),recipient=DEMO_USERS[1].user_id;
  await upgrade.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state)
   VALUES($1,$2,$3,'合成升級','合成升級','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z','in_person','舊場地','published')`,[id,DEMO_COMMUNITY,DEMO_USERS[0].user_id]);
  for(const version of [1,2])await upgrade.query(`INSERT INTO member_notifications(community_id,recipient_ref,kind,source_key,title,body,action_tab,action_resource_id)
   VALUES($1,$2,'event_schedule_changed',$3,'活動已更新','舊場地','events',$4)`,[DEMO_COMMUNITY,recipient,`event/${id}/schedule/${version}`,id]);
  await upgrade.query(`INSERT INTO member_notifications(community_id,recipient_ref,kind,source_key,title,body,action_tab,action_resource_id)
   VALUES($1,$2,'event_cancelled',$3,'活動已取消','合成其他通知','events',$4)`,[DEMO_COMMUNITY,recipient,`event/${id}/cancel`,id]);
  const {ensureGuestCapability}=await import('../../modules/community/event-waitlist.js');
  const {transaction}=await import('../../packages/db/index.js');
  await transaction(upgrade,q=>ensureGuestCapability(q,id,{email:'upgrade@example.com',name:'合成訪客'}));
  for(const version of [1,2])await upgrade.query(`INSERT INTO community_event_participation_notices(notice_id,event_id,guest_email,event_version,kind)
   VALUES(gen_random_uuid(),$1,'upgrade@example.com',$2,'event_schedule_changed')`,[id,version]);
  await migrate(upgrade);
  const expensiveConstraints=['canonical_repositories_fetch_state_check','skill_star_support_via_share_id_fkey','skill_star_support_via_user_id_fkey','guild_skill_book_bindings_share_id_fkey','member_skill_book_grants_share_id_fkey','oss_projects_share_id_fkey','skill_submissions_share_id_fkey','promotion_links_kind_check','promotion_clicks_kind_check','community_events_source_url_check','community_events_source_host_check','community_events_registration_mode_check','community_events_external_registration_url_check','community_events_source_organizer_check','community_events_source_cover_url_check','community_event_participation_notices_body_check','community_event_participation_notices_kind_check','community_event_participation_notices_status_check','member_notifications_kind_check'];
  const checks=(await upgrade.query('SELECT conname,convalidated FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname=ANY($1::text[])',[expensiveConstraints])).rows;
  assert.equal(checks.length,expensiveConstraints.length);
  assert.equal(checks.filter(c=>c.convalidated).length,0);
  assert.equal((await upgrade.query("SELECT count(*)::int n FROM pg_indexes WHERE schemaname=current_schema() AND indexname=ANY($1::text[])",[['community_events_source','community_events_duplicate','event_change_notice_budget']])).rows[0].n,0);
  const counts=async()=> (await upgrade.query("SELECT count(*)::int total,count(*) FILTER(WHERE read_at IS NULL)::int unread FROM member_notifications WHERE action_resource_id=$1 AND kind='event_schedule_changed'",[id])).rows[0];
  assert.deepEqual(await counts(),{total:2,unread:2});
  assert.equal((await upgrade.query("SELECT count(*)::int n FROM member_notifications WHERE action_resource_id=$1 AND kind='event_cancelled' AND read_at IS NULL",[id])).rows[0].n,1);
  assert.equal((await upgrade.query("SELECT count(*)::int n FROM community_event_participation_notices WHERE event_id=$1 AND status='skipped'",[id])).rows[0].n,0);
  assert.deepEqual((await upgrade.query("SELECT event_version FROM community_event_participation_notices WHERE event_id=$1 AND status='pending' ORDER BY event_version",[id])).rows.map(r=>r.event_version),['1','2']);
  const {login}=await import('../../modules/identity-membership/service.js');const {DEMO_PASSWORD}=await import('../../packages/testing/seed.js');
  const owner=(await login(upgrade,DEMO_USERS[0].email,DEMO_PASSWORD)).actor;
  await upgrade.query("INSERT INTO community_event_rsvps(rsvp_id,event_id,user_id,state,confirmed_at) VALUES(gen_random_uuid(),$1,$2,'going',now())",[id,recipient]);
  const e=(await upgrade.query('SELECT * FROM community_events WHERE event_id=$1',[id])).rows[0];
  await updateEvent(upgrade,cmd(owner,{...fields(e),location:'升級後場地'},e.aggregate_version),id);
  assert.deepEqual(await counts(),{total:2,unread:1});
  assert.equal((await upgrade.query("SELECT body FROM member_notifications WHERE action_resource_id=$1 AND kind='event_schedule_changed' AND read_at IS NULL",[id])).rows[0].body.includes('升級後場地'),true);
 }finally{await upgrade.end();await admin.query(`DROP SCHEMA ${upgradeSchema} CASCADE`);}
});

test('event notices, guild exposure and referral credit use bounded statements for 50 members and 50 guests',async()=>{
 const {notifyEventRegistrants}=await import('../../modules/community/event-changes.js');
 const {exposeEvent}=await import('../../modules/community/event-exposure.js');
 const {creditEventRegistrations}=await import('../../modules/shares/credit.js');
 const eventId=randomUUID(),owner=actors[0].user_id;
 await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,guild_key)
  VALUES($1,$2,$3,'Synthetic bulk event','Synthetic bulk event','2099-01-01T10:00Z','2099-01-01T11:00Z','in_person','Synthetic location','published','open','guild_ai_vibe')`,[eventId,DEMO_COMMUNITY,owner]);
 const users=(await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required)
  SELECT gen_random_uuid(),community_id,'bulk-member-'||n||'@example.com','Synthetic member',password_hash,gen_random_uuid(),true,false
  FROM users CROSS JOIN generate_series(1,50) n WHERE user_id=$1 RETURNING user_id`,[owner])).rows.map(r=>r.user_id);
 await pool.query(`INSERT INTO community_event_rsvps(rsvp_id,event_id,user_id,state,confirmed_at,referred_by_user_id)
  SELECT gen_random_uuid(),$1,u,'going',now(),$2 FROM unnest($3::uuid[]) u`,[eventId,owner,users]);
 await pool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier)
  SELECT gen_random_uuid(),$1,u,'guild_ai_vibe','active','full' FROM unnest($2::uuid[]) u`,[DEMO_COMMUNITY,users]);
 await pool.query(`INSERT INTO community_event_guest_capabilities(event_id,email,name,token_hash,token_secret,verified_at)
  SELECT $1::uuid,'bulk-guest-'||n||'@example.com','Synthetic guest',md5($1::uuid::text||n)||md5(n||$1::uuid::text),repeat('x',43),now() FROM generate_series(1,50) n`,[eventId]);
 await pool.query(`INSERT INTO community_event_guest_rsvps(event_id,email,name,state,confirmed_at,referred_by_user_id)
  SELECT event_id,email,name,'going',now(),$2 FROM community_event_guest_capabilities WHERE event_id=$1`,[eventId,owner]);
 await pool.query(`INSERT INTO shares(community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id)
  VALUES($1,'event','event:'||$2::uuid::text,'/events/'||$2::uuid::text,'community_events',$2::uuid,'Synthetic bulk event',$3)`,[DEMO_COMMUNITY,eventId,owner]);
 const event=(await pool.query('SELECT * FROM community_events WHERE event_id=$1',[eventId])).rows[0];
 const client=await pool.connect();let calls=0;
 const counted={query:(...args:any[])=>{calls++;return (client.query as any)(...args);},release:()=>client.release()} as unknown as import('pg').PoolClient;
 try{
  await client.query('BEGIN');
  await notifyEventRegistrants(counted,event,'event_schedule_changed');const notices=calls;calls=0;
  await exposeEvent(counted,event);const exposure=calls;calls=0;
  const credited=await creditEventRegistrations(counted,eventId),credit=calls;
  assert.equal(credited,100);
  assert.equal((await client.query("SELECT count(*)::int n FROM member_notifications WHERE action_resource_id=$1 AND kind='event_schedule_changed'",[eventId])).rows[0].n,50);
  assert.equal((await client.query('SELECT count(*)::int n FROM community_event_participation_notices WHERE event_id=$1',[eventId])).rows[0].n,50);
  assert.deepEqual({notices:notices<=4,exposure:exposure<=2,credit:credit<=4},{notices:true,exposure:true,credit:true},`SQL calls: ${JSON.stringify({notices,exposure,credit})}`);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
});
