import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {checkVersion} from '../../../../packages/db/index.js';
import type {TenantScopeContext} from '../../../../packages/resource-scopes/index.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import type {LifecycleIntent,LifecycleTarget,LifecyclePublication} from '../../../assets/engine.js';
import type {StorefrontPhotoActor} from '../../hosted/photo-authority.js';
import {lockCurrentPhotoProduct,type PhotoCompletion} from '../../hosted/photo-target.js';
import {profile,ready} from '../../hosted/store.js';

/** Item/selection follows the existing profile and canonical policy locks. */
export async function lockGalleryProduct(q:PoolClient,c:TenantScopeContext,a:StorefrontPhotoActor,productId:string,create:boolean){
 const product=await lockCurrentPhotoProduct(q,c,a,productId,create);
 const p=await profile(q,c.tenant_id,a.instance_id);ready(p);
 if(create){
  await q.query(`INSERT INTO commerce_product_groups(group_id,tenant_id,instance_id,scope_id,anchor_product_id,last_changed_at_product_version)
   VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,instance_id,anchor_product_id) DO NOTHING`,[randomUUID(),c.tenant_id,a.instance_id,c.scope.scope_id,productId,product.aggregateVersion]);
  await q.query(`INSERT INTO commerce_product_group_members(tenant_id,instance_id,scope_id,group_id,selection_id,product_id)
   SELECT g.tenant_id,g.instance_id,g.scope_id,g.group_id,s.selection_id,g.anchor_product_id FROM commerce_product_groups g
   JOIN commerce_selections s ON s.item_id=g.anchor_product_id AND s.shop_id=$4
   WHERE g.tenant_id=$1 AND g.instance_id=$2 AND g.anchor_product_id=$3 ON CONFLICT DO NOTHING`,[c.tenant_id,a.instance_id,productId,p.storefront_shop_id]);
 }
 const group=(await q.query(`SELECT * FROM commerce_product_groups WHERE tenant_id=$1 AND instance_id=$2 AND anchor_product_id=$3 FOR UPDATE`,[c.tenant_id,a.instance_id,productId])).rows[0];
 return {product,p,group};
}
export async function lockGalleryPhoto(q:PoolClient,c:TenantScopeContext,a:StorefrontPhotoActor,id:string,productId:string,create:boolean):Promise<LifecycleTarget>{
 const {product,group}=await lockGalleryProduct(q,c,a,productId,create);
 requireCondition(group,404,'not_found','找不到這張商品照片。');
 const active=(await q.query('SELECT count(*)::int n FROM commerce_product_gallery_photos WHERE group_id=$1 AND position IS NOT NULL',[group.group_id])).rows[0].n as number;
 if(create){
  requireCondition(product.assetId||active===0,409,'gallery_main_missing','主照片已移除，請先設為主照片或移除保留的照片。');
  requireCondition(active+Number(Boolean(product.assetId))<8,409,'gallery_full','每項商品最多 8 張照片。');
  await q.query(`INSERT INTO commerce_product_gallery_photos(photo_id,tenant_id,instance_id,scope_id,group_id,product_id,last_changed_at_product_version)
   VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[id,c.tenant_id,a.instance_id,c.scope.scope_id,group.group_id,productId,product.aggregateVersion]);
 }
 const row=(await q.query(`SELECT * FROM commerce_product_gallery_photos WHERE photo_id=$1 AND tenant_id=$2 AND instance_id=$3 AND product_id=$4 AND group_id=$5 FOR UPDATE`,[id,c.tenant_id,a.instance_id,productId,group.group_id])).rows[0];
 requireCondition(row,404,'not_found','找不到這張商品照片。');
 return {targetId:id,aggregateVersion:product.aggregateVersion,assetId:row.asset_id};
}
/** Engine marked the exact immutable object ready; product CAS is still authoritative. */
export async function publishGalleryPhoto(q:PoolClient,c:TenantScopeContext,a:StorefrontPhotoActor,intent:LifecycleIntent,target:LifecycleTarget):Promise<LifecyclePublication<PhotoCompletion>>{
 requireCondition(intent.target_gallery_photo_id===target.targetId&&intent.target_tenant_id===c.tenant_id&&intent.target_instance_id===a.instance_id
  &&intent.scope_id===c.scope.scope_id&&intent.purpose==='storefront.product-photo'&&intent.state==='stored',409,'asset_source_mismatch','上傳內容與商品不同。');
 checkVersion(target.aggregateVersion,intent.expected_version);
 const row=(await q.query('SELECT * FROM commerce_product_gallery_photos WHERE photo_id=$1 AND tenant_id=$2 AND instance_id=$3',[target.targetId,c.tenant_id,a.instance_id])).rows[0];
 requireCondition(row&&!row.asset_id,409,'gallery_photo_exists','這張照片已經加入，請重新讀取。');
 const p=await profile(q,c.tenant_id,a.instance_id);ready(p);
 const primary=(await q.query('SELECT * FROM commerce_product_photo_targets WHERE tenant_id=$1 AND instance_id=$2 AND product_id=$3',[c.tenant_id,a.instance_id,row.product_id])).rows[0];
 const active=(await q.query('SELECT count(*)::int n FROM commerce_product_gallery_photos WHERE group_id=$1 AND position IS NOT NULL',[row.group_id])).rows[0].n as number;
 requireCondition(primary.asset_id||active===0,409,'gallery_main_missing','主照片已移除，請先設為主照片或移除保留的照片。');
 requireCondition(active+Number(Boolean(primary.asset_id))<8,409,'gallery_full','每項商品最多 8 張照片。');
 const next=(await q.query(`UPDATE commerce_selections SET aggregate_version=aggregate_version+1 WHERE shop_id=$1 AND item_id=$2 AND aggregate_version=$3 RETURNING aggregate_version::text version`,[p.storefront_shop_id,row.product_id,intent.expected_version])).rows[0];
 requireCondition(next,412,'version_conflict','商品已更新，請重新讀取。');
 await q.query(`UPDATE commerce_product_gallery_photos SET asset_id=$2,representation_id=$3,policy_revision=$4,position=$5,last_changed_at_product_version=$6 WHERE photo_id=$1`,[row.photo_id,intent.asset_id,intent.representation_id,intent.policy_revision,primary.asset_id?active+2:null,next.version]);
 if(!primary.asset_id)await q.query(`UPDATE commerce_product_photo_targets SET asset_id=$4,representation_id=$5,policy_revision=$6,linked_at_product_version=$7 WHERE tenant_id=$1 AND instance_id=$2 AND product_id=$3`,[c.tenant_id,a.instance_id,row.product_id,intent.asset_id,intent.representation_id,intent.policy_revision,next.version]);
 return {aggregateVersion:next.version,result:{productId:row.product_id,completedVersion:next.version,intentId:intent.intent_id},fact:{aggregateType:'storefront_product',id:row.product_id,data:{resource_id:row.product_id,version:next.version}}};
}
