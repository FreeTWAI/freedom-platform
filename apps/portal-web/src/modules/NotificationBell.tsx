import {lazy,useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import type {TabId} from '../types';
import {formatIsoLocal} from '../format';
import {useLanguage} from '../language';
import {INBOX_UPDATED,announceInboxChange,useReadAllInbox,type InboxUnread} from './member-inbox';
import {PageLoadBoundary} from '../LazyPage';
import {isOrderNotificationAction,type OrderNotificationAction} from '../../../../modules/member-communications/types';
const Notifications=lazy(()=>import('./MemberMessages').then(module=>({default:module.Notifications})));
import './NotificationBell.css';

type LegacyBellAction={tab:'members'|'squads'|'guilds'|'guild-workspace'|'messages'|'events'|'social';resource_id:string|null};
export type BellAction=LegacyBellAction|OrderNotificationAction;
type Notice={notification_id:string;title:string;body:string;created_at:string;read_at:string|null;action:BellAction|null};
type Page={items:Notice[];unread_count:number};
type ReadFailure={item:Notice;client:PortalClient;session:number;key:string;after:number};
const tabs=new Set<TabId>(['members','squads','guilds','guild-workspace','messages','events','social']);
const validAction=(action:BellAction|null)=>{
  if(action?.tab==='stores'||action?.tab==='reservations')return isOrderNotificationAction(action)?action:null;
  return action&&tabs.has(action.tab)&&(!action.resource_id||/^[0-9a-z_-]{1,100}$/i.test(action.resource_id))?action:null;
};

export function NotificationBell({client,onNavigate,preferencesEnabled=false}:{client:PortalClient;onNavigate?:(action:BellAction)=>void;preferencesEnabled?:boolean|null}){
  const {t}=useLanguage();
  const [page,setPage]=useState<Page|null>(null),[error,setError]=useState(false),[actionError,setActionError]=useState<ReadFailure|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState<string|null>(null),[loading,setLoading]=useState(false);
  const [showAll,setShowAll]=useState(false),[unread,setUnread]=useState<InboxUnread>(undefined);
  const badgeGeneration=useRef(0),readGeneration=useRef(0),readFailure=useRef<ReadFailure|null>(null);
  const keys=useRef(new Map<string,{key:string;after:number}>()),writeLock=useRef<object|null>(null),lifetime=useRef(0);
  const readScope=useRef({id:crypto.randomUUID(),epoch:0});
  const sessionGeneration=client.sessionGeneration;
  const scope=useRef({client,session:sessionGeneration,preferencesEnabled});scope.current={client,session:sessionGeneration,preferencesEnabled};
  useLayoutEffect(()=>{readScope.current.epoch++;keys.current.clear();writeLock.current=null;readFailure.current=null;setBusy(null);setActionError(null);setPage(null);setUnread(undefined);setError(false);return()=>{readScope.current.epoch++;lifetime.current++;badgeGeneration.current++;};},[client,sessionGeneration]);
  // A changed filtering policy invalidates only badge evidence, never an in-flight read command.
  useLayoutEffect(()=>{readScope.current.epoch++;badgeGeneration.current++;setUnread(undefined);},[preferencesEnabled]);
  const all=useReadAllInbox(client,'notifications'),generation=useRef(0),alive=useRef(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),readError=useRef<HTMLDivElement>(null);
  const refresh=useCallback(async(fresh=false)=>{
    if(!alive.current)return;
    const current=++generation.current,badgeRequest=++badgeGeneration.current,readRequest=++readGeneration.current,session=client.sessionGeneration,epoch=lifetime.current;
    const valid=()=>alive.current&&epoch===lifetime.current&&current===generation.current&&scope.current.preferencesEnabled===preferencesEnabled&&scope.current.client===client&&session===scope.current.session&&session===client.sessionGeneration;
    // Until the site flag is known, show neither a stale nor an unfiltered count.
    if(preferencesEnabled===null){setPage(null);setUnread(undefined);return;}
    setLoading(true);setError(false);
    try{
      // Keep PortalClient's write/auth invalidation; only partition preview snapshot epochs.
      if(fresh||keys.current.size>0)readScope.current.epoch++;
      const coalesceScope=`${readScope.current.id}:${readScope.current.epoch}`;
      const [history,reminders]=await Promise.all([client.get<Page>('/me/notifications?limit=6&offset=0',{background:true,coalesce:true,coalesceScope}),preferencesEnabled?client.get<{unread_count:number}>('/me/notification-preferences/reminders',{background:true,coalesce:true,coalesceScope}):Promise.resolve(null)]);
      if(valid()){reconcileRead(history.items,readRequest);setPage(history);setError(false);if(badgeRequest===badgeGeneration.current)setUnread(reminders?.unread_count??history.unread_count);}
    }catch{if(valid()){setPage(null);setError(true);if(badgeRequest===badgeGeneration.current)setUnread(null);}}
    finally{if(valid())setLoading(false);}
  },[client,preferencesEnabled,sessionGeneration]);
  const beginUnread=useCallback(()=>{
    // A newer history read also retires any older preview transport.
    readScope.current.epoch++;
    // History and preview counts share one request-order authority, not response-order guesses.
    const session=client.sessionGeneration,epoch=lifetime.current,readRequest=++readGeneration.current;
    const request=badgeGeneration.current;
    return (count:InboxUnread,items?:ReadonlyArray<{notification_id:string;read_at:string|null}>)=>{
      if(!alive.current||epoch!==lifetime.current||scope.current.client!==client||scope.current.session!==session||session!==client.sessionGeneration||scope.current.preferencesEnabled!==preferencesEnabled||request!==badgeGeneration.current)return;
      if(items)reconcileRead(items,readRequest);
      // Full history cannot publish a count that includes suppressed reminders.
      if(preferencesEnabled!==false){if(preferencesEnabled)void refresh(true);return;}
      // An abandoned history read must not revoke the shell refresh that survives navigation.
      if(typeof count==='number'||count===null){badgeGeneration.current++;setUnread(count);}
    };
  },[client,preferencesEnabled,refresh]);
  useEffect(()=>{
    alive.current=true;void refresh();const update=(event:Event)=>void refresh(event.type===INBOX_UPDATED||event.type==='freedom-notification-preferences-updated');
    const events=['focus','online',INBOX_UPDATED,'freedom-notification-preferences-updated'];
    for(const event of events)window.addEventListener(event,update);
    return()=>{alive.current=false;generation.current++;for(const event of events)window.removeEventListener(event,update);};
  },[refresh]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus();}};
    window.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape);
    return()=>{window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape);};
  },[open]);
  function reconcileRead(items:ReadonlyArray<{notification_id:string;read_at:string|null}>,request:number){
    if(!alive.current||scope.current.client!==client||scope.current.session!==client.sessionGeneration)return;
    for(const item of items){
      const intent=keys.current.get(item.notification_id);
      if(!intent||request<=intent.after||typeof item.read_at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(item.read_at)||!Number.isFinite(Date.parse(item.read_at)))continue;
      // A later authorized read of this exact record is proof, even if its alert was dismissed.
      keys.current.delete(item.notification_id);
      if(readFailure.current?.item.notification_id===item.notification_id&&readFailure.current.key===intent.key)dismissReadError();
    }
  }
  function dismissReadError(){
    if(!alive.current||scope.current.client!==client||scope.current.session!==client.sessionGeneration)return;
    const restore=readError.current?.contains(document.activeElement);
    readFailure.current=null;setActionError(null);
    if(restore)trigger.current?.focus();
  }
  async function choose(item:Notice,navigate=true){
    if(writeLock.current||!alive.current)return;
    const operation={},session=client.sessionGeneration,epoch=lifetime.current;
    const valid=()=>alive.current&&epoch===lifetime.current&&scope.current.client===client&&scope.current.session===session&&session===client.sessionGeneration;
    writeLock.current=operation;setBusy(item.notification_id);
    if(navigate){readFailure.current=null;setActionError(null);}
    try{
      if(!item.read_at){
        const intent=keys.current.get(item.notification_id)??{key:crypto.randomUUID(),after:readGeneration.current},key=intent.key;keys.current.set(item.notification_id,intent);
        try{
          const result=await client.post<{read_at:string;notification_id?:string}>(`/me/notifications/${encodeURIComponent(item.notification_id)}/read`,{},{idempotencyKey:key});
          if(!valid())return;
          if(!result||typeof result.read_at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(result.read_at)||!Number.isFinite(Date.parse(result.read_at))||result.notification_id!==undefined&&result.notification_id!==item.notification_id)throw new Error();
          keys.current.delete(item.notification_id);
          dismissReadError();
          // Only the server's next count is authoritative, including notices arriving during this write.
          setPage(current=>current?{...current,items:current.items.map(value=>value.notification_id===item.notification_id?{...value,read_at:result.read_at}:value)}:current);
          // The event starts a fresh (not pre-write coalesced) read and fences older responses.
          announceInboxChange();
        }catch{if(!valid())return;if(keys.current.get(item.notification_id)?.key===key){intent.after=readGeneration.current;const failure={item,client,session,key,after:intent.after};readFailure.current=failure;setActionError(failure);}}
      }
      if(!valid()||!navigate)return;
      const action=validAction(item.action);if(action&&onNavigate){setOpen(false);onNavigate(action);}else setShowAll(true);
    }finally{if(writeLock.current===operation)writeLock.current=null;if(valid())setBusy(null);}
  }
  const pendingError=actionError&&actionError.client===client&&actionError.session===client.sessionGeneration?actionError:null;
  return <div ref={root} className="notification-bell"><button ref={trigger} type="button" className="btn btn-ghost notification-bell-trigger" aria-label={unread===null?t('notice.unknown'):typeof unread==='number'?(unread?t('notice.count',{count:unread}):t('notice.title')):t('notice.pending')} aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)void refresh();}}>
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>{unread===null?<b className="notification-bell-count">?</b>:typeof unread==='number'&&unread>0&&<b className="notification-bell-count">{unread>99?'99+':unread}</b>}
  </button>{open&&<div className="notification-bell-popover" role="region" aria-label={t('notice.recent')}><div className="notification-bell-head"><strong>{t('notice.title')}</strong><button type="button" className="btn btn-ghost" disabled={all.busy||!!busy} onClick={()=>void all.markAll()}>{all.busy?t('notice.marking'):t('notice.markAll')}</button></div>
    <p className="field-hint">{t('notice.scope')}</p>{all.error&&<p role="alert">{t('notice.allError')}</p>}
    {!showAll&&loading&&<p className="field-hint" role="status">{t('notice.loading')}</p>}
    {!showAll&&error&&<div><p role="alert">{t('notice.loadError')}</p><button type="button" className="btn btn-ghost" onClick={()=>void refresh()}>{t('feedback.retry')}</button></div>}
    {!showAll&&!error&&!loading&&page?.items.length===0&&<p>{t('notice.empty')}</p>}
    {!showAll&&page?.items.map(item=><button key={item.notification_id} type="button" className={`notification-bell-item${item.read_at?'':' is-unread'}`} disabled={all.busy||busy===item.notification_id} onClick={()=>void choose(item)}><strong>{item.title}</strong><span>{item.body}</span><small>{formatIsoLocal(item.created_at)} · {busy===item.notification_id?t('notice.marking'):item.read_at?t('notice.read'):t('notice.unread')}</small></button>)}
    {showAll?<PageLoadBoundary label={t('notice.title')} onHome={()=>setOpen(false)}><Notifications client={client} onUnread={beginUnread} onSocial={action=>{setOpen(false);onNavigate?.(action);}} onOrder={onNavigate?action=>{setOpen(false);onNavigate(action);}:undefined} onNavigate={tab=>{setOpen(false);onNavigate?.({tab:tab as LegacyBellAction['tab'],resource_id:null});}} onOpenPeer={id=>{setOpen(false);onNavigate?.({tab:'messages',resource_id:id});}}/></PageLoadBoundary>:<button type="button" className="btn btn-ghost notification-bell-all" onClick={()=>setShowAll(true)}>{t('notice.seeAll')}</button>}
  </div>}{pendingError&&<div ref={readError} className="notification-bell-read-error" role="alert"><p>{t('notice.readError')}</p><div className="notification-bell-head"><button type="button" className="btn btn-ghost" aria-disabled={!!busy} onClick={()=>void choose(pendingError.item,false)}>{busy?t('notice.marking'):t('feedback.retry')}</button><button type="button" className="btn btn-ghost" onClick={dismissReadError}>{t('notice.dismissError')}</button></div></div>}</div>;
}
