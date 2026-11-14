import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';
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
  appendChild(node: HostNode) { node.parentNode?.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node; }
  removeChild(node: HostNode) { const i = this.childNodes.indexOf(node); assert.notEqual(i, -1); this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  insertBefore(node: HostNode, before: HostNode) { node.parentNode?.removeChild(node); const i = this.childNodes.indexOf(before); assert.notEqual(i, -1); this.childNodes.splice(i, 0, node); node.parentNode = this; return node; }
  setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); }
  removeAttribute(k: string) { delete this.attributes[k]; }
  getAttribute(k: string) { return this.attributes[k] ?? null; }
  setAttributeNS(_ns: string, k: string, v: unknown) { this.setAttribute(k, v); }
  addEventListener(type: string, fn: Function, options?: any) { (this.listeners[type] ??= []).push({fn, capture: options === true || !!options?.capture}); }
  removeEventListener(type: string, fn: Function) { this.listeners[type] = (this.listeners[type] ?? []).filter(item => item.fn !== fn); }
  get className() { return this.attributes.class ?? ''; }
  set className(v: string) { this.attributes.class = String(v); }
  get options(): HostNode[] { return this.childNodes.flatMap(n => n.nodeName === 'OPTION' ? [n] : n.options); }
  get firstChild(): HostNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): HostNode | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): HostNode | null { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null; }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v: string) { this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; if (v) this.appendChild(this.ownerDocument.createTextNode(String(v))); }
  get parentElement(): HostNode | null { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  contains(node: HostNode): boolean { return node === this || this.childNodes.some(c => c.contains(node)); }
  querySelector(): HostNode | null { return null; }
  showModal() { this.open = true; this.setAttribute('open', ''); }
  close() { this.open = false; this.removeAttribute('open'); }
  focus() {}
  scrollIntoView() {}
}

class HostDocument extends HostNode {
  constructor() {
    super(9, '#document', null); this.ownerDocument = this;
    this.documentElement = new HostNode(1, 'HTML', this); this.body = new HostNode(1, 'BODY', this);
    this.appendChild(this.documentElement); this.documentElement.appendChild(this.body); this.activeElement = this.body;
  }
  createElement(name: string) { return new HostNode(1, name.toUpperCase(), this); }
  createElementNS(_ns: string, name: string) { return this.createElement(name); }
  createTextNode(value: string) { const n = new HostNode(3, '#text', this); n.nodeValue = value; return n; }
}

const descendants = (root: HostNode): HostNode[] => root.childNodes.flatMap(n => [n, ...descendants(n)]);

function makeConfig() {
  return {
    schema_version: 'guild-launchpad.config/v1' as const,
    guild_key: 'guild_games',
    mission_override: null,
    blocks: [
      {id: 'b1', kind: 'mission' as const, title: null, order: 0, enabled: true},
      {id: 'b2', kind: 'announcements' as const, title: null, order: 1, enabled: true},
      {id: 'b3', kind: 'skill_books' as const, title: null, order: 2, enabled: true},
      {id: 'b4', kind: 'applications' as const, title: null, order: 3, enabled: false},
      {id: 'b5', kind: 'community_tasks' as const, title: null, order: 4, enabled: true},
      {id: 'b6', kind: 'my_work' as const, title: null, order: 5, enabled: true},
      {id: 'b7', kind: 'support' as const, title: null, order: 6, enabled: true},
    ],
    application_refs: [],
    starter: {title_label: '標題', objective_hint: '目標', note_hint: '筆記'},
    support: {kind: 'platform_help' as const, public_url: null},
    extensions: {},
  };
}

function setupDom(t: TestContext) {
  const document = new HostDocument();
  const listeners: Record<string, Function[]> = {};
  const windowObj: any = {
    document, HTMLElement: HostNode, Element: HostNode, HTMLIFrameElement: class {},
    location: {origin: 'https://fixture.invalid', hash: '#guilds/guild_games'},
    crypto: webcrypto,
    addEventListener(type: string, fn: Function) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type: string, fn: Function) { listeners[type] = (listeners[type] ?? []).filter(x => x !== fn); },
    confirm: () => true,
    get event() { return undefined; },
  };
  const prev = {
    window: (globalThis as any).window, document: (globalThis as any).document, location: (globalThis as any).location,
    Element: (globalThis as any).Element, HTMLElement: (globalThis as any).HTMLElement, IS_REACT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {window: windowObj, document, location: windowObj.location, Element: HostNode, HTMLElement: HostNode, IS_REACT_ACT_ENVIRONMENT: true});
  t.after(() => Object.assign(globalThis, prev));
  const req = createRequire(import.meta.url);
  const {act} = req('react') as typeof React;
  const {createRoot} = req('react-dom/client');
  return {document, windowObj, listeners, act, createRoot};
}

