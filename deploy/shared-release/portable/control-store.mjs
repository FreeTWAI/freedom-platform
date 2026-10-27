// Private external journal for release/floor/scheduler state. No mutable head
// pointer and no delete API. Authority starts at an independently pinned seed;
// a missing seed is never reconstructed from the database being protected.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { requireRelease as check, isDigest } from '../admission.mjs';
import { boundedResponseBytes } from './cloudflare.mjs';
import { privateBackupRoot } from './backup-storage.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
const MAX_RECORD = 262144, MAX_AUTHORITY = 2 * 1024 * 1024;
const parse = bytes => { try { return JSON.parse(bytes.toString('utf8')); } catch { throw Error('release_control_json_invalid'); } };
const fileName = (generation, sha256) => String(generation).padStart(8, '0') + '-' + sha256 + '.json';

async function intent(directory, generation, value) {
  await privateBackupRoot(directory);
  const file = await open(join(directory, `control-intent-${generation}.json`),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(encode(value)); await file.sync(); } finally { await file.close(); }
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await parent.sync(); } finally { await parent.close(); }
}

/** Single writer under the database lease, matching the existing R2 REST archive
 * limitation. This does not claim provider-enforced object immutability or CAS.
 * The provisioner uploads the reviewed seed/authority bytes separately; no method
 * here can bootstrap, overwrite an existing key or replace the seed pin. */
