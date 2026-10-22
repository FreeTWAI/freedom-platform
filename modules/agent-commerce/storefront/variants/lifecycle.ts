import type {PoolClient} from 'pg';
import type {TenantScopeContext} from '../../../../packages/resource-scopes/index.js';
import {storeFact,type Profile} from '../../hosted/store.js';
/** Retained home/gallery rows outlive item deletion. Catalog identity and all
 * remaining members survive, including deletion of the original anchor. */
export async function detachRemovedVariant(q:PoolClient,c:TenantScopeContext,p:Profile,productId:string){
 const member=(await q.query('SELECT * FROM commerce_product_group_members WHERE tenant_id=$1 AND instance_id=$2 AND product_id=$3 FOR UPDATE',[p.tenant_id,p.instance_id,productId])).rows[0];if(!member?.catalog_group_id)return;
 const g=(await q.query('SELECT * FROM commerce_product_groups WHERE tenant_id=$1 AND instance_id=$2 AND group_id=$3 FOR UPDATE',[p.tenant_id,p.instance_id,member.catalog_group_id])).rows[0];
 await q.query(`UPDATE commerce_product_group_members SET catalog_group_id=NULL,option_value_keys='{}',sort_order=0,membership_version=membership_version+1 WHERE tenant_id=$1 AND instance_id=$2 AND catalog_group_id=$3
  AND (product_id=$4 OR NOT EXISTS(SELECT 1 FROM commerce_selections s WHERE s.selection_id=commerce_product_group_members.selection_id AND s.shop_id=$5 AND s.own_retail_enabled))`,[p.tenant_id,p.instance_id,g.group_id,productId,p.storefront_shop_id]);
 const remaining=(await q.query(`SELECT m.selection_id FROM commerce_product_group_members m JOIN commerce_selections s ON s.selection_id=m.selection_id AND s.shop_id=$4 AND s.own_retail_enabled
  WHERE m.tenant_id=$1 AND m.instance_id=$2 AND m.catalog_group_id=$3 ORDER BY m.sort_order,m.selection_id`,[p.tenant_id,p.instance_id,g.group_id,p.storefront_shop_id])).rows;
 const selected=remaining.find(m=>m.selection_id===g.default_selection_id)??remaining[0],next=String(BigInt(g.version)+1n);
 await q.query('UPDATE commerce_product_groups SET default_selection_id=$4,version=$5 WHERE tenant_id=$1 AND instance_id=$2 AND group_id=$3',[p.tenant_id,p.instance_id,g.group_id,selected?.selection_id??null,next]);
 await storeFact(q,c,g.group_id,next,'storefront.product.remove','storefront_product_group');
}