function compileModule(relPath: string, windowObj: any, document: HostDocument, extraStubs: Record<string, () => unknown> = {}) {
  const fileUrl = new URL(relPath, import.meta.url);
  const fileReq = createRequire(fileUrl);
  const {code} = transformSync(readFileSync(fileUrl, 'utf8'), {loader: 'tsx', format: 'cjs', jsx: 'automatic', supported: {'dynamic-import': false}});
  const mod = {exports: {} as any};
  const ctx = runInNewContext('(function(require,module,exports){' + code + '\n})', {
    ...globalThis, AbortController, URL,
    window: windowObj, document, location: windowObj.location, crypto: webcrypto,
    addEventListener: windowObj.addEventListener, removeEventListener: windowObj.removeEventListener,
    requestAnimationFrame: (cb: FrameRequestCallback) => { cb(0); return 0; },
  });
  ctx((id: string) => {
    if (Object.hasOwn(extraStubs, id)) return extraStubs[id]();
    if (id === './GuildLaunchpad.css') return {};
    if (id === './GuildLaunchpadMyWork') return {MyWorkPanel: () => React.createElement('div', {'data-testid': 'my-work-panel'}), rememberActing() {}};
    if (id === './GuildLaunchpadApplications') return {GuildLaunchpadApplications: () => React.createElement('div'), startable: () => true};
    if (id === '../guild-blocks/runtime') return {GuildBlock: () => React.createElement('div')};
    if (id === '../guild-repositories/GuildRepositoryFrame') return {GuildRepositoryFrame: () => React.createElement('div')};
    if (id === '../guild-tools/catalog') return {GUILD_TOOLS: []};
    if (id === './guild-launchpad-route') return {guildRoute: (g: string, s?: string) => s ? `#guilds/${g}/${s}` : `#guilds/${g}`};
    if (id === '../api') return {ApiError: class ApiError extends Error { code = ''; status = 0; }};
    if (id === '../format') return {formatIsoLocal: (s: string) => s};
    if (id === '../useLocalAction') return {useLocalAction: () => ({busy: false, error: '', message: '', pending: null, run: async () => ({status: 'done'})})};
    if (id === './shared') return {useModuleMutation: () => ({mutate: async () => {}, busy: false, error: ''})};
    if (id.includes('LegacyLaunchpadPrimary')) return {LegacyLaunchpadPrimary: () => React.createElement('div'), legacyPrimaryLabel: () => '主要動作', legacyPrimaryVisible: () => false, legacyStorePath: () => '', legacyWorkNavigationGuard: () => false};
    if (id.startsWith('../../../../')) return fileReq(id + '.ts');
    return fileReq(id);
  }, mod, mod.exports);
  return mod.exports;
}

test('I1: GuildLaunchpadReading lives in its own file and renders reading blocks for the shell', async t => {
  const readingPath = new URL('../../apps/portal-web/src/modules/GuildLaunchpadReading.tsx', import.meta.url);
  assert.equal(existsSync(readingPath), true, 'GuildLaunchpadReading.tsx must exist');
  const shellSource = readFileSync(new URL('../../apps/portal-web/src/modules/GuildLaunchpad.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(shellSource, /function Reading\(/);
  assert.match(shellSource, /from '\.\/GuildLaunchpadReading'/);

  const {document, windowObj, act, createRoot} = setupDom(t);
  const readingMod = compileModule('../../apps/portal-web/src/modules/GuildLaunchpadReading.tsx', windowObj, document);
  assert.equal(typeof readingMod.GuildLaunchpadReading, 'function');
  assert.equal(typeof readingMod.MyWorkUnavailable, 'function');

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(readingMod.GuildLaunchpadReading, {
      guild: {name: '遊戲公會', purpose: '一起做開源遊戲'},
      config: makeConfig(),
      announcements: [],
      skillBooks: [],
      applications: [],
      visitor: false,
      memberTier: 'full',
      mode: 'member',
      client: {sessionGeneration: 1} as any,
      guildKey: 'guild_games',
      userId: 'u1',
      registerLeave: () => {},
      registerPendingLeave: () => {},
      canLeave: () => true,
      canNavigate: () => true,
      blockLoaders: {},
      activeSection: 'information',
      selectSection: () => {},
      skillBooksHeading: React.createRef(),
    }));
  });
  try {
    const blocks = descendants(container).filter(n => n.attributes['data-launchpad-kind']);
    assert.equal(blocks.length, 6);
    assert.equal(descendants(container).some(n => n.textContent.includes('一起做開源遊戲')), true);
  } finally {
    act(() => root.unmount());
  }
});

