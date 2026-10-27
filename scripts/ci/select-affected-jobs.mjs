// Conservative job selection for .github/workflows/verify.yml.
// Operator-only changes use existing deploy and integrity coverage on PR/main.
// Other pull requests narrow through docs, frontend leaf, guild presentation
// or minimal profiles. An ordinary modification of the exact root
// README may use docs mode; its mandatory context role remains unchanged.
// Leaf edits retain all runtime/browser/static
// jobs and require unchanged, compatible baseline/candidate descriptor graphs.
// The exact generated inventory manifest may accompany qualifying edits; owning that one metadata file does not widen the decision, and the file
// is not itself an allowlisted document. source-integrity verifies immutable migrations and local links; main archives
// generate and restore a complete inventory. Rename, delete, copy, mode change, unknown paths,
// merge_group, push, and other governance, security, or shared-runtime paths keep
// every selectable job. The aggregate accepts a skip only for a job this
// decision left unselected; failure and cancellation do not pass.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isAbsolute, resolve, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectImpact, validateDescriptor, isModuleDescriptorPath, ROOT_INSTRUCTIONS, owns } from '../../packages/contribution-tools/context.mjs';
import { artifactPath, parseJson } from '../../packages/contribution-tools/io.mjs';
import { verificationEnvironment } from '../../packages/contribution-tools/process-env.mjs';
import { GUIDE_COMPOSITION_PROFILE } from '../../packages/contribution-tools/pinned-e2e.mjs';
import { GUILD_PRESENTATION_PROFILE, guildPresentationPath, guildPresentationDependenciesProven, loadGuildPresentationParsers } from '../../packages/contribution-tools/guild-presentation-profile.mjs';
import { runtimeTextSources } from '../generate-runtime-text.mjs';

export const SELECTABLE_JOBS = Object.freeze([
  'runtime-full', 'runtime-aggregate', 'ui-e2e', 'static-worker', 'governance-consumers', 'deploy-preflight', 'guild-presentation',
]);
// Every selectable job must report a result, including an intentional docs skip.
// Keep one list so a selected check cannot disappear from aggregate validation.
export const REQUIRED_SELECTED_JOBS = SELECTABLE_JOBS;
export const JOB_OUTPUT_KEYS = Object.freeze({
  'runtime-full': 'runtime_full',
  'runtime-aggregate': 'runtime_aggregate',
  'ui-e2e': 'ui_e2e',
  'static-worker': 'static_worker',
  'governance-consumers': 'governance_consumers',
  'deploy-preflight': 'deploy_preflight',
  'guild-presentation': 'guild_presentation',
});
export const ALWAYS_ON_INTEGRITY_COMMANDS = Object.freeze([
  'npm run contracts:build',
  'git diff --exit-code -- contracts/preview/v1 packages/sdk',
  'npm run check:runtime-text',
  'python .freedom/trusted/scripts/ci/verify-source-boundaries.py',
  'python .freedom/trusted/scripts/ci/test_source_boundaries.py',
  'node .freedom/trusted/scripts/ci/run-pinned-suite.mjs --root . --suite ci.selector-unit',
  'node .freedom/trusted/scripts/ci/run-pinned-suite.mjs --root . --suite ci.governance-unit',
]);
export const DOCS_ALLOWLIST_PREFIXES = Object.freeze([
  'docs/development/', 'docs/design/', 'docs/plans/', 'docs/releases/',
]);
// Historical snapshot; CI and main source archives use Git objects. The exact
// legacy manifest may still accompany otherwise qualifying changes.
export const GENERATED_INVENTORY_PATH = 'docs/platform-plan/verification/2026-09-20-file-inventory.json';

// These profiles select existing jobs only. Consumer evidence and exclusions are
// documented in affected-jobs.md; ownership metadata alone does not execute docs.
export const MINIMAL_JOB_PROFILES = Object.freeze({
  plan_receipt_docs: Object.freeze([]),
  plan_document_inputs: Object.freeze(['governance-consumers']),
  module_app_markdown: Object.freeze([]),
});
const minimalJobs = reason => Object.hasOwn(MINIMAL_JOB_PROFILES, reason) ? MINIMAL_JOB_PROFILES[reason] : null;
const PLAN_INPUTS = new Set([
  'execution/unified-foundation/current-state.json',
  'execution/first-work-batch.md', 'execution/acceptance-matrix.md',
  'execution/milestones.md', 'execution/spec-index.md',
].map(path => 'docs/platform-plan/' + path));
const MODULE_MARKDOWN_INPUTS = new Set([
  'modules/agent-commerce/operations/notifications/README.md',
  'modules/module-registry/platform-hold.md',
]);
function planDocument(path) {
  return path.startsWith('docs/platform-plan/') && /\.(?:md|json|yaml|yml|csv|txt)$/.test(path)
    && !(path.startsWith('docs/platform-plan/contracts/') && !path.endsWith('.md'))
    && !path.startsWith('docs/platform-plan/contracts/tests/')
    && !path.startsWith('docs/platform-plan/execution/tools/')
    && !hiddenSegment(path) && !path.endsWith('/AGENTS.md');
}
function planInput(path) {
  return PLAN_INPUTS.has(path) || path.startsWith('docs/platform-plan/execution/specs/')
    || path.startsWith('docs/platform-plan/execution/guild-launchpad/');
}
export function decideMinimalProfile(input) {
  const fallback = {profile: 'full', reason: 'outside_minimal_profiles'};
  if (input?.event !== 'pull_request' || input.diffComplete !== true
    || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > CHANGE_LIMIT
    || input.nonExecutableBlobsProven === false || input.descriptorsProven === false
    || !input.baseline?.length || !input.candidate?.length) return fallback;
  const paths = input.changes.map(change => change?.path);
  if (new Set(paths).size !== paths.length || input.changes.some(change => statusReason(change)
    || !safeRepoPath(change.path))) return fallback;
  try { for (const graph of [input.baseline, input.candidate]) validatedDescriptorGraph(graph); }
  catch { return fallback; }
  let reason;
  if (paths.every(planDocument)) reason = paths.some(planInput) ? 'plan_document_inputs' : 'plan_receipt_docs';
  else if (paths.every(path => /^(?:modules|apps)\/.+\.md$/.test(path) && !hiddenSegment(path)
    && !path.endsWith('/AGENTS.md') && !RUNTIME_TEXT.has(path) && !MODULE_MARKDOWN_INPUTS.has(path)
    && !guildPresentationPath(path))) reason = 'module_app_markdown';
  return reason ? {profile: reason, reason} : fallback;
}

// Host-owned paths and expected module obligations, never a candidate glob or
// executable command. New files, public sharing/auth helpers, guide contracts,
// gates, content/release pins and unlisted frontend paths retain full selection.
export const FRONTEND_LEAF_PROFILES = Object.freeze([
  Object.freeze({ module: 'member-card', dependencies: Object.freeze(['command-core']), tests: Object.freeze(['runtime.member-card']),
    paths: Object.freeze(['MemberECard.tsx', 'MemberECard.css', 'MemberEditorialCard.css', 'MemberCardDownload.tsx', 'MemberCardQr.tsx']
      .map(path => 'apps/portal-web/src/modules/' + path)) }),
  Object.freeze({ module: 'newcomer-guides', dependencies: Object.freeze(['public-guide-assets']), tests: Object.freeze(['runtime.full']),
    paths: Object.freeze(['GuideHost.tsx', 'engine/GuideEngine.tsx', 'engine/GuideGallery.tsx', 'engine/page-spirit.css']
      .map(path => 'apps/portal-web/src/modules/newcomer-guides/' + path)) }),
]);
export const FRONTEND_LEAF_JOBS = Object.freeze(['runtime-full', 'runtime-aggregate', 'ui-e2e', 'static-worker']);
const leafProfile = path => FRONTEND_LEAF_PROFILES.find(profile => profile.paths.includes(path));
const sameSet = (a, b) => { const right = [...b].sort(); return a.length === b.length && [...a].sort().every((value, index) => value === right[index]); };

