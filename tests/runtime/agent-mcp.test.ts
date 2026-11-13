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
const schema=`fp_mcp_${process.pid}_${Date.now()}`,admin=createPool(url),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:12});
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

const rpcHeaders={Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'};
async function rpc(token:string|undefined,method:string,params?:unknown,extra:Record<string,string>={},target=app){
 const response=await target.request(origin+'/api/v1/mcp',{method:'POST',headers:{...rpcHeaders,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...extra},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params===undefined?{}:{params})})});
 return {status:response.status,data:await response.json() as any,response};
}
const invoke=(token:string,name:string,args:Record<string,unknown>)=>rpc(token,'tools/call',{name,arguments:args});
const result=(r:Awaited<ReturnType<typeof rpc>>)=>r.data.result.structuredContent;

test('MCP refuses missing, cookie, CSRF, cross-lane, revoked, suspended and inactive credentials',async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 assert.equal((await rpc(undefined,'ping')).status,401);
 assert.equal((await rpc(undefined,'ping',undefined,{Cookie:session.cookie,'X-CSRF-Token':session.csrf})).status,400);
 assert.equal((await rpc(token,'ping',undefined,{Cookie:session.cookie})).status,400);
 assert.equal((await rpc(token,'ping',undefined,{'X-CSRF-Token':session.csrf})).status,400);
 const store=randomUUID();
 await pool.query(`INSERT INTO retail_stores(store_id,community_id,seller_ref,name,description,support_contact)
 SELECT $1,community_id,user_id,'Synthetic store','Synthetic','Synthetic' FROM users WHERE user_id=$2`,[store,session.user.user_id]);
 for(const kind of ['storefront','supplier']){
  const foreign='fw_read_'+randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO member_client_connections(connection_id,user_id,community_id,client_name,kind,scope,token_hash,expires_at,store_id)
   SELECT $1,user_id,community_id,'Synthetic client',$2,$3,$4,now()+interval '1 day',CASE WHEN $2='storefront' THEN $6::uuid ELSE NULL END FROM users WHERE user_id=$5`,[randomUUID(),kind,kind==='storefront'?'storefront:read':'supplier:read',tokenHash(foreign),session.user.user_id,store]);
  assert.equal((await rpc(foreign,'ping')).status,401);
 }
 for(const column of ['revoked_at','suspended_at']){
  await pool.query(`UPDATE member_client_connections SET ${column}=now() WHERE connection_id=$1`,[issued.connection_id]);
  assert.equal((await rpc(token,'ping')).status,401);
  await pool.query(`UPDATE member_client_connections SET ${column}=NULL WHERE connection_id=$1`,[issued.connection_id]);
 }
 await pool.query('UPDATE users SET active=false WHERE user_id=$1',[session.user.user_id]);
 assert.equal((await rpc(token,'ping')).status,401);
});
test('MCP checks Origin on POST and GET, offers no GET stream and rejects untrusted Host',async()=>{
 const token=(await issue(await ready())).access_token;
 for(const method of ['POST','GET']){
  const response=await app.request(origin+'/api/v1/mcp',{method,headers:{...rpcHeaders,Authorization:'Bearer '+token,Origin:'https://attacker.invalid','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})}:{})});
  assert.equal(response.status,403);assert.equal((await response.json() as any).code,'origin_rejected');
 }
 const get=await app.request(origin+'/api/v1/mcp',{headers:{Authorization:'Bearer '+token}});
 assert.equal(get.status,405);assert.equal(get.headers.get('Allow'),'POST');
 assert.equal((await rpc(token,'ping',undefined,{Origin:origin})).status,200);
 assert.equal((await app.request('https://attacker.invalid/api/v1/mcp',{method:'POST',headers:{Authorization:'Bearer '+token}})).status,403);
});
test('MCP initialization negotiates known/unknown versions and accepts initialized and ping',async()=>{
 const token=(await issue(await ready())).access_token;
 for(const protocolVersion of ['2025-03-26','2025-06-18','2025-11-25','2099-01-01']){
  const r=await rpc(token,'initialize',{protocolVersion,clientInfo:{name:'synthetic',version:'1'},capabilities:{}}, {'MCP-Protocol-Version':'2025-11-25'});
  assert.equal(r.status,200);assert.equal(r.data.result.protocolVersion,['2099-01-01','2025-03-26'].includes(protocolVersion)?'2025-11-25':protocolVersion);
  assert.deepEqual(r.data.result.capabilities,{tools:{listChanged:false}});assert.equal(r.response.headers.get('Mcp-Session-Id'),null);
 }
 assert.equal((await rpc(token,'ping',undefined,{'MCP-Protocol-Version':'2099-01-01'})).status,400);
 const initialized=await app.request(origin+'/api/v1/mcp',{method:'POST',headers:{...rpcHeaders,'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
 assert.equal(initialized.status,202);assert.equal(await initialized.text(),'');
 assert.deepEqual((await rpc(token,'ping')).data.result,{});
 const noVersion=await app.request(origin+'/api/v1/mcp',{method:'POST',headers:{Accept:rpcHeaders.Accept,'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'ping'})});
 assert.equal(noVersion.status,400);assert.equal((await noVersion.json() as any).error.code,-32600);
});
test('MCP list is scope/gate filtered and contains only registered granted operations',async()=>{
 const session=await ready(),read=(await issue(session,['read'])).access_token,share=(await issue(session,['share'])).access_token;
 const names=(r:any)=>r.data.result.tools.map((t:any)=>t.name);
 const reads=await rpc(read,'tools/list'),writes=await rpc(share,'tools/list');
 assert.ok(names(reads).includes('events.read'));assert.ok(!names(reads).includes('events.share'));
 assert.ok(names(writes).includes('events.share'));assert.ok(!names(writes).includes('events.read'));
 for(const tool of [...reads.data.result.tools,...writes.data.result.tools]){
  const op=agentOperations.find(op=>op.id===tool.name&&op.granted!==false)!;assert.ok(op);
  assert.ok(!/admin|payment|password|delete|agent-tokens/.test(op.route));
  assert.deepEqual(tool.inputSchema,agentJsonSchema((await import('../../apps/platform-api/src/agent-schemas.js')).agentInputSchema(op)));
 }
 assert.ok(names(reads).includes('credit.achievements'));assert.ok(!names(reads).includes('tools.identity'));
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const signed=createApp(pool,origin,'local',{guildToolSigner:{privateKey:keys.privateKey,publicJwk:await crypto.subtle.exportKey('jwk',keys.publicKey),kid:randomUUID()}});
 const identity=(await rpc(read,'tools/list',undefined,{},signed)).data.result.tools.find((t:any)=>t.name==='tools.identity');
 assert.ok(identity);assert.equal(identity.annotations.readOnlyHint,false);assert.equal(identity.annotations.idempotentHint,false);
 const off=createApp(pool,origin,'local',{eventParticipationEnabled:false,socialAchievementsEnabled:false});
 assert.ok(!names(await rpc(read,'tools/list',undefined,{},off)).includes('credit.achievements'));
 const rsvp=(await issue(session,['rsvp'])).access_token;
 assert.ok(names(await rpc(rsvp,'tools/list')).includes('events.waitlist'));
 assert.ok(!names(await rpc(rsvp,'tools/list',undefined,{},off)).includes('events.waitlist'));
 const hidden=await rpc(read,'tools/call',{name:'credit.achievements',arguments:{}},{},off);
 assert.equal(hidden.data.result.isError,true);assert.equal(result(hidden).code,'scope_required');
});
test('MCP malformed requests, unknown methods/tools, arbitrary arguments and bad schemas are JSON-RPC errors',async()=>{
 const session=await ready();
 const cases:[string,unknown,number][]=[['no-such-method',{},-32601],['tools/call',{name:'admin.delete',arguments:{}},-32602],['tools/call',{name:'events.read',arguments:{id:'../admin'}},-32602],['tools/call',{name:'events.list',arguments:{url:'https://attacker.invalid',headers:{}}},-32602],['tools/call',{name:'events.rsvp',arguments:{id:randomUUID(),body:{going:'yes'},idempotency_key:randomUUID()}},-32602],['tools/call',{name:'events.rsvp',arguments:{id:randomUUID(),body:{going:true}}},-32602],['tools/list',{cursor:'arbitrary'},-32602]];
 const token=(await issue(session)).access_token;
 for(const [method,params,code] of cases){const r=await rpc(token,method,params);assert.equal(r.data.error.code,code);assert.equal(r.data.result,undefined);}
 for(const body of ['{',JSON.stringify([{jsonrpc:'2.0',id:1,method:'ping'}])]){
  const r=await app.request(origin+'/api/v1/mcp',{method:'POST',headers:{...rpcHeaders,'Content-Type':'application/json',Authorization:'Bearer '+token},body});
  assert.equal((await r.json() as any).error.code,body==='{'?-32700:-32600);
 }
});
test('MCP uses the REST body limit for both declared and streamed bytes',async()=>{
 const token=(await issue(await ready())).access_token;
 const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'ping',params:{padding:'x'.repeat(32768)}});
 for(const headers of [{},{'Content-Length':String(Buffer.byteLength(body))}] as Record<string,string>[]){
  const r=await app.request(origin+'/api/v1/mcp',{method:'POST',headers:{...rpcHeaders,'Content-Type':'application/json',Authorization:'Bearer '+token,...headers},body});
  assert.equal(r.status,413);assert.equal((await r.json() as any).code,'body_too_large');
 }
 assert.equal((await rpc(token,'ping',undefined,{Accept:'text/html'})).status,406);
 assert.equal((await rpc(token,'ping',undefined,{'Content-Type':'text/plain'})).status,415);
});
test('MCP read/create/versioned write match REST; confirmation, replay and publication budget run once',async()=>{
 const session=await ready(),issued=await issue(session),token=issued.access_token;
 const body=eventBody(),idempotency_key=randomUUID(),args={body,idempotency_key};
 const pending=await invoke(token,'events.share',args);assert.equal(result(pending).code,'pending_member');
 assert.deepEqual(result(pending),(await req('/api/v1/events',{token,body,key:idempotency_key})).data);
 const proposal=(await req('/api/v1/me/agent-tokens',{session})).data.items[0].pending_publication;
 await req(`/api/v1/me/agent-tokens/${issued.connection_id}/confirm`,{session,body:{request_sha256:proposal.request_sha256}});
 const created=await invoke(token,'events.share',args);assert.equal(created.data.result.isError,false);
 const event=result(created);assert.ok(event.event_id);
 assert.deepEqual(result(created),(await req('/api/v1/events',{token,body,key:idempotency_key})).data);
 assert.deepEqual(result(await invoke(token,'events.share',args)),event);
 assert.equal((await pool.query('SELECT public_items FROM agent_daily_usage WHERE connection_id=$1',[issued.connection_id])).rows[0].public_items,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM agent_publications WHERE connection_id=$1',[issued.connection_id])).rows[0].n,1);
 assert.deepEqual(result(await invoke(token,'events.read',{id:event.event_id})),(await req('/api/v1/events/'+event.event_id,{token})).data);
 await pool.query('UPDATE community_events SET waitlist_enabled=true,response_window_minutes=30 WHERE event_id=$1',[event.event_id]);
 const version=(await req('/api/v1/events/'+event.event_id,{token})).data.aggregate_version,key=randomUUID();
 const wait=await invoke(token,'events.waitlist',{id:event.event_id,body:{action:'join'},version,idempotency_key:key});
 assert.equal(wait.data.result.isError,false,JSON.stringify(wait.data));
 assert.deepEqual(result(wait),(await req(`/api/v1/events/${event.event_id}/waitlist`,{token,body:{action:'join'},key,headers:{'If-Match':`"${version}"`}})).data);
});
test('MCP domain errors preserve platform codes and each failed call counts once',async()=>{
 const session=await ready(),issued=await issue(session,['read']),token=issued.access_token;
 const denied=await invoke(token,'events.share',{body:eventBody(),idempotency_key:randomUUID()});
 assert.equal(denied.data.result.isError,true);assert.equal(result(denied).code,'scope_required');
 assert.deepEqual(result(denied),JSON.parse(denied.data.result.content[0].text));
 assert.equal((await pool.query('SELECT failure_count FROM member_client_connections WHERE connection_id=$1',[issued.connection_id])).rows[0].failure_count,1);
 const missing=await invoke(token,'events.read',{id:randomUUID()});assert.equal(result(missing).code,'not_found');
 assert.equal((await pool.query('SELECT failure_count FROM member_client_connections WHERE connection_id=$1',[issued.connection_id])).rows[0].failure_count,2);
 for(let i=0;i<8;i++)await invoke(token,'events.read',{id:randomUUID()});
 assert.equal((await rpc(token,'ping')).status,401);
});
test('MCP rechecks revocation and scopes between calls and does not expose another member share',async()=>{
 const owner=await ready(),other=await ready(1),issued=await issue(owner),token=issued.access_token;
 const foreign=(await req('/api/v1/shares',{session:other,body:{kind:'link',url:'https://example.com/foreign'}})).data.share_id;
 assert.ok(foreign);assert.equal(result(await invoke(token,'shares.read',{share_id:foreign})).code,'not_found');
 assert.equal((await rpc(token,'tools/list')).status,200);
 await pool.query("UPDATE member_client_connections SET scopes=ARRAY['rsvp']::text[] WHERE connection_id=$1",[issued.connection_id]);
 assert.ok(!(await rpc(token,'tools/list')).data.result.tools.some((t:any)=>t.name==='events.read'));
 assert.equal(result(await invoke(token,'events.read',{id:randomUUID()})).code,'scope_required');
 await req(`/api/v1/me/agent-tokens/${issued.connection_id}/revoke`,{session:owner,body:{}});
 assert.equal((await rpc(token,'tools/list')).status,401);
 assert.equal((await invoke(token,'events.read',{id:randomUUID()})).status,401);
});
