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

export const PROVIDER_HOSTING_SUFFIXES: readonly string[] = Object.freeze(Object.keys(hostingLabels));
export const AGENT_PING_SUFFIXES: readonly string[] = Object.freeze(
  PROVIDER_HOSTING_SUFFIXES.filter(suffix => suffix !== 'github.io'),
);

/** Return whether `input` is an HTTPS URL under an allowed provider-hosted DNS suffix. */
export function isProviderHostedUrl(
  input: string,
  suffixes: readonly string[] = PROVIDER_HOSTING_SUFFIXES,
): boolean {
  if (typeof input !== 'string') return false;
  // Check the raw authority before URL parsing can erase case, ports or encoded characters.
  const authority = /^https:\/\/([^/?#]+)(?:\/|$)/.exec(input)?.[1];
  if (!authority || authority.length > 253 || /[\s\\\u0000-\u001f\u007f]/.test(input)) {
    return false;
  }
  const labels = authority.split('.');
  const suffix = labels.slice(-2).join('.');
  if (!suffixes.includes(suffix) || !Object.hasOwn(hostingLabels, suffix)
    || !hostingLabels[suffix].includes(labels.length - 2)
    || !labels.every(label => dnsLabel.test(label))) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  return url.origin === 'https://' + authority && !url.search && !url.hash && input.length <= 2048;
}
