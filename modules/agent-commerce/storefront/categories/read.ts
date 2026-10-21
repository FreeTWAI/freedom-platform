import type {Pool} from 'pg';
import {isolatedTransaction} from '../../../../packages/resource-scopes/tenant-transaction.js';
import {Problem} from '../../../../packages/shared/problem.js';
import {resolvePublicStorePage} from '../../hosted/public.js';
import {publicPurchaseStateWithClient,type HostedCheckoutOptions} from '../../checkout/public-commands.js';
import type {AppearanceOptions} from '../../hosted/appearance.js';
import type {PoliciesOptions} from '../policies/model.js';
import type {CategoriesOptions} from './model.js';
/** Category-only reads never opt into variants metadata or availability queries.
 * Recheck current publication and store liveness before returning frozen data. */
export async function readCategoryBuyerPage(pool:Pool,slug:string,options:{appearance?:AppearanceOptions;policies?:PoliciesOptions;categories?:CategoriesOptions},checkout?:HostedCheckoutOptions){
 for(let n=0;n<2;n++){
  const result=await isolatedTransaction(pool,async q=>{
   await q.query('SET TRANSACTION READ ONLY');const store=await resolvePublicStorePage(q,slug,options.appearance,options.policies,undefined,undefined,options.categories);if(!store)return null;
   const purchase=checkout?await publicPurchaseStateWithClient(q,slug,checkout):{open:false as const};
   const current=await resolvePublicStorePage(q,slug);if(!current)return null;
   return current.publicationId===store.publicationId?{store,purchase}:undefined;
  });if(result!==undefined)return result;
 }
 throw new Problem(503,'storefront_catalog_changed','商店內容正在更新，請重新載入。');
}
