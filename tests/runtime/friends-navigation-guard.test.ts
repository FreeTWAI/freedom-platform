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
const window = {location:{origin:'https://fixture.invalid'},setTimeout(fn:Function){const id=++nextTimer;scheduled.set(id,fn);return id;},clearTimeout(id:number){scheduled.delete(id);},open(){throw Error('No external navigation permitted');},document, HTMLElement: HostNode, HTMLIFrameElement: class {}, listeners:{} as Record<string,Function[]>, addEventListener(type:string,fn:Function) {(this.listeners[type]??=[]).push(fn);}, removeEventListener(type:string,fn:Function) {this.listeners[type]=(this.listeners[type]??[]).filter(x=>x!==fn);}, dispatchEvent(e:any) {for(const fn of [...(this.listeners[e.type]??[])])fn(e);return true;}, get event() {return undefined;}};
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
HostNode.prototype.querySelector=function(selector:string){assert.match(selector,/^\.[a-z-]+$/);return descendants(this).find(n=>(n.attributes.class??'').split(' ').includes(selector.slice(1)))??null;};
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
// Full production FriendsPanel + mutation/directory/rows run in real React/ReactDOM.
// Only the DOM and network are synthetic. App callback statements and the identity
// friends entry below are AST-extracted and executed, not a mounted full App or browser.
const noNetwork=()=>{throw Error('Real network forbidden');};
const navigator={language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork},share:noNetwork};
document.visibilityState='visible';
const base=process.cwd();
const bundled=buildSync({stdin:{contents:`export {FriendsPanel} from './apps/portal-web/src/modules/FriendsPanel'; export {ApiError} from './apps/portal-web/src/api';`,resolveDir:base,sourcefile:'diagnostic-entry.ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},supported:{'dynamic-import':false},metafile:true});
assert(Object.keys(bundled.metafile!.inputs).some(name=>name.endsWith('/shared.tsx')));
assert(Object.keys(bundled.metafile!.inputs).some(name=>name.endsWith('/friends-directory-controller.ts')));
const production={exports:{} as any};
runInNewContext(bundled.outputFiles[0].text,{module:production,exports:production.exports,crypto:webcrypto,Intl,URL,URLSearchParams,AbortController,Error,Event,CustomEvent:class {constructor(public type:string){}},Blob,console,window,document,navigator,fetch:noNetwork,localStorage:{getItem(){return null;},setItem:noNetwork},setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),require(name:string){
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return require('react/jsx-runtime');
  if(name==='zod')return require('zod');
  if(name==='qrcode')return require('qrcode');
  throw Error(`Unexpected external import ${name}`);
}});
const {FriendsPanel,ApiError}=production.exports;
const OWNER='30000000-0000-4000-8000-000000000001',PEER='30000000-0000-4000-8000-000000000002';
const privateCard=(state='pending')=>({user_id:PEER,nickname:'合成活動夥伴',primary_guild:{name:'活動公會',guild_key:'events'},secondary_guilds:[],capabilities:[],equipment:[],contacts:{},is_self:false,positioning_title:null,is_online:false,last_seen_at:null,friendship:{state,requester_ref:PEER,aggregate_version:7}});
const definition=()=>({capability_categories:[],equipment_categories:[]});
const settle=async(fn:()=>void=()=>{})=>{await React.act(async()=>{fn();});};
// Extract complete AST statements from the actual App, not pattern assertions or
// rewritten navigation logic. The host supplies state setters/history only.
const appSource=readFileSync(path.join(base,'apps/portal-web/src/App.tsx'),'utf8');
const appAst=ts.createSourceFile('App.tsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const workspace=appAst.statements.find((n:any)=>ts.isFunctionDeclaration(n)&&n.name?.text==='Workspace') as any;assert(workspace?.body);
function actualDeclaration(name:string){const stmt=workspace.body.statements.find((n:any)=>ts.isVariableStatement(n)&&n.declarationList.declarations.some((d:any)=>d.name.getText(appAst)===name));assert(stmt,name);return stmt.getText(appAst);}
const actualSelect=actualDeclaration('selectTab'),actualClose=actualDeclaration('closeMessagesThen'),actualRegister=actualDeclaration('registerPageLeave'),actualOpen=actualDeclaration('openMessages');
const identitySource=readFileSync(path.join(base,'apps/portal-web/src/features/identity.tsx'),'utf8');
const identityAst=ts.createSourceFile('identity.tsx',identitySource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const identityDecl=identityAst.statements.flatMap((s:any)=>ts.isVariableStatement(s)?Array.from(s.declarationList.declarations):[]).find((d:any)=>d.name.getText(identityAst)==='identityFeatures') as any;assert(identityDecl);
const identityObject=identityDecl.initializer.expression;
const friendProperty=identityObject.properties.find((p:any)=>p.name.getText(identityAst).replaceAll('"','')==='friends');assert(friendProperty);
const friendEntrySource=friendProperty.initializer.getText(identityAst);
const friendEntry=runInNewContext(transformSync('('+friendEntrySource+')',{loader:'tsx',format:'cjs',jsx:'transform'}).code,{React,FriendsPanel});


function fixture(t:TestContext){
 const requests:any[]=[],navigations:string[]=[],container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);let mounted=true,route='friends',messagesOpen=false;let shell:any;
 const transport=(method:string)=>(url:string,body?:any,options?:any)=>new Promise((resolve,reject)=>requests.push({method,path:url,body,options,ownerId:props.session.user.user_id,ownerGeneration:props.client.sessionGeneration,resolve,reject,settled:false}));
 const client={sessionGeneration:1,get:transport('GET'),post:transport('POST')};
 let props:any={client,session:{user:{user_id:OWNER}},initialScope:'incoming',memberBlockingEnabled:false,onMessage:noNetwork,onNavigate(next:string){shell.selectTab(next)}};
 shell={useCallback:(fn:any)=>fn,acceptedHash:{current:'#friends'},pageLeaveGuard:{current:null},messageHistoryTransition:{current:null},isMessagesHistoryEntry:(state:any)=>state?.messages===true,messagesHistoryState:(messages:boolean)=>({messages}),messageLocation:{current:null},setMessagesMounted(){},
 setTab(value:string){route=value;},setLocationHash(){},setFriendScope(){},setMessagesOpen(value:boolean){messagesOpen=value;},setMobileOpen(){},mainContent:{current:{focus(){}}},
 window:{location:{pathname:'/',search:'',hash:'#friends'},history:{state:null,back(){shell.window.history.state=null;const transition=shell.messageHistoryTransition.current;shell.messageHistoryTransition.current=null;transition?.after?.();},pushState(state:any){shell.window.history.state=state;},replaceState:noNetwork},dispatchEvent:noNetwork}};
 runInNewContext(transformSync(actualRegister+';'+actualOpen+';'+actualClose+';'+actualSelect+';globalThis.selectTab=selectTab;globalThis.registerPageLeave=registerPageLeave;globalThis.closeMessagesThen=closeMessagesThen;', {loader:'tsx',format:'cjs'}).code,shell);
 const sourceSelect=shell.selectTab;shell.selectTab=(next:string)=>React.act(()=>{navigations.push(next);sourceSelect(next);render();});
 function render(change:any={}){props={...props,...change};flush(()=>root.render(route==='friends'?friendEntry.render({client:props.client,session:props.session,site:{member_blocking_enabled:false},selectTab:shell.selectTab,friendScope:props.initialScope,openMemberMessage:noNetwork,registerPageLeave:shell.registerPageLeave}):React.createElement('p',null,'合成路由目的地')));}
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};
 t.after(()=>{unmount();scheduled.clear();});
 const find=(predicate:(n:HostNode)=>boolean)=>descendants(container).find(predicate);
 const button=(text:string)=>find(n=>n.nodeName==='BUTTON'&&n.textContent===text);
 const clickRaw=(node:HostNode|undefined)=>{assert(node,'control exists');assert(container.contains(node),'control mounted');assert(!node.hasAttribute('disabled'),'control enabled');for(let n:HostNode|null=node;n;n=n.parentNode){assert(!n.hasAttribute('hidden'),'not hidden');assert.notEqual(n.style.display,'none');if(n.nodeName==='DETAILS'&&n.firstChild!==node)assert(n.hasAttribute('open'),'details open');}node.dispatchEvent({type:'click',bubbles:true,button:0});};
 const click=(node:HostNode|undefined)=>flush(()=>clickRaw(node));
 const pending=(url:string)=>requests.filter(r=>r.path===url&&!r.settled);
 const resolve=async(r:any,value:any)=>{assert(r);assert(!r.settled);r.settled=true;await settle(()=>r.resolve(value));};
 const reject=async(r:any,error:any)=>{assert(r);assert(!r.settled);r.settled=true;await settle(()=>r.reject(error));};
 const directory=()=>requests.filter(r=>r.method==='GET'&&r.path.startsWith('/friends/directory?')&&!r.settled);
 const rows=async(state='pending')=>{await settle();for(const r of pending('/assessment-definition'))await resolve(r,definition());const r=directory().at(-1);assert(r,'directory request');await resolve(r,{items:[privateCard(state)],total:1,next_offset:null});};
 const posts=()=>requests.filter(r=>r.method==='POST');
 render();return{client,container,button,click,clickRaw,requests,pending,directory,rows,resolve,reject,posts,render,unmount,navigations,shell,transport,
  back(){shell.selectTab('friends');},get route(){return route;},get messagesOpen(){return messagesOpen;}};
}
const lost=()=>new ApiError({message:'合成回覆遺失',network:true});
const ack=()=>({state:'accepted',aggregate_version:8});

// Existing shell contract: false keeps the current page; null is a close/logout
// intent. These calls do not simulate native beforeunload, browser Back or dialog UI.
const canLeaveRaw=(h:ReturnType<typeof fixture>,hash:string|null='#home')=>h.shell.pageLeaveGuard.current?.(hash)??true;
const canLeave=(h:ReturnType<typeof fixture>,hash:string|null='#home')=>{let result=true;React.act(()=>{result=canLeaveRaw(h,hash);});return result;};
const known=()=>new ApiError({status:422,message:'合成已知拒絕',definitiveResponse:true});
for(const destination of ['members','home'])test(`pending original prevents ${destination} replacement and reentry`,async t=>{
 const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));const first=h.posts()[0];
 h.shell.selectTab(destination);assert.equal(h.route,'friends');assert.equal(first.settled,false);assert.equal(canLeave(h,null),false);
 assert(h.button('正在接受…')?.hasAttribute('disabled'));assert.equal(h.posts().length,1);
 await h.reject(first,lost());assert(h.button('確認原操作結果'));assert.equal(canLeave(h),false);
});
test('actual identity entry registers and removes the shell guard',async t=>{const h=fixture(t);await h.rows();assert.equal(typeof h.shell.pageLeaveGuard.current,'function');assert.equal(canLeave(h),true);h.unmount();assert.equal(h.shell.pageLeaveGuard.current,null);});
test('same tick accept, repeated accept and navigation see synchronous POST ownership without an intervening commit',async t=>{
 const h=fixture(t);await h.rows();const accept=h.button('接受邀請'),navigate=h.button('找新夥伴');
 flush(()=>{h.clickRaw(accept);h.clickRaw(accept);assert.equal(h.posts().length,1);assert.equal(canLeaveRaw(h),false);h.clickRaw(navigate);assert.equal(h.route,'friends');});
 assert.equal(h.posts()[0].settled,false);await h.reject(h.posts()[0],lost());
});
test('unknown remains recoverable through refused navigation and canonical retry keeps exact tuple',async t=>{
 const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));await h.reject(h.posts()[0],lost());
 h.click(h.button('找新夥伴'));assert.equal(h.route,'friends');assert.equal(canLeave(h,null),false);
 h.click(h.button('確認原操作結果'));assert.equal(canLeave(h),false);assert.deepEqual(h.posts()[1].options,h.posts()[0].options);assert.deepEqual(h.posts()[1].body,h.posts()[0].body);assert.equal(h.posts()[1].path,h.posts()[0].path);
 await h.resolve(h.posts()[1],ack());assert.equal(canLeave(h),true);assert(h.directory().length>0);h.shell.selectTab('home');assert.equal(h.route,'home');
});
test('canonical ACK permits same-continuation leave before React commits and before readback finishes',async t=>{
 const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));let observed=false;
 // announceInboxChange is the actual production continuation after the canonical
 // decoder. Inspect the guard synchronously, without an act/flush after settlement.
 const listener=()=>{observed=true;assert.equal(canLeaveRaw(h),true);};window.addEventListener('freedom-inbox-updated',listener);
 try{await h.resolve(h.posts()[0],ack());assert(observed);const readback=h.directory().at(-1);assert(readback&&!readback.settled);h.shell.selectTab('members');assert.equal(h.route,'members');assert.equal(readback.settled,false);}finally{window.removeEventListener('freedom-inbox-updated',listener);}
});
test('unknown retry canonical ACK clears the prior ambiguity before a slow GET',async t=>{const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));await h.reject(h.posts()[0],lost());h.click(h.button('確認原操作結果'));await h.resolve(h.posts()[1],ack());assert.equal(canLeave(h),true);assert(h.directory().length);h.click(h.button('找新夥伴'));assert.equal(h.route,'members');});
test('a known definitive rejection releases leave after its committed snapshot without retry',async t=>{const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));await h.reject(h.posts()[0],known());assert(!h.button('確認原操作結果'));assert.equal(canLeave(h,null),true);h.click(h.button('找新夥伴'));assert.equal(h.route,'members');});
for(const failure of ['network','malformed','unauthorized','server','ordinary'] as const)test(`${failure} never treats undefined or an unconfirmed response as a settled command`,async t=>{
 const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));
 if(failure==='malformed')await h.resolve(h.posts()[0],{state:'accepted'});
 else await h.reject(h.posts()[0],failure==='network'?lost():failure==='ordinary'?Error('unexpected'):new ApiError({status:failure==='server'?503:401,message:failure,definitiveResponse:true}));
 assert.equal(canLeave(h),false);assert(h.button('確認原操作結果'));h.shell.selectTab('members');assert.equal(h.route,'friends');
});
test('known rejection after an unknown retry does not erase the unresolved original key',async t=>{const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));await h.reject(h.posts()[0],lost());h.click(h.button('確認原操作結果'));await h.reject(h.posts()[1],known());assert.equal(canLeave(h),false);h.click(h.button('確認原操作結果'));assert.equal(h.posts().length,3);for(const r of h.posts().slice(1)){assert.deepEqual(r.options,h.posts()[0].options);assert.deepEqual(r.body,h.posts()[0].body);}await h.resolve(h.posts()[2],ack());assert.equal(canLeave(h),true);});
test('scope change, search submit and readback cannot settle an unknown original',async t=>{
 const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));await h.reject(h.posts()[0],lost());
 h.click(h.button('送出的邀請'));await h.rows();assert.equal(canLeave(h),false);
 const form=descendants(h.container).find(n=>n.nodeName==='FORM');assert(form);flush(()=>form.dispatchEvent({type:'submit',bubbles:true}));await h.rows();assert.equal(canLeave(h),false);
 h.click(h.button('重讀好友名單'));await h.rows();assert.equal(canLeave(h),false);assert(h.button('確認原操作結果'));
 h.click(h.button('確認原操作結果'));assert.deepEqual(h.posts()[1].options,h.posts()[0].options);await h.resolve(h.posts()[1],ack());assert.equal(canLeave(h),true);
});
for(const phase of ['idle','reading','read-error'])test(`${phase} never prevents normal leave`,async t=>{const h=fixture(t);if(phase==='idle')await h.rows();else if(phase==='read-error'){await settle();await h.reject(h.directory()[0],Error('read failed'));}assert.equal(canLeave(h),true);h.shell.selectTab('home');assert.equal(h.route,'home');assert.equal(h.shell.pageLeaveGuard.current,null);});
for(const phase of ['pending','unknown'])test(`messages overlay opens and closes without abandoning ${phase} friends operation`,async t=>{
 const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));if(phase==='unknown')await h.reject(h.posts()[0],lost());const guard=h.shell.pageLeaveGuard.current;
 h.shell.selectTab('messages');assert.equal(h.messagesOpen,true);assert.equal(h.route,'friends');assert.equal(h.shell.pageLeaveGuard.current,guard);
 h.shell.closeMessagesThen();assert.equal(h.messagesOpen,false);assert.equal(h.route,'friends');assert.equal(canLeave(h),false);assert.equal(h.posts().length,1);
 h.shell.selectTab('friends');assert.equal(h.route,'friends');assert.equal(canLeave(h),false);
 if(phase==='pending')await h.reject(h.posts()[0],lost());h.click(h.button('確認原操作結果'));assert.deepEqual(h.posts()[1].options,h.posts()[0].options);await h.resolve(h.posts()[1],ack());
});
for(const change of ['same-account-session','different-account','client'] as const)for(const phase of ['pending','unknown'] as const)test(`${change} replacement clears ${phase} old guard and ignores late old results`,async t=>{
 const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));const old=h.posts()[0];if(phase==='unknown')await h.reject(old,lost());
 if(change==='same-account-session'){h.client.sessionGeneration++;h.render();}
 else if(change==='different-account')h.render({session:{user:{user_id:'30000000-0000-4000-8000-000000000003'}}});
 else h.render({client:{sessionGeneration:1,get:h.transport('GET'),post:h.transport('POST')}});
 await h.rows();assert.equal(canLeave(h),true);assert(!h.button('確認原操作結果'));
 if(phase==='pending')await h.resolve(old,ack());assert.equal(canLeave(h),true);assert(!h.container.textContent.includes('已和合成活動夥伴成為好友'));
 h.click(h.button('接受邀請'));assert.equal(canLeave(h),false);assert.notEqual(h.posts()[1].options.idempotencyKey,old.options.idempotencyKey);await h.reject(h.posts()[1],lost());assert.equal(canLeave(h),false);
});
test('invalidated generation allows leaving immediately even before the replacement render',async t=>{const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));h.client.sessionGeneration++;assert.equal(canLeave(h),true);await h.resolve(h.posts()[0],ack());assert.equal(canLeave(h),true);});
test('unmount removes unknown guard and late results cannot register it again',async t=>{const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));h.unmount();assert.equal(h.shell.pageLeaveGuard.current,null);await h.reject(h.posts()[0],lost());assert.equal(h.shell.pageLeaveGuard.current,null);});

