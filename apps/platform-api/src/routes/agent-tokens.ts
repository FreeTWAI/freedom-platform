import {Hono} from 'hono';
import type {Pool} from 'pg';
import {z} from 'zod';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
import {issueAgentToken,listAgentTokens,manageAgentToken} from '../../../../modules/client-connections/agent-tokens.js';
import {createAgentPingFetch,setAgentPing,testAgentPing,type AgentPingFetch} from '../../../../modules/client-connections/agent-pings.js';
export function createAgentTokenRoutes(pool:Pool,options:{origin?:string;agentPingFetch?:AgentPingFetch;agentPingsDisabled?:boolean}={}){
 const app=new Hono<PlatformEnv>();
 const pingFetch=options.agentPingFetch??createAgentPingFetch(globalThis.fetch,options.origin??'');
 app.get('/me/agent-tokens',async c=>c.json(await listAgentTokens(pool,c.get('actor'))));
 app.post('/me/agent-tokens',async c=>c.json(await issueAgentToken(pool,c.get('actor'),await c.req.json()),201));
 app.post('/me/agent-tokens/:id/renew',async c=>c.json(await issueAgentToken(pool,c.get('actor'),await c.req.json(),c.req.param('id')),201));
 app.post('/me/agent-tokens/:id/ping',async c=>c.json(await setAgentPing(pool,await moduleCommand(c),c.req.param('id'),options.origin??'')));
 app.post('/me/agent-tokens/:id/ping/test',async c=>{z.object({}).strict().parse(await c.req.json());return c.json(await testAgentPing(pool,c.get('actor'),c.req.param('id'),pingFetch,{publicOrigin:options.origin,disabled:options.agentPingsDisabled}));});
 for(const action of ['revoke','confirm'] as const)app.post(`/me/agent-tokens/:id/${action}`,async c=>c.json(await manageAgentToken(pool,await moduleCommand(c),c.req.param('id'),action)));
 return app;
}
