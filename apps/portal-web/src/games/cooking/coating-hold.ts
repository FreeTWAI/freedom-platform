/** Negative ids keep each keyboard owner distinct from native pointer ids. */
export function coatingKeyOwner(key:string){return key===' '?-1:key==='Enter'?-2:null;}
export const COATING_HOLD_MS=900;
type Owner={input:number;target:string;start:number;frame:number|null;done:boolean};
/** A cancellable presentation gesture. Only completion requests the existing
 * coat action; partial progress is never saved as cooked/coated domain state. */
export function createCoatingHold(ports:{now:()=>number;schedule:(tick:()=>void)=>number;unschedule:(id:number)=>void;target:()=>string|null;progress:(value:number)=>void;complete:(target:string)=>void}){
 let owner:Owner|null=null;
 function cancel(){const old=owner;owner=null;if(old?.frame!==null&&old?.frame!==undefined)ports.unschedule(old.frame);ports.progress(0);}
 function tick(current:Owner){
  if(owner!==current||current.done)return;
  current.frame=null;
  if(ports.target()!==current.target){cancel();return;}
  const elapsed=ports.now()-current.start;
  if(!Number.isFinite(elapsed)||elapsed<0){cancel();return;}
  const progress=Math.min(1,elapsed/COATING_HOLD_MS);ports.progress(progress);
  if(progress===1){current.done=true;ports.complete(current.target);}
  else current.frame=ports.schedule(()=>tick(current));
 }
 return {
  begin(input:number){const target=ports.target();if(owner||target===null)return false;
   const current:Owner={input,target,start:ports.now(),frame:null,done:false};owner=current;ports.progress(0);current.frame=ports.schedule(()=>tick(current));return true;},
  release(input:number){if(owner?.input===input)cancel();},
  cancel,
 };
}
