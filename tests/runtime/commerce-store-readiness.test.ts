import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {shippingSettingsHarness,type ShippingSettingsHarness,type ShippingTestStore} from './module-registry-harness.js';
import {createShippingQuotePort} from '../../modules/agent-commerce/fulfilment/quote/index.js';
import {hostedCheckoutOptions} from '../../apps/platform-api/src/routes/hosted-checkout.js';
import {storeReadiness,readStoreOverview,listAdminStoreReadiness} from '../../modules/agent-commerce/operations/store-readiness.js';
import {publicPurchaseState,publicPurchaseStateWithClient,createPublicCheckout,placePublicOrder} from '../../modules/agent-commerce/checkout/public-commands.js';
import {createStoreAdmissionPort} from '../../modules/agent-commerce/operations/admissions.js';
import {assertCommerceReadinessPrivacy} from '../../packages/testing/commerce-readiness-privacy.js';
import {bindStore} from '../../modules/agent-commerce/checkout/authority.js';
import {StoreOverviewSchema,AdminStoreReadinessPageSchema,type StoreReadiness} from '../../contracts/guild-launchpad/v1/hosted-commerce-setup.js';
import {DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createTenantListCursorCodec} from '../../packages/shared/tenant-list-cursor.js';
import {TENANT_CURSOR_TEST_KEY} from './tenant-cursor-fixture.js';
import type {Pool,PoolClient} from 'pg';

let h:ShippingSettingsHarness;
before(async()=>{h=await shippingSettingsHarness('fp_readiness');});
beforeEach(async()=>{await h.reset();install(['offline.bank_transfer.v1','offline.cash_on_meetup.v1']);});
after(async()=>{await h?.stop();});
function install(profiles:readonly string[]){h.f.settings.providerProfiles=profiles;h.f.install({commercePorts:{shipping:createShippingQuotePort({environment:'sandbox'})},health:{release_sha:'a'.repeat(40)},tenantListCursors:createTenantListCursorCodec(TENANT_CURSOR_TEST_KEY,{environment:'local',origin:h.f.origin})});}
const deps=()=>({environment:'sandbox' as const,checkout:hostedCheckoutOptions(h.f.origin,h.f.runtime,'local')});
const state=(r:StoreReadiness,key:StoreReadiness['items'][number]['key'])=>r.items.find(item=>item.key===key)!.state;
async function readiness(s:ShippingTestStore){
 const r=await h.f.x.tx(async q=>{await bindStore(q,s.tenantId);return storeReadiness(q,s.tenantId,s.instanceId,deps());});
 assert.equal(r.accepting_orders,(await publicPurchaseState(h.f.x.runtime,s.slug,deps().checkout)).open,'overview must equal the buyer decision');
 assert.deepEqual(r.items.map(item=>item.key),['storefront','products','store_information','release','payment','delivery','admission','platform']);return r;
}
async function bank(s:ShippingTestStore){
 const account=Array.from({length:12},()=>randomInt(10)).join(''),name='合成收款'+randomUUID().slice(0,8),branch='合成分行'+randomUUID().slice(0,8);
 h.expect(await h.request(s,'PUT','/offline-payment-settings',{schema:'freedom.offline-payment-settings/v1',fresh_auth_verification_id:await h.fresh(s),
  bank_transfer:{bank_code:'000',bank_name:'合成銀行',branch_name:branch,account_number:account,account_name:name},cash_on_meetup:{}}),201);
 return {account,name,branch};
}
async function meetup(s:ShippingTestStore){h.expect(await h.request(s,'PUT','/shipping-profile',{...h.document(),delivery_options:[{method:'meetup',note:'請先約定面交時間。'}]}),201);}
async function adminPost(path:string,body:unknown){const bootstrap=h.expect(await h.f.http('GET','/admin/api/bootstrap'));return h.f.http('POST','/admin/api/commerce/store-admissions'+path,body,undefined,{'X-Admin-CSRF':bootstrap.csrf_token,'Idempotency-Key':randomUUID()});}