const TREE_PATH_LIMIT = 16384;
const DESCRIPTOR_LIMIT = 256;
const CHANGE_LIMIT = 4096;
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const SHA = /^[0-9a-f]{40}$/;
const EVENT = /^[a-z_]{1,40}$/;
const PR_NUMBER = /^[1-9][0-9]{0,8}$/;
const RUNTIME_TEXT = new Set(Object.values(runtimeTextSources));
const BANNED_SEGMENTS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'fixture', 'fixtures', '__fixtures__']);
const CODE_OR_CONFIG = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts|py|sh|bash|ps1|sql|ya?ml|jsonc?|toml|ini|lock|wasm|env|rb|php|pl|exe)$/i;
const TEST_OR_SPEC_NAME = /(?:^|[._-])(?:test|spec)(?:[._-]|$)/i;
const FULL_SCOPE = Object.freeze([
  '.github/', 'governance/', 'packages/contribution-tools/', 'scripts/ci/', 'scripts/runtime-full.mjs',
  'scripts/runtime-aggregate.mjs', 'docs/platform-plan/', 'contracts/', 'deploy/', 'migrations/', 'packages/db/',
  'packages/shared/', 'packages/testing/', 'tests/runtime/', 'packages/contribution-tools/suite-runner.mjs',
  'apps/credential-broker/', 'modules/identity-membership/', 'modules/platform-admin/',
  'apps/platform-api/src/worker-private-ai.ts',
]);
const REASON_PRIORITY = Object.freeze([
  'deleted_path', 'renamed_or_copied_path', 'untrusted_change_status', 'unknown_path', 'root_instruction',
  'governance_security_or_shared_runtime', 'excluded_test_spec_or_config', 'not_docs_allowlist',
]);

export function heavyJobCondition(outputKey) {
  return `!cancelled() && (needs.select.result != 'success' || needs.select.outputs.${outputKey} == 'true')`;
}

export const GUILD_PRESENTATION_JOBS = Object.freeze(['guild-presentation', 'static-worker']);
export const DELIVERY_TOOLING_JOBS = Object.freeze(['deploy-preflight']);
const DELIVERY_TOOLING_REASON = 'delivery_tooling';
// These operator-only files are covered by deploy-preflight/native restore;
// selector/workflow controls are covered by the always-on selector/governance
// suites and code-owner review. No product path or module declaration qualifies.
const DELIVERY_FILES = new Set([
  '.github/workflows/shared-release.yml', '.github/workflows/shared-backup.yml',
  '.github/workflows/release-operator-image.yml', '.github/workflows/verify.yml',
  'scripts/ci/select-affected-jobs.mjs', 'scripts/ci/select-affected-jobs.test.mjs',
  'scripts/ci/affected-jobs.md', 'deploy/cloudflare/test/shared-release.test.mjs',
  'deploy/cloudflare/test/media-restore-container.test.mjs',
  'packages/media-migration/backup-daily.ts', 'packages/media-migration/backup-diagnostics.ts',
  'tests/runtime/media-backup-daily.test.ts',
  'packages/contribution-tools/pinned-suites.mjs', 'packages/contribution-tools/test/pinned-suite.test.mjs',
]);
function deliveryOwner(path) {
  if (isModuleDescriptorPath(path)) return null;
  if (!DELIVERY_FILES.has(path) && !path.startsWith('deploy/shared-release/')) return null;
  if (path.startsWith('packages/media-migration/') || path.startsWith('tests/runtime/')
    || path === 'deploy/cloudflare/test/media-restore-container.test.mjs') return 'media-migration';
  return path.startsWith('scripts/ci/') || path.startsWith('packages/contribution-tools/')
    || path === '.github/workflows/verify.yml' ? 'governance' : 'shared-release';
}
// Coverage is attached to these bounded paths, not to every file owned by a
// coarse module. Existing governance and native operator checks cover these
// obligations; a new suite or reverse consumer needs a separate mapping review.
const DELIVERY_SUITES = Object.freeze({
  governance: ['governance.unit', 'runtime.full'],
  'contribution-experience': ['governance.unit'],
  'shared-release': ['governance.unit', 'runtime.full'],
  'media-migration': ['runtime.full'],
});
const MEDIA_PRODUCT_CONSUMERS = ['community', 'member-reporting', 'member-communications'];
const DAILY_SOURCES = ['packages/media-migration/backup-daily.ts', 'packages/media-migration/backup-diagnostics.ts'];
const DAILY_CLIENTS = ['scripts/media-backup-daily.ts', 'tests/runtime/media-backup-daily.test.ts',
  // This unchanged, opt-in archive drill is not selected by full Verify either.
  // The required native shared-release fixture covers the production adapter.
  'tests/integration/media-backup-archive.test.ts'];

// Only this literal metadata addition qualifies. Removing it must recover the
// complete baseline bytes: existing suites, discovery baselines, loaders and
// timeouts cannot change, and registry code is never evaluated by selection.
const DAILY_SUITE_DECLARATION = "  'ci.daily-backup': Object.freeze({ files: Object.freeze(['tests/runtime/media-backup-daily.test.ts']), loader: 'tsx', database: false, timeoutMs: 180000, env: Object.freeze([]) }),\n";
export function deliveryDailyRegistryAddition(before, after) {
  return typeof before === 'string' && typeof after === 'string'
    && before.length <= 128000 && after.length <= 128000
    && !before.includes('ci.daily-backup')
    && after.split(DAILY_SUITE_DECLARATION).length === 2
    && after.replace(DAILY_SUITE_DECLARATION, '') === before;
}

export function deliveryVerifyWiringOnly(before, after) {
  // Preserve every other job and all global execution controls byte-for-byte.
  // This is a constrained textual comparison, not permissive YAML parsing.
  const mask = text => {
    if (typeof text !== 'string' || text.length > 128000 || /[\t\r]/.test(text)) return null;
    const lines = text.split('\n'), out = []; let job = '', inJobs = false, seen = new Set();
    for (const line of lines) {
      if (/^\S/.test(line) && !line.startsWith('#')) {inJobs = line === 'jobs:'; job = '';}
      const match = inJobs && /^  ([a-z][a-z0-9-]*):$/.exec(line);
      if (match) {job = match[1]; if (seen.has(job)) return null; seen.add(job);}
      else if (inJobs && /^ {1,3}\S/.test(line) && !line.trimStart().startsWith('#')) return null;
      // YAML anchors/aliases/tags can let edited delivery blocks affect other jobs.
      if (/(?:^\s*-?\s*|:\s*)[&*!][a-zA-Z]/.test(line) && !line.trimStart().startsWith('#')) return null;
      if (!['select','deploy-preflight'].includes(job) && !line.trimStart().startsWith('#')) out.push(line);
    }
    return ['select','deploy-preflight'].every(id => seen.has(id)) ? out.join('\n') : null;
  };
  const left = mask(before), right = mask(after);
  return left !== null && right !== null && left === right;
}

