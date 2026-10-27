import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import type {PortalClient} from '../api';
import {PasswordSetup} from './PasswordSetup';

// Keep normal 401 handling: a committed operation with a lost response revokes
// this session, so its retry must clear the current local member shell.
export function submitAccountDeactivation(client:PortalClient,password:string,version:number){
  return client.post('/me/account/deactivate',{password},{ifMatch:version});
}

export function AccountDeactivation({client,version,disabled=false}:{client:PortalClient;version?:number;disabled?:boolean}){
  const [loadedVersion,setLoadedVersion]=useState<number|null>(null),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [passwordless,setPasswordless]=useState<{email:string}|null>(null);
  const hint=useId(),mounted=useRef(false);
  useEffect(()=>{
    mounted.current=true;let active=true;const generation=client.sessionGeneration;setPassword('');setPasswordless(null);setLoadedVersion(null);setError('');setBusy(false);
    if(version===undefined)void client.get<{aggregate_version:number;has_password?:boolean;login_email:string}>('/me/account').then(account=>{
      if(active&&mounted.current&&generation===client.sessionGeneration){setLoadedVersion(account.aggregate_version);if(account.has_password===false)setPasswordless({email:account.login_email});}
    }).catch(failure=>{if(active&&mounted.current&&generation===client.sessionGeneration)setError(failure instanceof Error?failure.message:'無法讀取帳號，請重新開啟。');});
    return()=>{active=false;mounted.current=false;};
  },[client,version,client.sessionGeneration]);
  async function submit(event:FormEvent){
    event.preventDefault();const expected=version??loadedVersion;if(expected===null||busy||disabled)return;
    const generation=client.sessionGeneration;setBusy(true);setError('');
    try{
      await submitAccountDeactivation(client,password,expected);
      if(!mounted.current||generation!==client.sessionGeneration)return;
      client.csrfToken=null;window.location.reload();
    }catch(failure){
      if(mounted.current&&generation===client.sessionGeneration){setError(failure instanceof Error?failure.message:'暫時無法停用，請稍後再試。');setBusy(false);}
    }finally{if(mounted.current&&generation===client.sessionGeneration)setPassword('');}
  }
  if(version===undefined&&loadedVersion===null&&!passwordless)return <section className="card stack" aria-label="停用帳號"><h3>停用帳號</h3>{error?<p role="alert">{error}</p>:<p role="status">正在確認帳號的密碼設定…</p>}</section>;
  if(passwordless)return <PasswordSetup client={client} email={passwordless.email}/>;
  return <form className="card stack" onSubmit={submit} aria-label="停用帳號">
    <h3>停用帳號</h3><p id={hint}>停用後會登出所有裝置，且無法再登入。這不是資料刪除：訂單、稽核與相關歷史資料會保留，不提供自行重新啟用。</p>
    <label className="field">目前密碼<input type="password" autoComplete="current-password" required maxLength={200} aria-describedby={hint} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy||disabled}/></label>
    {error&&<p role="alert">{error}</p>}
    <div className="experience-actions"><button className="btn btn-ghost" type="submit" disabled={busy||disabled||(version??loadedVersion)===null}>{busy?'停用中…':'確認停用帳號並登出所有裝置'}</button></div>
  </form>;
}
