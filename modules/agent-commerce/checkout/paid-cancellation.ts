import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {checkVersion} from '../../../packages/db/index.js';
import {requireCondition} from '../../../packages/shared/problem.js';
import {lockStore} from './authority.js';
import {checkoutInventory} from './inventory.js';
import {lockCheckoutOrders} from './orders.js';
import {cancelPaidOrder} from './payments.js';
import type {SellerCheckoutContext} from './seller-command.js';
import {sellerCheckoutOrderRow,type SellerCheckoutReadOptions} from './seller-orders.js';

export type PaidCancellationReason='out_of_stock'|'cannot_ship'|'buyer_request'|'other';
export type OfflineRefund={refund_state:'pending'}|{refund_state:'recorded';refunded_on:string;refund_method:'bank_transfer'|'cash'};
export type PaidCancellationInput=OfflineRefund&{reason:PaidCancellationReason;note?:string};

async function confirmedOfflinePayment(q:PoolClient,id:string) {
  const row=(await q.query(`SELECT p.* FROM commerce_offline_payments p JOIN commerce_checkout_payment_applications a
    ON a.payment_ref=p.payment_id AND a.order_id=p.order_id WHERE p.order_id=$1 AND a.outcome IN ('converted','allocated','unallocatable')`,[id])).rows[0];
  requireCondition(row,409,'payment_not_confirmed','訂單尚未確認離線付款。');return row;
}
async function refundDate(q:PoolClient,paymentId:string,date:string) {
  const {ok}=(await q.query<{ok:boolean}>(`SELECT $2::date>=(confirmed_at AT TIME ZONE 'Asia/Taipei')::date
    AND $2::date<=(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date AS ok FROM commerce_offline_payments WHERE payment_id=$1`,[paymentId,date])).rows[0];
  requireCondition(ok,422,'refund_date_invalid','退款日期必須在確認收款日到今天之間（台北時間）。');
}
async function lockedOrder(q:PoolClient,context:SellerCheckoutContext,id:string,expected:string,open=false) {
  await sellerCheckoutOrderRow(q,context,id);const store={storefront_shop_id:context.profile.storefront_shop_id};
  await lockStore(q,store,[],[id],false);const [order]=await lockCheckoutOrders(q,[id],store);
  if(open)requireCondition(order.lifecycle_state==='open',409,'checkout_order_closed','訂單已結束。');
  checkVersion(order.version,expected);
  return {store,order};
}
/** The caller owns the scoped seller command and transaction. Delivery method is deliberately irrelevant. */
export async function cancelPaidOfflineOrderHeld(q:PoolClient,context:SellerCheckoutContext,id:string,body:PaidCancellationInput,expected:string,options:SellerCheckoutReadOptions={}) {
  const {store,order}=await lockedOrder(q,context,id,expected,true);
  requireCondition(order.lifecycle_state==='open',409,'checkout_order_closed','訂單已結束。');
  requireCondition(order.payment_method==='bank_transfer'||order.payment_method==='cash_on_meetup',409,'payment_method_mismatch','只有已確認的離線付款訂單可以在這裡取消。');
  const payment=await confirmedOfflinePayment(q,id),inv=await checkoutInventory(q,id);
  const delivered=(await q.query(`SELECT EXISTS(SELECT 1 FROM commerce_self_shipments WHERE order_id=$1)
    OR EXISTS(SELECT 1 FROM commerce_meetup_handovers WHERE order_id=$1) AS delivered`,[id])).rows[0].delivered;
  requireCondition(!delivered&&inv.allocations.every(a=>a.shipped_quantity===0),409,'order_already_shipped','訂單已出貨或交貨，不能取消。');
  if(body.refund_state==='recorded')await refundDate(q,payment.payment_id,body.refunded_on);
  await cancelPaidOrder(q,store,{orderId:id,commandRef:randomUUID()});await inv.releaseHolds();
  await q.query(`INSERT INTO commerce_paid_cancellations(order_id,tenant_id,instance_id,payment_id,reason,note,cancelled_by_principal_id,cancelled_at,
    amount_minor,currency,refund_state,refunded_on,refund_method,refund_recorded_by_principal_id,refund_recorded_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT cancelled_at FROM commerce_checkout_orders WHERE order_id=$1),$8,$9,$10,$11,$12,$13,CASE WHEN $10='recorded' THEN clock_timestamp() END)`,
  [id,context.tenant.tenant_id,context.profile.instance_id,payment.payment_id,body.reason,body.note??null,context.tenant.principal_id,
    payment.amount_minor,payment.currency,body.refund_state,body.refund_state==='recorded'?body.refunded_on:null,body.refund_state==='recorded'?body.refund_method:null,body.refund_state==='recorded'?context.tenant.principal_id:null]);
  await q.query(`UPDATE commerce_exception_cases SET status='resolved',resolution_code='cancelled',
    resolution_note='已取消整筆訂單；退款狀態請見訂單。',resolved_by_principal_id=$2,updated_at=clock_timestamp(),version=version+1
    WHERE order_id=$1 AND kind IN ('paid_unallocatable','fulfiller_unable') AND status='open'`,[id,context.tenant.principal_id]);
  await options.orderNotifications?.emit(q,{store,orderId:id,event:'paid_cancelled',actorPrincipalId:context.tenant.principal_id});
  return {id};
}
export async function recordPaidCancellationRefundHeld(q:PoolClient,context:SellerCheckoutContext,id:string,body:Extract<OfflineRefund,{refund_state:'recorded'}>,expected:string,options:SellerCheckoutReadOptions={}) {
  const {store}=await lockedOrder(q,context,id,expected);
  const cancellation=(await q.query('SELECT payment_id,refund_state FROM commerce_paid_cancellations WHERE order_id=$1 FOR UPDATE',[id])).rows[0];
  requireCondition(cancellation?.refund_state==='pending',409,'refund_not_available','這筆訂單沒有待登記的退款。');
  await refundDate(q,cancellation.payment_id,body.refunded_on);
  await q.query(`UPDATE commerce_paid_cancellations SET refund_state='recorded',refunded_on=$2,refund_method=$3,
    refund_recorded_by_principal_id=$4,refund_recorded_at=clock_timestamp() WHERE order_id=$1`,[id,body.refunded_on,body.refund_method,context.tenant.principal_id]);
  await options.orderNotifications?.emit(q,{store,orderId:id,event:'refund_recorded',actorPrincipalId:context.tenant.principal_id});return {id};
}
/** Explicit projections keep the optional merchant note off every buyer response. */
export async function paidCancellationView(q:PoolClient,id:string,store=false) {
  const row=(await q.query(`SELECT reason,note,amount_minor,currency,refund_state,to_char(refunded_on,'YYYY-MM-DD') AS refunded_on,
    refund_method FROM commerce_paid_cancellations WHERE order_id=$1`,[id])).rows[0];
  if(!row)return null;
  return {reason:row.reason,refund_state:row.refund_state,refunded_on:row.refunded_on,refund_method:row.refund_method,amount_minor:Number(row.amount_minor),currency:row.currency,...(store?{note:row.note}:{})};
}
