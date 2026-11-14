import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import React from 'react';

class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, any> = { setProperty() {}, removeProperty() {} };
  listeners: Record<string, { fn: Function; capture: boolean }[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
    if (nodeName === 'DIALOG') this.open = false;
  }
  appendChild(node: HostNode) {
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  removeChild(node: HostNode) {
    const index = this.childNodes.indexOf(node);
    assert.notEqual(index, -1);
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  insertBefore(node: HostNode, before: HostNode) {
    node.parentNode?.removeChild(node);
    const index = this.childNodes.indexOf(before);
    assert.notEqual(index, -1);
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }
  setAttribute(key: string, value: unknown) { this.attributes[key] = String(value); }
  removeAttribute(key: string) { delete this.attributes[key]; }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  setAttributeNS(_ns: string, key: string, value: unknown) { this.setAttribute(key, value); }
  addEventListener(type: string, fn: Function, options?: any) {
    (this.listeners[type] ??= []).push({ fn, capture: options === true || !!options?.capture });
  }
  removeEventListener(type: string, fn: Function) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(item => item.fn !== fn);
  }
  hasAttribute(key: string) { return Object.hasOwn(this.attributes, key); }
  get firstChild(): HostNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): HostNode | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): HostNode | null {
    return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;
  }
  get textContent(): string {
    return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join('');
  }
  set textContent(value: string) {
    this.childNodes.forEach(n => { n.parentNode = null; });
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
  contains(node: HostNode): boolean {
    return node === this || this.childNodes.some(child => child.contains(node));
  }
  closest() { return null; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  select() {}
}

class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null);
    this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this);
    this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }
  createElement(name: string) { return new HostNode(1, name.toUpperCase(), this); }
  createElementNS(ns: string, name: string) {
    const node = this.createElement(name);
    node.namespaceURI = ns;
    return node;
  }
  createTextNode(value: string) {
    const node = new HostNode(3, '#text', this);
    node.nodeValue = value;
    return node;
  }
  getElementById(id: string) {
    return descendants(this).find(node => node.attributes.id === id) ?? null;
  }
}

const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];
const document = new HostDocument();
const window: any = {
  location: { origin: 'https://fixture.invalid', pathname: '/', search: '', hash: '#explore/events' },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  open() { throw Error('No external navigation permitted'); },
  document,
  HTMLElement: HostNode,
  HTMLIFrameElement: class {},
  listeners: {} as Record<string, Function[]>,
  addEventListener(type: string, fn: Function) { (this.listeners[type] ??= []).push(fn); },
  removeEventListener(type: string, fn: Function) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((x: Function) => x !== fn);
  },
  dispatchEvent(e: any) {
    for (const fn of [...(this.listeners[e.type] ?? [])]) fn(e);
    return true;
  },
};
document.defaultView = window;
document.visibilityState = 'visible';
Object.assign(globalThis, { document, window, HTMLElement: HostNode, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true });

