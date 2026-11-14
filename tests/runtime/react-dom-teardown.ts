import React from 'react';
import type { Root } from 'react-dom/client';

export interface ReactDomTeardownHandle {
  setRoot(root: Root): void;
  trackPromise<T>(promise: Promise<T>): Promise<T>;
  trackFn<T extends (...args: any[]) => any>(fn: T): T;
  trackClient<T extends Record<string, any>>(client: T): T;
  onRestore(fn: () => void): void;
}

/**
 * Registers a subtest teardown hook that unmounts React inside `act`, drains
 * pending timers, tracked promises, and one macrotask, and only then restores
 * the saved globals and cleanup callbacks.
 */
export function registerReactDomTeardown(
  t: { after: (fn: () => void | Promise<void>) => void },
  prevGlobals: Record<string, unknown>,
): ReactDomTeardownHandle {
  let activeRoot: Root | null = null;
  const restoreCallbacks: Array<() => void> = [];
  const pendingTimers = new Map<unknown, () => void>();
  const pendingTimerPromises = new Set<Promise<void>>();
  const pendingPromises = new Set<Promise<unknown>>();

  const origSetTimeout = globalThis.setTimeout;
  const origClearTimeout = globalThis.clearTimeout;
  const origSetImmediate = globalThis.setImmediate;
  const origClearImmediate = globalThis.clearImmediate;

  function wrapScheduler(
    schedule: (wrappedFn: (...args: any[]) => any) => unknown,
    fn: unknown,
  ): unknown {
    let settled = false;
    let handle: unknown;
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      if (handle !== undefined) pendingTimers.delete(handle);
      pendingTimerPromises.delete(promise);
      resolve();
    };
    pendingTimerPromises.add(promise);
    handle = schedule((...cbArgs: any[]) => {
      try {
        return typeof fn === 'function' ? fn(...cbArgs) : undefined;
      } finally {
        finish();
      }
    });
    if (settled) {
      pendingTimerPromises.delete(promise);
    } else if (handle !== undefined) {
      pendingTimers.set(handle, finish);
    }
    return handle;
  }

  (globalThis as any).setTimeout = ((fn: any, delay?: number, ...args: any[]) =>
    wrapScheduler((wrapped) => origSetTimeout(wrapped, delay, ...args), fn)) as typeof setTimeout;
  (globalThis as any).clearTimeout = ((handle: any) => {
    origClearTimeout(handle);
    pendingTimers.get(handle)?.();
  }) as typeof clearTimeout;
  (globalThis as any).setImmediate = ((fn: any, ...args: any[]) =>
    wrapScheduler((wrapped) => origSetImmediate(wrapped, ...args), fn)) as typeof setImmediate;
  (globalThis as any).clearImmediate = ((handle: any) => {
    origClearImmediate(handle);
    pendingTimers.get(handle)?.();
  }) as typeof clearImmediate;

  function trackPromise<T>(promise: Promise<T>): Promise<T> {
    const tracked: Promise<void> = Promise.resolve(promise).then(
      () => {
        pendingPromises.delete(tracked);
      },
      () => {
        pendingPromises.delete(tracked);
      },
    );
    pendingPromises.add(tracked);
    return promise;
  }

  function trackFn<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      const result = fn(...args);
      if (result && typeof result.then === 'function') {
        return trackPromise(result);
      }
      return result;
    }) as T;
  }

  function trackClient<T extends Record<string, any>>(client: T): T {
    for (const key of Object.keys(client)) {
      const value = client[key];
      if (typeof value === 'function') {
        (client as any)[key] = trackFn(value.bind(client));
      }
    }
    return client;
  }

  async function drainPendingWork() {
    while (pendingTimerPromises.size > 0 || pendingPromises.size > 0) {
      const batch = [...pendingTimerPromises, ...pendingPromises];
      await React.act(async () => {
        await Promise.allSettled(batch);
      });
    }
  }

  t.after(async () => {
    if (activeRoot) {
      await React.act(async () => {
        activeRoot!.unmount();
      });
    }
    await drainPendingWork();
    await React.act(async () => {
      await new Promise<void>((resolve) => origSetImmediate(resolve));
      await new Promise<void>((resolve) => origSetTimeout(resolve, 0));
    });
    await drainPendingWork();

    for (const restore of restoreCallbacks.reverse()) {
      restore();
    }
    Object.assign(globalThis, {
      setTimeout: origSetTimeout,
      clearTimeout: origClearTimeout,
      setImmediate: origSetImmediate,
      clearImmediate: origClearImmediate,
      ...prevGlobals,
    });
  });

  return {
    setRoot(root: Root) {
      activeRoot = root;
    },
    trackPromise,
    trackFn,
    trackClient,
    onRestore(fn: () => void) {
      restoreCallbacks.push(fn);
    },
  };
}
