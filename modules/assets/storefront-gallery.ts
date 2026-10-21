import {z} from 'zod';
import type {Pool} from 'pg';
import {OpaqueId} from '../../contracts/common/v1/identity.js';
import {createProductPhotoLifecycleFactory,PRODUCT_PHOTO_INPUT_BYTES} from './storefront-product-photo.js';
import {assetCommandKey,assetVersion,type LifecycleDependencies} from './engine.js';
import {lockGalleryPhoto,publishGalleryPhoto} from '../agent-commerce/storefront/gallery/target.js';
const input=z.object({key:assetCommandKey,targetProductId:OpaqueId,targetGalleryPhotoId:OpaqueId,expectedVersion:assetVersion,
 contentType:z.enum(['image/png','image/jpeg','image/webp']),byteSize:z.number().int().min(1).max(PRODUCT_PHOTO_INPUT_BYTES),sha256:z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/)}).strict();
/** Closed target, established purpose and decoder. Captured product binding is
 * checked in every phase; no request-supplied normalizer or policy resolver. */
export function createStorefrontGalleryLifecycle(pool:Pool,dependencies:LifecycleDependencies){
 return Object.freeze({forGalleryProduct(productId:string){
  const product=OpaqueId.parse(productId);
  return createProductPhotoLifecycleFactory(pool,dependencies,{
   targetKind:'storefront.gallery-photo',parsePrepare(raw:z.infer<typeof input>){const v=input.parse(raw);if(v.targetProductId!==product)throw Error('gallery_product_binding');return v;},
   targetId:value=>value.targetGalleryPhotoId,
   lockTarget:(q,c,a,id,create)=>lockGalleryPhoto(q,c,a,id,product,create),publish:publishGalleryPhoto,
  });
 }});
}
export type StoreGalleryAssets=ReturnType<typeof createStorefrontGalleryLifecycle>;
