import {RenderGallerySchema,type RenderGallery} from '../../../../contracts/guild-launchpad/v1/storefront-gallery.js';
import {escapeHtml as escape} from '../../../../packages/shared/html.js';
export const galleryAssets='<link rel="stylesheet" href="/shop-gallery.css"><script type="module" src="/assets/storefront-gallery.js"></script>';
export function galleryHtml(title:string,raw:RenderGallery,binding?:{slug:string;revision:string;sku:string}){
 const photos=RenderGallerySchema.parse(raw);
 if(binding&&photos.some(p=>p.read_path!==`/shops/${binding.slug}/media/${binding.revision}/${binding.sku}/${p.position}`))throw Error('storefront_public_gallery_required');
 if(!photos.length)return '<div class="shop-photo-placeholder"><span>尚未提供商品照片</span></div>';
 const label=(n:number)=>`第 ${n} 張，共 ${photos.length} 張`;
 return `<section class="shop-gallery" aria-label="商品照片" data-shop-gallery><div class="shop-gallery-stage" tabindex="0" aria-label="商品照片，可左右捲動">${photos.map((p,n)=>`<figure id="gallery-photo-${p.position}" class="shop-gallery-photo" aria-label="${label(p.position)}"><img src="${escape(p.read_path)}" alt="${escape(p.alt_text||`${title}，${label(p.position)}`)}" width="${p.width}" height="${p.height}" loading="${n===0?'eager':'lazy'}" decoding="async"></figure>`).join('')}</div><p class="shop-gallery-status" role="status" aria-live="polite" aria-atomic="true" data-gallery-status>共 ${photos.length} 張照片</p>${photos.length>1?`<div class="shop-gallery-thumbnails" role="group" aria-label="選擇商品照片">${photos.map(p=>`<a href="#gallery-photo-${p.position}" data-gallery-photo="${p.position}" aria-label="顯示第 ${p.position} 張照片"><img src="${escape(p.read_path)}" alt="" width="${p.width}" height="${p.height}" loading="lazy" decoding="async"></a>`).join('')}</div>`:''}</section>`;
}
