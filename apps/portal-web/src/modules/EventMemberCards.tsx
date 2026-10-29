import {useEffect,useId,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {MemberCardQr} from './MemberCardQr';
import {MemberECard,type CardDesign,type CardLink,type CardProfileLink} from './MemberECard';
import './EventMemberCards.css';

type Props={client:PortalClient;eventId:string;userId:string};
type PublicCard={nickname:string;primary_guild:{name:string}|null;capabilities:string[];avatar_url:string|null;design?:CardDesign;headline?:string|null;links?:CardLink[];profile_links?:CardProfileLink[]};
type View={kind:'idle'|'loading'|'disabled'|'error'}|{kind:'ready';url:string;card:PublicCard};

/** Accept only the existing capability path, never a profile ID or redirect URL. */
export function eventMemberCardUrl(path:unknown,origin:string):string|null{
  if(typeof path!=='string'||!/^\/member-cards\/[A-Za-z0-9_-]{43}$/.test(path))return null;
  try{const url=new URL(path,origin);return ['https:','http:'].includes(url.protocol)&&url.origin===origin?url.href:null;}catch{return null;}
}

/** Participation is not consent to publish a card or join a networking directory. */
export function EventMemberCards(props:Props){
  // A replacement transport may start its session counter at the same number.
  // Remount the reader for object identity changes too, before reusing any state.
  const transport=useRef({client:props.client,revision:0});
  if(transport.current.client!==props.client)transport.current={client:props.client,revision:transport.current.revision+1};
  return <EventMemberCardsContent key={`${transport.current.revision}:${props.userId}:${props.client.sessionGeneration}:${props.eventId}`} {...props}/>;
}
function EventMemberCardsContent({client}:Props){
  const [open,setOpen]=useState(false),[view,setView]=useState<View>({kind:'idle'});
  const id=useId(),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  const mounted=useRef(false),active=useRef(false),generation=useRef(0),controller=useRef<AbortController|null>(null);
  const owner=useRef(client.sessionGeneration),entry=useRef('');
  const current=(run:number)=>mounted.current&&active.current&&generation.current===run&&client.sessionGeneration===owner.current&&window.location.href===entry.current;
  function invalidate(){generation.current++;controller.current?.abort();controller.current=null;}
  function close(restoreFocus=true){
    active.current=false;invalidate();setOpen(false);setView({kind:'idle'});
    if(dialog.current?.open)dialog.current.close();
    if(restoreFocus&&trigger.current?.isConnected)trigger.current.focus({preventScroll:true});
  }
  async function load(){
    if(!mounted.current||!active.current||client.sessionGeneration!==owner.current||document.visibilityState!=='visible')return;
    invalidate();const run=generation.current,abort=new AbortController();controller.current=abort;
    setView({kind:'loading'});
    try{
      const settings=await client.get<{enabled:boolean;share_path:string|null}>('/me/member-card-share',{signal:abort.signal});
      if(!current(run))return;
      if(!settings.enabled){setView({kind:'disabled'});return;}
      const url=eventMemberCardUrl(settings.share_path,window.location.origin);
      if(!url)throw new Error('invalid_card_path');
      // Read the actual anonymous projection, not the owner's private profile/settings.
      const card=await client.get<PublicCard>(`/public${new URL(url).pathname}`,{signal:abort.signal});
      if(current(run))setView({kind:'ready',url,card});
    }catch{if(current(run))setView({kind:'error'});}
  }
  function show(){
    if(active.current||client.sessionGeneration!==owner.current)return;
    entry.current=window.location.href;active.current=true;setOpen(true);
    dialog.current?.showModal();closeButton.current?.focus();void load();
  }
  useEffect(()=>{
    mounted.current=true;
    const refresh=()=>{if(active.current)void load();};
    const visibility=()=>{if(document.visibilityState==='visible')refresh();else if(active.current){invalidate();setView({kind:'loading'});}};
    // No synthetic history entry: Back navigates normally, invalidating this read.
    const leave=()=>close(false);
    window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);
    window.addEventListener('popstate',leave);window.addEventListener('hashchange',leave);window.addEventListener('pagehide',leave);
    window.addEventListener('freedom-game-console-session-end',leave);document.addEventListener('visibilitychange',visibility);
    return()=>{mounted.current=false;active.current=false;invalidate();
      window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);
      window.removeEventListener('popstate',leave);window.removeEventListener('hashchange',leave);window.removeEventListener('pagehide',leave);
      window.removeEventListener('freedom-game-console-session-end',leave);document.removeEventListener('visibilitychange',visibility);
      if(dialog.current?.open)dialog.current.close();
    };
  },[client]);
  return <section className="event-member-cards" aria-label="現場認識夥伴">
    <h3>現場認識夥伴</h3><p>見面時，出示自己願意分享的名片。報名不會公開你的名片或聯絡方式。</p>
    <button ref={trigger} type="button" className="btn btn-secondary btn-small" aria-haspopup="dialog" onClick={show}>出示我的名片</button>
    <details className="event-member-card-help"><summary>怎麼掃碼認識對方？</summary><ol><li>請對方打開「出示我的名片」。</li><li>用你手機原本的相機對準 QR Code，再點相機顯示的名片連結。</li><li>先看對方願意分享的介紹；要成為好友，再由本人登入並送出邀請。</li></ol><p>這裡不會啟動相機。不方便掃碼時，請對方從名片設定分享連結。</p></details>
    <dialog ref={dialog} className="event-member-card-dialog" aria-labelledby={`${id}-title`} onCancel={event=>{event.preventDefault();close();}} onClose={()=>{if(!dialog.current?.open&&active.current)close();}}>
      <header><h2 id={`${id}-title`}>出示我的名片</h2><button ref={closeButton} type="button" className="btn btn-secondary btn-small" onClick={()=>close()} aria-label="關閉名片">關閉</button></header>
      {open&&<div className="event-member-card-body">
        {view.kind==='loading'&&<p role="status">正在確認你目前公開的名片…</p>}
        {view.kind==='disabled'&&<><h3>你的名片還沒有開放分享</h3><p>先到名片設定查看預覽，確認願意公開的內容後，再按「建立分享連結」。拿到連結的人不必登入也能看見。</p></>}
        {view.kind==='error'&&<div role="alert"><p>目前無法出示名片，可能已停用分享、換了連結，或連線未完成。舊名片已隱藏。</p><button type="button" className="btn btn-secondary btn-small" onClick={()=>void load()}>重新確認名片</button></div>}
        {view.kind==='ready'&&<><p><strong>{view.card.nickname}</strong>，讓對方用手機相機掃這個 QR Code。</p><div className="event-member-card-qr"><MemberCardQr url={view.url}/></div><p className="field-hint">這是你已開放的免登入名片，不是活動報名名單。</p><details><summary>查看對方會看到的名片</summary><MemberECard design={view.card.design??'calm'} nickname={view.card.nickname} headline={view.card.headline??null} guildName={view.card.primary_guild?.name??null} capabilities={view.card.capabilities} avatarUrl={view.card.avatar_url} links={view.card.links??[]} profileLinks={view.card.profile_links??[]} heading="p"/></details></>}
        <a className="btn btn-secondary btn-small" href="/#account" onClick={()=>close(false)}>前往名片設定</a><p className="field-hint">名片設定就在頁面上方。確認儲存完成後，用瀏覽器「上一頁」回到活動，再出示名片。</p>
      </div>}
    </dialog>
  </section>;
}
