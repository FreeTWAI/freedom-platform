import {SelfShipSettings} from './SelfShipSettings';
import {useEffect,useId,useState} from 'react';
import type {z} from 'zod';
import {ApiError} from '../../../../apps/portal-web/src/api';
import {OfflinePaymentSettingsInputSchema,OfflinePaymentSettingsViewSchema} from '../../../../contracts/guild-launchpad/v1/hosted-offline-payment';
import {ShippingProfileInputSchema,ShippingProfileViewSchema} from '../../../../contracts/guild-launchpad/v1/hosted-shipping';
import type {Controller} from '../state/controller';
import {Axis,ReadStatus,useRead} from './Shared';

type PaymentSettings=z.infer<typeof OfflinePaymentSettingsViewSchema>;
type ShippingSettings=z.infer<typeof ShippingProfileViewSchema>;
type FreshAuth={start:(run:(verification:string)=>void)=>void};
const PaymentDraftSchema=OfflinePaymentSettingsInputSchema.omit({fresh_auth_verification_id:true});
const paymentFields={
 bank_code:{label:'銀行代碼',hint:'請填寫 3 位數字。',path:'bank_transfer.bank_code'},
 bank_name:{label:'銀行名稱',hint:'請填寫銀行名稱，最多 20 字。',path:'bank_transfer.bank_name'},
 branch_name:{label:'分行（選填）',hint:'分行名稱最多 20 字。',path:'bank_transfer.branch_name'},
 account_number:{label:'收款帳號',hint:'請填寫 6–16 位數字，可含空白或連字號。',path:'bank_transfer.account_number'},
 account_name:{label:'戶名',hint:'請填寫戶名，最多 40 字。',path:'bank_transfer.account_name'},
 deadline_days:{label:'匯款期限（天）',hint:'請填寫 1–7 的整數天數。',path:'bank_transfer.deadline_days'},
 note:{label:'匯款說明（選填）',hint:'匯款說明最多 200 字。',path:'bank_transfer.note'},
 cash_days:{label:'等候面交期限（天）',hint:'請填寫 1–14 的整數天數。',path:'cash_on_meetup.deadline_days'},
} as const;
type PaymentField=keyof typeof paymentFields;
function paymentErrors(paths:string[]){return Object.fromEntries((Object.keys(paymentFields) as PaymentField[]).filter(key=>paths.includes(paymentFields[key].path)).map(key=>[key,paymentFields[key].hint]));}

function Discard({c,close,reload}:{c:Controller;close:()=>void;reload:()=>void}){
 return <div className="actions"><button className="btn btn-ghost btn-small" type="button" disabled={c.locked} onClick={()=>{close();reload();}}>捨棄輸入，重新讀取設定</button></div>;
}

