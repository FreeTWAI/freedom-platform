/** PostgreSQL integration source. NOT RUN locally; requires allocated migration first. */
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {Pool} from 'pg';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {sampleGuildAnswers} from '../../modules/positioning/guild-questions.js';
// No fallback to local/default/production database. The runner must provision isolation.
const database=process.env.TEST_DATABASE_URL;
if(!database)throw new Error('Explicit isolated TEST_DATABASE_URL and allocated profile migration required');
const schema=`fp_profile_${process.pid}_${Date.now()}`,admin=createPool(database),pool=new Pool({connectionString:database,options:`-c search_path=${schema}`,application_name:schema,max:8});
const origin='http://127.0.0.1:4310',app=createApp(pool,origin);
type Session={cookie:string;csrf:string;id:string};
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
async function request(path:string,session?:Session,body?:unknown,version?:string,key=randomUUID()){
 const headers:Record<string,string>={Origin:origin,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;if(version)headers['If-Match']=`"${version}"`;}
 const response=await app.request(origin+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json() as any,response};
}
async function member(name:string):Promise<Session>{
 const result=await request('/auth/register',undefined,{email:`${randomUUID()}@example.test`,nickname:name,password:'profile-publication-password'});assert.equal(result.status,201);
 const session={cookie:result.response.headers.get('set-cookie')!.split(';')[0],csrf:result.data.csrf_token,id:result.data.user.user_id};
 assert.equal((await request('/me/onboarding/quick-start',session,{guild_keys:['guild_ai_vibe'],primary_guild_key:'guild_ai_vibe',confirmed:true,guild_answers:sampleGuildAnswers('guild_ai_vibe')})).status,200);return session;
}
const draft={visibility:'private',display_name:'Confirmed name',bio:'Confirmed bio',links:[]};
test('no auto-publication; private/member/public opt-in, block, revocation and DTO allowlist',async()=>{
 const owner=await member('Owner'),viewer=await member('Viewer');
 assert.equal((await request('/me/profile-publication',owner)).data.visibility,'private');
 assert.equal((await request(`/public/member-profiles/${owner.id}`)).status,404);
 let saved=await request('/me/profile-publication',owner,draft);assert.equal(saved.status,200);
 assert.equal((await request(`/members/${owner.id}/profile`,owner)).status,200);
 assert.equal((await request(`/members/${owner.id}/profile`,viewer)).status,404);
 saved=await request('/me/profile-publication',owner,{...draft,visibility:'members'},saved.data.aggregate_version);assert.equal(saved.status,200);
 assert.equal((await request(`/members/${owner.id}/profile`,viewer)).status,200);
 assert.equal((await request(`/public/member-profiles/${owner.id}`)).status,404);
 assert.equal((await request('/me/profile-publication',owner,{...draft,visibility:'public'},saved.data.aggregate_version)).status,422);
 saved=await request('/me/profile-publication',owner,{...draft,visibility:'public',confirm_public:true},saved.data.aggregate_version);assert.equal(saved.status,200);
 const anonymous=await request(`/public/member-profiles/${owner.id}`);assert.equal(anonymous.status,200);assert.deepEqual(Object.keys(anonymous.data).sort(),['avatar_url','bio','cover','display_name','layout','links']);assert.equal(anonymous.data.cover,null);assert.equal(anonymous.data.layout.theme,'paper');for(const forbidden of ['email','contacts','orders','posts','asset_id','object_key','actions'])assert.equal(forbidden in anonymous.data,false);
 // Exercise actual SQL block predicate independently of feature-gated block UI.
 await pool.query("INSERT INTO member_interaction_blocks(community_id,owner_ref,target_ref,state) SELECT community_id,$1,$2,'active' FROM users WHERE user_id=$1",[viewer.id,owner.id]);
 assert.equal((await request(`/members/${owner.id}/profile`,viewer)).status,404);
 assert.equal((await request(`/public/member-profiles/${owner.id}`)).status,200); // public cannot hide from signed-out people
 saved=await request('/me/profile-publication',owner,draft,saved.data.aggregate_version);assert.equal(saved.status,200);
 assert.equal((await request(`/public/member-profiles/${owner.id}`)).status,404);
});
test('CAS and replay cannot restore old published text or duplicate a mutation',async()=>{
 const owner=await member('Owner'),key=randomUUID();
 const first=await request('/me/profile-publication',owner,draft,undefined,key);assert.equal(first.status,200);
 const next=await request('/me/profile-publication',owner,{...draft,bio:'new'},first.data.aggregate_version);assert.equal(next.status,200);
 const replay=await request('/me/profile-publication',owner,draft,undefined,key);assert.equal(replay.status,200);assert.equal(replay.data.bio,'new');assert.equal(replay.data.aggregate_version,next.data.aggregate_version);
 assert.equal((await request('/me/profile-publication',owner,draft,first.data.aggregate_version)).status,412);
 const receipt=(await pool.query("SELECT response FROM command_receipts WHERE user_id=$1 AND idempotency_key=$2",[owner.id,key])).rows[0];assert.deepEqual(receipt.response,{updated:true});
});
test('revoked and expired sessions, inactive owner and cross-community reader are rejected',async()=>{
 const owner=await member('Owner'),viewer=await member('Viewer'),expiredViewer=await member('Expired viewer');
 assert.equal((await request('/me/profile-publication',owner,{...draft,visibility:'public',confirm_public:true})).status,200);
 assert.equal((await request(`/public/member-profiles/${owner.id}`)).status,200);
 assert.equal((await request(`/members/${owner.id}/profile`,expiredViewer)).status,200);
 // A valid session still cannot cross community scope; domain read uses the same SQL ACL.
 const {memberVisitorProfile}=await import('../../modules/identity-membership/profile-publication.js');
 await assert.rejects(()=>memberVisitorProfile(pool,{user_id:viewer.id,community_id:randomUUID()} as any,owner.id));
 await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[viewer.id]);
 assert.equal((await request(`/members/${owner.id}/profile`,viewer)).status,401);
 await pool.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[expiredViewer.id]);
 assert.equal((await request(`/members/${owner.id}/profile`,expiredViewer)).status,401);
 assert.equal((await request(`/public/member-profiles/${owner.id}`)).status,200);
 await pool.query('UPDATE users SET active=false WHERE user_id=$1',[owner.id]);
 assert.equal((await request(`/public/member-profiles/${owner.id}`)).status,404);
});
test('late SQL projection rejects a session that expires while its domain query waits',async()=>{
 const owner=await member('Owner'),viewer=await member('Viewer');
 const marker='profile-clock-private-marker';
 assert.equal((await request('/me/profile-publication',owner,{...draft,bio:marker,visibility:'members'})).status,200);
 const path=`/members/${owner.id}/profile`;
 async function blockedRead(expire:boolean){
  const gate=await admin.connect();let pending:ReturnType<typeof request>|undefined;
  try{
   await pool.query('UPDATE sessions SET expires_at=clock_timestamp()+make_interval(secs=>$2) WHERE user_id=$1',[viewer.id,expire?2:300]);
   await gate.query('BEGIN');await gate.query(`LOCK TABLE ${schema}.member_profile_publications IN ACCESS EXCLUSIVE MODE`);
   const holder=(await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   pending=request(path,viewer);const deadline=Date.now()+8000;
   for(;;){
    const waiting=(await admin.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))) AS waiting',[schema,holder])).rows[0].waiting;
    if(waiting)break;assert.ok(Date.now()<deadline,'profile projection must actually wait in PostgreSQL');await setImmediate();
   }
   assert.equal((await pool.query('SELECT expires_at>clock_timestamp() AS active FROM sessions WHERE user_id=$1',[viewer.id])).rows[0].active,true);
   if(expire){
    await pool.query('SELECT pg_sleep(greatest(0,extract(epoch FROM expires_at-clock_timestamp())::double precision)+0.04) FROM sessions WHERE user_id=$1',[viewer.id]);
    assert.equal((await pool.query('SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE user_id=$1',[viewer.id])).rows[0].expired,true);
   }
   await gate.query('ROLLBACK');return await pending;
  }finally{await gate.query('ROLLBACK');gate.release();if(pending)await pending;}
 }
 const expired=await blockedRead(true);assert.equal(expired.status,401);assert.equal(expired.data.code,'session_expired');assert.equal(JSON.stringify(expired.data).includes(marker),false);
 const current=await blockedRead(false);assert.equal(current.status,200);assert.equal(current.data.profile.bio,marker);
});

