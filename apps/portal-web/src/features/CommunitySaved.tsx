import type { PortalClient } from '../api';
import { CommunityRelations, CommunityRelationsProvider } from '../modules/CommunityRelations';
import { communityListHistoryForSession } from '../modules/community-search-controller';

/** Member bookmarks and follows screen rendered under 我的 (`#me/saved`). */
export function CommunitySaved({ client, authKey }: { client: PortalClient; authKey: string }) {
  const lifetime = `${authKey}:${client.sessionGeneration}`;
  return (
    <CommunityRelationsProvider key={lifetime} client={client}>
      <CommunityRelations client={client} navigation={communityListHistoryForSession(client, authKey)} />
    </CommunityRelationsProvider>
  );
}
