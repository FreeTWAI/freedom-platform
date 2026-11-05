import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import * as vm from 'node:vm';
import * as crypto from 'node:crypto';
import {transformSync} from 'esbuild';

// Execute the complete production module and its real handlers. JSX identity is
// the memoization contract, not evidence of DOM renders or device input latency.
type Call={time:number;url:string;options?:unknown;resolve:(page:any)=>void;reject:(cause:Error)=>void;done:boolean;page?:any};
const read=(file:string)=>readFileSync(new URL(`../../${file}`,import.meta.url),'utf8');
const compile=(source:string,loader:'tsx'|'ts'='tsx')=>transformSync(source,{loader,target:'es2023',format:'cjs',jsx:'transform'}).code;
const compiled=compile(read('apps/portal-web/src/modules/MemberMessages.tsx'));
const workspaceCompiled=compile(read('apps/portal-web/src/modules/ChatWorkspace.tsx'));
const pollCompiled=compile(read('apps/portal-web/src/modules/adaptive-chat-poll.ts'),'ts');
const receiptCompiled=compile(read('apps/portal-web/src/modules/direct-message-receipts.ts'),'ts');
const typesCompiled=compile(read('modules/member-communications/types.ts'),'ts');
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function host({mobile=true,compact=false,active=true}={}){
 let wallNow=Date.parse('2026-11-04T12:00:00.000Z');
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
 class ClockDate extends Date{constructor(...args:any[]){super(...(args.length?args:[wallNow]) as [any]);}static now(){return now;}}
 const workspace=load(workspaceCompiled,{react:hooks,'./ChatWorkspace.css':{}}),poll=load(pollCompiled),types=load(typesCompiled),receipts=load(receiptCompiled,{'../../../../modules/member-communications/types.js':types});
 class ApiError extends Error{status:number;network:boolean;constructor(message:string,status=0){super(message);this.status=status;this.network=!status;}}
 const rich={get:()=>({}),change:noop,clear:noop};
 const imports:Record<string,any>={react:hooks,'../api':{ApiError},'../format':{formatIsoLocal:String},'./MemberReporting':{ReportButton:'ReportButton'},'./MemberBlocking':{MemberBlockingAction:'MemberBlockingAction'},'./MemberAvatar':{MemberAvatar:'MemberAvatar'},'./MemberChannels':{MemberChannels:'MemberChannels'},'./chat-leave-guards':{useChatLeaveGuards:unused},'./member-inbox':{announceInboxChange:()=>window.dispatch('inbox-updated'),INBOX_ALL_READ:'all-read',NOTIFICATIONS_READ:'notifications-read'},'../game-console-core':{logConsoleEvent:unused},'../game-console-routing':{consoleChannel:unused},'./MemberPresence':{MemberPresence:'MemberPresence'},'./MemberSettings.css':{},'../../../../modules/member-communications/stickers':{findChatSticker:unused},'./ChatContent':{ChatBody:'ChatBody',ChatQuote:'ChatQuote',ChatExtras:'ChatExtras',ChatRetracted:'ChatRetracted',RetractMessageDialog:'RetractMessageDialog',chatPayload:unused,quoteMessage:unused,useRichChatDraft:()=>rich},'./ChatWorkspace':{...workspace},'./ChatSearch':{ChatSearch:'ChatSearch'},'../WorkshopIcon':{WorkshopIcon:'WorkshopIcon'},'./direct-message-receipts':receipts,'./message-image-client':{isFirstImageDecoderRejection:unused,matchesDirectMessageAck:unused,messageImageFileError:unused,messageImageUrl:unused,uploadMessageImage:unused},'./MessageImagePreview':{MessageImagePreview:'MessageImagePreview'},'./adaptive-chat-poll':poll,'./message-refresh':{refreshLoadedMessages:unused},'../../../../modules/member-communications/types':types};
 const module={exports:{} as any};
 vm.runInNewContext(compiled,{module,exports:module.exports,Error,Date:ClockDate,React:react,crypto,require:(n:string)=>{assert.ok(n in imports,'missing dependency '+n);return imports[n];},window,document,navigator,requestAnimationFrame:(run:()=>void)=>{run();return++serial;},cancelAnimationFrame:noop});
 const props:any={client:{sessionGeneration:1,get(url:string,options?:unknown){return new Promise((resolve,reject)=>calls.push({time:now,url,options,resolve,reject,done:false}));},post(...args:unknown[]){writes.push(args);return unused();}},session:{user:{user_id:'synthetic-me'}},onUnread:(v:unknown)=>unread.push(v),openPeer:null,active,compact};
 function render(){assert.equal(writes.length,0,'fixture dispatched no POST');if(disposed)return;let n=0;do{dirty=false;cursor=0;tree=module.exports.DirectMessages(props);while(effects.length)effects.shift()!();assert.ok(++n<30,'render settled');}while(dirty);assert.equal(writes.length,0,'fixture dispatched no POST');}
 function walk(v:any,a:any[]=[]):any[]{if(v==null)return a;if(Array.isArray(v))v.forEach(x=>walk(x,a));else if(typeof v==='object'){a.push(v);walk(v.children,a);}return a;}
 function text(v:any):string{if(v==null||typeof v==='boolean')return'';if(Array.isArray(v))return v.map(text).join('');if(typeof v==='object')return text(v.children);return String(v);}
 const nodes=()=>walk(tree),listCalls=()=>calls.filter(c=>/^\/me\/conversations\?/.test(c.url)),activityCalls=()=>calls.filter(c=>c.url.endsWith('/activity')),historyCalls=()=>calls.filter(c=>c.url.includes('/messages?'));
 function state(){const list=nodes().find(n=>n.type==='ul'&&n.props['aria-label']==='對話列表');return{time:now,peers:walk(list).filter(n=>n.type==='strong').map(text),preview:walk(list).filter(n=>n.props.className==='chat-peer-preview').map(text),unread:unread.at(-1),listVisible:!nodes().find(n=>n.props.className==='messages-side')?.props.hidden,threadVisible:!nodes().find(n=>n.props.className==='messages-thread')?.props.hidden,liveError:nodes().some(n=>n.props.role==='status'&&text(n).includes('新訊息更新暫停')),listeners:{focus:window.listeners.get('focus')?.size??0,online:window.listeners.get('online')?.size??0,visibility:document.listeners.get('visibilitychange')?.size??0},intervals:[...timers.values()].filter(t=>t.interval).length};}
 async function resolve(call:Call,page:any){assert.ok(call&&!call.done);call.done=true;call.page=page;call.resolve(page);await settle();render();}
 async function reject(call:Call,cause=new Error('synthetic temporary network error')){assert.ok(call&&!call.done);call.done=true;call.reject(cause);await settle();render();}
 const conversation=(id='old',count=0)=>({participant:{user_id:id,display_name:id,avatar_url:null,last_seen_at:null,is_online:false},can_send:true,last_message:{message_id:'message-'+id,sender_ref:id,recipient_ref:'synthetic-me',created_at:'2026-11-04T00:00:00.000Z',read_at:'2026-11-04T00:00:00.000Z',retracted_at:null as string|null,body:'preview-'+id},unread_count:count});
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
 render();return{render,state,ready,choose,back,event,tick,resolve,reject,conversation,page,calls,listCalls,activityCalls,historyCalls,unread,count,props,document,navigator,nodes,unmount,button,drainLists,ApiError,setWallNow:(value:number)=>wallNow=value};
}

