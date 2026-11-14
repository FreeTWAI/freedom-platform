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

function createHookHarness() {
  const states: Map<string, unknown[]> = new Map();
  const refs: Map<string, { current: unknown }[]> = new Map();
  const callbacks: Map<string, { deps: unknown[] | undefined; fn: unknown }[]> = new Map();
  const effects: Map<string, { deps: unknown[] | undefined; fn: () => unknown; cleanup?: () => void }[]> = new Map();
  const pendingEffects: (() => void)[] = [];
  let cursor = { key: '', state: 0, ref: 0, callback: 0, effect: 0 };
  let activeEl: MockEl | null = null;
  let idSeq = 0;

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
        // Real browser <dialog> ignores .focus() on descendants while the modal is closed.
        if (el.parentDialog && !el.parentDialog.open) return;
        if (activeEl) activeEl.focused = false;
        el.focused = true;
        activeEl = el;
      },
    };
    return el;
  }

  let dirty = false;

  function nextState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
    const { key } = cursor;
    const idx = cursor.state++;
    const list = states.get(key) ?? [];
    if (!(idx in list)) list[idx] = typeof init === 'function' ? (init as () => T)() : init;
    states.set(key, list);
    const set = (next: T | ((prev: T) => T)) => {
      list[idx] = typeof next === 'function' ? (next as (prev: T) => T)(list[idx] as T) : next;
      dirty = true;
    };
    return [list[idx] as T, set];
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

  let currentEffects: (() => void)[] = [];

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
  const pendingSuspense = new Set<Promise<unknown>>();
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
    return function LazyComponent(props: P) {
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
    let el: MockEl | undefined;
    if (v.props?.ref) {
      const domKey = `${path}/${String(v.type)}`;
      seenKeys.add(`dom:${domKey}`);
      let record = domEls.get(domKey);
      if (!record) {
        record = { el: makeEl(String(v.type), parentDialog) };
        domEls.set(domKey, record);
      }
      el = record.el;
      if (typeof v.props.ref === 'function') {
        const refCb = v.props.ref as (e: MockEl | null) => void;
        if (record.refFn !== refCb) {
          record.refFn = refCb;
          pendingRefs.push(() => refCb(el!));
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
      for (const [k, list] of [...effects.entries()]) {
        if (!seen.has(k)) {
          for (const item of list) item?.cleanup?.();
          effects.delete(k);
          states.delete(k);
          refs.delete(k);
          callbacks.delete(k);
        }
      }
      while (pendingEffects.length) {
        const run = pendingEffects.shift()!;
        run();
      }
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
    for (const child of node) collectNodes(child, out);
    return out;
  }
  const v = node as VNode;
  if (typeof v.type === 'string') out.push(v);
  if (v.props?.children !== undefined) collectNodes(v.props.children, out);
  return out;
}

function nodeText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  return nodeText((node as VNode).props?.children);
}

function hasClass(v: VNode, token: string): boolean {
  return String(v.props?.className ?? '').split(/\s+/).includes(token);
}

function loadShareModules(harness: ReturnType<typeof createHookHarness>) {
  const storage = new Map<string, string>();
  const dispatched: Array<{ type: string; detail: unknown }> = [];
  const win = {
    location: { hash: '#home', assign(next: string) { win.location.hash = next; } },
    dispatchEvent(ev: { type?: string; detail?: unknown }) { dispatched.push({ type: String(ev?.type ?? ''), detail: ev?.detail }); return true; },
  };
  const sessionStorageMock = {
    getItem(k: string) { return storage.has(k) ? storage.get(k)! : null; },
    setItem(k: string, v: string) { storage.set(k, String(v)); },
    removeItem(k: string) { storage.delete(k); },
  };

  function compileModule(url: URL, stubs: Record<string, unknown>) {
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
      window: win,
      sessionStorage: sessionStorageMock,
      CustomEvent: class CustomEvent<T = unknown> {
        type: string;
        detail: T | undefined;
        constructor(type: string, init?: { detail?: T }) {
          this.type = type;
          this.detail = init?.detail;
        }
      },
      setTimeout,
      clearTimeout,
      crypto,
      require: (id: string) => Object.hasOwn(stubs, id) ? stubs[id] : shareBoxRequire(id),
    });
    return mod.exports;
  }

  const sharePortMod = compileModule(sharePortPath, {});
  const eventComposerMod = compileModule(eventComposerPath, {
    react: harness.reactStub,
    'react/jsx-runtime': harness.jsxRuntime,
  });
  const shareBoxMod = compileModule(shareBoxPath, {
    react: harness.reactStub,
    'react/jsx-runtime': harness.jsxRuntime,
    './share.css': {},
    './share-port': sharePortMod,
    './EventComposer': eventComposerMod,
  });

  return {
    ShareBox: shareBoxMod.ShareBox as (p: any) => unknown,
    ShareBoxLauncher: shareBoxMod.ShareBoxLauncher as (p: any) => unknown,
    openShareComposer: sharePortMod.openShareComposer as (r?: Record<string, unknown>) => Promise<{ status: string }>,
    storage,
    win,
    dispatched,
  };
}

