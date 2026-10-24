import {TENANT_CURSOR_TEST_KEY} from './tenant-cursor-fixture.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {lockStore} from '../../modules/agent-commerce/checkout/authority.js';
import {checkoutInventory} from '../../modules/agent-commerce/checkout/inventory.js';
import {retryAllocation} from '../../modules/agent-commerce/checkout/payments.js';
import {confirmOfflinePayment} from '../../modules/agent-commerce/payments/offline/confirm.js';
import {authenticate} from '../../modules/identity-membership/service.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,beforeEach,after,test} from 'node:test';
import {dropHarness,prepareDropShip,dropOptions,dropPorts,dropNotices} from './drop-ship-fixture.js';
import {code,type CheckoutHarness} from './hosted-checkout-harness.js';
import {proposeDropShipAgreement,decideDropShipAgreement,listDropShipAgreements} from '../../modules/agent-commerce/fulfilment/drop-ship/agreements.js';
import {listSupplierDropShipOrders,supplierDropShipCommand} from '../../modules/agent-commerce/fulfilment/drop-ship/orders.js';
import {freezeCheckout} from '../../modules/agent-commerce/checkout/terms.js';
import {bindStore} from '../../modules/agent-commerce/checkout/authority.js';
import {cancelPaidOrder} from '../../modules/agent-commerce/checkout/payments.js';
import {recordSelfShipment} from '../../modules/agent-commerce/fulfilment/self-shipments.js';
import {readSellerCheckoutOrder} from '../../modules/agent-commerce/checkout/seller-orders.js';
import {publicOrder} from '../../modules/agent-commerce/checkout/public-order.js';
import {createShippingQuotePort} from '../../modules/agent-commerce/fulfilment/quote/index.js';
let x:CheckoutHarness;
before(async()=>{x=await dropHarness();});beforeEach(async()=>x.reset());after(async()=>x?.stop());
const keys=(v:object)=>Object.keys(v).sort();
type Fixture=Awaited<ReturnType<typeof prepareDropShip>>;
const list=(f:Fixture,tab='waiting')=>listSupplierDropShipOrders(x.runtime,f.supplierActor,f.supplier.tenantId,f.supplier.instanceId,{tab},f.cursors);
const ship=async(f:Fixture,key=randomUUID(),extra:Record<string,unknown>={})=>supplierDropShipCommand(x.runtime,f.supplierActor,f.supplier.tenantId,f.supplier.instanceId,f.order!.order_id,'ship',{carrier_key:'post',tracking_number:'SYNTHETIC-123',sent_on:await f.today(),...extra},key,f.order!.version,dropNotices);
const decide=(f:Fixture,id:string,version:string,action:'accept'|'decline'|'revoke',body:unknown)=>decideDropShipAgreement(x.runtime,f.supplierActor,f.supplier.tenantId,f.supplier.instanceId,id,'supplier',action,body,randomUUID(),version,dropOptions);
const proposal=(f:Fixture,expected:string,fee=0)=>proposeDropShipAgreement(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,{supplier_instance_id:f.supplier.instanceId,selection_ids:[f.selection.selection_id],fee_per_order_minor:fee,promise_working_days:1},randomUUID(),expected,dropOptions);

