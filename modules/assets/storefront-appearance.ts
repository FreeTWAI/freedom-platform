import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Pool} from 'pg';
import {OpaqueId} from '../../contracts/common/v1/identity.js';
import {AppearanceRoleSchema,type AppearanceRole} from '../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {snapshotBoundedBytes,readBounded,prepareLegacyMediaRepresentation} from '../../packages/asset-storage/index.js';
import {inspectCanonicalWebp} from '../../packages/shared/image-webp.js';
import {Problem,requireCondition} from '../../packages/shared/problem.js';
import type {TenantScopeContext} from '../../packages/resource-scopes/index.js';
import {lockDimension,retainedByteUsage} from '../opportunity-project-work/tenant-capacity.js';
import {lockStorefrontAppearanceBoundary} from '../agent-commerce/hosted/appearance-authority.js';
import {lockCurrentAppearance,publishAppearancePointer,type AppearanceCompletion} from '../agent-commerce/hosted/appearance-target.js';
import type {StorefrontPhotoActor} from '../agent-commerce/hosted/photo-authority.js';
import {assetCommandKey,assetVersion,createAssetLifecycleWithAuthority,type LifecycleDependencies} from './engine.js';
import {createStorefrontAppearanceLifecycleAuthority} from './storefront-appearance-authority.js';
import {normalizeProductPhoto,lockProductPhotoPolicy,PRODUCT_PHOTO_INPUT_BYTES,PRODUCT_PHOTO_OUTPUT_BYTES} from './storefront-product-photo.js';

const input=z.object({key:assetCommandKey,targetInstanceId:OpaqueId,expectedVersion:assetVersion,
  contentType:z.enum(['image/png','image/jpeg','image/webp']),byteSize:z.number().int().min(1).max(PRODUCT_PHOTO_INPUT_BYTES),
  sha256:z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/)}).strict();
export type AppearancePrepare=z.infer<typeof input>;
interface Source {readonly mime:string;readonly byteSize:number;readonly sha256:string;readonly webp:Buffer}
function lifecycle(pool:Pool,dependencies:LifecycleDependencies,role:AppearanceRole,source:Source){
  return createAssetLifecycleWithAuthority<AppearancePrepare,AppearanceCompletion,StorefrontPhotoActor,TenantScopeContext>(pool,dependencies,{
    purpose:'storefront.product-photo',targetKind:role==='cover'?'storefront.cover':'storefront.logo',variant:'image',
    inputMaxBytes:PRODUCT_PHOTO_INPUT_BYTES,outputMaxBytes:PRODUCT_PHOTO_OUTPUT_BYTES,retireReplacedAsset:false,
    parsePrepare(raw){const value=input.parse(raw);requireCondition(value.contentType===source.mime&&value.byteSize===source.byteSize&&value.sha256===source.sha256,409,'asset_source_mismatch','上傳內容與準備紀錄不同。');return value;},
    targetId:value=>value.targetInstanceId,
    async lockTarget(q,c,actor,id,create){await lockStorefrontAppearanceBoundary(q,c,actor);await lockProductPhotoPolicy(q,c.tenant_id);return lockCurrentAppearance(q,c,actor,id,role,create);},
    resolvePolicy:async(q,c)=>(await lockProductPhotoPolicy(q,c.tenant_id)).policy,
    async requireCapacity(q,c,_actor,_target,policy,reserve){
      const {tenant}=await lockProductPhotoPolicy(q,c.tenant_id);await lockDimension(q,c.tenant_id,'retained_bytes');
      const shared=await retainedByteUsage(q,c.scope.scope_id,c.tenant_id);
      requireCondition(shared+BigInt(reserve)<=BigInt(tenant.max_retained_bytes),429,'quota_exceeded','已達到這個業務空間的容量上限。');
      // The established purpose counts every product, cover, logo, pending,
      // replaced and removed object, including intents written by old binaries.
      const used=(await q.query(`SELECT COALESCE(sum(COALESCE(o.byte_size,i.reserved_bytes,1048576)::bigint),0)::text AS used
        FROM assets a LEFT JOIN asset_objects o USING(asset_id) LEFT JOIN asset_upload_intents i USING(asset_id)
        WHERE a.scope_id=$1 AND a.tenant_ref=$2 AND a.purpose='storefront.product-photo'`,[c.scope.scope_id,c.tenant_id])).rows[0];
      requireCondition(BigInt(used.used)+BigInt(reserve)<=BigInt(policy.retainedByteLimit),409,'asset_retained_quota','照片儲存容量已達上限。');
    },
    async prepareRepresentation(body,mime,policy){const bytes=await readBounded(body,PRODUCT_PHOTO_INPUT_BYTES);
      requireCondition(mime===source.mime&&bytes.length===source.byteSize&&createHash('sha256').update(bytes).digest('hex')===source.sha256,409,'asset_source_mismatch','上傳內容與準備紀錄不同。');
      return prepareLegacyMediaRepresentation(new ReadableStream({start(c){c.enqueue(Buffer.from(source.webp));c.close();}}),'image/webp','storefront.product-photo',policy);
    },
    async lockPublication(){return undefined;},
    publish:(q,c,actor,intent,target)=>publishAppearancePointer(q,c,actor,intent,target,role),
  },createStorefrontAppearanceLifecycleAuthority());
}
/** Identical device/server raster limits and canonical product WebP profile.
 * Only new/unfinished commands reach the decoder; facade receipts are first. */
export function createStorefrontAppearanceLifecycle(pool:Pool,dependencies:LifecycleDependencies){
  requireCondition(dependencies?.store,503,'appearance_upload_unavailable','店面圖片上傳目前無法使用。');
  return Object.freeze({async forRole(rawRole:AppearanceRole,file:{mime:string;bytes:Buffer}){
    const role=AppearanceRoleSchema.parse(rawRole),bytes=Buffer.from(snapshotBoundedBytes(file.bytes,PRODUCT_PHOTO_INPUT_BYTES)),mime=file.mime;
    let webp:Buffer;
    try{webp=Buffer.from(await normalizeProductPhoto(mime,bytes));}
    catch(error){
      if(error instanceof Problem&&error.status===422)throw new Problem(422,'invalid_appearance_image','圖片無法使用，請選擇完整的靜態 JPEG、PNG 或 WebP 圖片。');
      throw error;
    }
    const shape=inspectCanonicalWebp(webp);requireCondition(role!=='logo'||shape.width===shape.height,422,'appearance_logo_not_square','店標請使用正方形圖片。');
    return lifecycle(pool,dependencies,role,Object.freeze({mime,byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),webp}));
  }});
}
export type StoreAppearanceAssets=ReturnType<typeof createStorefrontAppearanceLifecycle>;
