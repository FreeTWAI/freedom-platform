import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Mesh,PerspectiveCamera,Vector3} from 'three';
import {createDishModel} from '../../apps/portal-web/src/games/cooking/dish-model';
import {DISH_DESIGNS} from '../../apps/portal-web/src/games/cooking/dish-designs';
import {fitDishDefaultView} from '../../apps/portal-web/src/games/cooking/dish-stage';
import {nextDishView} from '../../apps/portal-web/src/games/cooking/dish-worker-protocol';
function cameraFor(id:string){const c=new PerspectiveCamera(34,4/3,.1,40);c.position.set(.25,7.5,7.9);c.lookAt(0,.3,0);c.zoom=id==='steak-dinner'?1.26:1.38;c.updateProjectionMatrix();c.updateMatrixWorld(true);return c;}
function extent(root:ReturnType<typeof createDishModel>['root'],camera:PerspectiveCamera){root.updateWorldMatrix(true,true);camera.updateMatrixWorld(true);let max=0,z=0,count=0;const p=new Vector3();root.traverseVisible(o=>{if(!(o instanceof Mesh))return;const a=o.geometry.getAttribute('position');for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld).project(camera);max=Math.max(max,Math.abs(p.x),Math.abs(p.y));z=Math.max(z,Math.abs(p.z));count++;}});return {max,z,count};}
test('all 66 real models fit at default pose; fitting scenes preserve camera exactly; restart/reset do not drift',()=>{
 const ids=Object.keys(DISH_DESIGNS);assert.equal(ids.length,66);const changed=[];let vertices=0;
 for(const id of ids){const model=createDishModel(id);try{model.root.rotation.y=-.12;const camera=cameraFor(id),original=camera.position.clone(),quaternion=camera.quaternion.clone(),projection=camera.projectionMatrix.clone(),before=extent(model.root,camera);vertices+=before.count;
 fitDishDefaultView(camera,model.root);const after=extent(model.root,camera);assert.ok(after.max<=1+1e-12,id+' fits XY');assert.ok(after.z<1,id+' fits near/far');assert.deepEqual(camera.quaternion.toArray(),quaternion.toArray(),id+' direction unchanged');assert.deepEqual(camera.projectionMatrix,projection,id+' zoom/fov unchanged');
 if(before.max<=1)assert.deepEqual(camera.position,original,id+' fitting camera exact');else {assert.ok(after.max<=.940000001,id+' padded');changed.push({id,before:before.max,after:after.max,retreat:camera.position.distanceTo(original)});assert.ok(new Vector3().subVectors(camera.position,original).cross(camera.getWorldDirection(new Vector3())).length()<1e-12);}
 const fitted=camera.position.clone();fitDishDefaultView(camera,model.root);assert.deepEqual(camera.position,fitted,id+' idempotent');
 let view=nextDishView({angle:0,zoom:1},'reset',0,id);for(const [kind,delta] of [['turn',1.2],['zoom',10],['turn',-.4],['zoom',-10],['reset',0]] as const)view=nextDishView(view,kind,delta,id);
 assert.deepEqual(view,{angle:-.12,zoom:id==='steak-dinner'?1.26:1.38});model.root.rotation.y=view.angle;camera.zoom=view.zoom;camera.updateProjectionMatrix();assert.deepEqual(extent(model.root,camera),after,id+' reset exact');
 const restart=cameraFor(id);fitDishDefaultView(restart,model.root);assert.deepEqual(restart.position,fitted,id+' restart exact');
 }finally{model.dispose();}}
 console.log(JSON.stringify({models:ids.length,vertices,changed}));assert.deepEqual(changed.map(v=>v.id).sort(),['pearl-milk-tea','fruit-tea','matcha-latte','yuzu-soda','banana-smoothie','hot-chocolate','ice-cream-sundae'].sort());
});
test('fit runs once at construction, not during render, view, turn, zoom or reset',()=>{const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/dish-stage.ts',import.meta.url),'utf8');assert.equal(source.split('fitDishDefaultView(camera,model.root)').length-1,1);assert.ok(source.indexOf('fitDishDefaultView(camera,model.root)')<source.indexOf('const render='));});

// Exercise the actual adapter's control closures with only the GPU boundary stubbed.
// This is deliberately not a browser/native renderer or visual acceptance test.
import * as THREE from 'three';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {foodTexture} from '../../apps/portal-web/src/games/cooking/food-kit';
test('actual stage reset/view/zoom/turn and reconstruction retain defaults without rerunning fit',()=>{
 let lastCamera:PerspectiveCamera;let lastRoot:THREE.Group;let renders=0;
 class Renderer{
  domElement=new EventTarget();shadowMap={};info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};
  setSize(){}setPixelRatio(){}dispose(){}forceContextLoss(){}
  render(scene:THREE.Scene,camera:PerspectiveCamera){lastCamera=camera;lastRoot=scene.children.find(o=>o instanceof THREE.Group) as THREE.Group;renders++;}
 }
 const module={exports:{} as any};
 const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/dish-stage.ts',import.meta.url),'utf8');
 runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require:(id:string)=>{
  if(id==='three')return {...THREE,WebGLRenderer:Renderer};if(id==='./food-studio')return {foodStudio:()=>({dispose(){}})};if(id==='./food-kit')return {foodTexture};if(id==='./dish-model')return {createDishModel};throw Error(id);
 }});
 for(const id of ['pearl-milk-tea','matcha-latte','ice-cream-sundae','steak-dinner','pesto-pasta']){
  const stage=module.exports.createDishCanvasStage({},1,id,()=>{});const c=lastCamera!,root=lastRoot!,position=c.position.clone(),initial=extent(root,c);assert.equal(c.zoom,id==='steak-dinner'?1.26:1.38);
  stage.turn(.4);assert.ok(Math.abs(root.rotation.y-.28)<1e-12);stage.zoom(9);assert.equal(c.zoom,1.7);stage.zoom(-9);assert.equal(c.zoom,.8);stage.view(.7,1.5);assert.equal(root.rotation.y,.7);assert.equal(c.zoom,1.5);
  const count=renders;stage.turn(NaN);stage.zoom(Infinity);stage.view(NaN,1);assert.equal(renders,count);stage.reset();assert.equal(root.rotation.y,-.12);assert.equal(c.zoom,id==='steak-dinner'?1.26:1.38);assert.deepEqual(c.position,position);assert.deepEqual(extent(root,c),initial);
  stage.reset();assert.deepEqual(c.position,position);stage.dispose();stage.dispose();const stopped=renders;stage.turn(.2);stage.zoom(.1);stage.view(0,1);assert.equal(renders,stopped);
  const restarted=module.exports.createDishCanvasStage({},1,id,()=>{});assert.deepEqual(lastCamera!.position,position);assert.deepEqual(extent(lastRoot!,lastCamera!),initial);restarted.dispose();
 }
});

