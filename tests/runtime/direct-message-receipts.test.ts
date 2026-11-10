import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {transformSync} from 'esbuild';
import {refreshLoadedMessages} from '../../apps/portal-web/src/modules/message-refresh.js';
import {chatPollDue,idleChatPoll,resetChatPoll} from '../../apps/portal-web/src/modules/adaptive-chat-poll.js';
import {ApiError} from '../../apps/portal-web/src/api.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message, MessagePage } from '../../modules/member-communications/types.js';
import { compareDirectMessages, directMessageReceiptRefreshDue, hasDirectMessageChanges, mergeDirectMessagePage, readLoadedDirectMessageReceipts } from '../../apps/portal-web/src/modules/direct-message-receipts.js';

const readAt = '2026-10-04T06:00:00.000Z';
const message = (index: number, sender = 'sender', read: string | null = null): Message => ({
  message_id: String(index).padStart(4, '0'), sender_ref: sender, recipient_ref: sender === 'sender' ? 'peer' : 'sender',
  body: `synthetic ${index}`, created_at: new Date(Date.UTC(2026, 9, 4, 0, index)).toISOString(), read_at: read, retracted_at: null,
});
const page = (items: Message[], next: number | null = null): MessagePage => ({
  items, next_offset: next, unread_count: 0, can_send: true,
  participant: { user_id: 'peer', display_name: 'Synthetic peer', avatar_url: null, is_online: false, last_seen_at: null },
});

test('quiet refresh updates all 25 loaded outgoing receipts, including the older page', async () => {
  const loaded = Array.from({ length: 25 }, (_, i) => message(25 - i));
  const current = loaded.map(item => ({ ...item, read_at: readAt }));
  const latest = page(current.slice(0, 20), 20), offsets: number[] = [];
  const receipts = await readLoadedDirectMessageReceipts(latest, loaded, 'sender', async offset => {
    offsets.push(offset); return page(current.slice(offset));
  }, () => true);
  assert.deepEqual(offsets, [20]);
  const merged = mergeDirectMessagePage(latest.items, loaded, receipts!);
  assert.equal(merged.length, 25);
  assert.ok(merged.every(item => item.read_at === readAt));
  assert.ok(loaded.every(item => item.read_at === null), 'existing state is immutable');
});

test('latest outgoing below 21 incoming messages receives its own authoritative receipt', async () => {
  const outgoing = message(1), incoming = Array.from({ length: 21 }, (_, i) => message(22 - i, 'peer'));
  const loaded = [...incoming, outgoing], latest = page(incoming.slice(0, 20), 20);
  const receipts = await readLoadedDirectMessageReceipts(latest, loaded, 'sender', async offset => {
    assert.equal(offset, 20); return page([incoming[20], { ...outgoing, read_at: readAt }]);
  }, () => true);
  const merged = mergeDirectMessagePage(latest.items, loaded, receipts!);
  assert.equal(merged.find(item => item.message_id === outgoing.message_id)!.read_at, readAt);
  assert.ok(merged.filter(item => item.sender_ref === 'peer').every(item => item.read_at === null));
});

test('new messages shifting old pages do not skip loaded receipts or infer read state from a neighboring timestamp', async () => {
  const loaded = [message(3), message(2), message(1)];
  const latest = page(Array.from({ length: 20 }, (_, i) => message(30 - i, 'peer')), 20);
  const offsets: number[] = [];
  const receipts = await readLoadedDirectMessageReceipts(latest, loaded, 'sender', async offset => {
    offsets.push(offset);
    return offset === 20 ? page([message(10, 'peer'), { ...loaded[0], read_at: readAt }], 22)
      : page([loaded[1], { ...loaded[2], read_at: readAt }]);
  }, () => true);
  assert.deepEqual(offsets, [20, 22]);
  const merged = mergeDirectMessagePage(latest.items, loaded, receipts!);
  assert.equal(merged.find(item => item.message_id === '0002')!.read_at, null, 'a late-committing row can remain unread');
  assert.equal(merged.find(item => item.message_id === '0001')!.read_at, readAt);
  assert.equal(merged.length, 23, 'receipt lookups do not insert unrequested intermediate history');
});

