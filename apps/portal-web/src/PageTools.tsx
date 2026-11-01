import {useEffect,useRef,useState,type ReactNode} from 'react';
import {developmentPages} from '../../../modules/development/pages';
import type {PortalClient} from './api';
import './PageTools.css';

export type PageTool='idea'|'help'|'edit';
export const PAGE_TOOL_NAMES:Record<PageTool,string>={idea:'提出想法',help:'頁面說明',edit:'參與編修'};
const names=PAGE_TOOL_NAMES;
type DialogComponent=typeof import('../../../modules/portal-shell/page-tools/Dialog')['PageToolsDialog'];
const icons:Record<PageTool,ReactNode>={
  idea:<><path d="M9 18h6m-5 3h4M8 14c-1.3-1.1-2-2.7-2-4.5a6 6 0 1 1 12 0c0 1.8-.7 3.4-2 4.5-.7.6-1 1.3-1 2H9c0-.7-.3-1.4-1-2Z"/></>,
  help:<><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 0 1 5 .9c0 1.9-2.5 2.3-2.5 4.2m0 3h.01"/></>,
  edit:<><path d="m4 20 4.2-.9L19 8.3 15.7 5 4.9 15.8 4 20Zm9.8-13.2 3.3 3.3M4 20h16"/></>,
};

/** Keep the toolbar stable; load and retain its stateful dialog only after an explicit choice. */
export function PageTools({pageId,client,compact=false,ideaDraft}:{pageId:string;client?:PortalClient;compact?:boolean;ideaDraft?:{title:string;body:string;label:string}}){
  const page=developmentPages.find(value=>value.id===pageId);
  const [tool,setTool]=useState<PageTool|null>(null),[Dialog,setDialog]=useState<DialogComponent|null>(null);
  const [loadState,setLoadState]=useState<'idle'|'loading'|'failed'>('idle');
  const dialog=useRef<HTMLDialogElement>(null),toolsMenu=useRef<HTMLDetailsElement>(null),toolsTrigger=useRef<HTMLElement>(null);
  const clickedTool=useRef<HTMLButtonElement|null>(null),feedback=useRef<HTMLElement>(null),request=useRef(0),alive=useRef(true);
  const sessionGeneration=client?.sessionGeneration;
  const owner=useRef({pageId,client,sessionGeneration});owner.current={pageId,client,sessionGeneration};
  const cancelPending=()=>{request.current++;setTool(null);setLoadState('idle')};
  const closeTool=()=>{
    dialog.current?.close();
    if(compact&&toolsMenu.current){toolsMenu.current.open=false;toolsTrigger.current?.focus()}
    else if(clickedTool.current?.isConnected)clickedTool.current.focus();
    cancelPending();
  };
  const openTool=(next:PageTool,trigger:HTMLButtonElement)=>{
    clickedTool.current=trigger;setTool(next);
    if(Dialog)return;
    const generation=++request.current,scope=owner.current;
    const current=()=>alive.current&&request.current===generation&&owner.current.pageId===scope.pageId&&owner.current.client===scope.client&&scope.client?.sessionGeneration===scope.sessionGeneration;
    setLoadState('loading');
    void import('../../../modules/portal-shell/page-tools/Dialog').then(module=>{
      if(!current())return;
      setDialog(()=>module.PageToolsDialog);setLoadState('idle');
    }).catch(()=>{if(current())setLoadState('failed')});
  };
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current++}},[]);
  useEffect(()=>{
    request.current++;
    if(toolsMenu.current)toolsMenu.current.open=false;
    // A late import belongs to the page/account that requested it, never its successor.
    if(!Dialog){setTool(null);setLoadState('idle')}
  },[pageId,client,sessionGeneration]);
  useEffect(()=>{
    if(!compact)return;
    const outside=(event:PointerEvent)=>{
      if(event.target instanceof Node&&!toolsMenu.current?.contains(event.target)&&!dialog.current?.contains(event.target)&&!feedback.current?.contains(event.target)&&toolsMenu.current){
        toolsMenu.current.open=false;
        // Dismissing the menu while loading must not open a late dialog or steal outside focus.
        if(!Dialog&&tool)cancelPending();
      }
    };
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[compact,Dialog,tool]);
  useEffect(()=>{
    if(Dialog||!tool)return;
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();closeTool()}};
    document.addEventListener('keydown',escape);
    return()=>document.removeEventListener('keydown',escape);
  },[Dialog,tool,compact]);
  if(!page)return null;
  return <>
    <div className={`page-tools${compact?' page-tools--compact':''}`} role="group" aria-label={`${page.title}頁面工具`}>
      {ideaDraft?<button type="button" className="btn btn-secondary btn-small" onClick={event=>openTool('idea',event.currentTarget)}>{ideaDraft.label}</button>:compact?<details ref={toolsMenu} className="page-tools-menu" onToggle={event=>{if(!event.currentTarget.open&&!Dialog&&tool)cancelPending()}} onKeyDown={event=>{if(event.key==='Escape'&&toolsMenu.current){toolsMenu.current.open=false;toolsTrigger.current?.focus()}}}>
        <summary ref={toolsTrigger} aria-label="頁面工具" onClick={()=>{if(toolsMenu.current?.open&&!Dialog&&tool)cancelPending()}}><span aria-hidden="true">⋯</span></summary>
        <div className="page-tools-menu-items">{(['idea','help','edit'] as const).map(item=><button key={item} type="button" className={`page-tool-button page-tool-button--${item}`} onClick={event=>openTool(item,event.currentTarget)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[item]}</svg><span className="page-tool-label">{names[item]}</span></button>)}</div>
      </details>:<>{(['idea','help','edit'] as const).map(item=><button key={item} type="button" className={`page-tool-button page-tool-button--${item}`} aria-label={names[item]} onClick={event=>openTool(item,event.currentTarget)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[item]}</svg><span className="page-tool-label">{names[item]}</span></button>)}</>}
    </div>
    {!Dialog&&tool&&<section ref={feedback} className="page-tools-note" aria-label={`${page.title}：${names[tool]}`}>
      {loadState==='loading'?<p role="status" aria-live="polite">正在開啟{names[tool]}…</p>:loadState==='failed'?<p role="alert">頁面工具暫時無法載入。請重新載入頁面後再試。</p>:null}
      <div className="actions">{loadState==='failed'&&<button type="button" className="btn btn-secondary btn-small" onClick={()=>window.location.reload()}>重新載入頁面</button>}<button type="button" className="btn btn-ghost btn-small" onClick={closeTool}>關閉頁面工具</button></div>
    </section>}
    {Dialog&&<Dialog pageId={pageId} client={client} page={page} tool={tool} dialog={dialog} closeTool={closeTool} initialDraft={ideaDraft}/>}
  </>;
}
