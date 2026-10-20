import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {after, before, test} from 'node:test';
import {Pool} from 'pg';
import {createApp} from '../../apps/platform-api/src/app.js';
import {checkoutHarness, ports, type CheckoutHarness} from './hosted-checkout-harness.js';

let x: CheckoutHarness;
before(async () => {x = await checkoutHarness('fp_buyer_identity'); await x.reset();});
after(async () => {await x?.stop();});

async function persisted() {
  const tables = (await x.h.pool.query(`SELECT tablename FROM pg_tables WHERE schemaname=current_schema()
    AND (tablename LIKE 'commerce_%' OR tablename IN ('users','sessions','principals','resource_scopes','auth_rate_limits')) ORDER BY tablename`)).rows;
  const result: Record<string, string> = {};
  for (const {tablename} of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const rows = (await x.h.pool.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
    result[tablename] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  return result;
}

test('HTTP identity fence precedes every effect; original member can explicitly retry after a fresh login', async () => {
  const role = (await x.runtime.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
  const s = await x.store(50), a = await x.h.person('合成買家甲'), b = await x.h.person('合成買家乙');
  const app = createApp(x.runtime, x.h.origin, 'local', {guildLaunchpadEnabled: true, commerceSettings: {checkoutEnabled: true, quarantine: false, providerProfiles: []}, commercePorts: ports});
  const root = `/api/v1/public/stores/${s.slug}`;
  async function request(path: string, body: unknown, cookie?: string, expected?: string, key?: string) {
    const response = await app.request(x.h.origin + root + path, {method: 'POST', headers: {Origin: x.h.origin, 'Content-Type': 'application/json', ...(cookie ? {Cookie: cookie} : {}), ...(expected === undefined ? {} : {'X-Commerce-Buyer': expected}), ...(key ? {'Idempotency-Key': key} : {})}, body: JSON.stringify(body)});
    return {response, data: await response.json() as any};
  }
  const quote = {publication_revision: '1', lines: [{sku: s.product.sku, quantity: 1}]};
  const aIdentity = `member:${a.id}`, bIdentity = `member:${b.id}`;
  for (const [cookie, expected] of [[a.session.cookie, 'guest'], [b.session.cookie, aIdentity], [undefined, aIdentity]] as const) {
    for (const [path, body, key] of [['/cart-quotes', quote, undefined], ['/checkouts', x.input(s.product.sku, 1), randomUUID()], [`/checkouts/${randomUUID()}/orders`, {terms_sha256: 'a'.repeat(64), client_order_id: randomUUID()}, undefined]] as const) {
      const before = await persisted();
      const r = await request(path, body, cookie, expected, key);
      assert.equal(r.response.status, 409); assert.equal(r.data.code, 'checkout_identity_changed');
      assert.equal(r.data.detail, '登入身分已變更，請重新確認');
      assert.equal(r.response.headers.get('set-cookie'), null);
      assert.deepEqual(await persisted(), before, `${path} mismatch must not write budgets, mapping, checkout, access or inventory`);
    }
  }
  assert.equal((await request('/cart-quotes', quote, a.session.cookie, 'member:invalid')).response.status, 422);
  const guest = await request('/cart-quotes', quote, undefined, 'guest');
  assert.equal(guest.response.status, 200); assert.equal(guest.response.headers.get('X-Commerce-Buyer'), 'guest');
  const memberQuote = await request('/cart-quotes', quote, a.session.cookie, aIdentity);
  assert.equal(memberQuote.response.status, 200); assert.equal(memberQuote.response.headers.get('X-Commerce-Buyer'), aIdentity);
  const key = randomUUID(), frozen = await request('/checkouts', x.input(s.product.sku, 1), a.session.cookie, aIdentity, key);
  assert.equal(frozen.response.status, 201);
  const device = frozen.response.headers.get('set-cookie')!.split(';')[0];
  const intent = {terms_sha256: frozen.data.terms_sha256, client_order_id: randomUUID(), payment_method: 'immediate_card'};
  const placement = `/checkouts/${frozen.data.checkout_ref}/orders`;
  const placed = await request(placement, intent, `${a.session.cookie}; ${device}`, aIdentity);
  assert.equal(placed.response.status, 201);
  const beforeWrong = await persisted();
  const wrong = await request(placement, intent, `${b.session.cookie}; ${device}`, aIdentity);
  assert.equal(wrong.response.status, 409); assert.deepEqual(await persisted(), beforeWrong);
  // The equality token is not permission: B cannot read A's order, even though B's header is well formed.
  const denied = await app.request(x.h.origin + root + `/orders/${placed.data.order.order_ref}`, {headers: {Cookie: b.session.cookie, 'X-Commerce-Buyer': bIdentity}});
  assert.equal(denied.status, 404);
  const renewed = await x.h.signIn(a.email);
  assert.notEqual(renewed.cookie, a.session.cookie);
  const retried = await request(placement, intent, `${renewed.cookie}; ${device}`, aIdentity);
  assert.equal(retried.response.status, 200);
  assert.equal(retried.data.order.order_ref, placed.data.order.order_ref);
  assert.equal((await x.h.pool.query("SELECT count(*)::int n FROM commerce_orders WHERE order_profile='hosted_checkout'")).rows[0].n, 1);
  // Even a single available runtime connection must serve concurrent fenced
  // requests. A nested budget transaction would exhaust this pool.
  const single = new Pool({...x.runtime.options, max: 1, connectionTimeoutMillis: 2000});
  try {
    const narrow = createApp(single, x.h.origin, 'local', {guildLaunchpadEnabled: true, commerceSettings: {checkoutEnabled: true, quarantine: false, providerProfiles: []}, commercePorts: ports});
    const responses = await Promise.all(Array.from({length: 3}, () => narrow.request(x.h.origin + root + '/cart-quotes', {method: 'POST', headers: {Origin: x.h.origin, 'Content-Type': 'application/json', Cookie: renewed.cookie, 'X-Commerce-Buyer': aIdentity}, body: JSON.stringify(quote)})));
    for (const response of responses) assert.equal(response.status, 200, await response.text());
    const beforeRejected = await persisted();
    const rejected = await narrow.request(x.h.origin + root + '/checkouts', {method: 'POST', headers: {Origin: x.h.origin, 'Content-Type': 'application/json', Cookie: renewed.cookie, 'X-Commerce-Buyer': aIdentity, 'Idempotency-Key': randomUUID()}, body: JSON.stringify({...x.input(s.product.sku, 1), publication_revision: '999'})});
    assert.equal(rejected.status, 409, await rejected.text());
    const afterRejected = await persisted();
    assert.notEqual(afterRejected.auth_rate_limits, beforeRejected.auth_rate_limits, 'rejected commands retain accepted attempt charges');
    delete beforeRejected.auth_rate_limits; delete afterRejected.auth_rate_limits;
    assert.deepEqual(afterRejected, beforeRejected, 'rejected effects and principal mapping roll back to the post-budget savepoint');
  } finally {await single.end();}
  const legacy = await request('/cart-quotes', quote);
  assert.equal(legacy.response.status, 200, 'omitting the optional fence preserves the existing public API');
  const off = createApp(x.runtime, x.h.origin, 'local', {guildLaunchpadEnabled: true, commerceSettings: {checkoutEnabled: false, quarantine: false, providerProfiles: []}});
  const disabled = await off.request(x.h.origin + root + '/cart-quotes', {method: 'POST', headers: {Origin: x.h.origin, 'Content-Type': 'application/json', 'X-Commerce-Buyer': 'invalid'}, body: JSON.stringify(quote)});
  assert.equal(disabled.status, 409); assert.equal((await disabled.json() as any).code, 'checkout_not_enabled');
  assert.equal(disabled.headers.get('X-Commerce-Buyer'), null);
  const get = async (path: string) => off.request(x.h.origin + path, {headers: {Cookie: a.session.cookie}});
  const me = await get('/api/v1/me/orders'), missing = await get('/api/v1/me/nonexistent-buyer-list');
  assert.equal(me.status, missing.status); assert.equal(await me.text(), await missing.text());
  for (const path of [`/shops/${s.slug}`, `/shops/${s.slug}/cart`, `/shops/${s.slug}/checkout`, `/shops/${s.slug}/order-access`, `/shops/${s.slug}/orders/${randomUUID()}`]) {
    const response = await get(path), html = await response.text();
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
    assert.match(response.headers.get('Content-Security-Policy')!, /script-src 'self'/);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert(!html.includes('data-buyer-journey')); assert(!html.includes('return_to='));
  }
  const context = (await x.runtime.query("SELECT current_setting('freedom.tenant_id',true) AS tenant,current_setting('freedom.principal_id',true) AS principal")).rows[0];
  assert(!context.tenant && !context.principal, 'transaction context must not escape into the pool');
});
