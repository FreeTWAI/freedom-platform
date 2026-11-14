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
  setAttribute(key: string, value: unknown) {
    this.attributes[key] = String(value);
    if (key === 'open') this.open = true;
  }
  removeAttribute(key: string) {
    delete this.attributes[key];
    if (key === 'open') this.open = false;
  }
  getAttribute(key: string) {return this.attributes[key] ?? null;}
  setAttributeNS(_namespace: string, key: string, value: unknown) {this.setAttribute(key, value);}
  addEventListener(type: string, fn: Function, options?: any) {(this.listeners[type] ??= []).push({fn, capture: options === true || !!options?.capture});}
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter(item => item.fn !== fn);}
  get options(): HostNode[] {return this.childNodes.flatMap(node => node.nodeName === 'OPTION' ? [node] : node.options);}
  setCustomValidity(value: string) {this.validationMessage = value;}
  get firstChild(): HostNode | null {return this.childNodes[0] ?? null;}
  get lastChild(): HostNode | null {return this.childNodes.at(-1) ?? null;}
  get nextSibling(): HostNode | null {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;}
  get textContent(): string {return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join('');}
  set textContent(value: string) {this.childNodes.forEach(node => {node.parentNode = null;}); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  get src() {return this.attributes.src ?? '';}
  set src(value: string) {this.attributes.src = String(value);}
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
  createElementNS(namespace: string, name: string) {const node = this.createElement(name); node.namespaceURI = namespace; return node;}
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
HostNode.prototype.closest = function (selector: string) {
  for (let n: HostNode | null = this; n; n = n.parentNode) {
    if (selector.startsWith('.') ? (n.attributes.class ?? '').split(/\s+/).includes(selector.slice(1)) : n.nodeName === selector.toUpperCase()) return n;
  }
  return null;
};
HostNode.prototype.focus = function () {this.ownerDocument.activeElement = this;};
HostNode.prototype.select = function () {};
document.getElementById = (id: string) => descendants(document).find(node => node.attributes.id === id) ?? null;
HostNode.prototype.querySelector = function (selector: string) {
  return descendants(this).find(n => selector.startsWith('.') ? (n.attributes.class ?? '').split(/\s+/).includes(selector.slice(1)) : n.nodeName === selector.toUpperCase()) ?? null;
};
HostNode.prototype.hasAttribute = function (key: string) {return Object.hasOwn(this.attributes, key);};
HostNode.prototype.dispatchEvent = function (event: any) {
  event.target ??= this; event.bubbles ??= true; event.cancelBubble = false; event.defaultPrevented = false;
  event.preventDefault = () => {event.defaultPrevented = true;}; event.stopPropagation = () => {event.cancelBubble = true;};
  const chain: HostNode[] = []; for (let n: HostNode | null = this; n; n = n.parentNode) chain.push(n);
  for (const n of [...chain].reverse()) {event.currentTarget = n; for (const l of n.listeners[event.type] ?? []) if (l.capture) l.fn(event); if (event.cancelBubble) return !event.defaultPrevented;}
  for (const n of chain) {event.currentTarget = n; for (const l of n.listeners[event.type] ?? []) if (!l.capture) l.fn(event); if (event.cancelBubble || !event.bubbles) break;}
  if (event.type === 'click' && !event.defaultPrevented && this.nodeName === 'SUMMARY' && this.parentNode?.nodeName === 'DETAILS') {
    const details = this.parentNode;
    if (details.hasAttribute('open')) details.removeAttribute('open'); else details.setAttribute('open', '');
    details.dispatchEvent({type: 'toggle', bubbles: false});
  }
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

const {FriendsPanel} = load('../../apps/portal-web/src/modules/FriendsPanel.tsx', {
  './shared': {useModuleMutation: () => ({mutate: async () => null, busy: false, error: null, setError: () => {}, lastFailureUnknown: false, pendingRequest: null})},
  './Membership': {
    DirectoryMemberRow: ({member, children}: any) => React.createElement('article', {className: 'directory-member'}, React.createElement('h3', null, member.nickname), children),
    loadLabels: async () => ({}),
  },
  './member-inbox': {announceInboxChange: () => {}},
  './MemberBlocking': {BlockedMembers: () => null, MemberBlockingAction: () => null},
  './friends-directory-controller': friendsController,
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

const {WorkContributionRoles} = load('../../apps/portal-web/src/modules/ContributionOutcomes.tsx', {
  './AgentHandoff': {AgentHandoff: () => null},
  '../format': {formatIsoLocal: (v: string) => v},
  './shared': {useModuleMutation: () => ({mutate: async () => null, busy: false, error: null, setError: () => {}}) },
});

function isHiddenInTree(node: HostNode): boolean {
  for (let n: HostNode | null = node; n; n = n.parentNode) {
    if (n.hasAttribute('hidden')) return true;
    if (n.nodeName !== 'SUMMARY' && n.parentNode?.nodeName === 'DETAILS' && !n.parentNode.hasAttribute('open')) return true;
  }
  return false;
}

function visiblePrimaries(root: HostNode): HostNode[] {
  return descendants(root).filter(n => !isHiddenInTree(n) && (n.attributes.class ?? '').split(/\s+/).includes('btn-primary'));
}

function visibleButtonsAndLinks(root: HostNode): HostNode[] {
  return descendants(root).filter(n => !isHiddenInTree(n) && (n.nodeName === 'BUTTON' || n.nodeName === 'A' || n.nodeName === 'SUMMARY'));
}

function mount(t: TestContext, element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as any);
  flush(() => root.render(element));
  t.after(() => {flush(() => root.unmount()); container.parentNode?.removeChild(container);});
  return {
    container,
    click: (node: HostNode) => flush(() => node.dispatchEvent({type: 'click', button: 0})),
    settled: async () => {await React.act(async () => {await new Promise(resolve => setTimeout(resolve, 20));});},
  };
}

test('UX-M-05 MemberServices: delete confirm is never primary and filters are collapsed when services exist', async t => {
  const sampleService = {
    service_id: 'svc-1', title: '翻譯服務', category: 'translation', category_label: '翻譯', summary: '協助文件翻譯',
    description: null, price_text: null, area_text: null, service_mode: 'online', contacts: [{label: '網站', url: 'https://example.invalid'}],
    state: 'active', aggregate_version: 1, cover_url: null, owner: {user_id: 'u-1', display_name: '作者', avatar_url: null},
    public_path: '/services/svc-1', total_points: 0, mine: true, can_hide: false,
  };
  const client: any = {
    sessionGeneration: 1,
    get: async (path: string) => path === '/me/services' ? {items: [sampleService], limit: 5} : {items: [sampleService], next_cursor: null, can_hide: false},
  };
  const h = mount(t, React.createElement(MemberServices, {client}));
  await h.settled();
  assert.equal(visiblePrimaries(h.container).length, 1);
  const deleteButtons = descendants(h.container).filter(n => n.nodeName === 'BUTTON' && n.textContent === '刪除');
  h.click(deleteButtons[0]);
  const confirmDelete = descendants(h.container).find(n => n.nodeName === 'BUTTON' && n.textContent === '確定刪除' && !isHiddenInTree(n))!;
  assert.equal((confirmDelete.attributes.class ?? '').split(/\s+/).includes('btn-primary'), false);
  assert.equal(visiblePrimaries(h.container).length, 1);
  // Category filters must be tucked behind a <details> summary so visible filter buttons do not blow past <=3 actions.
  const visibleCategoryFilters = descendants(h.container).filter(n => !isHiddenInTree(n) && (n.attributes.class ?? '').split(/\s+/).includes('service-filter'));
  assert.equal(visibleCategoryFilters.length, 0);
});

test('UX-M-05 FriendsPanel: single primary across empty, non-empty, and multi-incoming states; no duplicate members CTA', async t => {
  const makeClient = (itemsByScope: Record<string, any[]>) => ({
    sessionGeneration: 1,
    get: async (path: string) => {
      const url = new URL('https://fixture.invalid' + path);
      const scope = url.searchParams.get('scope') ?? 'accepted';
      const items = itemsByScope[scope] ?? [];
      return {items, total: items.length, next_offset: null};
    },
  });
  const baseProps = (client: any, initialScope: 'accepted' | 'incoming' = 'accepted') => ({
    client,
    session: {user: {user_id: 'u-1', nickname: '測試'}},
    initialScope,
    memberBlockingEnabled: true,
    onNavigate: () => {},
    onMessage: () => {},
  });

  // Empty accepted: 1 primary (認識工坊夥伴), no duplicate 找新夥伴, filters inside <details>.
  const hEmpty = mount(t, React.createElement(FriendsPanel, baseProps(makeClient({accepted: []}))));
  await hEmpty.settled();
  assert.equal(visiblePrimaries(hEmpty.container).length, 1);
  assert.equal(visiblePrimaries(hEmpty.container)[0].textContent, '認識工坊夥伴');
  assert.equal(descendants(hEmpty.container).filter(n => n.nodeName === 'BUTTON' && n.textContent === '找新夥伴').length, 0);
  assert.equal(visibleButtonsAndLinks(hEmpty.container).length <= 4, true);

  // Non-empty accepted: 1 primary (找新夥伴), 封鎖設定 tucked inside <details>, <=3 non-primary screen actions outside rows.
  const friend = {user_id: 'u-2', nickname: '好友A', last_seen_at: null, is_online: false, tags: []};
  const hAccepted = mount(t, React.createElement(FriendsPanel, baseProps(makeClient({accepted: [friend]}))));
  await hAccepted.settled();
  assert.equal(visiblePrimaries(hAccepted.container).length, 1);
  assert.equal(visiblePrimaries(hAccepted.container)[0].textContent, '找新夥伴');
  const visibleBlockButtons = descendants(hAccepted.container).filter(n => !isHiddenInTree(n) && n.nodeName === 'BUTTON' && n.textContent === '封鎖設定');
  assert.equal(visibleBlockButtons.length, 0);

  // Incoming with 2 items: exactly 1 primary (first 接受邀請), not 2 or 3.
  const incoming = [
    {user_id: 'u-3', nickname: '邀請A', last_seen_at: null, is_online: false, tags: []},
    {user_id: 'u-4', nickname: '邀請B', last_seen_at: null, is_online: false, tags: []},
  ];
  const hIncoming = mount(t, React.createElement(FriendsPanel, baseProps(makeClient({incoming}), 'incoming')));
  await hIncoming.settled();
  assert.equal(visiblePrimaries(hIncoming.container).length, 1);
  assert.equal(visiblePrimaries(hIncoming.container)[0].textContent, '接受邀請');
});

test('UX-M-05 SquadsPanel: exactly one primary button across list and create views', async t => {
  const client: any = {
    sessionGeneration: 1,
    get: async () => ({items: [], next_offset: null}),
  };
  const h = mount(t, React.createElement(SquadsPanel, {
    client,
    session: {user: {user_id: 'u-1', nickname: '測試'}},
    onNavigate: () => {},
  }));
  await h.settled();
  assert.equal(visiblePrimaries(h.container).length, 1);
  h.click(visiblePrimaries(h.container)[0]);
  assert.equal(visiblePrimaries(h.container).length, 1);
  assert.equal(descendants(h.container).filter(n => (n.attributes.class ?? '').split(/\s+/).includes('btn-primary')).length, 1);
});

test('UX-M-05 WorkContributionRoles: at most one primary when confirming a role alongside the form', async t => {
  const client: any = {
    sessionGeneration: 1,
    get: async () => ({
      work_item_id: 'w-1', title: '工作', work_state: 'accepted', accepted_at: '2026-01-01T00:00:00Z', next_offset: null,
      items: [{
        role_id: 'r-1', work_item_id: 'w-1', role: 'design', state: 'pending', summary: '設計', evidence_ref: 'art:1',
        payload_sha256: 'abc', aggregate_version: '1', member_name: '夥伴', member_ref: 'u-2', is_self: false, can_confirm: true,
        confirmer_name: null, confirmed_at: null,
      }],
    }),
  };
  const h = mount(t, React.createElement(WorkContributionRoles, {client, workItemId: 'w-1'}));
  const summary = descendants(h.container).find(n => n.nodeName === 'SUMMARY')!;
  h.click(summary);
  await h.settled();
  const reviewBtn = descendants(h.container).find(n => n.nodeName === 'BUTTON' && n.textContent === '閱讀並確認')!;
  h.click(reviewBtn);
  assert.equal(visiblePrimaries(h.container).length, 1);
});
