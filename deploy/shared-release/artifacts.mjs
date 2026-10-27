import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fail = code => Object.assign(new Error(code), { code });
const check = (ok, code) => { if (!ok) throw fail(code); };
const discard = async response => { await response.body?.cancel().catch(() => {}); };

export function decodeReceiptArchive(bytes) {
  check(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= 1_000_000,
    'release_staging_archive_invalid');
  try {
    const text = execFileSync('python3', ['-I', fileURLToPath(new URL('./receipt-archive.py', import.meta.url))], {
      input: bytes, encoding: 'utf8', timeout: 5000, maxBuffer: 65_536,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'ignore'],
    });
    return JSON.parse(text);
  } catch { throw fail('release_staging_archive_invalid'); }
}

/** GitHub-authenticated artifact metadata selects the ID/digest. Download URLs
 * come only from that API's redirect. The job token never follows the redirect. */
export function artifactReader(repository, token, fetchImpl = fetch) {
  return async artifact => {
    check(Number.isSafeInteger(artifact?.id) && artifact.id > 0
      && /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')
      && Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0
      && artifact.size_in_bytes <= 1_000_000, 'release_staging_artifact_invalid');
    try {
      const response = await fetchImpl(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`, {
        redirect: 'manual', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28' },
      });
      const location = response.headers.get('location'); await discard(response);
      check(response.status === 302 && location, 'release_staging_download_failed');
      const url = new URL(location);
      check(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
        && (url.hostname.endsWith('.blob.core.windows.net') || url.hostname.endsWith('.actions.githubusercontent.com')),
      'release_staging_download_origin_invalid');
      const download = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (download.status !== 200 || !download.body) { await discard(download); throw fail('release_staging_download_failed'); }
      const reader = download.body.getReader(), parts = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          check(size <= 1_000_000, 'release_staging_archive_invalid'); parts.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      const bytes = Buffer.concat(parts);
      check(size === artifact.size_in_bytes && 'sha256:' + createHash('sha256').update(bytes).digest('hex') === artifact.digest,
        'release_staging_artifact_digest_mismatch');
      return decodeReceiptArchive(bytes);
    } catch (error) {
      if (/^release_staging_[a-z_]+$/.test(error?.code ?? '')) throw error;
      throw fail('release_staging_download_failed');
    }
  };
}