test('real setup progression shares buyer admission, cart availability and delivery decisions',async()=>{
 const s=await h.f.x.store(10,false);
 await h.f.x.tx(async q=>{
  await bindStore(q,s.tenantId);
  assert.equal(await createStoreAdmissionPort('sandbox',['offline.bank_transfer.v1']).allowed(q,{storefront_shop_id:randomUUID()}),false,'missing storefront profiles are denied without throwing');
 });
 let r=await readiness(s);for(const key of ['storefront','products','store_information','payment','delivery'] as const)assert.equal(state(r,key),'missing');
 assert.equal(state(r,'release'),'upgrade_required');assert.equal(state(r,'admission'),'not_admitted');
 s.product=h.expect(await h.request(s,'POST','/products',{title:'合成自有商品',price_minor:10000,stock:10}),201);await h.f.x.publish(s);
 r=await readiness(s);assert.equal(state(r,'products'),'done');assert.equal(state(r,'storefront'),'done');assert.equal(state(r,'store_information'),'missing');
 const current=h.expect(await h.request(s,'GET',''));
 h.expect(await h.request(s,'PATCH','',{description:'公開交付與售後說明，請先約定面交時間。'},current.version));await h.f.x.publish(s);
 assert.equal(state(await readiness(s),'store_information'),'done');
 const version=(await h.f.x.h.pool.query('SELECT version::text FROM module_instances WHERE instance_id=$1',[s.instanceId])).rows[0].version;
 h.expect(await h.request(s,'POST','/upgrade',{},version));assert.equal(state(await readiness(s),'release'),'done');
 const privateBank=await bank(s);assert.equal(state(await readiness(s),'payment'),'done');
 install([]);r=await readiness(s);assert.equal(state(r,'payment'),'not_offered');assert.deepEqual(r.methods.payment,['bank_transfer','cash_on_meetup']);
 install(['offline.bank_transfer.v1','offline.cash_on_meetup.v1']);await meetup(s);assert.equal(state(await readiness(s),'delivery'),'done');
 const admitted=h.expect(await adminPost('',{tenant_id:s.tenantId,instance_id:s.instanceId,reason:'合成範圍核對完成'}),201);
 r=await readiness(s);assert(r.items.every(item=>item.state==='done'));assert.equal(r.accepting_orders,true);
 assertCommerceReadinessPrivacy(JSON.stringify(r),[...Object.values(privateBank),s.owner.user.email,'合成範圍核對完成']);
 h.f.settings.checkoutEnabled=false;r=await readiness(s);assert.equal(state(r,'delivery'),'done');assert.equal(state(r,'platform'),'paused');assert.equal(r.accepting_orders,false);
 const withoutShipping=await h.f.x.tx(async q=>{await bindStore(q,s.tenantId);return storeReadiness(q,s.tenantId,s.instanceId,{...deps(),checkout:{...deps().checkout,shipping:undefined}});});
 assert.equal(state(withoutShipping,'delivery'),'done','meetup readiness uses checkout delivery choices even without an optional port');assert.equal(state(withoutShipping,'platform'),'paused');assert.equal(withoutShipping.accepting_orders,false);
 h.f.settings.checkoutEnabled=true;
 h.expect(await adminPost('/'+admitted.admission_id+'/revoke',{reason:'合成停止新單'}));r=await readiness(s);assert.equal(state(r,'admission'),'revoked');assert.equal(r.accepting_orders,false);
 h.f.settings.checkoutEnabled=false;r=await readiness(s);assert.equal(state(r,'platform'),'paused');assert.equal(state(r,'delivery'),'done');assert.equal(r.accepting_orders,false);
 h.f.settings.checkoutEnabled=true;h.f.settings.quarantine=true;r=await readiness(s);assert.equal(state(r,'platform'),'paused');assert.equal(JSON.stringify(r).includes('quarantine'),false);
});

