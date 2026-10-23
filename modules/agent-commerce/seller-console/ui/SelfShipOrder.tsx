import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {SelfShipmentInputSchema,SellerCheckoutOrderSchema,type SellerCheckoutOrder} from '../../../../contracts/guild-launchpad/v1/hosted-seller-checkout';
import {SELF_SHIP_CARRIER_LABELS} from '../../../../contracts/guild-launchpad/v1/hosted-checkout';
import {formatIsoLocal,formatMinor} from '../../../../apps/portal-web/src/format';
import {ApiError} from '../../../../apps/portal-web/src/api';
import type {Controller} from '../state/controller';
import {Axis} from './Shared';
const failures:Record<string,string>={validation_failed:'出貨資料有誤，請核對物流業者名稱、物流單號與寄出日期。',shipment_date_invalid:'寄出日期須在確認收款日到今天之間。',self_shipment_already_recorded:'這筆訂單已登記出貨，請查看目前紀錄。',self_shipment_stock_unavailable:'付款已確認，但商品尚未完成配貨，暫時不能登記出貨。',nothing_to_ship:'沒有可出貨的商品。',self_ship_not_selected:'這筆訂單不是店家自行寄送。',order_cancelled:'訂單已取消，不能登記出貨。'};
export function selfShipmentFailure(cause:unknown){
 const code=cause instanceof ApiError?cause.code:undefined;
 return code&&Object.hasOwn(failures,code)?failures[code]:'無法登記出貨，請更新訂單後再核對。';
}
/** Mirror shipmentInput: reject unsafe raw input, normalize, recheck names, then parse. */
export function selfShipmentDraft({carrier,other,tracking,date}:{carrier:string;other:string;tracking:string;date:string}):{fields:Record<string,string>;body?:ReturnType<typeof SelfShipmentInputSchema.parse>}{
 const fields:Record<string,string>={},body:Record<string,string>={carrier_key:carrier,...(carrier==='other'?{carrier_name:other}:{}),tracking_number:tracking,sent_on:date};
 const carrierMessage='請選擇物流業者；選擇其他時，請填寫名稱（最多 40 字）。',trackingMessage='請填寫 1–50 字的英文字母、數字或連字號。',nameMessage='物流業者名稱不能包含角括號（含全形）或看不見的控制字元。';
 for(const [key,field] of [['carrier_name','other'],['tracking_number','tracking']] as const){
  const raw=body[key];if(raw===undefined)continue;
  if(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069<>]/u.test(raw)){fields[field]=key==='carrier_name'?nameMessage:trackingMessage;continue;}
  const normalized=raw.normalize('NFKC').trim();
  if(key==='carrier_name'&&/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(normalized))fields.other=nameMessage;
  body[key]=normalized;
 }
 const result=SelfShipmentInputSchema.safeParse(body);
 if(!result.success)for(const issue of result.error.issues){const field=issue.path[0]==='sent_on'?'date':issue.path[0]==='tracking_number'?'tracking':issue.path[0]==='carrier_name'?'other':'carrier';fields[field]??=field==='date'?'請填寫有效的寄出日期。':field==='tracking'?trackingMessage:carrierMessage;}
 return result.success&&Object.keys(fields).length===0?{fields,body:result.data}:{fields};
}
function Form({c,order,ready,close}:{c:Controller;order:SellerCheckoutOrder;ready:boolean;close:()=>void}){
 const [carrier,setCarrier]=useState(''),[other,setOther]=useState(''),[tracking,setTracking]=useState(''),[date,setDate]=useState(''),[errors,setErrors]=useState<Record<string,string>>({}),[error,setError]=useState('');
 const [version]=useState(order.version),[confirmation,setConfirmation]=useState<ReturnType<typeof SelfShipmentInputSchema.parse>|null>(null);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId(),dirty='self-shipment:'+order.order_ref;
 const stale=order.version!==version,locked=c.locked||!ready||stale;
 useEffect(()=>()=>c.markDirty(dirty,false),[c.markDirty,dirty]);
 useEffect(()=>{if(confirmation)dialog.current?.showModal();},[confirmation]);
 function dismiss(){dialog.current?.close();setConfirmation(null);trigger.current?.focus();}
 const change=(update:()=>void)=>{update();setError('');c.markDirty(dirty,true);};
 return <><form className="stack" aria-label="登記出貨" noValidate onSubmit={event=>{
  event.preventDefault();if(locked)return;const result=selfShipmentDraft({carrier,other,tracking,date});
  setErrors(result.fields);if(!result.body){requestAnimationFrame(()=>document.getElementById(id+Object.keys(result.fields)[0])?.focus());return;}setConfirmation(result.body);
 }}>
  {stale&&<p role="alert">訂單已變更，這份輸入尚未送出。請先核對最新狀態，再重新填寫。</p>}{error&&<p role="alert">{error}</p>}
  {Object.keys(errors).length>0&&<div role="alert"><p>請修正以下欄位：</p><ul>{Object.entries(errors).map(([key,text])=><li key={key}><a href={'#'+id+key} onClick={e=>{e.preventDefault();document.getElementById(id+key)?.focus();}}>{text}</a></li>)}</ul></div>}
  <fieldset className="stack" disabled={locked}><legend>登記出貨</legend>
   <div className="field"><label htmlFor={id+'carrier'}>物流業者</label><select id={id+'carrier'} value={carrier} aria-invalid={!!errors.carrier} aria-describedby={errors.carrier?id+'carrier-error':undefined} onChange={e=>change(()=>setCarrier(e.target.value))}><option value="">請選擇</option>{Object.entries(SELF_SHIP_CARRIER_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>{errors.carrier&&<span className="field-hint" id={id+'carrier-error'}>{errors.carrier}</span>}</div>
   {carrier==='other'&&<div className="field"><label htmlFor={id+'other'}>物流業者名稱</label><input id={id+'other'} maxLength={40} value={other} aria-invalid={!!errors.other} aria-describedby={errors.other?id+'other-error':undefined} onChange={e=>change(()=>setOther(e.target.value))}/>{errors.other&&<span id={id+'other-error'} className="field-hint">{errors.other}</span>}</div>}
   <div className="field"><label htmlFor={id+'tracking'}>物流單號</label><input id={id+'tracking'} autoComplete="off" maxLength={50} value={tracking} aria-invalid={!!errors.tracking} aria-describedby={errors.tracking?id+'tracking-error':undefined} onChange={e=>change(()=>setTracking(e.target.value))}/>{errors.tracking&&<span id={id+'tracking-error'} className="field-hint">{errors.tracking}</span>}</div>
   <div className="field"><label htmlFor={id+'date'}>寄出日期</label><input id={id+'date'} type="date" value={date} aria-invalid={!!errors.date} aria-describedby={id+'date-hint'} onChange={e=>change(()=>setDate(e.target.value))}/><span className="field-hint" id={id+'date-hint'}>{errors.date??'請填寫確認收款日到今天之間的台北日期。'}</span></div>
   <div className="actions"><button ref={trigger} className={confirmation?'btn btn-ghost btn-small':'btn btn-primary'} type="submit">登記出貨</button></div>
  </fieldset><div className="actions"><button className="btn btn-ghost btn-small" type="button" disabled={c.locked} onClick={close}>捨棄輸入</button></div>
 </form><dialog ref={dialog} aria-labelledby={id+'title'} onCancel={e=>{e.preventDefault();dismiss();}} onClose={()=>{setConfirmation(null);trigger.current?.focus();}}><div className="stack"><h2 id={id+'title'}>確認登記出貨</h2><p>訂單 {order.display_number}</p><p>物流業者：{confirmation?.carrier_key==='other'?confirmation.carrier_name:confirmation&&SELF_SHIP_CARRIER_LABELS[confirmation.carrier_key]}</p><p>物流單號：{confirmation?.tracking_number}</p><p>寄出日期：{confirmation?.sent_on}</p><p>請確認全部剩餘商品已放在同一件包裹並寄出。登記後會同時扣除庫存，這筆紀錄不能修改或撤銷。</p>
  <div className="actions"><button className="btn btn-ghost btn-small" type="button" autoFocus onClick={dismiss}>返回核對</button><button className="btn btn-primary" type="button" disabled={locked||!confirmation} onClick={()=>{
   if(!confirmation||locked)return;const body=confirmation;dismiss();c.command({label:'登記出貨',path:c.root+'/checkout-orders/'+order.order_ref+'/self-shipments',body,ifMatch:version,sensitive:true,schema:SellerCheckoutOrderSchema,match:value=>(value as SellerCheckoutOrder).order_ref===order.order_ref,success:close,failed:cause=>setError(selfShipmentFailure(cause))});
  }}>確認登記出貨</button></div>
 </div></dialog></>;
}
export function SelfShipOrder({c,order,ready,contact}:{c:Controller;order:SellerCheckoutOrder;ready:boolean;contact?:ReactNode}){
 const [editing,setEditing]=useState(false),ship=order.self_ship;if(!ship)return null;const shipment=ship.shipment,pending=!shipment&&order.lifecycle_state!=='cancelled';
 const stockBlocked=!!ship.ship_by&&order.inventory_state==='unallocated';
 const fulfilment=shipment?<><dl className="detail-list"><div><dt>物流業者</dt><dd>{shipment.redacted?SELF_SHIP_CARRIER_LABELS[shipment.carrier_key]:shipment.carrier_name??SELF_SHIP_CARRIER_LABELS[shipment.carrier_key]}</dd></div>{!shipment.redacted&&<div><dt>物流單號</dt><dd>{shipment.tracking_number}</dd></div>}<div><dt>寄出日期</dt><dd>{shipment.sent_on}</dd></div></dl><p>登記時間：{formatIsoLocal(shipment.recorded_at)}</p></>:pending&&(order.actions.record_self_shipment||stockBlocked)?<>
  {order.actions.record_self_shipment&&(editing?<Form c={c} order={order} ready={ready} close={()=>setEditing(false)}/>:<div className="actions"><button className="btn btn-ghost btn-small" type="button" disabled={c.locked||!ready} onClick={()=>setEditing(true)}>登記出貨</button></div>)}
  {stockBlocked&&<p role="status">付款已確認，但商品尚未完成配貨，暫時不能登記出貨。</p>}
 </>:null;
 return <Axis title={order.drop_ship?'供應商代出貨':'自行寄送'}><div className="stack seller-self-ship">
  {order.drop_ship&&<><p>出貨者：{order.drop_ship.supplier_name}（代出貨）</p><p>供應成本：{formatMinor(order.drop_ship.supply_cost_minor,order.currency)}；代出貨費（含郵資）：{formatMinor(order.drop_ship.fee_per_order_minor,order.currency)}。由店家於平台外支付。</p>{order.drop_ship.unable&&<p role="status">供應商回報無法出貨：{{out_of_stock:'缺貨',cannot_ship:'無法寄送',other:'其他'}[order.drop_ship.unable.reason]}{order.drop_ship.unable.note?' · '+order.drop_ship.unable.note:''}</p>}</>}
  <p>{shipment?'已出貨':pending?ship.ship_by?'等待出貨':'等待付款確認':'訂單已取消，不能登記出貨。'}</p>
  {pending&&<><p>{ship.ship_by?`店家承諾於 ${ship.ship_by} 前寄出。`:`店家確認收款後 ${ship.handling_days} 個工作天內寄出。`}</p><p>工作天為週一至週五，不另排除國定假日。</p>{ship.note&&<p className="seller-self-ship-note">{ship.note}</p>}</>}
  <div className={contact&&fulfilment?'seller-self-ship-sections':'stack'}>{contact}{fulfilment&&<div className="stack">{fulfilment}</div>}</div>
  <p>只記錄店家填寫的資訊，工坊不追蹤物流、不核實簽收。</p>
 </div></Axis>;
}
