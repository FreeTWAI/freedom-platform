import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React from 'react';
class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style:Record<string,any> = {setProperty() {}, removeProperty() {}};
  listeners: Record<string, {fn:Function;capture:boolean}[]> = {};
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
  addEventListener(type: string, fn: Function, options?:any) {(this.listeners[type] ??= []).push({fn,capture:options===true||!!options?.capture});}
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter(item => item.fn !== fn);}
  get options(): HostNode[] {return this.childNodes.flatMap(node=>node.nodeName==='OPTION'?[node]:node.options);}
  get firstChild(): HostNode | null {return this.childNodes[0] ?? null;}
  get lastChild(): HostNode | null {return this.childNodes.at(-1) ?? null;}
  get nextSibling(): HostNode | null {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;}
  get textContent(): string {return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join('');}
  set textContent(value: string) {this.childNodes.forEach(node => {node.parentNode = null;}); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  get parentElement():HostNode|null {return this.parentNode?.nodeType===1?this.parentNode:null;}
  setCustomValidity(value:string){this.validationMessage=value;}
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
const window:any = {location:{origin:'https://fixture.invalid'},setTimeout(fn:Function){const id=++nextTimer;scheduled.set(id,fn);return id;},clearTimeout(id:number){scheduled.delete(id);},open(){throw Error('No external navigation permitted');},document, HTMLElement: HostNode, HTMLIFrameElement: class {}, listeners:{} as Record<string,Function[]>, addEventListener(type:string,fn:Function) {(this.listeners[type]??=[]).push(fn);}, removeEventListener(type:string,fn:Function) {this.listeners[type]=(this.listeners[type]??[]).filter((x:Function)=>x!==fn);}, dispatchEvent(e:any) {for(const fn of [...(this.listeners[e.type]??[])])fn(e);return true;}, get event() {return undefined;}};
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
const descendants=(node:HostNode):HostNode[]=>[node,...node.childNodes.flatMap(descendants)];
document.getElementById=(id:string)=>descendants(document).find(node=>node.attributes.id===id)??null;
const matches=(node:HostNode,selector:string)=>{
 if(selector.startsWith('.'))return (node.attributes.class??'').split(' ').includes(selector.slice(1));
 const attribute=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
 if(attribute)return Object.hasOwn(node.attributes,attribute[1])&&(attribute[2]===undefined||node.attributes[attribute[1]]===attribute[2]);
 return node.nodeName===selector.toUpperCase();
};
HostNode.prototype.querySelectorAll=function(selector:string){const rows=descendants(this).filter(n=>matches(n,selector));return Object.assign(rows,{item:(i:number)=>rows[i]??null});};
HostNode.prototype.querySelector=function(selector:string){return this.querySelectorAll(selector).item(0);};
HostNode.prototype.hasAttribute=function(key:string){return Object.hasOwn(this.attributes,key);};
HostNode.prototype.dispatchEvent=function(event:any){
  event.target??=this;event.bubbles??=true;event.cancelBubble=false;event.defaultPrevented=false;
  event.preventDefault=()=>{event.defaultPrevented=true;};event.stopPropagation=()=>{event.cancelBubble=true;};
  const chain:HostNode[]=[];for(let n:HostNode|null=this;n;n=n.parentNode)chain.push(n);
  for(const n of [...chain].reverse()){event.currentTarget=n;for(const l of n.listeners[event.type]??[])if(l.capture)l.fn(event);if(event.cancelBubble)return !event.defaultPrevented;}
  for(const n of chain){event.currentTarget=n;for(const l of n.listeners[event.type]??[])if(!l.capture)l.fn(event);if(event.cancelBubble||!event.bubbles)break;}
  if(event.type==='click'&&!event.defaultPrevented&&this.nodeName==='SUMMARY'&&this.parentNode?.nodeName==='DETAILS'){const details=this.parentNode;if(details.hasAttribute('open'))details.removeAttribute('open');else details.setAttribute('open','');}
  event.currentTarget=null;return !event.defaultPrevented;
};

// Real ReactDOM + complete production components, with synthetic transport/host.
// Input changes below use a mounted React handler adapter, not a native keyboard.
// This proves state/ownership transitions, not browser geometry or validation UX.
window.confirm=()=>false;
const noNetwork=()=>{throw Error('Real network forbidden');};
const frame=(fn:()=>void)=>queueMicrotask(fn);
const bundled=buildSync({stdin:{contents:`export {EventsPanel,blankEvent,eventPayload} from './apps/portal-web/src/modules/EventsPanel'; export {ApiError} from './apps/portal-web/src/api';`,resolveDir:process.cwd(),sourcefile:'event-date-ui-entry.ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
const production={exports:{} as any};
runInNewContext(bundled.outputFiles[0].text,{module:production,exports:production.exports,crypto:webcrypto,Intl,URL,URLSearchParams,AbortController,Error,Event,CustomEvent:class{constructor(public type:string){}},Blob,console,window,document,HTMLElement:HostNode,HTMLDetailsElement:class{},navigator:{language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork}},fetch:noNetwork,requestAnimationFrame:frame,localStorage:{getItem(){return null;},setItem(){}},setTimeout,clearTimeout,require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='zod')return require('zod');throw Error(name);}});
const {EventsPanel,ApiError}=production.exports;
const OWNER='30000000-0000-4000-8000-000000000001',ID='10000000-0000-4000-8000-000000000001';
const stored=(patch:any={})=>({help_need:null,event_id:ID,organizer_ref:OWNER,organizer_name:'合成主辦',title:'合成活動',description:'合成說明',starts_at:'2099-01-01T12:00:00.000Z',ends_at:'2099-01-01T13:00:00.000Z',mode:'online',location:'合成場地',capacity:null,state:'pending',visibility:'workshop',event_kind:'other',topic:null,online_url:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,banner_url:null,banner_orientation:null,video_url:null,video_mime:null,attending_count:0,my_rsvp:null,aggregate_version:1,registration_policy:'community_member',prize_details:[],...patch});
const propsOf=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
function host(t:TestContext,component:any,initial:any){
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);let props=initial,mounted=true;
 const render=()=>flush(()=>root.render(React.createElement(component,props)));render();
 const nodes=()=>descendants(container),button=(text:string)=>nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent===text)!;
 const click=(node:HostNode)=>{assert(node,'mounted button');assert(!propsOf(node).disabled);flush(()=>node.dispatchEvent({type:'click',button:0}));};
 const field=(text:string)=>{const label=nodes().find(n=>n.nodeName==='LABEL'&&(n.textContent===text||n.textContent.startsWith(text)));assert(label,`label ${text}`);return label.attributes.for?nodes().find(n=>n.attributes.id===label.attributes.for)!:descendants(label).find(n=>['INPUT','TEXTAREA','SELECT'].includes(n.nodeName))!;};
 const change=(label:string,value:string)=>{const node=field(label);flush(()=>propsOf(node).onChange({target:{value},currentTarget:{value}}));};
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};t.after(unmount);
 return {container,nodes,button,click,field,change,render,unmount,setProps(next:any){props=next;render();},text:()=>container.textContent};
}
function panel(t:TestContext){
 const requests:any[]=[],client:any={sessionGeneration:1,csrfToken:'synthetic'};for(const method of ['get','post','patch'])client[method]=(path:string,body?:any,options?:any)=>new Promise((resolve,reject)=>requests.push({method,path,body,options,resolve,reject}));
 let guard:(()=>boolean)|null=null;const props:any={client,session:{user:{user_id:OWNER}},locationHash:'#events',registerLeave:(value:any)=>{guard=value;},onList(){}};
 const h=host(t,EventsPanel,props),reads=()=>requests.filter(r=>r.method==='get'),writes=()=>requests.filter(r=>r.method!=='get');
 const settle=async(r:any,value:any,reject=false)=>{assert(r);await React.act(async()=>{r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
 const ready=async(items:any[]=[])=>{for(const r of reads().filter(r=>!r.done)){r.done=true;await settle(r,{items:r.path==='/events'?items:[]});}};
 const submit=()=>{const form=h.nodes().find(n=>n.nodeName==='FORM');assert(form);flush(()=>form.dispatchEvent({type:'submit'}));};
 return {...h,props,client,requests,reads,writes,settle,ready,submit,leave:()=>{let result:boolean|undefined;flush(()=>{result=guard?.();});return result;}};
}
const ack=(request:any,overrides:any={})=>stored({...request.body,state:request.path==='/events'?'published':'pending',aggregate_version:(request.options?.ifMatch??0)+1,...overrides});
const tuple=(r:any)=>JSON.stringify({path:r.path,body:r.body,options:r.options});

async function openDraft(h:ReturnType<typeof panel>,editing:boolean){
 await h.ready(editing?[stored()]:[]);h.click(h.button(editing?'編輯草稿':'辦活動'));
 h.change('活動名稱','保留的合成活動');h.change('活動說明','保留的合成說明');h.change(editing?'線上場地':'地點','合成場地');
 h.change('開始時間','2099-01-01T12:00');h.change('結束時間','2099-01-01T13:00');
}
for(const editing of [false,true]){
 for(const label of ['開始時間','結束時間'])test(`invalid ${label} remains editable and can recover when ${editing?'editing':'creating'}`,async t=>{
  const h=panel(t);await openDraft(h,editing);h.change(label,'10000-01-01T12:00');h.submit();
  assert.equal(h.writes().length,0,'invalid date never sends a command');
  for(const [field,value] of [['活動名稱','保留的合成活動'],['活動說明','保留的合成說明'],[editing?'線上場地':'地點','合成場地'],[label,'10000-01-01T12:00']]){
   assert.equal(propsOf(h.field(field)).disabled,false,'form remains editable');assert.equal(propsOf(h.field(field)).value,value,'draft is preserved');
  }
  assert.match(h.text(),/年份須為四位數/);
  assert.equal(h.leave(),false,'dirty draft still asks before leaving');
  window.confirm=()=>true;try{assert.equal(h.leave(),true,'local failure did not acquire save lock');}finally{window.confirm=()=>false;}
  h.change(label,label==='開始時間'?'2099-01-01T12:00':'2099-01-01T13:00');h.submit();
  const request=h.writes()[0];assert(request);assert.equal(h.writes().length,1);
  assert.equal(request.path,editing?`/events/${ID}/update`:'/events');assert.equal(request.options.ifMatch,editing?1:undefined);
  assert.equal(request.body.starts_at,new Date('2099-01-01T12:00').toISOString());assert.equal(request.body.ends_at,new Date('2099-01-01T13:00').toISOString());
  assert.equal(propsOf(h.field(label)).disabled,true,'real pending command locks the editor');assert.equal(h.leave(),false);
  await h.settle(request,ack(request));await h.ready([ack(request)]);
  assert.equal(h.nodes().filter(n=>n.nodeName==='FORM').length,0);assert.match(h.text(),editing?/活動已更新/:/活動已發布/);assert.equal(h.writes().length,1);
 });
 test(`four-digit upper boundary retains its original payload when ${editing?'editing':'creating'}`,async t=>{
  const h=panel(t);await openDraft(h,editing);h.change('開始時間','9999-01-01T12:00');h.change('結束時間','9999-01-01T13:00');h.submit();
  const request=h.writes()[0];assert(request);assert.equal(request.body.starts_at,new Date('9999-01-01T12:00').toISOString());assert.equal(request.body.ends_at,new Date('9999-01-01T13:00').toISOString());
  await h.settle(request,ack(request));assert.equal(h.writes().length,1);
 });
 test(`corrected draft still retries the exact unknown operation when ${editing?'editing':'creating'}`,async t=>{
  const h=panel(t);await openDraft(h,editing);h.change('開始時間','10000-01-01T12:00');h.submit();assert.equal(h.writes().length,0);
  h.change('開始時間','2099-01-01T12:00');h.submit();const first=h.writes()[0];assert(first);
  await h.settle(first,new ApiError({message:'合成未知結果',network:true}),true);
  assert.equal(propsOf(h.field('開始時間')).disabled,true);assert.equal(h.leave(),false);
  h.submit();const retry=h.writes()[1];assert(retry);assert.equal(tuple(retry),tuple(first),'unknown retry retains body, version and idempotency key');
  await h.settle(retry,ack(retry));await h.ready([ack(retry)]);assert.equal(h.writes().length,2);assert.equal(h.nodes().filter(n=>n.nodeName==='FORM').length,0);
 });
}
