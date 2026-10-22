import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {STOREFRONT_VARIANTS_PROFILE,ProductGroupPageSchema,PublicationVariantsDocumentSchema,type ProductGroupDraft,type PublicationVariantsDocument,type RenderVariantGroup} from '../../../../contracts/guild-launchpad/v1/storefront-variants.js';
import type {PublicStoreProjection} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import {products} from '../../hosted/products.js';
import {distributionProducts} from '../../hosted/distribution.js';
import type {PhotoProduct} from '../../hosted/photo-projection.js';
import type {Profile} from '../../hosted/store.js';
import {variantCheck} from './errors.js';
export interface VariantsOptions {enabled?:boolean}
export function buyerLabel(title:string,values:readonly string[]){return title+(values.length?'（'+values.join('／')+'）':'');}
function complete(document:PublicationVariantsDocument,skus:readonly string[]){
 const seen=new Set<string>(),keys=new Set<string>();
 for(const g of document.groups){
  variantCheck(!keys.has(g.group_key),'storefront_variants_invalid',500);keys.add(g.group_key);
  const axisKeys=new Set(g.axes.map(a=>a.key)),axisNames=new Set(g.axes.map(a=>a.name));
  variantCheck(axisKeys.size===g.axes.length&&axisNames.size===g.axes.length&&g.axes.every(a=>a.name===a.name.trim().normalize('NFC')&&new Set(a.values.map(v=>v.key)).size===a.values.length&&new Set(a.values.map(v=>v.name)).size===a.values.length&&a.values.every(v=>v.name===v.name.trim().normalize('NFC'))),'storefront_variants_invalid',500);
  const tuples=new Set<string>();
  variantCheck((g.axes.length>0||g.members.length===1)&&g.default_sku===g.gallery_sku&&g.members.some(m=>m.sku===g.default_sku),'storefront_variants_invalid',500);
  for(const m of g.members){
   const values=g.axes.map((a,n)=>a.values.find(v=>v.key===m.value_keys[n])?.name),tuple=JSON.stringify(m.value_keys);
   variantCheck(!seen.has(m.sku)&&!tuples.has(tuple)&&m.value_keys.length===g.axes.length&&values.every(v=>typeof v==='string')&&JSON.stringify(values)===JSON.stringify(m.values)&&m.buyer_label===buyerLabel(g.title,m.values),'storefront_variants_invalid',500);
   tuples.add(tuple);seen.add(m.sku);
  }
 }
 variantCheck(seen.size===skus.length&&skus.every(s=>seen.has(s)),'storefront_variants_invalid',500);
}
export function variantsSnapshot(raw:unknown,skus:readonly string[]){
 const parsed=PublicationVariantsDocumentSchema.safeParse(raw);variantCheck(parsed.success,'storefront_variants_invalid',500);
 const document:PublicationVariantsDocument={profile:parsed.data.profile,groups:parsed.data.groups.map(g=>({group_key:g.group_key,title:g.title,description:g.description,
  axes:g.axes.map(a=>({key:a.key,name:a.name,values:a.values.map(v=>({key:v.key,name:v.name}))})),default_sku:g.default_sku,gallery_sku:g.gallery_sku,order:g.order,
  members:g.members.map(m=>({sku:m.sku,value_keys:[...m.value_keys],values:[...m.values],buyer_label:m.buyer_label,order:m.order}))}))};
 document.groups.sort((a,b)=>a.order-b.order||(a.group_key<b.group_key?-1:a.group_key>b.group_key?1:0));
 for(const g of document.groups)g.members.sort((a,b)=>a.order-b.order||(a.sku<b.sku?-1:a.sku>b.sku?1:0));
 complete(document,skus);
 const freeze=(value:any)=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}};freeze(document);
 return {document,sha256:createHash('sha256').update(JSON.stringify(document)).digest('hex')};
}
export function singletonVariants(products:readonly {sku:string;title:string;description:string}[]){
 return variantsSnapshot({profile:STOREFRONT_VARIANTS_PROFILE,groups:products.map((p,order)=>({group_key:p.sku,title:p.title,description:p.description,axes:[],default_sku:p.sku,gallery_sku:p.sku,order,members:[{sku:p.sku,value_keys:[],values:[],buyer_label:p.title,order:0}]}))},products.map(p=>p.sku));
}
/** Reads only this tenant's current selection identities; supply metadata stays in
 * the existing consent-filtered projection. No inventory is read for supplies. */
