import {z} from 'zod';
import {normalizeShareUrl,isOwnWorkshopHost} from '../../packages/shared/share-url.js';
import {Problem,requireCondition} from '../../packages/shared/problem.js';
import type {PreviewFetch} from '../community/link-preview.js';
import {BRIDGE_VERSION,toolInput,type ToolInput} from './contract.js';
export function toolUrl(raw:string,platformOrigin:string){
 let u:URL;try{u=new URL(raw);}catch{throw new Problem(422,'tool_url_invalid','請填寫完整的 HTTPS 網址。');}
 const normalized=normalizeShareUrl(raw);
 requireCondition(normalized.ok&&!u.search&&!u.hash&&!/[\s\\]/.test(raw)&&raw===raw.trim(),422,'tool_url_invalid','請用公開 HTTPS 網址，不含帳密、查詢或片段。');
 requireCondition(!isOwnWorkshopHost(u.hostname,platformOrigin),422,'tool_origin_forbidden','請使用平台以外的網站。');
 return new URL(normalized.url);
}
export async function inspectTool(input:unknown,platformOrigin:string,fetcher:PreviewFetch|undefined):Promise<ToolInput & {origin:string}>{
 if(input&&typeof input==='object'&&!Array.isArray(input)&&'bridge_version' in input)requireCondition(input.bridge_version===BRIDGE_VERSION,422,'tool_bridge_version','請使用 freedom.guild-launchpad/v2 橋接版本。');
 const parsed=toolInput.safeExtend({origin_challenge_id:z.uuid().optional()}).safeParse(input);requireCondition(parsed.success,422,'tool_invalid','請核對名稱、版本及允許功能。');
 const {origin_challenge_id,...body}=parsed.data,u=toolUrl(body.entry_url,platformOrigin);
 requireCondition(fetcher,503,'tool_egress_unavailable','此環境尚未安裝安全網址檢查。');
 let response:Response;
 try{response=await fetcher(u.href,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'text/html'}});}catch{throw new Problem(422,'tool_fetch_failed','無法安全讀取網站，請檢查公開網址。');}
 try {
 requireCondition(response.status>=200&&response.status<300,422,'tool_fetch_failed','網址須直接回傳頁面，不能重新導向。');
 const xfo=response.headers.get('x-frame-options');const csp=response.headers.get('content-security-policy');
 requireCondition(!xfo&&!(csp&&/frame-ancestors/i.test(csp)),422,'tool_frame_refused','網站限制嵌入，請請網站作者調整 frame-ancestors。');
 requireCondition((response.headers.get('content-type')??'').includes('text/html'),422,'tool_not_html','網址須指向 HTML 工具頁面。');
 }finally{await response.body?.cancel();}
 return {...body,entry_url:u.href,origin:u.origin};
}
/** Stored data is revalidated before it enters a security header. */
export function safeFrameOrigins(values:unknown[],platformOrigin:string){
 const result=new Set<string>();for(const raw of values){if(typeof raw!=='string')continue;try{const u=toolUrl(raw,platformOrigin);if(u.origin===raw)result.add(raw);}catch{/* corrupted data is never a header source */}}
 return [...result].sort().slice(0,64);
}
