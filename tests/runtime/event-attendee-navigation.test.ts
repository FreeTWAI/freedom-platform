import {replaceLegacyAddress,canonicalHash,portalHash,legacyHash} from '../../apps/portal-web/src/portal-route.js';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildSync,transformSync} from 'esbuild';
import ts from '@typescript/typescript6';
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
// Complete production EventsPanel (including attendee dialog) and actual App
// navigation callbacks/effect are mounted in a synthetic ReactDOM host. Browser
// event delivery, history, dialog/focus and transport are controlled ports; this
// does not claim native rendering, keyboard, focus or PostgreSQL verification.
const noNetwork=()=>{throw Error('Real network forbidden');};
const navigator={language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork},share:noNetwork};
document.visibilityState='visible';
const base=process.cwd();
const bundled=buildSync({stdin:{contents:`export {EventsPanel} from './apps/portal-web/src/modules/EventsPanel'; export {ApiError} from './apps/portal-web/src/api';`,resolveDir:base,sourcefile:'diagnostic-entry.ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},supported:{'dynamic-import':false},metafile:true});
const production={exports:{} as any};
runInNewContext(bundled.outputFiles[0].text,{module:production,exports:production.exports,crypto:webcrypto,Intl,URL,URLSearchParams,AbortController,Error,Event,CustomEvent:class {constructor(public type:string){}},Blob,console,window,document,navigator,fetch:noNetwork,localStorage:{getItem(){return null;},setItem(){}},sessionStorage:{getItem(){return null;},setItem(){}},setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='zod')return require('zod');throw Error('Unexpected external import: '+name);}});
const {EventsPanel,ApiError}=production.exports;
const appSource=readFileSync(path.join(base,'apps/portal-web/src/App.tsx'),'utf8');
const ast=ts.createSourceFile('App.tsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const workspace=ast.statements.find((n:any)=>ts.isFunctionDeclaration(n)&&n.name?.text==='Workspace') as any;assert(workspace?.body);
function actual(name:string){const n=workspace.body.statements.find((n:any)=>ts.isVariableStatement(n)?n.declarationList.declarations.some((d:any)=>d.name.getText(ast)===name):ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(n,name);return n.getText(ast);}
const navigationEffect=workspace.body.statements.find((n:any)=>n.getText(ast).includes("window.addEventListener('hashchange', changed)"));assert(navigationEffect);
const shellSource=['registerPageLeave','openMessages','closeMessagesThen','selectTab','navigateNotification'].map(actual).join('\n')+'\n'+navigationEffect.getText(ast)+'\nglobalThis.route={registerPageLeave,navigateNotification,selectTab};';
const communitySource=readFileSync(path.join(base,'apps/portal-web/src/features/community.tsx'),'utf8');
const communityAst=ts.createSourceFile('community.tsx',communitySource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declaration=communityAst.statements.flatMap((n:any)=>ts.isVariableStatement(n)?Array.from(n.declarationList.declarations):[]).find((n:any)=>n.name.getText(communityAst)==='communityFeatures') as any;
const eventEntry=declaration.initializer.expression.properties.find((p:any)=>p.name.getText(communityAst).replaceAll('"','')==='events').initializer.getText(communityAst);
// Full actual entry; optional mission/card rendering ports return null fixtures.
// This does not validate those optional panels. Helpers and mutation hooks are real.
const entry=runInNewContext(transformSync('('+eventEntry+')',{loader:'tsx',format:'cjs',jsx:'transform'}).code,{React,EventsPanel,EventMissions:()=>null,EventMemberCards:()=>null});
const OWNER='30000000-0000-4000-8000-000000000001';
const IDS=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'];
const event=(i:number)=>({event_id:IDS[i],title:['活動甲','活動乙'][i],description:'合成活動說明 '+i,starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'online',location:'合成線上活動 '+i,event_kind:'meetup',topic:null,online_url:null,visibility:'open',registration_policy:'community_member',banner_url:null,banner_orientation:null,video_url:null,video_mime:null,capacity:100,state:'published',aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,organizer_ref:OWNER,organizer_name:'合成主辦'});
const row=(i:number)=>({kind:'member',user_id:'member-'+i,nickname:'名單會員'+i,avatar_url:null,registered_at:new Date().toISOString()});
function fixture(t:TestContext,hash='#events'){
 hash=canonicalHash(hash);
 const originalConfirm=window.confirm;t.after(()=>{window.confirm=originalConfirm;});
 const commits:{hash:string;text:string;roster:string}[]=[],requests:any[]=[],container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as any);let mounted=true;
 Object.assign(window.location,{origin:'https://fixture.invalid',pathname:'/',search:'',hash});
 Object.defineProperty(window.location,'href',{configurable:true,get(){return window.location.origin+window.location.pathname+window.location.search+window.location.hash;}});
 (window as any).history={state:null,replaceState(state:any,_unused:any,url?:string){this.state=state;if(url){const target=new URL(url,window.location.href);Object.assign(window.location,{pathname:target.pathname,search:target.search,hash:target.hash});}},pushState:noNetwork,back:noNetwork};
 const transport=(method:string)=>(url:string,body?:any,options?:any)=>new Promise((resolve,reject)=>requests.push({method,path:url,body,options,resolve,reject}));
 const client={sessionGeneration:1,get:transport('GET'),post:transport('POST')};
 const props:any={client,session:{user:{user_id:OWNER}},site:{event_participation_enabled:false},locationHash:hash};
 let shell:any;
 function Host(){
  const [current,setHash]=React.useState(props.locationHash);props.locationHash=current;
  shell={useCallback:React.useCallback,useEffect:React.useEffect,acceptedHash:React.useRef(current),pageLeaveGuard:React.useRef(null),messageHistoryTransition:React.useRef(null),isMessagesHistoryEntry:()=>false,messagesHistoryState:()=>null,messageLocation:React.useRef({href:window.location.href,state:null}),messageLeaveGuard:React.useRef(null),notificationSequence:React.useRef(0),canEndConsoleSession:()=>true,orderNotificationDestination:()=>null,
   replaceLegacyAddress,canonicalHash,portalHash,legacyHash,launchpadEnabled:false,tabFromHash:()=> 'events',isMessagesHash:()=>false,setMessagesMounted(){},setTab(){},setLocationHash:setHash,setFriendScope(){},setMessagesOpen(){},setMobileOpen(){},mainContent:{current:{focus(){}}},setNotificationTarget(){},window,HashChangeEvent:class{constructor(public type:string){}}};
  runInNewContext(transformSync(shellSource,{loader:'tsx',format:'cjs'}).code,shell);
  return React.createElement(React.Profiler,{id:'events',onRender(){commits.push({hash:current,text:container.textContent,roster:descendants(container).find(n=>n.nodeName==='DIALOG'&&(n.attributes.class??'')==='event-attendees-dialog')?.textContent??''});}},entry.render({...props,locationHash:legacyHash(props.locationHash),registerPageLeave:shell.route.registerPageLeave,selectTab:shell.route.selectTab}));
 }
 const render=()=>flush(()=>root.render(React.createElement(Host)));
 // Model the browser's hash/history event only. The production App callback and
 // event feature render execute unchanged; this is not native history evidence.
 const route=(hash:string)=>flush(()=>{window.location.hash=hash;window.dispatchEvent({type:'popstate'});window.dispatchEvent({type:'hashchange'});});
 render();t.after(()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}});
 const nodes=()=>descendants(container),propsOf=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
 const button=(text:string,scope=container)=>descendants(scope).find(n=>n.nodeName==='BUTTON'&&n.textContent===text);
 const click=(node:HostNode)=>{assert(node,'mounted button');assert(container.contains(node));assert(!propsOf(node).disabled);flush(()=>node.dispatchEvent({type:'click',button:0}));};
 const settle=async(r:any,value:any,reject=false)=>{assert(r,'request');await React.act(async()=>{r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
 const reads=(part:string)=>requests.filter(r=>r.method==='GET'&&r.path.includes(part));
 const start=async(list=[event(0),event(1)])=>{await settle(reads('/guilds/directory')[0],{items:[]});await settle(reads('/events/bulletins')[0],{items:[]});await settle(requests.find(r=>r.path==='/events'),{items:list});};
 const dialog=()=>nodes().find(n=>n.nodeName==='DIALOG'&&(n.attributes.class??'')==='event-attendees-dialog')!;
 return{container,client,props,render,route,start,reads,requests,settle,click,button,dialog,commits,nodes,propsOf,text:()=>container.textContent};
}
test('current route changes dismiss the previous event roster instead of reopening it over the list',async t=>{
 const h=fixture(t,'#events/'+IDS[0]);await h.start();h.click(h.button('報名名單')!);assert(h.dialog().open);const first=h.reads('/attendees')[0];await h.settle(first,{items:[row(0)],total:1,next_offset:null});assert.match(h.dialog().textContent,/活動甲/);
 h.route('#events');assert.equal(h.dialog().open,false,'browser Back route must dismiss old roster');
});
test('current event changes dismiss the previous event roster rather than showing A over B',async t=>{
 const h=fixture(t,'#events/'+IDS[0]);await h.start();h.click(h.button('報名名單')!);await h.settle(h.reads('/attendees')[0],{items:[row(0)],total:1,next_offset:null});
 h.route('#events/'+IDS[1]);assert.equal(h.dialog().open,false,'event B must not retain A roster');
});
test('initial failure and pagination failure both recover via actual retry controls',async t=>{
 const h=fixture(t);await h.start();h.click(h.button('報名名單')!);await h.settle(h.reads('/attendees')[0],new Error('合成名單暫時失敗'),true);h.click(h.button('重試',h.dialog())!);assert.match(h.reads('/attendees').at(-1).path,/offset=0$/);await h.settle(h.reads('/attendees').at(-1),{items:Array.from({length:50},(_,i)=>row(i)),total:51,next_offset:50});
 h.click(h.button('載入更多',h.dialog())!);await h.settle(h.reads('/attendees').at(-1),new Error('合成第二頁失敗'),true);assert.equal(descendants(h.dialog()).filter(n=>n.nodeName==='LI').length,50);h.click(h.button('重試',h.dialog())!);assert.match(h.reads('/attendees').at(-1).path,/offset=50$/);await h.settle(h.reads('/attendees').at(-1),{items:[row(50)],total:51,next_offset:null});assert.equal(descendants(h.dialog()).filter(n=>n.nodeName==='LI').length,51);
});
test('close and reopen ignores the previous pending roster response',async t=>{
 const h=fixture(t);await h.start();const trigger=h.button('報名名單')!;h.click(trigger);const old=h.reads('/attendees')[0];h.click(h.button('關閉',h.dialog())!);assert(!h.dialog().open);h.click(trigger);const current=h.reads('/attendees').at(-1);await h.settle(current,{items:[row(1)],total:1,next_offset:null});await h.settle(old,{items:[row(0)],total:1,next_offset:null});assert.match(h.dialog().textContent,/名單會員1/);assert.doesNotMatch(h.dialog().textContent,/名單會員0/);
});
for(const initial of ['#events','#events/'+IDS[0]])test(`accepted leave from ${initial} fences stale roster at commit and return needs a fresh open`,async t=>{
 const h=fixture(t,initial);await h.start();h.click(h.button('報名名單')!);const old=h.reads('/attendees')[0];await h.settle(old,{items:[row(0)],total:1,next_offset:null});
 const next=initial==='#events'?'#events/'+IDS[0]:'#events';h.commits.length=0;h.route(next);assert.equal(window.location.hash,canonicalHash(next));assert(!h.dialog().open);
 for(const commit of h.commits.filter(c=>c.hash===canonicalHash(next))){assert.doesNotMatch(commit.text,/名單會員0/,'no old private row in destination commit');assert.equal(commit.roster,'','no old roster scope in destination commit');}
 const readCount=h.reads('/attendees').length;h.route(initial);assert(!h.dialog().open);assert.equal(h.reads('/attendees').length,readCount,'history must not silently reopen or reload roster');
 h.click(h.button('報名名單')!);assert(h.dialog().open);assert.equal(h.reads('/attendees').length,readCount+1);assert.match(h.reads('/attendees').at(-1).path,new RegExp(IDS[0]+'/attendees\\?limit=50&offset=0$'));assert.doesNotMatch(h.dialog().textContent,/名單會員0/);
 await h.settle(h.reads('/attendees').at(-1),{items:[row(1)],total:1,next_offset:null});assert.match(h.dialog().textContent,/名單會員1/);
});
for(const late of ['success','failure'])test(`late ${late} after accepted leave cannot reopen old roster or contaminate new event`,async t=>{
 const h=fixture(t,'#events/'+IDS[0]);await h.start();h.click(h.button('報名名單')!);const old=h.reads('/attendees')[0];
 h.route('#events/'+IDS[1]);assert(!h.dialog().open);h.click(h.button('報名名單')!);const current=h.reads('/attendees').at(-1);assert.match(current.path,new RegExp(IDS[1]+'/attendees'));await h.settle(current,{items:[row(1)],total:1,next_offset:null});
 await h.settle(old,late==='success'?{items:[row(0)],total:1,next_offset:null}:new Error('舊名單失敗'),late==='failure');assert(h.dialog().open);assert.match(h.dialog().textContent,/活動乙/);assert.match(h.dialog().textContent,/名單會員1/);assert.doesNotMatch(h.dialog().textContent,/名單會員0|舊名單失敗/);
});
// App imports one PortalClient singleton; the actual feature key changes on
// account or session generation. Direct client-prop replacement is separately
// retained as Ted integration evidence, not a reachable main navigation case.
for(const change of ['generation','account'])test(`replacement ${change} removes the previous private roster and ignores its late page`,async t=>{
 const h=fixture(t);await h.start();h.click(h.button('報名名單')!);await h.settle(h.reads('/attendees')[0],{items:[row(0)],total:2,next_offset:50});h.click(h.button('載入更多',h.dialog())!);const old=h.reads('/attendees').at(-1);
 if(change==='generation')h.client.sessionGeneration++;if(change==='account')h.props.session={user:{user_id:'50000000-0000-4000-8000-000000000001'}};
 h.commits.length=0;h.render();assert(!h.dialog().open);assert.doesNotMatch(h.text(),/名單會員0/);for(const commit of h.commits)assert.doesNotMatch(commit.text,/名單會員0/,'private roster absent in every replacement commit');await h.settle(old,{items:[row(1)],total:2,next_offset:null});assert(!h.dialog().open);assert.doesNotMatch(h.text(),/名單會員[01]/);
});
for(const state of ['pending','unknown'])test(`rejected ${state} RSVP navigation preserves current roster and original operation`,async t=>{
 const h=fixture(t,'#events/'+IDS[0]);await h.start();h.click(h.button('我要參加')!);const original=h.requests.find(r=>r.method==='POST');assert(original);
 if(state==='unknown')await h.settle(original,new ApiError({message:'合成ACK遺失',network:true}),true);
 h.click(h.button('報名名單')!);await h.settle(h.reads('/attendees')[0],{items:[row(0)],total:1,next_offset:null});const reads=h.reads('/attendees').length;
 h.route('#events');assert.equal(window.location.hash,canonicalHash('#events/'+IDS[0]));assert.equal(h.props.locationHash,canonicalHash('#events/'+IDS[0]));assert(h.dialog().open);assert.match(h.dialog().textContent,/名單會員0/);assert.equal(h.reads('/attendees').length,reads);assert.equal(h.requests.filter(r=>r.method==='POST').length,1);
 h.click(h.button('關閉',h.dialog())!);if(state==='pending')await h.settle(original,new ApiError({message:'合成ACK遺失',network:true}),true);
 h.click(h.button('重試原活動操作')!);const retry=h.requests.filter(r=>r.method==='POST').at(-1);assert.equal(retry.path,original.path);assert.deepEqual(retry.body,original.body);assert.deepEqual(retry.options,original.options);
});
test('rejected dirty navigation keeps the roster; accepted discard alone clears it',async t=>{
 const h=fixture(t);await h.start();h.click(h.button('辦活動')!);const title=h.nodes().find(n=>n.nodeName==='INPUT'&&h.propsOf(n)?.maxLength===120);assert(title);
 flush(()=>h.propsOf(title).onChange({target:{value:'保留未儲存草稿'}}));h.click(h.button('報名名單')!);await h.settle(h.reads('/attendees')[0],{items:[row(0)],total:1,next_offset:null});let confirmations=0;window.confirm=()=>{confirmations++;return false;};
 h.route('#events/'+IDS[1]);assert.equal(confirmations,1);assert.equal(window.location.hash,canonicalHash('#events'));assert(h.dialog().open);assert.match(h.dialog().textContent,/名單會員0/);assert.equal(h.propsOf(title).value,'保留未儲存草稿');
 window.confirm=()=>true;h.route('#events/'+IDS[1]);assert.equal(window.location.hash,canonicalHash('#events/'+IDS[1]));assert(!h.dialog().open);assert.equal(h.requests.filter(r=>r.method==='POST').length,0);
});
test('same accepted route retains the open roster, and explicit cancel restores its trigger',async t=>{
 const h=fixture(t);await h.start();const trigger=h.button('報名名單')!;h.click(trigger);await h.settle(h.reads('/attendees')[0],{items:[row(0)],total:1,next_offset:null});h.route('#events');assert(h.dialog().open);assert.equal(h.reads('/attendees').length,1);
 flush(()=>h.dialog().dispatchEvent({type:'cancel',bubbles:false}));assert(!h.dialog().open);assert.equal(document.activeElement,trigger,'synthetic focus port only, native focus is covered by E2E');
});

test('opening the next event roster never commits the previous private rows',async t=>{
 const h=fixture(t,'#events/'+IDS[0]);await h.start();h.click(h.button('報名名單')!);await h.settle(h.reads('/attendees')[0],{items:[row(0)],total:1,next_offset:null});h.route('#events/'+IDS[1]);h.commits.length=0;h.click(h.button('報名名單')!);assert(h.commits.length);for(const commit of h.commits)assert.doesNotMatch(commit.text,/名單會員0/,'child commits before effects must not show prior event rows');
});