function createMockClient(handlers: {
  memberLaunchpad: () => any;
  launchpadConfig?: () => any;
  post?: (path: string, body: unknown) => any;
}) {
  const calls: {method: string; path: string; body?: unknown}[] = [];
  const client = {
    sessionGeneration: 1,
    async get(path: string) {
      calls.push({method: 'GET', path});
      if (path.endsWith('/launchpad')) return handlers.memberLaunchpad();
      if (path.endsWith('/launchpad-config')) {
        if (!handlers.launchpadConfig) throw new Error('unexpected GET ' + path);
        return handlers.launchpadConfig();
      }
      return {};
    },
    async post(path: string, body: unknown) {
      calls.push({method: 'POST', path, body});
      return handlers.post ? handlers.post(path, body) : {};
    },
  };
  return {client, calls};
}

function makeMemberPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    guild: {guild_key: 'guild_games', name: '遊戲公會', purpose: '一起做開源遊戲'},
    config: {
      config_id: 'c1',
      revision: 1,
      status: 'published',
      pointer_version: '1',
      source: 'guild_editor',
      body_sha256: 'sha1',
      body: makeConfig(),
    },
    config_problem: null,
    membership: {state: 'active', member_tier: 'full'},
    announcements: [],
    skill_books: [],
    applications: [],
    viewer_can_edit_config: false,
    viewer_can_preview_config: false,
    viewer_can_publish_config: false,
    viewer_can_manage_delegations: false,
    ...overrides,
  };
}

test('I2: member without editor access has no 管理啟動台 section and makes no config request', async t => {
  const editorPath = new URL('../../apps/portal-web/src/modules/GuildLaunchpadEditor.tsx', import.meta.url);
  assert.equal(existsSync(editorPath), true, 'GuildLaunchpadEditor.tsx must exist');
  const shellSource = readFileSync(new URL('../../apps/portal-web/src/modules/GuildLaunchpad.tsx', import.meta.url), 'utf8');
  assert.match(shellSource, /lazy\(\(\) => import\('\.\/GuildLaunchpadEditor'\)/);

  const {document, windowObj, act, createRoot} = setupDom(t);
  let editorImports = 0;
  const compileAll = (relPath: string): any => compileModule(relPath, windowObj, document, {
    './GuildLaunchpadReading': () => compileAll('../../apps/portal-web/src/modules/GuildLaunchpadReading.tsx'),
    './GuildLaunchpadEditor': () => { editorImports += 1; return compileAll('../../apps/portal-web/src/modules/GuildLaunchpadEditor.tsx'); },
  });
  const {GuildLaunchpad} = compileAll('../../apps/portal-web/src/modules/GuildLaunchpad.tsx');
  const {client, calls} = createMockClient({memberLaunchpad: () => makeMemberPayload()});

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(GuildLaunchpad, {client: client as any, guildKey: 'guild_games', mode: 'member', userId: 'u1'}));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
  try {
    const buttons = descendants(container).filter(n => n.nodeName === 'BUTTON').map(n => n.textContent.trim());
    assert.equal(buttons.includes('管理啟動台'), false);
    assert.equal(calls.filter(c => c.path.includes('launchpad-config')).length, 0);
    assert.equal(editorImports, 0);
  } finally {
    act(() => root.unmount());
  }
});

