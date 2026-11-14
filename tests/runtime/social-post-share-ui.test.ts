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
import {ApiError} from '../../apps/portal-web/src/api';

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
  createElement(name: string) {
    return name.toUpperCase() === 'DETAILS'
      ? new HostDetailsElement(1, 'DETAILS', this)
      : new HostNode(1, name.toUpperCase(), this);
  }
  createElementNS(namespace: string, name: string) {const node = this.createElement(name); node.namespaceURI = namespace; return node;}
  createTextNode(value: string) {const node = new HostNode(3, '#text', this); node.nodeValue = value; return node;}
}

const document = new HostDocument();
const navigatorState: {share: (data: any) => Promise<void>; clipboard: {writeText: (url: string) => Promise<void>}} = {
  share: async () => {},
  clipboard: {writeText: async () => {}},
};
const windowObj = {
  location: {origin: 'https://workshop.example.test'},
  open() {throw Error('No external navigation permitted');},
  document, HTMLElement: HostNode, HTMLDetailsElement: HostDetailsElement, HTMLIFrameElement: class {},
  addEventListener() {}, removeEventListener() {}, get event() {return undefined;},
};
document.defaultView = windowObj;
Object.assign(globalThis, {
  document, window: windowObj,
  HTMLElement: HostNode, HTMLDetailsElement: HostDetailsElement, Node: HostNode,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const req = createRequire(import.meta.url);
const {createRoot} = req('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = req('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));

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

function compile(relative: string, cache = new Map<string, any>()): any {
  const file = path.resolve(base, relative);
  if (cache.has(file)) return cache.get(file);
  const mod = {exports: {} as any};
  cache.set(file, mod.exports);
  const raw = readFileSync(file, 'utf8');
  runInNewContext(transformSync(raw, {loader: relative.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic'}).code, {
    module: mod, exports: mod.exports, crypto: webcrypto, Intl, URL, AbortController,
    window: windowObj, document, navigator: navigatorState, HTMLDetailsElement: HostDetailsElement, setTimeout, clearTimeout, console,
    require(name: string) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime' || name === 'react-dom' || name === 'qrcode') return req(name);
      if (name === '../api') return {ApiError};
      if (name === '../portal-session') return {describeError: (e: any) => ({message: e.message})};
      if (name === '../language') return {useLanguage: () => ({t: (k: string) => k})};
      if (name === './SocialTools') return {SocialIcon: () => null};
      if (name.endsWith('.css')) return {};
      if (name.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), name);
        const target = [resolved, resolved + '.ts', resolved + '.tsx'].find(existsSync);
        assert.ok(target, `missing ${name}`);
        return compile(path.relative(base, target), cache);
      }
      throw Error('Unexpected import: ' + name);
    },
  });
  cache.set(file, mod.exports);
  return mod.exports;
}

const {SocialPostShare} = compile('apps/portal-web/src/modules/SocialPostShare.tsx');

function harness(t: TestContext, mine = true) {
  const reads: any[] = [], writes: any[] = [], copies: string[] = [], shares: any[] = [];
  navigatorState.clipboard.writeText = async (url: string) => {copies.push(url);};
  navigatorState.share = async (data: any) => {shares.push(data); throw Object.assign(new Error('cancel'), {name: 'AbortError'});};
  const client: any = {
    sessionGeneration: 1,
    get: (p: string) => new Promise((resolve, reject) => reads.push({path: p, resolve, reject})),
    post: (p: string, body: unknown, options: unknown) => new Promise((resolve, reject) => writes.push({path: p, body, options, resolve, reject})),
  };
  let currentProps: any = {client, post: {post_id: 'post-a', mine, kind: 'note', revision: 1, note: '完整私人正文', author: {display_name: '作者'}}};
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  const render = (patch?: Partial<typeof currentProps>) => {
    if (patch) currentProps = {...currentProps, ...patch};
    flush(() => root.render(React.createElement(SocialPostShare, currentProps)));
  };
  let unmounted = false;
  const unmount = () => {
    if (unmounted) return;
    unmounted = true;
    flush(() => root.unmount());
    container.parentNode?.removeChild(container);
  };
  t.after(unmount);
  render();
  const all = () => descendants(document.body);
  const matchesLabel = (n: HostNode, label: string) =>
    n.nodeName === 'BUTTON' && (n.getAttribute('aria-label') === label || (!n.getAttribute('aria-label') && n.textContent === label));
  const button = (label: string) => all().find(n => matchesLabel(n, label));
  const click = async (label: string) => {
    const target = all().filter(n => matchesLabel(n, label)).at(-1);
    assert.ok(target, `missing button ${label}`);
    assert.ok(!propsOf(target).disabled, `${label} disabled`);
    await React.act(async () => {await propsOf(target).onClick?.({preventDefault() {}, stopPropagation() {}});});
  };
  const settle = () => React.act(async () => {await new Promise(resolve => setImmediate(resolve));});
  const state = {enabled: false, available: false, post_revision: 1, media_version: '1', version: '1', public_path: null, image_url: null};
  const open = async () => {
    await click('分享貼文連結');
    if (mine) reads.at(-1).resolve(state);
    else reads.at(-1).reject(new ApiError({status: 404, message: 'not_found'}));
    await settle();
  };
  return {client, currentProps: () => currentProps, reads, writes, copies, shares, render, unmount, all, button, click, open, settle, state, navigatorState};
}

