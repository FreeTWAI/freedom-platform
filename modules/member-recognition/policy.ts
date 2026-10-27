import type {CommunityCertificationFact, OutcomeEvidence, RecognitionBadge, RecognitionDisplay, RecognitionDisplayContext} from './contracts.js';

export const CONTRIBUTION_POLICY = 'community_work_milestones_v1_proposed';
export const CERTIFICATION_POLICY = 'community_certification_v1_proposed';
const milestones = [
  {minimum: 1, label: '初次貢獻', icon: 'sprout'},
  {minimum: 5, label: '協作夥伴', icon: 'puzzle'},
  {minimum: 20, label: '持續貢獻者', icon: 'star'},
  {minimum: 50, label: '長期共創者', icon: 'stars'},
] as const;
const invalid = () => { throw new TypeError('invalid_recognition_evidence'); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid();
}

/** Server projection only. Never authenticate caller data with this helper.
 * The future SQL reader must deduplicate the complete authorized snapshot;
 * this function's array is not a paginated feed or public Work consent. */
export function countEligibleOutcomes(evidence: readonly OutcomeEvidence[]): number {
  if (!Array.isArray(evidence)) invalid();
  const ids = new Set<string>();
  for (const item of evidence) {
    exact(item, ['workId', 'mode', 'accepted', 'basis', 'current']);
    if (typeof item.workId !== 'string' || !uuid.test(item.workId)
      || !['community_collaboration', 'private', 'tenant'].includes(item.mode as string)
      || !['accepted_delivery', 'confirmed_role'].includes(item.basis as string)
      || typeof item.accepted !== 'boolean' || typeof item.current !== 'boolean') invalid();
    if (item.mode === 'community_collaboration' && item.accepted && item.current) ids.add(item.workId.toLowerCase());
  }
  return ids.size;
}

/** Pure draft threshold calculation; it neither awards nor persists anything. */
export function proposedMilestone(count: number): RecognitionBadge | undefined {
  if (!Number.isSafeInteger(count) || count < 0) invalid();
  const tier = [...milestones].reverse().find(item => count >= item.minimum);
  return tier && {kind: 'contribution_milestone', label: tier.label, icon: tier.icon,
    accessibleDescription: '依目前可展示的已驗收社群合作成果；不是身份認證、信用評等或履約保證。', policyVersion: CONTRIBUTION_POLICY};
}

/** Presentation decision only: profileReadable is NOT an authorization token.
 * Call only inside the canonical current-authority SQL projection. No routes
 * import this draft. Anonymous output deliberately omits BOTH badge fields. */
export function proposedRecognitionDisplay(context: RecognitionDisplayContext, evidence: readonly OutcomeEvidence[], certification?: CommunityCertificationFact): RecognitionDisplay {
  exact(context, ['audience', 'profileReadable', 'sameCommunity', 'currentSession', 'showCommunityCertification', 'showContributionBadges']);
  if (!['anonymous', 'member'].includes(context.audience)
    || ['profileReadable', 'sameCommunity', 'currentSession', 'showCommunityCertification', 'showContributionBadges'].some(key => typeof context[key as keyof RecognitionDisplayContext] !== 'boolean')) invalid();
  if (context.audience !== 'member' || !context.profileReadable || !context.sameCommunity || !context.currentSession) return {};
  const result: RecognitionDisplay = {};
  if (context.showCommunityCertification && certification !== undefined) {
    exact(certification, ['state', 'aggregateVersion', 'policyVersion']);
    if (!['active', 'revoked'].includes(certification.state) || !Number.isSafeInteger(certification.aggregateVersion)
      || certification.aggregateVersion < 1 || certification.policyVersion !== CERTIFICATION_POLICY) invalid();
    if (certification.state === 'active') result.communityCertification = {kind: 'community_certification', label: '社群認證', icon: 'blue-check',
      accessibleDescription: '管理員審核通過的社群標記；非實名查驗、信用評等或履約保證。', policyVersion: CERTIFICATION_POLICY};
  }
  if (context.showContributionBadges) {
    const badge = proposedMilestone(countEligibleOutcomes(evidence));
    if (badge) result.contributionMilestone = badge;
  }
  return result;
}
