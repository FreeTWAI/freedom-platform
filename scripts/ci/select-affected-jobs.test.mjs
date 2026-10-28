import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDescriptor, ROOT_INSTRUCTIONS, selectImpact, owns } from '../../packages/contribution-tools/context.mjs';
import {
  ALWAYS_ON_INTEGRITY_COMMANDS, DOCS_ALLOWLIST_PREFIXES, GENERATED_INVENTORY_PATH, JOB_OUTPUT_KEYS, SELECTABLE_JOBS, FRONTEND_LEAF_PROFILES, FRONTEND_LEAF_JOBS,
  changesFromTrees, collectRepositoryDecision, collectRepositoryE2eDecision, decideE2eProfile, decideAffectedJobs, evaluateVerifyAggregate, githubOutput,
  deliveryDailyRegistryAddition, deliveryVerifyWiringOnly, deliveryCoverageProven, heavyJobCondition, isDocsAllowlisted, loadModuleDescriptors, parseLsTreeZ, parseNameStatusZ,
  MINIMAL_JOB_PROFILES, decideMinimalProfile, decideCiToolsProfile, ciToolsWorkflowProven, ciToolsSchemaProven,
  decideBrowserSpecProfile, ciToolsBrowserRegistryProven, storeSpecDependenciesProven,
} from './select-affected-jobs.mjs';

import { GUIDE_COMPOSITION_PROFILE } from '../../packages/contribution-tools/pinned-e2e.mjs';
import { PINNED_SUITES } from '../../packages/contribution-tools/pinned-suites.mjs';
import { verificationEnvironment } from '../../packages/contribution-tools/process-env.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const selector = fileURLToPath(new URL('./select-affected-jobs.mjs', import.meta.url));
const workflowPath = join(root, '.github/workflows/verify.yml');
const PINNED_BROWSER_PARSER_INSTALL = "      - name: Install pinned browser selector dependencies\n        if: ${{ needs.select.outputs.reason == 'browser_specs_only' }}\n        working-directory: .freedom/trusted\n        run: npm ci --ignore-scripts --no-audit --no-fund\n";
const oid = (suffix = 'a') => suffix.repeat(40).slice(0, 40);
const narrow = () => [moduleDescriptor('example', ['modules/example/**'])];

function moduleDescriptor(id, paths, extra = {}) {
  return {
    format: 'freedom.module/v1', module_id: id, owner_role: 'foundation', owned_paths: paths,
    public_exports: [], dependencies: extra.dependencies ?? [], contract_families: ['preview'],
    client_profiles: ['member'], instructions: ['governance/README.md'], invariants: ['local-only'],
    tests: extra.tests ?? ['governance.unit'], surfaces: [],
  };
}
function pull(changes, extra = {}) {
  return decideAffectedJobs({
    event: 'pull_request', diffComplete: true, changes,
    baseline: extra.baseline ?? narrow(), candidate: extra.candidate ?? extra.baseline ?? narrow(),
    ...extra,
  });
}
function edited(path, status = 'M') { return { path, status }; }
function needsFor(selection, results, { select = 'success', integrity = 'success', extra = {} } = {}) {
  const outputs = Object.fromEntries(githubOutput(selection).trim().split('\n').map(line => line.split('=')));
  const needs = {
    select: { result: select, outputs },
    'source-integrity': { result: integrity, outputs: {} },
    ...extra,
  };
  for (const id of SELECTABLE_JOBS) needs[id] = { result: results[id], outputs: {} };
  return needs;
}
function allResults(result) {
  return Object.fromEntries(SELECTABLE_JOBS.map(id => [id, result]));
}
function jobBlock(text, name) {
  const marker = `\n  ${name}:\n`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, name);
  const rest = text.slice(start + marker.length);
  const next = rest.search(/\n  [a-z0-9-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

test('explicit docs prefixes are prose trees outside platform-plan and runtime text', () => {
  assert.deepEqual([...DOCS_ALLOWLIST_PREFIXES], ['docs/development/', 'docs/design/', 'docs/plans/', 'docs/releases/']);
  assert.equal(isDocsAllowlisted('docs/development/runtime-ci-postgres.md'), true);
  assert.equal(isDocsAllowlisted('docs/skill-book-upstream-sync-2026-09-27.md'), true);
  assert.equal(isDocsAllowlisted('docs/plans/unified-foundation.md'), true);
  assert.equal(isDocsAllowlisted('docs/platform-plan/execution/unified-foundation/handoff-2026-10-04.md'), false);
  assert.equal(isDocsAllowlisted(GENERATED_INVENTORY_PATH), false);
  assert.equal(GENERATED_INVENTORY_PATH, 'docs/platform-plan/verification/2026-09-20-file-inventory.json');
  assert.equal(isDocsAllowlisted('packages/shop-agent/common.md'), false);
  assert.equal(isDocsAllowlisted('packages/skill-upload-client/SKILL.md'), false);
  assert.equal(isDocsAllowlisted('README.md'), false);
});

test('docs-only pull request skips heavy jobs and keeps runtime partitions tied', () => {
  const selection = pull([edited('docs/development/runtime-ci-postgres.md'), edited('docs/releases/note.md', 'A')]);
  assert.equal(selection.mode, 'docs');
  assert.equal(selection.reason, 'docs_allowlist');
  assert.equal(Object.hasOwn(selection.jobs, 'source-integrity'), false);
  for (const id of SELECTABLE_JOBS) assert.equal(selection.jobs[id], false);
  assert.equal(selection.jobs['runtime-full'], selection.jobs['runtime-aggregate']);
});


test('exact modified root README uses docs without reducing mandatory context', () => {
  assert.equal(isDocsAllowlisted('README.md'), false, 'path-only helper cannot prove a modification');
  for (const changes of [
    [edited('README.md')],
    [edited('README.md'), edited('docs/development/community-curation-handoff.md', 'A'), edited(GENERATED_INVENTORY_PATH)],
  ]) {
    const selection = pull(changes);
    assert.equal(selection.mode, 'docs');
    assert.equal(selection.reason, 'docs_allowlist');
    assert.ok(Object.values(selection.jobs).every(value => value === false));
    assert.equal(evaluateVerifyAggregate(needsFor(selection, allResults('skipped'))).ok, true);
    for (const result of ['skipped', 'failure', 'cancelled']) {
      assert.equal(evaluateVerifyAggregate(needsFor(selection, allResults('skipped'), { integrity: result })).ok, false);
    }
    const missing = needsFor(selection, allResults('skipped'));
    delete missing['source-integrity'];
    assert.equal(evaluateVerifyAggregate(missing).ok, false);
  }
  assert.ok(ROOT_INSTRUCTIONS.includes('README.md'));
  const descriptors = [moduleDescriptor('one', ['modules/one/**']), moduleDescriptor('two', ['modules/two/**'])];
  const impact = selectImpact({ baseline: descriptors, candidate: descriptors, changedPaths: ['README.md'] });
  assert.deepEqual(impact.module_ids, ['one', 'two']);
  assert.deepEqual(impact.tests, ['governance.unit']);
});

test('root README cannot erase ownership, invalid descriptors, mixed paths or full fallback', () => {
  const readme = edited('README.md');
  const owner = [moduleDescriptor('readme-owner', ['README.md'])];
  for (const graphs of [{baseline: owner}, {baseline: owner, candidate: narrow()}, {baseline: narrow(), candidate: owner}]) {
    assert.equal(pull([readme], graphs).reason, 'baseline_candidate_union');
  }
  const ownedDoc = [moduleDescriptor('doc-owner', ['docs/development/**'])];
  assert.equal(pull([readme, edited('docs/development/guide.md')], {baseline: ownedDoc}).reason, 'baseline_candidate_union');
  for (const graphs of [{baseline: []}, {candidate: []}, {descriptorsProven: false},
    {baseline: [{}]}, {candidate: [{}]}]) {
    assert.equal(pull([readme], graphs).reason, 'descriptors_unproven');
  }
  for (const path of ['AGENTS.md', 'CONTRIBUTING.md', '.github/workflows/verify.yml',
    'scripts/ci/select-affected-jobs.mjs', 'governance/README.md', 'contracts/common/v1/ArtifactRef.json',
    'migrations/137_example.sql', 'packages/db/index.ts', 'tests/runtime/example.test.ts',
    'packages/example/freedom.module.json', 'package.json', 'apps/portal-web/src/App.tsx',
    'packages/shop-agent/common.md', 'docs/platform-plan/execution/notes.md',
    'docs/development/config.json', 'docs/development/example.test.md', 'UNKNOWN.md',
    FRONTEND_LEAF_PROFILES[0].paths[0]]) {
    assert.equal(pull([readme, edited(path)]).mode, 'full', path);
  }
  for (const status of ['A', 'D', 'R100', 'C100', 'T', 'U']) assert.equal(pull([edited('README.md', status)]).mode, 'full', status);
  assert.equal(pull([{...readme, previousPath: 'old.md'}]).mode, 'full');
  for (const path of ['readme.md', 'docs/../README.md', 'nested/README.md']) assert.equal(pull([edited(path)]).mode, 'full', path);
  for (const event of ['push', 'merge_group', 'pull_request_target']) assert.equal(pull([readme], {event}).mode, 'full', event);
  assert.equal(pull([readme], {diffComplete: false}).reason, 'diff_unproven');
});

test('root README requires valid bounded graphs in both revisions', () => {
  const one = moduleDescriptor('one', ['modules/one/**']);
  const badGraphs = [
    [one, structuredClone(one)],
    [moduleDescriptor('one', ['modules/one/**'], {dependencies: ['absent']})],
    [moduleDescriptor('one', ['modules/one/**'], {dependencies: ['one']})],
    [moduleDescriptor('one', ['modules/one/**'], {dependencies: ['two']}),
      moduleDescriptor('two', ['modules/two/**'], {dependencies: ['one']})],
    Array.from({length: 257}, (_, i) => moduleDescriptor(`mod-${i}`, [`modules/mod-${i}/**`])),
  ];
  for (const invalid of badGraphs) {
    for (const [baseline, candidate] of [[invalid, narrow()], [narrow(), invalid], [invalid, invalid]]) {
      assert.equal(pull([edited('README.md')], {baseline, candidate}).reason, 'descriptors_unproven');
    }
  }
});

test('merge_group, push, and any other event stay on the full set', () => {
  const docs = [edited('docs/development/runtime-ci-postgres.md')];
  assert.equal(decideAffectedJobs({ event: 'merge_group', diffComplete: true, changes: docs, baseline: narrow(), candidate: narrow() }).reason, 'merge_group');
  assert.equal(decideAffectedJobs({ event: 'push', diffComplete: true, changes: docs, baseline: narrow(), candidate: narrow() }).reason, 'push');
  assert.equal(decideAffectedJobs({ event: 'pull_request_target', diffComplete: true, changes: docs, baseline: narrow(), candidate: narrow() }).reason, 'non_pull_request');
  for (const event of ['merge_group', 'push', 'workflow_dispatch']) {
    const selection = decideAffectedJobs({ event, diffComplete: true, changes: docs, baseline: narrow(), candidate: narrow() });
    assert.equal(selection.mode, 'full');
    for (const id of SELECTABLE_JOBS) assert.equal(selection.jobs[id], true);
  }
});

test('incomplete, empty, and oversized diffs stay on the full set', () => {
  assert.equal(pull([], { diffComplete: false }).reason, 'diff_unproven');
  assert.equal(decideAffectedJobs({ event: 'pull_request', diffComplete: true, changes: [], baseline: narrow(), candidate: narrow() }).reason, 'empty_diff');
  const many = Array.from({ length: 4097 }, (_, index) => edited(`docs/development/note-${index}.md`));
  assert.equal(decideAffectedJobs({ event: 'pull_request', diffComplete: true, changes: many, baseline: narrow(), candidate: narrow() }).reason, 'diff_unproven');
});

test('deleted, renamed, copied, and mode changes stay on the full set', () => {
  assert.equal(pull([edited('docs/development/old.md', 'D')]).reason, 'deleted_path');
  assert.equal(pull([{ path: 'docs/development/new.md', previousPath: 'modules/example/old.ts', status: 'R100' }]).reason, 'renamed_or_copied_path');
  assert.equal(pull([{ path: 'docs/development/copy.md', previousPath: 'docs/development/old.md', status: 'C090' }]).reason, 'renamed_or_copied_path');
  assert.equal(pull([edited('docs/development/guide.md', 'T')]).reason, 'untrusted_change_status');
  assert.equal(pull([{ path: 'docs/development/guide.md', previousPath: 'docs/development/guide.md', status: 'M' }]).reason, 'untrusted_change_status');
  assert.equal(pull([{ path: 'docs/development/guide.md', status: 'U' }]).reason, 'untrusted_change_status');
});

test('unknown, root, governance, security, shared runtime, test, spec, and config paths stay on the full set', () => {
  assert.equal(pull([edited('docs/development/../secret.md')]).reason, 'unknown_path');
  assert.equal(pull([edited('not a path.md')]).reason, 'unknown_path');
  assert.equal(pull([edited('docs/development/.hidden.md')]).reason, 'unknown_path');
  assert.equal(pull([edited('AGENTS.md')]).reason, 'root_instruction');
  assert.equal(pull([edited('CONTRIBUTING.md')]).reason, 'root_instruction');
  assert.equal(pull([edited('.github/workflows/verify.yml')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('scripts/ci/select-affected-jobs.mjs')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('governance/README.md')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('docs/platform-plan/verification/verify_revision.py')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('packages/shared/index.ts')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('tests/runtime/command-core.test.ts')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('packages/db/index.ts')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('migrations/113_chat_stickers_replies.sql')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('apps/credential-broker/src/worker.ts')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('packages/shop-agent/common.md')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('docs/development/foo.test.md')]).reason, 'excluded_test_spec_or_config');
  assert.equal(pull([edited('docs/development/spec/guide.md')]).reason, 'excluded_test_spec_or_config');
  assert.equal(pull([edited('docs/development/snippet.ts')]).reason, 'excluded_test_spec_or_config');
  assert.equal(pull([edited('docs/development/config.json')]).reason, 'excluded_test_spec_or_config');
  assert.equal(pull([edited('apps/portal-web/src/App.tsx')]).reason, 'not_docs_allowlist');
  assert.equal(pull([edited('package.json')]).reason, 'not_docs_allowlist');
  assert.equal(pull([edited('docs/design/mark.png')]).reason, 'not_docs_allowlist');
});

test('new workflows keep every job selected, including beside docs and generated inventory', () => {
  for (const path of ['.github/workflows/codeql.yml', '.github/workflows/new-workflow.yml']) {
    for (const status of ['A', 'M']) {
      for (const changes of [
        [edited(path, status)],
        [edited(path, status), edited('docs/development/notes.md'), edited(GENERATED_INVENTORY_PATH)],
      ]) {
        const selection = pull(changes);
        assert.equal(selection.mode, 'full');
        assert.equal(selection.reason, 'governance_security_or_shared_runtime');
        assert.deepEqual(selection.jobs, allResults(true));
      }
    }
  }
});

test('the historical inventory is metadata beside docs and qualifies as a plan document alone', () => {
  const inventoryOwner = [moduleDescriptor('governance', ['modules/example/**', 'docs/platform-plan/verification/**'])];
  const accompanied = pull([
    edited('docs/development/notes.md'), edited(GENERATED_INVENTORY_PATH, 'A'),
  ], { baseline: inventoryOwner, candidate: inventoryOwner });
  assert.equal(accompanied.mode, 'docs');
  assert.equal(accompanied.reason, 'docs_allowlist');
  for (const id of SELECTABLE_JOBS) assert.equal(accompanied.jobs[id], false);
  assert.equal(accompanied.jobs['runtime-full'], accompanied.jobs['runtime-aggregate']);
  assert.equal(pull([edited(GENERATED_INVENTORY_PATH)], { baseline: inventoryOwner, candidate: inventoryOwner }).reason, 'plan_receipt_docs');
  assert.equal(pull([edited(GENERATED_INVENTORY_PATH, 'D')]).reason, 'deleted_path');
  assert.equal(pull([{ path: GENERATED_INVENTORY_PATH, previousPath: 'docs/development/old.md', status: 'R' }]).reason, 'renamed_or_copied_path');
  assert.equal(pull([edited('docs/development/notes.md'), edited(GENERATED_INVENTORY_PATH), edited('docs/platform-plan/verification/verify_revision.py')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('docs/development/notes.md'), edited('docs/platform-plan/execution/note.md'), edited(GENERATED_INVENTORY_PATH)]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('docs/development/notes.md'), edited('docs/platform-plan/verification/2026-09-20-file-inventory.json.bak')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('docs/development/notes.md'), edited(GENERATED_INVENTORY_PATH), edited('apps/portal-web/src/App.tsx')]).reason, 'not_docs_allowlist');
  assert.equal(pull([edited('docs/development/notes.md'), edited(GENERATED_INVENTORY_PATH), edited('package.json')]).reason, 'not_docs_allowlist');
  assert.equal(pull([edited('docs/development/notes.md'), edited(GENERATED_INVENTORY_PATH), edited('apps/portal-web/public/downloads/freedom-skill-client.tgz')]).reason, 'not_docs_allowlist');
  assert.equal(pull([edited('docs/development/notes.md'), edited(GENERATED_INVENTORY_PATH), edited('.github/workflows/verify.yml')]).reason, 'governance_security_or_shared_runtime');
  assert.equal(pull([edited('docs/development/notes.md'), edited(GENERATED_INVENTORY_PATH), edited('docs/development/foo.test.md')]).reason, 'excluded_test_spec_or_config');
  assert.equal(pull([edited('docs/development/notes.md'), edited(GENERATED_INVENTORY_PATH), edited('docs/development/config.json')]).reason, 'excluded_test_spec_or_config');
  const ownedDoc = [moduleDescriptor('notes', ['docs/development/**', 'docs/platform-plan/verification/**'])];
  assert.equal(pull([
    edited('docs/development/notes.md'), edited(GENERATED_INVENTORY_PATH),
  ], { baseline: ownedDoc, candidate: ownedDoc }).reason, 'baseline_candidate_union');
});

test('one non-doc path keeps the whole pull request on the full set', () => {
  const selection = pull([edited('docs/development/guide.md'), edited('apps/portal-web/src/App.tsx')]);
  assert.equal(selection.mode, 'full');
  assert.equal(selection.reason, 'not_docs_allowlist');
});

test('baseline ownership survives a candidate descriptor that drops the path', () => {
  const baseline = [moduleDescriptor('execution-runs', ['modules/agent-execution/**', 'docs/development/worker-private-ai-bindings.md'])];
  const candidate = [moduleDescriptor('execution-runs', ['modules/agent-execution/**'])];
  const selection = pull([edited('docs/development/worker-private-ai-bindings.md')], { baseline, candidate });
  assert.equal(selection.mode, 'full');
  assert.equal(selection.reason, 'baseline_candidate_union');
});

test('a shrunk directory glob cannot remove baseline docs from the full set', () => {
  const baseline = [moduleDescriptor('notes', ['docs/development/**'])];
  const candidate = [moduleDescriptor('notes', ['docs/design/**'])];
  const selection = pull([edited('docs/development/guide.md')], { baseline, candidate });
  assert.equal(selection.reason, 'baseline_candidate_union');
});

test('candidate ownership and reverse dependencies widen a docs path to the full set', () => {
  const baseline = narrow();
  const owner = moduleDescriptor('notes', ['docs/plans/**']);
  const dependent = moduleDescriptor('page', ['apps/portal-web/src/modules/**'], { dependencies: ['notes'], tests: ['runtime.card'] });
  const selection = pull([edited('docs/plans/unified-foundation.md')], { baseline: [...baseline, owner], candidate: [...baseline, owner, dependent] });
  assert.equal(selection.reason, 'baseline_candidate_union');
});

test('missing descriptors cannot prove a docs-only decision', () => {
  assert.equal(pull([edited('docs/development/guide.md')], { baseline: [], candidate: [] }).reason, 'descriptors_unproven');
  assert.equal(pull([edited('docs/development/guide.md')], { descriptorsProven: false }).reason, 'descriptors_unproven');
  assert.equal(pull([edited('apps/portal-web/src/App.tsx')], { baseline: [], candidate: [] }).reason, 'not_docs_allowlist');
});

test('tree comparison reports content edits, deletions, mode changes, and unique renames', () => {
  const base = new Map([
    ['docs/development/guide.md', { mode: '100644', type: 'blob', oid: oid('a') }],
    ['modules/old.ts', { mode: '100644', type: 'blob', oid: oid('b') }],
    ['docs/development/link.md', { mode: '120000', type: 'blob', oid: oid('c') }],
    ['keep.ts', { mode: '100644', type: 'blob', oid: oid('d') }],
  ]);
  const head = new Map([
    ['docs/development/guide.md', { mode: '100644', type: 'blob', oid: oid('e') }],
    ['docs/development/moved.md', { mode: '100644', type: 'blob', oid: oid('b') }],
    ['docs/development/link.md', { mode: '100644', type: 'blob', oid: oid('c') }],
    ['keep.ts', { mode: '100755', type: 'blob', oid: oid('d') }],
  ]);
  const diff = changesFromTrees(base, head);
  assert.equal(diff.ok, true);
  assert.deepEqual(diff.changes, [
    { path: 'docs/development/guide.md', status: 'M' },
    { path: 'docs/development/link.md', status: 'T' },
    { path: 'docs/development/moved.md', status: 'R', previousPath: 'modules/old.ts' },
    { path: 'keep.ts', status: 'T' },
  ]);
  assert.equal(pull(diff.changes).mode, 'full');
  assert.equal(pull(diff.changes).reason, 'renamed_or_copied_path');
});

test('name-status letters for rename and delete stay on the full set', () => {
  const parsed = parseNameStatusZ('M\0docs/development/guide.md\0R100\0modules/old.ts\0docs/development/moved.md\0D\0docs/development/gone.md\0');
  assert.equal(parsed.ok, true);
  assert.equal(pull(parsed.changes).reason, 'deleted_path');
  assert.equal(parseNameStatusZ('R100\0only-old\0').ok, false);
  const broken = parseLsTreeZ('100644 blob ' + oid('a') + '\tdocs/development/guide.md\0broken\0');
  assert.equal(broken.ok, false);
});

test('aggregate passes a proven docs skip and a complete full run', () => {
  const docsDecision = pull([edited('docs/development/guide.md')]);
  const fullDecision = pull([edited('package.json')]);
  assert.equal(evaluateVerifyAggregate(needsFor(docsDecision, allResults('skipped'))).reason, 'docs_selected_subset');
  assert.equal(evaluateVerifyAggregate(needsFor(fullDecision, allResults('success'))).reason, 'full_selection');
  const extraSuccess = needsFor(docsDecision, allResults('skipped'));
  extraSuccess['runtime-full'] = { result: 'success', outputs: {} };
  assert.equal(evaluateVerifyAggregate(extraSuccess).ok, true);
});

test('deployment preflight must be observed and succeed when selected, while docs may skip it', () => {
  for (const [selection, otherResult] of [
    [pull([edited('deploy/cloudflare/lib/migrations.mjs')]), 'success'],
    [pull([edited('docs/development/guide.md')]), 'skipped'],
  ]) {
    for (const result of [undefined, 'failure', 'cancelled', 'skipped', 'success']) {
      const needs = needsFor(selection, allResults(otherResult));
      if (result === undefined) delete needs['deploy-preflight'];
      else needs['deploy-preflight'].result = result;
      const verdict = evaluateVerifyAggregate(needs);
      const shouldPass = result === 'success' || (selection.mode === 'docs' && result === 'skipped');
      assert.equal(verdict.ok, shouldPass, `${selection.mode}: deploy-preflight ${result ?? 'missing'}`);
      if (!shouldPass) assert.deepEqual(verdict, {
        ok: false,
        reason: selection.mode === 'full' ? 'selected_job_not_success' : 'unselected_job_not_clean',
        job: 'deploy-preflight', result: result ?? 'missing',
      });
    }
  }
});

test('failed, cancelled, missing, and inconsistent dependencies never pass', () => {
  const docsDecision = pull([edited('docs/development/guide.md')]);
  const fullDecision = pull([edited('package.json')]);
  const cases = [
    needsFor(fullDecision, { ...allResults('success'), 'runtime-full': 'failure' }),
    needsFor(fullDecision, { ...allResults('success'), 'runtime-aggregate': 'cancelled' }),
    needsFor(fullDecision, { ...allResults('success'), 'ui-e2e': 'skipped' }),
    needsFor(docsDecision, { ...allResults('skipped'), 'static-worker': 'failure' }),
    needsFor(docsDecision, { ...allResults('skipped'), 'governance-consumers': 'cancelled' }),
    needsFor(docsDecision, allResults('skipped'), { integrity: 'failure' }),
    needsFor(docsDecision, allResults('skipped'), { integrity: 'skipped' }),
    needsFor(docsDecision, allResults('skipped'), { integrity: 'cancelled' }),
    needsFor(fullDecision, allResults('success'), { select: 'failure' }),
    needsFor(fullDecision, allResults('success'), { select: 'cancelled' }),
    needsFor(docsDecision, allResults('skipped'), { extra: { 'unexpected-job': { result: 'failure', outputs: {} } } }),
  ];
  for (const needs of cases) assert.equal(evaluateVerifyAggregate(needs).ok, false);
  for (const integrity of ['failure', 'cancelled', 'skipped']) {
    const verdict = evaluateVerifyAggregate(needsFor(docsDecision, allResults('skipped'), { integrity }));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'source_integrity_not_success');
  }
  const unavailable = needsFor(docsDecision, allResults('skipped'));
  delete unavailable['source-integrity'];
  assert.equal(evaluateVerifyAggregate(unavailable).reason, 'source_integrity_not_success');
  for (const selection of [docsDecision, fullDecision]) for (const missingReason of [undefined, '']) {
    const needs = needsFor(selection, allResults('success')); needs.select.outputs.reason = missingReason;
    assert.equal(evaluateVerifyAggregate(needs).reason, 'decision_incomplete');
  }
  const missingOutput = needsFor(fullDecision, allResults('success'));
  delete missingOutput.select.outputs.runtime_full;
  assert.equal(evaluateVerifyAggregate(missingOutput).reason, 'decision_incomplete');
  const split = needsFor(fullDecision, allResults('success'));
  split.select.outputs.runtime_aggregate = 'false';
  assert.equal(evaluateVerifyAggregate(split).ok, false);
  assert.equal(evaluateVerifyAggregate(null).reason, 'needs_missing');
});

