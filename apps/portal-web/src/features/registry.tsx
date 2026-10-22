import type { TabId } from '../types';
import type { PortalFeatureContext } from './types';
import { identityFeatures } from './identity';
import { guildsFeatures } from './guilds';
import { communityFeatures } from './community';
import { workFeatures } from './work';
import { commerceFeatures } from './commerce';
import { composePortalFeatures } from './composition';

/** Static, reviewed composition. No remote plugin evaluation or implicit route registration. */
// Every entry has the same typed context; missing pages and duplicate IDs are rejected.
export const PORTAL_FEATURES = composePortalFeatures([
  identityFeatures, guildsFeatures, communityFeatures, workFeatures, commerceFeatures,
]);

export function renderPortalFeature(tab: TabId, context: PortalFeatureContext) {
  // Called inside the existing keyed PageLoadBoundary, so loading failures and
  // tab changes retain the shell's original recovery and unmount behavior.
  return PORTAL_FEATURES[tab].render(context);
}
