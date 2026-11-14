import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';

class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style = {setProperty() {}, removeProperty() {}};
  listeners: Record<string, Function[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  open = false;
  focused = false;
  selected = false;
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
  }
  appendChild(node: HostNode) {
    node.parentNode?.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node;
  }
  removeChild(node: HostNode) {
    const index = this.childNodes.indexOf(node); assert.notEqual(index, -1);
    this.childNodes.splice(index, 1); node.parentNode = null; return node;
  }
  insertBefore(node: HostNode, before: HostNode) {
    node.parentNode?.removeChild(node); const index = this.childNodes.indexOf(before); assert.notEqual(index, -1);
    this.childNodes.splice(index, 0, node); node.parentNode = this; return node;
  }
  setAttribute(key: string, value: unknown) {this.attributes[key] = String(value); if (key === 'open') this.open = true;}
  removeAttribute(key: string) {delete this.attributes[key]; if (key === 'open') this.open = false;}
  getAttribute(key: string) {return this.attributes[key] ?? null;}
  setAttributeNS(_namespace: string, key: string, value: unknown) {this.setAttribute(key, value);}
  addEventListener(type: string, fn: Function) {(this.listeners[type] ??= []).push(fn);}
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter(item => item !== fn);}
  get firstChild(): HostNode | null {return this.childNodes[0] ?? null;}
  get lastChild(): HostNode | null {return this.childNodes.at(-1) ?? null;}
  get nextSibling(): HostNode | null {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;}
  get textContent(): string {return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join('');}
  set textContent(value: string) {this.childNodes.forEach(node => {node.parentNode = null;}); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  get parentElement(): HostNode | null {return this.parentNode?.nodeType === 1 ? this.parentNode : null;}
  contains(node: HostNode): boolean {return node === this || this.childNodes.some(child => child.contains(node));}
}
class HostDetailsElement extends HostNode {}
class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null); this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
  }
  createElement(name: string) {return name.toUpperCase() === 'DETAILS' ? new HostDetailsElement(1, 'DETAILS', this) : new HostNode(1, name.toUpperCase(), this);}
  createElementNS(namespace: string, name: string) {const node = this.createElement(name); node.namespaceURI = namespace; return node;}
  createTextNode(value: string) {const node = new HostNode(3, '#text', this); node.nodeValue = value; return node;}
}

const origin = 'https://workshop.example.test';
const document = new HostDocument();
const navigatorState: {share: (data: any) => Promise<void>; clipboard: {writeText: (text: string) => Promise<void>}} = {
  share: async () => {},
  clipboard: {writeText: async () => {}},
};
const windowObj = {
  location: {origin}, open() {throw Error('No external navigation permitted');},
  document, HTMLElement: HostNode, HTMLDetailsElement: HostDetailsElement, HTMLIFrameElement: class {},
  addEventListener() {}, removeEventListener() {}, get event() {return undefined;},
};
document.defaultView = windowObj;
Object.assign(globalThis, {document, window: windowObj, HTMLElement: HostNode, HTMLDetailsElement: HostDetailsElement, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true});

const req = createRequire(import.meta.url);
const {createRoot} = req('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = req('react-dom') as typeof import('react-dom');
const flushReact = (fn: () => void) => React.act(() => flushSync(fn));

HostNode.prototype.closest = function () {return null;};
HostNode.prototype.showModal = function () {this.open = true; this.setAttribute('open', '');};
HostNode.prototype.close = function () {
  const wasOpen = this.open;
  this.open = false;
  this.removeAttribute('open');
  if (wasOpen) propsOf(this)?.onClose?.({target: this, currentTarget: this, stopPropagation() {}});
};
HostNode.prototype.focus = function () {this.focused = true; this.ownerDocument.activeElement = this;};
HostNode.prototype.select = function () {this.selected = true;};
HostNode.prototype.getBoundingClientRect = function () {
  return this.nodeName === 'DIALOG'
    ? {left: 100, top: 100, right: 500, bottom: 500, width: 400, height: 400}
    : {left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0};
};

const base = fileURLToPath(new URL('../../', import.meta.url));
const propsOf = (node: HostNode) => node[Object.keys(node).find(k => k.startsWith('__reactProps$'))!];
const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];
let nextNodeId = 0;
const nodeIds = new WeakMap<HostNode, number>();
const idOf = (node: HostNode | null | undefined) => {
  if (!node) return 0;
  let id = nodeIds.get(node);
  if (!id) {id = ++nextNodeId; nodeIds.set(node, id);}
  return id;
};
const content = {introductions: ['分享介紹一', '分享介紹二'], illustration_url: '/brand/skill-illustrations/social-post.webp', illustration_alt: '合成介紹圖片'};
const flush = () => React.act(async () => {await new Promise<void>(resolve => setImmediate(resolve));});

