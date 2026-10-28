import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
// Author DB cases: require an explicitly supplied disposable local fp_* target.
// Never discover or fall back to a developer/production database.
const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)throw new Error('Event helper DB tests require explicit disposable TEST_DATABASE_URL');
const target=new URL(databaseUrl);
if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!/^\/fp_[a-zA-Z0-9_]+$/.test(target.pathname)||target.search)throw new Error('Event helper DB tests require a local fp_* database without query overrides');
const schema=`fp_event_helpers_${process.pid}_${Date.now()}`,admin=new Pool({connectionString:databaseUrl});
const pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`,max:8});
const origin='http://127.0.0.1:4315',app=createApp(pool,origin,'local');
type Session={cookie:string;csrf:string;id:string};
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
async function login(index:number):Promise<Session>{
 const r=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:DEMO_USERS[index].email,password:DEMO_PASSWORD})});
 assert.equal(r.status,200);const d=await r.json() as any;return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:d.csrf_token,id:d.user.user_id};
}
async function request(path:string,s?:Session,body?:unknown,version?:number,key=randomUUID()){
 const headers:Record<string,string>={Origin:origin,...(s?{Cookie:s.cookie,'X-CSRF-Token':s.csrf}:{})};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;if(version!==undefined)headers['If-Match']=`"${version}"`;}
 const r=await app.request(origin+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,headers:r.headers,data:await r.json() as any};
}
async function fixture(extra:Record<string,unknown>={}){
 const host=await login(0),member=await login(1),peer=await login(2);
 const created=await request('/events',host,{title:'幫手活動',description:'合成測試活動',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'online',location:'https://example.test/meeting',capacity:1,visibility:'open',help_need:'協助報到',...extra});
 assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.event_id;
 // Publication fixture only; create/update review invariants tested separately.
 await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[id]);
 return {host,member,peer,id,path:`/events/${id}/helpers`};
}
test('independent offer, private organizer list, accept and withdraw never reserve a seat or publish contacts',async()=>{
 const {host,member,peer,id,path}=await fixture();
 const absent=await request(path+'/me',member);assert.deepEqual(absent.data,{state:null,version:1,event_closed:false});
 assert.equal((await request(path+'/me',member,{action:'offer'},1)).status,200);
 const list=await request(path,host);assert.equal(list.status,200);assert.equal(list.headers.get('cache-control'),'private, no-store');
 assert.equal(list.data.total,1);assert.equal(list.data.items[0].user_id,member.id);
 assert.deepEqual(Object.keys(list.data.items[0]).sort(),['avatar_url','created_at','nickname','state','updated_at','user_id','version']);
 assert.doesNotMatch(JSON.stringify(list.data),/@|email|phone|contact|share_token/);
 assert.equal((await request(path,member)).status,403);assert.equal((await request(path,peer)).status,403);
 assert.equal((await request(path+'/'+member.id+'/decision',peer,{decision:'accept'},2)).status,403);
 assert.equal((await request(path+'/'+member.id+'/decision',host,{decision:'accept'},2)).data.state,'accepted');
 assert.equal((await request(path+'/me',member,{action:'withdraw'},3)).data.state,'withdrawn');
 assert.equal((await request(`/events/${id}`,member)).data.attending_count,0);
 assert.equal((await pool.query('SELECT count(*) AS n FROM community_event_rsvps WHERE event_id=$1',[id])).rows[0].n,'0');
 assert.equal((await pool.query('SELECT count(*) AS n FROM community_event_waitlist WHERE event_id=$1',[id])).rows[0].n,'0');
 const pub=await app.request(origin+`/api/v1/public/events/${id}`);assert.doesNotMatch(await pub.text(),/help_need|member_ref|applied|協助報到/);
});
test('one key deduplicates concurrent offers; old ACK cannot rewrite a later withdrawal',async()=>{
 const {member,path}=await fixture(),key=randomUUID();
 const replies=await Promise.all([request(path+'/me',member,{action:'offer'},1,key),request(path+'/me',member,{action:'offer'},1,key)]);
 assert.deepEqual(replies.map(r=>r.status),[200,200]);assert.deepEqual(replies[0].data,replies[1].data);
 assert.equal((await request(path+'/me',member,{action:'withdraw'},2)).data.state,'withdrawn');
 const replay=await request(path+'/me',member,{action:'offer'},1,key);assert.equal(replay.data.state,'applied');
 assert.equal((await request(path+'/me',member)).data.state,'withdrawn');
 assert.equal((await request(path+'/me',member,{action:'withdraw'},1,key)).status,409);
});
test('withdraw and organizer accept compare the same application revision',async()=>{
 const {host,member,path}=await fixture();await request(path+'/me',member,{action:'offer'},1);
 const results=await Promise.all([request(path+'/me',member,{action:'withdraw'},2),request(path+'/'+member.id+'/decision',host,{decision:'accept'},2)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,412]);
 assert.equal((await request(path+'/me',member,{action:'offer'},1)).status,412);
});
test('cancel/start/pending restrict new effects but retained own withdrawal remains possible',async()=>{
 for(const change of ["state='cancelled'","starts_at=clock_timestamp()-interval '1 minute'","state='pending'"]){
  const {host,member,peer,id,path}=await fixture();await request(path+'/me',member,{action:'offer'},1);
  await pool.query(`UPDATE community_events SET ${change} WHERE event_id=$1`,[id]);
  const decision=await request(path+'/'+member.id+'/decision',host,{decision:'accept'},2);assert.equal(decision.status,409);
  assert.notEqual((await request(path+'/me',peer,{action:'offer'},1)).status,200);
  assert.equal((await request(path+'/me',member)).data.event_closed,true);
  assert.equal((await request(path+'/me',member,{action:'withdraw'},2)).data.state,'withdrawn');
 }
});
test('strict commands, missing version, organizer self-application, disabled need and paging reject unsafe defaults',async()=>{
 const {host,member,id,path}=await fixture();
 assert.equal((await request(path+'/me',member,{action:'offer'})).status,428);
 for(const body of [{action:'approve'},{action:'offer',member_ref:host.id},{action:'withdraw',referral_code:null}])assert.equal((await request(path+'/me',member,body,1)).status,422);
 assert.equal((await request(path+'/me',host,{action:'offer'},1)).status,409);
 assert.equal((await request(path+'?limit=51',host)).status,422);assert.equal((await request(path+'?offset=-1',host)).status,422);
 await pool.query('UPDATE community_events SET help_need=NULL WHERE event_id=$1',[id]);assert.equal((await request(path+'/me',member,{action:'offer'},1)).status,409);
});
test('referral offer requires a valid code but never joins attendance',async()=>{
 const {host,member,path,id}=await fixture({visibility:'referral'});
 assert.equal((await request(path+'/me',member,{action:'offer'},1)).data.code,'share_code_required');
 const code=(await request(`/events/${id}/share-code`,host,{})).data.code;
 assert.equal((await request(path+'/me',member,{action:'offer',referral_code:code},1)).data.state,'applied');
 assert.equal((await request(`/events/${id}`,member)).data.my_rsvp,null);
});
test('membership loss keeps only own status/withdrawal, not peer list or a new offer',async()=>{
 const {host,member,id,path}=await fixture();
 await pool.query("UPDATE community_events SET visibility='guild',event_kind='guild_skill_exchange',guild_key='guild_member_operations' WHERE event_id=$1",[id]);
 await pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,'guild_member_operations','active') ON CONFLICT DO NOTHING",[randomUUID(),DEMO_COMMUNITY,member.id]);
 assert.equal((await request(path+'/me',member,{action:'offer'},1)).status,200);
 await pool.query("UPDATE positioning_profession_memberships SET state='left' WHERE user_id=$1 AND guild_key='guild_member_operations'",[member.id]);
 assert.equal((await request(path+'/me',member)).data.state,'applied');assert.equal((await request(path,member)).status,403);
 assert.equal((await request(path+'/me',member,{action:'withdraw'},2)).data.state,'withdrawn');
 assert.equal((await request(path+'/me',member,{action:'offer'},3)).status,404);
 assert.equal((await request(path,host)).data.total,1);
});
test('revoked session cannot replay a successful command or read a private helper list',async()=>{
 const {host,member,path}=await fixture(),key=randomUUID();
 assert.equal((await request(path+'/me',member,{action:'offer'},1,key)).status,200);
 await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[member.id]);
 assert.equal((await request(path+'/me',member,{action:'offer'},1,key)).status,401);
 assert.equal((await request(path+'/me',member)).status,401);
 await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[host.id]);
 assert.equal((await request(path,host)).status,401);
});
test('same-community reviewer has no helper-list privilege; foreign event scope remains hidden',async()=>{
 const {host,member,peer,id,path}=await fixture();
 await pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,'guild_member_operations','active') ON CONFLICT DO NOTHING",[randomUUID(),DEMO_COMMUNITY,peer.id]);
 await pool.query("INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,'guild_member_operations',$2) ON CONFLICT DO NOTHING",[DEMO_COMMUNITY,peer.id]);
 assert.equal((await request(path,peer)).status,403);
 await request(path+'/me',member,{action:'offer'},1);
 const other=randomUUID();await pool.query("INSERT INTO communities(community_id,name) VALUES($1,'隔離合成社群')",[other]);
 await pool.query('UPDATE community_events SET community_id=$2 WHERE event_id=$1',[id,other]);
 for(const session of [host,member,peer])assert.equal((await request(path+'/me',session)).status,404);
 assert.equal((await request(path+'/me',member,{action:'withdraw'},2)).status,404);
});
test('intern organizer cannot decide or replay an earlier decision after demotion',async()=>{
 const {host,member,peer,id,path}=await fixture();
 await pool.query("UPDATE community_events SET event_kind='guild_skill_exchange',guild_key='guild_member_operations' WHERE event_id=$1",[id]);
 await pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_member_operations','active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET member_tier='full',state='active'",[randomUUID(),DEMO_COMMUNITY,host.id]);
 await request(path+'/me',member,{action:'offer'},1);await request(path+'/me',peer,{action:'offer'},1);
 const key=randomUUID();assert.equal((await request(path+'/'+member.id+'/decision',host,{decision:'accept'},2,key)).status,200);
 await pool.query("UPDATE positioning_profession_memberships SET member_tier='intern' WHERE user_id=$1 AND guild_key='guild_member_operations'",[host.id]);
 assert.equal((await request(path+'/'+member.id+'/decision',host,{decision:'accept'},2,key)).status,403);
 assert.equal((await request(path+'/'+peer.id+'/decision',host,{decision:'accept'},2)).status,403);
});
async function waitForBlocked(blockerPid:number){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  const found=(await pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE $1=ANY(pg_blocking_pids(a.pid))) AS blocked',[blockerPid])).rows[0].blocked;
  if(found)return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('native PostgreSQL blocker was not observed');
}
test('cancellation winning the event lock refuses a queued offer',async()=>{
 const {member,id,path}=await fixture(),blocker=await pool.connect();let pending:ReturnType<typeof request>|undefined;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM community_events WHERE event_id=$1 FOR UPDATE',[id]);
  const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=request(path+'/me',member,{action:'offer'},1);await waitForBlocked(pid);
  await blocker.query("UPDATE community_events SET state='cancelled' WHERE event_id=$1",[id]);await blocker.query('COMMIT');
  assert.equal((await pending).status,404);assert.equal((await pool.query('SELECT count(*) AS n FROM community_event_helpers WHERE event_id=$1',[id])).rows[0].n,'0');
 }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
});
test('deadline during the final receipt INSERT rolls back helper, journal and receipt atomically',async()=>{
 const {member,id,path}=await fixture(),blocker=await pool.connect(),key=randomUUID();let pending:ReturnType<typeof request>|undefined;
 try{
  await pool.query("UPDATE community_events SET starts_at=clock_timestamp()+interval '2 seconds' WHERE event_id=$1",[id]);
  const starts=(await pool.query('SELECT starts_at FROM community_events WHERE event_id=$1',[id])).rows[0].starts_at;
  await blocker.query('BEGIN');await blocker.query('LOCK TABLE command_receipts IN SHARE MODE');
  const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=request(path+'/me',member,{action:'offer'},1,key);await waitForBlocked(pid);
  // Database clock, not elapsed JS sleep, establishes crossing the actual deadline.
  for(let n=0;n<500;n++){
   if((await blocker.query('SELECT clock_timestamp()>=$1 AS expired',[starts])).rows[0].expired)break;
   await blocker.query('SELECT pg_sleep(0.01)');
  }
  assert.equal((await blocker.query('SELECT clock_timestamp()>=$1 AS expired',[starts])).rows[0].expired,true);
  await blocker.query('COMMIT');assert.equal((await pending).data.code,'event_closed');
  assert.equal((await pool.query('SELECT count(*) AS n FROM community_event_helpers WHERE event_id=$1',[id])).rows[0].n,'0');
  assert.equal((await pool.query("SELECT count(*) AS n FROM transition_journal WHERE aggregate_type='community_event_helper' AND data->>'event_id'=$1",[id])).rows[0].n,'0');
  assert.equal((await pool.query('SELECT count(*) AS n FROM command_receipts WHERE idempotency_key=$1',[key])).rows[0].n,'0');
 }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
});
test('organizer cannot accept a departed guild member, while withdrawal and decline remain possible',async()=>{
 const {host,member,id,path}=await fixture();
 await pool.query("UPDATE community_events SET visibility='guild',event_kind='guild_skill_exchange',guild_key='guild_member_operations' WHERE event_id=$1",[id]);
 await pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,'guild_member_operations','active') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,member.id]);
 assert.equal((await request(path+'/me',member,{action:'offer'},1)).status,200);
 await pool.query("UPDATE positioning_profession_memberships SET state='left' WHERE user_id=$1 AND guild_key='guild_member_operations'",[member.id]);
 const accept=await request(path+'/'+member.id+'/decision',host,{decision:'accept'},2);assert.equal(accept.status,409);assert.equal(accept.data.code,'helper_member_unavailable');
 assert.equal((await request(path+'/'+member.id+'/decision',host,{decision:'decline'},2)).data.state,'declined');
});
test('different keys still consume one initial version and exhausted versions fail without rounding',async()=>{
 const {member,id,path}=await fixture();
 const replies=await Promise.all([request(path+'/me',member,{action:'offer'},1),request(path+'/me',member,{action:'offer'},1)]);
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,412]);
 await pool.query('UPDATE community_event_helpers SET aggregate_version=9007199254740991 WHERE event_id=$1',[id]);
 assert.equal((await request(path+'/me',member)).data.version,Number.MAX_SAFE_INTEGER);
 const r=await request(path+'/me',member,{action:'withdraw'},Number.MAX_SAFE_INTEGER);assert.equal(r.status,409);assert.equal(r.data.code,'helper_version_exhausted');
});
test('verification-only applicants remain hidden in both organizer pages and known-ID decisions',async()=>{
 const {host,member,path}=await fixture();await request(path+'/me',member,{action:'offer'},1);
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[member.id,`helper-${randomUUID()}@example.invalid`]);
 const page=await request(path,host);assert.equal(page.data.total,0);assert.deepEqual(page.data.items,[]);
 assert.equal((await request(path+'/'+member.id+'/decision',host,{decision:'accept'},2)).status,404);
 assert.equal((await request(path+'/'+member.id+'/decision',host,{decision:'decline'},2)).status,404);
});
