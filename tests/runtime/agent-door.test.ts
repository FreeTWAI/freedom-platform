import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {agentOperations} from '../../apps/platform-api/src/agent-allowlist.js';
import {agentBodySchemas,agentJsonSchema} from '../../apps/platform-api/src/agent-schemas.js';
import {z} from 'zod';
import {randomUUID,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {tokenHash} from '../../modules/identity-membership/service.js';
const origin='http://127.0.0.1:4310';
const url=process.env.TEST_DATABASE_URL!;
assert.ok(url?.includes('/fp_'),'explicit isolated database required');
const schema=`fp_agent_${process.pid}_${Date.now()}`,admin=createPool(url),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:12});
let shareFetchOffline=false,shareFetchCalls=0;
const app=createApp(pool,origin,'local',{eventParticipationEnabled:true,socialAchievementsEnabled:true,linkPreviewFetch:async url=>{shareFetchCalls++;if(shareFetchOffline)throw Error('synthetic upstream offline');return new Response('<title>Synthetic '+new URL(String(url)).pathname+'</title>',{headers:{'Content-Type':'text/html'}});}});
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{shareFetchOffline=false;shareFetchCalls=0;await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
type Session={cookie:string;csrf:string;user:any};
async function req(path:string,opts:{session?:Session;token?:string;body?:unknown;key?:string;method?:string;headers?:Record<string,string>}={}){
 const {session,token,body,key=randomUUID(),method=body===undefined?'GET':'POST'}=opts;
 const headers:Record<string,string>={...(session?{Origin:origin,Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...(token?{Authorization:'Bearer '+token}:{}),...opts.headers};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;}
 const response=await app.request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json() as any;
 if(token&&response.status>=200&&response.status<202){
  const op=agentOperations.find(op=>op.granted!==false&&op.method===method&&new RegExp('^'+op.route.replace(/:[a-z_]+/g,'[^/]+')+'$').test(path.split('?')[0]));
  if(op)assert.ok(z.fromJSONSchema(agentJsonSchema(agentBodySchemas[op.id])).safeParse(body??{}).success,`contract rejected runtime fixture for ${op.id}`);
 }
 return {status:response.status,data,response};
}
async function ready(index=0):Promise<Session>{
 const r=await req('/api/v1/auth/login',{body:{email:DEMO_USERS[index].email,password:DEMO_PASSWORD},headers:{Origin:origin}});assert.equal(r.status,200);
 await pool.query('UPDATE users SET onboarding_completed_at=now() WHERE user_id=$1',[r.data.user.user_id]);
 return {cookie:r.response.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrf_token,user:r.data.user};
}
async function issue(session:Session,scopes=['read','share','rsvp']){const r=await req('/api/v1/me/agent-tokens',{session,body:{name:'測試 Agent',scopes}});assert.equal(r.status,201,JSON.stringify(r.data));return r.data;}
const eventBody=()=>({title:'測試活動',description:'一起交流',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'online',location:'線上',capacity:30,visibility:'open'});

test('one-time hashed credential, browser-only lifecycle, rotation and immediate revocation',async()=>{
 const session=await ready(),issued=await issue(session);
 assert.match(issued.access_token,/^fw_agent_[A-Za-z0-9_-]{43}$/);
 const stored=(await pool.query('SELECT * FROM agent_token_connections WHERE connection_id=$1',[issued.connection_id])).rows[0];
 assert.equal(stored.token_hash,tokenHash(issued.access_token));assert.ok(!JSON.stringify(stored).includes(issued.access_token));
 assert.ok(Math.abs(new Date(stored.expires_at).getTime()-Date.now()-90*86400000)<5000);
 const listed=await req('/api/v1/me/agent-tokens',{session});assert.equal(listed.status,200);assert.ok(!JSON.stringify(listed.data).includes(issued.access_token));assert.ok(!JSON.stringify(listed.data).includes(stored.token_hash));
 assert.equal((await req('/api/v1/events',{token:issued.access_token})).status,200);
 const renewed=await req(`/api/v1/me/agent-tokens/${issued.connection_id}/renew`,{session,body:{name:'新連線',scopes:['read']}});assert.equal(renewed.status,201);
 assert.equal((await req('/api/v1/events',{token:issued.access_token})).status,401);
 assert.equal((await req('/api/v1/events',{token:renewed.data.access_token})).status,200);
 assert.equal((await req(`/api/v1/me/agent-tokens/${renewed.data.connection_id}/revoke`,{session,body:{}})).status,200);
 assert.equal((await req('/api/v1/events',{token:renewed.data.access_token})).status,401);
});
test('scope/default denial, mixed credentials, expired and inactive owner',async()=>{
 const session=await ready(),issued=await issue(session,['read']),token=issued.access_token;
 assert.equal((await req('/api/v1/events',{token,body:eventBody()})).status,403);
 assert.equal((await req('/api/v1/not-registered',{token})).status,403);
 assert.equal((await req('/api/v1/events',{token,session})).status,400);
 assert.equal((await req('/api/v1/events',{token,headers:{Cookie:'unrelated=value'}})).status,400);
 assert.equal((await req('/api/v1/events',{token,headers:{'X-Route-Pattern':'/api/v1/events'}})).status,200);
 await pool.query("UPDATE agent_token_connections SET expires_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[issued.connection_id]);
 assert.equal((await req('/api/v1/events',{token})).status,401);
 await pool.query("UPDATE agent_token_connections SET expires_at=clock_timestamp()+interval '1 day' WHERE connection_id=$1",[issued.connection_id]);
 await pool.query('UPDATE users SET active=false WHERE user_id=$1',[session.user.user_id]);
 assert.equal((await req('/api/v1/events',{token})).status,401);
});
const forbidden=[
 ['password','POST','/api/v1/me/password'],['TOTP','POST','/api/v1/me/totp/enable'],['email','POST','/api/v1/me/email'],
 ['issue token','POST','/api/v1/me/agent-tokens'],['list tokens','GET','/api/v1/me/agent-tokens'],
 ['renew token','POST',`/api/v1/me/agent-tokens/${randomUUID()}/renew`],['revoke token','POST',`/api/v1/me/agent-tokens/${randomUUID()}/revoke`],
 ['read credentials','GET','/api/v1/me/client-connections'],['pairing','POST','/api/v1/client-connections/start'],
 ['account deletion','POST','/api/v1/me/delete'],['payment','POST','/api/v1/payments'],['checkout','POST','/api/v1/checkout'],
 ['provider key','POST','/api/v1/me/model-settings'],['platform admin','GET','/admin/api/members'],['member admin','GET','/api/v1/admin/reports'],
 ['guild master review','POST',`/api/v1/events/${randomUUID()}/review`],['guild launchpad','POST','/api/v1/guilds/guild_test/launchpad/publish'],
 ['reaction','POST',`/api/v1/shares/${randomUUID()}/star`],['message','POST',`/api/v1/me/conversations/${randomUUID()}/messages`],
 ['public login','POST','/api/v1/auth/login'],['public alias','GET','/events'],
] as const;
for(const [family,method,path] of forbidden)test(`bearer cannot reach ${family}`,async()=>{
 const session=await ready(),issued=await issue(session);
 const r=await req(path,{token:issued.access_token,method,...(method==='POST'?{body:{}}:{})});assert.equal(r.status,403,JSON.stringify(r.data));assert.equal(r.data.code,'scope_required');
});
test('first exact publication waits for browser confirmation; replay, concurrency and daily cap',async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token,body=eventBody(),key=randomUUID(),path='/api/v1/events';
 assert.equal((await req(path,{token,body,key:''})).status,400);
 const pending=await req(path,{token,body,key});assert.equal(pending.status,202);assert.equal(pending.data.code,'pending_member');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM community_events WHERE organizer_ref=$1',[session.user.user_id])).rows[0].n,0);
 const list=await req('/api/v1/me/agent-tokens',{session}),proposal=list.data.items[0].pending_publication;
 assert.deepEqual(proposal.body,body);
 const other=await ready(1);assert.equal((await req(`/api/v1/me/agent-tokens/${issued.connection_id}/confirm`,{session:other,body:{request_sha256:proposal.request_sha256}})).status,404);
 assert.equal((await req(`/api/v1/me/agent-tokens/${issued.connection_id}/confirm`,{session,body:{request_sha256:proposal.request_sha256}})).status,200);
 assert.equal((await req(path,{token,body:{...body,title:'未核准內容'},key})).status,202);
 assert.equal((await req(path,{token,body,key})).status,202,'changing a pending proposal clears old consent');
 assert.equal((await req(`/api/v1/me/agent-tokens/${issued.connection_id}/confirm`,{session,body:{request_sha256:proposal.request_sha256}})).status,200);
 const created=await req(path,{token,body,key});assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.via_agent,true);assert.equal(created.data.organizer_ref,session.user.user_id);
 assert.deepEqual((await req(path,{token,body,key})).data,created.data);
 assert.equal((await pool.query('SELECT public_items FROM agent_daily_usage WHERE connection_id=$1',[issued.connection_id])).rows[0].public_items,1);
 assert.equal((await pool.query('SELECT via_agent FROM community_events WHERE event_id=$1',[created.data.event_id])).rows[0].via_agent,true);
 await pool.query('UPDATE agent_token_connections SET public_daily_cap=2 WHERE connection_id=$1',[issued.connection_id]);
 const concurrent=await Promise.all([req(path,{token,body:eventBody()}),req(path,{token,body:eventBody()})]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,429]);
 assert.equal((await req(path,{token,body,key})).status,201,'replay works at cap');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_publications WHERE connection_id=$1',[issued.connection_id])).rows[0].n,2);
});
test('only the organizer agent with share scope can update, announce and cancel, with version and replay protection',async()=>{
 const session=await ready(),other=await ready(1),issued=await issue(session,['read','share']),
  outsider=await issue(other,['share']),unscoped=await issue(session,['read']),revoked=await issue(session,['share']);
 assert.equal((await req(`/api/v1/me/agent-tokens/${revoked.connection_id}/revoke`,{session,body:{}})).status,200);
 const body=eventBody(),created=await req('/api/v1/events',{session,body});assert.equal(created.status,201);
 const id=created.data.event_id,foreign=randomUUID(),foreignEvent=randomUUID();
 await pool.query('INSERT INTO communities(community_id,name) VALUES($1,$2)',[foreign,'Synthetic foreign']);
 await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility)
  VALUES($1,$2,$3,'合成活動','合成內容','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z','online','線上','published','open')`,[foreignEvent,foreign,session.user.user_id]);
 const changes=[['update',{...body,title:'代理修改'}],['announcements',{message:'合成通知'}],['cancel',{}]] as const;
 for(const [operation,payload] of changes){
  const path=(eventId:string)=>`/api/v1/events/${eventId}/${operation}`,headers={'If-Match':`"${created.data.aggregate_version}"`};
  for(const [token,status] of [[outsider.access_token,403],[unscoped.access_token,403],[revoked.access_token,401]] as const){
   const response=await req(path(id),{token,body:payload,headers});assert.equal(response.status,status,`${operation}: ${JSON.stringify(response.data)}`);
  }
  const cross=await req(path(foreignEvent),{token:issued.access_token,body:payload,headers});assert.equal(cross.status,404,operation);
 }
 let version=Number(created.data.aggregate_version);
 for(const [operation,payload] of changes){
  const path=`/api/v1/events/${id}/${operation}`,token=issued.access_token,key=randomUUID();
  assert.equal((await req(path,{token,body:payload})).status,428,`${operation} requires If-Match`);
  assert.equal((await req(path,{token,body:payload,headers:{'If-Match':`"${version+10}"`}})).status,412,`${operation} rejects stale version`);
  const headers={'If-Match':`"${version}"`},response=await req(path,{token,body:payload,key,headers});
  assert.equal(response.status,200,`${operation}: ${JSON.stringify(response.data)}`);
  assert.deepEqual((await req(path,{token,body:payload,key,headers})).data,response.data,`${operation} replay`);
  version=Number(response.data.event_version??response.data.aggregate_version);
  if(operation==='announcements'){
   const browser=await req(path,{session,body:{message:'本人通知'},headers:{'If-Match':`"${version}"`}});assert.equal(browser.status,200);version=Number(browser.data.event_version);
   const third=await req(path,{token,body:{message:'第三則'},headers:{'If-Match':`"${version}"`}});assert.equal(third.status,200);version=Number(third.data.event_version);
   for(const credentials of [{token},{session}]){
    const limited=await req(path,{...credentials,body:{message:'超過限制'},headers:{'If-Match':`"${version}"`}});
    assert.equal(limited.status,429);assert.equal(limited.data.code,'event_announcement_limit');
   }
  }
 }
 const stored=(await pool.query('SELECT title,state FROM community_events WHERE event_id=$1',[id])).rows[0];
 assert.equal(stored.title,'代理修改');assert.equal(stored.state,'cancelled');
});

test('only ten consecutive counted failures suspend a token; success resets and 409/429 preserve the count',async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 const count=async()=>Number((await pool.query('SELECT failure_count FROM agent_token_connections WHERE connection_id=$1',[issued.connection_id])).rows[0].failure_count);
 for(let i=0;i<9;i++)assert.equal((await req('/api/v1/unlisted',{token})).status,403);
 assert.equal(await count(),9);assert.equal((await req('/api/v1/events',{token})).status,200);assert.equal(await count(),0);
 const {authenticateAgent,recordAgentResponse}=await import('../../modules/client-connections/agent-authority.js');
 const actor=await authenticateAgent(pool,'Bearer '+token);
 await recordAgentResponse(pool,actor,404);await recordAgentResponse(pool,actor,409);await recordAgentResponse(pool,actor,429);
 assert.equal(await count(),1);
 await recordAgentResponse(pool,actor,204);assert.equal(await count(),0);
 assert.equal((await req('/api/v1/unlisted',{token})).status,403);
 const idle=await req('/api/v1/agent/events',{token});assert.equal(idle.status,200);assert.equal(await count(),0,'an idle successful poll also resets failures');
 for(let i=0;i<10;i++)assert.equal((await req('/api/v1/unlisted',{token})).status,403);
 assert.equal((await req('/api/v1/events',{token})).status,401);
 const row=(await req('/api/v1/me/agent-tokens',{session})).data.items[0];assert.ok(row.suspended_at);assert.equal(row.failure_count,10);assert.ok(row.last_used_at);
});

test('the four agent preview, link and tool-token requests share a bounded per-token daily allowance',async()=>{
 const session=await shareMember();
 const event=await req('/api/v1/events',{session,body:eventBody()});assert.equal(event.status,201);
 const share=await req('/api/v1/shares',{session,body:{url:'https://example.com/budget'}});assert.equal(share.status,200);
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const signed=createApp(pool,origin,'local',{guildToolSigner:{privateKey:keys.privateKey,publicJwk:await crypto.subtle.exportKey('jwk',keys.publicKey),kid:randomUUID()}});
 await pool.query(`INSERT INTO guild_tools(id,community_id,guild_key,tool_id,state,title,entry_url,origin,bridge_version,profile,scopes,permissions,registered_by)
  SELECT $1,community_id,'guild_games','budget-tool','enabled','合成工具','https://tools.example.com/','https://tools.example.com','freedom.guild-launchpad/v2','origin','["context:read","session:exchange"]','[]',user_id FROM users WHERE user_id=$2`,[randomUUID(),session.user.user_id]);
 const operations=[
  ['/api/v1/shares/preview',{url:'https://example.com/budget-preview'}],
  [`/api/v1/shares/${share.data.share_id}/links`,{}],
  [`/api/v1/events/${event.data.event_id}/share`,{}],
  ['/api/v1/guilds/guild_games/tools/budget-tool/token',{}],
 ] as const;
 for(const [path,body] of operations){
  const issued=await issue(session),token=issued.access_token;
  const send=async()=>{
   if(!path.includes('/guilds/'))return req(path,{token,body});
   const response=await signed.request(origin+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});
   return {status:response.status,data:await response.json() as any};
  };
  for(let i=0;i<99;i++)assert.equal((await send()).status,200,`${path}, request ${i+1}`);
  const final=await Promise.all([send(),send()]);
  assert.deepEqual(final.map(result=>result.status).sort(),[200,429],path);
  assert.equal(final.find(result=>result.status===429)!.data.code,'agent_daily_cap',path);
 }
 const combined=await issue(session),independent=await issue(session),preview='/api/v1/shares/preview',previewBody={url:'https://example.com/combined'};
 const shareLink=`/api/v1/shares/${share.data.share_id}/links`;
 for(let i=0;i<99;i++)assert.equal((await req(shareLink,{token:combined.access_token,body:{}})).status,200);
 assert.equal((await req(`/api/v1/events/${event.data.event_id}/share`,{token:combined.access_token,body:{}})).status,200);
 const combinedLimit=await req(preview,{token:combined.access_token,body:previewBody});
 assert.equal(combinedLimit.status,429,'operations share one budget');assert.equal(combinedLimit.data.code,'agent_daily_cap');
 assert.equal((await req(shareLink,{token:independent.access_token,body:{}})).status,200,'another token has its own budget');
 await pool.query("UPDATE auth_rate_limits SET window_start=clock_timestamp()-interval '1 day' WHERE bucket=$1",[tokenHash(`agent-auxiliary/${combined.connection_id}`)]);
 assert.equal((await req(shareLink,{token:combined.access_token,body:{}})).status,200,'the budget renews after 24 hours');
});
test('own credential management cannot access another member and browser CSRF remains required',async()=>{
 const owner=await ready(),other=await ready(1),issued=await issue(owner);
 assert.equal((await req(`/api/v1/me/agent-tokens/${issued.connection_id}/revoke`,{session:other,body:{}})).status,404);
 assert.equal((await req('/api/v1/me/agent-tokens',{session:owner,body:{name:'test',scopes:['read']},headers:{'X-CSRF-Token':''}})).status,403);
 const reactToken=await req('/api/v1/me/agent-tokens',{session:owner,body:{name:'react-test',scopes:['react']}});
 assert.equal(reactToken.status,201,JSON.stringify(reactToken.data));
 assert.deepEqual(reactToken.data.scopes,['react']);
 assert.equal((await req('/api/v1/me/agent-tokens',{session:owner,body:{name:'test',scopes:['message']}})).status,422);
});

test('every registered non-allowlisted API route is denied before its handler, including every admin and guild action',async()=>{
 const {agentOperation}=await import('../../apps/platform-api/src/agent-allowlist.js');
 const session=await ready(),issued=await issue(session);
 let checked=0;
 for(const route of app.routes){
  if(route.method==='ALL'||!route.path.includes('/api')||agentOperation(route.method,route.path))continue;
  const path=route.path.replace(/:([A-Za-z_][A-Za-z_0-9]*)(\{[^}]*\})?/g,randomUUID()).replace(/\*/g,'denied');
  await pool.query('UPDATE agent_token_connections SET failure_count=0,suspended_at=NULL WHERE connection_id=$1',[issued.connection_id]);
  const r=await req(path,{token:issued.access_token,method:route.method,...(['GET','HEAD'].includes(route.method)?{}:{body:{}})});
  assert.equal(r.status,403,`${route.method} ${route.path}: ${r.data.code}`);checked++;
 }
 assert.ok(checked>300,`examined ${checked} registered routes`);
});

test('receipt namespaces are per token; session receipt is never replayed by a token',async()=>{
 const session=await ready(),one=await issue(session),two=await issue(session),body=eventBody(),key=randomUUID();
 // Same operation/key with browser authority has a distinct receipt namespace.
 const browser=await req('/api/v1/events',{session,body,key});assert.equal(browser.status,201);
 for(const token of [one.access_token,two.access_token])assert.equal((await req('/api/v1/events',{token,body,key})).status,202);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_pending_publications')).rows[0].n,2);
});

test('allowlisted RSVP, waitlist, own credit and notifications use current token authority',async()=>{
 const session=await ready(),other=await ready(1),issued=await issue(session),token=issued.access_token;
 const created=await req('/api/v1/events',{session,body:eventBody()});assert.equal(created.status,201);
 const id=created.data.event_id;
 await pool.query("UPDATE community_events SET state='published',waitlist_enabled=true,response_window_minutes=30 WHERE event_id=$1",[id]);
 const path=`/api/v1/events/${id}/rsvp`,key=randomUUID(),r=await req(path,{token,body:{going:true},key});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.my_rsvp,'going');
 assert.deepEqual((await req(path,{token,body:{going:true},key})).data,r.data);
 assert.equal((await req(`/api/v1/events/${id}`,{token})).status,200);
 assert.equal((await req(path,{token,body:{going:false}})).status,200);
 const current=await req(`/api/v1/events/${id}`,{token});
 const wait=await req(`/api/v1/events/${id}/waitlist`,{token,body:{action:'join'},headers:{'If-Match':`"${current.data.aggregate_version}"`}});assert.equal(wait.status,200,JSON.stringify(wait.data));
 for(const path of ['/me/contribution-records','/me/contribution-outcomes','/me/social-achievements']){
  const own=await req('/api/v1'+path,{token});assert.equal(own.status,200,`${path}: ${JSON.stringify(own.data)}`);
  assert.deepEqual(own.data,(await req('/api/v1'+path,{session})).data);
 }
 const {notifyMember}=await import('../../modules/member-communications/notifications.js');
 for(const member of [session,other])await notifyMember(pool,{community_id:(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[member.user.user_id])).rows[0].community_id,recipient_ref:member.user.user_id,kind:'friend_request',source_key:randomUUID(),title:'測試通知',body:member===session?'自己的通知':'別人的通知',action:null});
 const notifications=await req('/api/v1/me/notifications',{token});assert.equal(notifications.status,200,JSON.stringify(notifications.data));assert.ok(JSON.stringify(notifications.data).includes('自己的通知'));assert.ok(!JSON.stringify(notifications.data).includes('別人的通知'));
 assert.equal((await req(`/api/v1/members/${other.user.user_id}/contribution-outcomes`,{token})).status,403);
 assert.equal((await req('/api/v1/me/notifications?user_id='+other.user.user_id,{token})).status,422);
});

test('repository sharing uses existing import with hash-only credentials and member attribution',async t=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
  const url=String(input);assert.equal(new URL(url).hostname,'api.github.com');
  if(url.endsWith('/repos/example/project'))return Response.json({id:12345,full_name:'example/project',private:false,visibility:'public',default_branch:'main',fork:false,archived:false});
  if(url.endsWith('/commits/main'))return Response.json({sha:'a'.repeat(40)});
  if(url.includes('/license?ref='))return Response.json({path:'LICENSE',license:{spdx_id:'MIT'}});
  throw new Error('unexpected fixture request');
 });
 const body={repository_url:'https://github.com/example/project',title:'範例專案',description:'專案介紹',use_notes:'讀取 README',relationship:'curator',consent_to_share:true},key=randomUUID(),path='/api/v1/opensource/projects';
 assert.equal((await req(path,{token,body,key})).status,202);
 const list=await req('/api/v1/me/agent-tokens',{session});
 await req(`/api/v1/me/agent-tokens/${issued.connection_id}/confirm`,{session,body:{request_sha256:list.data.items[0].pending_publication.request_sha256}});
 const result=await req(path,{token,body,key});assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.owner_ref,session.user.user_id);assert.equal(result.data.via_agent,true);
 assert.deepEqual((await req(path,{token,body,key})).data,result.data);
});

test('public guide and generated contract describe exactly the granted operations without credentials',async()=>{
 const {agentOperations}=await import('../../apps/platform-api/src/agent-allowlist.js');
 const response=await app.request(origin+'/agent.md'),guide=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/text\/markdown/);
 assert.ok(guide.includes('Idempotency-Key'));assert.ok(guide.includes(origin+'/api/v1/mcp'));assert.ok(guide.includes('tools/list'));assert.ok(guide.includes('2025-11-25'));assert.ok(!/fw_agent_[A-Za-z0-9_-]{43}/.test(guide));
 assert.ok(!guide.includes('分支'));
 assert.ok(guide.includes('read 讀取')&&guide.includes('share 分享')&&guide.includes('rsvp 報名'));
 assert.ok(guide.includes('query'));
 assert.ok(guide.includes('{"name":"events.read","arguments":{"id":"<event uuid>"}}'));
 for(const op of agentOperations.filter(op=>op.granted!==false)){
  assert.ok(guide.includes(`"name":"${op.id}"`),`missing tools/call example for ${op.id}`);
 }
 for(const id of ['events.share','credit.read','shares.create','notifications.mark_all_read','guilds.list','posts.note','services.create','works.create','profile.read']){
  const op=agentOperations.find(entry=>entry.id===id&&entry.granted!==false)!;
  assert.ok(op,`missing op ${id}`);
  assert.ok(guide.includes(`### ${op.title} (`),`missing guide title for ${id}`);
  assert.ok(guide.includes(`${op.method} ${op.route}\nMCP tools/call：\``),`missing REST/MCP pair for ${id}`);
  assert.ok(guide.includes(`"name":"${op.id}"`),`missing MCP tools/call example for ${id}`);
 }
 assert.ok(guide.includes('"consent_to_share":true'),'missing works.create consent_to_share example');
 assert.ok(guide.includes('{"name":"profile.read","arguments":{}}'),'missing profile.read MCP example');
 assert.ok(guide.includes(`curl -H "Authorization: Bearer $FREEDOM_AGENT_TOKEN" "${origin}/api/v1/me/positioning"`),'missing profile.read REST curl example');
 assert.equal(guide.includes('先 GET 活動讀取 aggregate_version'),false,'ifMatch guidance must be item-neutral');
 assert.equal(guide.includes('先讀取該項目，取得 aggregate_version。'),true,'missing neutral aggregate_version guidance');
 for(const forbidden of ['/api/v1/me/showcases/:id/sharing','/api/v1/social-posts/:id/public-sharing','/api/v1/me/account','/api/v1/me/profile-publication','/api/v1/me/conversations']){
  assert.equal(guide.includes(forbidden),false,`unexpected member-only route in guide: ${forbidden}`);
 }
 assert.ok((await (await app.request(origin+'/llms.txt')).text()).includes('/agent.md'));
 const contract=await (await app.request(origin+'/agent/openapi.json')).json() as any;
 assert.deepEqual(Object.values(contract.paths).flatMap((p:any)=>Object.values(p).map((op:any)=>op.operationId)).sort(),agentOperations.filter(op=>op.granted!==false).map(op=>op.id).sort());
 assert.equal(contract.paths['/shares/{share_id}/star'],undefined);
});

