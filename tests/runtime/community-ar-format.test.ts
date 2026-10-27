import {test} from 'node:test';
import {withArCaptureFailureAttachment} from '../fixtures/community-ar/capture-diagnostics.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {decode,encode} from '@msgpack/msgpack';
import {inspectArTarget,inspectArExperience,createArExperience,combineArTargets,AR_TARGET_MAX_BYTES} from '../../packages/asset-storage/ar-target.js';
import {projectTarget} from '../../apps/portal-web/src/modules/community-ar/render.js';
import {trackingSize} from '../../apps/portal-web/src/modules/community-ar/camera.js';
import {readArPacket} from '../../apps/portal-web/src/modules/community-ar/packet.js';
import {effectScene,spatialGeometry,transform4,multiply4,previewProjection} from '../../apps/portal-web/src/modules/community-ar/spatial.js';

const bytes=readFileSync(new URL('../fixtures/community-ar/card.mind',import.meta.url));
test('AR-FMT-01 actual frozen SDK target is accepted, and media does not enter the inference packet',()=>{
  const shape=inspectArTarget(bytes);assert.deepEqual(shape.targetImage,{width:674,height:372});
  const extended=createArExperience(bytes,{version:1,kind:'text',text:'你好，自由工坊！'});
  assert.equal(inspectArExperience(extended).binding?.kind,'text');
  assert.equal(Object.hasOwn(decode(combineArTargets([extended])) as object,'freedomContent'),false);
});
test('AR-FMT-02 malformed/deep packets, foreign scripts and unsafe geometry are rejected before decoding/inference',()=>{
  assert.throws(()=>inspectArTarget(bytes.subarray(0,-1)));assert.throws(()=>inspectArTarget(new Uint8Array(AR_TARGET_MAX_BYTES+1)));
  const raw=decode(bytes) as any;raw.dataList[0].targetImage.width=Infinity;assert.throws(()=>inspectArTarget(encode(raw)));
  let nested:unknown=0;for(let i=0;i<32;i++)nested=[nested];assert.throws(()=>inspectArTarget(encode(nested)));
  assert.throws(()=>createArExperience(bytes,{version:1,kind:'effect',text:'',effect:'javascript:alert(1)'} as any));
  assert.throws(()=>createArExperience(bytes,{version:1,kind:'image',text:'',mime:'image/svg+xml',media:new TextEncoder().encode('<script/>')}));
});
test('AR-FMT-03 bad descriptor and cluster references cannot reach SDK arrays',()=>{
  const raw=decode(bytes) as any;raw.dataList[0].matchingData[0].maximaPoints[0].descriptors[0]=-1;assert.throws(()=>inspectArTarget(encode(raw)));
  const other=decode(bytes) as any;other.dataList[0].matchingData[0].maximaPointsCluster.rootNode.children[0].pointIndexes[0]=65536;assert.throws(()=>inspectArTarget(encode(other)));
  assert.throws(()=>combineArTargets(Array.from({length:9},()=>bytes)));
});
test('AR-FMT-04 known column-major pose projects onto the video plane; behind-camera/NaN quads are suppressed',()=>{
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  assert.deepEqual(projectTarget(identity,identity,[1,1],640,480),[[320,0],[640,0],[640,240],[320,240]]);
  const back=[...identity];back[15]=-1;assert.equal(projectTarget(back,identity,[1,1],640,480),null);
  const bad=[...identity];bad[0]=NaN;assert.equal(projectTarget(bad,identity,[1,1],640,480),null);
});
test('AR-FMT-05 installed self-hosted SDK files retain exact reviewed hashes and no inline worker factory',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../modules/community-ar/vendor/manifest.json',import.meta.url),'utf8'));
  for(const [name,hash] of Object.entries(manifest.browserAssets)){
    const file=readFileSync(new URL(`../../apps/portal-web/public/assets/${name}`,import.meta.url));
    assert.equal(createHash('sha256').update(file).digest('hex'),hash);
    if(name.startsWith('mindar-controller'))assert.equal(file.toString().includes('data:application/javascript;base64,'),false);
  }
});