for(const outcome of ['known','unknown'] as const)test(`${outcome} rejection is pending in the rejection tick and resolved only from the committed mutation snapshot`,async t=>{
 const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));const request=h.posts()[0];
 await React.act(async()=>{request.settled=true;request.reject(outcome==='known'?known():lost());assert.equal(canLeaveRaw(h),false,'promise rejection is not an ACK before mutation continuation');});
 // No additional act/flush between the settlement commit and this guard read.
 React.act(()=>{assert.equal(canLeaveRaw(h),outcome==='known');});
 if(outcome==='known'){assert(!h.button('確認原操作結果'));assert(!h.container.textContent.includes('好友操作尚未確認'));}
 else assert(h.button('確認原操作結果'));
});
for(const action of ['remove','decline','cancel'] as const)test(`${action} uses its enabled production controls and preserves the original command`,async t=>{
 const h=fixture(t);await h.rows();
 if(action==='remove'){h.click(h.button('我的好友'));await h.rows('accepted');const summary=descendants(h.container).find(n=>n.nodeName==='SUMMARY'&&n.textContent==='好友設定');assert(summary);h.click(summary);h.click(h.button('移除好友'));}
 else if(action==='decline')h.click(h.button('婉拒'));
 else{h.click(h.button('送出的邀請'));await h.rows();}
 if(action!=='cancel'){
  assert.equal(canLeave(h),true,'unsubmitted confirmation is not a pending command');h.click(h.button('取消'));assert.equal(h.posts().length,0);assert.equal(canLeave(h),true);
  h.click(h.button(action==='remove'?'移除好友':'婉拒'));
 }
 h.click(h.button(action==='remove'?'確定移除':action==='decline'?'確定婉拒':'取消邀請'));assert.equal(h.posts().length,1);assert.equal(h.posts()[0].path,`/friends/${PEER}/remove`);assert.equal(canLeave(h),false);
 await h.reject(h.posts()[0],lost());h.click(h.button('找新夥伴'));assert.equal(h.route,'friends');h.click(h.button('確認原操作結果'));assert.deepEqual(h.posts()[1].options,h.posts()[0].options);assert.deepEqual(h.posts()[1].body,h.posts()[0].body);assert.equal(h.posts()[1].path,h.posts()[0].path);
 await h.resolve(h.posts()[1],{state:'removed',aggregate_version:8});assert.equal(canLeave(h),true);
});
test('canonical ACK followed by a failed readback still permits normal leave',async t=>{const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));await h.resolve(h.posts()[0],ack());await h.reject(h.directory().at(-1),Error('canonical read failed'));assert(h.container.textContent.includes('canonical read failed'));assert.equal(canLeave(h),true);h.click(h.button('找新夥伴'));assert.equal(h.route,'members');});
for(const status of [403,412])test(`unknown retry followed by ${status} keeps the original tuple locked until canonical ACK`,async t=>{const h=fixture(t);await h.rows();h.click(h.button('接受邀請'));await h.reject(h.posts()[0],lost());h.click(h.button('確認原操作結果'));await h.reject(h.posts()[1],new ApiError({status,message:`refused ${status}`,definitiveResponse:true}));assert.equal(canLeave(h),false);h.shell.selectTab('home');assert.equal(h.route,'friends');h.click(h.button('確認原操作結果'));for(const request of h.posts().slice(1)){assert.deepEqual(request.options,h.posts()[0].options);assert.deepEqual(request.body,h.posts()[0].body);assert.equal(request.path,h.posts()[0].path);}await h.resolve(h.posts()[2],ack());assert.equal(canLeave(h),true);});
