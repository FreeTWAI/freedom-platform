import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {buildSync} from 'esbuild';
import {buyerRoute, readOrder, readQuote, readCancelObservation} from '../../apps/portal-web/src/modules/hosted-order-state.js';
import {sellerOrdersRoute} from '../../apps/portal-web/src/modules/hosted-seller-order-state.js';
import {buyerRoute as shellBuyerRoute, sellerOrdersRoute as shellSellerRoute} from '../../apps/portal-web/src/modules/hosted-order-route.js';
import {storeHtml} from '../../modules/agent-commerce/hosted/page.js';
import {SupplierReportQuerySchema as canonicalReportQuery} from '../../contracts/guild-launchpad/v1/supplier-console.js';
import {SupplierReportQuerySchema} from '../../contracts/guild-launchpad/v1/supplier-report-query.js';
import {OfflineSettingsFieldErrorSchema as canonicalFieldError} from '../../contracts/guild-launchpad/v1/hosted-offline-payment.js';
import {OfflineSettingsFieldErrorSchema} from '../../contracts/guild-launchpad/v1/offline-settings-field-error.js';
import {HOSTED_ORDER_PROFILE} from '../../contracts/guild-launchpad/v1/hosted-order.js';
const id = '12345678-1234-4234-8234-123456789abc', other = '23456789-1234-4234-8234-123456789abc';
const terms = {profile: HOSTED_ORDER_PROFILE, store: {slug: 'small-shop', name: '小店'}, publication_revision: '1', currency: 'TWD',
  items: [{sku: 'P0001', title: '杯子', quantity: 2, unit_price_minor: 300, line_total_minor: 600}], merchandise_total_minor: 600,
  amount_due_minor: null, shipping_state: 'not_configured', tax_state: 'not_assessed', payment_state: 'not_enabled', terms_sha256: 'a'.repeat(64),
  payment_enabled: false, refund_enabled: false, fulfilment_enabled: false, money_movement_enabled: false};
const quote = {...terms, quote_id: id, quoted_at: '2026-10-08T12:00:00.000Z', expires_at: '2026-10-08T12:05:00.000Z', reserves_stock: false};
const order = {...terms, order_id: id, client_order_id: id, quote_id: id, version: '1', created_at: '2026-10-08T12:00:00.000Z', reservation_expires_at: '2026-10-08T12:30:00.000Z', state: 'reserved', closed_at: null, close_reason: null};
const body = {publication_revision: '1', items: [{sku: 'P0001', quantity: 2}]};
const submit = {quote_id: id, client_order_id: id, terms_sha256: terms.terms_sha256};

test('shell and order pages share exact route parsers without changing locator acceptance', () => {
  assert.equal(shellBuyerRoute, buyerRoute);
  assert.equal(shellSellerRoute, sellerOrdersRoute);
  for (const suffix of ['orders', 'supply-orders']) {
    assert.deepEqual(shellSellerRoute(`#stores/${id}/${other}/${suffix}`), {
      tenantId: id, instanceId: other, ...(suffix === 'supply-orders' ? {supplier: true} : {}),
    });
    for (const invalid of ['?token=x', '/extra', '\n', '#home']) {
      assert.equal(shellSellerRoute(`#stores/${id}/${other}/${suffix}${invalid}`), null);
    }
  }
  for (const invalidId of [id.toUpperCase(), 'x'.repeat(36), id.slice(1), encodeURIComponent(id + '/')]) {
    assert.equal(shellSellerRoute(`#stores/${invalidId}/${other}/orders`), null);
    assert.equal(shellBuyerRoute(`#reservations/order/${invalidId}`), null);
  }
  assert.equal(shellBuyerRoute('#reservations/SMALL-shop'), null);
  assert.equal(shellBuyerRoute('#reservations/ small-shop'), null);
});

