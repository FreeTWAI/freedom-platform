import {createCoatingHold,coatingKeyOwner} from '../../apps/portal-web/src/games/cooking/coating-hold.js';
import * as jsxRuntime from 'react/jsx-runtime';
import {validateGameUploadSource,GAME_UPLOAD_SOURCE_MAX_BYTES,GameUploadSourceError} from '../../modules/absurd-daily/game-upload-source.js';
import {blankGameSubmission,prepareGameSubmission,GAME_SUBMISSION_LIMITS} from '../../apps/portal-web/src/games/community-game-submission.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {transformSync} from 'esbuild';
import {parseDishInit,parseDishView,parseDishReply,nextDishView} from '../../apps/portal-web/src/games/cooking/dish-worker-protocol.js';
import {newMarket} from '../../apps/portal-web/src/games/cooking/market-domain.js';

test('UX-15g restored completed guided run skips kitchen startup while restart and retry retain real capture (non-native)',async()=>{
 const code=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/cooking/CookingScene.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code.replace('import("./kitchen-stage")','Promise.resolve().then(()=>require("./kitchen-stage"))');
 const slots:any[]=[],effects:Array<()=>void>=[],buttons:any[]=[];let index=0,dirty=false,imports=0,creates=0,disposed=0,updates=0;
 const same=(a:any[],b:any[])=>a?.length===b?.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={useRef:(value:any)=>{const i=index++;return slots[i]??(slots[i]={current:value});},useState:(value:any)=>{const i=index++;if(!slots[i])slots[i]={value:typeof value==='function'?value():value};return [slots[i].value,(next:any)=>{const v=typeof next==='function'?next(slots[i].value):next;if(!Object.is(v,slots[i].value)){slots[i].value=v;dirty=true;}}];},useEffect:(fn:()=>any,deps:any[])=>{const i=index++,old=slots[i];if(!old||!same(old.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
 const jsx=(type:any,props:any)=>{if(type==='div'&&props.ref)props.ref.current={dataset:{}};if(type==='button')buttons.push(props);return {type,props};};
 const stage={update:()=>updates++,capture:()=> 'actual-stage-snapshot',stats:()=>({calls:1,triangles:2,geometries:3,textures:4}),dispose:()=>disposed++};
 const module={exports:{} as any};let run:any={status:'done',active:{count:0}};const captureRef={current:null as any},onSettled=()=>{};
 runInNewContext(code,{module,exports:module.exports,performance:{now:()=>1},matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}}),requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},require:(path:string)=>{
  if(path==='react')return hooks;if(path==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};
  if(path==='./kitchen-stage'){imports++;return {createKitchenStage:()=>{creates++;return stage;}};}
  if(path==='./domain')return {currentStep:()=>({kind:'mix',directions:[]}),plateTarget:()=>({x:.5,y:.5}),cutGuide:()=>.5};
  if(path==='./catalog')return {KITCHEN_VIEW:{loaderMs:15000}};if(path==='../diagnostics')return {syncDiagnostics(){}};return {CookingScene:()=>null};
 }});
 const capture=()=>{const fn:unknown=captureRef.current;assert.equal(typeof fn,'function');return (fn as (value:unknown)=>string)(run);};
 const render=()=>{index=0;dirty=false;buttons.length=0;module.exports.CookingScene({run,point:null,readRun:()=>run,captureRef,onSettled});while(effects.length)effects.shift()!();};
 const settle=async()=>{for(let n=0;n<12;n++){if(dirty)render();await Promise.resolve();}};
 render();await settle();assert.equal(imports,0);assert.equal(creates,0);assert.equal(captureRef.current,null);
 // Restored results expose no dead retry control while the parent exports.
 assert.equal(buttons[0].disabled,true);assert.equal(buttons[0].children,'料理已完成');assert.equal(imports,0);
 run={...run,status:'ready'};render();await settle();assert.equal(buttons[0].disabled,false);assert.equal(imports,1);assert.equal(creates,1);assert.equal(capture(),'actual-stage-snapshot');
 run={...run,status:'playing'};render();await settle();run={...run,status:'done'};render();await settle();assert.equal(disposed,0);assert.equal(capture(),'actual-stage-snapshot');assert.ok(updates>0);
 buttons[0].onClick();await settle();assert.equal(disposed,1);assert.equal(captureRef.current,null);
 buttons[0].onClick();await settle();assert.equal(creates,2);assert.equal(capture(),'actual-stage-snapshot');
 for(const slot of slots)slot?.cleanup?.();assert.equal(disposed,2);
});

test('UX-15f worker initialization validates bounded canvas, recipe and actual market snapshot',()=>{
 // Structural protocol unit test only; this class is not native rendering evidence.
 const previous=Object.getOwnPropertyDescriptor(globalThis,'OffscreenCanvas');class Canvas{}
 Object.defineProperty(globalThis,'OffscreenCanvas',{configurable:true,value:Canvas});
 try{
  const valid={version:1,kind:'init',owner:1,canvas:new Canvas(),recipe:'corn-dog',pixelRatio:1.5,snapshot:newMarket('corn-dog',42)};
  assert.ok(parseDishInit(valid));assert.notEqual(parseDishInit(valid)?.snapshot,valid.snapshot);
  for(const patch of [{version:2},{owner:NaN},{pixelRatio:Infinity},{pixelRatio:2},{recipe:'missing'},{canvas:{}},{snapshot:newMarket('steak-dinner',42)},{snapshot:{...valid.snapshot,portions:Array(17).fill({})}},{snapshot:null},{extra:true}])assert.equal(parseDishInit({...valid,...patch}),null);
 }finally{if(previous)Object.defineProperty(globalThis,'OffscreenCanvas',previous);else Reflect.deleteProperty(globalThis,'OffscreenCanvas');}
});

test('UX-15f dish worker messages reject stale owners, sequences, unknown fields and nonfinite views',()=>{
 const valid={version:1,kind:'view',owner:7,sequence:1,angle:-.12,zoom:1.38};
 assert.deepEqual(parseDishView(valid,7,0),valid);
 for(const patch of [{version:2},{owner:8},{sequence:0},{sequence:1.5},{angle:NaN},{angle:7},{zoom:.79},{zoom:1.71},{capture:true}])assert.equal(parseDishView({...valid,...patch},7,0),null);
 assert.equal(parseDishView(valid,7,1),null);
 const reply={version:1,kind:'ready',owner:7,sequence:0,stats:{calls:3,triangles:300,geometries:4,textures:2}};
 assert.deepEqual(parseDishReply(reply,7),reply);assert.equal(parseDishReply(reply,8),null);
 for(const stats of [{calls:1},{...reply.stats,textures:Infinity},{...reply.stats,calls:-1},{...reply.stats,secret:'no'}])assert.equal(parseDishReply({...reply,stats},7),null);
 assert.equal(parseDishReply({...reply,extra:true},7),null);
 assert.deepEqual(parseDishReply({version:1,kind:'failed',owner:7},7),{version:1,kind:'failed',owner:7});
});

test('UX-15f absolute dish view coalescing preserves clamp, turn and reset order',()=>{
 let view=nextDishView({angle:0,zoom:1},'reset',0,'steak-dinner');assert.deepEqual(view,{angle:-.12,zoom:1.26});
 view=nextDishView(view,'zoom',5,'steak-dinner');view=nextDishView(view,'zoom',-.2,'steak-dinner');assert.equal(view.zoom,1.5);
 view=nextDishView(view,'turn',100,'steak-dinner');assert.ok(Math.abs(view.angle)<Math.PI*2);
 assert.equal(nextDishView(view,'turn',NaN,'steak-dinner'),view);
 assert.deepEqual(nextDishView(view,'reset',0,'rice-balls'),{angle:-.12,zoom:1.38});
});

test('UX-15f actual worker reports failure before throwing cleanup and always closes (non-native)',async()=>{
 const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/cooking/dish-worker.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
 for(const scenario of ['invalid-owner','render-throws','cleanup-throws','post-throws'] as const){
  const events:string[]=[],scope:any={onmessage:null,postMessage(m:any){events.push(m.kind);if(scenario==='post-throws'&&m.kind==='failed')throw Error('closed port');},close(){events.push('close');}};
  const stage={stats:()=>({calls:1,triangles:2,geometries:3,textures:4}),view(){events.push('render');if(scenario==='render-throws')throw Error('render');},dispose(){events.push('dispose');if(scenario==='cleanup-throws')throw Error('cleanup');}};
  const module={exports:{}};
  runInNewContext(source,{self:scope,module,exports:module.exports,AbortController,require:(path:string)=>path==='./dish-stage'?{createDishCanvasStage:()=>stage}:path==='./dish-worker-frame'?{waitForDishFrame:()=>Promise.resolve()}:{parseDishInit:(m:any)=>m.kind==='init'?{...m,canvas:{}}:null,parseDishView}});
  await scope.onmessage({data:{kind:'init',owner:7}});assert.deepEqual(events,['ready']);
  const message={version:1,kind:'view',owner:scenario==='render-throws'?7:-1,sequence:1,angle:0,zoom:1};
  await scope.onmessage({data:message});assert.deepEqual(events,scenario==='render-throws'?['ready','render','failed','dispose','close']:['ready','failed','dispose','close']);
  await scope.onmessage({data:message});assert.equal(events.filter(x=>x==='failed').length,1);assert.equal(events.filter(x=>x==='dispose').length,1);assert.equal(events.filter(x=>x==='close').length,1);
 }
});

test('UX-15f worker frame barrier waits for GPU and rendering opportunities, cancels and bounds every path (non-native)',async()=>{
 const code=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/cooking/dish-worker-frame.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
 function setup(states:number[]=[1],raf=true){
  let now=0,id=0,lost=false,deletes=0,flushed=0,throwWait=false,nullFence=false;const timers=new Map<number,{at:number;fn:()=>void}>(),frames=new Map<number,()=>void>(),waits:unknown[]=[];
  const gl={ALREADY_SIGNALED:1,CONDITION_SATISFIED:2,TIMEOUT_EXPIRED:3,WAIT_FAILED:4,SYNC_GPU_COMMANDS_COMPLETE:5,isContextLost:()=>lost,fenceSync:()=>nullFence?null:{},flush:()=>flushed++,deleteSync:()=>deletes++,clientWaitSync:(...args:unknown[])=>{waits.push(args);if(throwWait)throw Error('GPU');return states.length>1?states.shift():states[0];}};
  const module={exports:{} as any};runInNewContext(code,{module,exports:module.exports,DOMException,performance:{now:()=>now},setTimeout:(fn:()=>void,ms:number)=>{timers.set(++id,{at:now+ms,fn});return id;},clearTimeout:(key:number)=>timers.delete(key),requestAnimationFrame:raf?(fn:()=>void)=>{frames.set(++id,fn);return id;}:undefined,cancelAnimationFrame:(key:number)=>frames.delete(key)});
  return {start:(signal:AbortSignal)=>module.exports.waitForDishFrame({getContext:()=>gl},signal) as Promise<void>,tick:(ms=0)=>{now+=ms;for(const [key,value]of [...timers])if(value.at<=now&&timers.delete(key))value.fn();},frame:()=>{now+=16;const batch=[...frames];frames.clear();batch.forEach(([,fn])=>fn());},setLost:()=>{lost=true;},setThrow:()=>{throwWait=true;},setNull:()=>{nullFence=true;},stats:()=>({timers:timers.size,frames:frames.size,deletes,flushed,waits})};
 }
 const f=setup([3,1]),a=new AbortController();let done=false;const p=f.start(a.signal).then(()=>{done=true;});assert.equal(f.stats().flushed,1);f.tick();assert.equal(done,false);assert.equal(f.stats().frames,0);f.tick(16);assert.equal(f.stats().deletes,1);f.frame();await Promise.resolve();assert.equal(done,false);f.frame();await p;assert.equal(done,true);assert.equal(f.stats().timers,0);assert.equal(f.stats().frames,0);assert.ok(f.stats().waits.every((x:any)=>x[1]===0&&x[2]===0));
 const unsupported=setup([1],false);await assert.rejects(unsupported.start(new AbortController().signal),/unavailable/);assert.equal(unsupported.stats().flushed,0);
 const cancelled=setup(),cancelledOwner=new AbortController();cancelledOwner.abort();await assert.rejects(cancelled.start(cancelledOwner.signal),{name:'AbortError'});assert.equal(cancelled.stats().timers,0);assert.equal(cancelled.stats().deletes,0);
 for(const scenario of ['abort','lost','timeout','wait-failed','wait-throws','no-fence','no-frame'] as const){
  const f=setup([scenario==='wait-failed'?4:scenario==='no-frame'?1:3]),owner=new AbortController();if(scenario==='wait-throws')f.setThrow();if(scenario==='no-fence')f.setNull();const pending=f.start(owner.signal);const rejected=assert.rejects(pending);
  if(scenario==='abort')owner.abort();else if(scenario==='lost'){f.setLost();f.tick();}else if(scenario==='timeout')f.tick(15000);else{f.tick();if(scenario==='no-frame')f.tick(15000);}await rejected;assert.equal(f.stats().timers,0);assert.equal(f.stats().frames,0);assert.equal(f.stats().deletes,scenario==='no-fence'?0:1);
 }
});

test('UX-15f actual worker acknowledges only completed owned frames and rejects overlapping input (non-native)',async()=>{
 const code=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/cooking/dish-worker.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
 const messages:any[]=[],pending:{resolve:()=>void;signal:AbortSignal}[]=[];let disposed=0,closed=0,views=0;
 const scope:any={postMessage:(m:any)=>messages.push(m),close:()=>closed++,onmessage:null},module={exports:{}};
 runInNewContext(code,{self:scope,module,exports:module.exports,AbortController,require:(path:string)=>path==='./dish-stage'?{createDishCanvasStage:()=>({stats:()=>({calls:1,triangles:2,geometries:3,textures:4}),view:()=>views++,dispose:()=>disposed++})}:path==='./dish-worker-frame'?{waitForDishFrame:(_canvas:unknown,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{pending.push({resolve,signal});signal.addEventListener('abort',()=>reject(Error('owner closed')),{once:true});})}:{parseDishInit:(m:any)=>m.kind==='init'?{...m,canvas:{}}:null,parseDishView}});
 const init=scope.onmessage({data:{kind:'init',owner:7}});assert.equal(messages.length,0);pending.shift()!.resolve();await init;assert.equal(messages[0].kind,'ready');
 const first=scope.onmessage({data:{version:1,kind:'view',owner:7,sequence:1,angle:0,zoom:1}});assert.equal(views,1);assert.equal(messages.length,1);pending.shift()!.resolve();await first;assert.equal(messages[1].kind,'rendered');assert.equal(messages[1].sequence,1);
 const second=scope.onmessage({data:{version:1,kind:'view',owner:7,sequence:2,angle:0,zoom:1}});const held=pending.shift()!;
 await scope.onmessage({data:{version:1,kind:'view',owner:7,sequence:3,angle:0,zoom:1}});await second;assert.equal(held.signal.aborted,true);held.resolve();await Promise.resolve();assert.equal(messages.at(-1).kind,'failed');assert.equal(messages.filter(m=>m.kind==='rendered').length,1);assert.equal(disposed,1);assert.equal(closed,1);
});

test('UX-15f actual dish worker client has one bounded in-flight view and terminates stale owners',()=>{
 const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/dish-preview-worker.ts',import.meta.url),'utf8').replaceAll('import.meta.url',JSON.stringify('https://example.test/assets/dish-preview-worker.js'));
 const workers:any[]=[],canvases:any[]=[],module={exports:{} as any},timers=new Map<number,{fn:()=>void;ms:number}>();let timerId=0,throwPost=false;
 class FakeWorker{onmessage:any;onerror:any;onmessageerror:any;messages:any[]=[];terminated=0;constructor(){workers.push(this);}postMessage(message:any){if(throwPost)throw Error('transfer failed');this.messages.push(message);}terminate(){this.terminated++;}}
 class FakeCanvas{width=0;height=0;removed=0;setAttribute(){}transferControlToOffscreen(){return {};}remove(){this.removed++;}}
 runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require:()=>({nextDishView,parseDishReply}),Worker:FakeWorker,OffscreenCanvas:class{},HTMLCanvasElement:FakeCanvas,document:{createElement(){const c=new FakeCanvas();canvases.push(c);return c;}},URL,devicePixelRatio:4,setTimeout:(fn:()=>void,ms:number)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:(id:number)=>timers.delete(id)});
 let ready=0,lost=0,updates=0;const preview=module.exports.createDishPreview({append(){}},'steak-dinner',()=>ready++,()=>lost++,()=>updates++),worker=workers[0];
 assert.equal(worker.messages.length,1);const owner=worker.messages[0].owner;assert.equal(worker.messages[0].pixelRatio,1.5);
 const stats={calls:3,triangles:200,geometries:5,textures:4};
 worker.onmessage({data:{version:1,kind:'ready',owner,sequence:0,stats}});assert.equal(ready,1);
 preview.turn(.3);assert.equal(preview.pending(),true);for(let i=0;i<500;i++)preview.zoom(i%2?.02:-.03);preview.reset();preview.zoom(-.2);
 assert.equal(worker.messages.length,2);const first=worker.messages[1];
 worker.onmessage({data:{version:1,kind:'rendered',owner,sequence:first.sequence,stats}});
 assert.equal(worker.messages.length,3);assert.equal(preview.pending(),true);assert.equal(worker.messages[2].zoom,1.06);assert.equal(worker.messages[2].angle,-.12);
 worker.onmessage({data:{version:1,kind:'rendered',owner,sequence:worker.messages[2].sequence,stats}});assert.equal(worker.messages.length,3);assert.equal(updates,4);assert.equal(preview.pending(),false);
 const late=worker.onmessage;preview.dispose();preview.dispose();late({data:{version:1,kind:'ready',owner,sequence:0,stats}});
 assert.equal(worker.terminated,1);assert.equal(canvases[0].removed,1);assert.equal(ready,1);assert.equal(lost,0);
 const other=module.exports.createDishPreview({append(){}},'rice-balls',()=>ready++,()=>lost++,()=>updates++),next=workers[1];
 next.onmessage({data:{version:1,kind:'ready',owner,sequence:0,stats}});assert.equal(lost,1);assert.equal(next.terminated,1);other.turn(1);assert.equal(next.messages.length,1);
 const stalled=module.exports.createDishPreview({append(){}},'rice-balls',()=>ready++,()=>lost++,()=>updates++),third=workers[2],thirdOwner=third.messages[0].owner;
 third.onmessage({data:{version:1,kind:'ready',owner:thirdOwner,sequence:0,stats}});stalled.turn(.2);
 assert.equal(timers.size,1);const deadline=[...timers.values()][0];assert.equal(deadline.ms,15000);const lateAck=third.onmessage;deadline.fn();
 assert.equal(third.terminated,1);assert.equal(lost,2);assert.equal(timers.size,0);lateAck({data:{version:1,kind:'rendered',owner:thirdOwner,sequence:1,stats}});assert.equal(lost,2);
 throwPost=true;assert.throws(()=>module.exports.createDishPreview({append(){}},'rice-balls',()=>{},()=>{},()=>{}),/transfer failed/);assert.equal(workers[3].terminated,1);assert.equal(canvases[3].removed,1);

});
import {GAMES,seconds} from '../../apps/portal-web/src/games/domain.js';
import {beginStamps,cashDeck,challengeUrl,CLIENTS,gradePhoto,newCash,newStamps,pause,photoPose,resume,RULES,seedOf,sortCash,stamp,stampTarget,tick} from '../../apps/portal-web/src/games/domain.js';
import {cashNotice,photoNotice,stampNotice} from '../../apps/portal-web/src/games/daily-feedback.js';
import {GAME_HANDOFF_KEY,HANDOFF_TTL,parseGameDraft,readGameDraft,saveGameDraft,clearGameDraft} from '../../apps/portal-web/src/games/result-bridge.js';
import {gamePreviewHtml} from '../../apps/portal-web/src/games/preview.js';
import type {Pool} from 'pg';
import {createApp} from '../../apps/platform-api/src/app.js';
import {mountAssets} from '../../apps/platform-api/src/worker.js';

