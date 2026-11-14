import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
    if (nodeName === 'SELECT' || nodeName === 'OPTION' || nodeName === 'TEXTAREA') this.value = '';
    if (nodeName === 'OPTION') this.selected = false;
  }
  get options(): HostNode[] {return this.childNodes.filter(child => child.nodeName === 'OPTION');}
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
  setAttributeNS(_namespace: string, key: string, value: unknown) {this.setAttribute(key, value);}
  addEventListener(type: string, fn: Function) {(this.listeners[type] ??= []).push(fn);}
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter(item => item !== fn);}
  get firstChild(): HostNode | null {return this.childNodes[0] ?? null;}
  get lastChild(): HostNode | null {return this.childNodes.at(-1) ?? null;}
  get nextSibling(): HostNode | null {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;}
  get textContent(): string {return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join('');}
  set textContent(value: string) {this.childNodes.forEach(node => {node.parentNode = null;}); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  contains(node: HostNode): boolean {return node === this || this.childNodes.some(child => child.contains(node));}
}
class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null); this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
  }
  createElement(name: string) {return new HostNode(1, name.toUpperCase(), this);}
  createElementNS(namespace: string, name: string) {const node = this.createElement(name); node.namespaceURI = namespace; return node;}
  createTextNode(value: string) {const node = new HostNode(3, '#text', this); node.nodeValue = value; return node;}
}
const document = new HostDocument();
const window = Object.assign(new EventTarget(), {document, HTMLElement: HostNode, HTMLIFrameElement: class {}, get event() {return undefined;}});
document.defaultView = window;
Object.assign(globalThis, {document, window, HTMLElement: HostNode, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true});
const require = createRequire(import.meta.url);
const {createRoot} = require('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = require('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));
const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];
const propsOf = (node: HostNode) => node[Object.keys(node).find(k => k.startsWith('__reactProps$'))!];

const source = readFileSync(new URL('../../apps/portal-web/src/modules/MemberReporting.tsx', import.meta.url), 'utf8');
const mod = {exports: {} as {MemberReportingProvider: React.ComponentType<any>; AdminReports: React.ComponentType<any>}};
runInNewContext(transformSync(source, {loader: 'tsx', format: 'cjs', jsx: 'automatic'}).code, {
  module: mod, exports: mod.exports, window, document, Node: HostNode, crypto: webcrypto, URLSearchParams, console,
  require(name: string) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '../api') return {ApiError};
    if (name.endsWith('.css')) return {};
    throw Error('Unexpected import ' + name);
  },
});

function mountReports(t: TestContext, response: {items: unknown[]; next_cursor: string | null}) {
  const requests: {path: string; resolve: (v: unknown) => void}[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as any);
  const client = {
    sessionGeneration: 1,
    get: (path: string) => new Promise(resolve => {requests.push({path, resolve});}),
    post: async () => ({}),
  };
  let mounted = true;
  t.after(() => {if (mounted) {flush(() => root.unmount()); document.body.removeChild(container); mounted = false;}});
  flush(() => root.render(
    React.createElement(mod.exports.MemberReportingProvider, {client, enabled: true},
      React.createElement(mod.exports.AdminReports, {client}),
    ),
  ));
  return {
    requests,
    async settleInitial() {
      assert.equal(requests.length, 1);
      assert.equal(requests[0].path, '/admin/reports?state=all');
      await React.act(async () => {requests[0].resolve(response); await new Promise(r => setImmediate(r));});
    },
    toggleButton: () => descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent === '平台檢舉案件'),
    panel: () => descendants(container).find(n => n.nodeName === 'SECTION' && n.getAttribute('aria-label') === '平台檢舉案件')?.childNodes.find(n => n.nodeName === 'DIV'),
    clickToggle() {
      const btn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent === '平台檢舉案件');
      assert.ok(btn);
      flush(() => propsOf(btn).onClick());
    },
  };
}

test('AdminReports opens automatically when initial pending queue is non-empty and can still collapse', async t => {
  const h = mountReports(t, {
    items: [{
      case_id: 'case-1',
      case_number: 'RPT-0001',
      state: 'received',
      aggregate_version: 1,
      summary: null,
      created_at: '2026-11-14T00:00:00Z',
      target_kind: 'post',
      target_id: 'post-1',
      reason: 'spam',
      handler_user_id: null,
      processing_reason: null,
      action: 'none',
    }],
    next_cursor: null,
  });
  await h.settleInitial();
  const btn = h.toggleButton();
  assert.ok(btn);
  assert.equal(propsOf(btn)['aria-expanded'], true);
  const panel = h.panel();
  assert.ok(panel);
  assert.equal(Boolean(propsOf(panel).hidden), false);
  h.clickToggle();
  assert.equal(propsOf(h.toggleButton()!)['aria-expanded'], false);
  assert.equal(Boolean(propsOf(h.panel()!).hidden), true);
});

test('AdminReports stays closed when initial queue is empty', async t => {
  const h = mountReports(t, {items: [], next_cursor: null});
  await h.settleInitial();
  const btn = h.toggleButton();
  assert.ok(btn);
  assert.equal(propsOf(btn)['aria-expanded'], false);
  const panel = h.panel();
  assert.ok(panel);
  assert.equal(Boolean(propsOf(panel).hidden), true);
});
