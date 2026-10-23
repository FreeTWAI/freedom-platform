import {randomUUID} from 'node:crypto';
import {totpCode} from '../../modules/identity-membership/totp.js';
import {formatTaipeiDateTime} from '../../apps/portal-web/src/storefront/format.js';
import {test, expect, type BrowserContext, type Page, type Route} from './fixtures.js';
import {setupCartFixtureStore, openCartListener, assertCartResponsiveLayout} from './storefront-cart-fixture.js';
import {storeArea, person, launchStore, post} from './hosted-store-fixture.js';
import {apiLogin, buyerLogin, member, ownedSchema} from './hosted-order-fixture.js';
import {isolatedTransaction} from '../../packages/resource-scopes/tenant-transaction.js';
import {CheckoutResponseSchema, PlaceOrderResponseSchema, PublicOrderSchema} from '../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {createAccessLink} from '../../modules/agent-commerce/checkout/access.js';
import {sweepDueCheckoutHolds} from '../../modules/agent-commerce/checkout/settlement.js';
import {endOfflinePaymentWindow} from '../../modules/agent-commerce/payments/offline/window.js';
import type {Pool} from 'pg';
import {verifyPassword,taipeiDate,command,expireNextSettingsProof} from './seller-console-fixture.js';
import {DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {SellerCheckoutOrderSchema} from '../../contracts/guild-launchpad/v1/hosted-seller-checkout.js';
import {SupplyOfferSchema, DistributionSchema} from '../../contracts/guild-launchpad/v1/hosted-distribution.js';
import {openNotifications} from './navigation.js';
import {ProductViewSchema} from '../../contracts/guild-launchpad/v1/storefront.js';
import {StorePublicationReviewSchema} from '../../contracts/guild-launchpad/v1/storefront-publication.js';
import {E2E_AUTHOR_CLAIM_ADMIN_TOKEN} from '../../packages/testing/e2e-admin.js';

type Store = Awaited<ReturnType<typeof setupCartFixtureStore>>;
async function openBuyer(db: Pool, context: BrowserContext, store: Store) {
  const buyer = await member(db);
  expect((await db.query('SELECT 1 FROM principals WHERE user_ref=$1', [buyer.id])).rowCount).toBe(0);
  await apiLogin(context, store.origin, buyer.email);
  return buyer;
}
async function start(page: Page, store: Store, note='請先約定時間，在山邊小店門口面交。') {
  await page.goto(`${store.origin}/shops/${store.slug}/products/${store.products[0].sku}`);
  await page.getByRole('button', {name: '加入購物車', exact: true}).click();
  await page.getByRole('link', {name: '查看購物車', exact: true}).click();
  await page.getByRole('link', {name: '前往結帳', exact: true}).click();
  await page.getByLabel('收件人姓名', {exact: true}).fill('合成買家甲');
  await page.getByLabel('收件人手機', {exact: true}).fill('0900123456');
  await page.getByLabel('Email', {exact: true}).fill('offline-buyer@example.test');
  const meetupQuote = page.waitForResponse(response => {
    const request = response.request();
    if (!response.url().endsWith(`/stores/${store.slug}/cart-quotes`) || request.method() !== 'POST') return false;
    try {return request.postDataJSON()?.delivery?.method === 'meetup';} catch {return false;}
  });
  await page.getByRole('radio', {name: '面交取貨', exact: true}).check();
  const response = await meetupQuote;
  expect(response.ok()).toBe(true);
  await expect(page.getByLabel('收件地址', {exact: true})).toHaveCount(0);
  await expect(page.getByText(note, {exact: true})).toBeVisible();
  await expect(page.locator('#shop-checkout')).toHaveAttribute('aria-busy', 'false');
}

test('merchant navigation connects the public shop, product, cart and order guidance without exposing bank details', async ({browser, e2eAuthPool}, info) => {
  const store = await setupCartFixtureStore(e2eAuthPool, browser, true);
  const context = await browser.newContext({baseURL: store.origin});
  try {
    const page = await context.newPage();
    const checkFrame = async () => {
      await expect(page.locator('header.shop-top > .shop-top-store')).toHaveText(store.storeName);
      await expect(page.locator('header.shop-top img')).toHaveCount(0);
      await expect(page.locator('footer .shop-logo')).toBeVisible();
      await expect(page.getByRole('navigation', {name: '商店導覽'}).getByRole('link', {name: '訂單查詢', exact: true})).toHaveAttribute('href', `/shops/${store.slug}/order-access`);
      await expect(page.locator('body')).not.toContainText('000000123456');
      await expect(page.locator('body')).not.toContainText('合成測試銀行');
    };
    await page.goto(`/shops/${store.slug}`);
    await checkFrame();
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`synthetic-shop-${width}.png`));
    await page.getByRole('link', {name: `查看商品：${store.products[0].title}`, exact: true}).click();
    await checkFrame();
    await expect(page.getByRole('button', {name: '加入購物車', exact: true})).toBeVisible();
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`synthetic-product-${width}.png`));
    await page.getByRole('button', {name: '加入購物車', exact: true}).click();
    await page.getByRole('link', {name: '查看購物車', exact: true}).click();
    await checkFrame();
    await expect(page.getByRole('heading', {level: 1})).toHaveText('購物車');
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`synthetic-cart-${width}.png`));
    await page.getByRole('navigation', {name: '商店導覽'}).getByRole('link', {name: '訂單查詢', exact: true}).click();
    await checkFrame();
    await expect(page.getByRole('heading', {level: 1})).toHaveText('找回訂單');
    await expect(page.getByLabel('Email', {exact: true})).toHaveCount(0);
    await page.getByRole('navigation', {name: '商店導覽'}).getByRole('link', {name: '商品', exact: true}).click();
    await expect(page.getByRole('heading', {level: 1})).toHaveText(store.storeName);
  } finally {await context.close(); await store.close();}
});
async function freeze(page: Page, store: Pick<Store, 'slug'>) {
  const response = page.waitForResponse(r => r.url().endsWith(`/stores/${store.slug}/checkouts`) && r.request().method() === 'POST');
  await page.getByRole('button', {name: '核對訂單', exact: true}).click();
  const result = await response;
  expect(result.status(), await result.text()).toBe(201);
  return CheckoutResponseSchema.parse(await result.json());
}
async function place(page: Page, method: '銀行匯款' | '面交付款') {
  await page.getByRole('radio', {name: method, exact: true}).check();
  let capture!: (result: {status: number; body: unknown}) => void;
  const response = new Promise<{status: number; body: unknown}>(resolve => {capture = resolve;});
  const observe = async (route: Route) => {
    // Read the real backend response before delivering it: successful placement
    // immediately navigates, at which point Chromium may discard the old body.
    const result = await route.fetch();
    capture({status: result.status(), body: await result.json()});
    await route.fulfill({response: result});
  };
  await page.route('**/checkouts/*/orders', observe);
  await page.getByRole('button', {name: '確認下單', exact: true}).click();
  const result = await response;
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  const placed = PlaceOrderResponseSchema.parse(result.body);
  await expect(page.getByRole('heading', {level: 1})).toHaveText(`訂單 ${placed.order.display_number}`);
  await page.unroute('**/checkouts/*/orders', observe);
  expect(placed.payment).toBeNull();
  expect(placed.order.latest_payment_attempt).toBeNull();
  return placed.order;
}

test('bank checkout uses frozen instructions, member/link access, seller confirmation and responsive layout', async ({browser, e2eAuthPool}, info) => {
  const store = await setupCartFixtureStore(e2eAuthPool, browser, true);
  const context = await browser.newContext({baseURL: store.origin, permissions: ['clipboard-read', 'clipboard-write']});
  try {
    const buyer = await openBuyer(e2eAuthPool, context, store);
    const page = await context.newPage();
    await start(page, store);
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`checkout-contact-${width}.png`));
    const checkout = await freeze(page, store);
    expect(JSON.stringify(checkout)).not.toContain('000000123456');
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`checkout-confirm-${width}.png`));
    const order = await place(page, '銀行匯款');
    expect(await page.evaluate(slug => localStorage.getItem(`freedom.shop.cart.v1:${slug}`), store.slug)).toBeNull();
    expect(order.meetup_notes).toEqual(['請先約定時間，在山邊小店門口面交。']);
    await expect(page.getByText('000000123456', {exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: /前往付款|重新付款|查詢付款結果/})).toHaveCount(0);
    await page.getByRole('button', {name: '複製帳號', exact: true}).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('000000123456');
    await page.getByRole('button', {name: '複製金額', exact: true}).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('350.00');
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toMatch(/000000123456|offline-buyer@example.test/);
    await store.saveOfflineFixture(2);
    await page.reload();
    await expect(page.getByText('000000123456', {exact: true})).toBeVisible();
    await expect(page.getByText('新的面交地點。', {exact: true})).toHaveCount(0);
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`bank-order-${width}.png`));
    const path = new URL(page.url()).pathname;
    const fresh = await browser.newContext({baseURL: store.origin});
    try {
      const strangerPage = await fresh.newPage();
      await strangerPage.goto(path);
      await expect(strangerPage.getByRole('heading', {level: 1})).toHaveText('找不到這筆訂單');
      await expect(strangerPage.locator('body')).not.toContainText('000000123456');
      await apiLogin(fresh, store.origin, buyer.email);
      await strangerPage.reload();
      await expect(strangerPage.getByText('000000123456', {exact: true})).toBeVisible();
    } finally {await fresh.close();}
    const token = await isolatedTransaction(e2eAuthPool, q => createAccessLink(q, {tenant_id: store.tenant, instance_id: store.instance, checkout_id: checkout.checkout_ref, order_id: order.order_ref}));
    const linked = await browser.newContext({baseURL: store.origin});
    try {
      const linkedPage = await linked.newPage();
      await linkedPage.goto(`${path}#access=${token}`);
      await linkedPage.getByRole('button', {name: '在這個瀏覽器開啟訂單', exact: true}).click();
      await expect(linkedPage.getByText('000000123456', {exact: true})).toBeVisible();
      await linkedPage.getByRole('button', {name: '在這個瀏覽器忘記我的訂單', exact: true}).click();
      await linkedPage.getByRole('button', {name: '忘記訂單', exact: true}).click();
      await expect(linkedPage.getByRole('heading', {level: 1})).toHaveText('這個瀏覽器已忘記你的訂單');
      await expect(linkedPage.locator('body')).not.toContainText('000000123456');
    } finally {await linked.close();}
    const date = (await e2eAuthPool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') AS d")).rows[0].d;
    await store.sellerPost(`${store.root}/checkout-orders/${order.order_ref}/offline-payments`, {amount_minor: order.total_minor, received_on: date}, 200, '1');
    await page.getByRole('button', {name: '更新訂單狀態', exact: true}).click();
    await expect(page.getByText('店家已確認收到付款。', {exact: true})).toBeVisible();
    await expect(page.getByText('000000123456', {exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: '取消訂單', exact: true})).toHaveCount(0);
    const result = PublicOrderSchema.parse(await (await context.request.get(`/api/v1/public/stores/${store.slug}/orders/${order.order_ref}`)).json());
    expect(result.payment_state).toBe('confirmed');
    expect(result.offline_instructions).toBeNull();
  } finally {await context.close(); await store.close();}
});

