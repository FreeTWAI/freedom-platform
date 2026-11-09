import { createHash } from 'node:crypto';
import { requireRelease as check } from '../admission.mjs';
import { backupExpectation } from './backup-expectation.mjs';

/** Manual recovery of a terminal failed run, under a newly held lease. The
 * fixed operator supplies restoreArchive; dispatch inputs cannot supply code. */
export async function reconcileArchivedBackup({ floor, pool, database, role, deployer, lease, request, restoreArchive }) {
  const state = floor.state(), pending = state.pending, evidence = request.recoveryEvidence;
  const capture = pending?.intents?.['backup:capture-policy'], archive = pending?.intents?.['backup:archive'];
  check(request.mode === 'deploy' && request.releaseKind === 'independent' && request.event === 'workflow_dispatch'
    && !request.legacyPredecessor && pending?.kind === 'backup' && pending.stage === 0
    && capture && archive && Object.keys(pending.intents).length === 2
    && evidence?.format === 'freedom.verified-failed-backup/v1' && evidence.failureBoundary === 'archive_unconfirmed'
    && request.recoverRunId === pending.request.runId && request.runId !== pending.request.runId
    && evidence.runId === pending.request.runId && evidence.runAttempt === pending.request.runAttempt
    && evidence.target === request.target && evidence.configSha256 === request.configSha256
    && ['sourceSha', 'sourceTree', 'target', 'controllerSha', 'operatorImage', 'configSha256']
      .every(key => evidence[key] === pending.request[key])
    && evidence.sourceSha === state.sourceSha && evidence.sourceTree === state.sourceTree
    && state.sourceSha === state.deployedSourceSha && capture.database === database && capture.role === role
    && capture.revision === 'shared-backup-' + archive.setId && typeof restoreArchive === 'function',
  'release_backup_recovery_binding_invalid');
  const held = () => { lease.signal.throwIfAborted(); lease.assertHeld(); };
  const verify = async () => {
    held(); await floor.assertCurrent();
    const worker = await deployer.inspect();
    check(worker.sourceSha === state.deployedSourceSha && worker.bindingsSha256 === state.bindingsSha256,
      'release_backup_recovery_worker_changed');
    const q = await pool.connect();
    try {
      await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await q.query("SET LOCAL statement_timeout='30000'; SET LOCAL lock_timeout='3000'");
      const identity = (await q.query('SELECT current_database() database,current_user role')).rows[0];
      check(identity?.database === database && identity.role === role, 'release_backup_recovery_database_changed');
      await floor.verifyDatabase(q);
      const policies = (await q.query('SELECT enabled,domain_media_enabled,revision FROM asset_maintenance_policy WHERE singleton')).rows;
      check(policies.length === 1 && policies[0].enabled === false && policies[0].domain_media_enabled === false
        && policies[0].revision === capture.revision, 'release_backup_recovery_cleanup_unconfirmed');
      const backends = (await q.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
        AND usename=current_user AND left(application_name,11)='fp-capture-'`)).rows;
      const fences = (await q.query('SELECT count(*)::int count FROM assets WHERE deletion_fence<>0')).rows[0];
      check(backends.length === 0 && fences?.count === 0, 'release_backup_recovery_cleanup_unconfirmed');
      const material = (await q.query(`SELECT purpose,mode,policy_lock,policy_revision,persistence_allowed,
        retained_byte_limit::text AS retained_byte_limit FROM domain_media_storage_policy ORDER BY purpose`)).rows;
      check(createHash('sha256').update(JSON.stringify(material)).digest('hex') === state.materialPolicySha256,
        'release_backup_recovery_policy_changed');
      await q.query('COMMIT');
    } catch (error) { await q.query('ROLLBACK').catch(() => {}); throw error; }
    finally { q.release(); }
    held(); await floor.assertCurrent();
  };
  await verify();
  const restored = await restoreArchive({ intent: structuredClone(archive), expected: backupExpectation(state, state.sourceSha) });
  check(restored?.setId === archive.setId && restored.archiveSha256 === archive.archiveSha256
    && restored.sourceSha === state.sourceSha && restored.remoteReadback === 'verified'
    && restored.restore === 'database_and_objects_restored' && restored.cleanupVerified === true
    && restored.exposure === 'quarantine', 'release_floor_backup_unverified');
  await verify();
  await floor.reconcileBackup({ format: 'freedom.reconciled-archived-backup/v1', recovery: evidence,
    settledBy: { runId: request.runId, runAttempt: request.runAttempt, controllerSha: request.controllerSha,
      operatorImage: request.operatorImage, configSha256: request.configSha256 },
    setId: restored.setId, archiveSha256: restored.archiveSha256, sourceSha: state.sourceSha,
    sourceTree: state.sourceTree, bindingsSha256: state.bindingsSha256,
    ledgerSha256: backupExpectation(state, state.sourceSha).ledgerSha256, materialPolicySha256: state.materialPolicySha256,
    remoteReadback: 'verified', restore: 'database_and_objects_restored', cleanupVerified: true, exposure: 'quarantine',
    captureRevision: capture.revision, maintenanceEnabled: false, domainMaintenanceEnabled: false,
    deletionFences: 0, captureBackendAbsent: true, sourcePins: 'retained', archiveUpload: 'not_repeated',
    observedAt: new Date().toISOString() });
  return { previousRunId: evidence.runId, previousRunAttempt: evidence.runAttempt, status: 'archive_restored_after_readback' };
}
