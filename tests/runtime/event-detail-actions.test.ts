import {replaceLegacyAddress,canonicalHash,portalHash,legacyHash,resolvePortalRoute} from '../../apps/portal-web/src/portal-route.js';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildSync,transformSync} from 'esbuild';
import ts from '@typescript/typescript6';
import React from 'react';

class HostNode {
  [key: string]: any;
  parentNode: HostNode | null = null;
  childNodes: HostNode[] = [];
  attributes: Record<string, string> = {};
  style: Record<string, any> = {setProperty() {}, removeProperty() {}};
  listeners: Record<string, {fn: Function; capture: boolean}[]> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: any) {
    if (nodeType === 1) this.tagName = nodeName;
    if (nodeName === 'DIALOG') this.open = false;
  }
  appendChild(node: HostNode) {
    node.parentNode?.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node;
  }
  removeChild(node: HostNode) {
    const index = this.childNodes.indexOf(node); assert.notEqual(index, -1);
    this.childNodes.splice(index, 1); node.parentNode = null; return node;
  }
  insertBefore(node: HostNode, before: HostNode) {
    node.parentNode?.removeChild(node); const index = this.childNodes.indexOf(before); assert.notEqual(index, -1);
    this.childNodes.splice(index, 0, node); node.parentNode = this; return node;
  }
  setAttribute(key: string, value: unknown) { this.attributes[key] = String(value); }
  removeAttribute(key: string) { delete this.attributes[key]; }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  setAttributeNS(_namespace: string, key: string, value: unknown) { this.setAttribute(key, value); }
  addEventListener(type: string, fn: Function, options?: any) { (this.listeners[type] ??= []).push({fn, capture: options === true || !!options?.capture}); }
  removeEventListener(type: string, fn: Function) { this.listeners[type] = (this.listeners[type] ?? []).filter(item => item.fn !== fn); }
  get options(): HostNode[] { return this.childNodes.flatMap(node => node.nodeName === 'OPTION' ? [node] : node.options); }
  setCustomValidity(value: string) { this.validationMessage = value; }
  get firstChild(): HostNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): HostNode | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): HostNode | null { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null; }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value: string) { this.childNodes.forEach(node => { node.parentNode = null; }); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value))); }
  get src() { return this.attributes.src ?? ''; }
  set src(value: string) { this.attributes.src = String(value); }
  contains(node: HostNode): boolean { return node === this || this.childNodes.some(child => child.contains(node)); }
}

class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null); this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
  }
  createElement(name: string) { return new HostNode(1, name.toUpperCase(), this); }
  createElementNS(namespace: string, name: string) { const node = this.createElement(name); node.namespaceURI = namespace; return node; }
  createTextNode(value: string) { const node = new HostNode(3, '#text', this); node.nodeValue = value; return node; }
}

const document = new HostDocument();
const scheduled = new Map<number, Function>(); let nextTimer = 0;
const window: any = {
  location: {origin: 'https://fixture.invalid'},
  setTimeout(fn: Function) { const id = ++nextTimer; scheduled.set(id, fn); return id; },
  clearTimeout(id: number) { scheduled.delete(id); },
  open() { throw Error('No external navigation permitted'); },
  document, HTMLElement: HostNode, HTMLIFrameElement: class {},
  listeners: {} as Record<string, Function[]>,
  addEventListener(type: string, fn: Function) { (this.listeners[type] ??= []).push(fn); },
  removeEventListener(type: string, fn: Function) { this.listeners[type] = (this.listeners[type] ?? []).filter((x: Function) => x !== fn); },
  dispatchEvent(e: any) { for (const fn of [...(this.listeners[e.type] ?? [])]) fn(e); return true; },
  get event() { return undefined; }
};
document.defaultView = window;
Object.assign(globalThis, {document, window, HTMLElement: HostNode, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true});
const require = createRequire(import.meta.url);
const {createRoot} = require('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = require('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));

