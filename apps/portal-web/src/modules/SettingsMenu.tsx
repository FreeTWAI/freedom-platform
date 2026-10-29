import {SEASONAL_CHOICES,type SeasonalPreference} from '../seasonal/preferences';
import {useEffect,useId,useRef,useState,type KeyboardEvent,type ReactNode} from 'react';
import type {TabId} from '../types';
import {WORKSHOP_THEMES,useWorkshopTheme} from '../workshop-theme';
import './MemberSettings.css';
import {LANGUAGES,useLanguage} from '../language';
import {useAppInstall} from '../AppInstall';

export const SETTINGS_PAGES=[['profile','我的個人空間'],['account','我的名片'],['todos','入門指南']] as const satisfies readonly (readonly [TabId,string])[];
type Panel='main'|'language'|'appearance'|'seasonal';
type Item={key:string;label:string;run:()=>void;checked?:boolean;current?:boolean;lang?:string;disabled?:boolean;panel?:Panel};

/** One short account menu, with reversible preference panels. Page drafts stay mounted. */
export function SettingsMenu({current,avatar,name,onSelect,onLogout,logoutDisabled=false,seasonalPreference='auto',onSeasonalPreference}:{seasonalPreference?:SeasonalPreference;onSeasonalPreference?:(next:SeasonalPreference)=>void;current:TabId;avatar:ReactNode;name:string;onSelect:(id:TabId)=>void;onLogout:()=>void;logoutDisabled?:boolean;personalContentEnabled?:boolean}){
  const {theme,selectTheme}=useWorkshopTheme();
  const {preference,selectLanguage,t}=useLanguage();
  const install=useAppInstall();
  const [open,setOpen]=useState(false),[panel,setPanel]=useState<Panel>('main'),[focusIndex,setFocusIndex]=useState(0);
  const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),items=useRef<(HTMLButtonElement|null)[]>([]),returnIndex=useRef(0);
  const menuId=useId();
  const close=(returnFocus:boolean)=>{setOpen(false);if(returnFocus)button.current?.focus();};
  const page=(id:TabId,label:string):Item=>({key:id,label,current:current===id||(id==='profile'&&current==='my-content'),run:()=>{close(false);onSelect(id);}});
  const enter=(next:Panel)=>{returnIndex.current=main.findIndex(item=>item.panel===next);setFocusIndex(0);setPanel(next);};
  const back=()=>{if(panel==='seasonal'){setPanel('appearance');setFocusIndex(WORKSHOP_THEMES.length+1);}else{setPanel('main');setFocusIndex(returnIndex.current);}};
  const main:Item[]=[page('profile',t('nav.profile')),page('todos',t('nav.todos')),page('account',t('settings.account')),
    {key:'language',label:t('settings.language'),panel:'language',run:()=>enter('language')},
    {key:'appearance',label:t('settings.appearance'),panel:'appearance',run:()=>enter('appearance')},
    ...(!install.installed?[{key:'install',label:t('install.title'),run:()=>{close(false);install.open(button.current);}}]:[]),
    {key:'logout',label:t('settings.logout'),disabled:logoutDisabled,run:()=>{if(!logoutDisabled){close(true);onLogout();}}}];
  const choices:Item[]=panel==='main'?main:[{key:'back',label:t('settings.back'),run:back},...(panel==='language'
    ?(['auto',...LANGUAGES.map(([id])=>id)] as const).map(id=>({key:id,label:id==='auto'?t('language.auto'):LANGUAGES.find(([key])=>key===id)![1],lang:id==='auto'?undefined:id,checked:preference===id,run:()=>selectLanguage(id)}))
    :panel==='seasonal'?SEASONAL_CHOICES.map(([id,label])=>({key:id,label,checked:seasonalPreference===id,run:()=>onSeasonalPreference?.(id)}))
    :[...WORKSHOP_THEMES.map(([id,label])=>({key:id,label,checked:theme===id,run:()=>selectTheme(id)})),...(onSeasonalPreference?[{key:'seasonal',label:`節日主題 · ${SEASONAL_CHOICES.find(([id])=>id===seasonalPreference)![1]}`,panel:'seasonal' as const,run:()=>{setPanel('seasonal');setFocusIndex(0);}}]:[])])];
  useEffect(()=>{if(open)items.current[focusIndex]?.focus();},[open,focusIndex,panel]);
  useEffect(()=>setOpen(false),[current]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{
      if(root.current?.contains(event.target as Node))return;
      setOpen(false);
      setTimeout(()=>{if(!document.activeElement||document.activeElement===document.body)button.current?.focus();});
    };
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  function show(last=false){setPanel('main');setFocusIndex(last?main.length-1:0);setOpen(true);}
  function buttonKey(event:KeyboardEvent){if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show(event.key==='ArrowUp');}}
  function menuKey(event:KeyboardEvent){
    const last=choices.length-1;
    const next={ArrowDown:focusIndex===last?0:focusIndex+1,ArrowUp:focusIndex===0?last:focusIndex-1,Home:0,End:last}[event.key];
    if(next!==undefined){event.preventDefault();setFocusIndex(next);items.current[next]?.focus();}
    else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(panel!=='main')back();else close(true);}
    else if(event.key==='Tab')setTimeout(()=>setOpen(false));
  }
  return <div className="settings-menu" ref={root}>
    <button ref={button} type="button" className="btn btn-ghost topbar-profile settings-menu-button" aria-label={t('settings.title')} title={`${t('settings.title')} · ${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open?menuId:undefined} onClick={()=>open?close(true):show()} onKeyDown={buttonKey}>
      <span aria-hidden="true">{avatar}</span><span className="settings-menu-name">{name}</span><svg className="settings-menu-chevron" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    {open&&<div id={menuId} className="settings-menu-list settings-menu-compact" role="menu" aria-label={t('settings.profile')} data-settings-view={panel} onKeyDown={menuKey}>
      <span className="settings-menu-identity" role="presentation">{panel==='main'?name:panel==='seasonal'?'節日主題':t(panel==='language'?'settings.language':'settings.appearance')}</span>
      {choices.map((item,index)=><button key={`${panel}:${item.key}`} ref={node=>{items.current[index]=node;}} type="button" role={item.checked===undefined?'menuitem':'menuitemradio'} aria-checked={item.checked} aria-current={item.current?'page':undefined} aria-disabled={item.disabled||undefined} lang={item.lang} data-settings-panel={item.panel} tabIndex={index===focusIndex?0:-1} className={`settings-menu-item${item.current?' is-current':''}${panel==='appearance'&&index>0?' settings-theme-option':''}${item.key==='logout'?' settings-menu-logout':''}`} onFocus={()=>setFocusIndex(index)} onClick={item.run}>
        {item.key==='back'&&<span aria-hidden="true">←</span>}{item.label}{item.panel&&<span className="settings-panel-chevron" aria-hidden="true">›</span>}
      </button>)}
    </div>}
  </div>;
}
