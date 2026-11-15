import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

const source = (name: string) => readFileSync(new URL(`../../apps/portal-web/src/modules/${name}`, import.meta.url), 'utf8');
type Element = {type: unknown; props: any; key?: unknown};
const jsx = (type: unknown, props: any, key?: unknown): Element => ({type, props, key});

function findAll(root: any, predicate: (node: Element) => boolean): Element[] {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(item => findAll(item, predicate));
  const here = predicate(root) ? [root] : [];
  return [...here, ...findAll(root.props?.children, predicate)];
}

function renderMemberHome() {
  const states: any[] = [], refs: any[] = [], memos: any[] = [], effects: any[] = [];
  let stateIndex = 0, refIndex = 0, memoIndex = 0, effectIndex = 0;
  const hooks = {
    useState(initial: any) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], () => {}];
    },
    useRef(initial: any) { return refs[refIndex++] ?? (refs[refIndex - 1] = {current: initial}); },
    useMemo(make: () => unknown) { const i = memoIndex++; return (memos[i] ??= make()); },
    useCallback(fn: unknown) { return fn; },
    useEffect() { effectIndex++; },
    useId: () => 'home-test',
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
  const reads = compile(source('member-home-loading.ts'), () => {throw Error('unexpected');});
  const stubs: Record<string, any> = {
    WorkshopIcon: () => null,
    MemberAvatar: () => null,
    MemberRecommendations: () => null,
    SkillBookIntro: () => null,
    HomeParticipation: () => null,
    FirstParticipation: () => null,
    RecentEvents: () => null,
    ShareButton: ({label = '分享', buttonClassName = 'btn btn-ghost'}: {label?: string; buttonClassName?: string}) =>
      jsx('div', {className: 'skill-share promotion-share', children: jsx('button', {type: 'button', className: buttonClassName, children: label})}),
    SocialZone: () =>
      jsx('button', {type: 'button', className: 'social-write-trigger', 'aria-label': '建立貼文', children: '想分享什麼？'}),
    promotionLink: () => async () => ({path: '/go/synthetic'}),
  };
  const homeCopy: Record<string, string> = {
    'home.explore': '探索工坊',
    'home.workToResume': '繼續工作',
    'home.expand': '展開',
    'home.collapse': '收合',
    'home.readBook': '閱讀入門技能書',
  };
  const MemberHome = compile(source('MemberHome.tsx'), name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx};
    if (name === './member-home-loading') return reads;
    if (name === '../share/RecentEvents') return {RecentEvents: stubs.RecentEvents};
    if (name === '../share/ShareButton') return {ShareButton: stubs.ShareButton, promotionLink: stubs.promotionLink};
    if (name === '../language') return {useLanguage: () => ({t: (key: string) => homeCopy[key] ?? key})};
    if (name === './Membership') return {loadLabels: () => new Promise(() => {})};
    if (name === '../game-console-core') return {logConsoleEvent() {}};
    if (name === '../game-console-routing') return {consoleChannel: (value: unknown) => value};
    if (name.endsWith('guild-preferences')) return {SECTION_LABELS: {}};
    if (name === './chat-entry') return {openMemberChat() {}};
    if (name === './HomeDesign.css') return {};
    const hit = Object.keys(stubs).find(key => name.endsWith('/' + key));
    if (hit) return {[hit]: stubs[hit]};
    throw Error(`unexpected import: ${name}`);
  }).MemberHome;

  const client = {sessionGeneration: 0, get: () => new Promise(() => {})};
  const tree = MemberHome({client, session: {user: {user_id: 'u1', display_name: '測試員'}}, openHomeJournal: () => false});

  // Expand stub components one level so ShareButton and SocialZone render into the tree.
  function expand(node: any): any {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}));
    return {...node, props: {...node.props, children: expand(node.props?.children)}};
  }
  return expand(tree);
}

test('UX-M-10: #home exposes 分享自由工坊 as the single visible primary CTA while 建立貼文 stays secondary', () => {
  const tree = renderMemberHome();
  const shareButtons = findAll(tree, n => n.type === 'button' && n.props?.children === '分享自由工坊');
  assert.equal(shareButtons.length, 1);
  assert.match(String(shareButtons[0].props?.className ?? ''), /\bbtn-primary\b/);

  const personal = findAll(tree, n => n.type === 'details' && String(n.props?.className ?? '').includes('home-personal'))[0];
  assert.ok(personal);
  assert.equal(findAll(personal, n => n.type === 'button' && n.props?.children === '分享自由工坊').length, 0);

  const primaries = findAll(tree, n => n.type === 'button' && /\bbtn-primary\b/.test(String(n.props?.className ?? '')));
  assert.equal(primaries.length, 1);

  const compose = findAll(tree, n => n.type === 'button' && n.props?.['aria-label'] === '建立貼文');
  assert.equal(compose.length, 1);
  assert.doesNotMatch(String(compose[0].props?.className ?? ''), /\bbtn-primary\b/);
});

test('UX-V-14: empty MemberHome keeps both disclosures collapsed, 1 primary button, and zh-TW text', () => {
  const tree = renderMemberHome();
  const disclosures = findAll(tree, n => n.type === 'details');
  assert.equal(disclosures.length, 2);
  assert.equal(disclosures.every(d => !d.props?.open), true);

  function collectText(node: any): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (!node || typeof node !== 'object') return '';
    if (Array.isArray(node)) return node.map(collectText).join('');
    if (node.type === 'details') {
      const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children];
      return children.filter((child: any) => child?.type === 'summary').map(collectText).join('');
    }
    return collectText(node.props?.children);
  }
  const visibleText = collectText(tree);
  assert.equal(/[A-Za-z]{2,}/.test(visibleText), false);
});
