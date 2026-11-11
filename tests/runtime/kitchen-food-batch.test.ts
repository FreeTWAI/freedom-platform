import * as presentationHelpers from '../../apps/portal-web/src/games/cooking/kitchen-presentation';
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import {createHash} from 'node:crypto';import {transformSync} from 'esbuild';import * as T from 'three';import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {kitchenPresentation} from '../../apps/portal-web/src/games/cooking/kitchen-stage';
import * as preparation from '../../apps/portal-web/src/games/cooking/preparation-model';
import * as ingredients from '../../apps/portal-web/src/games/cooking/ingredient-visuals';
import * as React from 'react';import * as jsxRuntime from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';import * as cues from '../../apps/portal-web/src/games/cooking/cues';
import {createKitchenFoodBatch} from '../../apps/portal-web/src/games/cooking/kitchen-food-batch';import {bakeRigidGroup} from '../../apps/portal-web/src/games/stage-batch';import * as domain from '../../apps/portal-web/src/games/cooking/domain';import * as catalog from '../../apps/portal-web/src/games/cooking/catalog';

for(const kind of ['slice','fold','plate','pour'] as const)test(`${kind} retains identical idle geometry and redraws actual progress`,()=>{
 const f=factory(true),recipe=catalog.RECIPES.find(r=>r.steps.some(s=>s.kind===kind))!;
 let run={...domain.newCookingRun(recipe,42,'idle-frame'),step:recipe.steps.findIndex(s=>s.kind===kind),status:'playing' as const,elapsed:1000};
 try{
  f.stage.update(run,null,1000,true);const initial=snapshot(f.scene());assert.equal(f.renders(),1);
  for(const time of [2000,3000]){run={...run,elapsed:time};f.stage.update(run,null,time,true);assert.deepEqual(snapshot(f.scene()),initial);}
  assert.equal(f.renders(),1,'unchanged visible geometry does not rasterize again');
  run={...run,active:{...run.active,count:1,amount:.2,lastAt:run.elapsed}};
  f.stage.update(run,null,3016,true);assert.equal(f.renders(),2);assert.notDeepEqual(snapshot(f.scene()),initial);
  if(kind==='slice'){f.stage.update(run,{x:.8,y:.4},3032,true);assert.equal(f.renders(),3,'the knife follows its current pointer');}
  const other=catalog.RECIPES.find(r=>r.id!==recipe.id&&r.steps.some(s=>s.kind==='mix'))!;
  f.stage.update({...domain.newCookingRun(other,42,'other'),step:other.steps.findIndex(s=>s.kind==='mix')},null,4000,true);
  const before=f.renders();f.stage.update(run,null,4016,true);assert.equal(f.renders(),before+1,'rebuilding the original scene cannot reuse an old framebuffer');
 }finally{f.stage.dispose();}
});
function fixture(){const parent=new T.Group(),geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial(),copies=Array.from({length:5},(_,i)=>{const root=new T.Group();root.position.set(i*2,.3,-i);root.rotation.set(.1*i,.2*i,.3*i);root.scale.setScalar(1.4);const part=new T.Mesh(geometry.clone(),material);part.position.set(.2,.4,.1);part.rotation.z=.2;part.scale.set(.4,.7,.8);part.castShadow=part.receiveShadow=true;root.add(part);parent.add(root);return root;});return {parent,copies,material};}
test('shared opaque food preserves world vertices and normals for moving uniform roots',()=>{const {parent,copies}=fixture();parent.updateMatrixWorld(true);const originals=copies.map(r=>r.children[0] as T.Mesh),expected=originals.map(m=>m.matrixWorld.clone()),batch=createKitchenFoodBatch(parent,copies)!;assert.ok(batch);assert.equal(batch.meshes.length,1);assert.equal(batch.meshes[0].count,5);parent.updateMatrixWorld(true);copies.forEach((_,i)=>{const m=new T.Matrix4();batch.meshes[0].getMatrixAt(i,m);const world=new T.Matrix4().multiplyMatrices(batch.meshes[0].matrixWorld,m),g=originals[i].geometry;for(let j=0;j<g.attributes.position.count;j++){const p=new T.Vector3().fromBufferAttribute(g.attributes.position,j),n=new T.Vector3().fromBufferAttribute(g.attributes.normal,j);assert.ok(p.clone().applyMatrix4(world).distanceTo(p.clone().applyMatrix4(expected[i]))<2e-6);assert.ok(n.clone().applyMatrix3(new T.Matrix3().getNormalMatrix(world)).normalize().distanceTo(n.clone().applyMatrix3(new T.Matrix3().getNormalMatrix(expected[i])).normalize())<2e-6);}});batch.dispose();});
test('unsupported bytes, material identity, transparency, shader, scale and shadow configuration reject without mutation',()=>{const changes:Array<(x:ReturnType<typeof fixture>)=>void>=[x=>(x.copies[1].children[0] as T.Mesh).geometry.attributes.position.setX(0,.6),x=>{(x.copies[1].children[0] as T.Mesh).material=x.material.clone();},x=>{x.material.transparent=true;},x=>{x.material.onBeforeCompile=()=>{};},x=>{x.copies[1].scale.y=.8;},x=>{x.copies[1].scale.x=-1;},x=>{(x.copies[1].children[0] as T.Mesh).castShadow=false;}];for(const change of changes){const x=fixture();change(x);assert.equal(createKitchenFoodBatch(x.parent,x.copies),null);assert.equal(x.parent.children.length,5);x.copies.forEach(r=>assert.equal(r.children[0].visible,true));}});
test('dynamic fallback, compact visibility, bounds and idempotent cleanup preserve shared ownership',()=>{const {parent,copies,material}=fixture(),geometry=(copies[0].children[0] as T.Mesh).geometry,batch=createKitchenFoodBatch(parent,copies)!;let shared=0,disposed=0;geometry.addEventListener('dispose',()=>shared++);material.addEventListener('dispose',()=>shared++);batch.meshes[0].addEventListener('dispose',()=>disposed++);copies[0].scale.y=.7;batch.update();assert.equal(batch.meshes[0].visible,false);copies.forEach(r=>assert.equal(r.children[0].visible,true));copies[0].scale.setScalar(1.4);copies.forEach(r=>r.visible=false);batch.update();assert.equal(batch.meshes[0].count,0);copies[4].visible=true;copies[4].position.set(19,7,4);batch.update();assert.equal(batch.meshes[0].count,1);assert.ok(batch.meshes[0].boundingBox!.max.x>19);batch.dispose();batch.dispose();batch.update();assert.equal(disposed,1);assert.equal(shared,0);assert.equal(parent.children.length,5);});
// Actual factory/update logic, GPU/DOM boundary only stubbed. Disabled batch is a task-shaped negative control.
function factory(optimized:boolean,stepOverride?:catalog.CookingStep){let scene:T.Scene,camera:T.OrthographicCamera,renders=0,captureError=false;const sizes:number[][]=[],pixelRatios:number[]=[];const extrusions:T.ExtrudeGeometry[]=[];function observedExtrusion(...args:ConstructorParameters<typeof T.ExtrudeGeometry>){const geometry=new T.ExtrudeGeometry(...args);extrusions.push(geometry);return geometry;}class Renderer{domElement={setAttribute(){},addEventListener(){},removeEventListener(){},remove(){},toDataURL(){if(captureError)throw Error('capture unavailable');return 'data:image/png;base64,fixture';}};shadowMap={};info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};setSize(w:number,h:number){sizes.push([w,h]);}setPixelRatio(value:number){pixelRatios.push(value);}dispose(){}forceContextLoss(){}render(s:T.Scene,c:T.OrthographicCamera){camera=c.clone();renders++;scene=s;s.updateMatrixWorld(true);}}const module={exports:{} as any};const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/kitchen-stage.ts',import.meta.url),'utf8');runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,devicePixelRatio:1,require:(id:string)=>{if(id==='three')return {...T,WebGLRenderer:Renderer,ExtrudeGeometry:observedExtrusion};if(id.includes('RoundedBox'))return {RoundedBoxGeometry};if(id==='../stage-batch')return {bakeRigidGroup};if(id==='./kitchen-food-batch')return {createKitchenFoodBatch:optimized?createKitchenFoodBatch:()=>null};if(id==='./dish-model')return {createDishModel(){throw Error('not used');}};if(id==='./domain')return stepOverride?{...domain,currentStep:()=>stepOverride}:domain;if(id==='./kitchen-presentation')return presentationHelpers;if(id==='./catalog')return catalog;if(id==='./ingredient-visuals')return ingredients;if(id==='./preparation-model')return preparation;throw Error(id);}});return {stage:module.exports.createKitchenStage({append(){}},()=>{}),scene:()=>scene!,renders:()=>renders,camera:()=>camera!,failCapture:()=>{captureError=true;},sizes,pixelRatios,extrusions};}
function snapshot(scene:T.Scene){const values:{key:string;matrix:number[]}[]=[];let draws=0;scene.updateMatrixWorld(true);scene.traverseVisible(o=>{if(!(o instanceof T.Mesh))return;draws++;const hash=createHash('sha256');for(const name of Object.keys(o.geometry.attributes).sort()){const a=o.geometry.attributes[name] as T.BufferAttribute;hash.update(name).update(new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength));}if(o.geometry.index){const a=o.geometry.index.array;hash.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));}const m=o.material as T.MeshStandardMaterial,key=hash.digest('hex')+m.color.getHexString()+`/${o.castShadow}/${o.receiveShadow}/${o.layers.mask}/${o.renderOrder}`;if(o instanceof T.InstancedMesh){for(let i=0;i<o.count;i++){const matrix=new T.Matrix4();o.getMatrixAt(i,matrix);values.push({key,matrix:new T.Matrix4().multiplyMatrices(o.matrixWorld,matrix).toArray()});}}else values.push({key,matrix:o.matrixWorld.toArray()});});values.sort((a,b)=>a.key.localeCompare(b.key)||a.matrix[12]-b.matrix[12]||a.matrix[13]-b.matrix[13]||a.matrix[14]-b.matrix[14]);return {values,draws};}
test('real pan/boil heat, toss and steam frames preserve expanded geometry/material/transforms with fewer draws',()=>{for(const [id,kind,before,after] of [['egg-fried-rice','pan',39,27],['pearl-milk-tea','boil',37,31]] as const){const recipe=catalog.recipeOf(id)!,step=recipe.steps.findIndex(s=>s.kind===kind),original=factory(false),candidate=factory(true);let run={...domain.newCookingRun(recipe,42,'oracle'),step,status:'playing' as const};for(const [i,time] of [1000,1100,1250,1500].entries()){run={...run,elapsed:time,active:{...run.active,amount:i*.2,heat:40+i*10,foam:i*.15,flipped:i>0,lastAt:1100}};original.stage.update(run,null,time,true);candidate.stage.update(run,null,time,true);const a=snapshot(original.scene()),b=snapshot(candidate.scene());assert.equal(a.draws,before);assert.equal(b.draws,after);assert.equal(a.values.length,b.values.length);for(let j=0;j<a.values.length;j++){assert.equal(a.values[j].key,b.values[j].key);a.values[j].matrix.forEach((n,k)=>assert.ok(Math.abs(n-b.values[j].matrix[k])<2e-6,`${id}/${i}/${j}/${k}`));}}original.stage.dispose();candidate.stage.dispose();}});
test('special attribute layouts and material render hooks fail closed',()=>{
 for(const special of ['instanced','float16','gpu-type','material-hook'] as const){const x=fixture();if(special==='material-hook')x.material.onBeforeRender=()=>{};else for(const [i,root] of x.copies.entries()){const geometry=(root.children[0] as T.Mesh).geometry,a=geometry.getAttribute('position');if(special==='instanced')geometry.setAttribute('position',new T.InstancedBufferAttribute(new Float32Array(a.array),3));if(special==='float16')geometry.setAttribute('position',new T.Float16BufferAttribute(Array.from(a.array),3));if(special==='gpu-type'&&i===1)(a as T.BufferAttribute).gpuType=T.IntType;}
 assert.equal(createKitchenFoodBatch(x.parent,x.copies),null,special);assert.equal(x.parent.children.length,5);x.copies.forEach(root=>assert.equal(root.children[0].visible,true));}
});
test('manual root and part matrices survive rejected eligibility and dynamic fallback unchanged',()=>{
 for(const target of ['root','part'] as const){const x=fixture(),o=target==='root'?x.copies[2]:x.copies[2].children[0];o.matrixAutoUpdate=false;o.matrix.makeTranslation(91,23,-18);const before=o.matrix.clone();assert.equal(createKitchenFoodBatch(x.parent,x.copies),null);assert.deepEqual(o.matrix,before);assert.equal(o.visible,true);}
 const x=fixture(),batch=createKitchenFoodBatch(x.parent,x.copies)!;x.copies[1].matrixAutoUpdate=false;x.copies[1].matrix.makeTranslation(77,33,11);const before=x.copies[1].matrix.clone();batch.update();assert.deepEqual(x.copies[1].matrix,before);assert.equal(batch.meshes[0].visible,false);batch.dispose();
});

