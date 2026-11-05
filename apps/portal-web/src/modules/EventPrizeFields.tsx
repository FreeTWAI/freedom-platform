import {useId,useLayoutEffect,useRef,useState} from 'react';
import {eventPrizeDetailSchema,eventPrizeDetailsSchema,EVENT_PRIZE_LIMIT,EVENT_PRIZE_QUANTITY_LIMIT,type EventPrizeDetail} from '../../../../modules/community/event-prize-details';
import {DEFAULT_EVENT_PRIZE_ICON_ID} from '../../../../modules/community/event-prize-icons';
import {EventPrizeIcon} from './EventPrizeIcon';
import {EventPrizeIconPicker} from './EventPrizeIconPicker';
import './EventPrizeDetails.css';

export type EventPrizeDraft=Omit<EventPrizeDetail,'quantity'>&{quantity:string};
export function newEventPrize():EventPrizeDraft {
  return {prize_id:crypto.randomUUID(),name:'',description:'',quantity:'1',icon_id:DEFAULT_EVENT_PRIZE_ICON_ID,completion_rule:'',claim_note:''};
}
export const eventPrizeDrafts=(items:readonly EventPrizeDetail[]):EventPrizeDraft[]=>items.map(item=>({...item,quantity:String(item.quantity)}));
export const eventPrizePayload=(items:readonly EventPrizeDraft[]):EventPrizeDetail[]=>items.map(item=>({...item,
  name:item.name.trim(),description:item.description.trim(),quantity:Number(item.quantity),completion_rule:item.completion_rule.trim(),claim_note:item.claim_note.trim()}));

export function EventPrizeDraftPreview({value}:{value:readonly EventPrizeDraft[]}) {
  if(!value.length)return null;
  return <section className="event-prize-details" aria-label="獎品預覽"><h4>活動獎品</h4>
    {value.map(item=><article className="event-prize-card" key={item.prize_id}>
      <div className="event-prize-heading"><EventPrizeIcon iconId={item.icon_id}/><div><h5>{item.name.trim()||'尚未填寫獎品名稱'}</h5><p>{/^\d+$/.test(item.quantity)&&Number(item.quantity)>=1&&Number(item.quantity)<=EVENT_PRIZE_QUANTITY_LIMIT?`共 ${Number(item.quantity)} 份`:'請填寫有效的獎品份數'}</p></div></div>
      {item.description&&<p className="multiline-text">{item.description}</p>}
      <dl><div><dt>要做到什麼</dt><dd>{item.completion_rule.trim()||'尚未填寫獲得條件'}</dd></div><div><dt>怎麼領取</dt><dd>{item.claim_note.trim()||'尚未填寫領取說明'}</dd></div></dl>
    </article>)}
    <p className="field-hint">平台插圖，非實物照片。這份獎品說明尚未送出審核，也不代表已發獎。</p>
  </section>;
}

type PrizeTextField='name'|'description'|'quantity'|'completion_rule'|'claim_note';
const fieldLabels:Record<PrizeTextField,string>={name:'獎品名稱',description:'獎品介紹（選填）',quantity:'準備幾份',completion_rule:'要做到什麼',claim_note:'怎麼領取'};
export function eventPrizeFieldError(field:PrizeTextField,value:string):string {
  const parsed=eventPrizeDetailSchema.shape[field].safeParse(field==='quantity'?Number(value):value);
  if(parsed.success&&(field!=='quantity'||/^\d+$/.test(value)))return '';
  if(field==='quantity')return `請填寫 1 到 ${EVENT_PRIZE_QUANTITY_LIMIT} 的整數份數。`;
  if(!value.trim()&&field!=='description')return `請填寫${fieldLabels[field]}。`;
  return `請使用有效文字，最多 ${field==='name'?120:500} 字。`;
}
function PrizeField({field,value,onChange,placeholder}:{field:PrizeTextField;value:string;onChange:(value:string)=>void;placeholder?:string}) {
  const id=useId(),input=useRef<HTMLInputElement|HTMLTextAreaElement|null>(null),[showError,setShowError]=useState(false);
  const error=eventPrizeFieldError(field,value),invalid=showError&&!!error;
  // Zod counts Unicode code points. Native maxlength is only a 2× UTF-16 safety bound.
  // Custom validity enforces the exact text limit and whitespace/quantity rules.
  useLayoutEffect(()=>{input.current?.setCustomValidity(error);},[error]);
  const common={id,value,required:field!=='description','aria-invalid':invalid||undefined,'aria-describedby':invalid?`${id}-error`:undefined,
    onChange:(e:{target:{value:string}})=>onChange(e.target.value),onInvalid:()=>setShowError(true),onBlur:()=>setShowError(true),placeholder};
  return <div className="field"><label htmlFor={id}>{fieldLabels[field]}</label>
    {field==='name'?<input {...common} ref={node=>{input.current=node;}} data-prize-name maxLength={240}/>
      :field==='quantity'?<input {...common} ref={node=>{input.current=node;}} type="number" inputMode="numeric" min={1} max={EVENT_PRIZE_QUANTITY_LIMIT} step={1}/>
      :<textarea {...common} ref={node=>{input.current=node;}} rows={field==='description'?2:3} maxLength={1000}/>}
    {invalid&&<p id={`${id}-error`} className="field-error" role="alert">{error}</p>}
  </div>;
}

