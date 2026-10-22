import { sessionCookieName } from '../session-cookie.js';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { login, sessionView, SESSION_LIFETIME_SECONDS } from '../../../../modules/identity-membership/service.js';
import { readSessionCookie } from '../session-cookie.js';
import { requireCondition } from '../../../../packages/shared/problem.js';
import { confirmEmailChange } from '../../../../modules/identity-membership/email-change.js';
import { authRateLimit, registerMember } from '../../../../modules/identity-membership/members.js';
import { requestPasswordReset, confirmPasswordReset } from '../../../../modules/identity-membership/password-recovery.js';
import { confirmEmailVerification } from '../../../../modules/identity-membership/email-verification.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

/** Registered at its original position; common request boundaries stay in the host. */
export function registerAuthenticationRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool, origin, freedomEnv, runtime, authNetwork } = context;
  const COOKIE=sessionCookieName(origin),secureCookies=freedomEnv!=='local';
  app.post('/api/v1/auth/register',async c=>{
    await authRateLimit(pool,'registration-network',authNetwork(c),8);
    await authRateLimit(pool,'registration-global','global',100,60);
    const raw=await c.req.json();
    const result=await registerMember(pool,raw,{communityId:runtime.registrationCommunityId(),allowSingleCommunity:freedomEnv==='local',publicMode:freedomEnv==='public'});
    const old=readSessionCookie(c.req.header('Cookie'),origin);
    if(old) {const {tokenHash}=await import('../../../../modules/identity-membership/service.js');await pool.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash(old)]);}
    setCookie(c,COOKIE,result.token,{httpOnly:true,sameSite:'Strict',secure:secureCookies,path:'/',maxAge:SESSION_LIFETIME_SECONDS});
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
    setCookie(c,COOKIE,result.token,{httpOnly:true,sameSite:'Strict',secure:secureCookies,path:'/',maxAge:SESSION_LIFETIME_SECONDS});
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
    if ('totp_required' in result) return c.json(result);
    // Replace any old session on reset, so changing accounts never keeps an active old cookie.
    if(old) { const {tokenHash}=await import('../../../../modules/identity-membership/service.js');await pool.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash(old)]); }
    setCookie(c,COOKIE,result.token,{httpOnly:true,sameSite:'Strict',secure:secureCookies,path:'/',maxAge:SESSION_LIFETIME_SECONDS});
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
