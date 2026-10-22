import {DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {emptySellerPolicies} from '../../contracts/guild-launchpad/v1/storefront-policies.js';
import {TENANT_CURSOR_TEST_KEY} from './tenant-cursor-fixture.js';
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomInt, randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {shippingSettingsHarness, type ShippingSettingsHarness, type ShippingTestStore} from './module-registry-harness.js';
import {SERVICE_KEYS} from '../../modules/agent-commerce/fulfilment/rules/types.js';
import {IMPLEMENTED_PROVIDER_PROFILES} from '../../modules/agent-commerce/operations/runtime-settings.js';

let h: ShippingSettingsHarness;
before(async () => { h = await shippingSettingsHarness('fp_commerce_quarantine'); });
beforeEach(async () => { await h.reset(); });
after(async () => { await h?.stop(); });

// Compare complete persisted rows, including credentials, versions, receipts,
// fresh-proof consumption and control events, without printing their contents.
async function snapshot() {
  const tables = (await h.f.x.h.pool.query(`SELECT tablename FROM pg_tables
    WHERE schemaname=current_schema() AND (tablename LIKE 'commerce_%'
      OR tablename LIKE 'hosted_%' OR tablename IN
      ('tenants','module_instances','tenant_high_risk_verifications','scoped_command_receipts','scoped_transition_journal'))
    ORDER BY tablename`)).rows as {tablename: string}[];
  assert(tables.some(t => t.tablename === 'scoped_command_receipts'));
  const hashes: Record<string, string> = {};
  for (const {tablename} of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const {rows} = await h.f.x.h.pool.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`);
    hashes[tablename] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  hashes.journal = createHash('sha256').update(JSON.stringify([...h.f.journal.objects.entries()].sort())).digest('hex');
  return hashes;
}

async function blockedThenAllowed(s: ShippingTestStore, method: string, path: string, body: unknown, version?: string, status = 200) {
  const key = randomUUID(), before = await snapshot();
  h.f.settings.quarantine = true;
  try {
    const denied = await h.request(s, method, path, body, version, s.owner, key);
    assert.equal(denied.status, 503, `${method} ${path}: ${JSON.stringify(denied.data)}`);
    assert.equal(denied.data.code, 'commerce_quarantined');
    assert.match(denied.response.headers.get('Cache-Control') ?? '', /no-store/);
    assert.deepEqual(await snapshot(), before, `${method} ${path} must not mutate persisted rows or journal`);
  } finally { h.f.settings.quarantine = false; }
  // The identical proof, key, body and version must still work after reopening.
  return h.expect(await h.request(s, method, path, body, version, s.owner, key), status);
}

test('quarantine blocks all shipping settings writes without receipts and preserves authorized GETs', async () => {
  const s = await h.store();
  const location = await blockedThenAllowed(s, 'POST', '/ship-from-locations', h.locationInput(), undefined, 201);
  await blockedThenAllowed(s, 'PUT', '/shipping-profile', h.document(), undefined, 201);
  await blockedThenAllowed(s, 'PUT', `/products/${s.product.product_id}/shipping-attributes`, h.attributes(), undefined, 201);
  const reader = await h.member(s, ['store:read']), fulfiller = await h.member(s, ['store:fulfil']);
  for (const session of [s.owner, reader.session, fulfiller.session]) {
    for (const path of ['/ship-from-locations', `/ship-from-locations/${location.location_id}`, '/shipping-profile', `/products/${s.product.product_id}/shipping-attributes`]) {
      const before = await h.request(s, 'GET', path, undefined, undefined, session);
      h.f.settings.quarantine = true;
      const during = await h.request(s, 'GET', path, undefined, undefined, session);
      h.f.settings.quarantine = false;
      assert.equal(during.status, before.status);
      assert.deepEqual(during.data, before.data);
    }
  }
  await blockedThenAllowed(s, 'POST', `/ship-from-locations/${location.location_id}/retire`, {});
});

test('quarantine blocks offline settings before consuming fresh proof and preserves its GET projection', async () => {
  h.f.settings.providerProfiles = [...IMPLEMENTED_PROVIDER_PROFILES]; h.f.install();
  const s = await h.store(), proof = await h.fresh(s);
  const body = {schema: 'freedom.offline-payment-settings/v1', fresh_auth_verification_id: proof,
    bank_transfer: {bank_code: String(randomInt(100, 1000)), bank_name: '青禾川石林安', branch_name: '白南青禾川石',
      account_number: Array.from({length: 12}, () => randomInt(10)).join(''), account_name: '青禾川石林安白南', note: '白南青禾川石林安'}, cash_on_meetup: {}};
  await blockedThenAllowed(s, 'PUT', '/offline-payment-settings', body, undefined, 201);
  const before = h.expect(await h.request(s, 'GET', '/offline-payment-settings'));
  h.f.settings.quarantine = true;
  assert.deepEqual(h.expect(await h.request(s, 'GET', '/offline-payment-settings')), before);
});

test('quarantine covers account creation, credential rotation and every service and logistics state command', async () => {
  const s = await h.store(); let account = await h.provider(s, [SERVICE_KEYS[0]], true);
  const root = `/provider-accounts/${account.account_id}`;
  account = await blockedThenAllowed(s, 'PUT', root + '/services/logistics', {
    profile: 'ecpay.logistics.domestic.v1', hash_key: randomBytes(8).toString('hex'), hash_iv: randomBytes(8).toString('hex'), fresh_auth_verification_id: await h.fresh(s),
  }, account.version);
  account = await blockedThenAllowed(s, 'POST', root + '/logistics-services', {service_key: SERVICE_KEYS[1], fresh_auth_verification_id: await h.fresh(s)}, account.version, 201);
  for (const suffix of [`/logistics-services/${SERVICE_KEYS[0]}`, '/services/logistics']) {
    for (const action of ['suspend', 'resume', 'retire']) {
      account = await blockedThenAllowed(s, 'POST', root + suffix + '/' + action, {fresh_auth_verification_id: await h.fresh(s)}, account.version);
    }
  }
  await blockedThenAllowed(s, 'POST', '/provider-accounts', {provider: 'ecpay', environment: 'sandbox', merchant_id: String(randomInt(1000000, 10000000)), fresh_auth_verification_id: await h.fresh(s)}, undefined, 201);
  const before = h.expect(await h.request(s, 'GET', '/provider-accounts'));
  h.f.settings.quarantine = true;
  assert.deepEqual(h.expect(await h.request(s, 'GET', '/provider-accounts')), before);
});

test('quarantine also covers neighboring release, storefront root and product writes', async () => {
  const s = await h.f.x.store();
  const release = h.expect(await h.request(s, 'GET', '/release'));
  await blockedThenAllowed(s, 'POST', '/upgrade', {}, release.version);
  const store = h.expect(await h.request(s, 'GET', ''));
  await blockedThenAllowed(s, 'PATCH', '', {name: '合成隔離商店'}, store.version);
  await blockedThenAllowed(s, 'PATCH', `/products/${s.product.product_id}`, {title: '合成隔離商品'}, s.product.version);
});

test('supply offer detail remains a private authorized read during quarantine',async()=>{
  const supplier=await h.f.x.store(),seller=await h.f.x.store(10,false);
  const offer=h.expect(await h.request(supplier,'POST',`/products/${supplier.product.product_id}/supply-offer`,{},supplier.product.version));
  const path='/supply-catalog/'+offer.offer_id;
  const before=h.expect(await h.request(seller,'GET',path));
  const reader=await h.member(seller,['store:read']);
  const denied=await h.request(seller,'GET',path,undefined,undefined,reader.session);
  assert.equal(denied.status,403);
  const persisted=await snapshot();h.f.settings.quarantine=true;
  const during=await h.request(seller,'GET',path);
  assert.deepEqual(h.expect(during),before);
  assert.equal(during.response.headers.get('Cache-Control'),'private, no-store');
  assert.equal((await h.request(seller,'GET',path,undefined,undefined,reader.session)).status,403);
  assert.deepEqual(await snapshot(),persisted);
});

test('quarantine blocks seller policy saves and receipt replay without changing evidence; authorized reads remain',async()=>{
 const s=await h.f.x.store(),app=createApp(h.f.x.runtime,h.f.x.h.origin,'local',{guildLaunchpadEnabled:true,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,storePoliciesEnabled:true,commerceSettings:h.f.settings});
 const body=emptySellerPolicies();body.seller.business_name='合成測試商行';const key=randomUUID();
 const read=()=>h.f.x.h.call('GET',s.root+'/seller-policies',s.owner,undefined,{},app),version=h.expect(await read()).version;
 const save=()=>h.f.x.h.call('PUT',s.root+'/seller-policies',s.owner,body,{'Idempotency-Key':key,'If-Match':`"${version}"`},app);
 const before=await snapshot();h.f.settings.quarantine=true;assert.equal((await save()).status,503);assert.deepEqual(await snapshot(),before);assert.equal((await read()).status,200);
 h.f.settings.quarantine=false;h.expect(await save());const committed=await snapshot();h.f.settings.quarantine=true;assert.equal((await save()).status,503);assert.deepEqual(await snapshot(),committed);assert.equal((await read()).status,200);
});

test('quarantine blocks gallery upload, ordering, descriptions, removal and receipt replay before effects',async()=>{
 const {FakeObjectStore}=await import('../../packages/asset-storage/fake-store.js');
 const {createStorefrontGalleryLifecycle}=await import('../../modules/assets/storefront-gallery.js');
 const {photoSourcePng}=await import('../helpers/hosted-store-photo.js');
 const s=await h.f.x.store(),store=new FakeObjectStore(),pool=h.f.x.runtime;
 const app=createApp(pool,h.f.x.h.origin,'local',{guildLaunchpadEnabled:true,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,storeGalleryEnabled:true,
  storePhotoAssetStore:store,storeGalleryAssets:createStorefrontGalleryLifecycle(pool,{store}),storePhotoUploadsEnabled:true,commerceSettings:h.f.settings});
 const root=s.root+'/products/'+s.product.product_id+'/gallery',key=randomUUID(),id=randomUUID();
 const read=()=>h.f.x.h.call('GET',root,s.owner,undefined,{},app);
 const upload=()=>app.request(h.f.x.h.origin+'/api/v1'+root+'/photos/'+id,{method:'POST',headers:{Origin:h.f.x.h.origin,Cookie:s.owner.cookie,'X-CSRF-Token':s.owner.csrf,'Content-Type':'image/png','Idempotency-Key':key,'If-Match':'"1"'},body:new Uint8Array(photoSourcePng)});
 const before=await snapshot();h.f.settings.quarantine=true;
 assert.equal((await upload()).status,503);
 for(const [method,suffix,body] of [['POST','/reorder',{photo_keys:['main']}],['PATCH','/photos/main',{alt_text:'合成說明'}],['POST','/photos/main/remove',{}]] as const){
  assert.equal((await h.f.x.h.call(method,root+suffix,s.owner,body,{'Idempotency-Key':randomUUID(),'If-Match':'"1"'},app)).status,503);
 }
 assert.deepEqual(await snapshot(),before);assert.equal((await read()).status,200);
 h.f.settings.quarantine=false;
 await h.f.x.h.pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-quarantine-gallery',retained_byte_limit=16777216 WHERE purpose='storefront.product-photo'");
 const saved=await upload();assert.equal(saved.status,200,await saved.clone().text());
 const committed=await snapshot();h.f.settings.quarantine=true;assert.equal((await upload()).status,503);assert.deepEqual(await snapshot(),committed);assert.equal((await read()).status,200);
});

test('member checkout list and retained B07 are read-only and remain available in quarantine',async()=>{
  const x=h.f.x,s=await x.store(),principal=(await x.h.pool.query("SELECT principal_id FROM principals WHERE user_ref=$1 AND kind='person'",[s.owner.user.user_id])).rows[0].principal_id;
  const frozen=await x.frozen(s,1),order=await x.place(s,frozen,randomUUID(),principal);
  const current=h.expect(await x.h.call('GET',s.root,s.owner,undefined,{},x.app));h.expect(await x.send(s,'/unpublish',{},current.version));
  const settings={...h.f.settings,checkoutEnabled:true,quarantine:true},app=createApp(x.runtime,x.h.origin,'local',{guildLaunchpadEnabled:true,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,commerceSettings:settings});
  const before=await snapshot(),list=await x.h.call('GET','/me/orders',s.owner,undefined,{},app);
  assert.equal(list.status,200);assert.deepEqual(list.data.items.map((o:{order_ref:string})=>o.order_ref),[order.order_id]);
  const page=await app.request(x.h.origin+`/shops/${s.slug}/orders/${order.order_id}`,{headers:{Cookie:s.owner.cookie}});
  assert.equal(page.status,200);assert.equal(page.headers.get('Cache-Control'),'private, no-store');
  assert.equal((await app.request(x.h.origin+`/api/v1/public/stores/${s.slug}/orders/${order.order_id}`,{headers:{Cookie:s.owner.cookie}})).status,200);
  assert.equal((await app.request(x.h.origin+`/shops/${s.slug}/orders/${order.order_id}`)).status,404);
  assert.deepEqual(await snapshot(),before);
});

test('quarantine blocks all three variant mutations and receipt replay before any rows or sequences change',async()=>{
 const s=await h.f.x.store(),app=createApp(h.f.x.runtime,h.f.x.h.origin,'local',{guildLaunchpadEnabled:true,storeVariantsEnabled:true,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,commerceSettings:h.f.settings});
 const root=s.root+'/product-groups/'+s.product.sku,key=randomUUID(),body={title:'合成規格商品',description:'',axes:[],members:[{product_id:s.product.product_id,product_version:s.product.version,value_keys:[]}],default_product_id:s.product.product_id,order:0};
 const send=(method:string,suffix:string,value:unknown,commandKey=key)=>h.f.x.h.call(method,root+suffix,s.owner,value,{'Idempotency-Key':commandKey,'If-Match':'"1"'},app);
 const before=await snapshot();h.f.settings.quarantine=true;
 for(const [method,suffix,value] of [['PUT','',body],['POST','/products',{product:{title:'合成新品',price_minor:100,stock:2},value_keys:[]}],['POST','/split',{}]] as const)assert.equal((await send(method,suffix,value)).status,503);
 assert.deepEqual(await snapshot(),before);assert.equal((await h.f.x.h.call('GET',root,s.owner,undefined,{},app)).status,200);
 h.f.settings.quarantine=false;assert.equal((await send('PUT','',body)).status,200);
 const committed=await snapshot();h.f.settings.quarantine=true;assert.equal((await send('PUT','',body)).status,503);assert.deepEqual(await snapshot(),committed);
});

test('quarantine blocks all five category mutations and replay before receipts, facts or profile changes',async()=>{
 const s=await h.f.x.store(),app=createApp(h.f.x.runtime,h.f.x.h.origin,'local',{registrationCommunityId:DEMO_COMMUNITY,guildLaunchpadEnabled:true,storeCategoriesEnabled:true,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,commerceSettings:h.f.settings});
 const read=()=>h.f.x.h.call('GET',s.root+'/categories',s.owner,undefined,{},app),p=h.expect(await read()),key=randomUUID(),id=randomUUID();
 const send=(method:string,suffix:string,body:unknown,commandKey=key)=>h.f.x.h.call(method,s.root+'/categories'+suffix,s.owner,body,{'Idempotency-Key':commandKey,'If-Match':`"${p.version}"`},app);
 const before=await snapshot();h.f.settings.quarantine=true;
 for(const [method,suffix,body] of [['POST','',{name:'合成分類'}],['PATCH','/'+id,{name:'合成新名'}],['POST','/reorder',{category_ids:[]}],['PUT','/'+id+'/groups',{group_keys:[]}],['POST','/'+id+'/remove',{}]] as const)assert.equal((await send(method,suffix,body)).status,503);
 assert.deepEqual(await snapshot(),before);assert.equal((await read()).status,200);
 h.f.settings.quarantine=false;assert.equal((await send('POST','',{name:'合成分類'})).status,201);const committed=await snapshot();h.f.settings.quarantine=true;assert.equal((await send('POST','',{name:'合成分類'})).status,503);assert.deepEqual(await snapshot(),committed);assert.equal((await read()).status,200);
});
