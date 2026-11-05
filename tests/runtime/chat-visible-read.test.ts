import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Run the production hook, not a copy of its geometry. Browser layout and HTTP
// boundaries are covered separately in chat-visible-read.spec.ts.
const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/ChatWorkspace.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm'}).code;
const start=source.indexOf('function useVisibleChatRead('),end=source.indexOf('\n}',start)+2;
assert.ok(start>=0&&end>start);
type Rect={top:number;bottom:number;left:number;right:number};
function events(){
  const listeners=new Map<string,Set<()=>void>>();
  return {
    addEventListener:(name:string,fn:()=>void)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name)!.add(fn);},
    removeEventListener:(name:string,fn:()=>void)=>listeners.get(name)?.delete(fn),
    fire:(name:string)=>[...listeners.get(name)??[]].forEach(fn=>fn()),
    count:()=>[...listeners.values()].reduce((n,set)=>n+set.size,0),
  };
}
function host(visual=true){
  const viewport=Object.assign(events(),{offsetLeft:150,offsetTop:200,width:200,height:300});
  const window=Object.assign(events(),{visualViewport:visual?viewport:null});
  const document=Object.assign(events(),{visibilityState:'visible'}),navigator={onLine:true};
  const geometry={bubble:{top:250,bottom:290,left:200,right:240} as Rect,log:{top:0,bottom:700,left:0,right:400} as Rect};
  const bubble={getBoundingClientRect:()=>geometry.bubble};
  const log={scrollHeight:700,scrollTop:0,clientHeight:700,getBoundingClientRect:()=>geometry.log,querySelector:(_selector:string)=>bubble as typeof bubble|null};
  const reads:string[]=[],frames=new Map<number,()=>void>(),refs:unknown[]=[];
  let cursor=0,id=0,dependencies:unknown[]|undefined,cleanup:(()=>void)|undefined;
  const observers:{disconnected:boolean;callback:()=>void}[]=[];
  const props={active:true,identity:'guild:one' as string|null,through:'incoming-1' as string|undefined,unread:1,blocked:false,scroll:{current:log as typeof log|null},onRead:(through:string)=>reads.push(through)};
  const hook=runInNewContext(`${source.slice(start,end)};useVisibleChatRead`,{
    window,document,navigator,innerWidth:400,innerHeight:700,CSS:{escape:(value:string)=>value},
    requestAnimationFrame:(fn:()=>void)=>{frames.set(++id,fn);return id;},cancelAnimationFrame:(key:number)=>frames.delete(key),
    useRef:(value:unknown)=>{const index=cursor++;return refs[index]??=( {current:value} );},
    useEffect:(fn:()=>void|(()=>void),deps:unknown[])=>{if(dependencies&&deps.every((value,index)=>Object.is(value,dependencies![index])))return;cleanup?.();dependencies=deps;cleanup=fn()||undefined;},
    IntersectionObserver:class {entry:{disconnected:boolean;callback:()=>void};constructor(callback:()=>void){this.entry={callback,disconnected:false};observers.push(this.entry);}observe(){}disconnect(){this.entry.disconnected=true;}},
  });
  function render(){cursor=0;hook(props);}
  function flush(){const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());}
  render();
  return {props,reads,frames,observers,geometry,log,viewport,window,document,navigator,render,flush,unmount:()=>cleanup?.()};
}

for(const [side,box] of Object.entries({
  left:{top:250,bottom:290,left:10,right:100},right:{top:250,bottom:290,left:350,right:390},
  above:{top:100,bottom:140,left:200,right:240},below:{top:600,bottom:640,left:200,right:240},
}))test(`visual viewport excludes the latest incoming bubble ${side} without marking it read`,()=>{
  const h=host();h.geometry.bubble=box;if(side==='below')Object.assign(h.viewport,{offsetTop:0,height:360});h.flush();assert.deepEqual(h.reads,[]);h.unmount();
});

test('positive one-pixel overlap reads once, but edge contact is not visible',()=>{
  const h=host();h.geometry.bubble={top:250,bottom:290,left:100,right:150};h.flush();assert.deepEqual(h.reads,[]);
  h.geometry.bubble.right=151;h.viewport.fire('scroll');h.flush();assert.deepEqual(h.reads,['incoming-1']);
  h.viewport.fire('resize');h.window.fire('focus');h.flush();assert.deepEqual(h.reads,['incoming-1']);h.unmount();
});

