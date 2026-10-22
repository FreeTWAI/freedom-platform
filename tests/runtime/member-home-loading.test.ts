import assert from 'node:assert/strict';
import test from 'node:test';
import {PortalClient} from '../../apps/portal-web/src/api.js';
import {
  createHomeReadCycle, observeHomeReturns, loadHomeNextSteps, resolveHomeJournalUrl,
  type HomeReadClient, type HomeTaskAction,
} from '../../apps/portal-web/src/modules/member-home-loading.js';

test('journal entry accepts only the configured public HTTPS home without private parameters', () => {
  assert.equal(resolveHomeJournalUrl(), 'https://freetwai.evitina.tw/');
  assert.equal(resolveHomeJournalUrl('https://freetwai.evitina.tw'), 'https://freetwai.evitina.tw/');
  assert.equal(resolveHomeJournalUrl(' https://FreeTWAI.evitina.tw/ '), 'https://freetwai.evitina.tw/');
  for (const value of [null, '', 1, 'javascript:alert(1)', 'http://freetwai.evitina.tw/',
    'https://127.0.0.1/', 'https://freetwai.evitina.tw.evil.example/',
    'https://owner:secret@freetwai.evitina.tw/', 'https://freetwai.evitina.tw:8443/',
    'https://freetwai.evitina.tw/api/v1/private/drafts', 'https://freetwai.evitina.tw/?token=example',
    'https://freetwai.evitina.tw/#draft', 'not-a-url']) {
    assert.equal(resolveHomeJournalUrl(value), null, String(value));
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const paths = ['/guilds/directory', '/me/skill-books', '/task-board/preview', '/dashboard'];
type Book = {book_id: string; title: string};
function reads() {
  const pending = new Map(paths.map(path => [path, deferred<unknown>()]));
  const calls: {path: string; signal: AbortSignal; background?: boolean}[] = [];
  let generation = 1;
  const client: HomeReadClient = {
    get sessionGeneration() { return generation; },
    get<T>(path: string, options: {signal: AbortSignal; background?: boolean}) {
      calls.push({path, ...options});
      const operation = pending.get(path);
      assert.ok(operation, `unexpected read: ${path}`);
      return operation.promise as Promise<T>;
    },
  };
  const controller = new AbortController();
  const books: (Book | null)[] = [];
  const tasks: (HomeTaskAction | null)[] = [];
  const bookReady = deferred<void>(), taskReady = deferred<void>();
  const start = (preserveOnFailure = false) => loadHomeNextSteps<Book>({
    client, guildKey: 'guild-one', signal: controller.signal,
    preserveOnFailure,
    onBook: value => { books.push(value); bookReady.resolve(); },
    onTask: value => { tasks.push(value); taskReady.resolve(); },
  });
  const finish = () => { for (const operation of pending.values()) operation.resolve({}); };
  const resolve = (path: string, value: unknown) => pending.get(path)!.resolve(value);
  const reject = (path: string) => pending.get(path)!.reject(new Error('synthetic read failure'));
  return {client, controller, calls, books, tasks, bookReady, taskReady, start, finish, resolve, reject,
    changeSession() { generation++; }};
}
const book: Book = {book_id: 'granted', title: 'Synthetic granted book'};
function allowBook(run: ReturnType<typeof reads>) {
  run.resolve(paths[0], {items: [{guild_key: 'guild-one', skill_books: [book]}]});
  run.resolve(paths[1], {items: [{book_id: book.book_id}]});
}

// Explicit microtask barrier: no sleeps, network, browser, DB or timeout changes.
async function microtasks() { for (let index = 0; index < 6; index++) await Promise.resolve(); }

test('read cycle admits one request and rejects repeated manual/automatic starts', () => {
  const cycle = createHomeReadCycle(() => 1, () => 0);
  const first = cycle.begin('initial');
  assert.ok(first);
  assert.equal(cycle.begin('manual'), null);
  assert.equal(cycle.begin('automatic'), null);
  first.complete(false);
  assert.ok(cycle.begin('manual'));
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
});

test('freshness is measured from successful completion, not request start', () => {
  let time = 0;
  const cycle = createHomeReadCycle(() => 1, () => time);
  const first = cycle.begin('initial')!;
  time = 70_000;
  first.complete(true);
  assert.equal(cycle.begin('automatic'), null);
  time = 129_999;
  assert.equal(cycle.begin('automatic'), null);
  time = 130_000;
  assert.ok(cycle.begin('automatic'));
});

test('failure uses a short return-event cooldown, not a fake successful refresh', () => {
  let time = 0;
  const cycle = createHomeReadCycle(() => 1, () => time);
  cycle.begin('initial')!.complete(false);
  time = 14_999;
  assert.equal(cycle.begin('automatic'), null);
  time = 15_000;
  assert.ok(cycle.begin('automatic'));
});

test('a user-requested retry does not wait for automatic cooldown', () => {
  const cycle = createHomeReadCycle(() => 1, () => 0);
  cycle.begin('initial')!.complete(false);
  assert.ok(cycle.begin('manual'));
});

test('cleanup aborts reads and permits React setup/cleanup/setup', () => {
  const cycle = createHomeReadCycle(() => 1, () => 0);
  const first = cycle.begin('initial')!;
  cycle.cancel();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  const second = cycle.begin('initial');
  assert.ok(second);
  assert.equal(second.signal.aborted, false);
  cycle.cancel();
  cycle.cancel();
});

test('a late completion cannot unlock or mark a new request as fresh', () => {
  const cycle = createHomeReadCycle(() => 1, () => 70_000);
  const old = cycle.begin('initial')!;
  cycle.cancel();
  const latest = cycle.begin('initial')!;
  old.complete(true);
  assert.equal(cycle.begin('manual'), null);
  latest.complete(false);
  assert.ok(cycle.begin('manual'));
});

test('session change rejects late data and new work on the old cycle', () => {
  let generation = 1;
  const cycle = createHomeReadCycle(() => generation, () => 0);
  const run = cycle.begin('initial')!;
  generation = 2;
  assert.equal(run.isCurrent(), false);
  run.complete(true);
  assert.equal(cycle.begin('manual'), null);
  cycle.cancel();
  assert.equal(run.signal.aborted, true);
});

test('repeated completion cannot extend freshness indefinitely', () => {
  let time = 0;
  const cycle = createHomeReadCycle(() => 1, () => time);
  const run = cycle.begin('initial')!;
  run.complete(true);
  time = 50_000;
  run.complete(true);
  time = 60_000;
  assert.ok(cycle.begin('automatic'));
});

test('foreground observer ignores hidden/offline events and removes every listener', () => {
  const page = new EventTarget(), window = new EventTarget();
  let visible = false, online = true, count = 0;
  const stop = observeHomeReturns({page, window, visible: () => visible, online: () => online}, () => { count++; });
  page.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
  assert.equal(count, 0);
  visible = true; online = false;
  window.dispatchEvent(new Event('online'));
  assert.equal(count, 0);
  online = true;
  for (const event of ['focus', 'online', 'pageshow']) window.dispatchEvent(new Event(event));
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(count, 4);
  stop();
  for (const event of ['focus', 'online', 'pageshow']) window.dispatchEvent(new Event(event));
  page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(count, 4);
});

test('burst of visible/focus/online events starts one actual read', () => {
  const page = new EventTarget(), window = new EventTarget();
  const cycle = createHomeReadCycle(() => 1, () => 100_000);
  let count = 0;
  const stop = observeHomeReturns({page, window, visible: () => true, online: () => true}, () => {
    if (cycle.begin('automatic')) count++;
  });
  page.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  assert.equal(count, 1);
  stop(); cycle.cancel();
});

test('all suggestion reads start together with cancellation and normal client diagnostics', async () => {
  const run = reads(), done = run.start();
  assert.deepEqual(run.calls.map(call => call.path), paths);
  assert.ok(run.calls.every(call => !call.background && call.signal === run.controller.signal));
  run.finish(); await done;
});

test('a granted book renders before a stalled dashboard or task board settles', async () => {
  const run = reads(), done = run.start();
  allowBook(run);
  await run.bookReady.promise;
  assert.deepEqual(run.books, [book]);
  assert.deepEqual(run.tasks, []);
  run.finish(); await done;
});

test('unfinished work renders before stalled books AND task board settle', async () => {
  const run = reads(), done = run.start();
  run.resolve(paths[3], {now: [{id: 'unfinished'}]});
  await run.taskReady.promise;
  assert.deepEqual(run.tasks, ['resume']);
  assert.deepEqual(run.books, []);
  run.finish(); await done;
  assert.deepEqual(run.tasks, ['resume']);
});

test('early task-board response never outranks unfinished work still being read', async () => {
  const run = reads(), done = run.start();
  run.resolve(paths[2], {items: [{id: 'open'}]});
  await microtasks();
  assert.deepEqual(run.tasks, []);
  run.resolve(paths[3], {now: [{id: 'unfinished'}]});
  await run.taskReady.promise;
  assert.deepEqual(run.tasks, ['resume']);
  run.finish(); await done;
});

for (const [items, expected] of [[[{id: 'open'}], 'tasks'], [[], 'showcase']] as const) {
  test(`no unfinished work with a confirmed board selects ${expected}`, async () => {
    const run = reads(), done = run.start();
    run.resolve(paths[3], {now: []});
    await microtasks();
    assert.deepEqual(run.tasks, []);
    run.resolve(paths[2], {items});
    await run.taskReady.promise;
    assert.deepEqual(run.tasks, [expected]);
    run.finish(); await done;
  });
}

test('failed dashboard preserves the existing confirmed-board fallback', async () => {
  const run = reads(), done = run.start();
  run.reject(paths[3]);
  run.resolve(paths[2], {items: [{id: 'open'}]});
  await run.taskReady.promise;
  assert.deepEqual(run.tasks, ['tasks']);
  run.finish(); await done;
});

test('failed board is unknown, not a fabricated empty-board suggestion', async () => {
  const run = reads(), done = run.start();
  run.resolve(paths[3], {now: []});
  run.reject(paths[2]);
  await run.taskReady.promise;
  assert.deepEqual(run.tasks, [null]);
  run.finish(); await done;
});

test('book selection needs both the same primary guild AND an actual grant', async () => {
  const run = reads(), done = run.start();
  run.resolve(paths[0], {items: [null, {guild_key: 'other', skill_books: [{book_id: 'foreign'}]},
    {guild_key: 'guild-one', skill_books: [null, {book_id: 'locked'}, book]}]});
  run.resolve(paths[1], {items: [null, {}, {id: 'foreign'}, {id: book.book_id}]});
  await run.bookReady.promise;
  assert.deepEqual(run.books, [book]);
  run.finish(); await done;
});

test('failed grants do not reveal a book, and do not block work', async () => {
  const run = reads(), done = run.start();
  run.resolve(paths[0], {items: [{guild_key: 'guild-one', skill_books: [book]}]});
  run.reject(paths[1]);
  run.resolve(paths[3], {now: [{id: 'unfinished'}]});
  await Promise.all([run.bookReady.promise, run.taskReady.promise]);
  assert.deepEqual(run.books, [null]);
  assert.deepEqual(run.tasks, ['resume']);
  run.finish(); await done;
});

test('malformed successful payloads are treated as unknown, without throwing', async () => {
  const run = reads(), done = run.start();
  run.resolve(paths[0], {items: 'not-a-list'});
  run.resolve(paths[1], null);
  run.resolve(paths[2], {});
  run.resolve(paths[3], {now: 'not-a-list'});
  await done;
  assert.deepEqual(run.books, [null]);
  assert.deepEqual(run.tasks, [null]);
});

test('pre-aborted suggestion cycle performs no requests', async () => {
  const run = reads();
  run.controller.abort();
  await run.start();
  assert.deepEqual(run.calls, []);
  assert.deepEqual(run.books, []);
  assert.deepEqual(run.tasks, []);
});

test('cleanup suppresses every late reply even if the transport ignores abort', async () => {
  const run = reads(), done = run.start();
  run.controller.abort();
  assert.ok(run.calls.every(call => call.signal.aborted));
  allowBook(run);
  run.resolve(paths[3], {now: [{id: 'unfinished'}]});
  run.finish(); await done;
  assert.deepEqual(run.books, []);
  assert.deepEqual(run.tasks, []);
});

test('changed session suppresses all late private projections', async () => {
  const run = reads(), done = run.start();
  run.changeSession();
  allowBook(run);
  run.resolve(paths[3], {now: [{id: 'unfinished'}]});
  run.finish(); await done;
  assert.deepEqual(run.books, []);
  assert.deepEqual(run.tasks, []);
});

test('a fresh same-guild cycle re-reads work instead of retaining a completed claim', async () => {
  const first = reads(), firstDone = first.start();
  first.resolve(paths[3], {now: [{id: 'unfinished'}]});
  first.finish(); await firstDone;
  assert.deepEqual(first.tasks, ['resume']);
  const next = reads(), nextDone = next.start();
  next.resolve(paths[3], {now: []});
  next.resolve(paths[2], {items: []});
  next.finish(); await nextDone;
  assert.deepEqual(next.tasks, ['showcase']);
});

for (const path of paths.slice(0, 2)) {
  test(`automatic ${path} failure preserves the previous book without blocking work`, async () => {
    const run = reads(), done = run.start(true);
    run.reject(path);
    allowBook(run);
    run.resolve(paths[3], {now: [{id: 'unfinished'}]});
    run.finish(); await done;
    assert.deepEqual(run.books, []);
    assert.deepEqual(run.tasks, ['resume']);
  });
}

for (const path of paths.slice(2)) {
  test(`automatic ${path} failure preserves the previous task instead of guessing`, async () => {
    const run = reads(), done = run.start(true);
    run.reject(path);
    allowBook(run);
    run.resolve(paths[2], {items: []});
    run.resolve(paths[3], {now: []});
    run.finish(); await done;
    assert.deepEqual(run.books, [book]);
    assert.deepEqual(run.tasks, []);
  });
}

test('successful automatic reads still remove a revoked grant and completed work', async () => {
  const run = reads(), done = run.start(true);
  run.resolve(paths[0], {items: [{guild_key: 'guild-one', skill_books: [book]}]});
  run.resolve(paths[1], {items: []});
  run.resolve(paths[2], {items: []});
  run.resolve(paths[3], {now: []});
  await done;
  assert.deepEqual(run.books, [null]);
  assert.deepEqual(run.tasks, ['showcase']);
});

test('automatic suggestion failures still reach PortalClient error reporting', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', async () => Response.json({}, {status: 503}));
  const client = new PortalClient();
  const reported = t.mock.method(client, 'reportError', () => {});
  await loadHomeNextSteps<Book>({client, guildKey: 'guild-one', signal: new AbortController().signal,
    preserveOnFailure: true, onBook: () => assert.fail('unknown book must not replace the previous value'),
    onTask: () => assert.fail('unknown task must not replace the previous value')});
  assert.equal(fetcher.mock.callCount(), 4);
  assert.deepEqual(reported.mock.calls.map(call => call.arguments),
    paths.map(path => [`GET ${path}`, 'http_503', 503]));
});
