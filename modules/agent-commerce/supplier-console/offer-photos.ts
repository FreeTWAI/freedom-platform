import type {Pool, PoolClient} from 'pg';
import {checkVersion} from '../../../packages/db/index.js';
import {requireCondition} from '../../../packages/shared/problem.js';
import {SupplyOfferPhotoStateSchema} from '../../../contracts/guild-launchpad/v1/hosted-distribution.js';
import type {Actor} from '../../identity-membership/service.js';
import {profile, ready, storeCommand, storeFact} from '../hosted/store.js';

export async function currentOfferPhoto(q:PoolClient, offerId:string) {
  return (await q.query(`SELECT p.*,p.seq::text FROM commerce_hosted_offer_photos p WHERE offer_id=$1 ORDER BY p.seq DESC LIMIT 1`,[offerId])).rows[0];
}
export async function offerPhotoStates(q:PoolClient, offerIds:string[]) {
  const rows=(await q.query(`SELECT DISTINCT ON(p.offer_id) p.offer_id,p.seq::text,p.asset_id,
    EXISTS(SELECT 1 FROM commerce_product_photo_targets t WHERE t.tenant_id=p.tenant_id AND t.instance_id=p.instance_id AND t.product_id=p.item_id
      AND ROW(t.scope_id,t.asset_id,t.representation_id,t.policy_revision)=ROW(p.scope_id,p.asset_id,p.representation_id,p.policy_revision)) AS matches
    FROM commerce_hosted_offer_photos p WHERE p.offer_id=ANY($1::uuid[]) ORDER BY p.offer_id,p.seq DESC`,[offerIds])).rows;
  return new Map(offerIds.map(id=>{
    const row=rows.find(row=>row.offer_id===id);
    return [id,SupplyOfferPhotoStateSchema.parse({state:row?.asset_id?'shared':'not_shared',seq:row?.seq??null,matches_current_photo:!!row?.asset_id&&row.matches})] as const;
  }));
}
export async function offerPhotoState(q:PoolClient, offerId:string) {
  return (await offerPhotoStates(q,[offerId])).get(offerId)!;
}
/** Called only with the owning store profile locked. The trigger repeats identity,
 * current-pointer, offered-state and contiguous-sequence checks for direct SQL. */
export async function appendCurrentOfferPhoto(q:PoolClient, offer:Record<string,any>, principalId:string) {
  return (await q.query(`INSERT INTO commerce_hosted_offer_photos(offer_id,seq,tenant_id,instance_id,item_id,scope_id,asset_id,representation_id,policy_revision,shared_by_principal_id)
    SELECT $1,(SELECT COALESCE(max(seq),0)+1 FROM commerce_hosted_offer_photos WHERE offer_id=$1),t.tenant_id,t.instance_id,t.product_id,t.scope_id,t.asset_id,t.representation_id,t.policy_revision,$5
    FROM commerce_product_photo_targets t JOIN assets a ON a.asset_id=t.asset_id AND a.state='ready' AND a.deletion_fence=0
    WHERE t.tenant_id=$2 AND t.instance_id=$3 AND t.product_id=$4 RETURNING seq::text`,
  [offer.offer_id,offer.tenant_id,offer.instance_id,offer.item_id,principalId])).rows[0]?.seq as string|undefined;
}
export async function shareSupplyOfferPhoto(pool:Pool, actor:Actor, tenantId:string, instanceId:string, offerId:string, key:string, expected:string) {
  return storeCommand(pool,actor,tenantId,instanceId,['store:write','store:publish'],'storefront.supply-offer.photo.share',{},key,expected,async(q,context)=>{
    const p=await profile(q,tenantId,instanceId,true);ready(p);
    const offer=(await q.query('SELECT * FROM commerce_hosted_supply_offers WHERE offer_id=$1 AND tenant_id=$2 AND instance_id=$3 FOR UPDATE',[offerId,tenantId,instanceId])).rows[0];
    requireCondition(offer,404,'not_found','找不到這份供貨版本。');
    const product=(await q.query(`SELECT l.aggregate_version::text AS version FROM commerce_items i
      JOIN commerce_selections l USING(item_id) WHERE i.item_id=$1 AND i.shop_id=$2 AND l.shop_id=$3 AND l.hosted_offer_id IS NULL`,[offer.item_id,p.supply_shop_id,p.storefront_shop_id])).rows[0];
    requireCondition(product,404,'not_found','找不到這項商品。');checkVersion(product.version,expected);
    requireCondition(offer.state==='offered',409,'supply_offer_withdrawn','這份供貨版本已撤回，無法提供照片。');
    const state=await offerPhotoState(q,offerId);
    if(state.state==='shared'&&state.matches_current_photo)return state;
    const seq=await appendCurrentOfferPhoto(q,offer,context.principal_id);
    requireCondition(seq,409,'product_photo_missing','請先在「照片」新增商品照片，再提供給店主評估。');
    await storeFact(q,context,offerId,seq,'storefront.supply-offer.photo.share','hosted_supply_offer_photo');
    return offerPhotoState(q,offerId);
  },offerId);
}
export async function stopSupplyOfferPhoto(pool:Pool, actor:Actor, tenantId:string, instanceId:string, offerId:string, key:string, expected:string) {
  return storeCommand(pool,actor,tenantId,instanceId,'store:write','storefront.supply-offer.photo.stop',{},key,expected,async(q,context)=>{
    const p=await profile(q,tenantId,instanceId,true);ready(p);
    const offer=(await q.query('SELECT * FROM commerce_hosted_supply_offers WHERE offer_id=$1 AND tenant_id=$2 AND instance_id=$3 FOR UPDATE',[offerId,tenantId,instanceId])).rows[0];
    requireCondition(offer,404,'not_found','找不到這份供貨版本。');checkVersion(String(offer.version),expected);
    const state=await offerPhotoState(q,offerId);
    if(state.state==='not_shared')return state;
    const seq=(BigInt(state.seq!)+1n).toString();
    await q.query(`INSERT INTO commerce_hosted_offer_photos(offer_id,seq,tenant_id,instance_id,item_id,shared_by_principal_id) VALUES($1,$2,$3,$4,$5,$6)`,[offerId,seq,tenantId,instanceId,offer.item_id,context.principal_id]);
    await storeFact(q,context,offerId,seq,'storefront.supply-offer.photo.stop','hosted_supply_offer_photo');
    return offerPhotoState(q,offerId);
  },offerId);
}
