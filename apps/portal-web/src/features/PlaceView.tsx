import {GuildToolDirectory} from '../guild-tools/GuildToolDirectory';
import {RegisteredTools} from '../frame-tools/RegisteredTools';
import {guildTool} from '../guild-tools/catalog';
import {guildKeyFromHash,guildActionFromHash} from '../modules/guild-launchpad-route';
import {lazy} from 'react';
import type {ReactNode} from 'react';
import type {PortalFeatureContext} from './types';
import {portalHash,resolvePortalRoute} from '../portal-route';
import type {TabId} from '../types';
const AgentTokens=lazy(()=>import('../modules/AgentTokens').then(m=>({default:m.AgentTokens})));
const Arcade=lazy(()=>import('../games/AbsurdDaily').then(m=>({default:m.AbsurdDaily})));
const ClientConnections=lazy(()=>import('../modules/ClientConnections').then(m=>({default:m.ClientConnections})));
const DeviceConnections=lazy(()=>import('../modules/DeviceConnections').then(m=>({default:m.DeviceConnections})));
const ModelSettings=lazy(()=>import('../modules/ModelSettings').then(m=>({default:m.ModelSettings})));

/** Integration ports: feed ShareLauncher stays in App; agent-door mounts in automation below. */
export function PlaceView({context,render,defaultTab}:{context:PortalFeatureContext;defaultTab:TabId;render:(tab:TabId,context:PortalFeatureContext)=>ReactNode}) {
 const route=resolvePortalRoute(context.locationHash||'#'+defaultTab);
 const {site,selectTab}=context;
 let choices:{title:string;hash:string;tab:TabId}[]=[];
 const choice=(title:string,tab:TabId,hash=portalHash(tab))=>({title,tab,hash});
 if(route.place==='explore')choices=[...(site?.community_search_enabled?[choice('搜尋','community-search')]:[]),choice('夥伴','members'),choice('資源','skills'),choice('作品','showcase'),choice('活動','events'),choice('成果','highlights'),choice('服務','services')];
 if(route.place==='me')choices=[choice('個人頁','profile'),choice('設定','account'),...(site?.personal_content_enabled?[choice('草稿','my-content')]:[]),choice('入門','todos'),choice('訊息','messages'),choice('聯絡人','friends'),choice('小隊','squads'),...(site?.guild_launchpad_enabled?[choice('工作區','business')]:[]),choice('訂單','reservations'),choice('我的貢獻','promotion')];
 if(route.place==='automation')choices=[choice('我的 Agent','private-ai','#automation/agent'),choice('私人工作','private-ai'),choice('裝置連線','private-ai','#automation/devices'),choice('模型設定','private-ai','#automation/models'),choice('工具連線','private-ai','#automation/connections')];
 const selected=choices.filter(c=>route.hash===c.hash||route.hash.startsWith(c.hash+'/')||route.hash.startsWith(c.hash+'?')).sort((a,b)=>b.hash.length-a.hash.length)[0];
 let tab=route.tab==='messages'?'home':route.tab;
 if(route.place==='explore'&&tab==='community-search'&&!site?.community_search_enabled)tab='skills';
 let content:ReactNode;
 const path=route.hash.split('?')[0];
 if(path==='#automation/agent')content=<AgentTokens client={context.client}/>;
 else if(path==='#automation/connections')content=<ClientConnections client={context.client}/>;
 else if(path==='#automation/devices')content=<DeviceConnections client={context.client}/>;
 else if(path==='#automation/models')content=<ModelSettings client={context.client}/>;
 else content=render(tab,{...context,locationHash:context.locationHash?route.legacyHash:''});
 const key=guildKeyFromHash(route.hash);
 if(key&&(guildActionFromHash(route.hash)==='tools'||['guild_games','guild_ar'].includes(key)&&[undefined,'start'].includes(guildActionFromHash(route.hash)))) {
  const tool=route.toolId?guildTool(key,route.toolId):undefined;
  return <RegisteredTools guildKey={key} toolId={route.toolId} client={context.client} memberKey={context.session.user.user_id} tool={tool} site={site} onNavigate={hash=>selectTab('guilds',hash)}>{tool?.tool_id==='arcade'?<Arcade/>:tool?<>{tool.tool_id==='work'&&<label className="field">工作檢視<select aria-label="工作檢視" value={route.tab==='tasks'?'discovery':'execution'} onChange={e=>selectTab(e.target.value==='discovery'?'tasks':'workbench')}><option value="execution">我的工作</option><option value="discovery">探索任務</option></select></label>}{content}</>:<p role="status">找不到這個工具。</p>}</RegisteredTools>;
 }
 return <>{route.place==='me'&&context.canManagePlatform&&<a className="btn btn-secondary btn-small" href="/admin">管理</a>}{route.place==='guilds'&&!key&&context.canManageGuild&&<button type="button" className="btn btn-secondary btn-small" onClick={()=>selectTab('guild-workspace')}>公會管理</button>}{route.place==='guilds'&&!key&&<GuildToolDirectory onOpen={hash=>selectTab('guilds',hash)}/ >}{choices.length>0&&<label className="field">檢視<select aria-label={`${route.place==='explore'?'探索':route.place==='me'?'我的':'自動化'}檢視`} value={selected?.hash??choices[0].hash} onChange={event=>{const c=choices.find(c=>c.hash===event.target.value);if(c)selectTab(c.tab,c.hash)}}>{choices.map(c=><option value={c.hash} key={c.hash}>{c.title}</option>)}</select></label>}{content}</>;
}