test('restricted link is directly shareable/copyable inside one dialog; consent is folded and neither action publishes', async t => {
  const h = harness(t);
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
  await h.open();
  const nodes = h.all();
  assert.equal(nodes.filter(n => n.nodeName === 'DIALOG').length, 1);
  const consent = nodes.find(n => n.getAttribute('class') === 'social-sharing-consent')!;
  assert.equal(consent.open, false);
  const shareAction = h.button('分享')!;
  assert.equal(shareAction.getAttribute('aria-haspopup'), null);
  assert.ok(nodes.indexOf(shareAction) < nodes.indexOf(consent));
  assert.match(nodes.find(n => n.getAttribute('class') === 'skill-share-url')?.textContent ?? '', /\?social-post=post-a#social$/);
  await h.click('複製連結');
  await h.settle();
  assert.match(h.copies[0], /\?social-post=post-a#social$/);
  await h.click('分享');
  await h.settle();
  assert.equal(h.shares.length, 1);
  assert.equal(h.writes.length, 0);
});

test('clipboard denial opens/selects fallback and one Escape or close removes dialog and returns focus without publishing', async t => {
  const h = harness(t);
  await h.open();
  navigatorState.clipboard.writeText = async () => {throw Error('denied');};
  await h.click('複製連結');
  await h.settle();
  const field = h.all().find(n => n.nodeName === 'TEXTAREA')!;
  assert.ok(field, 'manual copy textarea rendered');
  assert.equal(field.focused, true);
  assert.equal(field.selected, true);
  const dialog = h.all().find(n => n.nodeName === 'DIALOG')!;
  await React.act(async () => {
    propsOf(dialog).onCancel({target: dialog, currentTarget: dialog, preventDefault() {}, stopPropagation() {}});
  });
  await h.settle();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
  assert.equal(h.button('分享貼文連結')!.focused, true);
  assert.equal(h.writes.length, 0);

  await h.open();
  assert.equal(h.all().some(n => n.nodeName === 'TEXTAREA'), false);
  await h.click('關閉分享');
  await h.settle();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
  assert.equal(h.button('分享貼文連結')!.focused, true);
});

test('non-owner never receives publication controls and shares directly in one dialog', async t => {
  const h = harness(t, false);
  await h.open();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 1);
  assert.equal(h.button('開放免登入閱讀'), undefined);
  await h.click('複製連結');
  await h.settle();
  assert.match(h.copies[0], /\?social-post=post-a#social$/);
  assert.equal(h.writes.length, 0);
});

test('unknown publication keeps same tuple and disabled sharing; successful retry reveals tracked URL in one dialog', async t => {
  const h = harness(t);
  await h.open();
  await h.click('開放免登入閱讀');
  assert.equal(propsOf(h.button('複製連結')!).disabled, true);
  assert.equal(propsOf(h.button('分享')!).disabled, true);
  const first = h.writes[0];
  first.resolve({});
  await h.settle();
  assert.equal(h.all().find(n => n.getAttribute('class') === 'social-sharing-consent')!.open, true);
  assert.equal(propsOf(h.button('複製連結')!).disabled, true);
  assert.equal(propsOf(h.button('分享')!).disabled, true);
  await h.click('確認上次設定');
  assert.deepEqual(h.writes[1].body, first.body);
  assert.deepEqual(h.writes[1].options, first.options);
  h.writes[1].resolve({...h.state, enabled: true, available: true, version: '2', public_path: '/posts/post-a'});
  await h.settle();
  assert.equal(h.writes.at(-1).path, '/promotion/links');
  h.writes.at(-1).resolve({path: '/go/note123456'});
  await h.settle();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 1);
  await h.click('複製連結');
  await h.settle();
  assert.equal(h.copies.at(-1), 'https://workshop.example.test/go/note123456');

  await h.click('關閉免登入閱讀');
  h.writes.at(-1).resolve({...h.state, enabled: false, available: false, version: '3', public_path: null});
  await h.settle();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 1);
  assert.match(h.all().find(n => n.getAttribute('class') === 'skill-share-url')?.textContent ?? '', /\?social-post=post-a#social$/);
});

for (const change of ['session', 'post', 'client']) {
  test(`late publication acknowledgement cannot alter replacement ${change}`, async t => {
    const h = harness(t);
    await h.open();
    await h.click('開放免登入閱讀');
    if (change === 'session') {h.client.sessionGeneration++; h.render();}
    if (change === 'post') h.render({post: {...h.currentProps().post, post_id: 'post-b'}});
    if (change === 'client') h.render({client: {...h.client}});
    h.writes[0].resolve({...h.state, enabled: true, available: true, version: '2', public_path: '/posts/post-a'});
    await h.settle();
    if (change === 'session') {
      await h.open().catch(() => {});
    } else {
      h.reads.at(-1).resolve({...h.state, post_revision: h.currentProps().post.revision});
      await h.settle();
    }
    assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 1);
    const urlText = h.all().find(n => n.getAttribute('class') === 'skill-share-url')?.textContent ?? '';
    assert.equal(urlText.includes('/posts/post-a'), false);
  });
}

