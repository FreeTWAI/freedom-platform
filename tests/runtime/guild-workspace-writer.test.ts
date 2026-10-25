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

// Small hook ports execute the real announcement read/write handlers. Promises
// are explicitly settled by each test; there are no timers or browser claims.
function announcementHarness(){
 const begin=source.indexOf('function AnnouncementEditor('),end=source.indexOf('\ntype SkillEditorProps=',begin);
 assert.ok(begin>=0&&end>begin);
 const code=transformSync(source.slice(begin,end),{loader:'tsx',jsxFactory:'React.createElement',target:'es2023'}).code;
 const slots:any[]=[],effects:(()=>void)[]=[];let cursor=0;
 const reads:{resolve:(value:unknown)=>void;reject:(error:Error)=>void}[]=[];
 const api={get:()=>new Promise((resolve,reject)=>reads.push({resolve,reject})),post:async()=>{throw new Error('unknown write outcome');}};
 let currentApi=api;
 const memo=(value:any,deps:unknown[])=>{const i=cursor++,old=slots[i];if(!old||deps.some((x,n)=>x!==old.deps[n]))slots[i]={value,deps};return slots[i].value;};
 const Editor=runInNewContext(code+';AnnouncementEditor',{
  React,useState:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],(next:any)=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useRef:(initial:unknown)=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},useCallback:memo,
  useEffect:(run:()=>void,deps:unknown[])=>{const i=cursor++,old=slots[i];if(!old||deps.some((x,n)=>x!==old.deps[n])){old?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=run();});}},
  failure:(error:Error)=>error.message,date:String,logConsoleEvent:()=>{},consoleChannel:()=>'',
 });
 const render=()=>{cursor=0;const tree=Editor({api:currentApi,guilds:[{guild_key:'fixture',name:'Synthetic guild'}],guild:'fixture',onGuildChange:()=>{}});for(const effect of effects.splice(0))effect();return tree;};
 const nodes=(value:any):any[]=>Array.isArray(value)?value.flatMap(nodes):React.isValidElement(value)?[value,...nodes((value.props as any).children)]:[];
 const text=(value:any):string=>Array.isArray(value)?value.map(text).join(''):React.isValidElement(value)?text((value.props as any).children):typeof value==='string'?value:'';
 const buttons=(name:string)=>nodes(render()).find(n=>n.type==='button'&&text(n.props.children)===name);
 return {reads,render,text,html:()=>renderToStaticMarkup(render()),
  reload:()=>buttons('重新載入列表').props.onClick(),
  draft:(title:string,body:string)=>{for(const [label,value]of [['公告標題',title],['公告內容',body]]){const field=nodes(render()).find(n=>n.type==='label'&&text(n.props.children)===label);nodes(field).find(n=>n.type==='input'||n.type==='textarea').props.onChange({target:{value}});}},
  values:()=>nodes(render()).filter(n=>n.type==='input'||n.type==='textarea').map(n=>n.props.value),
  save:()=>nodes(render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}}),
  replaceClient:()=>{currentApi={...api};render();},
 };
}
async function settleRead(){await Promise.resolve();await Promise.resolve();}
const storedAnnouncement={announcement_id:'fixture-announcement',title:'Previously loaded announcement',body:'Synthetic announcement body',state:'published',updated_at:'2026-10-25'};
test('announcement initial read failure is not an empty list; retry restores a real empty list without losing a draft',async()=>{
 const h=announcementHarness();h.render();h.reads[0].reject(new Error('read failed'));await settleRead();
 assert.match(h.html(),/read failed/);assert.doesNotMatch(h.html(),/尚未建立公告/);
 h.draft('Unsaved title','Unsaved body');h.reload();h.reads[1].resolve({items:[]});await settleRead();
 assert.doesNotMatch(h.html(),/read failed/);assert.match(h.html(),/尚未建立公告/);assert.deepEqual(h.values(),['Unsaved title','Unsaved body']);
});
test('announcement refresh failure keeps old items and recovery never clears an unknown write error',async()=>{
 const h=announcementHarness();h.render();h.reads[0].resolve({items:[storedAnnouncement]});await settleRead();
 h.draft('Unsaved title','Unsaved body');await h.save();h.reload();h.reads[1].reject(new Error('refresh failed'));await settleRead();
 assert.match(h.html(),/Previously loaded announcement/);assert.match(h.html(),/refresh failed/);assert.match(h.html(),/unknown write outcome/);
 h.reload();h.reads[2].resolve({items:[]});await settleRead();
 assert.doesNotMatch(h.html(),/refresh failed/);assert.match(h.html(),/unknown write outcome/);assert.match(h.html(),/尚未建立公告/);assert.deepEqual(h.values(),['Unsaved title','Unsaved body']);
});
test('a stale announcement read cannot replace current errors or mark a new client list as loaded',async()=>{
 const h=announcementHarness();h.render();h.replaceClient();h.reads[1].reject(new Error('new client read failed'));await settleRead();
 h.reads[0].resolve({items:[storedAnnouncement]});await settleRead();
 assert.match(h.html(),/new client read failed/);assert.doesNotMatch(h.html(),/Previously loaded announcement|尚未建立公告/);
 h.reload();h.reads[2].resolve({items:[]});await settleRead();
 assert.match(h.html(),/尚未建立公告/);assert.doesNotMatch(h.html(),/new client read failed/);
});
test('an older failed announcement refresh cannot overwrite a newer successful read',async()=>{
 const h=announcementHarness();h.render();h.reload();h.reads[1].resolve({items:[storedAnnouncement]});await settleRead();
 h.reads[0].reject(new Error('obsolete read error'));await settleRead();
 assert.match(h.html(),/Previously loaded announcement/);assert.doesNotMatch(h.html(),/obsolete read error|尚未建立公告/);
});

