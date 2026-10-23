import type {ShippingQuoteLine} from '../../checkout/terms.js';
import {meetupLines,meetupQuote} from './meetup.js';

/** No provider, item dimensions or ship-from address are needed for seller shipping. */
export function selfShipQuote(input:{lines:readonly ShippingQuoteLine[];sellerShopId:string;profileVersion:string;fee:number;handlingDays:number;note:string|null;outlying:boolean}) {
  const consent=meetupQuote({lines:meetupLines(input.lines),sellerShopId:input.sellerShopId,profileVersion:input.profileVersion,note:'self_ship'});
  if(consent.kind==='unavailable')return consent;
  if(input.outlying)return {kind:'unavailable' as const,lines:input.lines.map(line=>({sku:line.sku,reason:'outlying_unsupported' as const}))};
  return {kind:'plan' as const,group:{...consent.group,method_ref:'self_ship' as const,meetup:null,
    self_ship:{service_key:'seller.self_ship.v1' as const,fee_basis:'order' as const,handling_days:input.handlingDays,working_days:[1,2,3,4,5] as [1,2,3,4,5],note:input.note},
    fee_per_parcel_minor:input.fee,amount_minor:input.fee}};
}
