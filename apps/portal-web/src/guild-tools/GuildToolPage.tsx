import {useEffect,type ReactNode} from 'react';
import {GUILD_TOOLS,toolHash,type GuildTool} from './catalog';
import {guildRepository} from '../../../../modules/guild-workspace/repositories/registry';
import type {SiteConfig} from '../modules/Community';
import {TOOL_ONLY_GUILDS,guildRoute} from '../modules/guild-launchpad-route';

/** Shared guild context for native tools and the future registry/frame renderer. No membership gate. */
export function GuildToolPage({guildKey,tool,children,site,onNavigate,tools=GUILD_TOOLS,loaded=true,loadError=''}:{guildKey:string;tool?:GuildTool;children?:ReactNode;site?:SiteConfig|null;onNavigate?:(hash:string)=>void;tools?:readonly GuildTool[];loaded?:boolean;loadError?:string}) {
 const title=guildKey==='guild_games'?'小遊戲公會':guildKey==='guild_ar'?'AR 互動公會':guildRepository(guildKey)?.name??'公會';
 const available=tools.filter(t=>t.guild_key===guildKey&&(t.tool_id!=='ar'||site?.ar_enabled===true)&&(!['catalog','store'].includes(t.tool_id)||site?.guild_launchpad_enabled===true));
 const toolOnly=TOOL_ONLY_GUILDS.some(key=>key===guildKey);
 const single=available.length===1?toolHash(available[0]):null;
 useEffect(()=>{if(toolOnly&&loaded&&!tool&&single)window.location.replace(single);},[toolOnly,loaded,tool,single]);
 const go=(hash:string)=>{if(onNavigate)onNavigate(hash);else window.location.hash=hash;};
 return <section className="guild-launchpad" aria-label={title}>
 <header className="guild-launchpad-heading"><h2>{title}</h2><button type="button" className="btn btn-ghost btn-small" onClick={()=>go('#guilds')}>公會列表</button></header>
 <label className="field">公會功能<select aria-label="公會功能" value={toolOnly?'start':'tools'} onChange={e=>go(guildRoute(guildKey,e.target.value as 'start'))}>
 {toolOnly&&<option value="start">啟動台</option>}{site?.guild_launchpad_enabled&&<>{!toolOnly&&<option value="start">啟動台</option>}<option value="work">我的工作</option>{!toolOnly&&<option value="skills">技能書</option>}<option value="information">公會資訊</option></>}{!toolOnly&&<option value="tools">工具</option>}
 </select></label>
 {tool?<>{!(toolOnly&&loaded&&available.length===1)&&<div className="actions"><button type="button" className="btn btn-secondary btn-small" onClick={()=>go(guildRoute(guildKey,'tools'))}>工具列表</button></div>}{children}</>:toolOnly&&!loaded?(loadError?<p role="alert">{loadError}</p>:<p role="status">載入工具…</p>):toolOnly&&available.length===0?<p>這個公會目前沒有開放的工具。</p>:<div className="stack">{available.map(t=><button type="button" className="btn btn-secondary btn-small" key={t.tool_id} onClick={()=>go(toolHash(t))}>{t.title}</button>)}</div>}
 </section>;
}
