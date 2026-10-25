import { useEffect, useRef, useState } from 'react';
import { WorkshopIcon } from './WorkshopIcon';
import type { TabId } from './types';
import {useLanguage} from './language';
import type {InterfaceMessage} from './interface-messages';

import { TAB_TITLES } from './features/metadata';
export { TAB_TITLES } from './features/metadata';

const primary: TabId[] = ['home', 'my-content', 'guilds', 'skills'];
const keywords:Partial<Record<TabId,string>>={ar:'相機 圖案 掃描 衣服 海報 名片',messages:'聊天室 對話 私訊',members:'人才 找夥伴 媒合',skills:'學習 資源 免費',tasks:'任務 貢獻 參與','private-ai':'私人 AI 草稿 模型 執行',workbench:'工作 任務',showcase:'作品 分享 展示 需求 找人',opensource:'投稿 提交 上傳 GitHub 開源 工具 技能',supplier:'商品 商店 供應商',retail:'電商 販售 商店',account:'個人資料 設定 暱稱',friends:'朋友 好友 私訊',business:'業務 工作區 邀請',reservations:'預留 訂單 查詢 取消',stores:'商店 開店 店鋪 商品 上架 發布','tester-map':'測試 測試週 回報 問題 社群測試'};
const groups: { label: string; pages: TabId[] }[] = [
  { label: '社群參與', pages: ['ar','events', 'tasks', 'highlights'] },
  { label: '認識夥伴', pages: ['members', 'friends', 'positioning', 'squads', 'cocreation'] },
  { label: '分享推廣', pages: ['services', 'promotion'] },
  { label: '創作與合作', pages: ['workbench', 'private-ai', 'opensource', 'showcase', 'engagement'] },
  { label: '供貨與銷售', pages: ['reservations', 'stores', 'supplier', 'retail', 'marketing'] },
  { label: '管理', pages: ['guild-workspace', 'business'] },
];

export function Navigation({ current, onSelect, canManageGuild, guildLaunchpadEnabled, communitySearchEnabled, personalContentEnabled, mobileOpen, currentHash = `#${current}` }: {
  current: TabId; onSelect: (id: TabId, hash?: string) => void; currentHash?: string; canManageGuild: boolean; guildLaunchpadEnabled: boolean; communitySearchEnabled: boolean; personalContentEnabled: boolean; mobileOpen: boolean;
}) {
  const {t}=useLanguage();
  const groupKeys:Record<string,InterfaceMessage>={'社群參與':'nav.participation','認識夥伴':'nav.people','分享推廣':'nav.promotionGroup','創作與合作':'nav.creation','供貨與銷售':'nav.commerce','管理':'nav.management'};
  const [query,setQuery]=useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const nav = useRef<HTMLElement>(null), moreTrigger = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<string[]>(() => groups.filter(group => group.pages.includes(current)).map(group => group.label));
  useEffect(() => { setExpanded(groups.filter(group => group.pages.includes(current)).map(group => group.label)); }, [current]);
  useEffect(() => { setMoreOpen(false); }, [current]);
  useEffect(() => { if (moreOpen) searchRef.current?.focus(); else setQuery(''); }, [moreOpen]);
  useEffect(() => { const close=(event:PointerEvent)=>{if(!nav.current?.contains(event.target as Node))setMoreOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchMatches = (Object.keys(TAB_TITLES) as TabId[]).filter(id=>(id!=='community-search'||communitySearchEnabled)&&(id!=='my-content'||personalContentEnabled)&&(id!=='guild-workspace'||canManageGuild)&&(id!=='business'||guildLaunchpadEnabled)&&`${t(`nav.${id}`)} ${TAB_TITLES[id]} ${keywords[id]??''}`.toLocaleLowerCase().includes(normalizedQuery));
  const supplyMatches = guildLaunchpadEnabled && `${t('stores.supplyTitle')} 供應商 供貨 商品庫`.toLocaleLowerCase().includes(normalizedQuery);
  const supplySelected = /^#stores\/(?:supply$|[^/]+\/[^/]+\/supply(?:-orders)?(?:[/?]|$))/.test(currentHash);
  const item = (id: TabId, title: InterfaceMessage = `nav.${id}`, hash = `#${id}`) => {
    const active = current === id && (id !== 'stores' || supplySelected === (hash === '#stores/supply'));
    return <button key={hash} type="button" className={`nav-item${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined} onClick={() => {setMoreOpen(false);setQuery('');onSelect(id, hash)}}>
      <WorkshopIcon name={id}/><span>{t(title)}</span>
    </button>;
  };
  return <nav ref={nav} id="workspace-navigation" className={`nav workspace-navigation${mobileOpen ? ' is-open' : ''}`} aria-label={t('nav.main')} onKeyDown={event=>{if(event.key!=='Escape'||!moreOpen)return;event.stopPropagation();if(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;event.preventDefault();setMoreOpen(false);moreTrigger.current?.focus()}}>
    <div className="nav-primary">{primary.filter(id => id !== 'my-content' || personalContentEnabled).map(id => item(id))}{communitySearchEnabled && item('community-search')}</div>
    <details className="nav-section nav-more" open={moreOpen}>
      <summary ref={moreTrigger} aria-expanded={moreOpen} onClick={event => { event.preventDefault(); setMoreOpen(value => !value); }}>{t('nav.more')}<span aria-hidden="true">⌄</span></summary>
      <div className="nav-more-content">
    <label className="nav-search"><span className="sr-only">{t('nav.search')}</span><input ref={searchRef} type="search" autoComplete="off" value={query} onChange={event=>setQuery(event.target.value)} maxLength={80} placeholder={t('nav.example')} onKeyDown={event=>{if(event.key==='Escape'&&query&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229){event.preventDefault();event.stopPropagation();setQuery('')}}}/></label>
    <p className="field-hint" role="status" aria-atomic="true">{normalizedQuery && !supplyMatches && searchMatches.length===0 ? <>{t('nav.results')} · 0. {t('nav.searchHint')}</> : ''}</p>
    {query.trim()?<div className="nav-search-results" role="region" aria-label={t('nav.results')}>{supplyMatches && item('stores', 'stores.supplyTitle', '#stores/supply')}{searchMatches.map(id => item(id))}{(supplyMatches || searchMatches.length > 0) && <p className="field-hint">{t('nav.searchHint')}</p>}</div>:<>
    {groups.map(group => <details className="nav-section" key={group.label} open={expanded.includes(group.label)}>
      <summary onClick={event => { event.preventDefault(); setExpanded(value => value.includes(group.label) ? value.filter(label => label !== group.label) : [...value, group.label]); }}>
        {t(groupKeys[group.label])}<span aria-hidden="true">⌄</span>
      </summary>
      <div className="nav-section-items">
        {group.label === '供貨與銷售' && guildLaunchpadEnabled && item('stores', 'stores.supplyTitle', '#stores/supply')}
        {group.pages.filter(id => (id !== 'my-content' || personalContentEnabled) && (id !== 'guild-workspace' || canManageGuild) && (id !== 'business' || guildLaunchpadEnabled)).map(id => item(id))}
        {group.label === '管理' && <a className="nav-item" href="/admin">{t('nav.admin')} <span aria-hidden="true">↗</span></a>}
      </div>
    </details>)}
    <div className="nav-footer">{item('community')}</div>
    </>}
      </div>
    </details>
  </nav>;
}
