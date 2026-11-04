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
  return new Proxy({},{get(_target,key){if(key==='SocialRichText')return ({text,mentions}:any)=>React.createElement('span',{'data-mentions':JSON.stringify(mentions??[])},text);if(key==='MemberAvatar')return ({avatarUrl}:any)=>React.createElement('span',{'data-avatar':avatarUrl??''});return ()=>null;}});
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
 const render=(overrides:any={})=>flush(()=>root.render(React.createElement(module.exports.SocialInteractions,{...componentProps,...overrides})));
 return {client,post,comment,requests,updates,find,like,textarea,click,answer,reject,unmount,toggle,container,byText,submit,change,render};
}
function page(comment:any,cursor:string|null=null){return {items:[{...comment}],next_cursor:cursor};}

function editInput(h:ReturnType<typeof fixture>){return h.find(n=>n.nodeName==='TEXTAREA'&&n.getAttribute('aria-label')==='編輯留言');}
async function begin(t:TestContext){const h=fixture(t);await h.answer(0,page(h.comment));h.click(h.byText('編輯留言')!);h.change(editInput(h)!,'retained edit');return h;}
function save(h:ReturnType<typeof fixture>){h.submit(editInput(h)!.parentNode!.parentNode!);}
function ack(h:ReturnType<typeof fixture>,overrides:any={}){return {...h.comment,body:'retained edit',revision:2,edited_at:'2026-11-04T01:00:00Z',...overrides};}
// Real React and the entire production component run above. Network settlement
// and unrelated presentation are controlled, not a second implementation.
test('an unknown edit retries its immutable body, revision and explicit idempotency key',async t=>{
 const h=await begin(t);save(h);await h.reject(1);assert.equal(typeof h.requests[1].options.idempotencyKey,'string');
 assert.equal(props(editInput(h)!).disabled,true);assert(h.byText('確認上次儲存'));save(h);
 assert.equal(h.requests[2].options.idempotencyKey,h.requests[1].options.idempotencyKey);assert.equal(h.requests[2].options.ifMatch,1);assert.equal(h.requests[2].body.text,'retained edit');
 await h.answer(2,ack(h));assert.equal(Boolean(editInput(h)),false);assert(h.container.textContent.includes('retained edit'));
});
test('cancel and reopen restore the unknown draft instead of replacing it with the old read',async t=>{
 const h=await begin(t);save(h);await h.reject(1);h.click(h.byText('取消')!);h.click(h.byText('編輯留言')!);
 assert.equal(props(editInput(h)!).value,'retained edit');assert.equal(props(editInput(h)!).disabled,true);save(h);
 assert.equal(h.requests[2].options.idempotencyKey,h.requests[1].options.idempotencyKey);await h.answer(2,ack(h));
});
test('an old edit receipt cannot overwrite a newer read or its current reaction and author',async t=>{
 const h=await begin(t);save(h);h.click(h.toggle());h.click(h.toggle());
 await h.answer(2,page({...h.comment,body:'newer remote edit',revision:3,edited_at:'2026-11-04T02:00:00Z',liked:true,like_count:7,author:{...h.comment.author,display_name:'current author'}}));
 await h.answer(1,ack(h));assert.equal(h.like().getAttribute('aria-label'),'留言已讚 · 7');assert(h.container.textContent.includes('current author'));
 assert.equal(props(editInput(h)!).value,'newer remote edit');assert(h.container.textContent.includes('上次儲存已確認，目前已有較新版本。'));
 h.click(h.byText('取消')!);assert(h.container.textContent.includes('newer remote edit'));assert.equal(h.container.textContent.includes('retained edit'),false);
 h.click(h.byText('編輯留言')!);h.change(editInput(h)!,'next edit after newer read');save(h);assert.equal(h.requests[3].options.ifMatch,3);await h.answer(3,ack(h,{body:'next edit after newer read',revision:4}));
});

