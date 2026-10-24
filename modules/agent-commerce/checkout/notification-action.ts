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
    const [tenantId,instanceId,orderId]=value.resource_id.split('_').map(expandUuid);
    return {tab:'stores',hash:sellerConsoleHref({tenantId,instanceId},'order',{id:orderId})};
  }
  const [slug,orderId]=value.resource_id.split('/');
  return {tab:'reservations',path:`/shops/${slug}/orders/${orderId}`};
}
