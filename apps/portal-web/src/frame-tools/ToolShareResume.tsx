import {useEffect,useState} from 'react';
import {readToolShare,clearToolShare} from './pending-share';
import {openShareComposer} from '../share/share-port';
import type {ToolRecord} from '../../../../modules/guild-tools/contract';
/** Runs only in the authenticated Workspace, after its normal composer installs. */
export function ToolShareResume(){
 const [message,setMessage]=useState(''),[url,setUrl]=useState('');
 useEffect(()=>{let pending;try{pending=readToolShare(sessionStorage);}catch{return;}if(!pending)return;let live=true;const controller=new AbortController();
 void fetch(`/api/v1/public/guilds/${pending.guild}/tools`,{signal:controller.signal,credentials:'omit'}).then(async response=>{
 if(!response.ok)throw Error('分享草稿仍保留，請重新載入。');const data=await response.json();if(!live)return;
 const current=data.items.some((t:ToolRecord)=>t.id===pending.id&&t.revision===pending.revision&&t.state==='enabled'&&t.scopes.includes('share:compose'));if(!current){setMessage('工具已變更，分享草稿未發布。');return;}
 clearToolShare(sessionStorage);location.hash=pending.route;
 const result=await openShareComposer({...pending.request,source:{tool_id:pending.tool,guild_key:pending.guild}});if(live&&result.status==='published'){setMessage('已分享');setUrl(result.url??'');}
 }).catch(e=>{if(live)setMessage(e instanceof Error?e.message:'草稿仍保留，請重試。');});return()=>{live=false;controller.abort();};},[]);
 return message?<p role="status">{message}{url&&<> · <a href={url}>查看分享</a></>}</p>:null;
}
