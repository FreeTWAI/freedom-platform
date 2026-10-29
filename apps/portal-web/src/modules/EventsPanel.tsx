import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, type PortalClient } from '../api';
import type { SessionPayload } from '../types';
import { formatIsoLocal, hoursFromNowLocalInput, localInputToIso } from '../format';
import { useModuleMutation } from './shared';
import {announceInboxChange} from './member-inbox';
import {prepareEventMedia,sendEventMedia,readEventMedia,currentMediaEvent,type EventMediaCommand} from './event-banner-client';
import {prepareSocialImage} from './social-image';
import {EventCalendar} from './EventCalendar';
import {EventParticipation,EventParticipationOrganizer} from './EventParticipation';
import {EventAttendees} from './EventAttendees';
import {EventHelpers} from './EventHelpers';
import './MemberExperience.css';
import './EventsPanel.css';

export type CommunityEvent = {
  event_id:string; help_need?:string|null; organizer_ref:string; organizer_name:string; title:string; description:string;
  starts_at:string; ends_at:string; mode:'online'|'in_person'|'hybrid'; location:string;
  event_kind:'reading_group'|'meetup'|'guild_skill_exchange'|'other';topic:string|null;online_url:string|null;visibility:'workshop'|'guild'|'referral'|'open';banner_url:string|null;banner_orientation:'landscape'|'portrait'|null;video_url:string|null;video_mime:'video/mp4'|'video/webm'|null;
  capacity:number|null; state:'pending'|'published'|'rejected'|'cancelled'; aggregate_version:number;
  attending_count:number; my_rsvp:'going'|'cancelled'|null;guild_key:string|null;review_guild_key:string|null;can_review:boolean;review_reason:string|null;
};
type EventActionAttempt={eventId:string;path:string;kind:'cancel'|'rsvp';body:{going?:boolean;referral_code?:string|null};version?:number};
type MediaSave={result:CommunityEvent;banner:File|null;video:File|null;editing:boolean;command:EventMediaCommand|null};
type Guild={guild_key:string;name:string;membership?:{state:string;member_tier?:'intern'|'full'}|null};
const INTERN_WRITE='實習成員可以閱讀公會內容、在公會聊天室聊天；請會長把你設為正式成員後再發布或編輯。';
const internExchange=(value:{event_kind:string;guild_key:string|null},guilds:Guild[])=>value.event_kind==='guild_skill_exchange'&&guilds.some(guild=>guild.guild_key===value.guild_key&&guild.membership?.state==='active'&&guild.membership.member_tier==='intern');
type Bulletin={bulletin_id:string;message:string;created_at:string};
type Referral={user_id:string;member_name:string;registrations:number;clicks:number};
type ReferralPage={items:Referral[];total:number;next_offset:number|null};
type ReferralView=ReferralPage&{loading:boolean;error:string;request_offset:number};
export type EventDraft = {help_need?:string;title:string;description:string;starts_at:string;ends_at:string;mode:CommunityEvent['mode'];event_kind:CommunityEvent['event_kind'];topic:string;location:string;online_url:string;capacity:string;guild_key:string;visibility:CommunityEvent['visibility']};
export type EventPayload=Omit<EventDraft,'help_need'|'topic'|'online_url'|'capacity'|'guild_key'>&{help_need?:string|null;topic:string|null;online_url:string|null;capacity:number|null;guild_key:string|null};
export const blankEvent=():EventDraft=>({title:'',description:'',starts_at:hoursFromNowLocalInput(24),ends_at:hoursFromNowLocalInput(25),mode:'online',event_kind:'other',topic:'',location:'',online_url:'',capacity:'',guild_key:'',visibility:'workshop'});
function localTime(iso:string) {
  const date=new Date(iso), local=new Date(date.getTime()-date.getTimezoneOffset()*60_000);
  return local.toISOString().slice(0,16);
}
const fromEvent=(item:CommunityEvent):EventDraft=>({help_need:item.help_need??'',title:item.title,description:item.description,starts_at:localTime(item.starts_at),ends_at:localTime(item.ends_at),mode:item.mode,event_kind:item.event_kind??'other',topic:item.topic??'',location:item.location,online_url:item.online_url??'',capacity:item.capacity===null?'':String(item.capacity),guild_key:item.guild_key??'',visibility:item.visibility??'workshop'});
export const eventPayload=(value:EventDraft):EventPayload=>({...value,...(value.help_need!==undefined?{help_need:value.help_need.trim()||null}:{}),starts_at:localInputToIso(value.starts_at),ends_at:localInputToIso(value.ends_at),topic:value.topic.trim()||null,online_url:value.online_url.trim()||null,capacity:value.capacity===''?null:Number(value.capacity),guild_key:value.guild_key||null});
const modeLabel:Record<CommunityEvent['mode'],string>={online:'線上',in_person:'實體',hybrid:'線上與實體'};
const kindLabel:Record<CommunityEvent['event_kind'],string>={reading_group:'線上讀書會',meetup:'聚會',guild_skill_exchange:'公會技能交流',other:'其他活動'};
const reviewerFor=(value:EventDraft,guilds:Guild[])=>value.event_kind==='guild_skill_exchange'
  ?guilds.find(guild=>guild.guild_key===value.guild_key)?.name??'所選主辦公會'
  :value.mode==='online'?'會員與社群營運公會':'活動與空間公會';
const capacityChoices=['10','20','30','50','100','200','500'];
const participationUrl=(location:string)=>{try{const url=new URL(location);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}};
const referralCode=(id:string)=>{
  const match=/^#events\/([0-9a-f-]{36})(?:\?(.*))?$/.exec(window.location.hash);
  const pathId=/^\/events\/([0-9a-f-]{36})\/?$/.exec(window.location.pathname)?.[1];
  const fromLink=match?.[1]===id?new URLSearchParams(match[2]??'').get('ref'):pathId===id?new URLSearchParams(window.location.search).get('ref'):null;
  if(fromLink&&/^[A-Za-z0-9_-]{16,32}$/.test(fromLink))try{localStorage.setItem(`freedom-event-referral:${id}`,fromLink)}catch{/* A copied link still works. */}
  try{return fromLink??localStorage.getItem(`freedom-event-referral:${id}`)}catch{return fromLink}
};

