import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from '@typescript/typescript6';
import type {Locator, Page} from '@playwright/test';
import {collectShortVideoCsp, type ShortVideoCspEvent} from '../e2e/short-video-csp.js';
import {waitForInitialShortVideoPlayers} from '../e2e/short-video-readiness.js';

const platform = 'http://127.0.0.1:12345';
const sources = ['aaaaaaaaaaa', 'bbbbbbbbbbb'].map(id => `https://www.youtube-nocookie.com/embed/${id}?playsinline=1`);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return {promise, resolve};
}
const checkpoint = () => new Promise<void>(resolve => setImmediate(resolve));

// Exercise the real helper and collector callbacks with controlled frame commits.
// These are lifecycle models, not native browser/CSP/YouTube acceptance.
async function model(deferPlayers = false) {
  type ModelFrame = {url: () => string; parentFrame: () => ModelFrame | null; isDetached: () => boolean;
    evaluate: () => Promise<boolean>; waitForURL: (match: (url: URL) => boolean, options: {waitUntil: string}) => Promise<void>;
    navigate: (url: string) => void; detach: () => void; commit: ReturnType<typeof deferred>;
    entered: ReturnType<typeof deferred>; evaluations: number; waits: number; missing: boolean;
    fail?: Error; duringEvaluation?: () => void};
  const frames: ModelFrame[] = [], handlers = new Map<string, (frame: ModelFrame) => void>();
  let binding!: (source: {frame: ModelFrame}, event: ShortVideoCspEvent) => void;
  const create = (initialURL: string, parent: ModelFrame | null): ModelFrame => {
    let currentURL = initialURL, detached = false;
    const frame: ModelFrame = {url: () => currentURL, parentFrame: () => detached ? null : parent,
      isDetached: () => detached, evaluations: 0, waits: 0, missing: false, commit: deferred(), entered: deferred(),
      evaluate: async () => { frame.evaluations++; frame.duringEvaluation?.(); return !frame.missing; },
      waitForURL: async (match, options) => {
        frame.waits++; assert.deepEqual(options, {waitUntil: 'commit'});
        assert.equal(match(new URL('https://other.invalid/embed/aaaaaaaaaaa?playsinline=1')), false);
        assert.equal(match(new URL(sources[0] + '&different=1')), false);
        frame.entered.resolve();
        await frame.commit.promise;
        if (frame.fail) throw frame.fail;
        if (detached) throw new Error('synthetic frame detached');
        assert.equal(match(new URL(currentURL)), true, 'the actual iframe must commit its exact expected URL');
      },
      navigate: url => { currentURL = url; handlers.get('framenavigated')?.(frame); },
      detach: () => { detached = true; frames.splice(frames.indexOf(frame), 1); handlers.get('framedetached')?.(frame); },
    };
    frames.push(frame); handlers.get('frameattached')?.(frame); return frame;
  };
  const main = create(platform, null);
  const page = {mainFrame: () => main, frames: () => [...frames],
    on: (name: string, handler: (frame: ModelFrame) => void) => handlers.set(name, handler),
    exposeBinding: async (_name: string, callback: typeof binding) => { binding = callback; },
    addInitScript: async () => {}} as unknown as Page;
  const collector = await collectShortVideoCsp(page, platform);
  const children: ModelFrame[] = [];
  const handles: {getAttribute: () => Promise<string>; contentFrame: () => Promise<ModelFrame>}[] = [];
  const attachPlayers = () => {
    assert.equal(children.length, 0);
    for (const src of sources) {
      const frame = create('', main); children.push(frame);
      handles.push({getAttribute: async () => src, contentFrame: async () => frame});
    }
  };
  if (!deferPlayers) attachPlayers();
  const players = {elementHandles: async () => handles} as unknown as Locator;
  return {page, main, children, handles, players, collector, attachPlayers,
    emit: (frame: ModelFrame, event: ShortVideoCspEvent) => binding({frame}, event),
    commit: (index: number) => { children[index].navigate(sources[index]); children[index].commit.resolve(); }};
}