test('contract --check detects a changed allowlist and a changed generated artifact',async()=>{
 const {mkdtempSync,mkdirSync,copyFileSync,appendFileSync,readFileSync,writeFileSync,rmSync,symlinkSync,readdirSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,dirname}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'agent-contract-test-'));
 try{
  const files=['scripts/build-agent-contract.mjs','apps/platform-api/src/agent-allowlist.ts','contracts/agent/v1/openapi.json','apps/portal-web/src/modules/agent-operations.ts','modules/client-connections/agent-contract.ts'];
  for(const file of files){mkdirSync(dirname(join(dir,file)),{recursive:true});copyFileSync(file,join(dir,file));}
  writeFileSync(join(dir,'package.json'),'{"type":"module"}');
  symlinkSync(process.cwd()+'/node_modules',join(dir,'node_modules'));
  symlinkSync(process.cwd()+'/packages',join(dir,'packages'));
  for(const name of readdirSync('modules'))if(name!=='client-connections')symlinkSync(process.cwd()+'/modules/'+name,join(dir,'modules',name));
  for(const name of readdirSync('modules/client-connections'))if(name!=='agent-contract.ts')symlinkSync(process.cwd()+'/modules/client-connections/'+name,join(dir,'modules/client-connections',name));
  copyFileSync('apps/platform-api/src/agent-schemas.ts',join(dir,'apps/platform-api/src/agent-schemas.ts'));
  const check=()=>spawnSync(process.execPath,['scripts/build-agent-contract.mjs','--check'],{cwd:dir,encoding:'utf8'});
  assert.equal(check().status,0);
  appendFileSync(join(dir,files[2]),' ');assert.equal(check().status,1);
  copyFileSync(files[2],join(dir,files[2]));
  const schemaFile=join(dir,'apps/platform-api/src/agent-schemas.ts');
  writeFileSync(schemaFile,readFileSync(schemaFile,'utf8').replace('max(100)','max(99)'));assert.equal(check().status,1);
  copyFileSync('apps/platform-api/src/agent-schemas.ts',schemaFile);
  const table=join(dir,files[1]);writeFileSync(table,readFileSync(table,'utf8').replace("title:'查看活動'","title:'活動列表'"));assert.equal(check().status,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('change feed is member-bound, cursor-paged, and does not skip late commits or expose message bodies',async()=>{
 const session=await ready(),other=await ready(1),issued=await issue(session),otherToken=await issue(other),token=issued.access_token;
 const community=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[session.user.user_id])).rows[0].community_id;
 const empty=await req('/api/v1/agent/events',{token});assert.equal(empty.status,200);const start=empty.data.next_cursor;
 const {notifyMember}=await import('../../modules/member-communications/notifications.js');
 const delayed=await pool.connect();
 try{
  await delayed.query('BEGIN');
  await notifyMember(delayed,{community_id:community,recipient_ref:session.user.user_id,kind:'event_approved',source_key:randomUUID(),title:'核准',body:'測試',action:{tab:'events',resource_id:randomUUID()}});
  await pool.query('INSERT INTO member_direct_messages(community_id,sender_ref,recipient_ref,body) VALUES($1,$2,$3,$4)',[community,other.user.user_id,session.user.user_id,'不應回傳的正文']);
  const first=await req('/api/v1/agent/events?after='+start,{token});assert.equal(first.status,200);assert.deepEqual(first.data.items.map((e:any)=>e.kind),['message.received']);assert.ok(!JSON.stringify(first.data).includes('不應回傳的正文'));
  await delayed.query('COMMIT');
  const late=await req('/api/v1/agent/events?after='+first.data.next_cursor,{token});assert.equal(late.status,200);assert.deepEqual(late.data.items.map((e:any)=>e.kind),['event.approved']);
  assert.equal((await req('/api/v1/agent/events?after='+late.data.next_cursor,{token:otherToken.access_token})).status,400);
  assert.deepEqual((await req('/api/v1/agent/events',{token:otherToken.access_token})).data.items,[]);
  for(let i=0;i<105;i++)await pool.query('SELECT record_agent_change($1,$2,$3,$4,$5)',[community,session.user.user_id,'share.credited','synthetic-credit/'+i,randomUUID()]);
  const page1=await req('/api/v1/agent/events?after='+late.data.next_cursor,{token});assert.equal(page1.data.items.length,100);assert.equal(page1.data.has_more,true);
  const page2=await req('/api/v1/agent/events?after='+page1.data.next_cursor,{token});assert.equal(page2.data.items.length,5);assert.equal(new Set([...page1.data.items,...page2.data.items].map((e:any)=>e.event_id)).size,105);
  assert.deepEqual((await req('/api/v1/agent/events?after='+page2.data.next_cursor,{token})).data.items,[]);
 }finally{await delayed.query('ROLLBACK');delayed.release();}
});

