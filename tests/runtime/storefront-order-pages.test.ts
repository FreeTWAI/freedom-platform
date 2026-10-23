import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {PublicOrder} from '../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {MeetupCard} from '../../apps/portal-web/src/storefront/meetup-card.js';
import {OfflineOrder} from '../../apps/portal-web/src/storefront/offline-order.js';
import { createApp } from '../../apps/platform-api/src/app.js';
import { storeMissingHtml } from '../../modules/agent-commerce/hosted/page.js';
import { orderAccessPageHtml, orderMissingHtml, orderPageHtml } from '../../modules/agent-commerce/storefront/pages.js';
import { formatCalendarDate, formatTaipeiDateTime } from '../../apps/portal-web/src/storefront/format.js';
import { orderEmailNote, type PaymentView } from '../../apps/portal-web/src/storefront/payment-view.js';
import { checkoutHarness, ok, type CheckoutHarness } from './hosted-checkout-harness.js';
import { TENANT_CURSOR_TEST_KEY } from './tenant-cursor-fixture.js';

let x: CheckoutHarness;

async function accessCounts() {
  return (
    await x.h.pool.query<{ devices: number; grants: number }>(
      'SELECT (SELECT count(*)::int FROM commerce_access_devices) AS devices, (SELECT count(*)::int FROM commerce_order_access_grants) AS grants',
    )
  ).rows[0];
}

before(async () => {
  x = await checkoutHarness('fc_storefront_pages');
});

beforeEach(async () => {
  await x.reset();
});

after(async () => {
  await x?.stop();
});

test('meetup card renders waiting and recorded states across payment methods and retained lifecycles', () => {
  const time = '2028-02-29T12:34:56.789Z';
  const order: PublicOrder = {
    order_ref: randomUUID(), display_number: '280229-ABCDEF', store: {slug: 'synthetic-shop', name: '合成商店'},
    created_at: time, pay_by: time, reservation_expired: false, lifecycle_state: 'open', cancel_reason: null, currency: 'TWD',
    lines: [{sku: 'P0001', title: '合成商品', options: [], quantity: 1, unit_price_minor: 100, line_total_minor: 100}],
    merchandise_total_minor: 100, discount_total_minor: 0, shipping_total_minor: 0, total_minor: 100,
    payment_state: 'confirmed', payment_method: 'immediate_card', payment_grace_until: null, offline_instructions: null,
    meetup_notes: ['請先約定面交。\n保留第二行。', '<合成店門口>'], meetup_handover: null,
    latest_payment_attempt: null, can_resume_payment: false, contact: null, delivery: null, invoice: null, redacted: true,
  };
  const render = (value: PublicOrder) => renderToStaticMarkup(createElement(MeetupCard, {order: value}));
  for (const payment_method of ['cash_on_meetup', 'bank_transfer', 'immediate_card'] as const) {
    const value = {...order, payment_method, payment_grace_until: payment_method === 'immediate_card' ? null : time};
    const waiting = render(value);
    assert.match(waiting, /aria-labelledby="shop-order-meetup-heading"/);
    assert.match(waiting, /<h2 id="shop-order-meetup-heading">面交取貨<\/h2>/);
    assert.match(waiting, /<p class="shop-pay-label">等待面交<\/p>/);
    assert.match(waiting, /店家會用你留下的手機或 Email 和你約時間地點。/);
    assert.match(waiting, /請先約定面交。\n保留第二行。/);
    assert.match(waiting, /&lt;合成店門口&gt;/);
    assert.equal(waiting.match(/class="shop-preserve-lines"/g)?.length, 2);
    assert.doesNotMatch(waiting, /<button/);
    const older = {...value};
    delete older.meetup_handover;
    assert.equal(render(older), waiting, 'an older producer is waiting, including card payment with meetup');
    if (payment_method !== 'immediate_card') {
      const offline = renderToStaticMarkup(createElement(OfflineOrder, {
        order: {...value, payment_state: 'unpaid'}, disabled: false, onCancel: async () => {}, onRefresh: () => {},
      }));
      assert.doesNotMatch(offline, /請先約定面交|合成店門口|店家會用你留下/);
      if (payment_method === 'cash_on_meetup') assert.match(offline, /前完成面交付款。/);
    }
    const completed = {...value, meetup_handover: {completed_on: '2028-02-29'}};
    const recorded = render(completed);
    assert.match(recorded, /<p class="shop-pay-label">已面交<\/p>/);
    assert.match(recorded, /店家已登記在 2028\/02\/29 完成面交。/);
    assert.doesNotMatch(recorded, /等待面交|店家會用你留下|請先約定面交|合成店門口|<button/);
    for (const lifecycle_state of ['cancelled', 'closed'] as const) {
      assert.equal(render({...value, lifecycle_state}), '');
      assert.equal(render({...older, lifecycle_state}), '');
      assert.equal(render({...completed, lifecycle_state}), recorded);
    }
  }
  assert.equal(render({...order, meetup_notes: []}), '');
  assert.equal(render({...order, meetup_notes: undefined, meetup_handover: {completed_on: '2028-02-29'}}), '');
  assert.equal(formatCalendarDate('2028-02-29'), '2028/02/29');
});

