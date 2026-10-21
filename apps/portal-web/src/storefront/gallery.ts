/** Independent progressive enhancement; every figure and anchor works without JS. */
for(const gallery of document.querySelectorAll<HTMLElement>('[data-shop-gallery]')){
 const stage=gallery.querySelector<HTMLElement>('.shop-gallery-stage'),status=gallery.querySelector<HTMLElement>('[data-gallery-status]');
 const photos=Array.from(gallery.querySelectorAll<HTMLElement>('.shop-gallery-photo'));
 const links=Array.from(gallery.querySelectorAll<HTMLAnchorElement>('[data-gallery-photo]'));
 if(!stage||!status||!photos.length)continue;
 let current=0;
 // Keep the current thumbnail and its focus ring inside its own horizontal rail,
 // without moving the document vertically when the keyboard changes a photo.
 const reveal=(n:number)=>{
  const link=links[n],rail=link?.parentElement;if(!link||!rail)return;
  const target=link.getBoundingClientRect(),bounds=rail.getBoundingClientRect(),padding=6;
  if(target.left<bounds.left+padding)rail.scrollLeft-=bounds.left+padding-target.left;
  else if(target.right>bounds.right-padding)rail.scrollLeft+=target.right-(bounds.right-padding);
 };
 const announce=(n:number)=>{current=n;for(const [i,link] of links.entries()){if(i===n)link.setAttribute('aria-current','true');else link.removeAttribute('aria-current');}status.textContent=`第 ${n+1} 張，共 ${photos.length} 張`;reveal(n);};
 const select=(n:number,focus=false)=>{const index=Math.max(0,Math.min(n,photos.length-1));stage.scrollLeft=photos[index].offsetLeft-photos[0].offsetLeft;announce(index);if(focus)links[index]?.focus({preventScroll:true});};
 for(const [n,link] of links.entries()){
  link.addEventListener('click',e=>{e.preventDefault();select(n);});
  link.addEventListener('keydown',e=>{
   let next:number|undefined;
   if(e.key==='ArrowRight')next=Math.min(n+1,photos.length-1);else if(e.key==='ArrowLeft')next=Math.max(n-1,0);
   else if(e.key==='Home')next=0;else if(e.key==='End')next=photos.length-1;else if(e.key===' ')next=n;
   if(next!==undefined){e.preventDefault();select(next,true);}
  });
 }
 stage.addEventListener('keydown',e=>{if(e.target!==stage)return;let next:number|undefined;if(e.key==='ArrowRight')next=current+1;else if(e.key==='ArrowLeft')next=current-1;else if(e.key==='Home')next=0;else if(e.key==='End')next=photos.length-1;if(next!==undefined){e.preventDefault();select(next);}});
 // Read actual geometry for touch, scrollbar and fragment navigation. Queued
 // IntersectionObserver entries can describe the previous photo after selection.
 stage.addEventListener('scroll',()=>{
  let nearest=0,distance=Infinity;
  for(const [n,photo] of photos.entries()){
   const next=Math.abs(stage.scrollLeft-(photo.offsetLeft-photos[0].offsetLeft));
   if(next<distance){nearest=n;distance=next;}
  }
  if(nearest!==current)announce(nearest);
 });
 announce(0);
 new ResizeObserver(()=>select(current)).observe(stage);
}
