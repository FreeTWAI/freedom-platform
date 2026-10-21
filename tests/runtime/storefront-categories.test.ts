import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {createHostedStorePhotoHarness,type HostedStorePhotoHarness} from '../helpers/hosted-store-photo.js';
import {DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {CategoryPageSchema,PublicationCategoriesDocumentSchema} from '../../contracts/guild-launchpad/v1/storefront-categories.js';
import {ProductGroupPageSchema,type ProductGroupDraft} from '../../contracts/guild-launchpad/v1/storefront-variants.js';
import {categoryCommand} from '../../modules/agent-commerce/storefront/categories/commands.js';
import {categoriesSnapshot} from '../../modules/agent-commerce/storefront/categories/model.js';
let f:HostedStorePhotoHarness,s:Awaited<ReturnType<HostedStorePhotoHarness['openStore']>>,foreign:typeof s,app:ReturnType<HostedStorePhotoHarness['application']>,off:typeof app,skuOnly:typeof app;
const base={registrationCommunityId:DEMO_COMMUNITY};
before(async()=>{
 f=await createHostedStorePhotoHarness();await f.reset();s=await f.openStore();foreign=await f.openStore();
 const grants=await readFile(new URL('../../deploy/cloudflare/sql/20-runtime-grants.psql',import.meta.url),'utf8');
 for(const section of ['GALLERY','VARIANTS','CATEGORIES']){const sql=grants.split(`-- BEGIN STOREFRONT ${section} GRANTS\n`)[1].split('\n\\gexec')[0].replaceAll(":'runtime'",`'${f.role}'`).replaceAll("n.nspname='public'",`n.nspname='${f.h.schema}'`);for(const row of (await f.h.pool.query(sql)).rows)await f.h.pool.query(Object.values(row)[0] as string);}
 app=f.application(false,{...base,storeCategoriesEnabled:true,storeVariantsEnabled:true,storeAppearanceEnabled:true});
 off=f.application(false,base);skuOnly=f.application(false,{...base,storeCategoriesEnabled:true,storeAppearanceEnabled:true});
});
after(async()=>{await f?.stop();});
const call=(method:string,suffix:string,body?:unknown,version?:string,key=randomUUID(),target=app,member=s.owner,store=s)=>f.h.call(method,store.root+suffix,member,body,{'Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})},target);
const page=async(target=app)=>CategoryPageSchema.parse(f.ok(await call('GET','/categories',undefined,undefined,undefined,target)));
const mutate=async(method:string,suffix:string,body:unknown,target=app)=>f.ok(await call(method,'/categories'+suffix,body,(await page(target)).version,undefined,target),method==='POST'&&suffix===''?201:200);
const publish=async(target=app)=>{const view=f.ok(await call('GET','',undefined,undefined,undefined,target));return f.ok(await call('POST','/publish',{},view.version,undefined,target));};
const groups=async()=>ProductGroupPageSchema.parse(f.ok(await call('GET','/product-groups')));
const groupBody=(g:ProductGroupDraft)=>({title:g.title,description:g.description,axes:g.axes,default_product_id:g.default_product_id,order:g.order,members:g.members.map(m=>({product_id:m.product.product_id,product_version:m.product.version,value_keys:m.value_keys}))});
const publicPage=(query='',target=app)=>target.request(f.h.origin+'/shops/'+s.slug+query);
let first:string,second:string,detached:string,extra:any;
test('CATEGORIES-01 normalized names, profile CAS, metadata-only replay, no-op and old-publication fallback',async()=>{
 await publish(off);assert.doesNotMatch(await(await publicPage()).text(),/aria-label="商品分類"/);
 assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_storefront_categories')).rows[0].n,0);
 const p=await page(),key=randomUUID();const made=f.ok(await call('POST','/categories',{name:'  Cafe\u0301  '},p.version,key),201);first=made.category_id;assert.equal(made.current.items[0].name,'Café');assert.equal(made.current.version,String(BigInt(p.version)+1n));
 assert.equal(f.ok(await call('POST','/categories',{name:'Café'},p.version,key),201).category_id,first);
 assert.equal((await call('POST','/categories',{name:'其他'},p.version,key)).data.code,'idempotency_conflict');
 assert.equal((await call('PATCH','/categories/'+first,{name:'新名'},p.version)).status,412);
 assert.equal((await call('POST','/categories',{name:'Café'},made.current.version)).data.code,'category_name_taken');
 for(const name of ['', '名'.repeat(41),'錯\n誤','錯\u202e誤','\ud800'])assert.equal((await call('POST','/categories',{name},made.current.version)).status,422);
 assert.equal((await call('POST','/categories',{name:'合法',unknown:true},made.current.version)).data.code,'validation_failed');
 const noop=await mutate('PATCH','/'+first,{name:'Café'});assert.equal(noop.changed,false);assert.equal(noop.current.version,made.current.version);
 second=(await mutate('POST','',{name:'其他商品'})).category_id;detached=(await mutate('POST','',{name:'拆出的商品'})).category_id;
 extra=f.ok(await call('POST','/products',{title:'原本第二商品',description:'原本介紹',price_minor:2000,stock:2}),201);
 await mutate('PUT','/'+first+'/groups',{group_keys:['P0002','P0001']});await mutate('PUT','/'+second+'/groups',{group_keys:['P0001']});
 for(const group_keys of [Array.from({length:201},(_,n)=>'P'+String(n+1).padStart(4,'0')),['malformed'],['P0001','P0001']]){
  const response=await call('PUT','/categories/'+first+'/groups',{group_keys},(await page()).version);
  assert.equal(response.status,422);assert.equal(response.data.code,'category_groups_invalid');assert.equal(response.data.detail,'請選擇這間商店的商品組，最多 200 組且不要重複。');
 }
 for(const body of [null,[],{}, {group_keys:'P0001'}])assert.equal((await call('PUT','/categories/'+first+'/groups',body,(await page()).version)).data.code,'validation_failed');
 assert.equal((await call('PUT','/categories/'+first+'/groups',{group_keys:['P9999']},(await page()).version)).data.code,'category_groups_changed');
 assert.equal((await call('POST','/categories/reorder',{category_ids:[first]},(await page()).version)).data.code,'category_order_invalid');
 await mutate('POST','/reorder',{category_ids:[second,first,detached]});assert.deepEqual((await page()).items.map(c=>c.category_id),[second,first,detached]);
 await publish();assert.equal(f.ok(await call('GET','/preview')).dirty,false);const revision=f.ok(await call('GET','')).publication.current_revision;await publish();assert.equal(f.ok(await call('GET','')).publication.current_revision,revision);
 const frozen=(await f.h.pool.query('SELECT document FROM commerce_publication_categories WHERE tenant_id=$1 ORDER BY publication_id',[s.tenantId])).rows[0].document;
 assert.equal(frozen.categories.length,2);assert.deepEqual(frozen.categories.find((c:any)=>c.category_id===first).groups.map((g:any)=>g.skus),[['P0002'],['P0001']]);
 await mutate('PATCH','/'+first,{name:'草稿名稱'});assert.equal(f.ok(await call('GET','/preview')).dirty,true);const visible=await(await publicPage('?category='+first)).text();assert.match(visible,/Café/);assert.doesNotMatch(visible,/草稿名稱/);const upper=await publicPage('?category='+first.toUpperCase());assert.equal(upper.status,200,'uppercase category UUID selects the same publication');assert.equal(await upper.text(),visible);
 const preview=await call('GET','/preview-page?category='+first);assert.equal(preview.status,200);assert.match(await preview.response.text(),/草稿名稱/);
 for(const query of ['?category=bad','?category=','?category='+first+'&category='+first]){const r=await publicPage(query);assert.equal(r.status,400);assert.match(await r.text(),/分類連結格式無效，請查看全部商品。/);}
 for(const id of [detached,randomUUID()]){const r=await publicPage('?category='+id);assert.equal(r.status,404);assert.match(await r.text(),/這個分類目前沒有公開。/);}
 assert.equal((await call('GET','/preview-page?category=bad')).status,400);
});
test('CATEGORIES-02 anchor split/rejoin/deletion, exact modes and frozen coverage survive flag changes',async()=>{
 let g=(await groups()).items.find(g=>g.group_key==='P0001')!;const axis={key:randomUUID(),name:'款式',values:[{key:randomUUID(),name:'甲'},{key:randomUUID(),name:'乙'}]};
 f.ok(await call('PUT','/product-groups/P0001',{...groupBody(g),title:'保留群組',axes:[axis],members:[{product_id:s.productId,product_version:g.members[0].product.version,value_keys:[axis.values[0].key]},{product_id:extra.product_id,product_version:extra.version,value_keys:[axis.values[1].key]}]},g.version));
 g=(await groups()).items.find(g=>g.group_key==='P0001')!;
 f.ok(await call('PUT','/product-groups/P0001',{...groupBody(g),members:groupBody(g).members.filter(m=>m.product_id!==s.productId),default_product_id:extra.product_id},g.version));
 assert.deepEqual((await page()).catalog.map(g=>g.group_key).sort(),['P0001','P0001~single']);
 await mutate('PUT','/'+first+'/groups',{group_keys:['P0001']});await mutate('PUT','/'+detached+'/groups',{group_keys:['P0001~single']});
 assert.deepEqual((await page()).items.find(c=>c.category_id===detached)!.group_keys,['P0001~single']);
 const single=await page(skuOnly);assert.deepEqual(single.items.find(c=>c.category_id===first)!.group_keys,['P0001']);assert.deepEqual(single.items.find(c=>c.category_id===detached)!.inactive_group_keys,['P0001~single']);assert.deepEqual(single.catalog.find(g=>g.group_key==='P0001')!.skus,['P0001']);
 await f.h.pool.query(`REVOKE SELECT ON commerce_product_groups,commerce_product_group_members,commerce_publication_variants FROM ${f.role}`);
 try{const offPage=await page(skuOnly);assert.deepEqual(offPage.catalog.map(g=>g.group_key).sort(),['P0001','P0002']);const preview=await call('GET','/preview-page?category='+first,undefined,undefined,undefined,skuOnly);assert.equal(preview.status,200);await publish(skuOnly);const published=await publicPage('?category='+first,skuOnly);assert.equal(published.status,200);assert.match(await published.text(),/合成商品/);assert.equal((await publicPage('?category='+detached,skuOnly)).status,404);}finally{await f.h.pool.query(`GRANT SELECT ON commerce_product_groups,commerce_product_group_members,commerce_publication_variants TO ${f.role}`);}
 await publish();const frozen=await(await publicPage('?category='+first)).text();assert.match(frozen,/保留群組/);assert.doesNotMatch(frozen,/原本第二商品/);
 const switched=await(await publicPage('?category='+first,skuOnly)).text();assert.match(switched,/原本第二商品/);assert.doesNotMatch(switched,/<h3>.*合成商品/);assert.equal((await publicPage('?category='+detached,skuOnly)).status,200,'covered SKU remains published despite a flag change');
 const anchor=(await groups()).items.find(g=>g.group_key==='P0001~single')!.members[0];g=(await groups()).items.find(g=>g.group_key==='P0001')!;
 f.ok(await call('PUT','/product-groups/P0001',{...groupBody(g),members:[{product_id:anchor.product.product_id,product_version:anchor.product.version,value_keys:[axis.values[0].key]},...groupBody(g).members]},g.version));
 const rejoined=await page();assert.deepEqual(rejoined.items.find(c=>c.category_id===detached)!.inactive_group_keys,['P0001~single']);assert.deepEqual(rejoined.items.find(c=>c.category_id===first)!.group_keys,['P0001']);
 assert.equal((await publicPage('?category='+detached)).status,200,'draft changes stay private');await publish();assert.equal((await publicPage('?category='+detached)).status,404);
 const raw=(await f.h.pool.query('SELECT * FROM commerce_storefront_category_members WHERE category_id=$1',[detached])).rows[0];assert.equal(raw.group_key,'P0001~single');assert.equal(raw.removed_at,null,'semantic inactivity does not write during GET');
 f.ok(await call('POST','/products/'+s.productId+'/remove',{},anchor.product.version));assert.deepEqual((await page()).catalog.find(g=>g.group_key==='P0001')!.skus,['P0002']);await publish();assert.equal((await publicPage('?category='+first)).status,200);
 assert.equal((await page(skuOnly)).items.find(c=>c.category_id===first)!.inactive_group_keys[0],'P0001');
 const a=f.ok(await call('GET','/appearance-settings'));f.ok(await call('PATCH','/appearance-settings',{template_id:a.template_id,accent_preset:a.accent_preset,announcement:a.announcement,featured_product_ids:[extra.product_id]},a.version));await publish();
 assert.match(await(await publicPage()).text(),/id="featured-products"/);const selected=await(await publicPage('?category='+first)).text();assert.doesNotMatch(selected,/id="featured-products"/);assert.equal((selected.match(/<li><article>/g)||[]).length,1);assert.doesNotMatch(selected,/~single/);
});
test('CATEGORIES-03 supplied singleton, category removal isolation, strict SQL/frozen corruption and limits',async()=>{
 const offer=f.ok(await f.h.call('POST',foreign.root+'/products/'+foreign.productId+'/supply-offer',foreign.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':'"1"'},app));const proposal=f.ok(await call('POST','/distribution-selections',{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:1500}),201);
 f.ok(await f.h.call('POST',foreign.root+'/supply-requests/'+proposal.selection_id+'/decision',foreign.owner,{decision:'accepted',listing_sha256:proposal.listing_sha256},{'Idempotency-Key':randomUUID(),'If-Match':`"${proposal.version}"`},app));
 const supply=(await page()).catalog.find(g=>!['P0001','P0002'].includes(g.group_key))!;assert.ok(supply);await mutate('PUT','/'+second+'/groups',{group_keys:[supply.group_key,'P0001']});await publish();assert.match(await(await publicPage('?category='+second)).text(),/合成商品/);
 await mutate('POST','/'+second+'/remove',{});assert.equal((await publicPage('?category='+second)).status,200);await publish();assert.equal((await publicPage('?category='+second)).status,404);assert.equal((await call('GET','/products')).data.items.length,1);
 const rows=(await f.h.pool.query('SELECT * FROM commerce_storefront_categories WHERE category_id=$1',[second])).rows;assert.ok(rows[0].removed_at);assert.equal(rows[0].sort_order,null);
 await assert.rejects(f.h.pool.query('UPDATE commerce_storefront_categories SET tenant_id=$1,version=version+1 WHERE category_id=$2',[foreign.tenantId,first]),{code:'23514'});
 await assert.rejects(f.h.pool.query('DELETE FROM commerce_storefront_category_members WHERE category_id=$1',[first]),{code:'23514'});
 const frozen=(await f.h.pool.query('SELECT * FROM commerce_publication_categories WHERE tenant_id=$1 LIMIT 1',[s.tenantId])).rows[0];await assert.rejects(f.h.pool.query('UPDATE commerce_publication_categories SET categories_sha256=$1 WHERE publication_id=$2',['a'.repeat(64),frozen.publication_id]),{code:'23514'});
 const invalid={profile:'freedom.hosted-store-categories/v1',categories:[{category_id:randomUUID(),name:'合法',order:1,groups:[{group_key:'P0001',order:0,skus:['P9999']}]}]};assert.equal(PublicationCategoriesDocumentSchema.safeParse(invalid).success,true);assert.throws(()=>categoriesSnapshot(invalid,['P0002']),{code:'storefront_categories_invalid'});
 const shape={profile:'freedom.hosted-store-categories/v1',categories:[{category_id:randomUUID(),name:'合法',order:1,groups:[{group_key:'P0001~single',order:0,skus:['P0002']}]}]};
 for(const bad of [{...shape,unknown:true},{...shape,categories:[{...shape.categories[0],name:'錯\n誤'}]},{...shape,categories:[{...shape.categories[0],order:1.5}]},{...shape,categories:[{...shape.categories[0],groups:[shape.categories[0].groups[0],shape.categories[0].groups[0]]}]}])assert.equal((await f.h.pool.query('SELECT storefront_categories_document_valid($1) valid',[bad])).rows[0].valid,false);
 const transaction=await f.h.pool.connect();try{await transaction.query('BEGIN');const id=randomUUID();await transaction.query(`INSERT INTO commerce_storefront_publications(publication_id,tenant_id,instance_id,revision,slug,projection,projection_sha256,published_by_principal_id,published_at,template_id,media_sha256)
  SELECT $1,p.tenant_id,p.instance_id,(SELECT max(revision)+1 FROM commerce_storefront_publications WHERE instance_id=p.instance_id),p.slug,jsonb_set(p.projection,'{revision}',to_jsonb(((SELECT max(revision)+1 FROM commerce_storefront_publications WHERE instance_id=p.instance_id))::text)),p.projection_sha256,p.published_by_principal_id,p.published_at,p.template_id,p.media_sha256 FROM commerce_storefront_publications p JOIN commerce_storefront_profiles f ON f.current_publication_id=p.publication_id WHERE f.instance_id=$2`,[id,s.instanceId]);await transaction.query('INSERT INTO commerce_publication_categories(publication_id,tenant_id,instance_id,document,categories_sha256) VALUES($1,$2,$3,$4,$5)',[id,s.tenantId,s.instanceId,invalid,'a'.repeat(64)]);await assert.rejects(transaction.query('SET CONSTRAINTS ALL IMMEDIATE'),{code:'23514'});}finally{await transaction.query('ROLLBACK');transaction.release();}
 const q=await f.h.pool.connect();try{await q.query('BEGIN');const p=(await q.query('SELECT scope_id FROM resource_scopes WHERE tenant_ref=$1',[foreign.tenantId])).rows[0];for(let n=1;n<=30;n++)await q.query('INSERT INTO commerce_storefront_categories(category_id,tenant_id,instance_id,scope_id,name,name_key,sort_order) VALUES($1,$2,$3,$4,$5,$5,$6)',[randomUUID(),foreign.tenantId,foreign.instanceId,p.scope_id,'分類'+n,n]);await q.query('COMMIT');}finally{q.release();}
 const full=f.ok(await call('GET','/categories',undefined,undefined,undefined,app,foreign.owner,foreign));assert.equal(full.items.length,30);assert.equal((await call('POST','/categories',{name:'第三十一'},full.version,undefined,app,foreign.owner,foreign)).data.code,'category_limit');
 await assert.rejects(f.h.pool.query('INSERT INTO commerce_storefront_categories(category_id,tenant_id,instance_id,scope_id,name,name_key,sort_order) SELECT $1,tenant_id,instance_id,scope_id,$2,$2,30 FROM commerce_storefront_categories WHERE tenant_id=$3 LIMIT 1',[randomUUID(),'超額',foreign.tenantId]),{code:'23514'});
});
test('CATEGORIES-04 every command enforces read/write grants, target opacity and replay reauthorization',async()=>{
 const actor=await f.h.person('合成分類權限會員'),principal=await f.h.candidate(s.owner,actor.id),invitation=await f.h.invite(s.owner,s.tenantId,principal,'operator');await f.h.accept(actor.session,s.tenantId,invitation);
 await f.h.pool.query(`INSERT INTO tenant_module_permissions(tenant_id,principal_id,instance_id,capabilities,status,granted_by_principal_id) SELECT $1,$2,$3,ARRAY['store:read'],'active',principal_id FROM principals WHERE user_ref=$4`,[s.tenantId,principal,s.instanceId,s.owner.user.user_id]);
 const p=await page(),active=p.items.map(c=>c.category_id),writes=[['POST','',{name:'權限測試'}],['PATCH','/'+first,{name:'草稿名稱'}],['POST','/reorder',{category_ids:active}],['PUT','/'+first+'/groups',{group_keys:['P0001']}],['POST','/'+first+'/remove',{}]] as const;
 for(const caps of [['store:read'],['store:read','store:manage'],['store:read','store:publish'],['store:write']]){await f.h.pool.query('UPDATE tenant_module_permissions SET capabilities=$4 WHERE tenant_id=$1 AND principal_id=$2 AND instance_id=$3',[s.tenantId,principal,s.instanceId,caps]);assert.equal((await call('GET','/categories',undefined,undefined,undefined,app,actor.session)).status,caps.includes('store:read')?200:404);for(const [method,suffix,body] of writes)assert.equal((await call(method,'/categories'+suffix,body,p.version,undefined,app,actor.session)).status,caps.includes('store:read')?403:404);}
 await f.h.pool.query("UPDATE tenant_module_permissions SET capabilities=ARRAY['store:read','store:write'] WHERE tenant_id=$1 AND principal_id=$2 AND instance_id=$3",[s.tenantId,principal,s.instanceId]);const key=randomUUID();assert.equal(f.ok(await call('PATCH','/categories/'+first,{name:'草稿名稱'},p.version,key,app,actor.session)).changed,false);
 const foreignId=(await f.h.pool.query('SELECT category_id FROM commerce_storefront_categories WHERE tenant_id=$1 LIMIT 1',[foreign.tenantId])).rows[0].category_id;
 for(const id of [foreignId,randomUUID()])assert.equal((await call('PATCH','/categories/'+id,{name:'禁止'},p.version)).status,404);
 assert.equal((await call('GET','/categories',undefined,undefined,undefined,app,s.owner,foreign)).status,404);
 await f.h.pool.query("UPDATE tenant_module_permissions SET status='revoked',revoked_at=clock_timestamp() WHERE tenant_id=$1 AND principal_id=$2 AND instance_id=$3",[s.tenantId,principal,s.instanceId]);assert.equal((await call('PATCH','/categories/'+first,{name:'草稿名稱'},p.version,key,app,actor.session)).status,404);
});
test('CATEGORIES-05 OFF makes no category reads/routes, and corrupt sidecars fail closed rather than repair from draft',async()=>{
 const q=await f.h.pool.connect();try{await q.query('BEGIN');await q.query('ALTER TABLE commerce_publication_categories DISABLE TRIGGER preserve_publication_categories');const p=(await q.query('SELECT current_publication_id FROM commerce_storefront_profiles WHERE tenant_id=$1',[s.tenantId])).rows[0];await q.query('UPDATE commerce_publication_categories SET categories_sha256=$2 WHERE publication_id=$1',[p.current_publication_id,'0'.repeat(64)]);assert.equal((await publicPage()).status,200,'uncommitted corruption is not visible');await q.query('COMMIT');const r=await publicPage();assert.equal(r.status,500);assert.match(await r.text(),/商品分類暫時無法讀取/);const product=await app.request(f.h.origin+'/shops/'+s.slug+'/products/P0002');assert.equal(product.status,200,'product pages do not consume categories');assert.match(await product.text(),/<h1>保留群組<\/h1>/);}finally{q.release();}
 await f.h.pool.query(`REVOKE SELECT ON commerce_storefront_categories,commerce_storefront_category_members,commerce_publication_categories FROM ${f.role}`);
 assert.equal((await publicPage('',off)).status,200);const site=await off.request(f.h.origin+'/api/v1/site');assert.equal((await site.json() as any).store_categories_enabled,false);
 const legacy=(await publicPage('?category=malformed',off));assert.equal(legacy.status,200);assert.doesNotMatch(await legacy.text(),/shop-categories|商品分類/);
});

test('CATEGORIES-06 database category conflicts map to approved errors without masking other failures',async t=>{
 const actor={user_id:randomUUID(),community_id:DEMO_COMMUNITY,email:'synthetic@example.invalid',display_name:'合成會員',profession_membership_ref:'synthetic',session_hash:'synthetic-session',csrf_token:'synthetic-csrf'};
 const cases=[
  [Object.assign(new Error('duplicate key'),{code:'23505',constraint:'storefront_category_name'}),'category_name_taken','已有同名分類，請使用其他名稱。'],
  [Object.assign(new Error('Category limit'),{code:'23514',constraint:'storefront_category_limit'}),'category_limit','每間商店最多 30 個分類。'],
  [Object.assign(new Error('Category group no longer resolves'),{code:'23514'}),'category_groups_changed','商品組已更新，請重新讀取後再指定分類。'],
 ] as const;
 const invoke=(error:Error)=>categoryCommand(new Proxy(f.h.pool,{get(target,key){return key==='connect'?async()=>{throw error;}:Reflect.get(target,key);}}),actor,randomUUID(),randomUUID(),'create',null,{name:'合成分類'},randomUUID(),'1');
 for(const [error,code,message] of cases)await t.test(code,async()=>{await assert.rejects(invoke(error),{status:409,code,message});});
 for(const error of [Object.assign(new Error('unrelated check'),{code:'23514'}),Object.assign(new Error('Category group no longer resolves'),{code:'23505'}),Object.assign(new Error('other unique constraint'),{code:'23505',constraint:'other_unique'})])await assert.rejects(invoke(error),received=>received===error);
});