test('real checkout descriptors parse without freezing live document ownership', () => {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const loaded = loadModuleDescriptors(root, sha);
  assert.equal(loaded.ok, true);
  assert.ok(loaded.descriptors.length > 0);
  assert.ok(loaded.descriptors.every(descriptor => validateDescriptor(descriptor)));
  // Ownership/union/shrink assertions use controlled fixtures above. A valid
  // future module claiming an existing doc may legitimately select full CI.
});

const knownDomainPaths = [
  ['modules/catalog-commerce/service.ts', 'catalog-commerce'],
  ['apps/platform-api/src/routes/commerce.ts', 'catalog-commerce'],
  ['apps/portal-web/src/modules/LegacyCommercePanels.tsx', 'catalog-commerce'],
  ['tests/runtime/commerce.test.ts', 'catalog-commerce'],
  ['modules/client-connections/service.ts', 'client-connections'],
  ['apps/platform-api/src/routes/client-connections.ts', 'client-connections'],
  ['tests/runtime/client-connections.test.ts', 'client-connections'],
  ['modules/development-access/service.ts', 'development-access'],
  ['apps/platform-api/src/routes/development-access.ts', 'development-access'],
  ['tests/runtime/development-access-grant-race.test.ts', 'development-access'],
  ['modules/opensource-marketing/github.ts', 'skill-submissions'],
  ['tests/runtime/opensource-marketing.test.ts', 'skill-submissions'],
  ['tests/e2e/opensource-modules.spec.ts', 'skill-submissions'],
  ['tests/runtime/link-preview.test.ts', 'community'],
];
function knownDomainGraph() {
  // Match the existing real-checkout tests: CI tests the committed candidate.
  const graph = loadModuleDescriptors(root, 'HEAD');
  assert.equal(graph.ok, true, 'including implicit descriptor ownership within the 256-path bound');
  return graph.descriptors;
}

test('known legacy domain and regression paths select their actual owner without dropping runtime obligations', () => {
  const graph = knownDomainGraph();
  for (const [path, owner] of knownDomainPaths) {
    assert.deepEqual(graph.filter(module => owns(module, path)).map(module => module.module_id), [owner], path);
    const impact = selectImpact({baseline: graph, candidate: graph, changedPaths: [path]});
    assert.deepEqual(impact.unknown_paths, [], path);
    assert.ok(impact.module_ids.includes(owner), path);
    assert.ok(impact.tests.includes('runtime.full'), path);
  }
  const catalog = selectImpact({baseline: graph, candidate: graph, changedPaths: ['modules/catalog-commerce/service.ts']});
  assert.ok(catalog.module_ids.includes('client-connections'), 'scoped client reads depend on catalog data semantics');
  const github = selectImpact({baseline: graph, candidate: graph, changedPaths: ['modules/github-social/service.ts']});
  assert.ok(github.module_ids.includes('development-access'), 'development grants depend on current GitHub evidence');
  const profile = (id, name) => graph.find(module => module.module_id === id).surfaces.find(surface => surface.surface_id === name).auth_profile;
  assert.equal(profile('client-connections', 'client-connections.member-api'), 'member-session');
  assert.equal(profile('client-connections', 'client-connections.scoped-read-api'), 'client-read-bearer');
  assert.equal(profile('client-connections', 'client-connections.pairing-poll'), 'device-secret');
  assert.equal(profile('development-access', 'development-access.agent-api'), 'development-key');
});

test('unmapped roots and new domain paths still select every module and full CI', () => {
  const graph = knownDomainGraph();
  for (const path of ['repositories.lock.json', 'tests/integration/repositories.test.ts',
    'tests/integration/consumer-libraries.test.ts', 'modules/catalog-commerce/future-unreviewed.ts']) {
    const impact = selectImpact({baseline: graph, candidate: graph, changedPaths: [path]});
    assert.deepEqual(impact.unknown_paths, [path]);
    assert.deepEqual(impact.module_ids, graph.map(module => module.module_id).sort());
    assert.ok(impact.tests.includes('runtime.full'));
    const selection = pull([edited(path)], {baseline: graph, candidate: graph});
    assert.equal(selection.mode, 'full');
    assert.ok(Object.values(selection.jobs).every(Boolean));
  }
});

test('candidate ownership, dependency and test shrink cannot subtract known baseline domain impact', () => {
  const baseline = knownDomainGraph(), candidate = structuredClone(baseline);
  const catalog = candidate.find(module => module.module_id === 'catalog-commerce');
  catalog.owned_paths = catalog.owned_paths.filter(path => path !== 'modules/catalog-commerce/service.ts');
  catalog.tests = ['governance.unit'];
  const client = candidate.find(module => module.module_id === 'client-connections');
  client.dependencies = client.dependencies.filter(id => id !== 'catalog-commerce');
  client.tests = ['governance.unit'];
  const impact = selectImpact({baseline, candidate, changedPaths: ['modules/catalog-commerce/service.ts']});
  assert.deepEqual(impact.unknown_paths, []);
  assert.ok(impact.module_ids.includes('catalog-commerce'));
  assert.ok(impact.module_ids.includes('client-connections'));
  assert.ok(impact.tests.includes('runtime.full'));
  assert.ok(impact.tests.includes('governance.unit'));
});

test('known domain ownership does not grant a narrower browser or CI profile', () => {
  const graph = knownDomainGraph();
  for (const [path] of knownDomainPaths) {
    const input = {event: 'pull_request', diffComplete: true, changes: [edited(path)], baseline: graph, candidate: graph};
    const selection = decideAffectedJobs(input);
    assert.equal(selection.mode, 'full', path);
    assert.equal(selection.jobs['runtime-full'], true, path);
    assert.equal(selection.jobs['ui-e2e'], true, path);
    assert.equal(decideE2eProfile(input).profile, 'full', path);
  }
});

test('descriptor self-ownership respects the path bound and fails closed when no slot remains', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fp-select-bound-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const git = args => execFileSync('git', ['-C', directory, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Selector Test', GIT_AUTHOR_EMAIL: 'selector@example.invalid',
      GIT_COMMITTER_NAME: 'Selector Test', GIT_COMMITTER_EMAIL: 'selector@example.invalid'},
  }).trim();
  const path = 'modules/example/freedom.module.json';
  const extras = Array.from({length: 256}, (_, index) => `modules/other/file-${index}.ts`);
  await mkdir(dirname(join(directory, path)), {recursive: true});
  git(['init', '-q', '-b', 'main']);
  for (const covered of [true, false]) for (const count of [255, 256]) {
    const paths = covered ? ['modules/example/**', ...extras.slice(0, count - 1)] : extras.slice(0, count);
    await writeFile(join(directory, path), JSON.stringify(moduleDescriptor('example', paths)));
    await writeFile(join(directory, 'README.md'), '# Before\n');
    git(['add', '.']); git(['commit', '-qm', `coverage=${covered} count=${count}`]);
    const base = git(['rev-parse', 'HEAD']);
    const loaded = loadModuleDescriptors(directory, base);
    assert.equal(loaded.ok, covered || count < 256);
    if (loaded.ok) {
      const [descriptor] = loaded.descriptors;
      validateDescriptor(descriptor);
      assert.equal(descriptor.owned_paths.length, count + (covered ? 0 : 1));
      assert.deepEqual(selectImpact({baseline: loaded.descriptors, candidate: loaded.descriptors, changedPaths: [path]}).module_ids, ['example']);
    } else assert.deepEqual(loaded.descriptors, []);
    await writeFile(join(directory, 'README.md'), '# After\n');
    git(['add', '.']); git(['commit', '-qm', 'README only']);
    const result = collectRepositoryDecision({repository: directory, event: 'pull_request', base, head: git(['rev-parse', 'HEAD'])});
    assert.equal(result.mode, loaded.ok ? 'docs' : 'full');
    if (!loaded.ok) {
      assert.equal(result.reason, 'descriptors_unproven');
      assert(SELECTABLE_JOBS.every(job => result.jobs[job]));
    }
    assert.equal(decideAffectedJobs({event: 'pull_request', diffComplete: true, changes: [{path, status: 'M'}],
      baseline: loaded.descriptors, candidate: loaded.descriptors, descriptorsProven: loaded.ok}).mode, 'full');
  }
});

