import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {ApiError,PortalClient} from '../../apps/portal-web/src/api.js';

// Execute the entire production module, not an extracted/copied refresh function.
// This deterministic hook host models state/ref identity, dependency comparison,
// render-before-passive-cleanup and unmount. Browser rendering is covered separately.
const compiled=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/member-inbox.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs',target:'es2023'}).code;
type Scope='messages'|'inbox';
type Policy=boolean|null;
type View={total:number|null|undefined;refresh:()=>Promise<void>};
function host(){
  const window=Object.assign(new EventTarget(),{
    setInterval:(fn:()=>void,ms:number)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},
    clearInterval:(id:number|undefined)=>{if(id!==undefined)timers.delete(id);},
  });
  const document=Object.assign(new EventTarget(),{visibilityState:'visible'}),navigator={onLine:true};
  let cursor=0,timerId=0,writes=0;
  const timers=new Map<number,{fn:()=>void;ms:number}>(),slots:any[]=[],effects=new Map<number,()=>void>();
  const same=(a:unknown[]|undefined,b:unknown[])=>a?.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const hooks={
    useState(initial:any){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;
      return [slots[index],(value:any)=>{const next=typeof value==='function'?value(slots[index]):value;if(!Object.is(next,slots[index])){writes++;slots[index]=next;}}];},
    useRef(initial:any){const index=cursor++;return slots[index]??={current:initial};},
    useCallback(fn:any,deps:unknown[]){const index=cursor++;if(!same(slots[index]?.deps,deps))slots[index]={deps,fn};return slots[index].fn;},
    useEffect(fn:()=>void|(()=>void),deps:unknown[]){const index=cursor++;if(!same(slots[index]?.deps,deps)){
      const prior=slots[index];slots[index]={deps,cleanup:prior?.cleanup};effects.set(index,()=>{prior?.cleanup?.();slots[index].cleanup=fn();});}},
  };
  const module={exports:{} as {useInboxUnread:(client:any,scope:Scope,policy:Policy)=>View}};
  runInNewContext(compiled,{module,exports:module.exports,require:(name:string)=>{if(name==='react')return hooks;if(name==='../api')return {ApiError};throw new Error(`Unexpected import ${name}`);},window,document,navigator,Event,queueMicrotask,crypto:{randomUUID}});
  return {window,document,navigator,timers,get writes(){return writes;},
    render(client:any,scope:Scope='messages',policy:Policy=false){cursor=0;return module.exports.useInboxUnread(client,scope,policy);},
    commit(){const pending=[...effects.values()];effects.clear();for(const effect of pending)effect();},
    unmount(){effects.clear();for(const slot of slots)slot?.cleanup?.();},
    visibility(value:'visible'|'hidden'){document.visibilityState=value;document.dispatchEvent(new Event('visibilitychange'));},
    event(name:string){window.dispatchEvent(new Event(name));},
    tick(){for(const timer of timers.values())timer.fn();},
  };
}
type Call={path:string;options:any;resolve:(value:any)=>void;reject:(cause:Error)=>void};
function client(){
  const calls:Call[]=[];
  return {sessionGeneration:1,calls,get(path:string,options:any){return new Promise((resolve,reject)=>calls.push({path,options,resolve,reject}));}};
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function resolve(calls:Call[],count:any=1){for(const call of calls)call.resolve({unread_count:count,guild:count,squad:count,world:count});}
async function mounted(policy:Policy=false){const h=host(),c=client();h.render(c,'messages',policy);h.commit();await settle();return {h,c};}

for(const event of ['visibility','pageshow'] as const)test(`default badge refreshes after ${event} resume without focus or a polling timer`,async()=>{
  const {h,c}=await mounted();assert.equal(c.calls.length,4);resolve(c.calls);await settle();assert.equal(h.render(c).total,4);assert.equal(h.timers.size,0);
  if(event==='visibility'){h.visibility('hidden');h.visibility('visible');}else{h.event('pagehide');h.event('pageshow');}
  await settle();assert.equal(c.calls.length,8);resolve(c.calls.slice(4),2);await settle();assert.equal(h.render(c).total,8);h.unmount();
});

test('a lifecycle event burst produces one fresh snapshot, never a hidden in-flight snapshot',async()=>{
  const {h,c}=await mounted();const older=c.calls.slice();
  h.visibility('hidden');h.visibility('visible');h.event('pageshow');h.event('focus');h.event('online');await settle();
  assert.equal(c.calls.length,8);assert.ok(c.calls.slice(4).every(call=>call.options.coalesce===true));assert.notEqual(c.calls[4].options.coalesceScope,c.calls[0].options.coalesceScope);
  resolve(c.calls.slice(4),2);await settle();assert.equal(h.render(c).total,8);
  resolve(older,9);await settle();assert.equal(h.render(c).total,8);h.unmount();
});

for(const change of ['policy-null','policy-true','client','scope','session'] as const){
  for(const outcome of ['success','error'] as const)test(`${change}: stale ${outcome} is fenced at render before effect cleanup`,async()=>{
    const {h,c}=await mounted(),old=c.calls.slice(),next=change==='client'?client():c;
    const policy=change==='policy-null'?null:change==='policy-true'?true:false,scope=change==='scope'?'inbox':'messages';
    if(change==='session')c.sessionGeneration++;
    assert.equal(h.render(next,scope,policy).total,undefined);const before=h.writes;
    if(outcome==='success')resolve(old,7);else for(const call of old)call.reject(new Error('obsolete response'));
    await settle();assert.equal(h.writes,before,'obsolete work must not publish even during the passive-effect gap');assert.equal(h.render(next,scope,policy).total,undefined);
    h.commit();await settle();const current=next.calls.filter(call=>!old.includes(call));
    if(policy===null){assert.equal(current.length,0);assert.equal(h.render(next,scope,policy).total,undefined);}
    else{resolve(current,2);await settle();assert.equal(h.render(next,scope,policy).total,8);}
    h.unmount();
  });
}

test('confirmed old policy totals disappear immediately and equal totals from the new policy still publish',async()=>{
  const {h,c}=await mounted();resolve(c.calls);await settle();assert.equal(h.render(c).total,4);
  assert.equal(h.render(c,'messages',true).total,undefined);h.commit();await settle();assert.equal(c.calls.length,6);
  resolve(c.calls.slice(4));await settle();assert.equal(h.render(c,'messages',true).total,4);
  assert.equal(h.render(c,'messages',null).total,undefined);h.commit();await settle();assert.equal(c.calls.length,6);h.unmount();
});

test('unknown policy makes no reads, no timer, and no inferred zero across lifecycle events',async()=>{
  const {h,c}=await mounted(null);h.visibility('hidden');h.visibility('visible');h.event('pageshow');h.event('focus');h.event('freedom-inbox-updated');await settle();
  assert.equal(c.calls.length,0);assert.equal(h.timers.size,0);assert.equal(h.render(c,'messages',null).total,undefined);h.unmount();
});

test('hidden, page-hidden and offline documents pause automatic reads including the enabled-policy fallback',async()=>{
  const {h,c}=await mounted(true);resolve(c.calls);await settle();assert.deepEqual([...h.timers.values()].map(timer=>timer.ms),[30000]);
  const before=c.calls.length;h.visibility('hidden');h.tick();h.event('focus');h.event('online');h.event('freedom-inbox-updated');await settle();assert.equal(c.calls.length,before);
  h.navigator.onLine=false;h.visibility('visible');h.event('pageshow');h.tick();await settle();assert.equal(c.calls.length,before);
  h.navigator.onLine=true;h.event('online');await settle();assert.equal(c.calls.length,before+2);resolve(c.calls.slice(before));await settle();
  h.event('pagehide');h.tick();h.event('focus');await settle();assert.equal(c.calls.length,before+2);h.event('pageshow');await settle();assert.equal(c.calls.length,before+4);h.unmount();
});

test('unmount removes listeners and timers and cancels queued events and pending replies',async()=>{
  const {h,c}=await mounted(true);h.event('focus');h.unmount();const before=h.writes;resolve(c.calls);await settle();
  assert.equal(h.writes,before);assert.equal(h.timers.size,0);assert.equal(c.calls.length,2);
  h.visibility('hidden');h.visibility('visible');h.event('pagehide');h.event('pageshow');h.event('online');h.event('focus');h.event('freedom-inbox-updated');h.tick();await settle();assert.equal(c.calls.length,2);
});

for(const policy of [false,true] as const)test(`policy ${policy}: malformed counts and failed reads remain unconfirmed, never zero`,async()=>{
  const {h,c}=await mounted(policy);const width=policy?2:4;
  for(const invalid of [null,undefined,-1,0.5,Number.MAX_SAFE_INTEGER]){
    const start=c.calls.length-width;for(const call of c.calls.slice(start))call.resolve({unread_count:invalid,guild:invalid,squad:invalid,world:invalid});await settle();assert.equal(h.render(c,'messages',policy).total,null);
    h.event('focus');await settle();
  }
  for(const call of c.calls.slice(-width))call.reject(new Error('unavailable'));await settle();assert.equal(h.render(c,'messages',policy).total,null);
  h.event('focus');await settle();resolve(c.calls.slice(-width),0);await settle();assert.equal(h.render(c,'messages',policy).total,0);h.unmount();
});

test('real PortalClient keeps later-task focus in the fresh resume epoch, never the pre-hide transport',async t=>{
  const pending:{path:string;resolve:(response:Response)=>void}[]=[];
  t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{
    assert.equal(init?.method,'GET');return new Promise<Response>(resolve=>pending.push({path:String(input),resolve}));
  });
  const h=host(),c=new PortalClient();t.after(()=>{h.unmount();for(const request of pending)request.resolve(Response.json({unread_count:0}));});h.render(c);h.commit();await settle();assert.equal(pending.length,4);
  h.event('focus');await settle();const ordinary=h.render(c).refresh();await settle();assert.equal(pending.length,4);
  h.visibility('hidden');h.visibility('visible');h.event('pageshow');await settle();assert.equal(pending.length,8);
  // A separate event task after resume has started, not part of its microtask burst.
  h.event('focus');await settle();assert.equal(pending.length,8,'later focus shares the fresh transport, not the old one');
  for(const request of pending.slice(4))request.resolve(Response.json({unread_count:2}));await settle();assert.equal(h.render(c).total,8);
  for(const request of pending.slice(0,4))request.resolve(Response.json({unread_count:9}));await ordinary;await settle();assert.equal(h.render(c).total,8);
  assert.ok(pending.every(request=>/\/me\/(conversations\?limit=1&offset=0|channels\?kind=(guild|squad|world)&limit=1&offset=0)$/.test(request.path)),'no history or read-receipt requests');h.unmount();
});

