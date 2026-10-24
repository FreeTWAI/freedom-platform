import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import type {PortalClient} from '../api';
import {useLanguage} from '../language';
import {useInboxUnread} from './member-inbox';
import {useChatViewport} from './ChatWorkspace';
// Load the shared styles before the floating overrides, even when chat code is lazy.
import './MemberSettings.css';
import './ChatWorkspace.css';
import './FloatingMessages.css';

/** One persistent inbox. Closing only hides it, so drafts and unknown sends survive. */
export function FloatingMessages({client,open,onToggle,onClose,children,preferencesEnabled=false}:{client:PortalClient;preferencesEnabled?:boolean|null;open:boolean;onToggle:()=>void;onClose:()=>void;children:ReactNode}){
  const {t}=useLanguage(),{total}=useInboxUnread(client,'messages',preferencesEnabled);
  const mobile=useChatViewport();
  const trigger=useRef<HTMLButtonElement>(null),heading=useRef<HTMLHeadingElement>(null),panel=useRef<HTMLElement>(null);
  const wasOpen=useRef(false);
  const [sizeOpen,setSizeOpen]=useState(false),[width,setWidth]=useState(560),[height,setHeight]=useState(540);
  const label=open?t('chat.collapse'):t(total===undefined?'chat.launchLoading':total===null?'chat.launchUnknown':total>0?'chat.launchUnread':'chat.launch',{count:total??0});
  useLayoutEffect(()=>{
    if(!open||!mobile)return;
    const frame=panel.current?.parentElement;
    const background=Array.from(frame?.children??[]).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node!==panel.current&&node!==trigger.current);
    const previous=background.map(node=>node.inert);
    background.forEach(node=>{node.inert=true;});
    const root=document.documentElement,overflow=root.style.overflow,bodyOverflow=document.body.style.overflow;
    root.style.overflow='hidden';document.body.style.overflow='hidden';
    return()=>{
      background.forEach((node,index)=>{node.inert=previous[index];});
      root.style.overflow=overflow;document.body.style.overflow=bodyOverflow;
    };
  },[mobile,open]);
  useEffect(()=>{
    if(open&&!wasOpen.current)heading.current?.focus({preventScroll:true});
    // On phones the launcher becomes focusable only after the close render.
    if(!open&&wasOpen.current)trigger.current?.focus({preventScroll:true});
    wasOpen.current=open;
  },[open]);
  return <>
    <section ref={panel} id="floating-message-panel" className="floating-message-panel" role={mobile?'dialog':'region'} aria-modal={mobile&&open?true:undefined} aria-labelledby="floating-message-title" hidden={!open}
      style={{'--chat-panel-width':`${width}px`,'--chat-panel-height':`${height}px`} as CSSProperties}
      onKeyDown={event=>{
        if(event.defaultPrevented||document.querySelector('dialog[open]'))return;
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
        if(mobile&&event.key==='Tab'){
          const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,[tabindex]'))
            .filter(node=>node.tabIndex>=0&&!node.matches(':disabled')&&!node.closest('[inert]')&&node.getClientRects().length>0);
          const first=controls[0],last=controls.at(-1),active=document.activeElement;
          if(event.shiftKey&&(active===first||active===heading.current)){event.preventDefault();(last??heading.current)?.focus();}
          else if(!event.shiftKey&&active===last){event.preventDefault();(first??heading.current)?.focus();}
        }
      }}>
      <header className="floating-message-header"><h2 id="floating-message-title" ref={heading} tabIndex={-1}>{t('nav.messages')}</h2>
        <button type="button" className="btn btn-ghost floating-message-size-toggle" aria-expanded={sizeOpen} aria-controls="floating-message-size" onClick={()=>setSizeOpen(value=>!value)}>{t('chat.size')}</button>
        <button type="button" className="btn btn-ghost" onClick={()=>onClose()} aria-label={t('chat.collapse')} title={t('chat.collapse')}><span aria-hidden="true">×</span></button>
      </header>
      <div id="floating-message-size" className="floating-message-size" hidden={!sizeOpen}>
        <label className="floating-message-width">{t('chat.width')} <input type="range" min={440} max={1000} step={20} value={width} onChange={event=>setWidth(Number(event.target.value))}/></label>
        <label>{t('chat.height')} <input type="range" min={360} max={800} step={20} value={height} onChange={event=>setHeight(Number(event.target.value))}/></label>
        <button type="button" className="btn btn-ghost" onClick={()=>{setWidth(560);setHeight(540);}}>{t('chat.sizeReset')}</button>
      </div>
      <div className="floating-message-content">{children}</div>
    </section>
    <button ref={trigger} className="floating-messages" type="button" onClick={onToggle} aria-label={label} title={label} aria-expanded={open} aria-controls="floating-message-panel">
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H5l-3 2V11.5A8.5 8.5 0 0 1 10.5 3h2A8.5 8.5 0 0 1 21 11.5Z"/><path d="M7 10h9M7 14h6"/></svg>
      <span className="floating-messages-label">{t('chat.short')}</span>
      {(total===null||typeof total==='number'&&total>0)&&<span className="floating-messages-badge" aria-hidden="true">{total===null?'?':total>99?'99+':total}</span>}
    </button>
  </>;
}
