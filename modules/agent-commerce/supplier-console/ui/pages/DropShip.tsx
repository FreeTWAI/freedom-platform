import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {DropShipOrdersSchema,DropShipOrderSchema,DropShipUnableSchema,type DropShipOrder} from '../../../../../contracts/guild-launchpad/v1/hosted-drop-ship';
import {SupplyCatalogViewSchema} from '../../../../../contracts/guild-launchpad/v1/hosted-supply-catalog';
import {SELF_SHIP_CARRIER_LABELS} from '../../../../../contracts/guild-launchpad/v1/hosted-checkout';
import {formatIsoLocal,formatMinor} from '../../../../../apps/portal-web/src/format';
import {useController,type Controller} from '../../../seller-console/state/controller';
import {DropShipAgreements} from '../../../seller-console/ui/DropShipAgreements';
import {selfShipmentDraft} from '../../../seller-console/ui/SelfShipOrder';
import {useRead,ReadStatus,Permission} from '../../../seller-console/ui/Shared';
import type {ConsoleController} from '../../state/useSupplierConsoleController';
const reason={out_of_stock:'缺貨',cannot_ship:'無法寄送',other:'其他'};
function Dialog({label,disabled,children}:{label:string;disabled:boolean;children:(close:()=>void)=>ReactNode}) {
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId();
 const close=()=>{dialog.current?.close();if(trigger.current?.isConnected&&!trigger.current.disabled)trigger.current.focus();};
 return <><button ref={trigger} className="btn btn-ghost btn-small" disabled={disabled} onClick={()=>dialog.current?.showModal()}>{label}</button><dialog ref={dialog} aria-labelledby={id} onCancel={e=>{e.preventDefault();close();}} onClose={()=>{if(trigger.current?.isConnected&&!trigger.current.disabled)trigger.current.focus();}}><div className="stack"><h2 id={id}>{label}</h2>{children(close)}<div className="actions"><button className="btn btn-ghost btn-small" autoFocus type="button" onClick={close}>關閉</button></div></div></dialog></>;
}
function Ship({c,order,writable}:{c:Controller;order:DropShipOrder;writable:boolean}) {
 const [carrier,setCarrier]=useState(''),[other,setOther]=useState(''),[tracking,setTracking]=useState(''),[date,setDate]=useState(new Date(Date.now()+8*3600000).toISOString().slice(0,10)),[error,setError]=useState(''),name='drop-ship:'+order.order_ref;
 useEffect(()=>()=>c.markDirty(name,false),[c.markDirty,name]);const edit=()=>{c.markDirty(name,true);setError('');};
 return <Dialog label="登記出貨" disabled={c.locked||!writable}>{close=><form className="stack" onSubmit={e=>{e.preventDefault();const parsed=selfShipmentDraft({carrier,other,tracking,date});if(!parsed.body){setError(Object.values(parsed.fields).join(' '));return;}c.command({label:'登記出貨',path:c.root+'/supplier-console/drop-ship/orders/'+order.order_ref+'/ship',body:parsed.body,ifMatch:order.version,schema:DropShipOrderSchema,sensitive:true,success:()=>{c.markDirty(name,false);close();}});}}>
 <p>訂單 {order.display_number}：全部商品同一件包裹寄出。登記後扣除庫存並通知買家，出貨紀錄不能修改。</p>{error&&<p role="alert">{error}</p>}
 <fieldset className="stack" disabled={c.locked||!writable}><legend className="sr-only">出貨資料</legend><label className="field">物流業者<select required value={carrier} onChange={e=>{setCarrier(e.target.value);edit();}}><option value="">請選擇</option>{Object.entries(SELF_SHIP_CARRIER_LABELS).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
 {carrier==='other'&&<label className="field">物流業者名稱<input maxLength={40} value={other} onChange={e=>{setOther(e.target.value);edit();}}/></label>}
 <label className="field">物流單號<input required maxLength={50} autoComplete="off" value={tracking} onChange={e=>{setTracking(e.target.value);edit();}}/></label><label className="field">寄出日期<input type="date" required min={new Date(Date.parse(order.payment_confirmed_at)+8*3600000).toISOString().slice(0,10)} max={new Date(Date.now()+8*3600000).toISOString().slice(0,10)} value={date} onChange={e=>{setDate(e.target.value);edit();}}/></label>
 <p className="field-hint">請填寫確認收款日到今天之間的台北日期。</p><div className="actions"><button className="btn btn-primary" type="submit">確認登記出貨</button></div></fieldset></form>}</Dialog>;
}
function Unable({c,order,writable}:{c:Controller;order:DropShipOrder;writable:boolean}) {
 const [selected,setSelected]=useState('cannot_ship'),[note,setNote]=useState(''),[error,setError]=useState(''),name='drop-unable:'+order.order_ref;
 useEffect(()=>()=>c.markDirty(name,false),[c.markDirty,name]);
 return <Dialog label="無法出貨" disabled={c.locked||!writable}>{close=><form className="stack" onSubmit={e=>{e.preventDefault();const parsed=DropShipUnableSchema.safeParse({reason:selected,...(note?{note}:{})});if(!parsed.success){setError('請選擇原因，補充最多 200 字。');return;}c.command({label:'回報無法出貨',path:c.root+'/supplier-console/drop-ship/orders/'+order.order_ref+'/unable',body:parsed.data,ifMatch:order.version,schema:DropShipOrderSchema,success:()=>{c.markDirty(name,false);close();}});}}>
 {error&&<p role="alert">{error}</p>}<p>請勿填寫買家或收件人的個人資料。店家收到通知後會處理取消與退款。</p><fieldset className="stack" disabled={c.locked||!writable}><legend className="sr-only">無法出貨原因</legend><label className="field">原因<select value={selected} onChange={e=>{setSelected(e.target.value);c.markDirty(name,true);}}>{Object.entries(reason).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="field">補充說明（選填）<textarea maxLength={200} value={note} onChange={e=>{setNote(e.target.value);c.markDirty(name,true);}}/></label><div className="actions"><button className="btn btn-primary" type="submit">回報無法出貨</button></div></fieldset></form>}</Dialog>;
}
function Orders({c,writable}:{c:Controller;writable:boolean}) {
 const [tab,setTab]=useState<'waiting'|'shipped'>('waiting'),[cursors,setCursors]=useState<(string|undefined)[]>([undefined]),cursor=cursors.at(-1),key='drop-orders:'+tab+':'+(cursor??'first');
 const r=useRead(c,key,'/supplier-console/drop-ship/orders?'+new URLSearchParams({tab,limit:'20',...(cursor?{cursor}:{})}),DropShipOrdersSchema);
 return <section className="stack"><h2 tabIndex={-1}>代出貨訂單</h2><div className="actions" role="group" aria-label="代出貨訂單狀態">{(['waiting','shipped'] as const).map(t=><button key={t} className="btn btn-ghost btn-small" aria-pressed={tab===t} disabled={c.locked} onClick={()=>{setTab(t);setCursors([undefined]);}}>{t==='waiting'?'等待出貨':'已出貨'}</button>)}</div>
 <ReadStatus c={c} name={key} label="代出貨訂單" slot={r}/>{r.data&&!r.data.items.length&&<p>目前沒有{tab==='waiting'?'等待出貨':'已出貨'}的訂單。</p>}
 {r.data?.items.map(order=><article className="card stack sc-section" key={order.order_ref}><h3 tabIndex={-1}>{order.store_name} · {order.display_number}</h3><p>確認收款：{formatIsoLocal(order.payment_confirmed_at)} · 承諾寄出日：{order.ship_by}</p><ul>{order.items.map(i=><li key={i.sku}>{i.title} · {i.sku} × {i.quantity} · 供應成本 {formatMinor(i.supply_cost_minor,'TWD')}</li>)}</ul><p>供應成本：{formatMinor(order.supply_cost_minor,'TWD')}；代出貨費（含郵資）：{formatMinor(order.drop_ship_fee_minor,'TWD')}。由店家於平台外支付。</p>
 {order.recipient?<section className="stack" aria-label="寄送收件資料"><h4>寄送收件資料</h4><p>{order.recipient.name} · {order.recipient.mobile}</p><p>{order.recipient.postal_code} {order.recipient.address}</p><p className="field-hint">只可用於寄送。</p></section>:<p>收件資料已依保存期限移除</p>}
 {order.shipment?<p>已出貨：{order.shipment.carrier_name??SELF_SHIP_CARRIER_LABELS[order.shipment.carrier_key]} · {order.shipment.tracking_number??'單號已移除'} · {order.shipment.sent_on}</p>:<>{order.unable&&<p role="status">已回報無法出貨：{reason[order.unable.reason]}{order.unable.note?' · '+order.unable.note:''}</p>}<div className="actions"><Ship c={c} order={order} writable={writable&&r.state==='ready'}/><Unable c={c} order={order} writable={writable&&r.state==='ready'}/></div></>}</article>)}
 <div className="actions"><button className="btn btn-ghost btn-small" disabled={c.locked||cursors.length===1||r.state!=='ready'} onClick={()=>setCursors(v=>v.slice(0,-1))}>上一頁</button><button className="btn btn-ghost btn-small" disabled={c.locked||!r.data?.next_cursor||r.state!=='ready'} onClick={()=>setCursors(v=>[...v,r.data!.next_cursor!])}>下一頁</button></div></section>;
}
export function SupplierDropShip({parent,agreements}:{parent:ConsoleController;agreements:boolean}) {
 const c=useController(parent.client,parent.root,parent.registerExtension),p=useRead(c,'store','/supply-profile',SupplyCatalogViewSchema),capability=agreements?'store:manage':'store:fulfil',allowed=p.data?.capabilities.includes(capability);
 return <div className="stack">{c.notice&&<p role="status">{c.notice}</p>}{c.error&&<p role="alert">{c.error}</p>}{c.phase==='unknown'&&<div className="actions"><button className="btn btn-ghost btn-small" onClick={c.retry}>重試原操作</button></div>}{c.refused&&<div className="actions"><button className="btn btn-ghost btn-small" onClick={()=>void c.recheck()}>重新確認權限</button></div>}{c.pending.map(k=><ReadStatus key={k} c={c} name={k} label="操作後的資料"/>)}{p.data&&!allowed?<Permission/>:!p.data?<ReadStatus c={c} name="store" label="供貨商品庫" slot={p}/>:agreements?<DropShipAgreements c={c} supplier writable={p.data.writable}/>:<Orders c={c} writable={p.data.writable}/>}</div>;
}
