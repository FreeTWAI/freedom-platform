const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ALLOWED_PATH = new RegExp(
  `^(?:/|/go/[A-Za-z0-9_-]{10}|/(?:s|works|events|posts|services|development/submissions)/${UUID}|/development/skills/[a-z0-9-]{1,100}|/member-cards/[A-Za-z0-9_-]{43})$`,
);
const ALLOWED_QUERY = /^(?:\?intro=[1-9][0-9]{0,2})?$/;

/** Check whether a share URL is a safe same-origin link eligible for QR rendering. */
export function shareQrUrlAllowed(url: string, origin: string): boolean {
  try {
    if (url.includes('#')) return false;
    const parsed = new URL(url);
    if (
      parsed.origin !== origin
      || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      || parsed.username
      || parsed.password
      || parsed.hash
      || !ALLOWED_PATH.test(parsed.pathname)
      || !ALLOWED_QUERY.test(parsed.search)
      || (url.includes('?') && !parsed.search)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
