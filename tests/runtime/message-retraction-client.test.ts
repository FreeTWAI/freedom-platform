import {test} from 'node:test';
import assert from 'node:assert/strict';
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
