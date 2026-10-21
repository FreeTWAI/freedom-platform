import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {OpaqueId,Version} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {STOREFRONT_GALLERY_PROFILE,GalleryPhotoKeySchema,GalleryOperationSchema,GalleryCommandAckSchema,ReorderGalleryInputSchema,GalleryAltInputSchema,RemoveGalleryPhotoInputSchema,normalizeGalleryAlt,
 type GalleryCommandAck} from '../../../../contracts/guild-launchpad/v1/storefront-gallery.js';
import {checkVersion,digest} from '../../../../packages/db/index.js';
import {assertCurrentSessionClock} from '../../../../packages/db/member-session.js';
import {AssetStorageError,snapshotBoundedBytes} from '../../../../packages/asset-storage/index.js';
import {isolatedTransaction} from '../../../../packages/resource-scopes/tenant-transaction.js';
import type {TenantScopeContext} from '../../../../packages/resource-scopes/index.js';
import {scopedTenantCommand} from '../../../../packages/scoped-commands/index.js';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import type {Actor} from '../../../identity-membership/service.js';
import type {StoreGalleryAssets} from '../../../assets/storefront-gallery.js';
import {storeCapabilities} from '../../hosted/capabilities.js';
import {lockStorefrontPhotoBoundary,type StorefrontPhotoActor} from '../../hosted/photo-authority.js';
import {photoProducts} from '../../hosted/photo-projection.js';
import {storeFact,type Profile} from '../../hosted/store.js';
import {draftGalleryData,mainIdentity,privateGalleryView,type DraftPhoto,type GalleryOptions} from './model.js';
import {lockGalleryProduct} from './target.js';
interface Receipt {productId:string;completedVersion:string;changed:boolean;operation:GalleryCommandAck['operation'];photoKey:string|null}
interface Command {actor:StorefrontPhotoActor;productId:string;expected:string;key:string;operation:Receipt['operation'];photoKey:string|null;body:unknown}
function input(actor:Actor,t:string,i:string,p:string,key:string,expected:string,operation:Receipt['operation'],photoKey:string|null,body:unknown):Command{
 return {actor:Object.freeze({...actor,tenant_id:OpaqueId.parse(t),instance_id:OpaqueId.parse(i)}),productId:OpaqueId.parse(p),expected:Version.parse(expected),key,operation:GalleryOperationSchema.parse(operation),photoKey:photoKey===null?null:GalleryPhotoKeySchema.parse(photoKey),body};
}
async function command(pool:Pool,input:Command,options:GalleryOptions,run:(q:PoolClient,c:TenantScopeContext)=>Promise<Receipt>){
 let p!:Profile,c!:TenantScopeContext,ack!:GalleryCommandAck;
 const authorize=async(q:PoolClient,context:TenantScopeContext)=>{c=context;p=await lockStorefrontPhotoBoundary(q,context,input.actor);
  requireCondition((await photoProducts(q,p,{retailOnly:true})).some(item=>item.product.product_id===input.productId),404,'not_found','找不到這項商品。');};
 const reference=await scopedTenantCommand(pool,{actor:input.actor,tenantId:input.actor.tenant_id,tenantLock:'share',operation:'storefront.product.gallery.'+input.operation,
  body:{photo_key:input.photoKey,...(input.body as object)},key:input.key,expected:input.expected,target:{kind:'storefront_product',id:input.productId},capabilitiesForRole:storeCapabilities},authorize,run,authorize,undefined,
  (source,execute)=>isolatedTransaction(source,async q=>{
   const receipt=await execute(q) as Receipt;
   requireCondition(receipt.productId===input.productId&&receipt.operation===input.operation&&receipt.photoKey===input.photoKey,500,'storefront_gallery_invalid','商品圖組回覆無效。');
   const items=await photoProducts(q,p,{retailOnly:true}),item=items.find(r=>r.product.product_id===input.productId);
   requireCondition(item,404,'not_found','找不到這項商品。');
   const current=privateGalleryView(p,item,(await draftGalleryData(q,p,items)).byId.get(input.productId)!,options);
   ack=GalleryCommandAckSchema.parse({profile:STOREFRONT_GALLERY_PROFILE,product_id:receipt.productId,operation:receipt.operation,photo_key:receipt.photoKey,completed_version:receipt.completedVersion,changed:receipt.changed,current});
   await authorize(q,c);await assertCurrentSessionClock(q,input.actor);return receipt as Awaited<ReturnType<typeof execute>>;
  }));return {reference,ack};
}
/** Positions are rewritten under the product lock. Old primary gets a retained
 * UUID row; moving a photo never copies bytes or changes its Asset identity. */
