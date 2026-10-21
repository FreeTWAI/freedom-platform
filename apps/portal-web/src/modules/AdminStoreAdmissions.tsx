import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {AdminStoreReadinessPageSchema,StoreAdmissionRevokeInputSchema,STORE_READINESS_LABELS,STORE_PAYMENT_LABELS,storeReadinessStateLabel,type AdminStoreReadinessPage} from '../../../../contracts/guild-launchpad/v1/hosted-commerce-setup';
import {DELIVERY_METHOD_LABELS} from '../../../../contracts/guild-launchpad/v1/hosted-shipping';
import {formatIsoLocal} from '../format';
import {AdminClient,AdminRequestError} from './admin-client';
import '../../../../modules/agent-commerce/seller-console/ui/Readiness.css';
import './AdminStoreAdmissions.css';

type Mutate=(path:string,body:unknown,version?:number|null)=>Promise<boolean>;
type Store=AdminStoreReadinessPage['items'][number];
const endpoint='/commerce/store-readiness';
const statusLabel=(status:string)=>({active:'啟用中',suspended:'已暫停',archived:'已封存',failed:'未完成',recovery_required:'等待復原',requested:'準備中',provisioning:'準備中'}[status]??status);

export function AdminStoreAdmissions({client,busy,onMutate}:{client:AdminClient;busy:boolean;onMutate:Mutate}){
 const [data,setData]=useState<AdminStoreReadinessPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[downloading,setDownloading]=useState(false);
 const ticket=useRef(0),alive=useRef(true);
 const load=useCallback(async(offset=0,append=false)=>{
  const serial=++ticket.current;setLoading(true);setError('');
  try{const next=AdminStoreReadinessPageSchema.parse(await client.request(`${endpoint}?limit=25&offset=${offset}`));if(alive.current&&serial===ticket.current)setData(old=>append&&old?{...next,items:[...old.items,...next.items]}:next);}
  catch(cause){if(alive.current&&serial===ticket.current)setError(cause instanceof AdminRequestError&&cause.status===404?'這個環境沒有商店准入功能。':cause instanceof Error?cause.message:'無法取得商店准入資料。');}
  finally{if(alive.current&&serial===ticket.current)setLoading(false);}
 },[client]);
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;ticket.current++;};},[load]);
 async function download(){
  if(downloading||busy)return;setDownloading(true);setNotice('');
  try{
   let first:AdminStoreReadinessPage|null=null,offset=0;
   const items:Store[]=[];
   for(let page=0;page<20;page++){
    const next=AdminStoreReadinessPageSchema.parse(await client.request(`${endpoint}?limit=50&offset=${offset}`));
    if(!alive.current)return;
    first??=next;
    if(next.environment!==first.environment||next.release_sha!==first.release_sha||JSON.stringify(next.platform)!==JSON.stringify(first.platform)||JSON.stringify(next.summary)!==JSON.stringify(first.summary))throw Error('環境或商店範圍已變更，請更新後重新下載。');
    items.push(...next.items);
    if(next.next_offset===null){
     if(items.length!==first.summary.stores||new Set(items.map(item=>item.instance_id)).size!==items.length)throw Error('商店分頁範圍已變更，請更新後重新下載。');
     const generated_at=new Date().toISOString();
     const receipt={schema:'freedom.commerce-scope-receipt/v1',generated_at,environment:first.environment,release_sha:first.release_sha,platform:first.platform,summary:first.summary,items};
     const url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');
     link.href=url;link.download=`commerce-scope-${first.environment}-${generated_at.replace(/[-:]/g,'').replace(/\.\d{3}/,'')}.json`;
     link.click();URL.revokeObjectURL(url);setNotice('已下載範圍收據。');return;
    }
    if(next.next_offset<=offset)throw Error('分頁資料已變更，請更新後重新下載。');
    offset=next.next_offset;
   }
   setNotice('已讀取 20 頁，仍有其他商店；未下載不完整收據，請由平台另行核對完整範圍。');
  }catch(cause){if(alive.current)setNotice(cause instanceof Error?cause.message:'無法下載範圍收據，請稍後再試。');}
  finally{if(alive.current)setDownloading(false);}
 }
 return <section className="stack commerce-readiness admin-store-admissions" aria-label="商店准入"><div className="card-head"><h2>商店准入</h2><div className="actions"><button className="btn btn-ghost" type="button" disabled={busy||loading||downloading} onClick={()=>void load()}>更新</button></div></div>
  <p>准入是開放接單的最後一項條件；其他條件仍由店主在商店後台完成。准入不代替店主的設定或同意，也不會自動到期。</p>
  {error&&<p className="banner banner-error" role="alert">{error}</p>}{loading&&<p role="status">正在讀取商店准入…</p>}{notice&&<p role="status">{notice}</p>}
  {data&&<><div className="card stack"><h3>{data.environment==='sandbox'?'測試環境（sandbox）':'正式環境（live）'}</h3><p>接單開關：{data.platform.checkout_enabled?'開啟':'關閉'} · 隔離狀態：{data.platform.quarantine?'隔離中':'未隔離'}</p><p>平台提供的設定檔：{data.platform.provider_profiles.join('、')||'未提供'}</p><p>共 {data.summary.stores} 間商店 · 有效准入 {data.summary.active_admissions} 間 · 目前可接單 {data.summary.accepting_orders} 間</p><p className="field-hint">資料時間：{formatIsoLocal(data.checked_at)}</p><p className="field-hint">執行版本：{data.release_sha??'未提供'}</p>
   <div className="actions"><button type="button" className="btn btn-ghost" disabled={busy||loading||downloading||!!error} onClick={()=>void download()}>{downloading?'正在產生收據…':'下載範圍收據（JSON）'}</button></div><p className="field-hint">收據含租戶與商店名稱、准入與撤銷理由、識別碼、版本與設定狀態；不含聯絡資料、會員信箱、銀行帳號／戶名或憑證狀態。這是內部管理紀錄，請勿公開分享。</p></div>
   {data.items.map(store=><StoreCard key={store.instance_id} store={store} busy={busy||loading||downloading||!!error} onMutate={onMutate} reload={()=>load()}/>)}
   {!data.items.length&&!error&&!loading&&<p>這個社群目前沒有商店。</p>}
   {data.next_offset!==null&&<div className="actions"><button type="button" className="btn btn-ghost" disabled={busy||loading||downloading} onClick={()=>void load(data.next_offset!,true)}>載入更多商店</button></div>}
  </>}
 </section>;
}

