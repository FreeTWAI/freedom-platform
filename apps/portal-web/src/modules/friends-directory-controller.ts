/** Read-only friend-list coordination. No shared cache, storage or write retries. */
export type FriendsScope = 'accepted' | 'incoming' | 'outgoing' | 'blocked';
export type FriendsPage<T> = {items: T[]; total: number; next_offset: number | null};
export type FriendsSnapshot<T> = Readonly<{
  scope: FriendsScope;
  draft: string;
  search: string;
  offset: number;
  composing: boolean;
  status: 'idle' | 'waiting' | 'loading' | 'ready' | 'error' | 'blocked';
  page: FriendsPage<T> | null;
  error: unknown;
  focusRevision: number;
}>;
export interface FriendsDirectoryOptions<T> {
  generation: () => number;
  read: (query: URLSearchParams, signal: AbortSignal) => Promise<FriendsPage<T>>;
  initialScope?: 'accepted' | 'incoming';
  clock?: {schedule: (callback: () => void, delay: number) => unknown; cancel: (handle: unknown) => void};
}
const PAGE_SIZE = 20;

/** Validate pagination metadata without changing the server's member projection. */
export function requireFriendsPage<T>(value: unknown, offset: number): FriendsPage<T> {
  if (!value || typeof value !== 'object') throw new Error('好友名單回應格式不完整，請重新讀取。');
  const page = value as Partial<FriendsPage<T>>;
  if (!Array.isArray(page.items) || page.items.length > PAGE_SIZE
    || !Number.isSafeInteger(page.total) || page.total! < page.items.length || page.total! < 0
    || (page.items.length > 0 && offset + page.items.length > page.total!)
    || !(page.next_offset === null || (Number.isSafeInteger(page.next_offset)
      && page.next_offset! > offset && page.next_offset! < page.total!))) {
    throw new Error('好友名單回應格式不完整，請重新讀取。');
  }
  return page as FriendsPage<T>;
}