test('a normal edit uses one write and closes the editor only after a validated ACK',async t=>{
 const h=await begin(t);save(h);assert.equal(h.requests.length,2);assert.equal(props(editInput(h)!).disabled,true);assert(h.byText('儲存中…'));
 await h.answer(1,ack(h));assert.equal(Boolean(editInput(h)),false);assert.equal(h.requests.length,2);assert.equal(h.like().getAttribute('aria-label'),'留言讚 · 0');
});
test('same-tick submits of the actual handler produce only one in-flight command',async t=>{
 const h=await begin(t),handler=props(editInput(h)!.parentNode!.parentNode!).onSubmit;
 flush(()=>{handler({preventDefault(){}});handler({preventDefault(){}});});assert.equal(h.requests.length,2);await h.answer(1,ack(h));
});
test('unknown command cannot be changed by a stale input callback or replaced after a fresh read',async t=>{
 const h=await begin(t),change=props(editInput(h)!).onChange;save(h);await h.reject(1);
 flush(()=>change({target:{value:'changed after unknown'}}));assert.equal(props(editInput(h)!).value,'retained edit');
 h.click(h.byText('重新載入留言')!);await h.answer(2,page({...h.comment,body:'retained edit',revision:2,edited_at:'2026-11-04T01:00:00Z'}));
 assert.equal(props(h.byText('確認上次儲存')!).disabled,false);save(h);assert.equal(h.requests[3].body.text,'retained edit');assert.equal(h.requests[3].options.ifMatch,1);assert.equal(h.requests[3].options.idempotencyKey,h.requests[1].options.idempotencyKey);await h.answer(3,ack(h));
});
for(const [code,status] of [['version_conflict',412],['validation_failed',422],['author_required',403],['not_found',404]] as const){
 test(`a first definitive ${code} rejection unlocks the draft for a new command`,async t=>{
  const h=await begin(t);save(h);await h.reject(1,new ApiError({message:'definitive rejection',code,status}));assert.equal(props(editInput(h)!).disabled,false);
  h.change(editInput(h)!,'corrected draft');save(h);assert.notEqual(h.requests[2].options.idempotencyKey,h.requests[1].options.idempotencyKey);assert.equal(h.requests[2].body.text,'corrected draft');await h.answer(2,ack(h,{body:'corrected draft'}));
 });
 test(`a ${code} rejection after unknown delivery cannot discard the held command`,async t=>{
  const h=await begin(t);save(h);await h.reject(1);save(h);await h.reject(2,new ApiError({message:'now rejected',code,status}));
  assert.equal(props(editInput(h)!).disabled,true);assert(h.byText('確認上次儲存'));save(h);assert.equal(h.requests[3].options.idempotencyKey,h.requests[1].options.idempotencyKey);assert.equal(h.requests[3].body.text,'retained edit');await h.answer(3,ack(h));
 });
}
for(const cause of [new ApiError({message:'server uncertain',status:503}),new ApiError({message:'timeout',timedOut:true}),new ApiError({message:'unknown rejection',status:409,code:'idempotency_conflict'})])test(`${cause.message} retains the original command`,async t=>{
 const h=await begin(t);save(h);await h.reject(1,cause);assert.equal(props(editInput(h)!).disabled,true);save(h);assert.equal(h.requests[2].options.idempotencyKey,h.requests[1].options.idempotencyKey);await h.answer(2,ack(h));
});
for(const [label,invalid] of [['id',{comment_id:'wrong'}],['body',{body:'wrong'}],['revision',{revision:5}],['timestamp',{edited_at:'not a date'}],['missing timestamp',{edited_at:null}]] as const)test(`a malformed ${label} ACK remains uncertain and does not replace the draft`,async t=>{
 const h=await begin(t);save(h);await h.answer(1,ack(h,invalid));assert.equal(props(editInput(h)!).value,'retained edit');assert.equal(props(editInput(h)!).disabled,true);save(h);
 assert.equal(h.requests[2].options.idempotencyKey,h.requests[1].options.idempotencyKey);await h.answer(2,ack(h));
});
test('a fresh row keeps its current reactions, author, visibility, media and filtered mentions after an old receipt',async t=>{
 const h=await begin(t);h.change(editInput(h)!,'retained edit @Current');save(h);h.click(h.toggle());h.click(h.toggle());
 const fresh={...h.comment,liked:true,like_count:4,mine:false,image_url:'/api/v1/current-image',author:{...h.comment.author,display_name:'current author',avatar_url:'/api/v1/current-avatar'},mentions:[{user_id:'kept',display_name:'Current'},{user_id:'removed',display_name:'Removed'}]};
 await h.answer(2,page(fresh));await h.answer(1,ack(h,{body:'retained edit @Current',mentions:[{user_id:'hidden',display_name:'Hidden'}]}));
 assert.equal(h.like().getAttribute('aria-label'),'留言已讚 · 4');assert(h.container.textContent.includes('current author'));assert(h.find(n=>n.getAttribute('data-avatar')==='/api/v1/current-avatar'));
 assert(h.find(n=>n.nodeName==='IMG'&&n.getAttribute('src')==='/api/v1/current-image'));assert.equal(Boolean(h.byText('編輯留言')),false);assert.equal(Boolean(h.byText('刪除留言')),false);assert(h.find(n=>n.getAttribute('data-mentions')===JSON.stringify([{user_id:'kept',display_name:'Current'}])));
});
test('an authoritative read that removes the comment is not undone by a late edit receipt',async t=>{
 const h=await begin(t);save(h);h.click(h.toggle());h.click(h.toggle());await h.answer(2,{items:[],next_cursor:null});await h.answer(1,ack(h));
 assert.equal(Boolean(h.like()),false);assert.equal(Boolean(editInput(h)),false);assert.equal(h.requests.length,3);
});
test('an edit ACK during an older GET retains the edit revision fence',async t=>{
 const h=await begin(t);h.click(h.toggle());h.click(h.toggle());save(h);await h.answer(2,ack(h));await h.answer(1,page(h.comment));assert(h.container.textContent.includes('retained edit'));
});
test('a later read remains authoritative for removing a previously acknowledged edit',async t=>{
 const h=await begin(t);save(h);await h.answer(1,ack(h));h.click(h.toggle());h.click(h.toggle());await h.answer(2,{items:[],next_cursor:null});assert.equal(Boolean(h.like()),false);
});
test('a fresh equal-revision row is not replaced with an old receipt snapshot',async t=>{
 const h=await begin(t);save(h);h.click(h.toggle());h.click(h.toggle());await h.answer(2,page(ack(h,{liked:true,like_count:9,author:{...h.comment.author,display_name:'new current author'}})));await h.answer(1,ack(h));
 assert.equal(h.like().getAttribute('aria-label'),'留言已讚 · 9');assert(h.container.textContent.includes('new current author'));assert.equal(Boolean(editInput(h)),false);
});
for(const invalidate of ['session','client','post','unmount'] as const)test(`a late ${invalidate} edit ACK cannot apply or close a new scope`,async t=>{
 const h=await begin(t);save(h);
 if(invalidate==='session')h.client.sessionGeneration++;else if(invalidate==='client')h.render({client:{...h.client}});else if(invalidate==='post')h.render({post:{...h.post,post_id:'other-post'}});else h.unmount();
 await h.answer(1,ack(h));assert.equal(h.requests.length,2);if(invalidate==='session'){assert(editInput(h));}else if(invalidate!=='unmount'){assert.equal(Boolean(editInput(h)),false);assert.equal(h.container.textContent.includes('已編輯'),false);}
});
test('canceling an unknown edit permits editing another comment and later restoring the original command',async t=>{
 const h=fixture(t),second={...h.comment,comment_id:'20000000-0000-4000-8000-000000000002',body:'second text'};await h.answer(0,{items:[h.comment,second],next_cursor:null});
 h.click(h.byText('編輯留言')!);h.change(editInput(h)!,'retained edit');save(h);await h.reject(1);h.click(h.byText('取消')!);
 const buttons=()=>descendants(h.container).filter(n=>n.nodeName==='BUTTON'&&n.textContent==='編輯留言');h.click(buttons()[1]);h.change(editInput(h)!,'second updated');save(h);
 assert(h.requests[2].path.includes(second.comment_id));await h.answer(2,{...second,body:'second updated',revision:2,edited_at:'2026-11-04T01:00:00Z'});
 h.click(buttons()[0]);assert.equal(props(editInput(h)!).value,'retained edit');save(h);assert.equal(h.requests[3].options.idempotencyKey,h.requests[1].options.idempotencyKey);await h.answer(3,ack(h));
});
test('the unrelated new-comment draft survives an unknown edit and its explicit recovery',async t=>{
 const h=await begin(t);h.change(h.textarea(),'unsent new comment');save(h);await h.reject(1);save(h);await h.answer(2,ack(h));assert.equal(props(h.textarea()).value,'unsent new comment');assert.equal(h.updates.length,0);
});
test('an edit receipt arriving during an empty authorized read cannot manufacture membership',async t=>{
 const h=await begin(t);h.click(h.toggle());h.click(h.toggle());save(h);await h.answer(2,ack(h));await h.answer(1,{items:[],next_cursor:null});assert.equal(Boolean(h.like()),false);
});
test('an edit delta keeps newer GET metadata even when that GET has an older edit revision',async t=>{
 const h=await begin(t);h.click(h.toggle());h.click(h.toggle());save(h);await h.answer(2,ack(h));await h.answer(1,page({...h.comment,liked:true,like_count:5,mine:false,author:{...h.comment.author,display_name:'fresh read author'}}));
 assert(h.container.textContent.includes('retained edit'));assert(h.container.textContent.includes('fresh read author'));assert.equal(h.like().getAttribute('aria-label'),'留言已讚 · 5');assert.equal(Boolean(h.byText('編輯留言')),false);
});

