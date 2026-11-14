import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { ApiError } from '../../apps/portal-web/src/api.js';

const sharePagePath = new URL('../../apps/portal-web/src/share/SharePage.tsx', import.meta.url);
const sharePageRequire = createRequire(sharePagePath);

type VNode = { type: unknown; props: Record<string, any> };
type AccountState = {
  value?: { configured: boolean; connected: boolean; github_user: { id: string; login: string } | null };
  loading: boolean;
  error: string;
  received: number;
};

function createHarness() {
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const effects: { deps: unknown[] | undefined; fn: () => unknown; cleanup?: () => void }[] = [];
  let pendingEffects: (() => void)[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;

  const reactStub = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type: unknown, props: Record<string, any> | null, ...children: unknown[]): VNode {
      return { type, props: { ...(props ?? {}), children: children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false && c !== true) } };
    },
    useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const idx = stateIndex++;
      if (!(idx in states)) states[idx] = typeof initial === 'function' ? (initial as () => T)() : initial;
      const setState = (next: T | ((prev: T) => T)) => {
        states[idx] = typeof next === 'function' ? (next as (prev: T) => T)(states[idx] as T) : next;
      };
      return [states[idx] as T, setState];
    },
    useRef<T>(initial: T): { current: T } {
      const idx = refIndex++;
      if (!(idx in refs)) refs[idx] = { current: initial };
      return refs[idx] as { current: T };
    },
    useEffect(fn: () => unknown, deps?: unknown[]) {
      const idx = effectIndex++;
      const prev = effects[idx];
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps![i]));
      if (changed) {
        pendingEffects.push(() => {
          prev?.cleanup?.();
          const cleanup = fn();
          effects[idx] = { deps, fn, cleanup: typeof cleanup === 'function' ? (cleanup as () => void) : undefined };
        });
      }
    },
  };

  return {
    reactStub,
    render(fn: () => VNode): VNode {
      stateIndex = 0;
      refIndex = 0;
      effectIndex = 0;
      pendingEffects = [];
      const tree = fn();
      const toRun = pendingEffects.splice(0);
      for (const eff of toRun) eff();
      return tree;
    },
    async flush(fn: () => VNode): Promise<VNode> {
      let tree = this.render(fn);
      await new Promise(resolve => setTimeout(resolve, 0));
      tree = this.render(fn);
      return tree;
    },
  };
}

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
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (typeof node === 'object' && 'props' in (node as VNode)) return nodeText((node as VNode).props?.children);
  return '';
}

function hasClass(node: VNode, name: string): boolean {
  const cls = String(node.props?.className ?? '').split(/\s+/);
  return cls.includes(name);
}

function loadSharePage(harness: ReturnType<typeof createHarness>, store: {
  account: AccountState;
  loadAccount: () => Promise<void>;
  connect: (returnTo: string) => Promise<string>;
}) {
  const jsxRuntime = {
    Fragment: harness.reactStub.Fragment,
    jsx(type: unknown, props: Record<string, any>) {
      return { type, props: props ?? {} };
    },
    jsxs(type: unknown, props: Record<string, any>) {
      return { type, props: props ?? {} };
    },
  };
  const source = readFileSync(sharePagePath, 'utf8');
  const compiled = transformSync(source, {
    loader: 'tsx',
    format: 'cjs',
    jsx: 'automatic',
    sourcefile: sharePagePath.pathname,
  }).code;

  const mod = { exports: {} as Record<string, any> };
  const sandboxWindow = {
    location: {
      hash: '#shares/11111111-1111-4111-8111-111111111111',
      assignCalls: [] as string[],
      assign(url: string) {
        this.assignCalls.push(url);
      },
    },
  };
  const localRequire = (specifier: string) => {
    if (specifier === 'react') return harness.reactStub;
    if (specifier === 'react/jsx-runtime') return jsxRuntime;
    if (specifier === './share.css') return {};
    if (specifier === '../api') return { ApiError };
    if (specifier === '../modules/GitHubSocial') return { useGitHubSocialStore: () => store };
    if (specifier === './ShareButton') {
      return {
        promotionLink: (c: { post: (p: string, b: unknown) => Promise<unknown> }, kind: string, target: string) =>
          () => c.post('/promotion/links', { kind, target }),
        ShareButton: ({ label }: { label: string }) => harness.reactStub.createElement('button', { type: 'button', className: 'btn btn-secondary btn-small' }, label),
      };
    }
    return sharePageRequire(specifier);
  };

  runInNewContext(compiled, {
    module: mod,
    exports: mod.exports,
    require: localRequire,
    window: sandboxWindow,
    crypto: globalThis.crypto,
    URL,
  });

  return { SharePage: mod.exports.SharePage, sandboxWindow };
}

