import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import React,{useId} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
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

// Render the actual Council JSX with synthetic state ports. Execute installed
// Playwright label extraction against a minimal DOM-shaped tree of that markup;
// this is not a browser/lifecycle test and leaves the E2E exact assertions intact.
const require=createRequire(import.meta.url);
const playwrightBundle=readFileSync(join(dirname(require.resolve('playwright-core/package.json')),'lib/coreBundle.js'),'utf8');
const injectedLine=playwrightBundle.split('\n').find(line=>line.trimStart().startsWith('source4 = '));
assert.ok(injectedLine,'installed Playwright injected source must be available');
const injected=runInNewContext(injectedLine.trim().slice('source4 = '.length,-1)) as string;
const labelFunctions=['enclosingShadowRootOrDocument','getIdRefs','getAriaLabelledByElements','normalizeWhiteSpace','shouldSkipForTextMatching','elementText','getElementLabels'].map(name=>{
 const start=injected.indexOf(`function ${name}(`),end=injected.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,`actual Playwright ${name} extraction boundary`);
 return injected.slice(start,end+2);
}).join('\n');
const getLabels=runInNewContext(labelFunctions+';getElementLabels',{
 normalizedWhitespaceCache:undefined,Node:{TEXT_NODE:3,COMMENT_NODE:8,ELEMENT_NODE:1},HTMLInputElement:class{},CSS:{escape:(id:string)=>id},
}) as (cache:Map<unknown,unknown>,element:unknown)=>{normalized:string}[];
const councilStart=source.indexOf('function Council('),councilEnd=source.indexOf('\ntype MaintainerBook=',councilStart);
assert.ok(councilStart>=0&&councilEnd>councilStart);
const councilCode=transformSync(source.slice(councilStart,councilEnd),{loader:'tsx',jsxFactory:'React.createElement',target:'es2023'}).code;
function councilMarkup(mode:'create'|'reply',draft:string,frozen:boolean){
 let stateIndex=0;
 const current={thread_id:'fixture',title:'Synthetic thread',body:'Synthetic body',author_name:'Synthetic author',created_at:'2026-10-25',replies:[]};
 const values:unknown[]=[mode==='create',frozen,[],mode==='reply'?'fixture':null,mode==='reply'?current:null,false,'Synthetic title',draft,draft,'','',false,false];
 const Council=runInNewContext(councilCode+';Council',{
  React,useId,useState:()=>[values[stateIndex++],()=>{}],useRef:(value:unknown)=>({current:value}),useEffect:()=>{},useCallback:(fn:unknown)=>fn,date:String,
 }) as (props:{api:unknown})=>React.ReactNode;
 const Wrapper=()=>{stateIndex=0;return Council({api:{}});};
 return renderToStaticMarkup(React.createElement('div',null,React.createElement(Wrapper),React.createElement(Wrapper)));
}
function labelTrees(markup:string){
 return [...markup.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].filter(match=>match[1].includes('<textarea')).map(match=>{
  const inner=match[1],area=/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/.exec(inner)!;
  const attributes=Object.fromEntries([...area[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  const span=/<span id="([^"]+)">([^<]*)<\/span>/.exec(inner);
  const visible=span?.[2]??inner.slice(0,inner.indexOf('<textarea'));
  const document:any={nodeType:9,head:null,querySelector:(selector:string)=>span&&selector==='#'+span[1]?labelText:null};
  const text=(value:string)=>({nodeType:3,nodeValue:value,nextSibling:null});
  const node=(name:string,firstChild:unknown):any=>({nodeType:1,nodeName:name,ownerDocument:document,parentNode:document,firstChild,nextSibling:null,getAttribute:()=>null});
  const labelText=node('SPAN',text(visible)),textarea=node('TEXTAREA',text(area[2]));
  const label=node('LABEL',span?labelText:text(visible));label.firstChild.nextSibling=textarea;
  textarea.labels=[label];textarea.getAttribute=(name:string)=>attributes[name]??null;
  return {textarea,visible,draft:area[2],attributes,span};
 });
}
for(const mode of ['create','reply'] as const)test(`council ${mode} keeps exact labels independent of retained and frozen textarea content`,()=>{
 const expected=mode==='create'?'討論內容':'回覆討論';
 for(const frozen of [false,true])for(const draft of ['', '尚未送出的草稿', '未知結果必須使用原內容']){
  const trees=labelTrees(councilMarkup(mode,draft,frozen));assert.equal(trees.length,2);
  const ids=trees.map(tree=>tree.span?.[1]);assert.equal(new Set(ids).size,2,'coexisting councils use unique label IDs');
  for(const tree of trees){
   assert.ok(tree.span,'the label is its own visible span, not a textarea descendant');
   assert.equal(tree.visible,expected);assert.equal(tree.attributes['aria-labelledby'],tree.span[1]);
   assert.equal(tree.draft,draft);assert.equal('disabled' in tree.attributes,frozen);
   assert.deepEqual([...getLabels(new Map(),tree.textarea)].map(label=>label.normalized),[expected]);
   // Reproduce the hosted mismatch without the explicit association: textarea
   // default text is included by getByLabel's implicit-label text traversal.
   tree.textarea.getAttribute=()=>null;
   assert.deepEqual([...getLabels(new Map(),tree.textarea)].map(label=>label.normalized),[expected+draft]);
  }
 }
});
