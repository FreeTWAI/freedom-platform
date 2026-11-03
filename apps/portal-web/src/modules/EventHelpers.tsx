import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError,type PortalClient} from '../api';
import './EventHelpers.css';

type HelperState='applied'|'accepted'|'declined'|'withdrawn';
type OwnHelper={state:HelperState|null;version:number;event_closed:boolean};
type HelperRow={user_id:string;nickname:string;state:HelperState;version:number};
type HelperPage={items:HelperRow[];total:number;next_offset:number|null;event_closed:boolean};
type Command={path:string;body:{action?:'offer'|'withdraw';decision?:'accept'|'decline';referral_code?:string};key:string;version:number};
type Props={client:PortalClient;eventId:string;userId:string;isOrganizer:boolean;referralCode?:string|null;onBlockedChange:(blocked:boolean)=>void};
const labels:Record<HelperState,string>={applied:'等主辦回覆',accepted:'主辦已接受',declined:'這次未被接受',withdrawn:'已撤回'};
const version=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
function ownStatus(value:unknown):value is OwnHelper{
  if(!value||typeof value!=='object')return false;
  const item=value as OwnHelper;
  return version(item.version)&&typeof item.event_closed==='boolean'&&(item.state===null||Object.hasOwn(labels,item.state));
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function helperPage(value:unknown,offset:number):value is HelperPage{
  if(!value||typeof value!=='object')return false;
  const page=value as HelperPage;
  return Array.isArray(page.items)&&page.items.length<=20&&Number.isSafeInteger(page.total)&&page.total>=0&&typeof page.event_closed==='boolean'
    &&(page.next_offset===null||Number.isSafeInteger(page.next_offset)&&page.next_offset===offset+20&&page.items.length===20&&page.next_offset<page.total)
    &&new Set(page.items.map(row=>row?.user_id)).size===page.items.length&&page.items.length<=page.total
    &&page.items.every(row=>row&&typeof row.user_id==='string'&&uuid.test(row.user_id)&&typeof row.nickname==='string'&&version(row.version)&&Object.hasOwn(labels,row.state));
}

export function EventHelpers(props:Props){
  const identity=useRef({client:props.client,revision:0});
  if(identity.current.client!==props.client)identity.current={client:props.client,revision:identity.current.revision+1};
  // Different client objects may have equal numeric generations.
  return <EventHelpersContent key={`${identity.current.revision}:${props.userId}:${props.client.sessionGeneration}:${props.eventId}:${props.isOrganizer}`} {...props}/>;
}
function EventHelpersContent({client,eventId,isOrganizer,onBlockedChange,referralCode}:Props){
  const [own,setOwn]=useState<OwnHelper|null>(null),[page,setPage]=useState<HelperPage|null>(null),[offset,setOffset]=useState(0);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[stale,setStale]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const epoch=useRef(0),readSequence=useRef(0),mounted=useRef(false),owner=useRef(client.sessionGeneration);
  const pending=useRef<Command|null>(null),inFlight=useRef(false),uncertain=useRef(false),controllers=useRef(new Set<AbortController>());
  const base=`/events/${eventId}/helpers`;
  const current=useCallback((run:number)=>mounted.current&&epoch.current===run&&client.sessionGeneration===owner.current,[client]);
  const load=useCallback(async(nextOffset=0)=>{
    if(!current(epoch.current)||document.visibilityState!=='visible')return;
    const run=epoch.current,sequence=++readSequence.current,controller=new AbortController();controllers.current.add(controller);
    setLoading(true);setError('');setOwn(null);setPage(null);
    try{
      const result=await client.get<unknown>(isOrganizer?`${base}?limit=20&offset=${nextOffset}`:`${base}/me`,{signal:controller.signal,suppressConsole:true});
      if(!current(run)||sequence!==readSequence.current)return;
      if(isOrganizer){if(!helperPage(result,nextOffset))throw new Error('幫手資料尚未完整讀取，請重試。');setPage(result);setOffset(nextOffset);}
      else{if(!ownStatus(result))throw new Error('幫忙狀態尚未完整讀取，請重試。');setOwn(result);}
      // Reading current state is NOT evidence that an uncertain command failed.
      if(!pending.current)setStale(false);
    }catch(cause){if(current(run)&&sequence===readSequence.current)setError(cause instanceof Error?cause.message:'幫忙資料無法讀取，請重試。');}
    finally{controllers.current.delete(controller);if(current(run)&&sequence===readSequence.current)setLoading(false);}
  },[base,client,current,isOrganizer]);
  useEffect(()=>{
    mounted.current=true;owner.current=client.sessionGeneration;epoch.current++;pending.current=null;uncertain.current=false;inFlight.current=false;
    setUnknown(false);setBusy(false);setStale(false);setNotice('');onBlockedChange(false);void load();
    const ended=()=>{mounted.current=false;epoch.current++;readSequence.current++;for(const controller of controllers.current)controller.abort();setOwn(null);setPage(null);setError('登入狀態已變更，請重新開啟活動。');onBlockedChange(false);};
    const refresh=()=>{if(!inFlight.current&&document.visibilityState==='visible')void load();};
    const visibility=()=>{if(document.visibilityState==='visible')refresh();else{readSequence.current++;setOwn(null);setPage(null);}};
    window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',visibility);
    window.addEventListener('freedom-game-console-session-end',ended);
    return()=>{mounted.current=false;epoch.current++;readSequence.current++;for(const controller of controllers.current)controller.abort();controllers.current.clear();onBlockedChange(false);window.removeEventListener('freedom-game-console-session-end',ended);window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visibility);};
  },[client,load,onBlockedChange]);
  async function send(command:Command){
    if(inFlight.current||!current(epoch.current))return;
    const run=epoch.current,controller=new AbortController();controllers.current.add(controller);
    inFlight.current=true;pending.current=command;readSequence.current++;setLoading(false);setBusy(true);setError('');setNotice('');onBlockedChange(true);
    try{
      const result=await client.post<unknown>(command.path,command.body,{idempotencyKey:command.key,ifMatch:command.version,signal:controller.signal,suppressConsole:true});
      if(!current(run))return;
      if(!ownStatus(result))throw new Error('操作回覆不完整，結果尚未確認。');
      pending.current=null;uncertain.current=false;setUnknown(false);setStale(false);
      setNotice('原操作已確認。下方會重新讀取目前狀態；報名不會因此變更。');
      // A replayed receipt may describe a historical transition, never render it
      // as current authority or synthesize an accepted/withdrawn state from it.
      await load(isOrganizer?offset:0);
    }catch(cause){
      if(!current(run))return;
      const unknownNow=uncertain.current||!(cause instanceof ApiError)||!cause.definitiveResponse||cause.network||cause.status>=500;
      uncertain.current=unknownNow;setUnknown(unknownNow);
      if(!unknownNow){pending.current=null;setOwn(null);setPage(null);setStale(true);}
      setError(unknownNow?'幫忙操作的結果還沒確認。請重試原操作；重新讀取不代表原操作已取消。':cause instanceof Error?cause.message:'操作未完成，請重新讀取後再確認。');
    }finally{
      controllers.current.delete(controller);
      if(current(run)){inFlight.current=false;setBusy(false);onBlockedChange(pending.current!==null);}
    }
  }
  function act(path:string,body:Command['body'],expected:number){
    if(pending.current||inFlight.current||loading||stale||error||!current(epoch.current))return;
    void send({path,body:{...body},version:expected,key:crypto.randomUUID()});
  }
  const blocked=busy||unknown||loading||stale||Boolean(error);
  return <section className="event-helpers" aria-label={isOrganizer?'管理幫手':'申請幫忙'}>
    <h3>{isOrganizer?'管理幫手':'我想幫忙'}</h3>
    <p>幫忙和報名參加是兩件事。申請後等主辦回覆；要參加活動，仍請另外報名。幫手身份不會公開，也不會自動分享聯絡方式。</p>
    {notice&&<p role="status">{notice}</p>}
    {error&&<p role="alert" className="banner banner-error">{error}</p>}
    {loading&&<p role="status">正在讀取幫忙資料…</p>}
    <div className="experience-actions">
      {unknown&&<button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>{if(pending.current)void send(pending.current);}}>重試原幫忙操作</button>}
      <button type="button" className="btn btn-ghost" disabled={busy||loading} onClick={()=>void load(isOrganizer?offset:0)}>重新讀取幫忙狀態</button>
    </div>
    {unknown&&<p className="field-hint">原內容與操作編號仍保留。確認前不能送出另一個幫忙操作或離開本頁；若持續無法確認，請聯絡平台管理員。</p>}
    {!isOrganizer&&own&&<>
      <p role="status">你的幫忙狀態：{own.state===null?'尚未申請':labels[own.state]}。</p>
      {own.event_closed&&<p>活動已開始或已關閉，不再接受新的幫忙申請。</p>}
      {!own.event_closed&&(own.state===null||own.state==='withdrawn')&&<button type="button" className="btn btn-primary" disabled={blocked} onClick={()=>act(`${base}/me`,{action:'offer',...(referralCode?{referral_code:referralCode}:{})},own.version)}>我要幫忙，送出申請</button>}
      {(own.state==='applied'||own.state==='accepted')&&<button type="button" className="btn btn-ghost" disabled={blocked} onClick={()=>act(`${base}/me`,{action:'withdraw'},own.version)}>撤回幫忙申請</button>}
    </>}
    {isOrganizer&&page&&<>
      <p className="field-hint">只有主辦能看這份名單。接受幫忙不會替對方報名，也不是聯絡方式分享同意。</p>
      {page.event_closed&&<p>活動已開始或已關閉，不能再接受或拒絕申請。</p>}
      {page.items.length===0?<p>這一頁沒有幫忙申請。</p>:<ul className="event-helper-list">{page.items.map(row=><li key={row.user_id}><div><strong>{row.nickname}</strong><p>{labels[row.state]}</p></div>{row.state==='applied'&&!page.event_closed&&<div className="experience-actions"><button type="button" className="btn btn-primary" disabled={blocked} onClick={()=>act(`${base}/${row.user_id}/decision`,{decision:'accept'},row.version)}>接受 {row.nickname}</button><button type="button" className="btn btn-ghost" disabled={blocked} onClick={()=>act(`${base}/${row.user_id}/decision`,{decision:'decline'},row.version)}>婉拒 {row.nickname}</button></div>}</li>)}</ul>}
      <p>{page.items.length?`目前第 ${offset+1}–${offset+page.items.length} 筆，共 ${page.total} 筆。`:`共 ${page.total} 筆。`}</p>
      <div className="experience-actions">{offset>0&&<button type="button" className="btn btn-ghost" disabled={blocked} onClick={()=>void load(Math.max(0,offset-20))}>上一頁幫手</button>}{page.next_offset!==null&&<button type="button" className="btn btn-ghost" disabled={blocked} onClick={()=>void load(page.next_offset!)}>下一頁幫手</button>}</div>
    </>}
  </section>;
}