test('peer or generation changes discard receipt refreshes after the in-flight page returns', async () => {
  let current = true, calls = 0;
  const receipts = await readLoadedDirectMessageReceipts(page([message(3, 'peer')], 1), [message(1)], 'sender', async () => {
    calls++; current = false; return page([message(1, 'sender', readAt)]);
  }, () => current);
  assert.equal(receipts, null); assert.equal(calls, 1);
});

test('permission failures and repeated paging cursors fail visibly instead of fabricating receipts', async () => {
  const failure = new Error('synthetic access revoked');
  await assert.rejects(readLoadedDirectMessageReceipts(page([], 20), [message(1)], 'sender', async () => { throw failure; }, () => true), error => error === failure);
  let calls = 0;
  await assert.rejects(readLoadedDirectMessageReceipts(page([], 20), [message(1)], 'sender', async () => { calls++; return page([], 20); }, () => true), /已讀狀態尚未確認/);
  assert.equal(calls, 1);
});

test('already-read and incoming-only loaded rows need no historical receipt requests', async () => {
  const loaded = [message(2, 'sender', readAt), message(1, 'peer')];
  const receipts = await readLoadedDirectMessageReceipts(page([], 20), loaded, 'sender', async () => { assert.fail('unexpected history request'); }, () => true);
  assert.equal(receipts!.size, 0);
  assert.deepEqual(mergeDirectMessagePage([], loaded, receipts!), loaded);
});

test('a confirmed send keeps receipt refresh dirty when the new outgoing sentinel masks an older read', async () => {
  const older = message(1), newer = message(2), shown = page([newer, older]);
  const activity = { last_message_id: newer.message_id, last_outgoing: { message_id: newer.message_id, read_at: null }, unread_count: 0, can_send: true };
  assert.equal(hasDirectMessageChanges(activity, shown), false, 'the latest-message sentinel alone cannot detect the older read');
  assert.equal(hasDirectMessageChanges(activity, shown, true), true, 'a confirmed send forces receipt reconciliation');
  const latest = page([newer, { ...older, read_at: readAt }]);
  const receipts = await readLoadedDirectMessageReceipts(latest, shown.items, 'sender', async () => { assert.fail('unexpected older page'); }, () => true);
  const refreshed = { ...latest, items: mergeDirectMessagePage(latest.items, shown.items, receipts!) };
  assert.equal(refreshed.items[1].read_at, readAt);
  assert.equal(refreshed.items[0].read_at, null);
  assert.equal(hasDirectMessageChanges(activity, refreshed), false, 'a successful refresh can clear the dirty marker');
});

test('an older receipt committed after the send refresh is reconciled without a newer sentinel change', () => {
  const older = message(1), newer = message(2), shown = page([newer, older]);
  const activity = { last_message_id: newer.message_id, last_outgoing: { message_id: newer.message_id, read_at: null }, unread_count: 0, can_send: true };
  assert.equal(hasDirectMessageChanges(activity, shown), false);
  assert.equal(directMessageReceiptRefreshDue(shown.items, 'sender', 1000, 8999), false);
  assert.equal(directMessageReceiptRefreshDue(shown.items, 'sender', 1000, 9000), true);
  assert.equal(hasDirectMessageChanges(activity, shown, directMessageReceiptRefreshDue(shown.items, 'sender', 1000, 9000)), true);
  assert.equal(directMessageReceiptRefreshDue([message(1, 'peer')], 'sender', 0, 9000), false);
  assert.equal(directMessageReceiptRefreshDue([message(1, 'sender', readAt)], 'sender', 0, 9000), false);
});