export function deliveryCoverageProven(graphs, paths, snapshots) {
  const media = paths.some(path => deliveryOwner(path) === 'media-migration');
  const control = paths.some(path => deliveryOwner(path) === 'governance');
  const seeds = [...new Set(paths.map(deliveryOwner).filter(id => id && id !== 'media-migration'))];
  if (media) seeds.push('shared-release'); // the actual production daily-backup consumer
  for (const graph of graphs) {
    const descriptors = [...graph.values()];
    for (const path of paths) {
      if (descriptors.some(d => d.instructions.includes(path) && d.module_id !== deliveryOwner(path))
        || descriptors.some(d => d.public_exports.includes(path)) || RUNTIME_TEXT.has(path)) return false;
    }
    const impact = selectImpact({baseline: descriptors, candidate: descriptors, changedPaths: [], scopes: seeds});
    const allowed = control ? ['governance','contribution-experience','shared-release'] : ['shared-release'];
    if (impact.module_ids.some(id => !allowed.includes(id))) return false;
    for (const id of [...impact.module_ids, ...(media ? ['media-migration'] : [])])
      if (!graph.has(id) || !sameSet(graph.get(id).tests, DELIVERY_SUITES[id] ?? [])) return false;
    if (media && descriptors.some(d => d.dependencies.includes('media-migration')
      && !['shared-release', ...MEDIA_PRODUCT_CONSUMERS].includes(d.module_id))) return false;
  }
  const ts = loadGuildPresentationParsers()?.ts;
  if (!ts) return false;
  // Prove the other direct media consumers and the rest of the media module do
  // not consume the daily subgraph. Unresolved/computed loaders in that boundary
  // refuse narrowing. This uses installed parser code and immutable Git blobs.
  for (const {graph, files, read} of snapshots) {
    for (const path of ['tsconfig.json','package.json']) if (files.has(path)) {
      const config = JSON.parse(read(path));
      if (config.compilerOptions?.paths || config.compilerOptions?.baseUrl || config.imports || config.exports) return false;
    }
    // Literal incoming imports must not hide behind an unrelated owner or an
    // omitted descriptor dependency. This is deliberately a bounded direct-edge
    // check, not general dynamic-code or transitive dependency analysis.
    let literalCount = 0, literalBytes = 0;
    for (const [path, entry] of files) {
      if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) || deliveryOwner(path)
        || DAILY_SOURCES.includes(path) || DAILY_CLIENTS.includes(path)) continue;
      if (++literalCount > 4096 || entry.type !== 'blob' || !['100644','100755'].includes(entry.mode)) return false;
      const source = read(path); literalBytes += Buffer.byteLength(source);
      if (Buffer.byteLength(source) > 2000000 || literalBytes > 64000000) return false;
      for (const {fileName} of ts.preProcessFile(source, true, true).importedFiles) {
        if (!fileName.startsWith('.')) continue;
        const target = posix.normalize(posix.join(posix.dirname(path), fileName)).replace(/\.[cm]?js$/, '.ts');
        if (target.startsWith('deploy/shared-release/')
          || [...DAILY_SOURCES, ...DAILY_CLIENTS].some(p => p === target || p.replace(/\.ts$/, '') === target)) return false;
      }
    }
    if (!media) continue;
    const excluded = ['media-migration', ...MEDIA_PRODUCT_CONSUMERS].map(id => graph.get(id)).filter(Boolean);
    let count = 0, bytes = 0;
    for (const [path, entry] of files) {
      if (!/\.(?:[cm]?js|jsx|tsx?)$/.test(path) || !excluded.some(d => owns(d, path))
        || DAILY_SOURCES.includes(path) || DAILY_CLIENTS.includes(path)) continue;
      if (++count > 2048 || !regularBlob(entry)) return false;
      const source = read(path); bytes += Buffer.byteLength(source);
      if (source.length > 524288 || bytes > 16000000) return false;
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      if (file.parseDiagnostics.length) return false;
      let valid = true;
      const localRequire = file.statements.some(node => ts.isVariableStatement(node)
        && node.declarationList.flags & ts.NodeFlags.Const
        && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'require'
          && d.initializer && ts.isArrowFunction(d.initializer)));
      const checkImport = specifier => {
        if (typeof specifier !== 'string' || /[\\?#]/.test(specifier)) {valid = false; return;}
        if (!specifier.startsWith('.')) return; // installed packages, no local aliases in this profile
        const target = posix.normalize(posix.join(posix.dirname(path), specifier)).replace(/\.js$/, '.ts');
        if ([...DAILY_SOURCES, ...DAILY_CLIENTS].some(p => p === target || p.replace(/\.ts$/, '') === target)
          || target.startsWith('deploy/shared-release/')) valid = false;
      };
      const visit = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
          checkImport(ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null);
        if (ts.isImportTypeNode(node)) checkImport(ts.isLiteralTypeNode(node.argument)
          && ts.isStringLiteral(node.argument.literal) ? node.argument.literal.text : null);
        if (ts.isImportEqualsDeclaration(node)) valid = false;
        if (ts.isCallExpression(node)) {
          const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
          const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require' && !localRequire;
          if (dynamic || requireCall) {
            const arg = node.arguments[0];
            if (arg && ts.isStringLiteral(arg)) checkImport(arg.text);
            else if (dynamic && arg && ts.isPropertyAccessExpression(arg) && arg.name.text === 'href'
              && ts.isNewExpression(arg.expression) && ts.isIdentifier(arg.expression.expression)
              && arg.expression.expression.text === 'URL' && arg.expression.arguments?.length === 2
              && ts.isStringLiteral(arg.expression.arguments[0])
              && files.has(arg.expression.arguments[0].text)
              && ![...DAILY_SOURCES, ...DAILY_CLIENTS].includes(arg.expression.arguments[0].text)
              && !arg.expression.arguments[0].text.startsWith('deploy/shared-release/')) {
              // Existing restore ACL's fixed repository-relative manifest/migration imports.
            } else valid = false;
          }
          if (ts.isIdentifier(node.expression) && ['eval','Function'].includes(node.expression.text)) valid = false;
        }
        ts.forEachChild(node, visit);
      };
      visit(file); if (!valid) return false;
    }
  }
  return true;
}

function decision(mode, reason, selected) {
  if (!['full', 'docs', 'affected'].includes(mode) || !/^[a-z0-9_]+$/.test(reason)) throw new Error('invalid_selection_decision');
  return Object.freeze({
    mode, reason,
    jobs: Object.freeze(Object.fromEntries(SELECTABLE_JOBS.map(id => [id, mode === 'affected'
      ? (minimalJobs(reason) ?? (reason === DELIVERY_TOOLING_REASON ? DELIVERY_TOOLING_JOBS
        : reason === 'guild_presentation_dependency_closure' ? GUILD_PRESENTATION_JOBS : FRONTEND_LEAF_JOBS)).includes(id) : selected]))),
  });
}
const full = reason => decision('full', reason, true);
const docs = () => decision('docs', 'docs_allowlist', false);
const affected = () => decision('affected', 'frontend_leaf_profiles', false);

