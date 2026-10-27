export type CommunityPlatform = 'LINE' | 'Discord' | 'Facebook';
export type CommunityGroup = {readonly id: string; readonly platform: CommunityPlatform; readonly name: string; readonly status: 'active'; readonly url: string; readonly source: string};
// Original source: communityLinks in Community.tsx. Shared by the footer and hub.
export const communityLinks = [
  { label: 'Discord・自由工坊', url: 'https://discord.gg/MtccYqJxCx' },
  { label: 'LINE・Claude', url: 'https://line.me/ti/g2/DPTQR_XE6IYP8c5lBxsbRwsvEUsxI-70p1jWoA' },
  { label: 'LINE・Codex', url: 'https://line.me/ti/g2/qwiG-IhXAyEBMzVNt6J-I1ryqj6dKhNoyCTr2A' },
  { label: 'LINE・Grok', url: 'https://line.me/ti/g2/83dpd53WEvKWbgDROTV2t0z5hXnNSZTUTq17tg' },
];
const source = 'communityLinks in Community.tsx';
export const COMMUNITY_GROUPS: readonly CommunityGroup[] = [
  {id:'line-claude', platform:'LINE', name:'Claude Code 台灣交流討論區', status:'active', url:communityLinks[1].url, source},
  {id:'line-codex', platform:'LINE', name:'Codex 台灣交流討論區', status:'active', url:communityLinks[2].url, source},
  {id:'line-grok', platform:'LINE', name:'xAI Grok 台灣交流討論區', status:'active', url:communityLinks[3].url, source},
  {id:'discord-freedom', platform:'Discord', name:'自由工坊', status:'active', url:communityLinks[0].url, source},
];
