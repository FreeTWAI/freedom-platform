import type {PoolClient} from 'pg';
import {z} from 'zod';
import {OpaqueId} from '../../../contracts/guild-launchpad/v1/primitives.js';
import {PublicStoreProjectionSchema} from '../../../contracts/guild-launchpad/v1/storefront.js';
import {notifyMember,type NotifyMemberInput} from '../../member-communications/notifications.js';
import {displayNumberPattern} from '../seller-console/route.js';
import type {CommerceSettings} from '../operations/runtime-settings.js';
import type {CheckoutStore} from './authority.js';
import {buyerOrderNotificationAction,sellerOrderNotificationAction} from './notification-action.js';

const events=['placed','buyer_cancelled','payment_confirmed','handed_over','seller_cancelled','payment_expired','shipped','paid_cancelled','refund_recorded'] as const;
export type OrderNotificationEvent=typeof events[number];
export interface OrderNotificationPort {
  emit(q:PoolClient,input:{store:CheckoutStore;orderId:string;event:OrderNotificationEvent;actorPrincipalId?:string|null}):Promise<void>;
}
export interface OrderNotificationOptions {orderNotifications?:OrderNotificationPort}
const kinds={paid_cancelled:'commerce_order_paid_cancelled',refund_recorded:'commerce_order_refund_recorded',shipped:'commerce_order_shipped',placed:'commerce_order_placed',buyer_cancelled:'commerce_order_buyer_cancelled',payment_confirmed:'commerce_order_payment_confirmed',
  handed_over:'commerce_order_handed_over',seller_cancelled:'commerce_order_seller_cancelled',payment_expired:'commerce_order_payment_expired'} as const;

/** One bounded snapshot without explicit recipient locks. The later notice INSERT
 * takes users FOR KEY SHARE through its FK, after commerce locks. Buyer offline
 * commands can retry their whole transaction once if that produces 40P01. */
export const SELLER_ORDER_NOTIFICATION_RECIPIENTS_SQL=`WITH eligible AS MATERIALIZED (
  SELECT u.user_id AS recipient_ref, t.community_id,
    CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END AS priority,
    m.principal_id
  FROM tenants t
  JOIN resource_scopes rs ON rs.kind='tenant' AND rs.tenant_ref=t.tenant_id AND rs.status='active'
  JOIN module_instances i ON i.tenant_id=t.tenant_id AND i.instance_id=$2
    AND i.module_key='storefront' AND i.status NOT IN ('archived','failed')
  JOIN module_definitions d ON d.module_key=i.module_key AND d.release_ref=i.module_release_ref
    AND d.capabilities @> '["store:read","store:orders:read"]'::jsonb
  JOIN tenant_memberships m ON m.tenant_id=t.tenant_id AND m.status='active'
  JOIN principals p ON p.principal_id=m.principal_id AND p.kind='person' AND p.status='active'
  JOIN users u ON u.user_id=p.user_ref AND u.community_id=t.community_id AND u.active
    AND (NOT u.onboarding_required OR u.onboarding_completed_at IS NOT NULL)
  LEFT JOIN tenant_module_permissions g ON g.tenant_id=m.tenant_id AND g.principal_id=m.principal_id
    AND g.instance_id=i.instance_id AND g.purpose IS NULL AND g.status='active'
  WHERE t.tenant_id=$1 AND NOT (u.user_id=ANY(coalesce($3::uuid[],'{}'::uuid[])))
    AND (m.role IN ('owner','admin') OR g.capabilities @> ARRAY['store:read','store:orders:read']::text[])
  ORDER BY priority,m.principal_id
  LIMIT 51
)
SELECT recipient_ref,community_id FROM eligible ORDER BY priority,principal_id;`;

const factsSchema=z.object({tenant_id:OpaqueId,instance_id:OpaqueId,community_id:OpaqueId,publication_id:OpaqueId,
  display_number:z.string().regex(displayNumberPattern),payment_method:z.enum(['bank_transfer','cash_on_meetup']),
  buyer_principal_id:OpaqueId,buyer_ref:OpaqueId,buyer_community_id:OpaqueId,buyer_active:z.boolean(),actor_ref:OpaqueId.nullable()});