function repoPageFixture(id = '11111111-1111-4111-8111-111111111111') {
  return {
    share_id: id,
    ref_id: null,
    title: 'freetwai-test/shared-repo',
    kind: 'repository',
    canonical_url: 'https://github.com/freetwai-test/shared-repo',
    sharers: [{ display_name: '測試者', role: 'sharer' }],
    repository: {
      full_name: 'freetwai-test/shared-repo',
      url: 'https://github.com/freetwai-test/shared-repo',
      description: 'demo repo',
      license_spdx: 'MIT',
      homepage: null,
      topics: [],
      pushed_at: null,
      forks_count: 0,
      open_issues_count: 0,
      subscribers_count: 0,
      readme_html: '<p>readme</p>',
      quick_start: 'npx demo',
      stars: 1,
      original_author: 'freetwai-test',
      latest_release: null,
      fetched_at: null,
    },
  };
}

test('UX-F-02: renders plain secondary 在 GitHub 查看 link when star cannot be recorded and keeps connect flow when configured', async () => {
  const harness = createHarness();
  const connectCalls: string[] = [];
  let starError: ApiError | null = null;
  let starPosts = 0;
  const store = {
    account: {
      value: { configured: false, connected: false, github_user: null },
      loading: false,
      error: '',
      received: 1,
    } as AccountState,
    async loadAccount() {},
    async connect(returnTo: string) {
      connectCalls.push(returnTo);
      return 'https://github.com/login/oauth/authorize?client_id=test';
    },
  };

  const client = {
    sessionGeneration: 1,
    async get(path: string) {
      return repoPageFixture(path.split('/').pop());
    },
    async post() {
      starPosts++;
      if (starError) throw starError;
      return { starred: true, confirmed: true };
    },
  };

  const { SharePage, sandboxWindow } = loadSharePage(harness, store);
  const shareId = '11111111-1111-4111-8111-111111111111';
  const renderPage = (id = shareId) => SharePage({ client, id }) as VNode;

  // 0. While account is undefined (loading or failed to load): no star button, plain secondary link 在 GitHub 查看
  store.account.value = undefined;
  let tree = await harness.flush(() => renderPage(shareId));
  let nodes = collectNodes(tree);
  assert.equal(nodes.filter(n => n.type === 'button' && nodeText(n).includes('加星')).length, 0);
  assert.ok(nodes.find(n => n.type === 'a' && nodeText(n) === '在 GitHub 查看'));

  // 1. GitHub OAuth not configured: no star button, plain secondary link 在 GitHub 查看
  store.account.value = { configured: false, connected: false, github_user: null };
  tree = harness.render(() => renderPage(shareId));
  nodes = collectNodes(tree);
  assert.equal(nodes.filter(n => n.type === 'button' && nodeText(n).includes('加星')).length, 0);
  const githubLink = nodes.find(n => n.type === 'a' && nodeText(n) === '在 GitHub 查看');
  assert.ok(githubLink, 'expected 在 GitHub 查看 link when unconfigured');
  assert.equal(githubLink.props.href, 'https://github.com/freetwai-test/shared-repo');
  assert.equal(githubLink.props.target, '_blank');
  assert.equal(githubLink.props.rel, 'noopener noreferrer');
  assert.equal(hasClass(githubLink, 'btn-primary'), false);
  assert.equal(hasClass(githubLink, 'btn-secondary'), true);

  // 2. Configured, not connected: keeps connect flow
  store.account.value = { configured: true, connected: false, github_user: null };
  tree = harness.render(() => renderPage(shareId));
  nodes = collectNodes(tree);
  const connectBtn = nodes.find(n => n.type === 'button' && nodeText(n) === '連結 GitHub 加星');
  assert.ok(connectBtn, 'expected 連結 GitHub 加星 button when configured but not connected');
  assert.equal(hasClass(connectBtn, 'btn-primary'), true);
  assert.equal(nodes.some(n => n.type === 'a' && nodeText(n) === '在 GitHub 查看'), false);
  connectBtn.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(connectCalls.length, 1);
  assert.equal(sandboxWindow.location.assignCalls.length, 1);

  // 3. Connected, star endpoint rejects with 403 github_permission_required: hide star button, show 在 GitHub 查看
  store.account.value = { configured: true, connected: true, github_user: { id: '1', login: 'member' } };
  starError = new ApiError({ message: '無法使用此權限。', status: 403, code: 'github_permission_required' });
  tree = harness.render(() => renderPage(shareId));
  nodes = collectNodes(tree);
  const starBtn = nodes.find(n => n.type === 'button' && nodeText(n) === '☆ 加星');
  assert.ok(starBtn, 'expected ☆ 加星 button when connected');
  starBtn.props.onClick();
  tree = await harness.flush(() => renderPage(shareId));
  nodes = collectNodes(tree);
  assert.equal(starPosts, 1);
  assert.equal(nodes.filter(n => n.type === 'button' && nodeText(n).includes('加星')).length, 0);
  const fallbackAfter403 = nodes.find(n => n.type === 'a' && nodeText(n) === '在 GitHub 查看');
  assert.ok(fallbackAfter403, 'expected 在 GitHub 查看 link after 403 github_permission_required');
  assert.equal(hasClass(fallbackAfter403, 'btn-secondary'), true);

  // 4. Switching to another share resets starBlocked and allows starring when permitted
  const otherId = '22222222-2222-4222-8222-222222222222';
  starError = null;
  tree = await harness.flush(() => renderPage(otherId));
  nodes = collectNodes(tree);
  const starBtn2 = nodes.find(n => n.type === 'button' && nodeText(n) === '☆ 加星');
  assert.ok(starBtn2, 'expected ☆ 加星 button on next share');
  starBtn2.props.onClick();
  tree = await harness.flush(() => renderPage(otherId));
  nodes = collectNodes(tree);
  assert.ok(nodes.find(n => n.type === 'button' && nodeText(n) === '★ 已加星'));
});

