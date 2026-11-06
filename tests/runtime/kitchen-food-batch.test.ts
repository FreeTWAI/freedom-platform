import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import {createHash} from 'node:crypto';import {transformSync} from 'esbuild';import * as T from 'three';import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
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
function factory(optimized:boolean,stepOverride?:catalog.CookingStep){let scene:T.Scene,renders=0;const extrusions:T.ExtrudeGeometry[]=[];function observedExtrusion(...args:ConstructorParameters<typeof T.ExtrudeGeometry>){const geometry=new T.ExtrudeGeometry(...args);extrusions.push(geometry);return geometry;}class Renderer{domElement={setAttribute(){},addEventListener(){},removeEventListener(){},remove(){}};shadowMap={};info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};setSize(){}setPixelRatio(){}dispose(){}forceContextLoss(){}render(s:T.Scene){renders++;scene=s;s.updateMatrixWorld(true);}}const module={exports:{} as any};const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/kitchen-stage.ts',import.meta.url),'utf8');runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,devicePixelRatio:1,require:(id:string)=>{if(id==='three')return {...T,WebGLRenderer:Renderer,ExtrudeGeometry:observedExtrusion};if(id.includes('RoundedBox'))return {RoundedBoxGeometry};if(id==='../stage-batch')return {bakeRigidGroup};if(id==='./kitchen-food-batch')return {createKitchenFoodBatch:optimized?createKitchenFoodBatch:()=>null};if(id==='./dish-model')return {createDishModel(){throw Error('not used');}};if(id==='./domain')return stepOverride?{...domain,currentStep:()=>stepOverride}:domain;if(id==='./catalog')return catalog;if(id==='./ingredient-visuals')return ingredients;throw Error(id);}});return {stage:module.exports.createKitchenStage({append(){}},()=>{}),scene:()=>scene!,renders:()=>renders,extrusions};}
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
function resources(scene:T.Scene){const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();scene.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});return {geometries,materials};}

test('real ingredient meshes use shared contours, bounded opaque parts and no per-frame resources',()=>{
 for(const {recipe,step,index} of ingredientSteps){
  const f=factory(true),run={...domain.newCookingRun(recipe,42,'ingredient_mesh'),step:index,status:'playing' as const};
  try{
   f.stage.update(run,null,1000,false);const visual=ingredients.ingredientVisual(step.ingredient,step.shape)!,roots=ingredientRoots(f.scene());
   assert.equal(roots.length,step.goal+(step.kind==='plate'?1:0));
   assert.equal(f.extrusions.length,visual.layers.length,'raw contour geometry is shared by all copies within this step');
   f.extrusions.forEach((geometry,i)=>{
    const contour=geometry.parameters.shapes as T.Shape,points=contour.getPoints();
    assert.deepEqual(points.slice(0,visual.layers[i].points.length).map(p=>[p.x,p.y]),visual.layers[i].points.map(([x,y])=>[x*.3,-y*.3]));
    geometry.computeBoundingBox();assert.ok(geometry.boundingBox!.min.z>=0&&geometry.boundingBox!.max.z<.071);
   });
   for(const root of roots){
    assert.equal(root.children.length,new Set(visual.layers.map(layer=>layer.color)).size,'same-color details are rigidly batched');
    assert.ok(root.children.length<=4);
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
  if(id==='./ingredient-visuals')return ingredients;
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
