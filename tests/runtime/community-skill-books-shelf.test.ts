import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import React, { act } from 'react';

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
  get firstChild(): HostNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): HostNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling(): HostNode | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
  }
  get previousSibling(): HostNode | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx > 0 ? (this.parentNode.childNodes[idx - 1] ?? null) : null;
  }
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
    if (node.nodeType === 11) {
      for (const child of [...node.childNodes]) this.appendChild(child);
      return node;
    }
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  insertBefore(node: HostNode, ref: HostNode | null) {
    if (!ref) return this.appendChild(node);
    if (node.nodeType === 11) {
      for (const child of [...node.childNodes]) this.insertBefore(child, ref);
      return node;
    }
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
    if (k === 'value') this.value = String(v);
  }
  removeAttribute(k: string) {
    delete this.attributes[k];
    if (k === 'disabled') this.disabled = false;
    if (k === 'open') this.open = false;
  }
  getAttribute(k: string) { return k in this.attributes ? this.attributes[k] : null; }
  hasAttribute(k: string) { return k in this.attributes; }
  contains(other: HostNode | null) {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  addEventListener(type: string, fn: Function, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    (this.listeners[type] ??= []).push({ fn, capture });
  }
  removeEventListener(type: string, fn: Function, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l.fn !== fn || l.capture !== capture);
  }
  dispatchEvent(event: Record<string, any>) {
    event.target ??= this;
    event.defaultPrevented ??= false;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    let stopped = false;
    event.stopPropagation ??= () => { stopped = true; };
    event.stopImmediatePropagation ??= () => { stopped = true; };
    const pathNodes: HostNode[] = [];
    let cur: HostNode | null = this;
    while (cur) { pathNodes.unshift(cur); cur = cur.parentNode; }
    for (const node of pathNodes) {
      if (stopped) break;
      event.currentTarget = node;
      for (const l of [...(node.listeners[event.type] ?? [])]) {
        if (l.capture) l.fn.call(node, event);
      }
    }
    const bubbleNodes = event.bubbles === false ? [this] : [...pathNodes].reverse();
    for (const node of bubbleNodes) {
      if (stopped) break;
      event.currentTarget = node;
      for (const l of [...(node.listeners[event.type] ?? [])]) {
        if (!l.capture) l.fn.call(node, event);
      }
    }
    return !event.defaultPrevented;
  }
  focus() { this.ownerDocument.activeElement = this; }
  blur() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function walk(node: HostNode): HostNode[] {
  const out: HostNode[] = [node];
  for (const child of node.childNodes) out.push(...walk(child));
  return out;
}

