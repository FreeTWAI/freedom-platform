import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
const window = {document, HTMLElement: HostNode, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {}, get event() {return undefined;}};
document.defaultView = window;
Object.assign(globalThis, {document, window, HTMLElement: HostNode, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true});
// Initialize ReactDOM after installing its synthetic host, in this test process.
const require = createRequire(import.meta.url);
const {createRoot} = require('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = require('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));

HostNode.prototype.closest = function () {return null;};
const source=readFileSync(new URL('../../apps/portal-web/src/modules/SocialInteractions.tsx',import.meta.url),'utf8');
const compiled=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
const descendants=(node:HostNode):HostNode[]=>[node,...node.childNodes.flatMap(descendants)];
const props=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
function fixture(t:TestContext,initialLiked=false){
 const requests:any[]=[]; const updates:any[]=[];
 const transport=(method:string)=>(path:string,body?:any,options?:any)=>new Promise((resolve,reject)=>requests.push({method,path,body,options,resolve,reject}));
 const client={sessionGeneration:1,csrfToken:'synthetic',get:transport('GET'),post:transport('POST'),delete:transport('DELETE')};
 const post={post_id:'10000000-0000-4000-8000-000000000001',comment_count:1,like_count:0,liked:false};
 const comment={comment_id:'20000000-0000-4000-8000-000000000001',body:'current text',created_at:'2026-11-04T00:00:00.000000Z',edited_at:null,revision:1,author:{user_id:'30000000-0000-4000-8000-000000000001',display_name:'synthetic author'},mine:true,liked:initialLiked,like_count:initialLiked?1:0};
 const module={exports:{} as any};
 runInNewContext(compiled,{module,exports:module.exports,crypto:webcrypto,URL,Error,setTimeout,clearTimeout,require(name:string){
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return require('react/jsx-runtime');
  if(name==='../api')return {ApiError};
  if(name==='../format')return {formatIsoLocal:(s:string)=>s};
  return new Proxy({},{get(_target,key){if(key==='SocialRichText')return ({text}:any)=>React.createElement('span',null,text);if(key==='MemberAvatar')return ({avatarUrl}:any)=>React.createElement('span',{'data-avatar':avatarUrl??''});return ()=>null;}});
 }});
 const container=document.createElement('div');document.body.appendChild(container); const root=createRoot(container as unknown as HTMLElement);
 const componentProps={client,post,canHide:false,initialOpen:true,onUpdate:(v:any)=>updates.push(v)};
 flush(()=>root.render(React.createElement(module.exports.SocialInteractions,componentProps)));
 let mounted=true;
 function unmount(){if(mounted){flush(()=>root.unmount());mounted=false;document.body.removeChild(container);}}
 t.after(unmount);
 const find=(predicate:(n:HostNode)=>boolean)=>descendants(container).find(predicate);
 const like=()=>find(n=>n.nodeName==='BUTTON'&&/^留言(?:已讚|讚) ·/.test(n.getAttribute('aria-label')??''))!;
 const textarea=()=>find(n=>n.nodeName==='TEXTAREA'&&n.getAttribute('aria-label')==='寫留言')!;
 const toggle=()=>find(n=>n.nodeName==='BUTTON'&&n.getAttribute('aria-controls')===`social-comments-${post.post_id}`)!;
 const click=(node:HostNode)=>flush(()=>props(node).onClick({preventDefault(){}}));
 const answer=async(index:number,value:any)=>{await React.act(async()=>{requests[index].resolve(value);await new Promise(r=>setImmediate(r));});};
 const reject=async(index:number,cause:unknown=new ApiError({message:'synthetic network error',network:true}))=>{await React.act(async()=>{requests[index].reject(cause);await new Promise(r=>setImmediate(r));});};
 const byText=(text:string)=>find(n=>n.nodeName==='BUTTON'&&n.textContent===text);
 const submit=(node:HostNode)=>flush(()=>props(node).onSubmit({preventDefault(){}}));
 const change=(node:HostNode,value:string)=>flush(()=>props(node).onChange({target:{value}}));
 return {client,post,comment,requests,updates,find,like,textarea,click,answer,reject,unmount,toggle,container,byText,submit,change};
}
function page(comment:any,cursor:string|null=null){return {items:[{...comment}],next_cursor:cursor};}
async function overlapping(t:TestContext,liked=false){const h=fixture(t,liked);await h.answer(0,page(h.comment));h.click(h.toggle());h.click(h.toggle());h.click(h.like());await h.answer(2,{liked:!liked,like_count:liked?0:1});return h;}

