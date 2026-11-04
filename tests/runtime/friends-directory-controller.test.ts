import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {performModuleMutation} from '../../apps/portal-web/src/modules/shared.js';
import {ApiError} from '../../apps/portal-web/src/api.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFriendsDirectory,requireFriendsPage,type FriendsPage} from '../../apps/portal-web/src/modules/friends-directory-controller.js';

type Item={user_id:string};
const page=(ids:string[]=[],total=ids.length,next_offset:number|null=null):FriendsPage<Item>=>({items:ids.map(user_id=>({user_id})),total,next_offset});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function flush(){for(let step=0;step<12;step++)await Promise.resolve();}
function fixture(initialScope:'accepted'|'incoming'='accepted'){
  let generation=1,nextTimer=1;
  const timers=new Map<number,{callback:()=>void;delay:number}>();
  const requests:{query:URLSearchParams;signal:AbortSignal;task:ReturnType<typeof deferred<FriendsPage<Item>>>}[]=[];
  const controller=createFriendsDirectory<Item>({initialScope,generation:()=>generation,
    clock:{schedule(callback,delay){const id=nextTimer++;timers.set(id,{callback,delay});return id;},cancel(handle){timers.delete(handle as number);}},
    read(query,signal){const task=deferred<FriendsPage<Item>>();requests.push({query,signal,task});return task.promise;},
  });
  return {controller,requests,timers,rotate(){generation++;},tick(){const due=[...timers.values()];timers.clear();due.forEach(timer=>timer.callback());}};
}
async function started(initialScope:'accepted'|'incoming'='accepted'){
  const f=fixture(initialScope);f.controller.start();await flush();return f;
}
async function ready(value=page(['a'])){
  const f=await started();f.requests[0].task.resolve(value);await flush();return f;
}

