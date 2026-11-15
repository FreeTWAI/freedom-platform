import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';

// Execute the unmodified production handlers. This is a routing/ownership
// harness, not React, native focus, pointer-capture or WebGL evidence.
const source=readFileSync(new URL('../../apps/portal-web/src/games/AbsurdDaily.tsx',import.meta.url),'utf8');
function between(name:string,next:string){
  const start=source.indexOf(`    function ${name}(`),end=source.indexOf(`    function ${next}(`,start);
  assert.ok(start>=0&&end>start,`${name} production closure`);
  return source.slice(start,end);
}
const handlers=stripTypeScriptTypes(between('keyboard','pointerDown')+between('pointerDown','pointerMove'));
type Game='photo'|'stamp'|'cash';
function board(game:Game){
  let active='button',prevented=0,captured=0,focuses=0,actions=0;
  const options:unknown[]=[];
  const live={current:{started:true,paused:false,done:false,pointer:null as unknown,targetPan:{x:.2,y:.3},cash:{index:4},stamps:{practice:false,index:2},stampPoint:{x:0,y:0},clock:{elapsed:1000},raised:false}};
  const context={game,live,ready:true,pendingResult:{current:null as unknown},section:{current:{focus(option:unknown){active='board';focuses++;options.push(option);}}},
    syncClock(){},beginStamps:(value:unknown)=>value,stage:{current:{point:()=>({x:.1,y:.2})}},render(){},
    shoot(){actions++;},applyStamp(){actions++;},applyCash(){actions++;},pan(){},clamp:(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value)),setPaused(){}};
  const api=runInNewContext(`${handlers};({keyboard,pointerDown})`,context) as {keyboard:(event:unknown)=>void;pointerDown:(event:unknown)=>void};
  const pointer={button:0,isPrimary:true,pointerId:7,clientX:100,clientY:200,preventDefault(){prevented++;},currentTarget:{setPointerCapture(id:number){assert.equal(id,7);captured++;}}};
  const key=(key=game==='cash'?'ArrowRight':' ',extra:Record<string,unknown>={})=>api.keyboard({key,repeat:false,target:{closest:()=>active==='button'?{}:null},preventDefault(){prevented++;},...extra});
  return {context,live,api,pointer,key,control:()=>{active='button';},stats:()=>({active,prevented,captured,focuses,actions,options})};
}

for(const game of ['photo','stamp','cash'] as const)test(`${game}: accepted scene pointer restores keyboard ownership after a control`,()=>{
  const h=board(game);
  h.key();assert.equal(h.stats().actions,0,'a focused control retains native keys');
  h.api.pointerDown(h.pointer);
  assert.equal(h.stats().active,'board');assert.equal(h.stats().focuses,1);assert.equal(h.stats().captured,1);
  assert.equal(JSON.stringify(h.stats().options),JSON.stringify([{preventScroll:true}]));
  assert.equal((h.live.current.pointer as {index:number}).index,game==='cash'?4:2);
  h.key();assert.equal(h.stats().actions,1);
  h.control();h.key();assert.equal(h.stats().actions,1,'returning to a control must not classify, stamp or shoot');
  h.live.current.pointer=null;h.api.pointerDown(h.pointer);h.key();assert.equal(h.stats().actions,2);assert.equal(h.stats().focuses,2);
});

test('rejected pointers never steal focus, prevent defaults, capture or replace the active gesture',()=>{
  for(const game of ['photo','stamp','cash'] as const)for(const reason of ['loading','not-started','paused','done','pending-result','other-pointer','secondary','right-button'] as const){
    const h=board(game);
    if(reason==='loading')h.context.ready=false;
    if(reason==='not-started')h.live.current.started=false;
    if(reason==='paused')h.live.current.paused=true;
    if(reason==='done')h.live.current.done=true;
    if(reason==='pending-result')h.context.pendingResult.current={};
    if(reason==='other-pointer')h.live.current.pointer={id:99};
    if(reason==='secondary')h.pointer.isPrimary=false;
    if(reason==='right-button')h.pointer.button=2;
    const before=h.live.current.pointer;h.api.pointerDown(h.pointer);
    assert.equal(h.live.current.pointer,before,`${game}/${reason}`);
    assert.deepEqual(h.stats(),{active:'button',prevented:0,captured:0,focuses:0,actions:0,options:[]},`${game}/${reason}`);
  }
});

