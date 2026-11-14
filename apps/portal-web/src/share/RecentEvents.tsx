import {useEffect,useState} from 'react';
import type {PortalClient} from '../api';
type Item={event_id:string;title:string;starts_at:string;state?:string};
export function RecentEvents({client}:{client?:PortalClient}){
 const generation=client?.sessionGeneration;
 const [snapshot,setSnapshot]=useState<{client?:PortalClient;generation?:number;items:Item[]}>({client,generation,items:[]}),[failed,setFailed]=useState(false);
 const items=snapshot.client===client&&snapshot.generation===generation?snapshot.items:[];
 useEffect(()=>{let live=true;const load=client?client.get<{items:Item[]}>('/events'):fetch('/api/v1/public/events',{credentials:'omit',cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('unavailable');return r.json() as Promise<{items:Item[]}>;});
 void load.then(r=>{if(live&&client?.sessionGeneration===generation)setSnapshot({client,generation,items:r.items.filter(e=>(!e.state||e.state==='published')&&Date.parse(e.starts_at)>Date.now()).slice(0,6)});},()=>{if(live)setFailed(true);});return()=>{live=false;};},[client,client?.sessionGeneration]);
 if(!items.length)return failed?<p role="status">活動暫時無法載入</p>:null;
 return <section className="card" aria-label="近期活動"><h2>近期活動</h2><ul>{items.map(e=><li key={e.event_id}><a href={'/events/'+e.event_id}>{e.title}</a><small> · {new Date(e.starts_at).toLocaleDateString('zh-TW')}</small></li>)}</ul></section>;
}
