import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const {transformSync}=createRequire(resolve(process.cwd(),'package.json'))('esbuild');

// Execute the actual TSX handlers with deterministic hook/transport ports.
// This is source-model evidence, not React DOM, browser, database or device QA.
const source=readFileSync('apps/portal-web/src/modules/EventHelpers.tsx','utf8');
const compiled=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
const api=readFileSync('apps/portal-web/src/api.ts','utf8');
const apiClass=api.slice(api.indexOf('export class ApiError'),api.indexOf('export type InstanceSelectionCandidate')).replace('export ','');
const ApiError=runInNewContext(transformSync(apiClass+';globalThis.ApiError=ApiError',{loader:'ts'}).code+';ApiError',{Error});
type Element={type:any;props:any;key?:string};
function text(value:any):string{return Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):typeof value==='string'||typeof value==='number'?String(value):'';}
function find(value:any,predicate:(node:Element)=>boolean):Element|undefined{
  if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const child of value){const found=find(child,predicate);if(found)return found;}return;}
  if(predicate(value))return value;return find(value.props?.children,predicate);
}
function harness(organizer=false){
  type Scope={hooks:any[];index:number;effects:(()=>void)[]};
  const outer:Scope={hooks:[],index:0,effects:[]};let inner:Scope={hooks:[],index:0,effects:[]},scope=outer,key:string|undefined;
  const reads:any[]=[],writes:any[]=[],blocked:boolean[]=[],listeners=new Map<string,()=>void>();
  const client={sessionGeneration:1,get:(path:string,options:any)=>new Promise((resolve,reject)=>reads.push({path,options,resolve,reject})),post:(path:string,body:any,options:any)=>new Promise((resolve,reject)=>writes.push({path,body,options,resolve,reject}))};
  const props:any={client,eventId:'event-a',userId:'member-a',isOrganizer:organizer,referralCode:'share-code-original',onBlockedChange:(value:boolean)=>blocked.push(value)};
  const depsEqual=(a:any[],b:any[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);
  const react={
    useRef:(value:any)=>{const at=scope.index++;return scope.hooks[at]??(scope.hooks[at]={current:value});},
    useState:(value:any)=>{const at=scope.index++,target=scope;if(!(at in target.hooks))target.hooks[at]=typeof value==='function'?value():value;return [target.hooks[at],(next:any)=>target.hooks[at]=typeof next==='function'?next(target.hooks[at]):next];},
    useCallback:(fn:any,deps:any[])=>{const at=scope.index++;if(!scope.hooks[at]||!depsEqual(scope.hooks[at].deps,deps))scope.hooks[at]={fn,deps};return scope.hooks[at].fn;},
    useEffect:(fn:()=>any,deps:any[])=>{const at=scope.index++,target=scope;if(!target.hooks[at]||!depsEqual(target.hooks[at].deps,deps)){target.hooks[at]?.cleanup?.();target.hooks[at]={deps};target.effects.push(()=>target.hooks[at].cleanup=fn());}},
  };
  const document={visibilityState:'visible',addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)};
  const jsx=(type:any,props:any,key?:string)=>({type,props,key}),module={exports:{} as any};
  runInNewContext(compiled,{module,exports:module.exports,crypto:webcrypto,AbortController,Error,document,window:{addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)},require:(name:string)=>{
    if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='../api')return {ApiError};if(name.endsWith('.css'))return {};throw Error(name);
  }});
  function cleanup(){for(const hook of inner.hooks)hook?.cleanup?.();}
  function render(){scope=outer;outer.index=0;const wrapper=module.exports.EventHelpers(props);if(wrapper.key!==key){cleanup();inner={hooks:[],index:0,effects:[]};key=wrapper.key;}scope=inner;inner.index=0;const tree=wrapper.type(wrapper.props);while(inner.effects.length)inner.effects.shift()!();return tree;}
  const view=()=>{render();return render();};
  function button(label:string){return find(view(),node=>node.type==='button'&&text(node.props.children)===label);}
  const click=(label:string)=>{const target=button(label);assert.ok(target,`button ${label}`);target.props.onClick();};
  view();return {props,client,reads,writes,blocked,view,button,click,cleanup,focus:()=>listeners.get('focus')?.(),visibility:(value:string)=>{document.visibilityState=value;listeners.get('visibilitychange')?.();},end:()=>listeners.get('freedom-game-console-session-end')?.()};
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
const own=(state:string|null=null,version=1,event_closed=false)=>({state,version,event_closed});
const tuple=(request:any)=>JSON.stringify({path:request.path,body:request.body,key:request.options.idempotencyKey,version:request.options.ifMatch});
async function ready(h:ReturnType<typeof harness>,value=own()){h.reads[0].resolve(value);await settle();h.view();}
const unknown=()=>new ApiError({message:'lost ACK',network:true});
const denied=(status:number)=>new ApiError({message:'known rejection',status,definitiveResponse:true});

