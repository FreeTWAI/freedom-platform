import {GuildToolDirectory} from '../guild-tools/GuildToolDirectory';
import {guildTool} from '../guild-tools/catalog';
import {TOOL_ONLY_GUILDS,guildKeyFromHash,guildActionFromHash} from '../modules/guild-launchpad-route';
import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {ExploreFeatureSearchContext,type ExploreFeatureMatch} from '../modules/explore-feature-search';
import {useLanguage} from '../language';
import type {InterfaceMessage} from '../interface-messages';
import {TAB_TITLES} from './metadata';
import type {ReactNode} from 'react';
import type {PortalFeatureContext} from './types';
import {portalHash,resolvePortalRoute} from '../portal-route';
import type {TabId} from '../types';
const AgentTokens=lazy(()=>import('../modules/AgentTokens').then(m=>({default:m.AgentTokens})));
const Arcade=lazy(()=>import('../games/AbsurdDaily').then(m=>({default:m.AbsurdDaily})));
const ClientConnections=lazy(()=>import('../modules/ClientConnections').then(m=>({default:m.ClientConnections})));
const CommunitySaved=lazy(()=>import('./CommunitySaved').then(m=>({default:m.CommunitySaved})));
const DeviceConnections=lazy(()=>import('../modules/DeviceConnections').then(m=>({default:m.DeviceConnections})));
const ModelSettings=lazy(()=>import('../modules/ModelSettings').then(m=>({default:m.ModelSettings})));
const RegisteredTools=lazy(()=>import('../frame-tools/RegisteredTools').then(m=>({default:m.RegisteredTools})));

