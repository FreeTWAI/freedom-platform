import {parseMajorToMinor} from '../../../apps/portal-web/src/format';
import {SupplyTermsInputSchema} from '../../../contracts/guild-launchpad/v1/hosted-supply-terms';
export const SHIPPING_TERMS_HINT = '請寫明包裝方式、寄送方式、每件運費如何計算，以及特殊情況。最低訂量與交期請填上方欄位。';
export const RETURN_TERMS_HINT = '請寫明可退貨的條件、申請期限，以及退貨運費由誰負擔。';
export const SELLABLE_LABEL = '已同意，可加入展示頁（尚不能結帳購買）';

export const SUPPLY_REFERENCE_FIELDS = [
  {key:'msrp_minor',label:'建議售價',unit:'currency',hint:'只供店主參考，店主可以自行決定售價；系統不會依建議售價限制上架、供貨或結帳。',error:'建議售價須大於 0、最多兩位小數，且不得超過 1,000,000。',money:true},
  {key:'minimum_order_quantity',label:'最低訂量',unit:'件',hint:'你建議店主每次至少訂幾件。只供店主參考；系統不會依最低訂量限制預留或結帳。',error:'最低訂量須為 1 至 10,000 的整數。',money:false},
  {key:'lead_time_days',label:'交期',unit:'天',hint:'你預估收到訂單後幾天內出貨；當天出貨請填 0。只供店主參考，系統不保證出貨時間。',error:'交期須為 0 至 365 的整數天數。',money:false},
] as const;
export type SupplyReferenceField = typeof SUPPLY_REFERENCE_FIELDS[number]['key'];
/** Form text only. Wire schemas never coerce numbers or clear omitted fields. */
export function supplyReferenceValue(key:SupplyReferenceField,value:unknown):number|null {
  const text=String(value??'').trim();if(!text)return null;
  try {
    const number=key==='msrp_minor'?parseMajorToMinor(text):/^[0-9]+$/.test(text)?Number(text):NaN;
    return SupplyTermsInputSchema.shape[key].safeParse(number).success?number:NaN;
  } catch {return NaN;}
}
export const SUPPLY_LOSS_NOTE='建議售價低於每件成本合計，店主照這個售價會虧損。';
