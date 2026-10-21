import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {SellerPoliciesAckSchema,SellerPoliciesDraftSchema,SellerPoliciesWireSchema,emptySellerPolicies,POLICY_KINDS,SELLER_FIELDS} from '../../contracts/guild-launchpad/v1/storefront-policies.js';
import {createHostedStorePhotoHarness,type HostedStorePhotoHarness} from '../helpers/hosted-store-photo.js';
import {syntheticSeller,legalHash} from '../helpers/storefront-policies.js';
let f:HostedStorePhotoHarness,on:ReturnType<HostedStorePhotoHarness['application']>;
type Store=Awaited<ReturnType<HostedStorePhotoHarness['openStore']>>;
before(async()=>{f=await createHostedStorePhotoHarness();await f.reset();on=f.application(false,{storePoliciesEnabled:true,storePhotoAssetStore:undefined,storePhotoAssets:undefined});});after(async()=>{await f?.stop();});
function input(){const v=emptySellerPolicies();v.seller={...syntheticSeller};for(const k of POLICY_KINDS)v.policies[k].body='合成'+k+'政策';return v;}
const call=(s:Store,method:string,suffix:string,body?:unknown,version?:string,key=randomUUID(),app=on,member=s.owner)=>f.h.call(method,s.root+suffix,member,body,{'Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})},app);
async function draft(s:Store){const r=await call(s,'GET','/seller-policies');f.ok(r);assert.equal(r.response.headers.get('cache-control'),'private, no-store');assert.equal(r.response.headers.get('vary'),'Cookie');return SellerPoliciesDraftSchema.parse(r.data);}
async function save(s:Store,body=input(),version?:string,key=randomUUID()){const r=await call(s,'PUT','/seller-policies',body,version??(await draft(s)).version,key);f.ok(r);return SellerPoliciesAckSchema.parse(r.data);}
async function counts(s:Store){return (await f.h.pool.query(`SELECT p.version::text,(SELECT count(*)::int FROM commerce_storefront_seller_versions WHERE instance_id=$1) sellers,(SELECT count(*)::int FROM commerce_storefront_policy_versions WHERE instance_id=$1) policies,(SELECT count(*)::int FROM scoped_command_receipts WHERE operation='storefront.seller-policies.save' AND scope_id=(SELECT scope_id FROM resource_scopes WHERE tenant_ref=p.tenant_id AND kind='tenant')) receipts FROM commerce_storefront_profiles p WHERE instance_id=$1`,[s.instanceId])).rows[0];}
test('POL-CMD-01 explicit empty drafts never prefill account fields; atomic changed and normalized no-op saves',async()=>{
 const s=await f.openStore(),initial=await draft(s);assert.deepEqual(initial.seller,emptySellerPolicies().seller);assert.equal(initial.dirty,false);
 const saved=await save(s);assert.equal(saved.completed_version,'2');assert(saved.changed);assert(saved.current.dirty);const before=await counts(s);assert.equal(before.sellers,1);assert.equal(before.policies,4);
 const same=input();same.seller.business_name=' '+same.seller.business_name+' ';same.policies.shipping.body+='\r\n ';
 const noop=await save(s,same);assert.equal(noop.changed,false);assert.equal(noop.completed_version,'2');const after=await counts(s);assert.equal(after.sellers,before.sellers);assert.equal(after.policies,before.policies);assert.equal(after.version,before.version);
 const changed=input();changed.policies.shipping.body='合成修訂配送';await save(s,changed);assert.equal((await counts(s)).policies,5);assert.equal((await counts(s)).sellers,1);
});
test('POL-CMD-02 same-key replay keeps original completion and returns current authorized draft; CAS and body conflicts write nothing',async()=>{
 const s=await f.openStore(),key=randomUUID();await save(s,input(),'1',key);const changed=input();changed.seller.phone='';const newer=await save(s,changed);const replay=await save(s,input(),'1',key);assert.equal(replay.completed_version,'2');assert.equal(replay.current.version,newer.current.version);assert.equal(replay.current.seller.phone,'');
 const before=await counts(s);assert.equal((await call(s,'PUT','/seller-policies',input(),'1')).status,412);assert.equal((await call(s,'PUT','/seller-policies',changed,'1',key)).status,409);assert.deepEqual(await counts(s),before);
});
test('POL-CMD-03 concurrency creates one changed component set and one successful CAS',async()=>{
 const s=await f.openStore(),key=randomUUID(),body=input();const replies=await Promise.all([call(s,'PUT','/seller-policies',body,'1',key),call(s,'PUT','/seller-policies',body,'1',key)]);for(const r of replies)f.ok(r);assert.deepEqual(await counts(s),{version:'2',sellers:1,policies:4,receipts:1});
 const update=input();update.policies.terms.body='合成修訂條款';const fresh=await Promise.all([call(s,'PUT','/seller-policies',update,'2'),call(s,'PUT','/seller-policies',update,'2')]);assert.deepEqual(fresh.map(r=>r.status).sort(),[200,412]);assert.equal((await counts(s)).policies,5);
});
test('POL-CMD-04 store:manage authority applies to the entire section and replays reauthorize',async()=>{
 const s=await f.openStore(),key=randomUUID();await save(s,input(),'1',key);
 for(const keys of [['store:read'],['store:read','store:write'],['store:read','store:publish'],['store:read','store:manage']]){
  const member=(await f.h.person('合成政策權限會員')).session,principal=f.ok(await f.call('GET',`/tenants/invite-candidates?user_id=${member.user.user_id}`,s.owner)).principal_id;
  const invitation=f.ok(await f.post(`/tenants/${s.tenantId}/invitations`,s.owner,{invitee_principal_id:principal,role:'operator',instance_capabilities:[{instance_id:s.instanceId,capabilities:keys}],expires_at:new Date(Date.now()+86400000).toISOString()}),201);f.ok(await f.post(`/tenants/${s.tenantId}/invitations/${invitation.invitation_id}/accept`,member,{},invitation.version));
  assert.equal((await call(s,'GET','/seller-policies',undefined,undefined,undefined,on,member)).status,200);
  const r=await call(s,'PUT','/seller-policies',input(),'1',key,on,member);assert.equal(r.status,keys.includes('store:manage')?412:403,'receipt key also binds the actor');
  if(keys.includes('store:manage')){const v=(await draft(s)).version;const managerKey=randomUUID();f.ok(await call(s,'PUT','/seller-policies',input(),v,managerKey,on,member));const before=await counts(s);await f.h.pool.query("UPDATE tenant_module_permissions SET capabilities=ARRAY['store:read'],version=version+1 WHERE tenant_id=$1 AND principal_id=$2",[s.tenantId,principal]);assert.equal((await call(s,'PUT','/seller-policies',input(),v,managerKey,on,member)).status,403);assert.deepEqual(await counts(s),before);assert.equal((await call(s,'POST','/publish',{},v,randomUUID(),on,member)).status,403);}
 }
 const stranger=await f.openStore();const a=await call(s,'GET','/seller-policies',undefined,undefined,undefined,on,stranger.owner),b=await f.h.call('GET',`/tenants/${randomUUID()}/storefronts/${randomUUID()}/seller-policies`,stranger.owner,undefined,{},on);assert.equal(a.status,b.status);assert.deepEqual(a.data,b.data);
 assert.equal((await f.h.call('GET',s.root+'/seller-policies',undefined,undefined,{},on)).status,401);const before=await counts(s);await f.h.pool.query("UPDATE deployment_bindings SET state='suspended' WHERE tenant_id=$1 AND instance_id=$2",[s.tenantId,s.instanceId]);assert.equal((await call(s,'PUT','/seller-policies',input(),'1',key)).status,409);assert.deepEqual(await counts(s),before);await f.h.pool.query("UPDATE deployment_bindings SET state='active' WHERE tenant_id=$1 AND instance_id=$2",[s.tenantId,s.instanceId]);
});
test('POL-CMD-05 validation is atomic and errors contain fixed fields, never submitted text',async()=>{
 const s=await f.openStore(),bad=input();bad.seller.business_name='';bad.policies.shipping.body='<script>'+ '字'.repeat(10001);const before=await counts(s);const r=await call(s,'PUT','/seller-policies',bad,'1');assert.equal(r.status,422);assert(r.data.fields.some((v:any)=>v.field==='seller.business_name'));assert.doesNotMatch(JSON.stringify(r.data),/<script>/i);assert.doesNotMatch(JSON.stringify(r.data),/seller@example.test|測試市/);assert.deepEqual(await counts(s),before);
 for(const [headers,status] of [[{'Idempotency-Key':'valid-key'},428],[{'Idempotency-Key':'valid-key','If-Match':'1'},400],[{'If-Match':'"1"'},400]] as const){const reply=await f.h.call('PUT',s.root+'/seller-policies',s.owner,input(),headers,on);assert.equal(reply.status,status);}
});
test('POL-CMD-06 maximum structural input reaches field validation under the existing snapshot cap; wire overflow is 413',async()=>{
 const s=await f.openStore(),raw=input();for(const k of POLICY_KINDS)raw.policies[k].body='\u0001'.repeat(10000);
 for(const [k,[,max]] of Object.entries(SELLER_FIELDS))raw.seller[k as keyof typeof raw.seller]='\u0001'.repeat(max*2);
 assert(SellerPoliciesWireSchema.safeParse(raw).success);assert(Buffer.byteLength(JSON.stringify(raw))<262144);
 const result=await call(s,'PUT','/seller-policies',raw,'1');assert.equal(result.status,422);assert.equal(result.data.code,'seller_policies_invalid');assert(result.data.fields.length>0,'largest structural body reached command field validation');
 raw.policies.shipping.body='\u0001'.repeat(10001);assert.equal((await call(s,'PUT','/seller-policies',raw,'1')).status,422);
 for(const k of POLICY_KINDS)raw.policies[k].body='字'.repeat(50000);assert.equal((await call(s,'PUT','/seller-policies',raw,'1')).status,413);
 const near=input();near.policies.shipping.body='😀'.repeat(10000);assert.equal((await call(s,'PUT','/seller-policies',near,'1')).status,200);
 const neighboring=await call(s,'PATCH','', {description:'字'.repeat(12000)},(await draft(s)).version);assert.equal(neighboring.status,413);
});
test('POL-CMD-07 version 501 maps to fixed 409 and rolls back the whole section',async()=>{
 const s=await f.openStore();await f.h.pool.query(`INSERT INTO commerce_storefront_policy_versions(version_id,tenant_id,instance_id,kind,version_no,created_at_profile_version,body,content_sha256) SELECT gen_random_uuid(),$1,$2,'shipping',n,1,'合成上限政策',$3 FROM generate_series(1,500) n ORDER BY n`,[s.tenantId,s.instanceId,legalHash({kind:'shipping',body:'合成上限政策'})]);await f.h.pool.query("INSERT INTO commerce_storefront_policy_drafts(tenant_id,instance_id,kind,version_id) SELECT tenant_id,instance_id,kind,version_id FROM commerce_storefront_policy_versions WHERE instance_id=$1 AND kind='shipping' AND version_no=500",[s.instanceId]);
 const before=await counts(s),r=await call(s,'PUT','/seller-policies',input(),'1');assert.equal(r.status,409);assert.equal(r.data.code,'seller_policies_version_limit');assert.equal(r.data.detail,'賣方資訊與商店政策的版本已達上限（每項 500 個），請聯絡平台協助。');assert.deepEqual(await counts(s),before);
 const seller=await f.openStore();await f.h.pool.query(`INSERT INTO commerce_storefront_seller_versions(version_id,tenant_id,instance_id,version_no,created_at_profile_version,business_name,email,phone,address,service_hours,tax_id,responsible_person,content_sha256)
 SELECT gen_random_uuid(),$1,$2,n,1,'合成測試商行','','','','','','',$3 FROM generate_series(1,500) n ORDER BY n`,[seller.tenantId,seller.instanceId,legalHash({...emptySellerPolicies().seller,business_name:'合成測試商行'})]);await f.h.pool.query('INSERT INTO commerce_storefront_seller_drafts(tenant_id,instance_id,version_id) SELECT tenant_id,instance_id,version_id FROM commerce_storefront_seller_versions WHERE instance_id=$1 AND version_no=500',[seller.instanceId]);const sellerBefore=await counts(seller),denied=await call(seller,'PUT','/seller-policies',input(),'1');assert.equal(denied.status,409);assert.equal(denied.data.code,'seller_policies_version_limit');assert.deepEqual(await counts(seller),sellerBefore);
});
test('POL-CMD-08 quarantine blocks save before receipts and flag OFF mounts nothing',async()=>{
 const s=await f.openStore(),quarantine=f.application(false,{storePoliciesEnabled:true,commerceSettings:{checkoutEnabled:false,consoleEnabled:false,quarantine:true,providerProfiles:[]}}),key=randomUUID(),before=await counts(s);
 const r=await call(s,'PUT','/seller-policies',input(),'1',key,quarantine);assert.equal(r.status,503);assert.equal(r.data.code,'commerce_quarantined');assert.deepEqual(await counts(s),before);assert.equal((await call(s,'GET','/seller-policies',undefined,undefined,undefined,quarantine)).status,200);await save(s,input(),'1',key);
 const off=f.application(false,{storePoliciesEnabled:false});for(const method of ['GET','PUT'])assert.equal((await call(s,method,'/seller-policies',method==='PUT'?input():undefined,'2',undefined,off)).status,404);assert.equal((await(await off.request(f.h.origin+'/api/v1/site')).json()).store_policies_enabled,false);
});

test('POL-CMD-09 supplier selections make privacy relevant; the checkbox versions only its statement and gates no publication',async()=>{
 const s=await f.openStore(),supplier=await f.openStore();assert.equal((await draft(s)).has_supplied_products,false);
 const offer=f.ok(await f.post(supplier.root+'/products/'+supplier.productId+'/supply-offer',supplier.owner,{},'1'));
 const selection=f.ok(await f.post(s.root+'/distribution-selections',s.owner,{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:1500}),201);
 f.ok(await f.post(supplier.root+'/supply-requests/'+selection.selection_id+'/decision',supplier.owner,{decision:'accepted',listing_sha256:selection.listing_sha256},selection.version));
 const current=await draft(s);assert.equal(current.has_supplied_products,true);assert.deepEqual(current.seller,emptySellerPolicies().seller);
 const saved=await save(s);assert.equal(saved.current.policies.privacy.drop_ship_disclosed,false);f.ok(await call(s,'POST','/publish',{},saved.current.version));
 const before=await counts(s),body=input();body.policies.privacy.drop_ship_disclosed=true;const changed=await save(s,body);assert.equal(changed.current.policies.privacy.drop_ship_disclosed,true);assert.equal((await counts(s)).policies,before.policies+1);assert.equal((await counts(s)).sellers,before.sellers);
});
