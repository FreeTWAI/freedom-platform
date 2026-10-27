import {useEffect,useRef,useState,type FormEvent} from 'react';

export const GOOGLE_ENTRY_KEY='freedom-google-entry-v1';
export type GoogleUiClient={
  readonly sessionGeneration:number;
  get<T>(path:string,options?:{skipAuthHandler?:boolean;suppressConsole?:boolean}):Promise<T>;
  post<T>(path:string,body:unknown,options?:{skipAuthHandler?:boolean;suppressConsole?:boolean}):Promise<T>;
};
export function saveGoogleEntry(intent:'login'|'link',entry:string){
  sessionStorage.setItem(GOOGLE_ENTRY_KEY,JSON.stringify({intent,entry,startedAt:Date.now()}));
}
export function clearGoogleEntry(){try{sessionStorage.removeItem(GOOGLE_ENTRY_KEY)}catch{/* Presentation state only. */}}
export function navigateToGoogle(value:string){
  let url:URL;try{url=new URL(value)}catch{throw Error('Google 登入入口無法確認，請稍後再試。')}
  if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||url.username||url.password||url.hash)throw Error('Google 登入入口無法確認，請稍後再試。');
  window.location.assign(url.href);
}

type GoogleStatus={linked:boolean;enabled:boolean;identity_id:string|null};
export function GoogleAccount({client,hasPassword}:{client:GoogleUiClient;hasPassword:boolean}){
  const [status,setStatus]=useState<GoogleStatus|null>(null),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const live=useRef(false),locked=useRef(false),revision=useRef(0);
  const generation=client.sessionGeneration;
  useEffect(()=>{
    live.current=true;const current=++revision.current;setStatus(null);setPassword('');setError('');setNotice('');
    void client.get<GoogleStatus>('/me/google',{suppressConsole:true}).then(value=>{if(live.current&&current===revision.current&&generation===client.sessionGeneration)setStatus(value)}).catch(()=>{/* New entry stays hidden unless enabled or a saved link is confirmed. */});
    return()=>{live.current=false;revision.current++;};
  },[client,generation]);
  async function submit(event:FormEvent){
    event.preventDefault();if(locked.current||!status||!hasPassword)return;
    const current=revision.current,auth=client.sessionGeneration;const isCurrent=()=>live.current&&current===revision.current&&auth===client.sessionGeneration;
    locked.current=true;setBusy(true);setError('');setNotice('');
    try{
      if(status.linked){
        if(!status.identity_id)throw Error('Missing current identity');
        await client.post('/me/google/unlink',{password,identity_id:status.identity_id},{skipAuthHandler:true,suppressConsole:true});
        if(!isCurrent())return;
        const fresh=await client.get<GoogleStatus>('/me/google',{suppressConsole:true});
        if(isCurrent()){setStatus(fresh);setNotice(fresh.linked?'Google 連結已再次變更，以下顯示目前狀態。':'Google 已解除連結，仍可使用工坊 Email 和密碼登入。');}
      }else{
        saveGoogleEntry('link','/#account');
        const result=await client.post<{url:string}>('/me/google/start',{password},{skipAuthHandler:true,suppressConsole:true});
        if(isCurrent())navigateToGoogle(result.url);
      }
    }catch{clearGoogleEntry();if(isCurrent())setError('操作尚未確認。請檢查目前密碼與登入狀態，再重新開啟我的名片確認連結結果。');}
    finally{locked.current=false;if(isCurrent()){setPassword('');setBusy(false);}}
  }
  if(!status||!status.linked&&!status.enabled)return null;
  return <section className="card stack google-account" aria-labelledby="google-account-heading">
    <h3 id="google-account-heading">Google 登入</h3>
    <p>{status.linked?'已連結 Google。':'尚未連結 Google。'}不會自動合併帳號，也不匯入 Google 頭像或顯示名稱。</p>
    {!status.enabled&&status.linked&&<p className="field-hint">Google 登入目前未開放；仍可設定工坊密碼或解除既有連結。</p>}
    {!hasPassword?<p className="field-hint">請先使用下方的「設定工坊密碼」驗證帳號信箱，再管理 Google 連結。Google 密碼不適用。</p>:<form className="stack" onSubmit={event=>void submit(event)}>
      <label className="field">目前工坊密碼<input type="password" style={{fontSize:16}} autoComplete="current-password" required maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/></label>
      <p className="field-hint">{status.linked?'解除後只能使用工坊 Email 和密碼登入。此操作不會刪除帳號或其他資料。':'只連結你在 Google 授權頁親自選擇的帳號；請確認它是你想用來登入的帳號。'}</p>
      <div className="actions"><button className="btn btn-secondary btn-small" style={{minHeight:44}} disabled={busy} aria-busy={busy}>{busy?'處理中…':status.linked?'解除 Google 連結':'連結 Google 帳號'}</button></div>
    </form>}
    {error&&<p role="alert" className="banner banner-error">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
