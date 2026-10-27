import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, requestFromEnvironment, githubClient, admitRelease, admitInstallation,
  requireStaging, requireLegacyPredecessor, requireRelease, releaseFailureCode } from './admission.mjs';
import { runOperator } from './operator.mjs';
import { requireFailedBackup } from './scheduled-admission.mjs';
import { checkEnvironment, checkFlagDecisions } from './environment-check.mjs';
import { MAX_FLAG_CHANGES, readFlagDecisions, plannedFlagChanges, publicFlagChanges } from './portable/flag-decisions.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';

export async function main(env = process.env, { api: suppliedApi, executeOperator = runOperator,
  controllerRoot = fileURLToPath(new URL('../../', import.meta.url)) } = {}) {
  const output = resolve(env.PUBLIC_RECEIPT_DIRECTORY ?? 'release-public');
  await mkdir(output, { recursive: true, mode: 0o700 });
  const receipt = { format: 'freedom.shared-release/v1', status: 'rejected', startedAt: new Date().toISOString(),
    phases: [], providerOutcome: 'not_started' };
  let api, deployment;
  try {
    requireRelease(['admit', 'execute'].includes(env.RELEASE_COMMAND), 'release_command_invalid');
    const request = requestFromEnvironment(env);
    api = suppliedApi ?? githubClient(env.GH_TOKEN);
    const admission = await admitRelease(request, api);
    Object.assign(receipt, { ...admission, format: 'freedom.shared-release/v1', status: 'admitted' });
    const flagDecisions = readFlagDecisions({ sourceRoot: resolve(request.mode === 'deploy' && env.RELEASE_COMMAND === 'execute'
      ? env.RELEASE_SOURCE_DIRECTORY ?? 'source' : controllerRoot),
    sourceSha: admission.sourceSha });
    // Only plan lacks a live comparison. Accumulated decisions that already
    // match live must not consume the change budget in check/deploy.
    receipt.flagChanges = request.mode === 'plan' ? plannedFlagChanges(flagDecisions, request.target) : [];
    receipt.flagChangesObservation = 'not_checked';
    if (env.RELEASE_COMMAND === 'admit') {
      if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT,
        `source_sha=${admission.sourceSha}\ntarget=${admission.target}\nmode=${admission.mode}\n`);
      receipt.status = admission.mode === 'plan' ? 'plan_passed' : 'awaiting_execution';
      // A plan checks GitHub admission only. It has no environment credentials and cannot attest readiness.
      receipt.environmentReadiness = 'not_checked';
      return;
    }
    if (request.mode === 'check') {
      receipt.environmentCheck = await checkEnvironment(env, request.target, { flagDecisions });
      if (receipt.environmentCheck.flagChangesObservation === 'live') {
        receipt.flagChanges = publicFlagChanges(receipt.environmentCheck.flagChanges);
        receipt.flagChangesObservation = 'live';
      }
      receipt.environmentReadiness = 'read_only_checks_only';
      receipt.providerOutcome = 'no_mutations';
      receipt.status = receipt.environmentCheck.status === 'passed' ? 'checks_passed' : 'checks_failed';
      if (receipt.status === 'checks_failed') process.exitCode = 1;
      return;
    }
    requireRelease(request.mode === 'deploy', 'release_execution_mode_invalid');
    const installation = admitInstallation(env);
    receipt.operatorImage = installation.image;
    receipt.configSha256 = installation.configSha256;
    if (Object.keys(flagDecisions.targets[request.target] ?? {}).length > MAX_FLAG_CHANGES) {
      receipt.flagChanges = await checkFlagDecisions(env, request.target, flagDecisions);
      receipt.flagChangesObservation = 'live';
    }
    const recoveryEvidence = admission.recoverRunId ? await requireFailedBackup(api, admission, installation) : undefined;
    if (recoveryEvidence) receipt.backupReconciliation = recoveryEvidence;
    receipt.stagingEvidence = await requireStaging(api, admission, installation);
    admission.legacyPredecessor = await requireLegacyPredecessor(api, admission);
    if (admission.legacyPredecessor) receipt.legacyPredecessor = admission.legacyPredecessor;
    const source = resolve(env.RELEASE_SOURCE_DIRECTORY ?? 'source');
    const git = args => execFileSync('git', ['-C', source, ...args], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 1_000_000, stdio: ['ignore', 'pipe', 'ignore'],
      env: { PATH: env.PATH, HOME: env.RUNNER_TEMP, GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' },
    }).trim();
    requireRelease(git(['rev-parse', 'HEAD']) === admission.sourceSha
      && git(['rev-parse', 'HEAD^{tree}']) === admission.sourceTree
      && git(['status', '--porcelain', '--untracked-files=all']) === '', 'release_checkout_identity_invalid');
    requireRelease(env.RUNNER_TEMP && !source.startsWith(resolve(env.RUNNER_TEMP) + '/'), 'release_runner_paths_invalid');
    const temporaryRoot = join(env.RUNNER_TEMP, `shared-release-${request.runId}-${request.runAttempt}`);
    await mkdir(temporaryRoot, { mode: 0o700 });
    const runUrl = `https://github.com/${REPOSITORY}/actions/runs/${request.runId}/attempts/${request.runAttempt}`;
    let deploymentCreation;
    // A legacy handoff must not hide its authenticated predecessor with a new
    // failed Deployment before adoption. After preflight, the journal owns the
    // adopted source and every later intent. Keep a single creation promise:
    // an uncertain GitHub POST is never repeated by progress/final callbacks.
    const createDeployment = () => deploymentCreation ??= (async () => {
      deployment = await api(`/repos/${REPOSITORY}/deployments`, { method: 'POST', body: {
        ref: admission.sourceSha, task: 'deploy', auto_merge: false, required_contexts: [],
        environment: request.target, production_environment: request.target === 'next',
        transient_environment: false, description: 'Shared release; exact-source checks recorded in Actions',
        payload: { format: 'freedom.shared-release/v1', operatorImage: installation.image,
          controllerSha: request.controllerSha, configSha256: installation.configSha256,
          runId: request.runId, runAttempt: request.runAttempt,
          actor: admission.original, triggeredBy: admission.triggeredBy },
      } });
      requireRelease(Number.isSafeInteger(deployment.id) && deployment.id > 0
        && deployment.sha === admission.sourceSha, 'release_deployment_identity_invalid');
      receipt.deploymentId = deployment.id;
      await status('in_progress', 'Schema compatibility, deployment and health checks in progress');
    })();
    const status = (state, description) => api(`/repos/${REPOSITORY}/deployments/${deployment.id}/statuses`, {
      method: 'POST', body: { state, description, log_url: runUrl, auto_inactive: false },
    });
    if (!admission.legacyPredecessor) await createDeployment();
    receipt.status = 'running';
    receipt.providerOutcome = 'unknown_until_confirmed';
    // Persist an honest in-progress record before any remote mutation. Abrupt cancellation
    // cannot turn this into a success; GitHub deployment may remain in_progress for reconciliation.
    await writeFile(join(output, 'receipt.json'), json(receipt), { mode: 0o600 });
    receipt.phases = await executeOperator({ admission, installation, recoveryEvidence, sourceRoot: source, temporaryRoot,
      registry: { username: env.GITHUB_ACTOR, token: env.GH_TOKEN },
      onProgress: async phases => {
        receipt.operatorProgress = phases;
        const flags = phases.find(phase => phase.flagChanges)?.flagChanges;
        if (flags) { receipt.flagChanges = publicFlagChanges(flags); receipt.flagChangesObservation = 'live'; }
        await writeFile(join(output, 'receipt.json'), json(receipt), { mode: 0o600 });
        if (phases[0]?.name === 'preflight' && phases[0].reportedStatus === 'passed') await createDeployment();
        const current = phases.at(-1);
        if (current) process.stdout.write(`Release phase: ${current.name} (${current.reportedStatus})\n`);
      },
      config: env.RELEASE_CONFIG_JSON, credentials: {
        cloudflareApiToken: env.CLOUDFLARE_API_TOKEN,
        migrationDatabaseUrl: env.MIGRATION_DATABASE_URL,
        runtimeDatabaseUrl: env.RUNTIME_DATABASE_URL,
        ...(request.target === 'staging-next' ? { stagingAccessClientId: env.CF_ACCESS_CLIENT_ID,
          stagingAccessClientSecret: env.CF_ACCESS_CLIENT_SECRET } : {}),
      } });
    const flags = receipt.phases.find(phase => phase.name === 'deploy')?.flagChanges;
    if (flags) { receipt.flagChanges = publicFlagChanges(flags); receipt.flagChangesObservation = 'live'; }
    // Fast runs may finish before the periodic progress reader observes preflight.
    await createDeployment();
    receipt.providerOutcome = 'release_confirmed';
    receipt.operatorEvidence = 'validated-independent-release/v1';
    await status('success', 'Release, schema verification and health confirmed');
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed'; receipt.error = releaseFailureCode(error);
    if (deployment?.id && api) {
      try {
        await api(`/repos/${REPOSITORY}/deployments/${deployment.id}/statuses`, { method: 'POST', body: {
          state: 'failure', description: 'Release stopped; inspect receipt. Do not retry an uncertain mutation.',
          auto_inactive: false,
        } });
      } catch { receipt.deploymentStatusUpdate = 'failed'; }
    }
    process.exitCode = 1;
  } finally {
    receipt.completedAt = new Date().toISOString();
    await writeFile(join(output, 'receipt.json'), json(receipt), { mode: 0o600 });
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
      `### Shared release: ${receipt.status}\n\n`
      + (receipt.sourceSha ? `- Version: \`${receipt.sourceSha}\`\n- Environment: \`${receipt.target}\`\n`
        + `- Requested by: ${receipt.original.login}; run by: ${receipt.triggeredBy.login}\n` : '')
      + `- Provider outcome: \`${receipt.providerOutcome}\`\n`
      + (receipt.operatorProgress?.at(-1)?.failureCode ? `- Failed phase: \`${receipt.operatorProgress.at(-1).failureCode}\`\n` : '')
      + (receipt.error ? `- Stopped: \`${receipt.error}\`\n` : '')
      + (receipt.flagChanges ? `- Flag comparison: ${receipt.flagChangesObservation} (plan null means unobserved)\n`
        + receipt.flagChanges.map(change => `- ${change.name}: ${change.from ?? 'null'} → ${change.to}; ${change.record}\n`).join('') : '')
      + (receipt.environmentReadiness === 'not_checked' ? '- Plan only: environment/operator readiness has not been checked.\n' : '')
      + (receipt.environmentCheck ? '\n' + receipt.environmentCheck.checks.map(item => `- ${item.name}: ${item.status}`
        + (item.error ? ` (${item.error}${item.httpStatus ? ', HTTP ' + item.httpStatus : ''})` : '')).join('\n')
        + '\n\nRead-only credential checks do not prove write permissions, database access, backup/restore or deployment readiness.\n' : '')
      + '\nThe JSON receipt records the exact source, controller, CI runs and completed phases.\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
