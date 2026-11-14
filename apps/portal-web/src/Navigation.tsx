import {useEffect, useRef} from 'react';
import type {TabId} from './types';
import {PORTAL_PLACES, resolvePortalRoute} from './portal-route';
export {TAB_TITLES} from './features/metadata';
export function Navigation({current,onSelect,mobileOpen,onCloseMobile,currentHash=`#${current}`}:{
 current:TabId;onSelect:(id:TabId,hash?:string)=>void;currentHash?:string;canManageGuild:boolean;canManagePlatform?:boolean;
 guildLaunchpadEnabled:boolean;communitySearchEnabled:boolean;personalContentEnabled:boolean;mobileOpen:boolean;onCloseMobile?:(returnFocus:boolean)=>void;
}) {
 const nav=useRef<HTMLElement>(null),closeMobile=useRef(onCloseMobile);
 closeMobile.current=onCloseMobile;
 const place=resolvePortalRoute(currentHash||'#'+current).place;
  useEffect(() => {
    if (!mobileOpen) return;
    const element = nav.current, header = element?.closest<HTMLElement>('.community-header');
    if (!element || !header) return;
    const toggle = header.querySelector<HTMLElement>('.mobile-menu-toggle');
    const measure = () => {
      if (window.matchMedia('(min-width:861px)').matches) { closeMobile.current?.(false); return; }
      const viewport = window.visualViewport;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      const top = header.getBoundingClientRect().bottom;
      header.style.setProperty('--mobile-navigation-top', `${top}px`);
      header.style.setProperty('--mobile-navigation-height', `${Math.max(0, bottom - top)}px`);
    };
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !element.contains(event.target) && !toggle?.contains(event.target)) {
        const backdrop = event.target instanceof Element && event.target.closest('.mobile-nav-backdrop');
        // Cancel only the backdrop's pointer focus default; otherwise it can
        // move focus to body after the toggle has been restored.
        if (backdrop && event.type === 'pointerdown') event.preventDefault();
        closeMobile.current?.(Boolean(backdrop));
      }
    };
    measure();
    (element.querySelector<HTMLElement>('.nav-primary [aria-current]') ?? element.querySelector<HTMLElement>('.nav-primary button'))?.focus();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
      header.style.removeProperty('--mobile-navigation-top');
      header.style.removeProperty('--mobile-navigation-height');
    };
  }, [mobileOpen]);
 return <>{mobileOpen&&<div className="mobile-nav-backdrop" aria-hidden="true"/>}<nav ref={nav} id="workspace-navigation" className={`nav workspace-navigation${mobileOpen?' is-open':''}`} aria-label="主要工作區">
 <div className="nav-mobile-heading"><strong>主要工作區</strong><button type="button" className="btn btn-ghost btn-small nav-close" aria-label="收合導覽" onClick={()=>closeMobile.current?.(true)}>×</button></div>
 <div className="nav-primary">{PORTAL_PLACES.map(item=><button type="button" key={item.id} className={`nav-item${place===item.id?' is-active':''}`} aria-current={place===item.id?'page':undefined} onClick={()=>onSelect(item.tab,`#${item.id}`)}>{item.title}</button>)}</div>
 </nav></>;
}
