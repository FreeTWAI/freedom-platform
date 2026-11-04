import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Execute complete production modules and their actual keyboard closures. Hooks,
// DOM nodes and event bubbling are controlled. This is not native IME, browser
// implicit-submit, layout or React scheduling coverage.
type Element = {type: unknown; props: any};
type KeyOptions = {composing?: boolean; nativeKeyCode?: number; defaultPrevented?: boolean};
const jsx = (type: unknown, props: any): Element => ({type, props});
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const contentSource = source('apps/portal-web/src/modules/ChatContent.tsx');
const floatingSource = source('apps/portal-web/src/modules/FloatingMessages.tsx');
const workspaceSource = source('apps/portal-web/src/modules/ChatWorkspace.tsx');
const placementSource = source('modules/member-communications/portal/floating-message-placement.ts');
const stickerSource = source('modules/member-communications/stickers.ts');
const freetwaiStickerSource = source('modules/member-communications/freetwai-stickers.ts');
function find(tree: any, predicate: (node: Element) => boolean): Element | undefined {
  if (!tree || typeof tree !== 'object') return;
  if (Array.isArray(tree)) {
    for (const child of tree) { const result = find(child, predicate); if (result) return result; }
    return;
  }
  if (predicate(tree)) return tree;
  return find(tree.props?.children, predicate);
}
function statefulHooks() {
  const slots: any[] = [];
  let cursor = 0, dirty = false;
  let effects: Array<() => void> = [];
  return {
    begin() { cursor = 0; dirty = false; effects = []; },
    commit() { for (const effect of effects) effect(); return dirty; },
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (next: any) => {
        const value = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
      }];
    },
    useRef(initial: any) {
      const index = cursor++;
      return slots[index] ??= {current: initial};
    },
    useId() { return `sticker-keyboard-${cursor++}`; },
    useCallback(callback: unknown) { return callback; },
    useEffect(effect: () => void, dependencies: unknown[]) {
      const index = cursor++, previous = slots[index] as unknown[] | undefined;
      if (!previous || dependencies.some((value, offset) => !Object.is(value, previous[offset]))) effects.push(effect);
      slots[index] = dependencies;
    },
  };
}
const untouched = () => ({closed: 0, sent: 0, changed: 0, prevented: 0, stopped: 0, outerEvents: 0, focused: [] as string[]});
function fixture(mobile: boolean) {
  let actions = untouched();
  const nodes = {
    search: {name: 'search', focus() { document.activeElement = this; actions.focused.push(this.name); }},
    toggle: {name: 'toggle', focus() { document.activeElement = this; actions.focused.push(this.name); }},
    picker: {}, outer: {},
  };
  const document = {querySelector: () => null, activeElement: nodes.toggle};
  const contentHooks = statefulHooks();
  // The outer panel's unrelated mount/layout effects are outside this fixture.
  const outerHooks = {
    useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial: any) => ({current: initial}),
    useEffect() {}, useLayoutEffect() {},
  };
  function compile(code: string, require: (name: string) => unknown) {
    const module = {exports: {} as any};
    runInNewContext(transformSync(code, {loader: 'tsx', format: 'cjs', jsx: 'automatic', logLevel: 'silent'}).code, {
      module, exports: module.exports, require, document,
      window: {matchMedia: () => ({matches: mobile})}, localStorage: {getItem: () => null},
    });
    return module.exports;
  }
  function commonImport(name: string, hooks: unknown) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx};
    if (name.endsWith('.css')) return {};
    throw Error(`Unexpected production import: ${name}`);
  }
  const freetwaiStickers = compile(freetwaiStickerSource, name => commonImport(name, contentHooks));
  const stickers = compile(stickerSource, name => name === './freetwai-stickers.js' ? freetwaiStickers : commonImport(name, contentHooks));
  const {ChatExtras} = compile(contentSource, name => name === '../../../../modules/member-communications/stickers' ? stickers : commonImport(name, contentHooks));
  const workspace = compile(workspaceSource, name => commonImport(name, outerHooks));
  const placement = compile(placementSource, name => commonImport(name, outerHooks));
  const {FloatingMessages} = compile(floatingSource, name => {
    if (name === '../language') return {useLanguage: () => ({t: (key: string) => key})};
    if (name === './member-inbox') return {useInboxUnread: () => ({total: 0})};
    if (name === './ChatWorkspace') return workspace;
    if (name === '../../../../modules/member-communications/portal/floating-message-placement') return placement;
    return commonImport(name, outerHooks);
  });
  const reply = Object.freeze({message_id: 'synthetic-message', sender_ref: 'synthetic-member', sender_name: '合成夥伴', body: '待回覆的中文訊息'});
  const draft = Object.freeze({reply});
  let tree: Element;
  function render() {
    for (let pass = 0; pass < 10; pass++) {
      contentHooks.begin();
      const extras = ChatExtras({draft, onChange: () => actions.changed++, onSendSticker: () => actions.sent++, disabled: false, target: 'synthetic-guild'});
      tree = FloatingMessages({client: {}, open: true, onToggle() {}, onClose: () => actions.closed++, children: extras});
      const toggle = find(tree, node => node.props?.['aria-label'] === '選擇貼圖');
      assert.ok(toggle);
      toggle.props.ref.current = nodes.toggle;
      const input = find(tree, node => node.type === 'input' && node.props.type === 'search');
      if (input) input.props.ref.current = nodes.search;
      if (!contentHooks.commit()) return;
    }
    throw Error('The controlled ChatExtras render did not settle');
  }
  function input() {
    const result = find(tree, node => node.type === 'input' && node.props.type === 'search');
    assert.ok(result, 'The real ChatExtras search input must be open');
    return result;
  }
  function snapshot() {
    const toggle = find(tree, node => node.props?.['aria-label'] === '選擇貼圖');
    const quote = find(tree, node => node.props?.reply === reply);
    assert.ok(toggle && quote, 'The toggle and unchanged reply draft must remain rendered');
    return {
      ...actions, open: toggle.props['aria-expanded'],
      search: find(tree, node => node.type === 'input' && node.props.type === 'search')?.props.value ?? null,
      active: document.activeElement.name, reply: quote.props.reply,
    };
  }
  function toggle() {
    actions = untouched();
    const button = find(tree, node => node.props?.['aria-label'] === '選擇貼圖');
    assert.ok(button);
    button.props.onClick(); render(); return snapshot();
  }
  render(); toggle();
  input().props.onChange({target: {value: '加油 中文'}}); render();
  actions = untouched();
  return {
    reply, toggle, snapshot,
    key(key: 'Escape' | 'Enter' | 'ArrowDown', options: KeyOptions = {}) {
      actions = untouched();
      const search = input();
      const picker = find(tree, node => node.type === 'section' && node.props.className === 'chat-sticker-picker');
      const outer = find(tree, node => node.props?.id === 'floating-message-panel');
      assert.ok(picker && outer);
      const keyCode = {Escape: 27, Enter: 13, ArrowDown: 40}[key];
      const event = {
        key, keyCode, nativeEvent: {isComposing: options.composing ?? false, keyCode: options.nativeKeyCode ?? keyCode},
        defaultPrevented: options.defaultPrevented ?? false,
        target: nodes.search, currentTarget: nodes.search as unknown,
        preventDefault() { this.defaultPrevented = true; actions.prevented++; },
        stopPropagation() { actions.stopped++; },
      };
      search.props.onKeyDown(event);
      if (!actions.stopped) { event.currentTarget = nodes.picker; picker.props.onKeyDown(event); }
      if (!actions.stopped) { event.currentTarget = nodes.outer; actions.outerEvents++; outer.props.onKeyDown(event); }
      render();
      return {...snapshot(), defaultPrevented: event.defaultPrevented};
    },
    closeButton() {
      actions = untouched();
      const button = find(tree, node => node.type === 'button' && node.props.children === '關閉貼圖');
      assert.ok(button);
      button.props.onClick(); render(); return snapshot();
    },
  };
}
function openState(reply: unknown) {
  return {...untouched(), open: true, search: '加油 中文', active: 'search', reply};
}
function closedState(reply: unknown) {
  return {...untouched(), open: false, search: null, active: 'toggle', reply, focused: ['toggle']};
}
const compositionCases = [
  ['isComposing', {composing: true}],
  // Keep synthetic keyCode at 27: Safari's native 229 fallback is independent.
  ['native keyCode 229', {nativeKeyCode: 229}],
] as const;
for (const mobile of [false, true]) {
  const mode = mobile ? 'mobile' : 'desktop';
  for (const [label, options] of compositionCases) {
    test(`${mode}: ${label} Escape preserves the picker, search, reply and focus without reaching the outer panel`, () => {
      const f = fixture(mobile);
      assert.deepEqual(f.key('Escape', options), {...openState(f.reply), stopped: 1, defaultPrevented: false});
      assert.deepEqual(f.key('Escape', options), {...openState(f.reply), stopped: 1, defaultPrevented: false});
    });
    test(`${mode}: ordinary Escape after ${label} only closes the picker, which can be reopened`, () => {
      const f = fixture(mobile);
      assert.deepEqual(f.key('Escape', options), {...openState(f.reply), stopped: 1, defaultPrevented: false});
      assert.deepEqual(f.key('Escape'), {...closedState(f.reply), prevented: 1, stopped: 1, defaultPrevented: true});
      assert.deepEqual(f.toggle(), {...openState(f.reply), focused: ['search']});
      assert.deepEqual(f.key('Escape', options), {...openState(f.reply), stopped: 1, defaultPrevented: false});
    });
    test(`${mode}: ${label} Escape keeps a pre-existing default-prevented flag without another preventDefault`, () => {
      const f = fixture(mobile);
      assert.deepEqual(f.key('Escape', {...options, defaultPrevented: true}), {...openState(f.reply), stopped: 1, defaultPrevented: true});
    });
  }
  test(`${mode}: ordinary Escape only closes the sticker picker`, () => {
    const f = fixture(mobile);
    assert.deepEqual(f.key('Escape'), {...closedState(f.reply), prevented: 1, stopped: 1, defaultPrevented: true});
  });
  test(`${mode}: the close button still closes and restores the toggle, and reopening retains the query`, () => {
    const f = fixture(mobile);
    assert.deepEqual(f.closeButton(), closedState(f.reply));
    assert.deepEqual(f.toggle(), {...openState(f.reply), focused: ['search']});
  });
  for (const [label, options] of [['ordinary', {}], ...compositionCases] as const) {
    test(`${mode}: ${label} search Enter stays default-prevented without sending a sticker`, () => {
      const f = fixture(mobile);
      assert.deepEqual(f.key('Enter', options), {...openState(f.reply), prevented: 1, outerEvents: 1, defaultPrevented: true});
    });
  }
  test(`${mode}: an unrelated composing key retains normal bubbling`, () => {
    const f = fixture(mobile);
    assert.deepEqual(f.key('ArrowDown', {composing: true}), {...openState(f.reply), outerEvents: 1, defaultPrevented: false});
  });
}
