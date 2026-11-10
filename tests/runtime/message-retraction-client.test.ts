import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {transformSync} from 'esbuild';
import {refreshLoadedMessages} from '../../apps/portal-web/src/modules/message-refresh.js';
import type {Pool} from 'pg';
import type {DirectMessageContentInput} from '../../modules/member-communications/content-types.js';
import {messageContents} from '../../modules/member-communications/content.js';
import {matchesDirectMessageAck,matchesChannelMessageAck} from '../../apps/portal-web/src/modules/message-image-client.js';

// Review #405: exercise the real redacted projection and strict client ACKs.
// The server/client retain only the original target identity after redaction.
const sender='10000000-0000-4000-8000-000000000001',recipient='10000000-0000-4000-8000-000000000002';
const id='10000000-0000-4000-8000-000000000003',quoteId='10000000-0000-4000-8000-000000000004';
const now='2026-10-10T04:00:00.000Z';
for(const kind of ['direct','channel'] as const){
  test(`${kind}: a successfully committed reply remains acknowledgeable after its quote is retracted`,async()=>{
    let quoteVisible=true;
    const q={query:async(sql:string)=>({rows:sql.includes('left(m.body,160)')&&quoteVisible?[{message_id:quoteId,sender_ref:recipient,sender_name:'Synthetic',body:'private original',sticker_id:null}]:[]})} as unknown as Pool;
    const row={message_id:id,sender_ref:sender,recipient_ref:recipient,sender_name:'Synthetic',kind:'world' as const,channel_key:'world',sequence:'1',body:'reply',created_at:now,read_at:null,retracted_at:null,reply_to_message_id:quoteId};
    const payload={body:'reply',reply_to_message_id:quoteId};
    const matches=(value:unknown)=>kind==='direct'?matchesDirectMessageAck(value,{sender,recipient,payload}):matchesChannelMessageAck(value,{sender,kind:'world',channelKey:'world',payload});
    assert.equal(matches({...row,...(await messageContents(q,[row],kind,sender))[0]}),true);
    quoteVisible=false;
    const content=(await messageContents(q,[row],kind,sender))[0];
    assert.deepEqual(content,{reply_to_message_id:quoteId});
    const {reply_to_message_id:_databaseOnly,...projected}=row;
    const redacted={...projected,...content};
    assert.equal(JSON.stringify(redacted).includes('private original'),false);
    assert.equal(matches(redacted),true,'a committed reply must not remain unknown forever solely because its referenced message was retracted');
    for(const wrong of [undefined,'invalid',sender])assert.equal(matches({...redacted,reply_to_message_id:wrong}),false,'missing or unrelated targets cannot acknowledge this operation');
  });
}


test('retraction refresh replaces loaded older messages and quotes without retaining unavailable rows',async()=>{
  const {refreshLoadedMessages}=await import('../../apps/portal-web/src/modules/message-refresh.js');
  type Message={message_id:string;body:string;reply_to?:{body:string};retracted_at?:string;reply_to_message_id?:string};
  const old:Message[]=[{message_id:'old',body:'sensitive'},{message_id:'quote',body:'reply',reply_to:{body:'sensitive'}},{message_id:'gone',body:'no longer visible'}];
  const seen:number[]=[];
  const result=await refreshLoadedMessages<Message>({items:[{message_id:'new',body:'latest'}],next_offset:20},old,async offset=>{
    seen.push(offset);return {items:[{message_id:'old',body:'',retracted_at:now},{message_id:'quote',body:'reply',reply_to_message_id:quoteId}],next_offset:null};
  },()=>true);
  assert.deepEqual(seen,[20]);assert.deepEqual(result?.map(x=>x.message_id),['new','old','quote']);
  assert.ok(!JSON.stringify(result).includes('sensitive'));assert.ok(!JSON.stringify(result).includes('no longer visible'));
});
test('retraction refresh discards a superseded conversation result and rejects a looping history cursor',async()=>{
  const {refreshLoadedMessages}=await import('../../apps/portal-web/src/modules/message-refresh.js');
  let current=true;
  assert.equal(await refreshLoadedMessages({items:[],next_offset:20},[{message_id:'old'}],async()=>{current=false;return {items:[{message_id:'old'}],next_offset:null};},()=>current),null);
  await assert.rejects(()=>refreshLoadedMessages({items:[],next_offset:20},[{message_id:'old'}],async()=>({items:[],next_offset:20}),()=>true),/重讀對話/);
});