function inScope(path, entry) {
  return entry.endsWith('/') ? path.startsWith(entry) : path === entry;
}
function safeRepoPath(path) {
  if (typeof path !== 'string') return false;
  try { artifactPath(path); return true; } catch { return false; }
}
function hiddenSegment(path) {
  return path.split('/').some(part => part.startsWith('.'));
}
function bannedDocsEntry(path) {
  if (!path.startsWith('docs/')) return false;
  const base = path.slice(path.lastIndexOf('/') + 1);
  return CODE_OR_CONFIG.test(path) || TEST_OR_SPEC_NAME.test(base)
    || path.split('/').some(part => BANNED_SEGMENTS.has(part.toLowerCase()));
}
export function isDocsAllowlisted(path) {
  if (!safeRepoPath(path) || hiddenSegment(path) || !path.endsWith('.md') || RUNTIME_TEXT.has(path) || bannedDocsEntry(path)) return false;
  if (DOCS_ALLOWLIST_PREFIXES.some(prefix => path.startsWith(prefix))) return true;
  return /^docs\/[^/]+\.md$/.test(path);
}
function rejectionReason(path) {
  if (!safeRepoPath(path)) return 'unknown_path';
  if (ROOT_INSTRUCTIONS.includes(path)) return 'root_instruction';
  if (FULL_SCOPE.some(entry => inScope(path, entry)) || RUNTIME_TEXT.has(path) || isModuleDescriptorPath(path)) return 'governance_security_or_shared_runtime';
  if (hiddenSegment(path)) return 'unknown_path';
  if (bannedDocsEntry(path)) return 'excluded_test_spec_or_config';
  if (!isDocsAllowlisted(path) && !leafProfile(path)) return 'not_docs_allowlist';
  return null;
}
function statusReason(change) {
  if (!change || typeof change !== 'object') return 'untrusted_change_status';
  const status = typeof change.status === 'string' ? change.status : '';
  const letter = /^[AMDTRCUXB]$/.test(status) ? status : /^[RC][0-9]{1,3}$/.test(status) ? status[0] : '';
  if (!letter) return 'untrusted_change_status';
  if (letter === 'D') return 'deleted_path';
  if (letter === 'R' || letter === 'C') return 'renamed_or_copied_path';
  if (letter !== 'A' && letter !== 'M') return 'untrusted_change_status';
  if (change.previousPath) return 'untrusted_change_status';
  return null;
}
function strongest(reasons) {
  return REASON_PRIORITY.find(reason => reasons.includes(reason)) ?? null;
}

export function decideAffectedJobs(input) {
  const event = input?.event;
  if (event === 'merge_group') return full('merge_group');
  if (event === 'push') return full('push');
  if (typeof event !== 'string' || !EVENT.test(event) || event !== 'pull_request') return full('non_pull_request');
  if (input.diffComplete !== true || !Array.isArray(input.changes) || input.changes.length > CHANGE_LIMIT) return full('diff_unproven');
  if (input.changes.length === 0) return full('empty_diff');
  const minimal = decideMinimalProfile(input);
  if (minimal.profile !== 'full') return decision('affected', minimal.reason, false);
  const reasons = [];
  const paths = [];
  let inventoryCompanion = false;
  let rootReadme = false;
  for (const change of input.changes) {
    const status = statusReason(change);
    if (status) { reasons.push(status); continue; }
    // A content edit of the generated manifest is metadata. It is omitted from
    // selectImpact so ownership of that metadata cannot veto qualifying edits.
    if (change.path === GENERATED_INVENTORY_PATH) { inventoryCompanion = true; continue; }
    // CI documentation eligibility is separate from mandatory Agent context.
    // Never generalize this to another root instruction, a new README, runtime
    // text, or a destructive/status change. The trusted tree diff proves M.
    if (change.path === 'README.md' && change.status === 'M' && !RUNTIME_TEXT.has(change.path)) {
      rootReadme = true; paths.push(change.path); continue;
    }
    if (leafProfile(change.path) && change.status !== 'M') { reasons.push('untrusted_change_status'); continue; }
    const reason = rejectionReason(change.path);
    if (reason) reasons.push(reason);
    else paths.push(change.path);
  }
  const rejected = strongest(reasons);
  if (rejected) return full(rejected);
  // The manifest alone is still governance scope. A dropped change fails closed.
  if (paths.length === 0) return full(inventoryCompanion ? 'governance_security_or_shared_runtime' : 'diff_unproven');
  const baseline = Array.isArray(input.baseline) ? input.baseline : null;
  const candidate = Array.isArray(input.candidate) ? input.candidate : null;
  if (input.descriptorsProven === false || !baseline?.length || !candidate?.length) return full('descriptors_unproven');
  let impact;
  try {
    if (rootReadme) {
      // Only the existing docs profile gets this exception. Preserve every
      // explicit owner in both revisions; removing ownership cannot narrow CI.
      for (const descriptors of [baseline, candidate]) validatedDescriptorGraph(descriptors);
      if ([...baseline, ...candidate].some(descriptor => owns(descriptor, 'README.md'))) return full('baseline_candidate_union');
      if (paths.some(path => leafProfile(path))) return full('root_instruction');
    }
    // Keep ROOT_INSTRUCTIONS/selectImpact unchanged for all context callers.
    // The exact unowned README contributes no runtime impact to this docs-only
    // decision; every accompanying document still uses the original union.
    impact = selectImpact({ baseline, candidate, changedPaths: rootReadme ? paths.filter(path => path !== 'README.md') : paths });
  } catch (error) {
    return full(error?.code === 'invalid_artifact_path' ? 'unknown_path' : 'descriptors_unproven');
  }
  if (impact.unknown_paths.length) return full('unknown_path');
  if (paths.some(path => leafProfile(path))) {
    return compatibleLeafImpact(paths, baseline, candidate, impact) ? affected() : full('leaf_profile_unproven');
  }
  if (impact.module_ids.length || impact.tests.length) return full('baseline_candidate_union');
  return docs();
}

/** Explain the actual reverse-dependency closure before permitting the guild lane.
 * Descriptor, contract, SDK, registration and unknown changes retain the full
 * path. Approved module-local source, CSS, docs and existing preview tests may
 * evolve together; actual immutable source dependencies are checked below.
 */
export function decideGuildPresentationProfile(input) {
  const fallback = reason => ({profile: 'full', reason});
  if (input?.event !== 'pull_request') return fallback('non_pull_request');
  if (input.diffComplete !== true || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > CHANGE_LIMIT) return fallback('diff_unproven');
  if (input.descriptorsProven === false || !input.baseline?.length || !input.candidate?.length) return fallback('descriptors_unproven');
  const paths = [], leaves = [];
  for (const change of input.changes) {
    if (statusReason(change)) return fallback('guild_change_unproven');
    if (change.path === GENERATED_INVENTORY_PATH) { if (change.status !== 'M') return fallback('guild_change_unproven'); continue; }
    const owned = guildPresentationPath(change.path);
    if (!owned || owned.kind === 'test' && change.status !== 'M') return fallback('outside_guild_presentation');
    paths.push(change.path);
    if (!leaves.includes(owned.leaf)) leaves.push(owned.leaf);
  }
  if (!paths.length || new Set(paths).size !== paths.length) return fallback('guild_change_unproven');
  try {
    const graphs = [validatedDescriptorGraph(input.baseline), validatedDescriptorGraph(input.candidate)];
    if (!sameSet([...graphs[0].keys()], [...graphs[1].keys()])) throw Error();
    for (const [id, value] of graphs[0]) if (JSON.stringify(value) !== JSON.stringify(graphs[1].get(id))) throw Error();
    for (const descriptors of [input.baseline, input.candidate]) {
      if (paths.some(path => RUNTIME_TEXT.has(path) || descriptors.some(item => item.instructions.includes(path)))) throw Error();
      for (const leaf of leaves) {
        const owners = descriptors.filter(descriptor => paths.filter(path => guildPresentationPath(path)?.leaf.module === leaf.module).some(path => owns(descriptor, path)));
        if (owners.length !== 1) throw Error();
        const owner = owners[0];
        if (owner.module_id !== leaf.module || owner.owner_role !== leaf.owner
          || !sameSet(owner.dependencies, leaf.dependencies) || !sameSet(owner.tests, ['runtime.guild-blocks'])
          || !sameSet(owner.public_exports, [leaf.entry]) || owner.surfaces.length !== 1) throw Error();
        const surface = owner.surfaces[0];
        if (surface.surface_id !== leaf.surface || surface.entry !== leaf.entry || surface.kind !== 'page'
          || surface.auth_profile !== 'member-session' || !sameSet(surface.operations, leaf.operations)) throw Error();
      }
      const composition = descriptors.find(item => item.module_id === GUIDE_COMPOSITION_PROFILE.module);
      if (!composition || composition.owner_role !== 'foundation'
        || !sameSet(composition.dependencies, GUIDE_COMPOSITION_PROFILE.dependencies)
        || !sameSet(composition.tests, ['runtime.full'])) throw Error();
    }
    const impact = selectImpact({baseline: input.baseline, candidate: input.candidate, changedPaths: paths});
    if (impact.unknown_paths.length || !sameSet(impact.module_ids, [...new Set(leaves.map(item => item.module)), GUIDE_COMPOSITION_PROFILE.module])
      || !sameSet(impact.tests, ['runtime.full', 'runtime.guild-blocks'])) throw Error();
    return {profile: GUILD_PRESENTATION_PROFILE.id, reason: 'guild_presentation_dependency_closure',
      affected_modules: impact.module_ids, declared_suites: impact.tests,
      required_checks: ['typecheck', 'portal-build', 'guild-registration', GUILD_PRESENTATION_PROFILE.runtimeSuite, 'guild-integration', 'guild-preview', 'static-worker'],
      runtime_files: GUILD_PRESENTATION_PROFILE.runtimeFiles,
      integration_files: GUILD_PRESENTATION_PROFILE.integrationFiles,
      preview_files: GUILD_PRESENTATION_PROFILE.previewFiles};
  } catch { return fallback('guild_impact_unproven'); }
}

