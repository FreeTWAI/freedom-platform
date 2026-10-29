import {Hono} from 'hono';
import type {Pool} from 'pg';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
import {readSocialAchievements,saveSocialAchievements,eraseSocialAchievements,appealSocialAchievements,listSocialReview,readSocialReview,moderateSocialAchievements} from '../../../../modules/social-achievements/service.js';
export function createSocialAchievementRoutes(pool:Pool){
 const app=new Hono<PlatformEnv>();
 app.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');await next();});
 app.get('/me/social-achievements',async c=>c.json(await readSocialAchievements(pool,c.get('actor'))));
 app.post('/me/social-achievements',async c=>c.json(await saveSocialAchievements(pool,{...await moduleCommand(c),operation:'POST /api/v1/me/social-achievements'})));
 app.post('/me/social-achievements/erase',async c=>c.json(await eraseSocialAchievements(pool,{...await moduleCommand(c),operation:'POST /api/v1/me/social-achievements/erase'})));
 app.post('/me/social-achievements/appeal',async c=>c.json(await appealSocialAchievements(pool,{...await moduleCommand(c),operation:'POST /api/v1/me/social-achievements/appeal'})));
 app.get('/admin/social-achievements',async c=>c.json(await listSocialReview(pool,c.get('actor'),c.req.query())));
 app.get('/admin/social-achievements/:id',async c=>c.json(await readSocialReview(pool,c.get('actor'),c.req.param('id'))));
 app.post('/admin/social-achievements/:id',async c=>{const id=c.req.param('id').toLowerCase();return c.json(await moderateSocialAchievements(pool,{...await moduleCommand(c),operation:`POST /api/v1/admin/social-achievements/${id}`},id));});
 return app;
}
