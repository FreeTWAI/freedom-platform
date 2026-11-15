import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULE_LANE_CORE,
  MODULE_LANE_MAX_DEPENDENTS,
  MODULE_LANE_MAX_FILES,
  MODULE_LANE_MAX_PATHS,
  MODULE_LANE_SMOKE_FILES,
  MODULE_LANE_OVERRIDABLE_REASONS,
  classifyLanePath,
  laneEligible,
  narrowedSpecFiles,
  decideModuleLane,
  collectE2eRuntimeImports,
} from '../module-lane.mjs';
import { E2E_PLAN } from '../pinned-e2e.mjs';
import { loadGuildPresentationParsers } from '../guild-presentation-profile.mjs';
import { ROOT_INSTRUCTIONS, isModuleDescriptorPath } from '../context.mjs';
import {
  FULL_SCOPE,
  RUNTIME_TEXT,
  isDocsAllowlisted,
  safeRepoPath,
  hiddenSegment,
} from '../../../scripts/ci/select-affected-jobs.mjs';

const LANE_CONTEXT = Object.freeze({
  fullScope: FULL_SCOPE,
  runtimeText: RUNTIME_TEXT,
  rootInstructions: ROOT_INSTRUCTIONS,
  isDocsAllowlisted,
  safeRepoPath,
  hiddenSegment,
  isModuleDescriptorPath,
});

const FIXTURE_FILES = Object.freeze(E2E_PLAN.slice(1).flatMap(pass => pass.files));

function makeDescriptor(id, paths = [`modules/${id}/**`], dependencies = []) {
  return {
    format: 'freedom.module/v1',
    module_id: id,
    owner_role: 'foundation',
    owned_paths: paths,
    public_exports: [],
    dependencies,
    contract_families: ['preview'],
    client_profiles: ['member'],
    instructions: ['governance/README.md'],
    invariants: ['local-only'],
    tests: ['runtime.full'],
    surfaces: [],
  };
}

function baseCatalog(extra = []) {
  return [...new Set([...MODULE_LANE_SMOKE_FILES, ...FIXTURE_FILES, ...extra])].sort();
}

const EXPECTED_CORE = [
  'application-composition', 'portal-shell', 'shared', 'platform-host',
  'platform-api-features', 'portal-features', 'command-core', 'tenant-workspaces',
  'newcomer-guides', 'public-guide-assets', 'e2e-harness', 'google-identity-ui',
  'member-profile-ui', 'member-communications-ui', 'platform-helper', 'module-registry',
  'runtime-registration', 'governance', 'shared-release', 'preview-contract',
  'local-demo-data', 'guild-presentation', 'guild-supply', 'guild-open-source', 'guild-events',
];

const EXPECTED_OVERRIDABLE = [
  'not_docs_allowlist',
  'baseline_candidate_union',
  'leaf_profile_unproven',
  'governance_security_or_shared_runtime',
  'excluded_test_spec_or_config',
];

test('module-lane exports frozen constants and exact policy values', () => {
  assert.equal(Object.isFrozen(MODULE_LANE_CORE), true);
  assert.deepEqual([...MODULE_LANE_CORE], EXPECTED_CORE);
  assert.equal(MODULE_LANE_MAX_DEPENDENTS, 9);
  assert.equal(MODULE_LANE_MAX_FILES, 80);
  assert.equal(MODULE_LANE_MAX_PATHS, 200);
  assert.equal(Object.isFrozen(MODULE_LANE_OVERRIDABLE_REASONS), true);
  assert.deepEqual([...MODULE_LANE_OVERRIDABLE_REASONS], EXPECTED_OVERRIDABLE);
  assert.equal(Object.isFrozen(MODULE_LANE_SMOKE_FILES), true);
  assert.equal(MODULE_LANE_SMOKE_FILES.length >= 6 && MODULE_LANE_SMOKE_FILES.length <= 10, true);
  for (const file of MODULE_LANE_SMOKE_FILES) {
    assert.match(file, /^tests\/e2e\/[a-z0-9]+(?:-[a-z0-9]+)*\.spec\.ts$/);
  }
});

