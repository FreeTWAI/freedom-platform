import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, stat, symlink, realpath, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { REPOSITORY, REPOSITORY_ID, OPERATORS, PHASES, requestFromEnvironment, admitRelease,
  admitInstallation, requireStaging, githubClient } from '../../shared-release/admission.mjs';
import { validateOperatorResult, operatorProgress, operatorCommand, runOperator } from '../../shared-release/operator.mjs';
import { remotePostgresEnvironment, runPostgresProcess, writeSnapshotDump } from '../../shared-release/portable/postgres.mjs';
import { decodeReceiptArchive } from '../../shared-release/artifacts.mjs';
import { boundedResponseBytes, createCloudflareRecoveryTransport, waitForPublicRelease } from '../../shared-release/portable/cloudflare.mjs';
import { backupObjectStore, backupTar, bytesStream, newBackupDirectories } from '../../shared-release/portable/backup-storage.mjs';
import { openCapturePolicy } from '../../shared-release/portable/capture-policy.mjs';
import { createWorkerDeployer, renderWorkerConfig } from '../../shared-release/portable/deploy.mjs';
import { parseJsonc } from '../lib/wrangler.mjs';
import { buildApplication, directoryDigest } from '../../shared-release/portable/build.mjs';
import { git as fixtureGit } from './migration-fixtures.mjs';

