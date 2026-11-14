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
      export { ShowcasePanel } from './apps/portal-web/src/modules/ShowcasePanel';
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

test('UX-V-05: #explore/works collapses publish form behind one primary 發布作品 and demotes card actions to secondary', async (t) => {
  const doc = makeDoc();
  const prev = {
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    localStorage: (globalThis as any).localStorage,
    requestAnimationFrame: (globalThis as any).requestAnimationFrame,
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
    requestAnimationFrame: (fn: FrameRequestCallback) => { fn(0); return 1; },
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const entry = { exports: {} as any };
  new Function('require', 'module', 'exports', compiled)(createRequire(import.meta.url), entry, entry.exports);
  const { ShowcasePanel, PortalContext, client, setSharingDraftAccount } = entry.exports;
  setSharingDraftAccount('me-user', client.sessionGeneration);
  const origGet = client.get.bind(client);
  client.get = async (path: string) => {
    if (path.startsWith('/showcases')) {
      return {
        items: [{
          showcase_id: '11111111-1111-4111-8111-111111111111',
          owner_ref: 'other-user',
          owner_name: '其他作者',
          title: '他人示範作品',
          description: '作品介紹',
          artifact_ref: 'artifact:demo-1',
          public_url: 'https://example.com/demo',
          aggregate_version: 1,
        }],
        next_offset: null,
      };
    }
    if (path.startsWith('/opportunities')) {
      return {
        items: [{
          opportunity_id: '22222222-2222-4222-8222-222222222222',
          showcase_title: '我的作品',
          state: 'open',
          need_summary: '想要合作',
          client_ref: 'other-user',
          client_name: '詢問者',
          provider_ref: 'me-user',
          provider_name: '我自己',
        }],
      };
    }
    return { items: [], enabled: false };
  };

  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  t.after(() => {
    client.get = origGet;
    root.unmount();
    Object.assign(globalThis, prev);
  });

  const portalValue = {
    session: { user: { user_id: 'me-user', email: 'me@local.test', profession_membership_ref: 'me-user' }, site: { event_outcomes_enabled: false } },
    pending: null,
    error: null,
    mutate: async () => true,
    clearError() {},
    isMe: (ref: string | null | undefined) => ref === 'me-user',
  };

  await React.act(async () => {
    root.render(React.createElement(PortalContext.Provider, { value: portalValue }, React.createElement(ShowcasePanel)));
    await new Promise((r) => setTimeout(r, 20));
  });

  const all = () => walk(container);
  const primaries = () => all().filter((n) => n.nodeName === 'BUTTON' && hasClass(n, 'btn-primary'));
  const titleInput = () => all().find((n) => n.attributes['data-guide-anchor'] === 'showcase:title');
  const buttonByText = (label: string) => all().find((n) => n.nodeName === 'BUTTON' && n.textContent.trim() === label);

  // Ensure panel finished loading peer showcases and opportunities (not stuck on loading/error)
  const coopBtn = buttonByText('我想找你合作');
  assert.equal(Boolean(coopBtn), true, `expected 我想找你合作 button, got: ${container.textContent.slice(0, 120)}`);
  const proposeBtn = buttonByText('提出合作');
  assert.equal(Boolean(proposeBtn), true);

  // Initially collapsed: no showcase:title input mounted; exactly 1 btn-primary ("發布作品")
  assert.equal(Boolean(titleInput()), false, 'publish form inputs should start collapsed');
  assert.equal(primaries().length, 1, 'exactly one btn-primary initially');
  assert.equal(primaries()[0]?.textContent.trim(), '發布作品');

  // Card actions must be secondary, never primary
  assert.equal(hasClass(coopBtn!, 'btn-secondary'), true, '我想找你合作 should be btn-secondary');
  assert.equal(hasClass(coopBtn!, 'btn-primary'), false, '我想找你合作 must not be btn-primary');

  assert.equal(hasClass(proposeBtn!, 'btn-secondary'), true, '提出合作 should be btn-secondary');
  assert.equal(hasClass(proposeBtn!, 'btn-primary'), false, '提出合作 must not be btn-primary');

  // External link renders short text, not raw address
  const workLink = all().find((n) => n.nodeName === 'A' && n.attributes.href === 'https://example.com/demo');
  assert.equal(workLink?.textContent.trim(), '查看作品 ↗');

  // Clicking 發布作品 opens form, focuses showcase:title, and keeps 1 btn-primary
  await React.act(async () => {
    const propsKey = Object.keys(primaries()[0]).find((k) => k.startsWith('__reactProps$'))!;
    primaries()[0][propsKey].onClick({ button: 0 });
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(Boolean(titleInput()), true, 'clicking 發布作品 opens form');
  assert.equal(doc.activeElement === titleInput(), true, 'opening form focuses showcase:title');
  assert.equal(primaries().length, 1, 'still only 1 btn-primary when form is open');
  assert.equal(primaries()[0]?.textContent.trim(), '發布作品');

  // Clicking 取消 closes form and restores focus to 發布作品 toggle
  const cancelBtn = buttonByText('取消');
  assert.equal(Boolean(cancelBtn), true);
  assert.equal(hasClass(cancelBtn!, 'btn-primary'), false, '取消 must not be btn-primary');
  await React.act(async () => {
    const propsKey = Object.keys(cancelBtn!).find((k) => k.startsWith('__reactProps$'))!;
    cancelBtn![propsKey].onClick({ button: 0 });
    await new Promise((r) => setImmediate(r));
  });
  assert.equal(Boolean(titleInput()), false, 'clicking 取消 collapses form');
  assert.equal(doc.activeElement === primaries()[0], true, 'closing form restores focus to 發布作品');
});
