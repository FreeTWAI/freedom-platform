import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CheckoutBuyerState, buyerBindingKey, buyerIntentKey, legacyIntentKey, parkedIntentKey, readCheckoutIdentity} from '../../apps/portal-web/src/storefront/buyer-state.js';
import {createHash} from 'node:crypto';
import * as pages from '../../modules/agent-commerce/storefront/pages.js';
import {storeHtml, productHtml, storeMissingHtml} from '../../modules/agent-commerce/hosted/page.js';
import type {PublicStoreProjection} from '../../contracts/guild-launchpad/v1/storefront.js';
import {storefrontReturnPath, storefrontReturnFromSearch, storefrontLoginHref, validateStorefrontReturn, successfulStorefrontReturn, readStorefrontSession} from '../../apps/portal-web/src/storefront/return-path.js';

const id = '11111111-1111-4111-8111-111111111111';
const path = '/shops/synthetic-buyer-shop/checkout';
const session = {user: {user_id: id}, csrf_token: 'synthetic-session-proof'};
const store = {slug: 'synthetic-buyer-shop', name: '合成商店', brand: null, description: '', currency: 'TWD', revision: '1', published_at: '2026-10-20T00:00:00.000Z', transaction_state: 'not_enabled', products: []};

test('closed return allowlist rejects encoded path separators, normalization, controls and duplicate query values', () => {
  for (const slug of ['abc', 'a' + 'b'.repeat(38) + 'c']) {
    for (const suffix of ['checkout', 'order-access', `orders/${id}`]) {
      const value = `/shops/${slug}/${suffix}`;
      assert.equal(storefrontReturnPath(value), value);
      assert.equal(storefrontReturnFromSearch(storefrontLoginHref(value).slice(1)), value);
    }
  }
  const rejected = [null, '', 'a'.repeat(161), 'https://evil.invalid' + path, 'javascript:alert(1)', 'data:text/html,', '//evil.invalid' + path,
    '///shops/abc/checkout', '/shops/abc\\checkout', '/shops/abc/checkout\\', '/shops/abc/./checkout', '/shops/abc/../checkout',
    '/shops/abc/checkout?x=1', '/shops/abc/checkout#access=secret', ' ' + path, path + ' ', '/shops/a bc/checkout',
    '/shops/中文店/checkout', '/shops/ABC/checkout', '/shops/ab/checkout', '/shops/a-b-/checkout', '/shops/abc/checkout/',
    '/shops//abc/checkout', '/shops/abc/orders', '/shops/abc/orders/not-an-id', `/shops/abc/orders/${id.toUpperCase().replace('11111111', 'AAAAAAAA')}`,
    '/shops/abc/cart', '/shops/abc', '/shops/abc/products/P0001', `/shops/abc/payment-return/${id}`, '/pay/ecpay/token', '/api/v1/site',
    ...['%2f', '%2F', '%5c', '%5C', '%2e', '%2E', '%252f', '%252e', '%', '%zz'].map(value => `/shops/abc/${value}/checkout`),
    ...['\0', '\n', '\r', '\t', '\x7f', '\x80', '\x9f'].flatMap(value => [path + value, '/shops/ab' + value + 'c/checkout'])];
  for (const value of rejected) assert.equal(storefrontReturnPath(value), null, JSON.stringify(value));
  assert.equal(storefrontReturnFromSearch('?return_to=' + encodeURIComponent(path) + '&return_to=' + encodeURIComponent(path)), null);
  assert.equal(storefrontReturnFromSearch('?return_to=' + encodeURIComponent('/shops/abc%2fcheckout')), null);
  assert.equal(storefrontLoginHref('//evil.invalid'), '/');
});

function replies(values: Array<Response | Error>) {
  const calls: Array<{path: string; options: RequestInit | undefined}> = [];
  const fetcher: typeof fetch = async (input, options) => {
    calls.push({path: String(input), options});
    const next = values.shift();
    if (!next) throw Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  };
  return {fetcher, calls};
}
const json = (value: unknown, status = 200) => Response.json(value, {status});

test('successful auth checks its cookie before and after current public store validation', async () => {
  const r = replies([json(session), json({commerce_checkout_enabled: true}), json(store), json(session)]);
  assert.equal(await successfulStorefrontReturn(path, session, r.fetcher), true);
  assert.deepEqual(r.calls.map(c => c.path), ['/api/v1/session', '/api/v1/site', '/api/v1/public/stores/synthetic-buyer-shop', '/api/v1/session']);
  assert.deepEqual(r.calls.map(c => c.options?.credentials), ['same-origin', 'omit', 'omit', 'same-origin']);
  assert(r.calls.every(c => c.options?.cache === 'no-store' && c.options.redirect === 'error'));
  const none = replies([]);
  assert.equal(await successfulStorefrontReturn('//evil.invalid', session, none.fetcher), false);
  assert.equal(none.calls.length, 0);
});

