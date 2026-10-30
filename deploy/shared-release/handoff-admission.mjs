import { createHash } from 'node:crypto';
import { REPOSITORY, REPOSITORY_ID, OPERATORS, requireRelease as check, isSha, isDigest, isReleaseFailureCode } from './admission.mjs';

const prefix = `/repos/${REPOSITORY}`, path = '.github/workflows/shared-release.yml';
const positive = value => Number.isSafeInteger(value) && value > 0;
const actor = value => Object.hasOwn(OPERATORS, value?.login ?? '') && value.id === OPERATORS[value.login];
const sameActor = (a, b) => actor(a) && a.login === b?.login && a.id === b.id;

// Terminal hosted evidence only authorizes readback. The image must independently
// verify the exact journal, DB and Worker before appending a missing handoff.
export async function requireFailedReleaseHandoff(api, admission, installation) {
  const id = admission.recoverReleaseRunId;
  check(admission.mode === 'handoff' && admission.releaseKind === 'independent'
    && positive(id) && id !== admission.runId, 'release_handoff_recovery_request_invalid');
  const workflow = await api(`${prefix}/actions/workflows/shared-release.yml`);
  check(positive(workflow.id) && workflow.path === path && workflow.state === 'active', 'release_handoff_recovery_evidence_invalid');
  const run = await api(`${prefix}/actions/runs/${id}`);
  const checkRun = value => check(value.id === id && positive(value.run_attempt) && value.run_attempt === run.run_attempt
    && value.workflow_id === workflow.id && value.path === path && value.event === 'workflow_dispatch'
    && value.repository?.id === REPOSITORY_ID && value.head_repository?.id === REPOSITORY_ID
    && value.head_branch === 'main' && isSha(value.head_sha) && value.head_sha === run.head_sha
    && value.status === 'completed' && value.conclusion === 'failure' && actor(value.actor) && actor(value.triggering_actor),
  'release_handoff_recovery_evidence_invalid');
  checkRun(run);
  const compare = await api(`${prefix}/compare/${run.head_sha}...${admission.mainShaObserved}`);
  check(['ahead', 'identical'].includes(compare.status) && compare.merge_base_commit?.sha === run.head_sha,
    'release_handoff_recovery_evidence_invalid');
  const jobs = await api(`${prefix}/actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  check(jobs.total_count === 2 && jobs.jobs?.length === 2, 'release_handoff_recovery_evidence_invalid');
  for (const [name, conclusion] of [['admission', 'success'], ['deploy', 'failure']]) {
    const matching = jobs.jobs.filter(job => job.name === name && job.run_id === id && job.run_attempt === run.run_attempt
      && job.head_sha === run.head_sha && job.status === 'completed' && job.conclusion === conclusion);
    check(matching.length === 1, 'release_handoff_recovery_evidence_invalid');
    if (name === 'deploy') check(['Execute the installed environment operator', 'Save public release receipt'].every((stepName, i) =>
      matching[0].steps?.filter(step => step.name === stepName && step.status === 'completed'
        && step.conclusion === (i ? 'success' : 'failure')).length === 1), 'release_handoff_recovery_evidence_invalid');
  }
  const name = `release-result-${id}-${run.run_attempt}`;
  const artifacts = await api(`${prefix}/actions/runs/${id}/artifacts?name=${name}&per_page=100`);
  check(artifacts.total_count === 1 && artifacts.artifacts?.length === 1, 'release_handoff_recovery_evidence_invalid');
  const artifact = artifacts.artifacts[0], owner = artifact.workflow_run;
  check(positive(artifact.id) && artifact.name === name && artifact.expired === false && /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')
    && owner?.id === id && owner.repository_id === REPOSITORY_ID && owner.head_repository_id === REPOSITORY_ID
    && owner.head_branch === 'main' && owner.head_sha === run.head_sha, 'release_handoff_recovery_evidence_invalid');
  const receipt = await api.readArtifact(artifact);
  check(receipt?.format === 'freedom.shared-release/v1' && receipt.status === 'failed' && receipt.mode === 'deploy'
    && receipt.releaseKind === 'independent' && receipt.providerOutcome === 'unknown_until_confirmed'
    && receipt.repository === REPOSITORY && receipt.repositoryId === REPOSITORY_ID && receipt.controllerSha === run.head_sha
    && receipt.target === admission.target && receipt.runId === id && receipt.runAttempt === run.run_attempt
    && receipt.sourceSha === admission.sourceSha && receipt.sourceTree === admission.sourceTree
    && /^ghcr\.io\/freetwai\/freedom-release-operator@sha256:[a-f0-9]{64}$/.test(receipt.operatorImage ?? '')
    && receipt.configSha256 === installation.configSha256 && isDigest(receipt.configSha256)
    && sameActor(run.actor, receipt.original) && sameActor(run.triggering_actor, receipt.triggeredBy),
  'release_handoff_recovery_evidence_invalid');
  const start = Date.parse(run.run_started_at), end = Date.parse(run.updated_at), finish = Date.parse(receipt.completedAt);
  check([start, end, finish].every(Number.isFinite) && finish >= start && finish <= end && end <= Date.now() + 60000,
    'release_handoff_recovery_evidence_invalid');
  const progress = receipt.operatorProgress;
  check(Array.isArray(progress) && progress.length === 5
    && ['preflight', 'migration', 'deploy', 'health', 'handoff'].every((phase, i) =>
      progress[i]?.name === phase && progress[i].reportedStatus === (i === 4 ? 'failed' : 'passed'))
    && isReleaseFailureCode(progress[4].failureCode), 'release_handoff_recovery_boundary_invalid');
  checkRun(await api(`${prefix}/actions/runs/${id}`));
  return Object.freeze({ format: 'freedom.verified-failed-release-handoff/v1', runId: id, runAttempt: run.run_attempt,
    sourceSha: receipt.sourceSha, sourceTree: receipt.sourceTree, target: receipt.target, controllerSha: run.head_sha,
    operatorImage: receipt.operatorImage, configSha256: receipt.configSha256, artifactId: artifact.id, artifactDigest: artifact.digest,
    receiptSha256: createHash('sha256').update(JSON.stringify(receipt)).digest('hex'), completedAt: receipt.completedAt });
}
