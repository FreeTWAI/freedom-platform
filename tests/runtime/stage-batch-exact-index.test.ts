import test from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,BufferAttribute,Float16BufferAttribute,InstancedBufferAttribute,Float32BufferAttribute,Uint8BufferAttribute,InterleavedBuffer,InterleavedBufferAttribute,Group,Mesh,SphereGeometry,MeshStandardMaterial,ShaderMaterial,Vector3,Raycaster,DoubleSide} from 'three';
import {indexExactAttributes,bakeRigidGroup} from '../../apps/portal-web/src/games/stage-batch.js';
import {bakeRigidGroup as baselineBake} from './fixtures/stage-batch-baseline.js';
import {createDishModel} from '../../apps/portal-web/src/games/cooking/dish-model.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as foodKit from '../../apps/portal-web/src/games/cooking/food-kit.js';
import * as marketFood from '../../apps/portal-web/src/games/cooking/market-food.js';
import * as marketDomain from '../../apps/portal-web/src/games/cooking/market-domain.js';
import * as dishDesigns from '../../apps/portal-web/src/games/cooking/dish-designs.js';
import * as foodGeometry from '../../apps/portal-web/src/games/cooking/food-geometry.js';
// Immutable adeeefed baker oracle. Only the baker changes in the model comparison;
// all real model factories and dependencies are shared, with no GPU or test VM.
const baselineSource=readFileSync(new URL('./fixtures/stage-batch-baseline.ts',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(baselineSource).digest('hex'),'d0213d99a03f5325af54b923ee730c0f824621f6d66b0971d28a868c83e0f2b4');
const modelSource=readFileSync(new URL('../../apps/portal-web/src/games/cooking/dish-model.ts',import.meta.url),'utf8');
// CPU storage decision for the two primary fixtures; not a GPU/FPS threshold.
const primaryStorageRatio={ 'egg-fried-rice':.5, 'pearl-milk-tea':.5 } as const;
const baselineCalls={model:0,market:0},baselineBatches={model:0,market:0};
const baselineFor=(scope:'model'|'market')=>(...args:Parameters<typeof baselineBake>)=>{
 const before=new Set(args[0].children);baselineCalls[scope]++;baselineBake(...args);
 for(const child of args[0].children)if(!before.has(child)&&child instanceof Mesh){baselineBatches[scope]++;assert.equal(child.geometry.index,null,scope+' baseline batch must remain unindexed');}
};
// market-food also bakes internally: substitute the oracle there as well, so
// a nested optimized group cannot contaminate the unindexed reference stream.
const baselineMarketModule={exports:{} as typeof marketFood};
const marketSource=readFileSync(new URL('../../apps/portal-web/src/games/cooking/market-food.ts',import.meta.url),'utf8');
const marketDependencies:Record<string,unknown>={'three':THREE,'./food-kit':foodKit,'../stage-batch':{bakeRigidGroup:baselineFor('market')},'./market-domain':marketDomain};
runInNewContext(transformSync(marketSource,{loader:'ts',format:'cjs'}).code,{module:baselineMarketModule,exports:baselineMarketModule.exports,require:(id:string)=>{assert.ok(Object.hasOwn(marketDependencies,id),id);return marketDependencies[id];}});
const baselineModule={exports:{} as {createDishModel:typeof createDishModel}};
const dependencies:Record<string,unknown>={'three':THREE,'three/addons/geometries/RoundedBoxGeometry.js':{RoundedBoxGeometry},'../stage-batch':{bakeRigidGroup:baselineFor('model')},'./food-kit':foodKit,'./market-food':baselineMarketModule.exports,'./market-domain':marketDomain,'./dish-designs':dishDesigns,'./food-geometry':foodGeometry};
runInNewContext(transformSync(modelSource,{loader:'ts',format:'cjs'}).code,{module:baselineModule,exports:baselineModule.exports,require:(id:string)=>{assert.ok(Object.hasOwn(dependencies,id),id);return dependencies[id];}});
const baselineDish=baselineModule.exports.createDishModel;
test('baseline oracle controls reach nested market-food and produce genuinely unindexed batches',()=>{
 const calls={...baselineCalls},batches={...baselineBatches},model=baselineDish('egg-fried-rice'),drink=baselineDish('pearl-milk-tea'),candidate=createDishModel('egg-fried-rice');
 try{assert.ok(baselineCalls.model>calls.model);assert.ok(baselineCalls.market>calls.market);assert.ok(baselineBatches.market>batches.market);let indexed=0;candidate.root.traverse(o=>{if(o instanceof Mesh&&o.geometry.index)indexed++;});assert.ok(indexed>0,'positive optimized geometry control');}finally{model.dispose();drink.dispose();candidate.dispose();}
});


function stream(g:BufferGeometry){return Object.fromEntries(Object.entries(g.attributes).map(([name,a])=>{const bytes=new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength),stride=a.itemSize*a.array.BYTES_PER_ELEMENT,n=g.index?.count??a.count,result=new Uint8Array(n*stride);for(let i=0;i<n;i++){const j=g.index?g.index.getX(i):i;result.set(bytes.subarray(j*stride,(j+1)*stride),i*stride);}return [name,{bytes:Buffer.from(result),itemSize:a.itemSize,normalized:a.normalized,gpuType:(a as BufferAttribute).gpuType}];}));}
function fixture(){const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,1,0],3));return g;}
test('raw tuples preserve -0, normalized/custom attributes, metadata, groups and draw range',()=>{const g=fixture();g.setAttribute('normal',new Float32BufferAttribute(Array.from({length:18},(_,i)=>i%3===2?1:0),3));g.setAttribute('uv',new Float32BufferAttribute([0,0,1,0,0,1,-0,0,1,0,0,1],2));g.setAttribute('marketPortion',new Uint8BufferAttribute([1,1,1,1,1,1],1,true));g.addGroup(0,3,4);g.addGroup(3,3,2);g.setDrawRange(3,3);g.computeBoundingBox();g.computeBoundingSphere();const before=stream(g),groups=structuredClone(g.groups),bounds=g.boundingBox!.clone(),sphere=g.boundingSphere!.clone();assert.equal(indexExactAttributes(g),true);assert.deepEqual(stream(g),before);assert.equal(g.attributes.position.count,4);assert.deepEqual(g.groups,groups);assert.deepEqual(g.drawRange,{start:3,count:3});assert.deepEqual(g.boundingBox,bounds);assert.deepEqual(g.boundingSphere,sphere);});
test('unsupported layouts and non-beneficial input remain unchanged',()=>{for(const mode of ['morph','interleaved','indexed','unique']){const g=fixture();if(mode==='morph')g.morphAttributes.position=[g.attributes.position.clone() as BufferAttribute];if(mode==='interleaved')g.setAttribute('position',new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(18),3),3,0));if(mode==='indexed')g.setIndex([0,1,2,3,4,5]);if(mode==='unique')g.setAttribute('position',new Float32BufferAttribute(Array.from({length:18},(_,i)=>i),3));const before=g.attributes.position,index=g.index;assert.equal(indexExactAttributes(g),false);assert.equal(g.attributes.position,before);assert.equal(g.index,index);}});
function group(material=new MeshStandardMaterial({side:DoubleSide})){const root=new Group();for(let i=0;i<3;i++){const mesh=new Mesh(new SphereGeometry(1,16,10),material);mesh.position.set(i*2,0,0);mesh.scale.set(1,.7,1.2);mesh.rotation.set(.1,.3,.2);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);}return root;}
test('baking preserves exact transformed stream, shadows, raycasts, exclusion and ownership',()=>{const a=group(),b=group(),excludedA=a.children[2],excludedB=b.children[2],ownedA=new Set<BufferGeometry>(),ownedB=new Set<BufferGeometry>();baselineBake(a,ownedA,new Set([excludedA]));bakeRigidGroup(b,ownedB,new Set([excludedB]));const ma=a.children[1] as Mesh,mb=b.children[1] as Mesh;assert.deepEqual(stream(ma.geometry),stream(mb.geometry));assert.ok(mb.geometry.index);assert.equal(mb.castShadow,ma.castShadow);assert.equal(mb.receiveShadow,ma.receiveShadow);assert.equal(b.children[0],excludedB);assert.equal(ownedB.size,1);a.updateMatrixWorld(true);b.updateMatrixWorld(true);const ray=new Raycaster(new Vector3(0,0,5),new Vector3(0,0,-1));const hitsA=ray.intersectObject(ma),hitsB=ray.intersectObject(mb);assert.equal(hitsA.length,hitsB.length);hitsA.forEach((h,i)=>{assert.equal(h.faceIndex,hitsB[i].faceIndex);assert.deepEqual(h.point,hitsB[i].point);assert.deepEqual(h.uv,hitsB[i].uv);});let disposed=0;mb.geometry.addEventListener('dispose',()=>disposed++);ownedB.forEach(g=>g.dispose());assert.equal(disposed,1);});
test('custom shader, shader hooks and depth shaders never get new indexing',()=>{for(const mode of ['shader','hook','depth','renderHook','cacheKey']){const material=mode==='shader'?new ShaderMaterial():new MeshStandardMaterial();if(mode==='hook')material.onBeforeCompile=()=>{};const root=group(material as MeshStandardMaterial);if(mode==='depth')(root.children[0] as Mesh).customDepthMaterial=new ShaderMaterial();if(mode==='renderHook')(root.children[0] as Mesh).onBeforeRender=()=>{};if(mode==='cacheKey')material.customProgramCacheKey=()=> 'custom';bakeRigidGroup(root,new Set());assert.equal((root.children[0] as Mesh).geometry.index,null);}});
test('production models retain every attribute byte, triangle/material order and bounds',()=>{const rows=[];for(const recipe of ['egg-fried-rice','steak-dinner','corn-dog','pearl-milk-tea']){const baseline=baselineDish(recipe),candidate=createDishModel(recipe),old:Mesh[]=[],next:Mesh[]=[];baseline.root.traverse(o=>{if(o instanceof Mesh)old.push(o);});candidate.root.traverse(o=>{if(o instanceof Mesh)next.push(o);});assert.equal(old.length,next.length);let triangles=0,oldVertices=0,newVertices=0,oldBytes=0,newBytes=0;old.forEach((a,i)=>{const b=next[i],ga=a.geometry,gb=b.geometry;assert.deepEqual(stream(ga),stream(gb));assert.deepEqual(ga.groups,gb.groups);assert.deepEqual(ga.drawRange,gb.drawRange);assert.deepEqual(a.matrix.elements,b.matrix.elements);const mats=(m:Mesh)=>[m.material].flat().map(x=>({type:x.type,color:(x as MeshStandardMaterial).color?.getHex(),side:x.side,transparent:x.transparent}));assert.deepEqual(mats(a),mats(b));ga.computeBoundingBox();gb.computeBoundingBox();assert.deepEqual(ga.boundingBox,gb.boundingBox);triangles+=(ga.index?.count??ga.attributes.position.count)/3;oldVertices+=ga.attributes.position.count;newVertices+=gb.attributes.position.count;const bytes=(g:BufferGeometry)=>Object.values(g.attributes).reduce((s,a)=>s+a.array.byteLength,0)+(g.index?.array.byteLength??0);oldBytes+=bytes(ga);newBytes+=bytes(gb);});assert.ok(newVertices<oldVertices,recipe+' reference remains genuinely unindexed');assert.ok(newBytes<oldBytes,recipe+' exact tuple storage decreases');if(recipe in primaryStorageRatio)assert.ok(newBytes/oldBytes<=primaryStorageRatio[recipe as keyof typeof primaryStorageRatio],recipe+' primary CPU storage decision');rows.push({recipe,meshes:old.length,triangles,oldVertices,newVertices,oldBytes,newBytes});baseline.dispose();candidate.dispose();}console.log(JSON.stringify({production:rows}));});