for(const offlineAt of ['before-resume','after-scheduling'] as const)test(`real PortalClient: offline ${offlineAt} retains the fresh resume epoch until online`,async t=>{
  const pending:{path:string;resolve:(response:Response)=>void}[]=[];
  t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{
    assert.equal(init?.method,'GET');return new Promise<Response>(resolve=>pending.push({path:String(input),resolve}));
  });
  const h=host(),c=new PortalClient();
  t.after(()=>{h.unmount();for(const request of pending)request.resolve(Response.json({unread_count:0}));});
  h.render(c);h.commit();await settle();assert.equal(pending.length,4);
  h.visibility('hidden');
  if(offlineAt==='before-resume')h.navigator.onLine=false;
  h.visibility('visible');
  // For this variant, the resume microtask was queued while online but must pause.
  if(offlineAt==='after-scheduling')h.navigator.onLine=false;
  await settle();assert.equal(pending.length,4,'offline resume must not issue transport');
  h.navigator.onLine=true;h.event('online');await settle();
  assert.equal(pending.length,8,'online must start a new snapshot, not borrow pre-hide work');
  h.event('focus');await settle();assert.equal(pending.length,8,'ordinary overlap shares only the resumed snapshot');
  for(const request of pending.slice(4))request.resolve(Response.json({unread_count:2}));await settle();assert.equal(h.render(c).total,8);
  for(const request of pending.slice(0,4))request.resolve(Response.json({unread_count:9}));await settle();assert.equal(h.render(c).total,8,'late pre-hide snapshot cannot overwrite the confirmed count');
});
