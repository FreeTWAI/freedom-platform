import { runPortableMigration, preparePortableMigration } from '../../shared-release/portable/migration.mjs';
import { deriveDisabledMaterialPolicyAdditions, appendDisabledMaterialPolicies } from '../../shared-release/portable/material-policy.mjs';
import { reconcileFailedBackup, adoptLegacyPredecessor } from '../../shared-release/portable/backup-recovery.mjs';
import { backupDiagnosticCode, isBackupDiagnosticCode } from '../../../packages/media-migration/backup-diagnostics.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, stat, symlink, realpath, statfs, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_FAILURE_CODES } from '../../shared-release/failure-codes.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { REPOSITORY, REPOSITORY_ID, OPERATORS, PHASES, requestFromEnvironment, admitRelease,
  admitInstallation, requireStaging, requireLegacyPredecessor, githubClient, releaseFailureCode, isReleaseFailureCode } from '../../shared-release/admission.mjs';
import { validateOperatorResult, validateBackupOperatorResult, operatorProgress, operatorCommand, runOperator, pullOperatorImage, quietCommand } from '../../shared-release/operator.mjs';
import { remotePostgresEnvironment, runPostgresProcess, writeSnapshotDump } from '../../shared-release/portable/postgres.mjs';
import { decodeReceiptArchive, artifactReader } from '../../shared-release/artifacts.mjs';
import { boundedResponseBytes, createCloudflareRecoveryTransport, waitForPublicRelease } from '../../shared-release/portable/cloudflare.mjs';
import { backupObjectStore, backupTar, bytesStream, newBackupDirectories } from '../../shared-release/portable/backup-storage.mjs';
import { openCapturePolicy } from '../../shared-release/portable/capture-policy.mjs';
import { createWorkerDeployer, renderWorkerConfig, assertReleasePredecessor } from '../../shared-release/portable/deploy.mjs';
import { readFlagDecisions, validateFlagDecisions, applyFlagDecisions, plannedFlagChanges, publicFlagChanges } from '../../shared-release/portable/flag-decisions.mjs';
import { backupExpectation } from '../../shared-release/portable/backup-expectation.mjs';
import { parseJsonc } from '../lib/wrangler.mjs';
import { buildApplication, directoryDigest } from '../../shared-release/portable/build.mjs';
import { git as fixtureGit } from './migration-fixtures.mjs';
import { createControlStore } from '../../shared-release/portable/control-store.mjs';
import { validateCoordinateAuthority, verifyCoordinateFence } from '../../shared-release/portable/coordinate-fence.mjs';
import { replayReleaseFloor, openReleaseFloor } from '../../shared-release/portable/floor.mjs';
import { migrationDigest, migrationLedgerDigest } from '../../../packages/db/migration-plan.mjs';
import { validatePortableConfig, portableConnections } from '../../shared-release/portable/config.mjs';
import { BACKUP_PHASES, BACKUP_CRON, backupRequestFromEnvironment, requireScheduledBackup, requireFailedBackup } from '../../shared-release/scheduled-admission.mjs';
import { admitImage } from '../../shared-release/image-admission.mjs';
import { checkEnvironment } from '../../shared-release/environment-check.mjs';
import { main as releaseMain } from '../../shared-release/cli.mjs';
import { requireFailedReleaseHandoff } from '../../shared-release/handoff-admission.mjs';
import { inspectReleaseHandoff, completeReleaseHandoff } from '../../shared-release/portable/handoff-recovery.mjs';

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

test('shared workflows use only GitHub-supported job environment contexts before runner allocation', async () => {
  const allowed = new Set(['github', 'needs', 'strategy', 'matrix', 'vars', 'secrets', 'inputs']);
  for (const name of ['shared-release', 'shared-backup', 'release-operator-image']) {
    const workflow = await readFile(new URL(`../../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    // These workflows use block mappings at the conventional four-space job
    // property indentation. This regression guard is not a full YAML validator.
    for (const [, jobEnv] of workflow.matchAll(/^    env:\n((?: {6}.*\n)*)/gm)) {
        for (const [, expression] of jobEnv.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
          for (const [, context] of expression.matchAll(/(?<![.\w])([a-z_]+)\./g)) assert(allowed.has(context), `${name}: ${context} is unavailable in jobs.<id>.env`);
        }
    }
  }
});
const environment = () => ({ GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: String(REPOSITORY_ID),
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/shared-release.yml@refs/heads/main`,
  CONTROLLER_SHA: main, RELEASE_SHA: sha, RELEASE_TARGET: 'staging-next', RELEASE_MODE: 'plan',
  GITHUB_ACTOR: 'teddashh', GITHUB_ACTOR_ID: String(OPERATORS.teddashh),
  GITHUB_TRIGGERING_ACTOR: 'arumwu', GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '2' });
// Retain legacy receipt/journal fixtures; independent coverage below is explicit.
const request = () => ({ ...requestFromEnvironment(environment()), releaseKind: undefined, admittedAt: new Date(0).toISOString() });

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
    { mode: 'check' }, { status: 'checks_passed' },
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

test('failed backup progress exposes only bounded stage and cleanup evidence', () => {
  const value = resultFixture(); value.phases = value.phases.slice(0, 2);
  value.phases[1].status = 'failed';
  value.phases[1].backupFailure = { stage: 'capture', code: 'daily_backup_phase_failed', cleanupVerified: true,
    secret: 'private-provider-diagnostic' };
  const failure = operatorProgress(value, request(), installation, 'e'.repeat(64)).at(-1);
  assert.deepEqual(failure, { name: 'backup-before', reportedStatus: 'failed',
    backupFailure: { stage: 'capture', code: 'daily_backup_phase_failed', cleanupVerified: true } });
  value.phases[1].backupFailure.snapshotDump = 'failed';
  assert.equal(operatorProgress(value, request(), installation, 'e'.repeat(64)).at(-1).backupFailure.snapshotDump, 'failed');
  value.phases[1].backupFailure.snapshotDump = 'private-dump-error';
  assert.deepEqual(operatorProgress(value, request(), installation, 'e'.repeat(64)).at(-1), failure);
  for (const patch of [{ stage: 'private-stage' }, { code: 'daily_backup_private_token' }, { cleanupVerified: 'true' }]) {
    const changed = structuredClone(value); Object.assign(changed.phases[1].backupFailure, patch);
    assert.deepEqual(operatorProgress(changed, request(), installation, 'e'.repeat(64)).at(-1),
      { name: 'backup-before', reportedStatus: 'failed' });
  }
});

async function operatorFixture(t, outcome = 'passed') {
  const root = await mkdtemp(join(tmpdir(), 'freedom-shared-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), temporaryRoot = join(root, 'work');
  await mkdir(source); await mkdir(temporaryRoot);
  const calls = [], credentials = { cloudflareApiToken: 'fixture-token', migrationDatabaseUrl: 'fixture-db', runtimeDatabaseUrl: 'fixture-runtime', backupDatabaseUrl: 'fixture-backup',
    stagingAccessClientId: 'fixture-access-id', stagingAccessClientSecret: 'fixture-access-secret' };
  const registry = { username: 'teddashh', token: 'fixture-registry-secret' };
  const run = async (cmd, args, timeout, options) => {
    if (args[0] === '--config') {
      assert.equal((await stat(args[1])).mode & 0o777, 0o700);
      if (args[2] === 'login') assert.equal(options.input, registry.token);
      else assert.equal(options, undefined);
    }
    calls.push([cmd, ...args]);
    if (args[0] === 'run') {
      await assert.rejects(stat(join(temporaryRoot, 'registry')), { code: 'ENOENT' });
      const input = await readFile(join(temporaryRoot, 'input/request.json'), 'utf8');
      assert.equal((await stat(join(temporaryRoot, 'input/credentials.json'))).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(await readFile(join(temporaryRoot, 'input/credentials.json'), 'utf8')), credentials);
      if (outcome.startsWith('interrupted')) throw Error('secret token in provider error');
      if (outcome === 'symlink') await symlink(join(temporaryRoot, 'input/credentials.json'), join(temporaryRoot, 'output/result.json'));
      else await writeFile(join(temporaryRoot, 'output/result.json'), JSON.stringify(resultFixture(request(), hash(input))));
    }
    if (args[0] === 'rm' && outcome.endsWith('cleanup-failed')) throw Error('cleanup failure');
    if (args[2] === 'pull' && outcome === 'pull-failed') throw Error('pull failure');
  };
  return { calls, root, temporaryRoot, options: { admission: request(), installation, sourceRoot: source,
    temporaryRoot, config, credentials, registry, run } };
}

test('one operator process owns the whole release; no credentials enter argv, host mounts or artifacts', async t => {
  const fixture = await operatorFixture(t);
  assert.equal((await runOperator(fixture.options)).length, 7);
  assert.deepEqual(fixture.calls.map(call => call[1] === '--config' ? call[3] : call[1]), ['login', 'pull', 'run', 'rm']);
  assert.ok(!JSON.stringify(fixture.calls).includes('fixture-token'));
  assert.ok(!JSON.stringify(fixture.calls).includes('fixture-registry-secret'));
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
  assert.deepEqual(fixture.calls.map(call => call[1] === '--config' ? call[3] : call[1]), ['login', 'pull', 'run', 'rm']);
  await assert.rejects(stat(join(fixture.temporaryRoot, 'input')));
  await assert.rejects(stat(join(fixture.temporaryRoot, 'output')));
  await assert.rejects(stat(join(fixture.temporaryRoot, 'work')));
});

test('private registry login and pull failures remove credentials and cannot start an operator', async t => {
  for (const failing of ['login', 'pull']) {
    const fixture = await operatorFixture(t), calls = [];
    await assert.rejects(pullOperatorImage({ image: installation.image, temporaryRoot: fixture.temporaryRoot,
      registry: fixture.options.registry, run: async (command, args, timeout, options) => {
        calls.push(args[2]);
        assert.equal(command, 'docker');
        if (args[2] === 'login') {
          assert.equal(options.input, fixture.options.registry.token);
          await writeFile(join(args[1], 'config.json'), 'synthetic private registry credentials');
        } else assert.equal(args.at(-1), installation.image);
        if (args[2] === failing) throw Error('private provider error with token');
      } }), { code: 'release_registry_pull_failed', message: 'release_registry_pull_failed' });
    assert.deepEqual(calls, failing === 'login' ? ['login'] : ['login', 'pull']);
    await assert.rejects(stat(join(fixture.temporaryRoot, 'registry')), { code: 'ENOENT' });
  }
});

test('registry input is validated before login; quiet subprocess sends token only through stdin', async t => {
  const fixture = await operatorFixture(t); let calls = 0;
  for (const patch of [{ image: 'ghcr.io/other/image:latest' }, { registry: undefined },
    { registry: { username: 'teddashh', token: 'bad\nheader' } }, { registry: { username: '--invalid', token: '' } }]) {
    await assert.rejects(pullOperatorImage({ image: installation.image, temporaryRoot: fixture.temporaryRoot,
      registry: fixture.options.registry, run: async () => { calls++; }, ...patch }));
  }
  assert.equal(calls, 0);
  const program = "let value='';process.stdin.on('data',b=>value+=b);process.stdin.on('end',()=>{"
    + "if(value!=='synthetic-stdin-token'||Object.keys(process.env).some(k=>/TOKEN|DOCKER_CONFIG/.test(k)))process.exit(1);});";
  await quietCommand(process.execPath, ['-e', program], 5000, { input: 'synthetic-stdin-token' });
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
    if (outcome === 'pull-failed') assert.deepEqual(fixture.calls.map(call => call[3]), ['login', 'pull']);
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
    async retainIntent(value) { assert.equal(value.pid, 4321); assert.equal(value.automaticRetry, false); },
    lease: { signal: new AbortController().signal, assertHeld() {} },
    revision: 'shared-backup-11111111-1111-1111-1111-111111111111', before: 'a'.repeat(64),
    intent: { async putIfAbsent() { intentWritten = true; return 'created'; } } });
  await assert.rejects(policy.enable(), /synthetic unknown commit/); assert.equal(released, true);
  await assert.rejects(policy.cleanup(), /release_capture_policy_unsettled/); assert.equal(disabled, false);
  await assert.rejects(policy.enable(), /release_capture_policy_retry_forbidden/);
});

test('capture policy refuses a new enable after ownership is lost during intent persistence or before enable', async () => {
  for (const point of ['intent', 'external-intent', 'before-enable', 'ownership-check']) {
    const controller = new AbortController(); let enables = 0, released = 0, held = true;
    const lease = { signal: controller.signal, assertHeld() { if (!held) throw Error('synthetic ownership lost'); } };
    const client = { on() {}, removeListener() {}, release() { released++; }, async query(input) {
      if (input.text.startsWith('SELECT set_config')) return { rows: [] };
      if (input.text.startsWith('SELECT current_database')) return { rows: [{ database: 'fixture', role: 'operator', session_role: 'operator', pid: 4321 }] };
      if (input.text.includes('SET enabled=true')) enables++;
      throw Error('enable UPDATE must not be submitted');
    } };
    const policy = await openCapturePolicy({ pool: { async connect() { return client; } }, lease,
      async retainIntent() { if (point === 'external-intent') controller.abort(Error('synthetic setup abort')); },
      database: 'fixture', role: 'operator', revision: 'shared-backup-11111111-1111-1111-1111-111111111111', before: 'a'.repeat(64),
      intent: { async putIfAbsent() { if (point === 'intent') controller.abort(Error('synthetic setup abort')); return 'created'; } } });
    if (point === 'before-enable') controller.abort(Error('synthetic setup abort'));
    if (point === 'ownership-check') held = false;
    await assert.rejects(policy.enable(), /synthetic (setup abort|ownership lost)/);
    assert.equal(enables, 0); assert.equal(released, 1);
    await assert.rejects(policy.enable(), /release_capture_policy_retry_forbidden/);
  }
});

async function deployFixture(t, decisions, liveFlags = {}) {
  const workRoot = await diskFixture(t, 'fp-deploy-'), controller = new AbortController();
  const oldVersion = '11111111-1111-4111-8111-111111111111', newVersion = '22222222-2222-4222-8222-222222222222';
  const sourceRoot = join(workRoot, 'source'); await mkdir(sourceRoot);
  if (decisions) {
    await mkdir(join(sourceRoot, 'deploy/shared-release'), { recursive: true });
    await writeFile(join(sourceRoot, 'deploy/shared-release/flag-decisions.json'), JSON.stringify(decisions));
  } else await writeFile(join(sourceRoot, 'fixture.txt'), 'Synthetic release');
  fixtureGit(sourceRoot, ['init', '-q', '-b', 'main']); fixtureGit(sourceRoot, ['add', '.']);
  fixtureGit(sourceRoot, ['commit', '-qm', 'Synthetic flag source']);
  const sourceSha = fixtureGit(sourceRoot, ['rev-parse', 'HEAD']), previous = 'b'.repeat(40), worker = 'freedom-platform-staging-next';
  let published = false, polls = 0, cacheEnabled = false, failPoll = false, logs;
  let deployedFlags, dropFlagsAfterMatch = false;
  const bindings = source => {
    const values = [
    ...Object.entries({ APP_ORIGIN: 'https://staging.freetwai.com', FREEDOM_ENV: 'staging',
      FREEDOM_DATABASE_NAME: 'freedom_staging_next', FREEDOM_TRUST_CF_CONNECTING_IP: 'true',
      FREEDOM_RELEASE_SHA: source, FREEDOM_COMMERCE_CHECKOUT_ENABLED: 'false', ...liveFlags }).map(([name, text]) => ({ name, text, type: 'plain_text' })),
    { name: 'ASSETS', type: 'assets' }, { name: 'IMAGES', type: 'images' },
    { name: 'HYPERDRIVE', type: 'hyperdrive', id: 'c'.repeat(32) },
    { name: 'EMAIL', type: 'send_email', allowed_sender_addresses: ['no-reply@mail.freetwai.com'] },
    { name: 'MEDIA', type: 'r2_bucket', bucket_name: 'fixture-media' },
    { name: 'GUIDE_STATIC', type: 'r2_bucket', bucket_name: 'fixture-guide' },
    { name: 'TOTP_ENCRYPTION_KEY', type: 'secret_text' },
    ];
    if (source === sourceSha && deployedFlags && !(dropFlagsAfterMatch && polls >= 3)) {
      for (const [name, text] of Object.entries(deployedFlags)) {
        const binding = values.find(row => row.name === name);
        if (binding) binding.text = text;
        else values.push({ name, type: 'plain_text', text });
      }
    }
    return values;
  };
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
    else if (url.pathname.endsWith('/environments/production')) result = { script: { logpush: false, tail_consumers: null,
      compatibility_date: runtime.compatibility_date, compatibility_flags: runtime.compatibility_flags, observability: logs } };
    else throw Error('unexpected provider path');
    return new Response(JSON.stringify({ success: true, result }));
  };
  const deployer = createWorkerDeployer({ accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32), target: 'staging-next',
    token: 'synthetic-deploy-token', signal: controller.signal, fetchImpl });
  const before = await deployer.inspect();
  const source = parseJsonc(await readFile(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8'));
  return { deployer, before, sourceSha, oldVersion, newVersion, controller, fetchImpl,
    args: { sourceSha, before, source, sourceRoot, workRoot,
      async retainIntent(value) { assert.equal(value.sourceSha, sourceSha); assert.equal(value.automaticRetry, false); },
      lease: { signal: controller.signal, assertHeld() { controller.signal.throwIfAborted(); } } },
    publish(flags) { published = true; deployedFlags = flags; }, failNextPoll() { failPoll = true; }, enableCache() { cacheEnabled = true; },
    dropFlagsAfterMatch() { dropFlagsAfterMatch = true; },
    setLogs(value) { logs = value; } };
}

test('Worker publish preserves bindings/secrets/routes, records stale reads, and deploys once', async t => {
  const f = await deployFixture(t); let calls = 0, sleeps = 0;
  const expected = renderWorkerConfig({ ...f.args, target: 'staging-next' }), { config } = expected;
  assert.equal(expected.bindingsSha256, f.before.bindingsSha256); assert.deepEqual(expected.flagChanges, []);
  assert.equal(config.keep_vars, true); assert.deepEqual(config.routes, []);
  assert.deepEqual(config.observability, { enabled: false }); assert.equal(config.logpush, false);
  assert.equal(config.vars.FREEDOM_COMMERCE_CHECKOUT_ENABLED, 'false');
  assert.equal(config.vars.FREEDOM_RELEASE_SHA, f.sourceSha);
  assert(!('TOTP_ENCRYPTION_KEY' in config.vars));
  assert.deepEqual(config.alias, { sharp: join(f.args.sourceRoot, 'packages/shared/sharp-unavailable.ts'),
    './model-step-node-transport.js': join(f.args.sourceRoot, 'modules/agent-execution/model-step-worker-transport-unavailable.ts') });
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

async function controlFixture(t) {
  const directory = await diskFixture(t, 'fp-control-'), controller = new AbortController();
  const epoch = '11111111-1111-4111-8111-111111111111', target = 'staging-next';
  const prefix = `shared-release/v1/${target}/${epoch}/`, map = new Map(); let puts = 0, mode = 'normal';
  const bytes = value => Buffer.from(JSON.stringify(value) + '\n');
  const seed = bytes({ format: 'freedom.shared-control-record/v1', target, epoch, generation: 0,
    previousSha256: null, seedSha256: null, createdAt: '2026-10-25T00:00:00Z', data: { state: 'ready' } });
  const seedSha256 = hash(seed), seedKey = prefix + 'records/00000000-' + seedSha256 + '.json'; map.set(seedKey, seed);
  const lease = { signal: controller.signal, assertHeld() { controller.signal.throwIfAborted(); } };
  const fetchImpl = async (address, options) => {
    const url = new URL(address); assert.equal(url.origin, 'https://api.cloudflare.com'); assert.equal(options.redirect, 'error');
    if (url.searchParams.has('prefix')) {
      assert.equal(options.method, 'GET');
      const rows = [...map].filter(([key]) => key.startsWith(url.searchParams.get('prefix'))).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ key, size: value.length }));
      // Deliberately paginate after a single item, independently of per_page.
      const offset = Number(url.searchParams.get('cursor') ?? 0), more = offset + 1 < rows.length;
      return new Response(JSON.stringify({ success: true, result: rows.slice(offset, offset + 1),
        result_info: { is_truncated: more, ...(more ? { cursor: String(offset + 1) } : {}) } }));
    }
    const key = decodeURIComponent(url.pathname.split('/objects/')[1]);
    if (options.method === 'PUT') {
      puts++; assert(!map.has(key)); map.set(key, Buffer.from(options.body));
      if (mode === 'lost-put') throw Error('synthetic lost control reply');
      return new Response(null, { status: 200 });
    }
    assert.equal(options.method, 'GET');
    if (map.has(key)) return new Response(map.get(key));
    if (mode === 'abort-before-put') controller.abort(Error('synthetic control lease lost'));
    return new Response(null, { status: 404 });
  };
  const options = { accountId: 'a'.repeat(32), bucket: 'fixture-backups', target, epoch, seedSha256,
    token: 'synthetic-control-token', lease, fetchImpl };
  return { directory, map, prefix, seedKey, seedSha256, options, controller, store: createControlStore(options),
    setMode(value) { mode = value; }, puts() { return puts; } };
}

test('external control journal pins its seed and validates every paginated predecessor', async t => {
  const f = await controlFixture(t);
  const first = (await f.store.load()).at(-1);
  const next = await f.store.append({ previous: first, data: { state: 'release-started', runId: 1 }, intentDirectory: f.directory });
  assert.equal(next.generation, 1); assert.equal(next.record.previousSha256, f.seedSha256); assert.equal(f.puts(), 1);
  const chain = await createControlStore(f.options).load(); assert.equal(chain.length, 2);
  assert.equal(chain[1].record.data.state, 'release-started');
  await assert.rejects(f.store.append({ previous: first, data: { state: 'replay' }, intentDirectory: f.directory }), /release_control_head_changed/);
  assert.equal(f.puts(), 1);
  await assert.rejects(createControlStore({ ...f.options, seedSha256: 'f'.repeat(64) }).load(), /release_control_history_gap_or_fork/);
  const original = f.map.get(next.key); f.map.set(next.key, Buffer.from(original)); f.map.get(next.key)[20] ^= 1;
  await assert.rejects(f.store.load(), /release_control_digest_mismatch/);
  f.map.set(next.key, original);
  f.map.set(f.prefix + 'records/00000001-' + 'f'.repeat(64) + '.json', original);
  await assert.rejects(f.store.load(), /release_control_history_gap_or_fork/);
});

test('control GET retries transient transport and HTTP failures with the same pinned bytes', async t => {
  const f = await controlFixture(t); let reads = 0;
  const store = createControlStore({ ...f.options, fetchImpl: async (url, options) => {
    if (url.endsWith(f.seedKey)) {
      reads++;
      if (reads === 1) throw new TypeError('synthetic private network details');
      if (reads === 2) return new Response(null, { status: 503 });
    }
    return f.options.fetchImpl(url, options);
  } });
  const chain = await store.load();
  assert.equal(chain.length, 1); assert.equal(chain[0].sha256, f.seedSha256);
  assert.equal(reads, 3); assert.equal(f.puts(), 0);
});

test('control GET retries interrupted listing and record bodies within one shared budget', async t => {
  const interrupted = () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array([123])); controller.error(new TypeError('synthetic private stream details'));
  } }));
  const f = await controlFixture(t); let lists = 0, reads = 0;
  const store = createControlStore({ ...f.options, fetchImpl: async (url, options) => {
    if (new URL(url).searchParams.has('prefix') && ++lists === 1) return interrupted();
    if (url.endsWith(f.seedKey)) {
      reads++;
      if (reads === 1) throw new TypeError('synthetic network interruption');
      if (reads === 2) return interrupted();
    }
    return f.options.fetchImpl(url, options);
  } });
  assert.equal((await store.load())[0].sha256, f.seedSha256);
  assert.equal(lists, 2); assert.equal(reads, 3); assert.equal(f.puts(), 0);
  reads = 0;
  const failed = createControlStore({ ...f.options, fetchImpl: async (url, options) => {
    if (url.endsWith(f.seedKey)) { reads++; return interrupted(); }
    return f.options.fetchImpl(url, options);
  } });
  await assert.rejects(failed.load(), /release_control_read_network_failed/);
  assert.equal(reads, 3); assert.equal(f.puts(), 0);
});

