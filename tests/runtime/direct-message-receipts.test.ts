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