function harness(t: TestContext) {
  const requests: any[] = [], copies: string[] = [], shares: any[] = [], timers = new Map<number, {fn: () => void; ms: number}>();
  let timerId = 0, unmounted = false;
  navigatorState.clipboard.writeText = async (text: string) => {copies.push(text);};
  navigatorState.share = async (data: any) => {shares.push(data);};
  const timersOf = {
    setTimeout: (fn: () => void, ms: number) => {
      if (ms !== 8000) return setTimeout(fn, ms) as unknown as number;
      const id = ++timerId; timers.set(id, {fn, ms}); return id;
    },
    clearTimeout: (id: number) => {timers.delete(id); clearTimeout(id);},
  };
  const cache = new Map<string, any>();
  const compile = (relative: string): any => {
    const file = path.resolve(base, relative);
    if (cache.has(file)) return cache.get(file);
    const mod = {exports: {} as any}; cache.set(file, mod.exports);
    const raw = readFileSync(file, 'utf8');
    runInNewContext(transformSync(raw, {loader: relative.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic'}).code, {
      module: mod, exports: mod.exports, crypto: webcrypto, Intl, URL, AbortController, console,
      window: windowObj, document, navigator: navigatorState, HTMLDetailsElement: HostDetailsElement,
      setTimeout: timersOf.setTimeout, clearTimeout: timersOf.clearTimeout,
      fetch: (p: string, options: any) => new Promise((resolve, reject) => requests.push({path: p, options, resolve, reject})),
      require(name: string) {
        if (name === 'react') return React;
        if (name === 'react/jsx-runtime' || name === 'react-dom' || name === 'qrcode') return req(name);
        if (name === '../language') return {useLanguage: () => ({t: (k: string) => k})};
        if (name.endsWith('.css')) return {};
        if (name.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file), name);
          const target = [resolved, resolved + '.ts', resolved + '.tsx'].find(existsSync);
          assert.ok(target, `missing ${name}`);
          return compile(path.relative(base, target));
        }
        throw Error('Unexpected import: ' + name);
      },
    });
    cache.set(file, mod.exports);
    return mod.exports;
  };
  const skillShareMod = compile('apps/portal-web/src/modules/SkillShare.tsx');
  let props: any = {bookId: 'social-post', title: '合成技能書', active: true};
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  const render = (patch?: Partial<typeof props>) => {
    if (patch) props = {...props, ...patch};
    flushReact(() => root.render(React.createElement(skillShareMod.SkillShare, props)));
  };
  const unmount = () => {
    if (!unmounted) {unmounted = true; flushReact(() => root.unmount()); container.parentNode?.removeChild(container);}
  };
  t.after(unmount);
  render();

  const all = () => descendants(document.body);
  const button = (label: string) => all().find(n => n.nodeName === 'BUTTON' && (n.textContent === label || n.getAttribute('aria-label') === label));
  const click = async (label: string) => {
    const item = all().filter(n => n.nodeName === 'BUTTON' && (n.textContent === label || n.getAttribute('aria-label') === label)).at(-1);
    assert.ok(item, label);
    assert.ok(!propsOf(item).disabled, label + ' enabled');
    await React.act(async () => {await propsOf(item).onClick?.({preventDefault() {}, stopPropagation() {}});});
  };
  const request = (p: string) => {const item = requests.findLast(r => r.path === p); assert.ok(item, p); return item;};
  const response = async (p: string, body: any, ok = true) => {request(p).resolve({ok, status: ok ? 200 : 503, json: async () => body}); await flush();};
  const expire = async () => {for (const [id, timer] of [...timers]) {assert.equal(timer.ms, 8000); timers.delete(id); timer.fn();} await flush();};
  const start = async () => {await click('分享技能');};
  const text = () => all().map(n => n.textContent).join('\n');
  const url = () => all().find(n => n.getAttribute('class') === 'skill-share-url')?.textContent;
  const close = () => click('關閉分享');
  const selectIntro = async (idx: number) => {
    const radios = all().filter(n => n.nodeName === 'INPUT' && (n.type === 'radio' || n.getAttribute('type') === 'radio' || propsOf(n)?.type === 'radio'));
    assert.ok(radios[idx], `missing intro radio ${idx}`);
    await React.act(async () => {propsOf(radios[idx]).onChange({target: {checked: true}});});
  };
  return {props, render, unmount, requests, copies, shares, timers, skillShareMod, navigatorState, all, button, click, request, response, expire, start, text, url, close, selectIntro};
}

