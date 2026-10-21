import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { createApp } from '../../apps/platform-api/src/app.js';
import type { PublicStoreProjection } from '../../contracts/guild-launchpad/v1/storefront.js';
import { productHtml, storeHtml, storeMissingHtml } from '../../modules/agent-commerce/hosted/page.js';
import { cartPageHtml, checkoutPageHtml } from '../../modules/agent-commerce/storefront/pages.js';
import { checkoutHarness, ok, ports, type CheckoutHarness } from './hosted-checkout-harness.js';
import { TENANT_CURSOR_TEST_KEY } from './tenant-cursor-fixture.js';
import { escapeHtml } from '../../packages/shared/html.js';

const SYNTHETIC_PROJECTION: PublicStoreProjection = {
  slug: 'synthetic-tea-shop',
  name: '山邊合成茶鋪',
  brand: 'Mountain Synthetic',
  description: '第一段合成商店介紹。\n第二段合成商店說明。',
  currency: 'TWD',
  revision: '3',
  published_at: '2026-10-15T12:00:00.000Z',
  transaction_state: 'not_enabled',
  products: [
    {
      sku: 'P0001',
      title: `手作茶杯 <b>&"'`,
      description: '杯口手工成形。\n適合日常飲茶。',
      price_minor: 35000,
    },
    {
      sku: 'P0002',
      title: '亞麻茶席巾',
      description: '自然亞麻織紋。',
      price_minor: 12050,
    },
  ],
};

const PUBLIC_ORIGIN = { publicOrigin: 'https://shop.example.test/' } as const;

const PINNED_SHA256 = {
  gridDefault: 'f7467d79086fee527db258c6531f118e170bf65cd8e7475a4d6d51b4921d8157',
  gridOrigin: '6f0e2605be0b35402d29ab15715bafeb6a946befeb354fd7e22455ff7c712e64',
  gridPreview: '779064abb725543ad5829514c67f4d8ccaee96c092ec72c0d012eebf27794acd',
  listDefault: 'c5e42139648aa6d57f60340976815d1519a383dc472fb580552ddbcf1fab971e',
  listOrigin: '5f739f542cc3ba541737cfa2b46db408384926de833741b570c771e259b8aa05',
  listPreview: '725cc61d78e40c993fb6d72a725b7a9f85eabc1a07c1530a09fd5ec5267bd256',
  product1Default: 'a2c5469d44a48c1019a9de2b15efb14a3e9e9ffd1db38d40cdfa6adf182e839a',
  product1Origin: '72c64cc759eb25b9a9e51e6e616589df33faa728b5eb4d5810dd41db7a7c0647',
  product2Default: 'ff464281af4262f44e72bc40b80c1b250d1dc999e12dd1a7f047eebde896bf6a',
  product2Origin: 'e6a794b4c41896ffbea119dd15012ed926e9a2d4a20fc2f49afe35e517a9c482',
  missingStore: '5fafd27a9f9b2e25e9d060e4009528265763ce8b9a4f1b37edd1275f180f5905',
  missingProduct: '5ded05ead3b2a30f84c4a7353f83f57a1b28f252b4b4c04cb30bff53144ee53d',
} as const;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

let x: CheckoutHarness;

