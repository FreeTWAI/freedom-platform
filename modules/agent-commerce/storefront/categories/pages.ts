import type {PublicationCategoriesDocument} from '../../../../contracts/guild-launchpad/v1/storefront-categories.js';
import type {PublicStoreProjection} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import type {RenderCatalog} from '../variants/buyer.js';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {escapeHtml as escape} from '../../../../packages/shared/html.js';
export interface CategoryView {document:PublicationCategoriesDocument;query:readonly string[];base:string}
export class CategoryPageError extends Error {constructor(public status:400|404,public base:string){super(status===400?'分類連結格式無效，請查看全部商品。':'這個分類目前沒有公開。');}}
export function categoryErrorHtml(error:CategoryPageError){const title=error.status===400?'分類連結格式無效':'找不到這個分類';return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}｜自由工坊</title><link rel="stylesheet" href="/shops.css"></head><body><header class="shop-top"><a href="/" aria-label="返回自由工坊"><img class="shop-logo" src="/brand/freedom-workshop.webp" alt="自由工坊" width="1280" height="720"></a></header><main><section class="shop-empty"><h1>${title}</h1><p>${error.message}</p><a href="${escape(error.base)}#products">查看全部商品</a></section></main></body></html>`;}
export function categoryDisplay(view:CategoryView,products:PublicStoreProjection['products'],catalog?:RenderCatalog){
 const query=view.query.map(value=>value.toLowerCase());
 if(query.length>1||query.length===1&&!OpaqueId.safeParse(query[0]).success)throw new CategoryPageError(400,view.base);
 const selected=view.query.length?view.document.categories.find(c=>c.category_id===query[0]):undefined;
 if(view.query.length&&!selected)throw new CategoryPageError(404,view.base);
 const ordered=selected?.groups.flatMap(g=>g.skus),seen=new Set<string>();
 const skus=ordered?.flatMap(sku=>{const display=catalog?.document.groups.find(g=>g.members.some(m=>m.sku===sku))?.default_sku??sku;if(seen.has(display)||!products.some(p=>p.sku===display))return [];seen.add(display);return [display];});
 const links=[`<a href="${escape(view.base)}#products"${!selected?' aria-current="page"':''}>全部商品</a>`,...view.document.categories.map(c=>`<a href="${escape(view.base)}?category=${c.category_id}#products"${selected?.category_id===c.category_id?' aria-current="page"':''}>${escape(c.name)}</a>`)];
 return {selected,skus,nav:view.document.categories.length?`<nav class="shop-categories" aria-label="商品分類">${links.join('')}</nav>`:''};
}
export const categoriesAssets='<link rel="stylesheet" href="/shop-categories.css">';
