import {saveToolShare,clearToolShare} from './pending-share';
import {importArcadeState,arcadeEntry} from './legacy-arcade';
import {useEffect,useRef,useState} from 'react';
import type {PortalClient} from '../api';
import {frameSandbox,type ToolRecord} from '../../../../modules/guild-tools/contract';
import {ToolHost} from './host';
import {DeviceState} from './device-state';
import {openShareComposer} from '../share/share-port';
import {MemberGameUpload} from '../games/MemberGameUpload';
import type {ShareComposeRequest} from '../share/share-port';
export function FrameTool({tool,client,memberKey='guest'}:{tool:ToolRecord;client?:PortalClient;memberKey?:string}){
 const [guestShare,setGuestShare]=useState(false);const timerRef=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const [report,setReport]=useState('');
 const frame=useRef<HTMLIFrameElement>(null),host=useRef<ToolHost|null>(null);const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[height,setHeight]=useState(600),[upload,setUpload]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
 setReady(false);setFailed(false);setUpload(false);
 if(tool.state!=='enabled')return;
 const storage={getItem:(key:string)=>localStorage.getItem(key),setItem:(key:string,value:string)=>localStorage.setItem(key,value)};
 const state=new DeviceState(storage,tool.id+':'+memberKey);
 if(tool.guild_key==='guild_games'&&tool.tool_id==='arcade'&&tool.state==='enabled')importArcadeState(state,storage,{getItem:key=>sessionStorage.getItem(key)});
 const h=new ToolHost(()=>frame.current?.contentWindow??null,tool,{ready:()=>{clearTimeout(timerRef.current);setReady(true);},failure:()=>setFailed(true),execute:async(op,p,signal)=>{
 const response=await fetch(`/api/v1/public/guilds/${tool.guild_key}/tools`,{credentials:'omit',signal});if(!response.ok)throw Error('tool_unavailable');const registry=await response.json();if(!registry.items.some((t:ToolRecord)=>t.id===tool.id&&t.revision===tool.revision&&t.state==='enabled'))throw Error('tool_unavailable');
 signal.throwIfAborted();
 switch(op){
 case 'session.exchange':if(!client||memberKey==='guest'||tool.profile!=='origin')throw Error('profile_denied');return client.post(`/guilds/${tool.guild_key}/tools/${tool.tool_id}/token`,{},{idempotencyKey:crypto.randomUUID()});
 case 'context.get':return {guild:tool.guild_key,tool:tool.tool_id,theme:document.documentElement.dataset.theme??'light',locale:document.documentElement.lang||'zh-TW',platform_origin:location.origin,signed_in:memberKey!=='guest',...(client&&memberKey!=='guest'?await client.get<{subject:string;tier:string|null}>(`/guilds/${tool.guild_key}/tools/${tool.tool_id}/context`):{})};
 case 'share.compose':if(memberKey==='guest'){const route=`#guilds/${tool.guild_key}/tools/${tool.tool_id}`;const query=tool.guild_key==='guild_games'&&tool.tool_id==='arcade'?new URL(arcadeEntry(tool)).search.slice(1):'';await saveToolShare(sessionStorage,tool,p,route+(query?'?'+query:''),signal);signal.throwIfAborted();setGuestShare(true);if(document.fullscreenElement)await document.exitFullscreen();return {status:'cancelled'};}if(document.fullscreenElement)await document.exitFullscreen();signal.throwIfAborted();return openShareComposer({...p as ShareComposeRequest,source:{tool_id:tool.tool_id,guild_key:tool.guild_key}});
 case 'device-state.get':return {value:state.get(p.key)};
 case 'device-state.put':return state.put(p.key,p.value);
 case 'ui.open':setUpload(true);return {opened:true};
 case 'navigate':window.location.hash=`#guilds/${tool.guild_key}/${p.action}`;return {opened:true};
 case 'resize':setHeight(p.height);return {height:p.height};
 }
 }});host.current=h;const listener=(e:MessageEvent)=>{void h.receive(e);};window.addEventListener('message',listener);
 timerRef.current=setTimeout(()=>setFailed(true),12000);
 return()=>{h.dispose();host.current=null;clearTimeout(timerRef.current);window.removeEventListener('message',listener);};
 },[tool.id,tool.revision,tool.state,client,memberKey,attempt]);
 useEffect(()=>{if(ready)setFailed(false);},[ready]);
 if(tool.state!=='enabled')return <p role="status">工具已停用或等待會長確認。</p>;
 return <section aria-label={tool.title}><p className="muted">外部工具 · {new URL(tool.entry_url).host} · {tool.profile==='sandboxed'?'隔離模式':'獨立來源'}</p><details><summary>允許功能</summary><p>{tool.scopes.join('、')}</p></details>{!ready&&<p role="status">{failed?'工具無法連線，請檢查網站允許嵌入及 v2 版本。':'工具載入中…'}</p>}{failed&&!ready&&<button className="btn btn-secondary btn-small" onClick={()=>setAttempt(x=>x+1)}>重試</button>}
 <iframe key={attempt} ref={frame} title={tool.title} src={arcadeEntry(tool)} sandbox={frameSandbox(tool)} allow={tool.permissions.includes('fullscreen')?'fullscreen':'fullscreen \'none\''} referrerPolicy="no-referrer" width="100%" height={height} onLoad={()=>{setReady(false);setFailed(false);clearTimeout(timerRef.current);timerRef.current=setTimeout(()=>setFailed(true),12000);host.current?.init();}}/>
 {client&&memberKey!=='guest'&&<button className="btn btn-ghost btn-small" disabled={report==='已收到檢舉'} onClick={async()=>{try{await client.post(`/guilds/${tool.guild_key}/tools/${tool.tool_id}/report`,{},{idempotencyKey:crypto.randomUUID(),ifMatch:tool.revision});setReport('已收到檢舉');}catch(e){setReport(e instanceof Error?e.message:'檢舉未送出，請重試。');}}}>檢舉工具</button>}
 {guestShare&&<section aria-label="登入後分享"><p>草稿已保留，登入後確認發布。</p><a className="btn btn-primary" href="#home">登入後分享</a><button className="btn btn-secondary btn-small" onClick={()=>{clearToolShare(sessionStorage);setGuestShare(false);}}>取消</button></section>}
 {report&&<p role="status">{report}</p>}
 {upload&&<section aria-label="遊戲上傳"><button className="btn btn-secondary btn-small" onClick={()=>setUpload(false)}>關閉上傳</button><MemberGameUpload hidden={false}/></section>}
 </section>;
}
