import {useId,useImperativeHandle,useLayoutEffect,useRef,useState,type Ref} from 'react';
import {answerQuestion,availablePage,chooseIntent,HELPER_INTENTS,type HelperIntentId,type HelperKnowledge,type HelperPageId,type HelperResult} from './model';
import './helper.css';

export type HelperDialogChange={dialogId:string;origin:HTMLElement|null}&(
  {open:true}|{open:false;reason:'dismiss'|'native'|'teardown'}
);
export type HelperDialogController={
  readonly dialogId:string;
  readonly open:boolean;
  /** Explicit user-triggered request only. False means refused, never queued. */
  requestOpen:(origin:HTMLElement)=>boolean;
};
export type PlatformHelperProps={
  pageId:string;
  /** Opaque login generation; never render, persist or send this value. */
  accountScope:string;
  availablePageIds:readonly HelperPageId[];
  knowledge:HelperKnowledge;
  onNavigate:(pageId:HelperPageId)=>void;
  /** Host coordinates all other dialogs, menus and blocking surfaces. */
  blocked:boolean;
  /** Optional scoped controller; the member host does not wire this yet. */
  controllerRef?:Ref<HelperDialogController>;
  /** External launchers own deferred focus restoration after manual dismissal. */
  onDialogChange?:(change:HelperDialogChange)=>void;
};
export function PlatformHelper(props:PlatformHelperProps){
  // Unmount instead of an after-paint reset: no previous account/page frame.
  if(props.blocked)return null;
  return <HelperSession key={JSON.stringify([props.accountScope,props.pageId])} {...props}/>;
}
function HelperSession({pageId,availablePageIds,knowledge,onNavigate,controllerRef,onDialogChange}:PlatformHelperProps){
  const id=useId();
  const dialog=useRef<HTMLDialogElement>(null);
  const launcher=useRef<HTMLButtonElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const composing=useRef(false);
  const [open,setOpen]=useState(false);
  const [question,setQuestion]=useState('');
  const [result,setResult]=useState<HelperResult|null>(null);
  const [notice,setNotice]=useState('');
  const lease=useRef({active:false});
  const opening=useRef<{origin:HTMLElement|null;external:boolean}|null>(null);
  const changeListener=useRef(onDialogChange);changeListener.current=onDialogChange;
  function notify(change:HelperDialogChange){
    // An optional presentation listener cannot prevent lifecycle cleanup.
    try{changeListener.current?.(change);}catch{/* No exception details or telemetry. */}
  }
  useLayoutEffect(()=>{
    // Reconnected layout effects can reuse DOM after the old lease ended. Start
    // closed rather than revive a native dialog whose opening record was cleared.
    if(dialog.current?.open)dialog.current.close();
    reset();setOpen(false);
    const current={active:true};lease.current=current;
    return()=>{
      current.active=false;
      const previous=opening.current;opening.current=null;
      if(previous)notify({dialogId:id,open:false,reason:'teardown',origin:previous.origin});
    };
  },[]);
  useImperativeHandle(controllerRef,()=>{
    const current=lease.current;
    return {dialogId:id,get open(){return current.active&&Boolean(dialog.current?.open);},
      requestOpen(origin:HTMLElement){return current.active&&launch(origin,true);}};
  },[]);
  function reset(){setQuestion('');setResult(null);setNotice('');composing.current=false;}
  function finish(reason:'dismiss'|'native'){
    const previous=opening.current;opening.current=null;
    reset();setOpen(false);
    if(reason==='dismiss')dialog.current?.close();
    // Guide triggers may still be disabled by modal suppression. The future host
    // owns external-origin restoration; never focus them early or schedule retries.
    if(reason==='dismiss'&&previous&&!previous.external&&launcher.current?.isConnected&&!launcher.current.disabled)launcher.current.focus();
    if(previous)notify({dialogId:id,open:false,reason,origin:previous.origin});
  }
  function close(){finish('dismiss');}
  function launch(origin:HTMLElement|null=launcher.current,external=false):boolean{
    const target=dialog.current;
    if(!target||target.open)return false;
    if(external&&(!target.isConnected||!origin?.isConnected||origin.ownerDocument!==target.ownerDocument||origin.matches(':disabled,[aria-disabled="true"]')||origin.closest('[inert],[hidden],[aria-hidden="true"]')))return false;
    if(external){
      const style=origin!.ownerDocument.defaultView?.getComputedStyle(origin!);
      if(!origin!.getClientRects().length||!style||style.display==='none'||style.visibility==='hidden')return false;
    }
    const foreignModal=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]')).some(node=>!node.closest('[hidden],[aria-hidden="true"]')&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden');
    if(document.querySelector('dialog[open]')||foreignModal){setNotice('請先關閉目前的對話框，再開啟問路助手。');return false;}
    try{target.showModal();}catch{return false;}
    reset();opening.current={origin,external};setOpen(true);input.current?.focus();
    notify({dialogId:id,open:true,origin});return true;
  }
  function selectIntent(intent:HelperIntentId){
    setNotice('');setQuestion('');setResult(chooseIntent(intent,availablePageIds,knowledge));
  }
  const pageIds=result?.kind==='pages'?result.pageIds:[];
  const pages=pageIds.flatMap(id=>{const page=availablePage(id,availablePageIds,knowledge);return page?[page]:[];});
  const current=availablePage(pageId,availablePageIds,knowledge);
  const choices=HELPER_INTENTS.filter(intent=>(!result||result.kind!=='clarify'||result.intentIds.includes(intent.id))&&chooseIntent(intent.id,availablePageIds,knowledge).kind==='pages');
  return <div className="platform-helper">
    <button ref={launcher} type="button" className="btn btn-secondary btn-small" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={()=>launch()}>問路助手</button>
    {!open&&notice&&<span role="status">{notice}</span>}
    <dialog ref={dialog} id={id} className="platform-helper-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event=>{event.preventDefault();close();}} onClose={()=>{if(!dialog.current?.open)finish('native');}}>
      <header><h2 id={`${id}-title`}>站內問路助手・非生成式 AI</h2><button type="button" className="btn btn-secondary btn-small" onClick={close}>關閉</button></header>
      <div className="platform-helper-body">
        <p id={`${id}-description`}>不知道從哪裡開始？選一個方向，或輸入簡短問題。只依站內公開說明指路，不讀取私人工作或聊天，也不會代你操作。</p>
        <form onSubmit={event=>{event.preventDefault();event.stopPropagation();if(composing.current)return;setNotice('');setResult(answerQuestion(question,availablePageIds,knowledge));setQuestion('');}}>
          <label htmlFor={`${id}-question`}>你想做什麼？（最多 240 字）</label>
          <input ref={input} id={`${id}-question`} value={question} maxLength={240} autoComplete="off" onChange={event=>setQuestion(event.target.value)} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||event.keyCode===229||composing.current))event.preventDefault();}} placeholder="例如：怎麼學 AI？"/>
          <button type="submit" className="btn btn-secondary btn-small">詢問</button>
        </form>
        <div role="status" aria-live="polite">
          {notice&&<p>{notice}</p>}
          {!notice&&result?.kind==='pages'&&pages.length>0&&<p>找到 {pages.length} 個可用入口，請選擇下方頁面。</p>}
          {result?.kind==='invalid'&&<p>{result.reason==='long'?'問題超過 240 字，請縮短後再問。':'請先輸入問題，或選擇下面的方向。'}</p>}
          {result?.kind==='unknown'&&<p>目前只能辨識少數站內方向，無法回答這個問題。請選擇方向，或查看本頁說明。</p>}
          {result?.kind==='clarify'&&<p>你提到了不只一個方向，想先看哪一個？</p>}
          {(result?.kind==='unavailable'||(result?.kind==='pages'&&!pages.length)||(result?.kind==='clarify'&&!choices.length))&&<p>目前沒有可提供的入口，請查看本頁原有說明。</p>}
        </div>
        <div className="platform-helper-choices" aria-label="選擇問路方向">{choices.map(intent=><button key={intent.id} type="button" className="btn btn-secondary btn-small" onClick={()=>selectIntent(intent.id)}>{intent.label}</button>)}</div>
        {result?.kind==='unknown'&&current&&<button type="button" className="btn btn-secondary btn-small" onClick={()=>setResult({kind:'pages',pageIds:[current.id]})}>查看本頁說明</button>}
        {pages.map(page=><section key={page.id} className="platform-helper-card" aria-label={page.title}>
          <h3>{page.title}</h3><p>{page.summary}</p>
          {page.steps.length>0&&<ol>{page.steps.map((step,index)=><li key={index}>{step}</li>)}</ol>}
          {page.note&&<p>{page.note}</p>}
          <button type="button" className="btn btn-secondary btn-small" onClick={()=>{if(!availablePage(page.id,availablePageIds,knowledge))return;try{onNavigate(page.id);}catch{setNotice('目前無法切換頁面，請稍後再試，或關閉助手後使用原有導覽。');}}}>前往{page.title}</button>
        </section>)}
        {pages.length>0&&<p className="platform-helper-note">前往只會請求切換頁面；若原頁需要確認離開，請依原提示處理。加入、發布或付款仍須在原頁由你確認。</p>}
      </div>
    </dialog>
  </div>;
}
