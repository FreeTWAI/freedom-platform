import {storeVariantsOptions} from './hosted-store-variants.js';
import {previewProductPage} from '../../../../modules/agent-commerce/hosted/publish.js';
import {storeAppearanceOptions} from './hosted-store-appearance.js';
import {storePoliciesOptions} from './hosted-store-policies.js';
import {Hono,type Context} from 'hono';
import type {Pool} from 'pg';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {EmptyStoreInputSchema} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import {RemoveGalleryPhotoInputSchema} from '../../../../contracts/guild-launchpad/v1/storefront-gallery.js';
import {Problem,requireCondition} from '../../../../packages/shared/problem.js';
import {changeGallery,uploadGalleryPhoto} from '../../../../modules/agent-commerce/storefront/gallery/commands.js';
import {listProductGalleries,readPrivateGalleryPhoto} from '../../../../modules/agent-commerce/storefront/gallery/read.js';
import type {GalleryOptions} from '../../../../modules/agent-commerce/storefront/gallery/model.js';
import type {PlatformRuntime} from '../runtime.js';
import type {PlatformEnv} from '../module-context.js';
import {commandHeaders,etag,privateCache,singleQuery} from './tenant-http.js';
import {storePhotosInstalled,checkStorePhotoHeaders,storePhotoSourceBytes} from './hosted-store-media.js';
export const storeGalleryInstalled=(r:PlatformRuntime)=>r.guildLaunchpadEnabled===true&&r.storeGalleryEnabled===true;
export function storeGalleryOptions(r:PlatformRuntime):GalleryOptions{return {enabled:storeGalleryInstalled(r),mediaInstalled:storePhotosInstalled(r),uploadsEnabled:storePhotosInstalled(r)&&Boolean(r.storeGalleryAssets)&&r.storePhotoUploadsEnabled===true};}
export function isStoreGalleryUpload(method:string,path:string){return method==='POST'&&/^\/api\/v1\/tenants\/[0-9A-Fa-f-]{36}\/storefronts\/[0-9A-Fa-f-]{36}\/products\/[0-9A-Fa-f-]{36}\/gallery\/photos\/[0-9A-Fa-f-]{36}$/.test(path);}
export function createHostedStoreGalleryRoutes(pool:Pool,runtime:PlatformRuntime){
 const app=new Hono<PlatformEnv>(),root='/tenants/:tenant_id/storefronts/:instance_id',product=root+'/products/:product_id/gallery',options=storeGalleryOptions(runtime);
 for(const path of [root+'/product-galleries',product,product+'/*'])app.use(path,async(c,next)=>{try{await next();}finally{privateCache(c);}});
 app.use(root+'/preview-page/products/:sku',async(c,next)=>{try{await next();}finally{privateCache(c);}});
 app.get(root+'/preview-page/products/:sku',async c=>{EmptyStoreInputSchema.parse(singleQuery(c));const t=OpaqueId.parse(c.req.param('tenant_id')),i=OpaqueId.parse(c.req.param('instance_id'));return c.html(await previewProductPage(pool,c.get('actor'),t,i,c.req.param('sku')!,storeAppearanceOptions(runtime),storePoliciesOptions(runtime),options,storeVariantsOptions(runtime)));});
 const ids=(c:Context<PlatformEnv>)=>[OpaqueId.parse(c.req.param('tenant_id')),OpaqueId.parse(c.req.param('instance_id'))] as const;
 app.get(root+'/product-galleries',async c=>{EmptyStoreInputSchema.parse(singleQuery(c));const [t,i]=ids(c);return c.json(await listProductGalleries(pool,c.get('actor'),t,i,options));});
 app.get(product,async c=>{EmptyStoreInputSchema.parse(singleQuery(c));const [t,i]=ids(c),id=OpaqueId.parse(c.req.param('product_id'));const view=(await listProductGalleries(pool,c.get('actor'),t,i,options)).items.find(p=>p.product_id===id);requireCondition(view,404,'not_found','找不到這項商品。');etag(c,view.version);return c.json(view);});
 app.post(product+'/reorder',async c=>{EmptyStoreInputSchema.parse(singleQuery(c));const h=commandHeaders(c,true),[t,i]=ids(c);const ack=await changeGallery(pool,c.get('actor'),t,i,c.req.param('product_id')!,h.key,h.expected!,'reorder',null,await c.req.json(),options);etag(c,ack.current.version);return c.json(ack);});
 app.patch(product+'/photos/:photo_key',async c=>{EmptyStoreInputSchema.parse(singleQuery(c));const h=commandHeaders(c,true),[t,i]=ids(c);const ack=await changeGallery(pool,c.get('actor'),t,i,c.req.param('product_id')!,h.key,h.expected!,'describe',c.req.param('photo_key')!,await c.req.json(),options);etag(c,ack.current.version);return c.json(ack);});
 app.post(product+'/photos/:photo_key/remove',async c=>{EmptyStoreInputSchema.parse(singleQuery(c));RemoveGalleryPhotoInputSchema.parse(await c.req.json());const h=commandHeaders(c,true),[t,i]=ids(c);const ack=await changeGallery(pool,c.get('actor'),t,i,c.req.param('product_id')!,h.key,h.expected!,'remove',c.req.param('photo_key')!,{},options);etag(c,ack.current.version);return c.json(ack);});
 if(storePhotosInstalled(runtime)){
  app.post(product+'/photos/:photo_id',async c=>{EmptyStoreInputSchema.parse(singleQuery(c));checkStorePhotoHeaders(c.req.header('Content-Type'),c.req.header('Content-Length'));const h=commandHeaders(c,true),[t,i]=ids(c);
   const ack=await uploadGalleryPhoto(pool,c.get('actor'),t,i,c.req.param('product_id')!,c.req.param('photo_id')!,h.key,h.expected!,{bytes:await storePhotoSourceBytes(c.req.raw),mime:c.req.header('Content-Type')!},runtime.storeGalleryAssets,options);etag(c,ack.current.version);return c.json(ack);});
  app.on(['GET','HEAD'],product+'/photos/:photo_key/:version',async c=>{EmptyStoreInputSchema.parse(singleQuery(c));const [t,i]=ids(c);const bytes=await readPrivateGalleryPhoto(pool,runtime.storePhotoAssetStore!,c.get('actor'),t,i,c.req.param('product_id')!,c.req.param('photo_key')!,c.req.param('version')!);
   c.header('Content-Type','image/webp');c.header('Content-Length',String(bytes.length));c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');c.header('Cross-Origin-Resource-Policy','same-origin');return c.req.method==='HEAD'?c.body(null):c.body(bytes as Uint8Array<ArrayBuffer>);});
 }
 return app;
}

export function createPublicStoreGalleryRoutes(pool:Pool,runtime:PlatformRuntime){
 const app=new Hono<PlatformEnv>();
 app.use('/shops/:slug/media/:revision/:sku/:n/*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('X-Robots-Tag','noindex');await next();});
 app.on(['GET','HEAD'],'/shops/:slug/media/:revision/:sku/:n',async c=>{
  EmptyStoreInputSchema.parse(singleQuery(c));const {readPublicGalleryPhoto}=await import('../../../../modules/agent-commerce/storefront/gallery/read.js');
  const bytes=await readPublicGalleryPhoto(pool,runtime.storePhotoAssetStore!,c.req.param('slug'),c.req.param('revision'),c.req.param('sku'),c.req.param('n'));
  requireCondition(bytes,404,'not_found','找不到這張商品照片。');c.header('Content-Type','image/webp');c.header('Content-Length',String(bytes.length));c.header('X-Content-Type-Options','nosniff');return c.req.method==='HEAD'?c.body(null):c.body(bytes as Uint8Array<ArrayBuffer>);
 });
 app.on(['GET','HEAD'],'/shops/:slug/media/:revision/:sku/:n/*',()=>{throw new Problem(404,'not_found','找不到這張商品照片。');});
 return app;
}