async function diskFixture(t, prefix) {
  const candidates = process.env.FREEDOM_RELEASE_TEST_DISK_ROOT ? [process.env.FREEDOM_RELEASE_TEST_DISK_ROOT]
    : [resolve('.freedom'), '/var/tmp'];
  for (const candidate of candidates) {
    let root, fs;
    try { root = await realpath(candidate); fs = await statfs(root); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if ([0x01021994, 0x858458f6].includes(fs.type >>> 0)) continue;
    const path = await mkdtemp(join(root, prefix));
    t.after(() => rm(path, { recursive: true, force: true })); return path;
  }
  throw Error('A disk-backed fixture directory is required; set FREEDOM_RELEASE_TEST_DISK_ROOT');
}

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

function stagingFixture() {
  const original = { login: 'teddashh', id: OPERATORS.teddashh }, triggeredBy = { login: 'arumwu', id: OPERATORS.arumwu };
  const runId = 33, runAttempt = 2;
  const deployment = { id: 1, sha, environment: 'staging-next', payload: {
    format: 'freedom.shared-release/v1', operatorImage: installation.image, configSha256: '3'.repeat(64),
    controllerSha: main, runId, runAttempt, actor: original, triggeredBy } };
  const run = { id: runId, run_attempt: runAttempt, workflow_id: 3, path: '.github/workflows/shared-release.yml',
    event: 'workflow_dispatch', repository: { id: REPOSITORY_ID }, head_repository: { id: REPOSITORY_ID },
    head_branch: 'main', head_sha: main, status: 'completed', conclusion: 'success', actor: original,
    triggering_actor: triggeredBy, run_started_at: new Date(0).toISOString(), updated_at: new Date(120000).toISOString() };
  const jobs = ['admission', 'deploy'].map(name => ({ name, run_id: runId, run_attempt: runAttempt,
    head_sha: main, status: 'completed', conclusion: 'success', steps: [
      { name: 'Execute the installed environment operator', status: 'completed', conclusion: 'success' },
      { name: 'Save public release receipt', status: 'completed', conclusion: 'success' }] }));
  const artifact = { id: 81, name: `release-result-${runId}-${runAttempt}`, expired: false, digest: 'sha256:' + '4'.repeat(64),
    size_in_bytes: 500, workflow_run: { id: runId, repository_id: REPOSITORY_ID, head_repository_id: REPOSITORY_ID,
      head_sha: main, head_branch: 'main' } };
  const receipt = { ...request(), format: 'freedom.shared-release/v1', status: 'passed',
    providerOutcome: 'release_and_recovery_confirmed', operatorEvidence: 'validated-seven-phases/v1',
    sourceTree: tree, target: 'staging-next', mode: 'deploy', runId, runAttempt, deploymentId: 1,
    operatorImage: installation.image, configSha256: deployment.payload.configSha256, original, triggeredBy,
    completedAt: new Date(90000).toISOString(), phases: resultFixture().phases.map(({ name, status, startedAt, completedAt }) =>
      ({ name, status, startedAt, completedAt })) };
  const state = { deployment, run, jobs, artifact, receipt, statuses: [{ state: 'success',
    log_url: `https://github.com/${REPOSITORY}/actions/runs/${runId}/attempts/${runAttempt}` }],
    artifacts: [artifact], deployments: [deployment], reads: 0, calls: [] };
  const api = async path => {
    state.calls.push(path);
    if (path.includes('/deployments?')) return state.deployments;
    if (path.includes('/statuses?')) return state.statuses;
    if (path.endsWith('/workflows/shared-release.yml')) return { id: 3, path: '.github/workflows/shared-release.yml', state: 'active' };
    if (path.endsWith('/actions/runs/33')) return state.run;
    if (path.includes('/compare/')) return { status: 'ahead', merge_base_commit: { sha: main } };
    if (path.includes('/jobs?')) return { total_count: state.jobs.length, jobs: state.jobs };
    if (path.includes('/artifacts?')) return { total_count: state.artifacts.length, artifacts: state.artifacts };
    throw Error('Unexpected staging fixture path');
  };
  api.readArtifact = async actual => { state.reads++; assert.equal(actual.id, state.artifact.id); return state.receipt; };
  return { state, api, admission: { ...request(), target: 'next', sourceTree: tree, mainShaObserved: main } };
}

test('production authenticates latest staging workflow, exact attempt, controller, artifact and all successful phases', async () => {
  const { api, state, admission } = stagingFixture();
  assert.deepEqual(await requireStaging(api, admission, installation), { deploymentId: 1, runId: 33, runAttempt: 2,
    controllerSha: main, artifactId: 81, artifactDigest: state.artifact.digest });
  assert.equal(state.reads, 1);
  assert.equal(state.calls.filter(path => path.endsWith('/actions/runs/33')).length, 2);
  assert.equal(state.calls.filter(path => path.includes('/deployments?')).length, 2);
});

test('matching caller-written Deployment and success without a trusted workflow/artifact never authorize production', async () => {
  const { state, admission } = stagingFixture();
  const manufactured = async path => path.includes('/statuses?') ? state.statuses
    : path.includes('/deployments?') ? state.deployments : {};
  await assert.rejects(requireStaging(manufactured, admission, installation), { code: 'release_staging_workflow_invalid' });
  const fixture = stagingFixture(); fixture.state.artifacts = [];
  await assert.rejects(requireStaging(fixture.api, fixture.admission, installation), { code: 'release_staging_artifact_invalid' });
});

test('wrong workflow, branch, repository, event, controller, actors and changed rerun cannot authenticate staging', async () => {
  for (const patch of [{ workflow_id: 77 }, { path: '.github/workflows/forged.yml' }, { event: 'push' },
    { head_branch: 'other' }, { head_sha: sha }, { repository: { id: 2 } }, { head_repository: { id: 2 } },
    { run_attempt: 3 }, { status: 'in_progress' }, { conclusion: 'failure' },
    { actor: { login: 'someone', id: 999 } }, { triggering_actor: { login: 'arumwu', id: 999 } }]) {
    const fixture = stagingFixture(); Object.assign(fixture.state.run, patch);
    await assert.rejects(requireStaging(fixture.api, fixture.admission, installation), { code: 'release_staging_run_invalid' });
    assert.equal(fixture.state.reads, 0);
  }
});

test('plan-only/skipped execution, stale/wrong-run/expired or duplicate artifacts cannot supply staging evidence', async () => {
  const mutations = [state => { state.jobs[1].conclusion = 'skipped'; },
    state => { state.jobs[1].steps[0].conclusion = 'skipped'; }, state => { state.jobs[0].run_attempt = 1; },
    state => { state.artifact.workflow_run.id = 44; }, state => { state.artifact.workflow_run.head_sha = sha; },
    state => { state.artifact.workflow_run.repository_id = 2; }, state => { state.artifact.name = 'release-result-33-1'; },
    state => { state.artifact.expired = true; }, state => { delete state.artifact.digest; },
    state => { state.artifacts.push({ ...state.artifact, id: 82 }); }];
  for (const mutate of mutations) {
    const fixture = stagingFixture(); mutate(fixture.state);
    await assert.rejects(requireStaging(fixture.api, fixture.admission, installation)); assert.equal(fixture.state.reads, 0);
  }
});

test('artifact receipt must bind the deployment, source, operator, config, actors and seven ordered completed phases', async () => {
  for (const patch of [{ status: 'plan_passed' }, { providerOutcome: 'unknown_until_confirmed' }, { operatorEvidence: undefined },
    { sourceSha: main }, { sourceTree: sha }, { controllerSha: sha }, { target: 'next' }, { mode: 'plan' },
    { runId: 44 }, { runAttempt: 1 }, { deploymentId: 2 }, { operatorImage: 'other' }, { configSha256: '0'.repeat(64) },
    { original: { login: 'Hao0321', id: OPERATORS.Hao0321 } }, { phases: [] }, { completedAt: new Date(0).toISOString() }]) {
    const fixture = stagingFixture(); Object.assign(fixture.state.receipt, patch);
    await assert.rejects(requireStaging(fixture.api, fixture.admission, installation), { code: 'release_staging_receipt_invalid' });
  }
  for (const mutate of [phases => phases.reverse(), phases => { phases[2].status = 'failed'; },
    phases => { phases[4].startedAt = new Date(0).toISOString(); }]) {
    const fixture = stagingFixture(); mutate(fixture.state.receipt.phases);
    await assert.rejects(requireStaging(fixture.api, fixture.admission, installation), { code: 'release_staging_receipt_invalid' });
  }
});

test('newer failed staging and a rerun started while reading the artifact defeat prior success', async () => {
  const fixture = stagingFixture(); fixture.state.deployments.push({ ...fixture.state.deployment, id: 2 });
  fixture.state.statuses = [{ state: 'failure' }];
  await assert.rejects(requireStaging(fixture.api, fixture.admission, installation), { code: 'release_staging_not_successful' });
  const rerun = stagingFixture();
  rerun.api.readArtifact = async () => { rerun.state.run.run_attempt++; return rerun.state.receipt; };
  await assert.rejects(requireStaging(rerun.api, rerun.admission, installation), { code: 'release_staging_run_invalid' });
  const newer = stagingFixture();
  newer.api.readArtifact = async () => { newer.state.deployments.push({ ...newer.state.deployment, id: 2 }); return newer.state.receipt; };
  await assert.rejects(requireStaging(newer.api, newer.admission, installation), { code: 'release_staging_evidence_changed' });
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
  const calls = [], credentials = { cloudflareApiToken: 'fixture-token', migrationDatabaseUrl: 'fixture-db', runtimeDatabaseUrl: 'fixture-runtime', backupDatabaseUrl: 'fixture-backup',
    stagingAccessClientId: 'fixture-access-id', stagingAccessClientSecret: 'fixture-access-secret' };
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'run') {
      const input = await readFile(join(temporaryRoot, 'input/request.json'), 'utf8');
      assert.equal((await stat(join(temporaryRoot, 'input/credentials.json'))).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(await readFile(join(temporaryRoot, 'input/credentials.json'), 'utf8')), credentials);
      if (outcome.startsWith('interrupted')) throw Error('secret token in provider error');
      if (outcome === 'symlink') await symlink(join(temporaryRoot, 'input/credentials.json'), join(temporaryRoot, 'output/result.json'));
      else await writeFile(join(temporaryRoot, 'output/result.json'), JSON.stringify(resultFixture(request(), hash(input))));
    }
    if (args[0] === 'rm' && outcome.endsWith('cleanup-failed')) throw Error('cleanup failure');
    if (args[0] === 'pull' && outcome === 'pull-failed') throw Error('pull failure');
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
  await assert.rejects(stat(join(fixture.temporaryRoot, 'work')));
  const args = operatorCommand(installation.image, '/source', '/private', '/output', 'release-fixture', '/disk-work');
  assert.ok(args.includes('--read-only')); assert.ok(args.includes('--cap-drop=ALL'));
  assert.ok(args.includes('type=bind,src=/source,dst=/release/source,readonly'));
  assert.ok(args.includes('type=bind,src=/disk-work,dst=/release/work'));
});

