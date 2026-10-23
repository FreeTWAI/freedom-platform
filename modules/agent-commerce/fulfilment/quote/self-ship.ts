import type {ShippingQuoteLine} from '../../checkout/terms.js';
import {singleShipperFailure} from '../rules/consent.js';
/** Whole-order manual shipping uses the store's postage and the frozen supplier promise. */
export function selfShipQuote(input:{lines:readonly ShippingQuoteLine[];sellerShopId:string;profileVersion:string;fee:number;handlingDays:number;note:string|null;outlying:boolean}) {
  const failures=singleShipperFailure(input.lines);
  if(failures.length)return {kind:'unavailable' as const,lines:failures};
  if(input.outlying)return {kind:'unavailable' as const,lines:input.lines.map(line=>({sku:line.sku,reason:'outlying_unsupported' as const}))};
  const lines=[...input.lines].sort((a,b)=>a.sku.localeCompare(b.sku)),agreement=lines[0]?.drop_ship;
  if(!lines.length)throw new Error('shipping_quote_invalid');
  const declared=lines.reduce((n,l)=>n+l.unit_price_minor*l.quantity,0);
  if(!Number.isSafeInteger(declared))throw new Error('shipping_quote_invalid');
  const drop_ship=agreement?{supplier_name:agreement.supplier_name,fee_per_order_minor:agreement.fee_per_order_minor,promise_working_days:agreement.promise_working_days,terms_sha256:agreement.terms_sha256,
    supply_cost_minor:lines.reduce((n,l)=>n+l.drop_ship!.unit_supply_cost_minor*l.quantity,0),items:lines.map(l=>({sku:l.sku,selection_id:l.selection_id!,unit_supply_cost_minor:l.drop_ship!.unit_supply_cost_minor}))}:undefined;
  return {kind:'plan' as const,group:{group_ref:'g1',supplier_shop_id:agreement?.executor_shop_id??input.sellerShopId,method_ref:'self_ship' as const,
    fulfilment_mode:agreement?'drop_ship' as const:'self' as const,agreement:agreement?{agreement_id:agreement.agreement_id,version:agreement.version}:null,
    profile_version:input.profileVersion,logistics:null,meetup:null,
    self_ship:{service_key:'seller.self_ship.v1' as const,fee_basis:'order' as const,handling_days:agreement?.promise_working_days??input.handlingDays,working_days:[1,2,3,4,5] as [1,2,3,4,5],note:input.note},
    ...(drop_ship?{drop_ship}:{}),parcels:[{parcel_ref:'g1-p1',lines:lines.map(l=>({sku:l.sku,quantity:l.quantity})),weight_g:null,declared_value_minor:declared}],
    attribute_versions:[],fee_per_parcel_minor:input.fee,outlying_surcharge_per_parcel_minor:0,amount_minor:input.fee}};
}