test('unread tombstones neither schedule receipt polling nor walk older history pages', async () => {
  const tombstone = {...message(1), body: '', retracted_at: readAt};
  assert.equal(directMessageReceiptRefreshDue([tombstone], 'sender', 0, 9000), false);
  const receipts = await readLoadedDirectMessageReceipts(page([], 20), [tombstone], 'sender', async () => {
    assert.fail('a withdrawn outgoing message has no pending read receipt');
  }, () => true);
  assert.equal(receipts!.size, 0);
  const live = message(2);
  assert.equal(directMessageReceiptRefreshDue([tombstone, live], 'sender', 0, 9000), true);
  const offsets: number[] = [];
  const mixed = await readLoadedDirectMessageReceipts(page([], 20), [tombstone, live], 'sender', async offset => {
    offsets.push(offset);return page([{...live, read_at: readAt}], 40);
  }, () => true);
  assert.deepEqual(offsets, [20], 'stop after the actual pending receipt, before the older tombstone page');
  assert.deepEqual([...mixed!], [[live.message_id, readAt]]);
});

test('page merges preserve microsecond chronology before UUID ties', () => {
  const older = {...message(2), created_at: '2026-10-04T00:00:00.123001Z'};
  const newer = {...message(1), created_at: '2026-10-04T00:00:00.123999Z'};
  assert.deepEqual(mergeDirectMessagePage([newer], [older]).map(item => item.message_id), ['0001', '0002']);
});

test('mixed timestamp precision orders a later microsecond after a loaded millisecond', () => {
  const older = {...message(2), created_at: '2026-10-04T00:00:00.123Z'};
  const newer = {...message(1), created_at: '2026-10-04T00:00:00.123001Z'};
  assert.deepEqual(mergeDirectMessagePage([newer], [older]).map(item => item.message_id), ['0001', '0002']);
});

test('mixed timestamp precision uses UUID ties only for the same instant', () => {
  const lower = {...message(1), created_at: '2026-10-04T00:00:00.123Z'};
  const higher = {...message(2), created_at: '2026-10-04T00:00:00.123000Z'};
  assert.deepEqual(mergeDirectMessagePage([higher], [lower]).map(item => item.message_id), ['0002', '0001']);
});

test('read boundaries compare exact instants across precision and UTC second rollover', () => {
  const boundary = {...message(2), created_at: '2026-10-04T00:00:59.999999Z'};
  const later = {...message(1), created_at: '2026-10-04T00:01:00.000Z'};
  assert.ok(compareDirectMessages(boundary, later) < 0);
  assert.ok(compareDirectMessages(later, boundary) > 0);
  const legacy = {...message(1), created_at: '2026-10-04T00:00:00.123Z'};
  assert.equal(compareDirectMessages(legacy, {...legacy, created_at: '2026-10-04T00:00:00.123000Z'}), 0);
  assert.ok(compareDirectMessages(legacy, {...legacy, created_at: '2026-10-04T00:00:00.123001Z'}) < 0);
  assert.ok(compareDirectMessages(legacy, {...legacy, message_id: '0002'}) < 0);
});

for (const count of [200, 1000]) test(`bounded receipts avoid scanning ${count} loaded messages for one older pending row`, async t => {
  const loaded = Array.from({length: count}, (_, i) => message(count - i, i === count - 1 ? 'sender' : 'peer', i === count - 1 ? null : readAt));
  const latest = page(loaded.slice(0, 20), 20);
  let legacyReads = 1;
  await readLoadedDirectMessageReceipts(latest, loaded, 'sender', async offset => {
    legacyReads++; return page(loaded.slice(offset, offset + 20), offset + 20 < count ? offset + 20 : null);
  }, () => true);
  assert.equal(legacyReads, count / 20, 'retain the old-server request-count baseline');
  let receiptReads = 0;
  const receipts = await readLoadedDirectMessageReceipts(latest, loaded, 'sender', async () => {
    assert.fail('advertised receipt lookup must not reread intermediate message bodies');
  }, () => true, async ids => {
    receiptReads++; assert.deepEqual(ids, [loaded[count - 1].message_id]);
    return {items: [{message_id: ids[0], read_at: readAt}]};
  });
  assert.equal(receiptReads, 1);
  assert.equal(receipts!.get(loaded[count - 1].message_id), readAt);
  assert.equal(loaded[count - 1].read_at, null, 'the original snapshot stays immutable');
  t.diagnostic(JSON.stringify({loaded: count, pending_outgoing: 1, legacy_history_gets: legacyReads, candidate_history_gets: 1, candidate_receipt_gets: receiptReads, scope: 'actual helper with synthetic transport; not latency'}));
});

