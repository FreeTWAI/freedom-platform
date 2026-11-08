import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera} from 'three';
import {dailyCamera,photoAnchors,photoFraming,project} from '../../apps/portal-web/src/games/daily-scene-model.js';
import {CLIENTS,gradePhoto} from '../../apps/portal-web/src/games/domain.js';
import type {StageView} from '../../apps/portal-web/src/games/stage.js';

// Geometry probes, not browser pixels, native rendering, or visual acceptance.
const sizes=[[320,568],[390,844],[667,375]] as const;
const axes=['x','y'] as const;
type Interval={x:[number,number];y:[number,number]};
const view=(client=1,seconds=0,fov=60):StageView=>({game:'photo',seed:42,seconds,client,pan:{x:0,y:0},fov,stampPoint:{x:0,y:0},raised:false,motion:true});
const required=(v:StageView)=>photoAnchors(v).filter(a=>a.id!=='board');
function close(actual:number,expected:number){assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);}
function envelope(v:StageView,aspect:number):Interval{
  const camera=dailyCamera(v,aspect),bounds:Interval={x:[-1.8,1.8],y:[-2.8,2.8]};
  // Derive permissible translation from the actual projection matrix. This
  // does not call photoFraming or copy its camera-FOV conversion formula.
  for(const anchor of required(v))for(const point of anchor.points){
    const p=project(camera,point);
    for(const axis of axes){
      const scale=camera.projectionMatrix.elements[axis==='x'?0:5]/(6-point[2]);
      bounds[axis][0]=Math.max(bounds[axis][0],(p[axis]-.97)/scale);
      bounds[axis][1]=Math.min(bounds[axis][1],(p[axis]+.97)/scale);
    }
  }
  return bounds;
}
function reachable(bounds:Interval,step:number){
  const pan={x:0,y:0};
  for(const axis of axes){
    const lo=Math.ceil((bounds[axis][0]+1e-8)/step),hi=Math.floor((bounds[axis][1]-1e-8)/step);
    if(lo>hi)return null;
    pan[axis]=Math.round((lo+hi)/2)*step;
  }
  return pan;
}

test('PHOTO portrait uses square-horizontal zoom while preserving actual aspect and world proportions',()=>{
  for(const [width,height] of [...sizes,[400,400]] as const)for(const fov of [38,44,60])for(const client of [0,1,2])for(const seconds of [0,1,3,6,9,12])for(const motion of [false,true]){
    const v={...view(client,seconds,fov),motion,pan:{x:.5,y:1}},aspect=width/height,camera=dailyCamera(v,aspect),tangent=Math.tan(fov*Math.PI/360);
    assert.equal(camera.aspect,aspect);
    if(aspect>=1)assert.equal(camera.fov,fov);
    for(const a of photoAnchors(v))for(const p of a.points){
      const actual=project(camera,p),depth=6-p[2];
      // Independent closed form: portrait keeps old square horizontal scale;
      // the taller vertical world grows, without stretching either axis.
      close(actual.x,(p[0]-v.pan.x)/(depth*tangent*Math.max(1,aspect)));
      close(actual.y,(p[1]-1.95-v.pan.y)*Math.min(1,aspect)/(depth*tangent));
      if(aspect<1){const square=project(dailyCamera(v,1),p);close(actual.x,square.x);close(actual.y,aspect*square.y);}
    }
    const center=project(camera,[0,2,0]),right=project(camera,[1,2,0]),up=project(camera,[0,3,0]);
    close((right.x-center.x)*width,(up.y-center.y)*height);
  }
});

