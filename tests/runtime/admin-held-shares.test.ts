import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {tokenHash,type Actor} from '../../modules/identity-membership/service.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {createAdminAccessVerifier} from '../../modules/platform-admin/access.js';
import {createEvent,listEvents,readEvent,listAdminEventQueue,reviewEventAsAdmin,reviewEventAsGuildMaster} from '../../modules/community/events.js';
import {reportShare} from '../../modules/shares/service.js';
import {listHeldShares} from '../../modules/shares/moderation.js';
import type {AdminActor} from '../../modules/platform-admin/service.js';
const url=process.env.TEST_DATABASE_URL;assert.ok(url);
const schema=`fp_held_${randomUUID().replaceAll('-','')}`,root=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const origin='http://127.0.0.1:46444';
const cmd=(actor:Actor,body:unknown,expected?:string)=>({actor,body,key:randomUUID(),operation:'held-test',expected});
let app:ReturnType<typeof createApp>,admin:AdminActor,adminHeaders:Record<string,string>,master:Awaited<ReturnType<typeof member>>;
async function member(){
 const id=randomUUID(),token=randomBytes(32).toString('base64url');
 await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,active,onboarding_required,created_at)
 SELECT $1,community_id,$2,'合成檢舉會員',password_hash,$3,true,false,now()-interval '8 days' FROM users WHERE user_id=$4`,[id,`${id}@example.com`,randomUUID(),DEMO_USERS[0].user_id]);
 await pool.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$1,now()+interval '1 day')",[tokenHash(token),id]);
 return {actor:{user_id:id,community_id:DEMO_COMMUNITY,session_hash:tokenHash(token)} as Actor,cookie:`freedom_local_session=${token}`,csrf:tokenHash(token)};
}
before(async()=>{
 await root.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);
 const pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey),issuer='https://synthetic.cloudflareaccess.com',audience='held-tests',email='held-admin@example.com';
 const verifier=createAdminAccessVerifier({issuer,audience,csrfSecret:randomBytes(32).toString('hex'),keySet:createLocalJWKSet({keys:[{...jwk,kid:'held',alg:'RS256'}]})});
 const now=Math.floor(Date.now()/1000),jwt=await new SignJWT({type:'app',email,sub:'held-admin',iss:issuer,aud:audience,iat:now,nbf:now,exp:now+3600}).setProtectedHeader({alg:'RS256',kid:'held'}).sign(pair.privateKey);
 admin={admin_id:randomUUID(),community_id:DEMO_COMMUNITY,email,display_name:'合成管理員',role:'super_admin',subject:'held-admin'};
 await pool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)',[admin.admin_id,admin.community_id,email,admin.display_name]);
 adminHeaders={'Cf-Access-Jwt-Assertion':jwt,'X-Admin-CSRF':(await verifier(new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':jwt}}))).csrfToken};
 app=createApp(pool,origin,'local',{adminVerifier:verifier});master=await member();
 await pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,'guild_event_space','active')",[randomUUID(),DEMO_COMMUNITY,master.actor.user_id]);
 await pool.query("INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,'guild_event_space',$2)",[DEMO_COMMUNITY,master.actor.user_id]);
});
after(async()=>{await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();});
const held=()=>app.request(origin+'/admin/api/shares/held',{headers:adminHeaders});
async function decision(id:string,action:'restore'|'confirm',reason='合成審核結果'){
 return app.request(origin+`/admin/api/shares/${id}/${action}`,{method:'POST',headers:{...adminHeaders,Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({reason})});
}
async function fixture(){
 const owner=await member(),e=await createEvent(pool,cmd(owner.actor,{title:`合成檢舉活動 ${randomUUID()}`,starts_at:'2099-01-01T10:00:00Z',location:'合成場地'}));
 const reporters=[];
 for(let i=0;i<3;i++){const m=await member();reporters.push(m);await reportShare(pool,cmd(m.actor,{reason:`合成檢舉理由 ${i+1}`}),e.share_id);}
 return {owner,e,reporters};
}
async function netCredit(id:string){return (await pool.query('SELECT coalesce(sum(units),0)::int n FROM share_credit_events WHERE share_id=$1',[id])).rows[0].n;}

test('held list refuses member, guild master, agent token and revoked admin authority',async()=>{
 const ordinary=await member();
 for(const session of [ordinary,master])assert.equal((await app.request(origin+'/admin/api/shares/held',{headers:{Cookie:session.cookie}})).status,401);
 const issued=await app.request(origin+'/api/v1/me/agent-tokens',{method:'POST',headers:{Origin:origin,Cookie:ordinary.cookie,'X-CSRF-Token':ordinary.csrf,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({name:'合成測試',scopes:['read','share']})});
 assert.equal(issued.status,201);const token=(await issued.json()).access_token;
 assert.equal((await app.request(origin+'/admin/api/shares/held',{headers:{Authorization:`Bearer ${token}`}})).status,403);
 assert.equal((await app.request(origin+'/api/v1/admin/shares/held',{headers:{Authorization:`Bearer ${token}`}})).status,403);
 assert.equal((await held()).status,200);
 await pool.query('UPDATE platform_admins SET active=false WHERE admin_id=$1',[admin.admin_id]);
 try{assert.equal((await held()).status,403);}finally{await pool.query('UPDATE platform_admins SET active=true WHERE admin_id=$1',[admin.admin_id]);}
});

test('reported event has exactly one review queue, a minimal projection, and restores via admin HTTP',async()=>{
 const {owner,e,reporters}=await fixture();
 assert.equal((await pool.query('SELECT state FROM community_events WHERE event_id=$1',[e.event_id])).rows[0].state,'pending');
 assert.equal(await netCredit(e.share_id),1);
 assert.equal((await listAdminEventQueue(pool,admin)).some(row=>row.event_id===e.event_id),false);
 assert.equal((await listEvents(pool,master.actor)).some(row=>row.event_id===e.event_id),false);
 await assert.rejects(readEvent(pool,master.actor,e.event_id),{status:404});
 assert.equal((await readEvent(pool,owner.actor,e.event_id)).can_review,false);
 const row=(await (await held()).json()).items.find((item:any)=>item.share_id===e.share_id);
 assert.deepEqual(Object.keys(row).sort(),['share_id','kind','title','public_url','open_reports','reasons','hidden_at'].sort());
 assert.equal(row.title,e.title);assert.equal(row.public_url,`/events/${e.event_id}`);assert.equal(row.open_reports,3);assert.deepEqual(row.reasons,['合成檢舉理由 1','合成檢舉理由 2','合成檢舉理由 3']);
 const last=(await pool.query('SELECT max(created_at) t FROM share_reports WHERE share_id=$1',[e.share_id])).rows[0].t;
 assert.equal(row.hidden_at,last.toISOString());
 for(const reporter of reporters){assert.ok(!JSON.stringify(row).includes(reporter.actor.user_id));assert.ok(!JSON.stringify(row).includes('@example.com'));}
 const version=(await pool.query('SELECT aggregate_version FROM community_events WHERE event_id=$1',[e.event_id])).rows[0].aggregate_version;
 for(const action of ['approve','reject'] as const){
  const body={decision:action,reason:'合成一般審核'};
  const denied=(error:any)=>error.status===409&&error.code==='share_unavailable'&&/平台管理員.*檢舉處理/.test(error.message);
  await assert.rejects(reviewEventAsGuildMaster(pool,cmd(master.actor,body,version),e.event_id),denied);
  await assert.rejects(reviewEventAsAdmin(pool,{admin,key:randomUUID(),operation:'held-review',body,expected:version},e.event_id),denied);
 }
 assert.equal((await decision(e.share_id,'restore','短')).status,422);
 assert.equal((await decision(e.share_id,'restore')).status,200);
 assert.equal((await pool.query('SELECT state FROM community_events WHERE event_id=$1',[e.event_id])).rows[0].state,'published');
 assert.equal((await listHeldShares(pool,admin)).some(row=>row.share_id===e.share_id),false);
 assert.equal((await listEvents(pool,master.actor)).some(row=>row.event_id===e.event_id),true);assert.equal(await netCredit(e.share_id),1);
});

test('confirmation keeps the event held, removes the decision row and reverses each credit only once',async()=>{
 const {e}=await fixture();assert.equal(await netCredit(e.share_id),1);
 assert.equal((await decision(e.share_id,'confirm')).status,200);assert.equal((await decision(e.share_id,'confirm')).status,200);
 assert.equal(await netCredit(e.share_id),0);
 assert.equal((await pool.query("SELECT count(*)::int n FROM share_credit_events WHERE share_id=$1 AND units=-1",[e.share_id])).rows[0].n,1);
 assert.equal((await pool.query('SELECT s.state,e.state AS event_state FROM shares s JOIN community_events e ON e.event_id=s.ref_id WHERE s.share_id=$1',[e.share_id])).rows[0].state,'hidden');
 assert.equal((await listHeldShares(pool,admin)).some(row=>row.share_id===e.share_id),false);
 assert.equal((await listAdminEventQueue(pool,admin)).some(row=>row.event_id===e.event_id),false);
 assert.equal((await listEvents(pool,master.actor)).some(row=>row.event_id===e.event_id),false);
});

test('queue excludes test owners and foreign communities, bounds reasons and preserves normal pending review',async()=>{
 const {e,owner,reporters}=await fixture();
 await pool.query("UPDATE users SET email='held-owner@example.invalid' WHERE user_id=$1",[owner.actor.user_id]);
 assert.equal((await listHeldShares(pool,admin)).some(row=>row.share_id===e.share_id),false);
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[owner.actor.user_id,`${owner.actor.user_id}@example.com`]);
 assert.equal((await listHeldShares(pool,{...admin,community_id:randomUUID()})).length,0);
 const fourth=await member();await pool.query("INSERT INTO share_reports(share_id,user_id,reason,eligible) VALUES($1,$2,'第四則理由',false)",[e.share_id,fourth.actor.user_id]);
 const row=(await listHeldShares(pool,admin)).find(item=>item.share_id===e.share_id);assert.equal(row.open_reports,4);assert.equal(row.reasons.length,3);
 await pool.query("UPDATE community_events SET visibility='guild',event_kind='guild_skill_exchange',guild_key='guild_event_space' WHERE event_id=$1",[e.event_id]);
 assert.equal((await listHeldShares(pool,admin)).find(item=>item.share_id===e.share_id).public_url,null);
 const normalOwner=await member(),normal=await createEvent(pool,cmd(normalOwner.actor,{title:'合成一般待審核',starts_at:'2099-01-01T10:00:00Z',location:'合成場地'}));
 await pool.query("UPDATE community_events SET state='pending' WHERE event_id=$1",[normal.event_id]);
 assert.equal((await listAdminEventQueue(pool,admin)).some(item=>item.event_id===normal.event_id),true);
 assert.equal((await listEvents(pool,master.actor)).find(item=>item.event_id===normal.event_id)?.can_review,true);
 // Stored order is deterministic even when shares were created in the opposite order.
 for(let i=0;i<103;i++){
  const id=randomUUID();await pool.query("INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,title,state) VALUES($1::uuid,$2,'link',$1::uuid::text,'https://example.com/held','合成排序','hidden')",[id,DEMO_COMMUNITY]);
  for(let j=0;j<3;j++)await pool.query("INSERT INTO share_reports(share_id,user_id,reason,eligible,created_at) VALUES($1,$2,'合成排序理由',true,'2020-01-01'::timestamptz + $3::int * interval '1 minute')",[id,reporters[j].actor.user_id,103-i]);
 }
 const capped=await listHeldShares(pool,admin);assert.equal(capped.length,100);
 for(let i=1;i<capped.length;i++)assert.ok(capped[i-1].hidden_at<=capped[i].hidden_at);
});
