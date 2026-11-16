import {expect, type Locator, type Page} from '../fixtures.js';
import type {TestInfo} from '@playwright/test';

type PngTimingEntry = Record<string, unknown>;
type PngTimingStore = PngTimingEntry[] & {dropped?: number};

const MAX_PNG_TIMING_ENTRIES = 200;

// Test-only timing around result PNG generation; emits nothing when the link assertion passes.
export async function installPngTiming(page: Page): Promise<void> {
  await page.addInitScript((limit: number) => {
    const win = window as unknown as {__pngTiming?: PngTimingStore};
    if (win.__pngTiming) return;
    const store: PngTimingStore = Object.assign([] as PngTimingEntry[], {dropped: 0});
    win.__pngTiming = store;
    const now = () => document.timeline.currentTime;
    const push = <T extends PngTimingEntry>(entry: T): T => {
      if (store.length < limit) store.push(entry);
      else store.dropped = (store.dropped ?? 0) + 1;
      return entry;
    };

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      ...args: [string?, unknown?]
    ) {
      const rec = push({
        op: 'toBlob',
        w: this.width,
        h: this.height,
        type: args[0] ?? null,
        s: now(),
        e: null as CSSNumberish | null,
        size: null as number | null,
      });
      const wrappedCallback: BlobCallback = function (this: unknown, blob: Blob | null) {
        rec.e = now();
        rec.size = blob ? blob.size : null;
        return callback.call(this, blob);
      };
      return origToBlob.call(this, wrappedCallback, ...(args as [string?, any?]));
    };

    if (typeof window.createImageBitmap === 'function') {
      const origCreateImageBitmap = window.createImageBitmap;
      window.createImageBitmap = function (
        this: unknown,
        ...args: Parameters<typeof createImageBitmap>
      ) {
        const rec = push({
          op: 'createImageBitmap',
          s: now(),
          e: null as CSSNumberish | null,
        });
        try {
          const promise = origCreateImageBitmap.apply(this, args);
          void promise.then(
            () => {
              rec.e = now();
            },
            () => {
              rec.e = now();
            }
          );
          return promise;
        } catch (err) {
          rec.e = now();
          throw err;
        }
      } as typeof window.createImageBitmap;
    }

    if (
      typeof HTMLImageElement !== 'undefined' &&
      typeof HTMLImageElement.prototype.decode === 'function'
    ) {
      const origDecode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement, ...args: []) {
        const rec = push({
          op: 'decode',
          s: now(),
          e: null as CSSNumberish | null,
        });
        try {
          const promise = origDecode.apply(this, args);
          void promise.then(
            () => {
              rec.e = now();
            },
            () => {
              rec.e = now();
            }
          );
          return promise;
        } catch (err) {
          rec.e = now();
          throw err;
        }
      };
    }

    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = function (this: unknown, obj: Blob | MediaSource, ...rest: unknown[]) {
        const s = now();
        const size = obj && typeof (obj as Blob).size === 'number' ? (obj as Blob).size : null;
        const rec = push({
          op: 'createObjectURL',
          s,
          e: null as CSSNumberish | null,
          size,
        });
        try {
          return (origCreateObjectURL as (...a: unknown[]) => string).call(this, obj, ...rest);
        } finally {
          rec.e = now();
        }
      };
    }

    document.addEventListener(
      'visibilitychange',
      () => {
        const t = now();
        push({
          op: 'visibilitychange',
          state: document.visibilityState,
          s: t,
          e: t,
        });
      },
      true
    );
  }, MAX_PNG_TIMING_ENTRIES);
}

export async function markPngTiming(page: Page, label: string): Promise<void> {
  await page.evaluate(
    ([markLabel, limit]) => {
      const win = window as unknown as {__pngTiming?: PngTimingStore};
      if (!win.__pngTiming) {
        win.__pngTiming = Object.assign([] as PngTimingEntry[], {dropped: 0});
      }
      const t = document.timeline.currentTime;
      if (win.__pngTiming.length < limit) {
        win.__pngTiming.push({op: 'mark', label: markLabel, s: t, e: t});
      } else {
        win.__pngTiming.dropped = (win.__pngTiming.dropped ?? 0) + 1;
      }
    },
    [label, MAX_PNG_TIMING_ENTRIES] as const
  );
}

export async function expectPngLink(
  page: Page,
  testInfo: Pick<TestInfo, 'attach'>,
  locator: Locator
): Promise<void> {
  try {
    await expect(locator).toBeVisible();
  } catch (error) {
    let payload: Record<string, unknown>;
    try {
      payload = await page.evaluate(() => {
        const win = window as unknown as {__pngTiming?: PngTimingStore};
        const entries = Array.isArray(win.__pngTiming) ? [...win.__pngTiming] : [];
        const dropped = win.__pngTiming?.dropped ?? 0;
        return {
          currentTime: document.timeline.currentTime,
          hardwareConcurrency: navigator.hardwareConcurrency,
          visibilityState: document.visibilityState,
          dropped,
          entries,
        };
      });
    } catch (evalError) {
      payload = {
        evaluateError: evalError instanceof Error ? evalError.message : String(evalError),
      };
    }
    const body = JSON.stringify(payload);
    await testInfo.attach('png-timing', {body, contentType: 'application/json'});
    console.log(`PNG_TIMING ${body}`);
    throw error;
  }
}
