import {Hono} from 'hono';
import type {Pool} from 'pg';
import {OpaqueId} from '../../../../contracts/common/v1/identity.js';
import {EmptyStoreInputSchema} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import {readAppearanceSettings,updateAppearanceSettings,type AppearanceOptions} from '../../../../modules/agent-commerce/hosted/appearance.js';
import type {PlatformRuntime} from '../runtime.js';
import type {PlatformEnv} from '../module-context.js';
import {commandHeaders,etag,privateCache,singleQuery} from './tenant-http.js';
import {storePhotosInstalled,storePhotoUploadsInstalled} from './hosted-store-media.js';

export function storeAppearanceInstalled(runtime:PlatformRuntime){return runtime.guildLaunchpadEnabled===true&&runtime.storeAppearanceEnabled===true;}
export function storeAppearanceOptions(runtime:PlatformRuntime):AppearanceOptions{
  return {enabled:storeAppearanceInstalled(runtime),mediaInstalled:storePhotosInstalled(runtime),uploadsEnabled:storePhotoUploadsInstalled(runtime)};
}
export function createHostedStoreAppearanceRoutes(pool:Pool,runtime:PlatformRuntime){
  const app=new Hono<PlatformEnv>(),options=storeAppearanceOptions(runtime);
  const root='/tenants/:tenant_id/storefronts/:instance_id/appearance-settings';
  app.use('*',async(c,next)=>{try{await next();}finally{privateCache(c);}});
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
  return app;
}