test('an idle agent events HTTP poll uses at most three statements and conditionally clears failures',async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 const first=await req('/api/v1/agent/events',{token});assert.equal(first.status,200);
 let cursor=first.data.next_cursor,more=first.data.has_more;
 while(more){const page=await req('/api/v1/agent/events?after='+encodeURIComponent(cursor),{token});assert.equal(page.status,200);cursor=page.data.next_cursor;more=page.data.has_more;}
 const statements:string[]=[];
 const counted=new Proxy(pool,{get(target,key){
  if(key==='query')return (...args:any[])=>{statements.push(String(args[0]));return (target.query as any)(...args);};
  if(key==='connect')return async()=>{const client=await target.connect();return new Proxy(client,{get(c,property){
   if(property==='query')return (...args:any[])=>{statements.push(String(args[0]));return (c.query as any)(...args);};
   const value=Reflect.get(c,property);return typeof value==='function'?value.bind(c):value;
  }});};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const observed=createApp(counted,origin,'local',{eventParticipationEnabled:true,socialAchievementsEnabled:true});
 const response=await observed.request(origin+'/api/v1/agent/events?after='+encodeURIComponent(cursor),{headers:{Authorization:'Bearer '+token}});
 assert.equal(response.status,200);const body=await response.json() as any;assert.deepEqual(body.items,[]);assert.equal(body.next_cursor,cursor);
 const locks=statements.filter(sql=>/\bFOR\s+(?:UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b|^\s*(?:INSERT|DELETE)\b/i.test(sql));
 assert.ok(statements.length<=3,`idle poll issued ${statements.length} statements`);
 assert.deepEqual(locks,[],`idle poll acquired a row lock`);
 const updates=statements.filter(sql=>/^\s*UPDATE\b/i.test(sql));
 assert.equal(updates.length,1);assert.match(updates[0],/WHERE connection_id=\$1 AND failure_count<>0/);
});

test('RSVP and notification producers emit confirmed, updated and waitlist invitation changes',async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 const created=await req('/api/v1/events',{session,body:eventBody()}),id=created.data.event_id;
 await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[id]);
 const r=await req(`/api/v1/events/${id}/rsvp`,{token,body:{going:true}});assert.equal(r.status,200);
 const {notifyMember}=await import('../../modules/member-communications/notifications.js');
 await pool.query("UPDATE community_events SET description='更新內容',aggregate_version=aggregate_version+1 WHERE event_id=$1",[id]);
 for(const kind of ['event_waitlist_invited'] as const)await notifyMember(pool,{community_id:created.data.community_id,recipient_ref:session.user.user_id,kind,source_key:randomUUID(),title:'測試',body:'測試通知',action:{tab:'events',resource_id:id}});
 const feed=await req('/api/v1/agent/events',{token});assert.equal(feed.status,200);for(const kind of ['rsvp.confirmed','event.updated','rsvp.waitlist_promoted'])assert.ok(feed.data.items.some((e:any)=>e.kind===kind),kind);
 const readonly=await issue(session,['rsvp']);assert.equal((await req('/api/v1/agent/events',{token:readonly.access_token})).status,403);
});

test('a guild master token cannot read another member pending event through list, detail or RSVP cancellation',async()=>{
 const owner=await ready(),reviewer=await ready(1),issued=await issue(reviewer);
 const created=await req('/api/v1/events',{session:owner,body:eventBody()});assert.equal(created.status,201);assert.equal(created.data.state,'published');
 await pool.query("UPDATE community_events SET state='pending' WHERE event_id=$1",[created.data.event_id]);
 await pool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state)
 VALUES($1,$2,$3,$4,'active') ON CONFLICT DO NOTHING`,[randomUUID(),created.data.community_id,reviewer.user.user_id,created.data.review_guild_key]);
 await pool.query('INSERT INTO positioning_guild_officers(community_id,guild_key,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[created.data.community_id,created.data.review_guild_key,reviewer.user.user_id]);
 const path='/api/v1/events/'+created.data.event_id;
 assert.equal((await req(path,{session:reviewer})).status,200,'browser reviewer retains existing authority');
 assert.equal((await req(path,{token:issued.access_token})).status,404);
 const list=await req('/api/v1/events',{token:issued.access_token});assert.equal(list.status,200);assert.ok(!list.data.items.some((e:any)=>e.event_id===created.data.event_id));
 assert.equal((await req(path+'/rsvp',{token:issued.access_token,body:{going:false}})).status,404);
 assert.equal((await pool.query('SELECT 1 FROM community_event_rsvps WHERE event_id=$1 AND user_id=$2',[created.data.event_id,reviewer.user.user_id])).rowCount,0);
 await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[created.data.event_id]);
 const key=randomUUID();assert.equal((await req(path+'/rsvp',{token:issued.access_token,body:{going:true},key})).status,200);
 await pool.query("UPDATE community_events SET state='pending' WHERE event_id=$1",[created.data.event_id]);
 assert.equal((await req(path+'/rsvp',{token:issued.access_token,body:{going:true},key})).status,404,'receipt replay rechecks current non-review visibility');
});

test('expiry during a real domain wait rejects data and rolls back writes; revocation winning the credential lock rejects reads',async()=>{
 const {setImmediate}=await import('node:timers/promises');
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 const created=await req('/api/v1/events',{session,body:eventBody()}),id=created.data.event_id;
 await pool.query("UPDATE community_events SET state='published' WHERE event_id=$1",[id]);
 for(const mode of ['read-expiry','write-expiry','revoke'] as const){
  const gate=await admin.connect();let pending:Promise<Awaited<ReturnType<typeof req>>>|undefined;
  try{
   await pool.query("UPDATE agent_token_connections SET expires_at=clock_timestamp()+interval '2 seconds',revoked_at=NULL WHERE connection_id=$1",[issued.connection_id]);
   await gate.query('BEGIN');
   if(mode==='revoke')await gate.query(`UPDATE ${schema}.agent_token_connections SET revoked_at=clock_timestamp() WHERE connection_id=$1`,[issued.connection_id]);
   else await gate.query(`LOCK TABLE ${schema}.community_events IN ACCESS EXCLUSIVE MODE`);
   const pid=(await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
   pending=mode==='write-expiry'?req(`/api/v1/events/${id}/rsvp`,{token,body:{going:true}}):req('/api/v1/events',{token});
   const deadline=Date.now()+1500;
   while(!(await admin.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid])).rowCount){assert.ok(Date.now()<deadline,'request reached the database lock');await setImmediate();}
   if(mode!=='revoke')await admin.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM expires_at-clock_timestamp()))+0.05) FROM ${schema}.agent_token_connections WHERE connection_id=$1`,[issued.connection_id]);
   await gate.query(mode==='revoke'?'COMMIT':'ROLLBACK');
   const response=await pending;assert.equal(response.status,401);assert.equal(response.data.code,'agent_token_invalid');assert.equal(response.data.items,undefined);
   assert.equal((await pool.query('SELECT 1 FROM community_event_rsvps WHERE event_id=$1',[id])).rowCount,0);
  }finally{await gate.query('ROLLBACK');gate.release();if(pending)await pending;}
 }
});

