import {Hono,type Context} from 'hono';
import {z} from 'zod';
import type {Pool} from 'pg';
import type {ObjectStore} from '../../../../packages/asset-storage/index.js';
import {readBounded,AssetStorageError} from '../../../../packages/asset-storage/index.js';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import {authRateLimit} from '../../../../modules/identity-membership/members.js';
import {EVENT_PRIZE_PHOTO_INPUT_BYTES,mutateEventPrizePhoto,readEventPrizePhotoAvailability} from '../../../../modules/assets/event-prize-photo.js';
import {readMemberEventPrizePhoto,readPublicEventPrizePhoto} from '../../../../modules/assets/event-prize-photo-read.js';
import type {PlatformEnv} from '../module-context.js';

export function isEventPrizePhotoUpload(method:string,path:string){
 if(method!=='POST')return false;const match=/^\/api\/v1\/events\/([0-9a-fA-F-]{36})\/prizes\/([0-9a-fA-F-]{36})\/photo$/.exec(path);
 return Boolean(match&&z.uuid().safeParse(match[1]).success&&z.uuidv4().safeParse(match[2]).success);
}
export function isEventPrizePhotoRemove(method:string,path:string){return path.endsWith('/remove')&&isEventPrizePhotoUpload(method,path.slice(0,-7));}
export function checkEventPrizePhotoHeaders(type?:string,length?:string){
 requireCondition(['image/png','image/jpeg','image/webp'].includes(type??''),415,'event_prize_photo_format','請選擇 JPEG、PNG 或 WebP 照片。');
 if(length!==undefined)requireCondition(/^[0-9]+$(?![\s\S])/.test(length)&&Number(length)<=EVENT_PRIZE_PHOTO_INPUT_BYTES,413,'event_prize_photo_too_large','照片需為 2 MiB 以下。');
}
function headers(c:Context,publicRead=false){c.header('Cache-Control',publicRead?'no-store':'private, no-store');if(!publicRead)c.header('Vary','Cookie');c.header('Cross-Origin-Resource-Policy','same-origin');c.header('X-Content-Type-Options','nosniff');}
function command(c:Context<PlatformEnv>){
 const version=c.req.header('If-Match'),key=c.req.header('Idempotency-Key')??'';
 requireCondition(version&&/^"[1-9][0-9]{0,18}"$(?![\s\S])/.test(version),version?400:428,'version_required','請重新載入活動後再儲存照片。');
 requireCondition(/^[A-Za-z0-9_-]{8,128}$(?![\s\S])/.test(key),400,'idempotency_required','請提供有效的 Idempotency-Key。');
 return {actor:c.get('actor'),operation:`${c.req.method} ${c.req.path}`,key,expected:version!.slice(1,-1),body:null};
}
export function createEventPrizePhotoRoutes(pool:Pool,store?:ObjectStore){
 const app=new Hono<PlatformEnv>();
 for(const path of ['/events/:id/prizes/:prizeId/photo','/events/:id/prizes/:prizeId/photo/remove','/events/:id/prizes/:prizeId/photo/availability'])app.use(path,async(c,next)=>{headers(c);await next();headers(c);c.res.headers.delete('ETag');c.res.headers.delete('Last-Modified');});
 app.get('/events/:id/prizes/:prizeId/photo/availability',async c=>c.json(await readEventPrizePhotoAvailability(pool,c.get('actor'),c.req.param('id'),c.req.param('prizeId'),store)));
 app.get('/events/:id/prizes/:prizeId/photo',async c=>{const bytes=await readMemberEventPrizePhoto(pool,c.get('actor'),c.req.param('id'),c.req.param('prizeId'),c.req.query('v')??'',store);c.header('Content-Type','image/webp');c.header('Content-Length',String(bytes.length));return c.body(new Uint8Array(bytes));});
 app.post('/events/:id/prizes/:prizeId/photo',async c=>{
  checkEventPrizePhotoHeaders(c.req.header('Content-Type'),c.req.header('Content-Length'));const input=command(c);
  await authRateLimit(pool,'event-prize-photo-member',input.actor.user_id,12,60);await authRateLimit(pool,'event-prize-photo-global','global',120,60);
  requireCondition(c.req.raw.body,422,'invalid_event_prize_photo','請先選擇照片。');let bytes:Uint8Array;
  try{bytes=await readBounded(c.req.raw.body!,EVENT_PRIZE_PHOTO_INPUT_BYTES);}catch(error){if(error instanceof AssetStorageError)throw new Problem(error.code==='too_large'?413:422,'invalid_event_prize_photo','請選擇完整且不超過 2 MiB 的照片。');throw error;}
  return c.json(await mutateEventPrizePhoto(pool,input,c.req.param('id'),c.req.param('prizeId'),{mime:c.req.header('Content-Type')!,bytes},store));
 });
 app.post('/events/:id/prizes/:prizeId/photo/remove',async c=>{
  const input=command(c);const reader=c.req.raw.body?.getReader();
  if(reader)try{for(;;){const part=await reader.read();if(part.done)break;requireCondition(part.value.length===0,422,'invalid_event_prize_photo_remove','移除照片不接受其他欄位。');}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return c.json(await mutateEventPrizePhoto(pool,input,c.req.param('id'),c.req.param('prizeId'),null,store));
 });return app;
}
export function createPublicEventPrizePhotoRoutes(pool:Pool,store?:ObjectStore){
 const app=new Hono<PlatformEnv>();app.use('/public/events/:id/prizes/:prizeId/photo',async(c,next)=>{headers(c,true);await next();headers(c,true);c.res.headers.delete('ETag');c.res.headers.delete('Last-Modified');});
 app.get('/public/events/:id/prizes/:prizeId/photo',async c=>{const bytes=await readPublicEventPrizePhoto(pool,c.req.param('id'),c.req.param('prizeId'),c.req.query('v')??'',store);c.header('Content-Type','image/webp');c.header('Content-Length',String(bytes.length));return c.body(new Uint8Array(bytes));});return app;
}