test('standing agreements require exact consent, retain every transition, supersede coverage and enforce participant RLS',async()=>{
 const f=await prepareDropShip(x,{accept:false,place:false});const a=f.agreement;
 await assert.rejects(decide(f,a.agreement_id,a.version,'accept',{terms_sha256:'f'.repeat(64)}),code('terms_changed'));
 await assert.rejects(decideDropShipAgreement(x.runtime,f.owner,f.supplier.tenantId,f.supplier.instanceId,a.agreement_id,'supplier','accept',{terms_sha256:a.terms_sha256},randomUUID(),a.version,dropOptions),e=>(e as {status:number}).status===404);
 const accepted=await decide(f,a.agreement_id,a.version,'accept',{terms_sha256:a.terms_sha256});assert.equal(accepted.signed_digest,a.terms_sha256);
 await assert.rejects(decide(f,a.agreement_id,a.version,'decline',{terms_sha256:a.terms_sha256}),code('agreement_state_conflict'));
 const second=await proposal(f,a.version);assert.equal(second.version,'2');await decide(f,second.agreement_id,second.version,'accept',{terms_sha256:second.terms_sha256});
 const storeList=await listDropShipAgreements(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,'store');assert.equal(storeList.items.find(i=>i.agreement_id===a.agreement_id)?.state,'superseded');
 assert.equal((await x.h.pool.query("SELECT count(*)::int AS n FROM commerce_fulfilment_agreement_items WHERE instance_id=$1 AND state='accepted'",[f.store.instanceId])).rows[0].n,1);
 const third=await proposal(f,'2',123);assert.equal(third.fee_per_order_minor,123);await decide(f,third.agreement_id,third.version,'decline',{terms_sha256:third.terms_sha256});await assert.rejects(decide(f,third.agreement_id,third.version,'accept',{terms_sha256:third.terms_sha256}),code('agreement_state_conflict'));
 const fourth=await proposal(f,'3');await decideDropShipAgreement(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,fourth.agreement_id,'store','withdraw',{},randomUUID(),fourth.version,dropOptions);
 await assert.rejects(decide(f,fourth.agreement_id,fourth.version,'accept',{terms_sha256:fourth.terms_sha256}),code('agreement_state_conflict'));
 await decide(f,second.agreement_id,second.version,'revoke',{reason:'合成撤銷'});await assert.rejects(decide(f,second.agreement_id,second.version,'accept',{terms_sha256:second.terms_sha256}),code('agreement_state_conflict'));
 await assert.rejects(x.h.pool.query('UPDATE commerce_fulfilment_agreements SET fee_per_order_minor=100 WHERE agreement_id=$1',[a.agreement_id]),e=>(e as {code:string}).code==='23514');
 for(const tenant of [f.store.tenantId,f.supplier.tenantId])assert.equal(await x.tx(async q=>{await bindStore(q,tenant);return (await q.query('SELECT count(*)::int AS n FROM commerce_fulfilment_agreements')).rows[0].n;}),4);
 const other=await x.store(10);assert.equal(await x.tx(async q=>{await bindStore(q,other.tenantId);return (await q.query('SELECT count(*)::int AS n FROM commerce_fulfilment_agreements')).rows[0].n;}),0);
 await assert.rejects(proposeDropShipAgreement(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,{supplier_instance_id:f.supplier.instanceId,selection_ids:[f.selection.selection_id],fee_per_order_minor:0,promise_working_days:1},randomUUID(),'4'),e=>(e as {status:number}).status===404);
 assert.equal((await listDropShipAgreements(x.runtime,f.supplierActor,f.supplier.tenantId,f.supplier.instanceId,'supplier')).items.length,4);
});

