import {activateGoogleLogin,invalidateGoogleBrowser,googleAvailable,startGoogleLogin,completeGoogleLogin,cancelGoogleLogin,finishGoogleTotp} from '../../../../modules/identity-membership/google/service.js';
import type {Context} from 'hono';
import { sessionCookieName } from '../session-cookie.js';
import { setCookie,deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { login, sessionView, SESSION_LIFETIME_SECONDS } from '../../../../modules/identity-membership/service.js';
import { readSessionCookie } from '../session-cookie.js';
import { requireCondition } from '../../../../packages/shared/problem.js';
import { confirmEmailChange } from '../../../../modules/identity-membership/email-change.js';
import { authRateLimit, registerMember } from '../../../../modules/identity-membership/members.js';
import { requestPasswordReset, confirmPasswordReset } from '../../../../modules/identity-membership/password-recovery.js';
import { confirmEmailVerification } from '../../../../modules/identity-membership/email-verification.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

const flowCookieName=(origin:string)=>origin.startsWith('https:')?'__Host-freedom_google_flow':'freedom_google_flow';
export function googleCookieVerifier(c:Context,origin:string){
  const name=flowCookieName(origin),parts=(c.req.header('Cookie')??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(`${name}=`));
  requireCondition(parts.length===1,409,'google_flow_expired','這次 Google 登入已失效，請重新開始。');
  const value=parts[0].slice(name.length+1);
  requireCondition(/^[A-Za-z0-9_-]{43}$/.test(value),409,'google_flow_expired','這次 Google 登入已失效，請重新開始。');return value;
}
export async function cancelOtherGoogleFlow(pool:PlatformFeatureContext['pool'],c:Context,origin:string){
  // Malformed/duplicate flow cookies never confer authority or block normal recovery.
  let verifier:string|undefined;try{verifier=googleCookieVerifier(c,origin);}catch{/* no valid pending browser flow */}
  if(verifier)await invalidateGoogleBrowser(pool,verifier);

}
export function setGoogleFlowCookie(c:Context,origin:string,verifier:string){setCookie(c,flowCookieName(origin),verifier,{path:'/',httpOnly:true,secure:origin.startsWith('https:'),sameSite:'Strict',maxAge:600});}
export function clearGoogleFlowCookie(c:Context,origin:string){deleteCookie(c,flowCookieName(origin),{path:'/',httpOnly:true,secure:origin.startsWith('https:'),sameSite:'Strict'});}

/** Registered at its original position; common request boundaries stay in the host. */
export function registerAuthenticationRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool, origin, freedomEnv, runtime, authNetwork } = context;
  const COOKIE=sessionCookieName(origin),secureCookies=freedomEnv!=='local';
  const google=()=>googleAvailable(runtime.googleLogin,Boolean(runtime.passwordEmailSender))?runtime.googleLogin:undefined;
  app.get('/api/v1/auth/google/config',c=>{c.header('Cache-Control','no-store');return c.json({enabled:Boolean(google())});});
  app.post('/api/v1/auth/google/start',async c=>{
    z.object({}).strict().parse(await c.req.json());
    await authRateLimit(pool,'google-start-network',authNetwork(c),20);
    await authRateLimit(pool,'google-start-global','global',240,60);
    const result=await startGoogleLogin(pool,google(),origin,readSessionCookie(c.req.header('Cookie'),origin));
    setGoogleFlowCookie(c,origin,result.verifier);c.header('Cache-Control','no-store');return c.json({url:result.url});
  });
  app.post('/api/v1/auth/google/complete',async c=>{
    await authRateLimit(pool,'google-complete-network',authNetwork(c),30);
    await authRateLimit(pool,'google-complete-global','global',240,60);
    const body=z.object({state:z.string().length(43),code:z.string().min(1).max(4096)}).strict().parse(await c.req.json());
    const result=await completeGoogleLogin(pool,google(),origin,{...body,verifier:googleCookieVerifier(c,origin),rawSession:readSessionCookie(c.req.header('Cookie'),origin)},{communityId:runtime.registrationCommunityId(),allowSingleCommunity:freedomEnv==='local',network:authNetwork(c)});
    c.header('Cache-Control','no-store');
    if('totp_required' in result)return c.json(result);
    requireCondition('activation_required' in result,500,'google_flow_invalid','登入回應不完整。');
    setCookie(c,COOKIE,result.token,{httpOnly:true,sameSite:'Strict',secure:secureCookies,path:'/',maxAge:SESSION_LIFETIME_SECONDS});
    return c.json({activation_required:true,activation:result.activation});
  });
  app.post('/api/v1/auth/google/totp',async c=>{
    await authRateLimit(pool,'google-totp-network',authNetwork(c),30);
    await authRateLimit(pool,'google-totp-global','global',240,60);
    const body=z.object({challenge:z.string().length(43),code:z.string().min(1).max(64)}).strict().parse(await c.req.json());
    const result=await finishGoogleTotp(pool,google(),{...body,verifier:googleCookieVerifier(c,origin),rawSession:readSessionCookie(c.req.header('Cookie'),origin)},runtime.totpEncryptionKey?.());
    setCookie(c,COOKIE,result.token,{httpOnly:true,sameSite:'Strict',secure:secureCookies,path:'/',maxAge:SESSION_LIFETIME_SECONDS});c.header('Cache-Control','no-store');return c.json({activation_required:true,activation:result.activation});
  });
  app.post('/api/v1/auth/google/activate',async c=>{
    await authRateLimit(pool,'google-activate-network',authNetwork(c),30);
    const body=z.object({activation:z.string().length(43)}).strict().parse(await c.req.json());
    const result=await activateGoogleLogin(pool,google(),{...body,verifier:googleCookieVerifier(c,origin),rawSession:readSessionCookie(c.req.header('Cookie'),origin)});
    c.header('Cache-Control','no-store');return c.json({...sessionView(result.actor),registered:result.registered});
  });
  app.post('/api/v1/auth/google/cancel',async c=>{
    await authRateLimit(pool,'google-cancel-network',authNetwork(c),30);
    const body=z.object({state:z.string().length(43)}).strict().parse(await c.req.json());
    const result=await cancelGoogleLogin(pool,body.state,googleCookieVerifier(c,origin),readSessionCookie(c.req.header('Cookie'),origin));clearGoogleFlowCookie(c,origin);return c.json(result);
  });
  app.post('/api/v1/auth/register',async c=>{
    await authRateLimit(pool,'registration-network',authNetwork(c),8);
    await authRateLimit(pool,'registration-global','global',100,60);
    const raw=await c.req.json();
    const result=await registerMember(pool,raw,{communityId:runtime.registrationCommunityId(),allowSingleCommunity:freedomEnv==='local',publicMode:freedomEnv==='public'});
    const old=readSessionCookie(c.req.header('Cookie'),origin);
    if(old) {const {tokenHash}=await import('../../../../modules/identity-membership/service.js');await pool.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash(old)]);}
    await cancelOtherGoogleFlow(pool,c,origin);
    setCookie(c,COOKIE,result.token,{httpOnly:true,sameSite:'Strict',secure:secureCookies,path:'/',maxAge:SESSION_LIFETIME_SECONDS});
    // Append only the Google deletion, including OFF/no-marker queued requests.
    clearGoogleFlowCookie(c,origin);
    return c.json(sessionView(result.actor),201);
  });
  app.post('/api/v1/auth/login',async c=>{
    await authRateLimit(pool,'login-network',authNetwork(c),60);
    await authRateLimit(pool,'login-global','global',240,60);
    const body=z.object({email:z.email().max(200),password:z.string().min(1).max(200),code:z.string().min(1).max(64).optional()}).strict().parse(await c.req.json());
    const result=await login(pool,body.email,body.password,body.code,runtime.totpEncryptionKey?.());
    // Replace any old session on login, so changing accounts never keeps an active old cookie.
    const old=readSessionCookie(c.req.header('Cookie'),origin);
    if(old) { const {tokenHash}=await import('../../../../modules/identity-membership/service.js');await pool.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash(old)]); }
    await cancelOtherGoogleFlow(pool,c,origin);
    setCookie(c,COOKIE,result.token,{httpOnly:true,sameSite:'Strict',secure:secureCookies,path:'/',maxAge:SESSION_LIFETIME_SECONDS});
    // Append only the Google deletion, including OFF/no-marker queued requests.
    clearGoogleFlowCookie(c,origin);
    return c.json(sessionView(result.actor));
  });
  app.post('/api/v1/auth/reset/request',async c=>{
    requireCondition(runtime.passwordEmailSender,503,'password_recovery_unavailable','忘記密碼服務尚未設定完成。');
    const body=z.object({email:z.email().max(200)}).strict().parse(await c.req.json());
    const email=body.email.trim().toLowerCase();
    await authRateLimit(pool,'password-reset-network',authNetwork(c),12,3600);
    await authRateLimit(pool,'password-reset-global','global',500,3600);
    await authRateLimit(pool,'password-reset-email',email,3,3600);
    await requestPasswordReset(pool,email,origin,runtime.passwordEmailSender);
    return c.json({requested:true,message:'若此信箱有可用帳號，且寄送服務正常，重設連結會寄到信箱。'});
  });
  app.post('/api/v1/auth/reset/confirm',async c=>{
    requireCondition(runtime.passwordEmailSender,503,'password_recovery_unavailable','忘記密碼服務尚未設定完成。');
    await authRateLimit(pool,'password-reset-confirm-network',authNetwork(c),30,3600);
    await authRateLimit(pool,'password-reset-confirm-global','global',500,3600);
    const body=z.object({token:z.string().max(100),password:z.string().max(128)}).strict().parse(await c.req.json());
    const old=readSessionCookie(c.req.header('Cookie'),origin);
    const result=await confirmPasswordReset(pool,body.token,body.password);
    if ('totp_required' in result) {await cancelOtherGoogleFlow(pool,c,origin);clearGoogleFlowCookie(c,origin);return c.json(result);}
    // Replace any old session on reset, so changing accounts never keeps an active old cookie.
    if(old) { const {tokenHash}=await import('../../../../modules/identity-membership/service.js');await pool.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash(old)]); }
    await cancelOtherGoogleFlow(pool,c,origin);
    setCookie(c,COOKIE,result.token,{httpOnly:true,sameSite:'Strict',secure:secureCookies,path:'/',maxAge:SESSION_LIFETIME_SECONDS});
    // Append only the Google deletion, including OFF/no-marker queued requests.
    clearGoogleFlowCookie(c,origin);
    return c.json({reset:result.reset,expires_after_minutes:result.expires_after_minutes,...sessionView(result.actor)});
  });
  app.post('/api/v1/auth/email-change/confirm',async c=>{
    requireCondition(runtime.eventEmailSender,503,'email_change_unavailable','Email 變更郵件服務尚未設定。');
    await authRateLimit(pool,'email-change-confirm-network',authNetwork(c),30,3600);
    await authRateLimit(pool,'email-change-confirm-global','global',500,3600);
    const body=z.object({token:z.string().max(100)}).strict().parse(await c.req.json());
    return c.json(await confirmEmailChange(pool,body.token,runtime.eventEmailSender));
  });
  app.post('/api/v1/auth/email-verification/confirm',async c=>{
    const body=z.object({token:z.string().max(100)}).strict().parse(await c.req.json());
    await authRateLimit(pool,'email-verification-confirm-network',authNetwork(c),30,3600);
    await authRateLimit(pool,'email-verification-confirm-global','global',500,3600);
    return c.json(await confirmEmailVerification(pool,body.token));
  });
}
