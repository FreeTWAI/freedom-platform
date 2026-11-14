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
  dispatchEvent() { return true; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
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
  get htmlFor() { return this.attributes.for ?? ''; }
  set htmlFor(v: string) { this.attributes.for = v; }
  get tabIndex() { return Number(this.attributes.tabindex ?? 0); }
  set tabIndex(v: number) { this.attributes.tabindex = String(v); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
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
    location: {hash: '#guilds'},
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
  (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};
  (globalThis as any).localStorage = {getItem: () => null, setItem: () => {}, removeItem: () => {}};
  return doc;
}

function findAll(root: HostNode, pred: (n: HostNode) => boolean, out: HostNode[] = []): HostNode[] {
  if (pred(root)) out.push(root);
  for (const child of root.childNodes) findAll(child, pred, out);
  return out;
}

const doc = installDom();
const {createRoot} = await import('react-dom/client');
const {GuildsPanel} = await import('../../apps/portal-web/src/modules/PositioningPanels.js');

function makeGuild(index: number, active: boolean, isPrimary = false): GuildSummary {
  return {
    guild_key: `guild_${index}`,
    name: `測試公會 ${index}`,
    purpose: `公會目的 ${index}`,
    first_step: `第一步 ${index}`,
    track_count: 1,
    guild_master: null,
    is_primary: isPrimary,
    skill_books: [],
    membership: active ? {state: 'active', aggregate_version: 1} : null,
    tags: ['technology'],
  };
}

function makeClient(guilds: GuildSummary[]) {
  const client = new PortalClient();
  client.get = (async (path: string) => {
    if (path === '/guilds/directory') return {items: guilds};
    if (path === '/me/guild-preferences') return {primary_guild_key: guilds.find(g => g.is_primary)?.guild_key ?? null, secondary_guild_keys: [], aggregate_version: 1};
    if (path === '/guild-applications') return {items: []};
    if (path === '/me/onboarding') return {completed: true, assessment_completed: true, required: true, state: 'completed', draft: null, result: null, primary_guild_key: guilds.find(g => g.is_primary)?.guild_key ?? null, skill_books: []};
    return {};
  }) as any;
  return client;
}

function session() {
  return {
    authenticated: true,
    user: {user_id: 'u1', display_name: '測試員', email: 'u@example.test', onboarding_required: false, onboarding_completed_at: '2026-01-01T00:00:00Z', role: 'member'},
    site: {guild_launchpad_enabled: true},
  } as any;
}

test('UX-F-07: #guilds with a joined guild keeps 進入我的公會 as the single primary and 1 action + 更多 per card', async () => {
  const guilds = [makeGuild(1, true, true), makeGuild(2, false), makeGuild(3, false)];
  const container = doc.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(GuildsPanel, {client: makeClient(guilds), session: session(), site: {guild_launchpad_enabled: true} as any, locationHash: 'guilds', registerPendingLeave: () => {}}));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });

  const primaries = findAll(container, n => n.nodeName === 'BUTTON' && /\bbtn-primary\b/.test(n.className));
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].textContent, '進入我的公會');

  const cards = findAll(container, n => n.nodeName === 'ARTICLE' && /\bguild-card\b/.test(n.className));
  assert.equal(cards.length, 3);
  for (const card of cards) {
    const controls = findAll(card, n => /\bguild-card-controls\b/.test(n.className))[0];
    assert.ok(controls);
    const directButtons = controls.childNodes.filter(n => n.nodeName === 'BUTTON');
    const details = controls.childNodes.filter(n => n.nodeName === 'DETAILS');
    assert.equal(directButtons.length, 1, `expected 1 direct action on ${card.getAttribute('aria-label')}, got ${directButtons.map(b => b.textContent).join(',')}`);
    assert.equal(details.length, 1, `expected 1 disclosure on ${card.getAttribute('aria-label')}`);
    const summary = details[0].childNodes.find(n => n.nodeName === 'SUMMARY');
    assert.equal(summary?.textContent, '更多');
  }

  await act(async () => { root.unmount(); });
});

test('UX-F-07: #guilds without any joined guild makes only the first recommended join button primary', async () => {
  const guilds = [makeGuild(1, false), makeGuild(2, false), makeGuild(3, false)];
  const container = doc.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(GuildsPanel, {client: makeClient(guilds), session: session(), site: {guild_launchpad_enabled: true} as any, locationHash: 'guilds', registerPendingLeave: () => {}}));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });

  const primaries = findAll(container, n => n.nodeName === 'BUTTON' && /\bbtn-primary\b/.test(n.className));
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].textContent, '加入測試公會 1');

  await act(async () => { root.unmount(); });
});