test('order page serves identical no-store HTML shell for real and random order refs without cookies or DB writes', async () => {
  const s = await x.store();
  const c = await x.frozen(s, 2);
  const placed = await x.place(s, c);
  const randomRef = randomUUID();
  const before = await accessCounts();

  const realRes = await x.app.request(`${x.h.origin}/shops/${s.slug}/orders/${placed.order_id}`);
  const randomRes = await x.app.request(`${x.h.origin}/shops/${s.slug.toUpperCase()}/orders/${randomRef}`);
  const realHtml = await realRes.text();
  const randomHtml = await randomRes.text();

  for (const res of [realRes, randomRes]) {
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/html\b/i);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    assert.equal(res.headers.get('set-cookie'), null);
  }

  assert.equal(realHtml.replaceAll(placed.order_id, randomRef), randomHtml);
  assert.ok(realHtml.startsWith('<!doctype html><html lang="zh-Hant">'));
  assert.ok(realHtml.includes('<body><a class="shop-skip-link" href="#main">跳到主要內容</a>'));
  assert.equal(realHtml.match(/<script\b/gi)?.length, 1);
  assert.ok(realHtml.includes('<script type="module" src="/assets/storefront.js"></script>'));
  assert.equal(/\bon[a-z]+\s*=/i.test(realHtml), false);
  assert.equal(realHtml.match(/<h1\b/gi)?.length, 1);
  assert.ok(realHtml.includes('<h1 id="shop-order-title">訂單</h1>'));
  assert.ok(realHtml.includes('<p role="status">正在讀取訂單…</p>'));
  assert.ok(realHtml.includes('<noscript><p>查看訂單需要開啟瀏覽器的 JavaScript。</p></noscript>'));
  assert.ok(realHtml.includes(`data-store-slug="${s.slug}"`));
  assert.ok(realHtml.includes('data-store-name="合成商店"'));
  assert.ok(realHtml.includes(`data-order-ref="${placed.order_id}"`));
  assert.ok(realHtml.includes('data-email-enabled="false"'));
  assert.ok(!realHtml.includes(placed.display_number));

  const emailApp = createApp(x.runtime, x.h.origin, 'local', {
    guildLaunchpadEnabled: true,
    hostedReservationsEnabled: true,
    tenantCursorSigningKey: TENANT_CURSOR_TEST_KEY,
    commerceSettings: { checkoutEnabled: true, emailEnabled: true, quarantine: false, providerProfiles: [] },
  });
  const emailRes = await emailApp.request(`${x.h.origin}/shops/${s.slug}/orders/${placed.order_id}`);
  assert.equal(emailRes.status, 200);
  const emailHtml = await emailRes.text();
  assert.equal(emailHtml, orderPageHtml({ slug: s.slug, name: '合成商店' }, placed.order_id, { emailEnabled: true, buyerJourneyEnabled: true }));
  assert.ok(emailHtml.includes('data-email-enabled="true"'));

  assert.deepEqual(await accessCounts(), before);
});

test('404s cover unknown slug, invalid order_ref shapes and unpublished stores without scripts or writes', async () => {
  const s = await x.store();
  const c = await x.frozen(s, 1);
  const placed = await x.place(s, c);
  const before = await accessCounts();

  for (const path of [`/shops/no-such-store/orders/${placed.order_id}`, '/shops/no-such-store/order-access']) {
    const res = await x.app.request(x.h.origin + path);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(await res.text(), storeMissingHtml());
  }

  const upperUuid = placed.order_id.toUpperCase();
  const badVersionUuid = placed.order_id.replace(/^([0-9a-f]{8}-[0-9a-f]{4}-)[1-8]/, '$10');
  for (const badRef of ['abc', upperUuid, badVersionUuid]) {
    const res = await x.app.request(`${x.h.origin}/shops/${s.slug}/orders/${badRef}`);
    const html = await res.text();
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(html, orderMissingHtml({ slug: s.slug, name: '合成商店' }));
    assert.equal(html.includes('<script'), false);
    assert.ok(html.includes('找不到這筆訂單'));
    assert.ok(html.includes(`/shops/${s.slug}/order-access`));
  }

  const current = ok(await x.h.call('GET', s.root, s.owner, undefined, {}, x.app));
  ok(await x.send(s, '/unpublish', {}, current.version));

  for (const path of [`/shops/${s.slug}/orders/${placed.order_id}`, `/shops/${s.slug}/order-access`]) {
    const res = await x.app.request(x.h.origin + path);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(await res.text(), storeMissingHtml());
  }

  assert.deepEqual(await accessCounts(), before);
});