test('manual world matrices are never replaced by reconstructed instance transforms',()=>{for(const target of ['root','part'] as const){const x=fixture(),o=target==='root'?x.copies[1]:x.copies[1].children[0];o.matrixWorldAutoUpdate=false;o.matrixWorld.makeTranslation(45,-20,11);const before=o.matrixWorld.clone();assert.equal(createKitchenFoodBatch(x.parent,x.copies),null);assert.deepEqual(o.matrixWorld,before);}const x=fixture(),batch=createKitchenFoodBatch(x.parent,x.copies)!;x.copies[0].matrixWorldAutoUpdate=false;x.copies[0].matrixWorld.makeTranslation(45,-20,11);const before=x.copies[0].matrixWorld.clone();batch.update();assert.equal(batch.meshes[0].visible,false);assert.deepEqual(x.copies[0].matrixWorld,before);batch.dispose();});

// Exercise the real factory across identities: palette materials survive scene rebuilds.
test('stage culling keeps open vessels and shared materials two-sided, preserves shadows and resets on exit',()=>{
 const f=factory(true),seen=new Set<T.MeshStandardMaterial>();
 try{
  for(const kind of ['slice','mix','knead','pan','boil','bake','pour','boil','mix','fold'] as const){
   const recipe=catalog.RECIPES.find(r=>r.steps.some(s=>s.kind===kind))!,step=recipe.steps.findIndex(s=>s.kind===kind);
   const run={...domain.newCookingRun(recipe,42,'material_transition'),step,status:'playing' as const};
   f.stage.update(run,null,1000,true);
   const culled=kind==='pan'||kind==='boil'||kind==='bake'||kind==='mix'||kind==='knead';let closed=0,open=0;
   f.scene().traverse(o=>{
    if(!(o instanceof T.Mesh))return;
    for(const material of Array.isArray(o.material)?o.material:[o.material]){
     const m=material as T.MeshStandardMaterial;seen.add(m);
     // Vessel palette entries are also shared by closed scene/tool parts.
     const vessel=(kind==='boil'&&m.color.getHexString()==='e87455')||(kind==='mix'&&m.color.getHexString()==='78b9a5');
     assert.equal(m.side,culled&&!vessel?T.FrontSide:T.DoubleSide,`${kind}/${m.color.getHexString()}`);
     if(culled&&!vessel){assert.equal(m.shadowSide,T.DoubleSide,'culled surfaces retain two-sided shadow casting');closed++;}
     if(vessel)open++;
    }
   });
   if(culled)assert.ok(closed>0,'closed surfaces actually exercise culling');
   if(kind==='boil'||kind==='mix')assert.ok(open>0,'open vessel/shared material is present after batching');
   if(!culled)for(const m of seen)assert.equal(m.side,T.DoubleSide,'leaving culled stages resets even retained palette entries');
  }
 }finally{f.stage.dispose();}
});


