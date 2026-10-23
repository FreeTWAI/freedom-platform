import {useEffect,useId,useRef,useState} from 'react';
import {PaidCancellationInputSchema,PaidCancellationRefundInputSchema,SellerCheckoutOrderSchema,type SellerCheckoutOrder} from '../../../../contracts/guild-launchpad/v1/hosted-seller-checkout';
import {PAID_CANCELLATION_REASON_LABELS} from '../../../../contracts/guild-launchpad/v1/hosted-checkout';
import type {Controller} from '../state/controller';
import {Axis} from './Shared';
import {money} from './view';

export function PaidCancellation({c,order,ready}:{c:Controller;order:SellerCheckoutOrder;ready:boolean}) {
 const cancellation=order.paid_cancellation,pending=cancellation?.refund_state==='pending';
 const [reason,setReason]=useState('out_of_stock'),[note,setNote]=useState(''),[refund,setRefund]=useState<'pending'|'recorded'>('pending');
 const [date,setDate]=useState(''),[method,setMethod]=useState('bank_transfer'),[error,setError]=useState(''),[version,setVersion]=useState(order.version);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId(),dirty='paid-cancellation:'+order.order_ref;
 const locked=c.locked||!ready,stale=version!==order.version,label=pending?'登記退款':'取消訂單並退款';
 useEffect(()=>()=>c.markDirty(dirty,false),[c.markDirty,dirty]);
 if(order.payment_method==='immediate_card')return null;
 function close(){dialog.current?.close();if(trigger.current?.isConnected&&!trigger.current.disabled)trigger.current.focus();}
 const changed=()=>c.markDirty(dirty,true);
 function open(){setVersion(order.version);setError('');dialog.current?.showModal();}
 return <Axis title="退款紀錄"><div className="stack seller-paid-cancellation">
  <p>離線付款由店家在平台外全額退款，再登記退款日期與方式。平台只保存紀錄，不執行或查核退款。</p>
  {cancellation&&<><p>店家已取消這筆訂單 · {PAID_CANCELLATION_REASON_LABELS[cancellation.reason]}</p>
   {cancellation.note&&<p>店家備註：{cancellation.note}</p>}
   <p>退款金額：{money(cancellation.amount_minor,cancellation.currency)}</p>
   <p>{cancellation.refund_state==='pending'?'待退款 · 店家會在平台外退款':`已於 ${cancellation.refunded_on} 以${cancellation.refund_method==='bank_transfer'?'銀行轉帳':'現金'}退款`}</p>
  </>}
  {(order.actions.cancel_paid||pending&&order.actions.record_paid_refund)&&<div className="actions"><button ref={trigger} className="btn btn-ghost btn-small" type="button" disabled={locked} onClick={open}>{label}</button></div>}
  <dialog ref={dialog} aria-labelledby={id+'title'} onCancel={e=>{e.preventDefault();close();}} onClose={()=>{if(trigger.current?.isConnected&&!trigger.current.disabled)trigger.current.focus();}}>
   <form className="stack" aria-label={label} onSubmit={event=>{
    event.preventDefault();if(locked||stale)return;
    const value=pending?{refunded_on:date,refund_method:method}:{reason,...(note?{note}:{}),refund_state:refund,...(refund==='recorded'?{refunded_on:date,refund_method:method}:{})};
    const parsed=(pending?PaidCancellationRefundInputSchema:PaidCancellationInputSchema).safeParse(value);
    if(!parsed.success){setError('請核對取消原因、200 字內備註及退款日期與方式。');return;}
    close();c.command({label,path:c.root+'/checkout-orders/'+order.order_ref+'/paid-cancellation'+(pending?'/refund':''),body:parsed.data,ifMatch:version,schema:SellerCheckoutOrderSchema,
     match:value=>(value as SellerCheckoutOrder).order_ref===order.order_ref,settled:success=>{if(success){setNote('');setDate('');c.markDirty(dirty,false);}}});
   }}>
    <h2 id={id+'title'}>{label}</h2><p>訂單 {order.display_number} · 全額 {money(cancellation?.amount_minor??order.total_minor,order.currency)}</p>
    <p>請在平台外退款後再選擇「已退款」。尚未退款可先取消訂單，稍後登記退款。</p>
    {error&&<p role="alert">{error}</p>}{stale&&<p role="alert">訂單已變更，請關閉後核對最新狀態。</p>}
    <fieldset className="stack" disabled={locked||stale}><legend>{pending?'退款資料':'取消與退款資料'}</legend>
     {!pending&&<><div className="field"><label htmlFor={id+'reason'}>取消原因</label><select autoFocus id={id+'reason'} value={reason} onChange={e=>{setReason(e.target.value);changed();}}>{Object.entries(PAID_CANCELLATION_REASON_LABELS).map(([value,text])=><option key={value} value={value}>{text}</option>)}</select></div>
      <div className="field"><label htmlFor={id+'note'}>店家備註（選填）</label><textarea id={id+'note'} rows={3} maxLength={200} value={note} aria-describedby={id+'note-hint'} onChange={e=>{setNote(e.target.value);changed();}}/><span className="field-hint" id={id+'note-hint'}>最多 200 字，請勿填寫買家的個人資料。備註只供店家查看。</span></div>
      <fieldset className="stack"><legend>退款狀態</legend><label className="choice"><input type="radio" name={id+'refund'} value="pending" checked={refund==='pending'} onChange={()=>{setRefund('pending');changed();}}/> 稍後登記退款</label><label className="choice"><input type="radio" name={id+'refund'} value="recorded" checked={refund==='recorded'} disabled={!order.actions.record_paid_refund} onChange={()=>{setRefund('recorded');changed();}}/> 已退款</label>{!order.actions.record_paid_refund&&<p className="field-hint">你可以先取消訂單，退款會標記為待退款；登記退款需要退款權限。</p>}</fieldset>
     </>}
     {(pending||refund==='recorded')&&<><div className="field"><label htmlFor={id+'date'}>退款日期</label><input id={id+'date'} type="date" required value={date} onChange={e=>{setDate(e.target.value);changed();}} aria-describedby={id+'date-hint'}/><span className="field-hint" id={id+'date-hint'}>以台北日期填寫，須在確認收款日到今天之間。</span></div><div className="field"><label htmlFor={id+'method'}>退款方式</label><select id={id+'method'} value={method} onChange={e=>{setMethod(e.target.value);changed();}}><option value="bank_transfer">銀行轉帳</option><option value="cash">現金</option></select></div></>}
    </fieldset>
    <div className="actions"><button className="btn btn-ghost btn-small" type="button" onClick={close}>關閉</button><button className="btn btn-primary" type="submit" disabled={locked||stale}>{pending?'確認登記退款':'確認取消訂單'}</button></div>
   </form>
  </dialog>
 </div></Axis>;
}
