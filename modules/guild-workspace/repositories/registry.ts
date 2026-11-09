import entries from './registry.json';

export type GuildRepository = {guild_key: string; name: string; repository: string};
/** Reviewed first-party bindings; user supplied slugs and launchpad drafts cannot select executable code. */
export const guildRepositories: readonly GuildRepository[] = entries;
export function guildRepository(guildKey: string): GuildRepository | null {
  return guildRepositories.find(entry => entry.guild_key === guildKey) ?? null;
}
export function guildRepositorySite(entry: GuildRepository): string {
  return `https://freetwai.github.io/${entry.repository}/`;
}