test('restored keyboard ownership still respects modifiers, repeated action keys and pause',()=>{
  for(const game of ['photo','stamp','cash'] as const){
    const h=board(game);h.api.pointerDown(h.pointer);
    for(const flag of ['repeat','altKey','metaKey','ctrlKey'])h.key(undefined,{[flag]:true});
    assert.equal(h.stats().actions,0);
    h.live.current.paused=true;h.key();assert.equal(h.stats().actions,0);
    h.live.current.paused=false;h.key();assert.equal(h.stats().actions,1);
  }
});

// Execute the exact standalone atelier gesture closures. This verifies pointer
// ownership, not native event delivery, WebGL, screenshot or device behavior.
const atelierSource=readFileSync(new URL('../../apps/portal-web/src/games/photo-cash-atelier.ts',import.meta.url),'utf8');
function atelierClosure(start:string,end:string){const a=atelierSource.indexOf(start),b=atelierSource.indexOf(end,a);assert.ok(a>=0&&b>a,'atelier source closure exists');return atelierSource.slice(a,b);}
const atelierHandlers=stripTypeScriptTypes(atelierClosure('function cancelPointer(){','function nextClient(')+atelierClosure('const down=(e:PointerEvent)',"canvas.addEventListener('pointerdown'"));
function atelierGesture(photo:boolean){
 const held=new Set<number>(),released:number[]=[],sorted:boolean[]=[];let renders=0;
 const context={photo,paused:false,lost:false,ended:false,clientIndex:0,cash:{index:0},root:{clientWidth:390,clientHeight:844},RULES:{swipePx:48},cardGroup:{position:{x:0},rotation:{z:0}},clamp:(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n)),updateCamera(){},render(){renders++;},sort(accept:boolean){sorted.push(accept);},canvas:{focus(){},setPointerCapture(id:number){held.add(id);},hasPointerCapture(id:number){return held.has(id);},releasePointerCapture(id:number){held.delete(id);released.push(id);}}};
 const api=runInNewContext(`let pointer=null,startX=0,startY=0,dragX=0,dragY=0,panX=0,panY=0,dragIndex=0;${atelierHandlers};({down,move,up,cancel,cancelPointer,read:()=>({pointer,panX,panY})})`,context) as {down:(e:unknown)=>void;move:(e:unknown)=>void;up:(e:unknown)=>void;cancel:(e:unknown)=>void;cancelPointer:()=>void;read:()=>{pointer:number|null;panX:number;panY:number}};
 const event=(pointerId:number,x=100,y=200,isPrimary=pointerId===1)=>({pointerId,clientX:x,clientY:y,isPrimary,button:0,preventDefault(){}});
 return {api,event,context,held,released,sorted,renders:()=>renders};
}
for(const mode of ['photo','cash'] as const){
 test(`${mode} atelier: ignored pointer cancellation preserves the owned drag`,()=>{
  for(const cancelled of ['pointercancel','lostpointercapture']){
   const h=atelierGesture(mode==='photo');h.api.down(h.event(1));h.api.down(h.event(2,100,200,false));
   h.api.cancel({...h.event(2,100,200,false),type:cancelled});assert.equal(h.api.read().pointer,1,cancelled);assert.ok(h.held.has(1));assert.equal(h.released.length,0);assert.equal(h.renders(),0);
   h.api.move(h.event(1,170));h.api.up(h.event(1,170));assert.equal(h.api.read().pointer,null);assert.deepEqual(h.released,[1]);
   if(mode==='photo'){assert.ok(h.api.read().panX<0);assert.deepEqual(h.sorted,[]);}else assert.deepEqual(h.sorted,[true]);
  }
 });
 test(`${mode} atelier: owner cancellation aborts without scoring or stale movement`,()=>{
  for(const cancelled of ['pointercancel','lostpointercapture']){
   const h=atelierGesture(mode==='photo');h.api.down(h.event(1));h.api.move(h.event(1,120));h.api.cancel({...h.event(1),type:cancelled});const pan=h.api.read().panX;
   h.api.move(h.event(1,170));h.api.up(h.event(1,170));assert.equal(h.api.read().pointer,null);assert.equal(h.api.read().panX,pan);assert.deepEqual(h.sorted,[]);assert.deepEqual(h.released,[1]);assert.equal(h.context.cardGroup.position.x,0);
  }
 });
 test(`${mode} atelier: internal pause/reset/expiry cancellation remains unconditional`,()=>{
  const h=atelierGesture(mode==='photo');h.api.down(h.event(1));h.api.cancelPointer();assert.equal(h.api.read().pointer,null);assert.deepEqual(h.released,[1]);h.api.up(h.event(1,170));assert.deepEqual(h.sorted,[]);
  h.api.cancel({...h.event(2),type:'lostpointercapture'});assert.equal(h.api.read().pointer,null);assert.deepEqual(h.released,[1]);
 });
}

