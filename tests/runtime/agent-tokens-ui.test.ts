import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
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
  setAttribute(key: string, value: unknown) {this.attributes[key] = String(value);}
  removeAttribute(key: string) {delete this.attributes[key];}
  getAttribute(key: string) {return this.attributes[key] ?? null;}
  setAttributeNS(_ns: string, key: string, value: unknown) {this.setAttribute(key, value);}
  addEventListener(type: string, fn: Function, options?: any) {(this.listeners[type] ??= []).push({fn, capture: options === true || !!options?.capture});}
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter(i => i.fn !== fn);}
  get firstChild(): HostNode | null {return this.childNodes[0] ?? null;}
  get lastChild(): HostNode | null {return this.childNodes.at(-1) ?? null;}
  get nextSibling(): HostNode | null {return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;}
  get textContent(): string {return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join('');}
  set textContent(value: string) {this.childNodes.forEach(n => {n.parentNode = null;}); this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));}
  get parentElement(): HostNode | null {return this.parentNode?.nodeType === 1 ? this.parentNode : null;}
  focus() {this.ownerDocument.activeElement = this;}
  select() {}
  contains(node: HostNode): boolean {return node === this || this.childNodes.some(c => c.contains(node));}
}

class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null); this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
  }
  createElement(name: string) {return new HostNode(1, name.toUpperCase(), this);}
  createElementNS(ns: string, name: string) {const n = this.createElement(name); n.namespaceURI = ns; return n;}
  createTextNode(value: string) {const n = this.createElement('#text'); n.nodeType = 3; n.nodeValue = value; return n;}
}

const document = new HostDocument();
const window: any = {
  location: {origin: 'https://fixture.invalid'},
  setTimeout, clearTimeout, document, HTMLElement: HostNode, HTMLIFrameElement: class {},
  listeners: {} as Record<string, Function[]>,
  addEventListener(type: string, fn: Function) {(this.listeners[type] ??= []).push(fn);},
  removeEventListener(type: string, fn: Function) {this.listeners[type] = (this.listeners[type] ?? []).filter((x: Function) => x !== fn);},
  dispatchEvent(e: any) {for (const fn of [...(this.listeners[e.type] ?? [])]) fn(e); return true;},
};
document.defaultView = window;
Object.assign(globalThis, {document, window, HTMLElement: HostNode, HTMLIFrameElement: window.HTMLIFrameElement, Node: HostNode, IS_REACT_ACT_ENVIRONMENT: true});

const require = createRequire(import.meta.url);
const {createRoot} = require('react-dom/client') as typeof import('react-dom/client');
const {flushSync} = require('react-dom') as typeof import('react-dom');
const flush = (fn: () => void) => React.act(() => flushSync(fn));
const descendants = (node: HostNode): HostNode[] => [node, ...node.childNodes.flatMap(descendants)];
const propsOf = (node: HostNode) => node[Object.keys(node).find(k => k.startsWith('__reactProps$'))!];

HostNode.prototype.hasAttribute = function (key: string) {return Object.hasOwn(this.attributes, key);};
HostNode.prototype.dispatchEvent = function (event: any) {
  event.target ??= this; event.bubbles ??= true; event.cancelBubble = false; event.defaultPrevented = false;
  event.preventDefault = () => {event.defaultPrevented = true;}; event.stopPropagation = () => {event.cancelBubble = true;};
  const chain: HostNode[] = []; for (let n: HostNode | null = this; n; n = n.parentNode) chain.push(n);
  for (const n of [...chain].reverse()) {event.currentTarget = n; for (const l of n.listeners[event.type] ?? []) if (l.capture) l.fn(event); if (event.cancelBubble) return !event.defaultPrevented;}
  for (const n of chain) {event.currentTarget = n; for (const l of n.listeners[event.type] ?? []) if (!l.capture) l.fn(event); if (event.cancelBubble || !event.bubbles) break;}
  event.currentTarget = null; return !event.defaultPrevented;
};

