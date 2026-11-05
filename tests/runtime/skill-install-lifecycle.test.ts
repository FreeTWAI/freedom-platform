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

// Actual ReactDOM lifecycle and production handlers, synthetic host/transport.
// This does not prove native clipboard permissions or browser download delivery.
const bundled=buildSync({entryPoints:['apps/portal-web/src/modules/SkillInstall.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'}}).outputFiles[0].text;
const descendants=(node:HostNode):HostNode[]=>[node,...node.childNodes.flatMap(descendants)];
const propsOf=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
function deferred<T=any>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const settle=async(fn:()=>void)=>{await React.act(async()=>{fn();await new Promise(resolve=>setImmediate(resolve));});};
async function fixture(){
 const bytes=new TextEncoder().encode('---\nname: demo\n---\n# Synthetic skill\n');
 const sha=Buffer.from(await webcrypto.subtle.digest('SHA-1',Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes]))).toString('hex');
 const digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode('SKILL.md '+sha))).toString('hex');
 return {format:'freedom.skill-install-bundle/v1',book_id:'demo',name:'demo',repository:'Example/demo',commit:'a'.repeat(40),manifest_digest:'sha256:'+digest,files:[{path:'SKILL.md',sha,content_base64:Buffer.from(bytes).toString('base64')}]};
}
function mount(t:TestContext,{strict=false,clipboard}: {strict?:boolean;clipboard?:(text:string)=>Promise<void>}={}){
 const requests:any[]=[],writes:string[]=[],downloads:any[]=[],blobs:Blob[]=[],revoked:string[]=[],timers:Function[]=[];
 const module={exports:{} as any},digests:Promise<ArrayBuffer>[]=[];
 const crypto={subtle:{digest(...args:Parameters<typeof webcrypto.subtle.digest>){const promise=webcrypto.subtle.digest(...args);digests.push(promise);return promise;}}};
 const hostDocument=Object.create(document);hostDocument.body={append(){}};
 hostDocument.createElement=(name:string)=>{assert.equal(name,'a');const link:any={click(){downloads.push({href:link.href,name:link.download});},remove(){}};return link;};
 runInNewContext(bundled,{module,exports:module.exports,require,crypto,TextEncoder,TextDecoder,Uint8Array,Uint32Array,Blob,AbortController,atob,console,navigator:{clipboard:{writeText(text:string){writes.push(text);return clipboard?.(text)??Promise.resolve();}}},document:hostDocument,URL:{createObjectURL(blob:Blob){blobs.push(blob);return 'blob:fixture-'+blobs.length;},revokeObjectURL(url:string){revoked.push(url);}},setTimeout(fn:Function){timers.push(fn);return timers.length;},fetch(_url:string,options:any){const pending=deferred();requests.push({...pending,url:_url,options});return pending.promise;}});
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);let mounted=true;
 const render=(bookId:string)=>flush(()=>root.render(React.createElement(strict?React.StrictMode:React.Fragment,null,React.createElement(module.exports.SkillInstall,{bookId}))));render('demo');
 const nodes=()=>descendants(container),button=(label:string)=>nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent===label)!;
 const click=(label:string)=>{const node=button(label);assert(node);assert(!propsOf(node).disabled);flush(()=>{void propsOf(node).onClick();});};
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};t.after(unmount);
 const respond=async(index=0,data?:any)=>{const value=data??await fixture();await settle(()=>requests[index].resolve({ok:true,json:async()=>value})); // Real WebCrypto may finish after the transport microtask.
  await React.act(async()=>{let completed=0;while(completed<digests.length){const batch=digests.slice(completed);completed=digests.length;await Promise.all(batch);await new Promise(resolve=>setImmediate(resolve));}});};
 return {requests,writes,downloads,blobs,revoked,timers,button,click,unmount,respond,setBook:render,text:()=>container.textContent,choose(target:string){const input=nodes().find(n=>n.nodeName==='INPUT'&&propsOf(n).value===target)!;flush(()=>propsOf(input).onChange());}};
}
for(const action of ['複製安裝指令','下載 zip']){
 test(`closing while ${action} waits suppresses late effects`,async t=>{
  const h=mount(t);h.click(action);assert.equal(h.requests.length,1);h.unmount();await h.respond();
  assert.equal(h.writes.length,0);assert.equal(h.downloads.length,0);assert.equal(h.blobs.length,0);
 });
 test(`StrictMode still permits explicit ${action}`,async t=>{
  const h=mount(t,{strict:true});h.choose('codex');h.click(action);await h.respond();
  assert.match(h.text(),/已下載|已複製/);assert.equal(h.writes.length+h.downloads.length,1);
  if(action==='複製安裝指令')assert.match(h.writes[0],/\.codex\/skills\/demo/);
  else {assert.equal(h.downloads[0].name,'demo.zip');assert.match(await h.blobs[0].text(),/"target": "codex"/);h.timers.forEach(fn=>fn());assert.deepEqual(h.revoked,['blob:fixture-1']);}
 });
}
test('reopening cannot inherit a closed instance request',async t=>{
 const old=mount(t);old.click('複製安裝指令');old.unmount();const fresh=mount(t);fresh.click('下載 zip');
 await fresh.respond();await old.respond();assert.equal(old.writes.length,0);assert.equal(fresh.downloads.length,1);assert.match(fresh.text(),/已下載/);
});
test('failed bundle can retry explicitly and verified cache remains reusable',async t=>{
 const h=mount(t);h.click('下載 zip');await settle(()=>h.requests[0].reject(new Error('synthetic failure')));assert.match(h.text(),/安裝沒有完成/);
 h.click('複製安裝指令');await h.respond(1);assert.equal(h.writes.length,1);h.choose('openclaw');h.click('下載 zip');await settle(()=>{});
 assert.equal(h.requests.length,2);assert.equal(h.downloads.length,1);assert.match(await h.blobs[0].text(),/"target": "openclaw"/);
});
test('tampered bundle still blocks both side effects',async t=>{
 const h=mount(t);h.click('下載 zip');const data=await fixture();data.files[0].content_base64=btoa('tampered');await h.respond(0,data);
 assert.match(h.text(),/驗證失敗/);assert.equal(h.downloads.length+h.writes.length,0);
});
test('same-turn repeated handlers cannot duplicate side effects',async t=>{
 const h=mount(t);const handler=propsOf(h.button('下載 zip')).onClick;flush(()=>{void handler();void handler();});await h.respond();assert.equal(h.downloads.length,1);
});
test('late clipboard completion cannot alter reopened instance',async t=>{
 const pending=deferred<void>(),old=mount(t,{clipboard:()=>pending.promise});old.click('複製安裝指令');await old.respond();assert.equal(old.writes.length,1);old.unmount();
 const fresh=mount(t);await settle(()=>pending.resolve());assert.doesNotMatch(fresh.text(),/已複製/);assert.equal(fresh.writes.length+fresh.downloads.length,0);
});

