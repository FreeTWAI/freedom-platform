import type {PoolClient} from 'pg';
import {digest} from '../../../../packages/db/index.js';
import {Problem} from '../../../../packages/shared/problem.js';
import {PublicationSellerPoliciesSchema,SellerPoliciesInputSchema,SellerPoliciesDraftSchema,emptySellerPolicies,POLICY_KINDS,STOREFRONT_POLICIES_PROFILE,type PublicationSellerPolicies,type SellerPoliciesInput,type PolicyDraft,type SellerDraft} from '../../../../contracts/guild-launchpad/v1/storefront-policies.js';
import type {Profile} from '../../hosted/store.js';

export interface PoliciesOptions{enabled?:boolean}
export interface RenderPolicies{seller:SellerDraft;policies:Partial<Record<PolicyDraft['kind'],PolicyDraft>>;previewBase?:string}
export const emptyLegalDocument=():PublicationSellerPolicies=>({profile:STOREFRONT_POLICIES_PROFILE,seller:null,policies:{shipping:null,returns:null,privacy:null,terms:null}});
export function legalSnapshot(raw:unknown){const document=PublicationSellerPoliciesSchema.parse(raw);return {document,sha256:digest(document)};}
export function policyFromRow(r:Record<string,any>):PolicyDraft{
 const base={kind:r.kind,body:r.body},policy=SellerPoliciesInputSchema.shape.policies.shape[r.kind as PolicyDraft['kind']].parse(r.kind==='returns'?{...base,window_days:r.window_days,return_by_days:r.return_by_days}:r.kind==='privacy'?{...base,drop_ship_disclosed:r.drop_ship_disclosed}:base);
 if(digest(policy)!==r.content_sha256)throw new Problem(500,'seller_policies_invalid','賣方資訊與商店政策暫時無法讀取。');return policy;
}
export function sellerFromRow(r:Record<string,any>):SellerDraft{
 const seller=SellerPoliciesInputSchema.shape.seller.parse(Object.fromEntries(Object.keys(emptySellerPolicies().seller).map(k=>[k,r[k]])));
 if(digest(seller)!==r.content_sha256)throw new Problem(500,'seller_policies_invalid','賣方資訊與商店政策暫時無法讀取。');return seller;
}
export async function draftLegalSnapshot(q:PoolClient,p:Profile){
 const document=emptyLegalDocument(),input=emptySellerPolicies();
 const seller=(await q.query(`SELECT v.* FROM commerce_storefront_seller_drafts d JOIN commerce_storefront_seller_versions v
 ON v.version_id=d.version_id AND v.tenant_id=d.tenant_id AND v.instance_id=d.instance_id WHERE d.tenant_id=$1 AND d.instance_id=$2`,[p.tenant_id,p.instance_id])).rows[0];
 if(seller){input.seller=sellerFromRow(seller);document.seller={version_id:seller.version_id,sha256:seller.content_sha256};}
 const policies=(await q.query(`SELECT v.* FROM commerce_storefront_policy_drafts d JOIN commerce_storefront_policy_versions v
 ON v.version_id=d.version_id AND v.tenant_id=d.tenant_id AND v.instance_id=d.instance_id AND v.kind=d.kind WHERE d.tenant_id=$1 AND d.instance_id=$2`,[p.tenant_id,p.instance_id])).rows;
 for(const r of policies){const k=r.kind as PolicyDraft['kind'];Object.assign(input.policies,{[k]:policyFromRow(r)});document.policies[k]={version_id:r.version_id,sha256:r.content_sha256};}
 return {...legalSnapshot(document),input};
}
export async function publicationLegalSnapshot(q:PoolClient,id:string,t:string,i:string){
 const row=(await q.query('SELECT document,policies_sha256 FROM commerce_publication_seller_policies WHERE publication_id=$1 AND tenant_id=$2 AND instance_id=$3',[id,t,i])).rows[0];
 if(!row)return null;const snapshot=legalSnapshot(row.document);
 if(snapshot.sha256!==row.policies_sha256)throw new Problem(500,'seller_policies_invalid','賣方資訊與商店政策暫時無法讀取。');return snapshot;
}
export async function publishedLegalDigest(q:PoolClient,p:Profile){return p.current_publication_id?(await publicationLegalSnapshot(q,p.current_publication_id,p.tenant_id,p.instance_id))?.sha256??legalSnapshot(emptyLegalDocument()).sha256:legalSnapshot(emptyLegalDocument()).sha256;}
export async function insertPublicationLegal(q:PoolClient,id:string,p:Profile,s:ReturnType<typeof legalSnapshot>){
 await q.query('INSERT INTO commerce_publication_seller_policies(publication_id,tenant_id,instance_id,seller_version_id,document,policies_sha256) VALUES($1,$2,$3,$4,$5,$6)',[id,p.tenant_id,p.instance_id,s.document.seller?.version_id??null,s.document,s.sha256]);
 for(const kind of POLICY_KINDS){const r=s.document.policies[kind];if(r)await q.query('INSERT INTO commerce_publication_policy_refs(publication_id,tenant_id,instance_id,kind,version_id) VALUES($1,$2,$3,$4,$5)',[id,p.tenant_id,p.instance_id,kind,r.version_id]);}
}
export function renderDraftLegal(input:SellerPoliciesInput,previewBase?:string):RenderPolicies{return {seller:input.seller,policies:Object.fromEntries(POLICY_KINDS.filter(k=>input.policies[k].body).map(k=>[k,input.policies[k]])),...(previewBase?{previewBase}:{})};}
export async function renderPublicationLegal(q:PoolClient,id:string,t:string,i:string):Promise<RenderPolicies|undefined>{
 const snap=await publicationLegalSnapshot(q,id,t,i);if(!snap)return undefined;const input=emptySellerPolicies();
 if(snap.document.seller){const row=(await q.query('SELECT * FROM commerce_storefront_seller_versions WHERE version_id=$1 AND tenant_id=$2 AND instance_id=$3',[snap.document.seller.version_id,t,i])).rows[0];if(!row||row.content_sha256!==snap.document.seller.sha256)throw new Problem(500,'seller_policies_invalid','賣方資訊與商店政策暫時無法讀取。');input.seller=sellerFromRow(row);}
 for(const kind of POLICY_KINDS){const ref=snap.document.policies[kind];if(!ref)continue;const row=(await q.query(`SELECT v.* FROM commerce_publication_policy_refs r JOIN commerce_storefront_policy_versions v ON v.version_id=r.version_id AND v.tenant_id=r.tenant_id AND v.instance_id=r.instance_id AND v.kind=r.kind WHERE r.publication_id=$1 AND r.tenant_id=$2 AND r.instance_id=$3 AND r.kind=$4 AND r.version_id=$5`,[id,t,i,kind,ref.version_id])).rows[0];if(!row||row.content_sha256!==ref.sha256)throw new Problem(500,'seller_policies_invalid','賣方資訊與商店政策暫時無法讀取。');Object.assign(input.policies,{[kind]:policyFromRow(row)});}
 return renderDraftLegal(input);
}
export async function legalDraftView(q:PoolClient,p:Profile){
 const draft=await draftLegalSnapshot(q,p),supplied=(await q.query('SELECT EXISTS(SELECT 1 FROM commerce_selections WHERE shop_id=$1 AND hosted_offer_id IS NOT NULL) AS present',[p.storefront_shop_id])).rows[0].present;
 return SellerPoliciesDraftSchema.parse({profile:STOREFRONT_POLICIES_PROFILE,version:p.version,...draft.input,dirty:draft.sha256!==await publishedLegalDigest(q,p),has_supplied_products:supplied});
}
