import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildSync,transformSync} from 'esbuild';
import React from 'react';
class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style:Record<string,any> = {setProperty() {}, removeProperty() {}};
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
  get options(): HostNode[] {return this.childNodes.flatMap(node=>node.nodeName==='OPTION'?[node]:node.options);}
  get firstChild(): HostNode | null {return this.childNodes[0] ?? null;}
  get lastChild(): HostNode | null {return this.childNodes.at(-1) ?? null;}
  get nextSibling(): HostNode | null {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;}
  get textContent(): string {return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join('');}
  set textContent(value: string) {this.childNodes.forEach(node => {node.parentNode = null;}); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  get parentElement():HostNode|null {return this.parentNode?.nodeType===1?this.parentNode:null;}
  setCustomValidity(value:string){this.validationMessage=value;}
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
const window:any = {location:{origin:'https://fixture.invalid'},setTimeout(fn:Function){const id=++nextTimer;scheduled.set(id,fn);return id;},clearTimeout(id:number){scheduled.delete(id);},open(){throw Error('No external navigation permitted');},document, HTMLElement: HostNode, HTMLIFrameElement: class {}, listeners:{} as Record<string,Function[]>, addEventListener(type:string,fn:Function) {(this.listeners[type]??=[]).push(fn);}, removeEventListener(type:string,fn:Function) {this.listeners[type]=(this.listeners[type]??[]).filter((x:Function)=>x!==fn);}, dispatchEvent(e:any) {for(const fn of [...(this.listeners[e.type]??[])])fn(e);return true;}, get event() {return undefined;}};
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
document.getElementById=(id:string)=>descendants(document).find(node=>node.attributes.id===id)??null;
const matches=(node:HostNode,selector:string)=>{
 if(selector.startsWith('.'))return (node.attributes.class??'').split(' ').includes(selector.slice(1));
 const attribute=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
 if(attribute)return Object.hasOwn(node.attributes,attribute[1])&&(attribute[2]===undefined||node.attributes[attribute[1]]===attribute[2]);
 return node.nodeName===selector.toUpperCase();
};
HostNode.prototype.querySelectorAll=function(selector:string){const rows=descendants(this).filter(n=>matches(n,selector));return Object.assign(rows,{item:(i:number)=>rows[i]??null});};
HostNode.prototype.querySelector=function(selector:string){return this.querySelectorAll(selector).item(0);};
HostNode.prototype.hasAttribute=function(key:string){return Object.hasOwn(this.attributes,key);};
HostNode.prototype.dispatchEvent=function(event:any){
  event.target??=this;event.bubbles??=true;event.cancelBubble=false;event.defaultPrevented=false;
  event.preventDefault=()=>{event.defaultPrevented=true;};event.stopPropagation=()=>{event.cancelBubble=true;};
  const chain:HostNode[]=[];for(let n:HostNode|null=this;n;n=n.parentNode)chain.push(n);
  for(const n of [...chain].reverse()){event.currentTarget=n;for(const l of n.listeners[event.type]??[])if(l.capture)l.fn(event);if(event.cancelBubble)return !event.defaultPrevented;}
  for(const n of chain){event.currentTarget=n;for(const l of n.listeners[event.type]??[])if(!l.capture)l.fn(event);if(event.cancelBubble||!event.bubbles)break;}
  if(event.type==='click'&&!event.defaultPrevented&&this.nodeName==='SUMMARY'&&this.parentNode?.nodeName==='DETAILS'){const details=this.parentNode;if(details.hasAttribute('open'))details.removeAttribute('open');else details.setAttribute('open','');}
  event.currentTarget=null;return !event.defaultPrevented;
};

// Real ReactDOM + complete production components, with synthetic transport/host.
// Input changes below use a mounted React handler adapter, not a native keyboard.
// This proves state/ownership transitions, not browser geometry or validation UX.
window.confirm=()=>false;
const noNetwork=()=>{throw Error('Real network forbidden');};
const frame=(fn:()=>void)=>queueMicrotask(fn);
const bundled=buildSync({stdin:{contents:`export {EventsPanel,blankEvent,eventPayload} from './apps/portal-web/src/modules/EventsPanel'; export * from './apps/portal-web/src/modules/EventPrizeDetails'; export * from './apps/portal-web/src/modules/EventPrizeFields'; export {ApiError} from './apps/portal-web/src/api';`,resolveDir:process.cwd(),sourcefile:'event-prize-ui-entry.ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
const production={exports:{} as any};
runInNewContext(bundled.outputFiles[0].text,{module:production,exports:production.exports,crypto:webcrypto,Intl,URL,URLSearchParams,AbortController,Error,Event,CustomEvent:class{constructor(public type:string){}},Blob,console,window,document,HTMLElement:HostNode,HTMLDetailsElement:class{},navigator:{language:'zh-TW',languages:['zh-TW'],clipboard:{writeText:noNetwork}},fetch:noNetwork,requestAnimationFrame:frame,localStorage:{getItem(){return null;},setItem(){}},setTimeout,clearTimeout,require(name:string){if(name==='react')return React;if(name==='react/jsx-runtime')return require('react/jsx-runtime');if(name==='zod')return require('zod');throw Error(name);}});
const {EventsPanel,EventPrizeFields,EventPrizeDetails,newEventPrize,eventPrizePayload,eventPrizeDrafts,eventPrizeFieldError,ApiError}=production.exports;
const OWNER='30000000-0000-4000-8000-000000000001',ID='10000000-0000-4000-8000-000000000001';
const prize=()=>({...newEventPrize(),name:'合成獎品',description:'合成介紹',quantity:'3',icon_id:'book',completion_rule:'由主辦者評選作品',claim_note:'活動結束前當場領取'});
const stored=(patch:any={})=>({help_need:null,event_id:ID,organizer_ref:OWNER,organizer_name:'合成主辦',title:'合成活動',description:'合成說明',starts_at:'2099-01-01T12:00:00.000Z',ends_at:'2099-01-01T13:00:00.000Z',mode:'online',location:'合成場地',capacity:null,state:'pending',visibility:'workshop',event_kind:'other',topic:null,online_url:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,banner_url:null,banner_orientation:null,video_url:null,video_mime:null,attending_count:0,my_rsvp:null,aggregate_version:1,registration_policy:'community_member',prize_details:[],...patch});
const propsOf=(node:HostNode)=>node[Object.keys(node).find(k=>k.startsWith('__reactProps$'))!];
function host(t:TestContext,component:any,initial:any){
 const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container as unknown as HTMLElement);let props=initial,mounted=true;
 const render=()=>flush(()=>root.render(React.createElement(component,props)));render();
 const nodes=()=>descendants(container),button=(text:string)=>nodes().find(n=>n.nodeName==='BUTTON'&&n.textContent===text)!;
 const click=(node:HostNode)=>{assert(node,'mounted button');assert(!propsOf(node).disabled);flush(()=>node.dispatchEvent({type:'click',button:0}));};
 const field=(text:string)=>{const label=nodes().find(n=>n.nodeName==='LABEL'&&(n.textContent===text||n.textContent.startsWith(text)));assert(label,`label ${text}`);return label.attributes.for?nodes().find(n=>n.attributes.id===label.attributes.for)!:descendants(label).find(n=>['INPUT','TEXTAREA','SELECT'].includes(n.nodeName))!;};
 const change=(label:string,value:string)=>{const node=field(label);flush(()=>propsOf(node).onChange({target:{value},currentTarget:{value}}));};
 const unmount=()=>{if(mounted){flush(()=>root.unmount());document.body.removeChild(container);mounted=false;}};t.after(unmount);
 return {container,nodes,button,click,field,change,render,unmount,setProps(next:any){props=next;render();},text:()=>container.textContent};
}
function panel(t:TestContext){
 const requests:any[]=[],client:any={sessionGeneration:1,csrfToken:'synthetic'};for(const method of ['get','post','patch'])client[method]=(path:string,body?:any,options?:any)=>new Promise((resolve,reject)=>requests.push({method,path,body,options,resolve,reject}));
 let guard:(()=>boolean)|null=null;const props:any={client,session:{user:{user_id:OWNER}},locationHash:'#events',registerLeave:(value:any)=>{guard=value;},onList(){}};
 const h=host(t,EventsPanel,props),reads=()=>requests.filter(r=>r.method==='get'),writes=()=>requests.filter(r=>r.method!=='get');
 const settle=async(r:any,value:any,reject=false)=>{assert(r);await React.act(async()=>{r[reject?'reject':'resolve'](value);await new Promise(resolve=>setImmediate(resolve));});};
 const ready=async(items:any[]=[])=>{for(const r of reads().filter(r=>!r.done)){r.done=true;await settle(r,{items:r.path==='/events'?items:[]});}};
 const submit=(twice=false)=>{const form=h.nodes().find(n=>n.nodeName==='FORM');assert(form);flush(()=>{form.dispatchEvent({type:'submit'});if(twice)form.dispatchEvent({type:'submit'});});};
 return {...h,props,client,requests,reads,writes,settle,ready,submit,leave:()=>{let result:boolean|undefined;flush(()=>{result=guard?.();});return result;}};
}
const ack=(request:any,overrides:any={})=>stored({...request.body,state:request.path==='/events'?'published':'pending',aggregate_version:(request.options?.ifMatch??0)+1,...overrides});
const tuple=(r:any)=>JSON.stringify({path:r.path,body:r.body,options:r.options});
async function createWithPrize(h:ReturnType<typeof panel>){await h.ready();h.click(h.button('辦活動'));h.change('活動名稱','合成新活動');h.change('活動說明','合成新說明');h.change('地點','合成場地');h.click(h.button('加入獎品'));h.change('獎品名稱','合成獎品');h.change('準備幾份','3');h.change('要做到什麼','完成現場練習，由主辦者評選');h.change('怎麼領取','主辦者在現場交付');}

test('draft IDs survive typing, rerender, controlled icon changes, payload snapshots and edit conversion',t=>{
 let value=[prize()];const first=value[0].prize_id;let h:any;const props=()=>({value,onChange:(next:any)=>{value=next;h.setProps(props());}});h=host(t,EventPrizeFields,props());
 h.change('獎品名稱','改名');h.render();const radio=h.nodes().find((n:HostNode)=>n.nodeName==='INPUT'&&propsOf(n).type==='radio'&&propsOf(n).value==='medal');assert(radio);flush(()=>propsOf(radio).onChange({currentTarget:{checked:true}}));
 assert.equal(value[0].prize_id,first);assert.equal(value[0].icon_id,'medal');const payload=eventPrizePayload(value);value[0].name='後續變更';assert.equal(payload[0].name,'改名');assert.equal(eventPrizeDrafts(payload)[0].prize_id,first);
});
test('filled removal asks, cancel preserves fields and focus, confirmation removes only selected stable ID',t=>{
 let value=[prize(),{...prize(),name:'第二獎品'}],h:any;const ids=value.map(p=>p.prize_id);const props=()=>({value,onChange:(next:any)=>{value=next;h.setProps(props());}});h=host(t,EventPrizeFields,props());h.click(h.button('移除獎品 1'));assert.equal(value.length,2);assert.equal(document.activeElement,h.button('保留獎品'));h.click(h.button('保留獎品'));assert.deepEqual(value.map(p=>p.prize_id),ids);h.click(h.button('移除獎品 1'));h.click(h.button('確認移除'));assert.deepEqual(value.map(p=>p.prize_id),[ids[1]]);
});
test('required rule and claim errors have accessible associations and native validity',t=>{
 const h=host(t,EventPrizeFields,{value:[newEventPrize()],onChange(){}});for(const label of ['獎品名稱','要做到什麼','怎麼領取']){const input=h.field(label);assert(input.validationMessage);flush(()=>input.dispatchEvent({type:'invalid',bubbles:false}));assert.equal(input.attributes['aria-invalid'],'true');assert(h.nodes().some(n=>n.attributes.id===input.attributes['aria-describedby']&&n.textContent===input.validationMessage));}
 assert(eventPrizeFieldError('completion_rule','   '));assert(eventPrizeFieldError('quantity','1e2'));assert.equal(eventPrizeFieldError('description',''),'');
});
test('read-only details fail closed for invalid IDs, show old empty data without invented awards, and escape prose',t=>{
 const h=host(t,EventPrizeDetails,{value:undefined});assert.equal(h.text(),'');h.setProps({value:[{...eventPrizePayload([prize()])[0],icon_id:'unknown'}]});assert.match(h.text(),/獎品資料無法確認/);assert.equal(h.nodes().filter(n=>n.nodeName==='SVG').length,0);h.setProps({value:[{...eventPrizePayload([prize()])[0],name:'<img onerror=alert(1)>'}]});assert.match(h.text(),/<img onerror=alert\(1\)>/);assert.equal(h.nodes().filter(n=>n.nodeName==='IMG').length,0);assert.match(h.text(),/不代表已發獎/);
});
test('real panel freezes one exact save tuple on same-tick submit and unknown until canonical prize ACK',async t=>{
 const h=panel(t);await createWithPrize(h);h.submit(true);assert.equal(h.writes().length,1);const first=h.writes()[0],id=first.body.prize_details[0].prize_id;assert.equal(h.leave(),false);await h.settle(first,new ApiError({message:'lost reply',network:true}),true);h.submit();const retry=h.writes()[1];assert.equal(tuple(retry),tuple(first));await h.settle(retry,ack(retry,{prize_details:[]}));assert.equal(h.leave(),false);assert.doesNotMatch(h.text(),/活動已發布/);h.submit();assert.equal(tuple(h.writes()[2]),tuple(first));await h.settle(h.writes()[2],ack(first));assert.match(h.text(),/活動已發布/);assert.equal(h.writes()[2].body.prize_details[0].prize_id,id);assert.equal(h.leave(),true);
});
for(const change of ['client','session','user','unmount'])test(`late prize ACK cannot cross ${change}`,async t=>{
 const h=panel(t);await createWithPrize(h);h.submit();const first=h.writes()[0];if(change==='unmount')h.unmount();else{if(change==='client')h.props.client={...h.client};if(change==='session'){h.client.sessionGeneration++;h.client.csrfToken='replacement';}if(change==='user')h.props.session={user:{user_id:'30000000-0000-4000-8000-000000000002'}};h.setProps(h.props);}
 await h.settle(first,ack(first));assert.equal(h.writes().length,1);if(change!=='unmount'){assert.doesNotMatch(h.text(),/合成獎品|活動已發布/);await h.ready();h.click(h.button('辦活動'));assert.equal(h.field('活動名稱').value,'');assert.equal(h.button('移除獎品 1'),undefined);}
});
test('edit keeps server prize IDs, preserves unknown original version and rejects wrong-event receipt',async t=>{
 const h=panel(t),data=stored({aggregate_version:9,prize_details:eventPrizePayload([prize()])});await h.ready([data]);h.click(h.button('編輯草稿'));h.change('準備幾份','4');h.submit();const first=h.writes()[0];assert.equal(first.options.ifMatch,9);assert.equal(first.body.prize_details[0].prize_id,data.prize_details[0].prize_id);await h.settle(first,ack(first,{event_id:'10000000-0000-4000-8000-000000000002'}));assert.equal(h.leave(),false);h.submit();assert.equal(tuple(h.writes()[1]),tuple(first));await h.settle(h.writes()[1],ack(first));assert.match(h.text(),/活動已更新/);
});

test('event A prize details never render as event B while its GET is pending or late',async t=>{
 const h=panel(t);await h.ready();h.props.locationHash='#events/'+ID;h.setProps(h.props);
 const a=h.reads().find(r=>r.path==='/events/'+ID);await h.settle(a,stored({state:'published',prize_details:eventPrizePayload([prize()])}));assert.match(h.text(),/合成獎品/);
 const next='10000000-0000-4000-8000-000000000002';h.props.locationHash='#events/'+next;h.setProps(h.props);assert.doesNotMatch(h.text(),/合成獎品/);
 await h.settle(h.reads().find(r=>r.path==='/events/'+next),stored({event_id:next,state:'published',prize_details:[]}));assert.doesNotMatch(h.text(),/合成獎品/);
});

test('late newer event GET cannot silently rebase an older prize draft onto a new version',async t=>{
 const h=panel(t);h.props.locationHash='#events/'+ID;h.setProps(h.props);
 const original=stored({prize_details:eventPrizePayload([prize()])});await h.settle(h.reads().find(r=>r.path==='/events/'+ID),original);h.click(h.button('編輯草稿'));h.change('獎品名稱','尚未儲存的草稿獎品');
 await h.ready([stored({aggregate_version:2,prize_details:eventPrizePayload([{...prize(),name:'其他操作的新獎品'}])})]);
 assert.equal(h.field('獎品名稱').value,'尚未儲存的草稿獎品');h.submit();assert.equal(h.writes().length,0);assert.match(h.text(),/活動已有較新的版本/);assert.equal(h.field('獎品名稱').value,'尚未儲存的草稿獎品');
});

for(const [label,value] of [['null',null],['object',{}],['malformed array',[{name:'untrusted'}]],['unknown icon',[{...eventPrizePayload([prize()])[0],icon_id:'unknown'}]]])test(`malformed persisted prizes ${label} cannot be opened as an editable empty list`,async t=>{
 const h=panel(t);await h.ready([stored({prize_details:value})]);assert.match(h.text(),/獎品資料無法確認/);assert.equal(propsOf(h.button('編輯草稿')).disabled,true);assert.equal(h.writes().length,0);
});

test('shared event keyboard focus and prize fields use the declared semantic focus token',()=>{
 const root='apps/portal-web/src';
 for(const [file,selector] of [
  ['modules/EventsPanel.css','.event-flow :is(button,a,input,select,textarea,summary):focus-visible'],
  ['modules/EventPrizeDetails.css','.event-prize-editor :is(button,input,textarea):focus-visible'],
 ]){
  const source=readFileSync(path.join(root,file),'utf8');
  const declarations=[...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match=>match[1].trim()===selector);
  assert.equal(declarations.length,1,`${file} has one shared focus rule`);
  assert.match(declarations[0][2],/outline:\s*3px\s+solid\s+var\(--focus\)\s*;/,`${file} must not override keyboard focus with an undefined token`);
  assert.match(declarations[0][2],/outline-offset:\s*3px\s*;/);
 }
 // A source contract, not a replacement for native computed-style assertions.
 for(const theme of ['styles.css','rpg-theme.css','light-theme.css','versefolk-theme.css','dragon-theme.css']){
  const source=readFileSync(path.join(root,theme),'utf8');
  assert.match(source,/--focus:\s*#[a-fA-F0-9]{3,8}\s*;/,`${theme} declares the focus color`);
 }
});

test('calendar month label can shrink at enlarged text without shrinking navigation targets',()=>{
 const css=readFileSync('apps/portal-web/src/modules/EventCalendar.css','utf8');
 const rule=(selector:string)=>{const matches=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match=>match[1].trim()===selector);assert.equal(matches.length,1);return matches[0][2];};
 // The heading is a grid item: its automatic minimum otherwise keeps the whole
 // calendar at the nav's max-content width even when the nav itself can shrink.
 // Source sizing contract only. The native journey checks actual viewport geometry.
 for(const selector of ['.event-calendar','.event-calendar-heading'])assert.match(rule(selector),/min-width:\s*0(?:;|$)/);
 assert.match(rule('.event-calendar-nav'),/min-width:\s*0(?:;|$)/);
 assert.match(rule('.event-calendar-nav'),/max-width:\s*100%(?:;|$)/);
 assert.match(rule('.event-calendar-nav strong'),/width:\s*7rem(?:;|$)/);
 assert.match(rule('.event-calendar-nav strong'),/min-width:\s*0(?:;|$)/);
 assert.match(rule('.event-calendar-nav strong'),/overflow-wrap:\s*anywhere(?:;|$)/);
 const buttons=rule('.event-calendar-nav .btn');
 assert.match(buttons,/flex:\s*none(?:;|$)/);
 assert.match(buttons,/min-width:\s*44px(?:;|$)/);
 assert.match(buttons,/min-height:\s*44px(?:;|$)/);
 for(const selector of ['.event-calendar','.event-calendar-heading','.event-calendar-heading h2','.event-calendar-nav','.event-calendar-nav strong','.event-calendar-nav .btn'])assert.doesNotMatch(rule(selector),/overflow(?:-x)?:\s*(?:hidden|clip)|font-size:\s*\d+px/);
});