for(const kind of ['direct','channel'] as const){
  const payloads=[{body:'my text'},{sticker_id:'workshop-v1-hello'},{body:'quoted text',reply_to_message_id:quoteId},{sticker_id:'workshop-v1-hello',reply_to_message_id:quoteId},...(kind==='direct'?[{image_id:id},{body:'image caption',image_id:id,reply_to_message_id:quoteId}]:[])];
  test(`${kind}: the original send POST can acknowledge its own retracted message without restoring private content`,async()=>{
    const q={query:async()=>{throw Error('Retracted content must not be read');}} as unknown as Pool;
    for(const payload of payloads){
      const content=(await messageContents(q,[{message_id:id,retracted_at:now,sticker_id:'workshop-v1-hello',reply_to_message_id:quoteId}],kind,sender))[0];
      assert.deepEqual(content,{});
      const value={message_id:id,sender_ref:sender,recipient_ref:recipient,sender_name:'Synthetic',kind:'world',channel_key:'world',sequence:'1',body:'',created_at:now,read_at:null,retracted_at:now,...content};
      assert.equal(kind==='direct'?matchesDirectMessageAck(value,{sender,recipient,payload}):matchesChannelMessageAck(value,{sender,kind:'world',channelKey:'world',payload}),true,JSON.stringify(payload));
    }
  });
  test(`${kind}: malformed tombstones and invalid original payloads cannot unlock an unknown send`,()=>{
    const value={message_id:id,sender_ref:sender,recipient_ref:recipient,sender_name:'Synthetic',kind:'world',channel_key:'world',sequence:'1',body:'',created_at:now,read_at:null,retracted_at:now};
    const payload={sticker_id:'workshop-v1-hello'};
    const matches=(dto:unknown,input:DirectMessageContentInput=payload)=>kind==='direct'?matchesDirectMessageAck(dto,{sender,recipient,payload:input}):matchesChannelMessageAck(dto,{sender,kind:'world',channelKey:'world',payload:input});
    const patches:Record<string,unknown>[]=[{body:'[貼圖] 你好'},{body:undefined},{retracted_at:undefined},{retracted_at:null},{retracted_at:''},{retracted_at:'invalid'},{retracted_at:'2026-02-30T00:00:00.000Z'},{retracted_at:'2026-10-10'},{retracted_at:123},{sender_ref:recipient},{message_id:'invalid'},{created_at:'invalid'},...(kind==='direct'?[{recipient_ref:sender},{read_at:'invalid'}]:[{kind:'guild'},{channel_key:'another-room'},{sequence:'0'},{sequence:'9223372036854775808'},{sequence:1},{sender_name:null}])];
    for(const key of ['sticker','image','reply_to','reply_to_message_id','sticker_id','image_id'])for(const extra of [null,{},id])patches.push({[key]:extra});
    for(const patch of patches)assert.equal(matches({...value,...patch}),false,JSON.stringify(patch));
    for(const input of [{},{body:''},{body:' \r\n '},{body:'a\u0000b'},{body:'x'.repeat(2001)},{sticker_id:'missing'},{body:'text',sticker_id:'workshop-v1-hello'},{image_id:id,sticker_id:'workshop-v1-hello'},{image_id:'invalid'},{body:'text',reply_to_message_id:'invalid'},...(kind==='channel'?[{image_id:id}]:[])])assert.equal(matches(value,input),false,JSON.stringify(input));
    // A corrupt retraction stamp must not fall through to active-content matching.
    assert.equal(matches({...value,body:'[貼圖] 你好',sticker:{id:payload.sticker_id,label:'你好'},retracted_at:'invalid'}),false);
  });
}