test('B10 order-access page serves the exact EC-SPEC-10 §6.2 copy without form, input, script or DB writes when emailEnabled is off', async () => {
  const s = await x.store();
  const before = await accessCounts();

  const res = await x.app.request(`${x.h.origin}/shops/${s.slug}/order-access`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/html\b/i);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(html, orderAccessPageHtml({ slug: s.slug, name: '合成商店' }));
  assert.equal(html, orderAccessPageHtml({ slug: s.slug, name: '合成商店' }, { emailEnabled: false }));
  assert.ok(html.includes('<title>找回訂單｜合成商店｜自由工坊</title>'));
  assert.ok(html.includes('<h1>找回訂單</h1>'));
  assert.ok(html.includes('<p>這間店目前不寄確認信，請用這個瀏覽器回到訂單，或聯絡店家。</p>'));
  assert.ok(html.includes(`<a href="/shops/${s.slug}">回到「合成商店」</a>`));
  assert.equal(/<(?:form|input|script)\b/i.test(html), false);
  assert.deepEqual(await accessCounts(), before);
});

test('B10 order-access page serves the form with Email, 訂單編號, submit button and storefront script when emailEnabled is on', async () => {
  const s = await x.store();
  const before = await accessCounts();
  const emailApp = createApp(x.runtime, x.h.origin, 'local', {
    guildLaunchpadEnabled: true,
    hostedReservationsEnabled: true,
    tenantCursorSigningKey: TENANT_CURSOR_TEST_KEY,
    commerceSettings: { checkoutEnabled: true, emailEnabled: true, quarantine: false, providerProfiles: [] },
  });

  const res = await emailApp.request(`${x.h.origin}/shops/${s.slug}/order-access`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/html\b/i);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(html, orderAccessPageHtml({ slug: s.slug, name: '合成商店' }, { emailEnabled: true, buyerJourneyEnabled: true }));
  assert.ok(html.includes('<script type="module" src="/assets/storefront.js"></script>'));
  assert.ok(html.includes('<h1 id="shop-order-access-title" tabindex="-1">找回訂單</h1>'));
  assert.ok(html.includes('<form class="shop-order-section" method="post" novalidate>'));
  assert.ok(html.includes('<label class="shop-add-label" for="shop-order-access-email">Email</label>'));
  assert.ok(html.includes('<input id="shop-order-access-email"'));
  assert.ok(html.includes('<label class="shop-add-label" for="shop-order-access-display-number">訂單編號</label>'));
  assert.ok(html.includes('<input id="shop-order-access-display-number"'));
  assert.ok(html.includes('placeholder="261015-ABCDEF"'));
  assert.ok(html.includes('<button type="submit" class="shop-button shop-pay-primary" disabled>寄送查看連結</button>'));
  assert.ok(html.includes('<noscript><p>寄送查看連結需要開啟瀏覽器的 JavaScript。</p></noscript>'));
  assert.ok(html.includes(`<a href="/shops/${s.slug}">回到「合成商店」</a>`));
  assert.equal(html.includes('這間店目前不寄確認信'), false);
  assert.equal(/\bon[a-z]+\s*=/i.test(html), false);
  assert.deepEqual(await accessCounts(), before);
});

test('store name with HTML characters is escaped in title, header and data attributes', async () => {
  const s = await x.store();
  const rawName = `<img src=x onerror=alert(1)>&"'`;
  const escapedName = '&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;';
  const current = ok(await x.h.call('GET', s.root, s.owner, undefined, {}, x.app));
  ok(await x.send(s, '', { name: rawName }, current.version, 'PATCH'));
  await x.publish(s);

  const orderRef = randomUUID();
  const before = await accessCounts();
  const orderRes = await x.app.request(`${x.h.origin}/shops/${s.slug}/orders/${orderRef}`);
  const orderHtml = await orderRes.text();
  assert.equal(orderRes.status, 200);
  assert.equal(orderHtml, orderPageHtml({ slug: s.slug, name: rawName }, orderRef));
  assert.ok(orderHtml.includes(`<title>訂單｜${escapedName}｜自由工坊</title>`));
  assert.ok(orderHtml.includes(`<a class="shop-top-store" href="/shops/${s.slug}">${escapedName}</a>`));
  assert.ok(orderHtml.includes(`data-store-name="${escapedName}"`));
  assert.equal(orderHtml.includes('<img src=x'), false);
  assert.equal(/\bon[a-z]+\s*=/i.test(orderHtml.replaceAll(escapedName, '')), false);

  const b10Res = await x.app.request(`${x.h.origin}/shops/${s.slug}/order-access`);
  const b10Html = await b10Res.text();
  assert.equal(b10Res.status, 200);
  assert.ok(b10Html.includes(`<title>找回訂單｜${escapedName}｜自由工坊</title>`));
  assert.ok(b10Html.includes(`<a href="/shops/${s.slug}">回到「${escapedName}」</a>`));
  assert.equal(b10Html.includes('<img src=x'), false);

  const b10EnabledHtml = orderAccessPageHtml({ slug: s.slug, name: rawName }, { emailEnabled: true });
  assert.ok(b10EnabledHtml.includes(`data-store-name="${escapedName}"`));
  assert.ok(b10EnabledHtml.includes(`<a href="/shops/${s.slug}">回到「${escapedName}」</a>`));
  assert.equal(b10EnabledHtml.includes('<img src=x'), false);

  assert.deepEqual(await accessCounts(), before);
});

