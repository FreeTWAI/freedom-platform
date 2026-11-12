import * as PortalRoute from '../../apps/portal-web/src/portal-route.js';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as ReactRuntime from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import {createElement,act,Profiler} from 'react';
import {createRoot} from 'react-dom/client';
import * as ApiRuntime from '../../apps/portal-web/src/api.js';
import * as HighlightMedia from '../../apps/portal-web/src/modules/highlight-media.js';


// React and ReactDOM are real. This small in-memory DOM host supports their mount,
// reconciliation and delegated click events, not browser layout or native keyboard behavior.
// Native behavior and layout remain covered by event-highlights.spec.ts; this is not a browser run.
class DomNode {
  nodeType:number; nodeName:string; tagName:string; namespaceURI='http://www.w3.org/1999/xhtml';
  parentNode:DomNode|null=null; childNodes:DomNode[]=[]; attributes=new Map<string,string>();
  style:Record<string,string>={}; listeners=new Map<string,Set<(event:any)=>void>>();
  ownerDocument:DomDocument; private text=''; disabled=false;
  constructor(name:string,doc:DomDocument,type=1){this.nodeName=this.tagName=name.toUpperCase();this.nodeType=type;this.ownerDocument=doc;}
  get firstChild():DomNode|null{return this.childNodes[0]??null;}
  get lastChild():DomNode|null{return this.childNodes.at(-1)??null;}
  get nextSibling():DomNode|null{const nodes=this.parentNode?.childNodes??[];return nodes[nodes.indexOf(this)+1]??null;}
  appendChild(node:DomNode){node.parentNode?.removeChild(node);this.childNodes.push(node);node.parentNode=this;return node;}
  insertBefore(node:DomNode,before:DomNode){node.parentNode?.removeChild(node);this.childNodes.splice(this.childNodes.indexOf(before),0,node);node.parentNode=this;return node;}
  removeChild(node:DomNode){this.childNodes.splice(this.childNodes.indexOf(node),1);node.parentNode=null;return node;}
  setAttribute(name:string,value:unknown){this.attributes.set(name,String(value));if(name==='disabled')this.disabled=true;}
  removeAttribute(name:string){this.attributes.delete(name);if(name==='disabled')this.disabled=false;}
  getAttribute(name:string){return this.attributes.get(name)??null;}
  get textContent():string{return this.text+this.childNodes.map(node=>node.textContent).join('');}
  set textContent(value:string){this.childNodes.forEach(node=>node.parentNode=null);this.childNodes=[];this.text=String(value);}
  get nodeValue():string{return this.text;} set nodeValue(value:string){this.text=String(value);}
  addEventListener(name:string,listener:(event:any)=>void){let listeners=this.listeners.get(name);if(!listeners)this.listeners.set(name,listeners=new Set());listeners.add(listener);}
  removeEventListener(name:string,listener:(event:any)=>void){this.listeners.get(name)?.delete(listener);}
  contains(node:DomNode):boolean{return this===node||this.childNodes.some(child=>child.contains(node));}
  focus(){this.ownerDocument.activeElement=this;}
  click(){if(this.disabled)return;const event={type:'click',target:this,button:0,bubbles:true,defaultPrevented:false,stopPropagation(){},preventDefault(){this.defaultPrevented=true;}};
    for(let node:DomNode|null=this;node;node=node.parentNode)for(const listener of node.listeners.get('click')??[])listener(event);}
}
class DomDocument extends DomNode {
  documentElement:DomNode;body:DomNode;activeElement:DomNode;defaultView:any;
  constructor(){super('#document',null as unknown as DomDocument,9);this.ownerDocument=this;this.documentElement=this.appendChild(new DomNode('html',this));this.body=this.documentElement.appendChild(new DomNode('body',this));this.activeElement=this.body;this.defaultView={document:this,HTMLIFrameElement:class{},HTMLElement:DomNode,Node:DomNode};}
  createElement(name:string){return new DomNode(name,this);}
  createElementNS(_namespace:string,name:string){return this.createElement(name);}
  createTextNode(text:string){const node=new DomNode('#text',this,3);node.nodeValue=text;return node;}
}
const originalGlobals={window:globalThis.window,document:globalThis.document,act:(globalThis as any).IS_REACT_ACT_ENVIRONMENT};
const doc=new DomDocument();
const windowListeners=new Map<string,Set<()=>void>>();
Object.assign(doc.defaultView,{location:{hash:'#highlights',origin:'https://fixture.invalid'},addEventListener(name:string,fn:()=>void){let bucket=windowListeners.get(name);if(!bucket)windowListeners.set(name,bucket=new Set());bucket.add(fn);},removeEventListener(name:string,fn:()=>void){windowListeners.get(name)?.delete(fn);}});
Object.assign(globalThis,{window:doc.defaultView,document:doc,IS_REACT_ACT_ENVIRONMENT:true});
after(()=>Object.assign(globalThis,{window:originalGlobals.window,document:originalGlobals.document,IS_REACT_ACT_ENVIRONMENT:originalGlobals.act}));
const outcomesModule={exports:{}};
const common=(name:string)=>{if(name==='../portal-route')return PortalRoute;if(name==='react')return ReactRuntime;if(name==='react/jsx-runtime')return JSXRuntime;if(name==='../api')return ApiRuntime;throw new Error(`Unexpected import: ${name}`);};
runInNewContext(transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/EventOutcomes.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module:outcomesModule,exports:outcomesModule.exports,require:common});
const module={exports:{} as {EventHighlights:React.ComponentType<{client:any}>}};
const source=readFileSync(new URL('../../apps/portal-web/src/modules/EventHighlights.tsx',import.meta.url),'utf8');
runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,require:(name:string)=>{if(name==='./EventHighlights.css')return {};if(name==='./EventOutcomes')return outcomesModule.exports;if(name==='./highlight-media')return HighlightMedia;return common(name);},window:doc.defaultView,URLSearchParams,URL,Date,Intl,Error});
function all(node:DomNode):DomNode[]{return [node,...node.childNodes.flatMap(all)];}
function deferred(){let resolve!:(value:any)=>void,reject!:(reason:any)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {resolve,reject,promise};}
function card(title:string,mode='online'){return {event_id:title,title,starts_at:'2026-01-01T01:00:00Z',ends_at:'2026-01-01T02:00:00Z',mode,event_kind:'other',organizer_name:'合成主辦',attending_count:0,public_path:'/highlights/fixture',cover:null,counts:{links:0,photos:0,posters:0}};}
async function mount(){doc.defaultView.location.hash='#highlights';const requests:{path:string;read:ReturnType<typeof deferred>}[]=[],writes:string[]=[];
  const client={sessionGeneration:1,get(path:string){const read=deferred();requests.push({path,read});return read.promise;},post(path:string){writes.push(path);throw new Error('Unexpected write');}};
  const container=doc.body.appendChild(doc.createElement('div')),root=createRoot(container as unknown as HTMLElement);
  const commits:{selected:string|null;cards:(string|null)[]}[]=[];
  await act(async()=>root.render(createElement(Profiler,{id:'highlights',onRender:()=>{const nodes=all(container);commits.push({selected:nodes.find(n=>n.tagName==='BUTTON'&&n.getAttribute('aria-pressed')==='true')?.textContent??null,cards:nodes.filter(n=>n.tagName==='ARTICLE').map(n=>n.getAttribute('aria-label'))});}},createElement(module.exports.EventHighlights,{client}))));
  const nodes=()=>all(container),button=(name:string)=>{const found=nodes().find(n=>n.tagName==='BUTTON'&&n.textContent===name);assert.ok(found,`button ${name} must exist`);return found;};
  return {requests,writes,commits,container,nodes,button,route:async(hash:string)=>{await act(async()=>{doc.defaultView.location.hash=hash;for(const fn of windowListeners.get('hashchange')??[])fn();});},cards:()=>nodes().filter(n=>n.tagName==='ARTICLE').map(n=>n.getAttribute('aria-label')),click:async(name:string)=>{await act(async()=>button(name).click());},resolve:async(index:number,items:any[],cursor:string|null=null)=>{await act(async()=>requests[index].read.resolve({items,next_cursor:cursor}));},reject:async(index:number)=>{await act(async()=>requests[index].read.reject(new ApiRuntime.ApiError({message:'合成暫時錯誤',status:503})));},close:async()=>{await act(async()=>root.unmount());doc.body.removeChild(container);assert.deepEqual(writes,[]);}};
}

