import {useEffect,useId,useRef,useState} from 'react';
import type {SkillBookGuide} from '../../../../modules/community/skill-book-guides';
import { SkillBookCover, SkillBookStar, SkillBookSourceAccount } from './SkillBookCover';
import {SkillBookBadges} from './SkillBookBadges';
import {useSkillDiscovery} from './skill-discovery-client';
import {SkillShare,fetchSkillShareContent,skillSharePath} from './SkillShare';
import './SkillBookIntro.css';
import './GitHubSocial.css';
import {DevelopmentEntry} from './DevelopmentAccess';
import {AuthorClaimPanel} from './AuthorClaim';
import {client} from '../portal-session';
import {EventOutcomeBacklinks} from './EventOutcomeBacklinks';
import {StorefrontBookUsage} from './SkillBookUsage';
import {isStorefrontReading} from './skill-book-commerce-references';
import {SkillInstall} from './SkillInstall';

export type OriginalReleaseSummary={tag_name:string;name:string|null;html_url:string;published_at:string|null};
export type OriginalCacheData={
  social_metrics?:{forks_count:number|null;open_issues_count:number|null;subscribers_count:number|null;pushed_at:string|null};
  full_name:string|null;url:string|null;original_author:string|null;description:string|null;
  topics:string[];license_spdx:string|null;default_branch:string|null;stars:number|null;
  readme_html?:string|null;quick_start:string|null;latest_release:OriginalReleaseSummary|null;
  head_sha:string|null;ahead_of_pin:boolean;latest_version_url:string|null;latest_version_label:string|null;
  fetched_at:string|null;fetch_state:string|null;stale:boolean;
};
export type IntroBook={id?:string;book_id?:string;title:string;description:string;summary_override?:string;repository_url:string;fork_url?:string|null;introduction_url?:string|null;upstream_url?:string;source_commit?:string|null;license_status?:string;guide?:SkillBookGuide;cover_url?:string;star_url?:string;official_guild_keys?:string[];original_cache?:OriginalCacheData|null};
export function httpsLink(value?:string|null){
  try {const url=new URL(value??'');return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function SkillBookIntro({book,guildName,label='閱讀技能書',community=false,describedBy,disabled=false}:{book:IntroBook;guildName?:string;label?:string;community?:boolean;describedBy?:string;disabled?:boolean}){
  const [open,setOpen]=useState(false),[visited,setVisited]=useState(false),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId();
  const startSection=useRef<HTMLElement>(null),practice=useRef<HTMLDetailsElement>(null),quickstartCode=useRef<HTMLPreElement>(null);
  const [cooperation,setCooperation]=useState<{purpose:string;summary:string;original_cache?:OriginalCacheData|null}|null>(null),[cooperationError,setCooperationError]=useState('');
  const [illustration,setIllustration]=useState<{bookId:string;url:string;alt:string}|null>(null);
  const bookId=book.id??book.book_id,discovery=useSkillDiscovery(),summaryOverride=discovery.data?.books.find(item=>item.book_id===bookId)?.summary_override??book.summary_override;
  const guide=book.guide,beginner=guide?.beginner,repository=httpsLink(book.repository_url),upstream=httpsLink(book.upstream_url)||repository;
  const cache=cooperation?.original_cache??book.original_cache??null;
  const originalUrl=httpsLink(cache?.url)||upstream;
  const reading=httpsLink(guide?.reading_url)||originalUrl,website=httpsLink(book.introduction_url)||httpsLink(guide?.website_url),fork=originalUrl?`${originalUrl.replace(/\/$/,'')}/fork`:null,contribute=httpsLink(guide?.contribution_url);
  const originalAuthor=cache?.original_author??null;
  const guideCredit=guide?.author_name?`${guide.credit_role?'來源標示的'+guide.credit_role:'作者'}：${guide.author_name}`:null;
  const originalStars=typeof cache?.stars==='number'?cache.stars:null;
  const distinctCopy=repository&&originalUrl&&repository!==originalUrl?repository:null;
  useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current.close();},[open]);
  useEffect(()=>{
    if(!open||!bookId)return;
    const controller=new AbortController();let active=true;setCooperation(null);setCooperationError('');
    void fetch(`/api/v1/skills/${encodeURIComponent(bookId)}/collaboration`,{credentials:'omit',signal:controller.signal,headers:{Accept:'application/json'}}).then(async response=>{if(!response.ok)throw new Error('unavailable');const data=await response.json();if(typeof data.purpose!=='string'||typeof data.intent?.summary!=='string')throw new Error('invalid');if(active)setCooperation({purpose:data.purpose,summary:data.intent.summary,original_cache:data.original_cache??null});}).catch(()=>{if(active)setCooperationError('協作說明暫時無法更新，請開啟分享頁查看。');});
    return()=>{active=false;controller.abort();};
  },[open,bookId]);
  useEffect(()=>{
    if(!open||!bookId)return;
    const controller=new AbortController();setIllustration(null);
    // The landscape illustration is supplementary; a missing asset or content leaves the compact cover in place.
    void fetchSkillShareContent(bookId,controller.signal).then(content=>{if(!controller.signal.aborted&&content.illustration_url)setIllustration({bookId,url:content.illustration_url,alt:content.illustration_alt});}).catch(()=>{});
    return()=>controller.abort();
  },[open,bookId]);
  function close(){dialog.current?.close();setOpen(false);trigger.current?.focus();}
  return <><span className="skill-intro-entry"><button ref={trigger} type="button" className="btn btn-ghost skill-intro-trigger" aria-haspopup="dialog" aria-describedby={describedBy} disabled={disabled} onClick={()=>{setVisited(true);setOpen(true);}}>{label}</button>{guildName&&<SkillBookBadges bookId={bookId}/>}</span>
    <dialog ref={dialog} className="skill-intro-dialog" aria-label={visited?undefined:book.title} aria-labelledby={visited?id:undefined} aria-describedby={visited?`${id}-purpose`:undefined} data-book-id={book.id??book.book_id} onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();close();}} onClose={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
      {/* Defer untouched books, then retain their subtree across close/reopen. */}
      {visited&&<div className="stack"><header className="skill-intro-header"><div><div className="eyebrow">{community?'自由工坊 · 社群技能書':'自由工坊 · 公會技能庫'}</div><h2 id={id}>{book.title}</h2></div><button className="btn btn-ghost" type="button" onClick={close} autoFocus aria-label="關閉技能書介紹">關閉</button></header>
        <div className="skill-intro-original-head"><div className="skill-intro-cover-copy"><div className="tag-list">{beginner&&<span className="badge">{beginner.category}</span>}{guide&&<span className="badge">{guide.format}</span>}{guildName&&<span className="badge">{guildName}</span>}{guideCredit&&<span className="badge">{guideCredit}</span>}{originalAuthor&&<span className="badge">原作：{originalAuthor}</span>}{originalStars!==null&&<span className="badge">★ {originalStars}</span>}{cache?.latest_release&&<a className="badge" href={cache.latest_release.html_url} target="_blank" rel="noopener noreferrer">Release {cache.latest_release.tag_name} ↗</a>}</div>
        {open&&<SkillBookBadges bookId={bookId} community={community}/>}</div></div>
        {cache?.ahead_of_pin&&cache.latest_version_url&&<div className="skill-intro-upstream-notice" role="note"><span>原作者有新版本：</span><a href={cache.latest_version_url} target="_blank" rel="noopener noreferrer">{cache.latest_version_label??'查看新版本'} ↗</a></div>}
        <div className="actions skill-intro-primary-actions"><button type="button" className="btn btn-primary" aria-controls={`${id}-start`} onClick={()=>{startSection.current?.scrollIntoView({block:'start'});startSection.current?.focus();}}>開始用</button>{open&&<SkillBookStar book={{...book,original_cache:cache}} compact/>}<SkillShare bookId={bookId} title={book.title} active={open}/>{originalUrl&&<a className="btn btn-ghost" href={originalUrl} target="_blank" rel="noopener noreferrer">查看原作 Repo ↗</a>}</div>
        <section ref={startSection} id={`${id}-start`} tabIndex={-1} className="stack skill-intro-original-start">
          <h3>開始用</h3>
          <p className="skill-intro-purpose multiline-text" id={`${id}-purpose`}>{cache?.description??book.description}</p>
          {cache?.latest_release&&<div className="skill-intro-release"><strong>最新 Release：</strong><a href={cache.latest_release.html_url} target="_blank" rel="noopener noreferrer">{cache.latest_release.name||cache.latest_release.tag_name}（{cache.latest_release.tag_name}）↗</a></div>}
          {cache?.quick_start&&<section className="stack"><h4>原作起步指令（快取）</h4><pre ref={quickstartCode} tabIndex={-1} className="skill-intro-command"><code>{cache.quick_start}</code></pre>{open&&<QuickstartCopy key={cache.quick_start} commands={cache.quick_start} onSelect={()=>{
            const element=quickstartCode.current,selection=window.getSelection();
            if(!element||!selection)return;
            element.focus();const range=document.createRange();range.selectNodeContents(element);selection.removeAllRanges();selection.addRange(range);
          }}/>}</section>}
          {cache?.readme_html?<div className="skill-intro-readme-wrap"><h4>原作 README（快取）</h4><div className="skill-intro-readme" dangerouslySetInnerHTML={{__html:cache.readme_html}}/></div>:<p className="field-hint">目前尚未快取原作 README；請點擊「查看原作 Repo ↗」或展開下方「使用筆記」。</p>}
          {isStorefrontReading(bookId,originalUrl)&&<StorefrontBookUsage onNavigate={close}/>}
          {open&&bookId&&book.source_commit&&/^[0-9a-f]{40}$/.test(book.source_commit)&&<SkillInstall key={bookId} bookId={bookId}/>}
        </section>
        <details ref={practice} id={`${id}-practice`} className="skill-intro-details skill-intro-start skill-intro-usage-notes"><summary>使用筆記{guide?.reviewed_at?`（核對版本 ${guide.source_commit.slice(0,7)} · 核對日期：${guide.reviewed_at}）`:''}</summary><div className="stack">
          <p className="field-hint skill-intro-notes-banner">{guide?`以下導讀、插畫與範例係針對核對版本 ${guide.source_commit}（核對日期：${guide.reviewed_at}）整理的使用筆記，非原作最新程式碼說明。`:'以下為版本紀錄與協作筆記。'}</p>
          <div className="skill-intro-cover"><div className="skill-intro-cover-copy"><p className="skill-intro-purpose multiline-text">{cooperation?.purpose??summaryOverride??beginner?.purpose??guide?.summary??book.description}</p></div>{open&&<SkillBookCover book={book} className="skill-intro-art"/>}</div>
          {open&&illustration&&illustration.bookId===bookId&&<figure className="skill-intro-illustration"><img src={illustration.url} alt={illustration.alt} width="1200" height="630" decoding="async" onError={()=>setIllustration(null)}/></figure>}
          {guide&&<>
            <div className="skill-intro-outcome"><p className="eyebrow">練習目標（筆記）</p><p className="skill-intro-example">{guide.first_result}</p></div>
            <section><h3>準備</h3><ul>{guide.prerequisites.map(item=><li key={item}>{item}</li>)}</ul></section>
            <section><h3>練習</h3><ol>{guide.first_steps.map(step=><li key={step}>{step}</li>)}</ol></section>
            {guide.quickstart&&!cache?.quick_start&&<section className="stack"><h3>核對版本啟動指令</h3><p className="field-hint">{guide.quickstart.context}</p><pre className="skill-intro-command"><code>{guide.quickstart.commands}</code></pre></section>}
            <section><h3>功能與使用範圍</h3><p className="skill-intro-status">{guide.status}</p><p className="muted">{guide.audience.join('、')}</p><ul className="skill-intro-features">{guide.features.map(feature=><li key={feature}>{feature}</li>)}</ul></section>
            <div className="actions">{reading&&<a className="btn btn-ghost" href={reading} target="_blank" rel="noopener noreferrer">閱讀核對版本說明 ↗</a>}{(book.id??book.book_id)&&<a className="btn btn-ghost" href={`/development/skills/${encodeURIComponent((book.id??book.book_id)!)}`} target="_blank" rel="noopener noreferrer">完整頁面 ↗</a>}</div>
          </>}
          {open&&bookId&&<EventOutcomeBacklinks client={client} kind="skill_book" sourceId={bookId} publicRead={!client.csrfToken}/>}
          {open&&<SkillBookStar book={book}/>}
          <div className="stack skill-intro-source">{website&&<a href={website} target="_blank" rel="noopener noreferrer">前往作者網站 ↗</a>}{guide&&/^[0-9a-f]{40}$/.test(guide.source_commit)&&<p className="field-hint">指南閱讀版本：<code>{guide.source_commit.slice(0,12)}</code> · 核對日期：{guide.reviewed_at}</p>}<SkillBookSourceAccount book={book}/>{book.license_status&&<p>{book.license_status==='NOASSERTION'?'來源未明確宣告授權條款；Fork 不代表額外取得作品、素材或程式的使用權。':`來源記錄的程式授權：${book.license_status}。素材與引用內容請另外查看專案說明。`}</p>}{guide&&<><p className="field-hint">介紹核對：{guide.reviewed_at}</p><ul>{guide.source_evidence.map(evidence=>{const url=httpsLink(evidence.url);return url?<li key={evidence.path}><a href={url} target="_blank" rel="noopener noreferrer">{evidence.path} ↗</a></li>:null;})}</ul></>}{book.source_commit&&/^[0-9a-f]{40}$/.test(book.source_commit)&&<p className="field-hint">收錄版本：<code>{book.source_commit.slice(0,12)}</code></p>}{distinctCopy&&<p className="field-hint">歷史紀錄（工坊整合副本）：<a href={distinctCopy} target="_blank" rel="noopener noreferrer">{distinctCopy}</a></p>}</div>
          {bookId&&<AuthorClaimPanel key={bookId} bookId={bookId}/>}
          {bookId&&<section className="skill-intro-collaboration"><h3>一起開發</h3><DevelopmentEntry kind="skill" target={bookId} label="加入共同開發"/><p className="multiline-text">{cooperation?.summary??guide?.contribution??'在專案任務中認領一項修改，完成後提交 PR。'}</p>{cooperationError&&<p className="field-hint">{cooperationError}</p>}<div className="actions"><a className="btn btn-ghost" href={skillSharePath(bookId)} target="_blank" rel="noopener noreferrer">查看里程碑與任務 ↗</a><a className="btn btn-ghost" href={`${skillSharePath(bookId)}/SKILL.md`} target="_blank" rel="noopener noreferrer">交給 Agent ↗</a>{originalUrl&&<a className="btn btn-ghost" href={`${originalUrl}/pulls`} target="_blank" rel="noopener noreferrer">查看原作 PR ↗</a>}{fork&&<a className="btn btn-ghost" href={fork} target="_blank" rel="noopener noreferrer">Fork 原作 ↗</a>}{contribute&&<a className="btn btn-ghost" href={contribute} target="_blank" rel="noopener noreferrer">查看協調任務 ↗</a>}</div><p className="field-hint">修改預設以 PR 回饋原作，由原作維護者審查；保留來源授權與實際作者，Fork 不會自動回饋原作。</p></section>}
        </div></details>

      </div>}
    </dialog>
  </>;
}


