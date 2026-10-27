import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from '../identity-membership/service.js';
import {OpaqueId} from '../../contracts/common/v1/identity.js';
import {digest,checkVersion,type Command} from '../../packages/db/index.js';
import {readWithMemberSession} from '../../packages/db/member-session.js';
import {scopedMemberCommand,scopedJournal} from '../../packages/scoped-commands/index.js';
import {Problem,requireCondition} from '../../packages/shared/problem.js';
import {normalizeImage} from '../../packages/shared/image-runtime.js';
import {rasterFormat,rejectAnimation} from '../skill-submissions/payload.js';
import {profileReadySql} from '../../packages/shared/profile-authority.js';
import {readBounded,snapshotBoundedBytes,sha256,prepareLegacyMediaRepresentation,type ObjectStore} from '../../packages/asset-storage/index.js';
import {assetCommandKey,assetVersion,createAssetLifecycle,type LifecyclePolicy} from './engine.js';
export const PROFILE_COVER_INPUT_BYTES=4194304,PROFILE_COVER_OUTPUT_BYTES=524288;
const input=z.object({key:assetCommandKey,targetUserId:OpaqueId,expectedVersion:assetVersion,contentType:z.enum(['image/png','image/jpeg','image/webp']),byteSize:z.number().int().min(1).max(PROFILE_COVER_INPUT_BYTES),sha256:z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/)}).strict();
const stream=(bytes:Uint8Array)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}});
export async function normalizeProfileCover(mime:string,raw:Uint8Array){
 const bytes=Buffer.from(snapshotBoundedBytes(raw,PROFILE_COVER_INPUT_BYTES));
 requireCondition(bytes.length>0,422,'invalid_profile_cover','請選擇完整的靜態圖片。');
 const format=rasterFormat(bytes);requireCondition(format&&mime===`image/${format}`,415,'profile_cover_format','請選擇靜態 JPEG、PNG 或 WebP 圖片。');
 try{rejectAnimation(bytes,format!);const output=await normalizeImage(bytes,{purpose:'profile_cover',format:format!,maxDimension:4096,maxPixels:16777216,maxOutputBytes:PROFILE_COVER_OUTPUT_BYTES,output:{width:1600,height:600,fit:'cover',quality:82,effort:4}});
 requireCondition(output.length>0&&output.length<=PROFILE_COVER_OUTPUT_BYTES,422,'invalid_profile_cover','這張封面壓縮後仍過大。');return output;
 }catch(error){if(error instanceof Problem)throw error;throw new Problem(422,'invalid_profile_cover','請選擇完整的靜態 JPEG、PNG 或 WebP 圖片。');}
}
async function ready(q:Pick<Pool,'query'>,actor:Actor){requireCondition((await q.query(`SELECT 1 FROM users u WHERE u.user_id=$1 AND u.community_id=$2 AND ${profileReadySql('u')}`,[actor.user_id,actor.community_id])).rowCount===1,403,'profile_unavailable','完成加入流程後才能設定封面。');}
export async function profileCoverPolicy(q:PoolClient):Promise<LifecyclePolicy>{
 const row=(await q.query("SELECT mode,persistence_allowed,policy_revision,retained_byte_limit FROM domain_media_storage_policy WHERE purpose='member.profile-cover' FOR SHARE")).rows[0];
 requireCondition(row&&row.mode!=='legacy'&&row.persistence_allowed===true&&row.policy_revision&&row.retained_byte_limit,503,'profile_cover_upload_unavailable','封面上傳尚未開放。');
 return {platformPersistenceAllowed:true,revision:row.policy_revision,retainedByteLimit:String(row.retained_byte_limit)};
}
/** Publication save and removal take this target lock before publication rows.
 * Immutable versions keep the previously selected image during draft uploads. */