test('selected filter owns late first-page success, error and pending state',async()=>{const h=await mount();try{
  assert.equal(h.requests[0].path,'/event-highlights?mode=all');
  assert.ok(h.container.textContent.includes('正在載入活動集錦'));
  await h.click('線上');assert.equal(h.requests[1].path,'/event-highlights?mode=online');
  await h.resolve(1,[card('目前線上')],'online-page2');
  await h.resolve(0,[card('舊全部實體','in_person')],'all-page2');
  assert.equal(h.button('線上').getAttribute('aria-pressed'),'true');assert.deepEqual(h.cards(),['目前線上']);
  await h.click('載入更多');assert.equal(h.requests[2].path,'/event-highlights?mode=online&cursor=online-page2');
  await h.click('實體');assert.deepEqual(h.cards(),[]);
  await h.reject(2);assert.equal(h.nodes().filter(n=>n.getAttribute('role')==='alert').length,0);
  assert.ok(h.container.textContent.includes('正在載入活動集錦'));
  await h.resolve(3,[card('目前實體','in_person')]);assert.deepEqual(h.cards(),['目前實體']);
}finally{await h.close();}});

test('one synchronous page request survives repeated actual clicks and appends once',async()=>{const h=await mount();try{
  await h.resolve(0,[card('第一頁')],'page2');const more=h.button('載入更多');
  await act(async()=>{more.click();more.click();});
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].path,'/event-highlights?mode=all&cursor=page2');
  assert.equal(h.button('載入更多').disabled,true);assert.deepEqual(h.cards(),['第一頁']);
  await h.click('載入更多');assert.equal(h.requests.length,2);
  await h.resolve(1,[card('第二頁')]);assert.deepEqual(h.cards(),['第一頁','第二頁']);
  assert.equal(h.nodes().filter(n=>n.tagName==='BUTTON'&&n.textContent==='載入更多').length,0);
}finally{await h.close();}});

