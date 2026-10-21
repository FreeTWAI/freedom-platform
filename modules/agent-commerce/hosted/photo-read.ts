import type { Pool } from 'pg';
import { HOSTED_STORE_MEDIA_PROFILE, ProductMediaPageSchema } from '../../../contracts/guild-launchpad/v1/hosted-store-media.js';
import { OpaqueId, Version } from '../../../contracts/guild-launchpad/v1/primitives.js';
import { objectKey, readVerifiedObject, type ObjectStore, type ObjectMetadata } from '../../../packages/asset-storage/index.js';
import { requireCondition } from '../../../packages/shared/problem.js';
import type { Actor } from '../../identity-membership/service.js';
import { profile, ready, storeRead } from './store.js';
import { photoProducts, privatePhotoView, storedPhoto, type StoredProductPhoto } from './photo-projection.js';
import {currentOfferPhoto} from '../supplier-console/offer-photos.js';
import { readPublicStorePage } from './public.js';

export async function listProductMedia(pool: Pool, actor: Actor, tenantId: string, instanceId: string, scope: { retailOnly: boolean } = { retailOnly: true }) {
  return storeRead(pool,actor,tenantId,instanceId,'store:read',async q => {
    const p=await profile(q,tenantId,instanceId);ready(p);
    return ProductMediaPageSchema.parse({ profile:HOSTED_STORE_MEDIA_PROFILE,items:(await photoProducts(q,p,scope)).map(item=>privatePhotoView(p,item)) });
  });
}
function objectMetadata(photo:StoredProductPhoto): ObjectMetadata {
  // The fixed profile is installed by the closed product-photo lifecycle module.
  return { contentType:photo.ref.content_type,byteSize:photo.ref.byte_size,sha256:photo.ref.sha256,
    transformVersion:photo.ref.transform_version,policyRevision:photo.policyRevision,profileId:'storefront.product-photo' };
}
function photoIdentity(photo:StoredProductPhoto) {
  return JSON.stringify({scopeId:photo.scopeId,policyRevision:photo.policyRevision,ref:photo.ref});
}
async function photoBytes(store:ObjectStore,photo:StoredProductPhoto) {
  return (await readVerifiedObject(store,objectKey({scopeId:photo.scopeId,assetId:photo.ref.asset_id,representationId:photo.ref.representation_id}),objectMetadata(photo))).bytes;
}
export async function readPrivateProductPhoto(pool:Pool,store:ObjectStore,actor:Actor,tenantId:string,instanceId:string,rawProductId:string,rawVersion:string,scope:{retailOnly:boolean}={retailOnly:true},offerShare?:{offer_id:string;seq:string}) {
  const productId=OpaqueId.parse(rawProductId), version=Version.parse(rawVersion);
  const snapshot=()=>storeRead(pool,actor,tenantId,instanceId,'store:read',async q=>{
    const p=await profile(q,tenantId,instanceId);ready(p);
    const item=(await photoProducts(q,p,scope)).find(row=>row.product.product_id===productId);
    requireCondition(item && item.product.version===version,404,'not_found','找不到這張商品照片。');
    if(offerShare) {
      // The owner preview may show the retained shared photo after replacing or
      // removing the current product photo. It never resolves a foreign tenant.
      const offer=(await q.query(`SELECT 1 FROM commerce_hosted_supply_offers WHERE offer_id=$1 AND tenant_id=$2 AND instance_id=$3 AND item_id=$4 AND state='offered'`,[offerShare.offer_id,tenantId,instanceId,productId])).rows[0];
      const photo=offer?await currentOfferPhoto(q,offerShare.offer_id):null;
      requireCondition(photo?.asset_id&&photo.seq===offerShare.seq,404,'not_found','找不到這張商品照片。');
      return {photo:storedPhoto({...photo,sku:item.product.sku}),seq:photo.seq};
    }
    requireCondition(item.photo,404,'not_found','找不到這張商品照片。');
    return {photo:item.photo,seq:null};
  });
  const before=await snapshot();
  // Object I/O never holds a SQL transaction or domain lock.
  const bytes=await photoBytes(store,before.photo);
  const after=await snapshot();
  requireCondition(before.seq===after.seq&&photoIdentity(before.photo)===photoIdentity(after.photo),404,'not_found','找不到這張商品照片。');
  return bytes;
}
export async function readPublicProductPhoto(pool:Pool,store:ObjectStore,slug:string,rawRevision:string,sku:string) {
  const revision=Version.parse(rawRevision);
  const snapshot=async()=>{
    const page=await readPublicStorePage(pool,slug);
    const photo=page?.photos.find(item=>item.ref.sku===sku);
    if (!page || page.projection.revision!==revision || !photo) return null;
    return {photo,identity:JSON.stringify({publicationId:page.publicationId,tenantId:page.tenantId,instanceId:page.instanceId,
      scopeId:page.scopeId,mediaSha256:page.mediaSha256,photo:photoIdentity(photo)})};
  };
  const before=await snapshot();
  if(!before) return null;
  const bytes=await photoBytes(store,before.photo);
  const after=await snapshot();
  return after?.identity===before.identity ? bytes : null;
}
