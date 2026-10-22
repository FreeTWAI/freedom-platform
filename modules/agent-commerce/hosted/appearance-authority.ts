import type {PoolClient} from 'pg';
import {OpaqueId} from '../../../contracts/common/v1/identity.js';
import {assertCurrentSessionClock} from '../../../packages/db/member-session.js';
import type {TenantScopeContext} from '../../../packages/resource-scopes/index.js';
import {requireCondition} from '../../../packages/shared/problem.js';
import {requireStoreInstance} from './capabilities.js';
import {instance,profile,retailReady} from './store.js';
import type {StorefrontPhotoActor} from './photo-authority.js';

/** Management authority is distinct from the product-photo store:write port.
 * Preserve instance/deployment -> commerce -> profile -> policy/target order. */
export async function lockStorefrontAppearanceBoundary(q:PoolClient,context:TenantScopeContext,actor:StorefrontPhotoActor){
  const tenantId=OpaqueId.parse(actor.tenant_id),instanceId=OpaqueId.parse(actor.instance_id);
  requireCondition(context.tenant_id===tenantId,404,'not_found','找不到這間商店。');
  await requireStoreInstance(q,context,instanceId,'store:manage',true);await instance(q,tenantId,instanceId,true);
  await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`commerce-orders/${context.community_id}`]);
  const p=await profile(q,tenantId,instanceId,true);retailReady(p);await assertCurrentSessionClock(q,actor);return p;
}
