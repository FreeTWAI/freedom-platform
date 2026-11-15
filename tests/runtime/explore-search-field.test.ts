import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {act, createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {PortalClient} from '../../apps/portal-web/src/api.js';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return {format: 'module', source: '', shortCircuit: true};
    return nextLoad(url, context);
  },
});

const {PlaceView} = await import('../../apps/portal-web/src/features/PlaceView.js');
const {CommunitySearch} = await import('../../apps/portal-web/src/modules/CommunitySearch.js');

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
  checked = false;
  selected = false;
  nodeValue = '';
  get options(): HostNode[] { return this.childNodes.filter(n => n.nodeName === 'OPTION'); }
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
  setAttribute(key: string, value: string) {
    this.attributes[key] = String(value);
    if (key === 'open') this.open = true;
  }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  removeAttribute(key: string) {
    delete this.attributes[key];
    if (key === 'open') this.open = false;
  }
  addEventListener(type: string, fn: Function) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: Function) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(item => item !== fn);
  }
  dispatchEvent(event: any) {
    if (!event.target) event.target = this;
    let cur: HostNode | null = this;
    while (cur) {
      event.currentTarget = cur;
      for (const fn of cur.listeners[event.type] ?? []) fn(event);
      if (event.cancelBubble) break;
      cur = cur.parentNode;
    }
    return !event.defaultPrevented;
  }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
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

function installDom(initialHash = '#explore') {
  const listeners: Record<string, Function[]> = {};
  const locationObj = {hash: initialHash, pathname: '/', search: ''};
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
  (globalThis as any).HTMLElement = HostNode;
  (globalThis as any).Element = HostNode;
  (globalThis as any).Node = HostNode;
  (globalThis as any).HTMLIFrameElement = class {};
  (globalThis as any).HTMLInputElement = HostNode;
  (globalThis as any).SVGElement = HostNode;
  (globalThis as any).localStorage = {getItem: () => null, setItem: () => {}, removeItem: () => {}};
  const win: any = {
    location: locationObj,
    history: {
      state: null,
      replaceState(s: any, _t: string, url?: string) {
        this.state = s;
        if (url && url.includes('#')) locationObj.hash = url.slice(url.indexOf('#'));
      },
      pushState(s: any, _t: string, url?: string) {
        this.state = s;
        if (url && url.includes('#')) locationObj.hash = url.slice(url.indexOf('#'));
      },
    },
    addEventListener: (t: string, fn: Function) => (listeners[t] ??= []).push(fn),
    removeEventListener: (t: string, fn: Function) => {
      listeners[t] = (listeners[t] ?? []).filter(x => x !== fn);
    },
    dispatchEvent: () => true,
  };
  (globalThis as any).window = win;
  return doc;
}

function findAll(root: HostNode, pred: (n: HostNode) => boolean): HostNode[] {
  const out: HostNode[] = [];
  if (pred(root)) out.push(root);
  for (const c of root.childNodes) out.push(...findAll(c, pred));
  return out;
}

function clickNode(node: HostNode) {
  node.dispatchEvent({
    type: 'click',
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.cancelBubble = true; },
  });
}

function makeContentItems(count: number) {
  return Array.from({length: count}, (_, i) => ({
    kind: 'post' as const,
    id: `post-${i + 1}`,
    title: `搜尋內容 ${i + 1}`,
    summary: `摘要 ${i + 1}`,
    path: `#post/${i + 1}`,
    label: null,
    author_id: '00000000-0000-4000-8000-000000000002',
    media_path: null,
    topics: ['intro' as const],
  }));
}

function makeBookmarks(count: number) {
  return Array.from({length: count}, (_, i) => ({
    relation_id: `bm-${i + 1}`,
    kind: 'post' as const,
    id: `post-${i + 1}`,
    content: makeContentItems(count)[i],
  }));
}

