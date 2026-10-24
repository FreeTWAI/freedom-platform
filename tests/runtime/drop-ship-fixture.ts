import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../../apps/platform-api/src/app.js';
import {DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {mapPersonPrincipal} from '../../packages/resource-scopes/index.js';
import {createTenantListCursorCodec} from '../../packages/shared/tenant-list-cursor.js';
import {authenticate} from '../../modules/identity-membership/service.js';
import {hashJSON,freezeCheckout,type CheckoutPorts} from '../../modules/agent-commerce/checkout/terms.js';
import {placeCheckoutOrder} from '../../modules/agent-commerce/checkout/orders.js';
import {createOrderNotifications} from '../../modules/agent-commerce/checkout/order-notifications.js';
import {createShippingQuotePort} from '../../modules/agent-commerce/fulfilment/quote/index.js';
import {saveShippingProfile} from '../../modules/agent-commerce/fulfilment/settings/profile.js';
import {proposeDropShipAgreement,decideDropShipAgreement} from '../../modules/agent-commerce/fulfilment/drop-ship/agreements.js';
import {confirmOfflinePayment} from '../../modules/agent-commerce/payments/offline/confirm.js';
import {createPaymentMethodsPort} from '../../modules/agent-commerce/payments/offline/methods.js';
import {checkoutHarness,ok,type CheckoutHarness} from './hosted-checkout-harness.js';
import {TENANT_CURSOR_TEST_KEY} from './tenant-cursor-fixture.js';
import type {Session} from './module-registry-harness.js';
export const dropSettings={checkoutEnabled:true,consoleEnabled:true,quarantine:false,providerProfiles:['offline.bank_transfer.v1','offline.cash_on_meetup.v1']};
export const dropPorts:CheckoutPorts={admission:{allowed:()=>true},shipping:createShippingQuotePort({environment:'sandbox',selfShipEnabled:true,dropShipEnabled:true}),paymentMethods:createPaymentMethodsPort({environment:'sandbox',profiles:dropSettings.providerProfiles})};
export const dropNotices={orderNotifications:createOrderNotifications(true,dropSettings)};
export const dropOptions={dropShipEnabled:true,...dropNotices};
export const dropRecipient={method:'self_ship',name:'合成收件人',mobile:'0912345678',postal_code:'100',address:'合成路1號'};
export const dropProfile={schema:'freedom.shipping-profile/v1',working_days:[1,2,3,4,5],services:[],delivery_options:[{method:'self_ship',fee_per_order_minor:6000,handling_days:2,note:'合成宅配說明'},{method:'meetup',note:'合成面交說明'}],drop_ship:null};
export const dropHarness=()=>checkoutHarness('fp_drop_ship');
export async function prepareDropShip(x:CheckoutHarness,{accept=true,place=true,pay=true,own=false}={}) {
  const app=createApp(x.runtime,x.h.origin,'local',{tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,guildLaunchpadEnabled:true,supplierConsoleEnabled:true,commerceDropShipEnabled:true,commerceSelfShipEnabled:true,commerceSettings:dropSettings,commercePorts:dropPorts,commerceOrderNotificationsEnabled:true});
  const actor=(session:Session)=>authenticate(x.runtime,session.cookie.split('=')[1].split(';')[0]);
  const store=await x.store(50,own),owner=await actor(store.owner);
  const send=(s:{root:string;owner:Session},path:string,body:unknown={},version?:string,method='POST')=>x.h.call(method,s.root+path,s.owner,body,{'Idempotency-Key':randomUUID(),...(version?{'If-Match':`"${version}"`}:{})},app);
  await x.h.pool.query(`INSERT INTO guild_application_offerings(offering_id,community_id,guild_key,application_key,release_ref,status,display_order,launch_policy_ref,version)
    VALUES($1,$2,'guild_product_quality_supply','hosted-store','hosted-store@1.0.0','offered',10,'{"policy_key":"hosted-store.launch","version":"1"}',1) ON CONFLICT DO NOTHING`,[randomUUID(),DEMO_COMMUNITY]);
  const supplierOwner=(await x.h.person('合成供應商')).session;await x.h.fullMember(supplierOwner.user.user_id,'guild_product_quality_supply');
  const t=await x.h.createTenant(supplierOwner,'合成供貨目錄'),plan=await x.h.plan(supplierOwner,t.tenantId,x.h.planBody('guild_product_quality_supply',t.workspaceId,'hosted-store','hosted-store@1.0.0'));ok(plan,201);assert.equal((await x.h.launch(supplierOwner,t.tenantId,plan)).data.state,'succeeded');
  const instanceId=(await x.h.pool.query("SELECT instance_id FROM module_instances WHERE tenant_id=$1 AND module_key='storefront'",[t.tenantId])).rows[0].instance_id;
  const supplier={...t,instanceId,root:`/tenants/${t.tenantId}/storefronts/${instanceId}`,owner:supplierOwner};
  ok(await send(supplier,'/supply-profile',{name:'合成供應商',description:'供貨目錄',currency:'TWD'}),201);
  for(const s of [store,supplier]){const v=(await x.h.pool.query('SELECT version::text FROM module_instances WHERE instance_id=$1',[s.instanceId])).rows[0].version;ok(await send(s,'/upgrade',{},v));}
  const product=ok(await send(supplier,'/supply-products',{title:'合成供貨商品',description:'合成介紹',cost_minor:400,stock:50}),201);
  const terms=ok(await send(supplier,`/products/${product.product_id}/supply-terms`,{cost_minor:400,shipping_minor:0,shipping_terms:'依代出貨同意寄送',return_terms:'請聯絡店家'},product.version,'PATCH'));
  const offer=ok(await send(supplier,`/products/${product.product_id}/supply-offer`,{},terms.version));
  const selection=ok(await send(store,'/distribution-selections',{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:1200}),201);
  ok(await send(supplier,`/supply-requests/${selection.selection_id}/decision`,{decision:'accepted',listing_sha256:selection.listing_sha256},selection.version));
  const current=ok(await x.h.call('GET',store.root,store.owner,undefined,{},app));ok(await send(store,'/publish',{},current.version));
  const supplierActor=await actor(supplierOwner),principal=await x.tx(q=>mapPersonPrincipal(q,store.owner.user.user_id));
  const bank={schema:'freedom.offline-payment-settings/v1',bank_transfer:{bank_code:'123',bank_name:'合成銀行',branch_name:null,account_number:'1234567890',account_name:'合成商店',deadline_days:3,note:null},cash_on_meetup:{deadline_days:7}};
  await x.h.pool.query(`INSERT INTO commerce_offline_payment_settings(tenant_id,instance_id,version,document,document_sha256,created_by_principal_id) VALUES($1,$2,1,$3,$4,$5)`,[store.tenantId,store.instanceId,bank,hashJSON(bank),principal.principal_id]);
  await saveShippingProfile(x.runtime,owner,store.tenantId,store.instanceId,dropProfile,randomUUID(),undefined,'sandbox',true);
  let agreement=await proposeDropShipAgreement(x.runtime,owner,store.tenantId,store.instanceId,{supplier_instance_id:instanceId,selection_ids:[selection.selection_id],fee_per_order_minor:7000,promise_working_days:4},randomUUID(),undefined,dropOptions);
  if(accept)agreement=await decideDropShipAgreement(x.runtime,supplierActor,supplier.tenantId,instanceId,agreement.agreement_id,'supplier','accept',{terms_sha256:agreement.terms_sha256},randomUUID(),agreement.version,dropOptions);
  const published=ok(await x.h.call('GET',store.root,store.owner,undefined,{},app));
  const sku=(await x.h.pool.query('SELECT hosted_sku FROM commerce_selections WHERE selection_id=$1',[selection.selection_id])).rows[0].hosted_sku;
  const buyer=await x.h.person('合成買家'),buyerPrincipal=await x.tx(q=>mapPersonPrincipal(q,buyer.id));
  const input={...x.input(sku,2),publication_revision:published.publication.current_revision,contact:{name:'合成買家',email:buyer.session.user.email,phone:'0911111111'},delivery:dropRecipient};
  const frozen=accept&&place?await x.tx(q=>freezeCheckout(q,store,{...input,idempotencyKey:randomUUID()},dropPorts)):null;
  const order=frozen?await x.tx(q=>placeCheckoutOrder(q,store,{checkoutId:frozen.checkout_id,termsSha256:frozen.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:buyerPrincipal.principal_id,environment:'sandbox',paymentMethod:'bank_transfer'},{...dropPorts,...dropNotices})):null;
  const today=async()=>(await x.h.pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') AS day")).rows[0].day as string;
  if(order&&pay)await confirmOfflinePayment(x.runtime,owner,store.tenantId,store.instanceId,order.order_id,{amount_minor:order.terms.total_minor,received_on:await today()},randomUUID(),order.version,dropNotices);
  const cursors=createTenantListCursorCodec(TENANT_CURSOR_TEST_KEY,{environment:'local',origin:x.h.origin});
  return {app,store,owner,supplier,supplierActor,agreement,product,selection,sku,input,frozen,order,today,cursors,send,buyer,buyerPrincipal};
}

/** Retained, cross-tenant consent rows for the generic RLS and archive drills; all production constraints stay active. */
export async function seedStandingAgreement(q:import('pg').PoolClient,storeInstance:string,supplierInstance:string){
 const p=(await q.query(`SELECT s.tenant_id,s.instance_id,s.storefront_shop_id,s.created_by_principal_id,
   p.tenant_id AS supplier_tenant_id,p.instance_id AS supplier_instance_id,p.supply_shop_id,p.created_by_principal_id AS signer,
   i.item_id,i.title,i.price_minor FROM commerce_storefront_profiles s JOIN commerce_storefront_profiles p ON p.instance_id=$2
   JOIN commerce_items i ON i.shop_id=p.supply_shop_id WHERE s.instance_id=$1 ORDER BY i.item_id LIMIT 1`,[storeInstance,supplierInstance])).rows[0];assert.ok(p);
 let selection=randomUUID();const id=randomUUID();await q.query(`INSERT INTO commerce_selections(selection_id,shop_id,item_id,retail_price_minor,sale_terms,snapshot,acceptance_state)
   VALUES($1,$2,$3,100,'合成代出貨', $4,'sellable') ON CONFLICT(shop_id,item_id) DO NOTHING`,[selection,p.storefront_shop_id,p.item_id,{sku:'D'+id.slice(0,8),title:p.title,currency:'TWD',price_minor:100}]);
 selection=(await q.query("SELECT selection_id FROM commerce_selections WHERE shop_id=$1 AND item_id=$2 AND acceptance_state='sellable'",[p.storefront_shop_id,p.item_id])).rows[0]?.selection_id;assert.ok(selection);
 await q.query("SELECT set_config('freedom.tenant_id',$1,true)",[p.tenant_id]);
 const digest=hashJSON({products:[selection],fee:0,promise:1});
 await q.query(`INSERT INTO commerce_fulfilment_agreements(agreement_id,tenant_id,instance_id,store_shop_id,supplier_tenant_id,supplier_instance_id,supplier_shop_id,version,fee_per_order_minor,promise_working_days,item_count,terms_sha256,proposed_by_principal_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,1,0,1,1,$8,$9)`,[id,p.tenant_id,p.instance_id,p.storefront_shop_id,p.supplier_tenant_id,p.supplier_instance_id,p.supply_shop_id,digest,p.created_by_principal_id]);
 await q.query(`INSERT INTO commerce_fulfilment_agreement_items(agreement_id,tenant_id,instance_id,supplier_tenant_id,selection_id,item_id,state) VALUES($1,$2,$3,$4,$5,$6,'proposed')`,[id,p.tenant_id,p.instance_id,p.supplier_tenant_id,selection,p.item_id]);
 await q.query("SELECT set_config('freedom.tenant_id',$1,true)",[p.supplier_tenant_id]);
 await q.query(`UPDATE commerce_fulfilment_agreements SET state='accepted',decided_by_principal_id=$2,decided_at=clock_timestamp(),signed_digest=terms_sha256 WHERE agreement_id=$1`,[id,p.signer]);
 await q.query("SELECT set_config('freedom.tenant_id','',true)");return id;
}
