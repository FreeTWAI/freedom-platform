import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ApiError,type PortalClient} from '../api';
import type {SessionPayload} from '../types';
import {publicSkillPath} from '../../../../packages/shared/skill-acquisition';
import {storefrontReturnPath} from '../../../../modules/agent-commerce/storefront-return';
import {publicDiscoveryPath} from './PublicDiscovery';
import {GOOGLE_ENTRY_KEY,saveGoogleEntry,clearGoogleEntry,navigateToGoogle} from './GoogleAccount';

type GoogleEntry={intent:'login'|'link';entry:string;startedAt:number};
export type GoogleCallbackEntry={intent:'login'|'link';entry:string;state:string|null;code:string|null;cancelled:boolean;invalid:boolean};
type GoogleActivation={activation_required:true;activation:string};
type GoogleProofResult=GoogleActivation|{totp_required:true;challenge:string};
type GoogleLoginResult=(SessionPayload&{registered?:boolean})|{totp_required:true;challenge:string};
class GoogleActivationError extends Error {}

/** The dormant cookie is not a session. ACK once, then read the actual cookie authority. */
export async function activateGoogleLogin(client:Pick<PortalClient,'post'|'getSession'>,proof:GoogleActivation,isCurrent:()=>boolean):Promise<SessionPayload&{registered:boolean}>{
  if(!proof||proof.activation_required!==true||typeof proof.activation!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof.activation))throw new GoogleActivationError('Google 登入確認資料不完整。請返回登入入口重新開始。');
  if(!isCurrent())throw new GoogleActivationError('頁面已變更，這次 Google 驗證不會接續。');
  let acknowledged:SessionPayload&{registered?:boolean};
  // No activation token is stored, logged, exposed in a URL or automatically replayed.
  const activation=proof.activation;proof.activation='';
  try{acknowledged=await client.post<SessionPayload&{registered?:boolean}>('/auth/google/activate',{activation},{skipAuthHandler:true,suppressConsole:true});}
  catch(cause){
    if(isCurrent()&&cause instanceof ApiError&&cause.network){
      // A lost ACK may already have committed. Inspect only; never install an
      // unacknowledged session or retry the consumed activation secret.
      try{await client.getSession()}catch{/* The outcome stays unconfirmed. */}
      throw new GoogleActivationError('尚未確認 Google 登入結果。請返回登入入口確認目前帳號，必要時重新登入；不會重送這次登入確認。');
    }
    throw cause;
  }
  if(!isCurrent())throw new GoogleActivationError('頁面已變更，這次 Google 驗證不會接續。');
  if(!acknowledged?.user?.user_id||!acknowledged.csrf_token)throw new GoogleActivationError('Google 登入確認回應不完整。請返回登入入口確認目前帳號，不會自動重送。');
  const session=await client.getSession();
  if(!isCurrent())throw new GoogleActivationError('頁面已變更，這次 Google 驗證不會接續。');
  if(!session?.user||session.user.user_id!==acknowledged.user.user_id||session.csrf_token!==acknowledged.csrf_token)throw new GoogleActivationError('目前登入的帳號或登入狀態已變更。請返回登入入口重新確認；這次 Google 回應不會取代目前的帳號。');
  return {...session,registered:acknowledged.registered===true};
}

/** Presentation continuity only. Never persist code, state, challenge or a session. */
export function safeGoogleEntry(value:unknown):string|null{
  if(typeof value!=='string'||value.length>2000||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020]/.test(value))return null;
  let url:URL;try{url=new URL(value,window.location.origin)}catch{return null;}
  if(url.origin!==window.location.origin||url.pathname+url.search+url.hash!==value)return null;
  if(!/^(?:\/|\/device|\/events\/[0-9a-f-]{36}\/?|\/member-cards\/[A-Za-z0-9_-]{43}\/?)$/.test(url.pathname))return null;
  if(url.hash&&!/^#(?:[a-z][a-z0-9-]*|join\/(?:supplier|showcase|tasks)|guilds\/[a-z0-9_-]+|events\/[0-9a-f-]{36})$/.test(url.hash))return null;
  const allowed=new Set(['join','return_to','skill_acquisition','skill_intro','post_return','social-post']);
  for(const [key,item] of url.searchParams){
    if(!allowed.has(key)||url.searchParams.getAll(key).length!==1)return null;
    if((key==='join'||key==='skill_acquisition')&&item!=='1')return null;
    if(key==='skill_intro'&&!/^(?:[1-9][0-9]?|100)$/.test(item))return null;
    if((key==='post_return'||key==='social-post')&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item))return null;
    if(key==='return_to'&&!publicDiscoveryPath(item)&&!storefrontReturnPath(item)&&!publicSkillPath(item))return null;
  }
  return value;
}

export function rememberGoogleEntry(intent:GoogleEntry['intent']){
  const entry=safeGoogleEntry(window.location.pathname+window.location.search+window.location.hash)??(intent==='link'?'/#account':'/');
  // If storage is disabled, stop before starting a flow we cannot safely resume.
  saveGoogleEntry(intent,entry);
}

