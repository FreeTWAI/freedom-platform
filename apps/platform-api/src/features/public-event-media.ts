import { z } from 'zod';
import { eventAssetVideoResponse } from '../routes/community-events.js';
import { publicEvent, publicEventBanner } from '../../../../modules/community/events.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

/** Registered at its original position; common request boundaries stay in the host. */
export function registerPublicEventMediaRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool, origin, runtime } = context;
  app.get('/api/v1/public/events/:id',async c=>{
    const event=await publicEvent(pool,z.uuid().parse(c.req.param('id')));
    if(event.visibility==='referral')c.header('X-Robots-Tag','noindex, nofollow');
    return c.json(event);
  });
  app.get('/api/v1/public/events/:id/banner',async c=>{
    const bytes=await publicEventBanner(pool,z.uuid().parse(c.req.param('id')),runtime.eventBannerAssetStore);
    c.header('Content-Type','image/webp');c.header('Cache-Control','public, max-age=300');c.header('Cross-Origin-Resource-Policy','same-origin');
    return c.body(new Uint8Array(bytes));
  });
  app.get('/api/v1/public/events/:id/video',async c=>eventAssetVideoResponse(c,pool,z.uuid().parse(c.req.param('id')),runtime.eventVideoAssetStore));
}
