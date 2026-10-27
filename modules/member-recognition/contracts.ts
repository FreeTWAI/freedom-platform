/** Internal draft contracts, not a client command or authenticated evidence. */
export type RecognitionAudience = 'anonymous' | 'member';
export type RecognitionDisplayContext = {
  audience: RecognitionAudience;
  profileReadable: boolean;
  sameCommunity: boolean;
  currentSession: boolean;
  showCommunityCertification: boolean;
  showContributionBadges: boolean;
};
export type OutcomeEvidence = {
  workId: string;
  mode: 'community_collaboration' | 'private' | 'tenant';
  accepted: boolean;
  basis: 'accepted_delivery' | 'confirmed_role';
  current: boolean;
};
export type CommunityCertificationFact = {
  state: 'active' | 'revoked';
  aggregateVersion: number;
  policyVersion: 'community_certification_v1_proposed';
};
export type RecognitionBadge = {
  kind: 'community_certification' | 'contribution_milestone';
  label: string;
  icon: 'blue-check' | 'sprout' | 'puzzle' | 'star' | 'stars';
  accessibleDescription: string;
  policyVersion: string;
};
export type RecognitionDisplay = {
  communityCertification?: RecognitionBadge;
  contributionMilestone?: RecognitionBadge;
};