test('initial list dispatches without a debounce and publishes a stable snapshot',async()=>{
  const f=await started();assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
  assert.equal(f.controller.getSnapshot().status,'loading');
  assert.strictEqual(f.controller.getSnapshot(),f.controller.getSnapshot());
  assert.equal(f.requests[0].query.toString(),'scope=accepted&search=&offset=0&limit=20');
});
test('initial incoming scope is respected',async()=>{const f=await started('incoming');assert.equal(f.requests[0].query.get('scope'),'incoming');});
test('start is idempotent while mounted',async()=>{const f=await started();f.controller.start();await flush();assert.equal(f.requests.length,1);});
test('text edits clear private results immediately and debounce only the latest draft',async()=>{
  const f=await ready();f.controller.input('小');f.controller.input('小明');assert.equal(f.controller.getSnapshot().page,null);
  assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,250);assert.equal(f.requests.length,1);
  f.tick();await flush();assert.equal(f.requests.length,2);assert.equal(f.requests[1].query.get('search'),'小明');
});
test('Enter flushes text debounce without sending a second request later',async()=>{
  const f=await ready();f.controller.input('小明');void f.controller.submit();await flush();assert.equal(f.timers.size,0);
  f.tick();await flush();assert.equal(f.requests.length,2);
});
test('repeated explicit searches share an in-flight read but completed searches revalidate',async()=>{
  const f=await started();const first=f.controller.submit(),second=f.controller.submit();assert.strictEqual(first,second);
  assert.equal(f.requests.length,1);f.requests[0].task.resolve(page());await first;
  void f.controller.submit();await flush();assert.equal(f.requests.length,2);
});
test('a filter switch with nonempty search has no artificial text delay',async()=>{
  const f=await ready();f.controller.input('夥伴');void f.controller.selectScope('incoming');await flush();
  assert.equal(f.timers.size,0);assert.equal(f.requests[1].query.get('scope'),'incoming');assert.equal(f.requests[1].query.get('search'),'夥伴');
});
test('composition never searches partial characters and duplicate end input is harmless',async()=>{
  const f=await ready();f.controller.compositionStart();f.controller.input('ㄒ');f.tick();await flush();
  void f.controller.submit();void f.controller.selectScope('outgoing');assert.equal(f.requests.length,1);
  assert.equal(f.controller.getSnapshot().page,null);assert.equal(f.controller.getSnapshot().scope,'accepted');
  f.controller.input('小明');f.controller.compositionEnd('小明');f.controller.input('小明');f.tick();await flush();
  assert.equal(f.requests.length,2);assert.equal(f.requests[1].query.get('search'),'小明');
});
test('composition can return to the same committed term after cancelling the previous read',async()=>{
  const f=await ready();f.controller.input('明');f.tick();await flush();f.controller.compositionStart();assert.equal(f.requests[1].signal.aborted,true);
  f.controller.compositionEnd('明');f.tick();await flush();assert.equal(f.requests.length,3);
});
test('whitespace-only edits do not reset an identical search or create requests',async()=>{
  const f=await ready();f.controller.input('  ');assert.equal(f.controller.getSnapshot().draft,'  ');assert.equal(f.timers.size,0);assert.equal(f.requests.length,1);
});
test('clear commits an empty search immediately and resets offset',async()=>{
  const f=await ready();f.controller.input('name');void f.controller.clear();await flush();
  assert.equal(f.requests[1].query.get('search'),'');assert.equal(f.controller.getSnapshot().draft,'');assert.equal(f.timers.size,0);
});
test('changing conditions aborts the transport and ignores old success',async()=>{
  const f=await started();void f.controller.selectScope('incoming');await flush();assert.equal(f.requests[0].signal.aborted,true);
  f.requests[1].task.resolve(page(['new']));await flush();f.requests[0].task.resolve(page(['old']));await flush();
  assert.deepEqual(f.controller.getSnapshot().page?.items,[{user_id:'new'}]);
});
test('late failures cannot replace a newer success',async()=>{
  const f=await started();void f.controller.selectScope('outgoing');await flush();f.requests[1].task.resolve(page(['new']));await flush();
  f.requests[0].task.reject(new Error('old failure'));await flush();assert.equal(f.controller.getSnapshot().status,'ready');
});
test('scope cancellation before the request microtask sends only the latest read',async()=>{
  const f=fixture();f.controller.start();void f.controller.selectScope('incoming');void f.controller.selectScope('outgoing');await flush();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].query.get('scope'),'outgoing');
});
test('opening blocked scope cancels friend reads without requesting a fake blocked directory',async()=>{
  const f=await started();void f.controller.selectScope('blocked');await flush();assert.equal(f.requests[0].signal.aborted,true);
  assert.equal(f.controller.getSnapshot().status,'blocked');void f.controller.refreshAfterMutation();void f.controller.submit();f.controller.input('ignored');await flush();
  assert.equal(f.requests.length,1);assert.equal(f.controller.getSnapshot().page,null);
  void f.controller.selectScope('accepted');await flush();assert.equal(f.requests.length,2);
});
test('stop aborts a pending read and drops delayed results',async()=>{
  const f=await started();f.controller.stop();assert.equal(f.requests[0].signal.aborted,true);f.requests[0].task.resolve(page(['old']));await flush();
  assert.equal(f.controller.getSnapshot().page,null);assert.equal(f.controller.isCurrent(),false);
});
test('stop cancels a scheduled text search',async()=>{const f=await ready();f.controller.input('draft');f.controller.stop();f.tick();await flush();assert.equal(f.requests.length,1);});
test('StrictMode-style cleanup and setup can start a new read',async()=>{
  const f=await started();f.controller.stop();f.controller.start();await flush();assert.equal(f.requests.length,2);assert.equal(f.requests[1].signal.aborted,false);
  f.requests[0].task.resolve(page(['old']));f.requests[1].task.resolve(page(['current']));await flush();assert.deepEqual(f.controller.getSnapshot().page?.items,[{user_id:'current'}]);
});
test('session rotation hides old private data and prevents new operations',async()=>{
  const f=await ready();f.rotate();assert.equal(f.controller.getSnapshot().page,null);void f.controller.submit();f.controller.input('new');await flush();assert.equal(f.requests.length,1);
});
test('a pending response from a previous session cannot publish',async()=>{
  const f=await started();f.rotate();f.requests[0].task.resolve(page(['secret']));await flush();assert.equal(f.controller.getSnapshot().page,null);
});
test('an error is not a confirmed empty list and a retry is immediate',async()=>{
  const f=await started();f.requests[0].task.reject(new Error('offline'));await flush();assert.equal(f.controller.getSnapshot().status,'error');assert.equal(f.controller.getSnapshot().page,null);
  void f.controller.submit();await flush();assert.equal(f.timers.size,0);f.requests[1].task.resolve(page());await flush();assert.equal(f.controller.getSnapshot().status,'ready');
});
for(const error of [{status:401},{status:403},{accessExpired:true},new Error('offline')]){
  test(`revalidation clears old contact details on ${JSON.stringify(error)}`,async()=>{
    const f=await ready();void f.controller.submit();assert.equal(f.controller.getSnapshot().page,null);await flush();f.requests[1].task.reject(error);await flush();
    assert.equal(f.controller.getSnapshot().page,null);assert.equal(f.controller.getSnapshot().status,'error');
  });
}
test('next page is immediate and rapid repeated clicks cannot skip a page',async()=>{
  const f=await ready(page(['a'],21,20));void f.controller.next();void f.controller.next();await flush();
  assert.equal(f.requests.length,2);assert.equal(f.requests[1].query.get('offset'),'20');assert.equal(f.timers.size,0);
  f.requests[1].task.resolve(page(['b'],21));await flush();assert.equal(f.controller.getSnapshot().focusRevision,1);
});
test('pagination with a search term does not wait for typing debounce',async()=>{
  const f=await ready();f.controller.input('明');void f.controller.submit();await flush();f.requests[1].task.resolve(page(['a'],21,20));await flush();
  void f.controller.next();await flush();assert.equal(f.timers.size,0);assert.equal(f.requests[2].query.get('search'),'明');assert.equal(f.requests[2].query.get('offset'),'20');
});
test('failed later pages can retry the same offset or go back',async()=>{
  const f=await ready(page(['a'],21,20));void f.controller.next();await flush();f.requests[1].task.reject(new Error('offline'));await flush();
  void f.controller.submit();await flush();assert.equal(f.requests[2].query.get('offset'),'20');f.requests[2].task.reject(new Error('offline'));await flush();
  void f.controller.previous();await flush();assert.equal(f.requests[3].query.get('offset'),'0');
});
test('switching scope resets pagination and the focus revision changes only after paging succeeds',async()=>{
  const f=await ready(page(['a'],21,20));void f.controller.next();await flush();f.requests[1].task.resolve(page(['b'],21));await flush();
  void f.controller.selectScope('incoming');await flush();assert.equal(f.requests[2].query.get('offset'),'0');f.requests[2].task.resolve(page());await flush();assert.equal(f.controller.getSnapshot().focusRevision,1);
});
test('successful mutation replaces a pre-write read even for the same query',async()=>{
  const f=await started();const fresh=f.controller.refreshAfterMutation();await flush();assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.requests.length,2);
  f.requests[0].task.resolve(page(['removed']));await flush();assert.equal(f.controller.getSnapshot().page,null);
  f.requests[1].task.resolve(page());await fresh;assert.deepEqual(f.controller.getSnapshot().page,page());
});
test('mutation refresh follows the current scope rather than the scope of the clicked invite',async()=>{
  const f=await started('incoming');void f.controller.selectScope('accepted');await flush();void f.controller.refreshAfterMutation();await flush();
  assert.equal(f.requests[2].query.get('scope'),'accepted');assert.equal(f.requests[1].signal.aborted,true);
});
test('deleting the last item on the final page corrects to the last valid page once',async()=>{
  const f=await ready(page(['a'],21,20));void f.controller.next();await flush();f.requests[1].task.resolve(page(['b'],21));await flush();
  void f.controller.refreshAfterMutation();await flush();f.requests[2].task.resolve(page([],20));await flush();
  assert.equal(f.requests[3].query.get('offset'),'0');f.requests[3].task.resolve(page(['a'],20));await flush();assert.equal(f.controller.getSnapshot().offset,0);
});
test('automatic offset correction is bounded when a list shrinks twice',async()=>{
  const f=await ready(page(['a'],41,40));void f.controller.next();await flush();f.requests[1].task.resolve(page([],21));await flush();
  assert.equal(f.requests[2].query.get('offset'),'20');f.requests[2].task.resolve(page([],0));await flush();
  assert.equal(f.requests.length,3);assert.equal(f.controller.getSnapshot().status,'ready');
});
test('unsubscribed listeners do not receive state updates',async()=>{
  const f=await ready();let calls=0;const unsubscribe=f.controller.subscribe(()=>calls++);f.controller.input('a');assert.ok(calls>0);unsubscribe();const before=calls;f.controller.clear();await flush();assert.equal(calls,before);
});
test('malformed pagination cannot masquerade as an empty result',async()=>{
  const f=await started();f.requests[0].task.resolve({items:[],total:0} as unknown as FriendsPage<Item>);await flush();assert.equal(f.controller.getSnapshot().status,'error');
});
test('page metadata rejects negative totals, loops and oversized pages',()=>{
  for(const value of [{items:[],total:-1,next_offset:null},{items:[],total:21,next_offset:0},{items:[],total:21,next_offset:21},
    {items:Array(21).fill({user_id:'a'}),total:21,next_offset:null},{items:[{user_id:'a'}],total:0,next_offset:null}])assert.throws(()=>requireFriendsPage(value,0));
  assert.deepEqual(requireFriendsPage(page([],0),20),page([],0));
});

