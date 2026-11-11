import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import * as domain from '../../apps/portal-web/src/games/domain.js';
import {createStampHandleGeometry} from '../../apps/portal-web/src/games/stamp-tool.js';
import {bakeRigidGroup} from '../../apps/portal-web/src/games/stage-batch.js';
import type {Stage,StageView} from '../../apps/portal-web/src/games/stage.js';

// Execute the installed Three shadow scheduler/traversal, with controlled GL
// ports. No GPU, raster, browser, FPS or physical-device acceptance is implied.
const threeRoot=new URL('../../node_modules/three/',import.meta.url);
const {WebGLShadowMap}=await import(new URL('src/renderers/webgl/WebGLShadowMap.js',threeRoot).href);
const stageSource=readFileSync(new URL('../../apps/portal-web/src/games/stage.ts',import.meta.url),'utf8');
const modelSource=readFileSync(new URL('../../apps/portal-web/src/games/daily-scene-model.ts',import.meta.url),'utf8');
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
// Remove only this change's scheduling additions, then verify the ENTIRE
// original factory bytes. This is the published e90b0b339 reference, not a
// hand-written geometry substitute or a second copy of gameplay logic.
const additions=[
`    // A restored WebGL context has no usable depth contents, even if Three\n    // retains the light's render-target object and renderer shadow settings.\n    const restored = () => { if (!disposed) shadows.forEach(shadow => { shadow.needsUpdate = true; }); };\n`,
`        renderer.domElement.removeEventListener('webglcontextrestored', restored);\n`,
`        // CASH casters are stationary apart from the accepted stack and lamp\n        // visibility below. Keep all color frames and other games automatic.\n        key.shadow.autoUpdate = view.game !== 'cash';\n`,
`            key.shadow.needsUpdate = true;\n`,
`                if (view.game === 'cash' && lamp && lamp.children[lamp.children.length - 1].visible !== (view.stamp.endedAt === null))\n                    key.shadow.needsUpdate = true;\n`,
`                if (cashTower && cashTower.count !== view.cash.index - view.cash.rejected) key.shadow.needsUpdate = true;\n`,
`    renderer.domElement.addEventListener('webglcontextrestored', restored);\n`,
];
let baselineSource=stageSource;
for(const addition of additions.sort((a,b)=>b.length-a.length)){assert.equal(baselineSource.split(addition).length,2,'one exact scheduling addition');baselineSource=baselineSource.replace(addition,'');}
assert.equal(hash(baselineSource),'f9973a13560a4ef166913d01e24618f9e7e3c1966a1f7529173ec6e89cd9235f','e90 production factory bytes');

