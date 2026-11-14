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
  click() {
    this.dispatchEvent({ type: 'click', bubbles: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
  }
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

function hasClass(node: HostNode, cls: string): boolean {
  return (node.attributes.class ?? '').split(/\s+/).includes(cls);
}

const compiled = buildSync({
  stdin: {
    contents: `
      export { ShowcasePanel } from './apps/portal-web/src/modules/ShowcasePanel';
      export { SkillsPanel } from './apps/portal-web/src/modules/SkillsPanel';
      export { GitHubSocialProvider } from './apps/portal-web/src/modules/GitHubSocial';
      export { PortalContext, client } from './apps/portal-web/src/portal-session';
      export { setSharingDraftAccount } from './apps/portal-web/src/modules/authoring-drafts';
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

test('UX-M-08: ShowcasePanel puts primary action before paragraphs and SkillsPanel moves prose behind 說明', async (t) => {
  const { container, root, ShowcasePanel, SkillsPanel, GitHubSocialProvider, PortalContext, client, setSharingDraftAccount } = setupEnv(t);
  setSharingDraftAccount('me-user', client.sessionGeneration);
  const origGet = client.get.bind(client);
  client.get = async (path: string) => {
    if (path.startsWith('/showcases')) return { items: [], next_offset: null };
    if (path.startsWith('/opportunities')) return { items: [] };
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

  const allShowcaseNodes = walk(container);
  const firstActionIdx = allShowcaseNodes.findIndex((n) => n.nodeName === 'BUTTON' && hasClass(n, 'btn-primary'));
  const firstParaIdx = allShowcaseNodes.findIndex((n) => n.nodeName === 'P');
  assert.equal(firstActionIdx > 0, true, 'ShowcasePanel renders primary button');
  assert.equal(firstParaIdx > firstActionIdx, true, 'ShowcasePanel has no paragraph before primary button 發布作品');

  const fakeClient: any = {
    csrfToken: 'test-csrf',
    sessionGeneration: 1,
    async get(path: string) {
      if (path === '/me/skill-books') return { items: [] };
      if (path === '/community') return { name: '自由工坊', tagline: '', metrics: [], featured_projects: [], skill_books: [], project_links: [] };
      if (path.startsWith('/skills/submissions')) return { items: [] };
      if (path === '/skills/discovery') return { books: [] };
      if (path === '/me/github') return { configured: false, connected: false, github_user: null };
      return { items: [] };
    },
  };
  const session = { user: { user_id: 'me-user', email: 'me@local.test' }, csrf_token: 'test-csrf' };

  await React.act(async () => {
    root.render(
      React.createElement(GitHubSocialProvider, { client: fakeClient, session },
        React.createElement(SkillsPanel, { client: fakeClient, onNavigate() {} }),
      ),
    );
    await new Promise((r) => setTimeout(r, 30));
  });

  const skillsNodes = walk(container);
  const guideDetails = skillsNodes.find((n) => hasClass(n, 'skills-guide') && n.nodeName === 'DETAILS');
  assert.equal(Boolean(guideDetails), true, 'SkillsPanel moves prose explanations inside 說明 details');
  assert.equal(guideDetails!.open, false, '說明 details starts collapsed');
  assert.equal(guideDetails!.textContent.includes('不需要先懂 GitHub'), true, 'prose explanation lives inside 說明');

  const unlockPromptP = skillsNodes.find((n) => n.parentNode && hasClass(n.parentNode, 'skill-unlock-prompt') && n.nodeName === 'P')!;
  assert.equal(unlockPromptP.textContent.trim().length <= 24, true, 'unlocked empty state <= 24 chars');

  const lockedTab = skillsNodes.find((n) => n.attributes['data-guide-anchor'] === 'skills:locked')!;
  await React.act(async () => { lockedTab.click(); });
  const lockedPromptP = walk(container).find((n) => n.parentNode && hasClass(n.parentNode, 'skill-unlock-prompt') && n.nodeName === 'P')!;
  assert.equal(lockedPromptP.textContent.trim().length <= 24, true, 'locked prompt <= 24 chars');
});
