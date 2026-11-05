import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, REPOSITORY_ID, requireRelease as check, isSha, admitRelease, githubClient } from './admission.mjs';

export async function admitImage(env, api) {
  check(env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REPOSITORY_ID === String(REPOSITORY_ID)
    && env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && env.GITHUB_WORKFLOW_REF === `${REPOSITORY}/.github/workflows/release-operator-image.yml@refs/heads/main`
    && isSha(env.CONTROLLER_SHA), 'release_image_workflow_invalid');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_ACTOR_ID']) {
    check(/^[1-9][0-9]{0,15}$/.test(env[key] ?? '') && Number.isSafeInteger(Number(env[key])), 'release_run_identity_invalid');
  }
  const sourceSha = env.OPERATOR_SOURCE_SHA === undefined || env.OPERATOR_SOURCE_SHA === ''
    ? env.CONTROLLER_SHA : env.OPERATOR_SOURCE_SHA;
  check(isSha(sourceSha), 'release_exact_sha_required');
  return admitRelease({ format: 'freedom.shared-image-request/v1', repository: REPOSITORY, repositoryId: REPOSITORY_ID,
    mode: 'image', sourceSha, controllerSha: env.CONTROLLER_SHA,
    actor: env.GITHUB_ACTOR, actorId: Number(env.GITHUB_ACTOR_ID), triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT) }, api);
}

// Run from the protected-main controller, never import the selected source.
export function verifyImageCheckout({ sourceRoot, sourceSha, sourceTree }) {
  check(isSha(sourceSha) && isSha(sourceTree), 'release_exact_sha_required');
  const git = args => execFileSync('/usr/bin/git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.fsmonitor=false', '-C', sourceRoot, ...args], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1_000_000, stdio: ['ignore', 'pipe', 'ignore'],
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' },
  }).trim();
  check(git(['rev-parse', 'HEAD']) === sourceSha && git(['rev-parse', 'HEAD^{tree}']) === sourceTree
    && git(['status', '--porcelain', '--untracked-files=all']) === '', 'release_checkout_identity_invalid');
  for (const path of ['package.json', 'package-lock.json', 'deploy/shared-release/image/Dockerfile',
    'deploy/shared-release/image/freedom-release', 'deploy/shared-release/portable/entry.mjs',
    'deploy/shared-release/test/image-native.mjs', 'deploy/shared-release/test/backup-integration.mjs',
    'deploy/shared-release/test/migration-integration.mjs', 'deploy/shared-release/test/smoke-integration.mjs']) {
    const entry = git(['ls-tree', sourceSha, '--', path]);
    check(/^100(?:644|755) blob [a-f0-9]{40}\t/.test(entry) && entry.split('\t')[1] === path,
      'release_image_implementation_missing');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === '--verify-source') {
      verifyImageCheckout({ sourceRoot: process.env.OPERATOR_SOURCE_DIRECTORY,
        sourceSha: process.env.IMAGE_SOURCE, sourceTree: process.env.IMAGE_TREE });
    } else {
      check(process.argv.length === 2, 'release_image_arguments_invalid');
      const value = await admitImage(process.env, githubClient(process.env.GH_TOKEN));
      await appendFile(process.env.GITHUB_OUTPUT, `source_sha=${value.sourceSha}\nsource_tree=${value.sourceTree}\nimage_tag=ghcr.io/freetwai/freedom-release-operator:${value.sourceSha}\n`);
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Release operator image\n\nSource: \`${value.sourceSha}\`\n\n`
        + `Controller: \`${value.controllerSha}\`; source tree: \`${value.sourceTree}\`.\n\n`
        + `Requested by ${value.original.login}; run by ${value.triggeredBy.login}. Exact-source main Verify and CodeQL passed.\n`);
    }
  } catch { process.stderr.write('release_image_admission_failed\n'); process.exitCode = 1; }
}
