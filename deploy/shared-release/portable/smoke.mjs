import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { candidateTarget, runCandidate, READ_ONLY_PHASES } from '../../../scripts/verify-cloud-candidate-lib.ts';
import { boundedResponseBytes } from './cloudflare.mjs';
import { requireRelease as check, isSha } from '../admission.mjs';

/** Reuse the existing health/protocol/assets/anonymous acceptance, with an
 * origin/method/body fence and cancellation. No member credentials or writes. */
export async function verifyPublicSmoke({ target, sourceSha, sourceRoot, access, workRoot, signal, fetchImpl = fetch,
  sleep = ms => delay(ms, undefined, { signal }) }) {
  check(['next', 'staging-next'].includes(target) && isSha(sourceSha), 'release_smoke_request_invalid');
  const destination = candidateTarget(target === 'next' ? 'public' : 'staging');
  check(target === 'next' ? access === undefined : typeof access?.clientId === 'string' && access.clientId.length > 0
    && typeof access.clientSecret === 'string' && access.clientSecret.length > 0, 'release_smoke_access_invalid');
  const contract = JSON.parse(await readFile(join(sourceRoot, 'contracts/preview/v1/metadata.json'), 'utf8'));
  const { version } = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
  const transport = async request => {
    signal.throwIfAborted();
    const url = new URL(request.url);
    check(url.origin === destination.origin && !url.username && !url.password && !url.hash
      && ((request.method === 'GET' && request.body === undefined)
        || (request.method === 'POST' && url.pathname === '/api/v1/auth/login' && !url.search
          && request.body === '{}' && request.headers.Origin !== destination.origin)), 'release_smoke_operation_invalid');
    const response = await fetchImpl(url.href, { method: request.method, headers: request.headers,
      body: request.body, redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    return { status: response.status, headers: response.headers, body: await boundedResponseBytes(response, 8 * 1024 * 1024) };
  };
  for (let attempt = 1; attempt <= 5; attempt++) {
    signal.throwIfAborted();
    const report = await runCandidate({ target: destination, run: 'execute', phases: [...READ_ONLY_PHASES],
      expectedVersion: version, expectedReleaseSha: sourceSha, contract, access, transport });
    await writeFile(join(workRoot, `smoke-${attempt}.json`), JSON.stringify(report) + '\n', { mode: 0o600, flag: 'wx' });
    signal.throwIfAborted();
    if (report.overall === 'pass' && report.cloud_proof === true && READ_ONLY_PHASES.every(id =>
      report.phases.filter(row => row.id === id && row.status === 'pass').length === 1)
      && report.cleanup.required === false && report.cleanup.restore_failed === false) {
      return { sourceSha, statusCode: 200, smokePassed: true, attempts: attempt };
    }
    if (attempt < 5) await sleep(3000);
  }
  throw Error('release_smoke_not_passed');
}
