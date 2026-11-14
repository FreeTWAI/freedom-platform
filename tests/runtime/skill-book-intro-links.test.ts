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
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  contains(node: HostNode): boolean { return node === this || this.childNodes.some((c) => c.contains(node)); }
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
      export { SkillBookIntro } from './apps/portal-web/src/modules/SkillBookIntro';
      export { GitHubSocialProvider, GitHubBookSocial } from './apps/portal-web/src/modules/GitHubSocial';
      export { client } from './apps/portal-web/src/portal-session';
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
  const teardown = registerReactDomTeardown(t, prev);
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
  teardown.setRoot(root);
  return { container, root, teardown, ...entry.exports };
}

test('UX-M-10: SkillBookIntro hides duplicate 前往 GitHub 加星 ↗ link where 查看原作 Repo ↗ exists', async (t) => {
  const { container, root, teardown, SkillBookIntro, GitHubSocialProvider, GitHubBookSocial, client } = setupEnv(t);
  const origGet = client.get.bind(client);
  client.get = teardown.trackFn(async (path: string) => {
    if (path.includes('/original-cache')) return { cache: null };
    if (path.includes('/badges')) return { items: [] };
    if (path.includes('/install')) return { supported: false };
    return { items: [] };
  });
  teardown.onRestore(() => { client.get = origGet; });

  const repoUrl = 'https://github.com/example/social-post';
  const fakeSocialClient: any = teardown.trackClient({
    csrfToken: 'test-csrf',
    async get(path: string) {
      if (path === '/me/github') throw new Error('github unavailable');
      if (path.includes('/github/metrics')) {
        return { stargazers_count: 10, forks_count: 2, open_issues_count: 1, subscribers_count: 1, pushed_at: '2026-10-01T00:00:00Z', stale: false, error: null, archived: false, checked_at: '2026-10-01T00:00:00Z', language: 'TypeScript' };
      }
      return {};
    },
  });
  const session = { user: { user_id: 'me-user', email: 'me@local.test' }, csrf_token: 'test-csrf' };
  const book = {
    id: 'social-post',
    book_id: 'social-post',
    title: '社群貼文',
    description: '寫貼文',
    upstream_url: repoUrl,
    license_status: 'MIT',
  };

  await React.act(async () => {
    root.render(
      React.createElement(GitHubSocialProvider, { client: fakeSocialClient, session },
        React.createElement('div', null,
          React.createElement(SkillBookIntro, { book }),
          React.createElement('div', { className: 'standalone-social' },
            React.createElement(GitHubBookSocial, { bookId: 'social-post', repositoryUrl: repoUrl, compact: true }),
          ),
        ),
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  const trigger = walk(container).find((n) => n.nodeName === 'BUTTON' && n.textContent.trim() === '閱讀技能書')!;
  await React.act(async () => {
    trigger.click();
    await new Promise((r) => setTimeout(r, 30));
  });

  const dialog = walk(container).find((n) => n.nodeName === 'DIALOG')!;
  assert.equal(dialog.open, true, 'SkillBookIntro dialog opens');
  const dialogLinks = walk(dialog).filter((n) => n.nodeName === 'A');
  const repoLinks = dialogLinks.filter((a) => a.getAttribute('href') === repoUrl);
  assert.equal(repoLinks.some((a) => a.textContent.trim() === '查看原作 Repo ↗'), true, 'keeps 查看原作 Repo ↗ inside SkillBookIntro');
  assert.equal(repoLinks.some((a) => a.textContent.includes('前往 GitHub 加星')), false, 'removes duplicate 前往 GitHub 加星 ↗ inside SkillBookIntro');

  const standalone = walk(container).find((n) => (n.attributes.class ?? '').includes('standalone-social'))!;
  assert.equal(standalone.textContent.includes('前往 GitHub 加星 ↗'), true, 'standalone GitHubBookSocial still offers fallback on account error');
});
