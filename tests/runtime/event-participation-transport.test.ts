import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {transformSync} from 'esbuild';
import {ApiError} from '../../apps/portal-web/src/api.js';

// Actual production hook, controlled promises and hook lifetimes. This is not
// browser rendering, a real email provider or an exactly-once delivery test.
const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/EventParticipation.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm',jsx:'transform'}).code;
function definition(name:string,required=false){
  const start=new RegExp(`^( *)(?:async )?function ${name}\\(`,'m').exec(source);
  if(!start){assert.equal(required,false,`${name} exists`);return '';}
  const tail=source.slice(start.index),end=new RegExp(`^${start[1]}}`,'m').exec(tail);assert.ok(end);return tail.slice(0,end.index+end[0].length);
}
const id='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',at='2099-03-14T06:30:00.000Z';
const participation=(patch:Record<string,unknown>={})=>({event_id:id,event_version:3,event_state:'published',starts_at:at,waitlist_enabled:true,response_window_minutes:30,rsvp_state:null,waitlist:{status:'queued',aggregate_version:1,joined_at:at,invited_at:null,expires_at:null,delivery_status:'pending'},available_seats:0,...patch});
const reminder=(patch:Record<string,unknown>={})=>({version:3,enabled:true,minutes_before_start:30,channel:'in_app',status:'pending',...patch});
type Request={method:'POST'|'PATCH';path:string;body:Record<string,unknown>;version?:number};
const join:Request={method:'POST',path:`/events/${id}/waitlist`,body:{action:'join'},version:2};
function harness(initialToken:string|null=null){
  const hooks:any[]=[],writes:any[]=[],reads:any[]=[];let cursor=0,effects:(()=>void)[]=[],scope=id,token=initialToken;
  const client:any={csrfToken:'synthetic-csrf',sessionGeneration:1,get:async(path:string,options:any)=>{reads.push({path,options});return participation();}};
  for(const method of ['post','patch'])client[method]=(path:string,body:unknown,options:any)=>new Promise((resolve,reject)=>writes.push({method,path,body:structuredClone(body),options,resolve,reject}));
  const globals={ApiError,AbortController,crypto:{randomUUID},options:(value:string|null)=>value?{eventParticipationToken:value,skipAuthHandler:true,suppressConsole:true}:{suppressConsole:true},
    useState:(initial:any)=>{const i=cursor++;hooks[i]??={value:initial};return [hooks[i].value,(value:any)=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value;}];},
    useRef:(initial:any)=>{const i=cursor++;return hooks[i]??=( {current:initial});},
    useCallback:(fn:any)=>{cursor++;return fn;},
    useEffect:(effect:any,deps:any[])=>{const i=cursor++,prior=hooks[i];if(!prior||deps.some((value,index)=>value!==prior.deps[index]))effects.push(()=>{prior?.cleanup?.();hooks[i]={deps,cleanup:effect()};});},
  };
  const code=['participationRecord','participationInteger','participationTime','matchesParticipationAck'].map(name=>definition(name)).join('\n')+'\n'+definition('useParticipationTransport',true)+';useParticipationTransport';
  const useTransport=runInNewContext(code,globals);
  const render=()=>{cursor=0;effects=[];const view=useTransport(client,scope,token);for(const effect of effects)effect();return view;};
  const mutate=(request:Request)=>render().mutate(request.method,request.path,request.body,request.version) as Promise<boolean>;
  const changeOwner=(next:string,nextToken:string|null=token)=>{scope=next;token=nextToken;return render();};
  return {render,mutate,writes,reads,client,changeOwner};
}
const sameRequest=(a:any,b:any)=>{assert.equal(a.method,b.method);assert.equal(a.path,b.path);assert.deepEqual(a.body,b.body);assert.equal(a.options.idempotencyKey,b.options.idempotencyKey);assert.equal(a.options.ifMatch,b.options.ifMatch);assert.equal(a.options.eventParticipationToken,b.options.eventParticipationToken);};