export function createFriendsDirectory<T>(options: FriendsDirectoryOptions<T>) {
  const owner = options.generation();
  const clock = options.clock ?? {
    schedule: (callback: () => void, delay: number) => setTimeout(callback, delay),
    cancel: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const empty: FriendsSnapshot<T> = {scope: options.initialScope ?? 'accepted', draft: '', search: '',
    offset: 0, composing: false, status: 'idle', page: null, error: null, focusRevision: 0};
  let state = empty;
  let mounted = false;
  let timer: unknown = null;
  type Operation = {key: string; controller: AbortController; done: Promise<void>; focus: boolean};
  let operation: Operation | null = null;
  const listeners = new Set<() => void>();
  const authorized = () => owner === options.generation();
  const live = () => mounted && authorized();
  const publish = (patch: Partial<FriendsSnapshot<T>>) => {
    state = {...state, ...patch};
    for (const listener of listeners) listener();
  };
  const clearTimer = () => {if (timer !== null) clock.cancel(timer); timer = null;};
  const cancelRead = () => {
    const previous = operation;
    operation = null; // Invalidate before synchronous abort listeners can run.
    previous?.controller.abort();
  };
  const invalidate = () => {clearTimer(); cancelRead();};

  function execute(force = false, focus = false, correctOffset = true): Promise<void> {
    if (!live() || state.scope === 'blocked' || state.composing) return Promise.resolve();
    clearTimer();
    const {scope, search, offset} = state;
    const key = JSON.stringify([scope, search, offset]);
    if (!force && operation?.key === key) {operation.focus ||= focus; return operation.done;}
    cancelRead();
    const run: Operation = {key, controller: new AbortController(), done: Promise.resolve(), focus};
    operation = run;
    const current = () => live() && operation === run && !run.controller.signal.aborted;
    run.done = Promise.resolve().then(async () => {
      if (!current()) return;
      try {
        const params = new URLSearchParams({scope, search, offset: String(offset), limit: String(PAGE_SIZE)});
        const page = requireFriendsPage<T>(await options.read(params, run.controller.signal), offset);
        if (!current()) return;
        operation = null;
        // An accepted/removed last invite can make a previously valid page disappear.
        // Correct once using the confirmed total, never loop on an unstable server list.
        if (correctOffset && offset > 0 && !page.items.length && offset >= page.total) {
          const last = Math.floor(Math.max(0, page.total - 1) / PAGE_SIZE) * PAGE_SIZE;
          publish({offset: last});
          await execute(false, run.focus, false);
          return;
        }
        publish({status: 'ready', page, error: null,
          focusRevision: state.focusRevision + (run.focus ? 1 : 0)});
      } catch (error: unknown) {
        if (!current()) return;
        operation = null;
        publish({status: 'error', page: null, error});
      }
    });
    // Never retain contact details while revalidating permissions/relationships.
    publish({status: 'loading', page: null, error: null});
    return run.done;
  }
  function queueText() {
    invalidate();
    if (!live() || state.scope === 'blocked' || state.composing) return;
    const search = state.draft.trim();
    publish({search, offset: 0, status: 'waiting', page: null, error: null});
    if (!search) {void execute(); return;}
    timer = clock.schedule(() => {timer = null; void execute();}, 250);
  }

  return {
    getSnapshot: (): FriendsSnapshot<T> => authorized() ? state : empty,
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    isCurrent: live,
    start() {
      if (mounted || !authorized()) return;
      mounted = true;
      publish({composing: false, search: state.draft.trim()});
      void execute();
    },
    stop() {
      mounted = false;
      invalidate();
      publish({page: null, error: null, composing: false, status: state.scope === 'blocked' ? 'blocked' : 'idle'});
    },
    input(value: string) {
      if (!live() || state.scope === 'blocked' || value === state.draft) return;
      publish({draft: value});
      if (state.composing) return;
      if (value.trim() === state.search && state.offset === 0) return;
      queueText();
    },
    compositionStart() {
      if (!live() || state.scope === 'blocked') return;
      invalidate();
      publish({composing: true, page: null, error: null, status: 'idle'});
    },
    compositionEnd(value: string) {
      if (!live() || !state.composing) return;
      publish({draft: value, composing: false});
      queueText();
    },
    submit(): Promise<void> {
      if (!live() || state.composing || state.scope === 'blocked') return Promise.resolve();
      const search = state.draft.trim();
      // Enter flushes a pending debounce, but does not reset a page being retried.
      if (search !== state.search) {invalidate(); publish({search, offset: 0});}
      return execute();
    },
    clear(): Promise<void> {
      if (!live() || state.composing || state.scope === 'blocked') return Promise.resolve();
      invalidate();
      publish({draft: '', search: '', offset: 0});
      return execute();
    },
    selectScope(scope: FriendsScope): Promise<void> {
      if (!live() || state.composing) return Promise.resolve();
      if (scope === state.scope && state.offset === 0) return execute();
      invalidate();
      publish({scope, search: state.draft.trim(), offset: 0, page: null, error: null,
        status: scope === 'blocked' ? 'blocked' : 'idle'});
      return execute();
    },
    next(): Promise<void> {
      if (!live() || state.composing || state.status !== 'ready' || state.page?.next_offset == null) return Promise.resolve();
      const offset = state.page.next_offset;
      invalidate(); publish({offset});
      return execute(false, true);
    },
    previous(): Promise<void> {
      if (!live() || state.composing || state.status === 'loading' || state.offset === 0) return Promise.resolve();
      invalidate(); publish({offset: Math.max(0, state.offset - PAGE_SIZE)});
      return execute(false, true);
    },
    /** Mutation success must replace any pre-write read, not share its old snapshot. */
    refreshAfterMutation(): Promise<void> {
      if (!live()) return Promise.resolve();
      invalidate();
      publish({page: null, error: null, status: state.scope === 'blocked' ? 'blocked' : 'idle'});
      return execute(true);
    },
  };
}
