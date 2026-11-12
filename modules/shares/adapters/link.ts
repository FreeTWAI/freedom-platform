import { createHash } from 'node:crypto';
import { normalizeShareUrl } from '../../../packages/shared/share-url.js';
import { Problem, requireCondition } from '../../../packages/shared/problem.js';
import { previewTitle, type PreviewFetch, PREVIEW_USER_AGENT } from '../../community/link-preview.js';
import type { ShareAdapter } from '../types.js';
/** Transport MUST be the host's DNS-pinned Node or allowlisted Worker preview transport. No global-fetch fallback. */
export async function fetchShareLink(raw:string,fetcher?:PreviewFetch) {
  const normalized=normalizeShareUrl(raw);
  requireCondition(normalized.ok,422,'invalid_share_url','請貼上公開 HTTPS 網址。');
  requireCondition(fetcher,503,'preview_unavailable','暫時無法讀取連結。');
  const signal=AbortSignal.timeout(6000);let current=normalized.url;
  for(let hop=0;hop<4;hop++) {
    const guard=normalizeShareUrl(current);requireCondition(guard.ok,422,'invalid_share_url','無法讀取這個網址。');
    let response:Response;
    try { response=await fetcher(guard.url,{redirect:'manual',signal,headers:{Accept:'text/html','User-Agent':PREVIEW_USER_AGENT}}); }
    catch { throw new Problem(422,'share_fetch_rejected','無法讀取這個公開網址。'); }
    if([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();const location=response.headers.get('location');
      requireCondition(location&&hop<3,422,'share_fetch_rejected','無法讀取這個公開網址。');
      try {current=new URL(location,guard.url).href;}catch{throw new Problem(422,'share_fetch_rejected','無法讀取這個網址。');}continue;
    }
    requireCondition(response.status===200&&!response.redirected,422,'share_fetch_rejected','無法讀取這個公開網址。');
    requireCondition(response.headers.get('content-type')?.toLowerCase().startsWith('text/html'),422,'share_content_type','請分享網頁連結。');
    const reader=response.body?.getReader();requireCondition(reader,422,'share_fetch_rejected','無法讀取這個公開網址。');
    const chunks:Uint8Array[]=[];let bytes=0;
    try { for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;requireCondition(bytes<=1048576,422,'share_too_large','網頁過大。');chunks.push(value);} }
    finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    return {url:normalized.url,title:previewTitle(Buffer.concat(chunks).toString('utf8'))??new URL(normalized.url).hostname};
  }
  throw new Problem(422,'share_fetch_rejected','無法讀取這個公開網址。');
}
export const linkAdapter:ShareAdapter={kind:'link',async prepare(input,context){
  const page=await fetchShareLink(input.url??'',context.previewFetch);
  return {kind:'link',canonical_key:`url:${createHash('sha256').update(page.url).digest('hex')}`,canonical_url:page.url,title:page.title};
}};