test('classifyLanePath classifies runtime tests, specs, docs, module files and rejects disallowed paths', () => {
  assert.equal(classifyLanePath('tests/runtime/community-journal.test.ts', LANE_CONTEXT), 'runtime-test');
  assert.equal(classifyLanePath('tests/runtime/a_b-1.test.ts', LANE_CONTEXT), 'runtime-test');
  assert.equal(classifyLanePath('tests/runtime/nested/foo.test.ts', LANE_CONTEXT), null);
  assert.equal(classifyLanePath('tests/runtime/helper.ts', LANE_CONTEXT), null);

  assert.equal(classifyLanePath('tests/e2e/community-journal.spec.ts', LANE_CONTEXT), 'spec');
  assert.equal(classifyLanePath('tests/e2e/fixtures.ts', LANE_CONTEXT), null);
  assert.equal(classifyLanePath('tests/e2e/nested/foo.spec.ts', LANE_CONTEXT), null);
  assert.equal(classifyLanePath('tests/e2e/bad_name.spec.ts', LANE_CONTEXT), null);

  assert.equal(classifyLanePath('docs/development/community-journal.md', LANE_CONTEXT), 'docs');
  assert.equal(classifyLanePath('docs/overview.md', LANE_CONTEXT), 'docs');
  assert.equal(classifyLanePath('docs/platform-plan/notes.md', LANE_CONTEXT), null);
  assert.equal(classifyLanePath('README.md', LANE_CONTEXT), null);
  assert.equal(classifyLanePath('AGENTS.md', LANE_CONTEXT), null);

  for (const ext of ['.ts', '.tsx', '.css', '.md', '.svg', '.png', '.webp', '.jpg', '.jpeg', '.gif', '.glb', '.wasm', '.mp3', '.ogg', '.woff2']) {
    assert.equal(classifyLanePath(`modules/community-journal/asset${ext}`, LANE_CONTEXT), 'module', `expected module for ${ext}`);
    assert.equal(classifyLanePath(`apps/portal-web/src/journal/view${ext}`, LANE_CONTEXT), 'module', `expected app module for ${ext}`);
  }

  for (const bad of [
    'modules/identity-membership/index.ts',
    'modules/platform-admin/index.ts',
    'apps/credential-broker/index.ts',
    'apps/platform-api/src/worker-private-ai.ts',
    'packages/shared/index.ts',
    'packages/contribution-tools/module-lane.mjs',
    'apps/portal-web/src/modules/GitHubSocial.css',
    'modules/community-journal/freedom.module.json',
    'modules/community-journal/package.json',
    'modules/community-journal/package-lock.json',
    'modules/community-journal/tsconfig.json',
    'modules/community-journal/tsconfig.app.json',
    'modules/community-journal/vite.config.ts',
    'modules/community-journal/playwright.config.ts',
    'modules/community-journal/.npmrc',
    'modules/community-journal/eslint.config.mjs',
    'apps/portal-web/tailwind.config.js',
    'modules/community-journal/script.js',
    'modules/community-journal/mod.mjs',
    'modules/community-journal/data.json',
    'modules/community-journal/query.sql',
    'modules/community-journal/page.html',
    'modules/community-journal/.hidden.ts',
    'apps/.hidden/file.ts',
    '../modules/community-journal/file.ts',
    '/modules/community-journal/file.ts',
  ]) {
    assert.equal(classifyLanePath(bad, LANE_CONTEXT), null, `expected null for ${bad}`);
  }
});

test('laneEligible excludes core list and modules with 10 or more direct dependents', () => {
  const leaf = makeDescriptor('leaf-feature');
  const nineDeps = Array.from({ length: 9 }, (_, i) => makeDescriptor(`dep-${i}`, [`modules/dep-${i}/**`], ['leaf-feature']));
  assert.equal(laneEligible('leaf-feature', [leaf, ...nineDeps]), true);

  const tenDeps = [...nineDeps, makeDescriptor('dep-9', ['modules/dep-9/**'], ['leaf-feature'])];
  assert.equal(laneEligible('leaf-feature', [leaf, ...tenDeps]), false);

  for (const coreId of MODULE_LANE_CORE) {
    assert.equal(laneEligible(coreId, [makeDescriptor(coreId)]), false, `expected core ${coreId} ineligible`);
  }
});

