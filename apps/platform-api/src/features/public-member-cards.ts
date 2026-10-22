import { publicMemberCard, publicMemberAvatar } from '../../../../modules/identity-membership/member-sharing.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

/** Registered at its original position; common request boundaries stay in the host. */
export function registerPublicMemberCardRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool, runtime } = context;
  app.get('/api/v1/public/member-cards/:token',async c=>{
    c.header('X-Robots-Tag','noindex, nofollow');
    return c.json(await publicMemberCard(pool,c.req.param('token')));
  });
  app.get('/api/v1/public/member-cards/:token/avatar',async c=>{
    const bytes=await publicMemberAvatar(pool,c.req.param('token'),runtime.avatarAssetStore);
    c.header('Content-Type','image/webp');c.header('X-Robots-Tag','noindex, nofollow');
    c.header('Cache-Control','no-store');c.header('Content-Length',String(bytes.length));
    return c.body(new Uint8Array(bytes));
  });
}
