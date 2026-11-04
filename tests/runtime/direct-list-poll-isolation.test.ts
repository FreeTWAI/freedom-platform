import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import * as vm from 'node:vm';
import * as crypto from 'node:crypto';
import {transformSync} from 'esbuild';

// Complete production DirectMessages module and real viewport/read/poll/receipt helpers.
// Controlled hooks, events and timers do not establish React/browser/device behavior.
type Call={time:number;url:string;options?:unknown;resolve:(page:any)=>void;reject:(cause:Error)=>void;done:boolean};
const read=(file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');
const compile=(source:string,loader:'tsx'|'ts'='tsx')=>transformSync(source,{loader,target:'es2023',format:'cjs',jsx:'transform'}).code;
const compiled=compile(read('apps/portal-web/src/modules/MemberMessages.tsx'));
const workspaceCompiled=compile(read('apps/portal-web/src/modules/ChatWorkspace.tsx'));
const pollCompiled=compile(read('apps/portal-web/src/modules/adaptive-chat-poll.ts'),'ts');
const receiptCompiled=compile(read('apps/portal-web/src/modules/direct-message-receipts.ts'),'ts');
const typesCompiled=compile(read('modules/member-communications/types.ts'),'ts');
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function host({mobile=true,compact=false,active=true}={}){
 const writes:unknown[]=[];
 let cursor=0,tree:any,serial=0,now=100000,dirty=false,disposed=false;const slots:any[]=[],effects:Array<()=>void>=[],timers=new Map<number,{run:()=>void;delay:number;due:number;interval:boolean}>(),calls:Call[]=[],unread:unknown[]=[],events:Array<{time:number;event:string}>=[];
 const same=(a:any[],b:any[])=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const effect=(run:()=>void|(()=>void),deps:any[])=>{const i=cursor++,old=slots[i];if(!old||!same(old.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=run();});}};
 const noop=()=>{},unused=()=>{throw Error('Unexpected branch');};
 const hooks={useState(initial:any){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,(v:any)=>{const n=typeof v==='function'?v(slots[i].value):v;if(!Object.is(n,slots[i].value))dirty=true;slots[i].value=n;}];},useRef(initial:any){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useId:()=>':direct:',useEffect:effect,useLayoutEffect:effect,useMemo(run:()=>any,deps:any[]){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:run()};return slots[i].value;},useCallback(fn:any,deps:any[]){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn};return slots[i].value;}};
 const target=()=>{const listeners=new Map<string,Set<(event:any)=>void>>();return{listeners,addEventListener(k:string,f:(event:any)=>void){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k)!.add(f);},removeEventListener(k:string,f:(event:any)=>void){listeners.get(k)?.delete(f);},dispatch(k:string){events.push({time:now,event:k});for(const f of [...listeners.get(k)??[]])f({type:k});}};};
 const window:any=target(),document=Object.assign(target(),{visibilityState:'visible',getElementById:()=>null}),navigator={onLine:true};
 Object.assign(window,{setTimeout(run:()=>void,delay:number){const id=++serial;timers.set(id,{run,delay,due:now+delay,interval:false});return id;},clearTimeout:(id:number)=>timers.delete(id),setInterval(run:()=>void,delay:number){const id=++serial;timers.set(id,{run,delay,due:now+delay,interval:true});return id;},clearInterval:(id:number)=>timers.delete(id)});
 window.matchMedia=()=>({matches:mobile,addEventListener:noop,removeEventListener:noop});
 const react={...hooks,createElement:(type:any,props:any,...children:any[])=>({type,props:props??{},children}),Fragment:'Fragment'};
 function load(code:string,imports:Record<string,any>={}){const module={exports:{} as any};vm.runInNewContext(code,{module,exports:module.exports,require:(n:string)=>{assert.ok(n in imports,'missing dependency '+n);return imports[n];},window,document,navigator,Date:ClockDate,React:react});return module.exports;}
 class ClockDate extends Date{static now(){return now;}}
 const workspace=load(workspaceCompiled,{react:hooks,'./ChatWorkspace.css':{}}),poll=load(pollCompiled),types=load(typesCompiled),receipts=load(receiptCompiled,{'../../../../modules/member-communications/types.js':types});
 class ApiError extends Error{status:number;network:boolean;constructor(message:string,status=0){super(message);this.status=status;this.network=!status;}}
 const rich={get:()=>({}),change:noop,clear:noop};
 const imports:Record<string,any>={react:hooks,'../api':{ApiError},'../format':{formatIsoLocal:String},'./MemberReporting':{ReportButton:'ReportButton'},'./MemberBlocking':{MemberBlockingAction:'MemberBlockingAction'},'./MemberAvatar':{MemberAvatar:'MemberAvatar'},'./MemberChannels':{MemberChannels:'MemberChannels'},'./chat-leave-guards':{useChatLeaveGuards:unused},'./member-inbox':{announceInboxChange:()=>window.dispatch('inbox-updated'),INBOX_ALL_READ:'all-read',NOTIFICATIONS_READ:'notifications-read'},'../game-console-core':{logConsoleEvent:unused},'../game-console-routing':{consoleChannel:unused},'./MemberPresence':{MemberPresence:'MemberPresence'},'./MemberSettings.css':{},'../../../../modules/member-communications/stickers':{findChatSticker:unused},'./ChatContent':{ChatBody:'ChatBody',ChatQuote:'ChatQuote',ChatExtras:'ChatExtras',ChatRetracted:'ChatRetracted',RetractMessageDialog:'RetractMessageDialog',chatPayload:unused,quoteMessage:unused,useRichChatDraft:()=>rich},'./ChatWorkspace':{...workspace},'./ChatSearch':{ChatSearch:'ChatSearch'},'../WorkshopIcon':{WorkshopIcon:'WorkshopIcon'},'./direct-message-receipts':receipts,'./message-image-client':{isFirstImageDecoderRejection:unused,matchesDirectMessageAck:unused,messageImageFileError:unused,messageImageUrl:unused,uploadMessageImage:unused},'./MessageImagePreview':{MessageImagePreview:'MessageImagePreview'},'./adaptive-chat-poll':poll,'./message-refresh':{refreshLoadedMessages:unused},'../../../../modules/member-communications/types':types};
 const module={exports:{} as any};
 vm.runInNewContext(compiled,{module,exports:module.exports,Error,Date:ClockDate,React:react,crypto,require:(n:string)=>{assert.ok(n in imports,'missing dependency '+n);return imports[n];},window,document,navigator,requestAnimationFrame:(run:()=>void)=>{run();return++serial;},cancelAnimationFrame:noop});
 const props={client:{sessionGeneration:1,get(url:string,options?:unknown){return new Promise((resolve,reject)=>calls.push({time:now,url,options,resolve,reject,done:false}));},post(...args:unknown[]){writes.push(args);return unused();}},session:{user:{user_id:'synthetic-me'}},onUnread:(v:unknown)=>unread.push(v),openPeer:null,active,compact};
 function render(){assert.equal(writes.length,0,'fixture dispatched no POST');if(disposed)return;let n=0;do{dirty=false;cursor=0;tree=module.exports.DirectMessages(props);while(effects.length)effects.shift()!();assert.ok(++n<30,'render settled');}while(dirty);assert.equal(writes.length,0,'fixture dispatched no POST');}
 function walk(v:any,a:any[]=[]):any[]{if(v==null)return a;if(Array.isArray(v))v.forEach(x=>walk(x,a));else if(typeof v==='object'){a.push(v);walk(v.children,a);}return a;}
 function text(v:any):string{if(v==null||typeof v==='boolean')return'';if(Array.isArray(v))return v.map(text).join('');if(typeof v==='object')return text(v.children);return String(v);}
 const nodes=()=>walk(tree),listCalls=()=>calls.filter(c=>/^\/me\/conversations\?/.test(c.url)),activityCalls=()=>calls.filter(c=>c.url.endsWith('/activity')),historyCalls=()=>calls.filter(c=>c.url.includes('/messages?'));
 function state(){const list=nodes().find(n=>n.type==='ul'&&n.props['aria-label']==='對話列表');return{time:now,peers:walk(list).filter(n=>n.type==='strong').map(text),preview:walk(list).filter(n=>n.props.className==='chat-peer-preview').map(text),unread:unread.at(-1),listVisible:!nodes().find(n=>n.props.className==='messages-side')?.props.hidden,threadVisible:!nodes().find(n=>n.props.className==='messages-thread')?.props.hidden,liveError:nodes().some(n=>n.props.role==='status'&&text(n).includes('新訊息更新暫停')),listeners:{focus:window.listeners.get('focus')?.size??0,online:window.listeners.get('online')?.size??0,visibility:document.listeners.get('visibilitychange')?.size??0},intervals:[...timers.values()].filter(t=>t.interval).length};}
 async function resolve(call:Call,page:any){assert.ok(call&&!call.done);call.done=true;call.resolve(page);await settle();render();}
 async function reject(call:Call,cause=new Error('synthetic temporary network error')){assert.ok(call&&!call.done);call.done=true;call.reject(cause);await settle();render();}
 const conversation=(id='old',count=0)=>({participant:{user_id:id,display_name:id,avatar_url:null,last_seen_at:null,is_online:false},can_send:true,last_message:{message_id:'message-'+id,sender_ref:id,recipient_ref:'synthetic-me',created_at:'2026-11-04T00:00:00.000Z',read_at:'2026-11-04T00:00:00.000Z',retracted_at:null,body:'preview-'+id},unread_count:count});
 const page=(ids=['old'],count=0,next:number|null=null)=>({items:ids.map(id=>conversation(id,count)),unread_count:count,next_offset:next});
 async function ready(p=page()){assert.equal(calls.length,1);await resolve(calls[0],p);}
 function button(label:string){const n=nodes().find(n=>n.type==='button'&&(n.props['aria-label']===label||text(n)===label));assert.ok(n,'button '+label);n.props.onClick();render();return n;}
 async function choose(id='old'){const n=nodes().find(n=>n.type==='button'&&n.props.className==='messages-peer'&&text(n).startsWith(id));assert.ok(n,'peer '+id);n.props.onClick();render();await resolve(historyCalls().at(-1)!,{participant:conversation(id).participant,can_send:true,items:[],next_offset:null,unread_count:0,retraction_count:'0'});}
 function back(){button(compact?'切換對象':'← 返回對話列表');}
 function event(name:string,value?:string){if(name==='visibilitychange'){document.visibilityState=value!;document.dispatch(name);}else{if(name==='online')navigator.onLine=true;if(name==='offline')navigator.onLine=false;window.dispatch(name);}render();}
 async function tick(ms=1000){const end=now+ms;while(true){const next=Math.min(...[...timers.values()].map(t=>t.due));if(next>end)break;now=next;for(const[id,t]of [...timers])if(t.due<=now){if(t.interval)t.due+=t.delay;else timers.delete(id);t.run();}await settle();render();}now=end;await settle();render();}
 function count(){return{list:listCalls().length,activity:activityCalls().length,history:historyCalls().length,total:calls.length};}
 async function drainLists(p=page()){for(const call of listCalls().filter(c=>!c.done))await resolve(call,p);}
 function unmount(){disposed=true;for(const slot of slots)slot?.cleanup?.();}
 render();return{render,state,ready,choose,back,event,tick,resolve,reject,conversation,page,calls,listCalls,activityCalls,historyCalls,unread,count,props,document,navigator,nodes,unmount,button,drainLists,ApiError};
}

