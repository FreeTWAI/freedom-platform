import * as PortalRoute from '../../apps/portal-web/src/portal-route.js';
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as ReactRuntime from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import {createElement,act} from 'react';
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
const originalGlobals={window:globalThis.window,document:globalThis.document,act:(globalThis as any).IS_REACT_ACT_ENVIRONMENT,fetch:globalThis.fetch};
const doc=new DomDocument();
const windowListeners=new Map<string,Set<()=>void>>();
Object.assign(doc.defaultView,{confirm:()=>true,location:{hash:'#highlights',origin:'https://fixture.invalid'},addEventListener(name:string,fn:()=>void){let bucket=windowListeners.get(name);if(!bucket)windowListeners.set(name,bucket=new Set());bucket.add(fn);},removeEventListener(name:string,fn:()=>void){windowListeners.get(name)?.delete(fn);}});
Object.assign(globalThis,{window:doc.defaultView,document:doc,IS_REACT_ACT_ENVIRONMENT:true});
after(()=>Object.assign(globalThis,{window:originalGlobals.window,document:originalGlobals.document,IS_REACT_ACT_ENVIRONMENT:originalGlobals.act,fetch:originalGlobals.fetch}));
const outcomesModule={exports:{}};
const common=(name:string)=>{if(name==='../portal-route')return PortalRoute;if(name==='react')return ReactRuntime;if(name==='react/jsx-runtime')return JSXRuntime;if(name==='../api')return ApiRuntime;throw new Error(`Unexpected import: ${name}`);};
runInNewContext(transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/EventOutcomes.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module:outcomesModule,exports:outcomesModule.exports,require:common});
const module={exports:{} as {EventHighlights:React.ComponentType<{client:any}>}};
const source=readFileSync(new URL('../../apps/portal-web/src/modules/EventHighlights.tsx',import.meta.url),'utf8');
runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,require:(name:string)=>{if(name==='./EventHighlights.css')return {};if(name==='./EventOutcomes')return outcomesModule.exports;if(name==='./highlight-media')return HighlightMedia;return common(name);},window:doc.defaultView,URLSearchParams,URL,Date,Intl,Error,crypto:globalThis.crypto});
function all(node:DomNode):DomNode[]{return [node,...node.childNodes.flatMap(all)];}
function deferred(){let resolve!:(value:any)=>void,reject!:(reason:any)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {resolve,reject,promise};}
const A='71000000-0000-4000-8000-000000000001',B='71000000-0000-4000-8000-000000000002';
function detail(title:string,id=A,visibility='open') {return {event_id:id,title,starts_at:'2026-01-01T01:00:00Z',ends_at:'2026-01-01T02:00:00Z',mode:'online',event_kind:'other',organizer_name:'合成主辦',attending_count:2,public_path:`/highlights/${id}`,cover:null,counts:{links:1,photos:0,posters:0},description:'合成回顧內容',banner_url:null,banner_orientation:null,visibility,can_upload:true,quota:{links:{remaining_for_me:2,remaining_for_event:3},photos:{remaining_for_me:2,remaining_for_event:3},posters:{remaining_for_me:2,remaining_for_event:3}},items:[{media_id:'71000000-0000-4000-8000-000000000003',kind:'link',title:'原有影片',url:'https://example.invalid/film',platform:'other',created_at:'2026-01-01T01:00:00Z',uploader:{user_id:'fixture',display_name:'合成會員',avatar_url:null},uploaded_by_organizer:false,can_remove:true}]};}
async function mount(){doc.defaultView.location.hash=`#highlights/${A}`;
  const requests:{path:string;method:string;read:ReturnType<typeof deferred>}[]=[],diagnostics:string[]=[];
  globalThis.fetch=async(input,init)=>{const path=String(input),method=init?.method??'GET';
    if(path==='/api/v1/me/client-errors'){diagnostics.push(path);return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});}
    assert.ok(path.startsWith('/api/v1/event-highlights'),'closed synthetic transport');
    const read=deferred();requests.push({path,method,read});return read.promise as Promise<Response>;
  };
  const client=new ApiRuntime.PortalClient({timeoutMs:60000});client.csrfToken='synthetic-session';
  const container=doc.body.appendChild(doc.createElement('div')),root=createRoot(container as unknown as HTMLElement);
  const render=()=>root.render(createElement(module.exports.EventHighlights,{client,key:`synthetic-user:${client.sessionGeneration}`}));
  await act(async()=>render());
  const nodes=()=>all(container),button=(name:string)=>{const found=nodes().find(n=>n.tagName==='BUTTON'&&n.textContent===name);assert.ok(found,`button ${name} must exist`);return found;};
  const reply=async(index:number,value:unknown,status=200)=>{await act(async()=>requests[index].read.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})));};
  return {requests,diagnostics,container,nodes,button,reply,
    route:async(hash:string)=>{await act(async()=>{doc.defaultView.location.hash=hash;for(const fn of windowListeners.get('hashchange')??[])fn();});},
    click:async(name:string)=>{await act(async()=>button(name).click());},
    fail:async(index:number,status=503)=>reply(index,{detail:'RAW_SERVER_DETAIL_MUST_NOT_LEAK'},status),
    network:async(index:number)=>{await act(async()=>requests[index].read.reject(new TypeError('synthetic network loss')));},
    remountSession:async()=>{await act(async()=>{client.csrfToken='synthetic-new-session';render();});},
    close:async()=>{await act(async()=>root.unmount());for(const request of requests)request.read.resolve(new Response('{}',{headers:{'Content-Type':'application/json'}}));await act(async()=>{});doc.body.removeChild(container);globalThis.fetch=originalGlobals.fetch;},
  };
}
function alerts(h:Awaited<ReturnType<typeof mount>>){return h.nodes().filter(node=>node.getAttribute('role')==='alert');}
function writes(h:Awaited<ReturnType<typeof mount>>){return h.requests.filter(request=>request.method!=='GET');}