for (const [status, code] of [[429, 'release_control_read_rate_limited'], [503, 'release_control_read_unavailable'],
  [null, 'release_control_read_network_failed']]) {
  test(`control GET exhausts a finite retry budget and retains ${code}`, async t => {
    const f = await controlFixture(t); let reads = 0;
    const store = createControlStore({ ...f.options, fetchImpl: async (url, options) => {
      if (url.endsWith(f.seedKey)) {
        reads++;
        if (status === null) throw new TypeError('synthetic private network details');
        return new Response(null, { status, headers: { 'retry-after': '0' } });
      }
      return f.options.fetchImpl(url, options);
    } });
    await assert.rejects(store.load(), error => error.message === code);
    assert.equal(reads, 3); assert.equal(f.puts(), 0);
  });
}

test('control GET distinguishes its deadline without retrying authorization or digest failures', async t => {
  const f = await controlFixture(t);
  for (const status of [401, 403, 404]) {
    let reads = 0;
    const store = createControlStore({ ...f.options, fetchImpl: async (url, options) => {
      if (url.endsWith(f.seedKey)) { reads++; return new Response(null, { status }); }
      return f.options.fetchImpl(url, options);
    } });
    await assert.rejects(store.load(), /release_control_read_failed/); assert.equal(reads, 1);
  }
  let reads = 0;
  const corrupt = createControlStore({ ...f.options, fetchImpl: async (url, options) => {
    if (url.endsWith(f.seedKey)) { reads++; return new Response('corrupt'); }
    return f.options.fetchImpl(url, options);
  } });
  await assert.rejects(corrupt.load(), /release_control_digest_mismatch/); assert.equal(reads, 1);
  reads = 0;
  const oversized = createControlStore({ ...f.options, fetchImpl: async (url, options) => {
    if (url.endsWith(f.seedKey)) { reads++; return new Response(Buffer.alloc(f.map.get(f.seedKey).length + 1)); }
    return f.options.fetchImpl(url, options);
  } });
  await assert.rejects(oversized.load(), /release_cloudflare_response_limit/); assert.equal(reads, 1);
  t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(new DOMException('synthetic deadline', 'TimeoutError')));
  reads = 0;
  const timed = createControlStore({ ...f.options, fetchImpl: async (url, options) => {
    if (url.endsWith(f.seedKey)) { reads++; options.signal.throwIfAborted(); }
    return f.options.fetchImpl(url, options);
  } });
  await assert.rejects(timed.load(), /release_control_read_timeout/); assert.equal(reads, 3); assert.equal(f.puts(), 0);
});

for (const after of ['300', '0000300']) test(`control GET stops ${after}-second backoff when the release lease is lost`, async t => {
  const f = await controlFixture(t); let reads = 0, timer;
  t.after(() => clearTimeout(timer));
  const store = createControlStore({ ...f.options, fetchImpl: async (url, options) => {
    if (url.endsWith(f.seedKey)) {
      reads++; timer = setTimeout(() => f.controller.abort(Error('release_lease_lost')), 1);
      return new Response(null, { status: 429, headers: { 'retry-after': after } });
    }
    return f.options.fetchImpl(url, options);
  } });
  await assert.rejects(store.load(), /release_lease_lost/); assert.equal(reads, 1); assert.equal(f.puts(), 0);
});

test('control GET stops instead of retrying before an excessive provider delay', async t => {
  const f = await controlFixture(t);
  for (const after of ['301', '1000000', '0000301', '9'.repeat(1000)]) {
    let reads = 0;
    const store = createControlStore({ ...f.options, fetchImpl: async (url, options) => {
      if (url.endsWith(f.seedKey)) {
        reads++; return new Response(null, { status: 429, headers: { 'retry-after': after } });
      }
      return f.options.fetchImpl(url, options);
    } });
    await assert.rejects(store.load(), /release_control_read_rate_limited/);
    assert.equal(reads, 1); assert.equal(f.puts(), 0);
  }
});

test('control intent survives an unknown PUT and setup ownership loss submits zero PUTs', async t => {
  const f = await controlFixture(t), first = (await f.store.load()).at(-1); f.setMode('lost-put');
  await assert.rejects(f.store.append({ previous: first, data: { state: 'unsettled', runId: 2 }, intentDirectory: f.directory }), /release_control_write_unknown/);
  assert.equal(f.puts(), 1);
  const fresh = createControlStore(f.options), head = (await fresh.load()).at(-1);
  assert.equal(head.record.data.state, 'unsettled');
  await assert.rejects(fresh.append({ previous: first, data: { state: 'replay' }, intentDirectory: f.directory }), /release_control_head_changed/);
  assert.equal(f.puts(), 1);
  const g = await controlFixture(t), seed = (await g.store.load()).at(-1); g.setMode('abort-before-put');
  await assert.rejects(g.store.append({ previous: seed, data: { state: 'started' }, intentDirectory: g.directory }), /synthetic control lease lost/);
  assert.equal(g.puts(), 0);
});

function coordinateFixture() {
  const names = ['canonical_repositories', 'catalog_repo_observations', 'development_grants', 'github_items',
    'github_repository_events', 'github_repository_metrics', 'github_sync_repositories', 'maintainer_repositories', 'oss_projects', 'skill_star_support'];
  const constraints = names.map(table => ({ schema: 'public', table, name: 'fp166_live_coordinate_fence', type: 'c',
    validated: true, enforced: true, no_inherit: false, deferrable: false, deferred: false, definition: 'CHECK (true)' }));
  const migration = { name: '166_freetwai_repository_transfer.sql', raw_sha256: '6d387e7fe02494056158aaa4365a960b06b3006f17b7147060d1b63d4204caca',
    ledger_sha256: '1e72cf94952d42fe19f20bcf278d89be873b4a598dfb92adb41c109463abc188' };
  const inventory = { format: 'freedom.operator-coordinate-fence-inventory/v1', postgres_major: 18, sql_sha256: 'a'.repeat(64), constraints };
  const inventorySha256 = hash(JSON.stringify(inventory));
  const variants = { format: 'freedom.restore-exact-check-variants/v1', originalInventorySha256: inventorySha256,
    originalFenceSqlSha256: inventory.sql_sha256, diagnosticSha256: 'b'.repeat(64),
    variants: ['canonical_repositories', 'catalog_repo_observations', 'development_grants', 'maintainer_repositories', 'oss_projects'].map(table => ({
      schema: 'public', table, name: 'fp166_live_coordinate_fence', originalDefinitionSha256: hash('CHECK (true)'), restoredDefinition: 'CHECK ((true))',
    })) };
  const legacy = { restoreQuarantineRequired: true, retained172: {
    floor: { floor: { environment: 'production', minimumSchema: 172 }, operatorExtensions: { coordinateFence: {
      format: 'freedom.operator-coordinate-fence/v1', commit_status: 'confirmed', transaction_id: '123',
      retain_after_admission_off: true, restore_verification_required: true, deployment_authorized: false,
      inventory_sha256: inventorySha256, sql_sha256: inventory.sql_sha256, migration, constraints,
    } } }, binding: { schemaLedger: [{ name: migration.name, sha256: migration.ledger_sha256 }] },
  } };
  return { target: 'next', legacy, inventory, inventorySha256, variants, variantsSha256: hash(JSON.stringify(variants)) };
}

test('retained coordinate fence accepts only original live constraints and exact reviewed restore variants', async () => {
  const input = coordinateFixture(), authority = validateCoordinateAuthority(input);
  let rows = structuredClone(input.inventory.constraints);
  const q = { async query(sql) { return { rows: sql.includes('server_version_num') ? [{ major: 18 }] : rows }; } };
  assert.equal((await verifyCoordinateFence(q, authority)).constraints, 10);
  rows[0].definition = 'CHECK ((true))';
  await assert.rejects(verifyCoordinateFence(q, authority), /release_coordinate_definition_changed/);
  assert.equal((await verifyCoordinateFence(q, authority, { restored: true })).accepted[0], 'reviewed_pg18_roundtrip');
  rows[0].definition = 'CHECK (false)';
  await assert.rejects(verifyCoordinateFence(q, authority, { restored: true }), /release_coordinate_definition_changed/);
  rows = structuredClone(input.inventory.constraints); rows[0].enforced = false;
  await assert.rejects(verifyCoordinateFence(q, authority), /release_coordinate_constraint_changed/);
  input.variants.variants[0].originalDefinitionSha256 = 'f'.repeat(64);
  assert.throws(() => validateCoordinateAuthority(input), /release_coordinate_variant_binding_invalid/);
});

async function adoptionFixture(t) {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'fp-floor-adoption-'));
  t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  fixtureGit(sourceRoot, ['init', '-q', '-b', 'main']); await mkdir(join(sourceRoot, 'migrations'));
  const sql = 'CREATE TABLE fixture(id integer);\n';
  await writeFile(join(sourceRoot, 'migrations/189_fixture.sql'), sql);
  const commit = () => {
    fixtureGit(sourceRoot, ['add', '.']); fixtureGit(sourceRoot, ['commit', '-qm', 'Synthetic floor fixture']);
    return { sourceSha: fixtureGit(sourceRoot, ['rev-parse', 'HEAD']), sourceTree: fixtureGit(sourceRoot, ['rev-parse', 'HEAD^{tree}']) };
  };
  const previous = commit(), schemaLedger = [{ name: '189_fixture.sql', sha256: migrationDigest(sql) }];
  const policies = [{ bucket: 'synthetic-media', revision: 'retained' }];
  const legacy = { format: 'freedom.schema189-committed-floor/v1', restoreQuarantineRequired: true,
    floor: { environment: 'staging', minimumSchema: 189, candidateRelease: previous.sourceSha },
    migration: { release: previous.sourceSha, tree: previous.sourceTree, commitStatus: 'confirmed' }, schemaLedger,
    retained172: { floor: { floor: { environment: 'staging', minimumSchema: 172 } },
      materialPolicy: { format: 'freedom.backup-material-policy-observation/v1', policies } } };
  await writeFile(join(sourceRoot, 'app.txt'), 'independent update'); const current = commit();
  const seed = { format: 'freedom.shared-floor-seed/v2', authority: { legacyFloorSha256: hash(JSON.stringify(legacy)) },
    state: { ...current, deployedSourceSha: current.sourceSha, bindingsSha256: 'd'.repeat(64),
      materialPolicySha256: hash(JSON.stringify(policies)), schemaLedger, schemaVersion: 189, pending: null } };
  const open = (candidate = seed, authority = legacy) => openReleaseFloor({ sourceRoot, intentDirectory: sourceRoot,
    store: { target: 'staging-next', load: async () => [{ sha256: hash(JSON.stringify(candidate)), record: { data: candidate } }],
      readAuthority: async () => structuredClone(authority), append: async () => { throw Error('No writes during adoption'); } } });
  return { sourceRoot, previous, current, legacy, seed, commit, open };
}

test('seed v2 adopts a independent Git descendant while keeping original migration authority', async t => {
  const f = await adoptionFixture(t), before = JSON.stringify(f.legacy);
  assert.equal((await f.open()).state().sourceSha, f.current.sourceSha);
  assert.equal(JSON.stringify(f.legacy), before);
  // Immutable Git blobs are authoritative, not mutable working-tree SQL.
  await writeFile(join(f.sourceRoot, 'migrations/189_fixture.sql'), 'uncommitted SQL is not authority');
  assert.equal((await f.open()).state().sourceSha, f.current.sourceSha);
  assert.notEqual(f.seed.state.schemaLedger[0].sha256, hash('CREATE TABLE fixture(id integer);\n'));
});

test('seed v1 retains exact-source compatibility and rejects independent adoption', async t => {
  const f = await adoptionFixture(t), seed = structuredClone(f.seed); seed.format = 'freedom.shared-floor-seed/v1';
  await assert.rejects(f.open(seed), { code: 'release_floor_legacy_authority_invalid' });
  Object.assign(seed.state, f.previous, { deployedSourceSha: f.previous.sourceSha });
  assert.equal((await f.open(seed)).state().sourceSha, f.previous.sourceSha);
});

test('seed v2 rejects new, edited, removed and symlink migration catalogs', async t => {
  for (const change of ['add', 'edit', 'remove', 'symlink']) {
    const f = await adoptionFixture(t), path = join(f.sourceRoot, 'migrations/189_fixture.sql');
    if (change === 'add') await writeFile(join(f.sourceRoot, 'migrations/190_new.sql'), 'SELECT 1;');
    if (change === 'edit') await writeFile(path, 'SELECT 2;');
    if (change === 'remove' || change === 'symlink') await rm(path);
    if (change === 'symlink') await symlink('../app.txt', path);
    const updated = f.commit(); Object.assign(f.seed.state, updated, { deployedSourceSha: updated.sourceSha });
    await assert.rejects(f.open(), { code: change === 'symlink' ? 'release_floor_adoption_catalog_invalid' : 'release_floor_adoption_catalog_changed' });
  }
});

test('seed v2 rejects unrelated ancestry, wrong trees, ledger substitution and changed original policies', async t => {
  const f = await adoptionFixture(t);
  const unrelated = fixtureGit(f.sourceRoot, ['commit-tree', f.current.sourceTree, '-m', 'Unrelated synthetic root']);
  for (const sourceSha of [unrelated, 'f'.repeat(40)]) {
    const seed = structuredClone(f.seed); Object.assign(seed.state, { sourceSha, deployedSourceSha: sourceSha });
    await assert.rejects(f.open(seed), { code: 'release_floor_adoption_source_invalid' });
  }
  const wrongTree = structuredClone(f.seed); wrongTree.state.sourceTree = f.previous.sourceTree;
  await assert.rejects(f.open(wrongTree), { code: 'release_floor_adoption_tree_invalid' });
  const wrongLegacy = structuredClone(f.legacy); wrongLegacy.migration.tree = f.current.sourceTree;
  await assert.rejects(f.open(f.seed, wrongLegacy), { code: 'release_floor_adoption_tree_invalid' });
  const wrongLedger = structuredClone(f.legacy); wrongLedger.schemaLedger[0].sha256 = '0'.repeat(64);
  await assert.rejects(f.open(f.seed, wrongLedger), { code: 'release_floor_legacy_ledger_changed' });
  const wrongPolicy = structuredClone(f.legacy); wrongPolicy.retained172.materialPolicy.policies[0].revision = 'changed';
  await assert.rejects(f.open(f.seed, wrongPolicy), { code: 'release_floor_legacy_policy_changed' });
});

function floorFixture() {
  const before = [{ name: '001_initial.sql', sha256: '1'.repeat(64) }];
  const after = [...before, { name: '002_next.sql', sha256: '2'.repeat(64) }];
  const id = '11111111-1111-4111-8111-111111111111';
  const request = { runId: 12, runAttempt: 1, sourceSha: sha, sourceTree: tree, controllerSha: main,
    operatorImage: installation.image, configSha256: installation.configSha256 };
  const chain = [{ record: { data: { format: 'freedom.shared-floor-seed/v1', authority: { legacyFloorSha256: '3'.repeat(64) },
    state: { sourceSha: main, deployedSourceSha: main, sourceTree: tree, schemaVersion: 1, schemaLedger: before,
      bindingsSha256: '4'.repeat(64), materialPolicySha256: '5'.repeat(64), pending: null } } } }];
  const options = { isAncestor: (a, b) => (a === main && b === sha) || a === b };
  const event = (kind, stage, proof, extra = {}) => ({ record: { data: { format: 'freedom.shared-floor-event/v1',
    kind, stage, proof, runId: 12, runAttempt: 1, ...extra } } });
  const add = value => { chain.push(value); return replayReleaseFloor(chain, options).state; };
  const begin = event('begin', undefined, undefined, { request, candidate: { sourceSha: sha, sourceTree: tree, schemaLedger: after } });
  const capture = { format: 'freedom.shared-capture-policy-intent/v1', pid: 123, application: 'fp-capture-' + id,
    revision: 'shared-backup-' + id, before: '6'.repeat(64), automaticRetry: false };
  const archive = { setId: id, archiveSha256: '7'.repeat(64), bytes: 1234, automaticRetry: false };
  const backup = sourceSha => ({ ...archive, sourceSha, remoteReadback: 'verified', restore: 'database_and_objects_restored',
    cleanupVerified: true, exposure: 'quarantine' });
  const runBackup = (stage, sourceSha) => {
    add(event('intent', stage, capture, { operation: 'capture-policy' }));
    add(event('intent', stage, archive, { operation: 'archive' })); return add(event('passed', stage, backup(sourceSha)));
  };
  const commit = { transactionId: '123', source: sha, tree, beforeDigest: migrationLedgerDigest(before),
    afterDigest: migrationLedgerDigest(after), automaticRetry: false };
  return { chain, options, event, add, begin, runBackup, before, after, commit, id, request };
}

test('shared floor advances immediately after confirmed commit and keeps incomplete later verification unsettled', () => {
  const f = floorFixture(); f.add(f.begin); f.runBackup('backup-before', main);
  f.add(f.event('intent', 'migration', f.commit, { operation: 'commit' }));
  let state = f.add(f.event('committed', 'migration', { ...f.commit, ledger: f.after }));
  assert.equal(state.sourceSha, sha); assert.equal(state.schemaVersion, 2); assert.equal(state.pending.stage, 1);
  assert.throws(() => replayReleaseFloor([...f.chain, f.begin], f.options), /release_floor_unsettled/);
  assert.throws(() => replayReleaseFloor([...f.chain, f.event('passed', 'deploy', {})], f.options), /release_floor_stage_mismatch/);
  f.add(f.event('passed', 'migration', { transactionId: '123', commitStatus: 'confirmed', ledgerVerified: true,
    runtimeGrantsVerified: true, ledgerSha256: migrationLedgerDigest(f.after) }));
  f.add(f.event('intent', 'deploy', { sourceSha: sha, previousSourceSha: main, previousVersion: f.id,
    configSha256: '8'.repeat(64), automaticRetry: false }, { operation: 'publish' }));
  f.add(f.event('passed', 'deploy', { sourceSha: sha, providerConfirmed: true, versionId: f.id }));
  f.add(f.event('passed', 'health', { sourceSha: sha, statusCode: 200, schemaVerified: true, smokePassed: true }));
  f.runBackup('backup-after', sha);
  assert.throws(() => replayReleaseFloor([...f.chain, f.event('passed', 'handoff', { scheduledBackupsVerified: true })], f.options),
    /release_floor_schedule_unverified/);
  state = f.add(f.event('passed', 'handoff', { cleanupVerified: true, schedule: { format: 'freedom.verified-scheduled-backup/v1',
    runId: 10, operatorImage: f.request.operatorImage, configSha256: f.request.configSha256,
    receiptSha256: '9'.repeat(64), completedAt: '2026-10-25T00:00:00Z' } }));
  assert.equal(state.pending, null); assert.equal(state.deployedSourceSha, sha);
});

test('shared floor rejects rollback, changed ledger, missing mutation intents and duplicate attempts', () => {
  for (const patch of [value => { value.candidate.schemaLedger[0].sha256 = 'f'.repeat(64); },
    value => { value.request.sourceSha = value.candidate.sourceSha = 'f'.repeat(40); }]) {
    const f = floorFixture(), begin = structuredClone(f.begin); patch(begin.record.data);
    assert.throws(() => replayReleaseFloor([...f.chain, begin], f.options), /release_floor_(ledger|source)_rewind/);
  }
  const f = floorFixture(); f.add(f.begin);
  assert.throws(() => replayReleaseFloor([...f.chain, f.event('passed', 'backup-before', {})], f.options), /release_floor_capture_intent_missing/);
  f.runBackup('backup-before', main);
  const intent = f.event('intent', 'migration', f.commit, { operation: 'commit' }); f.add(intent);
  assert.throws(() => replayReleaseFloor([...f.chain, intent], f.options), /release_floor_intent_invalid/);
  assert.throws(() => replayReleaseFloor([...f.chain, f.event('passed', 'migration', { transactionId: '123', commitStatus: 'confirmed',
    ledgerVerified: true, runtimeGrantsVerified: true, ledgerSha256: migrationLedgerDigest(f.after) })], f.options), /release_floor_commit_unverified/);
});

test('failed shared publish intent prevents all provider mutations', async t => {
  const f = await deployFixture(t); let calls = 0;
  await assert.rejects(f.deployer.publish({ ...f.args,
    async retainIntent() { throw Error('synthetic shared intent failed'); }, async execute() { calls++; } }), /synthetic shared intent failed/);
  assert.equal(calls, 0);
});

test('Worker Logs changes are rejected before upload and explicit disabled state is preserved', async t => {
  const f = await deployFixture(t); let calls = 0;
  f.setLogs({ enabled: false }); assert.deepEqual((await f.deployer.inspect()).observability, { enabled: false });
  for (const value of [{ enabled: true }, { enabled: false, logs: { enabled: true } }, { enabled: false, traces: { enabled: true } }]) {
    f.setLogs(value);
    await assert.rejects(f.deployer.publish({ ...f.args, async execute() { calls++; } }), /release_deploy_observability_unsupported/);
  }
  assert.equal(calls, 0);
});

test('portable configuration cannot select programs, foreign resources, profiles or database logins', () => {
  const value = { format: 'freedom.shared-release-config/v1', target: 'staging-next', accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32),
    mediaBucket: 'fixture-media', backupBucket: 'fixture-backups',
    database: { name: 'freedom_staging_next', host: 'fixture.pg.psdb.cloud', port: '5432', loginSuffix: 'fixture' },
    floor: { epoch: '11111111-1111-4111-8111-111111111111', seedSha256: 'c'.repeat(64) },
    migrationProfile: { format: 'freedom.migrations/legacy-v1', first: 1, last: 189, known_gaps: [22] } };
  const parsed = validatePortableConfig(value, 'staging-next');
  const url = suffix => `postgresql://freedom_staging_next${suffix}.fixture:synthetic@fixture.pg.psdb.cloud:5432/freedom_staging_next?sslmode=verify-full`;
  const credentials = { migrationDatabaseUrl: url('_migrator'), runtimeDatabaseUrl: url('_app'), backupDatabaseUrl: url('_backup') };
  assert.equal(portableConnections(parsed, credentials).runtime.options.ssl.rejectUnauthorized, true);
  const codeCredentials = { ...credentials }; delete codeCredentials.backupDatabaseUrl;
  assert.deepEqual(Object.keys(portableConnections(parsed, codeCredentials, { includeBackup: false })), ['migrator', 'runtime']);
  assert.throws(() => portableConnections(parsed, codeCredentials));
  for (const change of [v => { v.program = '/bin/sh'; }, v => { v.database.host = 'foreign.invalid'; },
    v => { v.migrationProfile.format = 'freedom.migrations/dag-v2'; }, v => { v.database.name = 'freedom_next'; },
    v => { v.backupBucket = v.mediaBucket; }, v => { v.floor.seedSha256 = 'untrusted'; }]) {
    const changed = structuredClone(value); change(changed); assert.throws(() => validatePortableConfig(changed, 'staging-next'));
  }
  assert.throws(() => portableConnections(parsed, { ...credentials, runtimeDatabaseUrl: url('_migrator') }), /release_pg_connection_invalid/);
  assert.throws(() => portableConnections(parsed, { ...credentials, runtimeDatabaseUrl: url('_app').replace('fixture.pg.psdb.cloud', 'other.pg.psdb.cloud') }),
    /release_config_database_host_changed/);
});

function scheduledFixture() {
  const start = Date.now() - 600000, at = offset => new Date(start + offset).toISOString();
  const run = { id: 77, run_attempt: 1, workflow_id: 9, path: '.github/workflows/shared-backup.yml', event: 'schedule',
    repository: { id: REPOSITORY_ID }, head_repository: { id: REPOSITORY_ID }, head_branch: 'main', head_sha: main,
    status: 'completed', conclusion: 'success', actor: { login: 'teddashh', id: OPERATORS.teddashh },
    triggering_actor: { login: 'arumwu', id: OPERATORS.arumwu }, run_started_at: at(0), updated_at: at(300000) };
  const jobs = ['staging-next', 'next'].map(target => ({ name: `backup (${target})`, run_id: run.id, run_attempt: run.run_attempt,
    head_sha: main, status: 'completed', conclusion: 'success', steps: ['Execute scheduled backup', 'Save public backup receipt'].map(name => ({ name, status: 'completed', conclusion: 'success' })) }));
  const name = 'backup-result-staging-next-77-1';
  const artifact = { id: 99, name, expired: false, digest: 'sha256:' + 'a'.repeat(64),
    workflow_run: { id: 77, repository_id: REPOSITORY_ID, head_repository_id: REPOSITORY_ID, head_branch: 'main', head_sha: main } };
  const receipt = { format: 'freedom.shared-backup/v1', status: 'passed', event: 'schedule', mode: 'backup',
    providerOutcome: 'backup_and_restore_confirmed', operatorEvidence: 'validated-backup-phases/v1', repository: REPOSITORY,
    repositoryId: REPOSITORY_ID, controllerSha: main, target: 'staging-next', runId: 77, runAttempt: 1, sourceSha: sha, sourceTree: tree,
    operatorImage: installation.image, configSha256: installation.configSha256, original: run.actor, triggeredBy: run.triggering_actor,
    admittedAt: at(1000), completedAt: at(200000), phases: BACKUP_PHASES.map((name, i) => ({ name, status: 'passed',
      startedAt: at(2000 + i * 10000), completedAt: at(3000 + i * 10000) })) };
  const state = { run, jobs, artifact, receipt, latestId: 77 };
  const api = async path => {
    if (path.endsWith('/workflows/shared-backup.yml')) return { id: 9, path: run.path, state: 'active' };
    if (path.includes('/workflows/9/runs?')) return { total_count: 1, workflow_runs: [{ id: state.latestId }] };
    if (path.endsWith('/actions/runs/77')) return structuredClone(run);
    if (path.includes('/compare/')) return { status: 'identical', merge_base_commit: { sha: main } };
    if (path.includes('/jobs?')) return { total_count: jobs.length, jobs: structuredClone(jobs) };
    if (path.includes('/artifacts?')) return { total_count: 1, artifacts: [structuredClone(artifact)] };
    throw Error('unexpected scheduler fixture request');
  };
  api.readArtifact = async () => structuredClone(receipt);
  return { state, api, admission: { ...request(), mainShaObserved: main } };
}

