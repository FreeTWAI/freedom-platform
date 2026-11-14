import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { PortalClient } from '../../apps/portal-web/src/api.js';

const shareBoxPath = new URL('../../apps/portal-web/src/share/ShareBox.tsx', import.meta.url);
const sharePortPath = new URL('../../apps/portal-web/src/share/share-port.ts', import.meta.url);
const shareBoxRequire = createRequire(shareBoxPath);

type VNode = { type: unknown; props: Record<string, any> };

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

function loadLauncher() {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const effects: Array<{ fn: () => unknown; cleanup?: () => void }> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  let mounted = false;

  const Fragment = Symbol('Fragment');
  const Suspense = Symbol('Suspense');
  const createElement = (type: unknown, props: Record<string, any> | null, ...children: unknown[]): VNode => ({
    type,
    props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children },
  });
  const jsx = (type: unknown, props: Record<string, any> | null): VNode => ({ type, props: props ?? {} });

  const reactStub = {
    Fragment,
    Suspense,
    lazy: (loader: () => Promise<{ default?: unknown }>) => {
      let resolved: unknown = null;
      return (props: Record<string, any>) => {
        if (!resolved) {
          void loader().then(mod => { resolved = mod.default ?? mod; });
          return null;
        }
        return createElement(resolved, props);
      };
    },
    createElement,
    useState: (initial: unknown) => {
      const idx = stateIndex++;
      if (!(idx in states)) states[idx] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [states[idx], (next: unknown) => {
        states[idx] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(states[idx]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      const idx = refIndex++;
      if (!(idx in refs)) refs[idx] = { current: initial };
      return refs[idx];
    },
    useEffect: (fn: () => unknown) => {
      const idx = effectIndex++;
      if (!mounted) effects[idx] = { fn };
    },
    useCallback: (fn: unknown) => fn,
    useId: () => 'id-1',
  };

  function compile(url: URL, stubs: Record<string, unknown>) {
    const mod = { exports: {} as Record<string, any> };
    const code = transformSync(readFileSync(url, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
    runInNewContext(code, {
      module: mod,
      exports: mod.exports,
      window: { location: { hash: '#home', assign() {} }, dispatchEvent() { return true; } },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
      setTimeout,
      clearTimeout,
      crypto,
      require: (id: string) => (Object.hasOwn(stubs, id) ? stubs[id] : shareBoxRequire(id)),
    });
    return mod.exports;
  }

  const sharePortMod = compile(sharePortPath, {});
  const shareBoxMod = compile(shareBoxPath, {
    react: reactStub,
    'react/jsx-runtime': { Fragment, jsx, jsxs: jsx },
    './share.css': {},
    './share-port': sharePortMod,
    './EventComposer': { EventComposer: () => null },
  });

  const render = (disabled = false) => {
    stateIndex = 0;
    refIndex = 0;
    effectIndex = 0;
    const tree = shareBoxMod.ShareBoxLauncher({
      client: new PortalClient(),
      userId: 'user-1',
      onChoose() {},
      disabled,
      storesEnabled: false,
    });
    if (!mounted) {
      mounted = true;
      for (const effect of effects) {
        const cleanup = effect.fn();
        if (typeof cleanup === 'function') effect.cleanup = cleanup as () => void;
      }
    }
    return tree;
  };

  return {
    render,
    refs,
    openShareComposer: sharePortMod.openShareComposer as () => Promise<{ status: string }>,
  };
}

test('ShareBoxLauncher renders top bar ＋分享 trigger as secondary button and preserves aria, disabled state, and focus return', async () => {
  const { render, refs, openShareComposer } = loadLauncher();
  const tree = render(false);
  const trigger = collectNodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === '分享或提交')!;
  assert.ok(trigger, 'expected top bar share trigger button');

  const classes = String(trigger.props.className ?? '').trim().split(/\s+/);
  assert.equal(classes.includes('btn'), true);
  assert.equal(classes.includes('btn-secondary'), true, 'top bar trigger must use btn-secondary');
  assert.equal(classes.includes('btn-primary'), false, 'top bar trigger must not use btn-primary');
  assert.equal(nodeText(trigger), '＋分享');
  assert.equal(trigger.props['aria-label'], '分享或提交');
  assert.equal(trigger.props['aria-haspopup'], 'dialog');
  assert.equal(trigger.props['aria-expanded'], false);
  assert.equal(Boolean(trigger.props.disabled), false);

  const disabledTree = render(true);
  const disabledTrigger = collectNodes(disabledTree).find(n => n.type === 'button' && n.props['aria-label'] === '分享或提交')!;
  assert.equal(Boolean(disabledTrigger.props.disabled), true);

  let focusCount = 0;
  const triggerRef = refs.find(r => r.current === null || (typeof r.current === 'object' && r.current !== null && 'focus' in (r.current as object)));
  // refs[2] is trigger in ShareBoxLauncher (finish=0, trigger=1, operation=2, ...); attach focus spy to the ref passed to trigger.
  const attachedRef = trigger.props.ref as { current: unknown };
  attachedRef.current = { focus() { focusCount += 1; } };

  const pending = openShareComposer();
  const openTree = render(false);
  const openTrigger = collectNodes(openTree).find(n => n.type === 'button' && n.props['aria-label'] === '分享或提交')!;
  assert.equal(openTrigger.props['aria-expanded'], true);

  const shareBoxNode = collectNodes(openTree).find(n => typeof n.type === 'function' && typeof n.props?.onDone === 'function')!;
  assert.ok(shareBoxNode, 'expected ShareBox to render when open');
  shareBoxNode.props.onDone({ status: 'cancelled' });
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(focusCount, 1, 'closing ShareBox must return focus to the top bar trigger');
  assert.ok(triggerRef !== undefined);
});