test('initial failure is not empty and explicit retry repeats the selected first page',async()=>{const h=await mount();try{
  await h.reject(0);assert.ok(!h.container.textContent.includes('還沒有已結束的活動'));
  assert.equal(h.nodes().filter(n=>n.getAttribute('role')==='alert').length,1);
  assert.equal(h.nodes().filter(n=>n.getAttribute('role')==='status').length,0);
  await h.click('全部');assert.equal(h.requests.length,1);
  const retry=h.button('重試載入');await act(async()=>{retry.click();retry.click();});assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].path,h.requests[0].path);await h.resolve(1,[card('重試成功')]);assert.deepEqual(h.cards(),['重試成功']);
  await h.click('線上');await h.reject(2);await h.click('重試載入');
  assert.equal(h.requests[3].path,'/event-highlights?mode=online');await h.resolve(3,[]);
  assert.ok(h.container.textContent.includes('還沒有已結束的活動'));
  assert.equal(h.nodes().filter(n=>n.getAttribute('role')==='alert').length,0);
}finally{await h.close();}});

test('failed next page preserves valid cards and retries its exact encoded cursor',async()=>{const h=await mount();try{
  await h.resolve(0,[card('第一頁')],'page+/= 2');await h.click('載入更多');await h.reject(1);
  assert.deepEqual(h.cards(),['第一頁']);assert.equal(h.nodes().filter(n=>n.getAttribute('role')==='alert').length,1);
  await h.click('重試載入');assert.equal(h.requests[1].path,h.requests[2].path);
  assert.equal(new URL(h.requests[2].path,'https://fixture.invalid').searchParams.get('cursor'),'page+/= 2');
  assert.deepEqual(h.cards(),['第一頁']);await h.resolve(2,[card('第二頁')]);assert.deepEqual(h.cards(),['第一頁','第二頁']);
  assert.equal(h.nodes().filter(n=>n.getAttribute('role')==='alert').length,0);
}finally{await h.close();}});

