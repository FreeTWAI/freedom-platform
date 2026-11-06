import { createHash } from 'node:crypto';
import { REPOSITORY, REPOSITORY_ID, OPERATORS, requireRelease as check, isSha, isDigest, isReleaseFailureCode, sameActor, readReleaseArtifact, automaticReleaseEvent } from './admission.mjs';
import { publicLeaseLoss } from './operator.mjs';

const prefix = `/repos/${REPOSITORY}`, path = '.github/workflows/shared-release.yml';
const positive = value => Number.isSafeInteger(value) && value > 0;
const actor = value => Object.hasOwn(OPERATORS, value?.login ?? '') && value.id === OPERATORS[value.login];

// Terminal hosted evidence only authorizes readback. The image must independently
// verify the exact journal, DB and Worker before appending a missing handoff.
export async function requireFailedReleaseHandoff(api, admission, installation) {
  const id = admission.recoverReleaseRunId;
  check(admission.mode === 'handoff' && admission.releaseKind === 'independent'
    && positive(id) && id !== admission.runId, 'release_handoff_recovery_request_invalid');
  return requireFailedRelease(api, admission, installation, { id, format: 'freedom.verified-failed-release-handoff/v1',
    code: 'release_handoff_recovery_evidence_invalid', boundary: progress => check(Array.isArray(progress) && progress.length === 5
      && ['preflight', 'migration', 'deploy', 'health', 'handoff'].every((phase, i) =>
        progress[i]?.name === phase && progress[i].reportedStatus === (i === 4 ? 'failed' : 'passed'))
      && isReleaseFailureCode(progress[4].failureCode), 'release_handoff_recovery_boundary_invalid') });
}

// Same terminal evidence for a run that lost its lease during migration. Only the
// image can tell from the journal and DB whether COMMIT was confirmed.
export async function requireFailedReleaseMigration(api, admission, installation) {
  const id = admission.recoverMigrationRunId;
  check(admission.mode === 'deploy' && admission.releaseKind === 'independent' && !admission.recoverRunId
    && positive(id) && id !== admission.runId, 'release_migration_recovery_request_invalid');
  return requireFailedRelease(api, admission, installation, { id, format: 'freedom.verified-failed-release-migration/v1',
    code: 'release_migration_recovery_evidence_invalid', boundary: progress => check(Array.isArray(progress) && progress.length === 2
      && progress[0]?.name === 'preflight' && progress[0].reportedStatus === 'passed'
      && progress[1]?.name === 'migration' && progress[1].reportedStatus === 'failed'
      && progress[1].failureCode === 'release_lease_lost' && publicLeaseLoss(progress[1].leaseLoss) !== undefined,
    'release_migration_recovery_boundary_invalid') });
}

async function requireFailedRelease(api, admission, installation, { id, format, code, boundary }) {
  const workflow = await api(`${prefix}/actions/workflows/shared-release.yml`);
  check(positive(workflow.id) && workflow.path === path && workflow.state === 'active', code);
  const run = await api(`${prefix}/actions/runs/${id}`);
  const automatic = ['workflow_run', 'schedule'].includes(run.event);
  const checkRun = value => check(value.id === id && positive(value.run_attempt) && value.run_attempt === run.run_attempt
    && value.workflow_id === workflow.id && value.path === path && value.event === (automatic ? run.event : 'workflow_dispatch')
    && value.repository?.id === REPOSITORY_ID && value.head_repository?.id === REPOSITORY_ID
    && value.head_branch === 'main' && isSha(value.head_sha) && value.head_sha === run.head_sha
    && value.status === 'completed' && value.conclusion === 'failure' && actor(value.actor) && actor(value.triggering_actor),
  code);
  checkRun(run);
  const compare = await api(`${prefix}/compare/${run.head_sha}...${admission.mainShaObserved}`);
  check(['ahead', 'identical'].includes(compare.status) && compare.merge_base_commit?.sha === run.head_sha, code);
  const jobs = await api(`${prefix}/actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  check(jobs.total_count === jobs.jobs?.length && (automatic ? jobs.total_count === 3
    : [2, 3].includes(jobs.total_count)), code);
  const failedJob = automatic && admission.target === 'next' ? 'production' : 'deploy';
  const expectedJobs = [['admission', 'success'], ['deploy', failedJob === 'deploy' ? 'failure' : 'success'],
    ...(jobs.total_count === 3 ? [['production', failedJob === 'production' ? 'failure' : 'skipped']] : [])];
  for (const [name, conclusion] of expectedJobs) {
    const matching = jobs.jobs.filter(job => job.name === name && job.run_id === id && job.run_attempt === run.run_attempt
      && job.head_sha === run.head_sha && job.status === 'completed' && job.conclusion === conclusion);
    check(matching.length === 1, code);
    if (name === failedJob) check(['Execute the installed environment operator', 'Save public release receipt'].every((stepName, i) =>
      matching[0].steps?.filter(step => step.name === stepName && step.status === 'completed'
        && step.conclusion === (i ? 'success' : 'failure')).length === 1), code);
  }
  const name = `release-result-${id}-${run.run_attempt}${automatic ? '-' + admission.target : ''}`;
  const { artifact, receipt } = await readReleaseArtifact(api, run, name, code);
  check(receipt?.format === 'freedom.shared-release/v1' && receipt.status === 'failed' && receipt.mode === 'deploy'
    && receipt.releaseKind === 'independent' && receipt.providerOutcome === 'unknown_until_confirmed'
    && receipt.repository === REPOSITORY && receipt.repositoryId === REPOSITORY_ID && receipt.controllerSha === run.head_sha
    && receipt.target === admission.target && receipt.runId === id && receipt.runAttempt === run.run_attempt
    && (!automatic || automaticReleaseEvent(receipt.automatic) === run.event)
    && receipt.sourceSha === admission.sourceSha && receipt.sourceTree === admission.sourceTree
    && /^ghcr\.io\/freetwai\/freedom-release-operator@sha256:[a-f0-9]{64}$/.test(receipt.operatorImage ?? '')
    && receipt.configSha256 === installation.configSha256 && isDigest(receipt.configSha256)
    && sameActor(run.actor, receipt.original) && sameActor(run.triggering_actor, receipt.triggeredBy), code);
  const start = Date.parse(run.run_started_at), end = Date.parse(run.updated_at), finish = Date.parse(receipt.completedAt);
  check([start, end, finish].every(Number.isFinite) && finish >= start && finish <= end && end <= Date.now() + 60000, code);
  boundary(receipt.operatorProgress);
  checkRun(await api(`${prefix}/actions/runs/${id}`));
  return Object.freeze({ format, runId: id, runAttempt: run.run_attempt,
    sourceSha: receipt.sourceSha, sourceTree: receipt.sourceTree, target: receipt.target, controllerSha: run.head_sha,
    operatorImage: receipt.operatorImage, configSha256: receipt.configSha256, artifactId: artifact.id, artifactDigest: artifact.digest,
    receiptSha256: createHash('sha256').update(JSON.stringify(receipt)).digest('hex'), completedAt: receipt.completedAt });
}