test('orderEmailNote returns the off copy for every view and the pre-payment copy only for allowlisted views when on', () => {
  const allViews: PaymentView[] = ['ready', 'awaiting', 'checking', 'failed', 'expired', 'paid', 'review', 'closed'];
  for (const view of allViews) {
    assert.equal(orderEmailNote(view, false), '這間店目前不寄確認信，請用這個瀏覽器回到訂單，或聯絡店家。');
  }
  for (const view of ['ready', 'awaiting', 'checking', 'failed', 'expired'] as const) {
    assert.equal(orderEmailNote(view, true), '付款確認後，訂單成立信會寄到你填寫的 Email。');
  }
  for (const view of ['paid', 'review', 'closed'] as const) {
    assert.equal(orderEmailNote(view, true), null);
  }
  assert.equal(orderEmailNote('refunded' as unknown as PaymentView, true), null);
});

test('formatTaipeiDateTime formats Asia/Taipei 24-hour timestamps including midnight crossing', () => {
  assert.equal(formatTaipeiDateTime('2026-10-15T16:30:00.000Z'), '2026/10/16 00:30');
  assert.equal(formatTaipeiDateTime('2026-01-05T01:05:00.000Z'), '2026/01/05 09:05');
  assert.equal(formatTaipeiDateTime('2026-12-31T15:59:00.000Z'), '2026/12/31 23:59');
});


test('self-ship card keeps payment, fulfilment, retained and redacted states distinct without leaking references',async()=>{
 const {SelfShipCard,selfShipCardState}=await import('../../apps/portal-web/src/storefront/self-ship-card.js');
 type View=Pick<PublicOrder,'self_ship'|'lifecycle_state'>;
 const render=(order:View)=>renderToStaticMarkup(createElement(SelfShipCard,{order}));
 const waiting:View={lifecycle_state:'open',self_ship:{handling_days:3,note:'<合成物流>\n第二行',ship_by:null,shipment:null}};
 assert.equal(selfShipCardState(waiting),'waiting_payment');assert.match(render(waiting),/等待付款確認/);assert.match(render(waiting),/確認收款後 3 個工作天內寄出/);assert.match(render(waiting),/&lt;合成物流&gt;/);
 const paid:View={...waiting,self_ship:{...waiting.self_ship!,ship_by:'2026-10-28'}};assert.equal(selfShipCardState(paid),'waiting_ship');assert.match(render(paid),/等待出貨/);assert.match(render(paid),/2026\/10\/28/);
 const sent:View={...paid,self_ship:{...paid.self_ship!,shipment:{shipment_ref:randomUUID(),carrier_key:'other',carrier_name:'私有合成承運人',tracking_number:'PRIVATE-123',sent_on:'2026-10-23',recorded_at:'2026-10-23T01:00:00.000Z',redacted:false}}};
 assert.equal(selfShipCardState(sent),'sent');assert.match(render(sent),/已出貨/);assert.match(render(sent),/私有合成承運人/);assert.match(render(sent),/PRIVATE-123/);assert.match(render(sent),/工坊不追蹤物流、不核實簽收/);
 for(const lifecycle_state of ['open','closed','cancelled'] as const){
  const redacted:View={lifecycle_state,self_ship:{...sent.self_ship!,shipment:{...sent.self_ship!.shipment!,redacted:true,carrier_name:null,tracking_number:null}}};
  assert.equal(selfShipCardState(redacted),'redacted');assert.match(render(redacted),/已出貨/);assert.match(render(redacted),/物流業者：其他/);assert.match(render(redacted),/2026\/10\/23/);assert.doesNotMatch(render(redacted),/PRIVATE|私有|物流單號|<button|href=/);
 }
 for(const lifecycle_state of ['closed','cancelled'] as const)assert.equal(render({...waiting,lifecycle_state}),'');
 assert.equal(render({lifecycle_state:'open'}),'');
});
