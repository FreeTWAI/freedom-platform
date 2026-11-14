import { publicSharePage,sharePageCss } from '../../../../modules/shares/public-page.js';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Pool } from 'pg';
import { readWithMemberSession } from '../../../../packages/db/member-session.js';
import { moduleCommand, type PlatformEnv } from '../module-context.js';
import { createShare, previewShare, visibleShare, listShares, myCredit, retractShare, reportShare, shareLink } from '../../../../modules/shares/service.js';
import { refreshRepository,repositoryPage } from '../../../../modules/shares/repository-cache.js';
import { starShare,claimShareAuthor } from '../../../../modules/shares/repository-actions.js';
import type { socialLoader } from './github-social.js';
import type { AdapterContext } from '../../../../modules/shares/types.js';
export function createShareRoutes(pool:Pool,context:AdapterContext={},loadSocial?:ReturnType<typeof socialLoader>,afterResponse?:(work:()=>Promise<void>)=>void) {
  const app=new Hono<PlatformEnv>();
  app.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
  app.post('/shares/preview',async c=>c.json(await previewShare(pool,await moduleCommand(c),context)));
  app.post('/shares',async c=>{
    const result=await createShare(pool,await moduleCommand(c),context);
    const repo=(await pool.query('SELECT repo_id FROM shares WHERE share_id=$1',[result.share_id])).rows[0]?.repo_id;
    if(repo)await refreshRepository(pool,repo,context);
    return c.json(result);
  });
  app.get('/shares',async c=>c.json(await readWithMemberSession(pool,c.get('actor'),q=>listShares(q,c.get('actor'),c.req.query()))));
  app.get('/shares/:share_id',async c=>{
    const result=await readWithMemberSession(pool,c.get('actor'),async q=>{
      const s=await visibleShare(q,c.get('actor'),z.uuid().parse(c.req.param('share_id')));
      const sharers=(await q.query(`SELECT u.display_name,CASE WHEN e.user_id=$2 THEN 'sharer' ELSE 'co_sharer' END AS role
        FROM share_endorsements e JOIN users u USING(user_id) WHERE e.share_id=$1 AND e.withdrawn_at IS NULL AND NOT is_verification_test_account(e.user_id)
        UNION ALL SELECT u.display_name,e.role FROM share_credit_events e JOIN users u USING(user_id)
        WHERE e.share_id=$1 AND e.basis='claim_verified' AND e.units=1 AND NOT EXISTS(SELECT 1 FROM share_credit_events r WHERE r.reverses_event_id=e.event_id)
        LIMIT 50`,[s.share_id,s.first_sharer_user_id])).rows;
      const {editor_notes:archivedNotes,...publicFields}=s;
      return {...publicFields,sharers,repository:s.repo_id?await repositoryPage(q,s.repo_id):null};
    });
    if(result.repo_id&&result.repository?.stale){const refresh=()=>refreshRepository(pool,result.repo_id!,context);if(afterResponse)afterResponse(refresh);else void refresh().catch(()=>{});}
    return c.json(result);
  });
  app.post('/shares/:share_id/retract',async c=>c.json(await retractShare(pool,await moduleCommand(c),z.uuid().parse(c.req.param('share_id')))));
  app.post('/shares/:share_id/report',async c=>c.json(await reportShare(pool,await moduleCommand(c),z.uuid().parse(c.req.param('share_id')))));
  app.post('/shares/:share_id/links',async c=>c.json(await shareLink(pool,await moduleCommand(c),z.uuid().parse(c.req.param('share_id')))));
  if(loadSocial){
    app.post('/shares/:share_id/star',async c=>c.json(await starShare(pool,await moduleCommand(c),z.uuid().parse(c.req.param('share_id')),await loadSocial())));
    app.post('/shares/:share_id/claim',async c=>c.json(await claimShareAuthor(pool,await moduleCommand(c),z.uuid().parse(c.req.param('share_id')),await loadSocial())));
  }
  app.get('/me/credit',async c=>c.json(await readWithMemberSession(pool,c.get('actor'),q=>myCredit(q,c.get('actor'),c.req.query()))));
  return app;
}

export function createPublicShareRoutes(pool:Pool,origin:string,context:AdapterContext={},afterResponse?:(work:()=>Promise<void>)=>void){
 const app=new Hono<PlatformEnv>();
 app.get('/share-page.css',c=>{c.header('Content-Type','text/css; charset=utf-8');return c.body(sharePageCss);});
 app.get('/s/:share_id',async c=>{
  c.header('Cache-Control','no-store');
  const page=await publicSharePage(pool,z.uuid().parse(c.req.param('share_id')),origin,c.req.query('via'));
  if(page.repo_id&&page.stale){const refresh=()=>refreshRepository(pool,page.repo_id,context);if(afterResponse)afterResponse(refresh);else void refresh().catch(()=>{});}
  return c.html(page.html);
 });
 return app;
}
