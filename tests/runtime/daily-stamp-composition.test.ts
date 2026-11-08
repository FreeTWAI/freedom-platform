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
// Fullscreen sizes, original shorter-host probes, then actual normal hosts
// after the existing arcade root gutters (12px at 320, otherwise 16px).
const sizes=[[320,568],[390,844],[667,375],[320,482],[390,758],[667,289],[296,482],[358,758],[635,289]] as const;
const view=(seed=42):StageView=>({game:'stamp',seed,seconds:0,client:0,pan:{x:0,y:0},fov:44,stampPoint:{x:0,y:0},raised:false,motion:true,stamp:domain.newStamps(seed)});
function bounds(points:{x:number;y:number}[]){return {left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};}
const paper=[[-1.5,.086,-1.85],[1.5,.086,-1.85],[1.5,.086,1.85],[-1.5,.086,1.85]] as const;
for(const [width,height] of sizes)test(`STAMP ${width}x${height}: full paper and every seed target stay in the clear 200% HUD work area`,t=>{
    const v=view(),camera=model.dailyCamera(v,width/height),old=new T.PerspectiveCamera(40,width/height,.1,60);
    old.position.set(0,5.3,2.7);old.lookAt(0,0,.23);old.updateMatrixWorld(true);
    assert.deepEqual(camera.matrixWorld.elements,old.matrixWorld.elements,'pose and look direction do not change');
    assert.equal(camera.aspect,old.aspect);assert.equal(camera.near,old.near);assert.equal(camera.far,old.far);
    if(width>=height)assert.deepEqual(camera.projectionMatrix.elements,old.projectionMatrix.elements,'landscape keeps the old projection');
    const pixels=(p:readonly[number,number,number])=>{const q=model.project(camera,p);return {x:(q.x+1)*width/2,y:(1-q.y)*height/2};};
    const b=bounds(paper.map(pixels));
    // These are deliberately conservative model-space guard rails for the
    // authored 200% text + {12,8,16,8}px inset HUD, not computed CSS evidence.
    const clear=width<height?{left:8,right:width-12,top:122,bottom:height-124}:{left:176,right:width-124,top:16,bottom:height-16};
    for(const p of paper){const q=model.project(camera,p),o=model.project(old,p),ratio=Math.tan(old.fov*Math.PI/360)/Math.tan(camera.fov*Math.PI/360);assert.ok(Math.abs(q.x-o.x*ratio)<1e-12);assert.ok(Math.abs(q.y-o.y*ratio)<1e-12);}
    assert.ok(b.left>=clear.left&&b.right<=clear.right&&b.top>=clear.top&&b.bottom<=clear.bottom,JSON.stringify({b,clear}));
    let minDiameter=Infinity;const all=[];
    for(const seed of [1,2,42,8675309,2147483647])for(let index=0;index<12;index++){
        const target=domain.stampTarget(seed,index),ring=Array.from({length:64},(_,i)=>{const a=i*Math.PI/32;return pixels([(target.x+Math.cos(a)*domain.RULES.stampRadius)*1.2,.086,(target.y+Math.sin(a)*domain.RULES.stampRadius)*1.5]);}),r=bounds(ring);
        assert.ok(r.left>clear.left&&r.right<clear.right&&r.top>clear.top&&r.bottom<clear.bottom);
        minDiameter=Math.min(minDiameter,r.right-r.left,r.bottom-r.top);
        const point=pixels([target.x*1.2,.086,target.y*1.5]),hit=model.paperPoint({...v,seed},{left:0,top:0,width,height},point.x,point.y)!;
        assert.ok(Math.hypot(hit.x-target.x,hit.y-target.y)<1e-12);
        assert.equal(domain.stamp({...domain.newStamps(seed,false),index},index,hit,0).kind,'hit');
        all.push({seed,index,...r});
    }
    t.diagnostic(JSON.stringify({width,height,effectiveFov:camera.fov,oldFov:40,paper:b,clear,minTargetDiameter:minDiameter,targets:all}));
});

