import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as domain from '../../apps/portal-web/src/games/domain.js';
import {holidayInput} from '../../apps/portal-web/src/games/party/light-holiday.js';
import * as feedback from '../../apps/portal-web/src/games/daily-feedback.js';

// Runs production TSX and domain with controlled hooks, clock and renderer ports.
// This is not a browser, native pointer capture, image or GPU verification.
function board(game:domain.GameId){
 const text=readFileSync(new URL('../../apps/portal-web/src/games/AbsurdDaily.tsx',import.meta.url),'utf8');
 const body=text.slice(text.indexOf('function GameBoard('),text.indexOf('\nfunction Result('));
 const instrumented=body.replace('    const l = live.current, remaining', '    expose({live,stage,pendingResult,shoot,photosDone,nextClient,start,setPaused,pointerDown,pointerMove,pointerUp,keyboard,applyCash,applyStamp,changeRenderer,stop});\n    const l = live.current, remaining');
 const code=transformSync(instrumented+'\nexports.GameBoard=GameBoard;', {loader:'tsx',format:'cjs',jsx:'automatic',target:'es2023'}).code.replaceAll('import("./stage")','controlledImport("native")').replaceAll('import("./daily-scene")','controlledImport("light")');
 const slots:any[]=[],effects:(()=>void)[]=[],nodes:any[]=[],timers=new Map<number,()=>void>(),frames=new Map<number,(now:number)=>void>(),listeners=new Map<string,()=>void>();
 let index=0,dirty=false,now=0,id=0,api:any,disposed=0,captures=0,created=0,failCapture=false,failUpdate=false;
 const loads:{mode:string;resolve:(value:any)=>void;reject:(error:Error)=>void}[]=[],results:any[]=[];
 const same=(a:any[]|undefined,b:any[]|undefined)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const effect=(fn:()=>any,deps?:any[])=>{const i=index++,old=slots[i];if(!old||!same(old.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}};
 const hooks={useRef:(value:any)=>{const i=index++;return slots[i]??(slots[i]={current:value});},useState:(value:any)=>{const i=index++;if(!slots[i])slots[i]={value:typeof value==='function'?value():value};return [slots[i].value,(next:any)=>{const v=typeof next==='function'?next(slots[i].value):next;if(!Object.is(v,slots[i].value)){slots[i].value=v;dirty=true;}}];},useEffect:effect,useLayoutEffect:effect};
 const owned=new Set<number>(),target={dataset:{},focus(){},getBoundingClientRect:()=>({left:0,top:0,width:400,height:300}),setPointerCapture:(id:number)=>owned.add(id),hasPointerCapture:(id:number)=>owned.has(id),releasePointerCapture:(id:number)=>owned.delete(id),open:false,showModal(){this.open=true;},close(){this.open=false;}};
 const jsx=(type:any,props:any)=>{if(props.ref)props.ref.current=target;const node={type,props};nodes.push(node);return node;};
 const create=()=>{created++;return {update(){if(failUpdate)throw Error('controlled update failure');},framing:()=>({visible:['head','feet'],blocked:false,lift:0}),point:()=>domain.stampTarget(42,api.live.current.stamps.index),capture(){captures++;if(failCapture)throw Error('capture unavailable');return 'controlled-image';},stats:()=>({calls:1,triangles:2,geometries:3,textures:0}),dispose(){disposed++;}};};
 const module={exports:{} as any};
 runInNewContext(code,{...domain,...feedback,...hooks,holidayInput,module,exports:module.exports,Error,GameCover:()=>null,expose:(value:any)=>{api=value;},hints:{photo:'photo',stamp:'stamp',cash:'cash'},syncDiagnostics(){},performance:{now:()=>now},matchMedia:()=>({matches:false,addEventListener:(name:string,fn:()=>void)=>listeners.set(`media:${name}`,fn),removeEventListener:(name:string)=>listeners.delete(`media:${name}`)}),document:{hidden:false,addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)},window:{setTimeout:(fn:()=>void)=>{timers.set(++id,fn);return id;},addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)},clearTimeout:(id:number)=>timers.delete(id),requestAnimationFrame:(fn:(n:number)=>void)=>{frames.set(++id,fn);return id;},cancelAnimationFrame:(id:number)=>frames.delete(id),controlledImport:(mode:string)=>new Promise((resolve,reject)=>loads.push({mode,resolve,reject})),require:(name:string)=>{assert.equal(name,'react/jsx-runtime');return {jsx,jsxs:jsx,Fragment:'fragment'};}});
 const render=()=>{index=0;dirty=false;nodes.length=0;module.exports.GameBoard({game,seed:42,onBack(){},onStart(){},onResult:(result:any)=>results.push(result)});while(effects.length)effects.shift()!();};
 const flush=async()=>{for(let i=0;i<12;i++){if(dirty)render();await Promise.resolve();}};
 const pointer=(extra:Record<string,unknown>={})=>({pointerId:1,button:0,isPrimary:true,clientX:150,clientY:150,currentTarget:target,preventDefault(){},...extra});
 render();
 return {get api(){return api;},loads,nodes,results,frames,timers,listeners,target,pointer,render,flush,advance:(ms:number)=>{now+=ms;},resolve:async()=>{loads.shift()!.resolve({createStage:create,createDailyLightStage:create});await flush();},start:async()=>{api.start();await flush();},failCapture:(value:boolean)=>{failCapture=value;},failUpdate:(value:boolean)=>{failUpdate=value;},stats:()=>({disposed,captures,created}),unmount:()=>{for(const slot of slots)slot?.cleanup?.();},button:(label:string)=>{const node=nodes.find(n=>n.type==='button'&&(n.props['aria-label']===label||n.props.children===label));assert.ok(node,`button ${label}`);return node.props;}};
}

test('daily stamp rule keeps the inclusive radius, exact cooldown, stale subject and bounds',()=>{
 const initial=domain.newStamps(42,false),p=domain.stampTarget(42,0);
 assert.equal(domain.stamp(initial,0,{x:p.x,y:p.y+.24},0).kind,'hit');
 assert.equal(domain.stamp(initial,0,{x:p.x,y:p.y+.240000001},0).kind,'miss');
 const missed=domain.stamp(initial,0,{x:1.2,y:1.2},0).state;
 assert.equal(domain.stamp(missed,0,p,219).state,missed);assert.equal(domain.stamp(missed,0,p,220).kind,'hit');
 for(const point of [{x:1.200001,y:0},{x:0,y:-1.200001},{x:NaN,y:0},{x:0,y:Infinity}])assert.equal(domain.stamp(initial,0,point,0).state,initial);
 const practice=domain.stamp(domain.newStamps(42),-1,p,0).state;
 assert.equal(practice.startedAt,null);assert.equal(practice.index,0);assert.equal(domain.stamp(practice,-1,p,220).state,practice);assert.equal(domain.stamp(practice,0,p,219).state,practice);assert.equal(domain.stamp(practice,0,p,220).kind,'hit');
});