/** Called once at module startup, before LoginView takes its return/fence snapshots. */
export function captureGoogleCallback():GoogleCallbackEntry|null{
  if(window.location.pathname!=='/google/callback')return null;
  const parameters=new URLSearchParams(window.location.search);
  // Remove ALL callback parameters immediately, including provider error text.
  window.history.replaceState(null,'','/google/callback');
  let saved:GoogleEntry|null=null;
  try{
    const value=JSON.parse(sessionStorage.getItem(GOOGLE_ENTRY_KEY)??'null');
    if(value&&(value.intent==='login'||value.intent==='link')&&safeGoogleEntry(value.entry)&&Number.isFinite(value.startedAt)&&Date.now()-value.startedAt>=0&&Date.now()-value.startedAt<15*60_000)saved=value;
  }catch{/* Missing continuity cannot authorize an OAuth completion. */}
  clearGoogleEntry();
  const state=parameters.getAll('state').length===1?parameters.get('state'):null;
  const code=parameters.getAll('code').length===1?parameters.get('code'):null;
  const cancelled=parameters.get('error')==='access_denied';
  const entry=saved?.entry??'/';
  window.history.replaceState(null,'',entry);
  return {intent:saved?.intent??'login',entry,state,code,cancelled,invalid:!saved||!state||state.length>1024||Boolean(code&&code.length>4096)||(!cancelled&&(parameters.has('error')||!code))};
}

function googleError(cause:unknown):string{
  if(cause instanceof GoogleActivationError)return cause.message;
  if(cause instanceof ApiError){
    if(cause.accessExpired)return cause.message;
    if(cause.status===429)return '嘗試次數過多，請稍後重新開始。';
    if(cause.code==='google_link_existing_account'||cause.code==='google_link_conflict')return '請先用原本的 Email 和密碼登入，再到「我的名片」明確連結 Google。非 Gmail／Workspace 信箱也請使用這個方式。';
    if(cause.network)return '尚未確認 Google 操作結果。請返回登入入口確認帳號狀態，再重新開始；不會自動重送。';
  }
  return '這次 Google 驗證未完成或已失效。請返回原入口重新開始；原本的 Email 與密碼登入仍可使用。';
}

