import {accessAwareFetch,expiredAccessStatus,isExpiredAccessResponse,MEMBER_ACCESS_EXPIRED_MESSAGE} from '../access-fetch';
import {ApiError,type PortalClient} from '../api';
import {appearanceAcknowledgement,type AppearanceAttempt} from './hosted-store-appearance-state';

export async function sendAppearanceAttempt(client:PortalClient,attempt:AppearanceAttempt){
  if(!client.csrfToken)throw new ApiError({message:MEMBER_ACCESS_EXPIRED_MESSAGE,status:401,accessExpired:true});
  const csrf=client.csrfToken,generation=client.sessionGeneration;
  const root=`/tenants/${attempt.tenantId}/storefronts/${attempt.instanceId}`;
  let payload:unknown;
  if(attempt.kind==='settings')payload=await client.patch(root+'/appearance-settings',attempt.body,{idempotencyKey:attempt.key,ifMatch:attempt.expected});
  else{
    let response:Response;
    try{response=await accessAwareFetch('/api/v1'+root+'/appearance-media/'+attempt.kind+(attempt.action==='remove'?'/remove':''),{
      method:'POST',credentials:'same-origin',headers:{Accept:'application/json','Content-Type':attempt.file?.type??'application/json',
        'X-CSRF-Token':csrf,'Idempotency-Key':attempt.key,'If-Match':`"${attempt.expected}"`},body:attempt.file??'{}'});}
    catch{throw new ApiError({message:'店面外觀操作結果尚未確認，請重試原操作。',network:true});}
    if(await isExpiredAccessResponse(response)){
      const status=expiredAccessStatus(response);
      if(client.sessionGeneration===generation&&client.csrfToken===csrf){client.accessExpired=true;if(status===401||status===403)client.csrfToken=null;client.onUnauthorized?.();}
      throw new ApiError({message:MEMBER_ACCESS_EXPIRED_MESSAGE,status,accessExpired:true});
    }
    if(client.sessionGeneration!==generation)throw new ApiError({message:'登入狀態已改變，原操作結果尚未確認。',network:true});
    client.accessExpired=false;
    if(response.status===401){client.csrfToken=null;client.onUnauthorized?.();throw new ApiError({message:'登入已過期，請重新登入。',status:401});}
    try{payload=await response.json();}catch{throw new ApiError({message:'店面外觀回應未完整收到，請重試原操作。',network:true});}
    if(!response.ok){const problem=payload as {detail?:string;code?:string};throw new ApiError({message:typeof problem?.detail==='string'?problem.detail:'店面外觀操作未完成。',
      status:response.status,code:problem?.code,network:response.status>=500});}
  }
  if(client.sessionGeneration!==generation)throw new ApiError({message:'登入狀態已改變，原操作結果尚未確認。',network:true});
  const ack=appearanceAcknowledgement(payload,attempt);
  if(!ack)throw new ApiError({message:'店面外觀回應未完整收到，請重試原操作。',network:true});
  return ack;
}
