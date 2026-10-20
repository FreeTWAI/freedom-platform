import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, symlink, mkdir, stat, rm, mkdtemp, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { fixtureRoot, put } from './fixtures.mjs';
import { runPinnedSuite, runPinnedSuiteDefinition } from '../suite-runner.mjs';
import { PINNED_SUITES } from '../pinned-suites.mjs';

const syntheticDbUrl = 'postgresql://postgres@localhost/fp_fixture?host=%2Ftmp%2Ffp-fixture';
const cli = fileURLToPath(new URL('../../../scripts/ci/run-pinned-suite.mjs', import.meta.url));

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Fills a fixture with the whole real baseline; only the first file gets firstBody.
async function putBaseline(root, suite, firstBody) {
  for (const [index, file] of suite.baseline.entries()) {
    await put(root, file, index === 0 ? firstBody : "import { test } from 'node:test';\ntest('x', () => {});");
  }
}

test('Directory suites do not shrink', async (t) => {
  const root = await fixtureRoot(t);
  const dir = 'packages/contribution-tools/test';
  await mkdir(join(root, dir), { recursive: true });
  await put(root, `${dir}/a.test.mjs`, "import { test } from 'node:test';\ntest('a', () => {});");
  await put(root, `${dir}/b.test.mjs`, "import { test } from 'node:test';\ntest('b', () => { throw new Error('fail'); });");

  const def = Object.freeze({
    directory: dir,
    pattern: /^[a-z][a-z0-9-]*\.test\.mjs$/,
    baseline: Object.freeze([`${dir}/a.test.mjs`, `${dir}/b.test.mjs`]),
    loader: 'node',
    database: false,
    timeoutMs: 10000,
    env: Object.freeze([])
  });

  const res1 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', def);
  assert.equal(res1.status, 'failed');
  assert.equal(res1.test_count, 2);

  await rm(join(root, dir, 'b.test.mjs'));
  const res2 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', def);
  assert.equal(res2.status, 'not_run');
  assert.equal(res2.reason, 'suite_files_unavailable');

  await put(root, `${dir}/b.test.mjs`, "import { test } from 'node:test';\ntest('b', () => {});");
  await put(root, `${dir}/c.test.mjs`, "import { test } from 'node:test';\ntest('c', () => {});");
  const res3 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', def);
  assert.equal(res3.status, 'passed');
  assert.equal(res3.test_count, 3);
  assert.ok(res3.selected_files.includes(`${dir}/c.test.mjs`));

  await put(root, `${dir}/helper.mjs`, "export {}");
  const res4 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', def);
  assert.equal(res4.status, 'passed');
  assert.ok(!res4.selected_files.includes(`${dir}/helper.mjs`));

  const resErr1 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', { ...def }); // not frozen
  assert.equal(resErr1.status, 'not_run');
  assert.equal(resErr1.reason, 'suite_adapter_unavailable');

  const resErr2 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', Object.freeze({ ...def, unknownKey: 1 }));
  assert.equal(resErr2.status, 'not_run');
  assert.equal(resErr2.reason, 'suite_adapter_unavailable');

  const resErr3 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', Object.freeze({ ...def, files: Object.freeze([]) }));
  assert.equal(resErr3.status, 'not_run');
  assert.equal(resErr3.reason, 'suite_adapter_unavailable');

  const resErr4 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', Object.freeze({ files: Object.freeze([`${dir}/a.test.mjs`]), directory: dir, loader: 'node', database: false, timeoutMs: 10000, env: Object.freeze([]) }));
  assert.equal(resErr4.status, 'not_run');
  assert.equal(resErr4.reason, 'suite_adapter_unavailable');

  const defNoBaseline = { ...def };
  delete defNoBaseline.baseline;
  const resErr5 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', Object.freeze(defNoBaseline));
  assert.equal(resErr5.status, 'not_run');
  assert.equal(resErr5.reason, 'suite_adapter_unavailable');

  const resErr6 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', Object.freeze({ ...def, baseline: `${dir}/a.test.mjs` }));
  assert.equal(resErr6.status, 'not_run');
  assert.equal(resErr6.reason, 'suite_adapter_unavailable');

  const resErr7 = await runPinnedSuiteDefinition(root, 'ci.governance-unit', def, { unknownOption: true });
  assert.equal(resErr7.status, 'not_run');
  assert.equal(resErr7.reason, 'invalid_pinned_suite_options');
});

