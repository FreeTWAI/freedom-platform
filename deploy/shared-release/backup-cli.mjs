import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { githubClient, admitActor, admitRelease, admitInstallation, requireRelease as check } from './admission.mjs';
import { backupRequestFromEnvironment } from './scheduled-admission.mjs';
import { validatePortableConfig } from './portable/config.mjs';
import { createCloudflareRecoveryTransport } from './portable/cloudflare.mjs';
import { verifyApplicationSource } from './portable/build.mjs';
import { runOperator } from './operator.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
export async function main(env = process.env) {
  const output = resolve(env.PUBLIC_RECEIPT_DIRECTORY ?? 'backup-public'); await mkdir(output, { recursive: true, mode: 0o700 });
  const receipt = { format: 'freedom.shared-backup/v1', status: 'rejected', phases: [], startedAt: new Date().toISOString(), providerOutcome: 'not_started' };
  try {
    check(['admit', 'execute'].includes(env.BACKUP_COMMAND), 'release_backup_command_invalid');
    // Validate main workflow and actors before reading any provider state.
    const context = backupRequestFromEnvironment(env, env.CONTROLLER_SHA), api = githubClient(env.GH_TOKEN);
    await admitActor(api, context.actor, context.actorId); await admitActor(api, context.triggeringActor);
    const installation = admitInstallation({ ...env, RELEASE_ENABLED: env.BACKUP_ENABLED });
    check(typeof env.RELEASE_CONFIG_JSON === 'string' && Buffer.byteLength(env.RELEASE_CONFIG_JSON) <= 262144
      && createHash('sha256').update(env.RELEASE_CONFIG_JSON).digest('hex') === installation.configSha256, 'release_config_pin_mismatch');
    const config = validatePortableConfig(JSON.parse(env.RELEASE_CONFIG_JSON), context.target);
    const transport = createCloudflareRecoveryTransport({ accountId: config.accountId, target: config.target,
      mediaBucket: config.mediaBucket, backupBucket: config.backupBucket, token: env.CLOUDFLARE_API_TOKEN, signal: new AbortController().signal });
    const live = await transport.readWorkerState();
    if (env.BACKUP_COMMAND === 'execute') check(live.sourceSha === env.RELEASE_SHA, 'release_backup_source_changed');
    const admission = await admitRelease(backupRequestFromEnvironment(env, live.sourceSha), api);
    Object.assign(receipt, admission, { format: 'freedom.shared-backup/v1', operatorImage: installation.image, configSha256: installation.configSha256 });
    if (env.BACKUP_COMMAND === 'admit') {
      if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `source_sha=${admission.sourceSha}\n`);
      receipt.status = 'awaiting_execution'; return;
    }
    const sourceRoot = resolve(env.RELEASE_SOURCE_DIRECTORY ?? 'source');
    await verifyApplicationSource(sourceRoot, admission.sourceSha, admission.sourceTree);
    check(env.RUNNER_TEMP && !sourceRoot.startsWith(resolve(env.RUNNER_TEMP) + '/'), 'release_runner_paths_invalid');
    const temporaryRoot = join(env.RUNNER_TEMP, `shared-backup-${admission.target}-${admission.runId}-${admission.runAttempt}`);
    await mkdir(temporaryRoot, { mode: 0o700 });
    receipt.status = 'running'; receipt.providerOutcome = 'unknown_until_confirmed';
    await writeFile(join(output, 'receipt.json'), json(receipt), { mode: 0o600 });
    receipt.phases = await runOperator({ admission, installation, sourceRoot, temporaryRoot, config: env.RELEASE_CONFIG_JSON,
      credentials: { cloudflareApiToken: env.CLOUDFLARE_API_TOKEN, migrationDatabaseUrl: env.MIGRATION_DATABASE_URL,
        runtimeDatabaseUrl: env.RUNTIME_DATABASE_URL, backupDatabaseUrl: env.BACKUP_DATABASE_URL,
        ...(admission.target === 'staging-next' ? { stagingAccessClientId: env.CF_ACCESS_CLIENT_ID, stagingAccessClientSecret: env.CF_ACCESS_CLIENT_SECRET } : {}) } });
    receipt.status = 'passed'; receipt.providerOutcome = 'backup_and_restore_confirmed'; receipt.operatorEvidence = 'validated-backup-phases/v1';
  } catch (error) {
    receipt.status = 'failed'; receipt.error = /^release_[a-z_]+$/.test(error?.code ?? '') ? error.code : 'release_backup_failed';
    process.exitCode = 1;
  } finally {
    receipt.completedAt = new Date().toISOString(); await writeFile(join(output, 'receipt.json'), json(receipt), { mode: 0o600 });
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `### Shared backup: ${receipt.status}\n\n`
      + (receipt.sourceSha ? `- Version: \`${receipt.sourceSha}\`\n- Environment: \`${receipt.target}\`\n- Trigger: ${receipt.event}\n`
        + `- Requested by: ${receipt.original.login}; run by: ${receipt.triggeredBy.login}\n` : '')
      + `- Provider outcome: \`${receipt.providerOutcome}\`\n`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
