import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
import {ApiError} from '../../apps/portal-web/src/api';
class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style = {setProperty() {}, removeProperty() {}};
  listeners: Record<string, Function[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
  }
  appendChild(node: HostNode) {
    node.parentNode?.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node;
  }
  removeChild(node: HostNode) {
    const index = this.childNodes.indexOf(node); assert.notEqual(index, -1);
    this.childNodes.splice(index, 1); node.parentNode = null; return node;
  }
  insertBefore(node: HostNode, before: HostNode) {
    node.parentNode?.removeChild(node); const index = this.childNodes.indexOf(before); assert.notEqual(index, -1);
    this.childNodes.splice(index, 0, node); node.parentNode = this; return node;
  }
  setAttribute(key: string, value: unknown) {this.attributes[key] = String(value);}
  removeAttribute(key: string) {delete this.attributes[key];}
  getAttribute(key: string) {return this.attributes[key] ?? null;}
  setAttributeNS(_namespace: string, key: string, value: unknown) {this.setAttribute(key, value);}
  addEventListener(type: string, fn: Function) {(this.listeners[type] ??= []).push(fn);}
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter(item => item !== fn);}
  get firstChild(): HostNode | null {return this.childNodes[0] ?? null;}
  get lastChild(): HostNode | null {return this.childNodes.at(-1) ?? null;}
  get nextSibling(): HostNode | null {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;}
  get textContent(): string {return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join('');}
  set textContent(value: string) {this.childNodes.forEach(node => {node.parentNode = null;}); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  get src() {return this.attributes.src ?? '';}
  set src(value: string) {this.attributes.src = String(value);}
  contains(node: HostNode): boolean {return node === this || this.childNodes.some(child => child.contains(node));}
}
class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null); this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
  }
  createElement(name: string) {return new HostNode(1, name.toUpperCase(), this);}
  createElementNS(namespace: string, name: string) {const node = this.createElement(name); node.namespaceURI = namespace; return node;}
  createTextNode(value: string) {const node = new HostNode(3, '#text', this); node.nodeValue = value; return node;}
}
const document = new HostDocument();
const scheduled = new Map<number,Function>();let nextTimer=0;
const window = {location:{origin:'https://fixture.invalid'},setTimeout(fn:Function){const id=++nextTimer;scheduled.set(id,fn);return id;},clearTimeout(id:number){scheduled.delete(id);},open(){throw Error('No external navigation permitted');},document, HTMLElement: HostNode, HTMLIFrameElement: class {}, listeners:{} as Record<string,Function[]>, addEventListener(type:string,fn:Function) {(this.listeners[type]??=[]).push(fn);}, removeEventListener(type:string,fn:Function) {this.listeners[type]=(this.listeners[type]??[]).filter(v=>v!==fn);}, get event() {return undefined;}};
document.defaultView = window;
Object.assign(globalThis, {document, window, HTMLElement: HostNode, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true});
// Initialize ReactDOM after installing its synthetic host, in this test process.
const require = createRequire(import.meta.url);
const {createRoot} = require('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = require('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));