// Browser narrowing is a separate, fixed pilot; it never narrows job selection.
export function decideE2eProfile(input) {
  const selected = decideAffectedJobs(input);
  // Reuse every admission/fallback above. Only the original leaf-impact guard
  // may defer to this explicit two-module browser profile; jobs still stay full.
  if (selected.mode !== 'affected' && selected.reason !== 'leaf_profile_unproven') return { profile: 'full', reason: selected.reason };
  const leaves = input.changes.map(change => leafProfile(change.path)).filter(Boolean);
  if (!leaves.length || leaves.some(profile => profile.module !== 'newcomer-guides')) return { profile: 'full', reason: 'non_guide_leaf' };
  try {
    const graphs = [validatedDescriptorGraph(input.baseline), validatedDescriptorGraph(input.candidate)];
    if (!sameSet([...graphs[0].keys()], [...graphs[1].keys()])) throw Error();
    for (const [id, value] of graphs[0]) if (JSON.stringify(value) !== JSON.stringify(graphs[1].get(id))) throw Error();
    const guide = FRONTEND_LEAF_PROFILES.find(profile => profile.module === 'newcomer-guides');
    for (const descriptors of [input.baseline, input.candidate]) {
      for (const change of input.changes.filter(change => leafProfile(change.path))) {
        const owners = descriptors.filter(descriptor => owns(descriptor, change.path));
        if (owners.length !== 1 || owners[0].module_id !== guide.module) throw Error();
      }
      const owner = descriptors.find(descriptor => descriptor.module_id === guide.module);
      const composition = descriptors.find(descriptor => descriptor.module_id === GUIDE_COMPOSITION_PROFILE.module);
      if (owner?.owner_role !== 'foundation' || !sameSet(owner.dependencies, guide.dependencies) || !sameSet(owner.tests, guide.tests)
        || composition?.owner_role !== 'foundation' || !sameSet(composition.dependencies, GUIDE_COMPOSITION_PROFILE.dependencies)
        || !sameSet(composition.tests, ['runtime.full'])
        || !sameSet(composition.owned_paths.filter(path => path.startsWith('tests/')),
          [...GUIDE_COMPOSITION_PROFILE.files, 'tests/runtime/game-console-routing.test.ts'])
        || !sameSet(owner.owned_paths.filter(path => path.startsWith('tests/') && !path.startsWith('tests/runtime/')),
          ['tests/e2e/newcomer-guides.spec.ts', 'tests/e2e/ai-sister-guides.spec.ts'])) throw Error();
      for (const [id, files] of [[guide.module, ['tests/e2e/newcomer-guides.spec.ts', 'tests/e2e/ai-sister-guides.spec.ts']],
        [GUIDE_COMPOSITION_PROFILE.module, GUIDE_COMPOSITION_PROFILE.files]]) {
        for (const file of files) {
          const owners = descriptors.filter(descriptor => owns(descriptor, file));
          if (owners.length !== 1 || owners[0].module_id !== id) throw Error();
        }
      }
    }
    const paths = input.changes.map(change => change.path).filter(path => path !== GENERATED_INVENTORY_PATH);
    const impact = selectImpact({baseline: input.baseline, candidate: input.candidate, changedPaths: paths});
    if (impact.unknown_paths.length || !sameSet(impact.module_ids, [guide.module, GUIDE_COMPOSITION_PROFILE.module])
      || !sameSet(impact.tests, ['runtime.full'])) throw Error();
    return { profile: 'newcomer-guides', reason: 'newcomer_guide_composition' };
  } catch { return { profile: 'full', reason: 'guide_impact_unproven' }; }
}

