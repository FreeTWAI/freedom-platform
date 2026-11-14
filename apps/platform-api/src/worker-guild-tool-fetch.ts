import type { GuildToolFetch } from '../../../modules/guild-tools/transport.js';

// These hosting namespaces have provider-controlled DNS; members cannot select private addresses.
// Workers cannot pin checked DNS answers, so other origins still require the Node transport.
const hostingLabels: Readonly<Record<string, readonly number[]>> = {
  'github.io': [1],
  'pages.dev': [1, 2],
  'netlify.app': [1, 2],
  'vercel.app': [1, 2],
  'workers.dev': [1, 2],
};
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function assertUrl(input: string): void {
  // Check the raw authority before URL parsing can erase case, ports or encoded characters.
  const authority = /^https:\/\/([^/?#]+)(?:\/|$)/.exec(input)?.[1];
  if (!authority || authority.length > 253 || /[\s\\\u0000-\u001f\u007f]/.test(input)) {
    throw new Error('tool_destination_rejected');
  }
  const labels = authority.split('.');
  const suffix = labels.slice(-2).join('.');
  if (!Object.hasOwn(hostingLabels, suffix) || !hostingLabels[suffix].includes(labels.length - 2)
    || !labels.every(label => dnsLabel.test(label))) throw new Error('tool_destination_rejected');
  const url = new URL(input);
  if (url.origin !== 'https://' + authority || url.search || url.hash || input.length > 2048) {
    throw new Error('tool_destination_rejected');
  }
}

function resolveRedirectTarget(location: string | null, current: string, entryOrigin: string): string {
  if (!location) throw new Error('tool_redirect_rejected');
  const raw = location.trim();
  if (!raw || /[\s\\\u0000-\u001f\u007f]/.test(raw)) throw new Error('tool_redirect_rejected');
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw)) {
    try { assertUrl(raw.startsWith('//') ? `https:${raw}` : raw); } catch { throw new Error('tool_redirect_rejected'); }
  }
  let next: URL;
  try { next = new URL(raw, current); } catch { throw new Error('tool_redirect_rejected'); }
  if (next.origin !== entryOrigin) throw new Error('tool_redirect_rejected');
  try { assertUrl(next.href); } catch { throw new Error('tool_redirect_rejected'); }
  return next.href;
}

export function createWorkerGuildToolFetch(fetcher: typeof fetch = globalThis.fetch): GuildToolFetch {
  return Object.assign(async (input: string, init?: RequestInit) => {
    assertUrl(input);
    if (init?.method && init.method !== 'GET') throw new Error('tool_method_rejected');
    const accept = new Headers(init?.headers).get('accept');
    if (accept && accept !== 'text/html' && accept !== 'text/plain') throw new Error('tool_headers_rejected');
    const signal = init?.signal ?? AbortSignal.timeout(8000);
    signal.throwIfAborted();
    const entryOrigin = new URL(input).origin;
    let current = input;
    for (let hops = 0; ; hops++) {
      const response = await fetcher(current, {
        method: 'GET', credentials: 'omit', redirect: 'manual', signal,
        headers: { Accept: accept ?? 'text/html', 'Accept-Encoding': 'identity' },
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        if (!redirectStatuses.has(response.status) || hops >= 3) throw new Error('tool_redirect_rejected');
        current = resolveRedirectTarget(response.headers.get('location'), current, entryOrigin);
        continue;
      }
      // Keep streaming: inspection cancels HTML immediately; origin proof enforces its 256-byte cap.
      return response;
    }
  }, { assertUrl });
}

export const workerGuildToolFetch = createWorkerGuildToolFetch();
