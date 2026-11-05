import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
// Real ReactDOM with controlled DOM/event/clipboard ports. This verifies the
// complete PromotionBoards component, not native layout, focus or clipboard.
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
    if (nodeName === 'DIALOG') this.open = false;
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
  setCustomValidity(value:string){this.validationMessage=value;}
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
HostNode.prototype.querySelector=function(selector:string){return descendants(this).find(n=>selector.startsWith('.')?(n.attributes.class??'').split(' ').includes(selector.slice(1)):n.nodeName===selector.toUpperCase())??null;};
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

const clipboard:{writeText?: (text:string)=>Promise<void>}={};
const navigator:any={clipboard};
function load(relative:string, imports:Record<string,unknown>){
 const module={exports:{} as any};
 runInNewContext(transformSync(readFileSync(new URL(relative,import.meta.url),'utf8'),{loader:relative.endsWith('tsx')?'tsx':'ts',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,Intl,window,navigator,require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require(name);if(name.endsWith('.css'))return {};if(name in imports)return imports[name];throw Error('Unexpected import '+name);}});
 return module.exports;
}
const action=load('../../apps/portal-web/src/useLocalAction.ts',{});
const {PromotionBoards}=load('../../apps/portal-web/src/modules/PromotionBoards.tsx',{'../useLocalAction':action,'./MemberAvatar':{MemberAvatar:()=>null},'./PromotionShare':{PromotionShare:()=>null}});
function fixture(t:TestContext,strict=false){
 const requests:any[]=[],copies:any[]=[],container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as any);let mounted=true;
 const client={sessionGeneration:1,get:(path:string)=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}))};
 const props={client};const commits:string[]=[];
 navigator.clipboard=clipboard;
 clipboard.writeText=text=>new Promise((resolve,reject)=>copies.push({text,resolve,reject}));
 const render=()=>flush(()=>root.render(React.createElement(strict?React.StrictMode:React.Fragment,null,React.createElement(React.Profiler,{id:'boards',onRender(){commits.push(container.textContent);}},React.createElement(PromotionBoards,props)))));
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};t.after(unmount);render();
 const nodes=()=>descendants(container),propsOf=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
 const button=(text:string)=>nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent===text)!;
 const copyButtons=()=>nodes().filter(n=>n.nodeName==='BUTTON'&&n.textContent==='複製');
 const click=(node:HostNode)=>{assert(node,'mounted control');assert(container.contains(node));assert(!propsOf(node).disabled,'control enabled');flush(()=>node.dispatchEvent({type:'click',button:0}));};
 const settle=async(r:any,value?:any,reject=false)=>{assert(r,'pending operation');await React.act(async()=>{r.settled=true;r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
 const start=async(period='week')=>{const pending=requests.filter(r=>!r.settled&&r.path.endsWith('period='+period));assert.equal(pending.length,strict&&pending[0]===requests[0]?4:2);for(const request of pending)await settle(request,request.path.includes('/leaderboards?')?{period,since:null,boards:[]}:{period,items:[{kind:'platform',target:'workshop',code:'alpha',path:'/go/alpha',title:'Alpha',period_points:1,available:true},{kind:'skill_book',target:'book:beta',code:'beta',path:'/go/beta',title:'Beta',period_points:2,available:true}]});};
 return {container,client,props,render,unmount,nodes,propsOf,button,copyButtons,click,settle,start,requests,copies,commits,text:()=>container.textContent};
}
test('a new copy clears the prior success until its own acknowledgement',async t=>{
 const h=fixture(t);await h.start();h.click(h.copyButtons()[0]);await h.settle(h.copies[0]);assert.match(h.text(),/已複製連結/);
 h.click(h.copyButtons()[1]);assert.doesNotMatch(h.text(),/已複製連結/);assert.equal(h.copies[1].text,'https://fixture.invalid/go/beta');await h.settle(h.copies[1],Error('denied'),true);assert.match(h.text(),/https:\/\/fixture.invalid\/go\/beta/);assert.doesNotMatch(h.text(),/已複製連結/);
});
for(const outcome of ['resolve','reject'] as const)test('period change suppresses a late clipboard '+outcome,async t=>{
 const h=fixture(t);await h.start();h.click(h.copyButtons()[0]);h.click(h.button('本月'));await h.start('month');h.commits.length=0;
 await h.settle(h.copies[0],outcome==='reject'?Error('denied'):undefined,outcome==='reject');assert.doesNotMatch(h.text(),/已複製連結|https:\/\/fixture.invalid\/go\/alpha/);assert.equal(h.copies.length,1);assert.equal(h.requests.length,4);
});
test('repeated clicks before commit call the browser capability only once',async t=>{
 const h=fixture(t);await h.start();const button=h.copyButtons()[0];flush(()=>{button.dispatchEvent({type:'click',button:0});button.dispatchEvent({type:'click',button:0});});assert.equal(h.copies.length,1);await h.settle(h.copies[0]);
});

for(const failure of ['missing-api','missing-method','throw','reject'] as const)test(`clipboard ${failure} leaves the original URL and allows an explicit successful retry`,async t=>{
 const h=fixture(t);await h.start();const writes=clipboard.writeText!;
 if(failure==='missing-api')navigator.clipboard=undefined;
 if(failure==='missing-method')delete clipboard.writeText;
 if(failure==='throw')clipboard.writeText=()=>{throw Error('PRIVATE capability diagnostic');};
 h.click(h.copyButtons()[0]);
 if(failure==='reject')await h.settle(h.copies[0],Error('PRIVATE capability diagnostic'),true);else await React.act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
 assert.match(h.text(),/https:\/\/fixture.invalid\/go\/alpha/);assert.doesNotMatch(h.text(),/已複製連結|PRIVATE/);assert(h.copyButtons().every(b=>!h.propsOf(b).disabled));
 navigator.clipboard=clipboard;clipboard.writeText=writes;h.click(h.copyButtons()[0]);assert.doesNotMatch(h.text(),/https:\/\/fixture.invalid\/go\/alpha|已複製連結/);await h.settle(h.copies.at(-1));assert.match(h.text(),/已複製連結/);assert.doesNotMatch(h.text(),/https:\/\/fixture.invalid\/go\/alpha/);assert.equal(h.requests.length,2);
});
test('only the selected row is busy; all copy controls wait for the unresolved capability',async t=>{
 const h=fixture(t);await h.start();h.click(h.copyButtons()[0]);assert(h.copyButtons().every(b=>h.propsOf(b).disabled));assert.equal(h.copyButtons()[0].getAttribute('aria-busy'),'true');assert.equal(h.copyButtons()[1].getAttribute('aria-busy'),'false');assert(!h.propsOf(h.button('本月')).disabled);
 // A native disabled button cannot start another operation, even with a click event.
 flush(()=>h.copyButtons()[1].dispatchEvent({type:'click',button:0}));assert.equal(h.copies.length,1);await h.settle(h.copies[0]);assert(h.copyButtons().every(b=>!h.propsOf(b).disabled));
});
for(const owner of ['client','session'] as const)for(const outcome of ['resolve','reject'] as const)test(`${owner} change suppresses a late ${outcome}`,async t=>{
 const h=fixture(t);await h.start();h.click(h.copyButtons()[0]);if(owner==='client')h.props.client={...h.client};else h.client.sessionGeneration++;
 h.render();if(owner==='client')await h.start();await h.settle(h.copies[0],outcome==='reject'?Error('denied'):undefined,outcome==='reject');assert.doesNotMatch(h.text(),/已複製連結|https:\/\/fixture.invalid\/go\/alpha/);
 h.click(h.copyButtons()[1]);await h.settle(h.copies[1]);assert.match(h.text(),/已複製連結/);assert.equal(h.copies[1].text,'https://fixture.invalid/go/beta');
});
for(const outcome of ['resolve','reject'] as const)test(`unmounted copy ${outcome} cannot affect a reopened board`,async t=>{
 const old=fixture(t);await old.start();old.click(old.copyButtons()[0]);old.unmount();const next=fixture(t);await next.start();next.click(next.copyButtons()[1]);await next.settle(next.copies[0]);
 await old.settle(old.copies[0],outcome==='reject'?Error('denied'):undefined,outcome==='reject');assert.match(next.text(),/已複製連結/);assert.doesNotMatch(next.text(),/https:\/\/fixture.invalid\/go\/alpha/);assert.equal(next.copies.length,1);
});
test('leaving and returning to the same period still rejects the older result and never retries automatically',async t=>{
 const h=fixture(t);await h.start();h.click(h.copyButtons()[0]);h.click(h.button('本月'));await h.start('month');h.click(h.button('本週'));await h.start();assert(h.copyButtons().every(b=>h.propsOf(b).disabled));assert.equal(h.copies.length,1);
 await h.settle(h.copies[0]);assert.doesNotMatch(h.text(),/已複製連結/);assert(h.copyButtons().every(b=>!h.propsOf(b).disabled));assert.equal(h.copies.length,1);h.click(h.copyButtons()[1]);await h.settle(h.copies[1]);assert.match(h.text(),/已複製連結/);assert.equal(h.requests.length,6);
});
for(const owner of ['client','session','period'] as const)test(`completed copy notice is absent from the first replacement ${owner} commit`,async t=>{
 const h=fixture(t);await h.start();h.click(h.copyButtons()[0]);await h.settle(h.copies[0]);assert.match(h.text(),/已複製連結/);h.commits.length=0;
 if(owner==='period')h.click(h.button('本月'));else {if(owner==='client')h.props.client={...h.client};else h.client.sessionGeneration++;h.render();}
 assert(h.commits.length>0);for(const text of h.commits)assert.doesNotMatch(text,/已複製連結/);
});

test('StrictMode effect replay preserves failure recovery and explicit retry',async t=>{
 const h=fixture(t,true);await h.start();h.click(h.copyButtons()[0]);await h.settle(h.copies[0],Error('denied'),true);assert.match(h.text(),/https:\/\/fixture.invalid\/go\/alpha/);h.click(h.copyButtons()[1]);assert.doesNotMatch(h.text(),/https:\/\/fixture.invalid\/go\/alpha/);await h.settle(h.copies[1]);assert.match(h.text(),/已複製連結/);assert.equal(h.requests.length,4);
});
test('StrictMode ignores a copy completed after period replacement',async t=>{
 const h=fixture(t,true);await h.start();h.click(h.copyButtons()[0]);h.click(h.button('本月'));await h.start('month');await h.settle(h.copies[0],Error('denied'),true);assert.doesNotMatch(h.text(),/已複製連結|https:\/\/fixture.invalid\/go\/alpha/);h.click(h.copyButtons()[1]);await h.settle(h.copies[1]);assert.match(h.text(),/已複製連結/);
});
test('read retry remains usable during an old copy and never retries clipboard automatically',async t=>{
 const h=fixture(t);await h.start();h.click(h.copyButtons()[0]);h.click(h.button('本月'));
 await h.settle(h.requests[2],Error('read unavailable'),true);await h.settle(h.requests[3],{period:'month',items:[]});h.click(h.button('重新載入分享紀錄'));await h.start('month');assert.equal(h.requests.length,6);assert.deepEqual(h.requests.slice(4).map(r=>r.path),['/promotion/leaderboards?period=month','/promotion/links/mine?period=month']);assert.equal(h.copies.length,1);assert(h.copyButtons().every(b=>h.propsOf(b).disabled));
 await h.settle(h.copies[0]);assert.doesNotMatch(h.text(),/已複製連結/);assert.equal(h.copies.length,1);h.click(h.copyButtons()[1]);await h.settle(h.copies[1]);assert.match(h.text(),/已複製連結/);
});
