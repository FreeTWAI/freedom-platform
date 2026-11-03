import type {MiddlewareHandler} from 'hono';
import {challengeUrl, gameOf, GAMES, seedOf, type GameId} from './domain.js';

// These are the existing, publicly served game-card images, not player results.
const descriptions: Record<GameId, string> = {
  photo: '三位客人，沒有一位正常。來照相館挑戰同一題。',
  stamp: '只有十二張。這次真的。來挑戰同一題。',
  cash: '錢往右，大餅往左。來挑戰同一題，鈔票僅為遊戲道具。',
};
const escape = (s: string) => s.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));

/** Return the same SPA document with public challenge metadata, or the original
 * document if this is not one of the three games. No result or identity is exposed. */
export function gamePreviewHtml(html: string, requestUrl: string, origin: string): string {
  const url = new URL(requestUrl);
  if (url.pathname !== '/play' && url.pathname !== '/play/') return html;
  const game = gameOf(url.searchParams.get('game'));
  if (!game || !/<\/head\s*>/i.test(html)) return html;
  const title = `${GAMES.find(item => item.id === game)!.title}｜離譜日常・自由工坊`;
  const description = descriptions[game];
  const canonical = challengeUrl(origin, game, seedOf(url.searchParams.get('seed')));
  const image = new URL(`/games/absurd-daily/${game}.jpg`, origin).toString();
  const meta = [
    `<title>${escape(title)}</title>`,
    `<link rel="canonical" href="${escape(canonical)}">`,
    `<meta name="description" content="${escape(description)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="自由工坊">',
    '<meta property="og:locale" content="zh_TW">',
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    `<meta property="og:url" content="${escape(canonical)}">`,
    `<meta property="og:image" content="${escape(image)}">`,
    '<meta property="og:image:type" content="image/jpeg">',
    '<meta property="og:image:width" content="960">',
    '<meta property="og:image:height" content="720">',
    `<meta property="og:image:alt" content="${escape(title)}遊戲場景">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escape(title)}">`,
    `<meta name="twitter:description" content="${escape(description)}">`,
    `<meta name="twitter:image" content="${escape(image)}">`,
    `<meta name="twitter:image:alt" content="${escape(title)}遊戲場景">`,
  ].join('\n');
  const withoutOldMetadata = html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, tag => /\b(?:name|property)\s*=\s*["'](?:description|og:[^"']*|twitter:[^"']*)["']/i.test(tag) ? '' : tag)
    .replace(/<link\b[^>]*>/gi, tag => /\brel\s*=\s*["']canonical["']/i.test(tag) ? '' : tag);
  return withoutOldMetadata.replace(/<\/head\s*>/i, `${meta}\n</head>`);
}

/** Runs after platform host/security checks and decorates only successful HTML. */
export function gamePreviewMiddleware(origin: string): MiddlewareHandler {
  return async (c, next) => {
    const url = new URL(c.req.url);
    if (c.req.method !== 'GET' || (url.pathname !== '/play' && url.pathname !== '/play/') || !gameOf(url.searchParams.get('game'))) return next();
    await next();
    if (c.res.status !== 200 || !/^text\/html(?:;|$)/i.test(c.res.headers.get('content-type') ?? '')) return;
    const html = await c.res.text();
    const rewritten = gamePreviewHtml(html, c.req.url, origin);
    const headers = new Headers(c.res.headers);
    // Hono merges the prior response headers when c.res is replaced. Remove stale
    // representation headers from both copies so they cannot be reintroduced.
    for (const name of ['content-length','content-encoding','etag','last-modified','content-range']) {
      headers.delete(name);
      c.res.headers.delete(name);
    }
    c.res = new Response(rewritten, {status: c.res.status, headers});
  };
}
