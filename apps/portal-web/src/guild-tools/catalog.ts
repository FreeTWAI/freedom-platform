import {guildRoute} from '../modules/guild-launchpad-route';
import type {TabId} from '../types';
import {LEGACY_ROUTES} from '../portal-route';
export type GuildTool = {tool_id:string;guild_key:string;title:string;kind:'native'|'frame';old_routes:readonly string[];tab?:TabId};
const native=(tab:TabId,title:string,tool_id?:string):GuildTool=>{
 const parts=LEGACY_ROUTES[tab].split('/');
 return {tool_id:tool_id??parts[3],guild_key:parts[1],title,kind:'native',old_routes:['#'+tab],tab};
};
/** Server frame entries can be appended by a registry adapter. The host dispatches by kind. */
export const GUILD_TOOLS:readonly GuildTool[]=[
 native('stores','商店'),native('retail','零售工具'),native('virtual-commerce','銷售彩排'),
 {tool_id:'catalog',guild_key:'guild_product_quality_supply',title:'供貨商品庫',kind:'native',old_routes:['#stores/supply','#stores/:tenant/:store/supply','#stores/:tenant/:store/supply-orders'],tab:'stores'},
 native('supplier','供貨工具'),native('marketing','行銷'),native('cocreation','作品共創'),
 {...native('workbench','工作'),old_routes:['#workbench','#tasks']},native('engagement','合作紀錄'),
 native('positioning','定位測驗'),native('newbie-village','新手村'),native('tester-map','測試地圖'),native('ar','AR 互動'),
 {tool_id:'arcade',guild_key:'guild_games',title:'遊戲大廳',kind:'native',old_routes:['/play']},
];
export const guildTool=(guildKey:string,toolId:string)=>GUILD_TOOLS.find(t=>t.guild_key===guildKey&&t.tool_id===toolId);
export const toolHash=(tool:Pick<GuildTool,'guild_key'|'tool_id'>)=>guildRoute(tool.guild_key,'tools',tool.tool_id);
