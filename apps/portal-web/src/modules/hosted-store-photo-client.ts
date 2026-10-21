import {prepareBrowserRaster,socialImageProblem} from '../../../../packages/asset-storage/browser-raster';
import {GalleryCommandAckSchema,type GalleryCommandAck} from '../../../../contracts/guild-launchpad/v1/storefront-gallery';
import { accessAwareFetch,expiredAccessStatus,isExpiredAccessResponse,MEMBER_ACCESS_EXPIRED_MESSAGE } from '../access-fetch';
import { ApiError,type PortalClient } from '../api';
import { photoAcknowledgement,type PhotoAttempt,type GalleryPhotoAttempt } from './hosted-store-photo-state';

export function productPhotoFileError(file:File){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))return '請選擇 PNG、JPEG 或 WebP 照片。';
  if(file.size<1||file.size>2*1024*1024)return '請選擇 2 MiB 以下的完整照片。';
  return null;
}
/** Shared on-device preparation for the original editor and gallery picker. */
export async function prepareProductPhotoFile(selected:File){
 const problem=socialImageProblem(selected);if(problem)throw new Error(problem);
 const file=selected.size>2*1024*1024?await prepareBrowserRaster(selected):selected;
 const error=productPhotoFileError(file);if(error)throw new Error(error);return file;
}
async function sendPhotoRequest<T>(client:PortalClient,attempt:Pick<PhotoAttempt,'key'|'expected'|'file'>,path:string,method:string,body:BodyInit,acknowledge:(raw:unknown)=>T|null):Promise<T>{
  if(!client.csrfToken)throw new ApiError({message:MEMBER_ACCESS_EXPIRED_MESSAGE,status:401,accessExpired:true});
  const csrf=client.csrfToken,generation=client.sessionGeneration;
  let response:Response;
  try {response=await accessAwareFetch(path,{method,credentials:'same-origin',
    headers:{Accept:'application/json','Content-Type':attempt.file?.type??'application/json','X-CSRF-Token':csrf,'Idempotency-Key':attempt.key,'If-Match':`"${attempt.expected}"`},body});}
  catch{throw new ApiError({message:'照片操作結果尚未確認，請重試原操作。',network:true});}
  if(await isExpiredAccessResponse(response)){
    const status=expiredAccessStatus(response);
    if(client.sessionGeneration===generation&&client.csrfToken===csrf){client.accessExpired=true;if(status===401||status===403)client.csrfToken=null;client.onUnauthorized?.();}
    throw new ApiError({message:MEMBER_ACCESS_EXPIRED_MESSAGE,status,accessExpired:true});
  }
  if(client.sessionGeneration!==generation)throw new ApiError({message:'登入狀態已改變，照片操作結果尚未確認。',network:true});
  // A platform JSON 401 is distinct from Cloudflare Access expiry. Notify the
  // shell before reading the error body, while fencing out an older session.
  client.accessExpired=false;
  if(response.status===401){
    client.csrfToken=null;client.onUnauthorized?.();
    throw new ApiError({message:'登入已過期，請重新登入。',status:401});
  }
  let payload:unknown;try{payload=await response.json();}catch{throw new ApiError({message:'照片回應未完整收到，請重試原操作。',network:true});}
  if(client.sessionGeneration!==generation)throw new ApiError({message:'登入狀態已改變，照片操作結果尚未確認。',network:true});
  if(!response.ok){const problem=payload as {detail?:string;code?:string};throw new ApiError({message:typeof problem?.detail==='string'?problem.detail:'照片操作未完成。',status:response.status,code:problem?.code,network:response.status>=500});}
  const ack=acknowledge(payload);
  if(!ack)throw new ApiError({message:'照片回應未完整收到，請重試原操作。',network:true});
  return ack;
}

export function sendProductPhoto(client:PortalClient,attempt:PhotoAttempt){
 const path=`/api/v1/tenants/${attempt.tenantId}/storefronts/${attempt.instanceId}/products/${attempt.productId}/photo${attempt.action==='remove'?'/remove':''}`;
 return sendPhotoRequest(client,attempt,path,'POST',attempt.file??'{}',raw=>photoAcknowledgement(raw,attempt));
}
export function galleryAcknowledgement(raw:unknown,attempt:GalleryPhotoAttempt):GalleryCommandAck|null{
 const parsed=GalleryCommandAckSchema.safeParse(raw);if(!parsed.success)return null;const ack=parsed.data;
 if(ack.product_id!==attempt.productId||ack.operation!==attempt.action||ack.photo_key!==attempt.photoKey||ack.completed_version!==String(BigInt(attempt.expected)+(ack.changed?1n:0n))||attempt.action==='upload'&&!ack.changed)return null;
 const prefix=`/api/v1/tenants/${attempt.tenantId}/storefronts/${attempt.instanceId}/products/${attempt.productId}/gallery/photos/`;
 return [...ack.current.photos,...ack.current.retained_secondary_photos].every(p=>p.read_path.startsWith(prefix))?ack:null;
}
export function sendGalleryPhoto(client:PortalClient,attempt:GalleryPhotoAttempt){
 const root=`/api/v1/tenants/${attempt.tenantId}/storefronts/${attempt.instanceId}/products/${attempt.productId}/gallery`;
 const path=attempt.action==='reorder'?root+'/reorder':root+'/photos/'+attempt.photoKey+(attempt.action==='remove'?'/remove':'');
 return sendPhotoRequest(client,attempt,path,attempt.action==='describe'?'PATCH':'POST',attempt.file??attempt.body,raw=>galleryAcknowledgement(raw,attempt));
}