test('an interrupted release is not retried and private input/output are removed', async t => {
  const fixture = await operatorFixture(t, 'interrupted');
  await assert.rejects(runOperator(fixture.options));
  assert.deepEqual(fixture.calls.map(call => call[1]), ['pull', 'run', 'rm']);
  await assert.rejects(stat(join(fixture.temporaryRoot, 'input')));
  await assert.rejects(stat(join(fixture.temporaryRoot, 'output')));
  await assert.rejects(stat(join(fixture.temporaryRoot, 'work')));
});

test('remote PostgreSQL credentials bind the expected role/database and require full TLS verification', () => {
  const target = { database: 'fp_target', role: 'fp_target_backup' };
  const uri = 'postgresql://fp_target_backup:fixture-password@db.example.invalid:5432/fp_target?sslmode=verify-full';
  const env = remotePostgresEnvironment(uri, target);
  assert.equal(env.PGSSLMODE, 'verify-full'); assert.equal(env.PGSSLROOTCERT, 'system');
  assert.equal(env.PGDATABASE, 'fp_target'); assert.equal(env.PGUSER, 'fp_target_backup');
  const login = 'fp_target_backup.branch-fixture';
  const branched = uri.replace('fp_target_backup:', login + ':');
  assert.equal(remotePostgresEnvironment(branched, { ...target, login }).PGUSER, login);
  assert.throws(() => remotePostgresEnvironment(branched, target));
  assert.throws(() => remotePostgresEnvironment(branched.replace('branch-fixture', 'other-branch'), { ...target, login }));
  for (const bad of [uri.replace('verify-full', 'require'), uri.replace('verify-full', 'disable'),
    uri.replace('/fp_target?', '/other?'), uri.replace('fp_target_backup:', 'other:'),
    uri + '&options=-csearch_path=other', uri + '&host=elsewhere', uri + '&sslmode=disable', uri + '#fragment',
    'postgresql://fp_target_backup:%xx@db.example.invalid:5432/fp_target?sslmode=verify-full', 'postgresql://fp_target_backup:%00@db.example.invalid:5432/fp_target?sslmode=verify-full'])
    assert.throws(() => remotePostgresEnvironment(bad, target));
});

test('native process output is bounded, private, create-only and does not expose provider stderr', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fp-process-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'dump');
  const result = await runPostgresProcess(process.execPath, ['-e', "process.stdout.write('PGDMPfixture')"], { output, maxBytes: 1024 });
  assert.equal(result.prefix, 'PGDMP'); assert.equal(result.sha256, hash('PGDMPfixture'));
  assert.equal(result.text, undefined); assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(runPostgresProcess(process.execPath, ['-e', "process.stdout.write('overwritten')"], { output }), { code: 'EEXIST' });
  assert.equal(await readFile(output, 'utf8'), 'PGDMPfixture');
  await assert.rejects(runPostgresProcess(process.execPath, ['-e', "process.stderr.write('private-password');process.exit(1)"], {}),
    { code: 'release_pg_process_failed', message: 'release_pg_process_failed' });
  await assert.rejects(runPostgresProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(4096))"], { maxBytes: 1024 }),
    { code: 'release_pg_output_limit' });
});

test('native process timeouts and aborts terminate the owned process without an automatic retry', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fp-process-stop-')); t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'pid');
  await assert.rejects(runPostgresProcess(process.execPath, ['-e', 'process.stdout.write(String(process.pid));setInterval(()=>{},1000)'],
    { output, timeoutMs: 300 }), { code: 'release_pg_process_timeout' });
  const pid = Number(await readFile(output, 'utf8')); assert.ok(pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runPostgresProcess(process.execPath, ['-e', 'process.exit(0)'], { signal: controller.signal }));
  await assert.rejects(runPostgresProcess(process.execPath, ['-e', 'process.exit(0)'], { connection: { PGOPTIONS: 'unsafe' } }),
    { code: 'release_pg_environment_invalid' });
});

test('native dump rejects malformed snapshot identities and mismatched targets before opening a process', async () => {
  let calls = 0; const execute = async () => { calls++; throw Error('unexpected process'); };
  for (const snapshotId of ['', '--help', '1;DROP TABLE t', '1-1-0', '$(id)'])
    await assert.rejects(writeSnapshotDump({ binDirectory: '/usr/local/bin', connection: { PGDATABASE: 'fp_target' },
      input: { database: 'fp_target', schema: 'public', snapshotId }, execute }), { code: 'release_pg_snapshot_invalid' });
  await assert.rejects(writeSnapshotDump({ binDirectory: '/usr/local/bin', connection: { PGDATABASE: 'other' },
    input: { database: 'fp_target', schema: 'public', snapshotId: '00000001-00000001-1' }, execute }));
  assert.equal(calls, 0);
});

test('receipt symlinks and failed container cleanup cannot yield successful releases', async t => {
  for (const outcome of ['symlink', 'cleanup-failed', 'interrupted-cleanup-failed', 'pull-failed']) {
    const fixture = await operatorFixture(t, outcome);
    await assert.rejects(runOperator(fixture.options), outcome.endsWith('cleanup-failed')
      ? { code: 'release_operator_cleanup_unconfirmed' } : undefined);
    await assert.rejects(stat(join(fixture.temporaryRoot, 'input')));
    if (outcome.endsWith('cleanup-failed')) assert.equal((await stat(join(fixture.temporaryRoot, 'work'))).mode & 0o777, 0o700);
    else await assert.rejects(stat(join(fixture.temporaryRoot, 'work')));
    if (outcome === 'pull-failed') assert.deepEqual(fixture.calls.map(call => call[1]), ['pull']);
  }
});

const cfConfig = { accountId: '1'.repeat(32), target: 'staging-next', mediaBucket: 'fixture-media',
  backupBucket: 'fixture-backup', token: 'fixture-provider-token' };
const cfJson = result => Response.json({ success: true, result });
const setId = '11111111-1111-4111-8111-111111111111';