async function shareMember(index=0){
 const session=await ready(index);
 await pool.query('UPDATE users SET email=$2 WHERE user_id=$1',[session.user.user_id,`agent-share-${index}@example.com`]);
 return session;
}
async function confirmShare(session:Session,connectionId:string){
 const list=await req('/api/v1/me/agent-tokens',{session});
 const pending=list.data.items.find((i:any)=>i.connection_id===connectionId).pending_publication;
 assert.ok(pending);
 assert.equal((await req(`/api/v1/me/agent-tokens/${connectionId}/confirm`,{session,body:{request_sha256:pending.request_sha256}})).status,200);
}
test('shares: read/share scopes stay separate, report/claim/star and unknown routes deny, mixed credentials reject',async()=>{
 const session=await shareMember(),read=await issue(session,['read']),write=await issue(session,['share']);
 const body={url:'https://example.com/scope'};
 assert.equal((await req('/api/v1/shares/preview',{token:read.access_token,body})).status,403);
 assert.equal((await req('/api/v1/shares',{token:read.access_token,body})).status,403);
 assert.equal((await req('/api/v1/shares/preview',{token:write.access_token,body})).status,200);
 assert.equal((await req('/api/v1/shares',{token:write.access_token})).status,403);
 assert.equal((await req('/api/v1/me/credit',{token:write.access_token})).status,403);
 assert.equal((await req('/api/v1/shares',{token:read.access_token})).status,200);
 assert.equal((await req('/api/v1/me/credit',{token:read.access_token})).status,200);
 const full=await issue(session),id=randomUUID();
 for(const suffix of ['report','claim','star','delete','anything'])assert.equal((await req(`/api/v1/shares/${id}/${suffix}`,{token:full.access_token,body:{reason:'synthetic'}})).status,403,suffix);
 assert.equal((await req(`/s/${id}`,{token:full.access_token})).status,403);
 for(const path of ['/api/v1/shares','/api/v1/me/credit'])assert.equal((await req(path,{token:full.access_token,session})).status,400);
 assert.equal((await req('/api/v1/shares',{token:full.access_token,session,body})).status,400);
});
test('shares: A token cannot list, read, retract or link B shares, including receipt replay after visibility changes',async()=>{
 const a=await shareMember(),b=await shareMember(1),issued=await issue(a),token=issued.access_token;
 const own=await req('/api/v1/shares',{session:a,body:{url:'https://example.com/a',text:'private editor note'}});
 const other=await req('/api/v1/shares',{session:b,body:{url:'https://example.com/b',text:'B private editor note'}});
 assert.equal(own.status,200);assert.equal(other.status,200);
 const id=own.data.share_id,foreign=other.data.share_id;
 const listed=await req('/api/v1/shares',{token});assert.equal(listed.status,200);assert.deepEqual(listed.data.items.map((i:any)=>i.share_id),[id]);
 const detail=await req(`/api/v1/shares/${id}`,{token});assert.equal(detail.status,200);assert.ok(!JSON.stringify(detail.data).includes('private editor note'));assert.equal(detail.data.editor_notes,undefined);
 for(const suffix of ['','/retract','/links'])assert.equal((await req(`/api/v1/shares/${foreign}${suffix}`,{token,...(suffix?{body:{}}:{})})).status,404,suffix);
 assert.equal((await req('/api/v1/shares?user_id='+b.user.user_id,{token})).status,422);
 const credit=await req('/api/v1/me/credit',{token});assert.equal(credit.status,200);assert.ok(credit.data.items.length);assert.ok(credit.data.items.every((i:any)=>i.share_id===id));
 const key=randomUUID();assert.equal((await req(`/api/v1/shares/${id}/links`,{token,body:{},key})).status,200);
 await assert.rejects(pool.query('UPDATE shares SET first_sharer_user_id=$2 WHERE share_id=$1',[id,b.user.user_id]),/identity is immutable/);
 assert.equal((await req(`/api/v1/shares/${id}/retract`,{session:a,body:{}})).status,200);
 assert.equal((await req(`/api/v1/shares/${id}/links`,{token,body:{},key})).status,404,'cached link is not replayed after retraction');
 assert.equal((await pool.query("SELECT state FROM shares WHERE share_id=$1",[foreign])).rows[0].state,'published');
 assert.equal((await pool.query('SELECT count(*)::int n FROM promotion_links WHERE target_key=$1',[foreign])).rows[0].n,0);
});
test('shares: first publication waits for exact browser consent, offline replay is per token, and concurrent daily cap holds at twenty',async()=>{
 const session=await shareMember(),issued=await issue(session),token=issued.access_token,path='/api/v1/shares',body={url:'https://example.com/first'},key=randomUUID();
 assert.equal((await req(path,{token,body,key})).status,202);
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares')).rows[0].n,0);
 await confirmShare(session,issued.connection_id);
 const created=await req(path,{token,body,key});assert.equal(created.status,200,JSON.stringify(created.data));assert.equal(created.data.via_agent,true);
 const fetches=shareFetchCalls;shareFetchOffline=true;
 assert.deepEqual((await req(path,{token,body,key})).data,created.data);assert.equal(shareFetchCalls,fetches,'replay does not read upstream');shareFetchOffline=false;
 assert.equal((await req(path,{token,body:{url:'https://example.com/changed'},key})).status,409);
 for(let i=1;i<19;i++)assert.equal((await req(path,{token,body:{url:`https://example.com/item/${i}`}})).status,200);
 const final=await Promise.all([19,20].map(i=>req(path,{token,body:{url:`https://example.com/item/${i}`}})));
 assert.deepEqual(final.map(r=>r.status).sort(),[200,429]);assert.equal(final.find(r=>r.status===429)!.data.code,'agent_daily_cap');
 assert.equal((await pool.query('SELECT public_items FROM agent_daily_usage WHERE connection_id=$1',[issued.connection_id])).rows[0].public_items,20);
 assert.equal((await pool.query('SELECT count(*)::int n FROM agent_publications WHERE connection_id=$1',[issued.connection_id])).rows[0].n,20);
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares WHERE first_sharer_user_id=$1',[session.user.user_id])).rows[0].n,20);
 shareFetchOffline=true;assert.deepEqual((await req(path,{token,body,key})).data,created.data);
 const second=await issue(session);assert.equal((await req(path,{token:second.access_token,body,key})).status,202,'a different token cannot replay a confirmed publication');
 const retractKey=randomUUID(),retract=`${path}/${created.data.share_id}/retract`;
 assert.equal((await req(retract,{token,body:{},key:retractKey})).status,200);
 assert.equal((await req(retract,{token,body:{},key:retractKey})).status,200);
 assert.equal((await req(`${path}/${created.data.share_id}`,{token})).status,404);
});