export function EventFields({value,onChange,guilds=[],guildLocked=false,disabled=false,progressive=false}:{value:EventDraft;onChange:(next:EventDraft)=>void;guilds?:Guild[];guildLocked?:boolean;disabled?:boolean;progressive?:boolean}) {
  const set=<K extends keyof EventDraft>(key:K,next:EventDraft[K])=>onChange({...value,[key]:next});
  const kind=<>    <label className="field">活動類型<select value={value.event_kind} disabled={disabled||guildLocked} onChange={e=>{const event_kind=e.target.value as EventDraft['event_kind'];onChange({...value,event_kind,mode:event_kind==='reading_group'?'online':value.mode,visibility:event_kind==='guild_skill_exchange'?value.visibility:value.visibility==='guild'?'workshop':value.visibility});}}><option value="reading_group">線上讀書會</option><option value="meetup">聚會</option><option value="guild_skill_exchange">公會技能交流</option><option value="other">其他活動</option></select></label>
    {value.event_kind==='reading_group'&&<label className="field">讀書會主題<input disabled={disabled} required maxLength={160} value={value.topic} onChange={e=>set('topic',e.target.value)} placeholder="例如：本週閱讀與討論的書或章節"/></label>}</>;
  const capacity=<>    <label className="field">人數上限<select disabled={disabled} value={capacityChoices.includes(value.capacity)||!value.capacity?value.capacity:'custom'} onChange={e=>set('capacity',e.target.value==='custom'?'1':e.target.value)}><option value="">不限人數</option>{capacityChoices.map(count=><option key={count} value={count}>{count} 人</option>)}<option value="custom">自訂人數</option></select>{value.capacity&&!capacityChoices.includes(value.capacity)&&<input disabled={disabled} aria-label="自訂人數上限" type="number" min={1} max={500} value={value.capacity} onChange={e=>set('capacity',e.target.value)}/>}</label></>;
  const audience=<>    <label className="field">主辦公會<select value={value.guild_key} required={value.event_kind==='guild_skill_exchange'} disabled={disabled||guildLocked} onChange={e=>set('guild_key',e.target.value)}><option value="">不指定主辦公會</option>{guilds.map(guild=><option key={guild.guild_key} value={guild.guild_key}>{guild.name}</option>)}</select>{guildLocked&&<small>提交後不能更換主辦公會、形式或類型。</small>}</label>
    <label className="field">參與範圍<select value={value.visibility} disabled={disabled||guildLocked} onChange={e=>set('visibility',e.target.value as EventDraft['visibility'])}>{value.event_kind==='guild_skill_exchange'&&<option value="guild">僅主辦公會成員</option>}<option value="workshop">僅自由工坊會員</option><option value="referral">公開頁面，須會員分享連結報名；線上資料寄 Email</option><option value="open">完全公開，所有人可直接查看與報名</option></select></label></>;
  const body=<>    <label className="field">活動說明<textarea disabled={disabled} required maxLength={3000} rows={4} value={value.description} onChange={e=>set('description',e.target.value)}/></label>
    <div className="experience-row"><label className="field">開始時間<input disabled={disabled} required type="datetime-local" value={value.starts_at} onChange={e=>set('starts_at',e.target.value)}/></label><label className="field">結束時間<input disabled={disabled} required type="datetime-local" value={value.ends_at} onChange={e=>set('ends_at',e.target.value)}/></label></div>
    <p className="field-hint">時間依目前裝置時區：{Intl.DateTimeFormat().resolvedOptions().timeZone}。請以這個時區核對日期及開始、結束時間。</p>
    <div className="experience-row"><label className="field">形式<select value={value.mode} disabled={disabled||guildLocked||value.event_kind==='reading_group'} onChange={e=>set('mode',e.target.value as EventDraft['mode'])}><option value="online">線上</option><option value="in_person">實體</option><option value="hybrid">線上與實體</option></select></label><label className="field">{value.mode==='online'?'線上場地':'實體地點'}<input disabled={disabled} required maxLength={300} list={value.mode==='online'?'online-event-venues':undefined} value={value.location} onChange={e=>set('location',e.target.value)} placeholder={value.mode==='online'?'例如：Discord 讀書會場地':'例如：台北市的聚會地點'}/></label></div>
    {value.mode==='online'&&<datalist id="online-event-venues"><option value="Discord 讀書會場地"/><option value="Discord 語音頻道"/><option value="Google Meet"/><option value="Zoom"/></datalist>}
    <label className="field">{value.mode==='in_person'?'線上直播連結（選填）':'線上參與連結'}<input disabled={disabled} type="url" pattern="https://.*" required={value.mode==='hybrid'} maxLength={500} value={value.online_url} onChange={e=>set('online_url',e.target.value)} placeholder="https://"/>{value.mode==='hybrid'&&<small>同時提供實體地點與線上參與連結。</small>}</label></>;
  const summary=<>    {value.visibility==='referral'&&<p className="field-hint">海報、影片與活動說明都會公開。請勿在這些內容中放入線上參與連結或 QR 碼。</p>}
    <p className="field-hint">審核：{reviewerFor(value,guilds)}的公會長，或平台管理員。</p></>;
  const revealInvalid=(event:FormEvent<HTMLDivElement>)=>{
    const target=event.target as HTMLElement;
    // Open synchronously before native validation attempts to focus the field.
    let parent=target.parentElement;
    while(parent&&parent!==event.currentTarget){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
  };
  return <div className="experience-fields" onInvalidCapture={revealInvalid}>
    <label className="field">活動名稱<input disabled={disabled} required maxLength={120} value={value.title} onChange={e=>set('title',e.target.value)}/></label>
    {!progressive&&kind}{body}
    {progressive?<details className="event-form-options"><summary>更多設定：活動類型、人數、公會與參與範圍</summary><div className="experience-fields">{kind}{capacity}{audience}</div></details>:<>{capacity}{audience}</>}
    {progressive&&<label className="field">需要哪些幫手（選填）<textarea data-event-help-need disabled={disabled} maxLength={500} rows={3} value={value.help_need??''} onChange={e=>set('help_need',e.target.value)} placeholder="例如：需要 2 位夥伴在活動前 30 分鐘協助報到"/><small>需求會隨活動一起審核、依活動參與範圍顯示。幫忙申請與活動報名分開；幫手名單不公開。請勿填寫私人聯絡方式。</small></label>}
    {progressive&&<p className="event-review-summary">核准後的參與範圍：{{workshop:'僅自由工坊會員',guild:'僅主辦公會成員',referral:'公開頁面，須會員分享連結報名',open:'完全公開，所有人可查看與報名'}[value.visibility]}。核准後才開放報名。</p>}
    {summary}
  </div>;
}

function EventDraftPreview({value,banner,existingBanner}:{value:EventDraft;banner:File|null;existingBanner?:string|null}) {
  const [localBanner,setLocalBanner]=useState<string|null>(null);
  useEffect(()=>{
    if(!banner){setLocalBanner(null);return;}
    const url=URL.createObjectURL(banner);setLocalBanner(url);
    return()=>URL.revokeObjectURL(url);
  },[banner]);
  const time=(input:string)=>{const date=new Date(input);return Number.isNaN(date.getTime())?'尚未填寫':formatIsoLocal(date.toISOString());};
  const visibility={workshop:'僅自由工坊會員可查看',guild:'僅指定公會成員可查看',referral:'活動頁公開，報名需要會員分享連結',open:'活動頁公開，所有人可查看及報名'}[value.visibility];
  const image=localBanner??existingBanner;
  return <details className="help-box"><summary>送出前預覽活動</summary><section className="stack" aria-label="活動送審預覽">
    <p className="field-hint">這份內容尚未公開；送出後仍需審核。</p>
    {image&&<img className="experience-banner-image" src={image} alt="活動海報預覽"/>}
    <h4>{value.title.trim()||'尚未填寫活動名稱'}</h4>
    {value.help_need?.trim()&&<p className="multiline-text">需要幫手：{value.help_need}</p>}
    <p className="multiline-text">{value.description.trim()||'尚未填寫活動說明'}</p>
    <dl className="experience-meta"><div><dt>核准後的參與範圍</dt><dd>{visibility}</dd></div><div><dt>時間</dt><dd>{time(value.starts_at)} ～ {time(value.ends_at)}（{Intl.DateTimeFormat().resolvedOptions().timeZone}）</dd></div><div><dt>形式與場地</dt><dd>{modeLabel[value.mode]} · {value.location.trim()||'尚未填寫場地'}</dd></div><div><dt>人數上限</dt><dd>{value.capacity?`${value.capacity} 人`:'未設上限'}</dd></div></dl>
    {value.online_url&&<p className="multiline-text">{value.visibility==='referral'?'報名後的私人線上資訊（不放在公開活動頁）':'線上參與連結'}：{value.online_url}</p>}
  </section></details>;
}

export function EventsPanel({client,session,locationHash,registerLeave,onList,participationEnabled=false,renderMemberCards,renderMissions}:{client:PortalClient;session:SessionPayload;locationHash:string;registerLeave:(guard:(()=>boolean)|null)=>void;onList:()=>void;participationEnabled?:boolean;renderMemberCards?:(eventId:string)=>ReactNode;renderMissions?:(eventId:string,onBlockedChange:(blocked:boolean)=>void)=>ReactNode}) {
  const [items,setItems]=useState<CommunityEvent[]>([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
  // Initial calendar insertion can scroll the submit target between pointer events.
  // Later refreshes must still allow a new draft after a confirmed save.
  const [initialLoadPending,setInitialLoadPending]=useState(true);
  const loadRequest=useRef(0);
  const createTrigger=useRef<HTMLButtonElement|null>(null),createForm=useRef<HTMLFormElement|null>(null),upcomingHeading=useRef<HTMLHeadingElement|null>(null),focusHelp=useRef(false);
  const [creating,setCreating]=useState(false),[draft,setDraft]=useState<EventDraft>(blankEvent);
  const draftBaseline=useRef(draft);
  useEffect(()=>{if(creating){const target=createForm.current?.querySelector<HTMLElement>(focusHelp.current?'[data-event-help-need]':'input');target?.focus();focusHelp.current=false;}},[creating]);
  const [editing,setEditing]=useState<string|null>(null),[editDraft,setEditDraft]=useState<EventDraft>(blankEvent);
  const [bannerFile,setBannerFile]=useState<File|null>(null),[editBannerFile,setEditBannerFile]=useState<File|null>(null),[videoFile,setVideoFile]=useState<File|null>(null),[editVideoFile,setEditVideoFile]=useState<File|null>(null),[bannerError,setBannerError]=useState(''),[saving,setSaving]=useState(false);
  const [preparingBanner,setPreparingBanner]=useState(false),[mediaUnknown,setMediaUnknown]=useState(false);
  const mediaSave=useRef<MediaSave|null>(null);
  const bannerSelection=useRef(0);
  useEffect(()=>()=>{bannerSelection.current++;},[client,session.user.user_id]);
  function cancelBannerPreparation(){bannerSelection.current++;setPreparingBanner(false);setBannerError('');}
  const [guilds,setGuilds]=useState<Guild[]>([]),[bulletins,setBulletins]=useState<Bulletin[]>([]);
  const reviewTrigger=useRef<HTMLButtonElement|null>(null);
  const [reviewing,setReviewing]=useState<string|null>(null),[reviewReason,setReviewReason]=useState('');
  const [notice,setNotice]=useState('');
  const [shareFor,setShareFor]=useState<string|null>(null),[shareUrl,setShareUrl]=useState('');
  const [attendeesFor,setAttendeesFor]=useState<{event_id:string;title:string}|null>(null),attendeesTrigger=useRef<HTMLButtonElement|null>(null);
  const [reports,setReports]=useState<Record<string,ReferralView>>({}),reportRequests=useRef<Record<string,number>>({});
  useEffect(()=>{reportRequests.current={};setReports({});},[client,session.user.user_id]);
  // Only the shell's accepted location may switch the editor. A rejected hash
  // or history change must not hide an unsaved draft before the shell restores it.
  const selectedId=/^#events\/([0-9a-f-]{36})(?:\?.*)?$/.exec(locationHash)?.[1]??(!locationHash?/^\/events\/([0-9a-f-]{36})\/?$/.exec(window.location.pathname)?.[1]??null:null);
  const [selectedItem,setSelectedItem]=useState<CommunityEvent|null>(null);
  const {mutate,busy,error,lastFailureUnknown}=useModuleMutation(client);
  const saveAttempt=useRef<{path:string;body:EventPayload;version?:number;editing:boolean}|null>(null);
  const reviewAttempt=useRef<{eventId:string;version:number;decision:'approve'|'reject';reason:string}|null>(null);
  const actionAttempt=useRef<EventActionAttempt|null>(null);
  const recoveringAction=lastFailureUnknown&&actionAttempt.current!==null;
  const recoveringSave=lastFailureUnknown&&saveAttempt.current!==null;
  const recoveringReview=lastFailureUnknown&&reviewAttempt.current!==null;
  // A lost response recovers the exact original command, including its version.
  // Known rejections allow the member to correct the draft before submitting.
  useEffect(()=>{if(!saving&&!busy&&!lastFailureUnknown){saveAttempt.current=null;reviewAttempt.current=null;actionAttempt.current=null;}},[saving,busy,lastFailureUnknown]);
  const original=items.find(item=>item.event_id===editing)??(selectedItem?.event_id===editing?selectedItem:null);
  const dirty=JSON.stringify(draft)!==JSON.stringify(draftBaseline.current)||Boolean(bannerFile||videoFile||editBannerFile||editVideoFile||preparingBanner)
    ||Boolean(editing&&(!original||JSON.stringify(editDraft)!==JSON.stringify(fromEvent(original))))
    ||Boolean(reviewing&&reviewReason.trim());
  function discardDrafts(){
    cancelBannerPreparation();const fresh=blankEvent();draftBaseline.current=fresh;setDraft(fresh);
    setCreating(false);setEditing(null);setBannerFile(null);setVideoFile(null);setEditBannerFile(null);setEditVideoFile(null);
    setReviewing(null);setReviewReason('');
  }
  const helperBlocked=useRef(false),missionBlocked=useRef(false);
  const onMissionBlocked=useCallback((blocked:boolean)=>{missionBlocked.current=blocked;},[]);
  const onHelperBlocked=useCallback((blocked:boolean)=>{helperBlocked.current=blocked;},[]);
  const leaveGuard=useRef<()=>boolean>(()=>true);
  leaveGuard.current=()=>{
    if(missionBlocked.current){setNotice('小任務操作尚未確認，請先重試原操作後再離開。');return false;}
    if(helperBlocked.current){setNotice('幫忙操作尚未確認，請先重試原操作後再離開。');return false;}
    if(saving||busy){setNotice('正在處理活動，請等候完成後再離開。');return false;}
    if(mediaUnknown){setNotice('媒體保存結果尚未確認，請先確認原操作後再離開。');return false;}
    if(lastFailureUnknown){setNotice('尚未確認原操作的結果，請先重試原操作後再離開。');return false;}
    return !dirty||window.confirm('活動有尚未儲存的內容。要捨棄變更並離開嗎？');
  };
  const acceptedLocation=useRef(locationHash);
  useEffect(()=>{if(acceptedLocation.current!==locationHash){acceptedLocation.current=locationHash;discardDrafts();}},[locationHash]);
  const unloading=useRef(false);unloading.current=dirty||saving||busy||preparingBanner||lastFailureUnknown||mediaUnknown;
  useEffect(()=>{
    registerLeave(()=>leaveGuard.current());
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(unloading.current||helperBlocked.current||missionBlocked.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',beforeUnload);
    return()=>{registerLeave(null);window.removeEventListener('beforeunload',beforeUnload);};
  },[registerLeave]);
  const load=useCallback(async()=>{
    const token=++loadRequest.current,generation=client.sessionGeneration;
    const current=()=>loadRequest.current===token&&client.sessionGeneration===generation;
    setLoading(true);setLoadError('');
    try{const [events,directory,announcements]=await Promise.all([
      client.get<{items:CommunityEvent[]}>('/events'),client.get<{items:Guild[]}>('/guilds/directory'),client.get<{items:Bulletin[]}>('/events/bulletins')]);
      if(!current())return;
      setItems(events.items);setGuilds(directory.items);setBulletins(announcements.items);
    }catch(cause){if(current())setLoadError(cause instanceof Error?cause.message:'活動暫時無法載入。');}
    finally{if(current()){setLoading(false);setInitialLoadPending(false);}}
  },[client]);
  useEffect(()=>{void load();return()=>{loadRequest.current++;};},[load]);
  useEffect(()=>{if(!selectedId||items.some(item=>item.event_id===selectedId)){setSelectedItem(null);return;}let active=true;void client.get<CommunityEvent>(`/events/${selectedId}`).then(item=>{if(active)setSelectedItem(item)}).catch(()=>{if(active)setSelectedItem(null)});return()=>{active=false}},[client,items,selectedId]);
  useEffect(()=>{if(selectedId)referralCode(selectedId)},[selectedId]);
  const resumedEvent=useRef<string|null>(null);
  useEffect(()=>{
    const params=new URLSearchParams(locationHash.split('?')[1]??'');
    if(params.get('edit')!=='1'||!selectedId||resumedEvent.current===selectedId)return;
    const item=items.find(value=>value.event_id===selectedId);
    if(!item||item.organizer_ref!==session.user.user_id||item.state!=='pending'||Date.parse(item.starts_at)<=Date.now()||internExchange(item,guilds))return;
    resumedEvent.current=selectedId;cancelBannerPreparation();setEditBannerFile(null);setEditVideoFile(null);setEditing(item.event_id);setEditDraft(fromEvent(item));setCreating(false);
  },[locationHash,selectedId,items,guilds,session.user.user_id]);
  async function chooseBanner(file:File|null,editingFile=false){
    const token=++bannerSelection.current,generation=client.sessionGeneration;
    const current=()=>token===bannerSelection.current&&generation===client.sessionGeneration;
    const setFile=editingFile?setEditBannerFile:setBannerFile;
    setBannerError('');setPreparingBanner(Boolean(file));
    if(!file){setFile(null);return;}
    try{const prepared=await prepareSocialImage(file);if(current())setFile(prepared);}
    catch(cause){if(current())setBannerError(cause instanceof Error?cause.message:'圖片無法處理，活動草稿仍保留。');}
    finally{if(current())setPreparingBanner(false);}
  }
  function chooseVideo(file:File|null,editingFile=false){
    setBannerError('');
    if(file&&(!['video/mp4','video/webm'].includes(file.type)||file.size>20*1024*1024||file.size===0)){
      setBannerError('影片請選擇 20 MiB 以下的 MP4 或 WebM。');return;
    }
    if(editingFile)setEditVideoFile(file);else setVideoFile(file);
  }
  function publishEvent(result:CommunityEvent){
    // A read started before this confirmed write must not replace its version.
    loadRequest.current++;setLoading(false);setLoadError('');
    setItems(current=>current.some(item=>item.event_id===result.event_id)
      ?current.map(item=>item.event_id===result.event_id?result:item):[result,...current]);
  }
  async function finishMedia(pending:MediaSave):Promise<boolean>{
    try{
      for(const kind of ['banner','video'] as const){
        const file=pending[kind];if(!file)continue;
        pending.command??=await prepareEventMedia(client,pending.result,file,kind);
        const receipt=await sendEventMedia(client,pending.command);
        pending.result=currentMediaEvent(pending.result,receipt);
        pending[kind]=null;pending.command=null;
      }
    }catch(cause){
      const unknown=Boolean(pending.command&&cause instanceof ApiError&&cause.network);
      mediaSave.current=unknown?pending:null;setMediaUnknown(unknown);
      publishEvent(pending.result);
      setBannerError(unknown?'媒體保存結果尚未確認，請先確認原操作。':cause instanceof Error?cause.message:'媒體未能保存，請重試。');
      setCreating(false);setEditing(pending.result.event_id);setEditDraft(fromEvent(pending.result));
      setBannerFile(null);setVideoFile(null);setEditBannerFile(pending.banner);setEditVideoFile(pending.video);
      // Unknown outcomes reconcile the exact command before any further write.
      if(!unknown)void load();
      return unknown;
    }
    mediaSave.current=null;setMediaUnknown(false);publishEvent(pending.result);
    discardDrafts();setNotice(pending.editing?'活動已更新，仍待審核。':'活動已送出審核，核准後開放報名。');
    announceInboxChange();window.dispatchEvent(new Event('freedom-world-facts-updated'));void load();
    return false;
  }
  async function reconcileMedia(){
    const pending=mediaSave.current;if(!pending?.command)return;
    setSaving(true);setBannerError('');
    try{
      // If this read fails, keep the command and lock. The member can retry
      // reconciliation without issuing metadata or a different upload command.
      pending.result=await readEventMedia(client,pending.command);
      publishEvent(pending.result);
      await finishMedia(pending);
    }catch(cause){setBannerError('尚未確認媒體保存結果，請重試確認保存。');}
    finally{setSaving(false);}
  }
  async function save(event:FormEvent) {
    event.preventDefault();if(actionAttempt.current||reviewAttempt.current||saving||busy||mediaUnknown||preparingBanner||bannerError)return;
    if(lastFailureUnknown&&!saveAttempt.current){setNotice('尚未確認原操作的結果，請先重試原操作。');return;}
    setSaving(true);setNotice('');
    const current=original;
    const attempt=saveAttempt.current??(current
      ?{path:`/events/${current.event_id}/update`,body:eventPayload(editDraft),version:current.aggregate_version,editing:true}
      :{path:'/events',body:eventPayload(draft),editing:false});
    saveAttempt.current=attempt;
    try{
      const saved=await mutate<CommunityEvent>(attempt.path,attempt.body,attempt.version);
      if(!saved)return;
      saveAttempt.current=null;
      const pending:MediaSave={result:saved,banner:attempt.editing?editBannerFile:bannerFile,video:attempt.editing?editVideoFile:videoFile,editing:attempt.editing,command:null};
      if(await finishMedia(pending))await reconcileMedia();
    }finally{setSaving(false);}
  }
  async function removeBanner(item:CommunityEvent){
    if(actionAttempt.current||reviewAttempt.current||saveAttempt.current||saving||busy||recoveringSave||recoveringReview||recoveringAction||mediaUnknown){setNotice('請先完成或重試原活動儲存操作。');return;}
    setBannerError('');setSaving(true);
    try{await client.post(`/events/${item.event_id}/banner/remove`,{},{ifMatch:item.aggregate_version});await load();setNotice('Banner 已移除。');}
    catch(cause){setBannerError(cause instanceof Error?cause.message:'Banner 未能移除。');}
    finally{setSaving(false);}
  }
  async function removeVideo(item:CommunityEvent){
    if(actionAttempt.current||reviewAttempt.current||saveAttempt.current||saving||busy||recoveringSave||recoveringReview||recoveringAction||mediaUnknown){setNotice('請先完成或重試原活動儲存操作。');return;}
    setBannerError('');setSaving(true);
    try{await client.post(`/events/${item.event_id}/video/remove`,{},{ifMatch:item.aggregate_version});await load();setNotice('影片已移除。');}
    catch(cause){setBannerError(cause instanceof Error?cause.message:'影片未能移除。');}
    finally{setSaving(false);}
  }
  async function sendEventAction(attempt:EventActionAttempt){
    if(saving||busy||recoveringSave||recoveringReview||mediaUnknown)return;
    const result=await mutate<CommunityEvent>(attempt.path,attempt.body,attempt.version,value=>{
      const receipt=value as Partial<CommunityEvent>|null;
      if(!receipt||receipt.event_id!==attempt.eventId||!Number.isSafeInteger(receipt.aggregate_version)||Number(receipt.aggregate_version)<1
        ||(attempt.kind==='cancel'?(receipt.state!=='cancelled'||Number(receipt.aggregate_version)<=attempt.version!):receipt.my_rsvp!==(attempt.body.going?'going':'cancelled')))throw new Error('活動操作結果尚未確認。');
      return receipt as CommunityEvent;
    });
    if(result){actionAttempt.current=null;setNotice('原活動操作已確認，正在重新讀取目前狀態。');await load();}
  }
  async function action(item:CommunityEvent,kind:'cancel'|'rsvp',going=false) {
    if(actionAttempt.current||reviewAttempt.current||saveAttempt.current||saving||busy||lastFailureUnknown||mediaUnknown){setNotice('請先完成或重試原活動操作。');return;}
    setNotice('');
    const code=kind==='rsvp'&&going?referralCode(item.event_id):null;
    if(kind==='rsvp'&&going&&item.visibility==='referral'&&!code){setNotice('請從會員分享的活動連結進入，才能報名這場活動。');return;}
    const attempt:EventActionAttempt={eventId:item.event_id,path:`/events/${item.event_id}/${kind}`,kind,body:kind==='cancel'?{}:{going,referral_code:code},version:kind==='cancel'?item.aggregate_version:undefined};
    actionAttempt.current=attempt;await sendEventAction(attempt);
  }
  async function review(item:CommunityEvent,decision:'approve'|'reject'){
    if(actionAttempt.current||saveAttempt.current||saving||busy||recoveringSave||recoveringAction||mediaUnknown){setNotice('請先完成或重試原活動儲存操作。');return;}
    const frozen=reviewAttempt.current;
    if(lastFailureUnknown&&!frozen){setNotice('請先重試原操作。');return;}
    if(frozen&&(frozen.eventId!==item.event_id||frozen.decision!==decision)){setNotice('請先重試原審核，不要改送另一個決定。');return;}
    const reason=frozen?.reason??reviewReason.trim();if(!reason){setNotice('請填寫審核理由。');return;}
    const attempt=frozen??{eventId:item.event_id,version:item.aggregate_version,decision,reason};reviewAttempt.current=attempt;
    const result=await mutate<CommunityEvent>(`/events/${attempt.eventId}/review`,{decision:attempt.decision,reason:attempt.reason},attempt.version,value=>{
      const receipt=value as Partial<CommunityEvent>|null;
      if(!receipt||receipt.event_id!==attempt.eventId||!Number.isSafeInteger(receipt.aggregate_version)||receipt.aggregate_version!==attempt.version+1||receipt.state!==(attempt.decision==='approve'?'published':'rejected'))throw new Error('審核結果尚未確認。');
      return receipt as CommunityEvent;
    });
    if(result){reviewAttempt.current=null;setReviewing(null);setReviewReason('');setNotice('原審核已確認，活動目前狀態以下方最新資料為準。');announceInboxChange();window.dispatchEvent(new Event('freedom-world-facts-updated'));await load();}
  }
  async function share(item:CommunityEvent){
    if(saving||busy||recoveringReview||recoveringAction||mediaUnknown)return;
    try{
      const result=await client.post<{path:string}>('/promotion/links',{kind:'event',target:item.event_id});
      const url=`${window.location.origin}${result.path}`;
      setShareFor(item.event_id);setShareUrl(url);
      if(navigator.share){try{await navigator.share({title:item.title,url});setNotice('已開啟分享。');return;}catch(error){if((error as Error).name==='AbortError')return;}}
      await navigator.clipboard.writeText(url);setNotice('活動專頁連結已複製，分享碼已包含在連結中。');
    }catch(cause){setNotice(cause instanceof Error?cause.message:'連結未能複製，請從下方欄位複製。');}
  }
  async function report(item:CommunityEvent,offset=0){
    const id=item.event_id,token=(reportRequests.current[id]??0)+1,generation=client.sessionGeneration;
    reportRequests.current[id]=token;
    setReports(current=>{const previous=current[id]??{items:[],total:0,next_offset:null};return {...current,[id]:{...previous,loading:true,error:'',request_offset:offset}}});
    try{
      const page=await client.get<ReferralPage>(`/events/${id}/referrals?limit=20&offset=${offset}`);
      if(reportRequests.current[id]!==token||client.sessionGeneration!==generation)return;
      setReports(current=>{const previous=current[id]?.items??[];return {...current,[id]:{...page,items:offset?[...previous,...page.items]:page.items,loading:false,error:'',request_offset:offset}}});
    }catch(cause){
      if(reportRequests.current[id]!==token||client.sessionGeneration!==generation)return;
      setReports(current=>{const previous=current[id]??{items:[],total:0,next_offset:null};return {...current,[id]:{...previous,loading:false,error:cause instanceof Error?cause.message:'分享統計暫時無法讀取。',request_offset:offset}}});
    }
  }
  function openCreate(help=false){
    if(!leaveGuard.current())return;
    discardDrafts();focusHelp.current=help;setCreating(true);
    // Already-open forms do not trigger the effect again.
    if(creating)createForm.current?.querySelector<HTMLElement>(help?'[data-event-help-need]':'input')?.focus();
  }
  function closeCreate(){if(leaveGuard.current()){discardDrafts();createTrigger.current?.focus();}}
  const upcoming=items.filter(item=>item.state==='published'&&Date.parse(item.ends_at)>Date.now());
  const pending=items.filter(item=>item.state==='pending');
  const endedPublished=[...items.filter(item=>item.state==='published'&&Date.parse(item.ends_at)<=Date.now())].sort((a,b)=>Date.parse(b.starts_at)-Date.parse(a.starts_at)||a.event_id.localeCompare(b.event_id));
  const closed=items.filter(item=>item.state==='rejected'||item.state==='cancelled');
  const calendarEvents=items.filter(item=>item.state==='published');
  const render=(item:CommunityEvent)=>{
    const started=Date.parse(item.starts_at)<=Date.now(),ended=item.state==='published'&&Date.parse(item.ends_at)<=Date.now(),mine=item.organizer_ref===session.user.user_id;
    const exchangeBlocked=internExchange(item,guilds);
    const canJoin=item.state==='published'&&!started;
    const referral=reports[item.event_id];
    const statusLabel=item.state==='pending'?'待審核':item.state==='rejected'?'未通過審核':item.state==='cancelled'?'已取消':ended?'已結束':started?'進行中':'開放報名';
    const link=participationUrl(item.location),onlineLink=participationUrl(item.online_url??'');
    return <article className={ended?'card experience-card experience-card-ended':'card experience-card'} key={item.event_id}>
      <div className="experience-card-head"><div><span className="experience-kicker">{kindLabel[item.event_kind]??'其他活動'} · {modeLabel[item.mode]} · {item.visibility==='guild'?'公會內部 · ':item.visibility==='workshop'?'工坊會員 · ':item.visibility==='referral'?'推薦連結公開 · ':'完全公開 · '}{statusLabel}</span><h3>{item.title}{ended&&<span className="event-ended-badge">已結束</span>}</h3></div>{item.state==='published'&&<span className="experience-count">{item.attending_count}{item.capacity===null?' 人報名':` / ${item.capacity} 人`}</span>}</div>
      {item.banner_url&&<img className="experience-banner-image" src={item.banner_url} alt="活動海報" width={item.banner_orientation==='portrait'?900:1200} height={item.banner_orientation==='portrait'?1200:675}/>}
      {item.video_url&&<video className="experience-video" controls preload="metadata" aria-label={`${item.title} 的活動影片`}><source src={item.video_url} type={item.video_mime??undefined}/></video>}
      {item.topic&&<p>主題：{item.topic}</p>}<p className="multiline-text">{item.description}</p><dl className="experience-meta"><div><dt>時間</dt><dd>{formatIsoLocal(item.starts_at)} ～ {formatIsoLocal(item.ends_at)}（依裝置時區）</dd></div><div><dt>地點</dt><dd>{link?<a href={link} target="_blank" rel="noopener noreferrer">開啟參與連結 ↗</a>:item.location}</dd></div>{onlineLink&&<div><dt>線上參與</dt><dd><a href={onlineLink} target="_blank" rel="noopener noreferrer">開啟線上連結 ↗</a></dd></div>}<div><dt>發佈者</dt><dd>{item.organizer_name}（會員活動）</dd></div></dl>
      {item.help_need&&<div className="event-help-need"><h4>這場活動需要幫手</h4><p className="multiline-text">{item.help_need}</p>{selectedId!==item.event_id&&item.state==='published'&&<a className="btn btn-ghost" href={`#events/${item.event_id}`}>看看怎麼幫忙</a>}</div>}
      {item.state==='rejected'&&item.review_reason&&<p className="banner banner-info">審核理由：<span className="multiline-text">{item.review_reason}</span></p>}
      {exchangeBlocked&&<p className="field-hint">{INTERN_WRITE}</p>}
      <div className="experience-actions">{canJoin&&<button type="button" className={item.my_rsvp==='going'?'btn btn-ghost':'btn btn-primary'} disabled={busy||saving||recoveringSave||recoveringReview||recoveringAction||mediaUnknown||(item.my_rsvp!=='going'&&item.capacity!==null&&item.attending_count>=item.capacity)} onClick={()=>void action(item,'rsvp',item.my_rsvp!=='going')}>{item.my_rsvp==='going'?'取消報名':item.capacity!==null&&item.attending_count>=item.capacity?'名額已滿':'我要參加'}</button>}{item.state==='published'&&<a className="btn btn-ghost" href={`#events/${item.event_id}`}>活動專頁</a>}{item.state==='published'&&!ended&&<button type="button" className="btn btn-ghost" disabled={saving||busy||mediaUnknown} onClick={()=>void share(item)}>分享活動</button>}{mine&&item.state==='published'&&<button type="button" className="btn btn-ghost" onClick={event=>{attendeesTrigger.current=event.currentTarget;setAttendeesFor({event_id:item.event_id,title:item.title});}}>報名名單</button>}{mine&&item.state==='published'&&<button type="button" className="btn btn-ghost" onClick={()=>void report(item)}>分享報名統計</button>}{mine&&item.state==='pending'&&!started&&<button type="button" className="btn btn-ghost" disabled={busy||saving||recoveringSave||recoveringReview||recoveringAction||mediaUnknown||exchangeBlocked} onClick={()=>{if(!leaveGuard.current())return;discardDrafts();setEditing(item.event_id);setEditDraft(fromEvent(item));}}>編輯草稿</button>}{mine&&(item.state==='pending'||item.state==='published')&&<button type="button" className="btn btn-ghost" disabled={busy||saving||recoveringSave||recoveringReview||recoveringAction||mediaUnknown||exchangeBlocked} onClick={()=>void action(item,'cancel')}>取消活動</button>}{item.can_review&&<button type="button" className="btn btn-primary" disabled={busy||saving||recoveringSave||recoveringReview||recoveringAction||mediaUnknown} onClick={event=>{if(!leaveGuard.current())return;discardDrafts();reviewTrigger.current=event.currentTarget;setReviewing(item.event_id);setReviewReason('');}}>審核活動</button>}</div>
      {shareFor===item.event_id&&shareUrl&&<div className="event-share-link"><label className="field">分享連結<input readOnly value={shareUrl} onFocus={event=>event.target.select()}/><small>推薦碼已包含在連結內；訪客每天點開算 1 分（活動推廣排行榜）。</small></label><button type="button" className="btn btn-ghost" onClick={()=>void navigator.clipboard.writeText(shareUrl).then(()=>setNotice('活動專頁連結已複製。')).catch(()=>setNotice('請選取上方連結手動複製。'))}>複製連結</button></div>}
      {referral&&<div className="event-referral-report"><h4>依分享會員統計報名</h4>{referral.error&&<div className="banner banner-error" role="alert">{referral.error}<button type="button" className="btn btn-ghost" onClick={()=>void report(item,referral.request_offset)}>重試</button></div>}{referral.items.length?<ul>{referral.items.map(row=><li key={row.user_id}>{row.member_name}：點擊 {row.clicks}・報名 {row.registrations} 人</li>)}</ul>:!referral.loading&&!referral.error?<p>尚無分享報名紀錄。</p>:null}{referral.loading&&<p role="status">正在讀取分享統計…</p>}{referral.items.length>0&&<p className="field-hint">目前顯示 {referral.items.length} / {referral.total} 位分享會員。</p>}{referral.next_offset!==null&&!referral.loading&&!referral.error&&<button type="button" className="btn btn-ghost" onClick={()=>void report(item,referral.next_offset!)}>載入更多</button>}</div>}
      {selectedId===item.event_id&&item.help_need&&(item.state==='published'||item.state==='cancelled')&&<EventHelpers key={`${session.user.user_id}:${client.sessionGeneration}:${item.event_id}`} client={client} eventId={item.event_id} userId={session.user.user_id} isOrganizer={mine} referralCode={referralCode(item.event_id)} onBlockedChange={onHelperBlocked}/>}
      {selectedId===item.event_id&&item.state==='published'&&item.mode!=='online'&&renderMemberCards?.(item.event_id)}
      {participationEnabled&&selectedId===item.event_id&&<EventParticipation client={client} session={session} eventId={item.event_id} eventVersion={item.aggregate_version} rsvpState={item.my_rsvp} referralCode={referralCode(item.event_id)} onChanged={()=>void load()}/>}
      {participationEnabled&&selectedId===item.event_id&&mine&&item.state==='published'&&!started&&!exchangeBlocked&&<EventParticipationOrganizer client={client} session={session} event={item} onChanged={()=>void load()}/>}
      {editing===item.event_id&&<form className="experience-editor" onSubmit={e=>void save(e)}><EventFields progressive value={editDraft} onChange={setEditDraft} guilds={guilds} guildLocked disabled={saving||busy||lastFailureUnknown||mediaUnknown}/>{internExchange(editDraft,guilds)&&<p className="field-hint">{INTERN_WRITE}</p>}<details className="event-form-options"><summary>加上海報或影片（選填）</summary><div className="experience-fields"><label className="field">活動海報（選填）<input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving||busy||recoveringSave||recoveringReview||recoveringAction||mediaUnknown||internExchange(editDraft,guilds)} onChange={e=>void chooseBanner(e.target.files?.[0]??null,true)}/><small>直式、橫式皆可；JPEG、PNG 或 WebP，20 MB 內會自動調整大小。{editBannerFile?` 已選擇 ${editBannerFile.name}`:''}</small></label>{preparingBanner&&<p className="field-hint" role="status">正在處理圖片…</p>}<label className="field">活動影片（選填）<input type="file" accept="video/mp4,video/webm" disabled={saving||busy||recoveringSave||recoveringReview||recoveringAction||mediaUnknown||internExchange(editDraft,guilds)} onChange={e=>chooseVideo(e.target.files?.[0]??null,true)}/><small>MP4 或 WebM，20 MiB 以下。{editVideoFile?` 已選擇 ${editVideoFile.name}`:''}</small></label></div></details><EventDraftPreview value={editDraft} banner={editBannerFile} existingBanner={item.banner_url}/><div className="experience-actions"><button className="btn btn-primary" disabled={busy||saving||mediaUnknown||preparingBanner||Boolean(bannerError)||internExchange(editDraft,guilds)}>儲存修改</button>{mediaUnknown?<button type="button" className="btn btn-ghost" disabled={saving||busy} onClick={()=>void reconcileMedia()}>重試確認保存</button>:bannerError&&(editBannerFile||editVideoFile)&&<button type="button" className="btn btn-ghost" onClick={()=>setBannerError('')}>重試保存</button>}{item.banner_url&&<button type="button" className="btn btn-ghost" disabled={saving||busy||recoveringSave||recoveringReview||recoveringAction||mediaUnknown||internExchange(editDraft,guilds)} onClick={()=>void removeBanner(item)}>移除海報</button>}{item.video_url&&<button type="button" className="btn btn-ghost" disabled={saving||busy||recoveringSave||recoveringReview||recoveringAction||mediaUnknown||internExchange(editDraft,guilds)} onClick={()=>void removeVideo(item)}>移除影片</button>}<button type="button" className="btn btn-ghost" disabled={saving} onClick={()=>{if(leaveGuard.current())discardDrafts();}}>返回</button></div></form>}
      {reviewing===item.event_id&&<div className="experience-editor"><label className="field">審核理由<textarea disabled={busy||saving||lastFailureUnknown||mediaUnknown} required minLength={1} maxLength={500} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/></label><div className="experience-actions">{recoveringReview&&<button type="button" className="btn btn-primary" disabled={busy||saving} onClick={()=>{const attempt=reviewAttempt.current;if(attempt)void review(item,attempt.decision);}}>重試原審核</button>}<button type="button" className="btn btn-primary" disabled={busy||saving||lastFailureUnknown||mediaUnknown||!reviewReason.trim()} onClick={()=>void review(item,'approve')}>核准並公告</button><button type="button" className="btn btn-ghost" disabled={busy||saving||lastFailureUnknown||mediaUnknown||!reviewReason.trim()} onClick={()=>void review(item,'reject')}>退回</button><button type="button" className="btn btn-ghost" onClick={()=>{if(leaveGuard.current()){setReviewing(null);setReviewReason('');reviewTrigger.current?.focus();}}}>返回</button></div></div>}
    </article>;
  };
  const actionRecovery=recoveringAction&&<div className="banner banner-info" role="status"><p>原報名或取消操作還沒確認，請勿再送出另一個活動操作。</p><button type="button" className="btn btn-ghost" disabled={busy||saving} onClick={()=>{if(actionAttempt.current)void sendEventAction(actionAttempt.current);}}>重試原活動操作</button></div>;
  const selected=selectedId&&(items.find(item=>item.event_id===selectedId)??selectedItem);
  if(selectedId)return <section className="experience-panel event-flow stack" aria-label="活動專頁"><div className="experience-actions"><button className="btn btn-ghost" type="button" onClick={onList}>返回活動列表與行事曆</button></div>{selected?render(selected):<p role="status">{loading?'正在載入活動…':'找不到這場活動，或目前無法查看。'}</p>}{renderMissions?.(selectedId,onMissionBlocked)}<EventAttendees client={client} event={attendeesFor} onClose={()=>{setAttendeesFor(null);attendeesTrigger.current?.focus();attendeesTrigger.current=null;}}/>{actionRecovery}{notice&&<p role="status" className="banner banner-info">{notice}</p>}{error&&<p role="alert" className="banner banner-error">{error}</p>}{bannerError&&<p role="alert" className="banner banner-error">{bannerError}</p>}</section>;
  return <section className="experience-panel event-flow stack" aria-label="活動發佈區">
    <EventAttendees client={client} event={attendeesFor} onClose={()=>{setAttendeesFor(null);attendeesTrigger.current?.focus();attendeesTrigger.current=null;}}/>
    <div className="experience-intro"><div><h2>一起參加活動，也可以自己辦。</h2><p>選一場活動報名，或填好時間、地點，送出你的活動。活動核准後才會開放報名。</p></div><button type="button" className="btn btn-primary" ref={createTrigger} data-guide-anchor="events:submit-event" disabled={initialLoadPending||saving||mediaUnknown} onClick={()=>openCreate()}>辦活動</button></div>
    <nav className="event-jobs" aria-label="你想做什麼"><button type="button" className="btn btn-ghost" disabled={initialLoadPending} onClick={()=>{upcomingHeading.current?.scrollIntoView({block:'start'});upcomingHeading.current?.focus();}}>報名參加</button><button type="button" className="btn btn-ghost" disabled={initialLoadPending||saving||mediaUnknown} onClick={()=>openCreate(true)}>找幫手</button><p className="field-hint">找幫手：先填活動與協助需求，核准後讓夥伴申請。</p></nav>
    {creating&&<form ref={createForm} className="card experience-editor" onSubmit={e=>void save(e)}><h3>辦一場活動</h3><p className="field-hint">先填活動內容、時間和地點，其他設定可以稍後展開。未送出的內容只保留在本頁。</p><EventFields progressive value={draft} onChange={setDraft} guilds={guilds} disabled={saving||busy||lastFailureUnknown||mediaUnknown}/>{internExchange(draft,guilds)&&<p className="field-hint">{INTERN_WRITE}</p>}<details className="event-form-options"><summary>加上海報或影片（選填）</summary><div className="experience-fields"><label className="field">活動海報（選填）<input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving||busy||recoveringSave} onChange={e=>void chooseBanner(e.target.files?.[0]??null)}/><small>直式、橫式皆可；JPEG、PNG 或 WebP，20 MB 內會自動調整大小。{bannerFile?` 已選擇 ${bannerFile.name}`:''}</small></label>{preparingBanner&&<p className="field-hint" role="status">正在處理圖片…</p>}<label className="field">活動影片（選填）<input type="file" accept="video/mp4,video/webm" disabled={saving||busy||recoveringSave} onChange={e=>chooseVideo(e.target.files?.[0]??null)}/><small>MP4 或 WebM，20 MiB 以下。{videoFile?` 已選擇 ${videoFile.name}`:''}</small></label></div></details><EventDraftPreview value={draft} banner={bannerFile}/><div className="experience-actions"><button className="btn btn-primary" disabled={busy||saving||mediaUnknown||preparingBanner||Boolean(bannerError)||internExchange(draft,guilds)}>送出審核</button><button type="button" className="btn btn-ghost" disabled={saving} onClick={closeCreate}>返回</button></div></form>}
    {actionRecovery}{notice&&<p role="status" className="banner banner-info">{notice}</p>}{error&&<p role="alert" className="banner banner-error">{error}</p>}{bannerError&&<p role="alert" className="banner banner-error">{bannerError}</p>}{loadError&&<div role="alert" className="banner banner-error">{loadError}<button className="btn btn-ghost" onClick={()=>void load()}>重試</button></div>}
    {loading&&<p role="status">正在載入活動…</p>}
    {!loading&&<>{pending.length>0&&<><div className="experience-heading"><h2>待審核活動</h2><span>{pending.length} 場</span></div><div className="experience-grid">{pending.map(render)}</div></>}
      <EventCalendar events={calendarEvents} onOpen={id=>{window.location.hash=`events/${id}`}}/>
      <div className="experience-heading"><h2 ref={upcomingHeading} tabIndex={-1}>即將舉辦</h2><span>{upcoming.length} 場</span></div>{upcoming.length?<div className="experience-grid">{upcoming.map(render)}</div>:<p className="empty">目前沒有即將舉辦的活動。你可以提交第一場。</p>}
      {endedPublished.length>0&&<section aria-label="過去的活動"><div className="experience-heading"><h2>過去的活動</h2><span>{endedPublished.length} 場</span></div><div className="experience-grid">{endedPublished.map(render)}</div></section>}
      {closed.length>0&&<details className="experience-history"><summary>已取消或退回（{closed.length}）</summary><div className="experience-grid">{closed.map(render)}</div></details>}
      <div className="experience-heading"><h2>系統公告欄</h2><span>最近 {bulletins.length} 則</span></div>{bulletins.length?<ol className="experience-bulletins">{bulletins.map(item=><li key={item.bulletin_id}><span>{item.message}</span><time dateTime={item.created_at}>{formatIsoLocal(item.created_at)}</time></li>)}</ol>:<p className="empty">目前沒有活動公告。</p>}
    </>}
  </section>;
}
