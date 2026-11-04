import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildSync,transformSync} from 'esbuild';
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
document.visibilityState='visible';
const bundled=buildSync({stdin:{contents:`export {EventsPanel} from './apps/portal-web/src/modules/EventsPanel'; export {EventAttendance} from './apps/portal-web/src/modules/EventAttendance'; export {ApiError} from './apps/portal-web/src/api';`,resolveDir:process.cwd(),sourcefile:'attendance-ui-entry.ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
const production={exports:{} as any};
runInNewContext(bundled.outputFiles[0].text,{module:production,exports:production.exports,crypto:webcrypto,Intl,URL,URLSearchParams,AbortController,Error,Event,CustomEvent:class{constructor(public type:string){}},Blob,console,window,document,HTMLElement:HostNode,HTMLDetailsElement:class{},navigator:{language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork}},fetch:noNetwork,requestAnimationFrame:frame,localStorage:{getItem(){return null;},setItem(){}},setTimeout,clearTimeout,require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='zod')return require('zod');throw Error(name);}});
const {EventsPanel,EventAttendance,ApiError}=production.exports;
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
const OWNER='20000000-0000-4000-8000-000000000001',ID='10000000-0000-4000-8000-000000000001',MEMBER='30000000-0000-4000-8000-000000000001',PEER='30000000-0000-4000-8000-000000000002';
const row=(patch:any={})=>({member_ref:MEMBER,nickname:'合成會員',avatar_url:null,registration_state:'going',registered_at:'2026-11-01T00:00:00Z',state:'unconfirmed',version:1,recorded_by:null,recorded_at:null,updated_by:null,updated_at:null,retraction_reason:null,can_confirm:true,can_retract:false,confirm_unavailable:null,...patch});
const confirmed=(patch:any={})=>row({state:'confirmed',version:2,recorded_by:OWNER,recorded_at:'2026-11-04T12:00:00Z',updated_by:OWNER,updated_at:'2026-11-04T12:00:00Z',can_confirm:false,can_retract:true,...patch});
const retracted=(patch:any={})=>confirmed({state:'retracted',version:3,retraction_reason:'not_confirmed',can_confirm:true,can_retract:false,...patch});
const page=(items:any[]=[row()],patch:any={})=>({event_id:ID,organizer_ref:OWNER,items,total:items.length,next_offset:null,...patch});
const ack=(r:any,patch:any={})=>({acknowledged:true,event_id:r.path.split('/')[2],member_ref:r.path.split('/').at(-1),action:r.body.action,retraction_reason:r.body.action==='retract'?r.body.reason:null,command_key:r.options.idempotencyKey,attendance_version:r.options.ifMatch+1,changed:true,...patch});
const tuple=(r:any)=>JSON.stringify({path:r.path,body:r.body,key:r.options.idempotencyKey,version:r.options.ifMatch});
function transport(){const requests:any[]=[],client:any={sessionGeneration:1};client.get=(path:string,options:any)=>new Promise((resolve,reject)=>requests.push({method:'get',path,options,resolve,reject}));client.post=(path:string,body:any,options:any)=>new Promise((resolve,reject)=>requests.push({method:'post',path,body,options,resolve,reject}));return {requests,client};}
function fixture(t:TestContext){
 document.visibilityState='visible';const {client,requests}=transport();let blocked=false;const blocks:boolean[]=[];
 const props:any={client,eventId:ID,userId:OWNER,onBlockedChange(value:boolean){blocked=value;blocks.push(value);}};
 const h=host(t,EventAttendance,props);const reads=()=>requests.filter(r=>r.method==='get'),writes=()=>requests.filter(r=>r.method==='post');
 const settle=async(r:any,value:any,reject=false)=>{assert(r);await React.act(async()=>{r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
 const ready=async(value=page())=>settle(reads().at(-1),value);
 const begin=(retract=false)=>{h.click(h.button(retract?'撤回 合成會員 的到場確認':'確認 合成會員 到場'));};
 const submit=(twice=false,retract=false)=>{const node=h.button(retract?'確定撤回確認':'確定記錄到場');assert(node);const handler=propsOf(node).onClick;flush(()=>{handler();if(twice)handler();});};
 const event=(type:string,target:any=window)=>flush(()=>target.dispatchEvent({type}));
 return {...h,props,client,requests,reads,writes,settle,ready,begin,submit,event,blocks,blocked:()=>blocked};
}
test('loading is not zero attendance and only readback renders unconfirmed state with honest separate facts',async t=>{const h=fixture(t);assert.match(h.text(),/正在讀取到場紀錄/);assert.doesNotMatch(h.text(),/共 0 位/);assert.equal(h.writes().length,0);await h.ready();assert.match(h.text(),/報名：已報名/);assert.match(h.text(),/到場：尚未確認到場/);assert.match(h.text(),/不是實際抵達時間/);assert.match(h.text(),/尚未提供完成認定或發獎功能/);assert.equal(h.blocked(),false);});
test('inline confirmation can return or Escape without any mutation and returns focus',async t=>{const h=fixture(t);await h.ready();const trigger=h.button('確認 合成會員 到場');h.begin();assert.equal(h.writes().length,0);h.click(h.button('返回，不更改'));assert.equal(h.writes().length,0);assert.equal(document.activeElement,trigger);h.begin();const group=h.nodes().find(n=>n.attributes['aria-label']==='合成會員 的到場確認')!;flush(()=>propsOf(group).onKeyDown({key:'Escape',nativeEvent:{isComposing:false},preventDefault(){}}));assert.equal(h.button('確定記錄到場'),undefined);assert.equal(document.activeElement,trigger);});
test('same-tick double confirmation sends one frozen command and does not optimistically mark attendance',async t=>{const h=fixture(t);await h.ready();h.begin();h.submit(true);assert.equal(h.writes().length,1);const r=h.writes()[0];assert.equal(r.path,`/events/${ID}/attendance/${MEMBER}`);assert.deepEqual(JSON.parse(JSON.stringify(r.body)),{action:'confirm'});assert.equal(r.options.ifMatch,1);assert.equal(h.blocked(),true);assert.doesNotMatch(h.text(),/到場：主辦已確認到場/);await h.settle(r,ack(r));assert.equal(h.blocked(),false);assert.match(h.text(),/原操作已確認/);assert.match(h.text(),/正在讀取到場紀錄/);await h.ready(page([confirmed()]));assert.match(h.text(),/到場：主辦已確認到場/);assert.match(h.text(),/由你記錄於/);assert.equal(document.activeElement,h.button('撤回 合成會員 的到場確認'));});
test('retract uses a bounded selected reason, original member version and retains registration after readback',async t=>{const h=fixture(t);await h.ready(page([confirmed({registration_state:'cancelled',confirm_unavailable:'registration_cancelled'})]));h.begin(true);assert.match(h.text(),/不會取消報名/);h.change('更正原因','not_confirmed');h.submit(false,true);const r=h.writes()[0];assert.deepEqual(JSON.parse(JSON.stringify(r.body)),{action:'retract',reason:'not_confirmed'});assert.equal(r.options.ifMatch,2);await h.settle(r,ack(r));await h.ready(page([retracted({registration_state:'cancelled',can_confirm:false,confirm_unavailable:'registration_cancelled'})]));assert.match(h.text(),/已取消報名，原到場紀錄保留/);assert.match(h.text(),/已撤回確認，目前尚未確認/);assert.match(h.text(),/目前無法確認到場/);});
for(const value of [null,{},[],{items:[]},page([row({version:'1'})]),page([row()],{event_id:PEER}),page([row()],{organizer_ref:PEER})])test(`malformed or foreign private page fails closed ${JSON.stringify(value).slice(0,35)}`,async t=>{const h=fixture(t);await h.ready(value);assert.match(h.text(),/到場紀錄不完整/);assert.equal(h.button('確認 合成會員 到場'),undefined);assert.equal(h.writes().length,0);assert.equal(h.blocked(),false);});
for(const patch of [null,{}, {event_id:PEER},{member_ref:PEER},{action:'retract'},{command_key:'wrong-key'},{attendance_version:3},{attendance_version:'2'},{changed:undefined},{changed:false,attendance_version:1},{retraction_reason:'not_confirmed'}])test(`unknown or wrong receipt retains exact original tuple ${JSON.stringify(patch)}`,async t=>{const h=fixture(t);await h.ready();h.begin();h.submit();const first=h.writes()[0];await h.settle(first,patch===null?null:Object.keys(patch).length?ack(first,patch):{});assert.equal(h.blocked(),true);assert.match(h.text(),/結果還沒確認/);assert.doesNotMatch(h.text(),/原操作已確認/);h.click(h.button('重試原到場操作'));assert.equal(tuple(h.writes()[1]),tuple(first));await h.settle(h.writes()[1],ack(first));assert.equal(h.blocked(),false);});
test('unknown survives independent current GET and later definitive error; only original ACK settles without resurrecting old state',async t=>{const h=fixture(t);await h.ready();h.begin();h.submit();const first=h.writes()[0];await h.settle(first,new ApiError({message:'lost',network:true}),true);h.click(h.button('重新讀取到場紀錄'));await h.ready(page([retracted()]));assert.equal(h.blocked(),true);assert.match(h.text(),/已撤回確認/);assert.equal(propsOf(h.button('確認 合成會員 到場')).disabled,true);h.click(h.button('重試原到場操作'));await h.settle(h.writes()[1],new ApiError({status:403,code:'organizer_required',message:'denied',definitiveResponse:true}),true);assert.equal(h.blocked(),true);h.click(h.button('重試原到場操作'));assert.equal(tuple(h.writes()[2]),tuple(first));await h.settle(h.writes()[2],ack(first));assert.equal(h.blocked(),false);await h.ready(page([confirmed()]));assert.match(h.text(),/讀到較舊的到場紀錄/);assert.doesNotMatch(h.text(),/到場：主辦已確認到場/);h.click(h.button('重新讀取到場紀錄'));await h.ready(page([retracted()]));assert.match(h.text(),/已撤回確認/);assert.equal(h.writes().length,3);});
test('canonical ACK releases navigation immediately even when independent GET fails',async t=>{const h=fixture(t);await h.ready();h.begin();h.submit();const r=h.writes()[0];await h.settle(r,ack(r));assert.equal(h.blocked(),false);await h.settle(h.reads().at(-1),new ApiError({message:'read failed',network:true}),true);assert.equal(h.blocked(),false);assert.match(h.text(),/原操作已確認/);assert.match(h.text(),/read failed/);assert.equal(h.button('重試原到場操作'),undefined);h.click(h.button('重新讀取到場紀錄'));await h.ready(page([confirmed()]));assert.equal(h.writes().length,1);});
test('known conflict permits reread but never silently retries or rebases the write',async t=>{const h=fixture(t);await h.ready();h.begin();h.submit();await h.settle(h.writes()[0],new ApiError({status:412,code:'version_conflict',message:'資料已更新',definitiveResponse:true}),true);assert.equal(h.blocked(),false);assert.equal(h.button('重試原到場操作'),undefined);assert.equal(h.writes().length,1);h.click(h.button('重新讀取到場紀錄'));await h.ready(page([confirmed()]));assert.equal(h.writes().length,1);});
for(const change of ['client','session','user','event','unmount'])for(const outcome of ['ack','failure'])test(`late ${outcome} cannot cross ${change}`,async t=>{const h=fixture(t);await h.ready();h.begin();h.submit();const old=h.writes()[0];if(change==='unmount')h.unmount();else{if(change==='client')h.props.client={...h.client};if(change==='session')h.client.sessionGeneration++;if(change==='user')h.props.userId=PEER;if(change==='event')h.props.eventId=PEER;h.setProps({...h.props});}await h.settle(old,outcome==='ack'?ack(old):new ApiError({message:'late lost',network:true}),outcome==='failure');assert.equal(h.writes().length,1);if(change!=='unmount'){assert.doesNotMatch(h.text(),/原操作已確認|結果還沒確認|到場：主辦已確認到場/);await h.ready(page([row({nickname:'新頁會員'})],{event_id:h.props.eventId,organizer_ref:h.props.userId}));assert.match(h.text(),/新頁會員/);assert.doesNotMatch(h.text(),/合成會員/);}});
test('session generation change without rerender still fences late ACK and prevents stale click',async t=>{const h=fixture(t);await h.ready();h.begin();h.submit();const r=h.writes()[0];h.client.sessionGeneration++;await h.settle(r,ack(r));assert.doesNotMatch(h.text(),/原操作已確認/);assert.equal(h.writes().length,1);});
test('background hides private snapshot; foreground only reloads and never retransmits unknown command',async t=>{const h=fixture(t);await h.ready();h.begin();h.submit();await h.settle(h.writes()[0],new ApiError({message:'lost',network:true}),true);document.visibilityState='hidden';h.event('visibilitychange',document);assert.doesNotMatch(h.text(),/到場：尚未確認/);assert.equal(h.blocked(),true);document.visibilityState='visible';h.event('visibilitychange',document);await h.ready(page([confirmed()]));assert.equal(h.blocked(),true);assert.equal(h.writes().length,1);h.event('freedom-game-console-session-end');assert.doesNotMatch(h.text(),/合成會員|原操作已確認/);assert.equal(h.blocked(),false);});
test('late read cannot overwrite a new current read or restore revoked private details',async t=>{const h=fixture(t);const old=h.reads()[0];h.event('focus');await h.ready(page([retracted()]));await h.settle(old,page([row()]));assert.match(h.text(),/已撤回確認/);h.event('focus');await h.settle(h.reads().at(-1),new ApiError({status:403,code:'organizer_required',message:'目前不是主辦',definitiveResponse:true}),true);assert.doesNotMatch(h.text(),/合成會員/);assert.match(h.text(),/目前不是主辦/);assert.equal(h.writes().length,0);});
test('current host self row and revoked writer history display no enabled record control',async t=>{const h=fixture(t);await h.ready(page([row({member_ref:OWNER,nickname:'主辦自己',can_confirm:false,confirm_unavailable:'self_confirmation'}),confirmed({can_retract:false,confirm_unavailable:'organizer_unavailable'})]));assert.equal(propsOf(h.button('確認 主辦自己 到場')).disabled,true);assert.equal(propsOf(h.button('撤回 合成會員 的到場確認')).disabled,true);assert.match(h.text(),/目前沒有可用的更正權限/);assert.equal(h.writes().length,0);});
test('pagination stays owner-bound and disabled during an unknown mutation',async t=>{const h=fixture(t);const items=Array.from({length:20},(_,i)=>row({member_ref:`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,nickname:i===0?'合成會員':`會員${i}`}));await h.ready(page(items,{total:21,next_offset:20}));h.click(h.button('下一頁會員'));assert.match(h.reads().at(-1).path,/offset=20$/);await h.ready(page([row({member_ref:PEER})],{total:21}));h.begin();h.submit();await h.settle(h.writes()[0],new ApiError({message:'lost',network:true}),true);h.click(h.button('重新讀取到場紀錄'));await h.ready(page([row({member_ref:PEER})],{total:21}));assert.equal(propsOf(h.button('上一頁會員')).disabled,true);});
test('attendance styling uses real tokens and native inline controls, not new dialog or color-only status',()=>{const css=readFileSync('apps/portal-web/src/modules/EventAttendance.css','utf8'),src=readFileSync('apps/portal-web/src/modules/EventAttendance.tsx','utf8');for(const token of ['line','ink','bg-elev','focus'])assert.match(css,new RegExp(`var\\(--${token}\\)`));assert.doesNotMatch(css,/var\(--border\)/);assert.match(css,/min-height:\s*44px/);assert.match(css,/font-size:\s*16px/);assert.match(css,/:focus-visible/);assert.doesNotMatch(src,/<dialog|showModal|window\.confirm|localStorage|type="checkbox"/);assert.match(src,/role="group"/);});

test('actual EventsPanel registers attendance unknown in route and beforeunload guards and releases after ACK before GET',async t=>{
 document.visibilityState='visible';const {client,requests}=transport();let guard:(()=>boolean)|null=null;
 const props:any={client,session:{user:{user_id:OWNER}},locationHash:'#events/'+ID,registerLeave:(value:any)=>{guard=value;},onList(){}};
 const h=host(t,EventsPanel,props);
 const settle=async(r:any,value:any,reject=false)=>{assert(r);await React.act(async()=>{r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
 const data={event_id:ID,organizer_ref:OWNER,title:'合成活動',description:'活動內容',starts_at:'2026-01-01T00:00:00Z',ends_at:'2026-01-01T01:00:00Z',mode:'online',location:'合成教室',capacity:null,state:'published',visibility:'open',event_kind:'other',topic:null,online_url:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,banner_url:null,banner_orientation:null,video_url:null,video_mime:null,attending_count:1,my_rsvp:null,aggregate_version:1,registration_policy:'community_member',prize_details:[]};
 for(const r of [...requests])await settle(r,r.path==='/events/'+ID?data:{items:r.path==='/events'?[data]:[]});
 const read=requests.find(r=>r.path.includes('/attendance?'));assert(read);await settle(read,page());
 h.click(h.button('確認 合成會員 到場'));h.click(h.button('確定記錄到場'));const write=requests.find(r=>r.method==='post');assert(write);
 let leave=true;flush(()=>{leave=guard!();});assert.equal(leave,false);const unload:any={type:'beforeunload',preventDefault(){this.prevented=true;}};flush(()=>window.dispatchEvent(unload));assert.equal(unload.prevented,true);
 await settle(write,new ApiError({message:'lost',network:true}),true);flush(()=>{leave=guard!();});assert.equal(leave,false);
 h.click(h.button('重試原到場操作'));const retry=requests.filter(r=>r.method==='post').at(-1);assert.equal(tuple(retry),tuple(write));await settle(retry,ack(write));flush(()=>{leave=guard!();});assert.equal(leave,true);
 const after:any={type:'beforeunload',preventDefault(){this.prevented=true;}};flush(()=>window.dispatchEvent(after));assert.equal(after.prevented,undefined);
});

test('parent ownership loss hides private data but cannot settle or discard the original pending command',async t=>{
 const h=fixture(t);await h.ready();h.begin();h.submit();const first=h.writes()[0];h.props.canView=false;h.setProps({...h.props});assert.doesNotMatch(h.text(),/合成會員/);assert.equal(h.blocked(),true);await h.settle(first,new ApiError({message:'lost',network:true}),true);assert.equal(h.blocked(),true);assert.match(h.text(),/已隱藏名單/);h.click(h.button('重試原到場操作'));assert.equal(tuple(h.writes()[1]),tuple(first));await h.settle(h.writes()[1],ack(first));assert.equal(h.blocked(),false);assert.doesNotMatch(h.text(),/合成會員/);h.props.canView=true;h.setProps({...h.props});await h.ready(page([retracted()]));assert.match(h.text(),/已撤回確認/);
});

for(const loss of ['late_list_owner','late_fallback_missing'])test(`actual EventsPanel ${loss} preserves unknown and both leave guards while hiding private attendance`,async t=>{
 document.visibilityState='visible';const {client,requests}=transport();let guard:(()=>boolean)|null=null;
 const h=host(t,EventsPanel,{client,session:{user:{user_id:OWNER}},locationHash:'#events/'+ID,registerLeave:(value:any)=>{guard=value;},onList(){}});
 const settle=async(r:any,value:any,reject=false)=>{assert(r);await React.act(async()=>{r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
 const data={event_id:ID,organizer_ref:OWNER,title:'合成活動',description:'活動內容',starts_at:'2026-01-01T00:00:00Z',ends_at:'2026-01-01T01:00:00Z',mode:'online',location:'合成教室',capacity:null,state:'published',visibility:'open',event_kind:'other',topic:null,online_url:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,banner_url:null,banner_orientation:null,video_url:null,video_mime:null,attending_count:1,my_rsvp:null,aggregate_version:1,registration_policy:'community_member',prize_details:[]};
 await settle(requests.find(r=>r.path==='/events/'+ID),data);
 await settle(requests.find(r=>r.path.includes('/attendance?')),page());
 h.click(h.button('確認 合成會員 到場'));h.click(h.button('確定記錄到場'));const first=requests.find(r=>r.method==='post');assert(first);
 // The original write has started before the parent's unrelated list returns.
 for(const r of requests.filter(r=>['/events','/guilds/directory','/events/bulletins'].includes(r.path)))await settle(r,{items:r.path==='/events'&&loss==='late_list_owner'?[{...data,organizer_ref:PEER}]:[]});
 if(loss==='late_fallback_missing')await settle(requests.filter(r=>r.path==='/events/'+ID).at(-1),new ApiError({status:404,code:'not_found',message:'missing',definitiveResponse:true}),true);
 assert.doesNotMatch(h.text(),/合成會員/);assert.match(h.text(),/已隱藏名單/);
 let leave=true;flush(()=>{leave=guard!();});assert.equal(leave,false);
 await settle(first,new ApiError({message:'lost',network:true}),true);flush(()=>{leave=guard!();});assert.equal(leave,false);
 const unload:any={type:'beforeunload',preventDefault(){this.prevented=true;}};flush(()=>window.dispatchEvent(unload));assert.equal(unload.prevented,true);
 h.click(h.button('重試原到場操作'));const retry=requests.filter(r=>r.method==='post').at(-1);assert.equal(tuple(retry),tuple(first));
 await settle(retry,new ApiError({status:403,code:'organizer_required',message:'revoked',definitiveResponse:true}),true);flush(()=>{leave=guard!();});assert.equal(leave,false);
 assert.equal(requests.filter(r=>r.method==='post').length,2);assert.doesNotMatch(h.text(),/合成會員/);
});

for(const priorUnknown of [false,true])test(`attendance_busy is definitive only for a fresh attempt; prior unknown=${priorUnknown} retains its original tuple`,async t=>{
 const h=fixture(t);await h.ready();h.begin();h.submit();const first=h.writes()[0];
 if(priorUnknown){await h.settle(first,new ApiError({message:'lost',network:true}),true);h.click(h.button('重試原到場操作'));}
 await h.settle(h.writes().at(-1),new ApiError({status:409,code:'attendance_busy',message:'這次操作未寫入',definitiveResponse:true}),true);
 assert.equal(h.blocked(),priorUnknown);assert.equal(h.writes().length,priorUnknown?2:1);
 if(priorUnknown){h.click(h.button('重試原到場操作'));assert.equal(tuple(h.writes().at(-1)),tuple(first));await h.settle(h.writes().at(-1),ack(first));assert.equal(h.blocked(),false);}
 else{assert.equal(h.button('重試原到場操作'),undefined);h.click(h.button('重新讀取到場紀錄'));await h.ready();assert.equal(h.writes().length,1);}
});
