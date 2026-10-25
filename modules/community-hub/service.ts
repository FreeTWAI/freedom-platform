import {COMMUNITY_GROUPS, type CommunityGroup, type CommunityPlatform} from './groups';
export function groupsByPlatform(groups: readonly CommunityGroup[] = COMMUNITY_GROUPS) {
  return (['LINE','Discord','Facebook'] as const).map(platform => ({platform: platform as CommunityPlatform, groups:groups.filter(group=>group.platform===platform)}));
}
export function pendingLinks(groups: readonly CommunityGroup[] = COMMUNITY_GROUPS) {return groups.filter(group=>group.url===null).length;}
export function isSafeInviteUrl(value: string): boolean {
  try {const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && !url.port && ['line.me','discord.gg','discord.com','facebook.com'].includes(url.hostname);} catch {return false;}
}
