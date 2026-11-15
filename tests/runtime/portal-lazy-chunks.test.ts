import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildSync, transformSync } from 'esbuild';
import React from 'react';
import { registerReactDomTeardown, type ReactDomTeardownHandle } from './react-dom-teardown.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC_ROOT = path.join(ROOT, 'apps/portal-web/src');

function staticModuleInputs(relative: string) {
  const entry = path.join(SRC_ROOT, relative);
  const { inputs } = buildSync({
    stdin: { contents: readFileSync(entry, 'utf8'), loader: 'tsx', sourcefile: entry, resolveDir: path.dirname(entry) },
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    platform: 'browser',
    format: 'esm',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  }).metafile!;
  const visited = new Set<string>();
  const visit = (p: string) => {
    if (visited.has(p)) return;
    visited.add(p);
    for (const dep of inputs[p]?.imports ?? []) {
      if (!dep.external && dep.kind !== 'dynamic-import') visit(dep.path);
    }
  };
  const root = Object.keys(inputs).find(p => p.endsWith('/' + relative)) ?? '<stdin>';
  visit(root);
  assert.ok(visited.size >= 1, `expected static graph for ${relative}`);
  return [...visited];
}

const hasSuffix = (paths: string[], suffix: string) => paths.some(p => p.endsWith(suffix));

class MiniNode {
  [key: string]: any;
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  attributes: Record<string, string> = {};
  style = { setProperty() {}, removeProperty() {} };
  listeners: Record<string, Function[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  open = false;
  checked = false;
  disabled = false;
  readOnly = false;
  rows = 0;
  value = '';
  nodeValue: string | null = null;
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling(): MiniNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 ? this.parentNode.childNodes[i + 1] ?? null : null;
  }
  get previousSibling(): MiniNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i > 0 ? this.parentNode.childNodes[i - 1] ?? null : null;
  }
  get textContent(): string {
    return this.nodeType === 3 ? (this.nodeValue ?? '') : this.childNodes.map(c => c.textContent).join('');
  }
  set textContent(v: string) {
    this.childNodes = [];
    if (v) this.appendChild(this.ownerDocument.createTextNode(v));
  }
  appendChild(node: MiniNode) {
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }
  insertBefore(node: MiniNode, ref: MiniNode | null) {
    if (!ref) return this.appendChild(node);
    node.parentNode?.removeChild(node);
    const idx = this.childNodes.indexOf(ref);
    assert.notEqual(idx, -1);
    this.childNodes.splice(idx, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node: MiniNode) {
    const idx = this.childNodes.indexOf(node);
    assert.notEqual(idx, -1);
    this.childNodes.splice(idx, 1);
    node.parentNode = null;
    return node;
  }
  setAttribute(name: string, val: string) {
    const s = String(val);
    this.attributes[name] = s;
    if (name === 'disabled') this.disabled = true;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
    if (name === 'disabled') this.disabled = false;
  }
  getAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  addEventListener(type: string, fn: Function) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: Function) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn);
  }
  focus() {}
  select() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  hasAttribute(name: string) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }
  getRootNode() {
    return this.ownerDocument;
  }
  contains(node: MiniNode | null): boolean {
    let cur = node;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  dispatch(type: string) {
    let stopped = false;
    const event = {
      type,
      target: this,
      currentTarget: this as any,
      defaultPrevented: false,
      bubbles: true,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { stopped = true; },
    };
    let cur: any = this;
    while (cur && !stopped) {
      event.currentTarget = cur;
      for (const fn of [...(cur.listeners?.[type] ?? [])]) fn(event);
      cur = cur.parentNode ?? (cur === this.ownerDocument.body ? this.ownerDocument : null);
    }
  }
}

