import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Execute both real spec callbacks with synthetic browser/SQL ports. These are
// lifecycle regressions, not browser rendering or PostgreSQL integration tests.
const source=readFileSync(new URL('../e2e/guild-member-tiers.spec.ts',import.meta.url),'utf8');
const compiled=transformSync(source,{loader:'ts',format:'cjs',target:'es2023'}).code;
type Failure='seed-user'|'seed-membership'|'seed-officer'|'newContext'|'route'|'newPage'|'goto'|'login'|'body';
type Options={fail?:Failure;close?:boolean;cleanup?:boolean;existingOfficer?:boolean;attachmentFails?:boolean};
const tables=['positioning_guild_experts','positioning_guild_officers','member_notifications','member_skill_book_grants','command_receipts','outbox','transition_journal','positioning_profession_memberships','sessions','users'];

function harness(options:Options={}){
 const primary=new Error(options.fail??'unused primary failure');
 const closeError=new Error('synthetic context close failed');
 const cleanupError=new Error('synthetic user cleanup failed');
 const attachments:{name:string;body:string}[]=[];
 const calls:string[]=[],deleted:string[]=[],createdIds:string[]=[],users=new Set<string>();
 let officer:string|undefined=options.existingOfficer?'unrelated-officer':undefined;
 const fail=(stage:Failure)=>{if(options.fail===stage)throw primary;};
 const locator:Record<string,unknown>={};
 for(const key of ['getByRole','getByLabel','getByText','locator','first'])locator[key]=()=>locator;
 for(const key of ['click','selectOption','scrollIntoViewIfNeeded'])locator[key]=async()=>{};
 locator.fill=async()=>{fail('login');};
 const page={...locator,goto:async()=>{calls.push('goto');fail('goto');},setViewportSize:async()=>{},evaluate:async()=>true};
 const context={
  route:async()=>{calls.push('route');fail('route');},
  newPage:async()=>{calls.push('newPage');fail('newPage');return page;},
  close:async()=>{calls.push('close');if(options.close)throw closeError;},
 };
 const browser={newContext:async()=>{calls.push('newContext');fail('newContext');return context;}};
 const db={query:async(sql:string,params:unknown[]=[])=>{
  if(sql.startsWith('SELECT name'))return {rows:[{name:'Synthetic guild'}]};
  if(sql.startsWith('INSERT INTO users')){
   fail('seed-user');createdIds.push(params[0] as string);users.add(params[0] as string);
  }else if(sql.startsWith('INSERT INTO positioning_profession_memberships'))fail('seed-membership');
  else if(sql.startsWith('INSERT INTO positioning_guild_officers')){
   fail('seed-officer');assert.equal(officer,undefined,'the preceding fixture must release the officer key');officer=params[2] as string;
  }else if(sql.startsWith('DELETE FROM ')){
   const table=/^DELETE FROM (\w+)/.exec(sql)![1];deleted.push(table);calls.push(`delete:${table}`);
   const ids=params.find(Array.isArray) as string[]|undefined;
   assert.ok(ids,'cleanup remains constrained to fixture user IDs');
   assert.ok(ids.length>0);assert.ok(!ids.includes('unrelated-officer'));
   if(table==='positioning_guild_officers'&&officer&&ids.includes(officer))officer=undefined;
   if(table==='users'){
    if(options.cleanup)throw cleanupError;
    for(const id of ids)users.delete(id);
   }
  }
  return {rows:[]};
 }};
 const cases:{name:string;run:(args:unknown,info?:unknown)=>Promise<void>}[]=[];
 const register=Object.assign((name:string,run:(args:unknown,info?:unknown)=>Promise<void>)=>cases.push({name,run}),{setTimeout:(ms:number)=>assert.equal(ms,120_000)});
 const expect=()=>({toBeVisible:async()=>{},toHaveText:async()=>{},toHaveCount:async()=>{},toContainText:async()=>{},toBeDisabled:async()=>{},toBe:()=>{}});
 const diagnostics=runInNewContext(compiled+'\nactivityDiagnostics();',{AggregateError,Buffer,require:(name:string)=>{
  if(name==='node:crypto')return {randomUUID};
  if(name==='./fixtures.js')return {test:register,expect};
  if(name==='./navigation.js')return {navigate:async()=>{calls.push('body');fail('body');}};
  if(name.endsWith('/testing/seed.js'))return {DEMO_COMMUNITY:'synthetic-community',DEMO_PASSWORD:'synthetic-password'};
  if(name.endsWith('/identity-membership/service.js'))return {hashPassword:()=> 'synthetic-hash'};
  throw new Error(`Unexpected spec dependency: ${name}`);
 }});
 assert.equal(cases.length,2);
 return {diagnostics,attachments,cases,calls,deleted,createdIds,users,primary,closeError,cleanupError,officer:()=>officer,run:(index:number)=>cases[index].run({browser,baseURL:'http://127.0.0.1:4311',e2eAuthPool:db},{attach:async(name:string,attachment:{body:Buffer})=>{attachments.push({name,body:attachment.body.toString('utf8')});if(options.attachmentFails)throw new Error('attachment unavailable');}})};
}

