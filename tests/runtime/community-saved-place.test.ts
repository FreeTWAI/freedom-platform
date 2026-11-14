import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {Suspense, act, createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {PortalClient} from '../../apps/portal-web/src/api.js';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return {format: 'module', source: '', shortCircuit: true};
    return nextLoad(url, context);
  },
});

const {PlaceView} = await import('../../apps/portal-web/src/features/PlaceView.js');
const {CommunityRelationsProvider, CommunityRelations} = await import('../../apps/portal-web/src/modules/CommunityRelations.js');
const {communityListHistoryForSession} = await import('../../apps/portal-web/src/modules/community-search-controller.js');

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

function installDom(initialHash = '#me/saved') {
  const docListeners: Record<string, Function[]> = {};
  const winListeners: Record<string, Function[]> = {};
  const locationObj = {hash: initialHash, pathname: '/', search: ''};
  const replaceStateCalls: Array<{state: any; url?: string}> = [];
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
    addEventListener: (t: string, fn: Function) => (docListeners[t] ??= []).push(fn),
    removeEventListener: (t: string, fn: Function) => {
      docListeners[t] = (docListeners[t] ?? []).filter(x => x !== fn);
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
        replaceStateCalls.push({state: s, url});
        this.state = s;
        if (url && url.includes('#')) locationObj.hash = url.slice(url.indexOf('#'));
      },
      pushState(s: any, _t: string, url?: string) {
        this.state = s;
        if (url && url.includes('#')) locationObj.hash = url.slice(url.indexOf('#'));
      },
    },
    addEventListener: (t: string, fn: Function) => (winListeners[t] ??= []).push(fn),
    removeEventListener: (t: string, fn: Function) => {
      winListeners[t] = (winListeners[t] ?? []).filter(x => x !== fn);
    },
    dispatchEvent: (event: any) => {
      for (const fn of [...(winListeners[event.type] ?? [])]) fn(event);
      return !event.defaultPrevented;
    },
  };
  (globalThis as any).window = win;
  return {doc, win, replaceStateCalls};
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

function makeClient(bookmarksCount = 8) {
  const client = new PortalClient();
  const getPaths: string[] = [];
  const bookmarks = Array.from({length: bookmarksCount}, (_, i) => ({
    relation_id: `bm-${i + 1}`,
    kind: 'post' as const,
    id: `post-${i + 1}`,
    content: {
      kind: 'post' as const,
      id: `post-${i + 1}`,
      title: `收藏文章 ${i + 1}`,
      summary: `摘要 ${i + 1}`,
      path: `#post/${i + 1}`,
      label: null,
      author_id: '00000000-0000-4000-8000-000000000002',
      media_path: null,
      topics: ['intro' as const],
    },
  }));
  client.get = (async (path: string) => {
    getPaths.push(path);
    if (path.startsWith('/community-relations/bookmarks')) return {items: bookmarks, next_cursor: null};
    if (path === '/community-relations/follows') return {items: []};
    if (path.startsWith('/community-relations/updates')) return {items: [], next_cursor: null};
    return {items: [], next_cursor: null};
  }) as any;
  return {client, getPaths};
}

function makeContext(client: PortalClient, locationHash: string, relationsEnabled: boolean) {
  return {
    client,
    session: {
      authenticated: true,
      user: {user_id: 'u1', display_name: '測試員', email: 'u@example.test', role: 'member'},
    } as any,
    site: {
      community_search_enabled: true,
      community_relations_enabled: relationsEnabled,
      guild_launchpad_enabled: true,
      personal_content_enabled: true,
    } as any,
    locationHash,
    canManageGuild: false,
    canManagePlatform: false,
    selectTab: () => {},
    openHomeJournal: () => {},
    registerPageLeave: () => () => {},
  };
}

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 20; i += 1) {
    if (check()) return;
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  }
}

test('relations on: 我的檢視 offers 書籤與追蹤 after 個人頁 and #me/saved renders the three-tab panel', async () => {
  const {doc} = installDom('#me/saved');
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);
  const {client} = makeClient(8);
  const ctx = makeContext(client, '#me/saved', true);

  await act(async () => {
    root.render(
      createElement(
        Suspense,
        {fallback: createElement('p', null, '載入中…')},
        createElement(PlaceView, {
          context: ctx as any,
          defaultTab: 'profile',
          render: () => createElement('p', null, '個人頁內容'),
        }),
      ),
    );
  });
  await waitFor(() => findAll(container, n => n.getAttribute('aria-label') === '我的私人書籤與追蹤').length > 0);

  const picker = findAll(container, n => n.nodeName === 'SELECT' && n.getAttribute('aria-label') === '我的檢視')[0];
  assert.equal(Boolean(picker), true);
  const optionTitles = picker.options.map(o => o.textContent);
  assert.equal(optionTitles[0], '個人頁');
  assert.equal(optionTitles[1], '書籤與追蹤');
  assert.equal(picker.options[1].value || picker.options[1].attributes.value, '#me/saved');

  const panel = findAll(container, n => n.getAttribute('aria-label') === '我的私人書籤與追蹤')[0];
  assert.equal(Boolean(panel), true);
  const tabGroup = findAll(panel, n => n.getAttribute('aria-label') === '選擇私人清單')[0];
  assert.equal(Boolean(tabGroup), true);
  const tabButtons = findAll(tabGroup, n => n.nodeName === 'BUTTON').slice(0, 3);
  assert.deepEqual(tabButtons.map(b => b.textContent), ['私人書籤', '追蹤清單', '追蹤更新']);
  assert.equal(findAll(panel, n => n.nodeName === 'ARTICLE').length, 5);
  const moreBookmarks = findAll(panel, n => n.nodeName === 'BUTTON' && n.textContent === '更多')[0];
  assert.equal(Boolean(moreBookmarks), true);
  await act(async () => { clickNode(moreBookmarks); });
  assert.equal(findAll(panel, n => n.nodeName === 'ARTICLE').length, 8);

  await act(async () => { root.unmount(); });
});

