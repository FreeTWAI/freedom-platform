import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import React from 'react';
import {transformSync} from 'esbuild';

const source=readFileSync('apps/portal-web/src/modules/PositioningPanels.tsx','utf8');
const extract=(from:string,to:string)=>{const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start,'actual handler extraction boundary');return source.slice(start,end);};
const ownerCode=extract('  function currentCategoryOwner(','  async function sendPreference(');
const code=stripTypeScriptTypes(ownerCode+extract('  async function sendPreference(','  async function submitFresh(')+extract('  async function leaveV2(','  async function change('));
const apiSource=readFileSync('apps/portal-web/src/api.ts','utf8');
const apiStart=apiSource.indexOf('export class ApiError'),apiEnd=apiSource.indexOf('export type InstanceSelectionCandidate',apiStart);assert.ok(apiStart>=0&&apiEnd>apiStart);
const ApiError=runInNewContext(stripTypeScriptTypes(apiSource.slice(apiStart,apiEnd).replace('export ',''))+';ApiError',{Error});
const guild={guild_key:'fixture',name:'Synthetic guild',membership:{aggregate_version:3}};
const draft={category:'internal',guild_key:'fixture',catalog_revision:'revision-1',guildName:'Synthetic guild',actionGuild:'fixture'};
function harness(statuses:(number|{status:number;network?:boolean;timedOut?:boolean}|null)[]){
 const calls:{path:string;body:any;options:any}[]=[],state:any={unknown:null,unknownLeave:null,leaveDraft:{guild,section:'Synthetic section'},note:'',error:null,held:null};
 const attempts=new Map(),pending={current:null},flight={current:false};
 const heldResolves:((value:unknown)=>void)[]=[];let hold=false;
 const context:any={ApiError,Error,failure:(error:Error)=>error.message,crypto:globalThis.crypto,preferenceKeys:{current:attempts},categoryPending:pending,categoryInFlight:flight,categoryEpoch:{current:0},board:{view:{aggregate_version:7}},
  client:{post:async(path:string,body:any,options:any)=>{calls.push({path,body,options});if(hold)return new Promise(resolve=>{heldResolves.push(resolve);});const status=statuses[calls.length-1];if(status!==null&&status!==undefined)throw new ApiError({message:'Synthetic rejection',...(typeof status==='number'?{status}:status)});return{aggregate_version:8};}},
  setCategoryBusy:()=>{},setCategoryNote:(value:string)=>state.note=value,setError:(value:any)=>state.error=value,setHeld:(value:any)=>state.held=value,
  setUnknownDraft:(value:any)=>state.unknown=value,setUnknownLeave:(value:any)=>state.unknownLeave=value,setLeaveDraft:(value:any)=>state.leaveDraft=value,
  setBoard:(next:any)=>{context.board=typeof next==='function'?next(context.board):next;},announce:()=>{},setFocusAction:()=>{},window:{dispatchEvent:()=>{}},Event:class{},SECTION_LABELS:{internal:'Synthetic section'},load:async()=>{},
 };
 context.categoryOwner={current:{client:context.client,sessionGeneration:context.client.sessionGeneration,active:true}};context.categoryClient={current:context.client};
 const functions=runInNewContext(code+';({sendPreference,leaveV2})',context);
 const send=(kind:'set'|'leave',other=false)=>kind==='set'?functions.sendPreference({...draft,...(other?{guild_key:'other'}:{})},7):functions.leaveV2({...guild,...(other?{guild_key:'other'}:{})},true,'Synthetic section');
 return {calls,state,attempts,send,
  retry:(kind:'set'|'leave')=>kind==='set'?functions.sendPreference(state.unknown?.draft??draft,state.unknown?.version??7):functions.leaveV2(state.unknownLeave?.guild??guild,true,'Synthetic section',state.unknownLeave??undefined),
  refreshBoard:()=>{context.board={view:{aggregate_version:99}};},boardVersion:()=>context.board.view.aggregate_version,
  hold:()=>{hold=true;},release:()=>{hold=false;for(const resolve of heldResolves.splice(0))resolve({aggregate_version:8});},
 };
}
for(const kind of ['set','leave'] as const){
 test(`${kind}: an initial definitive rejection permits a new attempt`,async()=>{
  const h=harness([400,null]);await h.send(kind);await h.send(kind);assert.equal(new Set(h.calls.map(c=>c.options.idempotencyKey)).size,2);
 });
 for(const denied of [403,412])test(`${kind}: unknown then ${denied} keeps the original visible retry, tuple and key until ACK`,async()=>{
  const h=harness([503,denied,null]);await h.send(kind);const original=h.calls[0];await h.retry(kind);
  assert.ok(h.state.note,'unknown retry must remain visible after a denied replay');
  assert.ok(kind==='set'?h.state.unknown:h.state.unknownLeave,'original retry is retained');
  if(kind==='leave'){assert.ok(h.state.leaveDraft,'denied replay must not clear the confirmation');h.refreshBoard();}
  await h.retry(kind);assert.equal(h.calls.length,3);for(const call of h.calls)assert.equal(JSON.stringify(call),JSON.stringify(original));
  assert.equal(h.attempts.size,0,'ACK releases the original attempt');assert.equal(h.state.unknown,null);assert.equal(h.state.unknownLeave,null);
 });
 test(`${kind}: a timed-out 4xx body is still unknown, not an acknowledged rejection`,async()=>{
  const h=harness([{status:412,network:true},403,null]);await h.send(kind);await h.retry(kind);await h.retry(kind);
  assert.equal(new Set(h.calls.map(c=>c.options.idempotencyKey)).size,1);
 });
 test(`${kind}: pending unknown cannot be replaced by a different command`,async()=>{
  const h=harness([503,null]);await h.send(kind);await h.send(kind,true);await h.send(kind==='set'?'leave':'set');assert.equal(h.calls.length,1);
 });
 test(`${kind}: an in-flight command rejects programmatic duplicate invocation`,async()=>{
  const h=harness([]);h.hold();const first=h.send(kind),second=h.send(kind);h.release();await first;await second;assert.equal(h.calls.length,1);
 });
}