test('public game previews use distinct original game assets and preserve the playable shell',async()=>{
  const shell=readFileSync(new URL('../../apps/portal-web/index.html',import.meta.url),'utf8');
  for(const [game,title] of [['photo','這張能交嗎？'],['stamp','蓋完就下班'],['cash','這疊有一百萬？']] as const){
    const html=gamePreviewHtml(shell,`https://example.org/play?game=${game}&seed=123`,'https://example.org');
    assert.match(html,new RegExp(`<meta property="og:title" content="${title}`));
    assert.ok(html.includes(`<meta property="og:image" content="https://example.org/games/absurd-daily/${game}.jpg">`));
    assert.ok(html.includes(`<link rel="canonical" href="https://example.org/play?game=${game}&amp;seed=123">`));
    assert.equal((html.match(/property="og:image"/g)??[]).length,1);
    assert.ok(html.includes('<div id="root"></div>'));
    assert.ok(html.includes('src="/src/main.tsx"'));
    const info=await sharp(readFileSync(new URL(`../../apps/portal-web/public/games/absurd-daily/${game}.jpg`,import.meta.url))).metadata();
    assert.equal(info.format,'jpeg');assert.equal(info.width,852);assert.equal(info.height,639);
  }
  assert.equal(gamePreviewHtml(shell,'https://example.org/play?game=unknown&seed=123','https://example.org'),shell);
  assert.equal(gamePreviewHtml(shell,'https://example.org/other?game=photo&seed=123','https://example.org'),shell);
  assert.equal(gamePreviewHtml('no head','https://example.org/play?game=photo&seed=123','https://example.org'),'no head');
  assert.match(gamePreviewHtml(shell,'https://example.org/play/?game=cash&seed=invalid','https://example.org'),/game=cash&amp;seed=20261023/);
});
test('AD-2 validates seed and emits a public challenge without result or identity',()=>{for(const bad of [0,-1,Infinity,NaN,'1x','0x12','4294967296',null,{},1.5])assert.equal(seedOf(bad),20261023);assert.equal(seedOf('4294967295'),4294967295);const u=new URL(challengeUrl('https://example.org','photo',12));assert.equal(u.pathname,'/play');assert.deepEqual([...u.searchParams],[['game','photo'],['seed','12']]);});
test('AD-5 every seeded deck contains exactly one million and six unique decoys; last note is fixed',()=>{for(let seed=1;seed<=400;seed++){const d=cashDeck(seed);assert.equal(d.length,30);assert.equal(new Set(d.map(c=>c.id)).size,30);assert.equal(d.reduce((sum,c)=>sum+c.amount,0),RULES.targetCash);assert.equal(d.filter(c=>c.valid).length,24);assert.equal(new Set(d.filter(c=>!c.valid).map(c=>c.label)).size,6);assert.equal(d.at(-1)?.amount,100000);assert.deepEqual(d,cashDeck(seed));}assert.notDeepEqual(cashDeck(1),cashDeck(2));});
test('AD-5 wrong sort changes neither progress nor money; stale and rapid actions do not consume a card',()=>{let s=newCash(9);const valid=cashDeck(9)[0].valid;let out=sortCash(s,0,!valid,0);assert.equal(out.kind,'wrong');assert.equal(out.state.index,0);assert.equal(out.state.amount,0);assert.equal(out.state.mistakes,1);s=out.state;assert.equal(sortCash(s,0,valid,20).state,s);s=sortCash(s,0,valid,200).state;assert.equal(s.index,1);assert.equal(sortCash(s,0,valid,400).state,s);for(const now of [NaN,Infinity,-1])assert.equal(sortCash(s,1,true,now).state,s);});
test('AD-5 a full run settles once with exact original facts',()=>{let s=newCash(100);for(const card of cashDeck(100))s=sortCash(s,s.index,card.valid,s.index*250).state;assert.equal(s.amount,1_000_000);assert.equal(s.index,30);assert.equal(s.rejected,6);assert.equal(s.endedAt,7250);assert.equal(sortCash(s,30,true,9000).state,s);});
test('AD-4 fixed seeded target, finite bounds, miss marks and completed clock',()=>{for(let seed=1;seed<100;seed++)for(let i=0;i<12;i++){const t=stampTarget(seed,i);assert.ok(Math.abs(t.x)<.7&&Math.abs(t.y)<.6);assert.deepEqual(t,stampTarget(seed,i));}let s=newStamps(42,false);assert.equal(stamp(s,0,{x:NaN,y:0},0).state,s);assert.equal(stamp(s,0,{x:2,y:0},0).state,s);s=beginStamps(s,0);s=stamp(s,0,{x:1.1,y:1.1},250).state;assert.equal(s.index,0);assert.equal(s.misses,1);assert.equal(s.marks.length,1);for(let i=0;i<12;i++){const prev=s;s=stamp(s,i,stampTarget(42,i),500+i*250).state;assert.equal(prev.index,i);assert.equal(s.index,i+1);assert.equal(stamp(s,i,stampTarget(42,i),9000).state,s);}assert.equal(s.endedAt,3250);assert.equal(s.startedAt,0);assert.equal(s.misses,1);assert.equal(stamp(s,12,{x:0,y:0},5000).state,s);});
test('AD-4 practice is uncounted; its stale pointer cannot stamp the first real document',()=>{const initial=newStamps(3);const p=stamp(initial,-1,stampTarget(3,0),200);assert.equal(p.kind,'practice');assert.equal(p.state.index,0);assert.equal(p.state.practice,false);assert.equal(p.state.startedAt,null);assert.equal(stamp(p.state,0,stampTarget(3,0),250).kind,'ignored');assert.equal(stamp(p.state,-1,stampTarget(3,0),1000).state,p.state);});
test('AD-3 actual visible anchors and occlusion drive objective and funny captions',()=>{assert.equal(gradePhoto('pigeons',['bird0','bird2'],5).stars,2);assert.equal(gradePhoto('pigeons',['bird0','bird1','bird2'],5).stars,3);assert.match(gradePhoto('backdrop',['board'],5,true).caption,/背景出席/);assert.equal(gradePhoto('umbrella',['feet','head','umbrella'],5).stars,3);assert.match(gradePhoto('umbrella',['feet'],5).caption,/兩隻鞋/);assert.equal(photoPose('pigeons',0,1).birds.filter(x=>x>0).length,0);assert.equal(photoPose('pigeons',6,1).birds.filter(x=>x>0).length,3);assert.ok(photoPose('umbrella',5,1).lift>2);});

test('AD-2 action feedback returns plain text without changing frozen rule state',()=>{
  const stamps=Object.freeze(newStamps(42,false)),cash=Object.freeze(newCash(42));
  Object.freeze(stamps.marks);const before=JSON.stringify({stamps,cash});
  const message='<b>保留原文</b>';
  assert.equal(photoNotice(message,0,0),`${message} 第 1 / 3 位客人，已保存 0 / 2 張，還可拍 2 張。`);
  assert.equal(stampNotice(stamps,'miss'),'章歪了。墨跡留下，這張再蓋一次。 已完成 0 / 12 份 · 多蓋 0 次。');
  assert.equal(cashNotice(cash,'wrong',false),'這張分錯了，退回來重新看看。 已分類 0 / 30 張 · 分錯 0 次。');
  assert.equal(JSON.stringify({stamps,cash}),before);
});
test('AD-3 photo feedback preserves the grade and distinguishes saved film for each client',()=>{
  const grade=gradePhoto('pigeons',['bird0'],5),message=`${grade.caption} ${grade.details}`,before=JSON.stringify(grade);
  for(let client=0;client<RULES.clients;client++){
    const notices=[0,1,2].map(film=>photoNotice(message,client,film));assert.equal(new Set(notices).size,3);
    for(let film=0;film<=RULES.film;film++)assert.equal(notices[film],`${message} 第 ${client+1} / 3 位客人，已保存 ${film} / 2 張，還可拍 ${2-film} 張。`);
  }
  assert.equal(JSON.stringify(grade),before);
});
test('AD-4 stamp feedback separates practice misses from formal documents and repeated actions',()=>{
  let state=newStamps(42);
  for(let i=0;i<2;i++){
    state=stamp(state,-1,{x:1.1,y:1.1},i*250).state;
    assert.equal(stampNotice(state,'miss'),`章歪了。墨跡留下，這張再蓋一次。 練習失手 ${i+1} 次，不計入正式文件。`);
  }
  const practice=stamp(state,-1,stampTarget(42,0),500);assert.equal(practice.kind,'practice');state=practice.state;
  assert.equal(stampNotice(state,'practice'),'練習完成。十二張正式公文，開始！');assert.equal(state.misses,0);assert.equal(state.index,0);
  for(let i=0;i<2;i++){
    state=stamp(state,0,{x:1.1,y:1.1},750+i*250).state;
    assert.equal(stampNotice(state,'miss'),`章歪了。墨跡留下，這張再蓋一次。 已完成 0 / 12 份 · 多蓋 ${i+1} 次。`);
  }
  for(let i=0;i<2;i++){
    state=stamp(state,i,stampTarget(42,i),1250+i*250).state;const before=JSON.stringify(state);
    assert.equal(stampNotice(state,'hit'),`啪！已閱，但看不懂。 已完成 ${i+1} / 12 份 · 多蓋 2 次。`);assert.equal(JSON.stringify(state),before);
  }
});
test('AD-5 cash feedback reports accepted cards and mistakes without changing money or state',()=>{
  let state=newCash(42);const deck=cashDeck(42),notices:string[]=[];
  for(let i=0;i<2;i++){
    state=sortCash(state,0,!deck[0].valid,i*200).state;
    assert.equal(cashNotice(state,'wrong',!deck[0].valid),`這張分錯了，退回來重新看看。 已分類 0 / 30 張 · 分錯 ${i+1} 次。`);assert.equal(state.amount,0);
  }
  for(const [i,card] of deck.entries()){
    state=sortCash(state,i,card.valid,400+i*200).state;const before=JSON.stringify(state);
    const message=card.valid?'道具鈔收到。財富看起來很有希望。':'這張不是錢，老闆先收回去。';
    notices.push(cashNotice(state,'correct',card.valid));assert.equal(notices[i],`${message} 已分類 ${i+1} / 30 張 · 分錯 2 次。`);assert.equal(JSON.stringify(state),before);
  }
  assert.equal(new Set(notices).size,30);assert.equal(state.amount,RULES.targetCash);assert.equal(state.rejected,6);
});

// Actual input closures with a controlled renderer, not native capture evidence.
function dailyFeedbackBoard(game:'photo'|'stamp'){
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/AbsurdDaily.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm'}).code;
  const functions=['shoot','applyStamp','photosDone'].map(name=>{
    const start=new RegExp(`^( *)function ${name}\\(`,'m').exec(source);assert.ok(start,name);
    const tail=source.slice(start.index),end=new RegExp(`^${start[1]}}`,'m').exec(tail);assert.ok(end,`${name} end`);
    return tail.slice(0,end.index+end[0].length);
  }).join('\n');
  const live={current:{game,seed:42,started:true,paused:false,done:false,clock:{elapsed:0},client:0,roundAt:0,film:0,photos:[] as unknown[],stamps:newStamps(42),raised:false,stampPoint:stampTarget(42,0)}};
  const notices:string[]=[],captureFailures={current:0};let failure:unknown=null;
  const stage={current:{framing:()=>({visible:['head','feet'],blocked:false,lift:0}),capture:()=>{if(failure!==null)throw failure;return 'controlled-frame';}}};
  const api=runInNewContext(`${functions};({shoot,applyStamp,photosDone})`,{
    live,stage,ready:true,RULES,CLIENTS,GAMES,gradePhoto,stamp,photoNotice,stampNotice,seconds,Error,captureFailures,
    motionRef:{current:false},syncClock(){},render:()=>true,sfx(){},setFlash(){},updateUi(){},settle:()=>assert.fail('not a terminal fixture'),
    setNotice:(text:string)=>notices.push(text),game,seed:42,
  }) as {shoot:()=>void;applyStamp:(point:{x:number;y:number},index?:number)=>void;photosDone:()=>void};
  return {...api,live,notices,captureFailures,fail:(cause:unknown)=>{failure=cause;}};
}
test('AD-3 repeated capture failures retain film and the original cause; successful retry uses real progress',()=>{
  const h=dailyFeedbackBoard('photo');h.fail(Error('same capture error'));
  for(let attempt=1;attempt<=2;attempt++){
    h.shoot();assert.equal(h.notices.at(-1),`本局第 ${attempt} 次拍照未保存。same capture error 第 1 / 3 位客人，已保存 0 / 2 張，還可拍 2 張。`);
    assert.equal(h.live.current.film,0);assert.equal(h.live.current.photos.length,0);
  }
  h.fail('non-Error rejection');h.shoot();assert.match(h.notices.at(-1)!,/^本局第 3 次拍照未保存。這張未能保存，請重試。/);
  h.fail(null);h.shoot();assert.match(h.notices.at(-1)!,/已保存 1 \/ 2 張，還可拍 1 張。$/);
  h.shoot();assert.match(h.notices.at(-1)!,/已保存 2 \/ 2 張，還可拍 0 張。$/);assert.equal(h.live.current.photos.length,2);assert.equal(h.captureFailures.current,3);
  h.shoot();assert.equal(h.notices.length,5,'exhausted film has no new action announcement');
  h.live.current.film=0;h.live.current.client=1;h.live.current.paused=true;h.shoot();assert.equal(h.notices.length,5);
  h.live.current.paused=false;h.shoot();assert.match(h.notices.at(-1)!,/第 2 \/ 3 位客人，已保存 1 \/ 2 張/);
});
test('AD-3 an empty studio restart resets its failure count without claiming saved photos',()=>{
  const h=dailyFeedbackBoard('photo');h.fail(Error('capture failed'));h.shoot();h.shoot();assert.equal(h.captureFailures.current,2);
  h.photosDone();assert.equal(h.captureFailures.current,0);assert.equal(h.live.current.started,false);assert.equal(h.live.current.photos.length,0);
  h.live.current.started=true;h.shoot();assert.match(h.notices.at(-1)!,/^本局第 1 次拍照未保存。/);assert.equal(h.live.current.film,0);
});
test('AD-4 ignored rapid and stale stamp inputs do not announce another action',()=>{
  const h=dailyFeedbackBoard('stamp'),miss={x:1.1,y:1.1},target=stampTarget(42,0);
  h.applyStamp(miss);assert.match(h.notices.at(-1)!,/練習失手 1 次/);h.applyStamp(miss);assert.equal(h.notices.length,1);
  h.live.current.clock.elapsed=250;h.applyStamp(miss);assert.match(h.notices.at(-1)!,/練習失手 2 次/);
  h.live.current.clock.elapsed=500;h.applyStamp(target);assert.equal(h.live.current.stamps.index,0);assert.equal(h.live.current.stamps.misses,0);
  h.live.current.clock.elapsed=750;h.applyStamp(target,-1);assert.equal(h.notices.length,3);h.applyStamp(target);assert.match(h.notices.at(-1)!,/已完成 1 \/ 12 份 · 多蓋 0 次/);
  h.live.current.clock.elapsed=1000;h.applyStamp(target,0);assert.equal(h.notices.length,4);h.applyStamp(stampTarget(42,1));assert.match(h.notices.at(-1)!,/已完成 2 \/ 12 份 · 多蓋 0 次/);
});
test('AD-2 foreground clock counts elapsed time, pauses, and never charges the background interval',()=>{let c={elapsed:0,last:null as number|null,running:true};c=tick(c,100);c=tick(c,450);assert.equal(c.elapsed,350);c=pause(c);c=tick(c,10000);assert.equal(c.elapsed,350);c=resume(c);c=tick(c,20000);c=tick(c,20100);assert.equal(c.elapsed,450);assert.equal(tick(c,NaN),c);});
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};}
test('AD-2 an input timestamp ahead of a queued render cannot double count foreground time',()=>{
  let clock={elapsed:0,last:100,running:true};clock=tick(clock,350) as typeof clock;
  assert.equal(tick(clock,330),clock);clock=tick(clock,400) as typeof clock;assert.equal(clock.elapsed,300);
});
test('AD-7 bounded guest draft survives reload, reads are pure, and stale clearing cannot delete a newer result',()=>{const s=storage(),now=Date.now(),draft={version:1 as const,createdAt:now,game:'photo' as const,seed:7,title:'這張能交嗎？',text:'真的拍到了。',image:'data:image/jpeg;base64,YWJjZA=='};saveGameDraft(s,draft,now);const before=s.getItem(GAME_HANDOFF_KEY);assert.deepEqual(readGameDraft(s,now),draft);assert.equal(s.getItem(GAME_HANDOFF_KEY),before);clearGameDraft(s,now-1);assert.equal(s.getItem(GAME_HANDOFF_KEY),before);clearGameDraft(s,now);assert.equal(readGameDraft(s,now),null);});
test('AD-7 malformed, expired, future, oversized and unavailable storage cannot falsely succeed',()=>{const now=Date.now(),draft={version:1,createdAt:now,game:'cash',seed:7,title:'盤點',text:'道具鈔',image:'data:image/jpeg;base64,YWJjZA=='};for(const changed of [{version:2},{createdAt:now-HANDOFF_TTL-1},{createdAt:now+61000},{seed:NaN},{seed:0},{image:'data:text/html;base64,AAAA'},{title:''},{text:'x'.repeat(2001)}])assert.equal(parseGameDraft(JSON.stringify({...draft,...changed}),now),null);assert.equal(parseGameDraft('{bad',now),null);assert.equal(readGameDraft({getItem(){throw Error('denied');},setItem(){},removeItem(){}},now),null);assert.throws(()=>saveGameDraft({getItem(){return null;},setItem(){throw Error('quota');},removeItem(){}},draft as any,now),/quota/);});

import {CATEGORIES,COOKING_RULES,RECIPES,recipeOf,recipeSearch,TECHNIQUES} from '../../apps/portal-web/src/games/cooking/catalog.js';
import {actCooking,advanceCooking,cookingProgress,cookingScore,currentStep,cutGuide,newCookingRun,parseCookingRun,plateTarget,type CookingRun,type CookingAction} from '../../apps/portal-web/src/games/cooking/domain.js';
import {COOKBOOK_KEY,COOKBOOK_BACKUP,COOKING_RUN_KEY,RUN_TTL,emptyCookbook,parseCookbook,readCookbook,updateCookbook,readCookingRun,saveCookingRun,clearCookingRun} from '../../apps/portal-web/src/games/cooking/storage.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {PARTY_GAMES,PARTY_RULES as PT,partyOf} from '../../apps/portal-web/src/games/party/catalog.js';
import {actParty,advanceParty,chairWave,holidayTargets,newParty,partySummary,pauseParty,resumeParty,startParty,tofuAxis,tofuPosition,type PartyRun,type ChairRun,type TofuRun,type HolidayRun} from '../../apps/portal-web/src/games/party/domain.js';
import {DISH_DESIGNS,dishDesign} from '../../apps/portal-web/src/games/cooking/dish-designs.js';
import {displayMarket} from '../../apps/portal-web/src/games/cooking/market-food.js';
import {createDishModel,type DishMesh} from '../../apps/portal-web/src/games/cooking/dish-model.js';
import {createRequire} from 'node:module';
import {coverOf} from '../../apps/portal-web/src/games/GameCover.js';
import {syncDiagnostics} from '../../apps/portal-web/src/games/diagnostics.js';
const {Box3}=createRequire(new URL('../../apps/portal-web/package.json',import.meta.url))('three');
import {GAME_SHARE_PLATFORMS,gameShareText,gameSocialLink} from '../../apps/portal-web/src/games/result-share.js';

