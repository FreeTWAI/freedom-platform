import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {before,after,beforeEach,test} from 'node:test';
import {createHostedStorePhotoHarness,photoSourcePng,type HostedStorePhotoHarness} from '../helpers/hosted-store-photo.js';
import {seedAppearanceRows} from '../helpers/storefront-appearance.js';
import {createStorefrontAppearanceLifecycle} from '../../modules/assets/storefront-appearance.js';
import {AppearanceCommandAckSchema} from '../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {isolatedTransaction} from '../../packages/resource-scopes/tenant-transaction.js';
import {bindStore} from '../../modules/agent-commerce/checkout/authority.js';
import {mapPersonPrincipal} from '../../packages/resource-scopes/index.js';
import {canonicalJSON,freezeCheckout,type CheckoutPorts} from '../../modules/agent-commerce/checkout/terms.js';
import {placeCheckoutOrder} from '../../modules/agent-commerce/checkout/orders.js';
import {createPaymentMethodsPort} from '../../modules/agent-commerce/payments/offline/methods.js';
import {completeMeetup} from '../../modules/agent-commerce/payments/offline/confirm.js';
import {syntheticShippingPort} from '../../scripts/synthetic-shipping-quote.js';

let f:HostedStorePhotoHarness;
before(async()=>{f=await createHostedStorePhotoHarness();});after(async()=>f?.stop());beforeEach(async()=>f.reset());
type Store=Awaited<ReturnType<HostedStorePhotoHarness['openStore']>>;
const application=(enabled=true)=>f.application(false,{storeAppearanceEnabled:enabled});
async function publish(s:Store,app=application()){
  const view=f.ok(await f.h.call('GET',s.root,s.owner,undefined,{},app));
  return f.ok(await f.h.call('POST',s.root+'/publish',s.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':`"${view.version}"`},app));
}
async function prepared(){
  const s=await f.openStore();await f.h.pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-rollback',retained_byte_limit=16777216 WHERE purpose='storefront.product-photo'");
  const uploaded=await f.app.request(f.h.origin+'/api/v1'+s.root+'/products/'+s.productId+'/photo',{method:'POST',headers:{Origin:f.h.origin,
    Cookie:s.owner.cookie,'X-CSRF-Token':s.owner.csrf,'Content-Type':'image/png','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:new Uint8Array(photoSourcePng)});
  assert.equal(uploaded.status,200);await publish(s,f.app);return s;
}

test('APPEARANCE-ROLLBACK-01 old-binary-shaped SELECT/INSERT preserves v1/photo data and permits a publication without appearance',async()=>{
  const s=await prepared(),url=f.h.origin+'/shops/'+s.slug;
  const oldHtml=await(await f.app.request(url)).text(),oldJson=await(await f.app.request(f.h.origin+'/api/v1/public/stores/'+s.slug)).text();
  await isolatedTransaction(f.h.pool,q=>seedAppearanceRows(q,s));
  assert.equal(await(await f.app.request(url)).text(),oldHtml);assert.equal(await(await f.app.request(f.h.origin+'/api/v1/public/stores/'+s.slug)).text(),oldJson);
  const branded=await(await application().request(url)).text();
  assert.match(branded,/合成商店公告/);assert.match(branded,/shop-cover/);
  // Original columns only, with the established tenant binding. This is shape
  // compatibility evidence; it does not claim to execute a deployed old binary.
  const old=await isolatedTransaction(f.runtime,async q=>{
    await bindStore(q,s.tenantId);
    const pub=(await q.query(`SELECT pub.publication_id,pub.instance_id,pub.tenant_id,pub.revision,pub.slug,pub.projection,
      pub.projection_sha256,pub.published_by_principal_id,pub.published_at,pub.template_id,pub.media_sha256
      FROM commerce_storefront_profiles p JOIN commerce_storefront_publications pub ON pub.publication_id=p.current_publication_id
      WHERE p.tenant_id=$1 AND p.instance_id=$2`,[s.tenantId,s.instanceId])).rows[0];
    const refs=(await q.query('SELECT sku,asset_id,representation_id,policy_revision,content_sha256 FROM commerce_publication_photo_refs WHERE publication_id=$1',[pub.publication_id])).rows;
    const usage=(await q.query("SELECT count(*)::int n,sum(o.byte_size)::text bytes FROM assets a JOIN asset_objects o USING(asset_id) WHERE a.tenant_ref=$1 AND a.purpose='storefront.product-photo'",[s.tenantId])).rows[0];
    return {pub,refs,usage};
  });
  assert.equal(old.refs.length,1);assert.equal(old.usage.n,1);assert.ok(BigInt(old.usage.bytes)>0);assert.deepEqual(old.pub.projection,JSON.parse(oldJson));
  const id=randomUUID(),projection={...old.pub.projection,revision:'2',published_at:new Date().toISOString()};
  await isolatedTransaction(f.h.pool,async q=>{
    await q.query(`INSERT INTO commerce_storefront_publications(publication_id,instance_id,tenant_id,revision,slug,projection,projection_sha256,published_by_principal_id,published_at,template_id,media_sha256)
      VALUES($1,$2,$3,2,$4,$5,$6,$7,$8,$9,$10)`,[id,s.instanceId,s.tenantId,s.slug,projection,old.pub.projection_sha256,old.pub.published_by_principal_id,projection.published_at,old.pub.template_id,old.pub.media_sha256]);
    await q.query(`INSERT INTO commerce_publication_photo_refs(publication_id,sku,tenant_id,instance_id,scope_id,asset_id,representation_id,policy_revision)
      SELECT $2,sku,tenant_id,instance_id,scope_id,asset_id,representation_id,policy_revision FROM commerce_publication_photo_refs WHERE publication_id=$1`,[old.pub.publication_id,id]);
    await q.query('UPDATE commerce_storefront_profiles SET current_publication_id=$2,version=version+1 WHERE instance_id=$1',[s.instanceId,id]);
  });
  assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_publication_appearances WHERE publication_id=$1',[id])).rows[0].n,0);
  const current=await(await application().request(url)).text();assert.match(current,/data-shop-accent="lime"/);assert.doesNotMatch(current,/shop-cover|shop-merchant-logo|shop-featured|合成商店公告/);
  const draft=f.ok(await f.h.call('GET',s.root+'/appearance-settings',s.owner,undefined,{},application()));assert.equal(draft.accent_preset,'ocean');assert.equal(draft.dirty,true);
  assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_publication_appearance_refs WHERE publication_id=$1',[old.pub.publication_id])).rows[0].n,2);
});

test('APPEARANCE-ROLLBACK-02 flag OFF renders identical HTML and JSON without SELECT privilege on any appearance table',async()=>{
  const s=await prepared(),url=f.h.origin+'/shops/'+s.slug,oldHtml=await(await f.app.request(url)).text();
  await isolatedTransaction(f.h.pool,q=>seedAppearanceRows(q,s));
  const tables=['commerce_storefront_appearance_drafts','commerce_storefront_appearance_targets','commerce_publication_appearances','commerce_publication_appearance_refs'];
  const before=await Promise.all(tables.map(async table=>(await f.h.pool.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
  await f.h.pool.query(`REVOKE SELECT ON ${tables.join(',')} FROM ${f.role}`);
  try{
    assert.equal(await(await f.app.request(url)).text(),oldHtml);
    const json=await f.app.request(f.h.origin+'/api/v1/public/stores/'+s.slug);assert.equal(json.status,200);
    f.ok(await f.h.call('GET',s.root+'/preview',s.owner,undefined,{},f.app));
    const view=f.ok(await f.h.call('GET',s.root,s.owner,undefined,{},f.app));f.ok(await f.h.call('POST',s.root+'/publish',s.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':`"${view.version}"`},f.app));
    assert.equal(await(await f.app.request(url)).text(),oldHtml);
  }finally{await f.h.pool.query(`GRANT SELECT ON ${tables.join(',')} TO ${f.role}`);}
  const after=await Promise.all(tables.map(async table=>(await f.h.pool.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));assert.deepEqual(after,before);
  assert.match(await(await application().request(url)).text(),/data-shop-accent="ocean"/);
});

test('APPEARANCE-JOURNEY own-stock cash meetup completes while every buyer shell keeps its frozen accent and logo',async()=>{
  const s=await f.openStore();await f.h.pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-branded-order',retained_byte_limit=16777216 WHERE purpose='storefront.product-photo'");
  const release=(await f.h.pool.query('SELECT version::text FROM module_instances WHERE instance_id=$1',[s.instanceId])).rows[0].version;
  f.ok(await f.h.call('POST',s.root+'/upgrade',s.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':`"${release}"`},f.app));
  f.ok(await f.h.call('PATCH',s.root+'/products/'+s.productId,s.owner,{title:'合成完整訂單商品',description:'合成商品介紹',price_minor:1200,stock:10}, {'Idempotency-Key':randomUUID(),'If-Match':'"1"'},f.app));
  const profiles=['offline.cash_on_meetup.v1'],ports:CheckoutPorts={admission:{allowed:()=>true},shipping:syntheticShippingPort({method_ref:'meetup'}),paymentMethods:createPaymentMethodsPort({environment:'sandbox',profiles})};
  const assets=createStorefrontAppearanceLifecycle(f.runtime,{store:f.store}),app=f.application(true,{storeAppearanceEnabled:true,storeAppearanceAssets:assets,
    commerceSettings:{checkoutEnabled:true,consoleEnabled:true,quarantine:false,providerProfiles:profiles},commercePorts:ports});
  const input={template_id:'catalog-grid-v1',accent_preset:'graphite',announcement:'合成品牌交易公告',featured_product_ids:[s.productId]};
  f.ok(await f.h.call('PATCH',s.root+'/appearance-settings',s.owner,input,{'Idempotency-Key':randomUUID(),'If-Match':'"1"'},app));
  const uploaded=await app.request(f.h.origin+'/api/v1'+s.root+'/appearance-media/logo',{method:'POST',headers:{Origin:f.h.origin,Cookie:s.owner.cookie,
    'X-CSRF-Token':s.owner.csrf,'Content-Type':'image/png','Idempotency-Key':randomUUID(),'If-Match':'"2"'},body:new Uint8Array(photoSourcePng)});assert.equal(uploaded.status,200);AppearanceCommandAckSchema.parse(await uploaded.json());
  await publish(s,app);
  const tx=<T>(run:Parameters<typeof isolatedTransaction<T>>[1])=>isolatedTransaction(f.runtime,run);
  const principal=await tx(q=>mapPersonPrincipal(q,s.owner.user.user_id)),paymentSettings={schema:'freedom.offline-payment-settings/v1',bank_transfer:null,cash_on_meetup:{deadline_days:7}};
  await f.h.pool.query(`INSERT INTO commerce_offline_payment_settings(tenant_id,instance_id,version,document,document_sha256,created_by_principal_id)
    VALUES($1,$2,1,$3,$4,$5)`,[s.tenantId,s.instanceId,paymentSettings,createHash('sha256').update(canonicalJSON(paymentSettings)).digest('hex'),principal.principal_id]);
  const store=(await f.h.pool.query('SELECT storefront_shop_id,supply_shop_id FROM commerce_storefront_profiles WHERE instance_id=$1',[s.instanceId])).rows[0];
  const checkout=await tx(q=>freezeCheckout(q,{...s,...store},{publication_revision:'1',lines:[{sku:'P0001',quantity:1}],contact:{name:'合成買家',email:'synthetic-order@example.invalid',phone:'0000000000'},
    delivery:{method:'meetup'},invoice:null,consents:[],idempotencyKey:randomUUID()},ports));
  const order=await tx(q=>placeCheckoutOrder(q,{...s,...store},{checkoutId:checkout.checkout_id,termsSha256:checkout.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:principal.principal_id,environment:'sandbox',paymentMethod:'cash_on_meetup'},ports));
  for(const path of ['', '/products/P0001','/cart','/checkout','/orders/'+order.order_id]){
    const response=await app.request(f.h.origin+'/shops/'+s.slug+path);assert.equal(response.status,200);const html=await response.text();
    assert.match(html,/data-shop-accent="graphite"/);assert.match(html,/shop-merchant-logo/);assert.match(html,/合成品牌交易公告/);
    for(const value of [s.owner.user.email,'synthetic-order@example.invalid','0000000000',s.tenantId,s.instanceId])assert.ok(!html.includes(value));
  }
  const date=(await f.h.pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') AS d")).rows[0].d;
  const completed=await completeMeetup(f.runtime,s.actor,s.tenantId,s.instanceId,order.order_id,{amount_minor:order.terms.total_minor,completed_on:date},randomUUID(),order.version);
  assert.ok(completed.meetup_handover);assert.equal(completed.actions.complete_meetup,false);
  assert.deepEqual((await f.h.pool.query('SELECT stock::int,reserved::int FROM commerce_items WHERE item_id=$1',[s.productId])).rows,[{stock:9,reserved:0}]);
  assert.equal((await f.h.pool.query('SELECT outcome FROM commerce_checkout_payment_applications WHERE order_id=$1',[order.order_id])).rows[0].outcome,'converted');
  assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_payment_attempts WHERE order_id=$1',[order.order_id])).rows[0].n,0);
});
