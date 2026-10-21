import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {checkVersion,digest} from '../../../../packages/db/index.js';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import {SellerPoliciesWireSchema,SellerPoliciesInputSchema,SellerPoliciesAckSchema,STOREFRONT_POLICIES_PROFILE,POLICY_KINDS,normalizeSellerPolicies} from '../../../../contracts/guild-launchpad/v1/storefront-policies.js';
import type {Actor} from '../../../identity-membership/service.js';
import {profile,retailReady,storeCommand,storeRead,storeFact} from '../../hosted/store.js';
import {draftLegalSnapshot,legalDraftView} from './model.js';

export class SellerPoliciesFieldProblem extends Problem{
 constructor(public fields:{field:string;message:string}[]){super(422,'seller_policies_invalid','請檢查賣方資訊與商店政策的欄位。');}
}
export function snapshotLegalWire(raw:unknown){const p=SellerPoliciesWireSchema.safeParse(raw);requireCondition(p.success,422,'seller_policies_invalid','賣方資訊與商店政策格式無效或超出長度上限。');return p.data;}
export async function readSellerPolicies(pool:Pool,actor:Actor,t:string,i:string){return storeRead(pool,actor,t,i,'store:read',async q=>{
 await q.query('SELECT 1 FROM commerce_storefront_profiles WHERE tenant_id=$1 AND instance_id=$2 FOR SHARE',[t,i]);const p=await profile(q,t,i);retailReady(p);return legalDraftView(q,p);
});}
export async function saveSellerPolicies(pool:Pool,actor:Actor,t:string,i:string,raw:unknown,key:string,expected:string){
 const wire=snapshotLegalWire(raw);
 let completion:{completed_version:string;changed:boolean};
 try{completion=await storeCommand(pool,actor,t,i,'store:manage','storefront.seller-policies.save',wire,key,expected,async(q,c)=>{
  const p=await profile(q,t,i,true);retailReady(p);checkVersion(p.version,expected);
  const parsed=SellerPoliciesInputSchema.safeParse(normalizeSellerPolicies(wire));
  if(!parsed.success)throw new SellerPoliciesFieldProblem(parsed.error.issues.map(issue=>({field:issue.path.join('.'),message:issue.message})).filter(issue=>/^(seller\.(business_name|email|phone|address|service_hours|tax_id|responsible_person)|policies\.(shipping|returns|privacy|terms)(\.(body|window_days|return_by_days|drop_ship_disclosed|kind))?)$/.test(issue.field)));
  const input=parsed.data,draft=await draftLegalSnapshot(q,p),sellerChanged=digest(input.seller)!==digest(draft.input.seller),changedKinds=POLICY_KINDS.filter(k=>digest(input.policies[k])!==digest(draft.input.policies[k]));
  if(!sellerChanged&&!changedKinds.length)return {completed_version:p.version,changed:false};
  const next=String(BigInt(p.version)+1n);await q.query('UPDATE commerce_storefront_profiles SET version=version+1,updated_at=clock_timestamp() WHERE tenant_id=$1 AND instance_id=$2',[t,i]);
  if(sellerChanged){const s=input.seller,id=randomUUID();await q.query(`INSERT INTO commerce_storefront_seller_versions(version_id,tenant_id,instance_id,version_no,created_at_profile_version,business_name,email,phone,address,service_hours,tax_id,responsible_person,content_sha256)
   SELECT $1,$2,$3,COALESCE(max(version_no),0)+1,$4,$5,$6,$7,$8,$9,$10,$11,$12 FROM commerce_storefront_seller_versions WHERE tenant_id=$2 AND instance_id=$3`,[id,t,i,next,s.business_name,s.email,s.phone,s.address,s.service_hours,s.tax_id,s.responsible_person,digest(s)]);
   await q.query('INSERT INTO commerce_storefront_seller_drafts(tenant_id,instance_id,version_id) VALUES($1,$2,$3) ON CONFLICT(tenant_id,instance_id) DO UPDATE SET version_id=EXCLUDED.version_id',[t,i,id]);}
  for(const kind of changedKinds){const policy=input.policies[kind],id=randomUUID();await q.query(`INSERT INTO commerce_storefront_policy_versions(version_id,tenant_id,instance_id,kind,version_no,created_at_profile_version,body,window_days,return_by_days,drop_ship_disclosed,content_sha256)
   SELECT $1,$2,$3,$4,COALESCE(max(version_no),0)+1,$5,$6,$7,$8,$9,$10 FROM commerce_storefront_policy_versions WHERE tenant_id=$2 AND instance_id=$3 AND kind=$4`,[id,t,i,kind,next,policy.body,policy.kind==='returns'?policy.window_days:null,policy.kind==='returns'?policy.return_by_days:null,policy.kind==='privacy'?policy.drop_ship_disclosed:null,digest(policy)]);
   await q.query('INSERT INTO commerce_storefront_policy_drafts(tenant_id,instance_id,kind,version_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,instance_id,kind) DO UPDATE SET version_id=EXCLUDED.version_id',[t,i,kind,id]);}
  await storeFact(q,c,i,next,'storefront.seller-policies.save');return {completed_version:next,changed:true};
 });}catch(e){const x=e as {code?:string;constraint?:string};if(x.code==='23514'&&['seller_policies_seller_version_limit','seller_policies_policy_version_limit'].includes(x.constraint??''))throw new Problem(409,'seller_policies_version_limit','賣方資訊與商店政策的版本已達上限（每項 500 個），請聯絡平台協助。');throw e;}
 // Receipts retain completion metadata only. Replays re-authorize and read the
 // current draft; no seller text, policy body, or stale PII enters a receipt.
 return SellerPoliciesAckSchema.parse({profile:STOREFRONT_POLICIES_PROFILE,...completion,current:await readSellerPolicies(pool,actor,t,i)});
}