test('overview authorizes store reads first, with capability-scoped counts equal to order list filters',async()=>{
 const s=await h.store(),privateBank=await bank(s);await meetup(s);
 h.expect(await adminPost('',{tenant_id:s.tenantId,instance_id:s.instanceId,reason:'合成准入理由不可出現在賣家頁'}),201);
 const access={network:'198.51.100.71',sessionToken:s.owner.cookie.split('=')[1].split(';')[0]};
 const input={...h.f.x.input(s.product.sku,1),delivery:{method:'meetup',name:'合成買家',mobile:'0900000000'}};
 const checkout=await createPublicCheckout(h.f.x.runtime,s.slug,input,randomUUID(),access,deps().checkout);
 const placed=await placePublicOrder(h.f.x.runtime,s.slug,checkout.value.checkout_ref,{terms_sha256:checkout.value.terms_sha256,client_order_id:randomUUID(),payment_method:'bank_transfer'},
  {...access,deviceToken:checkout.cookie.split(';')[0].split('=').slice(1).join('=')},deps().checkout);
 assert(placed.value.order.order_ref);
 const owner=h.expect(await h.request(s,'GET','/overview')),parsed=StoreOverviewSchema.parse(owner);assert(parsed.orders);assert.equal(parsed.orders.awaiting_offline_payment.count,1);
 for(const [key,query] of [['open','lifecycle=open'],['awaiting_offline_payment','awaiting_offline_payment=true'],['needs_action','needs_action=true']] as const){
  const list=h.expect(await h.request(s,'GET','/checkout-orders?'+query));assert.deepEqual(parsed.orders[key],{count:list.items.length,more:false});
 }
 const reader=await h.member(s,['store:read']);assert.equal(h.expect(await h.request(s,'GET','/overview',undefined,undefined,reader.session)).orders,null);
 const stranger=(await h.f.x.h.person('合成無權會員')).session;
 for(const actor of [stranger,undefined]){
  const overview=await h.f.x.h.call('GET',s.root+'/overview',actor,undefined,{},h.f.app),sibling=await h.f.x.h.call('GET',s.root,actor,undefined,{},h.f.app);
  assert.equal(overview.status,sibling.status);assert.equal(overview.data.code,sibling.data.code);
 }
 for(const root of [`/tenants/${s.tenantId}/storefronts/${randomUUID()}`,`/tenants/${randomUUID()}/storefronts/${s.instanceId}`]){
  const overview=await h.f.x.h.call('GET',root+'/overview',s.owner,undefined,{},h.f.app),sibling=await h.f.x.h.call('GET',root,s.owner,undefined,{},h.f.app);
  assert.equal(overview.status,sibling.status);assert.equal(overview.data.code,sibling.data.code);
 }
 assert.equal((await h.request(s,'GET','/overview?unknown=true')).status,422);
 const response=await h.request(s,'GET','/overview');assert.equal(response.response.headers.get('Cache-Control'),'private, no-store');
 const adminEmail=(await h.f.x.h.pool.query('SELECT email FROM platform_admins WHERE admin_id=$1',[h.expect(await h.f.http('GET','/admin/api/bootstrap')).admin.admin_id])).rows[0].email;
 const serialized=JSON.stringify(response.data);assertCommerceReadinessPrivacy(serialized,[...Object.values(privateBank),s.owner.user.email,reader.email,adminEmail]);
 for(const forbidden of ['合成准入理由不可出現在賣家頁','admitted_by','provider_profiles','quarantine'])assert.equal(serialized.includes(forbidden),false,'seller projection is explicitly safe');
 h.f.settings.quarantine=true;const during=h.expect(await h.request(s,'GET','/overview'));assert.equal(state(during,'platform'),'paused');
 const direct=await readStoreOverview(h.f.x.runtime,await h.actor(s),s.tenantId,s.instanceId,deps());assert.equal(direct.accepting_orders,false);
});