test('UX-M-03: 作品 and 服務 live as links behind 更多 and preserve typed draft on return', async () => {
  const harness = createHookHarness();
  const { ShareBox, ShareBoxLauncher, openShareComposer, storage } = loadShareModules(harness);
  const client = new PortalClient();

  let draft = '未完成分享內容';
  const results: Array<{ status: string }> = [];
  let tree = harness.render(() =>
    harness.reactStub.createElement(ShareBox, {
      pending: { current: null },
      retainedImage: { current: undefined },
      retainedMode: { current: 'link' },
      client,
      request: {},
      value: draft,
      manualTitle: '',
      onTitleChange() {},
      onChange(v: string) { draft = v; },
      onDone(r: { status: string }) { results.push(r); },
      onChoose() {},
      storesEnabled: false,
    }),
  );

  let nodes = collectNodes(tree);
  const chipDiv = nodes.find(n => n.type === 'div' && hasClass(n, 'share-chips'));
  assert.ok(chipDiv, 'share-chips container exists');
  const chipLabels = collectNodes(chipDiv).filter(n => n.type === 'button').map(nodeText);
  assert.deepEqual(chipLabels, ['網址', '貼文', '活動', '更多']);
  assert.equal(nodes.filter(n => hasClass(n, 'btn-primary')).length, 1);
  assert.equal(nodes.filter(n => n.type === 'a').length, 0);

  const moreBtn = collectNodes(chipDiv).find(n => n.type === 'button' && nodeText(n) === '更多')!;
  assert.equal(moreBtn.props['aria-expanded'], false);
  moreBtn.props.onClick();

  tree = harness.render(() =>
    harness.reactStub.createElement(ShareBox, {
      pending: { current: null },
      retainedImage: { current: undefined },
      retainedMode: { current: 'link' },
      client,
      request: {},
      value: draft,
      manualTitle: '',
      onTitleChange() {},
      onChange(v: string) { draft = v; },
      onDone(r: { status: string }) { results.push(r); },
      onChoose() {},
      storesEnabled: false,
    }),
  );
  nodes = collectNodes(tree);
  assert.equal(nodes.filter(n => hasClass(n, 'btn-primary')).length, 0);
  const options = nodes.find(n => n.type === 'div' && hasClass(n, 'share-options'));
  assert.ok(options, 'share-options disclosure panel opens');
  const links = collectNodes(options).filter(n => n.type === 'a').map(a => ({ text: nodeText(a), href: a.props.href }));
  assert.deepEqual(links, [
    { text: '作品', href: '#explore/works' },
    { text: '服務', href: '#explore/services' },
  ]);
  const optionButtons = collectNodes(options).filter(n => n.type === 'button').map(nodeText);
  assert.equal(optionButtons.includes('刊登商品'), false);
  assert.equal(optionButtons.includes('供貨'), false);

  const storeTree = harness.render(() =>
    harness.reactStub.createElement(ShareBox, {
      pending: { current: null },
      retainedImage: { current: undefined },
      retainedMode: { current: 'link' },
      client,
      request: {},
      value: draft,
      manualTitle: '',
      onTitleChange() {},
      onChange() {},
      onDone() {},
      onChoose() {},
      storesEnabled: true,
    }),
  );
  const storeOptionButtons = collectNodes(storeTree).filter(n => n.type === 'button').map(nodeText);
  assert.equal(storeOptionButtons.includes('刊登商品'), true);
  assert.equal(storeOptionButtons.includes('供貨'), true);

  // Launcher preserves typed draft across opening 作品 / 服務 links and reopening.
  const launcherHarness = createHookHarness();
  const launcherMods = loadShareModules(launcherHarness);
  const renderLauncher = () => launcherHarness.render(() =>
    launcherHarness.reactStub.createElement(launcherMods.ShareBoxLauncher, {
      client,
      userId: 'user-1',
      onChoose() {},
      storesEnabled: false,
    }),
  );
  renderLauncher();

  for (const [linkName, expectedHref] of [['作品', '#explore/works'], ['服務', '#explore/services']] as const) {
    const composePromise = launcherMods.openShareComposer();
    let lTree = renderLauncher();
    if (linkName === '作品') {
      const textarea = collectNodes(lTree).find(n => n.type === 'textarea')!;
      textarea.props.onChange({ target: { value: '尚未完成的分享' } });
      lTree = renderLauncher();
    }
    const more = collectNodes(lTree).find(n => n.type === 'button' && nodeText(n) === '更多')!;
    more.props.onClick();
    lTree = renderLauncher();
    const link = collectNodes(lTree).find(n => n.type === 'a' && nodeText(n) === linkName)!;
    assert.equal(link.props.href, expectedHref);
    link.props.onClick();
    const res = await composePromise;
    assert.equal(res.status, 'cancelled');
    assert.equal(launcherMods.storage.get('share-draft:user-1'), '尚未完成的分享');
    lTree = renderLauncher();
    assert.equal(collectNodes(lTree).filter(n => n.type === 'dialog').length, 0);

    const reopenPromise = launcherMods.openShareComposer();
    lTree = renderLauncher();
    const restoredTextarea = collectNodes(lTree).find(n => n.type === 'textarea')!;
    assert.equal(restoredTextarea.props.value, '尚未完成的分享');
    const closeBtn = collectNodes(lTree).find(n => n.type === 'button' && nodeText(n) === '關閉')!;
    closeBtn.props.onClick();
    assert.equal((await reopenPromise).status, 'cancelled');
    renderLauncher();
  }
  assert.equal(storage.size, 0);
});

