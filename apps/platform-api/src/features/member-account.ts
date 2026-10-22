import { sessionCookieName } from '../session-cookie.js';
import { deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { sessionView } from '../../../../modules/identity-membership/service.js';
import { requireCondition } from '../../../../packages/shared/problem.js';
import { requestEmailChange } from '../../../../modules/identity-membership/email-change.js';
import { authRateLimit } from '../../../../modules/identity-membership/members.js';
import { enableTotp, disableTotp, totpStatus } from '../../../../modules/identity-membership/totp.js';
import { cmd } from './commands.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

/** Registered at its original position; common request boundaries stay in the host. */
export function registerMemberAccountRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool, origin, freedomEnv, runtime, authNetwork } = context;
  const COOKIE=sessionCookieName(origin),secureCookies=freedomEnv!=='local';
  app.get('/api/v1/session',c=>c.json(sessionView(c.get('actor'))));
  app.post('/api/v1/me/account/email-change/request',async c=>{
    requireCondition(runtime.eventEmailSender,503,'email_change_unavailable','Email 變更郵件服務尚未設定。');
    const actor=c.get('actor');
    await authRateLimit(pool,'email-change-user',actor.user_id,5,3600);
    await authRateLimit(pool,'email-change-network',authNetwork(c),20,3600);
    return c.json(await requestEmailChange(pool,actor,await c.req.json(),origin,runtime.eventEmailSender));
  });
  app.get('/api/v1/me/totp',async c=>c.json(await totpStatus(pool,c.get('actor'))));
  app.post('/api/v1/me/totp/enable',async c=>c.json(await enableTotp(pool,await cmd(c),runtime.totpEncryptionKey?.())));
  app.post('/api/v1/me/totp/disable',async c=>c.json(await disableTotp(pool,await cmd(c),runtime.totpEncryptionKey?.())));
  app.post('/api/v1/me/client-errors',async c=>{
    const body=z.object({action:z.string().regex(/^(GET|POST|PUT|PATCH|DELETE|UI) \/[a-zA-Z0-9_/:.#-]*$/).max(120),error_code:z.string().regex(/^[a-zA-Z0-9_:-]{1,80}$/),http_status:z.number().int().min(0).max(599).optional()}).strict().parse(await c.req.json());
    const actor=c.get('actor');
    const recent=await pool.query('SELECT count(*)::int AS n FROM member_client_errors WHERE user_id=$1 AND created_at>clock_timestamp()-interval \'1 minute\'',[actor.user_id]);
    requireCondition(recent.rows[0].n<20,429,'error_log_rate_limited','錯誤回報過於頻繁。');
    await pool.query('INSERT INTO member_client_errors(community_id,user_id,action,error_code,http_status) VALUES($1,$2,$3,$4,$5)',[actor.community_id,actor.user_id,body.action,body.error_code,body.http_status??null]);
    return c.json({recorded:true},201);
  });
  app.post('/api/v1/auth/logout',async c=>{await pool.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[c.get('actor').session_hash]);deleteCookie(c,COOKIE,{path:'/',secure:secureCookies,httpOnly:true,sameSite:'Strict'});return c.json({logged_out:true});});
}
