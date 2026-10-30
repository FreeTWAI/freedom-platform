import {useEffect,useRef,useState} from 'react';
import {ApiError,type PortalClient} from '../api';
import type {SessionPayload} from '../types';
import {BrandPoster} from './Community';
import {MemberCardDownload} from './MemberCardDownload';
import {MemberECard,type CardDesign,type CardLink,type CardProfileLink} from './MemberECard';
import {MemberCard,loadLabels,type MemberCardData} from './Membership';
import {announceInboxChange} from './member-inbox';
import './MemberConnections.css';
type PublicCard={nickname:string;primary_guild:{name:string;guild_key:string}|null;capabilities:string[];avatar_url:string|null;design?:CardDesign;headline?:string|null;links?:CardLink[];profile_links?:CardProfileLink[]};
type Props={client:PortalClient;token:string;session?:SessionPayload;onLogin:()=>void;onReturn:()=>void;onEdit?:()=>void};
type FriendCommand={action:'request'|'accept';path:string;body:Record<string,never>;version:number|undefined;key:string;peer:string;uncertain:boolean};
const validVersion=(value:unknown)=>typeof value==='number'?Number.isSafeInteger(value)&&value>0:typeof value==='string'&&/^[1-9][0-9]{0,18}$/.test(value)&&BigInt(value)<=9223372036854775807n;
export function PublicMemberPage(props:Props){
  const transport=useRef({client:props.client,revision:0});
  if(transport.current.client!==props.client)transport.current={client:props.client,revision:transport.current.revision+1};
  return <PublicMemberContent key={`${transport.current.revision}:${props.client.sessionGeneration}:${props.session?.user.user_id??'guest'}:${props.token}`} {...props}/>;
}
function PublicMemberContent({client,token,session,onLogin,onReturn,onEdit}:Props){
  const [card,setCard]=useState<PublicCard|null>(null),[member,setMember]=useState<MemberCardData|null>(null),[labels,setLabels]=useState<Record<string,string>>({}),[loadError,setLoadError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true);
  const generation=useRef(0),mounted=useRef(false),owner=useRef(client.sessionGeneration),sending=useRef(false),pending=useRef<FriendCommand|null>(null);
  const [busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[error,setError]=useState(''),[stale,setStale]=useState(false);
  const live=()=>mounted.current&&client.sessionGeneration===owner.current;
  const readCurrent=(run:number)=>live()&&run===generation.current;
  async function load(){if(!live())return;const current=++generation.current;setLoading(true);setLoadError('');setCard(null);setMember(null);try{
    const data=await client.get<PublicCard>(`/public/member-cards/${token}`);if(!readCurrent(current))return;setCard(data);
    if(session){
      try{const full=await client.get<MemberCardData>(`/member-cards/${token}/member`);if(readCurrent(current))setMember(full);}
      catch(cause){
        if(!(cause instanceof ApiError)||cause.status!==404||cause.code!=='member_not_found')throw cause;
        if(!readCurrent(current))return;
        // Private member access is optional, but a denial must not preserve a now-withdrawn public snapshot.
        const publicOnly=await client.get<PublicCard>(`/public/member-cards/${token}`);
        if(readCurrent(current))setCard(publicOnly);
      }
    }
    if(readCurrent(current)&&!pending.current)setStale(false);
  }catch(cause){if(readCurrent(current))setLoadError(cause instanceof Error?cause.message:'名片暫時無法開啟。');}finally{if(readCurrent(current))setLoading(false);}}
  useEffect(()=>{
    mounted.current=true;
    const refresh=()=>{if(document.visibilityState==='visible')void load();};
    const visible=()=>{if(document.visibilityState==='visible')refresh();else{generation.current++;setCard(null);setMember(null);setLoading(true);}};
    const ended=()=>{mounted.current=false;generation.current++;setCard(null);setMember(null);setLabels({});setNotice('');};
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue='';}};
    refresh();if(session)void loadLabels(client).then(value=>{if(live())setLabels(value);}).catch(()=>{});
    window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',visible);
    window.addEventListener('freedom-game-console-session-end',ended);window.addEventListener('beforeunload',beforeUnload);
    return()=>{mounted.current=false;generation.current++;window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visible);window.removeEventListener('freedom-game-console-session-end',ended);window.removeEventListener('beforeunload',beforeUnload);};
  },[client,token,session?.user.user_id]);
  async function send(command:FriendCommand){
    if(!live()||sending.current)return;
    // Own intent synchronously, before React renders disabled buttons. Never
    // rebuild an unknown command from a newer friendship read/version.
    sending.current=true;pending.current=command;generation.current++;setBusy(true);setLoading(false);setMember(null);setError('');setNotice('');
    try{
      const result=await client.post<unknown>(command.path,command.body,{idempotencyKey:command.key,ifMatch:command.version,suppressConsole:true});
      if(!live())return;
      const row=result as {state?:unknown;aggregate_version?:unknown;low_ref?:unknown;high_ref?:unknown;requester_ref?:unknown};
      const pair=[session!.user.user_id,command.peer].sort();
      if(!row||typeof row!=='object'||(command.action==='accept'?row.state!=='accepted':row.state!=='pending'&&row.state!=='accepted')||!validVersion(row.aggregate_version)||row.low_ref!==pair[0]||row.high_ref!==pair[1]||!pair.includes(row.requester_ref as string))throw new Error('好友操作回覆不完整。');
      pending.current=null;setUnknown(false);setStale(true);setNotice('原好友操作已確認；好友關係以下方重新讀取的資料為準。');announceInboxChange();
      // A historical receipt is not the current friendship or contact ACL.
      await load();
    }catch(cause){
      if(!live())return;
      command.uncertain=command.uncertain||!(cause instanceof ApiError)||!cause.definitiveResponse||cause.network||cause.status>=500;
      setUnknown(command.uncertain);
      if(!command.uncertain){pending.current=null;setStale(true);}
      setError(command.uncertain?'好友操作結果尚未確認。請重試原操作；重新讀取不代表原操作已取消。':cause instanceof Error?cause.message:'好友操作未完成，請重新讀取。');
    }finally{if(live()){sending.current=false;setBusy(false);}}
  }
  function act(action:'request'|'accept'){
    if(!session||!member||member.is_self||!live()||pending.current||sending.current||loading||stale||loadError)return;
    const relationship=member.friendship;
    if(action==='accept'?(relationship.state!=='pending'||relationship.requester_ref!==member.user_id||!validVersion(relationship.aggregate_version)):!['none','removed'].includes(relationship.state))return;
    if(relationship.state==='removed'&&!validVersion(relationship.aggregate_version))return;
    void send({action,path:`/friends/${member.user_id}/${action}`,body:{},version:relationship.aggregate_version,key:crypto.randomUUID(),peer:member.user_id,uncertain:false});
  }
  function leave(callback?:()=>void){if(!pending.current&&!sending.current)callback?.();}
  const blocked=busy||unknown||stale;
  const design=card?.design??'calm';
  return <main className="public-member-page" data-design={!loading&&!loadError&&card?design:undefined}><BrandPoster compact/>
    {loading&&<p role="status">正在開啟工坊名片…</p>}
    {loadError&&<div className="card stack" role="alert"><h1>暫時無法開啟這張名片</h1><p>{loadError}</p><button type="button" className="btn btn-ghost" onClick={()=>void load()}>重新載入名片</button><button type="button" className="btn btn-primary" disabled={busy||unknown} onClick={()=>leave(onReturn)}>前往自由工坊</button></div>}
    {!loading&&!loadError&&card&&<>
      <MemberCardDownload shareUrl={new URL(`/member-cards/${token}`,window.location.origin).href}><MemberECard design={design} nickname={card.nickname} headline={card.headline??null} guildName={card.primary_guild?.name??null} capabilities={card.capabilities} avatarUrl={card.avatar_url} links={card.links??[]} profileLinks={card.profile_links??[]} heading="h1" shareUrl={new URL(`/member-cards/${token}`,window.location.origin).href}/></MemberCardDownload>
      {member?.is_self&&<p className="ecard-owner-note">這是你的名片，訪客看到的就是這個樣子。<button type="button" className="btn btn-ghost" disabled={busy||unknown} onClick={()=>leave(onEdit)}>編輯名片</button></p>}
      {member&&!member.is_self&&<MemberCard member={member} labels={labels} client={client}/>}
      {session&&!member&&<p className="field-hint public-card-fallback-hint">這是作者目前公開的名片；會員資訊與好友邀請暫不可用。</p>}
      {session?<div className="actions">{member&&!member.is_self&&(member.friendship.state==='accepted'?<span className="badge">你們已是好友</span>:member.friendship.state==='pending'?(member.friendship.requester_ref===member.user_id&&validVersion(member.friendship.aggregate_version)?<div><p>對方已邀請你成為好友。接受後，雙方可看見彼此設定為「好友」可見的內容。</p><button type="button" className="btn btn-secondary btn-small" disabled={blocked} onClick={()=>act('accept')}>接受好友邀請</button></div>:<span>好友邀請待回覆</span>):['none','removed'].includes(member.friendship.state)?<button type="button" className="btn btn-primary" disabled={blocked} onClick={()=>act('request')}>邀請成為好友</button>:null)}<button type="button" className="btn btn-ghost" disabled={busy||unknown} onClick={()=>leave(onReturn)}>返回會員首頁</button></div>:<section className="public-card-invite"><h2>和社群夥伴一起把想法做出來</h2><p>加入感興趣的公會、閱讀免費技能書，找到擅長不同事情的人一起學習、創作與合作。</p><button type="button" className="btn btn-primary" onClick={onLogin}>加入自由工坊／登入</button><p className="field-hint">Email、密碼即可建立帳號，名稱選填；再選一個公會就能開始。完整定位可稍後補做。</p></section>}
    </>}{error&&<div role="alert" className="banner banner-error"><p>{error}</p>{unknown&&<button type="button" className="btn btn-secondary btn-small" disabled={busy||!live()} onClick={()=>{if(pending.current)void send(pending.current);}}>重試原好友操作</button>}<button type="button" className="btn btn-ghost btn-small" disabled={busy||loading||!live()} onClick={()=>void load()}>重新讀取好友狀態</button></div>}{notice&&<p role="status" className="banner status-note">{notice}</p>}
  </main>;
}