function arrayHash(a:ArrayBufferView){return hash(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));}
function texture(t:T.Texture|null){if(!t)return null;const image=t.image as {data?:Uint8Array;width?:number;height?:number;commands?:unknown[]};return {type:t.type,mapping:t.mapping,wrapS:t.wrapS,wrapT:t.wrapT,mag:t.magFilter,min:t.minFilter,anisotropy:t.anisotropy,format:t.format,colorSpace:t.colorSpace,flipY:t.flipY,premultiplyAlpha:t.premultiplyAlpha,unpackAlignment:t.unpackAlignment,mipmaps:t.generateMipmaps,matrix:t.matrix.toArray(),image:{width:image?.width,height:image?.height,data:image?.data?arrayHash(image.data):null,commands:image?.commands}};}
function material(m:T.Material){
 const v=m as T.MeshToonMaterial;
 return {type:m.type,color:v.color?.toArray(),side:m.side,shadowSide:m.shadowSide,visible:m.visible,transparent:m.transparent,opacity:m.opacity,depthTest:m.depthTest,depthWrite:m.depthWrite,depthFunc:m.depthFunc,colorWrite:m.colorWrite,alphaTest:m.alphaTest,alphaToCoverage:m.alphaToCoverage,blending:m.blending,toneMapped:m.toneMapped,polygonOffset:m.polygonOffset,polygonOffsetFactor:m.polygonOffsetFactor,polygonOffsetUnits:m.polygonOffsetUnits,wireframe:v.wireframe,map:texture(v.map),alphaMap:texture(v.alphaMap),gradientMap:texture(v.gradientMap),displacementMap:texture(v.displacementMap),displacementScale:v.displacementScale,displacementBias:v.displacementBias};
}
function geometry(g:T.BufferGeometry){return {index:g.index?arrayHash(g.index.array):null,attributes:Object.fromEntries(Object.entries(g.attributes).map(([name,a])=>[name,{itemSize:a.itemSize,normalized:a.normalized,array:arrayHash((a as T.BufferAttribute).array)}])),groups:g.groups,drawRange:g.drawRange};}
function object(o:T.Object3D){const m=o as T.Mesh,i=o as T.InstancedMesh;return {type:o.type,name:o.name,visible:o.visible,layers:o.layers.mask,cast:o.castShadow,receive:o.receiveShadow,frustumCulled:o.frustumCulled,matrix:o.matrixWorld.toArray(),geometry:m.isMesh?geometry(m.geometry):undefined,material:m.isMesh?[m.material].flat().map(material):undefined,count:i.isInstancedMesh?i.count:undefined,instances:i.isInstancedMesh?arrayHash(i.instanceMatrix.array):undefined};}
function frame(scene:T.Scene,camera:T.PerspectiveCamera){const nodes:unknown[]=[];scene.traverse(o=>nodes.push(object(o)));const lights:unknown[]=[];scene.traverse(o=>{if(o instanceof T.DirectionalLight)lights.push({color:o.color.toArray(),intensity:o.intensity,target:o.target.matrixWorld.toArray(),cast:o.castShadow,mapSize:o.shadow.mapSize.toArray(),bias:o.shadow.bias,normalBias:o.shadow.normalBias,radius:o.shadow.radius,projection:o.shadow.camera.projectionMatrix.toArray(),matrix:o.shadow.matrix.toArray()});});return hash(JSON.stringify({nodes,lights,background:(scene.background as T.Color)?.toArray(),camera:{world:camera.matrixWorld.toArray(),projection:camera.projectionMatrix.toArray(),layers:camera.layers.mask}}));}

