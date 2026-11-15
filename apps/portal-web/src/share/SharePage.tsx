import {useEffect,useRef,useState} from 'react';
import {ApiError,type PortalClient} from '../api';
import {useGitHubSocialStore} from '../modules/GitHubSocial';
import {ShareButton,type ShareLink} from './ShareButton';
import './share.css';
const STAR_UNRECORDABLE_CODES=new Set(['github_permission_required','github_not_configured','github_installation_required','github_repository_unavailable','repository_identity_changed']);
function isStarUnrecordable(cause:unknown):boolean{
  return cause instanceof ApiError&&(cause.status===403||(typeof cause.code==='string'&&STAR_UNRECORDABLE_CODES.has(cause.code)));
}
type Page={share_id:string;ref_id?:string|null;title:string;kind:string;canonical_url:string;sharers:{display_name:string;role:string}[];repository:null|{full_name:string;url:string;description:string|null;license_spdx:string|null;homepage:string|null;topics:string[];pushed_at:string|null;forks_count:number|null;open_issues_count:number|null;subscribers_count:number|null;readme_html:string;quick_start:string;stars:number|null;original_author:string;latest_release:{name:string;tag_name:string;html_url:string}|null;fetched_at:string|null}};
function shareFallbackUrl(page:Page):string{
  if(page.kind==='repository'||page.kind==='link')return `/s/${page.share_id}`;
  if(page.kind==='event'&&page.ref_id)return `/events/${page.ref_id}`;
  if(page.kind==='post'&&page.ref_id)return `/?social-post=${page.ref_id}#social`;
  if(page.kind==='service'&&page.ref_id)return `/services/${page.ref_id}`;
  return `/#shares/${page.share_id}`;
}
export function SharePage({client,id,via}:{client:PortalClient;id:string;via?:string}){
  const [page,setPage]=useState<Page|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[starred,setStarred]=useState(false),[starBlocked,setStarBlocked]=useState(false);
  const [statement,setStatement]=useState(''),[reason,setReason]=useState(''),[notice,setNotice]=useState('');
  const claimKey=useRef(crypto.randomUUID()),reportKey=useRef(crypto.randomUUID());
  const store=useGitHubSocialStore(),generation=client.sessionGeneration,live=useRef(true),starKey=useRef(crypto.randomUUID());
  useEffect(()=>{live.current=true;setPage(null);setError('');setNotice('');setStarred(false);setStarBlocked(false);starKey.current=crypto.randomUUID();void client.get<Page>(`/shares/${id}`).then(p=>{if(live.current&&generation===client.sessionGeneration)setPage(p);},e=>{if(live.current){const notFound=(e instanceof ApiError&&(e.status===404||e.code==='not_found'))||(e as Error)?.message==='找不到分享。';setError(notFound?'找不到分享':((e as Error)?.message||'載入失敗'));}});void store.loadAccount();return()=>{live.current=false;};},[id]);
  async function star(){setBusy(true);setError('');const wasConnected=Boolean(store.account.value?.connected);try{if(!wasConnected){window.location.assign(await store.connect(window.location.hash));return;}await client.post(`/shares/${id}/star`,via?{via}:{},{idempotencyKey:starKey.current});if(live.current&&generation===client.sessionGeneration)setStarred(true);}catch(e){if(live.current){if(isStarUnrecordable(e))setStarBlocked(true);else if(wasConnected&&e instanceof ApiError&&(e.code==='github_connect_required'||e.code==='github_reconnect_required'))void store.loadAccount(true);setError((e as Error).message);}}finally{if(live.current)setBusy(false);}}
  async function claim(){setBusy(true);setError('');try{const r=await client.post<{state:string}>(`/shares/${id}/claim`,{statement},{idempotencyKey:claimKey.current});if(live.current&&generation===client.sessionGeneration)setNotice(r.state==='verified'?'作者已驗證':'作者認領待審核');}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setBusy(false);}}
  async function report(){setBusy(true);setError('');try{await client.post(`/shares/${id}/report`,{reason},{idempotencyKey:reportKey.current});if(live.current&&generation===client.sessionGeneration)setNotice('檢舉已送出');}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setBusy(false);}}
  if(!page){
    if(error)return <article className="share-page stack"><p role="alert">{error}</p><div className="share-actions"><a className="btn btn-primary" href="#home">回到動態</a></div></article>;
    return <p role="status">載入中…</p>;
  }
  const repo=page.repository;
  let site='';
  if(!repo&&page.kind==='link'){try{site=new URL(page.canonical_url).hostname;}catch{}}
  const facts=repo?[repo.license_spdx?`授權：${repo.license_spdx}`:null,repo.pushed_at?`更新：${repo.pushed_at.slice(0,10)}`:null,
    repo.forks_count!=null?`Fork：${repo.forks_count}`:null,repo.open_issues_count!=null?`Issues：${repo.open_issues_count}`:null,repo.subscribers_count!=null?`Watchers：${repo.subscribers_count}`:null].filter(Boolean):[];
  const canStar=Boolean(repo&&store.account.value?.configured&&!starBlocked);
  return <article className="share-page stack">
    <header><h2>{page.title}</h2>{site&&<p className="muted share-site">{site}</p>}</header>
    <div className="share-actions">
      {repo&&(canStar?<button className="btn btn-primary" disabled={busy||starred} onClick={()=>void star()}>{starred?'★ 已加星':store.account.value?.connected?'☆ 加星':'連結 GitHub 加星'}</button>:<a className="btn btn-secondary btn-small" href={repo.url} target="_blank" rel="noopener noreferrer">在 GitHub 查看</a>)}
      <ShareButton title={page.title} fallbackUrl={shareFallbackUrl(page)} makeLink={()=>client.post<ShareLink>(`/shares/${page.share_id}/links`,{},{idempotencyKey:crypto.randomUUID()})} label="我也要分享" buttonClassName="btn btn-secondary btn-small"/>
      <a className="btn btn-secondary btn-small" href="#me/credit">我的貢獻</a>
      {!repo&&<a className="btn btn-secondary btn-small" href={page.canonical_url}>開啟內容</a>}
    </div>
    {repo?.description&&<p className="share-description">{repo.description}</p>}
    {repo&&(facts.length>0||repo.homepage)&&<p className="share-facts muted">{facts.join(' · ')}{repo.homepage&&<>{facts.length>0?' · ':''}<a href={repo.homepage} target="_blank" rel="noopener noreferrer">網站</a></>}</p>}
    {repo?.topics?.length?<div className="share-chips share-topics">{repo.topics.slice(0,5).map(topic=><span className="pill" key={topic}>{topic}</span>)}</div>:null}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {repo&&<>
      <p>{repo.stars!==null&&<>GitHub 星數：{repo.stars} · </>}原作帳號：<a href={`https://github.com/${encodeURIComponent(repo.original_author)}`} rel="noopener noreferrer" target="_blank">{repo.original_author}</a></p>
      <section><h3>開始用</h3><pre>{repo.quick_start}</pre></section>
      <section><h3>README</h3><div className="share-readme" dangerouslySetInnerHTML={{__html:repo.readme_html}}/></section>
      {repo.latest_release&&<section><h3>最新版本</h3><a href={repo.latest_release.html_url} target="_blank" rel="noopener noreferrer">{repo.latest_release.name||repo.latest_release.tag_name}</a></section>}
    </>}
    <details><summary>更多</summary>
      {repo&&store.account.value?.connected&&<form onSubmit={e=>{e.preventDefault();void claim();}}><label>作者聲明<textarea minLength={10} maxLength={1000} required value={statement} disabled={busy} onChange={e=>{setStatement(e.target.value);claimKey.current=crypto.randomUUID();}}/></label><button className="btn btn-secondary btn-small" disabled={busy}>認領作者</button></form>}
      <form onSubmit={e=>{e.preventDefault();void report();}}><label>檢舉原因<textarea maxLength={500} required value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);reportKey.current=crypto.randomUUID();}}/></label><button className="btn btn-secondary btn-small" disabled={busy}>送出檢舉</button></form>
    </details>
    <p>{page.sharers.map(s=>`${s.role==='original_author'?'已認領作者':'分享者'} ${s.display_name}`).join(' · ')}</p>
  </article>;
}
