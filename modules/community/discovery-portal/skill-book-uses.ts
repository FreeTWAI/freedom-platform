/** Content/technical uses are independent of beginner.category (business purposes).
 * Explicit catalog-ID mappings grounded in the named guides below; never classify
 * titles, descriptions, repositories or member submissions by keywords.
 * This is a bounded first set, not an exhaustive classification of the catalog.
 */
export const skillBookUses = ['文字','圖片','影片','語音','系統架構'] as const;
export type SkillBookUse = typeof skillBookUses[number];
export const skillBookUseMap: Readonly<Record<string, readonly SkillBookUse[]>> = {
  // skill-book-guides.ts: post writing; MV planning; platform protocol integration.
  'social-post': ['文字'],
  'music-mv': ['影片'],
  'agent-kit': ['系統架構'],
  // community-author-skills.ts: explicit input/output and architecture in each guide.
  'ai-manga-translator': ['文字','圖片'],
  'photo-border-remover': ['圖片'],
  'video-to-podcast-toolkit': ['文字','圖片','影片','語音'],
  'gemini-voice-lab': ['語音'],
  'ai-avatar-bot': ['語音'],
  'story-bible': ['文字'],
  'coding-audit-harness': ['系統架構'],
};
export function matchesSkillBookUse(bookId: string | undefined, use: string) {
  return !use || (bookId !== undefined && Object.hasOwn(skillBookUseMap, bookId)
    && skillBookUseMap[bookId].some(value => value === use));
}