// Execute the real server orchestrator with synthetic authority/receipt ports.
// This verifies ordering, not a database or network integration.
const coreSource=readFileSync('packages/db/command-core.ts','utf8'),coreStart=coreSource.indexOf('export async function runCommandCore');assert.ok(coreStart>=0);
const requireCondition=(condition:boolean,status:number,code:string)=>{if(!condition)throw Object.assign(new Error(code),{status});};
const runner=async(_pool:unknown,run:(q:unknown)=>Promise<unknown>)=>run({});
const commandCore=runInNewContext(stripTypeScriptTypes(coreSource.slice(coreStart).replace('export ',''))+';runCommandCore',{transaction:runner,requireCondition});
test('current authority still precedes receipt replay; the original key recovers ACK while a replacement hits version conflict',async()=>{
 const receipts=new Map();let denied=false,version=7,effects=0;
 const call=(key:string)=>commandCore({}, {authenticateAndLock:async()=>requireCondition(!denied,403,'denied'),lockReceipt:async()=>{},requestDigest:()=>JSON.stringify({body:{guild_key:'fixture'},expected:7}),readReceipt:async()=>receipts.get(key)??null,writeReceipt:async(_q:unknown,hash:string,response:unknown)=>{receipts.set(key,{request_sha256:hash,response});}},async()=>{},async()=>{requireCondition(version===7,412,'version_conflict');effects++;return{version:++version};});
 await call('original');denied=true;await assert.rejects(call('original'),{status:403});denied=false;await assert.rejects(call('replacement'),{status:412});
 assert.equal((await call('original')).version,8);assert.equal(effects,1);
});

