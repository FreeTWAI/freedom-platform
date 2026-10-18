import {useEffect,useId,useRef,useState} from 'react';
import {MeetupCompletionInputSchema,MeetupHandoverInputSchema,OfflinePaymentConfirmInputSchema,SellerCheckoutOrderSchema,type SellerCheckoutOrder} from '../../../../contracts/guild-launchpad/v1/hosted-seller-checkout';
import type {Controller} from '../state/controller';
import {money} from './view';

type Kind='confirm_offline_payment'|'complete_meetup'|'record_meetup_handover';
const actions={
 confirm_offline_payment:{label:'確認收到匯款',path:'offline-payments',date:'收款日期',consequence:'確認後不能撤銷。請先在銀行核對入帳；此操作只記錄店家自行確認收到款項，平台不向銀行查證。'},
 complete_meetup:{label:'確認收現金並完成面交',path:'meetup-completion',date:'面交日期',consequence:'請確認已收到足額現金，且全部商品已交給買家。此操作同時記錄店家收款與交貨，確認後不能撤銷。'},
 record_meetup_handover:{label:'確認已面交',path:'meetup-handover',date:'面交日期',consequence:'請確認全部商品已交給買家。這筆訂單已有確認的付款，只登記交貨，不再登記收款。'},
} as const;

function Action({c,order,kind,ready}:{c:Controller;order:SellerCheckoutOrder;kind:Kind;ready:boolean}){
 const action=actions[kind],collect=kind!=='record_meetup_handover',name='offline-order:'+order.order_ref+':'+kind;
 const [version,setVersion]=useState(order.version),[amount,setAmount]=useState(''),[date,setDate]=useState(''),[reference,setReference]=useState(''),[errors,setErrors]=useState<Record<string,string>>({});
 const [confirmation,setConfirmation]=useState<{body:Record<string,unknown>;version:string}|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId(),stale=order.version!==version,locked=c.locked||!ready||stale;
 useEffect(()=>()=>c.markDirty(name,false),[c.markDirty,name]);
 function close(){dialog.current?.close();setConfirmation(null);if(trigger.current?.isConnected&&!trigger.current.disabled)trigger.current.focus();}
 function reset(){setAmount('');setDate('');setReference('');setErrors({});setVersion(order.version);c.markDirty(name,false);}
 return <div className="stack">
  <form className="stack" aria-label={action.label} noValidate onSubmit={event=>{
   event.preventDefault();if(locked)return;
   const failures:Record<string,string>={},minor=Number(amount)*100;
   if(collect&&(!/^[0-9]+$/.test(amount)||!Number.isSafeInteger(minor)||minor!==order.total_minor))failures.amount='請輸入與訂單總額相同的實收金額（整數元）。';
   const body=kind==='confirm_offline_payment'?{amount_minor:minor,received_on:date,...(reference.trim()?{reference:reference.trim()}:{})}:kind==='complete_meetup'?{amount_minor:minor,completed_on:date}:{completed_on:date};
   const schema=kind==='confirm_offline_payment'?OfflinePaymentConfirmInputSchema:kind==='complete_meetup'?MeetupCompletionInputSchema:MeetupHandoverInputSchema;
   const parsed=schema.safeParse(body);
   if(!parsed.success)for(const issue of parsed.error.issues){const field=issue.path[0]==='reference'?'reference':issue.path[0]==='amount_minor'?'amount':'date';failures[field]=field==='date'?'請填寫有效的日期。':field==='reference'?'參考資料最多 40 字，不能包含控制字元。':'請核對實收金額。';}
   setErrors(failures);if(Object.keys(failures).length||!parsed.success)return;
   setConfirmation({body:parsed.data,version});dialog.current?.showModal();
  }}>
   {stale&&<p role="alert">訂單已變更，這份輸入尚未送出。請先核對最新狀態，再重新填寫。</p>}
   {Object.keys(errors).length>0&&<div role="alert"><p>請修正以下欄位：</p><ul>{Object.entries(errors).map(([key,text])=><li key={key}><a href={'#'+id+key} onClick={e=>{e.preventDefault();document.getElementById(id+key)?.focus();}}>{text}</a></li>)}</ul></div>}
   <fieldset className="stack" disabled={locked}><legend>{action.label}</legend><p>訂單 {order.display_number} · 總額 {money(order.total_minor,order.currency)}</p>
    {collect&&<div className="field"><label htmlFor={id+'amount'}>實收金額（{order.currency} 整數元）</label><input id={id+'amount'} inputMode="numeric" value={amount} aria-invalid={!!errors.amount} aria-describedby={errors.amount?id+'amount-error':undefined} onChange={e=>{setAmount(e.target.value);c.markDirty(name,true);}}/>{errors.amount&&<span id={id+'amount-error'} className="field-hint">{errors.amount}</span>}</div>}
    <div className="field"><label htmlFor={id+'date'}>{action.date}</label><input id={id+'date'} type="date" value={date} aria-invalid={!!errors.date} aria-describedby={id+'date-hint'} onChange={e=>{setDate(e.target.value);c.markDirty(name,true);}}/><span className="field-hint" id={id+'date-hint'}>{errors.date??'依台北日期填寫，不早於下單日、不晚於今天。'}</span></div>
    {kind==='confirm_offline_payment'&&<div className="field"><label htmlFor={id+'reference'}>匯款參考（選填）</label><input id={id+'reference'} maxLength={40} value={reference} aria-invalid={!!errors.reference} aria-describedby={errors.reference?id+'reference-error':undefined} onChange={e=>{setReference(e.target.value);c.markDirty(name,true);}}/>{errors.reference&&<span id={id+'reference-error'} className="field-hint">{errors.reference}</span>}</div>}
    <div className="actions"><button ref={trigger} className="btn btn-ghost" type="submit">{action.label}</button></div>
   </fieldset>
   {stale&&<div className="actions"><button className="btn btn-ghost" type="button" disabled={c.locked||!ready} onClick={reset}>捨棄輸入，依最新訂單重新填寫</button></div>}
  </form>
  <dialog ref={dialog} aria-labelledby={id+'title'} onCancel={event=>{event.preventDefault();close();}} onClose={()=>{if(trigger.current?.isConnected&&!trigger.current.disabled)trigger.current.focus();}}>
   <div className="stack"><h2 id={id+'title'}>{action.label}</h2><p>訂單 {order.display_number} · {money(order.total_minor,order.currency)}</p><p>{action.date}：{date}</p>{reference&&<p>匯款參考：{reference}</p>}<p>{action.consequence}</p>
    {stale&&<p role="alert">訂單資料已更新，請關閉後重新核對。</p>}
    <div className="actions"><button className="btn btn-ghost" type="button" autoFocus onClick={close}>返回核對</button><button className="btn btn-primary" type="button" disabled={locked||!confirmation} onClick={()=>{
     if(!confirmation||locked)return;const captured=confirmation;close();
     c.command({label:action.label,path:c.root+'/checkout-orders/'+order.order_ref+'/'+action.path,body:captured.body,ifMatch:captured.version,schema:SellerCheckoutOrderSchema,match:value=>(value as SellerCheckoutOrder).order_ref===order.order_ref,settled:success=>{if(success)c.markDirty(name,false);}});
    }}>確認登記</button></div>
   </div>
  </dialog>
 </div>;
}

export function OfflineOrderActions({c,order,ready}:{c:Controller;order:SellerCheckoutOrder;ready:boolean}){
 return <>{(Object.keys(actions) as Kind[]).filter(kind=>order.actions[kind]).map(kind=><Action key={kind} c={c} order={order} kind={kind} ready={ready}/>)}</>;
}
