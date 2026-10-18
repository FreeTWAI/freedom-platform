import {useEffect,useId,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {useLocalAction} from '../useLocalAction';
import {SocialIcon} from './SocialTools';
import type {SocialPost} from './SocialZone';

/** Sharing an existing post hands off its permalink, never an authoring job. */
export function SocialPostShare({client,post}:{client:PortalClient;post:SocialPost}){
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),field=useRef<HTMLInputElement>(null),id=useId();
  const [open,setOpen]=useState(false),[status,setStatus]=useState('');
  const action=useLocalAction([client,client.sessionGeneration,post.post_id,open]);
  const destination=new URL('/',window.location.origin);destination.searchParams.set('social-post',post.post_id);destination.hash='social';
  const url=destination.href;
  useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();},[open]);
  function close(){dialog.current?.close();setOpen(false);setStatus('');trigger.current?.focus({preventScroll:true});}
  async function share(){
    if(typeof navigator.share!=='function'){setStatus('');setOpen(true);return;}
    const result=await action.run('share',()=>navigator.share({title:'自由工坊的貼文',url}));
    if(result.status==='failed'&&(result.error as {name?:string}|null)?.name!=='AbortError'){
      setStatus('系統分享暫時無法使用，可以複製貼文連結。');setOpen(true);
    }
  }
  async function copy(){
    const result=await action.run('copy',()=>navigator.clipboard.writeText(url));
    if(result.status==='done')setStatus('已複製貼文連結');
    else if(result.status==='failed'){setStatus('請選取並複製下方貼文連結。');field.current?.focus();field.current?.select();}
  }
  return <>
    <button ref={trigger} type="button" className="btn btn-ghost" aria-label="分享貼文連結" disabled={action.pending!==null} aria-busy={action.pending==='share'} onClick={()=>void share()}><SocialIcon name="share"/>{action.pending==='share'?'分享中…':'分享'}</button>
    <dialog ref={dialog} className="social-publish-dialog social-share-dialog" aria-labelledby={`${id}-title`} onCancel={event=>{event.preventDefault();close();}} onClose={()=>setOpen(false)}>
      {open&&<div className="stack">
        <header className="social-publish-head"><h2 id={`${id}-title`}>分享貼文連結</h2><button type="button" className="btn btn-ghost" onClick={close}>關閉分享</button></header>
        <p>把連結傳給朋友，就能直接找到這則貼文。社群貼文需要登入並具備原本的閱覽權限。</p>
        <label className="field">貼文連結<input ref={field} readOnly value={url} onFocus={event=>event.currentTarget.select()}/></label>
        <div className="actions"><button type="button" className="btn btn-primary" disabled={action.pending!==null} aria-busy={action.pending==='copy'} onClick={()=>void copy()}>{action.pending==='copy'?'複製中…':'複製貼文連結'}</button></div>
        {status&&<p role="status">{status}</p>}
      </div>}
    </dialog>
  </>;
}
