import type {PoolClient} from 'pg';
import type {ShippingQuoteLine} from '../../checkout/terms.js';
/** One bounded participant-RLS read for the entire quote; contacts are never read. */
export async function dropShipCoverage(q:PoolClient,instanceId:string,lines:readonly ShippingQuoteLine[],enabled:boolean):Promise<ShippingQuoteLine[]> {
  if(lines.every(l=>l.fulfilment_resolved))return [...lines];
  const ids=lines.filter(l=>!l.own&&l.selection_id).map(l=>l.selection_id!);
  const rows=enabled&&ids.length?(await q.query(`SELECT ai.selection_id,a.agreement_id,a.version::text AS version,a.supplier_shop_id AS executor_shop_id,a.supplier_instance_id,
    a.fee_per_order_minor::float8,a.promise_working_days,a.terms_sha256,s.name AS supplier_name,(o.terms->>'cost_minor')::float8 AS unit_supply_cost_minor
    FROM commerce_fulfilment_agreements a JOIN commerce_fulfilment_agreement_items ai USING(agreement_id)
    JOIN commerce_selections l ON l.selection_id=ai.selection_id AND l.item_id=ai.item_id AND l.shop_id=a.store_shop_id
    JOIN commerce_hosted_supply_offers o ON o.offer_id=l.hosted_offer_id AND o.item_id=ai.item_id AND o.instance_id=a.supplier_instance_id
    JOIN commerce_shops s ON s.shop_id=a.supplier_shop_id
    WHERE a.instance_id=$1 AND a.state='accepted' AND ai.state='accepted' AND ai.selection_id=ANY($2::uuid[]) AND l.acceptance_state='sellable'`,[instanceId,ids])).rows:[];
  return lines.map(line=>{
    const row=rows.find(r=>r.selection_id===line.selection_id);
    const {selection_id,...coverage}=row??{};
    return {...line,fulfilment_resolved:true,drop_ship:line.own||!row?null:coverage as NonNullable<ShippingQuoteLine['drop_ship']>};
  });
}