test('UX-F-09: 活動 chip sits next to 網址 and 貼文 and keeps focus inside dialog', async () => {
  const client = new PortalClient();
  client.get = (async () => ({ items: [] })) as PortalClient['get'];

  // 1) Switching from 網址 -> 活動 moves focus to 活動連結（選填） inside the open dialog, and back to 網址 keeps draft & focus.
  const harness = createHookHarness();
  const { ShareBox } = loadShareModules(harness);
  let draft = '活動測試草稿';
  const renderBox = (request: Record<string, unknown> = {}) => harness.render(() =>
    harness.reactStub.createElement(ShareBox, {
      pending: { current: null },
      retainedImage: { current: undefined },
      retainedMode: { current: 'link' },
      client,
      request,
      value: draft,
      manualTitle: '',
      onTitleChange() {},
      onChange(v: string) { draft = v; },
      onDone() {},
      onChoose() {},
      storesEnabled: false,
    }),
  );

  let tree = renderBox();
  let nodes = collectNodes(tree);
  const chipLabels = collectNodes(nodes.find(n => n.type === 'div' && hasClass(n, 'share-chips'))!).filter(n => n.type === 'button').map(nodeText);
  assert.deepEqual(chipLabels.slice(0, 3), ['網址', '貼文', '活動']);

  harness.clearActiveEl();
  const eventBtn = nodes.find(n => n.type === 'button' && nodeText(n) === '活動')!;
  eventBtn.props.onClick();
  tree = renderBox();
  await harness.flushLazy();
  tree = renderBox();
  nodes = collectNodes(tree);
  const activeEventBtn = nodes.find(n => n.type === 'button' && nodeText(n) === '活動')!;
  assert.equal(activeEventBtn.props['aria-pressed'], true);
  const eventUrlInput = nodes.find(n => n.type === 'input' && n.props.type === 'url')!;
  assert.equal(harness.getActiveEl() === eventUrlInput.props.ref.current, true);
  assert.equal(harness.getActiveEl()?.parentDialog?.open, true);

  const linkBtn = nodes.find(n => n.type === 'button' && nodeText(n) === '網址')!;
  linkBtn.props.onClick();
  tree = renderBox();
  nodes = collectNodes(tree);
  const textarea = nodes.find(n => n.type === 'textarea')!;
  assert.equal(textarea.props.value, '活動測試草稿');
  assert.equal(harness.getActiveEl() === textarea.props.ref.current, true);

  // 2) Opening ShareBox directly with request.kind==='event' must open <dialog> before focusing EventComposer's first field.
  const directHarness = createHookHarness();
  const directMods = loadShareModules(directHarness);
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
  renderDirect();
  await directHarness.flushLazy();
  const directTree = renderDirect();
  const directNodes = collectNodes(directTree);
  const directInput = directNodes.find(n => n.type === 'input' && n.props.type === 'url')!;
  assert.equal(directHarness.getActiveEl() === directInput.props.ref.current, true);
});

