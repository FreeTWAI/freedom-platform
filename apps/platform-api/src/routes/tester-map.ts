import {Hono} from 'hono';
import type {Pool} from 'pg';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
import {authRateLimit} from '../../../../modules/identity-membership/members.js';
import {getTesterAccount,getTesterReport,mutateTesterAccount,triageTesterFeedback} from '../../../../modules/tester-map/account-service.js';
import {authenticate,type Actor} from '../../../../modules/identity-membership/service.js';
import {Problem} from '../../../../packages/shared/problem.js';
import {resolvePublicCommunity} from '../../../../modules/community/member-services.js';
import {readSessionCookie} from '../session-cookie.js';
/** Mounted before the member boundary; only this GET accepts anonymous readers. */
export function createPublicTesterMapRoutes(pool:Pool,origin:string,configured:()=>string|undefined) {
  const app=new Hono<PlatformEnv>();
  app.get('/tester-map/report',async c=>{
    c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');
    let actor:Actor|undefined;
    const session=readSessionCookie(c.req.header('Cookie'),origin);
    if(session){try{actor=await authenticate(pool,session);}catch(error){if(!(error instanceof Problem&&error.status===401&&['login_required','session_expired'].includes(error.code)))throw error;}}
    if(actor?.onboarding_required&&!actor.onboarding_completed_at)actor=undefined;
    return c.json(await getTesterReport(pool,await resolvePublicCommunity(pool,configured()),actor,c.req.query('module')));
  });
  return app;
}
export function createTesterMapRoutes(pool: Pool) {
  const app = new Hono<PlatformEnv>();
  app.use('/me/tester-map',async(c,next) => {c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');await next();});
  app.use('/tester-map/*',async(c,next) => {c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');await next();});
  app.get('/me/tester-map',async c => c.json(await getTesterAccount(pool,c.get('actor'))));
  app.post('/me/tester-map',async c => {
    await authRateLimit(pool,'tester-map',c.get('actor').user_id,120,60);
    return c.json(await mutateTesterAccount(pool,await moduleCommand(c)));
  });
  app.post('/tester-map/report/triage',async c => {
    await authRateLimit(pool,'tester-map-triage',c.get('actor').user_id,120,60);
    return c.json(await triageTesterFeedback(pool,await moduleCommand(c)));
  });
  return app;
}
