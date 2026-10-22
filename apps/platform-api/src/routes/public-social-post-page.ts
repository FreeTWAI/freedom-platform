import type {Hono} from 'hono';
import type {Pool} from 'pg';
import {readPublicSocialPost} from '../../../../modules/community/public-social-posts.js';
import {publicSocialPostHtml, unavailableSocialPostHtml} from '../../../../modules/community/public-social-post-page.js';
import type {PlatformEnv} from '../module-context.js';
import type {PlatformRuntime} from '../runtime.js';

export function registerPublicSocialPostPage(app: Hono<PlatformEnv>, pool: Pool, runtime: PlatformRuntime, registrationEnabled: boolean) {
  app.get('/posts/:id', async c => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    const id = c.req.param('id');
    const page = await readPublicSocialPost(pool, id, runtime.registrationCommunityId());
    return page ? c.html(publicSocialPostHtml(page, runtime.publicOrigin, registrationEnabled))
      : c.html(unavailableSocialPostHtml(id), 404);
  });
}
