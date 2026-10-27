import { requireRelease as check } from '../admission.mjs';
import { createHash } from 'node:crypto';
import { migrationLedgerDigest } from '../../../packages/db/migration-plan.mjs';

/** Only a stopped backup with no archive intent can be abandoned. Observe the
 * actual DB/Worker under the shared lease; never reset a seed or mark it passed.
 * Migration/deploy intents and unknown archive uploads need separate recovery. */
export async function reconcileFailedBackup({ floor, pool, database, role, deployer, lease, request }) {
  const state = floor.state(), pending = state.pending, evidence = request.recoveryEvidence;
  const capture = pending?.intents?.['backup:capture-policy'];
  const unstarted = !capture && pending?.intents && Object.keys(pending.intents).length === 0
    && evidence?.failureBoundary === 'before_dump';
  const beginOnly = !capture && pending?.intents && Object.keys(pending.intents).length === 0
    && evidence?.failureBoundary === 'before_capture';
  check(request.mode === 'backup' && request.event === 'workflow_dispatch' && pending?.kind === 'backup'
    && pending.stage === 0 && (beginOnly || unstarted || (capture && Object.keys(pending.intents).length === 1))
    && request.recoverRunId === pending.request.runId && request.runId !== pending.request.runId
    && evidence?.format === 'freedom.verified-failed-backup/v1'
    && request.sourceSha === state.sourceSha && request.sourceTree === state.sourceTree
    && evidence.runId === pending.request.runId && evidence.runAttempt === pending.request.runAttempt
    && evidence.target === request.target && evidence.configSha256 === request.configSha256
    && ['sourceSha', 'sourceTree', 'controllerSha', 'operatorImage', 'configSha256']
      .every(key => evidence[key] === pending.request[key])
    && evidence.sourceSha === state.sourceSha && evidence.sourceTree === state.sourceTree,
  'release_backup_recovery_binding_invalid');
  const held = () => { lease.signal.throwIfAborted(); lease.assertHeld(); };
  check(!request.legacyPredecessor || evidence.failureBoundary !== 'before_dump', 'release_backup_recovery_worker_changed');
  held(); await floor.assertCurrent();
  const worker = await deployer.inspect();
  const legacy = request.legacyPredecessor;
  const advanced = worker.sourceSha !== state.deployedSourceSha;
  if (advanced) {
    check(beginOnly && legacy?.sourceSha === worker.sourceSha && legacy.admittedRunId === request.runId
      && legacy.admittedRunAttempt === request.runAttempt, 'release_backup_recovery_worker_changed');
    floor.verifyLegacySource(legacy);
  }
  check((advanced || worker.sourceSha === state.deployedSourceSha) && state.sourceSha === state.deployedSourceSha
    && worker.bindingsSha256 === state.bindingsSha256, 'release_backup_recovery_worker_changed');
  const q = await pool.connect(); let observations;
  try {
    await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await q.query("SET LOCAL statement_timeout='30000'; SET LOCAL lock_timeout='3000'");
    const identity = (await q.query('SELECT current_database() database,current_user role')).rows[0];
    check(identity?.database === (beginOnly || unstarted ? database : capture.database)
      && identity.role === (beginOnly || unstarted ? role : capture.role), 'release_backup_recovery_database_changed');
    await floor.verifyDatabase(q);
    const policy = (await q.query(`SELECT enabled,domain_media_enabled,revision,
      encode(pg_catalog.sha256(convert_to((to_jsonb(p)-'generation')::text,'UTF8')),'hex') AS policy_sha256
      FROM asset_maintenance_policy p WHERE singleton`)).rows;
    const unmutated = evidence.failureBoundary === 'before_dump' && capture && policy.length === 1
      && policy[0].revision !== capture.revision && policy[0].policy_sha256 === capture.before;
    check(policy.length === 1 && policy[0].enabled === false && policy[0].domain_media_enabled === false
      && (beginOnly || unstarted || unmutated || policy[0].revision === capture.revision), 'release_backup_recovery_cleanup_unconfirmed');
    const backend = beginOnly || unstarted ? (await q.query(`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND usename=current_user AND left(application_name,11)='fp-capture-'`)).rows
      : (await q.query(`SELECT pid FROM pg_stat_activity
      WHERE pid=$1 AND datname=$2 AND usename=$3 AND application_name=$4`,
    [capture.pid, capture.database, capture.role, capture.application])).rows;
    const fences = (await q.query('SELECT count(*)::int count FROM assets WHERE deletion_fence<>0')).rows[0];
    check(backend.length === 0 && fences?.count === 0, 'release_backup_recovery_cleanup_unconfirmed');
    const material = (await q.query(`SELECT purpose,mode,policy_lock,policy_revision,persistence_allowed,
      retained_byte_limit::text AS retained_byte_limit FROM domain_media_storage_policy ORDER BY purpose`)).rows;
    check(createHash('sha256').update(JSON.stringify(material)).digest('hex') === state.materialPolicySha256,
      'release_backup_recovery_policy_changed');
    observations = { maintenanceEnabled: false, domainMaintenanceEnabled: false, deletionFences: 0,
      captureBackendAbsent: true, ...(beginOnly ? { failureBoundary: 'before_capture' }
        : unstarted ? { failureBoundary: 'before_dump', capturePolicyIntent: 'absent' }
        : unmutated ? { failureBoundary: 'before_dump', capturePolicy: 'not_committed', policySha256: policy[0].policy_sha256 }
        : { captureRevision: policy[0].revision }) };
    await q.query('COMMIT');
  } catch (error) { await q.query('ROLLBACK').catch(() => {}); throw error; }
  finally { q.release(); }
  held(); await floor.assertCurrent();
  const proof = { format: 'freedom.abandoned-backup/v1', recovery: evidence,
    settledBy: { runId: request.runId, runAttempt: request.runAttempt, controllerSha: request.controllerSha,
      operatorImage: request.operatorImage, configSha256: request.configSha256 },
    sourceSha: state.sourceSha, sourceTree: state.sourceTree, bindingsSha256: state.bindingsSha256,
    ledgerSha256: migrationLedgerDigest(state.schemaLedger), materialPolicySha256: state.materialPolicySha256, ...observations,
    ...(advanced ? { legacyPredecessor: legacy } : {}),
    sourcePins: 'retained', archiveIntent: 'absent', observedAt: new Date().toISOString() };
  await floor.abandonBackup(proof);
  return { previousRunId: evidence.runId, previousRunAttempt: evidence.runAttempt, status: 'abandoned_after_readback' };
}