test('both exact iframe commits precede the unchanged collector checkpoint', async () => {
  const f = await model();
  let observed = false;
  const pending = waitForInitialShortVideoPlayers(f.players, sources).then(async () => { await f.collector.drain(); observed = true; });
  await Promise.all(f.children.map(frame => frame.entered.promise));
  await checkpoint(); assert.equal(observed, false); assert.equal(f.main.evaluations, 0);
  f.commit(1); await checkpoint(); assert.equal(observed, false); assert.equal(f.main.evaluations, 0);
  f.commit(0); await pending;
  assert.equal(observed, true); assert.deepEqual(f.children.map(frame => frame.waits), [1, 1]);
  assert.deepEqual(f.children.map(frame => frame.evaluations), [1, 1]);
});

test('an initial commit during an unguarded checkpoint still fails closed', async () => {
  const f = await model();
  f.children[0].duringEvaluation = () => f.commit(0);
  await assert.rejects(f.collector.drain(), /frame navigated during observation checkpoint/);
});

test('readiness does not erase a prior committed platform or inherited-blank boundary', async () => {
  for (const previous of [platform + '/child', 'about:blank', 'about:srcdoc']) {
    const f = await model();
    f.children[0].navigate(previous); // Consume only the genuine empty-attachment exemption.
    const pending = waitForInitialShortVideoPlayers(f.players, sources);
    await Promise.all(f.children.map(frame => frame.entered.promise));
    f.commit(0); f.commit(1); await pending;
    await assert.rejects(f.collector.drain(), /required document navigated externally/);
  }
});

test('readiness retains observed parent blocks and external enforced CSP violations', async () => {
  const f = await model();
  const event = {documentURI: platform, effectiveDirective: 'frame-src', blockedURI: sources[0],
    originalPolicy: "frame-src 'self'", disposition: 'enforce'};
  f.emit(f.main, event);
  const pending = waitForInitialShortVideoPlayers(f.players, sources);
  await Promise.all(f.children.map(frame => frame.entered.promise));
  f.commit(0); f.commit(1); await pending;
  f.emit(f.children[0], {...event, documentURI: sources[0], effectiveDirective: 'script-src'});
  await f.collector.drain();
  assert.equal(f.collector.violations.length, 2);
  assert.deepEqual(f.collector.thirdPartyReports, []);
});

test('missing players and navigation failures reject without retrying or substituting another frame', async () => {
  const empty = {elementHandles: async () => []} as unknown as Locator;
  await assert.rejects(waitForInitialShortVideoPlayers(empty, sources), /count changed/);
  for (const missing of ['src', 'frame']) {
    const unusedFrame = {waitForURL: () => { throw new Error('Missing inputs must reject before waiting'); }};
    const players = {elementHandles: async () => [{getAttribute: async () => missing === 'src' ? null : sources[0],
      contentFrame: async () => missing === 'frame' ? null : unusedFrame}]} as unknown as Locator;
    await assert.rejects(waitForInitialShortVideoPlayers(players, sources.slice(0, 1)), /unavailable/);
  }
  for (const changedSource of ['https://other.invalid/embed/aaaaaaaaaaa?playsinline=1', sources[0] + '&changed=1']) {
    let waited = false;
    const players = {elementHandles: async () => [{getAttribute: async () => changedSource,
      contentFrame: async () => ({waitForURL: async () => { waited = true; }})}]} as unknown as Locator;
    await assert.rejects(waitForInitialShortVideoPlayers(players, sources.slice(0, 1)), /source changed/);
    assert.equal(waited, false, 'a source changed after caller validation must not become the expected URL');
  }
  for (const failure of ['detach', 'navigation']) {
    const f = await model();
    const pending = waitForInitialShortVideoPlayers(f.players, sources);
    const rejected = assert.rejects(pending, /synthetic frame detached|synthetic navigation failed/);
    await Promise.all(f.children.map(frame => frame.entered.promise));
    if (failure === 'detach') f.children[0].detach();
    else f.children[0].fail = new Error('synthetic navigation failed');
    f.children[0].commit.resolve(); f.commit(1); await rejected;
    assert.deepEqual(f.children.map(frame => frame.waits), [1, 1]);
    assert.equal(f.main.evaluations, 0);
  }
});