for(const event of ['resize','scroll'])test(`visual-only ${event} reveals a boundary without a window or observer event`,()=>{
  const h=host();h.geometry.bubble={top:600,bottom:640,left:200,right:240};h.flush();assert.deepEqual(h.reads,[]);
  Object.assign(h.viewport,{offsetTop:0,height:700});h.viewport.fire(event);h.flush();assert.deepEqual(h.reads,['incoming-1']);h.unmount();
});

test('missing visualViewport falls back to layout bounds and still clips to the log',()=>{
  const h=host(false);h.geometry.bubble={top:600,bottom:640,left:10,right:100};h.flush();assert.deepEqual(h.reads,['incoming-1']);h.unmount();
  const clipped=host(false);clipped.geometry.log.right=190;clipped.flush();assert.deepEqual(clipped.reads,[]);clipped.unmount();
});

test('visual, layout and log rectangles must all overlap',()=>{
  for(const change of [
    (h:ReturnType<typeof host>)=>{h.geometry.log.bottom=240;},
    (h:ReturnType<typeof host>)=>{Object.assign(h.viewport,{offsetTop:750,height:100});h.geometry.bubble.top=760;h.geometry.bubble.bottom=790;h.geometry.log.bottom=900;},
    (h:ReturnType<typeof host>)=>{h.geometry.log.right=150;},
  ]){const h=host();change(h);h.flush();assert.deepEqual(h.reads,[]);h.unmount();}
});

for(const guard of ['hidden','offline','inactive','blocked','history','no-unread','no-identity','no-boundary','no-log','no-bubble'] as const)test(`${guard} guard prevents automatic reads`,()=>{
  const h=host();
  if(guard==='hidden')h.document.visibilityState='hidden';
  if(guard==='offline')h.navigator.onLine=false;
  if(guard==='inactive')h.props.active=false;
  if(guard==='blocked')h.props.blocked=true;
  if(guard==='history')h.log.scrollHeight=780;
  if(guard==='no-unread')h.props.unread=0;
  if(guard==='no-identity')h.props.identity=null;
  if(guard==='no-boundary')h.props.through=undefined;
  if(guard==='no-log')h.props.scroll.current=null;
  if(guard==='no-bubble')h.log.querySelector=()=>null;
  // Force a fresh effect for DOM-presence cases as a React log remount would.
  h.props.scroll={current:h.props.scroll.current};h.render();h.flush();assert.deepEqual(h.reads,[]);h.unmount();
});

test('returning within 79px of latest and restoring visibility/online can read',()=>{
  const h=host();h.log.scrollHeight=780;h.flush();assert.deepEqual(h.reads,[]);
  h.log.scrollTop=1;h.document.visibilityState='hidden';h.window.fire('scroll');h.flush();assert.deepEqual(h.reads,[]);
  h.document.visibilityState='visible';h.navigator.onLine=false;h.document.fire('visibilitychange');h.flush();assert.deepEqual(h.reads,[]);
  h.navigator.onLine=true;h.window.fire('online');h.flush();assert.deepEqual(h.reads,['incoming-1']);h.unmount();
});

test('quiet remounts never retry an attempted boundary, while a new identity or boundary can read',()=>{
  const h=host();h.flush();h.props.unread=2;h.render();h.flush();
  h.props.active=false;h.render();h.props.active=true;h.render();h.flush();assert.deepEqual(h.reads,['incoming-1']);
  h.props.through='incoming-2';h.render();h.flush();h.props.identity='direct:other';h.render();h.flush();
  assert.deepEqual(h.reads,['incoming-1','incoming-2','incoming-2']);h.unmount();
});

test('events coalesce into one frame and unmount removes listeners, observer and pending work',()=>{
  const h=host();h.viewport.fire('resize');h.viewport.fire('scroll');h.window.fire('scroll');h.window.fire('resize');h.observers[0].callback();
  assert.equal(h.frames.size,1);assert.equal(h.viewport.count(),2);h.flush();assert.deepEqual(h.reads,['incoming-1']);
  h.viewport.fire('scroll');assert.equal(h.frames.size,1);h.unmount();
  assert.equal(h.frames.size,0);assert.equal(h.viewport.count(),0);assert.equal(h.window.count(),0);assert.equal(h.document.count(),0);assert.ok(h.observers.every(item=>item.disconnected));
  h.viewport.fire('resize');h.viewport.fire('scroll');h.window.fire('focus');h.flush();assert.deepEqual(h.reads,['incoming-1']);
});
