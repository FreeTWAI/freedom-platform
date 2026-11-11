import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import * as model from '../../apps/portal-web/src/games/daily-scene-model.js';
import * as domain from '../../apps/portal-web/src/games/domain.js';
import {createStampHandleGeometry} from '../../apps/portal-web/src/games/stamp-tool.js';
import {bakeRigidGroup} from '../../apps/portal-web/src/games/stage-batch.js';
import type {Stage,StageView} from '../../apps/portal-web/src/games/stage.js';
// CPU execution of the actual native factory. The old construction fixture is
// verbatim from d141d90243f0f23162383567d071bfb791d500d2 (also 97ca2c0).
// A controlled renderer is not GPU timing, raster or browser acceptance.
function native(width:number,height:number,baseline=false){
    let scene:T.Scene,camera:T.PerspectiveCamera,removed=0,disposed=0,lost=0,disconnected=0;
    class Renderer{
        domElement={setAttribute(){},addEventListener(){},removeEventListener(){},remove(){removed++;}};shadowMap={};info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};
        setSize(){}setPixelRatio(){}dispose(){disposed++;}forceContextLoss(){lost++;}render(s:T.Scene,c:T.PerspectiveCamera){scene=s;camera=c;}
    }
    const context=new Proxy({},{get:()=>()=>{},set:()=>true});
    const document={createElement(){return {width:0,height:0,getContext:()=>context};}};
    const exports={exports:{} as {createStage:(host:unknown,lost:()=>void)=>Stage}};
    let source=readFileSync(new URL('../../apps/portal-web/src/games/stage.ts',import.meta.url),'utf8');
    if(baseline){
        const before=readFileSync(new URL('./fixtures/cash-stack-build-baseline.txt',import.meta.url),'utf8');
        const start=source.indexOf('    function buildCash()'),end=source.indexOf('    function replaceTexture',start);
        assert.ok(start>0&&end>start);source=source.slice(0,start)+before+source.slice(end);
        const update='if (cashTower) cashTower.count = view.cash.index - view.cash.rejected;';assert.ok(source.includes(update));
        source=source.replace(update,'tower?.children.forEach((m, i) => { m.visible = i < view.cash!.index - view.cash!.rejected; });');
    }
    runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{
        module:exports,exports:exports.exports,document,window:{devicePixelRatio:1},ResizeObserver:class{observe(){}disconnect(){disconnected++;}},
        require:(id:string)=>{if(id==='three')return {...T,WebGLRenderer:Renderer};if(id.includes('RoundedBox'))return {RoundedBoxGeometry};if(id.includes('BufferGeometryUtils'))return {mergeGeometries};if(id==='./stage-batch')return {bakeRigidGroup};if(id==='./stamp-tool')return {createStampHandleGeometry};if(id==='./daily-scene-model')return model;if(id==='./domain')return domain;throw Error(id);},
    });
    const stage=exports.exports.createStage({clientWidth:width,clientHeight:height,append(){},getBoundingClientRect:()=>({left:0,top:0,width,height})},()=>{});
    return {stage,scene:()=>scene!,camera:()=>camera!,cleanup:()=>({removed,disposed,lost,disconnected})};
}
const view=(seed=42):StageView=>({game:'cash',seed,seconds:0,client:0,pan:{x:0,y:0},fov:44,stampPoint:{x:0,y:0},raised:false,motion:true,cash:domain.newCash(seed)});
const current=(scene:T.Scene)=>scene.getObjectByName('cash-accepted-stack') as T.InstancedMesh;
function previous(scene:T.Scene){let stack:T.Group|undefined;scene.traverse(o=>{if(o instanceof T.Group&&o.position.x===2.6&&o.position.y===.04&&o.position.z===-.15)stack=o;});assert.ok(stack);return stack;}
const material=(m:T.Material)=>{const t=m as T.MeshToonMaterial;return {type:t.type,color:t.color.getHex(),side:t.side,transparent:t.transparent,depthTest:t.depthTest,depthWrite:t.depthWrite,gradient:[...((t.gradientMap!.image as {data:Uint8Array}).data)]};};
function submissions(scene:T.Scene){let calls=0;scene.traverseVisible(o=>{if(o instanceof T.Mesh&&(!(o instanceof T.InstancedMesh)||o.count>0))calls+=1+Number(o.castShadow);});return calls;}
function compare(reference:ReturnType<typeof native>,candidate:ReturnType<typeof native>,accepted:number){
 const a=previous(reference.scene()),b=current(candidate.scene());assert.ok(b?.isInstancedMesh);assert.equal(b.count,accepted);
 const bills=a.children.filter(o=>o.visible) as T.Mesh[];assert.equal(bills.length,accepted);assert.equal(b.instanceMatrix.count,24);
 const position=b.geometry.getAttribute('position'),normal=b.geometry.getAttribute('normal'),uv=b.geometry.getAttribute('uv');
 for(const [i,bill]of bills.entries()){
  assert.deepEqual(material(b.material as T.Material),material(bill.material as T.Material));
  assert.equal(b.castShadow,bill.castShadow);assert.equal(b.receiveShadow,bill.receiveShadow);
  assert.deepEqual([...b.geometry.index?.array??[]],[...bill.geometry.index?.array??[]]);
  for(const name of Object.keys(b.geometry.attributes))assert.deepEqual(b.geometry.getAttribute(name).array,bill.geometry.getAttribute(name).array,'same original geometry attributes');
  const instance=new T.Matrix4();b.getMatrixAt(i,instance);const matrix=new T.Matrix4().multiplyMatrices(b.matrixWorld,instance),n=new T.Matrix3().getNormalMatrix(matrix),oldNormal=new T.Matrix3().getNormalMatrix(bill.matrixWorld);
  // Compare every triangle corner, including normals and UVs. Float32 instance
  // matrices have the same sub-microunit tolerance as the existing rigid bake.
  for(let j=0;j<(b.geometry.index?.count??position.count);j++){
   const k=b.geometry.index?.getX(j)??j,p=new T.Vector3().fromBufferAttribute(position,k),q=p.clone().applyMatrix4(matrix),old=p.clone().applyMatrix4(bill.matrixWorld);
   assert.ok(q.distanceTo(old)<1e-6);assert.ok(b.boundingBox!.containsPoint(p.clone().applyMatrix4(instance)));
   const v=new T.Vector3().fromBufferAttribute(normal,k);assert.ok(v.clone().applyNormalMatrix(n).distanceTo(v.applyNormalMatrix(oldNormal))<1e-6);
   assert.equal(uv.getX(k),bill.geometry.getAttribute('uv').getX(k));assert.equal(uv.getY(k),bill.geometry.getAttribute('uv').getY(k));
  }
 }
 assert.deepEqual(candidate.camera().projectionMatrix.elements,reference.camera().projectionMatrix.elements);
 assert.deepEqual(candidate.camera().matrixWorld.elements,reference.camera().matrixWorld.elements);
 assert.equal(submissions(reference.scene())-submissions(candidate.scene()),Math.max(0,accepted-1)*2);
}
test('CASH production instancing preserves every accepted bill through all cards, mistakes, replay, seed change and disposal',t=>{
 const reference=native(667,375,true),candidate=native(667,375),v=view(),owned=new Map<T.InstancedMesh,number>(),resources=new Map<T.BufferGeometry|T.Material|T.Texture,number>();
 const observe=()=>{const mesh=current(candidate.scene());if(!owned.has(mesh)){owned.set(mesh,0);mesh.addEventListener('dispose',()=>owned.set(mesh,owned.get(mesh)!+1));}};
 const draw=()=>{reference.stage.update(v);candidate.stage.update(v);observe();compare(reference,candidate,v.cash!.index-v.cash!.rejected);
  const own=(r:T.BufferGeometry|T.Material|T.Texture)=>{if(!resources.has(r)){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)!+1));}};
  candidate.scene().traverse(o=>{if(o instanceof T.Mesh){own(o.geometry);for(const m of [o.material].flat()){own(m);const map=(m as T.MeshBasicMaterial).map;if(map)own(map);const gradient=(m as T.MeshToonMaterial).gradientMap;if(gradient)own(gradient);}}});
 };
 for(const seed of [42,42,8675309]){
  v.seed=seed;v.cash=domain.newCash(seed);draw();const stack=current(candidate.scene());
  for(const [index,card]of domain.cashDeck(seed).entries()){
   const now=index*400;
   // Real wrong classification neither consumes a bill nor changes the stack.
   const oldIndex:number=v.cash!.index,oldAmount:number=v.cash!.amount;
   v.cash=domain.sortCash(v.cash,index,!card.valid,now).state;draw();assert.equal(v.cash.index,oldIndex);assert.equal(v.cash.amount,oldAmount);
   v.cash=domain.sortCash(v.cash,index,card.valid,now+200).state;v.seconds=(now+200)/1000;draw();assert.equal(current(candidate.scene()),stack);
   assert.equal(v.cash.index,index+1);
  }
  assert.equal(v.cash.amount,1000000);assert.equal(v.cash.rejected,6);assert.equal(v.cash.mistakes,30);assert.notEqual(v.cash.endedAt,null);
 }
 assert.equal(owned.size,2,'same-seed replay reuses instances; changed seed owns a new stack');
 candidate.stage.dispose();candidate.stage.dispose();reference.stage.dispose();reference.stage.dispose();
 for(const count of owned.values())assert.equal(count,1,'every instance allocation disposed exactly once');
 for(const count of resources.values())assert.equal(count,1,'observed geometry, materials and textures disposed exactly once');
 assert.deepEqual(candidate.cleanup(),{removed:1,disposed:1,lost:1,disconnected:1});
 t.diagnostic('At 24 accepted cards: 48 -> 2 CPU color+shadow stack submissions; unchanged triangles, not measured GPU timing.');
});
