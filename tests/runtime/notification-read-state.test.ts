import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {transformSync} from 'esbuild';
import {PortalClient} from '../../apps/portal-web/src/api.js';

// Execute actual UI closures. This proves command/response ordering, not React rendering or browser navigation.
function sourceFunction(file:string,name:string){
  const source=transformSync(readFileSync(new URL(`../../apps/portal-web/src/modules/${file}`,import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm'}).code;
  const start=new RegExp(`^( *)(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(start);
  const tail=source.slice(start.index),end=new RegExp(`^${start[1]}}`,'m').exec(tail);assert.ok(end);
  return tail.slice(0,end.index+end[0].length);
}
const item={notification_id:'10000000-0000-4000-8000-000000000001',read_at:null,action:{tab:'guilds',resource_id:null}};
const ack={notification_id:item.notification_id,read_at:'2026-10-24T06:00:00Z'};
type Call={path:string;key?:string;options:any;resolve:(value:any)=>void;reject:(error:Error)=>void};
function harness(mode:'bell'|'history'){
  const calls:Call[]=[],events:string[]=[],navigations:any[]=[],counts:any[]=[];
  const state:any={readProofs:{current:new Map()},keepReadProofs:(records:any)=>records,readRequests:{current:0},readIntents:{current:new Map()},reconcileReads:()=>{},readScope:{current:{id:"synthetic-preview",epoch:0}},keys:{current:new Map()},lifetime:{current:0},writeLock:{current:null},unknownReads:{current:new Set()},readLocks:{current:new Set()},generation:{current:0},badgeGeneration:{current:0},readGeneration:{current:0},readFailure:{current:null},unreadGeneration:{current:0},alive:{current:true},busy:mode==='bell'?null:{},inFlight:{current:null},crypto:{randomUUID},preferencesEnabled:false,
    unread:1,page:{items:[item],unread_count:1},items:[item],actionError:null,itemErrors:{},loading:false,error:false,
    reconcileRead:()=>{},dismissReadError:()=>{state.actionError=null;state.readFailure.current=null;},setBusy:(next:any)=>{state.busy=typeof next==='function'?next(state.busy):next},setActionError:(value:any)=>state.actionError=value,
    setPage:(fn:any)=>state.page=typeof fn==='function'?fn(state.page):fn,setItems:(fn:any)=>state.items=typeof fn==='function'?fn(state.items):fn,setItemErrors:(fn:any)=>state.itemErrors=fn(state.itemErrors),
    setUnread:(value:any)=>state.unread=value,setMore:()=>{},setOpen:()=>{},setShowAll:()=>{},setLoading:(value:any)=>state.loading=value,setError:(value:any)=>state.error=value,
    validAction:(action:any)=>action,onNavigate:(action:any)=>navigations.push(action),go:(action:any)=>navigations.push(action),
    announceInboxChange:()=>events.push('refresh'),load:()=>events.push('list'),refreshUnread:()=>events.push('count'),
    onUnread:()=>(count:any)=>counts.push(count),unconfirmed:()=>true,fail:(cause:Error)=>cause.message,
    client:{sessionGeneration:1,post:(path:string,_body:any,options:any)=>new Promise((resolve,reject)=>calls.push({path,key:options.idempotencyKey,options,resolve,reject})),get:(path:string,options:any)=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject}))},
  };
  state.scope={current:{client:state.client,session:1,preferencesEnabled:false}};
  const name=mode==='bell'?'choose':'markRead';
  const invoke=runInNewContext(`${sourceFunction(mode==='bell'?'NotificationBell.tsx':'MemberMessages.tsx',name)};${name}`,state);
  return {state,calls,events,navigations,counts,invoke};
}
for(const mode of ['bell','history'] as const){
  test(`${mode}: same-render duplicate activation issues exactly one notification command`,async()=>{
    const h=harness(mode),pending=h.invoke(item);await h.invoke(item);assert.equal(h.calls.length,1);
    assert.equal(h.calls[0].path,`/me/notifications/${item.notification_id}/read`);
    h.calls[0].resolve(ack);await pending;assert.equal(h.events.filter(x=>x==='refresh').length,1);
  });
  test(`${mode}: old account acknowledgement cannot refresh, navigate, or replace the new account`,async()=>{
    const h=harness(mode),pending=h.invoke(item,mode==='bell'?true:item.action);h.state.client.sessionGeneration++;
    h.calls[0].resolve(ack);await pending;assert.equal(h.events.length,0);assert.equal(h.navigations.length,0);assert.equal(h.state.items[0].read_at,null);
  });
  test(`${mode}: a replaced client rejects a late acknowledgement even with the same generation`,async()=>{
    const h=harness(mode),pending=h.invoke(item);h.state.scope.current={client:{sessionGeneration:1},session:1};h.calls[0].resolve(ack);await pending;
    assert.equal(h.events.length,0);assert.equal(h.navigations.length,0);
  });
  test(`${mode}: lost acknowledgement is only retried manually with the original key`,async()=>{
    const h=harness(mode),pending=h.invoke(item);h.calls[0].reject(new Error('response lost'));await pending;
    assert.equal(h.calls.length,1);assert.equal(h.state.page.unread_count,1);
    const retry=h.invoke(item,mode==='bell'?false:undefined);assert.equal(h.calls[1].key,h.calls[0].key);
    const before=h.navigations.length;h.calls[1].resolve(ack);await retry;assert.equal(h.navigations.length,before);
  });
}
test('bell: confirmed acknowledgement never guesses count-minus-one, including concurrent notices',async()=>{
  const h=harness('bell'),pending=h.invoke(item);h.state.page={items:[item,{...item,notification_id:'new'}],unread_count:2};h.calls[0].resolve(ack);await pending;
  assert.equal(h.state.page.unread_count,2);assert.equal(h.state.page.items[0].read_at,ack.read_at);assert.equal(h.state.page.items[1].read_at,null);
});
test('bell: failed acknowledgement keeps a scoped retry after the normal navigation',async()=>{
  const h=harness('bell'),pending=h.invoke(item);h.calls[0].reject(new Error('offline'));await pending;
  assert.equal(h.navigations.length,1);assert.equal(h.state.actionError.item.notification_id,item.notification_id);assert.equal(h.state.actionError.client,h.state.client);assert.equal(h.state.actionError.session,1);
});
test('history: a same-account acknowledgement after closing still refreshes the shell, never navigates',async()=>{
  const h=harness('history'),pending=h.invoke(item,item.action);h.state.alive.current=false;h.calls[0].resolve(ack);await pending;
  assert.deepEqual(h.events,['refresh']);assert.equal(h.navigations.length,0);
});
test('history: acknowledgement fences a pre-write pagination snapshot',async()=>{
  const h=harness('history'),pending=h.invoke(item);h.calls[0].resolve(ack);await pending;assert.equal(h.state.generation.current,1);
});
test('history: stale and old-session count reads cannot overwrite a newer authoritative count',async()=>{
  const h=harness('history');const refresh=runInNewContext(`${sourceFunction('MemberMessages.tsx','refreshUnread')};refreshUnread`,h.state);
  const old=refresh(),fresh=refresh();h.calls[1].resolve({unread_count:2});await fresh;h.calls[0].resolve({unread_count:0});await old;assert.deepEqual(h.counts,[2]);
  const switched=refresh();h.state.client.sessionGeneration++;h.calls[2].resolve({unread_count:0});await switched;assert.deepEqual(h.counts,[2]);
});
test('history: a failed count refresh reports unknown without resending an acknowledged write',async()=>{
  const h=harness('history');const refresh=runInNewContext(`${sourceFunction('MemberMessages.tsx','refreshUnread')};refreshUnread`,h.state);
  const pending=refresh();h.calls[0].reject(new Error('offline'));await pending;assert.deepEqual(h.counts,[null]);assert.equal(h.calls[0].key,undefined);
});

test('bell: post-write refresh refuses coalescing and rejects an older snapshot',async()=>{
  const h=harness('bell');const source=readFileSync(new URL('../../apps/portal-web/src/modules/NotificationBell.tsx',import.meta.url),'utf8');
  const begin=source.indexOf('const refresh=useCallback(')+'const refresh=useCallback('.length;
  const end=source.indexOf(',[client,preferencesEnabled,sessionGeneration]);',begin);assert.ok(end>begin);
  const refresh=runInNewContext(transformSync(`(${source.slice(begin,end)})`,{loader:'ts',format:'cjs'}).code,h.state);
  const older=refresh(),afterAck=refresh(true);assert.notEqual(h.calls[0].options.coalesceScope,h.calls[1].options.coalesceScope);
  h.calls[1].resolve({items:[item],unread_count:2});await afterAck;h.calls[0].resolve({items:[item],unread_count:0});await older;
  assert.equal(h.state.unread,2);
});

test('history: a refusal after an unknown acknowledgement retains the original intent key',async()=>{
  const h=harness('history'),first=h.invoke(item);h.calls[0].reject(new Error('lost'));await first;
  h.state.unconfirmed=()=>false;const retry=h.invoke(item);h.calls[1].reject(new Error('refused retry'));await retry;
  const again=h.invoke(item);assert.equal(h.calls[2].key,h.calls[0].key);h.calls[2].resolve(ack);await again;
});

test('history: delayed pagination cannot undo a confirmed read or replace its total',async()=>{
  const h=harness('history');Object.assign(h.state,{nextOffset:20,more:{loading:false},PAGE:20,setNextOffset:()=>{},merge:(a:any[],b:any[],id:(x:any)=>string)=>[...a,...b.filter(x=>!a.some(y=>id(x)===id(y)))]});
  const more=runInNewContext(`${sourceFunction('MemberMessages.tsx','loadMore')};loadMore`,h.state);
  const old=more(),write=h.invoke(item);h.calls[1].resolve(ack);await write;
  h.calls[0].resolve({items:[{...item,notification_id:'older'}],unread_count:99,next_offset:null});await old;
  assert.equal(h.state.items.length,1);assert.equal(h.state.items[0].read_at,ack.read_at);assert.deepEqual(h.counts,[]);
});
for(const outcome of ['success','failure'] as const)test(`history: old account count ${outcome} is discarded`,async()=>{
  const h=harness('history');const refresh=runInNewContext(`${sourceFunction('MemberMessages.tsx','refreshUnread')};refreshUnread`,h.state);
  const pending=refresh();h.state.client.sessionGeneration++;if(outcome==='success')h.calls[0].resolve({unread_count:0});else h.calls[0].reject(new Error('old failure'));await pending;assert.deepEqual(h.counts,[]);
});

function bellCallback(name:string,dependencies:string,state:any){
  const source=readFileSync(new URL('../../apps/portal-web/src/modules/NotificationBell.tsx',import.meta.url),'utf8');
  const marker=`const ${name}=useCallback(`,begin=source.indexOf(marker)+marker.length;
  const end=source.indexOf(`,[${dependencies}]);`,begin);assert.ok(end>begin);
  return runInNewContext(transformSync(`(${source.slice(begin,end)})`,{loader:'ts',format:'cjs'}).code,state);
}
function sharedCounts(){
  const h=harness('bell');h.state.scope.current.preferencesEnabled=false;
  h.state.refresh=bellCallback('refresh','client,preferencesEnabled,sessionGeneration',h.state);
  const begin=bellCallback('beginUnread','client,preferencesEnabled,refresh',h.state);
  return {...h,begin,refresh:h.state.refresh};
}
test('shared badge authority: late full-history count cannot undo a newer bell count',async()=>{
  const h=sharedCounts(),publishOld=h.begin();const newer=h.refresh(true);
  h.calls[0].resolve({items:[],unread_count:2});await newer;publishOld(0);assert.equal(h.state.unread,2);
});
test('shared badge authority: late bell count cannot undo a newer history count',async()=>{
  const h=sharedCounts(),old=h.refresh(),publishNew=h.begin();publishNew(2);
  h.calls[0].resolve({items:[],unread_count:0});await old;assert.equal(h.state.unread,2);assert.equal(h.calls.length,1);
});
test('shared badge authority: previous preference policy cannot publish an unfiltered history count',()=>{
  const h=sharedCounts(),publishOld=h.begin();h.state.scope.current.preferencesEnabled=true;publishOld(99);assert.equal(h.state.unread,1);assert.equal(h.calls.length,0);
});
for(const mode of ['bell','history'] as const)for(const response of [null,{}, {read_at:''}, {read_at:'not-a-date'}, {...ack,notification_id:'wrong-notification'}])test(`${mode}: malformed acknowledgement ${JSON.stringify(response)} stays unconfirmed`,async()=>{
  const h=harness(mode),pending=h.invoke(item);h.calls[0].resolve(response);await pending;
  assert.equal(h.events.length,0);assert.equal(h.state.items[0].read_at,null);assert.equal(h.state.page.items[0].read_at,null);
  const retry=h.invoke(item,mode==='bell'?false:undefined);assert.equal(h.calls[1].key,h.calls[0].key);
  const previous=h.navigations.length;h.calls[1].resolve(ack);await retry;assert.equal(h.navigations.length,previous);
});

for(const focused of [true,false])test(`bell: dismiss returns focus only from its own alert, focused=${focused}`,()=>{
  const h=harness('bell');let restored=0;h.state.readError={current:{contains:()=>focused}};h.state.document={activeElement:{}};h.state.trigger={current:{focus:()=>restored++}};
  const dismiss=runInNewContext(`${sourceFunction('NotificationBell.tsx','dismissReadError')};dismissReadError`,h.state);
  dismiss();assert.equal(restored,focused?1:0);h.state.client.sessionGeneration++;dismiss();assert.equal(restored,focused?1:0);
});
test('bell: retry retains its alert while pending instead of removing the focused control',async()=>{
  const h=harness('bell');const error={item,client:h.state.client,session:1};h.state.actionError=error;const retry=h.invoke(item,false);
  assert.equal(h.state.actionError,error);assert.equal(h.state.busy,item.notification_id);h.calls[0].resolve(ack);await retry;assert.equal(h.state.actionError,null);
});

test('bell: an old-policy response is fenced before the effect cleanup runs',async()=>{
  const h=sharedCounts(),pending=h.refresh();h.state.scope.current.preferencesEnabled=true;
  h.calls[0].resolve({items:[],unread_count:99});await pending;assert.equal(h.state.unread,1);
});
test('bell: confirmed preference and inbox events each start one fresh read, focus remains coalescible',()=>{
  const source=readFileSync(new URL('../../apps/portal-web/src/modules/NotificationBell.tsx',import.meta.url),'utf8');
  const marker='const update=',start=source.indexOf(marker)+marker.length,end=source.indexOf(';',start);const calls:boolean[]=[];
  const update=runInNewContext(transformSync(`(${source.slice(start,end)})`,{loader:'ts',format:'cjs'}).code,{INBOX_UPDATED:'inbox',refresh:(fresh:boolean)=>calls.push(fresh)});
  update({type:'freedom-notification-preferences-updated'});update({type:'inbox'});update({type:'focus'});assert.deepEqual(calls,[true,true,false]);
});

function historyLoad(state:any){
  const source=readFileSync(new URL('../../apps/portal-web/src/modules/MemberMessages.tsx',import.meta.url),'utf8');
  const marker='const load=useCallback(',begin=source.indexOf(marker,source.indexOf('export function Notifications('))+marker.length,end=source.indexOf(',[client,onUnread,sessionGeneration]);',begin);assert.ok(end>begin);
  return runInNewContext(transformSync(`(${source.slice(begin,end)})`,{loader:'ts',format:'cjs'}).code,state);
}
for(const mode of ['initial','pagination'] as const)test(`history: latest ${mode} failure reports unknown, then retry restores a real count`,async()=>{
  const h=harness('history');Object.assign(h.state,{PAGE:20,nextOffset:20,more:{loading:false},setNextOffset:()=>{},setStatus:()=>{},setRefresh:()=>{},merge:(a:any[],b:any[])=>[...a,...b]});
  const read=mode==='initial'?historyLoad(h.state):runInNewContext(`${sourceFunction('MemberMessages.tsx','loadMore')};loadMore`,h.state);
  const first=read();h.calls[0].reject(new Error('offline'));await first;assert.deepEqual(h.counts,[null]);
  const retry=read();h.calls[1].resolve({items:[],unread_count:2,next_offset:null});await retry;assert.deepEqual(h.counts,[null,2]);
});
test('shared badge authority: an old history failure cannot erase a newer confirmed count',async()=>{
  const h=sharedCounts(),old=h.begin(),fresh=h.refresh(true);h.calls[0].resolve({items:[],unread_count:2});await fresh;old(null);assert.equal(h.state.unread,2);
});
test('filtered policy: failed history does not publish a count; only the reminder endpoint can',async()=>{
  const h=sharedCounts();h.state.preferencesEnabled=true;h.state.scope.current.preferencesEnabled=true;
  const begin=bellCallback('beginUnread','client,preferencesEnabled,refresh',h.state),publish=begin();publish(null);
  assert.equal(h.state.unread,1);assert.equal(h.calls.length,2);
  h.calls[0].resolve({items:[],unread_count:99});h.calls[1].resolve({unread_count:3});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.state.unread,3);
});

function reconciliation(){
  const h=sharedCounts();h.state.reconcileRead=runInNewContext(`${sourceFunction('NotificationBell.tsx','reconcileRead')};reconcileRead`,h.state);return h;
}
for(const source of ['preview','history'] as const)test(`bell: a later ${source} record confirms a lost acknowledgement without another write`,async()=>{
  const h=reconciliation(),write=h.invoke(item);h.calls[0].reject(new Error('lost acknowledgement'));await write;assert.ok(h.state.actionError);
  if(source==='history')h.begin()(0,[{...item,read_at:ack.read_at}]);else{const read=h.refresh(true);h.calls[1].resolve({items:[{...item,read_at:ack.read_at}],unread_count:0});await read;}
  assert.equal(h.state.actionError,null);assert.equal(h.state.keys.current.has(item.notification_id),false);assert.equal(h.calls.filter(x=>x.key).length,1);
});
for(const proof of ['old','missing','invalid','session'] as const)test(`bell: ${proof} read evidence cannot dismiss an unconfirmed acknowledgement`,async()=>{
  const h=reconciliation(),older=h.begin(),write=h.invoke(item);h.calls[0].reject(new Error('lost'));await write;
  const publish=proof==='old'?older:h.begin();if(proof==='session')h.state.client.sessionGeneration++;
  publish(0,proof==='missing'?[]:[{...item,read_at:proof==='invalid'?'bad':ack.read_at}]);assert.ok(h.state.actionError);assert.equal(h.state.keys.current.size,1);
});
test('bell: a late retry failure cannot recreate an alert already confirmed by a fresh read',async()=>{
  const h=reconciliation(),first=h.invoke(item);h.calls[0].reject(new Error('lost'));await first;
  const retry=h.invoke(item,false);h.begin()(0,[{...item,read_at:ack.read_at}]);assert.equal(h.state.actionError,null);
  h.calls[1].reject(new Error('late failure'));await retry;assert.equal(h.state.actionError,null);assert.equal(h.state.keys.current.size,0);
});

test('bell: focus/open refresh during an unresolved acknowledgement never joins an earlier transport',async()=>{
  const h=reconciliation(),write=h.invoke(item);h.calls[0].reject(new Error('lost'));await write;
  const read=h.refresh(false);assert.equal(h.calls.length,2);assert.equal(h.calls[1].options.coalesce,true);assert.ok(h.calls[1].options.coalesceScope.endsWith(":1"));
  h.calls[1].resolve({items:[{...item,read_at:ack.read_at}],unread_count:0});await read;assert.equal(h.state.actionError,null);assert.equal(h.calls.filter(x=>x.key).length,1);
});

test('bell: dismissing an unknown intent cannot restore coalescing until a fresh exact record confirms it',async()=>{
  const h=reconciliation(),write=h.invoke(item);h.calls[0].reject(new Error('lost'));await write;
  h.state.dismissReadError();assert.equal(h.state.actionError,null);assert.equal(h.state.keys.current.size,1);
  const read=h.refresh(false);assert.equal(h.calls[1].options.coalesce,true);assert.ok(h.calls[1].options.coalesceScope.endsWith(":1"));h.calls[1].resolve({items:[{...item,read_at:ack.read_at}],unread_count:0});await read;
  assert.equal(h.state.keys.current.size,0);assert.equal(h.state.actionError,null);
  const ordinary=h.refresh(false);assert.equal(h.calls.length,3);h.calls[2].resolve({items:[],unread_count:0});await ordinary;assert.equal(h.calls.filter(x=>x.key).length,1);
});

for(const boundary of ['ack','history'] as const)test(`actual PortalClient: ${boundary} boundary cannot rejoin an older preview transport`,async t=>{
  const responses:Array<(response:Response)=>void>=[];
  const fetcher=t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>responses.push(resolve)));
  const h=sharedCounts(),client=new PortalClient();client.csrfToken='synthetic-notification-account';
  h.state.client=client;h.state.scope.current={client,session:client.sessionGeneration,preferencesEnabled:false};
  // Closures use the actual PortalClient, whose opted-in GETs otherwise reuse in-flight promises.
  h.state.refresh=bellCallback('refresh','client,preferencesEnabled,sessionGeneration',h.state);
  const refresh=h.state.refresh,begin=bellCallback('beginUnread','client,preferencesEnabled,refresh',h.state);
  const old=refresh(),overlap=refresh();assert.equal(fetcher.mock.callCount(),1,'ordinary overlap shares one transport');
  if(boundary==='ack'){
    const write=client.post('/me/notifications/read',{}, {idempotencyKey:'synthetic-intent'});
    responses[1](Response.json(ack));await write;
  }else begin()(2);
  const fresh=refresh(boundary==='ack'),focus=refresh();
  const index=boundary==='ack'?2:1;
  assert.equal(fetcher.mock.callCount(),index+1,'focus joins only the new epoch, with no third preview transport');
  responses[index](Response.json({items:[],unread_count:2}));await Promise.all([fresh,focus]);
  responses[0](Response.json({items:[],unread_count:0}));await Promise.all([old,overlap]);
  assert.equal(h.state.unread,2,'pre-boundary result cannot regain count authority');
  const settled=refresh();assert.equal(fetcher.mock.callCount(),index+2,'settled responses are not cached');
  responses[index+1](Response.json({items:[],unread_count:3}));await settled;assert.equal(h.state.unread,3);
});

for(const outcome of ['success','failure'] as const)test(`actual PortalClient: another writer's ${outcome} retires preview transports without an inbox event`,async t=>{
  const responses:Array<(response:Response)=>void>=[];
  const fetcher=t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>responses.push(resolve)));
  const h=sharedCounts(),client=new PortalClient();client.csrfToken='synthetic-notification-account';
  h.state.client=client;h.state.scope.current={client,session:client.sessionGeneration,preferencesEnabled:false};
  const refresh=bellCallback('refresh','client,preferencesEnabled,sessionGeneration',h.state);
  const old=refresh();
  const write=client.post('/me/notifications/other/read',{}, {idempotencyKey:'other-intent',suppressConsole:true}).catch(()=>null);
  const during=refresh();assert.equal(fetcher.mock.callCount(),3,'write start invalidates old reads');
  responses[1](Response.json(outcome==='success'?ack:{title:'unavailable'},{status:outcome==='success'?200:503}));await write;
  const fresh=refresh(),overlap=refresh();assert.equal(fetcher.mock.callCount(),4,'write finally invalidates even a failed command, while fresh overlap shares');
  responses[3](Response.json({items:[],unread_count:2}));await Promise.all([fresh,overlap]);
  responses[2](Response.json({items:[],unread_count:1}));responses[0](Response.json({items:[],unread_count:0}));await Promise.all([old,during]);assert.equal(h.state.unread,2);
});

