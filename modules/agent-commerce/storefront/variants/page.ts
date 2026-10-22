import type {RenderVariantGroup} from '../../../../contracts/guild-launchpad/v1/storefront-variants.js';
import type {PublicStoreProjection} from '../../../../contracts/guild-launchpad/v1/storefront.js';
import {escapeHtml as escape} from '../../../../packages/shared/html.js';
import type {RenderCatalog,VariantAvailability} from './buyer.js';
export const variantsAssets='<link rel="stylesheet" href="/shop-variants.css"><script type="module" src="/assets/storefront-variants.js"></script>';
export function catalogProducts(store:PublicStoreProjection,catalog:RenderCatalog){return catalog.document.groups.map(g=>({...store.products.find(p=>p.sku===g.default_sku)!,title:g.title,description:g.description,price_minor:Math.min(...g.members.map(m=>store.products.find(p=>p.sku===m.sku)!.price_minor))}));}
export function variantCardDetail(store:PublicStoreProjection,sku:string,catalog:RenderCatalog){
 const g=catalog.document.groups.find(g=>g.default_sku===sku)!,prices=g.members.map(m=>store.products.find(p=>p.sku===m.sku)!.price_minor),different=new Set(prices).size>1;
 const states=catalog.availability&&g.members.map(m=>catalog.availability!.get(m.sku));
 const status=states?(states.every(s=>s==='sold_out')?'售完':states.every(s=>s!=='available')?'暫時無法購買':states.some(s=>s==='sold_out')?'部分規格售完':states.some(s=>s==='unavailable')?'部分規格暫時無法購買。':''):'';
 return {priceSuffix:different?' 起':'',summary:g.axes.map((a,n)=>`${new Set(g.members.map(m=>m.value_keys[n])).size} 種${a.name}`).join('・'),status};
}
export function featuredGroupSkus(skus:readonly string[],catalog:RenderCatalog){return [...new Set(skus.flatMap(sku=>{const g=catalog.document.groups.find(g=>g.members.some(m=>m.sku===sku));return g?[g.default_sku]:[];}))];}
function target(g:RenderVariantGroup,selected:string,axis:number,value:string,availability:RenderCatalog['availability']){
 const current=g.members.find(m=>m.sku===selected)!;if(current.value_keys[axis]===value)return current;
 const candidates=g.members.filter(m=>m.value_keys[axis]===value&&(axis===0||m.value_keys[0]===current.value_keys[0]));
 const compatible=candidates.find(m=>m.value_keys.every((v,n)=>n===axis||v===current.value_keys[n]));
 return (compatible&&(!availability||availability.get(compatible.sku)==='available')?compatible:undefined)??candidates.find(m=>availability?.get(m.sku)==='available')??candidates[0];
}
export function variantControls(g:RenderVariantGroup,selected:string,base:string,catalog:RenderCatalog,price:string){
 if(!g.axes.length)return '';
 const current=g.members.find(m=>m.sku===selected)!;
 const controls=g.axes.map((a,n)=>`<fieldset class="shop-variant-axis"><legend>${escape(a.name)}</legend><div class="shop-variant-values">${a.values.flatMap(v=>{
  const member=target(g,selected,n,v.key,catalog.availability);if(!member)return [];
  const candidates=g.members.filter(m=>m.value_keys[n]===v.key),states=catalog.availability&&candidates.map(m=>catalog.availability!.get(m.sku));
  const state=n===0&&states?(states.every(s=>s==='sold_out')?'sold_out':states.every(s=>s!=='available')?'unavailable':'available'):catalog.availability?.get(member.sku),chosen=current.value_keys[n]===v.key;
  const secondary=n===0&&g.axes[1]&&member.value_keys[1]!==current.value_keys[1]?`（${g.axes[1].name} ${member.values[1]}）`:'';
  return [`<a class="shop-variant-value${chosen?' is-selected':''}" href="${escape(base+'/products/'+member.sku)}" data-variant-link data-group-key="${escape(g.group_key)}" data-axis-key="${a.key}" data-value-key="${v.key}"${chosen?' aria-current="true"':''} aria-label="${escape(a.name+'：'+v.name+secondary+'，'+member.values.join('／')+(chosen?'，已選擇':'')+(state==='sold_out'?'，售完':state==='unavailable'?'，暫時無法購買':''))}">${escape(v.name+secondary)}${chosen?'<span aria-hidden="true">✓</span>':''}${state==='sold_out'?'<span>售完</span>':state==='unavailable'?'<span>暫時無法購買</span>':''}</a>`];
 }).join('')}</div></fieldset>`).join('');
 return `<section class="shop-variants" aria-label="商品規格" data-variant-group="${escape(g.group_key)}" data-variant-announcement="${escape('已選擇'+current.values.join('／')+'，'+(variantUnavailable(catalog.availability?.get(selected))??price))}">${controls}<p id="shop-variant-status" role="status" aria-live="polite" aria-atomic="true" tabindex="-1">已選擇：${escape(current.values.join('／'))}</p></section>`;
}
export function variantUnavailable(state:VariantAvailability|undefined){return state==='sold_out'?'此規格已售完，請選擇其他規格。':state==='unavailable'?'此規格暫時無法購買，請選擇其他規格。':null;}

export function catalogErrorHtml(detail:string,changing=false){const title=changing?'商店內容正在更新':'商品暫時無法讀取',message=changing?'請重新載入，確認最新商品與規格。':detail,action=changing?'重新載入':'重新整理';return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}｜自由工坊</title><link rel="stylesheet" href="/shops.css"></head><body><header class="shop-top"><a href="/" aria-label="返回自由工坊"><img class="shop-logo" src="/brand/freedom-workshop.webp" alt="自由工坊" width="1280" height="720"></a></header><main><section class="shop-empty"><h1>${title}</h1><p>${escape(message)}</p><a href="">${action}</a></section></main></body></html>`;}
