import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {SelfShipmentInputSchema} from '../../../contracts/guild-launchpad/v1/hosted-seller-checkout.js';
import {checkVersion} from '../../../packages/db/index.js';
import {requireCondition} from '../../../packages/shared/problem.js';
import type {Actor} from '../../identity-membership/service.js';
import {lockStore} from '../checkout/authority.js';
import {hasConfirmedPayment} from '../checkout/confirmed-payment.js';
import {checkoutInventory} from '../checkout/inventory.js';
import {lockCheckoutOrders} from '../checkout/orders.js';
import {recordHandover} from '../checkout/payments.js';
import {quarantineGate} from '../checkout/public-commands.js';
import {sellerCheckoutCommand} from '../checkout/seller-command.js';
import {projectSellerCheckoutOrder,sellerCheckoutOrderRow,type SellerCheckoutReadOptions} from '../checkout/seller-orders.js';

export function shipmentInput(raw:unknown) {
  const value=typeof raw==='object'&&raw!==null&&!Array.isArray(raw)?{...raw} as Record<string,unknown>:raw;
  if(value&&typeof value==='object')for(const key of ['carrier_name','tracking_number']) {
    const record=value as Record<string,unknown>,text=record[key];
    if(typeof text==='string') {
      requireCondition(!/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069<>]/u.test(text),422,'validation_failed','出貨資料有誤。');
      const normalized=text.normalize('NFKC').trim();
      if(key==='carrier_name')requireCondition(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(normalized),422,'validation_failed','出貨資料有誤。');
      record[key]=normalized;
    }
  }
  const parsed=SelfShipmentInputSchema.parse(value);
  requireCondition(parsed.carrier_key==='other'?parsed.carrier_name!==undefined:parsed.carrier_name===undefined,422,'validation_failed','物流業者資料有誤。');
  return parsed;
}
/** Intake flag intentionally does not strand frozen orders; console, capabilities and quarantine still apply. */
export async function recordSelfShipment(pool:Pool,actor:Actor,tenantId:string,instanceId:string,id:string,raw:unknown,key:string,expected:string,options:SellerCheckoutReadOptions={}) {
  quarantineGate(options);const body=shipmentInput(raw);
  return sellerCheckoutCommand(pool,actor,tenantId,instanceId,'store:fulfil','commerce.checkout_order.record_self_shipment',{kind:'hosted_checkout_order',id},body,key,expected,async(q,context)=>{
    await sellerCheckoutOrderRow(q,context,id);const store={storefront_shop_id:context.profile.storefront_shop_id};
    await lockStore(q,store,[],[id],false);const [order]=await lockCheckoutOrders(q,[id],store);checkVersion(order.version,expected);
    requireCondition(order.terms.shipping.groups.length===1&&order.terms.shipping.groups.every(group=>group.method_ref==='self_ship'&&group.fulfilment_mode==='self')&&order.terms.bindings.every(line=>line.supplier_instance_id===instanceId),409,'self_ship_not_selected','這筆訂單不是店家自行寄送。');
    requireCondition(order.payment_method==='bank_transfer'&&order.terms.currency==='TWD',409,'payment_method_mismatch','訂單的付款方式不符。');
    requireCondition(order.lifecycle_state!=='cancelled',409,'order_cancelled','訂單已取消。');
    requireCondition(order.lifecycle_state==='open',409,'checkout_order_closed','訂單已結束。');
    requireCondition(await hasConfirmedPayment(q,id),409,'payment_not_confirmed','訂單尚未確認付款。');
    requireCondition(!(await q.query('SELECT 1 FROM commerce_self_shipments WHERE order_id=$1',[id])).rowCount,409,'self_shipment_already_recorded','出貨已經登記。');
    const inventory=await checkoutInventory(q,id);
    const complete=(await q.query<{ok:boolean}>(`SELECT NOT EXISTS(SELECT 1 FROM commerce_order_lines l LEFT JOIN commerce_inventory_allocations a ON a.order_id=l.order_id AND a.item_id=l.item_id
      WHERE l.order_id=$1 AND (a.allocation_id IS NULL OR a.quantity<>l.quantity OR a.shipped_quantity<>0 OR a.released_quantity<>0)) AS ok`,[id])).rows[0].ok;
    requireCondition(complete&&inventory.allocations.length>0,409,'self_shipment_stock_unavailable','庫存不足，不能登記出貨。');
    const lines=inventory.allocations.map(a=>({orderId:id,itemId:a.item_id,quantity:a.quantity-a.shipped_quantity-a.released_quantity})).filter(line=>line.quantity>0);
    requireCondition(lines.length>0,409,'nothing_to_ship','沒有可出貨的商品。');
    const ok=(await q.query<{ok:boolean}>(`SELECT EXISTS(SELECT 1 FROM commerce_offline_payments WHERE order_id=$1 AND method='bank_transfer'
      AND $2::date>=(confirmed_at AT TIME ZONE 'Asia/Taipei')::date AND $2::date<=(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date) AS ok`,[id,body.sent_on])).rows[0].ok;
    requireCondition(ok,422,'shipment_date_invalid','寄出日期必須在確認收款日到今天之間。');
    const shipmentId=randomUUID();
    await q.query(`INSERT INTO commerce_self_shipments(shipment_id,tenant_id,instance_id,order_id,carrier_key,carrier_name,tracking_number,sent_on,recorded_by_principal_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[shipmentId,tenantId,instanceId,id,body.carrier_key,body.carrier_name??null,body.tracking_number,body.sent_on,context.tenant.principal_id]);
    await recordHandover(q,store,{shipmentRef:shipmentId,lines});
    await options.orderNotifications?.emit(q,{store,orderId:id,event:'shipped',actorPrincipalId:context.tenant.principal_id});
    return {id};
  },(q,context,orderId)=>projectSellerCheckoutOrder(q,context,orderId,options));
}