HostNode.prototype.closest = function () { return null; };
HostNode.prototype.showModal = function () { this.open = true; };
HostNode.prototype.close = function () { this.open = false; };
HostNode.prototype.focus = function () { this.ownerDocument.activeElement = this; };
HostNode.prototype.select = function () {};
const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];
document.getElementById = (id: string) => descendants(document).find(node => node.attributes.id === id) ?? null;
HostNode.prototype.querySelector = function (selector: string) {
  return descendants(this).find(n => selector.startsWith('.') ? (n.attributes.class ?? '').split(' ').includes(selector.slice(1)) : n.nodeName === selector.toUpperCase()) ?? null;
};
HostNode.prototype.hasAttribute = function (key: string) { return Object.hasOwn(this.attributes, key); };
HostNode.prototype.dispatchEvent = function (event: any) {
  event.target ??= this; event.bubbles ??= true; event.cancelBubble = false; event.defaultPrevented = false;
  event.preventDefault = () => { event.defaultPrevented = true; }; event.stopPropagation = () => { event.cancelBubble = true; };
  const chain: HostNode[] = []; for (let n: HostNode | null = this; n; n = n.parentNode) chain.push(n);
  for (const n of [...chain].reverse()) { event.currentTarget = n; for (const l of n.listeners[event.type] ?? []) if (l.capture) l.fn(event); if (event.cancelBubble) return !event.defaultPrevented; }
  for (const n of chain) { event.currentTarget = n; for (const l of n.listeners[event.type] ?? []) if (!l.capture) l.fn(event); if (event.cancelBubble || !event.bubbles) break; }
  if (event.type === 'click' && !event.defaultPrevented && this.nodeName === 'SUMMARY' && this.parentNode?.nodeName === 'DETAILS') {
    const details = this.parentNode; if (details.hasAttribute('open')) details.removeAttribute('open'); else details.setAttribute('open', '');
  }
  event.currentTarget = null; return !event.defaultPrevented;
};

