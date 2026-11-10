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

// Chat search uses the same source-bound handler fixture as the panel cases.
// Synthetic composition flags cover browser event variants, not an OS IME.
const searchCode=transformSync(source('apps/portal-web/src/modules/ChatSearch.tsx'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
function searchFixture(resource='/me/conversations/synthetic-peer/messages'){
  const slots:any[]=[],effects:(()=>void)[]=[],requests:{path:string;signal:AbortSignal;resolve:(value:any)=>void}[]=[];
  let index=0,tree:any,focused=0;
  const hooks={
    useId:()=>':synthetic-search:',
    useRef:(initial:unknown)=>{const i=index++;return slots[i]??(slots[i]={current:initial});},
    useState:(initial:any)=>{const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],(value:any)=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useEffect:(run:()=>unknown,deps:unknown[])=>{const i=index++;if(!slots[i]||deps.some((value,n)=>value!==slots[i].deps[n])){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=run();});}},
  };
  const module={exports:{} as any};
  runInNewContext(searchCode,{module,exports:module.exports,AbortController,URLSearchParams,require:(name:string)=>{
    if(name==='react')return hooks;
    if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(name==='../api')return {ApiError:class extends Error{status=0;}};
    if(name==='./ChatContent')return {ChatBody:'ChatBody',ChatQuote:'ChatQuote'};
    if(name==='./ChatWorkspace')return {ChatTime:'ChatTime'};
    if(name==='./MemberReporting')return {ReportButton:'ReportButton'};
    throw Error(`Unexpected search import: ${name}`);
  }});
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}},control={offsetParent:{},focus(){focused++;}};
  const props={client:{get:(path:string,options:{signal:AbortSignal})=>new Promise(resolve=>requests.push({path,signal:options.signal,resolve}))},resource,title:'合成對話',me:'synthetic-me',active:true,onOpenChange(){}};
  function render(){index=0;tree=module.exports.ChatSearch(props);find(tree,n=>n.type==='dialog')!.props.ref.current=dialog;find(tree,n=>n.type==='input')!.props.ref.current=control;find(tree,n=>n.props?.['aria-label']==='搜尋訊息')!.props.ref.current=control;while(effects.length)effects.shift()!();return tree;}
  const view=()=>{render();return render();};
  const input=()=>find(view(),n=>n.type==='input')!;
  const form=()=>find(view(),n=>n.type==='form')!;
  function submit(){form().props.onSubmit({preventDefault(){}});view();}
  function open(){find(view(),n=>n.props?.['aria-label']==='搜尋訊息')!.props.onClick();view();}
  function change(value:string){input().props.onChange({target:{value}});view();}
  function composition(active:boolean){input().props[active?'onCompositionStart':'onCompositionEnd']?.({});view();}
  function enter(native:{isComposing?:boolean;keyCode?:number}={}){
    const event={key:'Enter',nativeEvent:{isComposing:false,keyCode:13,...native},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
    input().props.onKeyDown?.(event);
    // Model implicit form submission only when keydown did not prevent it.
    if(!event.defaultPrevented)submit();
    return event.defaultPrevented;
  }
  function close(){find(view(),n=>n.props?.['aria-label']==='關閉搜尋')!.props.onClick();view();}
  open();
  return {requests,view,input,submit,open,change,composition,enter,close,dialog,get focused(){return focused;}};
}
for(const resource of ['/me/conversations/synthetic-peer/messages','/me/channels/guild/synthetic-guild/messages','/me/channels/squad/synthetic-squad/messages','/me/channels/world/world/messages']){
  test(`chat search ${resource}: composing Enter does not submit a partial query`,()=>{
    const f=searchFixture(resource);f.change('共');assert.equal(f.enter({isComposing:true}),true);assert.equal(f.requests.length,0);assert.equal(f.input().props.value,'共');
  });
  test(`chat search ${resource}: keyCode 229 confirmation is not ordinary Enter after compositionend`,()=>{
    const f=searchFixture(resource);f.change('共創');f.composition(true);f.composition(false);assert.equal(f.enter({keyCode:229}),true);assert.equal(f.requests.length,0);
    assert.equal(f.enter(),false);assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,`${resource}/search?q=${encodeURIComponent('共創')}&limit=20`);
  });
}
test('chat search tracks composition when native key flags are absent, including submit-button delivery',()=>{
  const f=searchFixture();f.change('選字');f.composition(true);assert.equal(f.enter(),true);f.submit();assert.equal(f.requests.length,0);
  f.composition(false);f.change(' 選字完成 ');f.submit();assert.equal(f.requests.length,1);assert.equal(new URL(f.requests[0].path,'https://fixture.invalid').searchParams.get('q'),'選字完成');
});
test('chat search close/reopen clears unfinished composition and aborts late search results',async()=>{
  const f=searchFixture();f.change('舊查詢');f.enter();assert.equal(f.requests.length,1);const old=f.requests[0];f.change('未完成');f.composition(true);f.close();assert.equal(old.signal.aborted,true);assert.equal(f.dialog.open,false);
  f.open();assert.equal(f.input().props.value,'');f.change('新查詢');assert.equal(f.enter(),false);assert.equal(f.requests.length,2);
  old.resolve({items:[{message_id:'old',body:'舊結果'}],next_cursor:null});await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(find(f.view(),n=>n.props?.className==='chat-search-results'),undefined);
  f.requests[1].resolve({items:[],next_cursor:null});await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(find(f.view(),n=>n.props?.className==='chat-search-results'));
});
