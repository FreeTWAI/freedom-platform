import {Hono} from 'hono';
import type {Pool} from 'pg';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
import {issueAgentToken,listAgentTokens,manageAgentToken} from '../../../../modules/client-connections/agent-tokens.js';
export function createAgentTokenRoutes(pool:Pool){
 const app=new Hono<PlatformEnv>();
 app.get('/me/agent-tokens',async c=>c.json(await listAgentTokens(pool,c.get('actor'))));
 app.post('/me/agent-tokens',async c=>c.json(await issueAgentToken(pool,c.get('actor'),await c.req.json()),201));
 app.post('/me/agent-tokens/:id/renew',async c=>c.json(await issueAgentToken(pool,c.get('actor'),await c.req.json(),c.req.param('id')),201));
 for(const action of ['revoke','confirm'] as const)app.post(`/me/agent-tokens/:id/${action}`,async c=>c.json(await manageAgentToken(pool,await moduleCommand(c),c.req.param('id'),action)));
 return app;
}
