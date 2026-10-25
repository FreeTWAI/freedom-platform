import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

// Execute the actual exported writer, without loading React, CSS or a browser.
// Fail if its extraction boundary changes rather than silently testing a copy.
const source=readFileSync('apps/portal-web/src/modules/GuildWorkspace.tsx','utf8');
const start=source.indexOf('export function retrySafeWriter(');
const end=source.indexOf('export function useMemberClient(',start);
assert.ok(start>=0&&end>start);
type Send=(path:string,body:unknown,version:number|undefined,key:string)=>Promise<unknown>;
type Writer=(path:string,body:unknown,version?:number)=>Promise<unknown>;
const retrySafeWriter=runInNewContext(stripTypeScriptTypes(source.slice(start,end).replace(/^export /,''))+';retrySafeWriter',{crypto:globalThis.crypto,Map}) as (send:Send)=>Writer;
const rejection=(status:number)=>Object.assign(new Error(`HTTP ${status}`),{status});

for(const path of ['/guild-council/threads','/guild-council/threads/thread-1/replies']){
  test(`${path}: unknown commit then denied replay retains one receipt until success`,async()=>{
    const keys:string[]=[],receipts=new Map<string,unknown>();let effects=0;
    const write=retrySafeWriter(async(_path,body,_version,key)=>{
      keys.push(key);
      if(keys.length===2)throw rejection(403); // authority is checked before replay
      if(!receipts.has(key)){effects++;receipts.set(key,{id:effects,body});}
      if(keys.length===1)throw rejection(503); // committed, but response lost
      return receipts.get(key);
    });
    const body={body:'same original payload'};
    await assert.rejects(write(path,body),{status:503});
    await assert.rejects(write(path,body),{status:403});
    await write(path,body);
    assert.equal(new Set(keys).size,1);
    assert.equal(effects,1);
    await write(path,body);
    assert.notEqual(keys[3],keys[2]); // confirmed success ends this attempt
    assert.equal(effects,2);
  });
}

test('an initial definitive rejection allows a fresh same or corrected request',async()=>{
  const keys:string[]=[],bodies:unknown[]=[];
  const write=retrySafeWriter(async(_path,body,_version,key)=>{keys.push(key);bodies.push(body);if(keys.length<3)throw rejection(400);return 'ok';});
  await assert.rejects(write('/write',{title:''}),{status:400});
  await assert.rejects(write('/write',{title:''}),{status:400});
  assert.equal(await write('/write',{title:'corrected'}),'ok');
  assert.equal(new Set(keys).size,3);
  assert.deepEqual(bodies,[{title:''},{title:''},{title:'corrected'}]);
});

test('network failures retain their key; path, body and version remain distinct',async()=>{
  const keys:string[]=[];
  const write=retrySafeWriter(async(_path,_body,_version,key)=>{keys.push(key);throw new TypeError('network lost');});
  for(const [path,body,version] of [['/a',{body:'one'},1],['/a',{body:'two'},1],['/b',{body:'one'},1],['/a',{body:'one'},2],['/a',{body:'one'},1]] as const){
    await assert.rejects(write(path,body,version),/network lost/);
  }
  assert.equal(new Set(keys.slice(0,4)).size,4);
  assert.equal(keys[0],keys[4]);
});
