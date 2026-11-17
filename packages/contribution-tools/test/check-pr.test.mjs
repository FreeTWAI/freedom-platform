import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LANE_DECLINE_SENTENCES,
  describeDeclineCode,
  extractStaticImportSpecifiersFallback,
  formatLaneDecision,
  formatSummaryLines,
  groupFilesByModule,
  mergeWorkingChanges,
  parseCheckPrArgs,
  parseDiffNameStatus,
  parsePorcelainStatus,
  planCheckPrRuntimeTests,
  partitionSpecsByE2ePass,
  selectChangedRuntimeTests,
  selectE2eSpecs,
} from '../check-pr.mjs';

const DESCRIPTORS = [
  {
    format: 'freedom.module/v1',
    module_id: 'beta-mod',
    owner_role: 'member',
    owned_paths: ['modules/beta/**', 'tests/runtime/beta.test.ts'],
    public_exports: [],
    dependencies: [],
    contract_families: ['preview'],
    client_profiles: ['member'],
    instructions: ['governance/README.md'],
    invariants: ['local-only'],
    tests: ['runtime.full'],
    surfaces: [],
  },
  {
    format: 'freedom.module/v1',
    module_id: 'alpha-mod',
    owner_role: 'member',
    owned_paths: ['modules/alpha/**', 'apps/portal-web/src/modules/alpha/index.tsx'],
    public_exports: [],
    dependencies: [],
    contract_families: ['preview'],
    client_profiles: ['member'],
    instructions: ['governance/README.md'],
    invariants: ['local-only'],
    tests: ['runtime.full'],
    surfaces: [],
  },
];

test('parseCheckPrArgs parses flags and rejects invalid inputs', () => {
  assert.deepEqual(parseCheckPrArgs([]), {
    ok: true,
    baseRef: null,
    keepGoing: false,
    runE2e: false,
    help: false,
    error: null,
  });
  assert.deepEqual(parseCheckPrArgs(['--base', 'origin/main', '--keep-going', '--e2e']), {
    ok: true,
    baseRef: 'origin/main',
    keepGoing: true,
    runE2e: true,
    help: false,
    error: null,
  });
  assert.deepEqual(parseCheckPrArgs(['--base=HEAD~2', '-h']), {
    ok: true,
    baseRef: 'HEAD~2',
    keepGoing: false,
    runE2e: false,
    help: true,
    error: null,
  });
  assert.equal(parseCheckPrArgs(['--base']).ok, false);
  assert.equal(parseCheckPrArgs(['--unknown']).ok, false);
  assert.equal(parseCheckPrArgs(['positional']).ok, false);
});

test('groupFilesByModule groups paths by descriptor owns and tracks unowned files', () => {
  const result = groupFilesByModule(
    [
      'modules/beta/service.ts',
      'README.md',
      'modules/alpha/a.ts',
      'apps/portal-web/src/modules/alpha/index.tsx',
      'tests/runtime/beta.test.ts',
    ],
    DESCRIPTORS,
  );
  assert.deepEqual(result.groups, [
    {
      moduleId: 'alpha-mod',
      files: [
        'apps/portal-web/src/modules/alpha/index.tsx',
        'modules/alpha/a.ts',
      ],
    },
    {
      moduleId: 'beta-mod',
      files: [
        'modules/beta/service.ts',
        'tests/runtime/beta.test.ts',
      ],
    },
  ]);
  assert.deepEqual(result.unowned, ['README.md']);
});

test('decline sentence map covers known codes and prints unknown code verbatim', () => {
  const expectedCodes = [
    'non_pull_request',
    'non_overridable_decision',
    'missing_lane_context',
    'empty_changes',
    'too_many_paths',
    'non_regular_or_executable_blob',
    'descriptors_changed_or_unproven',
    'disallowed_change_status',
    'duplicate_path',
    'disallowed_path',
    'unowned_module_path',
    'ineligible_module',
    'e2e_imports_changed_runtime',
    'e2e_import_graph_unproven',
    'missing_catalog',
    'missing_smoke_or_fixture_spec',
    'too_many_e2e_files',
  ];
  for (const code of expectedCodes) {
    assert.equal(typeof LANE_DECLINE_SENTENCES[code], 'string');
    assert.equal(LANE_DECLINE_SENTENCES[code].length > 0, true);
    assert.equal(describeDeclineCode(code), LANE_DECLINE_SENTENCES[code]);
  }
  assert.equal(describeDeclineCode('future_unknown_code').includes('future_unknown_code'), true);
});

