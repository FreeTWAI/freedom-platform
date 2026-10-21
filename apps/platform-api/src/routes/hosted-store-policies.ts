import {Hono,type Context} from 'hono';
import type {Pool} from 'pg';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {PolicyKindSchema} from '../../../../contracts/guild-launchpad/v1/storefront-policies.js';
import {readSellerPolicies,saveSellerPolicies,SellerPoliciesFieldProblem} from '../../../../modules/agent-commerce/storefront/policies/commands.js';
import {previewLegalPage,publicLegalPage} from '../../../../modules/agent-commerce/storefront/policies/read.js';
import type {PlatformRuntime} from '../runtime.js';
import type {PlatformEnv} from '../module-context.js';
import {commandHeaders,etag,privateCache,singleQuery} from './tenant-http.js';
import {storeAppearanceOptions} from './hosted-store-appearance.js';
import {Problem} from '../../../../packages/shared/problem.js';

export const storePoliciesInstalled=(r:PlatformRuntime)=>r.guildLaunchpadEnabled===true&&r.storePoliciesEnabled===true;
export const storePoliciesOptions=(r:PlatformRuntime)=>({enabled:storePoliciesInstalled(r)});
export const isSellerPoliciesSave=(method:string,path:string)=>method==='PUT'&&/^\/api\/v1\/tenants\/[0-9A-Fa-f-]{36}\/storefronts\/[0-9A-Fa-f-]{36}\/seller-policies$/.test(path);
function emptyQuery(c:Context<PlatformEnv>){if(Object.keys(singleQuery(c)).length)throw new Problem(422,'validation_failed','查詢參數無效。');}
export function createHostedStorePoliciesRoutes(pool:Pool,runtime:PlatformRuntime){
 const app=new Hono<PlatformEnv>(),root='/tenants/:tenant_id/storefronts/:instance_id',base=root+'/seller-policies';
 for(const path of [base,root+'/preview-page/about',root+'/preview-page/policies/:kind'])app.use(path,async(c,next)=>{try{emptyQuery(c);await next();}finally{privateCache(c);}});
 app.onError((error,c)=>{if(!(error instanceof SellerPoliciesFieldProblem))throw error;privateCache(c);return c.json({type:'about:blank',title:error.code,status:422,code:error.code,detail:error.message,fields:error.fields},422);});
 const ids=(c:Context<PlatformEnv>)=>[OpaqueId.parse(c.req.param('tenant_id')),OpaqueId.parse(c.req.param('instance_id'))] as const;
 app.get(base,async c=>{const [t,i]=ids(c),v=await readSellerPolicies(pool,c.get('actor'),t,i);etag(c,v.version);return c.json(v);});
 app.put(base,async c=>{const [t,i]=ids(c),h=commandHeaders(c,true),v=await saveSellerPolicies(pool,c.get('actor'),t,i,await c.req.json(),h.key,h.expected!);etag(c,v.current.version);return c.json(v);});
 app.get(root+'/preview-page/about',async c=>{const [t,i]=ids(c);return c.html((await previewLegalPage(pool,c.get('actor'),t,i,storeAppearanceOptions(runtime)))!);});
 app.get(root+'/preview-page/policies/:kind',async c=>{const [t,i]=ids(c),kind=PolicyKindSchema.safeParse(c.req.param('kind'));if(!kind.success)return c.notFound();const html=await previewLegalPage(pool,c.get('actor'),t,i,storeAppearanceOptions(runtime),kind.data);return html===null?c.notFound():c.html(html);});
 return app;
}
export function createPublicStorePoliciesRoutes(pool:Pool,runtime:PlatformRuntime){
 const app=new Hono<PlatformEnv>();
 const headers=(c:Context<PlatformEnv>)=>{c.header('Cache-Control','no-store');c.header('X-Robots-Tag','noindex');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','no-referrer');};
 for(const path of ['/shops/:slug/about','/shops/:slug/policies/:kind','/shops/:slug/policies/:kind/v/:version_id'])app.get(path,async c=>{
  headers(c);const html=await publicLegalPage(pool,c.req.param('slug')!,storeAppearanceOptions(runtime),c.req.param('kind'),c.req.param('version_id'));return html===null?c.notFound():c.html(html);
 });
 // Install only with the feature. OFF must retain the host's existing assets /
 // SPA fallback for these paths; an unconditional guard would change its bytes.
 app.all('/shops/*',async(c,next)=>{if(/^\/shops\/[^/]+\/(about|policies)(\/|$)/.test(c.req.path)){headers(c);return c.notFound();}await next();});
 return app;
}
