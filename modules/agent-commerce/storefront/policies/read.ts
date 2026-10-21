import type {Pool} from 'pg';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {PolicyVersionReadSchema,PolicyKindSchema,type PolicyKind} from '../../../../contracts/guild-launchpad/v1/storefront-policies.js';
import {isolatedTransaction} from '../../../../packages/resource-scopes/tenant-transaction.js';
import type {Actor} from '../../../identity-membership/service.js';
import {resolvePublicStorePage} from '../../hosted/public.js';
import {storeRead,profile,retailReady} from '../../hosted/store.js';
import {draftAppearanceSnapshot,renderAppearance,type AppearanceOptions} from '../../hosted/appearance.js';
import {draftLegalSnapshot,renderDraftLegal,policyFromRow} from './model.js';
import {aboutHtml,policyHtml} from './pages.js';

export async function publicLegalPage(pool:Pool,slug:string,appearance:AppearanceOptions={},rawKind?:string,rawVersion?:string){return isolatedTransaction(pool,async q=>{
 await q.query('SET TRANSACTION READ ONLY');const store=await resolvePublicStorePage(q,slug,appearance,{enabled:true});if(!store?.policies)return null;
 const heading={...store.projection,appearance:store.appearance,policies:store.policies};
 if(rawKind===undefined)return aboutHtml(heading);
 const parsed=PolicyKindSchema.safeParse(rawKind);if(!parsed.success||rawVersion!==undefined&&!OpaqueId.safeParse(rawVersion).success)return null;const kind=parsed.data;
 // Existence is proved by this live store's publication references, never by
 // a global version lookup. Unpublished, foreign and wrong-kind IDs share 404.
 const row=(await q.query(`SELECT v.*,min(pub.published_at) AS first_published_at,
 bool_or(pub.publication_id=$4) AS current FROM commerce_publication_policy_refs r
 JOIN commerce_storefront_policy_versions v ON v.version_id=r.version_id AND v.tenant_id=r.tenant_id AND v.instance_id=r.instance_id AND v.kind=r.kind
 JOIN commerce_storefront_publications pub ON pub.publication_id=r.publication_id AND pub.tenant_id=r.tenant_id AND pub.instance_id=r.instance_id
 WHERE r.tenant_id=$1 AND r.instance_id=$2 AND r.kind=$3 ${rawVersion!==undefined?'AND r.version_id=$5':'AND r.version_id=(SELECT version_id FROM commerce_publication_policy_refs WHERE publication_id=$4 AND tenant_id=$1 AND instance_id=$2 AND kind=$3)'} AND v.body<>''
 GROUP BY v.version_id`,[store.tenantId,store.instanceId,kind,store.publicationId,...(rawVersion!==undefined?[rawVersion]:[])])).rows[0];
 if(!row)return null;
 return policyHtml(heading,kind,PolicyVersionReadSchema.parse({version_id:row.version_id,policy:policyFromRow(row),first_published_at:row.first_published_at.toISOString(),current:row.current}));
});}
export async function previewLegalPage(pool:Pool,actor:Actor,t:string,i:string,appearance:AppearanceOptions={},kind?:PolicyKind){return storeRead(pool,actor,t,i,'store:read',async q=>{
 await q.query('SELECT 1 FROM commerce_storefront_profiles WHERE tenant_id=$1 AND instance_id=$2 FOR SHARE',[t,i]);const p=await profile(q,t,i);retailReady(p);
 const draft=await draftLegalSnapshot(q,p),base=`/api/v1/tenants/${t}/storefronts/${i}/preview-page`,policies=renderDraftLegal(draft.input,base);
 const heading={slug:p.slug,name:p.name,description:p.description,policies,appearance:appearance.enabled===true?renderAppearance((await draftAppearanceSnapshot(q,p)).document,{tenantId:t,instanceId:i,version:p.version},appearance.mediaInstalled===true):undefined};
 if(kind===undefined)return aboutHtml(heading,true);const policy=policies.policies[kind];return policy?policyHtml(heading,kind,{policy},true):null;
});}