test('natural backup handoff authenticates the completed main run, both jobs and exact environment artifact', async () => {
  const f = scheduledFixture(), proof = await requireScheduledBackup(f.api, f.admission, installation);
  assert.equal(proof.runId, 77); assert.equal(proof.runAttempt, 1); assert.equal(proof.artifactId, 99);
  assert.equal(proof.receiptSha256, hash(JSON.stringify(f.state.receipt)));
});

test('manual, failed, skipped, stale, foreign and forged backup evidence cannot authorize handoff', async () => {
  const mutations = [s => { s.run.event = 'workflow_dispatch'; }, s => { s.run.conclusion = 'failure'; },
    s => { s.run.head_repository.id = 123; }, s => { s.run.head_branch = 'feature'; },
    s => { s.jobs[0].steps[0].conclusion = 'skipped'; }, s => { s.artifact.expired = true; },
    s => { s.artifact.workflow_run.head_sha = sha; }, s => { s.receipt.target = 'next'; },
    s => { s.receipt.configSha256 = 'f'.repeat(64); }, s => { s.receipt.operatorEvidence = 'caller-asserted'; },
    s => { s.receipt.phases[1].status = 'failed'; }, s => { s.receipt.runAttempt = 2; }, s => { s.run.run_attempt = 2; },
    s => { s.receipt.completedAt = '2026-01-01T00:00:00Z'; }, s => { s.run.actor.id = 123; }];
  for (const change of mutations) {
    const f = scheduledFixture(); change(f.state); await assert.rejects(requireScheduledBackup(f.api, f.admission, installation));
  }
  const f = scheduledFixture(); f.api.readArtifact = async () => { f.state.run.run_attempt++; return structuredClone(f.state.receipt); };
  await assert.rejects(requireScheduledBackup(f.api, f.admission, installation), /release_schedule_run_invalid/);
});

test('backup and image entries validate their own main workflow identity and actual operator permissions', async () => {
  const env = { ...environment(), GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/shared-backup.yml@refs/heads/main`,
    GITHUB_EVENT_NAME: 'schedule', BACKUP_CRON };
  assert.equal(backupRequestFromEnvironment(env, sha).event, 'schedule');
  assert.throws(() => backupRequestFromEnvironment({ ...env, BACKUP_CRON: '* * * * *' }, sha));
  assert.throws(() => backupRequestFromEnvironment({ ...env, GITHUB_REF: 'refs/heads/feature' }, sha));
  const imageEnv = { ...environment(), CONTROLLER_SHA: sha,
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/release-operator-image.yml@refs/heads/main` };
  assert.equal((await admitImage(imageEnv, fixtureApi())).sourceSha, sha);
  await assert.rejects(admitImage({ ...imageEnv, GITHUB_ACTOR: 'unknown' }, fixtureApi()), /release_operator_not_allowed/);
  await assert.rejects(admitImage({ ...imageEnv, GITHUB_REF: 'refs/heads/feature' }, fixtureApi()), /release_image_workflow_invalid/);
});

test('backup operator receipt requires actual restore, cleanup, retained pins and release of the lease', () => {
  const admission = { ...request(), mode: 'backup' }, full = resultFixture(admission);
  const value = { ...full, format: 'freedom.shared-backup-operator-result/v1', phases: [
    { ...full.phases[0], previousSourceSha: sha }, { ...full.phases[5], name: 'backup' },
    { ...full.phases[6], sourcePinsRetained: true }] };
  assert.equal(validateBackupOperatorResult(value, admission, installation, 'e'.repeat(64)).length, 3);
  for (const [index, patch] of [[1, { remoteReadback: 'not_run' }], [1, { exposure: 'public' }],
    [2, { sourcePinsRetained: false }], [2, { leaseReleased: false }]]) {
    const changed = structuredClone(value); Object.assign(changed.phases[index], patch);
    assert.throws(() => validateBackupOperatorResult(changed, admission, installation, 'e'.repeat(64)));
  }
});

test('scheduled backup uses the same floor and cannot overlap or change the committed source', () => {
  const f = floorFixture(), request = { ...f.request, sourceSha: main }, begin = f.event('backup-begin', undefined, undefined, { request });
  f.add(begin); assert.throws(() => replayReleaseFloor([...f.chain, f.begin], f.options), /release_floor_unsettled/);
  const state = f.runBackup('backup', main); assert.equal(state.pending, null); assert.equal(state.sourceSha, main);
  const changed = structuredClone(begin); changed.record.data.request.sourceSha = sha;
  assert.throws(() => replayReleaseFloor([...f.chain, changed], f.options), /release_floor_backup_source_changed/);
});

function failedBackupFixture() {
  const f = scheduledFixture();
  Object.assign(f.state.run, { event: 'workflow_dispatch', conclusion: 'failure' });
  f.state.jobs.splice(1); f.state.jobs[0].conclusion = 'failure'; f.state.jobs[0].steps[0].conclusion = 'failure';
  Object.assign(f.state.receipt, { status: 'failed', event: 'workflow_dispatch', providerOutcome: 'unknown_until_confirmed' });
  delete f.state.receipt.operatorEvidence; f.state.receipt.phases = [];
  Object.assign(f.admission, { mode: 'backup', event: 'workflow_dispatch', recoverRunId: 77, sourceTree: tree });
  return f;
}

test('manual recovery authenticates a failed backup, not a caller-supplied cleanup claim', async () => {
  const f = failedBackupFixture(), proof = await requireFailedBackup(f.api, f.admission, installation);
  assert.equal(proof.runId, 77); assert.equal(proof.receiptSha256, hash(JSON.stringify(f.state.receipt)));
  assert.equal(proof.cleanupVerified, undefined);
  for (const mutate of [s => { s.run.status = 'in_progress'; }, s => { s.run.conclusion = 'success'; },
    s => { s.run.head_repository.id = 2; }, s => { s.run.head_branch = 'feature'; },
    s => { s.run.actor.id++; }, s => { s.run.run_attempt++; }, s => { s.jobs[0].steps[0].conclusion = 'skipped'; },
    s => { s.jobs[0].steps[1].conclusion = 'failure'; }, s => { s.receipt.target = 'next'; },
    s => { s.artifact.workflow_run.head_sha = sha; }, s => { s.artifact.expired = true; },
    s => { s.receipt.sourceSha = main; }, s => { s.receipt.configSha256 = 'f'.repeat(64); }]) {
    const bad = failedBackupFixture(); mutate(bad.state);
    await assert.rejects(requireFailedBackup(bad.api, bad.admission, installation));
  }
  const changed = failedBackupFixture(); changed.api.readArtifact = async () => {
    changed.state.run.run_attempt++; return structuredClone(changed.state.receipt);
  };
  await assert.rejects(requireFailedBackup(changed.api, changed.admission, installation));
});