function findNodes(root: MiniNode, pred: (n: MiniNode) => boolean): MiniNode[] {
  const out: MiniNode[] = [];
  const walk = (n: MiniNode) => {
    if (pred(n)) out.push(n);
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return out;
}

function captureShareButtonGlobals(): Record<string, unknown> {
  return {
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    HTMLElement: (globalThis as any).HTMLElement,
    HTMLDetailsElement: (globalThis as any).HTMLDetailsElement,
    HTMLIFrameElement: (globalThis as any).HTMLIFrameElement,
    SVGElement: (globalThis as any).SVGElement,
    Element: (globalThis as any).Element,
    Node: (globalThis as any).Node,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT,
  };
}

async function mountShareButton(options: {
  fallbackUrl: string;
  importShareQr: () => Promise<any>;
  teardown: ReactDomTeardownHandle;
}) {
  const origin = 'https://freetwai.com';
  const copies: string[] = [];
  const pendingAsync = new Set<Promise<void>>();
  const trackAsyncFn = <T extends (...args: any[]) => Promise<any>>(fn: T): T => {
    const trackedTeardown = options.teardown.trackFn(fn);
    return ((...args: any[]) => {
      const promise = trackedTeardown(...args);
      const settled = Promise.resolve(promise).then(
        () => { pendingAsync.delete(settled); },
        () => { pendingAsync.delete(settled); },
      );
      pendingAsync.add(settled);
      return promise;
    }) as T;
  };
  const trackedImportShareQr = trackAsyncFn(options.importShareQr);
  const docListeners: Record<string, Function[]> = {};
  const doc: any = {
    nodeType: 9,
    activeElement: null,
    listeners: docListeners,
    createElement(tag: string) { return new MiniNode(1, tag.toUpperCase(), doc); },
    createElementNS(_ns: string, tag: string) { return new MiniNode(1, tag.toUpperCase(), doc); },
    createTextNode(text: string) {
      const n = new MiniNode(3, '#text', doc);
      n.nodeValue = String(text);
      return n;
    },
    createComment(text: string) {
      const n = new MiniNode(8, '#comment', doc);
      n.nodeValue = String(text);
      return n;
    },
    addEventListener(type: string, fn: Function) { (docListeners[type] ??= []).push(fn); },
    removeEventListener(type: string, fn: Function) { docListeners[type] = (docListeners[type] ?? []).filter(f => f !== fn); },
  };
  doc.body = new MiniNode(1, 'BODY', doc);
  doc.documentElement = doc.body;
  const container = doc.body.appendChild(doc.createElement('DIV'));
  const win: any = {
    document: doc,
    location: { origin, href: `${origin}/` },
    navigator: {
      clipboard: {
        writeText: trackAsyncFn(async (txt: string) => { copies.push(txt); }),
      },
    },
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true,
    HTMLElement: MiniNode,
    HTMLDetailsElement: MiniNode,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    SVGElement: MiniNode,
    Element: MiniNode,
    Node: MiniNode,
  };
  doc.defaultView = win;

  const savedGlobals = captureShareButtonGlobals();
  Object.assign(globalThis, {
    window: win,
    document: doc,
    HTMLElement: MiniNode,
    HTMLDetailsElement: MiniNode,
    HTMLIFrameElement: win.HTMLIFrameElement,
    SVGElement: MiniNode,
    Element: MiniNode,
    Node: MiniNode,
    IS_REACT_ACT_ENVIRONMENT: true,
  });

  const require = createRequire(import.meta.url);
  const cache = new Map<string, any>();

  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    let src = readFileSync(file, 'utf8');
    if (file.endsWith('ShareButton.tsx')) {
      src = src.replace(/import\((['"])\.\/share-qr\1\)/g, 'globalThis.__importShareQr()');
    }
    const { code } = transformSync(src, {
      loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'cjs',
      jsx: 'automatic',
      sourcefile: file,
    });
    const mod = { exports: {} as any };
    cache.set(file, mod.exports);
    const localRequire = (spec: string) => {
      if (spec.endsWith('.css')) return {};
      if (spec === 'react') return React;
      if (spec === 'react/jsx-runtime') return require('react/jsx-runtime');
      if (spec === 'react-dom') return require('react-dom');
      if (spec === 'react-dom/client') return require('react-dom/client');
      if (spec.startsWith('.')) {
        const base = path.resolve(path.dirname(file), spec);
        for (const ext of ['', '.ts', '.tsx', '.js']) {
          if (existsSync(base + ext)) return load(base + ext);
        }
      }
      return require(spec);
    };
    const fn = runInNewContext(`(function(exports, require, module) {\n${code}\n})`, {
      ...globalThis,
      window: win,
      document: doc,
      navigator: win.navigator,
      HTMLElement: MiniNode,
      HTMLDetailsElement: MiniNode,
      Node: MiniNode,
      __importShareQr: trackedImportShareQr,
      setTimeout,
      clearTimeout,
      URL,
      console,
    });
    fn(mod.exports, localRequire, mod);
    cache.set(file, mod.exports);
    return mod.exports;
  };

  const ReactDomClient = require('react-dom/client');
  const { ShareButton } = load(path.join(SRC_ROOT, 'share/ShareButton.tsx'));
  const root = ReactDomClient.createRoot(container);
  let unmounted = false;
  options.teardown.setRoot({
    render: root.render.bind(root),
    unmount() {
      if (!unmounted) {
        unmounted = true;
        root.unmount();
      }
    },
  });
  await React.act(async () => {
    root.render(React.createElement(ShareButton, {
      title: '測試工具',
      fallbackUrl: options.fallbackUrl,
    }));
  });

  const flushAsync = async () => {
    while (pendingAsync.size > 0) {
      const batch = [...pendingAsync];
      await React.act(async () => {
        await Promise.allSettled(batch);
      });
    }
  };

  return {
    doc,
    copies,
    flushAsync,
    async unmount() {
      await flushAsync();
      if (!unmounted) {
        unmounted = true;
        await React.act(async () => {
          root.unmount();
        });
      }
      await React.act(async () => {
        await new Promise<void>(resolve => setImmediate(resolve));
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });
      await flushAsync();
      for (const [k, v] of Object.entries(savedGlobals)) {
        if (v === undefined) delete (globalThis as any)[k];
        else (globalThis as any)[k] = v;
      }
    },
    async clickButton(label: string) {
      const btn = findNodes(doc.body, n => n.tagName === 'BUTTON' && n.textContent.trim() === label)[0];
      assert.ok(btn, `expected button "${label}"`);
      assert.equal(btn.disabled, false, `expected button "${label}" enabled`);
      await React.act(async () => {
        btn.dispatch('click');
      });
    },
    hasButton(label: string) {
      return findNodes(doc.body, n => n.tagName === 'BUTTON' && n.textContent.trim() === label).length > 0;
    },
    statuses() {
      return findNodes(doc.body, n => n.getAttribute('role') === 'status').map(n => n.textContent.trim());
    },
    qrSvgCount() {
      return findNodes(doc.body, n => n.tagName === 'SVG' && n.getAttribute('aria-label') === '分享連結的 QR Code').length;
    },
  };
}

test('PERF-12-1: ShareButton.tsx has no static ./share-qr import and uses dynamic import', () => {
  const src = readFileSync(path.join(SRC_ROOT, 'share/ShareButton.tsx'), 'utf8');
  assert.equal(/import\s+[^;]*['"]\.\/share-qr['"]/.test(src), false, 'ShareButton.tsx must not statically import ./share-qr');
  assert.equal(/import\(\s*['"]\.\/share-qr['"]\s*\)/.test(src), true, 'ShareButton.tsx must dynamically import ./share-qr');

  const buttonGraph = staticModuleInputs('share/ShareButton.tsx');
  assert.equal(hasSuffix(buttonGraph, '/share/share-qr.ts'), false, 'ShareButton static graph must exclude share-qr.ts');

  const appGraph = staticModuleInputs('App.tsx');
  assert.equal(hasSuffix(appGraph, '/share/share-qr.ts'), false, 'App static graph must exclude share-qr.ts');
});

test('PERF-12-1: shareQrUrlAllowed matches shareQr acceptance and rejection cases', async () => {
  const { shareQrUrlAllowed } = await import('../../apps/portal-web/src/share/share-qr-url.js');
  const { shareQr } = await import('../../apps/portal-web/src/share/share-qr.js');
  const origin = 'https://freetwai.com';
  const id = randomUUID();

  const validUrls = [
    `${origin}/`,
    `${origin}/go/AbCdEf12_4`,
    `${origin}/go/AbCdEf12_4?intro=3`,
    `${origin}/s/${id}`,
    `${origin}/works/${id}`,
    `${origin}/events/${id}`,
    `${origin}/posts/${id}`,
    `${origin}/services/${id}`,
    `${origin}/development/skills/typo-studio`,
    `${origin}/development/skills/typo-studio?intro=1`,
    `${origin}/development/submissions/${id}?intro=999`,
    `${origin}/member-cards/${'a'.repeat(43)}`,
  ];
  for (const url of validUrls) {
    assert.equal(shareQrUrlAllowed(url, origin), true, `Expected true for ${url}`);
    assert.ok(shareQr(url, origin), `Expected shareQr output for ${url}`);
  }

  const invalidUrls = [
    'https://evil.example/go/AbCdEf12_4',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://user@freetwai.com/go/AbCdEf12_4',
    'https://user:pass@freetwai.com/go/AbCdEf12_4',
    `${origin}/go/AbCdEf12_4#frag`,
    `${origin}/#shares/${id}`,
    `${origin}/?social-post=${id}#social`,
    `${origin}/go/short`,
    `${origin}/go/too-long-code-123`,
    `${origin}/s/not-a-uuid`,
    `${origin}/s/${id.toUpperCase()}`,
    `${origin}/admin`,
    `${origin}/go/AbCdEf12_4?foo=bar`,
    `${origin}/go/AbCdEf12_4?intro=0`,
    `${origin}/go/AbCdEf12_4?intro=01`,
    `${origin}/go/AbCdEf12_4?intro=1000`,
    `${origin}/development/skills/typo-studio?intro=3&extra=1`,
    `${origin}/member-cards/short`,
    'not a url',
  ];
  for (const url of invalidUrls) {
    assert.equal(shareQrUrlAllowed(url, origin), false, `Expected false for ${url}`);
    assert.equal(shareQr(url, origin), null, `Expected null shareQr for ${url}`);
  }
});

test('PERF-12-1: ShareButton loads share-qr only when toggled on, shows loading status, renders SVG, and handles import failure', async (t) => {
  const teardown = registerReactDomTeardown(t, captureShareButtonGlobals());
  const { shareQr } = await import('../../apps/portal-web/src/share/share-qr.js');
  let importCount = 0;
  let resolveImport!: (mod: { shareQr: typeof shareQr }) => void;

  const disallowed = await mountShareButton({
    fallbackUrl: 'https://evil.example/go/AbCdEf12_4',
    importShareQr: async () => { importCount++; return { shareQr }; },
    teardown,
  });
  await disallowed.clickButton('分享');
  assert.equal(disallowed.hasButton('QR 碼'), false);
  assert.equal(importCount, 0);
  await disallowed.unmount();

  const h = await mountShareButton({
    fallbackUrl: 'https://freetwai.com/go/AbCdEf12_4',
    importShareQr: () => {
      importCount++;
      return new Promise(resolve => { resolveImport = resolve; });
    },
    teardown,
  });
  await h.clickButton('分享');
  assert.equal(h.hasButton('QR 碼'), true);
  assert.equal(importCount, 0, 'share-qr must not load before member toggles QR on');

  await h.clickButton('QR 碼');
  assert.equal(importCount, 1);
  assert.equal(h.statuses().includes('產生 QR 中…'), true);
  assert.equal(h.qrSvgCount(), 0);

  await React.act(async () => {
    resolveImport({ shareQr });
  });
  await h.flushAsync();
  assert.equal(h.statuses().includes('產生 QR 中…'), false);
  assert.equal(h.qrSvgCount(), 1);
  await h.unmount();

  let failCount = 0;
  const failing = await mountShareButton({
    fallbackUrl: 'https://freetwai.com/go/AbCdEf12_4',
    importShareQr: async () => {
      failCount++;
      throw new Error('chunk failed');
    },
    teardown,
  });
  await failing.clickButton('分享');
  await failing.clickButton('QR 碼');
  await failing.flushAsync();
  assert.equal(failCount, 1);
  assert.equal(failing.statuses().includes('QR 暫時無法產生。'), true);
  assert.equal(failing.qrSvgCount(), 0);

  await failing.clickButton('複製連結');
  await failing.flushAsync();
  assert.equal(failing.copies.length, 1);
  await failing.unmount();
});

test('PERF-12-2: PlaceView.tsx imports nothing from CommunitySearch and CommunitySearch does not re-export ExploreFeatureSearchContext', () => {
  const placeView = readFileSync(path.join(SRC_ROOT, 'features/PlaceView.tsx'), 'utf8');
  assert.equal(/CommunitySearch/.test(placeView), false, 'PlaceView.tsx must import nothing from CommunitySearch');

  const communitySearch = readFileSync(path.join(SRC_ROOT, 'modules/CommunitySearch.tsx'), 'utf8');
  assert.equal(/export\s+[^;]*\b(ExploreFeatureSearchContext|ExploreFeatureMatch)\b/.test(communitySearch), false, 'CommunitySearch.tsx must not export ExploreFeatureSearchContext or ExploreFeatureMatch');

  const placeGraph = staticModuleInputs('features/PlaceView.tsx');
  assert.equal(hasSuffix(placeGraph, '/modules/CommunitySearch.tsx'), false, 'PlaceView static graph must exclude CommunitySearch.tsx');

  const appGraph = staticModuleInputs('App.tsx');
  assert.equal(hasSuffix(appGraph, '/modules/CommunitySearch.tsx'), false, 'App static graph must exclude CommunitySearch.tsx');
});

test('PERF-12-3: App.tsx imports only types from ./modules/Community and BrandPoster/CommunityLinks live in CommunityBrand.tsx', () => {
  const app = readFileSync(path.join(SRC_ROOT, 'App.tsx'), 'utf8');
  const communityImports = app.match(/import\s+[^\n;]*from\s+['"]\.\/modules\/Community['"]/g) ?? [];
  assert.ok(communityImports.length >= 1, 'App.tsx should import type SiteConfig from ./modules/Community');
  for (const stmt of communityImports) {
    assert.equal(/^import\s+type\s/.test(stmt), true, `App.tsx must only import types from ./modules/Community, got: ${stmt}`);
  }

  const community = readFileSync(path.join(SRC_ROOT, 'modules/Community.tsx'), 'utf8');
  assert.equal(/export\s+[^;]*\b(BrandPoster|CommunityLinks|communityLinks)\b/.test(community), false, 'Community.tsx must not export BrandPoster, CommunityLinks, or communityLinks');

  for (const file of ['modules/Onboarding.tsx', 'modules/PublicMemberPage.tsx', 'modules/WelcomePreview.tsx']) {
    const src = readFileSync(path.join(SRC_ROOT, file), 'utf8');
    assert.equal(/from\s+['"]\.\/Community['"]/.test(src), false, `${file} must not import from ./Community`);
  }

  const appGraph = staticModuleInputs('App.tsx');
  assert.equal(hasSuffix(appGraph, '/modules/Community.tsx'), false, 'App static graph must exclude Community.tsx');
  assert.equal(hasSuffix(appGraph, '/modules/CommunityBrand.tsx'), true, 'App static graph should include CommunityBrand.tsx');
});

function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTsFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('I4: GuildLaunchpad split meets file size limits and no file imports GuildLaunchpadEditor statically', () => {
  const countLines = (rel: string) => {
    const text = readFileSync(path.join(SRC_ROOT, rel), 'utf8');
    return text.endsWith('\n') ? text.slice(0, -1).split('\n').length : text.split('\n').length;
  };
  assert.ok(countLines('modules/GuildLaunchpad.tsx') <= 450, 'GuildLaunchpad.tsx must be at most 450 lines');
  assert.ok(countLines('modules/GuildLaunchpadReading.tsx') <= 400, 'GuildLaunchpadReading.tsx must be at most 400 lines');
  const editorLines = countLines('modules/GuildLaunchpadEditor.tsx');
  assert.ok(
    editorLines <= 600 || existsSync(path.join(SRC_ROOT, 'modules/GuildLaunchpadEditorHistory.tsx')),
    'GuildLaunchpadEditor.tsx over 600 lines must split history into GuildLaunchpadEditorHistory.tsx',
  );

  const launchpadGraph = staticModuleInputs('modules/GuildLaunchpad.tsx');
  assert.equal(hasSuffix(launchpadGraph, '/modules/GuildLaunchpadEditor.tsx'), false, 'GuildLaunchpad static graph must exclude GuildLaunchpadEditor.tsx');
  const appGraph = staticModuleInputs('App.tsx');
  assert.equal(hasSuffix(appGraph, '/modules/GuildLaunchpadEditor.tsx'), false, 'App static graph must exclude GuildLaunchpadEditor.tsx');

  const portalFiles = walkTsFiles(SRC_ROOT);
  const { inputs } = buildSync({
    entryPoints: portalFiles,
    bundle: true,
    splitting: true,
    packages: 'external',
    write: false,
    metafile: true,
    outdir: path.join(ROOT, 'dist/.check-tmp'),
    format: 'esm',
    platform: 'browser',
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty' },
    logLevel: 'silent',
  }).metafile!;
  const staticImporters = Object.entries(inputs)
    .filter(([, meta]) => meta.imports.some(dep => dep.kind !== 'dynamic-import' && dep.path.endsWith('/GuildLaunchpadEditor.tsx')))
    .map(([file]) => file);
  assert.deepEqual(staticImporters, [], 'no bundled file may import GuildLaunchpadEditor statically');
  const dynamicImporters = Object.entries(inputs)
    .filter(([, meta]) => meta.imports.some(dep => dep.kind === 'dynamic-import' && dep.path.endsWith('/GuildLaunchpadEditor.tsx')))
    .map(([file]) => file);
  assert.equal(dynamicImporters.some(f => f.endsWith('apps/portal-web/src/modules/GuildLaunchpad.tsx')), true, 'GuildLaunchpad.tsx must dynamically import GuildLaunchpadEditor');

  const allSourceFiles = [
    ...walkTsFiles(path.join(ROOT, 'apps')),
    ...walkTsFiles(path.join(ROOT, 'modules')),
    ...walkTsFiles(path.join(ROOT, 'packages')),
    ...walkTsFiles(path.join(ROOT, 'contracts')),
  ];
  const staticRegexImporters = allSourceFiles
    .filter(file => {
      const src = readFileSync(file, 'utf8');
      return /(?:^|\n)\s*(?:import|export)\b[^;\n]*['"][^'"]*GuildLaunchpadEditor(?:\.[jt]sx?)?['"]|\brequire\(\s*['"][^'"]*GuildLaunchpadEditor(?:\.[jt]sx?)?['"]\s*\)/.test(src);
    })
    .map(file => path.relative(ROOT, file));
  assert.deepEqual(staticRegexImporters, [], 'no source file may import GuildLaunchpadEditor statically');
});
