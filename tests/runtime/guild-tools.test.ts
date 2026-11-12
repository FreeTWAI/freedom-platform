import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {BRIDGE_VERSION,NATIVE_TOOL_ROUTES} from '../../modules/guild-tools/contract.js';
import {inspectTool,safeFrameOrigins,toolUrl} from '../../modules/guild-tools/validation.js';
import {createNodePreviewFetch} from '../../apps/platform-api/src/node-preview-fetch.js';
const url=process.env.TEST_DATABASE_URL;
if(!url||!/^postgresql:\/\/[^@]+@127\.0\.0\.1:56445\/fp_p1_tools$/.test(url))throw Error('Explicit isolated tools database required');
const schema='fp_tools_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:url}),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
const origin='http://127.0.0.1:46445';
let app=createApp(pool,origin,'local',{linkPreviewFetch:async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}})});
const input={tool_id:'example',title:'小工具',entry_url:'https://tools.example.test/app/',bridge_version:BRIDGE_VERSION,profile:'sandboxed',scopes:['context:read','device-state:own'],permissions:[]};
type Session={cookie:string;csrf:string;user:string};
async function req(path:string,session?:Session,body?:unknown,version?:number,key=randomUUID()){
 const r=await app.request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...(body===undefined?{}:{'Content-Type':'application/json','Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};
}
async function login(index:number):Promise<Session>{const r=await app.request(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:DEMO_USERS[index].email,password:DEMO_PASSWORD})});const d=await r.json() as any;assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:d.csrf_token,user:d.user.user_id};}
async function lead(s:Session,guild:string){await pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,$4,'active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,s.user,guild]);await pool.query('INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,$2,$3) ON CONFLICT(community_id,guild_key) DO UPDATE SET user_id=$3',[DEMO_COMMUNITY,guild,s.user]);}
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
test('reject hostile URLs, platform aliases, redirects, bad framing and unsafe DNS before transport',async()=>{
 for(const entry_url of ['http://example.com','https://user:pass@example.com','https://127.0.0.1','https://2130706433','https://[::1]','https://x.local/a','https://x.internal','https://freetwai.com','https://admin.freetwai.com','https://example.com/?token=secret','https://example.com/#secret','https://example.com:444','https://example.com/\n'])assert.throws(()=>toolUrl(entry_url,origin),entry_url);
 for(const response of [new Response('',{status:302,headers:{location:'https://evil.example'}}),new Response('',{headers:{'content-type':'text/html','x-frame-options':'DENY'}}),new Response('',{headers:{'content-type':'text/html','content-security-policy':"frame-ancestors 'none'"}})])await assert.rejects(inspectTool(input,origin,async()=>response));
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1'])await assert.rejects(createNodePreviewFetch(async()=>[{address,family:address.includes(':')?6:4}])('https://public.example.test/'));
 await assert.rejects(inspectTool(input,origin,undefined));await assert.rejects(inspectTool({...input,bridge_version:'freedom.guild-launchpad/v1'},origin,async()=>new Response('')), (error:any)=>error.code==='tool_bridge_version');assert.equal(safeFrameOrigins(Array.from({length:80},(_,i)=>`https://tool-${i}.example.test`),origin).length,64);
 assert.deepEqual(safeFrameOrigins(['https://good.example','https://bad.example; script-src *','https://freetwai.com','https://good.example/path'],origin),['https://good.example']);
 await assert.rejects(inspectTool({...input,profile:'origin'},origin,async()=>new Response(''))); // HTML validation still applies before proof verification.
});
test('current guild authority, acceptance, revisions, opaque subjects, report dedupe and CSP',async()=>{
 const leader=await login(0),other=await login(1),third=await login(2);await lead(leader,'guild_games');await lead(other,'guild_ar');
 const base='/api/v1/guilds/guild_games/tools';
 assert.equal((await req(base,other,input)).status,403);
 const registered=await req(base,leader,input);assert.equal(registered.status,201,JSON.stringify(registered));assert.equal(registered.data.state,'pending');
 const html=await app.request(origin+'/guild-tool-preview/'+registered.data.id);assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy')!,/https:\/\/tools.example.test/);
 let page=await app.request(origin+'/');assert.doesNotMatch(page.headers.get('content-security-policy')!,/tools.example.test/);
 assert.equal((await req(base+'/example/accept',other,{},1)).status,403);
 assert.equal((await req(base+'/example/accept',leader,{},1)).status,200);
 page=await app.request(origin+'/');assert.match(page.headers.get('content-security-policy')!,/frame-src[^;]*https:\/\/tools.example.test/);
 const ctx=await req(base+'/example/context',leader);assert.equal(ctx.status,200);assert.deepEqual(Object.keys(ctx.data).sort(),['subject','tier']);assert.notEqual(ctx.data.subject,leader.user);assert.equal((await req(base+'/example/context',leader)).data.subject,ctx.data.subject);
 const second=await req(base,leader,{...input,tool_id:'other'});assert.equal(second.status,201);await req(base+'/other/accept',leader,{},1);assert.notEqual((await req(base+'/other/context',leader)).data.subject,ctx.data.subject);
 const revised=await req(base,leader,{...input,entry_url:'https://new.example.test/'},1);assert.equal(revised.status,201);assert.equal(revised.data.revision,2);assert.equal(revised.data.state,'pending');
 assert.equal((await req(base+'/example/accept',leader,{},1)).status,412);await req(base+'/example/accept',leader,{},2);
 await req(base+'/example/report',leader,{},2);await req(base+'/example/report',leader,{},2);assert.equal((await req('/api/v1/public/guilds/guild_games/tools')).data.items.find((t:any)=>t.tool_id==='example').state,'enabled');
 await req(base+'/example/report',other,{},2);await req(base+'/example/report',third,{},2);
 assert.equal((await req('/api/v1/public/guilds/guild_games/tools')).data.items.find((t:any)=>t.tool_id==='example').state,'disabled');assert.equal((await req(base+'/example/context',leader)).status,404);
 assert.doesNotMatch((await app.request(origin+'/')).headers.get('content-security-policy')!,/new.example.test/);
 assert.equal(Number((await pool.query('SELECT count(*) FROM guild_tool_revisions WHERE tool=$1',[registered.data.id])).rows[0].count),2);
 await assert.rejects(pool.query('UPDATE guild_tool_audit SET action=$1',['fake']));
 await pool.query('DELETE FROM positioning_guild_officers WHERE user_id=$1',[leader.user]);assert.equal((await req(base,leader,{...input,tool_id:'revoked'})).status,403);
});
test('origin proof binds registrant/guild/origin; browser and agent exchange use a distinct bounded audience and revocation status',async()=>{
 const {generateKeyPair,exportJWK,SignJWT}=await import('jose');const {verifyToolToken}=await import('../../modules/guild-tools/tokens.js');const pair=await generateKeyPair('ES256'),jwk=await exportJWK(pair.publicKey),kid=randomUUID();let proof='';
 app=createApp(pool,origin,'local',{guildToolSigner:{privateKey:pair.privateKey,publicJwk:jwk,kid},linkPreviewFetch:async url=>url.endsWith('/.well-known/freedom-guild-tool.txt')?new Response(proof,{headers:{'content-type':'text/plain'}}):new Response('<html></html>',{headers:{'content-type':'text/html'}})});
 const leader=await login(0),other=await login(1);await lead(leader,'guild_games');const base='/api/v1/guilds/guild_games/tools',body={...input,tool_id:'origin-tool',profile:'origin',scopes:['context:read','session:exchange']};
 assert.equal((await req(base,leader,body)).status,422);
 assert.equal((await req(base+'/origin-challenges',other,{entry_url:body.entry_url})).status,403);
 const challenge=await req(base+'/origin-challenges',leader,{entry_url:body.entry_url});assert.equal(challenge.status,201);assert.equal(new URL(challenge.data.url).pathname,'/.well-known/freedom-guild-tool.txt');
 assert.equal((await req(base,leader,{...body,origin_challenge_id:challenge.data.challenge_id})).status,422);
 proof=challenge.data.contents;
 assert.equal((await req(base,leader,{...body,entry_url:'https://another.example/',origin_challenge_id:challenge.data.challenge_id})).status,422);
 const registered=await req(base,leader,{...body,origin_challenge_id:challenge.data.challenge_id});assert.equal(registered.status,201,JSON.stringify(registered));await req(base+'/origin-tool/accept',leader,{},1);
 const publicContextOnly=await req(base,leader,{...body,tool_id:'origin-no-token',scopes:['context:read'],origin_challenge_id:challenge.data.challenge_id});assert.equal(publicContextOnly.status,201);await req(base+'/origin-no-token/accept',leader,{},1);assert.equal((await req(base+'/origin-no-token/token',leader,{})).status,403);
 const token=await req(base+'/origin-tool/token',leader,{});assert.equal(token.status,200,JSON.stringify(token));const claims=await verifyToolToken(token.data.access_token,jwk,origin,registered.data.id);const {verifyGuildToolToken}=await import('../../apps/portal-web/public/guild-tool/v2/verify-token.mjs');const config={issuer:origin,audience:registered.data.id,jwks:{keys:[{...jwk,kid,alg:'ES256',use:'sig'}]}};assert.equal((await verifyGuildToolToken(token.data.access_token,config)).sub,claims.sub);await assert.rejects(verifyGuildToolToken(token.data.access_token,{...config,audience:randomUUID()}));assert.equal(claims.exp!-claims.iat!,600);assert.equal(claims.aud,registered.data.id);assert.notEqual(claims.sub,leader.user);assert.equal(claims.email,undefined);assert.deepEqual(claims.scopes,['context:read']);
 await assert.rejects(verifyToolToken(token.data.access_token,jwk,origin,randomUUID()));
 const oldPurpose=await new SignJWT({...claims}).setProtectedHeader({alg:'ES256',typ:'freedom-execution-text+jwt'}).sign(pair.privateKey);await assert.rejects(verifyToolToken(oldPurpose,jwk,origin,registered.data.id));
 const state=()=>req('/api/v1/public/guild-tool-token/status',undefined,{token:token.data.access_token,audience:registered.data.id});assert.deepEqual((await state()).data,{active:true});
 assert.equal((await req(base+'/other/token',leader,{})).status,403); // sandboxed cannot receive a token
 const noCsrf=await app.request(origin+base+'/origin-tool/token',{method:'POST',headers:{Origin:origin,Cookie:leader.cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(noCsrf.status,403);
 await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1',[leader.user]);
 const issued=await req('/api/v1/me/agent-tokens',leader,{name:'tool verifier',scopes:['read']});assert.equal(issued.status,201,JSON.stringify(issued));
 const agentRequest=async(extra:Record<string,string>={})=>app.request(origin+base+'/origin-tool/token',{method:'POST',headers:{Authorization:'Bearer '+issued.data.access_token,'Content-Type':'application/json','Idempotency-Key':randomUUID(),...extra},body:'{}'});
 assert.equal((await agentRequest({Cookie:leader.cookie})).status,400);const agent=await agentRequest();assert.equal(agent.status,200,await agent.clone().text());const agentToken=await agent.json() as any;const agentClaims=await verifyToolToken(agentToken.access_token,jwk,origin,registered.data.id);assert.equal(agentClaims.sub,claims.sub);
 const absent=createApp(pool,origin,'local');assert.equal((await absent.request(origin+base+'/origin-tool/token',{method:'POST',headers:{Origin:origin,Cookie:leader.cookie,'X-CSRF-Token':leader.csrf,'Content-Type':'application/json'},body:'{}'})).status,503);
 await req(base+'/origin-tool/disable',leader,{},1);assert.deepEqual((await state()).data,{active:false});assert.equal((await req(base+'/origin-tool/token',leader,{})).status,403);
});
test('admin immediate disable is scoped, current-authorized and audited',async()=>{
 const {disableToolAsAdmin}=await import('../../modules/guild-tools/admin.js');const leader=await login(0);await lead(leader,'guild_games');const base='/api/v1/guilds/guild_games/tools';const tool=await req(base,leader,{...input,tool_id:'admin-target'});await req(base+'/admin-target/accept',leader,{},1);
 const adminId=randomUUID(),email='synthetic-tool-admin@example.test';await pool.query("INSERT INTO platform_admins(admin_id,community_id,email,display_name,role,active) VALUES($1,$2,$3,'Synthetic admin','super_admin',true)",[adminId,DEMO_COMMUNITY,email]);
 const adminActor={admin_id:adminId,community_id:DEMO_COMMUNITY,email,display_name:'Synthetic admin',role:'super_admin' as const,subject:'synthetic-access'};const command={admin:adminActor,operation:'POST /admin/api/guild-tools/'+tool.data.id+'/disable',key:randomUUID(),body:{reason:'Safety review'},expected:'1'};
 await assert.rejects(disableToolAsAdmin(pool,{...command,admin:{...adminActor,community_id:randomUUID()}},tool.data.id));
 assert.equal((await disableToolAsAdmin(pool,command,tool.data.id)).state,'disabled');assert.equal((await pool.query("SELECT count(*)::int n FROM guild_tool_audit WHERE tool=$1 AND action='admin-disable'",[tool.data.id])).rows[0].n,1);
 await pool.query('UPDATE platform_admins SET active=false WHERE admin_id=$1',[adminId]);await assert.rejects(disableToolAsAdmin(pool,command,tool.data.id));
});
test('delegates can add a first revision, cannot accept a changed boundary, and expired grants do not authorize replay',async()=>{
 const leader=await login(0),delegate=await login(2);await lead(leader,'guild_games');await pool.query('INSERT INTO principals(user_ref) VALUES($1),($2) ON CONFLICT(user_ref) DO NOTHING',[leader.user,delegate.user]);await pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_games','active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,delegate.user]);const principals=(await pool.query('SELECT principal_id,user_ref FROM principals WHERE user_ref=ANY($1::uuid[])',[[leader.user,delegate.user]])).rows;const principal=(user:string)=>principals.find(r=>r.user_ref===user).principal_id;
 const delegation=randomUUID();await pool.query("INSERT INTO guild_launchpad_delegations(delegation_id,community_id,guild_key,principal_id,capabilities,granted_by_principal_id,expires_at,version,status) VALUES($1,$2,'guild_games',$3,ARRAY['guild.config.publish'],$4,clock_timestamp()+interval '1 hour',1,'active')",[delegation,DEMO_COMMUNITY,principal(delegate.user),principal(leader.user)]);
 const base='/api/v1/guilds/guild_games/tools',body={...input,tool_id:'delegated'},key=randomUUID();const r=await req(base,delegate,body,undefined,key);assert.equal(r.status,201);assert.equal((await req(base+'/delegated/accept',delegate,{},1)).status,200);
 const revised=await req(base,delegate,{...body,scopes:['context:read']},1);assert.equal(revised.status,201);assert.equal((await req(base+'/delegated/accept',delegate,{},2)).status,403);assert.equal((await req(base+'/delegated/accept',leader,{},2)).status,200);
 await pool.query("UPDATE guild_launchpad_delegations SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='Synthetic revoke',version=version+1 WHERE delegation_id=$1",[delegation]);assert.equal((await req(base,delegate,body,undefined,key)).status,403);
});
test('guild tool limit fails closed without creating a seventeenth record',async()=>{
 const leader=await login(1);await lead(leader,'guild_ar');for(let i=0;i<16;i++)await pool.query("INSERT INTO guild_tools(id,community_id,guild_key,tool_id,state,title,entry_url,origin,bridge_version,profile,scopes,permissions,registered_by) VALUES($1,$2,'guild_ar',$3,'enabled','上限','https://capacity.example.test/','https://capacity.example.test',$4,'sandboxed','[\"context:read\"]','[]',$5)",[randomUUID(),DEMO_COMMUNITY,'cap-'+i,BRIDGE_VERSION,leader.user]);
 const result=await req('/api/v1/guilds/guild_ar/tools',leader,{...input,tool_id:'overflow'});assert.equal(result.status,409);assert.equal(result.data.code,'tool_limit');assert.equal((await pool.query("SELECT count(*)::int n FROM guild_tools WHERE guild_key='guild_ar'")).rows[0].n,16);
});

test('native tool routes cannot be replaced by a registration, while arcade remains opt-in',async()=>{
 const {GUILD_TOOLS}=await import('../../apps/portal-web/src/guild-tools/catalog.js');
 assert.deepEqual([...NATIVE_TOOL_ROUTES].sort(),GUILD_TOOLS.filter(t=>t.tool_id!=='arcade').map(t=>t.guild_key+'/'+t.tool_id).sort());
 const leader=await login(1);await lead(leader,'guild_ar');const result=await req('/api/v1/guilds/guild_ar/tools',leader,{...input,tool_id:'ar'});assert.equal(result.status,409);assert.equal(result.data.code,'native_tool_reserved');
 assert.equal((await pool.query("SELECT count(*)::int n FROM guild_tools WHERE guild_key='guild_ar' AND tool_id='ar'")).rows[0].n,0);
});
