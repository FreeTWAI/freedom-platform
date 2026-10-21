import {ApiError,type PortalClient} from '../api';
import {policiesAcknowledgement,type PoliciesAttempt} from './hosted-store-policies-state';
export async function sendPoliciesAttempt(client:PortalClient,attempt:PoliciesAttempt){
 const generation=client.sessionGeneration;
 const payload=await client.put(`/tenants/${attempt.tenantId}/storefronts/${attempt.instanceId}/seller-policies`,attempt.body,{idempotencyKey:attempt.key,ifMatch:attempt.expected});
 if(client.sessionGeneration!==generation)throw new ApiError({message:'登入狀態已改變，原操作結果尚未確認。',network:true});
 const ack=policiesAcknowledgement(payload,attempt);if(!ack)throw new ApiError({message:'賣方資訊與商店政策回應未完整收到，請重試原操作。',network:true});return ack;
}
