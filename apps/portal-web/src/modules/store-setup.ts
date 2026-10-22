import {z} from 'zod';
import {ApplicationPageSchema, type ApplicationView} from '../../../../contracts/guild-launchpad/v1/module-registry';
import type {SupplyCatalogView} from '../../../../contracts/guild-launchpad/v1/hosted-supply-catalog';
import {ApiError, type PortalClient} from '../api';

export type StoreSetupPurpose = 'retail' | 'supply';
export const setupGuild = (purpose: StoreSetupPurpose) => purpose === 'supply' ? 'guild_product_quality_supply' : 'guild_commerce_sales';
export const setupListPath = (purpose: StoreSetupPurpose) => purpose === 'supply' ? '#stores/supply' : '#stores';

// Read only the directory fields this journey needs. Membership and eligibility
// still come from the existing member APIs, never from the selected entry path.
const MembershipSchema = z.object({state: z.string(), aggregate_version: z.number().int().positive()});
const SetupGuildSchema = z.object({guild_key: z.string(), name: z.string(), membership: MembershipSchema.nullable()});
const DirectorySchema = z.object({items: z.array(SetupGuildSchema)});
export const GuildJoinReceiptSchema = MembershipSchema.extend({state: z.literal('active')});
export type SetupGuild = z.infer<typeof SetupGuildSchema>;

export async function readStoreSetup(client: PortalClient, purpose: StoreSetupPurpose, signal: AbortSignal) {
  const guildKey = setupGuild(purpose);
  const directory = DirectorySchema.parse(await client.get('/guilds/directory', {signal}));
  const guild = directory.items.find(item => item.guild_key === guildKey);
  if (!guild) throw new ApiError({message: '目前找不到這項開店資格，請稍後重新確認。', code: 'guild_not_found'});
  let cursor: string | null = null;
  let fallback: ApplicationView | null = null;
  const seen = new Set<string>();
  for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
    const page = ApplicationPageSchema.parse(await client.get(`/applications?guild_key=${encodeURIComponent(guildKey)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, {signal}));
    for (const app of page.items) {
      if (app.application_key !== 'hosted-store') continue;
      fallback ??= app;
      if (app.release_status === 'available' && app.license_state === 'reviewed' && app.runtime_profiles.includes('hosted-reviewed')) return {guild, app};
    }
    cursor = page.next_cursor;
    if (!cursor) return {guild, app: fallback};
    if (seen.has(cursor)) break;
    seen.add(cursor);
  }
  throw new ApiError({message: '開店工具清單尚未完整讀取，請重新確認。', code: 'application_catalog_incomplete'});
}

export function storefrontInstanceLabel(profile: Pick<SupplyCatalogView, 'retail_enabled' | 'setup_state'>) {
  return profile.retail_enabled ? '零售商店' : profile.setup_state === 'ready' ? '純供貨商品庫' : '尚未設定的商品空間';
}
