import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Run the complete production module and real input/effect/GET/pagination
// handlers under a deterministic hook host. This is not browser/React/DB proof.
type Element={type:any;props:any;children:any[]};
type Kind='guild'|'squad';
type Call={url:string;resolve:(page:any)=>void;reject:(cause:Error)=>void};
const production=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/MemberChannels.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'cjs',jsx:'transform'}).code;
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
function fixture(kind:Kind,mobile:boolean){
  let cursor=0,tree:Element,serial=0;
  const slots:any[]=[],effects:Array<()=>void>=[],timers=new Map<number,{run:()=>void;delay:number}>(),calls:Call[]=[],unread:unknown[]=[],navigations:string[]=[];
  const same=(a:any[],b:any[])=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const effect=(run:()=>void|(()=>void),deps:any[])=>{const index=cursor++,old=slots[index];if(!old||!same(old.deps,deps)){slots[index]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=run();});}};
  const noop=()=>{};
  const hooks={
    useState:(initial:any)=>{const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,(value:any)=>{slots[index].value=typeof value==='function'?value(slots[index].value):value;}];},
    useRef:(initial:any)=>{const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},
    useId:()=>':channel-search:',useEffect:effect,useLayoutEffect:effect,
    useMemo:(run:()=>any,deps:any[])=>{const index=cursor++;if(!slots[index]||!same(slots[index].deps,deps))slots[index]={deps,value:run()};return slots[index].value;},
  };
  const unused=()=>{throw Error('Unexpected operation outside the list fixture');};
  class ApiError extends Error{}
  const imports:Record<string,any>={
    react:hooks,'../api':{ApiError},'../format':{formatIsoLocal:String},
    './member-inbox':{announceInboxChange:noop,INBOX_ALL_READ:'all-read'},
    './MemberReporting':{ReportButton:'ReportButton'},'./message-refresh':{refreshLoadedMessages:unused},
    '../game-console-core':{logConsoleEvent:unused},'../game-console-routing':{consoleChannel:unused},
    '../../../../modules/member-communications/stickers':{findChatSticker:unused},
    './ChatContent':{ChatBody:'ChatBody',ChatQuote:'ChatQuote',ChatExtras:'ChatExtras',ChatRetracted:'ChatRetracted',RetractMessageDialog:'RetractMessageDialog',chatPayload:unused,quoteMessage:unused,useRichChatDraft:()=>({get:()=>({}),change:noop,clear:noop})},
    './ChatWorkspace':{ChatInput:'ChatInput',ChatTime:'ChatTime',chatCalendarKey:()=>'',useChatViewport:()=>mobile,useVisibleChatRead:noop},
    './ChatSearch':{ChatSearch:'ChatSearch'},'./message-image-client':{matchesChannelMessageAck:unused},
    './adaptive-chat-poll':{resetChatPoll:()=>({}),chatPollDue:unused,idleChatPoll:unused},'./MemberSettings.css':{},
  };
  const module={exports:{} as any};
  runInNewContext(production,{module,exports:module.exports,Error,React:{createElement:(type:any,props:any,...children:any[]):Element=>({type,props:props??{},children})},
    require:(name:string)=>{assert.ok(name in imports,`Unexpected import ${name}`);return imports[name];},
    window:{addEventListener:noop,removeEventListener:noop,setTimeout:(run:()=>void,delay:number)=>{const id=++serial;timers.set(id,{run,delay});return id;},clearTimeout:(id:number)=>timers.delete(id),setInterval:()=>++serial,clearInterval:noop},
    document:{visibilityState:'visible'},navigator:{onLine:true},
  });
  const props={kind,client:{get:(url:string)=>{assert.match(url,/^\/me\/channels\?kind=/);return new Promise((resolve,reject)=>calls.push({url,resolve,reject}));},post:unused},session:{user:{user_id:'synthetic-user'}},onUnread:(value:unknown)=>unread.push(value),onNavigate:(tab:string)=>navigations.push(tab),active:false};
  function render(){cursor=0;tree=module.exports.MemberChannels(props);while(effects.length)effects.shift()!();}
  function walk(value:any,nodes:Element[]=[]):Element[]{if(value==null)return nodes;if(Array.isArray(value)){for(const item of value)walk(item,nodes);}else if(typeof value==='object'){nodes.push(value);walk(value.children,nodes);}return nodes;}
  function text(value:any):string{return value==null||typeof value==='boolean'?'':Array.isArray(value)?value.map(text).join(''):typeof value==='object'?text(value.children):String(value);}
  const buttons=()=>walk(tree).filter(node=>node.type==='button');
  const more=()=>buttons().find(node=>/^(載入更多|重試載入更多)/.test(text(node)));
  function snapshot(){const nodes=walk(tree);return {
    membership:nodes.some(node=>node.type==='p'&&/你還沒有加入任何/.test(text(node))),
    cta:buttons().some(node=>/^前往(職業公會|小隊集合)$/.test(text(node))),
    searchEmpty:nodes.some(node=>node.type==='p'&&text(node)==='沒有符合的頻道，請換個關鍵字。'),
    error:nodes.some(node=>node.props.role==='alert'),
    rooms:buttons().filter(node=>node.props['data-channel-key']).map(node=>node.props['aria-label']),
    moreDisabled:more()?.props.disabled??null,
  };}
  function query(value:string){const input=walk(tree).find(node=>node.type==='input'&&node.props.type==='search');assert.ok(input);input.props.onChange({target:{value}});render();}
  function debounce(){const timer=[...timers].find(([,value])=>value.delay===250);assert.ok(timer,'The real search effect schedules 250ms');timers.delete(timer[0]);timer[1].run();render();}
  async function resolve(index:number,items:any[],next:number|null=null){calls[index].resolve({items,unread_count:17,next_offset:next});await tick();render();}
  async function reject(index:number){calls[index].reject(new Error('synthetic first-page failure'));await tick();render();}
  function refresh(){const button=buttons().find(node=>/^重新整理/.test(text(node)));assert.ok(button);button.props.onClick();render();}
  function moreHandler(){const button=more();assert.ok(button);return button.props.onClick as ()=>void;}
  function clickMore(){moreHandler()();render();}
  function navigate(){const button=buttons().find(node=>/^前往(職業公會|小隊集合)$/.test(text(node)));assert.ok(button);button.props.onClick();}
  render();assert.equal(calls.length,1);
  return {snapshot,query,debounce,resolve,reject,refresh,clickMore,moreHandler,navigate,calls,unread,navigations};
}
const room=(kind:Kind,name='已加入的頻道',key='joined-room')=>({kind,channel_key:key,name,unread_count:2,last_message_at:null});
function noEmpty(f:ReturnType<typeof fixture>){const state=f.snapshot();assert.equal(state.membership,false);assert.equal(state.cta,false);assert.equal(state.searchEmpty,false);}
for(const kind of ['guild','squad'] as const)for(const mobile of [false,true]){
  const label=`${kind}/${mobile?'phone':'desktop'}`;
  test(`${label}: confirmed unfiltered membership empty retains its real navigation`,async()=>{
    const f=fixture(kind,mobile);await f.resolve(0,[]);
    assert.equal(f.snapshot().membership,true);assert.equal(f.snapshot().cta,true);assert.equal(f.snapshot().searchEmpty,false);
    f.query('   ');assert.equal(f.snapshot().membership,true);assert.equal(f.calls.length,1);
    f.navigate();assert.deepEqual(f.navigations,[kind==='guild'?'guilds':'squads']);assert.deepEqual(f.unread,[17]);
  });
  test(`${label}: a missing search term is not evidence of missing membership`,async()=>{
    const f=fixture(kind,mobile);await f.resolve(0,[room(kind)]);
    f.query('不存在');noEmpty(f);f.debounce();noEmpty(f);
    assert.equal(new URL(f.calls[1].url,'https://fixture.invalid').searchParams.get('search'),'不存在');
    await f.resolve(1,[]);assert.equal(f.snapshot().searchEmpty,true);assert.equal(f.snapshot().membership,false);assert.equal(f.snapshot().cta,false);
    assert.deepEqual(f.unread,[17,17]);assert.deepEqual(f.navigations,[]);
  });
  test(`${label}: clearing a filtered empty waits for the full list before asserting membership`,async()=>{
    const f=fixture(kind,mobile);await f.resolve(0,[room(kind)]);f.query('不存在');f.debounce();await f.resolve(1,[]);
    f.query('');noEmpty(f);f.debounce();noEmpty(f);assert.doesNotMatch(f.calls[2].url,/search=/);
    await f.resolve(2,[room(kind)]);noEmpty(f);assert.deepEqual(f.snapshot().rooms,['已加入的頻道']);
  });
  test(`${label}: a failed clear preserves the error, not a false join CTA, and retry recovers`,async()=>{
    const f=fixture(kind,mobile);await f.resolve(0,[room(kind)]);f.query('不存在');f.debounce();await f.resolve(1,[]);
    f.query('');f.debounce();await f.reject(2);noEmpty(f);assert.equal(f.snapshot().error,true);
    f.refresh();noEmpty(f);await f.resolve(3,[room(kind)]);assert.equal(f.snapshot().error,false);assert.deepEqual(f.snapshot().rooms,['已加入的頻道']);
    assert.deepEqual(f.navigations,[]);
  });
  test(`${label}: old-query empty responses do not describe a newer query or replace its result`,async()=>{
    const f=fixture(kind,mobile);await f.resolve(0,[room(kind)]);f.query('舊搜尋');f.debounce();
    f.query('新搜尋');await f.resolve(1,[]);noEmpty(f);f.debounce();await f.reject(2);noEmpty(f);assert.equal(f.snapshot().error,true);
    f.refresh();f.query('更新搜尋');f.debounce();await f.resolve(4,[room(kind,'更新搜尋結果','new-room')]);
    await f.resolve(3,[]);noEmpty(f);assert.deepEqual(f.snapshot().rooms,['更新搜尋結果']);
  });
  test(`${label}: same-query refreshes suppress empty assertions and fence pagination until recovery`,async()=>{
    const empty=fixture(kind,mobile);await empty.resolve(0,[]);assert.equal(empty.snapshot().membership,true);
    empty.refresh();noEmpty(empty);await empty.reject(1);noEmpty(empty);assert.equal(empty.snapshot().error,true);
    empty.refresh();noEmpty(empty);await empty.resolve(2,[]);assert.equal(empty.snapshot().membership,true);assert.equal(empty.snapshot().cta,true);assert.equal(empty.snapshot().error,false);
    const paged=fixture(kind,mobile);await paged.resolve(0,[room(kind)],20);assert.equal(paged.snapshot().moreDisabled,false);
    paged.refresh();assert.equal(paged.snapshot().moreDisabled,true);paged.clickMore();assert.equal(paged.calls.length,2);
    await paged.reject(1);assert.equal(paged.snapshot().error,true);assert.equal(paged.snapshot().moreDisabled,true);paged.clickMore();assert.equal(paged.calls.length,2);
    paged.refresh();assert.equal(paged.snapshot().moreDisabled,true);await paged.resolve(2,[room(kind)],20);assert.equal(paged.snapshot().moreDisabled,false);
    paged.clickMore();assert.equal(paged.calls.length,4);assert.equal(new URL(paged.calls[3].url,'https://fixture.invalid').searchParams.get('offset'),'20');
    await paged.resolve(3,[room(kind,'第二頁','second')]);assert.deepEqual(paged.snapshot().rooms,['已加入的頻道','第二頁']);
  });
  test(`${label}: pagination requires a successful first page for the current query`,async()=>{
    const f=fixture(kind,mobile);await f.resolve(0,Array.from({length:20},(_,i)=>room(kind,`已加入${i}`,`old-${i}`)),20);
    assert.equal(f.snapshot().moreDisabled,false);
    f.query('新搜尋');assert.equal(f.snapshot().moreDisabled,true);f.clickMore();assert.equal(f.calls.length,1,'disabled-handler calls must not combine a new query with an old offset');
    f.debounce();assert.equal(f.snapshot().moreDisabled,true);f.clickMore();assert.equal(f.calls.length,2);
    await f.reject(1);assert.equal(f.snapshot().moreDisabled,true);f.clickMore();assert.equal(f.calls.length,2);
    f.refresh();await f.resolve(2,[room(kind,'新搜尋第一頁','new-first')],20);assert.equal(f.snapshot().moreDisabled,false);
    f.clickMore();const params=new URL(f.calls[3].url,'https://fixture.invalid').searchParams;assert.equal(params.get('offset'),'20');assert.equal(params.get('search'),'新搜尋');
    await f.resolve(3,[room(kind,'新搜尋第二頁','new-second')]);assert.deepEqual(f.snapshot().rooms,['新搜尋第一頁','新搜尋第二頁']);assert.equal(f.snapshot().moreDisabled,null);
  });
}
