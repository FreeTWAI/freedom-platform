// GitHub facts are acquired using the job token, never supplied as dispatch inputs.
import { artifactReader } from './artifacts.mjs';
import { isReleaseFailureCode } from './failure-codes.mjs';
export { isReleaseFailureCode } from './failure-codes.mjs';
export const REPOSITORY = 'FreeTWAI/freedom-platform';
export const REPOSITORY_ID = 1378081342;
export const OPERATORS = Object.freeze({ teddashh: 233386770, arumwu: 75135621,
  Hao0321: 126182090, 'detna-vibe-coding': 267743027 });
export const PHASES = Object.freeze(['preflight', 'backup-before', 'migration', 'deploy',
  'health', 'backup-after', 'handoff']);
export const INDEPENDENT_PHASES = Object.freeze(['preflight', 'migration', 'deploy', 'health', 'handoff']);
export const HANDOFF_PHASES = Object.freeze(['preflight', 'handoff']);
export const releasePhases = request => {
  requireRelease(request.releaseKind === undefined || request.releaseKind === 'independent', 'release_contract_invalid');
  if (request.mode === 'handoff') {
    requireRelease(request.releaseKind === 'independent', 'release_contract_invalid');
    return HANDOFF_PHASES;
  }
  return request.releaseKind === 'independent' ? INDEPENDENT_PHASES : PHASES;
};
export const requireRelease = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};
export const releaseFailureCode = error => [error?.code, error?.message].find(isReleaseFailureCode) ?? 'release_operation_failed';
export const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const workflowPath = '.github/workflows/shared-release.yml';

export function requestFromEnvironment(env) {
  const automatic = env.GITHUB_EVENT_NAME === 'workflow_run';
  requireRelease(env.GITHUB_REPOSITORY === REPOSITORY
    && env.GITHUB_REPOSITORY_ID === String(REPOSITORY_ID)
    && (env.GITHUB_EVENT_NAME === 'workflow_dispatch' || automatic)
    && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/${workflowPath}@refs/heads/main`
    && isSha(env.CONTROLLER_SHA), 'release_workflow_identity_invalid');
  requireRelease(isSha(env.RELEASE_SHA), 'release_exact_sha_required');
  requireRelease(['staging-next', 'next'].includes(env.RELEASE_TARGET), 'release_target_invalid');
  requireRelease(['plan', 'check', 'deploy', 'handoff'].includes(env.RELEASE_MODE), 'release_mode_invalid');
  if (automatic) requireRelease(env.RELEASE_MODE === 'deploy'
    && ['RELEASE_TRIGGER_RUN_ID', 'RELEASE_TRIGGER_RUN_ATTEMPT'].every(key =>
      /^[1-9][0-9]{0,15}$/.test(env[key] ?? '') && positiveId(Number(env[key])))
    && !env.RELEASE_RECOVER_BACKUP_RUN_ID && !env.RELEASE_RECOVER_RELEASE_RUN_ID,
  'release_automatic_request_invalid');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_ACTOR_ID']) {
    requireRelease(/^[1-9][0-9]{0,15}$/.test(env[key] ?? '')
      && positiveId(Number(env[key])), 'release_run_identity_invalid');
  }
  const recovery = env.RELEASE_RECOVER_BACKUP_RUN_ID;
  requireRelease(!recovery || (env.RELEASE_MODE === 'deploy' && /^[1-9][0-9]{0,15}$/.test(recovery)
    && positiveId(Number(recovery)) && String(Number(recovery)) === recovery && recovery !== env.GITHUB_RUN_ID),
  'release_backup_recovery_request_invalid');
  const handoff = env.RELEASE_RECOVER_RELEASE_RUN_ID;
  requireRelease(env.RELEASE_MODE === 'handoff'
    ? !recovery && /^[1-9][0-9]{0,15}$/.test(handoff ?? '') && positiveId(Number(handoff))
      && String(Number(handoff)) === handoff && handoff !== env.GITHUB_RUN_ID
    : !handoff, 'release_handoff_recovery_request_invalid');
  return { ...(automatic ? { automatic: { triggerRunId: Number(env.RELEASE_TRIGGER_RUN_ID),
    triggerRunAttempt: Number(env.RELEASE_TRIGGER_RUN_ATTEMPT) } } : {}),
    ...(recovery ? { recoverRunId: Number(recovery) } : {}),
    ...(handoff ? { recoverReleaseRunId: Number(handoff) } : {}), format: 'freedom.shared-release-request/v1', repository: REPOSITORY,
    repositoryId: REPOSITORY_ID, sourceSha: env.RELEASE_SHA, target: env.RELEASE_TARGET,
    mode: env.RELEASE_MODE, releaseKind: 'independent', controllerSha: env.CONTROLLER_SHA,
    actor: env.GITHUB_ACTOR, actorId: Number(env.GITHUB_ACTOR_ID),
    triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT) };
}

export function githubClient(token, fetchImpl = fetch) {
  requireRelease(typeof token === 'string' && token.length > 0, 'release_github_token_missing');
  const api = async (path, { method = 'GET', body } = {}) => {
    requireRelease(path.startsWith(`/repos/${REPOSITORY}/`) && !/[\r\n#]/.test(path), 'release_api_path_invalid');
    const response = await fetchImpl(`https://api.github.com${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    requireRelease(response.ok, 'release_github_request_failed');
    const reader = response.body.getReader(); let size = 0; const parts = [];
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        requireRelease(size <= 4_000_000, 'release_github_response_too_large'); parts.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
    catch { throw Object.assign(new Error('release_github_response_invalid'), { code: 'release_github_response_invalid' }); }
  };
  return Object.assign(api, { readArtifact: artifactReader(REPOSITORY, token, fetchImpl) });
}

