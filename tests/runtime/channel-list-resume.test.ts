import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import * as vm from 'node:vm';
import {transformSync} from 'esbuild';

// Complete production module, real viewport/read hooks and adaptive polling;
// controlled hooks, events and timers do not establish React/browser/PWA behavior.
type Call={url:string;options?:unknown;resolve:(page:any)=>void;reject:(error:Error)=>void;done:boolean};
const read=(file:string)=>readFileSync(new URL(`../../apps/portal-web/src/modules/${file}`,import.meta.url),'utf8');
const compiled=transformSync(read('MemberChannels.tsx'),{loader:'tsx',target:'es2023',format:'cjs',jsx:'transform'}).code;
const poll=transformSync(read('adaptive-chat-poll.ts'),{loader:'ts',target:'es2023',format:'cjs'}).code;
const workspaceCompiled=transformSync(read('ChatWorkspace.tsx'),{loader:'tsx',target:'es2023',format:'cjs',jsx:'transform'}).code;
const microtasks=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function host(kind='guild',mobile=false,active=true){
 let cursor=0,tree:any,serial=0,now=100000,dirty=false,disposed=false;const slots:any[]=[],effects:Array<()=>void>=[],timers=new Map<number,{run:()=>void;delay:number;interval:boolean}>(),calls:Call[]=[],unread:unknown[]=[],events:string[]=[];
 const same=(a:any[],b:any[])=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const effect=(run:()=>void|(()=>void),deps:any[])=>{const i=cursor++,old=slots[i];if(!old||!same(old.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=run();});}};
 const noop=()=>{},unused=()=>{throw Error('Unexpected branch');};
 const hooks={useState(initial:any){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,(v:any)=>{const n=typeof v==='function'?v(slots[i].value):v;if(!Object.is(n,slots[i].value))dirty=true;slots[i].value=n;}];},useRef(initial:any){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useId:()=>':resume:',useEffect:effect,useLayoutEffect:effect,useMemo(run:()=>any,deps:any[]){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:run()};return slots[i].value;}};
 const target=()=>{const listeners=new Map<string,Set<(event:any)=>void>>();return{listeners,addEventListener(k:string,f:(event:any)=>void){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k)!.add(f);},removeEventListener(k:string,f:(event:any)=>void){listeners.get(k)?.delete(f);},dispatch(k:string){events.push(k);for(const f of [...listeners.get(k)??[]])f({type:k});}};};
 const window:any=target(),document=Object.assign(target(),{visibilityState:'visible',getElementById:()=>null}),navigator={onLine:true};
 Object.assign(window,{setTimeout(run:()=>void,delay:number){const id=++serial;timers.set(id,{run,delay,interval:false});return id;},clearTimeout:(id:number)=>timers.delete(id),setInterval(run:()=>void,delay:number){const id=++serial;timers.set(id,{run,delay,interval:true});return id;},clearInterval:(id:number)=>timers.delete(id)});
 window.matchMedia=()=>({matches:mobile,addEventListener:noop,removeEventListener:noop});
 const workspaceModule={exports:{} as any};vm.runInNewContext(workspaceCompiled,{module:workspaceModule,exports:workspaceModule.exports,require:(n:string)=>{assert.ok(n==='react'||n==='./ChatWorkspace.css');return n==='react'?hooks:{};},window,document,navigator});
 const pollModule={exports:{} as any};vm.runInNewContext(poll,{module:pollModule,exports:pollModule.exports});
 class ApiError extends Error{status:number;network:boolean;constructor(message:string,status=0){super(message);this.status=status;this.network=!status;}}
 const imports:Record<string,any>={react:hooks,'../api':{ApiError},'../format':{formatIsoLocal:String},'./member-inbox':{announceInboxChange:()=>window.dispatch('inbox-updated'),INBOX_ALL_READ:'all-read'},'./MemberReporting':{ReportButton:'ReportButton'},'./message-refresh':{refreshLoadedMessages:unused},'../game-console-core':{logConsoleEvent:unused},'../game-console-routing':{consoleChannel:unused},'../../../../modules/member-communications/stickers':{findChatSticker:unused},'./ChatContent':{ChatBody:'ChatBody',ChatQuote:'ChatQuote',ChatExtras:'ChatExtras',ChatRetracted:'ChatRetracted',RetractMessageDialog:'RetractMessageDialog',chatPayload:unused,quoteMessage:unused,useRichChatDraft:()=>({get:()=>({}),change:noop,clear:noop})},'./ChatWorkspace':{ChatInput:'ChatInput',ChatTime:'ChatTime',chatCalendarKey:()=>'',useChatViewport:workspaceModule.exports.useChatViewport,useVisibleChatRead:workspaceModule.exports.useVisibleChatRead},'./ChatSearch':{ChatSearch:'ChatSearch'},'./message-image-client':{matchesChannelMessageAck:unused},'./adaptive-chat-poll':pollModule.exports,'./MemberSettings.css':{}};
 const module={exports:{} as any};class ClockDate extends Date{static now(){return now;}}
 vm.runInNewContext(compiled,{module,exports:module.exports,Error,Date:ClockDate,React:{createElement:(type:any,props:any,...children:any[])=>({type,props:props??{},children})},require:(n:string)=>{assert.ok(n in imports,n);return imports[n];},window,document,navigator,requestAnimationFrame:(run:()=>void)=>{run();return++serial;}});
 const props={kind,client:{sessionGeneration:1,get(url:string,options?:unknown){return new Promise((resolve,reject)=>calls.push({url,options,resolve,reject,done:false}));},post:unused},session:{user:{user_id:'synthetic-user'}},onUnread:(v:unknown)=>unread.push(v),onNavigate:unused,active};
 function render(){if(disposed)return;let n=0;do{dirty=false;cursor=0;tree=module.exports.MemberChannels(props);while(effects.length)effects.shift()!();assert.ok(++n<20,'render settled');}while(dirty);}
 function walk(v:any,a:any[]=[]):any[]{if(v==null)return a;if(Array.isArray(v))v.forEach(x=>walk(x,a));else if(typeof v==='object'){a.push(v);walk(v.children,a);}return a;}
 const nodes=()=>walk(tree),listCalls=()=>calls.filter(c=>/^\/me\/channels\?/.test(c.url)),activityCalls=()=>calls.filter(c=>c.url.endsWith('/activity')),historyCalls=()=>calls.filter(c=>c.url.includes('/messages?'));
 function state(){return {rooms:nodes().filter(n=>n.props['data-channel-key']).map(n=>n.props['data-channel-key']),unread:unread.at(-1),selected:nodes().some(n=>n.props['aria-current']==='true'),visibleList:!nodes().find(n=>n.type==='section'&&n.props.className==='messages-side stack')?.props.hidden,listeners:{focus:window.listeners.get('focus')?.size??0,online:window.listeners.get('online')?.size??0,visibility:document.listeners.get('visibilitychange')?.size??0},intervals:[...timers.values()].filter(x=>x.interval).length};}
 async function resolve(call:Call,page:any){call.done=true;call.resolve(page);await microtasks();render();}
 const room=(key='old',count=0)=>({kind,channel_key:key,name:key,unread_count:count,last_message_at:null});
 async function ready(){assert.equal(calls.length,1);await resolve(calls[0],{items:[room()],unread_count:0,next_offset:null});}
 async function choose(){const n=nodes().find(n=>n.props['data-channel-key']==='old');n.props.onClick();render();const call=historyCalls().at(-1)!;await resolve(call,{channel:{kind,channel_key:'old',name:'old'},items:[],unread_count:0,next_offset:null});}
 function back(){const n=nodes().find(n=>n.type==='button'&&/返回.*列表/.test(n.props['aria-label']??''));assert.ok(n);n.props.onClick();render();}
 function event(name:string,value?:string){if(name==='visibilitychange'){document.visibilityState=value!;document.dispatch(name);}else{if(name==='online')navigator.onLine=true;if(name==='offline')navigator.onLine=false;window.dispatch(name);}render();}
 async function tick(ms=1000){now+=ms;for(const t of [...timers.values()])if(t.interval)t.run();render();for(const c of activityCalls().filter(c=>!c.done))await resolve(c,{latest_sequence:'0',unread_count:0,retraction_count:'0'});}
 function count(){return{list:listCalls().length,activity:activityCalls().length,history:historyCalls().length,total:calls.length};}
 function unmount(){disposed=true;for(const slot of slots)slot?.cleanup?.();}
 function query(value:string){nodes().find(n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value}});render();}
 render();return {render,state,ready,choose,back,event,tick,resolve,room,calls,listCalls,activityCalls,historyCalls,unread,count,props,document,navigator,nodes,unmount,query};
}
const page=(h:ReturnType<typeof host>,key:string,unread=0)=>({items:[h.room(key,unread)],unread_count:unread,next_offset:null});
for(const kind of ['guild','squad'])for(const mobile of [false,true]){
 const label=`${kind}/${mobile?'phone':'desktop'}`;
 test(`${label}: visibility and online resume the ready list without opening a history`,async()=>{
  const h=host(kind,mobile);await h.ready();h.event('visibilitychange','hidden');h.event('visibilitychange','visible');assert.equal(h.listCalls().length,2,'visibility alone is sufficient');h.event('online');h.event('focus');
  assert.equal(h.listCalls().length,2);assert.equal(h.historyCalls().length,0);assert.equal(h.activityCalls().length,0);
  for(let i=0;i<60;i++)await h.tick();assert.equal(h.listCalls().length,2);
  await h.resolve(h.listCalls().at(-1)!,page(h,'new',7));assert.deepEqual(h.state().rooms,['new']);assert.equal(h.state().unread,7);
 });
 test(`${label}: an unchanged selected room does not prevent other rooms being refreshed`,async()=>{
  const h=host(kind,mobile);await h.ready();await h.choose();await h.tick();
  h.event('visibilitychange','hidden');h.event('visibilitychange','visible');h.event('online');for(let i=0;i<60;i++)await h.tick();
  assert.equal(h.listCalls().length,2);assert.equal(h.historyCalls().length,1);assert.ok(h.activityCalls().length>0);
 });
}
for(const kind of ['guild','squad']){
 test(`${kind}: online alone resumes the ready list without focus or a visibility change`,async()=>{
  const h=host(kind,true);await h.ready();h.event('offline');assert.equal(h.listCalls().length,1);h.event('online');assert.equal(h.listCalls().length,2);
  assert.equal(h.historyCalls().length,0);assert.equal(h.activityCalls().length,0);await h.resolve(h.listCalls().at(-1)!,page(h,'connected',8));assert.deepEqual(h.state().rooms,['connected']);assert.equal(h.state().unread,8);
 });
 test(`${kind}: returning to the phone picker still resumes only its list`,async()=>{
  const h=host(kind,true);await h.ready();await h.choose();h.back();h.event('visibilitychange','hidden');h.event('visibilitychange','visible');h.event('online');
  for(let i=0;i<60;i++)await h.tick();assert.equal(h.listCalls().length,2);assert.equal(h.activityCalls().length,0);assert.equal(h.historyCalls().length,1);
 });
 test(`${kind}: resume supersedes a pre-background read and coalesces its own in-flight event burst`,async()=>{
  const h=host(kind);await h.ready();h.event('focus');const stale=h.listCalls().at(-1)!;
  h.event('visibilitychange','hidden');h.event('visibilitychange','visible');h.event('online');h.event('focus');h.event('focus');assert.equal(h.listCalls().length,3);
  await h.resolve(h.listCalls().at(-1)!,page(h,'fresh',9));await h.resolve(stale,page(h,'stale',1));assert.deepEqual(h.state().rooms,['fresh']);assert.equal(h.state().unread,9);
  h.event('focus');assert.equal(h.listCalls().length,4,'a completed refresh does not suppress a later return');
 });
 for(const event of ['freedom-profile-updated','all-read'])test(`${kind}: ${event} remains a forced refresh even while resume is pending`,async()=>{
  const h=host(kind);await h.ready();h.event('visibilitychange','hidden');h.event('visibilitychange','visible');const resumed=h.listCalls().at(-1)!;
  h.event(event);const forced=h.listCalls().at(-1)!;assert.equal(h.listCalls().length,3);h.event('focus');assert.equal(h.listCalls().length,4);
  await h.resolve(h.listCalls().at(-1)!,page(h,'newest',12));await h.resolve(resumed,page(h,'old-resume',1));await h.resolve(forced,page(h,'old-authority',2));assert.deepEqual(h.state().rooms,['newest']);assert.equal(h.state().unread,12);
 });
 test(`${kind}: hidden and offline focus does not read; reconnect refreshes an inactive mounted kind`,async()=>{
  const h=host(kind,true,false);await h.ready();h.event('visibilitychange','hidden');h.event('focus');h.event('offline');h.event('visibilitychange','visible');h.event('focus');assert.equal(h.listCalls().length,1);
  h.event('online');assert.equal(h.listCalls().length,2);assert.equal(h.historyCalls().length,0);
 });
 test(`${kind}: loading and initial failure keep the existing explicit retry path`,async()=>{
  const h=host(kind);h.event('visibilitychange','hidden');h.event('visibilitychange','visible');h.event('online');h.event('focus');assert.equal(h.calls.length,1);
  h.calls[0].reject(new Error('initial failure'));await microtasks();h.render();h.event('visibilitychange','hidden');h.event('visibilitychange','visible');h.event('online');h.event('focus');assert.equal(h.calls.length,1);
 });
 test(`${kind}: reconnect replaces an unfinished refresh from before the offline transition`,async()=>{
  const h=host(kind);await h.ready();h.event('focus');const old=h.listCalls().at(-1)!;h.event('offline');h.event('online');h.event('focus');assert.equal(h.listCalls().length,3);
  await h.resolve(h.listCalls().at(-1)!,page(h,'reconnected',2));await h.resolve(old,page(h,'old-network'));assert.deepEqual(h.state().rooms,['reconnected']);
 });
 test(`${kind}: membership removal from the fresh list fences delayed activity`,async()=>{
  const h=host(kind);await h.ready();await h.choose();h.event('visibilitychange','hidden');h.event('visibilitychange','visible');const activity=h.activityCalls().at(-1)!;assert.ok(activity);
  await h.resolve(h.listCalls().at(-1)!,{items:[],unread_count:0,next_offset:null});await h.resolve(activity,{latest_sequence:'1',unread_count:1,retraction_count:'0'});
  assert.equal(h.historyCalls().length,1);assert.deepEqual(h.state().rooms,[]);assert.ok(!h.nodes().some(n=>n.type==='ChatInput'));
 });
 test(`${kind}: unmount removes listeners and timers and fences the pending response`,async()=>{
  const h=host(kind);await h.ready();h.event('focus');const late=h.listCalls().at(-1)!;h.unmount();h.event('online');h.event('focus');h.event('visibilitychange','visible');assert.equal(h.listCalls().length,2);
  await h.resolve(late,page(h,'late',99));assert.deepEqual(h.unread,[0]);assert.deepEqual(h.state().listeners,{focus:0,online:0,visibility:0});assert.equal(h.state().intervals,0);
 });
 test(`${kind}: resume reads the current search and rejects an earlier query response`,async()=>{
  const h=host(kind);await h.ready();h.event('focus');const old=h.listCalls().at(-1)!;h.query('different');h.event('visibilitychange','hidden');h.event('visibilitychange','visible');assert.match(h.listCalls().at(-1)!.url,/search=different/);
  await h.resolve(h.listCalls().at(-1)!,page(h,'different',10));await h.resolve(old,page(h,'old-query',1));assert.deepEqual(h.state().rooms,['different']);assert.equal(h.state().unread,10);
 });
 test(`${kind}: a failed resume keeps its list and allows a later resume to recover`,async()=>{
  const h=host(kind);await h.ready();h.event('visibilitychange','hidden');h.event('visibilitychange','visible');const failed=h.listCalls().at(-1)!;
  failed.reject(new Error('network failure'));await microtasks();h.render();assert.deepEqual(h.state().rooms,['old']);assert.equal(h.state().unread,null);
  h.event('focus');assert.equal(h.listCalls().length,3);await h.resolve(h.listCalls().at(-1)!,page(h,'recovered',4));assert.deepEqual(h.state().rooms,['recovered']);assert.equal(h.state().unread,4);
 });
}
test('the unopened mobile world picker does not acquire a list or history request',()=>{
 const h=host('world',true);assert.equal(h.calls.length,0);h.event('visibilitychange','hidden');h.event('visibilitychange','visible');h.event('online');h.event('focus');assert.equal(h.calls.length,0);
});
