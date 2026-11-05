import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
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
  style: Record<string, any> = {setProperty() {}, removeProperty() {}};
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
HostNode.prototype.querySelector=function(selector:string){assert.match(selector,/^\.[a-z-]+$/);return descendants(this).find(n=>(n.attributes.class??'').split(' ').includes(selector.slice(1)))??null;};
HostNode.prototype.hasAttribute=function(key:string){return Object.hasOwn(this.attributes,key);};
HostNode.prototype.dispatchEvent=function(event:any){
  event.target??=this;event.bubbles??=true;event.cancelBubble=false;event.defaultPrevented=false;
  event.preventDefault=()=>{event.defaultPrevented=true;};event.stopPropagation=()=>{event.cancelBubble=true;};
  const chain:HostNode[]=[];for(let n:HostNode|null=this;n;n=n.parentNode)chain.push(n);
  for(const n of [...chain].reverse()){event.currentTarget=n;for(const l of n.listeners[event.type]??[])if(l.capture)l.fn(event);if(event.cancelBubble)return !event.defaultPrevented;}
  for(const n of chain){event.currentTarget=n;for(const l of n.listeners[event.type]??[])if(!l.capture)l.fn(event);if(event.cancelBubble||!event.bubbles)break;}
  event.currentTarget=null;return !event.defaultPrevented;
};
const effects={toBlob:[] as any[],urls:[] as any[],downloads:[] as any[],revoked:[] as string[]};
const events:any[]=[];
HostNode.prototype.click=function(){assert.equal(this.nodeName,'A');assert.equal(this.download,'freedom-workshop-card.png');assert.match(this.href,/^blob:fixture-/);effects.downloads.push({href:this.href,download:this.download});events.push({event:'anchor-download',href:this.href});};
class FakeURL extends URL{
 static createObjectURL(blob:any){const url=`blob:fixture-${effects.urls.length+1}`;effects.urls.push({url,blob});return url;}
 static revokeObjectURL(url:string){effects.revoked.push(url);}
}
const noNetwork=()=>{throw Error('Real network forbidden');};
const navigator={language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork},share:noNetwork};
document.visibilityState='visible';document.fonts={ready:Promise.resolve()};
const base=fileURLToPath(new URL('../../',import.meta.url));
// Bundle unmodified production sources, allowing esbuild's normal tree shaking of unused
// exports. PublicMemberPage, MemberCardDownload, MemberECard, Membership.loadLabels,
// Membership.MemberCard, QR, avatar, report/social-link render dependencies remain real.
// Only the browser host, injected transport, font readiness and raster/download sinks are fake.
const bundled=buildSync({stdin:{contents:"export {PublicMemberPage} from './apps/portal-web/src/modules/PublicMemberPage'; export {MemberCardDownload} from './apps/portal-web/src/modules/MemberCardDownload'; export {MemberECard} from './apps/portal-web/src/modules/MemberECard';",resolveDir:base,loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},supported:{'dynamic-import':false}});
const production={exports:{} as any};
runInNewContext(bundled.outputFiles[0].text,{module:production,exports:production.exports,crypto:webcrypto,Intl,URL:FakeURL,URLSearchParams,Error,Event,Blob,console,window,document,navigator,fetch:noNetwork,localStorage:{getItem(){return null;},setItem:noNetwork},setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),require(name:string){
 if(name==='html-to-image')return {toBlob(node:any,options:any){events.push({event:'toBlob-start',text:node.textContent});return new Promise((resolve,reject)=>effects.toBlob.push({node,options,resolve,reject}));}};
 return require(name);
}});
const {PublicMemberPage,MemberCardDownload,MemberECard}=production.exports;
const TOKEN='a'.repeat(43),TOKEN_B='b'.repeat(43),OWNER='30000000-0000-4000-8000-000000000001',PEER='30000000-0000-4000-8000-000000000002';
const publicCard=()=>({nickname:'合成名片作者',primary_guild:{name:'活動公會',guild_key:'events'},capabilities:['公開專長'],avatar_url:null,design:'editorial',headline:'已保存的公開介紹',links:[],profile_links:[]});
const privateCard=()=>({user_id:PEER,nickname:'合成名片作者',primary_guild:{name:'活動公會',guild_key:'events'},secondary_guilds:[],capabilities:['skill-id'],equipment:[],contacts:{},is_self:false,positioning_title:null,is_online:false,last_seen_at:null,friendship:{state:'none'}});
const definition=()=>({capability_categories:[{id:'skills',label:'專長',options:[{id:'skill-id',label:'晚到會員標籤'}]}],equipment_categories:[]});
const settle=async(fn:()=>void)=>{await React.act(async()=>{fn();await new Promise(r=>setImmediate(r));});};
const snapshot=(node:HostNode):any=>({type:node.nodeName,attributes:{...node.attributes},text:node.nodeType===3?node.nodeValue:undefined,children:node.childNodes.map(snapshot)});
function fixture(t:TestContext,{guest=false,self=false}={}){
 const requests:any[]=[],container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);let mounted=true;
 const transport=(method:string)=>(url:string,body?:any,options?:any)=>new Promise((resolve,reject)=>{requests.push({method,path:url,body,options,resolve,reject,settled:false});events.push({event:'request-start',method,path:url});});
 const client={sessionGeneration:1,get:transport('GET'),post:transport('POST')};
 let current={client,token:TOKEN,session:guest?undefined:{user:{user_id:OWNER}},onLogin(){},onReturn(){},onEdit(){}};
 const render=(change:any={})=>{current={...current,...change};flush(()=>root.render(React.createElement(PublicMemberPage,current)));};
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;events.push({event:'unmount'});}};
 t.after(()=>{assert(requests.every(r=>r.method==='GET'),'no mutation request');unmount();scheduled.clear();Object.values(effects).forEach(v=>v.length=0);events.length=0;document.fonts.ready=Promise.resolve();document.visibilityState='visible';});
 const all=(predicate:(n:HostNode)=>boolean)=>descendants(container).filter(predicate);
 const find=(predicate:(n:HostNode)=>boolean)=>all(predicate)[0];
 const button=(text:string)=>find(n=>n.nodeName==='BUTTON'&&n.textContent===text);
 const click=(node:HostNode|undefined)=>{assert(node,'control exists');assert(container.contains(node),'control mounted');assert.equal(node.nodeName,'BUTTON');assert(!node.hasAttribute('disabled'),'control enabled');for(let n:HostNode|null=node;n;n=n.parentNode){assert(!n.hasAttribute('hidden'),'not hidden');assert.notEqual(n.style.display,'none');assert.notEqual(n.style.visibility,'hidden');}events.push({event:'click',text:node.textContent});flush(()=>node.dispatchEvent({type:'click',bubbles:true,button:0}));};
 const pending=(url:string)=>requests.filter(r=>r.path===url&&!r.settled);
 const resolve=async(r:any,value:any)=>{assert(r,'request exists');assert(!r.settled,'request unresolved');r.settled=true;events.push({event:'request-resolve',path:r.path});await settle(()=>r.resolve(value));};
 const reject=async(r:any,error:any)=>{assert(r,'request exists');r.settled=true;await settle(()=>r.reject(error));};
 const start=async(card=publicCard())=>{await resolve(pending(`/public/member-cards/${TOKEN}`)[0],card);if(!guest)await resolve(pending(`/member-cards/${TOKEN}/member`)[0],{...privateCard(),is_self:self});assert(button('下載名片 PNG'));assert(!button('下載名片 PNG')!.hasAttribute('disabled'));};
 const begin=async()=>{click(button('下載名片 PNG'));await settle(()=>{});assert.equal(effects.toBlob.length,1,'production click reaches toBlob');assert(button('正在產生圖片…')?.hasAttribute('disabled'));};
 const finish=async(index=0)=>{const call=effects.toBlob[index];assert(call);await settle(()=>call.resolve(new Blob(['synthetic-png'],{type:'image/png'})));};
 const publicNode=()=>container.querySelector('.ecard')!;

 render();return {client,container,requests,render,unmount,start,begin,finish,pending,resolve,reject,button,click,find,all,publicNode};
}

