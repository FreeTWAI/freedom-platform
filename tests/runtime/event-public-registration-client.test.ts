import {legacyHash} from '../../apps/portal-web/src/portal-route.js';
import * as prizePhotoRules from '../../apps/portal-web/src/modules/event-prize-photo-client.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
// Use the real decoder; the readonly prize child has separate ReactDOM coverage.
import * as prizeRules from '../../modules/community/event-prize-details.js';

const require=createRequire(resolve(process.cwd(),'package.json'));
const {transformSync}=require('esbuild'),{z}=require('zod');
// Run the real component and its handlers with controlled hook/transport ports.
// These tests do not render React DOM, launch a browser, send mail or use a DB.
const compiled=transformSync(readFileSync('apps/portal-web/src/modules/PublicEventPage.tsx','utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
const api=readFileSync('apps/portal-web/src/api.ts','utf8');
const apiClass=api.slice(api.indexOf('export class ApiError'),api.indexOf('export type InstanceSelectionCandidate')).replace('export ','');
const ApiError=runInNewContext(transformSync(apiClass+';globalThis.ApiError=ApiError',{loader:'ts'}).code+';ApiError',{Error});
type Element={type:any;props:any;key?:string};
function text(value:any):string{return Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):typeof value==='string'||typeof value==='number'?String(value):'';}
function find(value:any,predicate:(node:Element)=>boolean):Element|undefined{
  if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const child of value){const found=find(child,predicate);if(found)return found;}return;}
  if(predicate(value))return value;return find(value.props?.children,predicate);
}
const id='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',code='abcdefghijklmnopqrstuvwx';
const event=(patch:Record<string,unknown>={})=>({event_id:id,title:'Synthetic event',description:'Synthetic only',starts_at:'2099-01-01T00:00:00Z',ends_at:'2099-01-01T02:00:00Z',mode:'online',location:'Synthetic location',online_url:null,event_kind:'other',topic:null,visibility:'open',registration_policy:'guest_allowed',capacity:20,attending_count:0,organizer_name:'Fixture',banner_url:null,video_url:null,video_mime:null,...patch});
const ack={registered:true,provider_status:'provider_accepted'};
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
function harness(revalidatePublic=false){
  type Scope={hooks:any[];index:number;effects:(()=>void)[]};
  const outer:Scope={hooks:[],index:0,effects:[]};let inner:Scope={hooks:[],index:0,effects:[]},scope=outer,key:string|undefined;
  const reads:any[]=[],writes:any[]=[],listeners=new Map<string,()=>void>(),storage=new Map<string,string>();
  const client={sessionGeneration:1,get:(path:string,options:any)=>new Promise((resolve,reject)=>reads.push({path,options,resolve,reject})),post:(path:string,body:any,options:any)=>new Promise((resolve,reject)=>writes.push({path,body:JSON.parse(JSON.stringify(body)),options,resolve,reject}))};
  const props:any={client,id,onLogin:()=>{},participationEnabled:false,revalidatePublic};
  const GuestEventParticipation=()=>null;
  const depsEqual=(a:any[],b:any[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);
  const react={
    useRef:(value:any)=>{const at=scope.index++;return scope.hooks[at]??(scope.hooks[at]={current:value});},
    useState:(value:any)=>{const at=scope.index++,target=scope;if(!(at in target.hooks))target.hooks[at]=typeof value==='function'?value():value;return [target.hooks[at],(next:any)=>target.hooks[at]=typeof next==='function'?next(target.hooks[at]):next];},
    useEffect:(fn:()=>any,deps:any[])=>{const at=scope.index++,target=scope;if(!target.hooks[at]||!depsEqual(target.hooks[at].deps,deps)){target.hooks[at]?.cleanup?.();target.hooks[at]={deps};target.effects.push(()=>target.hooks[at].cleanup=fn());}},
  };
  const document={visibilityState:'visible',addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)};
  const location={hash:`#events/${id}?ref=${code}`,pathname:'/',search:''};
  const jsx=(type:any,props:any,key?:string)=>({type,props,key}),module={exports:{} as any};
  runInNewContext(compiled,{module,exports:module.exports,crypto:webcrypto,AbortController,Error,Date,Intl,URL,URLSearchParams,document,
    fetch:(path:string,options:any)=>new Promise((resolve,reject)=>reads.push({path,options,resolve:(value:unknown)=>resolve({ok:true,json:async()=>value}),reject})),
    localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},
    window:{location,addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)},
    require:(name:string)=>{if(name==='../portal-route')return {currentLegacyHash:()=>legacyHash(location.hash)};if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='zod')return {z};if(name==='../api')return {ApiError};if(name==='../format')return {formatIsoLocal:(value:string)=>value};if(name.includes('modules/community/event-prize-details'))return prizeRules;if(name==='./EventPrizePhoto')return {EventPrizePhotoEditor:()=>null};if(name==='./event-prize-photo-client')return prizePhotoRules;if(name==='./EventPrizeDetails')return {EventPrizeDetails:()=>null};if(name==='./EventParticipation')return {GuestEventParticipation,readEventParticipationToken:()=>null};if(name.endsWith('.css'))return {};throw Error(name);},
  });
  function cleanup(){for(const hook of inner.hooks)hook?.cleanup?.();}
  function render(){scope=outer;outer.index=0;const wrapper=module.exports.PublicEventPage(props);if(wrapper.key!==key){cleanup();inner={hooks:[],index:0,effects:[]};key=wrapper.key;}scope=inner;inner.index=0;const tree=wrapper.type(wrapper.props);while(inner.effects.length)inner.effects.shift()!();return tree;}
  const view=()=>{render();return render();};
  const field=(type:string)=>find(view(),node=>node.type==='input'&&(node.props.type??'text')===type)!;
  const fill=(type:string,value:string)=>field(type).props.onChange({target:{value}});
  const form=()=>find(view(),node=>node.type==='form')!;
  const submit=()=>{const target=form();assert.ok(target,'registration form exists');target.props.onSubmit({preventDefault(){}});};
  const button=()=>find(view(),node=>node.type==='button'&&/報名並寄送|重試原報名|寄送中/.test(text(node)))!;
  view();return {props,client,reads,writes,view,field,fill,form,submit,button,cleanup,storage,location,GuestEventParticipation,focus:()=>listeners.get('focus')?.()};
}
async function ready(h:ReturnType<typeof harness>,value=event()){h.reads[0].resolve(value);await settle();h.fill('text','Original guest');h.fill('email','original@example.test');}
const tuple=(request:any)=>JSON.stringify({path:request.path,body:request.body,skipAuthHandler:request.options.skipAuthHandler});