function makeClient(opts: {contentItems?: number; bookmarks?: number; guilds?: number; emptyContent?: boolean} = {}) {
  const client = new PortalClient();
  const items = opts.emptyContent ? [] : makeContentItems(opts.contentItems ?? 12);
  const bookmarks = makeBookmarks(opts.bookmarks ?? 8);
  const guilds = Array.from({length: opts.guilds ?? 5}, (_, i) => ({
    kind: 'guild' as const,
    guild_key: `guild_test_${i + 1}`,
    name: `測試公會 ${i + 1}`,
    purpose: `測試用途 ${i + 1}`,
    path: `#guilds/guild_test_${i + 1}`,
  }));
  client.get = (async (path: string) => {
    if (path.startsWith('/community-search?')) return {items, next_cursor: null};
    if (path.startsWith('/community-relations/bookmarks')) return {items: bookmarks, next_cursor: null};
    if (path === '/community-relations/follows') return {items: []};
    if (path.startsWith('/guilds/directory?')) return {items: guilds, next_cursor: null};
    return {items: [], next_cursor: null};
  }) as any;
  return client;
}

function makeContext(client: PortalClient, locationHash: string, selectCalls: Array<[string, string | undefined]> = []) {
  return {
    client,
    session: {
      authenticated: true,
      user: {user_id: 'u1', display_name: '測試員', email: 'u@example.test', role: 'member'},
    } as any,
    site: {
      community_search_enabled: true,
      community_relations_enabled: true,
      guild_launchpad_enabled: true,
      personal_content_enabled: true,
    } as any,
    locationHash,
    canManageGuild: true,
    canManagePlatform: false,
    selectTab: (tab: any, hash?: string) => selectCalls.push([tab, hash]),
    openHomeJournal: () => {},
    registerPageLeave: () => () => {},
  };
}

test('UX-M-04: #explore renders one search field, one primary 搜尋, one closed 篩選 disclosure, and 5 content rows + 更多', async () => {
  const doc = installDom('#explore');
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);
  const client = makeClient({contentItems: 12, bookmarks: 8});
  const ctx = makeContext(client, '#explore');

  await act(async () => {
    root.render(
      createElement(PlaceView, {
        context: ctx as any,
        defaultTab: 'community-search',
        render: (_tab, c) => createElement(CommunitySearch, {
          client: c.client,
          authKey: `${c.session.user.user_id}:${c.client.sessionGeneration}`,
          relationsEnabled: true,
          guildSearchEnabled: true,
        }),
      }),
    );
  });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });

  // No standalone PlaceFeatureSearch disclosure on #explore
  assert.equal(findAll(container, n => /\bplace-feature-search\b/.test(n.className)).length, 0);

  // Exactly 1 search input and 1 primary button ('搜尋')
  const searchInputs = findAll(container, n => n.nodeName === 'INPUT' && n.type === 'search');
  assert.equal(searchInputs.length, 1);
  const primaries = findAll(container, n => n.nodeName === 'BUTTON' && /\bbtn-primary\b/.test(n.className));
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].textContent, '搜尋');

  // No paragraph before the search form inside search conditions region
  const conditionRegion = findAll(container, n => n.getAttribute('aria-label') === '社群內容搜尋條件')[0];
  assert.ok(conditionRegion);
  const formIndex = conditionRegion.childNodes.findIndex(n => n.nodeName === 'FORM');
  assert.ok(formIndex >= 0);
  const preFormParagraphs = conditionRegion.childNodes.slice(0, formIndex).filter(n => n.nodeName === 'P');
  assert.equal(preFormParagraphs.length, 0);

  // Exactly one closed <details> labeled '篩選' containing filter checkboxes and topic editor, without bookmarks/follows
  const detailsList = findAll(container, n => n.nodeName === 'DETAILS');
  assert.equal(detailsList.length, 1);
  assert.equal(detailsList[0].open, false);
  const summary = detailsList[0].childNodes.find(n => n.nodeName === 'SUMMARY');
  assert.equal(summary?.textContent, '篩選');
  const checkboxesInside = findAll(detailsList[0], n => n.nodeName === 'INPUT' && n.type === 'checkbox');
  assert.equal(checkboxesInside.length, 9); // 4 kinds + 5 filter topics
  assert.equal(findAll(detailsList[0], n => n.getAttribute('aria-label') === '我的私人書籤與追蹤').length, 0);
  assert.equal(findAll(container, n => n.getAttribute('aria-label') === '我的私人書籤與追蹤').length, 0);
  assert.equal(findAll(detailsList[0], n => n.nodeName === 'BUTTON' && n.textContent === '編輯我的內容主題').length, 1);

  // Content search results cap at 5 rows + 更多, then reveal more on click
  const contentRegion = findAll(container, n => n.getAttribute('aria-label') === '社群內容搜尋結果')[0];
  assert.ok(contentRegion);
  assert.equal(findAll(contentRegion, n => n.nodeName === 'ARTICLE').length, 5);
  const moreContent = findAll(contentRegion, n => n.nodeName === 'BUTTON' && n.textContent === '更多')[0];
  assert.ok(moreContent);
  await act(async () => { clickNode(moreContent); });
  assert.equal(findAll(contentRegion, n => n.nodeName === 'ARTICLE').length, 10);

  await act(async () => { root.unmount(); });
});