test('control: labels complete before click permits one successful public PNG sink',async t=>{
 const h=fixture(t);await h.start();await h.resolve(h.pending('/assessment-definition')[0],definition());await h.begin();await h.finish();assert.equal(effects.downloads.length,1);assert.equal(effects.urls.length,1);assert(h.container.textContent.includes('名片圖片已產生'));
});
test('labels completing mid-raster preserve the pending download of unchanged public data',async t=>{
 const h=fixture(t);await h.start();const labels=h.pending('/assessment-definition')[0];assert(labels);const node=h.publicNode();const before=snapshot(node);await h.begin();await h.resolve(labels,definition());assert.strictEqual(h.publicNode(),node);assert.deepEqual(snapshot(node),before,'public subtree bytes unchanged');assert(h.container.textContent.includes('晚到會員標籤'),'private labels really render');assert(h.button('正在產生圖片…')?.hasAttribute('disabled'),'download stays busy');await h.finish();assert.equal(effects.downloads.length,1);assert.equal(effects.urls.length,1);assert(h.container.textContent.includes('名片圖片已產生'));assert(!h.container.textContent.includes('圖片暫時無法下載'));
});
test('control: labels still pending when raster completes does not itself block download',async t=>{
 const h=fixture(t);await h.start();await h.begin();await h.finish();assert.equal(effects.downloads.length,1);assert.equal(h.pending('/assessment-definition').length,1);
});
test('control: guest page has no labels request and finishes normally',async t=>{
 const h=fixture(t,{guest:true});await h.start();assert.equal(h.pending('/assessment-definition').length,0);await h.begin();await h.finish();assert.equal(effects.downloads.length,1);
});
test('owner-view label completion preserves public download',async t=>{
 const h=fixture(t,{self:true});await h.start();await h.begin();await h.resolve(h.pending('/assessment-definition')[0],definition());assert(h.button('正在產生圖片…')?.hasAttribute('disabled'));await h.finish();assert.equal(effects.downloads.length,1);assert(h.container.textContent.includes('這是你的名片'));
});
test('unrelated parent render preserves the same public card and download',async t=>{
 const h=fixture(t);await h.start();await h.resolve(h.pending('/assessment-definition')[0],definition());const node=h.publicNode(),before=snapshot(node);await h.begin();h.render();assert.strictEqual(h.publicNode(),node);assert.deepEqual(snapshot(node),before);assert(h.button('正在產生圖片…')?.hasAttribute('disabled'));await h.finish();assert.equal(effects.downloads.length,1);
});
test('safety: genuine card refresh removes download during loading and rejects old output',async t=>{
 const h=fixture(t);await h.start();await h.begin();flush(()=>window.dispatchEvent({type:'focus'}));assert(!h.publicNode());assert(!h.button('下載名片 PNG'));assert(h.container.textContent.includes('正在開啟工坊名片'));await h.resolve(h.pending(`/public/member-cards/${TOKEN}`)[0],{...publicCard(),headline:'新的公開介紹'});await h.resolve(h.pending(`/member-cards/${TOKEN}/member`)[0],privateCard());assert(h.publicNode().textContent.includes('新的公開介紹'));await h.finish();assert.equal(effects.downloads.length,0);
});
test('safety: public read failure on refresh leaves no stale output',async t=>{
 const h=fixture(t);await h.start();await h.begin();flush(()=>window.dispatchEvent({type:'focus'}));await h.reject(h.pending(`/public/member-cards/${TOKEN}`)[0],new Error('分享已撤回'));await h.finish();assert.equal(effects.downloads.length,0);assert(!h.publicNode());assert(h.container.textContent.includes('暫時無法開啟這張名片'));
});
test('safety: token change rejects old output and renders only the new URL after reload',async t=>{
 const h=fixture(t);await h.start();await h.begin();h.render({token:TOKEN_B});assert(!h.publicNode());await h.resolve(h.pending(`/public/member-cards/${TOKEN_B}`)[0],publicCard());await h.resolve(h.pending(`/member-cards/${TOKEN_B}/member`)[0],privateCard());await h.finish();assert.equal(effects.downloads.length,0);assert.equal(h.find(n=>n.attributes.class==='ecard-qr')?.attributes.href,`https://fixture.invalid/member-cards/${TOKEN_B}`);
});
test('safety: session owner change rejects old output',async t=>{
 const h=fixture(t);await h.start();await h.begin();h.client.sessionGeneration++;h.render({session:{user:{user_id:PEER}}});assert(!h.publicNode());await h.finish();assert.equal(effects.downloads.length,0);
});
test('safety: unmount rejects late output',async t=>{
 const h=fixture(t);await h.start();await h.begin();h.unmount();await h.finish();assert.equal(effects.downloads.length,0);assert.equal(effects.urls.length,0);
});
test('control: labels failure does not trigger the successful-label rerender or cancel output',async t=>{
 const h=fixture(t);await h.start();await h.begin();await h.reject(h.pending('/assessment-definition')[0],new Error('synthetic labels unavailable'));assert(h.button('正在產生圖片…')?.hasAttribute('disabled'));await h.finish();assert.equal(effects.downloads.length,1);
});
test('labels completing while fonts are pending preserve the eventual output',async t=>{
 const h=fixture(t);await h.start();let ready!:()=>void;document.fonts.ready=new Promise<void>(r=>{ready=r;});h.click(h.button('下載名片 PNG'));await settle(()=>{});assert.equal(effects.toBlob.length,0);assert(h.button('正在產生圖片…')?.hasAttribute('disabled'));await h.resolve(h.pending('/assessment-definition')[0],definition());assert(h.button('正在產生圖片…')?.hasAttribute('disabled'));await settle(ready);assert.equal(effects.toBlob.length,1);await h.finish();assert.equal(effects.downloads.length,1);
});
test('label completion cannot enable a duplicate click while the first image is pending',async t=>{
 const h=fixture(t);await h.start();await h.begin();await h.resolve(h.pending('/assessment-definition')[0],definition());assert.throws(()=>h.click(h.button('正在產生圖片…')),/control enabled/);assert.equal(effects.toBlob.length,1);await h.finish();assert.equal(effects.downloads.length,1);
});
test('host negative controls: disabled and detached controls are not interactable',async t=>{
 const h=fixture(t);await h.start();const button=h.button('下載名片 PNG');await h.begin();assert.throws(()=>h.click(button),/control enabled/);assert.equal(effects.toBlob.length,1);h.unmount();assert.throws(()=>h.click(button),/control mounted/);await h.finish();assert.equal(effects.downloads.length,0);
});
test('safety: hiding page removes public card and cancels its raster output',async t=>{
 const h=fixture(t);await h.start();await h.begin();document.visibilityState='hidden';flush(()=>document.dispatchEvent({type:'visibilitychange'}));assert(!h.publicNode());await h.finish();assert.equal(effects.downloads.length,0);
});
test('safety: production session-end event removes card and cancels output',async t=>{
 const h=fixture(t);await h.start();await h.begin();flush(()=>window.dispatchEvent({type:'freedom-game-console-session-end'}));assert(!h.publicNode());await h.finish();assert.equal(effects.downloads.length,0);
});
test('control: raster failure displays retryable production notice',async t=>{
 const h=fixture(t);await h.start();await h.resolve(h.pending('/assessment-definition')[0],definition());await h.begin();await settle(()=>effects.toBlob[0].reject(new Error('synthetic raster failure')));assert.equal(effects.downloads.length,0);assert(h.container.textContent.includes('圖片暫時無法下載，請重試'));h.click(h.button('下載名片 PNG'));await settle(()=>{});assert.equal(effects.toBlob.length,2);await h.finish(1);assert.equal(effects.downloads.length,1);assert(h.container.textContent.includes('名片圖片已產生'));assert(!h.container.textContent.includes('圖片暫時無法下載'));
});
test('label rejection while fonts wait still permits the same image',async t=>{
 const h=fixture(t);await h.start();let ready!:()=>void;document.fonts.ready=new Promise<void>(r=>{ready=r;});h.click(h.button('下載名片 PNG'));await settle(()=>{});await h.reject(h.pending('/assessment-definition')[0],new Error('synthetic labels unavailable'));assert.equal(effects.toBlob.length,0);assert(h.button('正在產生圖片…')?.hasAttribute('disabled'));await settle(ready);await h.finish();assert.equal(effects.downloads.length,1);
});
test('hidden page restored with changed public data cancels old output and permits a new download',async t=>{
 const h=fixture(t);await h.start();await h.begin();document.visibilityState='hidden';flush(()=>document.dispatchEvent({type:'visibilitychange'}));assert(!h.publicNode());document.visibilityState='visible';flush(()=>document.dispatchEvent({type:'visibilitychange'}));assert(!h.publicNode());await h.resolve(h.pending(`/public/member-cards/${TOKEN}`)[0],{...publicCard(),nickname:'新的作者名稱'});await h.resolve(h.pending(`/member-cards/${TOKEN}/member`)[0],privateCard());assert(h.publicNode().textContent.includes('新的作者名稱'));await h.finish();assert.equal(effects.downloads.length,0);h.click(h.button('下載名片 PNG'));await settle(()=>{});await h.finish(1);assert.equal(effects.downloads.length,1);
});
test('client replacement with the same generation and owner cancels old output',async t=>{
 const h=fixture(t);await h.start();await h.begin();const replacement={...h.client};h.render({client:replacement});assert(!h.publicNode());await h.resolve(h.pending(`/public/member-cards/${TOKEN}`)[0],publicCard());await h.resolve(h.pending(`/member-cards/${TOKEN}/member`)[0],privateCard());await h.finish();assert.equal(effects.downloads.length,0);h.click(h.button('下載名片 PNG'));await settle(()=>{});await h.finish(1);assert.equal(effects.downloads.length,1);
});
test('owner and guest sessions cannot inherit a prior pending download or late labels',async t=>{
 const h=fixture(t);await h.start();const labels=h.pending('/assessment-definition')[0];await h.begin();h.render({session:undefined});assert(!h.publicNode());await h.resolve(h.pending(`/public/member-cards/${TOKEN}`)[0],publicCard());await h.resolve(labels,definition());await h.finish();assert.equal(effects.downloads.length,0);assert(!h.container.textContent.includes('晚到會員標籤'));assert(h.container.textContent.includes('加入自由工坊／登入'));
});
test('refresh with unchanged empty headline still updates every other public card field',async t=>{
 const h=fixture(t);await h.start({...publicCard(),headline:''});flush(()=>window.dispatchEvent({type:'focus'}));assert(!h.publicNode());await h.resolve(h.pending(`/public/member-cards/${TOKEN}`)[0],{...publicCard(),headline:'',nickname:'新的名字',design:'night',primary_guild:{name:'新的公會',guild_key:'new'},capabilities:['新的專長'],avatar_url:`/api/v1/public/member-cards/${TOKEN}/avatar`,links:[{label:'新的作品',url:'https://example.invalid/new'}],profile_links:[{platform:'github',label:'新的GitHub',handle:'new',url:'https://github.com/new'}]});await h.resolve(h.pending(`/member-cards/${TOKEN}/member`)[0],privateCard());const node=h.publicNode();assert.equal(node.attributes['data-design'],'night');for(const text of ['新的名字','新的公會','新的專長','新的作品','新的GitHub'])assert(node.textContent.includes(text),text);assert(descendants(node).some(n=>n.nodeName==='IMG'&&n.attributes.src===`/api/v1/public/member-cards/${TOKEN}/avatar`));assert(!node.textContent.includes('公開專長'));h.click(h.button('下載名片 PNG'));await settle(()=>{});assert.strictEqual(effects.toBlob[0].node,node);await h.finish();assert.equal(effects.downloads.length,1);
});