function native(width=667,height=375,baseline=false){
 let scene:T.Scene,camera:T.PerspectiveCamera,renderer:Renderer,resize=()=>{},lostCalls=0,removed=0,disposed=0,forced=0,disconnected=0,failCapture=false;
 const events=new Map<string,(event?:unknown)=>void>();
 const host={clientWidth:width,clientHeight:height,append(){},getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}};
 class Renderer{
  domElement={width:0,height:0,setAttribute(){},addEventListener(name:string,fn:(event?:unknown)=>void){events.set(name,fn);},removeEventListener(name:string){events.delete(name);},remove(){removed++;}};
  shadowMap:any;info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};pixelRatio=1;toneMapping=0;
  state={setBlending(){},buffers:{depth:{getReversed:()=>false,setTest(){}},color:{setClear(){}}},setScissorTest(){},viewport(){}};
  localClippingEnabled=false;target:any=null;shadowPasses=0;colorFrames=0;depthDraws=0;depth='';commands:unknown[]=[];contextLost=false;throwRender=false;
  constructor(){renderer=this;this.shadowMap=new WebGLShadowMap(this,{update:(o:T.Mesh)=>o.geometry},{maxTextureSize:4096});}
  setPixelRatio(r:number){this.pixelRatio=r;}setSize(w:number,h:number){this.domElement.width=Math.floor(w*this.pixelRatio);this.domElement.height=Math.floor(h*this.pixelRatio);}
  getRenderTarget(){return this.target;}getActiveCubeFace(){return 0;}getActiveMipmapLevel(){return 0;}setRenderTarget(t:unknown){this.target=t;}
  clear(){this.shadowPasses++;this.commands=[];}
  renderBufferDirect(c:T.Camera,_scene:unknown,g:T.BufferGeometry,m:T.Material,o:T.Object3D){this.depthDraws++;this.commands.push({object:object(o),depthMaterial:material(m),geometry:geometry(g),cameraWorld:c.matrixWorld.toArray(),projection:c.projectionMatrix.toArray()});}
  render(s:T.Scene,c:T.PerspectiveCamera){
   if(this.contextLost)return;if(this.throwRender){this.throwRender=false;throw Error('controlled draw failure');}
   scene=s;camera=c;s.updateMatrixWorld();c.updateMatrixWorld();const lights:T.DirectionalLight[]=[];s.traverseVisible(o=>{if(o instanceof T.DirectionalLight&&o.castShadow&&o.layers.test(c.layers))lights.push(o);});
   const before=this.shadowPasses;this.shadowMap.render(lights,s,c);if(this.shadowPasses!==before)this.depth=hash(JSON.stringify(this.commands));this.colorFrames++;
  }
  dispose(){disposed++;}forceContextLoss(){forced++;}
 }
 const document={createElement(){
  const commands:unknown[]=[];const context=new Proxy({}, {get:(target,key)=>Reflect.has(target,key)?Reflect.get(target,key):(...args:unknown[])=>commands.push([key,...args.map(a=>typeof a==='object'?'canvas':a)]),set:(target,key,value)=>{commands.push([key,value]);return Reflect.set(target,key,value);}});
  return {width:0,height:0,commands,getContext:()=>context,toDataURL(){if(failCapture){failCapture=false;throw Error('controlled readback failure');}return 'data:image/jpeg;base64,controlled';}};
 }};
 const globals={document,window:{devicePixelRatio:1.5},ResizeObserver:class{constructor(fn:()=>void){resize=fn;}observe(){}disconnect(){disconnected++;}}};
 const modelModule={exports:{} as any};runInNewContext(transformSync(modelSource,{loader:'ts',format:'cjs'}).code,{...globals,module:modelModule,exports:modelModule.exports,require:(id:string)=>id==='three'?T:domain});
 const exports={exports:{} as {createStage:(host:unknown,lost:()=>void)=>Stage}};
 runInNewContext(transformSync(baseline?baselineSource:stageSource,{loader:'ts',format:'cjs'}).code,{...globals,module:exports,exports:exports.exports,require:(id:string)=>{if(id==='three')return {...T,WebGLRenderer:Renderer};if(id.includes('RoundedBox'))return {RoundedBoxGeometry};if(id.includes('BufferGeometryUtils'))return {mergeGeometries};if(id==='./stage-batch')return {bakeRigidGroup};if(id==='./stamp-tool')return {createStampHandleGeometry};if(id==='./daily-scene-model')return modelModule.exports;if(id==='./domain')return domain;throw Error(id);}});
 const stage=exports.exports.createStage(host,()=>lostCalls++);
 return {stage,host,renderer:()=>renderer!,scene:()=>scene!,camera:()=>camera!,resize(w:number,h:number){host.clientWidth=w;host.clientHeight=h;resize();},failCapture(){failCapture=true;},lose(){renderer.contextLost=true;events.get('webglcontextlost')?.({preventDefault(){}} as never);},restore(){renderer.contextLost=false;const prior=renderer.shadowMap;renderer.shadowMap=new WebGLShadowMap(renderer,{update:(o:T.Mesh)=>o.geometry},{maxTextureSize:4096});for(const field of ['enabled','autoUpdate','needsUpdate','type'])renderer.shadowMap[field]=prior[field];events.get('webglcontextrestored')?.();},events,cleanup:()=>({removed,disposed,forced,disconnected,lostCalls})};
}
const view=(seed=42):StageView=>({game:'cash',seed,seconds:0,client:0,pan:{x:0,y:0},fov:44,stampPoint:{x:0,y:0},raised:false,motion:true,cash:domain.newCash(seed),stamp:domain.newStamps(seed)});
const key=(h:ReturnType<typeof native>)=>h.scene().children.find(o=>o instanceof T.DirectionalLight&&o.castShadow) as T.DirectionalLight;
function equal(a:ReturnType<typeof native>,b:ReturnType<typeof native>){assert.equal(frame(a.scene(),a.camera()),frame(b.scene(),b.camera()),'complete scene/camera/material/texture-command fingerprints match e90');assert.equal(a.renderer().depth,b.renderer().depth,'cached depth draw inputs equal an actual fresh Three shadow pass');assert.equal(a.renderer().colorFrames,b.renderer().colorFrames,'no color frames removed');assert.equal(b.renderer().shadowMap.autoUpdate,true,'global scheduler stays automatic');assert.equal(b.renderer().shadowMap.enabled,true);assert.equal(b.renderer().shadowMap.type,T.PCFShadowMap);}

