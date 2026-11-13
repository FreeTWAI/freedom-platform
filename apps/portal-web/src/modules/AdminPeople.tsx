import {useEffect,useState,type FormEvent} from 'react';
import type {AdminClient} from './admin-client';
import type {AdminTab} from './admin-places';
type Result={id:string;view:AdminTab;name:string;kind:string};
export function AdminPeople({client,onOpen,onManage}:{client:AdminClient;onOpen:(view:AdminTab,id:string)=>void;onManage:(view:AdminTab)=>void}){
 const [query,setQuery]=useState(''),[term,setTerm]=useState(''),[includeTest,setIncludeTest]=useState(false),[rows,setRows]=useState<Result[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[page,setPage]=useState(0);
 useEffect(()=>{let alive=true;setLoading(true);setError('');setRows([]);
  async function load(){
   const members:Result[]=[];let offset=0;
   for(let n=0;n<100;n++){
    const value=await client.request<{items:{user_id:string;display_name:string}[];next_offset:number|null}>(`/members?limit=50&offset=${offset}&q=${encodeURIComponent(term)}&include_test=${includeTest}`);
    members.push(...value.items.map(r=>({id:r.user_id,view:'members' as const,name:r.display_name,kind:'會員'})));
    if(value.next_offset===null||value.next_offset===undefined)break;
    if(value.next_offset<=offset||n===99)throw Error('會員清單尚未讀取完整。');offset=value.next_offset;
   }
   const [guilds,books,admins]=await Promise.all([
    client.request<{items:{guild_key:string;name:string;alias?:string}[]}>('/guilds'),
    client.request<{items:{book_id:string;title:string}[]}>('/skill-maintainers'),
    client.request<{items:{admin_id:string;user_id?:string;display_name:string;email:string}[]}>('/admins'),
   ]);
   const matches=(text:string)=>text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
   const result=[...members,...guilds.items.filter(r=>matches(`${r.name} ${r.alias??''}`)).map(r=>({id:r.guild_key,view:'guilds' as const,name:r.name,kind:'公會'})),...books.items.filter(r=>matches(r.title)).map(r=>({id:r.book_id,view:'guild-workspace' as const,name:r.title,kind:'技能書'})),...admins.items.filter(r=>!members.some(m=>m.id===r.user_id)&&matches(`${r.display_name} ${r.email}`)).map(r=>({id:r.admin_id,view:'admins' as const,name:r.display_name,kind:'管理員'}))];
   if(alive)setRows(result);
  }
  void load().catch(e=>{if(alive)setError(e instanceof Error?e.message:'無法搜尋。');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};
 },[client,term,includeTest]);
 function search(e:FormEvent){e.preventDefault();setPage(0);setTerm(query.trim());}
 return <section className="stack"><h2>人員與公會</h2><form className="admin-search" onSubmit={search}><label className="field">搜尋<input type="search" placeholder="會員、公會或技能書" value={query} maxLength={100} onChange={e=>setQuery(e.target.value)}/></label><button className="btn btn-ghost btn-small" disabled={loading}>搜尋</button></form>
  {loading&&<p role="status">正在搜尋…</p>}{error&&<p role="alert">{error}</p>}<ul className="admin-place-list">{rows.slice(page*20,(page+1)*20).map(row=><li key={`${row.view}:${row.id}`}><button className="admin-object-link" onClick={()=>onOpen(row.view,row.id)}><span><strong>{row.name}</strong><small>{row.kind}</small></span></button></li>)}</ul>{!loading&&!error&&!rows.length&&<p>沒有符合的結果。</p>}
  <div className="actions">{page>0&&<button className="btn btn-ghost btn-small" onClick={()=>setPage(page-1)}>上一頁</button>}{(page+1)*20<rows.length&&<button className="btn btn-ghost btn-small" onClick={()=>setPage(page+1)}>下一頁</button>}</div>
  <details><summary>管理設定</summary><label className="checkbox-row"><input type="checkbox" checked={includeTest} onChange={e=>{setIncludeTest(e.target.checked);setPage(0);}}/>顯示測試資料</label><label className="field">工作區<select aria-label="工作區" defaultValue="" onChange={e=>{if(e.target.value)onManage(e.target.value as AdminTab);}}><option value="">請選擇</option><option value="members">會員管理</option><option value="admins">管理員名單</option><option value="guilds">公會管理</option><option value="guild-workspace">技能書維護者</option></select></label></details>
 </section>;
}