// Execute the actual FriendsPanel handlers with the real command-key implementation.
// These are source/handler contracts, not a substitute for rendered browser coverage.
const root=process.cwd();
const source=readFileSync(`${root}/apps/portal-web/src/modules/FriendsPanel.tsx`,'utf8');
const actSource=stripTypeScriptTypes(source.slice(source.indexOf('function confirmedFriendAction('),source.indexOf('type Props='))+source.slice(source.indexOf('  function act('),source.indexOf('  function changeScope(')));
function harness(refusal=412){
 const calls:{path:string;body:unknown;options:any}[]=[],notices:string[]=[];let current=true;
 const state={keys:new Map<string,string>(),snapshot:{busy:false,error:null,lastFailureUnknown:false},listeners:new Set<()=>void>(),live:()=>true};
 const client={post:async(path:string,body:unknown,options:any)=>{calls.push({path,body,options});if(calls.length===1)throw new ApiError({message:'Synthetic lost response',network:true});if(calls.length===2)throw new ApiError({message:'Synthetic refusal',status:refusal,definitiveResponse:true});return{state:'removed',aggregate_version:'8'};}};
 const context:any={actionInFlight:{current:false},busy:false,lastFailureUnknown:false,lastAction:null,directory:{isCurrent:()=>current,refreshAfterMutation:async()=>{}},setLastAction:(value:any)=>context.lastAction=value,setNotice:(value:string)=>notices.push(value),setActionTarget:()=>{},setConfirming:()=>{},announceInboxChange:()=>{},mutate:(path:string,body:unknown,version:number|undefined,decode:(value:unknown)=>unknown)=>performModuleMutation(client as any,state,path,body,version,decode)};
 const {act,sendAction}=runInNewContext(actSource+';({act,sendAction})',context);
 return {calls,notices,context,state,act,sendAction,expire:()=>current=false,sync:()=>{context.busy=state.snapshot.busy;context.lastFailureUnknown=state.snapshot.lastFailureUnknown;}};
}
for(const refusal of [403,404,412])test(`unknown removal survives ${refusal}, uses immutable primitive snapshot and original key`,async()=>{
 const h=harness(refusal),member={user_id:'original',nickname:'Fixture',friendship:{aggregate_version:7}};
 await h.act(member,'remove');h.sync();assert.equal(h.context.lastFailureUnknown,true);
 const command=h.context.lastAction;assert.equal(Object.isFrozen(command),true);
 member.user_id='changed';member.friendship.aggregate_version=99;
 await h.act(member,'accept');assert.equal(h.calls.length,1);
 await h.sendAction({...command},true);assert.equal(h.calls.length,1);
 await h.sendAction(command,true);h.sync();assert.equal(h.context.lastFailureUnknown,true);
 assert.equal(h.context.lastAction,command);assert.equal(h.state.keys.size,1);
 await h.act(member,'remove');assert.equal(h.calls.length,2);
 await h.sendAction(command,true);h.sync();
 assert.equal(h.calls.length,3);
 for(const call of h.calls){assert.equal(call.path,'/friends/original/remove');assert.equal(call.options.idempotencyKey,h.calls[0].options.idempotencyKey);assert.equal(call.options.ifMatch,7);}
 assert.equal(h.context.lastAction,null);assert.equal(h.state.keys.size,0);
});
test('same-tick repeated actions cannot replace the in-flight command snapshot',async()=>{
 const h=harness(),member={user_id:'original',nickname:'Fixture',friendship:{aggregate_version:7}};
 const first=h.act(member,'remove');const second=h.act({user_id:'other',nickname:'Other',friendship:{aggregate_version:99}},'accept');
 await Promise.all([first,second]);h.sync();assert.equal(h.calls.length,1);assert.equal(h.context.lastAction.userId,'original');assert.equal(h.context.actionInFlight.current,false);
});
test('expired directory cannot replay retained command',async()=>{
 const h=harness(),member={user_id:'original',nickname:'Fixture',friendship:{aggregate_version:7}};
 await h.act(member,'remove');h.sync();h.expire();await h.sendAction(h.context.lastAction,true);assert.equal(h.calls.length,1);
});
test('pending and unknown recovery remain outside results and settings; cancel is locked while unresolved',()=>{
 const recovery=source.indexOf('確認原操作結果'),results=source.indexOf('<section ref={results}'),details=source.indexOf('<details className="friends-manage">');
 assert.ok(recovery>0&&recovery<results&&results<details);
 assert.match(source,/busy&&actionTarget&&<p role="status">/);
 assert.match(source,/disabled=\{writesLocked\} onClick=\{\(\)=>\{setConfirming\(null\);document.getElementById\(id\)\?\.focus\(\);\}\}>取消/);
 assert.match(source,/lastFailureUnknown&&lastAction/);
});
test('empty/search recovery preserves scope, focus and true incoming/outgoing semantics',()=>{
 assert.match(source,/incoming:\{hint:.*等你回覆/);assert.match(source,/outgoing:\{hint:.*等對方回覆/);
 assert.match(source,/directory\.clear\(\);input\.current\?\.focus\(\);\}\}>查看這份完整名單/);
 assert.match(source,/view.status==='ready'&&page/);assert.match(source,/memberBlockingEnabled&&visitedBlocked&&<div hidden=\{scope!=='blocked'\}/);
});
