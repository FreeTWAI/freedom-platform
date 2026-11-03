import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyShortVideoCsp, collectShortVideoCsp, type ShortVideoCspEvent, type ShortVideoCspRecord} from '../e2e/short-video-csp.js';
import type {Page} from '@playwright/test';

const platform = 'http://127.0.0.1:12345';
const youtube = 'https://www.youtube-nocookie.com/embed/aaaaaaaaaaa';
const report: ShortVideoCspRecord = {frameURL: youtube, documentURI: youtube, mainFrame: false,
  effectiveDirective: 'script-src', originalPolicy: "script-src 'unsafe-inline'", blockedURI: 'eval', disposition: 'report'};

test('only positively attributed YouTube iframe reports are diagnostic', () => {
  assert.equal(classifyShortVideoCsp(report, platform), 'third-party-report');
  assert.equal(classifyShortVideoCsp({...report, disposition: 'enforce'}, platform), 'violation');
  assert.equal(classifyShortVideoCsp({...report, mainFrame: true}, platform), 'violation');
});

test('platform report and enforcement fail regardless of blocked resource origin', () => {
  for (const disposition of ['report', 'enforce']) for (const effectiveDirective of ['frame-src', 'script-src', 'script-src-elem']) {
    assert.equal(classifyShortVideoCsp({...report, frameURL: platform, documentURI: platform,
      mainFrame: true, disposition, effectiveDirective, blockedURI: youtube}, platform), 'violation');
    assert.equal(classifyShortVideoCsp({...report, frameURL: platform, documentURI: platform,
      mainFrame: false, disposition, effectiveDirective}, platform), 'violation');
  }
});

test('unknown, mismatched, deceptive and non-YouTube origins fail closed', () => {
  for (const value of ['', 'about:blank', 'null', 'not a URL', 'https://www.google.com',
    'http://www.youtube-nocookie.com', 'https://www.youtube-nocookie.com:444',
    'https://www.youtube-nocookie.com.attacker.invalid', 'https://www.youtube-nocookie.com@attacker.invalid', platform]) {
    assert.equal(classifyShortVideoCsp({...report, frameURL: value}, platform), 'violation', value);
    assert.equal(classifyShortVideoCsp({...report, documentURI: value}, platform), 'violation', value);
  }
  for (const key of ['disposition', 'originalPolicy', 'effectiveDirective'] as const)
    assert.equal(classifyShortVideoCsp({...report, [key]: ''}, platform), 'violation', key);
  assert.equal(classifyShortVideoCsp(report, ''), 'violation');
});