const introPath = '/api/v1/skills/social-post/share-content';
async function anonymous(h: ReturnType<typeof harness>) {await h.response('/api/v1/session', {});}
async function loaded(h: ReturnType<typeof harness>) {await h.response(introPath, content);}

test('stalled introduction request still allows plain-url tracked or fallback sharing without crashing', async t => {
  const h = harness(t);
  await h.start();
  await h.response('/api/v1/session', {csrf_token: 'synthetic-csrf'});
  await h.response('/api/v1/promotion/links', {path: '/go/abcdefghij'});
  assert.equal(h.url(), origin + '/go/abcdefghij');
  assert.ok(!h.all().some(n => n.getAttribute('class') === 'share-intros'));
  await h.expire();
  assert.equal(h.request(introPath).options.signal.aborted, true);
  assert.equal(h.timers.size, 0);
  await h.click('複製連結');
  await flush();
  assert.deepEqual(h.copies, [origin + '/go/abcdefghij']);
});

test('a stalled introduction response body is bounded, not only its headers', async t => {
  const h = harness(t);
  await h.start();
  await anonymous(h);
  h.request(introPath).resolve({ok: true, json: () => new Promise(() => {})});
  await flush();
  await h.expire();
  assert.equal(h.url(), origin + '/development/skills/social-post');
  assert.ok(!propsOf(h.button('複製連結')!).disabled);
});

for (const stage of ['session', 'session-body', 'promotion', 'promotion-body']) {
  test(`stalled ${stage} falls back to the public reading URL without replaying tracking writes`, async t => {
    const h = harness(t);
    await h.start();
    await loaded(h);
    if (stage === 'session-body') h.request('/api/v1/session').resolve({ok: true, json: () => new Promise(() => {})});
    if (stage.startsWith('promotion')) {
      await h.response('/api/v1/session', {csrf_token: 'synthetic-csrf'});
      if (stage === 'promotion-body') h.request('/api/v1/promotion/links').resolve({ok: true, json: () => new Promise(() => {})});
    }
    await h.selectIntro(0);
    await h.expire();
    assert.equal(h.url(), origin + '/development/skills/social-post?intro=1');
    assert.ok(h.text().includes('這是一般連結，不會記在你名下'));
    await h.click('複製連結');
    await h.click('分享');
    await flush();
    assert.equal(h.copies[0], '分享介紹一\n' + origin + '/development/skills/social-post?intro=1');
    assert.equal(h.shares.length, 1);
    assert.equal(h.requests.filter(r => r.path === '/api/v1/promotion/links').length, stage.startsWith('promotion') ? 1 : 0);
    assert.equal(h.timers.size, 0);
  });
}

