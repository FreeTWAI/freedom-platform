import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { PortalClient } from '../../apps/portal-web/src/api.js';

const shareBoxPath = new URL('../../apps/portal-web/src/share/ShareBox.tsx', import.meta.url);
const eventComposerPath = new URL('../../apps/portal-web/src/share/EventComposer.tsx', import.meta.url);
const sharePortPath = new URL('../../apps/portal-web/src/share/share-port.ts', import.meta.url);
const shareBoxRequire = createRequire(shareBoxPath);

type VNode = { type: unknown; props: Record<string, any> };
type MockEl = {
  tag: string;
  open: boolean;
  focused: boolean;
  parentDialog: MockEl | null;
  showModal: () => void;
  close: () => void;
  focus: () => void;
};

function createLazyHarness() {
  const states = new Map<string, unknown[]>();
  const refs = new Map<string, { current: unknown }[]>();
  const callbacks = new Map<string, { deps: unknown[] | undefined; fn: unknown }[]>();
  const effects = new Map<string, { deps: unknown[] | undefined; fn: () => unknown; cleanup?: () => void }[]>();
  const pendingEffects: (() => void)[] = [];
  const pendingSuspense = new Set<Promise<unknown>>();
  let cursor = { key: '', state: 0, ref: 0, callback: 0, effect: 0 };
  let activeEl: MockEl | null = null;
  let idSeq = 0;
  let dirty = false;
  let currentEffects: (() => void)[] = [];

  function makeEl(tag: string, parentDialog: MockEl | null): MockEl {
    const el: MockEl = {
      tag,
      open: false,
      focused: false,
      parentDialog,
      showModal() {
        el.open = true;
        if (activeEl) activeEl.focused = false;
        el.focused = true;
        activeEl = el;
      },
      close() { el.open = false; },
      focus() {
        if (el.parentDialog && !el.parentDialog.open) return;
        if (activeEl) activeEl.focused = false;
        el.focused = true;
        activeEl = el;
      },
    };
    return el;
  }

  function nextState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
    const { key } = cursor;
    const idx = cursor.state++;
    const list = states.get(key) ?? [];
    if (!(idx in list)) list[idx] = typeof init === 'function' ? (init as () => T)() : init;
    states.set(key, list);
    return [list[idx] as T, (next: T | ((prev: T) => T)) => {
      list[idx] = typeof next === 'function' ? (next as (prev: T) => T)(list[idx] as T) : next;
      dirty = true;
    }];
  }

  function nextRef<T>(init: T): { current: T } {
    const { key } = cursor;
    const idx = cursor.ref++;
    const list = refs.get(key) ?? [];
    if (!(idx in list)) list[idx] = { current: init };
    refs.set(key, list);
    return list[idx] as { current: T };
  }

  function nextCallback<T>(fn: T, deps?: unknown[]): T {
    const { key } = cursor;
    const idx = cursor.callback++;
    const list = callbacks.get(key) ?? [];
    const prev = list[idx];
    const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps![i]));
    if (changed) list[idx] = { deps, fn };
    callbacks.set(key, list);
    return list[idx].fn as T;
  }

  function nextEffect(fn: () => unknown, deps?: unknown[]) {
    const { key } = cursor;
    const idx = cursor.effect++;
    const list = effects.get(key) ?? [];
    const prev = list[idx];
    const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps![i]));
    if (changed) {
      currentEffects.push(() => {
        prev?.cleanup?.();
        const cleanup = fn();
        list[idx] = { deps, fn, cleanup: typeof cleanup === 'function' ? (cleanup as () => void) : undefined };
      });
    }
    effects.set(key, list);
  }

  const Fragment = Symbol('Fragment');
  const Suspense = Symbol('Suspense');
  function createElement(type: unknown, props: Record<string, any> | null, ...children: unknown[]): VNode {
    const flat = children.length === 0 ? props?.children : children.length === 1 ? children[0] : children;
    return { type, props: { ...(props ?? {}), ...(flat !== undefined ? { children: flat } : {}) } };
  }
  function jsx(type: unknown, props: Record<string, any>) {
    return { type, props: props ?? {} };
  }

  function lazy<P extends Record<string, any>>(loader: () => Promise<{ default: (props: P) => unknown }>) {
    let status: 'idle' | 'pending' | 'resolved' | 'rejected' = 'idle';
    let resolved: ((props: P) => unknown) | null = null;
    let error: unknown = null;
    let promise: Promise<void> | null = null;
    return function LazyWrapper(props: P) {
      if (status === 'resolved' && resolved) return resolved(props);
      if (status === 'rejected') throw error;
      if (status === 'idle') {
        status = 'pending';
        promise = loader().then(
          mod => { status = 'resolved'; resolved = mod.default; },
          err => { status = 'rejected'; error = err; },
        );
      }
      throw promise;
    };
  }

  const reactStub = {
    Fragment,
    Suspense,
    lazy,
    createElement,
    useState: nextState,
    useRef: nextRef,
    useCallback: nextCallback,
    useEffect: nextEffect,
    useId: () => `:r${++idSeq}:`,
  };

  const pendingRefs: Array<() => void> = [];
  const domEls = new Map<string, { el: MockEl; refFn?: (e: MockEl | null) => void }>();

  function expand(node: unknown, path = 'root', seenKeys = new Set<string>(), parentDialog: MockEl | null = null): unknown {
    if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}[${i}]`, seenKeys, parentDialog));
    const v = node as VNode;
    if (v.type === Fragment) return expand(v.props.children, `${path}/F`, seenKeys, parentDialog);
    if (v.type === Suspense) {
      try {
        return expand(v.props.children, `${path}/S`, seenKeys, parentDialog);
      } catch (thrown) {
        if (thrown && typeof (thrown as Promise<unknown>).then === 'function') {
          pendingSuspense.add(thrown as Promise<unknown>);
          return expand(v.props.fallback, `${path}/S-fallback`, seenKeys, parentDialog);
        }
        throw thrown;
      }
    }
    if (typeof v.type === 'function') {
      const fn = v.type as (p: Record<string, any>) => unknown;
      const key = `${path}/${fn.name || 'anon'}`;
      seenKeys.add(key);
      cursor = { key, state: 0, ref: 0, callback: 0, effect: 0 };
      currentEffects = [];
      const rendered = fn(v.props);
      const ownEffects = currentEffects;
      const expanded = expand(rendered, key, seenKeys, parentDialog);
      pendingEffects.push(...ownEffects);
      return expanded;
    }
    let nextDialog = parentDialog;
    if (v.props?.ref) {
      const domKey = `${path}/${String(v.type)}`;
      seenKeys.add(`dom:${domKey}`);
      let record = domEls.get(domKey);
      if (!record) {
        record = { el: makeEl(String(v.type), parentDialog) };
        domEls.set(domKey, record);
      }
      const el = record.el;
      if (typeof v.props.ref === 'function') {
        const refCb = v.props.ref as (e: MockEl | null) => void;
        if (record.refFn !== refCb) {
          record.refFn = refCb;
          pendingRefs.push(() => refCb(el));
        }
      } else {
        v.props.ref.current = el;
      }
      if (v.type === 'dialog') nextDialog = el;
    }
    const children = v.props?.children !== undefined ? expand(v.props.children, path, seenKeys, nextDialog) : undefined;
    return { type: v.type, props: { ...v.props, ...(children !== undefined ? { children } : {}) } };
  }

  function render(rootFn: () => unknown) {
    let tree: unknown;
    for (let pass = 0; pass < 6; pass++) {
      dirty = false;
      const seen = new Set<string>();
      tree = expand(rootFn(), 'root', seen);
      for (const [dk, rec] of [...domEls.entries()]) {
        if (!seen.has(`dom:${dk}`)) {
          rec.refFn?.(null);
          domEls.delete(dk);
        }
      }
      while (pendingRefs.length) pendingRefs.shift()!();
      while (pendingEffects.length) pendingEffects.shift()!();
      if (!dirty) break;
    }
    return tree;
  }

  async function flushLazy() {
    while (pendingSuspense.size) {
      const list = [...pendingSuspense];
      pendingSuspense.clear();
      await Promise.all(list);
    }
  }

  return {
    reactStub,
    jsxRuntime: { Fragment, jsx, jsxs: jsx },
    render,
    flushLazy,
    getActiveEl: () => activeEl,
    clearActiveEl: () => {
      if (activeEl) activeEl.focused = false;
      activeEl = null;
    },
  };
}

function collectNodes(node: unknown, out: VNode[] = []): VNode[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectNodes(item, out);
    return out;
  }
  const v = node as VNode;
  if ('type' in v && 'props' in v) {
    out.push(v);
    collectNodes(v.props?.children, out);
  }
  return out;
}

function nodeText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (node && typeof node === 'object' && 'props' in (node as VNode)) return nodeText((node as VNode).props?.children);
  return '';
}

function loadShareBox(harness: ReturnType<typeof createLazyHarness>) {
  let eventComposerLoads = 0;
  let cachedEventComposer: Record<string, any> | null = null;

  function compile(url: URL, requireFn: (id: string) => unknown) {
    const mod = { exports: {} as Record<string, any> };
    const code = transformSync(readFileSync(url, 'utf8'), {
      loader: 'tsx',
      format: 'cjs',
      jsx: 'automatic',
      supported: { 'dynamic-import': false },
    }).code;
    runInNewContext(code, {
      module: mod,
      exports: mod.exports,
      window: { location: { hash: '#home', assign() {} }, dispatchEvent() { return true; } },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
      setTimeout,
      clearTimeout,
      crypto,
      require: requireFn,
    });
    return mod.exports;
  }

  const sharePortMod = compile(sharePortPath, id => shareBoxRequire(id));
  const shareBoxMod = compile(shareBoxPath, id => {
    if (id === 'react') return harness.reactStub;
    if (id === 'react/jsx-runtime') return harness.jsxRuntime;
    if (id === './share.css') return {};
    if (id === './share-port') return sharePortMod;
    if (id === './EventComposer') {
      eventComposerLoads += 1;
      if (!cachedEventComposer) {
        cachedEventComposer = compile(eventComposerPath, dep => {
          if (dep === 'react') return harness.reactStub;
          if (dep === 'react/jsx-runtime') return harness.jsxRuntime;
          return shareBoxRequire(dep);
        });
      }
      return cachedEventComposer;
    }
    return shareBoxRequire(id);
  });

  return {
    ShareBox: shareBoxMod.ShareBox as (p: any) => unknown,
    getEventComposerLoads: () => eventComposerLoads,
  };
}

test('ShareBox loads EventComposer lazily on 活動 with muted 載入中… fallback and preserves dialog focus order', async () => {
  const client = new PortalClient();
  client.get = (async () => ({ items: [] })) as PortalClient['get'];

  const harness = createLazyHarness();
  const { ShareBox, getEventComposerLoads } = loadShareBox(harness);
  assert.equal(getEventComposerLoads(), 0, 'EventComposer must not load on ShareBox module evaluation');

  const renderBox = (request: Record<string, unknown> = {}) => harness.render(() =>
    harness.reactStub.createElement(ShareBox, {
      pending: { current: null },
      retainedImage: { current: undefined },
      retainedMode: { current: 'link' },
      client,
      request,
      value: '',
      manualTitle: '',
      onTitleChange() {},
      onChange() {},
      onDone() {},
      onChoose() {},
      storesEnabled: false,
    }),
  );

  let tree = renderBox();
  assert.equal(getEventComposerLoads(), 0, 'EventComposer must not load while on default 網址 tab');
  let nodes = collectNodes(tree);
  assert.equal(nodes.some(n => nodeText(n) === '載入中…'), false);

  harness.clearActiveEl();
  const eventBtn = nodes.find(n => n.type === 'button' && nodeText(n) === '活動')!;
  eventBtn.props.onClick();

  // First render after choosing 活動 shows the muted Suspense fallback inside the open dialog.
  tree = renderBox();
  nodes = collectNodes(tree);
  const loadingLine = nodes.find(n => nodeText(n) === '載入中…');
  assert.ok(loadingLine, 'expected 載入中… fallback line while EventComposer loads');
  assert.equal(String(loadingLine.props.className ?? '').split(/\s+/).includes('muted'), true, 'fallback line must use muted class');
  assert.equal(nodes.some(n => n.type === 'input' && n.props.type === 'url'), false);

  await harness.flushLazy();
  assert.equal(getEventComposerLoads(), 1, 'EventComposer must load once 活動 is chosen');

  tree = renderBox();
  nodes = collectNodes(tree);
  assert.equal(nodes.some(n => nodeText(n) === '載入中…'), false);
  const eventUrlInput = nodes.find(n => n.type === 'input' && n.props.type === 'url')!;
  assert.ok(eventUrlInput, 'expected EventComposer to render after lazy load');
  assert.equal(harness.getActiveEl() === eventUrlInput.props.ref.current, true, 'EventComposer first field must gain focus');
  assert.equal(harness.getActiveEl()?.parentDialog?.open, true, 'focus must stay inside open dialog');

  // Direct open with request.kind === 'event' must open <dialog> during fallback and focus EventComposer once loaded.
  const directHarness = createLazyHarness();
  const directMods = loadShareBox(directHarness);
  const renderDirect = () => directHarness.render(() =>
    directHarness.reactStub.createElement(directMods.ShareBox, {
      pending: { current: null },
      retainedImage: { current: undefined },
      retainedMode: { current: 'link' },
      client,
      request: { kind: 'event' },
      value: '',
      manualTitle: '',
      onTitleChange() {},
      onChange() {},
      onDone() {},
      onChoose() {},
      storesEnabled: false,
    }),
  );

  const fallbackTree = renderDirect();
  const fallbackNodes = collectNodes(fallbackTree);
  const directDialog = fallbackNodes.find(n => n.type === 'dialog')!;
  assert.equal(directDialog.props.ref !== undefined, true);
  assert.ok(fallbackNodes.find(n => nodeText(n) === '載入中…'), 'direct event open shows 載入中… while loading');
  assert.equal(directHarness.getActiveEl()?.tag, 'dialog', 'dialog opens and holds focus during lazy fallback');
  assert.equal(directHarness.getActiveEl()?.open, true);

  await directHarness.flushLazy();
  const readyTree = renderDirect();
  const directInput = collectNodes(readyTree).find(n => n.type === 'input' && n.props.type === 'url')!;
  assert.equal(directHarness.getActiveEl() === directInput.props.ref.current, true);
  assert.equal(directHarness.getActiveEl()?.parentDialog?.open, true);
});