test('UX-M-04: single #explore search field runs both feature search (capped 5 + 更多) and content/guild search', async () => {
  const doc = installDom('#explore?q=' + encodeURIComponent('我的'));
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);
  const selectCalls: Array<[string, string | undefined]> = [];
  const client = makeClient({contentItems: 2, guilds: 3, emptyContent: true});
  const ctx = makeContext(client, '#explore?q=' + encodeURIComponent('我的'), selectCalls);

  await act(async () => {
    root.render(
      createElement(PlaceView, {
        context: ctx as any,
        defaultTab: 'community-search',
        render: (_tab, c) => createElement(CommunitySearch, {
          client: c.client,
          authKey: `${c.session.user.user_id}:${c.client.sessionGeneration}`,
          relationsEnabled: true,
          guildSearchEnabled: true,
        }),
      }),
    );
  });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });

  // Feature results group appears under the single search field, capped at 5 + 更多
  const featureRegion = findAll(container, n => n.getAttribute('aria-label') === '功能搜尋結果')[0];
  assert.ok(featureRegion);
  const featureButtons = findAll(featureRegion, n => n.nodeName === 'BUTTON' && n.textContent !== '更多');
  assert.equal(featureButtons.length, 5);
  const featureMore = findAll(featureRegion, n => n.nodeName === 'BUTTON' && n.textContent === '更多')[0];
  assert.ok(featureMore);
  await act(async () => { clickNode(featureMore); });
  const expandedButtons = findAll(featureRegion, n => n.nodeName === 'BUTTON' && n.textContent !== '更多');
  assert.ok(expandedButtons.length > 5);

  // Clicking a feature result navigates via selectTab
  await act(async () => { clickNode(expandedButtons[0]); });
  assert.equal(selectCalls.length, 1);

  // Empty content state is <= 24 characters
  const contentRegion = findAll(container, n => n.getAttribute('aria-label') === '社群內容搜尋結果')[0];
  const emptyStatus = findAll(contentRegion, n => n.nodeName === 'P' && n.getAttribute('role') === 'status')[0];
  assert.ok(emptyStatus);
  assert.ok(emptyStatus.textContent.length > 0 && emptyStatus.textContent.length <= 24);

  // Guild results group renders alongside feature + content groups
  const guildRegion = findAll(container, n => n.getAttribute('aria-label') === '會員公會搜尋結果')[0];
  assert.ok(guildRegion);
  assert.equal(findAll(guildRegion, n => n.nodeName === 'ARTICLE').length, 3);

  await act(async () => { root.unmount(); });
});

test('UX-M-04: explore filter summary and result links keep 44px tap targets in styles.css', () => {
  const css = readFileSync('apps/portal-web/src/styles.css', 'utf8');
  assert.equal(/\.community-content-search\s+\.explore-filters\s*>\s*summary[^}]*min-height:\s*44px/.test(css), true, 'explore-filters summary needs 44px min-height');
  assert.equal(/\.community-content-search\s+article\s+h2\s+a[^}]*min-height:\s*44px/.test(css), true, 'result article links need 44px min-height');
});
