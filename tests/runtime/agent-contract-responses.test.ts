import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {agentOperations} from '../../apps/platform-api/src/agent-allowlist.js';
import {agentBodySchemas,agentJsonSchema,agentPendingSchema,agentResponseSchemas} from '../../apps/platform-api/src/agent-schemas.js';
import {agentContract} from '../../modules/client-connections/agent-contract.js';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
const origin='http://127.0.0.1:4310';
const url=process.env.TEST_DATABASE_URL!;
assert.ok(url?.includes('/fp_'),'explicit isolated database required');
const schema=`fp_resp_${process.pid}_${Date.now()}`,admin=createPool(url),pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:12});
const app=createApp(pool,origin,'local',{eventParticipationEnabled:true,socialAchievementsEnabled:true,linkPreviewFetch:async url=>new Response('<title>Synthetic '+new URL(String(url)).pathname+'</title>',{headers:{'Content-Type':'text/html'}})});
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
type Session={cookie:string;csrf:string;user:any};
async function req(path:string,opts:{session?:Session;token?:string;body?:unknown;key?:string;method?:string;headers?:Record<string,string>;app?:typeof app}={}){
 const {session,token,body,key=randomUUID(),method=body===undefined?'GET':'POST',app:targetApp=app}=opts;
 const headers:Record<string,string>={...(session?{Origin:origin,Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...(token?{Authorization:'Bearer '+token}:{}),...opts.headers};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;}
 const response=await targetApp.request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
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
async function issue(session:Session,scopes=['read','share','rsvp']){
 const r=await req('/api/v1/me/agent-tokens',{session,body:{name:'測試 Agent',scopes}});
 assert.equal(r.status,201,JSON.stringify(r.data));
 return r.data;
}

const contractDefs=()=>Object.values(agentContract.paths).flatMap((p:any)=>Object.values(p)) as any[];
function verifyContractResponse(opId:string,status:number,data:unknown,expectedStatus=200){
 assert.equal(status,expectedStatus,`${opId}: ${JSON.stringify(data)}`);
 const parsed=agentResponseSchemas[opId].safeParse(data);
 assert.equal(parsed.success,true,`${opId} schema failed: ${parsed.success?'':JSON.stringify(parsed.error.issues)}`);
 const def=contractDefs().find(d=>d.operationId===opId)!;
 const jsonSchema=def.responses[String(expectedStatus)]?.content?.['application/json']?.schema;
 assert.ok(jsonSchema,`${opId} contract json schema missing`);
 const jsonParsed=z.fromJSONSchema(jsonSchema).safeParse(data);
 assert.equal(jsonParsed.success,true,`${opId} contract json schema failed: ${jsonParsed.success?'':JSON.stringify(jsonParsed.error.issues)}`);
}
async function confirmFirstPublicItem(session:Session,connectionId:string){
 const list=await req('/api/v1/me/agent-tokens',{session});
 assert.equal(list.status,200,JSON.stringify(list.data));
 const pending=list.data.items.find((i:any)=>i.connection_id===connectionId)?.pending_publication;
 assert.ok(pending,`missing pending_publication for ${connectionId}`);
 const confirmed=await req(`/api/v1/me/agent-tokens/${connectionId}/confirm`,{session,body:{request_sha256:pending.request_sha256}});
 assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
}
async function runPublicItem(session:Session,opId:string,path:string,body:unknown,expectedStatus:number,seen:Set<string>){
 const issued=await issue(session),key=randomUUID();
 const pending=await req(path,{token:issued.access_token,body,key});
 assert.equal(pending.status,202,`${opId} expected 202: ${JSON.stringify(pending.data)}`);
 assert.equal(agentPendingSchema.safeParse(pending.data).success,true,`${opId} pending schema failed`);
 const pendingSchema=contractDefs().find(d=>d.operationId===opId)!.responses['202']?.content?.['application/json']?.schema;
 assert.ok(pendingSchema,`${opId} 202 contract json schema missing`);
 assert.equal(z.fromJSONSchema(pendingSchema).safeParse(pending.data).success,true,`${opId} 202 contract json schema failed`);
 await confirmFirstPublicItem(session,issued.connection_id);
 const done=await req(path,{token:issued.access_token,body,key});
 verifyContractResponse(opId,done.status,done.data,expectedStatus);
 seen.add(opId);
 return done.data;
}

test('every operation with a response schema parses its live REST agent answer on the seeded database',async()=>{
 const session=await ready(),token=(await issue(session)).access_token;
 const eventsList=await req('/api/v1/events',{token});
 assert.equal(eventsList.status,200,JSON.stringify(eventsList.data));
 const eventId=eventsList.data.items?.[0]?.event_id??(await req('/api/v1/events',{session,body:{title:'測試活動',description:'交流',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'online',location:'線上',capacity:30,visibility:'open'}})).data.event_id;
 const sharesList=await req('/api/v1/shares',{token});
 assert.equal(sharesList.status,200,JSON.stringify(sharesList.data));
 const shareId=sharesList.data.items?.[0]?.share_id??(await req('/api/v1/shares',{session,body:{kind:'link',url:'https://example.com/seeded'}})).data.share_id;
 const {notifyMember}=await import('../../modules/member-communications/notifications.js');
 const communityId=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[session.user.user_id])).rows[0].community_id;
 await notifyMember(pool,{community_id:communityId,recipient_ref:session.user.user_id,kind:'friend_request',source_key:randomUUID(),title:'測試通知',body:'通知內容',action:null});
 const routes:Record<string,string>={
  'events.list':'/api/v1/events',
  'events.read':`/api/v1/events/${eventId}`,
  'credit.records':'/api/v1/me/contribution-records',
  'credit.outcomes':'/api/v1/me/contribution-outcomes',
  'credit.achievements':'/api/v1/me/social-achievements',
  'notifications.list':'/api/v1/me/notifications',
  'agent.events':'/api/v1/agent/events',
  'shares.list':'/api/v1/shares',
  'shares.read':`/api/v1/shares/${shareId}`,
  'credit.read':'/api/v1/me/credit',
  'credit.results':'/api/v1/me/share-results',
 };
 for(const op of agentOperations.filter(op=>op.granted!==false&&op.method==='GET'&&agentResponseSchemas[op.id])){
  const path=routes[op.id];
  assert.ok(path,`missing route mapping for ${op.id}`);
  const r=await req(path,{token});
  verifyContractResponse(op.id,r.status,r.data,200);
 }
});