test('formatLaneDecision formats module lane and full check messages with estimate label', () => {
  const admitted = formatLaneDecision({
    admitted: true,
    reason: 'module_affected',
    files: ['tests/e2e/a.spec.ts', 'tests/e2e/b.spec.ts'],
  });
  assert.equal(admitted.includes('這個 PR 會走模組快速通道'), true);
  assert.equal(admitted.includes('2'), true);
  assert.equal(admitted.includes('預估'), true);

  const declined = formatLaneDecision({
    admitted: false,
    decline: 'ineligible_module',
  });
  assert.equal(declined.includes('這個 PR 會跑完整檢查'), true);
  assert.equal(declined.includes(LANE_DECLINE_SENTENCES.ineligible_module), true);
  assert.equal(declined.includes('預估'), true);
});

test('parseDiffNameStatus, parsePorcelainStatus, and mergeWorkingChanges normalize git changes', () => {
  const committed = parseDiffNameStatus(
    ['M', 'modules/alpha/a.ts', 'R100', 'modules/alpha/old.ts', 'modules/alpha/new.ts', 'D', 'modules/alpha/gone.ts', ''].join('\0'),
  );
  assert.deepEqual(committed, [
    { status: 'M', path: 'modules/alpha/a.ts' },
    { status: 'R', path: 'modules/alpha/new.ts', previousPath: 'modules/alpha/old.ts' },
    { status: 'D', path: 'modules/alpha/gone.ts' },
  ]);

  const uncommitted = parsePorcelainStatus(
    [' M modules/alpha/a.ts', '?? modules/alpha/extra.ts', '!! ignored.log', ''].join('\0'),
  );
  assert.deepEqual(uncommitted, [
    { status: 'M', path: 'modules/alpha/a.ts' },
    { status: 'A', path: 'modules/alpha/extra.ts' },
  ]);

  const merged = mergeChangesHelper();
  assert.equal(merged.length, 4);
  function mergeChangesHelper() {
    return mergeWorkingChanges(committed, uncommitted);
  }
});

const DIRECT_MESSAGES_SOURCE = 'apps/portal-web/src/modules/MemberMessages.tsx';
const DIRECT_LIST_RENDER_TEST = 'tests/runtime/direct-list-render.test.ts';

test('source-only MemberMessages changes select the four curated no-database checks', () => {
  assert.deepEqual(planCheckPrRuntimeTests([{ status: 'M', path: DIRECT_MESSAGES_SOURCE }]), [
    { file: 'tests/runtime/chat-sticker-send.test.ts', requiresDatabase: false },
    { file: 'tests/runtime/direct-list-poll-isolation.test.ts', requiresDatabase: false },
    { file: DIRECT_LIST_RENDER_TEST, requiresDatabase: false },
    { file: 'tests/runtime/direct-message-receipts.test.ts', requiresDatabase: false },
  ]);
  assert.deepEqual(planCheckPrRuntimeTests([{ status: 'M', path: 'apps/portal-web/src/modules/Other.tsx' }]), []);
});

test('runtime pilot deduplicates explicitly changed suites and does not reclassify unrelated tests', () => {
  const mixed = [
    { status: 'M', path: DIRECT_MESSAGES_SOURCE },
    { status: 'M', path: DIRECT_LIST_RENDER_TEST },
    { status: 'M', path: 'tests/runtime/community.test.ts' },
    { status: 'D', path: 'tests/runtime/unrelated-removed.test.ts' },
  ];
  const planned = planCheckPrRuntimeTests(mixed);
  assert.equal(planned.length, 5);
  assert.equal(planned.filter(test => test.file === DIRECT_LIST_RENDER_TEST).length, 1);
  assert.deepEqual(planned.filter(test => test.requiresDatabase), [
    { file: 'tests/runtime/community.test.ts', requiresDatabase: true },
  ]);
  assert.deepEqual(planCheckPrRuntimeTests(mixed.slice(1)), [
    { file: 'tests/runtime/community.test.ts', requiresDatabase: true },
    { file: DIRECT_LIST_RENDER_TEST, requiresDatabase: false },
  ]);
});