// Copy is an explicit, local action, not installation or execution. Mount only
// while the dialog is open so late clipboard results cannot survive reopening.
function QuickstartCopy({commands,onSelect}:{commands:string;onSelect:()=>void}) {
  const [status,setStatus]=useState<'idle'|'pending'|'copied'|'failed'>('idle');
  const mounted=useRef(true),pending=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function copy() {
    if(pending.current)return;
    pending.current=true;setStatus('pending');
    try {
      if(!navigator.clipboard?.writeText)throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(commands);
      if(mounted.current)setStatus('copied');
    } catch {
      if(mounted.current)setStatus('failed');
    } finally {pending.current=false;}
  }
  return <>
    <div className="actions"><button type="button" className="btn btn-ghost btn-small" aria-disabled={status==='pending'} onClick={()=>void copy()}>{status==='pending'?'正在複製…':'複製指令'}</button>{status==='failed'&&<button type="button" className="btn btn-ghost btn-small" onClick={onSelect}>選取指令</button>}</div>
    {status==='copied'&&<p role="status" className="field-hint">指令已複製，尚未執行。</p>}
    {status==='failed'&&<p role="status" className="field-hint">未能複製，請選取指令後使用系統複製，或長按文字手動複製。</p>}
  </>;
}

// Guild books and 社群技能書 share this card; `community` only changes the type label and badge.
export function SkillBookCard({book,className='',access,headingLevel=4,community=false}:{book:IntroBook;className?:string;access?:'unlocked'|'locked';headingLevel?:2|3|4;community?:boolean}) {
  // The title follows the surrounding outline; .skill-library-title keeps one visual size at every level.
  const Title=`h${headingLevel}` as const;
  const beginner=book.guide?.beginner,discovery=useSkillDiscovery(),summaryOverride=discovery.data?.books.find(item=>item.book_id===(book.id??book.book_id))?.summary_override??book.summary_override;
  const cache=book.original_cache??null;
  const cardSummary=cache?.description??summaryOverride??beginner?.purpose??book.description;
  const originalAuthor=cache?.original_author??null;
  const guideCredit=book.guide?.author_name?`${book.guide.credit_role?'來源標示的'+book.guide.credit_role:'作者'}：${book.guide.author_name}`:null;
  return <article className={`card skill-book skill-book-volume skill-library-book ${className}`} data-book-id={book.id??book.book_id} data-access={access}>
    <div className="skill-library-heading"><SkillBookCover book={book}/><div className="skill-library-copy"><p className="eyebrow skill-library-meta"><span>{beginner?.category??(community?'社群技能書':'公會技能書')}</span>{access&&<span className={`skill-unlock-state ${access}`}>{access==='unlocked'?'✓ 已解鎖':'未解鎖'}</span>}{cache?.ahead_of_pin&&<span className="badge">原作者有新版本</span>}</p><Title className="skill-library-title">{book.title}</Title></div></div>
    <div className="skill-library-description"><p className="skill-library-purpose multiline-text">{cardSummary}</p>{book.guide?.first_result&&<div className="skill-library-result"><span>{book.guide.reviewed_at?`使用筆記（${book.guide.reviewed_at}）`:'使用筆記'}</span><p>{book.guide.first_result}</p></div>}{guideCredit&&<p className="field-hint">{guideCredit}</p>}{originalAuthor&&<p className="field-hint">原作帳號：{originalAuthor}{typeof cache?.stars==='number'?` · ★ ${cache.stars}`:''}{cache?.latest_release?` · ${cache.latest_release.tag_name}`:''}</p>}<SkillBookBadges bookId={book.id??book.book_id} community={community}/>{book.license_status==='NOASSERTION'&&<p className="field-hint">授權待確認</p>}</div>
    <div className="skill-library-actions"><SkillBookIntro book={book} label={access==='locked'?'預覽技能書':'閱讀技能書'} community={community}/><SkillShare bookId={book.id??book.book_id} title={book.title}/></div>
    <SkillBookStar book={book} compact/>
  </article>;
}
