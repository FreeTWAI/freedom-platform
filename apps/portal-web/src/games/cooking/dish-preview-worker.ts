import type {MarketRun} from './market-domain';
import {nextDishView,parseDishReply,type DishStats,type DishInit,type DishView} from './dish-worker-protocol';

export type DishPreview={turn:(delta:number)=>void;zoom:(delta:number)=>void;reset:()=>void;stats:()=>DishStats;pending:()=>boolean;dispose:()=>void};
let nextOwner=0;
export const supportsDishWorker=()=>typeof Worker!=='undefined'&&typeof OffscreenCanvas!=='undefined'&&typeof HTMLCanvasElement.prototype.transferControlToOffscreen==='function';
/** Optional preview cannot monopolize the page's main JS thread during scene construction. */
export function createDishPreview(host:HTMLElement,recipe:string,onReady:()=>void,onLost:()=>void,onStats:()=>void,snapshot?:MarketRun):DishPreview{
 if(!supportsDishWorker())throw Error('Offscreen preview unavailable');
 const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');canvas.width=640;canvas.height=480;
 const worker=new Worker(new URL('./dish-worker.ts',import.meta.url),{type:'module'}),owner=++nextOwner;
 let active=true,ready=false,sequence=0,inFlight=0,dirty=false,deadline:ReturnType<typeof setTimeout>|undefined;
 let stats:DishStats={calls:0,triangles:0,geometries:0,textures:0},view=nextDishView({angle:0,zoom:1},'reset',0,recipe);
 const dispose=()=>{if(!active)return;active=false;clearTimeout(deadline);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();canvas.remove();};
 const fail=()=>{if(!active)return;dispose();onLost();};
 const send=()=>{if(!active||!ready||inFlight||!dirty)return false;dirty=false;inFlight=++sequence;
  const message:DishView={version:1,kind:'view',owner,sequence,angle:view.angle,zoom:view.zoom};
  deadline=setTimeout(fail,15000);
  try{worker.postMessage(message);if(active)onStats();}catch{fail();}return true;
 };
 worker.onerror=event=>{event.preventDefault();fail();};worker.onmessageerror=fail;
 worker.onmessage=event=>{
  if(!active)return;const reply=parseDishReply(event.data,owner);
  if(!reply||reply.kind==='failed'){fail();return;}
  if(reply.kind==='ready'){
   if(ready||reply.sequence!==0){fail();return;}ready=true;stats=reply.stats;onReady();if(!send())onStats();
  }else{
   if(!ready||!inFlight||reply.sequence!==inFlight){fail();return;}clearTimeout(deadline);inFlight=0;stats=reply.stats;if(!send())onStats();
  }
 };
 try{const offscreen=canvas.transferControlToOffscreen();host.append(canvas);
  const message:DishInit={version:1,kind:'init',owner,canvas:offscreen,recipe,pixelRatio:Math.max(.5,Math.min(devicePixelRatio||1,1.5)),...(snapshot?{snapshot}:{})};worker.postMessage(message,[offscreen]);
 }catch(cause){dispose();throw cause;}
 const command=(kind:'turn'|'zoom'|'reset',delta=0)=>{if(!active||!ready)return;view=nextDishView(view,kind,delta,recipe);dirty=true;send();};
 return {turn:delta=>command('turn',delta),zoom:delta=>command('zoom',delta),reset:()=>command('reset'),stats:()=>stats,pending:()=>!!inFlight||dirty,dispose};
}
