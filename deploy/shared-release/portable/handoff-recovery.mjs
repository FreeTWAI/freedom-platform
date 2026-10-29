import { createHash } from 'node:crypto';
import { requireRelease as check, isDigest, isSha } from '../admission.mjs';
import { readMaterialPolicies } from './material-policy.mjs';

// No SQL mutation, build, publish, backup or new release begin is reachable here.
export async function inspectReleaseHandoff({ floor, pool, deployer, lease, request, database, role }) {
  const evidence = request.handoffRecoveryEvidence;
  check(request.mode === 'handoff' && request.releaseKind === 'independent'
    && evidence?.format === 'freedom.verified-failed-release-handoff/v1'
    && Number.isSafeInteger(evidence.runId) && evidence.runId > 0 && evidence.runId === request.recoverReleaseRunId
    && evidence.runId !== request.runId && Number.isSafeInteger(evidence.runAttempt) && evidence.runAttempt > 0
    && isSha(evidence.controllerSha) && isDigest(evidence.receiptSha256)
    && Number.isSafeInteger(evidence.artifactId) && evidence.artifactId > 0
    && /^sha256:[a-f0-9]{64}$/.test(evidence.artifactDigest ?? '')
    && ['sourceSha', 'sourceTree', 'target', 'configSha256'].every(key => evidence[key] === request[key]),
  'release_handoff_recovery_binding_invalid');
  lease.assertHeld();
  const { alreadySettled } = floor.handoffRecoveryState(evidence), state = floor.state();
  const q = await pool.connect();
  try {
    await q.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await q.query('SELECT current_database() database,current_user role,session_user session_role')).rows[0];
    check(identity?.database === database && identity.role === role && identity.session_role === role,
      'release_handoff_recovery_binding_invalid');
    await floor.verifyDatabase(q);
    const policies = await readMaterialPolicies(q);
    check(createHash('sha256').update(JSON.stringify(policies)).digest('hex') === state.materialPolicySha256,
      'release_handoff_recovery_state_changed');
    const gc = (await q.query(`SELECT (SELECT count(*)::int FROM asset_maintenance_policy) policies,
      (SELECT bool_or(enabled) FROM asset_maintenance_policy) enabled,
      (SELECT bool_or(domain_media_enabled) FROM asset_maintenance_policy) domain_enabled,
      (SELECT count(*)::int FROM assets WHERE deletion_fence<>0) fences`)).rows[0];
    check(gc?.policies === 1 && gc.enabled === false && gc.domain_enabled === false && gc.fences === 0,
      'release_handoff_recovery_state_changed');
    const sessions = (await q.query(`SELECT count(*)::int remaining FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND pid<>$1
      AND (usename IN ($2,$3) OR application_name='freedom-shared-release'
        OR application_name LIKE 'pg_dump%' OR application_name LIKE '%capture%')`, [lease.pid, role, database + '_backup'])).rows[0];
    check(sessions?.remaining === 0, 'release_handoff_recovery_state_changed');
    await q.query('ROLLBACK');
  } finally { await q.query('ROLLBACK').catch(() => {}); q.release(); }
  const worker = await deployer.inspect();
  check(worker.sourceSha === state.sourceSha && worker.bindingsSha256 === state.bindingsSha256,
    'release_handoff_recovery_state_changed');
  await floor.assertCurrent(); lease.assertHeld();
  return { alreadySettled, reconciledRunId: evidence.runId, reconciledRunAttempt: evidence.runAttempt,
    ledgerVerified: true, policyVerified: true, workerVerified: true, cleanupVerified: true };
}

export async function completeReleaseHandoff({ floor, lease, request, observed }) {
  check(observed?.cleanupVerified === true && observed.healthVerified === true
    && observed.reconciledRunId === request.recoverReleaseRunId,
    'release_handoff_recovery_binding_invalid');
  await floor.assertCurrent(); lease.assertHeld();
  const current = floor.handoffRecoveryState(request.handoffRecoveryEvidence);
  check(current.alreadySettled === observed.alreadySettled, 'release_handoff_recovery_state_changed');
  if (!observed.alreadySettled) {
    const evidence = request.handoffRecoveryEvidence;
    await floor.passed('handoff', { cleanupVerified: true, migrationVerified: true,
      reconciliation: { format: 'freedom.hosted-handoff-reconciliation/v1',
        failedRunId: evidence.runId, failedRunAttempt: evidence.runAttempt,
        artifactId: evidence.artifactId, artifactDigest: evidence.artifactDigest, receiptSha256: evidence.receiptSha256,
        settledBy: { runId: request.runId, runAttempt: request.runAttempt, actor: request.original, triggeredBy: request.triggeredBy },
        originalWorkflowFailureRetained: true } });
  }
  check(floor.state().pending === null, 'release_handoff_recovery_state_changed');
  return { reconciledRunId: observed.reconciledRunId, reconciledRunAttempt: observed.reconciledRunAttempt,
    alreadySettled: observed.alreadySettled, cleanupVerified: true, pendingCleared: true, originalFailureRetained: true };
}
