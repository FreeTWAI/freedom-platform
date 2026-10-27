import {Hono} from 'hono';
import type {Pool} from 'pg';
import {readWithMemberSession} from '../../../../packages/db/member-session.js';
import {profilePublicationSettings,saveProfilePublication,memberVisitorProfile,type ProfileRecognitionOptions} from '../../../../modules/identity-membership/profile-publication.js';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
export function createMemberProfileRoutes(pool:Pool,options:ProfileRecognitionOptions={}){
  const app=new Hono<PlatformEnv>();
  // Mounted after the existing member boundary (session, CSRF and command headers).
  for(const path of ['/me/profile-publication','/members/:id/profile'])app.use(path,async(c,next)=>{
    c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');c.header('X-Robots-Tag','noindex, nofollow');await next();
  });
  app.get('/me/profile-publication',async c=>c.json(await readWithMemberSession(pool,c.get('actor'),q=>profilePublicationSettings(q,c.get('actor')))));
  app.post('/me/profile-publication',async c=>c.json(await saveProfilePublication(pool,await moduleCommand(c))));
  app.get('/members/:id/profile',async c=>c.json(await readWithMemberSession(pool,c.get('actor'),q=>memberVisitorProfile(q,c.get('actor'),c.req.param('id'),options))));
  return app;
}
