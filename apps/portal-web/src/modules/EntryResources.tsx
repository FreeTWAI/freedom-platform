import {useCallback,useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import type {PortalClient} from '../api';
import {SkillBookIntro,type IntroBook} from './SkillBookIntro';
import {useLanguage} from '../language';
import {createTaskRead} from './task-board-loading';

const emptyMessages = {
  'zh-Hant':'目前沒有可預覽的技能書。', en:'No skill books are available to preview yet.',
  ja:'現在プレビューできるスキルブックはありません。', ko:'현재 미리 볼 수 있는 스킬북이 없습니다.',
  es:'Todavía no hay libros de habilidades disponibles para consultar.',
} as const;

/** Existing catalog projection only; incomplete cards remain a retryable read error. */
function previewBooks(value:unknown):IntroBook[]{
  const items=(value as {skill_books?:unknown}|null)?.skill_books;
  if(!Array.isArray(items))throw new Error('Incomplete skill catalog');
  const books=items.slice(0,3);
  if(books.some(book=>!book||typeof book!=='object'||typeof (book.id??book.book_id)!=='string'
    ||typeof book.title!=='string'||typeof book.description!=='string'||typeof book.repository_url!=='string')){
    throw new Error('Incomplete skill preview');
  }
  return books;
}

export function EntryResources({client,communitySearchEnabled=false,compact=false}:{client:PortalClient;communitySearchEnabled?:boolean;compact?:boolean}){
  const {t,language}=useLanguage(),generation=client.sessionGeneration;
  const [opened,setOpened]=useState(false);
  const lane=useMemo(()=>createTaskRead<IntroBook[]>(()=>client.sessionGeneration),[client,generation]);
  const state=useSyncExternalStore(lane.subscribe,lane.getSnapshot,lane.getSnapshot);
  const reload=useCallback(()=>lane.run('/community',async signal=>previewBooks(
    await client.get<unknown>('/community',{background:true,signal}))),[client,lane]);
  // Read only while expanded. Closing removes the old view; reopening revalidates.
  useEffect(()=>{if(opened)void reload();return()=>lane.reset();},[opened,reload,lane]);
  const loading=opened&&(state.status==='idle'||state.status==='loading');
  const books=state.value??[];
  const benefits=<ul className="entry-benefits"><li>{t('resources.learning')}</li><li>{t('resources.partners')}</li><li>{t('resources.opportunities')}</li></ul>;
  return <div className="entry-resources">{!compact&&<><p>{t('resources.intro')}</p>{benefits}</>}
    <details onToggle={event=>setOpened(event.currentTarget.open)}><summary>{t('resources.open')}{communitySearchEnabled&&` · ${t('nav.community-search')}`}</summary>
      <div className="entry-resource-list" aria-busy={loading}>
        {compact&&benefits}
        {communitySearchEnabled&&<a className="btn btn-secondary btn-small community-search-action" href="#community-search">{t('nav.community-search')}</a>}
        {opened&&books.map(book=><article key={book.id??book.book_id}><strong>{book.title}</strong><SkillBookIntro book={book} label={t('resources.preview')}/></article>)}
        {loading&&<p role="status">{t('resources.loading')}</p>}
        {opened&&state.status==='ready'&&!books.length&&<p role="status">{emptyMessages[language]}</p>}
        {opened&&state.status==='error'&&<p role="alert">{t('resources.error')}</p>}
        {opened&&(state.status==='error'||state.status==='loading'||state.status==='ready'&&!books.length)&&<button type="button" className="btn btn-ghost btn-small" disabled={loading} aria-busy={loading} onClick={()=>void reload()}>{t('resources.retry')}</button>}
      </div>
    </details>
  </div>;
}