for(const close of ['navigation','manual-after-ack','manual-before-ack'] as const)test(`shared actual closures: ${close} cannot abandon the only badge producer`,async()=>{
  const bell=sharedCounts(),history=harness('history');
  history.state.client=bell.state.client;history.state.scope.current={client:bell.state.client,session:1};
  history.state.onUnread=bell.begin;
  let shell:Promise<void>|undefined,count:Promise<void>|undefined;
  history.state.announceInboxChange=()=>{shell=bell.refresh(true);};
  const refreshCount=runInNewContext(`${sourceFunction('MemberMessages.tsx','refreshUnread')};refreshUnread`,history.state);
  history.state.refreshUnread=()=>{count=refreshCount();};
  const closeList=()=>{history.state.alive.current=false;history.state.lifetime.current++;history.state.unreadGeneration.current++;};
  history.state.go=closeList;
  const mark=runInNewContext(`${sourceFunction('MemberMessages.tsx','markRead')};markRead`,history.state);
  const write=mark(item,close==='navigation'?item.action:undefined);
  if(close==='manual-before-ack')closeList();
  bell.calls[0].resolve(ack);await write;
  if(close==='manual-after-ack')closeList();
  assert.equal(bell.calls.length,close==='manual-before-ack'?2:3);
  // Bell starts first; the subsequently abandoned history request must not reserve away its authority.
  bell.calls[1].resolve({items:[{...item,read_at:ack.read_at}],unread_count:0});await shell;
  if(count){bell.calls[2].resolve({items:[],unread_count:99});await count;}
  assert.equal(bell.state.unread,0);assert.equal(bell.calls.filter(call=>call.key).length,1);
});