// ACK reconciliation consumes already-authorized UI projections, never uses a
// generic GET to settle the pending command, and must not mutate either input.
test('late ACK reconciliation gives any known tombstone precedence without resurrecting media',async()=>{
  const {reconcileMessageAck}=await import('../../apps/portal-web/src/modules/message-refresh.js');
  type Row={message_id:string;body:string;retracted_at:string|null;read_at:string|null;sticker?:{id:string};image?:{content_type:string};reply_to?:{message_id:string;body:string}};
  const live:Row={message_id:id,body:'private',retracted_at:null,read_at:null,sticker:{id:'sticker'},image:{content_type:'image/webp'},reply_to:{message_id:quoteId,body:'private quote'}};
  const tombstone:Row={message_id:id,body:'',retracted_at:now,read_at:null};
  const before=JSON.stringify(live);
  assert.equal(reconcileMessageAck(live,[live,tombstone]),tombstone,'scan all projections, not only the first matching ID');
  assert.equal(reconcileMessageAck(tombstone,[live]),tombstone,'a fresh tombstone also wins');
  assert.equal(JSON.stringify(live),before);
  assert.equal(JSON.stringify(reconcileMessageAck(live,[tombstone])).includes('private'),false);
});

test('late ACK quote reconciliation requires exact target evidence and retains known read status',async()=>{
  const {reconcileMessageAck}=await import('../../apps/portal-web/src/modules/message-refresh.js');
  type Row={message_id:string;body:string;read_at:string|null;retracted_at?:string|null;reply_to?:{message_id:string;body:string};reply_to_message_id?:string};
  const live:Row={message_id:id,body:'reply',read_at:null,reply_to:{message_id:quoteId,body:'private quote'}};
  const redacted:Row={message_id:id,body:'reply',read_at:now,reply_to_message_id:quoteId};
  const original=JSON.stringify([live,redacted]);
  const result=reconcileMessageAck(live,[live,redacted]);
  assert.deepEqual(result,{message_id:id,body:'reply',read_at:now,reply_to_message_id:quoteId});
  const target:Row={message_id:quoteId,body:'',read_at:null,retracted_at:now};
  assert.equal(reconcileMessageAck(live,[target]).reply_to,undefined);
  for(const unrelated of [{message_id:recipient,body:'',read_at:null,retracted_at:now},{...redacted,reply_to_message_id:recipient},{message_id:id,body:'reply',read_at:null}]){
    assert.equal(reconcileMessageAck<Row>(live,[unrelated]).reply_to,live.reply_to,'absence or unrelated identity is not redaction proof');
  }
  assert.equal(reconcileMessageAck(live,[]),live);
  assert.equal(JSON.stringify([live,redacted]),original,'inputs remain unchanged');
});

