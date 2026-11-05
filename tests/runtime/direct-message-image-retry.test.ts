import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
import ts from '@typescript/typescript6';
import {ApiError} from '../../apps/portal-web/src/api';
import {messageImageUrl} from '../../apps/portal-web/src/modules/message-image-client';

// Real React/ReactDOM reconciliation, with an intentionally minimal synthetic
// DOM host. Image errors are injected through actual production callbacks;
// browser image decoding, native event scheduling and layout are not simulated.
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
const source = readFileSync(new URL('../../apps/portal-web/src/modules/MemberMessages.tsx',import.meta.url),'utf8');
function section(start:string,end:string){const left=source.indexOf(start),right=source.indexOf(end,left);assert(left>=0&&right>left);return source.slice(left,right);}
const imageSource=section('function DirectMessageImage(', 'export function DirectMessages(');
const ast=ts.createSourceFile('MemberMessages.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const component=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='DirectMessages');
assert(component&&ts.isFunctionDeclaration(component)&&component.body);
const history=component.body.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text==='messageHistory'));
assert(history,'production messageHistory declaration missing');
const historySource=source.slice(history.getStart(ast),history.end);
const readSource=section('  const loadThread=useCallback(', '  useEffect(()=>{\n    const update=()=>{if(currentPeer.current)');
const refreshSource=source.split('\n').find(line=>line.includes('aria-disabled={threadRefresh.loading}')&&line.includes('loadThread(peer,true)'))!;
assert(refreshSource);
const peer='20000000-0000-4000-8000-000000000002',me='20000000-0000-4000-8000-000000000001';
const baseMessage={message_id:'20000000-0000-4000-8000-000000000003',sender_ref:peer,recipient_ref:me,body:'[圖片]',created_at:'2026-11-04T10:00:00.000000Z',read_at:'2026-11-04T10:00:10Z',image:{content_type:'image/webp',byte_size:128}};
const initial=()=>({participant:{user_id:peer,display_name:'Synthetic peer'},can_send:true,unread_count:0,next_offset:null,items:[{...baseMessage}]});
const descendants=(node:HostNode):HostNode[]=>[node,...node.childNodes.flatMap(descendants)];
const props=(node:HostNode)=>node[Object.keys(node).find(key=>key.startsWith('__reactProps$'))!];
function fixture(t:TestContext){
 const state:any={thread:initial(),requests:[],next:undefined,refresh:{loading:false,error:''}};
 const no=()=>{};
 const ctx:any={React,useState:React.useState,useMemo:React.useMemo,useCallback:(fn:Function)=>fn,ApiError,Date,
   messageImageUrl,
   PAGE:20,fail:(e:any)=>{throw e;},peer,me,attempt:undefined,retracting:false,messageImagesEnabled:true,changeRichDraft:no,uid:'synthetic',calendarKey:'same',
   held:{current:{}},retractTrigger:{current:null},setRetractError:no,setRetractTarget:no,document,
   ChatTime:({value}:any)=>React.createElement('time',{},value),ChatQuote:()=>null,ChatBody:()=>null,ChatRetracted:()=>React.createElement('p',{},'retracted'),ReportButton:()=>null,
   client:{get:async(path:string,options:any)=>{state.requests.push({path,options});return state.next??{...state.thread,items:state.thread.items.map((m:any)=>({...m}))};}},
   olderInFlight:{current:null},threadGeneration:{current:0},threadInFlight:{current:null},quietInFlight:{current:new Map()},olderQueued:{current:null},idlePoll:{current:0},resetChatPoll:()=>0,
   historyRevision:{current:0},receiptRefresh:{current:new Map()},receiptCheckedAt:{current:new Map()},readIssues:{current:new Map()},currentPeer:{current:peer},snapshot:{current:{thread:state.thread}},alive:{current:true},stick:{current:true},
   setThreadMore:no,setReadError:no,setThreadStatus:no,setThreadError:no,setThreadRefresh:(value:any)=>{state.refresh=value;},setLiveError:no,setHasNew:no,
   setThread:(value:any)=>{state.thread=typeof value==='function'?value(state.thread):value;ctx.snapshot.current.thread=state.thread;},
   refreshLoadedMessages:async()=>{throw new Error('retraction flow not expected in this fixture');},readLoadedDirectMessageReceipts:async()=>undefined,
   mergeDirectMessagePage:(a:any[],b:any[])=>[...a,...b.filter(x=>!a.some(y=>x.message_id===y.message_id))],newestMessages:(m:any)=>m,
 };
 const compiled=transformSync([imageSource,readSource,`function History({thread,hidden=false}){const threadRefresh=globalThis.state.refresh;${historySource}\nreturn <section hidden={hidden}>${refreshSource}{messageHistory}</section>;}`, 'globalThis.History=History;globalThis.reload=loadThread;'].join('\n'),{loader:'tsx',format:'cjs'}).code;
 ctx.state=state;runInNewContext(compiled,ctx);
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as any);
 t.after(()=>{flush(()=>root.unmount());document.body.removeChild(container);});
 const find=(p:(n:HostNode)=>boolean)=>descendants(container).find(p);
 const imageNode=()=>find(n=>n.nodeName==='IMG'&&n.getAttribute('class')==='message-image');
 const render=(hidden=false)=>flush(()=>root.render(React.createElement(ctx.History,{thread:state.thread,hidden})));
 const error=(id?:string)=>{const n=id?find(n=>n.nodeName==='IMG'&&n.src.includes(id)):imageNode();assert(n);flush(()=>props(n).onError({currentTarget:n,target:n}));};
 const refresh=async()=>{const button=find(n=>n.nodeName==='BUTTON'&&n.getAttribute('aria-label')==='重新讀取訊息');assert(button);await React.act(async()=>{props(button).onClick();await new Promise(resolve=>setImmediate(resolve));});render();};
 const retryButton=()=>find(n=>n.nodeName==='BUTTON'&&n.textContent==='重試圖片');
 const retry=()=>{const button=retryButton();assert(button,'explicit image retry must be available');assert.equal(props(button).type,'button');flush(()=>props(button).onClick());};
 return {state,ctx,container,find,imageNode,render,error,refresh,retry,retryButton};
}