test('late session completion after deadline cannot initiate a tracking POST', async t => {
  const h = harness(t);
  await h.start();
  await loaded(h);
  await h.expire();
  const prior = h.url();
  await h.response('/api/v1/session', {csrf_token: 'synthetic-csrf'});
  assert.equal(h.requests.filter(r => r.path === '/api/v1/promotion/links').length, 0);
  assert.equal(h.url(), prior);
});

test('late successful tracking cannot replace the already offered fallback', async t => {
  const h = harness(t);
  await h.start();
  await loaded(h);
  await h.response('/api/v1/session', {csrf_token: 'synthetic-csrf'});
  await h.expire();
  const prior = h.url();
  await h.response('/api/v1/promotion/links', {path: '/go/abcdefghij'});
  assert.equal(h.url(), prior);
  assert.ok(h.text().includes('這是一般連結'));
});

test('successful tracking binds selected intro query, Idempotency-Key, and tracked URL', async t => {
  const h = harness(t);
  await h.start();
  await loaded(h);
  await h.response('/api/v1/session', {csrf_token: 'synthetic-csrf'});
  await h.response('/api/v1/promotion/links', {path: '/go/abcdefghij'});
  await h.selectIntro(1);
  assert.equal(h.url(), origin + '/go/abcdefghij?intro=2');
  assert.ok(h.text().includes('有人點開，會記在你名下'));
  assert.equal(h.timers.size, 0);
  await h.click('複製連結');
  await flush();
  assert.equal(h.copies[0], '分享介紹二\n' + origin + '/go/abcdefghij?intro=2');
  assert.equal(h.request(introPath).options.credentials, 'omit');
  const post = h.request('/api/v1/promotion/links');
  assert.equal(post.options.method, 'POST');
  assert.ok(post.options.headers['Idempotency-Key']);
});

for (const action of ['close', 'book', 'parent', 'unmount']) {
  test(`${action} cancels outstanding requests and ignores their late results`, async t => {
    const h = harness(t);
    await h.start();
    await loaded(h);
    const session = h.request('/api/v1/session');
    if (action === 'close') await h.close();
    else if (action === 'book') h.render({bookId: 'editkin'});
    else if (action === 'parent') h.render({active: false});
    else h.unmount();
    await flush();
    assert.equal(session.options.signal.aborted, true);
    assert.equal(h.timers.size, 0);
    session.resolve({ok: true, json: async () => ({csrf_token: 'synthetic-csrf'})});
    await flush();
    assert.equal(h.requests.filter(r => r.path === '/api/v1/promotion/links').length, 0);
    assert.equal(h.copies.length, 0);
    assert.equal(h.shares.length, 0);
  });
}

test('published submission shares use the same bounded fallback and keep their own public destination', async t => {
  const h = harness(t);
  const submissionId = '17c80987-1d06-4eb3-9cc4-5cc03a4987ec';
  h.render({bookId: undefined, submissionId});
  await h.start();
  await anonymous(h);
  await h.expire();
  assert.equal(h.url(), origin + '/development/submissions/' + submissionId);
  await h.click('複製連結');
  await flush();
  assert.equal(h.copies[0], h.url());
});