test('shares: source privacy and receipt authority remain current; browser receipts never become agent receipts',async()=>{
 const session=await shareMember(),issued=await issue(session),token=issued.access_token,path='/api/v1/shares',body={url:'https://example.com/namespace'},key=randomUUID();
 const browser=await req(path,{session,body,key});assert.equal(browser.status,200);
 assert.equal((await req(path,{token,body,key})).status,202);await confirmShare(session,issued.connection_id);
 const agent=await req(path,{token,body,key});assert.equal(agent.status,200);assert.equal(agent.data.created,false);assert.equal(agent.data.via_agent,true);
 assert.equal((await pool.query('SELECT count(*)::int n FROM command_receipts WHERE user_id=$1 AND idempotency_key=$2',[session.user.user_id,key])).rows[0].n,2);
 const foreign=await shareMember(1),foreignShare=await req(path,{session:foreign,body:{url:'https://example.com/foreign'}});
 assert.equal(foreignShare.status,200);
 const coShare=await req(path,{token,body:{url:'https://example.com/foreign'}});
 assert.equal(coShare.status,200,'A token may add its own member endorsement to a canonical object');
 assert.equal(coShare.data.share_id,foreignShare.data.share_id);
 assert.equal((await pool.query('SELECT first_sharer_user_id FROM shares WHERE share_id=$1',[coShare.data.share_id])).rows[0].first_sharer_user_id,foreign.user.user_id);
 assert.equal((await pool.query('SELECT count(*)::int n FROM share_endorsements WHERE share_id=$1 AND withdrawn_at IS NULL',[coShare.data.share_id])).rows[0].n,2);
 const eventId=randomUUID();
 await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
 SELECT $1,community_id,user_id,'private source fixture','synthetic',now()+interval '1 day',now()+interval '25 hours','online','online','published','open','other' FROM users WHERE user_id=$2`,[eventId,session.user.user_id]);
 const eventBody={kind:'event',ref_id:eventId},eventKey=randomUUID();
 const shared=await req(path,{token,body:eventBody,key:eventKey});assert.equal(shared.status,200,JSON.stringify(shared.data));
 await pool.query("UPDATE community_events SET state='cancelled' WHERE event_id=$1",[eventId]);
 assert.equal((await req(`${path}/${shared.data.share_id}`,{token})).status,404);
 assert.equal((await req(path,{token,body:eventBody,key:eventKey})).status,404,'publication receipt does not reveal withdrawn source');
 const credit=await req('/api/v1/me/credit',{token});assert.equal(credit.status,200);assert.ok(!JSON.stringify(credit.data).includes('private source fixture'));
});

test('shares: committed credit reaches only its member feed once; replay, reversal and rolled-back facts emit nothing new',async()=>{
 const a=await shareMember(),b=await shareMember(1),issued=await issue(a),other=await issue(b),token=issued.access_token;
 const body={url:'https://example.com/credited'},key=randomUUID();
 const share=await req('/api/v1/shares',{session:a,body,key});assert.equal(share.status,200);
 const id=share.data.share_id;
 const credit=(await pool.query('SELECT event_id,source_ref FROM share_credit_events WHERE share_id=$1 AND units=1',[id])).rows[0];
 const recorded=(await pool.query("SELECT source_key FROM agent_change_events WHERE resource_id=$1 AND kind='share.credited'",[id])).rows;
 assert.deepEqual(recorded,[{source_key:credit.event_id}]);
 assert.deepEqual((await req('/api/v1/shares',{session:a,body,key})).data,share.data);
 const first=await req('/api/v1/agent/events',{token});assert.equal(first.status,200);
 assert.equal(first.data.items.filter((i:any)=>i.kind==='share.credited'&&i.resource_id===id).length,1);
 assert.equal((await req('/api/v1/agent/events',{token:other.access_token})).data.items.filter((i:any)=>i.resource_id===id).length,0);
 const {transaction}=await import('../../packages/db/index.js');
 const {appendCredit}=await import('../../modules/shares/credit.js');
 const community=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[a.user.user_id])).rows[0].community_id;
 await assert.rejects(transaction(pool,async q=>{
  assert.ok(await appendCredit(q,{share_id:id,community_id:community,user_id:a.user.user_id,role:'sharer',basis:'star_confirmed',source_ref:randomUUID(),actor_user_id:b.user.user_id}));
  throw Error('synthetic rollback');
 }),/synthetic rollback/);
 assert.equal((await req(`/api/v1/shares/${id}/retract`,{session:a,body:{}})).status,200);
 assert.equal((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1',[id])).rows[0].n,0);
 const next=await req('/api/v1/agent/events?after='+encodeURIComponent(first.data.next_cursor),{token});assert.equal(next.status,200);assert.deepEqual(next.data.items,[]);
 assert.equal((await pool.query("SELECT count(*)::int n FROM agent_change_events WHERE resource_id=$1 AND kind='share.credited'",[id])).rows[0].n,1);
});

test('event adapter keeps the approved request digest and exposes scoped share and RSVP operations',async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token,key=randomUUID();
 const body={kind:'event',url:'https://example.com/agent-event',event:{title:'Agent 分享合成活動',starts_at:'2099-01-01T10:00:00Z',location:'合成場地'}};
 assert.equal((await req('/api/v1/shares',{token,body,key})).status,202);
 const list=await req('/api/v1/me/agent-tokens',{session}),proposal=list.data.items[0].pending_publication;assert.deepEqual(proposal.body,body);
 assert.equal((await req(`/api/v1/me/agent-tokens/${issued.connection_id}/confirm`,{session,body:{request_sha256:proposal.request_sha256}})).status,200);
 const published=await req('/api/v1/shares',{token,body,key});assert.equal(published.status,200,JSON.stringify(published.data));
 assert.deepEqual((await req('/api/v1/shares',{token,body,key})).data,published.data);
 const eventId=published.data.url.split('/').pop();assert.equal((await req(`/api/v1/events/${eventId}`,{token})).data.state,'published');
 const shared=await req(`/api/v1/events/${eventId}/share`,{token,body:{}});assert.equal(shared.status,200,JSON.stringify(shared.data));assert.match(shared.data.path,/^\/go\//);
 assert.equal((await req(`/api/v1/events/${eventId}/rsvp`,{token,body:{going:true}})).status,200);
 const restricted=await issue(session,['read']);assert.equal((await req(`/api/v1/events/${eventId}/share`,{token:restricted.access_token,body:{}})).status,403);
});

// Attacker-controlled Authorization must select exactly one credential lane.
const legacyLanes = [
 {name:'CLI read',path:'/client-api/v1/connection',prefix:'fw_read_',status:401,code:'client_token_invalid'},
 {name:'shop machine',path:'/shop-api/v1/connection',prefix:'fw_shop_',status:401,code:'shop_key_invalid'},
 {name:'skill upload key',path:'/agent-api/v1/skill-submissions',prefix:'fpk_',body:{},status:401,code:'upload_key_invalid'},
 {name:'skill upload grant',path:`/agent-api/v1/skill-submissions/${randomUUID()}`,prefix:'fpg_',body:{},status:401,code:'upload_grant_invalid'},
 {name:'journal key',path:'/agent-api/v1/journal-submissions',prefix:'fjp_',body:{},status:401,code:'journal_key_invalid'},
 {name:'development key',path:'/development-agent/v1/proposals',prefix:'fpd_',body:{title:'Synthetic',summary:'Synthetic'},status:401,code:'development_key_required'},
 {name:'bootstrap DPoP',path:'/execution-api/v1/bootstrap',prefix:'DPoP',body:{},status:503,code:'private_ai_product_unavailable'},
 {name:'machine model DPoP',path:`/execution-api/v1/model-steps/${randomUUID()}`,prefix:'DPoP',status:503,code:'private_ai_product_unavailable'},
 {name:'member model',path:'/api/v1/me/model-settings',prefix:'fw_shop_',status:503,code:'private_ai_product_unavailable'},
 {name:'hosted order',path:`/api/v1/me/hosted-orders/${randomUUID()}`,prefix:'fw_shop_',status:401,code:'login_required'},
] as const;
const spellings=(token:string)=>[
 ['bearer',`Bearer ${token}`,403],['scheme case',`bEaReR ${token}`,403],['spaces',`Bearer   ${token}`,403],
 ['tab',`Bearer\t${token}`,401],['mixed whitespace',`Bearer \t ${token}`,401],
 ['prefix case',`Bearer ${token.replace('fw_agent_','FW_AgEnT_')}`,401],
 ['quoted token',`Bearer "${token}"`,401],['quoted header',`"Bearer ${token}"`,401],
 ['comma first',`Bearer ${token}, Bearer other`,401],['comma last',`Basic other, Bearer ${token}`,401],
 ['wrong scheme',`Basic ${token}`,401],['embedded',`opaque-${token}-suffix`,401],
] as const;
for(const lane of legacyLanes)test(`credential lanes: ${lane.name} keeps its own refusal and blocks every raw agent spelling`,async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 const legacyApp=createApp(pool,origin,'local',{shopKeyPolicy:'legacy-compatible',guildLaunchpadEnabled:true});
 const send=(authorization:string)=>legacyApp.request(origin+lane.path,{
  method:'body' in lane?'POST':'GET',headers:{Authorization:authorization,'Content-Type':'application/json','Idempotency-Key':randomUUID()},
  ...('body' in lane?{body:JSON.stringify(lane.body)}:{}),
 });
 // A structurally correct but unknown legacy credential retains that lane's error.
 const credential=lane.prefix==='DPoP'?`DPoP ${Buffer.from(randomUUID()).toString('base64url')}.e30.signature`:`Bearer ${lane.prefix}${randomBytes(32).toString('base64url')}`;
 const own=await send(credential),ownBody=await own.json() as any;
 assert.equal(own.status,lane.status,JSON.stringify(ownBody));assert.equal(ownBody.code,lane.code);
 assert.equal(own.headers.get('X-Content-Type-Options'),'nosniff');
 assert.match(own.headers.get('Content-Type')!,/^application\/(?:problem\+)?json/);
 assert.equal(own.headers.get('Cache-Control'),['bootstrap DPoP','machine model DPoP','member model','hosted order'].includes(lane.name)?'private, no-store':'no-store');
 for(const [name,authorization,status] of spellings(token)){
  const response=await send(authorization),body=await response.json() as any;
  assert.equal(response.status,status,`${lane.name}/${name}: ${JSON.stringify(body)}`);
  assert.equal(body.code,status===403?'scope_required':'agent_token_invalid');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(response.headers.get('Content-Type'),'application/json');
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.ok(response.headers.get('Content-Security-Policy'));
 }
 const row=(await pool.query('SELECT failure_count FROM agent_token_connections WHERE connection_id=$1',[issued.connection_id])).rows[0];
 assert.equal(row.failure_count,3,'only the three well-formed agent refusals reach the agent journal');
});

test('legacy CLI reader independently excludes agent rows, including legacy-shaped stored hashes and encoded agent credentials',async()=>{
 const {readClientResource}=await import('../../modules/client-connections/service.js');
 const session=await ready(),issued=await issue(session),suffix=randomBytes(32).toString('base64url'),legacy='fw_read_'+suffix;
 for(const credential of [issued.access_token,issued.access_token.replaceAll('_','%5F'),Buffer.from(issued.access_token).toString('base64'),JSON.stringify(issued.access_token)]){
  await assert.rejects(readClientResource(pool,'Bearer '+credential,'connection'),(error:any)=>error.code==='client_token_invalid');
 }
 // This storage-level adversary exercises the SQL kind guard, independent of parsing.
 await pool.query('UPDATE agent_token_connections SET token_hash=$2 WHERE connection_id=$1',[issued.connection_id,tokenHash(legacy)]);
 await assert.rejects(readClientResource(pool,'Bearer '+legacy,'connection'),(error:any)=>error.code==='client_token_invalid');
 const connection=randomUUID();
 await pool.query(`INSERT INTO member_client_connections(connection_id,user_id,community_id,client_name,kind,scope,token_hash)
 SELECT $1,user_id,community_id,'Synthetic CLI','supplier','supplier:read',$2 FROM users WHERE user_id=$3`,[connection,tokenHash('fw_read_'+randomBytes(32).toString('base64url')),session.user.user_id]);
 await pool.query('UPDATE agent_token_connections SET token_hash=$2 WHERE connection_id=$1',[issued.connection_id,tokenHash(issued.access_token)]);
 await pool.query('UPDATE member_client_connections SET token_hash=$2 WHERE connection_id=$1',[connection,tokenHash(legacy)]);
 const response=await req('/client-api/v1/connection',{token:legacy});
 assert.equal(response.status,200);assert.equal(response.data.kind,'supplier');assert.equal(response.data.connection_id,connection);
 assert.equal(response.response.headers.get('Cache-Control'),'no-store');
});

test('non-agent Authorization is a strict no-op for every path, response and request body',async()=>{
 const {Hono}=await import('hono');const {agentBoundary}=await import('../../apps/platform-api/src/agent-boundary.js');
 const noDatabase=new Proxy({},{get(){assert.fail('unclaimed requests must not access the database');}}) as Pool;
 const lane=new Hono<any>();
 lane.use('*',agentBoundary(noDatabase,()=>{assert.fail('unclaimed requests must not request or set headers');}));
 lane.all('*',async c=>new Response(await c.req.text(),{status:418,headers:{'Cache-Control':'private, no-store','Content-Type':'text/plain','X-Legacy':'unchanged'}}));
 for(const path of ['/api/v1/events','/client-api/v1/connection','/execution-api/v1/bootstrap','/unknown']){
  const encoded='fw%5Fagent%5F'+randomBytes(32).toString('base64url');
  for(const authorization of [undefined,'',...legacyLanes.map(l=>`Bearer ${l.prefix}${randomBytes(32).toString('base64url')}`),'Basic '+Buffer.from('fw_agent_'+randomUUID()).toString('base64'),'Bearer '+encoded]){
   const response=await lane.request(origin+path,{method:'POST',headers:authorization===undefined?{}:{Authorization:authorization},body:'untouched body'});
   assert.equal(response.status,418);assert.equal(await response.text(),'untouched body');
   assert.deepEqual(Object.fromEntries(response.headers),{'cache-control':'private, no-store','content-type':'text/plain','x-legacy':'unchanged'});
  }
 }
});

test('installed cookie-only private AI readers retain their credential rejection and private headers',async()=>{
 const {createPrivateAiProductTransport}=await import('../../apps/platform-api/src/private-ai-product.js');
 const {createLocalFixtureModelStepHost}=await import('../../modules/agent-execution/model-step-host.js');
 const {FakeObjectStore}=await import('../../packages/asset-storage/fake-store.js');
 const host=createLocalFixtureModelStepHost({environment:'local',origin,recover:async()=>{throw Error('unexpected recovery');},resolveCredential:async()=>{throw Error('unexpected credential read');}});
 const port=await createPrivateAiProductTransport(pool,{origin,environment:'local',clientId:'boundary-lanes',host,store:new FakeObjectStore()});
 const installed=createApp(pool,origin,'local',{privateAiProduct:port});
 const session=await ready(),issued=await issue(session);
 for(const path of ['/api/v1/me/model-settings','/api/v1/me/model-step-overview','/api/v1/me/execution-runs','/api/v1/me/credential-ingests']){
  const own=await installed.request(origin+path,{headers:{Authorization:'Bearer fw_shop_'+randomBytes(32).toString('base64url')}});
  assert.equal(own.status,403);assert.equal((await own.json() as any).code,'credential_kind_rejected');
  assert.equal(own.headers.get('Cache-Control'),'private, no-store');
  assert.equal(own.headers.get('Vary'),'Origin, Cookie, Authorization, DPoP');
  assert.equal(own.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(own.headers.get('Content-Type'),'application/json');
  for(const [name,authorization,status] of spellings(issued.access_token)){
   // Keep the token live so every family proves allowlist refusal, not suspension.
   await pool.query('UPDATE agent_token_connections SET failure_count=0,suspended_at=NULL WHERE connection_id=$1',[issued.connection_id]);
   const response=await installed.request(origin+path,{headers:{Authorization:authorization}});
   assert.equal(response.status,status,name);assert.equal((await response.json() as any).code,status===403?'scope_required':'agent_token_invalid');
   assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  }
 }
});

test('former guild registrants cannot receive or read private event notices through browser or agent',async()=>{
 const organizer=await ready(0),former=await ready(1),current=await ready(2);
 const token=(await issue(former,['read'])).access_token;
 const created=await req('/api/v1/events',{session:organizer,body:eventBody()});assert.equal(created.status,201,JSON.stringify(created.data));
 const id=created.data.event_id,community=created.data.community_id,guild='guild_games';
 await pool.query("UPDATE community_events SET visibility='guild',event_kind='guild_skill_exchange',guild_key=$2 WHERE event_id=$1",[id,guild]);
 for(const member of [former,current])await pool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state)
   VALUES($1,$2,$3,$4,'active') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'`,[randomUUID(),community,member.user.user_id,guild]);
 for(const member of [former,current])assert.equal((await req(`/api/v1/events/${id}/rsvp`,{session:member,body:{going:true}})).status,200);
 const announce=async(message:string)=>{
  const version=(await pool.query('SELECT aggregate_version FROM community_events WHERE event_id=$1',[id])).rows[0].aggregate_version;
  const result=await req(`/api/v1/events/${id}/announcements`,{session:organizer,body:{message},headers:{'If-Match':`"${version}"`}});
  assert.equal(result.status,200,JSON.stringify(result.data));
 };
 await announce('離開前的私人通知');
 assert.ok(JSON.stringify((await req('/api/v1/me/notifications',{session:former})).data).includes('離開前的私人通知'));
 await pool.query("UPDATE positioning_profession_memberships SET state='left' WHERE community_id=$1 AND user_id=$2 AND guild_key=$3",[community,former.user.user_id,guild]);
 await announce('離開後的私人通知');
 assert.equal((await pool.query("SELECT count(*)::int n FROM member_notifications WHERE recipient_ref=$1 AND action_resource_id=$2 AND kind='event_announcement'",[former.user.user_id,id])).rows[0].n,1);
 for(const result of [await req('/api/v1/me/notifications',{session:former}),await req('/api/v1/me/notifications',{token})]){
  assert.equal(result.status,200);assert.equal(result.data.unread_count,0);assert.equal(result.data.items.length,0);
 }
 const hidden=(await pool.query('SELECT notification_id FROM member_notifications WHERE recipient_ref=$1 AND action_resource_id=$2',[former.user.user_id,id])).rows[0].notification_id;
 assert.equal((await req(`/api/v1/me/notifications/${hidden}/read`,{session:former,body:{}})).status,404);
 const cleared=await req('/api/v1/me/inbox/read-all',{session:former,body:{scope:'notifications'}});assert.equal(cleared.status,200);assert.equal(cleared.data.notifications_updated,0);
 assert.equal((await pool.query('SELECT read_at FROM member_notifications WHERE notification_id=$1',[hidden])).rows[0].read_at,null);
 const present=await req('/api/v1/me/notifications',{session:current});assert.equal(present.status,200);assert.equal(present.data.items.filter((n:any)=>n.action?.resource_id===id).length,2);
 const publicEvent=await req('/api/v1/events',{session:organizer,body:{...eventBody(),title:'公開活動'}});assert.equal(publicEvent.status,201,JSON.stringify(publicEvent.data));
 assert.equal((await req(`/api/v1/events/${publicEvent.data.event_id}/rsvp`,{session:former,body:{going:true}})).status,200);
 const version=(await pool.query('SELECT aggregate_version FROM community_events WHERE event_id=$1',[publicEvent.data.event_id])).rows[0].aggregate_version;
 assert.equal((await req(`/api/v1/events/${publicEvent.data.event_id}/announcements`,{session:organizer,body:{message:'公開通知'},headers:{'If-Match':`"${version}"`}})).status,200);
 assert.ok(JSON.stringify((await req('/api/v1/me/notifications',{token})).data).includes('公開通知'));
});

test('agent event sharing refuses new links at the daily cap but returns an existing link',async()=>{
 const organizer=await ready(0),member=await ready(1),token=(await issue(member,['share'])).access_token;
 const one=await req('/api/v1/events',{session:organizer,body:{...eventBody(),title:'第一個活動'}});
 const two=await req('/api/v1/events',{session:organizer,body:{...eventBody(),title:'第二個活動'}});
 assert.equal(one.status,201);assert.equal(two.status,201);
 const path=(id:string)=>`/api/v1/events/${id}/share`;
 const first=await req(path(one.data.event_id),{token,body:{}});assert.equal(first.status,200,JSON.stringify(first.data));
 const community=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[member.user.user_id])).rows[0].community_id;
 const prefix=randomUUID().replaceAll('-','').slice(0,5);
 await pool.query(`INSERT INTO promotion_links(community_id,user_id,kind,target_key,code,revoked_at)
   SELECT $1,$2,'platform','workshop','a'||$3||lpad(n::text,4,'0'),now() FROM generate_series(1,199) n`,[community,member.user.user_id,prefix]);
 const rejected=await req(path(two.data.event_id),{token,body:{}});assert.equal(rejected.status,429,JSON.stringify(rejected.data));
 const browserRejected=await req(path(two.data.event_id),{session:member,body:{}});assert.equal(browserRejected.status,429,JSON.stringify(browserRejected.data));
 for(const credentials of [{token},{session:member}]){const repeated=await req(path(one.data.event_id),{...credentials,body:{}});assert.equal(repeated.status,200);assert.equal(repeated.data.path,first.data.path);}
});

