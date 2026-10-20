import type {Pool,PoolClient} from 'pg';
import {isolatedTransaction} from '../../../packages/resource-scopes/tenant-transaction.js';
import type {CheckoutBuyerIdentity} from '../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {mapPersonPrincipal} from '../../../packages/resource-scopes/index.js';
import {Problem} from '../../../packages/shared/problem.js';
import {hashKey} from './terms.js';
import {orderAccessNotFound} from './access.js';

export const buyerIdentity=(identity:{userId:string}|null):CheckoutBuyerIdentity=>identity?`member:${identity.userId}`:'guest';
export function assertBuyerIdentity(expected:CheckoutBuyerIdentity|undefined,identity:{userId:string}|null) {
  if(expected!==undefined&&expected!==buyerIdentity(identity))throw new Problem(409,'checkout_identity_changed','登入身分已變更，請重新確認');
}

/** Optional member identity, without authenticate()'s session activity write.
 * Locks serialize deactivation/revocation and a final decision-clock check
 * closes expiry during domain lock waits. Unknown sessions remain guests. */
export async function member(q:PoolClient,token:string|undefined,create=false,expected?:CheckoutBuyerIdentity,beforeEffects?:()=>Promise<unknown>) {
  if(!token){assertBuyerIdentity(expected,null);await beforeEffects?.();return null;}
  const sessionHash=hashKey(token);
  const row=(await q.query<{user_id:string;principal_id:string|null;principal_exists:boolean}>(`SELECT u.user_id,p.principal_id,
    EXISTS(SELECT 1 FROM principals existing WHERE existing.user_ref=u.user_id AND existing.kind='person') AS principal_exists
    FROM sessions s JOIN users u USING(user_id)
    LEFT JOIN principals p ON p.user_ref=u.user_id AND p.kind='person' AND p.status='active'
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.active ${create?'FOR SHARE OF u,s':''}`,[sessionHash])).rows[0];
  assertBuyerIdentity(expected,row?{userId:row.user_id}:null);
  await beforeEffects?.();
  if(!row)return null;
  const mapped=!row.principal_id&&create?await mapPersonPrincipal(q,row.user_id):null;
  const principalId=row.principal_id??(mapped?.status==='active'&&mapped.kind==='person'?mapped.principal_id:null);
  // A first-time buyer has a valid member session before foundation mapping.
  // Quotes stay read-only; checkout creates that mapping under its write locks.
  // A disabled existing principal must not be treated as a new member.
  return {principalId,sessionHash,userId:row.user_id,offlineEligible:principalId!==null||!row.principal_exists};
}
export async function currentMember(q:PoolClient,identity:Awaited<ReturnType<typeof member>>) {
  if(identity&&(await q.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[identity.sessionHash,identity.userId])).rowCount!==1)orderAccessNotFound();
}

/** One connection avoids pool starvation under concurrent fenced requests.
 * Commit accepted attempt budgets even when the command is rejected, as the
 * legacy independent budget transaction does. Only command effects roll back.
 * Identity mismatches and rejected budgets occur before the savepoint and
 * roll back the entire transaction. Session locks precede the savepoint. */
export async function fencedBuyerTransaction<T>(pool:Pool,token:string|undefined,expected:CheckoutBuyerIdentity,create:boolean,
  charge:(q:PoolClient)=>Promise<unknown>,run:(q:PoolClient,identity:Awaited<ReturnType<typeof member>>)=>Promise<T>):Promise<T> {
  const result=await isolatedTransaction(pool,async q=>{
    let charged=false;
    try {
      const identity=await member(q,token,create,expected,async()=>{
        await charge(q);
        await q.query('SAVEPOINT checkout_buyer_effects');
        charged=true;
      });
      return {ok:true as const,value:await run(q,identity)};
    } catch(error) {
      if(!charged)throw error;
      await q.query('ROLLBACK TO SAVEPOINT checkout_buyer_effects');
      return {ok:false as const,error};
    }
  });
  if(!result.ok)throw result.error;
  return result.value;
}
