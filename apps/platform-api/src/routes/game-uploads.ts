import {Hono,type Context} from 'hono';
import {z} from 'zod';
import type {Pool} from 'pg';
import type {ObjectStore} from '../../../../packages/asset-storage/index.js';
import {readBounded,AssetStorageError} from '../../../../packages/asset-storage/index.js';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import {authRateLimit} from '../../../../modules/identity-membership/members.js';
import {createGameDraft,readGameDraft,uploadGameSource,withdrawGameDraft} from '../../../../modules/absurd-daily/game-quarantine.js';
import {GameUploadSourceError,GAME_UPLOAD_SOURCE_MAX_BYTES} from '../../../../modules/absurd-daily/game-upload-source.js';
import type {PlatformEnv} from '../module-context.js';
export function isGameSourceUpload(method:string,path:string){
 const match=method==='POST'?/^\/api\/v1\/me\/game-drafts\/([0-9a-fA-F-]{36})\/source$/.exec(path):null;
 return Boolean(match&&z.uuid().safeParse(match[1]).success);
}
export function checkGameSourceHeaders(type?:string,length?:string){
 requireCondition(type==='text/html',415,'game_source_type','請上傳單一 UTF-8 HTML 檔案。');
 if(length!==undefined)requireCondition(/^[0-9]+$(?![\s\S])/.test(length)&&Number(length)<=GAME_UPLOAD_SOURCE_MAX_BYTES,413,'game_source_too_large','遊戲來源需為 256 KiB 以下。');
}
function command(c:Context<PlatformEnv>,versionRequired=true){
 const version=c.req.header('If-Match'),key=c.req.header('Idempotency-Key')??'';
 if(versionRequired)requireCondition(version&&/^"[1-9][0-9]{0,18}"$(?![\s\S])/.test(version),version?400:428,'version_required','請重新載入遊戲草稿。');
 requireCondition(/^[A-Za-z0-9_-]{8,128}$(?![\s\S])/.test(key),400,'idempotency_required','請提供有效的 Idempotency-Key。');
 return {actor:c.get('actor'),key,operation:`${c.req.method} ${c.req.path}`,expected:versionRequired?version!.slice(1,-1):undefined,body:null};
}
/** One absolute transport deadline, disconnect cancellation and bounded bytes.
 * Cancellation is not awaited: an upstream cancel promise cannot stall the route. */
export async function readGameSourceRequest(request:Request):Promise<Uint8Array>{
 requireCondition(request.body,422,'invalid_game_source','請選擇遊戲來源。');
 const reader=request.body!.getReader();let stopped=false;
 const stop=()=>{stopped=true;void reader.cancel().catch(()=>{});};
 let rejectDeadline!:(error:Error)=>void;
 const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
 const abort=()=>{stop();rejectDeadline(new Problem(408,'game_source_interrupted','上傳已中斷，請使用原操作重試。'));};
 const timer=setTimeout(abort,15000);request.signal.addEventListener('abort',abort,{once:true});
 if(request.signal.aborted)abort();
 const body=new ReadableStream<Uint8Array>({async pull(c){
  try{const next=await Promise.race([reader.read(),deadline]);if(stopped)return;if(next.done)c.close();else c.enqueue(next.value);}catch(error){c.error(error);}
 },cancel:stop},{highWaterMark:0});
 try{return await Promise.race([readBounded(body,GAME_UPLOAD_SOURCE_MAX_BYTES),deadline]);}
 catch(error){if(error instanceof Problem)throw error;if(error instanceof AssetStorageError)throw new Problem(error.code==='too_large'?413:422,'invalid_game_source','請上傳完整且不超過 256 KiB 的 UTF-8 HTML。');throw error;}
 finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);stop();try{reader.releaseLock();}catch{/* pending native read is canceled above */}}
}
export function createGameUploadRoutes(pool:Pool,store?:ObjectStore){
 const app=new Hono<PlatformEnv>();
 const headers=(c:Context)=>{c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');c.header('X-Content-Type-Options','nosniff');c.header('Cross-Origin-Resource-Policy','same-origin');};
 for(const path of ['/me/game-drafts','/me/game-drafts/*'])app.use(path,async(c,next)=>{headers(c);try{await next();}finally{headers(c);c.res.headers.delete('ETag');c.res.headers.delete('Last-Modified');}});
 app.post('/me/game-drafts',async c=>{const input=command(c,false);await authRateLimit(pool,'game-draft-member',input.actor.user_id,12,60);return c.json(await createGameDraft(pool,input,await c.req.json()),201);});
 app.get('/me/game-drafts/:id',async c=>c.json(await readGameDraft(pool,c.get('actor'),c.req.param('id'),store)));
 app.post('/me/game-drafts/:id/withdraw',async c=>{const input=command(c);z.object({}).strict().parse(await c.req.json());return c.json(await withdrawGameDraft(pool,input,c.req.param('id')));});
 app.post('/me/game-drafts/:id/source',async c=>{
  checkGameSourceHeaders(c.req.header('Content-Type'),c.req.header('Content-Length'));const input=command(c);
  // Recheck target/session/onboarding before consuming untrusted bytes.
  // False availability cannot reject before the bounded read: an exact historical
  // receipt still needs the actual-byte digest, even after withdrawal/policy OFF.
  // No new intent/effect is admitted until the lifecycle repeats policy checks.
  await readGameDraft(pool,input.actor,c.req.param('id'),store);
  await authRateLimit(pool,'game-source-member',input.actor.user_id,12,60);await authRateLimit(pool,'game-source-global','global',120,60);
  const bytes=await readGameSourceRequest(c.req.raw);
  try{return c.json(await uploadGameSource(pool,input,c.req.param('id'),bytes,store));}
  catch(error){if(error instanceof GameUploadSourceError)throw new Problem(error.code==='game_source_too_large'?413:422,'invalid_game_source','請上傳完整且不超過 256 KiB 的 UTF-8 HTML。');throw error;}
 });
 return app;
}