test('narrowedSpecFiles builds sorted unique union of changedSpecs, owned catalog specs, smoke, and fixtures', () => {
  const descriptors = [
    makeDescriptor('community-journal', ['modules/community-journal/**', 'tests/e2e/community-journal.spec.ts']),
    makeDescriptor('other-feature', ['modules/other-feature/**', 'tests/e2e/other-feature.spec.ts']),
  ];
  const catalog = baseCatalog([
    'tests/e2e/community-journal.spec.ts',
    'tests/e2e/other-feature.spec.ts',
    'tests/e2e/extra-changed.spec.ts',
  ]);
  const files = narrowedSpecFiles({
    descriptors,
    changedSpecs: ['tests/e2e/extra-changed.spec.ts', MODULE_LANE_SMOKE_FILES[0]],
    ownerIds: ['community-journal'],
    catalog,
    fixtureFiles: FIXTURE_FILES,
  });
  const expected = [...new Set([
    'tests/e2e/extra-changed.spec.ts',
    'tests/e2e/community-journal.spec.ts',
    ...MODULE_LANE_SMOKE_FILES,
    ...FIXTURE_FILES,
  ])].sort();
  assert.deepEqual(files, expected);
  assert.equal(files.includes('tests/e2e/other-feature.spec.ts'), false);
});

