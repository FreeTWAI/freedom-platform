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
const bundled=buildSync({stdin:{contents:`export {EventsPanel,blankEvent,eventPayload} from './apps/portal-web/src/modules/EventsPanel'; export {ApiError} from './apps/portal-web/src/api';`,resolveDir:process.cwd(),sourcefile:'event-clipboard-ui-entry.ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
const clipboard:any={language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork}};
const production={exports:{} as any};
runInNewContext(bundled.outputFiles[0].text,{module:production,exports:production.exports,crypto:webcrypto,Intl,URL,URLSearchParams,AbortController,Error,Event,CustomEvent:class{constructor(public type:string){}},Blob,console,window,document,HTMLElement:HostNode,HTMLDetailsElement:class{},navigator:clipboard,fetch:noNetwork,requestAnimationFrame:frame,localStorage:{getItem(){return null;},setItem(){}},setTimeout,clearTimeout,require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='zod')return require('zod');throw Error(name);}});
const {EventsPanel,ApiError}=production.exports;
const OWNER='30000000-0000-4000-8000-000000000001',ID='10000000-0000-4000-8000-000000000001';
const stored=(patch:any={})=>({help_need:null,event_id:ID,organizer_ref:OWNER,organizer_name:'合成主辦',title:'合成活動',description:'合成說明',starts_at:'2099-01-01T12:00:00.000Z',ends_at:'2099-01-01T13:00:00.000Z',mode:'online',location:'合成場地',capacity:null,state:'published',visibility:'workshop',event_kind:'other',topic:null,online_url:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,banner_url:null,banner_orientation:null,video_url:null,video_mime:null,attending_count:0,my_rsvp:null,aggregate_version:1,registration_policy:'community_member',prize_details:[],...patch});
const propsOf=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
function host(t:TestContext,component:any,initial:any){
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);let props=initial,mounted=true;
 const render=()=>flush(()=>root.render(React.createElement(component,props)));render();
 const nodes=()=>descendants(container),button=(text:string)=>nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent===text)!;
 const click=(node:HostNode)=>{assert(node,'mounted button');assert(!propsOf(node).disabled);let thrown:unknown;flush(()=>{try{propsOf(node).onClick({type:'click',button:0,currentTarget:node});}catch(error){thrown=error;}});if(thrown)throw thrown;};
 const field=(text:string)=>{const label=nodes().find(n=>n.nodeName==='LABEL'&&(n.textContent===text||n.textContent.startsWith(text)));assert(label,`label ${text}`);return label.attributes.for?nodes().find(n=>n.attributes.id===label.attributes.for)!:descendants(label).find(n=>['INPUT','TEXTAREA','SELECT'].includes(n.nodeName))!;};
 const change=(label:string,value:string)=>{const node=field(label);flush(()=>propsOf(node).onChange({target:{value},currentTarget:{value}}));};
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};t.after(unmount);
 return {container,nodes,button,click,field,change,render,unmount,setProps(next:any){props=next;render();},text:()=>container.textContent};
}
function panel(t:TestContext){
 const requests:any[]=[],client:any={sessionGeneration:1,csrfToken:'synthetic'};for(const method of ['get','post','patch'])client[method]=(path:string,body?:any,options?:any)=>new Promise((resolve,reject)=>requests.push({method,path,body,options,resolve,reject}));
 let guard:(()=>boolean)|null=null;const props:any={client,session:{user:{user_id:OWNER}},locationHash:'#events',registerLeave:(value:any)=>{guard=value;},onList(){}};
 clipboard.share=undefined;clipboard.clipboard={writeText:async()=>{}};
 const h=host(t,EventsPanel,props),reads=()=>requests.filter(r=>r.method==='get'),writes=()=>requests.filter(r=>r.method!=='get');
 const settle=async(r:any,value:any,reject=false)=>{assert(r);await React.act(async()=>{r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
 const ready=async(items:any[]=[])=>{for(const r of reads().filter(r=>!r.done)){r.done=true;await settle(r,{items:r.path==='/events'?items:[]});}};
 const submit=()=>{const form=h.nodes().find(n=>n.nodeName==='FORM');assert(form);flush(()=>form.dispatchEvent({type:'submit'}));};
 return {...h,props,client,requests,reads,writes,settle,ready,submit,leave:()=>{let result:boolean|undefined;flush(()=>{result=guard?.();});return result;}};
}

const ID2='10000000-0000-4000-8000-000000000002';
const link=(id=ID)=>`https://fixture.invalid/events/${id}?ref=synthetic_referral`;
const drain=async()=>React.act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
const deferred=()=>{let resolve!:()=>void,reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function openShare(h:ReturnType<typeof panel>,id=ID){
 const article=h.nodes().find(n=>n.nodeName==='ARTICLE'&&n.textContent.includes(id===ID?'合成活動':'第二場活動'));assert(article);
 const button=descendants(article).find(n=>n.nodeName==='BUTTON'&&n.textContent==='分享活動')!;h.click(button);
 const request=h.writes().at(-1);assert.equal(request.path,'/promotion/links');assert.equal(request.body.target,id);
 await h.settle(request,{path:`/events/${id}?ref=synthetic_referral`});
 return request;
}
for(const kind of ['missing','throw','reject'])test(`copy link recovers from ${kind} clipboard and keeps a selectable URL`,async t=>{
 const h=panel(t);await h.ready([stored()]);await openShare(h);let calls=0;
 clipboard.clipboard=kind==='missing'?undefined:{writeText(){calls++;if(kind==='throw')throw Error('synthetic denied');return Promise.reject(Error('synthetic denied'));}};
 const copy=h.button('複製連結');assert(copy);assert.equal(propsOf(copy).type,'button');
 let thrown:unknown;try{h.click(copy);}catch(e){thrown=e;}await drain();
 assert.equal(thrown,undefined,'click must contain synchronous Clipboard failures');
 assert.match(h.text(),/請選取上方連結手動複製/);assert.doesNotMatch(h.text(),/已複製/);
 const input=h.field('分享連結');assert.equal(propsOf(input).value,link());assert.equal(propsOf(input).readOnly,true);
 let selected=0;flush(()=>propsOf(input).onFocus({target:{select(){selected++;}}}));assert.equal(selected,1);
 assert.equal(calls,kind==='missing'?0:1);assert.equal(h.writes().length,1,'copy never requests another referral link');
 clipboard.clipboard={writeText:async(value:string)=>{assert.equal(value,link());}};
 h.click(copy);await drain();assert.match(h.text(),/活動專頁連結已複製。/);assert.doesNotMatch(h.text(),/手動複製/);
});
test('a pending retry clears prior success and only its latest completion may report',async t=>{
 const h=panel(t);await h.ready([stored()]);await openShare(h);const first=deferred(),second=deferred();let calls=0;
 clipboard.clipboard={writeText(){return ++calls===1?first.promise:second.promise;}};
 h.click(h.button('複製連結'));assert.doesNotMatch(h.text(),/已複製/);
 h.click(h.button('複製連結'));second.reject(Error('latest denied'));await drain();assert.match(h.text(),/手動複製/);
 first.resolve();await drain();assert.match(h.text(),/手動複製/);assert.doesNotMatch(h.text(),/已複製/);
});
for(const outcome of ['resolve','reject'] as const)for(const change of ['event','route','account','client','generation','unmount'])test(`late clipboard ${outcome} is ignored after ${change}`,async t=>{
 const h=panel(t);await h.ready([stored(),stored({event_id:ID2,title:'第二場活動'})]);await openShare(h);const pending=deferred();
 clipboard.clipboard={writeText:()=>pending.promise};h.click(h.button('複製連結'));
 if(change==='event'){clipboard.clipboard={writeText:async()=>{}};await openShare(h,ID2);assert.equal(propsOf(h.field('分享連結')).value,link(ID2));}
 else if(change==='unmount')h.unmount();
 else {const props={...h.props};if(change==='route')props.locationHash=`#events/${ID2}`;
 else if(change==='account')props.session={user:{user_id:'new-owner'}};
 else if(change==='client')props.client={...h.client};else h.client.sessionGeneration++;
 h.setProps(props);assert.equal(Boolean(h.button('複製連結')),false,'old scope share controls are cleared');}
 const before=h.text();if(outcome==='resolve')pending.resolve();else pending.reject(Error('old denied'));await drain();assert.equal(h.text(),before,'old completion cannot alter current notice or controls');
});
for(const kind of ['missing','throw','reject'])test(`initial sharing offers manual recovery for ${kind} clipboard`,async t=>{
 const h=panel(t);await h.ready([stored()]);clipboard.clipboard=kind==='missing'?undefined:{writeText(){if(kind==='throw')throw Error('synthetic denied');return Promise.reject(Error('synthetic denied'));}};
 await openShare(h);assert.equal(propsOf(h.field('分享連結')).value,link());assert.match(h.text(),/請選取上方連結手動複製/);assert.doesNotMatch(h.text(),/已複製/);
});
test('dismissed native share neither copies nor claims success',async t=>{
 const h=panel(t);await h.ready([stored()]);let copies=0;clipboard.share=async()=>{throw Object.assign(Error('dismissed'),{name:'AbortError'});};clipboard.clipboard={writeText:async()=>{copies++;}};
 await openShare(h);assert.equal(copies,0);assert.doesNotMatch(h.text(),/已複製|已開啟分享|手動複製/);assert.equal(propsOf(h.field('分享連結')).value,link());
});
test('late referral link does not reopen sharing after leaving the event',async t=>{
 const h=panel(t);await h.ready([stored()]);h.click(h.button('分享活動'));const request=h.writes().at(-1);h.setProps({...h.props,locationHash:`#events/${ID2}`});
 let copies=0;clipboard.clipboard={writeText:async()=>{copies++;}};await h.settle(request,{path:`/events/${ID}?ref=synthetic_referral`});
 assert.equal(copies,0);assert.equal(Boolean(h.button('複製連結')),false);assert.doesNotMatch(h.text(),/已複製/);
});

for(const outcome of ['resolve','reject'] as const)test(`late native share ${outcome} cannot report or fall back after scope change`,async t=>{
 const h=panel(t);await h.ready([stored()]);const pending=deferred();let copies=0;
 clipboard.share=()=>pending.promise;clipboard.clipboard={writeText:async()=>{copies++;}};await openShare(h);
 h.setProps({...h.props,locationHash:'#events/10000000-0000-4000-8000-000000000002'});const before=h.text();
 if(outcome==='resolve')pending.resolve();else pending.reject(Error('native unavailable'));await drain();
 assert.equal(copies,0);assert.equal(h.text(),before);assert.equal(Boolean(h.button('複製連結')),false);
});
test('a native share success reports sharing without claiming to have copied',async t=>{
 const h=panel(t);await h.ready([stored()]);let copies=0;
 clipboard.share=async(value:any)=>{assert.equal(value.url,link());};clipboard.clipboard={writeText:async()=>{copies++;}};
 await openShare(h);assert.match(h.text(),/已開啟分享/);assert.doesNotMatch(h.text(),/已複製/);assert.equal(copies,0);
});
test('latest referral request owns its link even if the older request completes last',async t=>{
 const h=panel(t);await h.ready([stored(),stored({event_id:ID2,title:'第二場活動'})]);h.click(h.button('分享活動'));const first=h.writes()[0];
 await openShare(h,ID2);const before=h.text();await h.settle(first,{path:`/events/${ID}?ref=synthetic_referral`});
 assert.equal(h.text(),before);assert.equal(propsOf(h.field('分享連結')).value,link(ID2));
});

for(const denied of [false,true])test(`current native share rejection falls back to clipboard ${denied?'rejection':'success'}`,async t=>{
 const h=panel(t);await h.ready([stored()]);let copies=0;
 clipboard.share=async()=>{throw Error('native share unavailable');};
 clipboard.clipboard={writeText:async(value:string)=>{copies++;assert.equal(value,link());if(denied)throw Error('clipboard denied');}};
 await openShare(h);assert.equal(copies,1);assert.equal(h.writes().length,1);assert.equal(propsOf(h.field('分享連結')).value,link());
 if(denied){assert.match(h.text(),/請選取上方連結手動複製/);assert.doesNotMatch(h.text(),/已複製/);}
 else {assert.match(h.text(),/活動專頁連結已複製，分享碼已包含在連結中。/);assert.doesNotMatch(h.text(),/手動複製/);}
 assert.doesNotMatch(h.text(),/已開啟分享/);
});
