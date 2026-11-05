// Keep the public reading entry free of React, the API client and member schemas.
// Existing server-rendered links work while enhancement is deferred or unavailable.
type Slot={node:HTMLElement;near:boolean;done:boolean;pending:AbortController|null};
const slots=[...document.querySelectorAll<HTMLElement>('[data-skill-social]')].map(node=>({node,near:false,done:false,pending:null} as Slot));
let paused=false;
let observer:IntersectionObserver|null=null;
const visible=()=>!paused&&document.visibilityState!=='hidden';
async function enhance(slot:Slot){
  if(slot.done||slot.pending||!slot.node.isConnected||!visible())return;
  const controller=new AbortController();slot.pending=controller;
  try{
    const {enhanceSkillSocial}=await import('./skill-social-widget');
    if(controller.signal.aborted||!visible()||!slot.node.isConnected)return;
    slot.done=await enhanceSkillSocial(slot.node,controller.signal);
    if(slot.done){observer?.unobserve(slot.node);slot.node.removeEventListener('focusin',slotFocus);slot.node.removeEventListener('focusout',slotBlur);}
  }catch{/* Never replace working public links with a chunk-load error. */}
  finally{
    if(slot.pending===controller)slot.pending=null;
    // A page restored while its chunk was loading can start a fresh session read.
    if(controller.signal.aborted&&visible()&&slot.near)void enhance(slot);
  }
}
function slotFocus(event:Event){const slot=slots.find(item=>item.node===event.currentTarget);if(slot)void enhance(slot);}
function slotBlur(event:Event){
  const slot=slots.find(item=>item.node===event.currentTarget);
  // Do not replace a focused SSR link, including while tabbing within the block.
  queueMicrotask(()=>{if(slot&&!slot.node.contains(document.activeElement))void enhance(slot);});
}
function resume(){for(const slot of slots)if(slot.near||slot.node.contains(document.activeElement))void enhance(slot);}
function cancel(){for(const slot of slots)slot.pending?.abort();}
if(slots.length){
  if(typeof IntersectionObserver!=='undefined'){
    observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const slot=slots.find(item=>item.node===entry.target);if(slot){slot.near=entry.isIntersecting;if(slot.near)void enhance(slot);}}
    },{rootMargin:'300px 0px'});
    for(const slot of slots)observer.observe(slot.node);
  }else{
    // Older browsers keep the existing eager enhancement instead of losing it.
    for(const slot of slots){slot.near=true;void enhance(slot);}
  }
  for(const slot of slots){slot.node.addEventListener('focusin',slotFocus);slot.node.addEventListener('focusout',slotBlur);}
  document.addEventListener('visibilitychange',()=>{if(visible())resume();else cancel();});
  window.addEventListener('pagehide',()=>{paused=true;cancel();});
  window.addEventListener('pageshow',()=>{paused=false;resume();});
}