async function tableCounts() {
  return (
    await x.h.pool.query<{
      checkouts: number;
      orders: number;
      reservations: number;
      budgets: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM commerce_checkouts) AS checkouts,
        (SELECT count(*)::int FROM commerce_orders) AS orders,
        (SELECT count(*)::int FROM commerce_inventory_reservations) AS reservations,
        (SELECT count(*)::int FROM auth_rate_limits) AS budgets`,
    )
  ).rows[0];
}

function makeApp(options: {
  checkoutEnabled: boolean;
  quarantine?: boolean;
  admitted?: boolean;
}) {
  return createApp(x.runtime, x.h.origin, 'local', {
    guildLaunchpadEnabled: true,
    hostedReservationsEnabled: true,
    tenantCursorSigningKey: TENANT_CURSOR_TEST_KEY,
    commerceSettings: {
      checkoutEnabled: options.checkoutEnabled,
      consoleEnabled: true,
      quarantine: options.quarantine ?? false,
      providerProfiles: [],
    },
    commercePorts: {
      admission: { allowed: () => options.admitted ?? true },
      shipping: ports.shipping,
    },
  });
}

before(async () => {
  x = await checkoutHarness('fc_storefront_cart');
});

beforeEach(async () => {
  await x.reset();
});

after(async () => {
  await x?.stop();
});

test('merchant storefront snapshots cover templates, publicOrigin, private preview, closed checkout and missing pages', () => {
  assert.equal(sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-grid-v1')), PINNED_SHA256.gridDefault);
  assert.equal(
    sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-grid-v1', [], undefined, { open: false })),
    PINNED_SHA256.gridDefault,
  );
  assert.equal(
    sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-grid-v1', [], PUBLIC_ORIGIN)),
    PINNED_SHA256.gridOrigin,
  );
  assert.equal(
    sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-grid-v1', [], PUBLIC_ORIGIN, { open: false })),
    PINNED_SHA256.gridOrigin,
  );
  assert.equal(
    sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-grid-v1', [], { preview: true })),
    PINNED_SHA256.gridPreview,
  );
  assert.equal(
    sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-grid-v1', [], { preview: true }, { open: true })),
    PINNED_SHA256.gridPreview,
  );

  assert.equal(sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-list-v1')), PINNED_SHA256.listDefault);
  assert.equal(
    sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-list-v1', [], undefined, { open: false })),
    PINNED_SHA256.listDefault,
  );
  assert.equal(
    sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-list-v1', [], PUBLIC_ORIGIN)),
    PINNED_SHA256.listOrigin,
  );
  assert.equal(
    sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-list-v1', [], PUBLIC_ORIGIN, { open: false })),
    PINNED_SHA256.listOrigin,
  );
  assert.equal(
    sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-list-v1', [], { preview: true })),
    PINNED_SHA256.listPreview,
  );
  assert.equal(
    sha256(storeHtml(SYNTHETIC_PROJECTION, 'catalog-list-v1', [], { preview: true }, { open: true })),
    PINNED_SHA256.listPreview,
  );

  assert.equal(sha256(productHtml(SYNTHETIC_PROJECTION, 'P0001') ?? ''), PINNED_SHA256.product1Default);
  assert.equal(
    sha256(productHtml(SYNTHETIC_PROJECTION, 'P0001', [], undefined, { open: false }) ?? ''),
    PINNED_SHA256.product1Default,
  );
  assert.equal(
    sha256(productHtml(SYNTHETIC_PROJECTION, 'P0001', [], PUBLIC_ORIGIN) ?? ''),
    PINNED_SHA256.product1Origin,
  );
  assert.equal(
    sha256(productHtml(SYNTHETIC_PROJECTION, 'P0001', [], PUBLIC_ORIGIN, { open: false }) ?? ''),
    PINNED_SHA256.product1Origin,
  );
  assert.equal(sha256(productHtml(SYNTHETIC_PROJECTION, 'P0002') ?? ''), PINNED_SHA256.product2Default);
  assert.equal(
    sha256(productHtml(SYNTHETIC_PROJECTION, 'P0002', [], PUBLIC_ORIGIN) ?? ''),
    PINNED_SHA256.product2Origin,
  );

  assert.equal(sha256(storeMissingHtml()), PINNED_SHA256.missingStore);
  assert.equal(sha256(storeMissingHtml(true)), PINNED_SHA256.missingProduct);
});

test('B01 and B03 serve open variants only when checkout is open, and keep closed variants when quarantined or unadmitted', async () => {
  const s = await x.store(5);
  const soldOut = await x.store(0);
  const openApp = makeApp({ checkoutEnabled: true });
  const quarantinedApp = makeApp({ checkoutEnabled: true, quarantine: true });
  const unadmittedApp = makeApp({ checkoutEnabled: true, admitted: false });
  const before = await tableCounts();

  const closedStoreHtml = await (await x.app.request(`${x.h.origin}/shops/${s.slug}`)).text();
  const closedProductHtml = await (
    await x.app.request(`${x.h.origin}/shops/${s.slug}/products/${s.product.sku}`)
  ).text();
  assert.equal(closedStoreHtml.includes('<script'), false);
  assert.ok(closedStoreHtml.includes('<nav class="shop-navigation" aria-label="商店導覽">'));
  assert.ok(closedStoreHtml.includes(`<a class="shop-top-store" href="/shops/${s.slug}">合成商店</a>`));
  assert.ok(closedStoreHtml.includes(`<a href="/shops/${s.slug}/order-access">訂單查詢</a>`));
  assert.ok(closedProductHtml.includes(`<a href="/shops/${s.slug}/order-access">訂單查詢</a>`));
  assert.ok(closedStoreHtml.includes('登入查看預留狀態'));
  assert.ok(closedStoreHtml.includes('查詢我的預留'));
  assert.equal(closedProductHtml.includes('<script'), false);
  assert.ok(closedProductHtml.includes('登入確認預留條件'));
  assert.ok(closedProductHtml.includes('登入查看預留狀態'));
  assert.ok(closedProductHtml.includes('查詢我的預留'));

  for (const appVariant of [quarantinedApp, unadmittedApp]) {
    const storeRes = await appVariant.request(`${x.h.origin}/shops/${s.slug}`);
    const prodRes = await appVariant.request(`${x.h.origin}/shops/${s.slug}/products/${s.product.sku}`);
    assert.equal(await storeRes.text(), closedStoreHtml);
    assert.equal(await prodRes.text(), closedProductHtml);
  }

  const openStoreRes = await openApp.request(`${x.h.origin}/shops/${s.slug}`);
  const openStoreBody = await openStoreRes.text();
  assert.equal(openStoreRes.status, 200);
  assert.equal(openStoreBody.match(/<script\b/gi)?.length, 1);
  assert.ok(openStoreBody.includes('<script type="module" src="/assets/storefront.js"></script>'));
  assert.ok(openStoreBody.includes('<body><a class="shop-skip-link" href="#main">跳到主要內容</a>'));
  assert.ok(openStoreBody.includes('<main id="main" tabindex="-1">'));
  assert.ok(
    openStoreBody.includes(`<a class="shop-cart-link" href="/shops/${s.slug}/cart" data-store-slug="${s.slug}">購物車</a>`),
  );
  assert.ok(openStoreBody.includes('<p class="shop-sr-only" id="shop-cart-status" role="status"></p>'));
  assert.ok(openStoreBody.includes(`<a href="/shops/${s.slug}/order-access">找回訂單</a>`));
  assert.equal(openStoreBody.includes('會員的商品與商店'), false);
  assert.equal(openStoreBody.includes('登入查看預留狀態'), false);
  assert.equal(openStoreBody.includes('查詢我的預留'), false);

  const openProdRes = await openApp.request(`${x.h.origin}/shops/${s.slug}/products/${s.product.sku}`);
  const openProdBody = await openProdRes.text();
  assert.equal(openProdRes.status, 200);
  assert.equal(openProdBody.match(/<script\b/gi)?.length, 1);
  assert.ok(openProdBody.includes('<script type="module" src="/assets/storefront.js"></script>'));
  assert.ok(openProdBody.includes('<body><a class="shop-skip-link" href="#main">跳到主要內容</a>'));
  assert.ok(openProdBody.includes('<main id="main" tabindex="-1">'));
  assert.ok(
    openProdBody.includes(`<a class="shop-cart-link" href="/shops/${s.slug}/cart" data-store-slug="${s.slug}">購物車</a>`),
  );
  assert.ok(openProdBody.includes('<p class="shop-sr-only" id="shop-cart-status" role="status"></p>'));
  assert.ok(openProdBody.includes(`id="shop-add-to-cart"`));
  assert.ok(openProdBody.includes(`data-store-slug="${s.slug}"`));
  assert.ok(openProdBody.includes(`data-store-name="合成商店"`));
  assert.ok(openProdBody.includes(`data-sku="${s.product.sku}"`));
  assert.ok(openProdBody.includes(`data-title="合成商品"`));
  assert.ok(openProdBody.includes(`data-price-minor="100"`));
  assert.ok(openProdBody.includes(`data-currency="TWD"`));
  assert.ok(openProdBody.includes(`data-revision="1"`));
  assert.ok(openProdBody.includes('<noscript><p class="shop-action-note">加入購物車需要開啟瀏覽器的 JavaScript。</p></noscript>'));
  assert.ok(openProdBody.includes(`<a href="/shops/${s.slug}/order-access">找回訂單</a>`));
  assert.equal(openProdBody.includes('登入確認預留條件'), false);
  assert.equal(openProdBody.includes('登入查看預留狀態'), false);
  assert.equal(openProdBody.includes('查詢我的預留'), false);

  const soldOutProdRes = await openApp.request(
    `${x.h.origin}/shops/${soldOut.slug}/products/${soldOut.product.sku}`,
  );
  const soldOutProdBody = await soldOutProdRes.text();
  assert.equal(soldOutProdRes.status, 200);
  assert.equal(soldOutProdBody.match(/<script\b/gi)?.length, 1);
  assert.ok(soldOutProdBody.includes('<p class="shop-availability">目前沒有可售數量</p>'));
  assert.equal(soldOutProdBody.includes('shop-add-to-cart'), false);
  assert.equal(soldOutProdBody.includes('登入確認預留條件'), false);
  assert.equal(soldOutProdBody.includes('登入查看預留狀態'), false);
  assert.equal(soldOutProdBody.includes('查詢我的預留'), false);

  for (const invalidSku of ['P1', 'p0001']) {
    const missingProdRes = await openApp.request(`${x.h.origin}/shops/${s.slug}/products/${invalidSku}`);
    assert.equal(missingProdRes.status, 404);
    assert.equal(missingProdRes.headers.get('set-cookie'), null);
    assert.equal(await missingProdRes.text(), storeMissingHtml(true));
  }

  assert.deepEqual(await tableCounts(), before);
});

test('B04 cart route keeps the OFF shell and adds only the enabled buyer marker, and 404s for unknown or unpublished stores', async () => {
  const s = await x.store(5);
  const openApp = makeApp({ checkoutEnabled: true });
  const before = await tableCounts();

  const closedRes = await x.app.request(`${x.h.origin}/shops/${s.slug}/cart`);
  const openRes = await openApp.request(`${x.h.origin}/shops/${s.slug.toUpperCase()}/cart`);
  const closedHtml = await closedRes.text();
  const openHtml = await openRes.text();

  for (const res of [closedRes, openRes]) {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/html\b/i);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    assert.equal(res.headers.get('set-cookie'), null);
  }

  assert.equal(openHtml, cartPageHtml({ slug: s.slug, name: '合成商店' }, true));
  assert.equal(openHtml.replace(' data-buyer-journey="true"', ''), closedHtml);
  assert.equal(closedHtml, cartPageHtml({ slug: s.slug, name: '合成商店' }));
  assert.ok(closedHtml.includes('<title>購物車｜合成商店｜自由工坊</title>'));
  assert.ok(closedHtml.includes('<body><a class="shop-skip-link" href="#main">跳到主要內容</a>'));
  assert.equal(closedHtml.match(/<script\b/gi)?.length, 1);
  assert.ok(closedHtml.includes('<script type="module" src="/assets/storefront.js"></script>'));
  assert.equal(/\bon[a-z]+\s*=/i.test(closedHtml), false);
  assert.equal(closedHtml.match(/<h1\b/gi)?.length, 1);
  assert.ok(closedHtml.includes('<h1 id="shop-cart-title" tabindex="-1">購物車</h1>'));
  assert.ok(closedHtml.includes('<p role="status">正在讀取購物車…</p>'));
  assert.ok(closedHtml.includes('<noscript><p>使用購物車需要開啟瀏覽器的 JavaScript。</p></noscript>'));
  assert.ok(closedHtml.includes(`data-store-slug="${s.slug}"`));
  assert.ok(closedHtml.includes('data-store-name="合成商店"'));

  const unknownRes = await openApp.request(`${x.h.origin}/shops/no-such-store/cart`);
  assert.equal(unknownRes.status, 404);
  assert.equal(unknownRes.headers.get('cache-control'), 'no-store');
  assert.equal(unknownRes.headers.get('x-robots-tag'), 'noindex');
  assert.equal(unknownRes.headers.get('set-cookie'), null);
  assert.equal(await unknownRes.text(), storeMissingHtml());

  const current = ok(await x.h.call('GET', s.root, s.owner, undefined, {}, x.app));
  ok(await x.send(s, '/unpublish', {}, current.version));

  const unpubRes = await openApp.request(`${x.h.origin}/shops/${s.slug}/cart`);
  assert.equal(unpubRes.status, 404);
  assert.equal(unpubRes.headers.get('set-cookie'), null);
  assert.equal(await unpubRes.text(), storeMissingHtml());

  assert.deepEqual(await tableCounts(), before);
});

test('B05 is a no-store shell with no order effects and follows store publication visibility', async () => {
  const s = await x.store(5);
  const app = makeApp({checkoutEnabled: true});
  const before = await tableCounts();
  for (const candidate of [app, x.app]) {
    const response = await candidate.request(`${x.h.origin}/shops/${s.slug.toUpperCase()}/checkout`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    assert.equal(await response.text(), checkoutPageHtml({slug: s.slug, name: '合成商店'}, candidate === app));
  }
  const missing = await app.request(`${x.h.origin}/shops/no-such-store/checkout`);
  assert.equal(missing.status, 404);
  const current = ok(await x.h.call('GET', s.root, s.owner, undefined, {}, x.app));
  ok(await x.send(s, '/unpublish', {}, current.version));
  assert.equal((await app.request(`${x.h.origin}/shops/${s.slug}/checkout`)).status, 404);
  assert.deepEqual(await tableCounts(), before);
});

test('HTML characters in store name and product title are escaped in B01, B03 and B04', async () => {
  const s = await x.store(5);
  const openApp = makeApp({ checkoutEnabled: true });
  const rawXss = `<img src=x onerror=alert(1)>&"'`;
  const escapedXss = '&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;';

  const current = ok(await x.h.call('GET', s.root, s.owner, undefined, {}, x.app));
  ok(await x.send(s, '', { name: rawXss }, current.version, 'PATCH'));
  ok(
    await x.send(
      s,
      `/products/${s.product.product_id}`,
      { title: rawXss, price_minor: 2500 },
      s.product.version,
      'PATCH',
    ),
  );
  await x.publish(s);

  const before = await tableCounts();

  const b01Res = await openApp.request(`${x.h.origin}/shops/${s.slug}`);
  const b01Html = await b01Res.text();
  assert.equal(b01Res.status, 200);
  assert.ok(b01Html.includes(`<title>${escapedXss}｜自由工坊</title>`));
  assert.ok(b01Html.includes(`<h1>${escapedXss}</h1>`));
  assert.equal(b01Html.includes('<img src=x'), false);

  const b03Res = await openApp.request(`${x.h.origin}/shops/${s.slug}/products/${s.product.sku}`);
  const b03Html = await b03Res.text();
  assert.equal(b03Res.status, 200);
  assert.ok(b03Html.includes(`<title>${escapedXss}｜${escapedXss}｜自由工坊</title>`));
  assert.ok(b03Html.includes(`data-store-name="${escapedXss}"`));
  assert.ok(b03Html.includes(`data-title="${escapedXss}"`));
  assert.equal(b03Html.includes('<img src=x'), false);
  assert.equal(/\bon[a-z]+\s*=/i.test(b03Html.replaceAll(escapedXss, '')), false);

  const b04Res = await openApp.request(`${x.h.origin}/shops/${s.slug}/cart`);
  const b04Html = await b04Res.text();
  assert.equal(b04Res.status, 200);
  assert.ok(b04Html.includes(`<title>購物車｜${escapedXss}｜自由工坊</title>`));
  assert.ok(b04Html.includes(`<a class="shop-top-store" href="/shops/${s.slug}">${escapedXss}</a>`));
  assert.ok(b04Html.includes(`data-store-name="${escapedXss}"`));
  assert.equal(b04Html.includes('<img src=x'), false);
  assert.equal(/\bon[a-z]+\s*=/i.test(b04Html.replaceAll(escapedXss, '')), false);

  assert.deepEqual(await tableCounts(), before);
});

