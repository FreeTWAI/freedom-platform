import {useEffect,useId,useState} from 'react';
import type {z} from 'zod';
import {ShippingProfileInputSchema,ShippingProfileViewSchema,type SelfShipDeliveryOptionSchema} from '../../../../contracts/guild-launchpad/v1/hosted-shipping';
import type {Controller,ReadSlot} from '../state/controller';
import {Axis,ReadStatus} from './Shared';

type Shipping=z.infer<typeof ShippingProfileViewSchema>;
type Option=z.infer<typeof SelfShipDeliveryOptionSchema>;
export function selfShipSettingMode(enabled:boolean,exists:boolean){return enabled?'editable':exists?'readonly':'hidden';}
/** Replace only this method, keeping all provider, meetup and drop-ship settings. */
export function withSelfShip(profile:Shipping['profile'],option:Option|null){
 const document=profile??{schema:'freedom.shipping-profile/v1' as const,working_days:[1,2,3,4,5],services:[],delivery_options:[],drop_ship:null};
 const exists=document.delivery_options.some(o=>o.method==='self_ship');
 return {...document,delivery_options:option?(exists?document.delivery_options.map(o=>o.method==='self_ship'?option:o):[...document.delivery_options,option]):document.delivery_options.filter(o=>o.method!=='self_ship')};
}
function Form({c,initial,current,ready,close}:{c:Controller;initial:Shipping;current:Shipping;ready:boolean;close:()=>void}){
 const option=initial.profile?.delivery_options.find(o=>o.method==='self_ship');
 const [enabled,setEnabled]=useState(!!option),[fee,setFee]=useState(String(option?.fee_per_order_minor===undefined?80:option.fee_per_order_minor/100)),[days,setDays]=useState(String(option?.handling_days??3)),[note,setNote]=useState(option?.note??''),[errors,setErrors]=useState<Record<string,string>>({});
 const id=useId(),stale=initial.version!==current.version,locked=c.locked||!ready||stale;
 useEffect(()=>()=>c.markDirty('self-ship-settings',false),[c.markDirty]);
 const dirty=()=>c.markDirty('self-ship-settings',true);
 const field=(key:string,label:string,value:string,change:(v:string)=>void,hint:string)=> <div className="field"><label htmlFor={id+key}>{label}</label><input id={id+key} inputMode="numeric" value={value} onChange={e=>{change(e.target.value);dirty();}} aria-invalid={!!errors[key]} aria-describedby={id+key+'-hint'}/><span id={id+key+'-hint'} className="field-hint">{errors[key]??hint}</span></div>;
 return <form className="stack seller-self-ship" aria-label="自行寄送設定" noValidate onSubmit={e=>{
  e.preventDefault();if(locked)return;const failures:Record<string,string>={};
  if(enabled){if(!/^[0-9]+$/.test(fee)||Number(fee)>10000)failures.fee='請填寫 0–10,000 的整數運費。';if(!/^[0-9]+$/.test(days)||Number(days)<1||Number(days)>14)failures.days='請填寫 1–14 的整數工作天。';if(note.trim()&&(!ShippingProfileInputSchema.safeParse(withSelfShip(initial.profile,{method:'self_ship',fee_per_order_minor:0,handling_days:1,note:note.trim()})).success))failures.note='寄送說明最多 200 字，不能包含控制字元。';}
  setErrors(failures);if(Object.keys(failures).length){requestAnimationFrame(()=>document.getElementById(id+Object.keys(failures)[0])?.focus());return;}
  const parsed=ShippingProfileInputSchema.safeParse(withSelfShip(initial.profile,enabled?{method:'self_ship',fee_per_order_minor:Number(fee)*100,handling_days:Number(days),note:note.trim()||null}:null));
  if(!parsed.success){setErrors({profile:'請檢查配送設定；配送方式最多六種。'});return;}
  c.command({label:'自行寄送設定',method:'put',path:c.root+'/shipping-profile',body:parsed.data,ifMatch:initial.version??undefined,schema:ShippingProfileViewSchema,success:close});
 }}>
  {stale&&<p role="alert">配送設定已由其他操作變更。請捨棄這份輸入、重新讀取後再編輯；尚未覆寫設定。</p>}
  {Object.keys(errors).length>0&&<div role="alert"><p>請修正以下欄位：</p><ul>{Object.entries(errors).map(([key,text])=><li key={key}><a href={'#'+id+key} onClick={e=>{e.preventDefault();document.getElementById(id+key)?.focus();}}>{text}</a></li>)}</ul></div>}
  <fieldset className="stack" disabled={locked}><legend className="sr-only">自行寄送設定</legend>
   <label className="choice"><input type="checkbox" checked={enabled} onChange={e=>{setEnabled(e.target.checked);dirty();}}/>提供宅配（店家自行寄送）</label>
   {enabled&&<><div className="seller-settings-fields">
    {field('fee','每單運費（NT$ 整數元）',fee,setFee,'可填 0–10,000；每筆訂單只收一次。')}
    {field('days','確認收款後幾個工作天內寄出',days,setDays,'請填 1–14。')}
    <div className="field seller-settings-wide"><label htmlFor={id+'note'}>寄送說明（選填）</label><textarea id={id+'note'} rows={3} maxLength={200} value={note} aria-invalid={!!errors.note} aria-describedby={id+'note-hint'} onChange={e=>{setNote(e.target.value);dirty();}}/><span className="field-hint" id={id+'note-hint'}>{errors.note??'最多 200 字，可說明使用的物流業者。請勿填入買家個資。'}</span></div>
   </div><p className="field-hint">工作天為週一至週五，不另排除國定假日；從確認收款日的次日起算。</p></>}
   <p className="field-hint">每單一件包裹；不配送離島。</p><p className="field-hint">自行寄送只提供銀行匯款，店家確認收款後寄出。</p><p className="field-hint">新設定適用於之後的報價；已成立訂單保留當時的運費與出貨承諾。</p>
   <div className="actions"><button className="btn btn-primary" type="submit">儲存自行寄送設定</button></div>
  </fieldset><div className="actions"><button className="btn btn-ghost btn-small" type="button" disabled={c.locked} onClick={()=>{close();void c.load('meetup-settings');}}>捨棄輸入</button></div>
 </form>;
}
export function SelfShipSettings({c,shipping,enabled,bankReady,draft,edit,close,editing}:{c:Controller;shipping:ReadSlot<Shipping>;enabled:boolean;bankReady:boolean;draft:Shipping|null;edit:()=>void;close:()=>void;editing:boolean}){
 const s=shipping.data,option=s?.profile?.delivery_options.find(o=>o.method==='self_ship'),mode=selfShipSettingMode(enabled,!!option);
 if(mode==='hidden')return null;
 return <Axis title="宅配（店家自行寄送）" readState={shipping.state}><ReadStatus small c={c} name="meetup-settings" label="自行寄送設定" slot={shipping}/>
  {s&&<>{option?<><p>每單運費 NT$ {option.fee_per_order_minor/100}</p><p>店家確認收款後 {option.handling_days} 個工作天內寄出。</p>{option.note&&<p className="seller-self-ship-note">{option.note}</p>}</>:<p>尚未提供店家自行寄送。</p>}
   {mode==='readonly'?<p role="status">目前尚未開放新的自行寄送設定。</p>:draft?<Form c={c} initial={draft} current={s} ready={shipping.state==='ready'} close={close}/>:<div className="actions"><button className="btn btn-ghost btn-small" type="button" disabled={c.locked||shipping.state!=='ready'||editing} onClick={edit}>編輯自行寄送設定</button></div>}
   {mode==='editable'&&!bankReady&&<p role="status">請先完成銀行匯款設定，買家才能使用自行寄送。</p>}
  </>}
 </Axis>;
}
