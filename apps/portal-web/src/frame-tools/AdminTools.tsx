import {useState} from 'react';
type Client={request<T>(path:string,body?:unknown,options?:{key?:string;version?:number|string|null}):Promise<T>};
type Item={id:string;guild_key:string;title:string;origin:string;state:string;revision:number};
export function AdminTools({client}:{client:Client}){
 const [items,setItems]=useState<Item[]>([]),[error,setError]=useState(''),[selected,setSelected]=useState<string|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
 const load=async()=>{try{setItems((await client.request<{items:Item[]}>('/guild-tools')).items);setError('');}catch(e){setError(String(e));}};
 const disable=async(item:Item)=>{setBusy(true);try{await client.request('/guild-tools/'+item.id+'/disable',{reason},{version:item.revision});setSelected(null);setReason('');await load();}catch(e){setError(String(e));}finally{setBusy(false);}};
 return <details onToggle={e=>{if(e.currentTarget.open)void load();}}><summary>外部工具</summary>{error&&<p role="alert">{error}</p>}{!items.length&&<p>尚無外部工具</p>}{items.map(item=><article key={item.id} className="card stack"><p>{item.title} · {item.guild_key} · {item.origin}</p><p>{item.state==='enabled'?'使用中':item.state==='disabled'?'已停用':'待確認'}</p>{selected===item.id?<><label className="field">停用原因<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label><div className="actions"><button className="btn btn-secondary btn-small" disabled={busy||!reason.trim()} onClick={()=>void disable(item)}>停用</button><button className="btn btn-ghost btn-small" onClick={()=>setSelected(null)}>取消</button></div></>:item.state!=='disabled'&&<button className="btn btn-secondary btn-small" onClick={()=>setSelected(item.id)}>停用工具</button>}</article>)}</details>;
}