test('hot chocolate has brown liquid below cream marshmallows; matcha foam remains unchanged',()=>{
 for(const id of ['hot-chocolate','matcha-latte']){
  const model=createDishModel(id);try{model.root.updateWorldMatrix(true,true);
   const colorAt=(x:number,z:number)=>{const hit=new THREE.Raycaster(new Vector3(x,5,z),new Vector3(0,-1,0)).intersectObject(model.root,true)[0];assert.ok(hit);const mesh=hit.object as THREE.Mesh;assert.ok(!Array.isArray(mesh.material));return (mesh.material as THREE.MeshPhysicalMaterial).color.getHexString();};
   assert.equal(colorAt(.65,0),id==='hot-chocolate'?'8a6048':DISH_DESIGNS[id].top.slice(1),'visible liquid/foam material');
   if(id==='hot-chocolate')assert.equal(colorAt(-.35,-.2),'ede0bd','marshmallow remains cream');
  }finally{model.dispose();}
 }
});

test('invalid, unsupported or far-plane-infeasible geometry cannot move the camera to a blank view',()=>{
 for(const kind of ['nan','infinity','instance','skin','morph','far','projection']){
  const root=new THREE.Group(),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,20,0,1,20,0,0,21,0],3));
  const material=new THREE.MeshBasicMaterial();const mesh=kind==='instance'?new THREE.InstancedMesh(geometry,material,1):kind==='skin'?new THREE.SkinnedMesh(geometry,material):new THREE.Mesh(geometry,material);root.add(mesh);
  if(kind==='nan'||kind==='infinity')geometry.getAttribute('position').setX(0,kind==='nan'?NaN:Infinity);if(kind==='morph')geometry.morphAttributes.position=[geometry.getAttribute('position').clone()];
  const camera=cameraFor('hot-chocolate');if(kind==='far'){camera.far=12;camera.updateProjectionMatrix();}if(kind==='projection')camera.projectionMatrix.elements[0]=NaN;
  const before=camera.position.clone();fitDishDefaultView(camera,root);assert.deepEqual(camera.position,before,kind);assert.ok(camera.position.toArray().every(Number.isFinite));geometry.dispose();material.dispose();
 }
});
