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
  closest() {return null;}
  focus() {}
  remove() {this.parentNode?.removeChild(this);}
}

class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null); this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
  }
  createElement(name: string) {return new HostNode(1, name.toUpperCase(), this);}
  createElementNS(_ns: string, name: string) {return this.createElement(name);}
  createTextNode(value: string) {const node = new HostNode(3, '#text', this); node.nodeValue = value; return node;}
}

const document = new HostDocument();
const windowObj = {
  location: {origin: 'https://workshop.example.test'},
  document, HTMLElement: HostNode, HTMLDetailsElement: HostNode, HTMLIFrameElement: class {},
  addEventListener() {}, removeEventListener() {},
};
document.defaultView = windowObj;
Object.assign(globalThis, {
  document, window: windowObj, HTMLElement: HostNode, HTMLDetailsElement: HostNode, HTMLIFrameElement: class {}, Node: HostNode,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const req = createRequire(import.meta.url);
const {createRoot} = req('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = req('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));
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
    window: windowObj, document, navigator: {clipboard: {writeText: async () => {}}},
    setTimeout, clearTimeout, console,
    require(name: string) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime' || name === 'react-dom' || name === 'qrcode') return req(name);
      if (name === '../portal-session') return {describeError: (e: any) => ({message: String(e?.message ?? e)})};
      if (name === '../language') return {useLanguage: () => ({t: (k: string) => k})};
      if (name === './ShareButton') {
        return {
          promotionLink: () => async () => ({path: '/go/test'}),
          ShareButton: ({label, buttonClassName}: {label?: string; buttonClassName?: string}) =>
            React.createElement('div', {className: 'skill-share promotion-share'},
              React.createElement('button', {type: 'button', className: buttonClassName}, label ?? '分享')),
        };
      }
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

const cache = new Map<string, any>();
const {MyCredit} = compile('apps/portal-web/src/share/MyCredit.tsx', cache);
const {installShareComposer} = compile('apps/portal-web/src/share/share-port.ts', cache);

async function mountCredit(t: TestContext, items: any[], next_offset: number | null = null) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as any);
  t.after(() => {flush(() => root.unmount()); container.remove();});
  const client: any = {
    sessionGeneration: 1,
    get: async () => ({items, next_offset}),
  };
  await React.act(async () => {
    flushSync(() => root.render(React.createElement(MyCredit, {client})));
  });
  await React.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {container};
}

function makeItem(i: number) {
  return {
    key: `share:${i}`, kind: 'repository', title: `repo-${i}`, available: true,
    link: {kind: 'repository', target: `id-${i}`, path: `/go/r${i}`},
    open_path: `#shares/00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`,
    clicks: i, stars: 0, registrations: 0, last_at: '2026-11-14T00:00:00Z',
  };
}

test('UX-G-08: populated MyCredit puts items before 交給我的 Agent, caps at 20 with 更多, and uses compact 再分享', async (t) => {
  const items = Array.from({length: 22}, (_, i) => makeItem(i + 1));
  const {container} = await mountCredit(t, items, null);

  const allNodes = descendants(container);
  const cards = allNodes.filter(n => n.tagName === 'ARTICLE' && (n.getAttribute('class') ?? '').includes('share-result-card'));
  assert.equal(cards.length, 20);

  const buttons = allNodes.filter(n => n.tagName === 'BUTTON');
  const primaryButtons = buttons.filter(b => (b.getAttribute('class') ?? '').split(/\s+/).includes('btn-primary'));
  assert.equal(primaryButtons.length, 0);

  const reshareBtn = buttons.find(b => b.textContent === '再分享');
  assert.ok(reshareBtn);
  assert.equal((reshareBtn!.getAttribute('class') ?? '').includes('btn-small'), true);

  const moreBtn = buttons.find(b => b.textContent === '更多');
  assert.ok(moreBtn);

  const agentBtn = buttons.find(b => b.textContent === '交給我的 Agent');
  assert.ok(agentBtn);

  const firstCardIdx = allNodes.indexOf(cards[0]);
  const agentIdx = allNodes.indexOf(agentBtn!);
  assert.equal(firstCardIdx >= 0 && agentIdx > firstCardIdx, true);

  flush(() => propsOf(moreBtn!).onClick());
  const cardsAfter = descendants(container).filter(n => n.tagName === 'ARTICLE' && (n.getAttribute('class') ?? '').includes('share-result-card'));
  assert.equal(cardsAfter.length, 22);
});

test('UX-G-08: empty MyCredit shows short text, one primary 分享 opening composer, and 交給我的 Agent last', async (t) => {
  let composeCalls = 0;
  const uninstall = installShareComposer((_req: unknown, finish: (result: {status: string}) => void) => {
    composeCalls++;
    finish({status: 'cancelled'});
  });
  t.after(uninstall);

  const {container} = await mountCredit(t, [], null);

  const allNodes = descendants(container);
  const paragraphs = allNodes.filter(n => n.tagName === 'P').map(n => n.textContent.trim());
  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].length <= 24, true);

  const buttons = allNodes.filter(n => n.tagName === 'BUTTON');
  const primaryButtons = buttons.filter(b => (b.getAttribute('class') ?? '').split(/\s+/).includes('btn-primary'));
  assert.equal(primaryButtons.length, 1);
  assert.equal(primaryButtons[0].textContent, '分享');

  const agentBtn = buttons.find(b => b.textContent === '交給我的 Agent');
  assert.ok(agentBtn);
  assert.equal(allNodes.indexOf(agentBtn!) > allNodes.indexOf(primaryButtons[0]), true);

  await React.act(async () => {propsOf(primaryButtons[0]).onClick();});
  assert.equal(composeCalls, 1);
});

test('UX-G-08: share.css keeps 再分享 compact on mobile and sets 44px tap targets', () => {
  const css = readFileSync(path.resolve(base, 'apps/portal-web/src/share/share.css'), 'utf8');
  const tsx = readFileSync(path.resolve(base, 'apps/portal-web/src/share/MyCredit.tsx'), 'utf8');
  assert.equal(tsx.includes("import './share.css'"), true);
  assert.equal(/\.share-result-row\s*>\s*\.skill-share[\s\S]*width:\s*auto/.test(css), true);
  assert.equal(/a\.share-result-title[\s\S]*min-height:\s*44px/.test(css), true);
  assert.equal(/\.legacy-promotion\s*>\s*summary[\s\S]*min-height:\s*44px/.test(css), true);
});
