import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HostedReservationSetting} from '../../apps/portal-web/src/modules/HostedReservationSetting.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {HOSTED_ORDER_PROFILE, OrderSchema} from '../../contracts/guild-launchpad/v1/hosted-order.js';
import {sellerOrdersRoute, readSellerPage, readSellerCancel} from '../../apps/portal-web/src/modules/hosted-seller-order-state.js';
const id = '12345678-1234-4234-8234-123456789abc', other = '23456789-1234-4234-8234-123456789abc';
const order = OrderSchema.parse({profile: HOSTED_ORDER_PROFILE, store: {slug: 'small-shop', name: '小店'}, publication_revision: '1', currency: 'TWD',
  items: [{sku: 'P0001', title: '杯子', quantity: 2, unit_price_minor: 300, line_total_minor: 600}], merchandise_total_minor: 600,
  amount_due_minor: null, shipping_state: 'not_configured', tax_state: 'not_assessed', payment_state: 'not_enabled', terms_sha256: 'a'.repeat(64),
  payment_enabled: false, refund_enabled: false, fulfilment_enabled: false, money_movement_enabled: false,
  order_id: id, client_order_id: id, quote_id: id, version: '1', created_at: '2026-10-08T12:00:00.000Z', reservation_expires_at: '2026-10-08T12:30:00.000Z', state: 'reserved', closed_at: null, close_reason: null});
const cancelled = {...order, version: '2', state: 'cancelled', closed_at: '2026-10-08T12:01:00.000Z', close_reason: 'seller_cancelled'};

test('seller recovery accepts only the exact same-origin store locator grammar', () => {
  assert.deepEqual(sellerOrdersRoute(`#stores/${id}/${other}/orders`), {tenantId: id, instanceId: other});
  for (const hash of [`#stores/${id}/${other}`,`#stores/${id}/${other}/orders/extra`,`#stores/${id}/${other}/orders?buyer=x`,`#stores/${id}/${other}/orders\n`,`https://other.test/#stores/${id}/${other}/orders`, '#stores/%2F/../orders']) assert.equal(sellerOrdersRoute(hash), null);
});
test('strict owner history rejects duplicated orders and private extra fields and retains opaque cursor bytes', () => {
  const cursor = 'v1.server_signed.continuation';
  assert.equal(readSellerPage({items: [order], next_cursor: cursor})?.next_cursor, cursor);
  assert.ok(readSellerPage({items: [], next_cursor: null}));
  for (const raw of [{items: [order, order], next_cursor: null}, {items: [{...order, buyer_email: 'not-allowed'}], next_cursor: null}, {items: [order], next_cursor: ''}, {}]) assert.equal(readSellerPage(raw), null);
});
test('seller cancellation requires original identity, immutable terms and a newer terminal version', () => {
  assert.equal(readSellerCancel(cancelled, order)?.confirmed, true);
  assert.equal(readSellerCancel({...order, state: 'expired', version: '2', closed_at: order.reservation_expires_at, close_reason: 'reservation_expired'}, order)?.confirmed, true);
  assert.equal(readSellerCancel(order, order)?.confirmed, false);
  assert.equal(readSellerCancel({...cancelled, version: '1'}, order)?.confirmed, false);
  for (const raw of [{}, {...cancelled, order_id: other}, {...cancelled, client_order_id: other}, {...cancelled, quote_id: other}, {...cancelled, terms_sha256: 'b'.repeat(64)}, {...cancelled, store: {...order.store, slug: 'other-shop'}}]) assert.equal(readSellerCancel(raw, order), null);
  const later = {...order, version: '9007199254740993'};
  assert.equal(readSellerCancel({...cancelled, version: '9007199254740994'}, later)?.confirmed, true);
  assert.equal(readSellerCancel({...cancelled, version: '9007199254740992'}, later), null);
});


test('shared reservation control requires admission and writable scope to open, but permits stopping with either disabled', () => {
  for (const reservation_enabled of [false, true]) for (const admission_enabled of [false, true]) {
    for (const writable of [false, true]) for (const locked of [false, true]) {
      const markup = renderToStaticMarkup(createElement(HostedReservationSetting, {
        setting: {reservation_enabled, admission_enabled, version: '1'}, writable, locked, onToggle: () => {},
      }));
      assert.equal(/<button[^>]* disabled=""/.test(markup), locked || !reservation_enabled && (!writable || !admission_enabled));
      assert.ok(markup.includes(reservation_enabled ? '停止接受新預留' : '開放 30 分鐘預留'));
    }
  }
});
test('supplier reservation copy describes shared stock without promising supplier cancellation authority', () => {
  for (const admission_enabled of [false, true]) {
    const markup = renderToStaticMarkup(createElement(HostedReservationSetting, {
      setting: {reservation_enabled: true, admission_enabled, version: '2'}, writable: true, locked: false,
      supplierOnly: true, onToggle: () => {},
    }));
    assert.ok(markup.includes(admission_enabled ? '經你同意的店主' : '仍可查看既有供貨預留'));
    assert.ok(!markup.includes('查看與取消'));
    assert.ok(markup.includes('btn btn-ghost'));
  }
});

