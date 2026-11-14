import type {ReactNode} from 'react';
import {GUILD_TOOLS,toolHash,type GuildTool} from './catalog';
import {guildRepository} from '../../../../modules/guild-workspace/repositories/registry';
import type {SiteConfig} from '../modules/Community';
import {guildRoute} from '../modules/guild-launchpad-route';

/** Shared guild context for native tools and the future registry/frame renderer. No membership gate. */
export function GuildToolPage({guildKey,tool,children,site,onNavigate,tools=GUILD_TOOLS}:{guildKey:string;tool?:GuildTool;children?:ReactNode;site?:SiteConfig|null;onNavigate?:(hash:string)=>void;tools?:readonly GuildTool[]}) {
 const title=guildKey==='guild_games'?'小遊戲公會':guildKey==='guild_ar'?'AR 互動公會':guildRepository(guildKey)?.name??'公會';
 const available=tools.filter(t=>t.guild_key===guildKey&&(t.tool_id!=='ar'||site?.ar_enabled===true)&&(!['catalog','store'].includes(t.tool_id)||site?.guild_launchpad_enabled===true));
 const go=(hash:string)=>{if(onNavigate)onNavigate(hash);else window.location.hash=hash;};
 return <section className="guild-launchpad" aria-label={title}>
 <header className="guild-launchpad-heading"><h2>{title}</h2><button type="button" className="btn btn-ghost btn-small" onClick={()=>go('#guilds')}>公會列表</button></header>
 <label className="field">公會功能<select aria-label="公會功能" value="tools" onChange={e=>go(guildRoute(guildKey,e.target.value as 'start'))}>
 {site?.guild_launchpad_enabled&&<><option value="start">啟動台</option><option value="work">我的工作</option>{!['guild_games','guild_ar'].includes(guildKey)&&<option value="skills">技能書</option>}<option value="information">公會資訊</option></>}<option value="tools">工具</option>
 </select></label>
 {tool?<><div className="actions"><button type="button" className="btn btn-secondary btn-small" onClick={()=>go(guildRoute(guildKey,'tools'))}>工具列表</button></div>{children}</>:<div className="stack">{available.map(t=><button type="button" className="btn btn-secondary btn-small" key={t.tool_id} onClick={()=>go(toolHash(t))}>{t.title}</button>)}</div>}
 </section>;
}
