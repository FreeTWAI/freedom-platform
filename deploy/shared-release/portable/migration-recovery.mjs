import { createHash } from 'node:crypto';
import { requireRelease as check, isDigest, isSha } from '../admission.mjs';
import { migrationLedgerDigest } from '../../../packages/db/migration-plan.mjs';
import { observeMigrationOutcome } from './migration.mjs';
import { readMaterialPolicies } from './material-policy.mjs';

/** Hosted failure evidence only authorizes readback. Under the shared lease,
 * observe the original commit intent's transaction, the retained ledger, policy,
 * GC/sessions and the unchanged Worker, then append an abandonment that keeps the
 * raised floor. No SQL mutation, publish, backup or begin is reachable here; the
 * same run then releases this committed source through the read-only schema path. */
export async function reconcileCommittedRelease({ floor, pool, database, role, deployer, lease, request }) {
  const state = floor.state(), pending = state.pending, evidence = request.migrationRecoveryEvidence;
  const commit = pending?.intents?.['migration:commit'];
  check(request.mode === 'deploy' && request.releaseKind === 'independent' && !request.recoverRunId
    && evidence?.format === 'freedom.verified-failed-release-migration/v1'
    && Number.isSafeInteger(evidence.runId) && evidence.runId > 0 && evidence.runId === request.recoverMigrationRunId
    && evidence.runId !== request.runId && isSha(evidence.controllerSha) && isDigest(evidence.receiptSha256)
    && Number.isSafeInteger(evidence.artifactId) && evidence.artifactId > 0
    && /^sha256:[a-f0-9]{64}$/.test(evidence.artifactDigest ?? '')
    && ['sourceSha', 'sourceTree', 'target', 'configSha256'].every(key => evidence[key] === request[key])
    && pending?.kind === 'code' && pending.stage === 0 && pending.committed && commit
    && Object.keys(pending.intents).length === 1 && commit.database === database
    && ['runId', 'runAttempt', 'sourceSha', 'sourceTree', 'target', 'controllerSha', 'operatorImage', 'configSha256']
      .every(key => evidence[key] === pending.request[key])
    && state.sourceSha === request.sourceSha && state.sourceTree === request.sourceTree
    && state.deployedSourceSha === pending.previousSourceSha,
  'release_migration_recovery_binding_invalid');
  const held = () => { lease.signal.throwIfAborted(); lease.assertHeld(); };
  held(); await floor.assertCurrent();
  const worker = await deployer.inspect();
  check(worker.sourceSha === state.deployedSourceSha && worker.bindingsSha256 === state.bindingsSha256,
    'release_migration_recovery_state_changed');
  // The existing observation never authorizes replay. A committed transaction
  // with the candidate ledger only permits closing the original run's stages.
  check((await observeMigrationOutcome(pool, structuredClone(commit))).outcome === 'committed_ledger_verified',
    'release_migration_recovery_outcome_unresolved');
  held();
  const q = await pool.connect();
  try {
    await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await q.query("SET LOCAL statement_timeout='30000'; SET LOCAL lock_timeout='3000'");
    const identity = (await q.query('SELECT current_database() database,current_user role,session_user session_role')).rows[0];
    check(identity?.database === database && identity.role === role && identity.session_role === role,
      'release_migration_recovery_binding_invalid');
    await floor.verifyDatabase(q);
    const policies = await readMaterialPolicies(q);
    check(createHash('sha256').update(JSON.stringify(policies)).digest('hex') === state.materialPolicySha256,
      'release_migration_recovery_state_changed');
    const gc = (await q.query(`SELECT (SELECT count(*)::int FROM asset_maintenance_policy) policies,
      (SELECT bool_or(enabled) FROM asset_maintenance_policy) enabled,
      (SELECT bool_or(domain_media_enabled) FROM asset_maintenance_policy) domain_enabled,
      (SELECT count(*)::int FROM assets WHERE deletion_fence<>0) fences`)).rows[0];
    check(gc?.policies === 1 && gc.enabled === false && gc.domain_enabled === false && gc.fences === 0,
      'release_migration_recovery_state_changed');
    // The original runner must be gone; pool reuse keeps the observation session.
    const sessions = (await q.query(`SELECT count(*)::int remaining FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND pid<>$1
      AND (usename IN ($2,$3) OR application_name='freedom-shared-release'
        OR application_name LIKE 'pg_dump%' OR application_name LIKE '%capture%')`, [lease.pid, role, database + '_backup'])).rows[0];
    check(sessions?.remaining === 0, 'release_migration_recovery_state_changed');
    await q.query('ROLLBACK');
  } finally { await q.query('ROLLBACK').catch(() => {}); q.release(); }
  held(); await floor.assertCurrent();
  const after = await deployer.inspect();
  check(after.sourceSha === worker.sourceSha && after.versionId === worker.versionId
    && after.bindingsSha256 === worker.bindingsSha256, 'release_migration_recovery_state_changed');
  await floor.abandonCommittedRelease({ format: 'freedom.abandoned-committed-release/v1', recovery: evidence,
    settledBy: { runId: request.runId, runAttempt: request.runAttempt, controllerSha: request.controllerSha,
      operatorImage: request.operatorImage, configSha256: request.configSha256 },
    transactionId: commit.transactionId, migrationOutcome: 'committed_ledger_verified',
    sourceSha: state.sourceSha, sourceTree: state.sourceTree, workerSourceSha: worker.sourceSha,
    bindingsSha256: state.bindingsSha256, ledgerSha256: migrationLedgerDigest(state.schemaLedger),
    materialPolicySha256: state.materialPolicySha256, readOnly: true, observedAt: new Date().toISOString() });
  return { previousRunId: evidence.runId, previousRunAttempt: evidence.runAttempt, status: 'abandoned_after_readback' };
}