test('overview caps real open-order counts at 99 while retaining the more indicator',async()=>{
 const s=await h.f.x.store(200),release=h.expect(await h.request(s,'GET','/release'));
 h.expect(await h.request(s,'POST','/upgrade',{},release.version));
 for(let index=0;index<100;index++)await h.f.x.place(s,await h.f.x.frozen(s,1));
 const overview=StoreOverviewSchema.parse(h.expect(await h.request(s,'GET','/overview')));assert.deepEqual(overview.orders!.open,{count:99,more:true});
 const page=h.expect(await h.request(s,'GET','/checkout-orders?lifecycle=open&limit=50'));assert.equal(page.items.length,50);assert(page.next_cursor);
 const next=h.expect(await h.request(s,'GET','/checkout-orders?lifecycle=open&limit=50&cursor='+encodeURIComponent(page.next_cursor)));assert.equal(next.items.length,50);assert.equal(next.next_cursor,null);
 assert.deepEqual(overview.orders!.awaiting_offline_payment,{count:0,more:false});
});

test('readiness quotes publications larger than one cart and follows live own-stock availability',async()=>{
 const s=await h.f.x.store(0);
 for(let index=0;index<50;index++)h.expect(await h.request(s,'POST','/products',{title:'合成批次商品 '+index,price_minor:10000,stock:1}),201);
 await h.f.x.publish(s);
 const r=await readiness(s),products=r.items.find(item=>item.key==='products')!;
 assert.equal(products.published_count,51);assert.equal(products.sellable_count,50);assert.equal(products.own_stock_count,51);assert.equal(products.state,'done');
});

