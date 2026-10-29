import {useEffect,useRef,useState} from 'react';
import type {GoogleUiClient} from './GoogleAccount';

/** Mailbox recovery establishes a real password; Google is not a password bypass. */
export function PasswordSetup({client,email}:{client:GoogleUiClient;email:string}){
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const live=useRef(false),locked=useRef(false),lifecycle=useRef(0);const generation=client.sessionGeneration;
  useEffect(()=>{
    live.current=true;lifecycle.current++;locked.current=false;setBusy(false);setNotice('');setError('');
    return()=>{live.current=false;lifecycle.current++;locked.current=false};
  },[client,generation,email]);
  async function request(){
    if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');const auth=client.sessionGeneration,epoch=lifecycle.current;
    const current=()=>live.current&&auth===client.sessionGeneration&&epoch===lifecycle.current;
    try{await client.post('/auth/reset/request',{email},{skipAuthHandler:true,suppressConsole:true});if(current())setNotice('若此信箱有可用帳號，且寄送服務正常，請在 30 分鐘內查看重設連結，使用它設定真正的工坊密碼。');}
    catch{if(current())setError('設定密碼的郵件尚未確認送達。請稍後重試，或回登入頁使用「忘記密碼」。');}
    finally{if(current()){locked.current=false;setBusy(false);}}
  }
  return <section className="card stack password-setup" aria-labelledby="password-setup-heading">
    <h3 id="password-setup-heading">設定工坊密碼</h3>
    <p>你的帳號尚未設定工坊密碼。請透過帳號信箱 {email} 的重設連結設定真正的密碼，不是輸入 Google 密碼。</p>
    <p className="field-hint">設定後才能變更登入 Email、管理雙因素驗證、解除 Google 連結或停用帳號。郵件連結會驗證信箱，既有重設與雙因素驗證規則不變；不會以 Google 授權取代這些操作的密碼確認。</p>
    <div className="actions"><button type="button" className="btn btn-secondary btn-small" style={{minHeight:44}} disabled={busy} aria-busy={busy} onClick={()=>void request()}>{busy?'寄送中…':'寄送設定密碼連結'}</button></div>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="banner banner-error">{error}</p>}
  </section>;
}
