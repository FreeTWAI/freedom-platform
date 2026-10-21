import {Hono} from 'hono';
import type {Pool} from 'pg';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {EmptyStoreInputSchema} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import {listCategories,categoryCommand} from '../../../../modules/agent-commerce/storefront/categories/commands.js';
import type {PlatformRuntime} from '../runtime.js';
import type {PlatformEnv} from '../module-context.js';
import {commandHeaders,etag,singleQuery} from './tenant-http.js';
export const storeCategoriesInstalled=(r:PlatformRuntime)=>r.guildLaunchpadEnabled===true&&r.storeCategoriesEnabled===true;
export const storeCategoriesOptions=(r:PlatformRuntime)=>({enabled:storeCategoriesInstalled(r),variantsEnabled:r.guildLaunchpadEnabled===true&&r.storeVariantsEnabled===true});
export function createHostedStoreCategoriesRoutes(pool:Pool,runtime:PlatformRuntime){
 const app=new Hono<PlatformEnv>(),root='/tenants/:tenant_id/storefronts/:instance_id/categories',options=storeCategoriesOptions(runtime);
 const ids=(c:Parameters<typeof singleQuery>[0])=>{requireCondition(EmptyStoreInputSchema.safeParse(singleQuery(c)).success,422,'validation_failed','查詢參數無效。');return [OpaqueId.parse(c.req.param('tenant_id')),OpaqueId.parse(c.req.param('instance_id'))] as const;};
 app.get(root,async c=>{const [t,i]=ids(c),page=await listCategories(pool,c.get('actor'),t,i,options);etag(c,page.version);return c.json(page);});
 for(const [method,suffix,op] of [['POST','','create'],['POST','/reorder','reorder'],['PATCH','/:category_id','rename'],['PUT','/:category_id/groups','groups'],['POST','/:category_id/remove','remove']] as const){
  app.on(method,root+suffix,async c=>{const [t,i]=ids(c),h=commandHeaders(c,true),ack=await categoryCommand(pool,c.get('actor'),t,i,op,c.req.param('category_id')??null,await c.req.json(),h.key,h.expected!,options);etag(c,ack.current.version);return c.json(ack,op==='create'?201:200);});
 }
 return app;
}
