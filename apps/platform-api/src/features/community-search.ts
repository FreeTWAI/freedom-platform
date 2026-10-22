import { markSearchOpened } from '../../../../modules/community/participation-metrics.js';
import { assignContentTopics, listTaggableContent } from '../../../../modules/community/content-search.js';
import { listCommunityBookmarks, changeCommunityBookmark, listCommunityFollows, changeCommunityFollow, listCommunityFollowUpdates } from '../../../../modules/community/content-relations.js';
import { cmd, routeId, respond } from './commands.js';
import type { PlatformFeatureApp, PlatformFeatureContext } from './context.js';

/** Registered at its original position; common request boundaries stay in the host. */
export function registerMemberSearchRoutes(app: PlatformFeatureApp, context: PlatformFeatureContext) {
  const { pool, runtime } = context;
  if(runtime.communitySearchEnabled===true){
    if(runtime.participationMetricsEnabled===true)app.post('/api/v1/community-search/operations/:id/open',async c=>c.json(await markSearchOpened(pool,c.get('actor'),c.req.param('id'),await c.req.json())));
    app.get('/api/v1/community-search/mine',async c=>c.json(await listTaggableContent(pool,c.get('actor'))));
    app.post('/api/v1/community-search/topics',async c=>respond(c,await assignContentTopics(pool,await cmd(c))));
  }
  if(runtime.communitySearchEnabled===true&&runtime.communityRelationsEnabled===true){
    app.get('/api/v1/community-relations/bookmarks',async c=>c.json(await listCommunityBookmarks(pool,c.get('actor'),c.req.query())));
    app.post('/api/v1/community-relations/bookmarks',async c=>respond(c,await changeCommunityBookmark(pool,await cmd(c))));
    app.get('/api/v1/community-relations/follows',async c=>c.json(await listCommunityFollows(pool,c.get('actor'))));
    app.post('/api/v1/community-relations/follows',async c=>respond(c,await changeCommunityFollow(pool,await cmd(c))));
    app.get('/api/v1/community-relations/updates',async c=>c.json(await listCommunityFollowUpdates(pool,c.get('actor'),c.req.query())));
  }
}
