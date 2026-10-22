import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,beforeEach,after,test} from 'node:test';
import type {PoolClient} from 'pg';
import {createApp} from '../../apps/platform-api/src/app.js';
import {DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {mapPersonPrincipal} from '../../packages/resource-scopes/index.js';
import {authenticate} from '../../modules/identity-membership/service.js';
import {SelfShipmentInputSchema,SellerCheckoutOrderSchema} from '../../contracts/guild-launchpad/v1/hosted-seller-checkout.js';
import {ShippingProfileInputSchema} from '../../contracts/guild-launchpad/v1/hosted-shipping.js';
import {CheckoutTermsSchema,PublicOrderSchema} from '../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {canonicalJSON,hashJSON,freezeCheckout,validateShippingQuote,type CheckoutPorts} from '../../modules/agent-commerce/checkout/terms.js';
import {checkoutInventory} from '../../modules/agent-commerce/checkout/inventory.js';
import {placeCheckoutOrder} from '../../modules/agent-commerce/checkout/orders.js';
import {cancelPaidOrder,retryAllocation} from '../../modules/agent-commerce/checkout/payments.js';
import {bindStore,lockStore} from '../../modules/agent-commerce/checkout/authority.js';
import {publicOrder} from '../../modules/agent-commerce/checkout/public-order.js';
import {selfShipBy} from '../../modules/agent-commerce/checkout/self-ship-view.js';
import {readSellerCheckoutOrder,readSellerOrderContact,cancelSellerCheckoutOrder} from '../../modules/agent-commerce/checkout/seller-orders.js';
import {createOrderNotifications} from '../../modules/agent-commerce/checkout/order-notifications.js';
import {createShippingQuotePort} from '../../modules/agent-commerce/fulfilment/quote/index.js';
import {selfShipQuote} from '../../modules/agent-commerce/fulfilment/quote/self-ship.js';
import {parseCheckoutDelivery} from '../../modules/agent-commerce/fulfilment/quote/delivery-input.js';
import {saveShippingProfile} from '../../modules/agent-commerce/fulfilment/settings/profile.js';
import {recordSelfShipment,shipmentInput} from '../../modules/agent-commerce/fulfilment/self-shipments.js';
import {confirmOfflinePayment} from '../../modules/agent-commerce/payments/offline/confirm.js';
import {createPaymentMethodsPort} from '../../modules/agent-commerce/payments/offline/methods.js';
import {checkoutHarness,type CheckoutHarness,code} from './hosted-checkout-harness.js';

let x:CheckoutHarness;
const settings={checkoutEnabled:true,consoleEnabled:true,quarantine:false,providerProfiles:['offline.bank_transfer.v1','offline.cash_on_meetup.v1']};
const ports:CheckoutPorts={admission:{allowed:()=>true},shipping:createShippingQuotePort({environment:'sandbox',selfShipEnabled:true}),paymentMethods:createPaymentMethodsPort({environment:'sandbox',profiles:settings.providerProfiles})};
const notices={orderNotifications:createOrderNotifications(true,settings)};
const recipient={method:'self_ship',name:'合成收件人',mobile:'0912345678',postal_code:'100',address:'合成路1號'};
const profile=(fee=6000)=>({schema:'freedom.shipping-profile/v1',working_days:[1,2,3,4,5],services:[],delivery_options:[{method:'self_ship',fee_per_order_minor:fee,handling_days:2,note:'合成店家自行寄送'}],drop_ship:null});
const actor=(cookie:string)=>authenticate(x.runtime,cookie.split('=')[1].split(';')[0]);
before(async()=>{x=await checkoutHarness('fp_self_ship');});
beforeEach(async()=>x.reset());
after(async()=>x?.stop());
async function today(){return (await x.h.pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') AS day")).rows[0].day as string;}
async function prepared(fee=6000){
  const s=await x.store(20),owner=await actor(s.owner.cookie),principal=await x.tx(q=>mapPersonPrincipal(q,s.owner.user.user_id));
  const release=(await x.h.pool.query('SELECT version::text FROM module_instances WHERE instance_id=$1',[s.instanceId])).rows[0].version;
  const upgraded=await x.h.call('POST',`${s.root}/upgrade`,s.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':`"${release}"`},x.app);assert.equal(upgraded.status,200,JSON.stringify(upgraded.data));
  const bank={schema:'freedom.offline-payment-settings/v1',bank_transfer:{bank_code:'123',bank_name:'合成銀行',branch_name:null,account_number:'1234567890',account_name:'合成商店',deadline_days:3,note:null},cash_on_meetup:{deadline_days:7}};
  await x.h.pool.query(`INSERT INTO commerce_offline_payment_settings(tenant_id,instance_id,version,document,document_sha256,created_by_principal_id) VALUES($1,$2,1,$3,$4,$5)`,[s.tenantId,s.instanceId,bank,hashJSON(bank),principal.principal_id]);
  await saveShippingProfile(x.runtime,owner,s.tenantId,s.instanceId,profile(fee),randomUUID(),undefined,'sandbox',true);
  const buyer=await x.h.person('合成買家'),buyerPrincipal=await x.tx(q=>mapPersonPrincipal(q,buyer.id));
  const input={...x.input(s.product.sku,2),contact:{name:'合成買家',email:buyer.session.user.email,phone:'0912345678'},delivery:recipient};
  const frozen=await x.tx(q=>freezeCheckout(q,s,{...input,idempotencyKey:randomUUID()},ports));
  const order=await x.tx(q=>placeCheckoutOrder(q,s,{checkoutId:frozen.checkout_id,termsSha256:frozen.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:buyerPrincipal.principal_id,environment:'sandbox',paymentMethod:'bank_transfer'},ports));
  return {s,owner,buyer,buyerPrincipal,principal,input,frozen,order};
}
async function paid(){const f=await prepared();await confirmOfflinePayment(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,f.order.order_id,{amount_minor:f.order.terms.total_minor,received_on:await today()},randomUUID(),'1');return f;}
const body=async()=>({carrier_key:'other',carrier_name:'合成物流',tracking_number:'SYNTHETIC-123',sent_on:await today()});
async function ship(f:Awaited<ReturnType<typeof prepared>>,input:unknown,key=randomUUID(),expected='1') {return recordSelfShipment(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,f.order.order_id,input,key,expected,notices);}
async function buyerView(f:Awaited<ReturnType<typeof prepared>>){return x.tx(async q=>{await bindStore(q,f.s.tenantId);return publicOrder(q,{instanceId:f.s.instanceId,tenantId:f.s.tenantId,projection:{slug:f.s.slug,name:'合成商店'}},f.order.order_id);});}
async function balances(id:string){return (await x.h.pool.query('SELECT stock::int,reserved::int FROM commerce_items WHERE item_id=$1',[id])).rows[0];}
async function denied(run:()=>Promise<unknown>,expected:string){await assert.rejects(run,code(expected));}

test('manual contracts, normalization, consent and Monday–Friday promises are independent of ECPay',()=>{
  assert(SelfShipmentInputSchema.safeParse({carrier_key:'post',tracking_number:'ABC-123',sent_on:'2026-10-22'}).success);
  for(const fee of [0,100,1_000_000])assert(ShippingProfileInputSchema.safeParse(profile(fee)).success);
  for(const fee of [-100,1,100.5,1_000_100])assert(!ShippingProfileInputSchema.safeParse(profile(fee)).success);
  assert.equal(selfShipBy(new Date('2026-10-23T02:00:00Z'),1),'2026-10-26');
  assert.equal(selfShipBy(new Date('2026-12-31T00:00:00Z'),1),'2027-01-01');
  assert.equal(selfShipBy(new Date('2026-10-24T02:00:00Z'),1),'2026-10-26');
  assert.equal(selfShipBy(new Date('2026-10-26T02:00:00Z'),1),'2026-10-27');
  assert.equal(selfShipBy(new Date('2026-10-22T16:01:00Z'),2),'2026-10-27');
  const normalized=ports.shipping!.normalizeDelivery!({...recipient,name:'  合成收件人  ',mobile:'+886 912-345-678',postal_code:'１００',address:'  合成路１號  '});
  assert.deepEqual(normalized,recipient);
  assert.equal(parseCheckoutDelivery({...recipient,name:'Echo'}).ok,true);
  for(const patch of [{mobile:'09\n12345678'},{address:'合成<>路'},{postal_code:'999'},{bonus:'private-sentinel'}])assert.equal(parseCheckoutDelivery({...recipient,...patch}).ok,false);
  const line={sku:'P0001',item_id:randomUUID(),supplier_shop_id:randomUUID(),quantity:2,unit_price_minor:100,own:true};
  const request={lines:[line],sellerShopId:line.supplier_shop_id,profileVersion:'1',fee:6000,handlingDays:2,note:null,outlying:false};
  const quote=selfShipQuote(request);assert.equal(quote.kind,'plan');if(quote.kind!=='plan')return;
  validateShippingQuote({delivery_profile_version:'1',destination_state:'complete',groups:[quote.group]},[line]);
  assert.throws(()=>validateShippingQuote({delivery_profile_version:'1',destination_state:'complete',groups:[{...quote.group,amount_minor:6001,fee_per_parcel_minor:6001}]},[line]),/shipping_quote_invalid/);
  assert.deepEqual(selfShipQuote({...request,lines:[{...line,own:false}],outlying:true}),{kind:'unavailable',lines:[{sku:line.sku,reason:'fulfilment_not_agreed'}]});
  assert.deepEqual(selfShipQuote({...request,outlying:true}),{kind:'unavailable',lines:[{sku:line.sku,reason:'outlying_unsupported'}]});
  assert.throws(()=>shipmentInput({carrier_key:'post',carrier_name:'extra',tracking_number:'123',sent_on:'2026-10-22'}),code('validation_failed'));
});

test('quote, normalized freeze/replay and place include one fixed fee and only bank transfer',async()=>{
  const f=await prepared(),key=randomUUID();CheckoutTermsSchema.parse(f.order.terms);
  assert.deepEqual(f.order.terms.payment_methods,['bank_transfer']);assert.equal(f.order.terms.shipping_total_minor,6000);assert.equal(f.order.terms.total_minor,6200);
  assert.equal(f.order.terms.shipping.groups[0].parcels.length,1);assert.equal(f.order.terms.shipping.groups[0].logistics,null);
  const normalized=await x.tx(q=>freezeCheckout(q,f.s,{...f.input,delivery:{...recipient,address:'  合成路１號  '},idempotencyKey:key},ports));
  const replay=await x.tx(q=>freezeCheckout(q,f.s,{...f.input,idempotencyKey:key},ports));assert.equal(replay.checkout_id,normalized.checkout_id);
  assert.deepEqual((await x.h.pool.query('SELECT delivery FROM commerce_checkout_contacts WHERE contact_id=(SELECT current_contact_id FROM commerce_checkouts WHERE checkout_id=$1)',[normalized.checkout_id])).rows[0].delivery,recipient);
  const before=await balances(f.s.product.product_id);
  await denied(()=>x.tx(q=>placeCheckoutOrder(q,f.s,{checkoutId:normalized.checkout_id,termsSha256:normalized.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:f.buyerPrincipal.principal_id,environment:'sandbox',paymentMethod:'cash_on_meetup'},ports)),'payment_method_unavailable');
  assert.deepEqual(await balances(f.s.product.product_id),before);
  const cart=await x.tx(async q=>{await bindStore(q,f.s.tenantId);return ports.shipping!.cart!(q,{...(await q.query('SELECT * FROM commerce_storefront_profiles WHERE instance_id=$1',[f.s.instanceId])).rows[0]},{lines:[{sku:f.s.product.sku,item_id:f.s.product.product_id,quantity:2,unit_price_minor:100,supplier_shop_id:f.s.supply_shop_id,own:true}],merchandise_net_minor:200,delivery:{method:'self_ship',postal_code:'880'}});});
  assert.equal((cart as {shipping:{state:string}}).shipping.state,'unavailable');
  await denied(()=>x.tx(q=>freezeCheckout(q,f.s,{...f.input,idempotencyKey:randomUUID()},{...ports,shipping:createShippingQuotePort({environment:'sandbox'})})),'shipping_unavailable');
  await denied(()=>saveShippingProfile(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,profile(7000),randomUUID(),'1','sandbox',false),'self_ship_not_enabled');
  await saveShippingProfile(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,profile(),randomUUID(),'1','sandbox',false);
});

test('shipment is atomic, replay safe, private, still open and blocks paid cancellation',async()=>{
  const f=await paid(),input=await body(),key=randomUUID(),before=await balances(f.s.product.product_id);
  const waiting=PublicOrderSchema.parse(await buyerView(f));assert.equal(waiting.self_ship?.shipment,null);assert.ok(waiting.self_ship?.ship_by);
  const result=SellerCheckoutOrderSchema.parse(await ship(f,input,key));assert.ok(result.self_ship?.shipment);assert.equal(result.actions.record_self_shipment,false);
  assert.equal(result.lifecycle_state,'open');assert.deepEqual(await balances(f.s.product.product_id),{stock:before.stock-2,reserved:before.reserved-2});
  const replay=await ship(f,input,key);assert.deepEqual(replay.self_ship,result.self_ship);
  await denied(()=>ship(f,{...input,tracking_number:'DIFFERENT'},key),'idempotency_conflict');
  await denied(()=>ship(f,input),'self_shipment_already_recorded');
  await denied(()=>x.tx(q=>cancelPaidOrder(q,f.s,{orderId:f.order.order_id,commandRef:randomUUID()})),'order_partially_shipped');
  const buyer=await buyerView(f);assert.equal(buyer.self_ship?.shipment?.tracking_number,input.tracking_number);
  const row=(await x.h.pool.query(`SELECT s.shipment_id,(SELECT count(*)::int FROM commerce_inventory_movements m WHERE m.source_ref=s.shipment_id AND m.kind='ship') AS movements FROM commerce_self_shipments s WHERE s.order_id=$1`,[f.order.order_id])).rows[0];assert.equal(row.movements,1);
  const notice=(await x.h.pool.query("SELECT kind,title,body,source_key,recipient_ref FROM member_notifications WHERE kind='commerce_order_shipped'")).rows;assert.equal(notice.length,1);assert.equal(notice[0].recipient_ref,f.buyer.id);
  const receipts=(await x.h.pool.query("SELECT response FROM scoped_command_receipts WHERE operation='commerce.checkout_order.record_self_shipment'")).rows;assert.deepEqual(receipts,[{response:{id:f.order.order_id}}]);
  for(const secret of [recipient.address,recipient.mobile,input.tracking_number,input.carrier_name]){assert.equal(JSON.stringify(notice).includes(secret),false);assert.equal(JSON.stringify(receipts).includes(secret),false);}
});

test('payment, version, cancellation, date and quarantine guards roll back',async()=>{
  const f=await prepared(),input=await body();
  await denied(()=>ship(f,input),'payment_not_confirmed');
  await denied(()=>ship(f,input,randomUUID(),'2'),'version_conflict');
  await denied(()=>recordSelfShipment(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,f.order.order_id,input,randomUUID(),'1',{settings:{...settings,quarantine:true}}),'commerce_quarantined');
  await confirmOfflinePayment(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,f.order.order_id,{amount_minor:f.order.terms.total_minor,received_on:await today()},randomUUID(),'1');
  for(const sent_on of ['2000-01-01','2099-12-31'])await denied(()=>ship(f,{...input,sent_on}),'shipment_date_invalid');
  const bad=await prepared();await cancelSellerCheckoutOrder(x.runtime,bad.owner,bad.s.tenantId,bad.s.instanceId,bad.order.order_id,randomUUID(),'1');await denied(()=>ship(bad,input,randomUUID(),'2'),'order_cancelled');
  assert.equal((await x.h.pool.query('SELECT count(*)::int n FROM commerce_self_shipments')).rows[0].n,0);
});

test('shipment allows only the one redaction transition and projections never resurrect private references',async()=>{
  const f=await paid();await ship(f,await body());
  for(const sql of ["UPDATE commerce_self_shipments SET tracking_number='FORGED'","UPDATE commerce_self_shipments SET sent_on=sent_on","DELETE FROM commerce_self_shipments","UPDATE commerce_self_shipments SET redacted_at=clock_timestamp()"]){await assert.rejects(x.h.pool.query(sql),code('23514'));}
  await x.h.pool.query('UPDATE commerce_self_shipments SET redacted_at=clock_timestamp(),tracking_number=NULL,carrier_name=NULL WHERE order_id=$1',[f.order.order_id]);
  await assert.rejects(x.h.pool.query("UPDATE commerce_self_shipments SET redacted_at=clock_timestamp(),tracking_number=NULL,carrier_name=NULL"),code('23514'));
  const buyer=await buyerView(f),seller=await readSellerCheckoutOrder(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,f.order.order_id);
  for(const view of [buyer,seller]){assert.equal(view.self_ship?.shipment?.redacted,true);assert.equal(view.self_ship?.shipment?.tracking_number,null);assert.equal(view.self_ship?.shipment?.carrier_name,null);assert.equal(view.self_ship?.shipment?.carrier_key,'other');assert.ok(view.self_ship?.shipment?.sent_on);}
});

test('real grants marker clears stale table/column privileges, is idempotent and fails closed on PUBLIC grants',async()=>{
  const runtime=(await x.runtime.query('SELECT current_user AS name')).rows[0].name;
  const text=await readFile('deploy/cloudflare/sql/20-runtime-grants.psql','utf8');
  const query=text.split('-- BEGIN SELF SHIPMENT GRANTS\n')[1].split('\n\\gexec')[0].replaceAll(":'runtime'",`'${runtime}'`).replace("n.nspname='public'",`n.nspname='${x.h.schema}'`);
  const q=await x.h.pool.connect();
  try{await q.query('BEGIN');await q.query(`GRANT ALL PRIVILEGES ON commerce_self_shipments TO ${runtime} WITH GRANT OPTION; GRANT UPDATE(tracking_number),INSERT(carrier_name) ON commerce_self_shipments TO ${runtime} WITH GRANT OPTION`);
    const apply=async()=>{const statements=(await q.query(query)).rows;assert.equal(statements.length,1);for(const row of statements)await q.query(Object.values(row)[0] as string);};
    await apply();const first=(await q.query("SELECT relacl::text FROM pg_class WHERE oid='commerce_self_shipments'::regclass")).rows;await apply();assert.deepEqual((await q.query("SELECT relacl::text FROM pg_class WHERE oid='commerce_self_shipments'::regclass")).rows,first);
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN','SELECT WITH GRANT OPTION','INSERT WITH GRANT OPTION'])assert.equal((await q.query("SELECT has_table_privilege($1,'commerce_self_shipments',$2) AS ok",[runtime,privilege])).rows[0].ok,['SELECT','INSERT'].includes(privilege),privilege);
    assert.equal((await q.query("SELECT count(*)::int n FROM pg_attribute WHERE attrelid='commerce_self_shipments'::regclass AND attacl IS NOT NULL")).rows[0].n,0);
    await q.query('GRANT UPDATE(tracking_number) ON commerce_self_shipments TO PUBLIC');await assert.rejects(apply,/Unsafe runtime self shipment privileges/);
  }finally{await q.query('ROLLBACK');q.release();}
});


test('unallocatable payment can ship after real retry allocation, while partial stock cannot ship',async()=>{
  const f=await prepared();
  await x.tx(async q=>{await lockStore(q,f.s,[],[f.order.order_id],false);await (await checkoutInventory(q,f.order.order_id)).releaseHolds();await q.query('UPDATE commerce_items SET stock=0 WHERE item_id=$1',[f.s.product.product_id]);});
  await confirmOfflinePayment(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,f.order.order_id,{amount_minor:f.order.terms.total_minor,received_on:await today()},randomUUID(),'1');
  await denied(async()=>ship(f,await body()),'self_shipment_stock_unavailable');
  await x.h.pool.query('UPDATE commerce_items SET stock=10 WHERE item_id=$1',[f.s.product.product_id]);await x.tx(q=>retryAllocation(q,f.s,f.order.order_id));
  assert.equal((await x.h.pool.query('SELECT outcome FROM commerce_checkout_payment_applications WHERE order_id=$1',[f.order.order_id])).rows[0].outcome,'unallocatable');
  await ship(f,await body());
  const partial=await paid();await x.tx(async q=>{await lockStore(q,partial.s,[],[partial.order.order_id],false);await (await checkoutInventory(q,partial.order.order_id)).port.ship(partial.s.product.product_id,1,randomUUID());});
  await denied(async()=>ship(partial,await body()),'self_shipment_stock_unavailable');
});

test('capability revocation denies replays and contact access stays separate from fulfilment',async()=>{
  const f=await paid(),member=await x.h.person('合成操作員'),principal=await x.h.candidate(f.s.owner,member.id);
  await x.h.accept(member.session,f.s.tenantId,await x.h.invite(f.s.owner,f.s.tenantId,principal,'operator'));
  await x.h.pool.query(`INSERT INTO tenant_module_permissions(tenant_id,principal_id,instance_id,capabilities,status,granted_by_principal_id) VALUES($1,$2,$3,ARRAY['store:read','store:orders:read','store:fulfil'],'active',$4)`,[f.s.tenantId,principal,f.s.instanceId,f.principal.principal_id]);
  const clerk=await actor(member.session.cookie),input=await body(),key=randomUUID();
  await denied(()=>readSellerOrderContact(x.runtime,clerk,f.s.tenantId,f.s.instanceId,f.order.order_id),'capability_denied');
  await recordSelfShipment(x.runtime,clerk,f.s.tenantId,f.s.instanceId,f.order.order_id,input,key,'1',notices);
  await x.h.pool.query(`UPDATE tenant_module_permissions SET capabilities=ARRAY['store:read','store:orders:read'],version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND principal_id=$2`,[f.s.tenantId,principal]);
  await denied(()=>recordSelfShipment(x.runtime,clerk,f.s.tenantId,f.s.instanceId,f.order.order_id,input,key,'1',notices),'capability_denied');
  assert.equal((await x.h.pool.query('SELECT count(*)::int n FROM commerce_self_shipments')).rows[0].n,1);
});

test('HTTP shipment action requires CSRF and If-Match, and remains usable with intake off',async()=>{
  const f=await paid();
  const app=createApp(x.runtime,x.h.origin,'local',{registrationCommunityId:DEMO_COMMUNITY,guildLaunchpadEnabled:true,commerceSettings:settings,commerceSelfShipEnabled:false});
  const route=f.s.root+`/checkout-orders/${f.order.order_id}/self-shipments`,input=await body();
  const missing=await x.h.call('POST',route,f.s.owner,input,{'Idempotency-Key':randomUUID()},app);assert.equal(missing.status,428);
  const csrf=await x.h.call('POST',route,f.s.owner,input,{'Idempotency-Key':randomUUID(),'If-Match':'"1"','X-CSRF-Token':'invalid'},app);assert.equal(csrf.status,403);
  const sent=await x.h.call('POST',route,f.s.owner,input,{'Idempotency-Key':randomUUID(),'If-Match':'"1"'},app);assert.equal(sent.status,200,JSON.stringify(sent.data));assert.equal(sent.data.self_ship.shipment.tracking_number,input.tracking_number);
  const anonymous=await app.request(x.h.origin+'/api/v1'+route,{method:'POST',headers:{Origin:x.h.origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:JSON.stringify(input)});assert.equal(anonymous.status,401);
});

test('database rejects committing a shipment without matching ship movements',async()=>{
  const f=await paid(),q=await x.h.pool.connect();
  try {await q.query('BEGIN');await q.query(`INSERT INTO commerce_self_shipments(tenant_id,instance_id,order_id,carrier_key,tracking_number,sent_on,recorded_by_principal_id) VALUES($1,$2,$3,'post','SYNTHETIC-DB',$4,$5)`,[f.s.tenantId,f.s.instanceId,f.order.order_id,await today(),f.principal.principal_id]);await assert.rejects(q.query('COMMIT'),code('23514'));}finally{await q.query('ROLLBACK');q.release();}
  assert.equal((await x.h.pool.query('SELECT count(*)::int n FROM commerce_self_shipments')).rows[0].n,0);
});


test('HTTP delivery validation returns bounded 422 field codes without recipient values or writes',async()=>{
  const f=await prepared();
  const app=createApp(x.runtime,x.h.origin,'local',{registrationCommunityId:DEMO_COMMUNITY,guildLaunchpadEnabled:true,commerceSettings:settings,commerceSelfShipEnabled:true,commercePorts:ports});
  const before=(await x.h.pool.query('SELECT count(*)::int n FROM commerce_checkout_contacts')).rows[0].n;
  for(const key of ['name','mobile','postal_code','address']){
    const delivery:Record<string,unknown>={...recipient};delete delivery[key];
    const response=await x.h.call('POST',`/public/stores/${f.s.slug}/checkouts`,f.buyer.session,{...f.input,delivery},{'Idempotency-Key':randomUUID()},app);
    assert.equal(response.status,422,JSON.stringify(response.data));assert.equal(response.data.code,'delivery_invalid');assert.ok(response.data.fields.some((field:{path:string;code:string})=>field.path===`delivery.${key}`&&field.code==='required'));
    for(const secret of [recipient.name,recipient.address,recipient.mobile])assert.equal(JSON.stringify(response.data).includes(secret),false);
  }
  assert.equal((await x.h.pool.query('SELECT count(*)::int n FROM commerce_checkout_contacts')).rows[0].n,before);
});

test('tenant RLS hides shipment references with unbound/foreign context and preserves own positive reads',async()=>{
  const a=await paid(),b=await paid();await ship(a,await body());await ship(b,await body());
  await x.tx(async q=>{assert.equal((await q.query('SELECT 1 FROM commerce_self_shipments')).rowCount,0);await bindStore(q,a.s.tenantId);assert.equal((await q.query('SELECT 1 FROM commerce_self_shipments WHERE order_id=$1',[a.order.order_id])).rowCount,1);assert.equal((await q.query('SELECT 1 FROM commerce_self_shipments WHERE order_id=$1',[b.order.order_id])).rowCount,0);assert.equal((await q.query('UPDATE commerce_self_shipments SET redacted_at=clock_timestamp(),tracking_number=NULL,carrier_name=NULL WHERE order_id=$1',[b.order.order_id])).rowCount,0);});
  const contact=await readSellerOrderContact(x.runtime,a.owner,a.s.tenantId,a.s.instanceId,a.order.order_id);assert.deepEqual(contact.delivery,recipient);
  await assert.rejects(readSellerOrderContact(x.runtime,a.owner,b.s.tenantId,b.s.instanceId,b.order.order_id));
  const policies=(await x.h.pool.query("SELECT qual,with_check FROM pg_policies WHERE schemaname=$1 AND tablename='commerce_self_shipments'",[x.h.schema])).rows;assert.deepEqual(policies,[{qual:'(tenant_id = freedom_ctx_tenant())',with_check:'(tenant_id = freedom_ctx_tenant())'}]);
});


test('meetup and self ship coexist but a meetup order cannot record self shipment',async()=>{
  const f=await prepared(),mixed={...profile(),delivery_options:[...profile().delivery_options,{method:'meetup',note:'合成面交地點'}]};
  await saveShippingProfile(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,mixed,randomUUID(),'1','sandbox',true);
  const frozen=await x.tx(q=>freezeCheckout(q,f.s,{...f.input,delivery:{method:'meetup',name:'合成買家',mobile:'0912345678'},idempotencyKey:randomUUID()},ports));
  const order=await x.tx(q=>placeCheckoutOrder(q,f.s,{checkoutId:frozen.checkout_id,termsSha256:frozen.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:f.buyerPrincipal.principal_id,environment:'sandbox',paymentMethod:'bank_transfer'},ports));
  await denied(async()=>recordSelfShipment(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,order.order_id,await body(),randomUUID(),'1'),'self_ship_not_selected');
});

test('a notification database failure rolls back the shipment, receipt and stock together',async()=>{
  const f=await paid(),before=await balances(f.s.product.product_id),input=await body();
  await assert.rejects(recordSelfShipment(x.runtime,f.owner,f.s.tenantId,f.s.instanceId,f.order.order_id,input,randomUUID(),'1',{orderNotifications:{emit:async q=>{await q.query("SELECT 1/0");}}}),code('22012'));
  assert.deepEqual(await balances(f.s.product.product_id),before);assert.equal((await x.h.pool.query('SELECT count(*)::int n FROM commerce_self_shipments')).rows[0].n,0);
  assert.equal((await x.h.pool.query("SELECT count(*)::int n FROM scoped_command_receipts WHERE operation='commerce.checkout_order.record_self_shipment'")).rows[0].n,0);
});
