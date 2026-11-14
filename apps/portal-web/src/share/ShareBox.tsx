import {Suspense,lazy,useCallback,useEffect,useId,useRef,useState,type MutableRefObject} from 'react';
import {ApiError,type PortalClient} from '../api';
import type {ShareTarget} from '../ShareLauncher';
import {portalHash,resolvePortalRoute} from '../portal-route';
import {normalizeShareUrl} from '../../../../packages/shared/share-url';
import {installShareComposer,openShareComposer,type ShareComposeRequest,type ShareComposeResult} from './share-port';
import './share.css';
const EventComposer=lazy(()=>import('./EventComposer').then(m=>({default:m.EventComposer})));
type Preview={kind:string;title:string;url:string;description:string;original_author:string|null};
type Pending={key:string;body:unknown};
type Props={client:PortalClient;userId:string;onChoose:(target:ShareTarget)=>void;disabled?:boolean;guided?:boolean;storesEnabled?:boolean};
export function ShareBoxLauncher({client,userId,onChoose,disabled=false,storesEnabled=false}:Props){
  const [request,setRequest]=useState<ShareComposeRequest|null>(null),finish=useRef<((r:ShareComposeResult)=>void)|null>(null),trigger=useRef<HTMLButtonElement>(null);
  const operation=useRef<Pending|null>(null),retainedImage=useRef<Blob|undefined>(undefined),retainedMode=useRef<'link'|'post'>('link');
  const [draft,setDraft]=useState(()=>{try{return sessionStorage.getItem(`share-draft:${userId}`)??'';}catch{return '';}});
  const [manualTitle,setManualTitle]=useState(()=>{try{return sessionStorage.getItem(`share-title:${userId}`)??'';}catch{return '';}});
  useEffect(()=>installShareComposer((r,resolve)=>{finish.current?.({status:'cancelled'});finish.current=resolve;setRequest(r);if(!operation.current){if(r.url||r.text)setDraft(r.url??r.text??'');if(r.image)retainedImage.current=r.image;if(r.text||r.url||r.image)retainedMode.current=(r.text||r.image)&&!r.url?'post':'link';}}),[]);
  useEffect(()=>()=>{finish.current?.({status:'cancelled'});finish.current=null;},[]);
  function done(result:ShareComposeResult){finish.current?.(result);finish.current=null;setRequest(null);trigger.current?.focus();if(result.status==='published'){operation.current=null;retainedImage.current=undefined;setDraft('');setManualTitle('');try{sessionStorage.removeItem(`share-draft:${userId}`);sessionStorage.removeItem(`share-title:${userId}`);}catch{}if(!request?.source&&resolvePortalRoute(window.location.hash).place==='home'&&result.share_id){window.dispatchEvent(new CustomEvent('freedom-share-published',{detail:{shareId:result.share_id,url:result.url,title:result.title,kind:result.kind}}));}else if(result.url&&!request?.source){if(result.url.startsWith('/events/'))window.location.assign(result.url);else window.location.hash=result.url.replace(/^\/+#/,'#');}}}
  return <><button ref={trigger} className="btn btn-secondary" disabled={disabled} aria-label="分享或提交" aria-haspopup="dialog" aria-expanded={request!==null} onClick={()=>void openShareComposer()}>＋分享</button>
    {request&&<ShareBox pending={operation} retainedImage={retainedImage} retainedMode={retainedMode} client={client} request={request} value={draft} manualTitle={manualTitle} onTitleChange={v=>{setManualTitle(v);try{sessionStorage.setItem(`share-title:${userId}`,v);}catch{}}} onChange={v=>{setDraft(v);setManualTitle('');try{sessionStorage.setItem(`share-draft:${userId}`,v);sessionStorage.removeItem(`share-title:${userId}`);}catch{/* Memory draft remains. */}}} onDone={done} onChoose={onChoose} storesEnabled={storesEnabled}/>}
  </>;
}
export function ShareBox({pending,retainedImage,retainedMode,client,request,value,manualTitle,onTitleChange,onChange,onDone,onChoose,storesEnabled}:{pending:MutableRefObject<Pending|null>;retainedImage:MutableRefObject<Blob|undefined>;retainedMode:MutableRefObject<'link'|'post'>;client:PortalClient;request:ShareComposeRequest;value:string;manualTitle:string;onTitleChange:(v:string)=>void;onChange:(v:string)=>void;onDone:(r:ShareComposeResult)=>void;onChoose:(t:ShareTarget)=>void;storesEnabled:boolean}){
  const dialog=useRef<HTMLDialogElement>(null),inputRef=useRef<HTMLTextAreaElement>(null),id=useId(),generation=client.sessionGeneration;
  const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[more,setMore]=useState(false),[eventMode,setEventMode]=useState(request.kind==='event');
  const [image,setImage]=useState<Blob|undefined>(retainedImage.current??request.image),[mode,setMode]=useState<'link'|'post'>(retainedMode.current);
  const [manual,setManual]=useState(false),[retry,setRetry]=useState<'preview'|'publish'|null>(null),[attempt,setAttempt]=useState(0);
  const sequence=useRef(0),live=useRef(true);
  useEffect(()=>{if(!more&&!eventMode)inputRef.current?.focus();},[mode,more,eventMode]);
  const attachDialog=useCallback((el:HTMLDialogElement|null)=>{dialog.current=el;if(el&&!el.open)el.showModal?.();},[]);
  useEffect(()=>{live.current=true;return()=>{live.current=false;sequence.current++;};},[]);
  const current=()=>live.current&&generation===client.sessionGeneration;
  function finish(result:ShareComposeResult){dialog.current?.close();onDone(result);}
  function close(){if(busy)return;finish({status:'cancelled'});}
  function editor(target:ShareTarget){if(busy)return;finish({status:'cancelled'});onChoose(target);}
  function linkScope(raw:string){
    const normalized=normalizeShareUrl(raw.trim());
    return {normalized,repo:request.kind==='repository'||(normalized.ok&&['github.com','www.github.com'].includes(normalized.host))};
  }
  function gitHubRetryable(e:unknown){
    return e instanceof ApiError&&(e.status===0||e.status>=500||['github_unavailable','github_rate_limited','github_read_budget','github_token_rejected','github_invalid_response'].includes(e.code??''));
  }
  useEffect(()=>{
    setManual(false);setRetry(null);
    if(mode==='post'){setPreview(value.trim()?{kind:'post',title:value.slice(0,80),url:'',description:'同社群會員可見',original_author:null}:null);return;}
    setPreview(null);setError('');const seq=++sequence.current;
    if(!/^https:\/\//i.test(value.trim()))return;
    try{if(/(^|\.)(accupass\.com|meetup\.com|eventbrite\.com|lu\.ma|luma\.com)$/.test(new URL(value.trim()).hostname)){setEventMode(true);return;}}catch{}
    const timer=setTimeout(()=>{void client.post<Preview>('/shares/preview',{url:value.trim(),...(['repository','link','event'].includes(request.kind??'')?{kind:request.kind}:{})},{idempotencyKey:crypto.randomUUID()}).then(p=>{if(current()&&sequence.current===seq){if(p.kind==='event')setEventMode(true);else setPreview(p);}},e=>{if(current()&&sequence.current===seq){const {normalized,repo}=linkScope(value);if(repo&&gitHubRetryable(e)){setError('GitHub 暫時無法確認，請再試一次。');setRetry('preview');}else if(!repo&&normalized.ok&&e instanceof ApiError&&e.status===422&&!['invalid_share_url','validation_failed'].includes(e.code??'')){setError('無法讀取預覽，填入標題即可分享。');setManual(true);}else{setError(e instanceof Error?e.message:'無法讀取連結。');}}});},400);
    return()=>{clearTimeout(timer);sequence.current++;};
  },[value,mode,attempt]);
  async function publish(){
    if((!preview&&!(manual&&manualTitle.trim()))||busy)return;if(image&&(image.size>2*1024*1024||!['image/png','image/jpeg','image/webp'].includes(image.type))){setError('圖片限 2 MB 的 PNG、JPEG 或 WebP。');return;}if(mode==='link'&&image){setError('附圖請選貼文。');return;}setBusy(true);setError('');setRetry(null);
    try{
      if(!pending.current)pending.current={key:crypto.randomUUID(),body:mode==='post'?{text:value.trim()}:{url:value.trim(),...(['repository','link','event'].includes(request.kind??'')?{kind:request.kind}:{}),...(manual?{manual_title:manualTitle.trim()}:{}),...(request.text&&request.url?{text:request.text}:{})}};
      const p=pending.current;
      let result:{share_id:string;url:string;title?:string;kind?:string};
      if(mode==='post'){
        let attached:unknown;
        if(image){if(image.size>2*1024*1024||!['image/png','image/jpeg','image/webp'].includes(image.type))throw Error('圖片限 2 MB 的 PNG、JPEG 或 WebP。');const bytes=new Uint8Array(await image.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);attached={mime_type:image.type,data_base64:btoa(binary)};}
        const post=await client.post<{post_id:string;share_id?:string;title?:string}>('/social-posts/notes',{...(p.body as object),...(attached?{image:attached}:{})},{idempotencyKey:p.key});
        if(!post.share_id)throw Error('發布失敗，請重試。');
        result={share_id:post.share_id,url:`/#shares/${post.share_id}`,title:post.title,kind:'post'};
      }else{
        result=await client.post<{share_id:string;url:string;title?:string;kind?:string}>('/shares',{...(p.body as object),...(request.source?{source:request.source}:{})},{idempotencyKey:p.key+'-share'});
      }
      const resolvedTitle=result.title||(manual?manualTitle.trim():preview?.title);
      const resolvedKind=result.kind||(mode==='post'?'post':(preview?.kind??(linkScope(value).repo||request.kind==='repository'?'repository':'link')));
      if(current()){pending.current=null;finish({status:'published',...result,title:resolvedTitle,kind:resolvedKind});}
    }catch(e){if(current()){const {repo}=linkScope(value);if(repo&&gitHubRetryable(e)){setError('GitHub 暫時無法確認，請再試一次。');setRetry('publish');}else setError(e instanceof Error?e.message:'發布失敗，請重試。');if(e instanceof ApiError&&e.definitiveResponse)pending.current=null;}}
    finally{if(current())setBusy(false);}
  }
  return <dialog ref={attachDialog} className="share-box" aria-labelledby={id} onCancel={e=>{e.preventDefault();close();}}>
    <header><h2 id={id}>分享</h2><button className="btn btn-ghost btn-small" onClick={close} disabled={busy}>關閉</button></header>
    <div className="share-chips" aria-label="分享種類">
      <button className="btn btn-secondary btn-small" aria-pressed={!more&&!eventMode&&mode==='link'} disabled={busy||!!pending.current} onClick={()=>{setMore(false);setEventMode(false);setMode('link');retainedMode.current='link';}}>網址</button>
      <button className="btn btn-secondary btn-small" aria-pressed={!more&&!eventMode&&mode==='post'} disabled={busy||!!pending.current} onClick={()=>{setMore(false);setEventMode(false);setMode('post');retainedMode.current='post';}}>貼文</button>
      <button className="btn btn-secondary btn-small" aria-pressed={!more&&eventMode} disabled={busy||!!pending.current} onClick={()=>{setMore(false);setEventMode(true);}}>活動</button>
      <button className="btn btn-secondary btn-small" disabled={busy} onClick={()=>setMore(!more)} aria-expanded={more}>更多</button>
    </div>
    {more?<div className="share-options">
      <a className="btn btn-secondary btn-small" href={portalHash('showcase')} onClick={()=>finish({status:'cancelled'})}>作品</a>
      <a className="btn btn-secondary btn-small" href={portalHash('services')} onClick={()=>finish({status:'cancelled'})}>服務</a>
      {storesEnabled&&<><button className="btn btn-secondary btn-small" onClick={()=>editor('product-store')}>刊登商品</button><button className="btn btn-secondary btn-small" onClick={()=>editor('product-supply')}>供貨</button></>}
      <button className="btn btn-secondary btn-small" onClick={()=>editor('product')}>上傳商品</button>
      <button className="btn btn-secondary btn-small" onClick={()=>editor('product-start')}>準備商品</button>
      <button className="btn btn-secondary btn-small" onClick={()=>editor('resource')}>開源投稿</button>
      <button className="btn btn-secondary btn-small" onClick={()=>editor('collaborate')}>找人合作</button><button className="btn btn-secondary btn-small" onClick={()=>editor('cocreate')}>共創邀請</button>
    </div>:eventMode?<Suspense fallback={<p className="muted" role="status">載入中…</p>}><EventComposer client={client} onDone={finish} initialUrl={value}/></Suspense>:<>
      <label htmlFor={id+'-input'}>{mode==='link'?'貼上連結':'內容'}</label>
      <textarea ref={inputRef} id={id+'-input'} autoFocus value={value} maxLength={mode==='post'?500:2048} disabled={busy||!!pending.current} onChange={e=>onChange(e.target.value)} placeholder={mode==='link'?'https://github.com/…':'分享近況'} rows={3}/>
      {mode==='post'&&<label className="share-image">圖片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||!!pending.current} onChange={e=>{const file=e.target.files?.[0];setImage(file);retainedImage.current=file;}}/></label>}
      {preview&&<article className="card share-preview"><strong>{preview.title}</strong>{mode==='link'&&<small> · 公開</small>}<p>{preview.description}</p>{preview.original_author&&<small>原作帳號：{preview.original_author}</small>}</article>}
      {error&&<div className="share-error"><p role="alert">{error}</p>{retry&&<button type="button" className="btn btn-secondary btn-small" onClick={()=>retry==='preview'?setAttempt(n=>n+1):void publish()}>再試一次</button>}</div>}
      {manual&&<div className="share-manual-title"><label>分享標題<input value={manualTitle} maxLength={120} disabled={busy||!!pending.current} onChange={e=>onTitleChange(e.target.value)}/></label></div>}
      <button className="btn btn-primary" disabled={(!preview&&!(manual&&manualTitle.trim()))||busy||retry!==null} onClick={()=>void publish()}>{busy?'發布中…':'發布'}</button>
    </>}
  </dialog>;
}
