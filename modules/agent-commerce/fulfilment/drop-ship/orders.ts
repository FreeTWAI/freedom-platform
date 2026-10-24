import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import * as wire from '../../../../contracts/guild-launchpad/v1/hosted-drop-ship.js';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {checkVersion} from '../../../../packages/db/index.js';
import {assertCurrentSessionClock} from '../../../../packages/db/member-session.js';
import {bindPrincipalContext,isolatedTransaction} from '../../../../packages/resource-scopes/tenant-transaction.js';
import {scopedMemberCommand} from '../../../../packages/scoped-commands/index.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import {unavailableTenantListCursor,type TenantListCursorCodec} from '../../../../packages/shared/tenant-list-cursor.js';
import type {Actor} from '../../../identity-membership/service.js';
import {requireStoreInstance} from '../../hosted/capabilities.js';
import {instance,profile,ready,storeRead} from '../../hosted/store.js';
import {bindStore,lockMachineOrder} from '../../checkout/authority.js';
import {confirmedPaymentSQL} from '../../checkout/confirmed-payment.js';
import {checkoutInventory} from '../../checkout/inventory.js';
import {lockCheckoutOrders} from '../../checkout/orders.js';
import {recordHandover} from '../../checkout/payments.js';
import {quarantineGate} from '../../checkout/public-commands.js';
import {selfShipBy,selfShipOrderView} from '../../checkout/self-ship-view.js';
import type {SellerCheckoutReadOptions} from '../../checkout/seller-orders.js';
import {shipmentInput} from '../self-shipments.js';

const agreementJoin=`JOIN commerce_fulfilment_agreements a ON a.agreement_id=(co.terms->'shipping'->'groups'->0->'agreement'->>'agreement_id')::uuid
  AND a.version::text=co.terms->'shipping'->'groups'->0->'agreement'->>'version'
  AND a.tenant_id=co.tenant_id AND a.instance_id=co.instance_id`;
const supplierPredicate=`a.supplier_tenant_id=$1 AND a.supplier_instance_id=$2
  AND co.terms->'shipping'->'groups'->0->>'fulfilment_mode'='drop_ship'
  AND co.terms->'shipping'->'groups'->0->>'method_ref'='self_ship'
  AND jsonb_array_length(co.terms->'shipping'->'groups')=1 AND a.signed_digest=a.terms_sha256`;
