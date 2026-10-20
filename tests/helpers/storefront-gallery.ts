import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {digest} from '../../packages/db/index.js';

export const galleryTables=['commerce_product_groups','commerce_product_group_members','commerce_product_gallery_photos','commerce_publication_galleries','commerce_publication_gallery_refs'] as const;
/** Owner-only fixture. Reuses a real retained primary, with all production checks active.
 * Restore callers supply an independently captured secondary representation. */
export async function seedGalleryRows(q:PoolClient,input:{tenantId:string;instanceId:string;productId:string;secondary?:{asset_id:string;representation_id:string;policy_revision:string}}){
 const {tenantId:t,instanceId:i,productId:productId}=input;
 const p=(await q.query(`SELECT f.*,s.scope_id FROM commerce_storefront_profiles f JOIN resource_scopes s ON s.kind='tenant' AND s.tenant_ref=f.tenant_id WHERE f.tenant_id=$1 AND f.instance_id=$2`,[t,i])).rows[0];
 const member=(await q.query('SELECT selection_id,aggregate_version FROM commerce_selections WHERE item_id=$1 AND shop_id=$2',[productId,p.storefront_shop_id])).rows[0];
 const primary=(await q.query('SELECT * FROM commerce_product_photo_targets WHERE tenant_id=$1 AND instance_id=$2 AND product_id=$3',[t,i,productId])).rows[0];
 if(!p.current_publication_id||!member||!primary?.asset_id)throw Error('Real own primary and publication required');
 const groupId=randomUUID(),photoId=randomUUID(),secondary=input.secondary??primary;
 await q.query(`INSERT INTO commerce_product_groups(group_id,tenant_id,instance_id,scope_id,anchor_product_id,last_changed_at_product_version) VALUES($1,$2,$3,$4,$5,$6)`,[groupId,t,i,p.scope_id,productId,member.aggregate_version]);
 await q.query(`INSERT INTO commerce_product_group_members(tenant_id,instance_id,scope_id,group_id,selection_id,product_id) VALUES($1,$2,$3,$4,$5,$6)`,[t,i,p.scope_id,groupId,member.selection_id,productId]);
 await q.query(`INSERT INTO commerce_product_gallery_photos(photo_id,tenant_id,instance_id,scope_id,group_id,product_id,position,asset_id,representation_id,policy_revision,last_changed_at_product_version,alt_text) VALUES($1,$2,$3,$4,$5,$6,2,$7,$8,$9,$10,'合成第二張')`,[photoId,t,i,p.scope_id,groupId,productId,secondary.asset_id,secondary.representation_id,secondary.policy_revision,member.aggregate_version]);
 const projection=(await q.query('SELECT projection FROM commerce_storefront_publications WHERE publication_id=$1',[p.current_publication_id])).rows[0].projection;
 const refs=(await q.query('SELECT * FROM commerce_publication_photo_refs WHERE publication_id=$1 ORDER BY sku',[p.current_publication_id])).rows;
 async function ref(assetId:string){const r=(await q.query('SELECT * FROM asset_objects WHERE asset_id=$1',[assetId])).rows[0];return {asset_id:r.asset_id,representation_id:r.representation_id,scope_id:r.scope_id,policy_revision:r.policy_revision,purpose:'storefront.product-photo',transform_version:r.transform_version,content_type:r.content_type,byte_size:Number(r.byte_size),width:r.pixel_width,height:r.pixel_height,sha256:r.content_sha256};}
 const sku=(await q.query('SELECT sku FROM commerce_items WHERE item_id=$1',[productId])).rows[0].sku;
 const products=[];
 for(const product of projection.products as {sku:string}[]){
  const old=refs.find(r=>r.sku===product.sku);const photos=old?[{position:1,alt_text:'',ref:await ref(old.asset_id)}]:[];
  if(product.sku===sku)photos.push({position:2,alt_text:'合成第二張',ref:await ref(secondary.asset_id)});
  products.push({sku:product.sku,photos});
 }
 const document={profile:'freedom.hosted-store-gallery/v1',products:products.sort((a,b)=>a.sku.localeCompare(b.sku))};
 await q.query('INSERT INTO commerce_publication_galleries(publication_id,tenant_id,instance_id,document,gallery_sha256) VALUES($1,$2,$3,$4,$5)',[p.current_publication_id,t,i,document,digest(document)]);
 for(const product of products)for(const photo of product.photos)await q.query(`INSERT INTO commerce_publication_gallery_refs(publication_id,sku,position,tenant_id,instance_id,scope_id,asset_id,representation_id,policy_revision,alt_text) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[p.current_publication_id,product.sku,photo.position,t,i,photo.ref.scope_id,photo.ref.asset_id,photo.ref.representation_id,photo.ref.policy_revision,photo.alt_text]);
 return {groupId,photoId,document};
}

// Shared by the three bounded gallery runtime files. One schema per file.
export async function createGalleryHarness(){
 const {readFile}=await import('node:fs/promises');
 const {createHostedStorePhotoHarness,photoSourcePng}=await import('./hosted-store-photo.js');
 const {createStorefrontGalleryLifecycle}=await import('../../modules/assets/storefront-gallery.js');
 const f=await createHostedStorePhotoHarness();
 const text=await readFile(new URL('../../deploy/cloudflare/sql/20-runtime-grants.psql',import.meta.url),'utf8');
 const sql=text.split('-- BEGIN STOREFRONT GALLERY GRANTS\n')[1].split('\n\\gexec')[0].replaceAll(":'runtime'",`'${f.role}'`).replaceAll("n.nspname='public'",`n.nspname='${f.h.schema}'`);
 for(const row of (await f.h.pool.query(sql)).rows)await f.h.pool.query(Object.values(row)[0] as string);
 const assets=createStorefrontGalleryLifecycle(f.runtime,{store:f.store});
 const application=(enabled=true,uploads=true,extra:NonNullable<Parameters<typeof f.application>[1]>={})=>f.application(uploads,{storeGalleryEnabled:enabled,storeGalleryAssets:assets,...extra});
 const app=application();
 async function enable(){await f.h.pool.query("UPDATE domain_media_storage_policy SET mode='r2_only',persistence_allowed=true,policy_revision='synthetic-gallery-1',retained_byte_limit=16777216 WHERE purpose='storefront.product-photo'");}
 type Store=Awaited<ReturnType<typeof f.openStore>>;
 const call=(s:Store,method:string,suffix:string,body?:unknown,version?:string,key=randomUUID(),target=app,member=s.owner)=>f.h.call(method,s.root+suffix,member,body,{'Idempotency-Key':key,...(version?{'If-Match':`"${version}"`}:{})},target);
 const path=(s:Store)=>'/products/'+s.productId+'/gallery';
 async function draft(s:Store,target=app){return f.ok(await call(s,'GET',path(s),undefined,undefined,undefined,target)) as import('../../contracts/guild-launchpad/v1/storefront-gallery.js').ProductGalleryDraft;}
 async function upload(s:Store,version:string,key=randomUUID(),id=randomUUID(),target=app,bytes=photoSourcePng){
  const response=await target.request(f.h.origin+'/api/v1'+s.root+path(s)+'/photos/'+id,{method:'POST',headers:{Origin:f.h.origin,Cookie:s.owner.cookie,'X-CSRF-Token':s.owner.csrf,'Content-Type':'image/png','Idempotency-Key':key,'If-Match':`"${version}"`},body:new Uint8Array(bytes)});
  return {status:response.status,data:await response.json() as any,response};
 }
 async function publish(s:Store,target=app,action='publish'){const view=f.ok(await call(s,'GET','',undefined,undefined,undefined,target));return f.ok(await call(s,'POST','/'+action,{},view.version,undefined,target));}
 return {...f,galleryAssets:assets,galleryApplication:application,galleryApp:app,enable,galleryCall:call,galleryPath:path,draft,upload,publish};
}
export type GalleryHarness=Awaited<ReturnType<typeof createGalleryHarness>>;