for(const replace of ['client','session','post'] as const)for(const phase of ['unknown','inflight'] as const)test(`${replace} replacement clears the ${phase} edit draft and busy state`,async t=>{
 const h=await begin(t);save(h);if(phase==='unknown')await h.reject(1);
 if(replace==='client')h.render({client:{...h.client}});else if(replace==='post')h.render({post:{...h.post,post_id:'different-post'}});else{h.client.sessionGeneration++;h.render();}
 assert.equal(Boolean(editInput(h)),false);assert.equal(props(h.byText('編輯留言')!).disabled,false);
 if(phase==='inflight')await h.answer(1,ack(h));assert.equal(Boolean(editInput(h)),false);
 h.click(h.byText('編輯留言')!);assert.equal(props(editInput(h)!).value,'current text');assert.equal(props(editInput(h)!).disabled,false);
});

// Regression cases identified independently, executed by this full React fixture.
test('historical edit receipt must not recreate a row omitted by an overlapping current read', async t => {
 const h=await begin(t);save(h);await h.reject(1);
 h.click(h.toggle());h.click(h.toggle());
 await h.answer(2,page({...h.comment,body:'newer authorized text',revision:3,edited_at:'2026-11-04T02:00:00Z'}));
 save(h);h.click(h.toggle());h.click(h.toggle());
 await h.answer(3,ack(h));
 await h.answer(4,{items:[],next_cursor:null});
 assert.equal(Boolean(h.find(n=>n.nodeName==='ARTICLE'&&n.getAttribute('class')==='social-comment')),false);
 assert.equal(Boolean(editInput(h)),false);
 assert.equal(h.container.textContent.includes('newer authorized text'),false);
});
test('overlapping read supplies current metadata even when its edit revision predates the ACK', async t => {
 const h=await begin(t);save(h);h.click(h.toggle());h.click(h.toggle());
 await h.answer(1,ack(h));
 await h.answer(2,page({...h.comment,liked:true,like_count:7,mine:false,
   image_url:'/api/v1/synthetic-current-image',author:{...h.comment.author,display_name:'fresh author',avatar_url:'fresh-avatar'}}));
 assert.equal(h.like().getAttribute('aria-label'),'留言已讚 · 7');
 assert(h.container.textContent.includes('fresh author'));
 assert(h.container.textContent.includes('retained edit'));
 assert(h.find(n=>n.getAttribute('data-avatar')==='fresh-avatar'));
 assert(h.find(n=>n.nodeName==='IMG'&&n.getAttribute('src')==='/api/v1/synthetic-current-image'));
 assert.equal(Boolean(h.byText('編輯留言')),false);
});
test('client replacement after unknown edit cannot silently transfer the old private draft to a new command', async t => {
 const h=await begin(t);save(h);await h.reject(1);
 h.render({client:{...h.client}});
 assert.equal(Boolean(editInput(h)),false,'old-scope editor must close or otherwise be quarantined');
 assert.equal(h.requests.filter(r=>r.method==='POST').length,1);
});
test('client replacement during in-flight edit does not leave all subsequent editing permanently busy', async t => {
 const h=await begin(t);save(h);h.render({client:{...h.client}});
 await h.answer(1,ack(h));
 assert.equal(Boolean(editInput(h)),false,'old-scope editor must not survive owner replacement');
 const edit=h.byText('編輯留言');assert(edit);
 assert.equal(props(edit!).disabled,false,'old finally cannot own the new scope, but busy state must be reset separately');
});