// Execute the checked-in journey until its first swipe, rather than merely
// asserting that its source contains a helper name. UI/DB bootstrap is synthetic;
// actual readiness and actual CSP collector callbacks are not replaced.
async function journey() {
  const f = await model(true), swiped = new Error('synthetic first swipe reached'), attached = deferred();
  let registered!: (fixtures: object, info: object) => Promise<void>, drains = 0, deleted = 0;
  const events: string[] = [];
  const noop = async () => {};
  const generic = {fill: noop, click: noop};
  const players = {...f.players, evaluateAll: async (callback: (items: {src: string}[]) => unknown) => callback(sources.map(src => ({src}))),
    first: () => ({evaluate: async () => 'none'})};
  const feed = {locator: (selector: string) => selector === 'iframe' ? players
    : selector === '.short-video-scroller' ? {evaluate: async () => 0} : {filter: () => ({})},
    getByRole: (_role: string, options: {name: string}) => ({click: async () => {
      if (options.name === '下一支短影音') { events.push('swipe'); throw swiped; }
      throw new Error('Unexpected synthetic control');
    }})};
  const page = Object.assign(f.page, {goto: noop, reload: noop, getByLabel: () => generic,
    getByRole: (role: string) => role === 'region' ? feed : generic, locator: () => ({})});
  const fakeTest = Object.assign((title: string, callback: typeof registered) => {
    if (title.startsWith('members swipe through shared YouTube links')) registered = callback;
  }, {describe: (_title: string, callback: () => void) => callback(), use: () => {}});
  const expect = (value: unknown) => ({toBeVisible: noop, toHaveCount: noop, toBeDisabled: noop,
    toBeTruthy: () => assert.ok(value), toMatch: (pattern: RegExp) => assert.match(value as string, pattern),
    toBe: (expected: unknown) => assert.equal(value, expected)});
  const dependencies: Record<string, unknown> = {
    './member-feature-fixture.js': {test: fakeTest, expect},
    './navigation.js': {navigate: noop, selectSocialFeed: async () => {
      f.attachPlayers();
      // Without the call site, the initial commit happens inside the collector's
      // evaluation, matching the original CI failure mechanism.
      f.children[0].duringEvaluation = () => { if (!f.children[0].url()) f.commit(0); };
      attached.resolve();
    }},
    './short-video-readiness.js': {waitForInitialShortVideoPlayers},
    './short-video-csp.js': {collectShortVideoCsp: async () => ({...f.collector, drain: async () => {
      drains++; events.push(`drain${drains}`);
      await f.collector.drain();
    }})},
  };
  const source = readFileSync(new URL('../e2e/short-videos.spec.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}});
  runInNewContext(compiled.outputText, {exports: {}, require: (id: string) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected journey dependency: ${id}`); return dependencies[id];
  }}, {filename: 'short-videos.spec.ts'});
  assert.ok(registered);
  const pool = {query: async (sql: string) => {
    if (sql.startsWith('DELETE')) { deleted++; return {rows: []}; }
    return {rows: [{community_id: 'synthetic', author_user_id: 'synthetic', post_id: 'synthetic'}]};
  }};
  const run = () => registered({page, e2eAuthPool: pool, baseURL: platform}, {attach: noop});
  return {...f, run, swiped, attached, events, deleted: () => deleted, drains: () => drains};
}

test('the actual Short journey awaits both commits before its first player checkpoint and swipe', async () => {
  const f = await journey();
  const outcome = f.run().then(() => ({error: undefined}), error => ({error}));
  await f.attached.promise;
  const entered = Promise.all(f.children.map(frame => frame.entered.promise)).then(() => 'entered');
  assert.equal(await Promise.race([entered, outcome.then(() => 'ended')]), 'entered');
  await checkpoint(); assert.equal(f.drains(), 1); assert.deepEqual(f.events, ['drain1']);
  f.commit(1); await checkpoint(); assert.equal(f.drains(), 1);
  f.commit(0);
  assert.equal((await outcome).error, f.swiped);
  assert.deepEqual(f.events, ['drain1', 'drain2', 'swipe']);
  assert.equal(f.deleted(), 1);
});