// Execute the full production component with real React reconciliation. Only
// transport and unrelated presentation modules are fakes; no browser is launched.
for(const initiallyLiked of [false,true])test(`confirmed ${initiallyLiked?'unlike':'like'} survives an older GET and revalidates once`,async t=>{
 const h=await overlapping(t,initiallyLiked),value={liked:!initiallyLiked,like_count:initiallyLiked?0:1};
 h.change(h.textarea(),'retain this draft');await h.answer(1,page(h.comment));
 assert.equal(h.like().getAttribute('aria-pressed'),String(value.liked));assert.equal(h.requests.length,4);
 assert.equal(h.requests[3].method,'GET');assert.equal(h.requests[3].path,h.requests[1].path);
 await h.answer(3,page({...h.comment,...value}));assert.equal(h.like().getAttribute('aria-pressed'),String(value.liked));
 assert.equal(props(h.textarea()).value,'retain this draft');h.click(h.like());
 assert.equal(h.requests[4].body.liked,initiallyLiked);assert.notEqual(h.requests[4].options.idempotencyKey,h.requests[2].options.idempotencyKey);
 await h.answer(4,{liked:initiallyLiked,like_count:initiallyLiked?1:0});assert.equal(h.requests.length,5);
});
test('GET resolved before the like ACK requires no extra read',async t=>{
 const h=fixture(t);await h.answer(0,page(h.comment));h.click(h.toggle());h.click(h.toggle());h.click(h.like());
 await h.answer(1,page(h.comment));await h.answer(2,{liked:true,like_count:1});assert.equal(h.like().getAttribute('aria-pressed'),'true');assert.equal(h.requests.length,3);
});
test('a read begun after a confirmed like remains authoritative without another GET',async t=>{
 const h=fixture(t);await h.answer(0,page(h.comment));h.click(h.like());await h.answer(1,{liked:true,like_count:1});
 h.click(h.toggle());h.click(h.toggle());await h.answer(2,page(h.comment));assert.equal(h.like().getAttribute('aria-pressed'),'false');assert.equal(h.requests.length,3);
});
test('an ordinary first-page read is unchanged and performs only one GET',async t=>{
 const h=fixture(t,true);await h.answer(0,page(h.comment));assert.equal(h.like().getAttribute('aria-pressed'),'true');assert.equal(h.requests.length,1);
});
test('a stable revalidation may carry a newer remote unlike, text and author instead of replaying the ACK',async t=>{
 const h=await overlapping(t);await h.answer(1,page(h.comment));
 await h.answer(3,page({...h.comment,body:'new remote text',revision:2,edited_at:'2026-11-04T01:00:00Z',author:{...h.comment.author,display_name:'new author',avatar_url:'/api/v1/members/new-author/avatar'},mine:false,liked:false,like_count:3}));
 assert(h.container.textContent.includes('new remote text'));assert(h.container.textContent.includes('new author'));
 assert.equal(h.like().getAttribute('aria-pressed'),'false');assert.equal(h.like().getAttribute('aria-label'),'留言讚 · 3');assert(h.find(node=>node.getAttribute('data-avatar')==='/api/v1/members/new-author/avatar'));assert.equal(h.byText('編輯留言')===undefined,true);assert.equal(h.byText('刪除留言')===undefined,true);assert.equal(h.requests.length,4);
});
test('authoritative empty revalidation removes the acknowledged comment without resurrecting it',async t=>{
 const h=await overlapping(t);await h.answer(1,page(h.comment));assert(h.like());await h.answer(3,{items:[],next_cursor:null});assert.equal(h.like()===undefined,true);assert.equal(h.requests.length,4);
});
test('a failed like ACK does not increment the read epoch or fabricate success',async t=>{
 const h=fixture(t);await h.answer(0,page(h.comment));h.click(h.toggle());h.click(h.toggle());h.click(h.like());
 await h.reject(2,new ApiError({message:'rejected',status:403,code:'forbidden'}));await h.answer(1,page(h.comment));
 assert.equal(h.like().getAttribute('aria-pressed'),'false');assert.equal(h.requests.length,3);
});
test('unknown like recovery keeps the original command key and only revalidates after its ACK',async t=>{
 const h=fixture(t);await h.answer(0,page(h.comment));h.click(h.toggle());h.click(h.toggle());h.click(h.like());await h.reject(2);
 assert.equal(h.like().textContent,'重試按讚');h.click(h.like());assert.equal(h.requests[3].options.idempotencyKey,h.requests[2].options.idempotencyKey);
 assert.deepEqual(h.requests[3].body,h.requests[2].body);await h.answer(3,{liked:true,like_count:1});await h.answer(1,page(h.comment));
 assert.equal(h.requests[4].method,'GET');await h.answer(4,page({...h.comment,liked:true,like_count:1}));
 assert.equal(h.like().getAttribute('aria-pressed'),'true');assert.equal(h.requests.filter(r=>r.method==='POST').length,2);
});
test('a failed revalidation keeps the confirmed state and permits explicit reload without another mutation',async t=>{
 const h=await overlapping(t);await h.answer(1,page(h.comment));await h.reject(3);
 assert.equal(h.like().getAttribute('aria-pressed'),'true');assert(h.container.textContent.includes('synthetic network error'));
 const reload=h.byText('重新載入留言');assert(reload);assert.equal(props(reload).disabled,false);h.click(reload);
 assert.equal(h.requests[4].method,'GET');await h.answer(4,page({...h.comment,liked:true,like_count:1}));
 assert.equal(h.requests.filter(r=>r.method==='POST').length,1);assert(!h.container.textContent.includes('synthetic network error'));
});
test('two overlapping ACKs stop at two reads, keep the latest ACK and offer explicit reload',async t=>{
 const h=await overlapping(t);await h.answer(1,page(h.comment));h.click(h.like());await h.answer(4,{liked:false,like_count:0});
 await h.answer(3,page({...h.comment,liked:true,like_count:1}));assert.equal(h.like().getAttribute('aria-pressed'),'false');
 assert.equal(h.requests.length,5);assert(h.container.textContent.includes('留言剛有更新，請重新載入最新內容。'));
 const reload=h.byText('重新載入留言');assert(reload);assert.equal(props(reload).disabled,false);h.click(reload);await h.answer(5,page(h.comment));
 assert.equal(h.requests.length,6);assert.equal(h.requests.filter(r=>r.method==='POST').length,2);assert(!h.container.textContent.includes('留言剛有更新'));
});
for(const phase of ['first','second'] as const)for(const invalidate of ['close','unmount','session'] as const)test(`${invalidate} during ${phase} read prevents stale application or another revalidation`,async t=>{
 const h=await overlapping(t);let pending=1;if(phase==='second'){await h.answer(1,page(h.comment));pending=3;}
 if(invalidate==='close')h.click(h.toggle());else if(invalidate==='unmount')h.unmount();else h.client.sessionGeneration++;
 const count=h.requests.length;await h.answer(pending,page(h.comment));assert.equal(h.requests.length,count);
 if(invalidate==='session')assert.equal(h.like().getAttribute('aria-pressed'),'true');else assert.equal(h.like()===undefined,true);
});
test('a newer reopen supersedes a held revalidation and does not receive its stale metadata',async t=>{
 const h=await overlapping(t);await h.answer(1,page(h.comment));h.click(h.toggle());h.click(h.toggle());assert.equal(h.requests[4].method,'GET');
 await h.answer(4,page({...h.comment,body:'newest selection',liked:true,like_count:4}));await h.answer(3,page({...h.comment,body:'obsolete read'}));
 assert(h.container.textContent.includes('newest selection'));assert(!h.container.textContent.includes('obsolete read'));assert.equal(h.like().getAttribute('aria-label'),'留言已讚 · 4');assert.equal(h.requests.length,5);
});
test('pagination revalidates its exact cursor and only applies the stable page cursor and contents',async t=>{
 const h=fixture(t);await h.answer(0,page(h.comment,'cursor /?'));h.click(h.byText('載入更多留言')!);h.click(h.like());await h.answer(2,{liked:true,like_count:1});
 await h.answer(1,{items:[h.comment],next_cursor:'stale cursor'});assert.equal(h.requests[3].path,h.requests[1].path);assert(h.requests[3].path.endsWith('?cursor=cursor%20%2F%3F'));
 const second={...h.comment,comment_id:'20000000-0000-4000-8000-000000000002',body:'next page comment',created_at:'2026-11-04T00:00:01.000000Z'};
 await h.answer(3,{items:[{...h.comment,liked:true,like_count:1},second],next_cursor:'stable cursor'});
 assert(h.container.textContent.includes('next page comment'));assert.equal(h.like().getAttribute('aria-pressed'),'true');h.click(h.byText('載入更多留言')!);
 assert(h.requests[4].path.endsWith('?cursor=stable%20cursor'));await h.answer(4,{items:[],next_cursor:null});assert.equal(h.byText('載入更多留言')===undefined,true);
});
test('a delete ACK during revalidation retains its tombstone when the page still contains the comment',async t=>{
 const h=await overlapping(t);await h.answer(1,page(h.comment));h.click(h.byText('刪除留言')!);h.click(h.byText('確定刪除留言')!);
 assert.equal(h.requests[4].method,'DELETE');await h.answer(4,{});await h.answer(3,page({...h.comment,liked:true,like_count:1}));
 assert.equal(h.like()===undefined,true);assert.equal(h.requests.length,5);assert.equal(h.updates.length,1);assert.equal(h.updates[0].comment_count,0);
});
test('an edit ACK during revalidation retains the existing edit-revision fence',async t=>{
 const h=await overlapping(t);await h.answer(1,page(h.comment));h.click(h.byText('編輯留言')!);
 const textarea=h.find(n=>n.nodeName==='TEXTAREA'&&n.getAttribute('aria-label')==='編輯留言')!;h.change(textarea,'confirmed edited text');
 h.submit(textarea.parentNode!.parentNode!);assert(h.requests[4].path.endsWith('/edit'));assert.equal(h.requests[4].options.ifMatch,1);
 const saved={...h.comment,body:'confirmed edited text',revision:2,edited_at:'2026-11-04T01:00:00Z',liked:true,like_count:1};await h.answer(4,saved);await h.answer(3,page({...h.comment,liked:true,like_count:1}));
 assert(h.container.textContent.includes('confirmed edited text'));assert.equal(h.like().getAttribute('aria-pressed'),'true');assert.equal(h.requests.length,5);
});
test('a newly created comment ACK during revalidation remains in the existing confirmed-comment projection',async t=>{
 const h=await overlapping(t);await h.answer(1,page(h.comment));h.change(h.textarea(),'new local comment');
 const form=h.find(n=>n.nodeName==='FORM'&&n.getAttribute('class')==='social-comment-composer')!;h.submit(form);
 assert.equal(h.requests[4].method,'POST');assert.equal(h.requests[4].body.text,'new local comment');
 const created={...h.comment,comment_id:'20000000-0000-4000-8000-000000000002',body:'new local comment',created_at:'2026-11-04T00:00:01.000000Z'};
 await h.answer(4,created);await h.answer(3,page({...h.comment,liked:true,like_count:1}));
 assert(h.container.textContent.includes('new local comment'));assert.equal(props(h.textarea()).value,'');assert.equal(h.requests.length,5);
});
test('an edit ACK during the first read remains fenced through the entire revalidation',async t=>{
 const h=await overlapping(t);h.click(h.byText('編輯留言')!);const input=h.find(n=>n.nodeName==='TEXTAREA'&&n.getAttribute('aria-label')==='編輯留言')!;
 h.change(input,'edit before revalidation');h.submit(input.parentNode!.parentNode!);
 await h.answer(3,{...h.comment,body:'edit before revalidation',revision:2,edited_at:'2026-11-04T01:00:00Z',liked:true,like_count:1});
 await h.answer(1,page(h.comment));assert.equal(h.requests[4].method,'GET');await h.answer(4,page({...h.comment,liked:true,like_count:1}));
 assert(h.container.textContent.includes('edit before revalidation'));assert.equal(h.requests.length,5);
});
test('a delete ACK during the first read remains a tombstone through revalidation',async t=>{
 const h=await overlapping(t);h.click(h.byText('刪除留言')!);h.click(h.byText('確定刪除留言')!);await h.answer(3,{});
 await h.answer(1,page(h.comment));assert.equal(h.requests[4].method,'GET');await h.answer(4,page({...h.comment,liked:true,like_count:1}));
 assert.equal(h.like()===undefined,true);assert.equal(h.requests.length,5);
});
test('a new comment ACK during the first read is not discarded by a reaction revalidation',async t=>{
 const h=await overlapping(t);h.change(h.textarea(),'created before revalidation');h.submit(h.find(n=>n.nodeName==='FORM'&&n.getAttribute('class')==='social-comment-composer')!);
 await h.answer(3,{...h.comment,comment_id:'20000000-0000-4000-8000-000000000002',body:'created before revalidation',created_at:'2026-11-04T00:00:01.000000Z'});
 await h.answer(1,page(h.comment));await h.answer(4,page({...h.comment,liked:true,like_count:1}));
 assert(h.container.textContent.includes('created before revalidation'));assert.equal(h.requests.length,5);
});
test('pagination stays loading and its control stays disabled throughout the extra read',async t=>{
 const h=fixture(t);await h.answer(0,page(h.comment,'next'));h.click(h.byText('載入更多留言')!);h.click(h.like());await h.answer(2,{liked:true,like_count:1});await h.answer(1,page(h.comment,'next'));
 assert(h.container.textContent.includes('正在載入留言…'));assert.equal(props(h.byText('載入更多留言')!).disabled,true);
 await h.answer(3,page({...h.comment,liked:true,like_count:1},'next'));assert(!h.container.textContent.includes('正在載入留言…'));assert.equal(props(h.byText('載入更多留言')!).disabled,false);
});
test('an obsolete-session like ACK neither updates the reaction nor triggers revalidation',async t=>{
 const h=fixture(t);await h.answer(0,page(h.comment));h.click(h.toggle());h.click(h.toggle());h.click(h.like());h.client.sessionGeneration++;
 await h.answer(2,{liked:true,like_count:1});await h.answer(1,page(h.comment));assert.equal(h.like().getAttribute('aria-pressed'),'false');assert.equal(h.requests.length,3);
});
test('an old-session like ACK cannot invalidate a read started under the new session generation',async t=>{
 const h=fixture(t);await h.answer(0,page(h.comment));h.click(h.like());
 h.client.sessionGeneration++;h.click(h.toggle());h.click(h.toggle());assert.equal(h.requests[2].method,'GET');
 await h.answer(1,{liked:true,like_count:1});await h.answer(2,page(h.comment));
 assert.equal(h.like().getAttribute('aria-pressed'),'false');assert.equal(h.requests.length,3,'obsolete ACK must not trigger an extra read in the newer session');
});
