import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
import * as inbox from '../../apps/portal-web/src/modules/member-inbox';
import * as language from '../../apps/portal-web/src/language';
import * as format from '../../apps/portal-web/src/format';
import * as noticeTypes from '../../modules/member-communications/types';
import * as boundaries from '../../apps/portal-web/src/LazyPage';

// Real React/ReactDOM render the complete production Bell and its real notification
// hook/validators/text helpers. The minimal DOM host and deferred client below are
// synthetic. This is not browser event propagation, layout, PWA, HTTP or SQL evidence.
class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style = {setProperty() {}, removeProperty() {}};
  listeners: Record<string, Function[]> = {};
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
  addEventListener(type: string, fn: Function) {(this.listeners[type] ??= []).push(fn);}
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter(item => item !== fn);}
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
const window = Object.assign(new EventTarget(), {document, HTMLElement: HostNode, HTMLIFrameElement: class {}, get event() {return undefined;}});
document.defaultView = window;
Object.assign(globalThis, {document, window, HTMLElement: HostNode, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true});
// Initialize ReactDOM after installing its synthetic host, in this test process.
const require = createRequire(import.meta.url);
const {createRoot} = require('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = require('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));


HostNode.prototype.focus=function(){this.ownerDocument.activeElement=this;};
const descendants=(node:HostNode):HostNode[]=>[node,...node.childNodes.flatMap(descendants)];
const props=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
const source=readFileSync(new URL('../../apps/portal-web/src/modules/NotificationBell.tsx',import.meta.url),'utf8');
const module={exports:{} as {NotificationBell:React.ComponentType<any>}};
runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{
  module,exports:module.exports,window,document,Node:HostNode,navigator:{onLine:true},crypto:webcrypto,Event,console,
  require(name:string){
    if(name==='react')return React;
    if(name==='react/jsx-runtime')return require('react/jsx-runtime');
    if(name==='../language')return language;
    if(name==='../format')return format;
    if(name==='../LazyPage')return boundaries;
    if(name==='./member-inbox')return inbox;
    if(name==='../../../../modules/member-communications/types')return noticeTypes;
    if(name.endsWith('.css'))return {};
    throw new Error(`Unexpected Bell dependency ${name}`);
  },
});
const idA='10000000-0000-4000-8000-000000000001',idB='10000000-0000-4000-8000-000000000002';
const readAt='2026-11-04T00:01:00Z';
const notice=(id=idA,read=false)=>({notification_id:id,title:id===idA?'Notice A':'Notice B',body:'Synthetic notice',created_at:'2026-11-04T00:00:00Z',read_at:read?readAt:null,action:{tab:id===idA?'guilds':'squads',resource_id:null}});
const ack=(id=idA)=>({notification_id:id,read_at:readAt});
const payload=(items:ReturnType<typeof notice>[],count=items.filter(item=>!item.read_at).length)=>({items,unread_count:count});
type Call={method:'GET'|'POST';path:string;body?:unknown;options:any;resolve:(value:unknown)=>void;reject:(reason:Error)=>void};
function fixture(t:TestContext,initial=[notice(),notice(idB)]){
  const calls:Call[]=[],navigations:any[]=[];
  const makeClient=()=>({sessionGeneration:1,
    get:(path:string,options:any)=>new Promise((resolve,reject)=>calls.push({method:'GET',path,options,resolve,reject})),
    post:(path:string,body:unknown,options:any)=>new Promise((resolve,reject)=>calls.push({method:'POST',path,body,options,resolve,reject})),
  });
  let client=makeClient(),mounted=true;
  const container=document.createElement('div');document.body.appendChild(container);
  const root=createRoot(container as unknown as HTMLElement),onNavigate=(action:any)=>navigations.push(action);
  const render=()=>flush(()=>root.render(React.createElement(module.exports.NotificationBell,{client,onNavigate,preferencesEnabled:false})));
  const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};
  t.after(async()=>{unmount();await React.act(async()=>{for(const call of calls)call.resolve({});await new Promise(resolve=>setImmediate(resolve));});});render();
  const find=(predicate:(n:HostNode)=>boolean)=>descendants(container).find(predicate);
  const bell=()=>find(n=>n.nodeName==='BUTTON'&&n.getAttribute('class')?.includes('notification-bell-trigger'))!;
  const row=(id=idA)=>find(n=>n.nodeName==='BUTTON'&&n.getAttribute('class')?.includes('notification-bell-item')&&n.textContent.includes(id===idA?'Notice A':'Notice B'));
  const button=(label:string)=>find(n=>n.nodeName==='BUTTON'&&n.textContent===label);
  const alert=()=>find(n=>n.getAttribute('class')==='notification-bell-read-error');
  const click=(node:HostNode|undefined)=>{
    assert(node,'the production control must be rendered');
    assert.notEqual(props(node).disabled,true,'never activate a disabled production control');
    assert.notEqual(props(node)['aria-disabled'],true,'never activate an aria-disabled production control');
    let parent:HostNode|null=node;
    while(parent){assert.notEqual(props(parent)?.hidden,true,'never activate a hidden production control');parent=parent.parentNode;}
    flush(()=>props(node).onClick());
  };
  const finish=async(call:Call,value:unknown,reject=false)=>{await React.act(async()=>{if(reject)call.reject(value as Error);else call.resolve(value);await new Promise(resolve=>setImmediate(resolve));});};
  const get=()=>calls.at(-1)!;
  const ready=async()=>{assert.equal(get().method,'GET');await finish(get(),payload(initial));};
  const open=async(items=initial)=>{assert.equal(props(bell())['aria-expanded'],false);click(bell());assert.equal(get().method,'GET');await finish(get(),payload(items));};
  const post=()=>{assert.equal(get().method,'POST');return get();};
  const refresh=async(items=initial)=>{flush(()=>window.dispatchEvent(new Event('focus')));assert.equal(get().method,'GET');await finish(get(),payload(items));};
  const count=()=>calls.filter(call=>call.method==='POST').length;
  const assertBusy=()=>{
    assert.equal(props(row(idA)!).disabled,true);
    assert.equal(props(row(idB)!).disabled,true,'B must be unavailable while the shared command is pending');
    assert(row(idA)!.textContent.endsWith('標記中…'),'only the active row names the pending action');
    assert(row(idB)!.textContent.endsWith('未讀'));
    assert.equal(props(button('全部標為已讀')!).disabled,true);
    assert.equal(navigations.length,0);
  };
  return {calls,navigations,client:()=>client,replaceClient(){client=makeClient();render();},render,unmount,container,bell,row,button,alert,click,finish,get,ready,open,post,refresh,count,assertBusy};
}

