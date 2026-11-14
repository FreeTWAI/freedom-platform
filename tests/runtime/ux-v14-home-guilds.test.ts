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

function makeGuild(index: number, active: boolean): GuildSummary {
  return {
    guild_key: `guild_${index}`,
    name: `測試公會 ${index}`,
    purpose: `公會目的 ${index}`,
    first_step: `第一步 ${index}`,
    track_count: 1,
    guild_master: null,
    is_primary: false,
    skill_books: [],
    membership: active ? {state: 'active', aggregate_version: 1} : null,
    tags: ['technology'],
  };
}

function session() {
  return {
    authenticated: true,
    user: {user_id: 'u1', display_name: '測試員', email: 'u@example.test', onboarding_required: false, onboarding_completed_at: '2026-01-01T00:00:00Z', role: 'member'},
  } as any;
}

test('UX-V-14: unswitched #guilds skips /me/guild-preferences/v2 and omits the pre-action fallback paragraph when no guild is joined', async () => {
  const paths: string[] = [];
  const client = new PortalClient();
  client.get = (async (path: string) => {
    paths.push(path);
    if (path === '/guilds/directory') return {items: [makeGuild(1, false), makeGuild(2, false)]};
    if (path === '/me/guild-preferences') return {primary_guild_key: null, secondary_guild_keys: [], aggregate_version: 1};
    if (path === '/guild-applications') return {items: []};
    if (path === '/me/guild-preferences/v2') throw Error('503 preference_mapping_unavailable');
    return {};
  }) as any;

  const container = doc.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(GuildsPanel, {
      client,
      session: session(),
      site: {guild_launchpad_enabled: true} as any,
      locationHash: 'guilds',
      registerPendingLeave: () => {},
      onNavigate: () => {},
    }));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });

  assert.equal(paths.includes('/me/guild-preferences/v2'), false);
  assert.equal(paths.includes('/guild-categories'), false);
  const heroNext = findAll(container, n => /\bguild-hub-next\b/.test(n.className))[0];
  assert.ok(heroNext);
  assert.equal(findAll(heroNext, n => n.nodeName === 'P').length, 0);
  const primaries = findAll(container, n => n.nodeName === 'BUTTON' && /\bbtn-primary\b/.test(n.className));
  assert.equal(primaries.length, 1);

  await act(async () => { root.unmount(); });
});

test('UX-V-14: switched #guilds with compatibility legacy_projection loads /me/guild-preferences/v2 and renders the category board', async () => {
  const paths: string[] = [];
  const guilds = [makeGuild(1, true), makeGuild(2, false)];
  const client = new PortalClient();
  client.get = (async (path: string) => {
    paths.push(path);
    if (path === '/guilds/directory') return {items: guilds};
    if (path === '/me/guild-preferences') return {primary_guild_key: 'guild_1', secondary_guild_keys: [], aggregate_version: 1, compatibility: 'legacy_projection'};
    if (path === '/guild-applications') return {items: []};
    if (path === '/me/guild-preferences/v2') {
      return {
        aggregate_version: 2,
        migration_state: 'switched',
        invalidated: [],
        legacy: null,
        primaries: [
          {category: 'internal', guild_key: 'guild_1'},
          {category: 'external', guild_key: null},
          {category: 'professional_industry', guild_key: null},
        ],
      };
    }
    if (path === '/guild-categories') {
      return {
        catalog_revision: '1',
        pending: [],
        categories: [
          {category: 'internal', section: '社群架構開發主力', items: [{guild_key: 'guild_1', name: '測試公會 1', category: 'internal', category_review: 'approved', catalog_revision: '1'}]},
          {category: 'external', section: '社群業務推廣主力', items: []},
          {category: 'professional_industry', section: '社群專業服務主力', items: []},
        ],
      };
    }
    return {};
  }) as any;

  const container = doc.createElement('div');
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(GuildsPanel, {
      client,
      session: session(),
      site: {guild_launchpad_enabled: true} as any,
      locationHash: 'guilds',
      registerPendingLeave: () => {},
      onNavigate: () => {},
    }));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });

  assert.equal(paths.includes('/me/guild-preferences/v2'), true);
  assert.equal(paths.includes('/guild-categories'), true);
  const boards = findAll(container, n => /\bguild-category-board\b/.test(n.className));
  assert.equal(boards.length, 1);

  await act(async () => { root.unmount(); });
});