test('mix redraws changed gestures and rebuilt scenes but retains identical frames',()=>{
 const f=factory(true),recipe=catalog.recipeOf('rice-balls')!;
 let run={...domain.newCookingRun(recipe,42,'mix_frames'),status:'playing' as const};
 try{
  f.stage.update(run,null,1000,true);assert.equal(f.renders(),1);const initial=snapshot(f.scene());
  run={...run,elapsed:2000};f.stage.update(run,null,2000,true);assert.equal(f.renders(),1);assert.deepEqual(snapshot(f.scene()),initial);
  f.stage.update(run,{x:.8,y:.52},2016,true);assert.equal(f.renders(),2);
  f.stage.update(run,{x:.8,y:.52},2032,false);assert.equal(f.renders(),2);
  run={...run,active:{...run.active,amount:Math.PI/2}};f.stage.update(run,{x:.8,y:.52},2048,true);assert.equal(f.renders(),3);
  f.stage.update(run,{x:.5,y:.82},2064,true);assert.equal(f.renders(),4);
  f.stage.update(run,null,2080,true);assert.equal(f.renders(),5,'release restores the spoon pose');
  f.stage.update({...run,status:'paused'},null,2096,true);assert.equal(f.renders(),5);
  f.stage.update({...run,step:1},null,2112,true);assert.equal(f.renders(),6);
  f.stage.update(run,null,2128,true);assert.equal(f.renders(),7,'returning to mix renders its rebuilt scene');
  f.stage.update({...run,active:{...run.active,amount:0}},null,2144,true);assert.equal(f.renders(),8,'restart angle renders');
 }finally{f.stage.dispose();f.stage.dispose();}
});


test('knead redraws pressure, release and motion changes while identical resting poses stay presented',()=>{
 const f=factory(true),recipe=catalog.recipeOf('rice-balls')!;
 const run={...domain.newCookingRun(recipe,42,'knead_frames'),step:1,status:'playing' as const,elapsed:1000};
 try{
  f.stage.update(run,null,1000,true);assert.equal(f.renders(),1);
  f.stage.update({...run,elapsed:1100},null,1100,true);assert.equal(f.renders(),1);
  const held={...run,active:{...run.active,holdAt:1000}};
  f.stage.update({...held,elapsed:1375},null,1375,true);assert.equal(f.renders(),2);
  f.stage.update({...held,elapsed:1750},null,1750,true);assert.equal(f.renders(),3);
  f.stage.update({...held,elapsed:1750},null,1750,false);assert.equal(f.renders(),4);
  f.stage.update({...run,elapsed:1800},null,1800,true);assert.equal(f.renders(),5,'cancel/release returns to rest');
  f.stage.update({...held,elapsed:1375},null,1375,true);assert.equal(f.renders(),6,'repeated hold renders pressure again');
 }finally{f.stage.dispose();}
});

const ingredientSteps=catalog.RECIPES.flatMap(recipe=>recipe.steps.flatMap((step,index)=>ingredients.ingredientVisual(step.ingredient,step.shape)?[{recipe,step,index}]:[]));
function ingredientRoots(scene:T.Scene){const roots:T.Group[]=[];scene.traverse(o=>{if(o instanceof T.Group&&o.name.startsWith('ingredient/'))roots.push(o);});return roots;}
function resources(scene:T.Object3D){const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();scene.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});return {geometries,materials};}

