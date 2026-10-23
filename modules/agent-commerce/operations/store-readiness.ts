import type {Pool,PoolClient} from 'pg';
import {CartQuoteResponseSchema} from '../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {AdminStoreReadinessPageSchema,StoreOverviewSchema,StoreReadinessSchema,type StoreReadiness,type AdminStoreReadinessPage} from '../../../contracts/guild-launchpad/v1/hosted-commerce-setup.js';
import {Problem,requireCondition} from '../../../packages/shared/problem.js';
import {bindPlatformAdminContext,isolatedTransaction} from '../../../packages/resource-scopes/tenant-transaction.js';
import {profile,storeRead,publicStorePath} from '../hosted/store.js';
import {createShippingQuotePort} from '../fulfilment/quote/index.js';
import {effectiveStoreCapabilities} from '../hosted/capabilities.js';
import type {Actor} from '../../identity-membership/service.js';
import type {AdminActor} from '../../platform-admin/service.js';
import {bindTenantScope} from '../../tenant-workspaces/facts.js';
import {sellerOverviewOrderCounts} from '../checkout/seller-orders.js';
import {cartQuote} from '../checkout/cart-quote.js';
import {publicCheckoutPlatformOpen,publicPurchaseStateWithClient,type HostedCheckoutOptions} from '../checkout/public-commands.js';
import {admissionAdminIsMember,storeAdmissionView,readStoreAdmissionFacts,type CommerceProviderEnvironment} from './admissions.js';

export interface StoreReadinessDependencies {checkout:HostedCheckoutOptions;environment:CommerceProviderEnvironment}
/** Caller authorizes the store and binds its tenant first. This is database-only;
 * quote ports must be the runtime's local quote/admission ports, never provider I/O. */
