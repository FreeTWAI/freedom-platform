import type {PoolClient} from 'pg';
import type {CheckoutTerms} from './terms.js';

/** Count Monday–Friday strictly after the confirmation's Taipei calendar day. Holidays are included. */
export function selfShipBy(confirmedAt:Date,days:number):string {
  if(!Number.isInteger(days)||days<1||days>14)throw new Error('self_ship_promise_invalid');
  const calendar=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(confirmedAt);
  const date=new Date(`${calendar}T00:00:00.000Z`);
  for(let remaining=days;remaining>0;){date.setUTCDate(date.getUTCDate()+1);if(date.getUTCDay()!==0&&date.getUTCDay()!==6)remaining--;}
  return date.toISOString().slice(0,10);
}
/** Tenant/order authorization belongs to the caller; no recipient values enter this projection. */
export async function selfShipOrderView(q:PoolClient,orderId:string,terms:CheckoutTerms) {
  const promise=terms.shipping.groups[0]?.self_ship;
  if(!promise||terms.shipping.groups[0].method_ref!=='self_ship')return undefined;
  const payment=(await q.query<{confirmed_at:Date}>(`SELECT p.confirmed_at FROM commerce_offline_payments p
    JOIN commerce_checkout_payment_applications a ON a.payment_ref=p.payment_id AND a.order_id=p.order_id
    WHERE p.order_id=$1 AND a.outcome IN ('converted','allocated','unallocatable') ORDER BY p.confirmed_at,p.payment_id LIMIT 1`,[orderId])).rows[0];
  const row=(await q.query(`SELECT shipment_id,carrier_key,carrier_name,tracking_number,to_char(sent_on,'YYYY-MM-DD') AS sent_on,recorded_at,redacted_at
    FROM commerce_self_shipments WHERE order_id=$1`,[orderId])).rows[0];
  return {handling_days:promise.handling_days,note:promise.note,ship_by:payment?selfShipBy(payment.confirmed_at,promise.handling_days):null,
    shipment:row?{shipment_ref:row.shipment_id,carrier_key:row.carrier_key,carrier_name:row.redacted_at?null:row.carrier_name,tracking_number:row.redacted_at?null:row.tracking_number,sent_on:row.sent_on,recorded_at:row.recorded_at.toISOString(),redacted:row.redacted_at!==null}:null};
}
