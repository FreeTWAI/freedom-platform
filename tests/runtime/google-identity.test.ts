import assert from 'node:assert/strict';
import {after,before,test} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_USERS,DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {activateGoogleLogin,startGoogleLogin,completeGoogleLogin,cancelGoogleLogin,finishGoogleTotp,unlinkGoogleIdentity as unlinkGoogleGeneration,invalidateGoogleBrowser,type GoogleLoginOptions} from '../../modules/identity-membership/google/service.js';
import {login,tokenHash,verifyMemberPassword} from '../../modules/identity-membership/service.js';
import {confirmPasswordReset,requestPasswordReset} from '../../modules/identity-membership/password-recovery.js';
import {changePassword,revokeOtherSessions} from '../../modules/identity-membership/account-security.js';
import {enableTotp,disableTotp,totpCode} from '../../modules/identity-membership/totp.js';
import {requestEmailChange,confirmEmailChange} from '../../modules/identity-membership/email-change.js';
import {pruneExpiredAuthRecords} from '../../modules/identity-membership/auth-pruning.js';
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString||!/^\/fp_[a-z0-9_]+$/.test(new URL(connectionString).pathname))throw Error('Explicit isolated fp_* TEST_DATABASE_URL required');
const schema=`fp_google_${process.pid}_${Date.now()}`,admin=new Pool({connectionString}),pool=new Pool({connectionString,options:`-c search_path=${schema} -c statement_timeout=10000`});
const origin='http://127.0.0.1:4310',keys=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'fixture-key',alg:'RS256',use:'sig'};
const codes=new Map<string,string>();let tokenCalls=0;
const transport:typeof fetch=async(url,init)=>{
 if(String(url)==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
 assert.equal(String(url),'https://oauth2.googleapis.com/token');tokenCalls++;
 const code=new URLSearchParams(String(init?.body)).get('code')!;const token=codes.get(code);codes.delete(code);
 return token?Response.json({id_token:token}):Response.json({error:'invalid_grant'},{status:400});
};
const options:GoogleLoginOptions={enabled:true,clientId:'fixture-client',clientSecret:'fixture-only-secret',transport};
let communityId:string;
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);await seedLocal(pool);communityId=(await pool.query('SELECT community_id FROM users WHERE email=$1',[DEMO_USERS[0].email])).rows[0].community_id;});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
const registration=()=>({communityId,allowSingleCommunity:false,network:randomUUID()});
async function flow(subject=randomUUID(),email=`${randomUUID()}@gmail.com`,extra:Record<string,unknown>={},actor?:Awaited<ReturnType<typeof login>>['actor']){
 const start=await startGoogleLogin(pool,options,origin,undefined,actor,actor?DEMO_PASSWORD:undefined),url=new URL(start.url),state=url.searchParams.get('state')!,nonce=url.searchParams.get('nonce')!;
 const code=randomUUID(),now=Math.floor(Date.now()/1000);
 const token=await new SignJWT({email,email_verified:true,nonce,...extra}).setProtectedHeader({alg:'RS256',kid:'fixture-key'}).setIssuer('https://accounts.google.com').setAudience(options.clientId).setSubject(subject).setIssuedAt(now).setExpirationTime(now+300).sign(keys.privateKey);codes.set(code,token);
 return {state,code,verifier:start.verifier};
}
const complete=async(f:Awaited<ReturnType<typeof flow>>,actor?:Awaited<ReturnType<typeof login>>['actor'])=>{
 const result=await completeGoogleLogin(pool,options,origin,f,registration(),actor);
 if('activation_required' in result&&result.activation_required){const active=await activateGoogleLogin(pool,options,{activation:result.activation,verifier:f.verifier,rawSession:result.token});return {...active,token:result.token};}
 return result;
};
async function unlinkGoogleIdentity(pool:Pool,actor:Awaited<ReturnType<typeof login>>['actor'],password:string){const row=(await pool.query('SELECT identity_id FROM member_login_identities WHERE user_id=$1 AND revoked_at IS NULL',[actor.user_id])).rows[0];return unlinkGoogleGeneration(pool,actor,password,row.identity_id);}
function session(result:Awaited<ReturnType<typeof complete>>){assert.ok('actor' in result);return result;}

