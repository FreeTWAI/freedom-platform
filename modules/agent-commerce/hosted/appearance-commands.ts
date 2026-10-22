import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {STOREFRONT_APPEARANCE_PROFILE,AppearanceRoleSchema,AppearanceCommandAckSchema,type AppearanceRole,type AppearanceCommandAck} from '../../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {OpaqueId,Version} from '../../../contracts/guild-launchpad/v1/primitives.js';
import {checkVersion,digest} from '../../../packages/db/index.js';
import {assertCurrentSessionClock} from '../../../packages/db/member-session.js';
import {AssetStorageError,snapshotBoundedBytes} from '../../../packages/asset-storage/index.js';
import {isolatedTransaction} from '../../../packages/resource-scopes/tenant-transaction.js';
import type {TenantScopeContext} from '../../../packages/resource-scopes/index.js';
import {scopedTenantCommand} from '../../../packages/scoped-commands/index.js';
import {Problem,requireCondition} from '../../../packages/shared/problem.js';
import type {Actor} from '../../identity-membership/service.js';
import type {StoreAppearanceAssets} from '../../assets/storefront-appearance.js';
import {PRODUCT_PHOTO_INPUT_BYTES} from '../../assets/storefront-product-photo.js';
import {storeCapabilities} from './capabilities.js';
import {lockStorefrontAppearanceBoundary} from './appearance-authority.js';
import {lockCurrentAppearance} from './appearance-target.js';
import {appearanceDraftView,type AppearanceOptions} from './appearance.js';
import type {StorefrontPhotoActor} from './photo-authority.js';
import {profile,retailReady,storeFact} from './store.js';