// Executes the production component closures with real domain/storage and bounded hook/DOM ports.
// Native dialog focus containment and background inertness are covered by E2E, not this harness.
function guidedRestartHarness() {
  const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/CookingGame.tsx',import.meta.url),'utf8');
  const helpers=source.slice(source.indexOf('export const storagePort='),source.indexOf('/** UX-8')).replace('export const','const');
  const body=source.slice(source.indexOf('  const [boot]='),source.indexOf('  const cue='));
  const open=source.match(/aria-label="重新做" onClick=\{(.*?)\}>/)![1];
  const code=transformSync(`${helpers}\nfunction component(){${body}\nreturn {live,pause,begin,restart,holdStart,holdEnd,setVisualReady,restartKey:typeof restartKey==='undefined'?null:restartKey,open:${open},dismiss:()=>setConfirmRestart(false),section,restartDialog:typeof restartDialog==='undefined'?null:restartDialog,restartButton:typeof restartButton==='undefined'?null:restartButton,keepButton:typeof keepButton==='undefined'?null:keepButton};}\ncomponent`,{loader:'ts'}).code;
  const slots:any[]=[],effects:Array<()=>void>=[],data=new Map<string,string>();let index=0,now=0,identity=0,focuses=0,keptFocus=0,confirmedFocus=0,opened=0,closed=0;
  const session={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)};
  const hooks={useRef:(value:any)=>{const i=index++;return slots[i]??(slots[i]={current:value});},useState:(value:any)=>{const i=index++;if(!slots[i])slots[i]={value:typeof value==='function'?value():value};return [slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];},useEffect:(fn:()=>any,deps:any[])=>{const i=index++,old=slots[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j]))){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
  const modal={open:false,querySelectorAll:()=>[confirm,keep],showModal(){assert.equal(this.open,false);this.open=true;opened++;},close(){this.open=false;closed++;}},button={focus:()=>focuses++},keep={focus:()=>{assert.equal(modal.open,true);keptFocus++;}};
  const confirm={focus:()=>{assert.equal(modal.open,true);confirmedFocus++;}};
  const recipe=recipeOf('margherita-pizza')!;
  const renderComponent=runInNewContext(code,{...hooks,recipe,seed:42,fresh:false,crypto:{randomUUID:()=>`restart_${++identity}`},performance:{now:()=>now},window:{sessionStorage:session,addEventListener(){},removeEventListener(){}},document:{addEventListener(){},removeEventListener(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},COOKING_RULES,TECHNIQUES,recipeOf,newCookingRun,actCooking,advanceCooking,currentStep,readCookingRun,saveCookingRun,clearCookingRun,onResult(){throw Error('unfinished result');},onComplete(){throw Error('unfinished completion');}});
  let ui:any;
  const render=()=>{index=0;ui=renderComponent();ui.section.current={focus(){},querySelector:()=>null};if(ui.restartDialog)ui.restartDialog.current=modal;if(ui.restartButton)ui.restartButton.current=button;if(ui.keepButton)ui.keepButton.current=keep;while(effects.length)effects.shift()!();return ui;};
  render();ui.setVisualReady(true);render();
  return {render,get ui(){return ui;},modal,keep,confirm,session,advance:(ms:number)=>{now+=ms;},stats:()=>({focuses,keptFocus,confirmedFocus,opened,closed}),unmount:()=>{for(const slot of slots)slot?.cleanup?.();}};
}

test('UX-2 guided restart opens a modal once and releases it on cancellation (non-native)',()=>{
  const h=guidedRestartHarness();h.ui.begin();h.render();h.ui.open();h.render();
  assert.equal(h.modal.open,true);assert.equal(h.stats().opened,1);assert.equal(h.stats().keptFocus,1);h.render();assert.equal(h.stats().opened,1);
  h.ui.dismiss();h.render();assert.equal(h.modal.open,false);assert.equal(h.stats().closed,1);assert.equal(h.stats().focuses,1);assert.equal(h.ui.live.current.status,'paused');
});

test('UX-2 guided restart can reopen and unmount without leaving a modal open (non-native)',()=>{
  const h=guidedRestartHarness();assert.equal(h.stats().focuses,0);
  for(let i=0;i<2;i++){h.ui.open();h.render();assert.equal(h.modal.open,true);h.ui.dismiss();h.render();assert.equal(h.modal.open,false);}
  h.ui.open();h.render();h.unmount();assert.equal(h.modal.open,false);assert.equal(h.stats().opened,3);assert.equal(h.stats().closed,3);
});

test('UX-2 guided restart wraps only the two Tab boundaries and preserves browser shortcuts (non-native)',()=>{
  const h=guidedRestartHarness();h.ui.open();h.render();assert.equal(typeof h.ui.restartKey,'function');
  const press=(target:any,shiftKey=false,extra:any={})=>{let prevented=false;h.ui.restartKey({key:'Tab',target,currentTarget:h.modal,shiftKey,preventDefault(){prevented=true;},...extra});return prevented;};
  assert.equal(press(h.keep),true);assert.equal(h.stats().confirmedFocus,1);
  assert.equal(press(h.confirm,true),true);assert.equal(h.stats().keptFocus,2);
  assert.equal(press(h.confirm),false);assert.equal(press(h.keep,true),false);
  for(const extra of [{key:'Escape'},{key:'Enter'},{ctrlKey:true},{altKey:true},{metaKey:true}])assert.equal(press(h.keep,false,extra),false);
  assert.equal(h.stats().confirmedFocus,1);assert.equal(h.stats().keptFocus,2);assert.equal(h.modal.open,true);
});

test('UX-2 guided restart pauses and persists a held operation without counting a late release (non-native)',()=>{
  const h=guidedRestartHarness();h.ui.begin();h.render();h.ui.holdStart({kind:'key',key:' '});h.advance(750);h.ui.open();h.render();
  const saved=JSON.parse(h.session.getItem(COOKING_RUN_KEY)!).run;assert.equal(saved.status,'paused');assert.equal(saved.active.count,0);assert.equal(saved.active.holdAt,null);
  h.advance(6000);h.ui.holdEnd({kind:'key',key:' '});assert.deepEqual(JSON.parse(h.session.getItem(COOKING_RUN_KEY)!).run,saved);assert.equal(h.ui.live.current.active.count,0);
  h.ui.dismiss();h.render();assert.equal(h.ui.live.current.status,'paused');h.ui.begin();h.render();h.ui.holdStart({kind:'key',key:' '});h.advance(750);h.ui.holdEnd({kind:'key',key:' '});assert.equal(h.ui.live.current.active.count,1);
});

test('UX-2 guided restart only replaces the run after explicit confirmation (non-native)',()=>{
  const h=guidedRestartHarness();h.ui.begin();h.render();h.ui.holdStart({kind:'key',key:' '});h.advance(750);h.ui.holdEnd({kind:'key',key:' '});h.render();const original=h.ui.live.current.id;
  h.ui.open();h.render();h.ui.dismiss();h.render();assert.equal(h.ui.live.current.id,original);assert.equal(h.ui.live.current.active.count,1);
  h.ui.open();h.render();h.ui.restart();h.render();assert.notEqual(h.ui.live.current.id,original);assert.equal(h.ui.live.current.status,'ready');assert.equal(h.ui.live.current.active.count,0);assert.equal(h.session.getItem(COOKING_RUN_KEY),null);
});

function fullscreenEscapeHarness(mode:'normal'|'viewport'|'native',overlay:'none'|'modal'|'nonmodal'|'role') {
  const source=readFileSync(new URL('../../apps/portal-web/src/games/FullscreenGame.tsx',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('  function captureEscape('),source.indexOf('  function keys('));
  const modes:string[]=[],messages:string[]=[];let prevented=0,stopped=0,exits=0;
  const node={querySelector(selector:string){assert.equal(selector,'dialog:modal');return overlay==='modal'?{}:null;}};
  const capture=runInNewContext(transformSync(`${body}\ncaptureEscape`,{loader:'ts'}).code,{mode,container:{current:node},mounted:{current:true},setMode:(next:string)=>modes.push(next),setMessage:(message:string)=>messages.push(message),document:{fullscreenElement:mode==='native'?node:null,exitFullscreen:()=>{exits++;return Promise.resolve();}}});
  return {press:(key='Escape')=>capture({key,preventDefault(){prevented++;},stopPropagation(){stopped++;}}),stats:()=>({prevented,stopped,exits,modes,messages})};
}

test('UX-2 native restart modal owns Escape before fullscreen capture without altering presentation (non-native)',()=>{
  for(const mode of ['normal','viewport','native'] as const){const h=fullscreenEscapeHarness(mode,'modal');h.press();assert.deepEqual(h.stats(),{prevented:0,stopped:0,exits:0,modes:[],messages:[]});}
});

test('UX-2 fullscreen Escape still exits without a native modal and ignores other keys (non-native)',()=>{
  for(const overlay of ['none','nonmodal','role'] as const)for(const mode of ['normal','viewport','native'] as const){
    const h=fullscreenEscapeHarness(mode,overlay);h.press('Tab');assert.deepEqual(h.stats(),{prevented:0,stopped:0,exits:0,modes:[],messages:[]});h.press();
    assert.deepEqual(h.stats(),{prevented:mode==='normal'?0:1,stopped:mode==='normal'?0:1,exits:mode==='native'?1:0,modes:mode==='viewport'?['normal']:[],messages:mode==='viewport'?['']:[]});
  }
});

test('CK-6: all result kinds encode social handoffs as text/link intents without credentials or publish instructions',()=>{
  for(const game of ['photo','stamp','cash','kitchen'] as const){const link=`https://example.org/play?game=${game}&seed=42${game==='kitchen'?'&recipe=egg-fried-rice':''}`,result={game,title:'黃金蛋炒飯 & <作品>',caption:'這局真的很香！',details:'3 顆星 · 99 分',seed:42,image:'data:image/jpeg;base64,YWJjZA=='};const text=gameShareText(result,link);
    assert.ok(text.includes(link));assert.ok(text.includes(result.details));
    for(const platform of GAME_SHARE_PLATFORMS){const u=new URL(gameSocialLink(platform.id,link,text));assert.equal(u.protocol,'https:');assert.equal(u.username,'');assert.equal(u.password,'');if(platform.id==='facebook'){assert.equal(u.searchParams.get('u'),link);assert.equal(u.searchParams.get('text'),null);}else if(platform.id==='instagram'){assert.equal(u.origin,'https://www.instagram.com');assert.equal(u.search,'');}else assert.equal(u.searchParams.get('text'),text);}
  }
});

test('CK-7: a failed favorite write survives completion against an older valid primary, then retries with fresh score maxima',()=>{
  const base=storage(),now=Date.now(),r=cook('egg-fried-rice').run;let saved=updateCookbook(base,emptyCookbook(),{kind:'complete',run:r},now);
  const denied={...base,setItem(){throw Error('quota');}};saved=updateCookbook(denied,saved.book,{kind:'favorite',id:'rice-balls'},now+1);assert.equal(saved.available,false);assert.deepEqual(saved.book.favorites,['rice-balls']);
  saved=updateCookbook(base,saved.book,{kind:'complete',run:cook('rice-balls').run},now+2,true);assert.equal(saved.available,true);assert.deepEqual(readCookbook(base,now+2).book.favorites,['rice-balls']);assert.equal(Object.keys(saved.book.best).length,2);
});

test('UX-8: every recipe has an explicit 3D design, with closed identities and no implicit dish',()=>{
  assert.deepEqual(Object.keys(DISH_DESIGNS).sort(),RECIPES.map(r=>r.id).sort());assert.ok(new Set(Object.values(DISH_DESIGNS).map(d=>d.family)).size>=30);
  for(const r of RECIPES){assert.equal(dishDesign(r.id),DISH_DESIGNS[r.id]);for(const c of [dishDesign(r.id).base,dishDesign(r.id).top,dishDesign(r.id).accent])assert.match(c,/^#[a-f0-9]{6}$/);}
  for(const id of ['unknown','__proto__','constructor','../../private'])assert.throws(()=>dishDesign(id),/Unknown 3D recipe/);
});
test('UX-8: all 66 native assemblies have finite bounded geometry, distinct real shapes/palettes and one-time disposal',()=>{
  const signatures=new Set<string>();for(const r of RECIPES){const model=createDishModel(r.id),bounds=new Box3().setFromObject(model.root);assert.ok(bounds.min.y>=-.3,r.id);assert.ok(bounds.max.y<3.7,r.id);assert.ok(bounds.min.x>-3.5&&bounds.max.x<3.5&&bounds.min.z>-3.5&&bounds.max.z<3.5,r.id);assert.ok(model.geometries.size<80,r.id);const hash=createHash('sha256');model.root.traverse(o=>{if((o as DishMesh).isMesh){const mesh=o as DishMesh,p=mesh.geometry.getAttribute('position');assert.ok(p.count>0);for(const n of p.array)assert.ok(Number.isFinite(n),r.id);hash.update(Buffer.from(p.array.buffer,p.array.byteOffset,p.array.byteLength));const m=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;hash.update((m as any).color.getHexString());}});signatures.add(hash.digest('hex'));let disposed=0;for(const g of model.geometries)g.addEventListener('dispose',()=>disposed++);model.dispose();model.dispose();assert.equal(disposed,model.geometries.size);assert.equal(model.root.children.length,0);}
  assert.equal(signatures.size,66);
});
test('UX-8: all 66 3D previews bind to the real model factory, native dimensions and immutable bytes',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../modules/absurd-daily/cooking-3d-art.json',import.meta.url),'utf8'));assert.equal(manifest.format,'freedom.cooking-3d-art/v1');assert.equal(manifest.previews.length,66);assert.deepEqual(manifest.previews.map((p:{recipe:string})=>p.recipe).sort(),RECIPES.map(r=>r.id).sort());
  for(const input of manifest.source_inputs)assert.equal(createHash('sha256').update(await readFile(new URL(`../../${input.path}`,import.meta.url))).digest('hex'),input.sha256);
  let bytes=0;for(const r of RECIPES){const entry=manifest.previews.find((p:{recipe:string})=>p.recipe===r.id),raw=await readFile(new URL(`../../${entry.path}`,import.meta.url)),info=await sharp(raw).metadata();assert.deepEqual([info.width,info.height],[512,384]);assert.equal(raw.length,entry.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),entry.sha256);assert.ok(entry.native.calls>0&&entry.native.calls<=100);assert.ok(entry.native.geometries<100);bytes+=raw.length;}assert.ok(bytes<=2.5*1024*1024);assert.equal(bytes,manifest.total_bytes);
});

test('CK-3: 66 original recipes have eight complete categories, unique art identities and real operation plans',()=>{
  assert.equal(RECIPES.length,66);assert.equal(new Set(RECIPES.map(r=>r.id)).size,66);assert.equal(new Set(RECIPES.map(r=>`${r.category}/${r.art}`)).size,66);
  for(const c of CATEGORIES)assert.equal(RECIPES.filter(r=>r.category===c.id).length,['taiwan','world'].includes(c.id)?9:8);
  for(const r of RECIPES){assert.ok(r.steps.length>=3&&r.steps.length<=4);assert.ok(r.ingredients.length>=3);assert.ok(r.estimatedSeconds>=20);assert.ok(r.art>=0&&r.art<9);assert.equal(recipeOf(r.id),r);assert.ok(r.steps.every(s=>TECHNIQUES[s.kind]));}
  assert.deepEqual([...new Set(RECIPES.flatMap(r=>r.steps.map(s=>s.kind)))].sort(),Object.keys(TECHNIQUES).sort());assert.ok(recipeSearch(recipeOf('strawberry-cake')!,'草莓 烘烤'));assert.equal(recipeSearch(RECIPES[0],'不存在的食材'),false);assert.equal(recipeOf('__proto__'),null);
});
function cook(recipeId:string){let run=newCookingRun(recipeOf(recipeId)!,42,`run_${recipeId}`),now=0;const send=(action:Omit<CookingAction,'step'>)=>{now+=150;run=actCooking(run,{...action,step:run.step} as CookingAction,now);};send({kind:'start'});
  let guard=0;while(run.status!=='done'&&guard++<2000){if(run.status==='step-result'){send({kind:'next'});continue;}const s=currentStep(run),a=run.active;
    if(s.kind==='slice'){const x=cutGuide(run);send({kind:'cut',x1:x,y1:.23,x2:x,y2:.78} as CookingAction);}
    if(s.kind==='mix'){for(let i=0;i<=48&&run.status==='playing';i++){const angle=i*Math.PI/12;now+=35;run=actCooking(run,{kind:'stir',step:run.step,x:.5+.3*Math.cos(angle),y:.52+.3*Math.sin(angle)},now);}}
    if(s.kind==='knead'){send({kind:'hold-start'});now+=s.holdMs;run=actCooking(run,{kind:'hold-end',step:run.step},now);}
    if(['pan','boil','bake'].includes(s.kind)){send({kind:'heat',value:s.heat} as CookingAction);now+=100;run=advanceCooking(run,now);if(s.kind==='pan'&&run.active.amount>.5&&!run.active.flipped)send({kind:'flip'});if(s.kind==='boil'&&run.active.foam>=.2)send({kind:'skim'});if(s.kind==='bake'&&run.active.amount>=.79)send({kind:'take-out'});}
    if(s.kind==='pour'){send({kind:'hold-start'});while(run.active.amount<s.target&&run.status==='playing'){now+=50;run=advanceCooking(run,now);}send({kind:'hold-end'});}
    if(s.kind==='fold')send({kind:'fold',index:a.count,direction:s.directions[a.count]} as CookingAction);
    if(s.kind==='plate')send({kind:'place',index:a.count,...plateTarget(run)} as CookingAction);
  }
  assert.equal(run.status,'done',recipeId);return {run,now};
}
test('CK-4/5: actual pointer coordinates, holds, heat and ordered gestures complete all 66 dishes once',()=>{
  for(const recipe of RECIPES){const {run,now}=cook(recipe.id);assert.equal(run.reports.length,recipe.steps.length);assert.ok(cookingScore(run)>=85,`${recipe.id}: ${cookingScore(run)}`);assert.equal(cookingProgress(run),1);assert.deepEqual(parseCookingRun(JSON.parse(JSON.stringify(run))),run);assert.deepEqual(actCooking(run,{kind:'next',step:run.step},now+100),run);assert.deepEqual(advanceCooking(run,now+99999),run);}
});
// Actual keyboard/hold closures and domain. The target models only closest();
// native summary toggling and focus are covered separately in the browser suite.
function cookingSummaryHarness(kind:'slice'|'mix'|'knead'){
  const recipe=RECIPES.find(r=>r.steps[0].kind===kind)!;let now=0;
  const live={current:actCooking(newCookingRun(recipe,42,'summary_keys'),{kind:'start',step:0},now)},holdOwner={current:null as {kind:'key';key:string}|null},gesture={current:null};
  const command=(action:Omit<CookingAction,'step'>)=>{live.current=actCooking(live.current,{...action,step:live.current.step} as CookingAction,now);};
  const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/CookingGame.tsx',import.meta.url),'utf8');
  const holdStart=source.indexOf('  const sameHold='),holdEnd=source.indexOf('  const pause='),keyStart=source.indexOf('  const key='),keyEnd=source.indexOf('  const holdButton=');
  assert.ok(holdStart>=0&&holdEnd>holdStart&&keyStart>=0&&keyEnd>keyStart);
  const handlers=runInNewContext(stripTypeScriptTypes(source.slice(holdStart,holdEnd)+source.slice(keyStart,keyEnd))+';({key})',{
    live,holdOwner,gesture,currentStep,command,flush(){},pause:()=>command({kind:'pause'}),
  }) as {key:(event:any,release?:boolean)=>void};
  const event=(tag:string,key=' ',repeat=false)=>({key,repeat,ctrlKey:false,metaKey:false,altKey:false,defaultPrevented:false,target:{closest:(selector:string)=>selector.split(',').includes(tag)?{}:null},preventDefault(){this.defaultPrevented=true;}});
  return {live,event,key:handlers.key,tick:(ms:number)=>{now+=ms;live.current=advanceCooking(live.current,now);}};
}
for(const kind of ['slice','mix','knead'] as const)test(`UX-2 recipe summary keys never operate ${kind} or consume native defaults (non-native)`,()=>{
  const h=cookingSummaryHarness(kind),before=h.live.current.active,reports=h.live.current.reports;
  for(let i=0;i<3;i++){
    const down=h.event('summary'),repeat=h.event('summary',' ',true);h.key(down);h.key(repeat);h.tick(750);const up=h.event('summary');h.key(up,true);
    assert.deepEqual(h.live.current.active,before);assert.equal(h.live.current.status,'playing');assert.equal(h.live.current.reports,reports);
    assert.equal(down.defaultPrevented,false);assert.equal(repeat.defaultPrevented,false);assert.equal(up.defaultPrevented,false);
  }
  for(const key of ['Enter','ArrowLeft','f','Escape']){const event=h.event('summary',key);h.key(event);assert.equal(event.defaultPrevented,false);assert.equal(h.live.current.status,'playing');}
});
for(const kind of ['slice','mix','knead'] as const)test(`UX-2 section ${kind} shortcut still acts once and rejects repeat or modified input (non-native)`,()=>{
  const h=cookingSummaryHarness(kind),down=h.event('section');h.key(down);assert.equal(down.defaultPrevented,true);
  h.key(h.event('section',' ',true));h.tick(750);h.key(h.event('section'),true);
  if(kind==='mix')assert.equal(h.live.current.active.amount,Math.PI*2);else assert.equal(h.live.current.active.count,1);
  const before=h.live.current;for(const modifier of ['ctrlKey','metaKey','altKey'] as const){const event=h.event('section');event[modifier]=true;h.key(event);assert.equal(event.defaultPrevented,false);assert.equal(h.live.current,before);}
  for(const tag of ['button','input','select','textarea','a']){const event=h.event(tag);h.key(event);assert.equal(event.defaultPrevented,false);assert.equal(h.live.current,before);}
  const escape=h.event('section','Escape');h.key(escape);assert.equal(escape.defaultPrevented,true);assert.equal(h.live.current.status,'paused');assert.equal(h.live.current.active.holdAt,null);
});

test('CK-5: wrong cut, stale step, rapid input, invalid coordinates and rewind cannot fabricate progress',()=>{
  let r=newCookingRun(RECIPES[0],42,'gesture_case');r=actCooking(r,{kind:'start',step:0},100);assert.equal(actCooking(r,{kind:'cut-key',step:1},200),r);assert.equal(actCooking(r,{kind:'cut-key',step:0},99),r);
  r=actCooking(r,{kind:'cut',step:0,x1:.2,y1:.5,x2:.8,y2:.5},300);assert.equal(r.active.count,0);assert.equal(r.active.mistakes,1);r=actCooking(r,{kind:'cut-key',step:0},500);const count=r.active.count;r=actCooking(r,{kind:'cut-key',step:0},510);assert.equal(r.active.count,count);
  for(const bad of [NaN,Infinity,-1,2]){const before=r.active.count;r=actCooking(r,{kind:'cut',step:0,x1:bad,y1:.1,x2:bad,y2:.8},700);assert.equal(r.active.count,before);}
});
test('CK-5/7: background time, cancelled holds, reversed mixing and out-of-bowl motion add no work',()=>{
  const dish=recipeOf('rice-balls')!;let r=newCookingRun(dish,42,'hold_case');r=actCooking(r,{kind:'start',step:0},0);const before=r.active.amount;
  for(let i=0;i<30;i++)r=actCooking(r,{kind:'stir',step:0,x:.5+.3*Math.cos(-i*.3),y:.52+.3*Math.sin(-i*.3)},i*20);assert.equal(r.active.amount,before);r=actCooking(r,{kind:'stir',step:0,x:1,y:1},700);assert.equal(r.active.angle,null);
  r=actCooking(r,{kind:'pause',step:0},750);const paused=JSON.stringify(r);assert.equal(JSON.stringify(advanceCooking(r,999999)),paused);r=actCooking(r,{kind:'resume',step:0},999999);assert.equal(r.elapsed,750);r=advanceCooking(r,1999999);assert.equal(r.elapsed,1000750);
  const knead=recipeOf('italian-meatballs')!;let k=newCookingRun(knead,42,'cancel_case');k={...k,step:2,status:'playing',reports:[{step:0,score:100,elapsed:0,mistakes:0},{step:1,score:100,elapsed:0,mistakes:0}],lastNow:0};k=actCooking(k,{kind:'hold-start',step:2},20);k=actCooking(k,{kind:'cancel',step:2},400);k=actCooking(k,{kind:'hold-end',step:2},800);assert.equal(k.active.count,0);
});

// Exercise the actual component closures and production domain/storage without
// pretending these isolated handlers provide React or native focus evidence.
function cookingFocusHarness(kind:'knead'|'pour'){
  const recipe=recipeOf('margherita-pizza')!;let now=0,run=newCookingRun(recipe,42,'focus_hold');
  const send=(action:Omit<CookingAction,'step'>)=>{run=actCooking(run,{...action,step:run.step} as CookingAction,now);};
  const time=(ms:number)=>{const end=now+ms;while(now<end){now=Math.min(end,now+50);run=advanceCooking(run,now);}};
  send({kind:'start'});
  if(kind==='pour'){
    const knead=currentStep(run);for(let i=0;i<knead.goal;i++){send({kind:'hold-start'});time(knead.holdMs);send({kind:'hold-end'});}
    assert.equal(run.status,'step-result');send({kind:'next'});
  }
  assert.equal(currentStep(run).kind,kind);
  const live={current:run},holdOwner={current:null as {kind:'key';key:string}|{kind:'pointer';id:number}|null},gesture={current:null},saved=storage(),notices:string[]=[],writes:boolean[]=[];
  const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/CookingGame.tsx',import.meta.url),'utf8');
  const start=source.indexOf('  const clearGesture='),end=source.indexOf('  const pause=');assert.ok(start>=0&&end>start);
  const handlers=runInNewContext(stripTypeScriptTypes(source.slice(start,end))+`;({holdStart,holdEnd,commit,blur:typeof cancelKeyHold==='function'?cancelKeyHold:()=>{}})`,{
    live,holdOwner,gesture,pointFrame:{current:0},pendingPoint:{current:null},lastSave:{current:-1000},savedSession:{current:saved},
    performance:{now:()=>now},COOKING_RULES,TECHNIQUES,actCooking,currentStep,saveCookingRun,
    setView(){},setPoint(){},setSelectedIngredient(){},setSaveFailed:(failed:boolean)=>writes.push(failed),setNotice:(notice:string)=>notices.push(notice),
    cancelAnimationFrame(){},requestAnimationFrame(){throw Error('No gesture animation expected');},
  }) as {holdStart:(owner:NonNullable<typeof holdOwner.current>)=>void;holdEnd:(owner:NonNullable<typeof holdOwner.current>)=>void;commit:(next:CookingRun)=>void;blur:()=>void};
  return {...handlers,live,holdOwner,saved,notices,writes,tick:(ms:number)=>{const end=now+ms;while(now<end){now=Math.min(end,now+50);handlers.commit(advanceCooking(live.current,now));}}};
}
for(const kind of ['knead','pour'] as const)for(const key of [' ','Enter'])test(`UX-2 keyboard ${key===' '?'Space':'Enter'} ${kind} hold cancels on focus loss and restarts from real progress (non-native)`,()=>{
  const f=cookingFocusHarness(kind),owner={kind:'key' as const,key},step=currentStep(f.live.current),before=f.live.current;
  f.blur();assert.equal(f.notices.length,0);assert.equal(f.writes.length,0);
  f.holdStart(owner);f.tick(300);f.holdEnd({kind:'key',key:key===' '?'Enter':' '});assert.notEqual(f.live.current.active.holdAt,null);
  f.blur();assert.equal(f.holdOwner.current,null);assert.equal(f.live.current.active.holdAt,null);
  const cancelled=f.live.current,checkpoint=JSON.parse(f.saved.getItem(COOKING_RUN_KEY)!).run;
  assert.deepEqual(checkpoint,JSON.parse(JSON.stringify(cancelled)));assert.equal(cancelled.status,'playing');assert.equal(cancelled.active.count,0);assert.deepEqual(cancelled.reports,before.reports);
  assert.match(f.notices.at(-1)!,/已取消這次按住操作/);const noticeCount=f.notices.length;
  f.tick(4000);f.holdEnd(owner);f.blur();assert.equal(f.live.current.active.amount,cancelled.active.amount);assert.equal(f.live.current.active.count,0);assert.deepEqual(f.live.current.reports,before.reports);assert.equal(f.notices.length,noticeCount);
  f.holdStart(owner);f.tick(kind==='knead'?step.holdMs:(step.target-f.live.current.active.amount)*step.durationMs);f.holdEnd(owner);
  assert.equal(f.holdOwner.current,null);
  if(kind==='knead'){assert.equal(f.live.current.active.count,1);assert.equal(f.live.current.status,'playing');}
  else{assert.equal(f.live.current.status,'step-result');assert.equal(f.live.current.reports.length,before.reports.length+1);assert.ok(f.live.current.reports.at(-1)!.score>=85);}
});
for(const kind of ['knead','pour'] as const)test(`UX-2 focus loss leaves the captured pointer ${kind} hold with its own owner (non-native)`,()=>{
  const f=cookingFocusHarness(kind),owner={kind:'pointer' as const,id:7},step=currentStep(f.live.current);
  f.holdStart(owner);f.tick(300);const held=f.live.current.active.holdAt;f.blur();assert.equal(f.live.current.active.holdAt,held);assert.equal(f.holdOwner.current,owner);assert.equal(f.notices.length,0);
  f.holdEnd({kind:'pointer',id:99});assert.equal(f.holdOwner.current,owner);
  f.tick(kind==='knead'?step.holdMs-300:step.durationMs*step.target-300);f.holdEnd(owner);assert.equal(f.holdOwner.current,null);
  if(kind==='knead')assert.equal(f.live.current.active.count,1);else{assert.equal(f.live.current.status,'step-result');assert.ok(f.live.current.reports.at(-1)!.score>=85);}
});

test('CK-5: flip and skimming are required; over-baking has a reachable low-score ending',()=>{
  const source=cook('egg-fried-rice').run;let r={...newCookingRun(RECIPES[0],42,'pan_case'),step:1,status:'playing' as const,lastNow:0,reports:[source.reports[0]]};r=actCooking(r,{kind:'heat',step:1,value:58},0) as typeof r;for(let t=500;t<=8500;t+=500)r=advanceCooking(r,t) as typeof r;assert.equal(r.status,'playing');assert.equal(r.active.amount>=1,true);r=actCooking(r,{kind:'flip',step:1},9000) as typeof r;assert.equal(r.status,'step-result');
  const recipe=recipeOf('chocolate-brownie')!;let b:CookingRun={...newCookingRun(recipe,42,'bake_case'),step:2,status:'playing',lastNow:0,reports:[{step:0,score:100,elapsed:0,mistakes:0},{step:1,score:100,elapsed:0,mistakes:0}]};for(let t=500;t<=12000&&b.status==='playing';t+=500)b=advanceCooking(b,t);assert.equal(b.status,'done');assert.ok(b.reports.at(-1)!.score<30);
});
test('CK-7: pure checkpoint reads restore a paused run; malformed, future and expired data fail closed',()=>{
  const s=storage(),now=Date.now();let r=newCookingRun(RECIPES[0],42,'checkpoint');r=actCooking(r,{kind:'start',step:0},1);r=actCooking(r,{kind:'cut-key',step:0},150);assert.equal(saveCookingRun(s,r,now),true);const raw=s.getItem(COOKING_RUN_KEY);const restored=readCookingRun(s,now).run!;assert.equal(restored.status,'paused');assert.equal(restored.active.count,1);assert.equal(s.getItem(COOKING_RUN_KEY),raw);clearCookingRun(s,'another-run');assert.equal(s.getItem(COOKING_RUN_KEY),raw);assert.equal(readCookingRun(s,now+RUN_TTL+1).run,null);
  for(const change of [{version:2},{step:99},{elapsed:Infinity},{status:'ready'},{reports:[]}])assert.equal(parseCookingRun({...cook('egg-fried-rice').run,...change}),null);
  s.setItem(COOKING_RUN_KEY,JSON.stringify({version:1,savedAt:now+61000,run:r}));assert.equal(readCookingRun(s,now).run,null);clearCookingRun(s,r.id);
});
test('CK-7: cookbook preserves best score, backs up only valid primary and recovers without any read-side writes',()=>{
  const s=storage(),now=Date.now(),first=cook('egg-fried-rice').run;let saved=updateCookbook(s,emptyCookbook(),{kind:'complete',run:first},now);assert.equal(saved.book.best[first.recipeId].score,cookingScore(first));saved=updateCookbook(s,saved.book,{kind:'favorite',id:first.recipeId},now);const good=s.getItem(COOKBOOK_BACKUP);assert.ok(good);
  const worse={...first,id:'other_run',reports:first.reports.map(r=>({...r,score:20}))};saved=updateCookbook(s,saved.book,{kind:'complete',run:worse},now);assert.equal(saved.book.best[first.recipeId].score,cookingScore(first));s.setItem(COOKBOOK_KEY,'{broken');const backup=s.getItem(COOKBOOK_BACKUP),read=readCookbook(s,now);assert.match(read.notice,/備份/);assert.equal(s.getItem(COOKBOOK_KEY),'{broken');assert.equal(s.getItem(COOKBOOK_BACKUP),backup);updateCookbook(s,read.book,{kind:'retry'},now);assert.equal(s.getItem(COOKBOOK_BACKUP),backup);
  for(const raw of ['{}','{broken',JSON.stringify({...saved.book,version:2}),JSON.stringify({...saved.book,favorites:['unknown']}),JSON.stringify({...saved.book,best:{unknown:{score:90}}})])assert.equal(parseCookbook(raw,now),null);
});
test('CK-7: denied/quota storage keeps a truthful in-memory book, with an explicit retry path',()=>{
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('quota');},removeItem(){throw Error('denied');}};assert.equal(readCookbook(denied).available,false);assert.equal(readCookingRun(denied).run,null);assert.equal(saveCookingRun(denied,newCookingRun(RECIPES[0],42,'denied')),false);const saved=updateCookbook(denied,emptyCookbook(),{kind:'complete',run:cook('egg-fried-rice').run});assert.equal(saved.available,false);assert.equal(Object.keys(saved.book.best).length,1);assert.match(saved.notice,/尚未保存/);
});
test('CK-6: cooking handoff remains bounded v1 and contains a recipe, never a publish command',()=>{
  const now=Date.now(),draft={version:1 as const,createdAt:now,game:'kitchen' as const,recipe:'egg-fried-rice',seed:42,title:'黃金蛋炒飯',text:'我的料理成果',image:'data:image/jpeg;base64,YWJjZA=='};assert.deepEqual(parseGameDraft(JSON.stringify({...draft,autoPublish:true}),now),draft);assert.equal(parseGameDraft(JSON.stringify({...draft,recipe:'../../private'}),now),null);assert.equal(parseGameDraft(JSON.stringify({...draft,recipe:undefined}),now),null);
});