for(const readB of [false,true])test(`one pending read disables all preview rows, including read B=${readB}`,async t=>{
  const items=[notice(),notice(idB,readB)],h=fixture(t,items);await h.ready();await h.open();
  assert.equal(h.count(),0,'opening the bell never marks all read');h.click(h.row());const write=h.post();
  assert.equal(props(h.row()!).disabled,true);assert.equal(props(h.row(idB)!).disabled,true);assert(h.row()!.textContent.endsWith('標記中…'));assert(h.row(idB)!.textContent.endsWith(readB?'已讀':'未讀'));
  assert.equal(props(h.button('全部標為已讀')!).disabled,true);assert.equal(h.count(),1);assert.equal(h.navigations.length,0);
  assert.equal(write.path,`/me/notifications/${idA}/read`);assert.equal(JSON.stringify(write.body),'{}');
  await h.finish(write,ack());assert.deepEqual(h.navigations,[{tab:'guilds',resource_id:null}]);
  await h.finish(h.get(),payload([notice(idA,true),notice(idB,readB)]));assert.equal(h.count(),1,'B was neither queued nor written');
  await h.open([notice(idA,true),notice(idB,readB)]);assert.equal(props(h.row(idB)!).disabled,false);
  h.click(h.row(idB));
  if(!readB){const second=h.post();assert.equal(second.path,`/me/notifications/${idB}/read`);assert.notEqual(second.options.idempotencyKey,write.options.idempotencyKey);await h.finish(second,ack(idB));await h.finish(h.get(),payload([notice(idA,true),notice(idB,true)]));}
  assert.equal(h.count(),readB?1:2);assert.deepEqual(h.navigations,[{tab:'guilds',resource_id:null},{tab:'squads',resource_id:null}]);
});

