import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ApiError,type PortalClient} from '../api';
import type {CommunityEvent} from './EventsPanel';
import type {EventPrizeDetail} from '../../../../modules/community/event-prize-details';
import {currentPrizePhotoEvent,preparePrizePhotoCommand,prizePhotoAvailability,prizePhotoFileError,sendPrizePhotoCommand,validEventPrizePhoto,type EventPrizePhoto as EventPrizePhotoData,type PrizePhotoCommand} from './event-prize-photo-client';
import './EventPrizePhoto.css';

type ImageProps={eventId:string;prize:EventPrizeDetail;photo:EventPrizePhotoData;publicRead?:boolean};
export function EventPrizePhoto(props:ImageProps){
  const identity=useRef({eventId:props.eventId,prizeId:props.prize.prize_id,url:props.photo.url,version:props.photo.photo_version,publicRead:props.publicRead,revision:0});
  const previous=identity.current;
  if(previous.eventId!==props.eventId||previous.prizeId!==props.prize.prize_id||previous.url!==props.photo.url||previous.version!==props.photo.photo_version||previous.publicRead!==props.publicRead)identity.current={eventId:props.eventId,prizeId:props.prize.prize_id,url:props.photo.url,version:props.photo.photo_version,publicRead:props.publicRead,revision:previous.revision+1};
  const binding=identity.current,isOwner=useCallback(()=>identity.current===binding,[binding]);
  if(!validEventPrizePhoto(props.photo,props.eventId,props.prize.prize_id,props.publicRead))return <p role="status">照片資料無法確認，請重新讀取活動。上方插圖僅供示意。</p>;
  return <PhotoImage key={binding.revision} {...props} isOwner={isOwner}/>;
}
function PhotoImage({prize,photo,isOwner}:ImageProps&{isOwner:()=>boolean}){
  const [failed,setFailed]=useState(false),[retry,setRetry]=useState(0),live=useRef(false),attempt=useRef(0);
  useLayoutEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const token=retry;
  return <div className="event-prize-photo">
    {!failed?<img key={retry} src={photo.url} alt={`${prize.name} 的獎品照片`} onError={()=>{if(live.current&&isOwner()&&attempt.current===token)setFailed(true);}}/>:<div role="status"><p>照片暫時無法載入。上方插圖僅供示意。</p><button type="button" className="btn btn-ghost" onClick={()=>{if(!live.current||!isOwner())return;attempt.current++;setRetry(attempt.current);setFailed(false);}}>重試載入照片</button></div>}
  </div>;
}
export type PrizePhotoWork={pending:boolean;dirty:boolean;refreshing:boolean};
export type PrizePhotoTarget={event:CommunityEvent;prize:EventPrizeDetail};
type EditorProps={client:PortalClient;userId:string;target:PrizePhotoTarget;onState:(state:PrizePhotoWork)=>void;onCurrent:(event:CommunityEvent)=>void;onConfirmed:(eventId:string,version:number)=>void;onClose:()=>void};
const idle:PrizePhotoWork={pending:false,dirty:false,refreshing:false};
export function EventPrizePhotoEditor(props:EditorProps){
  const identity=useRef({client:props.client,generation:props.client.sessionGeneration,csrf:props.client.csrfToken,user:props.userId,event:props.target.event.event_id,prize:props.target.prize.prize_id,revision:0});
  const old=identity.current;
  if(old.client!==props.client||old.generation!==props.client.sessionGeneration||old.csrf!==props.client.csrfToken||old.user!==props.userId||old.event!==props.target.event.event_id||old.prize!==props.target.prize.prize_id)identity.current={client:props.client,generation:props.client.sessionGeneration,csrf:props.client.csrfToken,user:props.userId,event:props.target.event.event_id,prize:props.target.prize.prize_id,revision:old.revision+1};
  const binding=identity.current;
  const isOwner=useCallback(()=>identity.current===binding&&binding.client.sessionGeneration===binding.generation&&binding.client.csrfToken===binding.csrf,[binding]);
  return <PhotoEditorContent key={binding.revision} {...props} isOwner={isOwner}/>;
}
function PhotoEditorContent({client,userId,target,onState,onCurrent,onConfirmed,onClose,isOwner}:EditorProps&{isOwner:()=>boolean}){
  const [event,setEvent]=useState(target.event),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[refreshing,setRefreshing]=useState(false),[stale,setStale]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[removeIntent,setRemoveIntent]=useState(false);
  const [uploadAvailable,setUploadAvailable]=useState<boolean|null>(null),[checkingAvailability,setCheckingAvailability]=useState(false),[availabilityError,setAvailabilityError]=useState('');
  const availability=useRef<boolean|null>(null),availabilityFlight=useRef(false),availabilitySequence=useRef(0);
  const epoch=useRef(0),mounted=useRef(false),flight=useRef(false),uncertain=useRef(false),pending=useRef<PrizePhotoCommand|null>(null),chosen=useRef<File|null>(null);
  const readSequence=useRef(0),readBusy=useRef(false),floor=useRef(event.aggregate_version),view=useRef(event),fresh=useRef(true);
  const controllers=useRef(new Set<AbortController>()),input=useRef<HTMLInputElement|null>(null),removeButton=useRef<HTMLButtonElement|null>(null),heading=useRef<HTMLHeadingElement|null>(null),confirmButton=useRef<HTMLButtonElement|null>(null);
  type FocusReturn={epoch:number;source:Element|null};
  const restoreRemoveFocus=useRef<FocusReturn|null>(null),restorePreviewFocus=useRef<FocusReturn|null>(null);
  const captureFocus=():FocusReturn|null=>{const source=document.activeElement;return source===document.body||source?.closest('.event-prize-photo-editor')?{epoch:epoch.current,source}:null;};
  const canRestoreFocus=(request:FocusReturn)=>document.visibilityState!=='hidden'&&(document.activeElement===request.source||document.activeElement===document.body);
  const current=(run=epoch.current)=>mounted.current&&run===epoch.current&&isOwner();
  const notify=()=>{if(current())onState({pending:pending.current!==null,dirty:chosen.current!==null,refreshing:readBusy.current});};
  useLayoutEffect(()=>{mounted.current=true;epoch.current++;if(isOwner())onState(idle);heading.current?.focus();return()=>{mounted.current=false;epoch.current++;restoreRemoveFocus.current=null;restorePreviewFocus.current=null;readSequence.current++;availabilitySequence.current++;availabilityFlight.current=false;for(const controller of controllers.current)controller.abort();controllers.current.clear();};},[]);
  useEffect(()=>{void readAvailability();},[]);
  useEffect(()=>{
    if(!file){setPreview(null);return;}
    const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);
  },[file]);
  useLayoutEffect(()=>{
    if(removeIntent){restoreRemoveFocus.current=null;if(current())confirmButton.current?.focus();return;}
    const request=restoreRemoveFocus.current;restoreRemoveFocus.current=null;
    // Cancellation alone returns focus, after React enables the trigger again.
    if(!request||!current(request.epoch)||!canRestoreFocus(request)||flight.current||pending.current)return;
    if(removeButton.current?.isConnected&&!removeButton.current.disabled)removeButton.current.focus();
    else heading.current?.focus();
  },[removeIntent]);
  useLayoutEffect(()=>{
    if(file)return;
    const request=restorePreviewFocus.current;restorePreviewFocus.current=null;
    if(!request||!current(request.epoch)||!canRestoreFocus(request)||flight.current||pending.current)return;
    if(input.current?.isConnected&&!input.current.disabled)input.current.focus();
    else heading.current?.focus();
  },[file]);
  const selectedPrize=event.prize_details?.find(prize=>prize.prize_id===target.prize.prize_id);
  const photo=event.prize_photos?.find(photo=>photo.prize_id===target.prize.prize_id);
  const editable=Boolean(selectedPrize&&event.organizer_ref===userId&&event.state==='pending'&&Date.parse(event.starts_at)>Date.now());
  async function readAvailability(){
    if(!current()||availabilityFlight.current)return;
    const seq=++availabilitySequence.current,controller=new AbortController();controllers.current.add(controller);availabilityFlight.current=true;availability.current=null;setUploadAvailable(null);setCheckingAvailability(true);setAvailabilityError('');
    try{
      const value=await client.getEventPrizePhotoAvailability<unknown>(target.event.event_id,target.prize.prize_id,{signal:controller.signal,suppressConsole:true});
      if(!current()||availabilitySequence.current!==seq)return;
      const allowed=prizePhotoAvailability(value,target.event.event_id,target.prize.prize_id,userId);availability.current=allowed;setUploadAvailable(allowed);
    }catch(cause){if(current()&&availabilitySequence.current===seq){availability.current=false;setUploadAvailable(false);setAvailabilityError('照片上傳尚未開放或暫時無法使用。可重新確認上傳狀態。');}}
    finally{controllers.current.delete(controller);if(current()&&availabilitySequence.current===seq){availabilityFlight.current=false;setCheckingAvailability(false);}}
  }
  function choose(next:File|null){
    if(!current()||flight.current||pending.current||readBusy.current||!fresh.current||availability.current!==true)return;
    // Dismissing the native picker is not a request to clear an existing choice.
    if(!next)return;
    const problem=prizePhotoFileError(next);if(problem){setError(problem);return;}
    chosen.current=next;setFile(next);setError('');setNotice('');setRemoveIntent(false);notify();
  }
  function clearSelection(){if(!current()||flight.current||pending.current||!chosen.current)return;restorePreviewFocus.current=captureFocus();chosen.current=null;setFile(null);if(input.current)input.current.value='';setError('');notify();}
  async function readCurrent(){
    if(!current()||flight.current||readBusy.current)return;
    const seq=++readSequence.current,controller=new AbortController();controllers.current.add(controller);
    readBusy.current=true;fresh.current=false;setRefreshing(true);setStale(true);setError('');notify();
    try{
      const value=await client.get<unknown>(`/events/${target.event.event_id}`,{signal:controller.signal,suppressConsole:true});
      if(!current()||readSequence.current!==seq)return;
      const result=currentPrizePhotoEvent(value,target.event.event_id,userId,floor.current);
      floor.current=result.aggregate_version;view.current=result;setEvent(result);fresh.current=true;setStale(false);onCurrent(result);
    }catch(cause){if(current()&&readSequence.current===seq)setError(cause instanceof Error?cause.message:'目前照片無法讀取，請重試。');}
    finally{controllers.current.delete(controller);if(current()&&readSequence.current===seq){readBusy.current=false;setRefreshing(false);notify();}}
  }
  async function send(command:PrizePhotoCommand){
    if(!current()||flight.current||readBusy.current||pending.current&&pending.current!==command)return;
    const run=epoch.current,controller=new AbortController();controllers.current.add(controller);
    // Claim synchronously, before the first await, including duplicate click handlers.
    flight.current=true;pending.current=command;setBusy(true);setRemoveIntent(false);setError('');setNotice('');notify();
    let acknowledged=false;
    try{
      const ack=await sendPrizePhotoCommand(command,controller.signal);
      if(!current(run))return;
      acknowledged=true;pending.current=null;uncertain.current=false;setUnknown(false);
      chosen.current=null;setFile(null);if(input.current)input.current.value='';
      floor.current=Math.max(floor.current,ack.completed_version);fresh.current=false;setStale(true);
      // The receipt may be historical. Do not display its photo or resurrect it.
      setNotice(command.operation==='remove'?'原移除操作已確認。正在重新讀取目前照片。':'原照片儲存操作已確認。正在重新讀取目前照片。');
      onConfirmed(command.eventId,ack.completed_version);notify();
    }catch(cause){
      if(!current(run))return;
      // Same definitive/ambiguous classification as decoded module commands.
      const lost=uncertain.current||!(cause instanceof ApiError)||cause.network||!cause.definitiveResponse||cause.status>=500||cause.status===401||cause.status===403;
      uncertain.current=lost;setUnknown(lost);
      if(!lost){pending.current=null;fresh.current=false;setStale(true);}
      setError(lost?'照片操作結果尚未確認，原照片檔案與操作仍保留。請按「確認原照片操作」，不要重新送出另一張。':cause instanceof Error?cause.message:'照片未能保存，請重新讀取。');
    }finally{
      controllers.current.delete(controller);
      if(current(run)){flight.current=false;setBusy(false);notify();}
    }
    if(acknowledged&&current(run))await readCurrent();
  }
  function save(){
    if(!current()||flight.current||pending.current||readBusy.current||!fresh.current||!chosen.current||availability.current!==true)return;
    try{void send(preparePrizePhotoCommand(client,view.current,target.prize.prize_id,userId,chosen.current));}
    catch(cause){setError(cause instanceof Error?cause.message:'請重新選擇照片。');}
  }
  function remove(){
    if(!current()||flight.current||pending.current||readBusy.current||!fresh.current||!removeIntent)return;
    try{void send(preparePrizePhotoCommand(client,view.current,target.prize.prize_id,userId,null));}
    catch(cause){setError(cause instanceof Error?cause.message:'照片無法移除。');}
  }
  function cancelRemove(){if(!current()||flight.current||pending.current||!removeIntent)return;restoreRemoveFocus.current=captureFocus();setRemoveIntent(false);}
  function close(){if(!current()||flight.current||pending.current)return;if(chosen.current&&!window.confirm('照片尚未儲存。要捨棄這張預覽並返回嗎？'))return;chosen.current=null;onState(idle);onClose();}
  return <section className="event-prize-photo-editor card" aria-label={`${target.prize.name} 的照片設定`} onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.preventDefault();if(removeIntent)cancelRemove();else close();}}}>
    <h4 ref={heading} tabIndex={-1}>{target.prize.name} 的照片</h4>
    <p>活動已送出審核。只有主辦者在尚未開始、仍待審核時可以保存照片；核准後依活動的參與範圍顯示。</p>
    {stale?<p role="status">{refreshing?'正在讀取目前照片…':'目前照片尚未重新確認。請先重新讀取，原操作是否成功以操作回覆為準。'}</p>:photo?<><p>已保存的照片</p><EventPrizePhoto eventId={event.event_id} prize={selectedPrize??target.prize} photo={photo}/></>:<p>目前沒有已保存照片，活動仍使用內建示意圖。</p>}
    {!editable&&<p>活動已開始、狀態改變或獎品已移除，現在不能新增照片。仍可確認先前的原操作。</p>}
    <p role="status">{checkingAvailability?'正在確認照片上傳是否可用…':uploadAvailable===true?'目前可選擇照片。實際保存仍需通過活動與登入狀態檢查。':'照片上傳尚未開放或暫時無法使用。已保存的照片仍可在活動允許編輯時移除。'}</p>
    {availabilityError&&<p role="alert">{availabilityError}</p>}
    <button type="button" className="btn btn-ghost" disabled={checkingAvailability} onClick={()=>void readAvailability()}>重新確認照片上傳狀態</button>
    <label className="field">選擇獎品照片<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={!editable||busy||unknown||refreshing||stale||uploadAvailable!==true} onChange={e=>choose(e.target.files?.[0]??null)}/><small>JPEG、PNG 或 WebP，最大 2 MiB。請確認你有權使用照片；不要放入私人聯絡資料。</small></label>
    {file&&<div className="event-prize-photo-preview"><p><strong>尚未儲存的預覽</strong>：{file.name}（{Math.ceil(file.size/1024)} KiB）</p>{preview&&<img src={preview} alt={`${target.prize.name} 尚未儲存的本機照片預覽`}/>}<p>選檔不會上傳。只有按「儲存照片」才會送出這個檔案。</p><div className="event-prize-photo-actions"><button type="button" className="btn btn-primary" disabled={!editable||busy||unknown||refreshing||stale||uploadAvailable!==true} onClick={save}>儲存照片</button><button type="button" className="btn btn-ghost" disabled={busy||unknown} onClick={clearSelection}>取消這張預覽</button></div></div>}
    {!file&&photo&&editable&&!stale&&<button ref={removeButton} type="button" className="btn btn-ghost" disabled={busy||unknown||refreshing||removeIntent} onClick={()=>{if(current()&&!flight.current&&!pending.current&&fresh.current)setRemoveIntent(true);}}>移除已保存照片</button>}
    {removeIntent&&<div role="group" aria-label="確認移除獎品照片"><p>確定移除「{target.prize.name}」的已保存照片？獎品文字與內建示意圖會保留。</p><div className="event-prize-photo-actions"><button ref={confirmButton} type="button" className="btn btn-primary" disabled={busy||unknown} onClick={remove}>確定移除照片</button><button type="button" className="btn btn-ghost" disabled={busy||unknown} onClick={cancelRemove}>返回，不移除</button></div></div>}
    {busy&&<p role="status">正在處理照片，請稍候…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    <div className="event-prize-photo-actions">{unknown&&<button type="button" className="btn btn-primary" disabled={busy||refreshing} onClick={()=>{if(pending.current)void send(pending.current);}}>確認原照片操作</button>}<button type="button" className="btn btn-ghost" disabled={busy||refreshing} onClick={()=>void readCurrent()}>重新讀取目前照片</button><button type="button" className="btn btn-ghost" disabled={busy||unknown} onClick={close}>返回活動</button></div>
  </section>;
}