for(const [name,value] of Object.entries({null:null,empty:{},array:[],false:{registered:false,provider_status:'provider_accepted'},missingProvider:{registered:true},pendingProvider:{registered:true,provider_status:'pending'},wrongType:{registered:'true',provider_status:'provider_accepted'}}))test(`invalid HTTP-success registration ${name} never claims confirmation`,async()=>{
  const h=harness();await ready(h);h.submit();h.writes[0].resolve(value);await settle();
  assert.doesNotMatch(text(h.view()),/報名已確認/);assert.match(text(h.view()),/尚未確認/);assert.match(text(h.view()),/重複|再次/);
  assert.equal(h.field('email').props.disabled,true);assert.equal(h.field('text').props.disabled,true);assert.equal(h.writes.length,1);h.cleanup();
});
for(const status of [400,401,403,404,409,412,422,429])test(`unknown registration survives later ${status} and retries original fields only`,async()=>{
  const h=harness();await ready(h);h.submit();const original=h.writes[0];original.reject(new ApiError({message:'lost reply',network:true}));await settle();
  assert.equal(h.field('email').props.disabled,true);h.submit();assert.equal(tuple(h.writes[1]),tuple(original));h.writes[1].reject(new ApiError({message:'later denial',status,definitiveResponse:true}));await settle();
  assert.doesNotMatch(text(h.view()),/報名已確認/);assert.match(text(h.button()),/重試原報名/);assert.equal(h.field('email').props.disabled,true);assert.equal(h.writes.length,2);
  h.submit();assert.equal(tuple(h.writes[2]),tuple(original));h.writes[2].resolve(ack);await settle();assert.match(text(h.view()),/報名已確認/);assert.equal(h.button().props.disabled,true);h.cleanup();
});
for(const status of [400,403,409,422,429])test(`first definitive ${status} permits a corrected draft`,async()=>{
  const h=harness();await ready(h);h.submit();h.writes[0].reject(new ApiError({message:'known denial',status,definitiveResponse:true}));await settle();
  assert.equal(Boolean(h.field('email').props.disabled),false);h.fill('email','corrected@example.test');h.submit();assert.equal(h.writes[1].body.email,'corrected@example.test');h.writes[1].resolve(ack);await settle();assert.match(text(h.view()),/報名已確認/);h.cleanup();
});
test('same-render double submit is locked; confirmed form cannot submit again',async()=>{
  const h=harness();await ready(h);const onSubmit=h.form().props.onSubmit;onSubmit({preventDefault(){}});onSubmit({preventDefault(){}});assert.equal(h.writes.length,1);
  h.writes[0].resolve(ack);await settle();assert.match(text(h.view()),/報名已確認/);h.submit();assert.equal(h.writes.length,1);h.cleanup();
});
for(const change of ['route','client','generation','unmount'] as const)test(`late registration reply cannot update a replaced ${change}`,async()=>{
  const h=harness();await ready(h);h.submit();const old=h.writes[0];
  if(change==='route'){h.props.id=other;h.location.hash=`#events/${other}`;}
  if(change==='client')h.props.client={...h.client};if(change==='generation')h.client.sessionGeneration++;if(change==='unmount')h.cleanup();else h.view();
  old.resolve(ack);if(change!=='unmount')h.reads.at(-1).resolve(event({event_id:h.props.id}));await settle();if(change!=='unmount'){assert.doesNotMatch(text(h.view()),/報名已確認/);assert.equal(h.field('email').props.value,'');assert.equal(h.field('text').props.value,'');}assert.equal(h.writes.length,1);h.cleanup();
});
test('successful receipt retains truthful provider-accepted wording and never stores contact fields',async()=>{
  const h=harness();await ready(h);h.submit();h.writes[0].resolve(ack);await settle();assert.match(text(h.view()),/報名已確認/);assert.match(text(h.view()),/不代表郵件已送達/);assert.doesNotMatch(JSON.stringify([...h.storage]),/original@example.test|Original guest/);h.cleanup();
});


