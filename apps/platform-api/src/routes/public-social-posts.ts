import type {Hono} from 'hono';
import type {Pool} from 'pg';
import {z} from 'zod';
import {readWithMemberSession} from '../../../../packages/db/member-session.js';
import {Problem} from '../../../../packages/shared/problem.js';
import {resolvePublicCommunity} from '../../../../modules/community/member-services.js';
import {readPublicSocialPost, readPublicSocialPostImage, readSocialPostSharing, setSocialPostSharing} from '../../../../modules/community/public-social-posts.js';
import {moduleCommand, type PlatformEnv} from '../module-context.js';
import type {PlatformRuntime} from '../runtime.js';

/** Register before member-session middleware. All projections remain public,
 * even if a request happens to carry a member cookie. */
export function registerPublicSocialPosts(app: Hono<PlatformEnv>, pool: Pool, runtime: PlatformRuntime) {
  app.use('/api/v1/public/shared-posts/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    await next();
  });
  app.get('/api/v1/public/shared-posts/:id', async c => {
    const page = await readPublicSocialPost(pool, c.req.param('id'), runtime.registrationCommunityId());
    if (!page) throw new Problem(404, 'not_found', '找不到這則貼文。');
    return c.json(page);
  });
  app.get('/api/v1/public/shared-posts/:id/image', async c => {
    const bytes = await readPublicSocialPostImage(pool, c.req.param('id'), runtime.registrationCommunityId(), runtime.socialThumbnailAssetStore);
    c.header('Content-Type', 'image/webp');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    return c.body(new Uint8Array(bytes));
  });
}

/** Register after the existing current member, Origin and CSRF middleware. */
export function registerMemberPublicSocialPosts(app: Hono<PlatformEnv>, pool: Pool, runtime: PlatformRuntime) {
  app.get('/api/v1/social-posts/:id/public-sharing', async c => {
    const actor = c.get('actor'), id = z.uuid().parse(c.req.param('id'));
    const community = await resolvePublicCommunity(pool, runtime.registrationCommunityId());
    const state = await readWithMemberSession(pool, actor, q => readSocialPostSharing(q, actor, id, community));
    c.header('Cache-Control', 'private, no-store');
    c.header('ETag', `"${state.version}"`);
    return c.json(state);
  });
  app.post('/api/v1/social-posts/:id/public-sharing', async c => {
    const id = z.uuid().parse(c.req.param('id'));
    const community = await resolvePublicCommunity(pool, runtime.registrationCommunityId());
    const state = await setSocialPostSharing(pool, await moduleCommand(c), id, community, runtime.now?.() ?? new Date());
    c.header('Cache-Control', 'private, no-store');
    c.header('ETag', `"${state.version}"`);
    return c.json(state);
  });
}
