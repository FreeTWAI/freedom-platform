import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildSync,transformSync} from 'esbuild';
import React from 'react';
import * as prizePhotoRules from '../../apps/portal-web/src/modules/event-prize-photo-client.js';
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
  get isConnected():boolean {return this.ownerDocument.contains(this);}
  get disabled():boolean {return Object.hasOwn(this.attributes,'disabled');}
  set disabled(value:boolean) {if(value)this.setAttribute('disabled','');else this.removeAttribute('disabled');}
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
const window:any = {location:{origin:'https://fixture.invalid',pathname:'/',hash:'',search:''},setTimeout(fn:Function){const id=++nextTimer;scheduled.set(id,fn);return id;},clearTimeout(id:number){scheduled.delete(id);},open(){throw Error('No external navigation permitted');},document, HTMLElement: HostNode, HTMLIFrameElement: class {}, listeners:{} as Record<string,Function[]>, addEventListener(type:string,fn:Function) {(this.listeners[type]??=[]).push(fn);}, removeEventListener(type:string,fn:Function) {this.listeners[type]=(this.listeners[type]??[]).filter((x:Function)=>x!==fn);}, dispatchEvent(e:any) {for(const fn of [...(this.listeners[e.type]??[])])fn(e);return true;}, get event() {return undefined;}};
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
HostNode.prototype.focus = function () { (this.focusAttempts??=[]).push({disabled:this.disabled,connected:this.isConnected});if(!this.disabled&&this.isConnected)this.ownerDocument.activeElement = this; };
HostNode.prototype.select = function () {};
const descendants=(node:HostNode):HostNode[]=>[node,...node.childNodes.flatMap(descendants)];
document.getElementById=(id:string)=>descendants(document).find(node=>node.attributes.id===id)??null;
const matches=(node:HostNode,selector:string)=>{
 if(selector.startsWith('.'))return (node.attributes.class??'').split(' ').includes(selector.slice(1));
 const attribute=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
 if(attribute)return Object.hasOwn(node.attributes,attribute[1])&&(attribute[2]===undefined||node.attributes[attribute[1]]===attribute[2]);
 return node.nodeName===selector.toUpperCase();
};
HostNode.prototype.closest=function(selector:string){for(let node:HostNode|null=this;node;node=node.parentElement)if(matches(node,selector))return node;return null;};
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
const publicTransport={fetch:noNetwork as (...args:any[])=>any};
const frame=(fn:()=>void)=>queueMicrotask(fn);
document.visibilityState='visible';
const bundled=buildSync({stdin:{contents:`export {EventsPanel} from './apps/portal-web/src/modules/EventsPanel'; export {EventPrizePhotoEditor,EventPrizePhoto} from './apps/portal-web/src/modules/EventPrizePhoto'; export {EventPrizeDetails} from './apps/portal-web/src/modules/EventPrizeDetails'; export {PublicEventPage} from './apps/portal-web/src/modules/PublicEventPage'; export {ApiError} from './apps/portal-web/src/api';`,resolveDir:process.cwd(),sourcefile:'prize-photo-ui-entry.ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
const production={exports:{} as any};
runInNewContext(bundled.outputFiles[0].text,{module:production,exports:production.exports,crypto:webcrypto,Intl,URL,URLSearchParams,AbortController,Error,Event,CustomEvent:class{constructor(public type:string){}},Blob,console,window,document,HTMLElement:HostNode,HTMLDetailsElement:class{},navigator:{language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork}},fetch:(...args:any[])=>publicTransport.fetch(...args),requestAnimationFrame:frame,localStorage:{getItem(){return null;},setItem(){}},setTimeout,clearTimeout,require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='zod')return require('zod');throw Error(name);}});
const {EventsPanel,EventPrizePhotoEditor,EventPrizePhoto,EventPrizeDetails,PublicEventPage,ApiError}=production.exports;
const propsOf=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
function host(t:TestContext,component:any,initial:any,strict=false){
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);let props=initial,mounted=true;
 const render=()=>flush(()=>root.render(strict?React.createElement(React.StrictMode,null,React.createElement(component,props)):React.createElement(component,props)));render();
 const nodes=()=>descendants(container),button=(text:string)=>nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent===text)!;
 const click=(node:HostNode)=>{assert(node,'mounted button');assert(!propsOf(node).disabled);flush(()=>node.dispatchEvent({type:'click',button:0}));};
 const field=(text:string)=>{const label=nodes().find(n=>n.nodeName==='LABEL'&&(n.textContent===text||n.textContent.startsWith(text)));assert(label,`label ${text}`);return label.attributes.for?nodes().find(n=>n.attributes.id===label.attributes.for)!:descendants(label).find(n=>['INPUT','TEXTAREA','SELECT'].includes(n.nodeName))!;};
 const change=(label:string,value:string)=>{const node=field(label);flush(()=>propsOf(node).onChange({target:{value},currentTarget:{value}}));};
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};t.after(unmount);
 return {container,nodes,button,click,field,change,render,unmount,setProps(next:any){props=next;render();},text:()=>container.textContent};
}
const OWNER='20000000-0000-4000-8000-000000000001',ID='10000000-0000-4000-8000-000000000001',PRIZE='30000000-0000-4000-8000-000000000001',OTHER='30000000-0000-4000-8000-000000000002';
const prize=(patch:any={})=>({prize_id:PRIZE,name:'合成獎品',description:'合成說明',quantity:1,completion_rule:'依主辦者公開條件確認',claim_note:'活動結束時現場領取',icon_id:'gift',...patch});
const photo=(version=4,publicRead=false,prizeId=PRIZE)=>({prize_id:prizeId,photo_version:version,url:`/api/v1/${publicRead?'public/':''}events/${ID}/prizes/${prizeId}/photo?v=${version}`});
const stored=(patch:any={})=>({event_id:ID,prize_details:[prize()],prize_photos:[],organizer_ref:OWNER,organizer_name:'合成主辦者',title:'合成活動',description:'合成說明',starts_at:'2099-01-01T12:00:00Z',ends_at:'2099-01-01T13:00:00Z',mode:'online',location:'線上會議',event_kind:'other',topic:null,online_url:null,visibility:'open',banner_url:null,banner_orientation:null,video_url:null,video_mime:null,registration_policy:'community_member',help_need:null,capacity:null,state:'pending',aggregate_version:3,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,...patch});
const ack=(r:any,patch:any={})=>({acknowledged:true,event_id:r.eventId,prize_id:r.prizeId,organizer_ref:OWNER,command_key:r.options.idempotencyKey,operation:r.file?'replace':'remove',completed_version:r.options.ifMatch+1,photo:r.file?photo(r.options.ifMatch+1,false,r.prizeId):null,...patch});
const tuple=(r:any)=>JSON.stringify({eventId:r.eventId,prizeId:r.prizeId,key:r.options.idempotencyKey,version:r.options.ifMatch,fileName:r.file?.name,operation:r.file?'replace':'remove'});
function transport(){
 const requests:any[]=[],client:any={csrfToken:'synthetic-csrf',sessionGeneration:1};
 client.getEventPrizePhotoAvailability=(eventId:string,prizeId:string,options:any)=>new Promise((resolve,reject)=>requests.push({method:'availability',eventId,prizeId,options,resolve,reject}));
 client.get=(path:string,options:any)=>new Promise((resolve,reject)=>requests.push({method:'get',path,options,resolve,reject}));
 client.post=(path:string,body:any,options:any)=>new Promise((resolve,reject)=>requests.push({method:'post',path,body,options,resolve,reject}));
 client.replaceEventPrizePhoto=(eventId:string,prizeId:string,file:File,options:any)=>new Promise((resolve,reject)=>requests.push({method:'photo',eventId,prizeId,file,options,resolve,reject}));
 client.removeEventPrizePhoto=(eventId:string,prizeId:string,options:any)=>new Promise((resolve,reject)=>requests.push({method:'photo',eventId,prizeId,file:null,options,resolve,reject}));
 return {requests,client};
}
const settle=async(r:any,value:any,reject=false)=>{assert(r,'pending request');await React.act(async()=>{r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
const file=()=>new File([new Uint8Array([1,2,3])],'合成照片.png',{type:'image/png'});
function fixture(t:TestContext,event=stored(),component=EventPrizePhotoEditor,strict=false){
 const {requests,client}=transport();const states:any[]=[],current:any[]=[],confirmed:any[]=[];let closed=0;
 const props:any={client,userId:OWNER,target:{event,prize:prize()},onState:(state:any)=>states.push(state),onCurrent:(value:any)=>current.push(value),onConfirmed:(...value:any[])=>confirmed.push(value),onClose:()=>closed++};
 const h=host(t,component,props,strict),reads=()=>requests.filter(r=>r.method==='get'),writes=()=>requests.filter(r=>r.method==='photo');
 const available=async(value=true)=>{const r=requests.filter(r=>r.method==='availability').at(-1);if(r&&!r.done){r.done=true;await settle(r,{event_id:r.eventId,prize_id:r.prizeId,organizer_ref:props.userId,upload_available:value});}};
 const choose=async(value:File|null=file())=>{await available();flush(()=>propsOf(h.field('選擇獎品照片')).onChange({target:{files:value?[value]:[]}}));};
 const save=(twice=false)=>{const button=h.button('儲存照片');assert(button);const handler=propsOf(button).onClick;flush(()=>{handler();if(twice)handler();});};
 return {...h,props,client,requests,reads,writes,available,choose,save,current,confirmed,states,state:()=>states.at(-1),closed:()=>closed};
}
test('file selection and cancel are local only, cancel picker retains choice, blobs are revoked',async t=>{
 const made:string[]=[],revoked:string[]=[];t.mock.method(URL,'createObjectURL',()=>{const url=`blob:synthetic-${made.length}`;made.push(url);return url;});t.mock.method(URL,'revokeObjectURL',(value:string)=>{revoked.push(value);});
 const h=fixture(t);await h.choose();assert.equal(h.writes().length,0);assert.match(h.text(),/尚未儲存的預覽/);assert.match(h.text(),/已送出審核/);assert.equal(h.state().dirty,true);await h.choose(null);assert.equal(h.state().dirty,true);await h.choose(new File(['x'],'second.webp',{type:'image/webp'}));assert.deepEqual(revoked,[made[0]]);h.click(h.button('取消這張預覽'));assert.equal(h.state().dirty,false);assert.deepEqual(revoked,made);assert.equal(h.writes().length,0);
});
for(const [name,value,message] of [
 ['empty',new File([],'empty.png',{type:'image/png'}),'空的'],['mime',new File(['x'],'x.svg',{type:'image/svg+xml'}),'不支援'],['size',new File([new Uint8Array(2*1024*1024+1)],'large.png',{type:'image/png'}),'超過'],['name',new File(['x'],'wrong.jpg',{type:'image/png'}),'不一致'],
] as const)test(`readable file validation: ${name}`,async t=>{const h=fixture(t);await h.choose(value);assert.match(h.text(),new RegExp(message));assert.equal(h.writes().length,0);assert.equal(h.state().dirty,false);});
test('same tick double click sends one original File, then exact ACK releases guard before independent read',async t=>{
 const h=fixture(t),original=file();await h.choose(original);h.save(true);assert.equal(h.writes().length,1);const r=h.writes()[0];assert.equal(r.file,original);assert.equal(r.options.ifMatch,3);assert.equal(h.state().pending,true);
 await settle(r,ack(r));assert.equal(h.state().pending,false);assert.equal(h.state().dirty,false);assert.equal(h.state().refreshing,true);assert.equal(h.current.length,0);assert.equal(h.nodes().filter(n=>n.nodeName==='IMG').length,0,'ACK photo never directly renders');
 await settle(h.reads().at(-1),stored({aggregate_version:5,prize_photos:[]}));assert.equal(h.state().refreshing,false);assert.equal(h.current[0].aggregate_version,5);assert.match(h.text(),/目前沒有已保存照片/);assert.equal(h.writes().length,1);
});
for(const patch of [null,{}, {event_id:OTHER},{prize_id:OTHER},{organizer_ref:OTHER},{command_key:OTHER},{operation:'remove'},{completed_version:5},{photo:photo(5)},{photo:{...photo(),url:'https://foreign.invalid/photo'}},{extra:'unknown'}, {photo:{...photo(),asset_id:OTHER}}])test(`malformed ACK keeps original File/key/version ${JSON.stringify(patch)}`,async t=>{
 const h=fixture(t),original=file();await h.choose(original);h.save();const first=h.writes()[0];await settle(first,patch===null?null:Object.keys(patch).length?ack(first,patch):{});assert.equal(h.state().pending,true);assert.match(h.text(),/結果尚未確認/);assert.equal(h.reads().length,0);
 h.click(h.button('確認原照片操作'));const retry=h.writes()[1];assert.equal(tuple(retry),tuple(first));assert.equal(retry.file,original);await settle(retry,ack(first));assert.equal(h.state().pending,false);
});
test('unknown remains after current GET and later definitive rejection; historical ACK does not revive old photo',async t=>{
 const h=fixture(t);await h.choose();h.save();const first=h.writes()[0];await settle(first,new ApiError({message:'lost',network:true}),true);h.click(h.button('重新讀取目前照片'));await settle(h.reads().at(-1),stored({aggregate_version:9,prize_photos:[],state:'published'}));assert.equal(h.state().pending,true);
 h.click(h.button('確認原照片操作'));assert.equal(tuple(h.writes()[1]),tuple(first));await settle(h.writes()[1],new ApiError({status:412,message:'later rejection',definitiveResponse:true}),true);assert.equal(h.state().pending,true);
 h.click(h.button('確認原照片操作'));await settle(h.writes()[2],ack(first));assert.equal(h.state().pending,false);await settle(h.reads().at(-1),stored({aggregate_version:4,prize_photos:[photo()]}));assert.match(h.text(),/版本無法確認/);assert.equal(h.nodes().filter(n=>n.nodeName==='IMG').length,0);assert.equal(h.current.length,1);
 h.click(h.button('重新讀取目前照片'));await settle(h.reads().at(-1),stored({aggregate_version:9,prize_photos:[],state:'published'}));assert.match(h.text(),/目前沒有已保存照片/);assert.equal(h.writes().length,3);
});
test('ACK followed by read failure stays confirmed, read retry never uploads again',async t=>{const h=fixture(t);await h.choose();h.save();await settle(h.writes()[0],ack(h.writes()[0]));await settle(h.reads()[0],new Error('read unavailable'),true);assert.equal(h.state().pending,false);assert.match(h.text(),/原照片儲存操作已確認/);assert.match(h.text(),/read unavailable/);assert.equal(h.button('確認原照片操作'),undefined);h.click(h.button('重新讀取目前照片'));await settle(h.reads()[1],stored({aggregate_version:4,prize_photos:[photo()]}));assert.equal(h.writes().length,1);assert.equal(h.nodes().find(n=>n.nodeName==='IMG')?.src,photo().url);});
test('first known conflict keeps File but requires current read before any new key',async t=>{const h=fixture(t),original=file();await h.choose(original);h.save();await settle(h.writes()[0],new ApiError({status:412,definitiveResponse:true,message:'活動版本已更新'}),true);assert.equal(h.state().pending,false);assert.equal(h.state().dirty,true);assert.equal(propsOf(h.button('儲存照片')).disabled,true);h.click(h.button('重新讀取目前照片'));await settle(h.reads()[0],stored({aggregate_version:8}));h.save();assert.notEqual(h.writes()[1].options.idempotencyKey,h.writes()[0].options.idempotencyKey);assert.equal(h.writes()[1].options.ifMatch,8);assert.equal(h.writes()[1].file,original);});
test('remove requires explicit confirmation; Cancel and Escape return focus only after the disabled trigger commits',async t=>{const h=fixture(t,stored({aggregate_version:4,prize_photos:[photo()]}));const trigger=h.button('移除已保存照片');h.click(trigger);assert.equal(trigger.disabled,true);assert.equal(document.activeElement,h.button('確定移除照片'));trigger.focusAttempts=[];assert.equal(h.writes().length,0);h.click(h.button('返回，不移除'));assert.equal(h.writes().length,0);assert.equal(document.activeElement,trigger);assert.deepEqual(trigger.focusAttempts,[{disabled:false,connected:true}]);h.click(trigger);const section=h.nodes().find(n=>n.attributes['aria-label']==='合成獎品 的照片設定')!;flush(()=>propsOf(section).onKeyDown({key:'Escape',nativeEvent:{isComposing:false},preventDefault(){}}));assert.equal(h.writes().length,0);assert.equal(document.activeElement,trigger);trigger.focusAttempts=[];h.click(trigger);h.click(h.button('確定移除照片'));assert.deepEqual(trigger.focusAttempts,[],'submission must not return cancellation focus');const r=h.writes()[0];assert.equal(r.file,null);await settle(r,ack(r));assert.equal(h.state().pending,false);await settle(h.reads()[0],stored({aggregate_version:5}));assert.match(h.text(),/目前沒有已保存照片/);});
for(const change of ['client','session','user','event','prize','unmount'])for(const outcome of ['ack','failure'])test(`late ${outcome} is fenced across ${change}`,async t=>{
 const h=fixture(t);await h.choose();h.save();const r=h.writes()[0],staleHandler=propsOf(h.button('儲存照片')).onClick;
 if(change==='unmount')h.unmount();else{if(change==='client')h.props.client={...h.client};if(change==='session')h.client.sessionGeneration++;if(change==='user')h.props.userId=OTHER;if(change==='event')h.props.target={event:stored({event_id:OTHER}),prize:prize()};if(change==='prize')h.props.target={event:stored({prize_details:[prize({prize_id:OTHER})]}),prize:prize({prize_id:OTHER})};h.setProps({...h.props});}
 await settle(r,outcome==='ack'?ack(r):new ApiError({network:true,message:'late'}),outcome==='failure');flush(()=>staleHandler());assert.equal(h.current.length,0);assert.equal(h.confirmed.length,0);assert.equal(h.writes().length,1);if(change!=='unmount'){assert.equal(h.state().pending,false);assert.doesNotMatch(h.text(),/原照片儲存操作已確認|結果尚未確認/);}
});
test('A → B → A cannot release a newer A command through old finally',async t=>{const h=fixture(t);await h.choose();h.save();const old=h.writes()[0];h.setProps({...h.props,target:{event:stored({event_id:OTHER}),prize:prize()}});h.setProps({...h.props});await h.choose();h.save();assert.equal(h.writes().length,2);await settle(old,ack(old));assert.equal(h.state().pending,true);assert.equal(h.confirmed.length,0);await settle(h.writes()[1],ack(h.writes()[1]));assert.equal(h.state().pending,false);});
test('session changes without rerender fence late ACK and stale handler',async t=>{const h=fixture(t);await h.choose();h.save();const handler=propsOf(h.button('儲存照片')).onClick;h.client.sessionGeneration++;await settle(h.writes()[0],ack(h.writes()[0]));flush(()=>handler());assert.equal(h.confirmed.length,0);assert.equal(h.writes().length,1);});
test('version keyed image failure resets, ignores detached late errors and retries exact URL',async t=>{const h=host(t,EventPrizePhoto,{eventId:ID,prize:prize(),photo:photo()});const image=h.nodes().find(n=>n.nodeName==='IMG')!;const oldError=propsOf(image).onError;flush(()=>oldError());assert.match(h.text(),/照片暫時無法載入/);h.click(h.button('重試載入照片'));const retry=h.nodes().find(n=>n.nodeName==='IMG')!;assert.equal(retry.src,photo().url);flush(()=>oldError());assert.equal(h.button('重試載入照片'),undefined);const late=propsOf(retry).onError;h.setProps({eventId:ID,prize:prize(),photo:photo(8)});flush(()=>late());assert.equal(h.nodes().find(n=>n.nodeName==='IMG')?.src,photo(8).url);h.setProps({eventId:ID,prize:prize(),photo:photo()});flush(()=>oldError());assert.equal(h.button('重試載入照片'),undefined);});
test('public and member renderer admit only their exact same-origin paths and retain illustrative icon',async t=>{const h=host(t,EventPrizeDetails,{value:[prize()],eventId:ID,photos:[photo()],publicRead:true});assert.equal(h.nodes().filter(n=>n.nodeName==='IMG').length,0);assert.ok(h.nodes().some(n=>n.nodeName==='SVG'));h.setProps({value:[prize()],eventId:ID,photos:[photo(4,true)],publicRead:true});assert.equal(h.nodes().find(n=>n.nodeName==='IMG')?.src,photo(4,true).url);h.setProps({value:[prize()],eventId:ID,photos:[{...photo(),url:'//foreign.invalid/image'}]});assert.equal(h.nodes().filter(n=>n.nodeName==='IMG').length,0);assert.match(h.text(),/照片資料無法確認/);});
function panel(t:TestContext,options:Record<string,unknown>={}){
 const {client,requests}=transport();let guard:(()=>boolean)|null=null;
 const props:any={client,session:{user:{user_id:OWNER}},locationHash:'#events',registerLeave:(value:any)=>guard=value,onList:()=>{},...options};
 const h=host(t,EventsPanel,props),reads=()=>requests.filter(r=>r.method==='get'),writes=()=>requests.filter(r=>r.method==='post'||r.method==='photo');
 const ready=async(items=[stored()])=>{for(const [path,value] of [['/events',{items}],['/guilds/directory',{items:[]}],['/events/bulletins',{items:[]}]]){const request=reads().find(r=>r.path===path);if(request)await settle(request,value);}};
 const choose=async()=>{const r=requests.filter(r=>r.method==='availability').at(-1);if(r&&!r.done){r.done=true;await settle(r,{event_id:r.eventId,prize_id:r.prizeId,organizer_ref:OWNER,upload_available:true});}flush(()=>propsOf(h.field('選擇獎品照片')).onChange({target:{files:[file()]}}));};
 const submit=()=>{const form=h.nodes().find(n=>n.nodeName==='FORM');assert(form);flush(()=>propsOf(form).onSubmit({preventDefault(){}}));};
 return {...h,props,client,requests,reads,writes,ready,choose,submit,leave:()=>{let result:boolean|undefined;flush(()=>{result=guard?.();});return result;}};
}
test('saved panel blocks all event changes synchronously and leave/beforeunload while original photo is unknown',async t=>{
 const h=panel(t);await h.ready();const cancel=propsOf(h.button('取消活動')).onClick;h.click(h.button('管理 合成獎品 的照片'));await h.choose();const save=propsOf(h.button('儲存照片')).onClick;flush(()=>{save();cancel();save();});assert.equal(h.writes().length,1);assert.equal(h.leave(),false);
 let prevented=false;flush(()=>window.dispatchEvent({type:'beforeunload',preventDefault(){prevented=true;},returnValue:undefined}));assert.equal(prevented,true);await settle(h.writes()[0],new ApiError({network:true,message:'lost'}),true);assert.equal(propsOf(h.button('取消活動')).disabled,true);assert.equal(propsOf(h.button('編輯草稿')).disabled,true);assert.equal(h.leave(),false);assert.equal(h.writes().length,1);
 // Refresh changes the list from pending to published, but the editor is outside
 // that list and retains its original File, key, version and unresolved guard.
 h.click(h.button('重新讀取目前照片'));await settle(h.reads().at(-1),stored({state:'published',aggregate_version:9,prize_photos:[]}));assert.equal(h.leave(),false);assert.ok(h.button('確認原照片操作'));h.click(h.button('確認原照片操作'));const retry=h.writes().at(-1);assert.equal(tuple(retry),tuple(h.writes()[0]));assert.equal(retry.file,h.writes()[0].file);
 await settle(retry,ack(retry));assert.equal(h.leave(),true);await settle(h.reads().at(-1),new Error('current read failed'),true);assert.equal(h.leave(),true);assert.equal(propsOf(h.button('取消活動')).disabled,true,'separate refresh barrier remains after ACK');assert.match(h.text(),/原照片儲存操作已確認/);h.click(h.button('重新讀取目前照片'));await settle(h.reads().at(-1),stored({state:'published',aggregate_version:10,prize_photos:[]}));assert.equal(propsOf(h.button('取消活動')).disabled,false);assert.equal(h.writes().length,2);
});
test('saved prize photo deletion asks explicitly at same event CAS and Cancel sends zero writes',async t=>{
 const h=panel(t);await h.ready([stored({aggregate_version:4,prize_photos:[photo()]})]);h.click(h.button('編輯草稿'));assert.equal(propsOf(h.button('管理 合成獎品 的照片')).disabled,true);h.click(h.button('移除獎品 1'));h.click(h.button('確認移除'));const messages:string[]=[];t.mock.method(window,'confirm',(message:string)=>{messages.push(message);return false;});h.submit();assert.equal(h.writes().length,0);assert.match(messages[0],/獎品及其已保存照片/);t.mock.method(window,'confirm',()=>true);h.submit();assert.equal(h.writes().length,1);assert.equal(h.writes()[0].options.ifMatch,4);assert.deepEqual(h.writes()[0].body.prize_details,[]);
});
test('unsaved activities never offer a photo upload, and leaving a local preview can be declined',async t=>{
 const h=panel(t);await h.ready();h.click(h.button('辦活動'));assert.equal(h.nodes().filter(n=>n.nodeName==='INPUT'&&propsOf(n).type==='file'&&propsOf(n).accept==='image/jpeg,image/png,image/webp').length,1,'only legacy poster exists');assert.equal(h.button('管理 合成獎品 的照片')&&propsOf(h.button('管理 合成獎品 的照片')).disabled,true);assert.match(h.text(),/填好名稱、時間和地點即可發布/);h.click(h.button('返回'));h.click(h.button('管理 合成獎品 的照片'));await h.choose();t.mock.method(window,'confirm',()=>false);assert.equal(h.leave(),false);assert.equal(h.writes().length,0);assert.equal(propsOf(h.button('取消活動')).disabled,true);
});
test('accepted event A → B → A route change fences old editor and does not clear a newer pending command',async t=>{
 const h=panel(t);await h.ready();h.click(h.button('管理 合成獎品 的照片'));await h.choose();h.click(h.button('儲存照片'));const old=h.writes()[0];h.setProps({...h.props,locationHash:`#events/${OTHER}`});h.setProps({...h.props});h.click(h.button('管理 合成獎品 的照片'));await h.choose();h.click(h.button('儲存照片'));assert.equal(h.writes().length,2);await settle(old,ack(old));assert.equal(h.leave(),false);assert.doesNotMatch(h.text(),/原照片儲存操作已確認/);await settle(h.writes()[1],ack(h.writes()[1]));assert.equal(h.leave(),true);
});
test('photo controls retain 44px touch targets, 16px inputs and semantic focus tokens without inline theme colors',()=>{const css=readFileSync('apps/portal-web/src/modules/EventPrizePhoto.css','utf8');assert.match(css,/min-height: 44px/);assert.match(css,/font-size: 1rem/);assert.match(css,/outline: 3px solid var\(--focus\)/);assert.doesNotMatch(css,/#(?:[a-f0-9]{3}|[a-f0-9]{6})\b/i);});
for(const bad of [{},[null],null,[{...photo(),asset_id:OTHER}],[photo(),photo()],[photo(4,true)],[{...photo(),url:'https://foreign.invalid/a'}]])test(`malformed photo sidecar retains icon without rendering unsafe image ${JSON.stringify(bad)}`,async t=>{const h=host(t,EventPrizeDetails,{eventId:ID,value:[prize()],photos:bad});assert.equal(h.nodes().filter(n=>n.nodeName==='IMG').length,0);assert.ok(h.nodes().some(n=>n.nodeName==='SVG'));assert.match(h.text(),/照片資料無法確認/);});
test('availability starts unknown and OFF blocks even a stale native input handler with zero writes',async t=>{
 const h=fixture(t);assert.equal(propsOf(h.field('選擇獎品照片')).disabled,true);flush(()=>propsOf(h.field('選擇獎品照片')).onChange({target:{files:[file()]}}));assert.equal(h.button('儲存照片'),undefined);assert.equal(h.writes().length,0);
 await h.available(false);assert.match(h.text(),/照片上傳尚未開放或暫時無法使用/);flush(()=>propsOf(h.field('選擇獎品照片')).onChange({target:{files:[file()]}}));assert.equal(h.button('儲存照片'),undefined);assert.equal(h.writes().length,0);
 h.click(h.button('重新確認照片上傳狀態'));await h.available(true);assert.equal(propsOf(h.field('選擇獎品照片')).disabled,false);await h.choose();assert.equal(h.writes().length,0);h.save();assert.equal(h.writes().length,1);
});
for(const response of [null,{}, {event_id:OTHER,prize_id:PRIZE,organizer_ref:OWNER,upload_available:true},{event_id:ID,prize_id:PRIZE,organizer_ref:OWNER,upload_available:'true'},{event_id:ID,prize_id:PRIZE,organizer_ref:OWNER,upload_available:true,asset_id:OTHER}])test(`malformed availability fails closed ${JSON.stringify(response)}`,async t=>{const h=fixture(t),r=h.requests.find(r=>r.method==='availability');r.done=true;await settle(r,response);assert.equal(propsOf(h.field('選擇獎品照片')).disabled,true);assert.match(h.text(),/照片上傳尚未開放/);assert.equal(h.writes().length,0);});
test('availability failure is retryable read-only and does not become an unknown write',async t=>{const h=fixture(t),r=h.requests.find(r=>r.method==='availability');r.done=true;await settle(r,new Error('offline'),true);assert.equal(h.state().pending,false);assert.equal(h.state().dirty,false);assert.equal(propsOf(h.field('選擇獎品照片')).disabled,true);assert.equal(h.button('確認原照片操作'),undefined);h.click(h.button('重新確認照片上傳狀態'));await h.available(true);assert.equal(propsOf(h.field('選擇獎品照片')).disabled,false);assert.equal(h.writes().length,0);});
test('midflight availability OFF keeps original command; unknown still replays exact File/key/CAS',async t=>{const h=fixture(t);await h.choose();h.save();const first=h.writes()[0];h.click(h.button('重新確認照片上傳狀態'));await h.available(false);assert.equal(h.state().pending,true);await settle(first,new ApiError({network:true,status:503,message:'unknown'}),true);assert.equal(h.state().pending,true);assert.equal(propsOf(h.button('儲存照片')).disabled,true);h.click(h.button('確認原照片操作'));assert.equal(tuple(h.writes()[1]),tuple(first));assert.equal(h.writes()[1].file,first.file);await settle(h.writes()[1],ack(first));assert.equal(h.state().pending,false);});
test('OFF does not prevent explicit remove of an already saved photo',async t=>{const h=fixture(t,stored({aggregate_version:4,prize_photos:[photo()]}));await h.available(false);assert.equal(propsOf(h.field('選擇獎品照片')).disabled,true);h.click(h.button('移除已保存照片'));h.click(h.button('確定移除照片'));assert.equal(h.writes().length,1);assert.equal(h.writes()[0].file,null);await settle(h.writes()[0],ack(h.writes()[0]));assert.equal(h.state().pending,false);});
for(const change of ['client','session','event','prize','unmount','aba'])test(`late availability true never enables a replacement ${change}`,async t=>{const h=fixture(t),old=h.requests.find(r=>r.method==='availability');if(change==='unmount')h.unmount();else{let props={...h.props};if(change==='client')props.client={...h.client};if(change==='session')h.client.sessionGeneration++;if(change==='event'||change==='aba')props.target={event:stored({event_id:OTHER}),prize:prize()};if(change==='prize')props.target={event:stored({prize_details:[prize({prize_id:OTHER})]}),prize:prize({prize_id:OTHER})};h.setProps(props);if(change==='aba')h.setProps({...h.props});}await settle(old,{event_id:ID,prize_id:PRIZE,organizer_ref:OWNER,upload_available:true});if(change!=='unmount')assert.equal(propsOf(h.field('選擇獎品照片')).disabled,true);assert.equal(h.writes().length,0);});
test('actual StrictMode effect replay fences the aborted availability read and starts a fresh one',async t=>{
 const {client,requests}=transport(),props={client,userId:OWNER,target:{event:stored(),prize:prize()},onState(){},onCurrent(){},onConfirmed(){},onClose(){}};
 const h=host(t,EventPrizePhotoEditor,props,true),reads=requests.filter(r=>r.method==='availability');assert.equal(reads.length,2);assert.equal(reads[0].options.signal.aborted,true);assert.equal(reads[1].options.signal.aborted,false);
 await settle(reads[0],{event_id:ID,prize_id:PRIZE,organizer_ref:OWNER,upload_available:true});assert.equal(propsOf(h.field('選擇獎品照片')).disabled,true);
 await settle(reads[1],{event_id:ID,prize_id:PRIZE,organizer_ref:OWNER,upload_available:false});assert.equal(propsOf(h.field('選擇獎品照片')).disabled,true);assert.match(h.text(),/照片上傳尚未開放/);
});

// Restore the old production cancellation handler in memory only. The disabled
// host rejects its pre-commit focus, proving the regression is observable here.
test('negative control: original synchronous cancel focus fails with a disabled-aware host',async t=>{
 const source=readFileSync('apps/portal-web/src/modules/EventPrizePhoto.tsx','utf8');
 const old='function cancelRemove(){if(!current()||flight.current||pending.current)return;setRemoveIntent(false);removeButton.current?.focus();}';
 const changed=source.replace(/function cancelRemove\(\)\{[^\n]*\}/,old);assert.notEqual(changed,source);
 const module={exports:{} as any};
 runInNewContext(transformSync(changed,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,window,document,URL,AbortController,Date,console,require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='../api')return {ApiError};if(name==='./event-prize-photo-client')return prizePhotoRules;if(name.endsWith('.css'))return {};throw Error(name);}});
 const h=fixture(t,stored({aggregate_version:4,prize_photos:[photo()]}),module.exports.EventPrizePhotoEditor),trigger=h.button('移除已保存照片');
 h.click(trigger);trigger.focusAttempts=[];h.click(h.button('返回，不移除'));assert.equal(trigger.disabled,false);
 assert.deepEqual(trigger.focusAttempts,[{disabled:true,connected:true}]);assert.notEqual(document.activeElement,trigger);assert.equal(h.writes().length,0);
});
test('StrictMode cancellation restores focus once, and detached old cancellation cannot steal it',async t=>{
 const h=fixture(t,stored({aggregate_version:4,prize_photos:[photo()]}),EventPrizePhotoEditor,true),trigger=h.button('移除已保存照片');
 h.click(trigger);const cancel=propsOf(h.button('返回，不移除')).onClick;trigger.focusAttempts=[];h.click(h.button('返回，不移除'));
 assert.deepEqual(trigger.focusAttempts,[{disabled:false,connected:true}]);assert.equal(document.activeElement,trigger);
 h.setProps({...h.props,target:{event:stored({event_id:OTHER}),prize:prize()}});const newer=document.activeElement;flush(()=>cancel());assert.equal(document.activeElement,newer);assert.equal(h.writes().length,0);
});
function publicPage(t:TestContext,revalidatePublic:boolean,id=ID){
 const {client,requests}=transport();
 if(revalidatePublic)t.mock.method(publicTransport,'fetch',(path:string,options:any)=>new Promise((resolve,reject)=>requests.push({method:'public',path,options,resolve:(value:unknown)=>resolve({ok:true,json:async()=>value}),reject})));
 const props={client,id,onLogin(){},revalidatePublic},h=host(t,PublicEventPage,props);
 return {...h,props,requests,reads:()=>requests.filter(r=>r.method==='get'||r.method==='public'),writes:()=>requests.filter(r=>r.method==='post'),prizeImages:()=>h.nodes().filter(n=>n.nodeName==='IMG'&&n.attributes.alt==='合成獎品 的獎品照片')};
}
for(const revalidate of [false,true]){
 test(`public ${revalidate?'anonymous fetch':'PortalClient'} rejects event B on route A before displaying photos or registration`,async t=>{
  const h=publicPage(t,revalidate),foreign=stored({event_id:OTHER,registration_policy:'guest_allowed',prize_photos:[{...photo(4,true),url:photo(4,true).url.replace(ID,OTHER)}]});
  await settle(h.reads()[0],foreign);assert.match(h.text(),/活動資料與目前連結不符/);assert.equal(h.prizeImages().length,0);assert.equal(h.nodes().filter(n=>n.nodeName==='FORM').length,0);assert.equal(h.writes().length,0);
 });
 test(`public ${revalidate?'anonymous fetch':'PortalClient'} schema rejects malformed sidecar without showing registration`,async t=>{
  const h=publicPage(t,revalidate);await settle(h.reads()[0],stored({registration_policy:'guest_allowed',prize_photos:null}));assert.match(h.text(),/活動目前無法公開查看/);assert.equal(h.prizeImages().length,0);assert.equal(h.nodes().filter(n=>n.nodeName==='FORM').length,0);assert.equal(h.writes().length,0);
 });
 test(`public ${revalidate?'anonymous fetch':'PortalClient'} fences late A and wrong A after route switches to B`,async t=>{
  const h=publicPage(t,revalidate),old=h.reads()[0];h.setProps({...h.props,id:OTHER});assert.equal(old.options.signal.aborted,true);
  await settle(old,stored({registration_policy:'guest_allowed',prize_photos:[photo(4,true)]}));assert.equal(h.prizeImages().length,0);
  await settle(h.reads().at(-1),stored({registration_policy:'guest_allowed',prize_photos:[photo(4,true)]}));assert.match(h.text(),/活動資料與目前連結不符/);assert.equal(h.prizeImages().length,0);assert.equal(h.nodes().filter(n=>n.nodeName==='FORM').length,0);assert.equal(h.writes().length,0);
 });
 test(`public ${revalidate?'anonymous fetch':'PortalClient'} normalizes a valid UUID identity and accepts its exact photo route`,async t=>{
  const id='ab000000-0000-4000-8000-000000000001',h=publicPage(t,revalidate,id.toUpperCase());
  const p={...photo(4,true),url:photo(4,true).url.replace(ID,id)};await settle(h.reads()[0],stored({event_id:id,registration_policy:'guest_allowed',prize_photos:[p]}));
  assert.equal(h.prizeImages()[0]?.src,p.url);assert.equal(h.nodes().filter(n=>n.nodeName==='FORM').length,1);assert.equal(h.writes().length,0);
 });
 test(`public ${revalidate?'anonymous fetch':'PortalClient'} rejects malformed, suffixed or whitespace route UUIDs without a read`,async t=>{for(const id of ['not-an-event',ID+'\n',ID+'?other',` ${ID}`]){const h=publicPage(t,revalidate,id);assert.equal(h.reads().length,0);assert.match(h.text(),/活動連結無法辨識/);assert.equal(h.nodes().filter(n=>n.nodeName==='FORM').length,0);h.unmount();}});
}
test('discarding a local photo preview returns parent focus after the trigger is enabled',async t=>{
 const h=panel(t);await h.ready();const trigger=h.button('管理 合成獎品 的照片');h.click(trigger);await h.choose();assert.equal(trigger.disabled,true);trigger.focusAttempts=[];t.mock.method(window,'confirm',()=>true);h.click(h.button('返回活動'));
 assert.equal(h.button('儲存照片'),undefined);assert.equal(trigger.disabled,false);assert.equal(document.activeElement,trigger);assert.deepEqual(trigger.focusAttempts,[{disabled:false,connected:true}]);assert.equal(h.writes().length,0);
});
for(const state of ['refreshing','published'])test(`closing the photo editor uses a stable heading when its trigger is ${state==='refreshing'?'disabled':'disconnected'}`,async t=>{
 const h=panel(t);await h.ready();const trigger=h.button('管理 合成獎品 的照片');h.click(trigger);await h.choose();h.click(h.button('儲存照片'));await settle(h.writes()[0],ack(h.writes()[0]));
 if(state==='published')await settle(h.reads().at(-1),stored({state:'published',aggregate_version:5,prize_photos:[]}));
 assert.equal(state==='refreshing'?trigger.disabled:!trigger.isConnected,true);trigger.focusAttempts=[];h.click(h.button('返回活動'));
 assert.equal(document.activeElement,h.nodes().find(n=>n.nodeName==='H2'&&n.textContent==='一起參加活動，也可以自己辦。'));assert.deepEqual(trigger.focusAttempts,[]);assert.equal(h.writes().length,1);
});
for(const bad of [null,{},[null],[photo(),photo()],[{...photo(),asset_id:OTHER}]])test(`editing refuses malformed photo sidecar ${JSON.stringify(bad)} without a metadata write`,async t=>{
 const h=panel(t);await h.ready([stored({aggregate_version:4,prize_photos:bad})]);h.click(h.button('編輯草稿'));assert.equal(h.nodes().filter(n=>n.nodeName==='FORM').length,0);assert.match(h.text(),/獎品資料無法確認/);assert.equal(h.writes().length,0);
});
test('legacy omitted photo sidecar still permits a saved activity edit and metadata save',async t=>{
 const h=panel(t),legacy=stored({prize_photos:undefined});await h.ready([legacy]);h.click(h.button('編輯草稿'));h.submit();assert.equal(h.writes().length,1);assert.equal(h.writes()[0].options.ifMatch,legacy.aggregate_version);
});

for(const bad of [null,{},[null],[photo(),photo()],[{...photo(),asset_id:OTHER}]])test(`same-version list refresh with malformed sidecar ${JSON.stringify(bad)} blocks an already-open prize deletion`,async t=>{
 // A detail response opens the editor while the original list read is still
 // pending; the later real list response replaces it without changing CAS.
 const h=panel(t,{locationHash:`#events/${ID}`});
 await settle(h.reads().find(r=>r.path===`/events/${ID}`),stored({aggregate_version:4,prize_photos:[photo()]}));
 h.click(h.button('編輯草稿'));h.click(h.button('移除獎品 1'));h.click(h.button('確認移除'));
 await h.ready([stored({aggregate_version:4,prize_photos:bad})]);
 const confirmation=t.mock.method(window,'confirm',()=>true);h.submit();
 assert.equal(confirmation.mock.callCount(),0,'malformed data cannot downgrade to the photo-free save flow');assert.equal(h.writes().length,0);assert.match(h.text(),/獎品資料無法確認/);assert.ok(h.nodes().some(n=>n.nodeName==='FORM'),'draft remains mounted');
});
test('an old photo editor close handler cannot move focus or discard a replacement session draft',async t=>{
 const h=panel(t);await h.ready();h.click(h.button('管理 合成獎品 的照片'));await h.choose();const oldClose=propsOf(h.button('返回活動')).onClick;
 h.setProps({...h.props,client:{...h.client}});const latest=document.activeElement;flush(()=>oldClose());assert.equal(document.activeElement,latest);assert.equal(h.writes().length,0);
});

test('cancelling a preview after availability turns OFF focuses the stable editor heading, not its disabled file input',async t=>{
 const h=fixture(t);await h.choose();h.click(h.button('重新確認照片上傳狀態'));await h.available(false);const input=h.field('選擇獎品照片');assert.equal(input.disabled,true);input.focusAttempts=[];
 h.click(h.button('取消這張預覽'));assert.equal(h.state().dirty,false);assert.equal(h.button('儲存照片'),undefined);assert.equal(h.writes().length,0);assert.equal(document.activeElement,h.nodes().find(n=>n.nodeName==='H4'&&n.textContent==='合成獎品 的照片'));assert.deepEqual(input.focusAttempts,[]);
});

for(const hidden of [false,true])test(`cancel focus does not steal ${hidden?'background':'deliberately moved'} focus during the same commit`,async t=>{
 const h=fixture(t,stored({aggregate_version:4,prize_photos:[photo()]}));h.click(h.button('移除已保存照片'));const trigger=h.button('移除已保存照片'),cancel=propsOf(h.button('返回，不移除')).onClick,other=h.button('返回活動');trigger.focusAttempts=[];
 const before=document.activeElement;if(hidden)document.visibilityState='hidden';
 try{flush(()=>{cancel();if(!hidden)other.focus();});assert.deepEqual(trigger.focusAttempts,[]);assert.equal(document.activeElement,hidden?before:other);}finally{document.visibilityState='visible';}
 assert.equal(h.writes().length,0);
});
test('preview cancellation does not steal focus moved to another connected control before commit',async t=>{
 const h=fixture(t);await h.choose();const cancel=propsOf(h.button('取消這張預覽')).onClick,other=h.button('返回活動'),input=h.field('選擇獎品照片');input.focusAttempts=[];
 flush(()=>{cancel();other.focus();});assert.equal(document.activeElement,other);assert.deepEqual(input.focusAttempts,[]);assert.equal(h.writes().length,0);
});
for(const hidden of [false,true])test(`parent close does not steal ${hidden?'background':'deliberately moved'} focus during the same commit`,async t=>{
 const h=panel(t);await h.ready();const trigger=h.button('管理 合成獎品 的照片');h.click(trigger);await h.choose();const close=propsOf(h.button('返回活動')).onClick,other=h.button('報名參加');trigger.focusAttempts=[];t.mock.method(window,'confirm',()=>true);
 const before=document.activeElement;if(hidden)document.visibilityState='hidden';
 try{flush(()=>{close();if(!hidden)other.focus();});assert.deepEqual(trigger.focusAttempts,[]);assert.equal(document.activeElement,hidden?before:other);}finally{document.visibilityState='visible';}
 assert.equal(h.writes().length,0);
});

for(const state of ['refresh-pending','published','photo-removed'])for(const method of ['cancel','escape'])test(`remove ${method} returns to the editor heading after ${state} removes its trigger`,async t=>{
 const h=fixture(t,stored({aggregate_version:4,prize_photos:[photo()]})),trigger=h.button('移除已保存照片');h.click(trigger);
 h.click(h.button('重新讀取目前照片'));assert.equal(trigger.isConnected,false);assert.equal(h.reads().length,1);
 if(state==='published')await settle(h.reads()[0],stored({state:'published',aggregate_version:5,prize_photos:[photo()]}));
 if(state==='photo-removed')await settle(h.reads()[0],stored({aggregate_version:5,prize_photos:[]}));
 trigger.focusAttempts=[];
 if(method==='cancel')h.click(h.button('返回，不移除'));
 else {const editor=h.nodes().find(n=>n.attributes['aria-label']==='合成獎品 的照片設定')!;flush(()=>propsOf(editor).onKeyDown({key:'Escape',nativeEvent:{isComposing:false},preventDefault(){}}));}
 assert.equal(h.button('確定移除照片'),undefined);assert.equal(document.activeElement,h.nodes().find(n=>n.nodeName==='H4'&&n.textContent==='合成獎品 的照片'));assert.deepEqual(trigger.focusAttempts,[]);
 assert.equal(h.writes().length,0);assert.equal(h.state().pending,false);assert.equal(h.state().refreshing,state==='refresh-pending');assert.equal(h.reads().length,1);
});