export async function admitActor(api, login, claimedId) {
  requireRelease(Object.hasOwn(OPERATORS, login ?? ''), 'release_operator_not_allowed');
  const permission = await api(`/repos/${REPOSITORY}/collaborators/${login}/permission`);
  requireRelease(permission.user?.login === login && permission.user.id === OPERATORS[login]
    && (claimedId === undefined || claimedId === permission.user.id)
    && ['admin', 'maintain', 'write'].includes(permission.permission), 'release_operator_permission_missing');
  return { login, id: permission.user.id };
}

async function verifiedRun(api, filename, sourceSha) {
  const workflow = await api(`/repos/${REPOSITORY}/actions/workflows/${filename}`);
  requireRelease(positiveId(workflow.id) && workflow.path === `.github/workflows/${filename}`
    && workflow.state === 'active', 'release_required_workflow_invalid');
  // Do not filter conclusion=success: a newer failed/pending run must defeat an older success.
  const listed = await api(`/repos/${REPOSITORY}/actions/workflows/${workflow.id}/runs?head_sha=${sourceSha}&event=push&branch=main&per_page=100`);
  requireRelease(Number.isSafeInteger(listed.total_count) && listed.total_count > 0
    && listed.total_count <= 100 && Array.isArray(listed.workflow_runs)
    && listed.workflow_runs.length === listed.total_count, 'release_verification_unavailable');
  requireRelease(listed.workflow_runs.every(run => positiveId(run.id)), 'release_verification_invalid');
  const latest = [...listed.workflow_runs].sort((a, b) => b.id - a.id)[0];
  const run = await api(`/repos/${REPOSITORY}/actions/runs/${latest.id}`);
  requireRelease(run.id === latest.id && run.workflow_id === workflow.id
    && run.path === workflow.path && run.head_sha === sourceSha && run.head_branch === 'main'
    && run.event === 'push' && run.repository?.id === REPOSITORY_ID
    && run.head_repository?.id === REPOSITORY_ID && positiveId(run.run_attempt), 'release_verification_identity_invalid');
  requireRelease(run.status === 'completed' && run.conclusion === 'success', 'release_verification_not_successful');
  return { workflow: workflow.path, runId: run.id, attempt: run.run_attempt,
    url: `https://github.com/${REPOSITORY}/actions/runs/${run.id}/attempts/${run.run_attempt}` };
}

