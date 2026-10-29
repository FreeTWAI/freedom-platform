import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {ApiError, type PortalClient} from '../api';
import {useLanguage, type InterfaceLanguage} from '../language';

type Snapshot = {kind:'post'; id:string; selected:boolean; available:boolean};
type Attempt = {key:string; uncertain:boolean; body:{kind:'post'; id:string; selected:boolean}};
const copy:Record<InterfaceLanguage,readonly string[]> = {
  'zh-Hant':['私人書籤','僅自己可見；不會通知作者。','正在讀取…','儲存私人書籤','移除書籤','正在儲存…','已儲存私人書籤。','已移除書籤。','無法讀取書籤，請重試。','重新讀取','尚未確認儲存結果，請以原操作重試。','重試儲存私人書籤','重試移除書籤','原貼文目前不可讀；仍可移除自己的書籤。','操作未獲允許，請重新讀取目前狀態。'],
  en:['Private bookmark','Only you can see this; the author is not notified.','Loading…','Save private bookmark','Remove bookmark','Saving…','Private bookmark saved.','Bookmark removed.','Could not read the bookmark. Please retry.','Reload','The result is unconfirmed. Retry the same operation.','Retry saving private bookmark','Retry removing bookmark','The post is unavailable; you can still remove your bookmark.','The operation was refused. Reload the current state.'],
  ja:['非公開ブックマーク','自分だけに表示され、投稿者には通知されません。','読み込み中…','非公開ブックマークを保存','ブックマークを削除','保存中…','非公開ブックマークを保存しました。','ブックマークを削除しました。','読み込めませんでした。再試行してください。','再読み込み','結果を確認できません。同じ操作を再試行してください。','保存を再試行','削除を再試行','投稿は現在閲覧できませんが、自分のブックマークは削除できます。','操作は拒否されました。現在の状態を再読み込みしてください。'],
  ko:['비공개 북마크','나만 볼 수 있으며 작성자에게 알리지 않습니다.','불러오는 중…','비공개 북마크 저장','북마크 삭제','저장 중…','비공개 북마크를 저장했습니다.','북마크를 삭제했습니다.','북마크를 불러오지 못했습니다. 다시 시도하세요.','새로고침','결과가 확인되지 않았습니다. 같은 작업을 다시 시도하세요.','북마크 저장 재시도','북마크 삭제 재시도','게시물을 볼 수 없지만 내 북마크는 삭제할 수 있습니다.','작업이 거부되었습니다. 현재 상태를 다시 불러오세요.'],
  es:['Marcador privado','Solo tú puedes verlo; no se notifica al autor.','Cargando…','Guardar marcador privado','Eliminar marcador','Guardando…','Marcador privado guardado.','Marcador eliminado.','No se pudo leer el marcador. Inténtalo de nuevo.','Volver a cargar','Resultado sin confirmar. Reintenta la misma operación.','Reintentar guardar marcador privado','Reintentar eliminar marcador','La publicación no está disponible; aún puedes eliminar tu marcador.','La operación fue rechazada. Vuelve a cargar el estado actual.'],
};
function snapshot(value:unknown,id:string):Snapshot|null {
  if(!value || typeof value!=='object')return null;
  const row=value as Record<string,unknown>;
  return row.kind==='post' && row.id===id && typeof row.selected==='boolean' && typeof row.available==='boolean' && (row.available || row.selected)
    ? {kind:'post',id,selected:row.selected,available:row.available}:null;
}

