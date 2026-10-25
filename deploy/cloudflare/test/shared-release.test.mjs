import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { REPOSITORY, REPOSITORY_ID, OPERATORS, PHASES, requestFromEnvironment, admitRelease,
  admitInstallation, requireStaging, githubClient } from '../../shared-release/admission.mjs';
import { validateOperatorResult, operatorProgress, operatorCommand, runOperator } from '../../shared-release/operator.mjs';

const sha = 'a'.repeat(40), main = 'b'.repeat(40), tree = 'c'.repeat(40);
const hash = value => createHash('sha256').update(value).digest('hex');
const config = JSON.stringify({ format: 'freedom.shared-release-config/v1', target: 'staging-next' });
const installation = { image: `ghcr.io/freetwai/freedom-release-operator@sha256:${'d'.repeat(64)}`, configSha256: hash(config) };
const environment = () => ({ GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: String(REPOSITORY_ID),
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/shared-release.yml@refs/heads/main`,
  CONTROLLER_SHA: main, RELEASE_SHA: sha, RELEASE_TARGET: 'staging-next', RELEASE_MODE: 'plan',
  GITHUB_ACTOR: 'teddashh', GITHUB_ACTOR_ID: String(OPERATORS.teddashh),
  GITHUB_TRIGGERING_ACTOR: 'arumwu', GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '2' });
const request = () => ({ ...requestFromEnvironment(environment()), admittedAt: new Date(0).toISOString() });

function fixtureApi(override = () => undefined) {
  const calls = [];
  const api = async path => {
    calls.push(path);
    const replacement = override(path); if (replacement !== undefined) return structuredClone(replacement);
    if (path.includes('/collaborators/')) {
      const login = path.split('/').at(-2);
      return { permission: 'admin', user: { login, id: OPERATORS[login] } };
    }
    if (path.endsWith('/branches/main')) return { commit: { sha: main } };
    if (path.includes('/compare/')) return { status: 'ahead', merge_base_commit: { sha: path.split('/').at(-1).split('...')[0] } };
    if (path.includes('/commits/')) return { sha, commit: { tree: { sha: tree } } };
    if (/\/workflows\/[^/]+\.yml$/.test(path)) {
      const file = path.split('/').at(-1);
      return { id: file === 'verify.yml' ? 1 : 2, path: `.github/workflows/${file}`, state: 'active' };
    }
    if (path.includes('/workflows/1/runs?')) return { total_count: 1, workflow_runs: [{ id: 11 }] };
    if (path.includes('/workflows/2/runs?')) return { total_count: 1, workflow_runs: [{ id: 22 }] };
    if (/\/actions\/runs\/\d+$/.test(path)) {
      const id = Number(path.split('/').at(-1)), workflowId = id === 11 ? 1 : 2;
      return { id, workflow_id: workflowId, path: `.github/workflows/${workflowId === 1 ? 'verify' : 'codeql'}.yml`,
        head_sha: sha, head_branch: 'main', event: 'push', repository: { id: REPOSITORY_ID },
        head_repository: { id: REPOSITORY_ID }, run_attempt: 2, status: 'completed', conclusion: 'success' };
    }
    throw Error(`Unexpected fixture API: ${path}`);
  };
  return Object.assign(api, { calls });
}

test('each named operator can use an exact main SHA; original and rerun actors are independently checked', async () => {
  for (const [login, id] of Object.entries(OPERATORS)) {
    const api = fixtureApi();
    const value = await admitRelease({ ...request(), actor: login, actorId: id }, api);
    assert.equal(value.original.login, login); assert.equal(value.triggeredBy.login, 'arumwu');
    assert.equal(value.sourceTree, tree); assert.equal(value.verification.length, 2);
    assert.ok(api.calls.includes(`/repos/${REPOSITORY}/collaborators/arumwu/permission`));
    assert.ok(api.calls.every(path => !path.includes('status=success') && !path.includes('conclusion=success')));
  }
});

test('dispatch rejects fork/branch workflow, aliases, invalid environments and injected inputs', () => {
  for (const patch of [
    { GITHUB_REPOSITORY: 'someone/freedom-platform' }, { GITHUB_REPOSITORY_ID: '2' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/shared-release.yml@refs/heads/other` },
    { CONTROLLER_SHA: 'main' }, { RELEASE_SHA: 'main' }, { RELEASE_SHA: '$(id)' },
    { RELEASE_TARGET: 'production' }, { RELEASE_MODE: 'rollback' },
    { GITHUB_RUN_ID: '1\nother=value' }, { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_ACTOR_ID: 'NaN' },
  ]) assert.throws(() => requestFromEnvironment({ ...environment(), ...patch }));
});