for(const outcome of ['lost','missing','bad-date','wrong-id'] as const)test(`${outcome} acknowledgement releases busy but retains the original exact-item retry`,async t=>{
  const h=fixture(t);await h.ready();await h.open();h.click(h.row());const first=h.post();h.assertBusy();
  const invalid={missing:null,'bad-date':{...ack(),read_at:'invalid'},'wrong-id':ack(idB)};
  await h.finish(first,outcome==='lost'?new Error('Synthetic lost ACK'):invalid[outcome],outcome==='lost');
  assert(h.alert());assert.equal(h.bell().getAttribute('aria-label'),'通知，2 則未讀');assert.deepEqual(h.navigations,[{tab:'guilds',resource_id:null}]);
  assert.equal(props(h.button('再試一次')!)['aria-disabled'],false);await h.open();assert.equal(props(h.row()!).disabled,false);assert.equal(props(h.row(idB)!).disabled,false);
  h.click(h.button('再試一次'));const retry=h.post();assert.equal(retry.path,first.path);assert.equal(retry.options.idempotencyKey,first.options.idempotencyKey);assert.deepEqual(retry.body,first.body);
  assert.equal(props(h.row()!).disabled,true);assert.equal(props(h.row(idB)!).disabled,true);assert(h.row()!.textContent.endsWith('標記中…'));assert(h.alert(),'the pending retry control remains visible');
  await h.finish(retry,ack());await h.finish(h.get(),payload([notice(idA,true),notice(idB)]));
  assert.equal(Boolean(h.alert()),false);assert.equal(props(h.row()!).disabled,false);assert.equal(props(h.row(idB)!).disabled,false);assert.equal(h.bell().getAttribute('aria-label'),'通知，1 則未讀');
  assert.equal(h.count(),2);assert.deepEqual(h.navigations,[{tab:'guilds',resource_id:null}],'retry never navigates again or opens B');
});

test('unknown A does not prevent a new explicit B command or cause any automatic A retry',async t=>{
  const h=fixture(t);await h.ready();await h.open();h.click(h.row());const a=h.post();await h.finish(a,new Error('lost'),true);
  await h.open();assert(h.alert());assert.equal(props(h.row(idB)!).disabled,false);h.click(h.row(idB));const b=h.post();
  assert.equal(b.path,`/me/notifications/${idB}/read`);assert.notEqual(b.options.idempotencyKey,a.options.idempotencyKey);assert.equal(h.count(),2);
  await h.finish(b,ack(idB));await h.finish(h.get(),payload([notice(),notice(idB,true)]));
  assert.deepEqual(h.navigations,[{tab:'guilds',resource_id:null},{tab:'squads',resource_id:null}]);assert.equal(h.count(),2);
  await h.open([notice(),notice(idB,true)]);h.click(h.row());const retry=h.post();assert.equal(retry.path,a.path);assert.equal(retry.options.idempotencyKey,a.options.idempotencyKey,'A retains its unknown intent even after its alert was dismissed by choosing B');
  await h.finish(retry,ack());await h.finish(h.get(),payload([notice(idA,true),notice(idB,true)]));assert.equal(h.count(),3);
});

for(const pendingRetry of [false,true])test(`fresh proof of unknown A does not queue B; retry pending=${pendingRetry}`,async t=>{
  const h=fixture(t);await h.ready();await h.open();h.click(h.row());await h.finish(h.post(),new Error('lost'),true);await h.open();
  let retry:Call|undefined;
  if(pendingRetry){h.click(h.button('再試一次'));retry=h.post();assert.equal(props(h.row(idB)!).disabled,true);}
  await h.refresh([notice(idA,true),notice(idB)]);assert.equal(Boolean(h.alert()),false);assert.equal(h.bell().getAttribute('aria-label'),'通知，1 則未讀');
  assert.equal(props(h.row(idB)!).disabled,pendingRetry,'server read proof does not release a still-pending transport lock');
  if(retry)await h.finish(retry,new Error('late retry failure'),true);
  assert.equal(props(h.row(idB)!).disabled,false);assert.equal(Boolean(h.alert()),false);assert.equal(h.count(),pendingRetry?2:1);assert.deepEqual(h.navigations,[{tab:'guilds',resource_id:null}]);
});

