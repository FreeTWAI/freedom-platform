import type { Hono } from 'hono';
import type { Pool } from 'pg';
import { readPublicWork, readShowcaseSharing, setShowcaseSharing } from '../../../../modules/opportunity-project-work/public-sharing.js';
import { publicWorkHtml, unavailableWorkHtml } from '../../../../modules/opportunity-project-work/public-work-page.js';
import { Problem } from '../../../../packages/shared/problem.js';
import { moduleCommand, type PlatformEnv } from '../module-context.js';
import type { PlatformRuntime } from '../runtime.js';

export function registerPublicWorks(app: Hono<PlatformEnv>, pool: Pool, runtime: Pick<PlatformRuntime, 'registrationCommunityId'>) {
  app.get('/api/v1/public/works/:id', async c => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    const work = await readPublicWork(pool, c.req.param('id'), runtime.registrationCommunityId(), c.req.query('via'));
    if (!work) throw new Problem(404, 'not_found', '找不到公開作品。');
    return c.json({
      showcase_id: work.showcase_id,
      title: work.title,
      description: work.description,
      public_url: work.public_url,
      creator_name: work.creator_name,
      sharer_name: work.sharer_name,
      approved_work_version: work.approved_work_version,
      version: work.version,
      updated_at: work.updated_at,
    });
  });
}

export function registerPublicWorkPage(app: Hono<PlatformEnv>, pool: Pool, runtime: Pick<PlatformRuntime, 'publicOrigin' | 'registrationCommunityId'>, origin: string) {
  app.get('/works/:id', async c => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    const work = await readPublicWork(pool, c.req.param('id'), runtime.registrationCommunityId(), c.req.query('via'));
    if (!work) return c.html(unavailableWorkHtml(), 404);
    return c.html(publicWorkHtml(work, runtime.publicOrigin ?? origin), 200);
  });
}

export function registerMemberWorkSharing(app: Hono<PlatformEnv>, pool: Pool) {
  app.get('/api/v1/me/showcases/:id/sharing', async c => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    const state = await readShowcaseSharing(pool, c.get('actor'), c.req.param('id'));
    c.header('ETag', `"${state.version}"`);
    return c.json(state);
  });

  app.put('/api/v1/me/showcases/:id/sharing', async c => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    const state = await setShowcaseSharing(pool, await moduleCommand(c), c.req.param('id'));
    c.header('ETag', `"${state.version}"`);
    return c.json(state);
  });
}