// Shared bounded validation for the two explicitly narrowed CI profiles.
// This is the existing leaf graph check, also required for README eligibility.
function validatedDescriptorGraph(descriptors) {
  if (descriptors.length > DESCRIPTOR_LIMIT) throw new Error('invalid_module_graph');
  const byId = new Map();
  for (const descriptor of descriptors) {
    validateDescriptor(descriptor);
    if (byId.has(descriptor.module_id)) throw new Error('invalid_module_graph');
    byId.set(descriptor.module_id, descriptor);
  }
  const active = new Set(), done = new Set();
  const visit = id => {
    if (active.has(id) || !byId.has(id)) throw new Error('invalid_module_graph');
    if (done.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    active.delete(id); done.add(id);
  };
  for (const id of byId.keys()) visit(id);
  return byId;
}

function compatibleLeafImpact(paths, baseline, candidate, impact) {
  // Drift cannot subtract baseline obligations. Validate the whole bounded graph
  // because an unrelated module can add a reverse dependency on a changed leaf.
  const graphs = [];
  try {
    for (const descriptors of [baseline, candidate]) graphs.push(validatedDescriptorGraph(descriptors));
    if (!sameSet([...graphs[0].keys()], [...graphs[1].keys()])) return false;
    for (const [id, value] of graphs[0]) if (JSON.stringify(value) !== JSON.stringify(graphs[1].get(id))) return false;
    const profiles = [...new Set(paths.map(leafProfile).filter(Boolean))];
    if (!sameSet(impact.module_ids, profiles.map(profile => profile.module))
      || !sameSet(impact.tests, [...new Set(profiles.flatMap(profile => profile.tests))])) return false;
    for (const path of paths.filter(path => leafProfile(path))) {
      const expected = leafProfile(path);
      for (const descriptors of [baseline, candidate]) {
        const owners = descriptors.filter(descriptor => owns(descriptor, path));
        if (owners.length !== 1 || owners[0].module_id !== expected.module || owners[0].owner_role !== 'foundation'
          || !sameSet(owners[0].dependencies, expected.dependencies) || !sameSet(owners[0].tests, expected.tests)) return false;
      }
    }
    return true;
  } catch { return false; }
}

function regularBlob(entry) {
  return entry?.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755');
}
export function parseLsTreeZ(text) {
  const files = new Map();
  if (typeof text !== 'string') return { ok: false, files };
  if (text.length === 0) return { ok: true, files };
  const records = text.split('\0').filter(Boolean);
  if (records.length > TREE_PATH_LIMIT) return { ok: false, files };
  for (const record of records) {
    const tab = record.indexOf('\t');
    if (tab < 0) return { ok: false, files };
    const match = /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40})$/.exec(record.slice(0, tab));
    const path = record.slice(tab + 1);
    if (!match || files.has(path) || !path) return { ok: false, files };
    files.set(path, { mode: match[1], type: match[2], oid: match[3] });
  }
  return { ok: true, files };
}
export function parseNameStatusZ(text) {
  if (typeof text !== 'string') return { ok: false, changes: [] };
  const records = text.split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < records.length;) {
    const header = records[index++];
    const letter = header[0];
    if ((letter === 'R' || letter === 'C') && /^[RC][0-9]{1,3}$/.test(header)) {
      const previousPath = records[index++];
      const path = records[index++];
      if (!previousPath || !path) return { ok: false, changes: [] };
      changes.push({ status: letter, path, previousPath });
    } else if (/^[AMDTUXB]$/.test(header)) {
      const path = records[index++];
      if (!path) return { ok: false, changes: [] };
      changes.push({ status: header, path });
    } else return { ok: false, changes: [] };
  }
  return { ok: changes.length <= CHANGE_LIMIT, changes };
}
function oidCounts(files) {
  const counts = new Map();
  for (const entry of files.values()) {
    if (!regularBlob(entry)) continue;
    counts.set(entry.oid, (counts.get(entry.oid) ?? 0) + 1);
  }
  return counts;
}
export function changesFromTrees(baseFiles, headFiles) {
  if (!(baseFiles instanceof Map) || !(headFiles instanceof Map)) return { ok: false, changes: [] };
  if (baseFiles.size > TREE_PATH_LIMIT || headFiles.size > TREE_PATH_LIMIT) return { ok: false, changes: [] };
  const changes = [];
  const paths = new Set([...baseFiles.keys(), ...headFiles.keys()]);
  for (const path of paths) {
    const before = baseFiles.get(path);
    const after = headFiles.get(path);
    if (before && after && before.oid === after.oid && before.mode === after.mode && before.type === after.type) continue;
    if ((before && !regularBlob(before)) || (after && !regularBlob(after))) {
      changes.push({ path, status: 'T' });
      continue;
    }
    if (before && !after) changes.push({ path, status: 'D' });
    else if (!before && after) changes.push({ path, status: 'A' });
    else if (before.mode !== after.mode) changes.push({ path, status: 'T' });
    else changes.push({ path, status: 'M' });
  }
  const baseCount = oidCounts(baseFiles);
  const headCount = oidCounts(headFiles);
  const added = new Map(changes.filter(change => change.status === 'A').map(change => [change.path, change]));
  const consumed = new Set();
  const renames = [];
  for (const change of changes) {
    if (change.status !== 'D') continue;
    const before = baseFiles.get(change.path);
    if (!before || before.oid === EMPTY_BLOB) continue;
    if (baseCount.get(before.oid) !== 1 || headCount.get(before.oid) !== 1) continue;
    const match = [...added.keys()].find(path => !consumed.has(path) && headFiles.get(path)?.oid === before.oid);
    if (!match) continue;
    consumed.add(match);
    consumed.add(change.path);
    renames.push({ status: 'R', path: match, previousPath: change.path });
  }
  const folded = [...changes.filter(change => !consumed.has(change.path)), ...renames];
  folded.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { ok: folded.length <= CHANGE_LIMIT, changes: folded };
}

