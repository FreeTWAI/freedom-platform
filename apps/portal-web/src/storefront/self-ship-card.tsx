import {SELF_SHIP_CARRIER_LABELS,type PublicOrder} from '../../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {formatCalendarDate} from './format.js';
type View=Pick<PublicOrder,'self_ship'|'lifecycle_state'>;
export function selfShipCardState(order:View){
 if(!order.self_ship)return 'absent';
 if(order.self_ship.shipment)return order.self_ship.shipment.redacted?'redacted':'sent';
 if(order.lifecycle_state!=='open')return 'absent';
 return order.self_ship.ship_by?'waiting_ship':'waiting_payment';
}
export function SelfShipCard({order}:{order:View}){
 const state=selfShipCardState(order),ship=order.self_ship,shipment=ship?.shipment;
 if(state==='absent'||!ship)return null;
 return <section className="shop-order-section" aria-labelledby="shop-order-self-ship-heading">
  <h2 id="shop-order-self-ship-heading">{ship.fulfilment_mode==='drop_ship'?'由供應商寄出':'宅配（店家自行寄送）'}</h2>
  {shipment?<><p className="shop-pay-label">已出貨</p><p>物流業者：{shipment.redacted?SELF_SHIP_CARRIER_LABELS[shipment.carrier_key]:shipment.carrier_name??SELF_SHIP_CARRIER_LABELS[shipment.carrier_key]}</p>
   {!shipment.redacted&&<p>物流單號：{shipment.tracking_number}</p>}<p>店家登記於 {formatCalendarDate(shipment.sent_on)} 寄出。</p>
   <p>只記錄店家填寫的資訊，工坊不追蹤物流、不核實簽收。</p></>:<>
   <p className="shop-pay-label">{state==='waiting_payment'?'等待付款確認':'等待出貨'}</p>
   {ship.ship_by?<p>店家承諾於 {formatCalendarDate(ship.ship_by)} 前寄出。</p>:<p>店家確認收款後 {ship.handling_days} 個工作天內寄出。</p>}
   <p>工作天為週一至週五，不另排除國定假日。</p>{ship.note&&<p className="shop-preserve-lines">{ship.note}</p>}
  </>}
 </section>;
}
