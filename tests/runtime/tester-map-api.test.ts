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
test('feedback upserts once; reports are public, deduplicate testers, hide identities and isolate communities',async()=>{
 const member=await login(0),peer=await login(1);const step=testerFeatureSteps[0];
 assert.equal((await feedback(member,step.step_id)).status,200);
 assert.equal((await feedback(peer,step.step_id,'pass','')).status,200);
 assert.equal((await feedback(member,step.step_id,'problem','Latest problem')).status,200);
 assert.equal((await pool.query('SELECT count(*) n FROM tester_map_feedback')).rows[0].n,'2');
 assert.equal((await request('/tester-map/report')).status,200);
 assert.equal((await request('/tester-map/report',peer)).data.can_triage,false);
 await builder(peer);const report=await request('/tester-map/report',peer);assert.equal(report.status,200);
 const feature=report.data.features.find((f:any)=>f.feature_id===step.feature_id);assert.equal(feature.testers,2);assert.equal(feature.pass_rate,0.5);assert.equal(feature.issues[0].note,'Latest problem');
 assert.doesNotMatch(JSON.stringify(report.data),new RegExp(`${member.id}|${peer.id}|"user_id":|"email":|"display_name":`));
 const raw=(await pool.query('SELECT user_id,step_id,result,note,updated_at FROM tester_map_feedback')).rows.map(row=>({...row,updated_at:row.updated_at.toISOString()}));
 assert.deepEqual(report.data.features.map(({issues,module_id,steps,...row}:any)=>row),aggregateTesterFeedback(raw).map(({issues,...row})=>row).sort((a,b)=>a.feature_id.localeCompare(b.feature_id)));
 assert.equal((await request(path,peer)).data.can_report,true);
 await pool.query("UPDATE positioning_profession_memberships SET member_tier='intern' WHERE user_id=$1 AND guild_key='guild_platform_engineering'",[peer.id]);
 assert.equal((await request('/tester-map/report',peer)).data.can_triage,false);
 assert.equal((await request(path,peer)).data.can_report,false);
 const foreign=randomUUID(),user=randomUUID();
 await pool.query("INSERT INTO communities(community_id,name) VALUES($1,'Synthetic foreign community')",[foreign]);
 await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref)
 SELECT $1,$2,'foreign@example.test','Synthetic',password_hash,$3 FROM users WHERE user_id=$4`,[user,foreign,randomUUID(),member.id]);
 await pool.query("INSERT INTO tester_map_feedback(user_id,step_id,result,note) VALUES($1,$2,'problem','Foreign private note')",[user,step.step_id]);
 await builder(peer);
 const foreignItem=(await pool.query('SELECT feedback_id FROM tester_map_feedback WHERE user_id=$1',[user])).rows[0].feedback_id;
 assert.equal((await request('/tester-map/report/triage',peer,{feedback_id:foreignItem,version:'stale',status:'seen'})).status,404);
 const isolated=await request('/tester-map/report',peer);assert.equal(isolated.status,200);assert.doesNotMatch(JSON.stringify(isolated.data),/Foreign private note/);
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

test('opaque triage requires current builder authority; status is public, edits reset it and passing preserves Issue history',async()=>{
 const member=await login(0),peer=await login(1),step=testerFeatureSteps[0];
 await feedback(member,step.step_id);
 await builder(peer);
 const report=await request('/tester-map/report',peer),feature=report.data.features.find((f:any)=>f.feature_id===step.feature_id);
 const item=feature.steps.find((s:any)=>s.step_id===step.step_id).items[0];
 assert.match(item.feedback_id,/^[0-9a-f-]{36}$/);
 const triage='/tester-map/report/triage',body={feedback_id:item.feedback_id,version:item.version,status:'seen',issue_number:null};
 assert.equal((await request(triage,member,body)).status,403);
 assert.equal((await request(triage,peer,{...body,user_id:member.id})).status,422);
 assert.equal((await request(triage,peer,{...body,status:'issue'})).status,422);
 assert.equal((await request(triage,peer,{...body,status:'issue',issue_number:0})).status,422);
 assert.equal((await request(triage,peer,{...body,feedback_id:randomUUID()})).status,404);
 const key=randomUUID();
 let fixed:any;
 for(const status of ['seen','issue','fixed']){
   const latest=(await request('/tester-map/report',peer)).data.features.flatMap((f:any)=>f.steps).flatMap((s:any)=>s.items).find((i:any)=>i.feedback_id===item.feedback_id);
   const next={...body,version:latest.version,status,issue_number:status==='seen'?null:1213};
   if(status==='fixed')fixed=next;
   assert.equal((await request(triage,peer,next,undefined,status==='fixed'?key:randomUUID())).status,200);
   const own=(await request(path,member)).data.feedback[0];assert.equal(own.status,status);assert.equal(own.issue_number,next.issue_number);
   assert.deepEqual((await request(path,peer)).data.feedback,[]);
 }
 assert.equal((await request(triage,peer,fixed,undefined,key)).status,200);
 assert.equal((await pool.query("SELECT count(*) n FROM transition_journal WHERE aggregate_type='tester_map_feedback'")).rows[0].n,'3');
 await feedback(member,step.step_id,'problem','Button did not open');
 assert.equal((await request(path,member)).data.feedback[0].status,'fixed');
 await feedback(member,step.step_id,'problem','Changed note');
 let own=(await request(path,member)).data.feedback[0];assert.equal(own.status,'sent');assert.equal(own.issue_number,1213);
 assert.equal((await pool.query('SELECT triaged_at FROM tester_map_feedback WHERE feedback_id=$1',[item.feedback_id])).rows[0].triaged_at,null);
 const latest=(await request('/tester-map/report',peer)).data.features.flatMap((f:any)=>f.steps).flatMap((s:any)=>s.items).find((i:any)=>i.feedback_id===item.feedback_id);
 assert.equal((await request(triage,peer,{...body,version:latest.version,status:'issue',issue_number:1213})).status,200);
 await feedback(member,step.step_id,'pass','Changed note');
 own=(await request(path,member)).data.feedback[0];assert.equal(own.status,'issue');assert.equal(own.issue_number,1213);
 // An old successful receipt cannot reapply a triage after a tester edit.
 assert.equal((await request(triage,peer,fixed,undefined,key)).status,200);
 assert.equal((await request(path,member)).data.feedback[0].status,'issue');
 const filtered=await request('/tester-map/report?module='+feature.module_id,peer);assert.equal(filtered.status,200);
 assert.deepEqual(filtered.data.modules.map((m:any)=>m.module_id),[feature.module_id]);
 assert.ok(filtered.data.features.every((f:any)=>f.module_id===feature.module_id));
 assert.equal((await request('/tester-map/report?module=unknown',peer)).status,422);
 assert.equal((await request('/tester-map/report?module=',peer)).status,422);
 const publicReport=JSON.stringify((await request('/tester-map/report',peer)).data);
 assert.doesNotMatch(publicReport,new RegExp(`${member.id}|${peer.id}|"user_id"|"email"|"name"|"display_name"`));
 await pool.query("UPDATE positioning_profession_memberships SET state='left' WHERE user_id=$1 AND guild_key='guild_platform_engineering'",[peer.id]);
 assert.equal((await request(triage,peer,fixed,undefined,key)).status,403);
});

async function reportItem(id:string,s?:Session){
 const report=await request('/tester-map/report',s);
 return report.data.features.flatMap((f:any)=>f.steps).flatMap((step:any)=>step.items).find((item:any)=>item.feedback_id===id);
}
test('public anonymous report exposes content and Issue links without account data; personal progress remains owner-only',async()=>{
 const member=await login(0),reader=await login(1),step=QUEST_STEP_IDS[0];
 await request(path,member,merge([step],'E'));await feedback(member,step,'problem','Public synthetic note');
 const id=(await pool.query('SELECT feedback_id FROM tester_map_feedback WHERE user_id=$1',[member.id])).rows[0].feedback_id;
 await pool.query("UPDATE tester_map_feedback SET status='issue',issue_number=1213 WHERE feedback_id=$1",[id]);
 for(const session of [undefined,reader]){
   const report=await request('/tester-map/report',session);assert.equal(report.status,200);assert.equal(report.data.can_triage,false);
   const item=await reportItem(id,session);assert.equal(item.note,'Public synthetic note');assert.equal(item.result,'problem');assert.equal(item.status,'issue');assert.equal(item.issue_number,1213);assert.ok(item.version);
   const json=JSON.stringify(report.data);assert.doesNotMatch(json, new RegExp(`${member.id}|${reader.id}|${DEMO_USERS[0].email}|"user_id"|"email"|"display_name"|"group"|"done"|"tester_id"`));
 }
 const item=await reportItem(id,reader);
 assert.equal((await request('/tester-map/report/triage',reader,{feedback_id:id,version:item.version,status:'seen'})).status,403);
 assert.deepEqual((await request(path+'?user_id='+member.id,reader)).data.progress,{group:null,done:[]});
 assert.equal((await request('/users/'+member.id+'/tester-map',reader)).status,404);
 assert.equal((await request(path+'?user_id='+member.id)).status,401);
 await builder(reader);assert.equal((await request('/tester-map/report',reader)).data.can_triage,true);
});
test('open problems survive newer passes and fixed problems; bounds and module totals apply without duplicate steps',async()=>{
 const member=await login(0),step='arrival.register';
 // 102 unresolved problems, 7 fixed problems, then 8 newer passes.
 for(let n=0;n<117;n++){
   const user=randomUUID();await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref)
     SELECT $1,community_id,$2,'Synthetic tester',password_hash,$3 FROM users WHERE user_id=$4`,[user,`bounded-${n}@example.test`,randomUUID(),member.id]);
   await pool.query(`INSERT INTO tester_map_feedback(user_id,step_id,result,note,status,updated_at)
     VALUES($1,$2,$3,$4,$5,'2026-11-01'::timestamptz+$6*interval '1 second')`,[user,step,n<109?'problem':'pass',`bounded ${n}`,n>=102&&n<109?'fixed':'sent',n]);
 }
 const report=await request('/tester-map/report');assert.equal(report.status,200);
 const modules=report.data.modules.filter((m:any)=>m.features.some((f:any)=>f.steps.some((s:any)=>s.step_id===step)));
 assert.ok(modules.length>0);
 for(const module of modules){
   const steps=module.features.flatMap((f:any)=>f.steps),items=steps.flatMap((s:any)=>s.items);
   assert.equal(new Set(items.map((i:any)=>i.feedback_id)).size,items.length);
   const shared=steps.find((s:any)=>s.step_id===step);assert.equal(shared.items.length,105);assert.equal(shared.passed,8);assert.equal(shared.problems,109);
   assert.equal(shared.items.slice(0,100).every((i:any)=>i.result==='problem'&&i.status!=='fixed'),true);
   assert.equal(shared.items.slice(100).every((i:any)=>i.result==='pass'),true);
   assert.equal(module.passed,8);assert.equal(module.problems,109);
   const feature=module.features.find((f:any)=>f.steps.some((s:any)=>s.step_id===step));assert.equal(feature.issues.length,105);
   assert.equal(feature.issues.slice(0,100).every((i:any)=>i.status!=='fixed'),true);
   assert.equal(feature.issues.slice(100).every((i:any)=>i.status==='fixed'),true);
   assert.ok(feature.issues.every((i:any)=>typeof i.version==='string'));
   const filtered=await request('/tester-map/report?module='+module.module_id);
   assert.deepEqual(filtered.data.modules,[module]);
 }
 assert.ok(modules.some((m:any)=>m.features.flatMap((f:any)=>f.steps).find((s:any)=>s.step_id===step).feature_ids.length>1));
});
test('triage rejects stale tester edits and stale triage versions under the feedback lock, without mutation',async()=>{
 const member=await login(0),peer=await login(1),step=QUEST_STEP_IDS[0];await builder(peer);await feedback(member,step);
 const id=(await pool.query('SELECT feedback_id FROM tester_map_feedback WHERE user_id=$1',[member.id])).rows[0].feedback_id;
 const old=await reportItem(id,peer),body={feedback_id:id,version:old.version,status:'fixed',issue_number:1213};
 assert.equal((await request('/tester-map/report/triage',peer,{feedback_id:id,status:'seen'})).status,422);
 // A real competing update holds the row lock while stale triage starts.
 const q=await pool.connect();await q.query('BEGIN');await q.query("UPDATE tester_map_feedback SET note='New feedback',updated_at=clock_timestamp() WHERE feedback_id=$1",[id]);
 try{
   const saving=request('/tester-map/report/triage',peer,body);
   // Observe the actual waiter rather than depending on a sleep to prove ordering.
   let waiting=false;
   for(let n=0;n<100&&!waiting;n++){
     waiting=(await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF f%'" )).rowCount!>0;
     if(!waiting)await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.equal(waiting,true);await q.query('COMMIT');
   const rejected=await saving;assert.equal(rejected.status,409);assert.equal(rejected.data.code,'tester_feedback_conflict');
 }finally{await q.query('ROLLBACK');q.release();}
 let current=await reportItem(id,peer);assert.equal(current.note,'New feedback');assert.equal(current.status,'sent');assert.notEqual(current.version,old.version);
 const next={...body,version:current.version,status:'seen'};assert.equal((await request('/tester-map/report/triage',peer,next)).status,200);
 const stale=await request('/tester-map/report/triage',peer,{...next,status:'fixed'});assert.equal(stale.status,409);assert.equal(stale.data.code,'tester_feedback_conflict');
 current=await reportItem(id,peer);assert.equal(current.status,'seen');
 assert.equal((await pool.query("SELECT count(*) n FROM transition_journal WHERE aggregate_type='tester_map_feedback'")).rows[0].n,'1');
});
test('pass re-testing preserves issue/fixed status and triage history; other edits reset sent but retain Issue number',async()=>{
 const member=await login(0),peer=await login(1),step=QUEST_STEP_IDS[0];await builder(peer);
 for(const status of ['issue','fixed']){
   await feedback(member,step,'problem','Before retest');
   const id=(await pool.query('SELECT feedback_id FROM tester_map_feedback WHERE user_id=$1',[member.id])).rows[0].feedback_id;
   const item=await reportItem(id,peer);
   assert.equal((await request('/tester-map/report/triage',peer,{feedback_id:id,version:item.version,status,issue_number:1213})).status,200);
   const before=(await pool.query('SELECT triaged_at::text FROM tester_map_feedback WHERE feedback_id=$1',[id])).rows[0].triaged_at;
   assert.equal((await feedback(member,step,'pass','Retest passed')).status,200);
   let own=(await request(path,member)).data.feedback[0];assert.equal(own.status,status);assert.equal(own.issue_number,1213);
   assert.equal((await pool.query('SELECT triaged_at::text FROM tester_map_feedback WHERE feedback_id=$1',[id])).rows[0].triaged_at,before);
   await feedback(member,step,'pass','Edited pass note');own=(await request(path,member)).data.feedback[0];assert.equal(own.status,'sent');assert.equal(own.issue_number,1213);
 }
});

test('public report follows configured site community and fails closed when the default community is ambiguous',async()=>{
 const member=await login(0),step=QUEST_STEP_IDS[0];await feedback(member,step,'problem','Site community note');
 const foreign=randomUUID(),foreignUser=randomUUID();await pool.query("INSERT INTO communities(community_id,name) VALUES($1,'Other site')",[foreign]);
 await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref)
   SELECT $1,$2,'other-site@example.test','Other site tester',password_hash,$3 FROM users WHERE user_id=$4`,[foreignUser,foreign,randomUUID(),member.id]);
 await pool.query("INSERT INTO tester_map_feedback(user_id,step_id,result,note) VALUES($1,$2,'problem','Other site note')",[foreignUser,step]);
 const ambiguous=await request('/tester-map/report');assert.equal(ambiguous.status,200);assert.deepEqual(ambiguous.data.features,[]);assert.equal(ambiguous.data.can_triage,false);
 const configured=createApp(pool,origin,'local',{registrationCommunityId:DEMO_COMMUNITY});
 const response=await configured.request(origin+'/api/v1/tester-map/report');assert.equal(response.status,200);
 const json=JSON.stringify(await response.json());assert.match(json,/Site community note/);assert.doesNotMatch(json,/Other site note|Other site tester|other-site@example.test/);
});
