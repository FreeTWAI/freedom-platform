import {readSellerOrderContact,readSellerCheckoutOrder} from '../../modules/agent-commerce/checkout/seller-orders.js';
import {authenticate} from '../../modules/identity-membership/service.js';
import {completeMeetup} from '../../modules/agent-commerce/payments/offline/confirm.js';
import {createPaymentMethodsPort} from '../../modules/agent-commerce/payments/offline/methods.js';
import {freezeCheckout,hashJSON} from '../../modules/agent-commerce/checkout/terms.js';
import {placeCheckoutOrder} from '../../modules/agent-commerce/checkout/orders.js';
import {syntheticShippingPort} from '../../scripts/synthetic-shipping-quote.js';
import {hostedPaymentHarness} from '../e2e/hosted-payment-fixture.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,beforeEach,after,test} from 'node:test';
import {checkoutHarness,type CheckoutHarness} from './hosted-checkout-harness.js';
import {seedSelfShipment} from './self-ship-fixture.js';
import {mapPersonPrincipal} from '../../packages/resource-scopes/index.js';
import {bindStore} from '../../modules/agent-commerce/checkout/authority.js';
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
async function run(f:Awaited<ReturnType<typeof fixture>>,now=days(f.at,181),limit=200){return retainCheckoutContacts(x.runtime,await claim(f,now),{now:()=>now,limit});}
const contact=async(id:string)=>(await x.h.pool.query('SELECT * FROM commerce_checkout_contacts WHERE contact_id=$1',[id])).rows[0];

test('fulfilment clock is recorded_at +180 days; contact and shipment erase atomically, order remains open',async()=>{
 const f=await fixture(),before=await contact(f.contactId);
 assert.equal((await run(f,days(f.at,180-1/86400))).contacts,1); // only expired abandoned source checkout
 assert.equal((await contact(f.contactId)).redacted_at,null);
 const due=await run(f,new Date(days(f.at,180).getTime()+1));assert.equal(due.contacts,1);assert.equal(due.customers,1);
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
 const u=(await x.h.pool.query('SELECT * FROM commerce_customers WHERE customer_id=(SELECT customer_id FROM commerce_checkouts WHERE checkout_id=$1)',[f.checkoutId])).rows[0];assert.equal(u.email_normalized,'redacted:'+u.customer_id);assert.equal(u.email_verified_at,null);
});

test('abandoned rows wait until checkout expiry +30 days and existing rows are discovered without insertion hooks',async()=>{
 const s=await x.store(),c=await x.frozen(s,1),row=(await x.h.pool.query('SELECT expires_at,current_contact_id FROM commerce_checkouts WHERE checkout_id=$1',[c.checkout_id])).rows[0];
 assert.equal((await x.h.pool.query("SELECT 1 FROM commerce_due_work WHERE kind='checkout_contact_retention'")).rowCount,0);
 assert.equal(await discoverContactRetention(x.runtime),1);assert.equal(await discoverContactRetention(x.runtime),0);
 let result=await runContactRetentionWork(x.runtime,{now:()=>days(row.expires_at,30-1/86400)});assert.equal(result.failed,0);assert.equal((await contact(row.current_contact_id)).redacted_at,null);
 await x.h.pool.query("UPDATE commerce_due_work SET due_at=$1,lease_until=NULL WHERE kind='checkout_contact_retention'",[days(row.expires_at,30)]);
 result=await runContactRetentionWork(x.runtime,{now:()=>days(row.expires_at,30)});assert.equal(result.completed,1);assert.ok((await contact(row.current_contact_id)).redacted_at);
});

