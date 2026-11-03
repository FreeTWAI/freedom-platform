import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Actual component closures, controlled hook/effect delivery, no browser or DB.
// This proves request/state ownership, not React scheduling, layout or latency.
const source = (name: string) => readFileSync(new URL(`../../apps/portal-web/src/modules/${name}`, import.meta.url), 'utf8');
type Element = {type: unknown; props: any; key?: unknown};
const jsx = (type: unknown, props: any, key?: unknown): Element => ({type, props, key});
function find(root: any, predicate: (node: Element) => boolean): Element | undefined {
  if (!root || typeof root !== 'object') return;
  if (Array.isArray(root)) { for (const item of root) { const found = find(item, predicate); if (found) return found; } return; }
  if (predicate(root)) return root;
  return find(root.props?.children, predicate);
}
function text(root: any): string {
  if (typeof root === 'string') return root;
  if (Array.isArray(root)) return root.map(text).join(' ');
  return root && typeof root === 'object' ? text(root.props?.children) : '';
}
function fixture(file: string, edit: (code: string) => string = code => code) {
  const states: any[] = [], refs: any[] = [], memos: any[] = [], effects: any[] = [];
  let stateIndex = 0, refIndex = 0, memoIndex = 0, effectIndex = 0, pending: any[] = [], dirty = false;
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial: any) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], (next: any) => { const value = typeof next === 'function' ? next(states[i]) : next; if (!Object.is(value, states[i])) { states[i] = value; dirty = true; } }]; },
    useRef(initial: any) { return refs[refIndex++] ?? (refs[refIndex - 1] = {current: initial}); },
    useMemo(make: () => unknown, deps: unknown[]) { const i = memoIndex++; if (!same(memos[i]?.deps, deps)) memos[i] = {deps, value: make()}; return memos[i].value; },
    useCallback(fn: unknown, deps: unknown[]) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn: () => unknown, deps: unknown[]) { const i = effectIndex++; if (!same(effects[i]?.deps, deps)) pending.push({i, fn, deps}); },
    useId: () => 'synthetic-home',
  };
  const doc = {visibilityState: 'visible', addEventListener() {}, removeEventListener() {}};
  const win = {...doc, location: {pathname: '/', hash: '#home'}, matchMedia: () => ({matches: true, addEventListener() {}, removeEventListener() {}})};
  const compile = (code: string, require: (name: string) => unknown) => {
    const module = {exports: {} as any};
    runInNewContext(transformSync(code, {loader: 'tsx', format: 'cjs', jsx: 'automatic', logLevel: 'silent'}).code,
      {module, exports: module.exports, require, window: win, document: doc, navigator: {onLine: true}, AbortController, URL, performance,
        requestAnimationFrame: () => 1, cancelAnimationFrame() {}});
    return module.exports;
  };
  const reads = compile(source('member-home-loading.ts'), () => {throw Error('unexpected helper import');});
  const componentNames = ['WorkshopIcon', 'MemberAvatar', 'PromotionShare', 'MemberRecommendations', 'SkillBookIntro', 'SocialZone', 'HomeParticipation', 'FirstParticipation'];
  const components = Object.fromEntries(componentNames.map(name => [name, Object.assign(() => null, {displayName: name})]));
  const component = compile(edit(source(file)), name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx};
    if (name === './member-home-loading') return reads;
    if (name === '../language') return {useLanguage: () => ({t: (key: string) => key})};
    if (name === './Membership') return {loadLabels: () => new Promise(() => {})};
    if (name === '../game-console-core') return {logConsoleEvent() {}};
    if (name === '../game-console-routing') return {consoleChannel: (value: unknown) => value};
    if (name.endsWith('guild-preferences')) return {SECTION_LABELS: {}};
    if (name === './chat-entry') return {openMemberChat() {}};
    if (name === './HomeDesign.css') return {};
    if (componentNames.some(item => name.endsWith('/' + item))) return components;
    throw Error(`unexpected component import: ${name}`);
  })[file.replace('.tsx', '')];
  let props: any, tree: Element, disclosureKey: unknown;
  const disclosure = {open: false};
  const render = (patch: any = {}) => {
    props = {...props, ...patch}; stateIndex = refIndex = memoIndex = effectIndex = 0; pending = []; dirty = false;
    tree = component(props);
    const details = find(tree, node => node.props?.className === 'home-participation-disclosure');
    if (details) {
      if (details.key !== disclosureKey) { disclosure.open = false; disclosureKey = details.key; }
      if (details.props.ref) details.props.ref.current = disclosure;
    }
    return tree;
  };
  const flush = () => { for (let i = 0; i < 10; i++) {
    const run = pending; pending = [];
    for (const item of run) { effects[item.i]?.cleanup?.(); effects[item.i] = {deps: item.deps, cleanup: item.fn()}; }
    if (!dirty) return tree;
    render();
  } throw Error('hook render did not settle'); };
  return {render, flush, disclosure, toggle(open: boolean) {
    disclosure.open = open;
    find(tree, node => node.props?.className === 'home-participation-disclosure')!.props.onToggle({target: disclosure, currentTarget: disclosure});
    render(); flush();
  }, active() { return find(tree, node => (node.type as any)?.displayName === 'HomeParticipation')!.props.active; },
  dispose() { effects.forEach(effect => effect?.cleanup?.()); }};
}
function client() {
  const calls: {path: string; signal: AbortSignal; resolve(value: unknown): void; reject(reason: unknown): void}[] = [];
  return {sessionGeneration: 0, calls, get(path: string, options: {signal: AbortSignal}) {
    return new Promise((resolve, reject) => calls.push({path, signal: options.signal, resolve, reject}));
  }};
}
const props = (value: ReturnType<typeof client>) => ({client: value, session: {user: {user_id: 'same-user', display_name: 'Synthetic'}}, openHomeJournal: () => false});
const settled = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function closedReplacement(edit?: (source: string) => string) {
  const f = fixture('MemberHome.tsx', edit), first = client(), second = client();
  f.render(props(first)); f.flush(); assert.equal(f.active(), false);
  f.toggle(true); assert.equal(f.active(), true);
  f.toggle(false); assert.equal(f.active(), true, 'same mounted client retains activation after collapse');
  f.render(props(second)); f.flush(); assert.equal(f.active(), false, 'same user/generation on a new client cannot inherit closed activation');
  f.toggle(true); assert.equal(f.active(), true); f.dispose();
}
test('closed first-open latch is scoped to the actual client, user and generation', () => closedReplacement());
test('an already-open section activates a replacement client, but new generation closes it', () => {
  const f = fixture('MemberHome.tsx'), first = client(), second = client();
  f.render(props(first)); f.flush(); f.toggle(true);
  f.render(props(second)); assert.equal(f.active(), false); f.flush(); assert.equal(f.active(), true);
  second.sessionGeneration++; f.render(props(second)); f.flush(); assert.equal(f.disclosure.open, false); assert.equal(f.active(), false); f.dispose();
});
function inactiveRead(edit?: (source: string) => string) {
  const f = fixture('HomeParticipation.tsx', edit), value = client();
  f.render({...props(value), active: false}); f.flush(); assert.equal(value.calls.length, 0);
  f.render({active: true}); f.flush(); assert.equal(value.calls.length, 1);
  f.render({active: true}); f.flush(); assert.equal(value.calls.length, 1); f.dispose(); assert.equal(value.calls[0].signal.aborted, true);
}
test('inactive mounts read nothing, activation reads once, retained activation preserves pending work', () => inactiveRead());
test('failure remains an error, explicit retry reads once and stale completion cannot replace new client facts', async () => {
  const f = fixture('HomeParticipation.tsx'), first = client(), second = client();
  f.render({...props(first), active: true}); f.flush();
  first.calls[0].reject(Error('synthetic')); await settled(); f.render(); f.flush();
  assert.match(text(f.render()), /合作進度暫時無法載入/);
  const retry = find(f.render(), node => node.type === 'button' && text(node).includes('重試合作進度'))!;
  retry.props.onClick(); f.render(); f.flush(); assert.equal(first.calls.length, 2);
  f.render({...props(second), active: true}); f.flush(); assert.equal(first.calls[1].signal.aborted, true);
  second.calls[0].resolve({has_engagements: false, needs_response: false}); await settled(); f.render(); f.flush();
  first.calls[1].resolve({has_engagements: true, needs_response: true}); await settled();
  assert.match(text(f.render()), /還沒有合作紀錄/); assert.doesNotMatch(text(f.render()), /有合作等你/); f.dispose();
});
async function visibleReplacement(edit?: (source: string) => string) {
  const f = fixture('HomeParticipation.tsx', edit), first = client(), second = client();
  f.render({...props(first), active: true}); f.flush(); first.calls[0].resolve({has_engagements: true, needs_response: true});
  await settled(); f.render(); f.flush(); assert.match(text(f.render()), /有合作等你/);
  const beforeEffects = f.render({...props(second), active: false});
  assert.doesNotMatch(text(beforeEffects), /有合作等你/, 'replacement facts must be hidden before effects');
  f.flush(); assert.equal(second.calls.length, 0); f.dispose();
}
test('replacement client facts are fenced in render before effect cleanup', () => visibleReplacement());
test('negative controls reject eager reads and removed client identity fences', async () => {
  assert.throws(() => inactiveRead(code => code.replace('if (!active) return;', '')), /strictly equal/);
  assert.throws(() => closedReplacement(code => code.replace('[client, session.user.user_id, sessionGeneration]', '[session.user.user_id, sessionGeneration]')), /cannot inherit closed activation/);
  await assert.rejects(visibleReplacement(code => code.replace('progressValue?.client === client &&', 'progressValue &&')), /replacement facts must be hidden/);
});