export function GoogleSignIn({client,disabled=false}:{client:PortalClient;disabled?:boolean}){
  const [enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const live=useRef(false),locked=useRef(false);
  useEffect(()=>{live.current=true;void client.get<{enabled:boolean}>('/auth/google/config',{skipAuthHandler:true,suppressConsole:true}).then(value=>{if(live.current)setEnabled(value.enabled===true)}).catch(()=>{});return()=>{live.current=false}},[client]);
  async function start(){
    if(disabled||locked.current)return;locked.current=true;setBusy(true);setError('');
    try{rememberGoogleEntry('login');const result=await client.post<{url:string}>('/auth/google/start',{}, {skipAuthHandler:true,suppressConsole:true});if(live.current)navigateToGoogle(result.url);else clearGoogleEntry();}
    catch(cause){clearGoogleEntry();if(live.current)setError(googleError(cause));}
    finally{locked.current=false;if(live.current)setBusy(false);}
  }
  if(!enabled)return null;
  return <div className="stack google-sign-in">
    <div className="actions"><button type="button" className="btn btn-secondary btn-small" style={{minHeight:44}} disabled={disabled||busy} aria-busy={busy} onClick={()=>void start()}>{busy?'正在前往 Google…':'使用 Google 繼續'}</button></div>
    <p className="field-hint">新帳號限 Gmail 或 Google Workspace。已有工坊帳號請先用原登入方式進入「我的名片」連結，不會依同名信箱自動合併，也不匯入 Google 頭像或顯示名稱。</p>
    {error&&<p role="alert" className="banner banner-error">{error}</p>}
  </div>;
}

export function GoogleCallback({client,entry,onLoggedIn}:{client:PortalClient;entry:GoogleCallbackEntry;onLoggedIn?:(session:SessionPayload,registered:boolean)=>Promise<void>}){
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[challenge,setChallenge]=useState<string|null>(null),[code,setCode]=useState('');
  const operation=useRef<Promise<GoogleLoginResult|{linked:true}|{cancelled:true}>|null>(null),live=useRef(false),epoch=useRef(0),locked=useRef(false),input=useRef<HTMLInputElement>(null);
  const completed=useRef(onLoggedIn);completed.current=onLoggedIn;
  const entryUrl=useRef(window.location.href),invalidated=useRef(false);
  const current=()=>live.current&&!invalidated.current&&window.location.href===entryUrl.current;
  async function finish(result:GoogleLoginResult|{linked:true}|{cancelled:true}){
    if(!current())return;
    if('cancelled' in result){setNotice('已取消這次 Google 授權。原有的登入與連結狀態不受影響。');setBusy(false);return;}
    if('linked' in result){window.location.replace(entry.entry);return;}
    if('totp_required' in result){
      if(typeof result.challenge!=='string'||!result.challenge)throw Error('Invalid challenge');
      setChallenge(result.challenge);setBusy(false);requestAnimationFrame(()=>input.current?.focus());return;
    }
    if(!result.user||!result.csrf_token)throw Error('Invalid session');
    await completed.current?.(result,result.registered===true);
  }
  useEffect(()=>{
    live.current=true;let active=true;
    const moved=()=>{invalidated.current=true;epoch.current++;setChallenge(null);setCode('');setBusy(false);setError('頁面已變更，這次 Google 驗證不會接續。請返回登入入口重新開始。');};
    window.addEventListener('hashchange',moved);window.addEventListener('popstate',moved);
    if(!operation.current){
      operation.current=(async()=>{
        if(entry.invalid)throw Error('Invalid callback');
        const state=entry.state,authorizationCode=entry.code;entry.code=null;
        if(entry.intent==='link'){
          const session=await client.getSession();if(!current())throw Error('Entry changed');client.csrfToken=session.csrf_token;
          if(entry.cancelled)return client.post<{cancelled:true}>('/me/google/cancel',{state},{skipAuthHandler:true,suppressConsole:true});
          return client.post<{linked:true}>('/me/google/complete',{state,code:authorizationCode},{skipAuthHandler:true,suppressConsole:true});
        }
        if(entry.cancelled)return client.post<{cancelled:true}>('/auth/google/cancel',{state},{skipAuthHandler:true,suppressConsole:true});
        const proof=await client.post<GoogleProofResult>('/auth/google/complete',{state,code:authorizationCode},{skipAuthHandler:true,suppressConsole:true});
        if('totp_required' in proof&&proof.totp_required===true)return proof;
        return activateGoogleLogin(client,proof as GoogleActivation,current);
      })();
    }
    void operation.current.then(result=>{if(active)return finish(result)}).catch(cause=>{if(active&&current()){setError(googleError(cause));setBusy(false)}});
    return()=>{active=false;live.current=false;epoch.current++;window.removeEventListener('hashchange',moved);window.removeEventListener('popstate',moved);};
  },[client,entry]);
  async function verify(event:FormEvent){
    event.preventDefault();if(!challenge||locked.current||!current())return;
    const generation=epoch.current;locked.current=true;setBusy(true);setError('');let factorAccepted=false;
    try{
      const proof=await client.post<GoogleActivation>('/auth/google/totp',{challenge,code:code.trim()},{skipAuthHandler:true,suppressConsole:true});
      if(generation!==epoch.current||!current())return;factorAccepted=true;setChallenge(null);setCode('');
      const result=await activateGoogleLogin(client,proof,()=>generation===epoch.current&&current());await finish(result);
    }
    catch(cause){if(generation===epoch.current&&current()){setError(!factorAccepted&&cause instanceof ApiError&&cause.status===401&&!cause.accessExpired?'驗證器代碼或備用碼不正確，或驗證已逾時。請確認後再試。':googleError(cause));setCode('');if(!factorAccepted)requestAnimationFrame(()=>input.current?.focus());}}
    finally{locked.current=false;if(current())setBusy(false);}
  }
  async function cancel(){
    if(locked.current||busy)return;locked.current=true;setBusy(true);setError('');
    try{await client.post('/auth/google/cancel',{state:entry.state},{skipAuthHandler:true,suppressConsole:true});if(current()){setChallenge(null);setCode('');setNotice('已取消 Google 登入。')}}
    catch(cause){if(current())setError(googleError(cause));}
    finally{locked.current=false;if(current())setBusy(false);}
  }
  return <section className="stack" aria-label={entry.intent==='link'?'連結 Google':'完成 Google 登入'}>
    <h1>{entry.intent==='link'?'連結 Google':'完成 Google 登入'}</h1>
    {busy&&<p role="status">正在確認 Google 驗證…</p>}
    {error&&<p role="alert" className="banner banner-error">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
    {challenge&&<form className="stack" onSubmit={event=>void verify(event)}>
      <label className="field">驗證器代碼或備用碼<input ref={input} style={{fontSize:16}} type="text" autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} required maxLength={64} value={code} onChange={event=>setCode(event.target.value)} disabled={busy} aria-describedby="google-totp-hint"/></label>
      <p id="google-totp-hint" className="field-hint">此帳號已啟用雙因素驗證。Google 驗證不能取代這一步；備用碼每組只能使用一次。</p>
      <div className="actions"><button className="btn btn-primary btn-small" style={{minHeight:44}} disabled={busy} aria-busy={busy}>完成登入</button><button type="button" className="btn btn-ghost btn-small" style={{minHeight:44}} disabled={busy} onClick={()=>void cancel()}>取消 Google 登入</button></div>
    </form>}
    {!busy&&!challenge&&<a className="btn btn-ghost btn-small" style={{minHeight:44}} href={entry.entry}>{entry.intent==='link'?'返回我的名片':'返回登入入口'}</a>}
  </section>;
}
