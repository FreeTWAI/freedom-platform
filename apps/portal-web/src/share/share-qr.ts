import QRCode from 'qrcode';
import { shareQrUrlAllowed } from './share-qr-url';

/** Build a bordered crisp SVG QR path for safe same-origin share URLs only. */
export function shareQr(url: string, origin: string): { url: string; size: number; path: string } | null {
  try {
    if (!shareQrUrlAllowed(url, origin)) return null;
    const normalizedUrl = new URL(url).href;
    const qr = QRCode.create(normalizedUrl, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    let path = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.modules.get(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
    }
    return { url: normalizedUrl, size: size + 8, path };
  } catch {
    return null;
  }
}
