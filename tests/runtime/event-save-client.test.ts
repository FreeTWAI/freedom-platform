import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {ApiError} from '../../apps/portal-web/src/api.js';
const {transformSync}=createRequire(resolve(process.cwd(),'package.json'))('esbuild');
// Actual TSX and shared mutation with deterministic hooks/transport ports.
// This proves handler behavior, not React DOM, browser, real mail or hosted CI.
const source=readFileSync('apps/portal-web/src/modules/EventsPanel.tsx','utf8');
const compiled=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
const shared=transformSync(readFileSync('apps/portal-web/src/modules/shared.tsx','utf8'),{loader:'tsx',format:'cjs'}).code;
const id='20000000-0000-4000-8000-000000000001',userId='20000000-0000-4000-8000-000000000002';
type Element={type:any;props:any;key?:string};
function text(value:any):string{return Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):typeof value==='string'||typeof value==='number'?String(value):'';}
function find(value:any,predicate:(node:Element)=>boolean):Element|undefined{if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const child of value){const result=find(child,predicate);if(result)return result;}return;}if(predicate(value))return value;return find(value.props?.children,predicate);}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
const stored=(overrides:any={})=>({event_id:id,organizer_ref:userId,organizer_name:'Synthetic member',title:'Original title',description:'Original description',starts_at:'2030-01-01T12:00:00.000Z',ends_at:'2030-01-01T13:00:00.000Z',mode:'online',location:'Original location',event_kind:'other',topic:null,online_url:null,visibility:'workshop',banner_url:null,banner_orientation:null,video_url:null,video_mime:null,registration_policy:'community_member',help_need:null,capacity:null,state:'pending',aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:'guild_member_operations',can_review:false,review_reason:null,...overrides});
function harness(options:{deferPassiveCleanup?:boolean;deferPrepare?:boolean}={}){
  type Scope={hooks:any[];index:number;effects:(()=>void)[]};
  const delayedCleanups:Scope[]=[],outer:Scope={hooks:[],index:0,effects:[]};let inner:Scope={hooks:[],index:0,effects:[]},scope=outer,key:string|undefined;
  const reads:any[]=[],writes:any[]=[],media:any[]=[],preparations:any[]=[],listeners=new Map<string,any>(),notices:any[]=[];
  let guard:(()=>boolean)|null=null;
  const client={sessionGeneration:1,csrfToken:'original-session',get:(path:string)=>new Promise((resolve,reject)=>reads.push({path,resolve,reject})),post:(path:string,body:any,options:any)=>new Promise((resolve,reject)=>writes.push({path,body:structuredClone(body),options,resolve,reject}))};
  const props:any={client,session:{user:{user_id:userId}},locationHash:'#events',registerLeave:(value:any)=>guard=value,onList:()=>{}};
  const depsEqual=(a:any[],b:any[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);
  const react={useRef:(value:any)=>{const at=scope.index++;return scope.hooks[at]??(scope.hooks[at]={current:value});},
    useState:(value:any)=>{const at=scope.index++,target=scope;if(!(at in target.hooks))target.hooks[at]=typeof value==='function'?value():value;return [target.hooks[at],(next:any)=>target.hooks[at]=typeof next==='function'?next(target.hooks[at]):next];},
    useCallback:(fn:any,deps:any[])=>{const at=scope.index++;if(!scope.hooks[at]||!depsEqual(scope.hooks[at].deps,deps))scope.hooks[at]={fn,deps};return scope.hooks[at].fn;},
    useEffect:(fn:()=>any,deps:any[])=>{const at=scope.index++,target=scope;if(!target.hooks[at]||!depsEqual(target.hooks[at].deps,deps)){target.hooks[at]?.cleanup?.();target.hooks[at]={deps};target.effects.push(()=>target.hooks[at].cleanup=fn());}},
    useLayoutEffect:(fn:()=>any,deps:any[])=>{const at=scope.index++,target=scope;if(!target.hooks[at]||!depsEqual(target.hooks[at].deps,deps)){target.hooks[at]?.cleanup?.();target.hooks[at]={deps,layout:true};target.effects.push(()=>target.hooks[at].cleanup=fn());}},
    useSyncExternalStore:(_subscribe:any,snapshot:any)=>{scope.index++;return snapshot();}};
  const jsx=(type:any,props:any,key?:string)=>({type,props,key});const module={exports:{} as any},mutation={exports:{} as any};
  runInNewContext(shared,{module:mutation,exports:mutation.exports,crypto:webcrypto,Error,require:(name:string)=>name==='react'?react:name==='../api'?{ApiError}:{}});
  const require=(name:string)=>{
    if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='../api')return {ApiError};if(name==='./shared')return mutation.exports;
    if(name==='../format')return {formatIsoLocal:(v:string)=>v,hoursFromNowLocalInput:(n:number)=>n===24?'2030-01-01T12:00':'2030-01-01T13:00',localInputToIso:(v:string)=>new Date(v).toISOString()};
    if(name==='./member-inbox')return {announceInboxChange:()=>notices.push('inbox')};if(name==='./social-image')return {prepareSocialImage:async(file:any)=>file};
    if(name==='./event-banner-client')return {prepareEventMedia:async(c:any,value:any,file:any,kind:string)=>{const command:any={eventId:value.event_id,version:value.aggregate_version,file,kind,generation:c.sessionGeneration,csrfToken:c.csrfToken};preparations.push(command);if(options.deferPrepare)return new Promise(resolve=>{command.resolve=()=>resolve(command);});return command;},sendEventMedia:(c:any,command:any)=>new Promise((resolve,reject)=>media.push({client:c,command,resolve,reject})),readEventMedia:(c:any,command:any)=>c.get(`/events/${command.eventId}`),currentMediaEvent:(a:any,b:any)=>a.aggregate_version>b.aggregate_version?a:b};
    if(name.endsWith('.css'))return {};if(['./EventCalendar','./EventParticipation','./EventAttendees','./EventHelpers'].includes(name))return new Proxy({},{get:()=>()=>null});throw Error(name);
  };
  runInNewContext(compiled,{module,exports:module.exports,require,crypto:webcrypto,Error,Date,Intl,URL,URLSearchParams,Event:class{},window:{location:{pathname:'/',hash:'#events',search:'',origin:'http://synthetic.test'},confirm:()=>false,addEventListener:(name:string,fn:any)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name),dispatchEvent:()=>notices.push('world')},localStorage:{getItem:()=>null,setItem:()=>{}},navigator:{}});
  const clean=(target:Scope,layoutOnly=false)=>{for(const hook of target.hooks)if(!layoutOnly||hook?.layout)hook?.cleanup?.();};
  function render(){scope=outer;outer.index=0;let tree=module.exports.EventsPanel(props);if(typeof tree.type==='function'){if(tree.key!==key){clean(inner,options.deferPassiveCleanup);if(options.deferPassiveCleanup)delayedCleanups.push(inner);inner={hooks:[],index:0,effects:[]};key=tree.key;}scope=inner;inner.index=0;tree=tree.type(tree.props);while(inner.effects.length)inner.effects.shift()!();}while(outer.effects.length)outer.effects.shift()!();return tree;}
  const view=()=>{render();return render();};
  const button=(label:string)=>find(view(),node=>node.type==='button'&&text(node)===label);
  const click=(label:string)=>{const target=button(label);assert.ok(target,`button ${label}`);target.props.onClick({currentTarget:{focus(){}}});};
  const form=()=>find(view(),node=>node.type==='form')!;
  const fields=()=>find(form(),node=>node.type===module.exports.EventFields)!;
  const fill=(change:any)=>{const f=fields();assert.ok(f,'event fields');f.props.onChange({...f.props.value,...change});};
  const submit=()=>{const target=form();assert.ok(target,'event form');target.props.onSubmit({preventDefault(){}});view();};
  const choose=(kind:'banner'|'video')=>{const input=find(form(),node=>node.type==='input'&&node.props.type==='file'&&node.props.accept.includes(kind==='banner'?'image/':'video/'))!;input.props.onChange({target:{files:[new File(['synthetic'],kind+'.'+(kind==='banner'?'png':'mp4'),{type:kind==='banner'?'image/png':'video/mp4'})]}});};
  view();return {props,client,reads,writes,media,preparations,notices,view,button,click,form,fields,fill,submit,choose,leave:()=>guard?.(),cleanup:()=>{clean(outer);clean(inner);for(const old of delayedCleanups)clean(old);},beforeUnload:()=>{let prevented=false;listeners.get('beforeunload')?.({preventDefault(){prevented=true},returnValue:undefined});return prevented;}};
}
async function ready(h:ReturnType<typeof harness>,items:any[]=[]){for(const read of h.reads.splice(0))read.resolve({items:read.path==='/events'?items:[]});await settle();h.view();}
async function create(h:ReturnType<typeof harness>){await ready(h);h.click('辦活動');h.fill({title:'Original title',description:'Original description',location:'Original location'});}
const tuple=(call:any)=>JSON.stringify({path:call.path,body:call.body,options:call.options});
const ack=(call:any,overrides:any={})=>stored({...call.body,title:call.body.title.trim(),description:call.body.description.trim(),location:call.body.location.trim(),help_need:call.body.help_need??null,aggregate_version:call.options.ifMatch===undefined?1:call.options.ifMatch+1,...overrides});
const unknown=()=>new ApiError({message:'lost ACK',network:true});
const denied=(status:number)=>new ApiError({message:'synthetic request refusal',status,definitiveResponse:true});