test('decideModuleLane admits qualifying module PRs across overridable reasons and declines non-qualifying cases', () => {
  const journal = makeDescriptor('community-journal', [
    'modules/community-journal/**',
    'tests/e2e/community-journal.spec.ts',
  ]);
  const core = makeDescriptor('portal-shell', ['apps/portal-web/src/shell/**']);
  const sharedOwner = makeDescriptor('shared-owner-leaf', ['modules/dual/**']);
  const sharedOwnerCore = makeDescriptor('portal-shell', ['apps/portal-web/src/shell/**', 'modules/dual/**']);
  const popular = makeDescriptor('popular-leaf', ['modules/popular/**']);
  const tenDeps = Array.from({ length: 10 }, (_, i) => makeDescriptor(`d-${i}`, [`modules/d-${i}/**`], ['popular-leaf']));
  const baseline = [journal, core, sharedOwner, popular, ...tenDeps];
  const candidate = baseline.map(d => ({ ...d }));
  const catalog = baseCatalog(['tests/e2e/community-journal.spec.ts', 'tests/e2e/unowned-extra.spec.ts']);

  for (const reason of MODULE_LANE_OVERRIDABLE_REASONS) {
    const res = decideModuleLane({
      event: 'pull_request',
      existingDecision: { mode: 'full', reason },
      changes: [
        { path: 'modules/community-journal/service.ts', status: 'M' },
        { path: 'tests/runtime/community-journal.test.ts', status: 'A' },
        { path: 'tests/e2e/unowned-extra.spec.ts', status: 'M' },
        { path: 'docs/development/community-journal.md', status: 'M' },
      ],
      baseline,
      candidate,
      catalog,
      fixtureFiles: FIXTURE_FILES,
      e2eRuntimeImports: new Set(),
      nonExecutableBlobsProven: true,
      context: LANE_CONTEXT,
    });
    assert.equal(res.admitted, true, `expected admitted for ${reason}`);
    assert.equal(res.reason, 'module_affected');
    assert.equal(res.files.includes('tests/e2e/community-journal.spec.ts'), true);
    assert.equal(res.files.includes('tests/e2e/unowned-extra.spec.ts'), true);
  }

  // Runtime-test-only PR -> smoke + fixtures only
  const rtOnly = decideModuleLane({
    event: 'pull_request',
    existingDecision: { mode: 'full', reason: 'governance_security_or_shared_runtime' },
    changes: [{ path: 'tests/runtime/community-journal.test.ts', status: 'M' }],
    baseline,
    candidate,
    catalog,
    fixtureFiles: FIXTURE_FILES,
    e2eRuntimeImports: new Set(),
    nonExecutableBlobsProven: true,
    context: LANE_CONTEXT,
  });
  assert.equal(rtOnly.admitted, true);
  assert.deepEqual(rtOnly.files, [...new Set([...MODULE_LANE_SMOKE_FILES, ...FIXTURE_FILES])].sort());

  // Negative cases
  const baseArgs = {
    event: 'pull_request',
    existingDecision: { mode: 'full', reason: 'not_docs_allowlist' },
    changes: [{ path: 'modules/community-journal/service.ts', status: 'M' }],
    baseline,
    candidate,
    catalog,
    fixtureFiles: FIXTURE_FILES,
    e2eRuntimeImports: new Set(),
    nonExecutableBlobsProven: true,
    context: LANE_CONTEXT,
  };

  assert.equal(decideModuleLane({ ...baseArgs, event: 'push' }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, event: 'merge_group' }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, existingDecision: { mode: 'docs', reason: 'docs_allowlist' } }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, existingDecision: { mode: 'full', reason: 'root_instruction' } }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, existingDecision: { mode: 'full', reason: 'diff_unproven' } }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, existingDecision: { mode: 'full', reason: 'guild_impact_unproven' } }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, changes: [] }).admitted, false);
  assert.equal(decideModuleLane({
    ...baseArgs,
    changes: Array.from({ length: 201 }, (_, i) => ({ path: `modules/community-journal/f${i}.ts`, status: 'A' })),
  }).admitted, false);
  assert.equal(decideModuleLane({
    ...baseArgs,
    changes: Array.from({ length: 200 }, (_, i) => ({ path: `modules/community-journal/f${i}.ts`, status: 'A' })),
  }).admitted, true);

  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'modules/community-journal/a.ts', status: 'D' }] }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'modules/community-journal/a.ts', status: 'R', previousPath: 'modules/community-journal/b.ts' }] }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'modules/community-journal/a.ts', status: 'C', previousPath: 'modules/community-journal/b.ts' }] }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'modules/community-journal/a.ts', status: 'M', mode: '100755' }] }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, nonExecutableBlobsProven: false }).admitted, false);

  // Descriptor change
  const changedCand = candidate.map(d => d.module_id === 'community-journal' ? { ...d, owned_paths: ['modules/community-journal/**', 'docs/x.md'] } : d);
  assert.equal(decideModuleLane({ ...baseArgs, candidate: changedCand }).admitted, false);

  // Core module, 10 dependents, unowned, packages, spec helper, config, unknown extension
  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'apps/portal-web/src/shell/app.tsx', status: 'M' }] }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'modules/popular/a.ts', status: 'M' }] }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'modules/unowned/a.ts', status: 'M' }] }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'packages/foo/a.ts', status: 'M' }] }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'tests/e2e/fixtures.ts', status: 'M' }] }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'modules/community-journal/package.json', status: 'M' }] }).admitted, false);
  assert.equal(decideModuleLane({ ...baseArgs, changes: [{ path: 'modules/community-journal/data.json', status: 'M' }] }).admitted, false);

  // Owned by two descriptors where one is core
  const dualBase = [sharedOwner, sharedOwnerCore];
  assert.equal(decideModuleLane({
    ...baseArgs,
    baseline: dualBase,
    candidate: dualBase.map(d => ({ ...d })),
    changes: [{ path: 'modules/dual/file.ts', status: 'M' }],
  }).admitted, false);

  // Runtime test inside e2eRuntimeImports
  assert.equal(decideModuleLane({
    ...baseArgs,
    changes: [{ path: 'tests/runtime/community-journal.test.ts', status: 'M' }],
    e2eRuntimeImports: new Set(['tests/runtime/community-journal.test.ts']),
  }).admitted, false);

  // Missing smoke file from catalog
  assert.equal(decideModuleLane({
    ...baseArgs,
    catalog: catalog.filter(f => f !== MODULE_LANE_SMOKE_FILES[0]),
  }).admitted, false);

  // 80-file bound (exact 80 passes, 81 declines)
  const baseCount = new Set([...MODULE_LANE_SMOKE_FILES, ...FIXTURE_FILES, 'tests/e2e/community-journal.spec.ts']).size;
  const needFor80 = MODULE_LANE_MAX_FILES - baseCount;
  const exact80Extras = Array.from({ length: needFor80 }, (_, i) => `tests/e2e/extra-${String(i).padStart(3, '0')}.spec.ts`);
  const over80Extras = [...exact80Extras, 'tests/e2e/extra-overflow.spec.ts'];
  const at80 = decideModuleLane({
    ...baseArgs,
    changes: [
      { path: 'modules/community-journal/service.ts', status: 'M' },
      ...exact80Extras.map(path => ({ path, status: 'A' })),
    ],
    catalog: baseCatalog(['tests/e2e/community-journal.spec.ts', ...exact80Extras]),
  });
  assert.equal(at80.admitted, true);
  assert.equal(at80.files.length, 80);

  const at81 = decideModuleLane({
    ...baseArgs,
    changes: [
      { path: 'modules/community-journal/service.ts', status: 'M' },
      ...over80Extras.map(path => ({ path, status: 'A' })),
    ],
    catalog: baseCatalog(['tests/e2e/community-journal.spec.ts', ...over80Extras]),
  });
  assert.equal(at81.admitted, false);
});

