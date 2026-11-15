import {createContext,useContext,useEffect,useId,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {PortalClient} from '../api';
import type {SessionPayload} from '../types';
import {GitHubSocialStore} from './github-social-client';

const SocialContext=createContext<GitHubSocialStore|null>(null);
export const SkillBookStarGateContext=createContext(false);
export const InsideMoreContext=createContext(false);
export const HideExternalStarContext=createContext(false);
const publicStore=new GitHubSocialStore(new PortalClient(),false);
export function GitHubSocialProvider({client,session,children,starGateEnabled=false}:{client:PortalClient;session:SessionPayload;children:ReactNode;starGateEnabled?:boolean}){
  const store=useMemo(()=>new GitHubSocialStore(client,true),[client,session.user.user_id,session.csrf_token]);
  useEffect(()=>{const refresh=()=>void store.refreshConnection();window.addEventListener('freedom-github-updated',refresh);return()=>window.removeEventListener('freedom-github-updated',refresh);},[store]);
  return <SocialContext.Provider value={store}><SkillBookStarGateContext.Provider value={starGateEnabled}>{children}</SkillBookStarGateContext.Provider></SocialContext.Provider>;
}
/** Member pages read the same connection store; subscribing keeps them in sync with the card. */
export function useGitHubSocialStore(){
  const store=useContext(SocialContext)??publicStore;
  useSyncExternalStore(store.subscribe,store.snapshot,store.snapshot);
  return store;
}
export function GitHubConnectionPanel(){
  const store=useContext(SocialContext)??publicStore;
  useSyncExternalStore(store.subscribe,store.snapshot,store.snapshot);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[remoteRemaining,setRemoteRemaining]=useState(false);
  useEffect(()=>{void store.loadAccount();},[store]);
  if(!store.member)return null;
  const {value,loading}=store.account;
  if(!error&&!store.account.error&&(!value||(!value.connected&&!value.configured)))return null;
  async function connect(){setBusy(true);setError('');setNotice('');try{window.location.assign(await store.connect(window.location.hash||'#account'));}catch(cause){setError(cause instanceof Error?cause.message:'無法連結 GitHub，請重試。');setBusy(false);}}
  async function disconnect(){
    setBusy(true);setError('');setNotice('');
    try{const result=await store.disconnect(),remaining=result.provider_revoked!==true;setRemoteRemaining(remaining);setNotice(remaining?'已解除工坊連結；可到 GitHub 設定撤銷授權。':'已解除 GitHub 連結。');}
    catch(cause){setError(cause instanceof Error?cause.message:'解除連結結果待確認，請重新讀取。');}
    finally{setBusy(false);}
  }
  return <section className="card stack github-connection-panel"><h2>GitHub 連結</h2>
    {value?.connected?<><p>已連結 <strong>@{value.github_user?.login??'GitHub'}</strong></p><button className="btn btn-ghost" disabled={busy||loading} onClick={()=>void disconnect()}>{busy?'正在處理…':'解除 GitHub 連結'}</button></>:value?.configured?<><p className="muted">連結後，可直接在技能書上為原作者專案加星。</p><button className="btn btn-ghost" disabled={busy||loading} onClick={()=>void connect()}>{busy?'前往 GitHub…':'連結 GitHub'}</button></>:null}
    {(error||store.account.error)&&<div className="banner banner-error" role="alert">{error||store.account.error}<button className="btn btn-ghost" disabled={busy||loading} onClick={()=>{setError('');void store.refreshConnection();}}>重新讀取 GitHub 連結</button></div>}
    {notice&&<p role="status">{notice}{remoteRemaining&&<> <a href="https://github.com/settings/apps/authorizations" target="_blank" rel="noopener noreferrer">GitHub 授權設定 ↗</a></>}</p>}
  </section>;
}
/** Compact shelf entry: one connect action, no disconnect; connecting never stars anything. */
export function GitHubConnectionSummary({returnTo,onManage}:{returnTo:string;onManage?:()=>void}){
  const store=useContext(SocialContext)??publicStore;
  useSyncExternalStore(store.subscribe,store.snapshot,store.snapshot);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{void store.loadAccount();},[store]);
  if(!store.member)return null;
  const {value,loading}=store.account,failure=error||store.account.error;
  if(!failure&&(!value||(!value.connected&&!value.configured)))return null;
  async function connect(){setBusy(true);setError('');try{window.location.assign(await store.connect(returnTo));}catch(cause){setError(cause instanceof Error?cause.message:'無法連結 GitHub，請重試。');setBusy(false);}}
  return <section className="github-connection-summary" aria-label="GitHub 連結">
    {failure?<><p role="alert">{failure}</p><button className="btn btn-ghost" disabled={busy||loading} onClick={()=>{setError('');void store.refreshConnection();}}>重新讀取 GitHub 連結</button></>
      :value?.connected?<><p>GitHub 已連結 <strong>@{value.github_user?.login??'GitHub'}</strong>，可直接在書上為原作加星。</p>{onManage&&<button className="btn btn-ghost" onClick={onManage}>管理 GitHub 連結</button>}</>
      :<><p>連結 GitHub 後，可在每本技能書直接為原作加星；連結本身不會替你加星。</p><button className="btn btn-secondary" disabled={busy||loading} onClick={()=>void connect()}>{busy?'前往 GitHub…':'連結 GitHub'}</button></>}
  </section>;
}
export function GitHubForkIcon(){return <svg className="github-fork-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="6" cy="5" r="2.3"/><circle cx="18" cy="5" r="2.3"/><circle cx="12" cy="19" r="2.3"/><path d="M6 7.5v2.8c0 2.8 6 1.2 6 5.3v1.1M18 7.5v2.8c0 2.8-6 1.2-6 5.3"/></svg>;}
/** The compact Star／Fork row for a work without workshop metrics: plain links to GitHub, no counts. */
export function GitHubSourceLinks({repositoryUrl}:{repositoryUrl:string}){
  return <div className="github-book-social github-book-social-compact" aria-label="原作者 GitHub 操作">
    <div className="github-social-overview"><div className="github-social-actions">
      <a className="btn btn-ghost github-star-control" href={repositoryUrl} target="_blank" rel="noopener noreferrer" aria-label="前往 GitHub 加星 ↗" title="前往原作 GitHub 加星"><span className="github-star-icon" aria-hidden="true">☆</span><span className="github-star-count">加星</span></a>
      <a className="github-fork-link github-count-control" href={`${repositoryUrl}/fork`} target="_blank" rel="noopener noreferrer" aria-label="複製專案 ↗" title="複製專案"><GitHubForkIcon/><span className="github-fork-count">複製專案</span></a>
    </div></div>
  </div>;
}
function maybeCount(value:number|null|undefined){return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('zh-TW'):null;}
function count(value:number|null|undefined){return maybeCount(value)??'—';}
function maybeDate(value:string|null|undefined){return value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleDateString('zh-TW'):null;}
function date(value:string|null|undefined){return maybeDate(value)??'—';}

export type OriginalSocialMetadata={fetched_at?:string|null;stale?:boolean;full_name?:string|null;url:string|null;original_author:string|null;stars:number|null;social_metrics?:{forks_count:number|null;open_issues_count:number|null;subscribers_count:number|null;pushed_at:string|null}};
export function GitHubBookSocial({bookId,repositoryUrl,compact=false,returnTo,sourceCredit=false,originalCache}:{bookId:string;repositoryUrl:string;compact?:boolean;returnTo?:string;sourceCredit?:boolean;originalCache?:OriginalSocialMetadata}){
  const store=useContext(SocialContext)??publicStore;
  const insideMore=useContext(InsideMoreContext);
  const hideExternalStar=useContext(HideExternalStarContext);
  const starCountId=useId();
  useSyncExternalStore(store.subscribe,store.snapshot,store.snapshot);
  const ref=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[connecting,setConnecting]=useState(false),[connectError,setConnectError]=useState('');
  const metrics=store.metric(bookId),star=store.star(bookId),account=store.account;
  const live=originalCache?.full_name?originalCache:undefined;
  useEffect(()=>{
    const node=ref.current;if(!node)return;
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(item=>item.isIntersecting)){setVisible(true);observer.disconnect();}});
    observer.observe(node);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{if(visible){if(!live)void store.loadMetrics(bookId);void store.loadAccount();}},[store,bookId,visible,live]);
  useEffect(()=>{if(visible&&account.value?.connected)void store.loadStar(bookId);},[store,bookId,visible,account.value]);
  const value=live?{...live.social_metrics,stargazers_count:live.stars,stale:live.stale??false,error:null,archived:false,checked_at:live.fetched_at??null,language:null}:metrics.value,connected=account.value?.connected===true&&star.value?.connected!==false,known=typeof star.value?.starred==='boolean';
  const old=Boolean(value?.stale||value?.error||metrics.error),unknown=!value||value.error&&!value.checked_at;
  async function connect(){
    setConnecting(true);setConnectError('');
    try{window.location.assign(await store.connect(returnTo??(window.location.hash||'#skills')));}
    catch(cause){setConnectError(cause instanceof Error?cause.message:'無法連結 GitHub，請重試。');setConnecting(false);}
  }
  const starText=maybeCount(value?.stargazers_count),forkText=maybeCount(value?.forks_count),checkedDate=maybeDate(value?.checked_at);
  const secondaryMetrics=<><div><dt>待處理問題／變更</dt><dd>{count(value?.open_issues_count)}</dd></div><div><dt>追蹤專案</dt><dd><a className="github-watch-link" href={repositoryUrl} target="_blank" rel="noopener noreferrer" aria-label="追蹤專案通知 ↗" title="前往 GitHub，選擇通知">{count(value?.subscribers_count)}</a></dd></div><div><dt>最近更新</dt><dd>{date(value?.pushed_at)}</dd></div></>;
  const noteLead=metrics.loading&&!value?'正在讀取 GitHub 數據…':unknown?'GitHub 數據暫時無法讀取':checkedDate?`${old?'上次取得的數據':'數據更新'} · ${checkedDate}`:'';
  const noteText=[noteLead,value?.language||''].filter(Boolean).join(' · ');
  const metricsNote=noteText?<p className="github-metrics-note">{noteText}</p>:null;
  const source=(!live||live.original_author)&&<div className="github-social-source"><a href={repositoryUrl} target="_blank" rel="noopener noreferrer">{sourceCredit?'原作':'原作者'} GitHub ↗</a><a href={new URL(repositoryUrl).origin+'/'+new URL(repositoryUrl).pathname.split('/')[1]} target="_blank" rel="noopener noreferrer">追蹤{sourceCredit?'來源帳號':'原作者'} ↗</a>{value?.archived&&<span className="badge">已封存</span>}</div>;
  const accountLoading=account.loading&&!account.value;
  const starEnabled=Boolean(account.error||account.value?.configured);
  const actionLabel=!store.member?'登入後加星':accountLoading?'確認 GitHub 連結…':account.error?'重新確認 GitHub 連結':!account.value?.configured?'':!connected?connecting?'前往 GitHub…':'連結 GitHub 後加星':star.saving?'正在保存…':!known?'加星狀態待確認':star.value?.starred?'取消加星':'加星';
  const actionHint=store.member&&account.value?.configured&&!connected&&!connecting&&!account.error?'連結 GitHub，回來後再點星星。':actionLabel;
  const disabled=account.error?false:Boolean(accountLoading||!account.value?.configured||connecting||connected&&(star.loading||star.saving||!known));
  const starIcon=connected&&known&&star.value?.starred?'★':'☆';
  const starContents=<><span className="github-star-icon" aria-hidden="true">{starIcon}</span>{starText!==null&&<span className="github-star-count" id={starCountId}>{starText}</span>}</>;
  const forkContents=<><GitHubForkIcon/>{forkText!==null&&<span className="github-fork-count">{forkText}</span>}</>;
  function starAction(){if(account.error)void store.loadAccount(true);else if(!connected)void connect();else if(known&&!star.loading&&!star.saving)void store.toggleStar(bookId);}
  const actionStatus=accountLoading||connecting||connected&&(!known||star.saving)?actionLabel:null;
  const expandedDetails=(!live||live.original_author)&&<div className="github-metrics-expanded">{source}{(!live||live.social_metrics)&&<dl className="github-book-metrics">{secondaryMetrics}</dl>}{(!live||live.social_metrics)&&!unknown&&!old&&metricsNote}</div>;
  return <div className={`github-book-social${compact?' github-book-social-compact':''}`} ref={ref} data-github-book={bookId} aria-label={`${sourceCredit?'原作':'原作者'} GitHub 數據與操作`}>
    {!compact&&source}
    <div className="github-social-overview"><div className="github-social-actions">
      {!store.member?<a className="btn btn-ghost github-star-control" href={repositoryUrl} target="_blank" rel="noopener noreferrer" aria-label="前往 GitHub 加星 ↗" aria-describedby={starText!==null?starCountId:undefined} title="前往原作 GitHub 加星">{starContents}</a>:starEnabled&&<button className="btn btn-ghost skill-book-star github-star-control" aria-label={actionLabel} aria-description={actionHint} aria-describedby={starText!==null?starCountId:undefined} title={starText!==null?`${actionHint} · ${starText} 次加星`:actionHint} aria-pressed={connected&&known?star.value!.starred!:undefined} aria-busy={star.saving||connecting||accountLoading} disabled={disabled} onClick={starAction}>{starContents}</button>}
      <a className="github-fork-link github-count-control" href={`${repositoryUrl}/fork`} target="_blank" rel="noopener noreferrer" aria-label="複製專案 ↗" title={forkText!==null?`複製專案 · ${forkText} 次複製`:'複製專案'}>{forkContents}</a>
      {!live&&(metrics.error||value?.error)&&<button className="github-retry" onClick={()=>void store.loadMetrics(bookId,true)} disabled={metrics.loading}>重讀數據</button>}
      {connected&&star.error&&<button className="github-retry" onClick={()=>void store.loadStar(bookId,true)} disabled={star.loading||star.saving}>重讀加星狀態</button>}
      {Boolean(account.value?.configured)&&star.reauthorize&&<button type="button" className="btn btn-ghost btn-small" disabled={connecting||star.loading||star.saving} onClick={()=>void connect()}>連結／重新授權 GitHub</button>}
    </div>
    {compact&&expandedDetails&&(insideMore?expandedDetails:<details className="github-metrics-details"><summary aria-label="更多 GitHub 數據">更多</summary>{expandedDetails}</details>)}
    </div>
    {!compact&&(!live||live.social_metrics)&&<dl className="github-book-metrics">{secondaryMetrics}</dl>}
    {(!live||live.social_metrics)&&(!compact||unknown||old)&&metricsNote}
    {actionStatus&&<p className="github-action-status" role={star.saving||connecting?'status':undefined}>{actionStatus}</p>}
    {(connectError||account.error||star.error)&&<p className="github-social-error" role="alert">{connectError||account.error||star.error}</p>}
    {store.member&&!hideExternalStar&&(star.error||account.error)&&<a className="github-retry" href={repositoryUrl} target="_blank" rel="noopener noreferrer">前往 GitHub 加星 ↗</a>}
  </div>;
}