export async function draftVariantsData(q:PoolClient,p:Profile,items?:readonly PhotoProduct[]){
 const own=await products(q,p),shared=items?items.filter(i=>!own.some(o=>o.product_id===i.product.product_id)):await distributionProducts(q,p);
 const productRows=[...own.map(product=>({product,source:'own' as const})),...shared.map(({product})=>({product:{...product,stock:null},source:'supply' as const}))];
 variantCheck(productRows.length<=200,'storefront_variants_invalid',500);
 const selections=(await q.query('SELECT selection_id,item_id FROM commerce_selections WHERE shop_id=$1 ORDER BY selection_id',[p.storefront_shop_id])).rows;
 const groups=(await q.query('SELECT *,version::text AS version FROM commerce_product_groups WHERE tenant_id=$1 AND instance_id=$2 ORDER BY group_id',[p.tenant_id,p.instance_id])).rows;
 const members=(await q.query('SELECT *,membership_version::text AS membership_version FROM commerce_product_group_members WHERE tenant_id=$1 AND instance_id=$2 ORDER BY sort_order,selection_id',[p.tenant_id,p.instance_id])).rows;
 const live=new Map(productRows.map(r=>{const selection=selections.find(s=>s.item_id===r.product.product_id);variantCheck(selection,'storefront_variants_invalid',500);return [selection.selection_id,{...r,selection_id:selection.selection_id as string}];}));
 const result:ProductGroupDraft[]=[],assigned=new Set<string>();
 for(const g of groups.filter(g=>g.catalog_anchor_sku!==null)){
  const rows=members.filter(m=>m.catalog_group_id===g.group_id&&live.has(m.selection_id));if(!rows.length)continue;
  const axes=g.option_axes as ProductGroupDraft['axes'];
  const mapped=rows.map((m,n)=>{const r=live.get(m.selection_id)!;variantCheck(r.source==='own','storefront_variants_invalid',500);
   const values=axes.map((a,k)=>a.values.find(v=>v.key===m.option_value_keys[k])?.name);variantCheck(values.every(v=>typeof v==='string'),'storefront_variants_invalid',500);assigned.add(r.selection_id);
   return {...r,value_keys:m.option_value_keys as string[],values:values as string[],buyer_label:buyerLabel(g.title,values as string[]),order:n};});
  const selected=mapped.find(m=>m.selection_id===g.default_selection_id)??mapped[0];
  result.push({profile:STOREFRONT_VARIANTS_PROFILE,group_key:g.catalog_anchor_sku,group_id:g.group_id,version:g.version,title:g.title,description:g.description,axes,members:mapped,default_product_id:selected.product.product_id,order:g.sort_order,editable:true,can_anchor:true});
 }
 for(const [selectionId,r] of live){if(assigned.has(selectionId))continue;
  const home=groups.find(g=>g.anchor_product_id===r.product.product_id),retained=home&&result.some(g=>g.group_id===home.group_id);
  result.push({profile:STOREFRONT_VARIANTS_PROFILE,group_key:r.product.sku+(retained?'~single':''),group_id:null,version:home?.version??'1',title:r.product.title,description:r.product.description,axes:[],members:[{...r,value_keys:[],values:[],buyer_label:r.product.title,order:0}],default_product_id:r.product.product_id,order:result.length,editable:r.source==='own',can_anchor:!retained&&r.source==='own'});
 }
 result.sort((a,b)=>a.order-b.order||(a.group_key<b.group_key?-1:a.group_key>b.group_key?1:0));
 return {page:ProductGroupPageSchema.parse({profile:STOREFRONT_VARIANTS_PROFILE,items:result}),groups,members};
}
export function draftVariantsSnapshot(page:ReturnType<typeof ProductGroupPageSchema.parse>){
 const groups:RenderVariantGroup[]=page.items.map(g=>{const selected=g.members.find(m=>m.product.product_id===g.default_product_id)!;return {group_key:g.group_key,title:g.title,description:g.description,axes:g.axes,order:g.order,default_sku:selected.product.sku,gallery_sku:selected.product.sku,members:g.members.map(m=>({sku:m.product.sku,value_keys:m.value_keys,values:m.values,buyer_label:m.buyer_label,order:m.order}))};});
 return variantsSnapshot({profile:STOREFRONT_VARIANTS_PROFILE,groups},groups.flatMap(g=>g.members.map(m=>m.sku)));
}
export async function publicationVariants(q:PoolClient,id:string,t:string,i:string,products:PublicStoreProjection['products']){
 const row=(await q.query('SELECT document,variants_sha256 FROM commerce_publication_variants WHERE publication_id=$1 AND tenant_id=$2 AND instance_id=$3',[id,t,i])).rows[0];
 if(!row)return singletonVariants(products);
 const snapshot=variantsSnapshot(row.document,products.map(p=>p.sku));variantCheck(snapshot.sha256===row.variants_sha256,'storefront_variants_invalid',500);return snapshot;
}
export async function publishedVariantsDigest(q:PoolClient,p:Profile){return p.current_publication_id?(await publicationVariants(q,p.current_publication_id,p.tenant_id,p.instance_id,(p.projection as PublicStoreProjection).products)).sha256:null;}
export async function insertPublicationVariants(q:PoolClient,id:string,p:Profile,snapshot:ReturnType<typeof variantsSnapshot>){await q.query('INSERT INTO commerce_publication_variants(publication_id,tenant_id,instance_id,document,variants_sha256) VALUES($1,$2,$3,$4,$5)',[id,p.tenant_id,p.instance_id,snapshot.document,snapshot.sha256]);}