test('repository tree diff narrows a docs edit and refuses a rename or merge_group input', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fp-select-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = (args, input) => execFileSync('git', ['-C', directory, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Selector Test', GIT_AUTHOR_EMAIL: 'selector@example.invalid',
      GIT_COMMITTER_NAME: 'Selector Test', GIT_COMMITTER_EMAIL: 'selector@example.invalid' },
  });
  git(['init', '-q', '-b', 'main']);
  const put = async (path, body) => { await mkdir(dirname(join(directory, path)), { recursive: true }); await writeFile(join(directory, path), body); };
  await put('packages/example/freedom.module.json', JSON.stringify(moduleDescriptor('example', ['modules/example/**'])));
  await put('governance/README.md', '# Fixture\n');
  await put('docs/development/guide.md', 'original\n');
  await put('modules/old.ts', 'export const uniqueRename = 1;\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']).trim();
  await put('docs/development/guide.md', 'candidate prose\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'docs']);
  const head = git(['rev-parse', 'HEAD']).trim();
  const docsDecision = collectRepositoryDecision({ repository: directory, event: 'pull_request', base, head });
  assert.equal(docsDecision.reason, 'docs_allowlist');
  const queued = collectRepositoryDecision({ repository: directory, event: 'merge_group', base, head });
  assert.equal(queued.reason, 'merge_group');
  await put('docs/development/moved.md', 'export const uniqueRename = 1;\n');
  git(['add', 'docs/development/moved.md']);
  git(['rm', '-q', 'modules/old.ts']);
  git(['commit', '-q', '-m', 'rename']);
  const renamed = git(['rev-parse', 'HEAD']).trim();
  const renameDecision = collectRepositoryDecision({ repository: directory, event: 'pull_request', base: head, head: renamed });
  assert.equal(renameDecision.mode, 'full');
  assert.equal(renameDecision.reason, 'renamed_or_copied_path');
  assert.equal(collectRepositoryDecision({ repository: directory, event: 'pull_request', base: 'g'.repeat(40), head }).reason, 'diff_unproven');
});

test('cli writes a full decision without treating a bad base as a skip', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fp-select-cli-'));
  const output = join(directory, 'output.txt');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = await mkdtemp(join(tmpdir(), 'fp-select-repo-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const git = args => execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Selector Test', GIT_AUTHOR_EMAIL: 'selector@example.invalid',
      GIT_COMMITTER_NAME: 'Selector Test', GIT_COMMITTER_EMAIL: 'selector@example.invalid' },
  });
  git(['init', '-q', '-b', 'main']);
  await mkdir(join(repo, 'docs/development'), { recursive: true });
  await mkdir(join(repo, 'packages/example'), { recursive: true });
  await mkdir(join(repo, 'governance'), { recursive: true });
  await writeFile(join(repo, 'governance/README.md'), '# Fixture\n');
  await writeFile(join(repo, 'packages/example/freedom.module.json'), JSON.stringify(moduleDescriptor('example', ['modules/example/**'])));
  await writeFile(join(repo, 'docs/development/guide.md'), 'one\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']).trim();
  const run = spawnSync(process.execPath, [selector, '--event', 'pull_request', '--repository', repo, '--base', base,
    '--head', 'a'.repeat(40), '--github-output', output], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const text = await readFile(output, 'utf8');
  assert.match(text, /^mode=full\nreason=diff_unproven\n/u);
  assert.match(text, /runtime_full=true\nruntime_aggregate=true\n/);
  const usage = spawnSync(process.execPath, [selector, '--unknown'], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  const aggregate = spawnSync(process.execPath, [selector, '--check-aggregate'], {
    encoding: 'utf8', env: { ...process.env, NEEDS_JSON: '{' },
  });
  assert.equal(aggregate.status, 1);
});

test('a real git docs edit plus regenerated inventory narrows, and a tampered manifest does not', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fp-select-inventory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = (args, input) => execFileSync('git', ['-C', directory, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Selector Test', GIT_AUTHOR_EMAIL: 'selector@example.invalid',
      GIT_COMMITTER_NAME: 'Selector Test', GIT_COMMITTER_EMAIL: 'selector@example.invalid' },
  });
  const put = async (path, body) => { await mkdir(dirname(join(directory, path)), { recursive: true }); await writeFile(join(directory, path), body); };
  const runPython = script => spawnSync('python3', [script], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  const regenerate = () => {
    const result = runPython('scripts/update-inventory.py');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Wrote [1-9][0-9]* file hashes to docs\/platform-plan\/verification\/2026-09-20-file-inventory\.json/u);
    return result.stdout;
  };
  const verifyInventory = () => runPython('docs/platform-plan/verification/verify_revision.py');
  const at = sha => { git(['checkout', '-q', '-f', sha]); git(['clean', '-fdq']); };
  const assertDocs = selection => {
    assert.equal(selection.mode, 'docs');
    assert.equal(selection.reason, 'docs_allowlist');
    for (const id of SELECTABLE_JOBS) assert.equal(selection.jobs[id], false);
    assert.equal(selection.jobs['runtime-full'], selection.jobs['runtime-aggregate']);
  };
  const assertFull = (selection, reason) => {
    assert.equal(selection.mode, 'full');
    assert.equal(selection.reason, reason);
    for (const id of SELECTABLE_JOBS) assert.equal(selection.jobs[id], true);
  };
  git(['init', '-q', '-b', 'main']);
  await mkdir(join(directory, 'scripts'), { recursive: true });
  await mkdir(join(directory, 'docs/platform-plan/verification'), { recursive: true });
  await copyFile(join(root, 'scripts/update-inventory.py'), join(directory, 'scripts/update-inventory.py'));
  await copyFile(join(root, 'docs/platform-plan/verification/verify_revision.py'), join(directory, 'docs/platform-plan/verification/verify_revision.py'));
  await put('package.json', '{"version":"0.0.0"}\n');
  await put('governance/README.md', '# Fixture\n');
  await put('docs/development/notes.md', '# Notes\n\nOrdinary development note.\n');
  await put('packages/example/freedom.module.json', JSON.stringify(moduleDescriptor('governance', [
    'modules/example/**', 'docs/platform-plan/verification/**',
  ])));
  regenerate();
  const initial = verifyInventory();
  assert.equal(initial.status, 0, initial.stdout + initial.stderr);
  assert.match(initial.stdout, /[1-9][0-9]* file hashes; [0-9]+ local file\/directory links; 0 failures/u);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']).trim();
  await put('docs/development/notes.md', '# Notes\n\nOrdinary development note.\n\nReviewed wording.\n');
  regenerate();
  const regenerated = verifyInventory();
  assert.equal(regenerated.status, 0, regenerated.stdout + regenerated.stderr);
  assert.match(regenerated.stdout, /0 failures/u);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'docs and inventory']);
  const docsHead = git(['rev-parse', 'HEAD']).trim();
  assert.notEqual(git(['show', `${base}:${GENERATED_INVENTORY_PATH}`]), git(['show', `${docsHead}:${GENERATED_INVENTORY_PATH}`]));
  assertDocs(collectRepositoryDecision({ repository: directory, event: 'pull_request', base, head: docsHead }));
  at(base);
  const manifestPath = join(directory, GENERATED_INVENTORY_PATH);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files[0].sha256 = manifest.files[0].sha256.startsWith('0') ? '1'.repeat(64) : '0'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const tampered = verifyInventory();
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stdout, /FAIL:/u);
  git(['add', GENERATED_INVENTORY_PATH]);
  git(['commit', '-q', '-m', 'tamper inventory']);
  const tamperedHead = git(['rev-parse', 'HEAD']).trim();
  assertFull(collectRepositoryDecision({ repository: directory, event: 'pull_request', base, head: tamperedHead }), 'governance_security_or_shared_runtime');
  at(base);
  await put('docs/development/notes.md', '# Notes\n\nOrdinary development note.\n\nReviewed wording.\n');
  await put('docs/platform-plan/verification/extra.md', '# Not exempt\n');
  regenerate();
  const extraPlan = verifyInventory();
  assert.equal(extraPlan.status, 0, extraPlan.stdout + extraPlan.stderr);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'docs inventory and platform-plan']);
  const extraHead = git(['rev-parse', 'HEAD']).trim();
  assertFull(collectRepositoryDecision({ repository: directory, event: 'pull_request', base, head: extraHead }), 'governance_security_or_shared_runtime');
  at(base);
  await put('modules/example/added.mjs', 'export const added = 1;\n');
  regenerate();
  const codeTree = verifyInventory();
  assert.equal(codeTree.status, 0, codeTree.stdout + codeTree.stderr);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'code and inventory']);
  const codeHead = git(['rev-parse', 'HEAD']).trim();
  assertFull(collectRepositoryDecision({ repository: directory, event: 'pull_request', base, head: codeHead }), 'not_docs_allowlist');
});

test('verify workflow keeps the required gate, unconditional integrity, and historical checks', async () => {
  const text = await readFile(workflowPath, 'utf8');
  const on = text.slice(text.indexOf('\non:\n'), text.indexOf('\nconcurrency:\n'));
  assert.match(on, /pull_request:\n/);
  assert.match(on, /merge_group:\n/);
  assert.match(on, /push:\n/);
  assert.doesNotMatch(on, /\n\s+paths:/u);
  assert.equal([...text.matchAll(/github\.event\.merge_group/g)].length, 1);
  assert.ok(jobBlock(text, 'source-integrity').includes('github.event.merge_group.base_sha')); // baseline for immutable migrations, never a skip
  assert.match(text, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/u);
  for (const id of ['select', 'verify']) {
    const trusted = jobBlock(text, id);
    assert.match(trusted, /repository: \$\{\{ job\.workflow_repository \}\}/u);
    assert.match(trusted, /ref: \$\{\{ job\.workflow_sha \}\}/u);
  }
  assert.match(text, /ref: \$\{\{ github\.sha \}\}/u);
  const verify = jobBlock(text, 'verify');
  assert.match(verify, /if: \$\{\{ always\(\) \}\}/u);
  const needsLine = /^ {4}needs: \[([^\]]+)\]$/mu.exec(verify);
  assert.ok(needsLine, 'verify declares the actual job dependencies');
  assert.deepEqual(needsLine[1].split(',').map(id => id.trim()).sort(),
    ['select', 'source-integrity', ...SELECTABLE_JOBS].sort());
  assert.match(verify, /--check-aggregate/);
  assert.doesNotMatch(verify, /required\.some/);
  const integrity = jobBlock(text, 'source-integrity');
  assert.doesNotMatch(integrity, /\n {4}needs:/u);
  assert.doesNotMatch(integrity, /\n {4}if:/u);
  for (const command of ALWAYS_ON_INTEGRITY_COMMANDS) assert.ok(integrity.includes(command), command);
  for (const key of Object.values(JOB_OUTPUT_KEYS)) {
    assert.ok(text.includes(heavyJobCondition(key)), key);
  }

  for (const id of ['source-integrity', 'runtime-full', 'runtime-aggregate', 'static-worker', 'governance-consumers', 'ui-e2e', 'deploy-preflight']) {
    // Only this exact script-disabled install in the workflow checkout may
    // follow checkout. All candidate npm/scripts commands remain prohibited.
    const block = jobBlock(text, id);
    const trusted = id === 'ui-e2e' ? block.replace(PINNED_BROWSER_PARSER_INSTALL, '') : block;
    assert.match(trusted, /repository: \$\{\{ job\.workflow_repository \}\}/u);
    assert.match(trusted, /ref: \$\{\{ job\.workflow_sha \}\}/u);
    assert.match(trusted, /path: \.freedom\/trusted/u);
    assert.match(trusted, /persist-credentials: false/u);
    assert.match(trusted, /test "\$\(git -C \.freedom\/trusted rev-parse HEAD\)" = "\$PINNED_SHA"/u);

    const checkout = trusted.indexOf('path: .freedom/trusted');
    assert.ok(checkout > 0, `Missing checkout in ${id}`);
    const first = trusted.indexOf('node .freedom/trusted/');
    const last = trusted.lastIndexOf('node .freedom/trusted/');
    assert.ok(first > checkout, `Trusted execution must come after checkout in ${id}`);
    assert.ok(trusted.lastIndexOf('npm ci') < checkout, `Last npm ci must come before checkout in ${id}`);
    assert.doesNotMatch(trusted.slice(checkout, last), /(?:^|\s)(?:npm|npx|node scripts\/|bash scripts\/)/mu, `No candidate command may run between checkout and last trusted command in ${id}`);
  }

  const e2e = jobBlock(text, 'ui-e2e');
  assert.match(e2e, /node \.freedom\/trusted\/scripts\/ci\/run-pinned-e2e\.mjs --root \./);

  const banned = [
    'npm run test:e2e',
    'npm run test:contracts',
    'npm run test:governance',
    'npm run test:worker',
    'npm run test:skill-client',
    'npm run test:repos',
    'node --test deploy/cloudflare/test/',
    'node scripts/runtime-full.mjs',
    'node scripts/runtime-aggregate.mjs',
    'node --test --test-concurrency=1 tests/contribution-tools/',
    'node --test --test-concurrency=1 scripts/ci/select-affected-jobs.test.mjs'
  ];
  for (const str of banned) assert.doesNotMatch(text, new RegExp(str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));

  const runtimeFull = jobBlock(text, 'runtime-full');
  assert.match(runtimeFull, /partition: \[0, 1, 2, 3, 4, 5, 6, 7\]/);
  assert.match(runtimeFull, /fail-fast: false/);
  assert.match(runtimeFull, /node \.freedom\/trusted\/scripts\/runtime-full\.mjs --partition-count 8 --partition-index/);

  const runtimeAggregate = jobBlock(text, 'runtime-aggregate');
  assert.match(runtimeAggregate, /node \.freedom\/trusted\/scripts\/runtime-aggregate\.mjs --partition-count 8 --input-dir/);
  // Artifacts belong to one run attempt. A failed-only rerun cannot combine
  // its replacement fragment with previous-attempt passes, even at one SHA.
  assert.match(runtimeFull, /name: runtime-partition-\$\{\{ github\.run_attempt \}\}-\$\{\{ matrix\.partition \}\}/u);
  assert.match(runtimeAggregate, /pattern: runtime-partition-\$\{\{ github\.run_attempt \}\}-\*/u);
  assert.doesNotMatch(runtimeAggregate, /pattern: runtime-partition-\*\s/u);
  const runtimeDownload = runtimeAggregate.slice(runtimeAggregate.indexOf('- name: Download only'),
    runtimeAggregate.indexOf('- name: Require exact'));
  assert.doesNotMatch(runtimeDownload, /\n\s+(?:run-id|repository):/u);
  assert.match(runtimeAggregate, /name: runtime-full-matrix-\$\{\{ github\.run_attempt \}\}/u);

  const staticWorker = jobBlock(text, 'static-worker');
  assert.match(staticWorker, /git diff --exit-code -- contracts\/preview\/v1 packages\/sdk/);
  assert.match(staticWorker, /npm run check:common-contracts/);

  const select = jobBlock(text, 'select');
  assert.match(select, /--allow-fetch/);

  const consumers = jobBlock(text, 'governance-consumers');
  assert.match(consumers, /node \.freedom\/trusted\/scripts\/ci\/run-pinned-suite\.mjs --root \. --suite ci\.contracts-pytest/);
  assert.match(consumers, /node \.freedom\/trusted\/scripts\/ci\/run-pinned-suite\.mjs --root \. --suite ci\.pinned-pytest-integration/);
  assert.doesNotMatch(text, /run: npm run verify:inventory/);
  assert.match(integrity, /python \.freedom\/trusted\/scripts\/ci\/verify-source-boundaries\.py/);
  assert.match(integrity, /python \.freedom\/trusted\/scripts\/release-source-archive\.py build/);
  assert.match(integrity, /python \.freedom\/trusted\/scripts\/release-source-archive\.py verify/);

  assert.match(integrity, /--suite ci\.selector-unit/);
  assert.match(integrity, /--suite ci\.governance-unit/);
  assert.match(jobBlock(text, 'runtime-full'), /--suite ci\.runtime-sharding-integration/);
  assert.match(jobBlock(text, 'static-worker'), /--suite ci\.worker-unit/);
  assert.match(consumers, /--suite ci\.skill-client-unit/);
  assert.match(consumers, /--suite ci\.runtime-union-integration/);
  assert.doesNotMatch(consumers, /--suite ci\.governance-unit/);
  assert.equal((text.match(/--suite ci\.governance-unit\b/g) ?? []).length, 1);
  assert.equal((runtimeFull.match(/--suite ci\.runtime-sharding-integration\b/g) ?? []).length, 1);
  assert.match(runtimeFull, /if: \$\{\{ matrix\.partition == 0 \}\}\n {8}run: node \.freedom\/trusted\/scripts\/ci\/run-pinned-suite\.mjs --root \. --suite ci\.runtime-sharding-integration/);
  assert.doesNotMatch(consumers, /Fetch the immutable adopted library source/);
  assert.match(consumers, /--suite ci\.consumer-repositories/);
  assert.match(jobBlock(text, 'deploy-preflight'), /--suite ci\.deploy-preflight/);
  assert.match(jobBlock(text, 'deploy-preflight'), /--suite ci\.migration-postgres/);
});