for(const status of [400,401,403,404,409,412,422,429])test(`unknown then ${status} keeps the original command through reload and explicit retry`,async()=>{
  const h=harness(),first=h.mutate(join);h.writes[0].reject(new ApiError({message:'lost reply',status:503}));assert.equal(await first,false);
  const retry=h.render().retryCommand();sameRequest(h.writes[0],h.writes[1]);h.writes[1].reject(new ApiError({message:'later refused',status}));assert.equal(await retry,false);
  let view=h.render();assert.equal(view.retry,true);assert.equal(view.stale,false,'a later 412 must not make the frozen retry impossible');assert.equal(view.blocked,true);assert.equal(view.notice,'');
  await view.get(`/events/${id}/participation`);view.reloaded();view=h.render();
  assert.equal(await view.mutate('POST',join.path,{action:'leave'},9),false);assert.equal(h.writes.length,2,'read/reload never proves the original command outcome or sends again');
  const confirmed=view.retryCommand();sameRequest(h.writes[0],h.writes[2]);h.writes[2].resolve(participation());assert.equal(await confirmed,true);assert.equal(h.render().blocked,false);
});

for(const status of [400,403,409,422,429])test(`a first definite ${status} still permits editing with a new key`,async()=>{
  const h=harness(),first=h.mutate(join);h.writes[0].reject(new ApiError({message:'rejected',status}));assert.equal(await first,false);assert.equal(h.render().blocked,false);
  const next=h.mutate({...join,body:{action:'leave'}});assert.notEqual(h.writes[1].options.idempotencyKey,h.writes[0].options.idempotencyKey);h.writes[1].resolve(participation({waitlist:null}));assert.equal(await next,true);
});

test('first 412 needs a successful reload; only then can a newly chosen version create a new command',async()=>{
  const h=harness(),first=h.mutate(join);h.writes[0].reject(new ApiError({message:'stale',status:412}));await first;
  assert.equal(h.render().stale,true);assert.equal(h.render().retry,false);assert.equal(await h.mutate({...join,version:8}),false);
  h.render().reloaded();const next=h.mutate({...join,version:8});assert.equal(h.writes[1].options.ifMatch,8);assert.notEqual(h.writes[1].options.idempotencyKey,h.writes[0].options.idempotencyKey);h.writes[1].resolve(participation({event_version:8}));assert.equal(await next,true);
});

for(const [name,value] of Object.entries({null:null,empty:{},array:[],wrongEvent:participation({event_id:other}),unsafeVersion:participation({event_version:Number.MAX_SAFE_INTEGER+1}),olderVersion:participation({event_version:1}),badTime:participation({starts_at:'invalid'}),badState:participation({event_state:'other'}),arrayState:participation({event_state:['published']}),arrayRsvp:participation({rsvp_state:['going']}),missingRsvp:participation({rsvp_state:undefined}),negativeSeats:participation({available_seats:-1}),badWaitlist:participation({waitlist:{status:'queued'}}),missingJoin:participation({waitlist:null})}))test(`malformed participation ACK ${name} cannot confirm or discard the frozen operation`,async()=>{
  const h=harness(),sent=h.mutate(join);h.writes[0].resolve(value);assert.equal(await sent,false);const view=h.render();assert.equal(view.retry,true);assert.equal(view.receipt,null);assert.equal(view.notice,'');
  const retry=view.retryCommand();sameRequest(h.writes[0],h.writes[1]);h.writes[1].resolve(participation());assert.equal(await retry,true);
});