for(const rejectOld of [false,true])test(`book replacement preserves new request lock/cache after old ${rejectOld?'rejection':'resolution'}`,async t=>{
 const h=mount(t);h.click('下載 zip');h.setBook('replacement');assert.equal(h.requests[0].options.signal.aborted,true);
 h.click('複製安裝指令');assert.equal(h.requests.length,2);
 if(rejectOld)await settle(()=>h.requests[0].reject(new Error('old error')));else await h.respond(0);
 assert.match(h.text(),/正在取得/);assert.equal(h.downloads.length+h.writes.length,0);
 const handler=propsOf(h.button('下載 zip')).onClick;flush(()=>{void handler();});assert.equal(h.requests.length,2,'old finally must not unlock replacement');
 await h.respond(1);assert.equal(h.writes.length,1);h.click('下載 zip');await settle(()=>{});assert.equal(h.requests.length,2,'old rejection must not evict replacement cache');assert.equal(h.downloads.length,1);
});
test('late clipboard success cannot replace new book busy status or unlock it',async t=>{
 const pending=deferred<void>(),h=mount(t,{clipboard:()=>pending.promise});h.click('複製安裝指令');await h.respond();assert.equal(h.writes.length,1);
 h.setBook('replacement');h.click('下載 zip');await settle(()=>pending.resolve());assert.match(h.text(),/正在取得/);
 const handler=propsOf(h.button('下載 zip')).onClick;flush(()=>{void handler();});await h.respond(1);assert.equal(h.downloads.length,1);assert.match(h.text(),/已下載/);
});
test('closing while response JSON is pending prevents later verified effects',async t=>{
 const h=mount(t),body=deferred();h.click('下載 zip');await settle(()=>h.requests[0].resolve({ok:true,json:()=>body.promise}));h.unmount();
 const data=await fixture();await settle(()=>body.resolve(data));await h.respond();assert.equal(h.downloads.length+h.writes.length+h.blobs.length,0);
});
