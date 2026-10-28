import {createDishCanvasStage,type DishCanvasStage} from './dish-stage';
import {waitForDishFrame} from './dish-worker-frame';
import {parseDishInit,parseDishView,type DishReply} from './dish-worker-protocol';

// A dedicated worker owns exactly one transferred canvas. No network or idle loop.
const scope=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(message:DishReply)=>void;close:()=>void};
let owner:number|undefined,sequence=0,stage:DishCanvasStage|null=null,failed=false,busy=false,canvas:OffscreenCanvas|null=null;
const lifetime=new AbortController();
const fail=()=>{if(failed)return;failed=true;lifetime.abort();
 // Notify the owner before cleanup: a renderer disposal error must not leave a ready UI.
 try{if(owner!==undefined)scope.postMessage({version:1,kind:'failed',owner});}
 finally{try{stage?.dispose();}finally{stage=null;scope.close();}}
};
scope.onmessage=async event=>{
 if(failed)return;
 try{
  if(owner===undefined){
   const init=parseDishInit(event.data);if(!init){fail();return;}owner=init.owner;canvas=init.canvas;busy=true;
   stage=createDishCanvasStage(init.canvas,init.pixelRatio,init.recipe,fail,init.snapshot);
   if(failed){stage.dispose();stage=null;return;}
   await waitForDishFrame(canvas,lifetime.signal);if(failed)return;busy=false;
   scope.postMessage({version:1,kind:'ready',owner,sequence:0,stats:stage.stats()});return;
  }
  const view=parseDishView(event.data,owner,sequence);if(!view||!stage||!canvas||busy){fail();return;}
  busy=true;sequence=view.sequence;stage.view(view.angle,view.zoom);
  await waitForDishFrame(canvas,lifetime.signal);if(failed)return;busy=false;
  scope.postMessage({version:1,kind:'rendered',owner,sequence,stats:stage.stats()});
 }catch{fail();}
};