test('NaN payloads are compared and copied by bits, not JS numeric equality',()=>{const g=fixture();g.setAttribute('normal',new Float32BufferAttribute(Array.from({length:18},(_,i)=>i%3===2?1:0),3));const bits=new Uint32Array([0x7fc00001,0x7fc00002,0x7fc00001,0x7fc00002,0x7fc00002,0x7fc00001]);g.setAttribute('custom',new BufferAttribute(new Float32Array(bits.buffer),1));const before=stream(g);assert.equal(indexExactAttributes(g),true);assert.equal(g.attributes.position.count,4);assert.deepEqual(stream(g),before);});
test('hash collisions do not merge unequal attribute bytes',()=>{const g=fixture();g.setAttribute('normal',new Float32BufferAttribute(Array.from({length:18},(_,i)=>i%3===2?1:0),3));const before=stream(g),imul=Math.imul;try{Math.imul=()=>0;assert.equal(indexExactAttributes(g),true);}finally{Math.imul=imul;}assert.equal(g.attributes.position.count,3);assert.deepEqual(stream(g),before);});

test('production baking checks original special layouts before cloning and merging',()=>{
 for(const mode of ['interleaved','float16','instanced','morph']){
  function make(){const root=group();for(const child of root.children){const g=(child as Mesh).geometry,n=g.attributes.position.count;
   if(mode==='interleaved')g.setAttribute('custom',new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(n*2).fill(.25),2),1,0));
   if(mode==='float16')g.setAttribute('custom',new Float16BufferAttribute(new Uint16Array(n).fill(0x3800),1));
   if(mode==='instanced')g.setAttribute('custom',new InstancedBufferAttribute(new Float32Array(n).fill(.25),1));
   if(mode==='morph')g.morphAttributes.position=[g.attributes.position.clone() as BufferAttribute];
  }return root;}
  const a=make(),b=make();baselineBake(a,new Set());bakeRigidGroup(b,new Set());const ga=(a.children[0] as Mesh).geometry,gb=(b.children[0] as Mesh).geometry;assert.equal(gb.index,null,mode);assert.deepEqual(stream(ga),stream(gb),mode);
 }
});
test('collision-heavy inputs fall back unchanged within bounded hashing work',()=>{
 const count=3000,g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(Array.from({length:count*3},(_,i)=>i),3));
 const before=g.attributes.position,original=Math.imul;let calls=0;
 try{Math.imul=()=>{calls++;return 0;};assert.equal(indexExactAttributes(g),false);}finally{Math.imul=original;}
 assert.equal(g.attributes.position,before);assert.equal(g.index,null);assert.ok(calls<=65*12,`hashed ${calls} bytes`);
});