function partyTime<T extends PartyRun>(initial:T,target:number):T {
  let s=initial;while(s.elapsed<target&&s.status==='playing')s=advanceParty(s,Math.min(100,target-s.elapsed)) as T;return s;
}
test('PT-1/2: three original catalogs and deterministic bounded clocks reject inactive and malformed time',()=>{
  assert.equal(PARTY_GAMES.length,3);assert.equal(partyOf('mario'),null);assert.equal(partyOf('tofu'),'tofu');
  assert.deepEqual(Array.from({length:22},(_,i)=>chairWave(42,i)),Array.from({length:22},(_,i)=>chairWave(42,i)));
  assert.notDeepEqual(chairWave(42,0),chairWave(43,0));
  for(const g of PARTY_GAMES){const ready=newParty(g.id,42);assert.equal(advanceParty(ready,500),ready);let s=startParty(ready);assert.equal(startParty(s),s);for(const d of [NaN,Infinity,-1,0])assert.equal(advanceParty(s,d),s);s=advanceParty(s,50000);assert.equal(s.elapsed,1000);const paused=pauseParty(s);assert.equal(advanceParty(paused,1000),paused);assert.equal(actParty(paused,{kind:'jump'}),paused);assert.equal(resumeParty(paused).status,'playing');}
});
test('PT-3: all 22 actual lane decisions collect tickets, avoid collisions and settle the same seeded course once',()=>{
  let s=startParty(newParty('chair',42)) as ChairRun;
  for(let i=0;i<PT.chairWaves;i++){
    const w=chairWave(42,i);assert.notEqual(w.lane,w.ticketLane);
    while(s.lane!==w.ticketLane){s=actParty(s,{kind:'lane',direction:w.ticketLane>s.lane?1:-1}) as ChairRun;s=partyTime(s,s.elapsed+140);}
    s=partyTime(s,w.at);assert.equal(s.lives,3);assert.equal(s.tickets,i+1);assert.equal(s.resolved,i+1);
  }
  s=partyTime(s,PT.chairMs);assert.equal(s.status,'done');assert.equal(s.score,4280);assert.equal(s.bestCombo,22);assert.equal(advanceParty(s,1000),s);assert.equal(actParty(s,{kind:'jump'}),s);
});
test('PT-3: collision uses arrival position, carts can be jumped, meeting tables cannot',()=>{
  const base=startParty(newParty('chair',42)) as ChairRun,w=chairWave(42,0);
  let late:ChairRun={...base,elapsed:w.at-1,resolved:0,lane:w.lane,x:w.lane};late=actParty(late,{kind:'lane',direction:w.lane===1?-1:1}) as ChairRun;
  assert.equal((advanceParty(late,30) as ChairRun).lives,2,'a new target lane cannot teleport across the collision');
  for(const kind of ['cart','meeting']){const i=Array.from({length:22},(_,j)=>j).find(j=>chairWave(42,j).kind===kind)!,wave=chairWave(42,i);let s:ChairRun={...base,elapsed:wave.at-400,resolved:i,lane:wave.lane,x:wave.lane};s=actParty(s,{kind:'jump'}) as ChairRun;assert.equal((advanceParty(s,400) as ChairRun).lives,kind==='cart'?3:2);}
  const locked=actParty(base,{kind:'lane',direction:1}) as ChairRun;assert.equal(actParty(locked,{kind:'lane',direction:-1}),locked);const jump=actParty(base,{kind:'jump'});assert.equal(actParty(jump,{kind:'jump'}),jump);
});
function tofuReady(s:TofuRun,perfect:boolean):TofuRun {
  const started=s.elapsed;while(s.status==='playing'&&s.elapsed-started<5000){const axis=tofuAxis(s),offset=Math.abs(tofuPosition(s)[axis]-s.layers[s.layers.length-1][axis]);if(perfect?offset<.06:offset>2.6)return s;s=advanceParty(s,5) as TofuRun;}throw Error('no reachable seeded tofu timing');
}
test('PT-4: twelve real timed drops build twelve immutable layers, with a single landing per fall',()=>{
  let s=startParty(newParty('tofu',42)) as TofuRun;
  for(let i=0;i<PT.tofuGoal;i++){s=tofuReady(s,true);const old=s;const falling=actParty(s,{kind:'drop'}) as TofuRun;assert.equal(actParty(falling,{kind:'drop'}),falling);assert.equal(falling.layers.length,i+1);s=advanceParty(falling,PT.tofuFallMs-1) as TofuRun;assert.equal(s.layers.length,i+1);s=advanceParty(s,1) as TofuRun;assert.equal(s.layers.length,i+2);assert.equal(old.layers.length,i+1);assert.equal(s.perfects,i+1);}
  assert.equal(s.status,'done');assert.equal(s.layers.length,13);assert.equal(s.score,2925);assert.equal(advanceParty(s,500),s);
});
test('PT-4: clipped overlap narrows the real tower and three misses end the game without extra layers',()=>{
  let s=startParty(newParty('tofu',42)) as TofuRun;
  for(let i=0;i<8&&s.status==='playing';i++){s=tofuReady(s,false);s=advanceParty(actParty(s,{kind:'drop'}),PT.tofuFallMs) as TofuRun;}
  assert.equal(s.status,'done');assert.equal(s.misses,3);assert.ok(s.layers.some(l=>l.width<1||l.depth<1));assert.ok(s.layers.every(l=>l.width>=PT.tofuMinimum&&l.depth>=PT.tofuMinimum));
});
test('PT-5: all twenty real target windows work, stale rounds and repeated holes never score twice',()=>{
  let s=startParty(newParty('holiday',42)) as HolidayRun;
  for(let i=0;i<20;i++){s=partyTime(s,i*PT.holidayRoundMs+PT.holidayOpenMs);const {good,boss}=holidayTargets(42,i);assert.notEqual(good,boss);const before=s;s=actParty(s,{kind:'pick',hole:good,round:i}) as HolidayRun;assert.equal(s.saved,i+1);assert.equal(actParty(s,{kind:'pick',hole:good,round:i}),s);assert.equal(actParty(s,{kind:'pick',hole:boss,round:i-1}),s);assert.equal(before.saved,i);}
  s=partyTime(s,PT.holidayMs);assert.equal(s.status,'done');assert.equal(s.score,5100);assert.equal(s.bestCombo,20);assert.equal(s.mistakes,0);
});
test('PT-5: missed windows, bosses and empty holes break combos with a nonnegative score floor',()=>{
  let s=startParty(newParty('holiday',42)) as HolidayRun;const {good,boss}=holidayTargets(42,0);assert.equal(actParty(s,{kind:'pick',hole:good,round:0}),s);s=partyTime(s,PT.holidayOpenMs);s=actParty(s,{kind:'pick',hole:good,round:0}) as HolidayRun;assert.equal(s.combo,1);s=actParty(s,{kind:'pick',hole:boss,round:0}) as HolidayRun;assert.equal(s.combo,0);assert.equal(s.score,40);const empty=Array.from({length:6},(_,i)=>i).filter(i=>i!==good&&i!==boss);for(const hole of empty)s=actParty(s,{kind:'pick',hole,round:0}) as HolidayRun;assert.equal(s.score,0);assert.equal(actParty(s,{kind:'pick',hole:NaN,round:0}),s);s=partyTime(s,1200+120);s=actParty(s,{kind:'pick',hole:holidayTargets(42,1).good,round:1}) as HolidayRun;assert.equal(s.combo,1);s=partyTime(s,3*1200);assert.equal(s.combo,0);
});
test('PT-7: party results extend the bounded v1 whitelist and strip untrusted publishing fields',()=>{
  const now=Date.now();for(const g of PARTY_GAMES){const draft={version:1,createdAt:now,game:g.id,seed:42,title:g.title,text:'本局 120 分',image:'data:image/jpeg;base64,YWJjZA=='};assert.deepEqual(parseGameDraft(JSON.stringify({...draft,recipe:'extra',autoPublish:true,score:999999}),now),draft);assert.equal(parseGameDraft(JSON.stringify({...draft,game:'../../private'}),now),null);}
});
test('PT-6: each tiny lobby preview binds to the actual procedural renderer, dimensions and immutable bytes',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../modules/absurd-daily/party-art.json',import.meta.url),'utf8'));
  assert.equal(manifest.format,'freedom.party-art/v1');assert.equal(manifest.previews.length,3);assert.equal(createHash('sha256').update(await readFile(new URL(`../../${manifest.source}`,import.meta.url))).digest('hex'),manifest.source_sha256);
  for(const input of manifest.source_inputs??[])assert.equal(createHash('sha256').update(await readFile(new URL(`../../${input.path}`,import.meta.url))).digest('hex'),input.sha256);
  let bytes=0;for(const g of PARTY_GAMES){const a=manifest.previews.find((p:{game:string})=>p.game===g.id);assert.ok(a);const raw=await readFile(new URL(`../../${a.path}`,import.meta.url)),info=await sharp(raw).metadata();assert.deepEqual([info.width,info.height],[640,480]);assert.equal(raw.length,a.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),a.sha256);bytes+=raw.length;}assert.ok(bytes<100000);
});


