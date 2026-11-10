// Bounded browser-only phase observations; no image contents or user strings.
export function installExportTimingProbe(){
  type Event={phase:string;at:number;id?:number;width?:number;height?:number;kind?:string};
  const events:Event[]=[];let dropped=0,sequence=0;
  const record=(event:Omit<Event,'at'>)=>{if(events.length<128)events.push({...event,at:performance.now()});else dropped++;};
  Object.defineProperty(window,'__exportTimingProbe',{value:{events,get dropped(){return dropped;}}});
  const imageSrc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')!;
  Object.defineProperty(HTMLImageElement.prototype,'src',{...imageSrc,set(value:string){
    const id=++sequence,kind=value.startsWith('data:image/')?'data-image':value.startsWith('blob:')?'blob-image':'other-image';
    record({phase:'image-src',id,kind});
    const finish=(phase:string)=>{this.removeEventListener('load',loaded);this.removeEventListener('error',failed);record({phase,id,width:this.naturalWidth,height:this.naturalHeight,kind});};
    const loaded=()=>finish('image-load'),failed=()=>finish('image-error');
    this.addEventListener('load',loaded);this.addEventListener('error',failed);imageSrc.set!.call(this,value);
  }});
  const toBlob=HTMLCanvasElement.prototype.toBlob,toDataURL=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){
    const id=++sequence;record({phase:'blob-start',id,width:this.width,height:this.height,kind:type??'image/png'});
    return toBlob.call(this,function(blob){record({phase:blob?'blob-done':'blob-null',id});callback(blob);},type,quality);
  };
  HTMLCanvasElement.prototype.toDataURL=function(type,quality){
    const id=++sequence;record({phase:'data-url-start',id,width:this.width,height:this.height,kind:type??'image/png'});
    try{return toDataURL.call(this,type,quality);}finally{record({phase:'data-url-end',id});}
  };
  let dish='',download=false;
  const observer=new MutationObserver(()=>{
    const next=document.querySelector('[data-dish-view]')?.getAttribute('data-dish-view')??'';
    if(next!==dish){dish=next;record({phase:`dish-${next||'absent'}`});}
    const available=!!document.querySelector('.fw-arcade-result a[download][href^="blob:"]');
    if(available!==download){download=available;record({phase:available?'download-published':'download-removed'});}
  });
  observer.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-dish-view','href']});
}