test('merchant service text follows publication, draft privacy and withdrawal across buyer pages', async () => {
  const s = await x.store(5);
  const published = '合成店主負責商品與售後\n聯絡：published@example.test\n交付方式請先與店主確認。';
  const draft = '新的合成客服：draft@example.test\n<script>alert("description")</script>\nhttps://example.test/support';
  const read = async () => ok(await x.h.call('GET', s.root, s.owner, undefined, {}, x.app));
  ok(await x.send(s, '', {description: published}, (await read()).version, 'PATCH'));
  await x.publish(s);
  const paths = ['', `/products/${s.product.sku}`, '/cart', '/checkout', '/order-access', `/orders/${randomUUID()}`, '/orders/invalid', '/payment-return/invalid'];
  const pages = async () => Promise.all(paths.map(async path => {
    const response = await x.app.request(`${x.h.origin}/shops/${s.slug}${path}`);
    assert.equal(response.status, path.endsWith('/invalid') ? 404 : 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.text();
  }));
  const first = await pages();
  for (const body of first) {
    assert.ok(body.includes(escapeHtml(published)));
    assert.ok(body.includes('href="#shop-information"'));
    assert.ok(!body.includes(s.owner.user.email));
  }
  const publicJson = await (await x.app.request(`${x.h.origin}/api/v1/public/stores/${s.slug}`)).text();
  const version = (await read()).version;
  ok(await x.send(s, '', {description: draft}, version, 'PATCH'));
  assert.equal((await x.send(s, '', {description: 'stale@example.test'}, version, 'PATCH')).status, 412);
  assert.deepEqual(await pages(), first, 'saving a draft cannot change any public buyer page');
  assert.equal(await (await x.app.request(`${x.h.origin}/api/v1/public/stores/${s.slug}`)).text(), publicJson);
  const preview = await x.h.call('GET', s.root + '/preview-page', s.owner, undefined, {}, x.app);
  assert.equal(preview.status, 200);
  const privateHtml = await preview.response.clone().text();
  assert.ok(privateHtml.includes(escapeHtml(draft)));
  assert.ok(!privateHtml.includes('aria-label="商店導覽"'));
  assert.equal((await x.h.call('GET', s.root + '/preview-page', undefined, undefined, {}, x.app)).status, 401);
  await x.publish(s);
  for (const body of await pages()) {
    assert.ok(body.includes(escapeHtml(draft)));
    assert.ok(!body.includes('published@example.test'));
    assert.ok(!body.includes('<script>alert'));
    assert.ok(!body.includes('href="https://example.test/support"'));
  }
  ok(await x.send(s, '', {description: ''}, (await read()).version, 'PATCH'));
  await x.publish(s);
  for (const body of await pages()) {
    assert.ok(body.includes('店主尚未補充商店說明與聯絡方式。'));
    assert.ok(!body.includes('draft@example.test'));
  }
  ok(await x.send(s, '/unpublish', {}, (await read()).version));
  for (const path of paths) {
    const response = await x.app.request(`${x.h.origin}/shops/${s.slug}${path}`);
    assert.equal(response.status, 404);
    assert.ok(!(await response.text()).includes('shop-merchant-info'));
  }
});