test('admin receipt list includes inactive and unready stores, all active admissions, community totals and stable pages',async()=>{
 const ready=await h.store(),unready=await h.f.x.store(10,false),inactive=await h.store();
 const privateBank=await bank(ready);await meetup(ready);const member=await h.member(ready,['store:read']);
 const readyAdmission=h.expect(await adminPost('',{tenant_id:ready.tenantId,instance_id:ready.instanceId,reason:'合成可以接單'}),201);
 const blankOwner=(await h.f.x.h.person('合成尚未建檔店主')).session;await h.f.x.h.fullMember(blankOwner.user.user_id,'guild_commerce_sales');
 const blankTenant=await h.f.x.h.createTenant(blankOwner,'合成尚未建檔空間'),blankPlan=await h.f.x.h.plan(blankOwner,blankTenant.tenantId,h.f.x.h.planBody('guild_commerce_sales',blankTenant.workspaceId,'hosted-store','hosted-store@1.0.0'));
 h.expect(blankPlan,201);assert.equal(h.expect(await h.f.x.h.launch(blankOwner,blankTenant.tenantId,blankPlan)).state,'succeeded');
 const admission=h.expect(await adminPost('',{tenant_id:inactive.tenantId,instance_id:inactive.instanceId,reason:'合成保留准入'}),201);
 const adminId=h.expect(await h.f.http('GET','/admin/api/bootstrap')).admin.admin_id;
 await h.f.x.h.pool.query("INSERT INTO commerce_store_admissions(tenant_id,instance_id,environment,admitted_by,reason) VALUES($1,$2,'live',$3,'合成其他環境准入')",[ready.tenantId,ready.instanceId,adminId]);
 await h.f.x.h.pool.query("UPDATE module_instances SET status='suspended',version=version+1 WHERE instance_id=$1",[inactive.instanceId]);
 await h.f.x.h.pool.query("UPDATE tenants SET status='suspended',version=version+1 WHERE tenant_id=$1",[inactive.tenantId]);
 const otherCommunity=randomUUID(),otherAdmin=randomUUID(),otherEmail=`synthetic-${randomUUID()}@example.test`;
 await h.f.x.h.pool.query("INSERT INTO communities VALUES($1,'合成其他社群')",[otherCommunity]);
 await h.f.x.h.pool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)',[otherAdmin,otherCommunity,otherEmail,'合成其他管理員']);
 const otherPerson=await h.f.x.h.person('合成其他社群店主');await h.f.x.h.pool.query('UPDATE users SET community_id=$2 WHERE user_id=$1',[otherPerson.id,otherCommunity]);
 const otherSession=await h.f.x.h.signIn(otherPerson.email),otherTenant=await h.f.x.h.createTenant(otherSession,'合成其他社群空間'),foreignInstance=randomUUID(),foreignBinding=randomUUID();
 // Only the retained module/binding fixture is copied; tenant authority and
 // its real resource scope were created through the normal domain command.
 const fixture=await h.f.x.h.pool.connect();
 try{await fixture.query('BEGIN');
  await fixture.query(`INSERT INTO module_instances(instance_id,tenant_id,module_key,application_release_ref,module_release_ref,data_schema_version,contract_ref,status,binding_id,created_by_principal_id,origin_guild_key)
    SELECT $2,$3,i.module_key,i.application_release_ref,i.module_release_ref,i.data_schema_version,i.contract_ref,'active',$4,t.created_by_principal_id,i.origin_guild_key
    FROM module_instances i JOIN tenants t ON t.tenant_id=$3 WHERE i.instance_id=$1`,[ready.instanceId,foreignInstance,otherTenant.tenantId,foreignBinding]);
  await fixture.query(`INSERT INTO deployment_bindings(binding_id,tenant_id,instance_id,mode,environment,contract_ref,state)
    SELECT $2,$3,$4,'hosted',d.environment,d.contract_ref,'active' FROM deployment_bindings d WHERE d.instance_id=$1`,[ready.instanceId,foreignBinding,otherTenant.tenantId,foreignInstance]);
  await fixture.query('COMMIT');
 }catch(error){await fixture.query('ROLLBACK');throw error;}finally{fixture.release();}
 // Same real endpoint and runtime role, with another community's verified admin.
 const foreignApp=h.f.install({adminVerifier:async()=>({email:otherEmail,subject:'synthetic-other',csrfToken:randomUUID()}),commercePorts:{shipping:createShippingQuotePort({environment:'sandbox'})}});
 const foreign=await foreignApp.request(h.f.origin+'/admin/api/commerce/store-readiness');assert.equal(foreign.status,200);assert.deepEqual(AdminStoreReadinessPageSchema.parse(await foreign.json()).items.map(item=>item.instance_id),[foreignInstance]);
 install(['offline.bank_transfer.v1','offline.cash_on_meetup.v1']);
 const firstReply=await h.f.http('GET','/admin/api/commerce/store-readiness?limit=1&offset=0'),first=AdminStoreReadinessPageSchema.parse(h.expect(firstReply));
 assert.equal(firstReply.response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(first.summary,{stores:4,active_admissions:2,accepting_orders:1});assert.equal(first.release_sha,'a'.repeat(40));assert.equal(first.next_offset,1);
 const all=[];for(let offset=0;offset<4;offset++){const page=AdminStoreReadinessPageSchema.parse(h.expect(await h.f.http('GET','/admin/api/commerce/store-readiness?limit=1&offset='+offset)));assert.deepEqual(page.summary,first.summary);all.push(...page.items);assert.equal(page.next_offset,offset===3?null:offset+1);}
 assert.equal(new Set(all.map(item=>item.instance_id)).size,4);assert.equal(all.some(item=>item.instance_id===foreignInstance),false);assert.equal(all.find(item=>item.tenant_id===blankTenant.tenantId)!.store,null);assert.equal(all.find(item=>item.instance_id===inactive.instanceId)!.admission.active!.admission_id,admission.admission_id);
 assert.equal(all.find(item=>item.instance_id===ready.instanceId)!.admission.active!.admission_id,readyAdmission.admission_id,'another provider environment is excluded');
 assert.equal(all.filter(item=>item.readiness.accepting_orders).length,first.summary.accepting_orders,'whole-community summary equals the same buyer decision on all pages');
 const full=AdminStoreReadinessPageSchema.parse(h.expect(await h.f.http('GET','/admin/api/commerce/store-readiness?limit=50')));
 assert.deepEqual(full.summary,first.summary);assert.equal(full.items.filter(item=>item.readiness.accepting_orders).length,full.summary.accepting_orders);
 const publicPath=full.items.find(item=>item.instance_id===ready.instanceId)!.store!.public_path!;
 assert.equal(publicPath,h.expect(await h.request(ready,'GET','')).publication.public_path);assert.equal((await h.f.app.request(h.f.origin+publicPath)).status,200,'admin link is served by the public storefront router');
 let deliveryQuotes=0;const shipping=createShippingQuotePort({environment:'sandbox'}),cart=shipping.cart!;
 h.f.install({commercePorts:{shipping:{...shipping,cart:async(...args)=>{deliveryQuotes++;return cart(...args);}}}});
 const beyond=AdminStoreReadinessPageSchema.parse(h.expect(await h.f.http('GET','/admin/api/commerce/store-readiness?offset=4')));
 assert.deepEqual(beyond.summary,full.summary);assert.deepEqual(beyond.items,[]);assert.equal(deliveryQuotes,0,'off-page summary skips product and delivery quotes');
 // Measure SQL-only work without logging query text or bound private values.
 await h.f.x.tx(async q=>{
  await bindStore(q,ready.tenantId);let queries=0;
  const counted=new Proxy(q,{get(target,key){if(key==='query')return (...args:unknown[])=>{queries++;return Reflect.apply(target.query,target,args);};return Reflect.get(target,key);}});
  await storeReadiness(counted,ready.tenantId,ready.instanceId,deps());const fullQueries=queries;queries=0;
  await publicPurchaseStateWithClient(counted,ready.slug,deps().checkout);
  console.log(JSON.stringify({readiness_sql_queries:fullQueries,buyer_gate_sql_queries:queries,published_products:1,own_stock_delivery_choices:1}));
 });
 assert.equal(state(all.find(item=>item.instance_id===unready.instanceId)!.readiness,'storefront'),'missing');
 assert.equal(all.find(item=>item.instance_id===inactive.instanceId)!.tenant_status,'suspended');
 const memberAdmin=randomUUID();await h.f.x.h.pool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)',[memberAdmin,DEMO_COMMUNITY,ready.owner.user.email,'合成成員管理員']);
 const memberApp=h.f.install({adminVerifier:async()=>({email:ready.owner.user.email,subject:'synthetic-member',csrfToken:randomUUID()}),commercePorts:{shipping:createShippingQuotePort({environment:'sandbox'})}});
 const memberResult=AdminStoreReadinessPageSchema.parse(await (await memberApp.request(h.f.origin+'/admin/api/commerce/store-readiness')).json());assert.equal(memberResult.items.find(item=>item.instance_id===ready.instanceId)!.admin_is_member,true);
 const adminEmail=(await h.f.x.h.pool.query('SELECT email FROM platform_admins WHERE admin_id=$1',[adminId])).rows[0].email;
 const privateValues=[...Object.values(privateBank),ready.owner.user.email,unready.owner.user.email,inactive.owner.user.email,blankOwner.user.email,otherPerson.email,otherEmail,member.email,adminEmail];
 for(const document of [full,memberResult])assertCommerceReadinessPrivacy(JSON.stringify(document),privateValues);
 for(const query of ['limit=0','limit=51','offset=-1','limit=1&limit=2','unknown=1'])assert.equal((await memberApp.request(h.f.origin+'/admin/api/commerce/store-readiness?'+query)).status,422);
 await h.f.x.h.pool.query('UPDATE platform_admins SET active=false,aggregate_version=aggregate_version+1 WHERE admin_id=$1',[memberAdmin]);
 assert.equal((await memberApp.request(h.f.origin+'/admin/api/commerce/store-readiness')).status,403);
});

