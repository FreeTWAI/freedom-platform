import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {createGalleryHarness,galleryTables,type GalleryHarness} from '../helpers/storefront-gallery.js';
import {retainedByteUsage} from '../../modules/opportunity-project-work/tenant-capacity.js';
let f:GalleryHarness,s:Awaited<ReturnType<GalleryHarness['openStore']>>,foreign:typeof s;
before(async()=>{f=await createGalleryHarness();await f.reset();await f.enable();s=await f.openStore();foreign=await f.openStore();});after(async()=>{await f?.stop();});
const publicPath=(revision:string,n:string,sku='P0001',slug=s.slug)=>`/shops/${slug}/media/${revision}/${sku}/${n}`;
const get=(path:string,app=f.galleryApp,method='GET',cookie?:string)=>app.request(f.h.origin+path,{method,headers:cookie?{Cookie:cookie}:{}});
const describe=async(alt:string)=>{const d=await f.draft(s);return f.ok(await f.galleryCall(s,'PATCH',f.galleryPath(s)+'/photos/main',{alt_text:alt},d.version));};
async function current(){return (await(await get('/api/v1/public/stores/'+s.slug)).json() as any).revision as string;}
test('GALLERY-MEDIA-01 draft preview, escaped alt and sixth dirty dimension freeze with atomic publish/retry',async()=>{
 f.ok(await f.upload(s,'1'));f.ok(await f.upload(s,'2'));await f.publish(s);
 const revision=await current(),html=await(await get('/shops/'+s.slug+'/products/P0001')).text();
 assert.ok(html.includes('<a href="/shops/'+s.slug+'/products/P0001">商品分享連結</a>'));
 assert.match(html,/shop-gallery-thumbnails/);assert.match(html,/合成商品，第 1 張，共 2 張/);assert.match(html,/role="group" aria-label="選擇商品照片"/);assert.match(html,/data-gallery-status>共 2 張照片/);assert.match(html,/loading="lazy"/);
 const single=await(await get('/api/v1/public/stores/'+s.slug+'/media')).text(),json=await(await get('/api/v1/public/stores/'+s.slug)).text();
 const refs=(await f.h.pool.query('SELECT * FROM commerce_publication_gallery_refs WHERE tenant_id=$1 ORDER BY sku,position',[s.tenantId])).rows;assert.equal(refs.length,2);
 await describe('<img onerror="synthetic"> & \'');
 assert.equal(f.ok(await f.galleryCall(s,'GET','/preview')).dirty,true);assert.equal(await(await get('/shops/'+s.slug+'/products/P0001')).text(),html);
 const preview=await f.galleryCall(s,'GET','/preview-page/products/P0001');assert.equal(preview.status,200);const draft=await preview.response.text();assert.match(draft,/&lt;img onerror=&quot;synthetic&quot;&gt; &amp; &#39;/);assert.doesNotMatch(draft,/<img onerror=/);assert.match(draft,/未發布/);assert.doesNotMatch(draft,/property="og:/);assert.doesNotMatch(draft,/商品分享連結/);assert.doesNotMatch(draft,/href="\/shops\//);
 assert.equal(await(await get('/api/v1/public/stores/'+s.slug)).text(),json);assert.equal(await(await get('/api/v1/public/stores/'+s.slug+'/media')).text(),single);
 const view=f.ok(await f.galleryCall(s,'GET','')),key=randomUUID();const results=await Promise.all([f.galleryCall(s,'POST','/publish',{},view.version,key),f.galleryCall(s,'POST','/publish',{},view.version,key)]);for(const r of results)f.ok(r);
 const next=await current();assert.equal(BigInt(next),BigInt(revision)+1n);assert.equal(f.ok(await f.galleryCall(s,'GET','/preview')).dirty,false);
 assert.equal((await get(publicPath(revision,'2'))).status,404);assert.equal((await get(publicPath(next,'2'))).status,200);
 assert.match(await(await get('/shops/'+s.slug+'/products/P0001')).text(),/&lt;img onerror=/);
 assert.deepEqual((await f.h.pool.query('SELECT * FROM commerce_publication_gallery_refs WHERE publication_id=$1 ORDER BY sku,position',[refs[0].publication_id])).rows,refs);
 const count=(await f.h.pool.query('SELECT count(*)::int n FROM commerce_storefront_publications WHERE instance_id=$1',[s.instanceId])).rows[0].n;await f.publish(s);assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_storefront_publications WHERE instance_id=$1',[s.instanceId])).rows[0].n,count);
});
test('GALLERY-MEDIA-02 verified GET/HEAD use current publication; foreign, draft, invalid and out-of-range paths share one miss',async()=>{
 const revision=await current(),off=f.galleryApplication(false),legacyPath=`/shops/${s.slug}/media/${revision}/P0001`;
 let primaryBytes:Buffer|undefined;
 for(const method of ['GET','HEAD']){
  const enabled=await get(legacyPath,undefined,method),disabled=await get(legacyPath,off,method);
  assert.equal(enabled.status,200);assert.equal(enabled.status,disabled.status);assert.deepEqual([...enabled.headers],[...disabled.headers]);
  const bytes=Buffer.from(await enabled.arrayBuffer());assert.deepEqual(bytes,Buffer.from(await disabled.arrayBuffer()));
  if(method==='GET')primaryBytes=bytes;else assert.equal(bytes.length,0);
  const numbered=await get(publicPath(revision,'1'),undefined,method);assert.equal(numbered.status,200);assert.deepEqual(Buffer.from(await numbered.arrayBuffer()),bytes);
  for(const suffix of ['/x','/']){
   const miss=await get(publicPath(revision,'1')+suffix,undefined,method);assert.equal(miss.status,404);assert.equal(miss.headers.get('Cache-Control'),'no-store');assert.equal(miss.headers.get('X-Robots-Tag'),'noindex');
   if(method==='GET')assert.match(await miss.text(),/找不到這張商品照片。/);else assert.equal(await miss.text(),'');
  }
  const slash=await get(legacyPath+'/',undefined,method),disabledSlash=await get(legacyPath+'/',off,method);assert.equal(slash.status,404);assert.equal(slash.status,disabledSlash.status);assert.deepEqual([...slash.headers],[...disabledSlash.headers]);assert.deepEqual(Buffer.from(await slash.arrayBuffer()),Buffer.from(await disabledSlash.arrayBuffer()));
 }
 assert(primaryBytes&&primaryBytes.length>0,'the legacy URL and gallery position 1 share the frozen primary bytes');
 for(const method of ['GET','HEAD']){const gets=f.store.gets,response=await get(publicPath(revision,'2'),undefined,method);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Robots-Tag'),'noindex');assert.equal(response.headers.get('Content-Type'),'image/webp');assert(f.store.gets>gets);if(method==='HEAD')assert.equal(await response.text(),'');}
 f.ok(await f.upload(foreign,'1'));await f.publish(foreign);
 const newProduct=f.ok(await f.post(s.root+'/products',s.owner,{title:'未發布合成商品',description:'合成',price_minor:100,stock:1}),201),draft={...s,productId:newProduct.product_id};f.ok(await f.upload(draft,'1'));
 const draftPreview=await f.galleryCall(s,'GET','/preview-page/products/'+newProduct.sku);assert.equal(draftPreview.status,200);const unpublishedHtml=await draftPreview.response.text();assert.match(unpublishedHtml,/未發布/);assert.doesNotMatch(unpublishedHtml,/商品分享連結/);assert.doesNotMatch(unpublishedHtml,/href="\/shops\//);
 assert.equal((await get('/shops/'+s.slug+'/products/'+newProduct.sku)).status,404);
 const miss=[];
 for(const path of [publicPath(revision,'2','P0001',foreign.slug),publicPath(revision,'1','P0002'),publicPath(revision,'9'),publicPath(revision,'01'),publicPath(revision,'1%0A'),publicPath(revision,'1%0D'),publicPath(revision,'1%0D%0A'),publicPath(revision,'1%E2%80%A8'),publicPath(revision,'0'),publicPath(revision,'2')+'/unknown']){
  const r=await get(path);assert.equal(r.status,404);miss.push(await r.text());
 }
 assert.equal(new Set(miss).size,1);const read=await f.draft(s);assert.equal((await get(read.photos[1].read_path,undefined,'GET',foreign.owner.cookie)).status,404);
 f.store.afterGet=async()=>{f.store.afterGet=undefined;await f.publish(s,undefined,'unpublish');};assert.equal((await get(publicPath(revision,'2'))).status,404);
 await f.publish(s);const d=await f.draft(s);f.store.afterGet=async()=>{f.store.afterGet=undefined;await describe('讀取期間更新');};assert.equal((await get(d.photos[1].read_path,undefined,'GET',s.owner.cookie)).status,404);
});
test('GALLERY-MEDIA-03 flag OFF reads no gallery tables, preserves all old bytes and old-shaped publish; site adds only its boolean',async()=>{
 const on=f.galleryApp,off=f.galleryApplication(false),site=await(await get('/api/v1/site',on)).json() as any,disabled=await(await get('/api/v1/site',off)).json() as any;
 assert.equal(site.store_gallery_enabled,true);assert.equal(disabled.store_gallery_enabled,false);delete site.store_gallery_enabled;delete disabled.store_gallery_enabled;assert.deepEqual(site,disabled);
 const revision=await current(),paths=['/shops/'+s.slug,'/shops/'+s.slug+'/products/P0001','/shops/'+s.slug+'/cart','/shops/'+s.slug+'/checkout','/shops/'+s.slug+'/orders/'+randomUUID(),'/shops/'+s.slug+'/about','/shops/'+s.slug+'/policies/shipping','/api/v1/public/stores/'+s.slug,'/api/v1/public/stores/'+s.slug+'/media',`/shops/${s.slug}/media/${revision}/P0001`];
 const before=[];for(const path of paths){const r=await get(path,off);before.push({status:r.status,body:Buffer.from(await r.arrayBuffer())});}
 await f.h.pool.query(`REVOKE SELECT ON ${galleryTables.join(',')} FROM ${f.role}`);
 try{
  for(const [n,path] of paths.entries()){const r=await get(path,off);assert.equal(r.status,before[n].status);assert.deepEqual(Buffer.from(await r.arrayBuffer()),before[n].body);}
  f.ok(await f.galleryCall(s,'GET','/preview',undefined,undefined,undefined,off));
  assert.equal((await f.galleryCall(s,'GET',f.galleryPath(s),undefined,undefined,undefined,off)).status,404);
  const products=f.ok(await f.galleryCall(s,'GET','/products',undefined,undefined,undefined,off));
  const own=products.items.find((p:any)=>p.product_id===s.productId);assert(own);
  f.ok(await f.galleryCall(s,'PATCH','/products/'+s.productId,{title:own.title,description:'舊版發布的合成文字變更',price_minor:own.price_minor,stock:own.stock},own.version,undefined,off));
  await f.publish(s,off);
 }finally{await f.h.pool.query(`GRANT SELECT ON ${galleryTables.join(',')} TO ${f.role}`);}
 const id=(await f.h.pool.query('SELECT current_publication_id FROM commerce_storefront_profiles WHERE instance_id=$1',[s.instanceId])).rows[0].current_publication_id;
 assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM commerce_publication_galleries WHERE publication_id=$1',[id])).rows[0].n,0);
 const html=await(await get('/shops/'+s.slug+'/products/P0001')).text();assert.doesNotMatch(html,/shop-gallery-thumbnails/);assert.doesNotMatch(html,/讀取期間更新/);
 assert.equal((await f.draft(s)).photos.length,2,'retained draft remains available on reenabling');
});
test('GALLERY-MEDIA-04 delayed PUT observes policy and product CAS; no ready pointer escapes and retained bytes stay charged',async t=>{
 await f.enable();let d=await f.draft(s);const original=f.store.putImmutable.bind(f.store);let mode='policy';
 t.mock.method(f.store,'putImmutable',async(...args:Parameters<typeof original>)=>{const result=await original(...args);if(mode==='policy')await f.h.pool.query("UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose='storefront.product-photo'");else await describe('競爭中的照片說明');return result;});
 const count=d.photos.length;assert.equal((await f.upload(s,d.version)).status,503);assert.equal((await f.draft(s)).photos.length,count);
 await f.enable();mode='cas';d=await f.draft(s);assert.equal((await f.upload(s,d.version)).status,412);assert.equal((await f.draft(s)).photos.length,count);
 const pending=(await f.h.pool.query("SELECT a.state,i.state AS intent_state,a.scope_id FROM assets a JOIN asset_upload_intents i USING(asset_id) WHERE target_kind='storefront.gallery-photo' AND i.state<>'finalized' AND target_tenant_id=$1",[s.tenantId])).rows;assert.equal(pending.length,2);assert(pending.every(p=>p.state==='pending'));
 const usageClient=await f.h.pool.connect();try{const usage=await retainedByteUsage(usageClient,pending[0].scope_id,s.tenantId);assert(BigInt(usage)>0n);}finally{usageClient.release();}
 // A canonical quota reduction applies to the entire known-purpose reservation,
 // including retained and unfinished gallery effects.
 await f.h.pool.query("UPDATE domain_media_storage_policy SET retained_byte_limit=1048576 WHERE purpose='storefront.product-photo'");
 assert.equal((await f.upload(s,(await f.draft(s)).version)).status,409);await f.enable();
});


test('GALLERY-MEDIA-05 a removal queued behind a pending publish changes only the following draft',async()=>{
 const version=f.ok(await f.galleryCall(s,'GET','')).version,productVersion=(await f.draft(s)).version;
 const blocker=await f.h.pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM commerce_storefront_profiles WHERE instance_id=$1 FOR UPDATE',[s.instanceId]);
 const pid=(await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
 const waitForBlock=async()=>{for(let n=0;n<100;n++){if((await f.h.pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) blocked',[pid])).rows[0].blocked)return;}assert.fail('publish must actually wait for the profile lock');};
 const publish=f.galleryCall(s,'POST','/publish',{},version);
 try{
  await waitForBlock();
  const remove=f.galleryCall(s,'POST',f.galleryPath(s)+'/photos/main/remove',{},productVersion);
  await blocker.query('COMMIT');f.ok(await publish);f.ok(await remove);
 }finally{await blocker.query('ROLLBACK');blocker.release();}
 const d=await f.draft(s);assert.equal(d.photos.length,1);assert.equal(f.ok(await f.galleryCall(s,'GET','/preview')).dirty,true);
 const revision=await current();assert.equal((await get(publicPath(revision,'2'))).status,200);
});


test('GALLERY-MEDIA-06 private multi-query snapshots wait for the same profile boundary as writers',async()=>{
 const original=await f.draft(s),blocker=await f.h.pool.connect();await blocker.query('BEGIN');
 await blocker.query('SELECT 1 FROM commerce_storefront_profiles WHERE instance_id=$1 FOR UPDATE',[s.instanceId]);
 const pid=(await blocker.query('SELECT pg_backend_pid() pid')).rows[0].pid;
 const next=(await blocker.query('UPDATE commerce_selections SET aggregate_version=aggregate_version+1 WHERE item_id=$1 RETURNING aggregate_version::text version',[s.productId])).rows[0].version;
 let settled=false;const read=f.draft(s).finally(()=>{settled=true;});
 try{
  let blocked=false;for(let n=0;n<100;n++){blocked=(await f.h.pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) blocked',[pid])).rows[0].blocked;if(blocked)break;}
  assert(blocked,'the gallery read must wait rather than combine product and photo versions');assert.equal(settled,false);await blocker.query('COMMIT');
  const draft=await read;assert.equal(draft.version,next);assert.equal(BigInt(next),BigInt(original.version)+1n);assert(draft.photos.every(p=>p.read_path.endsWith('/'+next)));
 }finally{await blocker.query('ROLLBACK');blocker.release();await read;}
});
