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
  }
  removeAttribute(k: string) {
    delete this.attributes[k];
    if (k === 'disabled') this.disabled = false;
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
      export { GitHubSocialProvider, GitHubConnectionPanel, GitHubConnectionSummary, GitHubBookSocial, useGitHubSocialStore } from './apps/portal-web/src/modules/GitHubSocial';
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
    IntersectionObserver: (globalThis as any).IntersectionObserver,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT,
  };
  const win: any = {
    document: doc,
    HTMLIFrameElement: class {},
    location: { hash: '#explore/resources', href: 'http://127.0.0.1:46502/#explore/resources', origin: 'http://127.0.0.1:46502' },
    addEventListener() {},
    removeEventListener() {},
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
  return { container, root, ...entry.exports };
}

test('UX-M-07: GitHubSocial hides unavailable GitHub OAuth controls/notices when /me/github reports configured=false', async (t) => {
  const {
    container,
    root,
    GitHubSocialProvider,
    GitHubConnectionPanel,
    GitHubConnectionSummary,
    GitHubBookSocial,
    useGitHubSocialStore,
  } = setupEnv(t);

  let storeRef: any = null;
  function Probe() {
    storeRef = useGitHubSocialStore();
    return null;
  }

  const fakeClient: any = {
    csrfToken: 'test-csrf',
    async get(path: string) {
      if (path === '/me/github') return { configured: false, connected: false, github_user: null };
      if (path.includes('/github/metrics')) {
        return { stargazers_count: 10, forks_count: 2, open_issues_count: 1, subscribers_count: 1, pushed_at: '2026-10-01T00:00:00Z', stale: false, error: null, archived: false, checked_at: '2026-10-01T00:00:00Z', language: 'TypeScript' };
      }
      return {};
    },
  };
  const session = { user: { user_id: 'me-user', email: 'me@local.test' }, csrf_token: 'test-csrf' };

  await React.act(async () => {
    root.render(
      React.createElement(
        GitHubSocialProvider,
        { client: fakeClient, session },
        React.createElement('div', null,
          React.createElement(Probe, null),
          React.createElement(GitHubConnectionPanel, null),
          React.createElement(GitHubConnectionSummary, { returnTo: '#skills' }),
          React.createElement(GitHubBookSocial, { bookId: 'social-post', repositoryUrl: 'https://github.com/example/social-post', compact: true }),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  // Simulate stale star.reauthorize even though configured is false
  await React.act(async () => {
    storeRef.star('social-post').reauthorize = true;
    storeRef.account = { ...storeRef.account };
    storeRef.listeners?.forEach?.((fn: Function) => fn());
    // Force re-render via prop change
    root.render(
      React.createElement(
        GitHubSocialProvider,
        { client: fakeClient, session },
        React.createElement('div', null,
          React.createElement(Probe, null),
          React.createElement(GitHubConnectionPanel, null),
          React.createElement(GitHubConnectionSummary, { returnTo: '#skills' }),
          React.createElement(GitHubBookSocial, { bookId: 'social-post', repositoryUrl: 'https://github.com/example/social-post', compact: true, returnTo: '#explore/resources' }),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  const nodes = walk(container);
  assert.equal(nodes.some((n) => (n.attributes.class ?? '').includes('github-connection-panel')), false, 'GitHubConnectionPanel hidden when unconfigured');
  assert.equal(nodes.some((n) => (n.attributes.class ?? '').includes('github-connection-summary')), false, 'GitHubConnectionSummary hidden when unconfigured');
  assert.equal(nodes.some((n) => n.nodeName === 'BUTTON' && (n.attributes.class ?? '').includes('github-star-control')), false, 'Star button hidden when unconfigured');
  assert.equal(nodes.some((n) => n.nodeName === 'BUTTON' && n.textContent.includes('重新授權 GitHub')), false, 'reauthorize button hidden when unconfigured');
  assert.equal(container.textContent.includes('尚未啟用'), false, 'no 尚未啟用 unavailable notice');
  assert.equal(container.textContent.includes('前往 GitHub 加星'), false, 'no fallback external star link when unconfigured without error');
});