for(const status of [403,404,412])test(`unknown helper command survives refresh and later ${status} without changing its tuple`,async()=>{
  const h=harness();await ready(h);h.click('我要幫忙，送出申請');const original=h.writes[0];h.click('我要幫忙，送出申請');assert.equal(h.writes.length,1);
  original.reject(unknown());await settle();assert.equal(h.blocked.at(-1),true);
  h.click('重新讀取幫忙狀態');h.reads.at(-1).resolve(own('accepted',19));await settle();assert.equal(h.button('撤回幫忙申請')?.props.disabled,true);
  h.props.referralCode='changed-referral';h.click('重試原幫忙操作');assert.equal(tuple(h.writes[1]),tuple(original));h.writes[1].reject(denied(status));await settle();assert.equal(h.blocked.at(-1),true);
  h.click('重試原幫忙操作');assert.equal(tuple(h.writes[2]),tuple(original));h.writes[2].resolve(own('applied',2));await settle();
  assert.equal(h.button('撤回幫忙申請'),undefined,'historical receipt is not rendered as current state');h.reads.at(-1).resolve(own('withdrawn',20));await settle();
  assert.match(text(h.view()),/已撤回/);assert.equal(h.blocked.at(-1),false);h.cleanup();
});
test('known initial conflict needs a successful current read before a fresh user command',async()=>{
  const h=harness();await ready(h);h.click('我要幫忙，送出申請');h.writes[0].reject(denied(412));await settle();assert.equal(h.blocked.at(-1),false);assert.equal(h.button('我要幫忙，送出申請'),undefined);
  h.click('重新讀取幫忙狀態');h.reads.at(-1).resolve(own('withdrawn',6));await settle();h.click('我要幫忙，送出申請');assert.equal(h.writes[1].options.ifMatch,6);assert.notEqual(h.writes[1].options.idempotencyKey,h.writes[0].options.idempotencyKey);h.cleanup();
});
test('malformed successful ACK stays unknown; unavailable reads never become an empty helper list',async()=>{
  const h=harness();await ready(h);h.click('我要幫忙，送出申請');h.writes[0].resolve({ok:true});await settle();assert.ok(h.button('重試原幫忙操作'));assert.equal(h.blocked.at(-1),true);h.cleanup();
  const owner=harness(true);owner.reads[0].reject(denied(403));await settle();assert.doesNotMatch(text(owner.view()),/沒有幫忙申請|共 0 筆/);assert.match(text(owner.view()),/known rejection/);owner.cleanup();
});
for(const change of ['client','session','event','user'] as const)test(`late response cannot enter a replaced ${change} scope`,async()=>{
  const h=harness();await ready(h);h.click('我要幫忙，送出申請');const old=h.writes[0];
  if(change==='client')h.props.client={...h.client};if(change==='session')h.client.sessionGeneration++;if(change==='event')h.props.eventId='event-b';if(change==='user')h.props.userId='member-b';
  h.view();const readCount=h.reads.length;old.resolve(own('accepted',2));await settle();assert.equal(h.reads.length,readCount,'old ACK must not trigger a current-scope read');assert.doesNotMatch(text(h.view()),/原操作已確認|主辦已接受/);h.cleanup();
});
test('session-end clears private state and blocks stale reads/writes',async()=>{
  const h=harness();await ready(h,own('accepted',2));h.end();assert.doesNotMatch(text(h.view()),/主辦已接受/);const count=h.reads.length;h.click('重新讀取幫忙狀態');assert.equal(h.reads.length,count);h.cleanup();
});
test('closed events allow withdrawing accepted help, but declined helpers have no new action',async()=>{
  const h=harness();await ready(h,own('accepted',4,true));assert.ok(h.button('撤回幫忙申請'));assert.equal(h.button('我要幫忙，送出申請'),undefined);h.click('撤回幫忙申請');assert.equal(h.writes[0].body.action,'withdraw');h.cleanup();
  const declined=harness();await ready(declined,own('declined',3));assert.equal(declined.button('撤回幫忙申請'),undefined);assert.equal(declined.button('我要幫忙，送出申請'),undefined);declined.cleanup();
});
test('organizer list and decisions use the application version; members never read the list',async()=>{
  const h=harness(true);h.reads[0].resolve({items:[{user_id:'20000000-0000-4000-8000-000000000003',nickname:'Synthetic helper',state:'applied',version:7}],total:1,next_offset:null,event_closed:false});await settle();h.click('接受 Synthetic helper');assert.equal(h.writes[0].path,'/events/event-a/helpers/20000000-0000-4000-8000-000000000003/decision');assert.equal(h.writes[0].options.ifMatch,7);assert.equal(h.writes[0].body.decision,'accept');assert.ok(h.reads.every(read=>!read.path.endsWith('/me')));h.cleanup();
  const member=harness();assert.equal(member.reads[0].path,'/events/event-a/helpers/me');member.cleanup();
});

