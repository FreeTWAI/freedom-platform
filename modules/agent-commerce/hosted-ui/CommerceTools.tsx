import type {MerchantInventory} from '../../../contracts/guild-launchpad/v1/storefront';
import {SUPPLY_REFERENCE_FIELDS,supplyReferenceValue,SUPPLY_LOSS_NOTE,type SupplyReferenceField} from './SupplyOfferText';
import React,{useId} from 'react';
import {formatMinor,parseMajorToMinor} from '../../../apps/portal-web/src/format';

export function productMatches(product:{title:string;sku:string;description:string},query:string){
  const words=query.trim().normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack=[product.title,product.sku,product.description].join(' ').normalize('NFKC').toLocaleLowerCase();
  return words.every(word=>haystack.includes(word));
}
export function ProductSearch({value,onChange,count,total,disabled}:{value:string;onChange:(query:string)=>void;count:number;total:number;disabled:boolean}){
  const id=useId();
  return <div className="hosted-product-search"><label className="field" htmlFor={id}>搜尋商品<input id={id} type="search" value={value} disabled={disabled} placeholder="商品名稱、SKU 或介紹" onChange={event=>onChange(event.target.value)}/></label>
    <p className="field-hint" aria-live="polite">{value.trim()?`找到 ${count}／${total} 件已載入的商品`:`已載入 ${total} 件商品`}</p>
    {value&&<button className="btn btn-ghost" type="button" disabled={disabled} onClick={()=>onChange('')}>清除搜尋</button>}
    {disabled&&value&&<p className="field-hint">先儲存或取消編輯，再變更搜尋。</p>}
  </div>;
}
function amount(text:string){try{return /^0+(?:\.0{1,2})?$/.test(text.trim())?0:parseMajorToMinor(text);}catch{return null;}}
export function PriceDifference({retail,cost,shipping,currency}:{retail:string;cost:number;shipping:number;currency:string}){
  const price=amount(retail);if(price===null||price<1||price>100000000)return null;
  const difference=price-cost-shipping;
  return <div className="hosted-price-summary" aria-live="polite"><dl><div><dt>我的售價</dt><dd>{formatMinor(price,currency)}</dd></div><div><dt>供貨價＋每件運費</dt><dd>{formatMinor(cost+shipping,currency)}</dd></div><div><dt>每件價格差</dt><dd>{formatMinor(difference,currency)}</dd></div></dl>
    <p className="field-hint">價格差還沒扣稅、金流、行銷、退貨及其他成本，並非實際利潤。</p>{difference<0&&<p className="field-hint">目前售價低於供貨價加運費，送出前請確認。</p>}
  </div>;
}

/** Identical optional fields in both supplier editors. Never used in supplier price review. */
export function SupplyReferenceFields({values,cost,shipping,currency,onChange}:{
  values:Record<string,unknown>;cost:string;shipping:string;currency:string;onChange:(key:SupplyReferenceField,value:string)=>void;
}) {
  const prefix=useId(),msrp=supplyReferenceValue('msrp_minor',values.msrp_minor),unit=amount(cost),fee=amount(shipping);
  return <fieldset className="hosted-store-fields stack supply-reference-fields"><legend>給店主的參考（選填）</legend>
    {SUPPLY_REFERENCE_FIELDS.map(f=>{const error=Number.isNaN(supplyReferenceValue(f.key,values[f.key]));return <div key={f.key}>
      <label className="field">{f.label}（{f.unit==='currency'?currency:f.unit}）<input inputMode={f.money?'decimal':'numeric'} maxLength={24}
        aria-invalid={error||undefined} aria-describedby={`${prefix}-${f.key}-hint${error?` ${prefix}-${f.key}-error`:''}`}
        value={String(values[f.key]??'')} onChange={e=>onChange(f.key,e.target.value)}/></label>
      <p id={`${prefix}-${f.key}-hint`} className="field-hint">{f.hint}</p>
      {error&&<p id={`${prefix}-${f.key}-error`} className="field-hint" role="alert">{f.error}</p>}
    </div>;})}
    {msrp!==null&&!Number.isNaN(msrp)&&unit!==null&&fee!==null&&msrp<unit+fee&&<p className="field-hint" role="note">{SUPPLY_LOSS_NOTE}</p>}
  </fieldset>;
}

export const STOCK_HINT='庫存是實際持有的總量，不能低於已占用；可售量會扣除預留中與已付款待出貨。';
export function InventoryDefinition({supplier=false}:{supplier?:boolean}) {
  return <p className="field-hint merchant-inventory-definition">已占用＝預留中＋已付款待出貨；{supplier?'可用':'可售'}＝庫存－已占用。可用與可售是同一數量，預留不是成交。</p>;
}
export function InventoryIssues({count=0}:{count?:number}) {
  return count>0?<p className="field-hint" role="status">有 {count} 件商品的庫存紀錄不一致，缺貨商品數暫時無法確認。</p>:null;
}
/** Values come from one private server observation, never flag-based arithmetic. */
export function MerchantInventorySummary({stock,inventory,supplier=false,compact=false,onRefresh,disabled=false}:{
  stock:number;inventory?:MerchantInventory;supplier?:boolean;compact?:boolean;onRefresh?:()=>void;disabled?:boolean;
}) {
  const label=supplier?'可用':'可售',valid=inventory?.state==='ready';
  const reserved=valid?inventory.reserved:'—',available=valid?inventory.available:'—';
  return <div className="merchant-inventory">
    <p className="merchant-inventory-values">{compact?`${stock}／${reserved}／${available}`:supplier?`庫存 ${stock}／已占用 ${reserved}／${label} ${available}`:`庫存 ${stock}・已占用 ${reserved}・${label} ${available}`}</p>
    {valid?<p className="field-hint merchant-inventory-breakdown"><span>預留中 {inventory.held}</span><span>已付款待出貨 {inventory.allocated}</span></p>
      :<><p className="field-hint" role="status">{inventory?`庫存紀錄不一致，暫時無法確認已占用與${label}數量。請重新讀取；若仍未恢復，請聯絡平台協助核對。`:'庫存明細暫時無法讀取，請重新讀取。'}</p>
      {onRefresh&&<button type="button" className="btn btn-ghost btn-small" disabled={disabled} onClick={onRefresh}>重新讀取庫存</button>}</>}
  </div>;
}
