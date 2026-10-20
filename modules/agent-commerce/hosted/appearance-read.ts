import type {Pool} from 'pg';
import {AppearanceRoleSchema,type AppearanceRole} from '../../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {Version} from '../../../contracts/guild-launchpad/v1/primitives.js';
import {objectKey,readVerifiedObject,type ObjectStore,type ObjectMetadata} from '../../../packages/asset-storage/index.js';
import {isolatedTransaction} from '../../../packages/resource-scopes/tenant-transaction.js';
import {requireCondition} from '../../../packages/shared/problem.js';
import type {Actor} from '../../identity-membership/service.js';
import {profile,retailReady,storeRead} from './store.js';
import {lockAppearanceRead,draftAppearanceSnapshot,publicationAppearance,type AppearanceRef} from './appearance.js';
import {resolvePublicStorePage} from './public.js';

async function imageBytes(store:ObjectStore,ref:AppearanceRef){
  const metadata:ObjectMetadata={contentType:ref.content_type,byteSize:ref.byte_size,sha256:ref.sha256,
    transformVersion:ref.transform_version,policyRevision:ref.policy_revision,profileId:'storefront.product-photo'};
  return (await readVerifiedObject(store,objectKey({scopeId:ref.scope_id,assetId:ref.asset_id,representationId:ref.representation_id}),metadata)).bytes;
}
export async function readPrivateAppearanceImage(pool:Pool,store:ObjectStore,actor:Actor,tenantId:string,instanceId:string,rawRole:AppearanceRole,rawVersion:string){
  const role=AppearanceRoleSchema.parse(rawRole),version=Version.parse(rawVersion);
  const snapshot=()=>storeRead(pool,actor,tenantId,instanceId,'store:read',async q=>{
    await lockAppearanceRead(q,tenantId,instanceId);const p=await profile(q,tenantId,instanceId);retailReady(p);
    requireCondition(p.version===version,404,'not_found','找不到這張店面圖片。');
    const draft=await draftAppearanceSnapshot(q,p),ref=draft.document[role];
    requireCondition(ref,404,'not_found','找不到這張店面圖片。');
    return {ref,identity:JSON.stringify({tenantId,instanceId,version,role,digest:draft.sha256,ref})};
  });
  const before=await snapshot(),bytes=await imageBytes(store,before.ref),after=await snapshot();
  requireCondition(before.identity===after.identity,404,'not_found','找不到這張店面圖片。');return bytes;
}
export async function readPublicAppearanceImage(pool:Pool,store:ObjectStore,slug:string,rawRevision:string,rawRole:AppearanceRole){
  const revision=Version.parse(rawRevision),role=AppearanceRoleSchema.parse(rawRole);
  const snapshot=()=>isolatedTransaction(pool,async q=>{
    await q.query('SET TRANSACTION READ ONLY');const page=await resolvePublicStorePage(q,slug);
    if(!page||page.projection.revision!==revision)return null;
    const frozen=await publicationAppearance(q,page.publicationId,page.tenantId,page.instanceId),ref=frozen.document[role];if(!ref)return null;
    return {ref,identity:JSON.stringify({publicationId:page.publicationId,tenantId:page.tenantId,instanceId:page.instanceId,
      scopeId:page.scopeId,revision,role,digest:frozen.sha256,ref})};
  });
  const before=await snapshot();if(!before)return null;
  // Both GET and HEAD verify the complete representation between short SQL
  // snapshots; no transaction/lock is held during ObjectStore I/O.
  const bytes=await imageBytes(store,before.ref),after=await snapshot();return before.identity===after?.identity?bytes:null;
}
