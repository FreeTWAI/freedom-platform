import { REPOSITORY, REPOSITORY_ID, requireRelease as check, isSha, admitRelease,
  sameActor, validPairAuthorization } from './admission.mjs';

const prefix = `/repos/${REPOSITORY}`;
const id = value => Number.isSafeInteger(value) && value > 0;

// Inputs select intent and source; only GitHub's active run and current operator
// permissions authenticate the dispatcher/rerunner. No event-shaped input is proof.
export async function admitPairedRelease(request, api) {
  check(request.repository === REPOSITORY && request.repositoryId === REPOSITORY_ID
    && request.event === 'workflow_dispatch' && request.mode === 'deploy'
    && request.releaseKind === 'independent' && request.automatic === undefined
    && request.recoverRunId === undefined && request.recoverReleaseRunId === undefined && request.recoverMigrationRunId === undefined
    && ['staging-next', 'next'].includes(request.target) && isSha(request.controllerSha)
    && validPairAuthorization(request.authorization, request), 'release_pair_request_invalid');
  const workflow = await api(`${prefix}/actions/workflows/shared-release.yml`);
  const checkRun = current => check(id(workflow.id) && workflow.state === 'active'
    && workflow.path === '.github/workflows/shared-release.yml'
    && current.id === request.runId && current.run_attempt === request.runAttempt
    && current.workflow_id === workflow.id && current.path === workflow.path && current.event === 'workflow_dispatch'
    && current.repository?.id === REPOSITORY_ID && current.head_repository?.id === REPOSITORY_ID
    && current.head_branch === 'main' && current.head_sha === request.controllerSha
    && current.status === 'in_progress' && current.conclusion === null
    && sameActor(current.actor, { login: request.actor, id: request.actorId })
    && sameActor(current.triggering_actor, { login: request.triggeringActor, id: current.triggering_actor?.id }),
  'release_pair_run_invalid');
  checkRun(await api(`${prefix}/actions/runs/${request.runId}`));
  const admission = await admitRelease(request, api);
  await pairedDisposition(api, admission);
  checkRun(await api(`${prefix}/actions/runs/${request.runId}`));
  return admission;
}

export async function pairedDisposition(api, admission) {
  for (const target of ['next', 'staging-next']) {
    const rows = await api(`${prefix}/deployments?environment=${target}&per_page=100`);
    check(Array.isArray(rows) && rows.every(row => id(row.id)), 'release_pair_deployments_invalid');
    const latest = rows.filter(row => row.environment === target).sort((a, b) => b.id - a.id)[0];
    check(latest && isSha(latest.sha), 'release_pair_previous_unsettled');
    const statuses = await api(`${prefix}/deployments/${latest.id}/statuses?per_page=1`);
    check(Array.isArray(statuses) && statuses.length === 1 && statuses[0].state === 'success',
      'release_pair_previous_unsettled');
    if (target === 'staging-next' && admission.target === 'next') {
      // This exception is solely the staging job we just completed. The caller
      // must also authenticate its job, artifact digest and full receipt.
      check(latest.sha === admission.sourceSha && latest.payload?.runId === admission.runId
        && latest.payload.runAttempt === admission.runAttempt
        && latest.payload.controllerSha === admission.controllerSha
        && validPairAuthorization(latest.payload.authorization, admission), 'release_pair_staging_attempt_invalid');
    } else {
      check(latest.sha !== admission.sourceSha, 'release_pair_source_not_forward');
      const comparison = await api(`${prefix}/compare/${latest.sha}...${admission.sourceSha}`);
      check(comparison.status === 'ahead' && comparison.merge_base_commit?.sha === latest.sha,
        'release_pair_source_not_forward');
    }
  }
}