test('static-worker runs its existing Worker suite without a provider status wait', async () => {
  const workflow = await readFile(workflowPath, 'utf8'), block = jobBlock(workflow, 'static-worker');
  assert(!block.includes('worker-provider'));
  assert(!block.includes('worker-status'));
  assert(!block.includes('statuses: read'));
  assert.match(block, /--suite ci\.worker-unit\n        env:/);
});

test('deploy preflight caches npm downloads before its clean install', async () => {
  const preflight = jobBlock(await readFile(workflowPath, 'utf8'), 'deploy-preflight');
  assert.match(preflight, /- uses: actions\/setup-node@[^\n]+\n {8}with:\n {10}node-version: '24'\n {10}cache: npm\n {6}- run: npm ci --ignore-scripts/u);
});

test('CI services and migration prefetch retain one immutable PostgreSQL image on disk', async () => {
  const text = await readFile(workflowPath, 'utf8');
  const image = 'mirror.gcr.io/library/postgres:18-alpine@sha256:6c538e7206ea40ff740ef27883529390a690b6ead6ba96b44c67a9f7c638e8fd';
  for (const id of ['runtime-full', 'ui-e2e', 'static-worker', 'governance-consumers']) {
    const job = jobBlock(text, id);
    assert.ok(job.includes(`image: ${image}\n`), id);
    assert.ok(job.includes('dynamic_shared_memory_type=mmap'), id);
    assert.doesNotMatch(job, /--tmpfs|type=tmpfs/u);
  }
  assert.match(jobBlock(text, 'runtime-full'), /--memory 4g/u);
  assert.ok(jobBlock(text, 'deploy-preflight').includes(`run: docker pull ${image}\n`));
});

test('PostgreSQL prerequisite rejects RAM storage, changed images and weakened durability', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fp-ci-postgres-readback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Synthetic docker readback only: this test creates no container or database.
  await writeFile(join(directory, 'docker'), `#!/usr/bin/env python3
import json,os,sys
f=json.loads(os.environ['CI_STORAGE_FIXTURE']);a=sys.argv[1:]
if a[:2]==['inspect','--format']:
 if a[2]=='{{.Config.Image}}': print(f['image'])
 elif a[2]=='{{json .}}': print(json.dumps(f['storage']))
 else: raise Exception('unexpected inspect')
elif a[0]=='exec' and a[2]=='df':
 print('Filesystem Type 1024-blocks Used Available Capacity Mounted on')
 print('/dev/test '+f['filesystem']+' 20000000 1000 19999000 1% /var/lib/postgresql')
elif a[0]=='exec' and a[2]=='psql': print(json.dumps(f['settings']))
else: raise Exception('unexpected Docker command')
`, { mode: 0o755 });
  const valid = () => ({
    image: 'mirror.gcr.io/library/postgres:18-alpine@sha256:6c538e7206ea40ff740ef27883529390a690b6ead6ba96b44c67a9f7c638e8fd',
    storage: { HostConfig: { Tmpfs: null, Memory: 4294967296 }, Mounts: [{ Type: 'volume', Destination: '/var/lib/postgresql', RW: true }] },
    filesystem: 'ext4', settings: { database: 'fp_foundation_ci', data_directory: '/var/lib/postgresql/18/docker',
      checkpoint_completion_target: '0', max_locks_per_transaction: '256', dynamic_shared_memory_type: 'mmap', fsync: 'on', full_page_writes: 'on' },
  });
  const run = (fixture, env = {}) => spawnSync('bash', [join(root, 'scripts/ci/verify-runtime-postgres.sh'), 'a'.repeat(64)], {
    encoding: 'utf8', timeout: 5000, env: { PATH: `${directory}:${process.env.PATH}`, GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'github-hosted', CI_STORAGE_FIXTURE: JSON.stringify(fixture), ...env },
  });
  const good = run(valid());
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /runtime_postgres_storage_readback=pass storage=disk/u);
  for (const mutate of [
    f => { f.image = f.image.replace('6c538e72', '00000000'); },
    f => { f.image = f.image.replace('mirror.gcr.io/library/', ''); },
    f => { f.storage.HostConfig.Tmpfs = { '/var/lib/postgresql': 'rw,size=4294967296' }; },
    f => { f.storage.HostConfig.Memory = 0; },
    f => { f.storage.Mounts[0].Type = 'bind'; },
    f => { f.storage.Mounts[0].Destination = '/data'; },
    f => { f.storage.Mounts[0].RW = false; },
    f => { f.storage.Mounts.push({ Type: 'tmpfs', Destination: '/tmp', RW: true }); },
    f => { f.filesystem = 'tmpfs'; },
    f => { f.filesystem = 'ramfs'; },
    f => { f.filesystem = ''; },
    f => { f.settings.database = 'other_database'; },
    f => { f.settings.data_directory = '/tmp/data'; },
    f => { f.settings.dynamic_shared_memory_type = 'posix'; },
    f => { f.settings.checkpoint_completion_target = '0.9'; },
    f => { f.settings.max_locks_per_transaction = '64'; },
    f => { f.settings.fsync = 'off'; },
    f => { f.settings.full_page_writes = 'off'; },
  ]) {
    const fixture = valid(); mutate(fixture);
    const result = run(fixture);
    assert.notEqual(result.status, 0, JSON.stringify(fixture));
    assert.doesNotMatch(result.stdout, /runtime_postgres_storage_readback=pass/u);
  }
  assert.notEqual(run(valid(), { GITHUB_ACTIONS: 'false' }).status, 0);
  assert.notEqual(run(valid(), { RUNNER_ENVIRONMENT: 'self-hosted' }).status, 0);
});

function leafDescriptors() {
  return [
    ...FRONTEND_LEAF_PROFILES.map(profile => moduleDescriptor(profile.module, [...profile.paths], { dependencies: [...profile.dependencies], tests: [...profile.tests] })),
    moduleDescriptor('command-core', ['packages/command-core/**']),
    moduleDescriptor('public-guide-assets', ['packages/public-guide-assets/**']),
  ];
}
function leafDecision(paths = [FRONTEND_LEAF_PROFILES[0].paths[0]], extra = {}) {
  return pull(paths.map(path => edited(path)), { baseline: leafDescriptors(), ...extra });
}
function assertLeaf(selection) {
  assert.equal(selection.mode, 'affected');
  assert.equal(selection.reason, 'frontend_leaf_profiles');
  assert.deepEqual(selection.jobs, Object.fromEntries(SELECTABLE_JOBS.map(id => [id, FRONTEND_LEAF_JOBS.includes(id)])));
}

test('fixed frontend profiles retain complete runtime/browser/static jobs without adding a runner', () => {
  const descriptors = leafDescriptors();
  for (const profile of FRONTEND_LEAF_PROFILES) for (const path of profile.paths) {
    assertLeaf(leafDecision([path], {baseline: descriptors, candidate: descriptors}));
  }
  assertLeaf(leafDecision(FRONTEND_LEAF_PROFILES.flatMap(profile => profile.paths)));
  assertLeaf(leafDecision([FRONTEND_LEAF_PROFILES[0].paths[0], 'docs/development/ordinary.md', GENERATED_INVENTORY_PATH]));
  assert.deepEqual(FRONTEND_LEAF_JOBS, ['runtime-full', 'runtime-aggregate', 'ui-e2e', 'static-worker']);
  assert.equal(SELECTABLE_JOBS.length, 7);
});

test('leaf selection refuses new/unmapped/auth/contract/descriptor/runtime-text and destructive paths', () => {
  const leaf = FRONTEND_LEAF_PROFILES[0].paths[0];
  for (const path of ['apps/portal-web/src/modules/MemberShare.tsx', 'apps/portal-web/src/modules/PublicMemberPage.tsx',
    'apps/portal-web/src/modules/MemberCardShareActions.tsx', 'apps/portal-web/src/modules/newcomer-guides/gate.ts',
    'apps/portal-web/src/modules/newcomer-guides/release-pin.ts', 'apps/portal-web/src/modules/newcomer-guides/contracts.ts',
    'apps/portal-web/src/modules/newcomer-guides/new-page.tsx', 'apps/portal-web/src/App.tsx',
    'packages/command-core/README.md', 'contracts/common/v1/ArtifactRef.json', 'packages/shop-agent/common.md',
    'apps/portal-web/src/modules/freedom.module.json', 'modules/identity-membership/member-sharing.ts',
    'migrations/117_example.sql', 'deploy/cloudflare/migration-operator.mjs', 'scripts/database.ts']) {
    assert.equal(leafDecision([leaf, path]).mode, 'full', path);
  }
  for (const status of ['A', 'D', 'T', 'R100']) {
    assert.equal(pull([edited(leaf, status)], {baseline: leafDescriptors()}).mode, 'full', status);
  }
  for (const event of ['push', 'merge_group']) assert.equal(leafDecision([leaf], {event}).mode, 'full');
});

test('both descriptor graphs and their complete reverse dependencies must prove the fixed leaf profile', () => {
  const path = FRONTEND_LEAF_PROFILES[0].paths[0], baseline = leafDescriptors();
  const changed = transform => { const candidate = structuredClone(baseline); transform(candidate); return candidate; };
  const candidates = [
    changed(d => { d[0].owned_paths = ['modules/elsewhere/**']; }),
    changed(d => { d[0].owner_role = 'changed-owner'; }),
    changed(d => { d[0].tests = []; }),
    changed(d => { d[0].tests.push('runtime.full'); }),
    changed(d => { d[0].dependencies.push('public-guide-assets'); }),
    changed(d => { d[1].dependencies.push('member-card'); }),
    changed(d => { d.push(moduleDescriptor('new-consumer', ['modules/new-consumer/**'], { dependencies: ['member-card'] })); }),
    changed(d => { d.shift(); }),
  ];
  for (const candidate of candidates) {
    assert.equal(leafDecision([path], {baseline, candidate}).mode, 'full');
    assert.equal(leafDecision([path], {baseline: candidate, candidate: baseline}).mode, 'full');
  }
  // Drift already present in both inputs must not expand host-approved ownership,
  // tests/dependencies or admit an invalid graph, even without a reported edit.
  for (const descriptors of [
    changed(d => { d[0].tests = ['governance.unit']; }),
    changed(d => { d[0].dependencies = []; }),
    changed(d => { d[0].owner_role = 'changed-owner'; }),
    changed(d => { d.push(moduleDescriptor('second-owner', [path])); }),
    changed(d => { d.push(moduleDescriptor('new-consumer', ['modules/new-consumer/**'], {dependencies: ['member-card']})); }),
    changed(d => { d[0].dependencies = ['absent-module']; }),
    changed(d => { d[2].dependencies = ['member-card']; }),
    changed(d => { d.push(structuredClone(d[0])); }),
  ]) assert.equal(leafDecision([path], {baseline: descriptors, candidate: descriptors}).mode, 'full');
  assert.equal(leafDecision([path], {baseline: [], candidate: []}).mode, 'full');
  assert.equal(leafDecision([path], {descriptorsProven: false}).mode, 'full');
});

test('affected aggregate admits exactly the fixed job shape and rejects every omitted or bad result/output', () => {
  const selection = leafDecision(), results = Object.fromEntries(SELECTABLE_JOBS.map(id => [id, selection.jobs[id] ? 'success' : 'skipped']));
  assert.equal(evaluateVerifyAggregate(needsFor(selection, results)).reason, 'affected_selected_subset');
  assert.equal(evaluateVerifyAggregate(needsFor(selection, allResults('success'))).ok, true);
  for (const id of SELECTABLE_JOBS) for (const bad of [undefined, '', 'failure', 'cancelled', 'skipped']) {
    const needs = needsFor(selection, results);
    if (bad === undefined) delete needs[id]; else needs[id].result = bad;
    assert.equal(evaluateVerifyAggregate(needs).ok, !selection.jobs[id] && bad === 'skipped', `${id}: ${bad}`);
  }
  for (const key of Object.values(JOB_OUTPUT_KEYS)) for (const bad of [undefined, '', 'TRUE', false]) {
    const needs = needsFor(selection, results);
    if (bad === undefined) delete needs.select.outputs[key]; else needs.select.outputs[key] = bad;
    assert.equal(evaluateVerifyAggregate(needs).ok, false, key);
  }
  for (const key of ['mode', 'reason']) for (const bad of [undefined, '', 'invented_profile']) {
    const needs = needsFor(selection, results);
    if (bad === undefined) delete needs.select.outputs[key]; else needs.select.outputs[key] = bad;
    assert.equal(evaluateVerifyAggregate(needs).ok, false, key);
  }
  for (let mask = 0; mask < 64; mask++) {
    const needs = needsFor(selection, allResults('success'));
    SELECTABLE_JOBS.forEach((id, index) => { needs.select.outputs[JOB_OUTPUT_KEYS[id]] = String(Boolean(mask & (1 << index))); });
    assert.equal(evaluateVerifyAggregate(needs).ok, mask === 15, `affected shape ${mask}`);
  }
});

test('actual Git leaf candidate and CLI narrow; co-edited safety, owner drift and new reverse consumers stay full', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fp-select-leaf-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const git = args => execFileSync('/usr/bin/git', ['-C', directory, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: {PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Selector Fixture', GIT_AUTHOR_EMAIL: 'selector@example.invalid', GIT_COMMITTER_NAME: 'Selector Fixture', GIT_COMMITTER_EMAIL: 'selector@example.invalid'},
  }).trim();
  const put = async (path, body) => { await mkdir(dirname(join(directory, path)), {recursive: true}); await writeFile(join(directory, path), body); };
  const commit = message => { git(['add', '.']); git(['commit', '-qm', message]); return git(['rev-parse', 'HEAD']); };
  const descriptorPath = id => `modules/${id}/freedom.module.json`;
  git(['init', '-q', '-b', 'main']);
  for (const descriptor of leafDescriptors()) await put(descriptorPath(descriptor.module_id), JSON.stringify(descriptor));
  await put('governance/README.md', '# Synthetic module rules\n');
  const leaf = FRONTEND_LEAF_PROFILES[0].paths[0]; await put(leaf, 'export const view = "before";\n');
  const base = commit('base');
  await put(leaf, 'export const view = "ordinary accessible redesign";\n');
  const head = commit('frontend edit');
  const observed = collectRepositoryDecision({repository: directory, event: 'pull_request', base, head}); assertLeaf(observed);
  const output = join(directory, 'job-output');
  const cli = spawnSync(process.execPath, [selector, '--event', 'pull_request', '--repository', directory, '--base', base, '--head', head, '--github-output', output], {encoding: 'utf8'});
  assert.equal(cli.status, 0, cli.stderr); assertLeaf(JSON.parse(cli.stdout));
  assert.equal(await readFile(output, 'utf8'), githubOutput(observed)); await rm(output);
  const compare = current => collectRepositoryDecision({repository: directory, event: 'pull_request', base, head: current});
  await put('packages/command-core/command.ts', 'export const unsafe = true;\n');
  assert.equal(compare(commit('mixed safety edit')).mode, 'full');
  git(['checkout', '-q', head]);
  const owner = leafDescriptors()[0]; owner.owned_paths = ['modules/elsewhere/**'];
  await put(descriptorPath(owner.module_id), JSON.stringify(owner));
  assert.equal(compare(commit('shrink owner')).mode, 'full');
  git(['checkout', '-q', head]);
  await put(descriptorPath('new-consumer'), JSON.stringify(moduleDescriptor('new-consumer', ['modules/new-consumer/**'], {dependencies: ['member-card']})));
  const dependentBase = commit('new reverse dependency');
  assert.equal(compare(dependentBase).mode, 'full');
  await put(leaf, 'export const view = "next leaf edit";\n');
  const dependentHead = commit('edit leaf beneath unchanged reverse consumer');
  const reverse = collectRepositoryDecision({repository: directory, event: 'pull_request', base: dependentBase, head: dependentHead});
  assert.equal(reverse.mode, 'full'); assert.equal(reverse.reason, 'leaf_profile_unproven');
  git(['checkout', '-q', head]); git(['mv', leaf, leaf + '.renamed']);
  assert.equal(compare(commit('rename leaf')).mode, 'full');
});