test('open exceptions defer an overdue contact without restarting the original clock',async()=>{
 const f=await fixture(),now=days(f.at,181),id=randomUUID();
 await x.h.pool.query(`INSERT INTO commerce_exception_cases(case_id,tenant_id,instance_id,order_id,kind,subject_kind,subject_id,responsible_party,due_at,opened_by_kind)
 VALUES($1,$2,$3,$4,'paid_unallocatable','offline_payment',$5,'retailer',now(),'system')`,[id,f.s.tenantId,f.s.instanceId,f.orderId,randomUUID()]);
 await run(f,now);assert.equal((await contact(f.contactId)).redacted_at,null);
 await x.h.pool.query(`UPDATE commerce_exception_cases SET status='resolved',resolution_code='settled',resolution_note='合成處理完成',resolved_by_principal_id=$2,version=version+1,updated_at=clock_timestamp() WHERE case_id=$1`,[id,f.principal.principal_id]);
 await run(f,now);assert.ok((await contact(f.contactId)).redacted_at);
});

test('a live unfulfilled order has no invented deadline and protects the shared customer',async()=>{
 const f=await fixture(true);await run(f,days(f.at,2000));
 assert.ok((await contact(f.contactId)).redacted_at);
 const row=(await x.h.pool.query('SELECT customer_id,contact_id,lifecycle_state FROM commerce_checkout_orders WHERE order_id=$1',[f.sourceOrder!.order_id])).rows[0];
 assert.equal((await contact(row.contact_id)).redacted_at,null);assert.equal(row.lifecycle_state,'open');
 assert.equal((await x.h.pool.query('SELECT redacted_at FROM commerce_customers WHERE customer_id=$1',[row.customer_id])).rows[0].redacted_at,null);
});

test('cancelled order uses cancellation +180 days after inventory release, without closing it',async()=>{
 const s=await x.store(),c=await x.frozen(s,1),o=await x.place(s,c);
 await x.tx(q=>cancelUnpaidOrder(q,s,o.order_id,'buyer','buyer_cancelled'));
 const row=(await x.h.pool.query('SELECT contact_id,cancelled_at FROM commerce_checkout_orders WHERE order_id=$1',[o.order_id])).rows[0];
 await discoverContactRetention(x.runtime);
 await runContactRetentionWork(x.runtime,{now:()=>days(row.cancelled_at,179)});assert.equal((await contact(row.contact_id)).redacted_at,null);
 await x.h.pool.query("UPDATE commerce_due_work SET due_at=$1 WHERE kind='checkout_contact_retention'",[new Date(days(row.cancelled_at,180).getTime()+1)]);
 assert.equal((await runContactRetentionWork(x.runtime,{now:()=>new Date(days(row.cancelled_at,180).getTime()+1)})).failed,0);assert.ok((await contact(row.contact_id)).redacted_at);
 assert.deepEqual((await x.h.pool.query('SELECT lifecycle_state,closed_at FROM commerce_checkout_orders WHERE order_id=$1',[o.order_id])).rows[0],{lifecycle_state:'cancelled',closed_at:null});
});

test('bounded batches, stale leases, tenant tampering and aborts cannot erase another claim',async()=>{
 const f=await fixture(),now=days(f.at,181),job=await claim(f,now);
 await assert.rejects(()=>retainCheckoutContacts(x.runtime,{...job,tenant_id:randomUUID()},{now:()=>now}),/binding_invalid/);
 await assert.rejects(()=>retainCheckoutContacts(x.runtime,{...job,token:new Date(0).toISOString()},{now:()=>now}),/lease_lost/);
 await assert.rejects(()=>retainCheckoutContacts(x.runtime,job,{now:()=>days(now,1)}),/lease_lost/);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>retainCheckoutContacts(x.runtime,job,{now:()=>now,signal:controller.signal}),/aborted/);
 let clockCalls=0;await assert.rejects(()=>retainCheckoutContacts(x.runtime,job,{now:()=>++clockCalls===1?now:days(now,1)}),/lease_lost/);
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
 const failed=await runContactRetentionWork(x.runtime,{now:()=>now});assert.equal(failed.failed,1);assert.equal((await x.h.pool.query("SELECT failure_count FROM commerce_due_work WHERE kind='checkout_contact_retention'")).rows[0].failure_count,1);
 await x.h.pool.query('DROP TRIGGER fail_retention ON commerce_self_shipments; DROP FUNCTION fail_retention()');
 await run(f,now);assert.ok((await contact(f.contactId)).redacted_at);
});