for(const [width,height] of sizes)for(const fov of [38,44,60])for(const client of [0,1,2])test(`PHOTO pan envelope ${width}x${height}, zoom ${fov}, ${CLIENTS[client].id}`,t=>{
  let feasible=0,pad=0,keyboard=0,minX=Infinity,minY=Infinity;
  const common:Interval={x:[-1.8,1.8],y:[-2.8,2.8]},aspect=width/height;
  for(let sample=0;sample<=1200;sample++){
    const v=view(client,sample/100,fov),bounds=envelope(v,aspect);
    const x=bounds.x[1]-bounds.x[0],y=bounds.y[1]-bounds.y[0];minX=Math.min(minX,x);minY=Math.min(minY,y);if(x>=0&&y>=0)feasible++;
    if(aspect<1){const square=envelope(v,1);close(bounds.x[0],square.x[0]);close(bounds.x[1],square.x[1]);}
    for(const axis of axes){common[axis][0]=Math.max(common[axis][0],bounds[axis][0]);common[axis][1]=Math.min(common[axis][1],bounds[axis][1]);}
    for(const step of [.35,.25]){
      const pan=reachable(bounds,step);if(!pan)continue;
      if(step===.35)pad++;else keyboard++;
      const framing=photoFraming({...v,pan},aspect),wanted=required(v).filter(a=>a.visible).map(a=>a.id);
      for(const id of wanted)assert.ok(framing.visible.includes(id),`${sample}/${step}/${id}`);
      // The actual ±.97 edge remains meaningful: just outside the interval
      // must exclude at least one anchor when that edge is not a pan clamp.
      if(sample%100===0&&bounds.x[1]<1.8-1e-8){
        const out=photoFraming({...v,pan:{...pan,x:bounds.x[1]+.001}},aspect);
        if(wanted.length===required(v).length)assert.ok(wanted.some(id=>!out.visible.includes(id)));
      }
    }
  }
  if(fov===60){
    assert.equal(feasible,1201);assert.equal(pad,1201);assert.equal(keyboard,1201);
    assert.ok(minX>2.4);assert.ok(minY>.48,'wide zoom retains at least one full pad step, not a one-pixel slot');
  }
  if(aspect<1&&client===1){
    assert.ok(minX>(fov===38?.74:fov===44?1.37:2.44));
    if(fov===60){assert.ok(reachable(common,.35));assert.ok(reachable(common,.25));}
  }
  t.diagnostic(JSON.stringify({width,height,inputFov:fov,client:CLIENTS[client].id,samples:1201,feasible,pad,keyboard,minX,minY,common}));
});

test('PHOTO max-wide portrait umbrella has stable actual pad and keyboard targets across all twelve seconds',()=>{
  for(const [width,height]of sizes.filter(([w,h])=>w<h))for(const step of [.35,.25]){
    // Two pad presses or three board-arrow presses from neutral, with room
    // for the unchanged eased pan to settle. No arbitrary continuous-pan fix.
    const target=step===.35?{x:.7,y:.7}:{x:.75,y:.75};
    for(let sample=0;sample<=1200;sample++)for(const fraction of [.98,1]){
      const v={...view(1,sample/100,60),pan:{x:target.x*fraction,y:target.y*fraction}},framing=photoFraming(v,width/height);
      assert.equal(gradePhoto('umbrella',framing.visible,v.seconds,framing.blocked,framing.lift).stars,3);
    }
  }
});

test('PHOTO projection preserves obstruction, pigeon timing, all Daily poses and the explicit STAMP portrait fit',()=>{
  for(const [width,height]of sizes){
    const aspect=width/height,backdrop=photoFraming(view(0,0),aspect),birds=photoFraming(view(2,0),aspect);
    assert.equal(backdrop.blocked,true);assert.ok(gradePhoto('backdrop',backdrop.visible,0,backdrop.blocked,backdrop.lift).stars<3);
    assert.equal(gradePhoto('pigeons',birds.visible,0,birds.blocked,birds.lift).stars,0);
    for(const game of ['stamp','cash'] as const){
      const expectedFov=game==='stamp'&&aspect<1?2*Math.atan(Math.tan(Math.PI/9)*Math.max(1.7,.90/aspect))*180/Math.PI:game==='stamp'?40:42;
      const old=new PerspectiveCamera(expectedFov,aspect,.1,60);old.position.set(0,5.3,2.7);old.lookAt(0,0,.23);old.updateProjectionMatrix();old.updateMatrixWorld(true);
      const actual=dailyCamera({...view(),game},aspect);assert.deepEqual(actual.projectionMatrix.elements,old.projectionMatrix.elements);assert.deepEqual(actual.matrixWorld.elements,old.matrixWorld.elements);
    }
  }
});