export async function admitRelease(request, api) {
  const original = await admitActor(api, request.actor, request.actorId);
  const triggeredBy = await admitActor(api, request.triggeringActor);
  const main = await api(`/repos/${REPOSITORY}/branches/main`);
  requireRelease(isSha(main.commit?.sha), 'release_main_unavailable');
  for (const sha of new Set([request.sourceSha, request.controllerSha])) {
    const comparison = await api(`/repos/${REPOSITORY}/compare/${sha}...${main.commit.sha}`);
    requireRelease(['ahead', 'identical'].includes(comparison.status)
      && comparison.merge_base_commit?.sha === sha, 'release_source_not_merged_main');
  }
  const commit = await api(`/repos/${REPOSITORY}/commits/${request.sourceSha}`);
  requireRelease(commit.sha === request.sourceSha && isSha(commit.commit?.tree?.sha), 'release_source_identity_invalid');
  const verification = [];
  for (const file of ['verify.yml', 'codeql.yml']) verification.push(await verifiedRun(api, file, request.sourceSha));
  return { ...request, sourceTree: commit.commit.tree.sha, mainShaObserved: main.commit.sha,
    original, triggeredBy, verification, admittedAt: new Date().toISOString() };
}

export function admitInstallation(env) {
  requireRelease(env.RELEASE_ENABLED === 'true', 'release_environment_disabled');
  requireRelease(/^ghcr\.io\/freetwai\/freedom-release-operator@sha256:[a-f0-9]{64}$/.test(env.RELEASE_OPERATOR_IMAGE ?? ''), 'release_operator_digest_required');
  requireRelease(isDigest(env.RELEASE_CONFIG_SHA256), 'release_config_digest_required');
  return { image: env.RELEASE_OPERATOR_IMAGE, configSha256: env.RELEASE_CONFIG_SHA256 };
}

// The initial shared journal may predate the last release by the legacy
// operator. Authenticate that existing deployment; the image must still match
// it to the live Worker and unchanged SQL/DB authority under the release lease.
export async function requireLegacyPredecessor(api, admission) {
  const prefix = `/repos/${REPOSITORY}`;
  const latest = async () => {
    const rows = await api(`${prefix}/deployments?environment=${admission.target}&per_page=100`);
    requireRelease(Array.isArray(rows) && rows.every(row => positiveId(row.id)), 'release_legacy_deployments_invalid');
    return rows.filter(row => row.environment === admission.target).sort((a, b) => b.id - a.id)[0];
  };
  const deployment = await latest();
  if (!deployment || deployment.payload?.format === 'freedom.shared-release/v1') return undefined;
  requireRelease(deployment.task === 'deploy' && isSha(deployment.sha)
    && deployment.payload && Object.keys(deployment.payload).length === 0, 'release_legacy_deployment_invalid');
  const creator = await admitActor(api, deployment.creator?.login, deployment.creator?.id);
  const status = async () => {
    const rows = await api(`${prefix}/deployments/${deployment.id}/statuses?per_page=1`);
    requireRelease(Array.isArray(rows) && rows.length === 1 && positiveId(rows[0].id)
      && rows[0].state === 'success' && Number.isFinite(Date.parse(rows[0].created_at)), 'release_legacy_deployment_not_successful');
    await admitActor(api, rows[0].creator?.login, rows[0].creator?.id);
    return rows[0];
  };
  const successful = await status();
  const verified = await admitRelease({ ...admission, sourceSha: deployment.sha }, api);
  const ancestry = await api(`${prefix}/compare/${deployment.sha}...${admission.sourceSha}`);
  requireRelease(['ahead', 'identical'].includes(ancestry.status)
    && ancestry.merge_base_commit?.sha === deployment.sha, 'release_legacy_successor_invalid');
  requireRelease((await latest())?.id === deployment.id && (await status()).id === successful.id,
    'release_legacy_deployment_changed');
  return { format: 'freedom.verified-legacy-deployment/v1', target: admission.target,
    deploymentId: deployment.id, statusId: successful.id, creator, completedAt: successful.created_at,
    sourceSha: verified.sourceSha, sourceTree: verified.sourceTree, verification: verified.verification,
    admittedRunId: admission.runId, admittedRunAttempt: admission.runAttempt };
}

