import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAINLINE_CHAPTERS, validateMainlineDefinition, validateMainlineRun, deriveMainlineStates,
  transitionMainlineTask, selfReportMainlineStage1Done, summarizeMemberMainline,
  type MainlineDefinition, type MainlineRun, type MainlineTaskRecord, type MainlineAction,
} from '../../modules/community/companion-mainline.js';

const definition: MainlineDefinition = {tasks: [
  {id: 'first', chapter: 'week1', prerequisites: []},
  {id: 'second', chapter: 'week2', prerequisites: ['first']},
  {id: 'last', chapter: 'day30', prerequisites: ['second']},
]};
const empty = (): MainlineRun => ({tasks: {}, stage: 'active'});

test('chapter labels and prerequisite graph validation include duplicates, unknown refs and cycles', () => {
  assert.deepEqual(MAINLINE_CHAPTERS.map(c => c.label), ['第1週', '第2週', '第30天']);
  assert.doesNotThrow(() => validateMainlineDefinition(definition));
  for (const tasks of [
    [...definition.tasks, definition.tasks[0]],
    [{id: 'a', chapter: 'week1', prerequisites: ['missing']}],
    [{id: 'a', chapter: 'week1', prerequisites: ['a']}],
    [{id: 'a', chapter: 'week1', prerequisites: ['b', 'b']}, {id: 'b', chapter: 'week2', prerequisites: []}],
    [{id: 'a', chapter: 'week1', prerequisites: ['b']}, {id: 'b', chapter: 'week2', prerequisites: ['a']}],
    [{id: '', chapter: 'week1', prerequisites: []}],
    [{id: 'a', chapter: 'unknown', prerequisites: []}],
  ]) assert.throws(() => validateMainlineDefinition({tasks} as MainlineDefinition));
  // Forward declaration is allowed; array/chapter order is not an unlock condition.
  assert.doesNotThrow(() => validateMainlineDefinition({tasks: [...definition.tasks].reverse()}));
});

test('locked is derived; neither pending reason satisfies prerequisites', () => {
  assert.deepEqual(deriveMainlineStates(definition, empty()), {first: 'available', second: 'locked', last: 'locked'});
  for (const reason of ['submitted', 'waiting'] as const) {
    const run: MainlineRun = {tasks: {first: {state: 'pending', reason}}, stage: 'active'};
    assert.equal(deriveMainlineStates(definition, run).second, 'locked');
  }
  const run: MainlineRun = {tasks: {first: {state: 'done'}}, stage: 'active'};
  assert.equal(deriveMainlineStates(definition, run).second, 'available');
  assert.equal(deriveMainlineStates(definition, run).last, 'locked');
});

test('every state/action pair follows the documented transition table without mutating input', () => {
  const single: MainlineDefinition = {tasks: [definition.tasks[0]]};
  const actions: MainlineAction[] = ['start', 'submit', 'wait', 'resume', 'self_report_done', 'skip'];
  const expected: Record<string, MainlineTaskRecord> = {
    'available/start': {state: 'in_progress'}, 'available/wait': {state: 'pending', reason: 'waiting'},
    'available/skip': {state: 'skipped'}, 'in_progress/submit': {state: 'pending', reason: 'submitted'},
    'in_progress/wait': {state: 'pending', reason: 'waiting'}, 'in_progress/self_report_done': {state: 'done'},
    'in_progress/skip': {state: 'skipped'}, 'pending/resume': {state: 'in_progress'},
    'pending/self_report_done': {state: 'done'}, 'pending/skip': {state: 'skipped'},
  };
  for (const record of [undefined, {state: 'in_progress'}, {state: 'pending', reason: 'submitted'},
    {state: 'pending', reason: 'waiting'}, {state: 'done'}, {state: 'skipped'}] as const) {
    for (const action of actions) {
      const run: MainlineRun = {tasks: record ? {first: record} : {}, stage: 'active'};
      const before = structuredClone(run);
      const next = expected[`${record?.state ?? 'available'}/${action}`];
      if (next) assert.deepEqual(transitionMainlineTask(single, run, 'first', action).tasks.first, next);
      else assert.throws(() => transitionMainlineTask(single, run, 'first', action));
      assert.deepEqual(run, before);
    }
  }
  for (const action of actions) assert.throws(() => transitionMainlineTask(definition, empty(), 'last', action));
  assert.throws(() => transitionMainlineTask(definition, empty(), 'missing', 'start'));
});

