/** Per-mounted-search read coordination. No stored results, polling or write retries. */
export type SearchSnapshot<Page> = Readonly<{
  query: string;
  draft: string;
  composing: boolean;
  status: 'idle' | 'waiting' | 'loading' | 'ready' | 'error';
  page: Page | null;
  error: unknown;
}>;

type HistoryMode = 'replace' | 'push';
type Schedule = (callback: () => void, milliseconds: number) => () => void;
const schedule: Schedule = (callback, milliseconds) => {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
};

/** Preserve unrelated supported parameters; changing a filter always resets paging. */
export function changeSearchQuery(query: string, name: string, value: string): string {
  const next = new URLSearchParams(query);
  if (value) next.set(name, value); else next.delete(name);
  if (name !== 'cursor') next.delete('cursor');
  return next.toString();
}

/**
 * URL state is committed text, not an unfinished IME composition. Only text
 * changes debounce; explicit controls, paging and retries start immediately.
 * Results are always re-read, never cached or retained across revalidation.
 */
export function createCommunitySearch<Page>(options: {
  query: string;
  generation: () => number;
  read: (query: string, signal: AbortSignal) => Promise<Page>;
  writeQuery: (query: string, mode: HistoryMode) => void;
  schedule?: Schedule;
}) {
  const owner = options.generation();
  const initialQuery = new URLSearchParams(options.query).toString();
  const empty: SearchSnapshot<Page> = {
    query: '', draft: '', composing: false, status: 'idle', page: null, error: null,
  };
  let state: SearchSnapshot<Page> = {
    ...empty, query: initialQuery, draft: new URLSearchParams(initialQuery).get('q') ?? '',
  };
  const listeners = new Set<() => void>();
  let enabled = false;
  let pending: {query: string; controller: AbortController} | null = null;
  let cancelTimer: (() => void) | null = null;
  const authorized = () => options.generation() === owner;
  const usable = () => enabled && authorized();
  const publish = (next: SearchSnapshot<Page>) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    const previous = pending;
    pending = null; // Fence late replies before abort handlers can run.
    cancelTimer?.(); cancelTimer = null;
    previous?.controller.abort();
  };
  function run(delay = 0, force = false) {
    if (!usable() || state.composing) return;
    if (!force && pending?.query === state.query) {
      // Enter flushes a scheduled text search, but never duplicates an HTTP read.
      if (delay === 0 && cancelTimer) {
        cancelTimer(); cancelTimer = null;
        execute(pending);
      }
      return;
    }
    cancel();
    const operation = {query: state.query, controller: new AbortController()};
    pending = operation;
    publish({...state, status: delay > 0 ? 'waiting' : 'loading', page: null, error: null});
    if (delay > 0) cancelTimer = (options.schedule ?? schedule)(() => {
      cancelTimer = null;
      execute(operation);
    }, delay);
    else execute(operation);
  }
  function execute(operation: NonNullable<typeof pending>) {
    const current = () => usable() && pending === operation && !operation.controller.signal.aborted;
    if (!current()) return;
    if (state.status !== 'loading') publish({...state, status: 'loading'});
    void Promise.resolve().then(async () => {
      // Same-tick query changes or StrictMode cleanup can cancel before HTTP starts.
      if (!current()) return;
      try {
        const page = await options.read(operation.query, operation.controller.signal);
        if (!current()) return;
        pending = null;
        publish({...state, status: 'ready', page, error: null});
      } catch (error: unknown) {
        if (!current()) return;
        pending = null;
        publish({...state, status: 'error', page: null, error});
      }
    });
  }
  function commit(query: string, mode: HistoryMode, delay: number, restart = false) {
    if (!usable()) return;
    const changed = state.query !== query;
    if (!changed && !restart) return;
    cancel();
    publish({...state, query, draft: new URLSearchParams(query).get('q') ?? '',
      composing: false, status: 'idle', page: null, error: null});
    if (changed) options.writeQuery(query, mode);
    run(delay);
  }
  return {
    getSnapshot: (): SearchSnapshot<Page> => authorized() ? state : empty,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {listeners.delete(listener);};
    },
    start() {
      if (enabled || !authorized()) return;
      enabled = true;
      publish({...state, composing: false, draft: new URLSearchParams(state.query).get('q') ?? ''});
      run();
    },
    stop() {
      enabled = false;
      cancel();
      publish({...state, status: 'idle', page: null, error: null});
    },
    edit(value: string) {
      if (!usable()) return;
      if (state.composing) {
        if (state.draft !== value) publish({...state, draft: value});
        return;
      }
      // A trailing input/change after compositionend must not dispatch a second search.
      if (state.draft === value) return;
      commit(changeSearchQuery(state.query, 'q', value), 'replace', 180);
    },
    beginComposition() {
      if (!usable() || state.composing) return;
      cancel();
      publish({...state, composing: true, status: 'idle', page: null, error: null});
    },
    endComposition(value: string) {
      if (!usable()) return;
      const wasComposing = state.composing;
      const next = (new URLSearchParams(state.query).get('q') ?? '') === value
        ? state.query : changeSearchQuery(state.query, 'q', value);
      commit(next, 'replace', 180, wasComposing);
    },
    submit() { run(); },
    toggle(name: 'kinds' | 'topics', value: string) {
      if (!usable() || state.composing) return;
      const selected = (new URLSearchParams(state.query).get(name) ?? '').split(',').filter(Boolean);
      const values = selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value];
      commit(changeSearchQuery(state.query, name, values.join(',')), 'replace', 0);
    },
    next(cursor: string) {
      if (!usable() || state.composing || state.status !== 'ready' || !cursor) return;
      commit(changeSearchQuery(state.query, 'cursor', cursor), 'push', 0);
    },
    first() {
      if (!usable() || state.composing) return;
      commit(changeSearchQuery(state.query, 'cursor', ''), 'push', 0);
    },
    clear() {
      if (!usable() || state.composing) return;
      commit('', 'replace', 0);
    },
    restore(query: string) {
      if (!usable()) return;
      const next = new URLSearchParams(query).toString();
      // popstate and hashchange often describe the same navigation.
      if (next === state.query && !state.composing) return;
      cancel();
      publish({...state, query: next, draft: new URLSearchParams(next).get('q') ?? '',
        composing: false, status: 'idle', page: null, error: null});
      run();
    },
    refresh(force = false) {
      // Returning focus must not submit partial IME input or shorten text debounce.
      if (state.composing || state.status === 'waiting') return;
      run(0, force);
    },
  };
}