let copiedText = '';
const navigatorHost: any = {
  language: 'zh-TW', languages: ['zh-TW'],
  clipboard: {writeText: async (text: string) => {copiedText = text;}},
};
const noNetwork = () => {throw Error('Real network forbidden');};
const bundled = buildSync({
  stdin: {contents: `export {AgentTokens} from './apps/portal-web/src/modules/AgentTokens'; export {AgentHandoff} from './apps/portal-web/src/modules/AgentHandoff';`, resolveDir: process.cwd(), sourcefile: 'agent-tokens-ui-entry.ts'},
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', loader: {'.css': 'empty'},
});
const production = {exports: {} as any};
runInNewContext(bundled.outputFiles[0].text, {
  module: production, exports: production.exports, crypto: webcrypto, Intl, URL, URLSearchParams, AbortController,
  Error, Event, console, window, document, HTMLElement: HostNode, navigator: navigatorHost, fetch: noNetwork,
  requestAnimationFrame: (fn: () => void) => queueMicrotask(fn), setTimeout, clearTimeout,
  require(name: string) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime' || name === 'react-dom') return require(name);
    throw Error(name);
  },
});
const {AgentTokens, AgentHandoff} = production.exports;

const TOKEN = 'fw_agent_' + 'a'.repeat(43);
const tokenRow = (patch: Record<string, unknown> = {}) => ({
  connection_id: 'conn-1', client_name: '我的 Agent', scopes: ['read', 'share', 'rsvp'],
  expires_at: '2099-01-01T00:00:00.000Z', last_used_at: null, revoked_at: null, suspended_at: null,
  public_items_today: 0, public_daily_cap: 20, pending_publication: null, ...patch,
});