test('source binding observes every document before login and keeps policy assertions', () => {
  const helper = readFileSync(new URL('../e2e/short-video-csp.ts', import.meta.url), 'utf8');
  const spec = readFileSync(new URL('../e2e/short-videos.spec.ts', import.meta.url), 'utf8');
  assert.match(helper, /page\.exposeBinding\('recordShortVideoCsp'/);
  assert.match(helper, /frameURL: source\.frame\.url\(\)/);
  assert.match(helper, /mainFrame: source\.frame === page\.mainFrame\(\)/);
  assert.match(helper, /document\.addEventListener\('securitypolicyviolation'/);
  assert.ok(spec.indexOf('await collectShortVideoCsp(page, baseURL!)') < spec.indexOf('await login(page);'));
  assert.ok(spec.includes("['frame-src https://aisns.evitina.tw https://www.youtube-nocookie.com']"));
  assert.ok(spec.includes("['frame-src https://aisns.evitina.tw']"));
  assert.ok(spec.includes('expect(csp).toContain("frame-ancestors \'none\'")'));
  assert.ok(spec.includes('expect(violations).toEqual([])'));
  assert.ok(spec.includes('await drain();\n    expect(violations).toEqual([])'));
  for (const action of ['await page.reload();', "await page.keyboard.press('Escape');", 'await page.goBack();',
    "await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));"])
    assert.match(spec, new RegExp('await drain\\(\\);\\s*' + action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(spec.includes('for (const src of await players.evaluateAll'));
  assert.ok(spec.includes("testInfo.attach('third-party-csp-reports'"));
  assert.doesNotMatch(helper, /page\.on\('console'/);
});

async function transportHarness(transport: (deliver: () => void) => Promise<void>,
  run: (context: {collector: Awaited<ReturnType<typeof collectShortVideoCsp>>; emit: () => void;
    target: Record<string, unknown>; detach: () => void; navigate: (url: string) => void; failEvaluation: () => void}) => Promise<void>,
  childDocument = false) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let listener: (event: ShortVideoCspEvent) => void = () => { throw Error('Listener missing'); };
  let bound: (source: {frame: typeof frame}, event: ShortVideoCspEvent) => void;
  let detached = false, evaluationFails = false, currentURL = platform;
  let onNavigated: (value: typeof frame) => void = () => {};
  let installDocument!: () => void;
  const main = {url: () => platform, parentFrame: () => null, evaluate: async () => true};
  let onDetached: (value: typeof frame) => void = () => {};
  const frame = {url: () => currentURL, parentFrame: () => childDocument ? main : null, isDetached: () => detached, evaluate: async (fn: () => Promise<void>) => {
    if (evaluationFails) throw Error('Frame detached during observation');
    return fn();
  }};
  const target: Record<string, unknown> = {recordShortVideoCsp: (event: ShortVideoCspEvent) =>
    transport(() => bound({frame}, event))};
  Object.defineProperty(globalThis, 'window', {configurable: true, value: target});
  Object.defineProperty(globalThis, 'document', {configurable: true, value: {
    addEventListener: (_name: string, callback: typeof listener) => { listener = callback; },
  }});
  const page = {exposeBinding: async (_name: string, callback: typeof bound) => { bound = callback; },
    addInitScript: async (fn: () => void) => { installDocument = fn; fn(); }, mainFrame: () => childDocument ? main : frame,
    frames: () => [...(childDocument ? [main] : []), ...(detached ? [] : [frame])],
    on: (name: string, callback: typeof onDetached) => {
      if (name === 'framedetached') onDetached = callback;
      if (name === 'framenavigated') onNavigated = callback;
    }} as unknown as Page;
  try {
    const collector = await collectShortVideoCsp(page, platform);
    await run({collector, target, emit: () => listener({...report, documentURI: platform,
      disposition: 'enforce', effectiveDirective: 'frame-src', blockedURI: youtube}),
      navigate: url => { currentURL = url; installDocument(); onNavigated(frame); },
      detach: () => { detached = true; onDetached(frame); }, failEvaluation: () => { evaluationFails = true; }});
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('actual installed listener and drain await held delivery before a frame is removed', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await transportHarness(deliver => gate.then(deliver), async ({collector, emit, detach}) => {
    emit();
    assert.equal(collector.violations.length, 0); // Reproduces the old false empty-array observation.
    let drained = false;
    const pending = collector.drain().then(() => { drained = true; });
    // A Node event-loop checkpoint settles the finite Promise chain of this
    // in-memory transport. One microtask alone also passes with a broken drain.
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(drained, false);
    release();
    await pending;
    assert.equal(collector.violations.length, 1);
    assert.equal(collector.violations[0].effectiveDirective, 'frame-src');
    detach(); // Lifecycle checkpoint happens BEFORE removal, as in the journey.
    await collector.drain();
    assert.equal(collector.violations.length, 1);
  });
});

test('delivery rejection, missing initialization and detachment during drain fail closed', async () => {
  await transportHarness(() => Promise.reject(Error('transport rejected')), async ({collector, emit}) => {
    emit(); await assert.rejects(collector.drain(), /event delivery failed/);
  });
  await transportHarness(async deliver => deliver(), async ({collector, target}) => {
    delete target.drainShortVideoCsp; await assert.rejects(collector.drain(), /not initialized/);
  });
  await transportHarness(async deliver => deliver(), async ({collector, failEvaluation}) => {
    failEvaluation(); await assert.rejects(collector.drain(), /detached during observation/);
  });
  await transportHarness(() => { throw Error('synchronous transport failure'); }, async ({collector, emit}) => {
    emit(); await assert.rejects(collector.drain(), /event delivery failed/);
  });
  await transportHarness(async deliver => deliver(), async ({collector, detach}) => {
    detach(); await assert.rejects(collector.drain(), /without an observation checkpoint/);
  });
});

// Lifecycle models exercise the actual collector callbacks without a browser.
async function lifecycleHarness() {
  type ModelFrame = {url: () => string; parentFrame: () => ModelFrame | null; isDetached: () => boolean;
    evaluate: () => Promise<boolean>; navigate: (url: string) => void; detach: () => void;
    missing: boolean; fail: boolean; duringEvaluation?: () => void};
  const frames: ModelFrame[] = [];
  const handlers = new Map<string, (frame: ModelFrame) => void>();
  let binding!: (source: {frame: ModelFrame}, event: ShortVideoCspEvent) => void;
  const create = (initialURL: string, initialParent: ModelFrame | null): ModelFrame => {
    let url = initialURL, parent = initialParent, detached = false;
    const frame: ModelFrame = {url: () => url, parentFrame: () => parent, isDetached: () => detached,
      missing: false, fail: false, evaluate: async () => {
        frame.duringEvaluation?.();
        if (frame.fail || detached) throw Error('evaluation failed');
        return !frame.missing;
      }, navigate: next => { url = next; handlers.get('framenavigated')?.(frame); },
      detach: () => { detached = true; parent = null; frames.splice(frames.indexOf(frame), 1);
        handlers.get('framedetached')?.(frame); }};
    frames.push(frame); handlers.get('frameattached')?.(frame); return frame;
  };
  const main = create(platform, null);
  const page = {mainFrame: () => main, frames: () => [...frames],
    on: (name: string, callback: (frame: ModelFrame) => void) => handlers.set(name, callback),
    exposeBinding: async (_name: string, callback: typeof binding) => { binding = callback; },
    addInitScript: async () => {}} as unknown as Page;
  const collector = await collectShortVideoCsp(page, platform);
  return {collector, main, create, emit: (frame: ModelFrame, event: ShortVideoCspEvent) => binding({frame}, event)};
}

test('platform and unknown child lifecycles remain fail-closed, including inherited blanks', async () => {
  for (const url of [platform + '/child?private=secret', 'about:blank', 'about:srcdoc', '', 'data:text/html,private', 'not-a-url']) {
    for (const failure of ['missing', 'detach', 'during-drain'] as const) {
      const {collector, main, create} = await lifecycleHarness();
      const child = create(url, main);
      if (failure === 'missing') child.missing = true;
      else if (failure === 'detach') child.detach();
      else child.duringEvaluation = () => child.detach();
      await assert.rejects(collector.drain(), error => {
        assert.doesNotMatch(String(error), /private|secret/);
        return /not initialized|without an observation checkpoint|evaluation failed/.test(String(error));
      });
    }
  }
  const {collector, main} = await lifecycleHarness();
  main.navigate(youtube); main.missing = true;
  await assert.rejects(collector.drain(), /not initialized/); // Main always required, even external.
});

test('external transient children and inherited blanks do not invent platform lifecycle failures', async () => {
  for (const failure of ['missing', 'detach', 'during-drain'] as const) {
    const {collector, main, create, emit} = await lifecycleHarness();
    const player = create(youtube + '?private=secret', main);
    const child = create('about:blank', player);
    const nested = create('about:srcdoc', child);
    emit(player, {...report, disposition: 'enforce'});
    emit(player, report);
    emit(child, {...report, documentURI: 'about:blank'}); // Unknown observed event still fails.
    if (failure === 'missing') { player.missing = child.missing = nested.missing = true; }
    else if (failure === 'detach') { nested.detach(); child.detach(); player.detach(); }
    else nested.duringEvaluation = () => nested.detach();
    await collector.drain();
    assert.equal(collector.violations.length, 2);
    assert.equal(collector.thirdPartyReports.length, 1);
    assert.ok(collector.lifecycleDiagnostics.length > 0);
    assert.doesNotMatch(JSON.stringify(collector.lifecycleDiagnostics), /private|secret|embed/);
    assert.ok(collector.lifecycleDiagnostics.every(item => item.scope === 'external'));
  }
});

test('external permission is not a blanket evaluation error suppression or a stale platform certificate', async () => {
  const {collector, main, create} = await lifecycleHarness();
  const player = create(youtube, main);
  player.fail = true;
  await assert.rejects(collector.drain(), /evaluation failed/);
  player.fail = false;
  player.navigate(platform); player.detach();
  await assert.rejects(collector.drain(), /without an observation checkpoint/);
  for (const [before, after] of [[platform, youtube], [youtube, platform], [youtube, 'data:text/html,unknown']]) {
    for (const missing of [false, true]) {
      const moving = await lifecycleHarness();
      const child = moving.create(before, moving.main);
      child.missing = missing;
      child.duringEvaluation = () => child.navigate(after);
      await assert.rejects(moving.collector.drain(), /navigated during observation/);
    }
  }
});

test('new events and navigation invalidate required frame checkpoints', async () => {
  for (const invalidate of ['event', 'navigation'] as const) {
    const {collector, main, create, emit} = await lifecycleHarness();
    const child = create(platform, main);
    await collector.drain();
    if (invalidate === 'event') emit(child, {...report, documentURI: platform});
    else child.navigate(platform + '/next');
    child.detach();
    await assert.rejects(collector.drain(), /without an observation checkpoint/);
  }
});


test('held old platform events cannot become an empty checkpoint after external navigation', async () => {
  for (const checkpointBeforeEvent of [false, true]) for (const detached of [false, true]) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await transportHarness(deliver => gate.then(deliver), async ({collector, emit, navigate, detach}) => {
      if (checkpointBeforeEvent) await collector.drain();
      emit(); // Actual installed listener holds the old platform document event.
      navigate(youtube);
      if (detached) detach();
      assert.equal(collector.violations.length, 0);
      await assert.rejects(collector.drain(), /required document navigated externally/);
      release();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(collector.violations.length, 1);
      assert.equal(collector.violations[0].documentURI, platform);
      assert.equal(collector.violations[0].disposition, 'enforce');
      // Event delivery or later document evaluation cannot restore the lost boundary.
      await assert.rejects(collector.drain(), /required document navigated externally/);
    }, true);
  }
});

test('only initial empty attachment can cross to external without a required document boundary', async () => {
  const initial = await lifecycleHarness();
  const bootstrap = initial.create('', initial.main);
  bootstrap.navigate(youtube);
  bootstrap.detach();
  await initial.collector.drain();
  assert.equal(initial.collector.lifecycleDiagnostics[0].scope, 'external');
  for (const url of ['about:blank', 'about:srcdoc', platform, 'data:text/html,unknown']) {
    const {collector, main, create} = await lifecycleHarness();
    const child = create('', main);
    child.navigate(url); // First navigation consumes bootstrap, including inherited blank.
    child.navigate(youtube);
    child.detach();
    await assert.rejects(collector.drain(), /required document navigated externally/);
  }
  const existing = await lifecycleHarness();
  const blank = existing.create('about:blank', existing.main);
  blank.navigate(youtube);
  await assert.rejects(existing.collector.drain(), /required document navigated externally/);
});

test('same-origin and hash navigation do not manufacture an external boundary', async () => {
  const {collector, main, create} = await lifecycleHarness();
  const child = create(platform, main);
  child.navigate(platform + '/next');
  child.navigate(platform + '/next#section');
  main.navigate(platform + '/#social');
  await collector.drain();
  child.detach();
  await collector.drain();
  assert.deepEqual(collector.violations, []);
  assert.deepEqual(collector.lifecycleDiagnostics, []);
});
