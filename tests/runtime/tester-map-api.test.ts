import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {QUEST_STEP_IDS} from '../../modules/tester-map/index.js';
import {testerFeatureSteps,aggregateTesterFeedback} from '../../modules/tester-map/account.js';
const databaseUrl=process.env.TEST_DATABASE_URL;
if(!databaseUrl)throw new Error('Tester map tests require an explicit disposable TEST_DATABASE_URL');
const target=new URL(databaseUrl);
if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!/^\/fp_[a-zA-Z0-9_]+$/.test(target.pathname)||target.search)throw new Error('Tester map tests require a local fp_* database without query overrides');
const schema=`fp_tester_map_${process.pid}_${Date.now()}`,admin=new Pool({connectionString:databaseUrl});
const pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema}`,max:8});
const origin='http://127.0.0.1:4315',app=createApp(pool,origin,'local');
type Session={cookie:string;csrf:string;id:string};
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
async function login(index:number):Promise<Session>{
 const response=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:DEMO_USERS[index].email,password:DEMO_PASSWORD})});
 assert.equal(response.status,200);const data=await response.json() as any;
 return {cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:data.csrf_token,id:data.user.user_id};
}
async function request(path:string,s?:Session,body?:unknown,version?:string,key:string=randomUUID(),extra:Record<string,string>={}){
 const headers:Record<string,string>={Origin:origin,...(s?{Cookie:s.cookie,'X-CSRF-Token':s.csrf}:{})};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;if(version!==undefined)headers['If-Match']=`"${version}"`;}
 const response=await app.request(origin+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{...headers,...extra},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,headers:response.headers,data:await response.json() as any};
}
const path='/me/tester-map';
const merge=(done:string[],group:string|null=null)=>({action:'merge',group,done});
async function feedback(s:Session,step_id:string,result='problem',note='Button did not open') {
 const view=await request(path,s);return request(path,s,{action:'feedback',step_id,result,note},view.data.version);
}
async function builder(s:Session){
 await pool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier)
 VALUES($3,$1,$2,'guild_platform_engineering','active','full')
 ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active',member_tier='full'`,[DEMO_COMMUNITY,s.id,randomUUID()]);
}
test('anonymous, CSRF, Origin, strict validation and idempotency boundaries',async()=>{
 const member=await login(0);
 assert.equal((await request(path)).status,401);
 assert.equal((await request(path,member,merge([]),undefined,randomUUID(),{'X-CSRF-Token':'bad'})).status,403);
 assert.equal((await request(path,member,merge([]),undefined,randomUUID(),{Origin:'https://example.test'})).status,403);
 assert.equal((await request(path,member,merge([]),undefined,'')).status,400);
 for(const body of [merge(['unknown']),{...merge([]),user_id:'peer'},{action:'feedback',step_id:QUEST_STEP_IDS[0],result:'problem',note:'x'.repeat(201)},{action:'feedback',step_id:QUEST_STEP_IDS[0],result:'pass',note:'a\nb'}])assert.equal((await request(path,member,body,'1')).status,422);
 assert.equal((await request(path,member,{action:'clear'})).status,428);
 const read=await request(path,member);assert.equal(read.headers.get('cache-control'),'private, no-store');assert.deepEqual(read.data.progress.done,[]);
});
test('concurrent device union is idempotent and self-only; stale edits cannot overwrite another device',async()=>{
 const member=await login(0),peer=await login(1),[a,b,c]=QUEST_STEP_IDS,key=randomUUID();
 const responses=await Promise.all([request(path,member,merge([a,b,a],'A'),undefined,key),request(path,member,merge([b,c],'B'))]);
 assert.deepEqual(responses.map(r=>r.status),[200,200]);
 const current=await request(path,member);assert.deepEqual(current.data.progress.done,[a,b,c]);
 const replay=await request(path,member,merge([a,b,a],'A'),undefined,key);assert.equal(replay.status,200);
 assert.equal((await request(path,member)).data.version,current.data.version);
 assert.deepEqual((await request(path,peer)).data.progress.done,[]);
 assert.equal((await request(path,member,{action:'progress',group:null,done:[a]},'1')).status,412);
 assert.equal((await request(path,member,merge([a]),undefined,key)).status,409);
});
test('feedback upserts once; reports require current builder permission, deduplicate testers, hide identities and isolate communities',async()=>{
 const member=await login(0),peer=await login(1);const step=testerFeatureSteps[0];
 assert.equal((await feedback(member,step.step_id)).status,200);
 assert.equal((await feedback(peer,step.step_id,'pass','')).status,200);
 assert.equal((await feedback(member,step.step_id,'problem','Latest problem')).status,200);
 assert.equal((await pool.query('SELECT count(*) n FROM tester_map_feedback')).rows[0].n,'2');
 assert.equal((await request('/tester-map/report')).status,401);
 assert.equal((await request('/tester-map/report',peer)).status,403);
 await builder(peer);const report=await request('/tester-map/report',peer);assert.equal(report.status,200);
 const feature=report.data.features.find((f:any)=>f.feature_id===step.feature_id);assert.equal(feature.testers,2);assert.equal(feature.pass_rate,0.5);assert.equal(feature.issues[0].note,'Latest problem');
 assert.doesNotMatch(JSON.stringify(report.data),new RegExp(`${member.id}|${peer.id}|"user_id":|"email":|"display_name":`));
 const raw=(await pool.query('SELECT user_id,step_id,result,note,updated_at FROM tester_map_feedback')).rows.map(row=>({...row,updated_at:row.updated_at.toISOString()}));
 assert.deepEqual(report.data.features.map(({issues,...row}:any)=>row),aggregateTesterFeedback(raw).map(({issues,...row})=>row).sort((a,b)=>a.feature_id.localeCompare(b.feature_id)));
 assert.equal((await request(path,peer)).data.can_report,true);
 await pool.query("UPDATE positioning_profession_memberships SET member_tier='intern' WHERE user_id=$1 AND guild_key='guild_platform_engineering'",[peer.id]);
 assert.equal((await request('/tester-map/report',peer)).status,403);
 assert.equal((await request(path,peer)).data.can_report,false);
 const foreign=randomUUID(),user=randomUUID();
 await pool.query("INSERT INTO communities(community_id,name) VALUES($1,'Synthetic foreign community')",[foreign]);
 await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref)
 SELECT $1,$2,'foreign@example.test','Synthetic',password_hash,$3 FROM users WHERE user_id=$4`,[user,foreign,randomUUID(),member.id]);
 await pool.query("INSERT INTO tester_map_feedback(user_id,step_id,result,note) VALUES($1,$2,'problem','Foreign private note')",[user,step.step_id]);
 await builder(peer);const isolated=await request('/tester-map/report',peer);assert.equal(isolated.status,200);assert.doesNotMatch(JSON.stringify(isolated.data),/Foreign private note/);
});
test('clear deletes feedback and progress; old ACK replay cannot restore them; account deletion cascades',async()=>{
 const member=await login(0),key=randomUUID();await request(path,member,merge([QUEST_STEP_IDS[0]]),undefined,key);await feedback(member,QUEST_STEP_IDS[0]);
 const current=await request(path,member);assert.equal((await request(path,member,{action:'clear'},current.data.version)).status,200);
 assert.equal((await request(path,member,merge([QUEST_STEP_IDS[0]]),undefined,key)).status,200);
 const cleared=await request(path,member);assert.deepEqual(cleared.data.progress.done,[]);assert.deepEqual(cleared.data.feedback,[]);
 assert.doesNotMatch(JSON.stringify((await pool.query("SELECT response FROM command_receipts WHERE operation LIKE '%tester-map%'")).rows),/note|step_id|done/);
 await feedback(member,QUEST_STEP_IDS[0]);
 const disposable=randomUUID();
 await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref)
 SELECT $1,community_id,'cascade@example.test','Synthetic cascade',password_hash,$2 FROM users WHERE user_id=$3`,[disposable,randomUUID(),member.id]);
 await pool.query('INSERT INTO tester_map_accounts(user_id) VALUES($1)',[disposable]);
 await pool.query("INSERT INTO tester_map_feedback(user_id,step_id,result) VALUES($1,$2,'pass')",[disposable,QUEST_STEP_IDS[0]]);
 await pool.query('DELETE FROM users WHERE user_id=$1',[disposable]);
 assert.equal((await pool.query('SELECT count(*) n FROM tester_map_feedback WHERE user_id=$1',[disposable])).rows[0].n,'0');
 assert.equal((await pool.query('SELECT count(*) n FROM tester_map_accounts WHERE user_id=$1',[disposable])).rows[0].n,'0');
});
test('revoked sessions cannot read or replay a recorded command',async()=>{
 const member=await login(0),key=randomUUID();await request(path,member,merge([]),undefined,key);
 await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[member.id]);
 assert.equal((await request(path,member)).status,401);assert.equal((await request(path,member,merge([]),undefined,key)).status,401);
});