test('Real baselines are accurate', async () => {
  for (const id of ['ci.governance-unit', 'ci.skill-client-unit', 'ci.worker-unit', 'ci.deploy-preflight', 'ci.contracts-pytest']) {
    const suite = PINNED_SUITES[id];
    const seen = new Set();
    let prev = '';
    for (const file of suite.baseline) {
      const directory = (suite.directories ?? [suite.directory]).find(d => file.startsWith(d + '/'));
      assert.ok(directory);
      const name = file.slice(directory.length + 1);
      assert.ok(!name.includes('/'));
      assert.ok(suite.pattern.test(name));
      assert.ok(!seen.has(file));
      seen.add(file);
      assert.ok(file >= prev);
      prev = file;
      const st = await stat(join(repoRoot, file));
      assert.ok(st.isFile());
    }
  }
});

test('Deploy preflight fixture without full baseline fails', async (t) => {
  const root = await fixtureRoot(t);
  const suite = PINNED_SUITES['ci.deploy-preflight'];
  await mkdir(join(root, suite.directory), { recursive: true });
  for (let i = 0; i < suite.baseline.length - 1; i++) {
    await put(root, suite.baseline[i], '');
  }
  const result = await runPinnedSuite(root, 'ci.deploy-preflight');
  assert.equal(result.status, 'not_run');
  assert.equal(result.reason, 'suite_files_unavailable');
});

test('Probe E: package scripts cannot change the governance file set', async (t) => {
  const root = await fixtureRoot(t);
  await put(root, 'package.json', JSON.stringify({
    scripts: {
      'test:governance': 'node --test packages/contribution-tools/test/none-*.test.mjs',
      'pretest': 'node -e "require(\'node:fs\').writeFileSync(\'hook-ran\', \'\')"',
      'test': 'node -e "require(\'node:fs\').writeFileSync(\'hook-ran\', \'\')"',
      'posttest': 'node -e "require(\'node:fs\').writeFileSync(\'hook-ran\', \'\')"'
    }
  }));
  await put(root, 'packages/contribution-tools/test/alpha.test.mjs', "import { test } from 'node:test';\ntest('a', () => {});");
  await put(root, 'packages/contribution-tools/test/beta.test.mjs', "import { test } from 'node:test';\ntest('b', () => {});");

  const def = Object.freeze({
    ...PINNED_SUITES['ci.governance-unit'],
    baseline: Object.freeze([
      'packages/contribution-tools/test/alpha.test.mjs',
      'packages/contribution-tools/test/beta.test.mjs'
    ])
  });

  const result = await runPinnedSuiteDefinition(root, 'ci.governance-unit', def);
  assert.equal(result.status, 'passed');
  assert.equal(result.reason, 'tests_executed');
  assert.equal(result.test_count, 2);
  assert.deepEqual(result.selected_files.sort(), [
    'packages/contribution-tools/test/alpha.test.mjs',
    'packages/contribution-tools/test/beta.test.mjs'
  ]);

  let hookRan = true;
  try {
    await readFile(join(root, 'hook-ran'));
  } catch {
    hookRan = false;
  }
  assert.equal(hookRan, false);
});

test('Zero tests, skip, todo and describe.skip fail', async (t) => {
  const bodies = [
    '',
    "import { test } from 'node:test';\ntest.skip('s', () => {});",
    "import { test } from 'node:test';\ntest.todo('t');",
    "import { describe } from 'node:test';\ndescribe.skip('d', () => {});"
  ];
  for (const body of bodies) {
    const root = await fixtureRoot(t);
    await put(root, 'packages/contribution-tools/test/alpha.test.mjs', "import { test } from 'node:test';\ntest('a', () => {});");
    await put(root, 'packages/contribution-tools/test/beta.test.mjs', body);

    const def = Object.freeze({
      ...PINNED_SUITES['ci.governance-unit'],
      baseline: Object.freeze([
        'packages/contribution-tools/test/alpha.test.mjs',
        'packages/contribution-tools/test/beta.test.mjs'
      ])
    });

    const result = await runPinnedSuiteDefinition(root, 'ci.governance-unit', def);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'incomplete_test_results');
  }
});

test('A fake success JSON fails', async (t) => {
  const root = await fixtureRoot(t);
  await put(root, 'packages/contribution-tools/test/alpha.test.mjs', "import { test } from 'node:test';\ntest('a', () => {});");
  await put(root, 'packages/contribution-tools/test/beta.test.mjs', "console.log(JSON.stringify({ success: true, files: [], cases: [], suites: [], counts: { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0 } }));");

  const def = Object.freeze({
    ...PINNED_SUITES['ci.governance-unit'],
    baseline: Object.freeze([
      'packages/contribution-tools/test/alpha.test.mjs',
      'packages/contribution-tools/test/beta.test.mjs'
    ])
  });

  const result = await runPinnedSuiteDefinition(root, 'ci.governance-unit', def);
  assert.equal(result.status, 'failed');
});

