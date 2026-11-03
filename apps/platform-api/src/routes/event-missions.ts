import {Hono} from 'hono';
import type {Pool} from 'pg';
import {z} from 'zod';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
import {readEventMissions,mutateEventMissions} from '../../../../modules/event-missions/service.js';
export function createEventMissionRoutes(pool:Pool){
 const app=new Hono<PlatformEnv>();
 app.use('/events/:id/my-missions',async(c,next)=>{c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');await next();});
 app.get('/events/:id/my-missions',async c=>c.json(await readEventMissions(pool,c.get('actor'),z.uuid().parse(c.req.param('id')).toLowerCase())));
 app.post('/events/:id/my-missions',async c=>c.json(await mutateEventMissions(pool,await moduleCommand(c),z.uuid().parse(c.req.param('id')).toLowerCase())));
 return app;
}
