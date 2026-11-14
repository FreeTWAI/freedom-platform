import {forgetFrameOrigins,frameOrigins} from '../../modules/guild-tools/service.js';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {BRIDGE_VERSION,NATIVE_TOOL_ROUTES} from '../../modules/guild-tools/contract.js';
import {inspectTool,safeFrameOrigins,toolUrl} from '../../modules/guild-tools/validation.js';
import {createNodePreviewFetch} from '../../apps/platform-api/src/node-preview-fetch.js';
const url=process.env.TEST_DATABASE_URL;
assert.ok(url,'Set an isolated TEST_DATABASE_URL');
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
 await assert.rejects(inspectTool({...input,entry_url:'https://tools.example.test/',profile:'origin'},origin,async()=>new Response(''))); // HTML validation still applies before proof verification.
});
test('origin registration rejects project paths while sandboxed paths and a proven origin root work',async()=>{
 let proof='';app=createApp(pool,origin,'local',{linkPreviewFetch:async url=>url.endsWith('/.well-known/freedom-guild-tool.txt')?new Response(proof,{headers:{'content-type':'text/plain'}}):new Response('<html></html>',{headers:{'content-type':'text/html'}})});
 const leader=await login(2);await lead(leader,'guild_games');const base='/api/v1/guilds/guild_games/tools';
 for(const [i,entry_url] of ['https://owner.github.io/project/','https://tool.pages.dev/project/'].entries()){
  const challenge=await req(base+'/origin-challenges',leader,{entry_url});assert.equal(challenge.status,201);proof=challenge.data.contents;
  const body={...input,tool_id:'origin-path-'+i,entry_url,profile:'origin',origin_challenge_id:challenge.data.challenge_id};
  const refusal=await req(base,leader,body);assert.equal(refusal.status,422);assert.match(JSON.stringify(refusal.data),/隔離/);
  const sandboxed=await req(base,leader,{...input,tool_id:'sandbox-path-'+i,entry_url});assert.equal(sandboxed.status,201);
 }
 const entry_url='https://dedicated.pages.dev/';const challenge=await req(base+'/origin-challenges',leader,{entry_url});proof=challenge.data.contents;
 const accepted=await req(base,leader,{...input,tool_id:'root-origin',entry_url,profile:'origin',origin_challenge_id:challenge.data.challenge_id});assert.equal(accepted.status,201);assert.equal((await req(base+'/root-origin/accept',leader,{},1)).status,200);
});
test('current guild authority, acceptance, revisions, opaque subjects, report dedupe and CSP',async()=>{
 const leader=await login(0),other=await login(1),third=await login(2);await lead(leader,'guild_games');await lead(other,'guild_ar');
 const base='/api/v1/guilds/guild_games/tools';
 assert.equal((await req(base,other,input)).status,403);
 const registered=await req(base,leader,input);assert.equal(registered.status,201,JSON.stringify(registered));assert.equal(registered.data.state,'pending');
 const html=await app.request(origin+'/guild-tool-preview/'+registered.data.id);assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy')!,/https:\/\/tools.example.test/);
 // The preview's executable script is constant and allowed by its hash; the values ride in an inert data block.
 const previewHtml=await html.text(),previewCsp=html.headers.get('content-security-policy')!;
 const between=(open:string)=>{const start=previewHtml.indexOf(open);assert.ok(start>=0,open);const end=previewHtml.indexOf('</script>',start+open.length);assert.ok(end>0,open);return previewHtml.slice(start+open.length,end);};
 const previewData=JSON.parse(between('<script type="application/json" id="preview-data">'));
 assert.equal(previewData.preview_id,registered.data.id);assert.equal(previewData.platform_origin,origin);assert.equal(previewData.tool_id,'example');
 const previewScript=between('<script>');assert.ok(!previewScript.includes(registered.data.id)&&!previewScript.includes(origin),'no per-preview value is spliced into code');
 assert.ok(previewCsp.includes(`script-src 'sha256-${createHash('sha256').update(previewScript).digest('base64')}'`),'the CSP hash allows exactly the constant script');
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
 await pool.query('DELETE FROM positioning_guild_officers WHERE user_id=$1',[leader.user]);assert.equal((await req(base,leader,{...input,tool_id:'other'},1)).status,403);const revokedDraft=await req(base,leader,{...input,tool_id:'revoked'});assert.equal(revokedDraft.status,201);assert.ok(revokedDraft.data.draft_expires_at);await pool.query("UPDATE guild_tools SET draft_expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[revokedDraft.data.id]);await pool.query("DELETE FROM positioning_profession_memberships WHERE user_id=$1 AND guild_key='guild_games'",[leader.user]);assert.equal((await req(base,leader,{...input,tool_id:'revoked-member'})).status,403);
});
test('origin proof binds registrant/guild/origin; browser and agent exchange use a distinct bounded audience and revocation status',async()=>{
 const {generateKeyPair,exportJWK,SignJWT}=await import('jose');const {verifyToolToken}=await import('../../modules/guild-tools/tokens.js');const pair=await generateKeyPair('ES256'),jwk=await exportJWK(pair.publicKey),kid=randomUUID();let proof='';
 app=createApp(pool,origin,'local',{guildToolSigner:{privateKey:pair.privateKey,publicJwk:jwk,kid},linkPreviewFetch:async url=>url.endsWith('/.well-known/freedom-guild-tool.txt')?new Response(proof,{headers:{'content-type':'text/plain'}}):new Response('<html></html>',{headers:{'content-type':'text/html'}})});
 const leader=await login(0),other=await login(1);await lead(leader,'guild_games');const base='/api/v1/guilds/guild_games/tools',body={...input,tool_id:'origin-tool',entry_url:'https://tools.example.test/',profile:'origin',scopes:['context:read','session:exchange']};
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
test('delegates can add a first revision but cannot replace an enabled tool, and revoked grants do not authorize replay',async()=>{
 const leader=await login(0),delegate=await login(2);await lead(leader,'guild_games');await pool.query('INSERT INTO principals(user_ref) VALUES($1),($2) ON CONFLICT(user_ref) DO NOTHING',[leader.user,delegate.user]);await pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_games','active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,delegate.user]);const principals=(await pool.query('SELECT principal_id,user_ref FROM principals WHERE user_ref=ANY($1::uuid[])',[[leader.user,delegate.user]])).rows;const principal=(user:string)=>principals.find(r=>r.user_ref===user).principal_id;
 const delegation=randomUUID();await pool.query("INSERT INTO guild_launchpad_delegations(delegation_id,community_id,guild_key,principal_id,capabilities,granted_by_principal_id,expires_at,version,status) VALUES($1,$2,'guild_games',$3,ARRAY['guild.config.publish'],$4,clock_timestamp()+interval '1 hour',1,'active')",[delegation,DEMO_COMMUNITY,principal(delegate.user),principal(leader.user)]);
 const base='/api/v1/guilds/guild_games/tools',body={...input,tool_id:'delegated'},key=randomUUID();const r=await req(base,delegate,body,undefined,key);assert.equal(r.status,201);assert.equal((await req(base+'/delegated/accept',delegate,{},1)).status,200);
 assert.equal((await req(base+'/delegated/disable',delegate,{},1)).status,403);assert.equal((await req(base+'/delegated/context',leader)).status,200);
 const revised=await req(base,delegate,{...body,scopes:['context:read']},1);assert.equal(revised.status,403);assert.equal((await req(base+'/delegated/context',leader)).status,200);
 const leaderRevision=await req(base,leader,{...body,scopes:['context:read']},1);assert.equal(leaderRevision.status,201);assert.equal((await req(base+'/delegated/accept',delegate,{},2)).status,403);assert.equal((await req(base+'/delegated/accept',leader,{},2)).status,200);
 // A replacement attempt must not invalidate an already-issued token or hide the enabled tool.
 const {generateKeyPair,exportJWK}=await import('jose');const pair=await generateKeyPair('ES256'),jwk=await exportJWK(pair.publicKey);let proof='';
 app=createApp(pool,origin,'local',{guildToolSigner:{privateKey:pair.privateKey,publicJwk:jwk,kid:randomUUID()},linkPreviewFetch:async url=>url.endsWith('/.well-known/freedom-guild-tool.txt')?new Response(proof,{headers:{'content-type':'text/plain'}}):new Response('<html></html>',{headers:{'content-type':'text/html'}})});
 const original={...input,tool_id:'delegate-token-target',entry_url:'https://dedicated.example.test/',profile:'origin',scopes:['context:read','session:exchange']};
 const challenge=await req(base+'/origin-challenges',leader,{entry_url:original.entry_url});assert.equal(challenge.status,201);proof=challenge.data.contents;
 const target=await req(base,leader,{...original,origin_challenge_id:challenge.data.challenge_id});assert.equal(target.status,201);assert.equal((await req(base+'/delegate-token-target/accept',leader,{},1)).status,200);
 const token=await req(base+'/delegate-token-target/token',leader,{});assert.equal(token.status,200);
 const status=()=>req('/api/v1/public/guild-tool-token/status',undefined,{token:token.data.access_token,audience:target.data.id});assert.equal((await status()).data.active,true);
 const attack=await req(base,delegate,{...input,tool_id:original.tool_id,entry_url:'https://attacker.example.test/'},1);assert.equal(attack.status,403);
 const loaded=(await req('/api/v1/public/guilds/guild_games/tools')).data.items.find((item:any)=>item.tool_id===original.tool_id);assert.equal(loaded.state,'enabled');assert.equal(loaded.revision,1);assert.equal(loaded.entry_url,original.entry_url);
 assert.equal((await req(base+'/delegate-token-target/context',leader)).status,200);assert.equal((await status()).data.active,true);
 await pool.query("UPDATE guild_launchpad_delegations SET status='revoked',revoked_at=clock_timestamp(),revoke_reason='Synthetic revoke',version=version+1 WHERE delegation_id=$1",[delegation]);assert.equal((await req(base,delegate,body,undefined,key)).status,403);
});
test('admin disable HTTP rejects missing authority, CSRF, foreign admin and agent before mutation',async()=>{
 const {createAdminAccessVerifier}=await import('../../modules/platform-admin/access.js');
 const {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT}=await import('jose');const {randomBytes}=await import('node:crypto');
 const pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey),issuer='https://synthetic.cloudflareaccess.com',audience='guild-tool-admin';
 const verifier=createAdminAccessVerifier({issuer,audience,csrfSecret:randomBytes(32).toString('hex'),keySet:createLocalJWKSet({keys:[{...jwk,kid:'fixture',alg:'RS256'}]})});
 const guarded=createApp(pool,origin,'local',{adminVerifier:verifier});const foreignCommunity=randomUUID(),adminId=randomUUID(),foreignId=randomUUID(),toolId=randomUUID();
 await pool.query('INSERT INTO communities(community_id,name) VALUES($1,$2)',[foreignCommunity,'Synthetic foreign community']);
 const email='tool-admin-http@example.test',foreignEmail='tool-admin-foreign@example.test';
 await pool.query("INSERT INTO platform_admins(admin_id,community_id,email,display_name,role,active) VALUES($1,$2,$3,'Synthetic admin','super_admin',true),($4,$5,$6,'Foreign admin','super_admin',true)",[adminId,DEMO_COMMUNITY,email,foreignId,foreignCommunity,foreignEmail]);
 const makeIdentity=async(address:string)=>{const now=Math.floor(Date.now()/1000),jwt=await new SignJWT({type:'app',email:address,sub:randomUUID(),iss:issuer,aud:audience,iat:now,nbf:now,exp:now+600}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(pair.privateKey);return {jwt,csrf:(await verifier(new Request(origin,{headers:{'Cf-Access-Jwt-Assertion':jwt}}))).csrfToken};};
 const own=await makeIdentity(email),foreign=await makeIdentity(foreignEmail),member=await login(1);
 await pool.query("INSERT INTO guild_tools(id,community_id,guild_key,tool_id,state,title,entry_url,origin,bridge_version,profile,scopes,permissions,registered_by) VALUES($1,$2,'guild_games','admin-http-target','enabled','工具','https://admin-fixture.example/','https://admin-fixture.example',$3,'sandboxed','[\"context:read\"]','[]',$4)",[toolId,DEMO_COMMUNITY,BRIDGE_VERSION,member.user]);
 await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1',[member.user]);const agent=await req('/api/v1/me/agent-tokens',member,{name:'Synthetic tool test',scopes:['read']});assert.equal(agent.status,201);
 const request=(headers:Record<string,string>,key=randomUUID())=>guarded.request(origin+`/admin/api/guild-tools/${toolId}/disable`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,'If-Match':'\"1\"',...headers},body:JSON.stringify({reason:'Synthetic review'})});
 const unchanged=async()=>{const row=(await pool.query('SELECT state,revision FROM guild_tools WHERE id=$1',[toolId])).rows[0];assert.equal(row.state,'enabled');assert.equal(row.revision,1);assert.equal(Number((await pool.query('SELECT count(*) FROM guild_tool_audit WHERE tool=$1',[toolId])).rows[0].count),0);};
 const attempts:[string,Record<string,string>,number][]=[
  ['no identity',{},401],['member cookie',{Cookie:member.cookie},401],['missing CSRF',{'Cf-Access-Jwt-Assertion':own.jwt},403],
  ['wrong CSRF',{'Cf-Access-Jwt-Assertion':own.jwt,'X-Admin-CSRF':'invalid'},403],
  ['foreign admin',{'Cf-Access-Jwt-Assertion':foreign.jwt,'X-Admin-CSRF':foreign.csrf},404],
  ['agent bearer',{Authorization:'Bearer '+agent.data.access_token},403],
 ];
 for(const [name,headers,status] of attempts){assert.equal((await request(headers)).status,status,name);await unchanged();}
 const key=randomUUID(),valid={'Cf-Access-Jwt-Assertion':own.jwt,'X-Admin-CSRF':own.csrf};assert.equal((await request(valid,key)).status,200);
 assert.equal((await pool.query('SELECT state FROM guild_tools WHERE id=$1',[toolId])).rows[0].state,'disabled');assert.equal(Number((await pool.query('SELECT count(*) FROM guild_tool_audit WHERE tool=$1',[toolId])).rows[0].count),1);
 await pool.query('UPDATE platform_admins SET active=false WHERE admin_id=$1',[adminId]);assert.equal((await request(valid,key)).status,403);assert.equal(Number((await pool.query('SELECT count(*) FROM guild_tool_audit WHERE tool=$1',[toolId])).rows[0].count),1);
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

test('two page loads share one origins read; disabling removes the origin on the next load',async t=>{
 const leader=await login(0);await lead(leader,'guild_games');
 const base='/api/v1/guilds/guild_games/tools';
 const tool={...input,tool_id:'cache-test',entry_url:'https://cache.example.test/'};
 assert.equal((await req(base,leader,tool)).status,201);
 assert.equal((await req(base+'/cache-test/accept',leader,{},1)).status,200);
 const pageApp=createApp(pool,origin);
 pageApp.get('/',c=>c.html('<!doctype html><title>shell</title>'));
 forgetFrameOrigins();
 const query=pool.query.bind(pool);let reads=0;
 t.mock.method(pool,'query',((...args:any[])=>{
  if(typeof args[0]==='string'&&args[0].includes('SELECT DISTINCT origin FROM guild_tools'))reads++;
  return (query as any)(...args);
 }) as typeof pool.query);
 for(let i=0;i<2;i++){
  const page=await pageApp.request(origin+'/');assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy')!,/frame-src[^;]*https:\/\/cache.example.test/);
 }
 assert.equal(reads,1);
 assert.equal((await req(base+'/cache-test/disable',leader,{},1)).status,200);
 const page=await pageApp.request(origin+'/');assert.equal(page.status,200);
 assert.doesNotMatch(page.headers.get('content-security-policy')!,/cache.example.test/);assert.equal(reads,2);
});

test('resolved origin values expire after 60 seconds and failed reads after 10 seconds',async t=>{
 forgetFrameOrigins();t.after(forgetFrameOrigins);
 t.mock.timers.enable({apis:['Date'],now:0});let reads=0,fail=false;
 const fake={query:async()=>{reads++;if(fail)throw new Error('unavailable');return {rows:[{origin:'https://cache.example.test'}]};}} as unknown as Pool;
 assert.deepEqual(await frameOrigins(fake,origin),['https://cache.example.test']);
 t.mock.timers.tick(59_999);await frameOrigins(fake,origin);assert.equal(reads,1);
 t.mock.timers.tick(1);fail=true;assert.deepEqual(await frameOrigins(fake,origin),[]);assert.equal(reads,2);
 t.mock.timers.tick(9_999);assert.deepEqual(await frameOrigins(fake,origin),[]);assert.equal(reads,2);
 t.mock.timers.tick(1);fail=false;assert.deepEqual(await frameOrigins(fake,origin),['https://cache.example.test']);assert.equal(reads,3);
});

test('Worker hosting transport registers, proves origin and accepts only exact enabled frame origins',async()=>{
 const {createWorkerGuildToolFetch}=await import('../../apps/platform-api/src/worker-guild-tool-fetch.js');
 let proof='',calls=0;
 const transport=createWorkerGuildToolFetch(async url=>{calls++;return String(url).endsWith('/.well-known/freedom-guild-tool.txt')
  ?new Response(proof,{headers:{'content-type':'text/plain'}}):new Response('<html></html>',{headers:{'content-type':'text/html'}});});
 const prior=app;app=createApp(pool,origin,'local',{guildToolFetch:transport});
 try{
 const leader=await login(2);await lead(leader,'guild_games');const base='/api/v1/guilds/guild_games/tools';
 for(const entry_url of ['https://Tool.pages.dev/','https://tool.pages.dev:443/','https://%74ool.pages.dev/','https://tool.pages.dev./','https://other.example.test/']){
  const result=await req(base,leader,{...input,tool_id:'worker-tool',entry_url});assert.equal(result.status,422);assert.equal(calls,0);
 }
 const body={...input,tool_id:'worker-tool',entry_url:'https://a1b2.tool.pages.dev/',profile:'origin'};
 const challenge=await req(base+'/origin-challenges',leader,{entry_url:body.entry_url});assert.equal(challenge.status,201);proof=challenge.data.contents;
 const registered=await req(base,leader,{...body,origin_challenge_id:challenge.data.challenge_id});assert.equal(registered.status,201,JSON.stringify(registered));assert.equal(calls,2);
 assert.doesNotMatch((await app.request(origin+'/')).headers.get('content-security-policy')!,/a1b2\.tool\.pages\.dev/);
 assert.equal((await req(base+'/worker-tool/accept',leader,{},1)).status,200);
 const csp=(await app.request(origin+'/')).headers.get('content-security-policy')!;
 assert.match(csp,/frame-src[^;]*https:\/\/a1b2\.tool\.pages\.dev/);assert.doesNotMatch(csp,/\*\.pages\.dev|https:\/\/tool\.pages\.dev/);
 }finally{app=prior;}
});

test('I1: 20-character title registers and 21-character title is refused',async()=>{
 const leader=await login(0);await lead(leader,'guild_games');
 const base='/api/v1/guilds/guild_games/tools';
 const okTitle='一'.repeat(20);
 const ok=await req(base,leader,{...input,tool_id:'title-20',title:okTitle,entry_url:'https://tools.example.test/title20/'});
 assert.equal(ok.status,201,JSON.stringify(ok));
 assert.equal(ok.data.title,okTitle);
 const tooLong=await req(base,leader,{...input,tool_id:'title-21',title:'一'.repeat(21),entry_url:'https://tools.example.test/title21/'});
 assert.equal(tooLong.status,422);
});

test('I2: inspectTool parses frame-ancestors per policy and enforces platform origin, *, https:, or matching https://*.domain',async()=>{
 const html=(headers:Record<string,string>)=>async()=>new Response('<html></html>',{headers:{'content-type':'text/html',...headers}});
 const platform='https://app.freetwai.com';
 // Accepted cases
 for(const csp of [
  undefined,
  "default-src 'self'",
  `frame-ancestors ${platform}`,
  `FRAME-ANCESTORS 'self' ${platform}`,
  'frame-ancestors *',
  'frame-ancestors https:',
  'frame-ancestors https://*.freetwai.com',
  `default-src 'self', frame-ancestors ${platform}`,
 ]){
  const headers:Record<string,string>=csp===undefined?{}:{'content-security-policy':csp};
  const inspected=await inspectTool(input,platform,html(headers));
  assert.equal(inspected.origin,'https://tools.example.test',csp??'<none>');
 }
 // Refused cases (must keep tool_frame_refused)
 for(const headers of [
  {'content-security-policy':"frame-ancestors 'none'"},
  {'content-security-policy':"frame-ancestors 'self'"},
  {'content-security-policy':'frame-ancestors https://other.example.test'},
  {'content-security-policy':'frame-ancestors https://*.freetwai.com; default-src *',},
  {'content-security-policy':`frame-ancestors ${platform}, frame-ancestors 'self'`},
  {'content-security-policy':'frame-ancestors;'},
  {'x-frame-options':'SAMEORIGIN','content-security-policy':`frame-ancestors ${platform}`},
 ] as Record<string,string>[]){
  const testPlatform=headers['content-security-policy']?.includes('*.freetwai.com')?'https://evilfreetwai.com':platform;
  await assert.rejects(
   inspectTool(input,testPlatform,html(headers)),
   (err:any)=>err?.code==='tool_frame_refused'&&err?.status===422,
   JSON.stringify(headers),
  );
 }
 await assert.rejects(
  inspectTool(input,'https://freetwai.com',html({'content-security-policy':'frame-ancestors https://*.freetwai.com'})),
  (err:any)=>err?.code==='tool_frame_refused'&&err?.status===422,
 );
});

test('I3: inspectTool and verifyOriginChallenge follow up to 3 same-origin redirects and reject cross-origin or 4th redirect',async()=>{
 const urls:string[]=[];
 let cancelled=0;
 const ok=await inspectTool({...input,entry_url:'https://tools.example.test/app'},origin,async(url,init)=>{
  urls.push(String(url));
  assert.equal(init?.redirect,'manual');
  if(urls.length===1)return new Response(new ReadableStream({cancel(){cancelled++;}}),{status:301,headers:{location:'/app/'}});
  return new Response('<html></html>',{headers:{'content-type':'text/html'}});
 });
 assert.equal(ok.origin,'https://tools.example.test');
 assert.deepEqual(urls,['https://tools.example.test/app','https://tools.example.test/app/']);
 assert.equal(cancelled,1);

 for(const location of ['https://other.example.test/app/','/app/?secret=1','http://127.0.0.1/']){
  let calls=0,closed=false;
  await assert.rejects(
   inspectTool({...input,entry_url:'https://tools.example.test/app'},origin,async()=>{
    calls++;
    return new Response(new ReadableStream({cancel(){closed=true;}}),{status:302,headers:{location}});
   }),
   (err:any)=>err?.code==='tool_fetch_failed'&&err?.status===422,
   location,
  );
  assert.equal(calls,1,location);
  assert.equal(closed,true,location);
 }

 let fourCalls=0,fourCancelled=0;
 await assert.rejects(
  inspectTool({...input,entry_url:'https://tools.example.test/app'},origin,async()=>{
   fourCalls++;
   return new Response(new ReadableStream({cancel(){fourCancelled++;}}),{status:302,headers:{location:`/step-${fourCalls}`}});
  }),
  (err:any)=>err?.code==='tool_fetch_failed'&&err?.status===422,
 );
 assert.equal(fourCalls,4);
 assert.equal(fourCancelled,4);

 const {verifyOriginChallenge}=await import('../../modules/guild-tools/origin-proof.js');
 const leader=await login(0);await lead(leader,'guild_games');
 const actor={user_id:leader.user,community_id:DEMO_COMMUNITY} as any;
 const ch=(await req('/api/v1/guilds/guild_games/tools/origin-challenges',leader,{entry_url:'https://tools.example.test/'})).data;
 let proofCalls=0,proofCancelled=0;
 await verifyOriginChallenge(pool,actor,'guild_games','https://tools.example.test',ch.challenge_id,async(url,init)=>{
  proofCalls++;
  assert.equal(init?.redirect,'manual');
  if(proofCalls===1)return new Response(new ReadableStream({cancel(){proofCancelled++;}}),{status:302,headers:{location:'/.well-known/freedom-guild-tool.txt/'}});
  assert.equal(String(url),'https://tools.example.test/.well-known/freedom-guild-tool.txt/');
  return new Response(ch.contents,{headers:{'content-type':'text/plain'}});
 });
 assert.equal(proofCalls,2);
 assert.equal(proofCancelled,1);

 let crossProofCalls=0;
 await assert.rejects(
  verifyOriginChallenge(pool,actor,'guild_games','https://tools.example.test',ch.challenge_id,async()=>{
   crossProofCalls++;
   return new Response('',{status:302,headers:{location:'https://other.example.test/proof.txt'}});
  }),
  (err:any)=>err?.code==='origin_proof_failed'&&err?.status===422,
 );
 assert.equal(crossProofCalls,1);

 let fourProofCalls=0;
 await assert.rejects(
  verifyOriginChallenge(pool,actor,'guild_games','https://tools.example.test',ch.challenge_id,async()=>{
   fourProofCalls++;
   return new Response('',{status:302,headers:{location:`/p-${fourProofCalls}`}});
  }),
  (err:any)=>err?.code==='origin_proof_failed'&&err?.status===422,
 );
 assert.equal(fourProofCalls,4);
});

test('I4: Worker hosting transport accepts netlify.app and workers.dev into page frame-src CSP',async()=>{
 const {createWorkerGuildToolFetch}=await import('../../apps/platform-api/src/worker-guild-tool-fetch.js');
 const transport=createWorkerGuildToolFetch(async()=>new Response('<html></html>',{headers:{'content-type':'text/html'}}));
 const prior=app;app=createApp(pool,origin,'local',{guildToolFetch:transport});
 try{
  const leader=await login(2);await lead(leader,'guild_games');const base='/api/v1/guilds/guild_games/tools';
  for(const [id,entry_url] of [['netlify-tool','https://a.netlify.app/'],['workers-tool','https://a.b.workers.dev/']]){
   const reg=await req(base,leader,{...input,tool_id:id,entry_url});
   assert.equal(reg.status,201,JSON.stringify(reg));
   assert.equal((await req(`${base}/${id}/accept`,leader,{},1)).status,200);
  }
  const csp=(await app.request(origin+'/')).headers.get('content-security-policy')!;
  assert.match(csp,/frame-src[^;]*https:\/\/a\.netlify\.app/);
  assert.match(csp,/frame-src[^;]*https:\/\/a\.b\.workers\.dev/);
 }finally{app=prior;}
});

test('p3-l2b I2: plain member proposes up to 3 drafts (with origin proof), 4th returns 429, replacement refused, expired id reusable, agent refused',async()=>{
 const leader=await login(0),member=await login(1),otherMember=await login(2);
 await lead(leader,'guild_marketing');
 const addMember=async(u:string,g='guild_marketing')=>pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,$4,'active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,u,g]);
 await addMember(member.user);await addMember(otherMember.user);
 const base='/api/v1/guilds/guild_marketing/tools';
 const existing=await req(base,leader,{...input,tool_id:'leader-tool'});assert.equal(existing.status,201);
 assert.equal((await req(`${base}/leader-tool/accept`,leader,{},1)).status,200);
 // Plain member cannot replace an existing non-expired tool.
 assert.equal((await req(base,member,{...input,tool_id:'leader-tool'},1)).status,403);
 assert.equal((await req(base,member,{...input,tool_id:'leader-tool'})).status,403);
 // Agent of active guild member still cannot register.
 await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1',[member.user]);
 const agent=await req('/api/v1/me/agent-tokens',member,{name:'Draft agent',scopes:['read']});assert.equal(agent.status,201);
 const agentAttempt=await app.request(origin+base,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+agent.data.access_token,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({...input,tool_id:'agent-draft'})});
 assert.equal(agentAttempt.status,403);
 // Plain member can create an origin challenge and propose a draft with origin proof.
 let proof='';
 const priorApp=app;
 app=createApp(pool,origin,'local',{linkPreviewFetch:async u=>u.endsWith('/.well-known/freedom-guild-tool.txt')?new Response(proof,{headers:{'content-type':'text/plain'}}):new Response('<html></html>',{headers:{'content-type':'text/html'}})});
 try{
  const ch=await req(base+'/origin-challenges',member,{entry_url:'https://draft-origin.example.test/'});assert.equal(ch.status,201);
  proof=ch.data.contents;
  const d1=await req(base,member,{...input,tool_id:'draft-1',entry_url:'https://draft-origin.example.test/',profile:'origin',origin_challenge_id:ch.data.challenge_id});
  assert.equal(d1.status,201,JSON.stringify(d1));assert.equal(d1.data.state,'pending');assert.ok(d1.data.draft_expires_at);
  const row=(await pool.query('SELECT registered_by,state,draft_expires_at,EXTRACT(EPOCH FROM (draft_expires_at - created_at)) AS ttl FROM guild_tools WHERE id=$1',[d1.data.id])).rows[0];
  assert.equal(row.registered_by,member.user);assert.equal(row.state,'pending');assert.ok(row.ttl>=23*3600&&row.ttl<=25*3600);
  assert.equal((await req(base,member,{...input,tool_id:'draft-2'})).status,201);
  assert.equal((await req(base,member,{...input,tool_id:'draft-3'})).status,201);
  // 4th unexpired draft is refused with 429 and short zh-TW message.
  const fourth=await req(base,member,{...input,tool_id:'draft-4'});
  assert.equal(fourth.status,429,JSON.stringify(fourth));assert.match(fourth.data.detail,/草稿|上限|3/);
  // Another member in the same guild still has their own quota of 3.
  assert.equal((await req(base,otherMember,{...input,tool_id:'other-draft-1'})).status,201);
  // Expiring draft-1 frees its slot and allows registering draft-1 again in the same transaction.
  await pool.query("UPDATE guild_tools SET draft_expires_at=clock_timestamp()-interval '1 minute' WHERE guild_key='guild_marketing' AND tool_id='draft-1'");
  const replaced=await req(base,member,{...input,tool_id:'draft-1',title:'新草稿'});
  assert.equal(replaced.status,201,JSON.stringify(replaced));assert.equal(replaced.data.state,'pending');assert.equal(replaced.data.revision,2);assert.equal(replaced.data.title,'新草稿');
 }finally{app=priorApp;}
});
test('p3-l2b I3: draft visibility, accept clears expiry, withdraw rules, and preview window',async()=>{
 const leader=await login(0),member=await login(1),otherMember=await login(2);
 await lead(leader,'guild_ai_vibe');
 const addMember=async(u:string)=>pool.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_ai_vibe','active','full') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'",[randomUUID(),DEMO_COMMUNITY,u]);
 const base='/api/v1/guilds/guild_ai_vibe/tools',pub='/api/v1/public/guilds/guild_ai_vibe/tools';
 assert.equal((await req(base+'/access',otherMember)).data.member,false);
 await addMember(member.user);await addMember(otherMember.user);
 assert.deepEqual((await req(base+'/access',member)).data,{manage:false,leader:false,member:true,registration_available:true,token_exchange_available:true});
 assert.deepEqual((await req(base+'/access',leader)).data,{manage:true,leader:true,member:true,registration_available:true,token_exchange_available:true});
 // Leader registers a non-draft pending tool to verify 1h preview rule stays intact.
 const mgrPending=await req(base,leader,{...input,tool_id:'mgr-pending',title:'管理待審'});
 assert.equal(mgrPending.status,201);
 assert.equal((await app.request(origin+'/guild-tool-preview/'+mgrPending.data.id)).status,200);
 // Member proposes three drafts to test visibility, accept, withdraw, and preview.
 const d1=await req(base,member,{...input,tool_id:'vibe-d1',title:'草稿一'});assert.equal(d1.status,201);
 const d2=await req(base,member,{...input,tool_id:'vibe-d2',title:'草稿二'});assert.equal(d2.status,201);
 const d3=await req(base,member,{...input,tool_id:'vibe-d3',title:'草稿三'});assert.equal(d3.status,201);
 // Never in public tool list.
 assert.equal((await req(pub)).data.items.some((t:any)=>t.tool_id.startsWith('vibe-d')),false);
 // Visible to proposer and manager (with proposer name), NOT visible to another plain member.
 const memberList=await req(base,member);assert.equal(memberList.status,200,JSON.stringify(memberList));
 assert.equal(memberList.data.items.filter((t:any)=>t.tool_id.startsWith('vibe-d')).length,3);
 const leaderList=await req(base,leader);assert.equal(leaderList.status,200);
 const d1Leader=leaderList.data.items.find((t:any)=>t.tool_id==='vibe-d1');
 assert.equal(d1Leader.registered_by,member.user);assert.equal(d1Leader.registered_by_name,DEMO_USERS[1].display_name);
 const otherList=await req(base,otherMember);assert.equal(otherList.status,200);
 assert.equal(otherList.data.items.some((t:any)=>t.tool_id.startsWith('vibe-d')),false);
 // Preview: draft served past 1h until draft_expires_at; non-draft stops after 1h.
 await pool.query("UPDATE guild_tools SET updated_at=clock_timestamp()-interval '2 hours' WHERE id IN ($1,$2)",[d1.data.id,mgrPending.data.id]);
 assert.equal((await app.request(origin+'/guild-tool-preview/'+d1.data.id)).status,200);
 assert.equal((await app.request(origin+'/guild-tool-preview/'+mgrPending.data.id)).status,404);
 // Other plain member can neither accept nor withdraw someone's draft.
 assert.equal((await req(base+'/vibe-d1/accept',member,{},1)).status,403);
 assert.equal((await req(base+'/vibe-d1/accept',otherMember,{},1)).status,403);
 assert.equal((await req(base+'/vibe-d1/withdraw',otherMember,{},1)).status,403);
 // Withdraw follows same command rules as accept (If-Match, empty body, agent refused).
 assert.equal((await req(base+'/vibe-d1/withdraw',member,{})).status,428);
 assert.equal((await req(base+'/vibe-d1/withdraw',member,{},9)).status,412);
 assert.equal((await req(base+'/vibe-d1/withdraw',member,{extra:true},1)).status,422);
 await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1',[member.user]);
 const agent=await req('/api/v1/me/agent-tokens',member,{name:'Withdraw agent',scopes:['read']});assert.equal(agent.status,201);
 assert.equal((await app.request(origin+base+'/vibe-d1/withdraw',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+agent.data.access_token,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:'{}'})).status,403);
 // Proposer withdraws d1 -> state disabled, draft_expires_at <= now, preview 404, hidden from lists.
 const w1=await req(base+'/vibe-d1/withdraw',member,{},1);assert.equal(w1.status,200,JSON.stringify(w1));assert.equal(w1.data.state,'disabled');
 const w1Row=(await pool.query('SELECT state,(draft_expires_at IS NOT NULL AND draft_expires_at<=clock_timestamp()) AS expired FROM guild_tools WHERE id=$1',[d1.data.id])).rows[0];
 assert.equal(w1Row.state,'disabled');assert.equal(w1Row.expired,true);
 assert.equal((await app.request(origin+'/guild-tool-preview/'+d1.data.id)).status,404);
 assert.equal((await req(base,member)).data.items.some((t:any)=>t.tool_id==='vibe-d1'),false);
 assert.equal((await req(pub)).data.items.some((t:any)=>t.tool_id==='vibe-d1'),false);
 // Manager (leader) declines d2 via withdraw; manager cannot withdraw non-draft tool (409).
 const w2=await req(base+'/vibe-d2/withdraw',leader,{},1);assert.equal(w2.status,200,JSON.stringify(w2));assert.equal(w2.data.state,'disabled');
 assert.equal((await req(base+'/mgr-pending/withdraw',leader,{},1)).status,409);
 // Grant otherMember publish delegation: sees d3, declines/accepts work; test expired draft preview & accept rejection, then delegate accepts fresh draft.
 await pool.query('INSERT INTO principals(user_ref) VALUES($1),($2) ON CONFLICT(user_ref) DO NOTHING',[leader.user,otherMember.user]);
 const pRows=(await pool.query('SELECT principal_id,user_ref FROM principals WHERE user_ref=ANY($1::uuid[])',[[leader.user,otherMember.user]])).rows;
 const pId=(u:string)=>pRows.find(r=>r.user_ref===u).principal_id;
 await pool.query("INSERT INTO guild_launchpad_delegations(delegation_id,community_id,guild_key,principal_id,capabilities,granted_by_principal_id,expires_at,version,status) VALUES($1,$2,'guild_ai_vibe',$3,ARRAY['guild.config.publish'],$4,clock_timestamp()+interval '1 hour',1,'active')",[randomUUID(),DEMO_COMMUNITY,pId(otherMember.user),pId(leader.user)]);
 assert.equal((await req(base,otherMember)).data.items.some((t:any)=>t.tool_id==='vibe-d3'),true);
 // Expired draft cannot be previewed or accepted.
 await pool.query("UPDATE guild_tools SET draft_expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[d3.data.id]);
 assert.equal((await app.request(origin+'/guild-tool-preview/'+d3.data.id)).status,404);
 assert.equal((await req(base+'/vibe-d3/accept',leader,{},1)).status,409);
 // Re-proposed draft (revision 2) can be accepted by delegate with publish access, clearing draft_expires_at and making it public.
 const d3Re=await req(base,member,{...input,tool_id:'vibe-d3',title:'草稿三再版'});assert.equal(d3Re.status,201);assert.equal(d3Re.data.revision,2);
 const acc=await req(base+'/vibe-d3/accept',otherMember,{},2);assert.equal(acc.status,200,JSON.stringify(acc));assert.equal(acc.data.state,'enabled');
 const accRow=(await pool.query('SELECT state,draft_expires_at,accepted_by FROM guild_tools WHERE id=$1',[d3Re.data.id])).rows[0];
 assert.equal(accRow.state,'enabled');assert.equal(accRow.draft_expires_at,null);assert.equal(accRow.accepted_by,otherMember.user);
 // Former proposer cannot withdraw an accepted (enabled) tool (403); public list now includes it.
 assert.equal((await req(base+'/vibe-d3/withdraw',member,{},2)).status,403);
 const pubD3=(await req(pub)).data.items.find((t:any)=>t.tool_id==='vibe-d3');assert.equal(pubD3.state,'enabled');
});
