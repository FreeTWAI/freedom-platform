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
export async function member(q:PoolClient,token:string|undefined,create=false,expected?:CheckoutBuyerIdentity) {
  if(!token){assertBuyerIdentity(expected,null);return null;}
  const sessionHash=hashKey(token);
  const row=(await q.query<{user_id:string;principal_id:string|null;principal_exists:boolean}>(`SELECT u.user_id,p.principal_id,
    EXISTS(SELECT 1 FROM principals existing WHERE existing.user_ref=u.user_id AND existing.kind='person') AS principal_exists
    FROM sessions s JOIN users u USING(user_id)
    LEFT JOIN principals p ON p.user_ref=u.user_id AND p.kind='person' AND p.status='active'
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.active ${create?'FOR SHARE OF u,s':''}`,[sessionHash])).rows[0];
  assertBuyerIdentity(expected,row?{userId:row.user_id}:null);
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

/** Reject stale callers before charging budgets. Always read-only and released
 * before the independent budget and command transactions acquire connections. */
export async function precheckBuyerIdentity(pool:Pool,token:string|undefined,expected:CheckoutBuyerIdentity|undefined) {
  if(expected===undefined)return;
  await isolatedTransaction(pool,async q=>{
    await q.query('SET TRANSACTION READ ONLY');
    await member(q,token,false,expected);
  });
}
