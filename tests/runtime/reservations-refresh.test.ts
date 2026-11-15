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
  value = '';
  disabled = false;
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
  setAttribute(key: string, value: unknown) {this.attributes[key] = String(value);}
  removeAttribute(key: string) {delete this.attributes[key];}
  getAttribute(key: string) {return this.attributes[key] ?? null;}
  setAttributeNS(_ns: string, key: string, value: unknown) {this.setAttribute(key, value);}
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
  select() {}
  remove() {this.parentNode?.removeChild(this);}
}

class HostDocument extends HostNode {
  visibilityState = 'visible';
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
  setInterval: () => 1, clearInterval: () => {},
  addEventListener() {}, removeEventListener() {},
  confirm: () => true,
};
document.defaultView = windowObj;
Object.assign(globalThis, {
  document, window: windowObj, HTMLElement: HostNode, HTMLDetailsElement: HostNode, HTMLIFrameElement: class {}, Node: HostNode,
  requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
  cancelAnimationFrame: clearTimeout,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const req = createRequire(import.meta.url);
const {createRoot} = req('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = req('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));
const base = fileURLToPath(new URL('../../', import.meta.url));
const propsOf = (node: HostNode) => node[Object.keys(node).find(k => k.startsWith('__reactProps$'))!];
const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];

