/** Standing consent carries no ECPay services. Price acceptance alone is insufficient. */
export interface HostedDropShipCoverage {
  agreement_id:string;version:string;executor_shop_id:string;supplier_instance_id:string;
  fee_per_order_minor:number;promise_working_days:number;terms_sha256:string;supplier_name:string;unit_supply_cost_minor:number;
}
export const hostedLineFulfilment = (own:boolean,agreement?:HostedDropShipCoverage|null,enabled=false) => own?{kind:'self' as const}:
  enabled&&agreement?{kind:'drop_ship' as const,manual_only:true as const,agreement_id:agreement.agreement_id,agreement_version:agreement.version,executor_shop_id:agreement.executor_shop_id,service_keys:[] as const}:{kind:'not_agreed' as const};
export const fulfilmentConsentFailure = (fulfilment:{kind:string}) => fulfilment.kind==='not_agreed'?'fulfilment_not_agreed' as const:null;
export function singleShipperFailure(lines:readonly {sku:string;own:boolean;drop_ship?:HostedDropShipCoverage|null}[]) {
  const uncovered=lines.filter(l=>!l.own&&!l.drop_ship);
  if(uncovered.length)return uncovered.map(l=>({sku:l.sku,reason:'fulfilment_not_agreed' as const}));
  const shippers=new Set(lines.map(l=>l.own?'self':`${l.drop_ship!.agreement_id}/${l.drop_ship!.version}`));
  return shippers.size>1?lines.map(l=>({sku:l.sku,reason:'fulfilment_mixed_shippers' as const})):[];
}
