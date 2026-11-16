import {useLayoutEffect,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {agentOperations} from './agent-operations';
import {agentStopRules} from './AgentHandoff';
import './AgentTokens.css';
type Scope='read'|'share'|'rsvp'|'react';
type OperationScreen=(typeof agentOperations)[number]['screen'];
type AgentPingError='timeout'|'network'|'redirect'|'http_status'|'rejected_url';
type AgentPing={notify_url:string;last_attempt_at:string|null;last_success_at:string|null;last_status:number|null;last_error:AgentPingError|null;paused_at:string|null;attempts:number};
const labels:Record<Scope,string>={read:'讀取',share:'分享',rsvp:'報名',react:'回應'};
const screenTitles:Record<OperationScreen,string>={guilds:'公會與工具',events:'活動',shares:'分享',credit:'貢獻',notifications:'通知',posts:'貼文',services:'服務',works:'作品',profile:'個人資料'};
const pingErrorLabels:Record<Exclude<AgentPingError,'http_status'>,string>={timeout:'逾時',network:'連線失敗',redirect:'不接受轉址',rejected_url:'網址不符合規則'};
type Token={connection_id:string;client_name:string;scopes:Scope[];expires_at:string;last_used_at:string|null;revoked_at:string|null;suspended_at:string|null;public_items_today:number;public_daily_cap:number;pending_publication:{operation:string;body:unknown;request_sha256:string;approved_at:string|null}|null;ping?:AgentPing|null};
function isLiveToken(item:Token){return !item.revoked_at&&!item.suspended_at&&Date.parse(item.expires_at)>Date.now();}
function pingReason(ping:AgentPing):string|null{
 if(!ping.last_error)return null;
 if(ping.last_error==='http_status')return `HTTP ${ping.last_status??0}`;
 return pingErrorLabels[ping.last_error]??ping.last_error;
}
function formatPingStatus(ping:AgentPing):string{
 const reason=pingReason(ping);
 if(ping.paused_at){
  return reason
   ?`已暫停：連續 8 次失敗（上次：${reason}）。修好後按「送測試通知」，成功就會恢復。`
   :'已暫停：連續 8 次失敗。修好後按「送測試通知」，成功就會恢復。';
 }
 if(!ping.last_attempt_at)return '尚未送出通知';
 if(!ping.last_error)return `上次通知成功：${new Date(ping.last_success_at??ping.last_attempt_at).toLocaleString('zh-TW')}`;
 return `上次通知失敗：${reason??''}，將自動重試`;
}
export function AgentTokens({client}:{client:PortalClient}){return <AgentTokenSession key={client.sessionGeneration} client={client}/>;}
function AgentTokenSession({client}:{client:PortalClient}){
 const [items,setItems]=useState<Token[]>([]),[name,setName]=useState('我的 Agent'),[scopes,setScopes]=useState<Scope[]>(['read','share','rsvp','react']);
 const [secret,setSecret]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const [pingUrls,setPingUrls]=useState<Record<string,string>>({});
 const mounted=useRef(false),generation=client.sessionGeneration,sequence=useRef(0),flight=useRef(false);
 const live=()=>mounted.current&&client.sessionGeneration===generation;
 function clearPingUrl(id:string){
  setPingUrls(current=>{if(!(id in current))return current;const next={...current};delete next[id];return next;});
 }
 async function load(){const seq=++sequence.current;try{const data=await client.get<{items:Token[]}>('/me/agent-tokens',{suppressConsole:true});if(live()&&seq===sequence.current){setItems(data.items);setLoaded(true);}}catch(e){if(live())setError(e instanceof Error?e.message:'載入失敗');}}
 useLayoutEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;sequence.current++;};},[client,generation]);
 async function action(path:string,body:unknown,issued=false,onSuccess?:()=>void){
  if(flight.current)return;flight.current=true;setBusy(true);setError('');setNotice('');setSecret('');
  try{
   const result=await client.post<Token&{access_token?:string}>(path,body,{idempotencyKey:crypto.randomUUID(),suppressConsole:true});
   if(!live())return;
   if(issued&&result.access_token)setSecret([`# 我的自由工坊 Agent\n權限：${result.scopes.map(s=>labels[s]).join('、')}`,
    `API：${window.location.origin}/api/v1\n請先讀：${window.location.origin}/agent.md`,
    `Authorization: Bearer ${result.access_token}\nContent-Type: application/json\nIdempotency-Key: 每項寫入一組識別碼；重試沿用原值。\n不要帶 Cookie。`,
    '請等我交代任務再操作。金鑰 90 天到期，每日最多發布 20 件。',agentStopRules].join('\n\n'));
   onSuccess?.();
   await load();
  }catch(e){if(live()){setError(e instanceof Error?e.message:'操作未完成');await load();}}
  finally{flight.current=false;if(live())setBusy(false);}
 }
 async function copyText(text:string){
  if(flight.current)return;flight.current=true;setBusy(true);
  try{await navigator.clipboard.writeText(text);if(live())setNotice('已複製');}
  catch{if(live())setNotice('無法複製，請允許剪貼簿後重試');}
  finally{flight.current=false;if(live())setBusy(false);}
 }
 function copyConnection(){
  const token=/fw_agent_[A-Za-z0-9_-]{43}/.exec(secret)?.[0]??'${FREEDOM_AGENT_TOKEN}';
  const settings={mcpServers:{'freedom-workshop':{url:`${window.location.origin}/api/v1/mcp`,headers:{Authorization:`Bearer ${token}`}}}};
  return copyText(JSON.stringify(settings,null,2));
 }
 const hasActiveToken=items.some(isLiveToken);
 return <section className="agent-tokens stack" aria-label="Agent 連線"><h2>我的 Agent</h2>
  {secret?<div className="stack"><label className="field">交給 Agent（僅此一次）<textarea readOnly rows={8} value={secret} autoComplete="off" spellCheck={false} onFocus={e=>e.currentTarget.select()}/></label><div className="experience-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={()=>void copyText(secret)}>交給我的 Agent</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void copyConnection()}>複製連線設定</button><button type="button" className="btn btn-ghost btn-sm" onClick={()=>setSecret('')}>已保存</button></div></div>:
   <form className="stack" onSubmit={e=>{e.preventDefault();void action('/me/agent-tokens',{name,scopes},true);}}>
    <label className="field">名稱<input value={name} onChange={e=>setName(e.target.value)} maxLength={80} required disabled={busy}/></label>
    <fieldset className="agent-scopes"><legend>允許操作</legend>{(Object.keys(labels) as Scope[]).map(scope=><label key={scope}><input type="checkbox" checked={scopes.includes(scope)} disabled={busy} onChange={e=>setScopes(current=>e.target.checked?[...current,scope]:current.filter(s=>s!==scope))}/>{labels[scope]}</label>)}</fieldset>
    <button className="btn btn-primary" disabled={busy||!scopes.length}>建立金鑰</button>
   </form>}
  {!secret&&hasActiveToken&&<button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void copyConnection()}>複製連線設定</button>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!loaded&&!error&&<p role="status">載入中…</p>}{loaded&&!items.length&&<p>尚無 Agent 連線</p>}
  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void load()}>更新連線</button>
  {items.map(item=>{
   const active=isLiveToken(item),pingUrl=pingUrls[item.connection_id]??item.ping?.notify_url??'',savedPing=Boolean(item.ping?.notify_url);
   return <details key={item.connection_id}><summary>{item.client_name} · {item.revoked_at?'已撤銷':item.suspended_at?'已停用':Date.parse(item.expires_at)<=Date.now()?'已到期':'使用中'}</summary>
    <p className="muted">最近使用：{item.last_used_at?new Date(item.last_used_at).toLocaleString('zh-TW'):'尚未使用'}<br/>到期：{new Date(item.expires_at).toLocaleDateString('zh-TW')} · 今日發布 {item.public_items_today}/{item.public_daily_cap}</p>
    {!item.revoked_at&&<div className="experience-actions"><button className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void action(`/me/agent-tokens/${item.connection_id}/renew`,{name:item.client_name,scopes:item.scopes},true)}>換新金鑰</button><button className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void action(`/me/agent-tokens/${item.connection_id}/revoke`,{})}>撤銷</button></div>}
    {!item.revoked_at&&!item.suspended_at&&item.pending_publication&&<div className="stack"><h4>首次公開</h4><p>{item.pending_publication.operation}</p><pre>{JSON.stringify(item.pending_publication.body,null,2)}</pre>{item.pending_publication.approved_at?<p>已確認，請 Agent 重試</p>:<button className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void action(`/me/agent-tokens/${item.connection_id}/confirm`,{request_sha256:item.pending_publication!.request_sha256})}>確認公開此內容</button>}</div>}
    {active&&item.scopes.includes('read')&&<div className="stack">
     <h4>變更通知（選填）</h4>
     <p className="muted">有新變更時，平台會在約 10 分鐘內通知這個網址；Agent 收到後再讀取變更。只接受 workers.dev、pages.dev、netlify.app、vercel.app 的 HTTPS 網址。</p>
     <form className="stack" onSubmit={e=>{e.preventDefault();void action(`/me/agent-tokens/${item.connection_id}/ping`,{notify_url:pingUrl.trim()},false,()=>clearPingUrl(item.connection_id));}}>
      <label className="field">通知網址<input type="url" value={pingUrl} onChange={e=>setPingUrls(current=>({...current,[item.connection_id]:e.target.value}))} disabled={busy}/></label>
      <div className="experience-actions">
       <button type="submit" className="btn btn-ghost btn-sm" disabled={busy}>儲存</button>
       {savedPing&&<><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void action(`/me/agent-tokens/${item.connection_id}/ping/test`,{})}>送測試通知</button><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>void action(`/me/agent-tokens/${item.connection_id}/ping`,{notify_url:null},false,()=>clearPingUrl(item.connection_id))}>停止通知</button></>}
      </div>
     </form>
     {savedPing&&item.ping&&<p role="status">{formatPingStatus(item.ping)}</p>}
    </div>}
   </details>;
  })}
  <details className="agent-operations"><summary>可授權的操作</summary><div className="stack">
   {(Object.keys(screenTitles) as OperationScreen[]).map(screen=>{
    const ops=agentOperations.filter(op=>op.screen===screen);
    return ops.length?<div key={screen}><h3>{screenTitles[screen]}</h3><ul>{ops.map(op=><li key={op.id}>{op.title}</li>)}</ul></div>:null;
   })}
  </div></details>
 </section>;
}