// Gate the real domain advisory lock, not JavaScript scheduling: both requests
// must be observed waiting in PostgreSQL before either mutation can proceed.
async function competingSaves(owner:Session,expected?:string){
 const keys=[randomUUID(),randomUUID()],bodies=['parallel A','parallel B'].map(bio=>({...draft,bio}));
 assert.equal((await request('/me/profile-publication',owner)).status,200); // warm session presence
 const gate=await admin.connect();let pending:ReturnType<typeof request>[]=[];
 try{
  await gate.query('BEGIN');
  await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`profile-publication/${owner.id}`]);
  const holder=(await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  pending=bodies.map((body,i)=>request('/me/profile-publication',owner,body,expected,keys[i]));
  const deadline=Date.now()+8000;
  for(;;){
   const waiting=Number((await admin.query(`SELECT count(*) AS n FROM pg_stat_activity
    WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))`,[schema,holder])).rows[0].n);
   if(waiting===2)break;
   assert.ok(Date.now()<deadline,'both profile writers must actually wait on the domain lock');await setImmediate();
  }
  await gate.query('ROLLBACK');
  const results=await Promise.all(pending);
  const winner=results.findIndex(result=>result.status===200);
  assert.notEqual(winner,-1);
  const stored=(await pool.query('SELECT bio,aggregate_version::text AS version FROM member_profile_publications WHERE user_id=$1',[owner.id])).rows;
  assert.equal(stored.length,1);assert.equal(stored[0].bio,bodies[winner].bio);
  const receipts=(await pool.query('SELECT idempotency_key,response FROM command_receipts WHERE user_id=$1 AND idempotency_key=ANY($2::text[])',[owner.id,keys])).rows;
  assert.deepEqual(receipts,[{idempotency_key:keys[winner],response:{updated:true}}]);
  return {results,version:stored[0].version};
 }finally{await gate.query('ROLLBACK');gate.release();await Promise.allSettled(pending);}
}
test('parallel first publication commits exactly once and requires a version from the loser',{timeout:30000},async()=>{
 const owner=await member('First publication race'),result=await competingSaves(owner);
 assert.deepEqual(result.results.map(item=>item.status).sort(),[200,428]);assert.equal(result.version,'1');
 const loser=result.results.find(item=>item.status!==200)!;assert.equal(loser.data.code,'version_required');
 assert.equal(Number((await pool.query("SELECT count(*) AS n FROM transition_journal WHERE aggregate_id=$1 AND command='save_profile_publication'",[owner.id])).rows[0].n),1);
});
test('parallel updates with the same If-Match commit one winner and roll back stale receipt/journal',{timeout:30000},async()=>{
 const owner=await member('Update race'),first=await request('/me/profile-publication',owner,draft);assert.equal(first.status,200);
 const result=await competingSaves(owner,first.data.aggregate_version);
 assert.deepEqual(result.results.map(item=>item.status).sort(),[200,412]);assert.equal(result.version,'2');
 assert.equal(result.results.find(item=>item.status===412)!.data.code,'version_conflict');
 assert.equal(Number((await pool.query("SELECT count(*) AS n FROM transition_journal WHERE aggregate_id=$1 AND command='save_profile_publication'",[owner.id])).rows[0].n),2);
});
test('synthetic restricted runtime role saves, reads, replays and revokes publication without DDL privileges',{timeout:30000},async()=>{
 // This verifies an explicit synthetic grant set, NOT deployed application grants.
 const owner=await member('Restricted profile owner'),role=`fp_profile_role_${process.pid}_${Date.now()}`;
 const {authenticate}=await import('../../modules/identity-membership/service.js');
 const {saveProfilePublication,publicVisitorProfile,profilePublicationSettings}=await import('../../modules/identity-membership/profile-publication.js');
 const actor=await authenticate(pool,owner.cookie.slice(owner.cookie.indexOf('=')+1));
 let runtime:Pool|undefined;
 await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
 try{
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  // UPDATE is required by PostgreSQL SELECT ... FOR SHARE, even on auth rows.
  await admin.query(`GRANT SELECT,UPDATE ON ${schema}.users,${schema}.sessions TO ${role}`);
  await admin.query(`GRANT SELECT,INSERT,UPDATE ON ${schema}.member_profile_publications TO ${role}`);
  await admin.query(`GRANT SELECT,INSERT ON ${schema}.command_receipts,${schema}.transition_journal TO ${role}`);
  await admin.query(`GRANT SELECT ON ${['member_account_classification','member_profile_cover_versions','assets','resource_scopes','principals'].map(table=>schema+'.'+table).join(',')} TO ${role}`);
  runtime=new Pool({connectionString:database,options:`-c search_path=${schema} -c role=${role}`,max:3});
  assert.equal((await runtime.query('SELECT current_user AS name')).rows[0].name,role);
  assert.equal((await runtime.query('SELECT rolsuper OR rolbypassrls OR rolcreaterole AS elevated FROM pg_roles WHERE rolname=current_user')).rows[0].elevated,false);
  const input={actor,operation:'profile.publication.synthetic',body:{...draft,visibility:'public',confirm_public:true},key:randomUUID()};
  const saved=await saveProfilePublication(runtime,input);assert.equal(saved.aggregate_version,'1');
  assert.equal((await publicVisitorProfile(runtime,owner.id)).bio,draft.bio);
  assert.equal((await saveProfilePublication(runtime,input)).aggregate_version,'1');
  const revoked=await saveProfilePublication(runtime,{...input,key:randomUUID(),body:{...input.body,visibility:'private'},expected:'1'});
  assert.equal(revoked.aggregate_version,'2');assert.equal((await profilePublicationSettings(runtime,actor)).visibility,'private');
  await assert.rejects(()=>publicVisitorProfile(runtime!,owner.id),(error:any)=>error.status===404);
  await assert.rejects(()=>runtime!.query('ALTER TABLE member_profile_publications ADD COLUMN forbidden boolean'),(error:any)=>error.code==='42501');
  await assert.rejects(()=>runtime!.query('TRUNCATE member_profile_publications'),(error:any)=>error.code==='42501');
 }finally{await runtime?.end();await admin.query(`DROP OWNED BY ${role}`);await admin.query(`DROP ROLE ${role}`);}
});
