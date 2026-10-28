import type {Frame, Page} from '@playwright/test';

export type ShortVideoCspEvent = {
  documentURI: string;
  effectiveDirective: string;
  blockedURI: string;
  originalPolicy: string;
  disposition: string;
};
export type ShortVideoCspRecord = ShortVideoCspEvent & {frameURL: string; mainFrame: boolean};

function origin(value: string): string | undefined {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.origin : undefined; }
  catch { return undefined; }
}

/** Only a positively attributed report from the observed external player is diagnostic.
 * In particular, blockedURI is NOT the document whose policy was violated: a
 * platform frame-src rejection of YouTube must still fail this test. */
export function classifyShortVideoCsp(record: ShortVideoCspRecord, platformURL: string): 'violation' | 'third-party-report' {
  const platform = origin(platformURL), frame = origin(record.frameURL), document = origin(record.documentURI);
  if (!platform || !frame || !document || record.mainFrame || frame === platform || document === platform)
    return 'violation';
  if (record.disposition !== 'report' || !record.effectiveDirective || !record.originalPolicy)
    return 'violation';
  return frame === 'https://www.youtube-nocookie.com' && document === frame
    ? 'third-party-report' : 'violation';
}

export async function collectShortVideoCsp(page: Page, platformURL: string) {
  const violations: ShortVideoCspRecord[] = [], thirdPartyReports: ShortVideoCspRecord[] = [];
  const drainedFrames = new WeakSet<Frame>();
  let undrainedDetachment = false;
  page.on('framedetached', frame => {
    if (!drainedFrames.has(frame)) undrainedDetachment = true;
  });
  page.on('framenavigated', frame => { drainedFrames.delete(frame); });
  await page.exposeBinding('recordShortVideoCsp', (source, event: ShortVideoCspEvent) => {
    drainedFrames.delete(source.frame);
    const record = {...event, frameURL: source.frame.url(), mainFrame: source.frame === page.mainFrame()};
    (classifyShortVideoCsp(record, platformURL) === 'violation' ? violations : thirdPartyReports).push(record);
  });
  // Installed before navigation, in every document. Parent frame-src violations
  // are emitted by the parent document, even when the blocked child never loads.
  await page.addInitScript(() => {
    const pending = new Set<Promise<void>>();
    let deliveryFailed = false;
    const target = window as unknown as {
      recordShortVideoCsp: (event: ShortVideoCspEvent) => Promise<void>;
      drainShortVideoCsp: () => Promise<void>;
    };
    target.drainShortVideoCsp = async () => {
      // Capture an observation boundary, not a delay hoping that IPC has finished.
      // Each acknowledgement follows the Node-side record insertion.
      await Promise.all([...pending]);
      if (deliveryFailed) throw new Error('Short CSP event delivery failed');
    };
    document.addEventListener('securitypolicyviolation', event => {
      try {
        const delivery = target.recordShortVideoCsp({
          documentURI: event.documentURI, effectiveDirective: event.effectiveDirective,
          blockedURI: event.blockedURI, originalPolicy: event.originalPolicy, disposition: event.disposition,
        }).catch(() => { deliveryFailed = true; });
        pending.add(delivery);
        void delivery.then(() => pending.delete(delivery));
      } catch { deliveryFailed = true; }
    });
  });
  const drain = async () => {
    if (undrainedDetachment) throw new Error('Short CSP frame detached without an observation checkpoint');
    for (const frame of page.frames()) {
      // Missing initialization, rejected delivery or detachment during the barrier
      // must fail, not turn an incomplete observation into an empty-array pass.
      await frame.evaluate(async () => {
        const drain = (window as unknown as {drainShortVideoCsp?: () => Promise<void>}).drainShortVideoCsp;
        if (!drain) throw new Error('Short CSP collector is not initialized');
        await drain();
      });
      drainedFrames.add(frame);
    }
    if (undrainedDetachment) throw new Error('Short CSP frame detached without an observation checkpoint');
  };
  return {violations, thirdPartyReports, drain};
}
