import {useEffect,useRef,useState,type FormEvent} from 'react';
import {z} from 'zod';
import {ApiError,type PortalClient} from '../api';
import {formatIsoLocal} from '../format';
import {GuestEventParticipation,readEventParticipationToken} from './EventParticipation';
import {eventPrizeDetailsSchema} from '../../../../modules/community/event-prize-details';
import {EventPrizeDetails} from './EventPrizeDetails';
import './PublicEventPage.css';

const publicEventSchema=z.object({prize_details:eventPrizeDetailsSchema.optional(),event_id:z.string(),title:z.string(),description:z.string(),starts_at:z.string(),ends_at:z.string(),mode:z.enum(['online','in_person','hybrid']),location:z.string(),online_url:z.string().nullable(),event_kind:z.string(),topic:z.string().nullable(),visibility:z.enum(['referral','open']),registration_policy:z.enum(['guest_allowed','community_member']).default('guest_allowed'),capacity:z.number().nullable(),attending_count:z.number(),organizer_name:z.string(),banner_url:z.string().nullable(),video_url:z.string().nullable(),video_mime:z.enum(['video/mp4','video/webm']).nullable()});
type PublicEvent=z.infer<typeof publicEventSchema>;
const safeUrl=(value:string|null)=>{try{const url=new URL(value??'');return url.protocol==='https:'&&!url.username&&!url.password?url.href:null}catch{return null}};
const savedCode=(id:string)=>{
  const match=/^#events\/([0-9a-f-]{36})(?:\?(.*))?$/.exec(window.location.hash);
  const pathId=/^\/events\/([0-9a-f-]{36})\/?$/.exec(window.location.pathname)?.[1];
  const refs=new URLSearchParams(match?.[1]===id?match[2]??'':pathId===id?window.location.search:'').getAll('ref');
  const linkCode=refs.length===1&&/^[A-Za-z0-9_-]{16,32}$/.test(refs[0])?refs[0]:null;
  if(refs.length&&!linkCode)return null;
  if(linkCode)try{localStorage.setItem(`freedom-event-referral:${id}`,linkCode)}catch{/* Link stays usable. */}
  try{const cached=localStorage.getItem(`freedom-event-referral:${id}`);return linkCode??(cached&&/^[A-Za-z0-9_-]{16,32}$/.test(cached)?cached:null)}catch{return linkCode}
};

type PublicEventPageProps={client:PortalClient;id:string;onLogin:()=>void;onJoin?:()=>void;revalidatePublic?:boolean;participationEnabled?:boolean};
type RegistrationBody={name:string;email:string;referral_code:string|null};
type RegistrationAttempt={body:RegistrationBody;unknown:boolean};
type RegistrationOwner={client:PortalClient;eventId:string;generation:number;active:boolean;busy:boolean;confirmed:boolean;attempt:RegistrationAttempt|null;controller:AbortController|null};
const registrationUnknown='尚未確認這次報名結果，原資料仍保留。請先檢查原信箱；重試原報名可能再次寄出相同郵件。';

function usePublicEventRegistration(client:PortalClient,id:string){
  const [state,setState]=useState({busy:false,unknown:false,confirmed:false,error:''});
  const owner=useRef<RegistrationOwner|null>(null);
  useEffect(()=>{
    const current:RegistrationOwner={client,eventId:id,generation:client.sessionGeneration,active:true,busy:false,confirmed:false,attempt:null,controller:null};
    owner.current=current;setState({busy:false,unknown:false,confirmed:false,error:''});
    return()=>{current.active=false;current.controller?.abort();};
  },[client,id,client.sessionGeneration]);
  async function submit(body:RegistrationBody){
    const current=owner.current;
    if(!current?.active||current.client!==client||current.eventId!==id||current.generation!==client.sessionGeneration||current.busy||current.confirmed)return;
    const generation=client.sessionGeneration;
    const live=()=>current.active&&owner.current===current&&client.sessionGeneration===generation;
    // This endpoint deduplicates registration by event/email, not Idempotency-Key.
    // Preserve the exact contact/referral fields, but never promise one mail send.
    const attempt=current.attempt??{body:{...body},unknown:false};
    current.attempt=attempt;current.busy=true;current.controller=new AbortController();
    setState({busy:true,unknown:attempt.unknown,confirmed:false,error:''});
    try{
      const value=await client.post<unknown>(`/public/events/${id}/register`,attempt.body,{skipAuthHandler:true,suppressConsole:true,signal:current.controller.signal});
      if(!live())return;
      if(!value||typeof value!=='object'||Array.isArray(value)||(value as Record<string,unknown>).registered!==true||(value as Record<string,unknown>).provider_status!=='provider_accepted')throw new Error('invalid_registration_receipt');
      current.attempt=null;current.confirmed=true;
      setState({busy:false,unknown:false,confirmed:true,error:''});
    }catch(cause){
      if(!live())return;
      // A later refusal describes that retry, not the outcome of the first send.
      attempt.unknown ||= !(cause instanceof ApiError)||cause.network||cause.timedOut||cause.accessExpired||!cause.definitiveResponse||cause.status>=500||cause.status===0;
      if(!attempt.unknown)current.attempt=null;
      setState({busy:false,unknown:attempt.unknown,confirmed:false,error:attempt.unknown?registrationUnknown:cause instanceof ApiError?cause.message:'報名未完成，請稍後再試。'});
    }finally{if(live()){current.busy=false;current.controller=null;}}
  }
  return {...state,submit};
}