export type CommunityListTab = 'bookmarks' | 'follows' | 'updates';
export type CommunityListHistory = {
  current: () => boolean;
  read: (state: unknown) => CommunityListTab;
  write: (state: unknown, tab: CommunityListTab) => Record<string, unknown> | undefined;
};
const listHistoryKey = 'freedomCommunityList';
const listSessions = new WeakMap<object, {authKey: string; generation: number; history: CommunityListHistory}>();
const listTab = (value: unknown): value is CommunityListTab => value === 'bookmarks' || value === 'follows' || value === 'updates';
function historyRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
const ownValue = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;

/**
 * Navigation only, never a private-data cache or an authorization credential.
 * History carries just a closed tab enum and a random marker issued for that tab.
 * The issuing client/authentication lifetime stays in memory. Reload, a different
 * client or a new login cannot revive old markers, even for the same user ID.
 */
export function communityListHistoryForSession(client: {readonly sessionGeneration: number}, authKey: string): CommunityListHistory {
  const previous = listSessions.get(client);
  if (previous?.authKey === authKey && previous.generation === client.sessionGeneration) return previous.history;
  const generation = client.sessionGeneration;
  // At most three markers per current client lifetime, not a growing history cache.
  const issued = new Map<CommunityListTab, string>();
  const current = () => Boolean(authKey) && client.sessionGeneration === generation && listSessions.get(client)?.history === history;
  const history: CommunityListHistory = {
    current,
    read(state) {
      if (!current() || !historyRecord(state)) return 'bookmarks';
      const saved = ownValue(state, listHistoryKey);
      if (!historyRecord(saved) || Reflect.ownKeys(saved).length !== 3) return 'bookmarks';
      const version = ownValue(saved, 'version'), tab = ownValue(saved, 'tab'), epoch = ownValue(saved, 'epoch');
      if (version !== 1 || !listTab(tab) || typeof epoch !== 'string' || issued.get(tab) !== epoch) return 'bookmarks';
      return tab;
    },
    write(state, tab) {
      if (!current() || !listTab(tab)) return undefined;
      let epoch = issued.get(tab);
      if (!epoch) { epoch = crypto.randomUUID(); issued.set(tab, epoch); }
      // history.state is structured-cloned by the browser. Preserve other owners'
      // ordinary data fields, without invoking accessors on synthetic input.
      const next: Record<string, unknown> = {};
      if (historyRecord(state)) for (const key of Object.keys(state)) {
        const field = Object.getOwnPropertyDescriptor(state, key);
        if (field && 'value' in field) Object.defineProperty(next, key, {...field, configurable: true, writable: true});
      }
      next[listHistoryKey] = {version: 1, tab, epoch};
      return next;
    },
  };
  listSessions.set(client, {authKey, generation, history});
  return history;
}
