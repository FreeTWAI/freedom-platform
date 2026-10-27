import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {SignJWT,exportJWK,generateKeyPair} from 'jose';
import {createApp,nodeRuntime} from '../../apps/platform-api/src/app.js';
import {workerRuntime,type WorkerEnv} from '../../apps/platform-api/src/worker.js';
import {PortalClient} from '../../apps/portal-web/src/api.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {tokenHash} from '../../modules/identity-membership/service.js';
import {totpCode} from '../../modules/identity-membership/totp.js';
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString||!/^\/fp_[a-z0-9_]+$/.test(new URL(connectionString).pathname))throw Error('Explicit isolated fp_* TEST_DATABASE_URL required');
const schema=`fp_google_routes_${process.pid}_${Date.now()}`,admin=new Pool({connectionString}),pool=new Pool({connectionString,options:`-c search_path=${schema}`});
const origin='http://127.0.0.1:4310',keys=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'route-key',alg:'RS256'};let idToken='';
const googleLogin={enabled:true,clientId:'route-client',clientSecret:'fixture-only-secret',transport:async(url:RequestInfo|URL)=>Response.json(String(url).endsWith('/certs')?{keys:[jwk]}:{id_token:idToken})};
const mail:string[]=[];let communityId:string;
const app=createApp(pool,origin,'local',{googleLogin,passwordEmailSender:async(_to,url)=>{mail.push(url);}});
const off=createApp(pool,origin,'local',{googleLogin:{...googleLogin,enabled:false},passwordEmailSender:async(_to,url)=>{mail.push(url);}});
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);communityId=(await pool.query('SELECT community_id FROM users LIMIT 1')).rows[0].community_id;});
beforeEach(async()=>{await pool.query('TRUNCATE auth_rate_limits');});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
async function request(path:string,body?:unknown,headers:Record<string,string>={},api=app){const response=await api.request(origin+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...body!==undefined?{'Content-Type':'application/json'}:{},...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json() as any,response};}
function cookie(reply:Awaited<ReturnType<typeof request>>,name:string){return reply.response.headers.getSetCookie().find(value=>value.startsWith(name+'='))?.split(';')[0]??'';}
async function start(){const reply=await request('/auth/google/start',{});assert.equal(reply.status,200);const url=new URL(reply.data.url);return {reply,state:url.searchParams.get('state')!,nonce:url.searchParams.get('nonce')!,cookie:cookie(reply,'freedom_google_flow')};}
async function token(nonce:string,email=`${randomUUID()}@gmail.com`,subject=randomUUID()){idToken=await new SignJWT({nonce,email,email_verified:true}).setProtectedHeader({alg:'RS256',kid:'route-key'}).setIssuer('https://accounts.google.com').setAudience('route-client').setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);}