test('UX-12 sauce follows the cooked surface and falls onto the plate without mutating the saved run',()=>{
  const run=displayMarket('steak-dinner');run.portions=run.portions.slice(0,1);run.sauces=[{sauce:'garlic',points:[{x:.05,y:.5},{x:.4,y:.5},{x:.95,y:.5}]}];const saved=JSON.stringify(run),model=createDishModel('steak-dinner',run);let found=0;
  try{model.root.traverse(o=>{if(!(o as DishMesh).isMesh)return;const mesh=o as DishMesh;if(Array.isArray(mesh.material)||(mesh.material as any).color?.getHexString()!=='e9dfbd')return;found++;const bounds=new Box3().setFromObject(mesh);assert.ok(bounds.min.y<.2,'sauce must reach the plate outside the cutlet');assert.ok(bounds.max.y<.85,'sauce must not float over the cooked meal');});assert.equal(found,1);assert.equal(JSON.stringify(run),saved);}finally{model.dispose();}
});

test('UX-14: a steak sits on exposed cast iron, with open ear holes and a separate wooden trivet',()=>{
  const {Raycaster,Vector3}=createRequire(new URL('../../apps/portal-web/package.json',import.meta.url))('three');
  const run=displayMarket('steak-dinner');run.portions=run.portions.slice(0,1);const saved=JSON.stringify(run),model=createDishModel('steak-dinner',run);
  try{
    model.root.updateWorldMatrix(true,true);
    const ray=new Raycaster(new Vector3(1.9,5,0),new Vector3(0,-1,0));
    const exposed=ray.intersectObject(model.root,true)[0];assert.ok(exposed,'there is a serving surface');assert.equal((exposed.object as DishMesh).material instanceof Array,false);assert.equal(((exposed.object as DishMesh).material as any).color.getHexString(),'25272a','the wooden trivet cannot cover the iron well');
    ray.ray.origin.set(2.65,5,0);const throughEar=ray.intersectObject(model.root,true)[0];assert.ok(throughEar);assert.equal(((throughEar.object as DishMesh).material as any).color.getHexString(),'af7d4d','the ear is a real hole with wood below');
    const meat=model.root.children.find(o=>(o as DishMesh).isMesh&&Array.isArray((o as DishMesh).material))!;assert.ok(meat);const bounds=new Box3().setFromObject(meat);assert.ok(bounds.min.y>=.14&&bounds.min.y<=.16,'the steak rests on the iron well');assert.equal(JSON.stringify(run),saved);
  }finally{model.dispose();}
});

// Execute the actual cash/settlement closures with a controlled stage. Browser
// coverage remains responsible for real WebGL, image export and input dispatch.
function cashBoard(completedCards:number, failure?:'update'|'capture') {
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/AbsurdDaily.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm'}).code;
  const names=['draw','render','stop','finish','settle','syncClock','applyCash'];
  const functions=names.map(name=>{
    const start=new RegExp(`^( *)function ${name}\\(`,'m').exec(source);assert.ok(start,name);
    const tail=source.slice(start.index),end=new RegExp(`^${start[1]}}`,'m').exec(tail);assert.ok(end,`${name} end`);
    return tail.slice(0,end.index+end[0].length);
  }).join('\n');
  let cash=newCash(42);
  for(const card of cashDeck(42).slice(0,completedCards))cash=sortCash(cash,cash.index,card.valid,cash.index*250).state;
  const live={current:{game:'cash',seed:42,cash,clock:{elapsed:7500,last:7500,running:true},started:true,paused:false,done:false,pointer:{id:1},raised:true}};
  const events:{kind:string;index:number;running:boolean;raised:boolean;pointer:unknown}[]=[];
  const results:any[]=[],notices:string[]=[];
  let fail=failure,captureError=false,now=7500;
  const captureFailures={current:0};
  const record=(kind:string)=>events.push({kind,index:live.current.cash.index,running:live.current.clock.running,raised:live.current.raised,pointer:live.current.pointer});
  const stage={current:{
    update(){record('update');if(fail==='update'){fail=undefined;throw Error('render failed');}},
    stats(){return {calls:1,triangles:1,textures:1};},
    capture(){record('capture');if(fail==='capture'){fail=undefined;throw Error('capture failed');}return 'data:image/jpeg;base64,frame';},
  }};
  const pendingResult={current:null as any};
  const api=runInNewContext(`${functions};({applyCash,settle})`,{
    live,stage,pendingResult,view:()=>({cash:live.current.cash}),host:{current:{dataset:{}}},frame:{current:7},motionRef:{current:true},game:'cash',seed:42,
    performance:{now:()=>now},tick,pause,sortCash,cashNotice,seconds,GAMES,captureFailures,cancelAnimationFrame:()=>record('stop'),
    syncDiagnostics,audio:{current:null},setReady:()=>{},setError:()=>{},
    sfx:()=>{},setNotice:(text:string)=>notices.push(text),updateUi:()=>{},onResult:(result:any)=>results.push(result),setCaptureError:(value:boolean)=>{captureError=value;},
  }) as {applyCash:(accept:boolean,index?:number)=>void;settle:(summary:any)=>void};
  return {...api,live,events,results,pendingResult,notices,advance:(ms:number)=>{now+=ms;},failNext:(value:'update'|'capture')=>{fail=value;},get captureError(){return captureError;}};
}

test('AD-5 nonterminal cash inputs still render; wrong and stale inputs retain their rules',()=>{
  const h=cashBoard(0),first=cashDeck(42)[0];
  h.applyCash(!first.valid);
  assert.equal(h.live.current.cash.index,0);assert.equal(h.live.current.cash.mistakes,1);
  assert.deepEqual(h.events.map(e=>e.kind),['update']);assert.equal(h.results.length,0);
  const correct=cashBoard(0);correct.applyCash(first.valid);
  assert.equal(correct.live.current.cash.index,1);assert.deepEqual(correct.events.map(e=>e.kind),['update']);
  correct.applyCash(first.valid,0);assert.equal(correct.events.length,1);
});

test('AD-5 terminal cash input stops before its sole update and publishes the complete result once',()=>{
  const h=cashBoard(29);h.applyCash(true);
  assert.deepEqual(h.events.map(e=>e.kind),['stop','update','capture','stop']);
  const update=h.events[1];assert.equal(update.index,30);assert.equal(update.running,false);assert.equal(update.raised,false);assert.equal(update.pointer,null);
  assert.equal(h.live.current.cash.amount,1_000_000);assert.equal(h.live.current.cash.rejected,6);
  assert.equal(h.results.length,1);assert.match(h.results[0].details,/100 萬道具鈔 · 退回 6 張票券/);
  assert.equal(h.results[0].image,'data:image/jpeg;base64,frame');
  h.applyCash(true);assert.equal(h.results.length,1);assert.equal(h.events.length,4);
});

test('AD-5 repeated wrong and correct cash inputs announce only accepted state changes',()=>{
  const h=cashBoard(0),deck=cashDeck(42);
  for(let attempt=1;attempt<=2;attempt++){
    h.applyCash(!deck[0].valid);assert.equal(h.notices.at(-1),`這張分錯了，退回來重新看看。 已分類 0 / 30 張 · 分錯 ${attempt} 次。`);
    h.applyCash(!deck[0].valid);assert.equal(h.notices.length,attempt,'cooldown does not announce another failure');h.advance(200);
  }
  h.applyCash(deck[0].valid);assert.match(h.notices.at(-1)!,/已分類 1 \/ 30 張 · 分錯 2 次/);h.advance(200);
  h.applyCash(deck[0].valid,0);assert.equal(h.notices.length,3,'stale card does not announce progress');
  h.applyCash(deck[1].valid);assert.match(h.notices.at(-1)!,/已分類 2 \/ 30 張 · 分錯 2 次/);
});

for(const failure of ['update','capture'] as const)test(`AD-5 terminal ${failure} failure retains completed facts for explicit capture retry`,()=>{
  const h=cashBoard(29,failure);h.applyCash(true);
  assert.equal(h.captureError,true);assert.equal(h.results.length,0);assert.equal(h.live.current.done,false);
  assert.equal(h.live.current.clock.running,false);assert.equal(h.live.current.cash.index,30);
  assert.match(h.notices.at(-1)!,/完成次數不會重算/);
  const completed=h.live.current.cash,summary=h.pendingResult.current;
  assert.match(h.notices.at(-1)!,/^第 1 次產生成果圖片失敗。/);
  h.failNext(failure);h.settle(summary);assert.match(h.notices.at(-1)!,/^第 2 次產生成果圖片失敗。/);
  assert.equal(h.live.current.cash,completed);assert.equal(h.pendingResult.current,summary);assert.equal(h.results.length,0);
  h.events.length=0;h.settle(summary);
  assert.deepEqual(h.events.map(e=>e.kind),['stop','update','capture','stop']);
  assert.equal(h.live.current.cash,completed);assert.equal(h.pendingResult.current,summary);
  assert.equal(h.results.length,1);assert.equal(h.live.current.done,true);
});

// PT-LIGHT-PURE-BEGIN: this block also runs with Node's built-in TS stripping,
// against the actual pure modules, when the full suite's dependencies are absent.
import {holidayCells,holidayInput,holidayResultSvg,holidayResultImage} from '../../apps/portal-web/src/games/party/light-holiday.js';
import {loadPartyStage} from '../../apps/portal-web/src/games/party/stage-loader.js';

test('PT-light: six cells expose only the live open targets, pressed cells and paused state',()=>{
  const initial=newParty('holiday',42) as HolidayRun;
  assert.equal(holidayCells(initial).length,6);assert.ok(holidayCells(initial).every(c=>!c.enabled&&c.kind==='waiting'));
  let run=partyTime(startParty(initial) as HolidayRun,PT.holidayOpenMs);
  const targets=holidayTargets(run.seed,run.round),cells=holidayCells(run);
  assert.equal(cells.filter(c=>c.kind==='good').length,1);assert.equal(cells[targets.good].label,'休假');assert.equal(cells[targets.boss].label,'開會');assert.equal(cells.filter(c=>c.enabled).length,6);
  run=actParty(run,{kind:'pick',hole:targets.good,round:run.round}) as HolidayRun;
  assert.equal(holidayCells(run)[targets.good].enabled,false);assert.equal(holidayCells(run)[targets.good].label,'已選');
  assert.ok(holidayCells(pauseParty(run) as HolidayRun).every(c=>!c.enabled));
  assert.ok(holidayCells(partyTime(run,PT.holidayCloseMs)).every(c=>!c.enabled));
});

test('PT-light: pointer and both native activation keys retain the down wave and reject cancellation',()=>{
  for(const owner of ['pointer:1','key: ','key:Enter']){
    const input=holidayInput();let run=partyTime(startParty(newParty('holiday',42)) as HolidayRun,4600);
    assert.ok(input.down(0,owner,run.round));assert.equal(input.down(0,'pointer:2',run.round),false);
    run=partyTime(run,4930);input.up(0,owner);const round=input.click(0,run.round,owner)!;
    assert.equal(round,3);assert.equal(actParty(run,{kind:'pick',hole:0,round}),run);
    assert.ok(input.down(0,owner,run.round));input.cancel();assert.equal(input.click(0,run.round,owner),null);
    assert.ok(input.down(0,owner,run.round));input.lost(0,owner);assert.equal(input.click(0,run.round,owner),null);
    assert.ok(input.down(0,owner,run.round));input.up(0,owner);input.lost(0,owner);assert.equal(input.click(0,run.round,owner),run.round,'normal pointer release keeps the following click');
    assert.equal(input.click(0,run.round,owner),null,'one held input can commit only once');
    input.down(0,owner,3);assert.ok(input.down(0,owner,4),'a new physical down recovers after a disabled cell swallowed release');assert.equal(input.click(0,4,owner),4);
  }
});

test('PT-light: assistive clicks work without a down, while a held physical input cannot be stolen',()=>{
  const input=holidayInput();assert.equal(input.pointerClick(4),null);assert.equal(input.assistive(4,2),2);
  input.down(4,'pointer:1',2);assert.equal(input.pointerClick(4),null);input.up(4,'pointer:2');assert.equal(input.pointerClick(4),null);input.up(4,'pointer:1');assert.equal(input.pointerClick(4),2);assert.equal(input.pointerClick(4),null);
  input.down(4,'key: ',2);assert.equal(input.assistive(4,2),null);assert.equal(input.click(4,2,'key:Enter'),null);
  input.cancel(4);assert.equal(input.assistive(4,2),2);assert.equal(input.click(4,2,'key: '),null);
});