export async function storeReadiness(q:PoolClient,tenantId:string,instanceId:string,deps:StoreReadinessDependencies):Promise<StoreReadiness>{
  const admin=(await q.query("SELECT nullif(current_setting('freedom.platform_admin_id',true),'') AS id")).rows[0].id as string|null;
  try{
    const {checkout,environment}=deps,settings=checkout.settings;
    const facts=await readStoreAdmissionFacts(q,tenantId,instanceId,environment,settings?.providerProfiles??[]);
    const p=await profile(q,tenantId,instanceId);
    const published=!!p?.current_publication_id;
    const publication=published?p!.projection as {revision:string;description:string;products:{sku:string;price_minor:number}[]}:null;
    const products=publication?.products??[];
    let sellable=0;
    if(p&&publication){
      for(let offset=0;offset<products.length;offset+=50){
        try{
          // The cart owns availability, including expired holds, allocations and
          // unavailable supply. No copied inventory arithmetic or settlement.
          const quote=await cartQuote(q,p,{publication_revision:publication.revision,lines:products.slice(offset,offset+50).map(({sku})=>({sku,quantity:1}))},checkout);
          sellable+=quote.lines.filter(line=>line.state==='ok'||line.state==='revision_changed').length;
        }catch(error){
          if(!(error instanceof Problem&&['storefront_unavailable','checkout_store_not_found','storefront_not_set_up'].includes(error.code)))throw error;
        }
      }
    }
    const own=p?(await q.query<{item_id:string;sku:string;price_minor:number}>(`SELECT i.item_id,coalesce(s.hosted_sku,i.sku) AS sku,s.retail_price_minor AS price_minor
      FROM commerce_selections s JOIN commerce_items i ON i.item_id=s.item_id
      WHERE s.shop_id=$1 AND i.shop_id=$2 AND coalesce(s.hosted_sku,i.sku)=ANY($3::text[]) ORDER BY i.item_id`,
    [p.storefront_shop_id,p.supply_shop_id,products.map(product=>product.sku)])).rows:[];
    const shipping=(await q.query<{version:string;methods:StoreReadiness['methods']['delivery']}>(`SELECT version::text,
      ARRAY(SELECT option->>'method' FROM jsonb_array_elements(document->'delivery_options') option) AS methods
      FROM commerce_shipping_profile_versions WHERE tenant_id=$1 AND instance_id=$2 ORDER BY version DESC LIMIT 1`,[tenantId,instanceId])).rows[0];
    let deliveryReady=false;
    // Node and Worker install this same SQL-local port even with checkout off.
    // Direct authorized callers also get its delivery choices when no port was supplied.
    const shippingCart=checkout.shipping?.cart??createShippingQuotePort({environment,selfShipEnabled:checkout.selfShipEnabled===true}).cart!;
    if(p&&shipping?.methods.length){
      // Evaluate actual own-stock lines independently: a supply line the cart
      // cannot fulfil must not hide a usable own-stock delivery choice.
      for(const item of own){
        const price=Number(item.price_minor);
        const result=await shippingCart(q,p,{lines:[{sku:item.sku,item_id:item.item_id,quantity:1,unit_price_minor:price,supplier_shop_id:p.supply_shop_id,own:true}],merchandise_net_minor:price,delivery:null});
        const choices=CartQuoteResponseSchema.shape.delivery_options.parse((result as {delivery_options:unknown}).delivery_options);
        if(choices.some(option=>option.available&&(option.method!=='self_ship'||facts.bank_transfer))){deliveryReady=true;break;}
      }
    }
    const payment:StoreReadiness['methods']['payment']=[];
    if(facts.bank_transfer)payment.push('bank_transfer');
    if(facts.cash_on_meetup)payment.push('cash_on_meetup');
    if(facts.card)payment.push('card');
    const accepting=p?.slug?(await publicPurchaseStateWithClient(q,p.slug,checkout)).open:false;
    return StoreReadinessSchema.parse({accepting_orders:accepting&&(!(shipping?.methods.length&&shipping.methods.every(method=>method==='self_ship'))||deliveryReady),items:[
      {key:'storefront',state:published?'done':'missing',revision:p?.revision??null},
      {key:'products',state:sellable?'done':'missing',published_count:products.length,sellable_count:sellable,own_stock_count:own.length},
      {key:'store_information',state:publication?.description?.trim()?'done':'missing'},
      {key:'release',state:facts.release_ready?'done':'upgrade_required',module_release_ref:facts.module_release_ref},
      {key:'payment',state:facts.usable_payment?'done':payment.length?'not_offered':'missing',version:facts.payment_version},
      {key:'delivery',state:deliveryReady?'done':'missing',version:shipping?.version??null},
      {key:'admission',state:facts.active_admission?'done':facts.last_revoked?'revoked':'not_admitted'},
      {key:'platform',state:publicCheckoutPlatformOpen(checkout)?'done':'paused'},
    ],methods:{payment,delivery:(shipping?.methods??[]).filter(method=>method!=='self_ship'||checkout.selfShipEnabled===true)}});
  }finally{
    // Checkout's supplier resolver restores the seller tenant but clears admin
    // context. Retain the authorized admin context for the caller's next read.
    if(admin)await bindPlatformAdminContext(q,admin);
  }
}

export function readStoreOverview(pool:Pool,actor:Actor,tenantId:string,instanceId:string,deps:StoreReadinessDependencies){
  return storeRead(pool,actor,tenantId,instanceId,'store:read',async(q,context)=>{
    const keys=await effectiveStoreCapabilities(q,context,instanceId),p=await profile(q,tenantId,instanceId);
    const orders=keys.includes('store:orders:read')?(p?await sellerOverviewOrderCounts(q,tenantId,instanceId,p.storefront_shop_id):{
      open:{count:0,more:false},awaiting_offline_payment:{count:0,more:false},needs_action:{count:0,more:false},
    }):null;
    return StoreOverviewSchema.parse({tenant_id:tenantId,instance_id:instanceId,environment:deps.environment,
      ...await storeReadiness(q,tenantId,instanceId,deps),orders,checked_at:new Date().toISOString()});
  });
}

