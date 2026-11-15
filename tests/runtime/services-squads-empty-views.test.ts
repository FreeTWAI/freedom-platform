import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import React from 'react';
import * as memberServiceShared from '../../packages/shared/member-service.js';
import * as squadKindsShared from '../../packages/shared/squad-kinds.js';
import * as friendsController from '../../apps/portal-web/src/modules/friends-directory-controller.js';
import {ApiError} from '../../apps/portal-web/src/api.js';

class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, any> = {setProperty() {}, removeProperty() {}};
  listeners: Record<string, {fn: Function; capture: boolean}[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  value = '';
  checked = false;
  open = false;
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
  }
  appendChild(node: HostNode) {node.parentNode?.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node;}
  removeChild(node: HostNode) {const i = this.childNodes.indexOf(node); assert.notEqual(i, -1); this.childNodes.splice(i, 1); node.parentNode = null; return node;}
  insertBefore(node: HostNode, before: HostNode) {node.parentNode?.removeChild(node); const i = this.childNodes.indexOf(before); assert.notEqual(i, -1); this.childNodes.splice(i, 0, node); node.parentNode = this; return node;}
  setAttribute(key: string, value: unknown) {this.attributes[key] = String(value); if (key === 'open') this.open = true;}
  removeAttribute(key: string) {delete this.attributes[key]; if (key === 'open') this.open = false;}
  getAttribute(key: string) {return this.attributes[key] ?? null;}
  setAttributeNS(_ns: string, key: string, value: unknown) {this.setAttribute(key, value);}
  addEventListener(type: string, fn: Function, options?: any) {(this.listeners[type] ??= []).push({fn, capture: options === true || !!options?.capture});}
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter(item => item.fn !== fn);}
  get options(): HostNode[] {return this.childNodes.flatMap(node => node.nodeName === 'OPTION' ? [node] : node.options);}
  setCustomValidity(v: string) {this.validationMessage = v;}
  get firstChild(): HostNode | null {return this.childNodes[0] ?? null;}
  get lastChild(): HostNode | null {return this.childNodes.at(-1) ?? null;}
  get nextSibling(): HostNode | null {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;}
  get textContent(): string {return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join('');}
  set textContent(value: string) {this.childNodes.forEach(n => {n.parentNode = null;}); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  get src() {return this.attributes.src ?? '';}
  set src(v: string) {this.attributes.src = String(v);}
  contains(node: HostNode): boolean {return node === this || this.childNodes.some(child => child.contains(node));}
  scrollIntoView() {}
}
class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null); this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
  }
  createElement(name: string) {return new HostNode(1, name.toUpperCase(), this);}
  createElementNS(ns: string, name: string) {const node = this.createElement(name); node.namespaceURI = ns; return node;}
  createTextNode(value: string) {const node = new HostNode(3, '#text', this); node.nodeValue = value; return node;}
}
const document = new HostDocument();
const window: any = {
  location: {origin: 'https://fixture.invalid', hash: ''},
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  requestAnimationFrame: (fn: Function) => {fn(); return 1;},
  open() {throw Error('No external navigation permitted');},
  document, HTMLElement: HostNode, HTMLIFrameElement: class {},
  listeners: {} as Record<string, Function[]>,
  addEventListener(type: string, fn: Function) {(this.listeners[type] ??= []).push(fn);},
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter((x: Function) => x !== fn);},
  dispatchEvent(e: any) {for (const fn of [...(this.listeners[e.type] ?? [])]) fn(e); return true;},
};
document.defaultView = window;
Object.assign(globalThis, {document, window, HTMLElement: HostNode, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true});