for(const [seed,width,height]of [[42,667,375],[42,635,289],[8675309,667,375],[8675309,320,568]])test(`CASH ${seed} ${width}x${height}: all thirty classifications and 721 frames keep exact e90 draw inputs`,t=>{
 const a=native(width,height,true),b=native(width,height),v=view(seed);let checks=0;
 const draw=()=>{a.stage.update(v);b.stage.update(v);equal(a,b);checks++;};draw();
 for(const [index,card]of domain.cashDeck(seed).entries()){
  const now=index*800;v.cash=domain.sortCash(v.cash!,index,!card.valid,now).state;
  for(const dt of [0,16,32,80,160,199])for(const drag of [{x:0,y:0},{x:.2,y:.1},{x:-.2,y:-.1}]){v.seconds=(now+dt)/1000;v.cashDrag=drag;draw();}
  assert.equal(domain.sortCash(v.cash!,index,card.valid,now+159).state,v.cash,'cooldown is unchanged');
  v.cash=domain.sortCash(v.cash!,index,card.valid,now+200).state;v.cashDrag={x:0,y:0};
  assert.equal(domain.sortCash(v.cash!,index,card.valid,now+400).state,v.cash,'stale identity is unchanged');
  for(const dt of [0,16,32,80,160,199]){v.seconds=(now+200+dt)/1000;draw();}
 }
 assert.equal(checks,721);assert.equal(a.renderer().shadowPasses,721);assert.equal(b.renderer().shadowPasses,25);assert.equal(b.renderer().depthDraws,800);
 assert.equal(v.cash!.index,30);assert.equal(v.cash!.rejected,6);assert.equal(v.cash!.mistakes,30);assert.equal(v.cash!.amount,1000000);
 assert.equal(a.stage.capture(),b.stage.capture());equal(a,b);assert.equal(b.renderer().shadowPasses,25);
 t.diagnostic(JSON.stringify({seed,width,height,colorUpdates:checks,referenceShadowPasses:721,candidateShadowPasses:25,referenceDepthDispatches:721*32,candidateDepthDispatches:800,note:'CPU traversal/inputs, not GPU time or pixels'}));a.stage.dispose();b.stage.dispose();
});

test('CASH invalidates retained lamp caster visibility, replay and new scenes; resize and drag only change color inputs',()=>{
 const a=native(667,375,true),b=native(),v=view();const draw=()=>{a.stage.update(v);b.stage.update(v);equal(a,b);};draw();let passes=1;
 for(const endedAt of [100,100,null,null]){v.stamp={...v.stamp!,endedAt};draw();}
 assert.equal(b.renderer().shadowPasses,3);passes=3;
 for(const [width,height]of [[320,568],[390,844],[635,289],[667,375],[667,375]]){a.resize(width,height);b.resize(width,height);equal(a,b);assert.equal(b.renderer().shadowPasses,passes);}
 for(const motion of [false,true])for(const drag of [{x:.5,y:.3},{x:-.5,y:-.3},{x:0,y:0}]){v.motion=motion;v.cashDrag=drag;v.seconds+=.08;draw();assert.equal(b.renderer().shadowPasses,passes);}
 for(const [index,card]of domain.cashDeck(v.seed).entries()){v.cash=domain.sortCash(v.cash!,index,card.valid,1000+index*200).state;draw();}
 assert.equal(b.renderer().shadowPasses,passes+24);v.cash=domain.newCash(v.seed);draw();assert.equal(b.renderer().shadowPasses,passes+25);draw();assert.equal(b.renderer().shadowPasses,passes+25);
 v.seed++;v.cash=domain.newCash(v.seed);draw();assert.equal(b.renderer().shadowPasses,passes+26);a.stage.dispose();b.stage.dispose();
});