test('an already cancelled public-content read never starts a network request or leaks a timer', async t => {
  const h = harness(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.skillShareMod.fetchSkillShareContent('social-post', controller.signal));
  assert.equal(h.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test('session, tracking request and tracking body share one unchanged deadline', async t => {
  const h = harness(t);
  await h.start();
  await loaded(h);
  const sessionTimer = [...h.timers.entries()].find(([, v]) => v.ms === 8000)?.[0]!;
  assert.equal(h.timers.size, 1);
  let finishSession!: (value: unknown) => void, finishTracking!: (value: unknown) => void;
  h.request('/api/v1/session').resolve({ok: true, json: () => new Promise(resolve => {finishSession = resolve;})});
  await flush();
  assert.deepEqual([...h.timers.keys()], [sessionTimer]);
  finishSession({csrf_token: 'synthetic-csrf'});
  await flush();
  assert.deepEqual([...h.timers.keys()], [sessionTimer]);
  h.request('/api/v1/promotion/links').resolve({ok: true, json: () => new Promise(resolve => {finishTracking = resolve;})});
  await flush();
  assert.deepEqual([...h.timers.keys()], [sessionTimer]);
  await h.expire();
  const fallback = h.url();
  finishTracking({path: '/go/abcdefghij'});
  await flush();
  assert.equal(h.url(), fallback);
  assert.equal(h.timers.size, 0);
});

for (const action of ['book', 'parent', 'unmount']) {
  test(`${action} before introduction resolves clears both deadlines and never opens the old preview`, async t => {
    const h = harness(t);
    await h.start();
    const intro = h.request(introPath), session = h.request('/api/v1/session');
    if (action === 'book') h.render({bookId: 'editkin'});
    else if (action === 'parent') h.render({active: false});
    else h.unmount();
    await flush();
    assert.equal(intro.options.signal.aborted, true);
    assert.equal(session.options.signal.aborted, true);
    assert.equal(h.timers.size, 0);
    intro.resolve({ok: true, json: async () => content});
    session.resolve({ok: true, json: async () => ({csrf_token: 'synthetic-csrf'})});
    await flush();
    assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
    assert.equal(h.requests.length, 2);
    assert.equal(h.copies.length, 0);
    assert.equal(h.shares.length, 0);
  });
}

const nodeFind = (root: any, predicate: (node: any) => boolean): any[] => {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(child => nodeFind(child, predicate));
  return [...(predicate(root) ? [root] : []), ...nodeFind(root.props?.children, predicate)];
};

for (const [file, signature, component, props] of [
  ['SkillBookIntro.tsx', 'export function SkillBookIntro', 'SkillBookIntro', {book: {id: 'social-post', title: '合成技能書', description: '合成用途', repository_url: 'https://example.test/source'}}],
  ['CommunitySkillBooks.tsx', 'function SubmissionIntro', 'SubmissionIntro', {item: {submission_id: '17c80987-1d06-4eb3-9cc4-5cc03a4987ec', title: '合成投稿', description: '合成用途', relationship: 'recommender', source: {repository_url: 'https://example.test/source', repository_full_name: 'example/source', license_spdx: 'MIT', commit_sha: ''}}}],
] as const) {
  test(`${component} retains its visited share child and propagates the parent reading state`, () => {
    const text = readFileSync(new URL('../../apps/portal-web/src/modules/' + file, import.meta.url), 'utf8');
    const start = text.indexOf(signature); assert.ok(start >= 0);
    const end = file === 'SkillBookIntro.tsx' ? text.indexOf('\n\n\n// Copy is', start) : text.length;
    const componentSource = text.slice(start, end).replace('export function SkillBookIntro', 'function SkillBookIntro');
    const hooks: any[] = [], refs = new Map<any, any>(); let index = 0;
    const react = {
      useState: (value: any) => {const i = index++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], (value: any) => hooks[i] = value];},
      useRef: (value: any) => {const i = index++; return hooks[i] ?? (hooks[i] = {current: value});},
      useId: () => 'intro', useEffect: () => {},
    };
    const jsx = (type: string, props: any) => {
      if (props?.ref) {
        if (!refs.has(props.ref)) refs.set(props.ref, {open: false, showModal() {this.open = true;}, close() {this.open = false;}, focus() {}});
        props.ref.current = refs.get(props.ref);
      }
      return {type, props};
    };
    const code = transformSync(componentSource + '\nexports.component=' + component + ';', {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code;
    const exports: any = {};
    runInNewContext(code, {
      exports, ...react, URL, AbortController,
      useSkillDiscovery: () => ({data: null}), httpsLink: (value: string | undefined) => value ?? null,
      submissionSharePath: () => '/development/submissions/test', skillSharePath: () => '/development/skills/social-post',
      isSkillIllustrationUrl: () => false, relationshipLabels: {}, client: {csrfToken: 'test'}, sessionClient: {csrfToken: 'test'}, isStorefrontReading: () => false,
      ...Object.fromEntries(['SkillShare', 'SkillBookBadges', 'SkillBookCover', 'SkillBookSourceAccount', 'SkillBookStar', 'EventOutcomeBacklinks', 'DevelopmentEntry', 'CommunityBadge', 'GitHubSourceLinks', 'SkillInstall', 'AuthorClaimPanel', 'StorefrontBookUsage'].map(name => [name, name])),
      require: () => ({jsx, jsxs: jsx}),
    });
    const render = () => {index = 0; return exports.component(props);};
    const nodes = () => nodeFind(render(), () => true);
    const shares = () => nodes().filter(n => n.type === 'SkillShare');
    assert.equal(shares().length, component === 'SkillBookIntro' ? 0 : 1);
    if (shares().length) assert.equal(shares()[0].props.active, false);
    nodes().find(n => n.type === 'button' && n.props['aria-haspopup'] === 'dialog')!.props.onClick();
    assert.equal(shares().length, 1); assert.equal(shares()[0].props.active, true);
    nodes().find(n => n.type === 'button' && n.props['aria-label'] === '關閉技能書介紹')!.props.onClick();
    assert.equal(shares().length, 1); assert.equal(shares()[0].props.active, false);
    nodes().find(n => n.type === 'button' && n.props['aria-haspopup'] === 'dialog')!.props.onClick();
    assert.equal(shares().length, 1); assert.equal(shares()[0].props.active, true);
  });
}

test('inactive parent removes closed dialog, blocks hidden loads and reopens with fresh work', async t => {
  const h = harness(t);
  const triggerId = idOf(h.button('分享技能'));
  await h.start();
  await anonymous(h);
  const old = h.request(introPath);
  const firstDialogId = idOf(h.all().find(n => n.nodeName === 'DIALOG'));
  assert.ok(firstDialogId > 0);
  h.render({active: false});
  await flush();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
  assert.equal(old.options.signal.aborted, true);
  assert.equal(propsOf(h.button('分享技能')!).disabled, true);
  const count = h.requests.length;
  propsOf(h.button('分享技能')!).onClick?.({preventDefault() {}});
  await flush();
  assert.equal(h.requests.length, count);
  old.resolve({ok: true, json: async () => ({...content, introductions: ['關閉後舊內容']})});
  await flush();
  await h.expire();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
  h.render({active: true});
  assert.equal(idOf(h.button('分享技能')), triggerId);
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
  await h.start();
  await anonymous(h);
  await loaded(h);
  const reopened = h.all().filter(n => n.nodeName === 'DIALOG');
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].open, true);
  assert.ok(!h.text().includes('關閉後舊內容'));
});

test('late timed-out introduction cannot replace a fresh reopened introduction', async t => {
  const h = harness(t);
  await h.start();
  await anonymous(h);
  const old = h.request(introPath);
  await h.expire();
  await h.close();
  await h.start();
  await anonymous(h);
  await h.response(introPath, {...content, introductions: ['新版介紹']});
  old.resolve({ok: true, json: async () => ({...content, introductions: ['舊版介紹']})});
  await flush();
  assert.ok(h.text().includes('新版介紹'));
  assert.ok(!h.text().includes('舊版介紹'));
  assert.equal(h.timers.size, 0);
});

test('dialog stays unmounted while closed across repeated inactive transitions', async t => {
  const h = harness(t);
  const triggerId = idOf(h.button('分享技能'));
  await h.start();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 1);
  for (let i = 0; i < 5; i++) {
    h.render({active: false});
    assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
    h.render({active: true});
    assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
    assert.equal(idOf(h.button('分享技能')), triggerId);
  }
  assert.equal(h.requests.length, 2);
});