test('daily cash exact 159/160ms boundary cannot consume a wrong or stale card',()=>{
 const initial=domain.newCash(42),deck=domain.cashDeck(42),wrong=domain.sortCash(initial,0,!deck[0].valid,0).state;
 assert.equal(wrong.index,0);assert.equal(wrong.amount,0);assert.equal(wrong.rejected,0);assert.equal(wrong.mistakes,1);
 assert.equal(domain.sortCash(wrong,0,deck[0].valid,159).state,wrong);
 const accepted=domain.sortCash(wrong,0,deck[0].valid,160).state;assert.equal(accepted.index,1);assert.equal(accepted.amount,deck[0].amount);
 assert.equal(domain.sortCash(accepted,0,deck[0].valid,320).state,accepted);
});

test('daily actual shutter rejects an expired client before the next RAF',async()=>{
 const h=board('photo');await h.resolve();await h.start();h.advance(domain.RULES.photoMs);h.api.shoot();
 assert.equal(h.stats().captures,0);assert.equal(h.api.live.current.photos.length,0);assert.equal(h.api.live.current.film,0);assert.equal(h.api.live.current.client,1);h.unmount();
});

test('daily zero-photo completion resets camera, gesture, film and clock together',async()=>{
 const h=board('photo');await h.resolve();await h.start();const l=h.api.live.current;
 l.client=2;l.pan={x:1,y:2};l.targetPan={x:-1,y:-2};l.fov=60;l.film=2;l.raised=true;h.api.pointerDown(h.pointer());
 h.api.photosDone();assert.equal(l.started,false);assert.equal(l.client,0);assert.equal(l.film,0);assert.equal(l.fov,44);assert.equal(JSON.stringify(l.pan),'{"x":0,"y":0}');assert.equal(JSON.stringify(l.targetPan),'{"x":0,"y":0}');assert.equal(l.pointer,null);assert.equal(l.raised,false);assert.equal(h.frames.size,0);assert.equal(l.clock.elapsed,0);assert.equal(l.clock.running,false);h.unmount();
});

for(const game of ['photo','stamp','cash'] as const)test(`daily actual ${game} pause/blur/Escape cancels ownership without resetting progress`,async()=>{
 const h=board(game);await h.resolve();await h.start();const l=h.api.live.current;l.cash=domain.sortCash(l.cash,0,domain.cashDeck(42)[0].valid,0).state;const cash=l.cash,stamps=l.stamps,photos=l.photos;
 for(const stop of [()=>h.api.setPaused(),()=>h.listeners.get('blur')!(),()=>h.api.keyboard({key:'Escape',target:{closest:()=>null},preventDefault(){}})]){
  h.api.pointerDown(h.pointer());h.advance(250);stop();assert.equal(l.paused,true);assert.equal(l.pointer,null);assert.equal(l.raised,false);assert.equal(h.target.hasPointerCapture(1),false);assert.equal(h.frames.size,0);assert.equal(l.cash,cash);assert.equal(l.stamps,stamps);assert.equal(l.photos,photos);const elapsed=l.clock.elapsed;h.advance(10000);await h.start();assert.equal(l.clock.elapsed,elapsed);assert.equal(l.paused,false);
 }
 h.unmount();assert.equal(h.frames.size,0);assert.equal(h.listeners.size,0);
});

test('daily actual cash pointer drag maps viewport displacement and cancellation cannot classify',async()=>{
 const h=board('cash');await h.resolve();await h.start();const l=h.api.live.current,initial=l.cash;
 h.api.pointerDown(h.pointer({isPrimary:false}));assert.equal(l.pointer,null);h.api.pointerDown(h.pointer({button:2}));assert.equal(l.pointer,null);
 h.api.pointerDown(h.pointer());const owner=l.pointer;h.api.pointerDown(h.pointer({pointerId:2}));assert.equal(l.pointer,owner);
 h.api.pointerMove(h.pointer({pointerId:2,clientX:250}));assert.equal(l.cashDrag.x,0);
 h.api.pointerMove(h.pointer({clientX:250,clientY:180}));assert.equal(l.cashDrag.x,.25);assert.equal(l.cashDrag.y,.1);
 const stage=h.nodes.find(n=>n.props['data-game-stage']);assert.ok(stage);stage.props.onPointerCancel(h.pointer());assert.equal(l.pointer,null);assert.equal(l.cashDrag.x,0);h.api.pointerUp(h.pointer({clientX:250}));assert.equal(l.cash,initial);
 h.api.pointerDown(h.pointer());h.api.pointerMove(h.pointer({clientX:10000,clientY:-10000}));assert.equal(l.cashDrag.x,.5);assert.equal(l.cashDrag.y,-.3);stage.props.onLostPointerCapture(h.pointer());assert.equal(l.cashDrag.x,0);assert.equal(l.cash,initial);h.unmount();
});

test('daily actual renderer imports ignore late owners and dispose on mode retry without losing a run',async()=>{
 const h=board('cash'),stale=h.loads[0];h.api.changeRenderer('light');await h.flush();const live=h.api.live.current;
 stale.resolve({createStage:()=>assert.fail('stale native owner constructed')});await h.flush();h.loads.shift();await h.resolve();assert.equal(h.stats().created,1);await h.start();h.api.applyCash(domain.cashDeck(42)[0].valid);const cash=live.cash;
 h.api.changeRenderer('native');await h.flush();assert.equal(h.stats().disposed,1);assert.equal(live.paused,true);h.loads.shift()!.reject(Error('import unavailable'));await h.flush();assert.equal(h.loads.length,0);h.button('用輕量畫面繼續').onClick();await h.flush();assert.equal(h.loads[0].mode,'light');await h.resolve();assert.equal(live.cash,cash);assert.equal(h.api.live.current,live);assert.equal(live.paused,true);assert.equal(h.stats().created,2);h.unmount();assert.equal(h.stats().disposed,2);
});