// Execute the current TSX component and real response parser with a small hook host.
// This is a component/control-flow regression, not a React DOM or browser test.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as React from 'react';
import {ApiError} from '../../apps/portal-web/src/api.js';
function entryHarness() {
  const sourceUrl = new URL('../../apps/portal-web/src/modules/HostedSellerOrders.tsx', import.meta.url);
  const requireSource = createRequire(sourceUrl);
  const cells: any[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  let cursor = 0, dirty = false, tree: any;
  const hooks = {...React,
    useState(initial: any) {const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
      return [cells[i], (value: any) => {const next = typeof value === 'function' ? value(cells[i]) : value; if (!Object.is(next, cells[i])) {cells[i] = next; dirty = true;}}];},
    useRef(initial: any) {const i = cursor++; return cells[i] ??= {current: initial};},
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {const i = cursor++, prev = cells[i];
      if (!prev || deps.some((value, j) => !Object.is(value, prev[j]))) {cells[i] = deps; effects.push(() => {cleanups[i]?.(); cleanups[i] = effect() ?? (() => {});});}},
  };
  const module = {exports: {} as any};
  const code = transformSync(readFileSync(sourceUrl, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code;
  runInNewContext(code, {module, exports: module.exports, AbortController,
    require: (name: string) => name === 'react' ? hooks : name === '../api' ? {ApiError} : name.endsWith('.css') ? {} : requireSource(name)});
  const requests: {path: string; signal: AbortSignal; resolve: (raw: unknown) => void; reject: (error: unknown) => void}[] = [];
  const client = {sessionGeneration: 1, get(path: string, options: {signal: AbortSignal}) {
    return new Promise((resolve, reject) => {requests.push({path, signal: options.signal, resolve, reject});});
  }};
  let props = {client, tenantId: id, instanceId: other, readinessHref: '#readiness'};
  function render(runEffects = true) {cursor = 0; dirty = false; tree = module.exports.SellerOrdersLink(props); if (runEffects) {while (effects.length) effects.shift()!(); if (dirty) render();} return tree;}
  async function flush() {for (let i = 0; i < 5; i++) {await Promise.resolve(); if (dirty) render();}}
  function nodes(node = tree): any[] {if (Array.isArray(node)) return node.flatMap(child => nodes(child)); if (!node || typeof node !== 'object') return []; return [node, ...nodes(node.props?.children)];}
  const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
  render();
  return {client, requests, flush, render, nodes, text: () => text(tree),
    buttons: () => nodes().filter(node => node.type === 'button'),
    links: () => nodes().filter(node => node.type === 'a').map(node => text(node)),
    change(next: Partial<typeof props>, runEffects = true) {props = {...props, ...next}; render(runEffects);},
    unmount() {for (const cleanup of cleanups) cleanup?.();},
  };
}
const emptyPage = {items: [], next_cursor: null};
for (const failure of ['network', '503', 'schema'] as const) test(`seller entry ${failure} failure offers a read-only retry and recovers`, async () => {
  const h = entryHarness(); assert.deepEqual(h.links(), ['開店準備']);
  assert.equal(h.requests[0].path, `/tenants/${id}/storefronts/${other}/reservations?limit=1`);
  if (failure === 'schema') h.requests[0].resolve({});
  else h.requests[0].reject(new ApiError({message: 'failed', status: failure === '503' ? 503 : 0, network: failure === 'network'}));
  await h.flush(); assert.match(h.text(), /暫時無法讀取訂單入口/); assert.deepEqual(h.links(), ['開店準備']);
  const retry = h.buttons()[0]; assert.ok(retry); retry.props.onClick(); retry.props.onClick(); await h.flush();
  assert.equal(h.requests.length, 2); assert.equal(h.buttons().length, 0); assert.deepEqual(h.links(), ['開店準備']);
  retry.props.onClick(); await h.flush(); assert.equal(h.requests.length, 2, 'stale repeated click cannot issue another read');
  h.requests[1].resolve(emptyPage); await h.flush(); assert.deepEqual(h.links(), ['開店準備', '預留訂單', '供貨訂單']);
  assert.equal(h.buttons().length, 0); h.unmount();
});
for (const status of [403, 404]) test(`seller entry ${status} hides owner links without offering retry`, async () => {
  const h = entryHarness(); h.requests[0].reject(new ApiError({message: 'denied', status})); await h.flush();
  assert.deepEqual(h.links(), ['開店準備']); assert.equal(h.buttons().length, 0); assert.doesNotMatch(h.text(), /暫時無法/); h.unmount();
});
test('seller entry valid empty owner page enables links without duplicate unchanged-prop reads', async () => {
  const h = entryHarness(); h.render(); assert.equal(h.requests.length, 1); h.requests[0].resolve(emptyPage); await h.flush();
  assert.deepEqual(h.links(), ['開店準備', '預留訂單', '供貨訂單']); h.render(); assert.equal(h.requests.length, 1); h.unmount();
});
for (const outcome of ['success', 'failure'] as const) test(`seller entry ignores late ${outcome} after unmount or store change`, async () => {
  for (const unmount of [true, false]) {
    const h = entryHarness(); if (unmount) h.unmount(); else h.change({instanceId: id});
    assert.equal(h.requests[0].signal.aborted, true);
    if (outcome === 'success') h.requests[0].resolve(emptyPage); else h.requests[0].reject(new Error('late'));
    await h.flush(); assert.deepEqual(h.links(), ['開店準備']); assert.equal(h.buttons().length, 0);
    if (!unmount) {h.requests[1].resolve(emptyPage); await h.flush(); assert.equal(h.links().length, 3); h.unmount();}
  }
});
test('seller entry fences session changes and stale failure/retry before new scope effects', async () => {
  const h = entryHarness(); h.requests[0].reject(new Error('network')); await h.flush(); const retry = h.buttons()[0]; assert.ok(retry);
  h.change({instanceId: id}, false); assert.equal(h.buttons().length, 0, 'old error cannot appear on new store render');
  retry.props.onClick(); h.render(); await h.flush(); assert.equal(h.requests.length, 2);
  h.client.sessionGeneration++; h.requests[1].resolve(emptyPage); await h.flush(); assert.deepEqual(h.links(), ['開店準備']);
  h.render(); assert.equal(h.buttons().length, 0); h.unmount();
});
