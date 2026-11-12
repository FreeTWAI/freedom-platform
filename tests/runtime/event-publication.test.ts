import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {claimEventOrganizer,reviewEventOrganizer} from '../../modules/community/event-claims.js';
import {guestEventInterest} from '../../modules/community/event-interest.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {shareEvent} from '../../modules/community/event-sharing.js';
import {creditPromotionClick} from '../../modules/community/promotion.js';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {tokenHash,type Actor} from '../../modules/identity-membership/service.js';
import {createEvent,publicEvent,readEvent,setRsvp,registerPublicEvent} from '../../modules/community/events.js';
import {reportShare} from '../../modules/shares/service.js';
import {publishPendingEvents} from '../../modules/community/publish-pending-events.js';
const url=process.env.TEST_DATABASE_URL;assert.ok(url);
const schema=`fp_publish_${randomUUID().replaceAll('-','')}`,admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const actors:Actor[]=[],tokens:string[]=[];
const cmd=(actor:Actor,body:unknown)=>({actor,body,key:randomUUID(),operation:'event-publication-test'});
const body=()=>({title:`合成活動 ${randomUUID().slice(0,8)}`,starts_at:'2099-01-01T10:00:00Z',location:'合成場地'});
before(async()=>{
 await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);
 for(let i=0;i<6;i++){
  const id=randomUUID(),token=randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required) SELECT $1,community_id,$2,'活動會員',password_hash,$3,true,false FROM users WHERE user_id=$4`,[id,`event-${i}@example.com`,randomUUID(),DEMO_USERS[0].user_id]);
  await pool.query(`INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')`,[tokenHash(token),id]);tokens.push(token);actors.push({user_id:id,community_id:DEMO_COMMUNITY,session_hash:tokenHash(token)} as Actor);
 }
});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
test('three fields publish immediately; validation, duplicate and replay preserve effects',async()=>{
 const b=body(),c=cmd(actors[0],b),e=await createEvent(pool,c);
 assert.equal(e.state,'published');assert.equal(e.visibility,'open');assert.ok(e.share_id);assert.equal((await publicEvent(pool,e.event_id)).title,b.title);
 assert.deepEqual(await createEvent(pool,c),JSON.parse(JSON.stringify(e)));
 await assert.rejects(createEvent(pool,cmd(actors[1],b)),{code:'duplicate_event'});
 for(const invalid of [{...body(),starts_at:'2020-01-01T00:00:00Z'},{...body(),title:'x'.repeat(121)},{...body(),location:''},{...body(),ends_at:'2098-01-01T00:00:00Z'}])await assert.rejects(createEvent(pool,cmd(actors[0],invalid)));
});
test('five creations per member per 24h; concurrency and replay do not exceed the cap',async()=>{
 for(let i=0;i<4;i++)await createEvent(pool,cmd(actors[4],body()));
 const results=await Promise.allSettled([createEvent(pool,cmd(actors[4],body())),createEvent(pool,cmd(actors[4],body()))]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM community_events WHERE organizer_ref=$1',[actors[4].user_id])).rows[0].n,5);
});
test('three distinct share reports hide the event and reverse credit; repeated reporter counts once',async()=>{
 const e=await createEvent(pool,cmd(actors[1],body()));
 for(const i of [0,0,2])await reportShare(pool,cmd(actors[i],{reason:'合成檢舉'}),e.share_id);
 assert.equal((await publicEvent(pool,e.event_id)).event_id,e.event_id);
 await reportShare(pool,cmd(actors[3],{reason:'合成檢舉'}),e.share_id);
 await assert.rejects(publicEvent(pool,e.event_id),{status:404});await assert.rejects(readEvent(pool,actors[0],e.event_id),{status:404});
 assert.equal((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1',[e.share_id])).rows[0].n,0);
});
test('pending release step dry-runs, excludes past and moderated events, and safely repeats',async()=>{
 const e=await createEvent(pool,cmd(actors[2],body()));
 await pool.query("UPDATE community_events SET state='pending' WHERE event_id=$1",[e.event_id]);
 const old=await createEvent(pool,cmd(actors[2],body()));await pool.query("UPDATE community_events SET state='pending',starts_at='2020-01-01',ends_at='2020-01-02' WHERE event_id=$1",[old.event_id]);
 const release=async(args:string[]=[])=>{const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','scripts/publish-pending-events.ts',...args],{cwd:process.cwd(),env:{...process.env,PGOPTIONS:`-c search_path=${schema}`}});return stdout.trim().split('\n').map(line=>JSON.parse(line));};
 assert.deepEqual(await release(),[{mode:'dry-run',eligible:1,applied:0}]);
 assert.deepEqual(await publishPendingEvents(pool),{eligible:1,applied:0});
 assert.equal((await pool.query('SELECT state FROM community_events WHERE event_id=$1',[e.event_id])).rows[0].state,'pending');
 assert.deepEqual(await release(['--apply']),[{mode:'dry-run',eligible:1,applied:0},{mode:'apply',eligible:1,applied:1}]);assert.deepEqual(await release(['--apply']),[{mode:'dry-run',eligible:0,applied:0},{mode:'apply',eligible:0,applied:0}]);assert.deepEqual(await publishPendingEvents(pool,true),{eligible:0,applied:0});
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares WHERE ref_id=$1',[e.event_id])).rows[0].n,1);
});

test('HTML enforces every visibility, hides online details and honors participation flag',async()=>{
 const origin='http://127.0.0.1:4310',app=createApp(pool,origin),enabled=createApp(pool,origin,'local',{eventParticipationEnabled:true,eventEmailSender:async()=>{}});
 for(const visibility of ['open','referral','workshop','guild']){
  const e=await createEvent(pool,cmd(actors[5],{...body(),mode:'online',online_url:'https://example.com/private-meet',visibility:visibility==='guild'?'open':visibility}));
  if(visibility==='guild')await pool.query("UPDATE community_events SET visibility='guild',event_kind='guild_skill_exchange',guild_key='guild_ai_vibe' WHERE event_id=$1",[e.event_id]);
  const response=await app.request(origin+'/events/'+e.event_id),html=await response.text();
  const tracked=(await pool.query("SELECT code FROM promotion_links WHERE kind='event' AND target_key=$1",[e.event_id])).rows[0].code;
  const preview=await (await app.request(origin+'/go/'+tracked)).text();
  if(['guild','workshop'].includes(visibility))assert.ok(!preview.includes(e.title),'private tracked preview omits event title');
  assert.equal(response.status,['open','referral'].includes(visibility)?200:404,visibility);assert.ok(!html.includes('https://example.com/private-meet'));
  if(response.status===200){assert.match(html,/og:title/);assert.match(html,/application\/ld\+json/);assert.ok(!html.includes('加入行事曆'));assert.ok(!html.includes('name="email"'));}
  const member=await app.request(origin+'/events/'+e.event_id,{headers:{Cookie:'freedom_local_session='+tokens[0]}});assert.equal(member.status,visibility==='guild'?404:200);
  if(visibility==='open'){const on=await enabled.request(origin+'/events/'+e.event_id);assert.match(await on.text(),/name="email"/);}
 }
});
test('tracked clicks and confirmed registrations use ledger once for same member/guest email',async()=>{
 const e=await createEvent(pool,cmd(actors[3],body())),link=await shareEvent(pool,cmd(actors[0],{}),e.event_id);
 const code=(await pool.query('SELECT code FROM community_event_share_codes WHERE event_id=$1 AND user_id=$2',[e.event_id,actors[0].user_id])).rows[0].code;
 const c=cmd(actors[1],{going:true,referral_code:code});await setRsvp(pool,c,e.event_id);await setRsvp(pool,c,e.event_id);
 await registerPublicEvent(pool,e.event_id,{name:'合成訪客',email:'EVENT-1@example.com',referral_code:code},async()=>{},'http://127.0.0.1:4310',true);
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[actors[1].user_id,'changed-event-1@example.com']);
 await setRsvp(pool,cmd(actors[1],{going:false}),e.event_id);await setRsvp(pool,cmd(actors[1],{going:true,referral_code:code}),e.event_id);
 assert.equal((await pool.query("SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1 AND basis='registration'",[e.share_id])).rows[0].n,1);
 await creditPromotionClick(pool,{code:link.path.split('/').pop()!,userAgent:'Mozilla/5.0',sessionUserId:actors[2].user_id,network:'synthetic',now:new Date()});
 const stats=await shareEvent(pool,cmd(actors[0],{}),e.event_id);assert.equal(stats.registrations,1);assert.equal(stats.clicks,1);
});

test('source URL normalization rejects duplicates and external clicks are interest, never registrations',async()=>{
 const first=await createEvent(pool,cmd(actors[0],{...body(),source_url:'https://example.com/source?utm_source=x',source_organizer:'合成主辦'}));
 assert.equal(first.imported,true);assert.equal(first.source_host,'example.com');
 await assert.rejects(createEvent(pool,cmd(actors[1],{...body(),source_url:'https://example.com/source'})),{code:'duplicate_event'});
 const external=await createEvent(pool,cmd(actors[0],{...body(),source_url:'https://example.com/external',registration_mode:'external',external_registration_url:'https://example.com/register'}));
 const interest={interest_id:randomUUID()};assert.deepEqual(await guestEventInterest(pool,external.event_id,interest),{interested:true,registered:false});await guestEventInterest(pool,external.event_id,interest);
 assert.equal((await pool.query('SELECT count(*)::int n FROM community_event_interests WHERE event_id=$1',[external.event_id])).rows[0].n,1);
 await assert.rejects(setRsvp(pool,cmd(actors[1],{going:true}),external.event_id),{code:'external_registration'});
 await assert.rejects(registerPublicEvent(pool,external.event_id,{name:'訪客',email:'external@example.com'},async()=>{},'http://127.0.0.1:4310'),{code:'external_registration'});
 assert.equal((await pool.query("SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1 AND basis='registration'",[external.share_id])).rows[0].n,0);
});
test('organizer claims remain unverified until an audited admin decision; revocation reverses credit',async()=>{
 const event=await createEvent(pool,cmd(actors[0],{...body(),source_url:'https://example.com/claim-event'}));
 const claim=await claimEventOrganizer(pool,cmd(actors[1],{statement:'我是這場合成活動的主辦者。',evidence_url:'https://example.com/contact',declared:true}),event.event_id);assert.equal(claim.state,'pending');
 assert.equal((await pool.query("SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1 AND role='organizer'",[event.share_id])).rows[0].n,0);
 await assert.rejects(claimEventOrganizer(pool,cmd(actors[2],{statement:'我是這場合成活動的主辦者。',evidence_url:'https://other.example.com/proof',declared:true}),event.event_id),{code:'source_evidence_required'});
 const adminId=randomUUID(),email='event-admin@example.com';await pool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)',[adminId,DEMO_COMMUNITY,email,'合成管理員']);
 const actor={admin_id:adminId,community_id:DEMO_COMMUNITY,email,display_name:'合成管理員',role:'super_admin' as const,subject:'synthetic'};
 const approved=await reviewEventOrganizer(pool,{admin:actor,key:randomUUID(),operation:'test-claim',expected:'1',body:{decision:'verify',reason:'合成來源已由人核實'}},claim.claim_id);assert.equal(approved.state,'verified');
 await reviewEventOrganizer(pool,{admin:actor,key:randomUUID(),operation:'test-claim',expected:'2',body:{decision:'revoke',reason:'合成來源撤回授權'}},claim.claim_id);
 assert.equal((await pool.query("SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1 AND role='organizer'",[event.share_id])).rows[0].n,0);
});
test('guild publication stays in guild, notifies active members and public feed excludes it',async()=>{
 const guild='guild_ai_vibe';
 for(const i of [2,3])await pool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,$4,'active','full') ON CONFLICT DO NOTHING`,[randomUUID(),DEMO_COMMUNITY,actors[i].user_id,guild]);
 const event=await createEvent(pool,cmd(actors[3],{...body(),guild_key:guild}));assert.equal(event.visibility,'guild');assert.equal(event.event_kind,'guild_skill_exchange');
 assert.equal((await readEvent(pool,actors[2],event.event_id)).event_id,event.event_id);await assert.rejects(readEvent(pool,actors[0],event.event_id),{status:404});
 const notices=(await pool.query("SELECT recipient_ref,title FROM member_notifications WHERE source_key=$1",[`event/${event.event_id}/published`])).rows;
 assert.ok(notices.some(n=>n.recipient_ref===actors[2].user_id));assert.ok(notices.every(n=>n.title==='公會有新活動'));
 const app=createApp(pool,'http://127.0.0.1:4310','local',{eventParticipationEnabled:true});
 const feed=await (await app.request('/api/v1/public/events')).json() as {items:{event_id:string}[]};assert.ok(!feed.items.some(e=>e.event_id===event.event_id));
 const ics=await (await app.request('/events.ics')).text();assert.ok(!ics.includes(event.title));assert.ok(!ics.includes('private-meet'));assert.match(ics,/BEGIN:VCALENDAR/);
});

test('public HTML and JSON-LD escape hostile member prose without exposing active markup',async()=>{
 const e=await createEvent(pool,cmd(actors[2],{...body(),title:'<img src=x onerror=evil()>文字',description:'</script><script>alert(1)</script>'}));
 const html=await (await createApp(pool,'http://127.0.0.1:4310').request('/events/'+e.event_id)).text();
 assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(!html.includes('<img src=x'));assert.match(html,/&lt;img/);assert.match(html,/\\u003c\/script/);
});

test('event publication also respects the existing shared-content daily budget atomically',async()=>{
 for(let i=0;i<20;i++)await pool.query("INSERT INTO shares(community_id,kind,canonical_key,canonical_url,title,first_sharer_user_id) VALUES($1,'link',$2,'https://example.com/fixture','合成分享',$3)",[DEMO_COMMUNITY,randomUUID(),actors[1].user_id]);
 const before=(await pool.query('SELECT count(*)::int n FROM community_events')).rows[0].n;
 await assert.rejects(createEvent(pool,cmd(actors[1],body())),{code:'share_daily_limit'});
 assert.equal((await pool.query('SELECT count(*)::int n FROM community_events')).rows[0].n,before);
});

test('publication waiting on a database lock cannot commit after its start',async()=>{
 const blocker=await pool.connect(),before=(await pool.query('SELECT count(*)::int n FROM community_events')).rows[0].n;
 const starts=new Date(Date.now()+2000).toISOString();let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`event-publish/${DEMO_COMMUNITY}`]);
  pending=assert.rejects(createEvent(pool,cmd(actors[2],{...body(),starts_at:starts})),{code:'event_in_past'});
  await blocker.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM $1::timestamptz-clock_timestamp()))+0.02)',[starts]);
  await blocker.query('COMMIT');await pending;
  assert.equal((await pool.query('SELECT count(*)::int n FROM community_events')).rows[0].n,before);
 }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
});