// The public page intentionally unmounts its exporter while revalidating. Exercise the
// real shared exporter separately so its children / disabled / URL cancellation guards
// remain required even when parent memoization avoids unrelated renders.
function exporter(t:TestContext){
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);let mounted=true;
 const card=(nickname='合成名片')=>React.createElement(MemberECard,{design:'editorial',nickname,headline:null,guildName:'公會',capabilities:[],avatarUrl:null,links:[],shareUrl:`https://fixture.invalid/member-cards/${TOKEN}`});
 let props={shareUrl:`https://fixture.invalid/member-cards/${TOKEN}`,disabled:false,children:card()};
 const render=(patch:any={})=>{props={...props,...patch};flush(()=>root.render(React.createElement(MemberCardDownload,props)));};
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};
 t.after(()=>{unmount();scheduled.clear();Object.values(effects).forEach(v=>v.length=0);events.length=0;document.fonts.ready=Promise.resolve();});
 const button=()=>descendants(container).find(n=>n.nodeName==='BUTTON')!;
 const click=async()=>{const node=button();assert(container.contains(node));assert(!node.hasAttribute('disabled'));flush(()=>node.dispatchEvent({type:'click',button:0,bubbles:true}));await settle(()=>{});};
 const finish=async(index=0)=>settle(()=>effects.toBlob[index].resolve(new Blob(['synthetic-png'],{type:'image/png'})));
 render();return {container,render,unmount,button,click,finish,card};
}
test('shared exporter preserves same child and URL across unrelated parent renders',async t=>{
 const h=exporter(t);await h.click();h.render();assert(h.button().hasAttribute('disabled'));await h.finish();assert.equal(effects.downloads.length,1);
});
test('shared exporter still cancels when its actual card child changes',async t=>{
 const h=exporter(t);await h.click();h.render({children:h.card('內容已改')});await h.finish();assert.equal(effects.downloads.length,0);assert(h.container.textContent.includes('內容已改'));await h.click();await h.finish(1);assert.equal(effects.downloads.length,1);
});
test('shared exporter still cancels when disabled becomes true',async t=>{
 const h=exporter(t);await h.click();h.render({disabled:true});assert(h.button().hasAttribute('disabled'));await h.finish();assert.equal(effects.downloads.length,0);h.render({disabled:false});await h.click();await h.finish(1);assert.equal(effects.downloads.length,1);
});
test('shared exporter still cancels when its share URL changes',async t=>{
 const h=exporter(t);await h.click();h.render({shareUrl:`https://fixture.invalid/member-cards/${TOKEN_B}`});await h.finish();assert.equal(effects.downloads.length,0);await h.click();await h.finish(1);assert.equal(effects.downloads.length,1);
});
test('shared exporter unmount during font wait never emits an old download',async t=>{
 const h=exporter(t);let ready!:()=>void;document.fonts.ready=new Promise<void>(r=>{ready=r;});await h.click();assert.equal(effects.toBlob.length,0);h.unmount();await settle(ready);assert.equal(effects.toBlob.length,1);await h.finish();assert.equal(effects.downloads.length,0);assert.equal(effects.urls.length,0);
});
