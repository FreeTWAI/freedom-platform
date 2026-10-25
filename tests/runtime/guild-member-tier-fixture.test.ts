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
type Options={fail?:Failure;close?:boolean;cleanup?:boolean;existingOfficer?:boolean};
const tables=['positioning_guild_experts','positioning_guild_officers','member_notifications','member_skill_book_grants','command_receipts','outbox','transition_journal','positioning_profession_memberships','sessions','users'];

function harness(options:Options={}){
 const primary=new Error(options.fail??'unused primary failure');
 const closeError=new Error('synthetic context close failed');
 const cleanupError=new Error('synthetic user cleanup failed');
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
 const cases:{name:string;run:(args:unknown)=>Promise<void>}[]=[];
 const register=Object.assign((name:string,run:(args:unknown)=>Promise<void>)=>cases.push({name,run}),{setTimeout:(ms:number)=>assert.equal(ms,120_000)});
 const expect=()=>({toBeVisible:async()=>{},toHaveText:async()=>{},toHaveCount:async()=>{},toContainText:async()=>{},toBeDisabled:async()=>{},toBe:()=>{}});
 runInNewContext(compiled,{AggregateError,require:(name:string)=>{
  if(name==='node:crypto')return {randomUUID};
  if(name==='./fixtures.js')return {test:register,expect};
  if(name==='./navigation.js')return {navigate:async()=>{calls.push('body');fail('body');}};
  if(name.endsWith('/testing/seed.js'))return {DEMO_COMMUNITY:'synthetic-community',DEMO_PASSWORD:'synthetic-password'};
  if(name.endsWith('/identity-membership/service.js'))return {hashPassword:()=> 'synthetic-hash'};
  throw new Error(`Unexpected spec dependency: ${name}`);
 }});
 assert.equal(cases.length,2);
 return {cases,calls,deleted,createdIds,users,primary,closeError,cleanupError,officer:()=>officer,run:(index:number)=>cases[index].run({browser,baseURL:'http://127.0.0.1:4311',e2eAuthPool:db})};
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
