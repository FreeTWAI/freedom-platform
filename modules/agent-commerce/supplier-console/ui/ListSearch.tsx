import {useEffect,useId,useRef,useState} from 'react';

/** Local filtering only. Keep the confirmed search while a Chinese IME is composing. */
export function ListSearch({label,hint,value,onChange,count,total,truncated=false,stale=false}:{
 label:string;hint:string;value:string;onChange:(value:string)=>void;
 count:number;total:number;truncated?:boolean;stale?:boolean;
}){
 const id=useId(),input=useRef<HTMLInputElement>(null),composition=useRef(false);
 const [draft,setDraft]=useState(value),[composing,setComposing]=useState(false);
 useEffect(()=>{if(!composition.current)setDraft(value);},[value]);
 const clear=()=>{composition.current=false;setComposing(false);setDraft('');onChange('');input.current?.focus();};
 return <div className="stack">
  <div className="sc-toolbar"><label className="field" htmlFor={id}>{label}<input ref={input} id={id} type="search" autoComplete="off" value={draft}
   aria-describedby={`${id}-hint ${id}-count`} placeholder={hint}
   onChange={event=>{const text=event.target.value;setDraft(text);if(!composition.current)onChange(text);}}
   onCompositionStart={()=>{composition.current=true;setComposing(true);}}
   onCompositionEnd={event=>{composition.current=false;setComposing(false);setDraft(event.currentTarget.value);onChange(event.currentTarget.value);}}
   onKeyDown={event=>{if(composition.current||event.nativeEvent.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'&&draft){event.preventDefault();event.stopPropagation();clear();}}}/></label>
   <button type="button" className="btn btn-ghost btn-small" disabled={!draft&&!value} onClick={clear}>清除搜尋</button>
  </div>
  <p className="field-hint" id={`${id}-hint`}>{hint}；可用空格組合關鍵字，不分英文大小寫與全半形。搜尋只篩選這裡已載入的資料。</p>
  <p className="field-hint" role="status" id={`${id}-count`} aria-atomic="true">{composing?'選字中，完成後更新搜尋結果。':`顯示 ${count}／${total} 筆已載入資料。`}{truncated?'目前僅載入部分資料，搜尋結果不代表全部紀錄。':''}{stale?'以下為上次讀取的資料，最新狀態仍待確認。':''}</p>
 </div>;
}