const require = createRequire(import.meta.url);
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
const { flushSync } = require('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));

const noNetwork = () => { throw Error('Real network forbidden'); };
const bundled = buildSync({
  stdin: {
    contents: `export {EventsPanel} from './apps/portal-web/src/modules/EventsPanel';`,
    resolveDir: process.cwd(),
    sourcefile: 'event-card-actions-entry.ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  supported: { 'dynamic-import': false },
});

const mod = { exports: {} as any };
runInNewContext(bundled.outputFiles[0].text, {
  module: mod,
  exports: mod.exports,
  crypto: webcrypto,
  Intl,
  URL,
  URLSearchParams,
  AbortController,
  Error,
  Event,
  CustomEvent: class { constructor(public type: string) {} },
  Blob,
  console,
  window,
  document,
  navigator: { language: 'zh-TW', languages: ['zh-TW'], clipboard: { writeText: noNetwork }, share: noNetwork },
  fetch: noNetwork,
  localStorage: { getItem() { return null; }, setItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {} },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  require(name: string) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime' || name === 'react-dom' || name === 'qrcode' || name === 'zod') return require(name);
    throw Error('Unexpected external import: ' + name);
  },
});

const { EventsPanel } = mod.exports;
const VIEWER = '30000000-0000-4000-8000-000000000001';
const ORGANIZER = '30000000-0000-4000-8000-000000000002';

function makeEvent(id: string, title: string, overrides: Record<string, unknown>) {
  const day = 86_400_000;
  return {
    event_id: id,
    title,
    description: `說明 ${title}`,
    starts_at: new Date(Date.now() + day).toISOString(),
    ends_at: new Date(Date.now() + 2 * day).toISOString(),
    mode: 'online',
    location: '線上會議室',
    event_kind: 'meetup',
    topic: null,
    online_url: null,
    visibility: 'workshop',
    registration_policy: 'community_member',
    banner_url: null,
    banner_orientation: null,
    video_url: null,
    video_mime: null,
    capacity: 20,
    state: 'published',
    aggregate_version: 1,
    attending_count: 1,
    my_rsvp: null,
    guild_key: null,
    review_guild_key: null,
    can_review: false,
    review_reason: null,
    organizer_ref: ORGANIZER,
    organizer_name: '活動主辦人',
    ...overrides,
  };
}

async function mountEvents(t: TestContext, events: any[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as any);
  const client = {
    sessionGeneration: 1,
    get: async (path: string) => {
      if (path === '/events') return { items: events };
      if (path.startsWith('/guilds/directory') || path.startsWith('/events/bulletins')) return { items: [] };
      throw Error('Unexpected GET: ' + path);
    },
    post: noNetwork,
  };
  await React.act(async () => {
    flushSync(() => root.render(React.createElement(EventsPanel, {
      client,
      session: { user: { user_id: VIEWER } },
      locationHash: '#explore/events',
      registerLeave: () => {},
      onList: () => {},
    })));
    await new Promise(resolve => setImmediate(resolve));
  });
  t.after(() => {
    flush(() => root.unmount());
    document.body.removeChild(container);
  });
  return container;
}

const classesOf = (n: HostNode) => (n.attributes.class ?? '').split(/\s+/).filter(Boolean);

function cardByTitle(container: HostNode, title: string) {
  const card = descendants(container).find(
    n => n.nodeName === 'ARTICLE' && descendants(n).some(h => h.nodeName === 'H3' && h.textContent.startsWith(title)),
  );
  assert(card, `missing card for ${title}`);
  const actions = descendants(card).find(n => classesOf(n).includes('experience-actions'));
  assert(actions, `missing .experience-actions for ${title}`);
  const links = descendants(actions).filter(n => n.nodeName === 'A');
  const buttons = descendants(actions).filter(n => n.nodeName === 'BUTTON');
  const hints = descendants(actions).filter(n => n.nodeName === 'SPAN' && classesOf(n).includes('field-hint'));
  return { card, actions, links, buttons, hints };
}

test('CONF-10: event card link says 查看並報名 only while registration is open; otherwise 查看活動 with plain state text and no new control', async t => {
  const day = 86_400_000;
  const events = [
    makeEvent('10000000-0000-4000-8000-000000000001', '開放報名活動', {}),
    makeEvent('10000000-0000-4000-8000-000000000002', '已結束活動', {
      starts_at: new Date(Date.now() - 2 * day).toISOString(),
      ends_at: new Date(Date.now() - day).toISOString(),
      my_rsvp: 'going',
    }),
    makeEvent('10000000-0000-4000-8000-000000000003', '已取消活動', {
      state: 'cancelled',
      my_rsvp: 'going',
    }),
    makeEvent('10000000-0000-4000-8000-000000000004', '審核中活動', {
      state: 'pending',
    }),
    makeEvent('10000000-0000-4000-8000-000000000005', '已滿額活動', {
      capacity: 10,
      attending_count: 10,
    }),
    makeEvent('10000000-0000-4000-8000-000000000006', '未通過活動', {
      state: 'rejected',
    }),
    makeEvent('10000000-0000-4000-8000-000000000007', '進行中活動', {
      starts_at: new Date(Date.now() - day).toISOString(),
      ends_at: new Date(Date.now() + day).toISOString(),
    }),
    makeEvent('10000000-0000-4000-8000-000000000008', '已報名活動', {
      capacity: 10,
      attending_count: 10,
      my_rsvp: 'going',
    }),
  ];

  const container = await mountEvents(t, events);

  const open = cardByTitle(container, '開放報名活動');
  assert.equal(open.links.length, 1);
  assert.equal(open.links[0].textContent, '查看並報名');
  assert.equal(open.hints.length, 0);
  assert.equal(open.buttons.length, 1); // 分享活動 only

  const cases: Array<[string, string, number]> = [
    ['已結束活動', '已結束', 0],
    ['已取消活動', '已取消', 0],
    ['審核中活動', '審核中', 0],
    ['已滿額活動', '名額已滿', 1],
    ['未通過活動', '未通過審核', 0],
    ['進行中活動', '進行中', 1],
    ['已報名活動', '已報名', 1],
  ];

  for (const [title, expectedState, expectedButtons] of cases) {
    const card = cardByTitle(container, title);
    assert.equal(card.links.length, 1, `${title} link count`);
    assert.equal(card.links[0].textContent, '查看活動', `${title} link label`);
    assert.equal(card.hints.length, 1, `${title} plain state span count`);
    assert.equal(card.hints[0].textContent, expectedState, `${title} plain state text`);
    assert.equal(card.buttons.length, expectedButtons, `${title} keeps existing button count only`);
  }
});
