import {createTaskRead} from './task-board-loading';
import type {GuildSummary} from './Onboarding';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {requireItems,type PortalClient} from '../api';
import { BrandPoster } from './CommunityBrand';
import {EventFields,blankEvent,eventPayload,type EventDraft} from './EventsPanel';
import {PreviewProfileMenu} from './PreviewProfileMenu';
import {announceInboxChange} from './member-inbox';
import './MemberExperience.css';
import {QuickStart} from './QuickStart';
import {useLanguage} from '../language';

type WelcomeProps={client:PortalClient;name:string;entryLabel?:string;onStart:()=>void;onCompleted:()=>void;onLogout:()=>void};
const guildsFrom=(value:unknown)=>requireItems<GuildSummary>(value,'公會');
// Reuse the existing session-fenced read lane. No completed cache or polling.
function usePreviewRead<T>(client:PortalClient,path:string,decode:(value:unknown)=>T){
  const generation=client.sessionGeneration;
  const lane=useMemo(()=>createTaskRead<T>(()=>client.sessionGeneration),[client,generation]);
  const state=useSyncExternalStore(lane.subscribe,lane.getSnapshot,lane.getSnapshot);
  const reload=useCallback(()=>lane.run(path,async signal=>decode(await client.get<unknown>(path,{signal}))),[client,path,decode,lane]);
  useEffect(()=>{void reload();return()=>lane.reset();},[reload,lane]);
  return {state,reload};
}
export function WelcomePreview(props:WelcomeProps){
  return <WelcomePreviewContent key={props.client.sessionGeneration} {...props}/>;
}
function WelcomePreviewContent({client,name,entryLabel,onStart,onCompleted,onLogout}:WelcomeProps) {
  const {language,t}=useLanguage();
  const guildRead=usePreviewRead(client,'/guilds/directory',guildsFrom);
  const guilds=guildRead.state.value??[];
  const mounted=useRef(false),session=useRef(client.sessionGeneration);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&session.current===client.sessionGeneration;
  const [error,setError]=useState(''),[draft,setDraft]=useState<EventDraft>(blankEvent),[showForm,setShowForm]=useState(false),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setSaving(true);setError('');try{await client.post<{event_id:string}>('/events',eventPayload(draft),{idempotencyKey:crypto.randomUUID()});if(!current())return;setNotice('活動已發布。');setDraft(blankEvent());setShowForm(false);announceInboxChange();}catch(cause){if(current())setError(cause instanceof Error?cause.message:'活動未能送出，請重試。');}finally{if(current())setSaving(false);}}
  return <main className="welcome-preview"><div className="welcome-preview-top"><BrandPoster compact/><div className="experience-actions"><PreviewProfileMenu client={client} name={name} onLogout={onLogout}/></div></div>
    <section className="welcome-hero"><p className="eyebrow">{t('welcome.next')}</p><h1>{t('welcome.title',{name})}</h1>{entryLabel&&<p className="field-hint">{t('welcome.destination',{destination:entryLabel})}</p>}</section>
    <QuickStart client={client} onCompleted={onCompleted} directory={{
      items:guilds,loading:guildRead.state.status==='idle'||guildRead.state.status==='loading',
      error:guildRead.state.status==='error'?t('page.unavailable',{label:t('quick.choose')}):'',reload:guildRead.reload,
    }}/>
    <details className="welcome-optional"><summary>{t('welcome.optional')}</summary><div className="experience-actions"><button type="button" className="btn btn-ghost" onClick={onStart}>{t('welcome.assessment')}</button><button type="button" className="btn btn-ghost" onClick={()=>setShowForm(value=>!value)}>{t('welcome.event')}</button></div><p className="field-hint">{t('welcome.intro')}</p><p className="field-hint">{t('welcome.assessmentOptional')}</p><p className="welcome-preview-note">{t('welcome.note')}</p></details>
    {showForm&&<form className="card experience-editor" onSubmit={e=>void submit(e)}><h2>提交公開活動</h2><p>填好名稱、時間和地點即可發布。</p><EventFields progressive value={draft} onChange={setDraft} guilds={guilds}/><div className="experience-actions"><button className="btn btn-primary" disabled={saving}>發布</button><button type="button" className="btn btn-ghost" onClick={()=>setShowForm(false)}>返回</button></div></form>}
    {notice&&<p className="banner banner-info" role="status">{notice}</p>}
    {error&&<p role="status" className="banner banner-info">{language==='zh-Hant'?error:t('error.generic')}</p>}
    {language!=='zh-Hant'&&<p className="field-hint">{t('language.scope')}</p>}
  </main>;
}