test('I2: member with access loads editor after fallback and requests config once when choosing 管理啟動台', async t => {
  const {document, windowObj, act, createRoot} = setupDom(t);
  let editorImports = 0;
  const compileAll = (relPath: string): any => compileModule(relPath, windowObj, document, {
    './GuildLaunchpadReading': () => compileAll('../../apps/portal-web/src/modules/GuildLaunchpadReading.tsx'),
    './GuildLaunchpadEditor': () => { editorImports += 1; return compileAll('../../apps/portal-web/src/modules/GuildLaunchpadEditor.tsx'); },
  });
  const {GuildLaunchpad} = compileAll('../../apps/portal-web/src/modules/GuildLaunchpad.tsx');
  const base = makeMemberPayload({viewer_can_edit_config: true, viewer_can_preview_config: true, viewer_can_publish_config: true});
  const {client, calls} = createMockClient({
    memberLaunchpad: () => base,
    launchpadConfig: () => ({...base.config, viewer_can_edit_config: true, viewer_can_preview_config: true, viewer_can_publish_config: true, viewer_can_manage_delegations: false, revisions: [], config_problem: null}),
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(GuildLaunchpad, {client: client as any, guildKey: 'guild_games', mode: 'member', userId: 'u1'}));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
  try {
    assert.equal(calls.filter(c => c.path.includes('launchpad-config')).length, 0, 'no eager config request on launchpad open');
    assert.equal(editorImports, 0, 'editor chunk not imported before 管理啟動台');
    const mgmtBtn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '管理啟動台')!;
    assert.equal(Boolean(mgmtBtn), true, '管理啟動台 section button exists');
    const propsKey = Object.keys(mgmtBtn).find(k => k.startsWith('__reactProps$'))!;

    // Trigger click synchronously first to verify fallback renders while lazy import resolves.
    act(() => { mgmtBtn[propsKey].onClick(); });
    const statusesDuringLoad = descendants(container).filter(n => n.attributes.role === 'status').map(n => n.textContent.trim());
    assert.equal(statusesDuringLoad.includes('載入中…'), true, 'Suspense fallback 載入中… appears first');

    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    assert.equal(editorImports, 1);
    assert.equal(calls.filter(c => c.path.endsWith('/launchpad-config')).length, 1);
    assert.equal(descendants(container).some(n => n.nodeName === 'H2' && n.textContent.trim() === '調整版面'), true);
  } finally {
    act(() => root.unmount());
  }
});

const propsOf = (node: HostNode) => {
  const key = Object.keys(node).find(k => k.startsWith('__reactProps$'))!;
  return node[key];
};

test('I3: changing draft asks before leaving section or page via registerPendingLeave', async t => {
  const {document, windowObj, act, createRoot} = setupDom(t);
  let confirmCalls = 0;
  let confirmAnswer = false;
  windowObj.confirm = () => { confirmCalls += 1; return confirmAnswer; };
  const pendingLeaveGuard: {current: (() => boolean) | null} = {current: null};

  const compileAll = (relPath: string): any => compileModule(relPath, windowObj, document, {
    './GuildLaunchpadReading': () => compileAll('../../apps/portal-web/src/modules/GuildLaunchpadReading.tsx'),
    './GuildLaunchpadEditor': () => compileAll('../../apps/portal-web/src/modules/GuildLaunchpadEditor.tsx'),
  });
  const {GuildLaunchpad} = compileAll('../../apps/portal-web/src/modules/GuildLaunchpad.tsx');
  const base = makeMemberPayload({viewer_can_edit_config: true, viewer_can_preview_config: true, viewer_can_publish_config: true});
  const {client} = createMockClient({
    memberLaunchpad: () => base,
    launchpadConfig: () => ({...base.config, viewer_can_edit_config: true, viewer_can_preview_config: true, viewer_can_publish_config: true, viewer_can_manage_delegations: false, revisions: [], config_problem: null}),
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(GuildLaunchpad, {
      client: client as any,
      guildKey: 'guild_games',
      mode: 'member',
      userId: 'u1',
      registerPendingLeave: (guard: (() => boolean) | null) => { pendingLeaveGuard.current = guard; },
    }));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
  try {
    const mgmtBtn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '管理啟動台')!;
    await act(async () => { propsOf(mgmtBtn).onClick(); for (let i = 0; i < 10; i++) await Promise.resolve(); });

    assert.equal(pendingLeaveGuard.current?.(), true, 'clean editor lets page leave without confirm');
    assert.equal(confirmCalls, 0);

    const missionInput = descendants(container).find(n => n.nodeName === 'INPUT' && n.attributes.id === 'launchpad-mission')!;
    assert.equal(Boolean(missionInput), true, 'mission input exists');
    await act(async () => { propsOf(missionInput).onChange({target: {value: '尚未儲存的新使命'}}); });

    confirmAnswer = false;
    assert.equal(pendingLeaveGuard.current?.(), false, 'dirty editor blocks page leave when confirm returns false');
    assert.equal(confirmCalls, 1);

    const infoBtn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '公會資訊')!;
    await act(async () => { propsOf(infoBtn).onClick(); });
    assert.equal(confirmCalls, 2, 'switching section from dirty editor prompts confirm');
    assert.equal(descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '管理啟動台')?.attributes['aria-current'], 'page', 'cancelling confirm stays on 管理啟動台');

    confirmAnswer = true;
    await act(async () => { propsOf(infoBtn).onClick(); });
    assert.equal(confirmCalls, 3);
    assert.equal(descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '公會資訊')?.attributes['aria-current'], 'page', 'confirming switches to 公會資訊');
  } finally {
    act(() => root.unmount());
  }
});