const noNetwork = () => { throw Error('Real network forbidden'); };
const navigator = {language: 'zh-TW', languages: ['zh-TW'], clipboard: {writeText: noNetwork}, share: noNetwork};
document.visibilityState = 'visible';
const base = process.cwd();
const bundled = buildSync({
  stdin: {
    contents: `export {EventsPanel} from './apps/portal-web/src/modules/EventsPanel'; export {EventMissions} from './apps/portal-web/src/modules/EventMissions'; export {EventAttendance} from './apps/portal-web/src/modules/EventAttendance'; export {ApiError} from './apps/portal-web/src/api';`,
    resolveDir: base, sourcefile: 'ux-d1-entry.ts'
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: {'.css': 'empty'}, supported: {'dynamic-import': false}
});
const production = {exports: {} as any};
runInNewContext(bundled.outputFiles[0].text, {
  module: production, exports: production.exports, crypto: webcrypto, Intl, URL, URLSearchParams, AbortController, Error, Event,
  CustomEvent: class { constructor(public type: string) {} }, Blob, console, window, document, navigator, fetch: noNetwork,
  localStorage: {getItem() { return null; }, setItem() {}}, sessionStorage: {getItem() { return null; }, setItem() {}},
  setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
  require(name: string) { if (name === 'react') return React; if (name === 'react/jsx-runtime' || name === 'react-dom' || name === 'qrcode') return require(name); if (name === 'zod') return require('zod'); throw Error('Unexpected external import: ' + name); }
});
const {EventsPanel, EventMissions, EventAttendance} = production.exports;

const appSource = readFileSync(path.join(base, 'apps/portal-web/src/App.tsx'), 'utf8');
const ast = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspace = ast.statements.find((n: any) => ts.isFunctionDeclaration(n) && n.name?.text === 'Workspace') as any;
assert.equal(Boolean(workspace?.body), true, 'Workspace declaration');
function actual(name: string) {
  const n = workspace.body.statements.find((n: any) => ts.isVariableStatement(n) ? n.declarationList.declarations.some((d: any) => d.name.getText(ast) === name) : ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.equal(Boolean(n), true, name); return n.getText(ast);
}
const navigationEffect = workspace.body.statements.find((n: any) => n.getText(ast).includes("window.addEventListener('hashchange', changed)"));
assert.equal(Boolean(navigationEffect), true, 'navigationEffect');
const shellSource = ['registerPageLeave', 'openMessages', 'closeMessagesThen', 'selectTab', 'navigateNotification'].map(actual).join('\n') + '\n' + navigationEffect.getText(ast) + '\nglobalThis.route={registerPageLeave,navigateNotification,selectTab};';
const communitySource = readFileSync(path.join(base, 'apps/portal-web/src/features/community.tsx'), 'utf8');
const communityAst = ts.createSourceFile('community.tsx', communitySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = communityAst.statements.flatMap((n: any) => ts.isVariableStatement(n) ? Array.from(n.declarationList.declarations) : []).find((n: any) => n.name.getText(communityAst) === 'communityFeatures') as any;
const eventEntry = declaration.initializer.expression.properties.find((p: any) => p.name.getText(communityAst).replaceAll('"', '') === 'events').initializer.getText(communityAst);
const entry = runInNewContext(transformSync('(' + eventEntry + ')', {loader: 'tsx', format: 'cjs', jsx: 'transform'}).code, {React, EventsPanel, EventMissions, EventMemberCards: () => null});

const OWNER = '30000000-0000-4000-8000-000000000001';
const MEMBER = '30000000-0000-4000-8000-000000000002';
const EVENT_ID = '10000000-0000-4000-8000-000000000001';
const sampleEvent = (my_rsvp: 'going' | null) => ({
  event_id: EVENT_ID, title: '測試活動', description: '活動說明',
  starts_at: new Date(Date.now() + 86400000).toISOString(), ends_at: new Date(Date.now() + 90000000).toISOString(),
  mode: 'online', location: '線上', event_kind: 'meetup', topic: null, online_url: null,
  visibility: 'open', registration_policy: 'community_member', banner_url: null, banner_orientation: null,
  video_url: null, video_mime: null, capacity: 100, state: 'published', aggregate_version: 1,
  attending_count: my_rsvp === 'going' ? 1 : 0, my_rsvp, guild_key: null, review_guild_key: null,
  can_review: false, review_reason: null, organizer_ref: OWNER, organizer_name: '主辦人'
});

function mount(t: TestContext, hash: string, userId = MEMBER) {
  const requests: any[] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as any);
  let mounted = true;
  Object.assign(window.location, {origin: 'https://fixture.invalid', pathname: '/', search: '', hash});
  Object.defineProperty(window.location, 'href', {configurable: true, get() { return window.location.origin + window.location.pathname + window.location.search + window.location.hash; }});
  (window as any).history = {state: null, replaceState(state: any, _u: any, url?: string) { this.state = state; if (url) { const target = new URL(url, window.location.href); Object.assign(window.location, {pathname: target.pathname, search: target.search, hash: target.hash}); } }, pushState: noNetwork, back: noNetwork};
  const transport = (method: string) => (url: string, body?: any, options?: any) => new Promise((resolve, reject) => requests.push({method, path: url, body, options, resolve, reject}));
  const client = {sessionGeneration: 1, get: transport('GET'), post: transport('POST')};
  const props: any = {client, session: {user: {user_id: userId}}, site: {event_participation_enabled: false}, locationHash: hash};
  let shell: any;
  function Host() {
    const [current, setHash] = React.useState(props.locationHash); props.locationHash = current;
    shell = {
      replaceLegacyAddress, canonicalHash, portalHash, legacyHash, resolvePortalRoute,
      useCallback: React.useCallback, useEffect: React.useEffect, acceptedHash: React.useRef(current),
      pageLeaveGuard: React.useRef(null), messageHistoryTransition: React.useRef(null), isMessagesHistoryEntry: () => false,
      messagesHistoryState: () => null, messageLocation: React.useRef({href: window.location.href, state: null}),
      messageLeaveGuard: React.useRef(null), notificationSequence: React.useRef(0), canEndConsoleSession: () => true,
      orderNotificationDestination: () => null, launchpadEnabled: false, tabFromHash: () => 'events', isMessagesHash: () => false,
      setMessagesMounted() {}, setTab() {}, setLocationHash: setHash, setFriendScope() {}, setMessagesOpen() {}, setMobileOpen() {},
      mainContent: {current: {focus() {}}}, setNotificationTarget() {}, window, HashChangeEvent: class { constructor(public type: string) {} }
    };
    runInNewContext(transformSync(shellSource, {loader: 'tsx', format: 'cjs'}).code, shell);
    return entry.render({...props, locationHash: props.locationHash ? legacyHash(props.locationHash) : '', registerPageLeave: shell.route.registerPageLeave, selectTab: shell.route.selectTab});
  }
  const render = () => flush(() => root.render(React.createElement(Host)));
  const unmount = () => { if (mounted) { flush(() => root.unmount()); document.body.removeChild(container); mounted = false; } };
  render(); t.after(unmount);
  const settle = async (r: any, value: any) => { assert.equal(Boolean(r), true, 'request exists'); await React.act(async () => { r.resolve(value); await new Promise(resolve => setImmediate(resolve)); }); };
  const classes = (node: HostNode) => (node.attributes.class ?? '').split(/\s+/).filter(Boolean);
  const buttons = () => descendants(container).filter(n => n.nodeName === 'BUTTON');
  const button = (label: string) => buttons().find(n => n.textContent === label);
  const nodes = () => descendants(container);
  const isVisible = (node: HostNode) => {
    for (let cur = node.parentNode; cur; cur = cur.parentNode) {
      if (cur.nodeName === 'DETAILS' && !cur.hasAttribute('open')) {
        if (node.nodeName === 'SUMMARY' && node.parentNode === cur) continue;
        return false;
      }
    }
    return true;
  };
  const visibleActions = () => nodes().filter(n => (n.nodeName === 'BUTTON' || n.nodeName === 'A' || n.nodeName === 'SUMMARY') && isVisible(n));
  const primaries = () => visibleActions().filter(n => classes(n).includes('btn-primary')).map(n => n.textContent);
  const click = (node: HostNode) => flush(() => node.dispatchEvent({type: 'click', button: 0}));
  return {container, nodes, requests, settle, classes, button, click, visibleActions, primaries, isVisible, start: async (item: any) => {
    await settle(requests.find(r => r.path.includes('/guilds/directory')), {items: []});
    await settle(requests.find(r => r.path.includes('/events/bulletins')), {items: []});
    await settle(requests.find(r => r.path === '/events'), {items: [item]});
    const detailReq = requests.find(r => r.path === `/events/${EVENT_ID}`);
    if (detailReq) await settle(detailReq, item);
    const missionReq = requests.find(r => r.path.includes('/my-missions'));
    if (missionReq) await settle(missionReq, {policy: 'personal_self_exercises_v1', version: 1, enabled: false, editable: true, slots: []});
    const attendanceReq = requests.find(r => r.path.includes('/attendance?'));
    if (attendanceReq) await settle(attendanceReq, {event_id: EVENT_ID, organizer_ref: OWNER, total: 1, next_offset: null, items: [{member_ref: MEMBER, nickname: '示範會員', avatar_url: null, registration_state: 'going', registered_at: new Date().toISOString(), state: 'unconfirmed', version: 1, can_confirm: true, can_retract: false, confirm_unavailable: null, recorded_at: null, recorded_by: null, updated_at: null, updated_by: null, retraction_reason: null}]});
  }};
}

test('UX-M-01: event detail keeps 我要參加 as sole primary and demotes 取消報名 (secondary+danger) and 自願開始 3 個小任務 (secondary)', async t => {
  const hNotGoing = mount(t, `#explore/events/${EVENT_ID}`);
  await hNotGoing.start(sampleEvent(null));
  assert.deepEqual(hNotGoing.primaries(), ['我要參加']);
  const joinBtn = hNotGoing.button('我要參加');
  const missionsBtn1 = hNotGoing.button('自願開始 3 個小任務');
  assert.equal(Boolean(joinBtn), true, '我要參加 button');
  assert.equal(Boolean(missionsBtn1), true, '自願開始 3 個小任務 button');
  assert.equal(hNotGoing.classes(missionsBtn1!).includes('btn-secondary'), true, 'missions button is secondary');
  assert.equal(hNotGoing.classes(missionsBtn1!).includes('btn-primary'), false, 'missions button is not primary');

  const hGoing = mount(t, `#explore/events/${EVENT_ID}`);
  await hGoing.start(sampleEvent('going'));
  assert.deepEqual(hGoing.primaries(), []);
  const cancelBtn = hGoing.button('取消報名');
  const missionsBtn2 = hGoing.button('自願開始 3 個小任務');
  assert.equal(Boolean(cancelBtn), true, '取消報名 button');
  assert.equal(hGoing.classes(cancelBtn!).includes('btn-secondary'), true, 'cancel button is secondary');
  assert.equal(hGoing.classes(cancelBtn!).includes('btn-danger'), true, 'cancel button has danger class');
  assert.equal(hGoing.classes(cancelBtn!).includes('btn-primary'), false, 'cancel button is not primary');
  assert.equal(hGoing.classes(missionsBtn2!).includes('btn-secondary'), true, 'missions button stays secondary');

  const css = readFileSync(path.join(base, 'apps/portal-web/src/modules/EventsPanel.css'), 'utf8');
  assert.match(css, /\.btn-danger\b/);
  assert.match(css, /--danger/);
});

test('UX-G-07: attendance collapses explanations behind 說明 without paragraph before action; manage folds secondary actions behind 更多', async t => {
  const hManage = mount(t, `#explore/events/${EVENT_ID}/manage`, OWNER);
  await hManage.start(sampleEvent(null));
  assert.deepEqual(hManage.primaries(), ['編輯活動']);
  const visibleNonPrimary = hManage.visibleActions().filter(n => !hManage.classes(n).includes('btn-primary')).map(n => n.textContent);
  assert.deepEqual(visibleNonPrimary, ['返回活動列表與行事曆', '活動專頁', '更多']);
  const summaries = hManage.nodes().filter(n => n.nodeName === 'SUMMARY').map(n => n.textContent);
  assert.deepEqual(summaries, ['更多']);
  const moreDetails = hManage.nodes().find(n => n.nodeName === 'DETAILS' && n.childNodes.some(c => c.nodeName === 'SUMMARY' && c.textContent === '更多'));
  assert.equal(Boolean(moreDetails), true, '更多 details exists');
  assert.equal(moreDetails!.hasAttribute('open'), false, '更多 collapsed initially');
  for (const label of ['報名名單', '通知參加者', '取消活動', '分享報名統計']) {
    const inside = descendants(moreDetails!).find(n => n.nodeName === 'BUTTON' && n.textContent === label);
    assert.equal(Boolean(inside), true, `${label} inside 更多`);
  }

  const hAtt = mount(t, `#explore/events/${EVENT_ID}/manage/attendance`, OWNER);
  await hAtt.start(sampleEvent(null));
  const attSection = hAtt.nodes().find(n => n.nodeName === 'SECTION' && (n.attributes.class ?? '').includes('event-attendance'));
  assert.equal(Boolean(attSection), true, 'attendance section');
  const attOrder = descendants(attSection!).filter(n => n.nodeName === 'P' || n.nodeName === 'BUTTON').map(n => n.nodeName);
  assert.equal(attOrder.indexOf('BUTTON') >= 0, true, 'has button');
  assert.equal(attOrder.slice(0, attOrder.indexOf('BUTTON')).includes('P'), false, 'no paragraph before first action');
  const helpSummaries = descendants(attSection!).filter(n => n.nodeName === 'SUMMARY').map(n => n.textContent);
  assert.deepEqual(helpSummaries, ['說明']);
  const helpDetails = descendants(attSection!).find(n => n.nodeName === 'DETAILS');
  assert.equal(Boolean(helpDetails), true, '說明 details exists');
  assert.equal(helpDetails!.hasAttribute('open'), false, '說明 collapsed initially');
  assert.match(helpDetails!.textContent, /不是實際抵達時間/);
  assert.match(helpDetails!.textContent, /公開報名訪客仍請看/);
  const visibleShortFact = descendants(attSection!).some(n => n.nodeName === 'P' && hAtt.isVisible(n) && n.textContent.includes('報名不等於到場'));
  assert.equal(visibleShortFact, true, 'Rule 4 fact stays visible');
  const attCss = readFileSync(path.join(base, 'apps/portal-web/src/modules/EventAttendance.css'), 'utf8');
  assert.match(attCss, /summary[\s\S]*min-height:\s*44px/);
});

test('UX-G-15: attendees dialog shows summary count, then attendee list, then privacy note below the list', async t => {
  const h = mount(t, `#explore/events/${EVENT_ID}/manage`, OWNER);
  await h.start(sampleEvent(null));
  const btn = h.button('報名名單');
  assert.equal(Boolean(btn), true, '報名名單 button exists');
  h.click(btn!);
  const req = h.requests.find(r => r.path.includes('/attendees'));
  await h.settle(req, {total: 1, next_offset: null, items: [{kind: 'member', user_id: MEMBER, nickname: '報名會員', avatar_url: null, registered_at: new Date().toISOString()}]});
  const dialog = h.nodes().find(n => n.nodeName === 'DIALOG' && (n.attributes.class ?? '') === 'event-attendees-dialog');
  assert.equal(Boolean(dialog), true, 'attendees dialog exists');
  const ordered = descendants(dialog!).filter(n => n.nodeName === 'P' || n.nodeName === 'OL');
  const countIdx = ordered.findIndex(n => n.nodeName === 'P' && n.textContent.includes('目前 1 人報名'));
  const listIdx = ordered.findIndex(n => n.nodeName === 'OL');
  const privacyIdx = ordered.findIndex(n => n.nodeName === 'P' && n.textContent.includes('只有主辦者看得到'));
  assert.equal(countIdx >= 0 && listIdx >= 0 && privacyIdx >= 0, true, 'count, list, and privacy note rendered');
  assert.equal(countIdx < listIdx, true, 'count precedes attendee list');
  assert.equal(listIdx < privacyIdx, true, 'privacy note appears below attendee list');
});

test('UX-F-09: moving 開始時間 past 結束時間 shifts 結束時間 by the same amount in both creating and editing', async t => {
  const propsOf = (node: HostNode) => node[Object.keys(node).find(k => k.startsWith('__reactProps$'))!];
  const fieldInput = (h: ReturnType<typeof mount>, labelText: string) => {
    const label = h.nodes().find(n => n.nodeName === 'LABEL' && (n.textContent === labelText || n.textContent.startsWith(labelText)));
    assert.equal(Boolean(label), true, `label ${labelText}`);
    const input = descendants(label!).find(n => n.nodeName === 'INPUT');
    assert.equal(Boolean(input), true, `input ${labelText}`);
    return input!;
  };
  const changeField = (h: ReturnType<typeof mount>, labelText: string, value: string) => {
    const input = fieldInput(h, labelText);
    flush(() => propsOf(input).onChange({target: {value}, currentTarget: {value}}));
  };
  const valueOf = (h: ReturnType<typeof mount>, labelText: string) => String(propsOf(fieldInput(h, labelText)).value);

  // Creating mode (progressive && !guildLocked)
  const hCreate = mount(t, '#explore/events', MEMBER);
  await hCreate.start({...sampleEvent(null), starts_at: new Date('2099-03-01T10:00').toISOString(), ends_at: new Date('2099-03-01T12:00').toISOString()});
  hCreate.click(hCreate.button('辦活動')!);
  changeField(hCreate, '開始時間', '2099-03-01T10:00');
  changeField(hCreate, '結束時間', '2099-03-01T12:00');
  changeField(hCreate, '開始時間', '2099-03-01T10:30');
  assert.equal(valueOf(hCreate, '結束時間'), '2099-03-01T12:00', 'creating: start before end keeps custom end time');
  changeField(hCreate, '開始時間', '2099-03-01T14:00');
  assert.equal(valueOf(hCreate, '結束時間'), '2099-03-01T15:30', 'creating: start past end shifts end by same delta');

  // Editing mode (guildLocked === true)
  const hEdit = mount(t, `#explore/events/${EVENT_ID}/manage`, OWNER);
  await hEdit.start({...sampleEvent(null), starts_at: new Date('2099-03-01T10:00').toISOString(), ends_at: new Date('2099-03-01T12:00').toISOString()});
  hEdit.click(hEdit.button('編輯活動')!);
  changeField(hEdit, '開始時間', '2099-03-01T11:00');
  assert.equal(valueOf(hEdit, '結束時間'), '2099-03-01T12:00', 'editing: start before end keeps existing end time');
  changeField(hEdit, '開始時間', '2099-03-01T14:00');
  assert.equal(valueOf(hEdit, '結束時間'), '2099-03-01T15:00', 'editing: start past end shifts end by same delta');
  changeField(hEdit, '開始時間', '2099-03-01T15:00');
  assert.equal(valueOf(hEdit, '結束時間'), '2099-03-01T16:00', 'editing: start equal to end shifts end by duration');
});
