import {createDishCanvasStage,type DishCanvasStage} from './dish-stage';
import {parseDishInit,parseDishView,type DishReply} from './dish-worker-protocol';

// A dedicated worker owns exactly one transferred canvas. No network or idle loop.
const scope=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;postMessage:(message:DishReply)=>void;close:()=>void};
let owner:number|undefined,sequence=0,stage:DishCanvasStage|null=null,failed=false;
const fail=()=>{if(failed)return;failed=true;stage?.dispose();stage=null;if(owner!==undefined)scope.postMessage({version:1,kind:'failed',owner});scope.close();};
scope.onmessage=event=>{
 if(failed)return;
 try{
  if(owner===undefined){
   const init=parseDishInit(event.data);if(!init){fail();return;}owner=init.owner;
   stage=createDishCanvasStage(init.canvas,init.pixelRatio,init.recipe,fail,init.snapshot);
   if(failed){stage.dispose();stage=null;return;}
   scope.postMessage({version:1,kind:'ready',owner,sequence:0,stats:stage.stats()});return;
  }
  const view=parseDishView(event.data,owner,sequence);if(!view||!stage){fail();return;}
  sequence=view.sequence;stage.view(view.angle,view.zoom);
  scope.postMessage({version:1,kind:'rendered',owner,sequence,stats:stage.stats()});
 }catch{fail();}
};