for (const editedInAnotherTab of [false, true]) test(`unknown checkout and order acknowledgments retry the same identities across refresh${editedInAnotherTab ? ' after an other-tab cart edit' : ''}`, async ({browser, e2eAuthPool}) => {
  const store = await setupCartFixtureStore(e2eAuthPool, browser, true);
  const context = await browser.newContext({baseURL: store.origin});
  try {
    await openBuyer(e2eAuthPool, context, store);
    const page = await context.newPage();
    await start(page, store);
    const keys: string[] = [], bodies: string[] = [];
    await page.route(`**/stores/${store.slug}/checkouts`, async route => {
      keys.push(route.request().headers()['idempotency-key']);
      const response = await route.fetch();
      expect(response.status()).toBe(keys.length === 1 ? 201 : 200);
      if (keys.length === 1) await route.abort('failed'); else await route.fulfill({response});
    });
    await page.getByRole('button', {name: '核對訂單', exact: true}).click();
    await page.getByRole('button', {name: '重試同一筆結帳', exact: true}).click();
    await expect(page.getByRole('button', {name: '確認下單', exact: true})).toBeEnabled();
    expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
    await page.getByRole('radio', {name: '面交付款', exact: true}).check();
    await page.route('**/checkouts/*/orders', async route => {
      bodies.push(route.request().postData()!);
      const response = await route.fetch();
      expect(response.status()).toBe(bodies.length === 1 ? 201 : 200);
      if (bodies.length === 1) await route.abort('failed'); else await route.fulfill({response});
    });
    await page.getByRole('button', {name: '確認下單', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText('還沒收到下單結果');
    if (editedInAnotherTab) {
      const otherTab = await context.newPage();
      await otherTab.goto(`${store.origin}/shops/${store.slug}/cart`);
      await otherTab.getByRole('button', {name: `增加${store.products[0].title}數量`, exact: true}).click();
      await expect(otherTab.getByLabel(`${store.products[0].title}數量`, {exact: true})).toHaveValue('2');
      await otherTab.close();
    }
    const cartBeforeRecovery = await page.evaluate(slug => localStorage.getItem(`freedom.shop.cart.v1:${slug}`), store.slug);
    expect(JSON.parse(cartBeforeRecovery!).lines[0].quantity).toBe(editedInAnotherTab ? 2 : 1);
    await page.reload();
    await page.getByRole('button', {name: '重試同一筆訂單', exact: true}).click();
    await expect(page.getByRole('heading', {level: 1})).toHaveText(/^訂單 /);
    expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
    expect(await page.evaluate(slug => localStorage.getItem(`freedom.shop.cart.v1:${slug}`), store.slug)).toBe(cartBeforeRecovery);
    await expect(page.getByRole('region', {name: '面交取貨', exact: true}).getByText('店家會用你留下的手機或 Email 和你約時間地點。', {exact: true})).toBeVisible();
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_checkout_orders WHERE instance_id=$1', [store.instance])).rows[0].n).toBe(1);
    expect((await e2eAuthPool.query('SELECT l.quantity FROM commerce_order_lines l JOIN commerce_checkout_orders o USING(order_id) WHERE o.instance_id=$1', [store.instance])).rows).toEqual([{quantity: 1}]);
    await page.getByRole('button', {name: '取消訂單', exact: true}).click();
    await page.getByRole('button', {name: '確認取消訂單', exact: true}).click();
    await expect(page.getByText('訂單狀態：已取消（你取消了訂單）', {exact: true})).toBeVisible();
    await expect(page.getByRole('region', {name: '面交取貨', exact: true})).toHaveCount(0);
    expect((await e2eAuthPool.query('SELECT reserved FROM commerce_items WHERE item_id=$1', [store.products[0].product_id])).rows[0].reserved).toBe(0);
  } finally {await context.close(); await store.close();}
});

test('guest sees member requirement and revoked buyer access clears bank instructions', async ({browser, e2eAuthPool}) => {
  const store = await setupCartFixtureStore(e2eAuthPool, browser, true);
  const context = await browser.newContext({baseURL: store.origin});
  try {
    const page = await context.newPage();
    await start(page, store);
    await expect(page.getByText('銀行匯款：登入會員後才能選擇匯款或面交', {exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: '核對訂單', exact: true})).toBeDisabled();
    await openBuyer(e2eAuthPool, context, store);
    await page.getByRole('button', {name: '更新報價', exact: true}).click();
    await expect(page.getByText('登入身分已變更，請重新確認', {exact: true})).toBeVisible();
    await fillBuyerContact(page);
    await freeze(page, store);
    const order = await place(page, '銀行匯款');
    await context.clearCookies();
    await page.getByRole('button', {name: '更新訂單狀態', exact: true}).click();
    await expect(page.getByRole('heading', {level: 1})).toHaveText('找不到這筆訂單');
    await expect(page.locator('body')).not.toContainText('000000123456');
    await page.goto(`${store.origin}/shops/${store.slug}/orders/${randomUUID()}`);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('找不到這筆訂單');
    expect((await e2eAuthPool.query('SELECT lifecycle_state FROM commerce_checkout_orders WHERE order_id=$1', [order.order_ref])).rows[0].lifecycle_state).toBe('open');
  } finally {await context.close(); await store.close();}
});

test('changed terms require explicit editing; cash meetup records seller confirmation and stock handover', async ({browser, e2eAuthPool}) => {
  const store = await setupCartFixtureStore(e2eAuthPool, browser, true);
  const context = await browser.newContext({baseURL: store.origin});
  try {
    await openBuyer(e2eAuthPool, context, store);
    const page = await context.newPage();
    await start(page, store);
    await page.getByLabel('收件人手機', {exact: true}).fill('123');
    const invalid = page.waitForResponse(r => r.url().endsWith(`/stores/${store.slug}/checkouts`) && r.request().method() === 'POST');
    await page.getByRole('button', {name: '核對訂單', exact: true}).click();
    expect((await invalid).status()).toBe(422);
    const mobile = page.getByLabel('收件人手機', {exact: true});
    await expect(mobile).toHaveAttribute('aria-invalid', 'true');
    await expect(mobile).toHaveAccessibleDescription('收件人手機格式不符，請修正後再試。');
    await expect(page.getByLabel('收件人姓名', {exact: true})).toHaveValue('合成買家甲');
    await mobile.fill('0900123456');
    await freeze(page, store);
    await store.saveOfflineFixture(2);
    const rejected = page.waitForResponse(r => /\/checkouts\/[^/]+\/orders$/.test(r.url()));
    await page.getByRole('button', {name: '確認下單', exact: true}).click();
    expect((await rejected).status()).toBe(409);
    await expect(page.getByRole('alert')).toContainText('商品、價格或配送設定已更新');
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_checkout_orders WHERE instance_id=$1', [store.instance])).rows[0].n).toBe(0);
    await page.getByRole('button', {name: '修改資料', exact: true}).click();
    await freeze(page, store);
    const order = await place(page, '面交付款');
    const meetup = page.getByRole('region', {name: '面交取貨', exact: true});
    await expect(meetup.locator('.shop-pay-label')).toHaveText('等待面交');
    await expect(meetup.getByText('新的面交地點。', {exact: true})).toBeVisible();
    await expect(meetup.getByText('店家會用你留下的手機或 Email 和你約時間地點。', {exact: true})).toBeVisible();
    await expect(page.getByRole('region', {name: '面交付款', exact: true})).not.toContainText('新的面交地點。');
    await expect(page.getByRole('region', {name: '面交付款', exact: true})).not.toContainText('店家會用你留下的手機或 Email 和你約時間地點。');
    const date = (await e2eAuthPool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') AS d")).rows[0].d;
    await store.sellerPost(`${store.root}/checkout-orders/${order.order_ref}/meetup-completion`, {amount_minor: order.total_minor, completed_on: date}, 200, '1');
    await page.getByRole('button', {name: '更新訂單狀態', exact: true}).click();
    await expect(page.getByText('店家已確認收到付款。', {exact: true})).toBeVisible();
    await expect(meetup.locator('.shop-pay-label')).toHaveText('已面交');
    await expect(meetup.getByText('店家已登記在 '+date.replaceAll('-', '/')+' 完成面交。', {exact: true})).toBeVisible();
    const item = (await e2eAuthPool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1', [store.products[0].product_id])).rows[0];
    expect(item).toEqual({stock: 4, reserved: 0});
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_meetup_handovers WHERE order_id=$1', [order.order_ref])).rows[0].n).toBe(1);
  } finally {await context.close(); await store.close();}
});

/** Insert valid historical fixture orders; immutable dates and constraints stay enabled. */
async function historicalBankOrder(db: Pool, source: string, days: number) {
  await ownedSchema(db);
  const id = randomUUID(), client = randomUUID();
  const suffix = randomUUID().replaceAll('-', '').slice(0,6).toUpperCase();
  return isolatedTransaction(db, async q => {
    const checkout = (await q.query('SELECT checkout_id FROM commerce_checkout_orders WHERE order_id=$1', [source])).rows[0].checkout_id;
    await q.query(`INSERT INTO commerce_orders(order_id,public_shop_id,external_id,request_sha256,currency,total_minor,created_at,expires_at,order_profile,client_order_id,buyer_principal_id)
      SELECT $2::uuid,public_shop_id,'chk:'||$3::text||':'||($4::uuid)::text,request_sha256,currency,total_minor,t,t+interval '72 hours','hosted_checkout',$4::uuid,buyer_principal_id
      FROM commerce_orders CROSS JOIN (SELECT date_trunc('milliseconds',clock_timestamp()-($5::int * interval '1 day')) t) n WHERE order_id=$1::uuid`, [source,id,checkout,client,days]);
    await q.query(`INSERT INTO commerce_checkout_orders(order_id,tenant_id,instance_id,checkout_id,customer_id,contact_id,display_number,terms,terms_sha256,environment,payment_method)
      SELECT $2::uuid,co.tenant_id,co.instance_id,co.checkout_id,co.customer_id,co.contact_id,to_char(o.created_at AT TIME ZONE 'Asia/Taipei','YYMMDD')||'-'||$3,co.terms,co.terms_sha256,co.environment,'bank_transfer'
      FROM commerce_checkout_orders co JOIN commerce_orders o ON o.order_id=$2::uuid WHERE co.order_id=$1::uuid`, [source,id,suffix]);
    await q.query(`INSERT INTO commerce_order_lines(order_id,selection_id,item_id,quantity,snapshot,order_profile,supplier_shop_id,hosted_offer_id,acceptance_id,listing_sha256)
      SELECT $2::uuid,selection_id,item_id,quantity,snapshot,order_profile,supplier_shop_id,hosted_offer_id,acceptance_id,listing_sha256 FROM commerce_order_lines WHERE order_id=$1::uuid`, [source,id]);
    await q.query(`INSERT INTO commerce_inventory_reservations(order_id,item_id,supplier_shop_id,quantity,state,created_at,expires_at)
      SELECT o.order_id,l.item_id,l.supplier_shop_id,l.quantity,'held',o.created_at,o.expires_at FROM commerce_orders o JOIN commerce_order_lines l USING(order_id) WHERE o.order_id=$1::uuid`, [id]);
    await q.query('UPDATE commerce_items SET reserved=reserved+l.quantity FROM commerce_order_lines l WHERE l.order_id=$1 AND commerce_items.item_id=l.item_id', [id]);
    await q.query(`INSERT INTO commerce_due_work(tenant_id,instance_id,kind,target_id,due_at)
      SELECT co.tenant_id,co.instance_id,'offline_payment_window_end',o.order_id,o.expires_at+interval '72 hours' FROM commerce_orders o JOIN commerce_checkout_orders co USING(order_id) WHERE o.order_id=$1`, [id]);
    return id;
  });
}

test('real hold expiry shows grace and window cancellation without a new payment attempt', async ({browser, e2eAuthPool}, info) => {
  const store = await setupCartFixtureStore(e2eAuthPool, browser, true);
  const context = await browser.newContext({baseURL: store.origin});
  try {
    await openBuyer(e2eAuthPool, context, store);
    const page = await context.newPage();
    await start(page, store); await freeze(page, store);
    const source = await place(page, '銀行匯款');
    const grace = await historicalBankOrder(e2eAuthPool, source.order_ref, 4);
    const ended = await historicalBankOrder(e2eAuthPool, source.order_ref, 8);
    await sweepDueCheckoutHolds(e2eAuthPool, {limit: 200});
    await page.goto(`/shops/${store.slug}/orders/${grace}`);
    await expect(page.getByText(/付款期限已過，保留的商品已釋出。如果你已經匯款/)).toBeVisible();
    await expect(page.getByRole('button', {name: '複製帳號', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: '取消訂單', exact: true})).toBeVisible();
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`bank-grace-${width}.png`));
    await endOfflinePaymentWindow(e2eAuthPool, ended);
    await page.goto(`/shops/${store.slug}/orders/${ended}`);
    await expect(page.getByText('付款期限已結束，訂單已取消。如果你已經匯款，請聯絡店家。', {exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: '取消訂單', exact: true})).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('000000123456');
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_payment_attempts WHERE order_id=ANY($1::uuid[])', [[source.order_ref, grace, ended]])).rows[0].n).toBe(0);
  } finally {await context.close(); await store.close();}
});

const sellerHash=(store:Store,path:string)=>`#stores/${store.tenant}/${store.instance}/${path}`;
async function sellerSettings(page:Page,store:Store){
 await page.goto(store.origin+'/'+sellerHash(store,'settings/payments'));
 await expect(page.locator('.seller-console')).toBeVisible();
 await expect(page.getByRole('button',{name:'編輯線下收款設定',exact:true})).toBeEnabled();
}
async function configureSeller(page:Page,store:Store){
 await sellerSettings(page,store);
 await page.getByRole('button',{name:'編輯線下收款設定',exact:true}).click();
 const form=page.getByRole('form',{name:'線下收款設定',exact:true});
 await form.getByLabel('提供銀行匯款',{exact:true}).check();
 await form.getByLabel('銀行代碼',{exact:true}).fill('000');
 await form.getByLabel('銀行名稱',{exact:true}).fill('合成測試銀行');
 await form.getByLabel('收款帳號',{exact:true}).fill('000000123456');
 await form.getByLabel('戶名',{exact:true}).fill('合成測試商店');
 await form.getByLabel('匯款說明（選填）',{exact:true}).fill('匯款後請與店家聯絡。');
 await form.getByLabel('提供面交現金付款',{exact:true}).check();
 await form.getByRole('button',{name:'儲存線下收款設定',exact:true}).click();
 await verifyPassword(page,DEMO_PASSWORD);
}
async function saveMeetup(page:Page,note:string){
 await page.getByRole('button',{name:'編輯面交取貨設定',exact:true}).click();
 const form=page.getByRole('form',{name:'面交取貨設定',exact:true});
 await form.getByLabel('提供面交取貨',{exact:true}).check();
 await form.getByLabel('面交地區與時段',{exact:true}).fill(note);
 await form.getByRole('button',{name:'儲存面交取貨設定',exact:true}).click();
 await expect(form).toHaveCount(0);
}
async function sellerOrder(page:Page,store:Store,order:{order_ref:string;display_number:string}){
 await page.goto(store.origin+'/'+sellerHash(store,'orders/'+order.order_ref));
 await expect(page.getByRole('heading',{name:'訂單詳情：'+order.display_number,exact:true})).toBeVisible();
}
async function recordOffline(page:Page,label:string,amount?:string){
 const form=page.getByRole('form',{name:label,exact:true});
 if(amount!==undefined)await form.getByLabel('實收金額（TWD 整數元）',{exact:true}).fill(amount);
 await form.getByLabel(label==='確認收到匯款'?'收款日期':'面交日期',{exact:true}).fill(taipeiDate());
 await form.getByRole('button',{name:label,exact:true}).click();
 const dialog=page.getByRole('dialog',{name:label,exact:true});
 await expect(dialog).toContainText('$350.00');
 await dialog.getByRole('button',{name:'確認登記',exact:true}).click();
}
async function sellerScreens(page:Page,output:(width:number)=>string){
 for(const width of [1440,768,390]){
  await page.setViewportSize({width,height:width===390?844:900});
  await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const sizes=await page.locator('.seller-console .btn:visible').evaluateAll(buttons=>buttons.map(b=>({height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width,parent:b.parentElement!.getBoundingClientRect().width})));
  for(const b of sizes){expect(b.height).toBeGreaterThanOrEqual(44);expect(b.width).toBeLessThanOrEqual(b.parent+1);}
  await page.screenshot({path:output(width),fullPage:true});
 }
}

test('with supplier console OFF, a merchant publishes public service information, configures bank/cash meetup and fulfils orders for a returning buyer',async({browser,e2eAuthPool},info)=>{
 test.setTimeout(120000);
 const store=await setupCartFixtureStore(e2eAuthPool,browser,true,false,{realAdmission:true,supplierConsoleEnabled:false});
 const seller=await browser.newContext({baseURL:store.origin}),buyer=await browser.newContext({baseURL:store.origin});
 seller.setDefaultTimeout(15000);buyer.setDefaultTimeout(15000);
 try{
  const sp=await seller.newPage(),bp=await buyer.newPage(),person=await member(e2eAuthPool);
  await buyerLogin(sp,store.seller.email,sellerHash(store,'settings/payments'),store.origin);
  expect(await (await seller.request.get('/api/v1/site')).json()).toMatchObject({commerce_console_enabled:true,commerce_checkout_enabled:true,supplier_console_enabled:false});
  const supplierResponse=await seller.request.get(`/api/v1/tenants/${store.tenant}/storefronts/${store.instance}/supplier-console/overview`);
  expect(supplierResponse.status()).toBe(404);
  expect((await supplierResponse.json()).code).toBe('not_found');
  const settingsRequests:{key:string;body:string|null;version:string|undefined}[]=[];
  await sp.route('**/offline-payment-settings',async route=>{
   if(route.request().method()!=='PUT'){await route.continue();return;}
   const request=route.request();settingsRequests.push({key:request.headers()['idempotency-key'],body:request.postData(),version:request.headers()['if-match']});
   const response=await route.fetch();expect(response.ok(),await response.text()).toBe(true);
   if(settingsRequests.length===1)await route.abort('failed');else await route.fulfill({response});
  });
  await configureSeller(sp,store);
  await expect(sp.getByText('正在確認結果',{exact:true})).toBeVisible();
  await sp.getByRole('button',{name:/更新資料\s*：線下收款設定/}).click();
  await expect(sp.getByRole('button',{name:'儲存線下收款設定',exact:true})).toBeDisabled();
  await sp.getByRole('button',{name:'重試',exact:true}).click();
  await expect(sp.getByRole('form',{name:'線下收款設定',exact:true})).toHaveCount(0);
  expect(settingsRequests).toHaveLength(2);expect(settingsRequests[1]).toEqual(settingsRequests[0]);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_offline_payment_settings WHERE instance_id=$1',[store.instance])).rows[0].n).toBe(1);
  await saveMeetup(sp,'請先約定時間，在山邊小店門口面交。');
  await sellerScreens(sp,width=>info.outputPath(`seller-settings-${width}.png`));
  await sp.getByRole('button',{name:'編輯線下收款設定',exact:true}).click();
  await sellerScreens(sp,width=>info.outputPath(`seller-payment-form-${width}.png`));
  await sp.getByRole('form',{name:'線下收款設定',exact:true}).getByRole('button',{name:'捨棄輸入，重新讀取設定',exact:true}).click();
  await expect(sp.getByRole('button',{name:'編輯線下收款設定',exact:true})).toBeEnabled();
  await seller.clearCookies();await sp.goto('about:blank');
  await buyerLogin(sp,store.seller.email,sellerHash(store,'settings/payments'),store.origin);
  await expect(sp.getByText('000000123456',{exact:true})).toBeVisible();
  await expect(sp.getByText('請先約定時間，在山邊小店門口面交。',{exact:true})).toBeVisible();
  // Merchant pages use the real SQL admission port; the independent local admin identity is synthetic.
  await bp.goto(`${store.origin}/shops/${store.slug}/products/${store.products[0].sku}`);
  await expect(bp.getByRole('button',{name:'加入購物車',exact:true})).toHaveCount(0);
  await expect(bp.locator('body')).not.toContainText('000000123456');
  const admission=await store.admission('',{tenant_id:store.tenant,instance_id:store.instance,reason:'合成本機有限營業驗收'});
  expect(admission.environment).toBe('sandbox');
  // The same merchant can reach the existing publication flow from the seller console.
  await sp.setViewportSize({width:1280,height:900});
  await sp.getByRole('link',{name:'商店首頁',exact:true}).click();
  await storeArea(sp,'商店資料');
  const description='合成商店，僅供本機操作驗證。\n客服：shop@example.test，由合成店主處理。\n付款與交付：銀行匯款或面交現金，先聯絡約定面交時間。\n取消與售後：請提供訂單編號聯絡店主。';
  const storeForm=sp.getByRole('form',{name:'商店資料',exact:true});
  await storeForm.getByRole('textbox',{name:'商店介紹',exact:true}).fill(description);
  await storeForm.getByRole('button',{name:'儲存商店資料',exact:true}).click();
  await expect(sp.locator('.hosted-store').getByRole('status')).toContainText('重新發布後，公開頁才會更新。');
  await bp.goto(`/shops/${store.slug}`);
  await expect(bp.locator('body')).not.toContainText('shop@example.test');
  await storeArea(sp,'店面與發布');
  await sp.getByRole('button',{name:'發布更新',exact:true}).click();
  await expect(sp.locator('.hosted-store').getByRole('status')).toContainText('已發布・第 2 版');
  await bp.setViewportSize({width:390,height:844});
  for(const path of ['', '/products/P0001', '/cart', '/checkout', '/order-access']){
   await bp.goto(`/shops/${store.slug}${path}`);
   await bp.getByRole('navigation',{name:'商店導覽',exact:true}).getByRole('link',{name:'商店說明',exact:true}).click();
   await expect(bp.getByRole('region',{name:'商店說明與聯絡',exact:true})).toHaveText('商店說明與聯絡'+description);
   await expect(bp.locator('body')).not.toContainText('000000123456');
   expect(await bp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await bp.screenshot({path:info.outputPath('merchant-public-information-390.png'),fullPage:true});
  let lastCheckoutInput:unknown;
  bp.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith(`/stores/${store.slug}/checkouts`))lastCheckoutInput=request.postDataJSON();});
  await buyerLogin(bp,person.email,'',store.origin);
  await start(bp,store);await freeze(bp,store);const bank=await place(bp,'銀行匯款');
  const meetup=bp.getByRole('region',{name:'面交取貨',exact:true});
  await expect(meetup.locator('.shop-pay-label')).toHaveText('等待面交');
  await expect(meetup.getByText('店家會用你留下的手機或 Email 和你約時間地點。',{exact:true})).toBeVisible();
  await expect(meetup.getByText('請先約定時間，在山邊小店門口面交。',{exact:true})).toBeVisible();
  await expect(bp.getByRole('region',{name:'銀行匯款',exact:true})).not.toContainText('請先約定時間，在山邊小店門口面交。');
  await bp.emulateMedia({colorScheme:'light'});
  await bp.setViewportSize({width:390,height:900});
  expect(await bp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await bp.screenshot({path:info.outputPath('meetup-waiting-light-390.png'),fullPage:true});
  await expect(bp.getByRole('region',{name:'商店說明與聯絡',exact:true})).toHaveText('商店說明與聯絡'+description);
  await expect(bp.locator('body')).toContainText('000000123456');
  await sellerOrder(sp,store,bank);
  await expect(sp.getByText('下單時選擇：銀行匯款',{exact:true})).toBeVisible();
  await sellerScreens(sp,width=>info.outputPath(`seller-bank-confirm-form-${width}.png`));
  await recordOffline(sp,'確認收到匯款','350');
  await expect(sp.getByText('已收款（店家確認）',{exact:true}).first()).toBeVisible();
  // The existing expiry handler must retain an already paid allocation even when its due work is selected.
  await endOfflinePaymentWindow(e2eAuthPool,bank.order_ref,{now:()=>new Date(Date.now()+30*86400000)});
  expect((await e2eAuthPool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1',[store.products[0].product_id])).rows[0]).toEqual({stock:5,reserved:1});
  await bp.getByRole('button',{name:'更新訂單狀態',exact:true}).click();
  await expect(bp.getByText('店家已確認收到付款。',{exact:true})).toBeVisible();
  await expect(meetup.locator('.shop-pay-label')).toHaveText('等待面交');
  const handoverRequest=sp.waitForRequest(request=>request.method()==='POST'&&request.url().endsWith('/meetup-handover'));
  await recordOffline(sp,'確認已面交');
  const completedOn=(await handoverRequest).postDataJSON().completed_on as string;
  await expect(sp.getByText(/已登記面交：/)).toBeVisible();
  await sellerScreens(sp,width=>info.outputPath(`seller-bank-handover-${width}.png`));
  await buyer.clearCookies();await bp.goto('about:blank');await buyerLogin(bp,person.email,'',store.origin);
  await bp.goto(`${store.origin}/shops/${store.slug}/orders/${bank.order_ref}`);
  await expect(bp.getByText('店家已確認收到付款。',{exact:true})).toBeVisible();
  await expect(meetup.locator('.shop-pay-label')).toHaveText('已面交');
  await expect(meetup.getByText('店家已登記在 '+completedOn.replaceAll('-','/')+' 完成面交。',{exact:true})).toBeVisible();
  for(const width of [390,768,1440]){
   await bp.setViewportSize({width,height:900});
   expect(await bp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await bp.screenshot({path:info.outputPath('meetup-completed-light-'+width+'.png'),fullPage:true});
  }
  await bp.emulateMedia({colorScheme:'dark'});await bp.setViewportSize({width:390,height:900});
  expect(await bp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await bp.screenshot({path:info.outputPath('meetup-completed-dark-390.png'),fullPage:true});
  await bp.emulateMedia({colorScheme:'light'});
  await start(bp,store);await freeze(bp,store);const cash=await place(bp,'面交付款');
  await expect(meetup.locator('.shop-pay-label')).toHaveText('等待面交');
  await expect(meetup.getByText('店家會用你留下的手機或 Email 和你約時間地點。',{exact:true})).toBeVisible();
  await expect(meetup.getByText('請先約定時間，在山邊小店門口面交。',{exact:true})).toBeVisible();
  await expect(bp.getByRole('region',{name:'面交付款',exact:true})).not.toContainText('請先約定時間，在山邊小店門口面交。');
  await sellerOrder(sp,store,cash);
  const cashRequests:{key:string;body:string|null;version:string|undefined}[]=[];
  await sp.route('**/meetup-completion',async route=>{
   const request=route.request();cashRequests.push({key:request.headers()['idempotency-key'],body:request.postData(),version:request.headers()['if-match']});
   const response=await route.fetch();expect(response.status()).toBe(200);
   if(cashRequests.length===1)await route.abort('failed');else await route.fulfill({response});
  });
  await recordOffline(sp,'確認收現金並完成面交','350');
  await expect(sp.getByText('正在確認結果',{exact:true})).toBeVisible();
  await sp.getByRole('button',{name:/更新資料\s*：訂單詳情/}).click();
  await expect(sp.getByText(/已登記面交：/)).toBeVisible();
  await expect(sp.getByText('正在確認結果',{exact:true})).toBeVisible();
  await sp.getByRole('button',{name:'重試',exact:true}).click();
  await expect(sp.locator('.seller-announcement')).toContainText('已保存：確認收現金並完成面交。');
  await expect(sp.getByText('正在確認結果',{exact:true})).toHaveCount(0);
  expect(cashRequests).toHaveLength(2);expect(cashRequests[1]).toEqual(cashRequests[0]);
  for(const order of [bank,cash]){
   expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_offline_payments WHERE order_id=$1',[order.order_ref])).rows[0].n).toBe(1);
   expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_meetup_handovers WHERE order_id=$1',[order.order_ref])).rows[0].n).toBe(1);
  }
  expect((await e2eAuthPool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1',[store.products[0].product_id])).rows[0]).toEqual({stock:3,reserved:0});
  await bp.getByRole('button',{name:'更新訂單狀態',exact:true}).click();
  await expect(bp.getByText('店家已確認收到付款。',{exact:true})).toBeVisible();
  await expect(meetup.locator('.shop-pay-label')).toHaveText('已面交');
  const cashCompletedOn=JSON.parse(cashRequests[0].body!).completed_on as string;
  await expect(meetup.getByText('店家已登記在 '+cashCompletedOn.replaceAll('-','/')+' 完成面交。',{exact:true})).toBeVisible();
  // Existing seller cancellation remains reachable for an unpaid order and releases only its hold.
  await start(bp,store);await freeze(bp,store);const cancelled=await place(bp,'銀行匯款');
  await store.admission('/'+admission.admission_id+'/revoke',{reason:'合成停止新單，保留既有訂單處理'});
  await sellerOrder(sp,store,cancelled);await sp.getByRole('button',{name:'取消訂單',exact:true}).click();
  await sp.getByRole('dialog',{name:'取消訂單',exact:true}).getByRole('button',{name:'確認取消訂單',exact:true}).click();
  await expect(sp.getByRole('region',{name:'訂單',exact:true})).toContainText('已取消');
  await bp.getByRole('button',{name:'更新訂單狀態',exact:true}).click();
  await expect(bp.getByText(/訂單狀態：已取消/)).toBeVisible();
  await expect(meetup).toHaveCount(0);
  expect((await e2eAuthPool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1',[store.products[0].product_id])).rows[0]).toEqual({stock:3,reserved:0});
  await bp.goto(`${store.origin}/shops/${store.slug}/products/${store.products[0].sku}`);
  await expect(bp.getByRole('button',{name:'加入購物車',exact:true})).toHaveCount(0);
  await expect(bp.locator('body')).not.toContainText('000000123456');
  const refused=await buyer.request.post(`/api/v1/public/stores/${store.slug}/checkouts`,{headers:{Origin:store.origin,'Idempotency-Key':randomUUID()},data:lastCheckoutInput});
  expect(refused.status()).toBe(409);expect((await refused.json()).code).toBe('checkout_not_enabled');
  expect((await e2eAuthPool.query("SELECT count(*)::int AS n FROM platform_admin_audit WHERE target_type='commerce_store_admission' AND target_ref IN (SELECT admission_id::text FROM commerce_store_admissions WHERE tenant_id=$1 AND instance_id=$2)",[store.tenant,store.instance])).rows[0].n).toBe(2);
  expect((await e2eAuthPool.query("SELECT count(*)::int AS n FROM commerce_control_events WHERE instance_id=$1 AND kind LIKE 'store_admission.%'",[store.instance])).rows[0].n).toBe(2);
 }finally{await seller.close();await buyer.close();await store.close();}
});

test('seller settings refuse failed reads and stale drafts; meetup edits retain the rest of the shipping profile',async({browser,e2eAuthPool})=>{
 const store=await setupCartFixtureStore(e2eAuthPool,browser,true),context=await browser.newContext({baseURL:store.origin});
 context.setDefaultTimeout(15000);
 try{
  const ownerSession=await apiLogin(context,store.origin,store.seller.email);const page=await context.newPage(),other=await context.newPage();
  const location=await command(context,store.origin,ownerSession.csrf_token,store.root+'/ship-from-locations',{label:'合成退貨地點',sender_name:'合成店主',mobile:'0900123456',postal_code:'100',address:'台北市中正區測試路一段一號',ships:true,receives_returns:true});
  const existing=await (await context.request.get('/api/v1'+store.root+'/shipping-profile')).json();
  const retained={method:'home',fee_per_parcel_minor:8000,free_over_minor:200000,outlying:{kind:'surcharge',surcharge_per_parcel_minor:10000}};
  await command(context,store.origin,ownerSession.csrf_token,store.root+'/shipping-profile',{...existing.profile,working_days:[2,4,6],delivery_options:[...existing.profile.delivery_options,retained],drop_ship:{offered:false,fees:[],return_location_id:location.location_id,liability:'合成退貨責任說明',recipient_retention_days:14,accept_within_hours:24}},existing.version,'PUT');
  await page.route('**/offline-payment-settings',r=>r.fulfill({status:503,contentType:'application/json',json:{error:'synthetic_read_failure'}}));
  await page.goto(store.origin+'/'+sellerHash(store,'settings/payments'));
  await expect(page.getByText(/無法取得線下收款設定/)).toBeVisible();
  await expect(page.getByRole('button',{name:'編輯線下收款設定',exact:true})).toHaveCount(0);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_offline_payment_settings WHERE instance_id=$1',[store.instance])).rows[0].n).toBe(1);
  await page.unroute('**/offline-payment-settings');await page.getByRole('button',{name:/重試\s*：線下收款設定/}).click();
  await expect(page.getByRole('button',{name:'編輯線下收款設定',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'編輯線下收款設定',exact:true}).click();
  const payment=page.getByRole('form',{name:'線下收款設定',exact:true});
  await payment.getByLabel('收款帳號',{exact:true}).fill('------');
  await payment.getByRole('button',{name:'儲存線下收款設定',exact:true}).click();
  const invalid=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/offline-payment-settings'));
  await verifyPassword(page,DEMO_PASSWORD);expect((await invalid).status()).toBe(422);
  await expect(payment.getByRole('alert')).toContainText('收款帳號：請填寫 6–16 位數字');
  await payment.getByRole('alert').getByRole('link',{name:/收款帳號/}).click();
  await expect(payment.getByLabel('收款帳號',{exact:true})).toBeFocused();
  await expect(payment.getByLabel('收款帳號',{exact:true})).toHaveValue('------');
  await payment.getByLabel('收款帳號',{exact:true}).fill('000000123456');
  await payment.getByRole('button',{name:'儲存線下收款設定',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);
  await expect(payment).toHaveCount(0);
  const before=await (await context.request.get('/api/v1'+store.root+'/shipping-profile')).json();
  await page.getByRole('button',{name:'編輯面交取貨設定',exact:true}).click();
  const form=page.getByRole('form',{name:'面交取貨設定',exact:true});await form.getByLabel('面交地區與時段',{exact:true}).fill('這份舊草稿不能覆寫別頁。');
  await sellerSettings(other,store);await saveMeetup(other,'另一分頁已確認的新地點。');
  let writes=0;page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/shipping-profile'))writes++;});
  await page.route('**/shipping-profile',r=>r.request().method()==='GET'?r.fulfill({status:503,contentType:'application/json',json:{error:'synthetic_read_failure'}}):r.continue());
  const refusal=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/shipping-profile'));
  await form.getByRole('button',{name:'儲存面交取貨設定',exact:true}).click();expect((await refusal).status()).toBe(412);
  await expect(page.getByText('原操作未完成，等待重新取得伺服器資料後再確認。',{exact:true})).toBeVisible();
  await expect(form.getByRole('button',{name:'儲存面交取貨設定',exact:true})).toBeDisabled();
  await expect(page.getByText(/操作已完成/)).toHaveCount(0);expect(writes).toBe(1);
  await page.unroute('**/shipping-profile');await page.getByRole('button',{name:/重試\s*：操作後的資料/}).click();
  await expect(form.getByRole('alert')).toContainText('配送設定已由其他操作變更');
  await expect(form.getByLabel('面交地區與時段',{exact:true})).toHaveValue('這份舊草稿不能覆寫別頁。');
  await expect(form.getByRole('button',{name:'儲存面交取貨設定',exact:true})).toBeDisabled();
  await expect(page.getByText(/操作已完成/)).toHaveCount(0);expect(writes).toBe(1);
  const current=await (await context.request.get('/api/v1'+store.root+'/shipping-profile')).json();
  expect(current.profile).toEqual({...before.profile,delivery_options:[{method:'meetup',note:'另一分頁已確認的新地點。'},retained]});
  await form.getByRole('button',{name:'捨棄輸入，重新讀取設定',exact:true}).click();
  await expect(page.getByRole('button',{name:'編輯面交取貨設定',exact:true})).toBeEnabled();
  await saveMeetup(page,'重新核對後的新地點。');expect(writes).toBe(2);
 }finally{await context.close();await store.close();}
});

test('delegated seller sees masked settings and retains the original cash command through failed reads and revoked fulfil permission',async({browser,e2eAuthPool})=>{
 test.setTimeout(90000);
 const store=await setupCartFixtureStore(e2eAuthPool,browser,true),owner=await browser.newContext({baseURL:store.origin}),operator=await browser.newContext({baseURL:store.origin}),buyer=await browser.newContext({baseURL:store.origin});
 operator.setDefaultTimeout(15000);buyer.setDefaultTimeout(15000);
 try{
  const ownerSession=await apiLogin(owner,store.origin,store.seller.email),person=await member(e2eAuthPool);
  const candidate=await (await owner.request.get('/api/v1/tenants/invite-candidates?user_id='+person.id)).json();
  const capabilities=['store:read','store:manage','store:orders:read','store:orders:manage','store:fulfil','store:finance:read'];
  const invite=await command(owner,store.origin,ownerSession.csrf_token,'/tenants/'+store.tenant+'/invitations',{invitee_principal_id:candidate.principal_id,role:'operator',expires_at:new Date(Date.now()+86400000).toISOString(),instance_capabilities:[{instance_id:store.instance,capabilities}]});
  const operatorSession=await apiLogin(operator,store.origin,person.email);
  await command(operator,store.origin,operatorSession.csrf_token,'/tenants/'+store.tenant+'/invitations/'+invite.invitation_id+'/accept',{},invite.version);
  async function grant(keys:string[]){const members=await (await owner.request.get('/api/v1/tenants/'+store.tenant+'/members')).json(),membership=members.items.find((m:{principal_id:string})=>m.principal_id===candidate.principal_id);await command(owner,store.origin,ownerSession.csrf_token,'/tenants/'+store.tenant+'/members/'+candidate.principal_id+'/change',{role:'operator',status:'active',instance_capabilities:[{instance_id:store.instance,capabilities:keys}],reason:'Synthetic seller cash recovery'},membership.version);}
  const page=await operator.newPage(),bp=await buyer.newPage();
  await page.goto(store.origin+'/'+sellerHash(store,'settings/payments'));
  await expect(page.getByText('末四碼 3456',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'編輯線下收款設定',exact:true})).toHaveCount(0);
  await expect(page.getByText('000000123456',{exact:true})).toHaveCount(0);
  await openBuyer(e2eAuthPool,buyer,store);await start(bp,store);await freeze(bp,store);const cash=await place(bp,'面交付款');
  const orderPath='**/checkout-orders/'+cash.order_ref;
  await page.route(orderPath,r=>r.fulfill({status:503,contentType:'application/json',json:{error:'synthetic_read_failure'}}));
  await page.goto(store.origin+'/'+sellerHash(store,'orders/'+cash.order_ref));
  await expect(page.getByText(/無法取得訂單詳情/)).toBeVisible();
  await expect(page.getByRole('form',{name:'確認收現金並完成面交',exact:true})).toHaveCount(0);
  await page.unroute(orderPath);await page.getByRole('button',{name:/重試\s*：訂單詳情/}).click();
  const requests:{key:string;body:string|null;version:string|undefined}[]=[],statuses:number[]=[];
  await page.route('**/meetup-completion',async route=>{const request=route.request();requests.push({key:request.headers()['idempotency-key'],body:request.postData(),version:request.headers()['if-match']});const response=await route.fetch();statuses.push(response.status());if(requests.length===1)await route.abort('failed');else await route.fulfill({response});});
  await recordOffline(page,'確認收現金並完成面交','350');await expect(page.getByText('正在確認結果',{exact:true})).toBeVisible();
  await grant(capabilities.filter(capability=>capability!=='store:fulfil'));
  await page.getByRole('button',{name:'重試',exact:true}).click();
  await expect(page.getByRole('button',{name:'重新確認權限',exact:true})).toBeVisible();
  await expect(page.getByText('正在確認結果',{exact:true})).toBeVisible();
  await expect(page.locator('.seller-announcement')).not.toContainText('已保存');
  expect(statuses).toEqual([200,403]);expect(requests[1]).toEqual(requests[0]);
  await page.getByRole('button',{name:/更新資料\s*：訂單詳情/}).click();
  await expect(page.getByText(/已登記面交：/)).toBeVisible();await expect(page.getByText('正在確認結果',{exact:true})).toBeVisible();
  await grant(capabilities);await page.getByRole('button',{name:'重試',exact:true}).click();
  await expect(page.locator('.seller-announcement')).toContainText('已保存：確認收現金並完成面交。');
  await expect(page.getByText('正在確認結果',{exact:true})).toHaveCount(0);expect(statuses).toEqual([200,403,200]);expect(requests[2]).toEqual(requests[0]);
  await page.getByRole('button',{name:'重新確認權限',exact:true}).click();await expect(page.getByRole('button',{name:'重新確認權限',exact:true})).toHaveCount(0);
  const detail=SellerCheckoutOrderSchema.parse(await (await operator.request.get('/api/v1'+store.root+'/checkout-orders/'+cash.order_ref)).json());
  expect(detail.payment_detail?.offline_payments).toHaveLength(1);expect(detail.meetup_handover).not.toBeNull();expect(detail.actions.complete_meetup).toBe(false);
  expect((await e2eAuthPool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1',[store.products[0].product_id])).rows[0]).toEqual({stock:4,reserved:0});
 }finally{await owner.close();await operator.close();await buyer.close();await store.close();}
});


for(const outcome of ['committed','never committed','concurrent change'] as const)test(`expired settings proof recovers original command: ${outcome}`,async({browser,e2eAuthPool})=>{
 const store=await setupCartFixtureStore(e2eAuthPool,browser,true),context=await browser.newContext({baseURL:store.origin});
 try{
  await apiLogin(context,store.origin,store.seller.email);const page=await context.newPage();await sellerSettings(page,store);
  const expired=await expireNextSettingsProof(page,e2eAuthPool);
  const requests:{key:string;body:string|null;version:string|undefined;recovery:string|undefined}[]=[],statuses:number[]=[];
  let lostRecovery=false;
  await page.route('**/offline-payment-settings',async route=>{
   if(route.request().method()!=='PUT'){await route.continue();return;}
   const r=route.request(),headers=r.headers();requests.push({key:headers['idempotency-key'],body:r.postData(),version:headers['if-match'],recovery:headers['commerce-recovery-verification']});
   if(requests.length===1&&outcome!=='committed'){await route.abort('failed');return;}
   const response=await route.fetch();statuses.push(response.status());
   if(requests.length===1)expect(response.status(),await response.text()).toBe(200);
   if(requests.length===1||outcome==='committed'&&headers['commerce-recovery-verification']&&!lostRecovery){if(headers['commerce-recovery-verification'])lostRecovery=true;await route.abort('failed');}else await route.fulfill({response});
  });
  await page.getByRole('button',{name:'編輯線下收款設定',exact:true}).click();const form=page.getByRole('form',{name:'線下收款設定',exact:true});
  await form.getByLabel('匯款說明（選填）',{exact:true}).fill('續驗仍是同一份設定。');
  await form.getByRole('button',{name:'儲存線下收款設定',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);
  await expect(page.getByText('正在確認結果',{exact:true})).toBeVisible();await expired();
  if(outcome==='concurrent change')await store.saveOfflineFixture(2);
  await page.getByRole('button',{name:'重試',exact:true}).click();await expect(page.getByRole('dialog',{name:'驗證身分'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'驗證身分'})).not.toBeVisible();
  await expect(page.getByText('正在確認結果',{exact:true})).toBeVisible();await expect(form.getByRole('button',{name:'儲存線下收款設定',exact:true})).toBeDisabled();
  await expect(page.locator('.seller-announcement')).not.toContainText('已保存');expect(requests).toHaveLength(2);
  await page.getByRole('button',{name:'重試',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);
  if(outcome==='committed'){await expect.poll(()=>lostRecovery).toBe(true);await expect(page.getByText('正在確認結果',{exact:true})).toBeVisible();await page.getByRole('button',{name:'重試',exact:true}).click();}
  if(outcome==='concurrent change'){
   await expect(form.getByRole('alert')).toHaveText('設定已由其他操作變更。請捨棄這份輸入、重新讀取後再編輯；尚未覆寫設定。');await expect(page.locator('.seller-announcement')).not.toContainText('已保存');
   expect(statuses.at(-1)).toBe(412);
   const recovery=requests.at(-1)!.recovery;expect(recovery).toBeTruthy();expect((await e2eAuthPool.query('SELECT consumed_at IS NULL AS open FROM tenant_high_risk_verifications WHERE verification_id=$1',[recovery])).rows[0].open).toBe(true);
  }else{await expect(page.locator('.seller-announcement')).toContainText('已保存：線下收款設定。');await expect(form).toHaveCount(0);}
  const identity=({key,body,version}:typeof requests[number])=>({key,body,version});for(const request of requests)expect(identity(request)).toEqual(identity(requests[0]));
  expect(requests.at(-1)!.recovery).toBeTruthy();expect(requests.at(-1)!.recovery).not.toBe(JSON.parse(requests[0].body!).fresh_auth_verification_id);
  if(outcome==='committed')expect(requests.at(-1)!.recovery).toBe(requests.at(-2)!.recovery);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_offline_payment_settings WHERE instance_id=$1',[store.instance])).rows[0].n).toBe(2);
  expect((await e2eAuthPool.query("SELECT count(*)::int AS n FROM scoped_command_receipts WHERE operation='commerce.offline_payment_settings.save' AND idempotency_key=$1",[requests[0].key])).rows[0].n).toBe(outcome==='concurrent change'?0:1);
 }finally{await context.close();await store.close();}
});


async function portalCredentials(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.getByLabel('電子郵件', {exact: true}).fill(email);
  await page.getByLabel('密碼', {exact: true}).fill(password);
  await page.getByRole('button', {name: '登入', exact: true}).click();
}
async function fillBuyerContact(page: Page) {
  await page.getByLabel('收件人姓名', {exact: true}).fill('合成返回買家');
  await page.getByLabel('收件人手機', {exact: true}).fill('0900123456');
  await page.getByLabel('Email', {exact: true}).fill('return-buyer@example.test');
  await page.getByRole('radio', {name: '面交取貨', exact: true}).check();
  await expect(page.locator('#shop-checkout')).toHaveAttribute('aria-busy', 'false');
}

test('buyer journey returns a guest after real login, reconfirms identity and finishes bank checkout with frozen instructions', async ({browser, e2eAuthPool}, info) => {
  const store = await setupCartFixtureStore(e2eAuthPool, browser, true);
  const context = await browser.newContext({baseURL: store.origin});
  try {
    const person = await member(e2eAuthPool), page = await context.newPage();
    const writes: string[] = [];
    page.on('request', request => {if (request.method() === 'POST' && /\/checkouts(?:\/[^/]+\/orders)?$/.test(new URL(request.url()).pathname)) writes.push(request.postData()!);});
    await start(page, store);
    const cart = await page.evaluate(slug => localStorage.getItem(`freedom.shop.cart.v1:${slug}`), store.slug);
    // Returning to the tab with the same identity preserves typing and does
    // not spend another cart quote. Hold the real session response so the
    // assertions cover the entire pending check, then advance the debounce.
    let quoteRequests = 0;
    page.on('request', request => {if (request.url().endsWith('/cart-quotes')) quoteRequests++;});
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    for (const event of ['focus', 'visibilitychange'] as const) {
      let release!: () => void;
      const gate = new Promise<void>(resolve => {release = resolve;});
      const holdSession = async (route: Route) => {await gate; await route.continue();};
      await page.route('**/api/v1/session', holdSession);
      const session = page.waitForRequest(request => request.url().endsWith('/api/v1/session'));
      const response = page.waitForResponse(result => result.url().endsWith('/api/v1/session'));
      const name = page.getByLabel('收件人姓名', {exact: true});
      await name.focus();
      const beforeQuotes = quoteRequests;
      await page.evaluate(event => {
        if (event === 'focus') window.dispatchEvent(new Event('focus'));
        else document.dispatchEvent(new Event('visibilitychange'));
      }, event);
      await session;
      await expect(page.locator('#shop-checkout')).toHaveAttribute('aria-busy', 'true');
      await expect(name).toBeEnabled(); await expect(name).toBeFocused();
      await expect(name).toHaveValue('合成買家甲');
      await name.fill('合成買家甲');
      expect(quoteRequests).toBe(beforeQuotes);
      release(); await response;
      await expect(page.locator('#shop-checkout')).toHaveAttribute('aria-busy', 'false');
      await page.clock.runFor(350);
      await expect(name).toBeFocused(); await expect(name).toBeEnabled();
      expect(quoteRequests).toBe(beforeQuotes);
      await page.unroute('**/api/v1/session', holdSession);
    }
    await page.clock.resume();
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`buyer-guest-checkout-${width}.png`));
    await page.getByRole('link', {name: '登入會員', exact: true}).click();
    await expect(page.getByText('登入後會返回原本的商店頁面。', {exact: true})).toBeVisible();
    await portalCredentials(page, person.email);
    await expect(page).toHaveURL(`${store.origin}/shops/${store.slug}/checkout`);
    await expect(page.getByText('登入身分已變更，請重新確認', {exact: true})).toBeVisible();
    await expect(page.getByLabel('收件人姓名', {exact: true})).toHaveValue('');
    await expect(page.locator('#shop-checkout')).toHaveAttribute('aria-busy', 'false');
    expect(writes).toHaveLength(0);
    expect(await page.evaluate(slug => localStorage.getItem(`freedom.shop.cart.v1:${slug}`), store.slug)).toBe(cart);
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`buyer-return-notice-${width}.png`));
    await fillBuyerContact(page);
    // A background change must invalidate the quote even though a pending
    // same-identity read no longer toggles the form's blocked state.
    const session = await (await context.request.get('/api/v1/session')).json();
    const logout = await context.request.post('/api/v1/auth/logout', {headers: {Origin: store.origin, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': randomUUID()}, data: {}});
    expect(logout.status()).toBe(200);
    const guestQuote = page.waitForResponse(response => response.url().endsWith('/cart-quotes') && response.headers()['x-commerce-buyer'] === 'guest');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await guestQuote;
    await expect(page.getByText('登入身分已變更，請重新確認', {exact: true})).toBeVisible();
    await expect(page.getByLabel('收件人姓名', {exact: true})).toHaveValue('');
    await expect(page.getByLabel('Email', {exact: true})).toHaveValue('');
    await expect(page.locator('#shop-checkout')).toHaveAttribute('aria-busy', 'false');
    await fillBuyerContact(page);
    await apiLogin(context, store.origin, person.email);
    const memberQuote = page.waitForResponse(response => response.url().endsWith('/cart-quotes') && response.headers()['x-commerce-buyer'] === `member:${person.id}`);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await memberQuote;
    await expect(page.getByLabel('收件人姓名', {exact: true})).toHaveValue('');
    await expect(page.getByLabel('Email', {exact: true})).toHaveValue('');
    await expect(page.locator('#shop-checkout')).toHaveAttribute('aria-busy', 'false');
    expect(await page.evaluate(slug => localStorage.getItem(`freedom.shop.cart.v1:${slug}`), store.slug)).toBe(cart);
    expect(writes).toHaveLength(0);
    await fillBuyerContact(page);
    await freeze(page, store);
    const order = await place(page, '銀行匯款');
    expect(writes).toHaveLength(2);
    await expect(page.getByText('000000123456', {exact: true})).toBeVisible();
    await expect(page.locator('body')).toContainText(formatTaipeiDateTime(order.pay_by));
    await store.saveOfflineFixture(2);
    await page.reload();
    await expect(page.getByText('000000123456', {exact: true})).toBeVisible();
    await expect(page.getByText('新的面交地點。', {exact: true})).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toMatch(/000000123456|return-buyer@example.test/);
    await page.goto('/#reservations');
    const orders=page.getByRole('region',{name:'訂單',exact:true});
    await expect(orders.getByRole('link',{name:'開啟訂單',exact:true})).toHaveAttribute('href',`/shops/${store.slug}/orders/${order.order_ref}`);
    await orders.getByRole('link',{name:'開啟訂單',exact:true}).click();
    await expect(page).toHaveURL(`${store.origin}/shops/${store.slug}/orders/${order.order_ref}`);
    await expect(page.getByText('000000123456',{exact:true})).toBeVisible();
    await expect(page.locator('body')).toContainText(formatTaipeiDateTime(order.pay_by));
    await expect(page.getByText('000000654321',{exact:true})).toHaveCount(0);
  } finally {await context.close(); await store.close();}
});

test('checkout registration returns before guild choice; unavailable stores keep successful login and registration in the portal', async ({browser, e2eAuthPool}) => {
  const store = await setupCartFixtureStore(e2eAuthPool, browser, true);
  const context = await browser.newContext({baseURL: store.origin});
  try {
    const page = await context.newPage(), email = `buyer-registration-${randomUUID()}@example.test`;
    await start(page, store);
    await page.getByRole('link', {name: '登入會員', exact: true}).click();
    await page.getByRole('button', {name: '建立帳號', exact: true}).click();
    await expect(page.getByText('建立帳號後，會先確認並返回原本的商店頁面；選公會與完整定位可以稍後再做。', {exact: true})).toBeVisible();
    await page.getByLabel('電子郵件', {exact: true}).fill(email);
    await page.getByLabel('密碼', {exact: true}).fill(DEMO_PASSWORD);
    await page.getByRole('button', {name: '建立帳號，先逛工坊', exact: true}).click();
    await expect(page).toHaveURL(`${store.origin}/shops/${store.slug}/checkout`);
    await expect(page.getByText('登入身分已變更，請重新確認', {exact: true})).toBeVisible();
    const user = (await e2eAuthPool.query('SELECT user_id,onboarding_completed_at FROM users WHERE email=$1', [email])).rows[0];
    expect(user.onboarding_completed_at).toBeNull();
    expect((await e2eAuthPool.query('SELECT 1 FROM positioning_profession_memberships WHERE user_id=$1', [user.user_id])).rowCount).toBe(0);
    await page.goto('/#reservations');
    await expect(page.getByRole('region',{name:'訂單',exact:true})).toContainText('目前沒有訂單。');
    await expect(page.getByRole('region',{name:'預留紀錄',exact:true})).toHaveCount(0);
    expect((await context.request.get('/api/v1/me/orders')).status()).toBe(200);
    expect((await context.request.get('/api/v1/me/reservations')).status()).toBe(403);
    await page.getByRole('link',{name:'返回工坊',exact:true}).click();
    await expect(page).toHaveURL(`${store.origin}/#home`);
    await expect(page.getByRole('region',{name:'訂單',exact:true})).toHaveCount(0);
    const version = (await e2eAuthPool.query('SELECT version::text FROM commerce_storefront_profiles WHERE instance_id=$1', [store.instance])).rows[0].version;
    await store.sellerPost(store.root + '/unpublish', {}, 200, version);
    const destination = `/?return_to=${encodeURIComponent(`/shops/${store.slug}/checkout`)}`;
    await context.clearCookies(); await page.goto(destination);
    const returning = await member(e2eAuthPool);
    await portalCredentials(page, returning.email);
    await expect(page.getByText('登入成功。原本的商店目前無法確認或已停止公開，你仍可繼續逛工坊。', {exact: true})).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    await context.clearCookies(); await page.goto(destination);
    await page.getByRole('button', {name: '建立帳號', exact: true}).click();
    await page.getByLabel('電子郵件', {exact: true}).fill(`buyer-unpublished-${randomUUID()}@example.test`);
    await page.getByLabel('密碼', {exact: true}).fill(DEMO_PASSWORD);
    await page.getByRole('button', {name: '建立帳號，先逛工坊', exact: true}).click();
    await expect(page.getByText('帳號已建立。原本的商店目前無法確認或已停止公開，你仍可繼續逛工坊。', {exact: true})).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  } finally {await context.close(); await store.close();}
});

test('TOTP and backup login return only with a live session; cross-tab logout and another buyer cannot resume an old intent', async ({browser, e2eAuthPool}) => {
  const store = await setupCartFixtureStore(e2eAuthPool, browser, true, true, {totpEncryptionKey: Buffer.alloc(32, 0x74).toString('base64')});
  const context = await browser.newContext({baseURL: store.origin});
  try {
    const a = await member(e2eAuthPool), b = await member(e2eAuthPool);
    const session = await apiLogin(context, store.origin, a.email);
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const counter = Number((await e2eAuthPool.query('SELECT floor(extract(epoch FROM clock_timestamp())/30)::bigint AS counter')).rows[0].counter);
    const enabled = await context.request.post('/api/v1/me/totp/enable', {headers: {Origin: store.origin, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': randomUUID()}, data: {password: DEMO_PASSWORD, secret, code: totpCode(secret, counter)}});
    expect(enabled.status()).toBe(200);
    const codes = (await enabled.json()).backup_codes as string[];
    await context.clearCookies();
    const page = await context.newPage();
    await start(page, store); await page.getByRole('link', {name: '登入會員', exact: true}).click();
    await portalCredentials(page, a.email, DEMO_PASSWORD + '-wrong');
    await expect(page.getByRole('alert')).toBeVisible(); expect(new URL(page.url()).pathname).toBe('/');
    await portalCredentials(page, a.email);
    await expect(page.getByRole('textbox', {name: /^驗證器代碼或備用碼/})).toBeVisible();
    expect((await context.request.get('/api/v1/session')).status()).toBe(401);
    await page.getByRole('textbox', {name: /^驗證器代碼或備用碼/}).fill('invalid-synthetic-code');
    await page.getByRole('button', {name: '登入', exact: true}).click();
    await expect(page.getByRole('alert')).toBeVisible(); expect(new URL(page.url()).pathname).toBe('/');
    const now = Number((await e2eAuthPool.query('SELECT floor(extract(epoch FROM clock_timestamp())/30)::bigint AS counter')).rows[0].counter);
    await page.getByRole('textbox', {name: /^驗證器代碼或備用碼/}).fill(totpCode(secret, Math.max(counter + 1, now)));
    await page.getByRole('button', {name: '登入', exact: true}).click();
    await expect(page).toHaveURL(`${store.origin}/shops/${store.slug}/checkout`);
    await expect(page.getByText('登入身分已變更，請重新確認', {exact: true})).toBeVisible();
    const destination = `/?return_to=${encodeURIComponent(`/shops/${store.slug}/checkout`)}`;
    await context.clearCookies(); await page.goto(destination); await portalCredentials(page, a.email);
    await page.getByRole('textbox', {name: /^驗證器代碼或備用碼/}).fill(codes[0]);
    await page.getByRole('button', {name: '登入', exact: true}).click();
    await expect(page).toHaveURL(`${store.origin}/shops/${store.slug}/checkout`);
    await context.clearCookies(); await page.goto(destination); await portalCredentials(page, a.email);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;}), ready = new Promise<void>(resolve => {entered = resolve;});
    await page.route(`**/api/v1/public/stores/${store.slug}`, async route => {entered(); await gate; await route.continue();});
    await page.getByRole('textbox', {name: /^驗證器代碼或備用碼/}).fill(codes[1]);
    await page.getByRole('button', {name: '登入', exact: true}).click();
    await ready;
    const current = await (await context.request.get('/api/v1/session')).json();
    const other = await context.newPage();
    const logout = await other.request.post('/api/v1/auth/logout', {headers: {Origin: store.origin, 'X-CSRF-Token': current.csrf_token, 'Idempotency-Key': randomUUID()}, data: {}});
    expect(logout.status()).toBe(200); release();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    await other.close(); await page.unroute(`**/api/v1/public/stores/${store.slug}`);
    await apiLogin(context, store.origin, b.email);
    const oldRef = randomUUID(), oldClient = randomUUID(), posts: string[] = [];
    await page.evaluate(({slug, owner, ref, client}) => {
      sessionStorage.setItem(`freedom.shop.order-intent.v2:${slug}`, JSON.stringify({version: 2, slug, buyer: `member:${owner}`, checkoutRef: ref, input: {terms_sha256: 'a'.repeat(64), client_order_id: client, payment_method: 'bank_transfer'}}));
    }, {slug: store.slug, owner: a.id, ref: oldRef, client: oldClient});
    page.on('request', request => {if (request.method() === 'POST' && request.url().includes('/checkouts/')) posts.push(request.postData()!);});
    await page.goto(`/shops/${store.slug}/checkout`);
    await expect(page.getByText('登入身分已變更，請重新確認', {exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: '重試同一筆訂單', exact: true})).toHaveCount(0);
    await expect(page.locator('#shop-checkout')).toHaveAttribute('aria-busy', 'false'); expect(posts).toHaveLength(0);
  } finally {await context.close(); await store.close();}
});

test('delivery reasons name blocked supply items; removing them keeps own items buyable and offers only available alternatives', async ({browser, e2eAuthPool}, info) => {
  const supplier = await setupCartFixtureStore(e2eAuthPool, browser, true);
  const store = await setupCartFixtureStore(e2eAuthPool, browser, true);
  const context = await browser.newContext({baseURL: store.origin});
  const sellerContext = await browser.newContext({baseURL: store.origin});
  try {
    const source = supplier.products[0];
    const offer = SupplyOfferSchema.parse(await supplier.sellerPost(`${supplier.root}/products/${source.product_id}/supply-offer`, {}, 200, source.version));
    const selection = DistributionSchema.parse(await store.sellerPost(store.root + '/distribution-selections', {offer_id: offer.offer_id, terms_sha256: offer.terms_sha256, retail_price_minor: 10000}, 201));
    await supplier.sellerPost(`${supplier.root}/supply-requests/${selection.selection_id}/decision`, {decision: 'accepted', listing_sha256: selection.listing_sha256}, 200, selection.version);
    const projection = await store.republish(), own = store.products[1];
    const session = await apiLogin(sellerContext, store.origin, store.seller.email);
    const profile = await sellerContext.request.put('/api/v1' + store.root + '/shipping-profile', {headers: {Origin: store.origin, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': randomUUID(), 'If-Match': '"1"'}, data: {schema: 'freedom.shipping-profile/v1', working_days: [1,2,3,4,5], services: [], delivery_options: [{method: 'meetup', note: '請先約定面交。'}, {method: 'home', fee_per_parcel_minor: 6000, free_over_minor: null, outlying: {kind: 'excluded'}}], drop_ship: null}});
    expect(profile.status(), await profile.text()).toBe(200);
    await openBuyer(e2eAuthPool, context, store);
    const page = await context.newPage();
    await page.goto(`/shops/${store.slug}`);
    await page.evaluate(({slug, revision, lines}) => localStorage.setItem('freedom.shop.cart.v1:' + slug, JSON.stringify({revision, lines})), {slug: store.slug, revision: projection.revision, lines: [selection.sku, own.sku].map(sku => {const product = projection.products.find(p => p.sku === sku)!; return {sku, title: product.title, quantity: 1, price_minor: product.price_minor, currency: projection.currency};})});
    await page.goto(`/shops/${store.slug}/cart`);
    const suppliedLine = page.locator('.shop-cart-line').filter({hasText: source.title});
    await expect(suppliedLine).toContainText('目前無法配送');
    await expect(page.locator('.shop-cart-line').filter({hasText: own.title})).not.toContainText('目前沒有可用的取貨方式。');
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`buyer-cart-delivery-note-${width}.png`));
    await page.getByRole('link', {name: '前往結帳', exact: true}).click();
    await expect(page.getByRole('region', {name: '以下商品無法使用「面交取貨」：'})).toContainText(source.title + '：目前無法配送');
    await expect(page.getByText('這些商品目前無法一起配送，請回購物車調整或分開下單。', {exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: /^改用/})).toHaveCount(0);
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`buyer-delivery-blocked-${width}.png`));
    await page.getByRole('link', {name: '回購物車調整', exact: true}).click();
    await page.locator('.shop-cart-line').filter({hasText: source.title}).getByRole('button', {name: /移除/}).click();
    await expect(page.locator('.shop-cart-line')).toHaveCount(1);
    await page.getByRole('link', {name: '前往結帳', exact: true}).click();
    await expect(page.getByRole('button', {name: '改用面交取貨', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: '改用宅配', exact: true})).toHaveCount(0);
    await expect(page.getByRole('region', {name: '以下商品無法使用「宅配」：'})).toContainText(own.title);
    await assertCartResponsiveLayout(page, [390,768,1440], width => info.outputPath(`buyer-delivery-alternative-${width}.png`));
    await page.getByRole('button', {name: '改用面交取貨', exact: true}).click();
    await fillBuyerContact(page); await freeze(page, store);
    await expect(page.getByRole('region', {name: '2. 核對商品與配送'})).toContainText(own.title);
    await expect(page.getByRole('region', {name: '2. 核對商品與配送'})).not.toContainText(source.title);
  } finally {await context.close(); await sellerContext.close(); await store.close(); await supplier.close();}
});

test('VARIANTS-E2E each SKU keeps its stock and checkout/order labels survive a published group rename',async({browser,e2eAuthPool},info)=>{
 const store=await setupCartFixtureStore(e2eAuthPool,browser,true,true,{storeVariantsEnabled:true}),context=await browser.newContext({baseURL:store.origin});
 try{
  const a=await store.sellerPatch(store.root+'/products/'+store.products[0].product_id,{stock:1},store.products[0].version),b=await store.sellerPatch(store.root+'/products/'+store.products[1].product_id,{stock:2},store.products[1].version);
  const axes=[{key:randomUUID(),name:'顏色',values:[{key:randomUUID(),name:'白'},{key:randomUUID(),name:'黑'}]},{key:randomUUID(),name:'尺寸',values:[{key:randomUUID(),name:'M'}]}];
  const input={title:'經典 T 恤',description:'合成商品組介紹',axes,members:[{product_id:a.product_id,product_version:a.version,value_keys:[axes[0].values[0].key,axes[1].values[0].key]},{product_id:b.product_id,product_version:b.version,value_keys:[axes[0].values[1].key,axes[1].values[0].key]}],default_product_id:a.product_id,order:0};
  await store.sellerPut(store.root+'/product-groups/'+a.sku,input,'1');await store.republish();await openBuyer(e2eAuthPool,context,store);
  const page=await context.newPage();await start(page,store);const checkout=await freeze(page,store);expect(checkout.terms.items[0].title).toBe('經典 T 恤（白／M）');await expect(page.locator('#shop-checkout')).toContainText('經典 T 恤（白／M）');
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('variants-checkout-label-'+width+'.png'),fullPage:true});}
  const order=await place(page,'面交付款');expect(order.lines[0].title).toBe('經典 T 恤（白／M）');
  const group=await store.sellerGet(store.root+'/product-groups/'+a.sku);await store.sellerPut(store.root+'/product-groups/'+a.sku,{...input,title:'新版 T 恤'},group.version);await store.republish();
  await page.reload();await expect(page.locator('#shop-order')).toContainText('經典 T 恤（白／M）');await expect(page.locator('#shop-order')).not.toContainText('新版 T 恤');
  const seller=await store.sellerGet(store.root+'/checkout-orders/'+order.order_ref);expect(seller.lines[0].title).toBe('經典 T 恤（白／M）');
  await page.goto('/shops/'+store.slug+'/products/'+a.sku);await expect(page.locator('.shop-availability')).toContainText('此規格已售完');await expect(page.getByRole('button',{name:'加入購物車',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:/^顏色：黑/}).click();await expect(page.locator('#shop-add-to-cart')).toHaveAttribute('data-title','新版 T 恤（黑／M）');await page.getByRole('button',{name:'加入購物車',exact:true}).click();await page.getByRole('link',{name:'查看購物車',exact:true}).click();await expect(page.locator('#shop-cart')).toContainText('新版 T 恤（黑／M）');await expect(page.locator('#shop-cart')).toHaveAttribute('aria-busy','false');
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('variants-cart-label-'+width+'.png'),fullPage:true});}
  await page.getByRole('link',{name:'前往結帳',exact:true}).click();await page.getByLabel('收件人姓名',{exact:true}).fill('合成買家乙');await page.getByLabel('收件人手機',{exact:true}).fill('0900123456');await page.getByLabel('Email',{exact:true}).fill('variants-second@example.test');await page.getByRole('radio',{name:'面交取貨',exact:true}).check();await expect(page.locator('#shop-checkout')).toHaveAttribute('aria-busy','false');await freeze(page,store);const second=await place(page,'面交付款');expect(second.lines[0].title).toBe('新版 T 恤（黑／M）');
  expect((await e2eAuthPool.query('SELECT item_id,reserved FROM commerce_items WHERE item_id=ANY($1::uuid[]) ORDER BY item_id',[[a.product_id,b.product_id]])).rows.map(row=>row.reserved)).toEqual([1,1]);
 }finally{await context.close();await store.close();}
});

test('order bell tells an eligible seller reader about placement and opening it rechecks revoked authority',async({browser,e2eAuthPool},info)=>{
  const store=await setupCartFixtureStore(e2eAuthPool,browser,true,true,{commerceOrderNotificationsEnabled:true});
  const buyerContext=await browser.newContext({baseURL:store.origin}),readerContext=await browser.newContext({baseURL:store.origin});
  try{
    for(const context of [buyerContext,readerContext])await context.route(url=>url.origin!==store.origin,route=>route.abort());
    const reader=await member(e2eAuthPool),principal=randomUUID();
    await e2eAuthPool.query('INSERT INTO principals(principal_id,user_ref) VALUES($1,$2)',[principal,reader.id]);
    await e2eAuthPool.query("INSERT INTO tenant_memberships(tenant_id,principal_id,role,status,accepted_at) VALUES($1,$2,'operator','active',clock_timestamp())",[store.tenant,principal]);
    await e2eAuthPool.query(`INSERT INTO tenant_module_permissions(tenant_id,principal_id,instance_id,capabilities,status,granted_by_principal_id)
      SELECT $1,$2,$3,ARRAY['store:read','store:orders:read'],'active',principal_id FROM principals WHERE user_ref=$4`,[store.tenant,principal,store.instance,store.seller.id]);
    await apiLogin(readerContext,store.origin,reader.email);
    const readerPage=await readerContext.newPage();await readerPage.goto('/#home');
    await expect(readerPage.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
    const buyer=await openBuyer(e2eAuthPool,buyerContext,store),buyerPage=await buyerContext.newPage();
    await start(buyerPage,store);await freeze(buyerPage,store);const order=await place(buyerPage,'銀行匯款');
    await readerPage.locator('.notification-bell-trigger').click();
    const panel=readerPage.getByRole('region',{name:'最近通知'}),item=panel.locator('.notification-bell-item').filter({hasText:'新訂單待確認收款'});
    await expect(item).toBeVisible();await expect(item).toContainText(`「山邊小店」收到訂單 ${order.display_number}，等待銀行匯款；請至訂單頁查看。`);
    for(const hidden of ['000000123456','合成測試銀行','合成買家甲','offline-buyer@example.test','0900123456','350.00'])await expect(item).not.toContainText(hidden);
    await expect(readerPage.locator('img[src*="freedom-workshop.webp"]').first()).toBeVisible();
    await assertCartResponsiveLayout(readerPage,[390,768,1440],width=>info.outputPath(`notify-bell-${width}.png`));
    const detail=readerPage.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===`/api/v1${store.root}/checkout-orders/${order.order_ref}`);
    await item.focus();await readerPage.keyboard.press('Enter');expect((await detail).status()).toBe(200);
    await expect(readerPage).toHaveURL(`${store.origin}/#stores/${store.tenant}/${store.instance}/orders/${order.order_ref}`);
    await expect(readerPage.locator('.seller-console')).toContainText(order.display_number);
    await e2eAuthPool.query("UPDATE tenant_module_permissions SET capabilities=ARRAY['store:read'],version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND principal_id=$2",[store.tenant,principal]);
    expect((await readerContext.request.get(`/api/v1${store.root}/checkout-orders/${order.order_ref}`)).status()).toBe(403);
    const cancelled=buyerPage.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith(`/orders/${order.order_ref}/cancel`));
    await buyerPage.getByRole('button',{name:'取消訂單',exact:true}).click();
    await buyerPage.getByRole('dialog',{name:'要取消這筆訂單嗎？'}).getByRole('button',{name:'確認取消訂單',exact:true}).click();
    expect((await cancelled).status()).toBe(200);
    const ownerNotices=(await e2eAuthPool.query('SELECT kind FROM member_notifications WHERE recipient_ref=$1 AND source_key=$2',[store.seller.id,`commerce-order/v1/${order.order_ref}/buyer_cancelled`])).rows;
    expect(ownerNotices).toEqual([{kind:'commerce_order_buyer_cancelled'}]);
    expect((await e2eAuthPool.query('SELECT 1 FROM member_notifications WHERE recipient_ref=$1 AND source_key=$2',[reader.id,`commerce-order/v1/${order.order_ref}/buyer_cancelled`])).rowCount).toBe(0);
    const history=await(await readerContext.request.get('/api/v1/me/notifications')).json() as {items:{title:string;body:string}[]};
    expect(history.items.some(n=>n.title==='新訂單待確認收款'&&n.body.includes(order.display_number))).toBe(true);
    expect((await e2eAuthPool.query('SELECT 1 FROM member_notifications WHERE recipient_ref=$1 AND source_key LIKE $2',[buyer.id,`commerce-order/v1/${order.order_ref}/%`])).rowCount).toBe(0);
  }finally{await buyerContext.close();await readerContext.close();await store.close();}
});

test('buyer order notices open a fresh authorized B07 and the full history keeps its primary order action on phones',async({browser,e2eAuthPool},info)=>{
  const store=await setupCartFixtureStore(e2eAuthPool,browser,true,true,{commerceOrderNotificationsEnabled:true});
  const context=await browser.newContext({baseURL:store.origin});
  try{
    await context.route(url=>url.origin!==store.origin,route=>route.abort());
    await openBuyer(e2eAuthPool,context,store);const page=await context.newPage();
    await start(page,store);await freeze(page,store);const order=await place(page,'銀行匯款');
    await expect(page.getByText('店家確認收款後，按「更新訂單狀態」即可看到最新狀態。',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'更新訂單狀態',exact:true})).toHaveClass(/shop-button-secondary/);
    await assertCartResponsiveLayout(page,[390,768,1440],width=>info.outputPath(`notify-b07-${width}.png`));
    const date=(await e2eAuthPool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') d")).rows[0].d;
    const paid=SellerCheckoutOrderSchema.parse(await store.sellerPost(`${store.root}/checkout-orders/${order.order_ref}/offline-payments`,{amount_minor:order.total_minor,received_on:date},200,'1'));
    await expect(page.getByText('店家已確認收到付款。',{exact:true})).toHaveCount(0);
    const refreshed=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname.endsWith(`/orders/${order.order_ref}`));
    await page.getByRole('button',{name:'更新訂單狀態',exact:true}).click();expect((await refreshed).status()).toBe(200);
    await expect(page.getByText('店家已確認收到付款。',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'更新訂單狀態',exact:true})).toHaveCount(0);
    const portal=await context.newPage();await portal.goto('/#home');await openNotifications(portal);
    const history=portal.getByRole('region',{name:'最近通知'}),item=history.locator('li[data-notification]').filter({hasText:'店家已確認收款'});
    await expect(item.getByRole('heading',{name:'店家已確認收款',exact:true})).toBeVisible();
    const action=item.getByRole('button',{name:'查看我的訂單',exact:true});await expect(action).toHaveClass(/btn-primary/);
    await portal.setViewportSize({width:390,height:900});const bounds=await action.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.height).toBeGreaterThanOrEqual(44);expect(bounds!.width).toBeLessThan(300);
    await expect(portal.locator('img[src*="freedom-workshop.webp"]').first()).toBeVisible();
    await assertCartResponsiveLayout(portal,[390,768,1440],width=>info.outputPath(`notify-history-${width}.png`));
    await action.click();await expect(portal).toHaveURL(`${store.origin}/shops/${store.slug}/orders/${order.order_ref}`);
    await expect(portal.getByText('店家已確認收到付款。',{exact:true})).toBeVisible();
    await store.sellerPost(`${store.root}/checkout-orders/${order.order_ref}/meetup-handover`,{completed_on:date},200,paid.version);
    await portal.goto('/#home');await portal.locator('.notification-bell-trigger').click();
    const handover=portal.getByRole('region',{name:'最近通知'}).locator('.notification-bell-item').filter({hasText:'店家已登記交貨'});
    await expect(handover).toContainText(`「山邊小店」已登記訂單 ${order.display_number} 的面交交貨。`);
    await handover.click();await expect(portal).toHaveURL(`${store.origin}/shops/${store.slug}/orders/${order.order_ref}`);
    await expect(portal.getByText('店家已確認收到付款。',{exact:true})).toBeVisible();
    await expect(portal.getByRole('button',{name:'更新訂單狀態',exact:true})).toHaveCount(0);
  }finally{await context.close();await store.close();}
});

test('all store flags compose from owner setup through bank payment and meetup delivery', async ({browser, e2eAuthPool}, info) => {
  test.setTimeout(90_000);
  const listener = await openCartListener(e2eAuthPool, true, {
    realAdmission: true, adminAccess: true, supplierConsoleEnabled: true,
    storeAppearanceEnabled: true, storePoliciesEnabled: true, storeGalleryEnabled: true,
    storeVariantsEnabled: true, storeCategoriesEnabled: true, commerceOrderNotificationsEnabled: true,
  });
  const contexts: BrowserContext[] = [];
  try {
    const ownerContext = await browser.newContext({baseURL: listener.origin, viewport: {width: 1440, height: 900}});
    contexts.push(ownerContext);
    const buyerContext = await browser.newContext({baseURL: listener.origin});
    contexts.push(buyerContext);
    const adminContext = await browser.newContext({baseURL: listener.origin, extraHTTPHeaders: {'Cf-Access-Jwt-Assertion': E2E_AUTHOR_CLAIM_ADMIN_TOKEN}});
    contexts.push(adminContext);
    for (const context of contexts) {
      await context.route('**/*', route => new URL(route.request().url()).origin === listener.origin ? route.fallback() : route.abort());
    }
    const owner = await person(e2eAuthPool), buyer = await member(e2eAuthPool);
    await apiLogin(ownerContext, listener.origin, owner.email);
    await apiLogin(buyerContext, listener.origin, buyer.email);
    const op = await ownerContext.newPage(), bp = await buyerContext.newPage(), admin = await adminContext.newPage();
    const siteResponse = op.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/v1/site');
    await op.goto('/#stores');
    expect(await (await siteResponse).json()).toMatchObject({
      guild_launchpad_enabled: true, commerce_checkout_enabled: true, commerce_console_enabled: true,
      supplier_console_enabled: true, store_appearance_enabled: true, store_policies_enabled: true,
      store_gallery_enabled: true, store_variants_enabled: true, store_categories_enabled: true,
      hosted_store_photo_uploads_enabled: false,
    });
    // Only membership, installation and an empty store use fixture setup writes.
    const store = await launchStore(op, '合成果醬旅程空間'), slug = 'journey-' + randomUUID().slice(0, 12);
    const [, tenant, instance] = store.hash.split('/');
    const storeName = '合成果醬小店', businessName = '合成旅程商行';
    const description = '合成商店服務說明：交付與售後請聯絡本店。';
    const announcement = '合成果醬，先約面交。', meetupNote = '先聯絡約定合成面交時間。';
    await post(op, store.root + '/setup', {name: storeName, slug, currency: 'TWD'}, 201);
    await op.goto('/#' + store.hash);
    const reviewResponse = () => op.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/v1' + store.root + '/publication-review');

    await test.step('owner saves public information, policies and appearance', async () => {
      await storeArea(op, '商店資料');
      const form = op.getByRole('form', {name: '商店資料', exact: true});
      await form.getByLabel('商店介紹', {exact: true}).fill(description);
      await form.getByRole('button', {name: '儲存商店資料', exact: true}).click();
      await expect(op.locator('.hosted-store > [role="status"]')).toContainText('已儲存。');
      const policies = op.locator('.hosted-store-policies');
      for (const [label, value] of [
        ['營業名稱', businessName], ['聯絡 Email', 'journey-shop@example.test'],
        ['電話', '0900000000'], ['地址', '合成市測試路 1 號'], ['客服時間', '合成測試時段'],
      ]) await policies.getByLabel(label, {exact: true}).fill(value);
      for (const [label, body] of [
        ['配送政策', '合成配送政策：僅提供約定面交。'], ['退換貨政策', '合成退換貨政策：售後請聯絡本店。'],
        ['隱私政策', '合成隱私政策：資料僅供本次交付使用。'], ['服務條款', '合成服務條款：付款與交付由本店負責。'],
      ]) {
        const details = policies.locator('details').filter({has: op.locator('summary').filter({hasText: label})});
        if (!await details.evaluate(node => (node as HTMLDetailsElement).open)) await details.locator('summary').click();
        await policies.getByLabel(label + '內容', {exact: true}).fill(body);
      }
      await policies.getByRole('button', {name: '儲存賣方資訊與商店政策', exact: true}).click();
      await expect(policies.getByRole('status')).toContainText('已儲存賣方資訊與商店政策。');
      await storeArea(op, '店面與發布');
      const appearance = op.locator('.hosted-store-appearance');
      await appearance.getByRole('radio', {name: /^直列目錄/}).check();
      await appearance.getByRole('radio', {name: '海洋藍', exact: true}).check();
      await appearance.getByLabel('公告列', {exact: true}).fill(announcement);
      await appearance.getByRole('button', {name: '儲存店面外觀', exact: true}).click();
      await expect(appearance.getByRole('status')).toContainText('已儲存店面外觀');
    });

    const products = await test.step('owner creates and groups two variants through the editor', async () => {
      await storeArea(op, '商品');
      const created = [];
      for (const [flavor, price, stock] of [['草莓', '350', '1'], ['藍莓', '380', '3']]) {
        const form = op.getByRole('form', {name: '新增商品', exact: true});
        await form.getByLabel('商品名稱', {exact: true}).fill('合成' + flavor + '果醬');
        await form.getByLabel('商品介紹', {exact: true}).fill('合成手工果醬商品。');
        await form.getByLabel('價格（新臺幣 TWD）', {exact: true}).fill(price);
        await form.getByLabel('庫存', {exact: true}).fill(stock);
        const response = op.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1' + store.root + '/products');
        await form.getByRole('button', {name: '新增商品', exact: true}).click();
        const saved = await response;
        expect(saved.status()).toBe(201);
        created.push(ProductViewSchema.parse(await saved.json()));
        await expect(op.locator('.hosted-store-product').filter({has: op.getByRole('heading', {name: '合成' + flavor + '果醬', exact: true})})).toBeVisible();
      }
      const editor = op.locator('.store-variants-editor');
      await editor.getByLabel('規格商品', {exact: true}).selectOption(created[0].sku);
      await editor.getByLabel('商品組名稱', {exact: true}).fill('手工果醬');
      await editor.getByLabel('商品組介紹', {exact: true}).fill('合成手工果醬的兩種口味。');
      await editor.getByRole('button', {name: '新增選項', exact: true}).click();
      await editor.getByLabel('選項名稱（選項 1）', {exact: true}).fill('口味');
      await editor.getByLabel('選項值（選項 1，值 1）', {exact: true}).fill('草莓');
      await editor.getByRole('button', {name: '新增選項值', exact: true}).click();
      await editor.getByLabel('選項值（選項 1，值 2）', {exact: true}).fill('藍莓');
      await editor.getByLabel('加入現有商品', {exact: true}).selectOption(created[1].product_id);
      await editor.getByRole('button', {name: '加入商品組', exact: true}).click();
      await editor.getByLabel(created[1].sku + ' 口味', {exact: true}).selectOption({label: '藍莓'});
      await editor.getByRole('button', {name: '儲存規格', exact: true}).click();
      await expect(editor.getByRole('status')).toContainText('已儲存規格');
      return created;
    });
    const stock = async () => (await e2eAuthPool.query(
      `SELECT i.item_id,i.stock,i.reserved FROM commerce_items i
       JOIN commerce_storefront_profiles p ON p.supply_shop_id=i.shop_id
       WHERE p.tenant_id=$1 AND p.instance_id=$2 AND i.item_id=ANY($3::uuid[]) ORDER BY i.sku`,
      [tenant, instance, products.map(p => p.product_id)],
    )).rows;
    const expectedStock = (remaining: number, reserved: number) => [
      {item_id: products[0].product_id, stock: remaining, reserved},
      {item_id: products[1].product_id, stock: 3, reserved: 0},
    ];
    expect(await stock()).toEqual(expectedStock(1, 0));
    const review = await test.step('owner assigns the group to a category and reviews all five dimensions', async () => {
      const categories = op.locator('.store-categories-editor');
      await categories.getByLabel('分類名稱', {exact: true}).fill('合成果醬');
      await categories.getByRole('button', {name: '新增分類', exact: true}).click();
      await expect(categories.getByRole('status')).toContainText('已新增分類');
      await categories.getByRole('checkbox', {name: '手工果醬 · 2 個規格', exact: true}).check();
      const response = reviewResponse();
      await categories.getByRole('button', {name: '儲存分類商品', exact: true}).click();
      const current = StorePublicationReviewSchema.parse(await (await response).json());
      await expect(categories.getByRole('status')).toContainText('已儲存分類商品');
      expect(current).toMatchObject({appearance_changed: true, policies_changed: true, gallery_changed: true, variants_changed: true, categories_changed: true});
      // The acknowledgement precedes the parent's review refresh and leave guard.
      await expect(op.locator('.hosted-store-publication').getByRole('button', {name: '一鍵上架商品', exact: true})).toBeEnabled();
      return current;
    });

    await test.step('owner configures both offline methods and meetup, previews and publishes', async () => {
      await op.goto('/#' + store.hash + '/settings/payments');
      await op.getByRole('button', {name: '編輯線下收款設定', exact: true}).click();
      const payment = op.getByRole('form', {name: '線下收款設定', exact: true});
      await payment.getByLabel('提供銀行匯款', {exact: true}).check();
      for (const [label, value] of [['銀行代碼', '000'], ['銀行名稱', '合成測試銀行'], ['收款帳號', '000000123456'], ['戶名', businessName]]) {
        await payment.getByLabel(label, {exact: true}).fill(value);
      }
      await payment.getByLabel('提供面交現金付款', {exact: true}).check();
      await payment.getByRole('button', {name: '儲存線下收款設定', exact: true}).click();
      await verifyPassword(op, DEMO_PASSWORD);
      await expect(payment).toHaveCount(0);
      await saveMeetup(op, meetupNote);
      await op.goto('/#' + store.hash);
      await storeArea(op, '店面與發布');
      const panel = op.locator('#store-publish-panel');
      const popup = op.waitForEvent('popup');
      await panel.getByRole('link', {name: '預覽已儲存的展示頁', exact: true}).click();
      const preview = await popup;
      try {
        await expect(preview.locator('.shop-announcement')).toHaveText(announcement);
        await expect(preview.locator('.shop-products-list article')).toHaveCount(1);
        await expect(preview.getByRole('navigation', {name: '商品分類', exact: true})).toContainText('合成果醬');
      } finally {await preview.close();}
      await panel.getByText('查看本次上架內容', {exact: true}).click();
      for (const label of ['店面外觀', '賣方資訊與商店政策', '商品圖組', '規格', '商品分類']) {
        await expect(panel.locator('dl div').filter({has: op.locator('dt', {hasText: label})})).toContainText('有尚未發布的變更');
      }
      const publication = op.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1' + store.root + '/publish-reviewed');
      const refreshed = reviewResponse();
      await panel.getByRole('button', {name: '發布展示頁', exact: true}).click();
      const published = await publication;
      expect(published.status()).toBe(200);
      expect(published.request().postDataJSON()).toEqual({review_digest: review.review_digest});
      expect(StorePublicationReviewSchema.parse(await (await refreshed).json())).toMatchObject({
        appearance_changed: false, policies_changed: false, gallery_changed: false, variants_changed: false, categories_changed: false,
      });
      await expect(op.locator('.hosted-store > [role="status"]')).toContainText('已發布・第 1 版');
    });
    await test.step('independent operator admits the published store', async () => {
      await bp.goto('/shops/' + slug + '/products/' + products[0].sku);
      await expect(bp.getByRole('button', {name: '加入購物車', exact: true})).toHaveCount(0);
      await admin.goto('/admin');
      await admin.getByRole('button', {name: '商店准入', exact: true}).click();
      const admissions = admin.getByRole('region', {name: '商店准入', exact: true});
      const card = admissions.locator(`[data-store-instance="${instance}"]`);
      async function showStore() {
        const refresh = admissions.getByRole('button', {name: '更新', exact: true});
        await expect(refresh).toBeEnabled();
        while (await card.count() === 0) {
          const more = admissions.getByRole('button', {name: '載入更多商店', exact: true});
          await expect(more).toBeEnabled();
          await more.click();
          await expect(refresh).toBeEnabled();
        }
        await expect(card).toContainText(storeName);
      }
      await showStore();
      await card.getByRole('button', {name: '准入', exact: true}).click();
      await card.getByLabel('操作理由', {exact: true}).fill('合成本機全旗標購物旅程');
      await card.getByRole('button', {name: '確認准入', exact: true}).click();
      // Admission refreshes page one; this store may be on a later page in CI.
      await showStore();
      await expect(card.getByText('准入：有效', {exact: true})).toBeVisible();
    });

    async function buyerPresentation(stage: string) {
      await expect(bp.locator('body')).toHaveAttribute('data-store-appearance', 'v1');
      await expect(bp.locator('body')).toHaveAttribute('data-shop-accent', 'ocean');
      expect(await bp.locator('body').evaluate(node => getComputedStyle(node).getPropertyValue('--shop-accent').trim())).toBe('#1d4ed8');
      await expect(bp.locator('.shop-announcement')).toHaveText(announcement);
      await expect(bp.getByRole('region', {name: '商店說明與聯絡', exact: true})).toContainText(description);
      await expect(bp.getByRole('navigation', {name: '商店資訊與政策', exact: true})).toContainText('退換貨政策');
      await expect(bp.locator('.shop-footer')).toContainText('本店由' + businessName + '經營');
      await bp.evaluate(async () => {await document.fonts.ready;});
      await assertCartResponsiveLayout(bp, [390, 768, 1440], width => info.outputPath(`journey-${stage}-${width}.png`));
    }
    const order = await test.step('buyer navigates the category, switches variants and places a bank order', async () => {
      await bp.goto('/shops/' + slug);
      const categories = bp.getByRole('navigation', {name: '商品分類', exact: true});
      await categories.getByRole('link', {name: '合成果醬', exact: true}).click();
      await expect(categories.getByRole('link', {name: '合成果醬', exact: true})).toHaveAttribute('aria-current', 'page');
      expect(new URL(bp.url()).searchParams.get('category')).toMatch(/^[0-9a-f-]{36}$/);
      await expect(bp.locator('.shop-products-list article')).toHaveCount(1);
      await buyerPresentation('store');
      await bp.getByRole('link', {name: '查看商品：手工果醬', exact: true}).click();
      await bp.getByRole('link', {name: /^口味：藍莓/}).click();
      await expect(bp).toHaveURL(listener.origin + '/shops/' + slug + '/products/' + products[1].sku);
      await expect(bp.locator('#shop-add-to-cart')).toHaveAttribute('data-title', '手工果醬（藍莓）');
      await bp.getByRole('link', {name: /^口味：草莓/}).click();
      await expect(bp).toHaveURL(listener.origin + '/shops/' + slug + '/products/' + products[0].sku);
      await expect(bp.getByRole('navigation', {name: '配送與退換貨政策', exact: true})).toContainText('配送政策');
      const policy = bp.getByRole('navigation', {name: '配送與退換貨政策', exact: true}).getByRole('link', {name: '配送政策', exact: true});
      await policy.click();
      await expect(bp.locator('.shop-policy-text')).toHaveText('合成配送政策：僅提供約定面交。');
      await bp.goBack();
      await expect(bp.locator('#shop-add-to-cart')).toHaveAttribute('data-title', '手工果醬（草莓）');
      await buyerPresentation('product');
      await bp.getByRole('button', {name: '加入購物車', exact: true}).click();
      await bp.getByRole('link', {name: '查看購物車', exact: true}).click();
      await expect(bp.locator('#shop-cart')).toContainText('手工果醬（草莓）');
      await bp.getByRole('link', {name: '前往結帳', exact: true}).click();
      await bp.getByLabel('收件人姓名', {exact: true}).fill('合成旅程買家');
      await bp.getByLabel('收件人手機', {exact: true}).fill('0900000000');
      await bp.getByLabel('Email', {exact: true}).fill('journey-buyer@example.test');
      await bp.getByRole('radio', {name: '面交取貨', exact: true}).check();
      await expect(bp.locator('#shop-checkout')).toHaveAttribute('aria-busy', 'false');
      const checkout = await freeze(bp, {slug});
      expect(checkout.terms.items).toMatchObject([{sku: products[0].sku, title: '手工果醬（草莓）', quantity: 1, unit_price_minor: 35000}]);
      await expect(bp.getByRole('radio', {name: '面交付款', exact: true})).toBeEnabled();
      await bp.getByRole('radio', {name: '銀行匯款', exact: true}).check();
      await buyerPresentation('checkout');
      const placed = await place(bp, '銀行匯款');
      expect(placed.lines).toMatchObject([{sku: products[0].sku, title: '手工果醬（草莓）', quantity: 1}]);
      await expect(bp.getByText('000000123456', {exact: true})).toBeVisible();
      await expect(bp.getByText(meetupNote, {exact: true})).toBeVisible();
      await buyerPresentation('order');
      return placed;
    });
    expect(await stock()).toEqual(expectedStock(1, 1));
    await test.step('owner confirms bank receipt and hands over only the purchased variant', async () => {
      await op.goto('/#' + store.hash + '/orders');
      await op.locator(`[data-seller-order="${order.order_ref}"]`).click();
      await expect(op.getByRole('heading', {name: '訂單詳情：' + order.display_number, exact: true})).toBeVisible();
      const payment = op.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1' + store.root + '/checkout-orders/' + order.order_ref + '/offline-payments');
      await recordOffline(op, '確認收到匯款', '350');
      const paid = SellerCheckoutOrderSchema.parse(await (await payment).json());
      expect(paid.order_ref).toBe(order.order_ref);
      expect(paid.payment_state).toBe('confirmed');
      await expect(op.getByText('已收款（店家確認）', {exact: true}).first()).toBeVisible();
      expect(await stock()).toEqual(expectedStock(1, 1));
      const handover = op.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1' + store.root + '/checkout-orders/' + order.order_ref + '/meetup-handover');
      await recordOffline(op, '確認已面交');
      const delivered = SellerCheckoutOrderSchema.parse(await (await handover).json());
      expect(delivered.order_ref).toBe(order.order_ref);
      expect(delivered.payment_state).toBe('confirmed');
      expect(delivered.inventory_state).toBe('shipped');
      expect(delivered.meetup_handover).not.toBeNull();
      await expect(op.getByText(/已登記面交：/)).toBeVisible();
      expect(await stock()).toEqual(expectedStock(0, 0));
    });
    await test.step('buyer receives both updates and opens the same order from the member list', async () => {
      await bp.goto('/#home');
      await bp.locator('.notification-bell-trigger').click();
      const notices = bp.getByRole('region', {name: '最近通知', exact: true});
      for (const title of ['店家已確認收款', '店家已登記交貨']) {
        await expect(notices.locator('.notification-bell-item').filter({hasText: order.display_number}).filter({hasText: title})).toBeVisible();
      }
      await notices.locator('.notification-bell-item').filter({hasText: '店家已登記交貨'}).click();
      await expect(bp).toHaveURL(listener.origin + '/shops/' + slug + '/orders/' + order.order_ref);
      await expect(bp.getByText('店家已確認收到付款。', {exact: true})).toBeVisible();
      await bp.goto('/#reservations');
      const item = bp.getByRole('region', {name: '訂單', exact: true}).getByRole('article').filter({hasText: order.display_number});
      await expect(item).toContainText(storeName);
      await expect(item.getByRole('link', {name: '開啟訂單', exact: true})).toHaveAttribute('href', '/shops/' + slug + '/orders/' + order.order_ref);
      await item.getByRole('link', {name: '開啟訂單', exact: true}).click();
      await expect(bp.getByText('店家已確認收到付款。', {exact: true})).toBeVisible();
      // Delivery does not currently close the independent order lifecycle.
    });
    await test.step('later UI rename preserves the order label; only the other variant can be bought', async () => {
      await op.goto('/#' + store.hash);
      const editor = op.locator('.store-variants-editor');
      await expect(editor.getByLabel('商品組名稱', {exact: true})).toHaveValue('手工果醬');
      await editor.getByLabel('商品組名稱', {exact: true}).fill('季節果醬');
      await editor.getByRole('button', {name: '儲存規格', exact: true}).click();
      await expect(editor.getByRole('status')).toContainText('已儲存規格');
      const listing = op.locator('.hosted-store-publication');
      await listing.getByRole('button', {name: '一鍵上架商品', exact: true}).click();
      await expect(listing.getByRole('button', {name: '商品已全部上架', exact: true})).toBeDisabled();
      await bp.reload();
      await expect(bp.locator('.shop-order-line-title')).toHaveText('手工果醬（草莓）');
      await bp.goto('/shops/' + slug + '/products/' + products[0].sku);
      await expect(bp.locator('.shop-availability')).toContainText('此規格已售完');
      await expect(bp.getByRole('button', {name: '加入購物車', exact: true})).toHaveCount(0);
      await bp.getByRole('link', {name: /^口味：藍莓/}).click();
      await expect(bp).toHaveURL(listener.origin + '/shops/' + slug + '/products/' + products[1].sku);
      await expect(bp.locator('#shop-add-to-cart')).toHaveAttribute('data-title', '季節果醬（藍莓）');
      await bp.getByRole('button', {name: '加入購物車', exact: true}).click();
      await bp.getByRole('link', {name: '查看購物車', exact: true}).click();
      await expect(bp.locator('#shop-cart')).toContainText('季節果醬（藍莓）');
      expect(await stock()).toEqual(expectedStock(0, 0));
    });
  } finally {
    try {await Promise.all(contexts.map(context => context.close()));}
    finally {await listener.close();}
  }
});

// Self-ship runs through an owned loopback listener, never the global harness flag.
async function manualProfile(store:Store) {
 const current=await store.sellerGet(store.root+'/shipping-profile');
 return store.sellerPut(store.root+'/shipping-profile',{...current.profile,delivery_options:[...current.profile.delivery_options,{method:'self_ship',fee_per_order_minor:8000,handling_days:3,note:'使用郵局或黑貓。\n合成寄送說明。'}]},current.version);
}
async function manualOrder(context:BrowserContext,store:Store,name='合成收件人甲') {
 const checkout=await context.request.post(`/api/v1/public/stores/${store.slug}/checkouts`,{headers:{Origin:store.origin,'Idempotency-Key':randomUUID()},data:{publication_revision:store.revision,lines:[{sku:store.products[0].sku,quantity:1}],contact:{name,email:'synthetic-address@example.test',phone:'0900123456'},delivery:{method:'self_ship',name,mobile:'0900123456',postal_code:'100',address:'臺北市中正區合成路一號'},invoice:null,consents:[]}});
 expect(checkout.status(),await checkout.text()).toBe(201);const frozen=CheckoutResponseSchema.parse(await checkout.json());
 const placed=await context.request.post(`/api/v1/public/stores/${store.slug}/checkouts/${frozen.checkout_ref}/orders`,{headers:{Origin:store.origin},data:{client_order_id:randomUUID(),terms_sha256:frozen.terms_sha256,payment_method:'bank_transfer'}});
 expect(placed.status(),await placed.text()).toBe(201);return PlaceOrderResponseSchema.parse(await placed.json()).order;
}
async function manualScreens(page:Page,info:import('@playwright/test').TestInfo,name:string,portal=false) {
 const backgrounds:string[]=[];
 for(const [width,theme] of [[390,'light'],[768,'light'],[1440,'light'],[390,'dark']] as const){
  await page.bringToFront();await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  if(portal)await page.evaluate(t=>{document.documentElement.dataset.experienceProfile=t;document.documentElement.dataset.theme=t;localStorage.setItem('freedom-theme',t);},theme);
  // Let style changes create their transitions, then observe their completion.
  await page.evaluate(async()=>{await document.fonts.ready;});
  await page.evaluate(async()=>{await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
  const transitions=await page.evaluate(()=>({visibility:document.visibilityState,transitions:document.getAnimations().filter(a=>a instanceof CSSTransition&&a.transitionProperty.endsWith('color')).map(a=>{const effect=a.effect as KeyframeEffect,target=effect.target as Element|null;return {property:(a as CSSTransition).transitionProperty,state:a.playState,pending:a.pending,current:a.currentTime,duration:effect.getComputedTiming().duration,tag:target?.tagName,classes:target?.getAttribute('class'),visible:!!target?.getClientRects().length};})}));
  const {writeFile:writeTransitions}=await import('node:fs/promises');await writeTransitions(info.outputPath(`selfship-${name}-${theme}-${width}-transitions.json`),JSON.stringify(transitions,null,2)+'\n');
  await page.waitForFunction(()=>document.getAnimations().filter(animation=>animation instanceof CSSTransition&&animation.transitionProperty.endsWith('color')).every(animation=>animation.playState==='finished'||animation.playState==='idle'));
  const metrics=await page.evaluate((portal:boolean)=>{
   const visible=(e:Element)=>e.getClientRects().length>0;
   return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,body:{color:getComputedStyle(document.body).color,background:getComputedStyle(document.body).backgroundColor},buttons:[...document.querySelectorAll<HTMLElement>('.btn,.shop-button')].filter(visible).map(el=>{const r=el.getBoundingClientRect(),cs=getComputedStyle(el);return {inView:!!el.closest(portal?'.seller-console':'main'),text:el.textContent?.trim(),classes:el.className,x:r.x,y:r.y,width:r.width,height:r.height,color:cs.color,background:cs.backgroundColor,border:cs.borderColor,fontSize:parseFloat(cs.fontSize),parentWidth:el.parentElement!.getBoundingClientRect().width};}),inputs:[...document.querySelectorAll<HTMLInputElement>('input:not([type=radio]):not([type=checkbox]),select,textarea')].filter(visible).map(el=>({fontSize:parseFloat(getComputedStyle(el).fontSize),height:el.getBoundingClientRect().height})),primary:[...document.querySelectorAll('.btn-primary')].filter(el=>visible(el)&&!!el.closest(portal?'[data-seller-active="true"]':'main')).length};
  },portal);
  expect(metrics.scrollWidth,`${name} ${width} ${theme} overflow`).toBeLessThanOrEqual(width);
  for(const b of metrics.buttons.filter(b=>b.inView)){expect(b.height,b.text).toBeGreaterThanOrEqual(44);expect(b.fontSize,b.text).toBeGreaterThanOrEqual(14);expect(b.width,b.text).toBeLessThanOrEqual(b.parentWidth+1);}
  for(const input of metrics.inputs){expect(input.height).toBeGreaterThanOrEqual(44);if(width===390)expect(input.fontSize).toBeGreaterThanOrEqual(16);}
  const scope=portal?page.locator('[data-seller-active="true"]'):page.locator('main');
  expect(await scope.locator('.btn-primary:visible').count()).toBeLessThanOrEqual(1);
  if(name==='seller-shipment'){
   const address=await page.getByRole('region',{name:'收件資料',exact:true}).boundingBox(),form=await page.getByRole('form',{name:'登記出貨',exact:true}).boundingBox();expect(address).not.toBeNull();expect(form).not.toBeNull();
   if(width>=1100){expect(Math.abs(address!.y-form!.y)).toBeLessThanOrEqual(1);expect(address!.x+address!.width).toBeLessThanOrEqual(form!.x);}else expect(address!.y+address!.height).toBeLessThanOrEqual(form!.y);
  }
  const stem=`selfship-${name}-${theme}-${width}`;
  const {writeFile}=await import('node:fs/promises');await writeFile(info.outputPath(stem+'.json'),JSON.stringify(metrics,null,2)+'\n');
  await page.screenshot({path:info.outputPath(stem+'.png'),fullPage:true});backgrounds.push(metrics.body.background);
 }
 if(portal)expect(backgrounds[0],name+' theme must change computed background').not.toBe(backgrounds[3]);else expect(backgrounds[0],name+' storefront keeps its existing light palette under dark preference').toBe(backgrounds[3]);
}

test('SELFSHIP settings and checkout preserve profile, normalize address, quote postal changes and offer bank only',async({browser,e2eAuthPool},info)=>{
 const store=await setupCartFixtureStore(e2eAuthPool,browser,true,true,{commerceSelfShipEnabled:true}),seller=await browser.newContext({baseURL:store.origin}),buyer=await browser.newContext({baseURL:store.origin});
 try{
  await apiLogin(seller,store.origin,store.seller.email);const sp=await seller.newPage();await sellerSettings(sp,store);
  const original=await store.sellerGet(store.root+'/shipping-profile');
  await expect(sp.getByRole('button',{name:'編輯自行寄送設定',exact:true})).toHaveClass('btn btn-ghost btn-small');await sp.getByRole('button',{name:'編輯自行寄送設定',exact:true}).click();const form=sp.getByRole('form',{name:'自行寄送設定',exact:true});
  await form.getByLabel('提供宅配（店家自行寄送）',{exact:true}).check();await form.getByLabel('每單運費（NT$ 整數元）',{exact:true}).fill('80');await form.getByLabel('確認收款後幾個工作天內寄出',{exact:true}).fill('3');await form.getByLabel('寄送說明（選填）',{exact:true}).fill('使用郵局或黑貓。\n合成寄送說明。');
  await expect(form.getByRole('button',{name:'儲存自行寄送設定',exact:true})).toHaveClass('btn btn-primary');await manualScreens(sp,info,'settings',true);
  const settingsCommands:{key:string;body:string|null;version:string|undefined}[]=[];
  await sp.route('**/shipping-profile',async route=>{if(route.request().method()!=='PUT'){await route.continue();return;}const r=route.request();settingsCommands.push({key:r.headers()['idempotency-key'],body:r.postData(),version:r.headers()['if-match']});const response=await route.fetch();expect(response.ok(),await response.text()).toBe(true);if(settingsCommands.length===1)await route.abort('failed');else await route.fulfill({response});});
  await form.getByRole('button',{name:'儲存自行寄送設定',exact:true}).click();await expect(sp.getByText('正在確認結果',{exact:true})).toBeVisible();await sp.getByRole('button',{name:'重試',exact:true}).click();await expect(form).toHaveCount(0);expect(settingsCommands).toHaveLength(2);expect(settingsCommands[1]).toEqual(settingsCommands[0]);
  const saved=await store.sellerGet(store.root+'/shipping-profile');expect(saved.profile).toEqual({...original.profile,delivery_options:[...original.profile.delivery_options,{method:'self_ship',fee_per_order_minor:8000,handling_days:3,note:'使用郵局或黑貓。\n合成寄送說明。'}]});
  await sp.unroute('**/shipping-profile');await sp.getByRole('button',{name:'編輯自行寄送設定',exact:true}).click();await form.getByLabel('每單運費（NT$ 整數元）',{exact:true}).fill('90');
  await sp.setViewportSize({width:1440,height:900});let leavePrompt=false;sp.once('dialog',async dialog=>{leavePrompt=true;await dialog.dismiss();});await sp.getByRole('link',{name:'訂單',exact:true}).click();expect(leavePrompt).toBe(true);await expect(form).toBeVisible();
  await store.sellerPut(store.root+'/shipping-profile',saved.profile,saved.version);const stale=sp.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/shipping-profile'));await form.getByRole('button',{name:'儲存自行寄送設定',exact:true}).click();expect((await stale).status()).toBe(412);await expect(form.getByText('配送設定已由其他操作變更。請捨棄這份輸入、重新讀取後再編輯；尚未覆寫設定。',{exact:true})).toBeVisible();await expect(form.getByRole('button',{name:'儲存自行寄送設定',exact:true})).toBeDisabled();await form.getByRole('button',{name:'捨棄輸入',exact:true}).click();
  await openBuyer(e2eAuthPool,buyer,store);const bp=await buyer.newPage();await start(bp,store);await bp.getByRole('radio',{name:'宅配（店家自行寄送）',exact:true}).check();await bp.getByLabel('郵遞區號',{exact:true}).fill('100');await bp.getByLabel('收件地址',{exact:true}).fill('臺北市中正區合成路一號');
  await expect(bp.getByText('運費 $80.00',{exact:true})).toBeVisible();await expect(bp.getByText('商品與運費合計 $430.00',{exact:true})).toBeVisible();
  await manualScreens(bp,info,'checkout');
  let postalQuotes=0;bp.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/cart-quotes')&&r.postDataJSON().delivery?.postal_code==='200')postalQuotes++;});await bp.getByLabel('郵遞區號',{exact:true}).fill('200');await expect.poll(()=>postalQuotes).toBeGreaterThan(0);await expect(bp.locator('#shop-checkout')).toHaveAttribute('aria-busy','false');
  await bp.getByLabel('收件人手機',{exact:true}).fill('123');const invalid=bp.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/checkouts'));await bp.getByRole('button',{name:'核對訂單',exact:true}).click();expect((await invalid).status()).toBe(422);await expect(bp.getByLabel('收件人手機',{exact:true})).toBeFocused();await expect(bp.getByText('請檢查此欄位的格式。',{exact:true})).toBeVisible();await bp.getByLabel('收件人手機',{exact:true}).fill('0900123456');
  const frozen=await freeze(bp,store);expect(frozen.terms.shipping_total_minor).toBe(8000);expect(frozen.terms.total_minor).toBe(43000);expect(frozen.terms.payment_methods).toEqual(['bank_transfer']);
  await expect(bp.getByRole('radio',{name:'面交付款',exact:true})).toHaveCount(0);await expect(bp.getByRole('radio',{name:'信用卡',exact:true})).toHaveCount(0);await expect(bp.getByText('地址：200 臺北市中正區合成路一號',{exact:true})).toBeVisible();
  const order=await place(bp,'銀行匯款');const card=bp.getByRole('region',{name:'宅配（店家自行寄送）',exact:true});await expect(card.getByText('等待付款確認',{exact:true})).toBeVisible();await manualScreens(bp,info,'waiting-payment');expect(order.self_ship?.shipment).toBeNull();
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_self_shipments WHERE order_id=$1',[order.order_ref])).rows[0].n).toBe(0);
 }finally{await seller.close();await buyer.close();await store.close();}
});

test('SELFSHIP shipment confirmation retries one immutable command and buyer/seller show retained redacted shipment',async({browser,e2eAuthPool},info)=>{
 const store=await setupCartFixtureStore(e2eAuthPool,browser,true,true,{commerceSelfShipEnabled:true}),seller=await browser.newContext({baseURL:store.origin}),buyer=await browser.newContext({baseURL:store.origin});
 try{
  await manualProfile(store);await openBuyer(e2eAuthPool,buyer,store);const order=await manualOrder(buyer,store);await store.sellerPost(store.root+'/checkout-orders/'+order.order_ref+'/offline-payments',{amount_minor:43000,received_on:taipeiDate()},200,'1');
  const bp=await buyer.newPage();await bp.goto(`/shops/${store.slug}/orders/${order.order_ref}`);const card=bp.getByRole('region',{name:'宅配（店家自行寄送）',exact:true});await expect(card.getByText('等待出貨',{exact:true})).toBeVisible();await expect(card).toContainText('店家承諾於');await manualScreens(bp,info,'waiting-ship');
  await apiLogin(seller,store.origin,store.seller.email);const sp=await seller.newPage();await sellerOrder(sp,store,order);await sp.getByRole('button',{name:'顯示收件資料',exact:true}).click();await expect(sp.getByText('臺北市中正區合成路一號',{exact:true})).toBeVisible();
  const commands:{key:string;body:string|null;version:string|undefined}[]=[];await sp.route('**/self-shipments',async route=>{const r=route.request();commands.push({key:r.headers()['idempotency-key'],body:r.postData(),version:r.headers()['if-match']});const result=await route.fetch();expect(result.status(),await result.text()).toBe(200);if(commands.length===1)await route.abort('failed');else await route.fulfill({response:result});});
  await expect(sp.getByRole('button',{name:'登記出貨',exact:true})).toHaveClass('btn btn-ghost btn-small');await sp.getByRole('button',{name:'登記出貨',exact:true}).click();const form=sp.getByRole('form',{name:'登記出貨',exact:true});await form.getByLabel('物流業者',{exact:true}).selectOption('other');await form.getByLabel('物流業者名稱',{exact:true}).fill('合成私有物流');await form.getByLabel('物流單號',{exact:true}).fill('SYNTHETIC-123');await form.getByLabel('寄出日期',{exact:true}).fill(taipeiDate());
  await manualScreens(sp,info,'seller-shipment',true);await form.getByRole('button',{name:'登記出貨',exact:true}).click();const dialog=sp.getByRole('dialog',{name:'確認登記出貨',exact:true});await expect(dialog).toContainText('不能修改或撤銷');await expect(dialog.getByRole('button',{name:'返回核對',exact:true})).toHaveClass('btn btn-ghost btn-small');await expect(dialog.getByRole('button',{name:'確認登記出貨',exact:true})).toHaveClass('btn btn-primary');await manualScreens(sp,info,'shipment-confirm',true);expect(commands).toHaveLength(0);await dialog.getByRole('button',{name:'返回核對',exact:true}).click();expect(commands).toHaveLength(0);
  await form.getByRole('button',{name:'登記出貨',exact:true}).click();await dialog.getByRole('button',{name:'確認登記出貨',exact:true}).click();await expect(sp.getByText('正在確認結果',{exact:true})).toBeVisible();await sp.getByRole('button',{name:'重試',exact:true}).click();await expect(sp.getByText('已保存：登記出貨。',{exact:true})).toBeVisible();expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_self_shipments WHERE order_id=$1',[order.order_ref])).rows[0].n).toBe(1);expect((await e2eAuthPool.query("SELECT count(*)::int AS n FROM commerce_inventory_movements WHERE kind='ship' AND source_ref IN(SELECT shipment_id FROM commerce_self_shipments WHERE order_id=$1)",[order.order_ref])).rows[0].n).toBe(1);
  await bp.reload();await expect(card.getByText('已出貨',{exact:true})).toBeVisible();await expect(card).toContainText('SYNTHETIC-123');await manualScreens(bp,info,'sent');
  // Exercise PR-A's permitted one-way redaction transition with every trigger enabled.
  await isolatedTransaction(e2eAuthPool,async q=>{await q.query("SELECT set_config('app.tenant_id',$1,true)",[store.tenant]);await q.query('UPDATE commerce_checkout_contacts SET contact_name=NULL,contact_email=NULL,contact_phone=NULL,delivery=NULL,invoice=NULL,contact_salt=NULL,redacted_at=clock_timestamp() WHERE contact_id=(SELECT contact_id FROM commerce_checkout_orders WHERE order_id=$1)',[order.order_ref]);await q.query('UPDATE commerce_self_shipments SET tracking_number=NULL,carrier_name=NULL,redacted_at=clock_timestamp() WHERE order_id=$1',[order.order_ref]);});
  await bp.reload();await expect(card.getByText('已出貨',{exact:true})).toBeVisible();await expect(card).toContainText('物流業者：其他');await expect(bp.locator('body')).not.toContainText('SYNTHETIC-123');await expect(bp.locator('body')).not.toContainText('合成私有物流');await expect(bp.getByText('這筆訂單的聯絡資料已依保存期限遮罩。',{exact:true})).toBeVisible();await manualScreens(bp,info,'redacted');
  await sp.reload();await expect(sp.getByRole('region',{name:'自行寄送',exact:true}).getByText('已出貨',{exact:true})).toBeVisible();await sp.getByRole('button',{name:'顯示收件資料',exact:true}).click();await expect(sp.getByText('這筆訂單的聯絡資料已依保存期限遮罩。',{exact:true})).toBeVisible();await expect(sp.locator('body')).not.toContainText('SYNTHETIC-123');await expect(sp.locator('body')).not.toContainText('臺北市中正區合成路一號');
 }finally{await seller.close();await buyer.close();await store.close();}
});

test('SELFSHIP flag-off settings preserve saved option and late recipient reads never cross orders',async({browser,e2eAuthPool})=>{
 const store=await setupCartFixtureStore(e2eAuthPool,browser,true,true,{commerceSelfShipEnabled:true}),buyer=await browser.newContext({baseURL:store.origin}),seller=await browser.newContext({baseURL:store.origin});let off:Awaited<ReturnType<typeof openCartListener>>|undefined,offContext:BrowserContext|undefined,releasePending=()=>{};
 try{
  off=await openCartListener(e2eAuthPool,true);offContext=await browser.newContext({baseURL:off.origin});await apiLogin(offContext,off.origin,store.seller.email);const op=await offContext.newPage();await sellerSettings(op,{...store,origin:off.origin});await expect(op.locator('.seller-console')).not.toContainText('自行寄送');await op.goto(off.origin+'/'+sellerHash(store,'settings'));await expect(op.locator('.seller-console')).not.toContainText('自行寄送');
  const saved=await manualProfile(store);await op.goto(off.origin+'/'+sellerHash(store,'settings/payments'));await expect(op.getByText('目前尚未開放新的自行寄送設定。',{exact:true})).toBeVisible();await expect(op.getByRole('button',{name:'編輯自行寄送設定',exact:true})).toHaveCount(0);let changed=0;op.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/shipping-profile'))changed++;});await saveMeetup(op,'合成唯讀旗標仍保留自行寄送。');expect(changed).toBe(1);const after=await store.sellerGet(store.root+'/shipping-profile');expect(after.profile.delivery_options.find((o:{method:string})=>o.method==='self_ship')).toEqual(saved.profile.delivery_options.find((o:{method:string})=>o.method==='self_ship'));
  await openBuyer(e2eAuthPool,buyer,store);const a=await manualOrder(buyer,store,'合成收件人甲'),b=await manualOrder(buyer,store,'合成收件人乙');await apiLogin(seller,store.origin,store.seller.email);const sp=await seller.newPage();await sellerOrder(sp,store,a);
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;releasePending=resolve;});let entered!:()=>void;const requested=new Promise<void>(resolve=>{entered=resolve;});await sp.route('**/checkout-orders/'+a.order_ref+'/contact',async route=>{const response=await route.fetch();entered();await gate;await route.fulfill({response});});
  await sp.getByRole('button',{name:'顯示收件資料',exact:true}).click();await requested;await sp.getByRole('link',{name:'返回訂單',exact:true}).click();await sp.goto(store.origin+'/'+sellerHash(store,'orders/'+b.order_ref));await expect(sp.getByRole('heading',{name:'訂單詳情：'+b.display_number,exact:true})).toBeVisible();release();await sp.getByRole('button',{name:'顯示收件資料',exact:true}).click();await expect(sp.getByText('合成收件人乙',{exact:true})).toBeVisible();await expect(sp.locator('body')).not.toContainText('合成收件人甲');await expect(sp.getByRole('button',{name:'隱藏收件資料',exact:true})).toHaveClass('btn btn-ghost btn-small');await sp.getByRole('button',{name:'隱藏收件資料',exact:true}).click();await expect(sp.getByText('合成收件人乙',{exact:true})).toHaveCount(0);
  await sp.route('**/checkout-orders/'+b.order_ref+'/contact',route=>route.fulfill({status:503,contentType:'application/json',json:{error:'synthetic_contact_read_failure'}}));await sp.getByRole('button',{name:'顯示收件資料',exact:true}).click();await expect(sp.getByText('無法讀取收件資料，請重新確認權限後再試。',{exact:true})).toBeVisible();await expect(sp.locator('body')).not.toContainText('合成收件人乙');
  let unintended=0;sp.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/self-shipments'))unintended++;});await expect(sp.getByRole('button',{name:'登記出貨',exact:true})).toHaveCount(0);expect(unintended).toBe(0);
  const bp=await buyer.newPage();await start(bp,store,'合成唯讀旗標仍保留自行寄送。');await bp.getByRole('radio',{name:'宅配（店家自行寄送）',exact:true}).check();await bp.getByLabel('郵遞區號',{exact:true}).fill('100');await bp.getByLabel('收件地址',{exact:true}).fill('不應保留的合成地址');const next=await member(e2eAuthPool);await apiLogin(buyer,store.origin,next.email);await bp.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(bp.getByLabel('收件人姓名',{exact:true})).toHaveValue('');await expect(bp.getByLabel('收件人手機',{exact:true})).toHaveValue('');await bp.getByRole('radio',{name:'宅配（店家自行寄送）',exact:true}).check();await expect(bp.getByLabel('收件地址',{exact:true})).toHaveValue('');await expect(bp.getByLabel('郵遞區號',{exact:true})).toHaveValue('');

 }finally{releasePending();await offContext?.close();await off?.close();await seller.close();await buyer.close();await store.close();}
});