test('deleted or renamed curated suites remain required by the local runtime gate', () => {
  assert.deepEqual(planCheckPrRuntimeTests([{ status: 'D', path: DIRECT_LIST_RENDER_TEST }]), [
    { file: DIRECT_LIST_RENDER_TEST, requiresDatabase: false },
  ]);
  assert.deepEqual(planCheckPrRuntimeTests([
    { status: 'R', previousPath: DIRECT_LIST_RENDER_TEST, path: 'tests/runtime/replacement.test.ts' },
  ]), [
    { file: DIRECT_LIST_RENDER_TEST, requiresDatabase: false },
    { file: 'tests/runtime/replacement.test.ts', requiresDatabase: true },
  ]);
});

test('runtime test selection, e2e spec selection, and summary stay bounded and accurate', () => {
  const changes = [
    { status: 'M', path: 'tests/runtime/alpha.test.ts' },
    { status: 'D', path: 'tests/runtime/removed.test.ts' },
    { status: 'A', path: 'tests/e2e/alpha.spec.ts' },
    { status: 'M', path: 'tests/e2e/private-work-ai.spec.ts' },
    { status: 'D', path: 'tests/e2e/gone.spec.ts' },
  ];
  assert.deepEqual(selectChangedRuntimeTests(changes), ['tests/runtime/alpha.test.ts']);

  assert.deepEqual(
    selectE2eSpecs({ lane: { admitted: true, files: ['tests/e2e/calm-experience.spec.ts'] }, changes }),
    ['tests/e2e/calm-experience.spec.ts'],
  );
  const declinedSpecs = selectE2eSpecs({ lane: { admitted: false, decline: 'disallowed_path' }, changes });
  assert.deepEqual(declinedSpecs, ['tests/e2e/alpha.spec.ts', 'tests/e2e/private-work-ai.spec.ts']);

  const passes = partitionSpecsByE2ePass(declinedSpecs);
  assert.deepEqual(
    passes.map(pass => ({ id: pass.id, files: pass.files, hasFixtureEnv: Object.keys(pass.env).length > 0 })),
    [
      { id: 'default', files: ['tests/e2e/alpha.spec.ts'], hasFixtureEnv: false },
      { id: 'private-ai', files: ['tests/e2e/private-work-ai.spec.ts'], hasFixtureEnv: true },
    ],
  );

  const summary = formatSummaryLines({
    passedChecks: ['contracts:build', 'typecheck'],
    failedChecks: [],
    skippedChecks: ['check:runtime-text'],
    lane: { admitted: true, files: ['tests/e2e/a.spec.ts'] },
    uncommittedCount: 1,
    ranE2e: false,
  });
  const lines = summary.split('\n').filter(Boolean);
  assert.equal(lines.length >= 3 && lines.length <= 5, true);
  assert.equal(summary.includes('contracts:build'), true);
  assert.equal(summary.includes('模組快速通道'), true);
});

test('extractStaticImportSpecifiersFallback extracts static imports and ignores comments and non-literals', () => {
  const source = [
    '// import { ignored } from "../runtime/commented.js";',
    '/* export * from "../runtime/block-comment.js"; */',
    'import { a } from "../runtime/alpha.js";',
    'import "../runtime/side-effect.js";',
    'export { b } from "../runtime/beta.js";',
    'const c = await import("../runtime/dynamic-literal.js");',
    'const d = require("../runtime/cjs-literal.js");',
    'const dyn = await import(someVar);',
    'const dynReq = require(otherVar);',
  ].join('\n');
  assert.deepEqual(extractStaticImportSpecifiersFallback(source), [
    '../runtime/alpha.js',
    '../runtime/side-effect.js',
    '../runtime/beta.js',
    '../runtime/dynamic-literal.js',
    '../runtime/cjs-literal.js',
  ]);
});