function setupDom() {
  const doc: any = {
    nodeType: 9,
    nodeName: '#document',
    oninput: null,
    listeners: {} as Record<string, { fn: Function; capture: boolean }[]>,
    activeElement: null as HostNode | null,
    createElement(tag: string) { return new HostNode(1, tag.toUpperCase(), doc); },
    createElementNS(_ns: string, tag: string) { return new HostNode(1, tag.toUpperCase(), doc); },
    createTextNode(text: string) {
      const node = new HostNode(3, '#text', doc);
      node.nodeValue = String(text);
      return node;
    },
    createComment(text: string) {
      const node = new HostNode(8, '#comment', doc);
      node.nodeValue = String(text);
      return node;
    },
    createDocumentFragment() { return new HostNode(11, '#document-fragment', doc); },
    addEventListener(type: string, fn: Function, opts?: boolean | { capture?: boolean }) {
      const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
      (this.listeners[type] ??= []).push({ fn, capture });
    },
    removeEventListener(type: string, fn: Function, opts?: boolean | { capture?: boolean }) {
      const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
      this.listeners[type] = (this.listeners[type] ?? []).filter((l: any) => l.fn !== fn || l.capture !== capture);
    },
    dispatchEvent(event: Record<string, any>) {
      for (const l of [...(this.listeners[event.type] ?? [])]) l.fn.call(doc, event);
      return !event.defaultPrevented;
    },
  };
  doc.documentElement = doc.createElement('html');
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.defaultView = {
    document: doc,
    HTMLElement: HostNode,
    HTMLIFrameElement: class HTMLIFrameElement {},
    Element: HostNode,
    Node: HostNode,
    location: new URL('http://localhost:46497/#explore/resources'),
    navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  return doc;
}

function loadCommunitySkillBooksModule() {
  const result = buildSync({
    entryPoints: [path.resolve('apps/portal-web/src/modules/CommunitySkillBooks.tsx')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    loader: { '.css': 'empty' },
    external: ['react', 'react-dom', 'react-dom/client'],
  });
  const baseRequire = createRequire(import.meta.url);
  const mod = { exports: {} as any };
  const fn = new Function('require', 'module', 'exports', result.outputFiles[0].text);
  fn((id: string) => {
    if (id === 'react') return React;
    return baseRequire(id);
  }, mod, mod.exports);
  return mod.exports as { CommunitySkillBooks: React.ComponentType<any> };
}

function makeBooks(count: number) {
  return Array.from({ length: count }, (_, idx) => {
    const n = String(idx + 1).padStart(2, '0');
    return {
      id: `community-book-${n}`,
      title: `社群技能書 ${n}`,
      description: `測試用社群技能書描述 ${n}`,
      repository_url: `https://github.com/example/community-skill-${n}`,
      fork_url: null,
      license_status: 'verified',
      guide: {
        beginner: {
          category: '文字創作',
          purpose: `協助完成任務 ${n}`,
        },
      },
    };
  });
}

test('CommunitySkillBooks shows 20 cards initially, expands on 更多, and resets to 20 when filters change', async () => {
  const prevGlobals = {
    IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT,
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    navigator: (globalThis as any).navigator,
    HTMLElement: (globalThis as any).HTMLElement,
    Element: (globalThis as any).Element,
    Node: (globalThis as any).Node,
    fetch: globalThis.fetch,
    matchMedia: (globalThis as any).matchMedia,
    localStorage: (globalThis as any).localStorage,
  };

  const doc = setupDom();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).window = doc.defaultView;
  (globalThis as any).document = doc;
  (globalThis as any).HTMLElement = HostNode;
  (globalThis as any).Element = HostNode;
  (globalThis as any).Node = HostNode;
  (globalThis as any).matchMedia = doc.defaultView.matchMedia;
  (globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  try {
    Object.defineProperty(globalThis, 'navigator', { value: doc.defaultView.navigator, configurable: true });
  } catch {
    // ignore if readonly in Node
  }
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes('/api/v1/skills/discovery')) {
      return new Response(JSON.stringify({
        as_of: '2026-11-14T00:00:00Z',
        timezone: 'Asia/Taipei',
        ranking_basis: 'github_stars',
        books: [],
        weekly: [],
        monthly: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const container = doc.createElement('div');
  doc.body.appendChild(container);
  let root: any = null;

  try {
    const { createRoot } = await import('react-dom/client');
    const { CommunitySkillBooks } = loadCommunitySkillBooksModule();
    const books = makeBooks(25);
    const client = {
      csrfToken: 'test-csrf',
      get: async (url: string) => {
        if (url === '/community') {
          return {
            name: '自由工坊',
            tagline: '測試',
            metrics: [],
            featured_projects: [],
            skill_books: books,
          };
        }
        if (url === '/skill-submissions/published') {
          return { items: [] };
        }
        throw new Error(`Unexpected GET ${url}`);
      },
    };

    root = createRoot(container as unknown as Element);
    await act(async () => {
      root!.render(React.createElement(CommunitySkillBooks, { client }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const cards = () => walk(container).filter((n) => n.nodeName === 'ARTICLE' && n.className.split(/\s+/).includes('community-book'));
    const moreButtons = () => walk(container).filter((n) => n.nodeName === 'BUTTON' && n.textContent.trim() === '更多');
    const countLine = () => walk(container).find((n) => n.className.split(/\s+/).includes('skill-library-count'))?.textContent ?? '';

    assert.equal(countLine().includes('顯示 25 / 25'), true, `expected count line to show 25 / 25, got: ${countLine()}`);
    assert.equal(cards().length, 20, 'expected 20 cards initially');
    assert.equal(moreButtons().length, 1, 'expected one 更多 button initially');

    await act(async () => {
      moreButtons()[0].dispatchEvent({ type: 'click', bubbles: true });
    });
    assert.equal(cards().length, 25, 'expected 25 cards after clicking 更多');
    assert.equal(moreButtons().length, 0, 'expected no 更多 button once all 25 cards are shown');

    const searchInput = walk(container).find((n) => n.nodeName === 'INPUT' && (n.type === 'search' || n.getAttribute('type') === 'search'));
    assert.ok(searchInput, 'expected search input');
    await act(async () => {
      searchInput.value = '社群';
      searchInput.dispatchEvent({ type: 'input', bubbles: true });
    });
    assert.equal(countLine().includes('顯示 25 / 25'), true, 'expected count line to still count all 25 matches');
    assert.equal(cards().length, 20, 'expected cards to reset to 20 after changing search text');
    assert.equal(moreButtons().length, 1, 'expected 更多 button to reappear after search reset limit');

    await act(async () => {
      moreButtons()[0].dispatchEvent({ type: 'click', bubbles: true });
    });
    assert.equal(cards().length, 25, 'expected 25 cards after second 更多 click');

    const categorySelect = walk(container).find((n) => n.nodeName === 'SELECT');
    assert.ok(categorySelect, 'expected purpose category select');
    await act(async () => {
      categorySelect.value = '文字創作';
      categorySelect.dispatchEvent({ type: 'change', bubbles: true });
    });
    assert.equal(cards().length, 20, 'expected cards to reset to 20 after changing purpose filter');
    assert.equal(moreButtons().length, 1, 'expected 更多 button to reappear after purpose filter reset limit');

    await act(async () => {
      searchInput.value = '01';
      searchInput.dispatchEvent({ type: 'input', bubbles: true });
    });
    assert.equal(countLine().includes('顯示 1 / 25'), true, 'expected count line to count 1 match');
    assert.equal(cards().length, 1, 'expected 1 matching card');
    assert.equal(moreButtons().length, 0, 'expected no 更多 button when 1 card matches');

    const clearButton = walk(container).find((n) => n.nodeName === 'BUTTON' && n.textContent.trim() === '清除篩選');
    assert.ok(clearButton, 'expected 清除篩選 button');
    await act(async () => {
      clearButton.dispatchEvent({ type: 'click', bubbles: true });
    });
    assert.equal(countLine().includes('顯示 25 / 25'), true, 'expected count line to restore 25 / 25');
    assert.equal(cards().length, 20, 'expected at most 20 cards after clearing filters');
    assert.equal(moreButtons().length, 1, 'expected 更多 button after clearing filters');

    await act(async () => {
      moreButtons()[0].dispatchEvent({ type: 'click', bubbles: true });
    });
    assert.equal(cards().length, 25, 'expected 25 cards after third 更多 click');

    const selects = walk(container).filter((n) => n.nodeName === 'SELECT');
    const useSelect = selects[1];
    assert.ok(useSelect && useSelect.options.length > 1, 'expected content/tech purpose select with options');
    const useOptionValue = useSelect.options[1].value || useSelect.options[1].getAttribute('value') || '';
    assert.ok(useOptionValue.length > 0, 'expected non-empty option value on use filter');
    await act(async () => {
      useSelect.value = useOptionValue;
      useSelect.dispatchEvent({ type: 'change', bubbles: true });
    });
    assert.equal(cards().length, 0, 'expected 0 matching cards for synthetic IDs when use filter is selected');
    await act(async () => {
      useSelect.value = '';
      useSelect.dispatchEvent({ type: 'change', bubbles: true });
    });
    assert.equal(cards().length, 20, 'expected cards to stay capped at 20 after use filter reset limit');
    assert.equal(moreButtons().length, 1, 'expected 更多 button after use filter reset limit');
  } finally {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = prevGlobals.IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).window = prevGlobals.window;
    (globalThis as any).document = prevGlobals.document;
    (globalThis as any).HTMLElement = prevGlobals.HTMLElement;
    (globalThis as any).Element = prevGlobals.Element;
    (globalThis as any).Node = prevGlobals.Node;
    (globalThis as any).matchMedia = prevGlobals.matchMedia;
    (globalThis as any).localStorage = prevGlobals.localStorage;
    globalThis.fetch = prevGlobals.fetch;
  }
});
