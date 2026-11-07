import { SKILL_FLOW_ICONS, type SkillFlow } from '../development/skill-flow.js';

/** Owner-only, bounded form values. Incomplete content is never a public page. */
export type SkillPageDraft = { headline: string; problem: string; mechanism: string; outcomes: string; flow: SkillFlow };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown, max: number) => typeof value === 'string' && [...value].length <= max;
export function validSkillPageDraft(value: unknown): value is SkillPageDraft {
  if (!object(value) || !keys(value, ['headline', 'problem', 'mechanism', 'outcomes', 'flow'])
    || !text(value.headline, 30) || !text(value.problem, 100) || !text(value.mechanism, 160) || !text(value.outcomes, 92)) return false;
  const flow = value.flow;
  return object(flow) && keys(flow, ['title', 'lead', 'steps', 'caption', 'loop'])
    && text(flow.title, 24) && text(flow.lead, 100) && text(flow.caption, 90)
    && (flow.loop === undefined || typeof flow.loop === 'boolean')
    && Array.isArray(flow.steps) && flow.steps.length === 3 && flow.steps.every(step => object(step)
      && keys(step, ['icon', 'title', 'note']) && typeof step.icon === 'string' && Object.hasOwn(SKILL_FLOW_ICONS, step.icon)
      && text(step.title, 14) && text(step.note, 60));
}
