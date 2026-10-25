import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { requireRelease as check, isSha, isDigest } from '../admission.mjs';
import { writeArchiveIntent } from './intent.mjs';

const MAX_ARCHIVE = 128 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => Object.assign(new Error(code), { code });
const discard = async response => { await response.body?.cancel().catch(() => {}); };
const expectStatus = async (response, status, code) => {
  if (response.status !== status) { await discard(response); throw fail(code); }
};
const targets = Object.freeze({
  'staging-next': { worker: 'freedom-platform-staging-next', origin: 'https://staging.freetwai.com' },
  next: { worker: 'freedom-platform-next', origin: 'https://freetwai.com' },
});
const bucketName = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value);

export async function boundedResponseBytes(response, limit) {
  check(Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_ARCHIVE && response.body,
    'release_cloudflare_response_invalid');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; check(size <= limit, 'release_cloudflare_response_limit');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

/** Provider-bound transport; source media has no write/delete operation. */
export function createCloudflareRecoveryTransport({ accountId, target, mediaBucket, backupBucket,
  token, signal, fetchImpl = fetch }) {
  check(typeof accountId === 'string' && /^[a-f0-9]{32}$/.test(accountId) && Object.hasOwn(targets, target ?? '')
    && bucketName(mediaBucket) && bucketName(backupBucket) && mediaBucket !== backupBucket,
  'release_cloudflare_resources_invalid');
  check(typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token), 'release_cloudflare_credentials_missing');
  const root = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
  const attempted = new Set();
  const request = async (path, options = {}) => {
    signal?.throwIfAborted();
    try {
      return await fetchImpl(root + path, { method: options.method ?? 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store',
          ...(options.body ? { 'Content-Type': 'application/octet-stream' } : {}) },
        signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
        ...(options.body ? { body: options.body } : {}) });
    } catch { throw fail(options.method === 'PUT' ? 'release_archive_upload_unknown' : 'release_cloudflare_read_failed'); }
  };
  const objectPath = (bucket, key) => `/r2/buckets/${bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  const json = async path => {
    const response = await request(path);
    await expectStatus(response, 200, 'release_cloudflare_read_failed');
    let value;
    try { value = JSON.parse((await boundedResponseBytes(response, 1_000_000)).toString('utf8')); }
    catch { throw fail('release_cloudflare_json_invalid'); }
    check(value?.success === true && value.result !== undefined, 'release_cloudflare_read_failed');
    return value.result;
  };
  return Object.freeze({
    async readWorkerState() {
      const value = await json(`/workers/scripts/${targets[target].worker}/settings`);
      const bindings = value?.bindings;
      check(Array.isArray(bindings) && bindings.length <= 256 && bindings.every(binding => binding && typeof binding.name === 'string')
        && new Set(bindings.map(binding => binding.name)).size === bindings.length, 'release_worker_bindings_invalid');
      const release = bindings.find(binding => binding.name === 'FREEDOM_RELEASE_SHA');
      check(release?.type === 'plain_text' && isSha(release.text), 'release_worker_source_invalid');
      check(!bindings.some(binding => /MAINTENANCE.*ENABLED/.test(binding.name) && binding.text === 'true'),
        'release_worker_maintenance_enabled');
      const retained = bindings.filter(binding => binding.name !== 'FREEDOM_RELEASE_SHA')
        .map(canonical).sort((a, b) => a.name.localeCompare(b.name, 'en'));
      // Private provider data stays inside the operator. Public evidence uses only the digest.
      return Object.freeze({ sourceSha: release.text, bindingsSha256: hash(JSON.stringify(retained)),
        bindings: structuredClone(bindings) });
    },
    sourceObjects({ assertObjectKey, validateMetadata }) {
      check(typeof assertObjectKey === 'function' && typeof validateMetadata === 'function', 'release_object_contract_missing');
      const head = async key => {
        assertObjectKey(key);
        const rows = await json(`/r2/buckets/${mediaBucket}/objects?per_page=1&prefix=${encodeURIComponent(key)}`);
        check(Array.isArray(rows) && rows.length <= 1, 'release_object_metadata_invalid');
        const row = rows.find(item => item.key === key); if (!row) return null;
        check(row.custom_metadata?.format === 'freedom.asset/v1', 'release_object_metadata_invalid');
        const metadata = { contentType: row.http_metadata?.contentType, byteSize: Number(row.size),
          sha256: row.custom_metadata.sha256, transformVersion: row.custom_metadata.transform_version,
          policyRevision: row.custom_metadata.policy_revision,
          ...(row.custom_metadata.profile_id ? { profileId: row.custom_metadata.profile_id } : {}) };
        validateMetadata(metadata);
        check(Number.isSafeInteger(metadata.byteSize) && metadata.byteSize > 0 && metadata.byteSize <= 64 * 1024 * 1024
          && isDigest(metadata.sha256), 'release_object_metadata_invalid');
        return { metadata, etag: row.etag };
      };
      return Object.freeze({ head, async get(key, range) {
        check(range === undefined, 'release_object_range_unsupported');
        const observation = await head(key); if (!observation) return null;
        const response = await request(objectPath(mediaBucket, key));
        await expectStatus(response, 200, 'release_object_read_failed');
        const bytes = await boundedResponseBytes(response, observation.metadata.byteSize);
        check(bytes.length === observation.metadata.byteSize && hash(bytes) === observation.metadata.sha256,
          'release_object_digest_mismatch');
        return { ...observation, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
      }, async putImmutable() { throw fail('release_source_media_readonly'); },
      async delete() { throw fail('release_source_media_readonly'); } });
    },
    async publishArchive({ setId, bytes, intentDirectory }) {
      check(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(setId ?? '') && bytes instanceof Uint8Array
        && bytes.length > 0 && bytes.length <= MAX_ARCHIVE, 'release_archive_input_invalid');
      // Copy caller bytes before asynchronous operations; the upload and readback
      // must bind the same immutable bytes even if the caller reuses its buffer.
      const body = Buffer.from(bytes), digest = hash(body);
      const key = `daily-v2/${target === 'next' ? 'next' : 'staging'}/${setId}.tar`;
      check(!attempted.has(key), 'release_archive_retry_forbidden'); attempted.add(key);
      // The create-only durable record blocks this UUID across process restarts
      // using the same work directory, including an interrupted/partial intent.
      await writeArchiveIntent(intentDirectory, { target, setId, key, sha256: digest, byteSize: body.length });
      const path = objectPath(backupBucket, key), existing = await request(path);
      const absent = existing.status === 404; await discard(existing);
      check(absent, 'release_archive_key_not_absent');
      // A lost PUT response never causes a retry or overwrite.
      const uploaded = await request(path, { method: 'PUT', body });
      await discard(uploaded); check(uploaded.ok, 'release_archive_upload_unconfirmed');
      const response = await request(path); await expectStatus(response, 200, 'release_archive_readback_failed');
      const readback = await boundedResponseBytes(response, body.length);
      check(readback.length === body.length && hash(readback) === digest, 'release_archive_readback_mismatch');
      return Object.freeze({ bytes: readback, archiveSha256: digest,
        publication: Object.freeze({ mode: 'unique_single_writer', atomicCreateOnly: false }) });
    },
  });
}

/** Only GET retries for edge propagation; never attaches the Cloudflare token. */
export async function waitForPublicRelease({ target, sourceSha, signal, fetchImpl = fetch,
  sleep = ms => delay(ms, undefined, { signal }), record = async () => {} }) {
  check(Object.hasOwn(targets, target ?? '') && isSha(sourceSha), 'release_health_input_invalid');
  for (let attempt = 1; attempt <= 10; attempt++) {
    signal?.throwIfAborted();
    let observed = { attempt, statusCode: null, sourceSha: null, matched: false };
    try {
      const response = await fetchImpl(targets[target].origin + '/api/v1/health', { method: 'GET', redirect: 'error',
        headers: { 'Cache-Control': 'no-store' },
        signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]) });
      observed.statusCode = response.status;
      const body = JSON.parse((await boundedResponseBytes(response, 16_384)).toString('utf8'));
      observed.sourceSha = isSha(body.release_sha) ? body.release_sha : null;
      observed.matched = response.status === 200 && body.status === 'ok' && observed.sourceSha === sourceSha;
    } catch { /* A bounded failed GET is retained, then the next permitted observation is made. */ }
    await record(Object.freeze(observed));
    signal?.throwIfAborted();
    if (observed.matched) return Object.freeze({ sourceSha, statusCode: 200, attempts: attempt });
    if (attempt < 10) await sleep(15_000);
  }
  throw fail('release_health_source_not_propagated');
}
