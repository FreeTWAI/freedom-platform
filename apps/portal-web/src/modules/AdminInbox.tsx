import {useEffect,useState} from 'react';
import {AdminRequestError,type AdminClient} from './admin-client';
import {pendingLabels,type AdminTab,type PendingKind} from './admin-places';
type Row={id:string;kind:PendingKind;title:string;at:string|null};
type Page={items:Record<string,any>[];next_offset?:number|null};
export function AdminInbox({client,filter,certifications,attention=false,stores=true,tools=true,onOpen,onFilter,onHistory}:{client:AdminClient;filter:AdminTab;certifications:boolean;attention?:boolean;stores?:boolean;tools?:boolean;onOpen:(kind:AdminTab,id:string)=>void;onFilter:(kind:AdminTab)=>void;onHistory:(kind:AdminTab)=>void}){
 const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width: 600px)').matches);
 useEffect(()=>{const media=window.matchMedia('(max-width: 600px)'),changed=()=>{setMobile(media.matches);setPage(0);};media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
 const [rows,setRows]=useState<Row[]>([]),[available,setAvailable]=useState<PendingKind[]>([]),[errors,setErrors]=useState<string[]>([]),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0),[page,setPage]=useState(0);
 useEffect(()=>{let alive=true;setLoading(true);setRows([]);setAvailable([]);setErrors([]);
  const sources:{kind:PendingKind;path:string;map:(r:Record<string,any>)=>Row|null}[]=[
   {kind:'guild-applications',path:'/guild-applications?state=pending',map:r=>({kind:'guild-applications',id:r.application_id,title:r.name,at:r.created_at})},
   ...(certifications?[{kind:'community-certifications' as const,path:'/community-certifications?state=pending',map:(r:Record<string,any>)=>({kind:'community-certifications' as const,id:r.user_id,title:r.display_name,at:r.submitted_at??null})}]:[]),
   {kind:'author-claims',path:'/author-claims?queue=review',map:r=>({kind:'author-claims',id:r.claim_id,title:r.repo.full_name,at:r.submitted_at})},
   {kind:'organizer-claims',path:'/event-organizer-claims?state=pending',map:r=>r.state==='pending'?{kind:'organizer-claims',id:r.claim_id,title:r.title??r.statement,at:r.created_at}:null},
   {kind:'held-shares',path:'/shares/held',map:r=>({kind:'held-shares',id:r.share_id,title:r.title,at:r.hidden_at})},
   {kind:'store-admissions',path:'/commerce/store-readiness',map:r=>!r.admission.active&&r.instance_status==='active'&&r.tenant_status==='active'&&!r.admin_is_member?{kind:'store-admissions',id:r.instance_id,title:r.store?.name??r.tenant_display_name,at:r.admission.last_revoked?.revoked_at??r.created_at??null}:null},
   {kind:'tool-reports',path:'/guild-tools?reported=true',map:r=>r.report_count>0?{kind:'tool-reports',id:r.id,title:r.title,at:r.first_reported_at}:null},
   {kind:'events',path:'/events',map:r=>({kind:'events',id:r.event_id,title:r.title,at:r.created_at})},
   ...['awaiting_review','in_review','needs_decision'].map(queue=>({kind:'review-center' as const,path:`/review-center/pulls?queue=${queue}`,map:(r:Record<string,any>)=>({kind:'review-center' as const,id:r.pull_id,title:r.title,at:r.created_at??r.opened_at??null})})),
  ];
  void Promise.all(sources.filter(source=>(stores||source.kind!=='store-admissions')&&(tools||source.kind!=='tool-reports')).map(async source=>{
   const collected:Row[]=[];let offset=0;
   try{for(let n=0;n<100;n++){
    const value=await client.request<Page>(`${source.path}${source.path.includes('?')?'&':'?'}limit=50&offset=${offset}`);
    if(!Array.isArray(value.items))throw Error('清單格式不完整');
    for(const item of value.items){const row=source.map(item);if(row)collected.push(row);}
    if(value.next_offset==null)return {kind:source.kind,rows:collected};
    if(value.next_offset<=offset)throw Error('清單分頁未前進');offset=value.next_offset;
   }throw Error('清單超過讀取上限');}
   catch(error){if(error instanceof AdminRequestError&&error.status===404)return null;return {kind:source.kind,rows:[] as Row[],error:`${pendingLabels[source.kind]}：${error instanceof Error?error.message:'無法讀取'}`};}
  })).then(results=>{if(!alive)return;const loaded=results.filter(r=>r!==null);setAvailable([...new Set(loaded.map(r=>r.kind))]);setErrors(loaded.flatMap(r=>r.error?[r.error]:[]));
   const unique=new Map(loaded.flatMap(r=>r.rows).map(r=>[`${r.kind}:${r.id}`,r]));setRows([...unique.values()].sort((a,b)=>(a.at?Date.parse(a.at):Infinity)-(b.at?Date.parse(b.at):Infinity)||`${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)));setLoading(false);
  });return()=>{alive=false;};
 },[client,certifications,stores,tools,refresh]);
 useEffect(()=>setPage(0),[filter]);
 const size=mobile?Math.max(1,3-Number(attention)-Number(errors.length>0)):20;
 const shown=rows.filter(row=>filter==='inbox'||row.kind===filter),slice=shown.slice(page*size,(page+1)*size);
 return <section className="stack" aria-label="待處理清單"><h2>待處理</h2><label className="field">種類<select aria-label="種類" value={available.includes(filter as PendingKind)?filter:'inbox'} onChange={e=>onFilter(e.target.value as AdminTab)}><option value="inbox">全部</option>{available.map(kind=><option key={kind} value={kind}>{pendingLabels[kind]}</option>)}</select></label>
  {loading&&<p role="status">正在讀取待處理項目…</p>}{errors.map(error=><p key={error} role="alert">{error}</p>)}{!!errors.length&&<button className="btn btn-ghost btn-small" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>重新讀取</button>}
  <ul className="admin-place-list">{slice.map(row=><li key={`${row.kind}:${row.id}`}><button className="admin-object-link" onClick={()=>onOpen(row.kind,row.id)}><span><strong>{row.title}</strong><small>{pendingLabels[row.kind]}</small></span>{row.at&&<time dateTime={row.at}>{new Date(row.at).toLocaleDateString('zh-TW')}</time>}</button></li>)}</ul>
  {!loading&&!shown.length&&!errors.length&&<p>目前沒有待處理項目。</p>}
  <div className="actions">{page>0&&<button className="btn btn-ghost btn-small" onClick={()=>setPage(page-1)}>上一頁</button>}{(page+1)*size<shown.length&&<button className="btn btn-ghost btn-small" onClick={()=>setPage(page+1)}>下一頁</button>}</div>
  <details><summary>紀錄與設定</summary><div className="stack"><label className="field">工作區<select aria-label="工作區" defaultValue="" onChange={e=>{if(e.target.value)onHistory(e.target.value as AdminTab);}}><option value="">請選擇</option>{available.map(kind=><option key={kind} value={kind}>{pendingLabels[kind]}</option>)}</select></label><button className="btn btn-ghost btn-small" disabled={loading} onClick={()=>setRefresh(n=>n+1)}>重新整理</button></div></details>
 </section>;
}
