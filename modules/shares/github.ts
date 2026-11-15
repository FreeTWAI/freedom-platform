import { publicRepositoryJson } from '../opensource-marketing/github.js';
import { Problem } from '../../packages/shared/problem.js';

const origin = 'https://api.github.com';
const moved = () => new Problem(422, 'github_repository_moved', '這個儲存庫已搬移，請貼上新的網址。');

/** One numeric-ID move per read, including its anonymous retry. Never normalize an untrusted Location. */
export function repositoryRedirectReader(path: string, fetcher: typeof fetch) {
  const requested = /^\/repos\/[^/]+\/[^/]+(\/readme|\/releases\/latest)?$/.exec(path);
  if (!requested) throw moved();
  const suffix = requested[1] ?? '';
  let target = `${origin}${path}`;
  let followed = false;
  let refusal: Problem | undefined;
  const read: typeof fetch = async (_input, init) => {
    for (;;) {
      const response = await fetcher(target, { ...init, redirect: 'manual' });
      const redirect = response.status >= 300 && response.status < 400 && response.status !== 304;
      if (!redirect && !response.redirected && response.type !== 'opaqueredirect') return response;
      const location = response.headers.get('location') ?? '';
      // Exact raw spelling also excludes ports (including :443), credentials, queries,
      // fragments, escapes, relative URLs and URL-parser normalization tricks.
      const match = /^https:\/\/api\.github\.com\/repositories\/[0-9]{1,20}(\/readme|\/releases\/latest)?$/.exec(location);
      try { await response.body?.cancel(); } catch { /* The redirect status is final. */ }
      if (followed || response.redirected || response.type === 'opaqueredirect'
        || ![301, 307, 308].includes(response.status) || !match
        || (match[1] !== undefined && match[1] !== suffix)) {
        refusal = moved();
        throw refusal;
      }
      followed = true;
      // GitHub may name the repository itself; keep the requested resource in that case.
      target = match[1] ? location : `${location}${suffix}`;
    }
  };
  return { read, refusal: () => refusal };
}

export async function shareRepositoryJson(path: string, signal: AbortSignal, fetcher: typeof fetch,
  missing = false, maxBytes = 196608, token?: string): Promise<unknown> {
  const reader = repositoryRedirectReader(path, fetcher);
  try {
    // Retain the shared reader's status classification, bounded body, retry metadata,
    // token-first/anonymous retry and the SAME deadline across all requests.
    return await publicRepositoryJson(path, signal, reader.read, missing, maxBytes, token);
  } catch (error) {
    // publicJson conceals fetch exceptions; restore only our locally classified move.
    throw reader.refusal() ?? error;
  }
}