// Actual Council handlers with controlled promises and explicit hook ports.
// Layout, focus and native lifecycle are left to hosted E2E, not emulated here.
function councilReadHarness(){
 const slots:any[]=[],effects:(()=>void)[]=[];let cursor=0;
 const reads:{path:string;resolve:(value:unknown)=>void;reject:(error:Error)=>void}[]=[];
 const api={get:(path:string)=>new Promise((resolve,reject)=>reads.push({path,resolve,reject})),post:async()=>{throw Object.assign(new Error('unknown council write'),{status:503});}};
 let currentApi=api;
 const Council=runInNewContext(councilCode+';Council',{
  React,useId:()=> 'synthetic-council',date:String,failure:(error:Error)=>error.message,
  useState:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],(next:any)=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useRef:(initial:unknown)=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useCallback:(value:any,deps:unknown[])=>{const i=cursor++,old=slots[i];if(!old||deps.some((x,n)=>x!==old.deps[n]))slots[i]={value,deps};return slots[i].value;},
  useEffect:(run:()=>void,deps:unknown[])=>{const i=cursor++,old=slots[i];if(!old||deps.some((x,n)=>x!==old.deps[n])){old?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=run();});}},
 });
 const render=()=>{cursor=0;const tree=Council({api:currentApi});for(const effect of effects.splice(0))effect();return tree;};
 const nodes=(value:any):any[]=>Array.isArray(value)?value.flatMap(nodes):React.isValidElement(value)?[value,...nodes((value.props as any).children)]:[];
 const text=(value:any):string=>Array.isArray(value)?value.map(text).join(''):React.isValidElement(value)?text((value.props as any).children):typeof value==='string'?value:'';
 const button=(name:string)=>nodes(render()).find(n=>n.type==='button'&&text(n.props.children)===name);
 return {reads,render,html:()=>renderToStaticMarkup(render()),
  reload:()=>button('重讀討論').props.onClick(),
  open:()=>button('新增討論').props.onClick(),
  select:(id?:string)=>nodes(render()).find(n=>n.type==='button'&&String(n.props.className).includes('guild-thread-select')&&(!id||n.key===id)).props.onClick(),
  draft:()=>{for(const node of nodes(render()).filter(n=>n.type==='input'||n.type==='textarea'))node.props.onChange({target:{value:node.type==='input'?'Retained council title':'Retained council body'}});},
  fields:()=>nodes(render()).filter(n=>n.type==='input'||n.type==='textarea').map(n=>({value:n.props.value,disabled:n.props.disabled})),
  submit:()=>nodes(render()).find(n=>n.type==='form').props.onSubmit({preventDefault(){}}),
  replaceClient:()=>{currentApi={...api};render();},
 };
}
// Drain promise continuations (including VM promises), without application waits.
const settleCouncil=()=>new Promise<void>(resolve=>setImmediate(resolve));
const storedThread={thread_id:'synthetic-thread',title:'Previously loaded discussion',body:'Synthetic thread body',author_name:'Synthetic author',created_at:'2026-10-25',replies:[]};
test('council first list read failure is not empty; successful empty recovery retains a create draft',async()=>{
 const h=councilReadHarness();h.render();h.reads[0].reject(new Error('council list failed'));await settleCouncil();
 assert.match(h.html(),/council list failed/);assert.doesNotMatch(h.html(),/目前沒有討論/);
 h.open();h.draft();h.reload();h.reads[1].resolve({items:[]});await settleCouncil();
 assert.match(h.html(),/目前沒有討論/);assert.doesNotMatch(h.html(),/council list failed/);
 assert.deepEqual(h.fields().map(f=>f.value),['Retained council title','Retained council body']);
});
for(const mode of ['create','reply'] as const)test(`council ${mode} unknown write survives list refresh failure and recovery with frozen original draft`,async()=>{
 const h=councilReadHarness();h.render();h.reads[0].resolve({items:[storedThread]});await settleCouncil();
 if(mode==='create')h.open();else{h.select();h.render();h.reads[1].resolve(storedThread);await settleCouncil();}
 h.draft();h.submit();await settleCouncil();const original=h.fields();assert.ok(original.every(f=>f.disabled));
 h.reload();const first=h.reads.length-(mode==='reply'?2:1);h.reads[first].reject(new Error('council refresh failed'));
 if(mode==='reply')h.reads[first+1].resolve(storedThread);await settleCouncil();
 assert.match(h.html(),/Previously loaded discussion/);assert.match(h.html(),/council refresh failed/);assert.match(h.html(),/unknown council write/);
 assert.match(h.html(),/上次送出的結果尚未確認/);assert.deepEqual(h.fields(),original);
 h.reload();const next=h.reads.length-(mode==='reply'?2:1);h.reads[next].resolve({items:[]});if(mode==='reply')h.reads[next+1].resolve(storedThread);await settleCouncil();
 assert.doesNotMatch(h.html(),/council refresh failed/);assert.match(h.html(),/unknown council write/);assert.match(h.html(),/目前沒有討論/);assert.deepEqual(h.fields(),original);
});
test('obsolete council client success cannot mark a current failed list as loaded or clear its read error',async()=>{
 const h=councilReadHarness();h.render();h.replaceClient();h.reads[1].reject(new Error('current client failed'));await settleCouncil();
 h.reads[0].resolve({items:[storedThread]});await settleCouncil();
 assert.match(h.html(),/current client failed/);assert.doesNotMatch(h.html(),/Previously loaded discussion|目前沒有討論/);
 h.reload();h.reads[2].resolve({items:[]});await settleCouncil();assert.match(h.html(),/目前沒有討論/);assert.doesNotMatch(h.html(),/current client failed/);
});
test('obsolete council list failure cannot overwrite a newer success',async()=>{
 const h=councilReadHarness();h.render();h.reload();h.reads[1].resolve({items:[storedThread]});await settleCouncil();
 h.reads[0].reject(new Error('obsolete council error'));await settleCouncil();
 assert.match(h.html(),/Previously loaded discussion/);assert.doesNotMatch(h.html(),/obsolete council error|目前沒有討論/);
});

