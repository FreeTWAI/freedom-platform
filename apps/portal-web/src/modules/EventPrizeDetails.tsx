import {eventPrizeDetailsSchema} from '../../../../modules/community/event-prize-details';
import {EventPrizeIcon} from './EventPrizeIcon';
import './EventPrizeDetails.css';

export function EventPrizeDetails({value,preview=false}:{value:unknown;preview?:boolean}) {
  // Omitted data is compatible with historical events and old cached receipts.
  const parsed=eventPrizeDetailsSchema.safeParse(value===undefined?[]:value);
  if(!parsed.success)return <p role="alert">獎品資料無法確認，請重新讀取活動後再查看。</p>;
  if(!parsed.data.length)return null;
  return <section className="event-prize-details" aria-label={preview?'獎品預覽':'活動獎品說明'}>
    <h4>活動獎品</h4>
    {parsed.data.map(item=><article className="event-prize-card" key={item.prize_id}>
      <div className="event-prize-heading"><EventPrizeIcon iconId={item.icon_id}/><div><h5>{item.name}</h5><p>共 {item.quantity} 份</p></div></div>
      {item.description&&<p className="multiline-text">{item.description}</p>}
      <dl><div><dt>要做到什麼</dt><dd>{item.completion_rule}</dd></div><div><dt>怎麼領取</dt><dd>{item.claim_note}</dd></div></dl>
    </article>)}
    <p className="field-hint">內建插圖僅供示意，不是獎品實拍照片。以上為主辦者的獎品說明，不代表已發獎；報名、活動結束或分享成果也不代表已符合條件。</p>
  </section>;
}
