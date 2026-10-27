// Device-local quest progress. Same pattern as newcomer-guides/engine/preferences.ts:
// a versioned key, injected storage and defensive parsing. Nothing here is sent to
// the server; progress and medals are not an official record, XP or reward.
import { TESTER_GROUP_IDS, type Localized, type TesterGroupId } from './areas.js';
import { QUEST_PATHS, QUEST_STAGES, QUEST_STEP_IDS, type QuestStage } from './quest.js';

export const TESTER_PROGRESS_KEY = 'freedom-tester-map-progress-v1';
export type TesterProgress = { group: TesterGroupId | null; done: readonly string[] };
type ProgressStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const emptyProgress = (): TesterProgress => ({ group: null, done: [] });

function browserStorage(): ProgressStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

/** Keeps only known step ids, once each, in quest order; anything else becomes empty progress. */
export function normalizeProgress(value: unknown): TesterProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyProgress();
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return emptyProgress();
  const group = typeof record.group === 'string' && (TESTER_GROUP_IDS as readonly string[]).includes(record.group) ? record.group as TesterGroupId : null;
  const marked = new Set(Array.isArray(record.done) ? record.done.filter((id): id is string => typeof id === 'string') : []);
  return { group, done: QUEST_STEP_IDS.filter(id => marked.has(id)) };
}

export function readTesterProgress(storage: Pick<ProgressStorage, 'getItem'> | null = browserStorage()): TesterProgress {
  try { return normalizeProgress(JSON.parse(storage?.getItem(TESTER_PROGRESS_KEY) ?? 'null')); }
  catch { return emptyProgress(); }
}

export function writeTesterProgress(value: TesterProgress, storage: Pick<ProgressStorage, 'setItem'> | null = browserStorage()): void {
  const clean = normalizeProgress({ v: 1, group: value.group, done: value.done });
  try { storage?.setItem(TESTER_PROGRESS_KEY, JSON.stringify({ v: 1, group: clean.group, done: clean.done })); }
  catch { /* Blocked or full storage keeps the in-memory progress usable. */ }
}

export function resetTesterProgress(storage: Pick<ProgressStorage, 'removeItem'> | null = browserStorage()): void {
  try { storage?.removeItem(TESTER_PROGRESS_KEY); }
  catch { /* Nothing else to clear. */ }
}

export function toggleStep(progress: TesterProgress, stepId: string): TesterProgress {
  const done = progress.done.includes(stepId) ? progress.done.filter(id => id !== stepId) : [...progress.done, stepId];
  return normalizeProgress({ v: 1, group: progress.group, done });
}

export function stageProgress(stage: QuestStage, progress: TesterProgress) {
  const done = stage.steps.filter(step => progress.done.includes(step.id)).length;
  return { done, total: stage.steps.length, complete: done === stage.steps.length };
}

export function overallProgress(progress: TesterProgress) {
  return { done: progress.done.length, total: QUEST_STEP_IDS.length };
}

export type MedalId = `stage:${string}` | 'first-step' | 'ten-steps' | 'path' | 'all-stages';
export const MILESTONE_MEDALS: Record<Exclude<MedalId, `stage:${string}`>, { name: Localized; rule: Localized }> = {
  'first-step': {
    name: ['第一步', 'First step', '最初の一歩', '첫걸음', 'Primer paso'],
    rule: ['完成任一步', 'Finish any step', 'どれか1歩を完了', '아무 단계나 완료', 'Termina cualquier paso'],
  },
  'ten-steps': {
    name: ['十步踏查', 'Ten steps', '十歩の踏査', '열 걸음', 'Diez pasos'],
    rule: ['完成 10 步', 'Finish 10 steps', '10歩を完了', '10단계 완료', 'Termina 10 pasos'],
  },
  path: {
    name: ['路線完成', 'Path complete', 'ルート達成', '경로 완료', 'Ruta completada'],
    rule: ['完成所選小組的建議路線', 'Finish the suggested path for your group', '選んだグループのおすすめルートを完了', '선택한 그룹의 추천 경로 완료', 'Termina la ruta sugerida de tu grupo'],
  },
  'all-stages': {
    name: ['全圖踏查', 'Whole map explored', '全域踏査', '전체 지도 탐험', 'Mapa completo'],
    rule: ['完成所有關卡', 'Finish every stage', 'すべての関を完了', '모든 단계 완료', 'Termina todas las etapas'],
  },
};

/** Every medal, earned or not, in display order. Derived only from local progress. */
export function testerMedals(progress: TesterProgress): { id: MedalId; name: Localized; rule?: Localized; stage?: QuestStage; earned: boolean }[] {
  const complete = (stageId: string) => {
    const stage = QUEST_STAGES.find(item => item.id === stageId);
    return stage ? stageProgress(stage, progress).complete : false;
  };
  const milestone = (id: keyof typeof MILESTONE_MEDALS, earned: boolean) => ({ id, ...MILESTONE_MEDALS[id], earned });
  return [
    milestone('first-step', progress.done.length >= 1),
    milestone('ten-steps', progress.done.length >= 10),
    ...QUEST_STAGES.map(stage => ({ id: `stage:${stage.id}` as const, name: stage.medal, stage, earned: complete(stage.id) })),
    milestone('path', progress.group !== null && QUEST_PATHS[progress.group].every(complete)),
    milestone('all-stages', progress.done.length === QUEST_STEP_IDS.length),
  ];
}
