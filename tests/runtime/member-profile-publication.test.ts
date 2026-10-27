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
