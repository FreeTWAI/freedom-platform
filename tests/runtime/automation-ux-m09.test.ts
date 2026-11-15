import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, any> = {setProperty() {}, removeProperty() {}};
  listeners: Record<string, {fn: Function; capture: boolean}[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
  }
  appendChild(node: HostNode) {node.parentNode?.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node;}
  removeChild(node: HostNode) {const i = this.childNodes.indexOf(node); assert.notEqual(i, -1); this.childNodes.splice(i, 1); node.parentNode = null; return node;}
  insertBefore(node: HostNode, before: HostNode) {node.parentNode?.removeChild(node); const i = this.childNodes.indexOf(before); assert.notEqual(i, -1); this.childNodes.splice(i, 0, node); node.parentNode = this; return node;}
  setAttribute(key: string, value: unknown) {this.attributes[key] = String(value);}
  removeAttribute(key: string) {delete this.attributes[key];}
  getAttribute(key: string) {return this.attributes[key] ?? null;}
  setAttributeNS(_ns: string, key: string, value: unknown) {this.setAttribute(key, value);}
  addEventListener(type: string, fn: Function, options?: any) {(this.listeners[type] ??= []).push({fn, capture: options === true || !!options?.capture});}
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter(i => i.fn !== fn);}
  get firstChild(): HostNode | null {return this.childNodes[0] ?? null;}
  get lastChild(): HostNode | null {return this.childNodes.at(-1) ?? null;}
  get nextSibling(): HostNode | null {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;}
  get textContent(): string {return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join('');}
  set textContent(value: string) {this.childNodes.forEach(n => {n.parentNode = null;}); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  get parentElement(): HostNode | null {return this.parentNode?.nodeType === 1 ? this.parentNode : null;}
  focus() {this.ownerDocument.activeElement = this;}
  contains(node: HostNode): boolean {return node === this || this.childNodes.some(c => c.contains(node));}
  hasAttribute(key: string) {return Object.hasOwn(this.attributes, key);}
}

class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null); this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
  }
  createElement(name: string) {return new HostNode(1, name.toUpperCase(), this);}
  createElementNS(ns: string, name: string) {const n = this.createElement(name); n.namespaceURI = ns; return n;}
  createTextNode(value: string) {const n = this.createElement('#text'); n.nodeType = 3; n.nodeValue = value; return n;}
}

const document = new HostDocument();
const window: any = {
  location: {origin: 'https://fixture.invalid'}, setTimeout, clearTimeout, document,
  HTMLElement: HostNode, HTMLIFrameElement: class {}, listeners: {} as Record<string, Function[]>,
  addEventListener(type: string, fn: Function) {(this.listeners[type] ??= []).push(fn);},
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter((x: Function) => x !== fn);},
  dispatchEvent(e: any) {for (const fn of [...(this.listeners[e.type] ?? [])]) fn(e); return true;},
};
document.defaultView = window;
Object.assign(globalThis, {document, window, HTMLElement: HostNode, HTMLIFrameElement: window.HTMLIFrameElement, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true});

const require = createRequire(import.meta.url);
const {createRoot} = require('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = require('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));
const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];
const propsOf = (node: HostNode) => node[Object.keys(node).find(k => k.startsWith('__reactProps$'))!];

const bundled = buildSync({
  stdin: {
    contents: `export {ClientConnections} from './apps/portal-web/src/modules/ClientConnections'; export {DeviceConnections} from './apps/portal-web/src/modules/DeviceConnections';`,
    resolveDir: process.cwd(),
    sourcefile: 'automation-ux-m09-entry.ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: {'.css': 'empty'},
});
const production = {exports: {} as any};
runInNewContext(bundled.outputFiles[0].text, {
  module: production, exports: production.exports, crypto: webcrypto, Intl, URL, URLSearchParams, AbortController,
  Error, Event, console, window, document, HTMLElement: HostNode, navigator: {language: 'zh-TW', languages: ['zh-TW']},
  fetch: () => {throw Error('Real network forbidden');}, requestAnimationFrame: (fn: () => void) => queueMicrotask(fn),
  setTimeout, clearTimeout,
  require(name: string) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime' || name === 'react-dom' || name === 'qrcode' || name === 'zod') return require(name);
    throw Error(name);
  },
});
const {ClientConnections, DeviceConnections} = production.exports;

test('UX-M-09: ClientConnections uses Traditional Chinese heading 連接你的工具 and single btn-primary', async t => {
  const client: any = {
    sessionGeneration: 1, csrfToken: 'synthetic',
    async get(path: string) {
      if (path === '/me/client-connections') return {items: []};
      if (path.startsWith('/client-connections/')) return {
        user_code: 'GOOD-CODE', kind: 'supplier', client_name: '合成工具',
        scope: 'supplier.read', expires_at: '2099-01-01T00:00:00.000Z', state: 'pending',
      };
      throw Error(path);
    },
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await React.act(async () => {root.render(React.createElement(ClientConnections, {client})); await new Promise(r => setImmediate(r));});
  t.after(() => {flush(() => root.unmount()); document.body.removeChild(container);});

  const nodes = () => descendants(container);
  const primaryButtons = () => nodes().filter(n => n.nodeName === 'BUTTON' && (n.attributes.class ?? '').split(' ').includes('btn-primary'));
  assert.equal(container.textContent.includes('CONNECT YOUR CLIENT'), false);
  assert.equal(container.textContent.includes('連接你的工具'), true);
  assert.equal(primaryButtons().length, 1);
  assert.equal(primaryButtons()[0].textContent, '查看連線請求');

  const input = nodes().find(n => n.nodeName === 'INPUT');
  assert.ok(input);
  await React.act(async () => {propsOf(input).onChange({target: {value: 'GOOD-CODE'}});});
  const form = nodes().find(n => n.nodeName === 'FORM');
  assert.ok(form);
  await React.act(async () => {propsOf(form).onSubmit({preventDefault() {}}); await new Promise(r => setImmediate(r));});
  assert.equal(primaryButtons().length, 1);
  assert.equal(primaryButtons()[0].textContent, '確認並允許這次讀取連線');
});

test('UX-M-09: DeviceConnections replaces bootstrap 狀態 with 初始連線狀態', () => {
  const client: any = {sessionGeneration: 1, csrfToken: 'synthetic', async get() {return {items: []};}};
  const html = renderToStaticMarkup(React.createElement(DeviceConnections, {client}));
  assert.equal(html.includes('bootstrap 狀態'), false);
  assert.equal(html.includes('初始連線狀態'), true);
});
