import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeSourceManifest, partitionRuntimeFiles, aggregateRuntimePartitions, runLocalSuites, runPinnedSuiteDefinition } from '../suite-runner.mjs';
import { FULL_RUNTIME_BASELINE } from '../runtime-suites.mjs';
import { createProgressDecoder } from '../test-reporter.mjs';
import { verificationEnvironment } from '../process-env.mjs';
import { sha256 } from '../io.mjs';
import { validateFormat, parseFormat } from '../formats.mjs';
import { fixtureRoot, put } from './fixtures.mjs';

const counts = { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 };

test('directory-discovered governance and pinned suites still refuse 513 files', async t => {
  const root = await fixtureRoot(t);
  const files = Array.from({ length: 513 }, (_, index) => `packages/contribution-tools/test/limit-${index}.test.mjs`);
  for (const path of files) await put(root, path, 'throw Error("must not execute an oversized non-runtime suite");\n');
  const [governance] = await runLocalSuites(root, ['governance.unit'], { timeoutMs: 1 });
  assert.deepEqual(governance, { check_id: 'governance.unit', status: 'not_run', reason: 'suite_files_unavailable' });
  const pinned = await runPinnedSuiteDefinition(root, 'ci.limit-fixture', Object.freeze({ files, loader: 'node', timeoutMs: 1 }));
  assert.deepEqual(pinned, { check_id: 'ci.limit-fixture', status: 'not_run', reason: 'suite_files_unavailable' });
});