test('bounded receipts batch at 50, preserve actual nulls and do not insert intermediate history', async () => {
  const loaded = Array.from({length: 121}, (_, i) => message(121 - i));
  const latest = page(loaded.slice(0, 20).map(item => ({...item, read_at: readAt})), 20), batches: string[][] = [];
  const receipts = await readLoadedDirectMessageReceipts(latest, loaded, 'sender', async () => { assert.fail('history lookup'); }, () => true, async ids => {
    batches.push(ids);
    return {items: [...ids].reverse().map(message_id => ({message_id, read_at: message_id === '0001' ? null : readAt}))};
  });
  assert.deepEqual(batches.map(ids => ids.length), [50, 50, 1]);
  assert.equal(new Set(batches.flat()).size, 101);
  const merged = mergeDirectMessagePage(latest.items, loaded, receipts!);
  assert.equal(merged.length, 121); assert.equal(merged.find(item => item.message_id === '0001')!.read_at, null);
  assert.ok(merged.filter(item => item.message_id !== '0001').every(item => item.read_at === readAt));
});

test('bounded receipts skip known tombstones, incoming, already-read and latest-page rows', async () => {
  const tombstone = {...message(1), body: '', retracted_at: readAt};
  const loaded = [message(4), message(3, 'peer'), message(2, 'sender', readAt), tombstone];
  const receipts = await readLoadedDirectMessageReceipts(page([{...loaded[0], read_at: readAt}], 20), loaded, 'sender', async () => { assert.fail('history lookup'); }, () => true, async () => { assert.fail('receipt lookup'); });
  assert.deepEqual([...receipts!], [['0004', readAt]]);
  assert.equal(directMessageReceiptRefreshDue([tombstone], 'sender', 0, 8000), false);
});

test('bounded receipts reconcile an older commit without a newest-message receipt change', async () => {
  const older = message(1), newer = message(2), shown = page([newer, older]);
  const latest = page([newer], 20); let committed = false;
  const read = () => readLoadedDirectMessageReceipts(latest, shown.items, 'sender', async () => { assert.fail('history lookup'); }, () => true,
    async ids => ({items: ids.map(message_id => ({message_id, read_at: committed ? readAt : null}))}));
  assert.equal((await read())!.get(older.message_id), null);
  committed = true;
  const receipts = await read();
  assert.equal(receipts!.get(older.message_id), readAt); assert.equal(receipts!.get(newer.message_id), null);
});

test('bounded receipts fence peer or generation changes before and after a batch', async () => {
  const loaded = Array.from({length: 51}, (_, i) => message(i + 1)); let current = false, calls = 0;
  const read = () => readLoadedDirectMessageReceipts(page([], 20), loaded, 'sender', async () => { assert.fail('history lookup'); }, () => current, async ids => {
    calls++; current = false; return {items: ids.map(message_id => ({message_id, read_at: readAt}))};
  });
  assert.equal(await read(), null); assert.equal(calls, 0);
  current = true;
  assert.equal(await read(), null); assert.equal(calls, 1, 'the second batch never starts after switching peers');
});