test('UX-F-06: publishing from any home route stays on home and emits freedom-share-published with shareId and url', async () => {
  for (const startHash of ['#home', '', '#social', '#home?from=1']) {
    const harness = createHookHarness();
    const { ShareBoxLauncher, openShareComposer, win, dispatched, storage } = loadShareModules(harness);
    win.location.hash = startHash;
    const client = new PortalClient();
    const postedPaths: string[] = [];
    client.post = (async (path: string) => {
      postedPaths.push(path);
      if (path === '/social-posts/notes') return { post_id: '00000000-0000-4000-8000-000000000001', share_id: '00000000-0000-4000-8000-000000000002' };
      throw new Error(`unexpected post ${path}`);
    }) as PortalClient['post'];

    const renderLauncher = () => harness.render(() =>
      harness.reactStub.createElement(ShareBoxLauncher, {
        client,
        userId: 'u-home',
        onChoose() {},
        storesEnabled: false,
      }),
    );
    renderLauncher();
    const composePromise = openShareComposer();
    let tree = renderLauncher();
    const postChip = collectNodes(tree).find(n => n.type === 'button' && nodeText(n) === '貼文')!;
    postChip.props.onClick();
    tree = renderLauncher();
    const textarea = collectNodes(tree).find(n => n.type === 'textarea')!;
    textarea.props.onChange({ target: { value: '首頁貼文內容' } });
    tree = renderLauncher();
    const dialog = collectNodes(tree).find(n => n.type === 'dialog')!;
    const publishBtn = collectNodes(dialog).find(n => n.type === 'button' && nodeText(n) === '發布')!;
    assert.equal(Boolean(publishBtn.props.disabled), false);
    publishBtn.props.onClick();
    const result = await composePromise;
    assert.equal(result.status, 'published');
    assert.deepEqual(postedPaths, ['/social-posts/notes']);
    assert.equal(win.location.hash, startHash);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, 'freedom-share-published');
    const detail = dispatched[0].detail as { shareId?: string; url?: string; title?: string; kind?: string };
    assert.equal(detail.shareId, '00000000-0000-4000-8000-000000000002');
    assert.equal(detail.url, '/#shares/00000000-0000-4000-8000-000000000002');
    assert.equal(detail.title, '首頁貼文內容');
    assert.equal(detail.kind, 'post');
    assert.equal(storage.get('share-draft:u-home'), undefined);
  }

  // Publishing from #explore still navigates to #shares/<id> without dispatching freedom-share-published.
  const exploreHarness = createHookHarness();
  const exploreMods = loadShareModules(exploreHarness);
  exploreMods.win.location.hash = '#explore';
  const exploreClient = new PortalClient();
  const explorePostedPaths: string[] = [];
  exploreClient.post = (async (path: string) => {
    explorePostedPaths.push(path);
    if (path === '/social-posts/notes') return { post_id: '00000000-0000-4000-8000-000000000003', share_id: '00000000-0000-4000-8000-000000000004' };
    throw new Error(`unexpected post ${path}`);
  }) as PortalClient['post'];
  const renderExplore = () => exploreHarness.render(() =>
    exploreHarness.reactStub.createElement(exploreMods.ShareBoxLauncher, {
      client: exploreClient,
      userId: 'u-explore',
      onChoose() {},
      storesEnabled: false,
    }),
  );
  renderExplore();
  const explorePromise = exploreMods.openShareComposer();
  let eTree = renderExplore();
  collectNodes(eTree).find(n => n.type === 'button' && nodeText(n) === '貼文')!.props.onClick();
  eTree = renderExplore();
  collectNodes(eTree).find(n => n.type === 'textarea')!.props.onChange({ target: { value: '探索貼文內容' } });
  eTree = renderExplore();
  const exploreDialog = collectNodes(eTree).find(n => n.type === 'dialog')!;
  collectNodes(exploreDialog).find(n => n.type === 'button' && nodeText(n) === '發布')!.props.onClick();
  await explorePromise;
  assert.deepEqual(explorePostedPaths, ['/social-posts/notes']);
  assert.equal(exploreMods.win.location.hash, '#shares/00000000-0000-4000-8000-000000000004');
  assert.equal(exploreMods.dispatched.length, 0);
});

