import {useEffect,useId,useRef,useState} from 'react';
import {ApiError,type PortalClient} from '../api';
import {describeError} from '../portal-session';
import {useLocalAction} from '../useLocalAction';
import {SocialIcon} from './SocialTools';
import type {SocialPost} from './SocialZone';

type SharingState={enabled:boolean;available:boolean;post_revision:number;media_version:string;version:string;public_path:string|null;image_url:string|null};
type PublicationCommand={key:string;version:string;body:{enabled:boolean;post_revision:number;media_version:string}};

function unconfirmedSharingResponse(){
  return new ApiError({message:'公開設定回應不完整，尚未確認結果。',status:200,network:true});
}
function requireSharingState(value:unknown,postId:string):SharingState{
  if(!value||typeof value!=='object'||Array.isArray(value))throw unconfirmedSharingResponse();
  const state=value as Partial<SharingState>;
  const version=(item:unknown):item is string=>typeof item==='string'&&item===item.trim()&&/^[1-9][0-9]{0,18}$/.test(item);
  if(typeof state.enabled!=='boolean'||typeof state.available!=='boolean'
    ||!Number.isInteger(state.post_revision)||(state.post_revision??0)<1||(state.post_revision??0)>2147483647
    ||!version(state.media_version)||!version(state.version)
    ||(state.available&&!state.enabled)||state.public_path!==(state.available?'/posts/'+postId:null)
    ||(state.image_url!==null&&state.image_url!==`/api/v1/social-posts/${postId}/thumbnail?v=${state.media_version}`))throw unconfirmedSharingResponse();
  return state as SharingState;
}

/** Sharing is a browser handoff. Only a separate, explicit author action makes
 * the reviewed post public; cancelling the dialog or native share never does. */