test('agent event interest refuses a foreign-community event without recording interest',async()=>{
 const member=await ready(),token=(await issue(member,['rsvp'])).access_token;
 const foreign=randomUUID(),foreignEvent=randomUUID(),ownEvent=randomUUID();
 const ownCommunity=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[member.user.user_id])).rows[0].community_id;
 await pool.query('INSERT INTO communities(community_id,name) VALUES($1,$2)',[foreign,'Synthetic foreign']);
 for(const [id,community] of [[foreignEvent,foreign],[ownEvent,ownCommunity]])await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,registration_mode,external_registration_url)
   VALUES($1,$2,$3,'合成活動','合成內容','2099-01-01T10:00:00Z','2099-01-01T11:00:00Z','online','線上','published','open','external','https://example.com/register')`,[id,community,member.user.user_id]);
 assert.equal((await req(`/api/v1/events/${foreignEvent}/interest`,{token,body:{}})).status,404);
 assert.equal((await pool.query('SELECT count(*)::int n FROM community_event_interests WHERE event_id=$1',[foreignEvent])).rows[0].n,0);
 assert.equal((await req(`/api/v1/events/${ownEvent}/interest`,{token,body:{}})).status,200);
});

test('agent boundary matches every HTTP method exactly and refuses missing Idempotency-Key once',async()=>{
 const {matchAgentBoundaryOperation}=await import('../../apps/platform-api/src/agent-boundary.js') as any;
 const {memberCommand}=await import('../../packages/db/member-command.js');
 const {Problem}=await import('../../packages/shared/problem.js');
 type Op=import('../../apps/platform-api/src/agent-allowlist.js').AgentOperation;
 const ops:Op[]=[
  {id:'synthetic.get',method:'GET',route:'/api/v1/items/:id',scope:'read',title:'讀取',screen:'shares'},
  {id:'synthetic.post',method:'POST',route:'/api/v1/items',scope:'share',title:'新增',screen:'shares'},
  {id:'synthetic.put',method:'PUT',route:'/api/v1/items/:id',scope:'share',title:'取代',screen:'shares'},
  {id:'synthetic.patch',method:'PATCH',route:'/api/v1/items/:id',scope:'share',title:'局部更新',screen:'shares'},
  {id:'synthetic.delete',method:'DELETE',route:'/api/v1/items/:id',scope:'share',title:'刪除',screen:'shares'},
  {id:'synthetic.denied',method:'DELETE',route:'/api/v1/items/:id/secret',scope:'share',title:'拒絕',screen:'shares',granted:false},
 ];
 for(const m of ['GET','POST','PUT','PATCH','DELETE'] as const){
  const route=m==='POST'?'/api/v1/items':'/api/v1/items/:id';
  const matched=matchAgentBoundaryOperation(m,[{method:'ALL',path:'*'},{method:m,path:route}],ops);
  assert.equal(matched?.id,`synthetic.${m.toLowerCase()}`);
 }
 assert.equal(matchAgentBoundaryOperation('GET',[{method:'ALL',path:'*'},{method:'GET',path:'/api/v1/items/special'},{method:'GET',path:'/api/v1/items/:id'}],ops),undefined);
 assert.equal(matchAgentBoundaryOperation('PUT',[{method:'ALL',path:'/api/v1/items/:id'}],ops),undefined);
 assert.equal(matchAgentBoundaryOperation('HEAD',[{method:'GET',path:'/api/v1/items/:id'}],ops),undefined);
 assert.equal(matchAgentBoundaryOperation('POST',[{method:'PUT',path:'/api/v1/items/:id'}],ops),undefined);
 assert.equal(matchAgentBoundaryOperation('DELETE',[{method:'DELETE',path:'/api/v1/items/:id/secret'}],ops),undefined);

 let memberError:InstanceType<typeof Problem>|undefined;
 try{await memberCommand(pool,{actor:{user_id:randomUUID()} as any,operation:'test',key:'',body:{}},async()=>{},async()=>{});}
 catch(e){if(e instanceof Problem)memberError=e;}
 assert.ok(memberError);
 const member=await ready(),issued=await issue(member,['rsvp']),token=issued.access_token;
 const missing=await app.request(origin+`/api/v1/events/${randomUUID()}/interest`,{
  method:'POST',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({}),
 });
 const body=await missing.json() as any;
 assert.equal(missing.status,memberError.status);
 assert.equal(body.code,memberError.code);
 const row=(await pool.query('SELECT failure_count FROM agent_token_connections WHERE connection_id=$1',[issued.connection_id])).rows[0];
 assert.equal(row.failure_count,1);
});

test('agent inbox read-all requires scope=notifications and never marks direct messages read',async()=>{
 const member=await ready(0),peer=await ready(1),token=(await issue(member,['read'])).access_token;
 const sent=await req(`/api/v1/me/conversations/${member.user.user_id}/messages`,{session:peer,body:{body:'私訊不應被已讀'}});
 assert.equal(sent.status,201,JSON.stringify(sent.data));
 const messageId=sent.data.message_id as string;
 const withoutScope=await req('/api/v1/me/inbox/read-all',{token,body:{}});
 assert.equal(withoutScope.status,422,JSON.stringify(withoutScope.data));
 const badScope=await req('/api/v1/me/inbox/read-all',{token,body:{scope:'all'}});
 assert.equal(badScope.status,422,JSON.stringify(badScope.data));
 const unreadRow=(await pool.query('SELECT read_at FROM member_direct_messages WHERE message_id=$1',[messageId])).rows[0];
 assert.equal(unreadRow.read_at,null);
 const ok=await req('/api/v1/me/inbox/read-all',{token,body:{scope:'notifications'}});
 assert.equal(ok.status,200,JSON.stringify(ok.data));
 assert.equal(ok.data.direct_messages_updated,0);
 assert.equal(ok.data.channels_updated,0);
 const stillUnread=(await pool.query('SELECT read_at FROM member_direct_messages WHERE message_id=$1',[messageId])).rows[0];
 assert.equal(stillUnread.read_at,null);
});

test('agent social posts enforce scope, strict image exclusion before route, If-Match, and replay',async()=>{
 const owner=await ready(0),other=await ready(1);
 const shareConn=await issue(owner,['read','share']),reactConn=await issue(owner,['read','react']),bothConn=await issue(owner,['read','share','react']),outsider=await issue(other,['read','share','react']);
 const confirmLatest=async(session:Session,connectionId:string)=>{
  const list=await req('/api/v1/me/agent-tokens',{session});assert.equal(list.status,200);
  const pending=list.data.items.find((i:any)=>i.connection_id===connectionId)?.pending_publication;
  assert.ok(pending,`missing pending_publication for ${connectionId}`);
  const confirmed=await req(`/api/v1/me/agent-tokens/${connectionId}/confirm`,{session,body:{request_sha256:pending.request_sha256}});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
 };
 const fakeImg={mime_type:'image/png',data_base64:'AAAA'};
 const rejectedImgBeforeConfirm=await req('/api/v1/social-posts/notes',{token:shareConn.access_token,body:{text:'帶圖短文',image:fakeImg}});
 assert.equal(rejectedImgBeforeConfirm.status,422,JSON.stringify(rejectedImgBeforeConfirm.data));
 assert.equal((await pool.query('SELECT 1 FROM agent_pending_publications WHERE connection_id=$1',[shareConn.connection_id])).rowCount,0);

 const noteKey=randomUUID();
 assert.equal((await req('/api/v1/social-posts/notes',{token:shareConn.access_token,body:{text:'第一則短文'},key:noteKey})).status,202);
 await confirmLatest(owner,shareConn.connection_id);
 const note=await req('/api/v1/social-posts/notes',{token:shareConn.access_token,body:{text:'第一則短文'},key:noteKey});
 assert.equal(note.status,201,JSON.stringify(note.data));
 assert.equal((await req('/api/v1/social-posts/notes',{token:shareConn.access_token,body:{text:'確認後帶圖',image:fakeImg}})).status,422);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM community_social_posts WHERE author_user_id=$1 AND state='active'",[owner.user.user_id])).rows[0].n,1);

 const linkConn=await issue(owner,['read','share']),linkKey=randomUUID(),linkBody={url:'https://example.com/door-link',title:'連結標題',note:'連結備註'};
 assert.equal((await req('/api/v1/social-posts',{token:linkConn.access_token,body:linkBody,key:linkKey})).status,202);
 await confirmLatest(owner,linkConn.connection_id);
 const link=await req('/api/v1/social-posts',{token:linkConn.access_token,body:linkBody,key:linkKey});
 assert.equal(link.status,201,JSON.stringify(link.data));
 const linkReplay=await req('/api/v1/social-posts',{token:linkConn.access_token,body:linkBody,key:linkKey});
 assert.equal(linkReplay.status,201,JSON.stringify(linkReplay.data));
 assert.equal(linkReplay.data.post_id,link.data.post_id);

 const noteId=note.data.post_id as string,linkId=link.data.post_id as string;
 assert.equal((await req(`/api/v1/social-posts/${noteId}/edit`,{token:reactConn.access_token,body:{text:'無權限'},headers:{'If-Match':`"${note.data.revision}"`}})).status,403);
 assert.equal((await req(`/api/v1/social-posts/${noteId}/edit`,{token:outsider.access_token,body:{text:'跨會員'},headers:{'If-Match':`"${note.data.revision}"`}})).status,403);
 assert.equal((await req(`/api/v1/social-posts/${noteId}/edit`,{token:shareConn.access_token,body:{text:'缺版本'}})).status,428);
 assert.equal((await req(`/api/v1/social-posts/${noteId}/edit`,{token:shareConn.access_token,body:{text:'舊版本'},headers:{'If-Match':`"${Number(note.data.revision)+5}"`}})).status,412);
 assert.equal((await req(`/api/v1/social-posts/${noteId}/edit`,{token:shareConn.access_token,body:{text:'夾帶圖片',image:fakeImg},headers:{'If-Match':`"${note.data.revision}"`}})).status,422);
 const noteEdit=await req(`/api/v1/social-posts/${noteId}/edit`,{token:shareConn.access_token,body:{text:'編輯後短文'},headers:{'If-Match':`"${note.data.revision}"`}});
 assert.equal(noteEdit.status,200,JSON.stringify(noteEdit.data));
 const linkEdit=await req(`/api/v1/social-posts/${linkId}/edit`,{token:shareConn.access_token,body:{title:'新連結標題',note:null},headers:{'If-Match':`"${link.data.revision}"`}});
 assert.equal(linkEdit.status,200,JSON.stringify(linkEdit.data));

 assert.equal((await req(`/api/v1/social-posts/${linkId}/like`,{token:shareConn.access_token,body:{liked:true}})).status,403);
 const likeRes=await req(`/api/v1/social-posts/${linkId}/like`,{token:reactConn.access_token,body:{liked:true}});
 assert.equal(likeRes.status,200,JSON.stringify(likeRes.data));
 assert.equal(likeRes.data.liked,true);assert.equal(likeRes.data.like_count,1);

 assert.equal((await req(`/api/v1/social-posts/${linkId}/comments`,{token:shareConn.access_token,body:{text:'無互動權'}})).status,403);
 const badCommentBeforeConfirm=await req(`/api/v1/social-posts/${linkId}/comments`,{token:bothConn.access_token,body:{text:'含圖留言',image_id:randomUUID()}});
 assert.equal(badCommentBeforeConfirm.status,422,JSON.stringify(badCommentBeforeConfirm.data));
 assert.equal((await pool.query('SELECT 1 FROM agent_pending_publications WHERE connection_id=$1',[bothConn.connection_id])).rowCount,0);
 const commentKey=randomUUID();
 assert.equal((await req(`/api/v1/social-posts/${linkId}/comments`,{token:bothConn.access_token,body:{text:'公開留言'},key:commentKey})).status,202);
 await confirmLatest(owner,bothConn.connection_id);
 const commentRes=await req(`/api/v1/social-posts/${linkId}/comments`,{token:bothConn.access_token,body:{text:'公開留言'},key:commentKey});
 assert.equal(commentRes.status,201,JSON.stringify(commentRes.data));
 assert.equal((await req(`/api/v1/social-posts/${linkId}/comments`,{token:bothConn.access_token,body:{text:'確認後含圖',image_id:randomUUID()}})).status,422);

 assert.equal((await req(`/api/v1/social-posts/${noteId}`,{token:reactConn.access_token,method:'DELETE',body:{}})).status,403);
 assert.equal((await req(`/api/v1/social-posts/${noteId}`,{token:outsider.access_token,method:'DELETE',body:{}})).status,403);
 const delRes=await req(`/api/v1/social-posts/${noteId}`,{token:shareConn.access_token,method:'DELETE',body:{}});
 assert.equal(delRes.status,200,JSON.stringify(delRes.data));
 assert.deepEqual(delRes.data,{post_id:noteId,state:'deleted'});
});

test('agent member services enforce scope, If-Match, ownership, replay, and keep cover/hide member-only',async()=>{
 const owner=await ready(0),other=await ready(1);
 const readConn=await issue(owner,['read']),shareConn=await issue(owner,['read','share']),outsider=await issue(other,['read','share']);
 const confirmLatest=async(session:Session,connectionId:string)=>{
  const list=await req('/api/v1/me/agent-tokens',{session});assert.equal(list.status,200);
  const pending=list.data.items.find((i:any)=>i.connection_id===connectionId)?.pending_publication;
  assert.ok(pending,`missing pending_publication for ${connectionId}`);
  const confirmed=await req(`/api/v1/me/agent-tokens/${connectionId}/confirm`,{session,body:{request_sha256:pending.request_sha256}});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
 };
 const draft={title:'顧問服務',category:'consulting',summary:'一對一線上諮詢',service_mode:'online',contacts:[{label:'預約',url:'https://example.com/consult'}]};
 assert.equal((await req('/api/v1/member-services',{token:readConn.access_token,body:draft})).status,403);
 assert.equal((await req('/api/v1/member-services',{token:shareConn.access_token,body:{...draft,cover:'bad'}})).status,422);
 assert.equal((await pool.query('SELECT 1 FROM agent_pending_publications WHERE connection_id=$1',[shareConn.connection_id])).rowCount,0);

 const createKey=randomUUID();
 assert.equal((await req('/api/v1/member-services',{token:shareConn.access_token,body:draft,key:createKey})).status,202);
 await confirmLatest(owner,shareConn.connection_id);
 const created=await req('/api/v1/member-services',{token:shareConn.access_token,body:draft,key:createKey});
 assert.equal(created.status,201,JSON.stringify(created.data));
 const replay=await req('/api/v1/member-services',{token:shareConn.access_token,body:draft,key:createKey});
 assert.equal(replay.status,201,JSON.stringify(replay.data));
 assert.equal(replay.data.service_id,created.data.service_id);

 const serviceId=created.data.service_id as string;
 const mine=await req('/api/v1/member-services/mine',{token:readConn.access_token});
 assert.equal(mine.status,200,JSON.stringify(mine.data));
 assert.equal(mine.data.items.length,1);
 assert.equal(mine.data.items[0].service_id,serviceId);

 assert.equal((await req(`/api/v1/member-services/${serviceId}`,{token:outsider.access_token,method:'PUT',body:{...draft,title:'他人修改'},headers:{'If-Match':`"${created.data.aggregate_version}"`}})).status,403);
 assert.equal((await req(`/api/v1/member-services/${serviceId}`,{token:shareConn.access_token,method:'PUT',body:{...draft,title:'缺版本'}})).status,428);
 assert.equal((await req(`/api/v1/member-services/${serviceId}`,{token:shareConn.access_token,method:'PUT',body:{...draft,title:'錯版本'},headers:{'If-Match':'"99"'}})).status,412);
 const edited=await req(`/api/v1/member-services/${serviceId}`,{token:shareConn.access_token,method:'PUT',body:{...draft,title:'新版顧問服務'},headers:{'If-Match':`"${created.data.aggregate_version}"`}});
 assert.equal(edited.status,200,JSON.stringify(edited.data));
 assert.equal(edited.data.title,'新版顧問服務');

 assert.equal((await req(`/api/v1/member-services/${serviceId}/pause`,{token:shareConn.access_token,body:{}})).status,428);
 const paused=await req(`/api/v1/member-services/${serviceId}/pause`,{token:shareConn.access_token,body:{},headers:{'If-Match':`"${edited.data.aggregate_version}"`}});
 assert.equal(paused.status,200,JSON.stringify(paused.data));
 assert.equal(paused.data.state,'paused');

 assert.equal((await req(`/api/v1/member-services/${serviceId}/resume`,{token:shareConn.access_token,body:{}})).status,428);
 const resumed=await req(`/api/v1/member-services/${serviceId}/resume`,{token:shareConn.access_token,body:{},headers:{'If-Match':`"${paused.data.aggregate_version}"`}});
 assert.equal(resumed.status,200,JSON.stringify(resumed.data));
 assert.equal(resumed.data.state,'active');

 assert.equal((await req(`/api/v1/member-services/${serviceId}/hide`,{token:shareConn.access_token,body:{},headers:{'If-Match':`"${resumed.data.aggregate_version}"`}})).status,403);
 assert.equal((await req(`/api/v1/member-services/${serviceId}/cover/remove`,{token:shareConn.access_token,body:{},headers:{'If-Match':`"${resumed.data.aggregate_version}"`}})).status,403);
 const coverPut=await app.request(origin+`/api/v1/member-services/${serviceId}/cover`,{method:'PUT',headers:{Authorization:'Bearer '+shareConn.access_token,'Content-Type':'image/png','Idempotency-Key':randomUUID()},body:Buffer.from([137,80,78,71])});
 assert.equal(coverPut.status,403);

 assert.equal((await req(`/api/v1/member-services/${serviceId}`,{token:shareConn.access_token,method:'DELETE',body:{}})).status,428);
 assert.equal((await req(`/api/v1/member-services/${serviceId}`,{token:outsider.access_token,method:'DELETE',body:{},headers:{'If-Match':`"${resumed.data.aggregate_version}"`}})).status,403);
 const deleted=await req(`/api/v1/member-services/${serviceId}`,{token:shareConn.access_token,method:'DELETE',body:{},headers:{'If-Match':`"${resumed.data.aggregate_version}"`}});
 assert.equal(deleted.status,200,JSON.stringify(deleted.data));
 assert.equal(deleted.data.state,'deleted');
});

test('first public item confirmation and single 20/UTC-day cap apply together across all seven public item kinds',async t=>{
 const owner=await ready(0),conn=await issue(owner,['read','share','rsvp','react']),token=conn.access_token;
 const basePost=await req('/api/v1/social-posts/notes',{session:owner,body:{text:'跨類型上限母貼文'}});
 assert.equal(basePost.status,201,JSON.stringify(basePost.data));
 const basePostId=basePost.data.post_id as string;

 const firstKey=randomUUID(),firstBody={text:'第一則公開留言'};
 assert.equal((await req(`/api/v1/social-posts/${basePostId}/comments`,{token,body:firstBody,key:firstKey})).status,202);
 const list=await req('/api/v1/me/agent-tokens',{session:owner});
 const pending=list.data.items.find((i:any)=>i.connection_id===conn.connection_id)?.pending_publication;
 assert.ok(pending);
 assert.equal((await req(`/api/v1/me/agent-tokens/${conn.connection_id}/confirm`,{session:owner,body:{request_sha256:pending.request_sha256}})).status,200);
 const firstComment=await req(`/api/v1/social-posts/${basePostId}/comments`,{token,body:firstBody,key:firstKey});
 assert.equal(firstComment.status,201,JSON.stringify(firstComment.data));
 const afterFirst=(await pool.query('SELECT public_confirmed_at FROM agent_token_connections WHERE connection_id=$1',[conn.connection_id])).rows[0];
 assert.ok(afterFirst.public_confirmed_at,'first comment must confirm connection public_confirmed_at');
 assert.equal((await pool.query('SELECT public_items FROM agent_daily_usage WHERE connection_id=$1',[conn.connection_id])).rows[0]?.public_items,1);

 t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
  const url=String(input);assert.equal(new URL(url).hostname,'api.github.com');
  const repoMatch=/\/repos\/example\/cap-repo-(\d+)$/.exec(url);
  if(repoMatch)return Response.json({id:9000+Number(repoMatch[1]),full_name:`example/cap-repo-${repoMatch[1]}`,private:false,visibility:'public',default_branch:'main',fork:false,archived:false});
  if(url.endsWith('/commits/main'))return Response.json({sha:'b'.repeat(40)});
  if(url.includes('/license?ref='))return Response.json({path:'LICENSE',license:{spdx_id:'MIT'}});
  throw new Error('unexpected fixture request: '+url);
 });

 for(let i=0;i<3;i++)assert.equal((await req('/api/v1/events',{token,body:{...eventBody(),title:`跨類型活動 ${i}`}})).status,201);
 for(let i=0;i<2;i++)assert.equal((await req('/api/v1/opensource/projects',{token,body:{repository_url:`https://github.com/example/cap-repo-${i}`,title:`跨類型專案 ${i}`,description:'專案介紹',use_notes:'使用方式',relationship:'curator',consent_to_share:true}})).status,201);
 for(let i=0;i<3;i++)assert.equal((await req('/api/v1/shares',{token,body:{kind:'link',url:`https://example.com/cap-share-${i}`}})).status,200);
 for(let i=0;i<3;i++)assert.equal((await req('/api/v1/social-posts/notes',{token,body:{text:`跨類型短文 ${i}`}})).status,201);
 for(let i=0;i<3;i++)assert.equal((await req('/api/v1/social-posts',{token,body:{url:`https://example.com/cap-post-${i}`}})).status,201);
 for(let i=0;i<2;i++)assert.equal((await req(`/api/v1/social-posts/${basePostId}/comments`,{token,body:{text:`跨類型留言 ${i}`}})).status,201);
 for(let i=0;i<2;i++)assert.equal((await req('/api/v1/member-services',{token,body:{title:`跨類型服務 ${i}`,category:'tech',summary:'服務摘要',service_mode:'online',contacts:[{label:'官網',url:'https://example.com/svc'}]}})).status,201);
 assert.equal((await req('/api/v1/showcases',{token,body:{title:'跨類型作品 0',description:'作品說明',public_url:'https://example.com/work-cap',consent_to_share:true}})).status,201);

 assert.equal((await pool.query('SELECT public_items FROM agent_daily_usage WHERE connection_id=$1',[conn.connection_id])).rows[0].public_items,20);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_publications WHERE connection_id=$1 AND resource_id IS NOT NULL',[conn.connection_id])).rows[0].n,20);

 for(const attempt of [
  await req(`/api/v1/social-posts/${basePostId}/comments`,{token,body:{text:'第 21 件留言'}}),
  await req('/api/v1/social-posts/notes',{token,body:{text:'第 21 件短文'}}),
  await req('/api/v1/events',{token,body:{...eventBody(),title:'第 21 件活動'}}),
  await req('/api/v1/member-services',{token,body:{title:'第 21 件服務',category:'tech',summary:'服務摘要',service_mode:'online',contacts:[{label:'官網',url:'https://example.com/svc2'}]}}),
  await req('/api/v1/showcases',{token,body:{title:'第 21 件作品',description:'作品說明',consent_to_share:true}}),
 ]){
  assert.equal(attempt.status,429,JSON.stringify(attempt.data));
  assert.equal(attempt.data.code,'agent_daily_cap');
 }
 assert.equal((await pool.query('SELECT public_items FROM agent_daily_usage WHERE connection_id=$1',[conn.connection_id])).rows[0].public_items,20);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_publications WHERE connection_id=$1',[conn.connection_id])).rows[0].n,20);
});

