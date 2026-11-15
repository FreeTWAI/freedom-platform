import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import pathMod from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { ApiError, PortalClient } from '../../apps/portal-web/src/api.js';
import { PAGE_GUIDES } from '../../apps/portal-web/src/modules/newcomer-guides/packs/page-guides.js';

const origin = 'http://127.0.0.1:4310';
const rootDir = fileURLToPath(new URL('../../', import.meta.url));

class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style = { setProperty() {}, removeProperty() {} };
  listeners: Record<string, Function[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  open = false;

  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
  }

  appendChild(node: HostNode) {
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  removeChild(node: HostNode) {
    const i = this.childNodes.indexOf(node);
    assert.notEqual(i, -1);
    this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }

  insertBefore(node: HostNode, before: HostNode) {
    node.parentNode?.removeChild(node);
    const i = this.childNodes.indexOf(before);
    assert.notEqual(i, -1);
    this.childNodes.splice(i, 0, node);
    node.parentNode = this;
    return node;
  }

  setAttribute(key: string, value: unknown) {
    this.attributes[key] = String(value);
    if (key === 'open') this.open = true;
  }

  removeAttribute(key: string) {
    delete this.attributes[key];
    if (key === 'open') this.open = false;
  }

  getAttribute(key: string) {
    return this.attributes[key] ?? null;
  }

  setAttributeNS(_ns: string, key: string, value: unknown) {
    this.setAttribute(key, value);
  }

  addEventListener(type: string, fn: Function) {
    (this.listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: Function) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(x => x !== fn);
  }

  get firstChild(): HostNode | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): HostNode | null {
    return this.childNodes.at(-1) ?? null;
  }

  get nextSibling(): HostNode | null {
    return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;
  }

  get textContent(): string {
    return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join('');
  }

  set textContent(value: string) {
    this.childNodes.forEach(n => {
      n.parentNode = null;
    });
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }

  get parentElement(): HostNode | null {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null;
  }

  contains(node: HostNode): boolean {
    return node === this || this.childNodes.some(c => c.contains(node));
  }

  closest() {
    return null;
  }

  showModal() {
    this.open = true;
    this.setAttribute('open', '');
  }

  close() {
    this.open = false;
    this.removeAttribute('open');
  }

  focus() {}
  select() {}
}

class HostDocument extends HostNode {
  documentElement: HostNode;
  body: HostNode;
  activeElement: HostNode;

  constructor() {
    super(9, '#document', null);
    this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this);
    this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(name: string) {
    return new HostNode(1, name.toUpperCase(), this);
  }

  createElementNS(ns: string, name: string) {
    const node = this.createElement(name);
    node.namespaceURI = ns;
    return node;
  }

  createTextNode(value: string) {
    const node = new HostNode(3, '#text', this);
    node.nodeValue = value;
    return node;
  }
}

