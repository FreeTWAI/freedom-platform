import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import React from 'react';
import { createRoot } from 'react-dom/client';

class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, any> = { setProperty() {}, removeProperty() {} };
  listeners: Record<string, { fn: Function; capture: boolean }[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  value = '';
  checked = false;
  disabled = false;
  open = false;
  tabIndex = 0;
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
  }
  get className() { return this.attributes.class ?? ''; }
  set className(v: string) { this.attributes.class = v; }
  get options() { return walk(this).filter((c) => c !== this && c.nodeName === 'OPTION'); }
  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? '';
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.childNodes = v ? [this.ownerDocument.createTextNode(String(v))] : [];
    for (const c of this.childNodes) c.parentNode = this;
  }
  appendChild(node: HostNode) {
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  insertBefore(node: HostNode, ref: HostNode | null) {
    if (!ref) return this.appendChild(node);
    node.parentNode?.removeChild(node);
    const idx = this.childNodes.indexOf(ref);
    this.childNodes.splice(idx === -1 ? this.childNodes.length : idx, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node: HostNode) {
    const idx = this.childNodes.indexOf(node);
    if (idx !== -1) { this.childNodes.splice(idx, 1); node.parentNode = null; }
    return node;
  }
  setAttribute(k: string, v: string) {
    this.attributes[k] = String(v);
    if (k === 'disabled') this.disabled = true;
    if (k === 'open') this.open = true;
  }
  removeAttribute(k: string) {
    delete this.attributes[k];
    if (k === 'disabled') this.disabled = false;
    if (k === 'open') this.open = false;
  }
  getAttribute(k: string) { return this.attributes[k] ?? null; }
  hasAttribute(k: string) { return k in this.attributes; }
  addEventListener(type: string, fn: Function, capture = false) {
    (this.listeners[type] ??= []).push({ fn, capture: Boolean(capture) });
  }
  removeEventListener(type: string, fn: Function) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((e) => e.fn !== fn);
  }
  dispatchEvent(ev: any) {
    ev.target ??= this;
    ev.currentTarget = this;
    for (const entry of [...(this.listeners[ev.type] ?? [])]) entry.fn(ev);
    if (ev.bubbles !== false && this.parentNode) this.parentNode.dispatchEvent(ev);
    return !ev.defaultPrevented;
  }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  contains(node: HostNode): boolean { return node === this || this.childNodes.some((c) => c.contains(node)); }
  querySelector(sel: string) {
    const m = sel.match(/^\[data-guide-anchor="([^"]+)"\]$/);
    if (m) return walk(this).find((n) => n.attributes['data-guide-anchor'] === m[1]) ?? null;
    return null;
  }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() {
    this.dispatchEvent({ type: 'click', bubbles: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
  }
}

function makeDoc() {
  const doc: any = {
    nodeType: 9,
    body: null as any,
    documentElement: null as any,
    activeElement: null as any,
    defaultView: null as any,
    createElement(tag: string) { return new HostNode(1, tag.toUpperCase(), doc); },
    createElementNS(_ns: string, tag: string) { return new HostNode(1, tag.toUpperCase(), doc); },
    createTextNode(text: string) { const n = new HostNode(3, '#text', doc); n.nodeValue = text; return n; },
    createComment() { return new HostNode(8, '#comment', doc); },
    getElementById(id: string) { return walk(doc.body).find((n) => n.attributes.id === id) ?? null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
  };
  doc.documentElement = new HostNode(1, 'HTML', doc);
  doc.body = new HostNode(1, 'BODY', doc);
  doc.documentElement.appendChild(doc.body);
  return doc;
}

function walk(root: HostNode): HostNode[] {
  const out: HostNode[] = [root];
  for (const c of root.childNodes) out.push(...walk(c));
  return out;
}

function hasClass(node: HostNode, cls: string): boolean {
  return (node.attributes.class ?? '').split(/\s+/).includes(cls);
}

function visibleOutsideDetails(root: HostNode): HostNode[] {
  const out: HostNode[] = [];
  function visit(node: HostNode) {
    out.push(node);
    if (node.nodeName === 'DETAILS' && !node.open) {
      const summary = node.childNodes.find((c) => c.nodeName === 'SUMMARY');
      if (summary) visit(summary);
      return;
    }
    for (const c of node.childNodes) visit(c);
  }
  visit(root);
  return out;
}

const compiled = buildSync({
  stdin: {
    contents: `
      export { ShowcasePanel } from './apps/portal-web/src/modules/ShowcasePanel';
      export { RepositoryLibrary, CommunityPanel } from './apps/portal-web/src/modules/Community';
      export { SkillsPanel } from './apps/portal-web/src/modules/SkillsPanel';
      export { GitHubSocialProvider } from './apps/portal-web/src/modules/GitHubSocial';
      export { PortalContext, client } from './apps/portal-web/src/portal-session';
      export { setSharingDraftAccount } from './apps/portal-web/src/modules/authoring-drafts';
      export { LanguageProvider } from './apps/portal-web/src/language';
    `,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  loader: { '.css': 'empty' },
  logLevel: 'silent',
}).outputFiles[0].text;

function setupEnv(t: any) {
  const doc = makeDoc();
  const prev = {
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    localStorage: (globalThis as any).localStorage,
    IntersectionObserver: (globalThis as any).IntersectionObserver,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT,
  };
  const storage = new Map<string, string>();
  const win: any = {
    document: doc,
    HTMLIFrameElement: class {},
    location: { hash: '#explore/works', href: 'http://127.0.0.1:46502/#explore/works', origin: 'http://127.0.0.1:46502' },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
    },
    addEventListener() {},
    removeEventListener() {},
    history: { replaceState() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  doc.defaultView = win;
  Object.assign(globalThis, {
    window: win,
    document: doc,
    localStorage: win.localStorage,
    IntersectionObserver: undefined,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const entry = { exports: {} as any };
  new Function('require', 'module', 'exports', compiled)(createRequire(import.meta.url), entry, entry.exports);
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  t.after(() => {
    root.unmount();
    Object.assign(globalThis, prev);
  });
  return { container, root, ...entry.exports };
}

test('UX-M-06: ShowcasePanel shortens empty states <= 24 chars and caps opportunities at 20 + 更多', async (t) => {
  const { container, root, ShowcasePanel, PortalContext, client, setSharingDraftAccount } = setupEnv(t);
  setSharingDraftAccount('me-user', client.sessionGeneration);
  const origGet = client.get.bind(client);
  let opportunities: any[] = [];
  client.get = async (path: string) => {
    if (path.startsWith('/showcases')) return { items: [], next_offset: null };
    if (path.startsWith('/opportunities')) return { items: opportunities };
    return origGet(path);
  };
  t.after(() => { client.get = origGet; });

  const portalValue = {
    session: { user: { user_id: 'me-user', email: 'me@local.test' }, csrf_token: 'test-csrf' },
    pending: null,
    mutate: async (_name: string, fn: () => Promise<void>) => { await fn(); },
    isMe: (ref: string) => ref === 'me-user',
  };

  await React.act(async () => {
    root.render(
      React.createElement(PortalContext.Provider, { value: portalValue }, React.createElement(ShowcasePanel, null)),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  const empties = walk(container).filter((n) => hasClass(n, 'empty'));
  assert.equal(empties.length, 2, 'renders empty states for showcases and opportunities');
  for (const empty of empties) {
    const len = empty.textContent.trim().length;
    assert.equal(len <= 24, true, `empty state must be <= 24 chars, got (${len}): ${empty.textContent}`);
  }

  opportunities = Array.from({ length: 24 }, (_, i) => ({
    opportunity_id: `opp-${i + 1}`,
    showcase_title: `作品 ${i + 1}`,
    state: 'open',
    need_summary: `需求 ${i + 1}`,
    client_ref: 'other-user',
    client_name: '詢問者',
    provider_ref: 'me-user',
    provider_name: '我自己',
  }));

  await React.act(async () => {
    root.render(
      React.createElement(PortalContext.Provider, { value: portalValue }, React.createElement(ShowcasePanel, { key: 'opp-list' })),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  const oppSection = walk(container).find((n) => n.attributes['data-guide-anchor'] === 'showcase:opportunities')!;
  assert.equal(Boolean(oppSection), true, 'opportunities section renders');
  const oppCards = () => walk(oppSection).filter((n) => n.nodeName === 'ARTICLE');
  assert.equal(oppCards().length, 20, 'caps opportunities initially at 20 per D6');

  const moreBtn = walk(oppSection).find((n) => n.nodeName === 'BUTTON' && n.textContent.trim() === '更多');
  assert.equal(Boolean(moreBtn), true, 'renders 更多 button when > 20 opportunities');
  await React.act(async () => { moreBtn!.click(); });
  assert.equal(oppCards().length, 24, 'clicking 更多 shows remaining opportunities');
});

test('UX-M-06: RepositoryLibrary collapses secondary filters behind 篩選 and SkillsPanel keeps <= 8 controls', async (t) => {
  const { container, root, RepositoryLibrary, SkillsPanel, GitHubSocialProvider } = setupEnv(t);
  const books = Array.from({ length: 3 }, (_, i) => ({
    id: `book-${i + 1}`,
    book_id: `book-${i + 1}`,
    title: `技能書 ${i + 1}`,
    description: `介紹 ${i + 1}`,
    upstream_url: `https://github.com/example/skill-${i + 1}`,
    fork_url: null,
    license_status: 'MIT',
    official_guild_keys: [],
    guide: { beginner: { category: '行銷', purpose: '寫貼文', audience: '個人', first_result: '完成一篇' }, author_name: '作者', source_evidence: [] },
  }));
  const fakeClient: any = {
    csrfToken: 'test-csrf',
    sessionGeneration: 1,
    async get(path: string) {
      if (path === '/me/skill-books') return { items: [] };
      if (path === '/community') return { name: '自由工坊', tagline: '', metrics: [], featured_projects: [], skill_books: books, project_links: [] };
      if (path.startsWith('/skills/submissions')) return { items: [] };
      if (path === '/skills/discovery') return { books: [] };
      if (path === '/github/account') return { configured: false, connected: false, github_user: null };
      return { items: [] };
    },
  };
  const session = { user: { user_id: 'me-user', email: 'me@local.test' }, csrf_token: 'test-csrf' };

  await React.act(async () => {
    root.render(
      React.createElement(GitHubSocialProvider, { client: fakeClient, session },
        React.createElement('div', null,
          React.createElement(SkillsPanel, { client: fakeClient, onNavigate() {} }),
          React.createElement(RepositoryLibrary, { client: fakeClient, title: '社群技能書' }),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  const skillsSection = walk(container).find((n) => hasClass(n, 'skills-panel'))!;
  assert.equal(skillsSection.textContent.includes('探索社群技能書'), false, 'removes redundant 探索社群技能書 jump link');

  const repoSection = walk(container).find((n) => hasClass(n, 'community-library'))!;
  const outsideRepoControls = visibleOutsideDetails(repoSection).filter((n) =>
    n.nodeName === 'INPUT' || n.nodeName === 'SELECT' || n.nodeName === 'SUMMARY' ||
    (n.nodeName === 'BUTTON' && !walk(n).some((p) => p === n)) ||
    (n.nodeName === 'BUTTON' && !hasClass(n, 'skill-intro-trigger'))
  );
  const filterSummaries = walk(repoSection).filter((n) => n.nodeName === 'SUMMARY' && n.textContent.trim() === '篩選');
  assert.equal(filterSummaries.length, 1, 'RepositoryLibrary collapses filters behind one 篩選 disclosure');
  const outsideSelects = visibleOutsideDetails(repoSection).filter((n) => n.nodeName === 'SELECT');
  assert.equal(outsideSelects.length, 0, 'purpose filter selects live inside 篩選 disclosure');
  const outsideFilterButtons = visibleOutsideDetails(repoSection).filter((n) =>
    n.nodeName === 'BUTTON' && ['全部', '本週', '本月', '今日', '官方'].includes(n.textContent.trim()),
  );
  assert.equal(outsideFilterButtons.length, 0, 'discovery filter tabs live inside 篩選 disclosure');
  assert.equal(outsideRepoControls.some((n) => n.nodeName === 'INPUT'), true, '搜尋技能書 stays visible');
});

test('UX-M-06: CommunityPanel keeps first view <= 8 controls and <= 120 static Chinese chars behind 更多', async (t) => {
  const { container, root, CommunityPanel, LanguageProvider } = setupEnv(t);
  const projectLinks = Array.from({ length: 23 }, (_, i) => ({
    title: `工坊專案 ${i + 1}`,
    url: `https://example.com/p-${i + 1}`,
    description: `說明 ${i + 1}`,
  }));
  const fakeClient: any = {
    async get(path: string) {
      if (path === '/community') {
        return {
          name: '自由工坊',
          tagline: '',
          metrics: [{ label: '合作紀錄', value: 42, as_of: '2026-11-01', note: '統計' }],
          featured_projects: [],
          skill_books: [],
          project_links: projectLinks,
        };
      }
      return { items: [] };
    },
  };

  await React.act(async () => {
    root.render(
      React.createElement(LanguageProvider, null,
        React.createElement(CommunityPanel, { client: fakeClient, onNavigate() {} }),
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  const panel = walk(container).find((n) => hasClass(n, 'freedom-community'))!;
  const visibleNodes = visibleOutsideDetails(panel);
  const visibleControls = visibleNodes.filter((n) => ['A', 'BUTTON', 'INPUT', 'SELECT', 'SUMMARY'].includes(n.nodeName));
  assert.equal(visibleControls.length <= 8, true, `first view controls must be <= 8, got ${visibleControls.length}`);

  const visibleText = visibleNodes
    .filter((n) => n.nodeType === 3)
    .map((n) => n.nodeValue ?? '')
    .join('')
    // exclude metric values/labels coming from data
    .replace(/合作紀錄|統計|2026-11-01|42|約/g, '');
  const zhCount = (visibleText.match(/[\u4e00-\u9fff]/g) ?? []).length;
  assert.equal(zhCount <= 120, true, `first view static Chinese chars must be <= 120, got ${zhCount}: ${visibleText}`);

  const moreSummary = walk(panel).find((n) => n.nodeName === 'SUMMARY' && n.textContent.trim() === '更多');
  assert.equal(Boolean(moreSummary), true, 'secondary community cards live inside 更多 disclosure');
  const projectCards = () => walk(panel).filter((n) => n.nodeName === 'ARTICLE' && hasClass(n, 'community-project'));
  assert.equal(projectCards().length, 20, 'caps project_links inside 更多 at 20 per D6');
});
