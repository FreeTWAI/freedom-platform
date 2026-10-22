/** Component-owned read coordination. No storage, polling, write retries or shared cache. */
export type TaskReadSnapshot<T> = Readonly<{
  key: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  value: T | null;
  error: unknown;
}>;

type ReadOptions = {retain?: boolean; retainOnError?: boolean};

function accessFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as {status?: number; accessExpired?: boolean};
  return value.status === 401 || value.status === 403 || value.accessExpired === true;
}

/**
 * Each independent section owns a lane. Same-key pending reads share completion;
 * a new key cancels the old read. Late replies cannot publish even if the
 * transport ignores abort. getSnapshot is stable until an actual state change.
 */
export function createTaskRead<T>(generation: () => number) {
  const ownerGeneration = generation();
  const empty: TaskReadSnapshot<T> = {key: null, status: 'idle', value: null, error: null};
  let snapshot = empty;
  const listeners = new Set<() => void>();
  type Operation = {
    key: string;
    controller: AbortController;
    before: TaskReadSnapshot<T>;
    done: Promise<void>;
    finish: () => void;
  };
  let active: Operation | null = null;
  const authorized = () => generation() === ownerGeneration;
  const publish = (value: TaskReadSnapshot<T>) => {
    snapshot = value;
    for (const listener of listeners) listener();
  };
  const detach = () => {
    const previous = active;
    active = null; // Invalidate before abort listeners are invoked.
    previous?.finish(); // Release waiters even when the reader ignores its signal.
    previous?.controller.abort();
    return previous;
  };
  return {
    getSnapshot: (): TaskReadSnapshot<T> => authorized() ? snapshot : empty,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    run(key: string, read: (signal: AbortSignal) => Promise<T>, options: ReadOptions = {}): Promise<void> {
      if (!authorized()) return Promise.resolve();
      if (active?.key === key) return active.done;
      const previous = detach();
      const before = previous?.before ?? snapshot;
      const retained = options.retain ? before.value : null;
      let finish!: () => void, fail!: (cause: unknown) => void;
      const done = new Promise<void>((resolve,reject) => {finish=resolve;fail=reject;});
      const operation: Operation = {key, controller: new AbortController(), before, done, finish};
      active = operation;
      const current = () => active === operation && authorized() && !operation.controller.signal.aborted;
      void Promise.resolve().then(async () => {
        // A rapid filter change can cancel a scheduled read before any HTTP call.
        if (!current()) return;
        try {
          const value = await read(operation.controller.signal);
          if (!current()) return;
          active = null;
          publish({key, status: 'ready', value, error: null});
        } catch (error: unknown) {
          if (!current()) return;
          active = null;
          publish({key, status: 'error', error,
            value: options.retainOnError && !accessFailure(error) ? retained : null});
        }
      }).then(finish,fail);
      publish({key, status: 'loading', value: retained, error: null});
      return operation.done;
    },
    cancel() {
      const previous = detach();
      if (previous) publish(previous.before);
    },
    reset() {
      detach();
      publish(empty);
    },
  };
}

/** Keep page order, removing duplicates both across pages and within one reply. */
export function appendTaskItems<T extends {work_item_id: string}>(previous: T[], next: T[]): T[] {
  const known = new Set(previous.map(item => item.work_item_id));
  const result = [...previous];
  for (const item of next) {
    if (known.has(item.work_item_id)) continue;
    known.add(item.work_item_id);
    result.push(item);
  }
  return result;
}
