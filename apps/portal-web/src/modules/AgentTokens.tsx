import {useLayoutEffect,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {agentStopRules} from './AgentHandoff';
import './AgentTokens.css';
type Scope='read'|'share'|'rsvp';
const labels:Record<Scope,string>={read:'讀取',share:'分享',rsvp:'報名'};
type Token={connection_id:string;client_name:string;scopes:Scope[];expires_at:string;last_used_at:string|null;revoked_at:string|null;suspended_at:string|null;public_items_today:number;public_daily_cap:number;pending_publication:{operation:string;body:unknown;request_sha256:string;approved_at:string|null}|null};
export function AgentTokens({client}:{client:PortalClient}){return <AgentTokenSession key={client.sessionGeneration} client={client}/>;}
function AgentTokenSession({client}:{client:PortalClient}){
 const [items,setItems]=useState<Token[]>([]),[name,setName]=useState('我的 Agent'),[scopes,setScopes]=useState<Scope[]>(['read','share','rsvp']);
 const [secret,setSecret]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const mounted=useRef(false),generation=client.sessionGeneration,sequence=useRef(0),flight=useRef(false);
 const live=()=>mounted.current&&client.sessionGeneration===generation;
 async function load(){const seq=++sequence.current;try{const data=await client.get<{items:Token[]}>('/me/agent-tokens',{suppressConsole:true});if(live()&&seq===sequence.current){setItems(data.items);setLoaded(true);}}catch(e){if(live())setError(e instanceof Error?e.message:'載入失敗');}}
 useLayoutEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;sequence.current++;};},[client,generation]);
 async function action(path:string,body:unknown,issued=false){
  if(flight.current)return;flight.current=true;setBusy(true);setError('');setNotice('');setSecret('');
  try{
   const result=await client.post<Token&{access_token?:string}>(path,body,{idempotencyKey:crypto.randomUUID(),suppressConsole:true});
   if(!live())return;
   if(issued&&result.access_token)setSecret([`# 我的自由工坊 Agent\n權限：${result.scopes.map(s=>labels[s]).join('、')}`,
    `API：${window.location.origin}/api/v1\n請先讀：${window.location.origin}/agent.md`,
    `Authorization: Bearer ${result.access_token}\nContent-Type: application/json\nIdempotency-Key: 每項寫入一組識別碼；重試沿用原值。\n不要帶 Cookie。`,
    '請等我交代任務再操作。金鑰 90 天到期，每日最多發布 20 件。',agentStopRules].join('\n\n'));
   await load();
  }catch(e){if(live()){setError(e instanceof Error?e.message:'操作未完成');await load();}}
  finally{flight.current=false;if(live())setBusy(false);}
 }
 async function copy(){try{await navigator.clipboard.writeText(secret);if(live())setNotice('已複製');}catch{if(live())setNotice('請選取文字複製');}}
 return <section className="agent-tokens stack" aria-label="Agent 連線"><h2>我的 Agent</h2>
  {secret?<div className="stack"><label className="field">交給 Agent（僅此一次）<textarea readOnly rows={8} value={secret} autoComplete="off" spellCheck={false} onFocus={e=>e.currentTarget.select()}/></label><div className="experience-actions"><button className="btn btn-primary" onClick={()=>void copy()}>複製給 Agent</button><button className="btn btn-ghost btn-sm" onClick={()=>setSecret('')}>已保存</button></div></div>:
   <form className="stack" onSubmit={e=>{e.preventDefault();void action('/me/agent-tokens',{name,scopes},true);}}>
    <label className="field">名稱<input value={name} onChange={e=>setName(e.target.value)} maxLength={80} required disabled={busy}/></label>
    <fieldset className="agent-scopes"><legend>允許操作</legend>{(Object.keys(labels) as Scope[]).map(scope=><label key={scope}><input type="checkbox" checked={scopes.includes(scope)} disabled={busy} onChange={e=>setScopes(current=>e.target.checked?[...current,scope]:current.filter(s=>s!==scope))}/>{labels[scope]}</label>)}</fieldset>
    <button className="btn btn-primary" disabled={busy||!scopes.length}>建立金鑰</button>
   </form>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!loaded&&!error&&<p role="status">載入中…</p>}{loaded&&!items.length&&<p>尚無 Agent 連線</p>}
  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void load()}>更新連線</button>
  {items.map(item=><details key={item.connection_id}><summary>{item.client_name} · {item.revoked_at?'已撤銷':item.suspended_at?'已停用':Date.parse(item.expires_at)<=Date.now()?'已到期':'使用中'}</summary>
   <p className="muted">最近使用：{item.last_used_at?new Date(item.last_used_at).toLocaleString('zh-TW'):'尚未使用'}<br/>到期：{new Date(item.expires_at).toLocaleDateString('zh-TW')} · 今日發布 {item.public_items_today}/{item.public_daily_cap}</p>
   {!item.revoked_at&&<div className="experience-actions"><button className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void action(`/me/agent-tokens/${item.connection_id}/renew`,{name:item.client_name,scopes:item.scopes},true)}>續期換新</button><button className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void action(`/me/agent-tokens/${item.connection_id}/revoke`,{})}>撤銷</button></div>}
   {!item.revoked_at&&!item.suspended_at&&item.pending_publication&&<div className="stack"><h4>首次公開</h4><p>{item.pending_publication.operation}</p><pre>{JSON.stringify(item.pending_publication.body,null,2)}</pre>{item.pending_publication.approved_at?<p>已確認，請 Agent 重試</p>:<button className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void action(`/me/agent-tokens/${item.connection_id}/confirm`,{request_sha256:item.pending_publication!.request_sha256})}>確認公開此內容</button>}</div>}
  </details>)}
 </section>;
}
