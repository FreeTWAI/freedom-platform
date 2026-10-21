import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,beforeEach,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {StorefrontAppearanceDraftSchema,AppearanceCommandAckSchema} from '../../contracts/guild-launchpad/v1/storefront-appearance.js';
import {PublicStoreProjectionSchema} from '../../contracts/guild-launchpad/v1/storefront.js';
import {createHostedStorePhotoHarness,type HostedStorePhotoHarness} from '../helpers/hosted-store-photo.js';

let f:HostedStorePhotoHarness;
before(async()=>{f=await createHostedStorePhotoHarness();});after(async()=>{await f?.stop();});beforeEach(async()=>{await f.reset();});
type Store=Awaited<ReturnType<HostedStorePhotoHarness['openStore']>>;
function application(enabled=true,quarantine=false){return f.application(false,{storeAppearanceEnabled:enabled,
  storePhotoAssetStore:undefined,storePhotoAssets:undefined,commerceSettings:{checkoutEnabled:false,consoleEnabled:false,quarantine,providerProfiles:[]}});}
function call(s:Store,method:string,suffix:string,body?:unknown,version?:string,key=randomUUID(),app=application(),member=s.owner){
  return f.h.call(method,s.root+suffix,member,body,{'Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})},app);
}
const input=(s:Store,extra:Record<string,unknown>={})=>({template_id:'catalog-grid-v1',accent_preset:'ocean',announcement:'合成品牌公告',featured_product_ids:[s.productId],...extra});
async function draft(s:Store,app=application()){const r=await call(s,'GET','/appearance-settings',undefined,undefined,undefined,app);f.ok(r);assert.equal(r.response.headers.get('Cache-Control'),'private, no-store');return StorefrontAppearanceDraftSchema.parse(r.data);}
async function save(s:Store,body=input(s),version?:string,key=randomUUID(),app=application()){
  version??=(await draft(s,app)).version;const r=await call(s,'PATCH','/appearance-settings',body,version,key,app);f.ok(r);return AppearanceCommandAckSchema.parse(r.data);
}
async function publish(s:Store,app=application()){
  const version=f.ok(await call(s,'GET','',undefined,undefined,undefined,app)).version;
  return f.ok(await call(s,'POST','/publish',{},version,undefined,app));
}
async function page(s:Store,path='',app=application()){
  const response=await app.request(f.h.origin+'/shops/'+s.slug+path);assert.equal(response.status,200);return response.text();
}

test('APPEARANCE-01 flag defaults OFF, mounts no settings and leaves old template controls usable',async()=>{
  const s=await f.openStore(),off=application(false);
  for(const method of ['GET','PATCH'])assert.equal((await call(s,method,'/appearance-settings',method==='PATCH'?input(s):undefined,'1',undefined,off)).status,404);
  const site=await off.request(f.h.origin+'/api/v1/site');assert.equal((await site.json() as any).store_appearance_enabled,false);
  f.ok(await call(s,'PATCH','/appearance',{template_id:'catalog-list-v1'},'1',undefined,off));
  assert.equal(f.ok(await call(s,'GET','/appearance',undefined,undefined,undefined,off)).template_id,'catalog-list-v1');
});

test('APPEARANCE-02 non-media settings work without media, expose own names and match the product limit',async()=>{
  const s=await f.openStore(),first=await draft(s);
  assert.equal(first.media_installed,false);assert.equal(first.uploads_enabled,false);assert.equal(first.cover,null);assert.equal(first.logo,null);
  assert.deepEqual(first.eligible_products,[{product_id:s.productId,sku:'P0001',title:'合成商品'}]);assert.equal(first.has_supplied_products,false);
  const store=f.ok(await call(s,'GET',''));
  assert.equal(StorefrontAppearanceDraftSchema.safeParse({...first,eligible_products:Array.from({length:store.product_limit+1},(_,i)=>({...first.eligible_products[0],product_id:randomUUID(),sku:'P'+String(i+1).padStart(4,'0')}))}).success,false);
  assert.equal(store.product_limit,200);
  const saved=await save(s);assert.equal(saved.changed,true);assert.equal(saved.completed_version,'2');assert.equal(saved.current.dirty,true);
  assert.deepEqual(saved.current.featured_products,[{product_id:s.productId,title:'合成商品',state:'available'}]);
  const site=await application().request(f.h.origin+'/api/v1/site');assert.equal((await site.json() as any).store_appearance_enabled,true);
});

test('APPEARANCE-03 saved draft previews immediately, publication freezes branding and adds the fourth dirty dimension',async()=>{
  const s=await f.openStore();await publish(s);
  const old=await page(s),jsonBefore=await(await application().request(f.h.origin+'/api/v1/public/stores/'+s.slug)).text();
  assert.doesNotMatch(old,/合成品牌公告|shop-featured/);
  const saved=await save(s);assert.equal(saved.current.dirty,true);
  assert.equal(f.ok(await call(s,'GET','/preview')).dirty,true);
  const preview=await call(s,'GET','/preview-page');f.ok(preview);const html=await preview.response.text();
  assert.match(html,/data-shop-accent="ocean"/);assert.match(html,/合成品牌公告/);assert.match(html,/主打商品/);assert.doesNotMatch(html,/shop-cover|property="og:/);
  assert.equal(await page(s),old);
  await publish(s);const published=await page(s);assert.match(published,/合成品牌公告/);assert.match(published,/data-shop-accent="ocean"/);
  assert.equal((await draft(s)).dirty,false);assert.equal(f.ok(await call(s,'GET','/preview')).dirty,false);
  const jsonAfter=await(await application().request(f.h.origin+'/api/v1/public/stores/'+s.slug)).json();
  assert.ok(PublicStoreProjectionSchema.safeParse(jsonAfter).success);
  const before=JSON.parse(jsonBefore);for(const field of ['revision','published_at'])delete before[field];
  for(const field of ['revision','published_at'])delete jsonAfter[field];assert.deepEqual(jsonAfter,before);
  const count=(await f.h.pool.query('SELECT count(*)::int n FROM commerce_storefront_publications WHERE instance_id=$1',[s.instanceId])).rows[0].n;
  await publish(s);assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_storefront_publications WHERE instance_id=$1',[s.instanceId])).rows[0].n,count,'identical branding deduplicates publish');
  await save(s,input(s,{announcement:'下一版的草稿'}));assert.equal(await page(s),published);
});

test('APPEARANCE-04 idempotent replay returns original completion with current draft; stale CAS and changed key body do not write',async()=>{
  const s=await f.openStore(),key=randomUUID();const saved=await save(s,input(s),'1',key);
  const next=await save(s,input(s,{announcement:'更新公告'}),saved.current.version);
  const replay=await save(s,input(s),'1',key);assert.equal(replay.completed_version,'2');assert.equal(replay.current.version,next.current.version);assert.equal(replay.current.announcement,'更新公告');
  for(const [body,version,k,expected] of [[input(s),'1',randomUUID(),412],[input(s,{announcement:'不同內容'}),'1',key,409]] as const){
    const r=await call(s,'PATCH','/appearance-settings',body,version,k);assert.equal(r.status,expected);
  }
  assert.equal((await draft(s)).version,next.current.version);
});

test('APPEARANCE-05 metadata rejects foreign, disabled, supplied and duplicate products; stale own selections never reveal other names',async()=>{
  const s=await f.openStore(),other=await f.openStore();
  for(const ids of [[other.productId],[s.productId,s.productId],Array.from({length:9},()=>randomUUID())]){
    const r=await call(s,'PATCH','/appearance-settings',input(s,{featured_product_ids:ids}),'1');assert.equal(r.status,422);
    assert.doesNotMatch(JSON.stringify(r.data),new RegExp(other.productId));
  }
  await save(s);
  await f.h.pool.query('UPDATE commerce_selections SET own_retail_enabled=false WHERE item_id=$1',[s.productId]);
  const stale=await draft(s);assert.deepEqual(stale.featured_products,[{product_id:s.productId,title:null,state:'not_in_catalog'}]);assert.deepEqual(stale.eligible_products,[]);
  const retained=await save(s,input(s,{announcement:'保留設定'}));assert.equal(retained.current.featured_product_ids[0],s.productId);
  await f.h.pool.query('UPDATE commerce_selections SET own_retail_enabled=true WHERE item_id=$1',[s.productId]);
  await publish(s);const first=await page(s);assert.match(first,/主打商品/);
  const product=f.ok(await f.call('GET',s.root+'/products',s.owner)).items.find((p:any)=>p.product_id===s.productId);
  f.ok(await f.post(s.root+'/products/'+s.productId+'/remove',s.owner,{},product.version));
  assert.equal(await page(s),first,'deleted draft product remains in published catalog and featured snapshot');
  const read=await draft(s);assert.equal(read.featured_products[0].title,null);
});

test('APPEARANCE-06 store:read and store:write-only members cannot edit or replay manage settings',async()=>{
  const s=await f.openStore();
  for(const keys of [['store:read'],['store:read','store:write']]){
    const person=(await f.h.person('合成外觀權限會員')).session;
    const principal=f.ok(await f.call('GET',`/tenants/invite-candidates?user_id=${person.user.user_id}`,s.owner)).principal_id;
    const invitation=f.ok(await f.post(`/tenants/${s.tenantId}/invitations`,s.owner,{invitee_principal_id:principal,role:'operator',instance_capabilities:[{instance_id:s.instanceId,capabilities:keys}],expires_at:new Date(Date.now()+86400000).toISOString()}),201);
    f.ok(await f.post(`/tenants/${s.tenantId}/invitations/${invitation.invitation_id}/accept`,person,{},invitation.version));
    assert.equal((await call(s,'GET','/appearance-settings',undefined,undefined,undefined,undefined,person)).status,200);
    assert.equal((await call(s,'PATCH','/appearance-settings',input(s),'1',undefined,undefined,person)).status,403);
  }
  assert.equal((await draft(s)).version,'1');
});

test('APPEARANCE-07 quarantine refuses combined settings before receipts or profile changes',async()=>{
  const s=await f.openStore(),key=randomUUID(),app=application(true,true);
  const before=(await f.h.pool.query('SELECT count(*)::int n FROM scoped_command_receipts')).rows[0].n;
  const r=await call(s,'PATCH','/appearance-settings',input(s),'1',key,app);assert.equal(r.status,503);assert.equal(r.data.code,'commerce_quarantined');
  assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM scoped_command_receipts')).rows[0].n,before);
  assert.equal((await draft(s)).version,'1');await save(s,input(s),'1',key);
});

test('APPEARANCE-08 flag OFF ignores frozen branding and retains drafts through an old-style publication',async()=>{
  const s=await f.openStore(),off=application(false);await save(s);await publish(s);
  const branded=await page(s);assert.match(branded,/合成品牌公告/);
  const legacy=await page(s,'',off);assert.doesNotMatch(legacy,/合成品牌公告|data-shop-accent|shop-featured|shop-cover/);
  assert.equal(await page(s),branded,'turning off does not destroy the frozen sidecar');
  const current=f.ok(await call(s,'GET','',undefined,undefined,undefined,off));
  f.ok(await call(s,'PATCH','',{name:'合成舊版發布'},current.version,undefined,off));await publish(s,off);
  assert.equal((await f.h.pool.query(`SELECT count(*)::int n FROM commerce_publication_appearances a JOIN commerce_storefront_profiles p ON p.current_publication_id=a.publication_id WHERE p.instance_id=$1`,[s.instanceId])).rows[0].n,0);
  assert.doesNotMatch(await page(s),/合成品牌公告|shop-featured/);assert.equal((await draft(s)).announcement,'合成品牌公告');assert.equal((await draft(s)).dirty,true);
  await publish(s);assert.match(await page(s),/合成品牌公告/);
});

test('APPEARANCE-09 every buyer shell shares the frozen accent and contains no private appearance configuration',async()=>{
  const s=await f.openStore();await save(s);await publish(s);
  for(const path of ['', '/products/P0001','/cart','/checkout','/orders/'+randomUUID(),'/order-access','/payment-return/'+randomUUID()]){
    const response=await application().request(f.h.origin+'/shops/'+s.slug+path);assert.ok([200,404].includes(response.status));const html=await response.text();
    assert.match(html,/data-shop-accent="ocean"/);assert.match(html,/合成品牌公告/);
    for(const privateValue of [s.tenantId,s.instanceId,s.productId,s.owner.user.email])assert.ok(!html.includes(privateValue));
    assert.doesNotMatch(html,/featured_product_ids|scope_id|policy_revision|account_number|contact_email/);
  }
});

test('APPEARANCE-10 supplied products show the picker hint but cannot enter eligible or featured own products',async()=>{
  const seller=await f.openStore(),supplier=await f.openStore();
  const offer=f.ok(await f.post(supplier.root+'/products/'+supplier.productId+'/supply-offer',supplier.owner,{},'1'));
  const selection=f.ok(await f.post(seller.root+'/distribution-selections',seller.owner,{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:1500}),201);
  f.ok(await f.post(supplier.root+'/supply-requests/'+selection.selection_id+'/decision',supplier.owner,{decision:'accepted',listing_sha256:selection.listing_sha256},selection.version));
  const view=await draft(seller);assert.equal(view.has_supplied_products,true);assert.deepEqual(view.eligible_products.map(p=>p.product_id),[seller.productId]);
  const refused=await call(seller,'PATCH','/appearance-settings',input(seller,{featured_product_ids:[supplier.productId]}),view.version);assert.equal(refused.status,422);
  await save(seller,input(seller),view.version);await publish(seller);
  const html=await page(seller);assert.match(html,/主打商品/);
  const doc=(await f.h.pool.query('SELECT a.document FROM commerce_publication_appearances a JOIN commerce_storefront_profiles p ON p.current_publication_id=a.publication_id WHERE p.instance_id=$1',[seller.instanceId])).rows[0].document;
  assert.deepEqual(doc.featured_skus,['P0001']);assert.deepEqual(doc.featured_product_ids,[seller.productId]);
});

test('APPEARANCE-11 a draft read waiting on a profile writer returns one coherent version and metadata',async()=>{
  const s=await f.openStore(),q=await f.h.pool.connect();let pending:ReturnType<typeof draft>|undefined;
  try{
    await q.query('BEGIN');await q.query('UPDATE commerce_storefront_profiles SET version=version+1 WHERE instance_id=$1',[s.instanceId]);
    await q.query("INSERT INTO commerce_storefront_appearance_drafts(tenant_id,instance_id,announcement) VALUES($1,$2,'同一版本的合成公告')",[s.tenantId,s.instanceId]);
    const pid=(await q.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    pending=draft(s);let blocked=false;
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      blocked=(await f.h.pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) blocked',[pid])).rows[0].blocked;
      if(blocked)break;
      await delay(20);
    }
    assert.equal(blocked,true,'observe the actual shared profile lock wait');
    await q.query('COMMIT');const view=await pending;assert.equal(view.version,'2');assert.equal(view.announcement,'同一版本的合成公告');
  }finally{await q.query('ROLLBACK');q.release();if(pending)await pending.catch(()=>undefined);}
});

test('APPEARANCE-13 announcement saves trim outer spaces, count Unicode code points after trimming and publish no empty bar',async()=>{
  const s=await f.openStore();
  for(const announcement of ['\ud800','\udc00']){
    const result=await call(s,'PATCH','/appearance-settings',input(s,{announcement}),'1');
    assert.equal(result.status,422);
  }
  assert.equal((await draft(s)).version,'1');
  for(const [raw,expected] of [['　 合成公告  ','合成公告'],['　　 ',''],['  '+'𠮷'.repeat(80)+'　','𠮷'.repeat(80)]] as const){
    const saved=await save(s,input(s,{announcement:raw}));assert.equal(saved.current.announcement,expected);
    const stored=(await f.h.pool.query('SELECT announcement FROM commerce_storefront_appearance_drafts WHERE instance_id=$1',[s.instanceId])).rows[0];
    assert.equal(stored.announcement,expected);
    await publish(s);const html=await page(s);
    if(expected)assert.ok(html.includes(`<p>${expected}</p>`));else assert.doesNotMatch(html,/class="shop-announcement"/);
  }
  const current=await draft(s);
  assert.equal((await call(s,'PATCH','/appearance-settings',input(s,{announcement:' '+'𠮷'.repeat(81)+' '}),current.version)).status,422);
  assert.equal((await draft(s)).version,current.version);
});

test('APPEARANCE-12 invalid controls and command headers return fixed zh-TW refusals without changes',async()=>{
  const s=await f.openStore();
  for(const [extra,code,detail] of [
    [{announcement:'合'.repeat(81)},'appearance_announcement_invalid','公告請使用單行純文字，最多 80 字。'],
    [{announcement:'兩行\n公告'},'appearance_announcement_invalid','公告請使用單行純文字，最多 80 字。'],
    [{featured_product_ids:[s.productId,s.productId]},'appearance_featured_invalid','主打商品最多 8 項，請選擇這間商店的商品且不要重複。'],
    [{accent_preset:'caller-css'},'validation_failed','外觀設定格式無效，請檢查主色、公告與主打商品。'],
    [{bank_account:'synthetic'},'validation_failed','外觀設定格式無效，請檢查主色、公告與主打商品。'],
  ] as const){const r=await call(s,'PATCH','/appearance-settings',input(s,extra),'1');assert.equal(r.status,422);assert.equal(r.data.code,code);assert.equal(r.data.detail,detail);}
  const app=application();
  const headerCases:Record<string,string>[]=[{},{'Idempotency-Key':randomUUID()},{'Idempotency-Key':randomUUID(),'If-Match':'1'}];
  for(const headers of headerCases){
    const r=await f.h.call('PATCH',s.root+'/appearance-settings',s.owner,input(s),headers,app);assert.ok([400,428].includes(r.status));
  }
  assert.equal((await draft(s)).version,'1');assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_storefront_appearance_drafts')).rows[0].n,0);
});