const shippedSQL=`EXISTS(SELECT 1 FROM commerce_inventory_allocations stock WHERE stock.order_id=co.order_id AND stock.shipped_quantity>0)`;
/** Only allowlisted contact scalars for these listed IDs are selected. Caller has bound this store tenant. */
export async function supplierDropShipOrderView(q:PoolClient,orderId:string,supplierTenantId:string,supplierInstanceId:string) {
  const row=(await q.query(`SELECT co.order_id,co.version::text,co.display_number,co.terms,co.lifecycle_state,s.name AS store_name,
      p.confirmed_at,c.redacted_at,c.delivery->>'name' AS recipient_name,c.delivery->>'mobile' AS mobile,
      c.delivery->>'postal_code' AS postal_code,c.delivery->>'address' AS address
    FROM commerce_checkout_orders co ${agreementJoin} JOIN commerce_shops s ON s.shop_id=a.store_shop_id
    JOIN commerce_checkout_contacts c ON c.contact_id=co.contact_id AND c.checkout_id=co.checkout_id AND c.tenant_id=co.tenant_id AND c.instance_id=co.instance_id
    JOIN LATERAL (SELECT p.confirmed_at FROM commerce_offline_payments p JOIN commerce_checkout_payment_applications applied
      ON applied.payment_ref=p.payment_id AND applied.order_id=p.order_id
      WHERE p.order_id=co.order_id AND p.method='bank_transfer' AND applied.outcome IN ('converted','allocated','unallocatable') ORDER BY p.confirmed_at LIMIT 1) p ON true
    WHERE ${supplierPredicate} AND co.order_id=$3 AND co.lifecycle_state<>'cancelled'`,[supplierTenantId,supplierInstanceId,orderId])).rows[0];
  requireCondition(row,409,'drop_ship_order_unavailable','訂單已取消或目前無法出貨。');
  const group=row.terms.shipping.groups[0],terms=group.drop_ship;
  requireCondition(terms,409,'drop_ship_order_unavailable','代出貨條件無法使用。');
  const manual=await selfShipOrderView(q,orderId,row.terms);
  const unable=(await q.query(`SELECT fulfiller_reason AS reason,fulfiller_note AS note FROM commerce_exception_cases
    WHERE order_id=$1 AND kind='fulfiller_unable' AND status='open' ORDER BY created_at DESC,case_id DESC LIMIT 1`,[orderId])).rows[0]??null;
  return wire.DropShipOrderSchema.parse({order_ref:orderId,version:row.version,store_name:row.store_name,display_number:row.display_number,
    payment_confirmed_at:row.confirmed_at.toISOString(),ship_by:selfShipBy(row.confirmed_at,terms.promise_working_days),
    items:row.terms.items.map((line:{sku:string;title:string;quantity:number})=>{const cost=terms.items.find((i:{sku:string})=>i.sku===line.sku);return {sku:line.sku,title:line.title,quantity:line.quantity,unit_supply_cost_minor:cost.unit_supply_cost_minor,supply_cost_minor:cost.unit_supply_cost_minor*line.quantity};}),
    supply_cost_minor:terms.supply_cost_minor,drop_ship_fee_minor:terms.fee_per_order_minor,currency:'TWD',
    recipient:row.redacted_at||![row.recipient_name,row.mobile,row.postal_code,row.address].every(v=>typeof v==='string')?null:{name:row.recipient_name,mobile:row.mobile,postal_code:row.postal_code,address:row.address},shipment:manual?.shipment??null,unable});
}
export async function listSupplierDropShipOrders(pool:Pool,actor:Actor,tenantId:string,instanceId:string,raw:unknown,cursors:TenantListCursorCodec=unavailableTenantListCursor) {
  OpaqueId.parse(tenantId);OpaqueId.parse(instanceId);const query={tab:'waiting' as const,limit:20,...wire.DropShipOrderQuerySchema.parse(raw)};
  return storeRead(pool,actor,tenantId,instanceId,'store:fulfil',async(q,context)=>{
    const supplier=await profile(q,tenantId,instanceId);ready(supplier);
    const binding={purpose:'supplier-orders' as const,tenantId,principalId:context.principal_id,scopeId:context.scope.scope_id,resourceId:instanceId,filter:JSON.stringify(['drop-ship/v1',query.tab])};
    const after=cursors.decode(query.cursor,binding);
    requireCondition(!after||Object.keys(after).sort().join(',')==='at,id'&&typeof after.at==='string'&&Number.isFinite(Date.parse(after.at))&&OpaqueId.safeParse(after.id).success,422,'invalid_cursor','分頁游標無效。');
    // Discovery reads no contacts and no retailer prices. Allocation facts are shared Commerce stock metadata.
    const refs=(await q.query(`SELECT co.order_id,co.tenant_id,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
      FROM commerce_checkout_orders co ${agreementJoin} JOIN commerce_orders o USING(order_id)
      WHERE ${supplierPredicate} AND ${confirmedPaymentSQL('co.order_id')} AND co.lifecycle_state<>'cancelled'
        AND ($3::boolean=${shippedSQL}) AND ($3::boolean OR co.lifecycle_state='open')
        AND ($4::timestamptz IS NULL OR (o.created_at,co.order_id)<($4::timestamptz,$5::uuid))
      ORDER BY o.created_at DESC,co.order_id DESC LIMIT $6`,[tenantId,instanceId,query.tab==='shipped',after?.at??null,after?.id??null,query.limit+1])).rows;
    const page=refs.slice(0,query.limit),byStore=new Map<string,typeof page>();
    for(const ref of page){const group=byStore.get(ref.tenant_id)??[];group.push(ref);byStore.set(ref.tenant_id,group);}
    const views=new Map<string,wire.DropShipOrder>();
    // Keep supplier authority in its own transaction. Each contact transaction binds exactly one store tenant.
    for(const [storeTenant,orders] of byStore)await isolatedTransaction(pool,async storeQ=>{
      await bindPrincipalContext(storeQ,context.principal_id);await bindStore(storeQ,storeTenant);
      for(const ref of orders) {
        const current=(await storeQ.query(`SELECT 1 FROM commerce_checkout_orders co WHERE co.order_id=$1 AND co.tenant_id=$2
          AND co.lifecycle_state<>'cancelled' AND ($3::boolean=${shippedSQL}) AND ($3::boolean OR co.lifecycle_state='open')`,[ref.order_id,storeTenant,query.tab==='shipped'])).rowCount;
        if(current)views.set(ref.order_id,await supplierDropShipOrderView(storeQ,ref.order_id,tenantId,instanceId));
      }
      await assertCurrentSessionClock(storeQ,actor);
    });
    await requireStoreInstance(q,context,instanceId,'store:fulfil');
    return wire.DropShipOrdersSchema.parse({items:page.map(r=>views.get(r.order_id)).filter(Boolean),next_cursor:refs.length>query.limit?cursors.encode({at:page.at(-1)!.at,id:page.at(-1)!.order_id},binding):null});
  });
}
export async function supplierDropShipCommand(pool:Pool,actor:Actor,tenantId:string,instanceId:string,orderId:string,action:'ship'|'unable',raw:unknown,key:string,expected:string,options:SellerCheckoutReadOptions={}) {
  OpaqueId.parse(tenantId);OpaqueId.parse(instanceId);OpaqueId.parse(orderId);quarantineGate(options);
  const body=action==='ship'?shipmentInput(raw):wire.DropShipUnableSchema.parse(raw);
  return storeRead(pool,actor,tenantId,instanceId,'store:fulfil',async(supplierQ,context)=>{
    const target=(await supplierQ.query(`SELECT co.tenant_id,co.instance_id,a.store_shop_id FROM commerce_checkout_orders co ${agreementJoin}
      WHERE ${supplierPredicate} AND co.order_id=$3`,[tenantId,instanceId,orderId])).rows[0];
    requireCondition(target,404,'checkout_order_not_found','找不到訂單。');
    let output!:wire.DropShipOrder;
    const authorize=async(q:PoolClient)=>{
      await requireStoreInstance(supplierQ,context,instanceId,'store:fulfil',true);await instance(supplierQ,tenantId,instanceId,false);
      await bindStore(q,target.tenant_id);
      const stored=(await q.query(`SELECT 1 FROM commerce_checkout_orders co ${agreementJoin} WHERE ${supplierPredicate} AND co.order_id=$3 AND co.tenant_id=$4`,[tenantId,instanceId,orderId,target.tenant_id])).rowCount;
      requireCondition(stored===1,404,'checkout_order_not_found','找不到訂單。');
    };
    await scopedMemberCommand(pool,{actor,scope:'personal',operation:`commerce.drop_ship.${action}`,target:{kind:'hosted_checkout_order',id:orderId},body:{tenant_id:tenantId,instance_id:instanceId,...body},key,expected},authorize,async q=>{
      await lockMachineOrder(q,orderId);const store={storefront_shop_id:target.store_shop_id};
      const [order]=await lockCheckoutOrders(q,[orderId],store);
      requireCondition(order.lifecycle_state!=='cancelled',409,'order_cancelled','訂單已取消。');
      checkVersion(order.version,expected);
      requireCondition(order.lifecycle_state==='open',409,'checkout_order_closed','訂單已結束。');
      requireCondition(order.payment_method==='bank_transfer',409,'payment_method_mismatch','訂單的付款方式不符。');
      const paid=(await q.query(`SELECT confirmed_at FROM commerce_offline_payments p WHERE p.order_id=$1 AND p.method='bank_transfer' AND ${confirmedPaymentSQL('p.order_id')}`,[orderId])).rows[0];
      requireCondition(paid,409,'payment_not_confirmed','訂單尚未確認付款。');
      requireCondition(!(await q.query('SELECT 1 FROM commerce_self_shipments WHERE order_id=$1',[orderId])).rowCount,409,'self_shipment_already_recorded','出貨已經登記。');
      requireCondition(!(await q.query('SELECT 1 FROM commerce_inventory_allocations WHERE order_id=$1 AND shipped_quantity>0',[orderId])).rowCount,409,'self_shipment_already_recorded','出貨已經登記。');
      if(action==='ship') {
        const shipment=shipmentInput(body),complete=(await q.query(`SELECT NOT EXISTS(SELECT 1 FROM commerce_order_lines l LEFT JOIN commerce_inventory_allocations a ON a.order_id=l.order_id AND a.item_id=l.item_id
          WHERE l.order_id=$1 AND (a.allocation_id IS NULL OR a.quantity<>l.quantity OR a.shipped_quantity<>0 OR a.released_quantity<>0)) AS ok`,[orderId])).rows[0].ok;
        const inventory=await checkoutInventory(q,orderId);
        requireCondition(complete&&inventory.allocations.length>0,409,'self_shipment_stock_unavailable','庫存不足，不能登記出貨。');
        const valid=(await q.query(`SELECT $2::date>=($1::timestamptz AT TIME ZONE 'Asia/Taipei')::date AND $2::date<=(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date AS ok`,[paid.confirmed_at,shipment.sent_on])).rows[0].ok;
        requireCondition(valid,422,'shipment_date_invalid','寄出日期必須在確認收款日到今天之間。');
        const shipmentId=randomUUID();await q.query(`INSERT INTO commerce_self_shipments(shipment_id,tenant_id,instance_id,order_id,carrier_key,carrier_name,tracking_number,sent_on,recorded_by_principal_id,shipper_instance_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[shipmentId,target.tenant_id,target.instance_id,orderId,shipment.carrier_key,shipment.carrier_name??null,shipment.tracking_number,shipment.sent_on,context.principal_id,instanceId]);
        await recordHandover(q,store,{shipmentRef:shipmentId,lines:inventory.allocations.map(a=>({orderId,itemId:a.item_id,quantity:a.quantity}))},{locksHeld:true});
        await q.query(`UPDATE commerce_exception_cases SET status='resolved',resolution_code='shipped',resolution_note='供應商已登記出貨。',resolved_by_principal_id=$2,updated_at=clock_timestamp(),version=version+1 WHERE order_id=$1 AND kind='fulfiller_unable' AND status='open'`,[orderId,context.principal_id]);
        await options.orderNotifications?.emit(q,{store,orderId,event:'shipped',actorPrincipalId:context.principal_id});
        await options.orderNotifications?.dropShip?.(q,{store,orderId,event:'shipped',actorPrincipalId:context.principal_id});
      }else {
        const unable=wire.DropShipUnableSchema.parse(body);
        await q.query(`INSERT INTO commerce_exception_cases(tenant_id,instance_id,order_id,kind,subject_kind,subject_id,responsible_party,executor_tenant_id,due_at,opened_by_kind,opened_by_principal_id,fulfiller_reason,fulfiller_note)
          VALUES($1,$2,$3,'fulfiller_unable','order',$3,'retailer',$4,clock_timestamp()+interval '72 hours','person',$5,$6,$7)
          ON CONFLICT(kind,subject_kind,subject_id) WHERE status='open' DO NOTHING`,[target.tenant_id,target.instance_id,orderId,tenantId,context.principal_id,unable.reason,unable.note??null]);
        await options.orderNotifications?.dropShip?.(q,{store,orderId,event:'unable',actorPrincipalId:context.principal_id});
      }
      return {id:orderId};
    },authorize,undefined,(source,command)=>isolatedTransaction(source,async q=>{
      const ref=await command(q);output=await supplierDropShipOrderView(q,(ref as {id:string}).id,tenantId,instanceId);await authorize(q);await assertCurrentSessionClock(q,actor);return ref;
    }));
    return output;
  });
}
