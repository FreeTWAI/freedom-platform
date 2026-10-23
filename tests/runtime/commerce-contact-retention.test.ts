import {readSellerOrderContact,readSellerCheckoutOrder} from '../../modules/agent-commerce/checkout/seller-orders.js';
import {authenticate} from '../../modules/identity-membership/service.js';
import {completeMeetup} from '../../modules/agent-commerce/payments/offline/confirm.js';
import {createPaymentMethodsPort} from '../../modules/agent-commerce/payments/offline/methods.js';
import {freezeCheckout,hashJSON} from '../../modules/agent-commerce/checkout/terms.js';
import {placeCheckoutOrder} from '../../modules/agent-commerce/checkout/orders.js';
import {syntheticShippingPort} from '../../scripts/synthetic-shipping-quote.js';
import {seedAdmissionPaymentService} from '../e2e/hosted-payment-fixture.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,beforeEach,after,test} from 'node:test';
import {checkoutHarness,ports,type CheckoutHarness} from './hosted-checkout-harness.js';
import {seedSelfShipment} from './self-ship-fixture.js';
import {mapPersonPrincipal} from '../../packages/resource-scopes/index.js';
import {Pool} from 'pg';
import {createWorkerHandler,type WorkerEnv} from '../../apps/platform-api/src/worker.js';
import {runDueCommerceWork} from '../../modules/agent-commerce/operations/due-work.js';
import {applyConfirmedPaymentHeld} from '../../modules/agent-commerce/checkout/payments.js';
import {checkoutInventory} from '../../modules/agent-commerce/checkout/inventory.js';
import {openException} from '../../modules/agent-commerce/checkout/exceptions.js';
import type {CheckoutOrderRow} from '../../modules/agent-commerce/checkout/orders.js';
import {bindStore,lockStore} from '../../modules/agent-commerce/checkout/authority.js';
import {publicOrder} from '../../modules/agent-commerce/checkout/public-order.js';
import {cancelUnpaidOrder} from '../../modules/agent-commerce/checkout/orders.js';
import {discoverContactRetention,retainCheckoutContacts,runContactRetentionWork,runRestoredContactRetention,type RetentionClaim} from '../../modules/agent-commerce/operations/contact-retention.js';
let x:CheckoutHarness;
before(async()=>{x=await checkoutHarness('fp_contact_retention');});
beforeEach(async()=>x.reset());after(async()=>x?.stop());
const days=(at:Date|string,n:number)=>new Date(new Date(at).getTime()+n*86400000);
async function fixture(openSource=false){
 const s=await x.store(30);
 const version=(await x.h.pool.query('SELECT version::text FROM module_instances WHERE instance_id=$1',[s.instanceId])).rows[0].version;
 assert.equal((await x.h.call('POST',s.root+'/upgrade',s.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':`"${version}"`},x.app)).status,200);
 const c=await x.frozen(s,2),principal=await x.tx(q=>mapPersonPrincipal(q,s.owner.user.user_id));
 const shipment=await x.tx(async q=>{await bindStore(q,s.tenantId);return seedSelfShipment(q,c.checkout_id,principal.principal_id);});
 const row=(await x.h.pool.query('SELECT recorded_at FROM commerce_self_shipments WHERE shipment_id=$1',[shipment.shipmentId])).rows[0];
 const sourceOrder=openSource?await x.place(s,c):null;
 return {s,c,principal,...shipment,at:row.recorded_at as Date,sourceOrder};
}
async function claim(f:Awaited<ReturnType<typeof fixture>>,now:Date):Promise<RetentionClaim>{
 return (await x.h.pool.query(`INSERT INTO commerce_due_work(tenant_id,instance_id,kind,target_id,due_at,lease_until)
 VALUES($1,$2,'checkout_contact_retention',$2,$3,$3::timestamptz+interval '2 minutes') ON CONFLICT(kind,target_id)
 DO UPDATE SET due_at=EXCLUDED.due_at,lease_until=EXCLUDED.lease_until RETURNING due_work_id,tenant_id,target_id,lease_until::text AS token`,[f.s.tenantId,f.s.instanceId,now])).rows[0];
}
async function run(f:Awaited<ReturnType<typeof fixture>>,now=days(f.at,181),limit=200){return retainCheckoutContacts(x.runtime,await claim(f,now),'all',{now:()=>now,limit});}
const contact=async(id:string)=>(await x.h.pool.query('SELECT * FROM commerce_checkout_contacts WHERE contact_id=$1',[id])).rows[0];

test('fulfilment clock is recorded_at +180 days; contact and shipment erase atomically, order remains open',async()=>{
 const f=await fixture(),before=await contact(f.contactId);
 assert.equal((await run(f,days(f.at,180-1/86400))).contacts,0);
 assert.equal((await contact(f.contactId)).redacted_at,null);
 const due=await run(f,new Date(days(f.at,180).getTime()+1));assert.equal(due.contacts,1);assert.equal(due.customers,0);
 const a=await contact(f.contactId);for(const key of ['contact_name','contact_email','contact_phone','delivery','invoice','contact_salt'])assert.equal(a[key],null,key);
 assert.equal(a.contact_sha256,before.contact_sha256);
 const shipment=(await x.h.pool.query('SELECT * FROM commerce_self_shipments WHERE shipment_id=$1',[f.shipmentId])).rows[0];
 assert.equal(shipment.tracking_number,null);assert.equal(shipment.carrier_name,null);assert.equal(shipment.carrier_key,'post');assert.ok(shipment.redacted_at);
 const view=await x.tx(async q=>{await bindStore(q,f.s.tenantId);return publicOrder(q,{tenantId:f.s.tenantId,instanceId:f.s.instanceId,projection:{slug:f.s.slug,name:'合成商店'}},f.orderId);});
 const owner=await authenticate(x.runtime,f.s.owner.cookie.split('=')[1].split(';')[0]);
 const sellerContact=await readSellerOrderContact(x.runtime,owner,f.s.tenantId,f.s.instanceId,f.orderId);assert.equal(sellerContact.contact_redacted,true);assert.equal(sellerContact.contact,null);assert.equal(sellerContact.delivery,null);
 const seller=await readSellerCheckoutOrder(x.runtime,owner,f.s.tenantId,f.s.instanceId,f.orderId);assert.equal(seller.self_ship?.shipment?.tracking_number,null);
 assert.equal(view.contact,null);assert.equal(view.self_ship?.shipment?.tracking_number,null);assert.equal(view.self_ship?.shipment?.carrier_name,null);assert.equal(view.lifecycle_state,'open');
 assert.equal((await run(f)).contacts,0);assert.equal((await run(f)).customers,0);
 const u=(await x.h.pool.query('SELECT * FROM commerce_customers WHERE customer_id=(SELECT customer_id FROM commerce_checkouts WHERE checkout_id=$1)',[f.checkoutId])).rows[0];assert.equal(u.email_normalized,'synthetic-buyer@example.test');assert.equal(u.redacted_at,null);
});

test('an unreferenced contact and its customer stay live 400 days past checkout expiry under all',async()=>{
 const s=await x.store(),c=await x.frozen(s,1),row=(await x.h.pool.query('SELECT expires_at,current_contact_id,customer_id FROM commerce_checkouts WHERE checkout_id=$1',[c.checkout_id])).rows[0];
 assert.equal((await x.h.pool.query("SELECT 1 FROM commerce_due_work WHERE kind='checkout_contact_retention'")).rowCount,0);
 assert.equal(await discoverContactRetention(x.runtime),1);assert.equal(await discoverContactRetention(x.runtime),0);
 const result=await runContactRetentionWork(x.runtime,'all',{now:()=>days(row.expires_at,400)});
 assert.equal(result.completed,1);assert.equal(result.failed,0);assert.equal((await contact(row.current_contact_id)).redacted_at,null);
 assert.deepEqual((await x.h.pool.query('SELECT redacted_at,email_normalized FROM commerce_customers WHERE customer_id=$1',[row.customer_id])).rows[0],{redacted_at:null,email_normalized:'synthetic-buyer@example.test'});
});

test('exceptions, pending payments, unapplied events, unrecorded refunds and unsettled inventory do not defer a fulfilled contact',async()=>{
 const store=await x.store(100,false);
 const first=(await x.send(store,'/products',{title:'合成商品甲',price_minor:100,stock:100})).data;
 const second=(await x.send(store,'/products',{title:'合成商品乙',price_minor:100,stock:100})).data;
 await x.publish(store);const s={...store,product:first};
 await seedAdmissionPaymentService(x,s);
 const c=await x.frozen(s,5,{lines:[{sku:first.sku,quantity:5},{sku:second.sku,quantity:5}]}),o=await x.place(s,c);
 const principal=await x.tx(q=>mapPersonPrincipal(q,s.owner.user.user_id));
 const row=await x.tx(async q=>{
  await bindStore(q,s.tenantId);await lockStore(q,s,[],[o.order_id],false);
  const attempt=(await q.query(`INSERT INTO commerce_payment_attempts(tenant_id,instance_id,kind,order_id,sequence,account_id,environment,merchant_id,credential_version,merchant_trade_no,amount_minor,currency)
   SELECT tenant_id,instance_id,'order',$2,1,account_id,environment,merchant_id,1,$3,1000,'TWD' FROM commerce_provider_accounts WHERE instance_id=$1 RETURNING attempt_id`,[s.instanceId,o.order_id,'F'+randomUUID().replaceAll('-','').slice(0,19).toUpperCase()])).rows[0];
  // A refund that has not been recorded is an unapplied payment application.
  // commerce_refunds itself only permits the terminal state 'recorded'.
  const application=(await q.query(`INSERT INTO commerce_checkout_payment_applications(order_id,payment_ref,amount_minor,currency,outcome)
   VALUES($1,$2,600,'TWD','amount_mismatch') RETURNING application_id`,[o.order_id,attempt.attempt_id])).rows[0];
  const allocation=(await q.query(`INSERT INTO commerce_checkout_payment_applications(order_id,payment_ref,amount_minor,currency,outcome) VALUES($1,$2,1000,'TWD','unallocatable') RETURNING application_id`,[o.order_id,randomUUID()])).rows[0];
  const inv=await checkoutInventory(q,o.order_id);await inv.port.convert(inv.lines[0].item_id,allocation.application_id);
  assert.ok(application.application_id);
  await openException(q,{tenantId:s.tenantId,instanceId:s.instanceId,orderId:o.order_id,kind:'amount_mismatch',subjectKind:'payment_attempt',subjectId:attempt.attempt_id});
  for(const source of ['notification','query'])await q.query(`INSERT INTO commerce_hosted_payment_events(tenant_id,instance_id,account_id,attempt_id,source,outcome,dedupe_key,query_trigger,credential_version)
   SELECT tenant_id,instance_id,account_id,attempt_id,$2,'failed',$3,$4,$5 FROM commerce_payment_attempts WHERE attempt_id=$1`,[attempt.attempt_id,source,source==='notification'?hashJSON(randomUUID()):null,source==='query'?'schedule':null,source==='query'?1:null]);
  // Retained handover evidence and partially unsettled inventory are independent
  // facts in this schema. Keep every constraint and inventory balance enabled.
  return (await q.query(`INSERT INTO commerce_meetup_handovers(tenant_id,instance_id,order_id,completed_on,recorded_by_principal_id)
   VALUES($1,$2,$3,(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date,$4) RETURNING recorded_at`,[s.tenantId,s.instanceId,o.order_id,principal.principal_id])).rows[0];
 });
 const state=(await x.h.pool.query(`SELECT
  (SELECT count(*)::int FROM commerce_exception_cases WHERE order_id=$1 AND status='open') exceptions,
  (SELECT count(*)::int FROM commerce_payment_attempts WHERE order_id=$1 AND state='issued') payments,
  (SELECT count(*)::int FROM commerce_hosted_payment_events e JOIN commerce_payment_attempts p USING(attempt_id) WHERE p.order_id=$1 AND e.applied_at IS NULL) events,
  (SELECT count(*)::int FROM commerce_refunds WHERE order_id=$1) refunds,
  (SELECT count(*)::int FROM commerce_inventory_reservations WHERE order_id=$1 AND state='held') holds,
  (SELECT count(*)::int FROM commerce_inventory_allocations WHERE order_id=$1 AND shipped_quantity+released_quantity<quantity) allocations`,[o.order_id])).rows[0];
 assert.deepEqual(state,{exceptions:1,payments:1,events:2,refunds:0,holds:1,allocations:1});
 assert.equal((await runContactRetentionWork(x.runtime,'all',{now:()=>days(row.recorded_at,181)})).completed,1);
 assert.ok((await contact(o.contact_id)).redacted_at);
});

test('a live unfulfilled order has no invented deadline and protects the shared customer',async()=>{
 const f=await fixture(true);await run(f,days(f.at,2000));
 assert.ok((await contact(f.contactId)).redacted_at);
 const row=(await x.h.pool.query('SELECT customer_id,contact_id,lifecycle_state FROM commerce_checkout_orders WHERE order_id=$1',[f.sourceOrder!.order_id])).rows[0];
 assert.equal((await contact(row.contact_id)).redacted_at,null);assert.equal(row.lifecycle_state,'open');
 assert.equal((await x.h.pool.query('SELECT redacted_at FROM commerce_customers WHERE customer_id=$1',[row.customer_id])).rows[0].redacted_at,null);
});

test('cancelled order uses cancellation +180 days without closing it',async()=>{
 const s=await x.store(),c=await x.frozen(s,1),o=await x.place(s,c);
 await x.tx(q=>cancelUnpaidOrder(q,s,o.order_id,'buyer','buyer_cancelled'));
 const row=(await x.h.pool.query('SELECT contact_id,cancelled_at FROM commerce_checkout_orders WHERE order_id=$1',[o.order_id])).rows[0];
 await discoverContactRetention(x.runtime);
 await runContactRetentionWork(x.runtime,'all',{now:()=>days(row.cancelled_at,179)});assert.equal((await contact(row.contact_id)).redacted_at,null);
 await x.h.pool.query("UPDATE commerce_due_work SET due_at=$1 WHERE kind='checkout_contact_retention'",[new Date(days(row.cancelled_at,180).getTime()+1)]);
 assert.equal((await runContactRetentionWork(x.runtime,'all',{now:()=>new Date(days(row.cancelled_at,180).getTime()+1)})).failed,0);assert.ok((await contact(row.contact_id)).redacted_at);
 assert.deepEqual((await x.h.pool.query('SELECT lifecycle_state,closed_at FROM commerce_checkout_orders WHERE order_id=$1',[o.order_id])).rows[0],{lifecycle_state:'cancelled',closed_at:null});
});

test('bounded batches, stale leases, tenant tampering and aborts cannot erase another claim',async()=>{
 const f=await fixture(true),now=days(f.at,181),job=await claim(f,now);
 await x.tx(q=>cancelUnpaidOrder(q,f.s,f.sourceOrder!.order_id,'buyer','buyer_cancelled'));
 await assert.rejects(()=>retainCheckoutContacts(x.runtime,{...job,tenant_id:randomUUID()},'all',{now:()=>now}),/binding_invalid/);
 await assert.rejects(()=>retainCheckoutContacts(x.runtime,{...job,token:new Date(0).toISOString()},'all',{now:()=>now}),/lease_lost/);
 await assert.rejects(()=>retainCheckoutContacts(x.runtime,job,'all',{now:()=>days(now,1)}),/lease_lost/);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>retainCheckoutContacts(x.runtime,job,'all',{now:()=>now,signal:controller.signal}),/aborted/);
 let clockCalls=0;await assert.rejects(()=>retainCheckoutContacts(x.runtime,job,'all',{now:()=>++clockCalls===1?now:days(now,1)}),/lease_lost/);
 assert.equal((await contact(f.contactId)).redacted_at,null);
 const first=await run(f,now,1);assert.equal(first.contacts,1);assert.equal(first.remaining,true);
 const second=await run(f,now,1);assert.equal(second.contacts,1);assert.equal(second.remaining,false);
 assert.equal((await run(f,now,1)).contacts,0);
});

test('a failed same-transaction shipment erasure rolls back contact erasure and is replayable',async()=>{
 const f=await fixture(),now=days(f.at,181);
 await x.h.pool.query(`CREATE FUNCTION fail_retention() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_failure'; END $$;
 CREATE TRIGGER fail_retention BEFORE UPDATE ON commerce_self_shipments FOR EACH ROW EXECUTE FUNCTION fail_retention()`);
 await assert.rejects(()=>run(f,now),/synthetic_failure/);assert.equal((await contact(f.contactId)).redacted_at,null);
 await discoverContactRetention(x.runtime);await x.h.pool.query("UPDATE commerce_due_work SET lease_until=NULL WHERE kind='checkout_contact_retention'");
 const failed=await runContactRetentionWork(x.runtime,'all',{now:()=>now});assert.equal(failed.failed,1);assert.equal((await x.h.pool.query("SELECT failure_count FROM commerce_due_work WHERE kind='checkout_contact_retention'")).rows[0].failure_count,1);
 await x.h.pool.query('DROP TRIGGER fail_retention ON commerce_self_shipments; DROP FUNCTION fail_retention()');
 await run(f,now);assert.ok((await contact(f.contactId)).redacted_at);
});

test('restore privacy pages erase overdue restored references before exposure and require bounded continuation',async()=>{
 const a=await fixture(true),b=await fixture(true),now=days(b.at,181);
 for(const f of [a,b])await x.tx(q=>cancelUnpaidOrder(q,f.s,f.sourceOrder!.order_id,'buyer','buyer_cancelled'));
 const first=await runRestoredContactRetention(x.runtime,'all',{now:()=>now,limit:1});assert.equal(first.deploymentReady,false);assert.equal(first.status,'repeat_page');
 let cursor:string|undefined;let complete=false;
 for(let i=0;i<8;i++){const page=await runRestoredContactRetention(x.runtime,'all',{now:()=>now,limit:1,afterInstance:cursor});cursor=page.after_instance??undefined;if(page.status==='scan_complete'){complete=true;break;}}
 assert.equal(complete,true);assert.ok((await contact(a.contactId)).redacted_at);assert.ok((await contact(b.contactId)).redacted_at);
 await x.tx(async q=>{await bindStore(q,a.s.tenantId);assert.equal((await q.query('SELECT 1 FROM commerce_checkout_contacts WHERE contact_id=$1',[b.contactId])).rowCount,0);});
 await assert.rejects(()=>runRestoredContactRetention(x.runtime,'all',{afterInstance:'bad'}),/cursor_invalid/);
});

 test('meetup handover starts the same retention clock while the order stays open',async()=>{
  const s=await x.store(),principal=await x.tx(q=>mapPersonPrincipal(q,s.owner.user.user_id));
  const version=(await x.h.pool.query('SELECT version::text FROM module_instances WHERE instance_id=$1',[s.instanceId])).rows[0].version;
  assert.equal((await x.h.call('POST',s.root+'/upgrade',s.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':`"${version}"`},x.app)).status,200);
  const doc={schema:'freedom.offline-payment-settings/v1',bank_transfer:null,cash_on_meetup:{deadline_days:7}};
  await x.h.pool.query('INSERT INTO commerce_offline_payment_settings(tenant_id,instance_id,version,document,document_sha256,created_by_principal_id) VALUES($1,$2,1,$3,$4,$5)',[s.tenantId,s.instanceId,doc,hashJSON(doc),principal.principal_id]);
  const ports={admission:{allowed:()=>true},shipping:syntheticShippingPort({method_ref:'meetup'}),paymentMethods:createPaymentMethodsPort({environment:'sandbox',profiles:['offline.cash_on_meetup.v1']})};
  const c=await x.tx(q=>freezeCheckout(q,s,{...x.input(s.product.sku,1),idempotencyKey:randomUUID()},ports));
  const o=await x.tx(q=>placeCheckoutOrder(q,s,{checkoutId:c.checkout_id,termsSha256:c.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:principal.principal_id,environment:'sandbox',paymentMethod:'cash_on_meetup'},ports));
  const actor=await authenticate(x.runtime,s.owner.cookie.split('=')[1].split(';')[0]);
  const date=(await x.h.pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') AS day")).rows[0].day;
  await completeMeetup(x.runtime,actor,s.tenantId,s.instanceId,o.order_id,{amount_minor:o.terms.total_minor,completed_on:date},randomUUID(),'1');
  const r=(await x.h.pool.query('SELECT h.recorded_at,o.contact_id FROM commerce_meetup_handovers h JOIN commerce_checkout_orders o USING(order_id) WHERE h.order_id=$1',[o.order_id])).rows[0];
  await discoverContactRetention(x.runtime);assert.equal((await runContactRetentionWork(x.runtime,'all',{now:()=>days(r.recorded_at,181)})).failed,0);assert.ok((await contact(r.contact_id)).redacted_at);
  assert.equal((await x.h.pool.query('SELECT lifecycle_state FROM commerce_checkout_orders WHERE order_id=$1',[o.order_id])).rows[0].lifecycle_state,'open');
 });
 test('a customer without any contact link keeps its email',async()=>{
  const f=await fixture(),id=randomUUID();
  await x.h.pool.query("INSERT INTO commerce_customers(customer_id,tenant_id,instance_id,email_normalized) VALUES($1,$2,$3,'synthetic-old-revision@example.test')",[id,f.s.tenantId,f.s.instanceId]);
  await run(f);const row=(await x.h.pool.query('SELECT email_normalized,redacted_at FROM commerce_customers WHERE customer_id=$1',[id])).rows[0];
  assert.deepEqual(row,{email_normalized:'synthetic-old-revision@example.test',redacted_at:null});
 });

 test('customer linked only through a retained order survives checkout revision until its contact is masked',async()=>{
  const f=await fixture(true),id=(await x.h.pool.query('SELECT customer_id FROM commerce_checkout_orders WHERE order_id=$1',[f.orderId])).rows[0].customer_id,replacement=randomUUID();
  await x.tx(async q=>{
   await bindStore(q,f.s.tenantId);
   await q.query("INSERT INTO commerce_customers(customer_id,tenant_id,instance_id,email_normalized) VALUES($1,$2,$3,'synthetic-new-revision@example.test')",[replacement,f.s.tenantId,f.s.instanceId]);
   await q.query('UPDATE commerce_checkouts SET customer_id=$2,version=version+1 WHERE instance_id=$1',[f.s.instanceId,replacement]);
  });
  assert.equal((await x.h.pool.query('SELECT 1 FROM commerce_checkouts WHERE customer_id=$1',[id])).rowCount,0);
  await run(f,days(f.at,179));assert.equal((await x.h.pool.query('SELECT redacted_at FROM commerce_customers WHERE customer_id=$1',[id])).rows[0].redacted_at,null);
  await x.tx(q=>cancelUnpaidOrder(q,f.s,f.sourceOrder!.order_id,'buyer','buyer_cancelled'));
  await run(f);const row=(await x.h.pool.query('SELECT email_normalized,redacted_at FROM commerce_customers WHERE customer_id=$1',[id])).rows[0];assert.equal(row.email_normalized,'redacted:'+id);assert.ok(row.redacted_at);
 });

test('off and unset scheduler modes neither discover nor dispatch existing retention work',async()=>{
 const f=await fixture(),now=days(f.at,181),idle=async()=>({claimed:0,completed:0,failed:0,externalCalls:0,released:0,unknown:0});
 const scheduled=async(mode:string|undefined)=>{
  const handler=createWorkerHandler({createPool:()=>new Pool(x.runtime.options),commerceDueWork:idle,
   commerceApplyDeferred:async()=>({applied:0,failed:0,skipped:0}),commerceSweep:async()=>0,commerceEmailSweep:async()=>({expired:0,deleted:0}),
   syncGitHub:async()=>({requests:0,repositories:0,items_upserted:0,not_modified:0,stop_reason:'completed'}),authPrune:async()=>({sessions:0,login_attempts:0,auth_rate_limits:0,password_reset_tokens:0})});
  const pending:Promise<unknown>[]=[];await handler.scheduled({},{FREEDOM_COMMERCE_CONTACT_RETENTION:mode} as WorkerEnv,{waitUntil:p=>{pending.push(p);}});await Promise.all(pending);
 };
 for(const mode of [undefined,'off']){
  await scheduled(mode);assert.equal((await x.h.pool.query("SELECT 1 FROM commerce_due_work WHERE kind='checkout_contact_retention'")).rowCount,0);
  assert.equal((await contact(f.contactId)).redacted_at,null);
 }
 await claim(f,now);await x.h.pool.query("UPDATE commerce_due_work SET lease_until=NULL WHERE kind='checkout_contact_retention'");
 const before=(await x.h.pool.query("SELECT * FROM commerce_due_work WHERE kind='checkout_contact_retention'")).rows;
 for(const mode of [undefined,'off']){
  await scheduled(mode);
  assert.equal((await runDueCommerceWork(x.runtime,{freedomEnv:'local',now:()=>now},{kinds:['checkout_contact_retention']})).claimed,0);
  assert.deepEqual((await x.h.pool.query("SELECT * FROM commerce_due_work WHERE kind='checkout_contact_retention'")).rows,before);
  assert.equal((await contact(f.contactId)).redacted_at,null);
 }
});
test('all masks due order contacts while preserving abandoned contacts and customers',async()=>{
 const f=await fixture(),now=days(f.at,181);
 const source=(await x.h.pool.query('SELECT customer_id,current_contact_id,expires_at FROM commerce_checkouts WHERE checkout_id=$1',[f.c.checkout_id])).rows[0];
 const other=await x.frozen(f.s,1,{contact:{name:'合成未成單',email:'synthetic-abandoned@example.test',phone:'0000000000'}});
 const abandoned=(await x.h.pool.query('SELECT customer_id,current_contact_id FROM commerce_checkouts WHERE checkout_id=$1',[other.checkout_id])).rows[0];
 const orphan=randomUUID();await x.h.pool.query("INSERT INTO commerce_customers(customer_id,tenant_id,instance_id,email_normalized) VALUES($1,$2,$3,'synthetic-no-contact@example.test')",[orphan,f.s.tenantId,f.s.instanceId]);
 assert.ok(now>days(source.expires_at,31));
 assert.equal((await runContactRetentionWork(x.runtime,'all',{now:()=>now})).completed,1);
 assert.ok((await contact(f.contactId)).redacted_at);
 for(const row of [source,abandoned]){
  assert.equal((await contact(row.current_contact_id)).redacted_at,null);
  assert.equal((await x.h.pool.query('SELECT redacted_at FROM commerce_customers WHERE customer_id=$1',[row.customer_id])).rows[0].redacted_at,null);
 }
 const untouched=(await x.h.pool.query('SELECT redacted_at,email_normalized FROM commerce_customers WHERE customer_id=$1',[orphan])).rows[0];
 assert.deepEqual(untouched,{redacted_at:null,email_normalized:'synthetic-no-contact@example.test'});

});

/** A second complete self-shipped order deliberately reuses the first contact.
 * The schema has an ordinary contact index, not a unique order/contact binding. */
async function anotherSharedContactOrder(f:Awaited<ReturnType<typeof fixture>>){
 return x.tx(async q=>{
  await bindStore(q,f.s.tenantId);await lockStore(q,f.s,[],[f.orderId],false);
  const id=randomUUID(),client=randomUUID(),shipmentId=randomUUID();
  await q.query(`INSERT INTO commerce_orders(order_id,public_shop_id,external_id,request_sha256,currency,total_minor,created_at,expires_at,order_profile,client_order_id)
   SELECT $2,public_shop_id,'chk:'||$3::text||':'||$4::text,request_sha256,currency,total_minor,t,t+interval '72 hours','hosted_checkout',$4::uuid
   FROM commerce_orders CROSS JOIN (SELECT date_trunc('milliseconds',clock_timestamp()) t) n WHERE order_id=$1`,[f.orderId,id,f.checkoutId,client]);
  const order=(await q.query<CheckoutOrderRow>(`INSERT INTO commerce_checkout_orders(order_id,tenant_id,instance_id,checkout_id,customer_id,contact_id,display_number,terms,terms_sha256,environment,payment_method)
   SELECT $2,co.tenant_id,co.instance_id,co.checkout_id,co.customer_id,co.contact_id,to_char(o.created_at AT TIME ZONE 'Asia/Taipei','YYMMDD')||'-'||upper(substr(replace($2::text,'-',''),1,6)),co.terms,co.terms_sha256,co.environment,co.payment_method
   FROM commerce_checkout_orders co JOIN commerce_orders o ON o.order_id=$2 WHERE co.order_id=$1 RETURNING *,version::text`,[f.orderId,id])).rows[0];
  await q.query(`INSERT INTO commerce_order_lines(order_id,selection_id,item_id,quantity,snapshot,order_profile,supplier_shop_id,hosted_offer_id,acceptance_id,listing_sha256)
   SELECT $2,selection_id,item_id,quantity,snapshot,order_profile,supplier_shop_id,hosted_offer_id,acceptance_id,listing_sha256 FROM commerce_order_lines WHERE order_id=$1`,[f.orderId,id]);
  await (await checkoutInventory(q,id)).hold();
  const payment=(await q.query(`INSERT INTO commerce_offline_payments(tenant_id,instance_id,order_id,method,amount_minor,currency,received_on,confirmed_by_principal_id)
   VALUES($1,$2,$3,'bank_transfer',$4,'TWD',(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date,$5) RETURNING payment_id`,[f.s.tenantId,f.s.instanceId,id,order.terms.total_minor,f.principal.principal_id])).rows[0];
  await applyConfirmedPaymentHeld(q,{orderId:id,paymentRef:payment.payment_id,amountMinor:order.terms.total_minor,currency:'TWD',simulated:false},order);
  const shipment=(await q.query(`INSERT INTO commerce_self_shipments(shipment_id,tenant_id,instance_id,order_id,carrier_key,tracking_number,sent_on,recorded_by_principal_id)
   VALUES($1,$2,$3,$4,'post','SYNTHETIC-SHARED',(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date,$5) RETURNING recorded_at`,[shipmentId,f.s.tenantId,f.s.instanceId,id,f.principal.principal_id])).rows[0];
  const inv=await checkoutInventory(q,id);for(const a of inv.allocations)await inv.port.ship(a.item_id,a.quantity,shipmentId);
  return {orderId:id,shipmentId,at:shipment.recorded_at as Date};
 });
}
test('one contact waits for every referencing order to pass 180 days, then masks both shipments',async()=>{
 const f=await fixture(),second=await anotherSharedContactOrder(f),now=new Date(days(f.at,180).getTime()+1);
 assert.ok(now<days(second.at,180),'the second fulfilment is still less than 180 days old');
 assert.equal((await x.h.pool.query('SELECT count(*)::int n FROM commerce_checkout_orders WHERE contact_id=$1',[f.contactId])).rows[0].n,2);
 await run(f,now);assert.equal((await contact(f.contactId)).redacted_at,null);
 const result=await run(f,new Date(days(second.at,180).getTime()+1));assert.equal(result.contacts,1);assert.ok((await contact(f.contactId)).redacted_at);
 const shipments=(await x.h.pool.query('SELECT tracking_number,redacted_at FROM commerce_self_shipments WHERE shipment_id=ANY($1::uuid[])',[ [f.shipmentId,second.shipmentId] ])).rows;
 assert.equal(shipments.length,2);for(const s of shipments){assert.equal(s.tracking_number,null);assert.ok(s.redacted_at);}
});

/** Poll actual server lock state; setImmediate only yields between observations,
 * never substitutes an elapsed-time guess for the lock checkpoint. */
async function blockedBy(blocker:number,waiter?:number){
 const until=Date.now()+5000;
 while(Date.now()<until){
  if((await x.h.pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
   AND $1=ANY(pg_blocking_pids(pid)) AND ($2::int IS NULL OR pid=$2)`,[blocker,waiter??null])).rowCount)return;
  await new Promise<void>(resolve=>setImmediate(resolve));
 }
 assert.fail('expected concurrent transaction to wait on the store lock');
}
const exceptionInput=(f:Awaited<ReturnType<typeof fixture>>)=>({tenantId:f.s.tenantId,instanceId:f.s.instanceId,orderId:f.orderId,kind:'paid_unallocatable' as const,subjectKind:'offline_payment' as const,subjectId:randomUUID()});
test('retention waits for a store-locked exception mutation, then masks after commit',async()=>{
 const f=await fixture(),now=days(f.at,181),job=await claim(f,now),q=await x.runtime.connect();let work:ReturnType<typeof retainCheckoutContacts>|undefined;
 try{
  await q.query('BEGIN');await bindStore(q,f.s.tenantId);await lockStore(q,f.s,[],[f.orderId],false);
  const pid=(await q.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await openException(q,exceptionInput(f));
  work=retainCheckoutContacts(x.runtime,job,'all',{now:()=>now});
  await blockedBy(pid);assert.equal((await contact(f.contactId)).redacted_at,null);
  await q.query('COMMIT');assert.equal((await work).contacts,1);assert.ok((await contact(f.contactId)).redacted_at);
  assert.equal((await x.h.pool.query("SELECT count(*)::int n FROM commerce_exception_cases WHERE order_id=$1 AND status='open'",[f.orderId])).rows[0].n,1);
 }finally{await q.query('ROLLBACK');q.release();await work;}
});
test('a business mutation waits for retention to commit and can open an exception on the masked contact',async()=>{
 const f=await fixture(),now=days(f.at,181),job=await claim(f,now),gate=await x.h.pool.connect(),mutation=await x.runtime.connect();
 const key=randomUUID();let work:ReturnType<typeof retainCheckoutContacts>|undefined,change:Promise<unknown>|undefined;
 try{
  await gate.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[key]);
  // Pause the real retention transaction after its store lock, inside erasure.
  await x.h.pool.query(`CREATE FUNCTION retention_test_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   PERFORM pg_advisory_xact_lock(hashtextextended('${key}',0)); RETURN NEW; END $$;
   CREATE TRIGGER retention_test_gate BEFORE UPDATE ON commerce_checkout_contacts FOR EACH ROW EXECUTE FUNCTION retention_test_gate()`);
  const gatePid=(await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  work=retainCheckoutContacts(x.runtime,job,'all',{now:()=>now});await blockedBy(gatePid);
  const retentionPid=(await x.h.pool.query('SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[gatePid])).rows[0].pid;
  await mutation.query('BEGIN');await bindStore(mutation,f.s.tenantId);
  const mutationPid=(await mutation.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  change=(async()=>{await lockStore(mutation,f.s,[],[f.orderId],false);await openException(mutation,exceptionInput(f));await mutation.query('COMMIT');})();
  await blockedBy(retentionPid,mutationPid);
  await gate.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);
  assert.equal((await work).contacts,1);await change;assert.ok((await contact(f.contactId)).redacted_at);
  assert.equal((await x.h.pool.query("SELECT count(*)::int n FROM commerce_exception_cases WHERE order_id=$1 AND status='open'",[f.orderId])).rows[0].n,1);
 }finally{
  await gate.query('SELECT pg_advisory_unlock_all()');await work;await change;
  await mutation.query('ROLLBACK');mutation.release();gate.release();
  await x.h.pool.query('DROP TRIGGER IF EXISTS retention_test_gate ON commerce_checkout_contacts; DROP FUNCTION IF EXISTS retention_test_gate()');
 }
});

test('restore all mode masks due orders and preserves expired unreferenced contacts',async()=>{
 const f=await fixture(),source=(await x.h.pool.query('SELECT current_contact_id FROM commerce_checkouts WHERE checkout_id=$1',[f.c.checkout_id])).rows[0];
 const page=await runRestoredContactRetention(x.runtime,'all',{now:()=>days(f.at,181)});
 assert.equal(page.status,'scan_complete');assert.equal(page.deploymentReady,false);assert.equal(page.contacts,1);
 assert.ok((await contact(f.contactId)).redacted_at);assert.equal((await contact(source.current_contact_id)).redacted_at,null);
});

test('real email revision permanently retains the old live contact and both customer emails',async()=>{
 const s=await x.store(),emailA='synthetic-revision-a@example.test',emailB='synthetic-revision-b@example.test';
 const first=await x.frozen(s,1,{contact:{name:'合成買家甲',email:emailA,phone:'0000000000'}});
 const a=(await x.h.pool.query('SELECT customer_id,current_contact_id,expires_at FROM commerce_checkouts WHERE checkout_id=$1',[first.checkout_id])).rows[0];
 const revised=await x.tx(q=>freezeCheckout(q,s,{...x.input(s.product.sku,1),contact:{name:'合成買家乙',email:emailB,phone:'0000000000'},checkoutId:first.checkout_id,idempotencyKey:randomUUID()},ports));
 assert.equal(revised.checkout_id,first.checkout_id);
 const b=(await x.h.pool.query('SELECT customer_id,current_contact_id FROM commerce_checkouts WHERE checkout_id=$1',[revised.checkout_id])).rows[0];
 assert.notEqual(a.customer_id,b.customer_id);assert.notEqual(a.current_contact_id,b.current_contact_id);
 assert.equal((await x.h.pool.query('SELECT count(*)::int n FROM commerce_checkout_contacts WHERE checkout_id=$1',[first.checkout_id])).rows[0].n,2);
 const order=await x.place(s,revised);await x.tx(q=>cancelUnpaidOrder(q,s,order.order_id,'buyer','buyer_cancelled'));
 const placed=(await x.h.pool.query('SELECT contact_id,cancelled_at FROM commerce_checkout_orders WHERE order_id=$1',[order.order_id])).rows[0];
 assert.equal(placed.contact_id,b.current_contact_id);
 const now=days(placed.cancelled_at,400);
 assert.ok(now>days(a.expires_at,180));
 assert.equal((await runContactRetentionWork(x.runtime,'all',{now:()=>now})).completed,1);
 assert.ok((await contact(b.current_contact_id)).redacted_at);
 assert.equal((await contact(a.current_contact_id)).redacted_at,null);assert.equal((await contact(a.current_contact_id)).contact_email,emailA);
 // The older live contact still belongs to B's revised checkout and protects B.
 for(const [id,email] of [[a.customer_id,emailA],[b.customer_id,emailB]]){
  const customer=(await x.h.pool.query('SELECT redacted_at,email_normalized FROM commerce_customers WHERE customer_id=$1',[id])).rows[0];
  assert.deepEqual(customer,{redacted_at:null,email_normalized:email});
 }
 // A later sweep keeps the same permanent revision limit.
 assert.equal((await runRestoredContactRetention(x.runtime,'all',{now:()=>days(now,400)})).contacts,0);
 assert.equal((await contact(a.current_contact_id)).contact_email,emailA);
 for(const [id,email] of [[a.customer_id,emailA],[b.customer_id,emailB]])assert.deepEqual((await x.h.pool.query('SELECT redacted_at,email_normalized FROM commerce_customers WHERE customer_id=$1',[id])).rows[0],{redacted_at:null,email_normalized:email});
});