export function SocialPostShare({client,post}:{client:PortalClient;post:SocialPost}){
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),field=useRef<HTMLInputElement>(null),linkDetails=useRef<HTMLDetailsElement>(null),consentDetails=useRef<HTMLDetailsElement>(null),id=useId();
  const [open,setOpen]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState('');
  const [sharing,setSharing]=useState<SharingState|null>(null),[publicAvailable,setPublicAvailable]=useState(false);
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false);
  const [refresh,setRefresh]=useState(0),[imageReady,setImageReady]=useState('');
  const mounted=useRef(false),epoch=useRef(0),savingToken=useRef<symbol|null>(null),command=useRef<PublicationCommand|null>(null);
  const generation=client.sessionGeneration;
  const action=useLocalAction([client,generation,post.post_id,open]);
  const memberUrl=new URL('/',window.location.origin);memberUrl.searchParams.set('social-post',post.post_id);memberUrl.hash='social';
  const url=publicAvailable?new URL('/posts/'+post.post_id,window.location.origin).href:memberUrl.href;
  const mediaKey=sharing?post.post_id+':'+sharing.media_version:'';
  const thumbnail=sharing?.image_url?new URL(sharing.image_url,window.location.origin):null;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
  useEffect(()=>{command.current=null;savingToken.current=null;setSaving(false);setUncertain(false);},[client,generation,post.post_id]);
  useEffect(()=>{
    const current=++epoch.current,abort=new AbortController();
    if(!open)return()=>abort.abort();
    setLoading(true);setError('');setSharing(null);setPublicAvailable(false);setImageReady('');
    const live=()=>mounted.current&&!abort.signal.aborted&&epoch.current===current&&client.sessionGeneration===generation;
    if(post.mine){
      void client.get<unknown>('/social-posts/'+post.post_id+'/public-sharing',{signal:abort.signal}).then(value=>{
        if(live()){const state=requireSharingState(value,post.post_id);setSharing(state);setPublicAvailable(state.available);}
      }).catch(cause=>{if(live())setError(describeError(cause).message);}).finally(()=>{if(live())setLoading(false);});
    }else{
      void client.get('/public/shared-posts/'+post.post_id,{signal:abort.signal,skipAuthHandler:true,suppressConsole:true}).then(()=>{
        if(live())setPublicAvailable(true);
      }).catch(cause=>{if(live()&&(!(cause instanceof ApiError)||cause.status!==404))setError('暫時無法確認公開狀態，目前提供會員貼文連結。');}).finally(()=>{if(live())setLoading(false);});
    }
    return()=>{abort.abort();epoch.current++;};
  },[client,generation,post.post_id,post.revision,post.mine,open,refresh]);
  useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();},[open]);
  useEffect(()=>{if(uncertain&&consentDetails.current)consentDetails.current.open=true;},[uncertain,open,sharing]);
  function close(){dialog.current?.close();setOpen(false);setStatus('');trigger.current?.focus({preventScroll:true});}
  async function share(){
    const result=await action.run('share',()=>navigator.share({title:'自由工坊的貼文',url}));
    if(result.status==='failed'&&(result.error as {name?:string}|null)?.name!=='AbortError')setStatus('系統分享暫時無法使用，可以複製貼文連結。');
  }
  async function copy(){
    const result=await action.run('copy',()=>navigator.clipboard.writeText(url));
    if(result.status==='done')setStatus('已複製貼文連結');
    else if(result.status==='failed'){setStatus('請選取並複製下方貼文連結。');if(linkDetails.current)linkDetails.current.open=true;field.current?.focus();field.current?.select();}
  }
  async function publish(enabled:boolean){
    if(!post.mine||!sharing||savingToken.current!==null)return;
    if(!command.current){
      if(enabled&&(sharing.post_revision!==post.revision||(sharing.image_url&&imageReady!==mediaKey)))return;
      command.current={key:crypto.randomUUID(),version:sharing.version,body:{enabled,post_revision:sharing.post_revision,media_version:sharing.media_version}};
    }
    const operation=command.current,token=Symbol(),current=epoch.current;
    savingToken.current=token;setSaving(true);setError('');setStatus('');
    const ownerAlive=()=>mounted.current&&client.sessionGeneration===generation&&savingToken.current===token;
    try{
      const value=await client.post<unknown>('/social-posts/'+post.post_id+'/public-sharing',operation.body,{idempotencyKey:operation.key,ifMatch:operation.version});
      if(!ownerAlive())return;
      const state=requireSharingState(value,post.post_id);
      if(state.enabled!==operation.body.enabled||state.available!==operation.body.enabled||state.version!==(BigInt(operation.version)+1n).toString()
        ||(operation.body.enabled&&(state.post_revision!==operation.body.post_revision||state.media_version!==operation.body.media_version)))throw unconfirmedSharingResponse();
      // A successful HTTP status alone cannot confirm a publication command.
      command.current=null;setUncertain(false);
      if(epoch.current===current){setSharing(state);setPublicAvailable(state.available);setStatus(state.available?'已開放免登入閱讀，可以分享連結了。':'已關閉免登入閱讀。');}
      else setRefresh(value=>value+1);
    }catch(cause){
      if(!ownerAlive())return;
      // A later definite rejection does not prove an earlier request failed.
      // Retain its exact command until a successful same-key response resolves it.
      const unknown=uncertain||cause instanceof ApiError&&(cause.network||cause.timedOut||cause.status>=500);
      setUncertain(unknown);
      if(!unknown){command.current=null;setRefresh(value=>value+1);}
      setError(unknown?'尚未確認公開設定是否已保存，請按「確認上次設定」使用同一筆操作重試。':describeError(cause).message);
    }finally{
      if(ownerAlive()){savingToken.current=null;setSaving(false);}
    }
  }
  const reviewed=Boolean(sharing&&sharing.post_revision===post.revision&&(!sharing.image_url||imageReady===mediaKey));
  const browserBusy=action.pending!==null||saving;
  return <>
    <button ref={trigger} type="button" className="btn btn-ghost" aria-label="分享貼文連結" disabled={action.pending!==null} onClick={()=>{setStatus('');setOpen(true);}}><SocialIcon name="share"/>分享</button>
    <dialog ref={dialog} className="social-publish-dialog social-share-dialog" aria-labelledby={id+'-title'} onCancel={event=>{event.preventDefault();close();}} onClose={()=>setOpen(false)}>
      {open&&<div className="stack">
        <header className="social-publish-head"><h2 id={id+'-title'}>分享貼文連結</h2><button type="button" className="btn btn-ghost" onClick={close}>關閉分享</button></header>
        {loading&&<p role="status">正在確認貼文的分享範圍…</p>}
        {!loading&&<p className="social-share-audience">{publicAvailable?'任何取得連結的人都能閱讀。':'僅限登入且有閱覽權限的會員。'}</p>}
        <div className="actions social-share-actions">
          {typeof navigator.share==='function'&&<button type="button" className="btn btn-secondary" disabled={browserBusy||loading||uncertain} aria-busy={action.pending==='share'} onClick={()=>void share()}>系統分享</button>}
          <button type="button" className="btn btn-secondary" disabled={browserBusy||loading||uncertain} aria-busy={action.pending==='copy'} onClick={()=>void copy()}>{action.pending==='copy'?'複製中…':'複製貼文連結'}</button>
        </div>
        <details ref={linkDetails} className="social-share-link">
          <summary>查看貼文連結</summary>
          <label className="field">貼文連結<input ref={field} readOnly value={url} onFocus={event=>event.currentTarget.select()}/></label>
        </details>
        {sharing?.enabled&&!sharing.available&&<p role="status">貼文內容或圖片已變更，目前已停止公開。確認目前內容後，可以重新開放。</p>}
        {sharing&&sharing.post_revision!==post.revision&&<p role="alert">貼文已更新，請重新整理貼文後再確認公開內容。</p>}
        {post.mine&&sharing&&<details ref={consentDetails} className="social-sharing-consent" aria-label="公開閱讀設定">
          <summary>{sharing.available?'管理免登入閱讀':'開放免登入閱讀…'}</summary>
          <div className="stack">
          <p className="muted">對外會顯示你的名稱、貼文內容與附圖；會員留言、打卡位置與互動名單不會公開。</p>
          {!sharing.available&&<div className="social-share-preview">
            <strong>{post.author.display_name}</strong>
            <p>{post.kind==='note'?post.note:post.title}</p>
            {post.kind==='link'&&post.note&&<p>{post.note}</p>}
            {thumbnail&&<img src={thumbnail.pathname+thumbnail.search} alt="即將公開的貼文附圖" onLoad={()=>setImageReady(mediaKey)} onError={()=>{setImageReady('');setError('目前附圖暫時無法讀取，請重新確認分享狀態後再開放。');}}/>}
          </div>}
          {uncertain?<button type="button" className="btn btn-primary" disabled={saving} onClick={()=>void publish(command.current!.body.enabled)}>確認上次設定</button>:<div className="actions">
            {!sharing.available&&<button type="button" className="btn btn-primary" disabled={browserBusy||loading||!reviewed} aria-busy={saving} onClick={()=>void publish(true)}>{sharing.enabled?'重新開放目前版本':'開放免登入閱讀'}</button>}
            {sharing.enabled&&<button type="button" className="btn btn-secondary" disabled={browserBusy||loading} onClick={()=>void publish(false)}>關閉免登入閱讀</button>}
          </div>}
          </div>
        </details>}
        {error&&<p role="alert">{error}</p>}
        {error&&!uncertain&&!saving&&<button type="button" className="btn btn-ghost" onClick={()=>setRefresh(value=>value+1)}>重新確認分享狀態</button>}
        {status&&<p role="status">{status}</p>}
      </div>}
    </dialog>
  </>;
}