function gitEnv(source = process.env) {
  const env = verificationEnvironment(source);
  if (typeof source.HOME === 'string') env.HOME = source.HOME;
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}
function runGit(repository, args, timeout = 20_000) {
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
    '-c', 'diff.external=', '-C', repository, ...args], {
    env: gitEnv(), timeout, maxBuffer: 16_000_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function hasCommit(repository, sha) {
  try { runGit(repository, ['cat-file', '-e', `${sha}^{commit}`]); return true; } catch { return false; }
}
function ensureCommit(repository, sha, pullRequest, allowFetch) {
  if (hasCommit(repository, sha)) return true;
  if (!allowFetch) return false;
  try { runGit(repository, ['fetch', '--no-tags', '--depth=1', 'origin', sha], 60_000); } catch { /* The PR head may live only on the pull ref. */ }
  if (hasCommit(repository, sha)) return true;
  if (!PR_NUMBER.test(pullRequest ?? '')) return false;
  try { runGit(repository, ['fetch', '--no-tags', 'origin', `pull/${pullRequest}/head`], 60_000); } catch { return false; }
  try { return runGit(repository, ['rev-parse', '--verify', 'FETCH_HEAD']).toString().trim() === sha; } catch { return false; }
}
export function loadModuleDescriptors(repository, sha) {
  let text;
  try { text = runGit(repository, ['ls-tree', '-r', '-z', '--end-of-options', sha]).toString('utf8'); }
  catch { return { ok: false, descriptors: [] }; }
  const parsed = parseLsTreeZ(text);
  if (!parsed.ok) return { ok: false, descriptors: [] };
  const paths = [...parsed.files.keys()].filter(isModuleDescriptorPath);
  if (paths.length > DESCRIPTOR_LIMIT) return { ok: false, descriptors: [] };
  const descriptors = [];
  for (const path of paths) {
    const entry = parsed.files.get(path);
    if (!regularBlob(entry)) return { ok: false, descriptors: [] };
    let bytes;
    try { bytes = runGit(repository, ['show', '--end-of-options', `${sha}:${path}`]); }
    catch { return { ok: false, descriptors: [] }; }
    if (bytes.length > 128_000) return { ok: false, descriptors: [] };
    try {
      const value = validateDescriptor(parseJson(bytes));
      // A broad owned path may already include this descriptor. Do not spend
      // another schema slot on redundant synthetic ownership; if adding an
      // uncovered path exceeds the bound, keep the graph fail-closed.
      descriptors.push(owns(value, path) ? value
        : validateDescriptor({ ...value, owned_paths: [...value.owned_paths, path] }));
    } catch { return { ok: false, descriptors: [] }; }
  }
  return { ok: descriptors.length > 0, descriptors };
}
function loadTrees(repository, base, head) {
  try {
    const baseTree = parseLsTreeZ(runGit(repository, ['ls-tree', '-r', '-z', '--end-of-options', base]).toString('utf8'));
    const headTree = parseLsTreeZ(runGit(repository, ['ls-tree', '-r', '-z', '--end-of-options', head]).toString('utf8'));
    if (!baseTree.ok || !headTree.ok) return null;
    const diff = changesFromTrees(baseTree.files, headTree.files);
    return {...diff, baseFiles: baseTree.files, candidateFiles: headTree.files, nonExecutableBlobsProven: diff.changes.every(change =>
      [baseTree.files.get(change.path), headTree.files.get(change.path)].every(entry => entry?.type === 'blob' && entry.mode === '100644'))};
  } catch { return null; }
}
export function collectRepositoryDecision({ repository, event, base = '', head = '', candidate = '', pullRequest = '', allowFetch = false } = {}) {
  const delivery = collectDeliveryToolingProfile({repository, event, base, head, candidate, pullRequest, allowFetch});
  if (delivery) return delivery;
  if (event !== 'pull_request') return decideAffectedJobs({ event, diffComplete: false, changes: [], baseline: [], candidate: [] });
  const minimal = collectIntegrationProfile({repository, event, base, head, candidate, pullRequest, allowFetch}, decideMinimalProfile);
  if (Object.hasOwn(MINIMAL_JOB_PROFILES, minimal.profile)) return decision('affected', minimal.reason, false);
  const guild = collectRepositoryGuildDecision({repository, event, base, head, candidate, pullRequest, allowFetch});
  if (guild.profile === GUILD_PRESENTATION_PROFILE.id) return decision('affected', guild.reason, false);
  if (['guild_source_dependencies_unproven', 'guild_impact_unproven'].includes(guild.reason)) return full(guild.reason);
  const root = typeof repository === 'string' && isAbsolute(repository) ? resolve(repository) : '';
  if (!root || root.startsWith('-') || !SHA.test(base) || !SHA.test(head)) return full('diff_unproven');
  if (!ensureCommit(root, base, '', allowFetch) || !ensureCommit(root, head, pullRequest, allowFetch)) return full('diff_unproven');
  const diff = loadTrees(root, base, head);
  if (!diff?.ok) return full('diff_unproven');
  const baseline = loadModuleDescriptors(root, base);
  const headGraph = loadModuleDescriptors(root, head);
  return decideAffectedJobs({
    event, diffComplete: true, changes: diff.changes,
    baseline: baseline.descriptors, candidate: headGraph.descriptors,
    descriptorsProven: baseline.ok && headGraph.ok, nonExecutableBlobsProven: false,
  });
}

// Compare the actual checkout, including merge resolutions, rather than trusting
// a PR's path list. On main, only a direct successor of event.before qualifies;
// a multi-commit push or missing topology falls back to existing full selection.
function collectDeliveryToolingProfile({repository, event, base, head, candidate, pullRequest, allowFetch}) {
  if (!['pull_request', 'push'].includes(event) || typeof repository !== 'string' || !isAbsolute(repository)
    || ![base, head, candidate].every(value => SHA.test(value))) return null;
  try {
    const root = resolve(repository);
    for (const sha of [base, head, candidate]) if (!ensureCommit(root, sha, pullRequest, allowFetch)) return null;
    if (runGit(root, ['rev-parse', 'HEAD']).toString().trim() !== candidate
      || runGit(root, ['status', '--porcelain', '--untracked-files=all']).toString().trim()) return null;
    const parents = runGit(root, ['cat-file', '-p', candidate]).toString().split('\n\n')[0]
      .split('\n').filter(line => line.startsWith('parent ')).map(line => line.slice(7));
    if (parents[0] !== base || (event === 'pull_request' ? parents.length !== 2 || parents[1] !== head : head !== candidate)) return null;
    const diff = loadTrees(root, base, candidate);
    if (!diff?.ok || !diff.changes.length) return null;
    const graphs = [base, candidate].map(sha => {
      const loaded = loadModuleDescriptors(root, sha);
      if (!loaded.ok) throw Error('missing_graph');
      return validatedDescriptorGraph(loaded.descriptors);
    });
    if (!sameSet([...graphs[0].keys()], [...graphs[1].keys()])) return null;
    for (const [id, descriptor] of graphs[0]) {
      const current = graphs[1].get(id);
      // Adding ownership for an already-covered operator file does not change
      // runtime dependencies. Governance tests already validate the descriptor.
      // Never permit removed ownership or changed tests/dependencies/surfaces.
      if (descriptor.owned_paths.some(path => !current.owned_paths.includes(path))
        || current.owned_paths.some(path => !descriptor.owned_paths.includes(path) && deliveryOwner(path) !== id)
        || JSON.stringify({...descriptor, owned_paths: []}) !== JSON.stringify({...current, owned_paths: []})) return null;
    }
    const blobs = new Map();
    const read = (sha, path) => {
      const oid = (sha === base ? diff.baseFiles : diff.candidateFiles).get(path)?.oid;
      if (!oid) throw Error('source_blob_missing');
      if (!blobs.has(oid)) blobs.set(oid, runGit(root, ['show', '--end-of-options', `${sha}:${path}`]).toString('utf8'));
      return blobs.get(oid);
    };
    const paths = [];
    let scoped = false;
    for (const change of diff.changes) {
      if (statusReason(change)) return null;
      const before = diff.baseFiles.get(change.path), after = diff.candidateFiles.get(change.path);
      if (!regularBlob(after) || before && (!regularBlob(before) || before.mode !== after.mode)) return null;
      if (change.path === GENERATED_INVENTORY_PATH && change.status === 'M') continue;
      if (isModuleDescriptorPath(change.path) && change.status === 'M') continue;
      const owner = deliveryOwner(change.path);
      const owners = graphs.map(graph => [...graph.values()].filter(d => owns(d, change.path)).map(d => d.module_id));
      if (!owner || !sameSet(owners[1], [owner]) || owners[0].length && !sameSet(owners[0], [owner])) return null;
      if (change.path === 'packages/contribution-tools/pinned-suites.mjs'
        && (change.status !== 'M' || !deliveryDailyRegistryAddition(read(base, change.path), read(candidate, change.path)))) return null;
      if (change.path === '.github/workflows/verify.yml'
        && !deliveryVerifyWiringOnly(read(base, change.path), read(candidate, change.path))) return null;
      paths.push(change.path); scoped = true;
    }
    if (!deliveryCoverageProven(graphs, paths, [
      {graph: graphs[0], files: diff.baseFiles, read: path => read(base, path)},
      {graph: graphs[1], files: diff.candidateFiles, read: path => read(candidate, path)},
    ])) return null;
    return scoped ? decision('affected', DELIVERY_TOOLING_REASON, false) : null;
  } catch { return null; }
}

// Host event SHAs, not a candidate profile/file list, authorize the pilot.
// Read the exact integration tree: a head-only or stale-base comparison cannot
// prove the browser checkout. Any missing evidence keeps the complete suite.
export function collectRepositoryE2eDecision(input = {}) { return collectIntegrationProfile(input, decideE2eProfile); }
export function collectRepositoryGuildDecision(input = {}) { return collectIntegrationProfile(input, decideGuildPresentationProfile); }
function collectIntegrationProfile({ repository, event, base = '', head = '', candidate = '', pullRequest = '', allowFetch = false } = {}, decide) {
  const fallback = reason => ({ profile: 'full', reason });
  if (event !== 'pull_request') return fallback('non_pull_request');
  if (typeof repository !== 'string' || !isAbsolute(repository)
    || ![base, head, candidate].every(value => SHA.test(value))) return fallback('candidate_unproven');
  const root = resolve(repository);
  try {
    if (runGit(root, ['rev-parse', 'HEAD']).toString().trim() !== candidate
      || runGit(root, ['status', '--porcelain', '--untracked-files=all']).toString().trim()
      || runGit(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', 'tests/e2e']).toString().trim()) return fallback('candidate_unproven');
    if (!ensureCommit(root, candidate, pullRequest, allowFetch)
      || !ensureCommit(root, base, '', allowFetch) || !ensureCommit(root, head, pullRequest, allowFetch)) return fallback('candidate_unproven');
    const parents = runGit(root, ['cat-file', '-p', candidate]).toString().split('\n\n')[0]
      .split('\n').filter(line => line.startsWith('parent ')).map(line => line.slice(7));
    if (parents.length !== 2 || parents[0] !== base || parents[1] !== head) return fallback('candidate_unproven');
    const diff = loadTrees(root, base, candidate);
    const baseline = loadModuleDescriptors(root, base), current = loadModuleDescriptors(root, candidate);
    const result = decide({ event, diffComplete: diff?.ok === true, changes: diff?.changes ?? [],
      baseline: baseline.descriptors, candidate: current.descriptors, descriptorsProven: baseline.ok && current.ok,
      nonExecutableBlobsProven: diff?.nonExecutableBlobsProven === true || decide === decideMinimalProfile && diff?.ok === true
        && diff.changes.every(change => [diff.baseFiles.get(change.path), diff.candidateFiles.get(change.path)]
          .every(entry => !entry || entry.type === 'blob' && entry.mode === '100644')) });
    if (result.profile === GUILD_PRESENTATION_PROFILE.id) {
      const modules = new Set(diff.changes.map(change => guildPresentationPath(change.path)?.leaf.module).filter(Boolean));
      const parsers = loadGuildPresentationParsers();
      for (const module of modules) {
        const snapshots = [];
        let sourceBytes = 0;
        for (const [revision, tree] of [[base, diff.baseFiles], [candidate, diff.candidateFiles]]) {
          const files = new Map();
          for (const [path, entry] of tree) {
            if (!path.startsWith(`modules/${module}/`)) continue;
            if (!regularBlob(entry) || entry.mode !== '100644' || files.size >= 256) return fallback('guild_source_dependencies_unproven');
            const bytes = runGit(root, ['cat-file', 'blob', `${revision}:${path}`]);
            sourceBytes += bytes.length;
            if (bytes.length > 262144 || sourceBytes > 2000000) return fallback('guild_source_dependencies_unproven');
            files.set(path, new TextDecoder('utf-8', {fatal: true}).decode(bytes));
          }
          snapshots.push(files);
        }
        if (!guildPresentationDependenciesProven({module, baseline: snapshots[0], candidate: snapshots[1]}, parsers)) return fallback('guild_source_dependencies_unproven');
      }
    }
    return result;
  } catch { return fallback('candidate_unproven'); }
}

function resultOf(job) {
  return job && typeof job === 'object' && typeof job.result === 'string' ? job.result : null;
}
export function decisionFromNeeds(needs) {
  const outputs = needs?.select?.outputs;
  if (!outputs || typeof outputs !== 'object') return { ok: false, reason: 'decision_incomplete' };
  if (!['full', 'docs', 'affected'].includes(outputs.mode) || typeof outputs.reason !== 'string'
    || !/^[a-z0-9_]+$/.test(outputs.reason)) return { ok: false, reason: 'decision_incomplete' };
  const jobs = {};
  for (const [id, key] of Object.entries(JOB_OUTPUT_KEYS)) {
    if (outputs[key] !== 'true' && outputs[key] !== 'false') return { ok: false, reason: 'decision_incomplete' };
    jobs[id] = outputs[key] === 'true';
  }
  const selectedAll = SELECTABLE_JOBS.every(id => jobs[id]);
  const selectedNone = SELECTABLE_JOBS.every(id => !jobs[id]);
  if (outputs.mode === 'full' && !selectedAll) return { ok: false, reason: 'decision_inconsistent' };
  if (outputs.mode === 'docs' && !selectedNone) return { ok: false, reason: 'decision_inconsistent' };
  if (outputs.mode === 'affected') {
    const profile = minimalJobs(outputs.reason) ?? (outputs.reason === 'frontend_leaf_profiles' ? FRONTEND_LEAF_JOBS
      : outputs.reason === DELIVERY_TOOLING_REASON ? DELIVERY_TOOLING_JOBS
      : outputs.reason === 'guild_presentation_dependency_closure' ? GUILD_PRESENTATION_JOBS
        : null);
    if (!profile || SELECTABLE_JOBS.some(id => jobs[id] !== profile.includes(id))) return { ok: false, reason: 'decision_inconsistent' };
  }
  if (jobs['runtime-full'] !== jobs['runtime-aggregate']) return { ok: false, reason: 'runtime_selection_split' };
  return { ok: true, decision: { mode: outputs.mode, reason: outputs.reason ?? '', jobs } };
}
export function evaluateVerifyAggregate(needs) {
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) return { ok: false, reason: 'needs_missing' };
  if (resultOf(needs.select) !== 'success') return { ok: false, reason: 'select_not_success' };
  if (resultOf(needs['source-integrity']) !== 'success') return { ok: false, reason: 'source_integrity_not_success' };
  const parsed = decisionFromNeeds(needs);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const known = new Set(['select', 'source-integrity', ...REQUIRED_SELECTED_JOBS]);
  for (const [id, job] of Object.entries(needs)) {
    if (known.has(id)) continue;
    if (resultOf(job) !== 'success') return { ok: false, reason: 'unexpected_job_not_success', job: id, result: resultOf(job) ?? 'missing' };
  }
  for (const id of REQUIRED_SELECTED_JOBS) {
    const result = resultOf(needs[id]);
    if (parsed.decision.jobs[id]) {
      if (result !== 'success') return { ok: false, reason: 'selected_job_not_success', job: id, result: result ?? 'missing' };
    } else if (result !== 'skipped' && result !== 'success') {
      return { ok: false, reason: 'unselected_job_not_clean', job: id, result: result ?? 'missing' };
    }
  }
  return { ok: true, reason: parsed.decision.mode === 'docs' ? 'docs_selected_subset' : parsed.decision.mode === 'affected' ? 'affected_selected_subset' : 'full_selection' };
}
export function githubOutput(selection) {
  const lines = [`mode=${selection.mode}`, `reason=${selection.reason}`];
  for (const [id, key] of Object.entries(JOB_OUTPUT_KEYS)) lines.push(`${key}=${selection.jobs[id] ? 'true' : 'false'}`);
  return lines.join('\n') + '\n';
}

function parseArgs(argv) {
  const args = { allowFetch: false, checkAggregate: false, pullRequest: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--check-aggregate') args.checkAggregate = true;
    else if (arg === '--allow-fetch') args.allowFetch = true;
    else if (arg === '--event') args.event = argv[++index];
    else if (arg === '--repository') args.repository = argv[++index];
    else if (arg === '--base') args.base = argv[++index];
    else if (arg === '--head') args.head = argv[++index];
    else if (arg === '--candidate') args.candidate = argv[++index];
    else if (arg === '--pull-request') args.pullRequest = argv[++index];
    else if (arg === '--github-output') args.githubOutput = argv[++index];
    else return null;
    if (argv[index] === undefined) return null;
  }
  return args;
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) { console.error('invalid_selection_arguments'); process.exitCode = 2; return; }
  if (args.checkAggregate) {
    let needs;
    try { needs = JSON.parse(process.env.NEEDS_JSON ?? ''); } catch { needs = null; }
    const verdict = evaluateVerifyAggregate(needs);
    console.log(JSON.stringify({ ok: verdict.ok, reason: verdict.reason, job: verdict.job ?? null, result: verdict.result ?? null }));
    if (!verdict.ok) process.exitCode = 1;
    return;
  }
  if (typeof args.event !== 'string' || typeof args.githubOutput !== 'string' || !isAbsolute(args.githubOutput)) {
    console.error('invalid_selection_arguments'); process.exitCode = 2; return;
  }
  const selection = collectRepositoryDecision({
    repository: args.repository, event: args.event, base: args.base ?? '', head: args.head ?? '', candidate: args.candidate ?? '',
    pullRequest: args.pullRequest, allowFetch: args.allowFetch,
  });
  appendFileSync(args.githubOutput, githubOutput(selection));
  console.log(JSON.stringify({ mode: selection.mode, reason: selection.reason, jobs: selection.jobs }));
}
const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(resolve(entryArg)).href) main();