test('covered checkout freezes store postage, supplier cost and promise; mixed shippers and other delivery methods are refused',async()=>{
 const f=await prepareDropShip(x,{own:true});const t=f.order!.terms,g=t.shipping.groups[0];
 assert.equal(g.fulfilment_mode,'drop_ship');assert.equal(t.shipping_total_minor,6000);assert.equal(g.self_ship!.handling_days,4);assert.equal(g.drop_ship!.fee_per_order_minor,7000);assert.equal(g.drop_ship!.supply_cost_minor,800);assert.deepEqual(t.payment_methods,['bank_transfer']);
 const mixed={...f.input,lines:[...f.input.lines,{sku:f.store.product.sku,quantity:1}]};
 await assert.rejects(x.tx(q=>freezeCheckout(q,f.store,{...mixed,idempotencyKey:randomUUID()},dropPorts)),e=>(e as {lines:{reason:string}[]}).lines.every(l=>l.reason==='fulfilment_mixed_shippers'));
 await assert.rejects(x.tx(q=>freezeCheckout(q,f.store,{...f.input,delivery:{method:'meetup',name:'合成姓名',mobile:'0912345678'},idempotencyKey:randomUUID()},dropPorts)),e=>(e as {lines:{reason:string}[]}).lines.every(l=>l.reason==='method_unsupported'));
 for(const method of ['home','cvs:UNIMARTC2C','cvs:FAMIC2C','cvs:HILIFEC2C'])await assert.rejects(x.tx(q=>freezeCheckout(q,f.store,{...f.input,delivery:method==='home'?{...f.input.delivery,name:'王小明',address:'台北市中正區合成路1號',method}:{method,name:'王小明',mobile:'0912345678'},idempotencyKey:randomUUID()},dropPorts)),e=>{assert.equal((e as {code:string}).code,'shipping_unavailable',JSON.stringify(e));assert.ok((e as {lines:{reason:string}[]}).lines.every(l=>l.reason==='method_unsupported'));return true;});
 await assert.rejects(x.tx(q=>freezeCheckout(q,f.store,{...f.input,idempotencyKey:randomUUID()},{...dropPorts,shipping:createShippingQuotePort({environment:'sandbox',selfShipEnabled:true})})),e=>(e as {lines:{reason:string}[]}).lines.every(l=>l.reason==='fulfilment_not_agreed'));
});

