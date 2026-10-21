import {Hono} from 'hono';
import type {Pool} from 'pg';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {EmptyStoreInputSchema} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import {shareSupplyOfferPhoto,stopSupplyOfferPhoto} from '../../../../modules/agent-commerce/supplier-console/offer-photos.js';
import {listSupplyCatalogPhotos,readSupplyOfferPhoto} from '../../../../modules/agent-commerce/hosted/distribution.js';
import type {PlatformEnv} from '../module-context.js';
import type {PlatformRuntime} from '../runtime.js';
import {storePhotosInstalled} from './hosted-store-media.js';
import {privateCache,singleQuery,commandHeaders} from './tenant-http.js';

export function supplyOfferPhotosInstalled(runtime:PlatformRuntime) {
  return runtime.guildLaunchpadEnabled===true&&runtime.supplierConsoleEnabled===true&&runtime.supplyOfferPhotosEnabled===true&&storePhotosInstalled(runtime);
}
export function createHostedSupplyOfferPhotoRoutes(pool:Pool,runtime:PlatformRuntime) {
  const app=new Hono<PlatformEnv>(),root='/tenants/:tenant_id/storefronts/:instance_id';
  app.use('*',async(c,next)=>{try{await next();}finally{privateCache(c);}});
  const ids=(c:Parameters<typeof singleQuery>[0])=>[OpaqueId.parse(c.req.param('tenant_id')),OpaqueId.parse(c.req.param('instance_id'))] as const;
  app.get(root+'/supply-catalog-photos',async c=>{
    EmptyStoreInputSchema.parse(singleQuery(c));const [t,i]=ids(c);
    return c.json(await listSupplyCatalogPhotos(pool,c.get('actor'),t,i));
  });
  app.post(root+'/supply-offers/:offer_id/photo/share',async c=>{
    EmptyStoreInputSchema.parse(singleQuery(c));EmptyStoreInputSchema.parse(await c.req.json());
    const [t,i]=ids(c),h=commandHeaders(c,true);
    return c.json(await shareSupplyOfferPhoto(pool,c.get('actor'),t,i,OpaqueId.parse(c.req.param('offer_id')),h.key,h.expected!));
  });
  app.post(root+'/supply-offers/:offer_id/photo/stop',async c=>{
    EmptyStoreInputSchema.parse(singleQuery(c));EmptyStoreInputSchema.parse(await c.req.json());
    const [t,i]=ids(c),h=commandHeaders(c,true);
    return c.json(await stopSupplyOfferPhoto(pool,c.get('actor'),t,i,OpaqueId.parse(c.req.param('offer_id')),h.key,h.expected!));
  });
  app.on(['GET','HEAD'],root+'/supply-catalog/:offer_id/photo/:seq',async c=>{
    EmptyStoreInputSchema.parse(singleQuery(c));const [t,i]=ids(c);
    const bytes=await readSupplyOfferPhoto(pool,runtime.storePhotoAssetStore!,c.get('actor'),t,i,c.req.param('offer_id')!,c.req.param('seq')!);
    c.header('Content-Type','image/webp');c.header('Content-Length',String(bytes.length));c.header('Content-Disposition','inline');
    return c.req.method==='HEAD'?c.body(null):c.body(bytes as Uint8Array<ArrayBuffer>);
  });
  return app;
}