test('skipped removes denominator without adding done, penalty or blocking later work', () => {
  const run = transitionMainlineTask(definition, empty(), 'first', 'skip');
  assert.equal(deriveMainlineStates(definition, run).second, 'available');
  const summary = summarizeMemberMainline(definition, run);
  assert.equal(summary.done, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.denominator, 2);
  assert.equal(summary.fraction, 0);
  assert.equal(summary.canSelfReportStage1Done, false);
});

test('stage-1 self-report is separate from percentage and never issues a stage-2 Result candidate', () => {
  let run = empty();
  for (const id of ['first', 'second', 'last']) {
    run = transitionMainlineTask(definition, run, id, 'start');
    run = transitionMainlineTask(definition, run, id, 'self_report_done');
    assert.throws(() => transitionMainlineTask(definition, run, id, 'self_report_done'));
  }
  const summary = summarizeMemberMainline(definition, run);
  assert.equal(summary.fraction, 1);
  assert.equal(summary.stage, 'active');
  assert.equal(summary.canSelfReportStage1Done, true);
  const closed = selfReportMainlineStage1Done(definition, run);
  assert.equal(summarizeMemberMainline(definition, closed).stage, 'stage1_done');
  assert.equal(summarizeMemberMainline(definition, closed).resultCandidate, 'unavailable');
  assert.equal(summary.audience, 'member_only');
  assert.deepEqual(Object.keys(summary).sort(), ['audience', 'done', 'skipped', 'denominator', 'fraction',
    'canSelfReportStage1Done', 'stage', 'resultCandidate'].sort());
  assert.throws(() => selfReportMainlineStage1Done(definition, closed));
  assert.throws(() => transitionMainlineTask(definition, closed, 'last', 'start'));
  assert.equal(run.stage, 'active');
});

test('empty or all-skipped runs never fabricate 100% or stage completion; mixed done/skip can finish', () => {
  assert.equal(summarizeMemberMainline({tasks: []}, empty()).fraction, null);
  assert.throws(() => selfReportMainlineStage1Done({tasks: []}, empty()));
  let skipped = empty();
  for (const id of ['first', 'second', 'last']) skipped = transitionMainlineTask(definition, skipped, id, 'skip');
  assert.equal(summarizeMemberMainline(definition, skipped).fraction, null);
  assert.throws(() => selfReportMainlineStage1Done(definition, skipped));
  const mixed: MainlineRun = {...skipped, tasks: {...skipped.tasks, first: {state: 'done'}}};
  assert.equal(summarizeMemberMainline(definition, mixed).fraction, 1);
  assert.equal(selfReportMainlineStage1Done(definition, mixed).stage, 'stage1_done');
});

test('inconsistent snapshots fail closed', () => {
  for (const run of [
    {tasks: {missing: {state: 'done'}}, stage: 'active'},
    {tasks: {first: {state: 'locked'}}, stage: 'active'},
    {tasks: {first: {state: 'pending'}}, stage: 'active'},
    {tasks: {first: {state: 'pending', reason: 'unknown'}}, stage: 'active'},
    {tasks: {last: {state: 'done'}}, stage: 'active'},
    {tasks: {}, stage: 'stage1_done'}, {tasks: {}, stage: 'unknown'},
  ]) assert.throws(() => validateMainlineRun(definition, run as MainlineRun));
});
