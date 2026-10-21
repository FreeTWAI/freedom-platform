import {Hono} from 'hono';
import type {Pool} from 'pg';
import {CommerceSetupEmptyInputSchema,StoreOverviewSchema} from '../../../../contracts/guild-launchpad/v1/hosted-commerce-setup.js';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {readStoreOverview,type StoreReadinessDependencies} from '../../../../modules/agent-commerce/operations/store-readiness.js';
import type {PlatformEnv} from '../module-context.js';
import {privateCache,singleQuery} from './tenant-http.js';

export function createHostedStoreOverviewRoutes(pool:Pool,deps:StoreReadinessDependencies){
  const app=new Hono<PlatformEnv>(),root='/tenants/:tenant_id/storefronts/:instance_id/overview';
  app.use(root,async(c,next)=>{try{CommerceSetupEmptyInputSchema.parse(singleQuery(c));await next();}finally{privateCache(c);}});
  app.get(root,async c=>c.json(StoreOverviewSchema.parse(await readStoreOverview(pool,c.get('actor'),OpaqueId.parse(c.req.param('tenant_id')),OpaqueId.parse(c.req.param('instance_id')),deps))));
  return app;
}