test('a note shared from a guild tool records the tool as the share source', async () => {
  const harness = createHookHarness();
  const { ShareBoxLauncher, openShareComposer, win } = loadShareModules(harness);
  win.location.hash = '#guilds/guild_games/tools/guest-draft';
  const client = new PortalClient();
  const posted: { path: string; body: unknown; key?: string }[] = [];
  client.post = (async (path: string, body: unknown, options?: { idempotencyKey?: string }) => {
    posted.push({ path, body, key: options?.idempotencyKey });
    if (path === '/social-posts/notes') return { post_id: '00000000-0000-4000-8000-000000000011', share_id: '00000000-0000-4000-8000-000000000012' };
    if (path === '/shares') return { share_id: '00000000-0000-4000-8000-000000000012', created: false, url: '/#shares/00000000-0000-4000-8000-000000000012' };
    throw new Error(`unexpected post ${path}`);
  }) as PortalClient['post'];
  const render = () => harness.render(() =>
    harness.reactStub.createElement(ShareBoxLauncher, { client, userId: 'u-tool', onChoose() {}, storesEnabled: false }),
  );
  render();
  const composePromise = openShareComposer({ text: '工具裡寫的筆記', source: { guild_key: 'guild_games', tool_id: 'guest-draft' } });
  let tree = render();
  const postChip = collectNodes(tree).find(n => n.type === 'button' && nodeText(n) === '貼文');
  if (postChip) { postChip.props.onClick(); tree = render(); }
  const textarea = collectNodes(tree).find(n => n.type === 'textarea')!;
  textarea.props.onChange({ target: { value: '工具裡寫的筆記' } });
  tree = render();
  const dialog = collectNodes(tree).find(n => n.type === 'dialog')!;
  collectNodes(dialog).find(n => n.type === 'button' && nodeText(n) === '發布')!.props.onClick();
  const result = await composePromise;
  assert.equal(result.status, 'published');
  // Publishing the note made the share; the second call only endorses it again with the tool as source.
  assert.deepEqual(posted.map(p => p.path), ['/social-posts/notes', '/shares']);
  assert.deepEqual(JSON.parse(JSON.stringify(posted[1].body)), { kind: 'post', ref_id: '00000000-0000-4000-8000-000000000011', source: { guild_key: 'guild_games', tool_id: 'guest-draft' } });
  assert.equal(posted[1].key, `${posted[0].key}-share`);
  assert.equal((result as { share_id?: string }).share_id, '00000000-0000-4000-8000-000000000012');
});