test('renamed/replaced or revoked accounts and unapproved rerun actors cannot release', async () => {
  for (const patch of [{ actor: 'someone' }, { triggeringActor: 'someone' }, { actorId: 1 }])
    await assert.rejects(admitRelease({ ...request(), ...patch }, fixtureApi()));
  for (const permission of ['read', 'triage', 'none']) {
    await assert.rejects(admitRelease(request(), fixtureApi(path => path.includes('/collaborators/arumwu/')
      ? { permission, user: { login: 'arumwu', id: OPERATORS.arumwu } } : undefined)),
    { code: 'release_operator_permission_missing' });
  }
  await assert.rejects(admitRelease(request(), fixtureApi(path => path.includes('/collaborators/arumwu/')
    ? { permission: 'admin', user: { login: 'arumwu', id: 999 } } : undefined)));
});

test('unmerged source, unmerged controller and incorrect Git tree evidence fail admission', async () => {
  for (const patch of [{ status: 'diverged' }, { status: 'behind' }, { merge_base_commit: { sha: tree } }]) {
    await assert.rejects(admitRelease(request(), fixtureApi(path => path.includes('/compare/')
      ? { status: 'ahead', merge_base_commit: { sha }, ...patch } : undefined)), { code: 'release_source_not_merged_main' });
  }
  await assert.rejects(admitRelease(request(), fixtureApi(path => path.includes('/commits/')
    ? { sha: main, commit: { tree: { sha: tree } } } : undefined)), { code: 'release_source_identity_invalid' });
});

