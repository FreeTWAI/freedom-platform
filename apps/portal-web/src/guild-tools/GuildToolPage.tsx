import {useEffect,type ReactNode} from 'react';
import {GUILD_TOOLS,toolHash,type GuildTool} from './catalog';
import {guildRepository} from '../../../../modules/guild-workspace/repositories/registry';
import type {SiteConfig} from '../modules/Community';
import {TOOL_ONLY_GUILDS,guildRoute} from '../modules/guild-launchpad-route';
import './GuildToolPage.css';

type GuildToolEntry=GuildTool&{state?:string};
/** Shared guild context for native tools and the future registry/frame renderer. No membership gate. */
export function GuildToolPage({guildKey,tool,children,site,onNavigate,tools=GUILD_TOOLS,loaded=true,loadError=''}:{guildKey:string;tool?:GuildToolEntry;children?:ReactNode;site?:SiteConfig|null;onNavigate?:(hash:string)=>void;tools?:readonly GuildToolEntry[];loaded?:boolean;loadError?:string}) {
 const title=guildKey==='guild_games'?'小遊戲公會':guildKey==='guild_ar'?'AR 互動公會':guildRepository(guildKey)?.name??'公會';
 const available=tools.filter(t=>t.guild_key===guildKey&&(t.tool_id!=='ar'||site?.ar_enabled===true)&&(!['catalog','store'].includes(t.tool_id)||site?.guild_launchpad_enabled===true));
 const toolOnly=TOOL_ONLY_GUILDS.some(key=>key===guildKey);
 const single=available.length===1?toolHash(available[0]):null;
 useEffect(()=>{if(toolOnly&&loaded&&!tool&&single)window.location.replace(single);},[toolOnly,loaded,tool,single]);
 const go=(hash:string)=>{if(onNavigate)onNavigate(hash);else window.location.hash=hash;};
 const noTools=!tool&&loaded&&available.length===0;
 const emptyBackHash=toolOnly||site?.guild_launchpad_enabled===false?'#guilds':guildRoute(guildKey);
 const isFramed=tool?.kind==='frame';
 const showToolList=!(toolOnly&&loaded&&available.length===1);
 const showSelect=!toolOnly||site?.guild_launchpad_enabled===true;
 const navSelect=(forceDefault?:boolean)=><label className="field">公會功能<select aria-label="公會功能" value={noTools&&!toolOnly&&!forceDefault?'':toolOnly?'start':'tools'} onChange={e=>{if(e.target.value)go(guildRoute(guildKey,e.target.value as 'start'));}}>
 {noTools&&!toolOnly&&!forceDefault&&<option value="" disabled>切換功能</option>}{toolOnly&&<option value="start">啟動台</option>}{site?.guild_launchpad_enabled&&<>{!toolOnly&&<option value="start">啟動台</option>}<option value="work">我的工作</option>{!toolOnly&&<option value="skills">技能書</option>}<option value="information">公會資訊</option></>}{!toolOnly&&(!noTools||forceDefault)&&<option value="tools">工具</option>}
 </select></label>;
 return <section className="guild-launchpad" aria-label={title}>
 <header className="guild-launchpad-heading"><h2>{title}</h2>{!isFramed&&!(noTools&&emptyBackHash==='#guilds')&&<button type="button" className="btn btn-ghost btn-small" onClick={()=>go('#guilds')}>公會列表</button>}</header>
 {isFramed?<><details className="guild-tool-more"><summary className="btn btn-ghost btn-small">更多</summary><div className="guild-tool-more-body"><div className="actions"><button type="button" className="btn btn-ghost btn-small" onClick={()=>go('#guilds')}>公會列表</button>{showToolList&&<button type="button" className="btn btn-secondary btn-small" onClick={()=>go(guildRoute(guildKey,'tools'))}>工具列表</button>}</div>{showSelect&&navSelect(true)}</div></details>{children}</>:<>
 {!(noTools&&!site?.guild_launchpad_enabled)&&navSelect()}
 {tool?<>{showToolList&&<div className="actions"><button type="button" className="btn btn-secondary btn-small" onClick={()=>go(guildRoute(guildKey,'tools'))}>工具列表</button></div>}{children}</>:!loaded?(loadError?<p role="alert">{loadError}</p>:<p role="status">載入工具…</p>):available.length===0?<div className="stack"><p>尚無可用工具。</p><a className="btn btn-primary" href={emptyBackHash} onClick={onNavigate?e=>{e.preventDefault();go(emptyBackHash);}:undefined}>返回公會</a></div>:<div className="stack">{available.map(t=><button type="button" className="btn btn-secondary btn-small guild-tool-button" key={t.tool_id} title={t.title} onClick={()=>go(toolHash(t))}><span className="guild-tool-button-title">{t.title}</span>{t.state==='disabled'?'（已停用）':t.state==='pending'?'（待確認）':''}</button>)}</div>}
 </>}
 </section>;
}