test('closing a parent suppresses late clipboard feedback while retaining the unresolved capability lock', async t => {
  const h = harness(t);
  await h.start();
  await anonymous(h);
  await loaded(h);
  let finish!: () => void;
  navigatorState.clipboard.writeText = () => new Promise<void>(resolve => {finish = resolve;});
  await h.click('複製連結');
  await flush();
  h.render({active: false});
  h.render({active: true});
  await h.start();
  await anonymous(h);
  await loaded(h);
  assert.equal(propsOf(h.button('分享')!).disabled, true);
  finish();
  await flush();
  assert.ok(!h.text().includes('已複製'));
  assert.equal(propsOf(h.button('複製連結')!).disabled, false);
});

function shareButtonHarness(t: TestContext, initial: Record<string, any> = {}) {
  const h = harness(t);
  const cache = new Map<string, any>();
  const compileShare = (relative: string): any => {
    const file = path.resolve(base, relative);
    if (cache.has(file)) return cache.get(file);
    const mod = {exports: {} as any}; cache.set(file, mod.exports);
    const raw = readFileSync(file, 'utf8');
    runInNewContext(transformSync(raw, {loader: relative.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic'}).code, {
      module: mod, exports: mod.exports, crypto: webcrypto, Intl, URL, AbortController, console,
      window: windowObj, document, navigator: navigatorState, HTMLDetailsElement: HostDetailsElement,
      setTimeout, clearTimeout,
      fetch: () => Promise.reject(new Error('unexpected fetch')),
      require(name: string) {
        if (name === 'react') return React;
        if (name === 'react/jsx-runtime' || name === 'react-dom' || name === 'qrcode') return req(name);
        if (name === '../language') return {useLanguage: () => ({t: (k: string) => k})};
        if (name.endsWith('.css')) return {};
        if (name.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file), name);
          const target = [resolved, resolved + '.ts', resolved + '.tsx'].find(existsSync);
          assert.ok(target, `missing ${name}`);
          return compileShare(path.relative(base, target));
        }
        throw Error('Unexpected import: ' + name);
      },
    });
    cache.set(file, mod.exports);
    return mod.exports;
  };
  const {ShareButton} = compileShare('apps/portal-web/src/share/ShareButton.tsx');
  h.unmount();
  let unmounted = false;
  let props: any = {
    title: '統一分享標題',
    fallbackUrl: '/development/skills/social-post',
    introductions: ['介紹 A', '介紹 B'],
    label: '開啟分享',
    ...initial,
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  const render = (patch?: Record<string, any>) => {
    if (patch) props = {...props, ...patch};
    flushReact(() => root.render(React.createElement(ShareButton, props)));
  };
  const unmount = () => {
    if (!unmounted) {unmounted = true; flushReact(() => root.unmount()); container.parentNode?.removeChild(container);}
  };
  t.after(unmount);
  render();
  const all = () => descendants(document.body);
  const dialogs = () => all().filter(n => n.nodeName === 'DIALOG');
  const button = (label: string) => all().filter(n => n.nodeName === 'BUTTON' && (n.textContent === label || n.getAttribute('aria-label') === label)).at(-1);
  const click = async (label: string) => {
    const item = button(label);
    assert.ok(item, label);
    await React.act(async () => {await propsOf(item).onClick?.({preventDefault() {}, stopPropagation() {}});});
  };
  const selectIntro = async (idx: number) => {
    const radios = all().filter(n => n.nodeName === 'INPUT' && propsOf(n)?.type === 'radio');
    assert.ok(radios[idx], `missing radio ${idx}`);
    await React.act(async () => {propsOf(radios[idx]).onChange({target: {checked: true}});});
  };
  return {render, unmount, all, dialogs, button, click, selectIntro};
}

