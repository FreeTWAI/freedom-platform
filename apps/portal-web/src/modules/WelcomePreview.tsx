import {createTaskRead,type TaskReadSnapshot} from './task-board-loading';
import type {GuildSummary} from './Onboarding';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import {requireItems,type PortalClient} from '../api';
import { BrandPoster, CommunityLinks } from './Community';
import { formatIsoLocal } from '../format';
import {EventFields,blankEvent,eventPayload,type EventDraft} from './EventsPanel';
import {NotificationBell} from './NotificationBell';
import {PreviewProfileMenu} from './PreviewProfileMenu';
import {announceInboxChange} from './member-inbox';
import './MemberExperience.css';
import {QuickStart} from './QuickStart';
import {useLanguage} from '../language';

type PreviewTask = {work_item_id:string;title:string;objective:string;gain:string;claim_window_expires_at:string};
type PreviewEvent = {event_id:string;title:string;starts_at:string;mode:'online'|'in_person'|'hybrid';state:string};
type Catalog = {skill_books:{id:string;title:string;description:string;repository_url:string;upstream_url?:string;introduction_url?:string|null}[]};
const publicRepo=(url:string)=>{try{const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname==='github.com'&&!parsed.username&&!parsed.password?url:null}catch{return null}};
const publicWebsite=(url?:string|null)=>{try{const parsed=new URL(url??'');return parsed.protocol==='https:'&&!parsed.username&&!parsed.password?parsed.href:null}catch{return null}};
type WelcomeProps={client:PortalClient;name:string;entryLabel?:string;onStart:()=>void;onCompleted:()=>void;onLogout:()=>void};
const eventsFrom=(value:unknown)=>requireItems<PreviewEvent>(value,'活動').filter(item=>item.state==='published'&&Date.parse(item.starts_at)>Date.now()).slice(0,3);
const tasksFrom=(value:unknown)=>requireItems<PreviewTask>(value,'任務').slice(0,3);
const guildsFrom=(value:unknown)=>requireItems<GuildSummary>(value,'公會');
const booksFrom=(value:unknown)=>{
  const books=(value as Catalog|null)?.skill_books;
  if(!Array.isArray(books))throw new Error('技能書回應格式不完整。');
  return books.slice(0,3);
};
// Reuse the existing session-fenced read lane. No completed cache or polling.
function usePreviewRead<T>(client:PortalClient,path:string,decode:(value:unknown)=>T){
  const generation=client.sessionGeneration;
  const lane=useMemo(()=>createTaskRead<T>(()=>client.sessionGeneration),[client,generation]);
  const state=useSyncExternalStore(lane.subscribe,lane.getSnapshot,lane.getSnapshot);
  const reload=useCallback(()=>lane.run(path,async signal=>decode(await client.get<unknown>(path,{signal}))),[client,path,decode,lane]);
  useEffect(()=>{void reload();return()=>lane.reset();},[reload,lane]);
  const refreshAfterWrite=(transform=decode)=>{lane.cancel();return lane.run(path,async signal=>transform(await client.get<unknown>(path,{signal})));};
  return {state,reload,refreshAfterWrite};
}
function PreviewStatus({state,title,retry}:{state:TaskReadSnapshot<unknown>;title:string;retry:()=>void}){
  const {t}=useLanguage();
  return state.status==='error'?<div role="alert"><p>{t('page.unavailable',{label:title})}</p><button type="button" className="btn btn-ghost btn-small" onClick={retry}>{t('feedback.reload')} · {title}</button></div>
    :state.status==='idle'||state.status==='loading'?<p role="status">{t('page.opening',{label:title})}</p>:null;
}
export function WelcomePreview(props:WelcomeProps){
  return <WelcomePreviewContent key={props.client.sessionGeneration} {...props}/>;
}
function WelcomePreviewContent({client,name,entryLabel,onStart,onCompleted,onLogout}:WelcomeProps) {
  const {language,t}=useLanguage();
  const eventRead=usePreviewRead(client,'/events',eventsFrom),taskRead=usePreviewRead(client,'/task-board/preview',tasksFrom);
  const bookRead=usePreviewRead(client,'/community',booksFrom),guildRead=usePreviewRead(client,'/guilds/directory',guildsFrom);
  const events=eventRead.state.value??[],tasks=taskRead.state.value??[],books=bookRead.state.value??[],guilds=guildRead.state.value??[];
  const mounted=useRef(false),session=useRef(client.sessionGeneration);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&session.current===client.sessionGeneration;
  const [error,setError]=useState(''),[draft,setDraft]=useState<EventDraft>(blankEvent),[showForm,setShowForm]=useState(false),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setSaving(true);setError('');try{await client.post('/events',eventPayload(draft),{idempotencyKey:crypto.randomUUID()});if(!current())return;setNotice('活動已送出審核；核准後才會開放報名。');setDraft(blankEvent());setShowForm(false);announceInboxChange();await eventRead.refreshAfterWrite(value=>requireItems<PreviewEvent>(value,'活動').slice(0,3));}catch(cause){if(current())setError(cause instanceof Error?cause.message:'活動未能送出，請重試。');}finally{if(current())setSaving(false);}}
  return <main className="welcome-preview"><div className="welcome-preview-top"><BrandPoster compact/><div className="experience-actions"><NotificationBell client={client} onNavigate={()=>setNotice('選擇主要公會、完成加入後即可使用完整通知與訊息頁。')}/><PreviewProfileMenu client={client} name={name} onLogout={onLogout}/></div></div>
    <section className="welcome-hero"><p className="eyebrow">{t('welcome.next')}</p><h1>{t('welcome.title',{name})}</h1><p>{t('welcome.intro')}</p>{entryLabel&&<p className="field-hint">{t('welcome.destination',{destination:entryLabel})}</p>}</section>
    <QuickStart client={client} onCompleted={onCompleted} directory={{
      items:guilds,loading:guildRead.state.status==='idle'||guildRead.state.status==='loading',
      error:guildRead.state.status==='error'?t('page.unavailable',{label:t('quick.choose')}):'',reload:guildRead.reload,
    }}/>
    <details className="welcome-optional"><summary>{t('welcome.optional')}</summary><div className="experience-actions"><button type="button" className="btn btn-ghost" onClick={onStart}>{t('welcome.assessment')}</button><button type="button" className="btn btn-ghost" onClick={()=>setShowForm(value=>!value)}>{t('welcome.event')}</button></div><p className="field-hint">{t('welcome.assessmentOptional')}</p></details>
    {showForm&&<form className="card experience-editor" onSubmit={e=>void submit(e)}><h2>提交公開活動</h2><p>提交後由平台管理員或主辦公會長審核，並在系統公告欄記錄。</p><EventFields value={draft} onChange={setDraft} guilds={guilds}/><div className="experience-actions"><button className="btn btn-primary" disabled={saving}>送出審核</button><button type="button" className="btn btn-ghost" onClick={()=>setShowForm(false)}>返回</button></div></form>}
    {notice&&<p className="banner banner-info" role="status">{notice}</p>}
    {error&&<p role="status" className="banner banner-info">{language==='zh-Hant'?error:t('error.generic')}</p>}
    <div className="welcome-preview-grid"><section className="card" aria-label={t('welcome.events')} aria-busy={eventRead.state.status==='idle'||eventRead.state.status==='loading'}><h2>{t('welcome.events')}</h2><PreviewStatus state={eventRead.state} title={t('welcome.events')} retry={()=>void eventRead.reload()}/>{events.length?events.map(item=><article key={item.event_id} lang="zh-Hant"><strong>{item.title}</strong><p>{formatIsoLocal(item.starts_at)} · {item.state==='pending'?'我提交的活動，待審核':item.mode==='online'?'線上':'實體／混合'}</p></article>):eventRead.state.status==='ready'&&<p>{t('welcome.noEvents')}</p>}</section>
    <section className="card" aria-label={t('welcome.tasks')} aria-busy={taskRead.state.status==='idle'||taskRead.state.status==='loading'}><h2>{t('welcome.tasks')}</h2><PreviewStatus state={taskRead.state} title={t('welcome.tasks')} retry={()=>void taskRead.reload()}/>{tasks.length?tasks.map(item=><article key={item.work_item_id} lang="zh-Hant"><strong>{item.title}</strong><p className="multiline-text">{item.objective}</p></article>):taskRead.state.status==='ready'&&<p>{t('welcome.noTasks')}</p>}</section>
    <section className="card" aria-label={t('welcome.books')} aria-busy={bookRead.state.status==='idle'||bookRead.state.status==='loading'}><h2>{t('welcome.books')}</h2><PreviewStatus state={bookRead.state} title={t('welcome.books')} retry={()=>void bookRead.reload()}/>{books.length?books.map(book=>{const website=publicWebsite(book.introduction_url),original=publicRepo(book.upstream_url??book.repository_url);return <article key={book.id}><strong lang="zh-Hant">{book.title}</strong><p lang="zh-Hant">{book.description}</p>{original&&<a href={original} target="_blank" rel="noopener noreferrer">{t('welcome.original')}</a>}{website&&<a href={website} target="_blank" rel="noopener noreferrer">{t('welcome.website')}</a>}</article>;}):bookRead.state.status==='ready'&&<p>{t('welcome.noBooks')}</p>}</section></div>
    <p className="welcome-preview-note">{t('welcome.note')}</p>{language!=='zh-Hant'&&<p className="field-hint">{t('language.scope')}</p>}<CommunityLinks/>
  </main>;
}
