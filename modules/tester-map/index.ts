// Public module entry. Keep internal implementation imports inside this module.
export {
  ISSUES_URL, REDESIGN_BATCH_PR, TEST_WEEK, TESTER_AREAS, TESTER_FLAGS, TESTER_FLAGS_OBSERVED_AT,
  TESTER_GROUP_IDS, TESTER_GROUPS, TESTER_GUILD, TESTER_NON_FEATURE_SITE_FIELDS,
} from './areas.js';
export type { Localized, TesterAccess, TesterArea, TesterFeature, TesterFlag, TesterGroupId } from './areas.js';
export { COVERAGE_STATUSES, TESTER_COVERAGE, TESTER_COVERAGE_UPDATED_AT } from './coverage.js';
export type { CoverageEntry, CoverageStatus } from './coverage.js';
export { areasForGroup, coverageOf, coverageSummary, isDefaultOff, validateTesterMap } from './service.js';
export { FEATURE_SEARCH_EXAMPLES, QUEST_PATHS, QUEST_STAGES, QUEST_STEP_IDS } from './quest.js';
export type { QuestStage, QuestStep } from './quest.js';
export {
  MILESTONE_MEDALS, TESTER_PROGRESS_KEY, emptyProgress, normalizeProgress, overallProgress, readTesterProgress,
  resetTesterProgress, stageProgress, testerMedals, toggleStep, writeTesterProgress,
} from './progress.js';
export type { MedalId, TesterProgress } from './progress.js';

export {mergeTesterProgress,aggregateTesterFeedback,TESTER_NOTE_LIMIT} from './account.js';
export type {TesterAccountView,TesterFeedback,TesterFeatureReport} from './account.js';