test('every write operation with a response schema parses its live REST agent answer on the seeded database',async t=>{
 const session=await ready(),token=(await issue(session)).access_token;
 const seen=new Set<string>();
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const signedApp=createApp(pool,origin,'local',{eventParticipationEnabled:true,socialAchievementsEnabled:true,guildToolSigner:{privateKey:keys.privateKey,publicJwk:await crypto.subtle.exportKey('jwk',keys.publicKey),kid:randomUUID()}});
 await pool.query(`INSERT INTO guild_tools(id,community_id,guild_key,tool_id,state,title,entry_url,origin,bridge_version,profile,scopes,permissions,registered_by)
  SELECT $1,community_id,'guild_games','budget-tool','enabled','合成工具','https://tools.example.com/','https://tools.example.com','freedom.guild-launchpad/v2','origin','["context:read","session:exchange"]','[]',user_id FROM users WHERE user_id=$2`,[randomUUID(),session.user.user_id]);
 const toolIdentity=await req('/api/v1/guilds/guild_games/tools/budget-tool/token',{token,body:{},app:signedApp});
 verifyContractResponse('tools.identity',toolIdentity.status,toolIdentity.data,200);seen.add('tools.identity');

 const startsAt=new Date(Date.now()+86400000).toISOString(),endsAt=new Date(Date.now()+90000000).toISOString();
 const eventInput={title:'測試活動',description:'一起交流',starts_at:startsAt,ends_at:endsAt,mode:'online',location:'線上',capacity:30,visibility:'open'};
 const createdEvent=await runPublicItem(session,'events.share','/api/v1/events',eventInput,201,seen);
 const eventId=createdEvent.event_id as string;
 const latestVersion=async()=>{const e=await req(`/api/v1/events/${eventId}`,{token});assert.equal(e.status,200);return e.data.aggregate_version;};

 const eventLinks=await req(`/api/v1/events/${eventId}/share`,{token,body:{}});
 verifyContractResponse('events.links',eventLinks.status,eventLinks.data,200);seen.add('events.links');

 const eventUpdate=await req(`/api/v1/events/${eventId}/update`,{token,body:{...eventInput,title:'測試活動（更新）'},headers:{'If-Match':`"${await latestVersion()}"`}});
 verifyContractResponse('events.update',eventUpdate.status,eventUpdate.data,200);seen.add('events.update');

 const eventAnnounce=await req(`/api/v1/events/${eventId}/announcements`,{token,body:{message:'活動通知'},headers:{'If-Match':`"${await latestVersion()}"`}});
 verifyContractResponse('events.announce',eventAnnounce.status,eventAnnounce.data,200);seen.add('events.announce');

 const eventWaitlist=await req(`/api/v1/events/${eventId}/waitlist`,{token,body:{action:'join'},headers:{'If-Match':`"${await latestVersion()}"`}});
 verifyContractResponse('events.waitlist',eventWaitlist.status,eventWaitlist.data,200);seen.add('events.waitlist');

 const eventRsvp=await req(`/api/v1/events/${eventId}/rsvp`,{token,body:{going:true}});
 verifyContractResponse('events.rsvp',eventRsvp.status,eventRsvp.data,200);seen.add('events.rsvp');

 const eventCancel=await req(`/api/v1/events/${eventId}/cancel`,{token,body:{},headers:{'If-Match':`"${await latestVersion()}"`}});
 verifyContractResponse('events.cancel',eventCancel.status,eventCancel.data,200);seen.add('events.cancel');

 const externalEvent=await req('/api/v1/events',{session,body:{title:'外部報名活動',description:'外部活動',starts_at:startsAt,ends_at:endsAt,mode:'online',location:'線上',capacity:null,visibility:'open',registration_mode:'external',external_registration_url:'https://example.com/register'}});
 assert.equal(externalEvent.status,201,JSON.stringify(externalEvent.data));
 const eventInterest=await req(`/api/v1/events/${externalEvent.data.event_id}/interest`,{token,body:{}});
 verifyContractResponse('events.interest',eventInterest.status,eventInterest.data,200);seen.add('events.interest');

 t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
  const url=String(input);assert.equal(new URL(url).hostname,'api.github.com');
  if(url.endsWith('/repos/example/project'))return Response.json({id:12345,full_name:'example/project',private:false,visibility:'public',default_branch:'main',fork:false,archived:false});
  if(url.endsWith('/commits/main'))return Response.json({sha:'a'.repeat(40)});
  if(url.includes('/license?ref='))return Response.json({path:'LICENSE',license:{spdx_id:'MIT'}});
  throw new Error('unexpected fixture request: '+url);
 });
 await runPublicItem(session,'repositories.share','/api/v1/opensource/projects',{repository_url:'https://github.com/example/project',title:'範例專案',description:'專案介紹',use_notes:'讀取 README',relationship:'curator',consent_to_share:true},201,seen);

 const sharesPreview=await req('/api/v1/shares/preview',{token,body:{kind:'link',url:'https://example.com/preview-test'}});
 verifyContractResponse('shares.preview',sharesPreview.status,sharesPreview.data,200);seen.add('shares.preview');

 const createdShare=await runPublicItem(session,'shares.create','/api/v1/shares',{kind:'link',url:'https://example.com/agent-share'},200,seen);
 const createdShareId=createdShare.share_id as string;

 const sharesLinks=await req(`/api/v1/shares/${createdShareId}/links`,{token,body:{}});
 verifyContractResponse('shares.links',sharesLinks.status,sharesLinks.data,200);seen.add('shares.links');

 const sharesRetract=await req(`/api/v1/shares/${createdShareId}/retract`,{token,body:{}});
 verifyContractResponse('shares.retract',sharesRetract.status,sharesRetract.data,200);seen.add('shares.retract');

 const expectedWrites=agentOperations.filter(op=>op.granted!==false&&op.method!=='GET'&&agentResponseSchemas[op.id]).map(op=>op.id).sort();
 assert.deepEqual([...seen].sort(),expectedWrites);
});

test('granted operations without a response schema are none',()=>{
 const withoutSchema=agentOperations.filter(op=>op.granted!==false&&!agentResponseSchemas[op.id]).map(op=>op.id).sort();
 assert.deepEqual(withoutSchema,[]);
});
