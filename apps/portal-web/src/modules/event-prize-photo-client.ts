import {ApiError,type PortalClient} from '../api';
import {eventPrizeDetailsSchema} from '../../../../modules/community/event-prize-details';
import {eventPrizePhotoUrl,type EventPrizePhoto,type EventPrizePhotoAck} from '../../../../modules/community/event-prize-photo-state';
import type {CommunityEvent} from './EventsPanel';
export type {EventPrizePhoto};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const keys=(value:Record<string,unknown>,expected:string[])=>Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
export function validEventPrizePhoto(value:unknown,eventId:string,prizeId:string,publicRead=false):value is EventPrizePhoto{
  return uuid.test(eventId)&&object(value)&&keys(value,['prize_id','photo_version','url'])&&value.prize_id===prizeId&&uuid.test(prizeId)
    &&Number.isSafeInteger(value.photo_version)&&Number(value.photo_version)>1
    &&value.url===eventPrizePhotoUrl(eventId,prizeId,Number(value.photo_version),publicRead);
}
export function validEventPrizePhotos(value:unknown,eventId:string,prizes:{prize_id:string}[],publicRead=false):value is EventPrizePhoto[]{
  return Array.isArray(value)&&value.length<=5&&new Set(value.map(row=>row?.prize_id)).size===value.length
    &&value.every(row=>object(row)&&prizes.some(prize=>prize.prize_id===row.prize_id)&&validEventPrizePhoto(row,eventId,String(row.prize_id),publicRead));
}
export function prizePhotoAvailability(value:unknown,eventId:string,prizeId:string,organizerId:string):boolean{
  if(!object(value)||!keys(value,['event_id','prize_id','organizer_ref','upload_available'])||value.event_id!==eventId||value.prize_id!==prizeId||value.organizer_ref!==organizerId||typeof value.upload_available!=='boolean')throw new Error('照片上傳狀態無法確認，請重新讀取。');
  return value.upload_available;
}
export function prizePhotoFileError(file:File):string|null{
  if(!file.name||file.name.length>255||/[\x00-\x1f\x7f]/.test(file.name))return '照片檔名無法辨識，請重新命名後再選擇。';
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))return '請選擇 JPEG、PNG 或 WebP 照片，不支援 SVG、GIF 或其他檔案。';
  if(!file.size)return '這個檔案是空的，請選擇另一張照片。';
  if(file.size>2*1024*1024)return '照片超過 2 MiB，請先縮小照片再選擇。';
  const extensions:Record<string,RegExp>={'image/png':/\.png$/i,'image/jpeg':/\.jpe?g$/i,'image/webp':/\.webp$/i};
  if(!extensions[file.type].test(file.name))return '照片副檔名與格式不一致，請重新匯出成 JPEG、PNG 或 WebP。';
  return null;
}
export type PrizePhotoCommand=Readonly<{
  client:PortalClient;generation:number;csrfToken:string;eventId:string;prizeId:string;organizerId:string;
  operation:'replace'|'remove';file:File|null;key:string;version:number;
}>;
export function preparePrizePhotoCommand(client:PortalClient,event:CommunityEvent,prizeId:string,userId:string,file:File|null):PrizePhotoCommand{
  if(!client.csrfToken||!uuid.test(event.event_id)||!uuid.test(prizeId)||event.organizer_ref!==userId||event.state!=='pending'||!Number.isFinite(Date.parse(event.starts_at))||Date.parse(event.starts_at)<=Date.now()
    ||!Number.isSafeInteger(event.aggregate_version)||event.aggregate_version<1||event.aggregate_version>=Number.MAX_SAFE_INTEGER||!event.prize_details?.some(prize=>prize.prize_id===prizeId))throw new ApiError({message:'請重新讀取已送審的活動；只有尚未開始的待審核獎品可以更換照片。',status:409,definitiveResponse:true});
  if(file){const error=prizePhotoFileError(file);if(error)throw new ApiError({message:error,status:422,definitiveResponse:true});}
  return Object.freeze({client,generation:client.sessionGeneration,csrfToken:client.csrfToken,eventId:event.event_id,prizeId,organizerId:userId,operation:file?'replace':'remove',file,key:crypto.randomUUID(),version:event.aggregate_version});
}
export function exactPrizePhotoAck(value:unknown,command:PrizePhotoCommand):value is EventPrizePhotoAck{
  if(!object(value)||!keys(value,['acknowledged','event_id','prize_id','organizer_ref','command_key','operation','completed_version','photo'])
    ||value.acknowledged!==true||value.event_id!==command.eventId||value.prize_id!==command.prizeId||value.organizer_ref!==command.organizerId
    ||value.command_key!==command.key||value.operation!==command.operation||value.completed_version!==command.version+1)return false;
  return command.operation==='remove'?value.photo===null:validEventPrizePhoto(value.photo,command.eventId,command.prizeId)&&value.photo.photo_version===command.version+1;
}
export async function sendPrizePhotoCommand(command:PrizePhotoCommand,signal:AbortSignal):Promise<EventPrizePhotoAck>{
  const {client}=command;
  const current=()=>client.sessionGeneration===command.generation&&client.csrfToken===command.csrfToken;
  if(!current())throw new ApiError({message:'登入狀態已變更，請重新開啟活動。',status:409,definitiveResponse:true});
  const options={idempotencyKey:command.key,ifMatch:command.version,signal,suppressConsole:true};
  const value=command.operation==='replace'
    ?await client.replaceEventPrizePhoto<unknown>(command.eventId,command.prizeId,command.file!,options)
    :await client.removeEventPrizePhoto<unknown>(command.eventId,command.prizeId,options);
  if(!current()||!exactPrizePhotoAck(value,command))throw new ApiError({message:'照片操作結果尚未確認，請確認原操作。',network:true});
  return value;
}
/** Current projection is independent from a historical ACK. Never infer ACK from it. */
export function currentPrizePhotoEvent(value:unknown,eventId:string,organizerId:string,minimumVersion:number):CommunityEvent{
  if(!object(value))throw new Error('活動資料不完整，請重新讀取。');
  const prizes=eventPrizeDetailsSchema.safeParse(value.prize_details===undefined?[]:value.prize_details);
  if(value.event_id!==eventId||value.organizer_ref!==organizerId||!Number.isSafeInteger(value.aggregate_version)||Number(value.aggregate_version)<minimumVersion
    ||!prizes.success||!validEventPrizePhotos(value.prize_photos===undefined?[]:value.prize_photos,eventId,prizes.data)
    ||!['organizer_name','title','description','location'].every(key=>typeof value[key]==='string')
    ||!['starts_at','ends_at'].every(key=>typeof value[key]==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value[key] as string)&&Number.isFinite(Date.parse(value[key] as string)))
    ||!['pending','published','rejected','cancelled'].includes(String(value.state))||!['online','in_person','hybrid'].includes(String(value.mode))
    ||!['workshop','guild','referral','open'].includes(String(value.visibility))||!['reading_group','meetup','guild_skill_exchange','other'].includes(String(value.event_kind))
    ||!['banner_url','video_url','topic','online_url','guild_key','review_guild_key','review_reason'].every(key=>value[key]===null||typeof value[key]==='string')
    ||(Array.isArray(value.prize_photos)&&value.prize_photos.some(photo=>photo.photo_version>Number(value.aggregate_version)))
    ||!Number.isSafeInteger(value.attending_count)||Number(value.attending_count)<0||![null,'going','cancelled'].includes(value.my_rsvp as null)
    ||typeof value.can_review!=='boolean'||!(value.capacity===null||Number.isSafeInteger(value.capacity)&&Number(value.capacity)>0))throw new Error('目前活動資料或版本無法確認，請重新讀取。');
  return value as unknown as CommunityEvent;
}
