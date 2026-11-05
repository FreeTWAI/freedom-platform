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
const bundled=buildSync({stdin:{contents:`export {EventFields,blankEvent,eventPayload} from './apps/portal-web/src/modules/EventsPanel';`,resolveDir:process.cwd(),sourcefile:'event-capacity-ui-entry.ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
const production={exports:{} as any};
runInNewContext(bundled.outputFiles[0].text,{module:production,exports:production.exports,crypto:webcrypto,Intl,URL,URLSearchParams,AbortController,Error,Event,CustomEvent:class{constructor(public type:string){}},Blob,console,window,document,HTMLElement:HostNode,HTMLDetailsElement:class{},navigator:{language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork}},fetch:noNetwork,requestAnimationFrame:frame,localStorage:{getItem(){return null;},setItem(){}},setTimeout,clearTimeout,require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='zod')return require('zod');throw Error(name);}});
const {EventFields,blankEvent,eventPayload}=production.exports;
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

function fixture(t:TestContext,capacity='',progressive=false){
 let value={...blankEvent(),capacity},disabled=false,h:ReturnType<typeof host>;
 const props=()=>({value,progressive,disabled,onChange:(next:any)=>{value=next;h.setProps(props());}});
 h=host(t,EventFields,props());
 const custom=()=>h.nodes().find(node=>node.nodeName==='INPUT'&&node.attributes['aria-label']==='自訂人數上限');
 const select=()=>h.nodes().find(node=>node.nodeName==='SELECT'&&node.options.some(option=>propsOf(option).value==='custom'))!;
 const choose=(next:string)=>{flush(()=>propsOf(select()).onChange({target:{value:next}}));};
 const type=(next:string)=>{const input=custom();assert(input,'custom field stays mounted');flush(()=>propsOf(input).onChange({target:{value:next}}));};
 return {...h,custom,select,choose,type,value:()=>value,disabled(next:boolean){disabled=next;h.setProps(props());},reset(capacity=''){value={...blankEvent(),capacity};h.setProps(props());}};
}
for(const progressive of [false,true]){
 test(`custom capacity keeps the same input through 1 → 10 → 101; progressive=${progressive}`,t=>{
  const h=fixture(t,'',progressive);h.choose('custom');const input=h.custom();assert(input);input.focus();
  for(const value of ['1','10','101']){h.type(value);assert(h.custom()===input,'same custom input remains mounted');assert(document.activeElement===input,'custom input retains focus');assert.equal(propsOf(h.select()).value,'custom');assert.equal(propsOf(input).value,value);}
  assert.equal(eventPayload(h.value()).capacity,101);
 });
 test(`clearing custom capacity keeps a required field instead of selecting unlimited; progressive=${progressive}`,t=>{
  const h=fixture(t,'101',progressive);const input=h.custom();assert(input);h.type('');assert(h.custom()===input,'same custom input remains mounted');assert.equal(propsOf(input).value,'');assert.equal(propsOf(input).required,true);assert.equal(propsOf(h.select()).value,'custom');
  h.type('42');assert(h.custom()===input,'same custom input remains mounted');assert.equal(eventPayload(h.value()).capacity,42);
 });
 for(const preset of ['10','20','30','50','100','200','500'])test(`typing preset ${preset} in custom mode retains the field; progressive=${progressive}`,t=>{
  const h=fixture(t,'',progressive);h.choose('custom');const input=h.custom();h.type(preset);h.render();assert(h.custom()===input,'same custom input remains mounted');assert.equal(propsOf(h.select()).value,'custom');assert.equal(eventPayload(h.value()).capacity,Number(preset));
 });
 test(`preset and unlimited remain explicit choices; progressive=${progressive}`,t=>{
  const h=fixture(t,'',progressive);assert.equal(h.custom(),undefined);h.choose('custom');h.type('10');h.choose('20');assert.equal(h.custom(),undefined);assert.equal(propsOf(h.select()).value,'20');assert.equal(eventPayload(h.value()).capacity,20);
  h.choose('custom');h.type('');h.choose('');assert.equal(h.custom(),undefined);assert.equal(propsOf(h.select()).value,'');assert.equal(eventPayload(h.value()).capacity,null);
 });
 test(`stored custom capacity, disabled state and original bounds remain intact; progressive=${progressive}`,t=>{
  const h=fixture(t,'37',progressive);const input=h.custom();assert(input);assert.equal(propsOf(input).min,1);assert.equal(propsOf(input).max,500);assert.equal(propsOf(input).type,'number');h.disabled(true);assert.equal(propsOf(input).disabled,true);assert.equal(propsOf(h.select()).disabled,true);h.disabled(false);assert(h.custom()===input,'same custom input remains mounted');assert.equal(propsOf(input).value,'37');
 });
 test(`stored preset opens as a preset and fresh editor does not inherit custom mode; progressive=${progressive}`,t=>{
  const first=fixture(t,'',progressive);first.choose('custom');first.type('10');first.unmount();const next=fixture(t,'10',progressive);assert.equal(next.custom(),undefined);assert.equal(propsOf(next.select()).value,'10');
 });
 test(`external draft replacement resets custom mode without remounting; progressive=${progressive}`,t=>{
  const h=fixture(t,'',progressive);h.choose('custom');h.type('');h.reset();assert.equal(h.custom(),undefined);assert.equal(propsOf(h.select()).value,'');
  h.choose('custom');h.type('10');h.reset('10');assert.equal(h.custom(),undefined);assert.equal(propsOf(h.select()).value,'10');
  h.reset('37');assert(h.custom(),'stored custom draft remains editable');assert.equal(propsOf(h.custom()!).value,'37');
 });
 test(`other field edits preserve custom mode and blank validation; progressive=${progressive}`,t=>{
  const h=fixture(t,'',progressive);h.choose('custom');h.type('');const input=h.custom();h.change('活動名稱','活動名稱');h.change('活動類型','other');
  assert(h.custom()===input,'other edits retain the custom field');assert.equal(propsOf(h.select()).value,'custom');assert.equal(propsOf(input!).required,true);assert.equal(propsOf(input!).value,'');
 });
}
