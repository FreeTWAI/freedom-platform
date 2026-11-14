import {useEffect,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {useGitHubSocialStore} from '../modules/GitHubSocial';
import './share.css';
type Page={share_id:string;title:string;kind:string;canonical_url:string;sharers:{display_name:string;role:string}[];repository:null|{full_name:string;url:string;description:string;readme_html:string;quick_start:string;stars:number|null;original_author:string;latest_release:{name:string;tag_name:string;html_url:string}|null;fetched_at:string|null}};
export function SharePage({client,id,via}:{client:PortalClient;id:string;via?:string}){
  const [page,setPage]=useState<Page|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[starred,setStarred]=useState(false),[link,setLink]=useState('');
  const [statement,setStatement]=useState(''),[reason,setReason]=useState(''),[notice,setNotice]=useState('');
  const claimKey=useRef(crypto.randomUUID()),reportKey=useRef(crypto.randomUUID());
  const store=useGitHubSocialStore(),generation=client.sessionGeneration,live=useRef(true),starKey=useRef(crypto.randomUUID());
  useEffect(()=>{live.current=true;setPage(null);setError('');void client.get<Page>(`/shares/${id}`).then(p=>{if(live.current&&generation===client.sessionGeneration)setPage(p);},e=>{if(live.current)setError(e.message);});void store.loadAccount();return()=>{live.current=false;};},[id]);
  async function star(){setBusy(true);setError('');try{if(!store.account.value?.connected){window.location.assign(await store.connect(window.location.hash));return;}await client.post(`/shares/${id}/star`,via?{via}:{},{idempotencyKey:starKey.current});if(live.current&&generation===client.sessionGeneration)setStarred(true);}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setBusy(false);}}
  async function share(){setBusy(true);setError('');try{const r=await client.post<{path:string}>(`/shares/${id}/links`,{},{idempotencyKey:crypto.randomUUID()});if(live.current&&generation===client.sessionGeneration){setLink(location.origin+r.path);await navigator.clipboard?.writeText(location.origin+r.path);}}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setBusy(false);}}
  async function claim(){setBusy(true);setError('');try{const r=await client.post<{state:string}>(`/shares/${id}/claim`,{statement},{idempotencyKey:claimKey.current});if(live.current&&generation===client.sessionGeneration)setNotice(r.state==='verified'?'作者已驗證':'作者認領待審核');}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setBusy(false);}}
  async function report(){setBusy(true);setError('');try{await client.post(`/shares/${id}/report`,{reason},{idempotencyKey:reportKey.current});if(live.current&&generation===client.sessionGeneration)setNotice('檢舉已送出');}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setBusy(false);}}
  if(!page)return <p role={error?'alert':'status'}>{error||'載入中…'}</p>;
  const repo=page.repository;
  return <article className="share-page stack">
    <header><h2>{page.title}</h2>{repo&&<p>{repo.description}</p>}</header>
    <div className="share-actions">
      {repo&&(store.account.value?.configured?<button className="btn btn-primary" disabled={busy||starred} onClick={()=>void star()}>{starred?'★ 已加星':store.account.value.connected?'☆ 加星':'連結 GitHub 加星'}</button>:<a className="btn btn-primary" href={repo.url} target="_blank" rel="noopener noreferrer">☆ GitHub 加星</a>)}
      {['repository','link'].includes(page.kind)&&<button className="btn btn-secondary btn-small" disabled={busy} onClick={()=>void share()}>我也要分享</button>}
      <a className="btn btn-secondary btn-small" href="#me/credit">我的貢獻</a>
      {!repo&&<a className="btn btn-secondary btn-small" href={page.canonical_url}>開啟內容</a>}
    </div>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{link&&<p role="status">已複製 <a href={link}>{link}</a></p>}
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
