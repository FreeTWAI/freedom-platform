import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';

// Actual leaf handlers + actual shared mutation engine, with synthetic ports.
// This is not a React lifecycle, browser, database or live permission test.
const source=readFileSync('apps/portal-web/src/modules/Squads.tsx','utf8');
const outcomeSource=readFileSync('apps/portal-web/src/modules/SquadOutcomes.tsx','utf8');
function between(value:string,start:string,end:string){const a=value.indexOf(start),b=value.indexOf(end,a);assert.ok(a>=0&&b>a);return value.slice(a,b);}
const api=readFileSync('apps/portal-web/src/api.ts','utf8');
const ApiError=runInNewContext(stripTypeScriptTypes(between(api,'export class ApiError','export type InstanceSelectionCandidate').replace('export ',''))+';ApiError',{Error});
const shared=readFileSync('apps/portal-web/src/modules/shared.tsx','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const perform=runInNewContext(stripTypeScriptTypes(shared)+';performModuleMutation',{ApiError,Error,crypto:globalThis.crypto});
const decoder=stripTypeScriptTypes(between(source,'type SquadCommand=','const emptyCreate').replace('export ',''));
const sender=stripTypeScriptTypes(between(source,'  async function sendCommand','  async function retryOriginal'));
const blocker=stripTypeScriptTypes(between(source,'  function blocksLeave()','  useEffect(()=>'));
const plain=(value:unknown)=>JSON.parse(JSON.stringify(value));
const outcome={outcome_id:'outcome-a',squad_id:'squad-a',title:'Synthetic title',summary:'Synthetic summary',artifact_url:null,author:{user_id:'self',display_name:'Synthetic'},audience:'squad',state:'draft',aggregate_version:1};
function harness(responses:unknown[]=[]){
 const calls:{path:string;body:any;options:any}[]=[];let alive=true,hold=false,pending:any=null;
 const held:((value:unknown)=>void)[]=[];
 const mutationState={keys:new Map(),snapshot:{busy:false,error:null,lastFailureUnknown:false},listeners:new Set(),live:()=>alive};
 const commandRef={current:null as any},inFlight={current:false};
 const client={post:async(path:string,body:any,options:any)=>{
  calls.push(plain({path,body,options}));
  if(hold)return new Promise(resolve=>held.push(resolve));
  const result=responses[calls.length-1]??outcome;
  if(result instanceof Error)throw result;return result;
 }};
 const context={ApiError,Error,JSON,Object,Number,Date,selfId:'self',openSquad:{current:null},open:async()=>{},mutationState,commandRef,inFlight,commandLive:()=>alive,
  setPendingCommand:(value:unknown)=>{pending=value;},setNotice:()=>{},
  baseMutate:(...args:any[])=>perform(client,mutationState,...args)};
 const handlers=runInNewContext(decoder+sender+blocker+';({mutate,sendCommand,blocksLeave})',context);
 return {calls,mutationState,commandRef,handlers,get pending(){return pending;},
  send:(path='/squads/squad-a/outcomes',body:any={title:'Synthetic title',summary:'Synthetic summary'},version?:number)=>handlers.mutate(path,body,version),
  retry:()=>handlers.sendCommand(commandRef.current,true),
  hold:()=>{hold=true;},release:()=>{hold=false;for(const resolve of held.splice(0))resolve(outcome);},
  expire:()=>{alive=false;},
 };
}
const rejected=(status:number,network=false)=>new ApiError({message:'Synthetic rejection',status,network,definitiveResponse:!network});
for(const denied of [403,404,412])test(`unknown then ${denied}: same original path/body/version/key remains recoverable`,async()=>{
 const h=harness([rejected(503,true),rejected(denied),outcome]);
 await h.send('/squad-outcomes/outcome-a/edit',{title:'Original',summary:'Original'},7);
 const original=plain(h.calls[0]);assert.equal(h.handlers.blocksLeave(),true);assert.ok(h.pending);
 await h.retry();assert.ok(h.pending);assert.equal(h.handlers.blocksLeave(),true);
 await h.send('/squads/other/request',{},99);assert.equal(h.calls.length,2,'other writes cannot replace the unknown command');
 await h.retry();assert.equal(h.calls.length,3);for(const call of h.calls)assert.deepEqual(call,original);
 assert.equal(h.pending,null);assert.equal(h.handlers.blocksLeave(),false);
});
test('same-stack duplicates cannot replace the original command before React renders',async()=>{
 const h=harness();h.hold();const first=h.send(),second=h.send('/squads/other/request',{},9);
 assert.equal(h.calls.length,1);assert.equal(h.handlers.blocksLeave(),true);h.release();await Promise.all([first,second]);assert.equal(h.pending,null);
});
test('caller edits after submit cannot change the frozen retry body',async()=>{
 const h=harness([rejected(0,true),outcome]),body={title:'Original',summary:'Original'};
 await h.send('/squads/squad-a/outcomes',body);body.title='Changed';await h.retry();assert.deepEqual(h.calls[0],h.calls[1]);assert.equal(h.calls[1].body.title,'Original');
});
for(const status of [400,409,412,429])test(`initial definitive ${status} permits editing without pretending success`,async()=>{
 const h=harness([rejected(status),outcome]);assert.equal(await h.send(),undefined);assert.equal(h.pending,null);assert.equal(h.handlers.blocksLeave(),false);
 await h.send();assert.notEqual(h.calls[0].options.idempotencyKey,h.calls[1].options.idempotencyKey);
});
test('malformed successful response remains unknown and preserves the original key',async()=>{
 const h=harness([{},outcome]);assert.equal(await h.send(),undefined);assert.ok(h.pending);await h.retry();assert.deepEqual(h.calls[0],h.calls[1]);
});
test('session expiry fences a late command result and all later calls',async()=>{
 const h=harness();h.hold();const first=h.send();h.expire();h.release();assert.equal(await first,undefined);await h.send();assert.equal(h.calls.length,1);
});
test('lost outcome-create response recovers one receipt rather than creating a second draft',async()=>{
 const h=harness([rejected(0,true),outcome]);await h.send();await h.retry();
 const receiptKeys=new Set(h.calls.map(call=>call.options.idempotencyKey));assert.equal(receiptKeys.size,1);assert.deepEqual(h.calls[0].body,h.calls[1].body);
});
test('publisher save uses the shared frozen command and never invents a new key',async()=>{
 const h=harness([rejected(0,true),outcome]);let edited:any=null;
 const save=runInNewContext(stripTypeScriptTypes(between(outcomeSource,' async function save(',' async function action('))+';save',{
  busy:false,owner:true,editing:null,title:'Synthetic title',summary:'Synthetic summary',url:'',squadId:'squad-a',mutate:h.handlers.mutate,draftLive:()=>true,
  setReading(){},setError(){},setNotice(){},edit:(result:any)=>{edited=result;},load:async()=>{},errorMessage:(e:Error)=>e.message,
 });
 await save({preventDefault(){}});assert.equal(edited,null);await save({preventDefault(){}});assert.equal(h.calls.length,1,'save again is not an implicit retry');
 await h.retry();assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0],h.calls[1]);
 assert.doesNotMatch(outcomeSource,/client\.post|crypto\.randomUUID/);
});
for(const consent of [false,true])for(const dirty of [false,true])test(`publishing remains explicit: consent=${consent}, dirty=${dirty}`,async()=>{
 let count=0;
 const action=runInNewContext(stripTypeScriptTypes(between(outcomeSource,' async function action(',' return <section'))+';action',{
  busy:false,owner:true,consent,dirty,audience:'public',editing:outcome,mutate:async()=>{count++;return {...outcome,state:'published'};},draftLive:()=>true,
  setReading(){},setError(){},setNotice(){},setConsent(){},edit(){},load:async()=>{},errorMessage:(e:Error)=>e.message,ApiError,Error,
 });
 await action(outcome,'publish');assert.equal(count,consent&&!dirty?1:0);
});
test('draft, view and permission boundaries are wired to existing scope rather than storage or new authority',()=>{
 assert.match(source,/useAuthoringDraft\(selfId,'squads:create',emptyCreate\)/);
 assert.match(source,/isOwner&&visitedInvites&&<div hidden=\{!inviting\}/);
 assert.match(source,/isOwner&&visitedManage&&<div hidden=\{inviting\}/);
 assert.match(source,/\[401,403,404\]\.includes\(e.status\)/);
 assert.match(source,/registerLeave\?\.\(\(\)=>\{if\(!blocksLeave\(\)\)return true/);
 assert.match(source,/onConfirmationApplied=\{\(\)=>setConfirmedOutcome\(null\)\}/);
 assert.match(outcomeSource,/owner&&<details/);assert.match(outcomeSource,/token!==request.current\|\|!draftLive\(\)/);
 assert.doesNotMatch(source+outcomeSource,/localStorage|sessionStorage/);
 const feature=readFileSync('apps/portal-web/src/features/guilds.tsx','utf8');
 assert.match(feature,/SquadsPanel key=\{`\$\{session.user.user_id\}:\$\{client.sessionGeneration\}`\}/);
 assert.match(feature,/registerLeave=\{registerPageLeave\}/);
});

test('outcome list only accepts the newest response and fences expired-session results',async()=>{
 const reads:{resolve:(v:any)=>void;reject:(e:Error)=>void}[]=[],request={current:0};let items:any[]=[],alive=true,error='',loading=false;
 const loadCode=stripTypeScriptTypes(between(outcomeSource,' const load=useCallback(',' useEffect(()=>{setItems'));
 const load=runInNewContext(loadCode+';load',{
  useCallback:(fn:any)=>fn,client:{get:()=>new Promise((resolve,reject)=>reads.push({resolve,reject}))},squadId:'squad-a',request,draftLive:()=>alive,
  setLoading:(v:boolean)=>{loading=v;},setError:(v:string)=>{error=v;},setItems:(next:any)=>{items=typeof next==='function'?next(items):next;},setNextOffset(){},errorMessage:(e:Error)=>e.message,
 });
 const old=load(),fresh=load();reads[1].resolve({items:[{outcome_id:'fresh'}],next_offset:null});await fresh;
 reads[0].resolve({items:[{outcome_id:'stale-private'}],next_offset:null});await old;
 assert.deepEqual(plain(items),[{outcome_id:'fresh'}]);assert.equal(loading,false);assert.equal(error,'');
 const expired=load();alive=false;reads[2].resolve({items:[{outcome_id:'previous-session'}],next_offset:null});await expired;
 assert.deepEqual(plain(items),[{outcome_id:'fresh'}]);
});
test('permission re-read is not mistaken for acknowledgement of an unknown write',async()=>{
 const h=harness([rejected(0,true)]);await h.send('/squads/squad-a/disband',{},7);
 assert.equal(h.handlers.blocksLeave(),true);assert.ok(h.commandRef.current);
 assert.match(source,/if\(result===undefined&&openSquad.current\)await open\(openSquad.current\)/);
 assert.match(source,/if\(text\)setNotice\(text\)/,'failure refresh must not erase the notice that stale controls were removed');
});

test('a response for a different target is not an acknowledgement of the original intent',async()=>{
 const h=harness([{...outcome,squad_id:'different-squad'},outcome]);await h.send();assert.ok(h.pending);assert.equal(h.handlers.blocksLeave(),true);
 await h.retry();assert.deepEqual(h.calls[0],h.calls[1]);assert.equal(h.pending,null);
});

const decode=runInNewContext(decoder+';confirmedSquadCommand',{Error,Number,Date});
const invitation={invitation_id:'inv-a',squad_id:'squad-a',squad_name:'Synthetic squad',owner_ref:'owner',recipient_ref:'self',recipient_name:'Synthetic recipient',state:'accepted',aggregate_version:'2'};
const commandResponses:[string,Record<string,unknown>,unknown][]=[
 ['/squads',{squad_id:'squad-a',owner_ref:'self',name:'Synthetic',purpose:'Synthetic',aggregate_version:'1'},{}],
 ['/squads/squad-a/profile',{squad_id:'squad-a',name:'Synthetic',purpose:'Synthetic',aggregate_version:'2'},{}],
 ['/squads/squad-a/channel',{squad_id:'squad-a',communication_channel_name:'',aggregate_version:'2'},{}],
 ['/squads/squad-a/transfer',{squad_id:'squad-a',owner_ref:'heir',aggregate_version:'2'},{user_id:'heir'}],
 ['/squads/squad-a/disband',{squad_id:'squad-a',disbanded_at:'2026-10-30T00:00:00.000Z',aggregate_version:'2'},{}],
 ['/squads/squad-a/request',{squad_id:'squad-a',user_id:'self',state:'pending',aggregate_version:'1'},{}],
 ['/squads/squad-a/leave',{squad_id:'squad-a',user_id:'self',state:'left',aggregate_version:'2'},{}],
 ['/squads/squad-a/members/peer/accept',{squad_id:'squad-a',user_id:'peer',state:'active',aggregate_version:'2'},{}],
 ['/squads/squad-a/members/peer/decline',{squad_id:'squad-a',user_id:'peer',state:'left',aggregate_version:'2'},{}],
 ['/squads/squad-a/members/peer/remove',{squad_id:'squad-a',user_id:'peer',state:'left',aggregate_version:'3'},{}],
 ['/squads/squad-a/invitations',{...invitation,owner_ref:'self',recipient_ref:'peer',state:'pending'},{recipient_ref:'peer'}],
 ['/squad-invitations/inv-a/accept',invitation,{}],
 ['/squad-invitations/inv-a/decline',{...invitation,state:'declined'},{}],
 ['/squad-invitations/inv-a/withdraw',{...invitation,owner_ref:'self',state:'withdrawn'},{}],
 ['/squads/squad-a/outcomes',outcome,{}],
 ['/squad-outcomes/outcome-a/edit',outcome,{}],
 ['/squad-outcomes/outcome-a/publish',{...outcome,state:'published',audience:'public'},{audience:'public'}],
 ['/squad-outcomes/outcome-a/withdraw',{...outcome,state:'withdrawn'},{}],
];
for(const [path,response,body] of commandResponses)test(`existing response contract is accepted: ${path}`,()=>{
 assert.deepEqual(decode(response,path,'self',body),response);
 for(const version of [0,-1,1.5,'9007199254740992','9999999999999999999999999999999999999999999',null,undefined])assert.throws(()=>decode({...response,aggregate_version:version},path,'self',body));
});
test('outcome acknowledgement must match the original actor, action state and publication audience',()=>{
 for(const path of ['/squads/squad-a/outcomes','/squad-outcomes/outcome-a/edit','/squad-outcomes/outcome-a/publish','/squad-outcomes/outcome-a/withdraw']){
  assert.throws(()=>decode({...outcome,author:{...outcome.author,user_id:'another'}},path,'self',{audience:'public'}));
 }
 assert.throws(()=>decode(outcome,'/squad-outcomes/outcome-a/publish','self',{audience:'public'}));
 assert.throws(()=>decode({...outcome,state:'published',audience:'community'},'/squad-outcomes/outcome-a/publish','self',{audience:'public'}));
 assert.throws(()=>decode({...outcome,state:'published'},'/squads/squad-a/outcomes','self',{}));
 assert.throws(()=>decode(outcome,'/squad-outcomes/outcome-a/withdraw','self',{}));
});
test('aggregate outcome drafts warn before unload even after their detail is closed',()=>{
 let unload:((event:any)=>void)|undefined,cleanup:(()=>void)|undefined;
 const dirtyOutcomesRef={current:{'squad-a':true,'squad-b':false}},draftRef={current:{name:'',purpose:'',communication_channel_name:''}};
 const guardSource=between(source,'  useEffect(()=>{\n    registerLeave?','  async function sendCommand');
 runInNewContext(stripTypeScriptTypes(guardSource),{useEffect:(fn:()=>()=>void)=>{cleanup=fn();},registerLeave:()=>{},mutationState:{},blocksLeave:()=>false,setNotice:()=>{},dirtyOutcomesRef,draftRef,Object,Boolean,
  window:{addEventListener:(_name:string,fn:any)=>{unload=fn;},removeEventListener:()=>{unload=undefined;}}});
 let prevented=0;const event={preventDefault(){prevented++;},returnValue:''};unload!(event);assert.equal(prevented,1);
 dirtyOutcomesRef.current['squad-a']=false;unload!(event);assert.equal(prevented,1);
 draftRef.current.name='Unsaved creation';unload!(event);assert.equal(prevented,2);cleanup!();assert.equal(unload,undefined);
});
test('a confirmed create cannot steal newer detail navigation while its list reload is pending',async()=>{
 let resolve!:()=>void;const detailRequest={current:0},opens:unknown[]=[];
 const created=runInNewContext(stripTypeScriptTypes(between(source,'  async function created(','  async function create('))+';created',{
  detailRequest,emptyCreate:{},setCreateDraft(){},setNotice(){},setCreating(){},setQuery(){},setKind(){},setOnlyMine(){},
  load:()=>new Promise<void>(yes=>{resolve=yes;}),open:async(...args:any[])=>{opens.push(args);},createTrigger:{current:null},
 });
 const pending=created({squad_id:'created-squad'});detailRequest.current++;resolve();await pending;assert.deepEqual(opens,[]);
});

test('a later list refresh failure cannot turn an acknowledged save into an unknown write',async()=>{
 const h=harness([outcome]);let edited:any=null,error='',notice='';
 const save=runInNewContext(stripTypeScriptTypes(between(outcomeSource,' async function save(',' async function action('))+';save',{
  busy:false,owner:true,editing:null,title:'Synthetic title',summary:'Synthetic summary',url:'',squadId:'squad-a',mutate:h.handlers.mutate,draftLive:()=>true,
  setReading(){},setError:(value:string)=>{error=value;},setNotice:(value:string)=>{notice=value;},edit:(result:any)=>{edited=result;},
  load:async()=>{throw new Error('Synthetic later list failure');},errorMessage:(e:Error)=>e.message,
 });
 await save({preventDefault(){}});assert.equal(edited.outcome_id,outcome.outcome_id);assert.match(notice,/草稿已儲存/);assert.equal(error,'Synthetic later list failure');
 assert.equal(h.pending,null);assert.equal(h.mutationState.keys.size,0);assert.equal(h.mutationState.snapshot.lastFailureUnknown,false);assert.equal(h.handlers.blocksLeave(),false);assert.equal(h.calls.length,1);
});