test('File-set failures', async (t) => {
  const root1 = await fixtureRoot(t);
  await mkdir(join(root1, 'packages/contribution-tools/test'), { recursive: true });

  const def1 = Object.freeze({
    ...PINNED_SUITES['ci.governance-unit'],
    baseline: Object.freeze([])
  });
  const result1 = await runPinnedSuiteDefinition(root1, 'ci.governance-unit', def1);
  assert.equal(result1.status, 'failed');
  assert.equal(result1.reason, 'empty_test_set');
  assert.equal(result1.test_count, 0);

  const root2 = await fixtureRoot(t);
  const result2 = await runPinnedSuite(root2, 'ci.selector-unit');
  assert.equal(result2.status, 'not_run');
  assert.equal(result2.reason, 'suite_files_unavailable');

  const root3 = await fixtureRoot(t);
  await put(root3, 'real.test.mjs', "import { test } from 'node:test';\ntest('a', () => {});");
  await mkdir(join(root3, 'scripts/ci'), { recursive: true });
  await symlink('../../real.test.mjs', join(root3, 'scripts/ci/select-affected-jobs.test.mjs'));

  const content = await readFile(join(root3, 'scripts/ci/select-affected-jobs.test.mjs'), 'utf8');
  assert.match(content, /test\('a'/);

  const result3 = await runPinnedSuite(root3, 'ci.selector-unit');
  assert.equal(result3.status, 'not_run');
  assert.equal(result3.reason, 'suite_files_unavailable');
});

test('Database URL checks', async (t) => {
  const root = await fixtureRoot(t);
  await put(root, 'tests/worker/a.test.ts', "import { test } from 'node:test';\ntest('a', () => {});");

  const def = Object.freeze({
    ...PINNED_SUITES['ci.worker-unit'],
    baseline: Object.freeze(['tests/worker/a.test.ts'])
  });

  const result1 = await runPinnedSuiteDefinition(root, 'ci.worker-unit', def);
  assert.equal(result1.status, 'not_run');
  assert.equal(result1.reason, 'test_database_required');

  // Exact results: no field may echo any part of the rejected URL.
  const rejected = { check_id: 'ci.worker-unit', status: 'not_run', reason: 'test_database_rejected' };
  const result2 = await runPinnedSuiteDefinition(root, 'ci.worker-unit', def, { testDatabaseUrl: 'postgresql://postgres@db.example.com/fp_fixture' });
  assert.deepEqual(result2, rejected);

  const result3 = await runPinnedSuiteDefinition(root, 'ci.worker-unit', def, { testDatabaseUrl: 'postgresql://postgres:secret-pass@localhost/fp_fixture' });
  assert.deepEqual(result3, rejected);

  const result4 = await runPinnedSuiteDefinition(root, 'ci.worker-unit', def, { testDatabaseUrl: 'postgresql://postgres@localhost/fp_fixture?options=-c%20search_path%3Devil' });
  assert.deepEqual(result4, rejected);
});

test('A database: false suite gets a clean environment', async (t) => {
  const savedEnv = {
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    DATABASE_URL: process.env.DATABASE_URL,
    PGPASSWORD: process.env.PGPASSWORD
  };

  t.after(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  process.env.TEST_DATABASE_URL = 'postgresql://foo';
  process.env.NODE_OPTIONS = '--no-warnings';
  process.env.GITHUB_TOKEN = 'secret';
  process.env.DATABASE_URL = 'postgresql://bar';
  process.env.PGPASSWORD = 'pass';

  const root = await fixtureRoot(t);
  await put(root, 'scripts/ci/select-affected-jobs.test.mjs', `
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('env', () => {
  assert.equal(process.env.TEST_DATABASE_URL, undefined);
  assert.equal(process.env.NODE_OPTIONS, undefined);
  assert.equal(process.env.GITHUB_TOKEN, undefined);
  assert.equal(process.env.DATABASE_URL, undefined);
  assert.equal(process.env.PGPASSWORD, undefined);
});
  `);

  await put(root, 'scripts/ci/guild-presentation-profile.test.mjs', await readFile(join(root, 'scripts/ci/select-affected-jobs.test.mjs'), 'utf8'));
  const result = await runPinnedSuite(root, 'ci.selector-unit');
  assert.equal(result.status, 'passed');
});

test('Env pass-through', async (t) => {
  const root = await fixtureRoot(t);
  await put(root, 'tests/integration/repositories.test.ts', `
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('env', () => {
  assert.equal(process.env.FREEDOM_REPOSITORIES_ROOT, '/fixture-root');
  assert.equal(process.env.UNKNOWN_VAR, undefined);
});
  `);
  await put(root, 'tests/integration/consumer-libraries.test.ts', "import { test } from 'node:test';\ntest('pass', () => {});");

  const result = await runPinnedSuite(root, 'ci.consumer-repositories', {
    testDatabaseUrl: syntheticDbUrl,
    env: { FREEDOM_REPOSITORIES_ROOT: '/fixture-root', UNKNOWN_VAR: 'x' }
  });
  assert.equal(result.status, 'passed');
});

test('Option checks', async (t) => {
  const root = await fixtureRoot(t);
  await put(root, 'scripts/ci/select-affected-jobs.test.mjs', "import { test } from 'node:test';\ntest('a', () => {});");

  await put(root, 'scripts/ci/guild-presentation-profile.test.mjs', "import { test } from 'node:test';\ntest('guild', () => {});");
  const result1 = await runPinnedSuite(root, 'ci.selector-unit', { timeoutMs: 99999999 });
  assert.equal(result1.status, 'not_run');
  assert.equal(result1.reason, 'invalid_suite_timeout');

  const result2 = await runPinnedSuite(root, 'ci.selector-unit', { timeoutMs: 0 });
  assert.equal(result2.status, 'not_run');
  assert.equal(result2.reason, 'invalid_suite_timeout');

  const result3 = await runPinnedSuite(root, 'ci.selector-unit', { unknownOption: true });
  assert.equal(result3.status, 'not_run');
  assert.equal(result3.reason, 'invalid_pinned_suite_options');

  const result4 = await runPinnedSuite(root, 'ci.unknown-id');
  assert.equal(result4.status, 'not_run');
  assert.equal(result4.reason, 'suite_adapter_unavailable');
});

test('CLI', async (t) => {
  const root = await fixtureRoot(t);
  const suite = PINNED_SUITES['ci.governance-unit'];
  await putBaseline(root, suite, "import { test } from 'node:test';\ntest('a', () => {});");

  const outFilePass = join(root, 'out-pass.json');
  const cpPass = spawnSync(process.execPath, [cli, '--root', root, '--suite', 'ci.governance-unit', '--output', outFilePass], { encoding: 'utf8' });
  assert.equal(cpPass.status, 0);

  const stdoutPassLines = cpPass.stdout.trim().split('\n').filter(Boolean);
  const summaryLinePass = stdoutPassLines.map(line => JSON.parse(line)).find(obj => obj.status);
  assert.equal(summaryLinePass.status, 'passed');
  assert.equal(JSON.parse(await readFile(outFilePass, 'utf8')).status, 'passed');

  // Change one test to fail
  await put(root, suite.baseline[0], "import { test } from 'node:test';\ntest('fail', () => { throw new Error('fail'); });");
  const outFileFail = join(root, 'out-fail.json');
  const cpFail = spawnSync(process.execPath, [cli, '--root', root, '--suite', 'ci.governance-unit', '--output', outFileFail], { encoding: 'utf8' });
  assert.equal(cpFail.status, 1);
  const stdoutFailLines = cpFail.stdout.trim().split('\n').filter(Boolean);
  const summaryLineFail = stdoutFailLines.map(line => JSON.parse(line)).find(obj => obj.status);
  assert.equal(summaryLineFail.status, 'failed');

  const cpUnknown = spawnSync(process.execPath, [cli, '--root', root, '--suite', 'ci.unknown-id'], { encoding: 'utf8' });
  assert.equal(cpUnknown.status, 2);

  const cpBadArgs = spawnSync(process.execPath, [cli, '--root', root], { encoding: 'utf8' });
  assert.equal(cpBadArgs.status, 2);
  assert.match(cpBadArgs.stderr, /invalid_pinned_suite_arguments/);
});

test('A candidate runner is never loaded', async (t) => {
  const root = await fixtureRoot(t);
  await put(root, 'packages/contribution-tools/suite-runner.mjs', `
export async function runPinnedSuite() {
  return { status: 'passed' };
}
  `);
  await put(root, 'scripts/ci/run-pinned-suite.mjs', `
console.log(JSON.stringify({ status: 'passed' }));
process.exit(0);
  `);

  const suite = PINNED_SUITES['ci.governance-unit'];
  await putBaseline(root, suite, "import { test } from 'node:test';\ntest('fail', () => { throw new Error('fail'); });");

  const cp = spawnSync(process.execPath, [cli, '--root', root, '--suite', 'ci.governance-unit'], { encoding: 'utf8' });
  assert.equal(cp.status, 1);
});

test('Duplicate evidence stays rejected', async (t) => {
  const root = await fixtureRoot(t);
  await put(root, 'packages/contribution-tools/test/a.test.mjs', `
import { test } from 'node:test';
test('a', () => {});
export const helper = () => 1;
  `);
  await put(root, 'packages/contribution-tools/test/b.test.mjs', `
import { test } from 'node:test';
import { helper } from './a.test.mjs';
test('b', () => {
  helper();
});
  `);

  const def = Object.freeze({
    ...PINNED_SUITES['ci.governance-unit'],
    baseline: Object.freeze([
      'packages/contribution-tools/test/a.test.mjs',
      'packages/contribution-tools/test/b.test.mjs'
    ])
  });

  const result = await runPinnedSuiteDefinition(root, 'ci.governance-unit', def);
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'incomplete_test_results');
});

test('The suite table is deep-frozen', () => {
  assert.ok(Object.isFrozen(PINNED_SUITES));
  for (const entry of Object.values(PINNED_SUITES)) {
    assert.ok(Object.isFrozen(entry));
    if (entry.files) {
      assert.ok(Object.isFrozen(entry.files));
    }
    if (entry.env) {
      assert.ok(Object.isFrozen(entry.env));
    }
    if (entry.baseline) {
      assert.ok(Object.isFrozen(entry.baseline));
    }
  }
});

async function pinnedFixtureRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'fp-pinned-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('Contracts pytest fixture without full baseline fails', async (t) => {
  const root = await pinnedFixtureRoot(t);
  const suite = PINNED_SUITES['ci.contracts-pytest'];
  for (let i = 0; i < suite.baseline.length - 1; i++) {
    await put(root, suite.baseline[i], "def test_a(): pass\n");
  }

  const result = await runPinnedSuite(root, 'ci.contracts-pytest');
  assert.equal(result.status, 'not_run');
  assert.equal(result.reason, 'suite_files_unavailable');
});