/** No provider traversal or row-mount request. Every read follows an explicit disclosure. */
export function SocialPostBookmark({client,postId,menuOpen=true}:{client:PortalClient;postId:string;menuOpen?:boolean}) {
  const {language}=useLanguage(), text=copy[language];
  const generation=client.sessionGeneration;
  const life=useMemo(()=>({client,generation,id:postId,disposed:false,open:false,read:0,reading:false,controller:null as AbortController|null,attempt:null as Attempt|null,busy:false}),[client,generation,postId]);
  const current=useRef(life); current.current=life;
  const [view,setView]=useState<{life:typeof life; data:Snapshot|null; loading:boolean; error:'read'|'write'|'refused'|null; notice:'saved'|'removed'|null}|null>(null);
  const [,render]=useState(0);
  const details=useRef<HTMLDetailsElement>(null);
  const live=()=>current.current===life&&!life.disposed&&client.sessionGeneration===life.generation;
  useLayoutEffect(()=>{life.disposed=false;life.open=false;if(details.current)details.current.open=false;return()=>{life.disposed=true;life.controller?.abort();life.attempt=null;};},[life]);
  const state=view?.life===life?view:null;
  async function read(confirmed?:boolean) {
    if(!live()||!life.open||life.busy||life.attempt)return;
    life.controller?.abort();const controller=new AbortController();life.controller=controller;
    const request=++life.read;life.reading=true;
    setView({life,data:null,loading:true,error:null,notice:null});
    const valid=()=>live()&&life.open&&details.current?.open&&request===life.read&&!controller.signal.aborted;
    try {
      const value=await client.get<unknown>(`/community-relations/bookmarks/post/${encodeURIComponent(postId)}`,{signal:controller.signal,suppressConsole:true});
      if(!valid())return;
      const data=snapshot(value,postId);if(!data)throw new Error('invalid bookmark response');
      setView({life,data,loading:false,error:null,notice:confirmed===undefined?null:confirmed?'saved':'removed'});
    } catch (cause) {if(valid())setView({life,data:null,loading:false,error:confirmed===false&&cause instanceof ApiError&&cause.status===404?null:'read',notice:confirmed===undefined?null:confirmed?'saved':'removed'});}
    finally {if(life.read===request)life.reading=false;}
  }
  async function change() {
    if(!live()||!life.open||life.busy||life.reading||(!life.attempt&&!state?.data))return;
    const attempt=life.attempt??{key:crypto.randomUUID(),uncertain:false,body:{kind:'post' as const,id:postId,selected:!state!.data!.selected}};
    // Synchronously freeze the tuple before the first await, including rapid duplicate clicks.
    const disclosure=life.read, wasUncertain=attempt.uncertain;
    attempt.uncertain=true;
    life.attempt=attempt;life.busy=true;render(value=>value+1);
    setView({life,data:state?.data??null,loading:false,error:null,notice:null});
    try {
      const value=await client.post<unknown>('/community-relations/bookmarks',attempt.body,{idempotencyKey:attempt.key,suppressConsole:true});
      if(!live()||!life.open||!details.current?.open||life.read!==disclosure)return;
      const row=value as Record<string,unknown>|null;
      if(!row||row.kind!=='post'||row.id!==postId||row.selected!==attempt.body.selected)throw new Error('unconfirmed bookmark');
      life.attempt=null;
      // ACK ends this command only. Re-read current visibility before offering another action.
      life.busy=false;
      await read(attempt.body.selected);
    } catch (cause) {
      if(live()&&life.open&&life.read===disclosure){
        const refused=!wasUncertain&&cause instanceof ApiError&&!cause.network&&!cause.timedOut&&!cause.accessExpired&&cause.status>=400&&cause.status<500;
        if(refused)life.attempt=null;
        setView({life,data:null,loading:false,error:refused?'refused':'write',notice:null});
      }
    }
    finally {life.busy=false;if(live())render(value=>value+1);}
  }
  // Closing the outer options does not discard a possibly committed write.
  useLayoutEffect(()=>{if(!menuOpen)disclose(false);},[menuOpen,life]);
  const held=life.attempt;
  function disclose(open:boolean) {
    if(!live()||life.open===open)return;
    life.open=open;if(details.current)details.current.open=open;
    if(!open){++life.read;life.reading=false;life.controller?.abort();setView(null);}
    else if(life.attempt)setView({life,data:null,loading:false,error:life.busy?null:'write',notice:null});
    else void read();
  }
  return <details key={`${postId}:${generation}`} ref={details} className="social-post-bookmark" data-post-id={postId}
    onToggle={event=>disclose(event.currentTarget.open)}
    onKeyDown={event=>{if(event.key==='Escape'&&life.open){event.preventDefault();event.stopPropagation();disclose(false);event.currentTarget.querySelector('summary')?.focus();}}}>
    <summary className="btn btn-ghost btn-small" style={{minHeight:44}} onClick={event=>{event.preventDefault();disclose(!life.open);}}>{text[0]}</summary>
    <div className="stack" style={{padding:'0.5rem 0',minWidth:0}}>
      <p className="field-hint">{text[1]}</p>
      <p role="status">{state?.loading?text[2]:life.busy?text[5]:state?.notice?text[state.notice==='saved'?6:7]:''}</p>
      {state?.data?.available===false&&<p>{text[13]}</p>}
      {(state?.error||held&&!life.busy)&&<p role="alert">{text[held?10:state?.error==='refused'?14:8]}</p>}
      {(state?.error==='read'||state?.error==='refused')&&!held&&<button type="button" className="btn btn-secondary btn-small" onClick={()=>void read()}>{text[9]}</button>}
      {(held||state?.data)&&<button type="button" className="btn btn-secondary btn-small" style={{minHeight:44}} disabled={life.busy||!!state?.loading}
        aria-pressed={held?undefined:state?.data?.selected} onClick={()=>void change()}>{life.busy?text[5]:held?text[held.body.selected?11:12]:text[state?.data?.selected?4:3]}</button>}
    </div>
  </details>;
}

