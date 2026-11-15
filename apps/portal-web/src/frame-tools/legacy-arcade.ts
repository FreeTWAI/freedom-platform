import {parseCookbook,readCookingRun} from '../games/cooking/storage';
import {readMarket} from '../games/cooking/market-domain';
import {parseGameDraft} from '../games/result-bridge';
import type {DeviceState} from './device-state';
import type {ToolRecord} from '../../../../modules/guild-tools/contract';
export const LEGACY_ARCADE_KEYS=['freedom.cooking.cookbook.v1','freedom.cooking.cookbook.backup.v1','freedom.cooking.run.v1','freedom.cooking.market.v1','freedom.absurd-daily.pending.v1'] as const;
function timestamp(key:string,raw:string|null):number|null{
 if(!raw||new TextEncoder().encode(raw).length>1300000)return null;
 try{const x=JSON.parse(raw);if(key.includes('cookbook'))return parseCookbook(raw)?x.savedAt:null;
 if(key.endsWith('run.v1'))return readCookingRun({getItem:()=>raw,setItem(){},removeItem(){}}).run?x.savedAt:null;
 if(key.endsWith('market.v1'))return readMarket({getItem:()=>raw})?x.savedAt:null;
 return parseGameDraft(raw)?x.createdAt:null;}catch{return null;}
}
/** Exact schemas and five keys only. Preserve original bytes, including the backup. */
export function importArcadeState(state:DeviceState,local:Pick<Storage,'getItem'>,session:Pick<Storage,'getItem'>){
 for(const key of LEGACY_ARCADE_KEYS){try{const source=key.includes('cookbook')?local:session,raw=source.getItem(key),time=timestamp(key,raw),existing=timestamp(key,state.get(key));if(raw&&time!==null&&(existing===null||time>existing))state.put(key,raw);}catch{/* Original bytes remain available for recovery; never delete on quota/storage failure. */}}
}
export function arcadeEntry(tool:ToolRecord){
 if(tool.guild_key!=='guild_games'||tool.tool_id!=='arcade')return tool.entry_url;
 const u=new URL(tool.entry_url),query=new URLSearchParams(location.hash.split('?')[1]??location.search);
 for(const key of ['game','recipe','practice','seed']){const v=query.get(key);if(v&&/^[a-zA-Z0-9-]{1,48}$/.test(v))u.searchParams.set(key,v);}
 return u.href;
}