test('trusted Git tree and CLI admit README docs and reject mixed, owned and non-content changes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fp-select-readme-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const git = args => execFileSync('/usr/bin/git', ['-C', directory, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: {PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Selector Fixture', GIT_AUTHOR_EMAIL: 'selector@example.invalid', GIT_COMMITTER_NAME: 'Selector Fixture', GIT_COMMITTER_EMAIL: 'selector@example.invalid'},
  }).trim();
  const put = async (path, body) => { await mkdir(dirname(join(directory, path)), {recursive: true}); await writeFile(join(directory, path), body); };
  const commit = message => { git(['add', '.']); git(['commit', '-qm', message]); return git(['rev-parse', 'HEAD']); };
  const at = sha => git(['checkout', '-q', '-f', sha]); // Disposable fixture only.
  const descriptorPath = 'packages/example/freedom.module.json';
  const descriptor = moduleDescriptor('example', ['modules/example/**', 'docs/platform-plan/verification/**']);
  git(['init', '-q', '-b', 'main']);
  await put(descriptorPath, JSON.stringify(descriptor));
  await put('governance/README.md', '# Fixture\n');
  await put('README.md', '# Repository\n');
  await put(GENERATED_INVENTORY_PATH, '{}\n');
  await put('scripts/ci/select-affected-jobs.mjs', 'throw new Error("candidate selector must not run");\n');
  const base = commit('base');
  await put('README.md', '# Repository\n\n[Handoff](docs/development/community-curation-handoff.md)\n');
  await put('docs/development/community-curation-handoff.md', '# Dated handoff\n');
  await put(GENERATED_INVENTORY_PATH, '{"fixture":"candidate"}\n');
  const head = commit('README docs and inventory');
  const choose = (base, head) => collectRepositoryDecision({repository: directory, event: 'pull_request', base, head});
  assert.equal(choose(base, head).mode, 'docs');
  const output = join(directory, '.git', 'selection-output');
  const cli = spawnSync(process.execPath, [selector, '--event', 'pull_request', '--repository', directory,
    '--base', base, '--head', head, '--github-output', output], {encoding: 'utf8'});
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).mode, 'docs');
  assert.equal(await readFile(output, 'utf8'), githubOutput(choose(base, head)));
  // This is selection evidence only; the unchanged integrity job checks real
  // inventory bytes. Mutating a working tree cannot substitute for exact SHAs.
  await put('modules/example/uncommitted.mjs', 'throw new Error("not a committed input");\n');
  assert.equal(choose(base, head).mode, 'docs');
  const mixed = commit('mixed runtime change');
  assert.equal(choose(base, mixed).mode, 'full');
  at(head);
  await put(descriptorPath, JSON.stringify({...descriptor, owned_paths: [...descriptor.owned_paths, 'README.md']}));
  const ownedBase = commit('claim README');
  assert.equal(choose(base, ownedBase).mode, 'full');
  await put('README.md', '# Next README prose\n');
  const ownedHead = commit('owned README');
  assert.equal(choose(ownedBase, ownedHead).reason, 'baseline_candidate_union');
  await put(descriptorPath, JSON.stringify(descriptor));
  const shrunk = commit('remove ownership');
  assert.equal(choose(ownedBase, shrunk).mode, 'full');
  for (const invalid of [
    [descriptor, structuredClone(descriptor)],
    [{...descriptor, dependencies: ['absent']}],
    [{...descriptor, dependencies: [descriptor.module_id]}],
  ]) {
    at(base);
    await put(descriptorPath, JSON.stringify(invalid[0]));
    if (invalid[1]) await put('packages/duplicate/freedom.module.json', JSON.stringify(invalid[1]));
    const invalidBase = commit('invalid descriptor graph');
    await put('README.md', '# Only README prose changed\n');
    const invalidHead = commit('README beneath unchanged invalid graph');
    assert.equal(choose(invalidBase, invalidHead).reason, 'descriptors_unproven');
  }
  at(base);
  git(['update-index', '--chmod=+x', 'README.md']);
  git(['commit', '-qm', 'mode only']);
  assert.equal(choose(base, git(['rev-parse', 'HEAD'])).mode, 'full');
  at(base);
  git(['mv', 'README.md', 'docs/README.md']);
  const renamed = commit('rename README');
  assert.equal(choose(base, renamed).mode, 'full');
  assert.equal(choose(renamed, base).mode, 'full'); // Added root README is not M.
  at(base);
  git(['rm', '-q', 'README.md']);
  const deleted = commit('delete README');
  assert.equal(choose(base, deleted).mode, 'full');
  const symlinkOid = execFileSync('git', ['-C', directory, 'hash-object', '-w', '--stdin'], {input: 'governance/README.md', encoding: 'utf8'}).trim();
  git(['update-index', '--add', '--cacheinfo', `120000,${symlinkOid},README.md`]);
  git(['commit', '-qm', 'symlink README']);
  assert.equal(choose(base, git(['rev-parse', 'HEAD'])).mode, 'full');
});


function guideDescriptors() {
  const descriptors = leafDescriptors();
  descriptors.find(x=>x.module_id==='newcomer-guides').owned_paths.push('tests/e2e/newcomer-guides.spec.ts','tests/e2e/ai-sister-guides.spec.ts');
  for (const id of GUIDE_COMPOSITION_PROFILE.dependencies) if (!descriptors.some(x=>x.module_id===id))
    descriptors.push(moduleDescriptor(id, [`modules/${id}/**`]));
  descriptors.push(moduleDescriptor(GUIDE_COMPOSITION_PROFILE.module,
    [...GUIDE_COMPOSITION_PROFILE.files,'tests/runtime/game-console-routing.test.ts'],
    {dependencies:[...GUIDE_COMPOSITION_PROFILE.dependencies],tests:['runtime.full']}));
  return descriptors;
}

test('guide browser pilot admits only the existing guide leaves and unchanged impact graph', () => {
  const guide = FRONTEND_LEAF_PROFILES.find(profile => profile.module === 'newcomer-guides');
  const decide = (changes, extra = {}) => decideE2eProfile({ event: 'pull_request', diffComplete: true,
    baseline: guideDescriptors(), candidate: guideDescriptors(), changes, ...extra });
  for (const path of guide.paths) assert.equal(decide([edited(path)]).profile, 'newcomer-guides');
  assert.equal(decide([...guide.paths.map(path => edited(path)), edited(GENERATED_INVENTORY_PATH), edited('docs/development/guide.md')]).profile, 'newcomer-guides');
  const excluded = ['apps/portal-web/src/App.tsx', 'apps/portal-web/src/WorkspaceCompanionLayout.tsx',
    'apps/platform-api/src/app.ts', 'modules/identity-membership/service.ts', 'packages/db/index.ts',
    'packages/testing/e2e-auth-isolation.ts', 'migrations/161_test.sql', 'scripts/ci/run-pinned-e2e.mjs',
    'tests/e2e/newcomer-guides.spec.ts', 'tests/e2e/fixtures.ts', 'scripts/e2e-server.ts',
    'playwright.config.ts', 'package.json', 'vite.config.ts',
    ...['gate.ts','contracts.ts','release-pin.ts','content.ts'].map(path => 'apps/portal-web/src/modules/newcomer-guides/' + path),
    FRONTEND_LEAF_PROFILES[0].paths[0], 'unknown-path.ts'];
  for (const path of excluded) assert.equal(decide([edited(guide.paths[0]), edited(path)]).profile, 'full', path);
  for (const status of ['A','D','R100','C100','T']) assert.equal(decide([edited(guide.paths[0], status)]).profile, 'full');
  for (const event of ['push','merge_group','workflow_dispatch',undefined]) assert.equal(decide([edited(guide.paths[0])], {event}).profile, 'full');
  assert.equal(decide([edited(guide.paths[0])], {diffComplete:false}).profile, 'full');
  const baseline = guideDescriptors();
  for (const mutate of [
    graph => graph.find(x=>x.module_id==='newcomer-guides').owned_paths.splice(0),
    graph => graph.push(moduleDescriptor('other', [guide.paths[0]])),
    graph => graph.push(moduleDescriptor('other', ['modules/other/**'], {dependencies:['newcomer-guides']})),
    graph => graph.find(x=>x.module_id==='newcomer-guides').dependencies.push('missing'),
    graph => graph.find(x=>x.module_id==='public-guide-assets').dependencies.push('newcomer-guides'),
    graph => graph.push(graph[0]),
    graph => graph.find(x=>x.module_id==='application-composition').owned_paths.push('tests/e2e/new-composition.spec.ts'),
    graph => graph.find(x=>x.module_id==='application-composition').dependencies.pop(),
    graph => graph.find(x=>x.module_id==='application-composition').owned_paths.push('tests/**'),
    graph => graph.find(x=>x.module_id==='newcomer-guides').owned_paths.push('tests/**'),
    graph => graph.push(moduleDescriptor('overlap', [GUIDE_COMPOSITION_PROFILE.files[0]])),
    graph => graph.push(moduleDescriptor('consumer', ['modules/consumer/**'],{dependencies:['application-composition']})),
  ]) {
    const candidate = structuredClone(baseline); mutate(candidate);
    assert.equal(decide([edited(guide.paths[0])], {baseline,candidate}).profile, 'full');
    assert.equal(decide([edited(guide.paths[0])], {baseline:candidate,candidate}).profile, 'full');
  }
});

test('guide pilot binds clean integration checkout, ordered parents and host event before narrowing', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fp-guide-select-'));
  t.after(() => rm(directory, {recursive:true,force:true}));
  const git = (args,input) => execFileSync('/usr/bin/git', ['-C', directory, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    input,encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',
      GIT_AUTHOR_NAME:'Guide Test',GIT_AUTHOR_EMAIL:'guide@example.invalid',GIT_COMMITTER_NAME:'Guide Test',GIT_COMMITTER_EMAIL:'guide@example.invalid'},
  }).trim();
  const put = async (path,body) => { await mkdir(dirname(join(directory,path)),{recursive:true});await writeFile(join(directory,path),body); };
  git(['init','-q','-b','main']);
  for (const descriptor of guideDescriptors()) await put(`modules/${descriptor.module_id}/freedom.module.json`,JSON.stringify(descriptor));
  const leaf = FRONTEND_LEAF_PROFILES.find(p=>p.module==='newcomer-guides').paths[0];
  await put('.gitignore','tests/e2e/generated.spec.ts\n');
  await put(leaf,'before');git(['add','.']);git(['commit','-qm','base']);const base=git(['rev-parse','HEAD']);
  await put(leaf,'after');git(['add','.']);git(['commit','-qm','guide']);const head=git(['rev-parse','HEAD']);
  const candidate=git(['commit-tree',git(['rev-parse','HEAD^{tree}']),'-p',base,'-p',head], 'integration\n');
  git(['checkout','-q',candidate]);
  const input={repository:directory,event:'pull_request',base,head,candidate};
  assert.equal(collectRepositoryE2eDecision(input).profile,'newcomer-guides');
  for (const extra of [{event:'push'},{event:'merge_group'},{candidate:head},{head:base},{base:head},{candidate:''}])
    assert.equal(collectRepositoryE2eDecision({...input,...extra}).profile,'full');
  await put(leaf,'dirty');assert.equal(collectRepositoryE2eDecision(input).profile,'full');
  git(['checkout','--',leaf]);await put('tests/e2e/generated.spec.ts','ignored new test');
  assert.equal(git(['status','--porcelain']), '');
  assert.equal(collectRepositoryE2eDecision(input).profile,'full');
  await rm(join(directory,'tests/e2e/generated.spec.ts'));
  await put('unexpected.ts','new');assert.equal(collectRepositoryE2eDecision(input).profile,'full');
});


test('additional composition runtime ownership keeps the guide browser obligation full across adoption', () => {
  const baseline=guideDescriptors(),expanded=guideDescriptors();
  expanded.find(descriptor=>descriptor.module_id==='application-composition').owned_paths.push('tests/runtime/platform-json-body.test.ts');
  for (const [before,after] of [[baseline,expanded],[expanded,expanded]]) {
    for (const path of FRONTEND_LEAF_PROFILES.find(profile=>profile.module==='newcomer-guides').paths) {
      const input={event:'pull_request',diffComplete:true,changes:[edited(path)],baseline:before,candidate:after};
      assert.equal(decideAffectedJobs(input).mode,'full','job obligations are not narrowed');
      assert.deepEqual(decideE2eProfile(input),{profile:'full',reason:'guide_impact_unproven'});
    }
  }
});

const planReceiptPaths = [
  'docs/platform-plan/execution/guild-launchpad/README.md',
  'docs/platform-plan/execution/unified-foundation/closeout.md',
  'docs/platform-plan/execution/unified-foundation/current-state.json',
  'docs/platform-plan/execution/unified-foundation/rollout-main-b14916cc-2026-10-26.json',
  GENERATED_INVENTORY_PATH,
];
const minimalSelection = reason => ({mode: 'affected', reason,
  jobs: Object.fromEntries(SELECTABLE_JOBS.map(id => [id, MINIMAL_JOB_PROFILES[reason].includes(id)]))});

test('plan receipts ignore descriptor ownership; real #1083 inputs retain only their Python consumer', () => {
  const actual = loadModuleDescriptors(root, execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim());
  assert.equal(actual.ok, true);
  assert.deepEqual(pull(planReceiptPaths.map(path => edited(path)), {baseline:actual.descriptors, candidate:actual.descriptors}),
    minimalSelection('plan_document_inputs'));
  for (const path of [planReceiptPaths[1], planReceiptPaths[3], GENERATED_INVENTORY_PATH,
    'docs/platform-plan/execution/commerce/work-plan.md',
    'docs/platform-plan/execution/supplier-console/work-plan.md',
    'docs/platform-plan/execution/unified-foundation/requirement-evidence.json',
    'docs/platform-plan/contracts/README.md']) {
    assert.deepEqual(pull([edited(path)], {baseline:actual.descriptors, candidate:actual.descriptors}),
      minimalSelection('plan_receipt_docs'), path);
  }
  for (const path of [planReceiptPaths[0], planReceiptPaths[2],
    'docs/platform-plan/execution/milestones.md', 'docs/platform-plan/execution/spec-index.md',
    'docs/platform-plan/execution/specs/FND-01.md', 'docs/platform-plan/execution/first-work-batch.md',
    'docs/platform-plan/execution/acceptance-matrix.md',
    'docs/platform-plan/execution/guild-launchpad/traceability.json',
    'docs/platform-plan/execution/guild-launchpad/acceptance-progress.json']) {
    assert.deepEqual(pull([edited(path)]), minimalSelection('plan_document_inputs'), path);
  }
});

test('real #1087 diff retains full selection', () => {
  // Captured from git diff --name-only b267f472 95aae4da at 274f0614.
  // Keep the real list without requiring historical objects in shallow PR CI.
  const paths = [
    '.github/workflows/shared-backup.yml',
    'deploy/cloudflare/test/shared-release.test.mjs',
    'deploy/shared-release/README.md',
    'deploy/shared-release/backup-cli.mjs',
    'deploy/shared-release/operator.mjs',
    'deploy/shared-release/portable/backup-recovery.mjs',
    'deploy/shared-release/portable/backup.mjs',
    'deploy/shared-release/portable/entry.mjs',
    'deploy/shared-release/portable/floor.mjs',
    'deploy/shared-release/scheduled-admission.mjs',
    'deploy/shared-release/test/backup-integration.mjs',
    'tests/e2e/absurd-daily.spec.ts',
  ];
  assert(paths.includes('tests/e2e/absurd-daily.spec.ts'), 'record the actual mixed diff instead of silently dropping a file');
  assert.equal(pull(paths.map(path => edited(path))).mode, 'full');
});

test('module/app prose skips heavy jobs while real Markdown inputs retain their existing obligations', () => {
  for (const path of ['modules/tester-map/COORDINATION.md', 'modules/identity-membership/README.md',
    'apps/portal-web/README.md']) {
    const graph = [moduleDescriptor('notes', [path])];
    assert.deepEqual(pull([edited(path)], {baseline:graph}), minimalSelection('module_app_markdown'));
  }
  for (const path of ['modules/agent-commerce/operations/notifications/README.md',
    'modules/module-registry/platform-hold.md', 'modules/guild-supply/README.md',
    'modules/module-data/AGENTS.md']) assert.equal(pull([edited(path)]).mode, 'full', path);
  // Existing guild presentation integration/dependency tests still exercise its profile.
  assert.equal(pull([edited('apps/portal-web/src/App.tsx')]).mode, 'full');
  const graph = FRONTEND_LEAF_PROFILES.map(profile => moduleDescriptor(profile.module, profile.paths,
    {dependencies:profile.dependencies, tests:profile.tests}));
  for (const id of ['command-core', 'public-guide-assets']) graph.push(moduleDescriptor(id, [`modules/${id}/**`]));
  assert.deepEqual(pull([edited(FRONTEND_LEAF_PROFILES[0].paths[0])], {baseline:graph}).jobs,
    Object.fromEntries(SELECTABLE_JOBS.map(id => [id, FRONTEND_LEAF_JOBS.includes(id)])));
});