test('the full shell static graph excludes deferred commerce response decoders', () => {
  const app = fileURLToPath(new URL('../../apps/portal-web/src/App.tsx', import.meta.url));
  const source = readFileSync(app, 'utf8');
  const staticInputs = (contents: string) => {
    // Package parsing and browser execution are not part of this import-boundary check.
    const {inputs} = buildSync({
      stdin: {contents, loader: 'tsx', sourcefile: app, resolveDir: dirname(app)},
      bundle: true, write: false, metafile: true, packages: 'external', platform: 'browser',
      format: 'esm', loader: {'.css': 'empty'}, logLevel: 'silent',
    }).metafile!;
    const seen = new Set<string>();
    const visit = (path: string) => {
      if (seen.has(path)) return;
      seen.add(path);
      for (const dependency of inputs[path]?.imports ?? []) {
        if (!dependency.external && dependency.kind !== 'dynamic-import') visit(dependency.path);
      }
    };
    visit(Object.keys(inputs).find(path => path.endsWith('/App.tsx')) ?? '<stdin>');
    assert.ok(seen.size > 1, 'the real shell entry must be traversed');
    return [...seen];
  };
  const decoders = (paths: string[]) => paths.filter(path => /\/contracts\/.*\/(?:hosted-order|hosted-shared-order|hosted-checkout|hosted-offline-payment|supplier-console)\.ts$/.test('/' + path));
  assert.deepEqual(decoders(staticInputs(source)), []);
  // Negative control restores the former eager roots; the same full-graph guard must reject all of them.
  const formerRoots = source + "\nimport './modules/hosted-order-state';\nimport '../../../contracts/guild-launchpad/v1/supplier-console';\nimport '../../../contracts/guild-launchpad/v1/hosted-offline-payment';";
  const rejected = decoders(staticInputs(formerRoots));
  for (const name of ['hosted-order', 'hosted-shared-order', 'hosted-checkout', 'hosted-offline-payment', 'supplier-console']) {
    assert.ok(rejected.some(path => path.endsWith('/' + name + '.ts')), name);
  }
});

test('leaf query and error validators retain canonical identity and strict acceptance', () => {
  assert.equal(SupplierReportQuerySchema, canonicalReportQuery);
  assert.equal(OfflineSettingsFieldErrorSchema, canonicalFieldError);
  for (const [value, accepted] of [
    [{from: '2024-02-29', to: '2025-02-28'}, true],
    [{from: '2024-02-29', to: '2025-03-01'}, false],
    [{from: '2023-02-29', to: '2023-03-01'}, false],
    [{from: '1999-12-31', to: '2000-01-01'}, false],
    [{from: '2026-01-02', to: '2026-01-01'}, false],
    [{from: '2026-01-01', to: '2026-01-01', extra: true}, false],
  ] as const) assert.equal(SupplierReportQuerySchema.safeParse(value).success, accepted);
  for (const [value, accepted] of [
    [{path: 'bank_transfer.bank_code', code: 'format'}, true],
    [{path: 'items.99.name', code: 'required'}, true],
    [{path: 'items.100.name', code: 'required'}, false],
    [{path: 'bank_transfer.bank_code\n', code: 'format'}, false],
    [{path: 'bank_transfer.bank_code', code: 'unknown'}, false],
    [{path: 'bank_transfer.bank_code', code: 'format', extra: true}, false],
  ] as const) assert.equal(OfflineSettingsFieldErrorSchema.safeParse(value).success, accepted);
});