test('admin pages read bounded admission history and no off-page membership details',async()=>{
 const stores=[await h.store(),await h.store(),await h.store()];
 const admin=h.expect(await h.f.http('GET','/admin/api/bootstrap')).admin;
 for(const s of stores){
  // Retained history grows independently of the number of stores on a page.
  for(let index=0;index<30;index++){
   const row=(await h.f.x.h.pool.query(`INSERT INTO commerce_store_admissions(tenant_id,instance_id,environment,admitted_by,reason)
    VALUES($1,$2,'sandbox',$3,'合成歷史准入') RETURNING admission_id`,[s.tenantId,s.instanceId,admin.admin_id])).rows[0];
   await h.f.x.h.pool.query(`UPDATE commerce_store_admissions SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason='合成歷史撤銷' WHERE admission_id=$1`,[row.admission_id,admin.admin_id]);
  }
  h.expect(await adminPost('',{tenant_id:s.tenantId,instance_id:s.instanceId,reason:'合成目前准入'}),201);
 }
 let historyRows:Record<string,unknown>[]=[],membershipReads=0,queries=0;
 const counted=new Proxy(h.f.x.runtime,{get(target,key){
  if(key==='connect')return async()=>{
   const q=await target.connect();
   return new Proxy(q,{get(client,property){
    if(property==='query')return async(...args:unknown[])=>{
     queries++;const result=await Reflect.apply(client.query,client,args);
     if(result?.rows)historyRows.push(...result.rows.filter((row:Record<string,unknown>)=>'admission_id' in row&&'reason' in row));
     if(typeof args[0]==='string'&&args[0].includes('tenant_memberships')&&args[0].includes('lower('))membershipReads++;
     return result;
    };
    const value=Reflect.get(client,property);return typeof value==='function'?value.bind(client):value;
   }}) as PoolClient;
  };
  return Reflect.get(target,key);
 }}) as Pool;
 const page=await listAdminStoreReadiness(counted,admin,deps(),1,0,null);
 assert.equal(page.summary.stores,3);assert.equal(page.summary.active_admissions,3);
 assert.equal(page.items.length,1);assert(page.items[0].admission.active);assert(page.items[0].admission.last_revoked);
 const latest=(await h.f.x.h.pool.query(`SELECT admission_id FROM commerce_store_admissions WHERE instance_id=$1 AND environment='sandbox' AND revoked_at IS NOT NULL ORDER BY admitted_at DESC,admission_id DESC LIMIT 1`,[page.items[0].instance_id])).rows[0];
 assert.equal(page.items[0].admission.last_revoked!.admission_id,latest.admission_id);
 console.log(JSON.stringify({admin_page_queries:queries,admission_history_rows:historyRows.length,membership_reads:membershipReads,stores:3,page_size:1,history_per_store:31}));
 assert.equal(historyRows.length,2,'only the active and latest revoked admission for the page are materialized');
 assert(historyRows.every(row=>row.instance_id===page.items[0].instance_id),'off-page admission history is never read');
 assert.equal(membershipReads,1,'membership is checked only for displayed tenants');
 historyRows=[];membershipReads=0;
 const beyond=await listAdminStoreReadiness(counted,admin,deps(),1,3,null);
 assert.deepEqual(beyond.summary,page.summary);assert.deepEqual(beyond.items,[]);
 assert.equal(historyRows.length,0);assert.equal(membershipReads,0);
});

