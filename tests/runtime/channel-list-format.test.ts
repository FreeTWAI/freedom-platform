import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import * as vm from 'node:vm';
import {transformSync} from 'esbuild';

// Complete production module, real viewport/read hooks and adaptive polling;
// controlled hooks, events and timers do not establish React/browser/PWA behavior.
type Call={url:string;options?:unknown;resolve:(page:any)=>void;reject:(error:Error)=>void;done:boolean};
const read=(file:string)=>readFileSync(new URL(`../../apps/portal-web/src/modules/${file}`,import.meta.url),'utf8');
const compile=(source:string)=>transformSync(source,{loader:'tsx',target:'es2023',format:'cjs',jsx:'transform'}).code;
const programs={candidate:compile(read('MemberChannels.tsx'))};
const formatModule={exports:{} as any};vm.runInNewContext(transformSync(readFileSync(new URL('../../apps/portal-web/src/format.ts',import.meta.url),'utf8'),{loader:'ts',target:'es2023',format:'cjs'}).code,{module:formatModule,exports:formatModule.exports});
const poll=transformSync(read('adaptive-chat-poll.ts'),{loader:'ts',target:'es2023',format:'cjs'}).code;
const workspaceCompiled=transformSync(read('ChatWorkspace.tsx'),{loader:'tsx',target:'es2023',format:'cjs',jsx:'transform'}).code;
const microtasks=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function host(kind='guild',mobile=false,active=true,compact=false,variant:keyof typeof programs='candidate'){
 let wallNow=Date.parse('2026-11-04T12:00:00Z');
 let formatCount=0;const writes:unknown[]=[];
 let cursor=0,tree:any,serial=0,now=100000,dirty=false,disposed=false;const slots:any[]=[],effects:Array<()=>void>=[],timers=new Map<number,{run:()=>void;delay:number;interval:boolean}>(),calls:Call[]=[],unread:unknown[]=[],events:string[]=[];
 const same=(a:any[],b:any[])=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const effect=(run:()=>void|(()=>void),deps:any[])=>{const i=cursor++,old=slots[i];if(!old||!same(old.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=run();});}};
 const noop=()=>{},unused=()=>{throw Error('Unexpected branch');};
 const hooks={useState(initial:any){const i=cursor++;if(!(i in slots))slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,(v:any)=>{const n=typeof v==='function'?v(slots[i].value):v;if(!Object.is(n,slots[i].value))dirty=true;slots[i].value=n;}];},useRef(initial:any){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useId:()=>':resume:',useEffect:effect,useLayoutEffect:effect,useMemo(run:()=>any,deps:any[]){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:run()};return slots[i].value;}};
 const target=()=>{const listeners=new Map<string,Set<(event:any)=>void>>();return{listeners,addEventListener(k:string,f:(event:any)=>void){if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k)!.add(f);},removeEventListener(k:string,f:(event:any)=>void){listeners.get(k)?.delete(f);},dispatch(k:string){events.push(k);for(const f of [...listeners.get(k)??[]])f({type:k});}};};
 const window:any=target(),document=Object.assign(target(),{visibilityState:'visible',getElementById:()=>null}),navigator={onLine:true};
 Object.assign(window,{setTimeout(run:()=>void,delay:number){const id=++serial;timers.set(id,{run,delay,interval:false});return id;},clearTimeout:(id:number)=>timers.delete(id),setInterval(run:()=>void,delay:number){const id=++serial;timers.set(id,{run,delay,interval:true});return id;},clearInterval:(id:number)=>timers.delete(id)});
 window.matchMedia=()=>({matches:mobile,addEventListener:noop,removeEventListener:noop});
 class ClockDate extends Date{constructor(...args:any[]){super(...(args.length?args:[wallNow]) as [any]);}static now(){return now;}}
 const workspaceModule={exports:{} as any};vm.runInNewContext(workspaceCompiled,{module:workspaceModule,exports:workspaceModule.exports,require:(n:string)=>{assert.ok(n==='react'||n==='./ChatWorkspace.css');return n==='react'?hooks:{};},window,document,navigator,Date:ClockDate});
 const pollModule={exports:{} as any};vm.runInNewContext(poll,{module:pollModule,exports:pollModule.exports});
 class ApiError extends Error{status:number;network:boolean;constructor(message:string,status=0){super(message);this.status=status;this.network=!status;}}
 const imports:Record<string,any>={react:hooks,'../api':{ApiError},'../format':{formatIsoLocal:(value:any)=>{formatCount++;return formatModule.exports.formatIsoLocal(value);}},'./member-inbox':{announceInboxChange:()=>window.dispatch('inbox-updated'),INBOX_ALL_READ:'all-read'},'./MemberReporting':{ReportButton:'ReportButton'},'./message-refresh':{refreshLoadedMessages:unused},'../game-console-core':{logConsoleEvent:unused},'../game-console-routing':{consoleChannel:unused},'../../../../modules/member-communications/stickers':{findChatSticker:unused},'./ChatContent':{ChatBody:'ChatBody',ChatQuote:'ChatQuote',ChatExtras:'ChatExtras',ChatRetracted:'ChatRetracted',RetractMessageDialog:'RetractMessageDialog',chatPayload:unused,quoteMessage:unused,useRichChatDraft:()=>({get:()=>({}),change:noop,clear:noop})},'./ChatWorkspace':{ChatInput:'ChatInput',ChatTime:'ChatTime',chatCalendarKey:workspaceModule.exports.chatCalendarKey,useChatViewport:workspaceModule.exports.useChatViewport,useVisibleChatRead:workspaceModule.exports.useVisibleChatRead},'./ChatSearch':{ChatSearch:'ChatSearch'},'./message-image-client':{matchesChannelMessageAck:unused},'./adaptive-chat-poll':pollModule.exports,'./MemberSettings.css':{}};
 const module={exports:{} as any};
 vm.runInNewContext(programs[variant],{module,exports:module.exports,Error,Date:ClockDate,React:{createElement:(type:any,props:any,...children:any[])=>({type,props:props??{},children})},require:(n:string)=>{assert.ok(n in imports,n);return imports[n];},window,document,navigator,requestAnimationFrame:(run:()=>void)=>{run();return++serial;}});
 const props:any={kind,client:{sessionGeneration:1,get(url:string,options?:unknown){return new Promise((resolve,reject)=>calls.push({url,options,resolve,reject,done:false}));},post(...args:unknown[]){writes.push(args);return unused();}},session:{user:{user_id:'synthetic-user'}},onUnread:(v:unknown)=>unread.push(v),onNavigate:unused,active,compact};
 function render(){assert.equal(writes.length,0,'no POST in list/composer fixture');if(disposed)return;let n=0;do{dirty=false;cursor=0;tree=module.exports.MemberChannels(props);while(effects.length)effects.shift()!();assert.ok(++n<20,'render settled');}while(dirty);}
 function walk(v:any,a:any[]=[]):any[]{if(v==null)return a;if(Array.isArray(v))v.forEach(x=>walk(x,a));else if(typeof v==='object'){a.push(v);walk(v.children,a);}return a;}
 const nodes=()=>walk(tree),listCalls=()=>calls.filter(c=>/^\/me\/channels\?/.test(c.url)),activityCalls=()=>calls.filter(c=>c.url.endsWith('/activity')),historyCalls=()=>calls.filter(c=>c.url.includes('/messages?'));
 function state(){return {rooms:nodes().filter(n=>n.props['data-channel-key']).map(n=>n.props['data-channel-key']),unread:unread.at(-1),selected:nodes().some(n=>n.props['aria-current']==='true'),visibleList:!nodes().find(n=>n.type==='section'&&n.props.className==='messages-side stack')?.props.hidden,listeners:{focus:window.listeners.get('focus')?.size??0,online:window.listeners.get('online')?.size??0,visibility:document.listeners.get('visibilitychange')?.size??0},intervals:[...timers.values()].filter(x=>x.interval).length};}
 async function resolve(call:Call,page:any){call.done=true;call.resolve(page);await microtasks();render();}
 const room=(key='old',count=0)=>({kind,channel_key:key,name:key,unread_count:count,last_message_at:null as string|null});
 async function ready(){assert.equal(calls.length,1);await resolve(calls[0],{items:[room()],unread_count:0,next_offset:null});}
 async function choose(key='old'){const n=nodes().find(n=>n.props['data-channel-key']===key);assert.ok(n);n.props.onClick();render();const call=historyCalls().at(-1)!;await resolve(call,{channel:{kind,channel_key:key,name:key},items:[],unread_count:0,next_offset:null});}
 function back(){const n=nodes().find(n=>n.type==='button'&&/返回.*列表/.test(n.props['aria-label']??''));assert.ok(n);n.props.onClick();render();}
 function event(name:string,value?:string){if(name==='visibilitychange'){document.visibilityState=value!;document.dispatch(name);}else{if(name==='online')navigator.onLine=true;if(name==='offline')navigator.onLine=false;window.dispatch(name);}render();}
 async function tick(ms=1000){now+=ms;for(const t of [...timers.values()])if(t.interval)t.run();render();for(const c of activityCalls().filter(c=>!c.done))await resolve(c,{latest_sequence:'0',unread_count:0,retraction_count:'0'});}
 async function reject(call:Call,cause=new Error('synthetic network error')){assert.ok(call&&!call.done);call.done=true;call.reject(cause);await microtasks();render();}
 function button(label:string){const node=nodes().find(n=>n.type==='button'&&(n.props['aria-label']===label||text(n)===label));assert.ok(node,'button '+label);node.props.onClick();render();}
 function debounce(){const timer=[...timers].find(([,v])=>!v.interval&&v.delay===250);assert.ok(timer);timers.delete(timer[0]);timer[1].run();render();}
 function count(){return{list:listCalls().length,activity:activityCalls().length,history:historyCalls().length,total:calls.length};}
 function unmount(){disposed=true;for(const slot of slots)slot?.cleanup?.();}
 function query(value:string){nodes().find(n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value}});render();}
 const metrics=()=>({formatCount});
 render();return {metrics,ApiError,reject,button,debounce,setWallNow:(value:number)=>wallNow=value,render,state,ready,choose,back,event,tick,resolve,room,calls,listCalls,activityCalls,historyCalls,unread,count,props,document,navigator,nodes,unmount,query};
}