test('only bounded buyer hashes survive the existing login/onboarding destination gate', () => {
  assert.deepEqual(buyerRoute('#reservations'), {kind: 'lookup'});
  assert.deepEqual(buyerRoute('#reservations/small-shop'), {kind: 'shop', slug: 'small-shop'});
  assert.deepEqual(buyerRoute(`#reservations/order/${id}`), {kind: 'order', id});
  assert.deepEqual(buyerRoute(`#reservations/small-shop/intent/${id}`), {kind: 'intent', slug: 'small-shop', intent: id});
  for (const hash of ['#home', '#reservations/', '#reservations/../', '#reservations/%2F', '#reservations/small-shop?key=private', '#reservations/small-shop\n', `#reservations/order/${id}?buyer=other`, `#reservations/small-shop/intent/${id}/extra`, `https://other.test/#reservations/order/${id}`]) assert.equal(buyerRoute(hash), null, hash);
});
test('a valid quote for another store, revision or selection cannot become reviewed terms', () => {
  assert.ok(readQuote(quote, 'small-shop', body));
  for (const raw of [{}, {...quote, store: {...terms.store, slug: 'other-shop'}}, {...quote, publication_revision: '2'}, {...quote, payment_enabled: true}, {...quote, private_person: id}]) assert.equal(readQuote(raw, 'small-shop', body), null);
  assert.equal(readQuote(quote, 'small-shop', {...body, items: [{sku: 'P0002', quantity: 2}]}), null);
  assert.equal(readQuote(quote, 'small-shop', {...body, items: [{sku: 'P0001', quantity: 1}]}), null);
});
test('unreadable or unrelated successful order payload cannot confirm the held intent', () => {
  const expected = {kind: 'intent' as const, slug: 'small-shop', intent: id};
  assert.ok(readOrder(order, expected, submit));
  for (const raw of [{}, {...order, client_order_id: other}, {...order, quote_id: other}, {...order, terms_sha256: 'b'.repeat(64)}, {...order, store: {...terms.store, slug: 'other-shop'}}, {...order, amount_due_minor: 600}, {...order, state: 'paid'}]) assert.equal(readOrder(raw, expected, submit), null);
  assert.equal(readOrder(order, {kind: 'order', id: other}), null);
  // A committed retry can return current terminal state, never resurrect the old projection.
  assert.equal(readOrder({...order, version: '2', state: 'expired', closed_at: order.reservation_expires_at, close_reason: 'reservation_expired'}, expected, submit)?.state, 'expired');
});
test('public display links to member status without script, purchase action or private identity', () => {
  const html = storeHtml({slug: 'small-shop', name: '<小店>', brand: null, description: '展示', currency: 'TWD', products: [], revision: '1', published_at: '2026-10-08T12:00:00.000Z', transaction_state: 'not_enabled'});
  assert.match(html, /href="\/#reservations\/small-shop"/); assert.match(html, /登入查看預留狀態/);
  assert.match(html, /&lt;小店&gt;/); assert.doesNotMatch(html, /<script|<form|<button|購買|結帳|buyer_id|tenant_id|csrf/);
});


test('cancellation acknowledgement binds order, store and intent and requires a terminal state', () => {
  const expected = {id, slug: 'small-shop', intent: id};
  const cancelled = {...order, version: '2', state: 'cancelled', closed_at: '2026-10-08T12:01:00.000Z', close_reason: 'buyer_cancelled'};
  assert.equal(readCancelObservation(cancelled, expected)?.confirmed, true);
  assert.equal(readCancelObservation({...order, version: '2', state: 'expired', closed_at: order.reservation_expires_at, close_reason: 'reservation_expired'}, expected)?.confirmed, true);
  // A canonical old reserved DTO can be displayed by GET but cannot clear a held cancel.
  const observed = readCancelObservation(order, expected);
  assert.equal(observed?.order.state, 'reserved'); assert.equal(observed?.confirmed, false);
  for (const raw of [{}, {...cancelled, order_id: other}, {...cancelled, client_order_id: other}, {...cancelled, store: {...terms.store, slug: 'other-shop'}}]) assert.equal(readCancelObservation(raw, expected), null);
});

test('product reservation links accept only an exact published SKU shape without redirects or extra state', () => {
  assert.deepEqual(buyerRoute('#reservations/small-shop/product/P0001'), {kind: 'shop', slug: 'small-shop', sku: 'P0001'});
  for (const hash of ['#reservations/small-shop/product/P0001/extra', '#reservations/small-shop/product/P0001?quantity=99', '#reservations/small-shop/product/%500001', '#reservations/small-shop/product/p0001', '#reservations/small-shop/product/P0001\n', '#reservations/small-shop/product/P'+'0'.repeat(24)]) assert.equal(buyerRoute(hash), null);
});
