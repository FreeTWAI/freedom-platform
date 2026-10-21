import {isolatedTransaction} from '../../packages/resource-scopes/tenant-transaction.js';
import {assertCurrentSessionClock} from '../../packages/db/member-session.js';
import {lockTenantScope,type TenantScopeContext} from '../../packages/resource-scopes/index.js';
import {scopedJournal,scopedTenantCommand} from '../../packages/scoped-commands/index.js';
import {storeCapabilities} from '../agent-commerce/hosted/capabilities.js';
import {lockStorefrontAppearanceBoundary} from '../agent-commerce/hosted/appearance-authority.js';
import type {StorefrontPhotoActor} from '../agent-commerce/hosted/photo-authority.js';
import type {LifecycleAuthority} from './lifecycle-authority.js';

const authorities=new WeakSet<object>();
/** Only this branded port admits the two store:manage appearance kinds. */
export function createStorefrontAppearanceLifecycleAuthority():LifecycleAuthority<StorefrontPhotoActor,TenantScopeContext>{
  const authority:LifecycleAuthority<StorefrontPhotoActor,TenantScopeContext>={
    snapshot:actor=>Object.freeze({...actor}),
    async read(pool,input,authorize,run){
      return isolatedTransaction(pool,async q=>{
        const context=await lockTenantScope(q,{actor:input.actor,tenantId:input.actor.tenant_id,forUpdate:false,
          lockUser:input.lockUser,capabilitiesForRole:storeCapabilities});
        await lockStorefrontAppearanceBoundary(q,context,input.actor);await authorize(q,context);return run(q,context);
      });
    },
    async command(pool,input,authorize,run,revalidate,assertCurrentTime){
      return scopedTenantCommand(pool,{actor:input.actor,tenantId:input.actor.tenant_id,operation:input.operation,key:input.key,
        body:input.body,target:input.target,expected:input.expected,lockUser:input.lockUser,tenantLock:'share',capabilitiesForRole:storeCapabilities},
      async(q,c)=>{await lockStorefrontAppearanceBoundary(q,c,input.actor);await authorize(q,c);},run,
      async(q,c)=>{await lockStorefrontAppearanceBoundary(q,c,input.actor);if(revalidate)await revalidate(q,c);},assertCurrentTime);
    },
    clock:(q,actor)=>assertCurrentSessionClock(q,actor),communityId:actor=>actor.community_id,journal:scopedJournal,
  };
  const frozen=Object.freeze(authority);authorities.add(frozen);return frozen;
}
export function isStorefrontAppearanceLifecycleAuthority(value:object){return authorities.has(value);}