test('a fresh proof while initial A is still pending retains the lock until its outcome',async t=>{
  const h=fixture(t);await h.ready();await h.open();h.click(h.row());const write=h.post();await h.refresh([notice(idA,true),notice(idB)]);
  assert.equal(props(h.row(idB)!).disabled,true);assert.equal(h.navigations.length,0);await h.finish(write,new Error('lost but proven'),true);
  assert.equal(Boolean(h.alert()),false);assert.deepEqual(h.navigations,[{tab:'guilds',resource_id:null}]);assert.equal(h.count(),1);
});

test('already-read A navigates without a command or a lingering disabled state',async t=>{
  const h=fixture(t,[notice(idA,true),notice(idB)]);await h.ready();await h.open([notice(idA,true),notice(idB)]);h.click(h.row());
  assert.equal(h.count(),0);assert.deepEqual(h.navigations,[{tab:'guilds',resource_id:null}]);await h.open([notice(idA,true),notice(idB)]);assert.equal(props(h.row(idB)!).disabled,false);assert.equal(props(h.button('全部標為已讀')!).disabled,false);
});

test('closing and reopening preserves which row is pending and does not start another command',async t=>{
  const h=fixture(t);await h.ready();await h.open();h.click(h.row());const write=h.post();h.click(h.bell());await h.open();h.assertBusy();assert.equal(h.count(),1);
  await h.finish(write,ack());await h.finish(h.get(),payload([notice(idA,true),notice(idB)]));assert.equal(h.count(),1);assert.deepEqual(h.navigations,[{tab:'guilds',resource_id:null}]);
});

for(const boundary of ['session','client','unmount'] as const)for(const success of [false,true])test(`late A outcome cannot affect ${boundary}, success=${success}`,async t=>{
  const h=fixture(t);await h.ready();await h.open();h.click(h.row());const old=h.post();h.assertBusy();
  if(boundary==='unmount')h.unmount();else if(boundary==='session'){h.client().sessionGeneration++;h.render();}else h.replaceClient();
  if(boundary!=='unmount'){await h.ready();assert.equal(props(h.row(idB)!).disabled,false);h.click(h.row(idB));assert.equal(props(h.row(idB)!).disabled,true);}
  const current=h.get(),before=h.calls.length;await h.finish(old,success?ack():new Error('old account lost'),!success);
  assert.equal(h.calls.length,before);assert.equal(h.navigations.length,0);assert.equal(Boolean(h.alert()),false);
  if(boundary!=='unmount'){assert.equal(props(h.row(idB)!).disabled,true,'old finally cannot release the new command');await h.finish(current,ack(idB));await h.finish(h.get(),payload([notice(),notice(idB,true)]));assert.deepEqual(h.navigations,[{tab:'squads',resource_id:null}]);}
});

for(const success of [true,false])test(`mark-all keeps all preview rows unavailable until it settles, success=${success}`,async t=>{
  const h=fixture(t);await h.ready();await h.open();h.click(h.button('全部標為已讀'));const all=h.post();
  assert.equal(all.path,'/me/inbox/read-all');assert.deepEqual(all.body,{scope:'notifications'});assert.equal(props(h.row()!).disabled,true);assert.equal(props(h.row(idB)!).disabled,true);assert.equal(h.navigations.length,0);
  await h.finish(all,success?{notifications_updated:2,direct_messages_updated:0,channels_updated:0}:new Error('bulk unavailable'),!success);
  if(success)await h.finish(h.get(),payload([notice(idA,true),notice(idB,true)]));
  assert.equal(props(h.row()!).disabled,false);assert.equal(props(h.row(idB)!).disabled,false);assert.equal(h.navigations.length,0);assert.equal(h.count(),1);
});
