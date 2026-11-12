import type { MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';
import type { Pool } from 'pg';
import { agentOperation } from './agent-allowlist.js';
import { authenticateAgent,recordAgentResponse } from '../../../modules/client-connections/agent-authority.js';
import { Problem,requireCondition } from '../../../packages/shared/problem.js';
import type { PlatformEnv } from './module-context.js';

/** Installed before ANY public, member, provider or admin handler. Hono's matched
 * route metadata, never a caller-supplied path/prefix, selects the capability. */
export function agentBoundary(pool:Pool):MiddlewareHandler<PlatformEnv> {
 return async(c,next)=>{
  const authorization=c.req.header('Authorization');
  if(!authorization||(!c.req.path.startsWith('/api/v1/')&&!/^Bearer +fw_agent_/i.test(authorization)))return next();
  c.header('Cache-Control','no-store');
  requireCondition(c.req.header('Cookie')===undefined,400,'ambiguous_credentials','請只使用一種登入憑證。');
  const actor=await authenticateAgent(pool,authorization);
  try {
   const route=matchedRoutes(c).find(r=>r.method===c.req.method);
   const op=route&&agentOperation(c.req.method,route.path);
   requireCondition(op&&actor.agent!.scopes.includes(op.scope),403,'scope_required','Agent 沒有這項操作權限。');
   actor.agent={...actor.agent!,scope:op.scope,operation:`${c.req.method} ${c.req.path}`,public_item:op.publicItem===true};
   requireCondition(!actor.onboarding_required||Boolean(actor.onboarding_completed_at),403,'onboarding_required','請先選擇主要公會。');
   if(c.req.method!=='GET')requireCondition(/^[A-Za-z0-9_-]{8,128}$/.test(c.req.header('Idempotency-Key')??''),400,'idempotency_required','請提供有效的 Idempotency-Key。');
   c.set('actor',actor);
   await next();
   await recordAgentResponse(pool,actor,c.res.status);
  } catch(error) {
   await recordAgentResponse(pool,actor,error instanceof Problem?error.status:500);
   throw error;
  }
 };
}