const parent=readFileSync('apps/portal-web/src/modules/EventsPanel.tsx','utf8');
test('actual parent departure and beforeunload guards preserve unknown helper operations and dirty drafts',()=>{
  const start=parent.indexOf('  leaveGuard.current=()=>{'),end=parent.indexOf('  const acceptedLocation',start);assert.ok(start>=0&&end>start);
  let confirms=0;const context:any={leaveGuard:{current:null},helperBlocked:{current:true},saving:false,busy:false,mediaUnknown:false,lastFailureUnknown:false,dirty:false,setNotice:()=>{},window:{confirm:()=>{confirms++;return false;}}};
  runInNewContext(transformSync(parent.slice(start,end),{loader:'tsx'}).code,context);assert.equal(context.leaveGuard.current(),false);assert.equal(confirms,0);
  context.helperBlocked.current=false;context.dirty=true;assert.equal(context.leaveGuard.current(),false);assert.equal(confirms,1);context.dirty=false;assert.equal(context.leaveGuard.current(),true);
  const from=parent.indexOf('    const beforeUnload='),to=parent.indexOf('\n',from);assert.ok(from>=0&&to>from);
  const guard=runInNewContext(transformSync(parent.slice(from,to)+';globalThis.guard=beforeUnload',{loader:'tsx'}).code+';guard',{unloading:{current:false},helperBlocked:{current:true}});
  let prevented=false;const event={preventDefault(){prevented=true;},returnValue:undefined};guard(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');
});

test('hidden private helper data is cleared and visibility/focus require a fresh authorized read',async()=>{
  const h=harness(true);h.reads[0].resolve({items:[{user_id:'20000000-0000-4000-8000-000000000003',nickname:'Private synthetic name',state:'applied',version:7}],total:1,next_offset:null,event_closed:false});await settle();assert.match(text(h.view()),/Private synthetic name/);
  h.visibility('hidden');assert.doesNotMatch(text(h.view()),/Private synthetic name/);h.visibility('visible');h.reads.at(-1).reject(denied(403));await settle();assert.doesNotMatch(text(h.view()),/Private synthetic name/);h.focus();assert.equal(h.reads.length,3);h.cleanup();
});

test('ACK followed by a read failure does not display the historical result or enable another command',async()=>{
  const h=harness();await ready(h);h.click('我要幫忙，送出申請');h.writes[0].resolve(own('accepted',2));await settle();h.reads.at(-1).reject(denied(403));await settle();assert.doesNotMatch(text(h.view()),/主辦已接受/);assert.equal(h.button('撤回幫忙申請'),undefined);assert.equal(h.button('我要幫忙，送出申請'),undefined);assert.equal(h.blocked.at(-1),false);h.cleanup();
});
for(const malformed of ['path-id','duplicate-id','non-progressing-offset','wrong-offset'])test(`malformed helper list ${malformed} cannot become actionable`,async()=>{
  const h=harness(true),row={user_id:'20000000-0000-4000-8000-000000000003',nickname:'Synthetic helper',state:'applied',version:7};
  const data:any={items:[row],total:1,next_offset:null,event_closed:false};
  if(malformed==='path-id')row.user_id='../someone/decision';if(malformed==='duplicate-id'){data.items=[row,{...row}];data.total=2;}if(malformed==='non-progressing-offset')data.next_offset=0;if(malformed==='wrong-offset')data.next_offset=7;
  h.reads[0].resolve(data);await settle();assert.equal(h.button('接受 Synthetic helper'),undefined);assert.match(text(h.view()),/尚未完整讀取/);h.cleanup();
});

test('actual review open and return handlers respect unknown/dirty leave guards',()=>{
  let allowed=false,discarded=0,reviewing:string|null='current',reason='keep this reason',focused=0;
  const context:any={leaveGuard:{current:()=>allowed},discardDrafts:()=>discarded++,reviewTrigger:{current:{focus:()=>focused++}},setReviewing:(value:string|null)=>reviewing=value,setReviewReason:(value:string)=>reason=value,item:{event_id:'next'}};
  const openStart=parent.indexOf('onClick={event=>{if(!leaveGuard.current())return;discardDrafts();reviewTrigger.current='),openEnd=parent.indexOf('}}>審核活動',openStart);assert.ok(openStart>=0&&openEnd>openStart);
  const open=runInNewContext(transformSync('globalThis.handler='+parent.slice(openStart+'onClick={'.length,openEnd+1),{loader:'tsx'}).code+';handler',context);
  open({currentTarget:{focus:()=>focused++}});assert.equal(reviewing,'current');assert.equal(reason,'keep this reason');assert.equal(discarded,0);
  allowed=true;open({currentTarget:{focus:()=>focused++}});assert.equal(reviewing,'next');assert.equal(discarded,1);
  reason='new unsaved reason';allowed=false;
  const closeStart=parent.indexOf('onClick={()=>{if(leaveGuard.current()){setReviewing(null);'),closeEnd=parent.indexOf('}}>返回',closeStart);assert.ok(closeStart>=0&&closeEnd>closeStart);
  const close=runInNewContext(transformSync('globalThis.handler='+parent.slice(closeStart+'onClick={'.length,closeEnd+1),{loader:'tsx'}).code+';handler',context);
  close();assert.equal(reviewing,'next');assert.equal(reason,'new unsaved reason');allowed=true;close();assert.equal(reviewing,null);assert.equal(reason,'');assert.equal(focused,1);
});

test('actual review handler freezes intent and shared decoder transport retains unknown tuple after denial',async()=>{
  const shared=readFileSync('apps/portal-web/src/modules/shared.tsx','utf8'),module={exports:{} as any};
  runInNewContext(transformSync(shared,{loader:'tsx',format:'cjs'}).code,{module,exports:module.exports,crypto:webcrypto,require:(name:string)=>name==='../api'?{ApiError}:{}});
  const requests:any[]=[],state:any={keys:new Map(),snapshot:{busy:false,error:null,lastFailureUnknown:false},listeners:new Set(),live:()=>true};
  const client={post:(path:string,body:any,options:any)=>new Promise((resolve,reject)=>requests.push({path,body,options,resolve,reject}))};
  let loads=0;
  const context:any={saving:false,recoveringSave:false,recoveringAction:false,mediaUnknown:false,actionAttempt:{current:null},saveAttempt:{current:null},reviewAttempt:{current:null},reviewReason:'original reason',setNotice:()=>{},setReviewing:()=>{},setReviewReason:()=>{},announceInboxChange:()=>{},window:{dispatchEvent:()=>{}},Event:class{},load:async()=>loads++,mutate:(...args:any[])=>module.exports.performModuleMutation(client,state,...args)};
  Object.defineProperty(context,'busy',{get:()=>state.snapshot.busy});Object.defineProperty(context,'lastFailureUnknown',{get:()=>state.snapshot.lastFailureUnknown});
  const from=parent.indexOf('  async function review('),to=parent.indexOf('  async function share(',from);assert.ok(from>=0&&to>from);
  const review=runInNewContext(transformSync(parent.slice(from,to)+';globalThis.review=review',{loader:'tsx'}).code+';review',context);
  const item={event_id:'event-a',aggregate_version:1};const first=review(item,'approve');await review(item,'approve');assert.equal(requests.length,1);requests[0].reject(unknown());await first;assert.equal(state.snapshot.lastFailureUnknown,true);
  context.reviewReason='changed text';await review(item,'reject');assert.equal(requests.length,1,'opposite decision cannot replace an unknown review');
  const second=review({...item,aggregate_version:17},'approve');assert.equal(tuple(requests[1]),tuple(requests[0]));requests[1].reject(denied(403));await second;assert.equal(state.snapshot.lastFailureUnknown,true);
  const retry=review({...item,aggregate_version:22},'approve');assert.equal(tuple(requests[2]),tuple(requests[0]));requests[2].resolve({event_id:'event-a',aggregate_version:2,state:'published'});await retry;assert.equal(context.reviewAttempt.current,null);assert.equal(loads,1);
});

for(const kind of ['rsvp','cancel'] as const)for(const status of [403,412])test(`actual ${kind} blocks cross-actions and preserves original tuple after unknown then ${status}`,async()=>{
  const shared=readFileSync('apps/portal-web/src/modules/shared.tsx','utf8'),module={exports:{} as any};
  runInNewContext(transformSync(shared,{loader:'tsx',format:'cjs'}).code,{module,exports:module.exports,crypto:webcrypto,require:(name:string)=>name==='../api'?{ApiError}:{}});
  const requests:any[]=[],state:any={keys:new Map(),snapshot:{busy:false,error:null,lastFailureUnknown:false},listeners:new Set(),live:()=>true};
  const client={post:(path:string,body:any,options:any)=>new Promise((resolve,reject)=>requests.push({path,body,options,resolve,reject}))};
  let loads=0;
  const context:any={saving:false,recoveringSave:false,recoveringReview:false,mediaUnknown:false,actionAttempt:{current:null},saveAttempt:{current:null},reviewAttempt:{current:null},reviewReason:'review',setNotice:()=>{},setReviewing:()=>{},setReviewReason:()=>{},announceInboxChange:()=>{},window:{dispatchEvent:()=>{}},Event:class{},referralCode:()=> 'original-code',load:async()=>loads++,mutate:(...args:any[])=>module.exports.performModuleMutation(client,state,...args)};
  Object.defineProperty(context,'busy',{get:()=>state.snapshot.busy});Object.defineProperty(context,'lastFailureUnknown',{get:()=>state.snapshot.lastFailureUnknown});Object.defineProperty(context,'recoveringAction',{get:()=>state.snapshot.lastFailureUnknown&&context.actionAttempt.current!==null});
  const from=parent.indexOf('  async function sendEventAction('),to=parent.indexOf('  async function share(',from);assert.ok(from>=0&&to>from);
  const functions=runInNewContext(transformSync(parent.slice(from,to)+';globalThis.handlers={action,sendEventAction,review}',{loader:'tsx'}).code+';handlers',context);
  const item={event_id:'event-a',aggregate_version:5,visibility:'referral'};const first=functions.action(item,kind,true);await functions.action(item,kind,true);assert.equal(requests.length,1);requests[0].reject(unknown());await first;
  await functions.action({...item,event_id:'event-b',aggregate_version:44},kind==='rsvp'?'cancel':'rsvp');await functions.review(item,'approve');assert.equal(requests.length,1,'shared mutation state cannot be cleared by another action/review');
  const retry=functions.sendEventAction(context.actionAttempt.current);requests[1].reject(denied(status));await retry;assert.equal(state.snapshot.lastFailureUnknown,true);assert.equal(tuple(requests[1]),tuple(requests[0]));
  const confirmed=functions.sendEventAction(context.actionAttempt.current);assert.equal(tuple(requests[2]),tuple(requests[0]));requests[2].resolve({event_id:'event-a',aggregate_version:kind==='cancel'?7:5,state:kind==='cancel'?'cancelled':'published',my_rsvp:'going'});await confirmed;assert.equal(context.actionAttempt.current,null);assert.equal(loads,1);
});
test('metadata and media-removal handlers refuse to clear another unknown action or review',async()=>{
  for(const recovering of ['recoveringAction','recoveringReview'])for(const [from,to] of [['  async function removeBanner(','  async function removeVideo('],['  async function removeVideo(','  async function sendEventAction(']]){
    const start=parent.indexOf(from),end=parent.indexOf(to,start);assert.ok(start>=0&&end>start);
    const name=from.match(/function (\w+)/)![1];let writes=0;
    const fn=runInNewContext(transformSync(parent.slice(start,end)+`;globalThis.handler=${name}`,{loader:'tsx'}).code+';handler',{actionAttempt:{current:null},reviewAttempt:{current:null},saveAttempt:{current:null},saving:false,busy:false,recoveringSave:false,recoveringAction:recovering==='recoveringAction',recoveringReview:recovering==='recoveringReview',mediaUnknown:false,setNotice:()=>{},client:{post:()=>writes++}});
    await fn({event_id:'event-a',aggregate_version:1});assert.equal(writes,0);
  }
});

test('same-render RSVP then cancel cannot replace the pending ref before React updates busy',async()=>{
  const requests:any[]=[],context:any={saving:false,busy:false,lastFailureUnknown:false,mediaUnknown:false,actionAttempt:{current:null},reviewAttempt:{current:null},saveAttempt:{current:null},setNotice:()=>{},referralCode:()=> 'original-code',sendEventAction:(attempt:any)=>{requests.push(attempt);return new Promise(()=>{});}};
  const from=parent.indexOf('  async function action('),to=parent.indexOf('  async function review(',from);assert.ok(from>=0&&to>from);
  const action=runInNewContext(transformSync(parent.slice(from,to)+';globalThis.action=action',{loader:'tsx'}).code+';action',context);
  void action({event_id:'original',aggregate_version:1,visibility:'referral'},'rsvp',true);const original=context.actionAttempt.current;
  await action({event_id:'other',aggregate_version:44,visibility:'open'},'cancel');assert.equal(requests.length,1);assert.equal(context.actionAttempt.current,original);assert.equal(context.actionAttempt.current.path,'/events/original/rsvp');assert.equal(context.actionAttempt.current.body.referral_code,'original-code');
});

for(const firstKind of ['review','rsvp'] as const)test(`same-render ${firstKind} cannot create a second command owner`,async()=>{
  let writes=0;const context:any={saving:false,busy:false,lastFailureUnknown:false,recoveringSave:false,recoveringReview:false,recoveringAction:false,mediaUnknown:false,actionAttempt:{current:null},reviewAttempt:{current:null},saveAttempt:{current:null},reviewReason:'original',setNotice:()=>{},referralCode:()=>null,mutate:()=>{writes++;return new Promise(()=>{});}};
  const from=parent.indexOf('  async function sendEventAction('),to=parent.indexOf('  async function share(',from);const handlers=runInNewContext(transformSync(parent.slice(from,to)+';globalThis.handlers={action,review}',{loader:'tsx'}).code+';handlers',context);
  const item={event_id:'event-a',aggregate_version:1,visibility:'open'};
  if(firstKind==='review'){void handlers.review(item,'approve');await handlers.action(item,'rsvp',true);assert.equal(context.actionAttempt.current,null);assert.ok(context.reviewAttempt.current);}
  else{void handlers.action(item,'rsvp',true);await handlers.review(item,'approve');assert.equal(context.reviewAttempt.current,null);assert.ok(context.actionAttempt.current);}
  assert.equal(writes,1);
  const saveFrom=parent.indexOf('  async function save('),saveTo=parent.indexOf('  async function removeBanner(',saveFrom);assert.ok(saveFrom>=0&&saveTo>saveFrom);
  const save=runInNewContext(transformSync(parent.slice(saveFrom,saveTo)+';globalThis.save=save',{loader:'tsx'}).code+';save',context);await save({preventDefault(){}});assert.equal(context.saveAttempt.current,null);assert.equal(writes,1);
});
