import {SUPPLY_REFERENCE_FIELDS,supplyReferenceValue,SUPPLY_LOSS_NOTE,type SupplyReferenceField} from './SupplyOfferText';
import {useId} from 'react';
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
      <label className="field">{f.label}<input inputMode={f.money?'decimal':'numeric'} maxLength={24}
        aria-invalid={error||undefined} aria-describedby={`${prefix}-${f.key}-hint${error?` ${prefix}-${f.key}-error`:''}`}
        value={String(values[f.key]??'')} onChange={e=>onChange(f.key,e.target.value)}/></label>
      <p id={`${prefix}-${f.key}-hint`} className="field-hint">{f.hint}{f.money?`（${currency}）`:f.key==='minimum_order_quantity'?'（件）':'（天）'}</p>
      {error&&<p id={`${prefix}-${f.key}-error`} className="field-hint" role="alert">{f.error}</p>}
    </div>;})}
    {msrp!==null&&!Number.isNaN(msrp)&&unit!==null&&fee!==null&&msrp<unit+fee&&<p className="field-hint" role="note">{SUPPLY_LOSS_NOTE}</p>}
  </fieldset>;
}
