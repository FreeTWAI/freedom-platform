import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {act, createElement} from 'react';
import {PortalClient} from '../../apps/portal-web/src/api.js';
import type {GuildSummary} from '../../apps/portal-web/src/modules/Onboarding.js';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return {format: 'module', source: '', shortCircuit: true};
    return nextLoad(url, context);
  },
});

class HostNode {
  childNodes: HostNode[] = [];
  parentNode: HostNode | null = null;
  attributes: Record<string, string> = {};
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  listeners: Record<string, Function[]> = {};
  ownerDocument: any;
  checked = false;
  disabled = false;
  open = false;
  value = '';
  nodeValue = '';
  constructor(public nodeType: number, public nodeName: string, text = '', owner?: any) {
    this.nodeValue = text;
    this.ownerDocument = owner ?? null;
  }
  get tagName() { return this.nodeName; }
  appendChild(node: HostNode) {
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  removeChild(node: HostNode) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) {
      this.childNodes.splice(i, 1);
      node.parentNode = null;
    }
    return node;
  }
  insertBefore(node: HostNode, before: HostNode | null) {
    if (!before) return this.appendChild(node);
    node.parentNode?.removeChild(node);
    const i = this.childNodes.indexOf(before);
    this.childNodes.splice(i >= 0 ? i : this.childNodes.length, 0, node);
    node.parentNode = this;
    return node;
  }
  setAttribute(key: string, value: string) { this.attributes[key] = String(value); }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  removeAttribute(key: string) { delete this.attributes[key]; }
  addEventListener(type: string, fn: Function) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: Function) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(item => item !== fn);
  }
  dispatchEvent(event: any) {
    for (const fn of this.listeners[event.type] ?? []) fn(event);
    return true;
  }
  focus() {}
  get firstChild(): HostNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): HostNode | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): HostNode | null {
    if (!this.parentNode) return null;
    return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;
  }
  get textContent(): string {
    return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join('');
  }
  set textContent(v: string) {
    this.childNodes = v ? [new HostNode(3, '#text', String(v), this.ownerDocument)] : [];
  }
  get className() { return this.attributes.class ?? ''; }
  set className(v: string) { this.attributes.class = v; }
  get type() { return this.attributes.type ?? ''; }
  set type(v: string) { this.attributes.type = String(v); }
  get options() { return this.childNodes.filter(c => c.nodeName === 'OPTION'); }
  get htmlFor() { return this.attributes.for ?? ''; }
  set htmlFor(v: string) { this.attributes.for = v; }
  get tabIndex() { return Number(this.attributes.tabindex ?? 0); }
  set tabIndex(v: number) { this.attributes.tabindex = String(v); }
  contains(other: HostNode | null): boolean {
    if (!other) return false;
    if (other === this) return true;
    return this.childNodes.some(child => child.contains(other));
  }
}

function installDom() {
  const listeners: Record<string, Function[]> = {};
  const doc: any = {
    visibilityState: 'visible',
    documentElement: new HostNode(1, 'HTML'),
    head: new HostNode(1, 'HEAD'),
    body: new HostNode(1, 'BODY'),
    activeElement: null,
    createElement: (tag: string) => new HostNode(1, tag.toUpperCase(), '', doc),
    createElementNS: (_ns: string, tag: string) => new HostNode(1, tag.toUpperCase(), '', doc),
    createTextNode: (text: string) => new HostNode(3, '#text', text, doc),
    createComment: (text: string) => new HostNode(8, '#comment', text, doc),
    addEventListener: (t: string, fn: Function) => (listeners[t] ??= []).push(fn),
    removeEventListener: (t: string, fn: Function) => {
      listeners[t] = (listeners[t] ?? []).filter(x => x !== fn);
    },
  };
  doc.documentElement.ownerDocument = doc;
  doc.body.ownerDocument = doc;
  doc.activeElement = doc.body;
  doc.defaultView = globalThis;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).document = doc;
  (globalThis as any).window = {
    addEventListener: (t: string, fn: Function) => (listeners[t] ??= []).push(fn),
    removeEventListener: (t: string, fn: Function) => {
      listeners[t] = (listeners[t] ?? []).filter(x => x !== fn);
    },
    dispatchEvent: () => true,
    matchMedia: () => ({matches: false, addEventListener: () => {}, removeEventListener: () => {}}),
  };
  (globalThis as any).Element = HostNode;
  (globalThis as any).HTMLElement = HostNode;
  (globalThis as any).HTMLIFrameElement = class {};
  (globalThis as any).HTMLInputElement = HostNode;
  (globalThis as any).SVGElement = HostNode;
  (globalThis as any).Node = HostNode;
  (globalThis as any).localStorage = {getItem: () => null, setItem: () => {}, removeItem: () => {}};
  return doc;
}

function findAll(root: HostNode, pred: (n: HostNode) => boolean, out: HostNode[] = []): HostNode[] {
  if (pred(root)) out.push(root);
  for (const child of root.childNodes) findAll(child, pred, out);
  return out;
}