test('same-name/wrong-repository/PR/rerun CI evidence never counts as exact-source main success', async () => {
  const baseline = await fixtureApi()(`/repos/${REPOSITORY}/actions/runs/11`);
  for (const patch of [{ workflow_id: 77 }, { path: '.github/workflows/forged.yml' }, { head_sha: main },
    { head_branch: 'feature' }, { event: 'pull_request' }, { repository: { id: 2 } },
    { head_repository: { id: 2 } }, { run_attempt: 0 }, { status: 'in_progress' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' }]) {
    await assert.rejects(admitRelease(request(), fixtureApi(path => path.endsWith('/actions/runs/11')
      ? { ...baseline, ...patch } : undefined)));
  }
});

test('newer pending CI defeats an older success; absent and truncated run listings fail closed', async () => {
  const api = fixtureApi(path => path.includes('/workflows/1/runs?')
    ? { total_count: 2, workflow_runs: [{ id: 11 }, { id: 33 }] }
    : path.endsWith('/actions/runs/33') ? { id: 33, status: 'queued' } : undefined);
  await assert.rejects(admitRelease(request(), api)); assert.ok(api.calls.some(path => path.endsWith('/runs/33')));
  for (const listing of [{ total_count: 0, workflow_runs: [] }, { total_count: 101, workflow_runs: [{ id: 11 }] },
    { total_count: 2, workflow_runs: [{ id: 11 }] }]) {
    await assert.rejects(admitRelease(request(), fixtureApi(path => path.includes('/workflows/1/runs?') ? listing : undefined)),
      { code: 'release_verification_unavailable' });
  }
});

test('deployment is disabled by default and accepts only the configured digest-pinned operator', () => {
  const good = { RELEASE_ENABLED: 'true', RELEASE_OPERATOR_IMAGE: installation.image, RELEASE_CONFIG_SHA256: installation.configSha256 };
  assert.deepEqual(admitInstallation(good), installation);
  for (const patch of [{ RELEASE_ENABLED: '' }, { RELEASE_ENABLED: 'false' }, { RELEASE_ENABLED: 'TRUE' },
    { RELEASE_OPERATOR_IMAGE: 'ghcr.io/freetwai/freedom-release-operator:latest' },
    { RELEASE_OPERATOR_IMAGE: installation.image.replace('freetwai', 'someone') }, { RELEASE_CONFIG_SHA256: '' }])
    assert.throws(() => admitInstallation({ ...good, ...patch }));
});

test('production requires the newest same-source staging deployment with the same operator to be successful', async () => {
  const staging = { id: 1, sha, environment: 'staging-next',
    payload: { format: 'freedom.shared-release/v1', operatorImage: installation.image } };
  const api = async path => path.includes('/statuses?') ? [{ state: 'success' }] : [staging];
  await requireStaging(api, { ...request(), target: 'next' }, installation);
  for (const mutate of [() => [], () => [{ ...staging, payload: {} }], () => [{ ...staging, sha: main }],
    () => [{ ...staging, payload: { ...staging.payload, operatorImage: 'other' } }]]) {
    await assert.rejects(requireStaging(mutate, { ...request(), target: 'next' }, installation));
  }
  await assert.rejects(requireStaging(async path => path.includes('/statuses?') ? [{ state: 'failure' }]
    : [staging, { ...staging, id: 2 }], { ...request(), target: 'next' }, installation), { code: 'release_staging_not_successful' });
});

function resultFixture(admission = request(), requestSha256 = 'e'.repeat(64)) {
  const phases = PHASES.map((name, i) => ({ name, status: 'passed',
    startedAt: new Date(i * 10_000).toISOString(), completedAt: new Date(i * 10_000 + 1000).toISOString() }));
  Object.assign(phases[0], { leaseHeld: true, sourceCompatible: true, retainedFloorVerified: true,
    flagsPreserved: true, previousSourceSha: main });
  for (const [i, sourceSha] of [[1, main], [5, sha]]) Object.assign(phases[i], { sourceSha,
    archiveSha256: 'f'.repeat(64), remoteReadback: 'verified', restore: 'database_and_objects_restored',
    cleanupVerified: true, exposure: 'quarantine' });
  Object.assign(phases[2], { outcome: 'committed', ledgerVerified: true, runtimeGrantsVerified: true });
  Object.assign(phases[3], { sourceSha: sha, providerConfirmed: true });
  Object.assign(phases[4], { sourceSha: sha, statusCode: 200, schemaVerified: true, smokePassed: true });
  Object.assign(phases[6], { scheduledBackupsVerified: true, cleanupVerified: true,
    leaseReleased: true, retainedFloorAdvanced: true });
  return { format: 'freedom.shared-release-operator-result/v1', requestSha256,
    sourceSha: admission.sourceSha, target: admission.target, runId: admission.runId,
    runAttempt: admission.runAttempt, operatorImage: installation.image, configSha256: installation.configSha256, phases };
}

test('successful operator evidence is projected to a fixed public allowlist', () => {
  const result = resultFixture(); result.secret = 'never publish me'; result.phases[2].databaseUrl = 'private';
  const published = validateOperatorResult(result, request(), installation, 'e'.repeat(64));
  assert.equal(published.length, 7); assert.ok(!JSON.stringify(published).includes('private'));
  assert.deepEqual(Object.keys(published[0]), ['name', 'status', 'startedAt', 'completedAt']);
});

test('missing restore/cleanup/floor/grants/health/schedule evidence and uncertain migration cannot pass', () => {
  const changes = [
    [0, { leaseHeld: false }], [0, { retainedFloorVerified: false }], [0, { flagsPreserved: false }],
    [1, { remoteReadback: 'not_run' }], [1, { restore: 'database_only' }], [1, { cleanupVerified: false }],
    [1, { sourceSha: sha }], [1, { exposure: 'public' }], [2, { outcome: 'unknown' }],
    [2, { runtimeGrantsVerified: false }], [3, { providerConfirmed: false }],
    [4, { sourceSha: main }], [4, { statusCode: 500 }], [4, { schemaVerified: false }],
    [5, { restore: 'not_run' }], [6, { scheduledBackupsVerified: false }],
    [6, { leaseReleased: false }], [6, { retainedFloorAdvanced: false }],
  ];
  for (const [index, patch] of changes) {
    const result = resultFixture(); Object.assign(result.phases[index], patch);
    assert.throws(() => validateOperatorResult(result, request(), installation, 'e'.repeat(64)));
  }
});

test('receipts from another attempt/source/operator/config or with out-of-order phases are rejected', () => {
  for (const patch of [{ sourceSha: main }, { target: 'next' }, { runId: 999 }, { runAttempt: 1 },
    { operatorImage: 'other' }, { requestSha256: '0'.repeat(64) }, { configSha256: '0'.repeat(64) },
    { phases: [] }, { phases: [...resultFixture().phases].reverse() }]) {
    assert.throws(() => validateOperatorResult({ ...resultFixture(), ...patch }, request(), installation, 'e'.repeat(64)));
  }
  const result = resultFixture(); result.phases[2].startedAt = result.phases[0].startedAt;
  assert.throws(() => validateOperatorResult(result, request(), installation, 'e'.repeat(64)));
});

test('failed progress reports identify the phase without publishing arbitrary operator diagnostics', () => {
  const value = resultFixture(); value.phases = value.phases.slice(0, 3);
  Object.assign(value.phases[2], { status: 'failed', error: 'private-token' });
  const progress = operatorProgress(value, request(), installation, 'e'.repeat(64));
  assert.deepEqual(progress.at(-1), { name: 'migration', reportedStatus: 'failed' });
  assert.ok(!JSON.stringify(progress).includes('private-token'));
  value.phases[0].status = 'running';
  assert.throws(() => operatorProgress(value, request(), installation, 'e'.repeat(64)));
});

async function operatorFixture(t, outcome = 'passed') {
  const root = await mkdtemp(join(tmpdir(), 'freedom-shared-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), temporaryRoot = join(root, 'work');
  await mkdir(source); await mkdir(temporaryRoot);
  const calls = [], credentials = { cloudflareApiToken: 'fixture-token', migrationDatabaseUrl: 'fixture-db', backupDatabaseUrl: 'fixture-backup' };
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'run') {
      const input = await readFile(join(temporaryRoot, 'input/request.json'), 'utf8');
      assert.equal((await stat(join(temporaryRoot, 'input/credentials.json'))).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(await readFile(join(temporaryRoot, 'input/credentials.json'), 'utf8')), credentials);
      if (outcome === 'interrupted') throw Error('secret token in provider error');
      if (outcome === 'symlink') await symlink(join(temporaryRoot, 'input/credentials.json'), join(temporaryRoot, 'output/result.json'));
      else await writeFile(join(temporaryRoot, 'output/result.json'), JSON.stringify(resultFixture(request(), hash(input))));
    }
    if (args[0] === 'rm' && outcome === 'cleanup-failed') throw Error('cleanup failure');
  };
  return { calls, root, temporaryRoot, options: { admission: request(), installation, sourceRoot: source,
    temporaryRoot, config, credentials, run } };
}

test('one operator process owns the whole release; no credentials enter argv, host mounts or artifacts', async t => {
  const fixture = await operatorFixture(t);
  assert.equal((await runOperator(fixture.options)).length, 7);
  assert.deepEqual(fixture.calls.map(call => call[1]), ['pull', 'run', 'rm']);
  assert.ok(!JSON.stringify(fixture.calls).includes('fixture-token'));
  assert.ok(!JSON.stringify(fixture.calls).includes('docker.sock'));
  await assert.rejects(stat(join(fixture.temporaryRoot, 'input')));
  await assert.rejects(stat(join(fixture.temporaryRoot, 'output')));
  const args = operatorCommand(installation.image, '/source', '/private', '/output', 'release-fixture');
  assert.ok(args.includes('--read-only')); assert.ok(args.includes('--cap-drop=ALL'));
  assert.ok(args.includes('type=bind,src=/source,dst=/release/source,readonly'));
});

test('an interrupted release is not retried and private input/output are removed', async t => {
  const fixture = await operatorFixture(t, 'interrupted');
  await assert.rejects(runOperator(fixture.options));
  assert.deepEqual(fixture.calls.map(call => call[1]), ['pull', 'run', 'rm']);
  await assert.rejects(stat(join(fixture.temporaryRoot, 'input')));
  await assert.rejects(stat(join(fixture.temporaryRoot, 'output')));
});

test('receipt symlinks and failed container cleanup cannot yield successful releases', async t => {
  for (const outcome of ['symlink', 'cleanup-failed']) {
    const fixture = await operatorFixture(t, outcome);
    await assert.rejects(runOperator(fixture.options));
    await assert.rejects(stat(join(fixture.temporaryRoot, 'input')));
  }
});

test('config pin/target drift and missing credentials stop before Docker or provider work', async t => {
  const fixture = await operatorFixture(t);
  for (const patch of [{ config: '{}' }, { credentials: {} }, { config: undefined }])
    await assert.rejects(runOperator({ ...fixture.options, ...patch }));
  assert.equal(fixture.calls.length, 0);
});

test('GitHub transport neither follows redirects nor prints response bodies or tokens on failure', async () => {
  let observed;
  const api = githubClient('fixture-token', async (url, options) => {
    observed = { url, options }; return new Response('secret provider response', { status: 403 });
  });
  await assert.rejects(api(`/repos/${REPOSITORY}/branches/main`), { code: 'release_github_request_failed' });
  assert.equal(observed.options.redirect, 'error');
  assert.equal(observed.url, `https://api.github.com/repos/${REPOSITORY}/branches/main`);
  await assert.rejects(api('/user'), { code: 'release_api_path_invalid' });
});

test('workflow keeps dispatch input out of shell, secrets out of admission, and pins controller/actions', async () => {
  const text = await readFile(new URL('../../../.github/workflows/shared-release.yml', import.meta.url), 'utf8');
  assert.match(text, /on:\n  workflow_dispatch:/);
  assert.match(text, /cancel-in-progress: false/);
  assert.match(text, /deployment: false/);
  const admission = text.split('  admission:')[1].split('\n  deploy:')[0];
  assert.ok(!admission.includes('secrets.')); assert.ok(!admission.includes('\n    environment:'));
  for (const match of text.matchAll(/uses: ([^\n#]+)/g)) assert.match(match[1].trim(), /^[a-z0-9/-]+@[a-f0-9]{40}$/);
  for (const match of text.matchAll(/run: ([^\n]+)/g)) assert.ok(!match[1].includes('${{'));
  assert.equal([...text.matchAll(/ref: \$\{\{ job.workflow_sha \}\}/g)].length, 2);
  assert.equal([...text.matchAll(/persist-credentials: false/g)].length, 3);
});
