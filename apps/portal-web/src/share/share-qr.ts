import QRCode from 'qrcode';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ALLOWED_PATH = new RegExp(
  `^(?:/|/go/[A-Za-z0-9_-]{10}|/(?:s|works|events|posts|services|development/submissions)/${UUID}|/development/skills/[a-z0-9-]{1,100}|/member-cards/[A-Za-z0-9_-]{43})$`,
);
const ALLOWED_QUERY = /^(?:\?intro=[1-9][0-9]{0,2})?$/;

/** Build a bordered crisp SVG QR path for safe same-origin share URLs only. */
export function shareQr(url: string, origin: string): { url: string; size: number; path: string } | null {
  try {
    if (url.includes('#')) return null;
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
      return null;
    }
    const qr = QRCode.create(parsed.href, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    let path = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.modules.get(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
    }
    return { url: parsed.href, size: size + 8, path };
  } catch {
    return null;
  }
}
