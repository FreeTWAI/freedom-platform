import {Hono,type Context,type MiddlewareHandler} from 'hono';
import type {Pool} from 'pg';
import {OpaqueId} from '../../../../contracts/common/v1/identity.js';
import {EmptyStoreInputSchema} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import {AppearanceRoleSchema,RemoveAppearanceImageInputSchema} from '../../../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {readAppearanceSettings,updateAppearanceSettings,type AppearanceOptions} from '../../../../modules/agent-commerce/hosted/appearance.js';
import {uploadAppearanceImage,removeAppearanceImage} from '../../../../modules/agent-commerce/hosted/appearance-commands.js';
import {readPrivateAppearanceImage,readPublicAppearanceImage} from '../../../../modules/agent-commerce/hosted/appearance-read.js';
import {AssetStorageError,readBounded} from '../../../../packages/asset-storage/index.js';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import type {PlatformRuntime} from '../runtime.js';
import type {PlatformEnv} from '../module-context.js';
import {commandHeaders,etag,privateCache,singleQuery} from './tenant-http.js';
import {storePhotosInstalled,storePhotoUploadsInstalled} from './hosted-store-media.js';

export function storeAppearanceInstalled(runtime:PlatformRuntime){return runtime.guildLaunchpadEnabled===true&&runtime.storeAppearanceEnabled===true;}
export function storeAppearanceOptions(runtime:PlatformRuntime):AppearanceOptions{
  return {enabled:storeAppearanceInstalled(runtime),mediaInstalled:storePhotosInstalled(runtime),uploadsEnabled:storePhotoUploadsInstalled(runtime)&&Boolean(runtime.storeAppearanceAssets)};
}
export function isStoreAppearanceUpload(method:string,path:string){return method==='POST'&&/^\/api\/v1\/tenants\/[0-9A-Fa-f-]{36}\/storefronts\/[0-9A-Fa-f-]{36}\/appearance-media\/(cover|logo)$/.test(path);}
export function checkStoreAppearanceHeaders(type?:string,length?:string){
  requireCondition(['image/png','image/jpeg','image/webp'].includes(type??''),415,'appearance_image_format','請選擇 JPEG、PNG 或 WebP 圖片。');
  if(length!==undefined)requireCondition(/^[0-9]+$/.test(length)&&Number(length)<=2097152,413,'appearance_image_too_large','圖片需為 2 MB 以下的檔案。');
}
async function sourceBytes(request:Request){
  requireCondition(request.body,422,'invalid_appearance_image','請先選擇圖片。');
  try{const bytes=await readBounded(request.body,2097152);requireCondition(bytes.length>0,422,'invalid_appearance_image','請先選擇圖片。');return Buffer.from(bytes);}
  catch(error){if(error instanceof AssetStorageError&&error.code==='too_large')throw new Problem(413,'appearance_image_too_large','圖片需為 2 MB 以下的檔案。');throw error;}
}
function imageResponse(c:Context<PlatformEnv>,bytes:Uint8Array,privateImage=false){
  c.header('Content-Type','image/webp');c.header('Content-Length',String(bytes.length));c.header('X-Content-Type-Options','nosniff');
  c.header('Cache-Control',privateImage?'private, no-store':'no-store');c.header('X-Robots-Tag','noindex, nofollow');
  if(privateImage){c.header('Vary','Cookie');c.header('Referrer-Policy','no-referrer');c.header('Cross-Origin-Resource-Policy','same-origin');}
  return c.req.method==='HEAD'?c.body(null):c.body(bytes as Uint8Array<ArrayBuffer>);
}
export function createHostedStoreAppearanceRoutes(pool:Pool,runtime:PlatformRuntime){
  const app=new Hono<PlatformEnv>(),options=storeAppearanceOptions(runtime);
  const root='/tenants/:tenant_id/storefronts/:instance_id/appearance-settings';
  const cache:MiddlewareHandler<PlatformEnv>=async(c,next)=>{try{await next();}finally{privateCache(c);}};
  app.use(root,cache);
  const ids=(c:Parameters<typeof singleQuery>[0])=>[OpaqueId.parse(c.req.param('tenant_id')),OpaqueId.parse(c.req.param('instance_id'))] as const;
  app.get(root,async c=>{
    EmptyStoreInputSchema.parse(singleQuery(c));const [t,i]=ids(c);
    const view=await readAppearanceSettings(pool,c.get('actor'),t,i,options);etag(c,view.version);return c.json(view);
  });
  app.patch(root,async c=>{
    EmptyStoreInputSchema.parse(singleQuery(c));const headers=commandHeaders(c,true),[t,i]=ids(c);
    const input=await c.req.json();
    const result=await updateAppearanceSettings(pool,c.get('actor'),t,i,input,headers.key,headers.expected!,options);
    etag(c,result.current.version);return c.json(result);
  });
  if(storePhotosInstalled(runtime)){
    const mediaRoot='/tenants/:tenant_id/storefronts/:instance_id/appearance-media';
    app.use(mediaRoot+'/*',cache);
    for(const role of ['cover','logo'] as const){
      app.post(mediaRoot+'/'+role,async c=>{
        EmptyStoreInputSchema.parse(singleQuery(c));checkStoreAppearanceHeaders(c.req.header('Content-Type'),c.req.header('Content-Length'));
        const h=commandHeaders(c,true),[t,i]=ids(c);
        const result=await uploadAppearanceImage(pool,c.get('actor'),t,i,role,h.key,h.expected!,{bytes:await sourceBytes(c.req.raw),mime:c.req.header('Content-Type')!},
          runtime.storeAppearanceAssets,options.uploadsEnabled===true,options);etag(c,result.current.version);return c.json(result);
      });
      app.post(mediaRoot+'/'+role+'/remove',async c=>{
        EmptyStoreInputSchema.parse(singleQuery(c));RemoveAppearanceImageInputSchema.parse(await c.req.json());const h=commandHeaders(c,true),[t,i]=ids(c);
        const result=await removeAppearanceImage(pool,c.get('actor'),t,i,role,h.key,h.expected!,options);etag(c,result.current.version);return c.json(result);
      });
    }
    app.on(['GET','HEAD'],mediaRoot+'/:role/:version',async c=>{
      EmptyStoreInputSchema.parse(singleQuery(c));const [t,i]=ids(c),role=AppearanceRoleSchema.parse(c.req.param('role'));
      return imageResponse(c,await readPrivateAppearanceImage(pool,runtime.storePhotoAssetStore!,c.get('actor'),t,i,role,c.req.param('version')!),true);
    });
  }
  return app;
}
export function createPublicStoreAppearanceMediaRoutes(pool:Pool,runtime:PlatformRuntime){
  const app=new Hono<PlatformEnv>();
  app.use('/shops/:slug/appearance-media/*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('X-Robots-Tag','noindex, nofollow');await next();});
  app.on(['GET','HEAD'],'/shops/:slug/appearance-media/:revision/:role',async c=>{
    EmptyStoreInputSchema.parse(singleQuery(c));const role=AppearanceRoleSchema.parse(c.req.param('role'));
    const bytes=await readPublicAppearanceImage(pool,runtime.storePhotoAssetStore!,c.req.param('slug'),c.req.param('revision'),role);
    requireCondition(bytes,404,'not_found','找不到這張店面圖片。');return imageResponse(c,bytes);
  });return app;
}
