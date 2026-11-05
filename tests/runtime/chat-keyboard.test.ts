import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Execute the complete production modules and the actual child/parent keyboard
// closures. Hooks, DOM nodes and event delivery are controlled: these tests do
// not establish browser layout, React scheduling or native IME/device behavior.
type Element = {type: unknown; props: any};
type Active = 'first' | 'input' | 'last' | 'heading';
type KeyOptions = {
  active?: Active;
  shiftKey?: boolean;
  composing?: boolean;
  nativeKeyCode?: number;
  defaultPrevented?: boolean;
};
const jsx = (type: unknown, props: any): Element => ({type, props});
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const floatingSource = source('apps/portal-web/src/modules/FloatingMessages.tsx');
const workspaceSource = source('apps/portal-web/src/modules/ChatWorkspace.tsx');
const placementSource = source('modules/member-communications/portal/floating-message-placement.ts');
function find(tree: any, predicate: (node: Element) => boolean): Element | undefined {
  if (!tree || typeof tree !== 'object') return;
  if (Array.isArray(tree)) {
    for (const child of tree) { const result = find(child, predicate); if (result) return result; }
    return;
  }
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}
const untouched = () => ({closed: 0, sent: 0, prevented: 0, stopped: 0, focused: [] as string[]});
function fixture(mobile: boolean, nestedDialog = false) {
  let actions = untouched();
  const control = (name: string) => ({
    name, tabIndex: 0, matches: () => false, closest: () => null,
    getClientRects: () => [{}], focus: () => actions.focused.push(name),
  });
  const nodes = {first: control('first'), input: control('input'), last: control('last'), heading: control('heading')};
  const document = {querySelector: () => nestedDialog ? {} : null, activeElement: nodes.input};
  const hooks = {
    useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial: any) => ({current: initial}),
    useEffect() {}, useLayoutEffect() {},
  };
  function compile(code: string, require: (name: string) => unknown) {
    const module = {exports: {} as any};
    runInNewContext(transformSync(code, {loader: 'tsx', format: 'cjs', jsx: 'automatic', logLevel: 'silent'}).code, {
      module, exports: module.exports, require, document,
      window: {matchMedia: () => ({matches: mobile})},
      localStorage: {getItem: () => null},
    });
    return module.exports;
  }
  const commonImport = (name: string) => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx};
    if (name.endsWith('.css')) return {};
    throw Error(`Unexpected production import: ${name}`);
  };
  const workspace = compile(workspaceSource, commonImport);
  const placement = compile(placementSource, commonImport);
  const {FloatingMessages} = compile(floatingSource, name => {
    if (name === '../language') return {useLanguage: () => ({t: (key: string) => key})};
    if (name === './member-inbox') return {useInboxUnread: () => ({total: 0})};
    if (name === './ChatWorkspace') return workspace;
    if (name === '../../../../modules/member-communications/portal/floating-message-placement') return placement;
    return commonImport(name);
  });
  const inputTree = workspace.ChatInput({
    id: 'synthetic-compose', label: '在合成公會發言', value: '未完成的中文草稿',
    onChange() {}, onSend: () => actions.sent++, sending: false, hidden: false, mobile,
  });
  const tree = FloatingMessages({client: {}, open: true, onToggle() {}, onClose: () => actions.closed++, children: inputTree});
  const textarea = find(tree, node => node.type === 'textarea');
  const panel = find(tree, node => node.type === 'section' && node.props.id === 'floating-message-panel');
  const heading = find(tree, node => node.type === 'h2' && node.props.id === 'floating-message-title');
  assert.ok(textarea && panel && heading, 'The real panel must contain the real ChatInput textarea and heading');
  assert.equal(typeof textarea.props.onKeyDown, 'function');
  assert.equal(typeof panel.props.onKeyDown, 'function');
  heading.props.ref.current = nodes.heading;
  return {
    key(key: 'Escape' | 'Tab' | 'Enter', options: KeyOptions = {}) {
      actions = untouched();
      const active = options.active ?? 'input';
      document.activeElement = nodes[active];
      const keyCode = options.nativeKeyCode ?? {Escape: 27, Tab: 9, Enter: 13}[key];
      const event = {
        key, keyCode, shiftKey: options.shiftKey ?? false,
        nativeEvent: {isComposing: options.composing ?? false, keyCode},
        defaultPrevented: options.defaultPrevented ?? false,
        target: nodes[active], currentTarget: {} as any,
        preventDefault() { this.defaultPrevented = true; actions.prevented++; },
        stopPropagation() { actions.stopped++; },
      };
      // Model bubbling from the actual textarea. Events starting at a panel
      // boundary control exercise only the parent, as they do in the browser.
      if (active === 'input') {
        event.currentTarget = nodes.input;
        textarea.props.onKeyDown(event);
      }
      if (!actions.stopped) {
        event.currentTarget = {querySelectorAll: () => [nodes.first, nodes.input, nodes.last]};
        panel.props.onKeyDown(event);
      }
      return actions;
    },
  };
}
const closed = () => ({...untouched(), closed: 1, prevented: 1, stopped: 1});
const focused = (name: string) => ({...untouched(), prevented: 1, focused: [name]});