test('bounded receipts reject incomplete, duplicate, unrelated or malformed responses', async () => {
  const receipt = {message_id: '0001', read_at: readAt};
  const invalid: unknown[] = [null, {}, {items: []}, {items: [receipt, receipt]}, {items: [{...receipt, message_id: 'other'}]},
    {items: [{message_id: '0001'}]}, {items: [{...receipt, read_at: 'not a date'}]}, {items: [null]}];
  for (const response of invalid) await assert.rejects(readLoadedDirectMessageReceipts(page([], 20), [message(1)], 'sender', async () => { assert.fail('history fallback'); }, () => true,
    async () => response as {items: {message_id: string; read_at: string | null}[]}), /已讀狀態尚未確認/);
});

test('bounded receipts do not apply a partial batch or fall back after a lookup failure', async () => {
  const loaded = Array.from({length: 51}, (_, i) => message(i + 1)), before = structuredClone(loaded), failure = new Error('synthetic authorization revoked');
  let calls = 0;
  await assert.rejects(readLoadedDirectMessageReceipts(page([], 20), loaded, 'sender', async () => { assert.fail('history fallback'); }, () => true, async ids => {
    if (++calls === 2) throw failure;
    return {items: ids.map(message_id => ({message_id, read_at: readAt}))};
  }), error => error === failure);
  assert.equal(calls, 2); assert.deepEqual(loaded, before);
});

