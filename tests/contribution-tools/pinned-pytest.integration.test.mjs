import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPinnedSuite } from '../../packages/contribution-tools/suite-runner.mjs';
import { PINNED_SUITES } from '../../packages/contribution-tools/pinned-suites.mjs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

async function withFixture(fn) {
  const tmp = await mkdtemp(join(tmpdir(), 'fp-pinned-'));
  try {
    await fn(tmp);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function failingBaseline(root) {
  await mkdir(join(root, 'docs/platform-plan/contracts/tests'), { recursive: true });
  await mkdir(join(root, 'docs/platform-plan/execution/tools/tests'), { recursive: true });
  for (const file of PINNED_SUITES['ci.contracts-pytest'].baseline) {
    await writeFile(join(root, file), 'def test_ok(): pass\ndef test_required(): assert False\n');
  }
}

for (const [name, path, body] of [
  ['pytest.ini addopts', 'pytest.ini', '[pytest]\naddopts = -k test_ok\n'],
  ['pytest.ini python_functions', 'pytest.ini', '[pytest]\npython_functions = test_ok\n'],
  ['pyproject.toml addopts', 'pyproject.toml', '[tool.pytest.ini_options]\naddopts = "-k test_ok"\n'],
  ...['docs/platform-plan/contracts/tests/conftest.py', 'conftest.py'].map(path => [path, path,
    'def pytest_collection_modifyitems(config, items):\n    items[:] = [item for item in items if item.name == "test_ok"]\n'])
]) {
  test(`Candidate ${name} cannot deselect required tests`, async () => {
    await withFixture(async root => {
      await failingBaseline(root);
      await writeFile(join(root, path), body);
      const result = await runPinnedSuite(root, 'ci.contracts-pytest');
      assert.equal(result.status, 'failed');
      assert.equal(result.reason, 'test_process_failed');
    });
  });
}

test('All expected files pass', async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, 'docs/platform-plan/contracts/tests'), { recursive: true });
    await mkdir(join(root, 'docs/platform-plan/execution/tools/tests'), { recursive: true });

    // We only need one test file for the fixture, but the baseline expects 16 files.
    // Let's create an exact clone of the baseline.
    for (const f of PINNED_SUITES['ci.contracts-pytest'].baseline) {
      await writeFile(join(root, f), "def test_ok(): pass\n");
    }

    const result = await runPinnedSuite(root, 'ci.contracts-pytest');
    assert.equal(result.status, 'passed');
    assert.equal(result.reason, 'tests_executed');
    assert.equal(result.test_count, 16);
    assert.deepEqual(result.test_files.map(file => file.path), [...PINNED_SUITES['ci.contracts-pytest'].baseline]);
    assert.ok(result.test_files.every(file => file.counts.tests === 1 && file.counts.passed === 1
      && file.cases.length === 1 && /^[a-f0-9]{64}$/.test(file.cases[0].case_sha256)));
  });
});

test('A file with zero tests', async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, 'docs/platform-plan/contracts/tests'), { recursive: true });
    await mkdir(join(root, 'docs/platform-plan/execution/tools/tests'), { recursive: true });
    for (const f of PINNED_SUITES['ci.contracts-pytest'].baseline) {
      await writeFile(join(root, f), "def test_ok(): pass\n");
    }
    // Make one file have zero tests
    await writeFile(join(root, PINNED_SUITES['ci.contracts-pytest'].baseline[0]), "# no tests\n");

    const result = await runPinnedSuite(root, 'ci.contracts-pytest');
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'incomplete_test_results');
  });
});

test('A skipped test', async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, 'docs/platform-plan/contracts/tests'), { recursive: true });
    await mkdir(join(root, 'docs/platform-plan/execution/tools/tests'), { recursive: true });
    for (const f of PINNED_SUITES['ci.contracts-pytest'].baseline) {
      await writeFile(join(root, f), "def test_ok(): pass\n");
    }
    await writeFile(join(root, PINNED_SUITES['ci.contracts-pytest'].baseline[0]), `
import pytest
def test_ok(): pass
@pytest.mark.skip
def test_skip(): pass
`);

    const result = await runPinnedSuite(root, 'ci.contracts-pytest');
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'incomplete_test_results');
    assert.equal(result.evidence_reason, 'testcase_not_passed');
  });
});

