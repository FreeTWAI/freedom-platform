import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createPool} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {agentOperation} from '../../apps/platform-api/src/agent-allowlist.js';

const origin='http://127.0.0.1:46451',url=process.env.TEST_DATABASE_URL!;
assert.ok(url?.includes('/fp_'),'explicit isolated database required');
const schema=`fp_sec_agent_${process.pid}_${Date.now()}`,admin=createPool(url);
const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`,max:16});
const app=createApp(pool,origin,'local',{linkPreviewFetch:async()=>new Response('<title>Synthetic fixture</title>',{headers:{'Content-Type':'text/html'}})});
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{await pool.query('TRUNCATE communities,login_attempts,auth_rate_limits CASCADE');await seedLocal(pool);});
type Session={cookie:string;csrf:string;user:any};
async function req(path:string,opts:{session?:Session;token?:string;body?:unknown;key?:string;method?:string;headers?:Record<string,string>}={}){
 const {session,token,body,key=randomUUID(),method=body===undefined?'GET':'POST'}=opts;
 const headers:Record<string,string>={...(session?{Origin:origin,Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...(token?{Authorization:'Bearer '+token}:{}),...opts.headers};
 if(body!==undefined){headers['Content-Type']='application/json';headers['Idempotency-Key']=key;}
 const response=await app.request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text();let data:any;try{data=JSON.parse(text);}catch{data=text;}
 return {status:response.status,data,text,response};
}
async function ready(index=0):Promise<Session>{
 const r=await req('/api/v1/auth/login',{body:{email:DEMO_USERS[index].email,password:DEMO_PASSWORD},headers:{Origin:origin}});assert.equal(r.status,200);
 await pool.query('UPDATE users SET onboarding_completed_at=now(),email=$2 WHERE user_id=$1',[r.data.user.user_id,`security-agent-${index}@example.com`]);
 return {cookie:r.response.headers.get('set-cookie')!.split(';')[0],csrf:r.data.csrf_token,user:r.data.user};
}
async function issue(session:Session,scopes=['read','share','rsvp']){const r=await req('/api/v1/me/agent-tokens',{session,body:{name:'安全測試',scopes}});assert.equal(r.status,201);return r.data;}
async function resetFailures(id:string){await pool.query('UPDATE member_client_connections SET failure_count=0,suspended_at=NULL WHERE connection_id=$1',[id]);}
async function confirm(session:Session,id:string){
 const listed=await req('/api/v1/me/agent-tokens',{session});
 const pending=listed.data.items.find((i:any)=>i.connection_id===id).pending_publication;assert.ok(pending);
 const r=await req(`/api/v1/me/agent-tokens/${id}/confirm`,{session,body:{request_sha256:pending.request_sha256}});assert.equal(r.status,200);
 return pending;
}

test('agent security: every forbidden route refuses live, revoked, expired, rotated and foreign-member tokens',async t=>{
 const a=await ready(),b=await ready(1),live=await issue(a),revoked=await issue(a),expired=await issue(a),old=await issue(a),foreign=await issue(b);
 await req(`/api/v1/me/agent-tokens/${revoked.connection_id}/revoke`,{session:a,body:{}});
 await pool.query("UPDATE member_client_connections SET expires_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[expired.connection_id]);
 assert.equal((await req(`/api/v1/me/agent-tokens/${old.connection_id}/renew`,{session:a,body:{name:'renewed',scopes:['read']}})).status,201);
 let routes=0;
 for(const route of app.routes){
  if(route.method==='ALL'||agentOperation(route.method,route.path))continue;
  const path=route.path.replace(/:([A-Za-z_][A-Za-z_0-9]*)(\{[^}]*\})?/g,randomUUID()).replace(/\*/g,'probe');
  for(const [kind,credential] of [['live',live],['revoked',revoked],['expired',expired],['rotated',old],['foreign',foreign]] as const){
   if(kind==='live'||kind==='foreign')await resetFailures(credential.connection_id);
   const r=await req(path,{token:credential.access_token,method:route.method,...(['GET','HEAD'].includes(route.method)?{}:{body:{}})});
   assert.equal(r.status,kind==='live'||kind==='foreign'?403:401,`${kind} ${route.method} ${route.path}`);
  }
  routes++;
 }
 assert.ok(routes>300);t.diagnostic(`${routes} forbidden registered routes checked with five credential states`);
});

test('agent security: method, case, slash, encoding and route-header confusion cannot select authority',async()=>{
 const a=await ready(),issued=await issue(a,['read']),writeOnly=await issue(a,['share']),token=issued.access_token;
 const canonical=await req('/api/v1/me/credit',{token});assert.equal(canonical.status,200);
 for(const path of ['/API/v1/me/credit','/api/V1/me/credit','/api/v1/me/credit/','/api//v1/me/credit','/api/v1//me/credit','/api/v1/me/%63redit','/api/v1/me%2fcredit','/api/v1/me/credit%00','/api/v1/me/credit%2f..%2fpassword']){
  await resetFailures(issued.connection_id);
  const r=await req(path,{token,headers:{'X-Route-Pattern':'/api/v1/me/credit','X-HTTP-Method-Override':'GET'}});
  // Hono decodes percent-encoded unreserved characters before route matching.
  // A canonical alias may read the same own data, but must not expand its scope.
  if(r.status===200)assert.deepEqual(r.data,canonical.data,path);else assert.ok(r.status>=400,path);
  await resetFailures(writeOnly.connection_id);
  assert.equal((await req(path,{token:writeOnly.access_token})).status,403,`alias expanded scope: ${path}`);
 }
 for(const method of ['HEAD','OPTIONS','PUT','PATCH','DELETE']){
  await resetFailures(issued.connection_id);
  assert.ok((await req('/api/v1/me/credit',{token,method,headers:{'X-HTTP-Method-Override':'GET'}})).status>=400,method);
 }
 assert.equal((await req('/api/v1/me/credit',{token})).status,200);
 for(const query of ['access_token','token','authorization'])assert.equal((await req('/api/v1/me/credit?'+query+'='+encodeURIComponent(token))).status,401);
 for(const cookie of [a.cookie,'unrelated=value',''])assert.equal((await req('/api/v1/me/credit',{token,headers:{Cookie:cookie}})).status,400);
});

test('agent security: read/share scope and body/header identity spoofing cannot cross members',async()=>{
 const a=await ready(),b=await ready(1),read=await issue(a,['read']),share=await issue(a,['share']),foreign=await issue(b);
 const owned=await req('/api/v1/shares',{session:a,body:{url:'https://example.com/security-owner'}});assert.equal(owned.status,200);
 const id=owned.data.share_id;
 assert.equal((await req('/api/v1/shares',{token:read.access_token,body:{url:'https://example.com/security-forged',user_id:b.user.user_id}})).status,403);
 assert.equal((await req('/api/v1/me/credit',{token:share.access_token})).status,403);
 for(const suffix of ['','/retract','/links']){
  const r=await req('/api/v1/shares/'+id+suffix,{token:foreign.access_token,headers:{'X-User-ID':a.user.user_id,'X-Agent-Scope':'share'},...(suffix?{body:{}}:{})});
  assert.equal(r.status,404);
 }
 assert.equal((await req('/api/v1/me/credit?user_id='+a.user.user_id,{token:foreign.access_token})).status,422);
 const ownCredit=await req('/api/v1/me/credit',{token:foreign.access_token});assert.equal(ownCredit.status,200);assert.ok(!ownCredit.text.includes(id));
});

test('agent security: first-publication races require exact approval and daily budget stays atomic',async()=>{
 const a=await ready(),issued=await issue(a),token=issued.access_token,key=randomUUID(),path='/api/v1/shares';
 const proposals=[{url:'https://example.com/proposal-a'},{url:'https://example.com/proposal-b'}];
 const pending=await Promise.all(proposals.map(body=>req(path,{token,body,key})));assert.deepEqual(pending.map(r=>r.status),[202,202]);
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares')).rows[0].n,0);
 const approval=await confirm(a,issued.connection_id);
 // Consent refers to one exact winning proposal, never both concurrent proposals.
 const first=await req(path,{token,body:approval.body,key});assert.equal(first.status,200);
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares')).rows[0].n,1);
 await pool.query('UPDATE member_client_connections SET public_daily_cap=3 WHERE connection_id=$1',[issued.connection_id]);
 const race=await Promise.all(Array.from({length:8},(_,i)=>req(path,{token,body:{url:`https://example.com/cap-${i}`}})));
 assert.equal(race.filter(r=>r.status===200).length,2);assert.equal(race.filter(r=>r.status===429).length,6);
 assert.equal((await pool.query('SELECT public_items FROM agent_daily_usage WHERE connection_id=$1',[issued.connection_id])).rows[0].public_items,3);
 assert.equal((await pool.query('SELECT count(*)::int n FROM agent_publications WHERE connection_id=$1',[issued.connection_id])).rows[0].n,3);
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares')).rows[0].n,3);
 assert.deepEqual((await req(path,{token,body:approval.body,key})).data,first.data);
});