// Execute the production layout arithmetic, including narrow/tall viewports.
const layoutSource=stripTypeScriptTypes(atelierClosure('export function atelierLayout(', 'export function paintAtelierBanknote').replace('export ',''));
const layout=runInNewContext(`${layoutSource};atelierLayout`) as (w:number,h:number,photo:boolean)=>{extent:number;viewWidth:number;benchWidth:number;benchDepth:number;backdropWidth:number;backdropHeight:number};
test('atelier set covers the viewport without fitting a miniature cabinet in portrait',()=>{
 for(const [w,h] of [[1440,1000],[390,844],[667,375],[320,960],[195,422]]){
  const cash=layout(w,h,false),photo=layout(w,h,true);
  assert.ok(cash.benchWidth>cash.viewWidth);
  assert.ok(cash.benchDepth*8/Math.sqrt(89)>cash.extent,'projected depth covers the complete camera');
  // At z=-1.8, cover all horizontal panning and the highest ray at
  // panY=2. Camera pitch is atan(2.2/10); lower rays land on the floor.
  for(const panX of [-2,0,2])assert.ok(Math.abs(panX)+photo.viewWidth/2<photo.backdropWidth/2);
  const highestWallRay=2+2+photo.extent/2*Math.sqrt(104.84)/10+1.8*.22;
  assert.ok(highestWallRay<photo.backdropHeight-2,'top edge stays outside the complete framing range');
  assert.ok(cash.viewWidth>=5.4,'classification centers remain available; colored gutters intentionally bleed past the viewport');
 }
 const portrait=layout(390,844,false),landscape=layout(844,390,false);
 assert.ok(portrait.benchDepth>landscape.benchDepth,'portrait set expands instead of shrinking the cash');
});

const paintSource=stripTypeScriptTypes(atelierClosure('export function paintAtelierBanknote(', 'export function mountPhotoCashAtelier').replace('export ',''));
const paint=runInNewContext(`${paintSource};paintAtelierBanknote`) as (c:unknown,label:string,valid:boolean,id:number)=>void;
test('engraved prop banknotes preserve the exact classification label and explicit fictional-money disclaimer',()=>{
 for(const [label,valid,id] of [['5 萬',true,14],['下個月幫你加薪',false,7]] as const){
  const text:string[]=[],coordinates:number[]=[];
  const ctx=new Proxy({},{get:(_target,key)=>key==='fillText'?(value:string,...args:number[])=>{text.push(value);coordinates.push(...args);}:(...args:number[])=>coordinates.push(...args),set:()=>true});
  paint(ctx,label,valid,id);
  assert.ok(text.includes(label));assert.ok(text.includes('遊戲道具 · NOT LEGAL TENDER'));
  assert.ok(text.includes('NO. '+String(id+1).padStart(4,'0')));
  assert.ok(text.includes(valid?'COUNT WHAT IS REAL':'A PROMISE IS NOT CASH'));
  assert.ok(coordinates.every(Number.isFinite));
 }
});