test('I3: publish and revert call onPublished and shell reloads reading data once each', async t => {
  const {document, windowObj, act, createRoot} = setupDom(t);
  const compileAll = (relPath: string): any => compileModule(relPath, windowObj, document, {
    './GuildLaunchpadReading': () => compileAll('../../apps/portal-web/src/modules/GuildLaunchpadReading.tsx'),
    './GuildLaunchpadEditor': () => compileAll('../../apps/portal-web/src/modules/GuildLaunchpadEditor.tsx'),
  });
  const {GuildLaunchpad} = compileAll('../../apps/portal-web/src/modules/GuildLaunchpad.tsx');

  let readingMission = '初始發布使命';
  const draftBody = {...makeConfig(), mission_override: '待發布草稿使命'};
  const publishedBody = {...makeConfig(), mission_override: '第二次發布使命'};
  const revertedBody = {...makeConfig(), mission_override: '回復後使命'};
  const sha = 'a'.repeat(64);
  let currentConfigView: any = {
    config_id: 'c2',
    revision: 2,
    status: 'draft',
    pointer_version: '2',
    source: 'guild_editor',
    body_sha256: sha,
    body: draftBody,
  };
  const revisions = [
    {revision: '1', status: 'published', source: 'guild_editor', created_at: '2026-01-01T00:00:00Z', revert_reason: null, reverted_from_revision: null},
  ];
  const {client, calls} = createMockClient({
    memberLaunchpad: () => makeMemberPayload({
      config: {config_id: 'c1', revision: 1, status: 'published', pointer_version: '2', source: 'guild_editor', body_sha256: sha, body: {...makeConfig(), mission_override: readingMission}},
      viewer_can_edit_config: true, viewer_can_preview_config: true, viewer_can_publish_config: true,
    }),
    launchpadConfig: () => ({
      ...currentConfigView,
      viewer_can_edit_config: true, viewer_can_preview_config: true, viewer_can_publish_config: true, viewer_can_manage_delegations: false,
      revisions, config_problem: null,
    }),
    post: (path: string) => {
      if (path.endsWith('/publish')) {
        readingMission = '第二次發布使命';
        currentConfigView = {config_id: 'c2', revision: 2, status: 'published', pointer_version: '3', source: 'guild_editor', body_sha256: sha, body: publishedBody};
        return currentConfigView;
      }
      if (path.endsWith('/revert')) {
        readingMission = '回復後使命';
        currentConfigView = {config_id: 'c3', revision: 3, status: 'published', pointer_version: '4', source: 'guild_editor', body_sha256: sha, body: revertedBody};
        return currentConfigView;
      }
      return {};
    },
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(GuildLaunchpad, {client: client as any, guildKey: 'guild_games', mode: 'member', userId: 'u1'}));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
  try {
    assert.equal(calls.filter(c => c.method === 'GET' && c.path.endsWith('/launchpad')).length, 1);
    const mgmtBtn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '管理啟動台')!;
    await act(async () => { propsOf(mgmtBtn).onClick(); for (let i = 0; i < 10; i++) await Promise.resolve(); });

    const publishBtn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '發布')!;
    await act(async () => { propsOf(publishBtn).onClick({currentTarget: publishBtn}); });
    const confirmPublishBtn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '確認發布')!;
    await act(async () => { propsOf(confirmPublishBtn).onClick(); for (let i = 0; i < 10; i++) await Promise.resolve(); });

    assert.equal(calls.filter(c => c.method === 'GET' && c.path.endsWith('/launchpad')).length, 2, 'publish reloads reading data once');
    assert.equal(descendants(container).some(n => n.attributes['data-launchpad-kind'] === 'mission' && n.textContent.includes('第二次發布使命')), true);

    const versionsTab = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '版本紀錄')!;
    await act(async () => { propsOf(versionsTab).onClick(); });
    const revertOpenBtn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '回復到此版本')!;
    await act(async () => { propsOf(revertOpenBtn).onClick({currentTarget: revertOpenBtn}); });
    const reasonInput = descendants(container).find(n => n.nodeName === 'DIALOG' && n.textContent.includes('確認回復'))!;
    const reasonField = descendants(reasonInput).find(n => n.nodeName === 'INPUT')!;
    await act(async () => { propsOf(reasonField).onChange({target: {value: '回復至上一版本'}}); });
    const confirmRevertBtn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '確認回復')!;
    await act(async () => { propsOf(confirmRevertBtn).onClick(); for (let i = 0; i < 10; i++) await Promise.resolve(); });

    assert.equal(calls.filter(c => c.method === 'GET' && c.path.endsWith('/launchpad')).length, 3, 'revert reloads reading data once');
    assert.equal(descendants(container).some(n => n.attributes['data-launchpad-kind'] === 'mission' && n.textContent.includes('回復後使命')), true);
  } finally {
    act(() => root.unmount());
  }
});

