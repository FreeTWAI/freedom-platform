import { validSkillPageContent, type SkillPageContent } from '../community/skill-page-content.js';
import { skillPageFlow, skillPageHero, skillPageUsage } from '../development/skill-page.js';

export type SubmissionPageSource = {
  title: string; description: string; use_notes: string; page_content?: SkillPageContent | null;
};

/** Public pages and the private preview share this escaped, programmatic layout. */
export function submissionPageMarkup(source: SubmissionPageSource, options: { coverUrl?: string | null; actions?: string } = {}) {
  const content = validSkillPageContent(source.page_content) ? source.page_content : null;
  const hero = skillPageHero({
    title: source.title, kind: '社群技能書', category: '會員分享', format: '原作工具',
    purpose: source.description, coverUrl: options.coverUrl, content,
    actions: options.actions ?? '<a href="#skill-start">開始使用</a>', credit: '', badges: '',
  });
  // Legacy prose stays whole. Missing structured claims are never inferred from
  // a title, repository slug, cover or the fact that the work was published.
  const usage = skillPageUsage({
    format: '原作工具', audience: [], features: [], prerequisites: [],
    first_steps: source.use_notes ? [source.use_notes] : [],
    first_result: '', status: '', reviewed_at: '',
  }, content?.flow.lead);
  return hero + (content ? skillPageFlow(content) : '') + usage;
}