test('UX-M-02: unknown share shows 找不到分享 and one primary 回到動態 link to #home', async () => {
  const harness = createHarness();
  const store = {
    account: {
      value: { configured: false, connected: false, github_user: null },
      loading: false,
      error: '',
      received: 1,
    } as AccountState,
    async loadAccount() {},
    async connect() {
      return 'https://github.com/login/oauth/authorize?client_id=test';
    },
  };
  const client = {
    sessionGeneration: 1,
    async get() {
      throw new ApiError({ message: '找不到分享。', status: 404, code: 'not_found' });
    },
    async post() {
      return {};
    },
  };

  const { SharePage } = loadSharePage(harness, store);
  const unknownId = '00000000-0000-4000-8000-000000009999';
  const tree = await harness.flush(() => SharePage({ client, id: unknownId }) as VNode);
  const nodes = collectNodes(tree);

  const alert = nodes.find(n => n.props?.role === 'alert');
  assert.ok(alert, 'expected alert on unknown share');
  assert.equal(nodeText(alert), '找不到分享');
  const primaries = nodes.filter(n => hasClass(n, 'btn-primary'));
  assert.equal(primaries.length, 1);
  const backLink = primaries[0];
  assert.equal(backLink.type, 'a');
  assert.equal(nodeText(backLink), '回到動態');
  assert.equal(backLink.props.href, '#home');
});