export async function requireStaging(api, admission, installation) {
  if (admission.target !== 'next') return;
  const prefix = `/repos/${REPOSITORY}`;
  const latestDeployment = async () => {
    const deployments = await api(`${prefix}/deployments?sha=${admission.sourceSha}&environment=staging-next&per_page=100`);
    requireRelease(Array.isArray(deployments) && deployments.every(item => positiveId(item?.id)), 'release_staging_evidence_missing');
    // Never filter for success: a newer failed/untrusted record blocks promotion.
    return deployments.filter(item => item.sha === admission.sourceSha && item.environment === 'staging-next')
      .sort((a, b) => b.id - a.id)[0];
  };
  const deployment = await latestDeployment(), binding = deployment?.payload;
  const automatic = binding?.automatic !== undefined;
  if (automatic) requireRelease(positiveId(binding.automatic?.triggerRunId) && positiveId(binding.automatic?.triggerRunAttempt)
    && binding.runId === admission.runId && binding.runAttempt === admission.runAttempt
    && binding.controllerSha === admission.controllerSha && admission.automatic?.triggerRunId === binding.automatic.triggerRunId
    && admission.automatic?.triggerRunAttempt === binding.automatic.triggerRunAttempt, 'release_staging_run_invalid');
  requireRelease(positiveId(deployment?.id) && binding?.format === 'freedom.shared-release/v1'
    && binding.operatorImage === installation.image && isSha(binding.controllerSha)
    && isDigest(binding.configSha256) && positiveId(binding.runId) && positiveId(binding.runAttempt), 'release_staging_evidence_missing');
  const runUrl = `https://github.com/${REPOSITORY}/actions/runs/${binding.runId}/attempts/${binding.runAttempt}`;
  const successfulStatus = async () => {
    const statuses = await api(`${prefix}/deployments/${deployment.id}/statuses?per_page=1`);
    requireRelease(Array.isArray(statuses) && statuses.length === 1 && statuses[0].state === 'success'
      && statuses[0].log_url === runUrl, 'release_staging_not_successful');
  };
  await successfulStatus();
  const workflow = await api(`${prefix}/actions/workflows/shared-release.yml`);
  requireRelease(positiveId(workflow.id) && workflow.path === workflowPath && workflow.state === 'active', 'release_staging_workflow_invalid');
  const sameActor = (actual, expected) => Object.hasOwn(OPERATORS, actual?.login ?? '')
    && actual.id === OPERATORS[actual.login] && actual.login === expected?.login && actual.id === expected.id;
  const checkRun = run => {
    requireRelease(run?.id === binding.runId && run.run_attempt === binding.runAttempt
      && run.workflow_id === workflow.id && run.path === workflowPath && run.event === (automatic ? 'workflow_run' : 'workflow_dispatch')
      && run.repository?.id === REPOSITORY_ID && run.head_repository?.id === REPOSITORY_ID
      && run.head_branch === 'main' && run.head_sha === binding.controllerSha
      && (automatic ? run.status === 'in_progress' && run.conclusion === null
        : run.status === 'completed' && run.conclusion === 'success')
      && sameActor(run.actor, binding.actor) && sameActor(run.triggering_actor, binding.triggeredBy), 'release_staging_run_invalid');
  };
  const run = await api(`${prefix}/actions/runs/${binding.runId}`); checkRun(run);
  const comparison = await api(`${prefix}/compare/${binding.controllerSha}...${admission.mainShaObserved}`);
  requireRelease(['ahead', 'identical'].includes(comparison.status)
    && comparison.merge_base_commit?.sha === binding.controllerSha, 'release_staging_controller_untrusted');
  const jobs = await api(`${prefix}/actions/runs/${binding.runId}/attempts/${binding.runAttempt}/jobs?per_page=100`);
  requireRelease(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length
    && (jobs.jobs.length === 2 && !automatic || jobs.jobs.length === 3
      && jobs.jobs.filter(job => job.name === 'production' && job.run_id === binding.runId
        && job.run_attempt === binding.runAttempt && job.head_sha === binding.controllerSha
        && (automatic ? job.status === 'in_progress' && job.conclusion === null
          : job.status === 'completed' && job.conclusion === 'skipped')).length === 1)
    && ['admission', 'deploy'].every(name => jobs.jobs.filter(job => job.name === name && job.run_id === binding.runId
      && job.run_attempt === binding.runAttempt && job.head_sha === binding.controllerSha
      && job.status === 'completed' && job.conclusion === 'success').length === 1), 'release_staging_jobs_invalid');
  const deployJob = jobs.jobs.find(job => job.name === 'deploy');
  requireRelease(Array.isArray(deployJob.steps) && ['Execute the installed environment operator', 'Save public release receipt']
    .every(name => deployJob.steps.filter(step => step.name === name && step.status === 'completed'
      && step.conclusion === 'success').length === 1), 'release_staging_jobs_invalid');
  const name = `release-result-${binding.runId}-${binding.runAttempt}${automatic ? '-staging-next' : ''}`;
  const artifacts = await api(`${prefix}/actions/runs/${binding.runId}/artifacts?name=${name}&per_page=100`);
  requireRelease(artifacts.total_count === 1 && Array.isArray(artifacts.artifacts) && artifacts.artifacts.length === 1,
    'release_staging_artifact_invalid');
  const artifact = artifacts.artifacts[0], owner = artifact.workflow_run;
  requireRelease(positiveId(artifact.id) && artifact.name === name && artifact.expired === false
    && /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '') && owner?.id === binding.runId
    && owner.repository_id === REPOSITORY_ID && owner.head_repository_id === REPOSITORY_ID
    && owner.head_sha === binding.controllerSha && owner.head_branch === 'main'
    && typeof api.readArtifact === 'function', 'release_staging_artifact_invalid');
  const receipt = await api.readArtifact(artifact);
  requireRelease(receipt?.format === 'freedom.shared-release/v1' && receipt.status === 'passed'
    && (receipt.releaseKind === undefined || receipt.releaseKind === 'independent')
    && (receipt.releaseKind === 'independent'
      ? receipt.releaseKind === 'independent' && receipt.providerOutcome === 'release_confirmed' && receipt.operatorEvidence === 'validated-independent-release/v1'
      : receipt.providerOutcome === 'release_and_recovery_confirmed' && receipt.operatorEvidence === 'validated-seven-phases/v1')
    && receipt.repository === REPOSITORY && receipt.repositoryId === REPOSITORY_ID
    && receipt.sourceSha === admission.sourceSha && receipt.sourceTree === admission.sourceTree
    && receipt.controllerSha === binding.controllerSha && receipt.target === 'staging-next' && receipt.mode === 'deploy'
    && receipt.runId === binding.runId && receipt.runAttempt === binding.runAttempt
    && receipt.deploymentId === deployment.id && receipt.operatorImage === installation.image
    && receipt.configSha256 === binding.configSha256 && sameActor(receipt.original, run.actor)
    && (!automatic || receipt.releaseKind === 'independent'
      && receipt.automatic?.triggerRunId === binding.automatic.triggerRunId
      && receipt.automatic?.triggerRunAttempt === binding.automatic.triggerRunAttempt)
    && sameActor(receipt.triggeredBy, run.triggering_actor), 'release_staging_receipt_invalid');
  // An automatic run is still in progress while production executes. Its
  // completed staging job bounds the receipt; overall run success is not forged.
  const start = Date.parse(run.run_started_at), completed = Date.parse(receipt.completedAt),
    end = Date.parse(automatic ? deployJob.completed_at : run.updated_at);
  let previous = Date.parse(receipt.admittedAt);
  requireRelease(Number.isFinite(start) && Number.isFinite(previous) && Number.isFinite(completed) && Number.isFinite(end)
    && previous >= start && completed >= previous && completed <= end && end <= Date.now() + 60_000
    && Array.isArray(receipt.phases) && receipt.phases.length === releasePhases(receipt).length, 'release_staging_receipt_invalid');
  for (const [index, phase] of receipt.phases.entries()) {
    const from = Date.parse(phase.startedAt), to = Date.parse(phase.completedAt);
    requireRelease(phase.name === releasePhases(receipt)[index] && phase.status === 'passed' && Number.isFinite(from)
      && Number.isFinite(to) && from >= previous && to >= from && to <= completed, 'release_staging_receipt_invalid');
    previous = to;
  }
  // Re-read mutable provider facts after downloading: a re-run or newer staging
  // deployment during verification must not inherit an older attempt's result.
  checkRun(await api(`${prefix}/actions/runs/${binding.runId}`));
  requireRelease((await latestDeployment())?.id === deployment.id, 'release_staging_evidence_changed');
  await successfulStatus();
  return Object.freeze({ deploymentId: deployment.id, runId: binding.runId, runAttempt: binding.runAttempt,
    controllerSha: binding.controllerSha, artifactId: artifact.id, artifactDigest: artifact.digest });
}