function createCompiler(t: import('node:test').TestContext) {
  const document = new HostDocument();
  const windowObj = {
    location: { origin },
    open() {
      throw Error('No external navigation permitted');
    },
    document,
    HTMLElement: HostNode,
    HTMLDetailsElement: class extends HostNode {},
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
    get event() {
      return undefined;
    },
  };
  document.defaultView = windowObj;
  Object.assign(globalThis, {
    document,
    window: windowObj,
    HTMLElement: HostNode,
    HTMLDetailsElement: windowObj.HTMLDetailsElement,
    Node: HostNode,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const req = createRequire(import.meta.url);
  const { createRoot } = req('react-dom/client') as typeof import('react-dom/client');
  const { flushSync } = req('react-dom') as typeof import('react-dom');
  const flushReact = (fn: () => void) => React.act(() => flushSync(fn));

  const client = new PortalClient();
  client.csrfToken = randomUUID();
  const cache = new Map<string, any>();
  const compile = (relative: string): any => {
    const file = pathMod.resolve(rootDir, relative);
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} as any };
    cache.set(file, mod.exports);
    const raw = readFileSync(file, 'utf8');
    runInNewContext(
      transformSync(raw, { loader: relative.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic' }).code,
      {
        module: mod,
        exports: mod.exports,
        crypto: webcrypto,
        Intl,
        URL,
        console,
        setTimeout,
        clearTimeout,
        window: windowObj,
        document,
        navigator: { clipboard: { writeText: async () => {} } },
        require(name: string) {
          if (name === 'react') return React;
          if (name === 'react/jsx-runtime' || name === 'react-dom' || name === 'qrcode') return req(name);
          if (name === '../api') return { ApiError };
          if (name === '../portal-session') return { client, describeError: (e: Error) => ({ message: e.message }) };
          if (name === '../language') return { useLanguage: () => ({ t: (k: string) => k }) };
          if (name.endsWith('.css')) return {};
          if (name.startsWith('.')) {
            const resolved = pathMod.resolve(pathMod.dirname(file), name);
            const target = [resolved, resolved + '.ts', resolved + '.tsx'].find(existsSync);
            assert.ok(target, `missing ${name}`);
            return compile(pathMod.relative(rootDir, target));
          }
          throw Error(`Unexpected import: ${name}`);
        },
      },
    );
    cache.set(file, mod.exports);
    return mod.exports;
  };

  let cleanup: (() => void) | null = null;
  t.after(() => {
    cleanup?.();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).HTMLDetailsElement;
    delete (globalThis as any).Node;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  return {
    compile,
    document,
    createRoot,
    flushReact,
    setCleanup(fn: () => void) {
      cleanup = fn;
    },
  };
}

async function mountWorkPublicSharing(t: import('node:test').TestContext, showcaseId: string) {
  const { compile, document, createRoot, flushReact, setCleanup } = createCompiler(t);
  t.mock.method(globalThis, 'fetch', async (path: string) => {
    if (path === `/api/v1/me/showcases/${showcaseId}/sharing`) {
      return new Response(JSON.stringify({
        showcase_id: showcaseId,
        status: 'published',
        visibility: 'public',
        enabled: true,
        available: true,
        needs_reconfirmation: false,
        work_version: '1',
        approved_work_version: '1',
        version: 'v1',
        public_path: `/works/${showcaseId}`,
        updated_at: '2026-11-14T00:00:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(null, { status: 204 });
  });

  const { WorkPublicSharing } = compile('apps/portal-web/src/modules/WorkPublicSharing.tsx');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  let unmounted = false;
  setCleanup(() => {
    if (!unmounted) {
      unmounted = true;
      flushReact(() => root.unmount());
      container.parentNode?.removeChild(container);
    }
  });

  flushReact(() => root.render(
    React.createElement(WorkPublicSharing, {
      showcaseId,
      title: '測試作品',
      workVersion: '1',
      status: 'published',
      onReload: async () => {},
    }),
  ));
  await React.act(async () => {
    await new Promise<void>(resolve => setImmediate(resolve));
  });

  const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];
  return () => descendants(document.body);
}

test('UX-V-05 / UX-M-09: WorkPublicSharing renders short public link text with title URL and keeps share button', async t => {
  const showcaseId = randomUUID();
  const view = await mountWorkPublicSharing(t, showcaseId);
  const nodes = view();
  const link = nodes.find(n => n.nodeName === 'A' && n.getAttribute('class') === 'work-public-link');
  assert.equal(Boolean(link), true);
  assert.equal(link?.textContent, '開啟公開頁 ↗');
  assert.equal(link?.getAttribute('href'), `/works/${showcaseId}`);
  assert.equal(link?.getAttribute('title'), `${origin}/works/${showcaseId}`);
  assert.equal(link?.getAttribute('target'), '_blank');
  assert.equal(link?.getAttribute('rel'), 'noopener noreferrer');
  const shareButton = nodes.find(n => n.nodeName === 'BUTTON' && n.textContent === '分享');
  assert.equal(Boolean(shareButton), true);
});

test('UX-V-05: SHARE_TARGETS.work targets showcase:create with activate:true', t => {
  const { compile } = createCompiler(t);
  const { SHARE_TARGETS } = compile('apps/portal-web/src/share/share-targets.ts');
  assert.equal(SHARE_TARGETS.work.tab, 'showcase');
  assert.equal(SHARE_TARGETS.work.selector, '[data-guide-anchor="showcase:create"]');
  assert.equal(SHARE_TARGETS.work.activate, true);
});

test('UX-V-05: page-guides showcase:topic-1 targets showcase:create with updated instruction', () => {
  const step = PAGE_GUIDES.showcase['showcase:topic-1']?.steps[0];
  assert.equal(step?.selector, '[data-guide-anchor="showcase:create"]');
  assert.equal(step?.instruction, '按「發布作品」打開作品表單，再填作品標題。');
});