test('Corrupt JUnit XML', async (t) => {
  const root = await pinnedFixtureRoot(t);
  const xmlFile = join(root, 'junit.xml');
  const expFile = join(root, 'expected.json');
  await put(root, 'junit.xml', "<testsuites><testsuite"); // corrupt
  await put(root, 'expected.json', JSON.stringify(['a.py']));

  const helperPath = join(repoRoot, 'scripts/ci/pinned_pytest_evidence.py');
  const cp = spawnSync('python3', ['-I', helperPath, '--junit', xmlFile, '--expected', expFile], { encoding: 'utf8' });
  assert.equal(cp.status, 1);
  const res = JSON.parse(cp.stdout);
  assert.equal(res.ok, false);
});

test('Unexpected file in JUnit XML', async (t) => {
  const root = await pinnedFixtureRoot(t);
  const xmlFile = join(root, 'junit.xml');
  const expFile = join(root, 'expected.json');
  await put(root, 'junit.xml', `<testsuites><testsuite tests="2"><testcase classname="test_b" name="test" file="expected.py" /><testcase classname="test_a" name="test" file="unexpected.py" /></testsuite></testsuites>`);
  await put(root, 'expected.json', JSON.stringify(['expected.py']));

  const helperPath = join(repoRoot, 'scripts/ci/pinned_pytest_evidence.py');
  const cp = spawnSync('python3', ['-I', helperPath, '--junit', xmlFile, '--expected', expFile], { encoding: 'utf8' });
  assert.equal(cp.status, 1);
  const res = JSON.parse(cp.stdout);
  assert.equal(res.ok, false);
  assert.match(res.reason, /unexpected_file/);
});