test('agent security: cross-member idempotency replay never returns or mutates another publication',async()=>{
 const a=await ready(),b=await ready(1),one=await issue(a),two=await issue(b),key=randomUUID(),path='/api/v1/shares';
 const bodies=[{url:'https://example.com/receipt-a'},{url:'https://example.com/receipt-b'}];
 assert.equal((await req(path,{token:one.access_token,body:bodies[0],key})).status,202);await confirm(a,one.connection_id);
 const created=await req(path,{token:one.access_token,body:bodies[0],key});assert.equal(created.status,200);
 const foreign=await req(path,{token:two.access_token,body:bodies[1],key});assert.equal(foreign.status,202);assert.ok(!foreign.text.includes(created.data.share_id));await confirm(b,two.connection_id);
 const second=await req(path,{token:two.access_token,body:bodies[1],key});assert.equal(second.status,200);assert.notEqual(second.data.share_id,created.data.share_id);
 assert.equal((await pool.query('SELECT count(*)::int n FROM command_receipts WHERE idempotency_key=$1',[key])).rows[0].n,2);
});

test('agent security: guide, contract and cursor feed disclose no other member or credential',async()=>{
 const a=await ready(),b=await ready(1),one=await issue(a),two=await issue(b);
 const community=(await pool.query('SELECT community_id FROM users WHERE user_id=$1',[a.user.user_id])).rows[0].community_id;
 const privateId=randomUUID();
 await pool.query('SELECT record_agent_change($1,$2,$3,$4,$5)',[community,b.user.user_id,'share.credited',randomUUID(),privateId]);
 const own=await req('/api/v1/agent/events',{token:one.access_token});assert.equal(own.status,200);assert.deepEqual(own.data.items,[]);
 const foreign=await req('/api/v1/agent/events',{token:two.access_token});assert.equal(foreign.status,200);assert.equal(foreign.data.items[0].resource_id,privateId);
 assert.equal((await req('/api/v1/agent/events?after='+encodeURIComponent(foreign.data.next_cursor),{token:one.access_token})).status,400);
 for(const path of ['/agent.md','/agent/openapi.json']){
  const anonymous=await req(path),signedIn=await req(path,{session:b});assert.equal(anonymous.status,200);assert.equal(anonymous.text,signedIn.text);
  for(const sensitive of [one.access_token,two.access_token,a.user.user_id,b.user.user_id,privateId])assert.ok(!anonymous.text.includes(sensitive));
  assert.equal((await req(path,{token:one.access_token})).status,403);
 }
});

