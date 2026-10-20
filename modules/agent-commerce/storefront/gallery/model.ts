import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {STOREFRONT_GALLERY_PROFILE,GalleryRefSchema,PublicationGalleryDocumentSchema,ProductGalleryDraftSchema,RenderGallerySchema,
 type GalleryRef,type PublicationGalleryDocument,type RenderGallery} from '../../../../contracts/guild-launchpad/v1/storefront-gallery.js';
import {digest} from '../../../../packages/db/index.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import {publicationPhotos,type PhotoProduct,type StoredProductPhoto} from '../../hosted/photo-projection.js';
import type {Profile} from '../../hosted/store.js';
export interface GalleryOptions {enabled?:boolean;mediaInstalled?:boolean;uploadsEnabled?:boolean}
export interface DraftPhoto {photo_key:string;position:number;alt_text:string;ref:GalleryRef}
export interface DraftGallery {photos:DraftPhoto[];retained:DraftPhoto[]}
const invalid=()=>requireCondition(false,500,'storefront_gallery_invalid','商品圖組資料不完整。');
export function galleryReference(photo:StoredProductPhoto):GalleryRef{
 const {sku:_sku,...r}=photo.ref;return GalleryRefSchema.parse({...r,scope_id:photo.scopeId,policy_revision:photo.policyRevision});
}
export function mainIdentity(r:GalleryRef){return digest({asset_id:r.asset_id,representation_id:r.representation_id,scope_id:r.scope_id,policy_revision:r.policy_revision});}
export function galleryRowReference(r:Record<string,any>):GalleryRef{
 return GalleryRefSchema.parse({asset_id:r.asset_id,representation_id:r.representation_id,scope_id:r.scope_id,policy_revision:r.policy_revision,
  purpose:r.purpose,transform_version:r.transform_version,content_type:r.content_type,byte_size:Number(r.byte_size),width:r.width,height:r.height,sha256:r.content_sha256});
}
export function galleryMetadata(r:GalleryRef){return {content_type:r.content_type,byte_size:r.byte_size,width:r.width,height:r.height};}
function orderedRef(r:GalleryRef):GalleryRef{return {asset_id:r.asset_id,representation_id:r.representation_id,scope_id:r.scope_id,policy_revision:r.policy_revision,purpose:r.purpose,
 transform_version:r.transform_version,content_type:r.content_type,byte_size:r.byte_size,width:r.width,height:r.height,sha256:r.sha256};}
export function gallerySnapshot(raw:unknown){
 const d=PublicationGalleryDocumentSchema.parse(raw);
 const document:PublicationGalleryDocument={profile:d.profile,products:d.products.sort((a,b)=>a.sku<b.sku?-1:a.sku>b.sku?1:0).map(p=>({sku:p.sku,photos:p.photos.map(p=>({position:p.position,alt_text:p.alt_text,ref:orderedRef(p.ref)}))}))};
 for(const product of document.products){for(const photo of product.photos){Object.freeze(photo.ref);Object.freeze(photo);}Object.freeze(product.photos);Object.freeze(product);}
 Object.freeze(document.products);Object.freeze(document);
 // Canonical bytes are detached and deeply frozen before their digest is used.
 const bytes=JSON.stringify(document);return {document,sha256:createHash('sha256').update(bytes).digest('hex')};
}
/** Three bounded bulk reads, independent of SKU/photo count. Legacy primary is
 * always the authority, including writes made by a pre-gallery binary. */