async function runtimeTree(t, count) {
  const root = await fixtureRoot(t), files = [...FULL_RUNTIME_BASELINE];
  for (let index = files.length; index < count; index++) files.push(`tests/runtime/limit-${index}.test.ts`);
  for (const path of files) await put(root, path, '// synthetic runtime source\n');
  // Like runtime-matrix's source-binding fixture, commit only this disposable
  // synthetic repository; the caller's worktree and index are never touched.
  const git = args => {
    const ran = spawnSync('git', args, { cwd: root, env: verificationEnvironment(), encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
  };
  git(['-c', 'init.templateDir=', 'init', '--quiet']);
  git(['add', '.']);
  const commit = () => git(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--all', '--quiet', '-m', 'Synthetic runtime file limit']);
  commit();
  return { root, files: files.sort(), git, commit };
}

function fragmentsFor(source, count) {
  return partitionRuntimeFiles(source.full_source_manifest.map(file => file.path), count).map((selected, index) => ({
    schema: 'freedom.runtime-partition/v1', check_id: `runtime.partition.${index}`,
    partition_index: index, partition_count: count, ...source,
    started_at: '2026-10-03T00:00:00.000Z', ended_at: '2026-10-03T00:14:59.000Z', database_cleanup_verified: true,
    report: { check_id: `runtime.partition.${index}`, status: 'passed', reason: 'tests_executed',
      test_count: selected.length, evidence_sha256: sha256(Buffer.from(`synthetic-${count}-${index}`)),
      selected_files: selected, database_cleanup_verified: true,
      test_files: selected.map(path => ({ path, counts: { ...counts },
        cases: [{ case_sha256: sha256(Buffer.from(path)), status: 'passed' }], suite_events: [] })) },
  }));
}

test('600 runtime files retain the exact source union through four, six and eight partition aggregates', async t => {
  const { root, files } = await runtimeTree(t, 600), source = await runtimeSourceManifest(root);
  assert.deepEqual(source.full_source_manifest.map(file => file.path), files);
  for (const count of [4, 6, 8]) {
    const partitions = partitionRuntimeFiles(files, count);
    assert.equal(partitions.length, count);
    assert.equal(new Set(partitions.flat()).size, 600);
    assert.deepEqual(partitions.flat().sort(), files);
    const fragments = fragmentsFor(source, count);
    const aggregate = await aggregateRuntimePartitions(root, fragments, { partitionCount: count });
    assert.equal(aggregate.status, 'passed', aggregate.reason);
    assert.equal(aggregate.test_count, 600);
    assert.deepEqual(aggregate.selected_files, files);
    assert.equal(aggregate.partition_evidence_sha256.length, count);
    // Exercise the actual bounded JSON reader as well as library aggregation.
    for (const fragment of fragments) await put(root, `.git/limit-fragments/runtime-partition-${fragment.partition_index}.json`, JSON.stringify(fragment));
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../../../scripts/runtime-aggregate.mjs', import.meta.url)),
      '--partition-count', String(count), '--input-dir', join(root, '.git/limit-fragments'),
      '--output', join(root, '.git/aggregate.json')], { cwd: root, env: verificationEnvironment(), encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.equal(JSON.parse(await readFile(join(root, '.git/aggregate.json'), 'utf8')).test_count, 600);
  }
});

test('1024 runtime files are admitted and a clean 1025-file manifest still fails closed', async t => {
  const { root, files, git, commit } = await runtimeTree(t, 1024);
  const source = await runtimeSourceManifest(root);
  assert.equal(source.full_source_manifest.length, 1024);
  for (const count of [4, 6, 8]) {
    const aggregate = await aggregateRuntimePartitions(root, fragmentsFor(source, count), { partitionCount: count });
    assert.equal(aggregate.status, 'passed', aggregate.reason);
    assert.deepEqual(aggregate.selected_files, files);
  }
  await put(root, 'tests/runtime/over-limit.test.ts', '// synthetic overflow\n');
  git(['add', 'tests/runtime/over-limit.test.ts']); commit();
  await assert.rejects(runtimeSourceManifest(root), /^Error: file_limit$/);
});

for (const size of [600, 1024]) test(`reporter accepts a ${size}-path selection for both progress and failure diagnostics`, async t => {
  const root = await fixtureRoot(t), special = 'tests/runtime/media-verify.test.ts';
  const files = [special, ...Array.from({ length: size - 1 }, (_, index) => size === 600
    ? `tests/runtime/limit-${index}.test.ts`
    : `tests/runtime/limit-${String(index).padStart(4, '0')}-${'x'.repeat(207)}.test.ts`)];
  for (const path of files) await put(root, path, '// synthetic reporter source\n');
  await put(root, 'selection.json', JSON.stringify(files));
  // Controlled Node events exercise the real reporter without launching 600
  // test subprocesses or requiring PostgreSQL for these synthetic TS files.
  const program = `
    import report from ${JSON.stringify(new URL('../test-reporter.mjs', import.meta.url).href)};
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    // Assign inside the process so a 240-byte-path selection is also portable
    // across hosts with a smaller per-environment-string exec limit.
    process.env.FREEDOM_TEST_PROGRESS_FILES = readFileSync('selection.json', 'utf8');
    const files = JSON.parse(process.env.FREEDOM_TEST_PROGRESS_FILES);
    const counts = ${JSON.stringify({ ...counts, suites: 0 })};
    async function* events() {
      for (const [index, path] of files.entries()) {
        const file = join(process.cwd(), path), failed = index === 0;
        yield { type: 'test:dequeue', data: { file, nesting: 0 } };
        yield { type: failed ? 'test:fail' : 'test:pass', data: { file, line: 1, column: 1, nesting: 0,
          testNumber: index + 1, details: { type: 'test', ...(failed ? { error: { failureType: 'testCodeFailure' } } : {}) } } };
        yield { type: 'test:summary', data: { file, counts: { ...counts, passed: failed ? 0 : 1, failed: failed ? 1 : 0 }, success: !failed } };
      }
      yield { type: 'test:summary', data: { counts: { ...counts, tests: files.length, passed: files.length - 1, failed: 1 }, success: false } };
    }
    for await (const chunk of report(events())) process.stdout.write(chunk);`;
  const ran = spawnSync(process.execPath, ['--input-type=module', '--eval', program], { cwd: root,
    env: verificationEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000, maxBuffer: 2_000_000 });
  assert.equal(ran.status, 0, ran.stderr);
  const final = JSON.parse(ran.stdout);
  assert.equal(final.files.length, size); assert.equal(final.counts.tests, size);
  const progress = ran.output[3].trim().split('\n').map(JSON.parse);
  assert.equal(progress.filter(record => record.event === 'completed').length, size);
  const decoder = createProgressDecoder(files.map(path => ({ path, source_sha256: sha256(Buffer.from('// synthetic reporter source\n')), source_lines: 2 })), () => {});
  decoder.push(Buffer.from(ran.output[3])); assert.equal(decoder.finish().incomplete, false);
  const diagnostics = ran.output[4].trim().split('\n').map(JSON.parse);
  assert.equal(diagnostics.length, 1); assert.equal(diagnostics[0].path, special);
});

test('verifier receipts admit 1024 selected files and shard entries while rejecting 1025', () => {
  const files = Array.from({ length: 1024 }, (_, index) => `tests/runtime/limit-${index}.test.ts`);
  const test_files = files.map(path => ({ path, counts: { ...counts }, cases: [{ case_sha256: sha256(Buffer.from(path)), status: 'passed' }], suite_events: [] }));
  const report = { format: 'freedom.verifier-report/v1', assurance_level: 'local', repository: 'FreeTWAI/freedom-platform',
    base_commit: 'a'.repeat(40), head_commit: 'a'.repeat(40), workspace_sha256: 'b'.repeat(64),
    status: 'passed', scope: ['governance'], blockers: [],
    checks: [{ check_id: 'runtime.full', status: 'passed', reason: 'tests_executed', test_count: 1024,
      selected_files: files, test_files,
      shards: [{ selected_files: files, test_files, reason: 'tests_executed', evidence_sha256: 'c'.repeat(64) }] }] };
  // Includes the normal receipt JSON byte/node limits, not just schema arrays.
  parseFormat('verifierReport', JSON.stringify(report));
  for (const scope of [report.checks[0], report.checks[0].shards[0]]) {
    for (const key of ['selected_files', 'test_files']) {
      const original = scope[key];
      scope[key] = [...original, key === 'selected_files' ? 'tests/runtime/overflow.test.ts' : { ...test_files[0], path: 'tests/runtime/overflow.test.ts' }];
      assert.throws(() => validateFormat('verifierReport', report));
      scope[key] = original;
    }
  }
});

test('1024 maximum-length paths and 64 failures fit the unchanged progress byte and line caps', () => {
  const paths = Array.from({ length: 1024 }, (_, index) => `tests/runtime/${String(index).padStart(4, '0')}-${'x'.repeat(213)}.test.ts`);
  assert(paths.every(path => path.length === 240));
  const sources = paths.map(path => ({ path, source_sha256: 'a'.repeat(64), source_lines: Number.MAX_SAFE_INTEGER }));
  const accepted = [], decoder = createProgressDecoder(sources, record => accepted.push(record));
  let bytes = 0;
  for (const [index, path] of paths.entries()) {
    const start = { schema: 'freedom.test-file-progress/v1', event: 'started', path, source_sha256: 'a'.repeat(64), elapsed_ms: 2_100_000 };
    const records = [start];
    if (index < 64) records.push({ ...start, event: 'failed_case', case_sha256: sha256(Buffer.from(path)), failure_type: 'cancelledByParent', source_line: Number.MAX_SAFE_INTEGER });
    records.push({ ...start, event: 'completed', counts: { ...counts, tests: 20000, passed: index < 64 ? 19999 : 20000, failed: index < 64 ? 1 : 0, suites: 20000 } });
    for (const record of records) {
      const line = Buffer.from(JSON.stringify(record) + '\n');
      assert(line.length <= 2048); bytes += line.length; decoder.push(line);
    }
  }
  assert(bytes <= 1_048_576);
  assert.equal(accepted.length, 1024 * 2 + 64); assert.equal(decoder.finish().incomplete, false);
  assert.throws(() => createProgressDecoder([...sources, { ...sources[0], path: 'tests/runtime/overflow.test.ts' }], () => {}), /invalid_progress_selection/);
});
