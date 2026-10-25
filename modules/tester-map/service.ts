// Pure checks and summaries over the static test plan. No route, database
// connection, feature flag or permission is created or read here.
import { TESTER_AREAS, TESTER_FLAGS, TESTER_GROUP_IDS, type TesterArea, type TesterFeature, type TesterGroupId } from './areas.js';
import { COVERAGE_STATUSES, TESTER_COVERAGE, type CoverageEntry, type CoverageStatus } from './coverage.js';

/** Off on the observed public site; the code default for every listed flag is off. */
export function isDefaultOff(feature: TesterFeature): boolean {
  return feature.flag !== undefined && TESTER_FLAGS[feature.flag] === 'off';
}

export function coverageOf(featureId: string, coverage: Readonly<Record<string, CoverageEntry>> = TESTER_COVERAGE): CoverageEntry {
  return Object.hasOwn(coverage, featureId) ? coverage[featureId] : { status: '未測' };
}

export function coverageSummary(areas: readonly TesterArea[] = TESTER_AREAS, coverage: Readonly<Record<string, CoverageEntry>> = TESTER_COVERAGE): Record<CoverageStatus, number> {
  const counts = Object.fromEntries(COVERAGE_STATUSES.map(status => [status, 0])) as Record<CoverageStatus, number>;
  for (const area of areas) for (const feature of area.features) counts[coverageOf(feature.id, coverage).status]++;
  return counts;
}

export function areasForGroup(group: TesterGroupId | 'all', areas: readonly TesterArea[] = TESTER_AREAS): readonly TesterArea[] {
  return group === 'all' ? areas : areas.filter(area => area.owners.includes(group));
}

/** Returns every problem instead of throwing, so one PR review sees all of them. */
export function validateTesterMap(areas: readonly TesterArea[] = TESTER_AREAS, coverage: Readonly<Record<string, unknown>> = TESTER_COVERAGE): string[] {
  const problems: string[] = [], areaIds = new Set<string>(), featureIds = new Set<string>();
  const statuses: readonly string[] = COVERAGE_STATUSES, groups: readonly string[] = TESTER_GROUP_IDS;
  for (const area of areas) {
    if (areaIds.has(area.id)) problems.push(`duplicate_area:${area.id}`);
    areaIds.add(area.id);
    if (area.owners.length === 0) problems.push(`area_without_owner:${area.id}`);
    for (const owner of area.owners) if (!groups.includes(owner)) problems.push(`unknown_owner:${area.id}:${owner}`);
    if (area.features.length === 0) problems.push(`area_without_features:${area.id}`);
    for (const feature of area.features) {
      if (featureIds.has(feature.id)) problems.push(`duplicate_feature:${feature.id}`);
      featureIds.add(feature.id);
      if (feature.name.some(text => !text.trim())) problems.push(`untranslated_feature:${feature.id}`);
      if (feature.flag !== undefined && !Object.hasOwn(TESTER_FLAGS, feature.flag)) problems.push(`unknown_flag:${feature.id}`);
      const entry = coverage[feature.id];
      if (entry === undefined) { problems.push(`missing_coverage:${feature.id}`); continue; }
      const { status, issues } = (entry ?? {}) as { status?: unknown; issues?: unknown };
      if (typeof status !== 'string' || !statuses.includes(status)) problems.push(`invalid_status:${feature.id}`);
      if (issues !== undefined && (!Array.isArray(issues) || issues.some(number => !Number.isSafeInteger(number) || number <= 0))) problems.push(`invalid_issues:${feature.id}`);
      if (status === '有問題' && (!Array.isArray(issues) || issues.length === 0)) problems.push(`problem_without_issue:${feature.id}`);
    }
  }
  for (const id of Object.keys(coverage)) if (!featureIds.has(id)) problems.push(`unknown_coverage:${id}`);
  return problems;
}
