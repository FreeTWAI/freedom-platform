import type {PoolClient} from 'pg';
import {OpaqueId} from '../../../contracts/common/v1/identity.js';
import {requireCondition} from '../../../packages/shared/problem.js';
import {assertFreshVerificationCurrent,consumeFreshVerification,requireFreshVerification} from '../../tenant-workspaces/high-risk-verification.js';

/** Accepted only by Commerce settings commands, outside their immutable receipt body. */
export function parseSettingsRecoveryVerification(value:string|undefined){return value===undefined?undefined:OpaqueId.parse(value);}
type Scope={userId:string;sessionHash:string;principalId:string;tenantId:string;namespaceDigest:string};

export function settingsVerification(originalId:string,recoveryId?:string){
 const effectiveId=recoveryId??originalId;
 return {
  current:(q:PoolClient)=>assertFreshVerificationCurrent(q,effectiveId),
  async authorize(q:PoolClient,scope:Scope){
   if(recoveryId){
    // Only expiry may be renewed. The original proof must still belong to this
    // exact session/actor/tenant/purpose and cannot have authorized another key.
    const original=(await q.query<{consumed_by:string|null}>(`SELECT consumed_by FROM tenant_high_risk_verifications
      WHERE verification_id=$1 AND user_id=$2 AND principal_id=$3 AND session_hash=$4
        AND tenant_id=$5 AND purpose='commerce.provider_account.write' FOR UPDATE`,
     [originalId,scope.userId,scope.principalId,scope.sessionHash,scope.tenantId])).rows[0];
    requireCondition(original&&(original.consumed_by===null||original.consumed_by===scope.namespaceDigest),403,'fresh_auth_required','需要重新驗證。');
   }
   await requireFreshVerification(q,{...scope,purpose:'commerce.provider_account.write',verificationId:effectiveId});
   if(recoveryId){
    // Bind even a receipt hit. Repeated lost acknowledgements may replay this
    // same recovery proof; requireFreshVerification already checked its binding.
    await q.query(`UPDATE tenant_high_risk_verifications SET consumed_at=clock_timestamp(),consumed_by=$2
      WHERE verification_id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()`,[recoveryId,scope.namespaceDigest]);
   }
   await assertFreshVerificationCurrent(q,effectiveId);
  },
  async consume(q:PoolClient,namespaceDigest:string){
   if(!recoveryId)return consumeFreshVerification(q,originalId,namespaceDigest);
   await assertFreshVerificationCurrent(q,effectiveId);
   // A miss executes the original command once. Keep its original proof bound
   // too; its expired timestamp is never extended or used as current authority.
   const consumed=await q.query(`UPDATE tenant_high_risk_verifications SET consumed_at=clock_timestamp(),consumed_by=$2
     WHERE verification_id=$1 AND consumed_at IS NULL`,[originalId,namespaceDigest]);
   requireCondition(consumed.rowCount===1,403,'fresh_auth_required','需要重新驗證。');
  },
 };
}