test('I3: editor preview imports and renders GuildLaunchpadReading with preview result', async t => {
  const editorSource = readFileSync(new URL('../../apps/portal-web/src/modules/GuildLaunchpadEditor.tsx', import.meta.url), 'utf8');
  assert.equal(/import\s*\{[^}]*\bGuildLaunchpadReading\b[^}]*\}\s*from\s*'\.\/GuildLaunchpadReading'/.test(editorSource), true, 'GuildLaunchpadEditor must import GuildLaunchpadReading');

  const {document, windowObj, act, createRoot} = setupDom(t);
  const compileAll = (relPath: string): any => compileModule(relPath, windowObj, document, {
    './GuildLaunchpadReading': () => compileAll('../../apps/portal-web/src/modules/GuildLaunchpadReading.tsx'),
    './GuildLaunchpadEditor': () => compileAll('../../apps/portal-web/src/modules/GuildLaunchpadEditor.tsx'),
  });
  const {GuildLaunchpad} = compileAll('../../apps/portal-web/src/modules/GuildLaunchpad.tsx');
  const base = makeMemberPayload({viewer_can_edit_config: true, viewer_can_preview_config: true});
  const {client, calls} = createMockClient({
    memberLaunchpad: () => base,
    launchpadConfig: () => ({...base.config, viewer_can_edit_config: true, viewer_can_preview_config: true, viewer_can_publish_config: false, viewer_can_manage_delegations: false, revisions: [], config_problem: null}),
    post: (path: string) => {
      if (path.endsWith('/preview')) {
        return {
          effective_config: {...makeConfig(), mission_override: '預覽合成使命文案', starter: {title_label: '預覽標題', objective_hint: '預覽目標', note_hint: '預覽筆記'}},
          validation: [],
          preview_data_origin: 'synthetic_fixture',
        };
      }
      return {};
    },
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(GuildLaunchpad, {client: client as any, guildKey: 'guild_games', mode: 'member', userId: 'u1'}));
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
  try {
    const mgmtBtn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '管理啟動台')!;
    await act(async () => { propsOf(mgmtBtn).onClick(); for (let i = 0; i < 10; i++) await Promise.resolve(); });

    const previewPublicBtn = descendants(container).find(n => n.nodeName === 'BUTTON' && n.textContent.trim() === '預覽公開')!;
    await act(async () => { propsOf(previewPublicBtn).onClick(); for (let i = 0; i < 10; i++) await Promise.resolve(); });

    const previewDialog = descendants(container).find(n => n.nodeName === 'DIALOG' && n.textContent.includes('合成預覽'))!;
    assert.equal(Boolean(previewDialog), true);
    const previewMission = descendants(previewDialog).find(n => n.attributes['data-launchpad-kind'] === 'mission');
    assert.equal(Boolean(previewMission), true, 'preview dialog renders GuildLaunchpadReading mission block');
    assert.equal(previewMission?.textContent.includes('預覽合成使命文案'), true);
    assert.equal(calls.some(c => c.path.includes('/tenants')), false, 'preview does not read member workspaces');
  } finally {
    act(() => root.unmount());
  }
});