test('Cloudflare reads stay on the fixed provider and reject redirects/errors without exposing private responses', async () => {
  const calls = [];
  const transport = createCloudflareRecoveryTransport({ ...cfConfig, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return new Response('private-provider-diagnostic', { status: 403 });
  } });
  await assert.rejects(transport.readWorkerState(), { code: 'release_cloudflare_read_failed', message: 'release_cloudflare_read_failed' });
  assert.equal(calls.length, 1); assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${cfConfig.accountId}/workers/scripts/freedom-platform-staging-next/settings`);
  assert.throws(() => createCloudflareRecoveryTransport({ ...cfConfig, mediaBucket: '../other' }));
  assert.throws(() => createCloudflareRecoveryTransport({ ...cfConfig, backupBucket: cfConfig.mediaBucket }));
  await assert.rejects(boundedResponseBytes(new Response('oversized'), 2), { code: 'release_cloudflare_response_limit' });
});

test('Worker observation requires an exact release and keeps flags/bindings in a stable comparison digest', async () => {
  let bindings = [{ name: 'FREEDOM_RELEASE_SHA', type: 'plain_text', text: sha },
    { name: 'FEATURE_CHECKOUT', type: 'plain_text', text: 'false' }, { name: 'PRIVATE_TOKEN', type: 'secret_text' }];
  const transport = createCloudflareRecoveryTransport({ ...cfConfig, fetchImpl: async () => cfJson({ bindings }) });
  const before = await transport.readWorkerState(); assert.equal(before.sourceSha, sha);
  bindings = [...bindings].reverse().map(binding => ({ ...binding,
    ...(binding.name === 'FREEDOM_RELEASE_SHA' ? { text: main } : {}) }));
  const after = await transport.readWorkerState(); assert.equal(after.sourceSha, main);
  assert.equal(after.bindingsSha256, before.bindingsSha256);
  bindings.find(binding => binding.name === 'FEATURE_CHECKOUT').text = 'true';
  assert.notEqual((await transport.readWorkerState()).bindingsSha256, before.bindingsSha256);
  bindings.push({ name: 'FREEDOM_ASSET_MAINTENANCE_ENABLED', type: 'plain_text', text: 'true' });
  await assert.rejects(transport.readWorkerState(), { code: 'release_worker_maintenance_enabled' });
  bindings = [{ name: 'FREEDOM_RELEASE_SHA', type: 'plain_text', text: 'main' }];
  await assert.rejects(transport.readWorkerState(), { code: 'release_worker_source_invalid' });
  bindings = [null]; await assert.rejects(transport.readWorkerState(), { code: 'release_worker_bindings_invalid' });
});

test('source media is read-only and full bytes must match its metadata before entering the backup', async () => {
  const key = 'assets/fixture', bytes = Buffer.from('media-bytes'); let corrupt = false, queried = 0;
  const transport = createCloudflareRecoveryTransport({ ...cfConfig, fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET'); queried++;
    if (url.includes('?')) {
      assert.equal(new URL(url).searchParams.get('prefix'), key);
      return cfJson([{ key, size: bytes.length, etag: 'fixture-etag', http_metadata: { contentType: 'image/webp' },
        custom_metadata: { format: 'freedom.asset/v1', sha256: hash(bytes), transform_version: 'v1', policy_revision: 'v1' } }]);
    }
    return new Response(corrupt ? Buffer.alloc(bytes.length) : bytes);
  } });
  const store = transport.sourceObjects({ assertObjectKey: value => assert.equal(value, key),
    validateMetadata: metadata => assert.equal(metadata.contentType, 'image/webp') });
  assert.equal(await new Response((await store.get(key)).body).text(), bytes.toString());
  corrupt = true; await assert.rejects(store.get(key), { code: 'release_object_digest_mismatch' });
  const before = queried;
  await assert.rejects(store.putImmutable(), { code: 'release_source_media_readonly' });
  await assert.rejects(store.delete(), { code: 'release_source_media_readonly' });
  await assert.rejects(store.get(key, { offset: 0, length: 1 }), { code: 'release_object_range_unsupported' });
  await assert.rejects(store.get('../other')); assert.equal(queried, before);
});

test('archive publication records durable intent before one PUT, then reads all bytes back without trusting the upload response', async t => {
  const intentDirectory = await diskFixture(t, 'fp-archive-intent-');
  const events = [], original = Buffer.from('sealed-recovery-set'), bytes = Buffer.from(original); let uploaded;
  const fetchImpl = async (url, options) => {
    const file = join(intentDirectory, `staging-next-${setId}.json`);
    const intent = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(intent.sha256, hash(original)); assert.equal(intent.atomicCreateOnly, false);
    assert.equal(intent.automaticRetry, false); assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.match(url, /\/fixture-backup\/objects\/daily-v2\/staging\/[a-f0-9-]+\.tar$/);
    events.push(options.method);
    if (options.method === 'PUT') { uploaded = Buffer.from(options.body); return new Response('ok'); }
    return uploaded ? new Response(uploaded) : new Response('absent', { status: 404 });
  };
  const transport = createCloudflareRecoveryTransport({ ...cfConfig, fetchImpl });
  const pending = transport.publishArchive({ setId, bytes, intentDirectory });
  bytes.fill(0); const result = await pending;
  assert.deepEqual(events, ['GET', 'PUT', 'GET']);
  assert.deepEqual(uploaded, original); assert.deepEqual(result.bytes, original);
  assert.deepEqual(result.publication, { mode: 'unique_single_writer', atomicCreateOnly: false });
  await assert.rejects(transport.publishArchive({ setId, bytes, intentDirectory }), { code: 'release_archive_retry_forbidden' });
  const restarted = createCloudflareRecoveryTransport({ ...cfConfig, fetchImpl });
  await assert.rejects(restarted.publishArchive({ setId, bytes, intentDirectory }), { code: 'release_archive_intent_exists' });
  assert.equal(events.length, 3);
});

test('existing archive, failed durable intent and lost PUT response cannot cause overwrite or retry', async t => {
  for (const failure of ['exists', 'intent', 'lost-response', 'readback']) {
    const root = await diskFixture(t, 'fp-archive-failure-');
    const intentDirectory = failure === 'intent' ? join(root, 'missing-directory') : root;
    const events = []; let uploaded = false;
    const transport = createCloudflareRecoveryTransport({ ...cfConfig, fetchImpl: async (url, options) => {
      events.push(options.method);
      if (options.method === 'PUT') {
        uploaded = true;
        if (failure === 'lost-response') throw Error('private connection diagnostic');
        return new Response('ok');
      }
      if (uploaded) return new Response('bad');
      return new Response('existing', { status: failure === 'exists' ? 200 : 404 });
    } });
    const args = { setId, bytes: Buffer.from('tar'), intentDirectory };
    const codes = { exists: 'release_archive_key_not_absent', intent: 'release_archive_intent_failed',
      'lost-response': 'release_archive_upload_unknown', readback: 'release_archive_readback_mismatch' };
    await assert.rejects(transport.publishArchive(args), codes[failure] ? { code: codes[failure] } : undefined);
    await assert.rejects(transport.publishArchive(args), { code: 'release_archive_retry_forbidden' });
    assert.deepEqual(events, failure === 'readback' ? ['GET', 'PUT', 'GET']
      : failure === 'lost-response' ? ['GET', 'PUT'] : failure === 'intent' ? [] : ['GET']);
  }
});

test('public health retries only bounded unauthenticated GETs and requires the selected exact source', async () => {
  const observations = [], calls = [], waits = [];
  const result = await waitForPublicRelease({ target: 'next', sourceSha: sha,
    sleep: async ms => waits.push(ms), record: async value => observations.push(value),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ status: 'ok', release_sha: calls.length === 1 ? main : sha, private: 'not-published' });
    } });
  assert.equal(result.attempts, 2); assert.deepEqual(waits, [15000]);
  assert.deepEqual(observations.map(value => value.matched), [false, true]);
  assert.ok(!JSON.stringify(observations).includes('private'));
  for (const { url, options } of calls) {
    assert.equal(url, 'https://freetwai.com/api/v1/health'); assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, undefined);
  }
  let failed = 0;
  await assert.rejects(waitForPublicRelease({ target: 'next', sourceSha: sha, sleep: async () => {},
    fetchImpl: async () => { failed++; return Response.json({ status: 'ok', release_sha: sha }, { status: 503 }); } }),
  { code: 'release_health_source_not_propagated' });
  assert.equal(failed, 10);
});

test('staging health requires Access credentials only for its fixed origin and never follows a login redirect', async () => {
  const access = { clientId: 'fixture-access-id', clientSecret: 'fixture-access-secret' };
  let requests = 0; const observations = [];
  const fetchImpl = async (url, options) => {
    requests++; assert.equal(url, 'https://staging.freetwai.com/api/v1/health'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['CF-Access-Client-Id'], access.clientId);
    assert.equal(options.headers['CF-Access-Client-Secret'], access.clientSecret);
    assert.equal(options.headers.Authorization, undefined);
    return requests === 1 ? new Response('private login response', { status: 302, headers: { Location: 'https://other.example' } })
      : Response.json({ status: 'ok', release_sha: sha });
  };
  await assert.rejects(waitForPublicRelease({ target: 'staging-next', sourceSha: sha, fetchImpl }), { code: 'release_staging_access_required' });
  await assert.rejects(waitForPublicRelease({ target: 'next', sourceSha: sha, access, fetchImpl }), { code: 'release_health_access_target_invalid' });
  assert.equal(requests, 0);
  const result = await waitForPublicRelease({ target: 'staging-next', sourceSha: sha, access, fetchImpl,
    sleep: async () => {}, record: async value => observations.push(value) });
  assert.equal(result.attempts, 2); assert.equal(observations[0].matched, false);
  assert.ok(!JSON.stringify(observations).includes('fixture-access'));
});

function zipFixture(entries, symlink = false) {
  return execFileSync('python3', ['-I', '-c', `import io,json,sys,zipfile
value=json.load(sys.stdin); output=io.BytesIO()
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as archive:
 for name,text in value['entries']:
  info=zipfile.ZipInfo(name);info.compress_type=zipfile.ZIP_DEFLATED
  info.external_attr=(0o120777 if value['symlink'] else 0o100600)<<16
  with archive.open(info,'w',force_zip64=True) as stream: stream.write(text.encode())
sys.stdout.buffer.write(output.getvalue())`], { input: JSON.stringify({ entries, symlink }), maxBuffer: 1_000_000 });
}

test('artifact receipt decoding bounds decompression, rejects paths/duplicates/symlinks and never extracts files', () => {
  const bytes = zipFixture([['receipt.json', '{"status":"passed"}']]);
  assert.deepEqual(decodeReceiptArchive(bytes), { status: 'passed' });
  const invalid = [Buffer.from('not zip'), bytes.subarray(0, 35), zipFixture([['../receipt.json', '{}']]),
    zipFixture([['receipt.json', '{}'], ['receipt.json', '{}']]), zipFixture([['receipt.json', '{}']], true),
    zipFixture([['receipt.json', 'x'.repeat(100000)]]), zipFixture([['receipt.json', 'not JSON']])];
  for (const value of invalid) assert.throws(() => decodeReceiptArchive(value), { code: 'release_staging_archive_invalid' });
});

test('GitHub artifact download validates metadata digest and does not forward the job token to the artifact host', async () => {
  const bytes = zipFixture([['receipt.json', '{"status":"passed"}']]);
  const artifact = { id: 81, size_in_bytes: bytes.length, digest: 'sha256:' + hash(bytes) };
  const calls = [];
  const api = githubClient('fixture-token', async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 302,
      headers: { Location: 'https://fixture.blob.core.windows.net/results/artifact.zip?sig=private-link' } }) : new Response(bytes);
  });
  assert.deepEqual(await api.readArtifact(artifact), { status: 'passed' });
  assert.equal(calls[0].url, `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/81/zip`);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[1].options.headers, undefined); assert.equal(calls[1].options.redirect, 'error');
});

test('artifact redirects, changed bytes, oversized archives and expired downloads are rejected without exposing URLs', async () => {
  const bytes = zipFixture([['receipt.json', '{}']]);
  const artifact = { id: 81, size_in_bytes: bytes.length, digest: 'sha256:' + hash(bytes) };
  for (const scenario of ['origin', 'userinfo', 'insecure', 'redirect', 'digest', 'size', 'expired']) {
    let calls = 0;
    const api = githubClient('fixture-token', async () => {
      calls++;
      if (calls === 1) {
        if (scenario === 'expired') return new Response('private provider diagnostic', { status: 410 });
        const location = scenario === 'origin' ? 'https://evil.example/secret' : scenario === 'userinfo'
          ? 'https://username:password@fixture.blob.core.windows.net/secret' : scenario === 'insecure'
            ? 'http://fixture.blob.core.windows.net/secret' : 'https://fixture.blob.core.windows.net/secret';
        return new Response(null, { status: 302, headers: { Location: location } });
      }
      if (scenario === 'redirect') return new Response('login', { status: 302, headers: { Location: 'https://other.example' } });
      return new Response(scenario === 'digest' ? Buffer.alloc(bytes.length) : scenario === 'size' ? Buffer.alloc(1_000_001) : bytes);
    });
    await assert.rejects(api.readArtifact(artifact), error => /^release_staging_[a-z_]+$/.test(error.message));
    if (['origin', 'userinfo', 'insecure', 'expired'].includes(scenario)) assert.equal(calls, 1);
  }
});

test('config pin/target drift and missing credentials stop before Docker or provider work', async t => {
  const fixture = await operatorFixture(t);
  for (const patch of [{ config: '{}' }, { credentials: {} }, { config: undefined }])
    await assert.rejects(runOperator({ ...fixture.options, ...patch }));
  assert.equal(fixture.calls.length, 0);
  await assert.rejects(runOperator({ ...fixture.options, credentials: { ...fixture.options.credentials,
    stagingAccessClientSecret: undefined } }), { code: 'release_staging_access_required' });
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

test('backup TAR round trip preserves private bytes and refuses links at the source', async t => {
  const root = await diskFixture(t, 'fp-tar-'), local = join(root, 'local'), remote = join(root, 'remote');
  await mkdir(local, { mode: 0o700 }); await mkdir(remote, { mode: 0o700 });
  await newBackupDirectories(local);
  await writeFile(join(local, 'control.json'), '{"format":"synthetic"}', { mode: 0o600 });
  await writeFile(join(local, 'sealed/database.dump'), Buffer.from('PGDMP synthetic'), { mode: 0o600 });
  const bytes = await backupTar('pack', local);
  await backupTar('unpack', remote, bytes);
  assert.deepEqual(await readFile(join(remote, 'sealed/database.dump')), Buffer.from('PGDMP synthetic'));
  assert.equal((await stat(join(remote, 'sealed/database.dump'))).mode & 0o777, 0o600);
  await assert.rejects(backupTar('unpack', remote, bytes), /release_backup_archive_failed/);
  await symlink(join(local, 'control.json'), join(local, 'objects/link'));
  await assert.rejects(backupTar('pack', local), /release_backup_archive_failed/);
});

function fixtureTar(entries) {
  return execFileSync('/usr/bin/python3', ['-I', '-c', `import io,json,sys,tarfile
data=json.load(sys.stdin); output=io.BytesIO()
with tarfile.open(fileobj=output,mode='w') as archive:
 for entry in data:
  member=tarfile.TarInfo(entry['name']); body=entry.get('body','fixture').encode()
  if entry.get('link'):
   member.type=tarfile.SYMTYPE; member.linkname=entry['link']; archive.addfile(member)
  else:
   member.size=len(body); archive.addfile(member,io.BytesIO(body))
sys.stdout.buffer.write(output.getvalue())`], { input: JSON.stringify(entries), maxBuffer: 1_000_000 });
}

test('downloaded TAR rejects traversal, symlinks, duplicate names and file/directory collisions before extraction', async t => {
  const root = await diskFixture(t, 'fp-bad-tar-'); let index = 0;
  for (const entries of [
    [{ name: '../escape' }], [{ name: '/tmp/escape' }], [{ name: 'objects/link', link: '../control.json' }],
    [{ name: 'objects/same' }, { name: 'objects/same' }], [{ name: 'objects/parent' }, { name: 'objects/parent/child' }],
    [{ name: 'secrets/credential.json' }],
  ]) {
    const directory = join(root, String(index++)); await mkdir(directory, { mode: 0o700 });
    await assert.rejects(backupTar('unpack', directory, fixtureTar([{ name: 'control.json' }, ...entries])), /release_backup_archive_failed/);
    await assert.rejects(stat(join(directory, 'control.json')), { code: 'ENOENT' });
  }
});

test('backup object member binds bytes and metadata atomically and never overwrites or deletes', async () => {
  const files = new Map();
  const archive = { async putIfAbsent(key, body) {
    const bytes = Buffer.from(await new Response(body).arrayBuffer());
    if (files.has(key)) return 'exists'; files.set(key, bytes); return 'created';
  }, async get(key) { return files.has(key) ? bytesStream(files.get(key)) : null; } };
  const store = backupObjectStore(archive, {
    assertObjectKey: key => assert.equal(key, 'v1/scope/asset/representation'),
    validateMetadata: metadata => { assert.equal(typeof metadata.sha256, 'string'); assert(Number.isInteger(metadata.byteSize)); },
  });
  const key = 'v1/scope/asset/representation', bytes = Buffer.from('synthetic object');
  const metadata = { byteSize: bytes.length, sha256: hash(bytes) };
  assert.equal(await store.putImmutable(key, { bytes, metadata }), 'created');
  assert.equal(await store.putImmutable(key, { bytes, metadata }), 'exists');
  assert.deepEqual(Buffer.from(await new Response((await store.get(key)).body).arrayBuffer()), bytes);
  await assert.rejects(store.putImmutable(key, { bytes: Buffer.from('wrong'), metadata }), /release_backup_object_invalid/);
  await assert.rejects(store.delete(key), /release_backup_delete_forbidden/);
  files.get(key)[files.get(key).length - 1] ^= 1;
  await assert.rejects(store.get(key), /release_backup_object_invalid/);
});

test('uncertain capture-policy mutation must settle its exact backend before GC-off cleanup', async () => {
  let released, disabled = false, intentWritten = false;
  const client = { on() {}, removeListener() {}, release(destroy) { released = destroy; },
    async query(input) {
      if (input.text.startsWith('SELECT set_config')) return { rows: [] };
      if (input.text.startsWith('SELECT current_database')) return { rows: [{ database: 'fixture', role: 'operator', session_role: 'operator', pid: 4321 }] };
      assert(intentWritten); throw Error('synthetic unknown commit');
    } };
  const pool = { async connect() { return client; }, async query(input, values) {
    const text = input.text ?? input;
    if (text.startsWith('SELECT pid FROM pg_stat_activity')) { assert.deepEqual(values.slice(0, 3), [4321, 'fixture', 'operator']); return { rows: [{ pid: 4321 }] }; }
    if (text.startsWith('SELECT pg_terminate_backend')) return { rows: [{ stopped: false }] };
    disabled = true; throw Error('must not disable while an earlier UPDATE can still commit');
  } };
  const policy = await openCapturePolicy({ pool, database: 'fixture', role: 'operator',
    lease: { signal: new AbortController().signal, assertHeld() {} },
    revision: 'shared-backup-11111111-1111-1111-1111-111111111111', before: 'a'.repeat(64),
    intent: { async putIfAbsent() { intentWritten = true; return 'created'; } } });
  await assert.rejects(policy.enable(), /synthetic unknown commit/); assert.equal(released, true);
  await assert.rejects(policy.cleanup(), /release_capture_policy_unsettled/); assert.equal(disabled, false);
  await assert.rejects(policy.enable(), /release_capture_policy_retry_forbidden/);
});

test('capture policy refuses a new enable after ownership is lost during intent persistence or before enable', async () => {
  for (const point of ['intent', 'before-enable', 'ownership-check']) {
    const controller = new AbortController(); let enables = 0, released = 0, held = true;
    const lease = { signal: controller.signal, assertHeld() { if (!held) throw Error('synthetic ownership lost'); } };
    const client = { on() {}, removeListener() {}, release() { released++; }, async query(input) {
      if (input.text.startsWith('SELECT set_config')) return { rows: [] };
      if (input.text.startsWith('SELECT current_database')) return { rows: [{ database: 'fixture', role: 'operator', session_role: 'operator', pid: 4321 }] };
      if (input.text.includes('SET enabled=true')) enables++;
      throw Error('enable UPDATE must not be submitted');
    } };
    const policy = await openCapturePolicy({ pool: { async connect() { return client; } }, lease,
      database: 'fixture', role: 'operator', revision: 'shared-backup-11111111-1111-1111-1111-111111111111', before: 'a'.repeat(64),
      intent: { async putIfAbsent() { if (point === 'intent') controller.abort(Error('synthetic setup abort')); return 'created'; } } });
    if (point === 'before-enable') controller.abort(Error('synthetic setup abort'));
    if (point === 'ownership-check') held = false;
    await assert.rejects(policy.enable(), /synthetic (setup abort|ownership lost)/);
    assert.equal(enables, 0); assert.equal(released, 1);
    await assert.rejects(policy.enable(), /release_capture_policy_retry_forbidden/);
  }
});

async function deployFixture(t) {
  const workRoot = await diskFixture(t, 'fp-deploy-'), controller = new AbortController();
  const oldVersion = '11111111-1111-4111-8111-111111111111', newVersion = '22222222-2222-4222-8222-222222222222';
  const sourceSha = 'a'.repeat(40), previous = 'b'.repeat(40), worker = 'freedom-platform-staging-next';
  let published = false, polls = 0, cacheEnabled = false, failPoll = false;
  const bindings = source => [
    ...Object.entries({ APP_ORIGIN: 'https://staging.freetwai.com', FREEDOM_ENV: 'staging',
      FREEDOM_DATABASE_NAME: 'freedom_staging_next', FREEDOM_TRUST_CF_CONNECTING_IP: 'true',
      FREEDOM_RELEASE_SHA: source, FREEDOM_COMMERCE_CHECKOUT_ENABLED: 'false' }).map(([name, text]) => ({ name, text, type: 'plain_text' })),
    { name: 'ASSETS', type: 'assets' }, { name: 'IMAGES', type: 'images' },
    { name: 'HYPERDRIVE', type: 'hyperdrive', id: 'c'.repeat(32) },
    { name: 'EMAIL', type: 'send_email', allowed_sender_addresses: ['no-reply@mail.freetwai.com'] },
    { name: 'MEDIA', type: 'r2_bucket', bucket_name: 'fixture-media' },
    { name: 'GUIDE_STATIC', type: 'r2_bucket', bucket_name: 'fixture-guide' },
    { name: 'TOTP_ENCRYPTION_KEY', type: 'secret_text' },
  ];
  const runtime = { compatibility_date: '2026-09-21', compatibility_flags: ['nodejs_compat'], usage_model: 'standard',
    assets: { html_handling: 'auto-trailing-slash', not_found_handling: 'none', serve_directly: false, raw_run_worker_first: true, base_path: '/' } };
  const fetchImpl = async (address, options) => {
    const url = new URL(address); assert.equal(url.origin, 'https://api.cloudflare.com');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    let result;
    if (url.pathname.endsWith('/deployments')) {
      if (published) polls++;
      if (published && failPoll) { failPoll = false; throw Error('synthetic provider GET failure'); }
      result = { deployments: [{ versions: [{ version_id: published && polls > 1 ? newVersion : oldVersion, percentage: 100 }] }] };
    } else if (url.pathname.includes('/versions/')) {
      result = { resources: { bindings: bindings(url.pathname.endsWith(newVersion) ? sourceSha : previous),
        script_runtime: runtime, script: { placement: { mode: 'targeted', target: [{ id: 12, region: 'aws:ap-northeast-1', type: 'region' }] } } } };
    } else if (url.pathname.endsWith('/settings')) result = { bindings: bindings(published && polls > 1 ? sourceSha : previous), logpush: false, tail_consumers: [] };
    else if (url.pathname.endsWith('/schedules')) result = { schedules: [{ cron: '*/10 * * * *' }] };
    else if (url.pathname.endsWith('/subdomain')) result = { enabled: false, previews_enabled: false };
    else if (url.pathname.endsWith('/domains')) result = [];
    else if (url.pathname.endsWith('/routes')) result = [{ id: 'fixture-route', pattern: 'staging.freetwai.com/*', script: worker }];
    else if (url.pathname.includes('/hyperdrive/configs/')) result = { caching: { disabled: !cacheEnabled } };
    else throw Error('unexpected provider path');
    return new Response(JSON.stringify({ success: true, result }));
  };
  const deployer = createWorkerDeployer({ accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32), target: 'staging-next',
    token: 'synthetic-deploy-token', signal: controller.signal, fetchImpl });
  const before = await deployer.inspect();
  const source = parseJsonc(await readFile(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8'));
  return { deployer, before, sourceSha, oldVersion, newVersion, controller,
    args: { sourceSha, before, source, sourceRoot: '/fixture/source', workRoot,
      lease: { signal: controller.signal, assertHeld() { controller.signal.throwIfAborted(); } } },
    publish() { published = true; }, failNextPoll() { failPoll = true; }, enableCache() { cacheEnabled = true; } };
}

test('Worker publish preserves bindings/secrets/routes, records stale reads, and deploys once', async t => {
  const f = await deployFixture(t); let calls = 0, sleeps = 0;
  const config = renderWorkerConfig({ ...f.args, target: 'staging-next' });
  assert.equal(config.keep_vars, true); assert.deepEqual(config.routes, []);
  assert.equal(config.vars.FREEDOM_COMMERCE_CHECKOUT_ENABLED, 'false');
  assert.equal(config.vars.FREEDOM_RELEASE_SHA, f.sourceSha);
  assert(!('TOTP_ENCRYPTION_KEY' in config.vars));
  assert.deepEqual(config.alias, { sharp: '/fixture/source/packages/shared/sharp-unavailable.ts',
    './model-step-node-transport.js': '/fixture/source/modules/agent-execution/model-step-worker-transport-unavailable.ts' });
  const result = await f.deployer.publish({ ...f.args, async execute(input) {
    calls++; assert.equal(input.sourceSha, f.sourceSha);
    assert.deepEqual(JSON.parse(await readFile(input.configPath)), config);
    f.publish(); return { versionId: f.newVersion };
  }, async sleep(ms) { assert.equal(ms, 3000); sleeps++; } });
  assert.equal(calls, 1); assert.equal(sleeps, 1); assert.equal(result.observations, 2);
  assert.equal(result.providerConfirmed, true);
  assert.equal(JSON.parse(await readFile(join(f.args.workRoot, 'deploy-observation-1.json'))).matched, false);
  assert.equal(JSON.parse(await readFile(join(f.args.workRoot, 'deploy-observation-2.json'))).matched, true);
});

test('uncertain Worker publish is not retried and an existing intent refuses another mutation', async t => {
  const f = await deployFixture(t); let calls = 0;
  const execute = async () => { calls++; throw Error('synthetic lost provider reply'); };
  await assert.rejects(f.deployer.publish({ ...f.args, execute }), /synthetic lost provider reply/);
  assert.equal(JSON.parse(await readFile(join(f.args.workRoot, 'deploy-intent.json'))).automaticRetry, false);
  await assert.rejects(f.deployer.publish({ ...f.args, execute }), { code: 'EEXIST' });
  assert.equal(calls, 1);
});

test('Worker propagation retains a failed GET and retries only the read', async t => {
  const f = await deployFixture(t); let calls = 0;
  const result = await f.deployer.publish({ ...f.args, execute: async () => {
    calls++; f.publish(); f.failNextPoll(); return { versionId: f.newVersion };
  }, sleep: async () => {} });
  assert.equal(calls, 1); assert.equal(result.observations, 2);
  const first = JSON.parse(await readFile(join(f.args.workRoot, 'deploy-observation-1.json')));
  assert.equal(first.error, 'provider_observation_failed'); assert.equal(first.matched, false);
});

test('Worker admission refuses enabled Hyperdrive cache and cancelled ownership', async t => {
  const f = await deployFixture(t); f.enableCache();
  await assert.rejects(f.deployer.inspect(), /release_deploy_hyperdrive_cache_enabled/);
  f.controller.abort(Error('synthetic lease lost'));
  await assert.rejects(f.deployer.publish({ ...f.args, execute() { throw Error('must not publish'); } }), /synthetic lease lost/);
});

test('application build copies only the selected commit, binds outputs and rejects source/output drift', async t => {
  const f = await deployFixture(t), root = await diskFixture(t, 'fp-build-');
  const sourceRoot = join(root, 'source'); await mkdir(sourceRoot, { mode: 0o700 });
  await mkdir(join(sourceRoot, 'apps/platform-api/src'), { recursive: true });
  await writeFile(join(sourceRoot, 'apps/platform-api/src/worker.ts'), 'export default {};\n');
  await writeFile(join(sourceRoot, 'package.json'), '{"name":"synthetic-build","private":true}\n');
  await writeFile(join(sourceRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(join(sourceRoot, 'wrangler.jsonc'), JSON.stringify(f.args.source));
  await writeFile(join(sourceRoot, '.gitignore'), 'node_modules/\napps/portal-web/dist/\n');
  fixtureGit(sourceRoot, ['init', '-q', '-b', 'main']); fixtureGit(sourceRoot, ['add', '.']);
  fixtureGit(sourceRoot, ['commit', '-qm', 'Synthetic build source']);
  const sourceSha = fixtureGit(sourceRoot, ['rev-parse', 'HEAD']), sourceTree = fixtureGit(sourceRoot, ['rev-parse', 'HEAD^{tree}']);
  const calls = [];
  const execute = async (program, args, options) => {
    calls.push([program, args]);
    assert.deepEqual(Object.keys(options).sort(), ['cache', 'cwd', 'signal']);
    if (program === '/usr/bin/git') return execFileSync(program, args, { cwd: options.cwd,
      env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: 'ignore' });
    if (program === '/usr/local/bin/npm' && args[0] === 'ci') return;
    if (program === '/usr/local/bin/npm' && args[0] === 'run') {
      const dist = join(options.cwd, 'apps/portal-web/dist'); await mkdir(dist, { recursive: true });
      await writeFile(join(dist, 'index.html'), '<!doctype html><title>Synthetic</title>'); return;
    }
    assert.equal(program, process.execPath); assert(args.includes('--dry-run'));
    const out = args[args.indexOf('--outdir') + 1]; await mkdir(out); await writeFile(join(out, 'worker.js'), 'export default {};\n');
  };
  const built = await buildApplication({ sourceRoot, sourceSha, sourceTree, workRoot: root,
    target: 'staging-next', before: f.before, signal: f.controller.signal, execute });
  assert.equal(built.sourceSha, sourceSha); assert.notEqual(built.root, sourceRoot);
  assert.equal(built.providerMutation, false); assert.equal(calls.length, 6);
  await built.assertUnchanged();
  await writeFile(join(built.root, 'apps/portal-web/dist/index.html'), 'Changed');
  await assert.rejects(built.assertUnchanged(), /release_build_outputs_changed/);
  await symlink(join(sourceRoot, 'package.json'), join(built.root, 'apps/portal-web/dist/link'));
  await assert.rejects(directoryDigest(join(built.root, 'apps/portal-web/dist')), /release_build_output_invalid/);
  await writeFile(join(sourceRoot, 'apps/platform-api/src/worker.ts'), 'changed source');
  await assert.rejects(buildApplication({ sourceRoot, sourceSha, sourceTree, workRoot: root,
    target: 'staging-next', before: f.before, signal: f.controller.signal, execute }), /release_build_source_changed/);
  assert.equal(calls.length, 6);
});