function StoreCard({store,busy,onMutate,reload}:{store:Store;busy:boolean;onMutate:Mutate;reload:()=>Promise<void>}){
 const [form,setForm]=useState(false),[reason,setReason]=useState(''),[error,setError]=useState(''),id=useId(),active=store.admission.active,admission=active??store.admission.last_revoked;
 const label=active?'撤銷准入':'准入',unavailable=!active&&(store.tenant_status!=='active'||store.instance_status!=='active'),disabled=busy||unavailable||store.admin_is_member;
 return <article className="card stack" data-store-instance={store.instance_id}><div className="card-head"><h3>{store.store?.public_path?<a href={store.store.public_path} target="_blank" rel="noopener noreferrer">{store.store.name} ↗</a>:store.store?.name??'尚未設定商店'}</h3><span>{store.readiness.accepting_orders?'目前可接單':'尚未開放接單'}</span></div>
  <p>{store.tenant_display_name} · 事業：{statusLabel(store.tenant_status)} · 商店：{statusLabel(store.instance_status)}</p><p className="field-hint">事業 {store.tenant_id} · 商店 {store.instance_id}</p><p>版本：{store.module_release_ref}</p>
  <ul className="admin-readiness-items">{store.readiness.items.map(item=><li key={item.key}><span>{STORE_READINESS_LABELS[item.key]}</span><span className="badge readiness-state" data-state={item.state}>{storeReadinessStateLabel(item)}</span>{'version' in item&&<span className="field-hint">第 {item.version??'—'} 版</span>}{item.key==='storefront'&&<span className="field-hint">發布版本 {item.revision??'—'}</span>}{item.key==='products'&&<span className="field-hint">發布 {item.published_count}／可售 {item.sellable_count}／自有庫存 {item.own_stock_count}</span>}</li>)}</ul>
  <p>付款：{store.readiness.methods.payment.map(kind=>STORE_PAYMENT_LABELS[kind]).join('／')||'尚未設定'} · 交付：{store.readiness.methods.delivery.map(kind=>DELIVERY_METHOD_LABELS[kind]).join('／')||'尚未設定'}</p>
  <p>准入：{active?'有效':admission?'已撤銷':'尚未准入'}</p>{admission&&<><p>准入時間：{formatIsoLocal(admission.admitted_at)}</p><p>准入理由：{admission.reason}</p>{admission.revoked_at&&<p>撤銷時間：{formatIsoLocal(admission.revoked_at)} · {admission.revoke_reason}</p>}</>}
  {store.admin_is_member&&<p>你是這個業務空間的成員，請由另一位獨立管理員操作。</p>}{unavailable&&<p>事業或商店目前不是啟用狀態。</p>}
  {form?<form className="stack" aria-label={label} onSubmit={async event=>{event.preventDefault();const parsed=StoreAdmissionRevokeInputSchema.safeParse({reason});if(!parsed.success){setError('請填寫 1 到 500 字的理由，不能包含換行或控制字元。');return;}
   if(disabled)return;
   const path=active?`/commerce/store-admissions/${active.admission_id}/revoke`:'/commerce/store-admissions',body=active?parsed.data:{...parsed.data,tenant_id:store.tenant_id,instance_id:store.instance_id};
   if(await onMutate(path,body)){setForm(false);setReason('');setError('');await reload();}
  }}><p>{active?'撤銷後立即停止新訂單；已成立的訂單照常完成。':'准入後，只要其他條件都成立，這間店就能接受新訂單。'}</p><label className="field" htmlFor={id}>操作理由<input id={id} value={reason} maxLength={500} required aria-invalid={!!error} onChange={event=>setReason(event.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className="actions"><button type="submit" className="btn btn-primary" disabled={disabled}>確認{label}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>setForm(false)}>取消</button></div></form>:<div className="actions"><button type="button" className="btn btn-ghost" disabled={disabled} onClick={()=>setForm(true)}>{label}</button></div>}
 </article>;
}