test('AR-FMT-06 HD and portrait capture retain their field of view under the inference pixel budget',()=>{
  assert.deepEqual(trackingSize(1280,720),[640,360]);assert.deepEqual(trackingSize(1080,1920),[360,640]);
  assert.deepEqual(trackingSize(320,240),[320,240]);assert.deepEqual(trackingSize(640,480),[640,480]);
  for(const dimensions of [[0,720],[Infinity,480],[1280,-1],[1.5,10],[20000,100]])assert.throws(()=>trackingSize(...dimensions as [number,number]));
  for(const dimensions of [[4032,3024],[720,1280],[1920,1080]]){
    const [w,h]=trackingSize(...dimensions as [number,number]);assert.ok(Math.max(w,h)<=640);assert.ok(Math.abs(w/h-dimensions[0]/dimensions[1])<.005);
  }
});
test('AR-FMT-07 a small streamed pattern never reserves the old 20 MiB download arena',async()=>{
  const chunks=[new Uint8Array(512).fill(7),new Uint8Array(512).fill(9)];
  const response=new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close();}}));
  const Native=globalThis.Uint8Array,allocations:number[]=[];
  globalThis.Uint8Array=new Proxy(Native,{construct(target,args,newTarget){if(typeof args[0]==='number')allocations.push(args[0]);return Reflect.construct(target,args,newTarget);}});
  let result:Uint8Array;
  try{result=await readArPacket(response,new AbortController().signal);}finally{globalThis.Uint8Array=Native;}
  assert.equal(result.length,1024);assert.equal(result[511],7);assert.equal(result[512],9);
  assert.ok(allocations.length>0);assert.ok(Math.max(...allocations)<1024*1024,'a small stream must not reserve a maximum-sized arena');
});
test('AR-FMT-08 streamed scene overflow and an aborted stalled stream cancel the reader',async()=>{
  let cancelled=false;
  const oversized=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(65));},cancel(){cancelled=true;}}));
  await assert.rejects(readArPacket(oversized,new AbortController().signal,64),/ar_scene_size/);assert.equal(cancelled,true);
  let release!:()=>void;const reading=new Promise<void>(resolve=>release=resolve),control=new AbortController();let aborted=false;
  const stalled=new Response(new ReadableStream({pull(){release();},cancel(){aborted=true;}}));
  const pending=readArPacket(stalled,control.signal);await reading;control.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(aborted,true);
});
test('AR-FMT-09 original effect presets use bounded three-dimensional lit meshes and a real perspective transform',()=>{
  for(const effect of ['sparkle','halo','confetti'] as const){
    const scene=effectScene(effect,0);assert.ok(scene.length>3&&scene.length<=32);let triangles=0;
    for(const object of scene){
      assert.ok([...object.position,...object.rotation,...object.scale,...object.color,object.opacity].every(Number.isFinite));
      const geometry=spatialGeometry(object.mesh);triangles+=geometry.positions.length/9;
      assert.equal(geometry.positions.length,geometry.normals.length);assert.ok(geometry.positions.every(Number.isFinite));
      const depths=Array.from(geometry.positions).filter((_,i)=>i%3===2);assert.ok(Math.max(...depths)>Math.min(...depths));
      assert.ok(geometry.normals.every(Number.isFinite));
    }
    assert.ok(triangles<=4096);assert.notDeepEqual(scene,effectScene(effect,1000));assert.deepEqual(scene,effectScene(effect,NaN));
  }
  const projection=previewProjection(1.6),matrix=multiply4(projection,transform4([0,0,-2.4],[0,.4,0],[1,1,1]));
  assert.ok(matrix.every(Number.isFinite));assert.notEqual(matrix[3],0);assert.equal(projection[11],-1);
});

test('AR-DIAG-05 attachment is failure-only and never replaces original assertion identity',async()=>{
  const original=new Error('original assertion'),bodies:string[]=[];let reads=0;
  await withArCaptureFailureAttachment(async()=>{},async()=>{reads++;return {};},async body=>{bodies.push(body);});assert.equal(reads,0);
  await assert.rejects(withArCaptureFailureAttachment(async()=>{throw original;},async()=>{reads++;return {version:1,rows:[]};},async body=>{bodies.push(body);}),e=>e===original);
  assert.equal(reads,1);assert.deepEqual(JSON.parse(bodies[0]),{version:1,rows:[]});
  await assert.rejects(withArCaptureFailureAttachment(async()=>{throw original;},async()=>{throw new Error('secret');},async body=>{bodies.push(body);throw new Error('attachment failed');}),e=>e===original);
  assert.deepEqual(JSON.parse(bodies[1]),{version:1,unavailable:true});
});
test('AR-DIAG-06 unavailable browser reads or attachment cannot wait indefinitely',async()=>{
  const original={failure:true};let attached='';
  await assert.rejects(withArCaptureFailureAttachment(async()=>{throw original;},()=>new Promise(()=>{}),async body=>{attached=body;},5),e=>e===original);
  assert.deepEqual(JSON.parse(attached),{version:1,unavailable:true});
  await assert.rejects(withArCaptureFailureAttachment(async()=>{throw original;},async()=>({version:1}),()=>new Promise(()=>{}),5),e=>e===original);
});
