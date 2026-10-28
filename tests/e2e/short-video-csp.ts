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
  type Scope = 'main' | 'platform' | 'external' | 'unknown';
  type Observation = {scope: Scope; frameOrigin: string; parentOrigin: string};
  const observations = new WeakMap<Frame, Observation>();
  const lifecycleDiagnostics: (Observation & {reason: 'detached' | 'missing-init'})[] = [];
  let undrainedDetachment: Observation | undefined;
  const platformOrigin = origin(platformURL);
  // Cache ancestry while attached: Playwright may clear parentFrame on detach.
  // These labels contain no URL paths, query strings, fragments or credentials.
  const remember = (frame: Frame): Observation => {
    const parent = frame.parentFrame();
    const parentObservation = parent ? observations.get(parent) ?? remember(parent) : undefined;
    const frameOrigin = origin(frame.url());
    const blank = frame.url() === 'about:blank' || frame.url() === 'about:srcdoc' || frame.url() === '';
    const scope: Scope = frame === page.mainFrame() ? 'main' : !platformOrigin ? 'unknown'
      : frameOrigin ? (frameOrigin === platformOrigin ? 'platform' : 'external')
      : blank && parentObservation ? (parentObservation.scope === 'main' ? 'platform' : parentObservation.scope)
      : 'unknown';
    const observation = {scope, frameOrigin: frameOrigin ?? (blank ? 'blank' : 'unknown'),
      parentOrigin: parentObservation?.frameOrigin ?? 'none'};
    observations.set(frame, observation);
    return observation;
  };
  for (const frame of page.frames()) remember(frame);
  page.on('frameattached', remember);
  page.on('framedetached', frame => {
    const observation = observations.get(frame) ?? remember(frame);
    if (!drainedFrames.has(frame)) {
      if (observation.scope === 'external') lifecycleDiagnostics.push({...observation, reason: 'detached'});
      else undrainedDetachment ??= observation;
    }
  });
  page.on('framenavigated', frame => { drainedFrames.delete(frame); remember(frame); });
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
  const assertLifecycle = () => {
    if (undrainedDetachment) throw new Error(`Short CSP frame detached without an observation checkpoint: ${JSON.stringify(undrainedDetachment)}`);
  };
  const drain = async () => {
    assertLifecycle();
    for (const frame of page.frames()) {
      const observation = observations.get(frame) ?? remember(frame);
      // All observable events retain the same strict classification. Completeness
      // is required for main/platform/unknown documents, not transient external
      // player documents. No full external lifecycle guarantee is claimed.
      let initialized: boolean;
      try {
        initialized = await frame.evaluate(async () => {
          const drain = (window as unknown as {drainShortVideoCsp?: () => Promise<void>}).drainShortVideoCsp;
          if (!drain) return false;
          await drain();
          return true;
        });
      } catch (error) {
        if (observation.scope === 'external' && frame.isDetached()
          && observations.get(frame)?.scope === 'external') continue;
        throw error;
      }
      if (observations.get(frame) !== observation
        && (observation.scope !== 'external' || observations.get(frame)?.scope !== 'external'))
        throw new Error('Short CSP frame navigated during observation checkpoint');
      if (!initialized) {
        if (observation.scope !== 'external')
          throw new Error(`Short CSP collector is not initialized: ${JSON.stringify(observation)}`);
        lifecycleDiagnostics.push({...observation, reason: 'missing-init'});
      } else if (observations.get(frame) === observation) {
        drainedFrames.add(frame);
      }
    }
    assertLifecycle();
  };
  return {violations, thirdPartyReports, lifecycleDiagnostics, drain};
}
