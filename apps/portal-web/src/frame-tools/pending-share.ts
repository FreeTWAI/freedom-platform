import {operationPayloads,type ToolRecord} from '../../../../modules/guild-tools/contract';
import type {ShareComposeRequest} from '../share/share-port';
const KEY='freedom.guild-tool.pending-share.v1';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export async function saveToolShare(store:Store,tool:ToolRecord,request:ShareComposeRequest,route:string,signal?:AbortSignal){
 const parsed=operationPayloads['share.compose'].parse(request);let image:{type:string;data:string}|undefined;
 if(parsed.image){let binary='';for(const byte of new Uint8Array(await parsed.image.arrayBuffer()))binary+=String.fromCharCode(byte);image={type:parsed.image.type,data:btoa(binary)};}
 const value=JSON.stringify({version:1,created:Date.now(),id:tool.id,revision:tool.revision,guild:tool.guild_key,tool:tool.tool_id,route,request:{...parsed,image}});if(value.length>3000000)throw Error('draft_too_large');signal?.throwIfAborted();store.setItem(KEY,value);
 if(store.getItem(KEY)!==value)throw Error('draft_not_saved');
}
export function clearToolShare(store:Store){store.removeItem(KEY);}
export function readToolShare(store:Store){
 try{const raw=store.getItem(KEY);if(!raw||raw.length>3000000)return null;const p=JSON.parse(raw);if(p.version!==1||!Number.isFinite(p.created)||p.created>Date.now()+60000||Date.now()-p.created>86400000||typeof p.id!=='string'||!/^[0-9a-f-]{36}$/.test(p.id)||!Number.isInteger(p.revision)||p.revision<1||typeof p.guild!=='string'||p.guild.length>80||!/^guild_[a-zA-Z0-9_]+$/.test(p.guild)||typeof p.tool!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(p.tool)||!p.request)return null;
 const route=`#guilds/${p.guild}/tools/${p.tool}`;if(typeof p.route!=='string'||p.route.length>2048||!(p.route===route||p.route.startsWith(route+'?')))return null;
 const image=p.request.image;if(image&&(typeof image.data!=='string'||image.data.length>2800000||!/^[-A-Za-z0-9+/]+=*$/.test(image.data)))return null;
 const request=operationPayloads['share.compose'].parse({...p.request,image:image?new Blob([Uint8Array.from(atob(image.data),c=>c.charCodeAt(0))],{type:image.type}):undefined});
 return {id:p.id as string,revision:p.revision as number,guild:p.guild as string,tool:p.tool as string,route:p.route as string,request};
 }catch{return null;}
}
