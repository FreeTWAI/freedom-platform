/** Real PostgreSQL/HTTP tests. Requires an operator-provisioned disposable test DB. */
import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {sampleGuildAnswers} from '../../modules/positioning/guild-questions.js';
import {createAdminAccessVerifier} from '../../modules/platform-admin/access.js';
const database=process.env.TEST_DATABASE_URL;
if(!database)throw new Error('Explicit operator-provisioned disposable TEST_DATABASE_URL required; no default database');
const url=new URL(database);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!url.pathname.startsWith('/fp_'))throw new Error('Disposable loopback fp_ database required');
const schema=`fp_cert_${process.pid}_${Date.now()}`,db=createPool(database),pool=new Pool({connectionString:database,options:`-c search_path=${schema}`,application_name:schema,max:12});
const origin='http://127.0.0.1:4310',issuer='https://cert-test.cloudflareaccess.com',audience='certification-tests',pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey);
const verify=createAdminAccessVerifier({issuer,audience,csrfSecret:'synthetic-certification-csrf-secret-123456789',keySet:createLocalJWKSet({keys:[{...jwk,kid:'test',alg:'RS256'}]})});
const app=createApp(pool,origin,'local',{adminVerifier:verify,communityCertificationEnabled:true});
type Member={cookie:string;csrf:string;id:string;email:string;community:string};
type Admin={member:Member;id:string;jwt:string;csrf:string};
const application={statement:'我持續參與社群討論與協作，申請人工審核。',acknowledged:true};
const review={decision:'approve',reason:'已由管理員人工檢視社群參與。',confirmed:true};
before(async()=>{await db.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
async function request(path:string,member?:Member,body?:unknown,version?:number,key:string=randomUUID(),admin?:Admin,extra:Record<string,string>={}){
 const headers:Record<string,string>={Origin:origin,...(member?{Cookie:member.cookie,'X-CSRF-Token':member.csrf}:{}),...(admin?{'Cf-Access-Jwt-Assertion':admin.jwt,'X-Admin-CSRF':admin.csrf}:{})};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;if(version!==undefined)headers['If-Match']=`"${version}"`;}
 Object.assign(headers,extra);
 const response=await app.request(origin+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,data:await response.json() as any,response};
}
const own=(member:Member,body?:unknown,version?:number,key?:string,action='apply')=>request('/api/v1/me/community-certification'+(body===undefined?'':`/${action}`),member,body,version,key);
async function member(name:string):Promise<Member>{
 const email=`${randomUUID()}@example.test`;const result=await request('/api/v1/auth/register',undefined,{email,nickname:name,password:'community-certification-password'});assert.equal(result.status,201,JSON.stringify(result.data));
 const value={cookie:result.response.headers.get('set-cookie')!.split(';')[0],csrf:result.data.csrf_token,id:result.data.user.user_id,email,community:result.data.user.community_id};
 assert.equal((await request('/api/v1/me/onboarding/quick-start',value,{guild_keys:['guild_ai_vibe'],primary_guild_key:'guild_ai_vibe',confirmed:true,guild_answers:sampleGuildAnswers('guild_ai_vibe')})).status,200);
 value.community=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[value.id])).rows[0].community_id;return value;
}
async function sign(email:string,expires=600){const now=Math.floor(Date.now()/1000);return new SignJWT({type:'app',email,sub:`human:${email}`,iss:issuer,aud:audience,iat:now,nbf:now,exp:now+expires}).setProtectedHeader({alg:'RS256',kid:'test'}).sign(pair.privateKey);}
async function administrator(name='Reviewer'):Promise<Admin>{
 const m=await member(name),id=randomUUID(),jwt=await sign(m.email);await pool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)',[id,m.community,m.email,name]);
 const csrf=(await verify(new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':jwt}}))).csrfToken;return {member:m,id,jwt,csrf};
}
const decide=(admin:Admin,subject:Member,body=review,version=2,key?:string,session:Member|undefined=admin.member)=>request(`/admin/api/community-certifications/${subject.id}/review`,session,body,version,key,admin);
async function state(member:Member){return (await own(member)).data;}
async function apply(member:Member){const result=await own(member,application,1);assert.equal(result.status,200,JSON.stringify(result.data));return result.data;}
async function count(table:string){return Number((await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);}
test('initial virtual CAS, application, explicit display opt-in and manual approval',async()=>{
 const m=await member('Applicant'),a=await administrator();assert.equal((await state(m)).aggregate_version,1);assert.equal(await count('member_community_certifications'),0);
 assert.equal((await own(m,application)).status,428);assert.equal((await own(m,application,4)).status,412);
 const pending=await apply(m);assert.equal(pending.state,'pending');assert.equal(pending.show_community_certification,false);
 assert.equal((await decide(a,m)).status,200);let current=await state(m);assert.equal(current.state,'active');assert.equal(current.show_community_certification,false);
 const display=await own(m,{show_community_certification:true},current.aggregate_version,undefined,'display');assert.equal(display.status,200);assert.equal(display.data.state,'active');assert.equal(display.data.show_community_certification,true);
 assert.deepEqual(Object.keys(current).sort(),['aggregate_version','policy_version','show_community_certification','state','statement']);
 assert.equal((await own(m)).response.headers.get('cache-control'),'private, no-store');
});
test('display first never grants certification and first-use races honor CAS',async()=>{
 const m=await member('Applicant');const results=await Promise.all([own(m,{show_community_certification:true},1,undefined,'display'),own(m,application,1)]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,412]);assert.equal(await count('member_community_certifications'),1);assert.notEqual((await state(m)).state,'active');
});
test('member and admin security envelopes reject missing credentials and forged authority',async()=>{
 const m=await member('Applicant'),a=await administrator();await apply(m);
 assert.equal((await request('/api/v1/me/community-certification')).status,401);
 assert.equal((await request('/api/v1/me/community-certification/display',m,{show_community_certification:true},2,undefined,undefined,{'X-CSRF-Token':'wrong'})).status,403);
 assert.equal((await request(`/admin/api/community-certifications/${m.id}/review`,a.member,review,2)).status,401);
 assert.equal((await request(`/admin/api/community-certifications/${m.id}/review`,a.member,review,2,undefined,a,{'X-Admin-CSRF':'wrong'})).status,403);
 assert.equal((await own(m,{...application,state:'active'},2)).status,422);
 assert.equal((await request(`/admin/api/community-certifications/${m.id}/review`,undefined,review,2,undefined,a)).status,409);
 assert.equal((await decide(a,m,review,2,undefined,m)).status,403);
});
test('self-review is denied using current Access plus actual member identity',async()=>{
 const a=await administrator();await apply(a.member);assert.equal((await decide(a,a.member)).status,403);assert.equal((await state(a.member)).state,'pending');assert.equal(await count('platform_admin_audit'),0);
});
test('CAS, concurrent reviewers and private audit are atomic; queue omits reason',async()=>{
 const m=await member('Applicant'),a=await administrator('A'),b=await administrator('B');await apply(m);
 const responses=await Promise.all([decide(a,m),decide(b,m)]);assert.deepEqual(responses.map(x=>x.status).sort(),[200,412]);assert.equal(await count('platform_admin_audit'),1);assert.equal(await count('platform_admin_receipts'),1);
 const queue=await request('/admin/api/community-certifications?state=active',undefined,undefined,undefined,undefined,a);assert.equal(queue.status,200);assert.equal(queue.data.items[0].user_id,m.id);assert.equal(JSON.stringify(queue.data).includes(review.reason),false);assert.equal('reviewed_by' in queue.data.items[0],false);
});
test('lost-response replay never regrants a revoked certification or duplicates audit',async()=>{
 const m=await member('Applicant'),a=await administrator(),key=randomUUID();await apply(m);assert.equal((await decide(a,m,review,2,key)).status,200);
 assert.equal((await decide(a,m,{...review,decision:'revoke'},3)).status,200);assert.equal((await decide(a,m,review,2,key)).status,200);
 assert.equal((await state(m)).state,'revoked');assert.equal(await count('platform_admin_audit'),2);
 assert.equal((await decide(a,m,{...review,reason:'Changed reason'},2,key)).status,409);
 const receipt=(await pool.query('SELECT response FROM platform_admin_receipts WHERE idempotency_key=$1',[key])).rows[0].response;assert.deepEqual(receipt,{updated:true});
});
test('member replay reads current state without storing application text in receipt',async()=>{
 const m=await member('Applicant'),key=randomUUID();assert.equal((await own(m,application,1,key)).status,200);assert.equal((await own(m,{confirmed:true},2,undefined,'withdraw')).status,200);
 const replay=await own(m,application,1,key);assert.equal(replay.status,200);assert.equal(replay.data.state,'withdrawn');
 assert.deepEqual((await pool.query('SELECT response FROM command_receipts WHERE idempotency_key=$1',[key])).rows[0].response,{updated:true});
 await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[m.id]);assert.equal((await own(m,application,1,key)).status,401);
});
test('current admin authority is required before replay',async()=>{
 const m=await member('Applicant'),a=await administrator(),key=randomUUID();await apply(m);assert.equal((await decide(a,m,review,2,key)).status,200);
 await pool.query('UPDATE platform_admins SET active=false WHERE admin_id=$1',[a.id]);assert.equal((await decide(a,m,review,2,key)).status,403);
});
test('reject, resubmit, withdraw and revoke keep a monotonic aggregate and require a fresh review',async()=>{
 const m=await member('Applicant'),a=await administrator();await apply(m);assert.equal((await decide(a,m,{...review,decision:'reject'})).status,200);
 let result=await own(m,application,3);assert.equal(result.status,200);assert.equal(result.data.state,'pending');assert.equal(result.data.aggregate_version,4);
 assert.equal((await decide(a,m,review,4)).status,200);result=await own(m,{confirmed:true},5,undefined,'withdraw');assert.equal(result.data.state,'withdrawn');
 result=await own(m,application,6);assert.equal(result.data.state,'pending');assert.equal(result.data.aggregate_version,7);
});
test('audit failure rolls back the certification and success receipt together',async()=>{
 const m=await member('Applicant'),a=await administrator();await apply(m);const key=randomUUID();
 await pool.query("CREATE FUNCTION fail_cert_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$");await pool.query('CREATE TRIGGER fail_cert_audit BEFORE INSERT ON platform_admin_audit FOR EACH ROW EXECUTE FUNCTION fail_cert_audit()');
 try{assert.equal((await decide(a,m,review,2,key)).status,500);assert.equal((await state(m)).state,'pending');assert.equal(await count('platform_admin_receipts'),0);}
 finally{await pool.query('DROP TRIGGER fail_cert_audit ON platform_admin_audit');await pool.query('DROP FUNCTION fail_cert_audit()');}
 assert.equal((await decide(a,m,review,2,key)).status,200);
});
test('SQL constraints reject unreviewed active claims and self-review even outside API',async()=>{
 const m=await member('Applicant'),a=await administrator();await apply(m);
 await assert.rejects(()=>pool.query("UPDATE member_community_certifications SET state='active' WHERE user_id=$1",[m.id]));
 await assert.rejects(()=>pool.query("UPDATE member_community_certifications SET state='active',reviewed_by=$2,reviewer_user_id=user_id,reviewed_at=clock_timestamp() WHERE user_id=$1",[m.id,a.id]));
 assert.equal((await state(m)).state,'pending');
});
async function waitOn(holder:number){const end=Date.now()+5000;for(;;){if((await db.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))) AS waiting',[schema,holder])).rows[0].waiting)return;assert.ok(Date.now()<end,'actual database lock wait required');await delay(10);}}
test('session expiration across certification lock rolls back admin review',async()=>{
 const m=await member('Applicant'),a=await administrator();await apply(m);const gate=await pool.connect();let pending:ReturnType<typeof decide>|undefined;
 try{await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE user_id=$1",[a.member.id]);await gate.query('BEGIN');await gate.query('SELECT * FROM member_community_certifications WHERE user_id=$1 FOR UPDATE',[m.id]);const pid=(await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;pending=decide(a,m);await waitOn(pid);await gate.query('SELECT pg_sleep(2.1)');await gate.query('ROLLBACK');assert.equal((await pending).status,401);assert.equal((await state(m)).state,'pending');assert.equal(await count('platform_admin_receipts'),0);}
 finally{await gate.query('ROLLBACK');gate.release();await pending;}
});
test('same Access JWT is reverified after wait with original five-second tolerance',async()=>{
 const m=await member('Applicant'),a=await administrator();await apply(m);a.jwt=await sign(a.member.email,1);a.csrf=(await verify(new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':a.jwt}}))).csrfToken;
 const gate=await pool.connect();let pending:ReturnType<typeof decide>|undefined;
 try{await gate.query('BEGIN');await gate.query('SELECT * FROM member_community_certifications WHERE user_id=$1 FOR UPDATE',[m.id]);const pid=(await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;pending=decide(a,m);await waitOn(pid);await gate.query('SELECT pg_sleep(6.1)');await gate.query('ROLLBACK');assert.equal((await pending).status,401);assert.equal((await state(m)).state,'pending');assert.equal(await count('platform_admin_audit'),0);}
 finally{await gate.query('ROLLBACK');gate.release();await pending;}
});
test('cross-community target cannot be reviewed or enumerated',async()=>{
 const m=await member('Applicant'),a=await administrator();await apply(m);
 const other=randomUUID(),outsider=randomUUID();await pool.query('INSERT INTO communities VALUES($1,$2)',[other,'Other synthetic community']);
 await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref) SELECT $1,$2,$3,'Other',password_hash,$4 FROM users LIMIT 1`,[outsider,other,`${randomUUID()}@example.test`,randomUUID()]);
 await pool.query("INSERT INTO member_community_certifications(user_id,community_id,state,statement,aggregate_version) VALUES($1,$2,'pending',$3,2)",[outsider,other,application.statement]);
 assert.equal((await decide(a,{...m,id:outsider})).status,404);
 const queue=await request('/admin/api/community-certifications?state=all',undefined,undefined,undefined,undefined,a);assert.equal(queue.status,200);assert.equal(queue.data.items.some((item:any)=>item.user_id===outsider),false);
});
test('owner withdrawal and admin approval race cannot leave an unreviewed active claim',async()=>{
 const m=await member('Applicant'),a=await administrator();await apply(m);
 const results=await Promise.all([own(m,{confirmed:true},2,undefined,'withdraw'),decide(a,m)]);assert.deepEqual(results.map(result=>result.status).sort(),[200,412]);
 const current=await state(m);assert.ok(['withdrawn','active'].includes(current.state));assert.equal(current.aggregate_version,3);
 if(current.state==='active'){assert.equal((await own(m,{confirmed:true},3,undefined,'withdraw')).status,200);assert.equal((await state(m)).state,'withdrawn');}
});
test('request retry after revocation does not create a second application or restore badge',async()=>{
 const m=await member('Applicant'),a=await administrator(),key=randomUUID();assert.equal((await own(m,application,1,key)).status,200);assert.equal((await decide(a,m)).status,200);assert.equal((await decide(a,m,{...review,decision:'revoke'},3)).status,200);
 const results=await Promise.all([own(m,application,1,key),own(m,{show_community_certification:true},4,undefined,'display')]);assert.ok(results.every(result=>result.status===200));assert.equal((await state(m)).state,'revoked');
});
test('DML-only synthetic runtime can execute the actual service but cannot alter schema',async()=>{
 const m=await member('Applicant'),a=await administrator(),role=`fp_cert_role_${process.pid}_${Date.now()}`;
 const {authenticate}=await import('../../modules/identity-membership/service.js'),{ownCertification,changeOwnCertification,reviewCertification}=await import('../../modules/community-certification/service.js');
 const token=(s:Member)=>s.cookie.slice(s.cookie.indexOf('=')+1),actor=await authenticate(pool,token(m)),reviewer=await authenticate(pool,token(a.member));
 let runtime:Pool|undefined;
 await db.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
 try{
  await db.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await db.query(`GRANT SELECT,INSERT,UPDATE ON ${['users','sessions','member_account_classification','member_community_certifications','command_receipts','transition_journal','auth_rate_limits','platform_admins','platform_admin_receipts','platform_admin_audit'].map(table=>schema+'.'+table).join(',')} TO ${role}`);
  runtime=new Pool({connectionString:database,options:`-c search_path=${schema} -c role=${role}`,max:3});
  assert.equal((await ownCertification(runtime,actor)).state,'unrequested');
  assert.equal((await changeOwnCertification(runtime,{actor,operation:'certification.apply.synthetic',body:application,key:randomUUID(),expected:'1'},'apply')).state,'pending');
  const adminActor={admin_id:a.id,community_id:a.member.community,email:a.member.email,display_name:'Reviewer',role:'super_admin' as const,subject:`human:${a.member.email}`};
  await reviewCertification(runtime,{admin:adminActor,operation:'certification.review.synthetic',key:randomUUID(),body:review,expected:'2'},reviewer,m.id,async()=>{const identity=await verify(new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':a.jwt}}));assert.equal(identity.subject,adminActor.subject);});
  assert.equal((await ownCertification(runtime,actor)).state,'active');
  await assert.rejects(()=>runtime!.query('ALTER TABLE member_community_certifications ADD COLUMN forbidden boolean'),(error:any)=>error.code==='42501');
  await assert.rejects(()=>runtime!.query('TRUNCATE member_community_certifications'),(error:any)=>error.code==='42501');
 }finally{await runtime?.end();await db.query(`DROP OWNED BY ${role}`);await db.query(`DROP ROLE ${role}`);}
});
test('administrator can revoke an existing certification after target account is disabled',async()=>{
 const m=await member('Applicant'),a=await administrator();await apply(m);assert.equal((await decide(a,m)).status,200);await pool.query('UPDATE users SET active=false WHERE user_id=$1',[m.id]);
 assert.equal((await decide(a,m,{...review,decision:'revoke'},3)).status,200);assert.equal((await pool.query('SELECT state FROM member_community_certifications WHERE user_id=$1',[m.id])).rows[0].state,'revoked');
});
