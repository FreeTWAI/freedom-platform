const GUILD_KEY_PATTERN = /^(guild_[a-z0-9_]+|guild_custom_[0-9A-Fa-f]{32})$/;

export function guildKeyFromHash(hash = typeof window === 'undefined' ? '' : window.location.hash): string | null {
  const raw = (hash.startsWith('#') ? hash.slice(1) : hash).split('?')[0];
  const match = /^guilds\/([^/?#]+)(?:\/(?:start|work|skills|information|tools(?:\/[^/?#]+(?:\/[^?#]*)?)?))?$/.exec(raw);
  if (!match) return null;
  let key = match[1];
  try { key = decodeURIComponent(key); } catch { return null; }
  return GUILD_KEY_PATTERN.test(key) ? key : null;
}

export type GuildEntryAction = 'start' | 'work' | 'skills' | 'tools' | 'information';
export function guildActionFromHash(hash: string): GuildEntryAction | undefined {
  if (!guildKeyFromHash(hash)) return undefined;
  const action = hash.split('?')[0].split('/')[2];
  return action as GuildEntryAction | undefined;
}

export function guildToolFromHash(hash:string):string|undefined {
 if(!guildKeyFromHash(hash))return undefined;
 return /^#?guilds\/[^/]+\/tools\/([^/?#]+)/.exec(hash)?.[1];
}
export function guildRoute(key:string,action:GuildEntryAction='start',toolId?:string):string {
 if(!GUILD_KEY_PATTERN.test(key)||toolId&&!/^[a-z0-9-]+$/.test(toolId))throw new Error('invalid_guild_route');
 return `#guilds/${key}/${action}${action==='tools'&&toolId?'/'+toolId:''}`;
}