function errorsAre(expected:unknown[]){
 return (error:unknown)=>{
  if(expected.length===1)assert.equal(error,expected[0]);
  else{
   assert.ok(error instanceof AggregateError);
   assert.deepEqual(error.errors,expected);
   assert.equal(error.cause,expected[0]);
  }
  return true;
 };
}

for(const index of [0,1]){
 const label=index===0?'intern':'master';
 test(`${label} fixture: successful journeys clean exactly once and permit another seed`,async()=>{
  const h=harness();await h.run(index);
  assert.deepEqual(h.deleted,tables);assert.equal(h.users.size,0);assert.equal(h.officer(),undefined);
  assert.equal(h.calls.filter(call=>call==='close').length,1);
  assert.ok(h.calls.indexOf('close')<h.calls.indexOf('delete:positioning_guild_officers'));
  await h.run(1-index);assert.equal(h.users.size,0);assert.equal(h.officer(),undefined);
 });
 test(`${label} fixture: body failure remains the original error after successful teardown`,async()=>{
  const h=harness({fail:'body'});await assert.rejects(h.run(index),errorsAre([h.primary]));
  assert.deepEqual(h.deleted,tables);assert.equal(h.users.size,0);assert.equal(h.officer(),undefined);
 });
 test(`${label} fixture: failed context close cannot skip SQL cleanup or replace the original failure`,async()=>{
  const h=harness({fail:'body',close:true});
  await assert.rejects(h.run(index),errorsAre([h.primary,h.closeError]));
  assert.deepEqual(h.deleted,tables);assert.equal(h.users.size,0);assert.equal(h.officer(),undefined);
 });
 test(`${label} fixture: context close failure still fails a successful body`,async()=>{
  const h=harness({close:true});await assert.rejects(h.run(index),errorsAre([h.closeError]));
  assert.deepEqual(h.deleted,tables);assert.equal(h.users.size,0);assert.equal(h.officer(),undefined);
 });
 for(const fail of ['newContext','route','newPage','goto','login'] as const){
  test(`${label} fixture: ${fail} failure releases seeded rows and any acquired context`,async()=>{
   const h=harness({fail});await assert.rejects(h.run(index),errorsAre([h.primary]));
   assert.deepEqual(h.deleted,tables);assert.equal(h.users.size,0);assert.equal(h.officer(),undefined);
   assert.equal(h.calls.filter(call=>call==='close').length,fail==='newContext'?0:1);
   assert.ok(!h.calls.includes('body'));
  });
 }
 for(const fail of ['seed-user','seed-membership','seed-officer'] as const){
  test(`${label} fixture: ${fail} failure cleans partial seed IDs without deleting another officer`,async()=>{
   const h=harness({fail,existingOfficer:true});await assert.rejects(h.run(index),errorsAre([h.primary]));
   assert.deepEqual(h.deleted,tables);assert.equal(h.users.size,0);assert.equal(h.officer(),'unrelated-officer');
   assert.equal(h.createdIds.length,fail==='seed-user'?0:fail==='seed-membership'?1:5);
   assert.ok(!h.calls.includes('newContext'));
  });
 }
 test(`${label} fixture: SQL cleanup failure cannot silently pass a successful journey`,async()=>{
  const h=harness({cleanup:true});await assert.rejects(h.run(index),errorsAre([h.cleanupError]));
  assert.deepEqual(h.deleted,tables);assert.equal(h.officer(),undefined);
 });
 test(`${label} fixture: body, close and SQL cleanup failures remain observable in order`,async()=>{
  const h=harness({fail:'body',close:true,cleanup:true});
  await assert.rejects(h.run(index),errorsAre([h.primary,h.closeError,h.cleanupError]));
  assert.deepEqual(h.deleted,tables);assert.equal(h.officer(),undefined);
 });
}