const cases:[string,Request,unknown,string|null][]=[
  ['join can immediately invite',join,participation({waitlist:{status:'invited',aggregate_version:2,joined_at:at,invited_at:at,expires_at:'2099-03-14T07:00:00.000Z',delivery_status:'unknown'}}),null],
  ['leave missing row no-op',{...join,body:{action:'leave'}},participation({event_version:2,waitlist:null}),null],
  ['decline expired row no-op',{...join,body:{action:'decline'}},participation({event_version:2,waitlist:{status:'expired',aggregate_version:3,joined_at:'2000-01-01T00:00:00.000Z',invited_at:'2000-01-01T00:00:00.000Z',expires_at:'2000-01-02T00:00:00.000Z',delivery_status:'failed'}}),null],
  ['accept historical receipt after deadline',{...join,body:{action:'accept'}},participation({rsvp_state:'going',starts_at:'2000-01-01T00:00:00.000Z',waitlist:{status:'accepted',aggregate_version:4,joined_at:'1999-01-01T00:00:00.000Z',invited_at:'1999-01-01T00:00:00.000Z',expires_at:'1999-01-02T00:00:00.000Z',delivery_status:'recorded'}}),null],
  ['guest register without waitlist',{...join,path:`/public/events/${id}/participation`,body:{action:'register'}},participation({rsvp_state:'going',waitlist:null}),'synthetic-capability'],
  ['guest cancel missing RSVP',{...join,path:`/public/events/${id}/participation`,body:{action:'cancel'}},participation({rsvp_state:null,waitlist:null}),'synthetic-capability'],
  ['disable absent reminder',{method:'PATCH',path:`/events/${id}/reminder`,body:{enabled:false},version:1},reminder({version:1,enabled:false,minutes_before_start:null,channel:null,status:null}),null],
  ['disable retains previous settings',{method:'PATCH',path:`/events/${id}/reminder`,body:{enabled:false},version:2},reminder({enabled:false,status:'cancelled'}),null],
  ['enable retains prior recorded attempt',{method:'PATCH',path:`/events/${id}/reminder`,body:{enabled:true,minutes_before_start:30,channel:'in_app'},version:2},reminder({status:'recorded'}),null],
  ['guest reminder is frozen with command and version',{method:'PATCH',path:`/public/events/${id}/reminder`,body:{enabled:true,minutes_before_start:30,channel:'email'},version:2},reminder({channel:'email',status:'provider_accepted'}),'synthetic-capability'],
  ['policy may advance multiple versions',{method:'PATCH',path:`/events/${id}/waitlist-policy`,body:{waitlist_enabled:false,response_window_minutes:null},version:2},participation({event_version:7,waitlist_enabled:false,response_window_minutes:null}),null],
  ['schedule may no-op and use an equivalent offset',{method:'PATCH',path:`/events/${id}/schedule`,body:{starts_at:'2099-03-14T14:30:00+08:00',ends_at:'2099-03-14T16:30:00+08:00',capacity:20},version:2},participation({event_version:2}),null],
];
for(const [name,request,result,token] of cases)test(`canonical ACK: ${name}`,async()=>{
  const h=harness(token),sent=h.mutate(request);if(token){assert.equal(h.writes[0].body.expected_version,request.version);if(request.path.endsWith('/reminder'))assert.equal(h.writes[0].body.command_id,h.writes[0].options.idempotencyKey);}
  h.writes[0].resolve(result);assert.equal(await sent,true);assert.equal(h.render().retry,false);assert.equal(h.writes.length,1);
});