test('old pagination cannot append to another filter or restore its cursor',async()=>{const h=await mount();try{
  await h.resolve(0,[card('全部第一頁')],'all-page2');await h.click('載入更多');
  await h.click('線上');assert.deepEqual(h.cards(),[]);await h.resolve(2,[card('線上第一頁')],'online-page2');
  await h.click('載入更多');await h.resolve(1,[card('舊全部第二頁','in_person')],'all-page3');
  assert.deepEqual(h.cards(),['線上第一頁']);assert.equal(h.button('載入更多').disabled,true);
  await h.click('載入更多');assert.equal(h.requests.length,4);
  await h.resolve(3,[card('線上第二頁')]);assert.deepEqual(h.cards(),['線上第一頁','線上第二頁']);
}finally{await h.close();}});

test('all-online-all round trips reject the former all read, including clicks before commit',async()=>{const h=await mount();try{
  await h.click('線上');await h.click('全部');assert.equal(h.requests.length,3);
  await h.resolve(2,[card('新的全部')]);await h.resolve(0,[card('舊的全部')]);await h.reject(1);
  assert.deepEqual(h.cards(),['新的全部']);assert.equal(h.nodes().filter(n=>n.getAttribute('role')==='alert').length,0);
  await act(async()=>{h.button('線上').click();h.button('全部').click();});
  assert.equal(h.requests.length,4);assert.equal(h.requests[3].path,'/event-highlights?mode=all');
  await h.resolve(3,[card('快速返回全部')]);assert.deepEqual(h.cards(),['快速返回全部']);
}finally{await h.close();}});

test('leaving for detail and reentering creates a fresh list owner',async()=>{const h=await mount();try{
  const id='71000000-0000-4000-8000-000000000001';
  await h.route(`#highlights/${id}`);assert.equal(h.requests[1].path,`/event-highlights/${id}`);
  await h.route('#highlights');assert.equal(h.requests[2].path,'/event-highlights?mode=all');
  await h.resolve(2,[card('重新進入')]);await h.resolve(0,[card('離開前')]);await h.reject(1);
  assert.deepEqual(h.cards(),['重新進入']);assert.equal(h.nodes().filter(n=>n.getAttribute('role')==='alert').length,0);
}finally{await h.close();}});

test('normal cards retain order, Taipei dates, detail links and read-only behavior',async()=>{const h=await mount();try{
  const first={...card('跨日活動'),event_id:'71000000-0000-4000-8000-000000000001',starts_at:'2026-01-01T16:00:00Z',ends_at:'2026-01-01T17:00:00Z'};
  await h.resolve(0,[first,card('混合活動','hybrid')]);assert.deepEqual(h.cards(),['跨日活動','混合活動']);
  assert.ok(h.container.textContent.includes('2026/01/02 00:00–01:00'));assert.ok(h.container.textContent.includes('線上＋實體'));
  const links=h.nodes().filter(n=>n.tagName==='A'&&n.textContent==='跨日活動');assert.equal(links[0].getAttribute('href'),`#highlights/${first.event_id}`);
  assert.ok(h.container.textContent.includes('仍依目前閱讀權限'));
  await h.click('全部');assert.equal(h.requests.length,1);assert.deepEqual(h.writes,[]);
}finally{await h.close();}});

test('each real React commit clears old cards before displaying a different selected filter',async()=>{const h=await mount();try{
  await h.resolve(0,[card('全部原卡')],'old-page');await h.click('載入更多');
  await h.click('線上');
  assert.ok(h.commits.filter(commit=>commit.selected==='線上').every(commit=>commit.cards.length===0),JSON.stringify(h.commits));
  await h.resolve(2,[card('線上原卡')],'online-page');
  await h.resolve(1,[card('全部晚到卡')]);await h.click('載入更多');
  await h.click('實體');await h.reject(3);await h.resolve(4,[card('實體原卡','in_person')]);
  assert.ok(h.commits.length>8,'Profiler must observe intermediate real commits');
  for(const commit of h.commits){
    const allowed=commit.selected==='全部'?['全部原卡']:commit.selected==='線上'?['線上原卡']:['實體原卡'];
    assert.ok(commit.cards.every(title=>allowed.includes(title!)),JSON.stringify(commit));
  }
}finally{await h.close();}});
