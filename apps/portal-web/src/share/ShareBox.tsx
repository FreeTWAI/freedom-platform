import {useEffect,useId,useRef,useState,type MutableRefObject} from 'react';
import {ApiError,type PortalClient} from '../api';
import type {ShareTarget} from '../ShareLauncher';
import {portalHash} from '../portal-route';
import {installShareComposer,openShareComposer,type ShareComposeRequest,type ShareComposeResult} from './share-port';
import './share.css';
type Preview={kind:string;title:string;url:string;description:string;original_author:string|null};
type Pending={key:string;body:unknown;postId?:string};
type Props={client:PortalClient;userId:string;onChoose:(target:ShareTarget)=>void;disabled?:boolean;guided?:boolean;storesEnabled?:boolean;onMyContent?:()=>void};
export function ShareBoxLauncher({client,userId,onChoose,disabled=false,storesEnabled=false,onMyContent}:Props){
  const [request,setRequest]=useState<ShareComposeRequest|null>(null),finish=useRef<((r:ShareComposeResult)=>void)|null>(null),trigger=useRef<HTMLButtonElement>(null);
  const operation=useRef<Pending|null>(null),retainedImage=useRef<Blob|undefined>(undefined),retainedMode=useRef<'link'|'post'>('link');
  const [draft,setDraft]=useState(()=>{try{return sessionStorage.getItem(`share-draft:${userId}`)??'';}catch{return '';}});
  useEffect(()=>installShareComposer((r,resolve)=>{finish.current?.({status:'cancelled'});finish.current=resolve;setRequest(r);if(!operation.current){if(r.url||r.text)setDraft(r.url??r.text??'');if(r.image)retainedImage.current=r.image;if(r.text||r.url||r.image)retainedMode.current=(r.text||r.image)&&!r.url?'post':'link';}}),[]);
  useEffect(()=>()=>{finish.current?.({status:'cancelled'});finish.current=null;},[]);
  function done(result:ShareComposeResult){finish.current?.(result);finish.current=null;setRequest(null);trigger.current?.focus();if(result.status==='published'){operation.current=null;retainedImage.current=undefined;setDraft('');try{sessionStorage.removeItem(`share-draft:${userId}`);}catch{}if(result.url)window.location.hash=result.url.replace(/^\/+#/,'#');}}
  return <><button ref={trigger} className="btn btn-primary" disabled={disabled} aria-label="分享或提交" aria-haspopup="dialog" aria-expanded={request!==null} onClick={()=>void openShareComposer()}>＋分享</button>
    {request&&<ShareBox pending={operation} retainedImage={retainedImage} retainedMode={retainedMode} client={client} request={request} value={draft} onChange={v=>{setDraft(v);try{sessionStorage.setItem(`share-draft:${userId}`,v);}catch{/* Memory draft remains. */}}} onDone={done} onChoose={onChoose} storesEnabled={storesEnabled} onMyContent={onMyContent}/>}
  </>;
}
export function ShareBox({pending,retainedImage,retainedMode,client,request,value,onChange,onDone,onChoose,storesEnabled,onMyContent}:{pending:MutableRefObject<Pending|null>;retainedImage:MutableRefObject<Blob|undefined>;retainedMode:MutableRefObject<'link'|'post'>;client:PortalClient;request:ShareComposeRequest;value:string;onChange:(v:string)=>void;onDone:(r:ShareComposeResult)=>void;onChoose:(t:ShareTarget)=>void;storesEnabled:boolean;onMyContent?:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),inputRef=useRef<HTMLTextAreaElement>(null),id=useId(),generation=client.sessionGeneration;
  const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[more,setMore]=useState(false);
  const [image,setImage]=useState<Blob|undefined>(retainedImage.current??request.image),[mode,setMode]=useState<'link'|'post'>(retainedMode.current);
  const sequence=useRef(0),live=useRef(true);
  useEffect(()=>{if(!more)inputRef.current?.focus();},[mode,more]);
  useEffect(()=>{live.current=true;dialog.current?.showModal();return()=>{live.current=false;sequence.current++;};},[]);
  const current=()=>live.current&&generation===client.sessionGeneration;
  function finish(result:ShareComposeResult){dialog.current?.close();onDone(result);}
  function close(){if(busy)return;finish({status:'cancelled'});}
  function editor(target:ShareTarget){if(busy)return;finish({status:'cancelled'});onChoose(target);}
  useEffect(()=>{
    if(mode==='post'){setPreview(value.trim()?{kind:'post',title:value.slice(0,80),url:'',description:'同社群會員可見',original_author:null}:null);return;}
    setPreview(null);setError('');const seq=++sequence.current;
    if(!/^https:\/\//i.test(value.trim()))return;
    const timer=setTimeout(()=>{void client.post<Preview>('/shares/preview',{url:value.trim(),...(['repository','link'].includes(request.kind??'')?{kind:request.kind}:{})},{idempotencyKey:crypto.randomUUID()}).then(p=>{if(current()&&sequence.current===seq)setPreview(p);},e=>{if(current()&&sequence.current===seq)setError(e.message);});},400);
    return()=>{clearTimeout(timer);sequence.current++;};
  },[value,mode]);
  async function publish(){
    if(!preview||busy)return;if(image&&(image.size>2*1024*1024||!['image/png','image/jpeg','image/webp'].includes(image.type))){setError('圖片限 2 MB 的 PNG、JPEG 或 WebP。');return;}if(mode==='link'&&image){setError('附圖請選貼文。');return;}setBusy(true);setError('');
    try{
      if(!pending.current)pending.current={key:crypto.randomUUID(),body:mode==='post'?{text:value.trim()}:{url:value.trim(),...(['repository','link'].includes(request.kind??'')?{kind:request.kind}:{}),...(request.text&&request.url?{text:request.text}:{})}};
      const p=pending.current;
      if(mode==='post'&&!p.postId){
        let attached:unknown;
        if(image){if(image.size>2*1024*1024||!['image/png','image/jpeg','image/webp'].includes(image.type))throw Error('圖片限 2 MB 的 PNG、JPEG 或 WebP。');const bytes=new Uint8Array(await image.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);attached={mime_type:image.type,data_base64:btoa(binary)};}
        const post=await client.post<{post_id:string}>('/social-posts/notes',{...(p.body as object),...(attached?{image:attached}:{})},{idempotencyKey:p.key});p.postId=post.post_id;
      }
      const result=await client.post<{share_id:string;url:string}>('/shares',p.postId?{kind:'post',ref_id:p.postId}:p.body,{idempotencyKey:p.key+'-share'});
      if(current()){pending.current=null;finish({status:'published',...result});}
    }catch(e){if(current()){setError(e instanceof Error?e.message:'發布失敗，請重試。');if(e instanceof ApiError&&e.definitiveResponse&&!pending.current?.postId)pending.current=null;}}
    finally{if(current())setBusy(false);}
  }
  return <dialog ref={dialog} className="share-box" aria-labelledby={id} onCancel={e=>{e.preventDefault();close();}}>
    <header><h2 id={id}>分享</h2><button className="btn btn-ghost btn-small" onClick={close} disabled={busy}>關閉</button></header>
    <div className="share-chips" aria-label="分享種類">
      <button className="btn btn-secondary btn-small" aria-pressed={mode==='link'} disabled={busy||!!pending.current} onClick={()=>{setMode('link');retainedMode.current='link';}}>網址</button>
      <button className="btn btn-secondary btn-small" aria-pressed={mode==='post'} disabled={busy||!!pending.current} onClick={()=>{setMode('post');retainedMode.current='post';}}>貼文</button>
      <button className="btn btn-secondary btn-small" disabled={busy} onClick={()=>editor('work')}>作品</button>
      <button className="btn btn-secondary btn-small" disabled={busy} onClick={()=>setMore(!more)} aria-expanded={more}>種類</button>
    </div>
    {more?<div className="share-options">
      {storesEnabled&&<><button className="btn btn-secondary btn-small" onClick={()=>editor('product-store')}>刊登商品</button><button className="btn btn-secondary btn-small" onClick={()=>editor('product-supply')}>供貨</button></>}
      <button className="btn btn-secondary btn-small" onClick={()=>editor('product')}>上傳商品</button>
      <button className="btn btn-secondary btn-small" onClick={()=>editor('product-start')}>準備商品</button>
      <button className="btn btn-secondary btn-small" onClick={()=>{finish({status:'cancelled'});window.location.hash=portalHash('events');}}>活動</button>
      <button className="btn btn-secondary btn-small" onClick={()=>{finish({status:'cancelled'});window.location.hash=portalHash('services');}}>服務</button>
      <button className="btn btn-secondary btn-small" onClick={()=>editor('resource')}>開源投稿</button>
      <button className="btn btn-secondary btn-small" onClick={()=>editor('collaborate')}>找人合作</button><button className="btn btn-secondary btn-small" onClick={()=>editor('cocreate')}>共創邀請</button>
      {onMyContent&&<button className="btn btn-secondary btn-small" onClick={()=>{finish({status:'cancelled'});onMyContent();}}>我的內容</button>}
    </div>:<>
      <label htmlFor={id+'-input'}>{mode==='link'?'貼上連結':'內容'}</label>
      <textarea ref={inputRef} id={id+'-input'} autoFocus value={value} maxLength={mode==='post'?500:2048} disabled={busy||!!pending.current} onChange={e=>onChange(e.target.value)} placeholder={mode==='link'?'https://github.com/…':'分享近況'} rows={3}/>
      {mode==='post'&&<label className="share-image">圖片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||!!pending.current} onChange={e=>{const file=e.target.files?.[0];setImage(file);retainedImage.current=file;}}/></label>}
      {preview&&<article className="card share-preview"><strong>{preview.title}</strong>{mode==='link'&&<small> · 公開</small>}<p>{preview.description}</p>{preview.original_author&&<small>原作帳號：{preview.original_author}</small>}</article>}
      {error&&<p role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={!preview||busy} onClick={()=>void publish()}>{busy?'發布中…':'發布'}</button>
    </>}
  </dialog>;
}
