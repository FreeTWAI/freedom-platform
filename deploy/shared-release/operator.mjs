import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PHASES, requireRelease, isSha, isDigest } from './admission.mjs';
import { BACKUP_PHASES } from './scheduled-admission.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
export const operatorCommand = (image, source, privateDir, resultDir, name, workDir) => [
  'run', '--pull=never', '--name', name, '--init', '--read-only', '--cap-drop=ALL',
  '--security-opt=no-new-privileges', '--pids-limit=512', '--user=1001:1001',
  '--tmpfs=/tmp:rw,nosuid,nodev,size=2g,uid=1001,gid=1001',
  '--mount', `type=bind,src=${source},dst=/release/source,readonly`,
  '--mount', `type=bind,src=${privateDir},dst=/release/input,readonly`,
  '--mount', `type=bind,src=${resultDir},dst=/release/output`,
  '--mount', `type=bind,src=${workDir},dst=/release/work`,
  '--entrypoint=/usr/local/bin/freedom-release', image,
  '--request', '/release/input/request.json', '--config', '/release/input/config.json',
  '--credentials', '/release/input/credentials.json', '--result', '/release/output/result.json',
];

// Operator output is private; even error text may contain a database URI or token.
// Never forward stdout/stderr to Actions logs, the summary or an uploaded artifact.
export function quietCommand(command, args, timeout = 90 * 60_000, { input } = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'ignore'], timeout, killSignal: 'SIGKILL',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' } });
    // Registry credentials travel only over stdin, never command arguments or logs.
    if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    child.once('error', () => reject(Object.assign(new Error('release_operator_process_failed'), { code: 'release_operator_process_failed' })));
    child.once('exit', (code, signal) => code === 0 && signal === null ? accept()
      : reject(Object.assign(new Error('release_operator_process_failed'), { code: 'release_operator_process_failed' })));
  });
}