test('works.create and profile.read enforce scope, consent_to_share, confirmation, and replay',async()=>{
 const owner=await ready(0),readOnly=await issue(owner,['read']),shareOnly=await issue(owner,['share']);
 assert.equal((await req('/api/v1/me/positioning',{token:shareOnly.access_token})).status,403);
 const posCheck=await req('/api/v1/me/positioning',{session:owner});
 if(!posCheck.data.profile){
  assert.equal((await req('/api/v1/me/positioning',{session:owner,body:{real_world_occupations:['設計師'],background:'設計實務',strengths:['介面設計'],goals:'建立開源設計系統',weekly_minutes:120,desired_roles:['creator'],selected_tracks:['visual_designer'],confirmed:true}})).status,201);
 }
 const pos=await req('/api/v1/me/positioning',{token:readOnly.access_token});
 assert.equal(pos.status,200,JSON.stringify(pos.data));
 assert.equal(pos.data.profile.user_id,owner.user.user_id);
 assert.ok(Array.isArray(pos.data.tracks)&&pos.data.tracks.length>0);

 assert.equal((await req('/api/v1/showcases',{token:readOnly.access_token,body:{title:'無權限作品',description:'說明',consent_to_share:true}})).status,403);
 assert.equal((await req('/api/v1/showcases',{token:shareOnly.access_token,body:{title:'缺同意作品',description:'說明'}})).status,422);
 assert.equal((await req('/api/v1/showcases',{token:shareOnly.access_token,body:{title:'未同意作品',description:'說明',consent_to_share:false}})).status,422);

 const key=randomUUID(),workBody={title:'代理分享作品',description:'完整的作品介紹與展示連結',public_url:'https://example.com/agent-work',consent_to_share:true};
 assert.equal((await req('/api/v1/showcases',{token:shareOnly.access_token,body:workBody,key})).status,202);
 const list=await req('/api/v1/me/agent-tokens',{session:owner});
 const pending=list.data.items.find((i:any)=>i.connection_id===shareOnly.connection_id)?.pending_publication;
 assert.ok(pending);
 assert.equal((await req(`/api/v1/me/agent-tokens/${shareOnly.connection_id}/confirm`,{session:owner,body:{request_sha256:pending.request_sha256}})).status,200);

 const created=await req('/api/v1/showcases',{token:shareOnly.access_token,body:workBody,key});
 assert.equal(created.status,201,JSON.stringify(created.data));
 assert.equal(created.data.via_agent,true);
 const replay=await req('/api/v1/showcases',{token:shareOnly.access_token,body:workBody,key});
 assert.equal(replay.status,201,JSON.stringify(replay.data));
 assert.equal(replay.data.showcase_id,created.data.showcase_id);
 const pub=(await pool.query('SELECT resource_id FROM agent_publications WHERE connection_id=$1 AND idempotency_key=$2',[shareOnly.connection_id,key])).rows[0];
 assert.equal(pub?.resource_id,created.data.showcase_id);
});