test('supplier read is a strict recipient and supply-cost allowlist, reports inability and later atomically ships shared stock',async()=>{
 const f=await prepareDropShip(x),before=(await x.h.pool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1',[f.product.product_id])).rows[0];
 const waiting=await list(f);assert.equal(waiting.items.length,1);const row=waiting.items[0];
 assert.deepEqual(keys(row),['currency','display_number','drop_ship_fee_minor','items','order_ref','payment_confirmed_at','recipient','ship_by','shipment','store_name','supply_cost_minor','unable','version'].sort());
 assert.deepEqual(keys(row.recipient!),['address','mobile','name','postal_code']);assert.deepEqual(keys(row.items[0]),['quantity','sku','supply_cost_minor','title','unit_supply_cost_minor'].sort());
 assert.equal(row.recipient!.mobile,'0912345678');assert.equal(JSON.stringify(row).includes(f.buyer.session.user.email),false);assert.equal(JSON.stringify(row).includes('unit_price_minor'),false);assert.equal(JSON.stringify(row).includes('total_minor'),false);
 await assert.rejects(recordSelfShipment(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,f.order!.order_id,{carrier_key:'post',tracking_number:'ABC',sent_on:await f.today()},randomUUID(),f.order!.version),code('self_ship_not_selected'));
 await supplierDropShipCommand(x.runtime,f.supplierActor,f.supplier.tenantId,f.supplier.instanceId,f.order!.order_id,'unable',{reason:'cannot_ship',note:'等待補貨'},randomUUID(),f.order!.version,dropNotices);
 assert.equal((await list(f)).items[0].unable!.reason,'cannot_ship');assert.equal((await x.h.pool.query("SELECT count(*)::int AS n FROM commerce_exception_cases WHERE order_id=$1 AND kind='fulfiller_unable' AND status='open'",[f.order!.order_id])).rows[0].n,1);
 const key=randomUUID(),shipped=await ship(f,key);assert.ok(shipped.shipment);assert.equal(shipped.unable,null);assert.deepEqual(await ship(f,key),shipped);
 assert.equal((await list(f)).items.length,0);assert.equal((await list(f,'shipped')).items.length,1);
 const after=(await x.h.pool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1',[f.product.product_id])).rows[0];assert.deepEqual(after,{stock:before.stock-2,reserved:before.reserved-2});
 await assert.rejects(ship(f),code('self_shipment_already_recorded'));
 const seller=await readSellerCheckoutOrder(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,f.order!.order_id);assert.equal(seller.drop_ship!.state,'shipped');assert.equal(seller.drop_ship!.supply_cost_minor,800);assert.equal(seller.actions.record_self_shipment,false);
 const buyer=await x.tx(async q=>{await bindStore(q,f.store.tenantId);return publicOrder(q,{tenantId:f.store.tenantId,instanceId:f.store.instanceId,projection:{slug:f.store.slug,name:'合成商店'}},f.order!.order_id);});assert.equal(buyer.self_ship!.fulfilment_mode,'drop_ship');assert.ok(buyer.self_ship!.shipment);
 for(const kind of ['commerce_order_shipped','commerce_drop_ship_shipped','commerce_drop_ship_unable','commerce_drop_ship_payment_confirmed','commerce_drop_ship_proposed','commerce_drop_ship_accepted'])assert.ok((await x.h.pool.query('SELECT 1 FROM member_notifications WHERE kind=$1',[kind])).rowCount,kind);
});

test('revocation stops new checkout while a frozen paid order remains shippable; dates and cancelled states are checked generically',async()=>{
 const f=await prepareDropShip(x);await decide(f,f.agreement.agreement_id,f.agreement.version,'revoke',{});
 await assert.rejects(x.tx(q=>freezeCheckout(q,f.store,{...f.input,idempotencyKey:randomUUID()},dropPorts)),e=>(e as {lines:{reason:string}[]}).lines.every(l=>l.reason==='fulfilment_not_agreed'));
 assert.equal((await list(f)).items.length,1);await assert.rejects(ship(f,randomUUID(),{sent_on:'2000-01-01'}),code('shipment_date_invalid'));await assert.rejects(ship(f,randomUUID(),{sent_on:'2099-01-01'}),code('shipment_date_invalid'));await ship(f);
 const other=await prepareDropShip(x);await x.tx(async q=>{await bindStore(q,other.store.tenantId);await cancelPaidOrder(q,other.store,{orderId:other.order!.order_id,commandRef:randomUUID()});});
 assert.equal((await list(other)).items.length,0);await assert.rejects(ship(other),code('order_cancelled'));
});

test('two real simultaneous shipment commands have exactly one winner and one complete stock effect',async()=>{
 const f=await prepareDropShip(x);const results=await Promise.allSettled([ship(f),ship(f)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const movements=(await x.h.pool.query("SELECT quantity FROM commerce_inventory_movements WHERE order_id=$1 AND kind='ship'",[f.order!.order_id])).rows;assert.deepEqual(movements,[{quantity:2}]);
});


test('HTTP boundaries require session, CSRF, idempotency, exact versions and manage authority on both sides',async()=>{
 const f=await prepareDropShip(x,{accept:false,place:false}),root=f.supplier.root+'/supplier-console/drop-ship/agreements/'+f.agreement.agreement_id+'/accept',body={terms_sha256:f.agreement.terms_sha256};
 const headers={'Idempotency-Key':randomUUID(),'If-Match':'"1"'};
 assert.equal((await x.h.call('POST',root,undefined,body,headers,f.app)).status,401);
 assert.equal((await x.h.call('POST',root,f.supplier.owner,body,{'If-Match':'"1"'},f.app)).status,400);
 assert.equal((await x.h.call('POST',root,f.supplier.owner,body,{'Idempotency-Key':randomUUID()},f.app)).status,428);
 assert.equal((await f.app.request(x.h.origin+'/api/v1'+root,{method:'POST',headers:{Origin:x.h.origin,Cookie:f.supplier.owner.cookie,'Content-Type':'application/json',...headers,'X-CSRF-Token':'incorrect'},body:JSON.stringify(body)})).status,403);
 const operator=await x.h.person('合成代出貨操作員');
 const principal=await x.h.candidate(f.supplier.owner,operator.id);await x.h.accept(operator.session,f.supplier.tenantId,await x.h.invite(f.supplier.owner,f.supplier.tenantId,principal,'operator'));
 const clerk=await authenticate(x.runtime,operator.session.cookie.split('=')[1].split(';')[0]);
 await assert.rejects(listDropShipAgreements(x.runtime,clerk,f.supplier.tenantId,f.supplier.instanceId,'supplier'),e=>(e as {status:number}).status===404);
 const signer=(await x.h.pool.query('SELECT created_by_principal_id FROM commerce_storefront_profiles WHERE instance_id=$1',[f.supplier.instanceId])).rows[0].created_by_principal_id;
 await x.h.pool.query(`INSERT INTO tenant_module_permissions(tenant_id,principal_id,instance_id,capabilities,status,granted_by_principal_id) VALUES($1,$2,$3,ARRAY['store:read'],'active',$4)`,[f.supplier.tenantId,principal,f.supplier.instanceId,signer]);
 await assert.rejects(listDropShipAgreements(x.runtime,clerk,f.supplier.tenantId,f.supplier.instanceId,'supplier'),code('capability_denied'));
 await x.h.pool.query(`UPDATE tenant_module_permissions SET capabilities=ARRAY['store:read','store:manage'],version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND principal_id=$2`,[f.supplier.tenantId,principal]);
 assert.equal((await x.h.call('POST',root,operator.session,body,headers,f.app)).status,200);
 await x.h.pool.query(`UPDATE tenant_module_permissions SET capabilities=ARRAY['store:read'],version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND principal_id=$2`,[f.supplier.tenantId,principal]);
 assert.equal((await x.h.call('POST',root,operator.session,body,headers,f.app)).status,403,'revoked permissions also reject replays');
 const retailPrincipal=await x.h.candidate(f.store.owner,operator.id);await x.h.accept(operator.session,f.store.tenantId,await x.h.invite(f.store.owner,f.store.tenantId,retailPrincipal,'operator'));
 await x.h.pool.query(`INSERT INTO tenant_module_permissions(tenant_id,principal_id,instance_id,capabilities,status,granted_by_principal_id) SELECT $1,$2,$3,ARRAY['store:read'],'active',created_by_principal_id FROM commerce_storefront_profiles WHERE instance_id=$3`,[f.store.tenantId,principal,f.store.instanceId]);
 await assert.rejects(proposeDropShipAgreement(x.runtime,clerk,f.store.tenantId,f.store.instanceId,{supplier_instance_id:f.supplier.instanceId,selection_ids:[f.selection.selection_id],fee_per_order_minor:0,promise_working_days:1},randomUUID(),'1',dropOptions),code('capability_denied'));
 const owner=(await x.h.pool.query('SELECT created_by_principal_id FROM commerce_storefront_profiles WHERE instance_id=$1',[f.store.instanceId])).rows[0].created_by_principal_id;
 await x.h.pool.query(`UPDATE tenant_module_permissions SET capabilities=ARRAY['store:read','store:manage'],version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND principal_id=$2 AND instance_id=$3`,[f.store.tenantId,principal,f.store.instanceId]);
 const proposed=await proposeDropShipAgreement(x.runtime,clerk,f.store.tenantId,f.store.instanceId,{supplier_instance_id:f.supplier.instanceId,selection_ids:[f.selection.selection_id],fee_per_order_minor:0,promise_working_days:1},randomUUID(),'1',dropOptions);assert.equal(proposed.version,'2');
});

test('supplier lists exclude unpaid orders and other suppliers; fulfilment grants do not require buyer-contact capability',async()=>{
 const f=await prepareDropShip(x,{pay:false});assert.deepEqual((await list(f)).items,[]);
 await assert.rejects(ship(f),code('payment_not_confirmed'));
 const other=await x.store(10);await x.h.call('POST',other.root+'/upgrade',other.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':'"1"'},f.app);const otherActor=await authenticate(x.runtime,other.owner.cookie.split('=')[1].split(';')[0]);assert.deepEqual((await listSupplierDropShipOrders(x.runtime,otherActor,other.tenantId,other.instanceId,{},f.cursors)).items,[]);
 const operator=await x.h.person('合成出貨員'),principal=await x.h.candidate(f.supplier.owner,operator.id);await x.h.accept(operator.session,f.supplier.tenantId,await x.h.invite(f.supplier.owner,f.supplier.tenantId,principal,'operator'));
 const clerk=await authenticate(x.runtime,operator.session.cookie.split('=')[1].split(';')[0]);
 await assert.rejects(listSupplierDropShipOrders(x.runtime,clerk,f.supplier.tenantId,f.supplier.instanceId,{},f.cursors),e=>(e as {status:number}).status===404);
 const signer=(await x.h.pool.query('SELECT created_by_principal_id FROM commerce_storefront_profiles WHERE instance_id=$1',[f.supplier.instanceId])).rows[0].created_by_principal_id;
 await x.h.pool.query(`INSERT INTO tenant_module_permissions(tenant_id,principal_id,instance_id,capabilities,status,granted_by_principal_id) VALUES($1,$2,$3,ARRAY['store:read','store:fulfil'],'active',$4)`,[f.supplier.tenantId,principal,f.supplier.instanceId,signer]);
 assert.deepEqual((await listSupplierDropShipOrders(x.runtime,clerk,f.supplier.tenantId,f.supplier.instanceId,{},f.cursors)).items,[]);
 await confirmOfflinePayment(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,f.order!.order_id,{amount_minor:f.order!.terms.total_minor,received_on:await f.today()},randomUUID(),'1',dropNotices);
 const paid=(await listSupplierDropShipOrders(x.runtime,clerk,f.supplier.tenantId,f.supplier.instanceId,{},f.cursors)).items;assert.equal(paid.length,1);assert.deepEqual(keys(paid[0].recipient!),['address','mobile','name','postal_code']);
 await supplierDropShipCommand(x.runtime,clerk,f.supplier.tenantId,f.supplier.instanceId,f.order!.order_id,'ship',{carrier_key:'post',tracking_number:'CLERK-123',sent_on:await f.today()},randomUUID(),'1',dropNotices);
 await assert.rejects(listSupplierDropShipOrders(x.runtime,clerk,f.supplier.tenantId,f.supplier.instanceId,{limit:51},f.cursors));
});


test('supplier shipment requires full allocation, normal shipment validation and reflects existing contact masking',async()=>{
 const f=await prepareDropShip(x,{pay:false});
 await x.tx(async q=>{await lockStore(q,f.store,[],[f.order!.order_id],false);await (await checkoutInventory(q,f.order!.order_id)).releaseHolds();await q.query('UPDATE commerce_items SET stock=0 WHERE item_id=$1',[f.product.product_id]);});
 await confirmOfflinePayment(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,f.order!.order_id,{amount_minor:f.order!.terms.total_minor,received_on:await f.today()},randomUUID(),'1',dropNotices);
 assert.equal((await list(f)).items.length,1);await assert.rejects(ship(f),code('self_shipment_stock_unavailable'));
 for(const patch of [{carrier_key:'invalid'},{tracking_number:'BAD<>TRACK'},{sent_on:'2026-02-30'},{carrier_key:'other',carrier_name:'隱藏＜名稱＞'}])await assert.rejects(ship(f,randomUUID(),patch),code('validation_failed'));
 await x.h.pool.query('UPDATE commerce_items SET stock=50 WHERE item_id=$1',[f.product.product_id]);await x.tx(q=>retryAllocation(q,f.store,f.order!.order_id));
 await ship(f);
 await x.h.pool.query(`UPDATE commerce_checkout_contacts SET contact_name=NULL,contact_email=NULL,contact_phone=NULL,contact_salt=NULL,delivery=NULL,invoice=NULL,redacted_at=clock_timestamp() WHERE contact_id=(SELECT contact_id FROM commerce_checkout_orders WHERE order_id=$1)`,[f.order!.order_id]);
 assert.equal((await list(f,'shipped')).items[0].recipient,null);
});


test('intake off conceals agreement writes while frozen orders remain readable and shippable over HTTP',async()=>{
 const f=await prepareDropShip(x),off=createApp(x.runtime,x.h.origin,'local',{tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY,guildLaunchpadEnabled:true,supplierConsoleEnabled:true,commerceSelfShipEnabled:false,commerceDropShipEnabled:false,commerceSettings:{checkoutEnabled:true,consoleEnabled:true,quarantine:false,providerProfiles:[]}});
 const read=await x.h.call('GET',f.supplier.root+'/supplier-console/drop-ship/agreements',f.supplier.owner,undefined,{},off);assert.equal(read.status,200);assert.equal(read.data.items.length,1);
 assert.equal((await x.h.call('POST',f.supplier.root+'/supplier-console/drop-ship/agreements/'+f.agreement.agreement_id+'/revoke',f.supplier.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':'"1"'},off)).status,404);
 assert.equal((await x.h.call('GET',f.supplier.root+'/supplier-console/drop-ship/orders?limit=50',f.supplier.owner,undefined,{},off)).data.items.length,1);
 const sent=await x.h.call('POST',f.supplier.root+'/supplier-console/drop-ship/orders/'+f.order!.order_id+'/ship',f.supplier.owner,{carrier_key:'post',tracking_number:'FLAG-OFF-123',sent_on:await f.today()},{'Idempotency-Key':randomUUID(),'If-Match':'"1"'},off);assert.equal(sent.status,200,JSON.stringify(sent.data));assert.equal(sent.data.shipment.tracking_number,'FLAG-OFF-123');
});

test('supplier inability closes with the store cancellation, refunds once and releases the same supplier stock',async()=>{
 const {cancelSellerPaidCheckoutOrder,recordSellerPaidCancellationRefund}=await import('../../modules/agent-commerce/checkout/seller-orders.js');
 const f=await prepareDropShip(x),id=f.order!.order_id;
 const before=(await x.h.pool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1',[f.product.product_id])).rows[0];
 await supplierDropShipCommand(x.runtime,f.supplierActor,f.supplier.tenantId,f.supplier.instanceId,id,'unable',{reason:'out_of_stock'},randomUUID(),'1',dropNotices);
 const {readSellerException,actOnSellerException}=await import('../../modules/agent-commerce/checkout/seller-exceptions.js');
 const caseId=(await x.h.pool.query("SELECT case_id FROM commerce_exception_cases WHERE order_id=$1 AND kind='fulfiller_unable'",[id])).rows[0].case_id;
 const problem=await readSellerException(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,caseId);assert.equal(problem.next_action,'cancel_and_refund');assert.deepEqual(problem.allowed_actions,[]);assert.deepEqual(problem.resolution_codes,[]);
 await assert.rejects(actOnSellerException(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,caseId,'resolve_with_evidence',{code:'refunded',provider_date:await f.today(),provider_reference:'NOT-A-CARD-REFUND'},randomUUID(),problem.version),code('exception_action_unavailable'));
 const cancelled=await cancelSellerPaidCheckoutOrder(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,id,{reason:'out_of_stock',refund_state:'pending'},randomUUID(),'1',dropNotices);
 assert.equal(cancelled.lifecycle_state,'cancelled');assert.equal(cancelled.paid_cancellation!.refund_state,'pending');assert.equal(cancelled.open_exception_count,0);
 assert.equal((await list(f)).items.length,0);await assert.rejects(ship(f),code('order_cancelled'));
 assert.deepEqual((await x.h.pool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1',[f.product.product_id])).rows[0],{stock:before.stock,reserved:before.reserved-2});
 const exception=(await x.h.pool.query("SELECT status,resolution_code FROM commerce_exception_cases WHERE order_id=$1 AND kind='fulfiller_unable'",[id])).rows[0];assert.deepEqual(exception,{status:'resolved',resolution_code:'cancelled'});
 const refund={refunded_on:await f.today(),refund_method:'bank_transfer'},key=randomUUID();
 const recorded=await recordSellerPaidCancellationRefund(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,id,refund,key,cancelled.version,dropNotices);
 assert.equal(recorded.payment_state,'refunded');assert.equal(recorded.paid_cancellation!.amount_minor,f.order!.terms.total_minor);
 assert.deepEqual(await recordSellerPaidCancellationRefund(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,id,refund,key,cancelled.version,dropNotices),recorded);
 await assert.rejects(recordSellerPaidCancellationRefund(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,id,refund,randomUUID(),recorded.version,dropNotices),code('refund_not_available'));
 const kinds=(await x.h.pool.query("SELECT kind FROM member_notifications WHERE recipient_ref=$1 AND kind IN ('commerce_order_paid_cancelled','commerce_order_refund_recorded') ORDER BY kind",[f.buyer.id])).rows.map(r=>r.kind);
 assert.deepEqual(kinds,['commerce_order_paid_cancelled','commerce_order_refund_recorded']);
});

test('supplier shipment racing store paid cancellation commits exactly one stock and order outcome',async()=>{
 const {cancelSellerPaidCheckoutOrder}=await import('../../modules/agent-commerce/checkout/seller-orders.js');
 const f=await prepareDropShip(x),id=f.order!.order_id;
 const before=(await x.h.pool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1',[f.product.product_id])).rows[0];
 const outcomes=await Promise.allSettled([ship(f),cancelSellerPaidCheckoutOrder(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,id,{reason:'buyer_request',refund_state:'pending'},randomUUID(),'1',dropNotices)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);const failure=outcomes.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(failure.reason.status,409);
 const facts=(await x.h.pool.query(`SELECT co.lifecycle_state,EXISTS(SELECT 1 FROM commerce_self_shipments s WHERE s.order_id=co.order_id) AS shipped,
  EXISTS(SELECT 1 FROM commerce_paid_cancellations c WHERE c.order_id=co.order_id) AS cancelled FROM commerce_checkout_orders co WHERE order_id=$1`,[id])).rows[0];
 assert.notEqual(facts.shipped,facts.cancelled);assert.equal(facts.lifecycle_state,facts.cancelled?'cancelled':'open');
 assert.deepEqual((await x.h.pool.query('SELECT stock,reserved FROM commerce_items WHERE item_id=$1',[f.product.product_id])).rows[0],{stock:before.stock-(facts.shipped?2:0),reserved:before.reserved-2});
});

test('180-day retention removes a supplier shipment contact and tracking from all three order views',async()=>{
 const {runRestoredContactRetention}=await import('../../modules/agent-commerce/operations/contact-retention.js');
 const f=await prepareDropShip(x),sent=await ship(f),recorded=new Date(sent.shipment!.recorded_at).getTime();
 await runRestoredContactRetention(x.runtime,'all',{now:()=>new Date(recorded+180*86400000-1)});
 assert.ok((await list(f,'shipped')).items[0].recipient);
 const result=await runRestoredContactRetention(x.runtime,'all',{now:()=>new Date(recorded+180*86400000+1)});assert.equal(result.contacts,1);
 const supplier=(await list(f,'shipped')).items[0];assert.equal(supplier.recipient,null);assert.equal(supplier.shipment!.tracking_number,null);assert.equal(supplier.shipment!.redacted,true);
 const seller=await readSellerCheckoutOrder(x.runtime,f.owner,f.store.tenantId,f.store.instanceId,f.order!.order_id);assert.equal(seller.self_ship!.shipment!.tracking_number,null);
 const buyer=await x.tx(async q=>{await bindStore(q,f.store.tenantId);return publicOrder(q,{tenantId:f.store.tenantId,instanceId:f.store.instanceId,projection:{slug:f.store.slug,name:'合成商店'}},f.order!.order_id);});
 assert.equal(buyer.contact,null);assert.equal(buyer.self_ship!.shipment!.tracking_number,null);assert.equal(buyer.lifecycle_state,'open');
});