test('backup recovery input is explicit, manual-only and cannot name the current run', () => {
  const env = { ...environment(), GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/shared-backup.yml@refs/heads/main`,
    BACKUP_RECOVER_RUN_ID: '77' };
  assert.equal(backupRequestFromEnvironment(env, sha).recoverRunId, 77);
  for (const value of ['100', '0', '-1', '1e2', '77\n', 'abc']) {
    assert.throws(() => backupRequestFromEnvironment({ ...env, BACKUP_RECOVER_RUN_ID: value }, sha));
  }
  assert.throws(() => backupRequestFromEnvironment({ ...env, GITHUB_EVENT_NAME: 'schedule', BACKUP_CRON }, sha));
});

test('abandoned backup keeps history and floor; archive, release and unverified cleanup remain blocked', () => {
  const f = floorFixture(), old = { ...f.request, sourceSha: main };
  f.add(f.event('backup-begin', undefined, undefined, { request: old }));
  const capture = { format: 'freedom.shared-capture-policy-intent/v1', pid: 123, application: 'fp-capture-' + f.id,
    revision: 'shared-backup-' + f.id, before: '6'.repeat(64), automaticRetry: false };
  f.add(f.event('intent', 'backup', capture, { operation: 'capture-policy' }));
  const prior = replayReleaseFloor(f.chain, f.options).state;
  const proof = { format: 'freedom.abandoned-backup/v1', recovery: { ...old, format: 'freedom.verified-failed-backup/v1',
    receiptSha256: '9'.repeat(64), artifactId: 99, artifactDigest: 'sha256:' + '9'.repeat(64), completedAt: '2026-10-26T00:00:00Z' },
    settledBy: { ...old, runId: 13 }, sourceSha: main, sourceTree: tree, bindingsSha256: prior.bindingsSha256,
    ledgerSha256: migrationLedgerDigest(prior.schemaLedger), materialPolicySha256: prior.materialPolicySha256,
    maintenanceEnabled: false, domainMaintenanceEnabled: false, deletionFences: 0, captureBackendAbsent: true,
    captureRevision: capture.revision, sourcePins: 'retained', archiveIntent: 'absent', observedAt: '2026-10-26T01:00:00Z' };
  for (const patch of [{ maintenanceEnabled: true }, { domainMaintenanceEnabled: true }, { deletionFences: 1 },
    { captureBackendAbsent: false }, { captureRevision: 'other' }, { sourceSha: sha }, { sourcePins: 'released' },
    { materialPolicySha256: 'f'.repeat(64) }, { recovery: { ...proof.recovery, runId: 99 } }, { settledBy: old }]) {
    assert.throws(() => replayReleaseFloor([...f.chain, f.event('backup-abandoned', 'backup', { ...proof, ...patch })], f.options));
  }
  const archive = f.event('intent', 'backup', { setId: f.id, archiveSha256: '7'.repeat(64), bytes: 123, automaticRetry: false }, { operation: 'archive' });
  assert.throws(() => replayReleaseFloor([...f.chain, archive, f.event('backup-abandoned', 'backup', proof)], f.options));
  const g = floorFixture(); g.add(g.begin);
  assert.throws(() => replayReleaseFloor([...g.chain, g.event('backup-abandoned', 'backup-before', proof)], g.options));
  const state = f.add(f.event('backup-abandoned', 'backup', proof));
  assert.deepEqual(state, { ...prior, pending: null }); assert.equal(f.chain.length, 4);
  assert.equal(f.chain[2].record.data.kind, 'intent');
});

async function environmentCheckFixture(t, decisions, liveFlags) {
  const f = await deployFixture(t, decisions, liveFlags), calls = [];
  const value = { format: 'freedom.shared-release-config/v1', target: 'staging-next', accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32),
    mediaBucket: 'fixture-media', backupBucket: 'fixture-backups',
    database: { name: 'freedom_staging_next', host: 'fixture.pg.psdb.cloud', port: '5432', loginSuffix: 'fixture' },
    floor: { epoch: '11111111-1111-4111-8111-111111111111', seedSha256: 'c'.repeat(64) },
    migrationProfile: { format: 'freedom.migrations/legacy-v1', first: 1, last: 189, known_gaps: [22] } };
  const config = JSON.stringify(value), env = { RELEASE_CONFIG_JSON: config, RELEASE_CONFIG_SHA256: hash(config),
    CLOUDFLARE_API_TOKEN: 'fixture-management-secret', CF_ACCESS_CLIENT_ID: 'fixture-access-id', CF_ACCESS_CLIENT_SECRET: 'fixture-access-secret',
    RELEASE_ENABLED: 'false', BACKUP_ENABLED: 'false' };
  const fetchImpl = async (address, options) => {
    const url = new URL(address); calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, url.origin === 'https://staging.freetwai.com'
      || url.pathname.endsWith('/tokens/verify') || url.pathname.includes('/r2/buckets/') ? 'manual' : 'error');
    if (url.origin === 'https://api.cloudflare.com') {
      assert.equal(options.headers.Authorization, 'Bearer ' + env.CLOUDFLARE_API_TOKEN);
      assert(!('CF-Access-Client-Id' in options.headers)); assert(!('CF-Access-Client-Secret' in options.headers));
      if (url.pathname.endsWith('/tokens/verify')) return Response.json({ success: true, result: { status: 'active' } });
      if (url.pathname.includes('/r2/buckets/')) return Response.json({ success: true, result: [{ key: 'private-object-do-not-publish' }] });
      return f.fetchImpl(address, options);
    }
    assert.equal(url.href, 'https://staging.freetwai.com/api/v1/health');
    assert.equal(options.headers['CF-Access-Client-Id'], env.CF_ACCESS_CLIENT_ID);
    assert.equal(options.headers['CF-Access-Client-Secret'], env.CF_ACCESS_CLIENT_SECRET);
    assert(!('Authorization' in options.headers));
    return Response.json({ status: 'ok', release_sha: f.before.sourceSha, private: 'private-health-do-not-publish' });
  };
  return { env, value, fetchImpl, calls, f };
}

test('credential check works with releases disabled, makes only GETs and never attests a deployment', async t => {
  const f = await environmentCheckFixture(t);
  assert.equal(requestFromEnvironment({ ...environment(), RELEASE_MODE: 'check' }).mode, 'check');
  const report = await checkEnvironment(f.env, 'staging-next', { fetchImpl: f.fetchImpl });
  assert.equal(report.status, 'passed'); assert.equal(report.checks.length, 5);
  assert.equal(report.cloudflareTokenKind, 'account');
  assert.equal(report.observedSourceSha, f.f.before.sourceSha);
  assert.equal(report.healthSourceSha, report.observedSourceSha);
  assert.equal(report.databaseCredentials, 'not_checked'); assert.equal(report.writePermissions, 'not_checked');
  assert.equal(report.deployment, 'not_run'); assert.equal(report.backupAndRestore, 'not_run');
  assert(f.calls.length > 5);
  const serialized = JSON.stringify(report);
  for (const secret of [f.env.CLOUDFLARE_API_TOKEN, f.env.CF_ACCESS_CLIENT_SECRET, f.env.CF_ACCESS_CLIENT_ID,
    'private-object-do-not-publish', 'private-health-do-not-publish', 'fixture-backups', 'fixture.pg.psdb.cloud']) assert(!serialized.includes(secret));
});

test('credential diagnostics retain named failures without leaking provider bodies or exception messages', async t => {
  const f = await environmentCheckFixture(t);
  const report = await checkEnvironment(f.env, 'staging-next', { fetchImpl: async (url, options) => {
    if (url.includes('/tokens/verify')) return new Response('private-api-body', { status: 403 });
    if (url.includes('/r2/buckets/fixture-backups/')) throw Error('private-exception-' + f.env.CLOUDFLARE_API_TOKEN);
    if (url.startsWith('https://staging.')) return new Response('private-access-body', { status: 302 });
    return f.fetchImpl(url, options);
  } });
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.checks.map(c => c.status), ['failed', 'passed', 'passed', 'failed', 'failed']);
  assert.equal(report.checks[0].httpStatus, 403); assert.equal(report.checks[4].httpStatus, 302);
  assert.equal(report.checks[4].error, 'release_environment_redirect_rejected');
  assert(!JSON.stringify(report).includes('private-')); assert(!JSON.stringify(report).includes(f.env.CLOUDFLARE_API_TOKEN));
});

test('an active user token is identified without accepting it as an account service credential', async t => {
  const f = await environmentCheckFixture(t), tokenPaths = [];
  const report = await checkEnvironment(f.env, 'staging-next', { fetchImpl: async (url, options) => {
    if (url.endsWith('/tokens/verify')) {
      tokenPaths.push(new URL(url).pathname);
      if (url.includes('/accounts/')) return new Response('private-account-error', { status: 401 });
      assert.equal(options.redirect, 'manual'); assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer ' + f.env.CLOUDFLARE_API_TOKEN);
      return Response.json({ success: true, result: { status: 'active', id: 'private-token-id' } });
    }
    return f.fetchImpl(url, options);
  } });
  assert.deepEqual(tokenPaths, ['/client/v4/accounts/' + 'a'.repeat(32) + '/tokens/verify', '/client/v4/user/tokens/verify']);
  assert.equal(report.status, 'failed'); assert.equal(report.cloudflareTokenKind, 'user');
  assert.equal(report.checks[0].error, 'release_account_owned_token_required');
  assert.equal(report.checks[0].httpStatus, 401);
  assert(!JSON.stringify(report).includes('private-'));
});

test('token verification transport and server errors never trigger a user-token fallback', async t => {
  for (const failure of [() => { throw Error('private-network-detail'); }, () => new Response('private-api-detail', { status: 503 })]) {
    const f = await environmentCheckFixture(t); let attempts = 0;
    const report = await checkEnvironment(f.env, 'staging-next', { fetchImpl: (url, options) => {
      if (url.endsWith('/tokens/verify')) { attempts++; assert(url.includes('/accounts/')); return failure(); }
      return f.fetchImpl(url, options);
    } });
    assert.equal(attempts, 1); assert.equal(report.status, 'failed');
    assert.equal(report.cloudflareTokenKind, undefined); assert(!JSON.stringify(report).includes('private-'));
    assert(['release_environment_http_failed', 'release_environment_transport_failed'].includes(report.checks[0].error));
  }
});

test('real HTTP redirect is reported without following it or forwarding Access credentials', async t => {
  const f = await environmentCheckFixture(t), received = [];
  const server = createServer((req, res) => {
    received.push(req.url);
    res.writeHead(302, { Location: '/credential-sink?private-location-data' }); res.end('private-redirect-body');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const report = await checkEnvironment(f.env, 'staging-next', { fetchImpl: (url, options) => url.startsWith('https://staging.')
    ? fetch(`http://127.0.0.1:${server.address().port}/health`, options) : f.fetchImpl(url, options) });
  assert.deepEqual(received, ['/health']);
  assert.equal(report.checks.at(-1).httpStatus, 302);
  assert.equal(report.checks.at(-1).error, 'release_environment_redirect_rejected');
  assert.equal(report.status, 'failed'); assert(!JSON.stringify(report).includes('private-'));
});

test('credential checks reject wrong config pins before network and wrong health versions after reading', async t => {
  const f = await environmentCheckFixture(t);
  for (const env of [{ ...f.env, RELEASE_CONFIG_SHA256: 'f'.repeat(64) }, { ...f.env, RELEASE_CONFIG_JSON: '{}' }]) {
    await assert.rejects(checkEnvironment(env, 'staging-next', { fetchImpl() { assert.fail('no network for unpinned config'); } }), /release_config_pin_mismatch/);
  }
  const report = await checkEnvironment(f.env, 'staging-next', { fetchImpl: (url, options) => url.startsWith('https://staging.')
    ? Response.json({ status: 'ok', release_sha: 'f'.repeat(40) }) : f.fetchImpl(url, options) });
  assert.equal(report.status, 'failed'); assert.equal(report.checks.at(-1).error, 'release_environment_health_source_mismatch');
});

test('production health never receives staging service credentials even when they exist in the environment', async t => {
  const f = await environmentCheckFixture(t);
  const config = JSON.stringify({ ...f.value, target: 'next', database: { ...f.value.database, name: 'freedom_next' } });
  let health = 0;
  const report = await checkEnvironment({ ...f.env, RELEASE_CONFIG_JSON: config, RELEASE_CONFIG_SHA256: hash(config) }, 'next', {
    fetchImpl: async (url, options) => {
      assert(!('CF-Access-Client-Id' in options.headers)); assert(!('CF-Access-Client-Secret' in options.headers));
      if (url === 'https://freetwai.com/api/v1/health') {
        health++; assert(!('Authorization' in options.headers)); return Response.json({ status: 'ok', release_sha: sha });
      }
      return new Response('', { status: 403 });
    },
  });
  assert.equal(health, 1); assert.equal(report.checks.at(-1).name, 'public_health');
  assert.equal(report.checks.at(-1).status, 'passed'); assert.equal(report.status, 'failed');
});

test('public backup diagnostics accept only exact enumerated codes independently', () => {
  const value = resultFixture(); value.phases = value.phases.slice(0, 2); value.phases[1].status = 'failed';
  value.phases[1].backupFailure = { stage: 'preflight', code: 'daily_backup_cleanup_failed', cleanupVerified: false,
    phaseCode: 'backup_database_permission_denied', cleanupCode: 'release_backup_worker_changed' };
  const progress = () => operatorProgress(value, request(), installation, 'e'.repeat(64)).at(-1).backupFailure;
  assert.equal(progress().phaseCode, 'backup_database_permission_denied');
  assert.equal(progress().cleanupCode, 'release_backup_worker_changed');
  for (const secret of ['private-token', 'release_backup_private_token', 'release_backup_worker_changed\nsecret', { code: 'secret' }]) {
    Object.assign(value.phases[1].backupFailure, { phaseCode: secret, cleanupCode: secret });
    assert.equal(progress().phaseCode, undefined); assert.equal(progress().cleanupCode, undefined);
  }
});

test('BEGIN-only eligibility is derived from authenticated pre-capture progress, not caller claims', async () => {
  const setup = () => { const f = failedBackupFixture(); f.state.receipt.operatorProgress = [
    { name: 'preflight', reportedStatus: 'passed' }, { name: 'backup', reportedStatus: 'failed',
      backupFailure: { stage: 'preflight', snapshotDump: 'not_started', cleanupVerified: false } }]; return f; };
  const f = setup(); assert.equal((await requireFailedBackup(f.api, f.admission, installation)).failureBoundary, 'before_capture');
  for (const mutate of [p => { p.pop(); }, p => { p[0].reportedStatus = 'failed'; },
    p => { p[1].backupFailure.stage = 'seal'; }, p => { p[1].backupFailure.snapshotDump = 'running'; },
    p => { delete p[1].backupFailure; }, p => { p[1].reportedStatus = 'passed'; }]) {
    const bad = setup(); mutate(bad.state.receipt.operatorProgress);
    assert.equal((await requireFailedBackup(bad.api, bad.admission, installation)).failureBoundary, undefined);
  }
});

test('BEGIN-only floor recovery preserves history and refuses intents, unrelated runs and missing readback', () => {
  const f = floorFixture(), old = { ...f.request, sourceSha: main };
  f.add(f.event('backup-begin', undefined, undefined, { request: old }));
  const prior = replayReleaseFloor(f.chain, f.options).state;
  const proof = { format: 'freedom.abandoned-backup/v1', recovery: { ...old, format: 'freedom.verified-failed-backup/v1',
    failureBoundary: 'before_capture', receiptSha256: '9'.repeat(64), artifactId: 99,
    artifactDigest: 'sha256:' + '9'.repeat(64), completedAt: '2026-10-26T00:00:00Z' },
    settledBy: { ...old, runId: 13 }, sourceSha: main, sourceTree: tree, bindingsSha256: prior.bindingsSha256,
    ledgerSha256: migrationLedgerDigest(prior.schemaLedger), materialPolicySha256: prior.materialPolicySha256,
    failureBoundary: 'before_capture', maintenanceEnabled: false, domainMaintenanceEnabled: false,
    deletionFences: 0, captureBackendAbsent: true, sourcePins: 'retained', archiveIntent: 'absent',
    observedAt: '2026-10-26T01:00:00Z' };
  for (const patch of [{ failureBoundary: undefined }, { captureBackendAbsent: false }, { maintenanceEnabled: true },
    { deletionFences: 1 }, { ledgerSha256: 'f'.repeat(64) }, { recovery: { ...proof.recovery, failureBoundary: undefined } },
    { recovery: { ...proof.recovery, runId: 999 } }, { recovery: { ...proof.recovery, runAttempt: 2 } },
    { recovery: { ...proof.recovery, operatorImage: 'wrong' } }, { observedAt: '2026-10-25T00:00:00Z' }]) {
    assert.throws(() => replayReleaseFloor([...f.chain, f.event('backup-abandoned', 'backup', { ...proof, ...patch })], f.options));
  }
  const archive = f.event('intent', 'backup', { setId: f.id, archiveSha256: '7'.repeat(64), bytes: 123, automaticRetry: false }, { operation: 'archive' });
  assert.throws(() => replayReleaseFloor([...f.chain, archive, f.event('backup-abandoned', 'backup', proof)], f.options));
  const capture = f.event('intent', 'backup', { format: 'freedom.shared-capture-policy-intent/v1', pid: 123,
    application: 'fp-capture-' + f.id, revision: 'shared-backup-' + f.id, before: '6'.repeat(64), automaticRetry: false }, { operation: 'capture-policy' });
  assert.throws(() => replayReleaseFloor([...f.chain, capture, f.event('backup-abandoned', 'backup', proof)], f.options));
  const advanced = { ...proof, legacyPredecessor: legacyEvidenceFixture({admittedRunId: 13}) };
  assert.equal(replayReleaseFloor([...f.chain, f.event('backup-abandoned', 'backup', advanced)], f.options).state.pending, null);
  for (const patch of [{admittedRunId: 99}, {admittedRunAttempt: 2}, {sourceSha: 'f'.repeat(40)}])
    assert.throws(() => replayReleaseFloor([...f.chain, f.event('backup-abandoned', 'backup', {
      ...advanced, legacyPredecessor: {...advanced.legacyPredecessor, ...patch} })], f.options));
  assert.throws(() => replayReleaseFloor([...f.chain, capture, f.event('backup-abandoned', 'backup', advanced)], f.options));
  const state = f.add(f.event('backup-abandoned', 'backup', proof));
  assert.deepEqual(state, { ...prior, pending: null }); assert.equal(f.chain.length, 3);
  assert.equal(f.chain[1].record.data.kind, 'backup-begin');
});

function backupRecoveryFixture() {
  const f = floorFixture(), old = { ...f.request, sourceSha: main };
  f.add(f.event('backup-begin', undefined, undefined, { request: old }));
  const state = replayReleaseFloor(f.chain, f.options).state, material = [];
  state.materialPolicySha256 = hash(JSON.stringify(material));
  const evidence = { ...old, format: 'freedom.verified-failed-backup/v1', failureBoundary: 'before_capture' };
  const observations = { identity: { database: 'fixture', role: 'maintainer' },
    policy: { enabled: false, domain_media_enabled: false, revision: 'prior' }, backends: [], fences: 0, material };
  const calls = [], queries = []; let proof;
  const q = { async query(sql, values) {
    calls.push(sql); queries.push({ sql, values });
    if (sql.includes('current_database() database')) return { rows: [observations.identity] };
    if (sql.includes('FROM asset_maintenance_policy')) return { rows: [observations.policy] };
    if (sql.includes('FROM pg_stat_activity')) return { rows: observations.backends };
    if (sql.includes('FROM assets')) return { rows: [{ count: observations.fences }] };
    if (sql.includes('FROM domain_media_storage_policy')) return { rows: observations.material };
    return { rows: [] };
  }, release() { calls.push('release'); } };
  const args = { request: { ...old, runId: 13, mode: 'backup', event: 'workflow_dispatch', recoverRunId: old.runId,
    recoveryEvidence: evidence }, database: 'fixture', role: 'maintainer', pool: { options: { database: 'fixture', user: 'maintainer' }, connect: async () => q },
    floor: { state: () => structuredClone(state), assertCurrent: async () => calls.push('floor-current'),
      verifyDatabase: async () => calls.push('verify-ledger-and-coordinate-fence'), abandonBackup: async value => { proof = value; } },
    deployer: { inspect: async () => ({ sourceSha: main, bindingsSha256: state.bindingsSha256 }) },
    lease: { signal: new AbortController().signal, assertHeld() { calls.push('lease-held'); } } };
  return { args, observations, calls, queries, state, proof: () => proof };
}

test('BEGIN-only reconciliation requires independent read-only observations under the lease before append', async () => {
  const setup = backupRecoveryFixture;
  const good = setup(); await reconcileFailedBackup(good.args);
  assert.equal(good.proof().failureBoundary, 'before_capture'); assert.equal(good.proof().archiveIntent, 'absent');
  assert(good.calls.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert(good.calls.includes('verify-ledger-and-coordinate-fence'));
  assert(!good.calls.some(sql => /UPDATE|DELETE|pg_terminate_backend/.test(sql)));
  for (const mutate of [f => { f.observations.identity.role = 'other'; }, f => { f.observations.policy.enabled = true; },
    f => { f.observations.policy.domain_media_enabled = true; }, f => { f.observations.backends.push({ pid: 123 }); },
    f => { f.observations.fences = 1; }, f => { f.observations.material.push({ purpose: 'changed' }); },
    f => { f.args.floor.verifyDatabase = async () => { throw Error('ledger changed'); }; },
    f => { f.args.deployer.inspect = async () => ({ sourceSha: sha }); },
    f => { f.state.pending.request.runId++; }, f => { f.state.pending.intents.archive = {}; },
    f => { delete f.args.request.recoveryEvidence.failureBoundary; },
    f => { f.args.lease.assertHeld = () => { throw Error('lease lost'); }; }]) {
    const bad = setup(); mutate(bad); await assert.rejects(reconcileFailedBackup(bad.args)); assert.equal(bad.proof(), undefined);
  }
});

function codeResult() {
  const admission = { ...request(), releaseKind: 'independent' }, value = resultFixture(admission);
  value.phases = [value.phases[0], { ...value.phases[2], name: 'migration', outcome: 'unchanged', readOnly: true },
    value.phases[3], value.phases[4], value.phases[6]];
  delete value.phases[4].scheduledBackupsVerified;
  return { admission, value };
}
test('ordinary release validates schema, publication, health and lease cleanup without backup evidence', () => {
  assert.equal(requestFromEnvironment(environment()).releaseKind, 'independent');
  const { admission, value } = codeResult();
  assert.deepEqual(validateOperatorResult(value, admission, installation, 'e'.repeat(64)).map(p => p.name),
    ['preflight', 'migration', 'deploy', 'health', 'handoff']);
  for (const [index, patch] of [[0, { leaseHeld: false }], [1, { outcome: 'committed' }], [1, { readOnly: false }],
    [1, { ledgerVerified: false }], [1, { runtimeGrantsVerified: false }], [2, { sourceSha: main }],
    [3, { smokePassed: false }], [4, { leaseReleased: false }]]) {
    const bad = structuredClone(value); Object.assign(bad.phases[index], patch);
    assert.throws(() => validateOperatorResult(bad, admission, installation, 'e'.repeat(64)));
  }
  assert.throws(() => validateOperatorResult(resultFixture(admission), admission, installation, 'e'.repeat(64)));
});
test('production accepts authenticated independent staging receipt and rejects legacy or forged substitutes', async () => {
  const f = stagingFixture(), admission = { ...request(), sourceTree: tree, target: 'next', mainShaObserved: main, releaseKind: 'independent' };
  Object.assign(f.state.receipt, { releaseKind: 'independent', providerOutcome: 'release_confirmed',
    operatorEvidence: 'validated-independent-release/v1', phases: codeResult().value.phases });
  await requireStaging(f.api, admission, installation);
  const legacy = stagingFixture(); await requireStaging(legacy.api, admission, installation);
  for (const patch of [{ releaseKind: undefined }, { providerOutcome: 'release_and_recovery_confirmed' },
    { operatorEvidence: 'validated-seven-phases/v1' }, { sourceSha: main }, { phases: resultFixture().phases }]) {
    const old = { ...f.state.receipt }; Object.assign(f.state.receipt, patch);
    await assert.rejects(requireStaging(f.api, admission, installation)); Object.assign(f.state.receipt, old);
  }
});
test('independent floor advances source after health while retaining ledger and rejecting schema changes or overlapping intents', () => {
  const f = floorFixture(), before = structuredClone(f.chain[0].record.data.state);
  const begin = f.event('release-begin-v2', undefined, undefined, { request: { ...f.request, releaseKind: 'independent' },
    candidate: { sourceSha: sha, sourceTree: tree, schemaLedger: before.schemaLedger } });
  const bad = structuredClone(begin); bad.record.data.candidate.schemaLedger.push({ name: '002_added.sql', sha256: '2'.repeat(64) });
  const pending = replayReleaseFloor([...f.chain, bad], f.options).state.pending;
  assert.equal(pending.candidate.schemaLedger.length, 2); // Approved schema changes are reachable.
  assert.throws(() => replayReleaseFloor([...f.chain, bad, f.event('passed', 'migration', { outcome: 'unchanged', readOnly: true,
    ledgerVerified: true, runtimeGrantsVerified: true, ledgerSha256: migrationLedgerDigest(before.schemaLedger) })], f.options));
  f.add(begin);
  assert.throws(() => replayReleaseFloor([...f.chain, begin], f.options), /release_floor_unsettled/);
  const schema = { outcome: 'unchanged', readOnly: true, ledgerVerified: true, runtimeGrantsVerified: true,
    ledgerSha256: migrationLedgerDigest(before.schemaLedger) };
  assert.throws(() => replayReleaseFloor([...f.chain, f.event('passed', 'migration', { ...schema, readOnly: false })], f.options));
  f.add(f.event('passed', 'migration', schema));
  f.add(f.event('intent', 'deploy', { sourceSha: sha, previousSourceSha: main, previousVersion: f.id,
    configSha256: '3'.repeat(64), automaticRetry: false }, { operation: 'publish' }));
  f.add(f.event('passed', 'deploy', { sourceSha: sha, providerConfirmed: true, versionId: f.id }));
  f.add(f.event('passed', 'health', { sourceSha: sha, statusCode: 200, schemaVerified: true, smokePassed: true }));
  const final = f.add(f.event('passed', 'handoff', { cleanupVerified: true, migrationVerified: true }));
  assert.equal(final.sourceSha, sha); assert.equal(final.deployedSourceSha, sha); assert.equal(final.pending, null);
  assert.deepEqual(final.schemaLedger, before.schemaLedger); assert.equal(final.schemaVersion, before.schemaVersion);
  assert(!JSON.stringify(f.chain).includes('backup-before'));
});
test('deploy reconciliation accepts only an authenticated failed pre-capture backup, not capture or arbitrary input', async () => {
  const f = failedBackupFixture();
  Object.assign(f.admission, { mode: 'deploy', releaseKind: 'independent', sourceSha: main });
  await assert.rejects(requireFailedBackup(f.api, f.admission, installation), /release_backup_recovery_boundary_invalid/);
  f.state.receipt.operatorProgress = [{ name: 'preflight', reportedStatus: 'passed' },
    { name: 'backup', reportedStatus: 'failed', backupFailure: { stage: 'preflight', snapshotDump: 'not_started' } }];
  const proof = await requireFailedBackup(f.api, f.admission, installation);
  assert.equal(proof.sourceSha, sha); assert.equal(proof.failureBoundary, 'before_capture');
  for (const value of ['100', '-1', '77\n', '0', '1e2']) {
    assert.throws(() => requestFromEnvironment({ ...environment(), RELEASE_MODE: 'deploy', RELEASE_RECOVER_BACKUP_RUN_ID: value }));
  }
  assert.equal(requestFromEnvironment({ ...environment(), RELEASE_MODE: 'deploy', RELEASE_RECOVER_BACKUP_RUN_ID: '77' }).recoverRunId, 77);
  assert.throws(() => requestFromEnvironment({ ...environment(), RELEASE_RECOVER_BACKUP_RUN_ID: '77' }));
});
test('release source has no scheduler dependency, backup calls remain conditional and daily schedule is unchanged', async () => {
  const cli = await readFile(new URL('../../shared-release/cli.mjs', import.meta.url), 'utf8');
  assert(!cli.includes('requireScheduledBackup')); assert(!cli.includes('scheduleEvidence'));
  const entry = await readFile(new URL('../../shared-release/portable/entry.mjs', import.meta.url), 'utf8');
  assert(entry.includes("if (!independentRelease) await phase('backup-after'"));
  assert(entry.includes("const proof = plan.pending.length === 0"));
  assert(entry.includes('independent: true'));
  const backup = await readFile(new URL('../../../.github/workflows/shared-backup.yml', import.meta.url), 'utf8');
  assert(backup.includes("cron: '43 5 * * *'")); assert(backup.includes('group: shared-release'));
});

test('independent controller runs without backup credentials or schedule evidence and binds five phases', async t => {
  const fixture = await operatorFixture(t), { admission, value } = codeResult();
  fixture.options.admission = admission; delete fixture.options.credentials.backupDatabaseUrl;
  const oldRun = fixture.options.run;
  fixture.options.run = async (cmd, args, ...rest) => {
    if (args[0] !== 'run') return oldRun(cmd, args, ...rest);
    const input = await readFile(join(fixture.temporaryRoot, 'input/request.json'), 'utf8');
    const request = JSON.parse(input), credentials = JSON.parse(await readFile(join(fixture.temporaryRoot, 'input/credentials.json'), 'utf8'));
    assert.equal(request.scheduleEvidence, undefined); assert.equal(credentials.backupDatabaseUrl, undefined);
    assert.deepEqual(request.requiredPhases, ['preflight', 'migration', 'deploy', 'health', 'handoff']);
    await writeFile(join(fixture.temporaryRoot, 'output/result.json'), JSON.stringify({ ...value, requestSha256: hash(input) }));
  };
  assert.equal((await runOperator(fixture.options)).length, 5);
});

test('independent release executes confirmed migration journal transitions without backup events', () => {
  const f = floorFixture();
  const begin = structuredClone(f.begin); begin.record.data.kind = 'release-begin-v2';
  begin.record.data.request.releaseKind = 'independent'; f.add(begin);
  const confirmed = { ...f.commit, ledger: f.after };
  assert.throws(() => replayReleaseFloor([...f.chain, f.event('committed', 'migration', confirmed)], f.options), /release_floor_commit_unverified/);
  f.add(f.event('intent', 'migration', f.commit, { operation: 'commit' }));
  const uncertain = structuredClone(f.chain);
  assert.throws(() => replayReleaseFloor([...uncertain, begin], f.options), /release_floor_unsettled/);
  assert.throws(() => replayReleaseFloor([...uncertain, f.event('passed', 'migration', {
    outcome: 'unchanged', readOnly: true, ledgerVerified: true, runtimeGrantsVerified: true,
    ledgerSha256: migrationLedgerDigest(f.before) })], f.options));
  const state = f.add(f.event('committed', 'migration', confirmed));
  assert.equal(state.schemaVersion, 2); assert.equal(state.sourceSha, sha);
  f.add(f.event('passed', 'migration', { outcome: 'committed', transactionId: '123', commitStatus: 'confirmed',
    ledgerVerified: true, runtimeGrantsVerified: true, ledgerSha256: migrationLedgerDigest(f.after) }));
  f.add(f.event('intent', 'deploy', { sourceSha: sha, previousSourceSha: main, previousVersion: f.id,
    configSha256: '8'.repeat(64), automaticRetry: false }, { operation: 'publish' }));
  f.add(f.event('passed', 'deploy', { sourceSha: sha, providerConfirmed: true, versionId: f.id }));
  f.add(f.event('passed', 'health', { sourceSha: sha, statusCode: 200, schemaVerified: true, smokePassed: true }));
  assert.equal(f.add(f.event('passed', 'handoff', { cleanupVerified: true, migrationVerified: true })).pending, null);
  assert(!f.chain.some(item => item.record.data.stage?.startsWith('backup')));
  const { admission, value } = codeResult();
  Object.assign(value.phases[1], { outcome: 'committed', commitStatus: 'confirmed', transactionId: '123' });
  delete value.phases[1].readOnly;
  assert.equal(validateOperatorResult(value, admission, installation, 'e'.repeat(64)).length, 5);
  value.phases[1].commitStatus = 'unknown';
  assert.throws(() => validateOperatorResult(value, admission, installation, 'e'.repeat(64)), /release_schema_unconfirmed/);
});

test('independent migration preflight read failure never begins a durable release', async t => {
  const root = await diskFixture(t, 'migration-preflight-'); let began = 0, released = false;
  const client = { on() {}, removeListener() {}, release() { released = true; }, async query(input) {
    const sql = typeof input === 'string' ? input : input.text;
    if (sql.startsWith('SELECT current_database()')) return { rows: [{ database: 'fixture', role: 'fixture_migrator',
      session_role: 'fixture_migrator', schema: 'public' }] };
    if (sql.includes('FROM schema_migrations')) throw Error('synthetic transient preflight read');
    return { rows: [], command: sql };
  } };
  await assert.rejects(runPortableMigration({ pool: { connect: async () => client }, database: 'fixture',
    plan: { sourceCommit: sha, sourceTree: tree, canonical: { sourceCommit: sha } },
    expected: { materialPolicySha256: 'a'.repeat(64), rlsTables: ['fixture'], runtimeUnreadable: [], tablePrivileges: [] },
    previousSourceSha: main, journalRoot: root, independent: true, beginMutation: async () => { began++; },
    lease: { signal: new AbortController().signal, assertHeld() {} }, assertFloor: async () => {},
    verifyRetainedConstraints: async () => {}, retainCommitIntent: async () => { assert.fail('no commit intent'); },
    retainCommittedFloor: async () => { assert.fail('no committed floor'); } }), /synthetic transient preflight read/);
  assert.equal(began, 0); assert.equal(released, true);
  const entry = await readFile(new URL('../../shared-release/portable/entry.mjs', import.meta.url), 'utf8');
  assert(entry.indexOf('unchangedProof = await verifyUnchangedSchema') < entry.indexOf('const begin = () => floor.beginIndependent'));
});

function legacyEvidenceFixture(extra = {}) {
  return { format: 'freedom.verified-legacy-deployment/v1', target: 'staging-next', sourceSha: sha, sourceTree: tree,
    deploymentId: 100, statusId: 101, admittedRunId: 12, admittedRunAttempt: 1,
    completedAt: '2026-10-26T00:00:00Z', verification: [{workflow: '.github/workflows/verify.yml'}, {workflow: '.github/workflows/codeql.yml'}], ...extra };
}

test('legacy pre-adoption failure preserves predecessor for retry; later failures and uncertain POST stay recorded', async t => {
  const root = await mkdtemp(join(tmpdir(), 'legacy-retry-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const previousExitCode = process.exitCode; t.after(() => { process.exitCode = previousExitCode; });
  const source = join(root, 'source'); await mkdir(source);
  fixtureGit(source, ['init', '-q']); await writeFile(join(source, 'app.txt'), 'synthetic source');
  fixtureGit(source, ['add', '.']); fixtureGit(source, ['commit', '-qm', 'fixture']);
  const sourceSha = fixtureGit(source, ['rev-parse', 'HEAD']), sourceTree = fixtureGit(source, ['rev-parse', 'HEAD^{tree}']);
  const creator = {login: 'teddashh', id: OPERATORS.teddashh};
  let runId = 200;
  for (const boundary of ['pull', 'preflight', 'after-adoption', 'uncertain-post']) {
    const deployments = [{id: 100, environment: 'staging-next', task: 'deploy', sha: sourceSha, payload: {}, creator}];
    const statuses = []; let posts = 0, executions = 0;
    const read = fixtureApi(path => path.includes('/deployments?') ? deployments
      : path.includes('/statuses?') ? [{id: 101, state: 'success', creator, created_at: '2026-10-26T00:00:00Z'}]
      : path.includes('/commits/') ? {sha: sourceSha, commit: {tree: {sha: sourceTree}}} : undefined);
    const api = async (path, options) => {
      if (options?.method === 'POST') {
        if (path.endsWith('/deployments')) {
          posts++; deployments.unshift({...options.body, sha: options.body.ref, id: 200, creator});
          if (boundary === 'uncertain-post') throw Error('synthetic reply lost after POST');
          return deployments[0];
        }
        assert(path.endsWith('/deployments/200/statuses')); statuses.push(options.body.state); return {};
      }
      const value = await read(path);
      if (/\/actions\/runs\/\d+$/.test(path)) value.head_sha = sourceSha;
      return value;
    };
    const invoke = async executeOperator => {
      const runner = join(root, String(++runId)); await mkdir(runner);
      process.exitCode = previousExitCode;
      await releaseMain({...environment(), PATH: process.env.PATH, RELEASE_SHA: sourceSha, RELEASE_MODE: 'deploy', RELEASE_COMMAND: 'execute',
        GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: runner, RELEASE_SOURCE_DIRECTORY: source,
        RELEASE_ENABLED: 'true', RELEASE_OPERATOR_IMAGE: installation.image, RELEASE_CONFIG_SHA256: installation.configSha256,
        PUBLIC_RECEIPT_DIRECTORY: join(runner, 'public'), GITHUB_STEP_SUMMARY: join(runner, 'summary.md')}, {api, executeOperator: async options => {
          executions++; assert.equal(options.admission.legacyPredecessor.deploymentId, 100);
          return executeOperator(options);
        }});
      const receipt = JSON.parse(await readFile(join(runner, 'public/receipt.json'), 'utf8'));
      const failureCode = receipt.operatorProgress?.at(-1)?.failureCode;
      if (failureCode) assert((await readFile(join(runner, 'summary.md'), 'utf8')).includes(`- Failed phase: \`${failureCode}\``));
      return receipt;
    };
    const passed = [{name: 'preflight', reportedStatus: 'passed'}];
    const failed = await invoke(async ({onProgress}) => {
      if (boundary === 'preflight') await onProgress([{name: 'preflight', reportedStatus: 'failed', failureCode: 'release_floor_unsettled'}]);
      if (boundary === 'after-adoption') await onProgress([...passed, {name: 'migration', reportedStatus: 'failed'}]);
      if (boundary === 'uncertain-post') {
        // The operator's progress observer catches callback errors. Final creation
        // must still surface the original uncertainty, never send a second POST.
        await onProgress(passed).catch(() => {}); await onProgress(passed).catch(() => {});
        return codeResult().value.phases;
      }
      throw Object.assign(Error('synthetic failed boundary'), {code: boundary === 'pull' ? 'release_registry_pull_failed' : 'release_operator_failed'});
    });
    assert.equal(failed.status, 'failed'); assert.equal(executions, 1, failed.error);
    assert.equal(failed.providerOutcome, 'unknown_until_confirmed');
    if (['pull', 'preflight'].includes(boundary)) {
      assert.equal(posts, 0); assert.equal(deployments[0].id, 100); assert.equal(failed.deploymentId, undefined);
      const retried = await invoke(async ({onProgress}) => {
        await onProgress(passed); await onProgress(passed);
        assert.equal(posts, 1); return codeResult().value.phases;
      });
      assert.equal(retried.status, 'passed'); assert.equal(retried.deploymentId, 200);
      assert.equal(posts, 1); assert.deepEqual(statuses, ['in_progress', 'success']);
    } else {
      assert.equal(posts, 1); assert.equal(deployments[0].id, 200);
      if (boundary === 'after-adoption') assert.deepEqual(statuses, ['in_progress', 'failure']);
      else assert.deepEqual(statuses, []);
    }
  }
});

test('legacy predecessor requires latest successful authorized deployment and exact main CI', async () => {
  const creator = { login: 'teddashh', id: OPERATORS.teddashh };
  const deployment = { id: 100, environment: 'staging-next', task: 'deploy', sha, payload: {}, creator };
  const status = { id: 101, state: 'success', creator, created_at: '2026-10-26T00:00:00Z' };
  const setup = (d = deployment, s = status, override = () => undefined) => fixtureApi(path => override(path)
    ?? (path.includes('/deployments?') ? [d] : path.includes('/statuses?') ? [s] : undefined));
  const admission = { ...request(), sourceSha: main, target: 'staging-next' };
  const proof = await requireLegacyPredecessor(setup(), admission);
  assert.equal(proof.sourceSha, sha); assert.equal(proof.deploymentId, 100); assert.equal(proof.verification.length, 2);
  assert.equal(await requireLegacyPredecessor(setup({...deployment, payload: {format: 'freedom.shared-release/v1'}}), admission), undefined);
  for (const patch of [{state: 'failure'}, {state: 'in_progress'}, {creator: {login: 'unknown', id: 1}}, {id: 0}])
    await assert.rejects(requireLegacyPredecessor(setup(deployment, {...status, ...patch}), admission));
  for (const patch of [{sha: 'invalid'}, {creator: {...creator, id: 9}}, {payload: {unknown: true}}])
    await assert.rejects(requireLegacyPredecessor(setup({...deployment, ...patch}), admission));
  await assert.rejects(requireLegacyPredecessor(setup(deployment, status, path => path.includes('/actions/runs/11')
    ? {status: 'completed', conclusion: 'failure'} : undefined), admission));
  let reads = 0;
  await assert.rejects(requireLegacyPredecessor(setup(deployment, status, path => path.includes('/deployments?')
    ? [{...deployment, id: ++reads === 1 ? 100 : 102}] : undefined), admission), /release_legacy_deployment_changed/);
});

test('legacy journal adoption appends source history without changing schema or original seed', () => {
  const f = floorFixture(), original = JSON.stringify(f.chain[0]), state = replayReleaseFloor(f.chain, f.options).state;
  const proof = { evidence: legacyEvidenceFixture(), previousSourceSha: main, bindingsSha256: state.bindingsSha256,
    ledgerSha256: migrationLedgerDigest(state.schemaLedger), materialPolicySha256: state.materialPolicySha256,
    readOnly: true, observedAt: '2026-10-26T01:00:00Z' };
  const adopted = replayReleaseFloor([...f.chain, f.event('legacy-source-adopted', undefined, proof)], f.options).state;
  assert.equal(adopted.sourceSha, sha); assert.equal(adopted.deployedSourceSha, sha);
  assert.deepEqual(adopted.schemaLedger, state.schemaLedger); assert.equal(JSON.stringify(f.chain[0]), original);
  for (const patch of [{readOnly: false}, {previousSourceSha: sha}, {ledgerSha256: '0'.repeat(64)},
    {bindingsSha256: '0'.repeat(64)}, {materialPolicySha256: '0'.repeat(64)},
    {evidence: legacyEvidenceFixture({sourceSha: 'f'.repeat(40)})}])
    assert.throws(() => replayReleaseFloor([...f.chain, f.event('legacy-source-adopted', undefined, {...proof, ...patch})], f.options));
  f.add(f.begin);
  assert.throws(() => replayReleaseFloor([...f.chain, f.event('legacy-source-adopted', undefined, proof)], f.options));
});

test('legacy adoption verifies immutable Git SQL and live read-only state before appending', async t => {
  const f = await adoptionFixture(t), floor = await f.open();
  await writeFile(join(f.sourceRoot, 'app.txt'), 'new legacy deployment'); const deployed = f.commit();
  const evidence = legacyEvidenceFixture(deployed), calls = []; let appended;
  const state = floor.state();
  const q = { async query(sql) { calls.push(sql); return { rows: sql.includes('domain_media_storage_policy')
    ? f.legacy.retained172.materialPolicy.policies : [] }; }, release() {} };
  const args = { floor: {...floor, verifyDatabase: async () => calls.push('verify-ledger'),
    adoptLegacySource: async proof => { appended = proof; }}, pool: {connect: async () => q},
    deployer: {inspect: async () => ({sourceSha: deployed.sourceSha, bindingsSha256: state.bindingsSha256})},
    lease: {signal: new AbortController().signal, assertHeld() {}},
    request: {...request(), runId: 12, runAttempt: 1, releaseKind: 'independent', target: 'staging-next', legacyPredecessor: evidence} };
  await adoptLegacyPredecessor(args); assert.equal(appended.evidence.sourceSha, deployed.sourceSha);
  assert(calls.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')); assert(calls.includes('verify-ledger'));
  assert(!calls.some(sql => /UPDATE|DELETE|INSERT|CREATE/.test(sql)));
  for (const patch of [{sourceTree: f.previous.sourceTree}, {target: 'next'}, {sourceSha: f.previous.sourceSha}]) {
    appended = undefined;
    await assert.rejects(adoptLegacyPredecessor({...args, request: {...args.request, legacyPredecessor: {...evidence, ...patch}}}));
    assert.equal(appended, undefined);
  }
  await writeFile(join(f.sourceRoot, 'migrations/190_forbidden.sql'), 'SELECT 1;'); const schemaChange = f.commit();
  assert.throws(() => floor.verifyLegacySource({...evidence, ...schemaChange}), /release_floor_adoption_catalog_changed/);
  appended = undefined;
  await assert.rejects(adoptLegacyPredecessor({...args, floor: {...args.floor, state: () => ({...state, pending: {kind: 'backup'}})}}));
  assert.equal(appended, undefined);
});

const flagName = 'FREEDOM_COMMERCE_CHECKOUT_ENABLED';
const flagRecord = 'https://github.com/FreeTWAI/freedom-platform/pull/1';
const flagDecision = (value = 'true') => ({ value, decidedBy: 'Ted', decidedAt: '2026-10-27', record: flagRecord });
const flagFile = (staging = { [flagName]: flagDecision() }, next = {}) => ({
  format: 'freedom.shared-release.flag-decisions/v1', targets: { 'staging-next': staging, next },
});
const maximalFlagDecisions = count => Object.fromEntries(Array.from({ length: count }, (_, index) => [
  `FREEDOM_${String(index).padStart(2, '0')}_`.padEnd(56, 'X') + '_ENABLED',
  { ...flagDecision(), record: (flagRecord + '#').padEnd(160, '\\') },
]));

test('normal deploy stops before operator, provider mutations and floor writes when GitHub creation fails', async t => {
  const previousExitCode = process.exitCode;
  try {
    for (const boundary of ['deployment', 'in_progress']) {
      const report = await environmentCheckFixture(t, flagFile()), f = report.f;
      const sourceTree = fixtureGit(f.args.sourceRoot, ['rev-parse', 'HEAD^{tree}']);
      const runner = join(f.args.workRoot, 'runner'), output = join(runner, 'public'); await mkdir(runner);
      let operators = 0, mutations = 0, floorWrites = 0;
      const writes = [], read = fixtureApi(path => path.includes('/deployments?') ? []
        : path.includes('/commits/') ? { sha: f.sourceSha, commit: { tree: { sha: sourceTree } } } : undefined);
      const api = async (path, options) => {
        if (options?.method === 'POST') {
          const operation = path.endsWith('/deployments') ? 'deployment' : options.body.state;
          writes.push(operation);
          if (operation === boundary) throw Error('synthetic GitHub write failed');
          if (operation === 'deployment') return { ...options.body, id: 1, sha: options.body.ref };
          assert(path.endsWith('/deployments/1/statuses')); return {};
        }
        const value = await read(path);
        if (/\/actions\/runs\/\d+$/.test(path)) value.head_sha = f.sourceSha;
        return value;
      };
      process.exitCode = previousExitCode;
      await releaseMain({ ...environment(), ...report.env, PATH: process.env.PATH, RELEASE_SHA: f.sourceSha,
        RELEASE_MODE: 'deploy', RELEASE_COMMAND: 'execute', RUNNER_TEMP: runner,
        RELEASE_SOURCE_DIRECTORY: f.args.sourceRoot, PUBLIC_RECEIPT_DIRECTORY: output,
        RELEASE_ENABLED: 'true', RELEASE_OPERATOR_IMAGE: installation.image,
      }, { api, async executeOperator({ admission }) {
        operators++; assert.equal(admission.legacyPredecessor, undefined);
        await f.deployer.publish({ ...f.args,
          async retainIntent() { floorWrites++; }, async execute() {
            mutations++; f.publish({ [flagName]: 'true' }); return { versionId: f.newVersion };
          }, sleep: async () => {},
        });
        return codeResult().value.phases;
      } });
      const receipt = JSON.parse(await readFile(join(output, 'receipt.json')));
      assert.equal(receipt.status, 'failed'); assert.equal(receipt.error, 'release_operation_failed');
      assert.equal(receipt.providerOutcome, 'not_started'); assert.equal(receipt.legacyPredecessor, undefined);
      assert.equal(process.exitCode, 1);
      assert.deepEqual(writes, boundary === 'deployment' ? ['deployment'] : ['deployment', 'in_progress', 'failure']);
      assert.equal(operators, 0); assert.equal(mutations, 0); assert.equal(floorWrites, 0);
      assert(report.calls.every(call => call.options.method === 'GET'));
    }
  } finally { process.exitCode = previousExitCode; }
});

test('16 maximal flag changes fit operator and public receipts through staging production admission', async t => {
  const decisions = maximalFlagDecisions(64);
  for (const [name, decision] of Object.entries(decisions)) {
    assert.equal(name.length, 64); assert.equal(decision.record.length, 160);
    assert.equal(new URL(decision.record).href, decision.record);
  }
  const liveFlags = Object.fromEntries(Object.keys(decisions).map((name, index) => [name, index < 16 ? 'false' : 'true']));
  const report = await environmentCheckFixture(t, flagFile(decisions), liveFlags), f = report.f;
  const expected = renderWorkerConfig({ ...f.args, target: 'staging-next' });
  assert.equal(expected.flagChanges.length, 16);
  const sourceTree = fixtureGit(f.args.sourceRoot, ['rev-parse', 'HEAD^{tree}']);
  const runner = join(f.args.workRoot, 'runner'), output = join(runner, 'public'); await mkdir(runner);
  const start = new Date().toISOString(); let deployment, operatorBytes, publishes = 0;
  const order = [];
  const read = fixtureApi(path => path.includes('/deployments?') ? []
    : path.includes('/commits/') ? { sha: f.sourceSha, commit: { tree: { sha: sourceTree } } } : undefined);
  const api = async (path, options) => {
    if (options?.method === 'POST') {
      if (path.endsWith('/deployments')) {
        order.push('deployment'); return deployment = { ...options.body, id: 1, sha: options.body.ref };
      }
      order.push(options.body.state);
      assert(path.endsWith('/deployments/1/statuses')); return {};
    }
    const value = await read(path);
    if (/\/actions\/runs\/\d+$/.test(path)) value.head_sha = f.sourceSha;
    return value;
  };
  const previousExitCode = process.exitCode;
  t.mock.method(globalThis, 'fetch', report.fetchImpl);
  try {
    await releaseMain({ ...environment(), ...report.env, PATH: process.env.PATH, RELEASE_SHA: f.sourceSha,
      RELEASE_MODE: 'deploy', RELEASE_COMMAND: 'execute', GITHUB_RUN_ID: '33',
      RUNNER_TEMP: runner, RELEASE_SOURCE_DIRECTORY: f.args.sourceRoot, PUBLIC_RECEIPT_DIRECTORY: output,
      RELEASE_ENABLED: 'true', RELEASE_OPERATOR_IMAGE: installation.image,
    }, { api, executeOperator: options => {
      assert.equal(options.admission.legacyPredecessor, undefined);
      assert.deepEqual(order, ['deployment', 'in_progress']); order.push('operator');
      return runOperator({ ...options,
      registry: { username: 'teddashh', token: 'synthetic-registry' },
      credentials: { cloudflareApiToken: 'synthetic-provider', migrationDatabaseUrl: 'synthetic-migrator',
        runtimeDatabaseUrl: 'synthetic-runtime', stagingAccessClientId: 'synthetic-id', stagingAccessClientSecret: 'synthetic-access' },
      async run(command, args) {
        assert.equal(command, 'docker'); // Transport stub: never execute Docker or a provider tool.
        if (args[0] !== 'run') return;
        const deployed = await f.deployer.publish({ ...f.args, async execute() {
          publishes++; f.publish(Object.fromEntries(Object.keys(decisions).map(name => [name, 'true'])));
          return { versionId: f.newVersion };
        }, sleep: async () => {} });
        const input = await readFile(join(options.temporaryRoot, 'input/request.json'));
        const value = codeResult().value;
        Object.assign(value, { sourceSha: options.admission.sourceSha, runId: options.admission.runId,
          runAttempt: options.admission.runAttempt, requestSha256: hash(input), configSha256: options.installation.configSha256 });
        Object.assign(value.phases[0], { previousSourceSha: f.before.sourceSha, flagChanges: expected.flagChanges });
        Object.assign(value.phases[2], deployed);
        value.phases[3].sourceSha = f.sourceSha;
        for (const phase of value.phases) phase.startedAt = phase.completedAt = new Date().toISOString();
        const bytes = JSON.stringify(value) + '\n'; operatorBytes = Buffer.byteLength(bytes);
        assert(operatorBytes <= 49_152, `operator result: ${operatorBytes} bytes`);
        await writeFile(join(options.temporaryRoot, 'output/result.json'), bytes);
        // Include the fullest progress snapshot even when a fast run beats the periodic reader.
        await options.onProgress(operatorProgress(value, options.admission, options.installation, hash(input)));
      },
    });
    } });
    assert.equal(process.exitCode, previousExitCode);
    assert.deepEqual(order, ['deployment', 'in_progress', 'operator', 'success']);
    const text = await readFile(join(output, 'receipt.json'), 'utf8'), receiptBytes = Buffer.byteLength(text);
    const archive = zipFixture([['receipt.json', text]]), decoded = decodeReceiptArchive(archive);
    assert(receiptBytes <= 49_152, `decoded receipt: ${receiptBytes} bytes`);
    assert.equal(decoded.status, 'passed'); assert.equal(publishes, 1);
    assert.deepEqual(decoded.flagChanges, expected.flagChanges);
    assert.deepEqual(decoded.operatorProgress[0].flagChanges, expected.flagChanges);
    assert.deepEqual(decoded.operatorProgress.find(phase => phase.name === 'deploy').flagChanges, expected.flagChanges);
    assert.deepEqual(decoded.phases.find(phase => phase.name === 'deploy').flagChanges, expected.flagChanges);
    const staging = stagingFixture();
    Object.assign(staging.state, { receipt: decoded, deployment, deployments: [deployment] });
    Object.assign(staging.state.run, { run_started_at: start, updated_at: new Date().toISOString() });
    Object.assign(staging.state.artifact, { size_in_bytes: archive.length, digest: 'sha256:' + hash(archive) });
    staging.api.readArtifact = async artifact => {
      assert.equal(artifact.digest, 'sha256:' + hash(archive)); return decodeReceiptArchive(archive);
    };
    const admitted = await requireStaging(staging.api, { ...staging.admission, sourceSha: f.sourceSha,
      sourceTree, releaseKind: 'independent' }, installation);
    assert.equal(admitted.deploymentId, deployment.id);
    t.diagnostic(`maximal flag metadata: operator=${operatorBytes} bytes; decoded receipt=${receiptBytes} bytes`);
  } finally { process.exitCode = previousExitCode; }
});

test('17 changes refuse deploy before begin or any provider mutation, and refuse check and plan with the same code', async t => {
  const decisions = flagFile(maximalFlagDecisions(17)), report = await environmentCheckFixture(t, decisions), f = report.f;
  const sourceTree = fixtureGit(f.args.sourceRoot, ['rev-parse', 'HEAD^{tree}']);
  const runner = join(f.args.workRoot, 'runner'); await mkdir(runner);
  let operators = 0, begins = 0, floorWrites = 0, mutations = 0;
  assert.throws(() => renderWorkerConfig({ ...f.args, target: 'staging-next' }), { code: 'release_flag_changes_too_many' });
  await assert.rejects(f.deployer.publish({ ...f.args,
    retainIntent: async () => { floorWrites++; }, execute: async () => { mutations++; },
  }), { code: 'release_flag_changes_too_many' });
  const entry = await readFile(new URL('../../shared-release/portable/entry.mjs', import.meta.url), 'utf8');
  const earlyGuard = entry.indexOf('if (!isBackup) applyFlagDecisions(');
  assert(earlyGuard > 0);
  for (const operation of ['recovery = await reconcileFailedBackup(', 'await adoptLegacyPredecessor(', 'await floor.begin(', 'floor.beginIndependent('])
    assert(earlyGuard < entry.indexOf(operation), operation);
  assert(entry.indexOf('built = await buildApplication(') < entry.indexOf('await floor.begin('));
  assert(entry.indexOf('built = await buildApplication(') < entry.indexOf('floor.beginIndependent('));
  const build = await readFile(new URL('../../shared-release/portable/build.mjs', import.meta.url), 'utf8');
  assert(build.includes('= renderWorkerConfig('));
  const read = fixtureApi(path => path.includes('/deployments?') ? [] : undefined), api = async (path, options) => {
    if (['PUT', 'POST', 'PATCH', 'DELETE'].includes(options?.method)) mutations++;
    const value = await read(path);
    if (path.includes('/commits/')) { value.sha = f.sourceSha; value.commit.tree.sha = sourceTree; }
    if (/\/actions\/runs\/\d+$/.test(path)) value.head_sha = f.sourceSha;
    return value;
  };
  const previousExitCode = process.exitCode;
  t.mock.method(globalThis, 'fetch', report.fetchImpl);
  try {
    for (const mode of ['deploy', 'check', 'plan']) {
      const output = join(f.args.workRoot, mode);
      process.exitCode = previousExitCode;
      await releaseMain({ ...environment(), ...report.env, PATH: process.env.PATH, RELEASE_SHA: f.sourceSha, RELEASE_MODE: mode,
        RELEASE_COMMAND: mode === 'plan' ? 'admit' : 'execute', RELEASE_SOURCE_DIRECTORY: f.args.sourceRoot,
        RUNNER_TEMP: runner, RELEASE_ENABLED: 'true', RELEASE_OPERATOR_IMAGE: installation.image,
        PUBLIC_RECEIPT_DIRECTORY: output }, { api, controllerRoot: f.args.sourceRoot,
        executeOperator() {
          operators++;
          // Same preflight/render guard as the portable operator, before floor.begin.
          renderWorkerConfig({ ...f.args, target: 'staging-next' });
          begins++; floorWrites++; assert.fail('oversized release must not reach begin');
        } });
      const receipt = JSON.parse(await readFile(join(output, 'receipt.json')));
      if (mode === 'check') {
        assert.equal(receipt.status, 'checks_failed');
        assert.equal(receipt.environmentCheck.checks.find(row => row.name === 'worker_routes_and_hyperdrive').error,
          'release_flag_changes_too_many');
        assert.equal(receipt.providerOutcome, 'no_mutations');
      } else {
        assert.equal(receipt.status, 'failed'); assert.equal(receipt.error, 'release_flag_changes_too_many');
      }
    }
    assert.equal(operators, 0); assert.equal(begins, 0); assert.equal(floorWrites, 0); assert.equal(mutations, 0);
    const checked = await checkEnvironment(report.env, 'staging-next', { fetchImpl: report.fetchImpl, flagDecisions: decisions });
    assert.equal(checked.status, 'failed');
    assert.equal(checked.checks.find(row => row.name === 'worker_routes_and_hyperdrive').error, 'release_flag_changes_too_many');
    assert(report.calls.every(call => call.options.method === 'GET'));
  } finally { process.exitCode = previousExitCode; }
});

test('flag metadata bounds reject 65-character names and 161-character records while 64 retained decisions can have 16 changes', () => {
  const entries = maximalFlagDecisions(64), [name, decision] = Object.entries(entries)[0];
  assert.throws(() => validateFlagDecisions(flagFile({ [name.replace('_ENABLED', 'X_ENABLED')]: decision })),
    { code: 'release_flag_decisions_invalid' });
  assert.throws(() => validateFlagDecisions(flagFile({ [name]: { ...decision, record: decision.record + '1' } })),
    { code: 'release_flag_decisions_invalid' });
  const bindings = Object.keys(entries).slice(16).map(name => ({ name, type: 'plain_text', text: 'true' }));
  const changes = applyFlagDecisions({ target: 'staging-next', bindings, decisions: flagFile(entries) }).flagChanges;
  assert.equal(changes.length, 16); assert.deepEqual(publicFlagChanges(changes), changes);
  const excessive = [...changes, { ...changes[0], name: Object.keys(entries)[16] }];
  assert.throws(() => publicFlagChanges(excessive), { code: 'release_flag_changes_too_many' });
  for (const make of [() => ({ value: resultFixture(), admission: request() }), () => codeResult()]) {
    const { value, admission } = make(); value.phases.find(phase => phase.name === 'deploy').flagChanges = excessive;
    assert.throws(() => validateOperatorResult(value, admission, installation, 'e'.repeat(64)), { code: 'release_flag_changes_too_many' });
    assert.throws(() => operatorProgress(value, admission, installation, 'e'.repeat(64)), { code: 'release_flag_changes_too_many' });
  }
});

test('missing decision file retains every config byte and the old retained binding hash', async t => {
  const f = await deployFixture(t), before = JSON.stringify(f.before);
  const expected = renderWorkerConfig({ ...f.args, target: 'staging-next' });
  const vars = Object.fromEntries(f.before.bindings.filter(row => row.type === 'plain_text').map(row => [row.name, row.text]));
  vars.FREEDOM_RELEASE_SHA = f.sourceSha;
  assert.equal(JSON.stringify(expected.config.vars), JSON.stringify(vars));
  const fixture = JSON.parse(await readFile(new URL('../../shared-release/test/fixtures/pre-flag-floor.json', import.meta.url)));
  const baselineConfig = JSON.parse(JSON.stringify(fixture.workerConfig).replaceAll('/fixture/source', f.args.sourceRoot));
  baselineConfig.vars.FREEDOM_RELEASE_SHA = f.sourceSha;
  assert.equal(JSON.stringify(expected.config), JSON.stringify(baselineConfig));
  assert.equal(expected.bindingsSha256, f.before.bindingsSha256); assert.deepEqual(expected.flagChanges, []);
  // An untracked decision, even a malformed one, is not released-source authority.
  await mkdir(join(f.args.sourceRoot, 'deploy/shared-release'), { recursive: true });
  await writeFile(join(f.args.sourceRoot, 'deploy/shared-release/flag-decisions.json'), 'invalid untracked JSON');
  const again = renderWorkerConfig({ ...f.args, target: 'staging-next' });
  assert.equal(JSON.stringify(again.config), JSON.stringify(expected.config));
  assert.equal(again.bindingsSha256, expected.bindingsSha256); assert.equal(JSON.stringify(f.before), before);
});

test('target decisions change or add only boolean plain-text flags and leave all other bindings intact', async t => {
  const added = 'FREEDOM_COMMUNITY_RELATIONS_ENABLED';
  const decisions = flagFile({ [flagName]: flagDecision(), [added]: flagDecision() },
    { [flagName]: flagDecision('false'), FREEDOM_OTHER_ENABLED: flagDecision() });
  const f = await deployFixture(t, decisions), before = structuredClone(f.before);
  const expected = renderWorkerConfig({ ...f.args, target: 'staging-next' });
  assert.equal(expected.config.vars[flagName], 'true'); assert.equal(expected.config.vars[added], 'true');
  assert.equal(expected.config.vars.FREEDOM_OTHER_ENABLED, undefined); assert.equal(expected.config.keep_vars, true);
  assert.notEqual(expected.bindingsSha256, before.bindingsSha256);
  assert.deepEqual(expected.bindings.filter(row => row.type !== 'plain_text'), before.bindings.filter(row => row.type !== 'plain_text'));
  for (const row of before.bindings.filter(row => ![flagName, 'FREEDOM_RELEASE_SHA'].includes(row.name))) {
    assert.deepEqual(expected.bindings.find(value => value.name === row.name), row);
  }
  assert.deepEqual(expected.flagChanges, [
    { name: flagName, from: 'false', to: 'true', record: flagRecord },
    { name: added, from: null, to: 'true', record: flagRecord },
  ]);
  assert.deepEqual(f.before, before);
  assert.deepEqual(applyFlagDecisions({ target: 'staging-next', bindings: expected.bindings, decisions }).flagChanges, []);
  const off = applyFlagDecisions({ target: 'staging-next', bindings: expected.bindings,
    decisions: flagFile({ [added]: flagDecision('false') }) });
  assert.deepEqual(off.flagChanges, [{ name: added, from: 'true', to: 'false', record: flagRecord }]);
  assert.equal(off.bindings.find(row => row.name === flagName).text, 'true'); // Removing an entry retains live state.
  const unchanged = await deployFixture(t, flagFile({ [flagName]: flagDecision('false') }));
  const noDelta = renderWorkerConfig({ ...unchanged.args, target: 'staging-next' });
  assert.equal(noDelta.bindingsSha256, unchanged.before.bindingsSha256); assert.deepEqual(noDelta.flagChanges, []);
});

test('decision validation rejects protected names, non-boolean values and every unknown shape/key', () => {
  const reject = value => assert.throws(() => validateFlagDecisions(value), /release_flag_decisions_invalid/);
  for (const name of ['APP_ORIGIN', 'FREEDOM_ENV', 'FREEDOM_DATABASE_NAME', 'FREEDOM_RELEASE_SHA',
    'FREEDOM_TRUST_CF_CONNECTING_IP', 'OTHER_ENABLED', 'FREEDOM_FLAG', 'FREEDOM_lower_ENABLED',
    'FREEDOM__ENABLED', 'FREEDOM_A-1_ENABLED', 'FREEDOM_A_ENABLED\n', '__proto__', 'constructor']) {
    reject(flagFile(Object.fromEntries([[name, flagDecision()]])));
  }
  for (const value of [true, false, 1, 0, null, undefined, 'TRUE', 'False', '', ' true', 'false\n', {}, []]) {
    reject(flagFile({ [flagName]: { ...flagDecision(), value } }));
  }
  for (const value of [null, [], {}, 'invalid', { format: 'wrong', targets: {} }, { targets: {} },
    { ...flagFile(), extra: true }, { ...flagFile(), targets: null }, { ...flagFile(), targets: [] },
    { ...flagFile(), targets: { unknown: {} } }, flagFile(null), flagFile([]), flagFile('true'),
    flagFile({ [flagName]: null }), flagFile({ [flagName]: [] }), flagFile({ [flagName]: 'true' }),
    flagFile({ [flagName]: { ...flagDecision(), extra: true } })]) reject(value);
  for (const key of ['value', 'decidedBy', 'decidedAt', 'record']) {
    const decision = flagDecision(); delete decision[key]; reject(flagFile({ [flagName]: decision }));
  }
  for (const decidedBy of ['', ' Ted', 'Ted ', '\nTed', 'T\0ed', null, 12, 'x'.repeat(129)])
    reject(flagFile({ [flagName]: { ...flagDecision(), decidedBy } }));
  for (const decidedAt of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-01', '2026-1-01', '2026-10-27T00:00:00Z', null, 1])
    reject(flagFile({ [flagName]: { ...flagDecision(), decidedAt } }));
  for (const record of ['http://github.com/FreeTWAI/freedom-platform/pull/1', 'https://evil.example/pull/1',
    'https://github.com/FreeTWAI/other/pull/1', 'https://github.com/FreeTWAI/freedom-platform.evil/pull/1',
    'https://github.com/FreeTWAI/freedom-platform/', 'https://github.com/FreeTWAI/freedom-platform/../other/pull/1',
    'https://github.com/FreeTWAI/freedom-platform/%2e%2e/other',
    'https://user@github.com/FreeTWAI/freedom-platform/pull/1',
    'https://github.com:443/FreeTWAI/freedom-platform/pull/1', null, 1, flagRecord + '\n'])
    reject(flagFile({ [flagName]: { ...flagDecision(), record } }));
  const entries = Object.fromEntries(Array.from({ length: 64 }, (_, n) => ['FREEDOM_FLAG_' + n + '_ENABLED', flagDecision()]));
  assert.deepEqual(validateFlagDecisions(flagFile(entries)), flagFile(entries));
  reject(flagFile({ ...entries, FREEDOM_TOO_MANY_ENABLED: flagDecision() }));
  reject(flagFile({}, { [flagName]: { ...flagDecision(), unknown: true } })); // Other target must also validate.
  assert.deepEqual(validateFlagDecisions(flagFile({}, {})), flagFile({}, {}));
  assert.doesNotThrow(() => validateFlagDecisions(flagFile({ [flagName]: { ...flagDecision(), decidedAt: '2024-02-29' } })));
});

test('decisions never overwrite secrets, other binding types or expose unexpected live values', () => {
  for (const binding of [{ name: flagName, type: 'secret_text' }, { name: flagName, type: 'r2_bucket', bucket_name: 'fixture' },
    { name: flagName, type: 'plain_text', text: 'unexpected-private-value' }]) {
    assert.throws(() => applyFlagDecisions({ target: 'staging-next', bindings: [binding], decisions: flagFile() }), /release_flag_live_binding_invalid/);
  }
  assert.throws(() => applyFlagDecisions({ target: 'unknown', bindings: [], decisions: flagFile() }), /release_flag_target_invalid/);
});

test('decision reader uses exact admitted Git blobs and refuses malformed/unavailable/non-regular sources', async t => {
  const f = await deployFixture(t, flagFile()), sourceRoot = f.args.sourceRoot, path = join(sourceRoot, 'deploy/shared-release/flag-decisions.json');
  await writeFile(path, JSON.stringify(flagFile({ [flagName]: flagDecision('false') })));
  assert.deepEqual(readFlagDecisions({ sourceRoot, sourceSha: f.sourceSha }), flagFile());
  assert.throws(() => readFlagDecisions({ sourceRoot, sourceSha: 'main' }), /release_flag_source_invalid/);
  assert.throws(() => readFlagDecisions({ sourceRoot, sourceSha: 'f'.repeat(40) }), /release_flag_source_invalid/);
  const commit = () => { fixtureGit(sourceRoot, ['add', '.']); fixtureGit(sourceRoot, ['commit', '-qm', 'Synthetic invalid decision']);
    return fixtureGit(sourceRoot, ['rev-parse', 'HEAD']); };
  await writeFile(path, '{');
  assert.throws(() => readFlagDecisions({ sourceRoot, sourceSha: commit() }), /release_flag_decisions_invalid/);
  await writeFile(path, Buffer.alloc(262145, 32));
  assert.throws(() => readFlagDecisions({ sourceRoot, sourceSha: commit() }), /release_flag_source_invalid/);
  await rm(path); await symlink('../../../fixture.txt', path);
  assert.throws(() => readFlagDecisions({ sourceRoot, sourceSha: commit() }), /release_flag_source_invalid/);
});

test('deployer accepts expected changed bindings through stale reads, and refuses old or unrelated changed bindings', async t => {
  for (const outcome of ['expected', 'old', 'unrelated', 'post-check-old']) {
    const f = await deployFixture(t, flagFile()), expected = renderWorkerConfig({ ...f.args, target: 'staging-next' });
    let publishes = 0;
    const operation = f.deployer.publish({ ...f.args, async execute() {
      publishes++; f.publish(outcome === 'old' ? undefined : { [flagName]: 'true', ...(outcome === 'unrelated' ? { FREEDOM_EXTRA_ENABLED: 'true' } : {}) });
      if (outcome === 'post-check-old') f.dropFlagsAfterMatch();
      return { versionId: f.newVersion };
    }, sleep: async () => {} });
    if (outcome === 'expected') {
      const result = await operation;
      assert.equal(result.observations, 2); assert.equal(result.bindingsSha256, expected.bindingsSha256);
      assert.deepEqual(result.flagChanges, expected.flagChanges);
      assert.equal((await f.deployer.inspect()).bindingsSha256, expected.bindingsSha256);
    } else await assert.rejects(operation, outcome === 'post-check-old' ? /release_deploy_preservation_failed/ : /release_deploy_bindings_changed/);
    assert.equal(publishes, 1);
  }
});

test('pre-flag fixture chain replays to the exact baseline state at every prefix', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../shared-release/test/fixtures/pre-flag-floor.json', import.meta.url)));
  assert.equal(fixture.baseline, '34390b1210e51a9ac071e32f8ac1bb6ed8d0382c');
  assert(!Object.hasOwn(fixture.chain[1].record.data.candidate, 'bindingsSha256'));
  const options = { isAncestor: () => true };
  assert.deepEqual(replayReleaseFloor(fixture.chain, options).state, fixture.expectedState);
  for (const [index, digest] of fixture.prefixStateSha256.entries()) {
    assert.equal(hash(JSON.stringify(replayReleaseFloor(fixture.chain.slice(0, index + 1), options).state)), digest);
  }
});

function beginFlagRelease(f, kind, bindingsSha256) {
  const candidate = { ...f.begin.record.data.candidate, bindingsSha256 };
  const request = { ...f.request };
  if (kind === 'release-begin-v2') { request.releaseKind = 'independent'; candidate.schemaLedger = f.before; }
  return f.event(kind, undefined, undefined, { request, candidate });
}

test('flag releases advance bindings only after verified deploy and the next predecessor and backup use the new floor', async t => {
  const deployed = await deployFixture(t, flagFile()), expected = renderWorkerConfig({ ...deployed.args, target: 'staging-next' });
  await deployed.deployer.publish({ ...deployed.args, async execute() {
    deployed.publish({ [flagName]: 'true' }); return { versionId: deployed.newVersion };
  }, sleep: async () => {} });
  const live = await deployed.deployer.inspect(), released = deployed.sourceSha;
  for (const kind of ['begin', 'release-begin-v2']) {
    const f = floorFixture(), previousHash = deployed.before.bindingsSha256;
    f.chain[0].record.data.state.bindingsSha256 = previousHash;
    f.request.sourceSha = released; f.begin.record.data.candidate.sourceSha = released; f.commit.source = released;
    f.options.isAncestor = (a, b) => (a === main && b === released) || a === b;
    f.add(beginFlagRelease(f, kind, expected.bindingsSha256));
    if (kind === 'begin') {
      f.runBackup('backup-before', main);
      f.add(f.event('intent', 'migration', f.commit, { operation: 'commit' }));
      const committed = f.add(f.event('committed', 'migration', { ...f.commit, ledger: f.after }));
      assert.equal(committed.bindingsSha256, previousHash);
      f.add(f.event('passed', 'migration', { transactionId: '123', commitStatus: 'confirmed', ledgerVerified: true,
        runtimeGrantsVerified: true, ledgerSha256: migrationLedgerDigest(f.after) }));
    } else f.add(f.event('passed', 'migration', { outcome: 'unchanged', readOnly: true, ledgerVerified: true,
      runtimeGrantsVerified: true, ledgerSha256: migrationLedgerDigest(f.before) }));
    assert.equal(replayReleaseFloor(f.chain, f.options).state.bindingsSha256, previousHash);
    f.add(f.event('intent', 'deploy', { sourceSha: released, previousSourceSha: main, previousVersion: f.id,
      configSha256: '8'.repeat(64), automaticRetry: false }, { operation: 'publish' }));
    for (const bindingsSha256 of [undefined, previousHash]) {
      assert.throws(() => replayReleaseFloor([...f.chain, f.event('passed', 'deploy', {
        sourceSha: released, providerConfirmed: true, versionId: f.id, bindingsSha256 })], f.options), /release_floor_deploy_bindings_unverified/);
    }
    let state = f.add(f.event('passed', 'deploy', { sourceSha: released, providerConfirmed: true, versionId: f.id,
      bindingsSha256: expected.bindingsSha256 }));
    assert.equal(state.bindingsSha256, expected.bindingsSha256);
    assert.equal(backupExpectation(state, released).bindingsSha256, expected.bindingsSha256);
    f.add(f.event('passed', 'health', { sourceSha: released, statusCode: 200, schemaVerified: true, smokePassed: true }));
    if (kind === 'begin') f.runBackup('backup-after', released);
    state = f.add(f.event('passed', 'handoff', kind === 'begin' ? { cleanupVerified: true,
      schedule: { format: 'freedom.verified-scheduled-backup/v1', runId: 10, operatorImage: f.request.operatorImage,
        configSha256: f.request.configSha256, receiptSha256: '9'.repeat(64), completedAt: '2026-10-25T00:00:00Z' } }
      : { cleanupVerified: true, migrationVerified: true }));
    assert.equal(state.pending, null);
    assertReleasePredecessor(live, state);
    assert.throws(() => assertReleasePredecessor({ sourceSha: released, bindingsSha256: previousHash }, state), /release_entry_predecessor_changed/);
    assert.equal(backupExpectation(state, released).bindingsSha256, expected.bindingsSha256);
    const next = beginFlagRelease(f, 'release-begin-v2', expected.bindingsSha256);
    next.record.data.candidate.schemaLedger = state.schemaLedger;
    assert.doesNotThrow(() => replayReleaseFloor([...f.chain, next], f.options));
    const backup = f.event('backup-begin', undefined, undefined, { request: { ...f.request, sourceSha: released, sourceTree: tree } });
    assert.equal(replayReleaseFloor([...f.chain, backup], f.options).state.bindingsSha256, expected.bindingsSha256);
  }
  for (const invalid of [null, '', true, 'invalid', 'a'.repeat(63)]) {
    const f = floorFixture(); assert.throws(() => replayReleaseFloor([...f.chain, beginFlagRelease(f, 'begin', invalid)], f.options), /release_floor_candidate_invalid/);
  }
});

test('flag receipts whitelist exact public fields and reject private values in final and progress results', () => {
  const change = plannedFlagChanges(flagFile(), 'staging-next')[0];
  const value = { ...change, secret: 'private-diagnostic' };
  assert.deepEqual(publicFlagChanges([value]), [change]);
  for (const make of [() => ({ value: resultFixture(), admission: request() }), () => codeResult()]) {
    const f = make(), deploy = f.value.phases.find(phase => phase.name === 'deploy');
    deploy.flagChanges = [value];
    const result = validateOperatorResult(f.value, f.admission, installation, 'e'.repeat(64));
    assert.deepEqual(result.find(phase => phase.name === 'deploy').flagChanges, [change]);
    assert(!JSON.stringify(result).includes('private-diagnostic'));
    assert.deepEqual(operatorProgress(f.value, f.admission, installation, 'e'.repeat(64))
      .find(phase => phase.name === 'deploy').flagChanges, [change]);
    deploy.flagChanges = [{ ...change, from: 'private-value' }];
    assert.throws(() => validateOperatorResult(f.value, f.admission, installation, 'e'.repeat(64)), /release_flag_changes_invalid/);
    assert.throws(() => operatorProgress(f.value, f.admission, installation, 'e'.repeat(64)), /release_flag_changes_invalid/);
  }
  for (const value of [null, {}, [change, change], [{ ...change, name: 'APP_ORIGIN' }], [{ ...change, to: true }],
    [{ ...change, record: 'https://other.invalid/' }], Array(65).fill(change)])
    assert.throws(() => publicFlagChanges(value), /release_flag_changes_invalid/);
});

test('check previews only the selected source decisions with observed live from values and no writes', async t => {
  const f = await environmentCheckFixture(t);
  const decisions = flagFile({ [flagName]: flagDecision(), FREEDOM_COMMUNITY_RELATIONS_ENABLED: flagDecision() },
    { FREEDOM_OTHER_ENABLED: flagDecision() });
  const report = await checkEnvironment(f.env, 'staging-next', { fetchImpl: f.fetchImpl, flagDecisions: decisions });
  assert.equal(report.status, 'passed'); assert.equal(report.flagChangesObservation, 'live');
  assert.deepEqual(report.flagChanges, [
    { name: flagName, from: 'false', to: 'true', record: flagRecord },
    { name: 'FREEDOM_COMMUNITY_RELATIONS_ENABLED', from: null, to: 'true', record: flagRecord },
  ]);
  assert.equal(report.deployment, 'not_run'); assert(f.calls.every(call => call.options.method === 'GET'));
});

test('execute check reads admitted decisions from the controller when the source checkout is absent', async t => {
  const f = await environmentCheckFixture(t, flagFile()), controllerRoot = f.f.args.sourceRoot;
  const output = join(f.f.args.workRoot, 'public'), sourceRoot = join(f.f.args.workRoot, 'missing-source');
  await assert.rejects(stat(sourceRoot), { code: 'ENOENT' });
  // The admitted Git blob, rather than working-tree bytes, supplies the decision.
  await writeFile(join(controllerRoot, 'deploy/shared-release/flag-decisions.json'), 'invalid working-tree JSON');
  const read = fixtureApi(), api = async path => {
    const value = await read(path);
    if (path.includes('/commits/')) value.sha = f.f.sourceSha;
    if (/\/actions\/runs\/\d+$/.test(path)) value.head_sha = f.f.sourceSha;
    return value;
  };
  t.mock.method(globalThis, 'fetch', f.fetchImpl);
  const previousExitCode = process.exitCode;
  try {
    await releaseMain({ ...environment(), ...f.env, RELEASE_SHA: f.f.sourceSha,
      RELEASE_COMMAND: 'execute', RELEASE_MODE: 'check', RELEASE_SOURCE_DIRECTORY: sourceRoot,
      PUBLIC_RECEIPT_DIRECTORY: output }, { api, controllerRoot,
      executeOperator() { assert.fail('a check cannot invoke the operator'); } });
    const receipt = JSON.parse(await readFile(join(output, 'receipt.json')));
    assert.equal(receipt.status, 'checks_passed');
    assert.equal(receipt.sourceSha, f.f.sourceSha); assert.equal(receipt.flagChangesObservation, 'live');
    assert.deepEqual(receipt.flagChanges, [{ name: flagName, from: 'false', to: 'true', record: flagRecord }]);
    assert.equal(receipt.providerOutcome, 'no_mutations');
    assert(f.calls.length > 5); assert(f.calls.every(call => call.options.method === 'GET'));
  } finally { process.exitCode = previousExitCode; }
});

test('plan receipt reads decisions from the exact admitted SHA and marks old values unobserved', async t => {
  const f = await deployFixture(t, flagFile()), output = join(f.args.workRoot, 'public'), summary = join(f.args.workRoot, 'summary.md');
  const read = fixtureApi(), api = async path => {
    const value = await read(path);
    if (path.includes('/commits/')) value.sha = f.sourceSha;
    if (/\/actions\/runs\/\d+$/.test(path)) value.head_sha = f.sourceSha;
    return value;
  };
  const previousExitCode = process.exitCode;
  try {
    await releaseMain({ ...environment(), RELEASE_SHA: f.sourceSha, RELEASE_SOURCE_DIRECTORY: f.args.sourceRoot,
      RELEASE_COMMAND: 'admit', PUBLIC_RECEIPT_DIRECTORY: output, GITHUB_STEP_SUMMARY: summary,
      RELEASE_CONFIG_JSON: JSON.stringify({ flagDecisions: flagFile({ [flagName]: flagDecision('false') }) }) }, { api,
      controllerRoot: f.args.sourceRoot,
      executeOperator() { assert.fail('a plan cannot invoke the operator'); } });
    const receipt = JSON.parse(await readFile(join(output, 'receipt.json')));
    assert.equal(receipt.status, 'plan_passed'); assert.equal(receipt.flagChangesObservation, 'not_checked');
    assert.deepEqual(receipt.flagChanges, [{ name: flagName, from: null, to: 'true', record: flagRecord }]);
    assert((await readFile(summary, 'utf8')).includes(flagName));
  } finally { process.exitCode = previousExitCode; }
});

test('capture failure before a dump is authenticated for backup and independent deploy recovery', async () => {
  for (const independent of [false, true]) {
    const f = failedBackupFixture();
    if (independent) Object.assign(f.admission, { mode: 'deploy', releaseKind: 'independent', sourceSha: main });
    f.state.receipt.operatorProgress = [{ name: 'preflight', reportedStatus: 'passed' },
      { name: 'backup', reportedStatus: 'failed', backupFailure: { stage: 'capture', snapshotDump: 'not_started' } }];
    assert.equal((await requireFailedBackup(f.api, f.admission, installation)).failureBoundary, 'before_dump');
    for (const snapshotDump of ['running', 'failed', 'completed', undefined]) {
      f.state.receipt.operatorProgress[1].backupFailure.snapshotDump = snapshotDump;
      if (independent) await assert.rejects(requireFailedBackup(f.api, f.admission, installation), /release_backup_recovery_boundary_invalid/);
      else assert.equal((await requireFailedBackup(f.api, f.admission, installation)).failureBoundary, undefined);
    }
    for (const mutate of [p => p.pop(), p => p.push({ name: 'handoff', reportedStatus: 'running' }),
      p => { p[0].reportedStatus = 'failed'; }, p => { p[1].reportedStatus = 'running'; },
      p => { p[0].name = 'backup'; }, p => { p[1].name = 'handoff'; }]) {
      const bad = structuredClone(f.state.receipt.operatorProgress);
      bad[1].backupFailure.snapshotDump = 'not_started'; mutate(bad); f.state.receipt.operatorProgress = bad;
      if (independent) await assert.rejects(requireFailedBackup(f.api, f.admission, installation), /release_backup_recovery_boundary_invalid/);
      else assert.equal((await requireFailedBackup(f.api, f.admission, installation)).failureBoundary, undefined);
      f.state.receipt.operatorProgress = [{ name: 'preflight', reportedStatus: 'passed' },
        { name: 'backup', reportedStatus: 'failed', backupFailure: { stage: 'capture', snapshotDump: 'not_started' } }];
    }
  }
});

function beforeDumpFixture(withCapture = false) {
  const f = backupRecoveryFixture();
  f.args.request.recoveryEvidence.failureBoundary = 'before_dump';
  if (withCapture) {
    f.state.pending.intents['backup:capture-policy'] = { format: 'freedom.shared-capture-policy-intent/v1',
      pid: 123, application: 'fp-capture-00000000-0000-0000-0000-000000000000', database: 'fixture', role: 'maintainer',
      revision: 'shared-backup-00000000-0000-0000-0000-000000000000', before: '6'.repeat(64), automaticRetry: false };
    f.observations.policy.policy_sha256 = '6'.repeat(64);
  }
  return f;
}

test('before-dump recovery observes unstarted and unmutated policies without writes', async () => {
  for (const withCapture of [false, true]) {
    const f = beforeDumpFixture(withCapture); await reconcileFailedBackup(f.args);
    const proof = f.proof();
    assert.equal(proof.failureBoundary, 'before_dump'); assert.equal(proof.captureRevision, undefined);
    if (withCapture) {
      assert.equal(proof.capturePolicy, 'not_committed'); assert.equal(proof.policySha256, '6'.repeat(64));
      assert.equal(proof.capturePolicyIntent, undefined);
      assert(f.calls.some(sql => sql.includes("encode(pg_catalog.sha256(convert_to((to_jsonb(p)-'generation')::text,'UTF8')),'hex')")));
      assert.deepEqual(f.queries.find(query => query.sql.includes('pid=$1 AND datname=$2 AND usename=$3 AND application_name=$4')).values,
        [123, 'fixture', 'maintainer', f.state.pending.intents['backup:capture-policy'].application]);
    } else {
      assert.equal(proof.capturePolicyIntent, 'absent'); assert.equal(proof.capturePolicy, undefined);
      assert.equal(proof.policySha256, undefined);
      assert(f.calls.some(sql => sql.includes("left(application_name,11)='fp-capture-'")));
    }
    assert.equal(proof.captureBackendAbsent, true); assert.equal(proof.deletionFences, 0);
    assert.equal(proof.maintenanceEnabled, false); assert.equal(proof.domainMaintenanceEnabled, false);
    assert.equal(proof.archiveIntent, 'absent'); assert.equal(proof.materialPolicySha256, f.state.materialPolicySha256);
    assert(f.calls.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
    assert(f.calls.includes('verify-ledger-and-coordinate-fence'));
    assert(!f.calls.some(sql => /UPDATE|DELETE|pg_terminate_backend/.test(sql)));
  }
  const committed = beforeDumpFixture(true);
  committed.observations.policy.revision = committed.state.pending.intents['backup:capture-policy'].revision;
  committed.observations.policy.policy_sha256 = '7'.repeat(64);
  await reconcileFailedBackup(committed.args);
  assert.equal(committed.proof().captureRevision, committed.observations.policy.revision);
  for (const key of ['failureBoundary', 'capturePolicy', 'policySha256']) assert.equal(committed.proof()[key], undefined);
});

test('before-dump recovery refuses every unconfirmed policy, backend, binding and extra intent', async () => {
  for (const withCapture of [false, true]) {
    for (const [mutate, code] of [
      [f => { f.observations.policy.enabled = true; }, 'release_backup_recovery_cleanup_unconfirmed'],
      [f => { f.observations.policy.domain_media_enabled = true; }, 'release_backup_recovery_cleanup_unconfirmed'],
      [f => { f.observations.backends.push({ pid: 123 }); }, 'release_backup_recovery_cleanup_unconfirmed'],
      [f => { f.observations.fences = 1; }, 'release_backup_recovery_cleanup_unconfirmed'],
      [f => { f.observations.material.push({ purpose: 'changed' }); }, 'release_backup_recovery_policy_changed'],
      [f => { f.observations.identity.database = 'other'; }, 'release_backup_recovery_database_changed'],
      [f => { f.observations.identity.role = 'other'; }, 'release_backup_recovery_database_changed'],
      [f => { f.state.pending.intents['backup:archive'] = {}; }, 'release_backup_recovery_binding_invalid'],
      [f => { f.state.pending.intents.extra = {}; if (!withCapture) f.state.pending.intents.other = {}; }, 'release_backup_recovery_binding_invalid'],
      [f => { f.args.request.legacyPredecessor = legacyEvidenceFixture(); }, 'release_backup_recovery_worker_changed'],
    ]) {
      const f = beforeDumpFixture(withCapture); mutate(f);
      await assert.rejects(reconcileFailedBackup(f.args), { code }); assert.equal(f.proof(), undefined);
    }
  }
  const changed = beforeDumpFixture(true); changed.observations.policy.policy_sha256 = '7'.repeat(64);
  await assert.rejects(reconcileFailedBackup(changed.args), { code: 'release_backup_recovery_cleanup_unconfirmed' });
  assert.equal(changed.proof(), undefined);
  const unbound = beforeDumpFixture(); delete unbound.args.request.recoveryEvidence.failureBoundary;
  await assert.rejects(reconcileFailedBackup(unbound.args), { code: 'release_backup_recovery_binding_invalid' });
  assert.equal(unbound.proof(), undefined);
});

test('floor replay accepts exactly the before-dump proofs and refuses each mutated field', () => {
  for (const withCapture of [false, true]) {
    const f = floorFixture(), old = { ...f.request, sourceSha: main };
    f.add(f.event('backup-begin', undefined, undefined, { request: old }));
    const capture = { format: 'freedom.shared-capture-policy-intent/v1', pid: 123, application: 'fp-capture-' + f.id,
      revision: 'shared-backup-' + f.id, before: '6'.repeat(64), automaticRetry: false };
    if (withCapture) f.add(f.event('intent', 'backup', capture, { operation: 'capture-policy' }));
    const state = replayReleaseFloor(f.chain, f.options).state;
    const proof = { format: 'freedom.abandoned-backup/v1', recovery: { ...old, format: 'freedom.verified-failed-backup/v1',
      failureBoundary: 'before_dump', receiptSha256: '9'.repeat(64), artifactId: 99,
      artifactDigest: 'sha256:' + '9'.repeat(64), completedAt: '2026-10-27T00:00:00Z' },
      settledBy: { ...old, runId: 13 }, sourceSha: main, sourceTree: tree, bindingsSha256: state.bindingsSha256,
      ledgerSha256: migrationLedgerDigest(state.schemaLedger), materialPolicySha256: state.materialPolicySha256,
      failureBoundary: 'before_dump', maintenanceEnabled: false, domainMaintenanceEnabled: false,
      deletionFences: 0, captureBackendAbsent: true, sourcePins: 'retained', archiveIntent: 'absent',
      observedAt: '2026-10-27T01:00:00Z', ...(withCapture ? { capturePolicy: 'not_committed', policySha256: capture.before }
        : { capturePolicyIntent: 'absent' }) };
    const replay = (value, extra = []) => replayReleaseFloor([...f.chain, ...extra, f.event('backup-abandoned', 'backup', value)], f.options);
    assert.deepEqual(replay(proof).state, { ...state, pending: null });
    for (const patch of [
      { failureBoundary: undefined }, { failureBoundary: 'before_capture' },
      { recovery: { ...proof.recovery, failureBoundary: undefined } },
      { recovery: { ...proof.recovery, failureBoundary: 'before_capture' } },
      { capturePolicy: 'committed' }, { policySha256: '7'.repeat(64) }, { captureRevision: capture.revision },
      { capturePolicyIntent: withCapture ? 'absent' : undefined },
      { maintenanceEnabled: true }, { domainMaintenanceEnabled: true }, { deletionFences: 1 },
      { captureBackendAbsent: false }, { materialPolicySha256: '7'.repeat(64) },
      { archiveIntent: 'present' }, { legacyPredecessor: legacyEvidenceFixture({ admittedRunId: 13 }) },
      ...(withCapture ? [{ capturePolicy: undefined }, { policySha256: undefined }] : []),
    ]) assert.throws(() => replay({ ...proof, ...patch }));
    const archive = f.event('intent', 'backup', { setId: f.id, archiveSha256: '7'.repeat(64), bytes: 123, automaticRetry: false }, { operation: 'archive' });
    assert.throws(() => replay(proof, [archive]));
    const extra = f.event('intent', 'backup', capture, { operation: 'capture-policy' });
    assert.throws(() => replay(proof, [extra]));
  }
});

// Scan source text rather than importing it: this also works in the plain-Node preflight suite.
async function releaseSourceLiterals() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const excluded = resolve(root, 'deploy/shared-release/failure-codes.mjs');
  const walk = async directory => {
    const paths = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'test') continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) paths.push(...await walk(path));
      else if (entry.name.endsWith('.mjs') && path !== excluded) paths.push(path);
    }
    return paths;
  };
  const resolveImport = async path => {
    const candidates = [path, path.replace(/\.js$/, '.ts'),
      ...['.ts', '.mjs', '.js', '.tsx', '/index.ts', '/index.mjs', '/index.js'].map(suffix => path + suffix)];
    for (const candidate of candidates) {
      try { if ((await stat(candidate)).isFile()) return candidate; }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    }
    assert.fail(`Unresolved static relative import: ${relative(root, path)}`);
  };
  const pending = await walk(resolve(root, 'deploy/shared-release')), seen = new Set(), codes = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path) || path === excluded) continue;
    assert(!relative(root, path).startsWith('..'), 'source imports stay inside the repository');
    seen.add(path);
    const source = await readFile(path, 'utf8');
    assert(!/release_\$\{/.test(source), `dynamic release identifier in ${relative(root, path)}`);
    for (const [, , code] of source.matchAll(/(['"`])(release_[a-z0-9_]{1,80})\1/g)) codes.add(code);
    for (const [, , specifier] of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+[^;'"`]*?\s+from\s*(['"])(\.[^'"]+)\1/g)) {
      const target = await resolveImport(resolve(dirname(path), specifier));
      if (!target.includes('/node_modules/')) pending.push(target);
    }
  }
  // Guard the transitive TS and MJS dependencies called out by the backup boundary.
  for (const path of ['packages/media-migration/backup-diagnostics.ts', 'packages/asset-storage/index.ts',
    'modules/assets/maintenance.ts', 'packages/db/migration-plan.mjs']) assert(seen.has(resolve(root, path)), path);
  return codes;
}

test('release failure allowlist equals every source literal in the static relative import closure', async () => {
  const source = await releaseSourceLiterals(), allowed = new Set(RELEASE_FAILURE_CODES);
  assert(Object.isFrozen(RELEASE_FAILURE_CODES));
  assert.equal(allowed.size, RELEASE_FAILURE_CODES.length, 'no duplicates');
  assert.deepEqual(RELEASE_FAILURE_CODES, [...RELEASE_FAILURE_CODES].sort());
  for (const code of RELEASE_FAILURE_CODES) {
    assert.match(code, /^release_[a-z0-9_]{1,80}$/);
    assert(source.has(code), `allowlist entry removed from source: ${code}`);
    assert(isReleaseFailureCode(code));
  }
  for (const code of source) assert(allowed.has(code), `source identifier missing from allowlist: ${code}`);
  assert.deepEqual(allowed, source);
});

test('release failure membership rejects shape-valid unknown codes and accepts the first known candidate', () => {
  for (const error of [{ code: 'P0001', message: 'release_private_token_abc123' },
    { code: 'release_private_token_abc123' }, { message: 'release_not_a_real_code' }]) {
    assert.equal(releaseFailureCode(error), 'release_operation_failed');
    assert(!isReleaseFailureCode(error.code)); assert(!isReleaseFailureCode(error.message));
  }
  assert.equal(releaseFailureCode({ code: 'release_private_token_abc123', message: 'release_lease_lost' }), 'release_lease_lost');
  assert.equal(releaseFailureCode({ code: 'release_floor_unsettled', message: 'release_lease_lost' }), 'release_floor_unsettled');
});

test('release CLI receipts and summaries omit unknown codes and P0001 exception messages', async t => {
  const root = await mkdtemp(join(tmpdir(), 'release-error-membership-'));
  const exitCode = process.exitCode;
  t.after(async () => { process.exitCode = exitCode; await rm(root, { recursive: true, force: true }); });
  for (const [index, error] of [
    { code: 'P0001', message: 'release_private_token_abc123' },
    { code: 'release_private_token_abc123' }, { message: 'release_not_a_real_code' },
    { code: 'release_private_token_abc123', message: 'release_lease_lost' },
  ].entries()) {
    const output = join(root, String(index)), summary = join(root, `${index}.md`);
    await releaseMain({ ...environment(), RELEASE_COMMAND: 'admit', PUBLIC_RECEIPT_DIRECTORY: output,
      GITHUB_STEP_SUMMARY: summary }, { api: async () => { throw error; } });
    const receipt = JSON.parse(await readFile(join(output, 'receipt.json'), 'utf8'));
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.error, index === 3 ? 'release_lease_lost' : 'release_operation_failed');
    assert((await readFile(summary, 'utf8')).includes(`- Stopped: \`${receipt.error}\``));
    for (const text of [JSON.stringify(receipt), await readFile(summary, 'utf8')])
      assert(!text.includes('release_private_token_abc123') && !text.includes('release_not_a_real_code'));
  }
  process.exitCode = exitCode;
});

test('operator failures preserve only source-owned codes with the existing fallback', async t => {
  for (const code of ['release_private_token_abc123', 'release_not_a_real_code', 'release_lease_lost']) {
    const fixture = await operatorFixture(t), run = fixture.options.run;
    await assert.rejects(runOperator({ ...fixture.options, run: async (command, args, ...rest) => {
      if (args[0] === 'run') throw Object.assign(Error('release_private_token_abc123'), { code });
      return run(command, args, ...rest);
    } }), { code: code === 'release_lease_lost' ? code : 'release_operator_failed' });
  }
});

test('backup CLI catch projects only known codes and keeps its own fallback', async () => {
  // No backup CLI injection harness exists. Execute its actual catch projection with inert ports.
  const source = await readFile(new URL('../../shared-release/backup-cli.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  } catch (error) {') + '  } catch (error) {'.length;
  const project = new Function('receipt', 'error', 'isReleaseFailureCode', 'process',
    source.slice(start, source.indexOf('\n  } finally {', start)));
  for (const error of [{ code: 'P0001', message: 'release_private_token_abc123' },
    { code: 'release_private_token_abc123' }, { code: 'release_not_a_real_code' }, { code: 'release_lease_lost' }]) {
    const receipt = {}, process = {};
    project(receipt, error, isReleaseFailureCode, process);
    assert.equal(receipt.error, error.code === 'release_lease_lost' ? error.code : 'release_backup_failed');
    assert.equal(receipt.status, 'failed'); assert.equal(process.exitCode, 1);
  }
});

test('environment checks omit unknown codes and keep known identifiers', async t => {
  const fixture = await environmentCheckFixture(t);
  for (const code of ['release_private_token_abc123', 'release_not_a_real_code', 'release_lease_lost']) {
    const error = Object.assign(Error('release_private_token_abc123'), { code });
    const report = await checkEnvironment(fixture.env, 'staging-next', { fetchImpl: async () => ({
      get status() { throw error; },
    }) });
    assert.equal(report.checks[0].error, code === 'release_lease_lost' ? code : 'release_environment_check_failed');
    assert(!JSON.stringify(report).includes('release_private_token_abc123'));
  }
});

test('artifact reader preserves only known staging codes and keeps its download fallback', async () => {
  const artifact = { id: 1, digest: 'sha256:' + 'a'.repeat(64), size_in_bytes: 1 };
  for (const code of ['release_staging_private_token_abc123', 'release_private_token_abc123',
    'release_lease_lost', 'release_staging_archive_invalid']) {
    const read = artifactReader(REPOSITORY, 'fixture', async () => { throw Object.assign(Error('private'), { code }); });
    await assert.rejects(read(artifact), { code: code === 'release_staging_archive_invalid' ? code : 'release_staging_download_failed' });
  }
});

test('all failed operator phases record fixed codes and public progress filters every other field', async () => {
  // Execute the entry's actual phase closure with only its persistence ports replaced.
  const entry = await readFile(new URL('../../shared-release/portable/entry.mjs', import.meta.url), 'utf8');
  const source = entry.slice(entry.indexOf('const phase = async ') + 'const phase = '.length, entry.indexOf('\n  const backup ='));
  for (const [error, expected] of [
    [Object.assign(Error('private'), { code: 'release_floor_unsettled' }), 'release_floor_unsettled'],
    [Error('release_floor_unsettled'), 'release_floor_unsettled'],
    [Object.assign(Error('release_floor_unsettled'), { code: 'INVALID' }), 'release_floor_unsettled'],
    [Object.assign(Error('release_private_token_abc123'), { code: 'P0001' }), 'release_operation_failed'],
    [Object.assign(Error('private'), { code: 'release_private_token_abc123' }), 'release_operation_failed'],
    [Error('release_not_a_real_code'), 'release_operation_failed'],
    [Object.assign(Error('release_lease_lost'), { code: 'release_private_token_abc123' }), 'release_lease_lost'],
    [Error('connect ECONNREFUSED 10.1.2.3:5432'), 'release_operation_failed'],
    [Object.assign(Error('private'), { code: 'release_' + 'a'.repeat(81) }), 'release_operation_failed'],
    [Object.assign(Error('private'), { code: 'release_bad\nsecret' }), 'release_operation_failed'],
  ]) {
    const value = resultFixture(); value.phases = [];
    const phase = new Function('result', 'phases', 'save', 'path', 'same', 'releaseFailureCode', 'return ' + source)(
      value, PHASES, async () => {}, '/synthetic', assert.equal, releaseFailureCode);
    await assert.rejects(phase('preflight', async () => { throw error; }), error);
    assert.equal(value.phases[0].failureCode, expected);
    const progress = operatorProgress(value, request(), installation, 'e'.repeat(64));
    assert.equal(progress[0].failureCode, expected);
    assert(!JSON.stringify(progress).includes('10.1.2.3')); assert(!JSON.stringify(progress).includes('private'));
  }
  for (const status of ['passed', 'running', 'failed']) {
    const value = resultFixture(); value.phases = value.phases.slice(0, 2);
    Object.assign(value.phases[0], { failureCode: 'release_floor_unsettled' });
    Object.assign(value.phases[1], { status, failureCode: 'release_floor_unsettled' });
    const progress = operatorProgress(value, request(), installation, 'e'.repeat(64));
    assert.equal(progress[0].failureCode, undefined);
    assert.equal(progress[1].failureCode, status === 'failed' ? 'release_floor_unsettled' : undefined);
    for (const invalid of ['release_private_token_abc123', 'release_not_a_real_code', 'connect ECONNREFUSED 10.1.2.3:5432', 'release_', 'release_BAD', 'release_bad\n', {}, null]) {
      value.phases[1].failureCode = invalid;
      assert.equal(operatorProgress(value, request(), installation, 'e'.repeat(64))[1].failureCode, undefined);
    }
  }
});

test('backup diagnostic allowlist covers every fixed portable backup release identifier', async () => {
  const codes = new Set();
  for (const name of ['backup', 'capture-policy', 'intent', 'control-store', 'floor', 'lease', 'cloudflare',
    'coordinate-fence', 'backup-storage', 'backup-expectation', 'postgres']) {
    const source = await readFile(new URL(`../../shared-release/portable/${name}.mjs`, import.meta.url), 'utf8');
    for (const [, , code] of source.matchAll(/(['"`])(release_[a-z0-9_]{1,80})\1/g)) codes.add(code);
  }
  assert(codes.size > 0);
  for (const code of codes) assert(isBackupDiagnosticCode(code), code);
  for (const code of ['release_backup_private_secret', 'release_not_a_real_code']) assert(!isBackupDiagnosticCode(code));
});

test('backup diagnostics keep Node errno codes out of SQLSTATEs and continue resolving errors', () => {
  const fallback = 'daily_backup_phase_failed';
  for (const code of ['EPERM', 'EBADF', 'EROFS', 'EBUSY', 'EINTR', 'ENOENT']) {
    for (const error of [{ code }, { cause: { code } }, { cause: { cause: { code } } }]) {
      const result = backupDiagnosticCode(error, fallback);
      assert.equal(result, fallback); assert(!result.startsWith('backup_database_sqlstate_'));
    }
    assert.equal(backupDiagnosticCode({ code, message: 'release_lease_lost' }, fallback), 'release_lease_lost');
    assert.equal(backupDiagnosticCode({ code, message: 'Query read timeout' }, fallback), 'backup_database_query_timeout');
    assert.equal(backupDiagnosticCode({ code, cause: { code: 'ECONNRESET' } }, fallback), 'backup_network_econnreset');
    assert.equal(backupDiagnosticCode({ code, name: 'AbortError' }, fallback), 'backup_operation_aborted');
    assert(!isBackupDiagnosticCode('backup_database_sqlstate_' + code.toLowerCase()));
  }
});

test('backup diagnostics translate public SQLSTATEs, fixed network codes and pg messages without provider text', () => {
  const mappings = {
    '42501': 'permission_denied', '57014': 'query_cancelled', '55P03': 'lock_timeout',
    '53300': 'resources_exhausted', '53100': 'resources_exhausted', '53200': 'resources_exhausted',
    '40001': 'conflict', '40P01': 'conflict', '08001': 'connection_failed', '08006': 'connection_failed',
    '08003': 'connection_failed', '08P01': 'connection_failed', '57P01': 'connection_failed',
    '57P02': 'connection_failed', '57P03': 'connection_failed', '23505': 'sqlstate_23505', 'XX000': 'sqlstate_xx000',
    '3D000': 'sqlstate_3d000', '3F000': 'sqlstate_3f000', '0A000': 'sqlstate_0a000',
    '2BP01': 'sqlstate_2bp01', '0LP01': 'sqlstate_0lp01',
    'F0000': 'sqlstate_f0000', 'HV000': 'sqlstate_hv000', 'P0001': 'sqlstate_p0001', '57P05': 'sqlstate_57p05',
  };
  for (const [code, suffix] of Object.entries(mappings)) {
    const result = backupDiagnosticCode({ code, message: 'PRIVATE_SQL_DETAIL' }, 'daily_backup_phase_failed');
    assert.equal(result, 'backup_database_' + suffix); assert(isBackupDiagnosticCode(result));
  }
  for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN',
    'ENOTFOUND', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']) {
    for (const error of [{ code, message: 'PRIVATE_NETWORK_DETAIL' }, { message: 'fetch failed', cause: { code } }]) {
      const result = backupDiagnosticCode(error, 'daily_backup_phase_failed');
      assert.equal(result, 'backup_network_' + code.toLowerCase()); assert(isBackupDiagnosticCode(result));
    }
  }
  for (const [message, suffix] of Object.entries({
    'Connection terminated unexpectedly': 'connection_terminated', 'timeout exceeded when trying to connect': 'connect_timeout',
    'Query read timeout': 'query_timeout', 'Connection terminated due to connection timeout': 'connect_timeout',
  })) assert.equal(backupDiagnosticCode({ message }, 'fallback'), 'backup_database_' + suffix);
  for (const error of [null, {}, { code: 'PRIVATE' }, { code: '23505\n' }, { code: 'xx000' },
    { message: 'Query read timeout private' }, { message: 'connect ECONNREFUSED 10.1.2.3:5432' }])
    assert.equal(backupDiagnosticCode(error, 'fallback'), 'fallback');
  assert.equal(backupDiagnosticCode({ name: 'AbortError' }, 'fallback'), 'backup_operation_aborted');
  assert.equal(backupDiagnosticCode({ name: 'AbortError', cause: { code: 'ECONNRESET' } }, 'fallback'), 'backup_network_econnreset');
  for (const code of ['release_lease_lost', 'daily_backup_phase_failed', 'backup_snapshot_mismatch', 'gc_observation_unavailable', 'release_fixed_123']) {
    assert.equal(backupDiagnosticCode({ code }, 'fallback'), code);
    assert.equal(backupDiagnosticCode({ message: code }, 'fallback'), code);
  }
});

test('backup diagnostic cause walk is bounded, preserves specific codes and validates generated public shapes', () => {
  for (const wrapper of ['backup_capture_failed', 'daily_backup_phase_failed', 'private wrapper']) {
    let error = { code: 'ECONNRESET', message: 'PRIVATE' };
    for (let depth = 1; depth <= 4; depth++) {
      error = { message: wrapper, cause: error };
      assert.equal(backupDiagnosticCode(error, 'daily_backup_phase_failed'), depth <= 3 ? 'backup_network_econnreset'
        : wrapper === 'backup_capture_failed' ? wrapper : 'daily_backup_phase_failed');
    }
  }
  const cycle = { message: 'private' }; cycle.cause = cycle;
  assert.equal(backupDiagnosticCode(cycle, 'fallback'), 'fallback');
  assert.equal(backupDiagnosticCode({ code: 'release_lease_lost', cause: { code: 'ECONNRESET' } }, 'fallback'), 'release_lease_lost');
  for (const code of ['backup_database_sqlstate_57p05', 'backup_network_econnrefused', 'backup_operation_aborted', 'release_lease_lost'])
    assert(isBackupDiagnosticCode(code));
  for (const code of ['PRIVATE', 'backup_database_sqlstate_ABC12', 'backup_database_sqlstate_abc12',
    'backup_database_sqlstate_eperm', 'backup_database_sqlstate_abc123', 'backup_network_evil',
    'backup_network_ECONNRESET', 'backup_network_econnreset\n', 'release_backup_private_token', {}, undefined]) assert(!isBackupDiagnosticCode(code));
  const value = resultFixture(); value.phases = value.phases.slice(0, 2); value.phases[1].status = 'failed';
  value.phases[1].backupFailure = { stage: 'capture', code: 'daily_backup_cleanup_failed', cleanupVerified: false,
    phaseCode: 'backup_database_sqlstate_23505', cleanupCode: 'backup_network_econnreset', cause: 'PRIVATE' };
  assert.deepEqual(operatorProgress(value, request(), installation, 'e'.repeat(64)).at(-1).backupFailure,
    { stage: 'capture', code: 'daily_backup_cleanup_failed', cleanupVerified: false,
      phaseCode: 'backup_database_sqlstate_23505', cleanupCode: 'backup_network_econnreset' });
});

test('candidate policy additions permit only new disabled purposes and preserve installed policy rows', () => {
  const disabled = purpose => ({ purpose, mode: 'legacy', policy_lock: 0, policy_revision: null,
    persistence_allowed: false, retained_byte_limit: null });
  const before = [disabled('member.service-cover')], added = disabled('member.profile-cover');
  const after = [added, ...before];
  assert.deepEqual(deriveDisabledMaterialPolicyAdditions(before, after), [added]);
  assert.deepEqual(deriveDisabledMaterialPolicyAdditions(before, [...after].reverse()), [added]);
  const installed = [{ ...before[0], mode: 'r2_only', policy_revision: 'approved-v1', persistence_allowed: true, retained_byte_limit: '524288' }];
  assert.deepEqual(appendDisabledMaterialPolicies(installed, [added]), [added, ...installed]);
  for (const patch of [{ mode: 'bridge' }, { persistence_allowed: true }, { policy_lock: 1 },
    { policy_revision: 'enabled-v1' }, { retained_byte_limit: '524288' }]) {
    assert.throws(() => deriveDisabledMaterialPolicyAdditions(before, [{ ...added, ...patch }, ...before]),
      { code: 'release_migration_policy_addition_invalid' });
  }
  assert.throws(() => deriveDisabledMaterialPolicyAdditions(before, [added]), { code: 'release_migration_policy_changed' });
  assert.throws(() => deriveDisabledMaterialPolicyAdditions(before, [{ ...before[0], mode: 'bridge' }]), { code: 'release_migration_policy_changed' });
  assert.throws(() => appendDisabledMaterialPolicies(installed, before), { code: 'release_migration_policy_addition_invalid' });
});

test('policy digest changes require matching commit intent and confirmed SQL; historical records keep the old digest', () => {
  const f = floorFixture(), initial = f.chain[0].record.data.state.materialPolicySha256;
  const begin = structuredClone(f.begin); begin.record.data.kind = 'release-begin-v2';
  begin.record.data.request.releaseKind = 'independent'; f.add(begin);
  const commit = { ...f.commit, beforeMaterialPolicySha256: initial, afterMaterialPolicySha256: 'e'.repeat(64) };
  const invalid = [{ beforeMaterialPolicySha256: 'f'.repeat(64) }, { afterMaterialPolicySha256: undefined },
    { beforeMaterialPolicySha256: undefined }, { afterMaterialPolicySha256: 'bad' }];
  for (const patch of invalid) assert.throws(() => replayReleaseFloor([...f.chain,
    f.event('intent', 'migration', { ...commit, ...patch }, { operation: 'commit' })], f.options), { code: 'release_floor_commit_intent_invalid' });
  assert.equal(f.add(f.event('intent', 'migration', commit, { operation: 'commit' })).materialPolicySha256, initial);
  for (const patch of [{ afterMaterialPolicySha256: 'f'.repeat(64) }, { beforeMaterialPolicySha256: undefined }]) {
    assert.throws(() => replayReleaseFloor([...f.chain,
      f.event('committed', 'migration', { ...commit, ledger: f.after, ...patch })], f.options), { code: 'release_floor_commit_unverified' });
  }
  assert.equal(f.add(f.event('committed', 'migration', { ...commit, ledger: f.after })).materialPolicySha256, commit.afterMaterialPolicySha256);
  const old = floorFixture(); old.add(old.begin); old.runBackup('backup-before', main);
  old.add(old.event('intent', 'migration', old.commit, { operation: 'commit' }));
  assert.throws(() => replayReleaseFloor([...old.chain, old.event('committed', 'migration', { ...commit, ledger: old.after })], old.options),
    { code: 'release_floor_commit_unverified' });
  assert.equal(old.add(old.event('committed', 'migration', { ...old.commit, ledger: old.after })).materialPolicySha256, initial);
});

test('an outdated environment frontier has its own actionable failure before migration installation', () => {
  assert.throws(() => preparePortableMigration({ sourceRoot: resolve('.'), sourceCommit: sha,
    profile: { format: 'freedom.migrations/legacy-v1', first: 1, last: 189, known_gaps: [22] },
    installationParent: '/unused', beforeLedger: [{ name: '001_initial.sql', sha256: '1'.repeat(64) }] }),
  { code: 'release_migration_frontier_mismatch' });
});

function failedReleaseHandoffFixture(source = { sourceSha: sha, sourceTree: tree }) {
  const original = { login: 'teddashh', id: OPERATORS.teddashh }, triggeredBy = { login: 'arumwu', id: OPERATORS.arumwu };
  const run = { id: 77, run_attempt: 1, workflow_id: 3, path: '.github/workflows/shared-release.yml',
    event: 'workflow_dispatch', repository: { id: REPOSITORY_ID }, head_repository: { id: REPOSITORY_ID },
    head_branch: 'main', head_sha: main, status: 'completed', conclusion: 'failure', actor: original,
    triggering_actor: triggeredBy, run_started_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:10:00Z' };
  const jobs = ['admission', 'deploy'].map((name, i) => ({ name, run_id: 77, run_attempt: 1, head_sha: main,
    status: 'completed', conclusion: i ? 'failure' : 'success', steps: i ? [
      { name: 'Execute the installed environment operator', status: 'completed', conclusion: 'failure' },
      { name: 'Save public release receipt', status: 'completed', conclusion: 'success' }] : [] }));
  const artifact = { id: 78, name: 'release-result-77-1', expired: false, digest: 'sha256:' + '8'.repeat(64),
    workflow_run: { id: 77, repository_id: REPOSITORY_ID, head_repository_id: REPOSITORY_ID, head_branch: 'main', head_sha: main } };
  const receipt = { format: 'freedom.shared-release/v1', status: 'failed', mode: 'deploy', releaseKind: 'independent',
    providerOutcome: 'unknown_until_confirmed', repository: REPOSITORY, repositoryId: REPOSITORY_ID, controllerSha: main,
    target: 'staging-next', runId: 77, runAttempt: 1, ...source, original, triggeredBy,
    operatorImage: installation.image, configSha256: installation.configSha256, completedAt: '2026-10-25T00:09:59Z',
    operatorProgress: ['preflight', 'migration', 'deploy', 'health', 'handoff'].map((name, i) => ({ name,
      reportedStatus: i === 4 ? 'failed' : 'passed', ...(i === 4 ? { failureCode: 'release_lease_lost' } : {}) })) };
  const admission = { ...requestFromEnvironment({ ...environment(), RELEASE_MODE: 'handoff', RELEASE_RECOVER_RELEASE_RUN_ID: '77' }),
    ...source, mainShaObserved: main, admittedAt: new Date(0).toISOString(), original, triggeredBy };
  const state = { run, jobs, artifact, receipt }, calls = [];
  const fallback = fixtureApi(path => path.includes('/commits/') ? { sha: source.sourceSha, commit: { tree: { sha: source.sourceTree } } }
    : /\/actions\/runs\/(11|22)$/.test(path) ? { id: path.endsWith('/11') ? 11 : 22, workflow_id: path.endsWith('/11') ? 1 : 2,
      path: `.github/workflows/${path.endsWith('/11') ? 'verify' : 'codeql'}.yml`, head_sha: source.sourceSha, head_branch: 'main',
      event: 'push', repository: { id: REPOSITORY_ID }, head_repository: { id: REPOSITORY_ID }, run_attempt: 2,
      status: 'completed', conclusion: 'success' } : undefined);
  const api = async (path, options) => {
    calls.push({ path, method: options?.method ?? 'GET' }); assert.equal(options?.method ?? 'GET', 'GET');
    if (path.endsWith('/workflows/shared-release.yml')) return { id: 3, path: run.path, state: 'active' };
    if (path.endsWith('/runs/77')) return structuredClone(state.run);
    if (path.includes('/runs/77/attempts/')) return { total_count: state.jobs.length, jobs: structuredClone(state.jobs) };
    if (path.includes('/runs/77/artifacts?')) return { total_count: 1, artifacts: [structuredClone(state.artifact)] };
    return fallback(path);
  };
  api.readArtifact = async () => structuredClone(state.receipt);
  return { admission, state, api, calls };
}

test('handoff input is explicit, four-operator admitted and separate from deploy/backup recovery', async () => {
  for (const [login, id] of Object.entries(OPERATORS)) {
    const input = requestFromEnvironment({ ...environment(), RELEASE_MODE: 'handoff', RELEASE_RECOVER_RELEASE_RUN_ID: '77',
      GITHUB_ACTOR: login, GITHUB_ACTOR_ID: String(id) });
    assert.equal((await admitRelease(input, fixtureApi())).original.login, login);
    assert.equal(input.recoverReleaseRunId, 77);
  }
  for (const id of ['', '100', '0', '-1', '77\n', '1e2']) assert.throws(() => requestFromEnvironment({ ...environment(),
    RELEASE_MODE: 'handoff', RELEASE_RECOVER_RELEASE_RUN_ID: id }));
  for (const mode of ['plan', 'check', 'deploy']) assert.throws(() => requestFromEnvironment({ ...environment(),
    RELEASE_MODE: mode, RELEASE_RECOVER_RELEASE_RUN_ID: '77' }));
  assert.throws(() => requestFromEnvironment({ ...environment(), RELEASE_MODE: 'handoff',
    RELEASE_RECOVER_RELEASE_RUN_ID: '77', RELEASE_RECOVER_BACKUP_RUN_ID: '76' }));
});

test('handoff authenticates terminal failed release and exact artifact while allowing a repaired operator image', async () => {
  const f = failedReleaseHandoffFixture();
  const proof = await requireFailedReleaseHandoff(f.api, f.admission, { ...installation,
    image: `ghcr.io/freetwai/freedom-release-operator@sha256:${'9'.repeat(64)}` });
  assert.equal(proof.operatorImage, installation.image); assert.equal(proof.runId, 77);
  assert.equal(proof.receiptSha256, hash(JSON.stringify(f.state.receipt)));
  assert.equal(proof.cleanupVerified, undefined);
  for (const mutate of [s => { s.run.status = 'in_progress'; }, s => { s.run.conclusion = 'success'; },
    s => { s.run.head_repository.id = 2; }, s => { s.run.actor.id++; }, s => { s.run.triggering_actor.id++; },
    s => { s.run.run_attempt++; }, s => { s.jobs[0].run_attempt++; }, s => { s.jobs[1].steps[0].conclusion = 'success'; },
    s => { s.jobs[1].steps[1].conclusion = 'failure'; }, s => { s.artifact.workflow_run.id++; },
    s => { s.artifact.expired = true; }, s => { s.artifact.digest = 'invalid'; }, s => { s.receipt.original.id++; },
    s => { s.receipt.target = 'next'; }, s => { s.receipt.sourceSha = main; }, s => { s.receipt.sourceTree = main; },
    s => { s.receipt.configSha256 = '9'.repeat(64); }, s => { s.receipt.completedAt = '2026-10-26T00:00:00Z'; },
    s => { s.receipt.mode = 'handoff'; }, s => { s.receipt.operatorProgress[3].reportedStatus = 'failed'; },
    s => { s.receipt.operatorProgress.pop(); }, s => { s.receipt.operatorProgress[4].failureCode = 'release_private_detail'; }]) {
    const bad = failedReleaseHandoffFixture(); mutate(bad.state);
    await assert.rejects(requireFailedReleaseHandoff(bad.api, bad.admission, installation));
  }
  const changed = failedReleaseHandoffFixture(); changed.api.readArtifact = async () => {
    changed.state.run.run_attempt++; return structuredClone(changed.state.receipt);
  };
  await assert.rejects(requireFailedReleaseHandoff(changed.api, changed.admission, installation));
});

async function pendingHandoffFixture(t, stop = 'health', descendant = false) {
  const f = await adoptionFixture(t);
  if (descendant) await writeFile(join(f.sourceRoot, 'app.txt'), 'next application, unchanged migrations');
  const candidate = descendant ? f.commit() : f.current, hosted = failedReleaseHandoffFixture(candidate);
  const evidence = await requireFailedReleaseHandoff(hosted.api, hosted.admission, installation);
  const chain = [{ sha256: hash(JSON.stringify(f.seed)), record: { data: structuredClone(f.seed) } }];
  let appends = 0;
  const reopenFloor = () => openReleaseFloor({ sourceRoot: f.sourceRoot, intentDirectory: f.sourceRoot, store: {
    target: 'staging-next', load: async () => structuredClone(chain), readAuthority: async () => structuredClone(f.legacy),
    append: async ({ data }) => { appends++; const row = { sha256: hash(JSON.stringify(data)), record: { data } }; chain.push(row); return row; },
  } });
  const floor = await reopenFloor();
  const originalRequest = { ...hosted.admission, mode: 'deploy', runId: 77, runAttempt: 1,
    operatorImage: installation.image, configSha256: installation.configSha256 };
  await floor.beginIndependent(originalRequest, { ...candidate, schemaLedger: f.seed.state.schemaLedger });
  if (stop !== 'begin') {
    await floor.passed('migration', { outcome: 'unchanged', readOnly: true, ledgerVerified: true, runtimeGrantsVerified: true,
      ledgerSha256: migrationLedgerDigest(f.seed.state.schemaLedger) });
    await floor.intent('deploy', 'publish', { sourceSha: candidate.sourceSha, previousSourceSha: f.current.sourceSha,
      previousVersion: '11111111-1111-4111-8111-111111111111', configSha256: '8'.repeat(64), automaticRetry: false });
    await floor.passed('deploy', { sourceSha: candidate.sourceSha, providerConfirmed: true, versionId: '11111111-1111-4111-8111-111111111111' });
    if (stop === 'health') await floor.passed('health', { sourceSha: candidate.sourceSha, statusCode: 200, schemaVerified: true, smokePassed: true });
  }
  appends = 0;
  const rows = { identity: [{ database: 'fixture', role: 'fixture_migrator', session_role: 'fixture_migrator' }],
    policies: structuredClone(f.legacy.retained172.materialPolicy.policies), gc: [{ policies: 1, enabled: false, domain_enabled: false, fences: 0 }],
    sessions: [{ remaining: 0 }], ledger: structuredClone(f.seed.state.schemaLedger) }, queries = [];
  let released = 0, leaseLost = false;
  const q = { async query(sql) {
    queries.push(sql); assert(/^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|SELECT|ROLLBACK)/.test(sql));
    if (sql.includes('current_database() database')) return { rows: rows.identity };
    if (sql.includes('domain_media_storage_policy')) return { rows: rows.policies };
    if (sql.includes('asset_maintenance_policy')) return { rows: rows.gc };
    if (sql.includes('pg_stat_activity')) return { rows: rows.sessions };
    if (sql.includes('schema_migrations')) return { rows: rows.ledger };
    if (sql.includes("current_setting('server_version_num')")) return { rows: [{ major: 18 }] };
    return { rows: [] };
  }, release() { released++; } };
  const worker = { sourceSha: candidate.sourceSha, bindingsSha256: f.seed.state.bindingsSha256 };
  const args = { floor, pool: { connect: async () => q }, deployer: { inspect: async () => worker },
    lease: { pid: 999, assertHeld() { if (leaseLost) throw Object.assign(Error('release_lease_lost'), { code: 'release_lease_lost' }); } },
    request: { ...hosted.admission, operatorImage: installation.image, configSha256: installation.configSha256, handoffRecoveryEvidence: evidence },
    database: 'fixture', role: 'fixture_migrator' };
  return { ...f, candidate, floor, reopenFloor, args, evidence, chain, rows, queries, worker, appends: () => appends, released: () => released,
    loseLease: () => { leaseLost = true; } };
}

test('handoff reads retained ledger/policy/Worker and appends exactly once; replay is read-only after settlement', async t => {
  const f = await pendingHandoffFixture(t), before = f.floor.state();
  const observed = await inspectReleaseHandoff(f.args); assert.equal(observed.alreadySettled, false); assert.equal(f.appends(), 0);
  assert.equal(f.released(), 1); assert(f.queries.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  await assert.rejects(completeReleaseHandoff({ ...f.args, observed }), /release_handoff_recovery_binding_invalid/);
  const result = await completeReleaseHandoff({ ...f.args, observed: { ...observed, healthVerified: true } });
  assert.equal(result.pendingCleared, true); assert.equal(f.appends(), 1);
  assert.deepEqual(f.floor.state(), { ...before, pending: null });
  const record = f.chain.at(-1).record.data;
  assert.equal(record.runId, 77); assert.equal(record.proof.reconciliation.settledBy.runId, f.args.request.runId);
  assert.equal(record.proof.reconciliation.originalWorkflowFailureRetained, true);
  const repeated = await inspectReleaseHandoff(f.args);
  assert.equal(repeated.alreadySettled, true);
  assert.equal((await completeReleaseHandoff({ ...f.args, observed: { ...repeated, healthVerified: true } })).alreadySettled, true);
  assert.equal(f.appends(), 1);
});

test('handoff settles a deployed Git descendant with unchanged ledger and replays without another append', async t => {
  const f = await pendingHandoffFixture(t, 'health', true);
  assert.notEqual(f.candidate.sourceSha, f.current.sourceSha);
  assert.notEqual(f.candidate.sourceTree, f.current.sourceTree);
  assert.equal(fixtureGit(f.sourceRoot, ['rev-parse', f.candidate.sourceSha + '^']), f.current.sourceSha);
  assert.equal(fixtureGit(f.sourceRoot, ['rev-parse', f.candidate.sourceSha + ':migrations']),
    fixtureGit(f.sourceRoot, ['rev-parse', f.current.sourceSha + ':migrations']));
  f.args.floor = await f.reopenFloor();
  const before = f.args.floor.state();
  assert.equal(before.sourceSha, f.current.sourceSha); assert.equal(before.sourceTree, f.current.sourceTree);
  assert.equal(before.deployedSourceSha, f.candidate.sourceSha); assert.equal(before.pending.stage, 3);
  assert.deepEqual(before.schemaLedger, before.pending.candidate.schemaLedger);
  assert.equal(before.pending.committed, undefined);
  const observed = await inspectReleaseHandoff(f.args);
  assert.equal(observed.alreadySettled, false); assert.equal(f.appends(), 0);
  await completeReleaseHandoff({ ...f.args, observed: { ...observed, healthVerified: true } });
  assert.equal(f.appends(), 1);
  assert.deepEqual(f.args.floor.state(), { ...before, ...f.candidate, pending: null });
  f.args.floor = await f.reopenFloor();
  const repeated = await inspectReleaseHandoff(f.args);
  assert.equal(repeated.alreadySettled, true);
  await completeReleaseHandoff({ ...f.args, observed: { ...repeated, healthVerified: true } });
  assert.equal(f.appends(), 1);
});

test('descendant handoff rejects predecessor Worker and mismatched original identities before and after replay', async t => {
  const f = await pendingHandoffFixture(t, 'health', true);
  f.worker.sourceSha = f.current.sourceSha;
  await assert.rejects(inspectReleaseHandoff(f.args), /release_handoff_recovery_state_changed/);
  assert.equal(f.appends(), 0); f.worker.sourceSha = f.candidate.sourceSha;
  for (const settled of [false, true]) {
    f.args.floor = await f.reopenFloor();
    for (const patch of [{ runId: 78 }, { runAttempt: 2 }, { sourceSha: f.current.sourceSha },
      { sourceTree: f.current.sourceTree }, { target: 'next' }, { controllerSha: sha },
      { operatorImage: `ghcr.io/freetwai/freedom-release-operator@sha256:${'9'.repeat(64)}` },
      { configSha256: '9'.repeat(64) }]) {
      assert.throws(() => f.args.floor.handoffRecoveryState({ ...f.evidence, ...patch }),
        /release_floor_(request_invalid|stage_mismatch)/);
      assert.equal(f.appends(), settled ? 1 : 0);
    }
    // Even matching caller/evidence identities cannot authorize the predecessor.
    const stale = { ...f.args.request, ...f.current, handoffRecoveryEvidence: { ...f.evidence, ...f.current } };
    await assert.rejects(inspectReleaseHandoff({ ...f.args, request: stale }), /release_floor_request_invalid/);
    if (!settled) {
      const observed = await inspectReleaseHandoff(f.args);
      await completeReleaseHandoff({ ...f.args, observed: { ...observed, healthVerified: true } });
    }
  }
  assert.equal(f.appends(), 1);
});

test('descendant handoff replay rejects altered candidate identity and an original receipt after newer release work', async t => {
  for (const key of ['sourceSha', 'sourceTree']) {
    const f = await pendingHandoffFixture(t, 'health', true);
    f.chain.find(row => row.record.data.kind === 'release-begin-v2').record.data.candidate[key] = f.current[key];
    await assert.rejects(f.reopenFloor(), /release_floor_candidate_invalid/); assert.equal(f.appends(), 0);
  }
  const f = await pendingHandoffFixture(t, 'health', true), pending = f.floor.state().pending;
  await f.floor.passed('handoff', { cleanupVerified: true, migrationVerified: true });
  await f.floor.beginIndependent({ ...pending.request, runId: 78 }, pending.candidate);
  await assert.rejects(inspectReleaseHandoff(f.args), /release_floor_stage_mismatch/);
  await f.floor.passed('migration', { outcome: 'unchanged', readOnly: true, ledgerVerified: true, runtimeGrantsVerified: true,
    ledgerSha256: migrationLedgerDigest(f.seed.state.schemaLedger) });
  await f.floor.intent('deploy', 'publish', { sourceSha: f.candidate.sourceSha, previousSourceSha: f.candidate.sourceSha,
    previousVersion: '11111111-1111-4111-8111-111111111111', configSha256: '8'.repeat(64), automaticRetry: false });
  await f.floor.passed('deploy', { sourceSha: f.candidate.sourceSha, providerConfirmed: true,
    versionId: '11111111-1111-4111-8111-111111111111' });
  await f.floor.passed('health', { sourceSha: f.candidate.sourceSha, statusCode: 200, schemaVerified: true, smokePassed: true });
  await assert.rejects(inspectReleaseHandoff(f.args), /release_floor_request_invalid/);
  await f.floor.passed('handoff', { cleanupVerified: true, migrationVerified: true });
  f.args.floor = await f.reopenFloor();
  const appends = f.appends();
  await assert.rejects(inspectReleaseHandoff(f.args), /release_floor_stage_mismatch/);
  assert.equal(f.appends(), appends);
});

test('handoff rejects earlier phases, changed original bindings, newer work, DB/Worker drift and lost lease before append', async t => {
  for (const stop of ['begin', 'deploy']) {
    const f = await pendingHandoffFixture(t, stop);
    await assert.rejects(inspectReleaseHandoff(f.args), /release_floor_stage_mismatch/); assert.equal(f.appends(), 0);
  }
  for (const mutate of [f => { f.rows.identity[0].role = 'wrong'; }, f => { f.rows.ledger[0].sha256 = '8'.repeat(64); },
    f => { f.rows.policies[0].revision = 'changed'; }, f => { f.rows.gc[0].enabled = true; },
    f => { f.rows.gc[0].fences = 1; }, f => { f.rows.sessions[0].remaining = 1; },
    f => { f.worker.sourceSha = main; }, f => { f.worker.bindingsSha256 = '9'.repeat(64); }, f => f.loseLease(),
    f => { f.args.request.handoffRecoveryEvidence.operatorImage = `ghcr.io/freetwai/freedom-release-operator@sha256:${'9'.repeat(64)}`; }]) {
    const f = await pendingHandoffFixture(t);
    f.args.request.handoffRecoveryEvidence = { ...f.evidence }; mutate(f);
    await assert.rejects(inspectReleaseHandoff(f.args)); assert.equal(f.appends(), 0);
  }
  const changed = await pendingHandoffFixture(t), observed = await inspectReleaseHandoff(changed.args);
  changed.loseLease(); await assert.rejects(completeReleaseHandoff({ ...changed.args, observed: { ...observed, healthVerified: true } }));
  assert.equal(changed.appends(), 0);
  const newer = await pendingHandoffFixture(t);
  await newer.floor.passed('handoff', { cleanupVerified: true, migrationVerified: true });
  await newer.floor.beginBackup({ ...newer.args.request, mode: 'backup', runId: 101 });
  await assert.rejects(inspectReleaseHandoff(newer.args), /release_floor_stage_mismatch/);
  const drift = await pendingHandoffFixture(t), checked = await inspectReleaseHandoff(drift.args);
  drift.chain.push({ sha256: '9'.repeat(64), record: {} });
  await assert.rejects(completeReleaseHandoff({ ...drift.args, observed: { ...checked, healthVerified: true } }), /release_floor_external_state_changed/);
  assert.equal(drift.appends(), 0);
});

function handoffResult() {
  const f = failedReleaseHandoffFixture(), value = resultFixture(f.admission);
  value.phases = [value.phases[0], { ...value.phases[6], name: 'handoff', reconciledRunId: 77,
    reconciledRunAttempt: 1, alreadySettled: false, pendingCleared: true, originalFailureRetained: true }];
  Object.assign(value.phases[0], { ledgerVerified: true, policyVerified: true, workerVerified: true,
    healthVerified: true, cleanupVerified: true });
  return { ...f, value };
}

test('handoff operator receipt needs all readback, cleanup and original-failure proofs and exposes no private details', () => {
  const f = handoffResult(); f.value.phases[0].private = 'never publish';
  const result = validateOperatorResult(f.value, f.admission, installation, 'e'.repeat(64));
  assert.deepEqual(result.map(p => p.name), ['preflight', 'handoff']);
  assert.equal(result[1].reconciledRunId, 77); assert(!JSON.stringify(result).includes('never publish'));
  for (const [i, patch] of [[0, { ledgerVerified: false }], [0, { policyVerified: false }], [0, { workerVerified: false }],
    [0, { healthVerified: false }], [1, { reconciledRunId: 78 }], [1, { alreadySettled: undefined }],
    [1, { pendingCleared: false }], [1, { leaseReleased: false }], [1, { originalFailureRetained: false }]]) {
    const bad = structuredClone(f.value); Object.assign(bad.phases[i], patch);
    assert.throws(() => validateOperatorResult(bad, f.admission, installation, 'e'.repeat(64)));
  }
});

test('hosted handoff binds original evidence without backup credentials and controller makes no Deployment writes', async t => {
  const previousExitCode = process.exitCode;
  try {
    const source = await adoptionFixture(t), f = failedReleaseHandoffFixture(source.current);
    const root = await diskFixture(t, 'fp-handoff-controller-'), runner = join(root, 'runner'); await mkdir(runner);
    let executed = 0;
    await releaseMain({ ...environment(), RELEASE_MODE: 'handoff', RELEASE_RECOVER_RELEASE_RUN_ID: '77',
      RELEASE_COMMAND: 'execute', RELEASE_SHA: source.current.sourceSha, RELEASE_ENABLED: 'true',
      RELEASE_CONFIG_JSON: config, RELEASE_CONFIG_SHA256: installation.configSha256, RELEASE_OPERATOR_IMAGE: installation.image,
      RELEASE_SOURCE_DIRECTORY: source.sourceRoot, RUNNER_TEMP: runner, PUBLIC_RECEIPT_DIRECTORY: join(root, 'public'),
      PATH: process.env.PATH }, { api: f.api, async executeOperator({ admission, handoffRecoveryEvidence, credentials, onProgress }) {
      executed++; assert.equal(admission.legacyPredecessor, undefined); assert.equal(handoffRecoveryEvidence.runId, 77);
      assert.equal(credentials.backupDatabaseUrl, undefined);
      await onProgress([{ name: 'preflight', reportedStatus: 'passed' }]);
      return validateOperatorResult(handoffResult().value, handoffResult().admission, installation, 'e'.repeat(64));
    } });
    assert.equal(process.exitCode, previousExitCode); assert.equal(executed, 1);
    const receipt = JSON.parse(await readFile(join(root, 'public/receipt.json')));
    assert.equal(receipt.status, 'reconciled'); assert.equal(receipt.providerOutcome, 'handoff_reconciled');
    assert.equal(receipt.deploymentId, undefined); assert.equal(receipt.handoffReconciliation.runId, 77);
    assert(f.calls.every(call => call.method === 'GET'));
    assert(!f.calls.some(call => /deployments|shared-backup/.test(call.path)));
    const image = await operatorFixture(t), result = handoffResult();
    image.options.admission = result.admission; image.options.handoffRecoveryEvidence = await requireFailedReleaseHandoff(result.api, result.admission, installation);
    delete image.options.credentials.backupDatabaseUrl;
    const oldRun = image.options.run;
    image.options.run = async (cmd, args, ...rest) => {
      if (args[0] !== 'run') return oldRun(cmd, args, ...rest);
      const input = await readFile(join(image.temporaryRoot, 'input/request.json'), 'utf8'), request = JSON.parse(input);
      assert.deepEqual(request.requiredPhases, ['preflight', 'handoff']);
      assert.equal(request.handoffRecoveryEvidence.runId, 77);
      await writeFile(join(image.temporaryRoot, 'output/result.json'), JSON.stringify({ ...result.value, requestSha256: hash(input) }));
    };
    assert.equal((await runOperator(image.options)).length, 2);
  } finally { process.exitCode = previousExitCode; }
});
