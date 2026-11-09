import { createHash } from 'node:crypto';
import { requireRelease as check, isDigest, isSha, releaseFailureCode } from '../admission.mjs';
import { publicControlReadFailure, publicLeaseLoss } from '../operator.mjs';
import { readMaterialPolicies } from './material-policy.mjs';

// No SQL mutation, build, publish, backup or new release begin is reachable here.
export async function inspectReleaseHandoff({ floor, pool, deployer, lease, request, database, role }) {
  const evidence = request.handoffRecoveryEvidence;
  check(request.mode === 'handoff' && request.releaseKind === 'independent'
    && (evidence?.format === 'freedom.verified-failed-release-handoff/v1' && evidence.failureBoundary === undefined
      || evidence?.format === 'freedom.verified-failed-release-health/v1' && evidence.failureBoundary === 'health_lease_lost'
        && publicLeaseLoss(evidence.leaseLoss))
    && Number.isSafeInteger(evidence.runId) && evidence.runId > 0 && evidence.runId === request.recoverReleaseRunId
    && evidence.runId !== request.runId && Number.isSafeInteger(evidence.runAttempt) && evidence.runAttempt > 0
    && isSha(evidence.controllerSha) && isDigest(evidence.receiptSha256)
    && Number.isSafeInteger(evidence.artifactId) && evidence.artifactId > 0
    && /^sha256:[a-f0-9]{64}$/.test(evidence.artifactDigest ?? '')
    && ['sourceSha', 'sourceTree', 'target', 'configSha256'].every(key => evidence[key] === request[key]),
  'release_handoff_recovery_binding_invalid');
  return inspectHandoffState({ floor, pool, deployer, lease, evidence, database, role });
}

// Both hosted recovery and same-run settlement use these exact live checks.
async function inspectHandoffState({ floor, pool, deployer, lease, evidence, database, role, requireWorkerVersion = false }) {
  lease.assertHeld();
  const { alreadySettled, healthPending, sourceSha, workerVersionId } = floor.handoffRecoveryState(evidence), state = floor.state();
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
  check(worker.sourceSha === sourceSha && worker.bindingsSha256 === state.bindingsSha256,
    'release_handoff_recovery_state_changed');
  if (requireWorkerVersion || evidence.failureBoundary === 'health_lease_lost') check(worker.versionId === workerVersionId
    && typeof workerVersionId === 'string', 'release_handoff_recovery_state_changed');
  await floor.assertCurrent(); lease.assertHeld();
  return { alreadySettled, healthPending, reconciledRunId: evidence.runId, reconciledRunAttempt: evidence.runAttempt,
    ledgerVerified: true, policyVerified: true, workerVerified: true, cleanupVerified: true };
}

