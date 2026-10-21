import type {CategoriesOptions} from '../categories/model.js';
import type {Pool,PoolClient} from 'pg';
import {isolatedTransaction} from '../../../../packages/resource-scopes/tenant-transaction.js';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import {readCheckoutStore} from '../../checkout/authority.js';
import {publicPurchaseStateWithClient,type HostedCheckoutOptions} from '../../checkout/public-commands.js';
import {sharedLines} from '../../hosted/shared-quotes.js';
import {suppliedConsentAvailable} from '../../hosted/supply-availability.js';
import {resolvePublicStorePage} from '../../hosted/public.js';
import type {AppearanceOptions} from '../../hosted/appearance.js';
import type {GalleryOptions} from '../gallery/model.js';
import type {PoliciesOptions} from '../policies/model.js';
import type {PublicationVariantsDocument} from '../../../../contracts/guild-launchpad/v1/storefront-variants.js';
export type VariantAvailability='available'|'sold_out'|'unavailable';
export interface RenderCatalog {document:PublicationVariantsDocument;availability?:ReadonlyMap<string,VariantAvailability>}
/** Two bulk selection reads (preflight and canonical raw validation) plus one
 * inventory aggregate. A stopped supply never hides a different sellable SKU.
 * No shipping or payment quote is run for individual grid cards. */
async function availability(q:PoolClient,store:NonNullable<Awaited<ReturnType<typeof resolvePublicStorePage>>>){
 const skus=store.projection.products.map(p=>p.sku),context=await readCheckoutStore(q,{storefront_shop_id:store.storefrontShopId},skus),p=context.profile;
 const rows=(await q.query(`SELECT l.*,COALESCE(l.hosted_sku,i.sku) AS sku,i.title AS own_title,i.shop_id AS supplier_shop_id,source.instance_id AS supplier_instance_id,
  o.terms AS offer_terms,o.terms_sha256 AS offer_sha256,o.state AS offer_state,a.acceptance_id,a.listing_sha256 AS accepted_sha256,a.decision AS acceptance_decision
  FROM commerce_selections l JOIN commerce_items i USING(item_id) JOIN commerce_storefront_profiles source ON source.supply_shop_id=i.shop_id
  LEFT JOIN commerce_hosted_supply_offers o ON o.offer_id=l.hosted_offer_id AND o.item_id=l.item_id AND o.tenant_id=source.tenant_id AND o.instance_id=source.instance_id
  LEFT JOIN commerce_distribution_acceptances a ON a.acceptance_id=l.current_acceptance_id AND a.selection_id=l.selection_id
  WHERE l.shop_id=$1 AND COALESCE(l.hosted_sku,i.sku)=ANY($2::text[]) ORDER BY l.selection_id`,[p.storefront_shop_id,skus])).rows;
 const states=new Map<string,VariantAvailability>(skus.map(s=>[s,'unavailable']));
 const valid=store.projection.products.filter(product=>{const r=rows.find(r=>r.sku===product.sku),supplier=r&&context.parties.get(r.supplier_instance_id);if(!r||!supplier||supplier.currency!==p.currency||supplier.supply_shop_id!==r.supplier_shop_id)return false;
  const own=supplier.instance_id===p.instance_id;return (own?r.hosted_offer_id===null:suppliedConsentAvailable(r,p.currency))&&(own?r.own_title:r.offer_terms.title)===product.title&&Number(r.retail_price_minor)===product.price_minor;});
 if(valid.length){
  const resolved=await sharedLines(q,{profile:p,shared:{}},valid.map(p=>({sku:p.sku,quantity:1})),async id=>{const supplier=context.parties.get(id);requireCondition(supplier,409,'supply_unavailable','供貨來源無法使用。');return supplier;});
  const balances=(await q.query(`SELECT i.item_id,greatest(0,i.stock
   -coalesce((SELECT sum(h.quantity) FROM commerce_inventory_reservations h WHERE h.item_id=i.item_id AND h.state='held' AND h.expires_at>clock_timestamp()),0)
   -coalesce((SELECT sum(a.quantity-a.shipped_quantity-a.released_quantity) FROM commerce_inventory_allocations a WHERE a.item_id=i.item_id),0))::int AS available
   FROM commerce_items i WHERE i.item_id=ANY($1::uuid[])`,[resolved.bindings.map(b=>b.item_id)])).rows;
  for(const b of resolved.bindings)states.set(b.sku,(balances.find(r=>r.item_id===b.item_id)?.available??0)>0?'available':'sold_out');
 }
 return states;
}
/** Publication and availability are paired in one read-only transaction. The
 * gate is checked first; a closed checkout makes no inventory/availability read. */
export async function readVariantBuyerPage(pool:Pool,slug:string,options:{appearance?:AppearanceOptions;policies?:PoliciesOptions;gallery?:GalleryOptions;categories?:CategoriesOptions},checkout?:HostedCheckoutOptions){
 for(let attempt=0;attempt<2;attempt++){
  try{
   const value=await isolatedTransaction(pool,async q=>{
    await q.query('SET TRANSACTION READ ONLY');const store=await resolvePublicStorePage(q,slug,options.appearance,options.policies,options.gallery,{enabled:true},options.categories);if(!store)return null;
    const purchase=checkout?await publicPurchaseStateWithClient(q,slug,checkout):{open:false as const};
    const catalog:RenderCatalog={document:store.variants!.document,...(purchase.open?{availability:await availability(q,store)}:{})};
    const current=await resolvePublicStorePage(q,slug);if(!current)return null;
    if(current.publicationId!==store.publicationId)return undefined;
    return {store,purchase,catalog};
   });if(value!==undefined)return value;
  }catch(e){if(!(e instanceof Problem&&['publication_changed','supply_unavailable'].includes(e.code)))throw e;}
 }
 throw new Problem(503,'storefront_catalog_changed','商店內容正在更新，請重新載入。');
}
