import assert from 'node:assert/strict';
import {test,after,mock} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {createElement,act} from 'react';
import {createRoot} from 'react-dom/client';
import type {CommunityEvent} from '../../apps/portal-web/src/modules/EventsPanel.js';

mock.timers.enable({apis:['Date'],now:new Date('2026-01-15T12:00:00Z')});
after(()=>mock.timers.reset());

// React and ReactDOM are real. This small in-memory DOM host supports their mount,
// reconciliation and delegated click events, not browser layout or native keyboard behavior.
// Those assertions live in event-calendar-current-month.spec.ts.
class DomNode {
  nodeType:number; nodeName:string; tagName:string; namespaceURI='http://www.w3.org/1999/xhtml';
  parentNode:DomNode|null=null; childNodes:DomNode[]=[]; attributes=new Map<string,string>();
  style:Record<string,string>={}; listeners=new Map<string,Set<(event:any)=>void>>();
  ownerDocument:DomDocument; private text=''; disabled=false;
  constructor(name:string,doc:DomDocument,type=1){this.nodeName=this.tagName=name.toUpperCase();this.nodeType=type;this.ownerDocument=doc;}
  get firstChild(){return this.childNodes[0]??null;}
  get lastChild(){return this.childNodes.at(-1)??null;}
  get nextSibling(){const nodes=this.parentNode?.childNodes??[];return nodes[nodes.indexOf(this)+1]??null;}
  appendChild(node:DomNode){node.parentNode?.removeChild(node);this.childNodes.push(node);node.parentNode=this;return node;}
  insertBefore(node:DomNode,before:DomNode){node.parentNode?.removeChild(node);this.childNodes.splice(this.childNodes.indexOf(before),0,node);node.parentNode=this;return node;}
  removeChild(node:DomNode){this.childNodes.splice(this.childNodes.indexOf(node),1);node.parentNode=null;return node;}
  setAttribute(name:string,value:unknown){this.attributes.set(name,String(value));if(name==='disabled')this.disabled=true;}
  removeAttribute(name:string){this.attributes.delete(name);if(name==='disabled')this.disabled=false;}
  getAttribute(name:string){return this.attributes.get(name)??null;}
  get textContent():string{return this.text+this.childNodes.map(node=>node.textContent).join('');}
  set textContent(value:string){this.childNodes.forEach(node=>node.parentNode=null);this.childNodes=[];this.text=String(value);}
  get nodeValue(){return this.text;} set nodeValue(value:string){this.text=String(value);}
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
Object.assign(globalThis,{window:doc.defaultView,document:doc,IS_REACT_ACT_ENVIRONMENT:true});
after(()=>Object.assign(globalThis,{window:originalGlobals.window,document:originalGlobals.document,IS_REACT_ACT_ENVIRONMENT:originalGlobals.act}));
const require=createRequire(import.meta.url),module={exports:{} as {EventCalendar:React.ComponentType<{events:CommunityEvent[];onOpen:(id:string)=>void}>}};
const source=readFileSync(new URL('../../apps/portal-web/src/modules/EventCalendar.tsx',import.meta.url),'utf8');
const compiled=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
// Only CSS has no meaning in this DOM host. The complete production TSX and its
// real React imports execute unchanged; state and handlers are never reimplemented.
runInNewContext(compiled,{module,exports:module.exports,require:(name:string)=>name.endsWith('.css')?{}:require(name),Date});
function all(node:DomNode):DomNode[]{return [node,...node.childNodes.flatMap(all)];}
function label(date:Date){return date.toLocaleDateString('zh-TW',{year:'numeric',month:'long'});}
function key(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function event(id:string,start:Date,end=new Date(start.getTime()+3_600_000)):CommunityEvent{return {event_id:id,title:id,starts_at:start.toISOString(),ends_at:end.toISOString(),organizer_ref:'owner',organizer_name:'主辦',description:'',mode:'online',location:'',event_kind:'other',topic:null,online_url:null,visibility:'open',banner_url:null,banner_orientation:null,video_url:null,video_mime:null,capacity:null,state:'published',aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null};}
async function mount(events:CommunityEvent[]=[]){const container=doc.body.appendChild(doc.createElement('div')),root=createRoot(container as unknown as HTMLElement),opened:string[]=[];
  const update=(items:CommunityEvent[])=>root.render(createElement(module.exports.EventCalendar,{events:items,onOpen:id=>opened.push(id)}));
  const render=async(items:CommunityEvent[])=>{await act(async()=>update(items));};
  await render(events);
  const nodes=()=>all(container),button=(name:string)=>{const found=nodes().find(node=>node.tagName==='BUTTON'&&(node.getAttribute('aria-label')??node.textContent)===name);assert.ok(found,`button ${name} must exist`);return found;};
  return {container,opened,render,update,nodes,button,month:()=>nodes().find(node=>node.getAttribute('role')==='grid')?.getAttribute('aria-label'),click:async(name:string)=>{await act(async()=>button(name).click());},close:async()=>{await act(async()=>root.unmount());doc.body.removeChild(container);}};
}

test('existing navigation takes twelve next-month clicks to return from the empty-list past limit',async()=>{
  const h=await mount();try{const now=new Date();for(let i=0;i<12;i++)await h.click('上個月');assert.equal(h.button('上個月').disabled,true);assert.equal(h.month(),label(new Date(now.getFullYear(),now.getMonth()-12,1)));
    for(let i=1;i<=12;i++){await h.click('下個月');assert.equal(h.month(),label(new Date(now.getFullYear(),now.getMonth()-12+i,1)));}
    assert.equal(h.month(),label(now));
  }finally{await h.close();}
});

test('one current-month command returns from the past limit, remains mounted and preserves focus',async()=>{
  const h=await mount();try{const now=new Date(),button=h.button('回到本月');assert.equal(button.getAttribute('type'),'button');assert.equal(button.getAttribute('aria-pressed'),null);assert.ok(h.nodes().some(node=>node.textContent==='目前顯示本月'));
    for(let i=0;i<12;i++)await h.click('上個月');assert.equal(h.nodes().some(node=>node.textContent==='目前顯示本月'),false);
    button.focus();await h.click('回到本月');assert.equal(h.month(),label(now));assert.equal(h.button('回到本月'),button);assert.equal(button.disabled,false);assert.equal(doc.activeElement,button);assert.equal(h.button('上個月').disabled,false);
    await h.click('回到本月');assert.equal(h.month(),label(now));assert.equal(doc.activeElement,button);assert.deepEqual(h.opened,[]);
  }finally{await h.close();}
});

test('return works across years, from future months and after repeated mixed navigation',async()=>{
  const h=await mount();try{const now=new Date();for(const offset of [15,-8,25,-12]){const direction=offset>0?'下個月':'上個月';for(let i=0;i<Math.abs(offset);i++)await h.click(direction);assert.equal(h.month(),label(new Date(now.getFullYear(),now.getMonth()+offset,1)));await h.click('回到本月');assert.equal(h.month(),label(now));}
    for(const direction of ['下個月','下個月','上個月','下個月','上個月'])await h.click(direction);await h.click('回到本月');assert.equal(h.month(),label(now));
  }finally{await h.close();}
});

test('prop updates retain browsing, update the oldest limit and return shows current events, ended labels and today',async()=>{
  const now=new Date(),old=new Date(now.getFullYear(),now.getMonth()-18,4,12),todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate(),0),ended=event('已結束活動',todayStart,new Date(Date.now()-1)),future=event('接下來活動',todayStart,new Date(Date.now()+86_400_000));
  const h=await mount([event('舊活動',old)]);try{for(let i=0;i<18;i++)await h.click('上個月');assert.equal(h.button('上個月').disabled,true);await h.click('舊活動，已結束');assert.deepEqual(h.opened,['舊活動']);
    await h.render([ended]);assert.equal(h.month(),label(old));assert.equal(h.button('上個月').disabled,true);
    await act(async()=>{h.update([ended,future]);h.button('回到本月').click();});assert.equal(h.month(),label(now));assert.deepEqual(h.opened,['舊活動']);
    const today=h.nodes().filter(node=>node.getAttribute('data-today')==='true');assert.equal(today.length,1);assert.equal(today[0].childNodes[0].getAttribute('dateTime'),key(now));
    assert.equal(h.button('已結束活動，已結束').getAttribute('data-ended'),'true');assert.equal(h.button('接下來活動').getAttribute('data-ended'),'false');await h.click('接下來活動');assert.deepEqual(h.opened,['舊活動','接下來活動']);
    await h.render([]);assert.equal(h.nodes().filter(node=>node.tagName==='BUTTON').length,3);for(let i=0;i<12;i++)await h.click('上個月');assert.equal(h.button('上個月').disabled,true);await h.click('回到本月');assert.equal(h.month(),label(now));
  }finally{await h.close();}
});

test('event day grouping keeps device-local date semantics near a UTC month boundary',async()=>{
  const now=new Date(),boundary=new Date(Date.UTC(now.getFullYear(),now.getMonth(),1,0,30)),h=await mount([event('跨時區活動',boundary)]);
  try{const delta=(boundary.getFullYear()-now.getFullYear())*12+boundary.getMonth()-now.getMonth();for(let i=0;i<Math.abs(delta);i++)await h.click(delta<0?'上個月':'下個月');const chip=h.nodes().find(node=>node.tagName==='BUTTON'&&node.textContent.startsWith('跨時區活動'));assert.ok(chip);assert.equal(chip.parentNode?.parentNode?.childNodes[0].getAttribute('dateTime'),key(boundary));await h.click('回到本月');assert.equal(h.month(),label(now));}finally{await h.close();}
});
