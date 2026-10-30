import { REPOSITORY, REPOSITORY_ID, requireRelease as check, isSha, admitRelease } from './admission.mjs';

const prefix = `/repos/${REPOSITORY}`;
const id = value => Number.isSafeInteger(value) && value > 0;

/** A notification selects a candidate, never supplies CI or deployment proof.
 * Only the read-only admission job may skip while the other CI run is pending.
 * Execution repeats all checks and never retries a failed/uncertain deployment. */
export async function admitAutomaticRelease(request, api, { allowSkip = false } = {}) {
  const trigger = request.automatic;
  check(id(trigger?.triggerRunId) && id(trigger.triggerRunAttempt) && request.mode === 'deploy',
    'release_automatic_request_invalid');
  const upstream = await api(`${prefix}/actions/runs/${trigger.triggerRunId}`);
  check(upstream.id === trigger.triggerRunId && upstream.run_attempt === trigger.triggerRunAttempt
    && upstream.repository?.id === REPOSITORY_ID && upstream.head_repository?.id === REPOSITORY_ID
    && upstream.event === 'push' && upstream.head_branch === 'main' && upstream.head_sha === request.sourceSha
    && ['.github/workflows/verify.yml', '.github/workflows/codeql.yml'].includes(upstream.path)
    && upstream.status === 'completed' && upstream.conclusion === 'success', 'release_automatic_trigger_invalid');
  const current = await api(`${prefix}/actions/runs/${request.runId}`);
  const workflow = await api(`${prefix}/actions/workflows/shared-release.yml`);
  check(id(workflow.id) && workflow.state === 'active' && workflow.path === '.github/workflows/shared-release.yml'
    && current.id === request.runId && current.run_attempt === request.runAttempt
    && current.workflow_id === workflow.id && current.path === workflow.path && current.event === 'workflow_run'
    && current.repository?.id === REPOSITORY_ID && current.head_repository?.id === REPOSITORY_ID
    && current.head_branch === 'main' && current.head_sha === request.controllerSha
    && current.status === 'in_progress' && current.conclusion === null
    && current.actor?.login === request.actor && current.actor.id === request.actorId
    && current.triggering_actor?.login === request.triggeringActor, 'release_automatic_run_invalid');
  let admission;
  try { admission = await admitRelease(request, api); }
  catch (error) {
    if (allowSkip && ['release_verification_not_successful', 'release_verification_unavailable'].includes(error.code)) {
      return { skipReason: 'waiting_for_both_main_checks' };
    }
    throw error;
  }
  check(admission.verification.some(run => run.runId === upstream.id && run.attempt === upstream.run_attempt
    && run.workflow === upstream.path), 'release_automatic_trigger_superseded');
  const disposition = await automaticDisposition(api, admission);
  if (disposition) {
    check(allowSkip, 'release_automatic_candidate_superseded');
    return { skipReason: disposition };
  }
  return admission;
}

export async function automaticDisposition(api, admission) {
  // Read both environments without success filtering. A successful older record
  // must never hide a newer failure, pending mutation, or later deployed source.
  for (const target of ['next', 'staging-next']) {
    const rows = await api(`${prefix}/deployments?environment=${target}&per_page=100`);
    check(Array.isArray(rows) && rows.every(row => id(row.id)), 'release_automatic_deployments_invalid');
    const latest = rows.filter(row => row.environment === target).sort((a, b) => b.id - a.id)[0];
    if (!latest) continue;
    check(isSha(latest.sha), 'release_automatic_deployments_invalid');
    const statuses = await api(`${prefix}/deployments/${latest.id}/statuses?per_page=1`);
    check(Array.isArray(statuses) && statuses.length === 1 && statuses[0].state === 'success',
      'release_automatic_previous_unsettled');
    if (latest.sha === admission.sourceSha) {
      if (target === 'next') return 'already_released';
      // Production may consume staging from THIS attempt. Another attempt needs
      // explicit operator reconciliation/promotion, not an automatic replay.
      check(admission.target === 'next' && latest.payload?.runId === admission.runId
        && latest.payload.runAttempt === admission.runAttempt, 'release_automatic_previous_attempt');
      continue;
    }
    const comparison = await api(`${prefix}/compare/${latest.sha}...${admission.sourceSha}`);
    if (comparison.status === 'behind' && comparison.merge_base_commit?.sha === admission.sourceSha) return 'newer_source_already_deployed';
    check(comparison.status === 'ahead' && comparison.merge_base_commit?.sha === latest.sha,
      'release_automatic_source_not_forward');
  }
}