test('minimal lanes retain code, data consumers, destructive diffs and invalid graphs', () => {
  for (const path of ['docs/platform-plan/execution/tools/tests/test_guild_launchpad_status.py',
    'docs/platform-plan/execution/guild-launchpad/validate-spec-pack.py',
    'docs/platform-plan/contracts/project-manifest.schema.json',
    'docs/platform-plan/contracts/tests/fixtures/five-clocks/catalog.yaml',
    'docs/platform-plan/verification/verify_revision.py', 'docs/platform-plan/execution/new.ts',
    'docs/platform-plan/execution/commerce/ecpay-logistics-status-map.tsv'])
    assert.equal(pull([edited(path)]).mode, 'full', path);
  for (const event of ['push', 'merge_group', 'workflow_dispatch', undefined])
    assert.equal(pull([edited(planReceiptPaths[1])], {event}).mode, 'full');
  for (const extra of [{diffComplete:false}, {descriptorsProven:false}, {nonExecutableBlobsProven:false},
    {baseline:[]}, {candidate:[]}]) assert.equal(pull([edited(planReceiptPaths[1])], extra).mode, 'full');
  for (const status of ['D', 'R', 'R100', 'C', 'T', 'U', 'X'])
    assert.equal(pull([edited(planReceiptPaths[1], status)]).mode, 'full');
  for (const mutate of [graph => graph.push(structuredClone(graph[0])),
    graph => graph[0].dependencies.push('absent'), graph => graph[0].dependencies.push('example')]) {
    const graph = narrow(); mutate(graph);
    assert.equal(pull([edited(planReceiptPaths[1])], {candidate:graph}).mode, 'full');
  }
  assert.equal(decideMinimalProfile({event:'pull_request',diffComplete:true,changes:[]}).profile,'full');
});

test('each minimal aggregate accepts only its exact outputs and successful selected evidence', () => {
  for (const reason of Object.keys(MINIMAL_JOB_PROFILES)) {
    const selected = minimalSelection(reason);
    const results = Object.fromEntries(SELECTABLE_JOBS.map(id => [id, selected.jobs[id] ? 'success' : 'skipped']));
    assert.equal(evaluateVerifyAggregate(needsFor(selected, results)).ok, true, reason);
    for (const id of SELECTABLE_JOBS) {
      const missing = needsFor(selected, results); delete missing[id];
      assert.equal(evaluateVerifyAggregate(missing).ok, false);
      const forged = needsFor(selected, results);
      forged.select.outputs[JOB_OUTPUT_KEYS[id]] = String(!selected.jobs[id]);
      assert.equal(evaluateVerifyAggregate(forged).ok, false);
      for (const result of ['failure', 'cancelled', ...(selected.jobs[id] ? ['skipped'] : [])])
        assert.equal(evaluateVerifyAggregate(needsFor(selected, {...results, [id]:result})).ok, false);
    }
    for (const options of [{select:'failure'}, {integrity:'failure'}, {integrity:'skipped'}])
      assert.equal(evaluateVerifyAggregate(needsFor(selected, results, options)).ok, false);
    for (const reason of ['invented_profile', 'constructor']) {
      const unknown = needsFor(selected, results); unknown.select.outputs.reason = reason;
      assert.equal(evaluateVerifyAggregate(unknown).ok, false);
    }
  }
});

test('minimal lanes use clean exact integration Git blobs, reject executable blobs and ignore candidate selector code', async t => {
  const directory=await mkdtemp(join(tmpdir(),'fp-handoff-select-'));
  t.after(() => rm(directory,{recursive:true,force:true}));
  const git=(args,input) => execFileSync('/usr/bin/git',['-C',directory,'-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null',...args],{
    input,encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',
      GIT_AUTHOR_NAME:'Handoff Test',GIT_AUTHOR_EMAIL:'handoff@example.invalid',GIT_COMMITTER_NAME:'Handoff Test',GIT_COMMITTER_EMAIL:'handoff@example.invalid'},
  }).trim();
  const put=async(path,body) => {await mkdir(dirname(join(directory,path)),{recursive:true});await writeFile(join(directory,path),body);};
  const commit=message => {git(['add','.']);git(['commit','-qm',message]);return git(['rev-parse','HEAD']);};
  const merge=(base,head) => {const candidate=git(['commit-tree',git(['rev-parse',`${head}^{tree}`]),'-p',base,'-p',head],'integration\n');git(['checkout','-q',candidate]);return candidate;};
  git(['init','-q','-b','main']);
  for (const d of narrow()) await put(`modules/${d.module_id}/freedom.module.json`,JSON.stringify(d));
  for (const p of planReceiptPaths.filter(path => path !== planReceiptPaths[3])) await put(p,'before\n');
  await put('.gitignore','tests/e2e/generated.spec.ts\n');
  await put('scripts/ci/select-affected-jobs.mjs','throw new Error("candidate selector must not run");\n');
  const base=commit('base');
  for (const p of [...planReceiptPaths,GENERATED_INVENTORY_PATH]) await put(p,'after\n');
  const head=commit('informational handoffs'), candidate=merge(base,head);
  const input={repository:directory,event:'pull_request',base,head,candidate};
  assert.deepEqual(collectRepositoryDecision(input),minimalSelection('plan_document_inputs'));
  const output=join(directory,'.git','selection-output');
  const cli=spawnSync(process.execPath,[selector,'--event','pull_request','--repository',directory,'--base',base,'--head',head,'--candidate',candidate,'--github-output',output],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),minimalSelection('plan_document_inputs'));
  assert.equal(await readFile(output,'utf8'),githubOutput(minimalSelection('plan_document_inputs')));
  for (const extra of [{event:'push'},{event:'merge_group'},{candidate:head},{head:base},{base:head},{candidate:''}])
    assert.equal(collectRepositoryDecision({...input,...extra}).mode,'full');
  await put(planReceiptPaths[0],'dirty');assert.equal(collectRepositoryDecision(input).mode,'full');git(['checkout','--',planReceiptPaths[0]]);
  await put('unexpected.md','untracked');assert.equal(collectRepositoryDecision(input).mode,'full');await rm(join(directory,'unexpected.md'));
  await put('tests/e2e/generated.spec.ts','ignored');assert.equal(collectRepositoryDecision(input).mode,'full');await rm(join(directory,'tests/e2e/generated.spec.ts'));
  const reversed=git(['commit-tree',git(['rev-parse',`${head}^{tree}`]),'-p',head,'-p',base],'reversed\n');git(['checkout','-q',reversed]);
  assert.equal(collectRepositoryDecision({...input,candidate:reversed}).mode,'full');
  git(['checkout','-q',base]);git(['update-index','--chmod=+x',planReceiptPaths[0]]);git(['commit','-qm','executable base']);
  const executableBase=git(['rev-parse','HEAD']);await put(planReceiptPaths[0],'executable edit');
  git(['add',planReceiptPaths[0]]);git(['update-index','--chmod=+x',planReceiptPaths[0]]);git(['commit','-qm','executable head']);
  const executableHead=git(['rev-parse','HEAD']), executableCandidate=merge(executableBase,executableHead);
  assert.equal(collectRepositoryDecision({...input,base:executableBase,head:executableHead,candidate:executableCandidate}).mode,'full');
});

test('delivery tooling runs its existing coverage on PR and main without unrelated product jobs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fp-delivery-select-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const git = (args, input) => execFileSync('/usr/bin/git', ['-C', directory, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Delivery Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Delivery Test', GIT_COMMITTER_EMAIL: 'test@example.invalid'},
  }).trim();
  const put = async (path, body) => { await mkdir(dirname(join(directory, path)), {recursive: true}); await writeFile(join(directory, path), body); };
  const commit = message => { git(['add', '.']); git(['commit', '-qm', message]); return git(['rev-parse', 'HEAD']); };
  const merge = (base, head) => { const sha = git(['commit-tree', git(['rev-parse', `${head}^{tree}`]), '-p', base, '-p', head], 'integration\n'); git(['checkout', '-q', sha]); return sha; };
  git(['init', '-q', '-b', 'main']);
  const descriptors = [
    moduleDescriptor('governance', ['scripts/ci/**', '.github/workflows/verify.yml', 'packages/contribution-tools/**'], {tests:['governance.unit','runtime.full']}),
    moduleDescriptor('media-migration', ['packages/media-migration/**', 'tests/runtime/media-backup-daily.test.ts'], {tests:['runtime.full']}),
    moduleDescriptor('shared-release', ['deploy/shared-release/**', '.github/workflows/shared-release.yml'], {dependencies: ['governance', 'media-migration'],tests:['governance.unit','runtime.full']}),
  ];
  for (const d of descriptors) await put(`modules/${d.module_id}/freedom.module.json`, JSON.stringify(d));
  const paths = ['deploy/shared-release/portable/entry.mjs', '.github/workflows/shared-release.yml',
    'packages/media-migration/backup-daily.ts', 'tests/runtime/media-backup-daily.test.ts',
    'scripts/ci/select-affected-jobs.mjs', '.github/workflows/verify.yml', GENERATED_INVENTORY_PATH];
  for (const path of paths) await put(path, path==='.github/workflows/verify.yml'?deliveryWorkflow('before'):'// before\n');
  const registryPath='packages/contribution-tools/pinned-suites.mjs';
  const registry=await readFile(join(root,registryPath),'utf8');
  const dailyLine=registry.split('\n').find(line=>line.startsWith("  'ci.daily-backup':"))+'\n';
  await put(registryPath,registry.replace(dailyLine,''));
  const base = commit('base');
  await put(registryPath,registry);
  for (const path of paths) await put(path, path==='.github/workflows/verify.yml'?deliveryWorkflow('after'):'// after\n');
  await put('packages/media-migration/backup-diagnostics.ts', 'new diagnostic helper\n');
  const head = commit('release and daily backup'), candidate = merge(base, head);
  const input = {repository: directory, event: 'pull_request', base, head, candidate};
  const selected = collectRepositoryDecision(input);
  assert.equal(selected.reason, 'delivery_tooling');
  assert.deepEqual(Object.entries(selected.jobs).filter(([, run]) => run).map(([id]) => id), ['deploy-preflight']);
  assert.deepEqual(collectRepositoryDecision({...input, event: 'push', head: candidate}), selected);
  const results = Object.fromEntries(SELECTABLE_JOBS.map(id => [id, selected.jobs[id] ? 'success' : 'skipped']));
  assert.equal(evaluateVerifyAggregate(needsFor(selected, results)).ok, true);
  for (const result of ['skipped', 'failure', 'cancelled'])
    assert.equal(evaluateVerifyAggregate(needsFor(selected, {...results, 'deploy-preflight': result})).ok, false);
  assert.equal(evaluateVerifyAggregate(needsFor(selected, results, {integrity: 'failure'})).ok, false);
  for (const extra of [{candidate: head}, {base: head}, {head: base}, {event: 'merge_group'}])
    assert.equal(collectRepositoryDecision({...input, ...extra}).mode, 'full');
  await put(paths[0], 'dirty\n'); assert.equal(collectRepositoryDecision(input).mode, 'full'); git(['checkout', '--', paths[0]]);
  // Mixing even one product/helper, migration, descriptor or unrelated control
  // change must restore its wider coverage; operator naming grants no exemption.
  for (const path of ['apps/portal-web/src/App.tsx', 'modules/agent-commerce/hosted/store.ts',
    'packages/media-migration/inventory.ts', 'packages/db/migrations.ts',
    '.github/workflows/codeql.yml', 'deploy/shared-release/freedom.module.json',
    'scripts/ci/run-pinned-suite.mjs']) {
    git(['checkout', '-q', head]); await put(path, 'mixed\n');
    const mixed = commit('mixed change'), integration = merge(base, mixed);
    assert.equal(collectRepositoryDecision({...input, head: mixed, candidate: integration}).mode, 'full', path);
  }
  git(['checkout', '-q', head]); git(['rm', paths[0]]); const deleted = commit('delete');
  assert.equal(collectRepositoryDecision({...input, head: deleted, candidate: merge(base, deleted)}).mode, 'full');
  git(['checkout', '-q', head]); git(['update-index', '--chmod=+x', paths[0]]); git(['commit', '-qm', 'mode']);
  const mode = git(['rev-parse', 'HEAD']); git(['checkout', '--', paths[0]]);
  assert.equal(collectRepositoryDecision({...input, head: mode, candidate: merge(base, mode)}).mode, 'full');
  git(['checkout', '-q', head]);
  const restoreTest = 'deploy/cloudflare/test/media-restore-container.test.mjs';
  await put(restoreTest, '// already-covered operator harness\n');
  await put('modules/media-migration/freedom.module.json', JSON.stringify({...descriptors[1],
    owned_paths: [...descriptors[1].owned_paths, restoreTest]}));
  const owner = commit('assign operator harness owner');
  assert.deepEqual(collectRepositoryDecision({...input, head: owner, candidate: merge(base, owner)}), selected);
  for(const changed of [registry.replace('timeoutMs: 900000','timeoutMs: 900001'),registry.replace("loader: 'node'","loader: 'tsx'")]) {
    git(['checkout','-q',candidate]);assert.deepEqual(collectRepositoryDecision(input),selected);
    git(['checkout','-q',head]);await put(registryPath,changed);const wrong=commit('existing suite change');
    assert.equal(collectRepositoryDecision({...input,head:wrong,candidate:merge(base,wrong)}).mode,'full');
  }
  // Each counterexample starts from the admitted exact integration.
  for (const replacement of [deliveryWorkflow('after').replace('npm run test:e2e','exit 1'),
    deliveryWorkflow('after').replace('  pull_request:', '  push:')]) {
    git(['checkout','-q',candidate]);assert.deepEqual(collectRepositoryDecision(input),selected);
    git(['checkout','-q',head]);await put('.github/workflows/verify.yml',replacement);
    const wrong=commit('unrelated workflow behavior');
    assert.equal(collectRepositoryDecision({...input,head:wrong,candidate:merge(base,wrong)}).mode,'full');
  }
  for (const extra of [
    moduleDescriptor('new-consumer',['modules/new/**'],{dependencies:['shared-release'],tests:['governance.unit','runtime.full']}),
    {...moduleDescriptor('instruction-consumer',['modules/other/**']),instructions:['deploy/shared-release/AGENTS.md']},
  ]) {
    git(['checkout','-q',head]);await put('modules/'+extra.module_id+'/freedom.module.json',JSON.stringify(extra));
    await put('deploy/shared-release/AGENTS.md','local instructions');const adopted=commit('adopted consumer');
    await put('deploy/shared-release/AGENTS.md','changed local instructions');await put(paths[0],'// changed controller');
    const next=commit('controller with consumer');
    assert.equal(collectRepositoryDecision({...input,base:adopted,head:next,candidate:merge(adopted,next)}).mode,'full');
  }
  git(['checkout', '-q', head]);
  await put('modules/governance/freedom.module.json', JSON.stringify({...descriptors[0], tests: ['runtime.full']}));
  const drift = commit('descriptor drift');
  assert.equal(collectRepositoryDecision({...input, head: drift, candidate: merge(base, drift)}).mode, 'full');
});

test('delivery CI retains native restore and daily backup diagnostics in its selected job', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const job = jobBlock(workflow, 'deploy-preflight');
  assert.match(job, /--suite ci\.deploy-preflight/);
  assert.match(job, /--suite ci\.migration-postgres/);
  assert.match(job, /postgres-integration\.mjs --source \./);
  assert.match(job, /run-pinned-suite\.mjs --root \. --suite ci\.daily-backup/);
  assert.match(job, /node node_modules\/typescript\/bin\/tsc --noEmit/);
  assert.match(jobBlock(workflow, 'select'), /github\.event\.pull_request\.base\.sha \|\| github\.event\.before/);
});

function deliveryWorkflow(value) {
  return `name: Verify
on:
  pull_request:
jobs:
  select:
    runs-on: ubuntu-24.04
    steps:
      - run: echo ${value}
  deploy-preflight:
    runs-on: ubuntu-24.04
    steps:
      - run: echo ${value}
  ui-e2e:
    runs-on: ubuntu-24.04
    steps:
      - run: npm run test:e2e
`;
}

test('delivery Verify comparison preserves unrelated jobs and global execution policy', async () => {
  const before=deliveryWorkflow('before'),after=deliveryWorkflow('after');
  assert.equal(deliveryVerifyWiringOnly(before,after),true);
  for(const changed of [after.replace('npm run test:e2e','exit 1'),after.replace('name: Verify','name: Other'),
    after.replace('  pull_request:', '  push:'),after+'permissions:\n  contents: write\n',
    after.replace('run: echo after','run: &shared echo after'),after.replace('  ui-e2e:', '  runtime-full:')])
    assert.equal(deliveryVerifyWiringOnly(before,changed),false);
  const actual=await readFile(workflowPath,'utf8');
  assert.equal(deliveryVerifyWiringOnly(actual,actual),true,'real workflow expressions are not YAML tags');
  assert.equal(deliveryVerifyWiringOnly(actual,actual.replace('Verify complete daily backup orchestration evidence','Daily coverage')),true);
  assert.equal(deliveryVerifyWiringOnly(actual,actual.replace('--suite ci.worker-unit','--suite ci.unknown')),false);
  for(const header of ['  \"outside-job\":','  outside_job:']) {
    const appended=actual+'\n'+header+'\n    runs-on: ubuntu-24.04\n    steps:\n      - run: exit 1\n';
    assert.equal(deliveryVerifyWiringOnly(actual,appended),false,header);
  }
});