test('Pytest JUnit evidence rejects incomplete totals, skips, duplicate identities and unsafe paths', async t => {
  const root = await pinnedFixtureRoot(t);
  const helperPath = join(repoRoot, 'scripts/ci/pinned_pytest_evidence.py');
  const expectedFile = join(root, 'expected.json'), junit = join(root, 'junit.xml');
  const tc = (file = 'a.py', name = 'test_ok', children = '') => `<testcase file="${file}" classname="a" name="${name}">${children}</testcase>`;
  const xml = (cases, attrs = '') => `<testsuites><testsuite tests="${cases.length}" ${attrs}>${cases.join('')}</testsuite></testsuites>`;
  const cases = [
    [xml([tc(), tc('a.py', 'test_skip', '<skipped/>')]), ['a.py'], 'testcase_not_passed'],
    [xml([tc('a.py', 'test_fail', '<failure/>')]), ['a.py'], 'testcase_not_passed'],
    [xml([tc('a.py', 'test_error', '<error/>')]), ['a.py'], 'testcase_not_passed'],
    [xml([tc(), tc()]), ['a.py'], 'duplicate_case_identity'],
    [xml([tc()]).replace('tests="1"', 'tests="2"'), ['a.py'], 'invalid_suite_totals'],
    ...['errors', 'failures', 'skipped'].map(key => [xml([tc()], `${key}="1"`), ['a.py'], 'invalid_suite_totals']),
    ...['../a.py', '/a.py', 'x/../a.py', 'C:/a.py', 'C:\\a.py'].map(path => [xml([tc(path)]), ['a.py'], 'invalid_file_attribute']),
    ...['a.py', { file: 'a.py' }, [42], null].map(expected => [xml([tc()]), expected, 'invalid_expected_files'])
  ];
  for (const [source, expected, reason] of cases) {
    await put(root, 'junit.xml', source);
    await put(root, 'expected.json', JSON.stringify(expected));
    const child = spawnSync('python3', ['-I', helperPath, '--junit', junit, '--expected', expectedFile], { encoding: 'utf8' });
    assert.equal(child.status, 1, reason);
    const result = JSON.parse(child.stdout);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.match(result.reason, /^[a-z_]+$/);
  }
  // Normalization is POSIX and relative; it never accepts traversal or absolute paths.
  await put(root, 'junit.xml', xml([tc('./dir\\a.py')]));
  await put(root, 'expected.json', JSON.stringify(['dir/a.py']));
  const child = spawnSync('python3', ['-I', helperPath, '--junit', junit, '--expected', expectedFile], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  const result = JSON.parse(child.stdout);
  assert.equal(result.files[0].path, 'dir/a.py');
  assert.equal(result.total, 1);
  assert.match(result.files[0].cases[0].case_sha256, /^[a-f0-9]{64}$/);
});

test('Pytest failure-counts helper emits only closed selected-file counts', async t => {
  const root = await pinnedFixtureRoot(t);
  const helperPath = join(repoRoot, 'scripts/ci/pinned_pytest_evidence.py');
  const tc = (file, name, children = '') => `<testcase file="${file}" classname="private-class" name="${name}">${children}</testcase>`;
  const source = `<testsuites tests="5"><testsuite tests="5" failures="1" errors="1" skipped="1">${[
    tc('a.py', 'pass'), tc('b.py', '::error::&#10;freedom.test-failure-diagnostic', '<failure message="private-message">private-stack</failure>'),
    tc('b.py', 'error', '<error/>'), tc('b.py', 'skip', '<skipped/>'), tc('c.py', 'pass')
  ].join('')}</testsuite></testsuites>`;
  await put(root, 'expected.json', JSON.stringify(['a.py', 'b.py', 'c.py']));
  await put(root, 'junit.xml', source);
  const run = () => spawnSync('python3', ['-I', helperPath, '--failure-counts', '--junit', join(root, 'junit.xml'),
    '--expected', join(root, 'expected.json')], { encoding: 'utf8' });
  const child = run();
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), { ok: false, reason: 'test_process_failed', files: [
    { path: 'a.py', counts: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 } },
    { path: 'b.py', counts: { tests: 3, passed: 0, failed: 2, cancelled: 0, skipped: 1, todo: 0 } },
    { path: 'c.py', counts: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 } }
  ] });
  assert.doesNotMatch(child.stdout, /::error::|freedom\.test-failure-diagnostic|private-/);
  // Even a pass-shaped document is never pass evidence in this mode.
  await put(root, 'expected.json', '["a.py"]');
  await put(root, 'junit.xml', `<testsuite tests="1">${tc('a.py', 'pass')}</testsuite>`);
  assert.equal(JSON.parse(run().stdout).ok, false);
});

