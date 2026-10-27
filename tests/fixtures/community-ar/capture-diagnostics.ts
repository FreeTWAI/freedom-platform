/** Test-only scalar instrumentation for the synthetic AR-UI-05 replay.
 * Adds overhead; timings are diagnostic, not an uninstrumented benchmark.
 * No pixels, URLs, text, errors, credentials or File names are collected.
 * Self-contained so Playwright can serialize it as an init script.
 */
export function installArCaptureDiagnostics(){
  'use strict'; // Preserve callback receivers when serialized outside an ES module.
  type Row={event:string;at:number;canvas?:number;source?:number;width?:number;height?:number;bytes?:number;ok?:boolean;state?:number};
  const rows:Row[]=[];let dropped=0,candidateLimitHits=0,armed=false,nextId=0;
  const candidates=new WeakMap<HTMLCanvasElement,{id:number;step:number;draws:number}>();
  let video:Element|null=null,flat:Element|null=null,spatial:Element|null=null,root:Element|null=null;
  const nativeDraw=CanvasRenderingContext2D.prototype.drawImage,nativeBlob=HTMLCanvasElement.prototype.toBlob;
  const record=(event:string,fields:Omit<Row,'event'|'at'>={})=>{if(rows.length<256)rows.push({event,at:performance.now(),...fields});else dropped++;};
  let lastState=-1;
  const observe=()=>{
    if(!armed||!root)return;
    // Bits: 1 busy, 2 share mounted, 4 image mounted, 8 renderer stopped.
    // DOM booleans only. No layout/computed-style reads or rendered text.
    const state=Number(root.querySelector('.ar-shutter')?.hasAttribute('disabled')??false)
      |(Number(!!root.querySelector('.ar-photo-share'))<<1)
      |(Number(!!root.querySelector('.ar-photo-share img'))<<2)
      |(Number(root.querySelector('.ar-spatial-layer')?.getAttribute('data-renderer')==='stopped')<<3);
    if(state!==lastState){lastState=state;record('dom',{state});}
  };
  const observer=new MutationObserver(observe);
  const click=(event:Event)=>{
    if(armed||!(event.target instanceof Element)||!event.target.closest('.ar-shutter'))return;
    root=event.target.closest('.ar-scanner');if(!root)return;
    video=root.querySelector('.ar-stage video');flat=root.querySelector('.ar-flat-layer');spatial=root.querySelector('.ar-spatial-layer');
    armed=true;record('click');observe();observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','data-renderer']});
  };
  document.addEventListener('click',click,true);
  CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:Parameters<typeof nativeDraw>){
    if(!armed||!(this instanceof CanvasRenderingContext2D))return Reflect.apply(nativeDraw,this,args);
    const source=args[0]===video?1:args[0]===flat?2:args[0]===spatial?3:0;
    let candidate=candidates.get(this.canvas);
    if(!candidate&&source===1&&nextId>=8)candidateLimitHits++;
    if(!candidate&&source===1&&nextId<8){candidate={id:++nextId,step:0,draws:0};candidates.set(this.canvas,candidate);}
    if(!candidate||candidate.draws>=3)return Reflect.apply(nativeDraw,this,args);
    candidate.draws++;
    record('draw-entry',{canvas:candidate.id,source,width:this.canvas.width,height:this.canvas.height});
    try{
      const result=Reflect.apply(nativeDraw,this,args);
      candidate.step=source===candidate.step+1?source:-1;
      record('draw-return',{canvas:candidate.id,source});return result;
    }catch(error){candidate.step=-1;record('draw-throw',{canvas:candidate.id,source});throw error;}
  } as typeof nativeDraw;
  HTMLCanvasElement.prototype.toBlob=function(this:HTMLCanvasElement,...args:Parameters<typeof nativeBlob>){
    const callback=args[0],rest=args.slice(1);
    const candidate=armed?candidates.get(this):undefined;
    // The tracker also draws video: require the ordered composite and JPEG call.
    if(!candidate||(candidate.step!==2&&candidate.step!==3)||rest[0]!=='image/jpeg'||rest[1]!==0.92||typeof callback!=='function')return Reflect.apply(nativeBlob,this,args);
    record('blob-entry',{canvas:candidate.id,state:candidate.step});
    try{
      const result=Reflect.apply(nativeBlob,this,[function(this:unknown,blob:Blob|null){
        record('blob-callback',{canvas:candidate.id,ok:blob!==null,bytes:blob?.size??0});
        return Reflect.apply(callback,this,[blob]);
      },...rest]);
      record('blob-return',{canvas:candidate.id});return result;
    }catch(error){record('blob-throw',{canvas:candidate.id});throw error;}
  };
  (window as unknown as {__arCaptureDiagnosticRead:()=>unknown}).__arCaptureDiagnosticRead=()=>{
    observe();return {version:1,capacity:256,dropped,candidateLimitHits,truncated:dropped>0||candidateLimitHits>0,candidates:nextId,rows:rows.map(row=>({...row}))};
  };
}

/** Failure reporting cannot replace the original assertion or wait indefinitely. */
export async function withArCaptureFailureAttachment(
  assertion:()=>Promise<void>,read:()=>Promise<unknown>,attach:(body:string)=>Promise<void>,budgetMs=1000,
){
  const bounded=async<T>(operation:()=>Promise<T>):Promise<T>=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([Promise.resolve().then(operation),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('diagnostic-unavailable')),budgetMs);})]);}
    finally{clearTimeout(timer);}
  };
  try{await assertion();}catch(original){
    let data:unknown={version:1,unavailable:true};
    try{data=await bounded(read);}catch{/* No browser error text in the artifact. */}
    try{await bounded(()=>attach(JSON.stringify(data)));}catch{/* Preserve the original failure, even if attachment is unavailable. */}
    throw original;
  }
}
