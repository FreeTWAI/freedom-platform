import {recordSocialWork} from '../../../../modules/social-achievements/service.js';
import { singleQuery } from '../routes/tenant-http.js';
import { createWork, claimWork, changeClaim, listWorks, listWorksPage, workListPageQuery, dashboard } from '../../../../modules/opportunity-project-work/work.js';
import { createShowcase, listShowcases, createOpportunity, listOpportunities, proposeEngagement, listEngagements, readEngagementSummary, changeEngagement } from '../../../../modules/opportunity-project-work/business.js';
import { acceptedWorkFeed, contributionRecords, previewTasks } from '../../../../modules/community/task-board.js';
import { cmd, routeId, respond } from './commands.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

/** The host keeps the audited private-work mount between list and action routes. */
export function registerWorkListRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool } = context;
  app.get('/api/v1/work-items',async c=>c.json({items:await listWorks(pool,c.get('actor'))}));
  app.get('/api/v1/work-items/page',async c=>{
    const query=workListPageQuery.parse(singleQuery(c));
    return c.json(await listWorksPage(pool,c.get('actor'),query));
  });
}

/** Registered after the host's private-work mount, preserving the original order. */
export function registerWorkRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool } = context;
  app.post('/api/v1/work-items',async c=>respond(c,await createWork(pool,await cmd(c)),201));
  // Action suffix is part of the constrained segment; validate its UUID separately.
  app.post('/api/v1/work-items/:id{[0-9a-f-]+:claim}',async c=>respond(c,await claimWork(pool,await cmd(c),routeId(c)),201));
  for(const action of ['start','submit','begin-review','decide'] as const) {
    app.post(`/api/v1/work-claims/:id{[0-9a-f-]+:${action}}`,async c=>respond(c,await changeClaim(pool,await cmd(c),routeId(c),action,context.runtime.socialAchievementsEnabled===true?recordSocialWork:undefined)));
  }
  app.get('/api/v1/dashboard',async c=>c.json(await dashboard(pool,c.get('actor'))));
  app.get('/api/v1/task-board/preview',async c=>c.json({items:await previewTasks(pool,c.get('actor'))}));
  app.get('/api/v1/me/contribution-records',async c=>c.json(await contributionRecords(pool,c.get('actor'),c.req.query())));
  app.get('/api/v1/community/accepted-work',async c=>c.json({items:await acceptedWorkFeed(pool,c.get('actor'))}));
  app.get('/api/v1/showcases',async c=>c.json(await listShowcases(pool,c.get('actor'),c.req.query())));
  app.post('/api/v1/showcases',async c=>respond(c,await createShowcase(pool,await cmd(c)),201));
  app.get('/api/v1/opportunities',async c=>c.json({items:await listOpportunities(pool,c.get('actor'))}));
  app.post('/api/v1/opportunities',async c=>respond(c,await createOpportunity(pool,await cmd(c)),201));
  app.post('/api/v1/opportunities/:id/engagements',async c=>respond(c,await proposeEngagement(pool,await cmd(c),routeId(c)),201));
  app.get('/api/v1/engagements',async c=>c.json({items:await listEngagements(pool,c.get('actor'))}));
  app.get('/api/v1/engagements/summary',async c=>{
    c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');
    return c.json(await readEngagementSummary(pool,c.get('actor')));
  });
  for(const action of ['agree','deliver','accept','confirm-receipt'] as const) {
    app.post(`/api/v1/engagements/:id{[0-9a-f-]+:${action}}`,async c=>respond(c,await changeEngagement(pool,await cmd(c),routeId(c),action)));
  }
  app.post('/api/v1/engagements/:id/receipts',async c=>respond(c,await changeEngagement(pool,await cmd(c),routeId(c),'receipt'),201));
}
