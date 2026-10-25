import { constants } from 'node:fs';
import { lstat, open, realpath, statfs } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { requireRelease as check } from '../admission.mjs';

/** Private, disk-backed, create-only mutation intent. A partial file also blocks
 * reuse; it must never be deleted to replay an uncertain remote write. */
export async function writeArchiveIntent(directory, { target, setId, key, sha256, byteSize }) {
  try {
    check(typeof directory === 'string' && isAbsolute(directory), 'release_archive_intent_invalid');
    const info = await lstat(directory), fs = await statfs(directory);
    check(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid()
      && (info.mode & 0o077) === 0 && await realpath(directory) === directory
      && ![0x01021994, 0x858458f6].includes(fs.type >>> 0), 'release_archive_intent_invalid');
    check(['staging-next', 'next'].includes(target)
      && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(setId)
      && /^[a-f0-9]{64}$/.test(sha256) && Number.isSafeInteger(byteSize) && byteSize > 0 && byteSize <= 128 * 1024 * 1024
      && key === `daily-v2/${target === 'next' ? 'next' : 'staging'}/${setId}.tar`, 'release_archive_intent_invalid');
    const file = await open(join(directory, `${target}-${setId}.json`),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await file.writeFile(JSON.stringify({ format: 'freedom.shared-release-archive-intent/v1',
        target, setId, key, sha256, byteSize, atomicCreateOnly: false,
        outcome: 'unconfirmed', automaticRetry: false }) + '\n');
      await file.sync();
    } finally { await file.close(); }
    const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await parent.sync(); } finally { await parent.close(); }
  } catch (error) {
    const code = error?.code === 'EEXIST' ? 'release_archive_intent_exists' : 'release_archive_intent_failed';
    throw Object.assign(new Error(code), { code });
  }
}