test('initial detail 503 exposes a same-route GET retry and return link; synchronous clicks deduplicate',async()=>{const h=await mount();try{
  await h.fail(0);assert.equal(alerts(h)[0]?.textContent,'服務暫時無法回應（503）。請稍後重試。');
  assert.ok(!h.container.textContent.includes('RAW_SERVER_DETAIL'));assert.ok(!h.container.textContent.includes('還沒有海報'));
  assert.ok(h.nodes().some(n=>n.tagName==='A'&&n.getAttribute('href')==='#highlights'&&n.textContent==='返回活動集錦'));
  const retry=h.button('重試載入');await act(async()=>{retry.click();retry.click();});
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].path,h.requests[0].path);assert.equal(h.requests[1].method,'GET');
  await h.reply(1,detail('重試成功'));assert.ok(h.container.textContent.includes('重試成功'));assert.equal(alerts(h).length,0);assert.deepEqual(writes(h),[]);
}finally{await h.close();}});

test('network failure can recover repeatedly without navigation or media writes',async()=>{const h=await mount();try{
  await h.network(0);await h.click('重試載入');await h.fail(1);await h.click('重試載入');
  assert.equal(h.requests.length,3);await h.reply(2,detail('網路恢復'));assert.ok(h.container.textContent.includes('網路恢復'));assert.deepEqual(writes(h),[]);
}finally{await h.close();}});