const require = createRequire(import.meta.url);
const {createRoot} = require('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = require('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));
const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];
HostNode.prototype.closest = function () {return null;};
HostNode.prototype.focus = function () {this.ownerDocument.activeElement = this;};
HostNode.prototype.select = function () {};
document.getElementById = (id: string) => descendants(document).find(n => n.attributes.id === id) ?? null;
HostNode.prototype.querySelector = function (sel: string) {return descendants(this).find(n => sel.startsWith('.') ? (n.attributes.class ?? '').split(/\s+/).includes(sel.slice(1)) : n.nodeName === sel.toUpperCase()) ?? null;};
HostNode.prototype.hasAttribute = function (k: string) {return Object.hasOwn(this.attributes, k);};
HostNode.prototype.dispatchEvent = function (event: any) {
  event.target ??= this; event.bubbles ??= true; event.cancelBubble = false; event.defaultPrevented = false;
  event.preventDefault = () => {event.defaultPrevented = true;}; event.stopPropagation = () => {event.cancelBubble = true;};
  const chain: HostNode[] = []; for (let n: HostNode | null = this; n; n = n.parentNode) chain.push(n);
  for (const n of [...chain].reverse()) {event.currentTarget = n; for (const l of n.listeners[event.type] ?? []) if (l.capture) l.fn(event); if (event.cancelBubble) return !event.defaultPrevented;}
  for (const n of chain) {event.currentTarget = n; for (const l of n.listeners[event.type] ?? []) if (!l.capture) l.fn(event); if (event.cancelBubble || !event.bubbles) break;}
  event.currentTarget = null; return !event.defaultPrevented;
};

function load(relative: string, imports: Record<string, unknown>) {
  const module = {exports: {} as any};
  runInNewContext(transformSync(readFileSync(new URL(relative, import.meta.url), 'utf8'), {loader: relative.endsWith('tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic'}).code, {
    module, exports: module.exports, Intl, window, document, navigator: {clipboard: {writeText: async () => {}}}, URLSearchParams, AbortController, URL,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, requestAnimationFrame: window.requestAnimationFrame,
    require(name: string) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
      if (name.endsWith('.css')) return {};
      if (name in imports) return imports[name];
      throw Error('Unexpected import ' + name);
    },
  });
  return module.exports;
}

const {MemberServices} = load('../../apps/portal-web/src/modules/MemberServices.tsx', {
  '../access-fetch': {accessAwareFetch: async () => {throw Error('unused');}},
  '../api': {ApiError},
  '../../../../packages/shared/member-service': memberServiceShared,
  './MemberAvatar': {MemberAvatar: () => null},
  '../share/ShareButton': {ShareButton: () => React.createElement('button', {type: 'button', className: 'btn btn-ghost'}, '分享'), promotionLink: () => async () => ({path: '/go/s'})},
});

const {SquadsPanel} = load('../../apps/portal-web/src/modules/Squads.tsx', {
  '../../../../packages/shared/squad-kinds': squadKindsShared,
  '../api': {ApiError},
  './shared': {useModuleMutation: () => ({mutate: async () => null, busy: false, error: null, setError: () => {}, lastFailureUnknown: false, pendingRequest: null})},
  './authoring-drafts': {sharingMutationState: () => ({busy: false}), useAuthoringDraft: (_k: string, initial: any) => [initial, () => {}, () => {}]},
  './Membership': {Status: () => null},
  './ModuleBanner': {ModuleBanner: ({title, description, children}: any) => React.createElement('div', {className: 'module-banner'}, React.createElement('h2', null, title), description && React.createElement('p', null, description), children)},
  './SquadOutcomes': {SquadOutcomePublisher: () => null},
  './SquadOwnerTools': {SquadOwnerTools: ({children}: any) => React.createElement('div', null, children)},
  './SquadInvitations': {ReceivedInvitations: () => null, OwnerInvitations: () => null},
});

const {FriendsPanel} = load('../../apps/portal-web/src/modules/FriendsPanel.tsx', {
  './shared': {useModuleMutation: () => ({mutate: async () => null, busy: false, error: null, setError: () => {}, lastFailureUnknown: false, pendingRequest: null})},
  './Membership': {DirectoryMemberRow: ({member, children}: any) => React.createElement('article', null, member.nickname, children), loadLabels: async () => ({})},
  './member-inbox': {announceInboxChange: () => {}},
  './MemberBlocking': {BlockedMembers: () => null, MemberBlockingAction: () => null},
  './friends-directory-controller': friendsController,
});

