import {Hono} from 'hono';
import type {Pool} from 'pg';
import type {ObjectStore} from '../../../../packages/asset-storage/index.js';
import {readBounded,AssetStorageError} from '../../../../packages/asset-storage/index.js';
import {moduleCommand,type PlatformEnv} from '../module-context.js';
import {requireCondition,Problem} from '../../../../packages/shared/problem.js';
import {readWithMemberSession} from '../../../../packages/db/member-session.js';
import {authRateLimit} from '../../../../modules/identity-membership/members.js';
import {PROFILE_COVER_INPUT_BYTES,profileCoverMetadata,createProfileCoverUpload,removeProfileCover} from '../../../../modules/assets/profile-cover.js';
import {readOwnerProfileCover,readMemberProfileCover,readPublicProfileCover} from '../../../../modules/assets/profile-cover-read.js';
export const isProfileCoverUpload=(method:string,path:string)=>method==='POST'&&path==='/api/v1/me/profile-cover';
export function checkProfileCoverHeaders(type?:string,length?:string){
 requireCondition(['image/png','image/jpeg','image/webp'].includes(type??''),415,'profile_cover_format','請選擇 JPEG、PNG 或 WebP 圖片。');
 if(length!==undefined)requireCondition(/^\d+$/.test(length)&&Number(length)<=PROFILE_COVER_INPUT_BYTES,413,'profile_cover_too_large','封面需為 4 MiB 以下。');
}
/** Separate routers: public composition must mount only the anonymous router,
 * before member-session middleware. Never upgrade public authority via cookies. */
export function createPublicProfileCoverRoutes(pool:Pool,store?:ObjectStore){
 const app=new Hono<PlatformEnv>();app.use('/public/member-profiles/:id/cover',async(c,next)=>{c.header('X-Robots-Tag','noindex, nofollow');c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');await next();c.res.headers.delete('ETag');c.res.headers.delete('Last-Modified');});
 app.get('/public/member-profiles/:id/cover',async c=>{const bytes=await readPublicProfileCover(pool,c.req.param('id'),c.req.query('v')??'',c.req.query('generation')??'',store);c.header('Content-Type','image/webp');c.header('Content-Length',String(bytes.length));c.header('Cross-Origin-Resource-Policy','same-origin');return c.body(new Uint8Array(bytes));});return app;
}
export function createProfileCoverRoutes(pool:Pool,store?:ObjectStore){
 const app=new Hono<PlatformEnv>(),upload=createProfileCoverUpload(pool,store);
 for(const path of ['/me/profile-cover','/me/profile-cover/remove','/me/profile-cover/image','/members/:id/profile/cover'])app.use(path,async(c,next)=>{c.header('X-Robots-Tag','noindex, nofollow');c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');c.header('X-Content-Type-Options','nosniff');await next();c.res.headers.delete('ETag');c.res.headers.delete('Last-Modified');});
 app.get('/me/profile-cover',async c=>c.json(await readWithMemberSession(pool,c.get('actor'),q=>profileCoverMetadata(q,c.get('actor'),Boolean(store)))));
 app.post('/me/profile-cover',async c=>{
  checkProfileCoverHeaders(c.req.header('Content-Type'),c.req.header('Content-Length'));
  const version=c.req.header('If-Match'),key=c.req.header('Idempotency-Key')??'';
  requireCondition(version&&/^"[1-9][0-9]{0,18}"$/.test(version),version?400:428,'version_required','請重新載入封面設定。');
  requireCondition(/^[A-Za-z0-9_-]{8,128}$/.test(key),400,'idempotency_required','請提供有效的 Idempotency-Key。');
  await authRateLimit(pool,'profile-cover-member',c.get('actor').user_id,12,60);await authRateLimit(pool,'profile-cover-global','global',120,60);
  requireCondition(c.req.raw.body,422,'invalid_profile_cover','請選擇圖片。');let bytes:Uint8Array;try{bytes=await readBounded(c.req.raw.body!,PROFILE_COVER_INPUT_BYTES);}catch(error){if(error instanceof AssetStorageError)throw new Problem(error.code==='too_large'?413:422,'invalid_profile_cover','封面需為完整圖片且不超過 4 MiB。');throw error;}
  return c.json(await upload({actor:c.get('actor'),operation:`${c.req.method} ${c.req.path}`,key,expected:version!.slice(1,-1),body:null},{mime:c.req.header('Content-Type')!,bytes}));
 });
 app.post('/me/profile-cover/remove',async c=>c.json(await removeProfileCover(pool,await moduleCommand(c),Boolean(store))));
 app.get('/me/profile-cover/image',async c=>{const bytes=await readOwnerProfileCover(pool,c.get('actor'),c.req.query('v')??'',store);c.header('Content-Type','image/webp');c.header('Content-Length',String(bytes.length));c.header('Cross-Origin-Resource-Policy','same-origin');return c.body(new Uint8Array(bytes));});
 app.get('/members/:id/profile/cover',async c=>{const bytes=await readMemberProfileCover(pool,c.get('actor'),c.req.param('id'),c.req.query('v')??'',c.req.query('generation')??'',store);c.header('Content-Type','image/webp');c.header('Content-Length',String(bytes.length));c.header('Cross-Origin-Resource-Policy','same-origin');return c.body(new Uint8Array(bytes));});return app;
}