export function createControlStore({ accountId, bucket, target, epoch, seedSha256, token, lease, fetchImpl = fetch }) {
  check(/^[a-f0-9]{32}$/.test(accountId) && /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)
    && ['staging-next', 'next'].includes(target) && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(epoch)
    && isDigest(seedSha256) && typeof token === 'string' && token.length > 0 && !/[\r\n]/.test(token)
    && lease?.signal instanceof AbortSignal && typeof lease.assertHeld === 'function', 'release_control_input_invalid');
  const prefix = `shared-release/v1/${target}/${epoch}/`, records = prefix + 'records/';
  const root = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`;
  const objectUrl = key => root + '/' + key.split('/').map(encodeURIComponent).join('/');
  const assertHeld = () => { lease.signal.throwIfAborted(); lease.assertHeld(); };
  const readFailure = (code, operation, httpStatus) => Object.assign(Error(code), {
    controlReadFailure: { operation, ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}) } });
  const request = async (url, body, operation) => {
    assertHeld();
    try {
      return await fetchImpl(url, { method: body ? 'PUT' : 'GET', redirect: 'error',
        headers: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-store', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.any([lease.signal, AbortSignal.timeout(30000)]), ...(body ? { body } : {}) });
    } catch { throw body ? Error('release_control_write_unknown') : readFailure('release_control_read_failed', operation); }
  };
  const read = async (key, expected, limit, operation) => {
    const response = await request(objectUrl(key), undefined, operation);
    if (response.status !== 200) { await response.body?.cancel(); throw readFailure('release_control_read_failed', operation, response.status); }
    const bytes = await boundedResponseBytes(response, limit);
    check(digest(bytes) === expected, 'release_control_digest_mismatch'); return { bytes, value: parse(bytes) };
  };
  const list = async (operation = 'list') => {
    const keys = new Map(), cursors = new Set(); let cursor;
    for (let page = 0; page < 16; page++) {
      const url = new URL(root); url.searchParams.set('prefix', records); url.searchParams.set('per_page', '1000');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await request(url.href, undefined, operation);
      if (response.status !== 200) { await response.body?.cancel(); throw readFailure('release_control_list_failed', operation, response.status); }
      const body = parse(await boundedResponseBytes(response, 2_000_000));
      check(body.success === true && Array.isArray(body.result) && body.result.length <= 1000, 'release_control_list_invalid');
      for (const item of body.result) {
        check(typeof item.key === 'string' && item.key.startsWith(records) && !keys.has(item.key)
          && Number.isSafeInteger(item.size) && item.size > 0 && item.size <= MAX_RECORD, 'release_control_object_invalid');
        const match = /^(\d{8})-([a-f0-9]{64})\.json$/.exec(item.key.slice(records.length));
        check(match && keys.size < 4096, 'release_control_object_invalid');
        keys.set(item.key, { key: item.key, generation: Number(match[1]), sha256: match[2], size: item.size });
      }
      if (body.result_info?.is_truncated === false || (!body.result_info?.is_truncated && body.result.length < 1000)) {
        return [...keys.values()].sort((a, b) => a.generation - b.generation);
      }
      cursor = body.result_info?.cursor;
      check(typeof cursor === 'string' && cursor.length > 0 && cursor.length <= 4096 && !cursors.has(cursor), 'release_control_cursor_invalid');
      cursors.add(cursor);
    }
    throw Error('release_control_history_limit');
  };
  const load = async () => {
    const index = await list();
    check(index.length > 0 && index[0].generation === 0 && index[0].sha256 === seedSha256
      && index.every((item, i) => item.generation === i), 'release_control_history_gap_or_fork');
    check(index.reduce((sum, item) => sum + item.size, 0) <= 128 * 1024 * 1024, 'release_control_history_limit');
    const values = [];
    // Bounded concurrent reads; inspect every result, never accept a partial chain.
    for (let offset = 0; offset < index.length; offset += 8) {
      const batch = await Promise.allSettled(index.slice(offset, offset + 8).map(async item => {
        const record = await read(item.key, item.sha256, item.size, 'chain_record');
        check(record.bytes.length === item.size, 'release_control_size_changed'); return { ...item, record: record.value };
      }));
      const failed = batch.find(item => item.status === 'rejected');
      if (failed) {
        const error = Error('release_control_chain_read_failed');
        if (failed.reason?.controlReadFailure) error.controlReadFailure = failed.reason.controlReadFailure;
        throw error;
      }
      values.push(...batch.map(item => item.value));
    }
    for (let i = 0; i < values.length; i++) {
      const { record } = values[i];
      check(record?.format === 'freedom.shared-control-record/v1' && record.target === target && record.epoch === epoch
        && record.generation === i && record.previousSha256 === (i ? values[i - 1].sha256 : null)
        && record.seedSha256 === (i ? seedSha256 : null) && record.data && typeof record.data === 'object'
        && !Array.isArray(record.data) && Number.isFinite(Date.parse(record.createdAt)), 'release_control_chain_invalid');
    }
    assertHeld(); return values;
  };
  let writing = false;
  return Object.freeze({ target, epoch, seedSha256, load,
    async readAuthority(sha256) {
      check(isDigest(sha256), 'release_control_authority_invalid');
      return (await read(prefix + 'authority/' + sha256 + '.json', sha256, MAX_AUTHORITY, 'authority')).value;
    },
    async append({ previous, data, intentDirectory }) {
      check(!writing && Number.isSafeInteger(previous?.generation) && isDigest(previous?.sha256)
        && data && typeof data === 'object' && !Array.isArray(data), 'release_control_append_invalid');
      previous = structuredClone(previous); data = structuredClone(data); writing = true;
      try {
        const chain = await load(), head = chain.at(-1);
        check(head.generation === previous.generation && head.sha256 === previous.sha256, 'release_control_head_changed');
        const generation = head.generation + 1;
        const record = { format: 'freedom.shared-control-record/v1', target, epoch, generation,
          previousSha256: head.sha256, seedSha256, createdAt: new Date().toISOString(), data };
        const bytes = encode(record), sha256 = digest(bytes), key = records + fileName(generation, sha256);
        check(bytes.length <= MAX_RECORD && generation < 4096, 'release_control_record_limit');
        await intent(intentDirectory, generation, { target, epoch, generation, key, sha256, outcome: 'unknown', automaticRetry: false });
        const existing = await request(objectUrl(key), undefined, 'append_existence'); const absent = existing.status === 404; await existing.body?.cancel();
        if (!absent) throw readFailure('release_control_key_exists', 'append_existence', existing.status);
        // Check ownership after all preceding awaits, directly before the PUT.
        const response = await request(objectUrl(key), bytes);
        const ok = response.ok; await response.body?.cancel(); check(ok, 'release_control_write_unknown');
        const saved = await read(key, sha256, bytes.length, 'append_readback');
        check(saved.bytes.equals(bytes), 'release_control_readback_mismatch');
        const next = await list('append_list');
        check(next.length === generation + 1 && next.at(-1).sha256 === sha256
          && next.every((row, i) => row.generation === i), 'release_control_concurrent_writer');
        assertHeld(); return { key, generation, sha256, size: bytes.length, record };
      } finally { writing = false; }
    },
  });
}