test('retry after an image failure and successful manual history refresh restores the canonical image',async t=>{
 const h=fixture(t);h.render();const original=h.imageNode();assert(original);h.error();
 assert.equal(h.container.textContent.includes('圖片無法載入'),true);assert(!h.imageNode());
 await h.refresh();assert.equal(h.state.requests.length,1);assert.equal(h.state.requests[0].options.background,true);
 assert.equal(h.state.refresh.loading,false);assert.equal(h.state.refresh.error,'');assert(!h.imageNode());
 h.retry();assert(h.imageNode());assert.equal(h.imageNode()!==original,true);assert.equal(h.imageNode()!.src,original.src);
 assert.equal(h.imageNode()!.src,messageImageUrl(peer,baseMessage.message_id));assert(!h.retryButton());
 assert.equal(h.state.requests.length,1,'the image retry does not read the conversation again');
});
test('each repeated failure requires another explicit retry, without automatic loops',t=>{
 const h=fixture(t);h.render();const url=h.imageNode()!.src;
 for(let attempt=0;attempt<3;attempt++){
   h.error();h.render();assert(!h.imageNode());assert(h.retryButton());
   h.retry();assert(h.imageNode());assert.equal(h.imageNode()!.src,url);assert(!h.retryButton());
 }
 assert.equal(h.state.requests.length,0,'no message, upload or history calls');
});
test('hidden pane transitions and a new message retain the available retry without reloading',t=>{
 const h=fixture(t);h.render();h.error();const button=h.retryButton();assert(button);
 h.render(true);h.render(false);
 h.state.thread={...h.state.thread,items:[{...baseMessage,message_id:'20000000-0000-4000-8000-000000000004',image:undefined,body:'new text'},...h.state.thread.items]};h.render();
 assert.equal(h.retryButton()===button,true);assert(!h.imageNode());h.retry();assert(h.imageNode());assert.equal(h.state.requests.length,0);
});
test('retry preserves the message row and every unaffected sibling image',t=>{
 const h=fixture(t);h.state.thread.items.push({...baseMessage,message_id:'20000000-0000-4000-8000-000000000005'});h.render();
 const row=h.find(n=>n.getAttribute('data-message-id')===baseMessage.message_id),other=h.find(n=>n.nodeName==='IMG'&&n.src.endsWith('000000000005/image'));
 assert(row);assert(other);h.error(baseMessage.message_id);h.retry();
 assert.equal(h.find(n=>n.getAttribute('data-message-id')===baseMessage.message_id)===row,true);
 assert.equal(h.find(n=>n.nodeName==='IMG'&&n.src.endsWith('000000000005/image'))===other,true);
});
test('healthy history refresh preserves its image DOM and does not show a retry',async t=>{
 const h=fixture(t);h.render();const image=h.imageNode();assert(image);await h.refresh();assert.equal(h.imageNode()===image,true);assert(!h.retryButton());
});
test('recovered image retains canonical link, lazy decoding and descriptive text',t=>{
 const h=fixture(t);h.render();h.error();const button=h.retryButton();assert(button);
 assert.equal(button.getAttribute('class'),'btn btn-ghost btn-small');assert.equal(props(button).type,'button');h.retry();
 const image=h.imageNode()!,link=image.parentNode!;
 assert.equal(image.getAttribute('loading'),'lazy');assert.equal(image.getAttribute('decoding'),'async');assert.equal(image.getAttribute('alt'),'傳送的圖片');
 assert.equal(link.nodeName,'A');assert.equal(link.getAttribute('href'),messageImageUrl(peer,baseMessage.message_id));
 assert.equal(link.getAttribute('target'),'_blank');assert.equal(link.getAttribute('rel'),'noopener');assert.equal(h.state.requests.length,0);
});
for(const enabled of [false,undefined,null])test(`feature flag ${String(enabled)} exposes neither image nor retry`,t=>{
 const h=fixture(t);h.ctx.messageImagesEnabled=enabled;h.render();assert(!h.imageNode());assert(!h.retryButton());
});
test('disabling the image feature removes an already failed image retry',t=>{
 const h=fixture(t);h.render();h.error();assert(h.retryButton());h.ctx.messageImagesEnabled=false;h.render();assert(!h.imageNode());assert(!h.retryButton());
});
test('a retracted message removes the failed image retry even if a stale image projection exists',t=>{
 const h=fixture(t);h.render();h.error();assert(h.retryButton());
 h.state.thread={...h.state.thread,items:[{...baseMessage,retracted_at:'2026-11-04T10:10:00Z',body:''}]};h.render();
 assert(!h.imageNode());assert(!h.retryButton());assert.equal(h.container.textContent.includes('retracted'),true);assert.equal(h.state.requests.length,0);
});
test('removing the image projection removes the failed image retry',t=>{
 const h=fixture(t);h.render();h.error();assert(h.retryButton());
 h.state.thread={...h.state.thread,items:[{...baseMessage,image:undefined}]};h.render();assert(!h.imageNode());assert(!h.retryButton());
});
test('removing a message removes its retry without disturbing another message',t=>{
 const h=fixture(t);const other={...baseMessage,message_id:'20000000-0000-4000-8000-000000000005'};h.state.thread.items.push(other);h.render();h.error(baseMessage.message_id);assert(h.retryButton());
 const image=h.imageNode();h.state.thread={...h.state.thread,items:[other]};h.render();assert(!h.retryButton());assert.equal(h.imageNode()===image,true);
});
test('sent images use the same explicit retry without issuing another send',t=>{
 const h=fixture(t);h.state.thread.items=[{...baseMessage,sender_ref:me,recipient_ref:peer}];h.render();
 const row=h.find(n=>n.getAttribute('data-message-id')===baseMessage.message_id);assert.equal(row?.getAttribute('class'),'is-mine');
 h.error();h.retry();assert(h.imageNode());assert.equal(h.state.requests.length,0);
});
test('thread unmount clears failed local image state, without carrying retry into a later thread',t=>{
 const h=fixture(t);h.render();h.error();assert(h.retryButton());const saved=h.state.thread;h.state.thread=null;h.render();assert(!h.retryButton());
 h.state.thread=saved;h.render();assert(h.imageNode());assert(!h.retryButton());
});
