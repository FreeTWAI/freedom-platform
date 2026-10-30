import {test} from 'node:test';
import {missionView,missionAck} from '../../apps/portal-web/src/modules/event-missions-client.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const {transformSync}=createRequire(resolve(process.cwd(),'package.json'))('esbuild');

// Execute the actual TSX handlers with deterministic hook/transport ports.
// This is source-model evidence, not React DOM, browser, database or device QA.
const source=readFileSync('apps/portal-web/src/modules/EventMissions.tsx','utf8');
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
function harness(){
  type Scope={hooks:any[];index:number;effects:(()=>void)[]};
  const outer:Scope={hooks:[],index:0,effects:[]};let inner:Scope={hooks:[],index:0,effects:[]},scope=outer,key:string|undefined;
  const reads:any[]=[],writes:any[]=[],blocked:boolean[]=[],listeners=new Map<string,()=>void>();
  const client={sessionGeneration:1,get:(path:string,options:any)=>new Promise((resolve,reject)=>reads.push({path,options,resolve,reject})),post:(path:string,body:any,options:any)=>new Promise((resolve,reject)=>writes.push({path,body,options,resolve,reject}))};
  const props:any={client,eventId:'event-a',userId:'member-a',onBlockedChange:(value:boolean)=>blocked.push(value)};
  const depsEqual=(a:any[],b:any[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);
  const react={
    useRef:(value:any)=>{const at=scope.index++;return scope.hooks[at]??(scope.hooks[at]={current:value});},
    useState:(value:any)=>{const at=scope.index++,target=scope;if(!(at in target.hooks))target.hooks[at]=typeof value==='function'?value():value;return [target.hooks[at],(next:any)=>target.hooks[at]=typeof next==='function'?next(target.hooks[at]):next];},
    useCallback:(fn:any,deps:any[])=>{const at=scope.index++;if(!scope.hooks[at]||!depsEqual(scope.hooks[at].deps,deps))scope.hooks[at]={fn,deps};return scope.hooks[at].fn;},
    useEffect:(fn:()=>any,deps:any[])=>{const at=scope.index++,target=scope;if(!target.hooks[at]||!depsEqual(target.hooks[at].deps,deps)){target.hooks[at]?.cleanup?.();target.hooks[at]={deps};target.effects.push(()=>target.hooks[at].cleanup=fn());}},
  };
  const document={visibilityState:'visible',addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)};
  const jsx=(type:any,props:any,key?:string)=>({type,props,key}),module={exports:{} as any};
  runInNewContext(compiled,{module,exports:module.exports,crypto:webcrypto,AbortController,Error,document,window:{confirm:()=>true,addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)},require:(name:string)=>{
    if(name==='./event-missions-client')return {missionView,missionAck};if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='../api')return {ApiError};if(name.endsWith('.css'))return {};throw Error(name);
  }});
  function cleanup(){for(const hook of inner.hooks)hook?.cleanup?.();}
  function render(){scope=outer;outer.index=0;const wrapper=module.exports.EventMissions(props);if(wrapper.key!==key){cleanup();inner={hooks:[],index:0,effects:[]};key=wrapper.key;}scope=inner;inner.index=0;const tree=wrapper.type(wrapper.props);while(inner.effects.length)inner.effects.shift()!();return tree;}
  const view=()=>{render();return render();};
  function button(label:string){return find(view(),node=>node.type==='button'&&text(node.props.children)===label);}
  const click=(label:string)=>{const target=button(label);assert.ok(target,`button ${label}`);target.props.onClick();};
  view();return {props,client,reads,writes,blocked,view,button,click,cleanup,focus:()=>listeners.get('focus')?.(),visibility:(value:string)=>{document.visibilityState=value;listeners.get('visibilitychange')?.();},end:()=>listeners.get('freedom-game-console-session-end')?.()};
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
const own=(enabled=false,version=1)=>({policy:'personal_self_exercises_v1',version,enabled,editable:true,slots:enabled?['read_intro','think_question','reflect'].map((template_id,slot)=>({slot,template_id,id:template_id,state:'active',title:`Task ${slot}`,description:'Private exercise'})):[]});
const tuple=(r:any)=>JSON.stringify({path:r.path,body:r.body,key:r.options.idempotencyKey,version:r.options.ifMatch});
const ack=(r:any)=>({acknowledged:true,event_id:'event-a',action:r.body.action,command_key:r.options.idempotencyKey});
async function ready(h:ReturnType<typeof harness>,value=own()){h.reads[0].resolve(value);await settle();h.view();}
const unknown=()=>new ApiError({message:'lost ACK',network:true});
const denied=(status:number)=>new ApiError({message:'known rejection',status,definitiveResponse:true});
for(const status of [403,404,412])test(`actual mission closure keeps unknown tuple after refresh and ${status}`,async()=>{
 const h=harness();await ready(h);h.click('自願開始 3 個小任務');const original=h.writes[0];h.click('自願開始 3 個小任務');assert.equal(h.writes.length,1);
 original.reject(unknown());await settle();assert.equal(h.blocked.at(-1),true);
 h.click('重新讀取');h.reads.at(-1).resolve(own(true,8));await settle();assert.equal(h.button('換一個')?.props.disabled,true);assert.equal(h.blocked.at(-1),true);
 h.click('重試原操作');assert.equal(tuple(h.writes[1]),tuple(original));h.writes[1].reject(denied(status));await settle();assert.equal(h.blocked.at(-1),true);
 h.click('重試原操作');assert.equal(tuple(h.writes[2]),tuple(original));h.writes[2].resolve(ack(original));await settle();assert.equal(h.button('換一個'),undefined);
 h.reads.at(-1).resolve(own(false,9));await settle();assert.equal(h.blocked.at(-1),false);assert.ok(h.button('自願開始 3 個小任務'));h.cleanup();
});
for(const change of ['client','session','event','user'] as const)test(`actual mission closure isolates late ACK from replaced ${change}`,async()=>{
 const h=harness();await ready(h);h.click('自願開始 3 個小任務');const old=h.writes[0];
 if(change==='client')h.props.client={...h.client};if(change==='session')h.client.sessionGeneration++;if(change==='event')h.props.eventId='event-b';if(change==='user')h.props.userId='member-b';
 h.view();const n=h.reads.length;old.resolve(ack(old));await settle();assert.equal(h.reads.length,n);assert.doesNotMatch(text(h.view()),/操作已確認/);h.cleanup();
});
test('actual mission closure rejects late GET after newer read and after logout',async()=>{
 const h=harness();const old=h.reads[0];h.focus();const newer=h.reads.at(-1);newer.resolve(own(false,5));await settle();old.resolve(own(true,2));await settle();assert.ok(h.button('自願開始 3 個小任務'));assert.equal(h.button('換一個'),undefined);
 h.focus();const pending=h.reads.at(-1);h.end();pending.resolve(own(true,6));await settle();assert.equal(h.button('換一個'),undefined);h.cleanup();
});
test('old clear ACK is not rendered as current state after another start',async()=>{
 const h=harness();await ready(h,own(true,2));h.click('關閉並清除小任務');const clear=h.writes[0];clear.reject(unknown());await settle();h.click('重新讀取');h.reads.at(-1).resolve(own(true,4));await settle();
 h.click('重試原操作');assert.equal(tuple(h.writes[1]),tuple(clear));h.writes[1].resolve(ack(clear));await settle();h.reads.at(-1).resolve(own(true,4));await settle();assert.ok(h.button('換一個'));assert.equal(h.button('自願開始 3 個小任務'),undefined);h.cleanup();
});
for (const [status,code] of [[404,'not_found'],[409,'event_closed']] as const) {
  test(`initial unavailable ${status} is neutral, read-only and recoverable`,async()=>{
    const h=harness();
    h.reads[0].reject(new ApiError({message:'unavailable source',status,code,definitiveResponse:true}));
    await settle();
    assert.equal(find(h.view(),node=>node.props.role==='alert'),undefined);
    assert.match(text(h.view()),/目前無法使用小任務/);
    assert.equal(h.button('自願開始 3 個小任務'),undefined);
    assert.equal(h.writes.length,0);
    h.click('重新讀取');h.reads.at(-1).resolve(own());await settle();
    assert.ok(h.button('自願開始 3 個小任務'));
    assert.doesNotMatch(text(h.view()),/目前無法使用小任務/);
    assert.equal(h.writes.length,0);h.cleanup();
  });
}
for (const [status,code,definitiveResponse] of [[500,'internal',true],[409,'other_conflict',true],[404,'not_found',false]] as const) {
  test(`unexpected read failure ${status}/${code}/${definitiveResponse} remains an alert`,async()=>{
    const h=harness();
    h.reads[0].reject(new ApiError({message:'read failed',status,code,definitiveResponse}));
    await settle();
    assert.ok(find(h.view(),node=>node.props.role==='alert'));
    assert.doesNotMatch(text(h.view()),/目前無法使用小任務/);
    assert.equal(h.writes.length,0);h.cleanup();
  });
}
test('unavailable GET after unknown command cannot downgrade the alert or release its tuple',async()=>{
  const h=harness();await ready(h);h.click('自願開始 3 個小任務');
  const first=h.writes[0];first.reject(unknown());await settle();
  h.click('重新讀取');
  h.reads.at(-1).reject(new ApiError({message:'unavailable source',status:409,code:'event_closed',definitiveResponse:true}));
  await settle();
  assert.ok(find(h.view(),node=>node.props.role==='alert'));
  assert.equal(h.blocked.at(-1),true);
  assert.doesNotMatch(text(h.view()),/目前無法使用小任務/);
  h.click('重試原操作');assert.equal(tuple(h.writes[1]),tuple(first));
  h.writes[1].reject(denied(403));await settle();
  assert.ok(find(h.view(),node=>node.props.role==='alert'));
  assert.equal(h.blocked.at(-1),true);h.cleanup();
});
