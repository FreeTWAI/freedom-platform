import {listSupplierDropShipOrders,supplierDropShipCommand} from '../../../../modules/agent-commerce/fulfilment/drop-ship/orders.js';
import type {SellerCheckoutReadOptions} from '../../../../modules/agent-commerce/checkout/seller-orders.js';
import {DropShipOrderQuerySchema} from '../../../../contracts/guild-launchpad/v1/hosted-drop-ship.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import {Hono} from 'hono';
import type {Pool} from 'pg';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {z} from 'zod';
import {listDropShipAgreements,listDropShipSupplierProducts,proposeDropShipAgreement,decideDropShipAgreement,type DropShipAgreementOptions} from '../../../../modules/agent-commerce/fulfilment/drop-ship/agreements.js';
import type {PlatformEnv} from '../module-context.js';
import {commandHeaders,etag,privateCache,singleQuery} from './tenant-http.js';
export function createHostedDropShipRoutes(pool:Pool,options:DropShipAgreementOptions&SellerCheckoutReadOptions={}) {
  const app=new Hono<PlatformEnv>(),root='/tenants/:tenant_id/storefronts/:instance_id';
  app.use('*',async(c,next)=>{try{await next();}finally{privateCache(c);}});
  const ids=(c:Parameters<typeof singleQuery>[0])=>{if(!c.req.path.endsWith('/drop-ship/orders'))z.object({}).strict().parse(singleQuery(c));return [OpaqueId.parse(c.req.param('tenant_id')),OpaqueId.parse(c.req.param('instance_id'))] as const;};
  app.get(root+'/drop-ship/suppliers',async c=>{const [t,i]=ids(c);return c.json(await listDropShipSupplierProducts(pool,c.get('actor'),t,i));});
  for(const side of ['store','supplier'] as const) {
    const path=root+(side==='store'?'/drop-ship/agreements':'/supplier-console/drop-ship/agreements');
    app.get(path,async c=>{const [t,i]=ids(c);return c.json(await listDropShipAgreements(pool,c.get('actor'),t,i,side));});
    if(side==='store')app.post(path,async c=>{
      const [t,i]=ids(c),h=commandHeaders(c,c.req.header('If-Match')!==undefined);
      const a=await proposeDropShipAgreement(pool,c.get('actor'),t,i,await c.req.json(),h.key,h.expected,options);etag(c,a.version);return c.json(a,201);
    });
    for(const action of side==='store'?['withdraw','revoke'] as const:['accept','decline','revoke'] as const)app.post(path+'/:agreement_id/'+action,async c=>{
      const [t,i]=ids(c),h=commandHeaders(c,true),id=OpaqueId.parse(c.req.param('agreement_id'));
      const a=await decideDropShipAgreement(pool,c.get('actor'),t,i,id,side,action,await c.req.json(),h.key,h.expected!,options);etag(c,a.version);return c.json(a);
    });
  }
  app.get(root+'/supplier-console/drop-ship/orders',async c=>{
    const [t,i]=ids(c),raw=singleQuery(c);if(raw.limit!==undefined)requireCondition(/^[1-9][0-9]?$/.test(raw.limit),422,'validation_failed','頁面大小無效。');
    return c.json(await listSupplierDropShipOrders(pool,c.get('actor'),t,i,DropShipOrderQuerySchema.parse({...raw,...(raw.limit!==undefined?{limit:Number(raw.limit)}:{})}),options.cursors));
  });
  for(const action of ['ship','unable'] as const)app.post(root+'/supplier-console/drop-ship/orders/:order_id/'+action,async c=>{
    const [t,i]=ids(c),h=commandHeaders(c,true);return c.json(await supplierDropShipCommand(pool,c.get('actor'),t,i,OpaqueId.parse(c.req.param('order_id')),action,await c.req.json(),h.key,h.expected!,options));
  });
  return app;
}