test('restore privacy pages erase overdue restored references before exposure and require bounded continuation',async()=>{
 const a=await fixture(),b=await fixture(),now=days(b.at,181);
 const first=await runRestoredContactRetention(x.runtime,{now:()=>now,limit:1});assert.equal(first.deploymentReady,false);assert.equal(first.status,'repeat_page');
 let cursor:string|undefined;let complete=false;
 for(let i=0;i<8;i++){const page=await runRestoredContactRetention(x.runtime,{now:()=>now,limit:1,afterInstance:cursor});cursor=page.after_instance??undefined;if(page.status==='scan_complete'){complete=true;break;}}
 assert.equal(complete,true);assert.ok((await contact(a.contactId)).redacted_at);assert.ok((await contact(b.contactId)).redacted_at);
 await x.tx(async q=>{await bindStore(q,a.s.tenantId);assert.equal((await q.query('SELECT 1 FROM commerce_checkout_contacts WHERE contact_id=$1',[b.contactId])).rowCount,0);});
 await assert.rejects(()=>runRestoredContactRetention(x.runtime,{afterInstance:'bad'}),/cursor_invalid/);
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
  await discoverContactRetention(x.runtime);assert.equal((await runContactRetentionWork(x.runtime,{now:()=>days(r.recorded_at,181)})).failed,0);assert.ok((await contact(r.contact_id)).redacted_at);
  assert.equal((await x.h.pool.query('SELECT lifecycle_state FROM commerce_checkout_orders WHERE order_id=$1',[o.order_id])).rows[0].lifecycle_state,'open');
 });
 test('an unsettled payment defers a cancelled contact until settlement without resetting its clock',async()=>{
  const f=await hostedPaymentHarness('fp_retention_payment');
  try{await f.reset();const p=await f.placed();await f.x.tx(q=>cancelUnpaidOrder(q,p.s,p.order.order_ref,'buyer','buyer_cancelled'));
   const r=(await f.x.h.pool.query('SELECT contact_id,cancelled_at FROM commerce_checkout_orders WHERE order_id=$1',[p.order.order_ref])).rows[0],now=days(r.cancelled_at,181);
   await discoverContactRetention(f.x.runtime);await runContactRetentionWork(f.x.runtime,{now:()=>now});
   assert.equal((await f.x.h.pool.query('SELECT redacted_at FROM commerce_checkout_contacts WHERE contact_id=$1',[r.contact_id])).rows[0].redacted_at,null);
   await f.x.h.pool.query("UPDATE commerce_payment_attempts SET state='expired_unpaid',expired_at=clock_timestamp(),version=version+1 WHERE attempt_id=$1",[p.payment.attempt_ref]);
   await f.x.h.pool.query("UPDATE commerce_due_work SET due_at=$1 WHERE kind='checkout_contact_retention'",[now]);
   assert.equal((await runContactRetentionWork(f.x.runtime,{now:()=>now})).failed,0);assert.ok((await f.x.h.pool.query('SELECT redacted_at FROM commerce_checkout_contacts WHERE contact_id=$1',[r.contact_id])).rows[0].redacted_at);
  }finally{await f.stop();}
 });

 test('customer email left without a checkout reference after revision does not survive all contacts',async()=>{
  const f=await fixture(),id=randomUUID();
  await x.h.pool.query("INSERT INTO commerce_customers(customer_id,tenant_id,instance_id,email_normalized) VALUES($1,$2,$3,'synthetic-old-revision@example.test')",[id,f.s.tenantId,f.s.instanceId]);
  await run(f);const row=(await x.h.pool.query('SELECT email_normalized,redacted_at FROM commerce_customers WHERE customer_id=$1',[id])).rows[0];assert.equal(row.email_normalized,'redacted:'+id);assert.ok(row.redacted_at);
 });
