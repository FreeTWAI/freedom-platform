import {Hono} from 'hono';
import type {Pool} from 'pg';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
import {authRateLimit} from '../../../../modules/identity-membership/members.js';
import {getTesterAccount,getTesterReport,mutateTesterAccount,triageTesterFeedback} from '../../../../modules/tester-map/account-service.js';
export function createTesterMapRoutes(pool: Pool) {
  const app = new Hono<PlatformEnv>();
  app.use('/me/tester-map',async(c,next) => {c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');await next();});
  app.use('/tester-map/*',async(c,next) => {c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');await next();});
  app.get('/me/tester-map',async c => c.json(await getTesterAccount(pool,c.get('actor'))));
  app.post('/me/tester-map',async c => {
    await authRateLimit(pool,'tester-map',c.get('actor').user_id,120,60);
    return c.json(await mutateTesterAccount(pool,await moduleCommand(c)));
  });
  app.get('/tester-map/report',async c => c.json(await getTesterReport(pool,c.get('actor'),c.req.query('module'))));
  app.post('/tester-map/report/triage',async c => {
    await authRateLimit(pool,'tester-map-triage',c.get('actor').user_id,120,60);
    return c.json(await triageTesterFeedback(pool,await moduleCommand(c)));
  });
  return app;
}