// The job's short-lived GITHUB_TOKEN may read a private, repository-linked GHCR
// package. Its temporary Docker config is removed before the operator starts;
// neither the token nor that directory enters the container or public receipt.
export async function pullOperatorImage({ image, temporaryRoot, registry, run = quietCommand }) {
  requireRelease(/^ghcr\.io\/freetwai\/freedom-release-operator@sha256:[a-f0-9]{64}$/.test(image),
    'release_operator_image_invalid');
  requireRelease(registry && typeof registry.username === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(registry.username)
    && typeof registry.token === 'string' && registry.token.length > 0 && registry.token.length <= 16384
    && !/[\r\n\0]/.test(registry.token), 'release_registry_credentials_missing');
  const directory = join(temporaryRoot, 'registry');
  await mkdir(directory, { mode: 0o700 });
  try {
    await run('docker', ['--config', directory, 'login', 'ghcr.io', '--username', registry.username, '--password-stdin'],
      60_000, { input: registry.token });
    await run('docker', ['--config', directory, 'pull', image], 10 * 60_000);
  } catch {
    throw Object.assign(new Error('release_registry_pull_failed'), { code: 'release_registry_pull_failed' });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function boundedJson(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    requireRelease(stat.isFile() && stat.nlink === 1 && stat.size <= 65_536, 'release_operator_receipt_invalid');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}

// This validates evidence from the separately reviewed operator, not the actual
// provider state. The operator must perform the observations before reporting.
export function validateOperatorResult(value, admission, installation, requestDigest) {
  validateBinding(value, admission, installation, requestDigest);
  requireRelease(Array.isArray(value.phases) && value.phases.length === PHASES.length, 'release_operator_phases_incomplete');
  let previous = Date.parse(admission.admittedAt);
  requireRelease(Number.isFinite(previous), 'release_operator_phase_invalid');
  const observedAt = Date.now();
  for (let i = 0; i < PHASES.length; i++) {
    const phase = value.phases[i];
    const start = Date.parse(phase.startedAt), end = Date.parse(phase.completedAt);
    requireRelease(phase.name === PHASES[i] && phase.status === 'passed'
      && Number.isFinite(start) && Number.isFinite(end) && start >= previous && end >= start
      && end <= observedAt + 60_000,
    'release_operator_phase_invalid');
    previous = end;
  }
  const [preflight, before, migration, deploy, health, after, handoff] = value.phases;
  requireRelease(preflight.leaseHeld === true && preflight.sourceCompatible === true
    && preflight.retainedFloorVerified === true && preflight.flagsPreserved === true
    && isSha(preflight.previousSourceSha), 'release_operator_preflight_incomplete');
  for (const [phase, expected] of [[before, preflight.previousSourceSha], [after, admission.sourceSha]]) {
    requireRelease(phase.sourceSha === expected && isDigest(phase.archiveSha256)
      && phase.remoteReadback === 'verified' && phase.restore === 'database_and_objects_restored'
      && phase.cleanupVerified === true && phase.exposure === 'quarantine', 'release_backup_incomplete');
  }
  requireRelease(['committed', 'unchanged'].includes(migration.outcome) && migration.ledgerVerified === true
    && migration.runtimeGrantsVerified === true, 'release_migration_unconfirmed');
  requireRelease(deploy.sourceSha === admission.sourceSha && deploy.providerConfirmed === true
    && health.sourceSha === admission.sourceSha && health.statusCode === 200
    && health.schemaVerified === true && health.smokePassed === true, 'release_health_unconfirmed');
  requireRelease(handoff.backupReadinessVerified === true && handoff.dailyBackupConfigured === true && handoff.cleanupVerified === true
    && handoff.leaseReleased === true && handoff.retainedFloorAdvanced === true,
  'release_handoff_incomplete');
  // Fixed fields only: arbitrary operator text, paths and URLs never reach public receipts.
  return value.phases.map(phase => ({ name: phase.name, status: 'passed',
    startedAt: new Date(Date.parse(phase.startedAt)).toISOString(),
    completedAt: new Date(Date.parse(phase.completedAt)).toISOString() }));
}

function validateBinding(value, admission, installation, requestDigest) {
  requireRelease(value?.format === (admission.mode === 'backup' ? 'freedom.shared-backup-operator-result/v1' : 'freedom.shared-release-operator-result/v1')
    && value.requestSha256 === requestDigest && value.sourceSha === admission.sourceSha
    && value.target === admission.target && value.runId === admission.runId
    && value.runAttempt === admission.runAttempt && value.operatorImage === installation.image
    && value.configSha256 === installation.configSha256, 'release_operator_receipt_binding_invalid');
}

export function validateBackupOperatorResult(value, admission, installation, requestDigest) {
  validateBinding(value, admission, installation, requestDigest);
  requireRelease(admission.mode === 'backup' && value.phases?.length === BACKUP_PHASES.length, 'release_backup_phases_incomplete');
  let previous = Date.parse(admission.admittedAt);
  for (const [i, phase] of value.phases.entries()) {
    const start = Date.parse(phase.startedAt), end = Date.parse(phase.completedAt);
    requireRelease(phase.name === BACKUP_PHASES[i] && phase.status === 'passed' && Number.isFinite(start) && Number.isFinite(end)
      && start >= previous && end >= start && end <= Date.now() + 60000, 'release_backup_phase_invalid'); previous = end;
  }
  const [preflight, backup, handoff] = value.phases;
  requireRelease(preflight.leaseHeld === true && preflight.retainedFloorVerified === true && preflight.flagsPreserved === true
    && preflight.previousSourceSha === admission.sourceSha, 'release_backup_preflight_incomplete');
  requireRelease(backup.sourceSha === admission.sourceSha && isDigest(backup.archiveSha256) && backup.remoteReadback === 'verified'
    && backup.restore === 'database_and_objects_restored' && backup.cleanupVerified === true && backup.exposure === 'quarantine',
  'release_backup_incomplete');
  requireRelease(handoff.cleanupVerified === true && handoff.leaseReleased === true && handoff.sourcePinsRetained === true,
    'release_backup_handoff_incomplete');
  return value.phases.map(({ name, startedAt, completedAt }) => ({ name, status: 'passed', startedAt, completedAt }));
}

export function operatorProgress(value, admission, installation, requestDigest) {
  validateBinding(value, admission, installation, requestDigest);
  const phases = admission.mode === 'backup' ? BACKUP_PHASES : PHASES;
  requireRelease(Array.isArray(value.phases) && value.phases.length <= phases.length, 'release_operator_progress_invalid');
  return value.phases.map((phase, i) => {
    requireRelease(phase.name === phases[i] && ['passed', 'running', 'failed'].includes(phase.status)
      && (i === value.phases.length - 1 || phase.status === 'passed'), 'release_operator_progress_invalid');
    const failure = phase.backupFailure;
    // Even a validly bound operator result may contain private diagnostics.
    // Publish only fixed daily-runner codes, never arbitrary error strings.
    const stages = ['preflight', 'capture', 'seal', 'offsite', 'readback', 'restore', 'cleanup'];
    const codes = ['daily_backup_phase_failed', 'daily_backup_target_mismatch', 'daily_backup_gc_not_disabled',
      'daily_backup_evidence_required', 'daily_backup_remote_mismatch', 'daily_backup_restore_mismatch',
      'daily_backup_cleanup_failed', 'daily_backup_aborted', 'daily_backup_ports_invalid',
      'daily_backup_policy_mismatch', 'daily_backup_protection_lost'];
    const diagnostic = ['backup', 'backup-before', 'backup-after'].includes(phase.name) && phase.status === 'failed'
      && stages.includes(failure?.stage) && codes.includes(failure?.code) && typeof failure.cleanupVerified === 'boolean'
      ? { backupFailure: { stage: failure.stage, code: failure.code, cleanupVerified: failure.cleanupVerified,
        ...(['not_started', 'running', 'failed', 'completed'].includes(failure.snapshotDump) ? { snapshotDump: failure.snapshotDump } : {}) } } : {};
    return { name: phase.name, reportedStatus: phase.status, ...diagnostic };
  });
}

export async function runOperator({ admission, installation, sourceRoot, temporaryRoot, registry,
  config, credentials, backupEvidence, recoveryEvidence, run = quietCommand, onProgress = async () => {} }) {
  const source = resolve(sourceRoot), privateDir = join(temporaryRoot, 'input'), resultDir = join(temporaryRoot, 'output');
  const workDir = join(temporaryRoot, 'work');
  requireRelease(![source, privateDir, resultDir, workDir].some(path => /[,\r\n]/.test(path)), 'release_mount_path_invalid');
  requireRelease(typeof config === 'string' && Buffer.byteLength(config) <= 262_144
    && digest(config) === installation.configSha256, 'release_config_pin_mismatch');
  let parsedConfig;
  try { parsedConfig = JSON.parse(config); } catch { /* Stable, non-secret error below. */ }
  requireRelease(parsedConfig?.format === 'freedom.shared-release-config/v1'
    && parsedConfig.target === admission.target,
  'release_config_binding_invalid');
  requireRelease(credentials && typeof credentials === 'object' && !Array.isArray(credentials), 'release_credentials_missing');
  for (const key of ['cloudflareApiToken', 'migrationDatabaseUrl', 'runtimeDatabaseUrl', 'backupDatabaseUrl']) {
    requireRelease(typeof credentials[key] === 'string' && credentials[key].length > 0, 'release_credentials_missing');
  }
  if (admission.target === 'staging-next') {
    for (const key of ['stagingAccessClientId', 'stagingAccessClientSecret']) {
      requireRelease(typeof credentials[key] === 'string' && credentials[key].length > 0
        && credentials[key].length <= 1024 && !/[\r\n\0]/.test(credentials[key]), 'release_staging_access_required');
    }
  }
  const requestBytes = json({ ...admission, operatorImage: installation.image, backupEvidence, recoveryEvidence,
    configSha256: installation.configSha256, requiredPhases: admission.mode === 'backup' ? BACKUP_PHASES : PHASES });
  const name = `freedom-release-${admission.runId}-${admission.runAttempt}`;
  await mkdir(privateDir, { recursive: false, mode: 0o700 });
  await mkdir(resultDir, { recursive: false, mode: 0o700 });
  await mkdir(workDir, { recursive: false, mode: 0o700 });
  let containerAttempted = false, progress = [], timer, progressTask = Promise.resolve();
  const readProgress = async () => {
    try {
      const value = operatorProgress(await boundedJson(join(resultDir, 'result.json')), admission, installation, digest(requestBytes));
      if (JSON.stringify(value) !== JSON.stringify(progress)) { progress = value; await onProgress(value); }
    } catch { /* Missing/partial receipt is not evidence. Final validation is mandatory. */ }
  };
  try {
    await writeFile(join(privateDir, 'request.json'), requestBytes, { mode: 0o600, flag: 'wx' });
    await writeFile(join(privateDir, 'config.json'), config, { mode: 0o600, flag: 'wx' });
    await writeFile(join(privateDir, 'credentials.json'), json(credentials), { mode: 0o600, flag: 'wx' });
    // Hosted Ubuntu runner UID is 1001. Refuse other hosts rather than widening file permissions.
    requireRelease(process.getuid?.() === 1001 || run !== quietCommand, 'release_runner_uid_invalid');
    await pullOperatorImage({ image: installation.image, temporaryRoot, registry, run });
    timer = setInterval(() => { progressTask = progressTask.then(readProgress); }, 10_000);
    containerAttempted = true;
    await run('docker', operatorCommand(installation.image, source, privateDir, resultDir, name, workDir));
    const validate = admission.mode === 'backup' ? validateBackupOperatorResult : validateOperatorResult;
    const result = validate(await boundedJson(join(resultDir, 'result.json')), admission, installation, digest(requestBytes));
    return result;
  } catch (error) {
    await readProgress();
    // Keep failure details bounded even for a malformed/private provider exception.
    const failure = Object.assign(new Error('release_operator_failed'), { code: 'release_operator_failed', operatorProgress: progress });
    if (typeof error?.code === 'string' && /^release_[a-z_]+$/.test(error.code)) failure.code = error.code;
    throw failure;
  } finally {
    clearInterval(timer);
    await progressTask;
    // Killing the Docker client does not reliably kill its container. Settle it explicitly.
    // Remote commit ambiguity still requires operator observation; never retry the release.
    let stopped = !containerAttempted;
    try {
      if (containerAttempted) await run('docker', ['rm', '--force', name], 30_000);
      stopped = true;
    } catch {
      throw Object.assign(new Error('release_operator_cleanup_unconfirmed'),
        { code: 'release_operator_cleanup_unconfirmed', operatorProgress: progress });
    } finally {
      await rm(privateDir, { recursive: true, force: true });
      await rm(resultDir, { recursive: true, force: true });
      // An unconfirmed stop may leave PostgreSQL alive. Keep its private disk
      // until the ephemeral runner is destroyed; never delete a live cluster.
      if (stopped) await rm(workDir, { recursive: true, force: true });
    }
  }
}
