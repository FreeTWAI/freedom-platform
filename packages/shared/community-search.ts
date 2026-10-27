import { z } from 'zod';

export const communitySearchTopics = ['intro', 'showcase', 'help', 'tools', 'gathering'] as const;
export const communitySearchKinds = ['post', 'work', 'skill_book', 'event'] as const;
export const communitySearchTopicLabels: Record<typeof communitySearchTopics[number], string> = {
  intro: '入門教學', showcase: '設計作品', help: '求助問答', tools: '工具資源', gathering: '社群交流',
};
export const communitySearchKindLabels: Record<typeof communitySearchKinds[number], string> = {
  post: '貼文', work: '作品', skill_book: '技能書', event: '活動',
};

export const communitySearchItemSchema = z.object({
  kind: z.enum(communitySearchKinds),
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  path: z.string(),
  label: z.string().nullable(),
  author_id: z.string().uuid().nullable(),
  media_path: z.string().nullable(),
  topics: z.array(z.enum(communitySearchTopics)),
}).strict();
export const communitySearchPageSchema = z.object({
  items: z.array(communitySearchItemSchema),
  next_cursor: z.string().nullable(),
  operation_id: z.string().optional(),
}).strict();
export type CommunitySearchPage = z.infer<typeof communitySearchPageSchema>;

// Member directory projection only. Guilds are not content-topic, bookmark or
// participation-metric kinds, and never enter CommunitySearchPage.items.
export const guildSearchItemSchema = z.object({
  kind: z.literal('guild'),
  guild_key: z.string().max(120).regex(/^(guild_[a-z0-9_]+|guild_custom_[0-9A-Fa-f]{32})$/),
  name: z.string(),
  purpose: z.string().max(1000), // SQL excerpt: at most 500 Unicode code points.
  path: z.string(),
}).strict().refine(item => item.path === `#guilds/${item.guild_key}`);
export const guildSearchPageSchema = z.object({
  items: z.array(guildSearchItemSchema).max(20),
  next_cursor: z.string().max(512).nullable(),
}).strict();
export type GuildSearchPage = z.infer<typeof guildSearchPageSchema>;