async function authorizeAdmin(q:PoolClient,admin:AdminActor){
  requireCondition((await q.query('SELECT 1 FROM platform_admins WHERE admin_id=$1 AND community_id=$2 AND email=$3 AND active FOR SHARE',
    [admin.admin_id,admin.community_id,admin.email])).rowCount===1,403,'admin_required','管理權限已變更。');
  await bindPlatformAdminContext(q,admin.admin_id);
}
export async function listAdminStoreReadiness(pool:Pool,admin:AdminActor,deps:StoreReadinessDependencies,limit:number,offset:number,releaseSha:string|null){
  // resource_scopes is the exempt identity directory. Tenant rows themselves
  // remain protected by RLS; bind each identity before checking community.
  const tenants=await isolatedTransaction(pool,async q=>{
    await authorizeAdmin(q,admin);
    return (await q.query<{tenant_id:string}>("SELECT tenant_ref AS tenant_id FROM resource_scopes WHERE kind='tenant' ORDER BY tenant_ref")).rows;
  });
  const items:AdminStoreReadinessPage['items']=[];
  const summary={stores:0,active_admissions:0,accepting_orders:0};
  for(const {tenant_id} of tenants){
    await isolatedTransaction(pool,async q=>{
      await authorizeAdmin(q,admin);await bindTenantScope(q,tenant_id);
      const tenant=(await q.query('SELECT display_name,status FROM tenants WHERE tenant_id=$1 AND community_id=$2',[tenant_id,admin.community_id])).rows[0];
      if(!tenant)return;
      const instances=(await q.query<{instance_id:string;status:string;module_release_ref:string}>("SELECT instance_id,status,module_release_ref FROM module_instances WHERE tenant_id=$1 AND module_key='storefront' ORDER BY instance_id",[tenant_id])).rows;
      const member=await admissionAdminIsMember(q,admin,tenant_id);
      for(const inst of instances){
        const p=await profile(q,tenant_id,inst.instance_id);
        const rows=(await q.query('SELECT * FROM commerce_store_admissions WHERE tenant_id=$1 AND instance_id=$2 AND environment=$3 ORDER BY admitted_at DESC,admission_id DESC',[tenant_id,inst.instance_id,deps.environment])).rows;
        const active=rows.find(row=>row.revoked_at===null),index=summary.stores++;
        if(active)summary.active_admissions++;
        if(index<offset||index>=offset+limit){
          // Summary uses the buyer gate without cart/product/delivery quotes.
          try{if(p?.slug&&(await publicPurchaseStateWithClient(q,p.slug,deps.checkout)).open)summary.accepting_orders++;}
          finally{await bindPlatformAdminContext(q,admin.admin_id);}
          continue;
        }
        const readiness=await storeReadiness(q,tenant_id,inst.instance_id,deps);
        if(readiness.accepting_orders)summary.accepting_orders++;
        items.push({tenant_id,tenant_display_name:tenant.display_name,tenant_status:tenant.status,instance_id:inst.instance_id,instance_status:inst.status,
          store:p?{name:p.name,slug:p.slug,public_path:p.slug&&p.current_publication_id?publicStorePath(p.slug):null}:null,module_release_ref:inst.module_release_ref,
          admission:{active:active?storeAdmissionView(active):null,
            last_revoked:rows.find(row=>row.revoked_at!==null)?storeAdmissionView(rows.find(row=>row.revoked_at!==null)!):null},admin_is_member:member,
          readiness});
      }
    });
  }
  return AdminStoreReadinessPageSchema.parse({environment:deps.environment,checked_at:new Date().toISOString(),release_sha:releaseSha,
    platform:{checkout_enabled:deps.checkout.settings?.checkoutEnabled===true,quarantine:deps.checkout.settings?.quarantine===true,provider_profiles:[...deps.checkout.settings?.providerProfiles??[]]},
    summary,items,next_offset:summary.stores>offset+limit?offset+limit:null});
}