test('real ingredient meshes use shared contours, bounded opaque parts and no per-frame resources',()=>{
 for(const {recipe,step,index} of ingredientSteps){
  if(step.kind==='slice'&&preparation.isVolumetricPreparation(ingredients.ingredientVisual(step.ingredient,step.shape)!.id))continue;
  const f=factory(true),run={...domain.newCookingRun(recipe,42,'ingredient_mesh'),step:index,status:'playing' as const};
  try{
   f.stage.update(run,null,1000,false);const visual=ingredients.ingredientVisual(step.ingredient,step.shape)!,roots=ingredientRoots(f.scene());
   assert.equal(roots.length,step.goal+(step.kind==='plate'?1:0));
   const layers=[...visual.layers,...(visual.cutLayers??[])];
   assert.equal(f.extrusions.length,layers.length,'both states share raw contour geometry across all copies');
   f.extrusions.forEach((geometry,i)=>{
    const contour=geometry.parameters.shapes as T.Shape,points=contour.getPoints();
    assert.deepEqual(points.slice(0,layers[i].points.length).map(p=>[p.x,p.y]),layers[i].points.map(([x,y])=>[x*.3,-y*.3]));
    geometry.computeBoundingBox();assert.ok(geometry.boundingBox!.min.z>=0&&geometry.boundingBox!.max.z<.071);
   });
   for(const root of roots){
    const variants=visual.cutLayers?root.children:[root];
    if(visual.cutLayers)assert.equal(variants.length,2,'whole and cut remain independently switchable groups');
    variants.forEach((variant,i)=>{const stateLayers=i===1?visual.cutLayers!:visual.layers;assert.equal(variant.children.length,new Set(stateLayers.map(layer=>layer.color)).size,'same-color details are rigidly batched within each variant');assert.ok(variant.children.length<=4);});
    root.traverse(o=>{if(o instanceof T.Mesh){const m=o.material as T.MeshStandardMaterial;assert.equal(m.transparent,false);assert.equal(m.map,null);assert.equal(m.roughness,1);assert.equal(m.side,T.DoubleSide);const positions=o.geometry.getAttribute('position');for(const value of positions.array)assert.ok(Number.isFinite(value));o.updateMatrix();for(let i=0;i<positions.count;i++){const p=new T.Vector3().fromBufferAttribute(positions,i).applyMatrix4(o.matrix);assert.ok(Math.abs(p.x)<=.301&&Math.abs(p.z)<=.301&&p.y>=.059&&p.y<=.281,'extruded and batched pieces stay inside the original food footprint');}}});
   }
   const before=resources(f.scene()),extrusions=f.extrusions.length,renders=f.renders();
   f.stage.update({...run,elapsed:2000},null,2000,false);assert.equal(f.renders(),renders);assert.deepEqual(resources(f.scene()),before);
   f.stage.update({...run,elapsed:2016,active:{...run.active,count:1}}, {x:.7,y:.6},2016,false);
   assert.equal(f.renders(),renders+1);assert.deepEqual(resources(f.scene()),before);assert.equal(f.extrusions.length,extrusions);
  }finally{f.stage.dispose();}
 }
});

test('ingredient heat is isolated, batches preserve real geometry and all step resources dispose once',()=>{
 // Explicit presentation fixture: current catalog uses these fruits in slice/plate.
 // Project a real banana step into the existing pan renderer to cover its heat/batch branch.
 const recipe=catalog.recipeOf('banana-smoothie')!,step={...recipe.steps[0],kind:'pan' as const},original=factory(false,step),candidate=factory(true,step);
 const run={...domain.newCookingRun(recipe,42,'ingredient_heat'),status:'playing' as const};
 const disposed=new Map<T.BufferGeometry|T.Material,number>();
 const track=(resource:T.BufferGeometry|T.Material)=>{if(!disposed.has(resource)){disposed.set(resource,0);resource.addEventListener('dispose',()=>disposed.set(resource,disposed.get(resource)!+1));}};
 try{
  for(const f of [original,candidate])f.stage.update(run,null,1000,false);
  const roots=ingredientRoots(candidate.scene()),foodMaterials=new Set<T.MeshStandardMaterial>();
  roots.forEach(root=>root.traverse(o=>{if(o instanceof T.Mesh)foodMaterials.add(o.material as T.MeshStandardMaterial);}));
  const baseColors=new Map([...foodMaterials].map(m=>[m,m.color.clone()])),otherMaterials=new Map<T.MeshStandardMaterial,string>();
  candidate.scene().traverse(o=>{if(o instanceof T.Mesh){const material=o.material as T.MeshStandardMaterial;if(!foodMaterials.has(material))otherMaterials.set(material,material.color.getHexString());}});
  candidate.extrusions.forEach(track);roots.forEach(root=>root.traverse(o=>{if(o instanceof T.Mesh){track(o.geometry);track(o.material as T.Material);}}));
  const before=resources(candidate.scene()),extrusions=candidate.extrusions.length;
  for(const [i,amount] of [0,.7,1.1,0].entries()){
   const frame={...run,elapsed:1000+i*100,active:{...run.active,amount,flipped:i>0,lastAt:1000}};
   original.stage.update(frame,null,frame.elapsed,true);candidate.stage.update(frame,null,frame.elapsed,true);
   const a=snapshot(original.scene()),b=snapshot(candidate.scene());
   assert.ok(b.draws<a.draws);assert.equal(a.values.length,b.values.length);
   a.values.forEach((value,j)=>{assert.equal(value.key,b.values[j].key);value.matrix.forEach((n,k)=>assert.ok(Math.abs(n-b.values[j].matrix[k])<2e-6));});
   for(const [material,base] of baseColors){assert.equal(material.color.getHexString(),base.clone().lerp(new T.Color(amount>1?'#805335':'#bd864b'),Math.min(.7,amount*.4)).getHexString());assert.equal(material.side,T.FrontSide);assert.equal(material.shadowSide,T.DoubleSide);}
   for(const [material,color] of otherMaterials)assert.equal(material.color.getHexString(),color,'cookware cannot share the heated food palette');
   assert.deepEqual(resources(candidate.scene()),before);assert.equal(candidate.extrusions.length,extrusions);
  }
  // An identity transition rebuilds and releases the prior ingredient assets.
  candidate.stage.update({...run,step:1},null,2000,false);
  for(const count of disposed.values())assert.equal(count,1);
  const fresh=ingredientRoots(candidate.scene());assert.ok(fresh.length>0);
  fresh.forEach(root=>root.traverse(o=>{if(o instanceof T.Mesh){const m=o.material as T.MeshStandardMaterial;assert.ok(!foodMaterials.has(m));assert.ok([...baseColors.values()].some(color=>color.equals(m.color)));}}));
 }finally{original.stage.dispose();candidate.stage.dispose();candidate.stage.dispose();}
 for(const count of disposed.values())assert.equal(count,1,'disposal is not repeated at stage teardown');
});