/** Adopt an already successful legacy deployment without changing schema,
 * bindings, original seed or recovery authority. This only appends a transition. */
export async function adoptLegacyPredecessor({ floor, pool, deployer, lease, request }) {
  const state = floor.state(), evidence = request.legacyPredecessor;
  const held = () => { lease.signal.throwIfAborted(); lease.assertHeld(); };
  held(); await floor.assertCurrent();
  const before = await deployer.inspect();
  if (before.sourceSha === state.deployedSourceSha) return;
  check(request.releaseKind === 'independent' && state.pending === null && state.sourceSha === state.deployedSourceSha
    && evidence?.sourceSha === before.sourceSha && evidence.admittedRunId === request.runId
    && evidence.admittedRunAttempt === request.runAttempt && evidence.target === request.target
    && before.bindingsSha256 === state.bindingsSha256, 'release_legacy_predecessor_changed');
  floor.verifyLegacySource(evidence);
  const q = await pool.connect();
  try {
    await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await q.query("SET LOCAL statement_timeout='30000'; SET LOCAL lock_timeout='3000'");
    await floor.verifyDatabase(q);
    const material = (await q.query(`SELECT purpose,mode,policy_lock,policy_revision,persistence_allowed,
      retained_byte_limit::text AS retained_byte_limit FROM domain_media_storage_policy ORDER BY purpose`)).rows;
    check(createHash('sha256').update(JSON.stringify(material)).digest('hex') === state.materialPolicySha256,
      'release_legacy_policy_changed');
    await q.query('ROLLBACK');
  } catch (error) { await q.query('ROLLBACK').catch(() => {}); throw error; }
  finally { q.release(); }
  held(); await floor.assertCurrent();
  const after = await deployer.inspect();
  check(after.sourceSha === before.sourceSha && after.bindingsSha256 === before.bindingsSha256,
    'release_legacy_predecessor_changed');
  await floor.adoptLegacySource({ evidence, previousSourceSha: state.sourceSha, bindingsSha256: state.bindingsSha256,
    ledgerSha256: migrationLedgerDigest(state.schemaLedger), materialPolicySha256: state.materialPolicySha256,
    readOnly: true, observedAt: new Date().toISOString() });
}
