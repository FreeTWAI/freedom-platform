import {useEffect,useRef,useState} from 'react';
import {MemberOrderPageSchema,type MemberOrderPage} from '../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {formatMinor,formatOrderLifecycle,formatTaipeiDateTime} from '../hosted/format.js';

/** Read-only structural client port; no reverse import into portal composition. */
interface OrdersClient {
  readonly sessionGeneration:number;
  get(path:string,options?:{signal?:AbortSignal;background?:boolean}):Promise<unknown>;
}
export interface CheckoutOrdersProps {
  client:OrdersClient;
  userId:string;
  csrfToken:string;
  onSessionExpired:()=>void;
}
/** No private persistence. The owning page keys this by member/session generation. */
export function CheckoutOrders({client,userId,csrfToken,onSessionExpired}:CheckoutOrdersProps) {
  const [page,setPage]=useState<MemberOrderPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(false);
  const lifetime=useRef(new AbortController()),generation=useRef(client.sessionGeneration),reads=useRef(0),checks=useRef(0);
  const requestedCursor=useRef<string|undefined>(undefined),ended=useRef(false),expired=useRef(onSessionExpired);
  expired.current=onSessionExpired;
  const live=()=>!lifetime.current.signal.aborted&&!ended.current&&client.sessionGeneration===generation.current;
  async function checkSession() {
    const raw=await client.get('/session',{signal:lifetime.current.signal,background:true});
    if(!live())return false;
    const session=raw as {user?:{user_id?:unknown};csrf_token?:unknown}|null;
    if(session?.user?.user_id!==userId||session.csrf_token!==csrfToken){
      ended.current=true;reads.current++;setPage(null);expired.current();return false;
    }
    return true;
  }
  async function load(cursor?:string) {
    const ticket=++reads.current,current=()=>live()&&reads.current===ticket;
    requestedCursor.current=cursor;setLoading(true);setError(false);setPage(null);
    try {
      if(!await checkSession()||!current())return;
      const found=MemberOrderPageSchema.parse(await client.get('/me/orders'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{signal:lifetime.current.signal}));
      if(!await checkSession()||!current())return;
      setPage(found);
    } catch {if(current())setError(true);}
    finally {if(current())setLoading(false);}
  }
  useEffect(()=>{
    lifetime.current=new AbortController();generation.current=client.sessionGeneration;ended.current=false;
    void load();
    const heartbeat=()=>{
      if(document.visibilityState!=='visible')return;
      const ticket=++checks.current;
      void checkSession().catch(()=>{
        if(live()&&ticket===checks.current){reads.current++;setPage(null);setLoading(false);setError(true);}
      });
    };
    const timer=window.setInterval(heartbeat,60_000);
    window.addEventListener('focus',heartbeat);window.addEventListener('pageshow',heartbeat);document.addEventListener('visibilitychange',heartbeat);
    return()=>{lifetime.current.abort();reads.current++;checks.current++;window.clearInterval(timer);window.removeEventListener('focus',heartbeat);window.removeEventListener('pageshow',heartbeat);document.removeEventListener('visibilitychange',heartbeat);};
  },[client,userId,csrfToken]);
  return <section className="hosted-store stack" aria-label="訂單" aria-busy={loading} style={{maxWidth:680}}>
    <h2>訂單</h2>
    {loading&&<p role="status">正在讀取訂單…</p>}
    {error&&<><p role="alert">無法取得訂單，請稍後重試。</p><div className="actions"><button className="btn btn-small btn-ghost" onClick={()=>void load(requestedCursor.current)}>重新載入訂單</button></div></>}
    {page?.items.length===0&&<p>目前沒有訂單。</p>}
    {page?.items.map(order=><article className="hosted-store-product stack" key={order.order_ref}>
      <h3>{order.store.name}</h3><p>訂單編號 {order.display_number}</p>
      <p>下單時間 {formatTaipeiDateTime(order.created_at)}</p>
      <p>訂單狀態：{formatOrderLifecycle(order.status)} · {formatMinor(order.total_minor,order.currency)}</p>
      <div className="actions"><a className="btn btn-small btn-ghost" href={order.order_path}>開啟訂單</a></div>
    </article>)}
    {!error&&<div className="actions"><button className="btn btn-small btn-ghost" disabled={loading} onClick={()=>void load()}>重新整理／第一頁</button>
      {page?.next_cursor&&<button className="btn btn-small btn-ghost" disabled={loading} onClick={()=>void load(page.next_cursor!)}>下一頁</button>}</div>}
  </section>;
}
