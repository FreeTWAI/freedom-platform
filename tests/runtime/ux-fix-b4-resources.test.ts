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
  addEventListener(type: string, fn: Function, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    (this.listeners[type] ??= []).push({ fn, capture });
  }
  removeEventListener(type: string, fn: Function) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l.fn !== fn);
  }
  dispatchEvent(ev: any) {
    ev.target = ev.target ?? this;
    ev.currentTarget = this;
    ev.preventDefault = ev.preventDefault ?? (() => {});
    ev.stopPropagation = ev.stopPropagation ?? (() => {});
    for (const l of this.listeners[ev.type] ?? []) l.fn(ev);
    if (ev.bubbles !== false && this.parentNode) this.parentNode.dispatchEvent(ev);
    return true;
  }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  querySelector() { return null; }
  contains(node: HostNode): boolean { return node === this || this.childNodes.some((c) => c.contains(node)); }
}

function makeDoc() {
  const doc: any = {
    nodeType: 9,
    activeElement: null,
    createElement(tag: string) { return new HostNode(1, tag.toUpperCase(), doc); },
    createElementNS(_ns: string, tag: string) { return new HostNode(1, tag.toUpperCase(), doc); },
    createTextNode(text: string) { const n = new HostNode(3, '#text', doc); n.nodeValue = text; return n; },
    createComment() { return new HostNode(8, '#comment', doc); },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    getElementById(id: string) {
      return walk(doc.body).find((n) => n.attributes.id === id) ?? null;
    },
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

const compiled = buildSync({
  stdin: {
    contents: `
      export { SkillsPanel } from './apps/portal-web/src/modules/SkillsPanel';
      export { RepositoryLibrary } from './apps/portal-web/src/modules/Community';
      export { SkillBookCard } from './apps/portal-web/src/modules/SkillBookIntro';
      export { GitHubSocialProvider, GitHubConnectionPanel, GitHubConnectionSummary } from './apps/portal-web/src/modules/GitHubSocial';
      export { PortalClient } from './apps/portal-web/src/api';
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

function makeBooks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `book-${i + 1}`,
    book_id: `book-${i + 1}`,
    title: `技能書 ${i + 1}`,
    description: `介紹 ${i + 1}`,
    upstream_url: `https://github.com/example/skill-${i + 1}`,
    fork_url: null,
    license_status: 'MIT',
    official_guild_keys: i === 0 ? ['guild_ai_project'] : [],
  }));
}

function setupEnv(t: any) {
  const doc = makeDoc();
  const prev = {
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    IntersectionObserver: (globalThis as any).IntersectionObserver,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT,
  };
  const win: any = {
    document: doc,
    HTMLIFrameElement: class {},
    location: { hash: '#explore/resources', href: 'http://127.0.0.1:46502/#explore/resources', origin: 'http://127.0.0.1:46502' },
    addEventListener() {},
    removeEventListener() {},
    history: { replaceState() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  doc.defaultView = win;
  Object.assign(globalThis, {
    window: win,
    document: doc,
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
  return { doc, container, root, ...entry.exports };
}

function makeFakeClient(books: any[], configured = false) {
  return {
    csrfToken: 'test-csrf',
    sessionGeneration: 1,
    async get(path: string) {
      if (path === '/me/skill-books') return { items: [] };
      if (path === '/community') return { name: '自由工坊', tagline: '', metrics: [], featured_projects: [], skill_books: books, project_links: [] };
      if (path.startsWith('/skills/submissions')) return { items: [] };
      if (path === '/skills/discovery') return { books: [] };
      if (path === '/github/account') return { configured, connected: false, github_user: null };
      if (path.includes('/github-social')) return { stargazers_count: 10, forks_count: 2, open_issues_count: 1, subscribers_count: 1, pushed_at: '2026-10-01T00:00:00Z', stale: false, error: null, archived: false, checked_at: '2026-10-01T00:00:00Z', language: 'TypeScript' };
      return { items: [] };
    },
  };
}

test('UX-V-07: SkillsPanel shortens empty state <= 24 chars and hides unconfigured GitHub controls', async (t) => {
  const { container, root, SkillsPanel, GitHubSocialProvider } = setupEnv(t);
  const client = makeFakeClient(makeBooks(3), false);
  const session = { user: { user_id: 'me-user', email: 'me@local.test' }, csrf_token: 'test-csrf' };

  await React.act(async () => {
    root.render(
      React.createElement(
        GitHubSocialProvider,
        { client, session },
        React.createElement(SkillsPanel, { client, onNavigate() {} }),
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  const all = () => walk(container);
  const promptP = all().find((n) => n.parentNode && hasClass(n.parentNode, 'skill-unlock-prompt') && n.nodeName === 'P');
  assert.equal(Boolean(promptP), true, 'empty unlock prompt renders');
  assert.equal(promptP!.textContent.trim().length <= 24, true, `empty state must be <= 24 chars, got: ${promptP!.textContent}`);
  assert.equal(promptP!.textContent.trim(), '尚未解鎖，加入公會即可領取。');

  // At most one primary button on empty unlocked state
  const primaries = all().filter((n) => n.nodeName === 'BUTTON' && hasClass(n, 'btn-primary'));
  assert.equal(primaries.length, 1, 'exactly one btn-primary on empty unlocked state');

  // Unconfigured GitHub copy & disabled buttons must not render
  const text = container.textContent;
  assert.equal(text.includes('GitHub 連結尚未啟用'), false, 'unconfigured GitHub notice must be hidden');
  assert.equal(text.includes('GitHub Star 尚未啟用'), false, 'unconfigured GitHub Star notice must be hidden');
});

test('UX-V-07 / UX-M-06 / UX-M-09: RepositoryLibrary paginates at 20 + 更多 and SkillBookCard shows one action + 更多 without English Star/Fork', async (t) => {
  const { container, root, RepositoryLibrary, SkillBookCard, GitHubSocialProvider, GitHubConnectionPanel } = setupEnv(t);
  const books = makeBooks(25);
  const client = makeFakeClient(books, false);
  const session = { user: { user_id: 'me-user', email: 'me@local.test' }, csrf_token: 'test-csrf' };

  await React.act(async () => {
    root.render(
      React.createElement(
        GitHubSocialProvider,
        { client, session },
        React.createElement('div', null,
          React.createElement(RepositoryLibrary, { client, title: '社群技能書' }),
          React.createElement(GitHubConnectionPanel, null),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  const all = () => walk(container);
  const cards = () => all().filter((n) => n.nodeName === 'ARTICLE' && hasClass(n, 'skill-library-book'));
  assert.equal(cards().length, 20, 'initial list shows 20 rows per D6');

  const moreBtn = all().find((n) => n.nodeName === 'BUTTON' && n.textContent.trim() === '更多');
  assert.equal(Boolean(moreBtn), true, 'shows 更多 pagination button when > 20 rows');

  const text = container.textContent;
  assert.equal(text.includes('THE SHARED LIBRARY'), false, 'no English eyebrow THE SHARED LIBRARY');
  assert.equal(text.includes('GitHub 連結尚未啟用'), false, 'no disabled GitHub button when unconfigured');
  assert.equal(text.includes('前往 GitHub Star'), false, 'no unconfigured 前往 GitHub Star link');

  // Card face shows one action (閱讀技能書) and 更多 disclosure; 分享技能 & GitHub links live inside 更多
  const firstCard = cards()[0]!;
  const directButtonsOrLinksOutsideDetails = walk(firstCard).filter((n) => {
    if (n.nodeName !== 'BUTTON' && n.nodeName !== 'A') return false;
    let p: HostNode | null = n.parentNode;
    while (p && p !== firstCard) {
      if (p.nodeName === 'DETAILS' || p.nodeName === 'DIALOG') return false;
      p = p.parentNode;
    }
    return true;
  });
  assert.equal(directButtonsOrLinksOutsideDetails.length, 1, 'card face shows only one action outside 更多/dialog');
  assert.equal(directButtonsOrLinksOutsideDetails[0]?.textContent.trim(), '閱讀技能書');

  const cardMoreSummary = walk(firstCard).find((n) => n.nodeName === 'SUMMARY');
  assert.equal(cardMoreSummary?.textContent.trim(), '更多');

  // Inside card text: no English Star or Fork labels (when unconfigured and configured alike)
  assert.equal(/\bStar\b|\bFork\b|\bFollow\b/.test(firstCard.textContent), false, `no English Star/Fork/Follow on card: ${firstCard.textContent}`);
});
