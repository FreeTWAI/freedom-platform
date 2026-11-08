const GUILD_KEY_PATTERN = /^(guild_[a-z0-9_]+|guild_custom_[0-9A-Fa-f]{32})$/;

export function guildKeyFromHash(hash = typeof window === 'undefined' ? '' : window.location.hash): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = /^guilds\/([^/?#]+)(?:\/(?:start|work|skills|tools|information))?$/.exec(raw);
  if (!match) return null;
  let key = match[1];
  try { key = decodeURIComponent(key); } catch { return null; }
  return GUILD_KEY_PATTERN.test(key) ? key : null;
}

export type GuildEntryAction = 'start' | 'work' | 'skills' | 'tools' | 'information';
export function guildActionFromHash(hash: string): GuildEntryAction | undefined {
  if (!guildKeyFromHash(hash)) return undefined;
  const action = hash.split('/')[2];
  return action as GuildEntryAction | undefined;
}