type Host=ReturnType<typeof host>;
const list=(h:Host)=>h.nodes().find(n=>n.type==='ul'&&n.props['aria-label']==='對話列表');
const input=(h:Host)=>h.nodes().find(n=>typeof n.type==='function'&&n.type.name==='ChatInput');
async function ready(rows=20,options={mobile:false,compact:false}){
 const h=host(options),ids=Array.from({length:rows},(_,i)=>`p${i}`);
 await h.ready(h.page(ids.slice(0,20),0,rows>20?20:null));
 for(let offset=20;offset<rows;offset+=20){h.button('載入更多對話');await h.resolve(h.listCalls().at(-1)!,h.page(ids.slice(offset,offset+20),0,offset+20<rows?offset+20:null));}
 await h.choose('p0');return h;
}
async function refresh(h:Host,page:any){h.button('重新整理對話');await h.resolve(h.listCalls().at(-1)!,page);}
function edit(h:Host,text='保留草稿'){assert.ok(input(h));input(h).props.onChange(text);h.render();assert.equal(input(h).props.value,text);}
for(const mode of ['desktop','phone','compact'])for(const rows of [20,40,100])test(`${mode}, ${rows} loaded peers: draft edits reuse the exact conversation subtree`,async()=>{
 const h=await ready(rows,{mobile:mode==='phone',compact:mode==='compact'}),before=list(h),requests=h.count();assert.ok(before);
 for(let i=0;i<12;i++){edit(h,`測試第${i}字`);assert.equal(list(h),before);}
 assert.equal(h.state().listVisible,mode==='desktop');assert.deepEqual(h.count(),requests);h.unmount();
});
test('fresh list data updates unread, preview, avatar and presence instead of retaining stale rows',async()=>{
 const h=await ready(),before=list(h),page=h.page(['p0','p1'],7);page.items[0].last_message.body='新預覽';Object.assign(page.items[0].participant,{display_name:'新名稱',avatar_url:'/api/v1/members/00000000-0000-0000-0000-000000000001/avatar?v=2',is_online:true,last_seen_at:'2026-11-04T12:00:00.000Z'});
 await refresh(h,page);assert.notEqual(list(h),before);assert.equal(h.state().preview[0],'新預覽');assert.equal(h.state().peers[0],'新名稱');assert.equal(h.state().unread,7);
 const avatar=h.nodes().find(n=>n.type==='MemberAvatar'&&n.props.nickname==='新名稱');assert.equal(avatar.props.avatarUrl,page.items[0].participant.avatar_url);
 assert.ok(h.nodes().some(n=>n.type==='MemberPresence'&&n.props.online===true));h.unmount();
});
test('withdrawn content and a removed avatar replace previously cached metadata',async()=>{
 const h=await ready(),first=h.page(['p0']);Object.assign(first.items[0].participant,{avatar_url:'/api/v1/members/00000000-0000-0000-0000-000000000001/avatar?v=1'});await refresh(h,first);const before=list(h),removed=h.page(['p0']);removed.items[0].last_message.body='';removed.items[0].last_message.retracted_at='2026-11-04T12:00:00.000Z';removed.items[0].can_send=false;
 await refresh(h,removed);assert.notEqual(list(h),before);assert.equal(h.state().preview[0],'訊息已收回');assert.equal(list(h).children[0][0].children[0].children[0].props.avatarUrl,null);h.unmount();
});
test('a fresh page can add, remove and reorder peers, or replace the list with its empty state',async()=>{
 const h=await ready(),before=list(h);await refresh(h,h.page(['new','p1']));assert.notEqual(list(h),before);assert.deepEqual(h.state().peers,['new','p1']);await refresh(h,h.page([]));assert.equal(list(h),undefined);assert.ok(h.nodes().some(n=>n.props.className==='empty'&&n.children.includes('還沒有私訊。可搜尋會員開始對話。')));h.unmount();
});
test('cached row callbacks still select the correct peer and preserve each draft',async()=>{
 const h=await ready(),before=list(h),peer1=h.nodes().find(n=>n.type==='button'&&n.props.className==='messages-peer'&&n.children[1].children[0].children[0]==='p1');assert.ok(peer1);edit(h);assert.equal(list(h),before);peer1.props.onClick();h.render();assert.match(h.historyCalls().at(-1)!.url,/\/p1\/messages\?/);
 await h.resolve(h.historyCalls().at(-1)!,{participant:h.conversation('p1').participant,can_send:true,items:[],next_offset:null,unread_count:0,retraction_count:'0'});assert.notEqual(list(h),before);assert.equal(input(h).props.value,'');await h.choose('p0');assert.equal(input(h).props.value,'保留草稿');assert.equal(h.nodes().filter(n=>n.type==='button'&&n.props['aria-current']==='true').length,1);h.unmount();
});
test('image feature changes invalidate only the presentation, without a new read or write',async()=>{
 const h=await ready(),page=h.page(['p0']);Object.assign(page.items[0].last_message,{body:'[圖片]',image:{image_id:'synthetic'}});await refresh(h,page);const before=list(h),requests=h.count();assert.equal(h.state().preview[0],'[圖片]');h.props.messageImagesEnabled=true;h.render();assert.notEqual(list(h),before);assert.equal(h.state().preview[0],'圖片');assert.deepEqual(h.count(),requests);h.unmount();
});
test('the self-message prefix follows current session props rather than a cached actor',async()=>{
 const h=await ready(),before=list(h);h.props.session={user:{user_id:'p0'}};h.render();assert.notEqual(list(h),before);assert.equal(h.state().preview[0],'你：preview-p0');h.unmount();
});
test('calendar day rollover invalidates timestamps on the next render',async()=>{
 const h=await ready(),before=list(h);h.setWallNow(Date.parse('2026-11-05T12:00:00.000Z'));h.render();assert.notEqual(list(h),before);h.unmount();
});
test('timezone changes invalidate timestamps even with unchanged server values',async()=>{
 const previous=process.env.TZ;try{process.env.TZ='UTC';const h=await ready(),before=list(h);process.env.TZ='Asia/Taipei';h.render();assert.notEqual(list(h),before);h.unmount();}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('a changed client invalidates the cached select callback and receives the next thread read',async()=>{
 const h=await ready(),before=list(h),original=h.props.client,reads:string[]=[];h.props.client={...original,get(url:string,options?:unknown){reads.push(url);return original.get(url,options);}};h.render();await h.resolve(h.listCalls().at(-1)!,h.listCalls()[0].page);assert.notEqual(list(h),before);await h.choose('p1');assert.ok(reads.some(url=>url.includes('/p1/messages?')));h.unmount();
});
test('changing onUnread retains the correct new callback for a completed list read',async()=>{
 const h=await ready(),counts:unknown[]=[];h.props.onUnread=(value:unknown)=>counts.push(value);h.render();await h.resolve(h.listCalls().at(-1)!,h.page(['fresh'],11));assert.deepEqual(counts,[11]);assert.deepEqual(h.state().peers,['fresh']);h.unmount();
});
test('thread permission changes still remove the composer while unchanged list rows remain cached',async()=>{
 const h=await ready(),before=list(h);h.button('重新讀取訊息');await h.resolve(h.historyCalls().at(-1)!,{participant:h.conversation('p0').participant,can_send:false,items:[],next_offset:null,unread_count:0,retraction_count:'0'});assert.equal(list(h),before);assert.equal(input(h),undefined);h.unmount();
});
test('a failed refresh keeps rows, and a superseded late page cannot resurrect stale previews',async()=>{
 const h=await ready(),before=list(h);h.button('重新整理對話');await h.reject(h.listCalls().at(-1)!);assert.equal(list(h),before);h.button('重新整理對話');const stale=h.listCalls().at(-1)!;h.event('all-read');const fresh=h.listCalls().at(-1)!;await h.resolve(fresh,h.page(['fresh'],4));const accepted=list(h);await h.resolve(stale,h.page(['stale'],99));assert.equal(list(h),accepted);assert.deepEqual(h.state().peers,['fresh']);h.unmount();
});