test('STAMP turned handle is finite solid radial geometry with a real narrow waist and broad grip',()=>{
    const g=createStampHandleGeometry();g.computeBoundingBox();const p=g.getAttribute('position'),n=g.getAttribute('normal');
    assert.equal(p.count,14*33);assert.equal(g.index!.count,13*32*6);
    assert.ok(Math.abs(g.boundingBox!.min.y-.18)<1e-6);assert.ok(Math.abs(g.boundingBox!.max.y-.91)<1e-6);
    for(let i=0;i<p.count;i++){for(const value of [p.getX(i),p.getY(i),p.getZ(i),n.getX(i),n.getY(i),n.getZ(i)])assert.ok(Number.isFinite(value));assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);}
    const radius=(y:number)=>Math.max(...Array.from({length:p.count},(_,i)=>Math.abs(p.getY(i)-y)<1e-5?Math.hypot(p.getX(i),p.getZ(i)):0));
    assert.ok(radius(.72)>radius(.49)*2.8);assert.ok(radius(.20)>radius(.49)*1.8);g.dispose();
});

// Execute the real native factory/Three meshes with controlled renderer and DOM
// ports. No GPU, raster image, browser or touch acceptance is implied.
function native(width:number,height:number,unbatchedCrab=false){
    let scene:T.Scene,camera:T.PerspectiveCamera,removed=0,disposed=0,lost=0,disconnected=0;
    class Renderer{
        domElement={setAttribute(){},addEventListener(){},removeEventListener(){},remove(){removed++;}};shadowMap={};info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};
        setSize(){}setPixelRatio(){}dispose(){disposed++;}forceContextLoss(){lost++;}render(s:T.Scene,c:T.PerspectiveCamera){scene=s;camera=c;}
    }
    const context=new Proxy({},{get:()=>()=>{},set:()=>true});
    const document={createElement(){return {width:0,height:0,getContext:()=>context};}};
    const exports={exports:{} as {createStage:(host:unknown,lost:()=>void)=>Stage}};
    let source=readFileSync(new URL('../../apps/portal-web/src/games/stage.ts',import.meta.url),'utf8');
    if(unbatchedCrab){const call='bakeRigidGroup(crab,geometries);';assert.ok(source.includes(call));source=source.replace(call,'');}
    runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{
        module:exports,exports:exports.exports,document,window:{devicePixelRatio:1},ResizeObserver:class{observe(){}disconnect(){disconnected++;}},
        require:(id:string)=>{if(id==='three')return {...T,WebGLRenderer:Renderer};if(id.includes('RoundedBox'))return {RoundedBoxGeometry};if(id.includes('BufferGeometryUtils'))return {mergeGeometries};if(id==='./stage-batch')return {bakeRigidGroup};if(id==='./stamp-tool')return {createStampHandleGeometry};if(id==='./daily-scene-model')return model;if(id==='./domain')return domain;throw Error(id);},
    });
    const stage=exports.exports.createStage({clientWidth:width,clientHeight:height,append(){},getBoundingClientRect:()=>({left:0,top:0,width,height})},()=>{});
    return {stage,scene:()=>scene!,camera:()=>camera!,cleanup:()=>({removed,disposed,lost,disconnected})};
}
for(const [width,height]of sizes)test(`STAMP actual native factory ${width}x${height} uses shared camera/contact, stable meshes and one-time disposal`,()=>{
    const h=native(width,height),v=view();h.stage.update(v);
    const expected=model.dailyCamera(v,width/height);assert.deepEqual(h.camera().projectionMatrix.elements,expected.projectionMatrix.elements);
    assert.deepEqual(h.camera().matrixWorld.elements,expected.matrixWorld.elements);
    const handle=h.scene().getObjectByName('stamp-turned-handle') as T.Mesh;assert.ok(handle?.isMesh);assert.equal(handle.geometry.type,'LatheGeometry');
    let count=0,triangles=0;const resources=new Set<T.BufferGeometry|T.Material|T.Texture>();
    h.scene().traverse(o=>{if(!(o instanceof T.Mesh))return;count++;triangles+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3;resources.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){resources.add(m);const map=(m as T.MeshBasicMaterial).map;if(map)resources.add(map);}});
    assert.ok(count<100,`meshes ${count}`);assert.ok(triangles<100000,`triangles ${triangles}`);
    const center=domain.stampTarget(42,0),point=model.project(expected,[center.x*1.2,.086,center.y*1.5]);
    const contact=h.stage.point((point.x+1)*width/2,(1-point.y)*height/2)!;assert.ok(Math.hypot(contact.x-center.x,contact.y-center.y)<1e-12);
    let stamps=domain.newStamps(42);stamps=domain.stamp(stamps,-1,contact,0).state;
    for(let index=0;index<12;index++){
        const target=domain.stampTarget(42,index),p=model.project(expected,[target.x*1.2,.086,target.y*1.5]),hit=h.stage.point((p.x+1)*width/2,(1-p.y)*height/2)!;
        stamps=domain.stamp(stamps,index,hit,(index+1)*220).state;h.stage.update({...v,stamp:stamps,stampPoint:hit,seconds:(index+1)*.22});
        assert.equal(stamps.index,index+1);assert.equal(stamps.misses,0);assert.equal(h.scene().getObjectByName('stamp-turned-handle'),handle);
    }
    const disposals=new Map<unknown,number>();for(const r of resources)r.addEventListener('dispose',()=>disposals.set(r,(disposals.get(r)??0)+1));
    // Current paper texture replaced old textures during play; observe current
    // resources too, while old resources disposed before observation are omitted.
    h.stage.dispose();h.stage.dispose();assert.equal(disposals.get(handle.geometry),1);
    for(const times of disposals.values())assert.equal(times,1);
    assert.deepEqual(h.cleanup(),{removed:1,disposed:1,lost:1,disconnected:1});
});

