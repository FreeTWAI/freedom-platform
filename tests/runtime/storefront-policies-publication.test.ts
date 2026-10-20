import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {emptySellerPolicies,POLICY_KINDS} from '../../contracts/guild-launchpad/v1/storefront-policies.js';
import {PublicStoreProjectionSchema} from '../../contracts/guild-launchpad/v1/storefront.js';
import {createHostedStorePhotoHarness,type HostedStorePhotoHarness} from '../helpers/hosted-store-photo.js';
import {syntheticSeller,legalTables} from '../helpers/storefront-policies.js';
let f:HostedStorePhotoHarness,on:ReturnType<HostedStorePhotoHarness['application']>,off:typeof on;
type Store=Awaited<ReturnType<HostedStorePhotoHarness['openStore']>>;
before(async()=>{f=await createHostedStorePhotoHarness();await f.reset();on=f.application(false,{storePoliciesEnabled:true,storePhotoAssetStore:undefined,storePhotoAssets:undefined});off=f.application(false,{storePoliciesEnabled:false,storePhotoAssetStore:undefined,storePhotoAssets:undefined});});after(async()=>{await f?.stop();});
const call=(s:Store,method:string,suffix:string,body?:unknown,version?:string,key=randomUUID(),app=on)=>f.h.call(method,s.root+suffix,s.owner,body,{'Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})},app);
function input(){const v=emptySellerPolicies();v.seller={...syntheticSeller};for(const k of POLICY_KINDS)v.policies[k].body='合成'+k+'政策\n單一換行\n\n第二段';v.policies.returns.window_days=7;v.policies.privacy.drop_ship_disclosed=true;return v;}
async function save(s:Store,body=input()){const version=f.ok(await call(s,'GET','/seller-policies')).version;return f.ok(await call(s,'PUT','/seller-policies',body,version));}
async function publish(s:Store,app=on){const v=f.ok(await call(s,'GET','',undefined,undefined,undefined,app));return f.ok(await call(s,'POST','/publish',{},v.version,undefined,app));}
const response=(s:Store,path='',app=on)=>app.request(f.h.origin+'/shops/'+s.slug+path);
async function snapshot(r:Response){return {status:r.status,headers:[...r.headers],body:Buffer.from(await r.arrayBuffer())};}
async function html(s:Store,path='',app=on){const r=await response(s,path,app);assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-robots-tag'),'noindex');return r.text();}
async function ids(s:Store){return (await f.h.pool.query("SELECT version_id,kind,version_no FROM commerce_storefront_policy_versions WHERE tenant_id=$1 AND instance_id=$2 ORDER BY version_no DESC,kind",[s.tenantId,s.instanceId])).rows;}
test('POL-PUB-01 saved drafts are private, preview includes seller and publishing freezes the fifth dimension',async()=>{
 const s=await f.openStore();await publish(s,off);const old=await html(s),json=await(await on.request(f.h.origin+'/api/v1/public/stores/'+s.slug)).text();assert.equal((await response(s,'/about')).status,404);
 const saved=await save(s);assert(saved.current.dirty);assert(f.ok(await call(s,'GET','/preview')).dirty);assert.equal(await html(s),old);assert.equal(await(await on.request(f.h.origin+'/api/v1/public/stores/'+s.slug)).text(),json);
 for(const path of ['/preview-page','/preview-page/about','/preview-page/policies/shipping']){const r=await call(s,'GET',path);f.ok(r);const text=await r.response.text();assert.match(text,/合成測試商行/);assert.match(text,/店主已儲存的預覽，尚未對外發布。/);assert.doesNotMatch(text,/property="og:/);}
 await publish(s);assert.match(await html(s),/合成測試商行/);assert.equal(f.ok(await call(s,'GET','/seller-policies')).dirty,false);assert.equal(f.ok(await call(s,'GET','/preview')).dirty,false);
 const after=await(await on.request(f.h.origin+'/api/v1/public/stores/'+s.slug)).json();assert(PublicStoreProjectionSchema.safeParse(after).success);const before=JSON.parse(json);for(const k of ['revision','published_at']){delete before[k];delete after[k];}assert.deepEqual(after,before);
 const newer=input();newer.policies.shipping.body='合成未發布修訂';await save(s,newer);assert.doesNotMatch(await html(s,'/policies/shipping'),/合成未發布修訂/);
});
test('POL-PUB-02 history proves published same-store kind and opaque 404 for foreign, never-published and malformed IDs',async()=>{
 const a=await f.openStore(),b=await f.openStore();await save(a);await publish(a);await save(b);await publish(b);const first=(await ids(a)).find(r=>r.kind==='shipping')!;
 const next=input();next.policies.shipping.body='合成新版配送';await save(a,next);const draftId=(await ids(a)).find(r=>r.kind==='shipping')!.version_id,foreign=(await ids(b)).find(r=>r.kind==='shipping')!.version_id;
 const failures=[];for(const id of [draftId,foreign,randomUUID(),'malformed']){const r=await response(a,'/policies/shipping/v/'+id);failures.push({status:r.status,body:await r.text(),type:r.headers.get('content-type')});}for(const r of failures){assert.equal(r.status,404);assert.deepEqual(r,failures[0]);}
 assert.equal((await response(a,'/policies/returns/v/'+first.version_id)).status,404);
 await publish(a);const current=await html(a,'/policies/shipping'),old=await html(a,'/policies/shipping/v/'+first.version_id);assert.match(current,/目前版本/);assert.match(current,/合成新版配送/);assert.match(old,/歷史版本/);assert.match(old,/合成shipping政策/);assert.match(old,/首次發布於/);assert.doesNotMatch(old,/版本 [0-9]|version_no/);
 const query='?fbclid=synthetic&utm_source=line';
 for(const path of ['/about','/policies/shipping','/policies/shipping/v/'+first.version_id]){
  assert.deepEqual(await snapshot(await response(a,path+query)),await snapshot(await response(a,path)));
 }
 const missing=await snapshot(await response(a,'/policies/invalid'));assert.equal(missing.status,404);
 for(const path of ['/policies/invalid','/policies/shipping/v/'+foreign,'/about/extra','/policies/shipping/extra']){
  assert.deepEqual(await snapshot(await response(a,path)),missing);assert.deepEqual(await snapshot(await response(a,path+query)),missing);
 }
 for(const path of ['/preview-page/about','/preview-page/policies/shipping'])assert.equal((await call(a,'GET',path+query)).response.status,422);
 const unchanged=input();unchanged.policies.shipping.body='合成新版配送';unchanged.policies.terms.body='合成新版條款';await save(a,unchanged);await publish(a);const reused=await html(a,'/policies/shipping');assert.equal(/<time[^>]*>[^<]+<\/time>/.exec(current)?.[0],/<time[^>]*>[^<]+<\/time>/.exec(reused)?.[0]);
});
test('POL-PUB-03 every storefront shell has one responsibility sentence, B03 links and no private source data',async()=>{
 const s=await f.openStore();await save(s);await publish(s);
 for(const path of ['', '/about','/policies/privacy','/products/P0001','/cart','/checkout','/orders/'+randomUUID(),'/order-access']){const text=await html(s,path);assert.equal(text.split('自由工坊提供網站服務，不是賣方。').length-1,1);assert.doesNotMatch(text,/商品資訊與訂單服務由/);assert.match(text,/關於本店/);for(const value of [s.tenantId,s.instanceId,s.owner.user.email,s.productId])assert(!text.includes(value));assert.doesNotMatch(text,/account_number|contact_email|member_email|mailto:|tel:/);}
 for(const path of ['/orders/invalid','/payment-return/'+randomUUID()]){const r=await response(s,path);assert.equal(r.status,404);assert.match(await r.text(),/本店由合成測試商行經營/);}
 assert.match(await html(s,'/policies/returns'),/7 天/);assert.match(await html(s,'/policies/returns'),/14 天/);assert.match(await html(s,'/policies/privacy'),/<p>由供應商直接出貨的商品，本店只會把出貨所需的收件資料提供給負責出貨的供應商。<\/p>/);
 assert.match(await html(s,'/products/P0001'),/aria-label="配送與退換貨政策"/);
 const receipts=(await f.h.pool.query("SELECT to_jsonb(r)::text AS value FROM scoped_command_receipts r WHERE operation='storefront.seller-policies.save'")).rows;for(const r of receipts)assert.doesNotMatch(r.value,/seller@example.test|測試市|合成shipping政策|00000000/);
});
test('POL-PUB-04 concurrent and idempotent publishes freeze once and never append component versions',async()=>{
 const s=await f.openStore();const saved=await save(s),key=randomUUID(),version=saved.current.version;const before=await ids(s);
 const replies=await Promise.all([call(s,'POST','/publish',{},version,key),call(s,'POST','/publish',{},version,key)]);for(const r of replies)f.ok(r);await publish(s);assert.deepEqual(await ids(s),before);
 assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_publication_seller_policies WHERE instance_id=$1',[s.instanceId])).rows[0].n,1);
});
test('POL-PUB-05 removing phone/address republishes withdrawals on all public surfaces including historical policy footers',async()=>{
 const s=await f.openStore();await save(s);await publish(s);const old=(await ids(s)).find(r=>r.kind==='shipping')!.version_id;
 const removed=input();removed.seller.phone='';removed.seller.address='';await save(s,removed);await publish(s);
 for(const path of ['', '/about','/policies/shipping/v/'+old,'/cart','/checkout','/products/P0001','/orders/'+randomUUID()]){const text=await html(s,path);assert.doesNotMatch(text,/測試市範例路|\+886-2-0000-0000/);assert.match(text,/合成測試商行/);}
 await save(s,emptySellerPolicies());await publish(s);const legacy=await html(s);assert.match(legacy,/商品資訊與訂單服務由/);assert.doesNotMatch(legacy,/seller@example.test|本店由合成測試商行/);assert.equal((await response(s,'/policies/shipping')).status,404);assert.equal((await response(s,'/about/v/'+old)).status,404);assert.doesNotMatch(await html(s,'/policies/shipping/v/'+old),/seller@example.test|測試市/);
});
test('POL-PUB-10 flag OFF retains host fallback and legacy HTML, never SELECTs legal tables; old-binary publication shape rolls forward',async()=>{
 const s=await f.openStore();await save(s);await publish(s);const onHtml=await html(s),json=await(await on.request(f.h.origin+'/api/v1/public/stores/'+s.slug)).text();
 const host=f.application(false,{storePoliciesEnabled:false,storePhotoAssetStore:undefined,storePhotoAssets:undefined});host.get('*',c=>c.html('<!doctype html><p>Synthetic SPA shell</p>'));
 await f.h.pool.query(`REVOKE SELECT ON ${legalTables.join(',')} FROM ${f.role}`);
 try{const control=await response(s,'/no-such-page',host),expected={status:control.status,type:control.headers.get('content-type'),body:await control.text()};for(const path of ['/about','/policies/shipping','/policies/shipping/v/'+randomUUID()]){const r=await response(s,path,host);assert.deepEqual({status:r.status,type:r.headers.get('content-type'),body:await r.text()},expected);}
  const text=await html(s,'',off);assert.doesNotMatch(text,/合成測試商行|合成shipping政策|shop-policies.css/);assert.equal(await(await off.request(f.h.origin+'/api/v1/public/stores/'+s.slug)).text(),json);
 }finally{await f.h.pool.query(`GRANT SELECT ON ${legalTables.join(',')} TO ${f.role}`);}
 assert.equal(await html(s),onHtml);const v=f.ok(await call(s,'GET','',undefined,undefined,undefined,off));f.ok(await call(s,'PATCH','',{name:'合成舊版發布'},v.version,undefined,off));await publish(s,off);
 assert.equal((await response(s,'/about')).status,404);assert.doesNotMatch(await html(s),/合成測試商行/);assert(f.ok(await call(s,'GET','/seller-policies')).dirty);await publish(s);assert.match(await html(s),/合成測試商行/);
 const installed=f.application(false,{storePoliciesEnabled:true});installed.get('*',c=>c.html('Synthetic SPA'));for(const path of ['/about/extra','/policies','/policies/shipping/extra','/policies/shipping/v/'+randomUUID()+'/extra']){const r=await response(s,path,installed);assert.equal(r.status,404);assert.equal(await r.text(),'404 Not Found');}
});
test('POL-PUB-11 empty seller/policies publish successfully; current liveness also protects historical policies',async()=>{
 const s=await f.openStore();await publish(s);assert.match(await html(s),/商品資訊與訂單服務由/);assert.equal((await response(s,'/policies/shipping')).status,404);assert.match(await html(s,'/about'),/店主尚未發布賣方資訊。/);
 await save(s);await publish(s);const id=(await ids(s)).find(r=>r.kind==='shipping')!.version_id,version=f.ok(await call(s,'GET','')).version;f.ok(await call(s,'POST','/unpublish',{},version));for(const path of ['/about','/policies/shipping','/policies/shipping/v/'+id])assert.equal((await response(s,path)).status,404);
});