function svgScene(){
 const module={exports:{} as {CookingScene:React.ComponentType<any>}};
 const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/CookingIllustration.tsx',import.meta.url),'utf8');
 runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,require:(id:string)=>{
  if(id==='react/jsx-runtime')return jsxRuntime;
  if(id==='./ingredient-visuals')return ingredients;if(id==='./preparation-model')return preparation;
  if(id==='./cues')return cues;
  if(id==='./domain')return domain;
  throw Error(id);
 }});
 return (run:domain.CookingRun)=>renderToStaticMarkup(React.createElement(module.exports.CookingScene,{run,point:null,onPointerDown(){},onPointerMove(){},onPointerUp(){},onPointerCancel(){}}));
}
test('real SVG fallback renders the same filled ingredient contours and retains the unknown glyph',()=>{
 const render=svgScene();
 for(const {recipe,step,index} of ingredientSteps){
  const run={...domain.newCookingRun(recipe,42,'ingredient_svg'),step:index,status:'playing' as const};
  run.active={...run.active,count:step.kind==='plate'?1:0};
  const html=render(run),visual=ingredients.ingredientVisual(step.ingredient,step.shape)!,copies=step.kind==='plate'?2:step.goal;
  const polygons=[...html.matchAll(/<polygon points="([^"]*)" fill="([^"]*)"/g)];
  assert.equal(polygons.length,copies*visual.layers.length);
  polygons.forEach((polygon,i)=>{const layer=visual.layers[i%visual.layers.length];assert.equal(polygon[1],ingredients.ingredientPolygonPoints(layer.points));assert.equal(polygon[2],layer.color);});
  assert.ok(html.includes(`${step.title}操作區`));assert.ok(html.includes(step.ingredient));
 }
 const recipe=catalog.recipeOf('tomato-spaghetti')!,html=render({...domain.newCookingRun(recipe,42,'ingredient_unknown'),status:'playing'});
 assert.ok(html.includes('番茄與蒜'));assert.equal(html.includes('data-ingredient='),false);
 assert.ok(html.includes('M-26-18Q-1-32 24-18L3 32Q-4 40-10 26Z'),'unmapped composite keeps the existing generic fruit');
});