async function mountTokens(t: TestContext, initialItems: any[]) {
  copiedText = '';
  let items = [...initialItems];
  const posts: Array<{path: string; body: unknown}> = [];
  const client: any = {
    sessionGeneration: 1, csrfToken: 'synthetic',
    async get(path: string) {if (path === '/me/agent-tokens') return {items}; throw Error(path);},
    async post(path: string, body: unknown) {
      posts.push({path, body});
      if (path === '/me/agent-tokens') {
        const created = tokenRow({access_token: TOKEN});
        items = [tokenRow()];
        return created;
      }
      if (path.endsWith('/renew')) {
        const scopes = (body as any)?.scopes ?? ['read', 'share', 'rsvp'];
        const renewed = tokenRow({connection_id: 'conn-2', scopes, access_token: TOKEN});
        items = [tokenRow({connection_id: 'conn-2', scopes})];
        return renewed;
      }
      throw Error(path);
    },
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await React.act(async () => {root.render(React.createElement(AgentTokens, {client})); await new Promise(r => setImmediate(r));});
  t.after(() => {flush(() => root.unmount()); document.body.removeChild(container);});
  const nodes = () => descendants(container);
  const buttons = (text?: string) => nodes().filter(n => n.nodeName === 'BUTTON' && (!text || n.textContent === text));
  const primaryButtons = () => buttons().filter(n => (n.attributes.class ?? '').split(' ').includes('btn-primary'));
  const textareas = () => nodes().filter(n => n.nodeName === 'TEXTAREA');
  const click = async (text: string) => {
    const btn = buttons(text)[0];
    assert.ok(btn, `missing button ${text}`);
    await React.act(async () => {propsOf(btn).onClick({type: 'click', button: 0, currentTarget: btn}); await new Promise(r => setImmediate(r));});
  };
  const submit = async () => {
    const form = nodes().find(n => n.nodeName === 'FORM');
    assert.ok(form, 'missing form');
    await React.act(async () => {propsOf(form).onSubmit({preventDefault() {}}); await new Promise(r => setImmediate(r));});
  };
  return {buttons, primaryButtons, textareas, click, submit, nodes, posts};
}

test('UX-F-03: AgentTokens hides 複製連線設定 without a token and keeps one-time box until 已保存', async t => {
  const ui = await mountTokens(t, []);
  assert.equal(ui.buttons('複製連線設定').length, 0);
  assert.equal(ui.primaryButtons().length, 1);
  assert.equal(ui.primaryButtons()[0].textContent, '建立金鑰');

  await ui.submit();
  assert.equal(ui.textareas().length, 1);
  assert.equal(ui.primaryButtons().length, 1);
  assert.equal(ui.primaryButtons()[0].textContent, '複製這段指令');
  assert.equal(ui.buttons('複製連線設定').length, 1);

  await ui.click('複製這段指令');
  assert.ok(copiedText.includes('/agent.md'));
  assert.ok(copiedText.includes(`Bearer ${TOKEN}`));
  assert.equal(ui.textareas().length, 1);

  await ui.click('複製連線設定');
  const mcp = JSON.parse(copiedText).mcpServers['freedom-workshop'];
  assert.equal(mcp.url, 'https://fixture.invalid/api/v1/mcp');
  assert.equal(mcp.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(ui.textareas().length, 1);

  await ui.click('已保存');
  assert.equal(ui.textareas().length, 0);
  assert.equal(ui.buttons('複製連線設定').length, 1);
  await ui.click('複製連線設定');
  assert.equal(JSON.parse(copiedText).mcpServers['freedom-workshop'].headers.Authorization, 'Bearer ${FREEDOM_AGENT_TOKEN}');
});

test('UX-F-03: AgentTokens hides 複製連線設定 when member only has revoked tokens', async t => {
  const ui = await mountTokens(t, [tokenRow({revoked_at: '2026-01-01T00:00:00.000Z'})]);
  assert.equal(ui.buttons('複製連線設定').length, 0);
});

test('UX-V-14: AgentTokens empty view has single primary before empty note, 44px disclosure/scope targets, and AgentHandoff stays secondary with Agent label', async t => {
  const ui = await mountTokens(t, []);
  assert.equal(ui.primaryButtons().length, 1);
  assert.equal(ui.buttons().length, 2);
  const css = readFileSync('apps/portal-web/src/modules/AgentTokens.css', 'utf8');
  assert.match(css, /\.agent-tokens\s+summary\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.agent-scopes\s+label\{[^}]*min-height:\s*44px[^}]*min-width:\s*44px/);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await React.act(async () => {root.render(React.createElement(AgentHandoff, {screen: 'credit', task: '讀取我的貢獻紀錄與成果'}));});
  t.after(() => {flush(() => root.unmount()); document.body.removeChild(container);});
  const btns = descendants(container).filter(n => n.nodeName === 'BUTTON');
  assert.equal(btns.length, 1);
  assert.equal(btns[0].textContent, '交給我的 Agent');
  assert.equal((btns[0].attributes.class ?? '').split(' ').includes('btn-primary'), false);
});

test('AgentTokens offers 回應 checked by default and keeps existing token scopes on renew', async t => {
  const existing = tokenRow({scopes: ['read', 'share', 'rsvp']});
  const ui = await mountTokens(t, [existing]);
  const scopeLabels = ui.nodes().filter(n => n.nodeName === 'LABEL' && n.parentNode?.attributes.class === 'agent-scopes');
  assert.deepEqual(scopeLabels.map(l => l.textContent), ['讀取', '分享', '報名', '回應']);
  for (const label of scopeLabels) {
    const input = label.childNodes.find(c => c.nodeName === 'INPUT');
    assert.ok(input);
    assert.equal(input.checked ?? input.attributes.checked !== undefined, true);
  }
  await ui.submit();
  assert.deepEqual([...(ui.posts[0].body as any).scopes], ['read', 'share', 'rsvp', 'react']);
  await ui.click('已保存');
  await ui.click('續期換新');
  assert.deepEqual([...(ui.posts[1].body as any).scopes], ['read', 'share', 'rsvp']);
});

test('AgentTokens groups operations by screen including 公會與工具', async t => {
  const ui = await mountTokens(t, []);
  const headings = ui.nodes().filter(n => n.nodeName === 'H3').map(n => n.textContent);
  assert.ok(headings.includes('公會與工具'), `missing 公會與工具 heading in ${JSON.stringify(headings)}`);
  const guildGroup = ui.nodes().find(n => n.nodeName === 'H3' && n.textContent === '公會與工具')?.parentNode;
  assert.ok(guildGroup);
  const items = descendants(guildGroup).filter(n => n.nodeName === 'LI').map(n => n.textContent);
  assert.ok(items.some(text => text.includes('查看公會')));
  assert.ok(items.some(text => text.includes('查看公會工具')));
});

test('AgentTokens groups posts under 貼文 and includes notification read operations', async t => {
  const ui = await mountTokens(t, []);
  const headings = ui.nodes().filter(n => n.nodeName === 'H3').map(n => n.textContent);
  assert.ok(headings.includes('貼文'), `missing 貼文 heading in ${JSON.stringify(headings)}`);
  const postsGroup = ui.nodes().find(n => n.nodeName === 'H3' && n.textContent === '貼文')?.parentNode;
  assert.ok(postsGroup);
  const postItems = descendants(postsGroup).filter(n => n.nodeName === 'LI').map(n => n.textContent);
  assert.ok(postItems.some(text => text.includes('查看貼文')));
  assert.ok(postItems.some(text => text.includes('查看貼文留言')));
  const noticeGroup = ui.nodes().find(n => n.nodeName === 'H3' && n.textContent === '通知')?.parentNode;
  assert.ok(noticeGroup);
  const noticeItems = descendants(noticeGroup).filter(n => n.nodeName === 'LI').map(n => n.textContent);
  assert.ok(noticeItems.some(text => text.includes('標成已讀')));
  assert.ok(noticeItems.some(text => text.includes('通知全部標成已讀')));
});

test('AgentTokens groups member services under 服務 and excludes cover/hide', async t => {
  const ui = await mountTokens(t, []);
  const headings = ui.nodes().filter(n => n.nodeName === 'H3').map(n => n.textContent);
  assert.ok(headings.includes('服務'), `missing 服務 heading in ${JSON.stringify(headings)}`);
  const servicesGroup = ui.nodes().find(n => n.nodeName === 'H3' && n.textContent === '服務')?.parentNode;
  assert.ok(servicesGroup);
  const items = descendants(servicesGroup).filter(n => n.nodeName === 'LI').map(n => n.textContent ?? '');
  for (const title of ['查看我的服務', '上架服務', '編輯自己的服務', '暫停服務', '恢復服務', '刪除自己的服務']) {
    assert.ok(items.some(text => text.includes(title)), `missing ${title}`);
  }
  assert.equal(items.some(text => text.includes('封面') || text.includes('隱藏')), false);
});

test('AgentTokens groups works under 作品 and profile under 個人資料 and omits empty groups', async t => {
  const ui = await mountTokens(t, []);
  const headings = ui.nodes().filter(n => n.nodeName === 'H3').map(n => n.textContent ?? '');
  for (const title of ['活動', '貢獻', '分享', '通知', '公會與工具', '貼文', '服務', '作品', '個人資料']) {
    assert.ok(headings.includes(title), `missing screen heading ${title} in ${JSON.stringify(headings)}`);
  }
  const lists = ui.nodes().filter(n => n.nodeName === 'H3').map(h => ({
    title: h.textContent,
    items: descendants(h.parentNode!).filter(n => n.nodeName === 'LI').map(n => n.textContent ?? ''),
  }));
  assert.equal(lists.every(group => group.items.length > 0), true, 'empty groups must not be rendered');

  const worksGroup = lists.find(g => g.title === '作品');
  assert.ok(worksGroup);
  assert.equal(worksGroup.items.some(text => text.includes('發布作品')), true);
  assert.equal(worksGroup.items.some(text => text.includes('公開閱讀') || text.includes('開關')), false);

  const profileGroup = lists.find(g => g.title === '個人資料');
  assert.ok(profileGroup);
  assert.equal(profileGroup.items.some(text => text.includes('查看我的定位卡')), true);
  assert.equal(profileGroup.items.some(text => text.includes('帳號') || text.includes('儲存')), false);
});
