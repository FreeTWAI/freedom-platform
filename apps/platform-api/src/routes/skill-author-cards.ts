import {Hono} from 'hono';
import {z} from 'zod';
import type {Pool} from 'pg';
import {publicSkillAuthorCards,publicSubmittedSkillAuthorCards} from '../../../../modules/skill-author-cards/service.js';

export function createPublicSkillAuthorCardRoutes(pool:Pool){
  const app=new Hono();
  for(const path of ['/skills/:id/author-card','/skill-submissions/:id/author-card'])app.use(path,async(c,next)=>{c.header('Cache-Control','no-store');await next();});
  app.get('/skills/:id/author-card',async c=>c.json(await publicSkillAuthorCards(pool,z.string().regex(/^[a-z0-9-]{1,100}$/).parse(c.req.param('id')))));
  app.get('/skill-submissions/:id/author-card',async c=>{
    const result=await publicSubmittedSkillAuthorCards(pool,c.req.param('id'));
    return result?c.json(result):c.json({error:'submission_not_found'},404);
  });
  return app;
}
