import type {PublicOrder} from '../../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {DELIVERY_NAMES} from './delivery-copy.js';
import {formatCalendarDate} from './format.js';

export function MeetupCard({order}: {order: PublicOrder}) {
  const notes = order.meetup_notes ?? [];
  const handover = order.meetup_handover;
  if (!notes.length || (order.lifecycle_state !== 'open' && !handover)) return null;
  return <section className="shop-order-section" aria-labelledby="shop-order-meetup-heading">
    <h2 id="shop-order-meetup-heading">{DELIVERY_NAMES.meetup}</h2>
    {handover ? <>
      <p className="shop-pay-label">已面交</p>
      <p>店家已登記在 {formatCalendarDate(handover.completed_on)} 完成面交。</p>
    </> : <>
      <p className="shop-pay-label">等待面交</p>
      <p>店家會用你留下的手機或 Email 和你約時間地點。</p>
      {notes.map((note, index) => <p className="shop-preserve-lines" key={index}>{note}</p>)}
    </>}
  </section>;
}