// Execute the real scheduler/lifecycle without a renderer. Native visual
// flight and full 30-card input remain covered in the unchanged browser cases.
const settleSource=stripTypeScriptTypes(atelierClosure('function stop(){','function pause(){')+atelierClosure('function unpause(){','function reset(){'));
test('cash scene stays event-driven and pause cancels the compositor paper flight',()=>{
 let queued=0,cancelled=0,renders=0,flightCancelled=0;
 const context={photo:false,paused:false,lost:false,disposed:false,ended:false,elapsed:0,last:1000,flashUntil:0,frame:0,performance:{now:()=>1000},flightAnimation:{cancel(){flightCancelled++;}},cardGroup:{position:{y:0}},root:{dataset:{} as Record<string,string>},panel:{hidden:false},controls:{inert:true},footer:{inert:true},canvas:{inert:true,focus(){}},refresh(){},render(){renders++;},requestAnimationFrame(){queued++;return queued;},cancelAnimationFrame(){cancelled++;}};
 const api=runInNewContext(`${settleSource};({animate,start,stop,unpause})`,context) as {animate:(t:number)=>void;start:()=>void;stop:()=>void;unpause:()=>void};
 api.start();api.animate(1000);api.animate(1200);assert.equal(queued,0,'no cash animation or idle RAF');assert.equal(renders,0);
 context.paused=true;api.stop();assert.equal(flightCancelled,1);assert.equal(cancelled,1);assert.equal(context.flightAnimation,null);
 api.unpause();assert.equal(context.root.dataset.cashSettled,'true');assert.equal(queued,0);assert.equal(renders,1,'resume redraws once');
 context.lost=true;context.paused=true;api.unpause();assert.equal(context.paused,true,'context loss cannot resume');
});