export async function draftGalleryData(q:PoolClient,p:Profile,items:readonly PhotoProduct[]){
 const groups=(await q.query(`SELECT * FROM commerce_product_groups WHERE tenant_id=$1 AND instance_id=$2 AND anchor_product_id=ANY($3::uuid[])`,[p.tenant_id,p.instance_id,items.map(item=>item.product.product_id)])).rows;
 const rows=(await q.query(`SELECT t.photo_id,t.product_id,t.position,t.alt_text,t.asset_id,t.scope_id,t.representation_id,t.policy_revision,
  o.purpose,o.transform_version,o.content_type,o.byte_size,o.content_sha256,o.pixel_width AS width,o.pixel_height AS height,o.asset_id AS object_asset_id
  FROM commerce_product_gallery_photos t
  LEFT JOIN assets a ON a.asset_id=t.asset_id AND a.scope_id=t.scope_id AND a.tenant_ref=t.tenant_id AND a.scope_kind='tenant'
    AND a.purpose=t.purpose AND a.state='ready' AND a.deletion_fence=0 AND a.representation_id=t.representation_id
  LEFT JOIN asset_objects o ON o.asset_id=a.asset_id AND o.scope_id=a.scope_id AND o.representation_id=a.representation_id AND o.policy_revision=t.policy_revision
    AND o.purpose=t.purpose AND o.profile_id='storefront.product-photo'
  WHERE t.tenant_id=$1 AND t.instance_id=$2 AND t.group_id=ANY($3::uuid[]) AND t.position IS NOT NULL ORDER BY t.product_id,t.position`,[p.tenant_id,p.instance_id,groups.map(g=>g.group_id)])).rows;
 const byId=new Map<string,DraftGallery>();
 const products=[];
 for(const item of items){
  const g=groups.find(g=>g.anchor_product_id===item.product.product_id);
  const tail=rows.filter(r=>r.product_id===item.product.product_id).map((r,n)=>{if(!r.object_asset_id)invalid();return {photo_key:r.photo_id,position:n+2,alt_text:r.alt_text,ref:galleryRowReference(r)};});
  const main=item.photo?galleryReference(item.photo):null;
  const alt=main&&g?.main_alt_identity_sha256===mainIdentity(main)?g.main_alt_text:'';
  const photos:DraftPhoto[]=main?[{photo_key:'main',position:1,alt_text:alt,ref:main},...tail]:[];
  requireCondition(tail.length<=7&&photos.length<=8,500,'storefront_gallery_invalid','商品圖組資料不完整。');
  byId.set(item.product.product_id,{photos,retained:main?[]:tail});
  products.push({sku:item.product.sku,photos:photos.map(({position,alt_text,ref})=>({position,alt_text,ref}))});
 }
 return {...gallerySnapshot({profile:STOREFRONT_GALLERY_PROFILE,products}),byId};
}
export function privateGalleryView(p:Pick<Profile,'tenant_id'|'instance_id'>,item:PhotoProduct,gallery:DraftGallery,options:GalleryOptions){
 const image=(photo:DraftPhoto)=>({...galleryMetadata(photo.ref),photo_key:photo.photo_key,position:photo.position,alt_text:photo.alt_text,
  read_path:`/api/v1/tenants/${p.tenant_id}/storefronts/${p.instance_id}/products/${item.product.product_id}/gallery/photos/${photo.photo_key}/${item.product.version}`});
 return ProductGalleryDraftSchema.parse({profile:STOREFRONT_GALLERY_PROFILE,product_id:item.product.product_id,version:item.product.version,
  photos:gallery.photos.map(image),retained_secondary_photos:gallery.retained.map(image),media_installed:options.mediaInstalled===true,uploads_enabled:options.uploadsEnabled===true});
}
export function legacyGallery(products:readonly {sku:string}[],photos:readonly StoredProductPhoto[]){
 return gallerySnapshot({profile:STOREFRONT_GALLERY_PROFILE,products:products.map(p=>{const photo=photos.find(r=>r.ref.sku===p.sku);return {sku:p.sku,photos:photo?[{position:1,alt_text:'',ref:galleryReference(photo)}]:[]};})});
}
/** Missing predecessor sidecar means a frozen singleton, never today's draft. */
export async function publicationGallery(q:PoolClient,id:string,t:string,i:string,products:readonly {sku:string}[],primary:readonly StoredProductPhoto[]){
 const row=(await q.query('SELECT document,gallery_sha256 FROM commerce_publication_galleries WHERE publication_id=$1 AND tenant_id=$2 AND instance_id=$3',[id,t,i])).rows[0];
 if(!row)return legacyGallery(products,primary);
 const snapshot=gallerySnapshot(row.document);if(snapshot.sha256!==row.gallery_sha256)invalid();
 if(JSON.stringify(snapshot.document.products.map(p=>p.sku))!==JSON.stringify(products.map(p=>p.sku).sort()))invalid();
 const refs=(await q.query(`SELECT r.*,o.content_sha256 AS object_sha256,o.pixel_width AS object_width,o.pixel_height AS object_height
 FROM commerce_publication_gallery_refs r
 JOIN assets a ON a.asset_id=r.asset_id AND a.scope_id=r.scope_id AND a.tenant_ref=r.tenant_id AND a.scope_kind='tenant' AND a.purpose=r.purpose AND a.state='ready' AND a.deletion_fence=0 AND a.representation_id=r.representation_id
 JOIN asset_objects o ON o.asset_id=a.asset_id AND o.scope_id=a.scope_id AND o.representation_id=a.representation_id AND o.policy_revision=r.policy_revision AND o.purpose=r.purpose AND o.profile_id='storefront.product-photo'
 WHERE r.publication_id=$1 AND r.tenant_id=$2 AND r.instance_id=$3 ORDER BY r.sku,r.position`,[id,t,i])).rows;
 for(const r of refs)if(r.content_sha256!==r.object_sha256||r.width!==r.object_width||r.height!==r.object_height)invalid();
 const actual=gallerySnapshot({profile:STOREFRONT_GALLERY_PROFILE,products:snapshot.document.products.map(p=>({sku:p.sku,photos:refs.filter(r=>r.sku===p.sku).map(r=>({position:r.position,alt_text:r.alt_text,ref:galleryRowReference(r)}))}))});
 if(actual.sha256!==snapshot.sha256||refs.length!==snapshot.document.products.reduce((n,p)=>n+p.photos.length,0))invalid();
 for(const product of snapshot.document.products){const r=primary.find(r=>r.ref.sku===product.sku);if(JSON.stringify(product.photos[0]?.ref??null)!==JSON.stringify(r?orderedRef(galleryReference(r)):null))invalid();}
 return snapshot;
}
export async function publishedGalleryDigest(q:PoolClient,p:Profile){
 if(!p.current_publication_id)return null;
 const projection=p.projection as {products:{sku:string}[]};
 const primary=await publicationPhotos(q,p.current_publication_id,p.tenant_id,p.instance_id);
 return (await publicationGallery(q,p.current_publication_id,p.tenant_id,p.instance_id,projection.products,primary.photos)).sha256;
}
export async function insertPublicationGallery(q:PoolClient,id:string,p:Profile,snapshot:ReturnType<typeof gallerySnapshot>){
 await q.query('INSERT INTO commerce_publication_galleries(publication_id,tenant_id,instance_id,document,gallery_sha256) VALUES($1,$2,$3,$4,$5)',[id,p.tenant_id,p.instance_id,snapshot.document,snapshot.sha256]);
 const refs=snapshot.document.products.flatMap(p=>p.photos.map(photo=>({sku:p.sku,position:photo.position,alt_text:photo.alt_text,...photo.ref})));
 await q.query(`INSERT INTO commerce_publication_gallery_refs(publication_id,tenant_id,instance_id,sku,position,alt_text,scope_id,asset_id,representation_id,policy_revision)
 SELECT $1,$2,$3,r.sku,r.position,r.alt_text,r.scope_id,r.asset_id,r.representation_id,r.policy_revision
 FROM jsonb_to_recordset($4::jsonb) AS r(sku text,position smallint,alt_text text,scope_id uuid,asset_id uuid,representation_id uuid,policy_revision text)`,[id,p.tenant_id,p.instance_id,JSON.stringify(refs)]);
}
export function renderGallery(document:PublicationGalleryDocument,sku:string,slug:string,revision:string,installed:boolean):RenderGallery{
 return RenderGallerySchema.parse(installed?(document.products.find(p=>p.sku===sku)?.photos??[]).map(photo=>({...galleryMetadata(photo.ref),position:photo.position,alt_text:photo.alt_text,read_path:`/shops/${slug}/media/${revision}/${sku}/${photo.position}`})):[]);
}