// Four new solids intentionally no longer share the SVG fallback's flat contours.
test('single volumetric foods partition exactly at guide planes with bounded resources',()=>{
 for(const id of preparation.VOLUMETRIC_PREPARATION_IDS){
  const owned=new Set<T.BufferGeometry>(),materials=new Map<string,T.MeshStandardMaterial>(),planes=Array.from({length:7},(_,i)=>id==='mushroom'?-1.86+3.72*(i+1)/8:9.3*(-.28+.56*(i+1)/8));
  const model=preparation.createPreparationModel(id,planes,owned,materials);
  try{
   assert.equal(model.segments.length,8);assert.equal(model.root.name,`ingredient/${id}`);assert.ok(owned.size<=26);assert.ok(materials.size<=4);
   const bounds=new T.Box3().setFromObject(model.root),size=bounds.getSize(new T.Vector3());assert.ok(id==='mushroom'?size.x>3.719&&size.x<3.721:size.x>5);assert.ok(size.y>.5&&size.z>1.3);assert.ok(bounds.min.y>=.249);
   model.root.traverse(o=>{if(o instanceof T.Mesh){assert.ok(owned.has(o.geometry));for(const v of o.geometry.getAttribute('position').array)assert.ok(Number.isFinite(v));assert.equal((o.material as T.MeshStandardMaterial).map,null);}});
   for(let i=0;i<7;i++){
    const a=model.faces[i].right.geometry.getAttribute('position'),b=model.faces[i+1].left.geometry.getAttribute('position');
    for(const [mesh,position] of [[model.faces[i].right,a],[model.faces[i+1].left,b]] as const)for(let n=0;n<position.count;n++)assert.ok(Math.abs(position.getX(n)+mesh.parent!.position.x-planes[i])<(id==='pumpkin'&&n>=1320?.00601:1e-6),'the flesh lies on the knife plane; only raised seeds stand .006 above it');
   }
   const refs=resources(model.root);for(const count of [...Array.from({length:8},(_,i)=>i),0]){model.update(count);model.faces.forEach((f,i)=>{assert.equal(f.left.visible,i>0&&i<=count);assert.equal(f.right.visible,i<count);assert.equal(model.segments[i].position.z,i<count?.65:0);});assert.deepEqual(resources(model.root),refs);
    model.root.updateMatrixWorld(true);const world=new T.Box3().setFromObject(model.root,true);assert.ok(world.min.x>=-3.05&&world.max.x<=3.05,`${id}/${count}: slices remain across the board`);assert.ok(world.min.z>=-2&&world.max.z<=2.2,`${id}/${count}: slices remain within board depth`);assert.ok(world.min.y>=.249);
    const intervals=model.segments.map((segment,i)=>{let min=Infinity,max=-Infinity;segment.traverse(o=>{if(o instanceof T.Mesh){const a=o.geometry.getAttribute('position');for(let j=0;j<a.count;j++){const v=new T.Vector3().fromBufferAttribute(a,j).applyMatrix4(o.matrixWorld);const x=i<count?v.x+.15*(v.y-.25):v.x;min=Math.min(min,x);max=Math.max(max,x);}}});return {min,max};});
    for(let i=0;i<count;i++){const contact=new T.Box3().setFromObject(model.segments[i],true);assert.ok(Math.abs(contact.min.y-.25)<1e-6,`${id}/${count}/${i}: every separated slice rests on the board`);const facing=new T.Vector3(1,0,0).applyNormalMatrix(new T.Matrix3().getNormalMatrix(model.segments[i].matrixWorld));assert.ok(facing.dot(new T.Vector3(0,1,1).normalize())>.1,'leaned flesh face points toward the actual oblique camera');}
    for(let i=0;i<count-1;i++)assert.ok(intervals[i].max<intervals[i+1].min,`${id}/${count}: parallel leaned slice volumes do not intersect`);
    if(count>0&&count<model.segments.length){const cutBounds=new T.Box3().setFromObject(model.segments[count-1],true),uncutBounds=new T.Box3().setFromObject(model.segments[count],true);assert.ok(cutBounds.max.x<uncutBounds.min.x,`${id}/${count}: separated slice does not intersect uncut body`);}
   }
  }finally{owned.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 }
});

test('accepted domain cuts separate one hero segment; rejected cuts and time never do; lifecycle releases all assets once',()=>{
 const covered=new Set<string>();
 for(const {recipe,step,index} of ingredientSteps){
  const visual=ingredients.ingredientVisual(step.ingredient,step.shape)!;if(step.kind!=='slice'||!preparation.isVolumetricPreparation(visual.id))continue;
  covered.add(recipe.id);const f=factory(true);let run=domain.actCooking({...domain.newCookingRun(recipe,42,'hero-cut'),step:index},{kind:'start',step:index},1000);
  const disposed=new Map<T.BufferGeometry|T.Material,number>();const track=(root:T.Object3D)=>root.traverse(o=>{if(o instanceof T.Mesh)for(const r of [o.geometry,...(Array.isArray(o.material)?o.material:[o.material])])if(!disposed.has(r)){disposed.set(r,0);r.addEventListener('dispose',()=>disposed.set(r,disposed.get(r)!+1));}});
  try{
   f.stage.update(run,null,1000,false);const roots=ingredientRoots(f.scene());assert.equal(roots.length,1,'one dominant food, not a row of small whole foods');const root=roots[0];track(root);const refs=resources(root);assert.equal(f.extrusions.length,0);
   const segments=root.children.filter(o=>o.name.startsWith('preparation/segment/'));assert.equal(segments.length,step.goal+1);
   const camera=new T.OrthographicCamera(-4.65,4.65,3.255,-3.255,.1,40);camera.position.set(0,8.5,8.5);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
   for(let count=0;count<step.goal;count++){const face=segments[count].getObjectByName('preparation/right-face') as T.Mesh;const x=face.geometry.getAttribute('position').getX(0)+segments[count].position.x;const screen=new T.Vector3(x,.3,0).project(camera);assert.ok(Math.abs((screen.x+1)/2-domain.cutGuide({...run,active:{...run.active,count}}))<1e-6);}
   run=domain.actCooking(run,{kind:'cut',step:index,x1:0,y1:0,x2:0,y2:0},1200);assert.equal(run.active.count,0);f.stage.update(run,null,1200,false);assert.ok(segments.every(g=>g.position.z===0));assert.ok(segments.every(g=>!g.getObjectByName('preparation/left-face')!.visible&&!g.getObjectByName('preparation/right-face')!.visible),'all internal faces remain hidden before an accepted cut');
   run=domain.actCooking(run,{kind:'cut-key',step:index},1500);assert.equal(run.active.count,1);f.stage.update(run,null,1500,false);assert.equal(segments[0].position.z,.65);assert.equal(segments[1].position.z,0);assert.equal(segments[0].getObjectByName('preparation/right-face')!.visible,true);assert.equal(segments[1].getObjectByName('preparation/left-face')!.visible,true);
   const before=snapshot(f.scene()),renderCount=f.renders();f.stage.update({...run,status:'paused',elapsed:9000},null,9000,false);assert.equal(f.renders(),renderCount,'elapsed time alone must not redraw static cuts');assert.deepEqual(snapshot(f.scene()),before);assert.deepEqual(resources(root),refs);
   f.stage.update({...run,step:index+1},null,10000,false);for(const count of disposed.values())assert.equal(count,1);
   f.stage.update({...run,status:'playing'},null,11000,false);ingredientRoots(f.scene()).forEach(track);
  }finally{f.stage.dispose();f.stage.dispose();}for(const count of disposed.values())assert.equal(count,1);
 }
 assert.ok(covered.size>=5,'hero lifecycle must cover at least five actual recipe steps');assert.deepEqual([...covered].sort(),['baked-sweet-potato','cream-risotto','fish-and-chips','plant-burger','pumpkin-soup'].sort());
});

test('all five real preparations keep the connected remainder on the board and lower the knife with it',()=>{
 const covered=new Set<string>();
 for(const {recipe,step} of ingredientSteps){
  const visual=ingredients.ingredientVisual(step.ingredient,step.shape);if(step.kind!=='slice'||!visual||!preparation.isVolumetricPreparation(visual.id))continue;
  covered.add(recipe.id);const owned=new Set<T.BufferGeometry>(),materials=new Map<string,T.MeshStandardMaterial>();
  const planes=Array.from({length:step.goal},(_,i)=>visual.id==='mushroom'?-1.86+3.72*(i+1)/(step.goal+1):9.3*(-.28+.56*(i+1)/(step.goal+1))),model=preparation.createPreparationModel(visual.id,planes,owned,materials);
  try{
   model.root.updateMatrixWorld(true);const originalBottoms=model.segments.map(g=>new T.Box3().setFromObject(g,true).min.y-.25),originalHeights=planes.map(x=>model.surfaceHeight(x)),initialDrop=model.segments[0].position.y,refs=resources(model.root);
   for(const count of [...Array.from({length:step.goal+1},(_,i)=>i),0]){
    model.update(count);model.root.updateMatrixWorld(true);
    const remaining=new T.Box3();model.segments.slice(count).forEach(g=>remaining.union(new T.Box3().setFromObject(g,true)));
    assert.ok(Math.abs(remaining.min.y-.25)<1e-6,`${recipe.id}/${count}: connected uncut remainder rests on the board`);
    const expectedDrop=Math.min(...originalBottoms.slice(count));
    model.segments.slice(count).forEach((g,j)=>{assert.ok(Math.abs(g.position.y-initialDrop+expectedDrop)<1e-6,'remaining sections translate together, without opening seams');assert.equal(g.position.x,g.userData.center,'knife x planes do not move');if(count+j<step.goal)assert.ok(Math.abs(model.surfaceHeight(planes[count+j])-(originalHeights[count+j]-expectedDrop))<1e-6,'knife follows the connected body height');});
    for(let i=0;i<count;i++)assert.ok(Math.abs(new T.Box3().setFromObject(model.segments[i],true).min.y-.25)<1e-6,'previously cut pieces remain on the board');
    const bounds=new T.Box3().setFromObject(model.root,true);assert.ok(bounds.min.x>=-3.05&&bounds.max.x<=3.05&&bounds.min.z>=-2&&bounds.max.z<=2.2,'all pieces remain within the board');
    if(count>0){const cut=new T.Box3().setFromObject(model.segments[count-1],true);assert.ok(cut.max.x<remaining.min.x,'last separated piece stays clear of the lowered remaining body');}
    assert.deepEqual(resources(model.root),refs,'settling and reset allocate no resources');
   }
  }finally{owned.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 }
 assert.deepEqual([...covered].sort(),['baked-sweet-potato','cream-risotto','fish-and-chips','plant-burger','pumpkin-soup'].sort());
});


test('hero silhouettes have raised root tips, a tall lobed pumpkin and a camera-visible mushroom stalk',()=>{
 for(const id of preparation.VOLUMETRIC_PREPARATION_IDS){
  const owned=new Set<T.BufferGeometry>(),materials=new Map<string,T.MeshStandardMaterial>(),model=preparation.createPreparationModel(id,Array.from({length:7},(_,i)=>id==='mushroom'?-1.86+3.72*(i+1)/8:9.3*(-.28+.56*(i+1)/8)),owned,materials);
  try{
   model.root.updateMatrixWorld(true);const skinPoints:T.Vector3[]=[];
   model.root.traverse(o=>{if(o instanceof T.Mesh&&o.name==='preparation/skin'){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)skinPoints.push(new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));}});
   if(id==='potato'||id==='sweet-potato'){
    const tips=skinPoints.filter(p=>Math.abs(p.x)>2.5);assert.ok(tips.length>0);assert.ok(Math.min(...tips.map(p=>p.y))>.55,'rounded tips lift from the board rather than forming a flat loaf');
   }
   if(id==='pumpkin'){
    const box=new T.Box3().setFromPoints(skinPoints);assert.ok(box.max.y-box.min.y>2.8,'pumpkin body has substantial vertical volume');assert.ok(box.max.z-box.min.z>2.6);
    const front=skinPoints.filter(p=>p.z>1&&p.y>.9&&p.y<2.2);assert.ok(front.length>20,'lobes retain a broad front surface');
   }
   if(id==='mushroom'){
    const meshes:T.Mesh[]=[];model.root.traverse(o=>{if(o instanceof T.Mesh&&o.visible)meshes.push(o);});
    const direction=new T.Vector3(0,-1,-1).normalize();let visible=0;
    for(const x of [-.15,0,.15])for(const y of [.4,.6,.8]){
     const target=new T.Vector3(x,y,.40),ray=new T.Raycaster(target.clone().addScaledVector(direction,-20),direction);
     if(ray.intersectObjects(meshes,false)[0]?.object.name==='preparation/stalk')visible++;
    }
    assert.ok(visible>=6,`stalk must occupy visible pixels from the actual camera direction, got ${visible}/9`);
   }
  }finally{owned.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 }
});

test('mushroom cap, flesh border and tapered stalk have explicit real dimensions at every knife plane',()=>{
 for(const recipeId of ['cream-risotto','plant-burger']){
  const recipe=catalog.recipeOf(recipeId)!,step=recipe.steps[0],owned=new Set<T.BufferGeometry>(),materials=new Map<string,T.MeshStandardMaterial>();
  // Independent dimensions: no production scale helper is used for expectations.
  const planes=Array.from({length:step.goal},(_,i)=>-1.86+3.72*(i+1)/(step.goal+1));
  const model=preparation.createPreparationModel('mushroom',planes,owned,materials),boundaries=[-1.86,...planes,1.86];
  try{
   model.root.updateMatrixWorld(true);
   const whole=new T.Box3().setFromObject(model.root,true),size=whole.getSize(new T.Vector3());
   assert.ok(Math.abs(size.x-3.72)<1e-6);assert.ok(Math.abs(size.z-2.36)<1e-6,'depth is not enlarged to disguise a long cap');
   assert.ok(size.y>2.26&&size.y<2.28,'domed cap has explicit height, not a scaled capsule');
   const skins=model.segments.map(g=>g.getObjectByName('preparation/skin') as T.Mesh);
   for(let i=0;i<model.segments.length;i++){
    const box=new T.Box3().setFromObject(skins[i],true);
    assert.ok(Math.abs(box.min.x-boundaries[i])<1e-6);assert.ok(Math.abs(box.max.x-boundaries[i+1])<1e-6);
    assert.ok(box.max.z-box.min.z>.5&&box.max.y-box.min.y>.2,'each actual section has cap volume');
    const positions=skins[i].geometry.getAttribute('position'),colors=skins[i].geometry.getAttribute('color');
    let brown=0,underside=0;
    for(let j=0;j<positions.count;j++){
     if(positions.getY(j)>1.26){assert.ok(colors.getX(j)<.3);brown++;}
     if(positions.getY(j)<1.23){assert.ok(colors.getX(j)>.4);underside++;}
    }
    assert.ok(brown>0&&underside>0,'brown dome and lighter underside are actual material partitions');
    const faceColors=model.faces[i].right.geometry.getAttribute('color');let pale=0,skin=0;
    for(let j=0;j<faceColors.count;j++){if(faceColors.getX(j)>.85)pale++;if(faceColors.getX(j)<.3)skin++;}
    assert.ok(pale>0&&skin>0,'pale actual flesh is bordered by brown cap skin');
   }
   for(const index of [0,planes.length-1]){
    const ray=new T.Raycaster(new T.Vector3(planes[index],8,0),new T.Vector3(0,-1,0));
    const hits=ray.intersectObjects(skins,false);assert.ok(hits.length>0,'first and last knife planes intersect real visible cap mesh');
    assert.ok(hits[0].point.y>1.8);assert.ok(Math.abs(hits[0].point.y-model.surfaceHeight(planes[index]))<1e-6);
   }
   const stalks=model.segments.flatMap(g=>{const m=g.getObjectByName('preparation/stalk');return m?[m as T.Mesh]:[];});
   for(const mesh of [...stalks,...model.faces.flatMap(f=>[f.left,f.right])]){
    const p=mesh.geometry.getAttribute('position'),n=mesh.geometry.getAttribute('normal');
    for(let i=0;i<p.count;i+=3){
     const a=new T.Vector3().fromBufferAttribute(p,i),b=new T.Vector3().fromBufferAttribute(p,i+1),c=new T.Vector3().fromBufferAttribute(p,i+2),face=b.sub(a).cross(c.sub(a));
     if(face.lengthSq()>1e-14)assert.ok(face.dot(new T.Vector3().fromBufferAttribute(n,i))>0,'triangle winding and outward shading normals agree, including both sides of stalk cuts');
    }
   }
   let foot=0,waist=0;
   for(const stalk of stalks){const p=stalk.geometry.getAttribute('position');for(let i=0;i<p.count;i++){const radius=Math.hypot(p.getX(i)+stalk.parent!.position.x,p.getZ(i));if(Math.abs(p.getY(i))<1e-6)foot=Math.max(foot,radius);if(Math.abs(p.getY(i)-.625)<1e-6)waist=Math.max(waist,radius);}}
   assert.ok(Math.abs(foot-.42)<1e-6&&Math.abs(waist-.32)<1e-6,'stalk has a broader foot and cap connection, not a blunt cylinder');
   const refs=resources(model.root);
   for(let count=0;count<=step.goal;count++){
    model.update(count);model.root.updateMatrixWorld(true);
    for(let i=0;i<count;i++)assert.ok(Math.abs(new T.Box3().setFromObject(model.segments[i],true).min.y-.25)<1e-6);
    const remaining=new T.Box3();model.segments.slice(count).forEach(g=>remaining.union(new T.Box3().setFromObject(g,true)));assert.ok(Math.abs(remaining.min.y-.25)<1e-6);
    const bounds=new T.Box3().setFromObject(model.root,true);assert.ok(bounds.min.x>-2.5&&bounds.max.x<1.861&&bounds.min.z>=-1.181&&bounds.max.z<1.831,'all real cut pieces fit comfortably on the unchanged board');
    assert.deepEqual(resources(model.root),refs);
   }
  }finally{owned.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 }
});


test('panoramic kitchen preserves exact input projection with asymmetric safe rectangles and bounded pixels',()=>{
 const fixtures=[{width:390,height:844,left:0,top:285,coreWidth:390,coreHeight:273},{width:1440,height:900,left:360,top:180,coreWidth:720,coreHeight:504},{width:667,height:375,left:40,top:120,coreWidth:300,coreHeight:210}];
 for(const v of fixtures){
  const p=kitchenPresentation(v);assert.ok(p.width<=640&&p.height<=448,'backing buffer remains at most 960x672 at the existing 1.5 DPR');
  assert.equal(p.width,640,'portrait retains the full existing horizontal sampling budget');
  assert.equal(p.height,448,'vertical sampling never exceeds the original budget');
  for(const [u,w] of [[0,0],[1,0],[0,1],[1,1],[.5,.5]]){
   const x=-4.65+u*9.3,y=3.255-w*6.51;
   assert.ok(Math.abs((x-p.left)/(p.right-p.left)*p.width*(v.width/p.width)-(v.left+u*v.coreWidth))<1e-8);
   assert.ok(Math.abs((p.top-y)/(p.top-p.bottom)*p.height*(v.height/p.height)-(v.top+w*v.coreHeight))<1e-8);
  }
 }
 assert.throws(()=>kitchenPresentation({...fixtures[0],coreWidth:0}));assert.throws(()=>kitchenPresentation({...fixtures[0],top:NaN}));
});
test('panorama resize redraws a paused cached scene and capture restores presentation immediately',()=>{
 const f=factory(true),recipe=catalog.recipeOf('pumpkin-soup')!,run={...domain.newCookingRun(recipe,42,'panorama'),status:'paused' as const};
 try{
  f.stage.update(run,null,1000,false);const before=snapshot(f.scene()),v={width:390,height:844,left:0,top:285,coreWidth:390,coreHeight:273},p=kitchenPresentation(v,presentationHelpers.kitchenWorkZoom(domain.currentStep(run).kind)),count=f.renders();
  f.stage.resize(v);assert.equal(f.renders(),count+1);assert.deepEqual(snapshot(f.scene()),before);assert.equal(f.camera().left,p.left);assert.equal(f.camera().bottom,p.bottom);
  f.stage.resize(v);assert.equal(f.renders(),count+1,'identical observer measurements never redraw');
  assert.equal(f.stage.capture(),'data:image/png;base64,fixture');assert.equal(f.renders(),count+3,'capture restores the full presentation before returning');
  assert.deepEqual(f.sizes.slice(-2),[[640,448],[p.width,p.height]]);assert.equal(f.camera().bottom,p.bottom);
  f.failCapture();assert.throws(()=>f.stage.capture(),/capture unavailable/);assert.deepEqual(f.sizes.slice(-2),[[640,448],[p.width,p.height]]);assert.equal(f.camera().bottom,p.bottom,'failed export also restores full presentation immediately');
  f.stage.resize({width:667,height:375,left:40,top:120,coreWidth:300,coreHeight:210});assert.deepEqual(snapshot(f.scene()),before,'rotation never moves food or changes input geometry');
 }finally{f.stage.dispose();}
});

test('cutting close-up shares exact inverse input and SVG viewBox projection, without zooming other tools',()=>{
 const {kitchenWorkZoom,kitchenInputPoint,kitchenGuideViewBox}=presentationHelpers;
 assert.equal(kitchenWorkZoom('slice'),1.2);assert.equal(kitchenWorkZoom('slice',true),1);
 for(const kind of ['mix','pan','boil','plate','knead','fold','bake','pour'])assert.equal(kitchenWorkZoom(kind),1);
 const v={width:390,height:844,left:0,top:285,coreWidth:390,coreHeight:273},zoom=1.2,p=kitchenPresentation(v,zoom),[vx,vy,vw,vh]=kitchenGuideViewBox(zoom).split(' ').map(Number);
 for(const [x,y] of [[.22,.33],[.5,.5],[.78,.65]]){
  const screenX=(x*800-vx)/vw,screenY=(y*560-vy)/vh,input=kitchenInputPoint(screenX,screenY,zoom);
  assert.ok(Math.abs(input.x-x)<1e-12&&Math.abs(input.y-y)<1e-12,'exact gesture inverse, not domain tolerance');
  assert.ok(Math.abs(((-4.65+9.3*x)-p.left)/(p.right-p.left)*v.width-(v.left+screenX*v.coreWidth))<1e-8);
  assert.ok(Math.abs((p.top-(3.255-6.51*y))/(p.top-p.bottom)*v.height-(v.top+screenY*v.coreHeight))<1e-8);
 }
});

test('preparation pigments are deterministic, seam-continuous and reveal layered real cut flesh',()=>{
 for(const id of preparation.VOLUMETRIC_PREPARATION_IDS){
  const planes=[-1.2,-.4,.4,1.2],owned=new Set<T.BufferGeometry>(),materials=new Map<string,T.MeshStandardMaterial>();
  const model=preparation.createPreparationModel(id,planes,owned,materials);
  try{
   const skins=model.segments.map(g=>g.getObjectByName('preparation/skin') as T.Mesh);
   for(const skin of skins){
    const colors=skin.geometry.getAttribute('color'),distinct=new Set<string>();
    for(let i=0;i<colors.count;i++){
     const channels=[colors.getX(i),colors.getY(i),colors.getZ(i)];
     channels.forEach(v=>assert.ok(Number.isFinite(v)&&v>=0&&v<=1.2));
     distinct.add(channels.map(v=>v.toFixed(4)).join('/'));
    }
    assert.ok(distinct.size>80,`${id}: real pigment variation must survive beyond a flat colour swap`);
   }
   for(let seam=0;seam<planes.length;seam++){
    const at=(mesh:T.Mesh)=>{const p=mesh.geometry.getAttribute('position'),c=mesh.geometry.getAttribute('color'),result=new Map<string,number[]>();for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)+mesh.parent!.position.x-planes[seam])<1e-6)result.set(`${p.getY(i).toFixed(5)}/${p.getZ(i).toFixed(5)}`,[c.getX(i),c.getY(i),c.getZ(i)]);return result;};
    const left=at(skins[seam]),right=at(skins[seam+1]);assert.ok(left.size>=39);
    for(const [point,color] of left){const other=right.get(point);assert.ok(other,`${id}: both sides share the same skin seam`);color.forEach((value,i)=>assert.ok(Math.abs(value-other![i])<1e-6));}
   }
   if(id!=='mushroom'){
    const face=model.faces[2].right.geometry,c=face.getAttribute('color'),p=face.getAttribute('position');
    assert.ok(p.count>=1320&&p.count<=1500,'six flesh bands and at most five 12-triangle seeds have a fixed vertex budget');
    const tones=new Set(Array.from({length:c.count},(_,i)=>[c.getX(i),c.getY(i),c.getZ(i)].map(v=>v.toFixed(4)).join('/')));
    assert.ok(tones.size>50,'thin rind, flesh and core retain distinct pigments');
   }
   const before=snapshot(model.root as unknown as T.Scene);
   model.update(2);model.update(0);assert.deepEqual(snapshot(model.root as unknown as T.Scene),before,'cuts do not rerandomize surface appearance');
  }finally{owned.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}
 }
});

test('standard-DPI kitchens supersample within the existing backing-buffer cap',()=>{
 const f=factory(true);try{
  assert.deepEqual(f.pixelRatios,[1.5]);
  f.stage.resize({width:1180,height:814,left:300,top:200,coreWidth:580,coreHeight:406});
  for(const [width,height] of f.sizes){assert.ok(width*1.5<=960);assert.ok(height*1.5<=672);}
 }finally{f.stage.dispose();}
});