test('PortalClient snapshot scopes partition only sharing, never wire data or subscriber views',async t=>{
  const responses:Array<(response:Response)=>void>=[];
  const fetcher=t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>responses.push(resolve)));
  const client=new PortalClient();client.csrfToken='synthetic-scope-account';
  const first=client.get<any>('/me/notifications',{coalesce:true,coalesceScope:'first'}),same=client.get<any>('/me/notifications',{coalesce:true,coalesceScope:'first'});
  const second=client.get('/me/notifications',{coalesce:true,coalesceScope:'second'});
  assert.equal(fetcher.mock.callCount(),2);
  const [urlA,initA]=fetcher.mock.calls[0].arguments as unknown as [string,RequestInit], [urlB,initB]=fetcher.mock.calls[1].arguments as unknown as [string,RequestInit];
  assert.equal(urlA,urlB);assert.deepEqual([...new Headers(initA.headers)],[...new Headers(initB.headers)]);assert.equal(initA.body,undefined);assert.equal(initB.body,undefined);
  assert.equal('coalesceScope' in initA,false);assert.equal('coalesceScope' in initB,false);assert.equal(urlA.includes('first'),false);
  responses[0](Response.json({items:[{value:1}]}));responses[1](Response.json({items:[]}));
  const [a,b]=await Promise.all([first,same]);await second;a.items[0].value=2;assert.equal(b.items[0].value,1);
});
for(const method of ['post','put','patch','delete'] as const)test(`PortalClient scoped reads retain ${method} and authentication invalidation`,async t=>{
  const responses:Array<(response:Response)=>void>=[];
  const fetcher=t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>responses.push(resolve)));
  const client=new PortalClient();client.csrfToken='synthetic-first';
  const read=()=>client.get('/me/notifications',{coalesce:true,coalesceScope:'same-scope'});
  const old=read(),write=client[method]('/me/notifications/read',{}, {idempotencyKey:'synthetic-write'}),during=read();
  assert.equal(fetcher.mock.callCount(),3);responses[1](Response.json({ok:true}));await write;
  const after=read();assert.equal(fetcher.mock.callCount(),4);
  client.csrfToken='synthetic-next';const next=read();assert.equal(fetcher.mock.callCount(),5);
  for(const index of [0,2,3,4])responses[index](Response.json({items:[]}));await Promise.all([old,during,after,next]);
});

