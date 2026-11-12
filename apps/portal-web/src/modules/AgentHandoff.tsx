import {useState} from 'react';
import {agentOperations} from './agent-operations';

type Operation={id:string;method:string;route:string;scope:string;title:string;screen:string;example?:unknown;integration?:boolean;featureFlag?:string;ifMatch?:boolean};
export const agentStopRules='遇 401／403／409／429 或其他 4xx 即停止並詢問我；202 待我在瀏覽器確認，再用原 key 和內容重試。不得付款、改憑證、停用帳號或執行管理員／公會長操作。';
export function agentHandoffText({screen,task,resourceId,origin,features=[]}:{screen:string;task:string;resourceId?:string;origin:string;features?:string[]}){
 const operations=(agentOperations as readonly Operation[]).filter(op=>op.screen===screen&&!op.integration&&(!op.featureFlag||features.includes(op.featureFlag)));
 return [`# ${task}`,`API：${origin}/api/v1\n指引：${origin}/agent.md`,
  ...operations.map(op=>`## ${op.title}\n${op.method} ${resourceId?op.route.replace(':id',resourceId):op.route}\n權限：${op.scope}${op.ifMatch?'\nIf-Match: "最新活動 aggregate_version"':''}${op.example?'\n```json\n'+JSON.stringify(op.example,null,2)+'\n```':'\n範例：以 GET 讀取此路徑。'}`),
  '## Headers\nAuthorization: Bearer $FREEDOM_AGENT_TOKEN\nContent-Type: application/json\nIdempotency-Key: 每項寫入一組識別碼；重試沿用原值。\n不要帶 Cookie。',
  '先由我在「自動化 → 我的 Agent」建立金鑰，再安全交給你；不要索取密碼。',
  '## 停止規則\n'+agentStopRules].join('\n\n');
}
export function AgentHandoff(props:{screen:'events'|'credit';task:string;resourceId?:string;features?:string[]}){
 const [fallback,setFallback]=useState(''),[notice,setNotice]=useState('');
 async function copy(){const text=agentHandoffText({...props,origin:window.location.origin});try{await navigator.clipboard.writeText(text);setNotice('已複製');setFallback('');}catch{setFallback(text);setNotice('請複製下方文字');}}
 return <div><button type="button" className="btn btn-ghost btn-sm" onClick={()=>void copy()}>交給我的 Agent</button>{notice&&<span role="status">{notice}</span>}{fallback&&<label className="field">交接文字<textarea readOnly rows={8} value={fallback} onFocus={e=>e.currentTarget.select()}/></label>}</div>;
}
