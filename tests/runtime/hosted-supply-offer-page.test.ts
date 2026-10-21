import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {createApp} from '../../apps/platform-api/src/app.js';
import {authenticate} from '../../modules/identity-membership/service.js';
import {storeRead,profile,ready} from '../../modules/agent-commerce/hosted/store.js';
import {createShippingQuotePort} from '../../modules/agent-commerce/fulfilment/quote/index.js';
import {SupplyOfferPageSchema} from '../../contracts/guild-launchpad/v1/hosted-distribution.js';
import {checkoutHarness,ok,type CheckoutHarness} from './hosted-checkout-harness.js';
import type {Session} from './module-registry-harness.js';

let x:CheckoutHarness;
type Store=Awaited<ReturnType<CheckoutHarness['store']>>;
before(async()=>{x=await checkoutHarness('fp_supply_page');});
after(async()=>{await x?.stop();});
beforeEach(async()=>{await x.reset();});
const get=(s:Store,path:string,session=s.owner)=>x.h.call('GET',s.root+path,session,undefined,{},x.app);
const send=(s:Pick<Store,'root'|'owner'>,path:string,body:unknown={},version?:string,method='POST',key=randomUUID())=>
  x.h.call(method,s.root+path,s.owner,body,{'Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})},x.app);
const read=(s:Store,id:string)=>get(s,'/supply-catalog/'+id).then(r=>SupplyOfferPageSchema.parse(ok(r)));
async function fixture(){
  const supplier=await x.store(73),seller=await x.store(10,false),outsider=await x.store(10,false);
  const terms=ok(await send(supplier,`/products/${supplier.product.product_id}/supply-terms`,{
    cost_minor:400,shipping_minor:50,shipping_terms:'三個工作天內出貨\n每件另計包裝運費',return_terms:'瑕疵七日內換貨\n退貨運費由供應商負擔',
  },supplier.product.version,'PATCH'));
  const offer=ok(await send(supplier,`/products/${supplier.product.product_id}/supply-offer`,{},terms.version));
  return {supplier,seller,outsider,offer,terms};
}
const propose=(s:Store,o:any,previous?:any)=>send(s,'/distribution-selections'+(previous?'/'+previous.selection_id:''),{
  offer_id:o.offer_id,terms_sha256:o.terms_sha256,retail_price_minor:1200,
},previous?.version,previous?'PATCH':'POST').then(r=>ok(r,previous?200:201));
const decide=(s:Store,selection:any,decision='accepted',reason?:string,key=randomUUID())=>send(s,`/supply-requests/${selection.selection_id}/decision`,{
  decision,listing_sha256:selection.listing_sha256,...(reason===undefined?{}:{reason}),
},selection.version,'POST',key);
async function admit(s:Store,enabled:boolean){const current=ok(await get(s,'/reservation-setting'));ok(await send(s,'/reservation-setting',{reservation_enabled:enabled},current.version,'PATCH'));}
async function quote(s:Store,buyer:Session,sku:string){
  const v=ok(await get(s,''));
  return x.h.call('POST',`/hosted-stores/${s.slug}/reservation-quotes`,buyer,{publication_revision:v.publication.current_revision,items:[{sku,quantity:1}]},{'Idempotency-Key':randomUUID()},x.app);
}

test('offer detail keeps catalog authority, exact adopted withdrawal access, strict query and private caching',async()=>{
  const {supplier,seller,outsider,offer}=await fixture();
  const response=await get(seller,'/supply-catalog/'+offer.offer_id);
  ok(response);assert.equal(response.response.headers.get('Cache-Control'),'private, no-store');
  ok(await get(seller,'/supply-catalog/'+offer.offer_id+'?stock=true'),422);
  const viewer=(await x.h.person('唯讀選品會員')).session,principal=await x.h.candidate(seller.owner,viewer.user.user_id);
  const invitation=await x.h.post(`/tenants/${seller.tenantId}/invitations`,seller.owner,{invitee_principal_id:principal,role:'operator',instance_capabilities:[{instance_id:seller.instanceId,capabilities:['store:read']}],expires_at:new Date(Date.now()+86400000).toISOString()});
  ok(invitation,201);await x.h.accept(viewer,seller.tenantId,invitation);
  const refused=await get(seller,'/supply-catalog/'+offer.offer_id,viewer);
  assert.equal(refused.status,(await get(seller,'/supply-catalog',viewer)).status);assert.equal(refused.status,403);
  // Currency is independent of offer state: the offered version is still live.
  await x.h.pool.query("UPDATE commerce_shops SET currency='USD' WHERE shop_id=ANY($1::uuid[])",[ [outsider.supply_shop_id,outsider.storefront_shop_id] ]);
  const wrongCurrency=await get(outsider,'/supply-catalog/'+offer.offer_id);ok(wrongCurrency,404);assert.equal(wrongCurrency.data.code,'supply_offer_not_found');
  const other=randomUUID();await x.h.pool.query("INSERT INTO communities(community_id,name) VALUES($1,'合成隔離社群')",[other]);
  const foreignPerson=await x.h.person('其他社群店主');
  await x.h.pool.query('UPDATE users SET community_id=$1 WHERE user_id=$2',[other,foreignPerson.id]);
  await x.h.pool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier) VALUES($1,$2,$3,'guild_commerce_sales','active','full')`,[randomUUID(),other,foreignPerson.id]);
  await x.h.pool.query(`INSERT INTO guild_application_offerings(offering_id,community_id,guild_key,application_key,release_ref,status,display_order,launch_policy_ref,version)
    VALUES($1,$2,'guild_commerce_sales','hosted-store','hosted-store@1.0.0','offered',10,'{"policy_key":"hosted-store.launch","version":"1"}',1)`,[randomUUID(),other]);
  const foreignSpace=await x.h.createTenant(foreignPerson.session,'其他社群供應商');
  const plan=await x.h.plan(foreignPerson.session,foreignSpace.tenantId,x.h.planBody('guild_commerce_sales',foreignSpace.workspaceId,'hosted-store','hosted-store@1.0.0'));ok(plan,201);
  assert.equal((await x.h.launch(foreignPerson.session,foreignSpace.tenantId,plan)).data.state,'succeeded');
  const instance=(await x.h.pool.query("SELECT instance_id FROM module_instances WHERE tenant_id=$1 AND module_key='storefront'",[foreignSpace.tenantId])).rows[0].instance_id;
  const foreign={root:`/tenants/${foreignSpace.tenantId}/storefronts/${instance}`,owner:foreignPerson.session};
  ok(await send(foreign,'/setup',{name:'其他社群供應商',slug:'foreign-'+randomUUID().slice(0,12),currency:'TWD'}),201);
  const item=ok(await send(foreign,'/products',{title:'其他社群商品',price_minor:100,stock:10}),201);
  const foreignOffer=ok(await send(foreign,`/products/${item.product_id}/supply-offer`,{},item.version));
  const denied=await get(seller,'/supply-catalog/'+foreignOffer.offer_id);ok(denied,404);assert.equal(denied.data.code,'supply_offer_not_found');
  await propose(seller,offer);
  ok(await send(supplier,`/supply-offers/${offer.offer_id}/withdraw`,{},offer.version));
  assert.equal((await read(seller,offer.offer_id)).offer.state,'withdrawn');
  await x.h.pool.query("UPDATE commerce_shops SET currency='TWD' WHERE shop_id=ANY($1::uuid[])",[[outsider.supply_shop_id,outsider.storefront_shop_id]]);
  const r=await get(outsider,'/supply-catalog/'+offer.offer_id);ok(r,404);assert.equal(r.data.code,'supply_offer_not_found');
});

test('detail projects only offered text, safe roles and public supplier link; private edits and stock stay private',async()=>{
  const {supplier,seller,offer,terms}=await fixture();
  ok(await send(supplier,`/products/${supplier.product.product_id}/supply-terms`,{cost_minor:900,shipping_minor:80,shipping_terms:'未公開的出貨草稿',return_terms:'未公開的退貨草稿'},terms.version,'PATCH'));
  const dto=await read(seller,offer.offer_id),json=JSON.stringify(dto);
  assert.equal(dto.offer.terms.cost_minor,400);assert.equal(dto.supplier.public_path,'/shops/'+supplier.slug);
  assert.equal(dto.published_at,offer.published_at);assert.equal(dto.selection,null);
  assert.deepEqual(dto.offer.arrangement,{mode:'reseller',seller_of_record:'seller',payment_collector:'seller',invoice_issuer:'seller',refund_owner:'seller',price_owner:'seller',fulfillment_party:'supplier'});
  for(const value of [supplier.tenantId,supplier.instanceId,supplier.owner.user.email,supplier.owner.user.user_id,'未公開的出貨草稿','未公開的退貨草稿','"stock"','"reserved"','"bank"'])assert.equal(json.includes(value),false,'private field escaped offer allowlist');
  ok(await send(supplier,'/unpublish',{},ok(await get(supplier,'')).version));
  assert.equal((await read(seller,offer.offer_id)).supplier.public_path,null);
});

test('display follows propose, accept, revoke and re-propose; decision notes survive re-proposal and receipt replay binds the reason',async()=>{
  const {supplier,seller,offer}=await fixture();
  assert.equal((await read(seller,offer.offer_id)).sale_paths.display.available,true,'before selection previews the approved path');
  let selection=await propose(seller,offer);
  assert.equal((await read(seller,offer.offer_id)).sale_paths.display.available,false);
  assert.equal(ok(await get(seller,'/preview')).projection.products.length,0);
  const key=randomUUID(),decline=ok(await decide(supplier,selection,'declined','  請先調整合作售價  ',key));
  assert.equal(decline.decision_note,'請先調整合作售價');
  assert.deepEqual(ok(await decide(supplier,selection,'declined','  請先調整合作售價  ',key)),decline);
  const conflict=await decide(supplier,selection,'declined','另一個原因',key);ok(conflict,409);assert.equal(conflict.data.code,'idempotency_conflict');
  assert.equal((await read(seller,offer.offer_id)).decision_note,'請先調整合作售價');
  assert.equal(ok(await get(seller,'/distribution-selections')).items[0].decision_note,'請先調整合作售價');
  selection=await propose(seller,offer,decline);
  assert.equal((await read(seller,offer.offer_id)).decision_note,'請先調整合作售價');
  ok(await decide(supplier,selection,'declined','字'.repeat(501)),422);
  selection=ok(await decide(supplier,selection));
  assert.equal(selection.decision_note,null);assert.equal((await read(seller,offer.offer_id)).sale_paths.display.available,true);
  assert.equal(ok(await get(seller,'/preview')).projection.products.length,1);
  selection=ok(await decide(supplier,selection,'revoked','暫停這間店的合作'));
  assert.equal((await read(seller,offer.offer_id)).sale_paths.display.available,false);
  assert.equal(ok(await get(seller,'/preview')).projection.products.length,0);
  assert.equal((await read(seller,offer.offer_id)).decision_note,'暫停這間店的合作');
  assert.deepEqual((await x.h.pool.query('SELECT note FROM commerce_distribution_acceptances ORDER BY created_at,acceptance_id')).rows.map(r=>r.note),['請先調整合作售價','','暫停這間店的合作']);
  selection=await propose(seller,offer,selection);
  assert.equal((await read(seller,offer.offer_id)).sale_paths.display.available,false);
  await decide(supplier,selection);
  ok(await send(supplier,`/supply-offers/${offer.offer_id}/withdraw`,{},offer.version));
  assert.equal((await read(seller,offer.offer_id)).sale_paths.display.available,false);
});

test('reservation matches real shared storefront quotes in both settings and exact publication state',async()=>{
  const {supplier,seller,offer}=await fixture(),selection=ok(await decide(supplier,await propose(seller,offer)));
  const buyer=(await x.h.person('合成預留會員')).session;
  await x.publish(seller);
  assert.equal((await read(seller,offer.offer_id)).sale_paths.reservation.available,true);
  ok(await quote(seller,buyer,selection.sku),201);
  await admit(supplier,false);
  assert.deepEqual((await read(seller,offer.offer_id)).sale_paths.reservation,{available:false,reason:'supply_unavailable'});
  const refused=await quote(seller,buyer,selection.sku);ok(refused,409);assert.equal(refused.data.code,'supply_unavailable');
  await admit(supplier,true);await admit(seller,false);
  assert.equal((await read(seller,offer.offer_id)).sale_paths.reservation.reason,'reservation_not_enabled');
  assert.equal((await quote(seller,buyer,selection.sku)).data.code,'reservation_not_enabled');
  await admit(seller,true);
  await propose(seller,offer,selection);
  assert.equal((await read(seller,offer.offer_id)).sale_paths.reservation.available,false);
  assert.equal((await quote(seller,buyer,selection.sku)).data.code,'supply_unavailable');
});

test('unpublished supplier lifecycle is unknown without crossing tenant RLS; flag OFF stays unavailable',async()=>{
  const {supplier,seller,offer}=await fixture();await decide(supplier,await propose(seller,offer));await x.publish(seller);
  ok(await send(supplier,'/unpublish',{},ok(await get(supplier,'')).version));
  assert.deepEqual((await read(seller,offer.offer_id)).sale_paths.reservation,{available:false,reason:'unknown'});
  const disabled=createApp(x.runtime,x.h.origin,'local',{guildLaunchpadEnabled:true});
  const dto=ok(await x.h.call('GET',seller.root+'/supply-catalog/'+offer.offer_id,seller.owner,undefined,{},disabled));
  assert.deepEqual(dto.sale_paths.reservation,{available:false,reason:'not_configured'});
});

test('checkout classification equals the production cart shipping quote for a supplied line',async()=>{
  const {supplier,seller,offer}=await fixture(),selection=ok(await decide(supplier,await propose(seller,offer)));
  await x.publish(seller);
  // Meetup uses the real SQL-local shipping port and never calls a provider.
  const version=(await x.h.pool.query('SELECT version::text FROM module_instances WHERE instance_id=$1',[seller.instanceId])).rows[0].version;
  ok(await send(seller,'/upgrade',{},version));
  const shippingApp=createApp(x.runtime,x.h.origin,'local',{guildLaunchpadEnabled:true,commerceSettings:{consoleEnabled:true,checkoutEnabled:false,quarantine:false,providerProfiles:[]}});
  ok(await x.h.call('PUT',seller.root+'/shipping-profile',seller.owner,{schema:'freedom.shipping-profile/v1',working_days:[1,2,3,4,5],services:[],delivery_options:[{method:'meetup',note:'店內面交'}],drop_ship:null},{'Idempotency-Key':randomUUID()},shippingApp),201);
  const actor=await authenticate(x.runtime,seller.owner.cookie.split('=')[1].split(';')[0]);
  const cart=await storeRead(x.runtime,actor,seller.tenantId,seller.instanceId,'store:write',async q=>{
    const p=await profile(q,seller.tenantId,seller.instanceId);ready(p);
    return createShippingQuotePort({environment:'sandbox'}).cart!(q,p,{delivery:{method:'meetup'},merchandise_net_minor:1200,
      lines:[{sku:selection.sku,item_id:offer.product_id,quantity:1,unit_price_minor:1200,supplier_shop_id:supplier.supply_shop_id,own:false}]});
  }) as {shipping:{state:string;lines:{reason:string}[]}};
  const path=(await read(seller,offer.offer_id)).sale_paths.checkout;
  assert.equal(cart.shipping.state,'unavailable');assert.deepEqual(path,{available:false,reason:'fulfilment_not_agreed'});
  assert.equal(path.reason,cart.shipping.lines[0].reason);
});
