// Shared, browser-safe policy. Self reports never award XP or public titles.
import {z} from 'zod';
import {TESTER_FEATURE_MODULES} from './ownership.js';
import {QUEST_STAGES, QUEST_STEP_IDS} from './quest.js';
import {normalizeProgress, type TesterProgress} from './progress.js';

export const TESTER_NOTE_LIMIT = 200;
export const testerStepSchema = z.string().refine(id => QUEST_STEP_IDS.includes(id), 'Unknown tester step');
export const testerNoteSchema = z.string().max(TESTER_NOTE_LIMIT)
  .refine(note => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(note), 'Use one line of plain text').transform(note => note.trim());
const progressFields = {group: z.enum(['A','B','C','D','E']).nullable(), done: z.array(testerStepSchema).max(QUEST_STEP_IDS.length)};
export const testerCommandSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('merge'), ...progressFields}).strict(),
  z.object({action: z.literal('progress'), ...progressFields}).strict(),
  z.object({action: z.literal('feedback'), step_id: testerStepSchema, result: z.enum(['pass','problem']), note: testerNoteSchema.default('')}).strict(),
  z.object({action: z.literal('clear')}).strict(),
]);
export type TesterCommand = z.infer<typeof testerCommandSchema>;
export const testerTriageSchema = z.object({feedback_id:z.uuid(),status:z.enum(['seen','issue','fixed']),issue_number:z.number().int().positive().max(2147483647).nullable().default(null)}).strict().refine(value => value.status !== 'issue' || value.issue_number !== null, 'Issue number required');
export type TesterTriageStatus = 'sent'|'seen'|'issue'|'fixed';
export type TesterReportItem = {feedback_id:string;result:'pass'|'problem';note:string;status:TesterTriageStatus;issue_number:number|null;updated_at:string};
export type TesterStepReport = {step_id:string;passed:number;problems:number;items:TesterReportItem[]};
export type TesterModuleReport = {module_id:string;features:TesterFeatureReport[]};
export type TesterFeedback = {step_id: string; result: 'pass'|'problem'; note: string; updated_at: string; status?: TesterTriageStatus; issue_number?:number|null};
export type TesterAccountView = {version: string; progress: TesterProgress; feedback: TesterFeedback[]; can_report: boolean};
export type TesterFeatureReport = {module_id?:string;steps?:TesterStepReport[];feature_id: string; testers: number; passed: number; pass_rate: number|null; issues: {step_id: string; note: string; updated_at: string}[]};
export function mergeTesterProgress(account: TesterProgress, local: TesterProgress): TesterProgress {
  return normalizeProgress({v: 1, group: account.group ?? local.group, done: [...account.done, ...local.done]});
}
export const testerFeatureSteps = QUEST_STAGES.flatMap(stage => stage.steps.flatMap(step => step.features.map(feature_id => ({feature_id, module_id:TESTER_FEATURE_MODULES[feature_id], step_id: step.id}))));

/** A tester is counted once per feature; any current problem makes their feature result a problem. */
export function aggregateTesterFeedback(rows: (TesterFeedback & {user_id: string})[]): TesterFeatureReport[] {
  const latest = new Map<string, TesterFeedback & {user_id: string}>();
  for (const row of rows) {
    const key = `${row.user_id}/${row.step_id}`, prior = latest.get(key);
    if (!prior || row.updated_at > prior.updated_at) latest.set(key, row);
  }
  const ids = [...new Set(testerFeatureSteps.map(item => item.feature_id))];
  return ids.map(feature_id => {
    const steps = new Set(testerFeatureSteps.filter(item => item.feature_id === feature_id).map(item => item.step_id));
    const feedback = [...latest.values()].filter(row => steps.has(row.step_id));
    const testers = new Map<string, boolean>();
    for (const row of feedback) testers.set(row.user_id, (testers.get(row.user_id) ?? true) && row.result === 'pass');
    const passed = [...testers.values()].filter(Boolean).length;
    return {feature_id, testers: testers.size, passed, pass_rate: testers.size ? passed / testers.size : null,
      issues: feedback.filter(row => row.result === 'problem').sort((a,b) => b.updated_at.localeCompare(a.updated_at) || a.step_id.localeCompare(b.step_id)).slice(0,5)
        .map(({step_id,note,updated_at}) => ({step_id,note,updated_at}))};
  });
}