test('failed public refresh never hides the original unknown registration or retries it automatically',async()=>{
  const h=harness(true);await ready(h);h.submit();h.writes[0].reject(new ApiError({message:'lost reply',network:true}));await settle();
  h.focus();h.reads.at(-1).reject(new Error('synthetic public refresh failure'));await settle();
  assert.match(text(h.view()),/尚未確認這次報名結果/);assert.equal(h.writes.length,1);const retry=h.button();assert.ok(retry);retry.props.onClick();
  assert.equal(tuple(h.writes[1]),tuple(h.writes[0]));h.writes[1].resolve(ack);await settle();assert.match(text(h.view()),/報名已確認/);h.cleanup();
});
for(const patch of [{attending_count:20},{starts_at:'2000-01-01T00:00:00Z',ends_at:'2000-01-01T02:00:00Z'},{registration_policy:'community_member'}])test(`public refresh ${JSON.stringify(patch)} retains only the original frozen retry`,async()=>{
  const h=harness(true);await ready(h);h.submit();h.writes[0].reject(new ApiError({message:'lost reply',network:true}));await settle();
  h.focus();h.reads.at(-1).resolve(event(patch));await settle();assert.equal(h.field('email').props.disabled,true);assert.match(text(h.button()),/重試原報名/);assert.equal(h.writes.length,1);
  h.submit();assert.equal(tuple(h.writes[1]),tuple(h.writes[0]));h.writes[1].reject(new ApiError({message:'new admission denied',status:409,definitiveResponse:true}));await settle();assert.match(text(h.view()),/尚未確認這次報名結果/);h.cleanup();
});


