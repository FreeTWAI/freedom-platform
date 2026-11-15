import {Hono} from 'hono';
import type {Pool} from 'pg';
import type {PlatformEnv} from '../module-context.js';
import {readAgentFeed} from '../../../../modules/client-connections/agent-feed.js';
export function createAgentFeedRoutes(pool:Pool){
 const app=new Hono<PlatformEnv>();
 app.get('/agent/events',async c=>c.json(await readAgentFeed(pool,c.get('actor'),c.req.query())));
 return app;
}