test('council detail failure and recovery preserve the unknown reply error and original frozen draft',async()=>{
 const h=councilReadHarness();h.render();h.reads[0].resolve({items:[storedThread]});await settleCouncil();
 h.select();h.render();h.reads[1].resolve(storedThread);await settleCouncil();h.draft();h.submit();await settleCouncil();
 const original=h.fields();h.reload();h.reads[2].resolve({items:[storedThread]});h.reads[3].reject(new Error('detail failed'));await settleCouncil();
 assert.match(h.html(),/detail failed/);assert.match(h.html(),/unknown council write/);assert.match(h.html(),/上次送出的結果尚未確認/);
 h.reload();h.reads[4].resolve({items:[storedThread]});h.reads[5].resolve(storedThread);await settleCouncil();
 assert.doesNotMatch(h.html(),/detail failed/);assert.match(h.html(),/unknown council write/);assert.deepEqual(h.fields(),original);assert.ok(h.fields().every(f=>f.disabled));
});
for(const obsolete of ['success','failure'] as const)test(`council changing thread clears its old detail error and ignores an obsolete ${obsolete}`,async()=>{
 const h=councilReadHarness(),other={...storedThread,thread_id:'new-thread',title:'New selected detail'};h.render();h.reads[0].resolve({items:[storedThread,other]});await settleCouncil();
 h.select(storedThread.thread_id);h.render();h.reads[1].reject(new Error('previous detail failed'));await settleCouncil();assert.match(h.html(),/previous detail failed/);
 h.reload();h.reads[2].resolve({items:[storedThread,other]});await settleCouncil();h.select(other.thread_id);h.render();
 assert.doesNotMatch(h.html(),/previous detail failed/);h.reads[4].resolve(other);await settleCouncil();
 if(obsolete==='success')h.reads[3].resolve(storedThread);else h.reads[3].reject(new Error('obsolete detail error'));await settleCouncil();
 assert.match(h.html(),/<h4>New selected detail<\/h4>/);assert.doesNotMatch(h.html(),/previous detail failed|obsolete detail error/);
});
for(const obsolete of ['success','failure'] as const)test(`council old client detail ${obsolete} cannot replace the current error or mark it loaded`,async()=>{
 const h=councilReadHarness();h.render();h.reads[0].resolve({items:[storedThread]});await settleCouncil();h.select();h.render();
 h.replaceClient();h.reads[2].resolve({items:[storedThread]});h.reads[3].reject(new Error('current detail failed'));await settleCouncil();
 if(obsolete==='success')h.reads[1].resolve(storedThread);else h.reads[1].reject(new Error('obsolete client detail error'));await settleCouncil();
 assert.match(h.html(),/current detail failed/);assert.doesNotMatch(h.html(),/<h4>Previously loaded discussion<\/h4>|obsolete client detail error/);
 h.reload();h.reads[4].resolve({items:[storedThread]});h.reads[5].resolve(storedThread);await settleCouncil();
 assert.doesNotMatch(h.html(),/current detail failed/);assert.match(h.html(),/<h4>Previously loaded discussion<\/h4>/);
});
