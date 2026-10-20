import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {createGalleryHarness,type GalleryHarness} from '../helpers/storefront-gallery.js';
import {GalleryAltTextSchema,normalizeGalleryAlt,ProductGalleryDraftSchema,ReorderGalleryInputSchema} from '../../contracts/guild-launchpad/v1/storefront-gallery.js';
let f:GalleryHarness;
let shared:Awaited<ReturnType<GalleryHarness['openStore']>>;
before(async()=>{f=await createGalleryHarness();await f.reset();await f.enable();shared=await f.openStore();});after(async()=>{await f?.stop();});
async function product(){const made=f.ok(await f.post(shared.root+'/products',shared.owner,{title:'合成圖組商品',description:'合成說明',price_minor:1200,stock:10}),201);return {...shared,productId:made.product_id as string,version:made.version as string};}
type Store=Awaited<ReturnType<GalleryHarness['openStore']>>;
async function change(s:Store,op:'reorder'|'describe'|'remove',version:string,body:unknown,key=randomUUID(),photo='main'){
 return f.galleryCall(s,op==='describe'?'PATCH':'POST',f.galleryPath(s)+(op==='reorder'?'/reorder':'/photos/'+photo+(op==='remove'?'/remove':'')),body,version,key);
}
test('GALLERY-CMD-01 optional Unicode alt is normalized, closed, code-point bounded and never interpreted',()=>{
 for(const text of ['😀'.repeat(120),' <img onerror="x"> & \' '])assert.equal(normalizeGalleryAlt(text),text.trim());
 for(const text of ['😀'.repeat(121),'\ud800','a\nb','\u202e','\u2066','\u0000'])assert.equal(GalleryAltTextSchema.safeParse(text).success,false);
 assert.equal(ReorderGalleryInputSchema.safeParse({photo_keys:['main','main']}).success,false);
 assert.equal(ReorderGalleryInputSchema.safeParse({photo_keys:['main'],asset_id:randomUUID()}).success,false);
});
test('GALLERY-CMD-02 eight ordered photos share one primary authority, preserve alt on reorder and promote on removal',async()=>{
 const s=await product();let d=await f.draft(s);assert.deepEqual(d.photos,[]);
 for(let n=0;n<8;n++){const ack=f.ok(await f.upload(s,d.version));d=ProductGalleryDraftSchema.parse(ack.current);assert.equal(d.photos.length,n+1);}
 const assetCount=(await f.h.pool.query('SELECT count(*)::int n FROM assets')).rows[0].n;
 const full=await f.upload(s,d.version);assert.equal(full.status,409);assert.equal(full.data.code,'gallery_full');
 const second=d.photos[1].photo_key;
 d=f.ok(await change(s,'describe',d.version,{alt_text:'  合成包裝  '},undefined,second)).current;assert.equal(d.photos[1].alt_text,'合成包裝');
 const key=randomUUID(),version=d.version,keys=d.photos.map(p=>p.photo_key);[keys[0],keys[1]]=[keys[1],keys[0]];
 const ack=f.ok(await change(s,'reorder',version,{photo_keys:keys},key));d=ack.current;assert.equal(d.photos[0].alt_text,'合成包裝');assert.equal(d.photos[0].photo_key,'main');
 assert.equal((await f.h.pool.query('SELECT count(*)::int n FROM assets')).rows[0].n,assetCount);
 d=f.ok(await change(s,'remove',d.version,{})).current;assert.equal(d.photos.length,7);
 const replay=f.ok(await change(s,'reorder',version,{photo_keys:keys},key));assert.equal(replay.completed_version,ack.completed_version);assert.equal(replay.current.version,d.version);
 assert.equal((await change(s,'reorder',d.version,{photo_keys:['main']})).status,409);
});
test('GALLERY-CMD-03 competing reorder/remove and stale CAS have one winner; original receipt remains current',async()=>{
 const s=await product();f.ok(await f.upload(s,'1'));let d=f.ok(await f.upload(s,'2')).current;
 const keys=d.photos.map((p:any)=>p.photo_key),version=d.version;
 const results=await Promise.all([change(s,'reorder',version,{photo_keys:[...keys].reverse()}),change(s,'remove',version,{},undefined,keys[1])]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,412]);
 const current=await f.draft(s);assert.equal(BigInt(current.version),BigInt(version)+1n);
 assert.equal((await change(s,'describe',version,{alt_text:'過期'})).status,412);
});
test('GALLERY-CMD-04 lost upload response retries original manifest, and policy-off replay never reattaches',async()=>{
 const s=await product(),key=randomUUID(),id=randomUUID();f.store.failNext('put-after');f.store.failNext('get');
 assert.equal((await f.upload(s,'1',key,id)).status,503);
 const ack=f.ok(await f.upload(s,'1',key,id));assert.equal(ack.current.photos.length,1);
 assert.equal((await f.h.pool.query("SELECT count(*)::int n FROM asset_upload_intents WHERE target_kind='storefront.gallery-photo' AND target_gallery_photo_id IN (SELECT photo_id FROM commerce_product_gallery_photos WHERE product_id=$1)",[s.productId])).rows[0].n,1);
 f.ok(await change(s,'remove',ack.current.version,{}));
 await f.h.pool.query("UPDATE domain_media_storage_policy SET persistence_allowed=false WHERE purpose='storefront.product-photo'");
 const puts=f.store.puts,replay=f.ok(await f.upload(s,'1',key,id,f.galleryApplication(true,false)));
 assert.equal(replay.completed_version,ack.completed_version);assert.deepEqual(replay.current.photos,[]);assert.equal(f.store.puts,puts);
 assert.equal((await f.upload(s,'1',key,randomUUID())).status,409);await f.enable();
});
test('GALLERY-CMD-05 legacy primary removal yields retained recovery; explicit promotion and removal remain available',async()=>{
 const s=await product();f.ok(await f.upload(s,'1'));f.ok(await f.upload(s,'2'));
 f.ok(await f.post(s.root+'/products/'+s.productId+'/photo/remove',s.owner,{},'3'));
 const d=await f.draft(s);assert.equal(d.photos.length,0);assert.equal(d.retained_secondary_photos.length,1);
 assert.equal((await f.upload(s,d.version)).status,409);
 const restored=f.ok(await change(s,'reorder',d.version,{photo_keys:d.retained_secondary_photos.map(p=>p.photo_key)}));assert.equal(restored.current.photos.length,1);
});
test('GALLERY-CMD-06 store:read sees metadata and bytes; store:write can edit without store:manage; tenant/session boundaries persist',async()=>{
 const s=await product(),foreign=await f.openStore();f.ok(await f.upload(s,'1'));
 for(const capabilities of [['store:read'],['store:read','store:write']]){
  const person=(await f.h.person('合成圖組成員')).session;
  const principal=f.ok(await f.call('GET',`/tenants/invite-candidates?user_id=${person.user.user_id}`,s.owner)).principal_id;
  const invitation=f.ok(await f.post(`/tenants/${s.tenantId}/invitations`,s.owner,{invitee_principal_id:principal,role:'operator',instance_capabilities:[{instance_id:s.instanceId,capabilities}],expires_at:new Date(Date.now()+86400000).toISOString()}),201);
  f.ok(await f.post(`/tenants/${s.tenantId}/invitations/${invitation.invitation_id}/accept`,person,{},invitation.version));
  const d=f.ok(await f.galleryCall(s,'GET',f.galleryPath(s),undefined,undefined,undefined,undefined,person));assert.equal(d.photos.length,1);
  assert.equal((await f.galleryApp.request(f.h.origin+d.photos[0].read_path,{headers:{Cookie:person.cookie}})).status,200);
  const result=await f.galleryCall(s,'PATCH',f.galleryPath(s)+'/photos/main',{alt_text:'成員說明'},d.version,undefined,undefined,person);
  assert.equal(result.status,capabilities.includes('store:write')?200:403);
 }
 assert.equal((await f.galleryCall({...s,productId:foreign.productId},'GET',f.galleryPath({...s,productId:foreign.productId}))).status,404);
});
