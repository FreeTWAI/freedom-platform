import {randomBytes} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '../../../packages/db/index.js';
import {assertCurrentSessionClock,lockMemberSession,readWithMemberSession} from '../../../packages/db/member-session.js';
import {Problem,requireCondition} from '../../../packages/shared/problem.js';
import {SESSION_LIFETIME_SECONDS,tokenHash,verifyMemberPassword,type Actor} from '../service.js';
import {authRateLimit,createRegisteredMember,emptyContacts} from '../members.js';
import {consumeTotp,lockTotp} from '../totp.js';
import {authorizationUrl,exchangeGoogleCode,type GoogleOidcConfig,type GoogleIdentity} from './oidc.js';

export type GoogleLoginOptions=GoogleOidcConfig & {enabled:boolean;transport?:typeof fetch};
type State={state_hash:string;browser_hash:string;nonce:string;intent:'login'|'link';original_session_hash:string|null;user_id:string|null;community_id:string|null;credential_hash:string|null;expires_at:Date;claimed_at:Date|null};
type Registration={communityId?:string;allowSingleCommunity:boolean;network?:string};
const opaque=()=>randomBytes(32).toString('base64url');
const hashCookie=(raw:string|undefined)=>raw?tokenHash(raw):null;
const credential=(saved:string|null)=>saved?tokenHash(saved):null;
const invalid=()=>new Problem(409,'google_flow_expired','這次 Google 登入已失效，請回到原頁重新開始。');
const checkOpaque=(raw:string)=>requireCondition(/^[A-Za-z0-9_-]{43}$/.test(raw),422,'google_flow_invalid','Google 登入資料不完整，請重新開始。');
export function googleAvailable(options:GoogleLoginOptions|undefined,mailboxRecovery:boolean){return Boolean(options?.enabled===true&&options.clientId&&options.clientSecret&&mailboxRecovery);}
function enabled(options:GoogleLoginOptions|undefined):asserts options is GoogleLoginOptions {requireCondition(options?.enabled===true&&options.clientId&&options.clientSecret,503,'google_unavailable','Google 登入目前未開放，請使用原本的登入方式。');}
async function noActiveSession(q:PoolClient,raw:string|undefined){
  if(!raw)return;
  const active=await q.query('SELECT 1 FROM sessions s JOIN users u USING(user_id) WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.active',[tokenHash(raw)]);
  requireCondition(!active.rowCount,409,'google_session_changed','已有登入中的帳號；如需切換，請先登出再重新開始。');
}
export async function startGoogleLogin(pool:Pool,options:GoogleLoginOptions|undefined,origin:string,rawSession:string|undefined,actor?:Actor,password?:string){
  enabled(options);
  const state=opaque(),verifier=opaque(),nonce=opaque();
  await transaction(pool,async q=>{
    let proof:string|null=null;
    if(actor){
      await lockMemberSession(q,actor,true);
      requireCondition(await verifyMemberPassword(q,actor.user_id,password??''),403,'password_verification_failed','請先設定並輸入目前的密碼。');
      proof=credential((await q.query('SELECT password_hash FROM users WHERE user_id=$1',[actor.user_id])).rows[0].password_hash);
    }else await noActiveSession(q,rawSession);
    await q.query(`INSERT INTO google_login_states(state_hash,browser_hash,nonce,intent,original_session_hash,user_id,community_id,credential_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[tokenHash(state),tokenHash(verifier),nonce,actor?'link':'login',actor?.session_hash??hashCookie(rawSession),actor?.user_id??null,actor?.community_id??null,proof]);
    if(actor)await assertCurrentSessionClock(q,actor);
  });
  return {verifier,url:authorizationUrl(options,`${origin}/google/callback`,{state,nonce,verifier})};
}
async function consumeState(pool:Pool,state:string,verifier:string,rawSession:string|undefined,actor?:Actor){
  checkOpaque(state);checkOpaque(verifier);
  return transaction(pool,async q=>{
    if(actor)await lockMemberSession(q,actor,true);else await noActiveSession(q,rawSession);
    const row=(await q.query<State>('SELECT * FROM google_login_states WHERE state_hash=$1 FOR UPDATE',[tokenHash(state)])).rows[0];
    if(!row||row.claimed_at||row.browser_hash!==tokenHash(verifier)||row.original_session_hash!==(actor?.session_hash??hashCookie(rawSession))||row.intent!==(actor?'link':'login')||actor&&(row.user_id!==actor.user_id||row.community_id!==actor.community_id))throw invalid();
    // Separate statement after row-lock acquisition: expiry uses decision time.
    const consumed=await q.query('UPDATE google_login_states SET claimed_at=clock_timestamp() WHERE state_hash=$1 AND claimed_at IS NULL AND expires_at>clock_timestamp() RETURNING state_hash',[row.state_hash]);
    if(!consumed.rowCount)throw invalid();
    if(actor)await assertCurrentSessionClock(q,actor);
    return row;
  });
}
export async function cancelGoogleLogin(pool:Pool,state:string,verifier:string,rawSession:string|undefined,actor?:Actor){
  checkOpaque(state);checkOpaque(verifier);
  await transaction(pool,async q=>{
    if(actor)await lockMemberSession(q,actor,true);
    const values=[tokenHash(state),tokenHash(verifier),actor?.session_hash??hashCookie(rawSession)];
    await q.query('DELETE FROM google_login_states WHERE state_hash=$1 AND browser_hash=$2 AND original_session_hash IS NOT DISTINCT FROM $3',values);
    await q.query('DELETE FROM google_login_challenges WHERE origin_state_hash=$1 AND browser_hash=$2 AND original_session_hash IS NOT DISTINCT FROM $3',values);
    await q.query('UPDATE google_login_activations SET revoked_at=clock_timestamp() WHERE origin_state_hash=$1 AND browser_hash=$2',[values[0],values[1]]);
    if(actor)await assertCurrentSessionClock(q,actor);
  });return {cancelled:true};
}
/** Existing login/reset/logout cancel this browser's in-flight Google operations. */
export async function invalidateGoogleBrowser(pool:Pool,verifier:string|undefined){if(!verifier||!(/^[A-Za-z0-9_-]{43}$/).test(verifier))return;await pool.query('DELETE FROM google_login_states WHERE browser_hash=$1',[tokenHash(verifier)]);await pool.query('DELETE FROM google_login_challenges WHERE browser_hash=$1',[tokenHash(verifier)]);await pool.query('UPDATE google_login_activations SET revoked_at=clock_timestamp() WHERE browser_hash=$1',[tokenHash(verifier)]);}
async function finishState(q:PoolClient,state:State){
  const live=await q.query('SELECT expires_at FROM google_login_states WHERE state_hash=$1 AND claimed_at IS NOT NULL FOR UPDATE',[state.state_hash]);if(!live.rowCount)throw invalid();
  await assertDeadline(q,live.rows[0].expires_at);await q.query('DELETE FROM google_login_states WHERE state_hash=$1',[state.state_hash]);
}
async function assertDeadline(q:PoolClient,expiresAt:Date){if(!(await q.query('SELECT $1::timestamptz>clock_timestamp() AS valid',[expiresAt])).rows[0].valid)throw invalid();}
async function currentLinkedUser(q:PoolClient,identity:GoogleIdentity,stateHash:string){
  const candidate=(await q.query('SELECT user_id,identity_id FROM member_login_identities WHERE provider=\'google\' AND subject=$1',[identity.subject])).rows[0];
  if(!candidate)return null;
  // All authenticated mutations use user -> identity ordering, never the reverse.
  const user=(await q.query('SELECT * FROM users WHERE user_id=$1 FOR UPDATE',[candidate.user_id])).rows[0];
  const linked=(await q.query('SELECT identity_id FROM member_login_identities WHERE identity_id=$1 AND user_id=$2 AND revoked_at IS NULL AND created_at <= (SELECT created_at FROM google_login_states WHERE state_hash=$3) FOR UPDATE',[candidate.identity_id,candidate.user_id,stateHash])).rows[0];
  requireCondition(user?.active&&linked,409,'google_account_unavailable','這個 Google 連結目前不可使用，請使用帳號復原。');
  return {user,identityId:linked.identity_id as string};
}
export async function completeGoogleLogin(pool:Pool,options:GoogleLoginOptions|undefined,origin:string,input:{state:string;code:string;verifier:string;rawSession?:string},registration:Registration,actor?:Actor){
  enabled(options);
  requireCondition(input.code.length>0&&input.code.length<=4096,422,'google_flow_invalid','Google 登入資料不完整。');
  const state=await consumeState(pool,input.state,input.verifier,input.rawSession,actor);
  // One-use claim is committed BEFORE provider I/O. An uncertain exchange is not retried.
  let identity:GoogleIdentity;
  try{identity=await exchangeGoogleCode(options,`${origin}/google/callback`,input.code,input.verifier,state.nonce,options.transport);}catch{throw new Problem(401,'google_verification_failed','Google 驗證未完成，請重新開始。');}
  if(!actor&&!(await pool.query("SELECT 1 FROM member_login_identities WHERE provider='google' AND subject=$1",[identity.subject])).rowCount){
    await authRateLimit(pool,'registration-network',registration.network??'shared-server',8);
    await authRateLimit(pool,'registration-global','global',100,60);
    await authRateLimit(pool,'registration-email',identity.email,3);
  }
  try{return await transaction(pool,async q=>{
    if(actor){
      await lockMemberSession(q,actor,true);
      const user=(await q.query('SELECT password_hash FROM users WHERE user_id=$1',[actor.user_id])).rows[0];
      if(credential(user.password_hash)!==state.credential_hash)throw invalid();
      const existing=(await q.query('SELECT user_id,subject FROM member_login_identities WHERE provider=\'google\' AND revoked_at IS NULL AND (subject=$1 OR user_id=$2)',[identity.subject,actor.user_id])).rows;
      requireCondition(existing.every(row=>row.user_id===actor.user_id&&row.subject===identity.subject),409,'google_link_conflict','這個 Google 帳號或目前帳號已有其他連結；不會合併帳號。');
      if(!existing.length){
        await q.query('DELETE FROM member_login_identities WHERE provider=\'google\' AND subject=$1 AND revoked_at IS NOT NULL',[identity.subject]);
        await q.query('INSERT INTO member_login_identities(provider,subject,user_id,community_id) VALUES(\'google\',$1,$2,$3)',[identity.subject,actor.user_id,actor.community_id]);
      }
      await finishState(q,state);await assertCurrentSessionClock(q,actor);
      return {linked:true as const};
    }
    await noActiveSession(q,input.rawSession);
    let linked=await currentLinkedUser(q,identity,state.state_hash),registered=false;
    if(!linked){
      requireCondition(identity.authoritativeEmail,409,'google_link_existing_account','此 Google 信箱暫不支援直接註冊。請先以電子郵件建立或登入工坊帳號，再於帳號設定連結 Google。');
      const user=await createRegisteredMember(q,{email:identity.email,passwordHash:null,nickname:`新夥伴 ${randomBytes(4).toString('hex')}`,contacts:emptyContacts()},registration);
      await q.query('UPDATE users SET email_verified_at=clock_timestamp() WHERE user_id=$1',[user.user_id]);
      const saved=(await q.query('INSERT INTO member_login_identities(provider,subject,user_id,community_id) VALUES(\'google\',$1,$2,$3) RETURNING identity_id',[identity.subject,user.user_id,user.community_id])).rows[0];
      linked={user,identityId:saved.identity_id};registered=true;
    }
    const mfa=(await q.query('SELECT enabled FROM member_totp WHERE user_id=$1',[linked.user.user_id])).rows[0];
    if(mfa?.enabled){
      const challenge=opaque();
      await q.query('INSERT INTO google_login_challenges(challenge_hash,identity_id,user_id,browser_hash,original_session_hash,credential_hash,origin_state_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[tokenHash(challenge),linked.identityId,linked.user.user_id,tokenHash(input.verifier),hashCookie(input.rawSession),credential(linked.user.password_hash),state.state_hash]);
      await finishState(q,state);return {totp_required:true as const,challenge};
    }
    const session=await provisionalSession(q,linked.user,linked.identityId,input.verifier,state.state_hash,registered);await finishState(q,state);return session;
  });}catch(error){if((error as {code?:string}).code==='23505')throw new Problem(409,'google_link_conflict','登入資料已被其他帳號使用，請使用原本的登入方式後再連結；不會合併帳號。');throw error;}
}
export async function finishGoogleTotp(pool:Pool,options:GoogleLoginOptions|undefined,input:{challenge:string;verifier:string;code:string;rawSession?:string},encryptionKey?:string){
  enabled(options);checkOpaque(input.challenge);checkOpaque(input.verifier);
  const result=await transaction(pool,async q=>{
    await noActiveSession(q,input.rawSession);
    const candidate=(await q.query('SELECT user_id FROM google_login_challenges WHERE challenge_hash=$1',[tokenHash(input.challenge)])).rows[0];
    if(!candidate)throw invalid();
    const user=(await q.query('SELECT * FROM users WHERE user_id=$1 AND active FOR UPDATE',[candidate.user_id])).rows[0];
    const row=(await q.query('SELECT * FROM google_login_challenges WHERE challenge_hash=$1 FOR UPDATE',[tokenHash(input.challenge)])).rows[0];
    if(!user||!row||row.browser_hash!==tokenHash(input.verifier)||row.original_session_hash!==hashCookie(input.rawSession)||row.credential_hash!==credential(user.password_hash))throw invalid();
    const linked=await q.query('SELECT 1 FROM member_login_identities WHERE identity_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR SHARE',[row.identity_id,user.user_id]);
    if(!linked.rowCount)throw invalid();
    await assertDeadline(q,row.expires_at);
    const factor=await lockTotp(q,user.user_id);
    await assertDeadline(q,row.expires_at);
    if(factor.enabled){
      if(factor.failures>=10)return {blocked:true as const};
      if(!await consumeTotp(q,user.user_id,factor,input.code,encryptionKey)){
        await q.query('UPDATE member_totp SET failures=failures+1 WHERE user_id=$1',[user.user_id]);return {invalid:true as const};
      }
      await q.query('UPDATE member_totp SET failures=0 WHERE user_id=$1',[user.user_id]);
    }
    const consumed=await q.query('DELETE FROM google_login_challenges WHERE challenge_hash=$1 AND expires_at>clock_timestamp() RETURNING challenge_hash',[tokenHash(input.challenge)]);
    if(!consumed.rowCount)throw invalid();
    const session=await provisionalSession(q,user,row.identity_id,input.verifier,row.origin_state_hash,false);
    // Session insertion can wait; retain the original deadline for the final decision.
    const valid=await q.query('SELECT $1::timestamptz>clock_timestamp() AS valid',[row.expires_at]);
    if(!valid.rows[0].valid)throw invalid();
    return session;
  });
  if('blocked' in result)throw new Problem(429,'totp_rate_limited','驗證嘗試過多，請稍後再試。');
  if('invalid' in result)throw new Problem(401,'invalid_totp','驗證碼不正確或已使用。');
  return result;
}
export async function googleIdentityStatus(pool:Pool,actor:Actor){return readWithMemberSession(pool,actor,async q=>{const row=(await q.query('SELECT identity_id FROM member_login_identities WHERE user_id=$1 AND community_id=$2 AND revoked_at IS NULL',[actor.user_id,actor.community_id])).rows[0];return {linked:Boolean(row),identity_id:row?.identity_id??null};});}
export async function unlinkGoogleIdentity(pool:Pool,actor:Actor,password:string,identityId:string){
  requireCondition(typeof identityId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identityId),422,'google_identity_required','請重新讀取目前 Google 連結後再操作。');
  return transaction(pool,async q=>{
  await lockMemberSession(q,actor,true);
  requireCondition(await verifyMemberPassword(q,actor.user_id,password),403,'password_verification_failed','請先透過帳號信箱設定真正的密碼，再解除連結。');
  const changed=await q.query('UPDATE member_login_identities SET revoked_at=clock_timestamp() WHERE identity_id=$3 AND user_id=$1 AND community_id=$2 AND revoked_at IS NULL',[actor.user_id,actor.community_id,identityId]);
  requireCondition(changed.rowCount===1,409,'google_identity_changed','Google 連結已變更，請重新讀取目前狀態；不會解除較新的連結。');
  await q.query('DELETE FROM google_login_challenges WHERE user_id=$1',[actor.user_id]);
  // Same user lock as activation; removing dormant sessions cascades their proof.
  await q.query(`DELETE FROM sessions WHERE user_id=$1 AND created_at IS NULL AND last_seen_at IS NULL
    AND token_hash IN(SELECT session_hash FROM google_login_activations)`,[actor.user_id]);
  await q.query('DELETE FROM google_login_states WHERE user_id=$1',[actor.user_id]);
  await assertCurrentSessionClock(q,actor);return {unlinked:true};
});}

/** Dormant sessions are invisible to authentication, session lists and presence. */
async function provisionalSession(q:PoolClient,user:Pick<Actor,'user_id'>&{password_hash?:string|null},identityId:string,verifier:string,stateHash:string,registered:boolean){
  const token=opaque(),csrf=opaque(),activation=opaque(),sessionHash=tokenHash(token);
  await q.query(`INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at,last_seen_at)
    VALUES($1,$2,$3,clock_timestamp(),NULL,NULL)`,[sessionHash,user.user_id,csrf]);
  const version=(await q.query('SELECT aggregate_version FROM member_accounts WHERE user_id=$1',[user.user_id])).rows[0]?.aggregate_version??0;
  await q.query(`INSERT INTO google_login_activations(activation_hash,session_hash,identity_id,browser_hash,origin_state_hash,credential_hash,account_version,registered)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[tokenHash(activation),sessionHash,identityId,tokenHash(verifier),stateHash,credential(user.password_hash??null),version,registered]);
  return {activation_required:true as const,activation,token};
}
/** ACK never sets a browser cookie. Its cookie was already received before this request. */
export async function activateGoogleLogin(pool:Pool,options:GoogleLoginOptions|undefined,input:{activation:string;verifier:string;rawSession?:string}){
  enabled(options);checkOpaque(input.activation);checkOpaque(input.verifier);if(!input.rawSession)throw invalid();checkOpaque(input.rawSession);
  return transaction(pool,async q=>{
    const sessionHash=tokenHash(input.rawSession!),proofHash=tokenHash(input.activation);
    const candidate=(await q.query('SELECT user_id FROM sessions WHERE token_hash=$1',[sessionHash])).rows[0];if(!candidate)throw invalid();
    const user=(await q.query('SELECT * FROM users WHERE user_id=$1 AND active FOR UPDATE',[candidate.user_id])).rows[0];if(!user)throw invalid();
    const session=(await q.query('SELECT * FROM sessions WHERE token_hash=$1 AND user_id=$2 FOR UPDATE',[sessionHash,user.user_id])).rows[0];
    if(!session||session.revoked_at||session.created_at!==null||session.last_seen_at!==null)throw invalid();
    const proof=(await q.query('SELECT * FROM google_login_activations WHERE activation_hash=$1 FOR UPDATE',[proofHash])).rows[0];
    if(!proof||proof.revoked_at||proof.session_hash!==sessionHash||proof.browser_hash!==tokenHash(input.verifier)||proof.credential_hash!==credential(user.password_hash))throw invalid();
    const linked=await q.query('SELECT 1 FROM member_login_identities WHERE identity_id=$1 AND user_id=$2 AND community_id=$3 AND revoked_at IS NULL FOR SHARE',[proof.identity_id,user.user_id,user.community_id]);if(!linked.rowCount)throw invalid();
    const version=(await q.query('SELECT aggregate_version FROM member_accounts WHERE user_id=$1',[user.user_id])).rows[0]?.aggregate_version??0;
    if(String(version)!==String(proof.account_version))throw invalid();
    // No sliding lifetime: the normal absolute cap starts at provisional issuance.
    await q.query(`UPDATE sessions SET created_at=$2,last_seen_at=clock_timestamp(),expires_at=$2::timestamptz+make_interval(secs=>$3) WHERE token_hash=$1`,[sessionHash,proof.issued_at,SESSION_LIFETIME_SECONDS]);
    const consumed=await q.query('DELETE FROM google_login_activations WHERE activation_hash=$1 AND expires_at>clock_timestamp() RETURNING activation_hash',[proofHash]);if(!consumed.rowCount)throw invalid();
    return {actor:{...user,session_hash:sessionHash,csrf_token:session.csrf_token} as Actor,registered:proof.registered as boolean};
  });
}