function isHiddenInTree(node: HostNode): boolean {
  for (let n: HostNode | null = node; n; n = n.parentNode) {
    if (n.hasAttribute('hidden')) return true;
    if (n.nodeName !== 'SUMMARY' && n.parentNode?.nodeName === 'DETAILS' && !n.parentNode.hasAttribute('open')) return true;
  }
  return false;
}

function visibleText(node: HostNode): string {
  if (isHiddenInTree(node)) return '';
  if (node.nodeType === 3) return node.nodeValue ?? '';
  return node.childNodes.map(visibleText).join('');
}

function countZh(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function visibleControls(root: HostNode): HostNode[] {
  return descendants(root).filter(n => !isHiddenInTree(n) && ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(n.nodeName));
}

function mount(t: TestContext, element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as any);
  flush(() => root.render(element));
  t.after(() => {flush(() => root.unmount()); container.parentNode?.removeChild(container);});
  return {
    container,
    settled: async () => {await React.act(async () => {await new Promise(resolve => setTimeout(resolve, 20));});},
  };
}

test('UX-M-06 MemberServices: empty view <=8 controls & <=120 static zh chars, service card <=2 visible action buttons', async t => {
  const emptyClient: any = {
    sessionGeneration: 1,
    get: async (path: string) => path === '/member-services/mine' ? {items: [], limit: 5} : {items: [], next_cursor: null, can_hide: false},
  };
  const hEmpty = mount(t, React.createElement(MemberServices, {client: emptyClient}));
  await hEmpty.settled();
  assert.equal(visibleControls(hEmpty.container).length <= 8, true);
  assert.equal(countZh(visibleText(hEmpty.container)) <= 120, true);

  const ownedService = {
    service_id: 'svc-1', title: '翻譯服務', category: 'translation', category_label: '翻譯', summary: '協助文件翻譯',
    description: null, price_text: null, area_text: null, service_mode: 'online', contacts: [{label: '網站', url: 'https://example.invalid'}],
    state: 'active', aggregate_version: 1, cover_url: null, owner: {user_id: 'u-1', display_name: '作者', avatar_url: null},
    public_path: '/services/svc-1', total_points: 0, mine: true, can_hide: true,
  };
  const filledClient: any = {
    sessionGeneration: 1,
    get: async (path: string) => path === '/member-services/mine' ? {items: [ownedService], limit: 5} : {items: [ownedService], next_cursor: null, can_hide: true},
  };
  const hFilled = mount(t, React.createElement(MemberServices, {client: filledClient}));
  await hFilled.settled();
  const card = descendants(hFilled.container).find(n => (n.attributes.class ?? '').split(/\s+/).includes('service-card'))!;
  const cardButtons = descendants(card).filter(n => !isHiddenInTree(n) && (n.nodeName === 'BUTTON' || n.nodeName === 'A'));
  assert.equal(cardButtons.length <= 2, true);
});

test('UX-M-06 SquadsPanel: empty view <=8 controls and <=120 static zh chars', async t => {
  const client: any = {sessionGeneration: 1, get: async () => ({items: [], next_offset: null})};
  const h = mount(t, React.createElement(SquadsPanel, {client, session: {user: {user_id: 'u-1', nickname: '測試'}}, onNavigate: () => {}}));
  await h.settled();
  assert.equal(visibleControls(h.container).length <= 8, true);
  assert.equal(countZh(visibleText(h.container)) <= 120, true);
});

test('UX-M-06 FriendsPanel: empty view <=8 controls and <=120 static zh chars', async t => {
  const client: any = {sessionGeneration: 1, get: async () => ({items: [], total: 0, next_offset: null})};
  const h = mount(t, React.createElement(FriendsPanel, {client, session: {user: {user_id: 'u-1', nickname: '測試'}}, memberBlockingEnabled: true, onNavigate: () => {}, onMessage: () => {}}));
  await h.settled();
  assert.equal(visibleControls(h.container).length <= 8, true);
  assert.equal(countZh(visibleText(h.container)) <= 120, true);
});
