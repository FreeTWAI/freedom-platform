import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { PortalClient } from '../../apps/portal-web/src/api.js';

const memberHomePath = new URL('../../apps/portal-web/src/modules/MemberHome.tsx', import.meta.url);
const memberHomeRequire = createRequire(memberHomePath);

type VNode = { type: unknown; props: Record<string, any> };
type MockEl = {
  tag: string;
  focusCount: number;
  focused: boolean;
  focus: () => void;
  closest: () => null;
};

function createHookHarness() {
  const states: Map<string, unknown[]> = new Map();
  const refs: Map<string, { current: unknown }[]> = new Map();
  const memos: Map<string, { deps: unknown[] | undefined; value: unknown }[]> = new Map();
  const callbacks: Map<string, { deps: unknown[] | undefined; fn: unknown }[]> = new Map();
  const effects: Map<string, { deps: unknown[] | undefined; fn: () => unknown; cleanup?: () => void }[]> = new Map();
  const pendingEffects: (() => void)[] = [];
  let cursor = { key: '', state: 0, ref: 0, memo: 0, callback: 0, effect: 0 };
  let activeEl: MockEl | null = null;
  let idSeq = 0;
  let dirty = false;

  function makeEl(tag: string): MockEl {
    const el: MockEl = {
      tag,
      focusCount: 0,
      focused: false,
      focus() {
        if (activeEl) activeEl.focused = false;
        el.focused = true;
        el.focusCount += 1;
        activeEl = el;
      },
      closest() { return null; },
    };
    return el;
  }

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

  function depsChanged(prev: unknown[] | undefined, next: unknown[] | undefined) {
    return !prev || !next || prev.length !== next.length || next.some((d, i) => !Object.is(d, prev[i]));
  }

  function nextMemo<T>(fn: () => T, deps?: unknown[]): T {
    const { key } = cursor;
    const idx = cursor.memo++;
    const list = memos.get(key) ?? [];
    const prev = list[idx];
    if (!prev || depsChanged(prev.deps, deps)) list[idx] = { deps, value: fn() };
    memos.set(key, list);
    return list[idx].value as T;
  }

  function nextCallback<T>(fn: T, deps?: unknown[]): T {
    const { key } = cursor;
    const idx = cursor.callback++;
    const list = callbacks.get(key) ?? [];
    const prev = list[idx];
    if (!prev || depsChanged(prev.deps, deps)) list[idx] = { deps, fn };
    callbacks.set(key, list);
    return list[idx].fn as T;
  }

  let currentEffects: (() => void)[] = [];
  function nextEffect(fn: () => unknown, deps?: unknown[]) {
    const { key } = cursor;
    const idx = cursor.effect++;
    const list = effects.get(key) ?? [];
    const prev = list[idx];
    if (!prev || depsChanged(prev.deps, deps)) {
      currentEffects.push(() => {
        prev?.cleanup?.();
        const cleanup = fn();
        list[idx] = { deps, fn, cleanup: typeof cleanup === 'function' ? (cleanup as () => void) : undefined };
      });
    }
    effects.set(key, list);
  }

  const Fragment = Symbol('Fragment');
  function createElement(type: unknown, props: Record<string, any> | null, ...children: unknown[]): VNode {
    const flat = children.length === 0 ? props?.children : children.length === 1 ? children[0] : children;
    return { type, props: { ...(props ?? {}), ...(flat !== undefined ? { children: flat } : {}) } };
  }
  function jsx(type: unknown, props: Record<string, any>) {
    return { type, props: props ?? {} };
  }

  const reactStub = {
    Fragment,
    createElement,
    useState: nextState,
    useRef: nextRef,
    useMemo: nextMemo,
    useCallback: nextCallback,
    useEffect: nextEffect,
    useId: () => `:r${++idSeq}:`,
  };

  const domEls = new Map<string, MockEl>();
  function expand(node: unknown, path = 'root', seenKeys = new Set<string>()): unknown {
    if (node == null || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) return node.map((child, i) => expand(child, `${path}[${i}]`, seenKeys));
    const v = node as VNode;
    if (v.type === Fragment) return expand(v.props.children, `${path}/F`, seenKeys);
    if (typeof v.type === 'function') {
      const fn = v.type as (p: Record<string, any>) => unknown;
      const key = `${path}/${fn.name || 'anon'}`;
      seenKeys.add(key);
      cursor = { key, state: 0, ref: 0, memo: 0, callback: 0, effect: 0 };
      currentEffects = [];
      const rendered = fn(v.props);
      const ownEffects = currentEffects;
      const expanded = expand(rendered, key, seenKeys);
      pendingEffects.push(...ownEffects);
      return expanded;
    }
    if (v.props?.ref && typeof v.props.ref === 'object') {
      const domKey = `${path}/${String(v.type)}`;
      seenKeys.add(`dom:${domKey}`);
      let el = domEls.get(domKey);
      if (!el) {
        el = makeEl(String(v.type));
        domEls.set(domKey, el);
      }
      v.props.ref.current = el;
    }
    const children = v.props?.children !== undefined ? expand(v.props.children, path, seenKeys) : undefined;
    return { type: v.type, props: { ...v.props, ...(children !== undefined ? { children } : {}) } };
  }

  function render(rootFn: () => unknown) {
    let tree: unknown;
    for (let pass = 0; pass < 6; pass++) {
      dirty = false;
      const seen = new Set<string>();
      tree = expand(rootFn(), 'root', seen);
      for (const [k, list] of [...effects.entries()]) {
        if (!seen.has(k)) {
          for (const item of list) item?.cleanup?.();
          effects.delete(k);
          states.delete(k);
          refs.delete(k);
          memos.delete(k);
          callbacks.delete(k);
        }
      }
      while (pendingEffects.length) pendingEffects.shift()!();
      if (!dirty) break;
    }
    return tree;
  }

  return {
    reactStub,
    jsxRuntime: { Fragment, jsx, jsxs: jsx },
    render,
    getActiveEl: () => activeEl,
    getElByTag: (tag: string) => [...domEls.values()].filter(el => el.tag === tag),
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

function directChildren(node: VNode): VNode[] {
  const out: VNode[] = [];
  const visit = (child: unknown) => {
    if (!child || typeof child !== 'object') return;
    if (Array.isArray(child)) {
      for (const c of child) visit(c);
      return;
    }
    const v = child as VNode;
    if (typeof v.type === 'string') out.push(v);
    else if (v.props?.children !== undefined) visit(v.props.children);
  };
  visit(node.props?.children);
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

function loadMemberHome(harness: ReturnType<typeof createHookHarness>) {
  const listeners = new Map<string, Set<(ev: unknown) => void>>();
  const win = {
    addEventListener(type: string, fn: (ev: unknown) => void) {
      let set = listeners.get(type);
      if (!set) { set = new Set(); listeners.set(type, set); }
      set.add(fn);
    },
    removeEventListener(type: string, fn: (ev: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev: { type: string; detail?: unknown }) {
      for (const fn of [...(listeners.get(ev.type) ?? [])]) fn(ev);
      return true;
    },
  };

  const stubs: Record<string, unknown> = {
    react: harness.reactStub,
    'react/jsx-runtime': harness.jsxRuntime,
    '../share/RecentEvents': { RecentEvents: () => null },
    '../language': { useLanguage: () => ({ t: (k: string) => k }) },
    './FirstParticipation': { FirstParticipation: () => null },
    './Membership': { loadLabels: async () => ({}) },
    './MemberAvatar': { MemberAvatar: () => null },
    '../share/ShareButton': { promotionLink: () => async () => '', ShareButton: () => null },
    '../game-console-core': { logConsoleEvent: () => {} },
    '../game-console-routing': { consoleChannel: (c: string) => c },
    './HomeDesign.css': {},
    './MemberRecommendations': { MemberRecommendations: () => null },
    './SkillBookIntro': { SkillBookIntro: () => null },
    './chat-entry': { openMemberChat: () => {} },
    './SocialZone': {
      SocialZone: () => harness.reactStub.createElement('div', { className: 'social-zone' },
        harness.reactStub.createElement('article', null, '既有貼文'),
      ),
    },
    './member-home-loading': {
      consumeHomeJournalIntent: () => false,
      createHomeReadCycle: () => ({ begin: () => null, cancel: () => {} }),
      loadHomeNextSteps: async () => {},
      observeHomeReturns: () => () => {},
      resolveHomeJournalUrl: () => '',
    },
  };

  const mod = { exports: {} as Record<string, any> };
  const code = transformSync(readFileSync(memberHomePath, 'utf8'), {
    loader: 'tsx',
    format: 'cjs',
    jsx: 'automatic',
    define: { 'import.meta.env': 'undefined' },
  }).code;
  runInNewContext(code, {
    module: mod,
    exports: mod.exports,
    window: win,
    document: { visibilityState: 'visible', activeElement: null, body: null },
    navigator: { onLine: true },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    require: (id: string) => Object.hasOwn(stubs, id) ? stubs[id] : memberHomeRequire(id),
  });

  return {
    MemberHome: mod.exports.MemberHome as (p: any) => unknown,
    win,
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

test('UX-F-06: MemberHome shows published share as first focused article in .home-timeline, replaces on second publish, and cleans up listener', () => {
  const harness = createHookHarness();
  const { MemberHome, win, listenerCount } = loadMemberHome(harness);
  const client = new PortalClient();
  client.get = (async () => ({})) as PortalClient['get'];
  const session = { user: { user_id: 'u-1', display_name: '測試會員' } };
  let mounted = true;
  const renderHome = () => harness.render(() =>
    mounted
      ? harness.reactStub.createElement(MemberHome, { client, session, openHomeJournal: () => false })
      : null,
  );

  let tree = renderHome();
  assert.equal(listenerCount('freedom-share-published'), 1);
  let timeline = collectNodes(tree).find(n => n.type === 'section' && hasClass(n, 'home-timeline'))!;
  assert.ok(timeline, '.home-timeline section exists');
  assert.equal(directChildren(timeline).filter(n => n.type === 'article').length, 0);

  // 1) First publish: repository share without explicit url -> uses fallback #shares/<id>, label 開源專案, tabIndex=-1, gets focus once.
  win.dispatchEvent({
    type: 'freedom-share-published',
    detail: { shareId: '11111111-1111-4111-8111-111111111111', title: 'freetwai-test/shared-repo', kind: 'repository' },
  });
  tree = renderHome();
  timeline = collectNodes(tree).find(n => n.type === 'section' && hasClass(n, 'home-timeline'))!;
  const childrenAfterFirst = directChildren(timeline);
  assert.equal(childrenAfterFirst[0]?.type, 'article');
  assert.equal(hasClass(childrenAfterFirst[1]!, 'social-zone'), true);
  assert.equal(childrenAfterFirst.filter(n => n.type === 'article').length, 1);

  const firstArticle = childrenAfterFirst[0]!;
  assert.equal(firstArticle.props.tabIndex, -1);
  assert.ok(nodeText(firstArticle).includes('freetwai-test/shared-repo'));
  assert.ok(nodeText(firstArticle).includes('開源專案'));
  const firstLinks = collectNodes(firstArticle).filter(n => n.type === 'a');
  assert.equal(firstLinks.length, 1);
  assert.equal(nodeText(firstLinks[0]), '看分享頁');
  assert.equal(firstLinks[0].props.href, '#shares/11111111-1111-4111-8111-111111111111');

  const articleEl = harness.getElByTag('article')[0];
  assert.equal(articleEl?.focusCount, 1);
  assert.equal(harness.getActiveEl(), articleEl);

  // Re-render without a new event does not re-focus.
  tree = renderHome();
  assert.equal(harness.getElByTag('article')[0]?.focusCount, 1);

  // 2) Second publish: link share with detail.url replaces the card and focuses once again.
  win.dispatchEvent({
    type: 'freedom-share-published',
    detail: {
      shareId: '22222222-2222-4222-8222-222222222222',
      url: '/#shares/22222222-2222-4222-8222-222222222222',
      title: '手動分享標題',
      kind: 'link',
    },
  });
  tree = renderHome();
  timeline = collectNodes(tree).find(n => n.type === 'section' && hasClass(n, 'home-timeline'))!;
  const articlesAfterSecond = directChildren(timeline).filter(n => n.type === 'article');
  assert.equal(articlesAfterSecond.length, 1);
  const secondArticle = articlesAfterSecond[0]!;
  assert.equal(secondArticle.props.tabIndex, -1);
  assert.ok(nodeText(secondArticle).includes('手動分享標題'));
  assert.ok(nodeText(secondArticle).includes('網址'));
  assert.equal(nodeText(secondArticle).includes('freetwai-test/shared-repo'), false);
  const secondLinks = collectNodes(secondArticle).filter(n => n.type === 'a');
  assert.equal(secondLinks.length, 1);
  assert.equal(nodeText(secondLinks[0]), '看分享頁');
  assert.equal(secondLinks[0].props.href, '/#shares/22222222-2222-4222-8222-222222222222');
  assert.equal(harness.getElByTag('article')[0]?.focusCount, 2);

  // 3) Unmount removes the window listener.
  mounted = false;
  renderHome();
  assert.equal(listenerCount('freedom-share-published'), 0);
});