async function highBackoff(h:ReturnType<typeof host>){
 await h.ready();await h.choose();await h.tick();const delays=[4000,8000,16000,32000];
 for(let i=0;i<5;i++){await h.reject(h.activityCalls().at(-1)!);await h.drainLists();if(i<4)for(let elapsed=0;elapsed<delays[i];elapsed+=1000){await h.tick();await h.drainLists();}}
 assert.equal(h.activityCalls().length,5);
}
for(const mobile of [false,true])test(`${mobile?'phone':'desktop'}: an ordinary picker retains its eight-second list cadence`,async()=>{
 const h=host({mobile});await h.ready();await h.tick(7999);assert.equal(h.count().list,1);await h.tick(1);assert.equal(h.count().list,2);
 await h.drainLists(h.page(['old','new'],3));assert.equal(h.state().unread,3);assert.ok(h.state().peers.includes('new'));assert.equal(h.count().activity,0);assert.equal(h.count().history,0);
});
for(const variant of ['mobile-back','compact-back','active-return','visibility-return','desktop-stays'])test(`${variant}: another conversation remains discoverable during thread backoff`,async()=>{
 const h=host({mobile:variant!=='desktop-stays',compact:variant==='compact-back'});await highBackoff(h);const before=h.count();
 if(variant.endsWith('-back'))h.back();
 if(variant==='active-return'){h.props.active=false;h.render();h.props.active=true;h.render();}
 if(variant==='visibility-return'){h.event('visibilitychange','hidden');h.event('visibilitychange','visible');}
 await h.tick(8000);await h.drainLists(h.page(['old','new'],7));await h.tick(8000);await h.drainLists(h.page(['old','new'],7));
 assert.equal(h.count().list-before.list,2);assert.ok(h.state().peers.includes('new'));assert.equal(h.state().unread,7);
 assert.equal(h.count().activity,before.activity);assert.equal(h.count().history,before.history);
});
for(const mobile of [false,true])test(`${mobile?'phone picker':'desktop'}: a pending activity read does not stall list discovery`,async()=>{
 const h=host({mobile});await h.ready();await h.choose();await h.tick();assert.equal(h.count().activity,1);if(mobile)h.back();const before=h.count();
 // 15 seconds of pending activity stays below the production client's 20-second timeout.
 await h.tick(7000);await h.drainLists(h.page(['old','new'],2));await h.tick(8000);await h.drainLists(h.page(['old','new'],2));
 assert.equal(h.count().list-before.list,2);assert.equal(h.count().activity,1);assert.equal(h.count().history,1);assert.ok(h.state().peers.includes('new'));assert.equal(h.state().unread,2);
});
test('a pending list still coalesces ticks and visibility events during thread backoff',async()=>{
 const h=host();await highBackoff(h);h.back();await h.tick(8000);const before=h.count();
 for(let i=0;i<4;i++)h.event('visibilitychange','visible');await h.tick(12000);assert.deepEqual(h.count(),before);
 await h.resolve(h.listCalls().at(-1)!,h.page(['fresh'],9));await h.tick(1000);assert.equal(h.count().list,before.list+1);
});
for(const condition of ['hidden','offline','inactive'])test(`${condition}: neither list nor thread polls`,async()=>{
 const h=host();await highBackoff(h);h.back();if(condition==='hidden')h.event('visibilitychange','hidden');if(condition==='offline')h.event('offline');if(condition==='inactive'){h.props.active=false;h.render();}
 const before=h.count();await h.tick(16000);assert.deepEqual(h.count(),before);
});
for(const trigger of ['manual','focus','online'])test(`${trigger}: existing manual refresh or thread retry reset remains available`,async()=>{
 const h=host();await highBackoff(h);await h.tick(8000);await h.drainLists();const before=h.count();
 if(trigger==='manual')h.button('重新整理對話');else h.event(trigger);
 assert.equal(h.count().activity-before.activity,trigger==='manual'?0:1);assert.equal(h.count().list-before.list,trigger==='manual'?1:0);
});
test('independent list progress does not shorten the exact 60-second thread retry deadline',async()=>{
 const h=host({mobile:false});await highBackoff(h);const before=h.count();
 for(let i=0;i<59;i++){await h.tick();await h.drainLists();}assert.equal(h.count().activity,before.activity);
 await h.tick();assert.equal(h.count().activity,before.activity+1);
});
for(const status of [403,404])test(`activity ${status} stops that thread without hiding unrelated conversations`,async()=>{
 const h=host();await h.ready();await h.choose();await h.tick();await h.reject(h.activityCalls().at(-1)!,new h.ApiError('synthetic forbidden',status));h.back();const before=h.count();
 await h.tick(7000);await h.drainLists(h.page(['other'],1));assert.equal(h.count().activity,before.activity);assert.equal(h.count().history,before.history);assert.equal(h.count().list,before.list+1);assert.ok(h.state().peers.includes('other'));
});
test('a forced fresh list fences an older automatic response during thread backoff',async()=>{
 const h=host();await highBackoff(h);h.back();await h.tick(8000);const stale=h.listCalls().at(-1)!;h.event('all-read');const fresh=h.listCalls().at(-1)!;assert.notEqual(stale,fresh);
 await h.resolve(fresh,h.page(['fresh'],12));await h.resolve(stale,h.page(['stale'],1));assert.deepEqual(h.state().peers,['fresh']);assert.equal(h.state().unread,12);
});
test('list failure preserves rows and recovers at eight seconds without retrying the backed-off thread',async()=>{
 const h=host();await highBackoff(h);h.back();const before=h.count();await h.tick(8000);await h.reject(h.listCalls().at(-1)!);
 assert.equal(h.state().unread,null);assert.deepEqual(h.state().peers,['old']);await h.tick(8000);await h.drainLists(h.page(['recovered'],4));
 assert.equal(h.count().list-before.list,2);assert.equal(h.count().activity,before.activity);assert.deepEqual(h.state().peers,['recovered']);assert.equal(h.state().unread,4);
});
test('unmount removes subscriptions and fences a pending list response',async()=>{
 const h=host();await h.ready();await h.tick(8000);const pending=h.listCalls().at(-1)!;h.unmount();const before=h.count();
 h.event('online');h.event('focus');h.event('visibilitychange','visible');await h.tick(16000);await h.resolve(pending,h.page(['late'],99));
 assert.deepEqual(h.count(),before);assert.deepEqual(h.unread,[0]);assert.equal(h.state().intervals,0);assert.deepEqual(h.state().listeners,{focus:0,online:0,visibility:0});
});