test('relations off: 我的檢視 omits 書籤與追蹤 and #me/saved shows disabled message without requesting /community-relations', async () => {
  const {doc} = installDom('#me/saved');
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);
  const {client, getPaths} = makeClient(8);
  const ctx = makeContext(client, '#me/saved', false);

  await act(async () => {
    root.render(
      createElement(
        Suspense,
        {fallback: createElement('p', null, '載入中…')},
        createElement(PlaceView, {
          context: ctx as any,
          defaultTab: 'profile',
          render: () => createElement('p', null, '個人頁內容'),
        }),
      ),
    );
  });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });

  const picker = findAll(container, n => n.nodeName === 'SELECT' && n.getAttribute('aria-label') === '我的檢視')[0];
  assert.equal(Boolean(picker), true);
  assert.equal(picker.options.some(o => o.textContent === '書籤與追蹤'), false);
  assert.equal(findAll(container, n => n.getAttribute('aria-label') === '我的私人書籤與追蹤').length, 0);
  assert.equal(findAll(container, n => n.nodeName === 'P' && n.textContent === '這個社群尚未開放書籤與追蹤。').length, 1);
  assert.equal(getPaths.filter(p => p.includes('/community-relations')).length, 0);

  await act(async () => { root.unmount(); });
});

test('on #me/saved choosing 追蹤 writes freedomCommunityList and popstate restores it; on #explore writes nothing', async () => {
  const {doc, win, replaceStateCalls} = installDom('#me/saved');
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container);
  const {client} = makeClient(3);
  const ctx = makeContext(client, '#me/saved', true);

  await act(async () => {
    root.render(
      createElement(
        Suspense,
        {fallback: createElement('p', null, '載入中…')},
        createElement(PlaceView, {
          context: ctx as any,
          defaultTab: 'profile',
          render: () => createElement('p', null, '個人頁內容'),
        }),
      ),
    );
  });
  await waitFor(() => findAll(container, n => n.getAttribute('aria-label') === '我的私人書籤與追蹤').length > 0);

  const bookmarksBtn = () => findAll(container, n => n.nodeName === 'BUTTON' && n.textContent === '私人書籤')[0];
  const followsBtn = () => findAll(container, n => n.nodeName === 'BUTTON' && n.textContent === '追蹤清單')[0];
  assert.equal(bookmarksBtn().getAttribute('aria-pressed'), 'true');
  assert.equal(followsBtn().getAttribute('aria-pressed'), 'false');

  await act(async () => { clickNode(followsBtn()); });
  assert.equal(followsBtn().getAttribute('aria-pressed'), 'true');
  assert.equal(replaceStateCalls.length > 0, true);
  const savedFollows = structuredClone(win.history.state);
  assert.equal(savedFollows?.freedomCommunityList?.version, 1);
  assert.equal(savedFollows?.freedomCommunityList?.tab, 'follows');
  assert.equal(typeof savedFollows?.freedomCommunityList?.epoch, 'string');

  await act(async () => { clickNode(bookmarksBtn()); });
  assert.equal(bookmarksBtn().getAttribute('aria-pressed'), 'true');
  assert.equal(followsBtn().getAttribute('aria-pressed'), 'false');
  assert.equal(win.history.state?.freedomCommunityList?.tab, 'bookmarks');

  win.history.state = savedFollows;
  await act(async () => { win.dispatchEvent({type: 'popstate', state: savedFollows, defaultPrevented: false}); });
  assert.equal(followsBtn().getAttribute('aria-pressed'), 'true');
  assert.equal(bookmarksBtn().getAttribute('aria-pressed'), 'false');
  await act(async () => { root.unmount(); });

  // On #explore the panel writes nothing to history and ignores popstate
  const exploreDom = installDom('#explore');
  const exploreContainer = exploreDom.doc.createElement('div');
  exploreDom.doc.body.appendChild(exploreContainer);
  const exploreRoot = createRoot(exploreContainer);
  const {client: exploreClient} = makeClient(3);
  const authKey = `u1:${exploreClient.sessionGeneration}`;
  const navigation = communityListHistoryForSession(exploreClient, authKey);

  await act(async () => {
    exploreRoot.render(
      createElement(CommunityRelationsProvider, {
        client: exploreClient,
        children: createElement(CommunityRelations, {client: exploreClient, navigation}),
      }),
    );
  });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });

  const exploreFollows = findAll(exploreContainer, n => n.nodeName === 'BUTTON' && n.textContent === '追蹤清單')[0];
  assert.equal(Boolean(exploreFollows), true);
  await act(async () => { clickNode(exploreFollows); });
  assert.equal(exploreFollows.getAttribute('aria-pressed'), 'true');
  assert.equal(exploreDom.replaceStateCalls.length, 0);
  assert.equal(exploreDom.win.history.state, null);

  await act(async () => { exploreRoot.unmount(); });
});