test('bell: fresh read proof before a lost initial acknowledgement preserves the one requested navigation',async()=>{
  const h=reconciliation(),write=h.invoke(item,true),read=h.refresh();
  h.calls[1].resolve({items:[{...item,read_at:ack.read_at}],unread_count:0});await read;
  assert.equal(h.state.keys.current.size,0);
  h.calls[0].reject(new Error('initial response lost'));await write;
  assert.equal(h.navigations.length,1);assert.equal(h.state.actionError,null);assert.equal(h.state.unread,0);
  assert.equal(h.calls.filter(call=>call.key).length,1);
});

function historyReconciliation(){
  const h=harness('history');Object.assign(h.state,{PAGE:20,nextOffset:20,more:{loading:false},setNextOffset:()=>{},setStatus:()=>{},setRefresh:()=>{},merge:(a:any[],b:any[],id:(x:any)=>string)=>[...a,...b.filter(x=>!a.some(y=>id(x)===id(y)))]});
  h.state.reconcileReads=runInNewContext(`${sourceFunction('MemberMessages.tsx','reconcileReads')};reconcileReads`,h.state);
  h.state.keepReadProofs=runInNewContext(`${sourceFunction('MemberMessages.tsx','keepReadProofs')};keepReadProofs`,h.state);
  return {...h,load:historyLoad(h.state),more:runInNewContext(`${sourceFunction('MemberMessages.tsx','loadMore')};loadMore`,h.state),count:runInNewContext(`${sourceFunction('MemberMessages.tsx','refreshUnread')};refreshUnread`,h.state)};
}
for(const read of ['load','more','count'] as const)for(const unknown of [true,false])test(`history: fresh ${read} exact proof clears ${unknown?'unknown':'definite'} failure without another command`,async()=>{
  const h=historyReconciliation();h.state.unconfirmed=()=>unknown;
  const write=h.invoke(item);h.calls[0].reject(new Error('read result unavailable'));await write;assert.ok(h.state.itemErrors[item.notification_id]);
  const pending=h[read]();h.calls[1].resolve({items:[{...item,read_at:ack.read_at}],unread_count:0,next_offset:null});await pending;
  assert.equal(h.state.itemErrors[item.notification_id],undefined);assert.equal(h.state.items.find((entry:any)=>entry.notification_id===item.notification_id)?.read_at,ack.read_at);
  assert.equal(h.state.keys.current.has(item.notification_id),false);assert.equal(h.state.unknownReads.current.has(item.notification_id),false);assert.equal(h.state.readIntents.current.has(item.notification_id),false);
  assert.equal(h.calls.filter(call=>call.key).length,1);assert.equal(h.navigations.length,0);assert.equal(h.events.length,0);
});
for(const proof of ['old','missing','invalid','unread','different','session','client','unmounted'] as const)test(`history: ${proof} read cannot clear an unconfirmed failure`,async()=>{
  const h=historyReconciliation();let read:Promise<void>|undefined;
  const write=h.invoke(item);if(proof==='old')read=h.load(true);
  h.calls[0].reject(new Error('lost acknowledgement'));await write;
  if(proof!=='old')read=h.load(true);
  if(proof==='session')h.state.client.sessionGeneration++;
  if(proof==='client')h.state.scope.current={client:{sessionGeneration:1},session:1};
  if(proof==='unmounted'){h.state.alive.current=false;h.state.lifetime.current++;}
  const record={...item,notification_id:proof==='different'?'other':item.notification_id,read_at:proof==='invalid'?'invalid':proof==='unread'?null:ack.read_at};
  h.calls[1].resolve({items:proof==='missing'?[]:[record],unread_count:0,next_offset:null});await read;
  assert.ok(h.state.itemErrors[item.notification_id]);assert.ok(h.state.keys.current.has(item.notification_id));assert.ok(h.state.readIntents.current.has(item.notification_id));assert.equal(h.calls.filter(call=>call.key).length,1);
});
test('history: fresh proof during retry prevents a late failure from resurrecting errors or intent',async()=>{
  const h=historyReconciliation(),first=h.invoke(item);h.calls[0].reject(new Error('lost'));await first;
  const retry=h.invoke(item);assert.equal(h.calls[1].key,h.calls[0].key);const read=h.count();h.calls[2].resolve({items:[{...item,read_at:ack.read_at}],unread_count:0});await read;
  h.calls[1].reject(new Error('late response failure'));await retry;
  assert.equal(h.state.itemErrors[item.notification_id],undefined);assert.equal(h.state.items[0].read_at,ack.read_at);assert.equal(h.state.readIntents.current.size,0);assert.equal(h.state.keys.current.size,0);assert.equal(h.state.unknownReads.current.size,0);assert.equal(h.navigations.length,0);
});

for(const stale of ['load','more'] as const)test(`history: delayed ${stale} cannot undo a newer exact-record proof`,async()=>{
  const h=historyReconciliation(),write=h.invoke(item);h.calls[0].reject(new Error('lost'));await write;
  const older=h[stale](),fresh=h.count();h.calls[2].resolve({items:[{...item,read_at:ack.read_at}],unread_count:0});await fresh;
  h.calls[1].resolve({items:[item],unread_count:1,next_offset:null});await older;
  assert.equal(h.state.items.find((entry:any)=>entry.notification_id===item.notification_id)?.read_at,ack.read_at);assert.equal(h.state.itemErrors[item.notification_id],undefined);
  assert.equal(h.state.inFlight.current,null);assert.equal(h.calls.filter(call=>call.key).length,1);assert.equal(h.navigations.length,0);
});