/** Prefer the larger visible side; a long menu scrolls without escaping the viewport. */
export function postOptionsPlacement(top:number,bottom:number,viewportTop:number,viewportBottom:number) {
  const above=Math.max(0,top-viewportTop-12),below=Math.max(0,viewportBottom-bottom-12);
  return {above:above>below,maxHeight:Math.min(420,Math.max(above,below))};
}

/** Native disclosure, not an ARIA menu: its contents retain normal Tab navigation. */
export function SocialPostOptions({client,postId,bookmarksEnabled,children}:{client:PortalClient;postId:string;bookmarksEnabled:boolean;children:ReactNode}) {
  const menu=useRef<HTMLDetailsElement>(null);
  const [open,setOpen]=useState(false);
  const [placement,setPlacement]=useState({above:false,maxHeight:420});
  const close=()=>{if(menu.current)menu.current.open=false;setOpen(false);};
  useLayoutEffect(()=>{
    if(!open)return;
    const position=()=>{
      const rect=menu.current?.getBoundingClientRect();if(!rect)return;
      const viewport=window.visualViewport;
      const top=viewport?.offsetTop??0,bottom=top+(viewport?.height??window.innerHeight);
      const header=document.querySelector('.community-header')?.getBoundingClientRect();
      const visibleTop=Math.max(top,header?.bottom??top);
      // Do not leave an orphaned menu over another post or pull focus back on scroll.
      if(rect.bottom<=visibleTop||rect.top>=bottom){close();return;}
      const next=postOptionsPlacement(rect.top,rect.bottom,visibleTop,bottom);
      setPlacement(previous=>previous.above===next.above&&previous.maxHeight===next.maxHeight?previous:next);
    };
    position();
    const observer=new ResizeObserver(position);if(menu.current)observer.observe(menu.current);
    const header=document.querySelector('.community-header');if(header)observer.observe(header);
    window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
    window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
    return()=>{observer.disconnect();window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!menu.current?.contains(event.target))close();};
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  return <details ref={menu} className="social-post-menu"
    onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open);}}
    onBlur={event=>{if(event.relatedTarget instanceof Node&&!event.currentTarget.contains(event.relatedTarget))close();}}
    onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();menu.current?.querySelector('summary')?.focus();}}}>
    <summary aria-label="貼文選項">⋯</summary>
    <div className="social-post-menu-actions" style={{top:placement.above?'auto':'100%',bottom:placement.above?'100%':'auto',maxHeight:placement.maxHeight,overflowY:'auto'}}>{children}
      {bookmarksEnabled&&<SocialPostBookmark client={client} postId={postId} menuOpen={open}/>}
    </div>
  </details>;
}
