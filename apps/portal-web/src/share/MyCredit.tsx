import {useEffect,useState} from 'react';
import {AgentHandoff} from '../modules/AgentHandoff';
import type {PortalClient} from '../api';
type Credit={share_id:string;title:string;basis:string;role:string;count:number;state:string};
const labels:Record<string,string>={created:'分享',shared_again:'共同分享',claim_verified:'已認領',qualified_click_day:'有效連結日',star_confirmed:'帶來加星',registration:'帶來報名'};
export function MyCredit({client}:{client:PortalClient}){
 const [items,setItems]=useState<Credit[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[next,setNext]=useState<number|null>(null),generation=client.sessionGeneration;
 async function load(offset=0){try{const r=await client.get<{items:Credit[];next_offset:number|null}>(`/me/credit?offset=${offset}`);if(client.sessionGeneration===generation){setItems(old=>offset?[...old,...r.items]:r.items);setNext(r.next_offset);}}catch(e){if(client.sessionGeneration===generation)setError((e as Error).message);}finally{if(client.sessionGeneration===generation)setLoading(false);}}
 useEffect(()=>{void load();},[]);
 const groups=new Map<string,Credit[]>();for(const i of items)groups.set(i.share_id,[...(groups.get(i.share_id)??[]),i]);
 return <section className="share-page stack" aria-label="我的貢獻"><h2>我的貢獻</h2><AgentHandoff screen="credit" task="查看我的貢獻"/>{error&&<p role="alert">{error}</p>}{loading?<p>載入中…</p>:!items.length?<p>尚無貢獻紀錄</p>:[...groups].map(([id,rows])=><article className="card" key={id}>{rows[0].state==='published'?<a href={`#shares/${id}`}>{rows[0].title}</a>:<strong>{rows[0].title} · {rows[0].state==='hidden'?'暫停公開，等待確認':'已撤回'}</strong>}<p>{rows.map(r=>`${labels[r.basis]} ${r.count}`).join(' · ')}</p></article>)}{next!==null&&<button className="btn btn-secondary btn-small" onClick={()=>void load(next)}>載入更多</button>}</section>;
}
