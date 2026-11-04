import type {ReactNode} from 'react';
import type {EventPrizeDetail} from '../../../../modules/community/event-prize-details';
import {validEventPrizePhotos,type EventPrizePhoto as Photo} from './event-prize-photo-client';
import {EventPrizePhoto} from './EventPrizePhoto';
import {eventPrizeDetailsSchema} from '../../../../modules/community/event-prize-details';
import {EventPrizeIcon} from './EventPrizeIcon';
import './EventPrizeDetails.css';

export function EventPrizeDetails({value,preview=false,eventId,photos,publicRead=false,renderPhotoAction}:{value:unknown;preview?:boolean;eventId?:string;photos?:Photo[];publicRead?:boolean;renderPhotoAction?:(prize:EventPrizeDetail)=>ReactNode}) {
  // Omitted data is compatible with historical events and old cached receipts.
  const parsed=eventPrizeDetailsSchema.safeParse(value===undefined?[]:value);
  if(!parsed.success)return <p role="alert">獎品資料無法確認，請重新讀取活動後再查看。</p>;
  if(!parsed.data.length)return null;
  const validPhotos=photos===undefined||Boolean(eventId&&validEventPrizePhotos(photos,eventId,parsed.data,publicRead));
  const safePhotos=validPhotos?photos??[]:[];
  return <section className="event-prize-details" aria-label={preview?'獎品預覽':'活動獎品說明'}>
    <h4>活動獎品</h4>
    {!validPhotos&&<p role="status">照片資料無法確認，請重新讀取活動。內建插圖僅供示意。</p>}
    {parsed.data.map(item=><article className="event-prize-card" key={item.prize_id}>
      <div className="event-prize-heading"><EventPrizeIcon iconId={item.icon_id}/><div><h5>{item.name}</h5><p>共 {item.quantity} 份</p></div></div>
      {!preview&&eventId&&safePhotos.some(photo=>photo.prize_id===item.prize_id)&&<EventPrizePhoto eventId={eventId} prize={item} photo={safePhotos.find(photo=>photo.prize_id===item.prize_id)!} publicRead={publicRead}/>}
      {!preview&&validPhotos&&renderPhotoAction?.(item)}
      {item.description&&<p className="multiline-text">{item.description}</p>}
      <dl><div><dt>要做到什麼</dt><dd>{item.completion_rule}</dd></div><div><dt>怎麼領取</dt><dd>{item.claim_note}</dd></div></dl>
    </article>)}
    <p className="field-hint">內建插圖僅供示意，不是獎品實拍照片。以上為主辦者的獎品說明，不代表已發獎；報名、活動結束或分享成果也不代表已符合條件。</p>
  </section>;
}