test('Pytest failure-counts helper rejects unsafe, incomplete and oversized XML without output text', async t => {
  const root = await pinnedFixtureRoot(t);
  const helperPath = join(repoRoot, 'scripts/ci/pinned_pytest_evidence.py');
  const tc = '<testcase file="a.py" name="pass"/>';
  const source = `<testsuite tests="1">${tc}</testsuite>`;
  const dtd = '<!DOCTYPE testsuite [<!ENTITY payload "private-entity">]>';
  const invalid = [
    null, '<testsuites><testsuite', source + 'truncated', 'x'.repeat(16 * 1024 * 1024 + 1),
    source.replace('file="a.py"', 'file="unknown.py"'), source.replace('file="a.py"', 'file="./a.py"'),
    source.replace('file="a.py"', 'file="../a.py"'), source.replace('file="a.py"', ''),
    source.replace('tests="1"', 'tests="2"'), source.replace('tests="1"', 'tests="9007199254740992"'),
    `<testsuite tests="2">${tc}${tc}</testsuite>`, '<testsuite tests="0"/>',
    source.replace('</testsuite>', '<properties><testcase file="unknown.py"/></properties></testsuite>'),
    `<testsuite tests="1" failures="1">${tc}</testsuite>`,
    '<testsuite tests="1"><testcase file="a.py"><failure/><skipped/></testcase></testsuite>',
    dtd + source.replace('name="pass"', 'name="&payload;"'),
    Buffer.from('<?xml version="1.0" encoding="UTF-16"?>' + dtd + source, 'utf16le'),
    '<!DOCTYPE testsuite SYSTEM "file:///never-read">' + source,
    source.replace('name="pass"', 'name="::error::&#1;freedom.test-failure-diagnostic"'),
  ];
  for (const [index, xml] of invalid.entries()) {
    await put(root, 'expected.json', '["a.py"]');
    if (xml === null) await rm(join(root, 'junit.xml'), { force: true });
    else await put(root, 'junit.xml', xml);
    const child = spawnSync('python3', ['-I', helperPath, '--failure-counts', '--junit', join(root, 'junit.xml'),
      '--expected', join(root, 'expected.json')], { encoding: 'utf8' });
    assert.equal(child.status, 1, String(index));
    assert.equal(child.stderr, '', String(index));
    assert.deepEqual(JSON.parse(child.stdout), { ok: false, reason: 'invalid_failure_counts' }, String(index));
  }
  for (const expected of [['a.py', 'a.py'], ['a.py', 'b.py'], ['a.py', 1], ['a.py', 'dir/../b.py'], []]) {
    await put(root, 'junit.xml', source);
    await put(root, 'expected.json', JSON.stringify(expected));
    const child = spawnSync('python3', ['-I', helperPath, '--failure-counts', '--junit', join(root, 'junit.xml'),
      '--expected', join(root, 'expected.json')], { encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.ok(!Object.hasOwn(JSON.parse(child.stdout), 'files'));
  }
});

// A controlled Python launcher verifies process/error/deadline boundaries without
// depending on pytest timing. The real helper still parses the supplied XML.
async function pytestLauncher(t) {
  const root = await pinnedFixtureRoot(t);
  const python = spawnSync('python3', ['-I', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' });
  assert.equal(python.status, 0);
  const executable = python.stdout.trim();
  const previousPath = process.env.PATH;
  await put(root, 'bin/python3', `#!${executable}
import json, os, signal, sys, time
from pathlib import Path
mode = Path('mode').read_text()
is_pytest = 'pytest' in sys.argv
with open('invocations', 'a') as stream:
    stream.write('pytest\\n' if is_pytest else 'helper\\n')
if is_pytest:
    junit = Path(sys.argv[sys.argv.index('--junitxml') + 1])
    if mode != 'missing':
        junit.write_bytes(Path('source.xml').read_bytes())
    if mode == 'signal':
        os.kill(os.getpid(), signal.SIGTERM)
    if mode == 'wait':
        time.sleep(60)
    sys.exit(0 if mode == 'pass' else 1)
if mode == 'helper-error':
    sys.exit(1)
if mode in ('helper-timeout', 'helper-cancel'):
    Path('helper-started').touch()
    time.sleep(60)
if mode.startswith('helper-output'):
    print(Path('helper-output.json').read_text())
    sys.exit(0)
os.execv(${JSON.stringify(executable)}, [${JSON.stringify(executable)}, *sys.argv[1:]])
`);
  await chmod(join(root, 'bin/python3'), 0o755);
  process.env.PATH = join(root, 'bin') + ':' + previousPath;
  t.after(() => { process.env.PATH = previousPath; });
  const files = ['tests/a.py', 'tests/b.py', 'tests/c.py'];
  for (const file of files) await put(root, file, '# controlled fixture\n');
  const source = '<testsuite tests="3" failures="1">' + files.map((path, i) =>
    `<testcase file="${path}" name="test">${i === 1 ? '<failure message="::error:: freedom.test-failure-diagnostic"/>' : ''}</testcase>`).join('') + '</testsuite>';
  await put(root, 'source.xml', source);
  const suite = Object.freeze({ files: Object.freeze(files), loader: 'pytest', database: false, timeoutMs: 10_000, env: Object.freeze([]) });
  return { root, files, source, run: options => runPinnedSuiteDefinition(root, 'ci.fixture-pytest', suite, options) };
}

test('Failed pytest attaches every selected file and preserves the failure verdict', async t => {
  const { root, files, run } = await pytestLauncher(t);
  await put(root, 'mode', 'failure');
  const result = await run();
  assert.deepEqual(result, { check_id: 'ci.fixture-pytest', status: 'failed', reason: 'test_process_failed',
    selected_files: files, test_count: 0, test_files: files.map((path, i) => ({ path,
      counts: { tests: 1, passed: i === 1 ? 0 : 1, failed: i === 1 ? 1 : 0, cancelled: 0, skipped: 0, todo: 0 },
      cases: [], suite_events: [] })) });
  assert.equal(await readFile(join(root, 'invocations'), 'utf8'), 'pytest\nhelper\n');
});

test('Failed pytest returns exactly the old failure for unusable XML or helper output', async t => {
  const { root, files, source, run } = await pytestLauncher(t);
  const oldFailure = { check_id: 'ci.fixture-pytest', status: 'failed', reason: 'test_process_failed', selected_files: files, test_count: 0 };
  for (const [mode, xml] of [
    ['missing', source], ['malformed', '<testsuites>'], ['oversized', 'x'.repeat(16 * 1024 * 1024 + 1)],
    ['unknown', source.replace('tests/b.py', 'unknown.py')], ['duplicate', source.replace('tests/b.py', 'tests/a.py')],
    ['helper-error', source]
  ]) {
    await put(root, 'mode', mode);
    await put(root, 'source.xml', xml);
    assert.deepEqual(await run(), oldFailure, mode);
  }
  await put(root, 'source.xml', source);
  const valid = { ok: false, reason: 'test_process_failed', files: files.map(path => ({ path,
    counts: { tests: 1, passed: 0, failed: 1, cancelled: 0, skipped: 0, todo: 0 } })) };
  for (const transform of [
    value => { value.ok = true; },
    value => { value.files[1].path = 'unknown.py'; },
    value => { value.files[1].path = files[0]; },
    value => { value.files.pop(); },
    value => { value.files[1].counts.failed = -1; },
    value => { value.files[1].counts.tests = 1.5; },
    value => { value.files[1].counts.failed = 9007199254740992; },
    value => { value.files[1].counts.failed = '::error:: freedom.test-failure-diagnostic'; },
    value => { value.files[1].counts.passed = 1; }
  ]) {
    const output = structuredClone(valid); transform(output);
    await put(root, 'mode', 'helper-output');
    await put(root, 'helper-output.json', JSON.stringify(output));
    assert.deepEqual(await run(), oldFailure);
  }
  await put(root, 'helper-output.json', '{truncated');
  assert.deepEqual(await run(), oldFailure);
  // Ignore all extra fields even if a helper result contains arbitrary text.
  await put(root, 'helper-output.json', JSON.stringify({ ...valid, message: '::error::',
    files: valid.files.map(file => ({ ...file, cases: [{ name: 'freedom.test-failure-diagnostic' }], message: 'private-message' })) }));
  assert.doesNotMatch(JSON.stringify(await run()), /::error::|freedom\.test-failure-diagnostic|private-message/);
});

test('Pytest timeout, cancellation, signal and spawn errors never invoke the XML helper', async t => {
  const { root, files, run } = await pytestLauncher(t);
  const failure = reason => ({ check_id: 'ci.fixture-pytest', status: 'failed', reason, selected_files: files, test_count: 0 });
  await put(root, 'mode', 'wait');
  assert.deepEqual(await run({ timeoutMs: 500 }), failure('test_timeout'));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 300);
  try { assert.deepEqual(await run({ signal: ac.signal }), failure('test_cancelled')); }
  finally { clearTimeout(timer); }
  assert.equal(await readFile(join(root, 'invocations'), 'utf8'), 'pytest\npytest\n');
  await put(root, 'mode', 'signal');
  assert.deepEqual(await run(), failure('test_process_failed'));
  assert.equal(await readFile(join(root, 'invocations'), 'utf8'), 'pytest\npytest\npytest\n');
  process.env.PATH = join(root, 'empty-bin');
  assert.deepEqual(await run(), failure('test_process_failed'));
  assert.equal(await readFile(join(root, 'invocations'), 'utf8'), 'pytest\npytest\npytest\n');
});

test('A hung or cancelled failure helper preserves test_process_failed within the original deadline', async t => {
  const { root, files, run } = await pytestLauncher(t);
  const oldFailure = { check_id: 'ci.fixture-pytest', status: 'failed', reason: 'test_process_failed', selected_files: files, test_count: 0 };
  await put(root, 'mode', 'helper-timeout');
  const started = performance.now();
  assert.deepEqual(await run({ timeoutMs: 700 }), oldFailure);
  assert.ok(performance.now() - started < 3000);
  assert.equal(await readFile(join(root, 'helper-started'), 'utf8'), '');
  await rm(join(root, 'helper-started'));
  await put(root, 'mode', 'helper-cancel');
  const ac = new AbortController();
  const timer = setInterval(async () => {
    try { await stat(join(root, 'helper-started')); ac.abort(); } catch { /* waiting for the helper */ }
  }, 10);
  try { assert.deepEqual(await run({ timeoutMs: 3000, signal: ac.signal }), oldFailure); }
  finally { clearInterval(timer); }
  assert.equal(await readFile(join(root, 'invocations'), 'utf8'), 'pytest\nhelper\npytest\nhelper\n');
});