test('daily actual import timeout rejects late construction and explicit retry retains the run',async()=>{
 const h=board('cash'),old=h.loads.shift()!;for(const timeout of [...h.timers.values()])timeout();await h.flush();old.resolve({createStage:()=>assert.fail('timed out owner constructed')});await h.flush();assert.equal(h.stats().created,0);
 const live=h.api.live.current;h.button('重試場景').onClick();await h.flush();await h.resolve();assert.equal(h.api.live.current,live);assert.equal(h.stats().created,1);h.unmount();assert.equal(h.stats().disposed,1);
});

for(const game of ['photo','stamp','cash'] as const)test(`daily actual ${game} button holds reject other owners, cancellation and changed subjects`,async()=>{
 const h=board(game);await h.resolve();await h.start();const l=h.api.live.current;
 const label=game==='photo'?'拍照快門':game==='stamp'?'啪！蓋章':domain.cashDeck(42)[0].valid?'收道具鈔 →':'← 退票券';
 const progress=()=>game==='photo'?l.film:game==='stamp'?Number(!l.stamps.practice):l.cash.index;
 const event=(extra:any={})=>h.pointer(extra),key=(extra:any={})=>({key:' ',repeat:false,preventDefault(){},...extra});
 let b=h.button(label);
 b.onPointerDown(event({isPrimary:false}));b.onPointerUp(event());b.onClick({detail:1});assert.equal(progress(),0);
 b.onPointerDown(event());b.onPointerDown(event({pointerId:2}));b.onPointerUp(event({pointerId:2}));b.onClick({detail:1});assert.equal(progress(),0);
 b.onPointerCancel(event());b.onPointerUp(event());b.onClick({detail:1});assert.equal(progress(),0);
 b.onPointerDown(event());b.onLostPointerCapture(event());b.onPointerUp(event());b.onClick({detail:1});assert.equal(progress(),0);
 b.onKeyDown(key());b.onBlur();b.onKeyUp(key());assert.equal(progress(),0);
 b.onKeyDown(key());h.api.keyboard({key:'Escape',target:{closest:()=>({})},preventDefault(){}});b.onKeyUp(key());assert.equal(progress(),0);await h.start();b=h.button(label);
 b.onKeyDown(key());b.onKeyUp(key({ctrlKey:true}));assert.equal(progress(),0);
 b.onPointerDown(event());
 if(game==='photo')h.api.nextClient();else if(game==='stamp')h.api.applyStamp(domain.stampTarget(42,0));else h.api.applyCash(domain.cashDeck(42)[0].valid);
 const subject=game==='photo'?l.client:game==='stamp'?l.stamps.index:l.cash.index;h.advance(300);b.onPointerUp(event());b.onClick({detail:1});
 assert.equal(game==='photo'?l.client:game==='stamp'?l.stamps.index:l.cash.index,subject);if(game==='photo')assert.equal(l.film,0);
 await h.flush();b=h.button(label);const before=game==='photo'?l.photos.length:game==='stamp'?l.stamps.index:l.cash.index;
 // AT activation uses a current subject; native click must not repeat key activation.
 if(game!=='cash'){b.onKeyDown(key());b.onKeyUp(key());const after=game==='photo'?l.photos.length:l.stamps.index;assert.equal(after,before+1);b.onClick({detail:1});assert.equal(game==='photo'?l.photos.length:l.stamps.index,after);}
 h.unmount();
});

test('daily actual completed cash capture failure retries the original facts exactly once',async()=>{
 const h=board('cash');await h.resolve();await h.start();const l=h.api.live.current;
 for(const card of domain.cashDeck(42).slice(0,29)){h.api.applyCash(card.valid);h.advance(160);}
 h.failCapture(true);h.api.applyCash(true);await h.flush();const completed=l.cash,summary=h.api.pendingResult.current;
 assert.equal(completed.amount,1_000_000);assert.equal(completed.index,30);assert.equal(completed.rejected,6);assert.equal(h.results.length,0);assert.equal(l.clock.running,false);
 h.button('重試產生成果圖片').onClick();await h.flush();assert.equal(l.cash,completed);assert.equal(h.api.pendingResult.current,summary);assert.equal(h.results.length,0);
 h.failCapture(false);h.button('重試產生成果圖片').onClick();await h.flush();assert.equal(h.results.length,1);assert.match(h.results[0].details,/100 萬道具鈔 · 退回 6 張票券/);h.api.applyCash(true);assert.equal(h.results.length,1);assert.equal(l.cash,completed);h.unmount();
});

import {Group,PerspectiveCamera,Vector3,Plane,Raycaster,Vector2} from 'three';
import {dailyCamera,photoAnchors,photoFraming,paperPoint,cashDragOffset,cashCardPose,cashContains,PAPER,project,letterboxRect} from '../../apps/portal-web/src/games/daily-scene-model.js';
import type {StageView} from '../../apps/portal-web/src/games/stage.js';
function sceneView(game:domain.GameId='photo'):StageView{return {game,seed:42,seconds:0,client:0,pan:{x:0,y:0},fov:44,stampPoint:{x:0,y:0},raised:false,motion:true,stamp:domain.newStamps(42),cash:domain.newCash(42)};}
// Independent Three Object3D transforms mirror native buildPhoto anchor placement.
// No WebGLRenderer is constructed and this is not native rendering evidence.
function nativeAnchors(view:StageView){
 const pose=domain.photoPose(domain.CLIENTS[view.client].id,view.seconds,view.seed),world=new Group(),person=new Group();world.add(person);person.position.y=pose.lift;person.rotation.z=view.motion?pose.sway:0;
 const anchors:{id:string;object:Group;points:number[][]}[]=[{id:'head',object:person,points:[[-.65,3.78,0],[.65,2.65,.5]]},{id:'feet',object:person,points:[[-.5,.02,.55],[.5,.02,.55]]}];
 if(view.client===0){const board=new Group();world.add(board);board.position.set(pose.boardX,0,1.1);board.rotation.z=view.motion?Math.sin(view.seconds*4)*.025:0;anchors.push({id:'board',object:board,points:[[-.91,3.12,.2],[.91,.04,.3]]});}
 if(view.client===1)anchors.push({id:'umbrella',object:person,points:[[-.66,4.94,0],[2.28,4.1,.6]]});
 if(view.client===2)for(let i=0;i<3;i++){const bird=new Group();person.add(bird);bird.position.set([0,-.20,.21][i],[2.96,2.08,1.08][i],.5+pose.birds[i]);bird.visible=pose.birds[i]>0;bird.rotation.z=view.motion?Math.sin(view.seconds*3+i)*.12:0;anchors.push({id:`bird${i}`,object:bird,points:[[-.3,.35,.4],[.3,-.3,.4]]});}
 world.updateMatrixWorld(true);return anchors.map(a=>({id:a.id,visible:a.object.visible,points:a.points.map(p=>a.object.localToWorld(new Vector3(...p)))}));
}