test('admin accepting totals remain equal across pages for a self-ship-only store with delivery disabled',async()=>{
 const s=await h.store();await bank(s);
 h.f.install({commerceSelfShipEnabled:true,commercePorts:{shipping:createShippingQuotePort({environment:'sandbox',selfShipEnabled:true})}});
 h.expect(await h.request(s,'PUT','/shipping-profile',{...h.document(),services:[],delivery_options:[{method:'self_ship',fee_per_order_minor:0,handling_days:2,note:null}]}),201);
 h.expect(await adminPost('',{tenant_id:s.tenantId,instance_id:s.instanceId,reason:'合成寄送試用'}),201);
 for(const enabled of [true,false]){
  h.f.install({commerceSelfShipEnabled:enabled,commercePorts:{shipping:createShippingQuotePort({environment:'sandbox',selfShipEnabled:enabled})}});
  const first=AdminStoreReadinessPageSchema.parse(h.expect(await h.f.http('GET','/admin/api/commerce/store-readiness?limit=1')));
  const beyond=AdminStoreReadinessPageSchema.parse(h.expect(await h.f.http('GET','/admin/api/commerce/store-readiness?limit=1&offset=1')));
  assert.equal(first.items[0].readiness.accepting_orders,enabled);
  assert.equal(first.summary.accepting_orders,enabled?1:0);
  assert.deepEqual(beyond.summary,first.summary,'receipt totals cannot depend on whether the store is on the requested page');
 }
});