const cardSource=readFileSync('apps/portal-web/src/modules/GuildCard.tsx','utf8');
const cardStart=cardSource.indexOf('type GuildPanel='),cardEnd=cardSource.indexOf('// Measure intrinsic content',cardStart);assert.ok(cardStart>=0&&cardEnd>cardStart);
const cardCode=transformSync(cardSource.slice(cardStart,cardEnd),{loader:'tsx',jsxFactory:'React.createElement',target:'es2023'}).code;
const GuildCard=runInNewContext(cardCode.replace('export function GuildCard','function GuildCard')+';GuildCard',{React,useState:(value:unknown)=>[value,()=>{}],useRef:(value:unknown)=>({current:value}),useEffect:()=>{},useId:()=> 'fixture',useLanguage:()=>({language:'zh-Hant'}),guildMasterLabel:()=>'',GuildName:()=>null,GuildLeadership:()=>null,GuildTags:()=>null,SkillBookIntro:()=>null,SkillBookStarGate:()=>null});
const nodes=(value:any):any[]=>Array.isArray(value)?value.flatMap(nodes):React.isValidElement(value)?[value,...nodes((value.props as any).children)]:[];
const text=(value:any):string=>Array.isArray(value)?value.map(text).join(''):React.isValidElement(value)?text((value.props as any).children):typeof value==='string'?value:'';
test('GuildCard unknown-write blocking affects mutation controls only, with the default unchanged',()=>{
 for(const category of [false,true])for(const blocked of [false,true]){
  const tree=GuildCard({guild:{...guild,membership:{...guild.membership,state:'active'},skill_books:[],purpose:'Synthetic',first_step:'Read',is_primary:false},client:{sessionGeneration:1},busy:false,...(blocked?{writesBlocked:true}:{}),onPrimary:()=>{},onMembership:()=>{},onSecondary:()=>{},categorySlot:category?{pending:false,selected:false,section:'Synthetic',onToggle:()=>{}}:undefined});
  const buttons=nodes(tree).filter(n=>n.type==='button');
  for(const label of category?['設為本類主力','退出Synthetic guild']:['設為主要公會','設為次要公會','退出Synthetic guild'])assert.equal(Boolean(buttons.find(n=>text(n.props.children)===label)?.props.disabled),blocked,label);
  for(const label of ['進入公會','查看成員','公會公告']){const button=buttons.find(n=>text(n.props.children)===label);assert.ok(button,label);assert.equal(Boolean(button.props.disabled),false,label);}
 }
});

for(const kind of ['set','leave'] as const)test(`${kind}: an initial version conflict retains only the existing editable recovery behavior`,async()=>{
 const h=harness([412]);await h.send(kind);assert.equal(h.state.unknown,null);assert.equal(h.state.unknownLeave,null);
 if(kind==='set')assert.ok(h.state.held);else assert.equal(h.state.leaveDraft,null);
});
test('all new preference or membership entry handlers refuse programmatic writes while an original attempt is pending',async()=>{
 const boundaries=[['async function change(','async function primary(','change'],['async function primary(','function cancelSecondaryEditor(','primary'],['async function saveSecondary(','async function apply(','saveSecondary'],['async function toggleSecondary(','if(launchpadKey)return','toggleSecondary'],['function toggleCategory(','async function leaveV2(','toggleCategory'],['async function submitFresh(','function toggleCategory(','submitFresh']];
 for(const [from,to,name] of boundaries){
  const fn=runInNewContext(stripTypeScriptTypes(extract(from,to))+';'+name,{categoryPending:{current:'original-request'},categoryInFlight:{current:false},board:{},setApplicationSuccess:()=>{throw new Error('write entry passed its pending guard');}});
  await fn(name==='saveSecondary'?{preventDefault(){}}:guild);
 }
});

