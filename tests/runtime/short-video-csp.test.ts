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
    target: Record<string, unknown>; detach: () => void; failEvaluation: () => void}) => Promise<void>) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let listener: (event: ShortVideoCspEvent) => void = () => { throw Error('Listener missing'); };
  let bound: (source: {frame: typeof frame}, event: ShortVideoCspEvent) => void;
  let detached = false, evaluationFails = false;
  let onDetached: (value: typeof frame) => void = () => {};
  const frame = {url: () => platform, evaluate: async (fn: () => Promise<void>) => {
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
    addInitScript: async (fn: () => void) => fn(), mainFrame: () => frame, frames: () => detached ? [] : [frame],
    on: (name: string, callback: typeof onDetached) => { if (name === 'framedetached') onDetached = callback; }} as unknown as Page;
  try {
    const collector = await collectShortVideoCsp(page, platform);
    await run({collector, target, emit: () => listener({...report, documentURI: platform,
      disposition: 'enforce', effectiveDirective: 'frame-src', blockedURI: youtube}),
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