const flightSource=stripTypeScriptTypes(atelierClosure('function flyBill(', 'function sort('));
test('cash flight copies the outgoing note, follows the chosen side and respects reduced motion',()=>{
 const painted:unknown[]=[],animations:any[]=[],image={note:'outgoing'};let cancelled=0,reduced=false;
 const context={flightAnimation:{cancel(){cancelled++;}},bill:{material:{map:{image}}},flightContext:{clearRect(){},drawImage(...args:unknown[]){painted.push(args[0]);}},matchMedia:()=>({matches:reduced}),THREE:{Vector3:class{x:number;constructor(x:number){this.x=x;}project(){return {x:this.x/3,y:0};}}},cardGroup:{position:{x:0},rotation:{z:0}},camera:{left:-3,right:3,top:6,bottom:-6},root:{clientWidth:390,clientHeight:844},flight:{dataset:{} as Record<string,string>,style:{} as Record<string,string>,animate(frames:unknown,options:unknown){animations.push({frames,options});return {cancel(){cancelled++;}};}}};
 const fly=runInNewContext(`${flightSource};flyBill`,context) as (accept:boolean)=>void;
 fly(true);assert.equal(painted[0],image);assert.equal(context.flight.dataset.direction,'keep');assert.match(animations[0].frames[1].transform,/117px/);assert.equal(animations[0].options.duration,220);
 assert.equal(context.flight.style.width,'195px');assert.equal(context.flight.style.left,'195px');
 context.cardGroup.position.x=1;context.cardGroup.rotation.z=.035;fly(false);assert.equal(context.flight.style.left,'260px','continues at released paper position');assert.match(animations[1].frames[0].transform,/rotate\(-2/);assert.equal(context.flight.dataset.direction,'reject');assert.match(animations[1].frames[1].transform,/-117px/);
 reduced=true;fly(true);assert.equal(animations.length,2,'no animation under reduced motion');assert.equal(context.flightAnimation,null);assert.equal(cancelled,3);
});

const damageRenderSource=stripTypeScriptTypes(atelierClosure('function render(){','function updateCamera(){'));
test('cash damage redraw covers old and new bounds, restores scissor and fully redraws invalidated frames',()=>{
 const calls:unknown[][]=[];let next={x:100,y:200,z:500,w:600};
 const context={disposed:false,lost:false,photo:false,cashDamage:null as unknown,panX:0,panY:0,updatePose(){},performance:{now:()=>0},cashBounds:()=>next,scene:{},camera:{},root:{clientWidth:1440,clientHeight:1000,dataset:{}},renderer:{info:{render:{calls:67,triangles:31618}},getPixelRatio:()=>1.5,setScissor(...args:number[]){calls.push(['rect',...args]);},setScissorTest(on:boolean){calls.push(['enabled',on]);},render(){calls.push(['render']);}}};
 const render=runInNewContext(`${damageRenderSource};render`,context) as ()=>void;
 render();assert.deepEqual(calls,[['render'],['enabled',false]],'first frame is complete');
 calls.length=0;next={x:-50,y:300,z:700,w:1200};render();assert.deepEqual(calls,[['rect',0,200,701,801],['enabled',true],['render'],['enabled',false]],'union erases old paper with an outward pixel margin clipped by the framebuffer');
 calls.length=0;context.cashDamage=null;render();assert.deepEqual(calls,[['render'],['enabled',false]],'resize/context restore must invalidate retained pixels');
 calls.length=0;context.photo=true;render();assert.deepEqual(calls,[['render'],['enabled',false]],'moving photo scene never uses retained pixels');
 calls.length=0;context.lost=true;render();assert.equal(calls.length,0);
});

test('cash scissor covers the last framebuffer column and row after fractional-DPR shadow restoration',()=>{
 // Three uses round() in setScissor but floor() when a shadow pass restores
 // the default target. Execute production render and check BOTH conversions.
 for(const ratio of [.5,.75,1,1.25,1.5])for(const [width,height] of [[390,844],[667,375]]){
  let rect:number[]=[];
  const context={disposed:false,lost:false,photo:false,cashDamage:{x:1,y:1,z:width,w:height},panX:0,panY:0,updatePose(){},performance:{now:()=>0},cashBounds:()=>context.cashDamage,scene:{},camera:{},root:{clientWidth:width,clientHeight:height,dataset:{}},renderer:{info:{render:{calls:67,triangles:31618}},getPixelRatio:()=>ratio,setScissor(...args:number[]){rect=args;},setScissorTest(){},render(){}}};
  const render=runInNewContext(`${damageRenderSource};render`,context) as ()=>void;
  for(let start=0;start<width;start++){
   context.cashDamage={x:start,y:start%height,z:width,w:height};render();
   for(const convert of [Math.floor,Math.round]){
    const [x,y,w,h]=rect.map(value=>convert(value*ratio));
    assert.ok(x+w>=Math.floor(width*ratio),`DPR ${ratio}, origin ${start}: right edge is retained`);
    assert.ok(y+h>=Math.floor(height*ratio),`DPR ${ratio}, origin ${start}: top edge is retained`);
    assert.ok(x<=Math.ceil(start*ratio)&&y<=Math.ceil((start%height)*ratio));
   }
   assert.ok(rect[2]<=width-start+2&&rect[3]<=height-start%height+2,'only a bounded edge margin is redrawn');
  }
 }
});