test('withdrawal, invalid projections, redirects, network failure and disabled flags cannot authorize return', async () => {
  for (const values of [
    [json({commerce_checkout_enabled: false})], [json({})], [json({}, 503)],
    [json({commerce_checkout_enabled: true}), json({}, 404)],
    [json({commerce_checkout_enabled: true}), json({...store, slug: 'another-shop'})],
    [json({commerce_checkout_enabled: true}), json({slug: store.slug})],
    [json({commerce_checkout_enabled: true}), new Response('html', {headers: {'Content-Type': 'text/html'}})],
    [new TypeError('redirect rejected')], [new TypeError('network unavailable')],
  ]) {
    const r = replies([json(session), ...values, json(session)]);
    assert.equal(await successfulStorefrontReturn(path, session, r.fetcher), false);
    assert.equal(r.calls.at(-1)?.path, '/api/v1/session');
  }
  assert.equal(await validateStorefrontReturn('/shops/abc/cart', replies([]).fetcher), false);
});

test('expired, replaced or revoked successful sessions never follow a return path; session read failures are not guests', async () => {
  for (const invalid of [json({}, 401), json({...session, csrf_token: 'replacement'}), json({...session, user: {user_id: '22222222-2222-4222-8222-222222222222'}})]) {
    await assert.rejects(successfulStorefrontReturn(path, session, replies([invalid]).fetcher));
  }
  await assert.rejects(successfulStorefrontReturn(path, session, replies([json(session), json({commerce_checkout_enabled: true}), json(store), json({}, 401)]).fetcher));
  assert.equal(await readStorefrontSession(replies([json({}, 401)]).fetcher), null);
  await assert.rejects(readStorefrontSession(replies([json({}, 500)]).fetcher));
  await assert.rejects(readStorefrontSession(replies([json({})]).fetcher));
});

// Captured from the exact cf7e518b renderer output before any product edits.
const baselineHashes = {
  "grid": "95b6628be962ab8897a4a242b4151f30ee370e5efb9f7e2f53af5bd4685e0fba",
  "list": "2631a5406274f4d5584b05ae9e4e7263303ea66ac990e89aa81d0399e4353ce6",
  "product": "582b91f02a4d8272e5e85f77dee9ea87db0c9fd5c07cbb3c007fb13e116fbada",
  "missingStore": "5fafd27a9f9b2e25e9d060e4009528265763ce8b9a4f1b37edd1275f180f5905",
  "missingProduct": "5ded05ead3b2a30f84c4a7353f83f57a1b28f252b4b4c04cb30bff53144ee53d",
  "cart": "24566589b3255de0f1d0abd12f5d7e1be7ac254775b45aa60cf2d19eb90bc2f8",
  "checkout": "afb9208288a36bb57f96b6171103c1649afa200f8c49b55c46c73d5bba912a6a",
  "order": "4cb3f3f34eba50a36ccf84698a3d553c748f3e318396545ce3f1b6c9277f9674",
  "orderEmail": "0bc940943fadde6243b6577e09bc2a5905164c8839e6fce70f69a1fd4998840d",
  "missingOrder": "0a0af5ca77f037b4c0325226218a1fe33ce9d3b55208fa5de81ca10fffaca7da",
  "access": "07013a375f38afe871ad9effe48477e52b860121c7e47c5a70148f73a109f7ce",
  "accessEmail": "ba678472f8107f3175cc43619341f2c391c1740118d21c1d4c67c6dc40e3fb5b",
  "paymentReturn": "61f9aca560ab746ee6aa6326cd1ada1e45f2ff781e9beef689a56706afff60ee",
  "paymentMissing": "b4739a81530537dd42df450e900e10285463cbaa89b935434ee5097d9d8495eb"
};
test('checkout OFF preserves all baseline storefront HTML bytes, including directly addressable checkout and email variants', () => {
  const original: PublicStoreProjection = {slug: 'synthetic-buyer-shop', name: '合成商店 <&"', description: '合成公開說明。\n第二行。', brand: null, currency: 'TWD', revision: '1', published_at: '2026-10-20T00:00:00.000Z', transaction_state: 'not_enabled', products: [{sku: 'P0001', title: '合成商品', description: '合成商品說明。', price_minor: 100}]};
  const rendered = {grid:storeHtml(original),list:storeHtml(original,'catalog-list-v1'),product:productHtml(original,'P0001')!,missingStore:storeMissingHtml(),missingProduct:storeMissingHtml(true),cart:pages.cartPageHtml(original),checkout:pages.checkoutPageHtml(original,false),order:pages.orderPageHtml(original,id,{buyerJourneyEnabled:false}),orderEmail:pages.orderPageHtml(original,id,{emailEnabled:true,buyerJourneyEnabled:false}),missingOrder:pages.orderMissingHtml(original),access:pages.orderAccessPageHtml(original,{buyerJourneyEnabled:false}),accessEmail:pages.orderAccessPageHtml(original,{emailEnabled:true,buyerJourneyEnabled:false}),paymentReturn:pages.paymentReturnPageHtml(original,id,id),paymentMissing:pages.paymentReturnMissingHtml(original)};
  for (const [name,html] of Object.entries(rendered)) assert.equal(createHash('sha256').update(html).digest('hex'),baselineHashes[name as keyof typeof baselineHashes],name);
  assert.match(pages.orderAccessPageHtml(original,{buyerJourneyEnabled:true}), /登入會員/);
  assert.match(pages.orderPageHtml(original,id,{buyerJourneyEnabled:true}), /data-buyer-journey="true"/);
});

