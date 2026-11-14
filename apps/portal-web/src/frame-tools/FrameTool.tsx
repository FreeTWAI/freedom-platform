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
import {guildRoute} from '../modules/guild-launchpad-route';
import './FrameTool.css';
const LOCAL_OPS=new Set(['device-state.get','device-state.put','resize']);
const SCOPE_LABELS:Record<string,string>={'context:read':'有限身分','share:compose':'開啟分享','device-state:own':'裝置存檔','ui:open':'遊戲上傳',navigate:'公會導覽',resize:'調整高度','session:exchange':'工具身分'};
export function FrameTool({tool,client,memberKey='guest',onNavigate,manage=false}:{tool:ToolRecord;client?:PortalClient;memberKey?:string;onNavigate?:(hash:string)=>void;manage?:boolean}){
 const [guestShare,setGuestShare]=useState(false);const timerRef=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);const [report,setReport]=useState('');
 const frame=useRef<HTMLIFrameElement>(null),host=useRef<ToolHost|null>(null);const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[height,setHeight]=useState(600),[upload,setUpload]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
 setReady(false);setFailed(false);setUpload(false);
 if(tool.state!=='enabled')return;
 const storage={getItem:(key:string)=>localStorage.getItem(key),setItem:(key:string,value:string)=>localStorage.setItem(key,value)};
 const state=new DeviceState(storage,tool.id+':'+memberKey);
 if(tool.guild_key==='guild_games'&&tool.tool_id==='arcade'&&tool.state==='enabled')importArcadeState(state,storage,{getItem:key=>sessionStorage.getItem(key)});
 let verifiedUntil=0,verifying:Promise<void>|null=null,verifiedTool:ToolRecord|undefined;
 const verifyEnabled=async(signal:AbortSignal)=>{
  if(Date.now()<verifiedUntil)return;
  if(!verifying){
   verifying=(async()=>{
    const response=await fetch(`/api/v1/public/guilds/${tool.guild_key}/tools`,{credentials:'omit',signal});
    if(!response.ok)throw Error('tool_unavailable');
    const registry=await response.json();
    const current=registry.items.find((t:ToolRecord)=>t.id===tool.id&&t.revision===tool.revision&&t.state==='enabled');if(!current)throw Error('tool_unavailable');verifiedTool=current;
    verifiedUntil=Date.now()+10_000;
   })().finally(()=>{verifying=null;});
  }
  await verifying;
 };
 const h=new ToolHost(()=>frame.current?.contentWindow??null,tool,{ready:()=>{clearTimeout(timerRef.current);setReady(true);},failure:()=>setFailed(true),execute:async(op,p,signal)=>{
 if(!LOCAL_OPS.has(op))await verifyEnabled(signal);
 signal.throwIfAborted();
 switch(op){
 case 'session.exchange':if(!client||memberKey==='guest'||tool.profile!=='origin')throw Error('profile_denied');return client.post(`/guilds/${tool.guild_key}/tools/${tool.tool_id}/token`,{},{idempotencyKey:crypto.randomUUID()});
 case 'context.get':return {guild:tool.guild_key,guild_name:verifiedTool?.guild_name??'公會',tool:tool.tool_id,theme:document.documentElement.dataset.theme??'light',locale:document.documentElement.lang||'zh-TW',platform_origin:location.origin,signed_in:memberKey!=='guest',...(client&&memberKey!=='guest'?await client.get<{subject:string;tier:string|null}>(`/guilds/${tool.guild_key}/tools/${tool.tool_id}/context`):{})};
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
 if(tool.state!=='enabled'){const backHash=guildRoute(tool.guild_key);return <div className="frame-tool stack"><p role="status">{tool.state==='disabled'?'此工具已停用':'等待會長確認'}</p>{!(manage&&tool.state==='pending')&&<a className="btn btn-primary" href={backHash} onClick={onNavigate?e=>{e.preventDefault();onNavigate(backHash);}:undefined}>返回公會</a>}</div>;}
 return <section className="frame-tool" aria-label={tool.title}><p className="muted">外部工具 · {tool.profile==='sandboxed'?'隔離模式':'獨立來源'}</p><details className="frame-tool-details"><summary>說明</summary><p>允許功能：{tool.scopes.map(s=>SCOPE_LABELS[s]??s).join('、')}</p><p className="muted">來源：{new URL(tool.entry_url).host}</p></details>{!ready&&<p role="status">{failed?'工具無法連線，請檢查網站允許嵌入及 v2 版本。':'工具載入中…'}</p>}{failed&&!ready&&<button className="btn btn-secondary btn-small" onClick={()=>setAttempt(x=>x+1)}>重試</button>}
 <iframe key={attempt} ref={frame} title={tool.title} src={arcadeEntry(tool)} sandbox={frameSandbox(tool)} allow={tool.permissions.includes('fullscreen')?'fullscreen':'fullscreen \'none\''} referrerPolicy="no-referrer" width="100%" height={height} onLoad={()=>{setReady(false);setFailed(false);clearTimeout(timerRef.current);timerRef.current=setTimeout(()=>setFailed(true),12000);host.current?.init();}}/>
 {client&&memberKey!=='guest'&&<button className="btn btn-ghost btn-small" disabled={report==='已收到檢舉'} onClick={async()=>{try{await client.post(`/guilds/${tool.guild_key}/tools/${tool.tool_id}/report`,{},{idempotencyKey:crypto.randomUUID(),ifMatch:tool.revision});setReport('已收到檢舉');}catch(e){setReport(e instanceof Error?e.message:'檢舉未送出，請重試。');}}}>檢舉工具</button>}
 {guestShare&&<section aria-label="登入後分享"><p>草稿已保留，登入後確認發布。</p><a className="btn btn-primary" href="#home">登入後分享</a><button className="btn btn-secondary btn-small" onClick={()=>{clearToolShare(sessionStorage);setGuestShare(false);}}>取消</button></section>}
 {report&&<p role="status">{report}</p>}
 {upload&&<section aria-label="遊戲上傳"><button className="btn btn-secondary btn-small" onClick={()=>setUpload(false)}>關閉上傳</button><MemberGameUpload hidden={false}/></section>}
 </section>;
}
