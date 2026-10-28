import {useEffect,useRef,useState,type FormEvent} from 'react';
import {AdminRequestError,type AdminClient} from './admin-client';
import {CertificationReviewAckSchema,CertificationQueueSchema,CERTIFICATION_DESCRIPTION,certificationCommandRejected,certificationStateLabels,type CertificationSettings} from '../../../../packages/shared/community-certification';
import './AdminCommunityCertification.css';
type Item=CertificationSettings&{user_id:string;display_name:string};
type Page={items:Item[];next_offset:number|null};
type Pending={id:string;body:{decision:string;reason:string;confirmed:true};version:number;key:string;everUnknown?:boolean};
export function AdminCommunityCertification({client,registerLeave}:{client:AdminClient;registerLeave?:(guard:()=>boolean)=>()=>void}){
 const [page,setPage]=useState<Page|null>(null),[filter,setFilter]=useState('pending'),[offset,setOffset]=useState(0),[selected,setSelected]=useState<Item|null>(null),[decision,setDecision]=useState('approve'),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false),[refresh,setRefresh]=useState(0);
 const epoch=useRef(0),lock=useRef(false),pending=useRef<Pending|null>(null);
 useEffect(()=>registerLeave?.(()=>!pending.current),[registerLeave]);
 useEffect(()=>{const unload=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[]);
 useEffect(()=>{
  const e=++epoch.current,csrf=client.csrf;setPage(null);setSelected(null);setReason('');setConfirmed(false);setError('');setBusy(true);lock.current=true;
  void client.request<Page>(`/community-certifications?state=${filter}&offset=${offset}&limit=25`).then(value=>{const parsed=CertificationQueueSchema.parse(value);if(epoch.current===e&&client.csrf===csrf)setPage(parsed);}).catch(cause=>{if(epoch.current===e&&client.csrf===csrf)setError(cause instanceof Error?cause.message:'無法讀取審核清單。');}).finally(()=>{if(epoch.current===e){lock.current=false;setBusy(false);}});
  return()=>{++epoch.current;lock.current=false;};
 },[client,filter,offset,refresh]);
 async function send(operation:Pending){
  if(lock.current)return;const e=epoch.current,csrf=client.csrf;lock.current=true;pending.current=operation;setBusy(true);setError('');setNotice('');
  try{
   CertificationReviewAckSchema.parse(await client.request<unknown>(`/community-certifications/${operation.id}/review`,operation.body,{version:operation.version,key:operation.key}));
   if(epoch.current===e&&client.csrf===csrf){pending.current=null;setUncertain(false);setNotice('審核已保存；正在重新讀取目前狀態。');setRefresh(n=>n+1);}
  }catch(cause){if(epoch.current===e){if(client.csrf===csrf){setError(cause instanceof Error?cause.message:'尚未確認審核結果。');const terminal=cause instanceof AdminRequestError&&certificationCommandRejected(cause.status,cause.definitiveResponse&&!cause.accessExpired,operation.everUnknown);if(terminal){pending.current=null;setSelected(null);}if(!terminal)operation.everUnknown=true;setUncertain(!terminal);}else{setPage(null);setSelected(null);setError('管理員身分已失效，請重新登入。');}}}
  finally{if(epoch.current===e){lock.current=false;setBusy(false);}}
 }
 function submit(event:FormEvent){event.preventDefault();if(selected&&confirmed&&!uncertain)void send({id:selected.user_id,body:{decision,reason,confirmed:true},version:selected.aggregate_version,key:crypto.randomUUID()});}
 return <section className="community-certification-panel stack" aria-labelledby="admin-certification-title"><h2 id="admin-certification-title">社群認證審核</h2><p>{CERTIFICATION_DESCRIPTION} 不得以申請、信箱驗證、貢獻稱號或職稱自動核發。</p><p>審核需要目前的 Access 管理權限，並登入同一驗證信箱的會員帳號；不能審核自己。<a href="/#account">前往會員帳號設定</a></p>
  <label className="field">審核狀態<select value={filter} disabled={busy||uncertain} onChange={e=>{setOffset(0);setFilter(e.target.value);setNotice('');}}>{['pending','active','rejected','revoked','withdrawn','all'].map(state=><option key={state} value={state}>{state==='all'?'全部':certificationStateLabels[state as keyof typeof certificationStateLabels]}</option>)}</select></label>
  <button className="btn btn-ghost" disabled={busy||uncertain} onClick={()=>setRefresh(n=>n+1)}>重新確認審核清單</button>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{busy&&<p role="status">處理中…</p>}
  {page?.items.length===0&&<p>目前沒有這個狀態的申請。</p>}
  <div className="community-certification-queue">{page?.items.map(item=><article className="card stack" key={item.user_id}><h3>{item.display_name}</h3><p>{certificationStateLabels[item.state]} · 版本 {item.aggregate_version}</p><blockquote>{item.statement}</blockquote>
   {selected?.user_id!==item.user_id&&['pending','active'].includes(item.state)&&<button className="btn btn-ghost" disabled={busy||uncertain} onClick={()=>{setSelected(item);setDecision(item.state==='active'?'revoke':'approve');setReason('');setConfirmed(false);}}>審核這筆申請</button>}
   {selected?.user_id===item.user_id&&<form className="stack" onSubmit={submit}><fieldset disabled={busy||uncertain} className="stack"><legend>人工審核決定</legend><label className="field">決定<select value={decision} onChange={e=>{setDecision(e.target.value);setConfirmed(false);}}>{item.state==='pending'?<><option value="approve">核准社群認證</option><option value="reject">不核准申請</option></>:<option value="revoke">撤銷社群認證</option>}</select></label><label className="field">私人稽核理由<textarea required minLength={3} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><p>理由只進管理稽核，不公開，也不放進申請人的展示資料。</p><label className="checkbox-row"><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已人工檢視此申請，確認上述決定；這不代表實名查驗。</label><div className="actions"><button className="btn btn-primary" disabled={!confirmed}>確認保存審核</button><button type="button" className="btn btn-ghost" onClick={()=>setSelected(null)}>取消</button></div></fieldset></form>}
  </article>)}</div>
  {page&&<div className="actions"><button className="btn btn-ghost" disabled={busy||uncertain||offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>上一頁</button><button className="btn btn-ghost" disabled={busy||uncertain||page.next_offset===null} onClick={()=>page.next_offset!==null&&setOffset(page.next_offset)}>下一頁</button></div>}
  {uncertain&&<div className="stack"><p>結果尚未確認。請使用同一筆操作識別碼重試；讀取清單不能確認這筆操作是否完成，不要另做第二次授予。</p><button className="btn btn-ghost" disabled={busy} onClick={()=>pending.current&&void send(pending.current)}>重試同一筆審核</button></div>}
 </section>;
}