/** A draft retains the version and complete document read when editing began. */
function PaymentForm({c,initial,current,ready,fresh,close}:{c:Controller;initial:PaymentSettings;current:PaymentSettings;ready:boolean;fresh:FreshAuth;close:()=>void}){
 const bank=initial.settings?.bank_transfer;
 const [enabled,setEnabled]=useState(!!bank),[cash,setCash]=useState(!!initial.settings?.cash_on_meetup);
 const [values,setValues]=useState({bank_code:bank?.bank_code??'',bank_name:bank?.bank_name??'',branch_name:bank?.branch_name??'',account_number:bank?.account_number??'',account_name:bank?.account_name??'',deadline_days:String(bank?.deadline_days??3),note:bank?.note??'',cash_days:String(initial.settings?.cash_on_meetup?.deadline_days??7)});
 const [errors,setErrors]=useState<Record<string,string>>({});
 const stale=initial.version!==current.version,locked=c.locked||!ready||stale,id=useId();
 useEffect(()=>()=>c.markDirty('offline-settings',false),[c.markDirty]);
 const change=(key:PaymentField,value:string)=>{setValues(old=>({...old,[key]:value}));setErrors(old=>{const next={...old};delete next[key];return next;});c.markDirty('offline-settings',true);};
 function field(key:PaymentField){const meta=paymentFields[key],days=key==='deadline_days'||key==='cash_days';return <div className={'field'+(key==='note'?' seller-settings-wide':'')} key={key}>
  <label htmlFor={id+key}>{meta.label}</label><input id={id+key} value={values[key]} required={!['branch_name','note'].includes(key)} type={days?'number':'text'} min={days?1:undefined} max={days?key==='cash_days'?14:7:undefined} step={days?1:undefined} inputMode={days||key==='bank_code'||key==='account_number'?'numeric':undefined} pattern={key==='bank_code'?'[0-9]{3}':key==='account_number'?'[0-9 -]{6,32}':undefined} maxLength={days?undefined:key==='bank_code'?3:key==='account_number'?32:key==='account_name'?40:key==='note'?200:20} aria-invalid={!!errors[key]} aria-describedby={id+key+'-hint'} onChange={e=>change(key,e.target.value)}/><span className="field-hint" id={id+key+'-hint'}>{errors[key]??meta.hint}</span>
 </div>;}
 return <form className="stack" aria-label="線下收款設定" onSubmit={event=>{
  event.preventDefault();if(locked)return;
  const body={schema:'freedom.offline-payment-settings/v1' as const,bank_transfer:enabled?{bank_code:values.bank_code,bank_name:values.bank_name,...(values.branch_name.trim()?{branch_name:values.branch_name}:{}),account_number:values.account_number,account_name:values.account_name,deadline_days:Number(values.deadline_days),...(values.note.trim()?{note:values.note}:{})}:null,cash_on_meetup:cash?{deadline_days:Number(values.cash_days)}:null};
  const parsed=PaymentDraftSchema.safeParse(body);
  if(!parsed.success){setErrors(paymentErrors(parsed.error.issues.map(issue=>issue.path.join('.'))));return;}
  setErrors({});
  const run=(verification:string)=>c.command({label:'線下收款設定',method:'put',path:c.root+'/offline-payment-settings',body:{...parsed.data,fresh_auth_verification_id:verification},ifMatch:initial.version??undefined,schema:OfflinePaymentSettingsViewSchema,sensitive:true,success:close,failed:cause=>{if(cause instanceof ApiError&&cause.code==='offline_settings_invalid')setErrors(paymentErrors((cause.errors??[]).map(error=>error.path)));},freshRecovery:resume=>fresh.start(resume),freshAgain:()=>fresh.start(run)});
  fresh.start(run);
 }}>
  {stale&&<p role="alert">設定已由其他操作變更。請捨棄這份輸入、重新讀取後再編輯；尚未覆寫設定。</p>}
  {Object.keys(errors).length>0&&<div role="alert"><p>請修正以下欄位再儲存：</p><ul>{Object.entries(errors).map(([key,text])=><li key={key}><a href={'#'+id+key} onClick={e=>{e.preventDefault();document.getElementById(id+key)?.focus();}}>{paymentFields[key as PaymentField].label}：{text}</a></li>)}</ul></div>}
  <fieldset className="stack" disabled={locked}><legend className="sr-only">線下收款設定</legend>
   <label className="choice"><input type="checkbox" checked={enabled} onChange={e=>{setEnabled(e.target.checked);c.markDirty('offline-settings',true);}}/>提供銀行匯款</label>
   {enabled&&<div className="seller-settings-fields">{(['bank_code','bank_name','branch_name','account_number','account_name','deadline_days','note'] as const).map(field)}</div>}
   <label className="choice"><input type="checkbox" checked={cash} onChange={e=>{setCash(e.target.checked);c.markDirty('offline-settings',true);}}/>提供面交現金付款</label>
   {cash&&field('cash_days')}
   <p className="field-hint">變更只適用於之後的新訂單；既有訂單保留當時的收款資料。儲存時需重新驗證身分。</p>
   <div className="actions"><button className="btn btn-ghost btn-small" type="submit">儲存線下收款設定</button></div>
  </fieldset><Discard c={c} close={close} reload={()=>void c.load('offline-settings')}/>
 </form>;
}

function MeetupForm({c,initial,current,ready,close}:{c:Controller;initial:ShippingSettings;current:ShippingSettings;ready:boolean;close:()=>void}){
 const option=initial.profile?.delivery_options.find(o=>o.method==='meetup');
 const [enabled,setEnabled]=useState(!!option),[note,setNote]=useState(option?.note??''),[error,setError]=useState('');
 const stale=initial.version!==current.version,locked=c.locked||!ready||stale,id=useId();
 useEffect(()=>()=>c.markDirty('meetup-settings',false),[c.markDirty]);
 return <form className="stack" aria-label="面交取貨設定" onSubmit={event=>{
  event.preventDefault();if(locked)return;
  const profile=initial.profile??{schema:'freedom.shipping-profile/v1',working_days:[1,2,3,4,5],services:[],delivery_options:[],drop_ship:null};
  // Replace only meetup. Preserve all retained shipping, working-day and drop-ship settings.
  const meetup={method:'meetup' as const,note:note.trim()};
  const options=enabled?(profile.delivery_options.some(o=>o.method==='meetup')?profile.delivery_options.map(o=>o.method==='meetup'?meetup:o):[...profile.delivery_options,meetup]):profile.delivery_options.filter(o=>o.method!=='meetup');
  const parsed=ShippingProfileInputSchema.safeParse({...profile,delivery_options:options});
  if(!parsed.success){setError('請檢查面交說明（1–200 字）；配送方式最多六種。');return;}setError('');
  c.command({label:'面交取貨設定',method:'put',path:c.root+'/shipping-profile',body:parsed.data,ifMatch:initial.version??undefined,schema:ShippingProfileViewSchema,success:close});
 }}>
  {stale&&<p role="alert">配送設定已由其他操作變更。請捨棄這份輸入、重新讀取後再編輯；尚未覆寫設定。</p>}
  {error&&<p role="alert"><a href={'#'+id} onClick={e=>{e.preventDefault();document.getElementById(id)?.focus();}}>{error}</a></p>}
  <fieldset className="stack" disabled={locked}><legend className="sr-only">面交取貨設定</legend>
   <label className="choice"><input type="checkbox" checked={enabled} onChange={e=>{setEnabled(e.target.checked);c.markDirty('meetup-settings',true);}}/>提供面交取貨</label>
   {enabled&&<div className="field"><label htmlFor={id}>面交地區與時段</label><textarea id={id} rows={3} required maxLength={200} value={note} aria-invalid={!!error} onChange={e=>{setNote(e.target.value);c.markDirty('meetup-settings',true);}}/></div>}
   <p className="field-hint">面交不收運費，時間地點由店家與買家約定。新設定不改變既有訂單的面交說明。</p>
   <div className="actions"><button className="btn btn-ghost btn-small" type="submit">儲存面交取貨設定</button></div>
  </fieldset><Discard c={c} close={close} reload={()=>void c.load('meetup-settings')}/>
 </form>;
}