/** Integration ports: the share launcher (share/ShareBox) stays in App; agent-door mounts in automation below. */
export function PlaceView({context,render,defaultTab}:{context:PortalFeatureContext;defaultTab:TabId;render:(tab:TabId,context:PortalFeatureContext)=>ReactNode}) {
 const route=resolvePortalRoute(context.locationHash||'#'+defaultTab);
 const {site,selectTab}=context;
 const {t}=useLanguage();
 const searchFeatures=useCallback((q:string)=>matchExploreFeatures(q,context,t),[context,t]);
 let choices:{title:string;hash:string;tab:TabId}[]=[];
 const choice=(title:string,tab:TabId,hash=portalHash(tab))=>({title,tab,hash});
 if(route.place==='explore')choices=[...(site?.community_search_enabled?[choice('搜尋','community-search')]:[]),choice('夥伴','members'),choice('資源','skills'),choice('作品','showcase'),choice('活動','events'),choice('成果','highlights'),choice('服務','services')];
 if(route.place==='me')choices=[choice('個人頁','profile'),...(site?.community_relations_enabled?[choice('書籤與追蹤','profile','#me/saved')]:[]),choice('設定','account'),choice('入門','todos'),choice('訊息','messages'),choice('聯絡人','friends'),choice('小隊','squads'),choice('工作區','business'),choice('訂單','reservations'),choice('我的貢獻','promotion')];
 if(route.place==='automation')choices=[choice('我的 Agent','private-ai','#automation/agent'),...(site?.private_ai_enabled?[choice('私人工作','private-ai'),choice('裝置連線','private-ai','#automation/devices'),choice('模型設定','private-ai','#automation/models')]:[]),choice('工具連線','private-ai','#automation/connections')];
 const selected=choices.filter(c=>route.hash===c.hash||route.hash.startsWith(c.hash+'/')||route.hash.startsWith(c.hash+'?')).sort((a,b)=>b.hash.length-a.hash.length)[0];
 let tab=route.tab==='messages'?'home':route.tab;
 if(route.place==='explore'&&tab==='community-search'&&!site?.community_search_enabled)tab='skills';
 let content:ReactNode;
 const path=route.hash.split('?')[0];
 if(path==='#automation/agent')content=<AgentTokens client={context.client}/>;
 else if(path==='#automation/connections')content=<ClientConnections client={context.client}/>;
 else if(route.place==='automation'&&!site?.private_ai_enabled)content=<AgentTokens client={context.client}/>;
 else if(path==='#automation/devices')content=<DeviceConnections client={context.client}/>;
 else if(path==='#automation/models')content=<ModelSettings client={context.client}/>;
 else if(path==='#me/saved'){const authKey=`${context.session.user.user_id}:${context.client.sessionGeneration}`;content=site?.community_relations_enabled?<CommunitySaved key={authKey} client={context.client} authKey={authKey}/>:<section className="card stack"><h2>書籤與追蹤</h2><p className="field-hint">這個社群尚未開放書籤與追蹤。</p></section>;}
 else content=render(tab,{...context,locationHash:context.locationHash?route.legacyHash:''});
 const key=guildKeyFromHash(route.hash);
 if(key&&(guildActionFromHash(route.hash)==='tools'||TOOL_ONLY_GUILDS.some(value=>value===key)&&[undefined,'start'].includes(guildActionFromHash(route.hash)))) {
  const tool=route.toolId?guildTool(key,route.toolId):undefined;
  return <Suspense fallback={<p role="status">載入工具…</p>}><RegisteredTools guildKey={key} toolId={route.toolId} client={context.client} memberKey={context.session.user.user_id} tool={tool} site={site} onNavigate={hash=>selectTab('guilds',hash)}>{tool?.tool_id==='arcade'?<Arcade/>:tool?<>{tool.tool_id==='work'&&<label className="field">工作檢視<select aria-label="工作檢視" value={route.tab==='tasks'?'discovery':'execution'} onChange={e=>selectTab(e.target.value==='discovery'?'tasks':'workbench')}><option value="execution">我的工作</option><option value="discovery">探索任務</option></select></label>}{content}</>:<p role="status">找不到這個工具。</p>}</RegisteredTools></Suspense>;
 }
 return <>{route.place==='guilds'&&!key&&route.tab==='guilds'&&<button type="button" className="btn btn-secondary btn-small" onClick={()=>selectTab('community')}>社群</button>}{route.place==='me'&&context.canManagePlatform&&<a className="btn btn-secondary btn-small" href="/admin">管理</a>}{route.place==='guilds'&&!key&&route.tab==='guilds'&&context.canManageGuild&&<button type="button" className="btn btn-secondary btn-small" onClick={()=>selectTab('guild-workspace')}>公會管理</button>}{route.place==='guilds'&&!key&&route.tab==='guilds'&&<GuildToolDirectory onOpen={hash=>selectTab('guilds',hash)}/>}{choices.length>0&&<label className="field place-view-picker">檢視<select aria-label={`${route.place==='explore'?'探索':route.place==='me'?'我的':'自動化'}檢視`} value={selected?.hash??choices[0].hash} onChange={event=>{const c=choices.find(c=>c.hash===event.target.value);if(c)selectTab(c.tab,c.hash)}}>{choices.map(c=><option value={c.hash} key={c.hash}>{c.title}</option>)}</select></label>}{path==='#explore'&&!site?.community_search_enabled&&<PlaceFeatureSearch context={context}/>}{path==='#explore'&&site?.community_search_enabled?<ExploreFeatureSearchContext.Provider value={searchFeatures}>{content}</ExploreFeatureSearchContext.Provider>:content}</>;
}

