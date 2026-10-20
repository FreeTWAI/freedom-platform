import type {RenderPolicies} from '../storefront/policies/model.js';
import {sellerDetails,policyLinks} from '../storefront/policies/pages.js';
import {AccentPresetSchema,PrivateAppearanceImageSchema,PublicAppearanceImageSchema} from '../../../contracts/guild-launchpad/v1/storefront-appearance.js';
import type {RenderAppearance} from './appearance.js';
import {escapeHtml as escape} from '../../../packages/shared/html.js';

export interface StorefrontHeading {slug: string; name: string; description?: string; appearance?: RenderAppearance; policies?: RenderPolicies}

export function storefrontBodyAttributes(appearance?:RenderAppearance){
  return appearance?` data-store-appearance="v1" data-shop-accent="${AccentPresetSchema.parse(appearance.accent_preset)}"`:'';
}
export function appearanceImage(image:NonNullable<RenderAppearance['logo']>){return PublicAppearanceImageSchema.or(PrivateAppearanceImageSchema).parse(image);}

/** Public pages receive the immutable publication; private preview receives the saved draft. */
export function storefrontHeader(store: StorefrontHeading, options: {cart?: boolean; preview?: boolean; appearance?: RenderAppearance; policies?: RenderPolicies} = {}) {
  const slug = escape(encodeURIComponent(store.slug)), name = escape(store.name), home = `/shops/${slug}`;
  const appearance=options.appearance??store.appearance;
  const logo=appearance?.logo?appearanceImage(appearance.logo):null;
  const brand=`${logo?`<img class="shop-merchant-logo" src="${escape(logo.read_path)}" alt="" width="${logo.width}" height="${logo.height}">`:''}${name}`;
  const announcement=appearance?.announcement.trim()?`<div class="shop-announcement"><p>${escape(appearance.announcement)}</p></div>`:'';
  const identity = options.preview
    ? `<span class="shop-top-store">${brand}</span><span class="shop-preview-label">店面預覽</span>`
    : `<a class="shop-top-store" href="${home}">${brand}</a><nav class="shop-navigation" aria-label="商店導覽"><a href="${home}#products">商品</a>${options.cart ? `<a class="shop-cart-link" href="${home}/cart" data-store-slug="${slug}">購物車</a>` : ''}<a href="${home}/order-access">訂單查詢</a><a href="#shop-information">商店說明</a></nav>`;
  return `<a class="shop-skip-link" href="#main">跳到主要內容</a>${announcement}<header class="shop-top">${identity}</header>${options.cart ? '<p class="shop-sr-only" id="shop-cart-status" role="status"></p>' : ''}`;
}

export function storefrontFooter(store: StorefrontHeading, options: {preview?: boolean; reservations?: boolean; orderAccess?: boolean; previewNotice?:boolean; informationCard?:boolean} = {}) {
  const responsibility = options.preview ? '店主已儲存的預覽，尚未對外發布。' : `商品資訊與訂單服務由「${escape(store.name)}」提供。`;
  const links = options.preview || options.orderAccess === false ? '' : `<div class="shop-footer-links"><a href="/shops/${escape(encodeURIComponent(store.slug))}/order-access">找回訂單</a>${options.reservations ? '<a href="/#reservations">查詢我的預留</a>' : ''}</div>`;
  // This is merchant-authored public text, never inferred from member profiles,
  // supply agreements, buyer contact data or private payment settings. Keep URLs
  // as text: authoring a description does not create an external redirect.
  const description = store.description?.trim();
  if(store.policies?.seller.business_name){
    const legal=store.policies,about=legal.previewBase?legal.previewBase+'/about':`/shops/${encodeURIComponent(store.slug)}/about`;
    const sentence=`本店由${escape(legal.seller.business_name)}經營，負責商品、收款、出貨安排與售後；自由工坊提供網站服務，不是賣方。`;
    const information=`<section class="shop-merchant-info shop-seller-info" aria-labelledby="shop-information"><h2 id="shop-information" tabindex="-1">商店說明與聯絡</h2>${description?`<p class="shop-merchant-copy">${escape(description)}</p>`:''}${sellerDetails(legal)}<nav class="shop-policy-links" aria-label="商店資訊與政策"><a href="${escape(about)}">關於本店</a>${policyLinks(store.slug,legal)}</nav></section>`;
    const notice=options.preview&&options.previewNotice!==false?'<aside class="shop-preview-notice">店主已儲存的預覽，尚未對外發布。</aside>':'';
    return `${notice}${options.informationCard===false?'':information}<footer class="shop-footer"><div class="shop-footer-about"><p>${sentence}</p><a class="shop-platform" href="/" aria-label="自由工坊首頁"><img class="shop-logo" src="/brand/freedom-workshop.webp" alt="自由工坊" width="1280" height="720"><span>使用自由工坊開店</span></a></div>${links}</footer>`;
  }
  const information = `<section class="shop-merchant-info" aria-labelledby="shop-information"><h2 id="shop-information" tabindex="-1">商店說明與聯絡</h2>${description ? `<p class="shop-merchant-copy">${escape(description)}</p>` : '<p class="shop-merchant-empty">店主尚未補充商店說明與聯絡方式。</p>'}</section>`;
  return `${options.informationCard===false?'':information}<footer class="shop-footer"><div class="shop-footer-about"><p>${responsibility}</p><a class="shop-platform" href="/" aria-label="自由工坊首頁"><img class="shop-logo" src="/brand/freedom-workshop.webp" alt="自由工坊" width="1280" height="720"><span>使用自由工坊開店</span></a></div>${links}</footer>`;
}
