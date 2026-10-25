import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, realpath, statfs, mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRelease as check } from '../admission.mjs';

const MAX = 128 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const bytesStream = bytes => new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });

export async function privateBackupRoot(root) {
  check(typeof root === 'string' && isAbsolute(root), 'release_backup_directory_invalid');
  const st = await lstat(root), fs = await statfs(root);
  check(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o077) === 0
    && await realpath(root) === root && ![0x01021994, 0x858458f6].includes(fs.type >>> 0),
  'release_backup_directory_invalid');
  return root;
}

async function readBytes(body, limit) {
  check(body instanceof ReadableStream, 'release_backup_member_missing');
  const reader = body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      check(next.value instanceof Uint8Array, 'release_backup_member_invalid');
      size += next.value.length; check(size <= limit, 'release_backup_member_limit'); chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

/** Each immutable object is one atomically published member: metadata + bytes.
 * Uses the existing create-only filesystem ArchiveStore, never a source delete. */
export function backupObjectStore(archive, { assertObjectKey, validateMetadata, maxBytes = 64 * 1024 * 1024 }) {
  const read = async key => {
    assertObjectKey(key); const body = await archive.get(key); if (!body) return null;
    const bytes = await readBytes(body, maxBytes + 4096);
    check(bytes.length > 4, 'release_backup_object_invalid'); const length = bytes.readUInt32BE(0);
    check(length > 0 && length <= 4092 && bytes.length > length + 4, 'release_backup_object_invalid');
    let metadata; try { metadata = JSON.parse(bytes.subarray(4, 4 + length).toString('utf8')); }
    catch { throw new Error('release_backup_object_invalid'); }
    validateMetadata(metadata); const value = bytes.subarray(4 + length);
    check(value.length === metadata.byteSize && hash(value) === metadata.sha256, 'release_backup_object_invalid');
    return { metadata, bytes: value, etag: metadata.sha256 };
  };
  return Object.freeze({
    async putImmutable(key, value) {
      assertObjectKey(key); const metadata = structuredClone(value.metadata); validateMetadata(metadata);
      const bytes = Buffer.from(value.bytes);
      check(bytes.length <= maxBytes && bytes.length === metadata.byteSize && hash(bytes) === metadata.sha256,
        'release_backup_object_invalid');
      const header = Buffer.from(JSON.stringify(metadata)); check(header.length <= 4092, 'release_backup_object_invalid');
      const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
      return archive.putIfAbsent(key, bytesStream(Buffer.concat([length, header, bytes])));
    },
    async head(key) { const value = await read(key); return value ? { metadata: value.metadata, etag: value.etag } : null; },
    async get(key, range) {
      check(range === undefined, 'release_backup_range_unsupported');
      const value = await read(key); return value ? { metadata: value.metadata, etag: value.etag, body: bytesStream(value.bytes) } : null;
    },
    async delete() { throw new Error('release_backup_delete_forbidden'); },
  });
}

/** Fixed standard-library TAR codec. No shell, extractall, inherited credentials,
 * symlinks, special files or unbounded members. The source is an owned directory. */
export async function backupTar(mode, root, bytes, signal) {
  check(['pack', 'unpack'].includes(mode), 'release_backup_archive_mode_invalid');
  await privateBackupRoot(root); signal?.throwIfAborted();
  check(mode === 'pack' ? bytes === undefined : bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MAX,
    'release_backup_archive_input_invalid');
  const child = spawn('/usr/bin/python3', ['-I', fileURLToPath(new URL('./backup-tar.py', import.meta.url)), mode, root],
    { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'ignore'] });
  const chunks = []; let size = 0, failed = false;
  const stop = () => { failed = true; child.kill('SIGKILL'); };
  const exited = new Promise(resolve => {
    child.once('error', () => { failed = true; }); child.once('close', code => resolve(code));
  });
  child.stdin.on('error', stop); child.stdin.end(bytes);
  child.stdout.on('data', chunk => { size += chunk.length; if (size > MAX) stop(); else chunks.push(chunk); });
  signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
  const timer = setTimeout(stop, 60_000);
  try {
    const code = await exited; check(!failed && code === 0, 'release_backup_archive_failed');
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
}

export async function newBackupDirectories(root) {
  await privateBackupRoot(root);
  for (const name of ['sealed', 'objects']) await mkdir(join(root, name), { mode: 0o700 });
}
