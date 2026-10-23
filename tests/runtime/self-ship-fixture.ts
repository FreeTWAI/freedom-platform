import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {CheckoutTermsSchema} from '../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {hashJSON} from '../../modules/agent-commerce/checkout/terms.js';
import {applyConfirmedPaymentHeld} from '../../modules/agent-commerce/checkout/payments.js';
import {checkoutInventory} from '../../modules/agent-commerce/checkout/inventory.js';
import type {CheckoutOrderRow} from '../../modules/agent-commerce/checkout/orders.js';

/** An additional real manual order; leaves every existing card/meetup fixture intact. Caller owns the transaction. */
export async function seedSelfShipment(q:PoolClient,checkoutId:string,principalId:string) {
  const source=(await q.query(`SELECT c.*,p.storefront_shop_id,p.supply_shop_id,a.contact_name,a.contact_email,a.contact_phone,a.invoice
    FROM commerce_checkouts c JOIN commerce_checkout_contacts a ON a.contact_id=c.current_contact_id
    JOIN commerce_storefront_profiles p ON p.tenant_id=c.tenant_id AND p.instance_id=c.instance_id WHERE c.checkout_id=$1`,[checkoutId])).rows[0];
  const id=randomUUID(),contactId=randomUUID(),orderId=randomUUID(),client=randomUUID(),shipmentId=randomUUID();
  const delivery={method:'self_ship',name:'合成收件人',mobile:'0912345678',postal_code:'100',address:'合成路1號'};
  const salt=randomUUID().replaceAll('-','');
  const contactDigest=hashJSON({contact:{name:source.contact_name,email:source.contact_email,phone:source.contact_phone},delivery,invoice:source.invoice,salt});
  const terms=CheckoutTermsSchema.parse({...source.terms,contact_sha256:contactDigest,payment_methods:['bank_transfer'],offline_payment:{settings_version:'1',bank_transfer_deadline_days:3,meetup_deadline_days:null},shipping_total_minor:0,total_minor:source.terms.merchandise_total_minor,
    shipping:{delivery_profile_version:'1',destination_state:'complete',groups:[{group_ref:'g1',supplier_shop_id:source.supply_shop_id,method_ref:'self_ship',fulfilment_mode:'self',agreement:null,profile_version:'1',logistics:null,meetup:null,
      self_ship:{service_key:'seller.self_ship.v1',fee_basis:'order',handling_days:2,working_days:[1,2,3,4,5],note:null},parcels:[{parcel_ref:'g1-p1',lines:source.terms.items.map((l:{sku:string;quantity:number})=>({sku:l.sku,quantity:l.quantity})),weight_g:null,declared_value_minor:source.terms.merchandise_total_minor}],attribute_versions:[],fee_per_parcel_minor:0,outlying_surcharge_per_parcel_minor:0,amount_minor:0}]}});
  await q.query(`INSERT INTO commerce_checkout_contacts(contact_id,checkout_id,tenant_id,instance_id,contact_name,contact_email,contact_phone,delivery,invoice,contact_sha256,contact_salt)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[contactId,id,source.tenant_id,source.instance_id,source.contact_name,source.contact_email,source.contact_phone,delivery,source.invoice,contactDigest,salt]);
  await q.query(`INSERT INTO commerce_checkouts(checkout_id,tenant_id,instance_id,customer_id,publication_revision,currency,terms,terms_sha256,current_contact_id,idempotency_key_sha256,request_sha256,created_at,expires_at)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,t,t+interval '24 hours' FROM (SELECT date_trunc('milliseconds',clock_timestamp()) t) n`,
    [id,source.tenant_id,source.instance_id,source.customer_id,source.publication_revision,source.currency,terms,hashJSON(terms),contactId,hashJSON(id),hashJSON(orderId)]);
  await q.query(`INSERT INTO commerce_orders(order_id,public_shop_id,external_id,request_sha256,currency,total_minor,created_at,expires_at,order_profile,client_order_id)
    SELECT $1,$2,'chk:'||$3::text||':'||$4::text,$5,$6,$7,t,t+interval '72 hours','hosted_checkout',$4::uuid FROM (SELECT date_trunc('milliseconds',clock_timestamp()) t) n`,
    [orderId,source.storefront_shop_id,id,client,hashJSON(client),source.currency,terms.total_minor]);
  const order=(await q.query<CheckoutOrderRow>(`INSERT INTO commerce_checkout_orders(order_id,tenant_id,instance_id,checkout_id,customer_id,contact_id,display_number,terms,terms_sha256,environment,payment_method)
    SELECT $1,$2,$3,$4,$5,$6,to_char(created_at AT TIME ZONE 'Asia/Taipei','YYMMDD')||'-SH1P01',$7,$8,'sandbox','bank_transfer' FROM commerce_orders WHERE order_id=$1 RETURNING *,version::text`,
    [orderId,source.tenant_id,source.instance_id,id,source.customer_id,contactId,terms,hashJSON(terms)])).rows[0];
  await q.query(`INSERT INTO commerce_order_lines(order_id,selection_id,item_id,quantity,snapshot,order_profile,supplier_shop_id,hosted_offer_id,acceptance_id,listing_sha256)
    SELECT $1,(b->>'selection_id')::uuid,(b->>'item_id')::uuid,(b->>'quantity')::int,item.value,'hosted_checkout',(b->>'supplier_shop_id')::uuid,(b->>'offer_id')::uuid,(b->>'acceptance_id')::uuid,NULLIF(b->>'listing_sha256','')
    FROM commerce_checkout_orders co CROSS JOIN LATERAL jsonb_array_elements(co.terms->'bindings') b
    CROSS JOIN LATERAL (SELECT value FROM jsonb_array_elements(co.terms->'items') item WHERE item->>'sku'=b->>'sku' LIMIT 1) item WHERE co.order_id=$1`,[orderId]);
  await q.query(`INSERT INTO commerce_inventory_reservations(order_id,item_id,supplier_shop_id,quantity,state,created_at,expires_at)
    SELECT l.order_id,l.item_id,l.supplier_shop_id,l.quantity,'held',o.created_at,o.expires_at FROM commerce_order_lines l JOIN commerce_orders o USING(order_id) WHERE l.order_id=$1`,[orderId]);
  await q.query(`UPDATE commerce_items i SET stock=stock+l.quantity,reserved=reserved+l.quantity FROM commerce_order_lines l WHERE l.order_id=$1 AND i.item_id=l.item_id`,[orderId]);
  const payment=(await q.query(`INSERT INTO commerce_offline_payments(tenant_id,instance_id,order_id,method,amount_minor,currency,received_on,confirmed_by_principal_id)
    VALUES($1,$2,$3,'bank_transfer',$4,'TWD',(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date,$5) RETURNING payment_id`,[source.tenant_id,source.instance_id,orderId,terms.total_minor,principalId])).rows[0];
  await applyConfirmedPaymentHeld(q,{orderId,paymentRef:payment.payment_id,amountMinor:terms.total_minor,currency:'TWD',simulated:false},order);
  await q.query(`INSERT INTO commerce_self_shipments(shipment_id,tenant_id,instance_id,order_id,carrier_key,tracking_number,sent_on,recorded_by_principal_id)
    VALUES($1,$2,$3,$4,'post','SYNTHETIC-123',(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date,$5)`,[shipmentId,source.tenant_id,source.instance_id,orderId,principalId]);
  const inventory=await checkoutInventory(q,orderId);
  for(const a of inventory.allocations)await inventory.port.ship(a.item_id,a.quantity,shipmentId);
  return {shipmentId,orderId,contactId,checkoutId:id};
}