test('F1 allowlist grants six draft operations and keeps person-only routes denied',async()=>{
 const {agentOperation}=await import('../../apps/platform-api/src/agent-allowlist.js');
 const expected=[
  {id:'skills.drafts',method:'GET',route:'/api/v1/me/skill-submissions',scope:'read',screen:'works',title:'查看我的技能書草稿',ifMatch:undefined},
  {id:'skills.draft_read',method:'GET',route:'/api/v1/me/skill-submissions/:id',scope:'read',screen:'works',title:'查看一份技能書草稿',ifMatch:undefined},
  {id:'skills.draft',method:'POST',route:'/api/v1/me/skill-submissions/manual',scope:'share',screen:'works',title:'交技能書私人草稿',ifMatch:undefined},
  {id:'skills.revise',method:'POST',route:'/api/v1/me/skill-submissions/:id/manual',scope:'share',screen:'works',title:'修改自己的技能書草稿',ifMatch:true},
  {id:'development.status',method:'GET',route:'/api/v1/me/development/:kind/:target',scope:'read',screen:'guilds',title:'查看開發權限狀態',ifMatch:undefined},
  {id:'development.propose',method:'POST',route:'/api/v1/me/development/:kind/:target/proposals',scope:'share',screen:'guilds',title:'交私人開發提案',ifMatch:undefined},
 ] as const;
 for(const item of expected){
  const op=agentOperation(item.method,item.route);
  assert.ok(op,`expected allowlisted ${item.id}`);
  assert.equal(op.id,item.id);assert.equal(op.scope,item.scope);assert.equal(op.screen,item.screen);assert.equal(op.title,item.title);
  assert.equal(op.publicItem,undefined);assert.equal(op.ifMatch,item.ifMatch);
  if(item.method!=='GET')assert.ok(op.example&&typeof op.example==='object',`missing example for ${item.id}`);
 }
 for(const [method,route] of [
  ['POST','/api/v1/me/skill-submissions'],
  ['GET','/api/v1/me/skill-submissions/:id/illustration'],
  ['POST','/api/v1/me/skill-submissions/:id/grant'],
  ['POST','/api/v1/me/skill-submissions/:id/revoke'],
  ['POST','/api/v1/me/skill-submissions/:id/publish'],
  ['POST','/api/v1/me/skill-submissions/:id/upgrade'],
  ['GET','/api/v1/me/skill-upload-keys'],
  ['POST','/api/v1/me/skill-upload-keys'],
  ['POST','/api/v1/me/skill-upload-keys/:id/revoke'],
  ['POST','/api/v1/me/development/:kind/:target/consent'],
  ['POST','/api/v1/me/development/:kind/:target/activate'],
  ['POST','/api/v1/me/development/:kind/:target/keys'],
  ['POST','/api/v1/me/development/:kind/:target/revoke'],
 ] as const){
  assert.equal(agentOperation(method,route),undefined,`${method} ${route} must not be granted`);
  const doc=agentOperations.find(entry=>entry.method===method&&entry.route===route);
  assert.equal(doc?.granted,false,`${method} ${route} must be documented as granted:false`);
 }
});

test('agent key creates, reads, lists, revises, and replays private skill drafts while keeping publish and revoked keys blocked',async()=>{
 const owner=await ready(0),readOnly=await issue(owner,['read']),shareOnly=await issue(owner,['share']),allScopes=await issue(owner,['read','share','rsvp','react']);
 const draftBody={repository_url:'https://github.com/example/skill-draft',title:'代理私人技能書',description:'代理建立的私人技能書草稿',use_notes:'先讀 README 再測試',relationship:'curator'};
 assert.equal((await req('/api/v1/me/skill-submissions/manual',{token:readOnly.access_token,body:draftBody})).data.code,'scope_required');

 const key=randomUUID();
 const created=await req('/api/v1/me/skill-submissions/manual',{token:shareOnly.access_token,body:draftBody,key});
 assert.equal(created.status,201,JSON.stringify(created.data));
 assert.equal(created.data.status,'ready_for_review');
 assert.equal(created.data.public_path,null);
 assert.equal((await pool.query('SELECT count(*) FROM agent_publications WHERE connection_id=$1',[shareOnly.connection_id])).rows[0].count,'0');

 const createJournal=(await pool.query("SELECT command,data FROM transition_journal WHERE aggregate_type='skill_submission' AND aggregate_id=$1 AND aggregate_version=1",[created.data.submission_id])).rows[0];
 assert.equal(createJournal?.command,'save_manual_draft');
 assert.equal(createJournal?.data?.source,'agent');
 assert.equal(createJournal?.data?.connection_id,shareOnly.connection_id);

 const replay=await req('/api/v1/me/skill-submissions/manual',{token:shareOnly.access_token,body:draftBody,key});
 assert.equal(replay.status,201,JSON.stringify(replay.data));
 assert.equal(replay.data.submission_id,created.data.submission_id);
 const conflict=await req('/api/v1/me/skill-submissions/manual',{token:shareOnly.access_token,body:{...draftBody,title:'不同標題'},key});
 assert.equal(conflict.status,409);
 assert.equal(conflict.data.code,'idempotency_conflict');

 assert.equal((await req('/api/v1/me/skill-submissions',{token:shareOnly.access_token})).data.code,'scope_required');
 assert.equal((await req(`/api/v1/me/skill-submissions/${created.data.submission_id}`,{token:shareOnly.access_token})).data.code,'scope_required');
 const listed=await req('/api/v1/me/skill-submissions',{token:readOnly.access_token});
 assert.equal(listed.status,200,JSON.stringify(listed.data));
 assert.ok(listed.data.items.some((item:any)=>item.submission_id===created.data.submission_id&&item.status==='ready_for_review'));
 const readOne=await req(`/api/v1/me/skill-submissions/${created.data.submission_id}`,{token:readOnly.access_token});
 assert.equal(readOne.status,200,JSON.stringify(readOne.data));
 assert.equal(readOne.data.submission_id,created.data.submission_id);

 assert.equal((await req(`/api/v1/me/skill-submissions/${created.data.submission_id}/manual`,{token:readOnly.access_token,body:{...draftBody,title:'無權修改'},headers:{'If-Match':`"${created.data.aggregate_version}"`}})).data.code,'scope_required');
 const revised=await req(`/api/v1/me/skill-submissions/${created.data.submission_id}/manual`,{token:shareOnly.access_token,body:{...draftBody,title:'更新後私人技能書'},headers:{'If-Match':`"${created.data.aggregate_version}"`}});
 assert.equal(revised.status,200,JSON.stringify(revised.data));
 assert.equal(revised.data.payload.title,'更新後私人技能書');
 assert.equal(revised.data.aggregate_version,2);
 const reviseJournal=(await pool.query("SELECT command,data FROM transition_journal WHERE aggregate_type='skill_submission' AND aggregate_id=$1 AND aggregate_version=2",[created.data.submission_id])).rows[0];
 assert.equal(reviseJournal?.command,'revise_manual_draft');
 assert.equal(reviseJournal?.data?.source,'agent');
 assert.equal(reviseJournal?.data?.connection_id,shareOnly.connection_id);

 const publishRefused=await req(`/api/v1/me/skill-submissions/${created.data.submission_id}/publish`,{token:allScopes.access_token,body:{public_consent:true,confirmation_text:'確定公開'}});
 assert.equal(publishRefused.status,403);
 assert.equal(publishRefused.data.code,'scope_required');

 await req(`/api/v1/me/agent-tokens/${shareOnly.connection_id}/revoke`,{session:owner,body:{}});
 assert.equal((await req('/api/v1/me/skill-submissions/manual',{token:shareOnly.access_token,body:draftBody})).status,401);
 assert.equal((await req(`/api/v1/me/skill-submissions/${created.data.submission_id}/manual`,{token:shareOnly.access_token,body:draftBody,headers:{'If-Match':'"2"'}})).status,401);
});

test('agent key reads development status and saves proposals with an active grant while matching browser grant refusals and blocking person-only development routes',async()=>{
 const owner=await ready(0),readOnly=await issue(owner,['read']),shareOnly=await issue(owner,['share']),allScopes=await issue(owner,['read','share','rsvp','react']);
 const devGithubFetch:typeof fetch=async input=>{
  const u=String(input);
  if(u==='https://github.com/login/oauth/access_token')return Response.json({access_token:'ghu_synthetic',token_type:'bearer',scope:''});
  if(u==='https://api.github.com/user')return Response.json({id:42,login:'contributor'});
  if(u.startsWith('https://api.github.com/applications/'))return new Response(null,{status:204});
  if(u.startsWith('https://api.github.com/user/installations?'))return Response.json({installations:[{id:77,app_id:9,account:{id:42},suspended_at:null,permissions:{metadata:'read'}}]});
  if(u.includes('/repositories?'))return Response.json({repositories:[{id:200,full_name:'contributor/video-autopilot-kit',private:false,permissions:{push:true}}]});
  if(u.includes('/repos/')){
   const name=u.split('/repos/')[1],own=name.startsWith('contributor/');
   return Response.json({id:own?200:100,full_name:name,private:false,archived:false,owner:{id:own?42:7},permissions:{push:true},...(own?{source:{id:100}}:{})});
  }
  throw new Error('Unexpected dev GitHub fixture: '+u);
 };
 const devApp=createApp(pool,origin,'local',{eventParticipationEnabled:true,socialAchievementsEnabled:true,githubSocial:{config:{clientId:'Iv1.synthetic',clientSecret:'synthetic-secret',tokenKey:randomBytes(32).toString('base64'),redirectUri:origin+'/github/callback',appId:'9',appSlug:'synthetic-app'},fetcher:devGithubFetch}});
 const devReq=async(path:string,opts:{session?:Session;token?:string;body?:unknown;key?:string;headers?:Record<string,string>}={})=>{
  const {session,token,body,key=randomUUID()}=opts;
  const headers:Record<string,string>={...(session?{Origin:origin,Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...(token?{Authorization:'Bearer '+token}:{}),...opts.headers};
  if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;}
  const res=await devApp.request(origin+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,data:await res.json() as any};
 };

 const proposalBody={title:'代理私人開發提案',summary:'透過單一代理鑰匙提交私人開發提案。',pr_url:null};
 const browserNoGrant=await devReq('/api/v1/me/development/skill/video-autopilot/proposals',{session:owner,body:proposalBody});
 const agentNoGrant=await devReq('/api/v1/me/development/skill/video-autopilot/proposals',{token:shareOnly.access_token,body:proposalBody});
 assert.equal(agentNoGrant.status,browserNoGrant.status);
 assert.equal(agentNoGrant.data.code,browserNoGrant.data.code);

 const guildCheck=(await pool.query("SELECT aggregate_version,state FROM positioning_profession_memberships WHERE user_id=$1 AND guild_key='guild_ai_vibe'",[owner.user.user_id])).rows[0];
 if(guildCheck?.state!=='active'){
  const joined=await devReq('/api/v1/guilds/guild_ai_vibe/join',{session:owner,body:{},...(guildCheck?{headers:{'If-Match':`"${guildCheck.aggregate_version}"`}}:{})});
  assert.equal(joined.status,200,JSON.stringify(joined.data));
 }
 await pool.query("UPDATE positioning_profession_memberships SET member_tier='full' WHERE user_id=$1 AND guild_key='guild_ai_vibe'",[owner.user.user_id]);
 const ghStart=await devReq('/api/v1/me/github/connect',{session:owner,body:{return_to:'#skills'}});
 assert.equal(ghStart.status,200,JSON.stringify(ghStart.data));
 assert.equal((await devReq('/api/v1/me/github/complete',{session:owner,body:{state:new URL(ghStart.data.authorization_url).searchParams.get('state')!,code:'synthetic-code'}})).status,200);
 assert.equal((await devReq('/api/v1/me/development/skill/video-autopilot/consent',{session:owner,body:{policy_version:'development-proposal-v1',accepted:true}})).status,200);

 const browserBeforeActivate=await devReq('/api/v1/me/development/skill/video-autopilot/proposals',{session:owner,body:proposalBody});
 const agentBeforeActivate=await devReq('/api/v1/me/development/skill/video-autopilot/proposals',{token:shareOnly.access_token,body:proposalBody});
 assert.equal(agentBeforeActivate.status,browserBeforeActivate.status);
 assert.equal(agentBeforeActivate.data.code,browserBeforeActivate.data.code);
 assert.equal(agentBeforeActivate.data.code,'development_grant_required');

 assert.equal((await devReq('/api/v1/me/development/skill/video-autopilot/activate',{session:owner,body:{working_repository_url:'https://github.com/contributor/video-autopilot-kit'}})).status,200);

 assert.equal((await devReq('/api/v1/me/development/skill/video-autopilot',{token:shareOnly.access_token})).data.code,'scope_required');
 const devStatus=await devReq('/api/v1/me/development/skill/video-autopilot',{token:readOnly.access_token});
 assert.equal(devStatus.status,200,JSON.stringify(devStatus.data));
 assert.equal(devStatus.data.enabled,true);

 assert.equal((await devReq('/api/v1/me/development/skill/video-autopilot/proposals',{token:readOnly.access_token,body:proposalBody})).data.code,'scope_required');
 const propKey=randomUUID();
 const saved=await devReq('/api/v1/me/development/skill/video-autopilot/proposals',{token:shareOnly.access_token,body:proposalBody,key:propKey});
 assert.equal(saved.status,200,JSON.stringify(saved.data));
 assert.equal(saved.data.title,proposalBody.title);
 const propJournal=(await pool.query("SELECT command,data FROM transition_journal WHERE aggregate_type='development_proposal' AND aggregate_id=$1 AND aggregate_version=1",[saved.data.proposal_id])).rows[0];
 assert.equal(propJournal?.command,'save_private_proposal');
 assert.equal(propJournal?.data?.source,'agent');
 assert.equal(propJournal?.data?.connection_id,shareOnly.connection_id);

 const propReplay=await devReq('/api/v1/me/development/skill/video-autopilot/proposals',{token:shareOnly.access_token,body:proposalBody,key:propKey});
 assert.equal(propReplay.status,200);
 assert.equal(propReplay.data.proposal_id,saved.data.proposal_id);
 const propConflict=await devReq('/api/v1/me/development/skill/video-autopilot/proposals',{token:shareOnly.access_token,body:{...proposalBody,title:'不同提案標題'},key:propKey});
 assert.equal(propConflict.status,409);
 assert.equal(propConflict.data.code,'idempotency_conflict');

 for(const [action,body] of [
  ['consent',{policy_version:'development-proposal-v1',accepted:true}],
  ['activate',{working_repository_url:'https://github.com/contributor/video-autopilot-kit'}],
  ['keys',{}],
 ] as const){
  const refused=await devReq(`/api/v1/me/development/skill/video-autopilot/${action}`,{token:allScopes.access_token,body});
  assert.equal(refused.status,403,action);
  assert.equal(refused.data.code,'scope_required',action);
 }
});