HostNode.prototype.closest = function () { return null; };
HostNode.prototype.showModal = function () { this.open = true; };
HostNode.prototype.close = function () { this.open = false; };
HostNode.prototype.focus = function () { this.ownerDocument.activeElement = this; };
HostNode.prototype.select = function () {};
// Regression coverage: complete production EventHelpers with real React/ReactDOM.
// DOM-shaped host, deferred transport and visibility events are synthetic. No network.
const fixtureRoot=fileURLToPath(new URL('../../',import.meta.url));
const module={exports:{} as any};
const source=readFileSync(path.join(fixtureRoot,'apps/portal-web/src/modules/EventHelpers.tsx'),'utf8');
runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{
 module,exports:module.exports,crypto:webcrypto,AbortController,Error,console,window,document,
 require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='../api')return {ApiError};if(name.endsWith('.css'))return {};throw Error(name);}
});
const {EventHelpers}=module.exports;
const descendants=(node:HostNode):HostNode[]=>[node,...node.childNodes.flatMap(descendants)];
const props=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
const eventId='10000000-0000-4000-8000-000000000001',userId='20000000-0000-4000-8000-000000000001',helperId='30000000-0000-4000-8000-000000000001';
const own=(state:string|null=null,version=state?2:1)=>({state,version,event_closed:false});
const page=(state='applied')=>({items:[{user_id:helperId,nickname:'合成幫手',state,version:state==='applied'?1:2}],total:1,next_offset:null,event_closed:false});
function fixture(t:TestContext,organizer=false){
 document.visibilityState='visible';
 const requests:any[]=[],blocked:boolean[]=[],container=document.createElement('div');document.body.appendChild(container);
 const root=createRoot(container as unknown as HTMLElement);
 const client={sessionGeneration:1,get:(path:string,options:any)=>new Promise((resolve,reject)=>requests.push({method:'GET',path,options,resolve,reject})),post:(path:string,body:any,options:any)=>new Promise((resolve,reject)=>requests.push({method:'POST',path,body,options,resolve,reject}))};
 const onBlockedChange=(v:boolean)=>blocked.push(v);
 let activeClient=client,activeEventId=eventId;
 const render=(nextClient=activeClient,nextEventId=activeEventId)=>{activeClient=nextClient;activeEventId=nextEventId;flush(()=>root.render(React.createElement(EventHelpers,{client:activeClient,eventId:activeEventId,userId,isOrganizer:organizer,onBlockedChange})));};
 render();let mounted=true;
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};t.after(unmount);
 const button=(label:string)=>descendants(container).find(n=>n.nodeName==='BUTTON'&&n.textContent===label);
 const click=(label:string)=>{const node=button(label);assert(node,'reachable mounted button: '+label);assert(container.contains(node));assert.equal(document.visibilityState,'visible','control is in a visible document');for(let ancestor:HostNode|null=node;ancestor;ancestor=ancestor.parentNode)assert(!props(ancestor)?.hidden,'control has no hidden ancestor');assert(!props(node).disabled,'enabled button: '+label);flush(()=>props(node).onClick({preventDefault(){}}));};
 const settle=async(r:any,value:any,reject=false)=>{assert(r,'expected request');await React.act(async()=>{r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
 const visibility=(state:'visible'|'hidden')=>{flush(()=>{document.visibilityState=state;for(const fn of document.listeners.visibilitychange??[])fn();});};
 const emit=(name:string)=>flush(()=>{for(const fn of window.listeners[name]??[])fn();});
 const focus=()=>emit('focus');
 const reads=()=>requests.filter(r=>r.method==='GET'),writes=()=>requests.filter(r=>r.method==='POST');
 const state=()=>({text:container.textContent,readCount:reads().length,writeCount:writes().length,reloadDisabled:!!props(button('重新讀取幫忙狀態')!).disabled,blocked:blocked.at(-1)});
 const start=async()=>{await settle(reads()[0],organizer?page():own());};
 const act=()=>click(organizer?'接受 合成幫手':'我要幫忙，送出申請');
 const ack=()=>settle(writes().at(-1),own(organizer?'accepted':'applied'));
 const refreshed=()=>organizer?page('accepted'):own('applied');
 return{client,container,render,unmount,button,click,settle,visibility,focus,emit,reads,writes,state,start,act,ack,refreshed};
}
const scenarios=[
 {action:'offer',organizer:false,before:()=>own(),after:()=>own('applied'),button:'我要幫忙，送出申請',status:'等主辦回覆'},
 {action:'withdraw',organizer:false,before:()=>own('applied'),after:()=>own('withdrawn',3),button:'撤回幫忙申請',status:'已撤回'},
 {action:'accept',organizer:true,before:()=>page(),after:()=>page('accepted'),button:'接受 合成幫手',status:'主辦已接受'},
 {action:'decline',organizer:true,before:()=>page(),after:()=>page('declined'),button:'婉拒 合成幫手',status:'這次未被接受'},
];
for(const scenario of scenarios)for(const oldReadFails of [false,true])test(`${scenario.action}: resume during confirmed readback recovers after discarded GET ${oldReadFails?'failure':'success'}`,async t=>{
 const h=fixture(t,scenario.organizer);await h.settle(h.reads()[0],scenario.before());h.click(scenario.button);
 const command=h.writes()[0];assert.equal(command.body.action??command.body.decision,scenario.action);
 await h.settle(command,own(scenario.action==='offer'?'applied':scenario.action==='withdraw'?'withdrawn':scenario.action==='accept'?'accepted':'declined',command.options.ifMatch+1));
 assert.equal(h.reads().length,2);h.visibility('hidden');assert(!h.container.textContent.includes('合成幫手'));h.visibility('visible');
 assert.equal(h.reads().length,2);await h.settle(h.reads()[1],oldReadFails?new Error('old read failed'):scenario.before(),oldReadFails);
 assert.equal(h.reads().length,3,'one queued read runs after the command flight');assert.equal(h.writes().length,1,'resuming never resends the command');assert(h.state().reloadDisabled);
 await h.settle(h.reads()[2],scenario.after());assert.equal(h.state().reloadDisabled,false);assert(h.state().text.includes(scenario.status));assert(!h.state().text.includes('正在讀取幫忙資料'));assert.equal(h.state().blocked,false);
});
for(const scenario of scenarios)test(`${scenario.action}: no interruption adds no extra read`,async t=>{
 const h=fixture(t,scenario.organizer);await h.settle(h.reads()[0],scenario.before());h.click(scenario.button);await h.settle(h.writes()[0],own(scenario.action==='offer'?'applied':scenario.action==='withdraw'?'withdrawn':scenario.action==='accept'?'accepted':'declined',h.writes()[0].options.ifMatch+1));await h.settle(h.reads()[1],scenario.after());
 assert.equal(h.reads().length,2);assert.equal(h.writes().length,1);assert.equal(h.state().reloadDisabled,false);assert(h.state().text.includes(scenario.status));
});
test('initial GET resume starts a fresh read and rejects the old response',async t=>{const h=fixture(t);h.visibility('hidden');h.visibility('visible');assert.equal(h.reads().length,2);await h.settle(h.reads()[0],own('accepted'));assert(h.state().reloadDisabled);await h.settle(h.reads()[1],own());assert.equal(h.state().reloadDisabled,false);assert(h.button('我要幫忙，送出申請'));});
test('resumes during POST are satisfied by the ACK readback without another GET',async t=>{const h=fixture(t);await h.start();h.act();for(let i=0;i<4;i++){h.visibility('hidden');h.visibility('visible');h.focus();}assert.equal(h.reads().length,1);await h.ack();await h.settle(h.reads()[1],h.refreshed());assert.equal(h.reads().length,2);assert.equal(h.state().reloadDisabled,false);assert(h.button('撤回幫忙申請'));});
test('many resumes and focus events during interrupted readback coalesce into one read',async t=>{const h=fixture(t);await h.start();h.act();await h.ack();for(let i=0;i<5;i++){h.visibility('hidden');h.visibility('visible');h.focus();h.emit('pageshow');}assert.equal(h.reads().length,2);await h.settle(h.reads()[1],own('withdrawn'));assert.equal(h.reads().length,3);await h.settle(h.reads()[2],own('applied'));assert.equal(h.reads().length,3);assert.equal(h.writes().length,1);assert.equal(h.state().reloadDisabled,false);});
test('still hidden at flight completion does not fetch or expose the old private list',async t=>{const h=fixture(t,true);await h.start();h.act();await h.ack();h.visibility('hidden');h.visibility('visible');h.visibility('hidden');await h.settle(h.reads()[1],page('accepted'));assert.equal(h.reads().length,2);assert(!h.state().text.includes('合成幫手'));assert(!h.state().text.includes('主辦已接受'));h.focus();assert.equal(h.reads().length,2);h.visibility('visible');assert.equal(h.reads().length,3);await h.settle(h.reads()[2],page('declined'));assert(h.state().text.includes('這次未被接受'));assert.equal(h.state().reloadDisabled,false);});
test('queued recovery failure unlocks manual retry and never loops or resends POST',async t=>{const h=fixture(t);await h.start();h.act();await h.ack();h.visibility('hidden');h.visibility('visible');await h.settle(h.reads()[1],own('applied'));await h.settle(h.reads()[2],new Error('new read failed'),true);assert.equal(h.state().reloadDisabled,false);assert(h.state().text.includes('new read failed'));assert.equal(h.reads().length,3);assert.equal(h.writes().length,1);h.click('重新讀取幫忙狀態');await h.settle(h.reads()[3],own('applied'));assert(h.button('撤回幫忙申請'));assert.equal(h.reads().length,4);});
test('later canonical read wins over a delayed queued recovery response',async t=>{const h=fixture(t);await h.start();h.act();await h.ack();h.visibility('hidden');h.visibility('visible');await h.settle(h.reads()[1],own('applied'));h.focus();assert.equal(h.reads().length,4);await h.settle(h.reads()[3],own('accepted'));await h.settle(h.reads()[2],own('withdrawn'));assert(h.state().text.includes('主辦已接受'));assert(!h.state().text.includes('已撤回'));assert.equal(h.state().reloadDisabled,false);});
test('unknown command and later refusal retain exact tuple and departure guard through resumed reads',async t=>{const h=fixture(t);await h.start();h.act();const first=h.writes()[0];h.visibility('hidden');h.visibility('visible');await h.settle(first,new ApiError({network:true,message:'lost ACK'}),true);assert.equal(h.reads().length,2);await h.settle(h.reads()[1],own('applied'));assert.equal(h.state().blocked,true);assert.equal(h.writes().length,1);h.click('重試原幫忙操作');await h.settle(h.writes()[1],new ApiError({status:403,definitiveResponse:true,message:'current refusal'}),true);assert.equal(h.state().blocked,true);h.click('重新讀取幫忙狀態');await h.settle(h.reads()[2],own('withdrawn'));assert.equal(h.state().blocked,true);h.click('重試原幫忙操作');for(const retry of h.writes().slice(1)){assert.equal(retry.path,first.path);assert.equal(retry.options.idempotencyKey,first.options.idempotencyKey);assert.equal(retry.options.ifMatch,first.options.ifMatch);assert.deepEqual(retry.body,first.body);}await h.ack();await h.settle(h.reads()[3],own('accepted'));assert.equal(h.state().blocked,false);assert.equal(h.state().reloadDisabled,false);});
for(const change of ['session','client','event','unmount','session-end'])test(`${change} change cancels an old owner's queued recovery`,async t=>{
 const h=fixture(t);await h.start();h.act();await h.ack();const old=h.reads()[1];h.visibility('hidden');h.visibility('visible');
 if(change==='unmount')h.unmount();else if(change==='session-end')h.emit('freedom-game-console-session-end');else if(change==='session'){h.client.sessionGeneration++;h.render();}else if(change==='event')h.render(h.client,'10000000-0000-4000-8000-000000000002');else h.render({...h.client});
 const afterChange=h.reads().length;assert(old.options.signal.aborted,'old owner read is aborted');await h.settle(old,own('accepted'));assert.equal(h.reads().length,afterChange,'late completion does not schedule on a new owner');assert.equal(h.writes().length,1);
 if(!['unmount','session-end'].includes(change)){await h.settle(h.reads().at(-1),own());assert(h.button('我要幫忙，送出申請'));assert(!h.state().text.includes('主辦已接受'));}else assert(!h.container.textContent.includes('主辦已接受'));
});
test('unmount during pending POST never reads after its late ACK',async t=>{const h=fixture(t);await h.start();h.act();h.visibility('hidden');h.visibility('visible');const command=h.writes()[0];h.unmount();assert(command.options.signal.aborted);await h.settle(command,own('applied'));assert.equal(h.reads().length,1);});
test('organizer recovery preserves the page offset of the acknowledged decision',async t=>{
 const h=fixture(t,true);const rows=Array.from({length:20},(_,i)=>({user_id:`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,nickname:`第一頁 ${i+1}`,state:'applied',version:1}));
 await h.settle(h.reads()[0],{items:rows,total:21,next_offset:20,event_closed:false});h.click('下一頁幫手');assert(h.reads()[1].path.endsWith('offset=20'));await h.settle(h.reads()[1],{...page(),total:21});h.click('接受 合成幫手');await h.ack();assert(h.reads()[2].path.endsWith('offset=20'));h.visibility('hidden');h.visibility('visible');await h.settle(h.reads()[2],{...page(),total:21});assert(h.reads()[3].path.endsWith('offset=20'));await h.settle(h.reads()[3],{...page('accepted'),total:21});assert(h.state().text.includes('目前第 21–21 筆'));assert.equal(h.state().reloadDisabled,false);
});
for(const change of ['session','client','event','unmount','session-end'])test(`${change} change aborts an already started recovery GET and ignores its late private state`,async t=>{
 const h=fixture(t);await h.start();h.act();await h.ack();h.visibility('hidden');h.visibility('visible');await h.settle(h.reads()[1],own('applied'));const recovery=h.reads()[2];assert(recovery);
 if(change==='unmount')h.unmount();else if(change==='session-end')h.emit('freedom-game-console-session-end');else if(change==='session'){h.client.sessionGeneration++;h.render();}else if(change==='event')h.render(h.client,'10000000-0000-4000-8000-000000000002');else h.render({...h.client});
 const count=h.reads().length;assert(recovery.options.signal.aborted);await h.settle(recovery,own('accepted'));assert.equal(h.reads().length,count);assert.equal(h.writes().length,1);
 if(!['unmount','session-end'].includes(change)){await h.settle(h.reads().at(-1),own());assert(h.button('我要幫忙，送出申請'));}assert(!h.container.textContent.includes('主辦已接受'));
});