test('actual delivery coverage keeps daily-backup bounded and rejects new consumers, instructions and suites', () => {
  const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const loaded=loadModuleDescriptors(root,sha);assert.equal(loaded.ok,true);
  const graph=new Map(loaded.descriptors.map(d=>[d.module_id,d]));
  const files=parseLsTreeZ(execFileSync('git',['-C',root,'ls-tree','-r','-z',sha],{encoding:'utf8',maxBuffer:16000000})).files;
  const cache=new Map(),read=path=>{
    if(!cache.has(path))cache.set(path,execFileSync('git',['-C',root,'show',sha+':'+path],{encoding:'utf8',maxBuffer:16000000}));
    return cache.get(path);
  };
  const paths=['deploy/shared-release/operator.mjs','packages/media-migration/backup-daily.ts'];
  const prove=(g=graph,f=files,r=read)=>deliveryCoverageProven([g,g],paths,[{graph:g,files:f,read:r}]);
  assert.equal(prove(),true,'the real graph/source positive must narrow before checking negative mutations');
  for(const mutate of [
    g=>g.set('new-consumer',moduleDescriptor('new-consumer',['modules/new/**'],{dependencies:['shared-release'],tests:['governance.unit','runtime.full']})),
    g=>g.set('new-media-consumer',moduleDescriptor('new-media-consumer',['modules/new-media/**'],{dependencies:['media-migration'],tests:['runtime.full']})),
    g=>g.get('shared-release').tests.push('ui.default'),
    g=>g.get('media-migration').tests.push('runtime.member-card'),
    g=>g.get('community').instructions.push(paths[0]),
    g=>g.get('media-migration').public_exports.push(paths[1]),
  ]) {const g=structuredClone(graph);mutate(g);assert.equal(prove(g),false);}
  const path='modules/community/events.ts',f=new Map(files);
  assert.ok(owns(graph.get('community'),path),'owned consumer is checked by the selector');
  f.set(path,{mode:'100644',type:'blob',oid:oid()});
  for(const source of [
    "import {runDailyBackup} from '../../packages/media-migration/backup-daily.js';",
    "export * from '../../packages/media-migration/backup-diagnostics.js';",
    "const x=import('../../packages/media-migration/backup-daily.js');",
    "const target=process.env.TARGET; const x=import(target);",
    "import Alias = require('../../packages/media-migration/backup-daily.js');",
  ]) assert.equal(prove(graph,f,p=>p===path?source:read(p)),false,source);
  assert.equal(prove(graph,f,p=>p===path?"export const unaffected=1;":read(p)),true);
});