test('PT-light: a full same-domain holiday run yields a truthful finished SVG without any renderer',()=>{
  let run=startParty(newParty('holiday',42)) as HolidayRun;
  assert.throws(()=>holidayResultSvg(run),/not complete/);
  for(let round=0;round<20;round++){
    run=partyTime(run,round*PT.holidayRoundMs+250);
    const good=holidayCells(run).find(c=>c.kind==='good')!;
    run=actParty(run,{kind:'pick',hole:good.hole,round:run.round}) as HolidayRun;
    if(round===5){const paused=pauseParty(run);assert.equal(advanceParty(paused,1000),paused);run=resumeParty(paused) as HolidayRun;}
  }
  run=partyTime(run,PT.holidayMs);assert.equal(run.score,5100);assert.equal(run.saved,20);assert.equal(run.status,'done');
  const before=JSON.stringify(run),svg=holidayResultSvg(run);
  assert.match(svg,/5100 分/);assert.match(svg,/搶救 20 個假日/);assert.match(svg,/誤選 0 次/);assert.match(svg,/最長 20 連擊/);assert.match(svg,/完成 24 秒/);assert.match(svg,/同題 #42/);assert.match(svg,/輕量成果卡/);
  assert.doesNotMatch(svg,/<(?:image|script|foreignObject)\b|https?:\/\/[^w]/);assert.equal(decodeURIComponent(holidayResultImage(run).split(',')[1]),svg);assert.equal(JSON.stringify(run),before);
  const altered={...run,score:17,saved:2,mistakes:3,bestCombo:1};const other=holidayResultSvg(altered);assert.match(other,/17 分/);assert.match(other,/搶救 2 個假日 · 誤選 3 次/);assert.doesNotMatch(other,/5100/);
});

function partyLoaderHarness(){
  let resolve!:(create:(lost:()=>void)=>{dispose:()=>void})=>void,reject!:(error:Error)=>void,timeout=()=>{},lost=()=>{};
  const events:string[]=[],pending=new Promise<(lost:()=>void)=>{dispose:()=>void}>((yes,no)=>{resolve=yes;reject=no;});
  const owner=loadPartyStage({load:()=>{events.push('load');return pending;},install:()=>events.push('install'),ready:()=>events.push('ready'),failed:reason=>events.push(reason),timeoutMs:15000,schedule:fn=>{timeout=fn;return 7;},clear:id=>{assert.equal(id,7);}});
  return {owner,events,timeout:()=>timeout(),lose:()=>lost(),resolve:()=>resolve(callback=>{events.push('create');lost=callback;return {dispose:()=>events.push('dispose')};}),reject:()=>reject(Error('offline'))};
}
const partyMicrotasks=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('PT-light: timeout, cancellation and a newer owner isolate late imports and rejections',async()=>{
  for(const reason of ['timeout','cancel','reject']){
    const old=partyLoaderHarness();await partyMicrotasks();if(reason==='timeout')old.timeout();else if(reason==='cancel')old.owner.cancel();else{old.reject();await partyMicrotasks();}
    const current=partyLoaderHarness();await partyMicrotasks();current.resolve();old.resolve();await partyMicrotasks();
    assert.deepEqual(old.events,reason==='timeout'?['load','timeout']:reason==='reject'?['load','load']:['load']);
    assert.deepEqual(current.events,['load','create','install','ready']);old.lose();old.timeout();assert.deepEqual(current.events,['load','create','install','ready']);current.owner.cancel();assert.equal(current.events.at(-1),'dispose');
  }
});

test('PT-light: only an open restart confirmation consumes Escape before the fullscreen owner',()=>{
  const source=readFileSync(new URL('../../apps/portal-web/src/games/party/PartyGame.tsx',import.meta.url),'utf8');
  const start=source.indexOf('  escapeCapture.current='),end=source.indexOf('\n  useEffect(',start);assert.ok(start>=0&&end>start);
  const input=holidayInput(),gesture={current:{id:1}},calls:string[]=[];
  const live=pauseParty(actParty(partyTime(startParty(newParty('holiday',42)) as HolidayRun,300),{kind:'pick',hole:holidayTargets(42,0).good,round:0}));
  const context:any={escapeCapture:{current:undefined},input:{current:input},gesture,restart:false,live,keepRun:()=>{context.restart=false;calls.push('focus-restart');}};
  const escape=runInNewContext(source.slice(start,end)+'\nescapeCapture.current',context);
  const event=()=>({preventDefault:()=>calls.push('prevent'),stopPropagation:()=>calls.push('stop')});
  input.down(0,'key: ',0);escape(event());assert.deepEqual(calls,[],'ordinary Escape must reach fullscreen');assert.equal(input.click(0,0,'key: '),null);assert.equal(gesture.current,null);
  context.restart=true;input.down(0,'key:Enter',0);escape(event());assert.deepEqual(calls,['prevent','stop','focus-restart']);assert.equal(input.click(0,0,'key:Enter'),null);
  calls.length=0;escape(event());assert.deepEqual(calls,[],'the next Escape must reach fullscreen');assert.equal(context.live,live);assert.equal(live.status,'paused');assert.equal(live.score,120);
});

test('PT-light: a loaded scene is released once on context loss or cancellation, including first draw failure',async()=>{
  const h=partyLoaderHarness();await partyMicrotasks();h.resolve();await partyMicrotasks();h.lose();h.lose();h.owner.cancel();assert.deepEqual(h.events,['load','create','install','ready','dispose','lost']);
  const events:string[]=[];
  loadPartyStage({load:async()=>()=>({dispose:()=>events.push('dispose')}),install:()=>{throw Error('first draw');},ready:()=>events.push('ready'),failed:r=>events.push(r),timeoutMs:15000,schedule:()=>1,clear:()=>{}});
  await partyMicrotasks();assert.deepEqual(events,['dispose','load']);
  loadPartyStage({load:async()=>lost=>{lost();return {dispose:()=>events.push('late-dispose')};},install:()=>events.push('install'),ready:()=>events.push('ready'),failed:r=>events.push(r),timeoutMs:15000,schedule:()=>1,clear:()=>{}});
  await partyMicrotasks();assert.deepEqual(events,['dispose','load','lost','late-dispose']);
});
// PT-LIGHT-PURE-END

test('PT-light: actual controller handlers retain live progress, missing releases, restart focus and a renderer-free result (non-native)',async()=>{
  const code=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/party/PartyGame.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code.replace('import("./stage")','Promise.resolve().then(()=>require("./stage"))');
  const slots:any[]=[],effects:Array<()=>void>=[],buttons:any[]=[],results:any[]=[],frames=new Map<number,(at:number)=>void>();
  let index=0,dirty=false,sequence=0,section:any,focused='',created=0;const escapeListeners=new Set<(event:any)=>void>();
  const same=(a:any[],b:any[])=>a?.length===b?.length&&a.every((value,i)=>Object.is(value,b[i]));
  const hooks={useRef:(value:any)=>{const i=index++;return slots[i]??(slots[i]={current:value});},useState:(value:any)=>{const i=index++;if(!slots[i])slots[i]={value:typeof value==='function'?value():value};return [slots[i].value,(next:any)=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},useEffect:(fn:()=>any,deps:any[])=>{const i=index++,old=slots[i];if(!old||!same(old.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
  const host={dataset:{} as Record<string,string|number>,focus:()=>{focused='host';},closest:()=>({scrollIntoView(){}})};
  const label=(value:any):string=>Array.isArray(value)?value.map(label).join(''):value&&typeof value==='object'?(value.props?.['aria-hidden']?'':label(value.props?.children)):typeof value==='string'?value:'';
  const jsx=(type:any,props:any)=>{if(type==='section')section=props;if(type==='div'&&props.ref)props.ref.current=host;if(type==='button'){buttons.push(props);if(props.ref)props.ref.current={focus:()=>{focused=label(props.children);}};}return {type,props};};
  const module={exports:{} as any};class Button{}class Anchor{}
  runInNewContext(code,{module,exports:module.exports,HTMLButtonElement:Button,HTMLAnchorElement:Anchor,matchMedia:()=>({matches:true}),requestAnimationFrame:(callback:(at:number)=>void)=>{const id=++sequence;frames.set(id,callback);return id;},cancelAnimationFrame:(id:number)=>frames.delete(id),document:{hidden:false,addEventListener(){},removeEventListener(){}},window:{addEventListener:(name:string,listener:(event:any)=>void,capture?:boolean)=>{if(name==='keydown'&&capture)escapeListeners.add(listener);},removeEventListener:(name:string,listener:(event:any)=>void)=>{if(name==='keydown')escapeListeners.delete(listener);}},require:(path:string)=>{
    if(path==='react')return hooks;if(path==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};
    if(path==='./stage-loader')return {loadPartyStage:(options:any)=>loadPartyStage({...options,schedule:()=>1,clear:()=>{}})};
    if(path==='./stage')return {createPartyStage:()=>{created++;throw Error('WebGL unavailable');}};
    if(path==='./light-holiday')return {holidayCells,holidayInput,holidayResultImage};
    if(path==='./catalog')return {PARTY_GAMES,PARTY_RULES:PT};
    if(path==='./domain')return {actParty,advanceParty,newParty,partySummary,pauseParty,resumeParty,startParty,tofuAxis,tofuPosition};
    if(path==='../diagnostics')return {syncDiagnostics:(node:any,values:any)=>Object.assign(node.dataset,values)};
    return {GameCover:()=>null};
  }});
  const render=()=>{index=0;dirty=false;buttons.length=0;module.exports.PartyGame({game:'holiday',seed:42,onBack(){},onResult:(result:any)=>results.push(result)});while(effects.length)effects.shift()!();};
  const settle=async()=>{for(let i=0;i<12;i++){if(dirty)render();await Promise.resolve();}};
  const button=(text:string)=>{const found=buttons.find(b=>label(b.children).trim()===text);assert.ok(found,`button ${text}`);return found;};
  const key=(value:string)=>({key:value,repeat:false,altKey:false,ctrlKey:false,metaKey:false,target:new Button(),preventDefault(){},stopPropagation(){}});
  let time=0;const tick=(ms:number)=>{time+=ms;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(time);if(dirty)render();};
  const advance=(target:number)=>{for(let i=0;i<1000&&Number(host.dataset.elapsed??0)<target;i++)tick(50);assert.ok(Number(host.dataset.elapsed)>=target);};
  render();await settle();assert.equal(created,1);button('改用輕量玩法').onClick();await settle();assert.equal(section['data-party-mode'],'light');button('開始派對！').onClick();await settle();tick(0);advance(300);
  const good=()=>{const found=buttons.find(b=>/第 [1-6] 格：休假/.test(b['aria-label']??''));assert.ok(found);return found;};
  const held=good();held.onKeyDown(key(' '));for(const listener of escapeListeners)listener(key('Escape'));held.onKeyUp(key(' '));await settle();assert.equal(section['data-party-score'],0,'native capture cancels even when an outer React capture swallows Escape');held.onKeyDown(key(' '));advance(1450); // No keyup/onBlur: simulate a disabled node swallowing release.
  const current=good();current.onKeyDown(key(' '));current.onKeyUp(key(' '));await settle();assert.equal(section['data-party-score'],120);
  button('重新開始').onClick();await settle();assert.equal(focused,'確定重來');const frozen=host.dataset.elapsed;
  section.onKeyDown({...key('Enter'),target:host});await settle();tick(500);assert.equal(host.dataset.elapsed,frozen);assert.equal(section['data-party-state'],'paused');
  for(const listener of escapeListeners)listener(key('Escape'));await settle();assert.equal(focused,'重新開始');button('繼續這一局').onClick();await settle();tick(0);
  advance(2650);good().onClick({detail:0});await settle();assert.equal(section['data-party-score'],260);
  advance(PT.holidayMs);assert.equal(section['data-party-state'],'done');assert.equal(created,1);section.onKeyDown({...key('Enter'),target:new Anchor()});assert.equal(results.length,0,'Enter on the SVG link retains native download behavior');button('查看這局成果').onClick();await settle();assert.equal(results.length,1);assert.match(results[0].image,/^data:image\/svg\+xml/);assert.match(decodeURIComponent(results[0].image.split(',')[1]),/260 分/);
  for(const slot of slots)slot?.cleanup?.();assert.equal(frames.size,0);assert.equal(escapeListeners.size,0);
});



test('UX-15c: a held holiday canvas gesture retains its original round across a target change',()=>{
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/party/PartyGame.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm'}).code;
  const closures=['down','up'].map(name=>{
    const start=new RegExp(`^( *)function ${name}\\(`,'m').exec(source);assert.ok(start,name);
    const tail=source.slice(start.index),end=new RegExp(`^${start[1]}}`,'m').exec(tail);assert.ok(end,`${name} end`);
    return tail.slice(0,end.index+end[0].length);
  }).join('\n');
  const live={current:partyTime(startParty(newParty('holiday',42)) as HolidayRun,4600)},gesture={current:null as null|{id:number;x:number;y:number;round:number}};
  assert.equal(holidayTargets(42,live.current.round).good,0);
  const actions:unknown[]=[],target={setPointerCapture(){},hasPointerCapture(){return true;},releasePointerCapture(){},focus(){}};
  const h=runInNewContext(`${closures}\n({down,up})`,{live,gesture,game:'holiday',R:PT,stage:{current:{pick:()=>0}},action:(a:any)=>{actions.push(a);live.current=actParty(live.current,a) as HolidayRun;}});
  const event={button:0,isPrimary:true,pointerId:1,clientX:100,clientY:100,preventDefault(){},currentTarget:target};
  h.down(event);assert.equal(gesture.current?.round,3);
  live.current=partyTime(live.current,4930);const nextRound=live.current;
  assert.equal(nextRound.round,4);assert.equal(holidayTargets(42,4).boss,0);
  h.up(event);assert.equal(live.current,nextRound,'release cannot penalize or score the newly appeared target');assert.equal((actions[0] as any).round,3);
  h.down(event);h.up(event);assert.equal(live.current.mistakes,nextRound.mistakes+1,'a fresh gesture still acts on the current target');
});

test('UX-15c: selectable steak geometry retains original portion indices after an interleaved side dish',()=>{
  const run=displayMarket('steak-dinner'),side=run.portions.find(p=>p.kind==='potato')!;
  run.portions=[side,run.portions[0],side,run.portions[1]];const before=JSON.stringify(run),model=createDishModel(run.recipe,run);
  try{const indices:number[]=[];model.root.traverse(o=>{if(typeof o.userData.portion==='number')indices.push(o.userData.portion);});assert.deepEqual(indices.sort(),[1,3]);assert.equal(JSON.stringify(run),before);}finally{model.dispose();}
});

test('UX-15e: all 72 menu covers have distinct immutable local assets, bounded bytes and recorded prompts',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../modules/absurd-daily/illustrated-art.json',import.meta.url),'utf8'));
  const ids=[...RECIPES.map(r=>r.id),...PARTY_GAMES.map(g=>g.id),...GAMES.map(g=>g.id)];
  assert.equal(manifest.format,'freedom.illustrated-game-covers/v1');assert.equal(manifest.previews.length,ids.length);
  assert.equal(new Set(manifest.previews.map((p:any)=>p.sha256)).size,72);
  assert.equal(coverOf('../../private'),null);assert.equal(coverOf('not-a-game'),null);let bytes=0;
  for(const id of ids){
    const p=manifest.previews.find((p:any)=>p.id===id);assert.ok(p,id);assert.equal(coverOf(id)?.src,`/games/absurd-daily/illustrated/${id}.webp`);
    const raw=await readFile(new URL(`../../${p.path}`,import.meta.url)),info=await sharp(raw).metadata();
    assert.deepEqual([info.width,info.height],[512,340]);assert.equal(raw.length,p.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),p.sha256);assert.ok(raw.length<=102400);bytes+=raw.length;
    assert.ok(manifest.atlases.some((a:any)=>a.id===p.atlas));
  }
  for(const atlas of manifest.atlases){const prompt=await readFile(new URL(`../../${atlas.prompt}`,import.meta.url));assert.equal(createHash('sha256').update(prompt).digest('hex'),atlas.prompt_sha256);}
  assert.equal(bytes,manifest.total_bytes);assert.ok(bytes<=5*1024*1024);
});

test('UX-8 preview operator: dry plan and pure receipt validation never imply native execution',async()=>{
  const tool=await import(new URL('../../modules/absurd-daily/tools/native-previews.mjs',import.meta.url).href);
  const planned=await tool.plan();assert.equal(planned.mode,'dry-plan');assert.deepEqual([...planned.recipes].sort(),RECIPES.map(r=>r.id).sort());
  // Synthetic validator fixture ONLY: no browser, DOM or fabricated native evidence is saved.
  const receipt=()=>({status:'captured',errors:[],environment:{browser:'validator-fixture',renderer:'not-native',dpr:1},source_inputs:structuredClone(planned.source_inputs),
    build:{factory:'assets/dish.js',inputs:[planned.source_inputs[0]],chunks:[{file:'assets/dish.js',sha256:'a'.repeat(64),imports:[],modules:['apps/portal-web/src/games/cooking/dish-stage.ts']}]},
    total_bytes:66,previews:RECIPES.map(r=>({recipe:r.id,path:`apps/portal-web/public/games/absurd-daily/cooking/3d/${r.id}.webp`,width:512,height:384,bytes:1,sha256:'b'.repeat(64),source_png_sha256:'c'.repeat(64),native:{calls:1,geometries:1,triangles:1,textures:1},canvas_after_dispose:0}))});
  assert.equal(tool.validateCapture(receipt(),planned),true);
  for(const mutate of [
    (r:any)=>{r.status='failed';},(r:any)=>{r.errors.push('decode failure');},(r:any)=>{r.environment.renderer=null;},
    (r:any)=>{r.previews.pop();},(r:any)=>{r.previews[1]=r.previews[0];},(r:any)=>{r.previews[0].width=511;},
    (r:any)=>{r.previews[0].sha256='bad';},(r:any)=>{r.previews[0].bytes=-1;},(r:any)=>{r.total_bytes++;},
    (r:any)=>{r.previews[0].native.calls=101;},(r:any)=>{r.previews[0].native.geometries=100;},(r:any)=>{r.previews[0].native.textures=-1;},(r:any)=>{r.previews[0].native.textures=NaN;},(r:any)=>{r.previews[0].canvas_after_dispose=1;},
    (r:any)=>{r.source_inputs[0].sha256='d'.repeat(64);},(r:any)=>{r.build.chunks[0].imports=['assets/missing.js'];},
    (r:any)=>{r.build.chunks[0].modules=[];},(r:any)=>{r.previews[0].path='../escape.webp';},
  ]){const r=receipt();mutate(r);assert.throws(()=>tool.validateCapture(r,planned));}
  for(const path of ['../escape','/absolute','a/../b','a\\b','a//b'])assert.throws(()=>tool.safeRelative(path));
});

test('UX-8 preview operator: refuses output reuse, symlinks and changed image/source bytes',async()=>{
  const tool=await import(new URL('../../modules/absurd-daily/tools/native-previews.mjs',import.meta.url).href);
  const {mkdtemp,mkdir,writeFile,symlink,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'native-preview-validator-'));
  try{
    const root=join(dir,'source'),out=join(dir,'evidence');await mkdir(root);await tool.freshOutput(root,out);
    await assert.rejects(tool.freshOutput(root,out));await assert.rejects(tool.freshOutput(root,join(root,'nested')));
    await writeFile(join(root,'source.js'),'source');await symlink(join(root,'source.js'),join(root,'link.js'));await assert.rejects(tool.regularFile(root,'link.js'));
    const png=await sharp({create:{width:640,height:480,channels:3,background:'#888'}}).png().toBuffer(),webp=await sharp(png).resize(512,384).webp().toBuffer();
    await mkdir(join(out,'portal'));await mkdir(join(out,'portal/assets'));await writeFile(join(out,'portal/assets/dish.js'),'chunk');
    const source_inputs=[{path:'source.js',sha256:tool.digest(Buffer.from('source'))}],expected={recipes:RECIPES.map(r=>r.id),source_inputs};
    const receipt={status:'captured',errors:[],environment:{browser:'validator-fixture',renderer:'not-native',dpr:1},source_inputs,
      build:{factory:'assets/dish.js',inputs:source_inputs,chunks:[{file:'assets/dish.js',sha256:tool.digest(Buffer.from('chunk')),imports:[],modules:['apps/portal-web/src/games/cooking/dish-stage.ts']}]},
      total_bytes:66*webp.length,previews:RECIPES.map(r=>({recipe:r.id,path:`apps/portal-web/public/games/absurd-daily/cooking/3d/${r.id}.webp`,width:512,height:384,bytes:webp.length,sha256:tool.digest(webp),source_png_sha256:tool.digest(png),native:{calls:1,geometries:1,triangles:1,textures:1},canvas_after_dispose:0}))};
    for(const r of RECIPES){await writeFile(join(out,r.id+'.png'),png);await writeFile(join(out,r.id+'.webp'),webp);}
    await tool.validateFiles(root,out,receipt,expected,sharp);
    await writeFile(join(out,RECIPES[0].id+'.webp'),'corrupt');await assert.rejects(tool.validateFiles(root,out,receipt,expected,sharp));
    await writeFile(join(out,RECIPES[0].id+'.webp'),webp);
    const wrong=await sharp(png).resize(511,384).webp().toBuffer();const bad=structuredClone(receipt);bad.previews[0].sha256=tool.digest(wrong);bad.previews[0].bytes=wrong.length;bad.total_bytes+=wrong.length-webp.length;
    await writeFile(join(out,RECIPES[0].id+'.webp'),wrong);await assert.rejects(tool.validateFiles(root,out,bad,expected,sharp),/output_bytes_or_dimensions/);
    await writeFile(join(out,RECIPES[0].id+'.webp'),webp);await writeFile(join(out,'portal/assets/dish.js'),'wrong');await assert.rejects(tool.validateFiles(root,out,receipt,expected,sharp),/compiled_drift/);await writeFile(join(out,'portal/assets/dish.js'),'chunk');
    await writeFile(join(root,'source.js'),'changed');await assert.rejects(tool.validateFiles(root,out,receipt,expected,sharp),/source_drift/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

// Controlled Image/canvas/FileReader callbacks test ownership and ordering only.
// This does NOT establish native PNG/JPEG pixels, browser performance or GPU readiness.
test('AD-7 phased export ownership and encoding contract (non-native)',async t=>{
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/result-card.ts',import.meta.url),'utf8'),{loader:'ts',target:'es2023',format:'esm'}).code.replace(/^import .*;\n/gm,'').replace(/^export \{[\s\S]*?\};?\n?/gm,'');
  const harness=String.raw`// NON-NATIVE: controlled Image/canvas/FileReader doubles, not PNG/rendering evidence.
let encodes=[], readers=[], canvases=[];
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
class FakeImage {width=960;height=720;set src(value){this.value=value;if(value)queueMicrotask(()=>this.onload?.());}}
class FakeReader {readAsDataURL(blob){this.blob=blob;readers.push(this);} abort(){this.aborted=true;this.onabort?.();}}
globalThis.Image=FakeImage;globalThis.FileReader=FakeReader;
globalThis.document={createElement(tag){assert.equal(tag,'canvas');const c={width:0,height:0,getContext(){return new Proxy({measureText:()=>({width:1})},{get:(o,k)=>o[k]??(()=>{})});},toBlob(cb,type,quality){encodes.push({canvas:c,cb,type,quality});}};canvases.push(c);return c;}};
const input={game:'kitchen',seed:42,title:'飯糰',caption:'95分',details:'原始結果',image:'data:image/jpeg;base64,a'};
function reset(){encodes=[];readers=[];canvases=[];}
async function png(signal){const p=resultExports(input,null,signal);await tick();assert.equal(encodes.length,1);const job=encodes.shift();assert.deepEqual([job.canvas.width,job.canvas.height,job.type,job.quality],[960,1200,'image/png',undefined]);const bytes=new Blob(['exact-png'],{type:'image/png'});job.cb(bytes);const value=await p;assert.equal(value.png,bytes);assert.equal(await value.file.text(),'exact-png');assert.equal(value.file.name,'離譜日常-kitchen-42.png');assert.equal(value.file.type,'image/png');assert.equal(encodes.length,0);assert.equal('site' in value,false);return value;}
function completeEncode(type='image/jpeg'){const j=encodes.shift();j.cb(new Blob(['jpeg'],{type}));return j;}
function completeReader(value='data:image/jpeg;base64,am9i'){const r=readers.shift();r.result=value;r.onload();return r;}
let passed=0;async function check(name,fn){await runCheck(name,async()=>{reset();await fn();passed++;});}
await check('PNG resolves independently; exact File payload; JPEG dimensions/quality',async()=>{const v=await png();const p=v.prepareJpegs();let j=completeEncode();assert.deepEqual([j.canvas.width,j.canvas.height,j.quality],[1200,675,.87]);await tick();completeReader();await tick();j=completeEncode();assert.deepEqual([j.canvas.width,j.canvas.height,j.quality],[960,1200,.85]);await tick();completeReader();assert.deepEqual(await p,{site:'data:image/jpeg;base64,am9i',preview:'data:image/jpeg;base64,am9i'});});
await check('pre-aborted owner never creates image/canvas',async()=>{const a=new AbortController();a.abort();await assert.rejects(resultExports(input,null,a.signal),{name:'AbortError'});assert.equal(canvases.length,0);});
await check('abort pending image decode suppresses work',async()=>{const a=new AbortController();const p=resultExports(input,null,a.signal);a.abort();await assert.rejects(p,{name:'AbortError'});await tick();assert.equal(encodes.length,0);});
await check('abort pending PNG ignores late native callback',async()=>{const a=new AbortController();const p=resultExports(input,null,a.signal);await tick();const j=encodes.shift();a.abort();await assert.rejects(p,{name:'AbortError'});j.cb(new Blob(['late'],{type:'image/png'}));assert.equal(readers.length,0);});
await check('JPEG MIME mismatch rejects without invalidating PNG; retry possible',async()=>{const v=await png();const p=v.prepareJpegs();completeEncode('image/png');await assert.rejects(p);assert.equal(await v.file.text(),'exact-png');const a=new AbortController();const retry=v.prepareJpegs(a.signal);assert.equal(encodes.length,1);a.abort();await assert.rejects(retry,{name:'AbortError'});});
await check('JPEG reader abort cancels reader; no subsequent encoding',async()=>{const v=await png();const a=new AbortController();const p=v.prepareJpegs(a.signal);completeEncode();await tick();const reader=readers[0];a.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(reader.aborted,true);assert.equal(reader.onload,null);assert.equal(encodes.length,0);});
await check('original owner abort also invalidates phase2',async()=>{const a=new AbortController();const v=await png(a.signal);a.abort();await assert.rejects(v.prepareJpegs(),{name:'AbortError'});assert.equal(encodes.length,0);});
await check('null PNG rejects original error path',async()=>{const p=resultExports(input);await tick();encodes.shift().cb(null);await assert.rejects(p,/圖片未能產生/);});
await check('invalid JPEG data URL rejects; keeps PNG',async()=>{const v=await png();const p=v.prepareJpegs();completeEncode();await tick();completeReader('data:image/png;base64,bad');await assert.rejects(p,/成果預覽未能產生/);assert.equal(v.png.type,'image/png');});
await check('original image decode rejection preserved',async()=>{const Image=globalThis.Image;globalThis.Image=class {set src(v){if(v)queueMicrotask(()=>this.onerror?.());}};try{await assert.rejects(resultExports(input),/成果照片未能讀取/);assert.equal(encodes.length,0);}finally{globalThis.Image=Image;}});
await check('FileReader native error propagates and preserves PNG',async()=>{const v=await png();const p=v.prepareJpegs();completeEncode();await tick();const r=readers.shift();r.error=new Error('read failed');r.onerror();await assert.rejects(p,/read failed/);assert.equal(v.png.type,'image/png');});
await check('canvas synchronous encode failure rejects',async()=>{const create=document.createElement;document.createElement=(tag)=>{const c=create(tag);c.toBlob=()=>{throw new Error('encode failed');};return c;};try{await assert.rejects(resultExports(input),/encode failed/);}finally{document.createElement=create;}});
assert.equal(passed,12);
`;
  // Declare subtests in this real source file so strict reporter provenance remains bound.
  const runCheck=(name:string,fn:()=>Promise<void>)=>t.test(name,fn);
  await runInNewContext(`${source}\n(async()=>{${harness}})()`,{assert,runCheck,partyOf,Blob,File,DOMException,AbortController,queueMicrotask});
});

test('UX-15d optional dish scheduling waits for primary settlement, bounds only its own wait, and cleans stale owners',()=>{
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/deferred-preview.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
  const timers=new Map<number,{fn:()=>void;ms:number}>(),frames=new Map<number,()=>void>();let id=0,starts=0;
  const context={exports:{},module:{exports:{} as {deferOptionalPreview:(start:()=>void)=>{release:()=>void;dispose:()=>void}}},window:{setTimeout(fn:()=>void,ms:number){timers.set(++id,{fn,ms});return id;},clearTimeout(key:number){timers.delete(key);}},requestAnimationFrame(fn:()=>void){frames.set(++id,fn);return id;},cancelAnimationFrame(key:number){frames.delete(key);}};
  runInNewContext(source,context);const create=()=>context.module.exports.deferOptionalPreview(()=>starts++);
  const flushFrame=()=>{const jobs=[...frames.values()];frames.clear();jobs.forEach(fn=>fn());};
  const flushTask=()=>{const jobs=[...timers.entries()].filter(([,job])=>job.ms===0);jobs.forEach(([key,job])=>{timers.delete(key);job.fn();});};
  for(const settlement of ['PNG success','PNG error']){const owner=create();assert.equal(timers.size,1,settlement);assert.equal(frames.size,0);const before=starts;owner.release();assert.equal(starts,before);assert.equal(timers.size,0);flushFrame();assert.equal(starts,before);flushTask();assert.equal(starts,before+1);owner.release();flushFrame();flushTask();assert.equal(starts,before+1);owner.dispose();}
  const held=create(),deadline=[...timers.values()][0];assert.equal(deadline.ms,15000);deadline.fn();flushFrame();flushTask();const started=starts;held.release();flushFrame();flushTask();assert.equal(starts,started,'late PNG does not rebuild the stage or change PNG state');held.dispose();
  const stale=create(),staleDeadline=[...timers.values()][0];stale.dispose();staleDeadline.fn();stale.release();assert.equal(frames.size,0);assert.equal(timers.size,0);
  const beforeFrame=create();beforeFrame.release();const staleFrame=[...frames.values()][0];beforeFrame.dispose();staleFrame();assert.equal(timers.size,0);assert.equal(frames.size,0);
  const beforeTask=create();beforeTask.release();flushFrame();const staleTask=[...timers.values()][0];beforeTask.dispose();staleTask.fn();assert.equal(starts,started);assert.equal(timers.size,0);
  const replacement=create();replacement.release();flushFrame();flushTask();assert.equal(starts,started+1);replacement.dispose();
});

test('AD-6 arcade DOM, stylesheet and skip-link namespaces avoid generic advertising selectors',()=>{
  const sources=['AbsurdDaily.tsx','arcade.css','toy-theme.css'].map(name=>readFileSync(new URL(`../../apps/portal-web/src/games/${name}`,import.meta.url),'utf8'));
  for(const source of sources){
    assert.doesNotMatch(source,/(?<![\w-])ad-[a-z]/,'game presentation must not reuse the generic ad- namespace');
    assert.match(source,/fw-arcade-root/);
  }
  assert.match(sources[0],/href="#fw-arcade-main"/);
  assert.match(sources[0],/id="fw-arcade-main"/);
  for(const name of ['header','footer','button','notice','result']){
    assert.match(sources[0],new RegExp(`fw-arcade-${name}`));
    assert.match(sources[1]+sources[2],new RegExp(`\\.fw-arcade-${name}`));
  }
});

test('anonymous crawlers get game metadata from the real Worker SPA fallback',async()=>{
  const shell=readFileSync(new URL('../../apps/portal-web/index.html',import.meta.url),'utf8');
  const seen:string[]=[];
  const assets={seen,async fetch(request:Request){
    const path=new URL(request.url).pathname;seen.push(path);
    if(path==='/')return new Response(shell,{headers:{'Content-Type':'text/html; charset=utf-8','ETag':'"generic-shell"','Content-Length':String(Buffer.byteLength(shell))}});
    if(/^\/games\/absurd-daily\/(photo|stamp|cash)\.jpg$/.test(path))return new Response(readFileSync(new URL('../../apps/portal-web/public'+path,import.meta.url)),{headers:{'Content-Type':'image/jpeg'}});
    return new Response('not found',{status:404});
  }};
  const app=createApp({} as Pool,'http://127.0.0.1:8787');
  mountAssets(app,assets);
  for(const [game,title,ua] of [['photo','這張能交嗎？','facebookexternalhit/1.1'],['stamp','蓋完就下班','Slackbot-LinkExpanding 1.0'],['cash','這疊有一百萬？','Twitterbot']] as const){
    const response=await app.request(`http://127.0.0.1:8787/play?game=${game}&seed=123`,{headers:{'User-Agent':ua}});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/^text\/html/);
    assert.equal(response.headers.get('etag'),null);assert.equal(response.headers.get('content-length'),null);
    const html=await response.text();
    assert.ok(html.includes(`<meta property="og:title" content="${title}｜離譜日常・自由工坊">`));
    assert.ok(html.includes(`<meta property="og:url" content="http://127.0.0.1:8787/play?game=${game}&amp;seed=123">`));
    assert.ok(html.includes(`<meta property="og:image" content="http://127.0.0.1:8787/games/absurd-daily/${game}.jpg">`));
    assert.equal((html.match(/property="og:image"/g)??[]).length,1);assert.ok(html.includes('<div id="root"></div>'));
    const image=await app.request(`http://127.0.0.1:8787/games/absurd-daily/${game}.jpg`,{headers:{'User-Agent':ua}});
    assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.ok((await image.arrayBuffer()).byteLength>1000);
  }
  assert.ok(seen.includes('/play')&&seen.includes('/'),'SPA fallback must actually request the shell');
  const fallback=await app.request('http://127.0.0.1:8787/play?game=unknown');
  assert.equal(await fallback.text(),shell);
  const forbidden=await app.request('http://untrusted.example/play?game=photo&seed=123');
  assert.equal(forbidden.status,403);
  const missingApp=createApp({} as Pool,'http://127.0.0.1:8787');
  mountAssets(missingApp,{fetch:async()=>new Response('not found',{status:404})});
  const missing=await missingApp.request('http://127.0.0.1:8787/play?game=photo&seed=123');
  assert.equal(missing.status,404);assert.ok(!(await missing.text()).includes('og:image'));
});

// Optional coating gesture stays outside the saved/scored MarketRun contract.
function coatingHarness(){
 let now=0,target:string|null='portion-0',serial=0,progress=0;const frames=new Map<number,()=>void>(),completed:string[]=[];
 const hold=createCoatingHold({now:()=>now,target:()=>target,schedule:tick=>{frames.set(++serial,tick);return serial;},unschedule:id=>{frames.delete(id);},progress:value=>{progress=value;},complete:value=>{completed.push(value);}});
 return {hold,frames,completed,get progress(){return progress;},target(value:string|null){target=value;},advance(ms:number){now+=ms;const ticks=[...frames.values()];frames.clear();ticks.forEach(tick=>tick());}};
}
test('coating hold requires continuous ownership, cancels partial work and ignores stale callbacks',()=>{
 const h=coatingHarness();assert.equal(h.hold.begin(1),true);assert.equal(h.hold.begin(2),false);
 const stale=[...h.frames.values()][0];h.advance(450);assert.equal(h.progress,.5);h.hold.release(2);assert.equal(h.progress,.5);
 h.hold.release(1);assert.equal(h.progress,0);assert.equal(h.frames.size,0);stale();h.advance(1000);assert.deepEqual(h.completed,[]);
 h.hold.begin(3);h.advance(450);h.target('portion-1');h.advance(500);assert.deepEqual(h.completed,[]);assert.equal(h.progress,0);
 h.hold.begin(4);h.target(null);h.advance(1000);assert.deepEqual(h.completed,[]);assert.equal(h.hold.begin(5),false);
});
test('coating hold completes once, keyboard ownership cancels, and a restarted target can rearm',()=>{
 const h=coatingHarness();h.hold.begin(-1);h.advance(450);h.hold.cancel();h.advance(1000);assert.deepEqual(h.completed,[]);
 h.hold.begin(-1);h.advance(900);h.advance(900);assert.deepEqual(h.completed,['portion-0']);assert.equal(h.frames.size,0);
 assert.equal(h.hold.begin(-1),false);h.hold.release(-1);assert.equal(h.hold.begin(-1),true);h.advance(900);assert.deepEqual(h.completed,['portion-0','portion-0']);
 h.hold.cancel();h.hold.begin(1);h.advance(-1);assert.equal(h.progress,0);assert.equal(h.frames.size,0);
});

test('AD-brand uses the approved transparent wordmark with local sizing and native home links',()=>{
  const source=readFileSync(new URL('../../apps/portal-web/src/games/AbsurdDaily.tsx',import.meta.url),'utf8');
  const header=source.match(/<header className="(?:ad|fw-arcade)-header"[\s\S]*?<\/header>/);
  assert.ok(header,'the actual public game header');
  const compiled=transformSync(`export default function Header(){return ${header[0]};}`,{loader:'tsx',jsx:'automatic',format:'cjs'}).code;
  const module={exports:{} as {default?:()=>any}};
  runInNewContext(compiled,{module,exports:module.exports,require:(id:string)=>{
    assert.equal(id,'react/jsx-runtime');return jsxRuntime;
  }});
  const tree=module.exports.default!(),[brand,home]=tree.props.children,logo=brand.props.children[0];
  assert.equal(brand.type,'a');assert.equal(brand.props.href,'/');assert.equal(brand.props.onClick,undefined);
  assert.equal(home.type,'a');assert.equal(home.props.href,'/');assert.equal(home.props.onClick,undefined);
  assert.equal(logo.type,'img');assert.equal(logo.props.src,'/brand/freedom-workshop-compact-transparent.png');
  assert.equal(logo.props.alt,'自由工坊');assert.equal(logo.props.width,'396');assert.equal(logo.props.height,'132');
  assert.equal(tree.props.style?.flexWrap,'wrap');
  assert.equal(logo.props.style?.width,132);assert.equal(logo.props.style?.height,44);
  assert.equal(logo.props.style?.maxWidth,'none');assert.equal(logo.props.style?.flexShrink,0);
});

test('AD-brand reuses the exact PR 1201 PNG with a complete transparent 3:1 image',async()=>{
  const bytes=readFileSync(new URL('../../apps/portal-web/public/brand/freedom-workshop-compact-transparent.png',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'f33136a09613c25752b1a24ad8aa9ef76dde93f31425bb6c5e201fe6d51aa10e');
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,396);assert.equal(info.height,132);assert.equal(info.channels,4);
  for(const [x,y] of [[0,0],[395,0],[0,131],[395,131]])assert.equal(data[(y*396+x)*4+3],0);
  assert.ok(data.some((value,index)=>index%4===3&&value===255),'the wordmark retains opaque image content');
});

for(const [first,second] of [[' ','Enter'],['Enter',' ']])test(`coating keyboard ${JSON.stringify(first)} retains ownership when ${JSON.stringify(second)} releases`,()=>{
 const h=coatingHarness(),owner=coatingKeyOwner(first)!,other=coatingKeyOwner(second)!;
 assert.notEqual(owner,other);assert.equal(coatingKeyOwner('Escape'),null);assert.equal(h.hold.begin(owner),true);h.advance(450);
 assert.equal(h.hold.begin(other),false);h.hold.release(other);assert.equal(h.progress,.5);h.advance(450);assert.deepEqual(h.completed,['portion-0']);
 h.hold.release(other);h.advance(1000);assert.equal(h.completed.length,1);h.hold.release(owner);assert.equal(h.progress,0);
});

// Community-game intake is a local draft handoff, not an upload or publication.
test('community game submission pins repository source and keeps user text inert',()=>{
 const draft={...blankGameSubmission(),title:'合成測試遊戲',description:'<script>alert(1)</script>\n[link](javascript:alert(1))\n```\n@someone',controls:'方向鍵移動；手機拖曳',license:'測試作者；MIT；素材自行繪製',repository:'https://github.com/example/game/',revision:'A'.repeat(40)};
 const brief=prepareGameSubmission(draft),url=new URL(brief.url);
 assert.equal(url.origin,'https://github.com');assert.equal(url.pathname,'/FreeTWAI/freedom-platform/issues/new');
 assert.deepEqual([...url.searchParams.keys()],['title','body']);assert.equal(url.searchParams.get('body'),brief.body);
 assert.ok(brief.body.includes('https://github.com/example/game/tree/'+ 'a'.repeat(40)));
 for(const line of draft.description.split('\n'))assert.ok(brief.body.includes('    '+line));
 assert.ok(brief.body.includes('尚未審核'));assert.ok(brief.url.length<=8000);assert.equal(draft.revision,'A'.repeat(40));
});
test('community game submission rejects unsafe or moving repository sources',()=>{
 const valid={...blankGameSubmission(),title:'Game',description:'Play',controls:'Keys',license:'MIT',repository:'https://github.com/example/game',revision:'a'.repeat(40)};
 for(const repository of ['http://github.com/example/game','https://evil.test/example/game','https://github.com.evil.test/example/game','https://user:secret@github.com/example/game','https://github.com/example/game?token=secret','https://github.com/example/game#secret','https://github.com/example/game/tree/main','https://github.com/example/..','javascript:alert(1)'])assert.throws(()=>prepareGameSubmission({...valid,repository}));
 for(const revision of ['main','a'.repeat(39),'g'.repeat(40)])assert.throws(()=>prepareGameSubmission({...valid,revision}));
 for(const title of ['   ','a'.repeat(61),'x\ny','x\u0000y','x\u202ey'])assert.throws(()=>prepareGameSubmission({...valid,title}));
});
test('community game attachment mode drops inactive source and does not claim upload',()=>{
 const draft={...blankGameSubmission(),source:'attachment' as const,title:'Game',description:'Play',controls:'Keys',license:'MIT',repository:'https://private.test/?secret=DO-NOT-SEND',revision:'SECRET'};
 const brief=prepareGameSubmission(draft);
 assert.ok(!brief.body.includes('DO-NOT-SEND'));assert.ok(!brief.body.includes('SECRET'));assert.ok(brief.body.includes('尚未附檔'));
 assert.ok(!brief.url.includes('private.test'));assert.equal(blankGameSubmission().title,'');
});
test('community game submission bounds fields and encoded URL without truncation',()=>{
 const draft={...blankGameSubmission(),source:'attachment' as const,title:'Game',description:'Play',controls:'Keys',license:'MIT'};
 for(const key of ['title','description','controls','license'] as const)assert.throws(()=>prepareGameSubmission({...draft,[key]:'x'.repeat(GAME_SUBMISSION_LIMITS[key]+1)}));
 assert.throws(()=>prepareGameSubmission({...draft,source:'unknown' as any}));
 // CJK UTF-8 expansion can exceed the URL budget despite field bounds.
 const largest={...draft,title:'遊'.repeat(60),description:'戲'.repeat(200),controls:'動'.repeat(200),license:'權'.repeat(160)};
 try{const brief=prepareGameSubmission(largest);assert.ok(brief.url.length<=8000);assert.ok(brief.body.includes(largest.description));}catch(error){assert.match(String(error),/連結過長/);}
});


// Native source-input foundation. These tests never store or execute HTML.
const gameSourceStream=(bytes:Uint8Array)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(bytes);c.close();}});
const gameSourceError=(code:string)=>(error:unknown)=>error instanceof GameUploadSourceError&&error.code===code&&error.message===code;
test('native game source keeps exact digest and private immutable snapshot without executing HTML',async()=>{
 const text='\ufeff<!doctype html>\r\n<script>globalThis.__gameSourceExecuted=true</script>',bytes=new TextEncoder().encode(text);
 const expected=createHash('sha256').update(bytes).digest('hex');
 const result=await validateGameUploadSource({body:gameSourceStream(bytes),contentType:'text/html'});
 bytes.fill(0);const first=result.copyBytes();assert.equal(new TextDecoder('utf-8',{ignoreBOM:true}).decode(first),text);
 first.fill(1);assert.equal(createHash('sha256').update(result.copyBytes()).digest('hex'),expected);
 assert.equal(result.sha256,expected);assert.equal(result.byteSize,new TextEncoder().encode(text).length);
 assert.equal(result.trust,'unreviewed');assert.equal(result.storageState,'not_stored');assert.equal(result.fileName,'index.html');
 assert.equal(Object.isFrozen(result),true);assert.equal(Reflect.set(result,'sha256','forged'),false);
 assert.equal(Object.hasOwn(globalThis,'__gameSourceExecuted'),false);
 assert.deepEqual(Object.keys(result).sort(),['format','trust','storageState','fileName','contentType','byteSize','sha256','copyBytes'].sort());
 assert.equal(Object.hasOwn(result,'metadata'),false);assert.equal(Object.hasOwn(result,'bytes'),false);
});
test('native game source rejects authority fields, accessors and unsupported MIME before pulling',async()=>{
 for(const patch of [{contentType:'application/zip'},{contentType:'text/plain'},{contentType:'text/html; charset=utf-8'},{owner_ref:'forged'},{objectKey:'private/key'},{policy:{platformPersistenceAllowed:true}},{status:'published'},{sourceSha256:'a'.repeat(64)}]){
  let pulls=0;const body=new ReadableStream<Uint8Array>({pull(){pulls++;throw Error('must not pull');}},{highWaterMark:0});
  await assert.rejects(validateGameUploadSource({body,contentType:'text/html',...patch}),gameSourceError('contentType' in patch?'unsupported_game_source_type':'invalid_game_source_request'));
  assert.equal(pulls,0);assert.equal(body.locked,false);
 }
 let accessed=false;const accessor={body:gameSourceStream(new TextEncoder().encode('source')),get contentType(){accessed=true;return 'text/html';}};
 await assert.rejects(validateGameUploadSource(accessor),gameSourceError('invalid_game_source_request'));assert.equal(accessed,false);
 for(const request of [null,[],{}, {body:new Uint8Array(2),contentType:'text/html'}])await assert.rejects(validateGameUploadSource(request),gameSourceError('invalid_game_source_request'));
});
test('native game source enforces actual bytes and releases overflow reader',async()=>{
 const exact=new Uint8Array(GAME_UPLOAD_SOURCE_MAX_BYTES).fill(65),accepted=await validateGameUploadSource({body:gameSourceStream(exact),contentType:'text/html'});
 assert.equal(accepted.byteSize,GAME_UPLOAD_SOURCE_MAX_BYTES);
 let cancelled=0;const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(exact);c.enqueue(new Uint8Array([65]));},cancel(){cancelled++;}});
 await assert.rejects(validateGameUploadSource({body,contentType:'text/html'}),gameSourceError('game_source_too_large'));
 assert.equal(cancelled,1);assert.equal(body.locked,false);
 const unicode=new TextEncoder().encode('遊'.repeat(Math.floor(GAME_UPLOAD_SOURCE_MAX_BYTES/3)+1));
 await assert.rejects(validateGameUploadSource({body:gameSourceStream(unicode),contentType:'text/html'}),gameSourceError('game_source_too_large'));
});
test('native game source rejects empty, invalid UTF8 and binary control bytes with fixed errors',async()=>{
 for(const bytes of [new Uint8Array(),new Uint8Array([0xc3,0x28]),new Uint8Array([65,0,66]),new Uint8Array([65,127]),new TextEncoder().encode(' \r\n\t')]){
  const body=gameSourceStream(bytes);await assert.rejects(validateGameUploadSource({body,contentType:'text/html'}),gameSourceError('invalid_game_source'));assert.equal(body.locked,false);
 }
});
test('native game source splits UTF8 safely and does not leak upstream errors or another readers lock',async()=>{
 const raw=new TextEncoder().encode('<html>遊戲</html>');let index=0;
 const body=new ReadableStream<Uint8Array>({pull(c){if(index<raw.length)c.enqueue(raw.slice(index,index+1));else c.close();index++;}});
 const result=await validateGameUploadSource({body,contentType:'text/html'});assert.deepEqual(result.copyBytes(),raw);assert.equal(body.locked,false);
 const bad=new ReadableStream<Uint8Array>({pull(){throw Error('SECRET UPSTREAM DATA');}},{highWaterMark:0});
 await assert.rejects(validateGameUploadSource({body:bad,contentType:'text/html'}),gameSourceError('invalid_game_source'));assert.equal(bad.locked,false);
 const locked=gameSourceStream(raw),reader=locked.getReader();
 try{await assert.rejects(validateGameUploadSource({body:locked,contentType:'text/html'}),gameSourceError('invalid_game_source'));assert.equal(locked.locked,true);}finally{reader.releaseLock();}
});