interface Receipt {instanceId:string;role:AppearanceRole;completedVersion:string;changed:boolean}
interface Command {actor:StorefrontPhotoActor;role:AppearanceRole;key:string;expected:string;operation:string;body:unknown}
async function appearanceCommand(pool:Pool,input:Command,run:(q:PoolClient,c:TenantScopeContext)=>Promise<Receipt>,options:AppearanceOptions){
  let context!:TenantScopeContext,ack!:AppearanceCommandAck;
  const authorize=async(q:PoolClient,c:TenantScopeContext)=>{context=c;await lockStorefrontAppearanceBoundary(q,c,input.actor);};
  const reference=await scopedTenantCommand(pool,{actor:input.actor,tenantId:input.actor.tenant_id,tenantLock:'share',operation:input.operation,
    body:input.body,key:input.key,expected:input.expected,target:{kind:'storefront',id:input.actor.instance_id},capabilitiesForRole:storeCapabilities},
  authorize,run,authorize,undefined,(source,command)=>isolatedTransaction(source,async q=>{
    const receipt=await command(q) as Receipt;
    requireCondition(receipt.instanceId===input.actor.instance_id&&receipt.role===input.role,500,'storefront_appearance_invalid','店面外觀暫時無法讀取。');
    const p=await profile(q,input.actor.tenant_id,input.actor.instance_id);retailReady(p);
    ack=AppearanceCommandAckSchema.parse({profile:STOREFRONT_APPEARANCE_PROFILE,completed_version:receipt.completedVersion,changed:receipt.changed,
      current:await appearanceDraftView(q,p,options)});
    await authorize(q,context);await assertCurrentSessionClock(q,input.actor);return receipt as Awaited<ReturnType<typeof command>>;
  }));
  return {reference,ack};
}
function commandInput(actor:Actor,tenantId:string,instanceId:string,role:AppearanceRole,key:string,expected:string,action:'upload'|'remove',body:unknown):Command{
  const parsedRole=AppearanceRoleSchema.parse(role);
  return {actor:Object.freeze({...actor,tenant_id:OpaqueId.parse(tenantId),instance_id:OpaqueId.parse(instanceId)}),role:parsedRole,key,
    expected:Version.parse(expected),operation:'storefront.'+parsedRole+'.'+action,body};
}
export async function removeAppearanceImage(pool:Pool,actor:Actor,tenantId:string,instanceId:string,role:AppearanceRole,key:string,expected:string,options:AppearanceOptions){
  const input=commandInput(actor,tenantId,instanceId,role,key,expected,'remove',{});
  return (await appearanceCommand(pool,input,async(q,c)=>{
    const target=await lockCurrentAppearance(q,c,input.actor,instanceId,role,false);checkVersion(target.aggregateVersion,input.expected);
    if(!target.assetId)return {instanceId,role,completedVersion:target.aggregateVersion,changed:false};
    const next=(await q.query(`UPDATE commerce_storefront_profiles SET version=version+1,updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND instance_id=$2 AND version=$3 RETURNING version::text`,[tenantId,instanceId,input.expected])).rows[0];
    requireCondition(next,412,'version_conflict','商店資料已更新，請重新讀取後確認外觀變更。');
    await q.query(`UPDATE commerce_storefront_appearance_targets SET asset_id=NULL,representation_id=NULL,policy_revision=NULL,last_changed_at_profile_version=$4
      WHERE tenant_id=$1 AND instance_id=$2 AND kind=$3`,[tenantId,instanceId,'storefront.'+role,next.version]);
    await storeFact(q,c,instanceId,next.version,input.operation);return {instanceId,role,completedVersion:next.version,changed:true};
  },options)).ack;
}
export async function uploadAppearanceImage(pool:Pool,actor:Actor,tenantId:string,instanceId:string,role:AppearanceRole,key:string,expected:string,
  file:{bytes:Buffer;mime:string},assets:StoreAppearanceAssets|undefined,newUploadsAllowed:boolean,options:AppearanceOptions){
  const bytes=Buffer.from(snapshotBoundedBytes(file.bytes,PRODUCT_PHOTO_INPUT_BYTES)),mime=file.mime;
  requireCondition(['image/png','image/jpeg','image/webp'].includes(mime),415,'appearance_image_format','請選擇 JPEG、PNG 或 WebP 圖片。');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const input=commandInput(actor,tenantId,instanceId,role,key,expected,'upload',{role,mime,byte_size:bytes.length,sha256});
  const probe=async()=>{const miss=new Error('appearance_receipt_miss');try{return (await appearanceCommand(pool,input,async()=>{throw miss;},options)).ack;}
    catch(error){if(error!==miss)throw error;return undefined;}};
  const replay=await probe();if(replay)return replay;
  requireCondition(assets&&newUploadsAllowed,503,'appearance_upload_unavailable','店面圖片上傳目前無法使用。');
  const phaseKey=digest({operation:input.operation,key});
  try{
    const api=await assets.forRole(role,{mime,bytes});
    const prepared=await api.prepare(input.actor,{key:phaseKey,targetInstanceId:instanceId,expectedVersion:input.expected,
      contentType:mime as 'image/png'|'image/jpeg'|'image/webp',byteSize:bytes.length,sha256});
    const lease=await api.resumeUpload(input.actor,{key:phaseKey,intentId:prepared.intentId}),binding={intentId:lease.intentId,fence:lease.fence,leaseToken:lease.leaseToken};
    if(lease.state==='prepared'||lease.state==='processing')await api.write(input.actor,{...binding,key:digest({key:phaseKey,phase:'write',fence:lease.fence})},new ReadableStream({start(c){c.enqueue(bytes);c.close();}}));
    let ack!:AppearanceCommandAck;
    await api.finalizeVia<Receipt>(input.actor,{...binding,key:digest({key:phaseKey,phase:'finalize'})},{operation:input.operation,
      execute:async run=>{const result=await appearanceCommand(pool,input,run,options);ack=result.ack;return result.reference;},
      validateIntent:r=>requireCondition(r.target_appearance_id===instanceId&&r.target_instance_id===instanceId&&r.target_tenant_id===tenantId
        &&r.target_kind==='storefront.'+role&&r.source_sha256===sha256&&r.source_content_type===mime&&r.source_byte_size===bytes.length&&r.expected_version===input.expected,
      409,'asset_source_mismatch','上傳內容與準備紀錄不同。'),
      result:value=>({instanceId:value.instanceId,role:value.role,completedVersion:value.completedVersion,changed:true}),
    });return ack;
  }catch(error){
    const committed=await probe().catch(()=>undefined);if(committed)return committed;
    if(error instanceof AssetStorageError)throw new Problem(503,'appearance_upload_unavailable','店面圖片上傳目前無法使用。');throw error;
  }
}