const publicationSchema=z.object({name:PublicStoreProjectionSchema.shape.name,slug:z.string()});
type Facts=z.infer<typeof factsSchema>;

class NotificationDatabaseFailure {
  constructor(readonly cause:unknown){}
}
/** Tag the query boundary, including connection errors without SQLSTATE. Validation errors stay distinct. */
function databaseQueries(q:PoolClient):Pick<PoolClient,'query'> {
  return {query:(async(text:string,values?:unknown[])=>{
    try{return await q.query(text,values);}catch(error){throw new NotificationDatabaseFailure(error);}
  }) as PoolClient['query']};
}
function diagnostic(event:'commerce_order_notification_skipped'|'commerce_order_notification_fanout_capped') {
  // Diagnostics cannot turn a healthy domain transaction into a failed command.
  try{if(event==='commerce_order_notification_fanout_capped')console.error(event,{selected:50,overflow:true});else console.error(event);}catch{}
}
function copy(event:OrderNotificationEvent,method:Facts['payment_method'],buyer:boolean,S:string,D:string,refundState?:string) {
  switch(event){
    case 'paid_cancelled':return {title:'店家已取消訂單',body:`「${S}」的訂單 ${D} 已由店家取消；${refundState==='recorded'?'已退款':'待退款，店家會在平台外退款'}。`};
    case 'refund_recorded':return {title:'店家已登記退款',body:`「${S}」已登記訂單 ${D} 的全額退款；已退款。請開啟訂單查看。`};
    case 'shipped':return {title:'店家已登記出貨',body:`「${S}」已登記訂單 ${D} 出貨，請開啟訂單查看。`};
    case 'placed':return method==='bank_transfer'
      ?{title:'新訂單待確認收款',body:`「${S}」收到訂單 ${D}，等待銀行匯款；請至訂單頁查看。`}
      :{title:'新訂單待安排面交',body:`「${S}」收到訂單 ${D}，等待面交付款；請至訂單頁查看。`};
    case 'buyer_cancelled':return {title:'買家已取消訂單',body:`「${S}」的訂單 ${D} 已由買家取消。`};
    case 'payment_confirmed':return {title:'店家已確認收款',body:`「${S}」已確認收到訂單 ${D} 的付款。請開啟訂單查看最新狀態。`};
    case 'handed_over':return method==='cash_on_meetup'
      ?{title:'店家已登記面交完成',body:`「${S}」已登記訂單 ${D} 的面交收款與交貨。`}
      :{title:'店家已登記交貨',body:`「${S}」已登記訂單 ${D} 的面交交貨。`};
    case 'seller_cancelled':return {title:'店家已取消訂單',body:`「${S}」的訂單 ${D} 已由店家取消。`};
    case 'payment_expired':return {title:'訂單已因付款期限結束取消',body:buyer
      ?`「${S}」的訂單 ${D} 已在付款確認寬限結束後取消；若你已付款，請聯絡店家。`
      :`「${S}」的訂單 ${D} 已在付款確認寬限結束後取消，請至訂單頁查看。`};
  }
}

