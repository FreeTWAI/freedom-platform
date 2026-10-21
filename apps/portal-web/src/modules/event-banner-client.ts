import { accessAwareFetch, expiredAccessStatus, isExpiredAccessResponse, MEMBER_ACCESS_EXPIRED_MESSAGE } from '../access-fetch';
import { ApiError, type PortalClient } from '../api';
import type { CommunityEvent } from './EventsPanel';

export type EventMediaCommand = Readonly<{
  kind:'banner'|'video';eventId:string;file:File;key:string;version:number;
  orientation?:'portrait'|'landscape';csrfToken:string;generation:number;
}>;

// Keep the File (immutable bytes), orientation, key and expected version together.
// Readback alone cannot identify an upload: another writer can change the version,
// and an existing media URL is not a receipt for these particular bytes.
export async function prepareEventMedia(client:PortalClient,event:CommunityEvent,file:File,kind:EventMediaCommand['kind']):Promise<EventMediaCommand>{
  if(!client.csrfToken)throw new ApiError({message:'登入狀態已變更，請重新整理後再試。',status:400});
  const csrfToken=client.csrfToken,generation=client.sessionGeneration;
  let orientation:'portrait'|'landscape'|undefined;
  if(kind==='banner'){
    orientation='landscape';
    try{const image=await createImageBitmap(file);orientation=image.height>image.width?'portrait':'landscape';image.close();}catch{/* Server still validates the image; use a landscape canvas. */}
  }
  if(client.csrfToken!==csrfToken||client.sessionGeneration!==generation)throw new ApiError({message:'登入狀態已變更，請重新整理後再試。',status:409});
  return Object.freeze({kind,eventId:event.event_id,file,key:crypto.randomUUID(),version:event.aggregate_version,orientation,csrfToken,generation});
}

function requireMediaSession(client:PortalClient,command:EventMediaCommand){
  if(client.csrfToken!==command.csrfToken||client.sessionGeneration!==command.generation)throw new ApiError({message:'登入狀態已變更，請重新整理後再試。',status:409});
}
function unknownMedia(){return new ApiError({message:'媒體保存結果尚未確認，請先確認原操作。',network:true});}
function mediaEvent(payload:unknown,command:EventMediaCommand,minimum:number):CommunityEvent{
  if(!payload||typeof payload!=='object')throw unknownMedia();
  const value=payload as CommunityEvent;
  if(value.event_id!==command.eventId||!Number.isSafeInteger(value.aggregate_version)||value.aggregate_version<minimum
    ||!['organizer_ref','organizer_name','title','description','location'].every(key=>typeof payload[key as keyof typeof payload]==='string')
    ||!Number.isFinite(Date.parse(value.starts_at))||!Number.isFinite(Date.parse(value.ends_at))
    ||!['online','in_person','hybrid'].includes(value.mode)||!['pending','published','rejected','cancelled'].includes(value.state))throw unknownMedia();
  return value;
}
export function currentMediaEvent(readback:CommunityEvent,receipt:CommunityEvent):CommunityEvent{
  return readback.aggregate_version>receipt.aggregate_version?readback:receipt;
}

export async function sendEventMedia(client:PortalClient,command:EventMediaCommand):Promise<CommunityEvent>{
  requireMediaSession(client,command);
  const requestCsrfToken=command.csrfToken;
  let response:Response;
  try{response=await accessAwareFetch(`/api/v1/events/${command.eventId}/${command.kind}`,{
    method:'POST',credentials:'same-origin',body:command.file,
    headers:{Accept:'application/json','Content-Type':command.file.type,...(command.orientation?{'X-Poster-Orientation':command.orientation}:{}),'X-CSRF-Token':requestCsrfToken,'Idempotency-Key':command.key,'If-Match':`"${command.version}"`},
  });}catch{throw unknownMedia();}
  if(await isExpiredAccessResponse(response)){
    const status=expiredAccessStatus(response);
    if(client.csrfToken===requestCsrfToken){client.accessExpired=true;if(status===401||status===403)client.csrfToken=null;client.onUnauthorized?.();}
    throw new ApiError({message:MEMBER_ACCESS_EXPIRED_MESSAGE,status,accessExpired:true});
  }
  if(client.csrfToken===requestCsrfToken){client.accessExpired=false;if(response.status===401){client.csrfToken=null;client.onUnauthorized?.();}}
  let payload:Record<string,unknown>;
  try{payload=await response.json();}catch{
    // A format rejection cannot have committed, even when its problem body is unreadable.
    if(response.status===415)throw new ApiError({message:'媒體格式不符，請重新選擇檔案。',status:415});
    throw unknownMedia();
  }
  if(!response.ok)throw new ApiError({message:typeof payload?.detail==='string'?payload.detail:'媒體未能保存，請稍後重試。',status:response.status,code:typeof payload?.code==='string'?payload.code:undefined,network:response.status>=500});
  requireMediaSession(client,command);
  const result=mediaEvent(payload,command,command.version+1);
  if(typeof result[`${command.kind}_url`]!=='string'||!result[`${command.kind}_url`])throw unknownMedia();
  return result;
}

// Always read before replaying the original receipt-bearing command. A replay
// uses the original version even when the read already observes its commit.
export async function readEventMedia(client:PortalClient,command:EventMediaCommand):Promise<CommunityEvent>{
  requireMediaSession(client,command);
  const result=await client.get<CommunityEvent>(`/events/${command.eventId}`);
  requireMediaSession(client,command);
  return mediaEvent(result,command,command.version);
}
export async function uploadEventBanner(client:PortalClient,event:CommunityEvent,file:File,command?:EventMediaCommand):Promise<CommunityEvent>{
  return sendEventMedia(client,command??await prepareEventMedia(client,event,file,'banner'));
}
export async function uploadEventVideo(client:PortalClient,event:CommunityEvent,file:File,command?:EventMediaCommand):Promise<CommunityEvent>{
  return sendEventMedia(client,command??await prepareEventMedia(client,event,file,'video'));
}