async function saveOrder(q:PoolClient,c:TenantScopeContext,cmd:Command,desired:DraftPhoto[],promote:boolean){
 const {p,group}=await lockGalleryProduct(q,c,cmd.actor,cmd.productId,true);
 const next=(await q.query(`UPDATE commerce_selections SET aggregate_version=aggregate_version+1 WHERE shop_id=$1 AND item_id=$2 AND aggregate_version=$3 RETURNING aggregate_version::text version`,[p.storefront_shop_id,cmd.productId,cmd.expected])).rows[0];
 requireCondition(next,412,'version_conflict','商品已更新，請重新讀取。');
 await q.query('UPDATE commerce_product_gallery_photos SET position=NULL,last_changed_at_product_version=$2 WHERE group_id=$1 AND position IS NOT NULL',[group.group_id,next.version]);
 const main=promote?desired[0]:undefined,tail=promote?desired.slice(1):desired;
 for(const [n,photo] of tail.entries()){
  let id=photo.photo_key;
  if(id==='main'){
   id=(await q.query(`SELECT photo_id FROM commerce_product_gallery_photos WHERE group_id=$1 AND asset_id=$2 AND representation_id=$3 AND policy_revision=$4 AND position IS NULL ORDER BY created_at,photo_id LIMIT 1`,[group.group_id,photo.ref.asset_id,photo.ref.representation_id,photo.ref.policy_revision])).rows[0]?.photo_id??randomUUID();
   await q.query(`INSERT INTO commerce_product_gallery_photos(photo_id,tenant_id,instance_id,scope_id,group_id,product_id,asset_id,representation_id,policy_revision,last_changed_at_product_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,[id,c.tenant_id,cmd.actor.instance_id,c.scope.scope_id,group.group_id,cmd.productId,photo.ref.asset_id,photo.ref.representation_id,photo.ref.policy_revision,next.version]);
  }
  const changed=await q.query('UPDATE commerce_product_gallery_photos SET position=$2,alt_text=$3,last_changed_at_product_version=$4 WHERE photo_id=$1 AND group_id=$5',[id,n+2,photo.alt_text,next.version,group.group_id]);
  requireCondition(changed.rowCount===1,409,'gallery_order_invalid','照片順序已改變，請重新讀取。');
 }
 await q.query(`UPDATE commerce_product_photo_targets SET asset_id=$4,representation_id=$5,policy_revision=$6,linked_at_product_version=$7 WHERE tenant_id=$1 AND instance_id=$2 AND product_id=$3`,[c.tenant_id,cmd.actor.instance_id,cmd.productId,main?.ref.asset_id??null,main?.ref.representation_id??null,main?.ref.policy_revision??null,main?next.version:null]);
 await q.query(`UPDATE commerce_product_groups SET main_alt_identity_sha256=$2,main_alt_text=$3,last_changed_at_product_version=$4 WHERE group_id=$1`,[group.group_id,main?mainIdentity(main.ref):null,main?.alt_text??'',next.version]);
 await storeFact(q,c,cmd.productId,next.version,'storefront.product.gallery.'+cmd.operation,'storefront_product');return next.version as string;
}
export async function changeGallery(pool:Pool,actor:Actor,t:string,i:string,p:string,key:string,expected:string,operation:'reorder'|'describe'|'remove',photoKey:string|null,raw:unknown,options:GalleryOptions={}){
 let body:unknown=raw;
 if(operation==='remove')body=RemoveGalleryPhotoInputSchema.parse(raw);
 if(operation==='reorder'){const parsed=ReorderGalleryInputSchema.safeParse(raw);requireCondition(parsed.success,422,'gallery_order_invalid','請使用目前照片且不要重複，每項商品最多 8 張照片。');body=parsed.data;}
 else if(operation==='describe'){const parsed=GalleryAltInputSchema.safeParse(raw);requireCondition(parsed.success,422,'gallery_alt_invalid','照片說明請使用有效的單行文字，最多 120 字。');body={alt_text:normalizeGalleryAlt(parsed.data.alt_text)};}
 const cmd=input(actor,t,i,p,key,expected,operation,photoKey,body);
 return (await command(pool,cmd,options,async(q,c)=>{
  const {product,p}=await lockGalleryProduct(q,c,cmd.actor,cmd.productId,true);checkVersion(product.aggregateVersion,cmd.expected);
  const items=await photoProducts(q,p,{retailOnly:true}),gallery=(await draftGalleryData(q,p,items)).byId.get(cmd.productId)!;
  const original=gallery.photos.length?gallery.photos:gallery.retained;
  let desired=original.map(p=>({...p}));
  if(operation==='reorder'){
   const keys=(body as {photo_keys:string[]}).photo_keys;
   requireCondition(keys.length===original.length&&keys.every(k=>original.some(p=>p.photo_key===k)),409,'gallery_order_invalid','照片順序已改變，請重新讀取。');
   desired=keys.map(key=>original.find(p=>p.photo_key===key)!);
  }else{
   requireCondition(photoKey&&original.some(p=>p.photo_key===photoKey),404,'not_found','找不到這張商品照片。');
   if(operation==='remove')desired=desired.filter(p=>p.photo_key!==photoKey);
   else desired=desired.map(p=>p.photo_key===photoKey?{...p,alt_text:(body as {alt_text:string}).alt_text}:p);
  }
  const changed=JSON.stringify(original)!==JSON.stringify(desired)||(operation==='reorder'&&gallery.retained.length>0);
  const version=changed?await saveOrder(q,c,cmd,desired,gallery.photos.length>0||operation==='reorder'):product.aggregateVersion;
  return {productId:cmd.productId,completedVersion:version,changed,operation,photoKey:cmd.photoKey};
 })).ack;
}
export async function uploadGalleryPhoto(pool:Pool,actor:Actor,t:string,i:string,p:string,photoId:string,key:string,expected:string,file:{bytes:Buffer;mime:string},assets:StoreGalleryAssets|undefined,options:GalleryOptions={}){
 const bytes=Buffer.from(snapshotBoundedBytes(file.bytes,2097152)),mime=file.mime,photo=OpaqueId.parse(photoId);
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const cmd=input(actor,t,i,p,key,expected,'upload',photo,{mime,byte_size:bytes.length,sha256});
 const probe=async()=>{const miss=new Error('gallery_receipt_miss');try{return (await command(pool,cmd,options,async()=>{throw miss;})).ack;}catch(e){if(e!==miss)throw e;return undefined;}};
 const replay=await probe();if(replay)return replay;
 requireCondition(assets&&options.uploadsEnabled===true,503,'media_upload_unavailable','商品照片上傳目前無法使用。');
 const phaseKey=digest({operation:'storefront.product.gallery.upload',key});
 try{
  const api=await assets.forGalleryProduct(cmd.productId).forProduct({bytes,mime});
  const prepared=await api.prepare(cmd.actor,{key:phaseKey,targetProductId:cmd.productId,targetGalleryPhotoId:photo,expectedVersion:cmd.expected,contentType:mime as 'image/png'|'image/jpeg'|'image/webp',byteSize:bytes.length,sha256});
  const lease=await api.resumeUpload(cmd.actor,{key:phaseKey,intentId:prepared.intentId}),binding={intentId:lease.intentId,fence:lease.fence,leaseToken:lease.leaseToken};
  if(lease.state==='prepared'||lease.state==='processing')await api.write(cmd.actor,{...binding,key:digest({key:phaseKey,phase:'write',fence:lease.fence})},new ReadableStream({start(c){c.enqueue(bytes);c.close();}}));
  let ack!:GalleryCommandAck;
  await api.finalizeVia<Receipt>(cmd.actor,{...binding,key:digest({key:phaseKey,phase:'finalize'})},{operation:'storefront.product.gallery.upload',
   execute:async run=>{const result=await command(pool,cmd,options,run);ack=result.ack;return result.reference;},
   validateIntent:row=>requireCondition(row.target_gallery_photo_id===photo&&row.target_instance_id===i&&row.target_tenant_id===t&&row.source_sha256===sha256&&row.source_content_type===mime&&row.source_byte_size===bytes.length&&row.expected_version===cmd.expected,409,'asset_source_mismatch','上傳內容與準備紀錄不同。'),
   result:value=>({productId:value.productId,completedVersion:value.completedVersion,changed:true,operation:'upload',photoKey:photo}),
  });return ack;
 }catch(e){const committed=await probe().catch(()=>undefined);if(committed)return committed;if(e instanceof AssetStorageError)throw new Problem(503,'media_upload_unavailable','商品照片上傳目前無法使用。');throw e;}
}
