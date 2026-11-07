// Keep the public reading entry free of React, the API client and member schemas.
// Existing server-rendered links work while enhancement is deferred or unavailable.
type Slot={node:HTMLElement;near:boolean;done:boolean;pending:AbortController|null};
const loadWidget=()=>import('./skill-social-widget');
const slots=[...document.querySelectorAll<HTMLElement>('[data-skill-social]')].map(node=>({node,near:false,done:false,pending:null} as Slot));
let paused=false;
let observer:IntersectionObserver|null=null;
const visible=()=>!paused&&document.visibilityState!=='hidden';
async function enhance(slot:Slot){
  if(slot.done||slot.pending||!slot.node.isConnected||!visible())return;
  const controller=new AbortController();slot.pending=controller;
  try{
    const {enhanceSkillSocial}=await loadWidget();
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

// Imports cannot be cancelled by fetch's signal, so the whole loading sequence
// also observes the deadline. Late imports remain guarded before mounting.
function untilAborted<T>(task:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Author card request ended','AbortError'));
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    task.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}

// Author cards use the existing public card projection. Read only on a deliberate
// click, clear on close/background, and re-read every time instead of caching ACLs.
for(const opener of document.querySelectorAll<HTMLButtonElement>('[data-skill-author]')){
  const dialog=document.getElementById(opener.getAttribute('aria-controls')??'') as HTMLDialogElement|null;
  const target=dialog?.querySelector<HTMLElement>('[data-author-card]'),closer=dialog?.querySelector<HTMLButtonElement>('[data-author-close]');
  const endpoint=opener.dataset.authorEndpoint??'';
  if(!dialog||!target||!closer||!/^\/api\/v1\/(?:skills\/[a-z0-9-]+|skill-submissions\/[0-9a-f-]{36})\/author-card$/.test(endpoint))continue;
  let generation=0,pending:AbortController|null=null,dispose:(()=>void)|null=null;
  function clear(){generation++;pending?.abort();pending=null;dispose?.();dispose=null;target!.replaceChildren();}
  function close(){clear();dialog!.close();opener.focus();}
  async function read(){
    clear();const current=generation,controller=new AbortController();pending=controller;
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='正在開啟作者名片…';target!.append(status);
    const timeout=window.setTimeout(()=>controller.abort(),15000);
    try{
      const [response,renderer]=await untilAborted(Promise.all([fetch(endpoint,{credentials:'omit',cache:'no-store',signal:controller.signal}),loadWidget()]),controller.signal);
      if(!response.ok)throw new Error('unavailable');
      const data:unknown=await response.json();
      if(current!==generation||!dialog!.open||document.visibilityState==='hidden')return;
      target!.replaceChildren();const release=await untilAborted(renderer.renderSkillAuthorCards(target!,data,controller.signal),controller.signal);
      if(current!==generation||!dialog!.open){release();return;}dispose=release;
    }catch{
      if(current!==generation||!dialog!.open)return;
      target!.replaceChildren();const error=document.createElement('p');error.setAttribute('role','alert');error.textContent='作者名片暫時無法載入。';
      const retry=document.createElement('button');retry.type='button';retry.textContent='重新載入名片';retry.addEventListener('click',()=>void read());target!.append(error,retry);
    }finally{clearTimeout(timeout);if(pending===controller)pending=null;}
  }
  opener.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();closer.focus();void read();});
  closer.addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{clear();opener.focus();});
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&dialog.open)close();});
  window.addEventListener('pagehide',()=>{if(dialog.open)close();else clear();});
}