const source=readFileSync(new URL('../../apps/portal-web/src/modules/MemberMessages.tsx',import.meta.url),'utf8');
const stamp='2026-11-10T10:00:00.000Z',self='synthetic-self',peer='synthetic-peer',target='original',replyId='reply';
// Production closures and helpers, controlled transport and state. These are not
// React scheduling, browser, API authorization or database acceptance tests.
function directClosure(start:string,end:string,name:string,host:any){
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);assert.ok(from>=0&&to>from,name);
  return runInNewContext(transformSync(source.slice(from,to).replace(`const ${name}=`,`globalThis.${name}=`)+`;globalThis.result=${name};`,{loader:'tsx',target:'es2023',format:'esm'}).code,host);
}
function privateRetractionHost(){
 const original={message_id:target,sender_ref:self,recipient_ref:peer,created_at:stamp,read_at:stamp,retracted_at:null,body:'withdrawn private text',image:{content_type:'image/webp',byte_size:80}};
 const reply={message_id:replyId,sender_ref:peer,recipient_ref:self,created_at:'2026-11-10T10:01:00.000Z',read_at:stamp,retracted_at:null,body:'keep this reply',reply_to:{message_id:target,sender_ref:self,sender_name:'Synthetic',body:original.body}};
 const initial={participant:{user_id:peer,display_name:'Synthetic',avatar_url:null,is_online:false,last_seen_at:null},can_send:true,items:[reply,original],next_offset:20,unread_count:0,retraction_count:'0'};
 type Call={method:string;path:string;resolve:(value:any)=>void;reject:(error:Error)=>void};
 const calls:Call[]=[],reloads:Promise<unknown>[]=[],pages:Promise<unknown>[]=[],lists:Promise<unknown>[]=[],noop=()=>{};
 const state:any={peer,me:self,thread:structuredClone(initial),conversations:[{participant:initial.participant,last_message:original,can_send:true,unread_count:0}],threadMore:{loading:false,error:''},snapshot:{current:{}},alive:{current:true},currentPeer:{current:peer},
  convGeneration:{current:0},convInFlight:{current:null},listCheckedAt:{current:Date.now()},threadGeneration:{current:0},threadInFlight:{current:null},olderInFlight:{current:null},olderQueued:{current:null},quietInFlight:{current:new Map()},historyRevision:{current:0},
  receiptRefresh:{current:new Map()},receiptCheckedAt:{current:new Map([[peer,Date.now()]])},readIssues:{current:new Map()},idlePoll:{current:resetChatPoll()},polling:{current:false},retryAt:{current:0},failures:{current:0},moreState:{current:{loading:false,error:''}},
  retractTarget:{message_id:target},retractTrigger:{current:null},retracting:false,retractError:'',threadRefresh:{loading:false,error:''},convRefresh:{loading:false,error:''},threadStatus:'ready',threadError:'',liveError:'',
  scroll:{current:null},anchor:{current:null},stick:{current:true},document:{visibilityState:'visible'},navigator:{onLine:true},PAGE:20,Error,Date,URLSearchParams,ApiError,crypto:{randomUUID},useCallback:(fn:any)=>fn,
  refreshLoadedMessages,compareDirectMessages,directMessageReceiptRefreshDue,hasDirectMessageChanges,mergeDirectMessagePage,readLoadedDirectMessageReceipts,chatPollDue,idleChatPoll,resetChatPoll,
  newestMessages:(items:any[])=>[...items].sort((a,b)=>compareDirectMessages(b,a)),merge:(a:any[],b:any[],id:(v:any)=>string)=>[...a,...b.filter(v=>!a.some(x=>id(x)===id(v)))],fail:(e:Error)=>e.message,
  setReadError:noop,setHasNew:noop,onUnread:noop,announceInboxChange:noop,setConvNext:noop,setConvStatus:noop,setConvError:noop,setConvMore:noop,
  client:{sessionGeneration:1,get:(path:string)=>new Promise((resolve,reject)=>calls.push({method:'GET',path,resolve,reject})),post:(path:string)=>new Promise((resolve,reject)=>calls.push({method:'POST',path,resolve,reject}))},
 };
 for(const key of ['retractTarget','retracting','retractError','threadRefresh','convRefresh','threadStatus','threadError','liveError'])state['set'+key[0].toUpperCase()+key.slice(1)]=(value:any)=>state[key]=value;
 state.setThread=(update:any)=>{state.thread=typeof update==='function'?update(state.thread):update;state.snapshot.current.thread=state.thread;};
 state.setThreadMore=(update:any)=>{state.threadMore=typeof update==='function'?update(state.threadMore):update;state.moreState.current=state.threadMore;};
 state.setConversations=(update:any)=>state.conversations=typeof update==='function'?update(state.conversations):update;
 state.snapshot.current={thread:state.thread,threadStatus:'ready',reading:false,active:true,sending:false,readingThread:true};
 const get=(a:string,b:string,n:string)=>{directClosure(a,b,n,state);return state.result;};
 const load=get('  const loadThread=useCallback(', '  useEffect(()=>{\n    const update=()=>{if(currentPeer.current)', 'loadThread');
 state.loadThread=(...args:any[])=>{const p=load(...args);reloads.push(p);return p;};
 const list=get('  const loadConversations=useCallback(', '  useEffect(()=>{void loadConversations();}', 'loadConversations');
 state.loadConversations=(...args:any[])=>{const p=list(...args);lists.push(p);return p;};
 const retract=get('  async function retract(){','  useLayoutEffect(()=>{const node=scroll.current','retract');
 const earlier=get('  async function earlier(queued=false){','  useEffect(()=>{\n    const queued=olderQueued.current','earlier');
 state.earlier=(...args:any[])=>{const p=earlier(...args);pages.push(p);return p;};
 state.useEffect=(effect:()=>void)=>state.flushQueued=effect;
 get('  useEffect(()=>{\n    const queued=olderQueued.current;', '  async function markRead(', 'earlier');
 const poll=get('  async function pullLatest(){','  useEffect(()=>{\n    if(!active)return','pullLatest');
 const fresh=()=>({...structuredClone(initial),retraction_count:'1',items:[{...reply,reply_to:undefined,reply_to_message_id:target},{message_id:target,sender_ref:self,recipient_ref:peer,created_at:stamp,read_at:stamp,body:'',retracted_at:stamp}]});
 const histories=()=>calls.filter(c=>c.path.includes('/messages?'));
 const confirm=async()=>{const write=retract();calls.at(-1)!.resolve({message_id:target,retracted_at:stamp});await write;};
 const assertRedacted=()=>{assert.equal(state.thread.items.find((v:any)=>v.message_id===target)?.retracted_at,stamp);assert.ok(!JSON.stringify(state.thread.items).includes('withdrawn'),'neither body, image nor quoted original may reappear');assert.ok(!state.thread.items.find((v:any)=>v.message_id===target).image);};
 return {state,calls,reloads,pages,lists,flushQueued:()=>state.flushQueued(),load:state.loadThread,earlier,poll,retract,confirm,initial,fresh,histories,assertRedacted};
}
for(const oldLast of [false,true])test(`private retraction fences a prior quiet history; old last=${oldLast}`,async()=>{
 const h=privateRetractionHost(),old=h.load(peer,true);await h.confirm();
 const fresh=h.histories()[1];assert.ok(fresh,'confirmation immediately starts a replacement history read');h.assertRedacted();
 if(!oldLast){h.histories()[0].resolve(h.initial);await old;h.assertRedacted();assert.equal(h.state.threadRefresh.loading,true);}
 fresh.resolve(h.fresh());await h.reloads.at(-1);h.assertRedacted();assert.equal(h.state.threadRefresh.loading,false);
 if(oldLast){h.histories()[0].resolve(h.initial);await old;h.assertRedacted();assert.equal(h.state.thread.retraction_count,'1');}
});
test('private retraction keeps content hidden when refresh fails, and manual retry recovers without another POST',async()=>{
 const h=privateRetractionHost(),old=h.load(peer,true);await h.confirm();assert.equal(h.histories().length,2);
 h.histories()[1].reject(new Error('synthetic offline'));await h.reloads.at(-1);h.histories()[0].resolve(h.initial);await old;h.assertRedacted();assert.equal(h.state.threadRefresh.error,'synthetic offline');
 const retry=h.load(peer,true);h.histories()[2].resolve(h.fresh());await retry;h.assertRedacted();assert.equal(h.state.threadRefresh.error,'');assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});
