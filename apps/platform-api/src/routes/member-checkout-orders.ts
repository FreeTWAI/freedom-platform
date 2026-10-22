import {Hono} from 'hono';
import type {Pool} from 'pg';
import {MemberOrderQuerySchema} from '../../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {listMemberCheckoutOrders} from '../../../../modules/agent-commerce/checkout/member-orders.js';
import type {TenantListCursorCodec} from '../../../../packages/shared/tenant-list-cursor.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import type {PlatformEnv} from '../module-context.js';
import {readSessionCookie} from '../session-cookie.js';
import {singleQuery} from './tenant-http.js';

/** Mounted only behind the actual session boundary and raw checkout flag. */
export function createMemberCheckoutOrderRoutes(pool:Pool,origin:string,cursors?:TenantListCursorCodec) {
  const app=new Hono<PlatformEnv>();
  app.get('/me/orders',async c=>{
    const raw=singleQuery(c);
    if(raw.limit!==undefined)requireCondition(/^[1-9][0-9]?$/.test(raw.limit),422,'validation_failed','頁面大小無效。');
    const query=MemberOrderQuerySchema.parse({...raw,...(raw.limit===undefined?{}:{limit:Number(raw.limit)})});
    return c.json(await listMemberCheckoutOrders(pool,readSessionCookie(c.req.header('Cookie'),origin),c.get('actor').user_id,query,cursors));
  });
  return app;
}
