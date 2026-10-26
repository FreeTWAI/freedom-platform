import { createHash } from 'node:crypto';
import { REPOSITORY, REPOSITORY_ID, OPERATORS, requireRelease as check, isSha, isDigest } from './admission.mjs';

export const BACKUP_PHASES = Object.freeze(['preflight', 'backup', 'handoff']);
export const BACKUP_CRON = '43 5 * * *';
const path = '.github/workflows/shared-backup.yml', prefix = `/repos/${REPOSITORY}`;
const positive = value => Number.isSafeInteger(value) && value > 0;
const actor = value => Object.hasOwn(OPERATORS, value?.login ?? '') && value.id === OPERATORS[value.login];
const sameActor = (a, b) => actor(a) && a.login === b?.login && a.id === b.id;

export function backupRequestFromEnvironment(env, sourceSha) {
  check(env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REPOSITORY_ID === String(REPOSITORY_ID)
    && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/${path}@refs/heads/main`
    && isSha(env.CONTROLLER_SHA) && isSha(sourceSha) && ['schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)
    && (env.GITHUB_EVENT_NAME !== 'schedule' || env.BACKUP_CRON === BACKUP_CRON), 'release_backup_workflow_invalid');
  check(['staging-next', 'next'].includes(env.RELEASE_TARGET), 'release_target_invalid');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_ACTOR_ID']) {
    check(/^[1-9][0-9]{0,15}$/.test(env[key] ?? '') && positive(Number(env[key])), 'release_run_identity_invalid');
  }
  const recovery = env.BACKUP_RECOVER_RUN_ID;
  check(!recovery || (env.GITHUB_EVENT_NAME === 'workflow_dispatch' && /^[1-9][0-9]{0,15}$/.test(recovery)
    && positive(Number(recovery)) && String(Number(recovery)) === recovery && recovery !== env.GITHUB_RUN_ID), 'release_backup_recovery_request_invalid');
  return { format: 'freedom.shared-backup-request/v1', repository: REPOSITORY, repositoryId: REPOSITORY_ID,
    mode: 'backup', event: env.GITHUB_EVENT_NAME, sourceSha, target: env.RELEASE_TARGET, controllerSha: env.CONTROLLER_SHA,
    actor: env.GITHUB_ACTOR, actorId: Number(env.GITHUB_ACTOR_ID), triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    ...(recovery ? { recoverRunId: Number(recovery) } : {}) };
}

/** Explicit manual recovery authenticates an already failed, completed backup.
 * This is permission to inspect its pending intent, never proof of DB cleanup. */
export async function requireFailedBackup(api, admission, installation) {
  const id = admission.recoverRunId;
  const independentRelease = admission.mode === 'deploy' && admission.releaseKind === 'independent';
  check((independentRelease || (admission.mode === 'backup' && admission.event === 'workflow_dispatch')) && positive(id) && id !== admission.runId,
    'release_backup_recovery_request_invalid');
  const workflow = await api(`${prefix}/actions/workflows/shared-backup.yml`);
  check(positive(workflow.id) && workflow.path === path && workflow.state === 'active', 'release_backup_recovery_workflow_invalid');
  const run = await api(`${prefix}/actions/runs/${id}`);
  const checkRun = value => check(value.id === id && positive(value.run_attempt) && value.run_attempt === run.run_attempt
    && value.workflow_id === workflow.id && value.path === path && ['schedule', 'workflow_dispatch'].includes(value.event)
    && value.repository?.id === REPOSITORY_ID && value.head_repository?.id === REPOSITORY_ID
    && value.head_branch === 'main' && isSha(value.head_sha) && value.head_sha === run.head_sha
    && value.status === 'completed' && value.conclusion === 'failure' && actor(value.actor) && actor(value.triggering_actor),
  'release_backup_recovery_run_invalid');
  checkRun(run);
  const compare = await api(`${prefix}/compare/${run.head_sha}...${admission.mainShaObserved}`);
  check(['ahead', 'identical'].includes(compare.status) && compare.merge_base_commit?.sha === run.head_sha,
    'release_backup_recovery_controller_untrusted');
  const jobs = await api(`${prefix}/actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  check(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length && jobs.jobs.length <= 2,
    'release_backup_recovery_jobs_invalid');
  const matching = jobs.jobs.filter(job => job.name === `backup (${admission.target})` && job.run_id === id
    && job.run_attempt === run.run_attempt && job.head_sha === run.head_sha && job.status === 'completed' && job.conclusion === 'failure');
  check(matching.length === 1 && ['Execute scheduled backup', 'Save public backup receipt'].every((name, i) =>
    matching[0].steps?.filter(step => step.name === name && step.status === 'completed'
      && step.conclusion === (i ? 'success' : 'failure')).length === 1), 'release_backup_recovery_jobs_invalid');
  const name = `backup-result-${admission.target}-${id}-${run.run_attempt}`;
  const artifacts = await api(`${prefix}/actions/runs/${id}/artifacts?name=${name}&per_page=100`);
  check(artifacts.total_count === 1 && artifacts.artifacts?.length === 1, 'release_backup_recovery_artifact_invalid');
  const artifact = artifacts.artifacts[0], owner = artifact.workflow_run;
  check(positive(artifact.id) && artifact.name === name && artifact.expired === false && /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')
    && owner?.id === id && owner.repository_id === REPOSITORY_ID && owner.head_repository_id === REPOSITORY_ID
    && owner.head_branch === 'main' && owner.head_sha === run.head_sha, 'release_backup_recovery_artifact_invalid');
  const receipt = await api.readArtifact(artifact);
  check(receipt?.format === 'freedom.shared-backup/v1' && receipt.status === 'failed' && receipt.mode === 'backup'
    && receipt.event === run.event && receipt.providerOutcome === 'unknown_until_confirmed'
    && receipt.repository === REPOSITORY && receipt.repositoryId === REPOSITORY_ID && receipt.controllerSha === run.head_sha
    && receipt.target === admission.target && receipt.runId === id && receipt.runAttempt === run.run_attempt
    && (independentRelease ? isSha(receipt.sourceSha) && isSha(receipt.sourceTree)
      : receipt.sourceSha === admission.sourceSha && receipt.sourceTree === admission.sourceTree)
    && /^ghcr\.io\/freetwai\/freedom-release-operator@sha256:[a-f0-9]{64}$/.test(receipt.operatorImage ?? '')
    && receipt.configSha256 === installation.configSha256 && isDigest(receipt.configSha256)
    && sameActor(run.actor, receipt.original) && sameActor(run.triggering_actor, receipt.triggeredBy),
  'release_backup_recovery_receipt_invalid');
  const start = Date.parse(run.run_started_at), end = Date.parse(run.updated_at), finish = Date.parse(receipt.completedAt);
  check([start, end, finish].every(Number.isFinite) && finish >= start && finish <= end && end <= Date.now() + 60000,
    'release_backup_recovery_receipt_invalid');
  const progress = receipt.operatorProgress;
  const preCapture = Array.isArray(progress) && progress.length === 2
    && progress[0].name === 'preflight' && progress[0].reportedStatus === 'passed'
    && progress[1].name === 'backup' && progress[1].reportedStatus === 'failed'
    && progress[1].backupFailure?.stage === 'preflight' && progress[1].backupFailure?.snapshotDump === 'not_started';
  check(!independentRelease || preCapture, 'release_backup_recovery_boundary_invalid');
  checkRun(await api(`${prefix}/actions/runs/${id}`));
  return Object.freeze({ format: 'freedom.verified-failed-backup/v1',
    ...(preCapture ? { failureBoundary: 'before_capture' } : {}), runId: id, runAttempt: run.run_attempt,
    sourceSha: receipt.sourceSha, sourceTree: receipt.sourceTree, target: receipt.target, controllerSha: run.head_sha,
    operatorImage: receipt.operatorImage, configSha256: receipt.configSha256, artifactId: artifact.id, artifactDigest: artifact.digest,
    receiptSha256: createHash('sha256').update(JSON.stringify(receipt)).digest('hex'), completedAt: receipt.completedAt });
}

/** Only a natural scheduled main run can prove scheduler handoff. Neither a
 * manual backup, arbitrary R2 marker nor caller-written Deployment is authority. */
export async function requireScheduledBackup(api, admission, installation) {
  const workflow = await api(`${prefix}/actions/workflows/shared-backup.yml`);
  check(positive(workflow.id) && workflow.path === path && workflow.state === 'active', 'release_schedule_workflow_invalid');
  const latest = async () => {
    const page = await api(`${prefix}/actions/workflows/${workflow.id}/runs?event=schedule&branch=main&per_page=1`);
    check(Number.isSafeInteger(page.total_count) && page.total_count > 0 && Array.isArray(page.workflow_runs)
      && page.workflow_runs.length === 1 && positive(page.workflow_runs[0].id), 'release_schedule_run_missing');
    return page.workflow_runs[0].id;
  };
  const id = await latest(), run = await api(`${prefix}/actions/runs/${id}`);
  const checkRun = value => check(value.id === id && value.run_attempt === run.run_attempt && value.run_attempt === 1
    && value.workflow_id === workflow.id && value.path === path && value.event === 'schedule'
    && value.repository?.id === REPOSITORY_ID && value.head_repository?.id === REPOSITORY_ID
    && value.head_branch === 'main' && isSha(value.head_sha) && value.head_sha === run.head_sha
    && value.status === 'completed' && value.conclusion === 'success' && actor(value.actor) && actor(value.triggering_actor),
  'release_schedule_run_invalid');
  checkRun(run);
  const compare = await api(`${prefix}/compare/${run.head_sha}...${admission.mainShaObserved}`);
  check(['ahead', 'identical'].includes(compare.status) && compare.merge_base_commit?.sha === run.head_sha,
    'release_schedule_controller_untrusted');
  const jobs = await api(`${prefix}/actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  check(jobs.total_count === 2 && Array.isArray(jobs.jobs) && jobs.jobs.length === 2, 'release_schedule_jobs_invalid');
  for (const target of ['staging-next', 'next']) {
    const matching = jobs.jobs.filter(job => job.name === `backup (${target})` && job.run_id === id && job.run_attempt === run.run_attempt
      && job.head_sha === run.head_sha && job.status === 'completed' && job.conclusion === 'success');
    check(matching.length === 1 && Array.isArray(matching[0].steps) && ['Execute scheduled backup', 'Save public backup receipt'].every(name =>
      matching[0].steps.filter(step => step.name === name && step.status === 'completed' && step.conclusion === 'success').length === 1),
    'release_schedule_jobs_invalid');
  }
  const name = `backup-result-${admission.target}-${id}-${run.run_attempt}`;
  const artifacts = await api(`${prefix}/actions/runs/${id}/artifacts?name=${name}&per_page=100`);
  check(artifacts.total_count === 1 && artifacts.artifacts?.length === 1, 'release_schedule_artifact_invalid');
  const artifact = artifacts.artifacts[0], owner = artifact.workflow_run;
  check(positive(artifact.id) && artifact.name === name && artifact.expired === false && /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')
    && owner?.id === id && owner.repository_id === REPOSITORY_ID && owner.head_repository_id === REPOSITORY_ID
    && owner.head_branch === 'main' && owner.head_sha === run.head_sha, 'release_schedule_artifact_invalid');
  const receipt = await api.readArtifact(artifact);
  check(receipt?.format === 'freedom.shared-backup/v1' && receipt.status === 'passed' && receipt.event === 'schedule'
    && receipt.mode === 'backup' && receipt.providerOutcome === 'backup_and_restore_confirmed'
    && receipt.operatorEvidence === 'validated-backup-phases/v1' && receipt.repository === REPOSITORY && receipt.repositoryId === REPOSITORY_ID
    && receipt.controllerSha === run.head_sha && receipt.target === admission.target && receipt.runId === id && receipt.runAttempt === run.run_attempt
    && isSha(receipt.sourceSha) && isSha(receipt.sourceTree) && receipt.operatorImage === installation.image
    && receipt.configSha256 === installation.configSha256 && sameActor(run.actor, receipt.original)
    && sameActor(run.triggering_actor, receipt.triggeredBy), 'release_schedule_receipt_invalid');
  const start = Date.parse(run.run_started_at), finish = Date.parse(receipt.completedAt), end = Date.parse(run.updated_at);
  let previous = Date.parse(receipt.admittedAt);
  check([start, finish, end, previous].every(Number.isFinite) && previous >= start && finish >= previous && finish <= end
    && end <= Date.now() + 60000 && Date.now() - finish <= 36 * 3600000 && receipt.phases?.length === BACKUP_PHASES.length,
  'release_schedule_receipt_invalid');
  for (const [i, phase] of receipt.phases.entries()) {
    const from = Date.parse(phase.startedAt), to = Date.parse(phase.completedAt);
    check(phase.name === BACKUP_PHASES[i] && phase.status === 'passed' && Number.isFinite(from) && Number.isFinite(to)
      && from >= previous && to >= from && to <= finish, 'release_schedule_receipt_invalid'); previous = to;
  }
  checkRun(await api(`${prefix}/actions/runs/${id}`)); check(await latest() === id, 'release_schedule_evidence_changed');
  return Object.freeze({ format: 'freedom.verified-scheduled-backup/v1', runId: id, runAttempt: run.run_attempt,
    controllerSha: run.head_sha, operatorImage: installation.image, configSha256: installation.configSha256,
    artifactId: artifact.id, artifactDigest: artifact.digest,
    receiptSha256: createHash('sha256').update(JSON.stringify(receipt)).digest('hex'), completedAt: receipt.completedAt });
}