const installed:OrderNotificationPort={async emit(q,input){
  await q.query('SAVEPOINT commerce_order_notifications');
  try{
    const sql=databaseQueries(q),orderId=OpaqueId.parse(input.orderId),shopId=OpaqueId.parse(input.store.storefront_shop_id);
    const event=z.enum(events).parse(input.event),actor=input.actorPrincipalId==null?null:OpaqueId.parse(input.actorPrincipalId);
    // Read allowlisted scalars only; the retained publication selects S, never today's store profile.
    const raw=(await sql.query(`SELECT co.tenant_id,co.instance_id,t.community_id,co.terms->>'publication_id' AS publication_id,
      co.display_number,co.payment_method,(SELECT refund_state FROM commerce_paid_cancellations pc WHERE pc.order_id=co.order_id) AS refund_state,o.buyer_principal_id,b.user_ref AS buyer_ref,u.community_id AS buyer_community_id,
      (b.status='active' AND u.active) AS buyer_active,a.user_ref AS actor_ref
      FROM commerce_checkout_orders co JOIN commerce_orders o USING(order_id)
      JOIN commerce_storefront_profiles p ON p.tenant_id=co.tenant_id AND p.instance_id=co.instance_id AND p.storefront_shop_id=o.public_shop_id
      JOIN tenants t ON t.tenant_id=co.tenant_id
      JOIN commerce_shops shop ON shop.shop_id=o.public_shop_id AND shop.community_id=t.community_id AND shop.origin='hosted'
      LEFT JOIN principals b ON b.principal_id=o.buyer_principal_id AND b.kind='person'
      LEFT JOIN users u ON u.user_id=b.user_ref
      LEFT JOIN principals a ON a.principal_id=$3 AND a.kind='person'
      WHERE co.order_id=$1 AND o.public_shop_id=$2 AND o.order_profile='hosted_checkout'`,[orderId,shopId,actor])).rows[0];
    if(!raw)throw new Error('order_notification_metadata_missing');
    if(raw.buyer_principal_id!==null&&raw.payment_method!=='immediate_card'){
      const facts=factsSchema.parse(raw);
      const publication=publicationSchema.parse((await sql.query(`SELECT projection->>'name' AS name,slug FROM commerce_storefront_publications
        WHERE publication_id=$1 AND tenant_id=$2 AND instance_id=$3 AND slug=projection->>'slug'`,[facts.publication_id,facts.tenant_id,facts.instance_id])).rows[0]);
      const buyerAction=buyerOrderNotificationAction(publication.slug,orderId);
      const sellerAction=sellerOrderNotificationAction({tenantId:facts.tenant_id,instanceId:facts.instance_id},orderId);
      const notices:NotifyMemberInput[]=[],source_key=`commerce-order/v1/${orderId}/${event}`;
      const base={kind:kinds[event],source_key};
      if(event!=='placed'&&event!=='buyer_cancelled'&&facts.buyer_active&&facts.buyer_principal_id!==actor&&facts.buyer_ref!==facts.actor_ref){
        notices.push({...base,community_id:facts.buyer_community_id,recipient_ref:facts.buyer_ref,
          ...copy(event,facts.payment_method,true,publication.name,facts.display_number,raw.refund_state),action:buyerAction});
      }
      if(event==='placed'||event==='buyer_cancelled'||event==='payment_expired'){
        const excluded=[...new Set([facts.buyer_ref,facts.actor_ref].filter((id):id is string=>id!==null))];
        const recipients=(await sql.query<{recipient_ref:string;community_id:string}>(SELLER_ORDER_NOTIFICATION_RECIPIENTS_SQL,[facts.tenant_id,facts.instance_id,excluded])).rows;
        if(recipients.length>50)diagnostic('commerce_order_notification_fanout_capped');
        for(const recipient of recipients.slice(0,50))notices.push({...base,...recipient,
          ...copy(event,facts.payment_method,false,publication.name,facts.display_number),action:sellerAction});
      }
      const seen=new Set<string>();
      for(const notice of notices){
        const key=`${notice.community_id}/${notice.recipient_ref}`;if(seen.has(key))continue;seen.add(key);
        await notifyMember(sql,notice);
      }
    }
  }catch(error){
    if(error instanceof NotificationDatabaseFailure)throw error.cause;
    await q.query('ROLLBACK TO SAVEPOINT commerce_order_notifications');
    await q.query('RELEASE SAVEPOINT commerce_order_notifications');
    diagnostic('commerce_order_notification_skipped');return;
  }
  await q.query('RELEASE SAVEPOINT commerce_order_notifications');
}};

/** OFF installs no port: commerce commands issue no notification SQL at all. */
export function createOrderNotifications(enabled:boolean,settings:Pick<CommerceSettings,'checkoutEnabled'|'quarantine'>|undefined):OrderNotificationPort|undefined {
  return enabled&&settings?.checkoutEnabled===true&&settings.quarantine!==true?installed:undefined;
}
