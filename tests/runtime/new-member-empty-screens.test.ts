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
  './Membership': {DirectoryMemberRow: () => null, loadLabels: async () => ({})},
  './member-inbox': {announceInboxChange: () => {}},
  './MemberBlocking': {BlockedMembers: () => null, MemberBlockingAction: () => null},
  './friends-directory-controller': friendsController,
});

const {MemberContributionOutcomes} = load('../../apps/portal-web/src/modules/ContributionOutcomes.tsx', {
  './AgentHandoff': {AgentHandoff: () => React.createElement('details', {className: 'agent-handoff'}, React.createElement('summary', null, '交給我的 Agent'))},
  '../format': {formatIsoLocal: (v: string) => v},
  './shared': {useModuleMutation: () => ({mutate: async () => null, busy: false, error: null, setError: () => {}})},
});

function isHiddenInTree(node: HostNode): boolean {
  for (let n: HostNode | null = node; n; n = n.parentNode) {
    if (n.hasAttribute('hidden')) return true;
    if (n.nodeName !== 'SUMMARY' && n.parentNode?.nodeName === 'DETAILS' && !n.parentNode.hasAttribute('open')) return true;
  }
  return false;
}
const hasClass = (node: HostNode, cls: string) => (node.attributes.class ?? '').split(/\s+/).includes(cls);
const visiblePrimaries = (root: HostNode) => descendants(root).filter(n => !isHiddenInTree(n) && hasClass(n, 'btn-primary'));
const visibleActions = (root: HostNode) => descendants(root).filter(n => !isHiddenInTree(n) && (n.nodeName === 'BUTTON' || n.nodeName === 'A'));
const visibleControls = (root: HostNode) => descendants(root).filter(n => !isHiddenInTree(n) && ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(n.nodeName));
const visibleText = (node: HostNode): string => isHiddenInTree(node) ? '' : node.nodeType === 3 ? (node.nodeValue ?? '') : node.childNodes.map(visibleText).join('');
const countZh = (text: string) => (text.match(/[\u4e00-\u9fff]/g) ?? []).length;

function mount(t: TestContext, element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as any);
  flush(() => root.render(element));
  t.after(() => {flush(() => root.unmount()); container.parentNode?.removeChild(container);});
  return {container, settled: async () => {await React.act(async () => {await new Promise(resolve => setTimeout(resolve, 20));});}};
}

test('UX-V-14 empty new-member screens: MemberServices hides 11 filters, Squads hides empty toolbar, FriendsPanel has 1 primary & collapsed filters, ContributionOutcomes keeps concise empty state', async t => {
  const svcClient: any = {
    sessionGeneration: 1,
    get: async (p: string) => p === '/member-services/mine' ? {items: [], limit: 5} : {items: [], next_cursor: null, can_hide: false},
  };
  const hSvc = mount(t, React.createElement(MemberServices, {client: svcClient}));
  await hSvc.settled();
  assert.equal(visiblePrimaries(hSvc.container).length, 1);
  assert.equal(visiblePrimaries(hSvc.container)[0].textContent, '新增服務');
  assert.equal(descendants(hSvc.container).filter(n => hasClass(n, 'service-filter')).length, 0);
  assert.equal(visibleActions(hSvc.container).length <= 4, true);
  assert.equal(visibleControls(hSvc.container).length <= 8, true);
  assert.equal(countZh(visibleText(hSvc.container)) <= 120, true);

  const sqClient: any = {sessionGeneration: 1, get: async () => ({items: [], next_offset: null})};
  const hSq = mount(t, React.createElement(SquadsPanel, {client: sqClient, session: {user: {user_id: 'u-1', nickname: '測試'}}, onNavigate: () => {}}));
  await hSq.settled();
  assert.equal(visiblePrimaries(hSq.container).length, 1);
  assert.equal(visiblePrimaries(hSq.container)[0].textContent, '成立一支小隊');
  assert.equal(descendants(hSq.container).filter(n => hasClass(n, 'squad-scope') || hasClass(n, 'discovery-toolbar')).length, 0);
  assert.equal(visibleActions(hSq.container).length <= 4, true);
  assert.equal(visibleControls(hSq.container).length <= 8, true);
  assert.equal(countZh(visibleText(hSq.container)) <= 120, true);

  const frClient: any = {sessionGeneration: 1, get: async () => ({items: [], total: 0, next_offset: null})};
  const hFr = mount(t, React.createElement(FriendsPanel, {client: frClient, session: {user: {user_id: 'u-1', nickname: '測試'}}, memberBlockingEnabled: true, onNavigate: () => {}, onMessage: () => {}}));
  await hFr.settled();
  assert.equal(visiblePrimaries(hFr.container).length, 1);
  assert.equal(visiblePrimaries(hFr.container)[0].textContent, '認識工坊夥伴');
  assert.equal(visibleActions(hFr.container).length, 1);
  assert.equal(visibleControls(hFr.container).length <= 8, true);
  assert.equal(countZh(visibleText(hFr.container)) <= 120, true);
  const filtersDetails = descendants(hFr.container).find(n => hasClass(n, 'friends-filters'))!;
  assert.equal(filtersDetails.hasAttribute('open'), false);

  const outClient: any = {sessionGeneration: 1, get: async () => ({accepted_count: 0, entries: [], next_offset: null})};
  const hOut = mount(t, React.createElement(MemberContributionOutcomes, {client: outClient}));
  await hOut.settled();
  assert.equal(visibleActions(hOut.container).length <= 4, true);
  assert.equal(visibleControls(hOut.container).length <= 8, true);
  const outEmpty = descendants(hOut.container).find(n => hasClass(n, 'empty'))!;
  assert.equal(outEmpty.textContent, '尚無已驗收合作紀錄。');
  assert.equal(countZh(visibleText(hOut.container)) <= 120, true);
});
