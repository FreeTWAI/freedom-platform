import {openCartListener} from './storefront-cart-fixture.js';
import {setupStorefrontOrderStore,seedStorefrontOrder} from './storefront-order-fixture.js';
import {setupE2ePayment} from './hosted-payment-fixture.js';
import type {Route} from '@playwright/test';
import {test, expect, type Page} from './fixtures.js';
import {navigate} from './navigation.js';
import {buyerLogin, apiLogin, enableStore, fixtureStore as reservationFixtureStore, offListener} from './hosted-order-fixture.js';
import {ReadinessSchema} from '../../contracts/guild-launchpad/v1/hosted-order.js';
import {ReservationOrderSchema as OrderSchema,type ReservationOrder as HostedOrder} from '../../contracts/guild-launchpad/v1/hosted-shared-order.js';

const fixtureStore:typeof reservationFixtureStore=async(db,browser,origin)=>{const store=await reservationFixtureStore(db,browser,origin);await setupE2ePayment(db,browser,origin,store);return store;};

const surface = (page: Page) => page.locator('.hosted-store');
function gate<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
function tuple(route: Route) {const request = route.request(); return {body: request.postData(), key: request.headers()['idempotency-key'], version: request.headers()['if-match']};}
async function openShop(page: Page, slug: string) {
  await page.evaluate(value => {window.location.hash = `reservations/${value}`;}, slug);
  await expect(surface(page).getByRole('heading', {name: '山邊小店', exact: true})).toBeVisible();
}
async function review(page: Page) {
  await surface(page).getByLabel('手作茶杯數量').fill('2');
  await surface(page).getByRole('button', {name: '查看預留內容', exact: true}).click();
  await expect(page.getByRole('region', {name: '確認預留內容'})).toContainText('非應付金額');
  await expect(surface(page)).toContainText('目前尚未預留庫存');
}
async function guardAttempts(page: Page, hash: string) {
  await navigate(page, '會員首頁'); await expect(page).toHaveURL(new RegExp(hash + '$'));
  // Build a same-document prior location and use a real popstate/back event.
  await page.evaluate(value => new Promise<void>(resolve => {
    history.pushState(null, '', '#home'); history.pushState(null, '', value);
    window.addEventListener('popstate', () => resolve(), {once: true}); history.back();
  }), hash);
  await expect(page).toHaveURL(new RegExp(hash + '$'));
  await page.evaluate(() => new Promise<void>(resolve => {window.addEventListener('hashchange', () => resolve(), {once: true}); window.location.hash = 'skills';}));
  await expect(page).toHaveURL(new RegExp(hash + '$'));
  await page.getByRole('button', {name: '設定', exact: true}).click();
  await page.getByRole('menuitem', {name: '登出', exact: true}).click();
  await expect(page).toHaveURL(new RegExp(hash + '$'));
  await expect(surface(page)).toContainText('請先確認原操作結果');
  const settings = page.getByRole('button', {name: '設定', exact: true});
  if (await settings.getAttribute('aria-expanded') === 'true') await settings.click();
}

test('HO-UI01 explicit browser admission still requires store opt-in; omitted host option remains OFF', async ({page, browser, baseURL, e2eAuthPool}) => {
  test.setTimeout(90000);
  const s = await fixtureStore(e2eAuthPool, browser, baseURL!);
  await buyerLogin(page, s.buyer.email, `#reservations/${s.slug}`);
  await expect(surface(page)).toContainText('商品僅供展示');
  await expect(surface(page).getByRole('button', {name: '查看預留內容', exact: true})).toHaveCount(0);
  const notReady = ReadinessSchema.parse(await (await page.request.get(`/api/v1/hosted-stores/${s.slug}/order-readiness`)).json());
  expect(notReady.reservation_enabled).toBe(false);
  await enableStore(e2eAuthPool, s.instance);
  await page.reload();
  // No conditional skip: forgetting the candidate webServer injection fails here.
  await expect(surface(page).getByRole('button', {name: '查看預留內容', exact: true})).toBeEnabled();
  expect(ReadinessSchema.parse(await (await page.request.get(`/api/v1/hosted-stores/${s.slug}/order-readiness`)).json()).reservation_enabled).toBe(true);
  const off = await offListener(e2eAuthPool, true), context = await browser.newContext();
  try {
    const offPage = await context.newPage(); await buyerLogin(offPage, s.buyer.email, `#reservations/${s.slug}`, off.origin);
    await expect(surface(offPage)).toContainText('商品僅供展示');
    await expect(surface(offPage).getByRole('button', {name: '查看預留內容', exact: true})).toHaveCount(0);
    const response = await context.request.get(`${off.origin}/api/v1/hosted-stores/${s.slug}/order-readiness`);
    expect(response.status()).toBe(200); expect(ReadinessSchema.parse(await response.json()).reservation_enabled).toBe(false);
  } finally {try {await context.close();} finally {await off.close();}}
});