export async function lockProfileCoverSelection(q:PoolClient,actor:Actor,rawVersion:string){
 const version=assetVersion.parse(rawVersion);await ready(q,actor);
 await q.query('SELECT user_id FROM member_profile_cover_targets WHERE user_id=$1 FOR UPDATE',[actor.user_id]);
 const row=(await q.query(`SELECT v.version FROM member_profile_cover_versions v JOIN assets a ON a.asset_id=v.asset_id
 JOIN resource_scopes cs ON cs.scope_id=a.scope_id AND cs.kind='personal' AND cs.status='active' AND cs.owner_principal_id=a.owner_principal_id
 JOIN principals cp ON cp.principal_id=a.owner_principal_id AND cp.user_ref=v.user_id AND cp.status='active'
  WHERE v.user_id=$1 AND v.version=$2 AND v.retired_at IS NULL AND a.state='ready' AND a.deletion_fence=0 FOR SHARE OF v,a`,[actor.user_id,version])).rows[0];
 requireCondition(row,409,'profile_cover_unavailable','封面已變更，請重新選擇。');
}
export async function profileCoverMetadata(q:Pick<Pool,'query'>,actor:Actor,storeAvailable:boolean){
 await ready(q,actor);
 const row=(await q.query(`SELECT t.aggregate_version,EXISTS(SELECT 1 FROM member_profile_cover_versions v JOIN assets a USING(asset_id)
  WHERE v.user_id=t.user_id AND v.version=t.aggregate_version AND v.retired_at IS NULL AND a.state='ready' AND a.deletion_fence=0) present
  FROM member_profile_cover_targets t WHERE t.user_id=$1`,[actor.user_id])).rows[0];
 const policy=(await q.query("SELECT mode,persistence_allowed,policy_revision,retained_byte_limit FROM domain_media_storage_policy WHERE purpose='member.profile-cover'")).rows[0];
 const available=Boolean(storeAvailable&&policy&&policy.mode!=='legacy'&&policy.persistence_allowed===true&&policy.policy_revision&&assetVersion.safeParse(String(policy.retained_byte_limit)).success&&BigInt(policy.retained_byte_limit)>=BigInt(PROFILE_COVER_OUTPUT_BYTES));
 const drafts=(await q.query(`SELECT v.version::text AS version FROM member_profile_cover_versions v WHERE v.user_id=$1 AND v.retired_at IS NULL AND NOT EXISTS(SELECT 1 FROM member_profile_publications p WHERE p.user_id=v.user_id AND p.include_cover AND p.cover_version=v.version) ORDER BY v.version DESC LIMIT 4`,[actor.user_id])).rows;
 return {version:String(row?.aggregate_version??'1'),present:Boolean(row?.present),upload_available:available,reason:available?null:'profile_cover_upload_unavailable',draft_versions:drafts.map(v=>v.version as string)};
}
export function createProfileCoverAssets(pool:Pool,store:ObjectStore){
 return createAssetLifecycle<z.infer<typeof input>,{version:string;present:true}>(pool,{store},{
  purpose:'member.profile-cover',targetKind:'member.profile-cover',variant:'cover',inputMaxBytes:PROFILE_COVER_INPUT_BYTES,outputMaxBytes:PROFILE_COVER_OUTPUT_BYTES,retireReplacedAsset:false,
  parsePrepare:raw=>input.parse(raw),targetId:value=>value.targetUserId,
  async lockTarget(q,c,actor,id,create){await ready(q,actor);requireCondition(id===actor.user_id&&c.scope.kind==='personal',404,'asset_target_not_found','找不到這個目標。');
   if(create)await q.query('INSERT INTO member_profile_cover_targets(user_id,community_id,scope_id,owner_principal_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,actor.community_id,c.scope.scope_id,c.subject_principal.principal_id]);
   const row=(await q.query('SELECT aggregate_version FROM member_profile_cover_targets WHERE user_id=$1 AND community_id=$2 AND scope_id=$3 AND owner_principal_id=$4 FOR UPDATE',[id,actor.community_id,c.scope.scope_id,c.subject_principal.principal_id])).rows[0];
   requireCondition(row,404,'asset_target_not_found','找不到這個目標。');return {targetId:id,aggregateVersion:String(row.aggregate_version),assetId:null};},
  resolvePolicy:profileCoverPolicy,
  async requireCapacity(q,c,actor,_target,policy,reserve){
   const used=(await q.query(`SELECT COALESCE(sum(COALESCE(o.byte_size,i.reserved_bytes,524288)::bigint),0)::text used FROM assets a LEFT JOIN asset_objects o USING(asset_id) LEFT JOIN asset_upload_intents i USING(asset_id) WHERE a.scope_id=$1 AND a.purpose='member.profile-cover'`,[c.scope.scope_id])).rows[0];
   requireCondition(BigInt(used.used)+BigInt(reserve)<=BigInt(policy.retainedByteLimit),409,'asset_retained_quota','封面儲存容量已達上限。');
   const drafts=(await q.query(`SELECT count(*)::int n FROM member_profile_cover_versions v WHERE v.user_id=$1 AND v.retired_at IS NULL AND NOT EXISTS(SELECT 1 FROM member_profile_publications p WHERE p.user_id=v.user_id AND p.include_cover AND p.cover_version=v.version)`,[actor.user_id])).rows[0];
   requireCondition(drafts.n<3,409,'profile_cover_draft_limit','請先移除不用的封面草稿。');},
  async prepareRepresentation(body,mime,policy){return prepareLegacyMediaRepresentation(stream(await normalizeProfileCover(mime,await readBounded(body,PROFILE_COVER_INPUT_BYTES))),'image/webp','member.profile-cover',policy);},
  async lockPublication(){return undefined;},
  async publish(q,c,actor,intent,target){
   const row=(await q.query('UPDATE member_profile_cover_targets SET aggregate_version=aggregate_version+1 WHERE user_id=$1 AND aggregate_version=$2 RETURNING aggregate_version',[actor.user_id,target.aggregateVersion])).rows[0];
   requireCondition(row,412,'version_conflict','封面草稿已變更。');const version=String(row.aggregate_version);
   await q.query('INSERT INTO member_profile_cover_versions(user_id,version,scope_id,owner_principal_id,asset_id) VALUES($1,$2,$3,$4,$5)',[actor.user_id,version,c.scope.scope_id,c.subject_principal.principal_id,intent.asset_id]);
   return {aggregateVersion:version,result:{version,present:true as const},fact:{aggregateType:'member_profile_cover',id:actor.user_id,data:{version}}};}
 });
}
/** Bounded immutable upload; same key/body recovers the existing intent. No
 * publication settings are changed, including after an ambiguous response. */
export function createProfileCoverUpload(pool:Pool,store?:ObjectStore){return async(command:Command,file:{mime:string;bytes:Uint8Array})=>{
 command=Object.freeze({...command,actor:Object.freeze({...command.actor})});
 requireCondition(store,503,'profile_cover_upload_unavailable','封面上傳尚未開放。');const bytes=snapshotBoundedBytes(file.bytes,PROFILE_COVER_INPUT_BYTES),assets=createProfileCoverAssets(pool,store!);
 const key=assetCommandKey.parse(command.key),expectedVersion=assetVersion.parse(command.expected);
 const prepared=await assets.prepare(command.actor,{key:digest({operation:'profile.cover.upload',key}),targetUserId:command.actor.user_id,expectedVersion,contentType:file.mime as z.infer<typeof input>['contentType'],byteSize:bytes.length,sha256:await sha256(bytes)});
 const lease=await assets.resumeUpload(command.actor,{key,intentId:prepared.intentId}),identity={key:digest({operation:'profile.cover.finalize',key}),intentId:lease.intentId,fence:lease.fence,leaseToken:lease.leaseToken};
 if(lease.state==='prepared'||lease.state==='processing')await assets.write(command.actor,{...identity,key:digest({operation:'profile.cover.write',key,fence:lease.fence})},stream(bytes));
 const result=await assets.finalize(command.actor,identity);
 await readWithMemberSession(pool,command.actor,async q=>{await ready(q,command.actor);requireCondition((await q.query("SELECT 1 FROM member_profile_cover_versions v JOIN assets a USING(asset_id) WHERE v.user_id=$1 AND v.version=$2 AND v.retired_at IS NULL AND a.state='ready' AND a.deletion_fence=0",[command.actor.user_id,result.version])).rowCount===1,409,'profile_cover_unavailable','封面草稿已移除。');});
 return result;
};}
export async function removeProfileCover(pool:Pool,command:Command,storeAvailable:boolean){
 command=Object.freeze({...command,actor:Object.freeze({...command.actor})});
 const body=z.object({version:assetVersion}).strict().parse(command.body);assetVersion.parse(command.expected);let assetId='';
 await scopedMemberCommand(pool,{actor:command.actor,scope:'personal',operation:'profile.cover.remove',key:command.key,expected:command.expected,body,target:{kind:'member.profile-cover',id:command.actor.user_id}},async(q)=>{
  await ready(q,command.actor);const target=(await q.query('SELECT aggregate_version FROM member_profile_cover_targets WHERE user_id=$1 FOR UPDATE',[command.actor.user_id])).rows[0];requireCondition(target,404,'profile_cover_not_found','找不到封面。');
  const version=(await q.query('SELECT asset_id,retired_at FROM member_profile_cover_versions WHERE user_id=$1 AND version=$2 FOR UPDATE',[command.actor.user_id,body.version])).rows[0];requireCondition(version,404,'profile_cover_not_found','找不到封面。');assetId=version.asset_id;
  requireCondition(!(await q.query('SELECT 1 FROM member_profile_publications WHERE user_id=$1 AND include_cover AND cover_version=$2 FOR SHARE',[command.actor.user_id,body.version])).rowCount,409,'profile_cover_selected','請先儲存不展示這張封面的設定。');
  await q.query('SELECT asset_id FROM assets WHERE asset_id=$1 FOR UPDATE',[assetId]);
 },async(q,c)=>{
  const target=(await q.query('SELECT aggregate_version FROM member_profile_cover_targets WHERE user_id=$1',[command.actor.user_id])).rows[0];checkVersion(String(target.aggregate_version),command.expected);
  requireCondition((await q.query('UPDATE member_profile_cover_versions SET retired_at=clock_timestamp() WHERE user_id=$1 AND version=$2 AND retired_at IS NULL',[command.actor.user_id,body.version])).rowCount===1,409,'profile_cover_removed','封面草稿已移除。');
  await q.query("UPDATE assets SET state='retired',retired_at=clock_timestamp() WHERE asset_id=$1 AND state='ready'",[assetId]);
  const next=(await q.query('UPDATE member_profile_cover_targets SET aggregate_version=aggregate_version+1 WHERE user_id=$1 RETURNING aggregate_version',[command.actor.user_id])).rows[0];await scopedJournal(q,c,{aggregate_type:'member_profile_cover',id:command.actor.user_id,version:next.aggregate_version,operation:'profile.cover.remove',data:{removed_version:body.version}});return {removed:true};
 });
 return readWithMemberSession(pool,command.actor,q=>profileCoverMetadata(q,command.actor,storeAvailable));
}