for(const [name,request,result] of [
  ['enabled reminder cannot be cancelled',{method:'PATCH',path:`/events/${id}/reminder`,body:{enabled:true,minutes_before_start:30,channel:'in_app'},version:2},reminder({status:'cancelled'})],
  ['disabled reminder cannot be pending',{method:'PATCH',path:`/events/${id}/reminder`,body:{enabled:false},version:2},reminder({enabled:false})],
  ['absent reminder must have null settings',{method:'PATCH',path:`/events/${id}/reminder`,body:{enabled:false},version:1},reminder({version:1,enabled:false,status:null})],
  ['saved reminder cannot look absent',{method:'PATCH',path:`/events/${id}/reminder`,body:{enabled:false},version:2},reminder({enabled:false,status:null,minutes_before_start:null,channel:null})],
  ['enabled reminder must consume absent version',{method:'PATCH',path:`/events/${id}/reminder`,body:{enabled:true,minutes_before_start:30,channel:'in_app'},version:1},reminder({version:1})],
  ['wrong reminder enabled',{method:'PATCH',path:`/events/${id}/reminder`,body:{enabled:false},version:2},reminder()],
  ['wrong reminder minutes',{method:'PATCH',path:`/events/${id}/reminder`,body:{enabled:true,minutes_before_start:60,channel:'in_app'},version:2},reminder()],
  ['wrong reminder channel',{method:'PATCH',path:`/public/events/${id}/reminder`,body:{enabled:true,minutes_before_start:30,channel:'email'},version:2},reminder()],
  ['wrong policy',{method:'PATCH',path:`/events/${id}/waitlist-policy`,body:{waitlist_enabled:false,response_window_minutes:null},version:2},participation()],
  ['wrong schedule start',{method:'PATCH',path:`/events/${id}/schedule`,body:{starts_at:'2099-03-15T06:30:00Z',ends_at:'2099-03-15T08:30:00Z',capacity:null},version:2},participation()],
  ['accept not going',{...join,body:{action:'accept'}},participation()],
  ['management request false',{method:'POST',path:`/public/events/${id}/participation-request`,body:{name:'Fixture',email:'fixture@example.test'}},{requested:false,provider_status:'provider_accepted'}],
  ['management request not accepted',{method:'POST',path:`/public/events/${id}/participation-request`,body:{name:'Fixture',email:'fixture@example.test'}},{requested:true,provider_status:'pending'}],
] as [string,Request,unknown][])test(`unmatched ACK: ${name}`,async()=>{const h=harness(),sent=h.mutate(request);h.writes[0].resolve(result);assert.equal(await sent,false);assert.equal(h.render().retry,true);assert.equal(h.render().notice,'');});

test('management-mail retry warns about duplicate delivery and preserves exact fields, without automatic resend',async()=>{
  const h=harness(),body={name:'Fixture',email:'fixture@example.test'},sent=h.mutate({method:'POST',path:`/public/events/${id}/participation-request`,body});h.writes[0].reject(new ApiError({message:'unknown provider result',status:503}));await sent;body.email='edited@example.test';
  assert.match(h.render().error,/可能.*(?:再次|重複|重寄)/);h.render();h.render();assert.equal(h.writes.length,1);
  const retry=h.render().retryCommand();sameRequest(h.writes[0],h.writes[1]);assert.equal(h.writes[1].body.email,'fixture@example.test');h.writes[1].resolve({requested:true,provider_status:'provider_accepted'});assert.equal(await retry,true);
});

test('in-flight deduplication and a changed owner ignore stale replies without clearing the new command',async()=>{
  const h=harness(),old=h.mutate(join);assert.equal(await h.mutate(join),false);assert.equal(h.writes.length,1);
  h.changeOwner(other);const current=h.mutate({...join,path:`/events/${other}/waitlist`});assert.equal(h.writes[0].options.signal.aborted,true);
  h.writes[0].resolve(participation());assert.equal(await old,false);assert.equal(h.render().busy,true);
  h.writes[1].resolve(participation({event_id:other}));assert.equal(await current,true);assert.equal(h.render().busy,false);
});

for(const [name,cause] of [
  ['unknown status zero',new ApiError({message:'unknown'})],
  ['network failure',new ApiError({message:'incomplete body',status:200,network:true})],
  ['non-API exception',new Error('connection lost')],
] as const)test(`${name} retains the original request and permits only one explicit retry in flight`,async()=>{
  const h=harness(),sent=h.mutate(join);h.writes[0].reject(cause);assert.equal(await sent,false);assert.equal(h.render().retry,true);
  const retry=h.render().retryCommand();assert.equal(await h.render().retryCommand(),false);assert.equal(h.writes.length,2);sameRequest(h.writes[0],h.writes[1]);h.writes[1].resolve(participation());assert.equal(await retry,true);
});

test('private capability changes abort old writes and do not settle a new owner with an old response',async()=>{
  const request={...join,path:`/public/events/${id}/participation`},h=harness('synthetic-old-token'),old=h.mutate(request);
  h.changeOwner(id,'synthetic-new-token');const current=h.mutate(request);assert.equal(h.writes[0].options.signal.aborted,true);assert.equal(h.writes[1].options.eventParticipationToken,'synthetic-new-token');
  h.writes[0].resolve(participation());assert.equal(await old,false);assert.equal(h.render().busy,true);h.writes[1].resolve(participation());assert.equal(await current,true);
});
