import {OpaqueId} from '../../../contracts/guild-launchpad/v1/primitives.js';
import {isOrderNotificationAction, type OrderNotificationAction} from '../../member-communications/types.js';
import {sellerConsoleHref, type SellerScope} from '../seller-console/route.js';

export type OrderNotificationDestination=
  |{tab:'stores';hash:string}
  |{tab:'reservations';path:string};

/** Three canonical UUIDs fit the existing 100-character resource limit as a 98-character tuple. */
export function sellerOrderNotificationAction(scope:SellerScope,orderId:string):Extract<OrderNotificationAction,{tab:'stores'}> {
  const resource_id=[scope.tenantId,scope.instanceId,orderId].map(id=>OpaqueId.parse(id).replace(/-/g,'')).join('_');
  return {tab:'stores',resource_id};
}

/** Prefixes fit the existing store locator limit and select only fixed console destinations. */
export function dropShipNotificationAction(scope:SellerScope,id:string,destination:'supplier-orders'|'supplier-agreements'|'store-agreements'):Extract<OrderNotificationAction,{tab:'stores'}> {
  const prefix={'supplier-orders':'s','supplier-agreements':'a','store-agreements':'g'}[destination];
  return {tab:'stores',resource_id:prefix+[scope.tenantId,scope.instanceId,id].map(v=>OpaqueId.parse(v).replace(/-/g,'')).join('_')};
}

export function buyerOrderNotificationAction(slug:string,orderId:string):Extract<OrderNotificationAction,{tab:'reservations'}> {
  const action={tab:'reservations' as const,resource_id:`${slug}/${orderId}`};
  if(!isOrderNotificationAction(action))throw new Error('order_notification_action_invalid');
  return action;
}

function expandUuid(id:string):string {
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

/** Navigation only. The destination's normal session and order authorization still apply. */
export function orderNotificationDestination(value:unknown):OrderNotificationDestination|null {
  if(!isOrderNotificationAction(value))return null;
  if(value.tab==='stores'){
    const prefix=value.resource_id.length===99&&/^[asg]/.test(value.resource_id)?value.resource_id[0]:null;
    const [tenantId,instanceId,orderId]=(prefix?value.resource_id.slice(1):value.resource_id).split('_').map(expandUuid);
    if(prefix)return {tab:'stores',hash:`#stores/${tenantId}/${instanceId}/${prefix==='g'?'drop-ship':prefix==='a'?'supply/drop-ship-agreements':'supply/drop-ship-orders'}`};
    return {tab:'stores',hash:sellerConsoleHref({tenantId,instanceId},'order',{id:orderId})};
  }
  const [slug,orderId]=value.resource_id.split('/');
  return {tab:'reservations',path:`/shops/${slug}/orders/${orderId}`};
}