test('HO-UI02 committed unreadable submit retains exact tuple and guards; fresh login restores, stranger denied; cancel stale ACK stays unknown', async ({page, browser, baseURL, e2eAuthPool}, testInfo) => {
  test.setTimeout(120000);
  const s = await fixtureStore(e2eAuthPool, browser, baseURL!); await enableStore(e2eAuthPool, s.instance);
  await buyerLogin(page, s.buyer.email, '#home'); await openShop(page, s.slug); await review(page);
  expect((await e2eAuthPool.query('SELECT reserved FROM commerce_items WHERE item_id=$1', [s.product.product_id])).rows[0].reserved).toBe(0);
  const committed = gate<HostedOrder>(), release = gate<void>();
  const sent: ReturnType<typeof tuple>[] = []; let damage = true;
  const path = `**/api/v1/hosted-stores/${s.slug}/reservation-orders`;
  await page.route(path, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    sent.push(tuple(route)); const response = await route.fetch(); expect([200, 201]).toContain(response.status());
    const value = OrderSchema.parse(await response.json());
    if (damage) {damage = false; committed.resolve(value); await release.promise; await route.fulfill({response, json: {}});}
    else await route.fulfill({response});
  });
  let original!: HostedOrder;
  try {
    await surface(page).getByRole('button', {name: '確認預留 30 分鐘', exact: true}).click();
    original = await committed.promise;
    const intentHash = `#reservations/${s.slug}/intent/${original.client_order_id}`;
    await expect(page).toHaveURL(new RegExp(intentHash + '$'));
    await guardAttempts(page, intentHash);
    release.resolve();
    await expect(surface(page).getByRole('button', {name: '重試原操作'})).toBeEnabled();
    await guardAttempts(page, intentHash);
    // A NEW cookie session can only GET this exact intent; never auto-submits after login.
    const fresh = await browser.newContext({baseURL});
    try {
      const freshPage = await fresh.newPage(); let posts = 0;
      freshPage.on('request', request => {if (request.method() === 'POST' && request.url().endsWith(`/hosted-stores/${s.slug}/reservation-orders`)) posts++;});
      await buyerLogin(freshPage, s.buyer.email, intentHash);
      await expect(freshPage.getByRole('region', {name: '我的預留'})).toContainText('預留中');
      await expect(freshPage.getByLabel('預留編號', {exact: true})).toHaveValue(original.order_id); expect(posts).toBe(0);
    } finally {await fresh.close();}
    await surface(page).getByRole('button', {name: '重試原操作'}).click();
    await expect(page.getByRole('region', {name: '我的預留'})).toContainText('預留中');
    expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]); expect(sent[0].key).toBeTruthy();
    expect(JSON.parse(sent[0].body!).client_order_id).toBe(original.client_order_id);
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_orders WHERE client_order_id=$1', [original.client_order_id])).rows[0].n).toBe(1);
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_order_lines WHERE order_id=$1', [original.order_id])).rows[0].n).toBe(1);
    expect((await e2eAuthPool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1', [s.product.product_id])).rows[0]).toEqual({stock: 4, reserved: 2});
  } finally {release.resolve(); await page.unroute(path);}
  const stranger = await browser.newContext({baseURL});
  try {
    const other = await stranger.newPage(); await buyerLogin(other, s.stranger.email, `#reservations/order/${original.order_id}`);
    await expect(surface(other)).toContainText('查不到屬於你的這筆預留');
    expect((await other.request.get(`/api/v1/me/reservations/${original.order_id}`)).status()).toBe(404);
    expect((await other.request.get(`/api/v1/me/reservations/by-intent/${original.client_order_id}?store_slug=${s.slug}`)).status()).toBe(404);
    await expect(other.getByRole('region', {name: '我的預留'})).toHaveCount(0);
  } finally {await stranger.close();}
  // Real cancellation commits before a canonical OLD reserved acknowledgement is substituted.
  const cancelled = gate<void>(), releaseCancel = gate<void>(), cancellations: ReturnType<typeof tuple>[] = [];
  let damageCancel = true;
  const cancelPath = `**/api/v1/me/reservations/${original.order_id}/cancel`;
  await page.route(cancelPath, async route => {
    cancellations.push(tuple(route)); const response = await route.fetch(); expect(response.status()).toBe(200);
    expect(OrderSchema.parse(await response.json()).state).toBe('cancelled');
    if (damageCancel) {damageCancel = false; cancelled.resolve(); await releaseCancel.promise; await route.fulfill({response, json: original});}
    else await route.fulfill({response});
  });
  try {
    page.once('dialog', dialog => dialog.accept());
    await surface(page).getByRole('button', {name: '取消預留', exact: true}).click(); await cancelled.promise;
    const orderHash = `#reservations/order/${original.order_id}`; await guardAttempts(page, orderHash);
    releaseCancel.resolve(); await expect(surface(page).getByRole('button', {name: '重試原操作'})).toBeEnabled();
    await guardAttempts(page, orderHash);
    // A canonical old own GET also cannot clear the unknown cancel tuple.
    const ownPath = `**/api/v1/me/reservations/${original.order_id}`;
    await page.route(ownPath, async route => {const response = await route.fetch(); expect(OrderSchema.parse(await response.json()).state).toBe('cancelled'); await route.fulfill({response, json: original});});
    try {await surface(page).getByRole('button', {name: '查詢原預留'}).click(); await expect(surface(page).getByRole('button', {name: '重試原操作'})).toBeEnabled(); await guardAttempts(page, orderHash);}
    finally {await page.unroute(ownPath);}
    await surface(page).getByRole('button', {name: '重試原操作'}).click();
    await expect(page.getByRole('region', {name: '我的預留'})).toContainText('已取消');
    expect(cancellations).toHaveLength(2); expect(cancellations[1]).toEqual(cancellations[0]); expect(cancellations[0].body).toBe('{}'); expect(cancellations[0].version).toBe(`"${original.version}"`);
    expect((await e2eAuthPool.query('SELECT reservation_state,reservation_version::text FROM commerce_orders WHERE order_id=$1', [original.order_id])).rows[0]).toEqual({reservation_state: 'cancelled', reservation_version: '2'});
    expect((await e2eAuthPool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1', [s.product.product_id])).rows[0]).toEqual({stock: 4, reserved: 0});
    for (const theme of ['light', 'dark']) for (const width of [360, 768, 1440]) {
      await page.evaluate(value => {localStorage.setItem('freedom-theme', value); document.documentElement.dataset.theme = value; document.documentElement.dataset.experienceProfile = value; window.dispatchEvent(new Event('freedom-theme-changed'));}, theme); await page.setViewportSize({width, height: 900});
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path: testInfo.outputPath(`reservation-${theme}-${width}.png`)});
    }
    await page.setViewportSize({width: 1440, height: 900}); await navigate(page, '會員首頁'); await expect(page).toHaveURL(/#home$/);
  } finally {releaseCancel.resolve(); await page.unroute(cancelPath);}
});

