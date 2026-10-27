import {POLICY_KINDS,POLICY_LABELS,type PolicyKind} from '../../../../contracts/guild-launchpad/v1/storefront-policies.js';
import type {CheckoutPolicyPort} from '../../checkout/terms.js';
import {policyFromRow} from './model.js';

/** The caller has resolved and bound this store; drafts and historical refs are never requirements. */
export const storefrontCheckoutPolicies:CheckoutPolicyPort={async required(q,store){
 if(!store.current_publication_id)return [];
 const rows=(await q.query(`SELECT v.* FROM commerce_publication_policy_refs r
 JOIN commerce_storefront_policy_versions v ON v.version_id=r.version_id AND v.tenant_id=r.tenant_id AND v.instance_id=r.instance_id AND v.kind=r.kind
 WHERE r.publication_id=$1 AND r.tenant_id=$2 AND r.instance_id=$3 AND v.body<>''`,[store.current_publication_id,store.tenant_id,store.instance_id])).rows;
 const policies=new Map(rows.map(row=>[row.kind as PolicyKind,{row,policy:policyFromRow(row)}]));
 return POLICY_KINDS.flatMap(kind=>{const entry=policies.get(kind);return entry?.policy.body?[{policy_kind:`storefront.${kind}`,policy_version_id:entry.row.version_id as string,label:POLICY_LABELS[kind],url:`/shops/${encodeURIComponent(store.slug!)}/policies/${kind}`}]:[];});
}};
