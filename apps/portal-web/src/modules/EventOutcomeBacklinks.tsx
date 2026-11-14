import {useEffect,useState} from 'react';
import {ApiError,type PortalClient} from '../api';

const siteEnabledCache=new WeakMap<PortalClient,Promise<boolean>>();
function eventOutcomesEnabled(client:PortalClient):Promise<boolean>{
 const cached=siteEnabledCache.get(client);
 if(cached)return cached;
 const pending=client.get<{event_outcomes_enabled?:boolean}>('/site',{background:true,skipAuthHandler:true})
  .then(site=>site?.event_outcomes_enabled===true)
  .catch(()=>{if(siteEnabledCache.get(client)===pending)siteEnabledCache.delete(client);return false;});
 siteEnabledCache.set(client,pending);
 return pending;
}

export function EventOutcomeBacklinks({client,kind,sourceId,publicRead=false,enabled}:{client:PortalClient;kind:'work'|'skill_book'|'squad_outcome';sourceId:string;publicRead?:boolean;enabled?:boolean}){
 const [items,setItems]=useState<{outcome_id:string;event_id:string;event_title:string;title:string;path:string}[]>([]),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let current=true;
  setItems([]);
  setError('');
  if(enabled===false)return()=>{current=false;};
  void(async()=>{
   const allowed=enabled??await eventOutcomesEnabled(client);
   if(!current||!allowed)return;
   try{
    const value=await client.get<{items:{outcome_id:string;event_id:string;event_title:string;title:string;path:string}[]}>(`${publicRead?'/public':''}/event-outcome-backlinks/${kind}/${encodeURIComponent(sourceId)}`,{background:true});
    if(current)setItems(value.items);
   }catch(reason){
    if(current&&!(reason instanceof ApiError&&reason.status===404))setError(reason instanceof Error?reason.message:'活動來源目前無法讀取。');
   }
  })();
  return()=>{current=false;};
 },[client,kind,sourceId,publicRead,enabled,revision]);
 if(!items.length&&!error)return null;
 return <section className="stack outcome-section" aria-label="來自哪場活動"><h3>來自哪場活動</h3>{items.length>0&&<ul>{items.map(item=><li key={item.outcome_id}><a href={item.path}>{item.event_title} · {item.title}</a></li>)}</ul>}{error&&<><p role="alert">{error}</p><button type="button" className="btn btn-secondary btn-small" onClick={()=>setRevision(value=>value+1)}>重新載入活動來源</button></>}</section>;
}
