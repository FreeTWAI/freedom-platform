import type {TabId} from './types';

export type PortalPlace = 'home' | 'explore' | 'guilds' | 'automation' | 'me';
export const PORTAL_PLACES = [
  {id:'home', title:'動態', tab:'home'}, {id:'explore', title:'探索', tab:'community-search'},
  {id:'guilds', title:'公會', tab:'guilds'}, {id:'automation', title:'自動化', tab:'private-ai'},
  {id:'me', title:'我的', tab:'profile'},
] as const;

/** One compatibility table. IDs/suffixes and raw query bytes are never decoded or discarded. */
export const LEGACY_ROUTES: Readonly<Record<TabId, string>> = {
  home:'home', social:'home', profile:'me', account:'me/settings', 'my-content':'me/content', todos:'me/start',
  members:'explore/people', skills:'explore/resources', showcase:'explore/works', events:'explore/events',
  services:'explore/services', highlights:'explore/events/results', 'community-search':'explore',
  opensource:'home/share/resource', guilds:'guilds', community:'guilds/community', 'community-hub':'guilds/community',
  'private-ai':'automation/work', messages:'me/messages', friends:'me/messages/contacts', squads:'me/teams',
  business:'me/workspaces', reservations:'me/orders', promotion:'me/credit',
  stores:'guilds/guild_commerce_sales/tools/store', retail:'guilds/guild_commerce_sales/tools/retail-kit',
  'virtual-commerce':'guilds/guild_commerce_sales/tools/rehearsal',
  supplier:'guilds/guild_product_quality_supply/tools/supplier-kit',
  marketing:'guilds/guild_marketing/tools/marketing', cocreation:'guilds/guild_ai_vibe/tools/cocreation',
  workbench:'guilds/guild_ai_project/tools/work', tasks:'guilds/guild_ai_project/tools/work/discovery',
  engagement:'guilds/guild_opportunity_partnership/tools/engagement',
  positioning:'guilds/guild_talent_direction/tools/assessment', 'newbie-village':'guilds/guild_talent_direction/tools/village',
  'tester-map':'guilds/guild_custom_032fd02e754549e9b1e056e2b95b8d50/tools/tester-map',
  ar:'guilds/guild_ar/tools/ar', 'guild-workspace':'guilds/manage',
};
const catalog = 'guilds/guild_product_quality_supply/tools/catalog';
const matches = (path:string, prefix:string) => path===prefix || path.startsWith(prefix+'/');
const split = (hash:string) => {const raw=hash.replace(/^#/, ''); const i=raw.indexOf('?'); return i<0?[raw,'']:[raw.slice(0,i),raw.slice(i)];};
export function canonicalHash(hash:string):string {
  const [path,query]=split(hash);
  if(path==='automation')return '#automation/agent'+query;
  if(matches(path,'me/shares'))return '#me/credit'+path.slice('me/shares'.length)+query;
  if(matches(path,'stores/supply'))return '#'+catalog+path.slice('stores/supply'.length)+query;
  if(/^stores\/[^/]+\/[^/]+\/supply(?:-orders)?(?:\/|$)/.test(path))return '#'+catalog+path.slice('stores'.length)+query;
  if(matches(path,'squad-outcomes'))return '#me/teams/outcomes'+path.slice('squad-outcomes'.length)+query;
  const first=path.split('/')[0] as TabId;
  if(Object.hasOwn(LEGACY_ROUTES,first))return '#'+LEGACY_ROUTES[first]+path.slice(first.length)+query;
  return '#'+path+query;
}
export function portalHash(tab:TabId,suffix='',query=''):string {
  return canonicalHash('#'+tab+suffix+(query?(query.startsWith('?')?query:'?'+query):''));
}
export function legacyHash(hash:string):string {
  const [path,query]=split(canonicalHash(hash));
  if(matches(path,catalog)){const suffix=path.slice(catalog.length);return '#stores'+(/^\/[^/]+\/[^/]+\/supply(?:-orders)?(?:\/|$)/.test(suffix)?suffix:'/supply'+suffix)+query;}
  if(matches(path,'me/teams/outcomes'))return '#squad-outcomes'+path.slice('me/teams/outcomes'.length)+query;
  const rows=Object.entries(LEGACY_ROUTES).filter(([tab])=>tab!=='social'&&tab!=='community-hub').sort((a,b)=>b[1].length-a[1].length);
  for(const [tab,prefix] of rows)if(matches(path,prefix))return '#'+tab+path.slice(prefix.length)+query;
  return '#'+path+query;
}
export type PortalRoute = {hash:string; legacyHash:string; place:PortalPlace; tab:TabId; ownerOnly:boolean; guildKey?:string; toolId?:string};
export function resolvePortalRoute(hash:string):PortalRoute {
  const canonical=canonicalHash(hash), legacy=legacyHash(canonical);
  const [path]=split(canonical);
  const first=path.split('/')[0];
  const shareObject=/^shares\/[0-9a-f-]{36}$/i.test(path);
  const place:PortalPlace=shareObject?'explore':PORTAL_PLACES.some(p=>p.id===first)?first as PortalPlace:'home';
  const old=split(legacy)[0].split('/')[0];
  const tab:TabId=shareObject?'community-search':place==='automation'?'private-ai':old==='squad-outcomes'?'squads':Object.hasOwn(LEGACY_ROUTES,old)?old as TabId:'home';
  const tool=/^guilds\/(guild_[a-zA-Z0-9_]+)\/tools\/([^/?]+)(?:\/|$)/.exec(path);
  // This is a presentation hint, never authorization. Guest rendering still uses the original ACL path.
  const visitor=/^#profile\?member=[0-9a-f-]{36}$/i.test(legacy);
  return {hash:canonical,legacyHash:legacy,place,tab,ownerOnly:(place==='me'&&!visitor)||place==='automation',guildKey:tool?.[1],toolId:tool?.[2]};
}
export function currentLegacyHash():string {return legacyHash(window.location.hash);}
export function privateWorkId(hash:string):string|undefined {
  const [path,query]=split(legacyHash(hash));
  if(!matches(path,'private-ai'))return undefined;
  const id=path.slice('private-ai/'.length)||new URLSearchParams(query).get('work');
  return id&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)?id:undefined;
}
/** Call only after existing navigation/leave checks; replace never creates an extra Back step. */
export function replaceLegacyAddress():string {
  const next=canonicalHash(window.location.hash);
  if(window.location.hash&&next!==window.location.hash)window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search+next);
  return window.location.hash;
}
