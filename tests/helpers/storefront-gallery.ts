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

/** Owner-only A/B restore fixture: extend the retained gallery graph with a
 * second own selection and a non-current immutable multi-SKU publication. The
 * existing gallery publication and every Asset reference stay byte-identical. */
export async function seedVariantsRows(q:PoolClient,input:{tenantId:string;instanceId:string;productId:string}){
 const {variantsSnapshot}=await import('../../modules/agent-commerce/storefront/variants/model.js');
 const {projectionDigest}=await import('../../modules/agent-commerce/hosted/publish.js');
 const {productSnapshot}=await import('../../modules/agent-commerce/hosted/products.js');
 const p=(await q.query('SELECT * FROM commerce_storefront_profiles WHERE tenant_id=$1 AND instance_id=$2',[input.tenantId,input.instanceId])).rows[0];
 const first=(await q.query('SELECT s.selection_id,i.sku FROM commerce_selections s JOIN commerce_items i USING(item_id) WHERE s.shop_id=$1 AND i.item_id=$2',[p.storefront_shop_id,input.productId])).rows[0];
 const home=(await q.query('SELECT * FROM commerce_product_groups WHERE tenant_id=$1 AND instance_id=$2 AND anchor_product_id=$3',[input.tenantId,input.instanceId,input.productId])).rows[0];
 const secondId=randomUUID(),selectionId=randomUUID(),secondGroup=randomUUID(),axis={key:randomUUID(),name:'款式',values:[{key:randomUUID(),name:'原款'},{key:randomUUID(),name:'新款'}]};
 const second={sku:'P0900',title:'合成第二規格',description:'',price_minor:200,currency:'TWD' as const};
 await q.query(`INSERT INTO commerce_items(item_id,shop_id,sku,title,description,price_minor,stock,reserved,shipping_minor,shipping_terms,return_terms) VALUES($1,$2,$3,$4,'',200,10,0,0,'合成配送','合成退換貨')`,[secondId,p.supply_shop_id,second.sku,second.title]);
 await q.query(`INSERT INTO commerce_selections(selection_id,shop_id,item_id,retail_price_minor,sale_terms,snapshot,own_retail_enabled) VALUES($1,$2,$3,200,'合成條件',$4,true)`,[selectionId,p.storefront_shop_id,secondId,productSnapshot(second)]);
 await q.query('UPDATE commerce_selections SET own_retail_enabled=true WHERE selection_id=$1',[first.selection_id]);
 await q.query('INSERT INTO commerce_product_photo_targets(product_id,tenant_id,instance_id,scope_id) VALUES($1,$2,$3,$4)',[secondId,input.tenantId,input.instanceId,home.scope_id]);
 await q.query('INSERT INTO commerce_product_groups(group_id,tenant_id,instance_id,scope_id,anchor_product_id,last_changed_at_product_version) VALUES($1,$2,$3,$4,$5,1)',[secondGroup,input.tenantId,input.instanceId,home.scope_id,secondId]);
 await q.query('INSERT INTO commerce_product_group_members(tenant_id,instance_id,scope_id,group_id,selection_id,product_id) VALUES($1,$2,$3,$4,$5,$6)',[input.tenantId,input.instanceId,home.scope_id,secondGroup,selectionId,secondId]);
 await q.query(`UPDATE commerce_product_groups SET catalog_anchor_sku=$4,title='合成規格商品',description='合成商品組介紹',option_axes=$5,default_selection_id=$6,version=version+1 WHERE tenant_id=$1 AND instance_id=$2 AND group_id=$3`,[input.tenantId,input.instanceId,home.group_id,first.sku,JSON.stringify([axis]),first.selection_id]);
 for(const [n,id] of [first.selection_id,selectionId].entries())await q.query('UPDATE commerce_product_group_members SET catalog_group_id=$4,option_value_keys=$5,membership_version=membership_version+1,sort_order=$6 WHERE tenant_id=$1 AND instance_id=$2 AND selection_id=$3',[input.tenantId,input.instanceId,id,home.group_id,[axis.values[n].key],n]);
 const original=(await q.query('SELECT * FROM commerce_storefront_publications WHERE publication_id=$1',[p.current_publication_id])).rows[0],revision=(await q.query('SELECT (max(revision)+1)::text AS revision FROM commerce_storefront_publications WHERE tenant_id=$1 AND instance_id=$2',[input.tenantId,input.instanceId])).rows[0].revision,publicationId=randomUUID(),projection={...original.projection,revision,products:[...original.projection.products,{sku:second.sku,title:second.title,description:'',price_minor:200}]};
 await q.query(`INSERT INTO commerce_storefront_publications(publication_id,tenant_id,instance_id,revision,slug,projection,projection_sha256,published_by_principal_id,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[publicationId,input.tenantId,input.instanceId,revision,projection.slug,projection,projectionDigest(projection),p.created_by_principal_id,projection.published_at]);
 const snapshot=variantsSnapshot({profile:'freedom.hosted-store-variants/v1',groups:[{group_key:first.sku,title:'合成規格商品',description:'合成商品組介紹',axes:[axis],default_sku:first.sku,gallery_sku:first.sku,order:0,members:[first.sku,second.sku].map((sku,n)=>({sku,value_keys:[axis.values[n].key],values:[axis.values[n].name],buyer_label:'合成規格商品（'+axis.values[n].name+'）',order:n}))}]},projection.products.map((p:{sku:string})=>p.sku));
 await q.query('INSERT INTO commerce_publication_variants(publication_id,tenant_id,instance_id,document,variants_sha256) VALUES($1,$2,$3,$4,$5)',[publicationId,input.tenantId,input.instanceId,snapshot.document,snapshot.sha256]);
 return {groupId:home.group_id,publicationId,secondId};
}

export const categoryTables=['commerce_storefront_categories','commerce_storefront_category_members','commerce_publication_categories'] as const;
/** Nonempty owner-only A/B category fixture; contains retained inactive rows and
 * a frozen original-publication SKU without adding an Asset reference. */
export async function seedCategoriesRows(q:PoolClient,input:{tenantId:string;instanceId:string;productId:string}){
 const {categoriesSnapshot}=await import('../../modules/agent-commerce/storefront/categories/model.js');
 const p=(await q.query(`SELECT p.*,s.scope_id,i.sku FROM commerce_storefront_profiles p JOIN resource_scopes s ON s.kind='tenant' AND s.tenant_ref=p.tenant_id JOIN commerce_items i ON i.item_id=$3 AND i.shop_id=p.supply_shop_id WHERE p.tenant_id=$1 AND p.instance_id=$2`,[input.tenantId,input.instanceId,input.productId])).rows[0];
 const ids=[randomUUID(),randomUUID()];
 await q.query("SELECT set_config('freedom.category_variants','off',true)");
 for(const [n,id] of ids.entries()){
  await q.query('INSERT INTO commerce_storefront_categories(category_id,tenant_id,instance_id,scope_id,name,name_key,sort_order) VALUES($1,$2,$3,$4,$5,$5,$6)',[id,p.tenant_id,p.instance_id,p.scope_id,'合成分類'+n,n+1]);
  await q.query('INSERT INTO commerce_storefront_category_members(category_id,tenant_id,instance_id,scope_id,group_key,sort_order) VALUES($1,$2,$3,$4,$5,0)',[id,p.tenant_id,p.instance_id,p.scope_id,p.sku]);
 }
 await q.query('UPDATE commerce_storefront_category_members SET removed_at=clock_timestamp(),sort_order=NULL WHERE category_id=$1',[ids[1]]);
 await q.query('UPDATE commerce_storefront_categories SET removed_at=clock_timestamp(),sort_order=NULL,version=version+1 WHERE category_id=$1',[ids[1]]);
 const snapshot=categoriesSnapshot({profile:'freedom.hosted-store-categories/v1',categories:[{category_id:ids[0],name:'合成分類0',order:1,groups:[{group_key:p.sku,order:0,skus:[p.sku]}]}]},[p.sku]);
 await q.query('INSERT INTO commerce_publication_categories(publication_id,tenant_id,instance_id,document,categories_sha256) VALUES($1,$2,$3,$4,$5)',[p.current_publication_id,p.tenant_id,p.instance_id,snapshot.document,snapshot.sha256]);
 return ids;
}