function serialize(node: HostNode): string {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType === 8) return '';
  const attrs = Object.entries(node.attributes).map(([k, v]) => ` ${k}="${v}"`).join('');
  return `<${node.nodeName.toLowerCase()}${attrs}>${node.childNodes.map(serialize).join('')}</${node.nodeName.toLowerCase()}>`;
}

const doc = installDom();
const {createRoot} = await import('react-dom/client');
const {QuickStart} = await import('../../apps/portal-web/src/modules/QuickStart.js');
const {WelcomePreview} = await import('../../apps/portal-web/src/modules/WelcomePreview.js');

function makeGuild(index: number): GuildSummary {
  return {
    guild_key: `guild_rec_${index}`,
    name: `推薦公會 ${index}`,
    purpose: `用途說明 ${index}`,
    first_step: '第一步',
    track_count: 1,
    guild_master: null,
    is_primary: false,
    skill_books: [],
    membership: null,
    tags: ['technology'],
    entry_questions: {
      version: 'v1',
      sha256: 'abc',
      questions: [{id: 'q1', prompt: '題目', options: [{id: 'o1', label: '選項'}]}],
    },
  };
}

test('UX-V-04: WelcomePreview fires no notification request and omits bell, preview grid, and community links', async () => {
  const requestedPaths: string[] = [];
  const client = new PortalClient();
  client.get = (async (path: string) => {
    requestedPaths.push(path);
    if (path === '/guilds/directory') return {items: [makeGuild(1)]};
    return {items: [], skill_books: [], unread_count: 0};
  }) as any;

  const container = doc.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(WelcomePreview, {
      client,
      name: '新夥伴',
      onStart: () => {},
      onCompleted: () => {},
      onLogout: () => {},
    }));
  });
  await act(async () => { await Promise.resolve(); });

  const html = serialize(container);
  assert.equal(requestedPaths.some(p => p.includes('notifications')), false, `unexpected notification requests: ${requestedPaths.join(',')}`);
  assert.equal(html.includes('notification-bell'), false);
  assert.equal(html.includes('welcome-preview-grid'), false);
  assert.equal(html.includes('community-links'), false);
  assert.equal(html.includes('Discord'), false);

  await act(async () => { root.unmount(); });
});

test('UX-V-04: QuickStart shows 4 recommended guilds + 查看全部公會 expander, primary CTA below radios, filters behind 篩選', async () => {
  const guilds = Array.from({length: 6}, (_, index) => makeGuild(index + 1));
  const container = doc.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(QuickStart, {
      client: new PortalClient(),
      onCompleted: () => {},
      directory: {items: guilds, loading: false, error: '', reload: () => {}},
    }));
  });

  const radiosBefore = findAll(container, n => n.nodeName === 'INPUT' && n.getAttribute('type') === 'radio');
  assert.equal(radiosBefore.length, 4);

  const html = serialize(container);
  assert.equal(html.includes('>篩選</summary>'), true);
  assert.ok(html.indexOf('quick-filter-disclosure') !== -1 && html.indexOf('quick-filter-disclosure') < html.indexOf('guild-topic-filter'));
  assert.ok(html.indexOf('quick-guild-options') < html.indexOf('quick-join-actions'));

  const showAllBtn = findAll(container, n => n.nodeName === 'BUTTON' && n.textContent.includes('查看全部公會'))[0];
  assert.ok(showAllBtn, 'expected 查看全部公會 button');

  const clickHandlers = (showAllBtn as any)[Object.keys(showAllBtn).find(k => k.startsWith('__reactProps$'))!];
  await act(async () => {
    clickHandlers.onClick({type: 'click', preventDefault: () => {}});
  });

  const radiosAfter = findAll(container, n => n.nodeName === 'INPUT' && n.getAttribute('type') === 'radio');
  assert.equal(radiosAfter.length, 6);

  await act(async () => { root.unmount(); });
});

test('WelcomePreview rejects malformed guild directory rows and shows retryable directory error', async () => {
  for (const bad of [
    null,
    {...makeGuild(1), guild_key: ''},
    {...makeGuild(1), name: {unexpected: 'object'}},
    {...makeGuild(1), purpose: {unexpected: 'object'}},
    {...makeGuild(1), tags: 'not-an-array'},
    {...makeGuild(1), skill_books: null},
  ]) {
    const client = new PortalClient();
    client.get = (async () => ({items: [bad, makeGuild(2)]})) as any;
    const container = doc.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(WelcomePreview, {
        client,
        name: '新夥伴',
        onStart: () => {},
        onCompleted: () => {},
        onLogout: () => {},
      }));
    });
    await act(async () => { await Promise.resolve(); });
    const html = serialize(container);
    assert.equal(html.includes('重讀公會'), true, `expected retry button for malformed row: ${JSON.stringify(bad)}`);
    assert.equal(html.includes('推薦公會 2'), false);
    await act(async () => { root.unmount(); });
  }
});