test('ShareButton unmount while closed never calls onClose', t => {
  let closes = 0;
  const s = shareButtonHarness(t, {onClose: () => {closes++;}});
  s.unmount();
  assert.equal(closes, 0);
});

for (const mode of ['button', 'escape', 'backdrop', 'parent-hidden', 'fallback-change', 'title-change', 'text-change', 'unmount'] as const) {
  test(`ShareButton close via ${mode} resets state, focuses trigger when present, and calls onClose once`, async t => {
    let staleCloses = 0, freshCloses = 0;
    const s = shareButtonHarness(t, {
      text: '初始文字',
      makeLink: async () => ({path: '/go/tracked123'}),
      onClose: () => {staleCloses++;},
    });
    const trigger = s.button('開啟分享')!;
    const triggerId = idOf(trigger);
    await s.click('開啟分享');
    await flush();
    assert.equal(s.dialogs().length, 1);

    await s.click('QR 碼');
    await s.selectIntro(0);
    navigatorState.clipboard.writeText = async () => {throw new Error('denied');};
    await s.click('複製連結');
    await flush();
    assert.equal(s.all().some(n => n.nodeName === 'SVG'), true);
    assert.equal(s.all().some(n => n.nodeName === 'TEXTAREA'), true);
    assert.equal(s.all().some(n => n.textContent.includes('請手動複製下面的內容')), true);
    assert.match(s.all().find(n => n.getAttribute('class') === 'skill-share-url')?.textContent ?? '', /\?intro=1$/);

    // Swap onClose while open so stale closure bugs on unmount/close are caught.
    s.render({onClose: () => {freshCloses++;}});
    document.activeElement = document.body;
    trigger.focused = false;

    const dialog = s.dialogs()[0];
    if (mode === 'button') {
      await s.click('關閉分享');
    } else if (mode === 'escape') {
      await React.act(async () => {
        propsOf(dialog).onCancel({target: dialog, currentTarget: dialog, preventDefault() {}, stopPropagation() {}});
      });
    } else if (mode === 'backdrop') {
      await React.act(async () => {
        propsOf(dialog).onClick({target: dialog, currentTarget: dialog, clientX: 150, clientY: 150, stopPropagation() {}});
      });
      assert.equal(s.dialogs().length, 1, 'padding click inside dialog box must not close');
      await React.act(async () => {
        propsOf(dialog).onClick({target: dialog, currentTarget: dialog, clientX: 10, clientY: 10, stopPropagation() {}});
      });
    } else if (mode === 'parent-hidden') {
      s.render({disabled: true});
    } else if (mode === 'fallback-change') {
      s.render({fallbackUrl: '/development/skills/editkin'});
    } else if (mode === 'title-change') {
      s.render({title: '新分享標題'});
    } else if (mode === 'text-change') {
      s.render({text: '新文字'});
    } else if (mode === 'unmount') {
      s.unmount();
    }
    await flush();

    assert.equal(s.dialogs().length, 0);
    assert.equal(staleCloses, 0);
    assert.equal(freshCloses, 1);

    if (mode === 'button' || mode === 'escape' || mode === 'backdrop' || mode === 'fallback-change' || mode === 'title-change' || mode === 'text-change') {
      assert.equal(idOf(document.activeElement), triggerId);
    } else if (mode === 'unmount') {
      assert.notEqual(idOf(document.activeElement), triggerId);
    } else if (mode === 'parent-hidden') {
      assert.notEqual(idOf(document.activeElement), triggerId);
      s.render({disabled: false});
    }

    if (mode !== 'unmount') {
      await s.click('開啟分享');
      await flush();
      assert.equal(s.dialogs().length, 1);
      assert.equal(s.all().some(n => n.nodeName === 'SVG'), false);
      assert.equal(s.all().some(n => n.nodeName === 'TEXTAREA'), false);
      assert.equal(s.all().some(n => n.textContent.includes('請手動複製下面的內容')), false);
      assert.doesNotMatch(s.all().find(n => n.getAttribute('class') === 'skill-share-url')?.textContent ?? '', /\?intro=/);
      await s.click('關閉分享');
      await flush();
      assert.equal(freshCloses, 2);
    }
  });
}