test('missing and private detail retain their existing read and sharing behavior',async()=>{const h=await mount();try{
  await h.fail(0,404);assert.ok(h.container.textContent.includes('找不到這場活動集錦'));
  assert.equal(h.nodes().filter(n=>n.tagName==='BUTTON'&&n.textContent==='重試載入').length,0);
  await h.route(`#highlights/${B}`);await h.reply(1,detail('公會回顧',B,'guild'));
  assert.ok(h.container.textContent.includes('公會回顧'));assert.ok(h.container.textContent.includes('不提供匿名公開頁'));
  assert.equal(h.nodes().filter(n=>n.tagName==='BUTTON'&&n.textContent==='分享').length,0);assert.ok(h.container.textContent.includes('不代表實際出席'));
  assert.ok(h.nodes().some(n=>n.tagName==='A'&&n.getAttribute('href')==='https://example.invalid/film'));assert.deepEqual(writes(h),[]);
}finally{await h.close();}});

test('retry response cannot replace a different event or a newer visit to the same route',async()=>{const h=await mount();try{
  await h.fail(0);await h.click('重試載入');await h.route(`#highlights/${B}`);await h.reply(2,detail('目前B',B));
  await h.fail(1);assert.ok(h.container.textContent.includes('目前B'));assert.equal(alerts(h).length,0);
  await h.route(`#highlights/${A}`);await h.route(`#highlights/${B}`);await h.route(`#highlights/${A}`);
  await h.reply(5,detail('新A'));await h.reply(3,detail('過期A'));await h.fail(4);
  assert.ok(h.container.textContent.includes('新A'));assert.ok(!h.container.textContent.includes('過期A'));assert.equal(alerts(h).length,0);assert.deepEqual(writes(h),[]);
}finally{await h.close();}});

test('leaving detail and reentering drops both late errors and late success',async()=>{const h=await mount();try{
  await h.route('#highlights');await h.reply(1,{items:[],next_cursor:null});await h.fail(0);assert.equal(alerts(h).length,0);
  await h.route(`#highlights/${A}`);await h.route('#highlights');await h.reply(3,{items:[],next_cursor:null});
  await h.route(`#highlights/${A}`);await h.reply(4,detail('重新進入'));await h.reply(2,detail('離開前'));
  assert.ok(h.container.textContent.includes('重新進入'));assert.ok(!h.container.textContent.includes('離開前'));assert.deepEqual(writes(h),[]);
}finally{await h.close();}});

test('App-equivalent user:sessionGeneration remount rejects the prior read (native App covered separately)',async()=>{const h=await mount();try{
  await h.remountSession();await h.reply(1,detail('新登入'));await h.fail(0);
  assert.ok(h.container.textContent.includes('新登入'));assert.equal(alerts(h).length,0);assert.deepEqual(writes(h),[]);
}finally{await h.close();}});

test('successful media remove plus failed refresh recovers with GET only, never replays POST',async()=>{const h=await mount();try{
  await h.reply(0,detail('既有內容'));await h.click('移除');assert.equal(writes(h).length,1);
  await h.reply(1,{});assert.equal(h.requests[2].method,'GET');await h.fail(2);await h.click('重試載入');
  assert.equal(h.requests[3].method,'GET');assert.equal(writes(h).length,1);await h.reply(3,{...detail('更新完成'),items:[]});
  assert.ok(h.container.textContent.includes('更新完成'));assert.ok(!h.container.textContent.includes('原有影片'));assert.equal(writes(h).length,1);
}finally{await h.close();}});

for(const late of ['success','error'] as const)test(`newer explicit reload supersedes an older GET ${late} without suppressing media reload`,async()=>{const h=await mount();try{
  await h.reply(0,detail('原回顧'));const remove=h.button('移除');await act(async()=>{remove.click();remove.click();});
  assert.equal(writes(h).length,2);await h.reply(1,{});await h.reply(2,{});
  assert.deepEqual(h.requests.slice(3).map(r=>r.method),['GET','GET']);
  await h.reply(4,{...detail('最新回顧'),items:[]});if(late==='success')await h.reply(3,detail('過期回顧'));else await h.fail(3);
  assert.ok(h.container.textContent.includes('最新回顧'));assert.ok(!h.container.textContent.includes('過期回顧'));assert.equal(alerts(h).length,0);assert.equal(writes(h).length,2);
}finally{await h.close();}});
