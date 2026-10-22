import type {PoolClient} from 'pg';
import {OpaqueId} from '../../../contracts/common/v1/identity.js';
import {AppearanceRoleSchema,type AppearanceRole} from '../../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {checkVersion} from '../../../packages/db/index.js';
import type {TenantScopeContext} from '../../../packages/resource-scopes/index.js';
import {requireCondition} from '../../../packages/shared/problem.js';
import type {LifecycleIntent,LifecyclePublication,LifecycleTarget} from '../../assets/engine.js';
import type {StorefrontPhotoActor} from './photo-authority.js';
import {profile,retailReady} from './store.js';

export interface AppearanceCompletion {instanceId:string;role:AppearanceRole;completedVersion:string;intentId:string}
/** The named boundary/profile and canonical policy locks are already held. */
export async function lockCurrentAppearance(q:PoolClient,context:TenantScopeContext,actor:StorefrontPhotoActor,rawId:string,rawRole:AppearanceRole,create:boolean):Promise<LifecycleTarget>{
  const id=OpaqueId.parse(rawId),role=AppearanceRoleSchema.parse(rawRole);
  requireCondition(id===actor.instance_id&&context.tenant_id===actor.tenant_id,404,'not_found','找不到這間商店。');
  const p=await profile(q,context.tenant_id,id);retailReady(p);
  if(create)await q.query(`INSERT INTO commerce_storefront_appearance_targets(tenant_id,instance_id,kind,scope_id,last_changed_at_profile_version)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[context.tenant_id,id,'storefront.'+role,context.scope.scope_id,p.version]);
  const pointer=(await q.query(`SELECT asset_id FROM commerce_storefront_appearance_targets
    WHERE tenant_id=$1 AND instance_id=$2 AND kind=$3 AND scope_id=$4 FOR UPDATE`,[context.tenant_id,id,'storefront.'+role,context.scope.scope_id])).rows[0];
  return {targetId:id,aggregateVersion:p.version,assetId:pointer?.asset_id??null};
}
export async function publishAppearancePointer(q:PoolClient,context:TenantScopeContext,actor:StorefrontPhotoActor,intent:LifecycleIntent,target:LifecycleTarget,role:AppearanceRole):Promise<LifecyclePublication<AppearanceCompletion>>{
  requireCondition(intent.target_appearance_id===actor.instance_id&&target.targetId===actor.instance_id
    &&intent.target_instance_id===actor.instance_id&&intent.target_tenant_id===context.tenant_id&&intent.scope_id===context.scope.scope_id
    &&intent.target_kind==='storefront.'+role&&intent.purpose==='storefront.product-photo'&&intent.state==='stored',409,'asset_source_mismatch','上傳內容與準備紀錄不同。');
  checkVersion(target.aggregateVersion,intent.expected_version);
  const next=(await q.query(`UPDATE commerce_storefront_profiles SET version=version+1,updated_at=clock_timestamp()
    WHERE tenant_id=$1 AND instance_id=$2 AND version=$3 RETURNING version::text`,[context.tenant_id,actor.instance_id,intent.expected_version])).rows[0];
  requireCondition(next,412,'version_conflict','商店資料已更新，請重新讀取後確認外觀變更。');
  const linked=await q.query(`UPDATE commerce_storefront_appearance_targets SET asset_id=$5,representation_id=$6,policy_revision=$7,last_changed_at_profile_version=$8
    WHERE tenant_id=$1 AND instance_id=$2 AND kind=$3 AND scope_id=$4`,[context.tenant_id,actor.instance_id,'storefront.'+role,context.scope.scope_id,intent.asset_id,intent.representation_id,intent.policy_revision,next.version]);
  requireCondition(linked.rowCount===1,404,'not_found','找不到這張店面圖片。');
  return {aggregateVersion:next.version,result:{instanceId:actor.instance_id,role,completedVersion:next.version,intentId:intent.intent_id},
    fact:{aggregateType:'storefront',id:actor.instance_id,data:{resource_id:actor.instance_id,version:next.version}}};
}