test('collectE2eRuntimeImports traverses e2e -> e2e helper -> runtime chain and stops at bound', () => {
  const files = new Map([
    ['tests/e2e/sample.spec.ts', ['import "./helper.js";', 'await import(dynamicVar);']],
    ['tests/e2e/helper.ts', ['export { x } from "../runtime/shared-fixture.js";']],
    ['tests/runtime/shared-fixture.ts', ['import "./nested-helper.js";']],
    ['tests/runtime/nested-helper.ts', ['import "../../modules/foo/bar.js";']],
    ['tests/runtime/community-journal.test.ts', []],
    ['modules/foo/bar.ts', ['import "../../tests/runtime/unreachable-via-module.js";']],
    ['tests/runtime/unreachable-via-module.ts', []],
  ]);
  const reached = collectE2eRuntimeImports({
    listFiles: () => [...files.keys()],
    readFile: path => (files.get(path) ?? []).join('\n'),
    extractSpecifiers: source => source.split('\n').flatMap(line => {
      const m = line.match(/(?:from\s+|import\s+)['"]([^'"]+)['"]/);
      return m ? [m[1]] : [];
    }),
  });
  assert.equal(reached instanceof Set, true);
  assert.deepEqual([...reached].sort(), [
    'tests/runtime/nested-helper.ts',
    'tests/runtime/shared-fixture.ts',
  ]);
  assert.equal(reached.has('tests/runtime/community-journal.test.ts'), false);
  assert.equal(reached.has('tests/runtime/unreachable-via-module.ts'), false);

  // Stops fail-closed at the 3000-file read bound
  const overBound = Array.from({ length: 3001 }, (_, i) => `tests/e2e/spec-${i}.spec.ts`);
  assert.equal(collectE2eRuntimeImports({
    listFiles: () => overBound,
    readFile: () => '',
    extractSpecifiers: () => [],
  }), null);
});

test('decideModuleLane enforces e2eRuntimeImports set membership and missing set fail-closed', () => {
  const journal = makeDescriptor('community-journal', [
    'modules/community-journal/**',
    'tests/e2e/community-journal.spec.ts',
  ]);
  const baseline = [journal];
  const candidate = [makeDescriptor('community-journal', [
    'modules/community-journal/**',
    'tests/e2e/community-journal.spec.ts',
  ])];
  const catalog = baseCatalog(['tests/e2e/community-journal.spec.ts']);
  const common = {
    event: 'pull_request',
    existingDecision: { mode: 'full', reason: 'governance_security_or_shared_runtime' },
    baseline,
    candidate,
    catalog,
    fixtureFiles: FIXTURE_FILES,
    nonExecutableBlobsProven: true,
    context: LANE_CONTEXT,
  };

  // Changed runtime test outside the set is admitted
  const outside = decideModuleLane({
    ...common,
    changes: [{ path: 'tests/runtime/community-journal.test.ts', status: 'M' }],
    e2eRuntimeImports: new Set(['tests/runtime/shared-fixture.ts']),
  });
  assert.equal(outside.admitted, true);
  assert.equal(outside.reason, 'module_affected');

  // Changed runtime test inside the set declines e2e_imports_changed_runtime
  const inside = decideModuleLane({
    ...common,
    changes: [{ path: 'tests/runtime/community-journal.test.ts', status: 'M' }],
    e2eRuntimeImports: new Set(['tests/runtime/community-journal.test.ts']),
  });
  assert.deepEqual(inside, { admitted: false, decline: 'e2e_imports_changed_runtime' });

  // Missing set declines e2e_import_graph_unproven
  const missing = decideModuleLane({
    ...common,
    changes: [{ path: 'tests/runtime/community-journal.test.ts', status: 'M' }],
    e2eRuntimeImports: undefined,
  });
  assert.deepEqual(missing, { admitted: false, decline: 'e2e_import_graph_unproven' });

  // Non-literal import/require alone (empty reached runtime set) does not decline
  const ts = loadGuildPresentationParsers()?.ts;
  const nonLiteralOnly = decideModuleLane({
    ...common,
    changes: [{ path: 'tests/runtime/community-journal.test.ts', status: 'M' }],
    e2eRuntimeImports: collectE2eRuntimeImports({
      listFiles: () => ['tests/e2e/community-journal.spec.ts'],
      readFile: () => 'const x = "./y.js"; await import(x); require(x);',
      extractSpecifiers: ts
        ? source => ts.preProcessFile(source, true, true).importedFiles.map(({ fileName }) => fileName)
        : () => [],
    }),
  });
  assert.equal(nonLiteralOnly.admitted, true);
  assert.equal(nonLiteralOnly.reason, 'module_affected');
});