test('unowned ownership warnings do not bypass the retained delivery import boundary', async t => {
  const directory=await mkdtemp(join(tmpdir(),'fp-delivery-ownership-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  execFileSync('git',['clone','--quiet','--shared','--no-checkout',root,directory],{stdio:'pipe'});
  execFileSync('git',['-C',directory,'checkout','--quiet',sha],{stdio:'pipe'});
  const gate='packages/contribution-tools/test/modules-repository.test.mjs';
  assert.ok(PINNED_SUITES['ci.governance-unit'].baseline.includes(gate));
  assert.ok(ALWAYS_ON_INTEGRITY_COMMANDS.some(command=>command.includes('--suite ci.governance-unit')));
  const run=()=>spawnSync(process.execPath,['--test',join(directory,gate)],{cwd:directory,encoding:'utf8',env:verificationEnvironment()});
  const positive=run();assert.equal(positive.status,0,positive.stdout+positive.stderr);
  assert.match(positive.stdout,/pass 1/,'the mandatory test actually executed');
  const path='modules/community/review-consumer.ts';
  await writeFile(join(directory,path),"import {runDailyBackup} from '../../packages/media-migration/backup-daily.js';\n");
  const warned=run();assert.equal(warned.status,0,warned.stdout+warned.stderr);
  assert.match(warned.stdout+warned.stderr,/surface_unmapped/);
  assert.ok((warned.stdout+warned.stderr).includes(path));
  const loaded=loadModuleDescriptors(directory,sha);assert.equal(loaded.ok,true);
  const graph=new Map(loaded.descriptors.map(d=>[d.module_id,d]));
  const files=new Map([[path,{mode:'100644',type:'blob',oid:oid()}]]);
  const prove=source=>deliveryCoverageProven([graph,graph],['deploy/shared-release/operator.mjs'],[{graph,files,read:()=>source}]);
  assert.equal(prove('export const unrelated=1;'),true);
  assert.equal(prove(await readFile(join(directory,path),'utf8')),false);
  // Ownership is now an advisory warning. Literal delivery imports still expand
  // selection; an independent mandatory integrity failure still fails verify.
  const selected={mode:'affected',reason:'delivery_tooling',jobs:Object.fromEntries(SELECTABLE_JOBS.map(id=>[id,id==='deploy-preflight']))};
  const results={...allResults('skipped'),'deploy-preflight':'success'};
  assert.equal(evaluateVerifyAggregate(needsFor(selected,results)).ok,true);
  assert.equal(evaluateVerifyAggregate(needsFor(selected,results,{integrity:'failure'})).ok,false);
});


test('daily registry exception preserves all existing suites and required completeness coverage', async () => {
  const after=await readFile(join(root,'packages/contribution-tools/pinned-suites.mjs'),'utf8');
  const line=after.split('\n').find(line=>line.startsWith("  'ci.daily-backup':"))+'\n';
  const before=after.replace(line,'');
  assert.equal(deliveryDailyRegistryAddition(before,after),true);
  for(const changed of [after.replace("loader: 'node'","loader: 'tsx'"),
    after.replace('timeoutMs: 900000','timeoutMs: 900001'),after.replace("database: true","database: false"),
    after.replace("pattern: /^[a-z]","pattern: /^[b-z]"),after+line,
    after.replace('tests/runtime/media-backup-daily.test.ts','tests/runtime/other.test.ts'),
    after.replace("'ci.worker-unit':","'ci.renamed-worker':")])
    assert.equal(deliveryDailyRegistryAddition(before,changed),false);
  assert.equal(deliveryDailyRegistryAddition(after,before),false);
  assert.ok(PINNED_SUITES['ci.governance-unit'].baseline.includes('packages/contribution-tools/test/pinned-suite.test.mjs'));
  assert.ok(ALWAYS_ON_INTEGRITY_COMMANDS.some(c=>c.includes('--suite ci.governance-unit')));
  const integrity=jobBlock(await readFile(workflowPath,'utf8'),'source-integrity');
  assert.match(integrity,/\n      - run: node \.freedom\/trusted\/scripts\/ci\/run-pinned-suite\.mjs --root \. --suite ci\.governance-unit\n/);
});


test('owned outside source cannot introduce literal delivery consumers without a declared dependency', () => {
  const loaded=loadModuleDescriptors(root,'HEAD');assert.equal(loaded.ok,true);
  const graph=new Map(loaded.descriptors.map(d=>[d.module_id,d]));
  const path='packages/contribution-tools/io.mjs';
  assert.ok(loaded.descriptors.some(d=>owns(d,path)),'fixture is already owned');
  const files=new Map([[path,{mode:'100644',type:'blob',oid:oid()}]]);
  for(const changed of ['packages/media-migration/backup-daily.ts','deploy/shared-release/operator.mjs']) {
    const prove=source=>deliveryCoverageProven([graph,graph],[changed],[{graph,files,read:()=>source}]);
    assert.equal(prove('export const unrelated=1;'),true);
    for(const target of ['../media-migration/backup-daily.js','../../deploy/shared-release/operator.mjs'])
      for(const source of [`import * as x from '${target}';`,`export * from '${target}';`,
        `const x=import('${target}');`,`const x=require('${target}');`,`type T=import('${target}').T;`])
        assert.equal(prove(source),false,changed+': '+source);
  }
});


async function ciToolsWorkflowFixture() {
  const after=await readFile(workflowPath,'utf8'),block=jobBlock(after,'static-worker');
  const beforeBlock=block.replace('      contents: read\n','      contents: read\n      statuses: read\n')
    .replace('    steps:\n','    steps:\n'+"      - name: Checkout the pinned worker status guard\n        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\n        with:\n          repository: ${{ job.workflow_repository }}\n          ref: ${{ job.workflow_sha }}\n          path: .freedom/worker-status\n          persist-credentials: false\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4\n        with:\n          node-version: '24'\n      - name: Require CircleCI worker success for an identical same-repository PR tree\n        id: worker-provider\n        env:\n          GH_STATUS_TOKEN: ${{ github.token }}\n        run: node .freedom/worker-status/packages/contribution-tools/circleci-worker-status.mjs\n")
    .replace('      - run: node .freedom/trusted/scripts/ci/run-pinned-suite.mjs --root . --suite ci.worker-unit\n',
      "      - run: node .freedom/trusted/scripts/ci/run-pinned-suite.mjs --root . --suite ci.worker-unit\n        if: steps.worker-provider.outputs.run_github == 'true'\n");
  return {before:after.replace(block,beforeBlock),after};
}
test('CI-tools proof permits only provider retirement and the bounded module schema increase',async()=>{
  const {before,after}=await ciToolsWorkflowFixture();
  assert.equal(ciToolsWorkflowProven(before,after),true);
  assert.equal(ciToolsWorkflowProven(after,after),true);
  for(const changed of [after.replace('--suite ci.worker-unit','--suite ci.unknown'),
    after.replace('timeout-minutes: 40','timeout-minutes: 41'),after+'permissions:\n  contents: write\n',
    after.replace('node node_modules/typescript/bin/tsc --noEmit','echo skipped')])
    assert.equal(ciToolsWorkflowProven(before,changed),false);
  const schema=JSON.parse(await readFile(join(root,'governance/schemas/module.schema.json'),'utf8'));
  const old=structuredClone(schema);old.properties.owned_paths.maxItems=64;
  assert.equal(ciToolsSchemaProven(JSON.stringify(old),JSON.stringify(schema)),true);
  for(const mutate of [s=>s.properties.owned_paths.maxItems=512,s=>s.properties.owned_paths.minItems=0,s=>delete s.required]){
    const changed=structuredClone(schema);mutate(changed);assert.equal(ciToolsSchemaProven(JSON.stringify(old),JSON.stringify(changed)),false);
  }
});

test('unowned computed delivery loaders cannot use the ownership-warning path',()=>{
  const loaded=loadModuleDescriptors(root,'HEAD');assert.equal(loaded.ok,true);
  const graph=new Map(loaded.descriptors.map(d=>[d.module_id,d])),path='modules/community/unowned-loader.ts';
  assert.ok(!loaded.descriptors.some(d=>owns(d,path)));
  const files=new Map([[path,{mode:'100644',type:'blob',oid:oid()}]]);
  for(const changed of ['deploy/shared-release/operator.mjs','packages/media-migration/backup-daily.ts']){
    const prove=source=>deliveryCoverageProven([graph,graph],[changed],[{graph,files,read:()=>source}]);
    assert.equal(prove('export const harmless=1;'),true);
    assert.equal(prove("const fs=import('node:fs');"),true);
    for(const source of ["const target=process.env.TARGET; import(target);",
      "const target=process.env.TARGET; require(target);",
      "const target='../../deploy/shared-release/'; import(target+'operator.mjs');",
      "const name='operator'; import(`../../deploy/shared-release/${name}.mjs`);",
      "const f=new Function('return import(process.env.TARGET)');"])
      assert.equal(prove(source),false,source);
  }
});

test('CI-tools actual graph Git fixture admits only the obsolete pair and keeps runtime deletions broad',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'fp-ci-tools-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const env={...verificationEnvironment(),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'CI Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'CI Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const git=(args,input)=>execFileSync('git',['-C',directory,'-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null',...args],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],env}).trim();
  const put=async(path,body)=>{await mkdir(dirname(join(directory,path)),{recursive:true});await writeFile(join(directory,path),body);};
  const commit=()=>{git(['add','.']);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']);};
  const integrate=(base,head)=>{const candidate=git(['commit-tree',git(['rev-parse',head+'^{tree}']),'-p',base,'-p',head],'integration\n');git(['checkout','-q',candidate]);return {repository:directory,event:'pull_request',base,head,candidate};};
  git(['init','-q','-b','main']);
  const catalog=execFileSync('git',['-C',root,'ls-tree','-r','--name-only','HEAD'],{encoding:'utf8'}).trim().split('\n').filter(p=>p.endsWith('/freedom.module.json')||p==='freedom.module.json');
  for(const path of catalog)await put(path,execFileSync('git',['-C',root,'show','HEAD:'+path],{encoding:'utf8'}));
  const workflows=await ciToolsWorkflowFixture();await put('.github/workflows/verify.yml',workflows.before);
  const schema=JSON.parse(await readFile(join(root,'governance/schemas/module.schema.json'),'utf8'));const old=structuredClone(schema);old.properties.owned_paths.maxItems=64;
  await put('governance/schemas/module.schema.json',JSON.stringify(old));
  const retired=['packages/contribution-tools/circleci-worker-status.mjs','packages/contribution-tools/test/circleci-worker-status.test.mjs'];
  for(const path of [...retired,'scripts/ci/select-affected-jobs.mjs','packages/contribution-tools/context.mjs','packages/contribution-tools/test/context.test.mjs','packages/db/command-core.ts'])await put(path,'export const fixture=true;\n');
  const state='docs/platform-plan/execution/unified-foundation/current-state.json';await put(state,'{}');
  const base=commit();
  await put('.github/workflows/verify.yml',workflows.after);await put('governance/schemas/module.schema.json',JSON.stringify(schema));
  await put('packages/contribution-tools/context.mjs','export const updated=true;\n');
  for(const path of retired)await rm(join(directory,path));
  const head=commit(),input=integrate(base,head),selected=minimalSelection('ci_tools');
  assert.deepEqual(collectRepositoryDecision(input),selected);
  const push = value => ({...value,event:'push',ref:'refs/heads/main',head:value.candidate});
  const pushInput=push(input);
  assert.deepEqual(collectRepositoryDecision(pushInput),selected);
  for(const extra of [{ref:''},{ref:'refs/heads/topic'},{ref:'refs/tags/main'},
    {event:'merge_group'},{head},{base:head},{candidate:head},{head:oid('0')},{base:oid('0')}])
    assert.equal(collectRepositoryDecision({...pushInput,...extra}).mode,'full',JSON.stringify(extra));
  const tree=git(['rev-parse',head+'^{tree}']);
  for(const parents of [[head,base],[head]]) {
    const forged=git(['commit-tree',tree,...parents.flatMap(p=>['-p',p])],'wrong first parent\n');
    git(['checkout','-q',forged]);
    assert.equal(collectRepositoryDecision({...pushInput,head:forged,candidate:forged}).mode,'full');
  }
  git(['checkout','-q',input.candidate]);
  assert.deepEqual(collectRepositoryDecision(pushInput),selected);
  await put('packages/contribution-tools/context.mjs','// dirty\n');
  assert.equal(collectRepositoryDecision(pushInput).mode,'full');
  git(['checkout','--','packages/contribution-tools/context.mjs']);
  await put('untracked.txt','untracked');
  assert.equal(collectRepositoryDecision(pushInput).mode,'full');
  await rm(join(directory,'untracked.txt'));
  assert.deepEqual(collectRepositoryDecision(pushInput),selected);
  // A direct single-parent successor is valid too; no historical merge object is required.
  git(['checkout','-q',head]);
  assert.deepEqual(collectRepositoryDecision({...pushInput,head,candidate:head}),selected);
  git(['checkout','-q',input.candidate]);
  assert.equal(evaluateVerifyAggregate(needsFor(selected,allResults('skipped'))).ok,true);
  assert.equal(evaluateVerifyAggregate(needsFor(selected,allResults('skipped'),{integrity:'failure'})).ok,false);
  for(const mutate of [
    async()=>rm(join(directory,'packages/db/command-core.ts')),
    async()=>put('packages/db/command-core.ts','export const runtimeChanged=true;'),
    async()=>put(retired[0],'export const restored=true;'),
    async()=>put('packages/contribution-tools/test/context.test.mjs',"import '../circleci-worker-status.mjs';"),
    async()=>put('.github/workflows/verify.yml',workflows.after.replace('--suite ci.worker-unit','--suite ci.unknown')),
    async()=>put('governance/schemas/module.schema.json',JSON.stringify({...schema,required:[]})),
  ]){
    git(['checkout','-q',input.candidate]);assert.deepEqual(collectRepositoryDecision(input),selected);
    git(['checkout','-q',head]);await mutate();
    const mixed=integrate(base,commit());
    assert.equal(collectRepositoryDecision(mixed).mode,'full');
    assert.equal(collectRepositoryDecision(push(mixed)).mode,'full');
  }
  git(['checkout','-q',head]);await put(state,'{ "updated":true }');
  const documentInput=integrate(base,commit());
  assert.deepEqual(collectRepositoryDecision(documentInput),minimalSelection('ci_tools_document_inputs'));
  assert.deepEqual(collectRepositoryDecision(push(documentInput)),minimalSelection('ci_tools_document_inputs'));
  git(['checkout','-q',head]);
  await put('scripts/ci/select-affected-jobs.mjs','export const selectorChanged=true;');
  const toolingOnly=integrate(head,commit());
  assert.deepEqual(collectRepositoryDecision(toolingOnly),selected);
  assert.deepEqual(collectRepositoryDecision(push(toolingOnly)),selected);
});

test('browser spec selection retains its actual execution coverage and rejects mixed or unproven changes', () => {
  const input = {event:'pull_request',diffComplete:true,nonExecutableBlobsProven:true,descriptorsProven:true,
    baseline:narrow(),candidate:narrow(),changes:[edited('tests/e2e/public-social-posts.spec.ts')]};
  for (const event of ['pull_request','push']) {
    for (const spec of ['public-social-posts','newcomer-guides','ai-sister-guides','social-feed','guild-workspace','guild-member-tiers'])
      assert.equal(decideBrowserSpecProfile({...input,event,changes:[edited(`tests/e2e/${spec}.spec.ts`)]}).profile,'browser_specs_only');
  }
  for (const change of [undefined,edited('tests/e2e/new.spec.ts','A'),edited('tests/e2e/public-social-posts.spec.ts','D'),
    edited('tests/e2e/fixtures.ts'),edited('tests/e2e/nested/example.spec.ts'),edited('playwright.config.ts'),
    edited('tests/runtime/public-social-post-page.test.ts'),edited('apps/portal-web/src/App.tsx'),
    {...input.changes[0],previousPath:'tests/e2e/old.spec.ts'},edited('tests/e2e/../runtime/example.spec.ts')])
    assert.equal(decideBrowserSpecProfile({...input,changes:[change]}).profile,'full');
  for (const extra of [{event:'merge_group'},{event:'workflow_dispatch'},{diffComplete:false},{nonExecutableBlobsProven:false},
    {descriptorsProven:false},{baseline:[]},{changes:[]},{changes:[...input.changes,...input.changes]},
    {changes:[...input.changes,edited('scripts/e2e-server.ts')]},
    {candidate:[moduleDescriptor('example',['modules/example/**'],{tests:['runtime.full']})]}])
    assert.equal(decideBrowserSpecProfile({...input,...extra}).profile,'full');
  assert.deepEqual(MINIMAL_JOB_PROFILES.browser_specs_only,['ui-e2e']);
  assert.deepEqual(PINNED_SUITES['ci.browser-spec-consumers'].files,
    ['tests/runtime/public-social-post-page.test.ts', 'tests/runtime/newcomer-guides.test.ts', 'tests/runtime/social-share.test.ts', 'tests/runtime/social-feed-write-order.test.ts', 'tests/runtime/guild-workspace-writer.test.ts', 'tests/runtime/guild-member-tier-fixture.test.ts']);
  assert.equal(PINNED_SUITES['ci.browser-spec-consumers'].database,false);
});

test('browser-only Git selection binds integration content, main topology, file modes and clean checkout', async t => {
  const directory=await mkdtemp(join(tmpdir(),'fp-browser-select-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const env={...verificationEnvironment(),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'CI Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'CI Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const git=(args,input)=>execFileSync('git',['-C',directory,'-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null',...args],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],env}).trim();
  const put=async(path,body)=>{await mkdir(dirname(join(directory,path)),{recursive:true});await writeFile(join(directory,path),body);};
  const commit=()=>{git(['add','.']);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']);};
  const integrate=(base,head)=>{const candidate=git(['commit-tree',git(['rev-parse',head+'^{tree}']),'-p',base,'-p',head],'integration\n');git(['checkout','-q',candidate]);return {repository:directory,event:'pull_request',base,head,candidate};};
  const push=input=>({...input,event:'push',ref:'refs/heads/main',head:input.candidate});
  git(['init','-q','-b','main']);
  for(const d of narrow())await put(`modules/${d.module_id}/freedom.module.json`,JSON.stringify(d));
  const spec='tests/e2e/public-social-posts.spec.ts';await put(spec,'// before\n');
  await put('tests/e2e/fixtures.ts','// fixture\n');await put('.gitignore','tests/e2e/generated.spec.ts\n');
  await put('scripts/ci/select-affected-jobs.mjs','throw Error("candidate selector must never execute");');
  const base=commit();await put(spec,'// after\n');const head=commit(),input=integrate(base,head);
  const selected=minimalSelection('browser_specs_only');
  assert.deepEqual(collectRepositoryDecision(input),selected);assert.deepEqual(collectRepositoryDecision(push(input)),selected);
  const cli=spawnSync(process.execPath,[selector,'--event','push','--repository',directory,'--base',base,'--head',input.candidate,'--candidate',input.candidate,'--github-output',join(directory,'.git','outputs')],{encoding:'utf8',env:{...env,GITHUB_REF:'refs/heads/main'}});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),selected);
  for(const extra of [{event:'merge_group'},{candidate:head},{head:base},{base:head}])assert.equal(collectRepositoryDecision({...input,...extra}).mode,'full');
  for(const extra of [{ref:''},{ref:'refs/heads/topic'},{head},{base:head}])assert.equal(collectRepositoryDecision({...push(input),...extra}).mode,'full');
  await put(spec,'dirty');assert.equal(collectRepositoryDecision(input).mode,'full');git(['checkout','--',spec]);
  await put('tests/e2e/generated.spec.ts','ignored');assert.equal(collectRepositoryDecision(input).mode,'full');await rm(join(directory,'tests/e2e/generated.spec.ts'));
  for(const mutate of [async()=>put('tests/e2e/fixtures.ts','changed'),async()=>put('tests/e2e/added.spec.ts','added'),
    async()=>put('modules/example/freedom.module.json',JSON.stringify(moduleDescriptor('example',['modules/example/**'],{tests:['runtime.full']}))),
    async()=>git(['mv',spec,'tests/e2e/renamed.spec.ts']),async()=>rm(join(directory,spec))]){
    git(['checkout','-q',head]);await mutate();const mixed=integrate(base,commit());
    assert.equal(collectRepositoryDecision(mixed).mode,'full');assert.equal(collectRepositoryDecision(push(mixed)).mode,'full');
  }
  git(['checkout','-q',head]);git(['update-index','--chmod=+x',spec]);git(['commit','-qm','mode']);
  git(['checkout','--',spec]);
  assert.equal(collectRepositoryDecision(integrate(base,git(['rev-parse','HEAD']))).mode,'full');
  const reversed=git(['commit-tree',git(['rev-parse',head+'^{tree}']),'-p',head,'-p',base],'reversed\n');git(['checkout','-q',reversed]);
  assert.equal(collectRepositoryDecision({...push(input),head:reversed,candidate:reversed}).mode,'full');
  git(['checkout','-q',head]);assert.deepEqual(collectRepositoryDecision({...push(input),head,candidate:head}),selected);
});

test('CI tools admit only the exact browser coverage wiring and fixed consumer registry addition', async () => {
  const workflow=await readFile(workflowPath,'utf8'),typecheck="      - name: Typecheck browser-only changes\n        if: ${{ needs.select.outputs.reason == 'browser_specs_only' }}\n        run: node node_modules/typescript/bin/tsc --noEmit\n",
    consumers="      - name: Check existing browser-spec consumers\n        if: ${{ needs.select.outputs.reason == 'browser_specs_only' }}\n        run: node .freedom/trusted/scripts/ci/run-pinned-suite.mjs --root . --suite ci.browser-spec-consumers\n";
  const before=workflow.replace(typecheck,'').replace(consumers,'');
  assert.equal(ciToolsWorkflowProven(before,workflow),true);
  assert.ok(jobBlock(workflow,'ui-e2e').includes(typecheck));assert.ok(jobBlock(workflow,'ui-e2e').includes(consumers));
  for(const changed of [workflow.replace(typecheck,''),workflow.replace(consumers,''),workflow.replace('--suite ci.browser-spec-consumers','--suite ci.worker-unit'),
    workflow.replace(typecheck,typecheck.replace("'browser_specs_only'","'full'")),
    workflow.replace(typecheck,'').replace('\n  static-worker:\n','\n  static-worker:\n'+typecheck),
    workflow.replace('node node_modules/typescript/bin/tsc --noEmit','echo skipped')])
    assert.equal(ciToolsWorkflowProven(before,changed),false);
  const registry=await readFile(join(root,'packages/contribution-tools/pinned-suites.mjs'),'utf8');
  const addition=registry.split('\n').find(line=>line.startsWith("  'ci.browser-spec-consumers':"))+'\n';
  const old=registry.replace(addition,'');assert.equal(ciToolsBrowserRegistryProven(old,registry),true);
  // Losing any actual spec-body consumer must reject the narrow registry change.
  for (const file of PINNED_SUITES['ci.browser-spec-consumers'].files) {
    const removed=addition.replace(`'${file}', `,'').replace(`, '${file}'`,'');
    assert.notEqual(removed,addition);
    assert.equal(ciToolsBrowserRegistryProven(old,registry.replace(addition,removed)),false,file);
  }
  for(const changed of [registry.replace(addition,addition.replace('public-social-post-page.test.ts','unknown.test.ts')),
    registry.replace(addition,addition.replace('database: false','database: true')),registry.replace("'ci.worker-unit'","'ci.unknown'")])
    assert.equal(ciToolsBrowserRegistryProven(old,changed),false);
});


test('store spec pilot proves reviewed imports and preserves every baseline case', async () => {
  const source = await readFile(join(root, 'tests/e2e/store-setup-entry.spec.ts'), 'utf8') + "\ntest('eighth candidate case', async () => {});\n";
  assert.equal(storeSpecDependenciesProven(source, source + '\n// assertion edit\n'), true);
  for (const extra of ["import './other.spec.js';", "const x = import('./fixtures.js');",
    "const x = require('./fixtures.js');", "const x = process.env.FREEDOM_E2E_STORE_PHOTO_FIXTURE;",
    "const x = globalThis.process;", "export * from './fixtures.js';", 'const x = import.meta.url;', 'test.use({});', 'const alias = test;', 'test();'])
    assert.equal(storeSpecDependenciesProven(source, source + '\n' + extra), false, extra);
  assert.equal(storeSpecDependenciesProven(source, source.replace('launchStore, captureOffer', 'launchStore, captureOffer, startGalleryBrowserServer')), false);
  assert.equal(storeSpecDependenciesProven(source, source.replace("test('", "test('renamed ")), false);
  assert.equal(storeSpecDependenciesProven(source, source, null), false);
});

test('store spec browser plan requires exact PR topology and falls back on dependency or content uncertainty', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fp-store-select-'));
  t.after(() => rm(directory, {recursive:true, force:true}));
  const env = {...verificationEnvironment(), GIT_CONFIG_GLOBAL:'/dev/null', GIT_CONFIG_NOSYSTEM:'1',
    GIT_AUTHOR_NAME:'CI Fixture', GIT_AUTHOR_EMAIL:'fixture@example.invalid', GIT_COMMITTER_NAME:'CI Fixture', GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
  const git = (args,input) => execFileSync('git', ['-C',directory,'-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null',...args], {input,encoding:'utf8',stdio:['pipe','pipe','pipe'],env}).trim();
  const put = async (path,body) => {await mkdir(dirname(join(directory,path)),{recursive:true});await writeFile(join(directory,path),body);};
  const commit = () => {git(['add','.']);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']);};
  const integrate = (base,head) => {
    const candidate = git(['commit-tree',git(['rev-parse',head+'^{tree}']),'-p',base,'-p',head],'integration\n');
    git(['checkout','-q',candidate]);return {repository:directory,event:'pull_request',base,head,candidate};
  };
  git(['init','-q','-b','main']);
  for (const d of narrow()) await put(`modules/${d.module_id}/freedom.module.json`,JSON.stringify(d));
  const path = 'tests/e2e/store-setup-entry.spec.ts', source = await readFile(join(root,path),'utf8');
  for (const dependency of ['tests/e2e/fixtures.ts','tests/e2e/hosted-store-fixture.ts','packages/testing/seed.ts',
    'contracts/guild-launchpad/v1/tenant.ts','contracts/guild-launchpad/v1/module-registry.ts','contracts/guild-launchpad/v1/hosted-supply-catalog.ts',
    'contracts/guild-launchpad/v1/primitives.ts','contracts/guild-launchpad/v1/storefront.ts','contracts/common/v1/identity.ts','package.json','package-lock.json'])
    await put(dependency, '// unchanged reviewed dependency\n');
  await put(path,source);await put('.gitignore','tests/e2e/generated.spec.ts\n');
  const base = commit();await put(path,await readFile(join(root,'packages/contribution-tools/test/fixtures/store-setup-entry-1160.spec.txt'),'utf8'));const head = commit(), input = integrate(base,head);
  assert.equal(collectRepositoryE2eDecision(input).profile,'store-setup-entry');
  assert.deepEqual(collectRepositoryDecision(input),minimalSelection('browser_specs_only'));
  for (const extra of [{event:'push',ref:'refs/heads/main'},{event:'merge_group'},{candidate:head},{base:head},{head:base},{candidate:''}])
    assert.equal(collectRepositoryE2eDecision({...input,...extra}).profile,'full');
  await put(path,source);assert.equal(collectRepositoryE2eDecision(input).profile,'full');git(['checkout','--',path]);
  await put('tests/e2e/generated.spec.ts','ignored');assert.equal(collectRepositoryE2eDecision(input).profile,'full');await rm(join(directory,'tests/e2e/generated.spec.ts'));
  const mutations = [
    () => put(path,source + "\nimport './unknown.js';"),
    () => put('tests/e2e/fixtures.ts','changed'), () => put('tests/e2e/hosted-store-fixture.ts','changed'),
    ...['contracts/guild-launchpad/v1/tenant.ts','contracts/guild-launchpad/v1/module-registry.ts',
      'contracts/guild-launchpad/v1/hosted-supply-catalog.ts','contracts/guild-launchpad/v1/primitives.ts',
      'contracts/guild-launchpad/v1/storefront.ts','contracts/common/v1/identity.ts','package-lock.json'].map(path => () => put(path,'changed')),
    () => put('playwright.config.ts','changed'), () => put('.github/workflows/verify.yml','changed'),
    () => put('apps/portal-web/src/App.tsx','changed'), () => put('unknown.ts','changed'),
    () => put('tests/e2e/another.spec.ts','added'), () => rm(join(directory,path)),
    () => git(['mv',path,'tests/e2e/renamed.spec.ts']),
    () => put('modules/example/freedom.module.json',JSON.stringify(moduleDescriptor('example',['modules/example/**'],{tests:['runtime.full']}))),
  ];
  for (const mutate of mutations) {
    git(['checkout','-q',head]);await mutate();assert.equal(collectRepositoryE2eDecision(integrate(base,commit())).profile,'full');
  }
  git(['checkout','-q',head]);git(['update-index','--chmod=+x',path]);git(['commit','-qm','mode']);git(['checkout','--',path]);
  assert.equal(collectRepositoryE2eDecision(integrate(base,git(['rev-parse','HEAD']))).profile,'full');
  git(['checkout','-q',head]);
  const reversed = git(['commit-tree',git(['rev-parse',head+'^{tree}']),'-p',head,'-p',base],'reversed\n');git(['checkout','-q',reversed]);
  assert.equal(collectRepositoryE2eDecision({...input,candidate:reversed}).profile,'full');
});


test('browser-only parser installation belongs to the confirmed workflow checkout, never candidate dependencies', async () => {
  const workflow=await readFile(workflowPath,'utf8'), ui=jobBlock(workflow,'ui-e2e');
  const install = PINNED_BROWSER_PARSER_INSTALL;
  assert.equal(ui.split(install).length,2);
  assert.ok(ui.indexOf('Confirm the pinned runner checkout') < ui.indexOf(install));
  assert.ok(ui.indexOf(install) < ui.indexOf('Check existing browser-spec consumers'));
  assert.ok(ui.indexOf(install) < ui.indexOf('Run the pinned browser plan'));
  assert.match(ui,/ref: \$\{\{ job\.workflow_sha \}\}/);
  // This new workflow change needs the full existing review/CI path; do not
  // silently extend the old typecheck/consumer wiring exception to admit it.
  assert.equal(ciToolsWorkflowProven(workflow.replace(install,''),workflow),false);
  for (const unsafe of [install.replace('--ignore-scripts ',''),
    install.replace('working-directory: .freedom/trusted','working-directory: .'),
    install.replace('npm ci --ignore-scripts --no-audit --no-fund','npm install')]) {
    const changed=ui.replace(install,unsafe).replace(PINNED_BROWSER_PARSER_INSTALL,'');
    const checkout=changed.indexOf('path: .freedom/trusted');
    assert.ok(changed.lastIndexOf('npm ')>checkout,'unsafe installs cannot use the exact exception');
  }
});


test('exact PR 1160 spec admits only the reviewed schema bindings', async () => {
  const before=await readFile(join(root,'tests/e2e/store-setup-entry.spec.ts'),'utf8');
  const actual=await readFile(join(root,'packages/contribution-tools/test/fixtures/store-setup-entry-1160.spec.txt'),'utf8');
  assert.equal(storeSpecDependenciesProven(before,actual),true);
  for (const extra of ["import {z} from 'zod';", "import {OtherSchema} from '../../contracts/guild-launchpad/v1/other.js';",
    "import {OpaqueId} from '../../contracts/common/v1/identity.js';"]) {
    assert.equal(storeSpecDependenciesProven(before,actual+'\n'+extra),false);
  }
  assert.equal(storeSpecDependenciesProven(before,actual.replace('InstancePageSchema, LaunchPlanSchema,', 'InstancePageSchema, UnknownSchema, LaunchPlanSchema,')),false);
});
