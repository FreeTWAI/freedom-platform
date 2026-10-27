import {test} from 'node:test';
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

// Test the actual init-script source in a synthetic DOM/native-method VM, not a
// substitute implementation. These checks do not claim real browser scheduling.
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {withArCaptureFailureAttachment} from '../fixtures/community-ar/capture-diagnostics.js';
function diagnosticFixture(){
  const calls:unknown[][]=[],listeners=new Map<string,(event:unknown)=>void>();let clock=0,mutation=()=>{},callback:Function|undefined;
  const originalError=new Error('private media URL must never enter records');
  let drawThrows=false,blobThrows=false;
  class ElementFixture{
    disabled=false;renderer='webgl';
    closest(selector:string){return selector==='.ar-shutter'?shutter:selector==='.ar-scanner'?root:null;}
    hasAttribute(name:string){return name==='disabled'&&this.disabled;}
    getAttribute(name:string){return name==='data-renderer'?this.renderer:null;}
    querySelector(selector:string):unknown{return elements[selector]??null;}
  }
  class CanvasFixture extends ElementFixture{
    width=674;height=372;
    getContext(kind:string){assert.equal(kind,'2d');return new ContextFixture(this);}
    toBlob(...args:unknown[]){if(!(this instanceof CanvasFixture))throw originalError;calls.push(['blob',this,...args]);if(blobThrows)throw originalError;callback=args[0] as Function;return 'native-blob-return';}
  }
  class ContextFixture{
    constructor(readonly canvas:CanvasFixture){}
    drawImage(...args:unknown[]){if(!(this instanceof ContextFixture))throw originalError;calls.push(['draw',this,...args]);if(drawThrows)throw originalError;return 'native-draw-return';}
  }
  const video=new ElementFixture(),flat=new CanvasFixture(),spatial=new CanvasFixture(),shutter=new ElementFixture(),root=new ElementFixture();
  const elements:Record<string,unknown>={'.ar-stage video':video,'.ar-flat-layer':flat,'.ar-spatial-layer':spatial,'.ar-shutter':shutter};
  const window={} as {__arCaptureDiagnosticRead:()=>{rows:Array<Record<string,unknown>>;dropped:number;candidates:number;candidateLimitHits:number;truncated:boolean}};
  const exports:{}={};
  const source=readFileSync(new URL('../fixtures/community-ar/capture-diagnostics.ts',import.meta.url),'utf8');
  const code=transformSync(source,{loader:'ts',format:'cjs',target:'es2023'}).code;
  const module={exports};
  const environment={
    module,exports,window,Element:ElementFixture,HTMLCanvasElement:CanvasFixture,CanvasRenderingContext2D:ContextFixture,
    File,performance:{now:()=>++clock},document:{createElement:(tag:string)=>{assert.equal(tag,'canvas');return new CanvasFixture();},addEventListener:(name:string,fn:(event:unknown)=>void,capture:boolean)=>{assert.equal(capture,true);listeners.set(name,fn);}},
    MutationObserver:class {constructor(fn:()=>void){mutation=fn;}observe(target:unknown){assert.equal(target,root);}},
    // Deliberately no RAF/timers/network/URL/pixel-read facilities in this VM.
  };
  runInNewContext(code,environment);
  // Exercise the serialized initializer, as Playwright does, without module closure.
  runInNewContext('('+ (module.exports as {installArCaptureDiagnostics:Function}).installArCaptureDiagnostics.toString()+')()',environment);
  const renderModule={exports:{}};
  const render=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/community-ar/render.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2023'}).code;
  runInNewContext(render,{...environment,module:renderModule,exports:renderModule.exports});
  const actualCapture=()=>{Object.assign(video,{readyState:2,videoWidth:674,videoHeight:372,srcObject:{}});return (renderModule.exports as {captureArPhoto:(...args:unknown[])=>Promise<File>}).captureArPhoto(video,flat,spatial);};
  const arm=()=>listeners.get('click')!({target:shutter});
  const capture=()=>{const canvas=new CanvasFixture(),context=new ContextFixture(canvas);context.drawImage(video,0,0,674,372);context.drawImage(flat,0,0,674,372);context.drawImage(spatial,0,0,674,372);return {canvas,context};};
  return {calls,window,arm,capture,actualCapture,video,flat,spatial,shutter,elements,mutation:()=>mutation(),CanvasFixture,ContextFixture,originalError,setDrawThrows:()=>{drawThrows=true;},setBlobThrows:()=>{blobThrows=true;},callback:()=>callback!};
}
test('AR-DIAG-01 native draw and blob arguments, returns, callback receiver and original errors survive',()=>{
  const f=diagnosticFixture();f.arm();const {canvas}=f.capture();let received:unknown[]=[];const receiver={};
  const callback=function(this:unknown,...args:unknown[]){received=[this,...args];return 27;};
  assert.equal(canvas.toBlob(callback,'image/jpeg',0.92),'native-blob-return');
  const blob={size:91,type:'image/jpeg',secret:'must not be serialized'};
  assert.equal(f.callback().call(receiver,blob),27);assert.deepEqual(received,[receiver,blob]);
  f.callback().call(undefined,blob);assert.equal(received[0],undefined);
  assert.deepEqual(f.calls.at(-1)!.slice(2).slice(1),['image/jpeg',0.92]);assert.equal(f.calls.at(-1)![1],canvas);
  const data=f.window.__arCaptureDiagnosticRead();
  assert.deepEqual(Array.from(data.rows.filter(r=>String(r.event).startsWith('blob')).map(r=>r.event)),['blob-entry','blob-return','blob-callback','blob-callback']);
  assert.equal(JSON.stringify(data).includes('secret'),false);
  const g=diagnosticFixture();g.arm();g.setDrawThrows();assert.throws(()=>g.capture(),e=>e===g.originalError);
  assert.equal(g.window.__arCaptureDiagnosticRead().rows.at(-1)?.event,'draw-throw');
  const h=diagnosticFixture();h.arm();const c=h.capture().canvas;h.setBlobThrows();assert.throws(()=>c.toBlob(()=>{},'image/jpeg',0.92),e=>e===h.originalError);
  assert.equal(h.window.__arCaptureDiagnosticRead().rows.at(-1)?.event,'blob-throw');
});
test('AR-DIAG-02 tracker video draws alone are never classified as a completed photo composite',()=>{
  const f=diagnosticFixture();const unarmed=f.capture().canvas;unarmed.toBlob(()=>{},'image/jpeg',0.92);
  assert.equal(f.window.__arCaptureDiagnosticRead().rows.length,0);
  f.arm();const tracker=new f.CanvasFixture(),ctx=new f.ContextFixture(tracker);ctx.drawImage(f.video,0,0);ctx.drawImage(f.video,0,0);tracker.toBlob(()=>{},'image/jpeg',0.92);
  assert.equal(f.window.__arCaptureDiagnosticRead().rows.some(r=>r.event==='blob-entry'),false);
  const capture=f.capture().canvas;capture.toBlob(()=>{},'image/jpeg',0.92);
  assert.equal(f.window.__arCaptureDiagnosticRead().rows.filter(r=>r.event==='blob-entry').length,1);
});
test('AR-DIAG-03 delayed/null callback and DOM transitions remain separate scalar evidence',()=>{
  const f=diagnosticFixture();f.arm();f.capture().canvas.toBlob(()=>{},'image/jpeg',0.92);
  assert.equal(f.window.__arCaptureDiagnosticRead().rows.some(r=>r.event==='blob-callback'),false);
  f.shutter.disabled=true;f.mutation();f.callback()(null);
  f.elements['.ar-photo-share']={};f.mutation();f.elements['.ar-photo-share img']={src:'private-url'};f.mutation();
  const data=f.window.__arCaptureDiagnosticRead();assert.equal(data.rows.find(r=>r.event==='blob-callback')?.ok,false);
  assert.deepEqual(Array.from(data.rows.filter(r=>r.event==='dom').map(r=>r.state)),[0,1,3,7]);
  assert.equal(JSON.stringify(data).includes('private'),false);
});
test('AR-DIAG-04 buffers and canvas candidates are bounded; collection returns detached rows',()=>{
  const f=diagnosticFixture();f.arm();for(let i=0;i<100;i++)f.capture();
  for(let i=0;i<1000;i++){f.shutter.disabled=!f.shutter.disabled;f.mutation();}
  const data=f.window.__arCaptureDiagnosticRead();assert.equal(data.candidates,8);assert.equal(data.rows.length,256);assert.ok(data.dropped>0);assert.ok(data.candidateLimitHits>0);assert.equal(data.truncated,true);
  data.rows[0].event='tampered';assert.equal(f.window.__arCaptureDiagnosticRead().rows[0].event,'click');
  for(const row of data.rows.slice(1))for(const value of Object.values(row))assert.ok(['string','number','boolean'].includes(typeof value));
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

test('AR-DIAG-07 actual captureArPhoto completes ordered composite through installed native wrappers',async()=>{
  const f=diagnosticFixture();f.arm();const pending=f.actualCapture();
  let settled=false;void pending.then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);
  const before=f.window.__arCaptureDiagnosticRead();
  assert.deepEqual(Array.from(before.rows.filter(r=>r.event==='draw-return').map(r=>r.source)),[1,2,3]);
  assert.equal(before.rows.find(r=>r.event==='blob-entry')?.state,3);
  const blob=new Blob([new Uint8Array(91)],{type:'image/jpeg'});f.callback()(blob);
  const file=await pending;assert.equal(file.size,91);assert.equal(file.type,'image/jpeg');
  assert.equal(f.window.__arCaptureDiagnosticRead().rows.at(-1)?.event,'blob-callback');
});
test('AR-DIAG-08 E2E installs diagnostics before navigation and preserves the original capture assertion',()=>{
  const source=readFileSync(new URL('../e2e/community-ar.spec.ts',import.meta.url),'utf8');
  const body=source.slice(source.indexOf("test('AR-UI-05"),source.indexOf("test('AR-UI-06"));
  const install=body.indexOf('await page.addInitScript(installArCaptureDiagnostics);');
  assert.ok(install>=0&&install<body.indexOf('await page.goto(path)'));
  assert.ok(body.includes('test.setTimeout(90000)'));
  assert.ok(body.includes("await expect(page.getByRole('img',{name:'剛拍攝的相機與 AR 合成照片'})).toBeVisible();"));
  assert.equal(body.includes('toBeVisible({timeout:'),false);
  assert.ok(body.includes("body=>testInfo.attach('ar-capture-stages.json'"));
});

test('AR-DIAG-09 passthrough retains zero arguments and native invalid-receiver errors',()=>{
  const f=diagnosticFixture();f.arm();const canvas=new f.CanvasFixture();
  assert.equal(canvas.toBlob(),'native-blob-return');assert.equal(f.calls.at(-1)!.length,2);
  assert.throws(()=>Reflect.apply(f.CanvasFixture.prototype.toBlob,null,[]),e=>e===f.originalError);
  assert.throws(()=>Reflect.apply(f.ContextFixture.prototype.drawImage,null,[]),e=>e===f.originalError);
});
