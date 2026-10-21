/** Every value is already a server-rendered SKU link. Enhancement replaces
 * history and reloads before allowing any purchase control to be used again. */
const group=document.querySelector<HTMLElement>('[data-variant-group]');
if(group){
 const hint=history.state?.storeVariantFocus;
 if(hint?.group===group.dataset.variantGroup){
  const link=Array.from(group.querySelectorAll<HTMLElement>('[data-variant-link]')).find(a=>a.dataset.axisKey===hint.axis&&a.dataset.valueKey===hint.value);
  history.replaceState({...history.state,storeVariantFocus:undefined},'');
  link?.focus({preventScroll:true});
  const status=group.querySelector<HTMLElement>('[role="status"]');if(status){const message=group.dataset.variantAnnouncement??status.textContent;status.textContent='';requestAnimationFrame(()=>{status.textContent=message;});}
 }
 for(const link of group.querySelectorAll<HTMLAnchorElement>('[data-variant-link]'))link.addEventListener('click',event=>{
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target||link.origin!==location.origin)return;
  if(link.pathname===location.pathname)return;
  event.preventDefault();
  const purchase=document.getElementById('shop-add-to-cart');if(purchase){purchase.inert=true;purchase.setAttribute('aria-busy','true');}
  history.replaceState({...history.state,storeVariantFocus:{group:group.dataset.variantGroup,axis:link.dataset.axisKey,value:link.dataset.valueKey}},'',link.href);
  location.reload();
 });
}
export {};
