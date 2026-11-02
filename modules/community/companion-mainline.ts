/** #1066 stage-1 policy only. No persistence, authorization, matching or Result issuance. */
export const MAINLINE_CHAPTERS = [
  {id: 'week1', label: '第1週'},
  {id: 'week2', label: '第2週'},
  {id: 'day30', label: '第30天'},
] as const;
export type MainlineChapter = typeof MAINLINE_CHAPTERS[number]['id'];
export type MainlineTaskState = 'locked' | 'available' | 'pending' | 'in_progress' | 'done' | 'skipped';
export interface MainlineTask {
  readonly id: string;
  readonly chapter: MainlineChapter;
  readonly prerequisites: readonly string[];
}
export interface MainlineDefinition { readonly tasks: readonly MainlineTask[] }
/** Missing entry means untouched; locked/available are never stored. */
export type MainlineTaskRecord =
  | {readonly state: 'in_progress' | 'done' | 'skipped'}
  | {readonly state: 'pending'; readonly reason: 'submitted' | 'waiting'};
export interface MainlineRun {
  readonly tasks: Readonly<Record<string, MainlineTaskRecord>>;
  readonly stage: 'active' | 'stage1_done';
}
export type MainlineAction = 'start' | 'submit' | 'wait' | 'resume' | 'self_report_done' | 'skip';
export interface MemberMainlineProgress {
  readonly audience: 'member_only';
  readonly done: number;
  readonly skipped: number;
  readonly denominator: number;
  /** null means no non-skipped tasks; never display that as 100%. */
  readonly fraction: number | null;
  readonly canSelfReportStage1Done: boolean;
  readonly stage: MainlineRun['stage'];
  readonly resultCandidate: 'unavailable';
}

function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
}

/** Reject malformed catalogs, duplicate IDs/refs, unknown refs and cycles (including self loops). */
export function validateMainlineDefinition(definition: MainlineDefinition): void {
  check(object(definition) && Array.isArray(definition.tasks), 'invalid_definition');
  const tasks = new Map<string, MainlineTask>();
  for (const task of definition.tasks) {
    check(object(task) && validId(task.id) && MAINLINE_CHAPTERS.some(c => c.id === task.chapter)
      && Array.isArray(task.prerequisites) && task.prerequisites.every(validId), 'invalid_task');
    check(!tasks.has(task.id), 'duplicate_task');
    check(new Set(task.prerequisites).size === task.prerequisites.length, 'duplicate_prerequisite');
    tasks.set(task.id, {id: task.id, chapter: task.chapter as MainlineChapter, prerequisites: task.prerequisites});
  }
  for (const task of tasks.values()) {
    for (const ref of task.prerequisites) check(tasks.has(ref), 'unknown_prerequisite');
  }
  // Kahn traversal avoids a recursive call-stack limit for long valid chains.
  const remaining = new Map([...tasks].map(([id, task]) => [id, task.prerequisites.length]));
  const dependents = new Map<string, string[]>();
  for (const task of tasks.values()) for (const ref of task.prerequisites) {
    const list = dependents.get(ref) ?? [];
    list.push(task.id);
    dependents.set(ref, list);
  }
  const queue = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
  for (let i = 0; i < queue.length; i++) for (const id of dependents.get(queue[i]) ?? []) {
    const count = remaining.get(id)! - 1;
    remaining.set(id, count);
    if (count === 0) queue.push(id);
  }
  check(queue.length === tasks.size, 'prerequisite_cycle');
}

function satisfied(record: MainlineTaskRecord | undefined): boolean {
  return record?.state === 'done' || record?.state === 'skipped';
}
function prerequisitesMet(task: MainlineTask, run: MainlineRun): boolean {
  return task.prerequisites.every(id => Object.hasOwn(run.tasks, id) && satisfied(run.tasks[id]));
}
function eligible(definition: MainlineDefinition, run: MainlineRun): boolean {
  return definition.tasks.some(task => run.tasks[task.id]?.state === 'done')
    && definition.tasks.every(task => satisfied(run.tasks[task.id]));
}

/** This is consistency validation, never an ACL or proof of human identity. */
export function validateMainlineRun(definition: MainlineDefinition, run: MainlineRun): void {
  validateMainlineDefinition(definition);
  check(object(run) && object(run.tasks) && (run.stage === 'active' || run.stage === 'stage1_done'), 'invalid_run');
  const tasks = new Map(definition.tasks.map(task => [task.id, task]));
  for (const [id, record] of Object.entries(run.tasks)) {
    const task = tasks.get(id);
    check(task, 'unknown_task');
    check(object(record) && ['in_progress', 'pending', 'done', 'skipped'].includes(record.state), 'invalid_task_record');
    check(record.state !== 'pending' || record.reason === 'submitted' || record.reason === 'waiting', 'invalid_pending_reason');
    check(prerequisitesMet(task, run), 'unmet_prerequisites');
  }
  check(run.stage !== 'stage1_done' || eligible(definition, run), 'invalid_stage1_done');
}

export function deriveMainlineStates(definition: MainlineDefinition, run: MainlineRun): Readonly<Record<string, MainlineTaskState>> {
  validateMainlineRun(definition, run);
  return Object.fromEntries(definition.tasks.map(task => [task.id,
    Object.hasOwn(run.tasks, task.id) ? run.tasks[task.id].state
      : prerequisitesMet(task, run) ? 'available' : 'locked']));
}

/** Caller supplies the member's explicit choice. Does not authorize an HTTP caller. */
export function transitionMainlineTask(
  definition: MainlineDefinition, run: MainlineRun, taskId: string, action: MainlineAction,
): MainlineRun {
  const states = deriveMainlineStates(definition, run);
  check(Object.hasOwn(states, taskId), 'unknown_task');
  const state = states[taskId];
  check(run.stage === 'active', 'stage1_closed');
  let next: MainlineTaskRecord | undefined;
  if (state === 'available' && action === 'start') next = {state: 'in_progress'};
  if (state === 'in_progress' && action === 'submit') next = {state: 'pending', reason: 'submitted'};
  if ((state === 'available' || state === 'in_progress') && action === 'wait') next = {state: 'pending', reason: 'waiting'};
  if (state === 'pending' && action === 'resume') next = {state: 'in_progress'};
  if ((state === 'in_progress' || state === 'pending') && action === 'self_report_done') next = {state: 'done'};
  if (['available', 'in_progress', 'pending'].includes(state) && action === 'skip') next = {state: 'skipped'};
  check(next, 'invalid_transition');
  return {...run, tasks: {...run.tasks, [taskId]: next}};
}

/** Explicit member self-report, separate from task completion and any future Result candidate. */
export function selfReportMainlineStage1Done(definition: MainlineDefinition, run: MainlineRun): MainlineRun {
  validateMainlineRun(definition, run);
  check(run.stage === 'active' && eligible(definition, run), 'stage1_not_ready');
  return {...run, stage: 'stage1_done'};
}

/** Only one's own tasks are accepted. Help/stuck data is deliberately absent from this projection. */
export function summarizeMemberMainline(definition: MainlineDefinition, run: MainlineRun): MemberMainlineProgress {
  const states = Object.values(deriveMainlineStates(definition, run));
  const done = states.filter(state => state === 'done').length;
  const skipped = states.filter(state => state === 'skipped').length;
  const denominator = states.length - skipped;
  return {audience: 'member_only', done, skipped, denominator,
    fraction: denominator === 0 ? null : done / denominator,
    canSelfReportStage1Done: run.stage === 'active' && eligible(definition, run),
    stage: run.stage, resultCandidate: 'unavailable'};
}