function resolveModule(fromFile: string, spec: string): string {
  const raw = path.resolve(path.dirname(fromFile), spec);
  const stripped = raw.endsWith('.js') ? raw.slice(0, -3) : raw;
  for (const candidate of [raw, stripped + '.ts', stripped + '.tsx', stripped + '.js', path.join(stripped, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw Error(`Missing import ${spec} from ${fromFile}`);
}

function compile(relative: string, cache = new Map<string, any>()): any {
  const file = path.resolve(base, relative);
  if (cache.has(file)) return cache.get(file);
  const mod = {exports: {} as any};
  cache.set(file, mod.exports);
  const raw = readFileSync(file, 'utf8');
  runInNewContext(transformSync(raw, {loader: relative.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic'}).code, {
    module: mod, exports: mod.exports, crypto: webcrypto, Intl, URL, AbortController,
    window: windowObj, document, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: clearTimeout,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {}, console,
    require(name: string) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime' || name === 'react-dom' || name === 'zod') return req(name);
      if (name.endsWith('.css')) return {};
      if (name.startsWith('.')) return compile(path.relative(base, resolveModule(file, name)), cache);
      throw Error('Unexpected import: ' + name);
    },
  });
  cache.set(file, mod.exports);
  return mod.exports;
}

const cache = new Map<string, any>();
const {HostedOrderPage} = compile('apps/portal-web/src/modules/HostedOrder.tsx', cache);
const {HOSTED_ORDER_PROFILE} = compile('contracts/guild-launchpad/v1/hosted-order.ts', cache);

const orderId = '12345678-1234-4234-8234-123456789abc';
const sampleOrder = {
  profile: HOSTED_ORDER_PROFILE,
  store: {slug: 'small-shop', name: '小店'},
  publication_revision: '1',
  currency: 'TWD',
  items: [{sku: 'P0001', title: '杯子', quantity: 1, unit_price_minor: 300, line_total_minor: 300}],
  merchandise_total_minor: 300,
  amount_due_minor: null,
  shipping_state: 'not_configured',
  tax_state: 'not_assessed',
  payment_state: 'not_enabled',
  terms_sha256: 'a'.repeat(64),
  payment_enabled: false,
  refund_enabled: false,
  fulfilment_enabled: false,
  money_movement_enabled: false,
  order_id: orderId,
  client_order_id: orderId,
  quote_id: orderId,
  version: '1',
  created_at: '2026-10-08T12:00:00.000Z',
  reservation_expires_at: '2026-10-08T12:30:00.000Z',
  state: 'reserved',
  closed_at: null,
  close_reason: null,
};

async function settle() {
  for (let i = 0; i < 6; i++) {
    await React.act(async () => {await Promise.resolve();});
  }
}

async function mountOrders(t: TestContext, options: {locationHash: string; withCheckout: boolean}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as any);
  t.after(() => {flush(() => root.unmount()); container.remove();});

  const gets: string[] = [];
  const client: any = {
    sessionGeneration: 1,
    get: async (url: string) => {
      gets.push(url);
      if (url === '/session') return {user: {user_id: 'u1'}, csrf_token: 'csrf1'};
      if (url.startsWith('/me/orders')) return {items: [], next_cursor: null};
      if (url === '/me/reservations') return {items: [], next_cursor: null};
      if (url === `/me/reservations/${orderId}`) return sampleOrder;
      throw Error('Unexpected GET ' + url);
    },
  };

  await React.act(async () => {
    flushSync(() => root.render(React.createElement(HostedOrderPage, {
      client,
      locationHash: options.locationHash,
      registerLeave: () => {},
      replaceLocation: () => {},
      checkoutOrders: options.withCheckout ? {userId: 'u1', csrfToken: 'csrf1', onSessionExpired: () => {}} : undefined,
    })));
  });
  await settle();
  return {container, gets};
}

test('UX-V-12: #reservations with checkoutOrders has one refresh control refreshing both, no self-link, and no primary when empty', async (t) => {
  const {container, gets} = await mountOrders(t, {locationHash: '#reservations', withCheckout: true});
  const nodes = descendants(container);
  const buttons = nodes.filter(n => n.tagName === 'BUTTON');
  const links = nodes.filter(n => n.tagName === 'A');

  const refreshButtons = buttons.filter(b => b.textContent === '重新整理／第一頁');
  assert.equal(refreshButtons.length, 1);

  const selfLinks = links.filter(a => a.getAttribute('href') === '#reservations');
  assert.equal(selfLinks.length, 0);

  const primaryControls = [...buttons, ...links].filter(el => (el.getAttribute('class') ?? '').split(/\s+/).includes('btn-primary'));
  assert.equal(primaryControls.length, 0);

  const emptyTexts = nodes.filter(n => n.tagName === 'P').map(n => n.textContent.trim()).filter(s => s.startsWith('目前沒有'));
  assert.equal(emptyTexts.length, 2);
  for (const text of emptyTexts) assert.equal(text.length <= 24, true);

  const beforeOrders = gets.filter(u => u === '/me/orders').length;
  const beforeReservations = gets.filter(u => u === '/me/reservations').length;
  assert.equal(beforeOrders, 1);
  assert.equal(beforeReservations, 1);

  await React.act(async () => {propsOf(refreshButtons[0]).onClick();});
  await settle();

  assert.equal(gets.filter(u => u === '/me/orders').length, 2);
  assert.equal(gets.filter(u => u === '/me/reservations').length, 2);
});

test('UX-V-12: #reservations without checkoutOrders keeps one refresh control and no self-link', async (t) => {
  const {container} = await mountOrders(t, {locationHash: '#reservations', withCheckout: false});
  const nodes = descendants(container);
  const buttons = nodes.filter(n => n.tagName === 'BUTTON');
  const links = nodes.filter(n => n.tagName === 'A');

  assert.equal(buttons.filter(b => b.textContent === '重新整理／第一頁').length, 1);
  assert.equal(links.filter(a => a.getAttribute('href') === '#reservations').length, 0);
  assert.equal([...buttons, ...links].filter(el => (el.getAttribute('class') ?? '').split(/\s+/).includes('btn-primary')).length, 0);
});

test('UX-V-12: sub-route #reservations/order/:id retains link back to #reservations', async (t) => {
  const {container} = await mountOrders(t, {locationHash: `#reservations/order/${orderId}`, withCheckout: true});
  const links = descendants(container).filter(n => n.tagName === 'A');
  const backLinks = links.filter(a => a.getAttribute('href') === '#reservations');
  assert.equal(backLinks.length, 1);
});