test('CASH capture retry, failed draw, lost/restored context and replacement keep pending shadows and clean ownership',()=>{
 const a=native(667,375,true),b=native(),v=view();const draw=()=>{a.stage.update(v);b.stage.update(v);equal(a,b);};draw();
 for(const [index,card]of domain.cashDeck(v.seed).entries()){v.cash=domain.sortCash(v.cash!,index,card.valid,index*200).state;draw();}
 assert.equal(v.cash!.index,30);assert.equal(v.cash!.amount,1000000);
 a.failCapture();b.failCapture();assert.throws(()=>a.stage.capture(),/readback/);assert.throws(()=>b.stage.capture(),/readback/);equal(a,b);assert.equal(a.stage.capture(),b.stage.capture());equal(a,b);assert.equal(b.renderer().shadowPasses,25);
 v.cash=domain.newCash(v.seed);a.renderer().throwRender=true;b.renderer().throwRender=true;assert.throws(()=>a.stage.update(v),/draw failure/);assert.throws(()=>b.stage.update(v),/draw failure/);assert.equal(key(b).shadow.needsUpdate,true);draw();assert.equal(key(b).shadow.needsUpdate,false);
 const before=b.renderer().shadowPasses;a.lose();b.lose();v.cash=domain.sortCash(v.cash!,0,domain.cashDeck(v.seed)[0].valid,0).state;draw();assert.equal(key(b).shadow.needsUpdate,true);assert.equal(b.renderer().shadowPasses,before);a.restore();b.restore();assert.equal(key(b).shadow.needsUpdate,true);assert.equal(a.stage.capture(),b.stage.capture());equal(a,b);assert.equal(b.renderer().shadowPasses,before+1);draw();assert.equal(b.renderer().shadowPasses,before+1);
 const observed=new Map<T.InstancedMesh|T.BufferGeometry|T.Material|T.Texture,number>();const own=(r:T.InstancedMesh|T.BufferGeometry|T.Material|T.Texture)=>{if(!observed.has(r)){observed.set(r,0);const listener=()=>observed.set(r,observed.get(r)!+1);if(r instanceof T.InstancedMesh)r.addEventListener('dispose',listener);else r.addEventListener('dispose',listener);}};
 b.scene().traverse(o=>{if(o instanceof T.Mesh){own(o.geometry);if(o instanceof T.InstancedMesh)own(o);for(const m of [o.material].flat()){own(m);for(const tex of [(m as T.MeshToonMaterial).map,(m as T.MeshToonMaterial).gradientMap])if(tex)own(tex);}}});
 a.stage.dispose();b.stage.dispose();b.stage.dispose();for(const count of observed.values())assert.equal(count,1);assert.equal(b.events.size,0);assert.deepEqual(b.cleanup(),{removed:1,disposed:1,forced:1,disconnected:1,lostCalls:1});const frames=b.renderer().colorFrames;b.stage.update(v);assert.equal(b.renderer().colorFrames,frames);assert.throws(()=>b.stage.capture(),/場景尚未準備/);
 const replacement=native();replacement.stage.update(v);assert.equal(replacement.renderer().shadowPasses,1);assert.equal(replacement.renderer().depth,a.renderer().depth);replacement.stage.dispose();
});

test('CASH to STAMP/PHOTO switches restore automatic per-light updates and never change renderer scheduling',()=>{
 const a=native(667,375,true),b=native(),v=view();for(const game of ['cash','stamp','photo','cash','photo','stamp','cash'] as const){v.game=game;for(let i=0;i<3;i++){v.seconds+=.25;v.stampPoint={x:i*.1,y:-i*.1};v.raised=i===1;const before=b.renderer().shadowPasses;a.stage.update(v);b.stage.update(v);equal(a,b);assert.equal(key(b).shadow.autoUpdate,game!=='cash');assert.equal(b.renderer().shadowPasses-before,game!=='cash'||i===0?1:0);}}
 a.stage.dispose();b.stage.dispose();
});

