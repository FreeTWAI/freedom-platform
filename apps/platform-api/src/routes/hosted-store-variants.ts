import {requireCondition} from '../../../../packages/shared/problem.js';
import {previewProductPage} from '../../../../modules/agent-commerce/hosted/publish.js';
import {storeAppearanceOptions} from './hosted-store-appearance.js';
import {storePoliciesOptions} from './hosted-store-policies.js';
import {storeGalleryInstalled,storeGalleryOptions} from './hosted-store-gallery.js';
import {Hono,type Context} from 'hono';
import type {Pool} from 'pg';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {EmptyStoreInputSchema} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import {listProductGroups,replaceProductGroup,createVariantProduct,splitProductGroup} from '../../../../modules/agent-commerce/storefront/variants/commands.js';
import type {VariantsOptions} from '../../../../modules/agent-commerce/storefront/variants/model.js';
import type {PlatformRuntime} from '../runtime.js';
import type {PlatformEnv} from '../module-context.js';
import {commandHeaders,etag,singleQuery,privateCache} from './tenant-http.js';
export const storeVariantsInstalled=(r:PlatformRuntime)=>r.guildLaunchpadEnabled===true&&r.storeVariantsEnabled===true;
export const storeVariantsOptions=(r:PlatformRuntime):VariantsOptions=>({enabled:storeVariantsInstalled(r)});
export function isProductGroupReplace(method:string,path:string){return method==='PUT'&&/^\/api\/v1\/tenants\/[0-9A-Fa-f-]{36}\/storefronts\/[0-9A-Fa-f-]{36}\/product-groups\/P[0-9]{4,23}(?:~single)?$/.test(path);}
/** Parent member boundary and storefront quarantine/cache apply to all five
 * handlers. This router is never mounted with the flag disabled. */
export function createHostedStoreVariantsRoutes(pool:Pool,runtime:PlatformRuntime){
 const app=new Hono<PlatformEnv>(),root='/tenants/:tenant_id/storefronts/:instance_id/product-groups';
 if(!storeGalleryInstalled(runtime)){
  const preview='/tenants/:tenant_id/storefronts/:instance_id/preview-page/products/:sku';
  app.use(preview,async(c,next)=>{try{await next();}finally{privateCache(c);}});
  app.get(preview,async c=>{emptyQuery(c);return c.html(await previewProductPage(pool,c.get('actor'),OpaqueId.parse(c.req.param('tenant_id')),OpaqueId.parse(c.req.param('instance_id')),c.req.param('sku'),storeAppearanceOptions(runtime),storePoliciesOptions(runtime),storeGalleryOptions(runtime),storeVariantsOptions(runtime)));});
 }
 const emptyQuery=(c:Context<PlatformEnv>)=>requireCondition(EmptyStoreInputSchema.safeParse(singleQuery(c)).success,422,'validation_failed','查詢參數無效。');
 const ids=(c:Context<PlatformEnv>)=>[OpaqueId.parse(c.req.param('tenant_id')),OpaqueId.parse(c.req.param('instance_id'))] as const;
 app.get(root,async c=>{emptyQuery(c);const [t,i]=ids(c);return c.json(await listProductGroups(pool,c.get('actor'),t,i));});
 app.get(root+'/:group_key',async c=>{emptyQuery(c);const [t,i]=ids(c),view=await listProductGroups(pool,c.get('actor'),t,i,c.req.param('group_key'));if('version' in view)etag(c,view.version);return c.json(view);});
 for(const [method,suffix,run] of [['PUT','',replaceProductGroup],['POST','/products',createVariantProduct],['POST','/split',splitProductGroup]] as const){
  app.on(method,root+'/:group_key'+suffix,async c=>{emptyQuery(c);const [t,i]=ids(c),h=commandHeaders(c,true),ack=await run(pool,c.get('actor'),t,i,c.req.param('group_key')!,h.key,h.expected!,await c.req.json());etag(c,ack.current.items.find(g=>g.group_key===ack.group_key)?.version??ack.completed_version);return c.json(ack,method==='POST'&&suffix==='/products'?201:200);});
 }
 return app;
}