test('daily photo projection matches native Three transforms for every client, pose, aspect, pan, FOV and motion mode',()=>{
 let combinations=0;
 for(const client of [0,1,2])for(const seconds of [0,2.4,3.3,5,8.9,12])for(const aspect of [390/844,9/16,1,4/3,16/9])for(const pan of [{x:0,y:0},{x:-1.8,y:-2.8},{x:1.8,y:2.8}])for(const fov of [38,44,60])for(const motion of [false,true]){
  const view={...sceneView(),client,seconds,pan,fov,motion},camera=new PerspectiveCamera(aspect<1?2*Math.atan(Math.tan(fov*Math.PI/360)/aspect)*180/Math.PI:fov,aspect,.1,60);camera.position.set(pan.x,1.95+pan.y,6);camera.lookAt(pan.x,1.95+pan.y,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const actualCamera=dailyCamera(view,aspect);assert.deepEqual(actualCamera.projectionMatrix.elements,camera.projectionMatrix.elements);assert.deepEqual(actualCamera.matrixWorld.elements,camera.matrixWorld.elements);
  const original=nativeAnchors(view),actual=photoAnchors(view);assert.deepEqual(actual.map(a=>a.id),original.map(a=>a.id));
  for(let i=0;i<actual.length;i++){assert.equal(actual[i].visible,original[i].visible);for(let j=0;j<2;j++){const expected=original[i].points[j];assert.ok(expected.distanceTo(new Vector3(...actual[i].points[j]))<1e-12);}}
  const visible=original.filter(a=>a.visible&&a.points.every(p=>{const v=p.clone().project(camera);return v.z>=-1&&v.z<=1&&Math.abs(v.x)<=.97&&Math.abs(v.y)<=.97;})).map(a=>a.id),pose=domain.photoPose(domain.CLIENTS[client].id,seconds,42);
  assert.deepEqual(photoFraming(view,aspect),{visible,blocked:client===0&&Math.abs(pose.boardX)<.85,lift:pose.lift});combinations++;
 }
 assert.equal(combinations,1620);
});

test('daily paper picking raycasts the visible paper plane and rejects outside paper or viewport',()=>{
 for(const aspect of [.6,1,4/3,2]){
  const view=sceneView('stamp'),rect={left:20,top:30,width:600*aspect,height:600},camera=dailyCamera(view,aspect);
  for(const p of [{x:0,y:0},{x:.6,y:-.5},{x:-.8,y:.9}]){
   const ndc=project(camera,[p.x*PAPER.xScale,PAPER.y,p.y*PAPER.yScale]),x=rect.left+(ndc.x+1)*rect.width/2,y=rect.top+(1-ndc.y)*rect.height/2,hit=paperPoint(view,rect,x,y);assert.ok(hit);assert.ok(Math.abs(hit.x-p.x)<1e-12);assert.ok(Math.abs(hit.y-p.y)<1e-12);
   const ray=new Raycaster();ray.setFromCamera(new Vector2(ndc.x,ndc.y),camera);const native=ray.ray.intersectPlane(new Plane(new Vector3(0,1,0),-PAPER.y),new Vector3())!;assert.ok(Math.abs(hit.x-native.x/1.2)<1e-12);assert.ok(Math.abs(hit.y-native.z/1.5)<1e-12);
  }
  for(const p of [[1.501,PAPER.y,0],[0,PAPER.y,1.851]] as const){const v=project(camera,p);assert.equal(paperPoint(view,rect,rect.left+(v.x+1)*rect.width/2,rect.top+(1-v.y)*rect.height/2),null);}
  for(const [x,y] of [[19,30],[20,29],[NaN,40],[40,Infinity]])assert.equal(paperPoint(view,rect,x,y),null);
 }
 assert.equal(paperPoint(sceneView('photo'),{left:0,top:0,width:400,height:300},200,150),null);
 assert.equal(paperPoint(sceneView('stamp'),{left:0,top:0,width:0,height:300},0,150),null);
});

test('daily cash drag preserves exact screen displacement for both renderer projections',()=>{
 for(const aspect of [.6,1,4/3,2])for(const cashDrag of [{x:0,y:0},{x:.25,y:.1},{x:-.3,y:-.15}]){
  const view={...sceneView('cash'),cashDrag},camera=dailyCamera(view,aspect),offset=cashDragOffset(view,aspect),before=project(camera,[0,.33,0]),after=project(camera,[offset.x,.33,offset.z]);
  assert.ok(Math.abs((after.x-before.x)/2-cashDrag.x)<1e-12);assert.ok(Math.abs((before.y-after.y)/2-cashDrag.y)<1e-12);
  const rect={left:0,top:0,width:600*aspect,height:600};assert.equal(cashContains(view,rect,(after.x+1)*rect.width/2,(1-after.y)*rect.height/2),true);
  const outside=project(camera,[offset.x+1.61,.33,offset.z]);assert.equal(cashContains(view,rect,(outside.x+1)*rect.width/2,(1-outside.y)*rect.height/2),false);
 }
 assert.deepEqual(letterboxRect(400,800),{x:300,y:0,width:360,height:720});assert.deepEqual(letterboxRect(1600,800),{x:0,y:120,width:960,height:480});
});

import * as three from 'three';
function lightStagePorts(options:{contextMissing?:boolean;observeThrows?:boolean}={}){
 const canvases:any[]=[],calls:{canvas:number;method:string;args:any[]}[]=[],observers:any[]=[];let captureFailure=false;
 const document={createElement:(tag:string)=>{assert.equal(tag,'canvas');const index=canvases.length;
  const context=new Proxy({},{get:(_o,key)=> (...args:any[])=>calls.push({canvas:index,method:String(key),args}),set:()=>true});
  const canvas={width:0,height:0,style:{},removed:0,setAttribute(){},getContext:(kind:string)=>{assert.equal(kind,'2d');return options.contextMissing?null:context;},toDataURL:(kind:string,quality:number)=>{calls.push({canvas:index,method:'toDataURL',args:[kind,quality]});if(captureFailure)throw Error('canvas readback denied');return `controlled-canvas-${index}`;},remove(){this.removed++;}};canvases.push(canvas);return canvas;}};
 const model={exports:{} as any};runInNewContext(transformSync(readFileSync(new URL('../../apps/portal-web/src/games/daily-scene-model.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module:model,exports:model.exports,document,require:(name:string)=>name==='three'?three:domain});
 class Observer{disconnected=0;constructor(public callback:()=>void){observers.push(this);}observe(){if(options.observeThrows)throw Error('observer failed');}disconnect(){this.disconnected++;}}
 const renderer={exports:{} as any};runInNewContext(transformSync(readFileSync(new URL('../../apps/portal-web/src/games/daily-scene.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs'}).code,{module:renderer,exports:renderer.exports,document,window:{devicePixelRatio:3},ResizeObserver:Observer,require:(name:string)=>name==='three'?three:name==='./domain'?domain:model.exports});
 const host={clientWidth:400,clientHeight:600,append(){},getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}};
 return {create:()=>renderer.exports.createDailyLightStage(host),host,canvases,calls,observers,failCapture:(value:boolean)=>{captureFailure=value;}};
}

test('daily actual Canvas2D stage draws live state, captures its own frame, resizes and disposes once (controlled ports)',()=>{
 const h=lightStagePorts(),stage=h.create();assert.throws(()=>stage.capture(),/尚未準備/);assert.equal(h.canvases[0].width,480);assert.equal(h.canvases[0].height,720);
 for(const client of [0,1,2]){const view={...sceneView(),client,seconds:5};stage.update(view);assert.deepEqual(JSON.parse(JSON.stringify(stage.framing())),photoFraming(view,2/3));}
 assert.ok(h.calls.some(c=>c.method==='lineTo'));assert.ok(h.calls.some(c=>c.method==='fill'));
 stage.update(sceneView('cash'));assert.ok(h.calls.some(c=>c.method==='fillText'&&String(c.args[0]).includes(domain.cashDeck(42)[0].label)));
 stage.update(sceneView('stamp'));assert.ok(h.calls.some(c=>c.method==='fillText'&&c.args[0]==='不計時練習紙'));
 assert.equal(stage.capture(),'controlled-canvas-1');const copy=h.calls.find(c=>c.canvas===1&&c.method==='drawImage')!;assert.ok(copy);assert.equal(copy.args[0],h.canvases[0]);assert.deepEqual(copy.args.slice(1),[240,0,480,720]);assert.equal(h.canvases[1].width,960);assert.equal(h.canvases[1].height,720);
 h.failCapture(true);assert.throws(()=>stage.capture(),/canvas readback denied/);h.failCapture(false);assert.equal(stage.capture(),'controlled-canvas-3');
 h.host.clientWidth=800;h.host.clientHeight=400;h.observers[0].callback();assert.equal(h.canvases[0].width,960);assert.equal(h.canvases[0].height,480);
 assert.deepEqual(JSON.parse(JSON.stringify(stage.stats())),{calls:0,triangles:0,geometries:0,textures:0});
 stage.dispose();stage.dispose();assert.equal(h.canvases[0].removed,1);assert.equal(h.observers[0].disconnected,1);assert.equal(h.canvases[0].width,1);assert.equal(h.canvases[0].height,1);assert.throws(()=>stage.capture(),/尚未準備/);const count=h.calls.length;stage.update(sceneView());h.observers[0].callback();assert.equal(h.calls.length,count);
});

test('daily actual Canvas2D initialization failure releases its owned canvas and observer',()=>{
 const missing=lightStagePorts({contextMissing:true});assert.throws(()=>missing.create(),/Canvas 2D/);
 const broken=lightStagePorts({observeThrows:true});assert.throws(()=>broken.create(),/observer failed/);assert.equal(broken.canvases[0].removed,1);assert.equal(broken.observers[0].disconnected,1);
});

for(const game of ['photo','stamp','cash'] as const)test(`daily actual ${game} control primary release commits once and repeated keydown never replaces a hold`,async()=>{
 const h=board(game);await h.resolve();await h.start();const l=h.api.live.current;
 const label=game==='photo'?'拍照快門':game==='stamp'?'啪！蓋章':domain.cashDeck(42)[0].valid?'收道具鈔 →':'← 退票券',b=h.button(label);
 const facts=()=>JSON.stringify(game==='photo'?l.photos:game==='stamp'?l.stamps:l.cash),before=facts();
 b.onPointerDown(h.pointer());b.onPointerUp(h.pointer());b.onLostPointerCapture(h.pointer());b.onClick({detail:1});assert.notEqual(facts(),before);const accepted=facts();h.advance(500);b.onClick({detail:1});assert.equal(facts(),accepted);
 const key={key:' ',repeat:true,preventDefault(){}};b.onKeyDown(key);b.onKeyUp(key);assert.equal(facts(),accepted);
 h.unmount();
});

for(const hold of ['pointer','keyboard'] as const)test(`daily actual client transition releases scene capture and cancels a held ${hold} shutter without resetting run time`,async()=>{
 const h=board('photo');await h.resolve();await h.start();const l=h.api.live.current,shutter=h.button('拍照快門');
 const key={key:' ',repeat:false,preventDefault(){}};
 h.api.pointerDown(h.pointer());assert.equal(h.target.hasPointerCapture(1),true);assert.equal(l.pointer.id,1);
 if(hold==='pointer')shutter.onPointerDown(h.pointer({pointerId:2}));else shutter.onKeyDown(key);
 h.advance(4750);h.api.nextClient();await h.flush();
 assert.equal(l.client,1);assert.equal(l.clock.elapsed,4750);assert.equal(l.roundAt,4750);assert.equal(l.clock.running,true);assert.equal(l.started,true);assert.equal(l.paused,false);
 assert.equal(l.pointer,null);assert.equal(h.target.hasPointerCapture(1),false);assert.equal(h.frames.size,1,'client transition retains the active run loop');
 const camera=JSON.stringify(l.targetPan);h.api.pointerMove(h.pointer({clientX:300,clientY:225}));h.api.pointerUp(h.pointer({clientX:300,clientY:225}));assert.equal(JSON.stringify(l.targetPan),camera);
 if(hold==='pointer'){shutter.onPointerUp(h.pointer({pointerId:2}));shutter.onClick({detail:1});}else shutter.onKeyUp(key);
 assert.equal(h.stats().captures,0);assert.equal(l.film,0);assert.equal(l.photos.length,0);assert.equal(l.clock.elapsed,4750);
 // A fresh current-client gesture still works after the cancelled old hold.
 const current=h.button('拍照快門');current.onPointerDown(h.pointer({pointerId:3}));current.onPointerUp(h.pointer({pointerId:3}));current.onClick({detail:1});
 assert.equal(h.stats().captures,1);assert.equal(l.film,1);assert.equal(l.photos.length,1);assert.equal(l.client,1);assert.equal(l.clock.elapsed,4750);h.unmount();
});

test('daily cash feedback pose, drag and contact share the actual moving card plane',()=>{
 let combinations=0;
 for(const feedback of ['wrong','correct'] as const)for(const age of [-10,0,15,35,70,160,600])for(const aspect of [1,4/3,2])for(const motion of [false,true])for(const cashDrag of [{x:0,y:0},{x:.06,y:.04},{x:-.06,y:-.04}]){
  const view={...sceneView('cash'),seconds:1+age/1000,motion,cashDrag,cash:{...domain.newCash(42),lastAt:1000,feedback}};
  const dt=Math.max(0,view.seconds*1000-1000),shake=motion&&feedback==='wrong'?Math.sin(dt*.045)*Math.exp(-dt/85)*.18:0,y=.08+.25+(motion&&feedback==='correct'?Math.exp(-dt/80)*.12:0);
  // Build the native camera and plane independently of dailyCamera/planePoint.
  const camera=new PerspectiveCamera(42,aspect,.1,60);camera.position.set(0,5.3,2.7);camera.lookAt(0,0,.23);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const center=new Vector3(0,y,0).project(camera),ray=new Raycaster();ray.setFromCamera(new Vector2(center.x+cashDrag.x*2,center.y-cashDrag.y*2),camera);
  const drag=ray.ray.intersectPlane(new Plane(new Vector3(0,1,0),-y),new Vector3());assert.ok(drag);
  const expected={x:drag.x+shake,y,z:drag.z},actual=cashCardPose(view,aspect),offset=cashDragOffset(view,aspect);
  for(const axis of ['x','y','z'] as const)assert.ok(Math.abs(actual[axis]-expected[axis])<1e-11,`${feedback}/${age}/${aspect}/${motion}/${axis}`);
  assert.ok(Math.abs(offset.x-drag.x)<1e-11);assert.ok(Math.abs(offset.z-drag.z)<1e-11);
  const displaced=new Vector3(actual.x-shake,actual.y,actual.z).project(camera);
  assert.ok(Math.abs((displaced.x-center.x)/2-cashDrag.x)<1e-11);assert.ok(Math.abs((center.y-displaced.y)/2-cashDrag.y)<1e-11);
  const rect={left:17,top:31,width:600*aspect,height:600};
  // Near-edge samples detect omitted shake and a stale fixed-height hit plane.
  for(const [dx,dz,inside] of [[0,0,true],[1.599,0,true],[-1.599,0,true],[0,1.074,true],[0,-1.074,true],[1.601,0,false],[-1.601,0,false],[0,1.076,false],[0,-1.076,false]] as const){
   const ndc=new Vector3(expected.x+dx,y,expected.z+dz).project(camera);
   assert.ok(Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1,'sample remains inside the viewport');
   const x=rect.left+(ndc.x+1)*rect.width/2,screenY=rect.top+(1-ndc.y)*rect.height/2;
   assert.equal(cashContains(view,rect,x,screenY),inside,`${feedback}/${age}/${aspect}/${motion}/${cashDrag.x}/${dx}/${dz}`);
  }
  combinations++;
 }
 assert.equal(combinations,252);
});

test('daily actual completed cash illustration draws all 24 accepted bills and six rejected vouchers',()=>{
 let cash=domain.newCash(42);
 for(const card of domain.cashDeck(42))cash=domain.sortCash(cash,cash.index,card.valid,cash.index*160).state;
 assert.equal(cash.index,30);assert.equal(cash.rejected,6);assert.equal(cash.amount,1_000_000);assert.notEqual(cash.endedAt,null);
 const h=lightStagePorts(),stage=h.create(),view={...sceneView('cash'),cash,seconds:cash.endedAt!/1000};
 h.calls.length=0;stage.update(view);
 // Inspect actual filled Canvas2D paths, not source text or a duplicated cap.
 const polygons:number[][][]= [];let path:number[][]=[];
 for(const call of h.calls){
  if(call.canvas!==0)continue;
  if(call.method==='beginPath')path=[];
  else if(call.method==='moveTo'||call.method==='lineTo')path.push(call.args.slice(0,2));
  else if(call.method==='fill')polygons.push(path.map(point=>[...point]));
 }
 const camera=dailyCamera(view,h.host.clientWidth/h.host.clientHeight),canvas=h.canvases[0];
 const expectedBill=(x:number,y:number)=>[[x-.64,y,.15-.825],[x+.64,y,.15-.825],[x+.64,y,.15+.825],[x-.64,y,.15+.825]].map(p=>{const v=new Vector3(...p).project(camera);return [(v.x+1)*canvas.width/2,(1-v.y)*canvas.height/2];});
 const count=(x:number,step:number)=>Array.from({length:30},(_,i)=>{
  const expected=expectedBill(x,.10+i*step);
  return polygons.filter(p=>p.length===4&&p.every((point,j)=>Math.abs(point[0]-expected[j][0])<1e-8&&Math.abs(point[1]-expected[j][1])<1e-8)).length;
 });
 const accepted=count(2.7,.022),rejected=count(-2.7,.025);
 assert.deepEqual(accepted,[...Array(24).fill(1),...Array(6).fill(0)],'one actual filled bill per accepted cash card');
 assert.deepEqual(rejected,[...Array(6).fill(1),...Array(24).fill(0)],'one actual filled voucher per rejected card');
 assert.ok(h.calls.some(c=>c.method==='fillText'&&c.args[0]==='盤點完成'));stage.dispose();
});

for(const renderer of ['native','light'] as const)for(const trigger of ['shutter','retained-media-effect'] as const)test(`daily actual ${renderer} update failure via ${trigger} preserves the run and reports its current renderer`,async()=>{
 const h=board('photo'),media=h.listeners.get('media:change');assert.ok(media);await h.resolve();
 if(renderer==='light'){h.api.changeRenderer('light');await h.flush();await h.resolve();assert.equal(h.listeners.get('media:change'),media,'the original effect closure survives the renderer switch');}
 await h.start();h.advance(250);h.api.shoot();await h.flush();
 const l=h.api.live.current,photos=l.photos,photo=l.photos[0],elapsed=l.clock.elapsed,shutter=h.button('拍照快門');assert.equal(l.film,1);assert.equal(photos.length,1);
 shutter.onPointerDown(h.pointer({pointerId:2}));h.api.pointerDown(h.pointer());assert.equal(h.target.hasPointerCapture(1),true);
 h.failUpdate(true);if(trigger==='shutter')h.api.shoot();else media();await h.flush();
 const message=renderer==='native'?'3D 畫面暫時中斷。按重試恢復這一局。':'輕量畫面暫時中斷。按重試恢復這一局。';
 assert.ok(h.nodes.some(n=>n.props.role==='alert'&&n.props.children===message));assert.equal(l.paused,true);assert.equal(l.clock.running,false);assert.equal(l.clock.elapsed,elapsed);assert.equal(l.pointer,null);assert.equal(h.target.hasPointerCapture(1),false);assert.equal(h.frames.size,0);
 assert.equal(l.photos,photos);assert.equal(l.photos[0],photo);assert.equal(l.film,1);assert.equal(h.stats().captures,1);
 h.failUpdate(false);const disposed=h.stats().disposed;h.button('重試場景').onClick();await h.flush();assert.equal(h.loads[0].mode,renderer);await h.resolve();assert.equal(h.stats().disposed,disposed+1);assert.equal(h.api.live.current,l);assert.equal(l.paused,true);assert.equal(l.clock.elapsed,elapsed);
 h.advance(10000);await h.start();assert.equal(l.clock.elapsed,elapsed);assert.equal(l.clock.running,true);
 // A stale held shutter cannot spend the remaining film even after resume.
 shutter.onPointerUp(h.pointer({pointerId:2}));shutter.onClick({detail:1});assert.equal(l.film,1);assert.equal(h.stats().captures,1);
 const fresh=h.button('拍照快門');fresh.onPointerDown(h.pointer({pointerId:3}));fresh.onPointerUp(h.pointer({pointerId:3}));fresh.onClick({detail:1});assert.equal(l.film,2);assert.equal(l.photos.length,2);assert.equal(l.photos[0],photo);assert.equal(h.stats().captures,2);h.unmount();
});

test('PHOTO composition keeps critical film/time distinct from the shutter label and preserves album ownership',async()=>{
 const h=board('photo');await h.resolve();await h.start();const l=h.api.live.current;
 const text=(node:any):string=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);
 const field=(key:string)=>h.nodes.find(n=>Object.hasOwn(n.props,key));
 assert.equal(text(field('data-photo-film')),'2 張');assert.equal(text(field('data-photo-time')),'12 秒');
 assert.ok(!field('data-photo-film').props.className.includes('daily-sr'));
 h.api.shoot();await h.flush();assert.equal(text(field('data-photo-film')),'1 張');assert.equal(l.photos.length,1);
 const photos=l.photos,first=l.photos[0],elapsed=l.clock.elapsed;
 h.button('檢視本局照片與評語').onClick({currentTarget:h.target});await h.flush();
 assert.equal(l.paused,true);assert.equal(l.photos,photos);assert.equal(l.photos[0],first);assert.equal(l.clock.elapsed,elapsed);assert.equal(l.fov,44);
 const dialog=h.nodes.find(n=>n.type==='dialog');assert.ok(dialog);assert.match(text(dialog),/本局照片與評語/);
 h.button('關閉相簿').onClick();await h.flush();assert.equal(h.nodes.some(n=>n.type==='dialog'),false);assert.equal(l.paused,true);
 await h.start();assert.equal(l.film,1);assert.equal(l.photos,photos);assert.equal(l.clock.elapsed,elapsed);h.unmount();
});

test('PHOTO floating action controls are outside the renderer pointer subtree and keep named keyboard actions',async()=>{
 const h=board('photo');await h.resolve();await h.start();
 const host=h.nodes.find(n=>Object.hasOwn(n.props,'data-game-stage'));assert.ok(host);assert.equal(host.props.children,undefined);
 for(const label of ['鏡頭往左','鏡頭往上','鏡頭往下','鏡頭往右','拍照快門','下一位客人 →']){
  const button=h.button(label);assert.equal(typeof button.onPointerDown,'function');assert.equal(typeof button.onKeyUp,'function');
  assert.notEqual(button.onPointerDown,host.props.onPointerDown);
 }
 const section=h.nodes.find(n=>n.type==='section');assert.match(section.props.className,/daily-photo/);
 h.api.nextClient();h.api.nextClient();await h.flush();assert.ok(h.button('挑選照片'));h.unmount();
});

for(const game of ['stamp','cash'] as const)test(`PHOTO composition does not add photo controls or styling to ${game}`,async()=>{
 const h=board(game);await h.resolve();await h.start();
 assert.equal(h.nodes.find(n=>n.type==='section').props.className,`fw-arcade-board daily-scene${game==='stamp'?' daily-stamp':''}`);
 assert.equal(h.nodes.some(n=>Object.hasOwn(n.props,'data-photo-film')),false);
 assert.equal(h.nodes.some(n=>n.props['aria-label']==='檢視本局照片與評語'),false);h.unmount();
});

test('PHOTO visible goals follow manual and timed clients while shot feedback uses only saved grades',async()=>{
 const h=board('photo');await h.resolve();await h.start();
 const text=(node:any):string=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);
 const field=(key:string)=>h.nodes.find(n=>Object.hasOwn(n.props,key));
 assert.equal(text(field('data-photo-goal')),'臉和雙腳');assert.equal(text(field('data-photo-feedback')),'等時機');
 assert.equal(field('data-photo-goal').props['aria-label'],domain.CLIENTS[0].request);
 h.api.shoot();await h.flush();const l=h.api.live.current,saved=l.photos[0];assert.equal(text(field('data-photo-feedback')),`已存${saved.stars}★`);
 h.failCapture(true);h.api.shoot();await h.flush();assert.equal(field('data-photo-feedback'),undefined);const alert=h.nodes.find(n=>n.props.className==='daily-photo-failure');assert.equal(text(alert),'未存，按快門');assert.match(alert.props['aria-label'],/照片未保存，請再按快門/);assert.equal(l.photos.length,1);assert.equal(l.film,1);
 h.advance(12016);const [id,frame]=[...h.frames.entries()][0];h.frames.delete(id);frame(12016);await h.flush();
 assert.equal(l.client,1);assert.equal(l.paused,false);assert.equal(l.clock.elapsed,12016);assert.equal(l.film,0);assert.equal(text(field('data-photo-goal')),'全身全傘');assert.equal(field('data-photo-goal').props['aria-label'],domain.CLIENTS[1].request);assert.equal(text(field('data-photo-feedback')),'等時機');
 h.api.nextClient();await h.flush();assert.equal(l.client,2);assert.equal(l.paused,false);assert.equal(l.clock.elapsed,12016);assert.equal(text(field('data-photo-goal')),'三鴿同框');assert.equal(field('data-photo-goal').props['aria-label'],domain.CLIENTS[2].request);
 assert.equal(l.photos[0],saved);h.unmount();
});

for(const input of ['pad','keyboard'] as const)test(`PHOTO ${input} reaches the measured wide-portrait umbrella target through actual handlers`,async()=>{
 const h=board('photo');await h.resolve();await h.start();h.api.nextClient();await h.flush();
 const l=h.api.live.current,slider=h.nodes.find(n=>n.type==='input'&&n.props['aria-label']==='鏡頭廣角');slider.props.onChange({target:{value:'60'}});
 const count=input==='pad'?2:3,step=input==='pad'?.35:.25;
 for(let i=0;i<count;i++)for(const [key,label]of [['ArrowRight','鏡頭往右'],['ArrowUp','鏡頭往上']]){
  if(input==='pad')h.button(label).onClick({detail:0});
  else h.api.keyboard({key,repeat:false,preventDefault(){},target:{closest(){return null;}}});
 }
 assert.ok(Math.abs(l.targetPan.x-count*step)<1e-12);assert.ok(Math.abs(l.targetPan.y-count*step)<1e-12);assert.equal(l.fov,60);
 for(let frame=0;frame<5;frame++){h.advance(50);const [id,callback]=h.frames.entries().next().value!;h.frames.delete(id);callback(l.clock.last+50);await h.flush();}
 assert.ok(l.pan.x>l.targetPan.x*.98&&l.pan.x<l.targetPan.x);assert.ok(l.pan.y>l.targetPan.y*.98&&l.pan.y<l.targetPan.y);
 const v={...sceneView(),client:1,seconds:(l.clock.elapsed-l.roundAt)/1000,fov:l.fov,pan:l.pan};
 for(const aspect of [320/568,390/844]){const f=photoFraming(v,aspect);assert.equal(domain.gradePhoto('umbrella',f.visible,v.seconds,f.blocked,f.lift).stars,3);}
 h.unmount();
});


test('STAMP visible facts follow actual practice, misses, time and pause while actions stay outside the pointer host',async()=>{
 const h=board('stamp');await h.resolve();await h.start();const l=h.api.live.current;
 const text=(node:any):string=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node==null||typeof node==='boolean'?'':String(node);
 const field=(key:string)=>h.nodes.find(n=>Object.hasOwn(n.props,key));
 assert.equal(text(field('data-stamp-goal')),'蓋藍圈');assert.equal(text(field('data-stamp-time')),'不計時');assert.equal(field('data-stamp-time').props['aria-label'],'練習不計時');assert.equal(text(field('data-stamp-misses')),'歪0');
 h.api.applyStamp({x:1,y:1});await h.flush();assert.equal(text(field('data-stamp-misses')),'歪1');assert.equal(text(field('data-stamp-time')),'不計時');
 h.advance(220);h.api.applyStamp(domain.stampTarget(42,0));await h.flush();assert.equal(text(field('data-stamp-misses')),'歪0');assert.equal(text(field('data-stamp-time')),'0:00');assert.equal(field('data-stamp-time').props['aria-label'],'本局已用時間 0:00');
 h.advance(220);h.api.pointerDown(h.pointer());h.advance(1234);h.api.setPaused();await h.flush();assert.equal(text(field('data-stamp-time')),'0:01');assert.equal(field('data-stamp-time').props['aria-label'],'本局已用時間 0:01');
 const elapsed=l.clock.elapsed;h.advance(60000);await h.flush();assert.equal(text(field('data-stamp-time')),'0:01');assert.equal(field('data-stamp-time').props['aria-label'],'本局已用時間 0:01');await h.start();assert.equal(l.clock.elapsed,elapsed);
 const host=field('data-game-stage');assert.equal(host.props.children,undefined);assert.notEqual(h.button('啪！蓋章').onPointerDown,host.props.onPointerDown);
 h.api.applyStamp(domain.stampTarget(42,0));await h.flush();assert.equal(l.stamps.index,1);assert.equal(text(field('data-stamp-misses')),'歪0');
 assert.equal(h.nodes.some(n=>n.props['data-photo-goal']!==undefined),false);h.unmount();
});


for(const [width,height]of [[320,568],[390,844],[667,375],[296,482],[358,758],[635,289]])test(`STAMP actual light drawing ${width}x${height} projects the unchanged target ring through the same camera`,()=>{
 const h=lightStagePorts();h.host.clientWidth=width;h.host.clientHeight=height;const stage=h.create(),view=sceneView('stamp');stage.update(view);
 const camera=dailyCamera(view,width/height),canvas=h.canvases[0],target=domain.stampTarget(42,0),expected=Array.from({length:64},(_,i)=>{const a=i*Math.PI/32,p=project(camera,[(target.x+Math.cos(a)*domain.RULES.stampRadius)*1.2,.092,(target.y+Math.sin(a)*domain.RULES.stampRadius)*1.5]);return [(p.x+1)*canvas.width/2,(1-p.y)*canvas.height/2];});
 const paths:number[][][]=[];let path:number[][]=[];for(const c of h.calls){if(c.canvas!==0)continue;if(c.method==='beginPath')path=[];else if(c.method==='moveTo'||c.method==='lineTo')path.push(c.args.slice(0,2));else if(c.method==='fill')paths.push(path.map(p=>[...p]));}
 assert.equal(paths.filter(p=>p.length===64&&p.every((point,i)=>Math.hypot(point[0]-expected[i][0],point[1]-expected[i][1])<1e-9)).length,1);
 const p=project(camera,[target.x*1.2,.086,target.y*1.5]),hit=stage.point((p.x+1)*width/2,(1-p.y)*height/2);assert.ok(hit);assert.ok(Math.hypot(hit.x-target.x,hit.y-target.y)<1e-12);stage.dispose();
});