test('private retraction supersedes an in-flight older page instead of waiting for it',async()=>{
 const h=privateRetractionHost(),old=h.earlier();await h.confirm();assert.equal(h.histories().length,2,'must bypass ordinary older-page refresh deferral');h.assertRedacted();
 h.histories()[1].resolve(h.fresh());await h.reloads.at(-1);assert.equal(h.state.threadMore.loading,true);h.flushQueued();
 assert.equal(h.histories().length,3,'original click resumes once without waiting for stale request');h.histories()[2].resolve({...h.fresh(),next_offset:null});await h.pages.at(-1);
 h.histories()[0].resolve({...h.initial,items:[{...h.initial.items[0],message_id:'stale-new-quote'}],next_offset:40});await old;h.assertRedacted();assert.equal(h.state.thread.next_offset,null);assert.ok(!h.state.thread.items.some((v:any)=>v.message_id==='stale-new-quote'));
});
test('private retraction releases stale quiet reads so queued older paging can continue',async()=>{
 const h=privateRetractionHost(),old=h.load(peer,true);await h.earlier();assert.ok(h.state.olderQueued.current);await h.confirm();assert.equal(h.histories().length,2);
 h.histories()[1].resolve(h.fresh());await h.reloads.at(-1);assert.ok(h.state.olderQueued.current);assert.equal(h.state.quietInFlight.current.size,0);h.flushQueued();
 assert.equal(h.state.olderQueued.current,null);assert.equal(h.histories().length,3);h.histories()[2].resolve({...h.fresh(),next_offset:null});await h.pages.at(-1);
 h.histories()[0].resolve(h.initial);await old;h.assertRedacted();
});
for(const error of [false,true])test(`private retraction fences pending activity completion; error=${error}`,async()=>{
 const h=privateRetractionHost(),old=h.poll();assert.ok(h.calls[0].path.endsWith('/activity'));await h.confirm();assert.equal(h.histories().length,1);
 const refresh=h.histories()[0];refresh.resolve(h.fresh());await h.reloads.at(-1);
 if(error)h.calls[0].reject(new ApiError({message:'stale forbidden',status:403}));else h.calls[0].resolve({last_message_id:replyId,unread_count:0,can_send:true,retraction_count:'0'});await old;
 h.assertRedacted();assert.equal(h.state.threadStatus,'ready');assert.equal(h.histories().length,1);
});
for(const boundary of ['peer','session','unmount'])test(`private retraction respects changed ${boundary}`,async()=>{
 const h=privateRetractionHost(),write=h.retract();
 if(boundary==='peer'){h.state.currentPeer.current='other';h.state.thread={...h.initial,participant:{...h.initial.participant,user_id:'other'},items:[]};h.state.snapshot.current.thread=h.state.thread;}
 if(boundary==='session')h.state.client.sessionGeneration++;if(boundary==='unmount')h.state.alive.current=false;
 const before=JSON.stringify(h.state.thread),list=JSON.stringify(h.state.conversations);h.calls[0].resolve({message_id:target,retracted_at:stamp});await write;
 assert.equal(h.histories().length,0);assert.equal(JSON.stringify(h.state.thread),before);if(boundary!=='peer'){assert.equal(JSON.stringify(h.state.conversations),list);assert.equal(h.calls.length,1);}
});
test('a rejected private retraction preserves the pending history and does not resend',async()=>{
 const h=privateRetractionHost(),old=h.load(peer,true),gen=h.state.threadGeneration.current,write=h.retract();h.calls[1].reject(new Error('synthetic rejection'));await write;
 assert.equal(h.state.threadGeneration.current,gen);assert.equal(h.calls.length,2);assert.equal(h.state.retractError,'synthetic rejection');assert.equal(h.state.thread.items[1].body,'withdrawn private text');
 h.histories()[0].resolve(h.initial);await old;assert.equal(h.state.threadRefresh.loading,false);
});
test('a pre-write history response cannot restore a confirmed private tombstone',async()=>{
 const h=privateRetractionHost(),old=h.load(peer,true);await h.confirm();h.histories()[0].resolve(h.initial);await old;
 assert.equal(h.state.thread.items.find((v:any)=>v.message_id===target).body,'','old GET must not restore withdrawn body');
 assert.equal(h.state.thread.items.find((v:any)=>v.message_id===target).retracted_at,stamp);
});
const settleRetraction=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
for(const lateError of [false,true])test(`private retraction fences a pending bounded receipt lookup; error=${lateError}`,async()=>{
 const h=privateRetractionHost();h.state.thread.items[1].read_at=null;
 const old=h.load(peer,true);h.histories()[0].resolve({...h.initial,receipt_lookup:'ids-v1',items:[h.initial.items[0]]});await settleRetraction();
 const receipt=h.calls.find(c=>c.path.includes('/receipts?'));assert.ok(receipt);await h.confirm();assert.equal(h.histories().length,2);
 h.histories()[1].resolve(h.fresh());await h.reloads.at(-1);
 if(lateError)receipt.reject(new ApiError({message:'stale forbidden',status:403}));else receipt.resolve({items:[{message_id:target,read_at:stamp}]});await old;
 h.assertRedacted();assert.equal(h.state.threadStatus,'ready');assert.equal(h.state.threadRefresh.error,'');
});
for(const lateError of [false,true])test(`private retraction retries the original older-page intent after refresh ${lateError?'failure':'success'}`,async()=>{
 const h=privateRetractionHost(),old=h.earlier();await h.confirm();assert.equal(h.histories().length,2);
 if(lateError)h.histories()[1].reject(new Error('replacement unavailable'));else h.histories()[1].resolve(h.fresh());await h.reloads.at(-1);
 h.flushQueued();assert.equal(h.histories().length,3);assert.match(h.histories()[2].path,/offset=20$/);
 h.histories()[2].resolve({...h.fresh(),next_offset:null});await h.pages.at(-1);h.histories()[0].resolve({...h.initial,next_offset:40});await old;
 h.assertRedacted();assert.equal(h.state.thread.next_offset,null);assert.equal(h.state.threadMore.loading,false);assert.equal(h.state.olderQueued.current,null);
});
