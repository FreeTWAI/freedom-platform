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
  return admitRelease({ format: 'freedom.shared-image-request/v1', repository: REPOSITORY, repositoryId: REPOSITORY_ID,
    mode: 'image', sourceSha: env.CONTROLLER_SHA, controllerSha: env.CONTROLLER_SHA,
    actor: env.GITHUB_ACTOR, actorId: Number(env.GITHUB_ACTOR_ID), triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT) }, api);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const value = await admitImage(process.env, githubClient(process.env.GH_TOKEN));
    await appendFile(process.env.GITHUB_OUTPUT, `source_sha=${value.sourceSha}\nimage_tag=ghcr.io/freetwai/freedom-release-operator:${value.sourceSha}\n`);
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Release operator image\n\nSource: \`${value.sourceSha}\`\n\n`
      + `Requested by ${value.original.login}; run by ${value.triggeredBy.login}. Exact-source main Verify and CodeQL passed.\n`);
  } catch { process.stderr.write('release_image_admission_failed\n'); process.exitCode = 1; }
}