test('link share with no repository shows canonical_url hostname as one muted line under title; non-link or repo does not', async () => {
  const harness = createHarness();
  const store = {
    account: {
      value: { configured: false, connected: false, github_user: null },
      loading: false,
      error: '',
      received: 1,
    } as AccountState,
    async loadAccount() {},
    async connect() { return ''; },
  };
  let currentShare: Record<string, unknown> = {
    share_id: '33333333-3333-4333-8333-333333333333',
    ref_id: null,
    title: '手動分享標題',
    kind: 'link',
    canonical_url: 'https://example.com/unreadable',
    sharers: [{ display_name: '測試會員', role: 'sharer' }],
    repository: null,
  };
  const client = {
    sessionGeneration: 1,
    async get() { return currentShare; },
    async post() { return {}; },
  };

  const { SharePage } = loadSharePage(harness, store);
  let tree = await harness.flush(() => SharePage({ client, id: '33333333-3333-4333-8333-333333333333' }) as VNode);
  let nodes = collectNodes(tree);
  const header = nodes.find(n => n.type === 'header')!;
  const headerChildren = collectNodes(header);
  const siteLine = headerChildren.find(n => n.type === 'p' && hasClass(n, 'muted'));
  assert.ok(siteLine, 'expected muted site line under title in <header>');
  assert.equal(nodeText(siteLine), 'example.com');

  // Non-link share with no repository does not render hostname line.
  currentShare = {
    share_id: '44444444-4444-4444-8444-444444444444',
    ref_id: '55555555-5555-4555-8555-555555555555',
    title: '貼文分享',
    kind: 'post',
    canonical_url: 'https://example.com/post',
    sharers: [],
    repository: null,
  };
  tree = await harness.flush(() => SharePage({ client, id: '44444444-4444-4444-8444-444444444444' }) as VNode);
  nodes = collectNodes(tree);
  assert.equal(nodes.some(n => nodeText(n) === 'example.com'), false);
});

test('SharePage requests only POST /shares/:id/links for every share kind in one request', async () => {
  const harness = createHarness();
  const store = {
    account: {
      value: { configured: false, connected: false, github_user: null },
      loading: false,
      error: '',
      received: 1,
    } as AccountState,
    async loadAccount() {},
    async connect() { return ''; },
  };
  const posts: { path: string; body: unknown; options?: unknown }[] = [];
  let currentShare: Record<string, unknown> = {};
  const client = {
    sessionGeneration: 1,
    async get() { return currentShare; },
    async post(path: string, body: unknown, options?: unknown) {
      posts.push({ path, body, options });
      return { path: '/go/abc1234567', code: 'abc1234567' };
    },
  };

  const { SharePage } = loadSharePage(harness, store);
  const cases = [
    { kind: 'repository', share_id: '11111111-1111-4111-8111-111111111111', ref_id: null, expectedFallback: '/s/11111111-1111-4111-8111-111111111111' },
    { kind: 'link', share_id: '22222222-2222-4222-8222-222222222222', ref_id: null, expectedFallback: '/s/22222222-2222-4222-8222-222222222222' },
    { kind: 'work', share_id: '33333333-3333-4333-8333-333333333333', ref_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedFallback: '/#shares/33333333-3333-4333-8333-333333333333' },
    { kind: 'event', share_id: '44444444-4444-4444-8444-444444444444', ref_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expectedFallback: '/events/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { kind: 'post', share_id: '55555555-5555-4555-8555-555555555555', ref_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', expectedFallback: '/?social-post=cccccccc-cccc-4ccc-8ccc-cccccccccccc#social' },
    { kind: 'service', share_id: '66666666-6666-4666-8666-666666666666', ref_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', expectedFallback: '/services/dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
  ];

  for (const item of cases) {
    posts.length = 0;
    currentShare = {
      share_id: item.share_id,
      ref_id: item.ref_id,
      title: `分享 ${item.kind}`,
      kind: item.kind,
      canonical_url: 'https://example.com/item',
      sharers: [],
      repository: null,
    };
    const tree = await harness.flush(() => SharePage({ client, id: item.share_id }) as VNode);
    const shareButton = collectNodes(tree).find(n => typeof n.type === 'function' && n.props?.label === '我也要分享');
    assert.ok(shareButton, `expected ShareButton for ${item.kind}`);
    assert.equal(shareButton.props.fallbackUrl, item.expectedFallback);
    assert.equal(typeof shareButton.props.makeLink, 'function');
    const link = await shareButton.props.makeLink();
    assert.equal(link.path, '/go/abc1234567');
    assert.equal(posts.length, 1, `expected 1 POST request for ${item.kind}`);
    assert.equal(posts[0].path, `/shares/${item.share_id}/links`);
    assert.deepEqual(JSON.parse(JSON.stringify(posts[0].body)), {});
  }
});