test('authoritative Google creates private onboarding account with no invented password and stable subject',async()=>{
 const subject=randomUUID(),email=`${randomUUID()}@gmail.com`,f=await flow(subject,email),first=session(await complete(f));assert.equal(first.registered,true);
 const user=(await pool.query('SELECT * FROM users WHERE user_id=$1',[first.actor.user_id])).rows[0];assert.equal(user.password_hash,null);assert.ok(user.email_verified_at);assert.equal(user.onboarding_required,true);assert.match(user.display_name,/^新夥伴 [0-9a-f]{8}$/);
 const account=(await pool.query('SELECT contacts FROM member_accounts WHERE user_id=$1',[user.user_id])).rows[0];assert.deepEqual(account.contacts.email.audiences,[]);
 assert.ok((await pool.query('SELECT 1 FROM guild_preference_sets WHERE user_id=$1',[user.user_id])).rowCount);
 const second=session(await complete(await flow(subject,'changed@external.test',{email_verified:false})));
 assert.equal(second.actor.user_id,user.user_id);assert.equal(second.actor.email,email);
 const q=await pool.connect();try{assert.equal(await verifyMemberPassword(q,user.user_id,'anything'),false);}finally{q.release();}
 await assert.rejects(login(pool,email,'anything'),{code:'invalid_credentials'});
});
test('external email signup and existing email never auto merge; explicit real-password linking permits external email',async()=>{
 const before=(await pool.query('SELECT count(*)::int n FROM users')).rows[0].n;
 await assert.rejects(complete(await flow(randomUUID(),'external@example.test')),{code:'google_link_existing_account'});
 await assert.rejects(complete(await flow(randomUUID(),DEMO_USERS[0].email,{hd:'workspace.example'})),{code:'account_unavailable'});
 assert.equal((await pool.query('SELECT count(*)::int n FROM users')).rows[0].n,before);
 const existing=await login(pool,DEMO_USERS[0].email,DEMO_PASSWORD),subject=randomUUID();
 await assert.rejects(startGoogleLogin(pool,options,origin,existing.token,existing.actor,'bad'),{code:'password_verification_failed'});
 assert.deepEqual(await complete(await flow(subject,'external@example.test',{},existing.actor),existing.actor),{linked:true});
 const result=session(await complete(await flow(subject,'another@example.test',{email_verified:false})));
 assert.equal(result.actor.user_id,existing.actor.user_id);assert.equal(result.actor.email,DEMO_USERS[0].email);
 await unlinkGoogleIdentity(pool,existing.actor,DEMO_PASSWORD);
});
test('browser/session binding, one use, cancellation and deadline prevent provider exchange',async()=>{
 const f=await flow(),calls=tokenCalls;
 await assert.rejects(complete({...f,verifier:randomBytes(32).toString('base64url')}),{code:'google_flow_expired'});
 await assert.rejects(completeGoogleLogin(pool,options,origin,{...f,rawSession:randomBytes(32).toString('base64url')},registration()),{code:'google_flow_expired'});
 assert.equal(tokenCalls,calls);await cancelGoogleLogin(pool,f.state,f.verifier,undefined);await assert.rejects(complete(f),{code:'google_flow_expired'});
 const expired=await flow();await pool.query("UPDATE google_login_states SET expires_at=clock_timestamp()-interval '1 second' WHERE state_hash=$1",[tokenHash(expired.state)]);await assert.rejects(complete(expired),{code:'google_flow_expired'});
 const once=await flow();session(await complete(once));await assert.rejects(complete(once),{code:'google_flow_expired'});
 const active=await login(pool,DEMO_USERS[1].email,DEMO_PASSWORD);await assert.rejects(startGoogleLogin(pool,options,origin,active.token),{code:'google_session_changed'});
});
test('parallel callbacks create one identity/account; other result cannot create an orphan',async()=>{
 const subject=randomUUID(),email=`${randomUUID()}@gmail.com`,a=await flow(subject,email),b=await flow(subject,email);
 const results=await Promise.allSettled([complete(a),complete(b)]);assert.ok(results.some(r=>r.status==='fulfilled'));
 assert.equal((await pool.query('SELECT count(*)::int n FROM users WHERE email=$1',[email])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM member_login_identities WHERE subject=$1',[subject])).rows[0].n,1);
});
test('cancel or existing-login invalidation during network exchange rolls back registration',async()=>{
 for(const cancel of [true,false]){
 const email=`${randomUUID()}@gmail.com`,f=await flow(randomUUID(),email);let release!:()=>void,entered!:()=>void;
 const waiting=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const slow={...options,transport:async(...args:Parameters<typeof fetch>)=>{if(String(args[0]).includes('/token')){entered();await gate;}return transport(...args);}};
 const completion=completeGoogleLogin(pool,slow,origin,f,registration());await waiting;
 if(cancel)await cancelGoogleLogin(pool,f.state,f.verifier,undefined);else await invalidateGoogleBrowser(pool,f.verifier);
 release();await assert.rejects(completion,{code:'google_flow_expired'});assert.equal((await pool.query('SELECT 1 FROM users WHERE email=$1',[email])).rowCount,0);
 }
});
test('NULL-safe recovery remains available with Google OFF and revokes sessions without removing stable identity',async()=>{
 const email=`${randomUUID()}@gmail.com`,first=session(await complete(await flow(randomUUID(),email)));let url='';
 await assert.rejects(unlinkGoogleIdentity(pool,first.actor,'anything'),{code:'password_verification_failed'});
 await requestPasswordReset(pool,email,origin,async(_to,value)=>{url=value;});assert.ok(url);
 const raw=url.split('/').at(-1)!,password='a-real-password-for-recovery';
 const recovered=await confirmPasswordReset(pool,raw,password);assert.ok('actor' in recovered);
 assert.equal((await pool.query('SELECT revoked_at IS NOT NULL AS revoked FROM sessions WHERE token_hash=$1',[first.actor.session_hash])).rows[0].revoked,true);
 assert.ok((await pool.query('SELECT 1 FROM member_login_identities WHERE user_id=$1',[first.actor.user_id])).rowCount);
 await assert.rejects(startGoogleLogin(pool,{...options,enabled:false},origin,undefined),{code:'google_unavailable'});
 const passwordSession=await login(pool,email,password);assert.equal(passwordSession.actor.user_id,first.actor.user_id);
 await unlinkGoogleIdentity(pool,passwordSession.actor,password);assert.equal((await pool.query('SELECT 1 FROM member_login_identities WHERE user_id=$1 AND revoked_at IS NULL',[first.actor.user_id])).rowCount,0);
});
test('deactivated identity cannot sign in; expired records prune in bounded batches',async()=>{
 const subject=randomUUID(),first=session(await complete(await flow(subject)));await pool.query('UPDATE users SET active=false WHERE user_id=$1',[first.actor.user_id]);
 await assert.rejects(complete(await flow(subject)),{code:'google_account_unavailable'});
 for(let i=0;i<3;i++)await flow();await pool.query("UPDATE google_login_states SET expires_at=clock_timestamp()-interval '1 minute'");
 const before=(await pool.query('SELECT count(*)::int n FROM google_login_states')).rows[0].n;await pruneExpiredAuthRecords(pool,{batch:1});assert.equal((await pool.query('SELECT count(*)::int n FROM google_login_states')).rows[0].n,before-1);
});

test('platform TOTP precedes Google sessions; backup codes, persistent failures, cancellation and recovery fences',async()=>{
 const member=await login(pool,DEMO_USERS[2].email,DEMO_PASSWORD),subject=randomUUID();
 await complete(await flow(subject,'mfa@external.test',{},member.actor),member.actor);
 const key=Buffer.alloc(32,0x74).toString('base64'),secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
 const counter=Number((await pool.query('SELECT floor(extract(epoch FROM clock_timestamp())/30)::bigint n')).rows[0].n);
 const enrollment=await enableTotp(pool,{actor:member.actor,operation:'enable_totp',key:randomUUID(),body:{password:DEMO_PASSWORD,secret,code:totpCode(secret,counter)}},key);
 assert.ok(enrollment.backup_codes?.length);
 const count=async()=>(await pool.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1',[member.actor.user_id])).rows[0].n;
 const before=await count(),f=await flow(subject),challenge=await complete(f);assert.ok('challenge' in challenge&&challenge.challenge);assert.equal(await count(),before);
 await assert.rejects(finishGoogleTotp(pool,options,{challenge:challenge.challenge,verifier:f.verifier,code:'wrong'},key),{code:'invalid_totp'});
 assert.equal((await pool.query('SELECT failures FROM member_totp WHERE user_id=$1',[member.actor.user_id])).rows[0].failures,1);
 const provisional=await finishGoogleTotp(pool,options,{challenge:challenge.challenge,verifier:f.verifier,code:enrollment.backup_codes[0]},key);
 const done=await activateGoogleLogin(pool,options,{activation:provisional.activation,verifier:f.verifier,rawSession:provisional.token});assert.equal(done.actor.user_id,member.actor.user_id);assert.equal(await count(),before+1);
 await assert.rejects(finishGoogleTotp(pool,options,{challenge:challenge.challenge,verifier:f.verifier,code:enrollment.backup_codes[1]},key),{code:'google_flow_expired'});
 const cancelledFlow=await flow(subject),cancelled=await complete(cancelledFlow);assert.ok('challenge' in cancelled&&cancelled.challenge);await cancelGoogleLogin(pool,cancelledFlow.state,cancelledFlow.verifier,undefined);
 await assert.rejects(finishGoogleTotp(pool,options,{challenge:cancelled.challenge,verifier:cancelledFlow.verifier,code:enrollment.backup_codes[1]},key),{code:'google_flow_expired'});
 const blockedFlow=await flow(subject),blocked=await complete(blockedFlow);assert.ok('challenge' in blocked&&blocked.challenge);await pool.query('UPDATE member_totp SET failures=10 WHERE user_id=$1',[member.actor.user_id]);
 await assert.rejects(finishGoogleTotp(pool,options,{challenge:blocked.challenge,verifier:blockedFlow.verifier,code:enrollment.backup_codes[1]},key),{code:'totp_rate_limited'});
 let recovery='';await requestPasswordReset(pool,member.actor.email,origin,async(_to,url)=>{recovery=url;});const reset=await confirmPasswordReset(pool,recovery.split('/').at(-1)!,'real-new-password-mfa');assert.ok('totp_required' in reset);
 await assert.rejects(finishGoogleTotp(pool,options,{challenge:blocked.challenge,verifier:blockedFlow.verifier,code:enrollment.backup_codes[1]},key),{code:'google_flow_expired'});
 await assert.rejects(login(pool,member.actor.email,'real-new-password-mfa'),{code:'totp_required'});
});
test('pending link rejects session revocation and password recovery; unlink blocks stale Google callbacks',async()=>{
 const member=await login(pool,DEMO_USERS[1].email,DEMO_PASSWORD),subject=randomUUID(),googleEmail=`${randomUUID()}@gmail.com`;
 const pending=await flow(subject,googleEmail,{},member.actor);
 await pool.query('UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1',[member.actor.session_hash]);
 await assert.rejects(complete(pending,member.actor),{code:'session_expired'});
 const current=await login(pool,DEMO_USERS[1].email,DEMO_PASSWORD);
 await complete(await flow(subject,googleEmail,{},current.actor),current.actor);
 const loginFlow=await flow(subject,googleEmail);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
 const slow={...options,transport:async(...args:Parameters<typeof fetch>)=>{if(String(args[0]).includes('/token')){entered();await gate;}return transport(...args);}};
 const completion=completeGoogleLogin(pool,slow,origin,loginFlow,registration());await waiting;await unlinkGoogleIdentity(pool,current.actor,DEMO_PASSWORD);release();
 await assert.rejects(completion,{code:'google_account_unavailable'});assert.equal((await pool.query('SELECT 1 FROM member_login_identities WHERE subject=$1 AND revoked_at IS NULL',[subject])).rowCount,0);
});
test('email change keeps Google identity stable and removes stale mailbox reset proof',async()=>{
 const subject=randomUUID(),email=`${randomUUID()}@gmail.com`,first=session(await complete(await flow(subject,email)));let reset='';
 await requestPasswordReset(pool,email,origin,async(_to,url)=>{reset=url;});const password='real-password-before-email-change';const recovered=await confirmPasswordReset(pool,reset.split('/').at(-1)!,password);assert.ok('actor' in recovered);
 let mail='';const newEmail=`${randomUUID()}@example.test`;
 await requestEmailChange(pool,recovered.actor,{email:newEmail,password},origin,async(_to,_subject,body)=>{mail=body;});
 const token=/#change-email\/([A-Za-z0-9_-]{43})/.exec(mail)![1];
 await requestPasswordReset(pool,email,origin,async(_to,url)=>{reset=url;});await confirmEmailChange(pool,token,async()=>{});
 await assert.rejects(confirmPasswordReset(pool,reset.split('/').at(-1)!,'another-real-password'),{code:'reset_link_invalid'});
 const next=session(await complete(await flow(subject,email)));assert.equal(next.actor.user_id,first.actor.user_id);assert.equal(next.actor.email,newEmail);
});
test('expiry after provider wait rolls back account and session effects',async()=>{
 const email=`${randomUUID()}@gmail.com`,f=await flow(randomUUID(),email);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
 const slow={...options,transport:async(...args:Parameters<typeof fetch>)=>{if(String(args[0]).includes('/token')){entered();await gate;}return transport(...args);}};
 const completion=completeGoogleLogin(pool,slow,origin,f,registration());await waiting;
 // The retained proof is independently revocable and its current DB deadline is authoritative.
 await pool.query("UPDATE google_login_states SET expires_at=clock_timestamp()-interval '1 second' WHERE state_hash=$1",[tokenHash(f.state)]);release();
 await assert.rejects(completion,{code:'google_flow_expired'});assert.equal((await pool.query('SELECT 1 FROM users WHERE email=$1',[email])).rowCount,0);
});

test('unlink then explicit relink cannot admit an older callback into replacement identity generation',async()=>{
 const member=await login(pool,DEMO_USERS[1].email,DEMO_PASSWORD),subject=randomUUID(),email=`${randomUUID()}@gmail.com`;
 await complete(await flow(subject,email,{},member.actor),member.actor);
 const older=await flow(subject,email);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
 const slow={...options,transport:async(...args:Parameters<typeof fetch>)=>{if(String(args[0]).includes('/token')){entered();await gate;}return transport(...args);}};
 const completion=completeGoogleLogin(pool,slow,origin,older,registration());await waiting;
 await unlinkGoogleIdentity(pool,member.actor,DEMO_PASSWORD);await complete(await flow(subject,email,{},member.actor),member.actor);release();
 await assert.rejects(completion,{code:'google_account_unavailable'});
 assert.equal(session(await complete(await flow(subject,email))).actor.user_id,member.actor.user_id);
});
test('link session expiry while final state lock waits rejects and rolls back mapping',async()=>{
 const member=await login(pool,DEMO_USERS[0].email,DEMO_PASSWORD),subject=randomUUID(),f=await flow(subject,'final-lock@example.test',{},member.actor);
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r);
 const slow={...options,transport:async(...args:Parameters<typeof fetch>)=>{if(String(args[0]).includes('/token')){entered();await gate;}return transport(...args);}};
 const completion=completeGoogleLogin(pool,slow,origin,f,registration(),member.actor);await waiting;
 const blocker=await pool.connect();try{
 await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM google_login_states WHERE state_hash=$1 FOR UPDATE',[tokenHash(f.state)]);
 await pool.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE token_hash=$1",[member.actor.session_hash]);release();
 await blocker.query('SELECT pg_sleep(0.4)');await blocker.query('COMMIT');
 await assert.rejects(completion,{code:'session_expired'});
 assert.equal((await pool.query('SELECT 1 FROM member_login_identities WHERE subject=$1 AND revoked_at IS NULL',[subject])).rowCount,0);
 }finally{await blocker.query('ROLLBACK');blocker.release();}
});


test('dormant ACK cannot survive credential rotation, revoke-other-sessions, unlink or deactivation',async()=>{
 for(const action of ['password','sessions','unlink','deactivate'] as const){
  const subject=randomUUID(),email=`${randomUUID()}@gmail.com`,first=session(await complete(await flow(subject,email)));
  let recovery='';await requestPasswordReset(pool,email,origin,async(_to,url)=>{recovery=url;});
  const password='real-password-before-activation',member=await confirmPasswordReset(pool,recovery.split('/').at(-1)!,password);assert.ok('actor' in member);
  const f=await flow(subject,email),pending=await completeGoogleLogin(pool,options,origin,f,registration());assert.ok('activation_required' in pending&&pending.activation_required);
  if(action==='password')await changePassword(pool,member.actor,{current_password:password,new_password:'another-real-password-activation'});
  else if(action==='sessions')await revokeOtherSessions(pool,{actor:member.actor,operation:'revoke_other_sessions',key:randomUUID(),body:{}});
  else if(action==='unlink')await unlinkGoogleIdentity(pool,member.actor,password);
  else await pool.query('UPDATE users SET active=false WHERE user_id=$1',[first.actor.user_id]);
  await assert.rejects(activateGoogleLogin(pool,options,{activation:pending.activation,verifier:f.verifier,rawSession:pending.token}),{code:'google_flow_expired'});
  const row=(await pool.query('SELECT created_at,last_seen_at,expires_at<=clock_timestamp() expired FROM sessions WHERE token_hash=$1',[tokenHash(pending.token)])).rows[0];
  if(row){assert.equal(row.created_at,null);assert.equal(row.last_seen_at,null);assert.equal(row.expired,true);}
 }
});

test('ACK deadline after session lock wait rolls back activation; pruning skips locked dormant session',async()=>{
 const f=await flow(),pending=await completeGoogleLogin(pool,options,origin,f,registration());assert.ok('activation_required' in pending&&pending.activation_required);
 const hash=tokenHash(pending.token),blocker=await pool.connect();
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM sessions WHERE token_hash=$1 FOR UPDATE',[hash]);
  await pool.query("UPDATE google_login_activations SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE session_hash=$1",[hash]);
  const activation=activateGoogleLogin(pool,options,{activation:pending.activation,verifier:f.verifier,rawSession:pending.token});
  // Attach rejection immediately, before waiting on the deliberately held lock.
  const rejected=assert.rejects(activation,{code:'google_flow_expired'});
  await blocker.query('SELECT pg_sleep(0.4)');await pruneExpiredAuthRecords(pool,{batch:10});
  assert.equal((await blocker.query('SELECT created_at FROM sessions WHERE token_hash=$1',[hash])).rows[0].created_at,null);
  await blocker.query('COMMIT');await rejected;
  assert.equal((await pool.query('SELECT created_at FROM sessions WHERE token_hash=$1',[hash])).rows[0].created_at,null);
  await pruneExpiredAuthRecords(pool,{batch:10});assert.equal((await pool.query('SELECT 1 FROM sessions WHERE token_hash=$1',[hash])).rowCount,0);
 }finally{await blocker.query('ROLLBACK');blocker.release();}
});


test('MFA enrollment and disable plus confirmed email change revoke dormant ACK authority',async()=>{
 const subject=randomUUID(),email=`${randomUUID()}@gmail.com`;session(await complete(await flow(subject,email)));
 let recovery='';await requestPasswordReset(pool,email,origin,async(_to,url)=>{recovery=url;});const password='real-password-before-mfa';
 const member=await confirmPasswordReset(pool,recovery.split('/').at(-1)!,password);assert.ok('actor' in member);
 const f=await flow(subject,email),pending=await completeGoogleLogin(pool,options,origin,f,registration());assert.ok('activation_required' in pending&&pending.activation_required);
 const key=Buffer.alloc(32,0x75).toString('base64'),secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
 const counter=Number((await pool.query('SELECT floor(extract(epoch FROM clock_timestamp())/30)::bigint n')).rows[0].n);
 const enabled=await enableTotp(pool,{actor:member.actor,operation:'enable_totp',key:randomUUID(),body:{password,secret,code:totpCode(secret,counter)}},key);assert.ok(enabled.backup_codes);
 await assert.rejects(activateGoogleLogin(pool,options,{activation:pending.activation,verifier:f.verifier,rawSession:pending.token}),{code:'google_flow_expired'});
 const mfaFlow=await flow(subject,email),challenge=await complete(mfaFlow);assert.ok('challenge' in challenge&&challenge.challenge);
 const mfa=await finishGoogleTotp(pool,options,{challenge:challenge.challenge,verifier:mfaFlow.verifier,code:enabled.backup_codes[0]},key);
 await disableTotp(pool,{actor:member.actor,operation:'disable_totp',key:randomUUID(),body:{password,code:enabled.backup_codes[1]}},key);
 await assert.rejects(activateGoogleLogin(pool,options,{activation:mfa.activation,verifier:mfaFlow.verifier,rawSession:mfa.token}),{code:'google_flow_expired'});
 const emailFlow=await flow(subject,email),emailPending=await completeGoogleLogin(pool,options,origin,emailFlow,registration());assert.ok('activation_required' in emailPending&&emailPending.activation_required);
 let mail='';await requestEmailChange(pool,member.actor,{email:`${randomUUID()}@example.test`,password},origin,async(_to,_subject,body)=>{mail=body;});
 await confirmEmailChange(pool,/#change-email\/([A-Za-z0-9_-]{43})/.exec(mail)![1],async()=>{});
 await assert.rejects(activateGoogleLogin(pool,options,{activation:emailPending.activation,verifier:emailFlow.verifier,rawSession:emailPending.token}),{code:'google_flow_expired'});
});
