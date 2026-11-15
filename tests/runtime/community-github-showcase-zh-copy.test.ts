import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerReactDomTeardown } from './react-dom-teardown.js';

class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, any> = { setProperty() {}, removeProperty() {} };
  listeners: Record<string, { fn: Function; capture: boolean }[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  open = false;
  disabled = false;
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
  }
  get className() { return this.attributes.class ?? ''; }
  set className(v: string) { this.attributes.class = v; }
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
  addEventListener(type: string, fn: Function, capture = false) {
    (this.listeners[type] ??= []).push({ fn, capture });
  }
  removeEventListener(type: string, fn: Function) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((e) => e.fn !== fn);
  }
  dispatchEvent(ev: any) {
    ev.target ??= this;
    ev.currentTarget = this;
    for (const entry of [...(this.listeners[ev.type] ?? [])]) entry.fn(ev);
    if (ev.bubbles !== false && this.parentNode) this.parentNode.dispatchEvent(ev);
    return true;
  }
  contains(node: HostNode): boolean { return node === this || this.childNodes.some((c) => c.contains(node)); }
}

function makeDoc() {
  const doc: any = {
    nodeType: 9,
    body: null as any,
    documentElement: null as any,
    defaultView: null as any,
    createElement(tag: string) { return new HostNode(1, tag.toUpperCase(), doc); },
    createElementNS(_ns: string, tag: string) { return new HostNode(1, tag.toUpperCase(), doc); },
    createTextNode(text: string) { const n = new HostNode(3, '#text', doc); n.nodeValue = text; return n; },
    createComment() { return new HostNode(8, '#comment', doc); },
    addEventListener() {},
    removeEventListener() {},
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

const compiled = buildSync({
  stdin: {
    contents: `
      export { CommunityPanel } from './apps/portal-web/src/modules/Community';
      export { GitHubSocialProvider, GitHubSourceLinks, GitHubBookSocial } from './apps/portal-web/src/modules/GitHubSocial';
      export { ShowcasePanel } from './apps/portal-web/src/modules/ShowcasePanel';
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
  const teardown = registerReactDomTeardown(t, prev);
  const storage = new Map<string, string>();
  const win: any = {
    document: doc,
    HTMLIFrameElement: class {},
    location: { hash: '#guilds/community', href: 'http://127.0.0.1:46502/#guilds/community', origin: 'http://127.0.0.1:46502' },
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
  teardown.setRoot(root);
  return { container, root, teardown, ...entry.exports };
}

test('UX-M-09: CommunityPanel, GitHubSocial, and ShowcasePanel use Traditional Chinese headings/labels and short link text', async (t) => {
  const {
    container,
    root,
    teardown,
    CommunityPanel,
    GitHubSocialProvider,
    GitHubSourceLinks,
    GitHubBookSocial,
    ShowcasePanel,
    PortalContext,
    client,
    setSharingDraftAccount,
    LanguageProvider,
  } = setupEnv(t);

  setSharingDraftAccount('me-user', client.sessionGeneration);
  const origGet = client.get.bind(client);
  client.get = teardown.trackFn(async (path: string) => {
    if (path.startsWith('/showcases')) {
      return {
        items: [{
          showcase_id: 'sc-1',
          owner_ref: 'other-user',
          owner_name: '其他作者',
          title: '範例作品',
          description: '說明',
          artifact_ref: 'artifact:1',
          public_url: 'https://example.com/works/uuid-12345',
          aggregate_version: 1,
        }],
        next_offset: null,
      };
    }
    if (path.startsWith('/opportunities')) return { items: [] };
    return origGet(path);
  });
  teardown.onRestore(() => { client.get = origGet; });

  const fakeClient: any = teardown.trackClient({
    csrfToken: 'test-csrf',
    async get(path: string) {
      if (path === '/community') {
        return {
          name: '自由工坊',
          tagline: '',
          metrics: [{ label: '合作紀錄', value: 12, as_of: '2026-11-01', note: '統計' }],
          featured_projects: [],
          skill_books: [],
          project_links: [{ title: '示範專案', url: 'https://example.com/demo', description: '簡介' }],
        };
      }
      if (path === '/me/github') return { configured: true, connected: false, github_user: null };
      if (path.includes('/github/metrics')) {
        return { stargazers_count: 5, forks_count: 2, open_issues_count: 1, subscribers_count: 3, pushed_at: '2026-10-01T00:00:00Z', stale: false, error: null, archived: false, checked_at: '2026-10-01T00:00:00Z', language: 'TypeScript' };
      }
      return {};
    },
  });
  const session = { user: { user_id: 'me-user', email: 'me@local.test' }, csrf_token: 'test-csrf' };
  const portalValue = {
    session,
    pending: null,
    mutate: async (_name: string, fn: () => Promise<void>) => { await fn(); },
    isMe: (ref: string) => ref === 'me-user',
  };

  await React.act(async () => {
    root.render(
      React.createElement(LanguageProvider, null,
        React.createElement(PortalContext.Provider, { value: portalValue },
          React.createElement(GitHubSocialProvider, { client: fakeClient, session },
            React.createElement('div', null,
              React.createElement(CommunityPanel, { client: fakeClient, onNavigate() {} }),
              React.createElement(GitHubSourceLinks, { repositoryUrl: 'https://github.com/example/repo' }),
              React.createElement(GitHubBookSocial, { bookId: 'social-post', repositoryUrl: 'https://github.com/example/repo' }),
              React.createElement(ShowcasePanel, null),
            ),
          ),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  const fullText = container.textContent;
  assert.equal(fullText.includes('OUR FOOTPRINT'), false, 'OUR FOOTPRINT must be translated');
  assert.equal(fullText.includes('MADE IN THE WORKSHOP'), false, 'MADE IN THE WORKSHOP must be translated');
  assert.equal(fullText.includes('工作坊足跡'), true, 'renders Traditional Chinese 工作坊足跡');
  assert.equal(fullText.includes('工坊實作成果'), true, 'renders Traditional Chinese 工坊實作成果');
  assert.equal(/\bStar\b|\bFork\b|\bIssues?\b|\bWatch\b/.test(fullText), false, `no English Star/Fork/Issue/Watch in rendered UI: ${fullText}`);

  const links = walk(container).filter((n) => n.nodeName === 'A');
  const rawUrlLink = links.find((a) => a.textContent.includes('example.com/works/uuid-12345'));
  assert.equal(Boolean(rawUrlLink), false, 'ShowcaseCard link must not print raw URL text');
  const workLink = links.find((a) => a.getAttribute('href') === 'https://example.com/works/uuid-12345');
  assert.equal(workLink?.textContent.trim(), '查看作品 ↗');
});

test('GitHubBookSocial hides unknown star count, fork count, and null checked_at note', async (t) => {
  const { container, root, teardown, LanguageProvider, GitHubSocialProvider, GitHubBookSocial } = setupEnv(t);
  const fakeClient: any = teardown.trackClient({
    get: async (path: string) => {
      if (path === '/me/github') return { configured: true, connected: false, github_user: null };
      if (path.includes('zero-counts') && path.includes('/metrics')) {
        return { stargazers_count: 0, forks_count: 0, open_issues_count: null, subscribers_count: null, pushed_at: null, stale: false, error: null, archived: false, checked_at: null, language: 'TypeScript' };
      }
      if (path.includes('/metrics')) {
        return { stargazers_count: null, forks_count: null, open_issues_count: null, subscribers_count: null, pushed_at: null, stale: true, error: null, archived: false, checked_at: null, language: null };
      }
      return {};
    },
  });
  await React.act(async () => {
    root.render(
      React.createElement(LanguageProvider, null,
        React.createElement(GitHubSocialProvider, { client: fakeClient, session: { user: { user_id: 'u1' }, csrf_token: 'c1' } as any },
          React.createElement('div', null,
            React.createElement(GitHubBookSocial, { bookId: 'social-post', repositoryUrl: 'https://github.com/example/repo' }),
            React.createElement(GitHubBookSocial, {
              bookId: 'cached-null',
              repositoryUrl: 'https://github.com/example/cached',
              originalCache: { fetched_at: null, stale: true, full_name: 'example/cached', url: 'https://github.com/example/cached', original_author: 'example', stars: null, social_metrics: { forks_count: null, open_issues_count: null, subscribers_count: null, pushed_at: null } },
            }),
            React.createElement(GitHubBookSocial, { bookId: 'zero-counts', repositoryUrl: 'https://github.com/example/zero' }),
          ),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
  });
  const nodes = walk(container);
  assert.equal(nodes.filter((n) => (n.attributes.class ?? '').includes('github-star-count')).length, 1);
  assert.equal(nodes.filter((n) => (n.attributes.class ?? '').includes('github-fork-count')).length, 1);
  assert.equal(nodes.find((n) => (n.attributes.class ?? '').includes('github-star-count'))?.textContent, '0');
  assert.equal(nodes.find((n) => (n.attributes.class ?? '').includes('github-fork-count'))?.textContent, '0');
  assert.equal(container.textContent.includes('☆ —'), false);
  assert.equal(container.textContent.includes('上次取得的數據'), false);
  assert.equal(container.textContent.includes('數據更新'), false);
  const notes = nodes.filter((n) => (n.attributes.class ?? '').includes('github-metrics-note')).map((n) => n.textContent);
  assert.deepEqual(notes, ['TypeScript']);
  const starBtn = nodes.find((n) => (n.attributes.class ?? '').includes('github-star-control'));
  assert.equal(starBtn?.attributes.title?.includes('— 次加星') ?? false, false);
  const forkLink = nodes.find((n) => (n.attributes.class ?? '').includes('github-fork-link'));
  assert.equal(forkLink?.attributes.title?.includes('— 次複製') ?? false, false);
});