export async function completeReleaseHandoff({ floor, lease, request, observed }) {
  check(observed?.cleanupVerified === true && observed.healthVerified === true
    && observed.reconciledRunId === request.recoverReleaseRunId,
    'release_handoff_recovery_binding_invalid');
  if (request.handoffRecoveryEvidence.failureBoundary === 'health_lease_lost') {
    const proof = observed.healthProof;
    check(proof?.sourceSha === request.sourceSha && proof.statusCode === 200
      && proof.schemaVerified === true && proof.smokePassed === true, 'release_floor_health_unverified');
  }
  await floor.assertCurrent(); lease.assertHeld();
  const current = floor.handoffRecoveryState(request.handoffRecoveryEvidence);
  check(current.alreadySettled === observed.alreadySettled && current.healthPending === observed.healthPending,
    'release_handoff_recovery_state_changed');
  if (!observed.alreadySettled) {
    const evidence = request.handoffRecoveryEvidence;
    if (current.healthPending) await floor.passed('health', observed.healthProof);
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

/** Same-run evidence is the original request and retained head, never a failed
 * hosted artifact. Require the missing event; an uncertain append stays hosted. */
export async function inspectOwnReleaseHandoff({ floor, request, expectedHead, ...ports }) {
  check(request.mode === 'deploy' && request.releaseKind === 'independent'
    && isDigest(expectedHead) && floor.head() === expectedHead, 'release_handoff_recovery_state_changed');
  check(floor.handoffRecoveryState(request).alreadySettled === false, 'release_handoff_recovery_state_changed');
  return inspectHandoffState({ floor, request, evidence: request, ...ports });
}

/** Recover only this run's single missing handoff, with fresh signal-bound ports.
 * No migration, publish, backup or flag operation is reachable from this helper. */
export async function settleOwnHandoff({ request, phases, lease, expectedHead, error, acquire, reopen, verifyHealth,
  signal, renewConnections = async () => {}, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const loss = publicLeaseLoss(lease?.loss());
  const original = Object.assign(new Error('release_lease_lost'), { code: 'release_lease_lost', leaseLoss: loss });
  if (!['release_lease_lost', 'release_lease_not_held'].includes(releaseFailureCode(error))
    || !loss || !lease.signal.aborted || signal?.aborted || request.mode !== 'deploy' || request.releaseKind !== 'independent'
    || phases.length !== 4 || !['preflight', 'migration', 'deploy', 'health'].every((name, i) =>
      phases[i].name === name && phases[i].status === 'passed')) throw error;
  // release destroys an ownership-lost connection even when unlock is impossible.
  await lease.release().catch(() => {});
  let fresh;
  try {
    // Retire this process's idle probe connections so the shared recovery
    // check can require zero other release sessions without exemptions.
    await renewConnections();
    for (let attempts = 1; attempts <= 3; attempts++) {
      signal?.throwIfAborted();
      try { fresh = await acquire(); }
      catch (failure) {
        if (failure.code !== 'release_lease_busy' || attempts === 3) throw failure;
        await pause(2000); continue;
      }
      const ports = await reopen(fresh);
      await inspectOwnReleaseHandoff({ ...ports, lease: fresh, request, expectedHead });
      await verifyHealth(fresh);
      await ports.floor.assertCurrent(); fresh.assertHeld();
      check(ports.floor.head() === expectedHead && !ports.floor.handoffRecoveryState(request).alreadySettled,
        'release_handoff_recovery_state_changed');
      await ports.floor.passed('handoff', { cleanupVerified: true, migrationVerified: true });
      await fresh.release(); fresh = undefined;
      return { cleanupVerified: true, leaseReleased: true, retainedFloorAdvanced: true,
        leaseLoss: loss, leaseRecovered: { cause: loss.cause, attempts } };
    }
  } catch { throw original; }
  finally { if (fresh) await fresh.release().catch(() => {}); }
}

/** Only entry's confirmed handoff head permits this read-only cleanup recovery.
 * An unknown append or changed request/head remains a hosted reconciliation. */
export async function settleOwnConfirmedHandoff({ request, phases, lease, expectedHead, error, acquire, reopen, verifyHealth,
  signal, renewConnections, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const loss = publicLeaseLoss(lease?.loss());
  if (releaseFailureCode(error) !== 'release_lease_cleanup_failed'
    || !loss || !lease.signal.aborted || signal?.aborted || request.mode !== 'deploy' || request.releaseKind !== 'independent'
    || !isDigest(expectedHead) || phases.length !== 4 || !['preflight', 'migration', 'deploy', 'health'].every((name, i) =>
      phases[i].name === name && phases[i].status === 'passed')) throw error;
  const original = Object.assign(new Error('release_lease_cleanup_failed'), { code: 'release_lease_cleanup_failed', leaseLoss: loss });
  await lease.release().catch(() => {});
  let fresh;
  try {
    await renewConnections();
    for (let attempts = 1; attempts <= 3; attempts++) {
      signal?.throwIfAborted();
      try { fresh = await acquire(); }
      catch (failure) {
        if (failure.code !== 'release_lease_busy' || attempts === 3) throw failure;
        await pause(2000); continue;
      }
      const ports = await reopen(fresh);
      const inspect = async () => {
        check(ports.floor.head() === expectedHead && ports.floor.state().pending === null,
          'release_handoff_recovery_state_changed');
        const observed = await inspectHandoffState({ ...ports, lease: fresh, evidence: request, requireWorkerVersion: true });
        check(observed.alreadySettled === true && observed.healthPending === false,
          'release_handoff_recovery_state_changed');
      };
      await inspect();
      const health = await verifyHealth(fresh);
      check(health?.sourceSha === request.sourceSha && health.statusCode === 200,
        'release_floor_health_unverified');
      await inspect(); signal?.throwIfAborted();
      await fresh.release(); fresh = undefined;
      return { cleanupVerified: true, leaseReleased: true, retainedFloorAdvanced: true,
        leaseLoss: loss, leaseRecovered: { cause: loss.cause, attempts } };
    }
  } catch { throw original; }
  finally { if (fresh) await fresh.release().catch(() => {}); }
}

/** Recheck only this run's read-only health phase under a new lease. The exact
 * pre-health head must remain: an uncertain health append requires hosted readback.
 * Return ownership to the entry so its normal handoff uses these fresh ports. */
export async function settleOwnHealth({ request, phases, lease, expectedHead, error, acquire, reopen, verifyHealth,
  signal, renewConnections, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const loss = publicLeaseLoss(lease?.loss());
  if (!['release_lease_lost', 'release_lease_not_held'].includes(releaseFailureCode(error))
    || !loss || !lease.signal.aborted || signal?.aborted || request.mode !== 'deploy' || request.releaseKind !== 'independent'
    || phases.length !== 3 || !['preflight', 'migration', 'deploy'].every((name, i) =>
      phases[i].name === name && phases[i].status === 'passed') || !isDigest(expectedHead)) throw error;
  const original = Object.assign(new Error('release_lease_lost'), { code: 'release_lease_lost', leaseLoss: loss });
  const controlReadFailure = publicControlReadFailure(error.controlReadFailure);
  if (controlReadFailure) original.controlReadFailure = controlReadFailure;
  await lease.release().catch(() => {});
  let fresh;
  try {
    await renewConnections();
    for (let attempts = 1; attempts <= 3; attempts++) {
      signal?.throwIfAborted();
      try { fresh = await acquire(); }
      catch (failure) {
        if (failure.code !== 'release_lease_busy' || attempts === 3) throw failure;
        await pause(2000); continue;
      }
      const ports = await reopen(fresh), evidence = { ...request, failureBoundary: 'health_lease_lost' };
      check(ports.floor.head() === expectedHead && ports.floor.handoffRecoveryState(evidence).healthPending,
        'release_handoff_recovery_state_changed');
      await inspectHandoffState({ ...ports, lease: fresh, evidence });
      const proof = await verifyHealth(fresh, ports);
      await inspectHandoffState({ ...ports, lease: fresh, evidence });
      await ports.floor.assertCurrent(); fresh.assertHeld();
      check(ports.floor.head() === expectedHead && ports.floor.handoffRecoveryState(evidence).healthPending,
        'release_handoff_recovery_state_changed');
      await ports.floor.passed('health', { ...proof, schemaVerified: true });
      const held = fresh; fresh = undefined;
      return { ...ports, lease: held, proof: { ...proof, schemaVerified: true,
        leaseLoss: loss, leaseRecovered: { cause: loss.cause, attempts } } };
    }
  } catch { throw original; }
  finally { if (fresh) await fresh.release().catch(() => {}); }
}
