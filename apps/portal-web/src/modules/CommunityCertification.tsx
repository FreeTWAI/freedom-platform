import {CommunityCertificationBadge} from './CommunityCertificationBadge';
export {CommunityCertificationBadge} from './CommunityCertificationBadge';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ApiError,type PortalClient} from '../api';
import {CertificationSettingsSchema,CERTIFICATION_DESCRIPTION,certificationCommandRejected,certificationStateLabels,certificationBadge,type CertificationSettings} from '../../../../packages/shared/community-certification';
import './CommunityCertification.css';
type Pending={action:'apply'|'withdraw'|'display';body:unknown;version:number;key:string;everUnknown?:boolean};
export function CommunityCertificationPanel({client,registerLeave}:{client:PortalClient;registerLeave?:(guard:()=>boolean)=>()=>void}){
 const [value,setValue]=useState<CertificationSettings|null>(null),[statement,setStatement]=useState(''),[ack,setAck]=useState(false),[display,setDisplay]=useState(false),[confirmWithdraw,setConfirmWithdraw]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false);
 const owner=useRef(client.sessionGeneration),epoch=useRef(0),sequence=useRef(0),lock=useRef(false),pending=useRef<Pending|null>(null);
 const uncertainRef=useRef(false);uncertainRef.current=uncertain;
 useEffect(()=>registerLeave?.(()=>!pending.current&&!uncertainRef.current),[registerLeave]);
 useEffect(()=>{const unload=(event:BeforeUnloadEvent)=>{if(pending.current||uncertainRef.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[]);
 const current=(e:number,s:number)=>epoch.current===e&&sequence.current===s&&client.sessionGeneration===owner.current;
 function apply(v:CertificationSettings){setValue(v);setDisplay(v.show_community_certification);setStatement(v.statement);setAck(false);setConfirmWithdraw(false);}
 async function load(){
  if(lock.current||client.sessionGeneration!==owner.current)return;
  const e=epoch.current,s=++sequence.current;lock.current=true;setBusy(true);setError('');setValue(null);
  try{const v=CertificationSettingsSchema.parse(await client.get<unknown>('/me/community-certification'));if(current(e,s)){apply(v);}}
  catch(cause){if(current(e,s))setError(cause instanceof Error?cause.message:'無法讀取社群認證，請重試。');}
  finally{if(current(e,s)){lock.current=false;setBusy(false);}}
 }
 useEffect(()=>{owner.current=client.sessionGeneration;const e=++epoch.current;void load();return()=>{if(epoch.current===e){++epoch.current;++sequence.current;lock.current=false;}};},[client]);
 async function send(operation:Pending){
  if(lock.current||client.sessionGeneration!==owner.current)return;
  const e=epoch.current,s=++sequence.current;lock.current=true;pending.current=operation;setBusy(true);setError('');setNotice('');
  try{
   const v=CertificationSettingsSchema.parse(await client.post<unknown>(`/me/community-certification/${operation.action}`,operation.body,{ifMatch:operation.version,idempotencyKey:operation.key}));
   if(current(e,s)){apply(v);pending.current=null;setUncertain(false);setNotice(operation.action==='apply'?'申請已送出，須由管理員人工審核；目前沒有藍勾。':operation.action==='withdraw'?'已撤回，其他會員不再看到認證標記。':'認證展示偏好已保存。');window.dispatchEvent(new Event('freedom-profile-updated'));}
  }catch(cause){if(current(e,s)){setError(cause instanceof Error?cause.message:'無法確認操作結果。');const terminal=cause instanceof ApiError&&certificationCommandRejected(cause.status,cause.definitiveResponse&&!cause.network&&!cause.accessExpired,operation.everUnknown);if(terminal){pending.current=null;setValue(null);}if(!terminal)operation.everUnknown=true;setUncertain(!terminal);}}
  finally{if(current(e,s)){lock.current=false;setBusy(false);}}
 }
 function mutate(action:Pending['action'],body:unknown){if(value&&!uncertain)void send({action,body,version:value.aggregate_version,key:crypto.randomUUID()});}
 function submit(event:FormEvent){event.preventDefault();mutate('apply',{statement,acknowledged:ack});}
 const badge=value&&certificationBadge(value.state,true),canApply=value&&['unrequested','rejected','revoked','withdrawn'].includes(value.state);
 return <section className="card stack community-certification-panel" aria-labelledby="community-certification-title">
  <h3 id="community-certification-title">社群認證（藍勾）</h3><p>{CERTIFICATION_DESCRIPTION} 不會增加管理權限、排名或收益，與成果稱號無關。</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <button type="button" className="btn btn-ghost" disabled={busy||uncertain} onClick={()=>void load()}>重新確認目前狀態</button>
  {!value&&!error&&<p role="status">載入認證狀態…</p>}
  {value&&<><p>目前狀態：<strong>{certificationStateLabels[value.state]}</strong></p>{badge&&<CommunityCertificationBadge badge={badge}/>}
   <fieldset disabled={busy||uncertain} className="stack"><legend>本人展示偏好</legend><label className="checkbox-row"><input type="checkbox" checked={display} onChange={e=>setDisplay(e.target.checked)}/>向可閱讀我個人空間的同社群登入會員顯示認證</label><p>預設不顯示。只有審核通過且尚未撤銷才會出現藍勾；匿名公開頁、分享圖與搜尋不顯示。</p><button type="button" className="btn btn-ghost" disabled={display===value.show_community_certification} onClick={()=>mutate('display',{show_community_certification:display})}>保存展示偏好</button></fieldset>
   {canApply&&<form className="stack" onSubmit={submit}><fieldset disabled={busy||uncertain} className="stack"><legend>提出社群認證申請</legend><label className="field">社群參與說明<textarea minLength={10} maxLength={1000} required rows={4} value={statement} onChange={e=>setStatement(e.target.value)} aria-describedby="certification-application-hint"/></label><p id="certification-application-hint">請說明你的社群參與，供管理員人工審查。10–1000 字；不要提交證件、地址、付款或其他敏感資料。內容只供本人與管理員查看。</p><label className="checkbox-row"><input type="checkbox" required checked={ack} onChange={e=>setAck(e.target.checked)}/>我了解這不是實名查驗，申請不保證核准，認證可被撤銷。</label><button className="btn btn-primary" disabled={!ack}>送出人工審核申請</button></fieldset></form>}
   {['pending','active'].includes(value.state)&&<div className="stack">{!confirmWithdraw?<button type="button" className="btn btn-ghost" disabled={busy||uncertain} onClick={()=>setConfirmWithdraw(true)}>{value.state==='active'?'撤回我的社群認證':'撤回申請'}</button>:<><p>確定撤回？現有藍勾會停止展示；之後重新申請仍須人工審核。</p><div className="actions"><button type="button" className="btn btn-ghost" disabled={busy||uncertain} onClick={()=>mutate('withdraw',{confirmed:true})}>確認撤回</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>setConfirmWithdraw(false)}>取消</button></div></>}</div>}
  </>}
  {uncertain&&<div className="stack"><p>結果還沒確認，請按下方按鈕重試這筆操作；系統會保留原本的內容，不會另送一筆。</p><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>pending.current&&void send(pending.current)}>重試同一筆操作</button></div>}
 </section>;
}