test('A failing test', async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, 'docs/platform-plan/contracts/tests'), { recursive: true });
    await mkdir(join(root, 'docs/platform-plan/execution/tools/tests'), { recursive: true });
    for (const f of PINNED_SUITES['ci.contracts-pytest'].baseline) {
      await writeFile(join(root, f), "def test_ok(): pass\n");
    }
    const privateText = '::error:: freedom.test-failure-diagnostic\\nprivate-message\\x01';
    await writeFile(join(root, PINNED_SUITES['ci.contracts-pytest'].baseline[0]), `
import pytest
@pytest.mark.parametrize('value', [1, 2, 3, 4, 5, 6, 7], ids=lambda value: '${privateText}' + str(value))
def test_fail(value):
    assert False, '${privateText}'
def test_ok(): pass
`);

    const result = await runPinnedSuite(root, 'ci.contracts-pytest');
    assert.equal(result.status, 'failed');
    // pytest exits with 1 -> test_process_failed
    assert.equal(result.reason, 'test_process_failed');
    assert.equal(result.test_count, 0);
    const files = PINNED_SUITES['ci.contracts-pytest'].baseline;
    const failedCounts = { tests: 8, passed: 1, failed: 7, cancelled: 0, skipped: 0, todo: 0 };
    assert.deepEqual(result.test_files, files.map((path, index) => ({ path,
      counts: index === 0 ? failedCounts : { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 },
      cases: [], suite_events: [] })));
    assert.ok(!Object.hasOwn(result, 'evidence_sha256'));
    assert.doesNotMatch(JSON.stringify(result), /::error::|freedom\.test-failure-diagnostic|private-message|\\u0001/);

    const cli = fileURLToPath(new URL('../../scripts/ci/run-pinned-suite.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [cli, '--root', root, '--suite', 'ci.contracts-pytest'], { encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.equal(child.stderr, '');
    assert.deepEqual(child.stdout.trim().split('\n').map(line => JSON.parse(line)), [
      { check_id: 'ci.contracts-pytest', status: 'failed', reason: 'test_process_failed', test_count: 0, file_count: files.length },
      { path: files[0], counts: failedCounts }
    ]);
    assert.doesNotMatch(child.stdout, /::error::|freedom\.test-failure-diagnostic|private-message|\\u0001/);
  });
});

test('A collection error', async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, 'docs/platform-plan/contracts/tests'), { recursive: true });
    await mkdir(join(root, 'docs/platform-plan/execution/tools/tests'), { recursive: true });
    for (const f of PINNED_SUITES['ci.contracts-pytest'].baseline) {
      await writeFile(join(root, f), "def test_ok(): pass\n");
    }
    await writeFile(join(root, PINNED_SUITES['ci.contracts-pytest'].baseline[0]), `
def test_syntax(
`); // Syntax error

    const result = await runPinnedSuite(root, 'ci.contracts-pytest');
    assert.equal(result.status, 'failed');
    // pytest exits with 2 (collection error) -> test_process_failed
    assert.equal(result.reason, 'test_process_failed');
  });
});

test('A candidate conftest.py is not loaded', async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, 'docs/platform-plan/contracts/tests'), { recursive: true });
    await mkdir(join(root, 'docs/platform-plan/execution/tools/tests'), { recursive: true });
    for (const f of PINNED_SUITES['ci.contracts-pytest'].baseline) {
      await writeFile(join(root, f), "def test_ok(): pass\n");
    }
    await writeFile(join(root, 'docs/platform-plan/contracts/tests/conftest.py'), `
def pytest_collection_modifyitems(config, items):
    items.clear()
`);

    const result = await runPinnedSuite(root, 'ci.contracts-pytest');
    assert.equal(result.status, 'passed');
    assert.equal(result.reason, 'tests_executed');
    assert.equal(result.test_count, 16);
  });
});
