import {z} from 'zod';
import {normalizeShareUrl,isOwnWorkshopHost} from '../../packages/shared/share-url.js';
import {Problem,requireCondition} from '../../packages/shared/problem.js';
import type {PreviewFetch} from '../community/link-preview.js';
import {BRIDGE_VERSION,toolInput,type ToolInput} from './contract.js';
import type {GuildToolFetch} from './transport.js';
const REDIRECT_STATUSES=new Set([301,302,303,307,308]);
export async function fetchToolWithRedirects(fetcher:GuildToolFetch,startUrl:string,accept:string,errorCode:'tool_fetch_failed'|'origin_proof_failed',platformOrigin?:string):Promise<Response>{
 const entryOrigin=new URL(startUrl).origin,signal=AbortSignal.timeout(8000);
 let current=startUrl;
 for(let hops=0;;hops++){
  let response:Response;
  try{response=await fetcher(current,{redirect:'manual',signal,headers:{Accept:accept}});}catch{throw new Problem(422,errorCode,errorCode==='origin_proof_failed'?'無法讀取根目錄驗證檔。':'無法安全讀取網站，請檢查公開網址。');}
  if(response.status>=300&&response.status<400){
   await response.body?.cancel();
   const raw=response.headers.get('location')?.trim();
   if(!REDIRECT_STATUSES.has(response.status)||hops>=3||!raw||/[\s\\\u0000-\u001f\u007f]/.test(raw)){
    throw new Problem(422,errorCode,errorCode==='origin_proof_failed'?'驗證檔重新導向無效或次數過多。':'網址重新導向無效或次數過多。');
   }
   let next:URL;
   try{
    if(/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw))fetcher.assertUrl?.(raw.startsWith('//')?'https:'+raw:raw);
    next=new URL(raw,current);
    if(next.origin!==entryOrigin)throw new Error('cross_origin');
    if(platformOrigin)toolUrl(next.href,platformOrigin);
    else{const normalized=normalizeShareUrl(next.href);if(!normalized.ok||next.search||next.hash)throw new Error('bad_url');}
    fetcher.assertUrl?.(next.href);
   }catch{throw new Problem(422,errorCode,errorCode==='origin_proof_failed'?'驗證檔重新導向無效。':'網址重新導向無效。');}
   current=next.href;continue;
  }
  return response;
 }
}
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
 requireCondition(body.profile!=='origin'||u.pathname==='/',422,'tool_origin_root_required','獨立來源工具網址須在根目錄；子路徑請改用隔離模式。');
 requireCondition(fetcher,503,'tool_egress_unavailable','此環境尚未安裝安全網址檢查。');
 const response=await fetchToolWithRedirects(fetcher,u.href,'text/html','tool_fetch_failed',platformOrigin);
 try {
 requireCondition(response.status>=200&&response.status<300,422,'tool_fetch_failed','網址須直接回傳頁面，不能重新導向。');
 const xfo=response.headers.get('x-frame-options');const csp=response.headers.get('content-security-policy');
 requireCondition(!xfo?.trim()&&frameAncestorsAllowed(csp,platformOrigin),422,'tool_frame_refused','網站限制嵌入，請請網站作者調整 frame-ancestors。');
 requireCondition((response.headers.get('content-type')??'').includes('text/html'),422,'tool_not_html','網址須指向 HTML 工具頁面。');
 }finally{await response.body?.cancel();}
 return {...body,entry_url:u.href,origin:u.origin};
}
function frameAncestorsAllowed(csp:string|null,platformOrigin:string):boolean{
 if(!csp)return true;
 const platformUrl=new URL(platformOrigin);
 const normalizedOrigin=platformUrl.origin.toLowerCase(),rawOrigin=platformOrigin.toLowerCase(),platformHost=platformUrl.hostname.toLowerCase();
 for(const policy of csp.split(',')){
  const directive=policy.split(';').map(d=>d.trim()).find(d=>/^frame-ancestors(?:\s|$)/i.test(d));
  if(!directive)continue;
  const ok=directive.split(/\s+/).slice(1).some(src=>{
   const lower=src.toLowerCase();
   if(lower==='*'||lower==='https:'||lower===normalizedOrigin||lower===rawOrigin)return true;
   if(lower.startsWith('https://*.')){const domain=lower.slice('https://*.'.length);return domain.length>0&&!/[:/*]/.test(domain)&&platformHost.endsWith('.'+domain);}
   return false;
  });
  if(!ok)return false;
 }
 return true;
}
/** Stored data is revalidated before it enters a security header. */
export function safeFrameOrigins(values:unknown[],platformOrigin:string){
 const result=new Set<string>();for(const raw of values){if(typeof raw!=='string')continue;try{const u=toolUrl(raw,platformOrigin);if(u.origin===raw)result.add(raw);}catch{/* corrupted data is never a header source */}}
 return [...result].sort().slice(0,64);
}