function tabStorage() {
  const rows = new Map<string,string>();
  return {rows,getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);},removeItem:(key:string)=>{rows.delete(key);}};
}
const coordinates = {checkoutRef:id,input:{terms_sha256:'a'.repeat(64),client_order_id:id,payment_method:'bank_transfer' as const}};
const memberA = `member:${id}`, memberB = 'member:22222222-2222-4222-8222-222222222222';
test('tab binding detects guest/member and account changes without moving the cart or replaying a parked command',()=>{
  const storage=tabStorage(),slug='synthetic-shop';
  storage.setItem('freedom.shop.cart.v1:'+slug,'unchanged cart');
  let buyer=new CheckoutBuyerState(slug,storage,1000);
  assert.deepEqual(buyer.observe('guest',1000),{changed:false,previousOrder:false});
  buyer.saveIntent(coordinates);
  buyer=new CheckoutBuyerState(slug,storage,1100);
  const generation=buyer.generation;
  assert.deepEqual(buyer.observe(memberA,1100),{changed:true,previousOrder:true});
  assert.equal(buyer.intent,null);assert(storage.getItem(parkedIntentKey(slug,coordinates)));
  assert.equal(buyer.matches('guest',generation),false);
  assert.equal(storage.getItem('freedom.shop.cart.v1:'+slug),'unchanged cart');
  assert.equal(storage.getItem(buyerIntentKey(slug)),null);
  assert.deepEqual(buyer.observe(memberA,1200),{changed:false,previousOrder:false});
  const saved=buyer.saveIntent(coordinates);
  assert.deepEqual(saved.input,coordinates.input); // Fence metadata never changes the original request body.
  assert.equal(saved.buyer,memberA);assert.equal(saved.version,2);
  buyer=new CheckoutBuyerState(slug,storage,1300);
  assert.deepEqual(buyer.observe(memberA,1300),{changed:false,previousOrder:false});
  assert.deepEqual(buyer.intent,saved); // Same-user new cookie/CSRF is not an identity change.
  assert.deepEqual(buyer.observe(memberB,1400),{changed:true,previousOrder:true});
  const before=buyer.generation;
  assert.deepEqual(buyer.observe('guest',1500),{changed:true,previousOrder:false});
  assert(!buyer.matches(memberB,before));
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(buyerBindingKey(slug))!)).sort(),['buyer','seenAt','slug','version']);
});
test('legacy, malformed, wrong-store and expired drafts are untrusted; no session read failure is a guest identity',async()=>{
  for(const legacy of [JSON.stringify(coordinates),'{broken']) {
    const storage=tabStorage(),slug='synthetic-shop';storage.setItem(legacyIntentKey(slug),legacy);
    const buyer=new CheckoutBuyerState(slug,storage,1000);assert.equal(buyer.intent,null);
    assert.equal(buyer.observe('guest',1000).changed,true);assert.equal(storage.getItem(legacyIntentKey(slug)),null);
    assert.deepEqual(buyer.observe('guest',1001),{changed:false,previousOrder:false});
  }
  for(const metadata of [{version:1,slug:'another-shop',buyer:memberA,seenAt:0},{version:1,slug:'synthetic-shop',buyer:memberA,seenAt:0}]) {
    const storage=tabStorage();storage.setItem(buyerBindingKey('synthetic-shop'),JSON.stringify(metadata));
    assert.equal(new CheckoutBuyerState('synthetic-shop',storage,31*60_000).observe(memberA).changed,true);
  }
  const storage=tabStorage();storage.setItem(buyerIntentKey('synthetic-shop'),JSON.stringify({...coordinates,version:2,slug:'another-shop',buyer:memberA}));
  const buyer=new CheckoutBuyerState('synthetic-shop',storage);assert.equal(buyer.intent,null);assert(buyer.observe(memberA).changed);
  buyer.invalidate();assert.equal(buyer.identity,null);assert(buyer.observe(memberA).changed);
  assert.equal(await readCheckoutIdentity(replies([json({},401)]).fetcher),'guest');
  await assert.rejects(readCheckoutIdentity(replies([new Error('offline')]).fetcher));
  await assert.rejects(readCheckoutIdentity(replies([json({},503)]).fetcher));
});
