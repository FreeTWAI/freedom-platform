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
// Regression evidence: complete production EventsPanel and NotificationBell. Source AST
// shell callbacks run against a synthetic history/state host, not a full App.
const noNetwork=()=>{throw Error('Real network forbidden');};
const navigator={language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork},share:noNetwork};
document.visibilityState='visible';
const base=process.cwd();
const bundled=buildSync({stdin:{contents:`export {EventsPanel} from './apps/portal-web/src/modules/EventsPanel'; export {NotificationBell} from './apps/portal-web/src/modules/NotificationBell'; export {ApiError} from './apps/portal-web/src/api';`,resolveDir:base,sourcefile:'diagnostic-entry.ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},supported:{'dynamic-import':false},metafile:true});
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
 const client={sessionGeneration:1,get:transport('GET'),post:transport('POST')};
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
 const writes=()=>requests.filter(r=>r.method==='POST');
 const bell=()=>nodes().find(n=>(n.attributes.class??'').split(' ').includes('notification-bell-trigger'))!;
 const openBell=async()=>{click(bell());await settle(reads('/me/notifications?limit=6&offset=0').at(-1),notices());};
 const navigate=async(i:number)=>{await openBell();const n=nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent.startsWith('前往'+labels[i]));assert(n);click(n);};
 const start=async(list:any[]|null=null,firstEvent=event(0),holdA=false)=>{await settle(reads('/guilds/directory')[0],{items:[]});await settle(reads('/events/bulletins')[0],{items:[]});await settle(reads('/events')[0],list?{items:list}:new Error('synthetic list unavailable'),!list);if(!holdA)await settle(reads('/events/'+IDS[0]).at(-1),firstEvent);await settle(reads('/me/notifications?limit=6&offset=0')[0],notices());};
 return{container,commits,client,props,render,unmount,reads,writes,settle,button,click,navigate,start,shell:()=>shell,href:()=>window.location.href,text:()=>container.textContent};
}
for(const kind of ['hash','path'])test(`mounted notification navigates A to B (${kind}) without stale A controls while B read waits`,async t=>{
 const h=fixture(t,kind);await h.start();assert.match(h.text(),/活動甲/);await h.navigate(1);assert.equal(window.location.hash,'#events/'+IDS[1]);assert(h.reads('/events/'+IDS[1]).length);for(const commit of h.commits.filter(c=>c.hash==='#events/'+IDS[1]))assert.doesNotMatch(commit.text,/合成活動說明 0/,'no stale A in a committed B tree before passive effects');assert.doesNotMatch(h.text(),/合成活動說明 [01]/);assert.match(h.text(),/正在載入活動/);assert.equal(h.button('我要參加'),undefined);assert.equal(h.writes().length,0);await h.settle(h.reads('/events/'+IDS[1]).at(-1),event(1));assert.match(h.text(),/合成活動說明 1/);h.click(h.button('我要參加')!);assert.equal(h.writes().at(-1).path,'/events/'+IDS[1]+'/rsvp');
});
test('control: B already in successful list renders and submits B immediately',async t=>{
 const h=fixture(t);await h.start([event(1)]);await h.navigate(1);assert.match(h.text(),/合成活動說明 1/);assert.doesNotMatch(h.text(),/合成活動說明 0/);assert.equal(h.reads('/events/'+IDS[1]).length,0);h.click(h.button('我要參加')!);assert.equal(h.writes().at(-1).path,'/events/'+IDS[1]+'/rsvp');
});
test('control: B GET success replaces A and subsequent RSVP targets B',async t=>{
 const h=fixture(t);await h.start();await h.navigate(1);await h.settle(h.reads('/events/'+IDS[1]).at(-1),event(1));assert.match(h.text(),/合成活動說明 1/);assert.doesNotMatch(h.text(),/合成活動說明 0/);h.click(h.button('我要參加')!);assert.equal(h.writes().at(-1).path,'/events/'+IDS[1]+'/rsvp');
});
for(const status of [403,404,503])test(`B GET ${status} shows no stale A and existing list retry self-recovers`,async t=>{
 const h=fixture(t);await h.start();await h.navigate(1);await h.settle(h.reads('/events/'+IDS[1]).at(-1),new ApiError({status,message:'合成讀取失敗',definitiveResponse:true}),true);assert.doesNotMatch(h.text(),/合成活動說明 0/);assert.equal(h.button('我要參加'),undefined);assert.match(h.text(),/找不到這場活動，或目前無法查看/);
 h.click(h.button('返回活動列表與行事曆')!);assert.equal(window.location.hash,'#events');assert(h.button('重試'));h.click(h.button('重試')!);
 await h.settle(h.reads('/guilds/directory').at(-1),{items:[]});await h.settle(h.reads('/events/bulletins').at(-1),{items:[]});await h.settle(h.reads('/events').at(-1),{items:[event(0),event(1)]});await h.navigate(1);assert.match(h.text(),/合成活動說明 1/);assert.equal(h.writes().length,0);
});
test('control: A to B to C, late B cannot overwrite C',async t=>{
 const h=fixture(t);await h.start();await h.navigate(1);const b=h.reads('/events/'+IDS[1]).at(-1);await h.navigate(2);const c=h.reads('/events/'+IDS[2]).at(-1);assert.equal(window.location.hash,'#events/'+IDS[2]);assert.doesNotMatch(h.text(),/合成活動說明 [01]/);assert.equal(h.button('我要參加'),undefined);await h.settle(c,event(2));await h.settle(b,event(1));assert.match(h.text(),/合成活動說明 2/);assert.doesNotMatch(h.text(),/合成活動說明 [01]/);h.click(h.button('我要參加')!);assert.equal(h.writes().at(-1).path,'/events/'+IDS[2]+'/rsvp');
});
for(const participationEnabled of [false,true])test(`control: pending and unknown original A registration blocks notification route and retains exact retry (participation ${participationEnabled})`,async t=>{
 const h=fixture(t,'hash',participationEnabled);await h.start();h.click(h.button('我要參加')!);const original=h.writes()[0];await h.navigate(1);assert.equal(window.location.hash,'#events/'+IDS[0]);assert.equal(h.reads('/events/'+IDS[1]).length,0);
 await h.settle(original,new ApiError({message:'合成ACK遺失',network:true}),true);await h.navigate(1);assert.equal(window.location.hash,'#events/'+IDS[0]);assert.equal(h.reads('/events/'+IDS[1]).length,0);h.click(h.button('重試原活動操作')!);const retry=h.writes()[1];assert.equal(retry.path,original.path);assert.deepEqual(retry.body,original.body);assert.deepEqual(retry.options,original.options);
});
test('control: session generation remount removes A and old B response cannot enter new owner',async t=>{
 const h=fixture(t);await h.start();await h.navigate(1);const old=h.reads('/events/'+IDS[1]).at(-1);h.client.sessionGeneration++;h.render();assert.doesNotMatch(h.text(),/合成活動說明 0/);assert.equal(h.button('我要參加'),undefined);await h.settle(old,event(1));assert.doesNotMatch(h.text(),/合成活動說明 [01]/);await h.settle(h.reads('/events/'+IDS[1]).at(-1),event(1));assert.match(h.text(),/合成活動說明 1/);
});
test('replaced client at same generation removes stale A and rejects old response',async t=>{
 const h=fixture(t);await h.start();await h.navigate(1);const old=h.reads('/events/'+IDS[1]).at(-1);h.props.client={...h.client};h.render();await h.settle(old,event(1));assert.doesNotMatch(h.text(),/合成活動說明 [01]/);assert.equal(h.button('我要參加'),undefined);await h.settle(h.reads('/events/'+IDS[1]).at(-1),event(1));assert.match(h.text(),/合成活動說明 1/);
});
test('control: successful normal list with A and B never needs fallback and targets B',async t=>{
 const h=fixture(t);await h.start([event(0),event(1)]);await h.navigate(1);assert.match(h.text(),/合成活動說明 1/);assert.equal(h.reads('/events/'+IDS[1]).length,0);h.click(h.button('我要參加')!);assert.equal(h.writes().at(-1).path,'/events/'+IDS[1]+'/rsvp');
});
test('a mismatched detail receipt never renders or submits a different event',async t=>{
 const h=fixture(t);await h.start();await h.navigate(1);await h.settle(h.reads('/events/'+IDS[1]).at(-1),event(0));assert.doesNotMatch(h.text(),/合成活動說明 [01]/);assert.equal(h.button('我要參加'),undefined);assert.match(h.text(),/找不到這場活動/);assert.equal(h.writes().length,0);
});
test('late initial A detail cannot replace an already loaded B',async t=>{
 const h=fixture(t);await h.start(null,event(0),true);const a=h.reads('/events/'+IDS[0]).at(-1);await h.navigate(1);await h.settle(h.reads('/events/'+IDS[1]).at(-1),event(1));await h.settle(a,event(0));assert.match(h.text(),/合成活動說明 1/);assert.doesNotMatch(h.text(),/合成活動說明 0/);h.click(h.button('我要參加')!);assert.equal(h.writes().at(-1).path,'/events/'+IDS[1]+'/rsvp');
});
test('a late failed B does not clear newer successful C',async t=>{
 const h=fixture(t);await h.start();await h.navigate(1);const b=h.reads('/events/'+IDS[1]).at(-1);await h.navigate(2);await h.settle(h.reads('/events/'+IDS[2]).at(-1),event(2));await h.settle(b,new Error('late offline'),true);assert.match(h.text(),/合成活動說明 2/);assert.doesNotMatch(h.text(),/找不到這場活動/);
});
test('session invalidation before rerender rejects a held detail response',async t=>{
 const h=fixture(t);await h.start();await h.navigate(1);const b=h.reads('/events/'+IDS[1]).at(-1),readCount=h.reads().length;h.client.sessionGeneration++;await h.settle(b,event(1));assert.equal(h.reads().length,readCount,'old completion cannot start a read for a new generation');h.render();assert.doesNotMatch(h.text(),/合成活動說明 [01]/);assert.equal(h.button('我要參加'),undefined);assert.equal(h.writes().length,0);
});
test('unmount detaches controls and a held response cannot recreate them',async t=>{
 const h=fixture(t);await h.start();await h.navigate(1);const b=h.reads('/events/'+IDS[1]).at(-1);h.unmount();await h.settle(b,event(1));assert.equal(h.container.textContent,'');assert.equal(h.writes().length,0);
});
test('pending and unknown helper command blocks route change and keeps original retry tuple',async t=>{
 const h=fixture(t);await h.start(null,{...event(0),help_need:'合成活動需要幫忙'} as any);await h.settle(h.reads('/events/'+IDS[0]+'/helpers/me').at(-1),{state:null,version:1,event_closed:false});h.click(h.button('我要幫忙，送出申請')!);const first=h.writes().at(-1);await h.navigate(1);assert.equal(window.location.hash,'#events/'+IDS[0]);assert.equal(h.reads('/events/'+IDS[1]).length,0);await h.settle(first,new ApiError({message:'合成遺失回應',network:true}),true);await h.navigate(1);assert.equal(window.location.hash,'#events/'+IDS[0]);h.click(h.button('重試原幫忙操作')!);const retry=h.writes().at(-1);assert.equal(retry.path,first.path);assert.deepEqual(retry.body,first.body);assert.equal(retry.options.idempotencyKey,first.options.idempotencyKey);assert.equal(retry.options.ifMatch,first.options.ifMatch);
});

test('new client with same route and generation cannot commit the previous detail before effect cleanup',async t=>{
 const h=fixture(t);await h.start();h.commits.length=0;h.props.client={...h.client};h.render();assert(h.commits.length);for(const commit of h.commits)assert.doesNotMatch(commit.text,/合成活動說明 0/);assert.equal(h.button('我要參加'),undefined);await h.settle(h.reads('/events/'+IDS[0]).at(-1),event(0));assert.match(h.text(),/合成活動說明 0/);
});
