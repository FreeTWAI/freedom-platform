import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {CategoryPageSchema,PublicationCategoriesDocumentSchema,STOREFRONT_CATEGORIES_PROFILE,type CategoryPage,type PublicationCategoriesDocument} from '../../../../contracts/guild-launchpad/v1/storefront-categories.js';
import type {PublicStoreProjection} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import {requireCondition} from '../../../../packages/shared/problem.js';
import {products} from '../../hosted/products.js';
import {distributionProducts} from '../../hosted/distribution.js';
import type {Profile} from '../../hosted/store.js';
import {draftVariantsData} from '../variants/model.js';
export interface CategoriesOptions {enabled?:boolean;variantsEnabled?:boolean}
export const categoryMessages={category_name_invalid:'分類名稱請使用有效的單行文字，最多 40 字。',category_name_taken:'已有同名分類，請使用其他名稱。',category_limit:'每間商店最多 30 個分類。',category_order_invalid:'請使用目前所有分類且不要重複，重新設定順序。',category_groups_invalid:'請選擇這間商店的商品組，最多 200 組且不要重複。',category_groups_changed:'商品組已更新，請重新讀取後再指定分類。',storefront_categories_invalid:'商品分類暫時無法讀取，請稍後重試。'} as const;
export function categoryCheck(ok:unknown,code:keyof typeof categoryMessages,status=422):asserts ok {requireCondition(ok,status,code,categoryMessages[code]);}
export async function effectiveCategoryCatalog(q:PoolClient,p:Profile,options:CategoriesOptions):Promise<CategoryPage['catalog']>{
 if(options.variantsEnabled===true)return (await draftVariantsData(q,p)).page.items.map(g=>({group_key:g.group_key,title:g.title,skus:g.members.map(m=>m.product.sku)}));
 // Deliberately no variants metadata/sidecar query in this branch.
 return [...await products(q,p),...(await distributionProducts(q,p)).map(p=>p.product)].map(p=>({group_key:p.sku,title:p.title,skus:[p.sku]}));
}
export async function categoryDraft(q:PoolClient,p:Profile,options:CategoriesOptions){
 const catalog=await effectiveCategoryCatalog(q,p,options),keys=new Set(catalog.map(g=>g.group_key));
 const rows=(await q.query('SELECT *,version::text FROM commerce_storefront_categories WHERE tenant_id=$1 AND instance_id=$2 AND removed_at IS NULL ORDER BY sort_order,category_id',[p.tenant_id,p.instance_id])).rows;
 const members=(await q.query('SELECT category_id,group_key FROM commerce_storefront_category_members WHERE tenant_id=$1 AND instance_id=$2 AND removed_at IS NULL ORDER BY sort_order,group_key',[p.tenant_id,p.instance_id])).rows;
 return CategoryPageSchema.parse({profile:STOREFRONT_CATEGORIES_PROFILE,version:p.version,catalog,items:rows.map(r=>{const refs=members.filter(m=>m.category_id===r.category_id).map(m=>m.group_key as string);return {category_id:r.category_id,name:r.name,order:r.sort_order,version:r.version,group_keys:refs.filter(k=>keys.has(k)),inactive_group_keys:refs.filter(k=>!keys.has(k))};})});
}
export function categoriesSnapshot(raw:unknown,skus:readonly string[]){
 const parsed=PublicationCategoriesDocumentSchema.safeParse(raw);categoryCheck(parsed.success,'storefront_categories_invalid',500);
 const document:PublicationCategoriesDocument={profile:parsed.data.profile,categories:parsed.data.categories.map(c=>({category_id:c.category_id,name:c.name,order:c.order,groups:c.groups.map(g=>({group_key:g.group_key,order:g.order,skus:[...g.skus].sort()})).sort((a,b)=>a.order-b.order||a.group_key.localeCompare(b.group_key))})).sort((a,b)=>a.order-b.order||a.category_id.localeCompare(b.category_id))};
 const ids=new Set<string>(),names=new Set<string>(),orders=new Set<number>();
 for(const c of document.categories){
  categoryCheck(c.name===c.name.normalize('NFC').trim()&&!ids.has(c.category_id)&&!names.has(c.name)&&!orders.has(c.order),'storefront_categories_invalid',500);ids.add(c.category_id);names.add(c.name);orders.add(c.order);
  const seen=new Set<string>(),keys=new Set<string>(),positions=new Set<number>();
  for(const g of c.groups){categoryCheck(!keys.has(g.group_key)&&!positions.has(g.order),'storefront_categories_invalid',500);keys.add(g.group_key);positions.add(g.order);for(const sku of g.skus){categoryCheck(skus.includes(sku)&&!seen.has(sku),'storefront_categories_invalid',500);seen.add(sku);}}
  categoryCheck(seen.size<=200,'storefront_categories_invalid',500);
 }
 const freeze=(v:any)=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}};freeze(document);
 return {document,sha256:createHash('sha256').update(JSON.stringify(document)).digest('hex')};
}
export function draftCategoriesSnapshot(page:CategoryPage){
 return categoriesSnapshot({profile:STOREFRONT_CATEGORIES_PROFILE,categories:page.items.flatMap(c=>{const groups=c.group_keys.flatMap((k,order)=>{const g=page.catalog.find(g=>g.group_key===k);return g?[{group_key:k,order,skus:g.skus}]:[];});return groups.length?[{category_id:c.category_id,name:c.name,order:c.order,groups}]:[];})},page.catalog.flatMap(g=>g.skus));
}
export const emptyCategories=()=>categoriesSnapshot({profile:STOREFRONT_CATEGORIES_PROFILE,categories:[]},[]);
export async function publicationCategories(q:PoolClient,id:string,t:string,i:string,products:PublicStoreProjection['products']){
 const row=(await q.query('SELECT document,categories_sha256 FROM commerce_publication_categories WHERE publication_id=$1 AND tenant_id=$2 AND instance_id=$3',[id,t,i])).rows[0];if(!row)return emptyCategories();
 const snapshot=categoriesSnapshot(row.document,products.map(p=>p.sku));categoryCheck(snapshot.sha256===row.categories_sha256,'storefront_categories_invalid',500);return snapshot;
}
export async function publishedCategoriesDigest(q:PoolClient,p:Profile){return p.current_publication_id?(await publicationCategories(q,p.current_publication_id,p.tenant_id,p.instance_id,(p.projection as PublicStoreProjection).products)).sha256:null;}
export async function insertPublicationCategories(q:PoolClient,id:string,p:Profile,s:ReturnType<typeof categoriesSnapshot>){await q.query('INSERT INTO commerce_publication_categories(publication_id,tenant_id,instance_id,document,categories_sha256) VALUES($1,$2,$3,$4,$5)',[id,p.tenant_id,p.instance_id,s.document,s.sha256]);}
