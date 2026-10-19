import {escapeHtml as escape} from '../../../packages/shared/html.js';

export interface StorefrontHeading {slug: string; name: string}

/** Public navigation uses only the published store identity, never merchant contact or payment settings. */
export function storefrontHeader(store: StorefrontHeading, options: {cart?: boolean; preview?: boolean} = {}) {
  const slug = escape(encodeURIComponent(store.slug)), name = escape(store.name), home = `/shops/${slug}`;
  const identity = options.preview
    ? `<span class="shop-top-store">${name}</span><span class="shop-preview-label">店面預覽</span>`
    : `<a class="shop-top-store" href="${home}">${name}</a><nav class="shop-navigation" aria-label="商店導覽"><a href="${home}#products">商品</a>${options.cart ? `<a class="shop-cart-link" href="${home}/cart" data-store-slug="${slug}">購物車</a>` : ''}<a href="${home}/order-access">訂單查詢</a></nav>`;
  return `<a class="shop-skip-link" href="#main">跳到主要內容</a><header class="shop-top">${identity}</header>${options.cart ? '<p class="shop-sr-only" id="shop-cart-status" role="status"></p>' : ''}`;
}

export function storefrontFooter(store: StorefrontHeading, options: {preview?: boolean; reservations?: boolean; orderAccess?: boolean} = {}) {
  const responsibility = options.preview ? '店主已儲存的預覽，尚未對外發布。' : `商品資訊與訂單服務由「${escape(store.name)}」提供。`;
  const links = options.preview || options.orderAccess === false ? '' : `<div class="shop-footer-links"><a href="/shops/${escape(encodeURIComponent(store.slug))}/order-access">找回訂單</a>${options.reservations ? '<a href="/#reservations">查詢我的預留</a>' : ''}</div>`;
  return `<footer class="shop-footer"><div class="shop-footer-about"><p>${responsibility}</p><a class="shop-platform" href="/" aria-label="自由工坊首頁"><img class="shop-logo" src="/brand/freedom-workshop.webp" alt="自由工坊" width="1280" height="720"><span>使用自由工坊開店</span></a></div>${links}</footer>`;
}