test('HO-UI03 both host flags OFF retain own lookup and cancellation through real fresh login', async ({page, browser, baseURL, e2eAuthPool}) => {
  test.setTimeout(90000);
  const s = await fixtureStore(e2eAuthPool, browser, baseURL!); await enableStore(e2eAuthPool, s.instance);
  await buyerLogin(page, s.buyer.email, `#reservations/${s.slug}`); await review(page);
  await surface(page).getByRole('button', {name: '確認預留 30 分鐘', exact: true}).click();
  await expect(page.getByRole('region', {name: '我的預留'})).toContainText('預留中');
  const id = await page.getByLabel('預留編號', {exact: true}).inputValue();
  const original = OrderSchema.parse(await (await page.request.get(`/api/v1/me/reservations/${id}`)).json());
  const off = await offListener(e2eAuthPool, false), context = await browser.newContext();
  try {
    const offPage = await context.newPage();
    await buyerLogin(offPage, s.buyer.email, `#reservations/${s.slug}/intent/${original.client_order_id}`, off.origin);
    await expect(offPage.getByRole('region', {name: '我的預留'})).toContainText('預留中');
    expect((await context.request.get(`${off.origin}/api/v1/hosted-stores/${s.slug}/order-readiness`)).status()).toBe(404);
    offPage.once('dialog', dialog => dialog.accept()); await surface(offPage).getByRole('button', {name: '取消預留', exact: true}).click();
    await expect(offPage.getByRole('region', {name: '我的預留'})).toContainText('已取消');
    await offPage.reload(); await expect(offPage.getByRole('region', {name: '我的預留'})).toContainText('已取消');
    await navigate(offPage, '會員首頁'); await navigate(offPage, '購買與預留紀錄');
    await offPage.getByLabel('預留編號', {exact: true}).fill(id); await surface(offPage).getByRole('button', {name: '查詢我的預留', exact: true}).click();
    await expect(offPage.getByRole('region', {name: '我的預留'})).toContainText('已取消');
    expect((await e2eAuthPool.query('SELECT reserved FROM commerce_items WHERE item_id=$1', [s.product.product_id])).rows[0].reserved).toBe(0);
    expect((await e2eAuthPool.query('SELECT reservation_version::text FROM commerce_orders WHERE order_id=$1', [id])).rows[0].reservation_version).toBe('2');
  } finally {try {await context.close();} finally {await off.close();}}
});

