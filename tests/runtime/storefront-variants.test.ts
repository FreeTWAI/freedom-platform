import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {createHostedStorePhotoHarness,type HostedStorePhotoHarness} from '../helpers/hosted-store-photo.js';
import {isolatedTransaction} from '../../packages/resource-scopes/tenant-transaction.js';
import {freezeCheckout,placeCheckoutOrder} from '../../modules/agent-commerce/checkout/index.js';
import {variantBuyerLabels} from '../../modules/agent-commerce/storefront/variants/checkout.js';
import {syntheticShippingPort} from '../../scripts/synthetic-shipping-quote.js';
import {createSharedQuote} from '../../modules/agent-commerce/hosted/shared-quotes.js';
import {ProductGroupPageSchema,ReplaceProductGroupInputSchema} from '../../contracts/guild-launchpad/v1/storefront-variants.js';
let f:HostedStorePhotoHarness,s:Awaited<ReturnType<HostedStorePhotoHarness['openStore']>>,foreign:typeof s,app:ReturnType<HostedStorePhotoHarness['application']>;
const options={admission:{allowed:()=>true},shipping:syntheticShippingPort(),buyerLabels:variantBuyerLabels};
before(async()=>{
 const timing=[performance.now()];f=await createHostedStorePhotoHarness();timing.push(performance.now());await f.reset();timing.push(performance.now());s=await f.openStore();timing.push(performance.now());foreign=await f.openStore();timing.push(performance.now());
 console.log(JSON.stringify({variant_fixture_seconds:timing.slice(1).map((n,k)=>Number(((n-timing[k])/1000).toFixed(3)))}));
 const grants=await readFile(new URL('../../deploy/cloudflare/sql/20-runtime-grants.psql',import.meta.url),'utf8');
 for(const section of ['GALLERY','VARIANTS']){
  const sql=grants.split(`-- BEGIN STOREFRONT ${section} GRANTS\n`)[1].split('\n\\gexec')[0].replaceAll(":'runtime'",`'${f.role}'`).replaceAll("n.nspname='public'",`n.nspname='${f.h.schema}'`);
  for(const row of (await f.h.pool.query(sql)).rows)await f.h.pool.query(Object.values(row)[0] as string);
 }
 app=f.application(false,{storeVariantsEnabled:true,hostedReservationsEnabled:true,commerceSettings:{checkoutEnabled:true,quarantine:false,providerProfiles:[]},commercePorts:options});
});
after(async()=>{await f?.stop();});
const call=(method:string,suffix:string,body?:unknown,version?:string,key=randomUUID(),target=app,owner=s.owner,store=s)=>f.h.call(method,store.root+suffix,owner,body,{'Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})},target);
const page=async()=>ProductGroupPageSchema.parse(f.ok(await call('GET','/product-groups')));
const publish=async(target=app)=>{const view=f.ok(await call('GET','',undefined,undefined,undefined,target));return f.ok(await call('POST','/publish',{},view.version,undefined,target));};
const body=(g:Awaited<ReturnType<typeof page>>['items'][number])=>({title:g.title,description:g.description,axes:g.axes,members:g.members.map(m=>({product_id:m.product.product_id,product_version:m.product.version,value_keys:m.value_keys})),default_product_id:g.default_product_id,order:g.order});
const axes=[{key:randomUUID(),name:'顏色',values:[{key:randomUUID(),name:'白'},{key:randomUUID(),name:'黑'}]},{key:randomUUID(),name:'尺寸',values:[{key:randomUUID(),name:'M'},{key:randomUUID(),name:'L'}]}];
let second:any,initial:any;
test('VARIANTS-01 lazy own groups, exact combinations, CAS/replay, store isolation and frozen seventh dimension',async()=>{
 assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_product_groups')).rows[0].n,0);
 initial=(await page()).items[0];assert.equal(initial.group_id,null);assert.equal(initial.title,'合成商品');
 second=f.ok(await call('POST','/products',{title:'原本黑色商品',description:'拆分後的介紹',price_minor:35000,stock:2}),201);
 f.ok(await call('PATCH','/products/'+s.productId,{price_minor:30000,stock:1},'1'));
 const first=(await page()).items.find(g=>g.group_key==='P0001')!;
 const input={...body(first),title:'經典 T 恤',description:'商品組介紹',axes,members:[{product_id:s.productId,product_version:'2',value_keys:[axes[0].values[0].key,axes[1].values[0].key]},{product_id:second.product_id,product_version:'1',value_keys:[axes[0].values[1].key,axes[1].values[1].key]}]};
 const key=randomUUID(),ack=f.ok(await call('PUT','/product-groups/P0001',input,'1',key));assert.equal(ack.completed_version,'2');
 assert.equal((await page()).items.length,1);assert.equal((await page()).items[0].members[0].buyer_label,'經典 T 恤（白／M）');
 assert.equal(f.ok(await call('PUT','/product-groups/P0001',input,'1',key)).completed_version,'2');
 assert.equal((await call('PUT','/product-groups/P0001',{...input,title:'不同'},'1',key)).data.code,'idempotency_conflict');
 assert.equal((await call('PUT','/product-groups/P0001',input,'1')).status,412);
 assert.equal((await call('PUT','/product-groups/P0001',{...input,members:[input.members[0],{...input.members[1],value_keys:input.members[0].value_keys}]},'2')).data.code,'variant_combination_duplicate');
 const foreignReply=await call('GET','/product-groups',undefined,undefined,undefined,app,s.owner,foreign);assert.equal(foreignReply.status,404);
 const foreignProduct=f.ok(await f.h.call('GET',foreign.root+'/products',foreign.owner,undefined,{},app)).items[0];
 assert.equal((await call('PUT','/product-groups/P0001',{...input,members:[...input.members,{product_id:foreignProduct.product_id,product_version:'1',value_keys:[axes[0].values[0].key,axes[1].values[1].key]}]},'2')).data.code,'variant_members_changed');
 await publish();assert.equal(f.ok(await call('GET','/preview')).dirty,false);
 // U+0958 expands to two code points under NFC. Validate normalized text
 // before writing it to the SQL length checks, with the existing 422 copies.
 for(const [patch,code] of [
  [{description:'\u0958'.repeat(2000)},'variant_group_text_invalid'],
  [{title:'\u0958'.repeat(120)},'variant_group_text_invalid'],
  [{axes:axes.map((a,n)=>n===0?{...a,name:'\u0958'.repeat(20)}:a)},'variant_axis_name_invalid'],
  [{axes:axes.map((a,n)=>n===0?{...a,values:a.values.map((v,k)=>k===0?{...v,name:'\u0958'.repeat(40)}:v)}:a)},'variant_value_invalid'],
 ] as const){const rejected=await call('PUT','/product-groups/P0001',{...input,...patch},'2');assert.equal(rejected.status,422);assert.equal(rejected.data.code,code);}
 const frozen=(await f.h.pool.query('SELECT * FROM commerce_publication_variants WHERE tenant_id=$1',[s.tenantId])).rows[0];
 const root=(await f.h.pool.query('SELECT group_id FROM commerce_product_groups WHERE tenant_id=$1 AND catalog_anchor_sku=$2',[s.tenantId,'P0001'])).rows[0].group_id;
 await assert.rejects(f.h.pool.query('UPDATE commerce_product_group_members SET option_value_keys=$3,membership_version=membership_version+1 WHERE tenant_id=$1 AND product_id=$2',[s.tenantId,second.product_id,[randomUUID(),axes[1].values[1].key]]),{code:'23514'});
 await assert.rejects(f.h.pool.query('UPDATE commerce_product_group_members SET option_value_keys=$3,membership_version=membership_version+1 WHERE tenant_id=$1 AND product_id=$2',[s.tenantId,second.product_id,input.members[0].value_keys]),{code:'23505'});
 await assert.rejects(f.h.pool.query(`UPDATE commerce_product_group_members SET catalog_group_id=NULL,option_value_keys='{}',membership_version=membership_version+1 WHERE tenant_id=$1 AND product_id=$2`,[s.tenantId,s.productId]),{code:'23514'});
 assert.equal((await f.h.pool.query(`INSERT INTO commerce_product_group_members(tenant_id,instance_id,scope_id,group_id,selection_id,product_id) SELECT tenant_id,instance_id,scope_id,group_id,selection_id,product_id FROM commerce_product_group_members WHERE tenant_id=$1 AND catalog_group_id=$2 ON CONFLICT DO NOTHING`,[s.tenantId,root])).rowCount,0,'unchanged 177 targetless conflict handling remains valid');
 const q=await f.h.pool.connect();try{
  await q.query('BEGIN');await q.query('ALTER TABLE commerce_publication_variants DISABLE TRIGGER preserve_publication_variants');await q.query("UPDATE commerce_publication_variants SET variants_sha256=repeat('0',64) WHERE publication_id=$1",[frozen.publication_id]);
  const {publicationVariants}=await import('../../modules/agent-commerce/storefront/variants/model.js'),projection=(await q.query('SELECT projection FROM commerce_storefront_publications WHERE publication_id=$1',[frozen.publication_id])).rows[0].projection;
  await assert.rejects(publicationVariants(q,frozen.publication_id,s.tenantId,s.instanceId,projection.products),(e:any)=>e.code==='storefront_variants_invalid');
 }finally{await q.query('ROLLBACK');q.release();}

 const html=await(await app.request(f.h.origin+'/shops/'+s.slug+'/products/P0002')).text();assert.match(html,/<h1>經典 T 恤<\/h1>/);assert.match(html,/已選擇：黑／L/);assert.match(html,/aria-current="true"/);assert.match(html,/data-title="經典 T 恤（黑／L）"/);
 const preview=await call('GET','/preview-page/products/P0001');assert.equal(preview.status,200);assert.doesNotMatch(await preview.response.text(),/商品分享連結/);
 const current=(await page()).items[0],renamed={...body(current),title:'新版 T 恤'};f.ok(await call('PUT','/product-groups/P0001',renamed,current.version));
 assert.equal(f.ok(await call('GET','/preview')).dirty,true);assert.equal(await(await app.request(f.h.origin+'/shops/'+s.slug+'/products/P0002')).text(),html);
 assert.deepEqual((await f.h.pool.query('SELECT * FROM commerce_publication_variants WHERE publication_id=$1',[frozen.publication_id])).rows[0],frozen);
 await assert.rejects(f.h.pool.query('UPDATE commerce_publication_variants SET variants_sha256=variants_sha256 WHERE publication_id=$1',[frozen.publication_id]),{code:'23514'});
 // Draft item text remains untouched and continues to feed legacy raw checks.
 assert.equal(f.ok(await call('GET','/products')).items.find((p:any)=>p.product_id===second.product_id).title,'原本黑色商品');
});
test('VARIANTS-02 reservation titles stay v1; real per-item holds leave the other SKU purchasable and freeze checkout labels',async()=>{
 await f.h.pool.query('UPDATE commerce_storefront_profiles SET reservation_enabled=true WHERE instance_id=$1',[s.instanceId]);
 const quote=await createSharedQuote(f.runtime,s.actor,s.slug,{publication_revision:'1',items:[{sku:'P0001',quantity:1}]},randomUUID());
 assert.equal(quote.items[0].title,'合成商品','v1 reservations retain the item title with variants ON');
 const p=(await f.h.pool.query('SELECT storefront_shop_id FROM commerce_storefront_profiles WHERE instance_id=$1',[s.instanceId])).rows[0];
 const input=(sku:string)=>({publication_revision:'1',lines:[{sku,quantity:1}],contact:{name:'合成買家',email:'variants-buyer@example.test',phone:'0000000000'},delivery:{method:'synthetic',address:'合成地址'},invoice:null,consents:[],idempotencyKey:randomUUID()});
 const a=await isolatedTransaction(f.runtime,q=>freezeCheckout(q,p,input('P0001'),options));assert.equal(a.terms.items[0].title,'經典 T 恤（白／M）');
 const placed=await isolatedTransaction(f.runtime,q=>placeCheckoutOrder(q,p,{checkoutId:a.checkout_id,termsSha256:a.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:null,environment:'sandbox'},options));
 const b=await isolatedTransaction(f.runtime,q=>freezeCheckout(q,p,input('P0002'),options));assert.equal(b.terms.items[0].title,'經典 T 恤（黑／L）');
 await isolatedTransaction(f.runtime,q=>placeCheckoutOrder(q,p,{checkoutId:b.checkout_id,termsSha256:b.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:null,environment:'sandbox'},options));
 const sold=await(await app.request(f.h.origin+'/shops/'+s.slug+'/products/P0001')).text();assert.match(sold,/此規格已售完/);assert.doesNotMatch(sold,/id="shop-add-to-cart"/);assert.match(sold,/href="[^\"]+\/products\/P0002"/);
 const other=await(await app.request(f.h.origin+'/shops/'+s.slug+'/products/P0002')).text();assert.match(other,/id="shop-add-to-cart"/);
 const grid=await(await app.request(f.h.origin+'/shops/'+s.slug)).text();assert.match(grid,/部分規格售完/);assert.match(grid,/1 件商品/);assert.match(grid,/ 起<\/p>/);
 const rollback=await isolatedTransaction(f.runtime,q=>freezeCheckout(q,p,input('P0002'),options));
 await assert.rejects(isolatedTransaction(f.runtime,q=>placeCheckoutOrder(q,p,{checkoutId:rollback.checkout_id,termsSha256:rollback.terms_sha256,clientOrderId:randomUUID(),buyerPrincipalId:null,environment:'sandbox'},{...options,buyerLabels:undefined})),(e:any)=>e.code==='terms_changed');
 await publish();const frozenTitle=(await f.h.pool.query('SELECT terms FROM commerce_checkout_orders WHERE order_id=$1',[placed.order_id])).rows[0].terms.items[0].title;assert.equal(frozenTitle,'經典 T 恤（白／M）');
 const closed=f.application(false,{storeVariantsEnabled:true});
 const detail=await(await closed.request(f.h.origin+'/shops/'+s.slug+'/products/P0001')).text();assert.match(detail,/登入確認預留條件/);assert.match(detail,/已選擇：白／M/);assert.doesNotMatch(detail,/售完|暫時無法購買/);
 assert.doesNotMatch(await(await closed.request(f.h.origin+'/shops/'+s.slug)).text(),/售完|暫時無法購買/);
 // A rollback writer deletes only the canonical product. Its retained 177
 // photo routing and later gallery-only metadata writes must keep working.
 const current=(await page()).items.find(g=>g.group_key==='P0001')!;
 const extra=f.ok(await call('POST','/product-groups/P0001/products',{product:{title:'舊版刪除的規格',price_minor:100,stock:1},value_keys:[axes[0].values[0].key,axes[1].values[1].key]},current.version),201);
 const removed=extra.current.items.find((g:any)=>g.group_key==='P0001').members.find((m:any)=>m.product.title==='舊版刪除的規格').product;
 const removable=f.ok(await call('POST','/product-groups/P0001/products',{product:{title:'重新啟用後刪除的規格',price_minor:100,stock:1},value_keys:[axes[0].values[1].key,axes[1].values[0].key]},extra.completed_version),201).current.items.find((g:any)=>g.group_key==='P0001').members.find((m:any)=>m.product.title==='重新啟用後刪除的規格').product;
 f.ok(await call('POST','/products/'+removed.product_id+'/remove',{},removed.version,undefined,f.app));
 assert.equal((await f.h.pool.query(`UPDATE commerce_product_groups SET last_changed_at_product_version=storefront_gallery_product_version(tenant_id,instance_id,anchor_product_id) WHERE tenant_id=$1 AND instance_id=$2 AND catalog_anchor_sku='P0001'`,[s.tenantId,s.instanceId])).rowCount,1);
 assert.equal((await page()).items.some(g=>g.members.some(m=>m.product.product_id===removed.product_id)),false);
 f.ok(await call('POST','/products/'+removable.product_id+'/remove',{},removable.version));
 assert.equal((await f.h.pool.query('SELECT catalog_group_id FROM commerce_product_group_members WHERE tenant_id=$1 AND product_id=$2',[s.tenantId,removed.product_id])).rows[0].catalog_group_id,null,'removal detaches stale OFF-period tuples');
 assert.equal((await page()).items.find(g=>g.group_key==='P0001')!.members.length,2);
});
test('VARIANTS-03 detached former anchors keep distinct singleton identity, rejoin, and survive anchor deletion',async()=>{
 const a=f.ok(await call('POST','/products',{title:'原始起點',price_minor:100,stock:2}),201),b=f.ok(await call('POST','/products',{title:'剩餘規格',price_minor:200,stock:2}),201);
 const singleton=(await page()).items.find(g=>g.group_key===a.sku)!,input={...body(singleton),title:'保留商品組',axes:[axes[0]],members:[{product_id:a.product_id,product_version:'1',value_keys:[axes[0].values[0].key]},{product_id:b.product_id,product_version:'1',value_keys:[axes[0].values[1].key]}]};
 f.ok(await call('PUT','/product-groups/'+a.sku,input,'1'));
 let group=(await page()).items.find(g=>g.group_key===a.sku)!,groupId=group.group_id;
 f.ok(await call('PUT','/product-groups/'+a.sku,{...body(group),members:[body(group).members[1]],default_product_id:b.product_id},group.version));
 let detached=(await page()).items.find(g=>g.group_key===a.sku+'~single')!;assert.equal(detached.can_anchor,false);
 assert.equal((await call('PUT','/product-groups/'+detached.group_key,{...body(detached),title:'不允許的新組'},detached.version)).data.code,'variant_anchor_retained');
 let other=(await page()).items.find(g=>g.group_key==='P0001')!;
 f.ok(await call('PUT','/product-groups/P0001',{...body(other),members:[...body(other).members,{product_id:a.product_id,product_version:'1',value_keys:[axes[0].values[0].key,axes[1].values[1].key]}]},other.version));
 assert.equal((await page()).items.find(g=>g.group_key==='P0001')!.members.some(m=>m.product.product_id===a.product_id),true);
 other=(await page()).items.find(g=>g.group_key==='P0001')!;f.ok(await call('PUT','/product-groups/P0001',{...body(other),members:body(other).members.filter(m=>m.product_id!==a.product_id)},other.version));
 group=(await page()).items.find(g=>g.group_key===a.sku)!;assert.equal(group.group_id,groupId);
 f.ok(await call('PUT','/product-groups/'+a.sku,{...body(group),members:[...body(group).members,input.members[0]]},group.version));
 assert.equal((await page()).items.some(g=>g.group_key===a.sku+'~single'),false);
 f.ok(await call('POST','/products/'+a.product_id+'/remove',{},'1'));
 group=(await page()).items.find(g=>g.group_key===a.sku)!;assert.equal(group.group_id,groupId);assert.equal(group.default_product_id,b.product_id);assert.equal(group.members.length,1);
 await publish();const publicDetail=await(await app.request(f.h.origin+'/shops/'+s.slug+'/products/'+b.sku)).text();assert.match(publicDetail,/保留商品組/);
 const offer=f.ok(await f.h.call('POST',foreign.root+'/products/'+foreign.productId+'/supply-offer',foreign.owner,{}, {'Idempotency-Key':randomUUID(),'If-Match':'"1"'},app));
 const proposal=f.ok(await call('POST','/distribution-selections',{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:1500}),201);
 f.ok(await f.h.call('POST',foreign.root+'/supply-requests/'+proposal.selection_id+'/decision',foreign.owner,{decision:'accepted',listing_sha256:proposal.listing_sha256},{'Idempotency-Key':randomUUID(),'If-Match':`"${proposal.version}"`},app));
 const supply=(await page()).items.find(g=>g.members[0].source==='supply')!;assert.equal(supply.editable,false);assert.equal(supply.members.length,1);
 assert.equal((await call('PUT','/product-groups/'+supply.group_key,body(supply),supply.version)).data.code,'variant_supply_not_supported');

});
test('VARIANTS-04 body allowance is exact method/path/flag, and schema bounds preserve the complete label',async()=>{
 const path='/api/v1'+s.root+'/product-groups/P0001';
 const raw=JSON.stringify({padding:'x'.repeat(131073-14)});assert.equal(Buffer.byteLength(raw),131073);
 const request=(method:string,path:string,body:string,target=app)=>target.request(f.h.origin+path,{method,headers:{'Content-Type':'application/json',Origin:f.h.origin,Cookie:s.owner.cookie,'X-CSRF-Token':s.owner.csrf,'Idempotency-Key':randomUUID(),'If-Match':'"1"'},body});
 assert.equal((await request('PUT',path,raw)).status,413);
 const middle=JSON.stringify({padding:'x'.repeat(40000)});
 assert.equal((await request('POST',path,middle)).status,413);assert.equal((await request('PUT','/api/v1'+s.root+'/products/'+s.productId,middle)).status,413);
 assert.equal((await request('PUT',path,middle,f.app)).status,413);
 assert.equal((await request('PUT',path,middle)).status,422);
 const longAxes=[0,1].map(n=>({key:randomUUID(),name:'選'.repeat(20),values:Array.from({length:20},(_,k)=>({key:randomUUID(),name:'值'.repeat(39)+String.fromCharCode(0x4e00+k)}))}));longAxes[1].name='型'.repeat(20);
 const maximum={title:'名'.repeat(37),description:'介'.repeat(2000),axes:longAxes,members:Array.from({length:200},(_,n)=>({product_id:randomUUID(),product_version:'9223372036854775807',value_keys:[longAxes[0].values[Math.floor(n/20)].key,longAxes[1].values[n%20].key]})),default_product_id:'',order:0};maximum.default_product_id=maximum.members[0].product_id;
 // Seed 200 canonical own selections in one bounded fixture transaction.
 const p=(await f.h.pool.query('SELECT * FROM commerce_storefront_profiles WHERE instance_id=$1',[foreign.instanceId])).rows[0];
 await f.h.pool.query(`INSERT INTO commerce_items(item_id,shop_id,sku,title,description,price_minor,stock,reserved,shipping_minor,shipping_terms,return_terms)
  SELECT gen_random_uuid(),$1,'P'||lpad(n::text,4,'0'),'合成規格 '||n,'',100,2,0,0,'合成配送','合成退換貨' FROM generate_series(2,200) n`,[p.supply_shop_id]);
 await f.h.pool.query(`INSERT INTO commerce_selections(selection_id,shop_id,item_id,retail_price_minor,sale_terms,snapshot,own_retail_enabled)
  SELECT gen_random_uuid(),$1,i.item_id,100,'合成條件',jsonb_build_object('sku',i.sku,'title',i.title,'description','','price_minor',100,'currency','TWD','shipping_minor',0,'shipping_terms','合成配送','return_terms','合成退換貨'),true
  FROM commerce_items i WHERE i.shop_id=$2 AND i.sku<>'P0001'`,[p.storefront_shop_id,p.supply_shop_id]);
 await f.h.pool.query("UPDATE commerce_selections SET aggregate_version=9223372036854775807 WHERE shop_id=$1",[p.storefront_shop_id]);
 await f.h.pool.query('UPDATE commerce_storefront_profiles SET product_seq=200 WHERE instance_id=$1',[foreign.instanceId]);
 const actual=(await f.h.pool.query('SELECT item_id FROM commerce_items WHERE shop_id=$1 ORDER BY sku',[p.supply_shop_id])).rows;
 maximum.members.forEach((m,n)=>{m.product_id=actual[n].item_id;});maximum.default_product_id=maximum.members[0].product_id;
 const accepted=await app.request(f.h.origin+'/api/v1'+foreign.root+'/product-groups/P0001',{method:'PUT',headers:{'Content-Type':'application/json',Origin:f.h.origin,Cookie:foreign.owner.cookie,'X-CSRF-Token':foreign.owner.csrf,'Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:JSON.stringify(maximum)});
 assert.equal(accepted.status,200,await accepted.clone().text());assert.equal((await accepted.json() as any).current.items[0].members.length,200);
 const limit=await call('POST','/product-groups/P0001/products',{product:{title:'超過名額',price_minor:100,stock:1},value_keys:[longAxes[0].values[10].key,longAxes[1].values[0].key]},'2',undefined,app,foreign.owner,foreign);assert.equal(limit.status,409);assert.equal(limit.data.code,'storefront_product_limit');
 assert.equal(ReplaceProductGroupInputSchema.safeParse(maximum).success,true);const bytes=Buffer.byteLength(JSON.stringify(maximum));assert.ok(bytes>32768&&bytes<131072);console.log(JSON.stringify({worst_legal_group_body_bytes:bytes,illegal_title_body_bytes:Buffer.byteLength(JSON.stringify({...maximum,title:'名'.repeat(120)})),legal_title_utf16:37,complete_label_utf16:120}));
 // Parser accepts the specified 120-character title body; label validation is
 // deliberately stricter because checkout's existing title contract is 120.
 const semantic=await request('PUT',path,JSON.stringify({...maximum,title:'名'.repeat(120)}));assert.equal(semantic.status,422);assert.equal((await semantic.json() as any).code,'variant_label_too_long');
});

test('VARIANTS-05 write capability, replay reauthorization, compound create rollback, split and older-publication fallback',async()=>{
 const actor=await f.h.person('合成規格權限會員'),principal=await f.h.candidate(s.owner,actor.id),invite=await f.h.invite(s.owner,s.tenantId,principal,'operator');await f.h.accept(actor.session,s.tenantId,invite);
 await f.h.pool.query(`INSERT INTO tenant_module_permissions(tenant_id,principal_id,instance_id,capabilities,status,granted_by_principal_id) SELECT $1,$2,$3,ARRAY['store:read'],'active',principal_id FROM principals WHERE user_ref=$4`,[s.tenantId,principal,s.instanceId,s.owner.user.user_id]);
 let g=(await page()).items.find(g=>g.group_key==='P0001')!,input=body(g);
 for(const caps of [['store:read'],['store:read','store:manage'],['store:read','store:publish'],['store:write']]){
  await f.h.pool.query('UPDATE tenant_module_permissions SET capabilities=$4 WHERE tenant_id=$1 AND principal_id=$2 AND instance_id=$3',[s.tenantId,principal,s.instanceId,caps]);
  assert.equal((await call('PUT','/product-groups/P0001',input,g.version,undefined,app,actor.session)).status,caps.includes('store:read')?403:404);
 }
 await f.h.pool.query("UPDATE tenant_module_permissions SET capabilities=ARRAY['store:read','store:write'] WHERE tenant_id=$1 AND principal_id=$2 AND instance_id=$3",[s.tenantId,principal,s.instanceId]);
 const key=randomUUID(),ack=f.ok(await call('PUT','/product-groups/P0001',input,g.version,key,app,actor.session));assert.equal(ack.changed,false);
 await f.h.pool.query("UPDATE tenant_module_permissions SET status='revoked',revoked_at=clock_timestamp() WHERE tenant_id=$1 AND principal_id=$2 AND instance_id=$3",[s.tenantId,principal,s.instanceId]);
 assert.equal((await call('PUT','/product-groups/P0001',input,g.version,key,app,actor.session)).status,404,'receipt replay must reauthorize');
 const before=(await f.h.pool.query('SELECT product_seq FROM commerce_storefront_profiles WHERE instance_id=$1',[s.instanceId])).rows[0].product_seq;
 const duplicate=await call('POST','/product-groups/P0001/products',{product:{title:'不得建立的重複規格',price_minor:100,stock:1},value_keys:g.members[0].value_keys},g.version);assert.equal(duplicate.data.code,'variant_combination_duplicate');
 assert.equal((await f.h.pool.query('SELECT product_seq FROM commerce_storefront_profiles WHERE instance_id=$1',[s.instanceId])).rows[0].product_seq,before);
 const added=f.ok(await call('POST','/product-groups/P0001/products',{product:{title:'新增白色 L',description:'原本新品介紹',price_minor:33000,stock:1},value_keys:[axes[0].values[0].key,axes[1].values[1].key]},g.version),201);assert.equal(added.current.items.find((g:any)=>g.group_key==='P0001').members.length,3);
 g=(await page()).items.find(g=>g.group_key==='P0001')!;f.ok(await call('POST','/product-groups/P0001/split',{},g.version));
 assert.equal((await page()).items.find(g=>g.group_key==='P0002')!.title,'原本黑色商品');
 // A former member uses its own lazy gallery group version when it becomes
 // an anchor. Membership revisions belong to the group it just left.
 const detached=(await page()).items.find(g=>g.group_key==='P0002')!;
 const home=(await f.h.pool.query('SELECT version::text FROM commerce_product_groups WHERE tenant_id=$1 AND anchor_product_id=$2',[s.tenantId,second.product_id])).rows[0];
 assert.equal(detached.version,home.version,'singleton edit version must match its own lazy group');
 const restarted=f.ok(await call('PUT','/product-groups/P0002',{...body(detached),title:'原成員的新商品組',axes:[axes[0]],members:body(detached).members.map(m=>({...m,value_keys:[axes[0].values[0].key]}))},detached.version));
 const expanded=f.ok(await call('POST','/product-groups/P0002/products',{product:{title:'新組的黑色商品',price_minor:200,stock:2},value_keys:[axes[0].values[1].key]},restarted.completed_version),201);
 assert.equal(expanded.current.items.find((g:any)=>g.group_key==='P0002').members.length,2);
 await publish();assert.match(await(await app.request(f.h.origin+'/shops/'+s.slug+'/products/P0002')).text(),/原成員的新商品組/);
 const current=f.ok(await call('GET','/products')).items.find((p:any)=>p.product_id===second.product_id);f.ok(await call('PATCH','/products/'+second.product_id,{description:'舊 binary 發布的介紹'},current.version));await publish(f.app);
 const publicProjection=await(await f.app.request(f.h.origin+'/api/v1/public/stores/'+s.slug)).json() as any;
 const fallback=await(await app.request(f.h.origin+'/shops/'+s.slug)).text();assert.match(fallback,new RegExp(publicProjection.products.length+' 件商品'));
 assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_publication_variants v JOIN commerce_storefront_profiles p ON p.current_publication_id=v.publication_id WHERE p.instance_id=$1',[s.instanceId])).rows[0].n,0);
 await f.h.pool.query(`REVOKE SELECT ON commerce_publication_variants FROM ${f.role}`);
 try{
  for(const path of ['/shops/'+s.slug,'/shops/'+s.slug+'/products/P0001','/api/v1/public/stores/'+s.slug])assert.equal((await f.app.request(f.h.origin+path)).status,200);
  assert.equal((await f.app.request(f.h.origin+'/api/v1'+s.root+'/product-groups',{headers:{Cookie:s.owner.cookie}})).status,404);
 }finally{await f.h.pool.query(`GRANT SELECT ON commerce_publication_variants TO ${f.role}`);}
});

test('VARIANTS-06 predecessor function and attachment guards reject drift before any DDL; closed pages make no availability query',async()=>{
 const {catalogErrorHtml}=await import('../../modules/agent-commerce/storefront/variants/page.js');const changed=catalogErrorHtml('商店內容正在更新，請重新載入。',true);assert.match(changed,/<h1>商店內容正在更新<\/h1>/);assert.match(changed,/請重新載入，確認最新商品與規格。/);assert.match(changed,/>重新載入<\/a>/);
 const schema='variant_guard_'+process.pid,q=await f.h.pool.connect();
 try{
  await q.query('BEGIN');await q.query(`CREATE SCHEMA ${schema}`);await q.query(`SET LOCAL search_path=${schema}`);
  await q.query('CREATE TABLE commerce_product_groups(id int);CREATE TABLE commerce_product_group_members(id int);CREATE TABLE commerce_product_gallery_photos(id int)');
  const predecessor=await readFile(new URL('../../migrations/177_storefront_product_gallery.sql',import.meta.url),'utf8');
  for(const name of ['preserve_storefront_gallery_draft','preserve_storefront_gallery_member']){
   const start=predecessor.indexOf('CREATE FUNCTION '+name+'()'),end=predecessor.indexOf('END $$;',start)+'END $$;'.length;
   await q.query(predecessor.slice(start,end));await q.query(`ALTER FUNCTION ${name}() SET search_path=pg_catalog,${schema}`);
  }
  for(const [table,name] of [['commerce_product_groups','preserve_storefront_gallery_draft'],['commerce_product_gallery_photos','preserve_storefront_gallery_draft'],['commerce_product_group_members','preserve_storefront_gallery_member']])await q.query(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  const migration=await readFile(new URL('../../migrations/181_storefront_product_variants.sql',import.meta.url),'utf8'),guard=migration.slice(0,migration.indexOf('CREATE FUNCTION storefront_variant_text_valid'));
  await q.query(guard);
  await q.query('SAVEPOINT function_drift');await q.query('CREATE OR REPLACE FUNCTION preserve_storefront_gallery_member() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END $$');
  await assert.rejects(q.query(guard));await q.query('ROLLBACK TO SAVEPOINT function_drift');
  await q.query('SAVEPOINT attachment_drift');await q.query('ALTER TABLE commerce_product_groups DISABLE TRIGGER preserve_storefront_gallery_draft');await assert.rejects(q.query(guard));await q.query('ROLLBACK TO SAVEPOINT attachment_drift');
  assert.equal((await q.query("SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND column_name='catalog_anchor_sku'",[schema])).rowCount,0);
 }finally{await q.query('ROLLBACK');q.release();}
 const queries:string[]=[],observed=new Proxy(f.runtime,{get(pool,key){if(key==='connect')return async()=>{const client=await pool.connect();return new Proxy(client,{get(target,method){if(method==='query')return(sql:any,...args:any[])=>{queries.push(typeof sql==='string'?sql:sql.text);return (target.query as any)(sql,...args);};const value=Reflect.get(target,method);return typeof value==='function'?value.bind(target):value;}});};const value=Reflect.get(pool,key);return typeof value==='function'?value.bind(pool):value;}});
 const {createApp}=await import('../../apps/platform-api/src/app.js');
 const closed=createApp(observed,f.h.origin,'local',{guildLaunchpadEnabled:true,storeVariantsEnabled:true});
 assert.equal((await closed.request(f.h.origin+'/shops/'+s.slug)).status,200);assert.equal((await closed.request(f.h.origin+'/shops/'+s.slug+'/products/P0001')).status,200);
 assert.equal(queries.some(sql=>/commerce_inventory_(?:reservations|allocations)|AS available/.test(sql)),false);
});

test('VARIANTS-07 a refused current reply rolls the new mutation, journal and receipt back together',async()=>{
 const {replaceProductGroup}=await import('../../modules/agent-commerce/storefront/variants/commands.js'),{Problem}=await import('../../packages/shared/problem.js');
 const g=(await page()).items.find(g=>g.group_key==='P0001')!,key=randomUUID();
 const snapshot=async()=>({groups:(await f.h.pool.query('SELECT to_jsonb(g) row FROM commerce_product_groups g WHERE tenant_id=$1 ORDER BY group_id',[s.tenantId])).rows,members:(await f.h.pool.query('SELECT to_jsonb(m) row FROM commerce_product_group_members m WHERE tenant_id=$1 ORDER BY selection_id',[s.tenantId])).rows,receipts:(await f.h.pool.query('SELECT count(*)::int n FROM scoped_command_receipts WHERE scope_id=(SELECT scope_id FROM commerce_storefront_profiles WHERE instance_id=$1)',[s.instanceId])).rows[0].n,journal:(await f.h.pool.query('SELECT count(*)::int n FROM scoped_transition_journal WHERE scope_id=(SELECT scope_id FROM commerce_storefront_profiles WHERE instance_id=$1)',[s.instanceId])).rows[0].n});
 const before=await snapshot();let refused=false;
 const source=new Proxy(f.runtime,{get(pool,property){if(property==='connect')return async()=>{const client=await pool.connect();let written=false;return new Proxy(client,{get(target,method){if(method==='query')return(sql:any,...args:any[])=>{
  const text=typeof sql==='string'?sql:sql.text;if(text.startsWith('UPDATE commerce_product_groups SET catalog_anchor_sku='))written=true;
  if(written&&text.startsWith('SELECT *,version::text AS version FROM commerce_product_groups')){refused=true;throw new Problem(403,'capability_denied','目前沒有這個操作的權限。');}
  return(target.query as any)(sql,...args);
 };const value=Reflect.get(target,method);return typeof value==='function'?value.bind(target):value;}});};const value=Reflect.get(pool,property);return typeof value==='function'?value.bind(pool):value;}});
 await assert.rejects(replaceProductGroup(source,s.actor,s.tenantId,s.instanceId,g.group_key,key,g.version,{...body(g),title:'未完成回覆不得留下的名稱'}),(e:any)=>e.code==='capability_denied');
 assert.equal(refused,true);assert.deepEqual(await snapshot(),before);
});