export function PublicEventPage(props:PublicEventPageProps){
  // Contact drafts, public reads and pending writes share the same owner lifetime.
  const owner=useRef({client:props.client,generation:props.client.sessionGeneration,key:0});
  if(owner.current.client!==props.client||owner.current.generation!==props.client.sessionGeneration){
    owner.current={client:props.client,generation:props.client.sessionGeneration,key:owner.current.key+1};
  }
  return <PublicEventContent key={`${props.id}:${owner.current.key}`} {...props}/>;
}
function PublicEventContent({client,id,onLogin,onJoin,revalidatePublic=false,participationEnabled=false}:PublicEventPageProps){
  const [event,setEvent]=useState<PublicEvent|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [name,setName]=useState(''),[email,setEmail]=useState('');
  const registration=usePublicEventRegistration(client,id),saving=registration.busy;
  const notice=registration.confirmed?'報名已確認；Email 服務已接受參與資訊郵件，不代表郵件已送達。請檢查收件匣。':'';
  const [code,setCode]=useState(()=>savedCode(id));
  const privateManagement=participationEnabled&&readEventParticipationToken()!==null;
  useEffect(()=>{
    setCode(savedCode(id));
    setEvent(null);setError('');setLoading(!privateManagement);
    // A private management link never reads the public event page.
    if(privateManagement)return;
    let active=true,generation=0,controller:AbortController|null=null;
    const refresh=()=>{
      const current=++generation;
      controller?.abort();controller=new AbortController();
      setEvent(null);setLoading(true);setError('');
      const read=revalidatePublic
        ? fetch(`/api/v1/public/events/${id}`,{cache:'no-store',credentials:'omit',signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('活動目前無法公開查看。');return publicEventSchema.parse(await response.json())})
        : client.get<PublicEvent>(`/public/events/${id}`,{skipAuthHandler:true,signal:controller.signal});
      void read.then(value=>{
        if(revalidatePublic){
          const hash=/^#events\/([0-9a-f-]{36})(?:\?(.*))?$/.exec(window.location.hash);
          const refs=new URLSearchParams(hash?.[1]===id?hash[2]??'':window.location.search).getAll('ref');
          const referral=refs.length===1?refs[0]:null;
          if(value.visibility!=='open'&&!(value.visibility==='referral'&&referral&&/^[A-Za-z0-9_-]{16,32}$/.test(referral)))throw new Error('活動目前無法公開查看。');
        }
        if(active&&current===generation)setEvent(value);
      })
        .catch(cause=>{if(active&&current===generation)setError(cause instanceof Error?cause.message:'活動暫時無法載入。')})
        .finally(()=>{if(active&&current===generation)setLoading(false)});
    };
    const visible=()=>{if(document.visibilityState==='visible')refresh()};
    refresh();
    if(revalidatePublic){window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',visible)}
    return()=>{active=false;generation++;controller?.abort();window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',visible)};
  },[client,id,revalidatePublic,privateManagement]);
  async function register(e:FormEvent){e.preventDefault();if((!event||event.registration_policy==='community_member')&&!registration.unknown||saving)return;setError('');await registration.submit({name,email,referral_code:code});}
  const started=Boolean(event&&Date.parse(event.starts_at)<=Date.now()),ended=Boolean(event&&Date.parse(event.ends_at)<=Date.now()),full=Boolean(event&&event.capacity!==null&&event.attending_count>=event.capacity);
  const locationLink=safeUrl(event?.location??null),onlineLink=safeUrl(event?.online_url??null);
  return <div className="public-event-page"><header><img src="/brand/freedom-workshop.webp" alt="自由工坊"/><button type="button" className="btn btn-ghost" onClick={onLogin}>會員登入</button></header><main className="public-event-content">
    {loading&&<p role="status">正在載入活動…</p>}
    {!privateManagement&&!loading&&!event&&<div className="card stack"><h1>活動目前無法公開查看</h1><p>{error||'請從會員分享的連結開啟，或登入工坊查看。'}</p><button type="button" className="btn btn-primary" onClick={onLogin}>前往會員入口</button></div>}
    {event&&<article className="card public-event-card"><p className="eyebrow">社群活動 · {event.visibility==='referral'?'推薦連結公開':'完全公開'}</p>{ended&&<span className="event-ended-badge">已結束</span>}<h1>{event.title}</h1><p className="muted">由 {event.organizer_name} 發起</p>{event.banner_url&&<img className="public-event-poster" src={event.banner_url} alt="活動海報"/>}{event.video_url&&<video className="public-event-poster" controls preload="metadata" aria-label={`${event.title} 的活動影片`}><source src={event.video_url} type={event.video_mime??undefined}/></video>}
      {event.topic&&<p><strong>主題：</strong>{event.topic}</p>}<p className="public-event-description">{event.description}</p><EventPrizeDetails value={event.prize_details}/>
      <dl className="public-event-meta"><div><dt>時間</dt><dd>{formatIsoLocal(event.starts_at)} ～ {formatIsoLocal(event.ends_at)}（依裝置時區）</dd></div><div><dt>地點</dt><dd>{locationLink?<a href={locationLink} target="_blank" rel="noopener noreferrer">開啟地點連結</a>:event.location}</dd></div>{onlineLink&&<div><dt>線上參與</dt><dd><a href={onlineLink} target="_blank" rel="noopener noreferrer">開啟線上連結</a></dd></div>}</dl>
      <p className="muted">{event.attending_count}{event.capacity===null?' 人已報名':` / ${event.capacity} 人已報名`}</p>
      {!started&&event.visibility==='referral'&&!code&&<p className="banner banner-info">這場活動須從會員分享的連結報名，請向分享者取得連結。</p>}
      {!started&&event.registration_policy==='community_member'&&<section className="stack" aria-label="會員報名"><h2>使用社群帳號參加</h2><p>這場活動只接受本社群帳號報名。登入後請再確認報名，不會自動加入活動。</p><div className="actions"><button type="button" className="btn btn-primary btn-small" style={{minHeight:44}} onClick={onLogin}>登入後報名</button>{onJoin&&<button type="button" className="btn btn-secondary btn-small" style={{minHeight:44}} onClick={onJoin}>建立帳號後報名</button>}</div></section>}
      {(registration.unknown||saving||registration.confirmed||!started&&!full&&event.registration_policy!=='community_member')&&<form className="public-event-register" onSubmit={e=>void register(e)}><h2>報名活動</h2><label className="field">你的名字<input required maxLength={80} disabled={saving||registration.unknown||registration.confirmed} value={name} onChange={e=>setName(e.target.value)}/></label><label className="field">接收參與資料的 Email<input required type="email" maxLength={200} disabled={saving||registration.unknown||registration.confirmed} value={email} onChange={e=>setEmail(e.target.value)}/></label><p className="field-hint">活動參與資訊會寄到這個信箱。分享碼已包含在連結中，無須手動輸入。</p><button className="btn btn-primary" disabled={saving||registration.confirmed||!registration.unknown&&event.visibility==='referral'&&!code}>{saving?'寄送中…':registration.unknown?'重試原報名與寄信':'報名並寄送參與資料'}</button></form>}
      {full&&!started&&<p className="banner banner-info">活動名額已滿。</p>}{started&&!ended&&<p className="banner banner-info">活動已開始，報名已結束。</p>}{notice&&<p role="status" className="banner banner-info">{notice}</p>}{(registration.error||error)&&<p role="alert" className="banner banner-error">{registration.error||error}</p>}
    </article>}
    {!event&&registration.unknown&&<section className="card stack" aria-label="待確認的報名"><p role="alert" className="banner banner-error">{registrationUnknown}</p><button type="button" className="btn btn-ghost btn-small" disabled={saving} onClick={()=>void registration.submit({name,email,referral_code:code})}>{saving?'寄送中…':'重試原報名與寄信'}</button></section>}
    {!event&&notice&&<p role="status" className="banner banner-info">{notice}</p>}
    {participationEnabled&&(privateManagement||event&&event.registration_policy!=='community_member')&&<div className="card stack">{privateManagement&&<h1>活動參與管理</h1>}<GuestEventParticipation client={client} id={id} referralCode={code}/></div>}
  </main></div>;
}
