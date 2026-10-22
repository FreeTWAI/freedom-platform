import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import {OpaqueId} from '../../../contracts/guild-launchpad/v1/primitives.js';
import {MemberOrderPageSchema,MemberOrderQuerySchema,MemberOrderSummarySchema} from '../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {isolatedTransaction} from '../../../packages/resource-scopes/tenant-transaction.js';
import {Problem,requireCondition} from '../../../packages/shared/problem.js';
import {unavailableTenantListCursor,type TenantListCursorCodec} from '../../../packages/shared/tenant-list-cursor.js';
import {member} from './buyer-identity.js';
import {bindStore} from './authority.js';
import {publicOrder} from './public-order.js';
import type {CheckoutPaymentPort} from './terms.js';

type Buyer=NonNullable<Awaited<ReturnType<typeof member>>>;
async function activeBuyer(q:PoolClient,token:string|undefined,userId?:string) {
  const identity=await member(q,token);
  requireCondition(identity&&(!userId||identity.userId===userId),401,'session_expired','登入已到期，請重新登入。');
  requireCondition(identity.offlineEligible,403,'member_unavailable','目前無法使用會員訂單。');
  return identity;
}
async function recheckBuyer(q:PoolClient,token:string|undefined,identity:Buyer) {
  const current=await activeBuyer(q,token,identity.userId);
  requireCondition(current.principalId===identity.principalId,403,'member_unavailable','目前無法使用會員訂單。');
}
const position=z.object({
  at:z.string().regex(new RegExp(z.regexes.datetime({precision:6}).source.replace(/\\d/g,'[0-9]')+'(?![\\s\\S])')).refine(v=>!v.startsWith('0000')),
  id:OpaqueId,
}).strict();
/** Preserve PostgreSQL microseconds; JS Date is only used for display timestamps. */
export function memberOrderPosition(raw:Record<string,unknown>|null) {
  if(raw===null)return null;
  const parsed=position.safeParse(raw);
  requireCondition(parsed.success,422,'invalid_cursor','分頁游標無效。');
  return parsed.data;
}

// Dependent LIMIT 1 lookups prevent an unbounded sidecar hash-join scan.
// Only these scalar fields of the immutable publication may cross the buyer ACL.
const metadataJoins=`
  LEFT JOIN LATERAL (
    SELECT tenant_id,instance_id,display_number,lifecycle_state,cancel_reason,terms->>'publication_id' AS publication_id
    FROM commerce_checkout_orders WHERE order_id=o.order_id AND order_profile='hosted_checkout' LIMIT 1
  ) co ON true
  LEFT JOIN LATERAL (
    SELECT slug,projection->>'name' AS frozen_name FROM commerce_storefront_publications
    WHERE publication_id=co.publication_id::uuid AND tenant_id=co.tenant_id AND instance_id=co.instance_id
      AND slug=projection->>'slug' LIMIT 1
  ) pub ON true
  LEFT JOIN LATERAL (
    SELECT instance_id FROM commerce_storefront_profiles
    WHERE instance_id=co.instance_id AND tenant_id=co.tenant_id AND storefront_shop_id=o.public_shop_id LIMIT 1
  ) provenance ON true`;
const metadataColumns=`o.order_id,o.created_at,o.total_minor,o.currency,
  to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
  co.tenant_id,co.instance_id,co.display_number,co.lifecycle_state,co.cancel_reason,
  pub.slug,pub.frozen_name,provenance.instance_id IS NOT NULL AS provenance`;
type Metadata={order_id:string;created_at:Date;total_minor:string;currency:string;cursor_at:string;
  tenant_id:string;instance_id:string;display_number:string;lifecycle_state:string;cancel_reason:string|null;
  slug:string;frozen_name:string;provenance:boolean};
function summary(row:Metadata) {
  const parsed=MemberOrderSummarySchema.safeParse({store:{slug:row.slug,name:row.frozen_name},order_ref:row.order_id,
    display_number:row.display_number,created_at:row.created_at.toISOString(),total_minor:Number(row.total_minor),currency:row.currency,
    status:{lifecycle_state:row.lifecycle_state,cancel_reason:row.cancel_reason},order_path:`/shops/${row.slug}/orders/${row.order_id}`});
  // Missing sidecar/publication/provenance is data failure, never a false-empty page.
  if(!row.provenance||!parsed.success)throw new Error('Invalid retained checkout order metadata.');
  return parsed.data;
}