// Execute the actual spec collector, including its attachment boundary. No DOM,
// browser, HTTP or PostgreSQL integration success is implied by these fixtures.
async function attachment(diagnostics:ReturnType<typeof harness>['diagnostics']){
 let result:unknown;
 await diagnostics.attach({attach:async(name:string,options:{body:Buffer;contentType:string})=>{
  assert.equal(name,'guild-activity-timing');assert.equal(options.contentType,'application/json');
  result=JSON.parse(options.body.toString('utf8'));
 }});
 return result as {unavailable:boolean;limit:number;records:Record<string,unknown>[]};
}
test('activity diagnostics only attach closed metadata and cap records',async()=>{
 const {diagnostics}=harness();
 diagnostics.receive({kind:'pointerdown',route:'#participation=secret',target:'private text',tag:'CUSTOM-SECRET',time:12,scrollY:481,x:NaN,y:Infinity,button:true,disabled:false,form:false,calendar:true,token:'secret',body:'private',hash:'#secret',buttonX:1101.25});
 diagnostics.receive({kind:'private event',time:14});
 for(let i=0;i<205;i++)diagnostics.receive({kind:'click',route:'events',target:'submit',tag:'BUTTON',time:i});
 const trace=await attachment(diagnostics);
 assert.equal(trace.limit,200);assert.equal(trace.records.length,200);
 assert.deepEqual(trace.records[0],{kind:'pointerdown',time:12,scrollY:481,buttonX:1101.25,button:true,disabled:false,form:false,calendar:true});
 assert.deepEqual(trace.records[1],{kind:'click',route:'events',target:'submit',tag:'BUTTON',time:0});
 assert.ok(!JSON.stringify(trace).includes('secret'));assert.ok(!JSON.stringify(trace).includes('private'));
});
test('activity diagnostics mark unavailable setup and never replace a failure on attach',async()=>{
 const {diagnostics}=harness();
 await diagnostics.install({exposeBinding:async()=>{throw new Error('private setup details');}});
 assert.equal((await attachment(diagnostics)).unavailable,true);
 await assert.doesNotReject(diagnostics.attach({attach:async()=>{throw new Error('attachment unavailable');}}));
});
test('activity diagnostics observe pointer targets and form/calendar changes without driving the page',async()=>{
 const {diagnostics}=harness();
 const listeners=new Map<string,((event:unknown)=>void)[]>();
 let mutation:()=>void=()=>{},binding:(_source:unknown,value:unknown)=>void=()=>{};
 const state={form:false,calendar:false,buttonY:327,scrollY:73};
 class Element{
  readonly tagName:string;readonly category:string;
  constructor(tagName:string,category:string){this.tagName=tagName;this.category=category;}
  closest(selector:string){return selector.includes(this.category)?this:null;}
 }
 class MouseEvent{
  isTrusted=true;
  readonly target:Element;readonly clientX:number;readonly clientY:number;
  constructor(target:Element,clientX=1154,clientY=349){this.target=target;this.clientX=clientX;this.clientY=clientY;}
 }
 const button=Object.assign(new Element('BUTTON','submit-event'),{disabled:false,getBoundingClientRect:()=>({x:1101,y:state.buttonY,width:106,height:44})});
 const register=(name:string,callback:(event:unknown)=>void)=>listeners.set(name,[...listeners.get(name)??[],callback]);
 const window={addEventListener:register,__guildActivityDiagnostic:async(value:unknown)=>binding({},value)};
 const document={body:{},addEventListener:register,querySelector:(selector:string)=>selector.includes('submit-event')?button:selector.includes('calendar')?state.calendar?new Element('SECTION','calendar'):null:state.form?new Element('FORM','experience-editor'):null};
 const environment={window,document,Element,MouseEvent,location:{hash:'#events'},performance:{now:()=>12},scrollX:0,get scrollY(){return state.scrollY;},MutationObserver:class{constructor(callback:()=>void){mutation=callback;}observe(){}}};
 await diagnostics.install({exposeBinding:async(_name:string,callback:typeof binding)=>{binding=callback;},evaluate:async(callback:()=>void)=>runInNewContext(`(${callback.toString()})()`,environment)});
 const dispatch=(kind:string,target:Element)=>{for(const listener of listeners.get(kind)??[])listener(new MouseEvent(target));};
 dispatch('pointerdown',button);
 state.calendar=true;state.buttonY=-81;state.scrollY=481;mutation();
 const calendar=new Element('SECTION','calendar');dispatch('pointerup',calendar);dispatch('click',calendar);
 state.form=true;mutation();state.form=false;mutation();
 const trace=await attachment(diagnostics);
 assert.equal(trace.unavailable,false);
 assert.deepEqual(trace.records.map(record=>record.kind),['initial','pointerdown','mutation','pointerup','click','click-bubble','mutation','mutation']);
 assert.equal(trace.records[1].target,'submit');assert.equal(trace.records[1].buttonY,327);assert.equal(trace.records[1].scrollY,73);
 assert.equal(trace.records[3].target,'calendar');assert.equal(trace.records[3].buttonY,-81);assert.equal(trace.records[3].scrollY,481);
 assert.equal(trace.records[6].form,true);assert.equal(trace.records[7].form,false);
 // History can reset route state without changing the hash.
 dispatch('popstate',calendar);
 const history=await attachment(diagnostics);
 assert.equal(history.records.at(-1)?.kind,'popstate');assert.equal(history.records.at(-1)?.route,'events');
 // Unsafe fragments are classified, never copied, even in hashchange events.
 environment.location.hash='#participation=private-token';dispatch('hashchange',calendar);
 const final=await attachment(diagnostics);
 assert.equal(final.records.at(-1)?.route,'other');assert.ok(!JSON.stringify(final).includes('private-token'));
});

test('intern failure attaches diagnostic after disposal and preserves the primary even if attachment fails',async()=>{
 const successful=harness();await successful.run(0);assert.equal(successful.attachments.length,0);
 for(const attachmentFails of [false,true]){
  const h=harness({fail:'body',attachmentFails});
  await assert.rejects(h.run(0),errorsAre([h.primary]));
  assert.equal(h.attachments.length,1);assert.equal(h.attachments[0].name,'guild-activity-timing');
  assert.equal(JSON.parse(h.attachments[0].body).unavailable,true);
  assert.equal(h.officer(),undefined);assert.equal(h.users.size,0);
 }
});