export function OfflineSettings({c,fresh,selfShipEnabled=false}:{c:Controller;fresh:FreshAuth;selfShipEnabled?:boolean}){
 const payments=useRead(c,'offline-settings','/offline-payment-settings',OfflinePaymentSettingsViewSchema),shipping=useRead(c,'meetup-settings','/shipping-profile',ShippingProfileViewSchema);
 const [paymentDraft,setPaymentDraft]=useState<PaymentSettings|null>(null),[shippingDraft,setShippingDraft]=useState<ShippingSettings|null>(null),[selfDraft,setSelfDraft]=useState<ShippingSettings|null>(null);
 useEffect(()=>{if(!selfShipEnabled)setSelfDraft(null);},[selfShipEnabled]);
 const editing=!!paymentDraft||!!shippingDraft||!!selfDraft;
 const p=payments.data,s=shipping.data,bank=p?.settings?.bank_transfer,meetup=s?.profile?.delivery_options.find(o=>o.method==='meetup');
 return <>
  <Axis title="線下收款" readState={payments.state}>
   <p>款項直接付給店家，由店家自行確認收到款項。</p><ReadStatus small c={c} name="offline-settings" label="線下收款設定" slot={payments}/>
   {p&&<>{bank?<dl className="seller-facts"><div><dt>銀行匯款</dt><dd>{bank.bank_code} {bank.bank_name} {bank.branch_name}</dd></div><div><dt>收款帳號</dt><dd>{bank.account_number??'末四碼 '+bank.account_number_last4}</dd></div><div><dt>戶名</dt><dd>{bank.account_name}</dd></div><div><dt>付款期限</dt><dd>{bank.deadline_days} 天</dd></div>{bank.note&&<div><dt>匯款說明</dt><dd>{bank.note}</dd></div>}</dl>:<p>尚未提供銀行匯款。</p>}
    <p>{p.settings?.cash_on_meetup?`提供面交現金付款，等候期限 ${p.settings.cash_on_meetup.deadline_days} 天。`:'尚未提供面交現金付款。'}</p>
    {(!p.host_profiles.bank_transfer||!p.host_profiles.cash_on_meetup)&&<p role="status">目前服務未開放：{[!p.host_profiles.bank_transfer&&'銀行匯款',!p.host_profiles.cash_on_meetup&&'面交現金付款'].filter(Boolean).join('、')}。可保存店家設定，實際可用方式以結帳頁為準。</p>}
    {p.account_visibility==='full'?(paymentDraft?<PaymentForm c={c} initial={paymentDraft} current={p} ready={payments.state==='ready'} fresh={fresh} close={()=>setPaymentDraft(null)}/>:<div className="actions"><button className="btn btn-ghost btn-small" type="button" disabled={c.locked||payments.state!=='ready'||editing} onClick={()=>setPaymentDraft(p)}>編輯線下收款設定</button></div>):<p>只有商店擁有者或管理員可以變更收款設定。</p>}
   </>}
  </Axis>
  <Axis title="面交取貨" readState={shipping.state}><ReadStatus small c={c} name="meetup-settings" label="面交取貨設定" slot={shipping}/>
   {s&&<>{meetup?<p>{meetup.note}</p>:<p>尚未提供面交取貨。可設定地區與時段，讓買家結帳時選擇。</p>}{shippingDraft?<MeetupForm c={c} initial={shippingDraft} current={s} ready={shipping.state==='ready'} close={()=>setShippingDraft(null)}/>:<div className="actions"><button className="btn btn-ghost btn-small" type="button" disabled={c.locked||shipping.state!=='ready'||editing} onClick={()=>setShippingDraft(s)}>編輯面交取貨設定</button></div>}</>}
  </Axis>
  <SelfShipSettings c={c} shipping={shipping} enabled={selfShipEnabled} bankReady={!!bank&&p?.host_profiles.bank_transfer===true} draft={selfDraft} edit={()=>setSelfDraft(s!)} close={()=>setSelfDraft(null)} editing={editing}/>
 </>;
}