// Compare actual factory geometry, not a lower-detail substitute. The reference
// disables only the new crab bake; both factories run the same animation code.
test('STAMP rigid crab batching retains animated triangle attributes and shadows with 22 fewer submissions',t=>{
 const reference=native(1440,900,true),candidate=native(1440,900),v=view();
 function crab(scene:T.Scene){let found:T.Group|undefined;scene.traverse(o=>{if(o instanceof T.Group&&o.position.y===.2&&o.position.z===.10)found=o;});assert.ok(found);return found;}
 function stream(root:T.Group){
  root.updateWorldMatrix(true,true);const streams=new Map<string,number[]>();
  root.traverse(o=>{if(!(o instanceof T.Mesh))return;const m=o.material as T.MeshToonMaterial,key=[m.type,m.color.getHex(),m.side,m.transparent,o.castShadow,o.receiveShadow].join('/'),values=streams.get(key)??[];streams.set(key,values);
   const g=o.geometry,normals=new T.Matrix3().getNormalMatrix(o.matrixWorld),position=g.getAttribute('position'),normal=g.getAttribute('normal'),uv=g.getAttribute('uv');
   for(let j=0;j<(g.index?.count??position.count);j++){const i=g.index?.getX(j)??j,p=new T.Vector3().fromBufferAttribute(position,i).applyMatrix4(o.matrixWorld),n=new T.Vector3().fromBufferAttribute(normal,i).applyNormalMatrix(normals);values.push(...p.toArray(),...n.toArray(),uv.getX(i),uv.getY(i));}
  });return streams;
 }
 function submissions(scene:T.Scene){let count=0;scene.traverseVisible(o=>{if(o instanceof T.Mesh)count+=1+Number(o.castShadow);});return count;}
 let oldCalls=0,newCalls=0;
 for(const seconds of [0,.22,3]){
  reference.stage.update({...v,seconds});candidate.stage.update({...v,seconds});const a=crab(reference.scene()),b=crab(candidate.scene());
  assert.equal(a.children.length,15);assert.equal(b.children.length,4);assert.deepEqual(a.position,b.position);assert.deepEqual(a.quaternion.toArray(),b.quaternion.toArray());
  const before=stream(a),after=stream(b);assert.deepEqual([...before.keys()].sort(),[...after.keys()].sort());
  for(const [key,values]of before){const actual=after.get(key)!;assert.equal(actual.length,values.length);for(let i=0;i<values.length;i++)assert.ok(Math.abs(actual[i]-values[i])<1e-6,`${key} attribute ${i}`);}
  oldCalls=submissions(reference.scene());newCalls=submissions(candidate.scene());assert.equal(oldCalls-newCalls,22);assert.ok(newCalls<=75,`conservative visible color+shadow submissions ${newCalls}`);
 }
 const resources=new Set<T.BufferGeometry>();crab(candidate.scene()).traverse(o=>{if(o instanceof T.Mesh)resources.add(o.geometry);});const disposed=new Map<T.BufferGeometry,number>();for(const g of resources)g.addEventListener('dispose',()=>disposed.set(g,(disposed.get(g)??0)+1));
 candidate.stage.dispose();candidate.stage.dispose();for(const g of resources)assert.equal(disposed.get(g),1);reference.stage.dispose();
 t.diagnostic(JSON.stringify({oldCalls,newCalls,note:'CPU visible submission upper bound, not WebGL measured calls'}));
});