test('an acknowledged old preference receipt cannot regress a newer board read',async()=>{
 const h=harness([503,403,null]);await h.send('set');await h.retry('set');h.refreshBoard();await h.retry('set');
 assert.equal(h.boardVersion(),99);assert.equal(h.state.unknown,null);assert.equal(h.attempts.size,0);
});
for(const kind of ['set','leave'] as const)test(`${kind}: explicit timedOut metadata stays unknown even without the network flag`,async()=>{
 const h=harness([{status:400,timedOut:true},403,null]);await h.send(kind);await h.retry(kind);await h.retry(kind);
 assert.equal(new Set(h.calls.map(c=>c.options.idempotencyKey)).size,1);
});
for(const outcome of ['success','failure'] as const)test(`an obsolete submitFresh ${outcome} cannot mutate a newer pending command or its busy state`,async()=>{
 let resolve!:(value:unknown)=>void,reject!:(error:Error)=>void;
 const updates:string[]=[];
 const pending:{current:string|null}={current:null},flight={current:false},epoch={current:0};
 const ctx={categoryPending:pending,categoryInFlight:flight,categoryEpoch:epoch,client:{get:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})},setCategoryBusy:()=>updates.push('busy'),setCategoryNote:()=>updates.push('note'),setError:()=>updates.push('error'),setBoard:()=>updates.push('board'),sendPreference:async()=>updates.push('send')};
 const context:any=ctx;context.categoryOwner={current:{client:ctx.client,sessionGeneration:undefined,active:true}};context.categoryClient={current:ctx.client};
 const submit=runInNewContext(stripTypeScriptTypes(ownerCode+extract('  async function submitFresh(','  function toggleCategory('))+';submitFresh',ctx);
 const reading=submit(draft);updates.length=0;pending.current='newer-command';flight.current=true;epoch.current++;
 if(outcome==='success')resolve({migration_state:'switched',aggregate_version:99});else reject(new Error('obsolete read failed'));
 await reading;assert.deepEqual(updates,[]);assert.equal(pending.current,'newer-command');assert.equal(flight.current,true);
});