// MEMBER-GAME-UPLOAD: isolated browser workflow state, no database or source execution.
import {MemberGameUpload,memberGame,memberGameFileError,exactGameAck,memberGameLeaveRisk,type GameCommand,type CurrentMemberGame} from '../../apps/portal-web/src/games/member-game-upload.js';
const memberGameId='10000000-0000-4000-8000-000000000001';
const gameMetadata=():CurrentMemberGame=>({game_id:memberGameId,title:'合成測試',description:'測試介紹',version:'1',state:'draft',source_revision:'0',trust:'unreviewed',visibility:'private',upload_available:true});
const receipt=(current:CurrentMemberGame)=>{const {upload_available,...ack}=current;return ack;};
function uploadFixture(){
 let current=gameMetadata(),live=true,reads=0,send:(command:GameCommand)=>Promise<unknown>=async command=>{
  if(command.kind==='create')return receipt({...current,title:command.body.title,description:command.body.description});
  current={...current,version:String(BigInt(command.before.version)+1n),source_revision:command.kind==='upload'?String(BigInt(command.before.source_revision)+1n):command.before.source_revision,state:command.kind==='upload'?'quarantined':'withdrawn',upload_available:command.kind==='upload'};return receipt(current);
 };
 const commands:GameCommand[]=[];
 const controller=new MemberGameUpload({current:()=>live,refused:error=>error==='pre-admission-refused',read:async()=>{reads++;return current;},send:async command=>{commands.push(command);return send(command);}});
 return {controller,commands,reads:()=>reads,current:()=>current,setCurrent:(value:CurrentMemberGame)=>{current=value;},setSend:(fn:typeof send)=>{send=fn;},end:()=>{live=false;}};
}
const sourceFile=(bytes:Uint8Array|string='<!doctype html>\r\n<script>throw Error("must never execute")</script>')=>new File([bytes as BlobPart],'index.html',{type:'text/html'});
test('member game upload: metadata decoder fails closed on source, policy, stale identity and inconsistent states',()=>{
 assert.equal(memberGame(gameMetadata(),true).game_id,memberGameId);
 for(const patch of [{object_key:'private'},{sha256:'a'.repeat(64)},{source:'secret'},{upload_available:'true'},{version:'01'},{version:'1\n'},{source_revision:'0\n'},{game_id:memberGameId+'\n'},{source_revision:'1'},{state:'approved'},{state:['draft']},{state:['quarantined']},{state:{}},{state:null},{trust:'safe'},{state:'withdrawn',upload_available:true},{game_id:'../../other'}])assert.throws(()=>memberGame({...gameMetadata(),...patch},true));
 const before=receipt(gameMetadata()),command:GameCommand={kind:'upload',key:'test',before,source:new Blob(['<html>'],{type:'text/html'})};
 const ack={...before,version:'2',source_revision:'1',state:'quarantined'};
 assert.equal(exactGameAck(ack,command).version,'2');for(const patch of [{version:'3'},{source_revision:'2'},{game_id:'20000000-0000-4000-8000-000000000001'},{title:'other'},{state:'published'},{upload_available:true}])assert.throws(()=>exactGameAck({...ack,...patch},command));
});
test('member game upload: explicit file selection is local, bounded, fatal UTF-8 and byte-exact including BOM',async()=>{
 const f=uploadFixture();await f.controller.load(memberGameId);
 assert.equal(memberGameFileError(new File([new Uint8Array(256*1024)],'a.html',{type:'text/html'})),null);
 for(const file of [new File(['x'],'a.zip'),new File(['x'],'a.html',{type:'image/png'}),new File([],'a.html'),new File([new Uint8Array(256*1024+1)],'a.html')])assert.ok(memberGameFileError(file));
 for(const bytes of [new Uint8Array([255]),new Uint8Array([0]),new TextEncoder().encode('  \n')]){await f.controller.selectFile(sourceFile(bytes));assert.equal(f.controller.getSnapshot().selected,null);}
 const bytes=new Uint8Array([239,187,191,...new TextEncoder().encode('<html>\r\n台灣<script>globalThis.executed=true</script>')]);
 await f.controller.selectFile(sourceFile(bytes));assert.equal(f.commands.length,0);assert.equal(f.reads(),1);assert.equal(f.controller.getSnapshot().selected?.byteSize,bytes.length);
 await f.controller.change('upload');const uploaded=f.commands[0];if(uploaded.kind!=='upload')throw Error('expected upload');assert.deepEqual(new Uint8Array(await uploaded.source!.arrayBuffer()),bytes);assert.equal(uploaded.source!.type,'text/html');assert.equal(f.controller.getSnapshot().selected,null);assert.equal(f.controller.getSnapshot().draft?.state,'quarantined');assert.equal((globalThis as any).executed,undefined);
});
test('member game upload: policy OFF and concurrent version changes send no source; withdraw remains available',async()=>{
 const f=uploadFixture();await f.controller.load(memberGameId);await f.controller.selectFile(sourceFile());f.setCurrent({...f.current(),upload_available:false});await f.controller.change('upload');assert.equal(f.commands.length,0);assert.equal(f.controller.getSnapshot().selected,null);assert.equal(f.controller.getSnapshot().draft?.upload_available,false);
 await f.controller.change('withdraw');assert.equal(f.commands[0].kind,'withdraw');assert.equal(f.controller.getSnapshot().draft?.state,'withdrawn');
 const changed=uploadFixture();await changed.controller.load(memberGameId);await changed.controller.selectFile(sourceFile());changed.setCurrent({...changed.current(),version:'2',source_revision:'1',state:'quarantined'});await changed.controller.change('upload');assert.equal(changed.commands.length,0);assert.equal(changed.controller.getSnapshot().selected,null);
});
test('member game upload: unknown retry freezes original bytes/key/version; no overwrite or fresh command; retry cold read is not an ACK',async()=>{
 const f=uploadFixture();await f.controller.load(memberGameId);await f.controller.selectFile(sourceFile());f.setSend(async()=>{throw Error('lost ACK');});await f.controller.change('upload');
 const original=f.commands[0];assert.equal(f.controller.getSnapshot().phase,'unknown');assert.equal(f.controller.getSnapshot().draft,null);
 await f.controller.create('other','');await f.controller.load(memberGameId);await f.controller.selectFile(sourceFile('different'));await f.controller.change('withdraw');assert.equal(f.commands.length,1);
 f.setSend(async()=>{throw 'pre-admission-refused';});await f.controller.retry();assert.equal(f.controller.getSnapshot().phase,'unknown');assert.equal(f.commands[1],original);
 f.setCurrent({...f.current(),version:'3',source_revision:'1',state:'withdrawn',upload_available:false});
 f.setSend(async()=>({...receipt(gameMetadata()),version:'2',source_revision:'1',state:'quarantined'}));await f.controller.retry();assert.equal(f.commands[2],original);assert.equal(f.controller.getSnapshot().draft?.state,'withdrawn');assert.equal(f.controller.getSnapshot().draft?.version,'3');
 f.setCurrent(gameMetadata());await f.controller.load(memberGameId);assert.equal(f.controller.getSnapshot().draft,null,'older cold read cannot replace a newer current view');
});
test('member game upload: duplicate clicks and late create/upload ACK cannot affect ended or new owners',async()=>{
 for(const kind of ['create','upload'] as const){
  const f=uploadFixture();if(kind==='upload'){await f.controller.load(memberGameId);await f.controller.selectFile(sourceFile());}
  let finish!:(value:unknown)=>void;f.setSend(()=>new Promise(resolve=>{finish=resolve;}));
  const run=kind==='create'?f.controller.create('合成測試','測試介紹'):f.controller.change('upload');
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  if(kind==='create')await f.controller.create('duplicate','');else await f.controller.change('upload');
  assert.equal(f.commands.length,1);f.end();f.controller.dispose();finish(kind==='create'?receipt(gameMetadata()):{...receipt(gameMetadata()),version:'2',source_revision:'1',state:'quarantined'});await run;
  assert.equal(f.controller.getSnapshot().phase,'closed');assert.equal(f.controller.getSnapshot().draft,null);assert.equal(f.controller.getSnapshot().selected,null);assert.equal(f.controller.getSnapshot().draftId,'');
 }
});
test('member game upload: late file read and malformed ACK stay fenced; a receipt needs independent current read',async()=>{
 const f=uploadFixture();await f.controller.load(memberGameId);let finish!:(bytes:ArrayBuffer)=>void;const file=sourceFile();Object.defineProperty(file,'arrayBuffer',{value:()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;})});
 const selecting=f.controller.selectFile(file);f.controller.dispose();finish(new TextEncoder().encode('<html>').buffer);await selecting;assert.equal(f.controller.getSnapshot().selected,null);
 const malformed=uploadFixture();malformed.setSend(async()=>({...receipt(gameMetadata()),source:'must not be shown'}));await malformed.controller.create('合成測試','測試介紹');assert.equal(malformed.controller.getSnapshot().phase,'unknown');assert.equal(malformed.controller.getSnapshot().draft,null);
 const stale=uploadFixture();await stale.controller.load(memberGameId);await stale.controller.selectFile(sourceFile());stale.setSend(async()=>({...receipt(gameMetadata()),version:'2',source_revision:'1',state:'quarantined'}));await stale.controller.change('upload');assert.equal(stale.controller.getSnapshot().phase,'idle');assert.equal(stale.controller.getSnapshot().draft,null);assert.match(stale.controller.getSnapshot().status,/目前狀態讀取失敗/);
});
test('member game upload: withdrawal retry remains leave-protected during deferred access GET',async()=>{
 let reads=0,finish!:(value:unknown)=>void;
 const controller=new MemberGameUpload({current:()=>true,refused:()=>false,read:async()=>{if(++reads===3)return new Promise(resolve=>{finish=resolve;});return gameMetadata();},send:async()=>{throw Error('lost withdrawal ACK');}});
 await controller.load(memberGameId);await controller.change('withdraw');assert.equal(controller.getSnapshot().phase,'unknown');
 const retry=controller.retry();assert.equal(controller.getSnapshot().phase,'reading');assert.equal(controller.getSnapshot().selected,null);assert.equal(controller.getSnapshot().retry,'withdraw');assert.equal(memberGameLeaveRisk(controller.getSnapshot()),true);
 finish(gameMetadata());await retry;assert.equal(memberGameLeaveRisk(controller.getSnapshot()),true);controller.dispose();assert.equal(memberGameLeaveRisk(controller.getSnapshot()),false);
});
// END MEMBER-GAME-UPLOAD