const keywords:Partial<Record<TabId,string>>={'community-hub':'社群 入口 LINE Discord Claude Codex Grok',ar:'相機 圖案 掃描 衣服 海報 名片',messages:'聊天室 對話 私訊',members:'人才 找夥伴 媒合',skills:'學習 資源 免費',tasks:'任務 貢獻 參與','private-ai':'私人工作與 AI 私人 AI 工作室 草稿 模型 執行',workbench:'我的工作 任務協作 認領任務 提交成果',showcase:'作品與需求 作品與合作 分享 展示 需求 找人',opensource:'投稿 提交 上傳 GitHub 開源 工具 技能',supplier:'商品 商店 供應商',retail:'電商 販售 商店',account:'個人資料 設定 暱稱',friends:'朋友 好友 私訊',business:'業務 工作區 邀請',reservations:'預留 訂單 查詢 取消',stores:'商店 開店 店鋪 商品 上架 發布','tester-map':'測試 測試週 回報 問題 社群測試'};
const commerceLabels:Partial<Record<TabId,InterfaceMessage>>={reservations:'nav.commerceOrders',supplier:'nav.commerceSupplier',retail:'nav.commerceRetail'};
const commercePurposes:Partial<Record<TabId,InterfaceMessage>>={stores:'nav.commerceStorePurpose',reservations:'nav.commerceOrdersPurpose',marketing:'nav.commerceMarketingPurpose',supplier:'nav.commerceSupplierPurpose',retail:'nav.commerceRetailPurpose'};
function matchExploreFeatures(rawQuery:string,context:PortalFeatureContext,t:ReturnType<typeof useLanguage>['t']):ExploreFeatureMatch[] {
 const normalized=rawQuery.trim().toLocaleLowerCase(),site=context.site;
 if(!normalized)return [];
 const matches=(Object.keys(TAB_TITLES) as TabId[]).filter(id=>!['community-search','members','skills','showcase','events','highlights','services'].includes(id)&&(id!=='my-content'||site?.personal_content_enabled)&&(id!=='guild-workspace'||context.canManageGuild)&&`${t(commerceLabels[id]??`nav.${id}`)} ${t(`nav.${id}`)} ${TAB_TITLES[id]} ${keywords[id]??''} ${commercePurposes[id]?t(commercePurposes[id]):''}`.toLocaleLowerCase().includes(normalized));
 const supplyMatches=site?.guild_launchpad_enabled&&`${t('nav.commerceSupply')} ${t('stores.supplyTitle')} ${t('nav.commerceSupplyPurpose')} 供應商 供貨 商品庫`.toLocaleLowerCase().includes(normalized);
 return [
  ...(supplyMatches?[{id:'__supply__',label:t('nav.commerceSupply'),select:()=>context.selectTab('stores',portalHash('stores','/supply'))}]:[]),
  ...matches.map(id=>({id,label:t(commerceLabels[id]??`nav.${id}`),select:()=>context.selectTab(id,portalHash(id))})),
 ];
}
/** Feature lookup lives inside Explore when community search is disabled, alongside the unified search otherwise. */
function PlaceFeatureSearch({context}:{context:PortalFeatureContext}) {
 const {t}=useLanguage(),[query,setQuery]=useState(''),[open,setOpen]=useState(false);
 const root=useRef<HTMLDetailsElement>(null),trigger=useRef<HTMLElement>(null),input=useRef<HTMLInputElement>(null);
 const normalized=query.trim().toLocaleLowerCase();
 useEffect(()=>{if(open)input.current?.focus();else setQuery('');},[open]);
 useEffect(()=>{setOpen(false);},[context.locationHash]);
 useEffect(()=>{const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 const allMatches=matchExploreFeatures(query,context,t);
 return <details ref={root} className="card place-feature-search" open={open} onKeyDown={event=>{
  if(event.key!=='Escape'||!open)return;event.stopPropagation();
  if(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;
  event.preventDefault();if(query)setQuery('');else{setOpen(false);trigger.current?.focus();}
 }}>
  <summary ref={trigger} aria-expanded={open} onClick={event=>{event.preventDefault();setOpen(value=>!value);}}>{t('nav.search')}</summary>
  <div className="stack place-feature-search-content">
   <label className="field"><span>{t('nav.search')}</span><input ref={input} type="search" autoComplete="off" maxLength={80} value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('nav.example')}/></label>
   <p className="field-hint" role="status" aria-atomic="true">{normalized&&!allMatches.length?<>{t('nav.results')} · 0. {t('nav.searchHint')}</>:''}</p>
   {normalized&&<div className="actions" role="region" aria-label={t('nav.results')}>{allMatches.map(match=><button className="btn btn-secondary btn-small" key={match.id} type="button" onClick={()=>{setOpen(false);setQuery('');match.select();}}>{match.label}</button>)}</div>}
  </div>
 </details>;
}