test('UX-F-06: freedom-share-published carries title and kind from publish answer or ShareBox preview/manual title', async () => {
  // 1) Link/repository share where publish answer omits title and kind -> falls back to ShareBox preview.
  {
    const harness = createHookHarness();
    const { ShareBoxLauncher, openShareComposer, win, dispatched } = loadShareModules(harness);
    win.location.hash = '#home';
    const client = new PortalClient();
    client.post = (async (path: string) => {
      if (path === '/shares/preview') {
        return { kind: 'repository', title: 'freetwai-test/shared-repo', url: 'https://github.com/freetwai-test/shared-repo', description: 'repo desc', original_author: 'freetwai-test' };
      }
      if (path === '/shares') {
        return { share_id: '00000000-0000-4000-8000-000000000011', url: '/#shares/00000000-0000-4000-8000-000000000011' };
      }
      throw new Error(`unexpected post ${path}`);
    }) as PortalClient['post'];

    const renderLauncher = () => harness.render(() =>
      harness.reactStub.createElement(ShareBoxLauncher, { client, userId: 'u-repo', onChoose() {}, storesEnabled: false }),
    );
    renderLauncher();
    const composePromise = openShareComposer();
    let tree = renderLauncher();
    collectNodes(tree).find(n => n.type === 'textarea')!.props.onChange({ target: { value: 'https://github.com/freetwai-test/shared-repo' } });
    renderLauncher();
    await new Promise(resolve => setTimeout(resolve, 460));
    tree = renderLauncher();
    const publishBtn = collectNodes(tree).find(n => n.type === 'button' && nodeText(n) === '發布')!;
    assert.equal(Boolean(publishBtn.props.disabled), false);
    publishBtn.props.onClick();
    await composePromise;
    assert.equal(dispatched.length, 1);
    const detail1 = dispatched[0].detail as Record<string, unknown>;
    assert.deepEqual({ ...detail1 }, {
      shareId: '00000000-0000-4000-8000-000000000011',
      url: '/#shares/00000000-0000-4000-8000-000000000011',
      title: 'freetwai-test/shared-repo',
      kind: 'repository',
    });
  }

  // 2) Manual-title link share where preview returned 422 and publish answer lacks title/kind.
  {
    const harness = createHookHarness();
    const { ShareBoxLauncher, openShareComposer, win, dispatched } = loadShareModules(harness);
    win.location.hash = '#home';
    const client = new PortalClient();
    const { ApiError: ShareApiError } = shareBoxRequire('../api');
    client.post = (async (path: string) => {
      if (path === '/shares/preview') {
        throw new ShareApiError({ message: '無法讀取預覽。', status: 422, code: 'preview_unavailable' });
      }
      if (path === '/shares') {
        return { share_id: '00000000-0000-4000-8000-000000000012', url: '/#shares/00000000-0000-4000-8000-000000000012' };
      }
      throw new Error(`unexpected post ${path}`);
    }) as PortalClient['post'];

    const renderLauncher = () => harness.render(() =>
      harness.reactStub.createElement(ShareBoxLauncher, { client, userId: 'u-manual', onChoose() {}, storesEnabled: false }),
    );
    renderLauncher();
    const composePromise = openShareComposer();
    let tree = renderLauncher();
    collectNodes(tree).find(n => n.type === 'textarea')!.props.onChange({ target: { value: 'https://example.com/unreadable' } });
    renderLauncher();
    await new Promise(resolve => setTimeout(resolve, 460));
    tree = renderLauncher();
    const titleInput = collectNodes(tree).find(n => n.type === 'input')!;
    titleInput.props.onChange({ target: { value: '手動分享標題' } });
    tree = renderLauncher();
    const publishBtn = collectNodes(tree).find(n => n.type === 'button' && nodeText(n) === '發布')!;
    assert.equal(Boolean(publishBtn.props.disabled), false);
    publishBtn.props.onClick();
    await composePromise;
    assert.equal(dispatched.length, 1);
    const detail2 = dispatched[0].detail as Record<string, unknown>;
    assert.deepEqual({ ...detail2 }, {
      shareId: '00000000-0000-4000-8000-000000000012',
      url: '/#shares/00000000-0000-4000-8000-000000000012',
      title: '手動分享標題',
      kind: 'link',
    });
  }

  // 3) When publish answer provides title and kind, prefer the publish answer.
  {
    const harness = createHookHarness();
    const { ShareBoxLauncher, openShareComposer, win, dispatched } = loadShareModules(harness);
    win.location.hash = '#home';
    const client = new PortalClient();
    client.post = (async (path: string) => {
      if (path === '/shares/preview') {
        return { kind: 'link', title: 'Preview Title', url: 'https://example.com/p', description: '', original_author: null };
      }
      if (path === '/shares') {
        return {
          share_id: '00000000-0000-4000-8000-000000000013',
          url: '/#shares/00000000-0000-4000-8000-000000000013',
          title: 'Server Canonical Title',
          kind: 'repository',
        };
      }
      throw new Error(`unexpected post ${path}`);
    }) as PortalClient['post'];

    const renderLauncher = () => harness.render(() =>
      harness.reactStub.createElement(ShareBoxLauncher, { client, userId: 'u-ans', onChoose() {}, storesEnabled: false }),
    );
    renderLauncher();
    const composePromise = openShareComposer();
    let tree = renderLauncher();
    collectNodes(tree).find(n => n.type === 'textarea')!.props.onChange({ target: { value: 'https://example.com/p' } });
    renderLauncher();
    await new Promise(resolve => setTimeout(resolve, 460));
    tree = renderLauncher();
    collectNodes(tree).find(n => n.type === 'button' && nodeText(n) === '發布')!.props.onClick();
    await composePromise;
    assert.equal(dispatched.length, 1);
    const detail3 = dispatched[0].detail as Record<string, unknown>;
    assert.deepEqual({ ...detail3 }, {
      shareId: '00000000-0000-4000-8000-000000000013',
      url: '/#shares/00000000-0000-4000-8000-000000000013',
      title: 'Server Canonical Title',
      kind: 'repository',
    });
  }
});