// MEMBER-GAME-API: actual shared PortalClient transport, not HTTP server coverage.
import {PortalClient,ApiError} from '../../apps/portal-web/src/api.js';
test('member game API: closed exact HTML body retains CSRF/key/quoted string version and unchanged retry bytes',async t=>{
 const client=new PortalClient();client.csrfToken='synthetic-game-session';const key='20000000-0000-4000-8000-000000000001';
 const bytes=new Uint8Array([239,187,191,...new TextEncoder().encode('<html>\r\n台灣')]),source=new Blob([bytes],{type:'text/html'}),requests:RequestInit[]=[];
 t.mock.method(globalThis,'fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{assert.equal(url,`/api/v1/me/game-drafts/${memberGameId}/source`);requests.push(init!);if(requests.length===1)throw Error('lost');return Response.json({ok:true});});
 const options={idempotencyKey:key,ifMatch:'9007199254740993'};
 await assert.rejects(client.uploadGameSource(memberGameId,source,options),ApiError);await client.uploadGameSource(memberGameId,source,options);
 assert.equal(requests.length,2);assert.equal(requests[0].body,source);assert.equal(requests[1].body,source);assert.deepEqual(new Uint8Array(await (requests[0].body as Blob).arrayBuffer()),bytes);
 const headers=new Headers(requests[0].headers);assert.equal(headers.get('Content-Type'),'text/html');assert.equal(headers.get('If-Match'),'"9007199254740993"');assert.equal(headers.get('X-CSRF-Token'),'synthetic-game-session');assert.equal(headers.get('Idempotency-Key'),key);assert.equal(requests[0].credentials,'same-origin');assert.equal(requests[0].method,'POST');assert.deepEqual([...headers],[...new Headers(requests[1].headers)]);
});
test('member game API: invalid destinations, mixed bodies, oversized source and invalid versions never fetch',async t=>{
 const client=new PortalClient();client.csrfToken='synthetic';const key='20000000-0000-4000-8000-000000000001',source=new Blob(['<html>'],{type:'text/html'});
 const fetcher=t.mock.method(globalThis,'fetch',async()=>{throw Error('must not fetch');});
 for(const id of ['../other','x',memberGameId+'/withdraw',memberGameId+'\n'])await assert.rejects(client.uploadGameSource(id,source,{idempotencyKey:key,ifMatch:'1'}),ApiError);
 for(const version of ['0','01','1\n','9223372036854775807','9223372036854775808'])await assert.rejects(client.uploadGameSource(memberGameId,source,{idempotencyKey:key,ifMatch:version}),ApiError);
 for(const blob of [new Blob([],{type:'text/html'}),new Blob(['x'],{type:'text/plain'}),new Blob([new Uint8Array(262145)],{type:'text/html'})])await assert.rejects(client.uploadGameSource(memberGameId,blob,{idempotencyKey:key,ifMatch:'1'}),ApiError);
 await assert.rejects(client.post(`/me/game-drafts/${memberGameId}/source`,{wrong:true},{gameSource:source}),ApiError);
 await assert.rejects(client.post('/me/profile-cover',undefined,{gameSource:source}),ApiError);
 await assert.rejects(client.post(`/me/game-drafts/${memberGameId}/source\n`,undefined,{gameSource:source}),ApiError);
 await assert.rejects(client.uploadGameSource(memberGameId,source,{idempotencyKey:key+'\n',ifMatch:'1'}),ApiError);
 await assert.rejects(client.get(`/me/game-drafts/${memberGameId}/source`,{gameSource:source}),ApiError);
 assert.equal(fetcher.mock.callCount(),0);
});
test('member game API: stale session unauthorized result cannot invalidate a newer session',async t=>{
 const client=new PortalClient();client.csrfToken='old';let finish!:(response:Response)=>void,unauthorized=0;client.onUnauthorized=()=>{unauthorized++;};
 t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>{finish=resolve;}));
 const pending=client.uploadGameSource(memberGameId,new Blob(['<html>'],{type:'text/html'}),{idempotencyKey:'20000000-0000-4000-8000-000000000001',ifMatch:'1'});client.csrfToken='new';client.csrfToken='old';
 finish(Response.json({type:'expired',title:'Expired',status:401},{status:401}));await assert.rejects(pending,ApiError);assert.equal(unauthorized,0);assert.equal(client.csrfToken,'old');
});
// END MEMBER-GAME-API
