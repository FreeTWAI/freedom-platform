/** Navigation only. This protocol never transports a session, private data, or a command. */
export const GUILD_BRIDGE = 'freedom.guild-launchpad/v1';
export const GUILD_ACTIONS = ['work', 'skills', 'tools', 'information'] as const;
export type GuildAction = typeof GUILD_ACTIONS[number];
export type GuildFrameMessage =
  | {protocol: typeof GUILD_BRIDGE; channel: string; guildKey: string; type: 'ready'}
  | {protocol: typeof GUILD_BRIDGE; channel: string; guildKey: string; type: 'navigate'; action: GuildAction}
  | {protocol: typeof GUILD_BRIDGE; channel: string; guildKey: string; type: 'resize'; height: number};

export function readGuildFrameMessage(value: unknown, guildKey: string, channel: string): GuildFrameMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.protocol !== GUILD_BRIDGE || message.guildKey !== guildKey || message.channel !== channel) return null;
  const common = ['protocol', 'channel', 'guildKey', 'type'];
  const fields = message.type === 'navigate' ? [...common, 'action'] : message.type === 'resize' ? [...common, 'height'] : common;
  if (Object.keys(message).length !== fields.length || Object.keys(message).some(key => !fields.includes(key))) return null;
  if (message.type === 'ready') return message as GuildFrameMessage;
  if (message.type === 'navigate' && GUILD_ACTIONS.includes(message.action as GuildAction)) return message as GuildFrameMessage;
  if (message.type === 'resize' && Number.isInteger(message.height) && Number(message.height) >= 240 && Number(message.height) <= 1600) return message as GuildFrameMessage;
  return null;
}
