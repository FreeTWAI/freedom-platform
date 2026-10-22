import {flushControlEventsBestEffort,type EffectJournalPort} from '../../../../modules/agent-commerce/operations/journal/journal.js';
import {Hono,type Context} from 'hono';
import type {Pool} from 'pg';
import * as wire from '../../../../contracts/guild-launchpad/v1/hosted-commerce-setup.js';
import {OpaqueId} from '../../../../contracts/common/v1/identity.js';
import {admitStore,revokeStoreAdmission,listStoreAdmissions,type CommerceProviderEnvironment} from '../../../../modules/agent-commerce/operations/admissions.js';
import type {AdminActor,AdminCommand} from '../../../../modules/platform-admin/service.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import {listAdminStoreReadiness,type StoreReadinessDependencies} from '../../../../modules/agent-commerce/operations/store-readiness.js';
type AdminEnv={Variables:{admin:AdminActor;adminCsrf:string}};
export function createCommerceAdmissionRoutes(pool:Pool,command:(c:Context<AdminEnv>)=>Promise<AdminCommand>,environment:CommerceProviderEnvironment,journal?:EffectJournalPort,readiness?:StoreReadinessDependencies & {releaseSha:string|null}){
  const app=new Hono<AdminEnv>(),root='/commerce/store-admissions';
  app.use('*',async(c,next)=>{try{await next();if(c.req.method==='POST'&&c.res.status<400)await flushControlEventsBestEffort(pool,journal);}finally{c.header('Cache-Control','private, no-store');c.header('Vary','Cookie');}});
  app.post(root,async c=>c.json(wire.StoreAdmissionViewSchema.parse(await admitStore(pool,await command(c),environment)),201));
  app.post(root+'/:admission_id/revoke',async c=>c.json(wire.StoreAdmissionViewSchema.parse(await revokeStoreAdmission(pool,await command(c),OpaqueId.parse(c.req.param('admission_id'))))));
  app.get(root,async c=>{
    const query=c.req.queries();requireCondition(Object.values(query).every(values=>values.length===1),422,'validation_failed','查詢參數無效。');
    const parsed=wire.StoreAdmissionQuerySchema.parse(Object.fromEntries(Object.entries(query).map(([key,values])=>[key,values[0]])));
    return c.json(wire.StoreAdmissionPageSchema.parse(await listStoreAdmissions(pool,c.get('admin'),parsed.tenant_id)));
  });
  app.get('/commerce/store-readiness',async c=>{
    const query=c.req.queries();requireCondition(Object.values(query).every(values=>values.length===1),422,'validation_failed','查詢參數無效。');
    const {limit,offset}=wire.AdminStoreReadinessQuerySchema.parse(Object.fromEntries(Object.entries(query).map(([key,values])=>[key,values[0]])));
    const deps=readiness??{environment,checkout:{origin:'',settings:{checkoutEnabled:false,quarantine:false,providerProfiles:[]}},releaseSha:null};
    return c.json(await listAdminStoreReadiness(pool,c.get('admin'),deps,Number(limit??25),Number(offset??0),deps.releaseSha));
  });return app;
}