test('narrowedSpecFiles includes direct and transitive dependent module specs and enforces 80-file bound', () => {
  const descriptors = [
    makeDescriptor('leaf-base', ['modules/leaf-base/**', 'tests/e2e/leaf-base.spec.ts']),
    makeDescriptor('direct-dep', ['modules/direct-dep/**', 'tests/e2e/direct-dep.spec.ts'], ['leaf-base']),
    makeDescriptor('transitive-dep', ['modules/transitive-dep/**', 'tests/e2e/transitive-dep.spec.ts'], ['direct-dep']),
    makeDescriptor('unrelated', ['modules/unrelated/**', 'tests/e2e/unrelated.spec.ts']),
  ];
  const catalog = baseCatalog([
    'tests/e2e/leaf-base.spec.ts',
    'tests/e2e/direct-dep.spec.ts',
    'tests/e2e/transitive-dep.spec.ts',
    'tests/e2e/unrelated.spec.ts',
  ]);
  const files = narrowedSpecFiles({
    descriptors,
    ownerIds: ['leaf-base'],
    catalog,
    fixtureFiles: FIXTURE_FILES,
  });
  assert.equal(files.includes('tests/e2e/leaf-base.spec.ts'), true);
  assert.equal(files.includes('tests/e2e/direct-dep.spec.ts'), true);
  assert.equal(files.includes('tests/e2e/transitive-dep.spec.ts'), true);
  assert.equal(files.includes('tests/e2e/unrelated.spec.ts'), false);

  // Leaf with no dependents keeps the same list
  const leafFiles = narrowedSpecFiles({
    descriptors,
    ownerIds: ['unrelated'],
    catalog,
    fixtureFiles: FIXTURE_FILES,
  });
  assert.equal(leafFiles.includes('tests/e2e/unrelated.spec.ts'), true);
  assert.equal(leafFiles.includes('tests/e2e/leaf-base.spec.ts'), false);

  // Big dependent closure declines too_many_e2e_files
  const manySpecs = Array.from({ length: 75 }, (_, i) => `tests/e2e/dep-spec-${String(i).padStart(2, '0')}.spec.ts`);
  const bigDescriptors = [
    makeDescriptor('leaf-base', ['modules/leaf-base/**']),
    makeDescriptor('direct-dep', ['modules/direct-dep/**', ...manySpecs], ['leaf-base']),
  ];
  const bigDecline = decideModuleLane({
    event: 'pull_request',
    existingDecision: { mode: 'full', reason: 'not_docs_allowlist' },
    changes: [{ path: 'modules/leaf-base/a.ts', status: 'M' }],
    baseline: bigDescriptors,
    candidate: bigDescriptors.map(d => ({ ...d })),
    catalog: baseCatalog(manySpecs),
    fixtureFiles: FIXTURE_FILES,
    e2eRuntimeImports: new Set(),
    nonExecutableBlobsProven: true,
    context: LANE_CONTEXT,
  });
  assert.deepEqual(bigDecline, { admitted: false, decline: 'too_many_e2e_files' });
});

test('decideModuleLane fails closed when nonExecutableBlobsProven is not strictly true', () => {
  const journal = makeDescriptor('community-journal', [
    'modules/community-journal/**',
    'tests/e2e/community-journal.spec.ts',
  ]);
  const baseline = [journal];
  const candidate = [makeDescriptor('community-journal', [
    'modules/community-journal/**',
    'tests/e2e/community-journal.spec.ts',
  ])];
  const base = {
    event: 'pull_request',
    existingDecision: { mode: 'full', reason: 'not_docs_allowlist' },
    changes: [{ path: 'modules/community-journal/service.ts', status: 'M' }],
    baseline,
    candidate,
    catalog: baseCatalog(['tests/e2e/community-journal.spec.ts']),
    fixtureFiles: FIXTURE_FILES,
    e2eRuntimeImports: new Set(),
    nonExecutableBlobsProven: true,
    context: LANE_CONTEXT,
  };
  assert.deepEqual(
    decideModuleLane({ ...base, nonExecutableBlobsProven: undefined }),
    { admitted: false, decline: 'non_regular_or_executable_blob' },
  );
  assert.deepEqual(
    decideModuleLane({ ...base, nonExecutableBlobsProven: null }),
    { admitted: false, decline: 'non_regular_or_executable_blob' },
  );
  assert.equal(decideModuleLane({ ...base, nonExecutableBlobsProven: true }).admitted, true);
});