function text(v:any):string{return v==null||typeof v==='boolean'?'':Array.isArray(v)?v.map(text).join(''):typeof v==='object'?text(v.children):String(v);}
async function setup(kind:string,mode:string,rows:number,variant:keyof typeof programs='candidate'){
 const h=host(kind,mode==='phone',true,mode==='compact',variant);
 const rooms=Array.from({length:rows},(_,i)=>({...h.room(i===0?'old':`room-${i}`,i%2?3:0),last_message_at:'2026-11-04T06:11:22.000Z'}));
 for(let offset=0;offset<rows;offset+=20){if(offset){h.nodes().find(n=>n.type==='button'&&text(n).startsWith('載入更多')).props.onClick();h.render();}await h.resolve(h.listCalls().at(-1)!,{items:rooms.slice(offset,offset+20),unread_count:Math.floor(rows/2)*3,next_offset:offset+20<rows?offset+20:null});}
 await h.choose();assert.equal(h.state().visibleList,mode==='desktop');assert.equal(h.state().rooms.length,rows);return h;
}
function edit(h:ReturnType<typeof host>,value:string){h.nodes().find(n=>n.type==='ChatInput').props.onChange(value);h.render();assert.equal(h.nodes().find(n=>n.type==='ChatInput').props.value,value);}
// Deterministic work counts, not timing thresholds or real-device claims.
for(const kind of ['guild','squad'])for(const mode of ['desktop','phone','compact'])for(const rows of [20,40,100])test(`${kind}/${mode}/${rows}: draft edits reuse labels but keep current row handlers`,async()=>{
 const h=await setup(kind,mode,rows),before=h.metrics(),requests=h.count(),row=h.nodes().find(n=>n.props['data-channel-key']==='old');
 for(let i=0;i<12;i++)edit(h,`草稿${i}`);
 assert.equal(h.metrics().formatCount-before.formatCount,0);assert.deepEqual(h.count(),requests);assert.equal(h.state().visibleList,mode==='desktop');
 const latest=h.nodes().find(n=>n.props['data-channel-key']==='old');assert.notEqual(latest,row);assert.notEqual(latest.props.onClick,row.props.onClick);h.unmount();
});
type Host=ReturnType<typeof host>;
const row=(h:Host,key='old')=>h.nodes().find(n=>n.props['data-channel-key']===key);
const label=(h:Host,key='old')=>text(row(h,key)).replace(/\d+ 則未讀$/,'');
const page=(items:any[],next:number|null=null)=>({items,unread_count:items.reduce((n,item)=>n+item.unread_count,0),next_offset:next});
async function refresh(h:Host,items:any[]){h.button(`重新整理${h.props.kind==='guild'?'公會':'小隊'}頻道`);await h.resolve(h.listCalls().at(-1)!,page(items));}
for(const kind of ['guild','squad']){
 test(`${kind}: each visible timestamp formats once and its accessible description uses the identical label`,async()=>{
  const h=host(kind),before=h.metrics().formatCount;await h.resolve(h.listCalls()[0],page([{...h.room(),last_message_at:'2026-11-04T06:11:22Z'},h.room('empty')]));
  assert.equal(h.metrics().formatCount-before,1);const preview=h.nodes().find(n=>n.props.className==='messages-meta chat-peer-preview'),description=h.nodes().find(n=>n.props.id===row(h).props['aria-describedby']);assert.ok(text(description).startsWith(text(preview)));assert.ok(label(h,'empty').includes('尚無訊息'));h.unmount();
 });
 test(`${kind}: fresh timestamps, names and unread counts replace previously formatted labels`,async()=>{
  const h=await setup(kind,'desktop',20),before=label(h);await refresh(h,[{...h.room('old',7),name:'更新名稱',last_message_at:'2026-11-05T07:22:33Z'}]);
  assert.notEqual(label(h),before);assert.equal(row(h).props['aria-label'],'更新名稱');assert.ok(text(row(h)).includes('7 則未讀'));assert.equal(h.unread.at(-1),7);
  await refresh(h,[h.room()]);assert.ok(label(h).includes('尚無訊息'));await refresh(h,[]);assert.equal(row(h),undefined);h.unmount();
 });
 test(`${kind}: query changes filter first, never formatting hidden nonmatches`,async()=>{
  const h=await setup(kind,'desktop',20),before=h.metrics().formatCount;h.query(' ROOM-1 ');
  assert.deepEqual(h.state().rooms,['room-1',...Array.from({length:10},(_,i)=>'room-'+(i+10))]);assert.equal(h.metrics().formatCount-before,11);
  const filtered=h.metrics().formatCount;edit(h,'仍在原頻道');assert.equal(h.metrics().formatCount,filtered);h.query('不存在');assert.deepEqual(h.state().rooms,[]);assert.equal(h.metrics().formatCount,filtered);h.query('');assert.equal(h.state().rooms.length,20);h.unmount();
 });
 test(`${kind}: latest selection callback uses the current client, selected state and each room draft`,async()=>{
  const h=await setup(kind,'desktop',20);edit(h,'舊房草稿');const original=h.props.client,reads:string[]=[];h.props.client={...original,get(url:string,options?:unknown){reads.push(url);return original.get(url,options);}};h.render();
  await h.choose('room-1');assert.ok(reads.some(url=>url.includes('/room-1/messages?')));assert.equal(row(h,'room-1').props['aria-current'],'true');assert.equal(row(h).props['aria-current'],undefined);
  edit(h,'新房草稿');await h.choose('old');assert.equal(h.nodes().find(n=>n.type==='ChatInput').props.value,'舊房草稿');h.unmount();
 });
 test(`${kind}: a revoked selection rereads the current query using current client and unread callback`,async()=>{
  const h=await setup(kind,'desktop',20);h.query('room-1');const original=h.props.client,reads:string[]=[],counts:unknown[]=[];h.props.client={...original,get(url:string,options?:unknown){reads.push(url);return original.get(url,options);}};h.props.onUnread=(value:unknown)=>counts.push(value);const count=h.metrics().formatCount;h.render();assert.equal(h.metrics().formatCount,count);
  row(h,'room-1').props.onClick();h.render();await h.reject(h.historyCalls().at(-1)!,new h.ApiError('synthetic access revoked',403));assert.equal(row(h,'room-1'),undefined);assert.match(h.listCalls().at(-1)!.url,/search=room-1/);assert.ok(reads.some(url=>url.includes('/room-1/messages?')));assert.ok(reads.some(url=>url.includes('search=room-1')));
  await h.resolve(h.listCalls().at(-1)!,page([h.room('room-10',9)]));assert.deepEqual(counts,[9]);h.unmount();
 });
 test(`${kind}: query debounce and pagination still use their existing request paths`,async()=>{
  const h=host(kind);await h.resolve(h.listCalls()[0],page([h.room('match')],20));h.query('match');h.debounce();const search=h.listCalls().at(-1)!;assert.match(search.url,/search=match/);
  await h.resolve(search,page([h.room('match')],20));h.button(`載入更多${kind==='guild'?'公會':'小隊'}頻道`);const more=h.listCalls().at(-1)!;assert.match(more.url,/offset=20&search=match/);await h.resolve(more,page([h.room('match-two')]));assert.deepEqual(h.state().rooms,['match','match-two']);h.unmount();
 });
 test(`${kind}: failed and superseded refreshes do not revive stale labels`,async()=>{
  const h=await setup(kind,'desktop',20),before=label(h),button=`重新整理${kind==='guild'?'公會':'小隊'}頻道`;h.button(button);await h.reject(h.listCalls().at(-1)!);assert.equal(label(h),before);
  h.button(button);const stale=h.listCalls().at(-1)!;h.event('all-read');const current=h.listCalls().at(-1)!;await h.resolve(current,page([{...h.room('fresh',3),last_message_at:'2026-11-05T07:22:33Z'}]));await h.resolve(stale,page([h.room('stale')]));assert.deepEqual(h.state().rooms,['fresh']);h.unmount();
 });
 for(const status of [403,404])test(`${kind}: ${status} on a selected history still removes the cached room`,async()=>{
  const h=await setup(kind,'desktop',20);h.button('重新讀取訊息');await h.reject(h.historyCalls().at(-1)!,new h.ApiError('synthetic access revoked',status));assert.equal(row(h),undefined);assert.equal(h.nodes().find(n=>n.type==='ChatInput'),undefined);h.unmount();
 });
}
test('timezone changes invalidate labels with unchanged server timestamps',async()=>{
 const previous=process.env.TZ;try{process.env.TZ='UTC';const h=await setup('guild','desktop',20),before=label(h),count=h.metrics().formatCount;process.env.TZ='Asia/Taipei';h.render();assert.notEqual(label(h),before);assert.equal(h.metrics().formatCount-count,20);h.unmount();}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('calendar rollover retains the shared timestamp invalidation boundary',async()=>{
 const h=await setup('squad','desktop',20),count=h.metrics().formatCount;h.setWallNow(Date.parse('2026-11-05T12:00:00Z'));h.render();assert.equal(h.metrics().formatCount-count,20);h.unmount();
});
test('invalid timestamp fallback remains visible and identical in the accessible description',async()=>{
 const h=host(),before=h.metrics().formatCount;await h.resolve(h.listCalls()[0],page([{...h.room(),last_message_at:'not-a-date'}]));assert.equal(h.metrics().formatCount-before,1);assert.ok(label(h).includes('最後訊息 not-a-date'));const description=h.nodes().find(n=>n.props.id===row(h).props['aria-describedby']);assert.ok(text(description).startsWith('最後訊息 not-a-date'));h.unmount();
});
test('world chat never formats a guild or squad list',async()=>{
 const h=host('world');assert.equal(h.listCalls().length,0);assert.equal(h.metrics().formatCount,0);const call=h.historyCalls()[0];assert.ok(call);await h.resolve(call,{channel:{kind:'world',channel_key:'world',name:'世界聊天'},items:[],unread_count:0,next_offset:null});edit(h,'世界草稿');assert.equal(h.metrics().formatCount,0);h.unmount();
});
