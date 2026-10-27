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
const operationStart=source.indexOf('function useGuildOperation('),operationEnd=source.indexOf('export function GuildAnnouncements(',operationStart);
assert.ok(operationStart>=0&&operationEnd>operationStart);
const operationSource=source.slice(operationStart,operationEnd);
const councilStart=source.indexOf('function Council('),councilEnd=source.indexOf('\ntype MaintainerBook=',councilStart);
assert.ok(councilStart>=0&&councilEnd>councilStart);
const councilCode=transformSync(operationSource+source.slice(councilStart,councilEnd),{loader:'tsx',jsxFactory:'React.createElement',target:'es2023'}).code;
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
function announcementHarness(write:Writer=async()=>{throw new Error('unknown write outcome');},isCurrent=()=>true,onConsoleEvent:(event:any)=>void=()=>{}){
 const begin=source.indexOf('function AnnouncementEditor('),end=source.indexOf('\ntype SkillEditorProps=',begin);
 assert.ok(begin>=0&&end>begin);
 const code=transformSync(operationSource+source.slice(begin,end),{loader:'tsx',jsxFactory:'React.createElement',target:'es2023'}).code;
 const slots:any[]=[],effects:(()=>void)[]=[];let cursor=0;
 const guildChanges:string[]=[],consoleEvents:unknown[]=[];
 const reads:{resolve:(value:unknown)=>void;reject:(error:Error)=>void}[]=[];
 const api={isCurrent,get:()=>new Promise((resolve,reject)=>reads.push({resolve,reject})),post:write};
 let currentApi=api;
 const memo=(value:any,deps:unknown[])=>{const i=cursor++,old=slots[i];if(!old||deps.some((x,n)=>x!==old.deps[n]))slots[i]={value,deps};return slots[i].value;};
 const Editor=runInNewContext(code+';AnnouncementEditor',{
  React,useState:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],(next:any)=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
  useRef:(initial:unknown)=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},useCallback:memo,
  useEffect:(run:()=>void,deps:unknown[])=>{const i=cursor++,old=slots[i];if(!old||deps.some((x,n)=>x!==old.deps[n])){old?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=run();});}},
  failure:(error:Error)=>error.message,date:String,logConsoleEvent:(event:unknown)=>{consoleEvents.push(event);onConsoleEvent(event);},consoleChannel:()=>'',
 });
 const render=()=>{cursor=0;const tree=Editor({api:currentApi,guilds:[{guild_key:'fixture',name:'Synthetic guild'},{guild_key:'other',name:'Other guild'}],guild:'fixture',onGuildChange:(value:string)=>guildChanges.push(value)});for(const effect of effects.splice(0))effect();return tree;};
 const nodes=(value:any):any[]=>Array.isArray(value)?value.flatMap(nodes):React.isValidElement(value)?[value,...nodes((value.props as any).children)]:[];
 const text=(value:any):string=>Array.isArray(value)?value.map(text).join(''):React.isValidElement(value)?text((value.props as any).children):typeof value==='string'?value:'';
 const buttons=(name:string)=>nodes(render()).find(n=>n.type==='button'&&text(n.props.children)===name);
 return {unmount:()=>{for(const slot of slots)slot?.cleanup?.();},consoleEvents,reads,render,text,guildChanges,html:()=>renderToStaticMarkup(render()),
  editFirst:()=>buttons('編輯公告').props.onClick(),newAnother:()=>buttons('新增另一則')?.props.onClick(),
  switchGuild:(value='other')=>nodes(render()).find(n=>n.type==='select').props.onChange({target:{value}}),
  publish:()=>nodes(render()).filter(n=>n.type==='select')[1].props.onChange({target:{value:'published'}}),
  controls:()=>nodes(render()).filter(n=>['input','textarea','select'].includes(n.type)).map(n=>Boolean(n.props.disabled)),
  buttonDisabled:(name:string)=>Boolean(buttons(name)?.props.disabled),
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
function councilReadHarness(write:Writer=async()=>{throw Object.assign(new Error('unknown council write'),{status:503});},isCurrent=()=>true){
 const slots:any[]=[],effects:(()=>void)[]=[];let cursor=0;
 const reads:{path:string;resolve:(value:unknown)=>void;reject:(error:Error)=>void}[]=[];
 const api={isCurrent,get:(path:string)=>new Promise((resolve,reject)=>reads.push({path,resolve,reject})),post:write};
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
 return {unmount:()=>{for(const slot of slots)slot?.cleanup?.();},reads,render,html:()=>renderToStaticMarkup(render()),
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

async function settleAnnouncementWrite(){for(let i=0;i<8;i++)await Promise.resolve();}

// Actual component + actual retry writer, with synthetic receipt/storage ports.
// These prove intent/key handling, not a browser or production database outcome.
for(const kind of ['create','edit'] as const){
 for(const denied of [403,412])test(`announcement ${kind}: unknown then ${denied} freezes every tuple entry until original ACK`,async()=>{
  const calls:{path:string;body:any;version:number|undefined;key:string}[]=[],receipts=new Map<string,unknown>();let effects=0;
  const row={...storedAnnouncement,aggregate_version:2,state:'draft'};
  const write=retrySafeWriter(async(path,body,version,key)=>{
   calls.push({path,body,version,key});
   if(calls.length===2)throw rejection(denied);
   if(!receipts.has(key)){effects++;receipts.set(key,{...row,...body as object,aggregate_version:3});}
   if(calls.length===1)throw rejection(503);
   return receipts.get(key);
  });
  const h=announcementHarness(write);h.render();h.reads[0].resolve({items:[row]});await settleRead();
  if(kind==='edit')h.editFirst();h.draft('Original title','Original body');await h.save();
  assert.deepEqual(h.controls(),[true,true,true,true]);
  assert.equal(h.buttonDisabled('編輯公告'),true);assert.equal(h.buttonDisabled('重新載入列表'),false);
  if(kind==='edit')assert.equal(h.buttonDisabled('新增另一則'),true);
  // Programmatic handler calls must not bypass disabled controls.
  h.draft('Changed','Changed');h.publish();h.switchGuild('fixture');h.switchGuild();h.editFirst();h.newAnother();
  assert.deepEqual(h.values(),['Original title','Original body']);assert.deepEqual(h.guildChanges,[]);
  await h.save();assert.deepEqual(h.controls(),[true,true,true,true]);
  h.reload();h.reads[1].resolve({items:[{...row,aggregate_version:99}]});await settleRead();h.editFirst();
  const recovery=h.save();await settleAnnouncementWrite();h.reads[2].resolve({items:[row]});await recovery;
  assert.equal(effects,1);assert.equal(new Set(calls.map(c=>c.key)).size,1);
  assert.ok(calls.every(c=>c.path===calls[0].path&&c.version===(kind==='edit'?2:undefined)&&JSON.stringify(c.body)===JSON.stringify({title:'Original title',body:'Original body',state:'draft'})));
  assert.deepEqual(h.controls(),[false,false,false,false]);assert.deepEqual(h.values(),['','']);
  h.draft('New intention','New body');const next=h.save();await settleAnnouncementWrite();h.reads[3].resolve({items:[]});await next;
  assert.equal(effects,2);assert.notEqual(calls[3].key,calls[2].key);
 });
 test(`announcement ${kind}: initial definitive rejection permits corrected intent`,async()=>{
  const calls:{body:any;key:string}[]=[];
  const h=announcementHarness(retrySafeWriter(async(_path,body,_version,key)=>{calls.push({body,key});throw rejection(400);}));
  h.render();h.reads[0].resolve({items:[{...storedAnnouncement,aggregate_version:2}]});await settleRead();if(kind==='edit')h.editFirst();
  h.draft('Invalid original','Original');await h.save();assert.deepEqual(h.controls(),[false,false,false,false]);
  h.draft('Corrected','Corrected body');await h.save();assert.notEqual(calls[0].key,calls[1].key);assert.equal(calls[1].body.title,'Corrected');
 });
}

for(const flag of ['network','timedOut'])test(`writer keeps the key for a 4xx carrying ${flag}`,async()=>{
 const keys:string[]=[];
 const write=retrySafeWriter(async(_path,_body,_version,key)=>{keys.push(key);if(keys.length===1)throw Object.assign(rejection(408),{[flag]:true});if(keys.length===2)throw rejection(403);return 'ACK';});
 await assert.rejects(write('/announcement',{title:'Original'}));await assert.rejects(write('/announcement',{title:'Original'}));await write('/announcement',{title:'Original'});
 assert.equal(new Set(keys).size,1);
});

for(const flag of ['network','timedOut'])test(`announcement treats 4xx ${flag} as unknown and retains original payload`,async()=>{
 const calls:{body:any;key:string}[]=[];
 const h=announcementHarness(retrySafeWriter(async(_path,body,_version,key)=>{calls.push({body,key});throw Object.assign(rejection(408),{[flag]:true});}));
 h.render();h.reads[0].resolve({items:[]});await settleRead();h.draft('Original','Original body');await h.save();
 assert.deepEqual(h.controls(),[true,true,true,true]);h.draft('Changed','Changed');await h.save();
 assert.equal(calls[0].key,calls[1].key);assert.equal(calls[1].body.title,'Original');
});

test('announcement pending send blocks reentrant submit and all mutation handlers',async()=>{
 let reject!:(error:Error)=>void,calls=0;
 const h=announcementHarness(async()=>{calls++;return new Promise((_resolve,no)=>{reject=no;});});
 h.render();h.reads[0].resolve({items:[{...storedAnnouncement,aggregate_version:2}]});await settleRead();h.editFirst();h.draft('Original','Original body');
 const sending=h.save();await h.save();h.draft('Changed','Changed');h.publish();h.editFirst();h.newAnother();h.switchGuild();
 assert.equal(calls,1);assert.deepEqual(h.values(),['Original','Original body']);assert.deepEqual(h.guildChanges,[]);
 reject(rejection(400));await sending;assert.deepEqual(h.controls(),[false,false,false,false]);
});

for(const reply of [false,true])for(const flag of ['network','timedOut'])test(`council ${reply?'reply':'create'} keeps a 4xx ${flag} outcome frozen through denied retry`,async()=>{
 const calls:{path:string;body:unknown;key:string}[]=[];
 const h=councilReadHarness(retrySafeWriter(async(path,body,_version,key)=>{calls.push({path,body,key});if(calls.length===1)throw Object.assign(rejection(408),{[flag]:true});throw rejection(403);}));
 h.render();h.reads[0].resolve({items:[storedThread]});await settleCouncil();
 if(reply){h.select();h.render();h.reads[1].resolve(storedThread);await settleCouncil();}else h.open();
 h.draft();const original=h.fields().map(f=>f.value);h.submit();await settleCouncil();assert.ok(h.fields().every(f=>f.disabled));assert.match(h.html(),/上次送出的結果尚未確認/);
 h.submit();await settleCouncil();assert.ok(h.fields().every(f=>f.disabled));assert.deepEqual(h.fields().map(f=>f.value),original);assert.equal(JSON.stringify(calls[0]),JSON.stringify(calls[1]));
});

// Session accessors are the production PortalClient implementation; transport
// ports are held promises, never real accounts or network calls.
const portalSource=readFileSync('apps/portal-web/src/api.ts','utf8'),authStart=portalSource.indexOf('export class PortalClient {'),authEnd=portalSource.indexOf('  onUnauthorized:',authStart);
assert.ok(authStart>=0&&authEnd>authStart);
const GuildAuthClient=runInNewContext(stripTypeScriptTypes(portalSource.slice(authStart,authEnd).replace('export ','')+'}')+';PortalClient',{Map});
const ownedStart=source.indexOf('async function ownedGuildRequest<T>('),ownedEnd=source.indexOf('// Read refreshes must not invalidate',ownedStart);
assert.ok(ownedStart>=0&&ownedEnd>ownedStart);
const ownedHooks=runInNewContext(stripTypeScriptTypes(source.slice(ownedStart,ownedEnd).replace('export ',''))+';({useMemberClient,useAdminClient})',{useMemo:(fn:()=>unknown)=>fn(),retrySafeWriter});
for(const kind of ['member'] as const)for(const method of ['get','post'] as const)test(`${kind} guild API ${method} rejects stale entry and a late old-owner response`,async()=>{
 const client=kind==='member'?new GuildAuthClient():{csrf:'synthetic-A'};if(kind==='member')client.csrfToken='synthetic-A';
 let resolve!:(value:unknown)=>void,calls=0;const send=()=>{calls++;return new Promise(yes=>resolve=yes);};client.get=send;client.post=send;client.request=send;
 const api=kind==='member'?ownedHooks.useMemberClient(client):ownedHooks.useAdminClient(client),pending=method==='get'?api.get('/synthetic'):api.post('/synthetic',{title:'synthetic'});
 if(kind==='member'){client.csrfToken=null;client.csrfToken='synthetic-B';}else client.csrf='synthetic-B';
 resolve({synthetic:true});await assert.rejects(pending,/登入已變更/);assert.equal(api.isCurrent(),false);
 await assert.rejects(method==='get'?api.get('/synthetic'):api.post('/synthetic',{title:'synthetic'}),/登入已變更/);assert.equal(calls,1);
});
for(const flow of ['announcement','create','reply'] as const)for(const change of ['unmount','session','api'] as const)for(const outcome of ['success','failure'] as const)test(`${flow}: late ${outcome} after ${change} has no follow-up reads or console text`,async()=>{
 let resolve!:(value:unknown)=>void,reject!:(error:Error)=>void,current=true;
 const write=()=>new Promise((yes,no)=>{resolve=yes;reject=no;});
 const h=flow==='announcement'?announcementHarness(write,()=>current):councilReadHarness(write,()=>current);
 h.render();h.reads[0].resolve({items:flow==='announcement'?[]:[storedThread]});await settleCouncil();
 if(flow==='announcement'){const a=h as ReturnType<typeof announcementHarness>;a.draft('Synthetic old title','Synthetic old body');a.publish();}
 else{const c=h as ReturnType<typeof councilReadHarness>;if(flow==='reply'){c.select();c.render();c.reads[1].resolve(storedThread);await settleCouncil();}else c.open();c.draft();}
 const before=h.reads.length;const pending=flow==='announcement'?(h as ReturnType<typeof announcementHarness>).save():(h as ReturnType<typeof councilReadHarness>).submit();
 if(change==='unmount')h.unmount();else if(change==='session')current=false;else h.replaceClient();const afterChange=h.reads.length;
 if(outcome==='success')resolve({announcement_id:'synthetic',updated_at:'2026-10-25T20:00:00Z'});else reject(rejection(503));
 await pending;await settleCouncil();assert.equal(h.reads.length,afterChange);if(change!=='api')assert.equal(afterChange,before);
 if(flow==='announcement')assert.deepEqual((h as ReturnType<typeof announcementHarness>).consoleEvents,[]);
});

function operationHarness(){
 const refs:any[]=[],cleanups:(()=>void)[]=[];let cursor=0,setup!:()=>()=>void;
 const api={isCurrent:()=>true},context:any={useRef:(initial:unknown)=>refs[cursor++]??(refs[cursor-1]={current:initial}),useEffect:(run:()=>()=>void)=>{setup=run;cleanups.push(run());}};
 const useOperation=runInNewContext(stripTypeScriptTypes(operationSource)+';useGuildOperation',context),capture=useOperation(api);
 return {capture,api,cleanup:()=>{for(const cleanup of cleanups.splice(0))cleanup();},setup:()=>{cleanups.push(setup());},replaceApi:()=>{cursor=0;useOperation({...api});}};
}
test('operation cleanup/setup never revives the old promise but allows a new same-owner operation',()=>{
 const h=operationHarness(),old=h.capture();assert.equal(old(),true);h.cleanup();assert.equal(old(),false);h.setup();assert.equal(old(),false);assert.equal(h.capture()(),true);
});
for(const outcome of ['success','failure'] as const)test(`admin assign late ${outcome} after unmount has no follow-up read or notification`,async()=>{
 const start=source.indexOf('  async function assign('),end=source.indexOf('  const current=books.find(',start);assert.ok(start>=0&&end>start);
 const h=operationHarness(),updates:string[]=[];let resolve!:(value:unknown)=>void,reject!:(error:Error)=>void;
 const ctx:any={captureOperation:h.capture,lock:{current:false},reason:'Synthetic reason',book:'synthetic',books:[],api:{post:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})},load:async()=>updates.push('read'),failure:(e:Error)=>e.message};
 for(const name of ['setBusy','setError','setNotice','setMember','setReason'])ctx[name]=()=>updates.push(name);
 const assign=runInNewContext(stripTypeScriptTypes(source.slice(start,end))+';assign',ctx),pending=assign('synthetic-member',true);h.cleanup();updates.length=0;
 if(outcome==='success')resolve({});else reject(rejection(503));await pending;assert.deepEqual(updates,[]);
});
test('replacing an operation API does not transfer an older in-flight intent',()=>{const h=operationHarness(),old=h.capture();h.replaceApi();assert.equal(old(),false);});

test('the actual Workspace session key remounts ownership and permits a fresh save without reviving old work',async()=>{
 const app=readFileSync('apps/portal-web/src/App.tsx','utf8');
 const keys=[...app.matchAll(/<Workspace key=\{(`[^`]+`)\}/g)];assert.equal(keys.length,1,'actual session mount boundary');
 const client=new GuildAuthClient();client.csrfToken='synthetic-A';
 const key=(user:string)=>runInNewContext(keys[0][1],{session:{user:{user_id:user}},client});
 const firstKey=key('synthetic-member-A'),writes:{body:unknown;resolve:(value:unknown)=>void}[]=[];
 client.post=(_path:string,body:unknown)=>new Promise(resolve=>writes.push({body,resolve}));
 const oldApi=ownedHooks.useMemberClient(client),old=announcementHarness(oldApi.post,oldApi.isCurrent);
 old.render();old.reads[0].resolve({items:[]});await settleCouncil();old.draft('Old draft','Old body');old.save();await settleCouncil();assert.equal(writes.length,1);
 client.csrfToken=null;client.csrfToken='synthetic-B';assert.notEqual(key('synthetic-member-A'),firstKey,'same user with a new session also remounts');assert.notEqual(key('synthetic-member-B'),firstKey);
 // Explicit hook-port remount follows the actual JSX key; not a React renderer.
 old.unmount();const newApi=ownedHooks.useMemberClient(client),fresh=announcementHarness(newApi.post,newApi.isCurrent);
 assert.equal(oldApi.isCurrent(),false);assert.equal(newApi.isCurrent(),true);
 fresh.render();fresh.reads[0].resolve({items:[]});await settleCouncil();fresh.draft('New draft','New body');fresh.save();await settleCouncil();assert.equal(writes.length,2);assert.equal((writes[1].body as {title:string}).title,'New draft');
 writes[0].resolve(storedAnnouncement);await settleCouncil();assert.ok(fresh.controls().every(Boolean),'old finally cannot unlock the new save');assert.equal(old.reads.length,1);assert.deepEqual(old.consoleEvents,[]);
 writes[1].resolve(storedAnnouncement);await settleCouncil();assert.equal(fresh.reads.length,2);fresh.reads[1].resolve({items:[]});await settleCouncil();assert.ok(fresh.controls().every(value=>!value));assert.deepEqual(fresh.values(),['','']);assert.match(fresh.html(),/公告已保存/);
});

test('the member ownership wrapper preserves same-session unknown receipt retries and normal reads',async()=>{
 const client=new GuildAuthClient();client.csrfToken='synthetic-A';const keys:string[]=[];client.get=async()=>({synthetic:true});
 client.post=async(_path:string,_body:unknown,options:any)=>{keys.push(options.idempotencyKey);if(keys.length===1)throw rejection(503);if(keys.length===2)throw rejection(403);return 'ACK';};
 const api=ownedHooks.useMemberClient(client);assert.equal((await api.get('/synthetic')).synthetic,true);
 await assert.rejects(api.post('/synthetic',{body:'same'}));await assert.rejects(api.post('/synthetic',{body:'same'}));assert.equal(await api.post('/synthetic',{body:'same'}),'ACK');assert.equal(new Set(keys).size,1);
});
test('a late announcement ACK cannot deliver old content to the replacement console subscriber',async()=>{
 const consoleSource=readFileSync('apps/portal-web/src/game-console-core.ts','utf8');
 const core=runInNewContext(stripTypeScriptTypes(consoleSource.replace(/^export /gm,''))+';({logConsoleEvent,subscribeGameConsole})',{crypto:globalThis.crypto,Set,Date});
 let resolve!:(value:unknown)=>void;const received:unknown[]=[];
 const h=announcementHarness(()=>new Promise(yes=>resolve=yes),()=>true,core.logConsoleEvent);h.render();h.reads[0].resolve({items:[]});await settleCouncil();h.draft('Synthetic old member title','Synthetic old member body');h.publish();const pending=h.save();h.unmount();
 const unsubscribe=core.subscribeGameConsole((event:unknown)=>received.push(event));
 try{resolve({announcement_id:'synthetic',updated_at:'2026-10-25T20:00:00Z'});await pending;assert.deepEqual(received,[]);assert.equal(h.reads.length,1);}finally{unsubscribe();}
});

for(const method of ['get','post'] as const)for(const stale of [false,true])test(`member ${method} failure ${stale?'redacts an obsolete owner detail':'preserves the current owner error'}`,async()=>{
 const client=new GuildAuthClient();client.csrfToken='synthetic-A';let reject!:(error:Error)=>void;const failure=Object.assign(new Error('Synthetic old private detail'),{status:400});
 client.get=client.post=()=>new Promise((_yes,no)=>reject=no);const api=ownedHooks.useMemberClient(client),pending=method==='get'?api.get('/synthetic'):api.post('/synthetic',{});
 if(stale)client.csrfToken='synthetic-B';reject(failure);
 await assert.rejects(pending,(error:Error)=>stale?error!==failure&&/登入已變更/.test(error.message)&&!error.message.includes('private detail'):error===failure);
});

test('grant ACK probe settles after actual body/handler continuations without requiring a stale reload',async()=>{
 const spec=readFileSync('tests/e2e/guild-workspace.spec.ts','utf8'),start=spec.indexOf('function installGrantAckProbe('),end=spec.indexOf('\ntest.beforeEach(',start);assert.ok(start>=0&&end>start,'actual browser probe boundary');
 const tasks:(()=>void)[]=[],channels:any[]=[];
 class Channel{port1={onmessage:null as null|(()=>void),close(){}};port2={postMessage:()=>tasks.push(()=>this.port1.onmessage?.()),close(){}};constructor(){channels.push(this);}}
 class Broadcast{postMessage(_value:unknown){}}
 let release!:(value:Response)=>void;
 const originalFetch=()=>new Promise<Response>(resolve=>release=resolve),originalBroadcast=Broadcast.prototype.postMessage,root:any={fetch:originalFetch};
 const install=runInNewContext(stripTypeScriptTypes(spec.slice(start,end))+';installGrantAckProbe',{window:root,location:{href:'http://localhost/',origin:'http://localhost'},URL,Request,MessageChannel:Channel,BroadcastChannel:Broadcast});
 const path='/api/v1/guilds/synthetic-guild/announcements',title='Synthetic removed draft';install({path,title});
 const readStart=portalSource.indexOf('async function readJson('),readEnd=portalSource.indexOf('\nfunction instanceCandidates(',readStart);assert.ok(readStart>=0&&readEnd>readStart);
 const readJson=runInNewContext(stripTypeScriptTypes(portalSource.slice(readStart,readEnd))+';readJson',{ApiError:Error});
 const old=announcementHarness(async()=>readJson(await root.fetch(path,{method:'POST',body:JSON.stringify({title})})),()=>true,event=>new Broadcast().postMessage({type:'event',event}));
 old.render();old.reads[0].resolve({items:[]});await settleCouncil();old.draft(title,'Old body');old.publish();old.save();await settleCouncil();old.unmount();
 const fresh=announcementHarness();fresh.render();fresh.reads[0].resolve({items:[]});await settleCouncil();fresh.draft('Replacement draft','Replacement body');
 assert.equal(root.__guildGrantAckProbe.settled,false);assert.equal(tasks.length,0,'network ACK has not arrived');
 release(new Response(JSON.stringify({...storedAnnouncement,announcement_id:'synthetic-announcement',title})));await settleCouncil();
 assert.equal(tasks.length,1,'only a valid parsed fixture ACK queues the next task');assert.equal(root.__guildGrantAckProbe.settled,false,'microtask continuation precedes the task barrier');
 assert.equal(old.reads.length,1);assert.deepEqual(old.consoleEvents,[]);assert.deepEqual(fresh.values(),['Replacement draft','Replacement body']);
 tasks.shift()!();assert.equal(root.__guildGrantAckProbe.settled,true);assert.equal(root.__guildGrantAckProbe.reads,0);assert.equal(root.__guildGrantAckProbe.events,0);assert.equal(channels.length,1);
 root.__guildGrantAckProbe.restore();assert.equal(root.fetch,originalFetch);assert.equal(Broadcast.prototype.postMessage,originalBroadcast);
});
for(const mismatch of ['origin','path','method','title','invalid-json','response-id','disposed'] as const)test(`grant ACK probe does not mark unrelated ${mismatch} as settled`,async()=>{
 const spec=readFileSync('tests/e2e/guild-workspace.spec.ts','utf8'),start=spec.indexOf('function installGrantAckProbe('),end=spec.indexOf('\ntest.beforeEach(',start);assert.ok(start>=0&&end>start);
 let tasks=0;class Channel{port1={onmessage:null,close(){}};port2={postMessage(){tasks++;},close(){}};}
 class Broadcast{postMessage(_value:unknown){}}
 const title='Synthetic fixture',path='/api/v1/guilds/synthetic-guild/announcements';
 const response=new Response(mismatch==='invalid-json'?'invalid':JSON.stringify({announcement_id:mismatch==='response-id'?'unrelated':'synthetic-announcement',title})),read=response.text;
 const root:any={fetch:async()=>response};const original=root.fetch;
 const install=runInNewContext(stripTypeScriptTypes(spec.slice(start,end))+';installGrantAckProbe',{window:root,location:{href:'http://localhost/',origin:'http://localhost'},URL,Request,MessageChannel:Channel,BroadcastChannel:Broadcast});install({path,title});
 const result=await root.fetch(mismatch==='origin'?'http://example.test'+path:mismatch==='path'?'/unrelated':path,{method:mismatch==='method'?'GET':'POST',body:JSON.stringify({title:mismatch==='title'?'unrelated':title})});
 assert.equal(result,response);if(!['invalid-json','response-id','disposed'].includes(mismatch))assert.equal(result.text,read,'unrelated response body remains untouched');if(mismatch==='disposed')root.__guildGrantAckProbe.restore();await result.text();assert.equal(tasks,0);assert.equal(root.__guildGrantAckProbe.settled,false);root.__guildGrantAckProbe.restore();assert.equal(root.fetch,original);
});
