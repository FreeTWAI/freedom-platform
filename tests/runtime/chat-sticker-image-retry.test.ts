import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
import * as stickers from '../../modules/member-communications/stickers';
import ts from '@typescript/typescript6';
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


HostNode.prototype.focus=function(){this.ownerDocument.activeElement=this;};
const source=readFileSync(new URL('../../apps/portal-web/src/modules/ChatContent.tsx',import.meta.url),'utf8');
const module={exports:{} as any};
runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,require(name:string){
 if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name.endsWith('/stickers'))return stickers;if(name.endsWith('.css'))return {};throw new Error(`Unexpected dependency ${name}`);
}});
const descendants=(node:HostNode):HostNode[]=>[node,...node.childNodes.flatMap(descendants)];
const props=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
const me='10000000-0000-4000-8000-000000000001',peer='10000000-0000-4000-8000-000000000002',messageId='10000000-0000-4000-8000-000000000003';
const supplied=stickers.CHAT_STICKERS.find(s=>'image' in s)!,legacy=stickers.CHAT_STICKERS.find(s=>!('image' in s))!;
function hostFile(kind:'direct'|'channel'){return readFileSync(new URL(`../../apps/portal-web/src/modules/${kind==='direct'?'MemberMessages':'MemberChannels'}.tsx`,import.meta.url),'utf8');}
function historySource(kind:'direct'|'channel'){
 const path=kind==='direct'?'MemberMessages':'MemberChannels',file=hostFile(kind);
 const ast=ts.createSourceFile(path+'.tsx',file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===(kind==='direct'?'DirectMessages':'MemberChannels'));assert(component&&ts.isFunctionDeclaration(component)&&component.body);
 const history=component.body.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text==='messageHistory'));assert(history);return file.slice(history.getStart(ast),history.end);
}
function fixture(t:TestContext,kind:'direct'|'channel'='direct',id:string=supplied.id){
 const sticker=stickers.findChatSticker(id);const state={items:[{message_id:messageId,sender_ref:peer,sender_name:'Synthetic peer',recipient_ref:me,body:sticker?`[貼圖] ${sticker.label}`:'legacy text',created_at:'2026-11-04T00:00:00Z',read_at:'2026-11-04T00:01:00Z',sticker:sticker?{id,label:sticker.label}:undefined}] as any[],submits:0};
 const pending=hostFile(kind).split('\n').find(line=>line.includes('{attempt&&<div className="messages-pending"'));assert(pending);
 const no=()=>{};const context:any={React,useState:React.useState,useMemo:React.useMemo,ChatBody:module.exports.ChatBody,ChatRetracted:module.exports.ChatRetracted,ChatQuote:module.exports.ChatQuote,
 ChatTime:({value}:any)=>React.createElement('time',null,value),ReportButton:()=>null,DirectMessageImage:()=>null,
 findChatSticker:stickers.findChatSticker,peer,me,key:'guild',attempt:undefined,retracting:false,messageImagesEnabled:false,changeRichDraft:no,uid:'test',calendarKey:'same',held:{current:{}},retractTrigger:{current:null},setRetractError:no,setRetractTarget:no,document,state};
 const code=`function History({items,hidden=false}){const thread={items,participant:{user_id:peer,display_name:'Synthetic peer'},can_send:true},history={items};const [draft,setDraft]=useState('unsent text');${historySource(kind)};return <section hidden={hidden}>{messageHistory}${pending}<form onSubmit={e=>{e.preventDefault();state.submits++;}}><textarea aria-label="Synthetic draft" value={draft} onChange={e=>setDraft(e.target.value)}/><button type="submit">send</button></form></section>;};globalThis.History=History;`;
 runInNewContext(transformSync(code,{loader:'tsx',format:'cjs'}).code,context);
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);
 t.after(()=>{flush(()=>root.unmount());document.body.removeChild(container);});
 const render=(hidden=false)=>flush(()=>root.render(React.createElement(context.History,{items:state.items,hidden})));
 const find=(p:(node:HostNode)=>boolean)=>descendants(container).find(p),image=()=>find(n=>n.nodeName==='IMG'),retry=()=>find(n=>n.nodeName==='BUTTON'&&n.textContent==='重試貼圖');
 const error=(node=image())=>{assert(node);flush(()=>props(node).onError({currentTarget:node,target:node}));};
 const clickRetry=()=>{const button=retry();assert(button,'explicit sticker image retry is missing');assert.equal(props(button).type,'button');flush(()=>props(button).onClick());};
 render();return {state,ctx:context,render,container,find,image,retry,error,clickRetry};
}
// Run the entire production ChatContent module and actual host history JSX with
// real React. Only host DOM primitives and unrelated row components are fakes.
// This does not emulate network image loading, native focus, browser layout or SQL.
for(const kind of ['direct','channel'] as const)for(const sticker of [supplied,legacy])test(`${kind} ${sticker.id} can explicitly recover after a same-message refresh`,t=>{
 const h=fixture(t,kind,sticker.id),original=h.image()!;assert(original);const url=original.src;assert.equal(url,'image' in sticker?sticker.image:stickers.CHAT_STICKER_ATLAS);h.error();assert.equal(Boolean(h.image()),false);assert(h.container.textContent.includes(`[貼圖] ${sticker.label}`));
 h.state.items=h.state.items.map(item=>({...item}));h.render();assert.equal(Boolean(h.image()),false);h.clickRetry();assert(h.image());assert.equal(h.image()!.src,url);assert.equal(h.image()===original,false);assert.equal(Boolean(h.retry()),false);assert.equal(h.state.submits,0);
});
for(const kind of ['direct','channel'] as const){
 test(`${kind} retry is explicit, repeatable and preserves its row, sibling and composer draft`,t=>{
  const h=fixture(t,kind);h.state.items.push({...h.state.items[0],message_id:'another-message'});h.render();
  const row=h.find(n=>n.getAttribute('data-message-id')==='another-message'),sibling=descendants(h.container).filter(n=>n.nodeName==='IMG')[1],input=h.find(n=>n.nodeName==='TEXTAREA')!;
  flush(()=>props(input).onChange({target:{value:'retained draft'}}));const url=h.image()!.src;
  for(let i=0;i<3;i++){h.error();h.render(true);h.render(false);assert.equal(Boolean(h.find(n=>n.nodeName==='IMG'&&n!==sibling)),false);assert(h.retry());h.clickRetry();assert.equal(h.image()!.src,url);assert.equal(h.state.submits,0);}
  assert.equal(h.find(n=>n.getAttribute('data-message-id')==='another-message')===row,true);assert(descendants(h.container).includes(sibling));assert.equal(props(input).value,'retained draft');
 });
 test(`${kind} healthy refresh retains its image and does not show retry`,t=>{
  const h=fixture(t,kind),image=h.image();h.state.items=h.state.items.map(item=>({...item}));h.render();assert.equal(h.image()===image,true);assert.equal(Boolean(h.retry()),false);
 });
 test(`${kind} retraction removes a failed image and its retry`,t=>{
  const h=fixture(t,kind);h.error();assert(h.retry());h.state.items=h.state.items.map(item=>({...item,retracted_at:'2026-11-04T01:00:00Z',body:''}));h.render();assert.equal(Boolean(h.image()),false);assert.equal(Boolean(h.retry()),false);assert(h.container.textContent.includes('這則訊息已收回'));
 });
 test(`${kind} removing the message removes retry without affecting another sticker`,t=>{
  const h=fixture(t,kind);h.state.items.push({...h.state.items[0],message_id:'another-message'});h.render();const other=descendants(h.container).filter(n=>n.nodeName==='IMG')[1];h.error();h.state.items=h.state.items.slice(0,1);h.render();assert.equal(Boolean(h.retry()),false);assert.equal(h.image()===other,true);
 });
 test(`${kind} an unknown pending send keeps its command, status and draft when only its picture is retried`,t=>{
  const h=fixture(t,kind);const attempt={body:'',payload:{sticker_id:supplied.id},status:'unknown',key:'retained-send-key'};h.ctx.attempt=attempt;h.render();const pending=h.find(n=>n.getAttribute('aria-label')==='傳送狀態')!;
  const image=descendants(pending).find(n=>n.nodeName==='IMG')!;h.error(image);assert(descendants(pending).some(n=>n.textContent==='重試貼圖'));h.clickRetry();assert(descendants(pending).some(n=>n.nodeName==='IMG'));assert.equal(h.ctx.attempt,attempt);assert.equal(h.state.submits,0);assert(pending.textContent.includes('尚未確認送出'));assert.equal(props(h.find(n=>n.nodeName==='TEXTAREA')!).value,'unsent text');
 });
 test(`${kind} retry is a secondary non-submit control outside the actual message composer`,t=>{
  const h=fixture(t,kind);h.error();const button=h.retry()!;assert.equal(button.getAttribute('class'),'btn btn-ghost');assert.equal(props(button).type,'button');let parent=button.parentNode;while(parent){assert.notEqual(parent.nodeName,'FORM');assert.notEqual(parent.nodeName,'BUTTON');parent=parent.parentNode;}
  h.clickRetry();const image=h.image()!;assert.equal(image.getAttribute('loading'),'lazy');assert.equal(image.getAttribute('decoding'),'async');assert.equal(image.getAttribute('alt'),'');assert.equal(image.parentNode!.getAttribute('role'),'img');assert.equal(image.parentNode!.getAttribute('aria-label'),`貼圖：${supplied.label}`);
 });
}
function standalone(t:TestContext,component:any,initial:any){
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);let current=initial;
 const render=(value=current)=>{current=value;flush(()=>root.render(React.createElement(component,current)));};t.after(()=>{flush(()=>root.unmount());document.body.removeChild(container);});render();
 const all=()=>descendants(container),find=(predicate:(n:HostNode)=>boolean)=>all().find(predicate);return {container,render,all,find};
}
test('the default sticker renderer remains non-interactive, including legacy social-comment hosts',t=>{
 const h=standalone(t,module.exports.ChatSticker,{id:supplied.id}),image=h.find(n=>n.nodeName==='IMG')!;flush(()=>props(image).onError());assert(h.container.textContent.includes(`[貼圖] ${supplied.label}`));assert.equal(h.all().filter(n=>n.nodeName==='BUTTON').length,0);
});
test('picker thumbnail failures never create nested retry buttons or dispatch a send',t=>{
 const sends:string[]=[],changes:any[]=[],h=standalone(t,module.exports.ChatExtras,{draft:{},onChange:(v:any)=>changes.push(v),onSendSticker:(id:string)=>sends.push(id),disabled:false,target:'peer'});
 const toggle=h.find(n=>n.nodeName==='BUTTON'&&n.getAttribute('aria-label')==='選擇貼圖')!;flush(()=>props(toggle).onClick());const images=h.all().filter(n=>n.nodeName==='IMG');assert.equal(images.length,48);flush(()=>{for(const img of images)props(img).onError();});
 assert.equal(h.all().filter(n=>n.nodeName==='IMG').length,0);assert.equal(h.all().some(n=>n.nodeName==='BUTTON'&&n.textContent==='重試貼圖'),false);
 for(const button of h.all().filter(n=>n.nodeName==='BUTTON')){let parent=button.parentNode;while(parent){assert.notEqual(parent.nodeName,'BUTTON');parent=parent.parentNode;}}
 assert.equal(sends.length,0);assert.equal(changes.length,0);
});
test('changing a failed sticker ID resets to the new registered source rather than retrying the old one',t=>{
 const h=standalone(t,module.exports.ChatBody,{message:{body:'[貼圖]',sticker:{id:supplied.id,label:supplied.label}}});flush(()=>props(h.find(n=>n.nodeName==='IMG')!).onError());
 h.render({message:{body:'[貼圖]',sticker:{id:legacy.id,label:legacy.label}}});assert.equal(h.find(n=>n.nodeName==='IMG')!.src,stickers.CHAT_STICKER_ATLAS);assert.equal(h.all().some(n=>n.nodeName==='BUTTON'),false);
});
test('unknown sticker IDs never become image URLs or retry controls',t=>{
 const h=standalone(t,module.exports.ChatBody,{message:{body:'[貼圖]',sticker:{id:'https://example.invalid/arbitrary.png',label:'invalid'}}});assert.equal(h.all().filter(n=>n.nodeName==='IMG'||n.nodeName==='BUTTON').length,0);
});
test('text-only messages keep their original rendering without image controls',t=>{
 const h=standalone(t,module.exports.ChatBody,{message:{body:'plain message'}});assert.equal(h.container.textContent,'plain message');assert.equal(h.find(n=>n.nodeName==='P')!.getAttribute('class'),'messages-body');assert.equal(h.all().filter(n=>n.nodeName==='IMG'||n.nodeName==='BUTTON').length,0);
});