test('old client-scope submit handler cannot send old contact data after replacement',async()=>{
  const h=harness();await ready(h);const submit=h.form().props.onSubmit;
  h.props.client={...h.client};h.view();h.reads.at(-1).resolve(event());await settle();
  submit({preventDefault(){}});assert.equal(h.writes.length,0);assert.equal(h.field('email').props.value,'');h.cleanup();
});

for(const failure of [
  {label:'503 definitive',error:new ApiError({message:'服務暫時無法回應（503）。尚未確認結果，請稍後重試。',status:503,network:true,definitiveResponse:true})},
  {label:'503 non-JSON',error:new ApiError({message:'服務暫時無法回應（503）。尚未確認結果，請稍後重試。',status:503,network:true,definitiveResponse:false})},
  {label:'422 definitive',error:new ApiError({message:'報名資料格式不符。',status:422,definitiveResponse:true})},
  {label:'422 non-definitive',error:new ApiError({message:'請求未完成（422），請稍後重試。',status:422,definitiveResponse:false})},
])test(`HTTP ${failure.label} keeps inputs editable and shows one short line with 再試一次`,async()=>{
  const h=harness();await ready(h);h.submit();h.writes[0].reject(failure.error);await settle();
  const rendered=text(h.view());
  assert.doesNotMatch(rendered,/尚未確認/);assert.match(rendered,/再試一次/);
  assert.equal(Boolean(h.field('text').props.disabled),false);assert.equal(Boolean(h.field('email').props.disabled),false);
  h.fill('email','retry@example.test');h.submit();
  assert.equal(h.writes[1].body.email,'retry@example.test');h.writes[1].resolve(ack);await settle();
  assert.match(text(h.view()),/報名已確認/);h.cleanup();
});

test('lost answer (network or timeout) enters unknown state and freezes original draft for retry',async()=>{
  for(const error of [
    new ApiError({message:'無法連線到伺服器，尚未確認結果。請確認網路後重試。',network:true}),
    new ApiError({message:'連線等候過久，尚未確認結果。請稍後重試。',status:503,network:true,timedOut:true}),
  ]){
    const h=harness();await ready(h);h.submit();h.writes[0].reject(error);await settle();
    assert.match(text(h.view()),/尚未確認這次報名結果/);assert.match(text(h.button()),/重試原報名與寄信/);
    assert.equal(h.field('text').props.disabled,true);assert.equal(h.field('email').props.disabled,true);
    h.submit();assert.equal(tuple(h.writes[1]),tuple(h.writes[0]));h.writes[1].resolve(ack);await settle();
    assert.match(text(h.view()),/報名已確認/);h.cleanup();
  }
});

test('deployment without guest registration hides guest form and offers sign-in instead',async()=>{
  const h=harness();h.props.participationEnabled=true;
  h.reads[0].resolve(event({guest_registration_available:false}));await settle();
  const root=h.view();
  assert.equal(Boolean(h.form()),false);
  assert.equal(Boolean(find(root,node=>node.type===h.GuestEventParticipation)),false);
  assert.ok(find(root,node=>node.type==='button'&&/登入/.test(text(node))));
  assert.doesNotMatch(text(root),/報名並寄送參與資料/);
  h.cleanup();
});