for(const [label,replace] of Object.entries({null:()=>null,empty:()=>({}),array:()=>[],wrongId:(a:any)=>({...a,event_id:'not-an-event'}),wrongOwner:(a:any)=>({...a,organizer_ref:'other-member'}),wrongTitle:(a:any)=>({...a,title:'other title'}),wrongVersion:(a:any)=>({...a,aggregate_version:2}),stringVersion:(a:any)=>({...a,aggregate_version:'1'}),wrongState:(a:any)=>({...a,state:'published'}),wrongDate:(a:any)=>({...a,ends_at:'invalid'}),arrayStart:(a:any)=>({...a,starts_at:[a.starts_at]}),arrayEnd:(a:any)=>({...a,ends_at:[a.ends_at]}),wrongPolicy:(a:any)=>({...a,registration_policy:'guest_allowed'}),wrongHelp:(a:any)=>({...a,help_need:'unrequested'})}))test(`metadata ${label} success cannot settle the draft or start media`,async()=>{
  const h=harness();await create(h);h.choose('video');h.submit();h.writes[0].resolve(replace(ack(h.writes[0])));await settle();
  assert.equal(h.fields().props.disabled,true);assert.equal(h.leave(),false);assert.equal(h.beforeUnload(),true);assert.equal(h.preparations.length,0);assert.doesNotMatch(text(h.view()),/活動已送出審核/);h.cleanup();
});
for(const status of [400,401,403,404,409,412,422,429])test(`unknown metadata remains frozen after later ${status} until original receipt`,async()=>{
  const h=harness();await create(h);h.submit();const first=h.writes[0];first.reject(unknown());await settle();h.submit();assert.equal(tuple(h.writes[1]),tuple(first));h.writes[1].reject(denied(status));await settle();
  assert.equal(h.fields().props.disabled,true);assert.equal(h.leave(),false);h.click('辦活動');assert.equal(h.fields().props.value.title,'Original title');
  h.submit();assert.equal(tuple(h.writes[2]),tuple(first));h.writes[2].resolve(ack(first));await settle();assert.match(text(h.view()),/活動已送出審核/);assert.equal(h.form(),undefined);h.cleanup();
});
for(const status of [400,409,412,422,429])test(`initial definitive ${status} permits correction with a new tuple`,async()=>{
  const h=harness();await create(h);h.submit();h.writes[0].reject(denied(status));await settle();assert.equal(h.fields().props.disabled,false);h.fill({title:'Corrected'});h.submit();assert.equal(h.writes[1].body.title,'Corrected');assert.notEqual(h.writes[1].options.idempotencyKey,h.writes[0].options.idempotencyKey);h.writes[1].resolve(ack(h.writes[1]));await settle();assert.match(text(h.view()),/活動已送出審核/);h.cleanup();
});
test('same-render duplicate submit stays locked through pending media, then closes exactly once',async()=>{
  const h=harness();await create(h);h.choose('video');const handler=h.form().props.onSubmit;handler({preventDefault(){}});handler({preventDefault(){}});assert.equal(h.writes.length,1);h.writes[0].resolve(ack(h.writes[0]));await settle();assert.equal(h.media.length,1);
  assert.equal(h.fields().props.disabled,true);assert.equal(h.leave(),false);h.submit();assert.equal(h.writes.length,1);h.media[0].resolve(stored({aggregate_version:2,video_url:'/synthetic-video',video_mime:'video/mp4'}));await settle();assert.match(text(h.view()),/活動已送出審核/);assert.equal(h.notices.filter(x=>x==='inbox').length,1);h.cleanup();
});
for(const change of ['generation','client','user','unmount'] as const)test(`late metadata ACK and stale handler cannot cross ${change}`,async()=>{
  const h=harness();await create(h);h.choose('video');const stale=h.form().props.onSubmit;stale({preventDefault(){}});const first=h.writes[0];
  if(change==='generation'){h.client.sessionGeneration++;h.client.csrfToken='new-session';}if(change==='client')h.props.client={...h.client,csrfToken:'replacement-session'};if(change==='user')h.props.session={user:{user_id:'other-member'}};
  if(change==='unmount')h.cleanup();else h.view();first.resolve(ack(first));await settle();stale({preventDefault(){}});await settle();assert.equal(h.preparations.length,0);assert.equal(h.writes.length,1);assert.equal(h.notices.length,0);
  if(change!=='unmount'){await ready(h);h.click('辦活動');assert.equal(h.fields().props.value.title,'');assert.equal(h.fields().props.value.description,'');}h.cleanup();
});
test('session change while first media is pending cannot start the second file',async()=>{
  const h=harness();await create(h);h.choose('banner');await settle();h.choose('video');h.submit();h.writes[0].resolve(ack(h.writes[0]));await settle();assert.equal(h.media.length,1);
  h.client.sessionGeneration++;h.client.csrfToken='new-session';h.view();h.media[0].resolve(stored({aggregate_version:2,banner_url:'/synthetic-banner',banner_orientation:'landscape'}));await settle();assert.equal(h.media.length,1);assert.equal(h.preparations.length,1);assert.equal(h.notices.length,0);h.cleanup();
});
test('update retry accepts the original historical snapshot after its start time and preserves expected version',async t=>{
  const h=harness();await ready(h,[stored({aggregate_version:9})]);h.click('編輯草稿');h.fill({title:'  Trimmed title  ',description:'  Trimmed description  ',location:'  Trimmed location  ',help_need:'  Help needed  '});h.submit();const first=h.writes[0];assert.equal(first.options.ifMatch,9);first.reject(unknown());await settle();t.mock.method(Date,'now',()=>Date.UTC(2031,0,1));h.submit();assert.equal(tuple(h.writes[1]),tuple(first));
  h.writes[1].resolve(ack(first,{starts_at:'2030-01-01T20:00:00+08:00',ends_at:'2030-01-01T21:00:00+08:00',help_need:'Help needed'}));await settle();assert.match(text(h.view()),/活動已更新，仍待審核/);h.cleanup();
});

