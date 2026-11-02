import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalClient} from '../../apps/portal-web/src/api.js';
import {importGuestTesterProgress} from '../../apps/portal-web/src/modules/tester-map/import-progress.js';
import {TESTER_PROGRESS_KEY,QUEST_STEP_IDS} from '../../modules/tester-map/index.js';

test('login import shares an in-flight command, preserves guest edits during upload, never writes account data locally',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:storage}});
  try{
    const client=new PortalClient();client.csrfToken='first';
    storage.setItem(TESTER_PROGRESS_KEY,JSON.stringify({v:1,group:'A',done:[QUEST_STEP_IDS[0]]}));
    let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;}),calls:unknown[]=[];
    client.post=async(_path,body)=>{calls.push(body);await wait;return {} as any;};
    const first=importGuestTesterProgress(client),second=importGuestTesterProgress(client);assert.equal(first,second);assert.equal(calls.length,1);
    storage.setItem(TESTER_PROGRESS_KEY,JSON.stringify({v:1,group:'B',done:[QUEST_STEP_IDS[0],QUEST_STEP_IDS[1]]}));release();await first;
    assert.deepEqual(JSON.parse(storage.getItem(TESTER_PROGRESS_KEY)!),{v:1,group:'B',done:[QUEST_STEP_IDS[1]]});
    await importGuestTesterProgress(client);assert.equal(calls.length,1);
  }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
test('failed login import retries the same key; late success from a previous session cannot consume another account guest storage',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');let value=JSON.stringify({v:1,group:null,done:[QUEST_STEP_IDS[0]]});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:()=>value,setItem:(_k:string,v:string)=>{value=v;},removeItem:()=>{value='';}}}});
  try{
    const client=new PortalClient();client.csrfToken='first';const keys:unknown[]=[];let fail=true,release!:()=>void;
    client.post=async(_p,_b,options)=>{keys.push(options?.idempotencyKey);if(fail)throw new Error('synthetic network failure');await new Promise<void>(resolve=>{release=resolve;});return {} as any;};
    await assert.rejects(importGuestTesterProgress(client));assert.ok(value);
    fail=false;const retry=importGuestTesterProgress(client);assert.equal(keys[0],keys[1]);client.csrfToken='next';release();await retry;assert.ok(value);
  }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');}
});
