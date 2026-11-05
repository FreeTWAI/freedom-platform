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
// Complete production EventsPanel, EventParticipation, and NotificationBell. Source AST
// shell callbacks run against a synthetic history/state host, not a full App.
const noNetwork=()=>{throw Error('Real network forbidden');};
const navigator={language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork},share:noNetwork};
document.visibilityState='visible';
const base=process.cwd();
const bundled=buildSync({stdin:{contents:`export {EventsPanel} from './apps/portal-web/src/modules/EventsPanel'; export {NotificationBell} from './apps/portal-web/src/modules/NotificationBell'; export {ApiError} from './apps/portal-web/src/api';`,resolveDir:base,sourcefile:'participation-navigation-entry.ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},supported:{'dynamic-import':false},metafile:true});
const production={exports:{} as any};
runInNewContext(bundled.outputFiles[0].text,{module:production,exports:production.exports,crypto:webcrypto,Intl,URL,URLSearchParams,AbortController,Error,Event,CustomEvent:class {constructor(public type:string){}},Blob,console,window,document,navigator,fetch:noNetwork,localStorage:{getItem(){return null;},setItem(){}},sessionStorage:{getItem(){return null;},setItem(){}},setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='zod')return require('zod');throw Error('Unexpected external import: '+name);}});
const {EventsPanel,NotificationBell,ApiError}=production.exports;
const appSource=readFileSync(path.join(base,'apps/portal-web/src/App.tsx'),'utf8');
const ast=ts.createSourceFile('App.tsx',appSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const workspace=ast.statements.find((n:any)=>ts.isFunctionDeclaration(n)&&n.name?.text==='Workspace') as any;assert(workspace?.body);
function actual(name:string){const n=workspace.body.statements.find((n:any)=>ts.isVariableStatement(n)?n.declarationList.declarations.some((d:any)=>d.name.getText(ast)===name):ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(n,name);return n.getText(ast);}
const shellSource=['registerPageLeave','openMessages','closeMessagesThen','selectTab','navigateNotification'].map(actual).join('\n')+'\nglobalThis.route={registerPageLeave,navigateNotification,selectTab};';
const communitySource=readFileSync(path.join(base,'apps/portal-web/src/features/community.tsx'),'utf8');
const communityAst=ts.createSourceFile('community.tsx',communitySource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declaration=communityAst.statements.flatMap((n:any)=>ts.isVariableStatement(n)?Array.from(n.declarationList.declarations):[]).find((n:any)=>n.name.getText(communityAst)==='communityFeatures') as any;
const eventEntry=declaration.initializer.expression.properties.find((p:any)=>p.name.getText(communityAst).replaceAll('"','')==='events').initializer.getText(communityAst);
// Full actual entry; optional mission/card rendering ports return null fixtures.
// This does not validate those optional panels. Helpers and mutation hooks are real.
const entry=runInNewContext(transformSync('('+eventEntry+')',{loader:'tsx',format:'cjs',jsx:'transform'}).code,{React,EventsPanel,EventMissions:()=>null,EventMemberCards:()=>null});
const OWNER='30000000-0000-4000-8000-000000000001';
const IDS=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
const labels=['活動甲','活動乙','活動丙'];
const event=(i:number)=>({event_id:IDS[i],title:labels[i],description:'合成活動說明 '+i,starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'online',location:'合成線上活動 '+i,event_kind:'meetup',topic:null,online_url:null,visibility:'open',registration_policy:'community_member',banner_url:null,banner_orientation:null,video_url:null,video_mime:null,capacity:20,state:'published',aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,organizer_ref:'40000000-0000-4000-8000-000000000001',organizer_name:'合成主辦'});
const notices=()=>({items:IDS.map((id,i)=>({notification_id:'n'+i,title:'前往'+labels[i],body:'合成活動通知',created_at:new Date().toISOString(),read_at:new Date().toISOString(),action:{tab:'events',resource_id:id}})),unread_count:0});
function fixture(t:TestContext,kind='hash',participationEnabled=false){
 const requests:any[]=[],commits:{hash:string;text:string}[]=[],container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);let mounted=true,shell:any;
 Object.assign(window.location,{origin:'https://fixture.invalid',pathname:kind==='path'?'/events/'+IDS[0]:'/',search:'',hash:kind==='path'?'':'#events/'+IDS[0]});
 Object.defineProperty(window.location,'href',{configurable:true,get(){return window.location.origin+window.location.pathname+window.location.search+window.location.hash;}});
 const transport=(method:string)=>(url:string,body?:any,options?:any)=>new Promise((resolve,reject)=>requests.push({method,path:url,body,options,resolve,reject}));
 const client={sessionGeneration:1,csrfToken:'synthetic-csrf',get:transport('GET'),post:transport('POST'),patch:transport('PATCH')};
 let props:any={client,session:{user:{user_id:OWNER}},site:{event_participation_enabled:participationEnabled},locationHash:window.location.hash};
 function Host(){
  const [hash,setHash]=React.useState(props.locationHash);props.locationHash=hash;
  shell={useCallback:React.useCallback,acceptedHash:React.useRef(hash),pageLeaveGuard:React.useRef(null),messageHistoryTransition:React.useRef(null),isMessagesHistoryEntry:()=>false,messagesHistoryState:()=>null,messageLocation:React.useRef(null),messageLeaveGuard:React.useRef(null),notificationSequence:React.useRef(0),canEndConsoleSession:()=>true,orderNotificationDestination:()=>null,
   setMessagesMounted(){},setTab(){},setLocationHash:setHash,setFriendScope(){},setMessagesOpen(){},setMobileOpen(){},mainContent:{current:{focus(){}}},setNotificationTarget(){},window,HashChangeEvent:class{constructor(public type:string){}}};
  runInNewContext(transformSync(shellSource,{loader:'tsx',format:'cjs'}).code,shell);
  React.useLayoutEffect(()=>{commits.push({hash,text:container.textContent});});
  return React.createElement(React.Fragment,null,React.createElement(NotificationBell,{client:props.client,preferencesEnabled:false,onNavigate:shell.route.navigateNotification}),entry.render({...props,registerPageLeave:shell.route.registerPageLeave,selectTab:shell.route.selectTab}));
 }
 (window as any).history={state:null,replaceState(state:any,_unused:any,url:string){this.state=state;const target=new URL(url,window.location.href);Object.assign(window.location,{pathname:target.pathname,search:target.search,hash:target.hash});},pushState:noNetwork,back:noNetwork};
 const render=()=>flush(()=>root.render(React.createElement(Host)));
 render();t.after(()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}});
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};
 const nodes=()=>descendants(container);
 const propsOf=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
 const button=(text:string)=>nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent===text);
 const click=(node:HostNode)=>{assert(node,'mounted button');assert(container.contains(node));assert(!propsOf(node).disabled);for(let n:HostNode|null=node;n;n=n.parentNode){assert(!n.hidden);assert(!(n.nodeName==='DIALOG'&&!n.open));}flush(()=>node.dispatchEvent({type:'click',button:0}));};
 const settle=async(r:any,value:any,reject=false)=>{assert(r,'request');await React.act(async()=>{r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
 const reads=(path?:string)=>requests.filter(r=>r.method==='GET'&&(!path||r.path===path));
 const writes=()=>requests.filter(r=>r.method!=='GET');
 const bell=()=>nodes().find(n=>(n.attributes.class??'').split(' ').includes('notification-bell-trigger'))!;
 const openBell=async()=>{click(bell());await settle(reads('/me/notifications?limit=6&offset=0').at(-1),notices());};
 const navigate=async(i:number)=>{await openBell();const n=nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent.startsWith('前往'+labels[i]));assert(n);click(n);};
 const start=async(list:any[]|null=null,firstEvent=event(0),holdA=false)=>{await settle(reads('/guilds/directory')[0],{items:[]});await settle(reads('/events/bulletins')[0],{items:[]});await settle(reads('/events')[0],list?{items:list}:new Error('synthetic list unavailable'),!list);if(!holdA)await settle(reads('/events/'+IDS[0]).at(-1),firstEvent);await settle(reads('/me/notifications?limit=6&offset=0')[0],notices());};
 return{container,commits,client,props,render,unmount,reads,writes,settle,button,click,navigate,start,openBell,nodes,propsOf,shell:()=>shell,href:()=>window.location.href,text:()=>container.textContent};
}
const participation=(i=0,patch:Record<string,unknown>={})=>({event_id:IDS[i],event_version:1,event_state:'published',starts_at:event(i).starts_at,waitlist_enabled:true,response_window_minutes:30,rsvp_state:null,available_seats:1,waitlist:{status:'invited',aggregate_version:1,joined_at:new Date().toISOString(),invited_at:new Date().toISOString(),expires_at:event(i).starts_at,delivery_status:'recorded'},...patch});
const reminder={version:1,enabled:false,minutes_before_start:null,channel:null,status:null};
const accepted=(i=0)=>participation(i,{rsvp_state:'going',waitlist:{...participation(i).waitlist,status:'accepted',aggregate_version:2}});
const unknown=()=>new ApiError({message:'synthetic lost reply',network:true});
const denied=(status:number)=>new ApiError({message:'synthetic definite rejection',status,definitiveResponse:true});
const tuple=(r:any)=>JSON.stringify({method:r.method,path:r.path,body:r.body,key:r.options.idempotencyKey,version:r.options.ifMatch});
async function ready(t:TestContext,kind='hash'){
 const h=fixture(t,kind,true);await h.start([event(0),event(1),event(2)]);
 await h.settle(h.reads('/events/'+IDS[0]+'/participation').at(-1),participation());
 await h.settle(h.reads('/events/'+IDS[0]+'/reminder').at(-1),reminder);
 assert(h.button('接受邀請並報名'));return h;
}
function beforeUnload(){const e:any={type:'beforeunload',prevented:false,preventDefault(){this.prevented=true;}};window.dispatchEvent(e);return e.prevented;}
for(const kind of ['hash','path'])test(`member accept pending and unknown retain exact retry across notification and return (${kind})`,async t=>{
 const h=await ready(t,kind),originalHref=h.href();h.click(h.button('接受邀請並報名')!);const original=h.writes().at(-1);
 assert.equal(original.path,'/events/'+IDS[0]+'/waitlist');assert.equal(original.body.action,'accept');assert.equal(beforeUnload(),true);
 await h.navigate(1);assert.equal(h.href(),originalHref);assert.equal(h.reads('/events/'+IDS[1]+'/participation').length,0);
 h.click(h.button('返回活動列表與行事曆')!);assert.equal(h.href(),originalHref);
 await h.settle(original,unknown(),true);assert(h.button('重試原操作（保留原內容）'));assert.equal(beforeUnload(),true);
 await h.navigate(1);assert.equal(h.href(),originalHref);assert.equal(h.writes().length,1);
 h.click(h.button('重試原操作（保留原內容）')!);const retry=h.writes().at(-1);assert.equal(tuple(retry),tuple(original));
 await h.settle(retry,accepted());assert.equal(beforeUnload(),false);assert(h.reads('/events/'+IDS[0]+'/participation').length>1);
 // The canonical write is settled even though both post-ACK reads are held.
 await h.navigate(1);assert.equal(window.location.hash,'#events/'+IDS[1]);assert.equal(h.button('重試原操作（保留原內容）'),undefined);
});
for(const destination of ['notification','return'])test(`accept and ${destination} in the same React turn cannot discard the pending command`,async t=>{
 const h=await ready(t);if(destination==='notification')await h.openBell();
 const accept=h.button('接受邀請並報名')!,target=destination==='return'?h.button('返回活動列表與行事曆')!:h.nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent.startsWith('前往'+labels[1]))!;
 assert(target);flush(()=>{accept.dispatchEvent({type:'click',button:0});target.dispatchEvent({type:'click',button:0});});
 assert.equal(h.writes().length,1);assert.equal(window.location.hash,'#events/'+IDS[0]);assert.equal(beforeUnload(),true);
 await h.settle(h.writes()[0],unknown(),true);assert(h.button('重試原操作（保留原內容）'));
});
for(const status of [400,403,404,409,412,422,429])test(`first definite ${status} releases navigation, including stale 412`,async t=>{
 const h=await ready(t);h.click(h.button('接受邀請並報名')!);await h.settle(h.writes()[0],denied(status),true);
 assert.equal(h.button('重試原操作（保留原內容）'),undefined);assert.equal(beforeUnload(),false);
 if(status===412){assert(h.button('載入最新狀態並保留輸入'));assert.equal(h.propsOf(h.button('接受邀請並報名')!).disabled,true);}
 h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events');assert.equal(h.writes().length,1);
});
for(const failedReads of [false,true])test(`ACK releases navigation while post-ACK reads ${failedReads?'fail':'remain pending'}`,async t=>{
 const h=await ready(t);h.click(h.button('接受邀請並報名')!);await h.settle(h.writes()[0],accepted());
 if(failedReads){await h.settle(h.reads('/events/'+IDS[0]+'/participation').at(-1),denied(503),true);await h.settle(h.reads('/events/'+IDS[0]+'/reminder').at(-1),denied(503),true);}
 assert.equal(beforeUnload(),false);h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events');assert.equal(h.writes().length,1);
});
test('stale reload followed by a fresh command has a new key and holds navigation again',async t=>{
 const h=await ready(t);h.click(h.button('接受邀請並報名')!);const first=h.writes()[0];await h.settle(first,denied(412),true);
 h.click(h.button('載入最新狀態並保留輸入')!);await h.settle(h.reads('/events/'+IDS[0]+'/participation').at(-1),participation(0,{event_version:7}));await h.settle(h.reads('/events/'+IDS[0]+'/reminder').at(-1),reminder);
 h.click(h.button('婉拒邀請')!);const fresh=h.writes().at(-1);assert.equal(fresh.body.action,'decline');assert.equal(fresh.options.ifMatch,7);assert.notEqual(fresh.options.idempotencyKey,first.options.idempotencyKey);
 h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events/'+IDS[0]);await h.settle(fresh,participation(0,{event_version:7,waitlist:{...participation().waitlist,status:'declined'}}));
 h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events');
});
test('ordinary state reload cannot release an unknown command or alter its original tuple',async t=>{
 const h=await ready(t);h.click(h.button('接受邀請並報名')!);const first=h.writes()[0];await h.settle(first,unknown(),true);
 h.click(h.button('更新本人狀態')!);await h.settle(h.reads('/events/'+IDS[0]+'/participation').at(-1),participation(0,{event_version:9}));await h.settle(h.reads('/events/'+IDS[0]+'/reminder').at(-1),reminder);
 h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events/'+IDS[0]);h.click(h.button('重試原操作（保留原內容）')!);assert.equal(tuple(h.writes().at(-1)),tuple(first));
});
test('session generation change releases only the obsolete owner even before rerender',async t=>{
 const h=await ready(t);h.click(h.button('接受邀請並報名')!);assert.equal(beforeUnload(),true);h.client.sessionGeneration++;assert.equal(beforeUnload(),false);
 flush(()=>h.shell().route.selectTab('events'));assert.equal(window.location.hash,'#events');
});
for(const change of ['client','session','account'])test(`late old completion cannot clear the new pending ${change} owner`,async t=>{
 const h=await ready(t);h.click(h.button('接受邀請並報名')!);const old=h.writes()[0];
 if(change==='client')h.props.client={...h.client};if(change==='session')h.client.sessionGeneration++;if(change==='account')h.props.session={user:{user_id:'50000000-0000-4000-8000-000000000005'}};h.render();
 // The real community entry remounts the whole parent for an account/session change.
 await h.settle(h.reads('/events').at(-1),{items:[event(0),event(1),event(2)]});await h.settle(h.reads('/guilds/directory').at(-1),{items:[]});await h.settle(h.reads('/events/bulletins').at(-1),{items:[]});
 // A new member/client lifetime must finish its own read before becoming actionable.
 const ownRead=h.reads('/events/'+IDS[0]+'/participation').at(-1);await h.settle(ownRead,participation());await h.settle(h.reads('/events/'+IDS[0]+'/reminder').at(-1),reminder);
 h.click(h.button('接受邀請並報名')!);const fresh=h.writes().at(-1);assert.notEqual(fresh.options.idempotencyKey,old.options.idempotencyKey);
 await h.settle(old,accepted());assert.equal(beforeUnload(),true);h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events/'+IDS[0]);
 await h.settle(fresh,unknown(),true);h.click(h.button('重試原操作（保留原內容）')!);assert.equal(tuple(h.writes().at(-1)),tuple(fresh));
});
test('unmount removes its pending registration and ignores a late completion',async t=>{
 const h=await ready(t);h.click(h.button('接受邀請並報名')!);const old=h.writes()[0];assert.equal(beforeUnload(),true);h.unmount();assert.equal(beforeUnload(),false);
 await h.settle(old,accepted());assert.equal(h.container.textContent,'');assert.equal(h.writes().length,1);
});
test('a newer command stays protected when older post-ACK reads finish',async t=>{
 const h=await ready(t);h.click(h.button('接受邀請並報名')!);await h.settle(h.writes()[0],accepted());const oldReads=[h.reads('/events/'+IDS[0]+'/participation').at(-1),h.reads('/events/'+IDS[0]+'/reminder').at(-1)];
 h.click(h.button('婉拒邀請')!);const fresh=h.writes().at(-1);assert.notEqual(fresh.options.idempotencyKey,h.writes()[0].options.idempotencyKey);
 await h.settle(oldReads[0],accepted());await h.settle(oldReads[1],reminder);assert.equal(beforeUnload(),true);h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events/'+IDS[0]);await h.settle(fresh,unknown(),true);assert(h.button('重試原操作（保留原內容）'));
});
// Execute the actual parent registration, not a replacement implementation, to
// exercise cleanup ordering that React's normal commit order need not encounter.
test('parent guard cleanup removes only its own registration, and scope revocation is immediate',()=>{
 const source=readFileSync(path.join(base,'apps/portal-web/src/modules/EventsPanel.tsx'),'utf8'),tree=ts.createSourceFile('EventsPanel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let declaration:any;const visit=(node:any)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(tree)==='registerParticipationPending')declaration=node;ts.forEachChild(node,visit);};visit(tree);assert(declaration);
 const client={sessionGeneration:1},owner={generation:1},participationOwner={current:owner},participationPending={current:new Set<()=>boolean>()};
 const register=runInNewContext(transformSync('('+declaration.initializer.getText(tree)+')',{loader:'tsx'}).code,{useCallback:(fn:unknown)=>fn,client,owner,participationOwner,participationPending});
 const old=register(()=>true),fresh=register(()=>true);assert.equal(participationPending.current.size,2);old();assert.equal(participationPending.current.size,1);assert.equal([...participationPending.current][0](),true);old();assert.equal(participationPending.current.size,1);
 client.sessionGeneration++;assert.equal([...participationPending.current][0](),false);client.sessionGeneration--;participationOwner.current={generation:1};assert.equal([...participationPending.current][0](),false);fresh();assert.equal(participationPending.current.size,0);
});
function submitReminder(h:Awaited<ReturnType<typeof ready>>){
 const button=h.button('儲存提醒選擇')!;assert(button);assert.equal(Boolean(h.propsOf(button).disabled),false);
 const form=h.nodes().find(n=>n.nodeName==='FORM'&&n.contains(button));assert(form);
 flush(()=>form.dispatchEvent({type:'submit'}));
}
test('actual member ReminderForm pending and unknown PATCH keep the original tuple, then ACK releases before GET',async t=>{
 const h=await ready(t);submitReminder(h);const original=h.writes()[0];assert.equal(original.method,'PATCH');assert.equal(original.path,'/events/'+IDS[0]+'/reminder');assert.equal(JSON.stringify(original.body),JSON.stringify({enabled:false}));assert.equal(original.options.ifMatch,1);
 assert.equal(beforeUnload(),true);h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events/'+IDS[0]);
 await h.settle(original,unknown(),true);await h.navigate(1);assert.equal(window.location.hash,'#events/'+IDS[0]);assert.equal(h.writes().length,1);assert.equal(beforeUnload(),true);
 h.click(h.button('重試原操作（保留原內容）')!);const retry=h.writes().at(-1);assert.equal(tuple(retry),tuple(original));await h.settle(retry,reminder);
 assert(h.reads('/events/'+IDS[0]+'/reminder').length>1);assert.equal(beforeUnload(),false);h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events');
});
for(const status of [400,412])test(`actual member ReminderForm first definite ${status} permits leaving`,async t=>{
 const h=await ready(t);submitReminder(h);await h.settle(h.writes()[0],denied(status),true);assert.equal(h.button('重試原操作（保留原內容）'),undefined);assert.equal(beforeUnload(),false);
 if(status===412){assert(h.button('載入最新狀態並保留輸入'));assert.equal(h.propsOf(h.button('儲存提醒選擇')!).disabled,true);}
 h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events');assert.equal(h.writes().length,1);
});