// Execute the production closures with deferred transports. This proves request
// ordering, not React scheduling, browser layout, HTTP or database behavior.
function channelSourceFunction(name:string){
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/modules/MemberChannels.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm'}).code;
  const start=new RegExp(`^( *)(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(start,name);
  const tail=source.slice(start.index),end=new RegExp(`^${start[1]}}`,'m').exec(tail);assert.ok(end,`${name} end`);
  return tail.slice(0,end.index+end[0].length);
}
function channelRetractionHost(kind:'guild'|'squad'|'world'){
  const key=kind==='world'?'world':'synthetic-room';
  const original={message_id:id,kind,channel_key:key,sequence:'2',sender_ref:sender,sender_name:'Synthetic',created_at:now,body:'withdrawn private text',retracted_at:null,sticker:{id:'workshop-v1-hello'},reply_to:{message_id:quoteId,body:'withdrawn quote'}};
  const reply={...original,message_id:quoteId,sequence:'3',body:'keep this reply',sticker:undefined,reply_to:{message_id:id,body:original.body}};
  const initial={channel:{kind,channel_key:key,name:'Synthetic'},items:[reply,original],unread_count:0,next_offset:20,retraction_count:'0'};
  const calls:Array<{method:string;path:string;resolve:(value:any)=>void;reject:(cause:Error)=>void}>=[],reloads:Promise<unknown>[]=[];
  const noop=()=>{};
  const state:any={kind,selected:{key},current:{current:key},epoch:{current:1},alive:{current:true},history:structuredClone(initial),more:{loading:false},snapshot:{current:{}},
    threadGeneration:{current:0},threadInFlight:{current:null},idlePoll:{current:{}},readIssues:{current:new Map()},gone:{current:new Set()},listInFlight:{current:null},listState:{current:'ready'},
    retractTarget:{message_id:id},retractTrigger:{current:null},retracting:false,retractError:'',refresh:{loading:false,error:''},scroll:{current:null},anchor:{current:null},
    PAGE:20,Error,crypto:{randomUUID},resetChatPoll:()=>({}),refreshLoadedMessages,
    newestFirst:(items:any[])=>[...items].sort((a,b)=>Number(b.sequence)-Number(a.sequence)),
    merge:(a:any[],b:any[],identity:(x:any)=>string)=>[...a,...b.filter(item=>!a.some(prior=>identity(prior)===identity(item)))],
    path:(room:string,suffix:string)=>`/me/channels/${kind}/${room}/${suffix}`,fail:(cause:Error)=>cause.message,revoked:()=>false,
    setMore:(value:any)=>state.more=value,setReadError:noop,setRefresh:(value:any)=>state.refresh=value,setStatus:noop,setError:noop,setNewerUnseen:noop,setCountUnconfirmed:noop,setLiveError:noop,
    onUnread:noop,loadList:noop,announceInboxChange:noop,setRetractTarget:(value:any)=>state.retractTarget=value,setRetracting:(value:boolean)=>state.retracting=value,setRetractError:(value:string)=>state.retractError=value,
    setHistory:(update:any)=>{state.history=typeof update==='function'?update(state.history):update;state.snapshot.current.history=state.history;},
    client:{sessionGeneration:1,get:(path:string)=>new Promise((resolve,reject)=>calls.push({method:'GET',path,resolve,reject})),post:(path:string)=>new Promise((resolve,reject)=>calls.push({method:'POST',path,resolve,reject}))},
  };
  state.snapshot.current.history=state.history;
  const load=runInNewContext(`${channelSourceFunction('loadThread')};loadThread`,state);
  state.loadThread=(...args:any[])=>{const promise=load(...args);reloads.push(promise);return promise;};
  const retract=runInNewContext(`${channelSourceFunction('retract')};retract`,state),earlier=runInNewContext(`${channelSourceFunction('earlier')};earlier`,state);
  const fresh=()=>({...structuredClone(initial),retraction_count:'1',items:[{...reply,reply_to:undefined,reply_to_message_id:id},{message_id:id,kind,channel_key:key,sequence:'2',sender_ref:sender,sender_name:'Synthetic',created_at:now,body:'',retracted_at:now}]});
  const assertRedacted=()=>{assert.equal(state.history.items.find((item:any)=>item.message_id===id).retracted_at,now);assert.ok(!JSON.stringify(state.history.items).includes('withdrawn'),'neither message content nor its quote may reappear');};
  return {state,key,calls,reloads,load:state.loadThread,retract,earlier,initial,fresh,assertRedacted};
}
for(const kind of ['guild','squad','world'] as const){
  for(const oldLast of [false,true])test(`${kind}: confirmed retraction supersedes a quiet history response, old last=${oldLast}`,async()=>{
    const h=channelRetractionHost(kind),old=h.load(h.key,true),write=h.retract();
    h.calls[1].resolve({message_id:id,retracted_at:now});await write;h.assertRedacted();
    assert.equal(h.calls.length,3,'confirmation starts exactly one fresh history read');
    assert.equal(h.calls[2].method,'GET');assert.equal(h.state.refresh.loading,true);
    if(!oldLast){h.calls[0].resolve(h.initial);await old;h.assertRedacted();assert.equal(h.state.refresh.loading,true,'stale completion cannot release the replacement read');}
    h.calls[2].resolve(h.fresh());await h.reloads.at(-1);h.assertRedacted();assert.equal(h.state.refresh.loading,false);assert.equal(h.state.history.next_offset,20);
    if(oldLast){h.calls[0].resolve(h.initial);await old;h.assertRedacted();assert.equal(h.state.history.retraction_count,'1');}
  });
  test(`${kind}: failed post-retraction refresh preserves redaction and manual retry recovers`,async()=>{
    const h=channelRetractionHost(kind),old=h.load(h.key,true),write=h.retract();h.calls[1].resolve({message_id:id,retracted_at:now});await write;
    assert.equal(h.calls.length,3);h.calls[2].reject(new Error('synthetic offline'));await h.reloads.at(-1);
    h.calls[0].resolve(h.initial);await old;h.assertRedacted();assert.equal(h.state.refresh.loading,false);assert.equal(h.state.refresh.error,'synthetic offline');assert.equal(h.state.history.retraction_count,'0','failed refresh cannot consume the new revision');
    const retry=h.load(h.key,true);h.calls[3].resolve(h.fresh());await retry;h.assertRedacted();assert.equal(h.state.refresh.error,'');assert.equal(h.state.history.retraction_count,'1');
    assert.equal(h.calls.filter(call=>call.method==='POST').length,1,'never resend the confirmed mutation');
  });
  test(`${kind}: retraction fences an older page and retains its cursor for a later retry`,async()=>{
    const h=channelRetractionHost(kind),old=h.earlier(),write=h.retract();h.calls[1].resolve({message_id:id,retracted_at:now});await write;
    assert.equal(h.calls.length,3);h.calls[0].resolve({...h.initial,next_offset:null});await old;h.assertRedacted();assert.equal(h.state.history.next_offset,20);
    h.calls[2].resolve(h.fresh());await h.reloads.at(-1);assert.equal(h.state.more.loading,false);
    const retry=h.earlier();assert.match(h.calls[3].path,/offset=20$/);h.calls[3].resolve({...h.fresh(),next_offset:null});await retry;assert.equal(h.state.history.next_offset,null);h.assertRedacted();
  });
}
for(const boundary of ['selection','session','unmount'] as const)test(`channel retraction does not start a history read after ${boundary} changes`,async()=>{
  const h=channelRetractionHost('guild'),write=h.retract();
  if(boundary==='selection'){h.state.current.current='other-room';h.state.history={...h.state.history,channel:{channel_key:'other-room'},items:[]};h.state.snapshot.current.history=h.state.history;}
  else if(boundary==='session')h.state.client.sessionGeneration++;
  else h.state.alive.current=false;
  const before=JSON.stringify(h.state.history);h.calls[0].resolve({message_id:id,retracted_at:now});await write;
  assert.equal(h.calls.length,1);assert.equal(JSON.stringify(h.state.history),before);
});
for(const kind of ['guild','squad','world'] as const)test(`${kind}: failed retraction leaves the pending history read and original content intact`,async()=>{
  const h=channelRetractionHost(kind),old=h.load(h.key,true),write=h.retract(),generation=h.state.threadGeneration.current;
  h.calls[1].reject(new Error('synthetic rejected retract'));await write;
  assert.equal(h.calls.length,2);assert.equal(h.state.threadGeneration.current,generation);assert.equal(h.state.retractError,'synthetic rejected retract');
  assert.equal(h.state.history.items.find((item:any)=>item.message_id===id).body,'withdrawn private text');
  h.calls[0].resolve(h.initial);await old;assert.equal(h.state.refresh.loading,false);assert.equal(h.state.history.retraction_count,'0');
});