/** Participant metadata is already RLS-exempt. No tenant fanout, PII read,
 * scope/principal creation, role change or new RLS exception is needed. */
export async function listMemberCheckoutOrders(pool:Pool,token:string|undefined,userId:string,rawQuery:unknown,
  cursors:TenantListCursorCodec=unavailableTenantListCursor) {
  const query=MemberOrderQuerySchema.parse(rawQuery),limit=query.limit??20;
  return isolatedTransaction(pool,async q=>{
    await q.query('SET TRANSACTION READ ONLY');
    const identity=await activeBuyer(q,token,userId);
    const binding={purpose:'buyer-orders' as const,principalId:identity.principalId??'',tenantId:'',scopeId:'',resourceId:null,filter:'{"profile":"hosted_checkout","v":1}'};
    const after=memberOrderPosition(cursors.decode(query.cursor,binding));
    if(identity.principalId===null){
      requireCondition(after===null,422,'invalid_cursor','分頁游標無效。');
      await recheckBuyer(q,token,identity);return MemberOrderPageSchema.parse({items:[],next_cursor:null});
    }
    const params:unknown[]=[identity.principalId];
    if(after)params.push(after.at,after.id);
    params.push(limit+1);
    const rows=(await q.query<Metadata>(`WITH candidate AS MATERIALIZED (
      SELECT order_id,public_shop_id,created_at,total_minor,currency FROM commerce_orders
      WHERE buyer_principal_id=$1 AND buyer_principal_id IS NOT NULL AND order_profile='hosted_checkout'
        ${after?'AND (created_at,order_id)<($2::timestamptz,$3::uuid)':''}
      ORDER BY created_at DESC,order_id DESC LIMIT $${params.length}
    ) SELECT ${metadataColumns} FROM candidate o ${metadataJoins}
      ORDER BY o.created_at DESC,o.order_id DESC`,params)).rows;
    const validated=rows.map(summary),items=validated.slice(0,limit),last=rows[items.length-1];
    await recheckBuyer(q,token,identity);
    return MemberOrderPageSchema.parse({items,next_cursor:rows.length>limit?cursors.encode({at:last.cursor_at,id:last.order_id},binding):null});
  });
}

async function retainedProof(q:PoolClient,slug:string,orderRef:string,token:string|undefined) {
  if(!OpaqueId.safeParse(orderRef).success)return null;
  const identity=await activeBuyer(q,token);
  if(!identity.principalId)return null;
  const row=(await q.query<Metadata>(`SELECT ${metadataColumns} FROM commerce_orders o ${metadataJoins}
    WHERE o.order_id=$1 AND o.buyer_principal_id=$2 AND o.order_profile='hosted_checkout' AND pub.slug=$3`,[orderRef,identity.principalId,slug])).rows[0];
  if(!row)return null;
  return {identity,row,heading:summary(row).store};
}
const denied=(error:unknown)=>error instanceof Problem&&[401,403].includes(error.status);
/** Authenticate before emitting even the historical store name. */
export async function retainedMemberOrderHeading(pool:Pool,slug:string,orderRef:string,token:string|undefined) {
  try {
    return await isolatedTransaction(pool,async q=>{
      await q.query('SET TRANSACTION READ ONLY');
      const proof=await retainedProof(q,slug,orderRef,token);if(!proof)return null;
      await recheckBuyer(q,token,proof.identity);return proof.heading;
    });
  } catch(error){if(denied(error))return null;throw error;}
}
/** Only readPublicOrder may use this fallback; commands keep current-store gates. */
export async function readRetainedMemberOrder(pool:Pool,slug:string,orderRef:string,token:string|undefined,payment?:CheckoutPaymentPort) {
  try {
    return await isolatedTransaction(pool,async q=>{
      await q.query('SET TRANSACTION READ ONLY');
      const proof=await retainedProof(q,slug,orderRef,token);if(!proof)return null;
      await bindStore(q,proof.row.tenant_id);
      const order=await publicOrder(q,{tenantId:proof.row.tenant_id,instanceId:proof.row.instance_id,projection:proof.heading},orderRef,payment);
      await recheckBuyer(q,token,proof.identity);return order;
    });
  } catch(error){if(denied(error))return null;throw error;}
}
