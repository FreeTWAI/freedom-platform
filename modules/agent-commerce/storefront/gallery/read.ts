import {lockAppearanceRead} from '../../hosted/appearance.js';
import type {Pool} from 'pg';
import {OpaqueId,Version} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {STOREFRONT_GALLERY_PROFILE,GalleryPhotoKeySchema,ProductGalleriesSchema} from '../../../../contracts/guild-launchpad/v1/storefront-gallery.js';
import {objectKey,readVerifiedObject,type ObjectStore} from '../../../../packages/asset-storage/index.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import type {Actor} from '../../../identity-membership/service.js';
import {profile,ready,storeRead} from '../../hosted/store.js';
import {photoProducts} from '../../hosted/photo-projection.js';
import {draftGalleryData,privateGalleryView,type GalleryOptions} from './model.js';
/** The shared profile read lock makes version, virtual primary and tail coherent.
 * Each byte snapshot releases it before ObjectStore I/O. */
export async function listProductGalleries(pool:Pool,actor:Actor,t:string,i:string,options:GalleryOptions={}){
 return storeRead(pool,actor,t,i,'store:read',async q=>{await lockAppearanceRead(q,t,i);const p=await profile(q,t,i);ready(p);const items=await photoProducts(q,p,{retailOnly:true}),data=await draftGalleryData(q,p,items);
  return ProductGalleriesSchema.parse({profile:STOREFRONT_GALLERY_PROFILE,items:items.map(item=>privateGalleryView(p,item,data.byId.get(item.product.product_id)!,options))});});
}
export async function readPrivateGalleryPhoto(pool:Pool,store:ObjectStore,actor:Actor,t:string,i:string,rawProduct:string,rawKey:string,rawVersion:string){
 const product=OpaqueId.parse(rawProduct),key=GalleryPhotoKeySchema.parse(rawKey),version=Version.parse(rawVersion);
 const snapshot=()=>storeRead(pool,actor,t,i,'store:read',async q=>{await lockAppearanceRead(q,t,i);const p=await profile(q,t,i);ready(p);const items=await photoProducts(q,p,{retailOnly:true}),item=items.find(p=>p.product.product_id===product);
  requireCondition(item?.product.version===version,404,'not_found','找不到這張商品照片。');const gallery=(await draftGalleryData(q,p,items)).byId.get(product)!;
  const photo=[...gallery.photos,...gallery.retained].find(p=>p.photo_key===key);requireCondition(photo,404,'not_found','找不到這張商品照片。');return photo.ref;});
 const before=await snapshot();
 const bytes=(await readVerifiedObject(store,objectKey({scopeId:before.scope_id,assetId:before.asset_id,representationId:before.representation_id}),{contentType:before.content_type,byteSize:before.byte_size,sha256:before.sha256,transformVersion:before.transform_version,policyRevision:before.policy_revision,profileId:'storefront.product-photo'})).bytes;
 requireCondition(JSON.stringify(before)===JSON.stringify(await snapshot()),404,'not_found','找不到這張商品照片。');return bytes;
}

export async function readPublicGalleryPhoto(pool:Pool,store:ObjectStore,slug:string,rawRevision:string,sku:string,rawPosition:string){
 // Every invalid, foreign, non-current and draft path has the same anonymous miss.
 // Exactly one ordinal character, 1-8; longer and encoded suffixes share the anonymous miss.
 if(!Version.safeParse(rawRevision).success||!/^P[0-9]{4,23}$/.test(sku)||rawPosition.length!==1||rawPosition<'1'||rawPosition>'8')return null;
 const {readPublicStorePage}=await import('../../hosted/public.js');
 const snapshot=async()=>{
  const page=await readPublicStorePage(pool,slug,{},{},{enabled:true});
  const ref=page?.gallery?.document.products.find(p=>p.sku===sku)?.photos[Number(rawPosition)-1]?.ref;
  return page&&page.projection.revision===rawRevision&&ref?{ref,identity:JSON.stringify({publicationId:page.publicationId,tenantId:page.tenantId,instanceId:page.instanceId,scopeId:page.scopeId,sha256:page.gallery!.sha256,ref})}:null;
 };
 const before=await snapshot();if(!before)return null;const r=before.ref;
 const bytes=(await readVerifiedObject(store,objectKey({scopeId:r.scope_id,assetId:r.asset_id,representationId:r.representation_id}),{contentType:r.content_type,byteSize:r.byte_size,sha256:r.sha256,transformVersion:r.transform_version,policyRevision:r.policy_revision,profileId:'storefront.product-photo'})).bytes;
 return (await snapshot())?.identity===before.identity?bytes:null;
}
