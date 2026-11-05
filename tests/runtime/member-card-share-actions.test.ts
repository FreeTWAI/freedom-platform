import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
import {ApiError} from '../../apps/portal-web/src/api';
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
const scheduled = new Map<number,Function>();let nextTimer=0;
const window = {location:{origin:'https://fixture.invalid'},setTimeout(fn:Function){const id=++nextTimer;scheduled.set(id,fn);return id;},clearTimeout(id:number){scheduled.delete(id);},open(){throw Error('No external navigation permitted');},document, HTMLElement: HostNode, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {}, get event() {return undefined;}};
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
const base = fileURLToPath(new URL('../../',import.meta.url));
const effects:{copies:string[];shares:any[]}={copies:[],shares:[]};
const navigator={clipboard:{async writeText(value:string){effects.copies.push(value);}},async share(value:any){effects.shares.push(value);}};
const descendants=(node:HostNode):HostNode[]=>[node,...node.childNodes.flatMap(descendants)];
const props=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
const modules=new Map<string,any>();
function compile(relative:string):any{
 const file=path.resolve(base,relative);if(modules.has(file))return modules.get(file);
 const module={exports:{} as any};modules.set(file,module.exports);
 const raw=readFileSync(file,'utf8');
 runInNewContext(transformSync(raw,{loader:relative.endsWith('.tsx')?'tsx':'ts',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,crypto:webcrypto,Intl,URL,Error,setTimeout,clearTimeout,window,document,navigator,console,fetch(){throw Error('No real network permitted');},require(name:string){
 if(name==='react')return React;
 if(name==='react/jsx-runtime')return require(name);
 if(name==='../api')return {ApiError};
 if(name.endsWith('.css'))return {};
 if(name.startsWith('.')){
  const resolved=path.resolve(path.dirname(file),name);const target=[resolved,resolved+'.ts',resolved+'.tsx'].find(existsSync);assert(target,`missing dependency ${name}`);return compile(path.relative(base,target));
 }
 if(name==='qrcode')return require(name);
 throw Error('Unexpected dependency: '+name);
 }});modules.set(file,module.exports);return module.exports;
}
const {MemberShare}=compile('apps/portal-web/src/modules/MemberShare.tsx');
const {MemberCardShareActions}=compile('apps/portal-web/src/modules/MemberCardShareActions.tsx');
const ID='30000000-0000-4000-8000-000000000001',OTHER='30000000-0000-4000-8000-000000000002';
const profile={source:'contact:github',platform:'github',label:'GitHub',handle:'fixture',url:'https://example.invalid/fixture',shown:true};
const initialSettings=()=>({enabled:true,include_avatar:false,aggregate_version:1,share_path:'/member-cards/'+'a'.repeat(43),design:'calm',headline:'已保存的介紹',links:[],show_profile_links:true,profile_link_prefs:{},profile_links:[{...profile}]});
// This is a minimal DOM-shaped host for real React/ReactDOM, not a browser.
// It invokes only handlers on mounted, enabled, visible controls and enforces modal containment.
// Transport, clipboard, system sharing, timers and navigation are local fakes.
function fixture(t:TestContext){
 const requests:any[]=[],container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);
 const transport=(method:string)=>(url:string,body?:any,options?:any)=>new Promise((resolve,reject)=>requests.push({method,path:url,body,options,resolve,reject}));
 const client={sessionGeneration:1,get:transport('GET'),post:transport('POST')};
 let activeClient=client,key='owner:1',mounted=true;
 const render=(next=activeClient,nextKey=key)=>{activeClient=next;key=nextKey;flush(()=>root.render(React.createElement(MemberShare,{client:activeClient,key})));};
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};t.after(()=>{unmount();scheduled.clear();effects.copies=[];effects.shares=[];});
 render();
 const all=(f:(n:HostNode)=>boolean)=>descendants(container).filter(f),find=(f:(n:HostNode)=>boolean)=>all(f)[0];
 const button=(text:string)=>find(n=>n.nodeName==='BUTTON'&&n.textContent===text)!;
 const assertReachable=(node:HostNode)=>{assert(node,'node exists');assert(container.contains(node),'node is in current rendered tree');assert(!props(node).disabled,'node is enabled');for(let n:HostNode|null=node;n;n=n.parentNode){assert(!props(n)?.hidden,'node ancestor is not hidden');if(n.nodeName==='DIALOG')assert(n.open,'dialog is open');}const modal=find(n=>n.nodeName==='DIALOG'&&n.open);if(modal)assert(modal.contains(node),'cannot interact behind modal');};
 const click=(node:HostNode)=>{assertReachable(node);assert(['BUTTON','A'].includes(node.nodeName));let prevented=false;flush(()=>props(node).onClick?.({preventDefault(){prevented=true;}}));return prevented;};
 const input=()=>find(n=>n.nodeName==='INPUT'&&n.getAttribute('placeholder')==='例如：做開源的人')!;
 const headline=(value:string)=>{const node=input();assertReachable(node);flush(()=>props(node).onChange({target:{value}}));};
 const blur=()=>{const node=input();assertReachable(node);flush(()=>props(node).onBlur());};
 const check=(label:string,checked:boolean)=>{const node=find(n=>n.nodeName==='INPUT'&&n.getAttribute('aria-label')===label)!;assertReachable(node);flush(()=>props(node).onChange({target:{checked}}));};
 const settle=async(request:any,value:any,reject=false)=>{await React.act(async()=>{request[reject?'reject':'resolve'](value);await new Promise(r=>setImmediate(r));});};
 const pending=(method:string,url:string)=>requests.filter(r=>r.method===method&&r.path===url);
 const start=async(settings=initialSettings(),id=ID,failPreview=false)=>{
   await settle(pending('GET','/me/member-card-share').at(-1),settings);
   await settle(pending('GET','/me/account').at(-1),failPreview?new ApiError({status:503,message:'Preview unavailable'}):{user_id:id,nickname:'合成會員',avatar:{avatar_url:null}},failPreview);
   if(!failPreview){await settle(pending('GET',`/members/${id}`).at(-1),{nickname:id===ID?'合成會員':'新會員',primary_guild:{name:'合成公會'},capabilities:[],avatar_url:null});await settle(pending('GET','/assessment-definition').at(-1),{capability_categories:[]});}
 };
 const openLink=()=>find(n=>n.nodeName==='A'&&n.getAttribute('class')==='btn btn-ghost'&&n.getAttribute('href')?.includes('/member-cards/'))!;
 const status=()=>find(n=>n.getAttribute('class')==='ecard-save-status')!.textContent;
 const state=()=>({status:status(),headline:props(input()).value,downloadDisabled:!!props(button('下載名片 PNG')).disabled,openDisabled:openLink().getAttribute('aria-disabled')==='true',shareDisabled:!!props(button('分享名片')).disabled,promotionRequests:pending('POST','/promotion/links').length,copies:effects.copies.length,shares:effects.shares.length});
 const share=async(kind:'copy'|'share'='copy')=>{
  click(button('分享名片'));const req=pending('POST','/promotion/links').at(-1);assert(req);assert.equal(JSON.stringify(req.body),JSON.stringify({kind:'member_card',target:activeClient===client?ID:OTHER}));
  await settle(req,{path:'/go/fixture123',points:{week:0,all:0}});click(button(kind==='copy'?'複製連結':'分享'));await React.act(async()=>{await new Promise(r=>setImmediate(r));});return req;
 };
 const close=()=>click(find(n=>n.nodeName==='BUTTON'&&n.getAttribute('aria-label')==='關閉分享')!);
 return{client,requests,container,render,unmount,all,find,button,click,input,headline,blur,check,settle,pending,start,openLink,status,state,share,close};
}
function assertShareBlocked(h:ReturnType<typeof fixture>){
 const button=h.button('分享名片');assert(button);assert.equal(props(button).disabled,true);assert.equal(props(button).onClick,undefined);
 assert.equal(h.all(n=>n.nodeName==='DIALOG').length,0,'blocked wrapper does not mount sharing dialog');assert.equal(h.pending('POST','/promotion/links').length,0);assert.equal(effects.copies.length,0);assert.equal(effects.shares.length,0);
}
function preview(h:ReturnType<typeof fixture>){return h.find(n=>n.nodeName==='ARTICLE'&&(n.getAttribute('class')??'').split(' ').includes('ecard'))!;}
test('a saved card retains the full promotion dialog, copy and system-share flow',async t=>{
 const h=fixture(t);await h.start();assert(!h.state().downloadDisabled&&!h.state().openDisabled&&!h.state().shareDisabled);await h.share();
 assert.deepEqual(effects.copies,['一起加入自由工坊，找到夥伴、學習與創作。\nhttps://fixture.invalid/go/fixture123']);h.close();assert.equal(document.activeElement,h.button('分享名片'));await h.share('share');assert.equal(effects.shares.length,1);assert.equal(effects.shares[0].url,'https://fixture.invalid/go/fixture123');assert.equal(h.pending('POST','/me/member-card-share').length,0);
});
test('headline changes block sharing immediately, before debounce or blur sends any save',async t=>{
 const h=fixture(t);await h.start();h.headline('尚未保存的新介紹');assert(h.status().includes('尚未儲存'));assert.equal(h.pending('POST','/me/member-card-share').length,0);assert.equal(scheduled.size,1);assertShareBlocked(h);assert(preview(h).textContent.includes('尚未保存的新介紹'));
});
for(const change of ['headline','profile-field'])test(`${change}: pending save blocks sharing without changing the queued save`,async t=>{
 const h=fixture(t);await h.start();if(change==='headline'){h.headline('尚未保存的新介紹');h.blur();assert(preview(h).textContent.includes('尚未保存的新介紹'));}else{h.check('顯示 GitHub 在名片上',false);assert(!preview(h).textContent.includes('GitHub'));}
 const save=h.pending('POST','/me/member-card-share')[0];assert(save);assert(h.status().includes('儲存中'));assert(h.state().downloadDisabled&&h.state().openDisabled);assert(h.click(h.openLink()),'existing open action still prevents navigation');assertShareBlocked(h);assert.equal(h.pending('POST','/me/member-card-share').length,1);assert.equal(save.body.enabled,true);assert.equal(save.body.rotate,false);
 await h.settle(save,{...initialSettings(),...save.body,profile_links:change==='profile-field'?[{...profile,shown:false}]:[{...profile}],aggregate_version:2});assert(!h.state().shareDisabled);await h.share();assert.equal(effects.copies.length,1);
});
for(const change of ['headline','profile-field'])test(`${change}: known rejection stays blocked until an explicit retry succeeds`,async t=>{
 const h=fixture(t);await h.start();if(change==='headline'){h.headline('尚未保存的新介紹');h.blur();}else h.check('顯示 GitHub 在名片上',false);
 await h.settle(h.pending('POST','/me/member-card-share')[0],new ApiError({status:422,message:'設定未保存（合成已知拒絕）'}),true);
 assert(h.status().includes('設定未保存'));assert(h.state().downloadDisabled&&h.state().openDisabled);assertShareBlocked(h);assert.equal(h.pending('POST','/me/member-card-share').length,1);
 h.click(h.button('重試'));assertShareBlocked(h);const retry=h.pending('POST','/me/member-card-share')[1];assert(retry);await h.settle(retry,{...initialSettings(),...retry.body,aggregate_version:2});assert(h.status().includes('已自動儲存'));await h.share('share');assert.equal(effects.shares.length,1);
});
test('an older save ACK cannot reopen sharing while the newer visible headline is still pending',async t=>{
 const h=fixture(t);await h.start();h.headline('先改內容');h.blur();const first=h.pending('POST','/me/member-card-share')[0];h.headline('最後內容');assertShareBlocked(h);
 await h.settle(first,{...initialSettings(),...first.body,aggregate_version:2});assert.equal(props(h.input()).value,'最後內容');assertShareBlocked(h);const second=h.pending('POST','/me/member-card-share')[1];assert(second);assert.equal(second.body.headline,'最後內容');
 await h.settle(second,{...initialSettings(),...second.body,aggregate_version:3});assert(h.status().includes('已自動儲存'));await h.share();
});
test('an invalid headline blocks sharing without sending a save and recovers after correction',async t=>{
 const h=fixture(t);await h.start();h.headline('字'.repeat(61));h.blur();assert.equal(h.pending('POST','/me/member-card-share').length,0);assert.equal(scheduled.size,0);assert(h.container.textContent.includes('一句話介紹最多 60 個字。'));assertShareBlocked(h);
 h.headline('有效介紹');h.blur();assertShareBlocked(h);const save=h.pending('POST','/me/member-card-share')[0];await h.settle(save,{...initialSettings(),...save.body,aggregate_version:2});await h.share();assert.equal(effects.copies.length,1);
});
test('missing preview target cannot share, even when settings are saved',async t=>{
 const h=fixture(t);await h.start(initialSettings(),ID,true);assertShareBlocked(h);assert(h.state().downloadDisabled);
});
test('close and reopen after a confirmed save discards old link responses',async t=>{
 const h=fixture(t);await h.start();h.click(h.button('分享名片'));const old=h.pending('POST','/promotion/links')[0];h.close();await h.settle(old,{path:'/go/old-closed',points:{week:0,all:0}});assert(!h.container.textContent.includes('/go/old-closed'));assert.equal(effects.copies.length,0);
 await h.share();assert.equal(h.pending('POST','/promotion/links').length,2);assert.equal(effects.copies.length,1);
});
test('editor remount rereads stored settings rather than retaining a rejected draft',async t=>{
 const h=fixture(t);await h.start();h.headline('失敗的草稿');h.blur();await h.settle(h.pending('POST','/me/member-card-share')[0],new ApiError({status:422,message:'已知拒絕'}),true);assertShareBlocked(h);
 h.render(h.client,'editor-reopened');await h.start();assert.equal(props(h.input()).value,'已保存的介紹');assert(!h.state().downloadDisabled&&!h.state().openDisabled);await h.share();
});
for(const replacementKind of ['client','session'])test(`keyed ${replacementKind} replacement drops the old draft and ignores its late ACK`,async t=>{
 const h=fixture(t);await h.start();h.headline('舊內容');h.blur();assertShareBlocked(h);const old=h.pending('POST','/me/member-card-share')[0];h.client.sessionGeneration++;
 const transport=(method:string)=>(url:string,body?:any,options?:any)=>new Promise((resolve,reject)=>h.requests.push({method,path:url,body,options,resolve,reject}));
 const replacement=replacementKind==='client'?{sessionGeneration:2,get:transport('GET'),post:transport('POST')}:h.client;
 h.render(replacement,'owner:2');const id=replacementKind==='client'?OTHER:ID;await h.start({...initialSettings(),headline:'目前已保存內容',share_path:'/member-cards/'+'b'.repeat(43)},id);
 await h.settle(old,{...initialSettings(),headline:'舊內容',aggregate_version:2});assert.equal(props(h.input()).value,'目前已保存內容');await h.share();assert.equal(h.pending('POST','/promotion/links').at(-1).body.target,id);
});
test('unmount during a pending save has no promotion side effects after the late response',async t=>{
 const h=fixture(t);await h.start();h.headline('離頁前內容');h.blur();assertShareBlocked(h);const save=h.pending('POST','/me/member-card-share')[0];h.unmount();await h.settle(save,{...initialSettings(),...save.body,aggregate_version:2});assert.equal(h.container.childNodes.length,0);assert.equal(h.pending('POST','/promotion/links').length,0);assert.equal(effects.copies.length,0);assert.equal(effects.shares.length,0);
});
test('unmount during promotion loading does not copy or share its late link',async t=>{
 const h=fixture(t);await h.start();h.click(h.button('分享名片'));const link=h.pending('POST','/promotion/links')[0];h.unmount();await h.settle(link,{path:'/go/late-link',points:{week:0,all:0}});assert.equal(h.container.childNodes.length,0);assert.equal(effects.copies.length,0);assert.equal(effects.shares.length,0);
});
for(const flags of [{pending:true,blocked:false},{pending:false,blocked:true},{pending:true,blocked:true},{pending:false,blocked:false}])test(`wrapper honors pending=${flags.pending} and blocked=${flags.blocked} independently`,t=>{
 const writes:any[]=[];const client={post:(...args:any[])=>{writes.push(args);return new Promise(()=>{});}};
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);t.after(()=>{flush(()=>root.unmount());document.body.removeChild(container);});
 flush(()=>root.render(React.createElement(MemberCardShareActions,{client,target:ID,title:'名片',url:'https://fixture.invalid/member-cards/'+'a'.repeat(43),...flags})));
 const button=descendants(container).find(n=>n.nodeName==='BUTTON'&&n.textContent==='分享名片')!;assert(button);
 const inactive=flags.pending||flags.blocked;assert.equal(!!props(button).disabled,inactive);
 if(inactive){assert.equal(props(button).onClick,undefined);assert.equal(descendants(container).some(n=>n.nodeName==='DIALOG'),false);assert.equal(writes.length,0);}else{assert.equal(props(button).disabled,undefined);flush(()=>props(button).onClick());assert.equal(writes.length,1);assert.equal(writes[0][0],'/promotion/links');}
});
