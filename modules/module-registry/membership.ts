import type {PoolClient} from 'pg';
import {requireCondition} from '../../packages/shared/problem.js';

export const SUPPLIER_GUILD = 'guild_product_quality_supply';
export const COMMERCE_GUILD = 'guild_commerce_sales';
export type GuildMembershipRule = {
  guildKey: string;
  minimumTier: 'intern' | 'full';
  reason: 'guild_member_required' | 'guild_full_member_required' | 'commerce_guild_member_required';
  detail: string;
};
export const supplierMembership: GuildMembershipRule = {
  guildKey: SUPPLIER_GUILD, minimumTier: 'intern', reason: 'guild_member_required',
  detail: '需要商品品質與供應公會的有效成員身分。',
};
export const commerceMembership: GuildMembershipRule = {
  guildKey: COMMERCE_GUILD, minimumTier: 'intern', reason: 'commerce_guild_member_required',
  detail: '建立零售商店需要電商公會的有效成員身分，實習成員也可以開始。',
};

/** Application eligibility does not grant access to an existing business. */
export function launchMembershipRule(applicationKey: string, guildKey: string): GuildMembershipRule {
  if (applicationKey === 'hosted-store') {
    if (guildKey === SUPPLIER_GUILD) return supplierMembership;
    return commerceMembership;
  }
  return {guildKey, minimumTier: 'full', reason: 'guild_full_member_required', detail: '需要這個公會的正式會員身分。'};
}

export function meetsMembership(tier: string | undefined, rule: GuildMembershipRule): boolean {
  return tier === 'full' || (tier === 'intern' && rule.minimumTier === 'intern');
}

/** Lock only after the caller's last existing workspace/profile wait. */
export async function assertGuildMembership(q: PoolClient, communityId: string, userId: string,
  rules: readonly GuildMembershipRule[], lock: boolean) {
  const result = await q.query(
    `SELECT guild_key FROM positioning_profession_memberships
     WHERE community_id=$1 AND user_id=$2 AND state='active' AND guild_key=ANY($3::text[])
       AND (member_tier='full' OR (member_tier='intern' AND guild_key=ANY($4::text[])))
     ORDER BY guild_key${lock ? ' FOR SHARE' : ''}`,
    [communityId, userId, rules.map(rule => rule.guildKey), rules.filter(rule => rule.minimumTier === 'intern').map(rule => rule.guildKey)],
  );
  requireCondition(!!result.rowCount, 403, rules[0].reason, rules[0].detail);
}
