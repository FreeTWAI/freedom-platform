import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const appSource = readFileSync(new URL('../../apps/portal-web/src/App.tsx', import.meta.url), 'utf8');
const start = appSource.indexOf('  const [canManageGuild,setCanManageGuild]=useState(false)');
const end = appSource.indexOf('  const [tab, setTab]', start);
assert.ok(start >= 0 && end > start, 'Workspace effects slice not found');

const rawSlice = appSource.slice(start, end);
const firstEffect = rawSlice.indexOf('  useEffect(()=>{');
const sliceCode = stripTypeScriptTypes(rawSlice.slice(firstEffect));

function createWorkspaceEffectsHarness() {
  const docListeners = new Map<string, Set<() => void>>();
  const winListeners = new Map<string, Set<() => void>>();
  const add = (map: Map<string, Set<() => void>>) => (name: string, fn: () => void) => {
    let set = map.get(name);
    if (!set) { set = new Set(); map.set(name, set); }
    set.add(fn);
  };
  const remove = (map: Map<string, Set<() => void>>) => (name: string, fn: () => void) => {
    map.get(name)?.delete(fn);
  };
  const dispatch = (map: Map<string, Set<() => void>>, name: string) => {
    for (const fn of [...(map.get(name) ?? [])]) fn();
  };

  let now = 1_000_000;
  let adminEntryValue: unknown = null;
  const adminEntryCalls: unknown[] = [];
  const requests: string[] = [];
  const cleanups: (() => void)[] = [];
  const session = { user: { user_id: 'member-1' }, csrf_token: 'csrf-1' };

  const client = {
    sessionGeneration: 1,
    get(path: string) {
      requests.push(path);
      if (path === '/session') return Promise.resolve({ ...session, admin_entry_visible: true });
      if (path === '/guild-workspace') return Promise.resolve({ managed_guilds: [], managed_books: [], can_discuss: true });
      return Promise.resolve({});
    },
  };

  const document = {
    visibilityState: 'visible',
    addEventListener: add(docListeners),
    removeEventListener: remove(docListeners),
  };
  const window = {
    addEventListener: add(winListeners),
    removeEventListener: remove(winListeners),
    setInterval: () => 1,
    clearInterval: () => {},
  };

  runInNewContext(sliceCode, {
    client,
    session,
    document,
    window,
    Date: { now: () => now },
    setCanManageGuild: () => {},
    setHeaderMember: () => {},
    setAdminEntrySession: (value: unknown) => {
      adminEntryValue = value;
      adminEntryCalls.push(value);
    },
    onSessionExpired: () => {},
    useEffect: (run: () => (() => void) | void) => {
      const cleanup = run();
      if (cleanup) cleanups.push(cleanup);
    },
  });

  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const count = (path: string) => requests.filter(p => p === path).length;
  const clearLogs = () => { requests.length = 0; adminEntryCalls.length = 0; };

  return {
    document,
    advance(ms: number) { now += ms; },
    fireDoc(name: string) { dispatch(docListeners, name); },
    fireWin(name: string) { dispatch(winListeners, name); },
    flush,
    count,
    clearLogs,
    adminEntryCalls,
    get adminEntryValue() { return adminEntryValue; },
    cleanup() { for (const fn of cleanups) fn(); },
  };
}

test('PERF-14: hiding a visible tab does not reset adminEntrySession or fire requests', async () => {
  const h = createWorkspaceEffectsHarness();
  await h.flush();
  assert.ok(h.adminEntryValue !== null);
  h.clearLogs();

  h.document.visibilityState = 'hidden';
  h.fireDoc('visibilitychange');
  await h.flush();

  assert.equal(h.adminEntryCalls.length, 0, 'hidden tab must not trigger setAdminEntrySession(null)');
  assert.equal(h.count('/session'), 0);
  assert.equal(h.count('/guild-workspace'), 0);
  h.cleanup();
});

test('PERF-14: returning to tab (visibilitychange + focus within 50ms) triggers at most 1 /session and 1 /guild-workspace request', async () => {
  const h = createWorkspaceEffectsHarness();
  await h.flush();
  assert.equal(h.count('/session'), 1);
  assert.equal(h.count('/guild-workspace'), 1);

  // Quick hide & return right after boot (within 10s cooldown for /guild-workspace).
  h.clearLogs();
  h.document.visibilityState = 'hidden';
  h.fireDoc('visibilitychange');
  h.advance(20);
  h.document.visibilityState = 'visible';
  h.fireDoc('visibilitychange');
  h.advance(30);
  h.fireWin('focus');
  await h.flush();

  assert.ok(h.count('/session') <= 1, `expected <= 1 /session on quick return, got ${h.count('/session')}`);
  assert.ok(h.count('/guild-workspace') <= 1, `expected <= 1 /guild-workspace on quick return, got ${h.count('/guild-workspace')}`);

  // After >= 10s away, tab return fires at most 1 /session and 1 /guild-workspace (coalesced).
  h.advance(12_000);
  h.document.visibilityState = 'hidden';
  h.fireDoc('visibilitychange');
  h.clearLogs();
  h.advance(1_000);
  h.document.visibilityState = 'visible';
  h.fireDoc('visibilitychange');
  h.advance(25);
  h.fireWin('focus');
  await h.flush();

  assert.equal(h.count('/session'), 1, 'visibilitychange + focus within 50ms must coalesce /session to 1');
  assert.equal(h.count('/guild-workspace'), 1, 'visibilitychange + focus within 50ms must fire /guild-workspace at most once');

  // Repeat focus + visibilitychange within 50ms after >= 10s without intermediate hide also coalesces.
  h.advance(12_000);
  h.clearLogs();
  h.fireWin('focus');
  h.advance(25);
  h.fireDoc('visibilitychange');
  await h.flush();

  assert.equal(h.count('/session'), 1, 'focus + visibilitychange within 50ms must coalesce /session to 1');
  assert.equal(h.count('/guild-workspace'), 1, 'focus + visibilitychange within 50ms must fire /guild-workspace once');
  h.cleanup();
});

test('PERF-14: freedom-profile-updated still refreshes /session and /guild-workspace immediately', async () => {
  const h = createWorkspaceEffectsHarness();
  await h.flush();
  h.clearLogs();

  h.advance(50);
  h.fireWin('freedom-profile-updated');
  await h.flush();

  assert.equal(h.count('/session'), 1);
  assert.equal(h.count('/guild-workspace'), 1);
  h.cleanup();
});
