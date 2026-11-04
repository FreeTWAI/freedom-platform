import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Pool,PoolClient} from 'pg';
import type {Actor} from '../identity-membership/service.js';
import {digest,checkVersion,type Command} from '../../packages/db/index.js';
import {scopedMemberCommand,scopedJournal,type ScopedMemberCommand} from '../../packages/scoped-commands/index.js';
import {withMemberScope} from '../../packages/resource-scopes/index.js';
import {assertCurrentSessionClock} from '../../packages/db/member-session.js';
import {Problem,requireCondition} from '../../packages/shared/problem.js';
import {normalizeImage} from '../../packages/shared/image-runtime.js';
import {assertCompleteRaster} from '../../packages/shared/image-container.js';
import {rasterFormat} from '../skill-submissions/payload.js';
import {readBounded,snapshotBoundedBytes,prepareLegacyMediaRepresentation,requirePersistence,AssetStorageError,type ObjectStore} from '../../packages/asset-storage/index.js';
import {assetCommandKey,assetVersion,createAssetLifecycle,type LifecyclePolicy} from './engine.js';
import {authorizeEventPrizePhotoOwner} from '../community/events.js';
import {eventPrizePhotoTargetId} from '../community/event-prize-photos.js';
import {eventPrizePhotoUrl,type EventPrizePhotoAck,type EventPrizePhotoAvailability} from '../community/event-prize-photo-state.js';

export const EVENT_PRIZE_PHOTO_INPUT_BYTES=2097152,EVENT_PRIZE_PHOTO_OUTPUT_BYTES=1048576;
const input=z.object({key:assetCommandKey,targetPrizePhotoId:z.uuid(),expectedVersion:assetVersion,contentType:z.enum(['image/png','image/jpeg','image/webp']),byteSize:z.number().int().min(1).max(EVENT_PRIZE_PHOTO_INPUT_BYTES),sha256:z.string().regex(/^[0-9a-f]{64}$(?![\s\S])/)}).strict();
const stream=(bytes:Uint8Array)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}});
const invalid=()=>new Problem(422,'invalid_event_prize_photo','請選擇完整的靜態 JPEG、PNG 或 WebP 照片，長寬不超過 4096 像素。');
const unavailable=()=>new Problem(503,'event_prize_photo_unavailable','獎品照片上傳尚未開放或暫時無法使用。');
export function assertEventPrizePhotoSource(mime:string,bytes:Uint8Array){
 requireCondition(['image/png','image/jpeg','image/webp'].includes(mime),415,'event_prize_photo_format','請選擇 JPEG、PNG 或 WebP 照片。');
 requireCondition(bytes.length>0,422,'invalid_event_prize_photo','請先選擇照片。');
 requireCondition(bytes.length<=EVENT_PRIZE_PHOTO_INPUT_BYTES,413,'event_prize_photo_too_large','照片需為 2 MiB 以下。');
 const format=rasterFormat(Buffer.from(bytes));if(!format||mime!==`image/${format}`)throw invalid();
 try{assertCompleteRaster(bytes,format,4096,16777216);}catch{throw invalid();}return format;
}
/** Bounded complete framing plus the installed full decoder, never malware scanning. */
export async function normalizeEventPrizePhoto(mime:string,raw:Uint8Array){
 const bytes=Buffer.from(snapshotBoundedBytes(raw,EVENT_PRIZE_PHOTO_INPUT_BYTES)),format=assertEventPrizePhotoSource(mime,bytes);
 try{const output=await normalizeImage(bytes,{purpose:'event_prize_photo',format,maxDimension:4096,maxPixels:16777216,maxOutputBytes:EVENT_PRIZE_PHOTO_OUTPUT_BYTES,output:{width:1920,height:1920,fit:'inside',quality:80,effort:4}});
  if(output.length<1||output.length>EVENT_PRIZE_PHOTO_OUTPUT_BYTES)throw invalid();return output;
 }catch(error){if(error instanceof Problem&&error.status===503)throw error;throw invalid();}
}
export async function eventPrizePhotoPolicy(q:PoolClient):Promise<LifecyclePolicy>{
 const row=(await q.query("SELECT mode,policy_revision,persistence_allowed,retained_byte_limit::text AS retained_byte_limit FROM domain_media_storage_policy WHERE purpose='community.event-prize-photo' FOR SHARE")).rows[0];
 if(!row||!['bridge','r2_only'].includes(row.mode)||row.persistence_allowed!==true||typeof row.policy_revision!=='string'||typeof row.retained_byte_limit!=='string'||!/^[1-9][0-9]{0,18}$/.test(row.retained_byte_limit)||(BigInt(row.retained_byte_limit)<BigInt(EVENT_PRIZE_PHOTO_OUTPUT_BYTES)||BigInt(row.retained_byte_limit)>9223372036854775807n))throw unavailable();
 const policy=Object.freeze({revision:row.policy_revision,platformPersistenceAllowed:true,retainedByteLimit:row.retained_byte_limit});
 try{requirePersistence(policy);}catch{throw unavailable();}return policy;
}
/** Advisory read only: never reserves capacity or creates a photo target/intent.
 * Every real write still revalidates all authority, policy, lease and CAS gates. */
