// GitHub facts are acquired using the job token, never supplied as dispatch inputs.
export const REPOSITORY = 'FreeTWAI/freedom-platform';
export const REPOSITORY_ID = 1378081342;
export const OPERATORS = Object.freeze({ teddashh: 233386770, arumwu: 75135621,
  Hao0321: 126182090, 'detna-vibe-coding': 267743027 });
export const PHASES = Object.freeze(['preflight', 'backup-before', 'migration', 'deploy',
  'health', 'backup-after', 'handoff']);
export const requireRelease = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};
export const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const workflowPath = '.github/workflows/shared-release.yml';

export function requestFromEnvironment(env) {
  requireRelease(env.GITHUB_REPOSITORY === REPOSITORY
    && env.GITHUB_REPOSITORY_ID === String(REPOSITORY_ID)
    && env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/${workflowPath}@refs/heads/main`
    && isSha(env.CONTROLLER_SHA), 'release_workflow_identity_invalid');
  requireRelease(isSha(env.RELEASE_SHA), 'release_exact_sha_required');
  requireRelease(['staging-next', 'next'].includes(env.RELEASE_TARGET), 'release_target_invalid');
  requireRelease(['plan', 'deploy'].includes(env.RELEASE_MODE), 'release_mode_invalid');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_ACTOR_ID']) {
    requireRelease(/^[1-9][0-9]{0,15}$/.test(env[key] ?? '')
      && positiveId(Number(env[key])), 'release_run_identity_invalid');
  }
  return { format: 'freedom.shared-release-request/v1', repository: REPOSITORY,
    repositoryId: REPOSITORY_ID, sourceSha: env.RELEASE_SHA, target: env.RELEASE_TARGET,
    mode: env.RELEASE_MODE, controllerSha: env.CONTROLLER_SHA,
    actor: env.GITHUB_ACTOR, actorId: Number(env.GITHUB_ACTOR_ID),
    triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT) };
}

export function githubClient(token, fetchImpl = fetch) {
  requireRelease(typeof token === 'string' && token.length > 0, 'release_github_token_missing');
  return async (path, { method = 'GET', body } = {}) => {
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
}

async function admitActor(api, login, claimedId) {
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

export async function requireStaging(api, admission, installation) {
  if (admission.target !== 'next') return;
  const deployments = await api(`/repos/${REPOSITORY}/deployments?sha=${admission.sourceSha}&environment=staging-next&per_page=100`);
  requireRelease(Array.isArray(deployments), 'release_staging_evidence_missing');
  // A later failed staging attempt cannot be hidden by selecting an older success.
  const deployment = deployments.filter(item => item.sha === admission.sourceSha && item.environment === 'staging-next')
    .sort((a, b) => b.id - a.id)[0];
  requireRelease(positiveId(deployment?.id) && deployment.payload?.format === 'freedom.shared-release/v1'
    && deployment.payload.operatorImage === installation.image, 'release_staging_evidence_missing');
  const statuses = await api(`/repos/${REPOSITORY}/deployments/${deployment.id}/statuses?per_page=1`);
  requireRelease(statuses[0]?.state === 'success', 'release_staging_not_successful');
}