test('installed Three directional shadows are camera-projection independent, but shadow loss needs explicit invalidation',()=>{
 const light=new T.DirectionalLight(),camera=new T.PerspectiveCamera(42,1,.1,60);light.position.set(-3.5,7,5);light.updateMatrixWorld();light.shadow.camera.updateProjectionMatrix();light.shadow.updateMatrices(light);const matrix=light.shadow.matrix.toArray();
 for(const aspect of [.3,1,2.2]){camera.aspect=aspect;camera.fov=75;camera.updateProjectionMatrix();(light.shadow.updateMatrices as (...args:unknown[])=>void)(light,camera);assert.deepEqual(light.shadow.matrix.toArray(),matrix);}
 const source=readFileSync(new URL('src/renderers/WebGLRenderer.js',threeRoot),'utf8'),start=source.indexOf('function onContextRestore('),end=source.indexOf('\n\t\tfunction onContextCreationError',start),restore=source.slice(start,end);
 assert.ok(restore.includes('initGLContext();'));for(const name of ['enabled','autoUpdate','needsUpdate','type'])assert.ok(restore.includes(`shadowMap.${name} = `),'Three retains scheduling flags on restoration');
 const h=native();h.stage.update(view());assert.equal(key(h).shadow.map!.width,1024);assert.equal(key(h).shadow.map!.height,1024);assert.equal(h.renderer().pixelRatio,1.5);assert.equal(h.renderer().toneMapping,T.NoToneMapping);assert.deepEqual([h.renderer().domElement.width,h.renderer().domElement.height],[960,540]);h.stage.dispose();
});

// Although production keeps the key light visible, prove the installed loop
// cannot consume a pending update while a light is temporarily omitted.
test('CASH pending depth update survives a temporarily invisible shadow light',()=>{
 const a=native(667,375,true),b=native(),v=view();a.stage.update(v);b.stage.update(v);equal(a,b);
 key(a).visible=false;key(b).visible=false;v.cash=domain.sortCash(v.cash!,0,domain.cashDeck(v.seed)[0].valid,0).state;a.stage.update(v);b.stage.update(v);equal(a,b);assert.equal(key(b).shadow.needsUpdate,true);assert.equal(b.renderer().shadowPasses,1);
 key(a).visible=true;key(b).visible=true;a.stage.update(v);b.stage.update(v);equal(a,b);assert.equal(key(b).shadow.needsUpdate,false);assert.equal(b.renderer().shadowPasses,2);a.stage.dispose();b.stage.dispose();
});

// Restoration must invalidate even when no stack/lamp change left work pending.
// Clear the controlled depth contents while retaining the JS render target,
// matching the distinction between retained objects and lost GPU resources.
test('CASH clean cached shadows are regenerated after context restoration before capture',()=>{
 const reference=native(667,375,true),candidate=native(),v=view();
 try {
  reference.stage.update(v);candidate.stage.update(v);equal(reference,candidate);
  const shadow=key(candidate).shadow,map=shadow.map,passes=candidate.renderer().shadowPasses;
  assert.equal(shadow.needsUpdate,false,'the cached map starts clean');
  reference.lose();candidate.lose();
  reference.renderer().depth='';candidate.renderer().depth='';
  assert.equal(shadow.needsUpdate,false,'no geometry change dirtied the cache during loss');
  reference.restore();candidate.restore();
  assert.equal(shadow.map,map,'retained JS target does not establish retained depth contents');
  assert.equal(shadow.needsUpdate,true,'restoration alone must invalidate a clean cache');
  // No update/resize/classification occurs before this direct capture.
  assert.equal(reference.stage.capture(),candidate.stage.capture());equal(reference,candidate);
  assert.equal(candidate.renderer().shadowPasses,passes+1,'capture regenerates the lost depth map');
  assert.equal(shadow.needsUpdate,false,'the real Three shadow pass consumes the request');
  assert.equal(reference.stage.capture(),candidate.stage.capture());equal(reference,candidate);
  assert.equal(candidate.renderer().shadowPasses,passes+1,'subsequent clean capture reuses the restored map');
 } finally {reference.stage.dispose();candidate.stage.dispose();}
});
