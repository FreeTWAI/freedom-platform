import {randomUUID} from 'node:crypto';
import {digest} from '../../packages/db/index.js';
import type {PoolClient} from 'pg';

export const legalTables=['commerce_storefront_seller_versions','commerce_storefront_policy_versions','commerce_storefront_seller_drafts','commerce_storefront_policy_drafts','commerce_publication_seller_policies','commerce_publication_policy_refs'] as const;
export const syntheticSeller={business_name:'合成測試商行',email:'seller@example.test',phone:'+886-2-0000-0000',address:'測試市範例路 1 號',service_hours:'週一至週五 09:00–17:00',tax_id:String(0).padStart(8,'0'),responsible_person:'合成負責人'};
export const legalHash=digest;
/** Owner-only fixture. All cross-tenant FKs, immutable triggers and sequence checks stay active. */
export async function seedSellerPolicyRows(q:PoolClient,input:{tenantId:string;instanceId:string}){
 const {tenantId:t,instanceId:i}=input;
 const p=(await q.query('SELECT * FROM commerce_storefront_profiles WHERE tenant_id=$1 AND instance_id=$2 FOR UPDATE',[t,i])).rows[0];
 if(!p?.current_publication_id)throw Error('Published retail fixture required');
 const sellerId=randomUUID(),sellerHash=legalHash(syntheticSeller),policyIds:Record<string,string>={};
 await q.query(`INSERT INTO commerce_storefront_seller_versions(version_id,tenant_id,instance_id,version_no,created_at_profile_version,
 business_name,email,phone,address,service_hours,tax_id,responsible_person,content_sha256) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
 [sellerId,t,i,p.version,...Object.values(syntheticSeller),sellerHash]);
 await q.query('INSERT INTO commerce_storefront_seller_drafts(tenant_id,instance_id,version_id) VALUES($1,$2,$3)',[t,i,sellerId]);
 const refs:Record<string,{version_id:string;sha256:string}>={};
 for(const kind of ['shipping','returns','privacy','terms']){
  const id=randomUUID(),body='合成'+kind+'政策\n第二行\n\n下一段',sha=legalHash(kind==='returns'?{kind,body,window_days:7,return_by_days:14}:kind==='privacy'?{kind,body,drop_ship_disclosed:true}:{kind,body});policyIds[kind]=id;refs[kind]={version_id:id,sha256:sha};
  await q.query(`INSERT INTO commerce_storefront_policy_versions(version_id,tenant_id,instance_id,kind,version_no,created_at_profile_version,body,window_days,return_by_days,drop_ship_disclosed,content_sha256)
   VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10)`,[id,t,i,kind,p.version,body,kind==='returns'?7:null,kind==='returns'?14:null,kind==='privacy'?true:null,sha]);
  await q.query('INSERT INTO commerce_storefront_policy_drafts(tenant_id,instance_id,kind,version_id) VALUES($1,$2,$3,$4)',[t,i,kind,id]);
 }
 const document={profile:'freedom.hosted-store-policies/v1',seller:{version_id:sellerId,sha256:sellerHash},policies:refs};
 await q.query(`INSERT INTO commerce_publication_seller_policies(publication_id,tenant_id,instance_id,seller_version_id,document,policies_sha256) VALUES($1,$2,$3,$4,$5,$6)`,[p.current_publication_id,t,i,sellerId,document,legalHash(document)]);
 for(const [kind,id] of Object.entries(policyIds))await q.query('INSERT INTO commerce_publication_policy_refs(publication_id,tenant_id,instance_id,kind,version_id) VALUES($1,$2,$3,$4,$5)',[p.current_publication_id,t,i,kind,id]);
 return {sellerId,policyIds,document,profile:p};
}