test('an obsolete edit finally cannot unlock a newer client command',async t=>{
 const h=await begin(t);save(h);h.render({client:{...h.client}});h.click(h.byText('編輯留言')!);h.change(editInput(h)!,'new owner draft');save(h);
 await h.answer(1,ack(h));assert.equal(props(editInput(h)!).value,'new owner draft');assert.equal(props(editInput(h)!).disabled,true);assert.equal(h.requests.length,3);
 await h.answer(2,ack(h,{body:'new owner draft'}));assert.equal(Boolean(editInput(h)),false);assert(h.container.textContent.includes('new owner draft'));
});
test('a delete tombstone after the edit ACK wins over the older read',async t=>{
 const h=await begin(t);h.click(h.toggle());h.click(h.toggle());save(h);await h.answer(2,ack(h));h.click(h.byText('刪除留言')!);h.click(h.byText('確定刪除留言')!);await h.answer(3,{});await h.answer(1,page(h.comment));assert.equal(Boolean(h.like()),false);assert.equal(h.updates[0].comment_count,0);
});
test('pagination preserves its exact cursor while projecting the edit delta on current page metadata',async t=>{
 const h=fixture(t);await h.answer(0,page(h.comment,'next /?'));h.click(h.byText('編輯留言')!);h.change(editInput(h)!,'retained edit');h.click(h.byText('載入更多留言')!);save(h);await h.answer(2,ack(h));
 await h.answer(1,page({...h.comment,liked:true,like_count:6},'final cursor'));assert(h.requests[1].path.endsWith('?cursor=next%20%2F%3F'));assert(h.container.textContent.includes('retained edit'));assert.equal(h.like().getAttribute('aria-label'),'留言已讚 · 6');
 h.click(h.byText('載入更多留言')!);assert(h.requests[3].path.endsWith('?cursor=final%20cursor'));await h.answer(3,{items:[],next_cursor:null});
});