test('buyer order list follows next page and isolates another account', async ({page, browser, baseURL, e2eAuthPool}) => {
  test.setTimeout(90000);
  const s = await fixtureStore(e2eAuthPool, browser, baseURL!); await enableStore(e2eAuthPool, s.instance);
  const context = await browser.newContext({baseURL});
  try {
    const session = await apiLogin(context, baseURL!, s.buyer.email);
    const post = async (path: string, data: unknown, status: number, version?: string) => {
      const response = await context.request.post('/api/v1' + path, {data, headers: {
        Origin: baseURL!, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': crypto.randomUUID(),
        ...(version ? {'If-Match': `"${version}"`} : {}),
      }});
      expect(response.status(), await response.text()).toBe(status); return response.json();
    };
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const quote = await post(`/hosted-stores/${s.slug}/reservation-quotes`, {publication_revision: '1', items: [{sku: s.product.sku, quantity: 1}]}, 201);
      const order = await post(`/hosted-stores/${s.slug}/reservation-orders`, {quote_id: quote.quote_id, terms_sha256: quote.terms_sha256, client_order_id: crypto.randomUUID()}, 201);
      ids.push(order.order_id);
      await post(`/me/reservations/${order.order_id}/cancel`, {}, 200, order.version);
    }
    // Exercise the real server's bounded page option without exhausting the
    // production mutation rate limit or mocking any response/authority.
    await page.route(url => url.pathname === '/api/v1/me/reservations', async route => {
      const url = new URL(route.request().url()); url.searchParams.set('limit', '1');
      await route.continue({url: url.toString()});
    });
    await buyerLogin(page, s.buyer.email, '#reservations');
    const list = page.getByRole('region', {name: '預留紀錄'});
    await expect(list.getByRole('link', {name: '查看訂單', exact: true})).toHaveCount(1);
    await page.setViewportSize({width: 390, height: 844});
    await expect(list.getByRole('button', {name: '下一頁', exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await list.getByRole('button', {name: '下一頁', exact: true}).click();
    await expect(list.getByRole('link', {name: '查看訂單', exact: true})).toHaveCount(1);
    await expect(list.getByRole('link', {name: '查看訂單', exact: true})).toHaveAttribute('href', `#reservations/order/${ids[0]}`);
    await expect(list.getByRole('button', {name: '下一頁', exact: true})).toHaveCount(0);
    await list.getByRole('link', {name: '查看訂單', exact: true}).click();
    await expect(page.getByRole('region', {name: '我的預留'})).toContainText('已取消');
    const other = await browser.newContext({baseURL});
    try {
      const strangerPage = await other.newPage(); await buyerLogin(strangerPage, s.stranger.email, '#reservations');
      await expect(strangerPage.getByRole('region', {name: '預留紀錄'})).toContainText('目前沒有預留紀錄。');
      await expect(strangerPage.getByRole('link', {name: '查看訂單', exact: true})).toHaveCount(0);
    } finally {await other.close();}
  } finally {await context.close();}
});

// Undo only the four declared checkout-ON differences before comparing the full v1 DOM.
function originalReservationsHTML(element: Element) {
  const copy=element.cloneNode(true) as HTMLElement,heading=copy.firstElementChild;
  if(heading?.tagName!=='H2'||heading.textContent!=='預留紀錄')throw Error('Missing separate reservations heading.');
  heading.remove();
  const lookup=copy.querySelector('section[aria-label="預留紀錄"]');
  if(!lookup||lookup.querySelector('h2'))throw Error('Unexpected reservations lookup heading.');
  lookup.setAttribute('aria-label','我的訂單');
  const originalHeading=document.createElement('h2');originalHeading.textContent='我的訂單';lookup.prepend(originalHeading);
  const empty=lookup.querySelector(':scope > p');
  if(empty){
    if(empty.textContent!=='目前沒有預留紀錄。')throw Error('Unexpected reservations empty state.');
    empty.textContent='目前沒有訂單。';
  }
  return copy.outerHTML;
}

test('checkout orders region loads, empties, retries and pages above the separate reservations region',async({page,browser,baseURL,e2eAuthPool},info)=>{
  const store=await setupStorefrontOrderStore(e2eAuthPool,browser,baseURL!),listener=await openCartListener(e2eAuthPool),context=await browser.newContext({baseURL});
  const release=gate<void>();let hold=true,fail=false;
  try {
    // One real v1 reservation gives the legacy region a fixed heading, role and row count.
    const session=await apiLogin(context,baseURL!,store.buyer.email);
    const post=async(path:string,data:unknown,status:number,version?:string)=>{
      const response=await context.request.post('/api/v1'+path,{data,headers:{Origin:baseURL!,'X-CSRF-Token':session.csrf_token,'Idempotency-Key':crypto.randomUUID(),...(version?{'If-Match':`"${version}"`}:{})}});
      expect(response.status(),await response.text()).toBe(status);return response.json();
    };
    const quote=await post(`/hosted-stores/${store.slug}/reservation-quotes`,{publication_revision:store.revision,items:[{sku:store.product.sku,quantity:1}]},201);
    const reservation=await post(`/hosted-stores/${store.slug}/reservation-orders`,{quote_id:quote.quote_id,terms_sha256:quote.terms_sha256,client_order_id:crypto.randomUUID()},201);
    await post(`/me/reservations/${reservation.order_id}/cancel`,{},200,reservation.version);
    await page.route(url=>url.pathname==='/api/v1/me/orders',async route=>{
      if(hold){hold=false;await release.promise;}
      if(fail){fail=false;return route.fulfill({status:503,json:{type:'about:blank',title:'internal_error',status:503,code:'internal_error',detail:'合成讀取失敗'}});}
      const url=new URL(route.request().url());url.searchParams.set('limit','1');await route.continue({url:url.toString()});
    });
    await buyerLogin(page,store.buyer.email,'#reservations',listener.origin);
    const orders=page.getByRole('region',{name:'訂單',exact:true}),legacy=page.getByRole('region',{name:'預留紀錄',exact:true});
    await expect(orders).toContainText('正在讀取訂單…');
    await expect(page.getByRole('heading',{name:'我的訂單',exact:true})).toHaveCount(1);
    await expect(page.getByRole('heading',{name:'我的訂單',exact:true,level:1})).toBeVisible();
    await expect(orders.getByRole('heading',{name:'訂單',exact:true,level:2})).toBeVisible();
    const reservationsHeading=page.getByRole('heading',{name:'預留紀錄',exact:true,level:2});
    await expect(reservationsHeading).toBeVisible();
    await expect(legacy.getByRole('heading',{level:2})).toHaveCount(0);
    expect(await reservationsHeading.evaluate(heading=>heading.nextElementSibling?.getAttribute('role'))).toBe('note');
    await expect(legacy.getByRole('link',{name:'查看訂單',exact:true})).toHaveCount(1);
    await expect(legacy.getByRole('button',{name:'重新整理／第一頁',exact:true})).toBeEnabled();
    const originalLegacy=await legacy.locator('..').evaluate(element=>element.outerHTML);
    const expectedOffLegacy=await legacy.locator('..').evaluate(originalReservationsHTML);
    release.resolve();await expect(orders).toContainText('目前沒有訂單。');
    fail=true;await orders.getByRole('button',{name:'重新整理／第一頁',exact:true}).click();
    await expect(orders.getByRole('alert')).toHaveText('無法取得訂單，請稍後重試。');
    await expect(orders.getByRole('link',{name:'開啟訂單',exact:true})).toHaveCount(0);
    const first=await seedStorefrontOrder(e2eAuthPool,store,{buyerUserId:store.buyer.id,cancelReason:'buyer_cancelled'});
    const second=await seedStorefrontOrder(e2eAuthPool,store,{buyerUserId:store.buyer.id,cancelReason:'buyer_cancelled'});
    await orders.getByRole('button',{name:'重新載入訂單',exact:true}).click();
    await expect(orders.getByRole('link',{name:'開啟訂單',exact:true})).toHaveAttribute('href',second.orderPath);
    await expect(orders).toContainText('已取消（你取消了訂單）');
    await orders.getByRole('button',{name:'下一頁',exact:true}).click();
    await expect(orders.getByRole('link',{name:'開啟訂單',exact:true})).toHaveAttribute('href',first.orderPath);
    await expect(orders.getByRole('button',{name:'下一頁',exact:true})).toHaveCount(0);
    expect(await legacy.locator('..').evaluate(element=>element.outerHTML)).toBe(originalLegacy);
    const off=await offListener(e2eAuthPool,true),offContext=await browser.newContext();
    try {
      const offPage=await offContext.newPage();await buyerLogin(offPage,store.buyer.email,'#reservations',off.origin);
      await expect(offPage.getByRole('region',{name:'訂單',exact:true})).toHaveCount(0);
      const old=offPage.getByRole('region',{name:'我的訂單',exact:true});await expect(old.getByRole('link',{name:'查看訂單',exact:true})).toHaveCount(1);
      await expect(old.getByRole('heading',{name:'我的訂單',exact:true,level:2})).toBeVisible();
      await expect(offPage.getByRole('heading',{name:'預留紀錄',exact:true})).toHaveCount(0);
      await expect(old.getByRole('button',{name:'重新整理／第一頁',exact:true})).toBeEnabled();
      expect(await old.locator('..').evaluate(element=>element.outerHTML)).toBe(expectedOffLegacy);
      // A buyer with checkout orders and no v1 reservations must see an unambiguous empty state.
      const checkoutOnly=await seedStorefrontOrder(e2eAuthPool,store,{buyerUserId:store.stranger.id,cancelReason:'buyer_cancelled'});
      const emptyContext=await browser.newContext(),emptyOffContext=await browser.newContext();
      try {
        const emptyPage=await emptyContext.newPage();await buyerLogin(emptyPage,store.stranger.email,'#reservations',listener.origin);
        const emptyOrders=emptyPage.getByRole('region',{name:'訂單',exact:true}),emptyLegacy=emptyPage.getByRole('region',{name:'預留紀錄',exact:true});
        await expect(emptyOrders.getByRole('link',{name:'開啟訂單',exact:true})).toHaveAttribute('href',checkoutOnly.orderPath);
        await expect(emptyLegacy.getByText('目前沒有預留紀錄。',{exact:true})).toBeVisible();
        await expect(emptyLegacy.getByText('目前沒有訂單。',{exact:true})).toHaveCount(0);
        await expect(emptyLegacy.getByRole('button',{name:'重新整理／第一頁',exact:true})).toBeEnabled();
        const expectedEmptyOff=await emptyLegacy.locator('..').evaluate(originalReservationsHTML);
        const emptyOffPage=await emptyOffContext.newPage();await buyerLogin(emptyOffPage,store.stranger.email,'#reservations',off.origin);
        const oldEmpty=emptyOffPage.getByRole('region',{name:'我的訂單',exact:true});
        await expect(oldEmpty.getByText('目前沒有訂單。',{exact:true})).toBeVisible();
        await expect(oldEmpty.getByRole('button',{name:'重新整理／第一頁',exact:true})).toBeEnabled();
        expect(await oldEmpty.locator('..').evaluate(element=>element.outerHTML)).toBe(expectedEmptyOff);
        // Screenshots may leave an empty inline caret style; take them after strict DOM comparisons.
        await expect(emptyPage.getByRole('heading',{name:'我的訂單',exact:true})).toHaveCount(1);
        const heading=emptyPage.getByRole('heading',{name:'預留紀錄',exact:true,level:2});
        expect(await heading.evaluate(element=>element.nextElementSibling?.getAttribute('role'))).toBe('note');
        for(const width of [390,768,1440]){
          await emptyPage.setViewportSize({width,height:900});expect(await emptyPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
          await emptyPage.screenshot({path:info.outputPath(`member-orders-${width}.png`),fullPage:true});
        }
      } finally {await emptyContext.close();await emptyOffContext.close();}
    } finally {await offContext.close();await off.close();}
  } finally {release.resolve();await context.close();await listener.close();}
});