test('unreviewed media and stale revision remain disabled instead of bypassing consent', async t => {
  for (const state of [{image_url: '/api/v1/social-posts/post-a/thumbnail?v=1'}, {post_revision: 2}]) {
    const h = harness(t);
    await h.click('分享貼文連結');
    h.reads[0].resolve({...h.state, ...state});
    await h.settle();
    const publishBtn = h.button('開放免登入閱讀')!;
    assert.equal(propsOf(publishBtn).disabled, true);
    assert.equal(h.writes.length, 0);
  }
});

test('link post opens one dialog with tracked link and QR code; backdrop and unmount close cleanly', async t => {
  const h = harness(t);
  h.render({post: {post_id: 'post-link', mine: true, kind: 'link', title: '推薦工具', revision: 1, note: '補充說明', author: {display_name: '作者'}}});
  await h.open();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 1);
  assert.equal(h.writes.at(-1).path, '/promotion/links');
  h.writes.at(-1).resolve({path: '/go/link123456'});
  await h.settle();
  assert.equal(h.all().find(n => n.getAttribute('class') === 'skill-share-url')?.textContent, 'https://workshop.example.test/go/link123456');
  await h.click('QR 碼');
  assert.equal(h.all().some(n => n.getAttribute('aria-label') === '分享連結的 QR Code'), true);

  const dialog = h.all().find(n => n.nodeName === 'DIALOG')!;
  await React.act(async () => {
    propsOf(dialog).onClick({target: dialog, currentTarget: dialog, clientX: 10, clientY: 10, stopPropagation() {}});
  });
  await h.settle();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
  assert.equal(h.button('分享貼文連結')!.focused, true);

  h.button('分享貼文連結')!.focused = false;
  await h.open();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 1);
  h.unmount();
  assert.equal(h.all().filter(n => n.nodeName === 'DIALOG').length, 0);
  assert.equal(h.button('分享貼文連結'), undefined);
});

test('stale promotion link ack after post replacement or close cannot overwrite replacement URL', async t => {
  const h = harness(t);
  h.render({post: {post_id: 'post-link-a', mine: true, kind: 'link', title: '舊連結', revision: 1, author: {display_name: '作者'}}});
  await h.open();
  const staleWrite = h.writes.at(-1);
  assert.equal(staleWrite.path, '/promotion/links');
  h.render({post: {post_id: 'post-link-b', mine: false, kind: 'note', revision: 1, note: '新貼文', author: {display_name: '作者'}}});
  staleWrite.resolve({path: '/go/staleold12'});
  h.reads.at(-1).reject(new ApiError({status: 404, message: 'not_found'}));
  await h.settle();
  assert.match(h.all().find(n => n.getAttribute('class') === 'skill-share-url')?.textContent ?? '', /\?social-post=post-link-b#social$/);
});
