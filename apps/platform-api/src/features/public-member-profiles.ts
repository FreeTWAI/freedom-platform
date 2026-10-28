import {publicVisitorProfile} from '../../../../modules/identity-membership/profile-publication.js';
import type {PlatformFeatureApp,PlatformFeatureContext} from './context.js';
export function registerPublicMemberProfiles(app:PlatformFeatureApp,{pool}:PlatformFeatureContext){
  app.use('/api/v1/public/member-profiles/:id',async(c,next)=>{
    c.header('Cache-Control','no-store');c.header('Vary','Cookie');c.header('X-Robots-Tag','noindex, nofollow');await next();
  });
  app.get('/api/v1/public/member-profiles/:id',async c=>c.json(await publicVisitorProfile(pool,c.req.param('id'))));
}
