import type { TabId } from '../types';
import type { PortalFeatureEntries, PortalFeatureEntry } from './types';
import { PORTAL_FEATURE_METADATA } from './metadata';

/** Reject missing or duplicate entries instead of silently replacing another contributor's page. */
export function composePortalFeatures(groups: readonly PortalFeatureEntries[]): Readonly<Record<TabId, PortalFeatureEntry>> {
  const result: Partial<Record<TabId, PortalFeatureEntry>> = Object.create(null);
  for (const group of groups) {
    for (const [id, entry] of Object.entries(group)) {
      if (!Object.hasOwn(PORTAL_FEATURE_METADATA, id)) throw new Error('unknown_portal_feature');
      if (Object.hasOwn(result, id)) throw new Error('duplicate_portal_feature');
      if (!entry || typeof entry.render !== 'function' || !entry.moduleId
        || !['page', 'overlay'].includes(entry.placement)) throw new Error('invalid_portal_feature');
      result[id as TabId] = entry;
    }
  }
  if (Object.keys(PORTAL_FEATURE_METADATA).some(id => !Object.hasOwn(result, id))) throw new Error('missing_portal_feature');
  return Object.freeze(result as Record<TabId, PortalFeatureEntry>);
}