export async function readEventPrizePhotoAvailability(pool:Pool,rawActor:Actor,rawEventId:string,rawPrizeId:string,store?:ObjectStore):Promise<EventPrizePhotoAvailability>{
 const actor=Object.freeze({...rawActor}),eventId=z.uuid().parse(rawEventId).toLowerCase(),prizeId=z.uuidv4().parse(rawPrizeId).toLowerCase();
 return withMemberScope(pool,{actor,scope:'community'},async()=>{},async q=>{
  const event=await authorizeEventPrizePhotoOwner(q,actor,eventId,false,false);
  requireCondition(Array.isArray(event.prize_details)&&event.prize_details.some((p:{prize_id:string})=>p.prize_id===prizeId),404,'event_prize_not_found','請先儲存這項活動獎品。');
  let admitted=false;
  if(store)try{await eventPrizePhotoPolicy(q);admitted=true;}catch(error){if(!(error instanceof Problem&&error.status===503))throw error;}
  const clock=(await q.query('SELECT clock_timestamp() AS now')).rows[0].now;
  await assertCurrentSessionClock(q,actor);
  return {event_id:eventId,prize_id:prizeId,organizer_ref:actor.user_id,upload_available:admitted&&event.state==='pending'&&Date.parse(event.starts_at)>clock.getTime()};
 });
}
async function editable(q:PoolClient,actor:Actor,eventId:string,prizeId:string){
 const event=await authorizeEventPrizePhotoOwner(q,actor,eventId,true,true);
 requireCondition(Array.isArray(event.prize_details)&&event.prize_details.some((p:{prize_id:string})=>p.prize_id===prizeId),404,'event_prize_not_found','請先儲存這項活動獎品。');return event;
}
function assetsForPrize(pool:Pool,store:ObjectStore,actor:Actor,eventId:string,prizeId:string){
 const targetId=eventPrizePhotoTargetId(eventId,prizeId);
 return createAssetLifecycle<z.infer<typeof input>,number>(pool,{store},{
  purpose:'community.event-prize-photo',targetKind:'community.event-prize-photo',variant:'photo',inputMaxBytes:EVENT_PRIZE_PHOTO_INPUT_BYTES,outputMaxBytes:EVENT_PRIZE_PHOTO_OUTPUT_BYTES,retireReplacedAsset:true,
  parsePrepare:raw=>input.parse(raw),targetId:raw=>raw.targetPrizePhotoId,
  revalidate:async q=>{await editable(q,actor,eventId,prizeId);},
  async lockTarget(q,c,current,id,create){
   requireCondition(id===targetId&&c.scope.kind==='community'&&current.user_id===actor.user_id&&current.community_id===actor.community_id,404,'asset_target_not_found','找不到這個獎品。');
   const event=await editable(q,current,eventId,prizeId);
   if(create)await q.query(`INSERT INTO community_event_prize_photo_targets(target_id,event_id,prize_id,community_id,scope_id,owner_principal_id,owner_user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[targetId,eventId,prizeId,current.community_id,c.scope.scope_id,c.subject_principal.principal_id,current.user_id]);
   const target=(await q.query(`SELECT asset_id FROM community_event_prize_photo_targets WHERE target_id=$1 AND event_id=$2 AND prize_id=$3 AND community_id=$4 AND scope_id=$5 AND owner_principal_id=$6 AND owner_user_id=$7 FOR UPDATE`,[targetId,eventId,prizeId,current.community_id,c.scope.scope_id,c.subject_principal.principal_id,current.user_id])).rows[0];
   requireCondition(target,404,'asset_target_not_found','找不到這個獎品。');return {targetId,aggregateVersion:String(event.aggregate_version),assetId:target.asset_id};
  },resolvePolicy:eventPrizePhotoPolicy,
  async requireCapacity(q,c,_actor,_target,policy,reserve){
   const row=(await q.query(`SELECT COALESCE(sum(COALESCE(o.byte_size,i.reserved_bytes,1048576)::bigint),0)::text used
    FROM assets a LEFT JOIN asset_objects o USING(asset_id) LEFT JOIN asset_upload_intents i USING(asset_id)
    WHERE a.scope_id=$1 AND a.purpose='community.event-prize-photo'`,[c.scope.scope_id])).rows[0];
   requireCondition(BigInt(row.used)+BigInt(reserve)<=BigInt(policy.retainedByteLimit),409,'asset_retained_quota','照片儲存容量已達上限；移除照片不會立即釋放容量。');
  },
  async prepareRepresentation(body,mime,policy){return prepareLegacyMediaRepresentation(stream(await normalizeEventPrizePhoto(mime,await readBounded(body,EVENT_PRIZE_PHOTO_INPUT_BYTES))),'image/webp','community.event-prize-photo',policy);},
  async lockPublication(q){await editable(q,actor,eventId,prizeId);},
  async publish(q,_context,current,row){
   await editable(q,current,eventId,prizeId);
   const next=(await q.query('UPDATE community_events SET aggregate_version=aggregate_version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND aggregate_version=$2 RETURNING aggregate_version',[eventId,row.expected_version])).rows[0];
   requireCondition(next,412,'version_conflict','活動已更新，請重新載入後再操作。');const version=Number(next.aggregate_version);
   await q.query('UPDATE community_event_prize_photo_targets SET asset_id=$2,linked_at_version=$3 WHERE target_id=$1',[targetId,row.asset_id,version]);
   return {aggregateVersion:String(version),result:version,fact:{aggregateType:'community_event',id:eventId,data:{prize_id:prizeId,photo_version:version},eventType:'freedom.community.event.prize-photo.replaced.v1'}};
  },
 });
}
/** Exact immutable HTTP command receipt. It precedes decoding/storage admission,
 * and current owner/session/scope precedes historical replay. */
export async function mutateEventPrizePhoto(pool:Pool,raw:Command,rawEventId:string,rawPrizeId:string,file:{mime:string;bytes:Uint8Array}|null,store?:ObjectStore):Promise<EventPrizePhotoAck>{
 const eventId=z.uuid().parse(rawEventId).toLowerCase(),prizeId=z.uuidv4().parse(rawPrizeId).toLowerCase();
 const actor=Object.freeze({...raw.actor}),key=assetCommandKey.parse(raw.key),expected=assetVersion.parse(raw.expected);
 requireCondition(BigInt(expected)<BigInt(Number.MAX_SAFE_INTEGER),409,'event_version_exhausted','活動版本已達上限。');
 const bytes=file?snapshotBoundedBytes(file.bytes,EVENT_PRIZE_PHOTO_INPUT_BYTES):null,mime=file?.mime;
 const operation=file?'replace' as const:'remove' as const,path=`/api/v1/events/${eventId}/prizes/${prizeId}/photo${file?'':'/remove'}`;
 const source=bytes?{mime,byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}:null;
 const command:ScopedMemberCommand={actor,scope:'community',lockUser:true,operation:`community.event.prize-photo.${operation}`,key,expected,target:{kind:'community.event.prize-photo',id:eventId},body:{method:'POST',path,event_id:eventId,prize_id:prizeId,source}};
 const authorize=(q:PoolClient)=>authorizeEventPrizePhotoOwner(q,actor,eventId,true,false);
 const ack=(version:number):EventPrizePhotoAck=>({acknowledged:true,event_id:eventId,prize_id:prizeId,organizer_ref:actor.user_id,command_key:key,operation,completed_version:version,photo:file?{prize_id:prizeId,photo_version:version,url:eventPrizePhotoUrl(eventId,prizeId,version)}:null});
 const probe=async()=>{const miss=new Error('event_prize_photo_receipt_miss');try{return await scopedMemberCommand<EventPrizePhotoAck>(pool,command,authorize,async()=>{throw miss;},authorize);}catch(error){if(error!==miss)throw error;return undefined;}};
 const replay=await probe();if(replay)return replay;
 if(!file){let mutated=false;return scopedMemberCommand(pool,command,authorize,async(q,c)=>{
   const event=await editable(q,actor,eventId,prizeId);checkVersion(String(event.aggregate_version),expected);
   const target=(await q.query('SELECT target_id,asset_id FROM community_event_prize_photo_targets WHERE event_id=$1 AND prize_id=$2 FOR UPDATE',[eventId,prizeId])).rows[0];
   requireCondition(target?.asset_id,409,'event_prize_photo_missing','這項獎品目前沒有照片。');
   await q.query('SELECT asset_id FROM assets WHERE asset_id=$1 FOR UPDATE',[target.asset_id]);
   await assertCurrentSessionClock(q,actor);await editable(q,actor,eventId,prizeId);
   await q.query('UPDATE community_event_prize_photo_targets SET asset_id=NULL,linked_at_version=NULL WHERE target_id=$1',[target.target_id]);
   await q.query("UPDATE assets SET state='retired',retired_at=clock_timestamp() WHERE asset_id=$1 AND state='ready'",[target.asset_id]);
   const next=(await q.query('UPDATE community_events SET aggregate_version=aggregate_version+1,updated_at=clock_timestamp() WHERE event_id=$1 AND aggregate_version=$2 RETURNING aggregate_version',[eventId,expected])).rows[0];requireCondition(next,412,'version_conflict','活動已更新，請重新載入後再操作。');
   const version=Number(next.aggregate_version);await scopedJournal(q,c,{aggregate_type:'community_event',id:eventId,version,operation:command.operation,data:{prize_id:prizeId},eventType:'freedom.community.event.prize-photo.removed.v1'});mutated=true;return ack(version);
  },async q=>{await authorize(q);if(mutated)await editable(q,actor,eventId,prizeId);});}
 if(!store)throw unavailable();
 const assets=assetsForPrize(pool,store,actor,eventId,prizeId),prepareKey=digest({operation:command.operation,key,path});
 try{
  const prepared=await assets.prepare(actor,{key:prepareKey,targetPrizePhotoId:eventPrizePhotoTargetId(eventId,prizeId),expectedVersion:expected,contentType:mime as 'image/png'|'image/jpeg'|'image/webp',byteSize:bytes!.length,sha256:source!.sha256});
  const lease=await assets.resumeUpload(actor,{key:prepareKey,intentId:prepared.intentId}),binding={intentId:lease.intentId,fence:lease.fence,leaseToken:lease.leaseToken};
  if(lease.state==='prepared'||lease.state==='processing')await assets.write(actor,{...binding,key:digest({prepareKey,phase:'write',fence:lease.fence})},stream(bytes!));
  let mutated=false;
  return await assets.finalizeVia(actor,{...binding,key:digest({prepareKey,phase:'finalize'})},{operation:command.operation,
   execute:run=>scopedMemberCommand(pool,command,authorize,async(q,c)=>{const result=await run(q,c);mutated=true;return result;},async q=>{await authorize(q);if(mutated)await editable(q,actor,eventId,prizeId);}),
   validateIntent:row=>requireCondition(row.target_prize_photo_id===eventPrizePhotoTargetId(eventId,prizeId)&&row.expected_version===expected&&row.source_content_type===mime&&row.source_byte_size===bytes!.length&&row.source_sha256===source!.sha256,409,'asset_source_mismatch','上傳內容與原操作不同。'),result:ack});
 }catch(error){const saved=await probe();if(saved)return saved;if(error instanceof AssetStorageError)throw unavailable();throw error;}
}