test('agent security: concurrent retries consume one publication, one receipt and one budget unit',async()=>{
 const a=await ready(),issued=await issue(a),token=issued.access_token,key=randomUUID(),path='/api/v1/shares',body={url:'https://example.com/concurrent-replay'};
 const pending=await Promise.all(Array.from({length:8},()=>req(path,{token,body,key})));assert.ok(pending.every(r=>r.status===202));
 assert.equal((await pool.query('SELECT count(*)::int n FROM agent_pending_publications WHERE connection_id=$1',[issued.connection_id])).rows[0].n,1);
 await confirm(a,issued.connection_id);
 const published=await Promise.all(Array.from({length:8},()=>req(path,{token,body,key})));assert.ok(published.every(r=>r.status===200));
 for(const result of published)assert.deepEqual(result.data,published[0].data);
 assert.equal((await pool.query('SELECT public_items FROM agent_daily_usage WHERE connection_id=$1',[issued.connection_id])).rows[0].public_items,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM agent_publications WHERE connection_id=$1',[issued.connection_id])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM command_receipts WHERE user_id=$1 AND idempotency_key=$2',[a.user.user_id,key])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM shares')).rows[0].n,1);
});

test('agent security: malformed bearer schemes never fall back to member or anonymous authority',async()=>{
 const a=await ready(),issued=await issue(a),token=issued.access_token;
 for(const authorization of [token,'Basic '+token,'BearerX '+token,'Bearer\t'+token,'Bearer '+token+', Bearer '+token,'Bearer '+token.toUpperCase(),'Bearer '+token+'x']){
  assert.equal((await req('/api/v1/me/credit',{headers:{Authorization:authorization}})).status,401);
  assert.equal((await req('/api/v1/me/credit',{session:a,headers:{Authorization:authorization}})).status,400);
 }
 assert.equal((await req('/api/v1/me/credit',{headers:{Authorization:'bEaReR  '+token}})).status,200);
});

test('agent co-sharers can retract only their own endorsement and cannot moderate',async()=>{
 const a=await ready(),b=await ready(1),issued=await issue(b),token=issued.access_token;
 const source='https://example.com/security-co-sharers';
 const first=await req('/api/v1/shares',{session:a,body:{url:source}});assert.equal(first.status,200);
 const second=await req('/api/v1/shares',{session:b,body:{url:source}});assert.equal(second.status,200);
 const id=first.data.share_id;assert.equal(second.data.share_id,id);
 const retract=await req(`/api/v1/shares/${id}/retract`,{token,body:{}});
 assert.equal(retract.status,200);assert.equal(retract.data.state,'published');
 assert.deepEqual((await pool.query('SELECT user_id FROM share_endorsements WHERE share_id=$1 AND withdrawn_at IS NULL',[id])).rows.map(r=>r.user_id),[a.user.user_id]);
 assert.equal((await pool.query('SELECT sum(units)::int n FROM share_credit_events WHERE share_id=$1 AND user_id=$2',[id,a.user.user_id])).rows[0].n,1);
 for(const decision of ['restore','confirm'])assert.equal((await req(`/admin/api/shares/${id}/${decision}`,{token,body:{reason:'try to moderate'}})).status,403);
});
