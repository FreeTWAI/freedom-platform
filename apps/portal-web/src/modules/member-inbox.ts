import {useCallback,useEffect,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {ApiError} from '../api';

/** Fired after the server confirms a read or a sent message so the menu re-reads real totals. */
export const INBOX_UPDATED='freedom-inbox-updated';
export const INBOX_ALL_READ='freedom-inbox-all-read';
export const NOTIFICATIONS_READ='freedom-notifications-read';
export const announceInboxChange=()=>window.dispatchEvent(new Event(INBOX_UPDATED));

export function useReadAllInbox(client:PortalClient,scope:'inbox'|'notifications'='inbox'){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const key=useRef<string|null>(null),locked=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  async function markAll(){
    if(locked.current)return;
    const session=client.sessionGeneration,valid=()=>alive.current&&session===client.sessionGeneration;
    locked.current=true;setBusy(true);setError('');key.current??=crypto.randomUUID();
    try{
      await client.post('/me/inbox/read-all',scope==='notifications'?{scope}:{},{idempotencyKey:key.current,suppressConsole:true});
      // The shell still needs the confirmed totals after this page unmounts.
      // A different login must never receive the previous session’s acknowledgement.
      if(session!==client.sessionGeneration)return;
      key.current=null;
      window.dispatchEvent(new Event(scope==='notifications'?NOTIFICATIONS_READ:INBOX_ALL_READ));announceInboxChange();
    }catch(cause){
      if(!valid())return;
      if(cause instanceof ApiError&&!cause.network&&cause.status>0&&cause.status<500)key.current=null;
      setError('尚未確認全部已讀，請再按一次重試。');
    }finally{locked.current=false;if(valid())setBusy(false)}
  }
  return {busy,error,markAll};
}

/** undefined = not read yet, null = could not be confirmed; never guessed as 0. */
export type InboxUnread=number|null|undefined;

// Four separate sources: notifications, private conversations, guild and squad chat. Messages
// do not create notifications, so they never double count. Each is a one-item list read: no
// history is opened here, and one failed source makes the whole total unconfirmed.
const SOURCES=['/me/notifications?limit=1&offset=0','/me/conversations?limit=1&offset=0','/me/channels?kind=guild&limit=1&offset=0','/me/channels?kind=squad&limit=1&offset=0'];
const CHAT_SOURCES=[...SOURCES.slice(1),'/me/channels?kind=world&limit=1&offset=0'];
type UnreadOwner={client:PortalClient;session:number;scope:'inbox'|'messages';preferencesEnabled:boolean|null};
const sameUnreadOwner=(a:UnreadOwner,b:UnreadOwner)=>a.client===b.client&&a.session===b.session&&a.scope===b.scope&&a.preferencesEnabled===b.preferencesEnabled;
export function useInboxUnread(client:PortalClient,scope:'inbox'|'messages'='inbox',preferencesEnabled:boolean|null=false){
  const owner:UnreadOwner={client,session:client.sessionGeneration,scope,preferencesEnabled};
  const currentOwner=useRef(owner);currentOwner.current=owner;
  // A prior policy/client's count must disappear during render, before effect cleanup.
  const [result,setResult]=useState<{owner:UnreadOwner;total:InboxUnread}|null>(null);
  const generation=useRef(0);
  const readScope=useRef({id:'',epoch:0});if(!readScope.current.id)readScope.current.id=crypto.randomUUID();
  const refresh=useCallback(async()=>{
    const requestedOwner:UnreadOwner={client,session:client.sessionGeneration,scope,preferencesEnabled};
    if(!sameUnreadOwner(requestedOwner,currentOwner.current))return;
    const current=++generation.current;
    const valid=()=>current===generation.current&&requestedOwner.session===client.sessionGeneration&&sameUnreadOwner(requestedOwner,currentOwner.current);
    const publish=(total:InboxUnread)=>{if(valid())setResult({owner:requestedOwner,total});};
    if(scope==='messages'&&preferencesEnabled===null){publish(undefined);return;}
    // Every later focus/read must stay in this resume epoch, never reuse pre-hide work.
    const options={skipAuthHandler:true,background:true,coalesce:true,coalesceScope:`${readScope.current.id}:${readScope.current.epoch}:${scope}:${preferencesEnabled}`};
    try{
      if(scope==='messages'&&preferencesEnabled){
        const [direct,channels]=await Promise.all([
          client.get<{unread_count:number}>(CHAT_SOURCES[0],options),
          client.get<{guild:number;squad:number;world:number}>('/me/notification-preferences/channel-reminders',options),
        ]);
        if(!valid())return;
        const counts=[direct.unread_count,channels.guild,channels.squad,channels.world],sum=counts.reduce((value,count)=>value+count,0);
        publish(counts.every(count=>Number.isSafeInteger(count)&&count>=0)&&Number.isSafeInteger(sum)?sum:null);return;
      }
      const pages=await Promise.all((scope==='messages'?CHAT_SOURCES:SOURCES).map(path=>client.get<{unread_count:number}>(path,options)));
      if(!valid())return;
      const sum=pages.reduce((value,page)=>value+page.unread_count,0);
      publish(pages.every(page=>Number.isSafeInteger(page.unread_count)&&page.unread_count>=0)&&Number.isSafeInteger(sum)?sum:null);
    }catch{publish(null);}
  },[client,scope,preferencesEnabled,owner.session]);
  useEffect(()=>{
    let disposed=false,suspended=false,queued=false;
    const available=()=>!disposed&&!suspended&&document.visibilityState==='visible'&&navigator.onLine!==false;
    const schedule=()=>{
      if(!available()||queued)return;queued=true;
      // Focus, pageshow and visibility can arrive together; one event burst needs one count read.
      queueMicrotask(()=>{queued=false;if(available())void refresh();});
    };
    const update=()=>schedule();
    const pause=()=>{suspended=true;generation.current++;};
    // Advance even while offline: the later online event must not borrow a pre-hide read.
    const resume=()=>{suspended=false;generation.current++;readScope.current.epoch++;schedule();};
    const visible=()=>{if(document.visibilityState==='visible')resume();else pause();};
    update();
    // Only enabled reminder policy needs a clock refresh for quiet-hour boundaries; no history is opened.
    const timer=scope==='messages'&&preferencesEnabled===true?window.setInterval(update,30000):undefined;
    const events=['focus','online',INBOX_UPDATED,'freedom-profile-updated','freedom-notification-preferences-updated'];
    for(const name of events)window.addEventListener(name,update);
    window.addEventListener('pageshow',resume);window.addEventListener('pagehide',pause);document.addEventListener('visibilitychange',visible);
    return()=>{disposed=true;generation.current++;window.clearInterval(timer);for(const name of events)window.removeEventListener(name,update);
      window.removeEventListener('pageshow',resume);window.removeEventListener('pagehide',pause);document.removeEventListener('visibilitychange',visible);};
  },[refresh,scope,preferencesEnabled]);
  const total=result&&sameUnreadOwner(result.owner,owner)?result.total:undefined;
  return {total,refresh};
}
