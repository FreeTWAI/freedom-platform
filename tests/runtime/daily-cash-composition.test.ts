import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3,Raycaster,Vector2,Plane} from 'three';
import {dailyCamera,cashCardPose,cashContains,cashDragOffset,project} from '../../apps/portal-web/src/games/daily-scene-model.js';
import {newCash,cashDeck,sortCash} from '../../apps/portal-web/src/games/domain.js';
import type {StageView} from '../../apps/portal-web/src/games/stage.js';
const sizes=[[320,568],[390,844],[667,375],[296,482],[358,758],[635,289],[1180,634]] as const;
const view=():StageView=>({game:'cash',seed:42,seconds:0,client:0,pan:{x:0,y:0},fov:44,stampPoint:{x:0,y:0},raised:false,motion:true,cash:newCash(42)});
for(const [width,height] of sizes)test(`CASH ${width}x${height}: full active card stays clear of HUD and matches independent rays throughout all thirty cards`,t=>{
 const aspect=width/height,v=view(),rect={left:19,top:27,width,height};
 const independent=new PerspectiveCamera(aspect<1?2*Math.atan(Math.tan(21*Math.PI/180)*Math.max(2.2,.95/aspect))*180/Math.PI:42,aspect,.1,60);independent.position.set(0,5.3,2.7);independent.lookAt(0,0,.23);independent.updateMatrixWorld(true);
 assert.deepEqual(dailyCamera(v,aspect).projectionMatrix.elements,independent.projectionMatrix.elements);assert.deepEqual(dailyCamera(v,aspect).matrixWorld.elements,independent.matrixWorld.elements);
 const clear=aspect<1?{left:8,right:width-12,top:172,bottom:height-140}:{left:198,right:width-164,top:16,bottom:height-16};
 // Landscape card remains exposed beside controls. At 667 the lower corners
 // can extend left of 198 only BELOW the top counter (y=120), so check each
 // actual control zone rather than a misleading single shrunken rectangle.
 const zones=aspect<1?[{left:0,right:width,top:0,bottom:172},{left:0,right:width,top:height-140,bottom:height}]:[{left:0,right:198,top:0,bottom:120},{left:0,right:174,top:120,bottom:height},{left:width-164,right:width,top:height-80,bottom:height}];
 let observations=0;
 for(const [index,card] of cashDeck(42).entries()){
  for(const feedback of ['none','wrong','correct'] as const)for(const dt of [0,20,180]){
   const state={...v,seconds:(index*200+dt)/1000,cash:{...v.cash!,feedback:feedback==='none'?null:feedback,lastAt:index*200}};
   const pose=cashCardPose(state,aspect),points=[[-1.6,-1.075],[1.6,-1.075],[1.6,1.075],[-1.6,1.075]].map(([x,z])=>project(independent,[x+pose.x,pose.y,z+pose.z])).map(p=>({x:(p.x+1)*width/2,y:(1-p.y)*height/2}));
   for(const p of points){assert.ok(p.x>7&&p.x<width-7&&p.y>7&&p.y<height-7);for(const z of zones)assert.ok(!(p.x>z.left&&p.x<z.right&&p.y>z.top&&p.y<z.bottom),JSON.stringify({width,height,feedback,dt,p,z}));}
   for(const [x,z,inside] of [[0,0,true],[1.59,1.06,true],[-1.59,-1.06,true],[1.61,0,false],[0,1.09,false]] as const){
    const p=project(independent,[pose.x+x,pose.y,pose.z+z]);const ray=new Raycaster();ray.setFromCamera(new Vector2(p.x,p.y),independent);const hit=ray.ray.intersectPlane(new Plane(new Vector3(0,1,0),-pose.y),new Vector3())!;assert.ok(Math.abs(hit.x-pose.x-x)<1e-12);assert.ok(Math.abs(hit.z-pose.z-z)<1e-12);
    assert.equal(cashContains(state,rect,rect.left+(p.x+1)*width/2,rect.top+(1-p.y)*height/2),inside);observations++;
   }
  }
  const before=v.cash!;assert.equal(sortCash(before,before.index,!card.valid,index*200).state.index,before.index);
  v.cash=sortCash(before,before.index,card.valid,index*200).state;
 }
 assert.equal(v.cash!.index,30);assert.equal(v.cash!.amount,1000000);assert.equal(v.cash!.rejected,6);
 assert.equal(cashContains(v,rect,rect.left+width/2,rect.top+height/2),false);
 t.diagnostic(JSON.stringify({width,height,clear,observations,kind:'CPU projection/contact only, not computed CSS or browser acceptance'}));
});
for(const [width,height] of sizes)test(`CASH ${width}x${height}: drag retains exact screen displacement`,()=>{
 const aspect=width/height;
 for(const cashDrag of [{x:.12,y:.08},{x:-.15,y:-.1},{x:0,y:0}]){
  const v={...view(),cashDrag},camera=dailyCamera(v,aspect),offset=cashDragOffset(v,aspect),before=project(camera,[0,.33,0]),after=project(camera,[offset.x,.33,offset.z]);
  assert.ok(Math.abs((after.x-before.x)/2-cashDrag.x)<1e-12);assert.ok(Math.abs((before.y-after.y)/2-cashDrag.y)<1e-12);
 }
});
