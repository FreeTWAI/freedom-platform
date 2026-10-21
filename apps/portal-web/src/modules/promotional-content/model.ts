/** Internal authoring document. This is not an HTTP/SDK contract or an ACL. */
export const PROMO_SCHEMA_VERSION = 1;
export const PROMO_RENDER_VERSION = 'editorial-v1';
export const PROMO_RATIOS = {'1:1': [1080, 1080], '4:5': [1080, 1350]} as const;
export type PromoRatio = keyof typeof PROMO_RATIOS;
export type PromoField = 'label' | 'title' | 'body' | 'footer';
export type PromoPage = {id: string; label: string; title: string; body: string; footer: string};
export type PromoDocument = {schemaVersion: 1; ratio: PromoRatio; accent: string; pages: PromoPage[]};
export const PROMO_LIMITS = {label: 48, title: 120, body: 1200, footer: 120, pages: 10} as const;
export type PromoFault = 'document' | 'field' | 'overflow' | 'canvas' | 'fonts' | 'encode';
export class PromoError extends Error {
  constructor(readonly code: PromoFault, readonly field?: PromoField) {
    super('promotional-content:' + code);
  }
}

function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PromoError('document');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== null && prototype !== Object.prototype) throw new PromoError('document');
  if (Object.keys(input).some(key => !keys.includes(key))) throw new PromoError('document');
  return input as Record<string, unknown>;
}

function text(input: unknown, field: PromoField): string {
  if (typeof input !== 'string' || input.length > PROMO_LIMITS[field]
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input)
    || /[\uD800-\uDFFF]/u.test(input)) throw new PromoError('field', field);
  if (field === 'title' && !input.trim()) throw new PromoError('field', field);
  return input.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/** Make a detached, bounded copy. No base64, URL, path, owner or policy fields. */
export function parsePromoDocument(input: unknown): PromoDocument {
  const value = record(input, ['schemaVersion', 'ratio', 'accent', 'pages']);
  if (value.schemaVersion !== PROMO_SCHEMA_VERSION
    || typeof value.ratio !== 'string' || !Object.hasOwn(PROMO_RATIOS, value.ratio)
    || typeof value.accent !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(value.accent)
    || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > PROMO_LIMITS.pages) {
    throw new PromoError('document');
  }
  const ids = new Set<string>();
  const pages = value.pages.map(inputPage => {
    const page = record(inputPage, ['id', 'label', 'title', 'body', 'footer']);
    if (typeof page.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(page.id) || ids.has(page.id)) {
      throw new PromoError('document');
    }
    ids.add(page.id);
    return {id: page.id, label: text(page.label, 'label'), title: text(page.title, 'title'),
      body: text(page.body, 'body'), footer: text(page.footer, 'footer')};
  });
  return {schemaVersion: 1, ratio: value.ratio as PromoRatio, accent: value.accent.toLowerCase(), pages};
}

export function initialPromoDocument(): PromoDocument {
  return {schemaVersion: 1, ratio: '4:5', accent: '#3044ff', pages: [{
    id: 'page-1', label: '作品介紹',
    title: '把想法，\n做成作品。',
    body: '放上作品名稱、創作方法，\n以及你想分享的重點。',
    footer: 'YOUR WORK / YOUR STORY',
  }]};
}

export function promoDocumentKey(input: unknown): string {
  return JSON.stringify(parsePromoDocument(input));
}

/** Bind an export to the exact content, ratio and renderer version. */
export async function promoFingerprint(input: unknown): Promise<string> {
  const content = PROMO_RENDER_VERSION + '\n' + promoDocumentKey(input);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