// Actual PortalClient token/session accessors; network delivery remains a
// deterministic synthetic port. No live credentials or cross-account requests.
const authBegin=apiSource.indexOf('export class PortalClient {'),authEnd=apiSource.indexOf('  onUnauthorized:',authBegin);
assert.ok(authBegin>=0&&authEnd>authBegin);
const AuthClient=runInNewContext(stripTypeScriptTypes(apiSource.slice(authBegin,authEnd).replace('export ','')+'}')+';PortalClient',{Map});
const ownerEffect=extract('  useEffect(()=>{const owner=categoryOwner.current;','  useEffect(()=>{if(launchpadKey)');
function lifetimeHarness(){
 const client=new AuthClient();client.csrfToken='synthetic-A';
 const updates:string[]=[],calls:any[]=[],gets:{resolve:(value:unknown)=>void;reject:(error:Error)=>void}[]=[],posts:{resolve:(value:unknown)=>void;reject:(error:Error)=>void}[]=[],loads:(()=>void)[]=[];
 let cleanup!:()=>void,holdLoad=false;
 client.get=()=>new Promise((resolve,reject)=>gets.push({resolve,reject}));
 client.post=(path:string,body:unknown,options:unknown)=>{calls.push({path,body,options,session:client.sessionGeneration,csrf:client.csrfToken});return new Promise((resolve,reject)=>posts.push({resolve,reject}));};
 const context:any={client,categoryOwner:{current:{client,sessionGeneration:client.sessionGeneration,active:true}},categoryClient:{current:client},categoryEpoch:{current:0},categoryPending:{current:null},categoryInFlight:{current:false},preferenceKeys:{current:new Map()},board:{view:{aggregate_version:7}},
  useEffect:(run:()=>()=>void)=>cleanup=run(),ApiError,Error,crypto:globalThis.crypto,failure:(e:Error)=>e.message,SECTION_LABELS:{internal:'Synthetic section'},Event:class{},window:{dispatchEvent:()=>updates.push('profile-event')},load:async()=>{updates.push('load');if(holdLoad)await new Promise<void>(resolve=>loads.push(resolve));},
 };
 for(const setter of ['setCategoryBusy','setCategoryNote','setError','setHeld','setUnknownDraft','setUnknownLeave','setLeaveDraft','setBoard','announce','setFocusAction'])context[setter]=()=>updates.push(setter);
 runInNewContext(stripTypeScriptTypes(ownerEffect),context);
 const functions=runInNewContext(code+stripTypeScriptTypes(extract('  async function submitFresh(','  function toggleCategory('))+';({sendPreference,leaveV2,submitFresh})',context);
 return {updates,calls,gets,posts,functions,context,client,cleanup:()=>cleanup(),
  cleanupAndReactivate:()=>{cleanup();runInNewContext(stripTypeScriptTypes(ownerEffect),context);},
  switchSession:()=>{client.csrfToken=null;client.csrfToken='synthetic-B';},replaceClient:()=>{context.categoryClient.current=new AuthClient();},
  holdLoad:()=>{holdLoad=true;},releaseLoad:()=>{for(const resolve of loads.splice(0))resolve();},
  send:(kind:'set'|'leave')=>kind==='set'?functions.sendPreference(draft,7):functions.leaveV2(guild,true,'Synthetic section'),
 };
}
for(const change of ['cleanup','switchSession','replaceClient','cleanupAndReactivate'] as const){
 for(const outcome of ['success','failure'] as const)test(`held category GET ${outcome} after ${change} neither dispatches nor updates`,async()=>{
  const h=lifetimeHarness();const pending=h.functions.submitFresh(draft);h.updates.length=0;h[change]();
  if(outcome==='success')h.gets[0].resolve({migration_state:'switched',aggregate_version:7});else h.gets[0].reject(new Error('stale read failure'));
  await pending;assert.deepEqual(h.calls,[]);assert.deepEqual(h.updates,[]);
 });
 for(const kind of ['set','leave'] as const){
  if(change!=='cleanupAndReactivate')test(`${kind}: old handler entry after ${change} cannot dispatch`,async()=>{const h=lifetimeHarness();h[change]();await h.send(kind);assert.deepEqual(h.calls,[]);assert.deepEqual(h.updates,[]);});
  for(const outcome of ['success','failure'] as const)test(`${kind}: POST ${outcome} after ${change} has no stale local/event/read effects`,async()=>{
   const h=lifetimeHarness();const pending=h.send(kind);assert.equal(h.calls.length,1);h.updates.length=0;h[change]();
   if(outcome==='success')h.posts[0].resolve({aggregate_version:8});else h.posts[0].reject(new ApiError({message:'stale failure',status:503}));
   await pending;assert.deepEqual(h.updates,[]);assert.equal(h.calls.length,1);
  });
 }
}
test('leaving a guild cannot broadcast after its post-ACK read outlives the owner',async()=>{
 const h=lifetimeHarness();h.holdLoad();const pending=h.send('leave');h.posts[0].resolve({});await new Promise(resolve=>setImmediate(resolve));
 assert.ok(h.updates.includes('load'));h.updates.length=0;h.cleanup();h.switchSession();h.releaseLoad();await pending;assert.deepEqual(h.updates,[]);
});
test('same-owner held read can submit, ACK and release its original command',async()=>{
 const h=lifetimeHarness();const pending=h.functions.submitFresh(draft);h.gets[0].resolve({migration_state:'switched',aggregate_version:7});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].session,h.client.sessionGeneration);h.posts[0].resolve({aggregate_version:8});await pending;
 assert.equal(h.context.categoryPending.current,null);assert.equal(h.context.categoryInFlight.current,false);assert.ok(h.updates.includes('profile-event'));
});

test('StrictMode setup cleanup setup permits a new intent but cannot revive the old held GET',async()=>{
 const h=lifetimeHarness();const old=h.functions.submitFresh(draft);h.cleanupAndReactivate();const current=h.functions.submitFresh({...draft,guild_key:'new-intent'});
 h.updates.length=0;h.gets[0].resolve({migration_state:'switched',aggregate_version:7});await old;assert.deepEqual(h.calls,[]);assert.deepEqual(h.updates,[]);
 h.gets[1].resolve({migration_state:'switched',aggregate_version:9});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.guild_key,'new-intent');assert.equal(h.calls[0].options.ifMatch,9);
 h.posts[0].resolve({aggregate_version:10});await current;assert.equal(h.context.categoryInFlight.current,false);assert.equal(h.context.categoryPending.current,null);
});
