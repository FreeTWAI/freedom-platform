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
import {adminTools} from '../../modules/guild-tools/admin.js';
import {listHeldShares} from '../../modules/shares/moderation.js';
import type {AdminActor} from '../../modules/platform-admin/service.js';
const url=process.env.TEST_DATABASE_URL;assert.ok(url);
const schema=`fp_admin_places_${randomUUID().replaceAll('-','')}`,root=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
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

async function get(path:string,headers=adminHeaders){return app.request(origin+'/admin/api'+path,{headers});}
test('reported tools are community scoped, oldest first, paginated and contain no reporter or private contact',async()=>{
 const ids=[randomUUID(),randomUUID()],reporter=await member();
 for(let i=0;i<ids.length;i++){
  await pool.query(`INSERT INTO guild_tools(id,community_id,guild_key,tool_id,title,entry_url,origin,state,bridge_version,profile,scopes,permissions,registered_by)
   VALUES($1,$2,'guild_games',$3,'合成待處理工具','https://example.com/tool','https://example.com','enabled','freedom.guild-launchpad/v2','sandboxed','[]','[]',$4)`,[ids[i],DEMO_COMMUNITY,'queue-'+i,reporter.actor.user_id]);
  await pool.query(`INSERT INTO guild_tool_reports(tool,revision,reporter,created_at) VALUES($1,1,$2,now()-($3::int * interval '1 day'))`,[ids[i],reporter.actor.user_id,i+1]);
 }
 const response=await get('/guild-tools?reported=true&limit=1');assert.equal(response.status,200);const page=await response.json();assert.equal(page.items.length,1);assert.equal(page.items[0].id,ids[1]);assert.equal(page.next_offset,1);
 assert.deepEqual(Object.keys(page.items[0]).sort(),['first_reported_at','guild_key','id','origin','report_count','revision','state','title','tool_id']);assert.equal(page.items[0].report_count,1);
 assert.equal(JSON.stringify(page).includes(reporter.actor.user_id),false);assert.equal(JSON.stringify(page).includes('@'),false);
 assert.equal((await (await get('/guild-tools?reported=true&limit=1&offset=1')).json()).items[0].id,ids[0]);
 assert.deepEqual((await adminTools(pool,{...admin,community_id:randomUUID()},true)).items,[]);
 const foreign=randomUUID();await pool.query('INSERT INTO communities VALUES($1,$2)',[foreign,'合成外部社群']);
 await pool.query('UPDATE guild_tools SET community_id=$2 WHERE id=$1',[ids[0],foreign]);
 assert.equal((await (await get('/guild-tools?reported=true')).json()).items.some((row:any)=>row.id===ids[0]),false);
 const forbidden=await app.request(origin+`/admin/api/guild-tools/${ids[0]}/disable`,{method:'POST',headers:{...adminHeaders,Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:JSON.stringify({reason:'合成跨社群嘗試'})});assert.equal(forbidden.status,404);
 await pool.query('UPDATE guild_tools SET community_id=$2 WHERE id=$1',[ids[0],DEMO_COMMUNITY]);
 const denied=await app.request(origin+`/admin/api/guild-tools/${ids[1]}/disable`,{method:'POST',headers:{...adminHeaders,'X-Admin-CSRF':'',Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:JSON.stringify({reason:'合成審核理由'})});assert.equal(denied.status,403);
 const result=await app.request(origin+`/admin/api/guild-tools/${ids[1]}/disable`,{method:'POST',headers:{...adminHeaders,Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:JSON.stringify({reason:'合成審核理由'})});assert.equal(result.status,200);
 const after=await (await get('/guild-tools?reported=true')).json();assert.equal(after.items.some((row:any)=>row.id===ids[1]),false);assert.equal(after.items.some((row:any)=>row.id===ids[0]),true);
});
test('inbox sources refuse members, guild officers, agent tokens and revoked administrators',async()=>{
 const ordinary=await member();const paths=['/guild-tools?reported=true','/event-organizer-claims','/shares/held?limit=1&offset=1','/events?limit=1&offset=1'];
 for(const path of paths)for(const session of [ordinary,master])assert.equal((await get(path,{Cookie:session.cookie})).status,401);
 const issued=await app.request(origin+'/api/v1/me/agent-tokens',{method:'POST',headers:{Origin:origin,Cookie:ordinary.cookie,'X-CSRF-Token':ordinary.csrf,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({name:'合成測試',scopes:['read','share']})});assert.equal(issued.status,201);const token=(await issued.json()).access_token;
 for(const path of paths)assert.equal((await get(path,{...adminHeaders,Authorization:`Bearer ${token}`})).status,403);
 await pool.query('UPDATE platform_admins SET active=false WHERE admin_id=$1',[admin.admin_id]);try{for(const path of paths)assert.equal((await get(path)).status,403);}finally{await pool.query('UPDATE platform_admins SET active=true WHERE admin_id=$1',[admin.admin_id]);}
});
test('bootstrap describes installed admin capabilities without enabling them',async()=>{
 const response=await get('/bootstrap');assert.equal(response.status,200);const value=await response.json();assert.equal(value.store_admissions_enabled,false);assert.equal(value.github_setup_enabled,false);assert.equal(value.community_certification_enabled,false);assert.equal(value.tool_reports_enabled,true);
});

test('organizer claims page pending objects oldest first and verification preserves the event owner',async()=>{
 const owner=await member(),claimant=await member(),event=await createEvent(pool,cmd(owner.actor,{title:'合成主辦認領活動',starts_at:'2099-01-01T10:00:00Z',location:'合成場地'}));
 const ids=[randomUUID(),randomUUID()];
 for(let index=0;index<ids.length;index++)await pool.query(`INSERT INTO community_event_organizer_claims(claim_id,event_id,community_id,user_id,statement,evidence_url,created_at) VALUES($1,$2,$3,$4,'合成活動主辦來源說明。','https://example.com/proof',now()-($5::int*interval '1 day'))`,[ids[index],event.event_id,DEMO_COMMUNITY,index?owner.actor.user_id:claimant.actor.user_id,index+1]);
 const page=await (await get('/event-organizer-claims?state=pending&limit=1')).json();assert.equal(page.items[0].claim_id,ids[1]);assert.equal(page.next_offset,1);assert.deepEqual(Object.keys(page.items[0]).sort(),['claim_id','created_at','event_id','evidence_url','state','statement','version']);
 const response=await app.request(origin+`/admin/api/event-organizer-claims/${ids[0]}/review`,{method:'POST',headers:{...adminHeaders,Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:JSON.stringify({decision:'verify',reason:'合成來源已核對'})});assert.equal(response.status,200);
 assert.equal((await pool.query('SELECT organizer_ref FROM community_events WHERE event_id=$1',[event.event_id])).rows[0].organizer_ref,owner.actor.user_id);
 assert.equal((await (await get('/event-organizer-claims?state=pending')).json()).items.some((row:any)=>row.claim_id===ids[0]),false);
 assert.equal((await pool.query("SELECT sum(units)::int units FROM share_credit_events WHERE source_ref=$1 AND role='organizer'",[`event-claim:${ids[0]}`])).rows[0].units,1);
 const foreign=randomUUID();await pool.query('INSERT INTO communities VALUES($1,$2)',[foreign,'合成認領外部社群']);await pool.query('UPDATE community_event_organizer_claims SET community_id=$2 WHERE claim_id=$1',[ids[1],foreign]);assert.equal((await (await get('/event-organizer-claims?state=pending')).json()).items.some((row:any)=>row.claim_id===ids[1]),false);
 const cross=await app.request(origin+`/admin/api/event-organizer-claims/${ids[1]}/review`,{method:'POST',headers:{...adminHeaders,Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:JSON.stringify({decision:'reject',reason:'合成跨社群嘗試'})});assert.equal(cross.status,404);
});