export function EventPrizeFields({value,onChange,disabled=false}:{value:EventPrizeDraft[];onChange:(next:EventPrizeDraft[])=>void;disabled?:boolean}) {
  const group=useRef<HTMLDivElement|null>(null),cancel=useRef<HTMLButtonElement|null>(null),[removing,setRemoving]=useState<string|null>(null);
  useLayoutEffect(()=>{if(removing)cancel.current?.focus();},[removing]);
  function update(id:string,patch:Partial<EventPrizeDraft>){if(!disabled)onChange(value.map(item=>item.prize_id===id?{...item,...patch}:item));}
  function add(){
    if(disabled||value.length>=EVENT_PRIZE_LIMIT)return;
    onChange([...value,newEventPrize()]);
    requestAnimationFrame(()=>group.current?.querySelectorAll<HTMLInputElement>('[data-prize-name]').item(value.length)?.focus());
  }
  function remove(id:string,index:number){
    if(disabled)return;
    onChange(value.filter(item=>item.prize_id!==id));setRemoving(null);
    requestAnimationFrame(()=>{
      const inputs=group.current?.querySelectorAll<HTMLInputElement>('[data-prize-name]');
      if(inputs?.length)inputs.item(Math.min(index,inputs.length-1))?.focus();
      else group.current?.querySelector<HTMLButtonElement>('[data-prize-add]')?.focus();
    });
  }
  return <div ref={group} className="event-prize-editor">
    <h4>活動獎品（選填）</h4>
    <p className="field-hint">有獎品時，請寫清楚獎品、獲得條件與領取方式。內容會隨活動一起審核，並依活動的參與範圍顯示。請勿填寫私人聯絡資料或報名後才可看的連結。</p>
    {value.map((item,index)=><fieldset key={item.prize_id} className="event-prize-fields" disabled={disabled}>
      <legend>獎品 {index+1}</legend>
      <PrizeField field="name" value={item.name} onChange={name=>update(item.prize_id,{name})} placeholder="例如：一本入門書"/>
      <PrizeField field="description" value={item.description} onChange={description=>update(item.prize_id,{description})}/>
      <PrizeField field="quantity" value={item.quantity} onChange={quantity=>update(item.prize_id,{quantity})}/>
      <PrizeField field="completion_rule" value={item.completion_rule} onChange={completion_rule=>update(item.prize_id,{completion_rule})} placeholder="例如：完成現場練習後，由主辦者依作品評選 3 位。請說明如何選出得獎者。"/>
      <PrizeField field="claim_note" value={item.claim_note} onChange={claim_note=>update(item.prize_id,{claim_note})} placeholder="例如：活動結束前由主辦者公布結果，得獎者當場領取。"/>
      <EventPrizeIconPicker value={item.icon_id} onChange={icon_id=>update(item.prize_id,{icon_id})} disabled={disabled}/>
      {removing===item.prize_id?<div role="group" aria-label={`確認移除獎品 ${index+1}`}><p>要移除「{item.name.trim()||`獎品 ${index+1}`}」嗎？這項尚未儲存的內容會從草稿移除。</p>
        <button type="button" className="btn btn-danger btn-small" disabled={disabled} onClick={()=>remove(item.prize_id,index)}>確認移除</button>
        <button ref={cancel} type="button" className="btn btn-secondary btn-small" disabled={disabled} onClick={()=>{setRemoving(null);requestAnimationFrame(()=>group.current?.querySelector<HTMLButtonElement>(`[data-prize-remove="${item.prize_id}"]`)?.focus());}}>保留獎品</button>
      </div>:<button data-prize-remove={item.prize_id} type="button" className="btn btn-ghost btn-small" disabled={disabled} onClick={()=>{
        if(item.name||item.description||item.completion_rule||item.claim_note||item.quantity!=='1'||item.icon_id!==DEFAULT_EVENT_PRIZE_ICON_ID)setRemoving(item.prize_id);
        else remove(item.prize_id,index);
      }}>移除獎品 {index+1}</button>}
    </fieldset>)}
    <button data-prize-add type="button" className="btn btn-secondary btn-small" disabled={disabled||value.length>=EVENT_PRIZE_LIMIT} onClick={add}>{value.length?'再加一項獎品':'加入獎品'}</button>
    {value.length>=EVENT_PRIZE_LIMIT&&<p className="field-hint">一場活動最多可填 {EVENT_PRIZE_LIMIT} 項獎品。</p>}
    {value.length>0&&<p className="field-hint">這裡只刊登主辦者的獎品說明，不會自動選出得獎者或發獎。報名不代表已出席、完成條件或獲獎。</p>}
  </div>;
}