for(const change of ['client','user'] as const)test(`committed ${change} replacement revokes the old save before passive cleanup`,async()=>{
  const h=harness({deferPassiveCleanup:true});await create(h);h.choose('video');h.submit();const first=h.writes[0];
  if(change==='client')h.props.client={...h.client};else h.props.session={user:{user_id:'replacement-member'}};
  h.view();first.resolve(ack(first));await settle();assert.equal(h.preparations.length,0);assert.equal(h.media.length,0);assert.equal(h.notices.length,0);h.cleanup();
});
test('late media preparation cannot issue an upload after the owner changes',async()=>{
  const h=harness({deferPrepare:true});await create(h);h.choose('video');h.submit();h.writes[0].resolve(ack(h.writes[0]));await settle();assert.equal(h.preparations.length,1);assert.equal(h.media.length,0);
  h.client.sessionGeneration++;h.client.csrfToken='new-session';h.view();h.preparations[0].resolve();await settle();assert.equal(h.media.length,0);assert.equal(h.notices.length,0);h.cleanup();
});
test('automatic media reconciliation holds the save lock and replays only the original media command',async()=>{
  const h=harness();await create(h);h.choose('video');h.submit();h.writes[0].resolve(ack(h.writes[0]));await settle();h.media[0].reject(unknown());await settle();
  const read=h.reads.find(call=>call.path===`/events/${id}`);assert.ok(read);assert.equal(h.fields().props.disabled,true);h.submit();assert.equal(h.writes.length,1);assert.equal(h.media.length,1);assert.equal(h.leave(),false);
  read.resolve(stored({aggregate_version:2,video_url:'/synthetic-video',video_mime:'video/mp4'}));await settle();assert.equal(h.media.length,2);assert.equal(h.media[1].command,h.media[0].command);
  h.media[1].resolve(stored({aggregate_version:2,video_url:'/synthetic-video',video_mime:'video/mp4'}));await settle();assert.match(text(h.view()),/活動已送出審核/);assert.equal(h.form(),undefined);h.cleanup();
});
test('late reconciliation read cannot replay media into a replacement owner',async()=>{
  const h=harness({deferPassiveCleanup:true});await create(h);h.choose('video');h.submit();h.writes[0].resolve(ack(h.writes[0]));await settle();h.media[0].reject(unknown());await settle();const read=h.reads.find(call=>call.path===`/events/${id}`);assert.ok(read);
  h.props.client={...h.client};h.view();read.resolve(stored({aggregate_version:2,video_url:'/synthetic-video',video_mime:'video/mp4'}));await settle();assert.equal(h.media.length,1);assert.equal(h.notices.length,0);h.cleanup();
});
