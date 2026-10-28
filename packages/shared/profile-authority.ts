/** Fixed server-only SQL fragments. Aliases and parameter order are part of the
 * internal contract, never supplied by request data. Both text and cover bytes
 * use these predicates; public authority never consults cookies. */
export const profileReadySql=(alias:'u'|'v')=>`${alias}.active AND (NOT ${alias}.onboarding_required OR ${alias}.onboarding_completed_at IS NOT NULL) AND NOT is_verification_test_account(${alias}.user_id)`;
export const memberProfileAuthoritySql=()=>`p.user_id=$3 AND p.community_id=$1 AND ${profileReadySql('u')} AND ${profileReadySql('v')}
  AND (p.user_id=$2 OR (p.visibility IN ('members','public') AND NOT EXISTS(
    SELECT 1 FROM member_interaction_blocks b WHERE b.community_id=$1 AND b.state='active'
    AND ((b.owner_ref=$2 AND b.target_ref=p.user_id) OR (b.owner_ref=p.user_id AND b.target_ref=$2)))))`;
export const publicProfileAuthoritySql=()=>`p.user_id=$1 AND p.visibility='public' AND ${profileReadySql('u')}`;
