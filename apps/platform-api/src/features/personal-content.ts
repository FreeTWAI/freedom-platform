import { listOwnShowcases, readOwnShowcase, createShowcaseDraft, updateOwnShowcase, publishOwnShowcase, withdrawOwnShowcase } from '../../../../modules/opportunity-project-work/business.js';
import { listPersonalContent } from '../../../../modules/community/personal-content.js';
import { readFirstParticipation, changeFirstParticipation, listFirstParticipationReception, claimFirstParticipationReception } from '../../../../modules/community/first-participation.js';
import { cmd, routeId, respond } from './commands.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

/** Registered at its original position; common request boundaries stay in the host. */
export function registerPersonalContentRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool, runtime } = context;
  if(runtime.personalContentEnabled===true){
    app.get('/api/v1/me/content',async c=>c.json(await listPersonalContent(pool,c.get('actor'))));
    app.get('/api/v1/me/showcases',async c=>c.json({items:await listOwnShowcases(pool,c.get('actor'))}));
    app.get('/api/v1/me/showcases/:id',async c=>respond(c,await readOwnShowcase(pool,c.get('actor'),routeId(c))));
    app.post('/api/v1/me/showcases',async c=>respond(c,await createShowcaseDraft(pool,await cmd(c)),201));
    app.patch('/api/v1/me/showcases/:id',async c=>respond(c,await updateOwnShowcase(pool,await cmd(c),routeId(c))));
    app.post('/api/v1/me/showcases/:id/publish',async c=>respond(c,await publishOwnShowcase(pool,await cmd(c),routeId(c))));
    app.post('/api/v1/me/showcases/:id/withdraw',async c=>respond(c,await withdrawOwnShowcase(pool,await cmd(c),routeId(c))));
  }
  if(runtime.firstParticipationEnabled===true){
    app.get('/api/v1/me/first-participation',async c=>respond(c,await readFirstParticipation(pool,c.get('actor'))));
    app.post('/api/v1/me/first-participation',async c=>respond(c,await changeFirstParticipation(pool,await cmd(c))));
    app.get('/api/v1/first-participation/reception',async c=>c.json(await listFirstParticipationReception(pool,c.get('actor'),c.req.query())));
    app.post('/api/v1/first-participation/reception/:userId/claim',async c=>respond(c,await claimFirstParticipationReception(pool,await cmd(c),c.req.param('userId'))));
    app.post('/api/v1/first-participation/reception/:userId/release',async c=>respond(c,await claimFirstParticipationReception(pool,await cmd(c),c.req.param('userId'),true)));
  }
}
