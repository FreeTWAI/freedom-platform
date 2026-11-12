import {useEffect,useRef,useState} from 'react';
import {ApiError,type PortalClient} from '../api';
import type {ShareComposeResult} from './share-port';
import type {ImportedEvent} from '../../../../modules/shares/adapters/event-import';
const local=(v?:string)=>{if(!v)return '';const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
type Draft={title:string;starts_at:string;location:string;description:string;ends_at:string;mode:'online'|'in_person'|'hybrid';online_url:string;source_organizer:string;source_cover_url:string;external_registration_url:string;registration_mode:'platform'|'external';guild_key:string;capacity:string};
const blank=():Draft=>({title:'',starts_at:'',location:'',description:'',ends_at:'',mode:'in_person',online_url:'',source_organizer:'',source_cover_url:'',external_registration_url:'',registration_mode:'platform',guild_key:'',capacity:''});
export function EventComposer({client,onDone,initialUrl=''}:{client:PortalClient;onDone:(r:ShareComposeResult)=>void;initialUrl?:string}){
 const [draft,setDraft]=useState<Draft>(blank),[url,setUrl]=useState(initialUrl),[source,setSource]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[previewing,setPreviewing]=useState(false),[guilds,setGuilds]=useState<{guild_key:string;name:string}[]>([]);
 const pending=useRef<{key:string;body:unknown}|null>(null),generation=client.sessionGeneration,live=useRef(true),sequence=useRef(0);
 const current=()=>live.current&&generation===client.sessionGeneration;
 useEffect(()=>{live.current=true;void client.get<{items:{guild_key:string;name:string}[]}>('/guilds/directory').then(r=>{if(current())setGuilds(r.items);},()=>{});return()=>{live.current=false;sequence.current++;};},[client]);
 useEffect(()=>{
  const seq=++sequence.current;if(!/^https:\/\//i.test(url.trim())){setSource('');return;}
  const timer=setTimeout(()=>{setPreviewing(true);void client.post<{event:ImportedEvent}>('/shares/preview',{kind:'event',url:url.trim()},{idempotencyKey:crypto.randomUUID()}).then(r=>{
   if(!current()||seq!==sequence.current)return;const e=r.event;setSource(e.source_url);setDraft({...blank(),...Object.fromEntries(Object.entries(e).filter(([,v])=>v!==undefined)),starts_at:local(e.starts_at),ends_at:local(e.ends_at)} as Draft);setError('');
  },e=>{if(current()&&seq===sequence.current){setSource('');setError(e.message);}}).finally(()=>{if(current()&&seq===sequence.current)setPreviewing(false);});},400);
  return()=>{clearTimeout(timer);sequence.current++;};
 },[url]);
 const locked=busy||!!pending.current;
 const set=<K extends keyof Draft>(k:K,v:Draft[K])=>setDraft(d=>({...d,[k]:v}));
 async function publish(){
  if(previewing||busy)return;setBusy(true);setError('');
  try{
   if(!pending.current){const d=draft;pending.current={key:crypto.randomUUID(),body:{title:d.title,starts_at:new Date(d.starts_at).toISOString(),location:d.location,mode:d.mode,registration_mode:d.registration_mode,
    ...(url.trim()?{source_url:source||url.trim()}:{}),...(d.guild_key?{guild_key:d.guild_key}:{}),...(d.capacity?{capacity:Number(d.capacity)}:{}),...(d.ends_at?{ends_at:new Date(d.ends_at).toISOString()}:{}),
    ...Object.fromEntries(['description','online_url','source_organizer','source_cover_url','external_registration_url'].filter(k=>d[k as keyof Draft]).map(k=>[k,d[k as keyof Draft]]))}};}
   const result=await client.post<{event_id:string;share_id:string}>('/events',pending.current.body,{idempotencyKey:pending.current.key});
   if(current())onDone({status:'published',share_id:result.share_id,url:`/events/${result.event_id}`});
  }catch(e){if(current()){setError(e instanceof Error?e.message:'發布失敗');if(e instanceof ApiError&&e.definitiveResponse)pending.current=null;}}
  finally{if(current())setBusy(false);}
 }
 return <form className="stack" onSubmit={e=>{e.preventDefault();void publish();}} onInvalidCapture={e=>{let p=(e.target as HTMLElement).parentElement;while(p){if(p instanceof HTMLDetailsElement)p.open=true;p=p.parentElement;}}}>
  <label>活動連結（選填）<input type="url" value={url} disabled={locked} onChange={e=>setUrl(e.target.value)} placeholder="https://"/></label>
  {previewing&&<small role="status">讀取活動…</small>}
  <label>名稱<input required maxLength={120} value={draft.title} disabled={locked||previewing} onChange={e=>set('title',e.target.value)}/></label>
  <label>時間<input required type="datetime-local" value={draft.starts_at} disabled={locked||previewing} onChange={e=>set('starts_at',e.target.value)}/></label>
  <label>地點<input required maxLength={300} value={draft.location} disabled={locked||previewing} onChange={e=>set('location',e.target.value)}/></label>
  <details><summary>選填設定</summary><div className="stack">
   <label>結束時間<input type="datetime-local" value={draft.ends_at} disabled={locked} onChange={e=>set('ends_at',e.target.value)}/></label>
   <label>說明<textarea maxLength={3000} value={draft.description} disabled={locked} onChange={e=>set('description',e.target.value)}/></label>
   <label>形式<select value={draft.mode} disabled={locked} onChange={e=>set('mode',e.target.value as Draft['mode'])}><option value="in_person">實體</option><option value="online">線上</option><option value="hybrid">線上與實體</option></select></label>
   <label>參與連結<input type="url" value={draft.online_url} disabled={locked} onChange={e=>set('online_url',e.target.value)}/></label>
   <label>人數上限<input type="number" min={1} max={500} value={draft.capacity} disabled={locked} onChange={e=>set('capacity',e.target.value)}/></label>
   <label>公會<select value={draft.guild_key} disabled={locked} onChange={e=>set('guild_key',e.target.value)}><option value="">公開活動</option>{guilds.map(g=><option key={g.guild_key} value={g.guild_key}>{g.name}</option>)}</select></label>
   {source&&<><label>主辦（未核實）<input maxLength={160} value={draft.source_organizer} disabled={locked} onChange={e=>set('source_organizer',e.target.value)}/></label>
    <label>封面網址<input type="url" value={draft.source_cover_url} disabled={locked} onChange={e=>set('source_cover_url',e.target.value)}/></label>
    <label>報名方式<select value={draft.registration_mode} disabled={locked} onChange={e=>set('registration_mode',e.target.value as Draft['registration_mode'])}><option value="platform">在自由工坊報名</option><option value="external">到原站報名</option></select></label>
    <label>原站報名連結<input type="url" value={draft.external_registration_url} disabled={locked} onChange={e=>set('external_registration_url',e.target.value)}/></label></>}
  </div></details>
  <small>{draft.guild_key?'僅公會成員':'公開'} · 時間依裝置時區</small>{error&&<p role="alert">{error}</p>}
  <button className="btn btn-primary" disabled={busy||previewing}>{busy?'發布中…':'發布'}</button>
 </form>;
}