test('OFF and missing mailbox recovery advertise only false; no state or credentials exposed',async()=>{
 for(const api of [off,createApp(pool,origin,'local',{googleLogin})]){
 const config=await request('/auth/google/config',undefined,{},api);assert.deepEqual(config.data,{enabled:false});assert.equal(config.response.headers.get('cache-control'),'no-store');
 const result=await request('/auth/google/start',{}, {},api);assert.equal(result.status,503);assert.equal(result.response.headers.get('set-cookie'),null);
 }
 assert.equal((await pool.query('SELECT count(*)::int n FROM google_login_states')).rows[0].n,0);
});
test('host Origin/JSON limits, Strict flow cookie, missing/duplicate browser cookies and member CSRF stay enforced',async()=>{
 assert.equal((await request('/auth/google/start',{}, {Origin:'https://evil.example'})).status,403);
 const f=await start();assert.match(f.reply.response.headers.get('set-cookie')!,/HttpOnly/);assert.match(f.reply.response.headers.get('set-cookie')!,/SameSite=Strict/);assert.ok(!f.reply.response.headers.get('set-cookie')!.includes('freedom_local_session'));
 await token(f.nonce);const body={state:f.state,code:'fixture-code'};
 assert.equal((await request('/auth/google/complete',body)).status,409);
 assert.equal((await request('/auth/google/complete',body,{Cookie:`${f.cookie}; ${f.cookie}`})).status,409);
 const signed=await request('/auth/login',{email:DEMO_USERS[0].email,password:DEMO_PASSWORD});const memberCookie=cookie(signed,'freedom_local_session');assert.ok(memberCookie);
 assert.equal((await request('/me/google/start',{password:DEMO_PASSWORD},{Cookie:memberCookie})).status,403);
 assert.equal((await request('/me/google/unlink',{password:DEMO_PASSWORD},{Cookie:memberCookie,'X-CSRF-Token':'wrong'})).status,403);
});
test('callback creates only member session, keeps onboarding and real-password settings protected',async()=>{
 const f=await start();await token(f.nonce);const complete=await request('/auth/google/complete',{state:f.state,code:'fixture-code'},{Cookie:f.cookie});assert.equal(complete.status,200);assert.equal(complete.data.activation_required,true);
 const memberCookie=cookie(complete,'freedom_local_session');assert.ok(memberCookie);assert.match(complete.response.headers.getSetCookie().find(x=>x.startsWith('freedom_local_session='))!,/SameSite=Strict/);
 assert.equal((await request('/session',undefined,{Cookie:memberCookie})).status,401,'provisional cookie must never authenticate');
 const activated=await request('/auth/google/activate',{activation:complete.data.activation},{Cookie:`${memberCookie}; ${f.cookie}`});assert.equal(activated.status,200);assert.equal(activated.data.registered,true);assert.equal(activated.response.headers.get('set-cookie'),null);
 const headers={Cookie:memberCookie,'X-CSRF-Token':activated.data.csrf_token};
 const onboarding=await request('/me/onboarding',undefined,headers);assert.equal(onboarding.status,200);assert.equal(onboarding.data.required,true);
 // Account management remains behind the pre-existing onboarding boundary.
 const identityId=(await pool.query('SELECT identity_id FROM member_login_identities WHERE user_id=$1 AND revoked_at IS NULL',[activated.data.user.user_id])).rows[0].identity_id;
 const privateRoute=await request('/me/google/unlink',{password:'not-a-password',identity_id:identityId},headers);assert.notEqual(privateRoute.status,200);
 await pool.query('UPDATE users SET onboarding_required=false WHERE user_id=$1',[activated.data.user.user_id]);
 const account=await request('/me/account',undefined,headers);assert.equal(account.status,200);assert.equal(account.data.has_password,false);
 const ownIdentity=await request('/me/google',undefined,headers);assert.equal(ownIdentity.data.identity_id,identityId);
 assert.equal((await request('/me/google/unlink',{password:'not-a-password',identity_id:ownIdentity.data.identity_id},headers)).status,403);
 assert.equal((await request('/me/account/email-change/request',{email:'other@example.test',password:'not-a-password'},headers)).status,503,'mail adapter still gates existing email change');
 assert.equal((await request('/me/account/deactivate',{password:'not-a-password'},{...headers,'Idempotency-Key':randomUUID(),'If-Match':'"1"'})).status,422);
 const reset=await request('/auth/reset/request',{email:activated.data.user.email},{},off);assert.equal(reset.status,200);
 const recovered=await request('/auth/reset/confirm',{token:mail.at(-1)!.split('/').at(-1),password:'real-password-set-while-off'},{},off);assert.equal(recovered.status,200);
 assert.equal((await request('/session',undefined,headers)).status,401);
 assert.equal((await request('/auth/login',{email:activated.data.user.email,password:'real-password-set-while-off'},{},off)).status,200);
});
test('existing password login cancels same browser pending Google state and preserves normal session response',async()=>{
 const f=await start();await token(f.nonce);
 const normal=await request('/auth/login',{email:DEMO_USERS[1].email,password:DEMO_PASSWORD},{Cookie:f.cookie});assert.equal(normal.status,200);
 assert.equal((await pool.query('SELECT 1 FROM google_login_states WHERE state_hash=$1',[tokenHash(f.state)])).rowCount,0);
 assert.equal((await request('/auth/google/complete',{state:f.state,code:'fixture-code'},{Cookie:f.cookie})).status,409);
 const ordinary=await request('/auth/login',{email:DEMO_USERS[1].email,password:DEMO_PASSWORD});assert.equal(ordinary.response.headers.getSetCookie().length,2,'normal auth always clears only the new flow cookie, even when absent');assert.ok(ordinary.response.headers.getSetCookie().some(x=>x.startsWith('freedom_google_flow=')&&x.includes('Max-Age=0')));
});
test('exact five anonymous PortalClient paths only; lookalikes and private routes retain CSRF',async t=>{
 const seen:{url:string;headers:Headers}[]=[];t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{seen.push({url:String(url),headers:new Headers(init?.headers)});return Response.json({ok:true});});
 const client=new PortalClient();for(const path of ['/auth/google/start','/auth/google/complete','/auth/google/totp','/auth/google/cancel','/auth/google/activate'])await client.post(path,{}, {skipAuthHandler:true,suppressConsole:true});assert.equal(seen.length,5);
 for(const path of ['/auth/google','/auth/google/start/','/auth/google/start?x=1','/auth/google/start-extra','/me/google/start','/me/google/unlink'])await assert.rejects(client.post(path,{}));assert.equal(seen.length,5);
 client.csrfToken='test-csrf';await client.post('/me/google/unlink',{password:'synthetic-only'},{suppressConsole:true});assert.equal(seen.at(-1)!.headers.get('X-CSRF-Token'),'test-csrf');
});
test('Node and Worker settings are strictly opt-in and Worker requests do not borrow process credentials',()=>{
 const saved={...process.env};try{
 process.env.FREEDOM_GOOGLE_LOGIN_ENABLED='true';process.env.GOOGLE_LOGIN_CLIENT_ID='node-client';process.env.GOOGLE_LOGIN_CLIENT_SECRET='node-only-secret';
 assert.equal(nodeRuntime('local',origin).googleLogin?.clientId,'node-client');
 const config={freedomEnv:'local' as const,origin,release:null,trustConnectingIp:false};assert.equal(workerRuntime({} as WorkerEnv,config).googleLogin,undefined);
 for(const flag of ['false','TRUE','1',' true',''])assert.equal(workerRuntime({FREEDOM_GOOGLE_LOGIN_ENABLED:flag,GOOGLE_LOGIN_CLIENT_ID:'worker-client',GOOGLE_LOGIN_CLIENT_SECRET:'worker-only-secret'} as WorkerEnv,config).googleLogin,undefined);
 const first=workerRuntime({FREEDOM_GOOGLE_LOGIN_ENABLED:'true',GOOGLE_LOGIN_CLIENT_ID:'worker-client',GOOGLE_LOGIN_CLIENT_SECRET:'worker-only-secret'} as WorkerEnv,config);assert.equal(first.googleLogin?.clientId,'worker-client');assert.equal(workerRuntime({} as WorkerEnv,config).googleLogin,undefined);
 assert.equal(nodeRuntime('local',origin,{googleLogin:{enabled:false,clientId:'',clientSecret:''}}).googleLogin?.enabled,false);
 }finally{for(const key of ['FREEDOM_GOOGLE_LOGIN_ENABLED','GOOGLE_LOGIN_CLIENT_ID','GOOGLE_LOGIN_CLIENT_SECRET']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});

test('password login revokes a just-finalized Google flow even when its response has not reached browser',async()=>{
 const f=await start();await token(f.nonce);
 // Hold the response as a value: the browser still has only the original flow
 // cookie when it dispatches its independent password login.
 const googleResponse=await request('/auth/google/complete',{state:f.state,code:'fixture-code'},{Cookie:f.cookie});assert.equal(googleResponse.status,200);
 const oldSession=cookie(googleResponse,'freedom_local_session');assert.ok(oldSession);
 const normal=await request('/auth/login',{email:DEMO_USERS[1].email,password:DEMO_PASSWORD},{Cookie:f.cookie});assert.equal(normal.status,200);
 assert.equal((await request('/session',undefined,{Cookie:oldSession})).status,401,'a delayed Google Set-Cookie must not revive superseded authority');
 assert.equal((await request('/session',undefined,{Cookie:cookie(normal,'freedom_local_session')})).status,200);
});

test('comparison: existing independent password logins without an old cookie each retain their own session',async()=>{
 const a=await request('/auth/login',{email:DEMO_USERS[0].email,password:DEMO_PASSWORD},{},off);
 const b=await request('/auth/login',{email:DEMO_USERS[1].email,password:DEMO_PASSWORD},{},off);
 assert.equal(a.status,200);assert.equal(b.status,200);
 // Existing behavior: neither request supplied a previous cookie to revoke.
 // This deliberately documents the baseline comparison, not a Google guarantee.
 assert.equal((await request('/session',undefined,{Cookie:cookie(a,'freedom_local_session')},off)).status,200);
 assert.equal((await request('/session',undefined,{Cookie:cookie(b,'freedom_local_session')},off)).status,200);
});

async function dormant(){const f=await start();await token(f.nonce);const reply=await request('/auth/google/complete',{state:f.state,code:'fixture-code'},{Cookie:f.cookie});assert.equal(reply.status,200);assert.equal(reply.data.activation_required,true);assert.equal(reply.data.user,undefined);return {...f,reply,session:cookie(reply,'freedom_local_session')};}
test('dormant session has no presence or authority; one-use ACK binds exact cookie/browser and sends no cookies',async()=>{
 const f=await dormant(),raw=f.session.split('=')[1];
 const row=(await pool.query('SELECT * FROM sessions WHERE token_hash=$1',[tokenHash(raw)])).rows[0];assert.equal(row.created_at,null);assert.equal(row.last_seen_at,null);assert.ok(new Date(row.expires_at).getTime()<=Date.now());
 assert.equal((await request('/session',undefined,{Cookie:f.session})).status,401);
 const body={activation:f.reply.data.activation};
 assert.equal((await request('/auth/google/activate',body,{Cookie:f.cookie})).status,409);
 assert.equal((await request('/auth/google/activate',body,{Cookie:`freedom_local_session=${'X'.repeat(43)}; ${f.cookie}`})).status,409);
 assert.equal((await request('/auth/google/activate',body,{Cookie:f.session})).status,409);
 const issued=(await pool.query('SELECT issued_at FROM google_login_activations WHERE activation_hash=$1',[tokenHash(body.activation)])).rows[0].issued_at;
 const ack=await request('/auth/google/activate',body,{Cookie:`${f.session}; ${f.cookie}`});assert.equal(ack.status,200);assert.equal(ack.response.headers.get('set-cookie'),null);
 const active=(await pool.query('SELECT created_at,expires_at,last_seen_at FROM sessions WHERE token_hash=$1',[tokenHash(raw)])).rows[0];assert.equal(new Date(active.created_at).toISOString(),new Date(issued).toISOString());assert.equal(new Date(active.expires_at).getTime()-new Date(issued).getTime(),30*86400_000);assert.ok(active.last_seen_at);
 assert.equal((await request('/session',undefined,{Cookie:f.session})).status,200);
 const duplicate=await request('/auth/google/activate',body,{Cookie:`${f.session}; ${f.cookie}`});assert.equal(duplicate.status,409);assert.equal(duplicate.response.headers.get('set-cookie'),null);
 const completeAgain=await request('/auth/google/complete',{state:f.state,code:'fixture-code'},{Cookie:f.cookie});assert.equal(completeAgain.status,409);assert.equal(completeAgain.response.headers.get('set-cookie'),null);
});
test('queued no-marker ordinary login clears flow even OFF; delayed dormant cookie cannot activate',async()=>{
 const f=await dormant();
 // This header set models a normal request sent before the Google start response
 // established its marker, regardless of when its queued response is delivered.
 const normal=await request('/auth/login',{email:DEMO_USERS[0].email,password:DEMO_PASSWORD},{},off);assert.equal(normal.status,200);
 const clears=normal.response.headers.getSetCookie().filter(x=>x.startsWith('freedom_google_flow='));assert.equal(clears.length,1);assert.match(clears[0],/Max-Age=0/);
 const delayed=await request('/auth/google/activate',{activation:f.reply.data.activation},{Cookie:f.session});assert.equal(delayed.status,409);assert.equal(delayed.response.headers.get('set-cookie'),null);
 assert.equal((await request('/session',undefined,{Cookie:f.session})).status,401,'delayed dormant cookie can only require re-login');
 assert.equal((await request('/session',undefined,{Cookie:cookie(normal,'freedom_local_session')})).status,200);
});
test('a second start replaces marker and cannot activate the older flow',async()=>{
 const a=await dormant(),b=await start();assert.notEqual(a.cookie,b.cookie);
 const ack=await request('/auth/google/activate',{activation:a.reply.data.activation},{Cookie:`${a.session}; ${b.cookie}`});assert.equal(ack.status,409);
 assert.equal((await request('/session',undefined,{Cookie:a.session})).status,401);
});
test('after ACK there is no Google cookie response left to overwrite subsequent password login',async()=>{
 const f=await dormant(),ack=await request('/auth/google/activate',{activation:f.reply.data.activation},{Cookie:`${f.session}; ${f.cookie}`});assert.equal(ack.status,200);assert.equal(ack.response.headers.get('set-cookie'),null);
 const normal=await request('/auth/login',{email:DEMO_USERS[1].email,password:DEMO_PASSWORD},{Cookie:`${f.session}; ${f.cookie}`});assert.equal(normal.status,200);
 assert.equal((await request('/session',undefined,{Cookie:f.session})).status,401);
 const current=await request('/session',undefined,{Cookie:cookie(normal,'freedom_local_session')});assert.equal(current.data.user.email,DEMO_USERS[1].email);
});
test('cancellation, logout and reset invalidate pending activation; proof expiry remains fail closed',async()=>{
 const cancelled=await dormant();assert.equal((await request('/auth/google/cancel',{state:cancelled.state},{Cookie:cancelled.cookie})).status,200);
 assert.equal((await request('/auth/google/activate',{activation:cancelled.reply.data.activation},{Cookie:`${cancelled.session}; ${cancelled.cookie}`})).status,409);
 const loggingOut=await dormant(),normal=await request('/auth/login',{email:DEMO_USERS[0].email,password:DEMO_PASSWORD});
 const logout=await request('/auth/logout',{}, {Cookie:`${cookie(normal,'freedom_local_session')}; ${loggingOut.cookie}`,'X-CSRF-Token':normal.data.csrf_token});assert.equal(logout.status,200);assert.ok(logout.response.headers.getSetCookie().some(x=>x.startsWith('freedom_google_flow=')));
 assert.equal((await request('/auth/google/activate',{activation:loggingOut.reply.data.activation},{Cookie:`${loggingOut.session}; ${loggingOut.cookie}`})).status,409);
 const recovering=await dormant();await request('/auth/reset/request',{email:DEMO_USERS[0].email});
 const reset=await request('/auth/reset/confirm',{token:mail.at(-1)!.split('/').at(-1),password:DEMO_PASSWORD},{Cookie:recovering.cookie},off);assert.equal(reset.status,200);
 assert.equal((await request('/auth/google/activate',{activation:recovering.reply.data.activation},{Cookie:`${recovering.session}; ${recovering.cookie}`})).status,409);
 const expired=await dormant();await pool.query("UPDATE google_login_activations SET expires_at=clock_timestamp()-interval '1 second' WHERE activation_hash=$1",[tokenHash(expired.reply.data.activation)]);
 assert.equal((await request('/auth/google/activate',{activation:expired.reply.data.activation},{Cookie:`${expired.session}; ${expired.cookie}`})).status,409);
 const {pruneExpiredAuthRecords}=await import('../../modules/identity-membership/auth-pruning.js');await pruneExpiredAuthRecords(pool,{batch:500});
 assert.equal((await pool.query('SELECT 1 FROM sessions WHERE token_hash=$1',[tokenHash(expired.session.split('=')[1])])).rowCount,0);
});

test('late replay of lost unlink response must not revoke a subsequently linked identity generation',async()=>{
 const signed=await request('/auth/login',{email:DEMO_USERS[1].email,password:DEMO_PASSWORD}),memberCookie=cookie(signed,'freedom_local_session');
 const headers={Cookie:memberCookie,'X-CSRF-Token':signed.data.csrf_token};
 async function link(){
  const started=await request('/me/google/start',{password:DEMO_PASSWORD},headers);assert.equal(started.status,200);
  const params=new URL(started.data.url).searchParams;await token(params.get('nonce')!);
  const completed=await request('/me/google/complete',{state:params.get('state'),code:'fixture-code'},{...headers,Cookie:`${memberCookie}; ${cookie(started,'freedom_google_flow')}`});assert.equal(completed.status,200);
  return (await pool.query('SELECT identity_id FROM member_login_identities WHERE user_id=$1 AND revoked_at IS NULL',[signed.data.user.user_id])).rows[0].identity_id;
 }
 const first=await link(),key=randomUUID(),body={password:DEMO_PASSWORD,identity_id:first},unlinkHeaders={...headers,'Idempotency-Key':key};
 const lost=await request('/me/google/unlink',body,unlinkHeaders);assert.equal(lost.status,200); // Browser loses this response.
 const second=await link();assert.notEqual(second,first);
 const own=await request('/me/google',undefined,headers);assert.deepEqual(own.data,{enabled:true,linked:true,identity_id:second});
 const subject=(await pool.query('SELECT subject FROM member_login_identities WHERE identity_id=$1',[second])).rows[0].subject;
 const encryptionKey=Buffer.alloc(32,0x76).toString('base64'),secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
 const mfaApp=createApp(pool,origin,'local',{googleLogin,passwordEmailSender:async()=>{},totpEncryptionKey:encryptionKey});
 const counter=Number((await pool.query('SELECT floor(extract(epoch FROM clock_timestamp())/30)::bigint n')).rows[0].n);
 const enrollment=await request('/me/totp/enable',{password:DEMO_PASSWORD,secret,code:totpCode(secret,counter)},{...headers,'Idempotency-Key':randomUUID()},mfaApp);assert.equal(enrollment.status,200);
 const signingIn=await start();await token(signingIn.nonce,`${randomUUID()}@gmail.com`,subject);
 const factor=await request('/auth/google/complete',{state:signingIn.state,code:'fixture-code'},{Cookie:signingIn.cookie});assert.equal(factor.data.totp_required,true);
 const dormant=await request('/auth/google/totp',{challenge:factor.data.challenge,code:enrollment.data.backup_codes[0]},{Cookie:signingIn.cookie},mfaApp);assert.equal(dormant.status,200);
 const nextFactor=await start();await token(nextFactor.nonce,`${randomUUID()}@gmail.com`,subject);
 const challenge=await request('/auth/google/complete',{state:nextFactor.state,code:'fixture-code'},{Cookie:nextFactor.cookie});assert.equal(challenge.data.totp_required,true);
 const pendingLink=await request('/me/google/start',{password:DEMO_PASSWORD},headers);assert.equal(pendingLink.status,200);
 const stateHash=tokenHash(new URL(pendingLink.data.url).searchParams.get('state')!),challengeHash=tokenHash(challenge.data.challenge);
 for(const invalid of [{password:DEMO_PASSWORD},{password:DEMO_PASSWORD,identity_id:'not-a-uuid'},{password:DEMO_PASSWORD,identity_id:randomUUID()}]){
  const denied=await request('/me/google/unlink',invalid,headers);assert.ok(denied.status>=400&&denied.status<500);
 }
 const another=await request('/auth/login',{email:DEMO_USERS[0].email,password:DEMO_PASSWORD});
 const foreign=await request('/me/google/unlink',{password:DEMO_PASSWORD,identity_id:second},{Cookie:cookie(another,'freedom_local_session'),'X-CSRF-Token':another.data.csrf_token});assert.equal(foreign.status,409);
 const replay=await request('/me/google/unlink',body,unlinkHeaders);
 const newer=(await pool.query('SELECT revoked_at FROM member_login_identities WHERE identity_id=$1',[second])).rows[0];
 assert.deepEqual({status:replay.status,newerRevoked:newer.revoked_at!==null},{status:409,newerRevoked:false},'stale unlink intent must reject rather than revoke a newer Google identity');
 assert.equal((await pool.query('SELECT 1 FROM google_login_states WHERE state_hash=$1',[stateHash])).rowCount,1);
 assert.equal((await pool.query('SELECT 1 FROM google_login_challenges WHERE challenge_hash=$1',[challengeHash])).rowCount,1);
 assert.equal((await pool.query('SELECT 1 FROM google_login_activations WHERE activation_hash=$1',[tokenHash(dormant.data.activation)])).rowCount,1);
});
