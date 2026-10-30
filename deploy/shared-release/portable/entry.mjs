import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Pool } from 'pg';
import { releasePhases, REPOSITORY, REPOSITORY_ID, requireRelease as check, isSha, releaseFailureCode } from '../admission.mjs';
import { validateOperatorResult, validateBackupOperatorResult, publicControlReadFailure, publicLeaseLoss } from '../operator.mjs';
import { BACKUP_PHASES } from '../scheduled-admission.mjs';
import { validatePortableConfig, portableConnections } from './config.mjs';
import { privateBackupRoot } from './backup-storage.mjs';
import { acquireReleaseLease } from './lease.mjs';
import { createControlStore } from './control-store.mjs';
import { openReleaseFloor } from './floor.mjs';
import { createWorkerDeployer, assertReleasePredecessor } from './deploy.mjs';
import { createCloudflareRecoveryTransport, waitForPublicRelease } from './cloudflare.mjs';
import { buildApplication, verifyApplicationSource } from './build.mjs';
import { applyFlagDecisions, readFlagDecisions } from './flag-decisions.mjs';
import { deriveCandidateContract } from './candidate-contract.mjs';
import { preparePortableMigration, runPortableMigration, verifyUnchangedSchema, sourceMigrationProfile } from './migration.mjs';
import { runPortableBackup } from './backup.mjs';
import { backupExpectation } from './backup-expectation.mjs';
import { reconcileFailedBackup, adoptLegacyPredecessor } from './backup-recovery.mjs';
import { inspectReleaseHandoff, completeReleaseHandoff, settleOwnHandoff } from './handoff-recovery.mjs';
import { verifyPublicSmoke } from './smoke.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b, code) => check(JSON.stringify(a) === JSON.stringify(b), code);
const SOURCE = '/release/source', WORK = '/release/work', BIN = '/usr/lib/postgresql/18/bin';
const inputPaths = ['/release/input/request.json', '/release/input/config.json', '/release/input/credentials.json'];
async function input(path, max) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await f.stat();
    check(s.isFile() && s.nlink === 1 && s.uid === process.getuid() && (s.mode & 0o077) === 0 && s.size <= max,
      'release_input_file_invalid');
    const bytes = await f.readFile(); check(bytes.length === s.size, 'release_input_file_changed');
    return { bytes, value: JSON.parse(bytes) };
  } finally { await f.close(); }
}
async function save(path, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n'); check(bytes.length <= 65536, 'release_result_too_large');
  const temporary = join(dirname(path), 'result-' + randomUUID() + '.json'), file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await rename(temporary, path);
}

/** Fixed image entry. Paths, programs and phase order cannot come from inputs.
 * The outer main-only controller authenticates admission and scheduler evidence;
 * this process performs actual provider/DB operations, not a receipt-only port. */