for (const mobile of [false, true]) {
  const mode = mobile ? 'mobile' : 'desktop';
  test(`${mode}: ordinary Escape from ChatInput closes the panel once`, () => {
    assert.deepEqual(fixture(mobile).key('Escape'), closed());
  });
  test(`${mode}: composing Escape from ChatInput leaves the panel and draft focus alone`, () => {
    assert.deepEqual(fixture(mobile).key('Escape', {composing: true}), untouched());
  });
  test(`${mode}: native keyCode 229 Escape is not a panel-close request`, () => {
    assert.deepEqual(fixture(mobile).key('Escape', {nativeKeyCode: 229}), untouched());
  });
  test(`${mode}: ordinary Escape works after the composing event ends`, () => {
    const f = fixture(mobile);
    assert.deepEqual(f.key('Escape', {composing: true}), untouched());
    assert.deepEqual(f.key('Escape'), closed());
  });
}

test('mobile: ordinary Tab at the last control wraps to the first', () => {
  assert.deepEqual(fixture(true).key('Tab', {active: 'last'}), focused('first'));
});
test('mobile: ordinary Shift+Tab at the first control wraps to the last', () => {
  assert.deepEqual(fixture(true).key('Tab', {active: 'first', shiftKey: true}), focused('last'));
});
test('mobile: ordinary Shift+Tab from the initial heading wraps to the last', () => {
  assert.deepEqual(fixture(true).key('Tab', {active: 'heading', shiftKey: true}), focused('last'));
});
test('mobile: Tab inside ChatInput is not a focus-trap boundary', () => {
  assert.deepEqual(fixture(true).key('Tab'), untouched());
});
for (const shiftKey of [false, true]) {
  test(`desktop: ${shiftKey ? 'Shift+Tab' : 'Tab'} is not trapped`, () => {
    assert.deepEqual(fixture(false).key('Tab', {active: shiftKey ? 'first' : 'last', shiftKey}), untouched());
  });
}

// Defensive boundary events, not a claim that an OS IME originates composition
// on the real first/last button or heading in the current product layout.
for (const [label, options] of [
  ['isComposing', {composing: true}], ['native keyCode 229', {nativeKeyCode: 229}],
] as const) {
  test(`mobile: ${label} Tab does not activate the forward focus trap`, () => {
    assert.deepEqual(fixture(true).key('Tab', {...options, active: 'last'}), untouched());
  });
  test(`mobile: ${label} Shift+Tab does not activate the reverse focus trap`, () => {
    assert.deepEqual(fixture(true).key('Tab', {...options, active: 'first', shiftKey: true}), untouched());
  });
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'}: an open nested dialog owns Escape`, () => {
    assert.deepEqual(fixture(mobile, true).key('Escape'), untouched());
  });
  test(`${mobile ? 'mobile' : 'desktop'}: a default-prevented Escape remains consumed`, () => {
    assert.deepEqual(fixture(mobile).key('Escape', {defaultPrevented: true}), untouched());
  });
}
for (const shiftKey of [false, true]) {
  const options = {active: shiftKey ? 'first' as const : 'last' as const, shiftKey};
  test(`mobile: a nested dialog owns ${shiftKey ? 'Shift+Tab' : 'Tab'}`, () => {
    assert.deepEqual(fixture(true, true).key('Tab', options), untouched());
  });
  test(`mobile: default-prevented ${shiftKey ? 'Shift+Tab' : 'Tab'} remains consumed`, () => {
    assert.deepEqual(fixture(true).key('Tab', {...options, defaultPrevented: true}), untouched());
  });
}

test('desktop: ordinary Enter still sends exactly once through the real ChatInput', () => {
  assert.deepEqual(fixture(false).key('Enter'), {...untouched(), sent: 1, prevented: 1});
});
test('desktop: Shift+Enter remains a native newline', () => {
  assert.deepEqual(fixture(false).key('Enter', {shiftKey: true}), untouched());
});
test('desktop: composing Enter never sends', () => {
  assert.deepEqual(fixture(false).key('Enter', {composing: true}), untouched());
});
test('desktop: native keyCode 229 Enter never sends', () => {
  assert.deepEqual(fixture(false).key('Enter', {nativeKeyCode: 229}), untouched());
});
test('mobile: Enter remains a native newline', () => {
  assert.deepEqual(fixture(true).key('Enter'), untouched());
});
