import assert from 'node:assert/strict';
import {randomInt,randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {shippingSettingsHarness,type ShippingSettingsHarness,type ShippingTestStore} from './module-registry-harness.js';
import {createShippingQuotePort} from '../../modules/agent-commerce/fulfilment/quote/index.js';
import {hostedCheckoutOptions} from '../../apps/platform-api/src/routes/hosted-checkout.js';
import {storeReadiness,readStoreOverview} from '../../modules/agent-commerce/operations/store-readiness.js';
import {publicPurchaseState,createPublicCheckout,placePublicOrder} from '../../modules/agent-commerce/checkout/public-commands.js';
import {bindStore} from '../../modules/agent-commerce/checkout/authority.js';
import {StoreOverviewSchema,AdminStoreReadinessPageSchema,type StoreReadiness} from '../../contracts/guild-launchpad/v1/hosted-commerce-setup.js';
import {DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {createTenantListCursorCodec} from '../../packages/shared/tenant-list-cursor.js';
import {TENANT_CURSOR_TEST_KEY} from './tenant-cursor-fixture.js';

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
 const account=Array.from({length:12},()=>randomInt(10)).join(''),name='合成收款'+randomUUID().slice(0,8);
 h.expect(await h.request(s,'PUT','/offline-payment-settings',{schema:'freedom.offline-payment-settings/v1',fresh_auth_verification_id:await h.fresh(s),
  bank_transfer:{bank_code:'000',bank_name:'合成銀行',account_number:account,account_name:name},cash_on_meetup:{}}),201);
 return {account,name};
}
async function meetup(s:ShippingTestStore){h.expect(await h.request(s,'PUT','/shipping-profile',{...h.document(),delivery_options:[{method:'meetup',note:'請先約定面交時間。'}]}),201);}
async function adminPost(path:string,body:unknown){const bootstrap=h.expect(await h.f.http('GET','/admin/api/bootstrap'));return h.f.http('POST','/admin/api/commerce/store-admissions'+path,body,undefined,{'X-Admin-CSRF':bootstrap.csrf_token,'Idempotency-Key':randomUUID()});}

test('real setup progression shares buyer admission, cart availability and delivery decisions',async()=>{
 const s=await h.f.x.store(10,false);
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
 const text=JSON.stringify(r);for(const privateValue of [privateBank.account,privateBank.name,'合成範圍核對完成'])assert.equal(text.includes(privateValue),false,'readiness excludes private values and reasons');
 h.expect(await adminPost('/'+admitted.admission_id+'/revoke',{reason:'合成停止新單'}));r=await readiness(s);assert.equal(state(r,'admission'),'revoked');assert.equal(r.accepting_orders,false);
 h.f.settings.checkoutEnabled=false;assert.equal(state(await readiness(s),'platform'),'paused');
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
 const serialized=JSON.stringify(response.data);for(const forbidden of [privateBank.account,privateBank.name,'合成准入理由不可出現在賣家頁','admitted_by','provider_profiles','quarantine'])assert.equal(serialized.includes(forbidden),false,'seller projection is explicitly safe');
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
 assert.equal(firstReply.response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(first.summary,{stores:4,active_admissions:1,accepting_orders:0});assert.equal(first.release_sha,'a'.repeat(40));assert.equal(first.next_offset,1);
 const all=[];for(let offset=0;offset<4;offset++){const page=AdminStoreReadinessPageSchema.parse(h.expect(await h.f.http('GET','/admin/api/commerce/store-readiness?limit=1&offset='+offset)));assert.deepEqual(page.summary,first.summary);all.push(...page.items);assert.equal(page.next_offset,offset===3?null:offset+1);}
 assert.equal(new Set(all.map(item=>item.instance_id)).size,4);assert.equal(all.some(item=>item.instance_id===foreignInstance),false);assert.equal(all.find(item=>item.tenant_id===blankTenant.tenantId)!.store,null);assert.equal(all.find(item=>item.instance_id===inactive.instanceId)!.admission.active!.admission_id,admission.admission_id);
 assert.equal(all.find(item=>item.instance_id===ready.instanceId)!.admission.active,null,'another provider environment is excluded');
 assert.equal(state(all.find(item=>item.instance_id===unready.instanceId)!.readiness,'storefront'),'missing');
 assert.equal(all.find(item=>item.instance_id===inactive.instanceId)!.tenant_status,'suspended');
 const memberAdmin=randomUUID();await h.f.x.h.pool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)',[memberAdmin,DEMO_COMMUNITY,ready.owner.user.email,'合成成員管理員']);
 const memberApp=h.f.install({adminVerifier:async()=>({email:ready.owner.user.email,subject:'synthetic-member',csrfToken:randomUUID()}),commercePorts:{shipping:createShippingQuotePort({environment:'sandbox'})}});
 const memberResult=AdminStoreReadinessPageSchema.parse(await (await memberApp.request(h.f.origin+'/admin/api/commerce/store-readiness')).json());assert.equal(memberResult.items.find(item=>item.instance_id===ready.instanceId)!.admin_is_member,true);
 assert.equal(JSON.stringify(memberResult).includes(ready.owner.user.email),false);assert.equal(JSON.stringify(memberResult).includes('account_number'),false);
 for(const query of ['limit=0','limit=51','offset=-1','limit=1&limit=2','unknown=1'])assert.equal((await memberApp.request(h.f.origin+'/admin/api/commerce/store-readiness?'+query)).status,422);
 await h.f.x.h.pool.query('UPDATE platform_admins SET active=false,aggregate_version=aggregate_version+1 WHERE admin_id=$1',[memberAdmin]);
 assert.equal((await memberApp.request(h.f.origin+'/admin/api/commerce/store-readiness')).status,403);
});