export async function main(args = process.argv.slice(2)) {
  same(args, ['--request', inputPaths[0], '--config', inputPaths[1], '--credentials', inputPaths[2],
    '--result', '/release/output/result.json'], 'release_entry_arguments_invalid');
  check(process.getuid() === 1001 && process.getgid() === 1001, 'release_entry_identity_invalid');
  const [rawRequest, rawConfig, rawCredentials] = await Promise.all(inputPaths.map((path, i) => input(path, i === 2 ? 65536 : 262144)));
  const request = rawRequest.value, credentials = rawCredentials.value, path = args[7];
  check(request.repository === REPOSITORY && request.repositoryId === REPOSITORY_ID && ['deploy', 'backup', 'handoff'].includes(request.mode)
    && isSha(request.sourceSha) && isSha(request.sourceTree) && isSha(request.controllerSha)
    && request.configSha256 === hash(rawConfig.bytes), 'release_entry_request_invalid');
  const isBackup = request.mode === 'backup', isHandoff = request.mode === 'handoff', independentRelease = request.releaseKind === 'independent',
    phases = isBackup ? BACKUP_PHASES : releasePhases(request);
  same(request.requiredPhases, phases, 'release_entry_phases_invalid');
  const config = validatePortableConfig(rawConfig.value, request.target), connections = portableConnections(config, credentials, { includeBackup: !independentRelease });
  const installation = { image: request.operatorImage, configSha256: request.configSha256 };
  const result = { format: isBackup ? 'freedom.shared-backup-operator-result/v1' : 'freedom.shared-release-operator-result/v1', requestSha256: hash(rawRequest.bytes),
    sourceSha: request.sourceSha, target: request.target, runId: request.runId, runAttempt: request.runAttempt,
    operatorImage: request.operatorImage, configSha256: request.configSha256, phases: [] };
  const controller = new AbortController(), stop = () => controller.abort(Error('release_operator_interrupted'));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const pools = Object.fromEntries(Object.entries(connections).map(([key, value]) => [key, new Pool(value.options)]));
  for (const pool of Object.values(pools)) pool.on('error', stop);
  let lease, floor, deployer, transport, before, plan, expected, built, beforeBackup, unchangedProof, handoffObserved;
  const access = request.target === 'staging-next' ? { clientId: credentials.stagingAccessClientId, clientSecret: credentials.stagingAccessClientSecret } : undefined;
  const directory = async name => { const path = join(WORK, name); await mkdir(path, { mode: 0o700 }); return path; };
  const acquire = () => acquireReleaseLease(pools.migrator, { database: config.database.name,
    role: connections.migrator.role, signal: controller.signal });
  const reopen = async (held, intentName) => {
    const store = createControlStore({ accountId: config.accountId, bucket: config.backupBucket, target: config.target,
      ...config.floor, token: credentials.cloudflareApiToken, lease: held });
    return { floor: await openReleaseFloor({ store, sourceRoot: SOURCE, intentDirectory: await directory(intentName) }),
      deployer: createWorkerDeployer({ accountId: config.accountId, zoneId: config.zoneId, target: config.target,
        token: credentials.cloudflareApiToken, signal: held.signal }), pool: pools.migrator,
      database: config.database.name, role: connections.migrator.role };
  };
  const phase = async (name, operation) => {
    same(name, phases[result.phases.length], 'release_entry_phase_order');
    const item = { name, status: 'running', startedAt: new Date().toISOString() }; result.phases.push(item); await save(path, result);
    try { Object.assign(item, await operation(), { status: 'passed', completedAt: new Date().toISOString() }); }
    catch (error) {
      Object.assign(item, { status: 'failed', failureCode: releaseFailureCode(error), completedAt: new Date().toISOString() });
      const controlReadFailure = publicControlReadFailure(error.controlReadFailure);
      if (controlReadFailure) item.controlReadFailure = controlReadFailure;
      const leaseLoss = publicLeaseLoss(error.leaseLoss ?? lease?.loss());
      if (leaseLoss) {
        item.leaseLoss = leaseLoss;
        if (item.failureCode === 'release_lease_not_held') item.failureCode = 'release_lease_lost';
      }
      if (error.backupFailure) item.backupFailure = error.backupFailure;
      throw error;
    }
    finally { await save(path, result); }
  };
  const backup = async (stage, sourceSha) => {
    const state = floor.state(), workRoot = await directory(stage), context = { environment: config.fixed.environment,
      database: config.database.name, schema: 'public', sourceRelease: sourceSha, operatorSource: request.controllerSha,
      setId: randomUUID(), createdAt: new Date().toISOString(), runDirectory: workRoot, signal: lease.signal };
    const value = await runPortableBackup({ context, workRoot, pool: pools.backup, role: connections.backup.role,
      maintenancePool: pools.migrator, maintenanceRole: connections.migrator.role,
      runtimeRole: connections.runtime.role, lease, transport, connection: connections.backup.env, binDirectory: BIN,
      expected: backupExpectation(state, sourceSha),
      retainIntent: (operation, proof) => floor.intent(stage, operation, proof),
      verifyRetainedFloor: (pool, options) => floor.verifyDatabase(pool, options) });
    if (value.status !== 'passed' || value.exposure !== 'quarantine_not_approved_for_exposure') {
      throw Object.assign(new Error('release_entry_backup_failed'), { code: 'release_entry_backup_failed',
        backupFailure: { stage: value.stage, code: value.code, cleanupVerified: value.cleanupVerified, snapshotDump: value.snapshotDump,
          phaseCode: value.phaseCode, cleanupCode: value.cleanupCode } });
    }
    // The full backup report can contain object/capture metadata and is retained
    // privately. Keep both the journal event and bounded result explicitly small.
    const proof = { setId: value.setId, sourceSha, archiveSha256: value.archiveSha256,
      remoteReadback: value.remoteReadback, restore: value.restore, cleanupVerified: value.cleanupVerified, exposure: 'quarantine' };
    await floor.passed(stage, proof); return { report: value, proof };
  };
  try {
    await privateBackupRoot(WORK);
    await phase('preflight', async () => {
      await verifyApplicationSource(SOURCE, request.sourceSha, request.sourceTree);
      const schedule = request.scheduleEvidence;
      if (!isBackup && !independentRelease) check(schedule?.format === 'freedom.verified-scheduled-backup/v1' && schedule.operatorImage === request.operatorImage
        && schedule.configSha256 === request.configSha256 && Date.now() - Date.parse(schedule.completedAt) <= 36 * 3600000,
      'release_entry_schedule_required');
      lease = await acquire();
      ({ floor, deployer } = await reopen(lease, 'control-intents'));
      if (isHandoff) {
        handoffObserved = await inspectReleaseHandoff({ floor, pool: pools.migrator, deployer, lease, request,
          database: config.database.name, role: connections.migrator.role });
        await waitForPublicRelease({ target: config.target, sourceSha: request.sourceSha, access, signal: lease.signal,
          record: value => save(join(WORK, `handoff-health-${value.attempt}.json`), value) });
        handoffObserved.healthVerified = true;
        return { ...handoffObserved, leaseHeld: true, retainedFloorVerified: true };
      }
      // Refuse oversized changes before recovery/adoption can write the floor.
      // Build/render checks again against the verified predecessor before begin.
      if (!isBackup) applyFlagDecisions({ target: config.target, bindings: (await deployer.inspect()).bindings,
        decisions: readFlagDecisions({ sourceRoot: SOURCE, sourceSha: request.sourceSha }) });
      let recovery;
      if (request.recoverRunId) {
        if (independentRelease) check(['before_capture', 'before_dump'].includes(request.recoveryEvidence?.failureBoundary), 'release_backup_recovery_boundary_invalid');
        const previous = floor.state();
        recovery = await reconcileFailedBackup({ floor, pool: pools.migrator, database: config.database.name, role: connections.migrator.role, deployer, lease,
          request: independentRelease ? { ...request, mode: 'backup', event: 'workflow_dispatch',
            sourceSha: previous.sourceSha, sourceTree: previous.sourceTree } : request });
      }
      if (independentRelease) await adoptLegacyPredecessor({ floor, pool: pools.migrator, deployer, lease, request });
      const state = floor.state(); check(state.pending === null, 'release_floor_unsettled');
      before = await deployer.inspect();
      assertReleasePredecessor(before, state);
      await floor.verifyDatabase(pools.migrator);
      transport = createCloudflareRecoveryTransport({ accountId: config.accountId, target: config.target,
        mediaBucket: config.mediaBucket, backupBucket: config.backupBucket, token: credentials.cloudflareApiToken, signal: lease.signal });
      check(before.bindings.find(row => row.name === 'MEDIA')?.bucket_name === config.mediaBucket, 'release_entry_media_binding_changed');
      if (isBackup) {
        check(request.sourceSha === before.sourceSha, 'release_backup_source_changed'); await floor.beginBackup(request);
        return { leaseHeld: true, retainedFloorVerified: true, flagsPreserved: true, previousSourceSha: before.sourceSha,
          ...(recovery ? { recovery } : {}) };
      }
      const profile = sourceMigrationProfile(SOURCE, config.migrationProfile);
      plan = preparePortableMigration({ sourceRoot: SOURCE, sourceCommit: request.sourceSha, profile,
        installationParent: await directory('migration-installations'), beforeLedger: state.schemaLedger });
      expected = await deriveCandidateContract({ sourceRoot: SOURCE, sourceSha: request.sourceSha, sourceTree: request.sourceTree,
        profile, materialPolicySha256: state.materialPolicySha256, beforeLedger: state.schemaLedger,
        workRoot: await directory('candidate-database'), binDirectory: BIN, signal: lease.signal });
      built = await buildApplication({ sourceRoot: SOURCE, sourceSha: request.sourceSha, sourceTree: request.sourceTree,
        workRoot: await directory('build'), target: config.target, before, signal: lease.signal });
      if (independentRelease && plan.pending.length === 0) {
        unchangedProof = await verifyUnchangedSchema({ pool: pools.migrator, runtimePool: pools.runtime,
          database: config.database.name, plan, expected, lease, floor });
      }
      if (!independentRelease) await floor.begin(request, { sourceSha: request.sourceSha, sourceTree: request.sourceTree,
        schemaLedger: plan.afterLedger, bindingsSha256: built.bindingsSha256 });
      return { leaseHeld: true, sourceCompatible: true, retainedFloorVerified: true, flagsPreserved: true,
        previousSourceSha: before.sourceSha, flagChanges: built.flagChanges };
    });
    if (isHandoff) {
      await phase('handoff', async () => {
        const proof = await completeReleaseHandoff({ floor, lease, request, observed: handoffObserved });
        await lease.release(); lease = null;
        return { ...proof, leaseReleased: true };
      });
      validateOperatorResult(result, request, installation, result.requestSha256);
      return;
    }
    if (isBackup) {
      await phase('backup', async () => (await backup('backup', request.sourceSha)).proof);
      await phase('handoff', async () => {
        await floor.assertCurrent(); lease.assertHeld(); await lease.release(); lease = null;
        return { cleanupVerified: true, leaseReleased: true, sourcePinsRetained: true };
      });
      validateBackupOperatorResult(result, request, installation, result.requestSha256); return;
    }
    if (independentRelease) {
      await phase('migration', async () => {
        const begin = () => floor.beginIndependent(request, { sourceSha: request.sourceSha,
          sourceTree: request.sourceTree, schemaLedger: plan.afterLedger, bindingsSha256: built.bindingsSha256 });
        if (plan.pending.length === 0) { lease.assertHeld(); await begin(); }
        const proof = plan.pending.length === 0
          ? unchangedProof
          : { ...await runPortableMigration({ pool: pools.migrator, runtimePool: pools.runtime,
            database: config.database.name, plan, expected, previousSourceSha: before.sourceSha, independent: true, beginMutation: begin,
            journalRoot: await directory('migration'), lease, assertFloor: () => floor.assertCurrent(),
            verifyRetainedConstraints: q => floor.verifyConstraints(q), retainCommitIntent: proof => floor.intent('migration', 'commit', proof),
            retainCommittedFloor: proof => floor.committed(proof) }), ledgerSha256: plan.afterDigest };
        await floor.passed('migration', proof); return proof;
      });
    } else {
      await phase('backup-before', async () => {
        const value = await backup('backup-before', before.sourceSha); beforeBackup = value.report; return value.proof;
      });
      await phase('migration', async () => {
        const value = await runPortableMigration({ pool: pools.migrator, runtimePool: pools.runtime, backupPool: pools.backup,
          database: config.database.name, plan, expected, beforeBackup, previousSourceSha: before.sourceSha,
          journalRoot: await directory('migration'), lease, assertFloor: () => floor.assertCurrent(),
          verifyRetainedConstraints: q => floor.verifyConstraints(q), retainCommitIntent: proof => floor.intent('migration', 'commit', proof),
          retainCommittedFloor: proof => floor.committed(proof) });
        await floor.passed('migration', { ...value, ledgerSha256: plan.afterDigest }); return value;
      });
    }
    await phase('deploy', async () => {
      await built.assertUnchanged(); await floor.assertCurrent();
      const value = await deployer.publish({ sourceSha: request.sourceSha, before, source: built.source, sourceRoot: built.root,
        workRoot: await directory('deploy'), lease, retainIntent: proof => floor.intent('deploy', 'publish', proof) });
      await floor.passed('deploy', value); return value;
    });
    await phase('health', async () => {
      const workRoot = await directory('health');
      await waitForPublicRelease({ target: config.target, sourceSha: request.sourceSha, access, signal: lease.signal,
        record: value => save(join(workRoot, `edge-${value.attempt}.json`), value) });
      const value = await verifyPublicSmoke({ target: config.target, sourceSha: request.sourceSha, sourceRoot: SOURCE, access, workRoot, signal: lease.signal });
      await floor.verifyDatabase(pools.migrator);
      const proof = { ...value, schemaVerified: true }; await floor.passed('health', proof); return proof;
    });
    if (!independentRelease) await phase('backup-after', async () => (await backup('backup-after', request.sourceSha)).proof);
    await phase('handoff', async () => {
      const expectedHead = floor.head();
      try {
        await floor.assertCurrent(); lease.assertHeld();
        await floor.passed('handoff', { cleanupVerified: true, ...(independentRelease ? { migrationVerified: true } : { schedule: request.scheduleEvidence }) });
        await lease.release(); lease = null;
        return { ...(independentRelease ? {} : { scheduledBackupsVerified: true }), cleanupVerified: true, leaseReleased: true, retainedFloorAdvanced: true };
      } catch (error) {
        return settleOwnHandoff({ request, phases: result.phases.slice(0, -1), lease, expectedHead, error,
          signal: controller.signal, acquire, renewConnections: async () => {
            const ended = await Promise.allSettled(Object.values(pools).map(pool => pool.end()));
            check(ended.every(item => item.status === 'fulfilled'), 'release_entry_pool_cleanup_failed');
            for (const [key, value] of Object.entries(connections)) {
              pools[key] = new Pool(value.options); pools[key].on('error', stop);
            }
          }, reopen: held => reopen(held, 'handoff-control-intents'),
          verifyHealth: held => waitForPublicRelease({ target: config.target, sourceSha: request.sourceSha, access, signal: held.signal,
            record: value => save(join(WORK, `handoff-health-${value.attempt}.json`), value) }) });
      }
    });
    validateOperatorResult(result, request, installation, result.requestSha256);
  } finally {
    try { if (lease) await lease.release(); }
    finally {
      const ended = await Promise.allSettled(Object.values(pools).map(pool => pool.end()));
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      check(ended.every(item => item.status === 'fulfilled'), 'release_entry_pool_cleanup_failed');
    }
  }
}

if (process.argv[1]?.endsWith('/portable/entry.mjs')) {
  try { await main(); } catch { process.stderr.write('release_operator_failed\n'); process.exitCode = 1; }
}
