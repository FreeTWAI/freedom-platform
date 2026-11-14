import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { transformSync } from 'esbuild';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const MODULES_DIR = resolve(import.meta.dirname, '../../apps/portal-web/src/modules');
const WORKBENCH_DIR = resolve(MODULES_DIR, 'workbench');

const SPLIT_FILES = [
  { path: resolve(MODULES_DIR, 'WorkbenchPanel.tsx'), exports: ['WorkbenchPanel'] },
  { path: resolve(WORKBENCH_DIR, 'WorkItems.tsx'), exports: ['WorkItemList', 'WorkItemCard'] },
  { path: resolve(WORKBENCH_DIR, 'ReviewQueue.tsx'), exports: ['ReviewCard', 'ReviewQueue'] },
  { path: resolve(WORKBENCH_DIR, 'CreateWorkForm.tsx'), exports: ['CreateWorkForm'] },
  { path: resolve(WORKBENCH_DIR, 'Outcomes.tsx'), exports: ['Outcomes'] },
];

test('I1: WorkbenchPanel is split under modules/workbench/ and each file is <= 300 lines', () => {
  for (const file of SPLIT_FILES) {
    assert.equal(existsSync(file.path), true, `Missing split file: ${file.path}`);
    const source = readFileSync(file.path, 'utf8');
    const lineCount = source.split('\n').length;
    assert.ok(lineCount <= 300, `${file.path} has ${lineCount} lines (limit 300)`);
    for (const sym of file.exports) {
      assert.match(source, new RegExp(`export\\s+(function|const)\\s+${sym}\\b`), `${file.path} must export ${sym}`);
    }
  }
});

interface VNode {
  tag: string;
  props: Record<string, unknown>;
  children: TreeChild[];
}
type TreeChild = VNode | string;

function isReactElement(val: unknown): val is React.ReactElement<Record<string, unknown>> {
  return Boolean(val && typeof val === 'object' && 'type' in val && 'props' in val);
}

function makeWorkItem(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    work_item_id: id,
    aggregate_version: 1,
    title,
    objective: `目標 ${title}`,
    acceptance_criteria: `驗收 ${title}`,
    gain: `收穫 ${title}`,
    estimated_minutes: 30,
    maximum_minutes: 60,
    claim_window_expires_at: '2099-01-01T00:00:00Z',
    due_at: '2099-01-02T00:00:00Z',
    finish_window_expires_at: '2099-01-02T00:00:00Z',
    state: 'open',
    owner_ref: 'other-owner',
    owner_name: '其他夥伴',
    owner_participation_mode: 'volunteer',
    participation_terms_revision: 'rev-1',
    participation_terms_sha256: 'sha-1',
    will_review: false,
    my_claim: null,
    ...overrides,
  };
}

function makeReviewEntry(claimId: string, title: string) {
  return {
    claimant_name: '夥伴甲',
    work_item: makeWorkItem(`work-${claimId}`, title),
    claim: {
      claim_id: claimId,
      aggregate_version: 1,
      claimant_ref: 'other-claimant',
      state: 'submitted',
      latest_submission: {
        summary: '完成提交',
        artifact_ref: 'artifact:v1',
        sha256: 'abc',
      },
    },
  };
}

function makeGain(id: string, title: string) {
  return {
    contribution_id: id,
    work_item_id: `work-${id}`,
    title,
    summary: `成果摘要 ${title}`,
    artifact_ref: 'artifact:gain-1',
    accepted_at: '2026-11-10T00:00:00Z',
  };
}

function mountWorkbench(initialData: {
  dashboard: Record<string, unknown>;
  pages: Array<{ items: unknown[]; next_cursor: string | null }>;
  selectedId?: string;
}) {
  let dashboardData = initialData.dashboard;
  let pagesData = initialData.pages;
  const postCalls: Array<{ path: string; body: unknown }> = [];

  const states = new Map<string, unknown>();
  const effects = new Map<string, { deps: unknown[] | undefined }>();
  let pendingEffects: Array<{ key: string; fn: () => unknown; deps: unknown[] | undefined }> = [];
  let activePath = '';
  let hookCursor = 0;

  const reactMock = {
    ...React,
    useState: (init: unknown) => {
      const key = `${activePath}#s${hookCursor++}`;
      if (!states.has(key)) {
        states.set(key, typeof init === 'function' ? (init as () => unknown)() : init);
      }
      const setState = (updater: unknown) => {
        const prev = states.get(key);
        const next = typeof updater === 'function' ? (updater as (p: unknown) => unknown)(prev) : updater;
        states.set(key, next);
      };
      return [states.get(key), setState];
    },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => unknown, deps?: unknown[]) => {
      const key = `${activePath}#e${hookCursor++}`;
      const prev = effects.get(key);
      const changed =
        !prev ||
        !deps ||
        !prev.deps ||
        deps.length !== prev.deps.length ||
        deps.some((d, i) => !Object.is(d, prev.deps![i]));
      if (changed) {
        pendingEffects.push({ key, fn, deps });
      }
    },
    useSyncExternalStore: (_sub: unknown, getSnap: () => unknown, getServerSnap?: () => unknown) => (getServerSnap ?? getSnap)(),
  };

  const portalSessionMock = {
    client: {
      get: async (path: string) => {
        if (path === '/dashboard') return dashboardData;
        if (path === '/work-items/page') return pagesData[0] ?? { items: [], next_cursor: null };
        if (path.startsWith('/work-items/page?cursor=')) {
          const idx = Number(decodeURIComponent(path.split('cursor=')[1] ?? '0'));
          return pagesData[idx] ?? { items: [], next_cursor: null };
        }
        return {};
      },
      post: async (path: string, body: unknown) => {
        postCalls.push({ path, body });
        if (path === '/work-items' && body && typeof body === 'object' && 'title' in body) {
          const b = body as { title: string };
          const currentFirst = pagesData[0] ?? { items: [], next_cursor: null };
          pagesData[0] = {
            ...currentFirst,
            items: [makeWorkItem(`new-${postCalls.length}`, b.title, { owner_ref: 'owner-1' }), ...currentFirst.items],
          };
        }
        return {};
      },
    },
    usePortal: () => ({
      session: { user: { user_id: 'owner-1', profession_membership_ref: 'guild_ai_project' } },
      pending: null,
      isMe: (ref: string) => ref === 'owner-1',
      mutate: async (_label: string, fn: (key: string) => Promise<void>) => {
        await fn('idem-1');
        return true;
      },
    }),
    describeError: (err: unknown) => ({
      message: err instanceof Error ? err.message : '錯誤',
      network: false,
      conflict: false,
    }),
    isOwnRef: (_user: unknown, ref: string) => ref === 'owner-1',
  };

  const loadModule = (fileUrl: URL): Record<string, unknown> => {
    const req = createRequire(fileUrl);
    const mod = { exports: {} as Record<string, unknown> };
    const code = transformSync(readFileSync(fileUrl, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
    runInNewContext(code, {
      module: mod,
      exports: mod.exports,
      require: (id: string) => {
        if (id === 'react') return reactMock;
        if (id.endsWith('.css')) return {};
        if (id.endsWith('/ContributionOutcomes') || id === './ContributionOutcomes') {
          return { WorkContributionRoles: ({ workItemId }: { workItemId: string }) => React.createElement('div', { 'data-contrib-roles': workItemId }) };
        }
        if (id.endsWith('/BenefitObservations') || id === './BenefitObservations') {
          return { BenefitObservations: ({ workItemId }: { workItemId: string }) => React.createElement('div', { 'data-benefit-obs': workItemId }) };
        }
        if (id.endsWith('/portal-session')) return portalSessionMock;
        if (id.startsWith('./workbench/')) return loadModule(new URL(`${id}.tsx`, fileUrl));
        return req(id);
      },
    });
    return mod.exports;
  };

  const panelUrl = new URL('../../apps/portal-web/src/modules/WorkbenchPanel.tsx', import.meta.url);
  const { WorkbenchPanel } = loadModule(panelUrl) as { WorkbenchPanel: React.ComponentType<{ selectedId?: string }> };

  function renderNode(node: unknown, path: string): TreeChild[] {
    if (node == null || typeof node === 'boolean') return [];
    if (typeof node === 'string' || typeof node === 'number') return [String(node)];
    if (Array.isArray(node)) return node.flatMap((child, i) => renderNode(child, `${path}[${i}]`));
    if (!isReactElement(node)) return [];
    if (node.type === React.Fragment) return renderNode(node.props.children, `${path}:frag`);
    if (typeof node.type === 'function') {
      const fn = node.type as (p: Record<string, unknown>) => React.ReactNode;
      const compPath = `${path}/${fn.name || 'Anon'}${node.key != null ? `#${String(node.key)}` : ''}`;
      activePath = compPath;
      hookCursor = 0;
      const out = fn(node.props);
      return renderNode(out, compPath);
    }
    if (typeof node.type === 'string') {
      return [
        {
          tag: node.type,
          props: node.props,
          children: renderNode(node.props.children, `${path}/${node.type}`),
        },
      ];
    }
    return [];
  }

  let tree: TreeChild[] = [];
  const renderOnce = () => {
    pendingEffects = [];
    tree = renderNode(React.createElement(WorkbenchPanel, { selectedId: initialData.selectedId }), 'root');
    const toRun = pendingEffects;
    pendingEffects = [];
    for (const eff of toRun) {
      effects.set(eff.key, { deps: eff.deps });
      eff.fn();
    }
  };

  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      renderOnce();
      await new Promise((r) => setTimeout(r, 0));
    }
    renderOnce();
  };

  return {
    settle,
    renderOnce,
    setData(next: { dashboard?: Record<string, unknown>; pages?: Array<{ items: unknown[]; next_cursor: string | null }> }) {
      if (next.dashboard) dashboardData = next.dashboard;
      if (next.pages) pagesData = next.pages;
    },
    getTree: () => tree,
    postCalls,
  };
}

function collectNodes(nodes: TreeChild[], pred: (n: VNode) => boolean): VNode[] {
  const out: VNode[] = [];
  for (const child of nodes) {
    if (typeof child === 'string') continue;
    if (pred(child)) out.push(child);
    out.push(...collectNodes(child.children, pred));
  }
  return out;
}

function textOf(node: TreeChild): string {
  if (typeof node === 'string') return node;
  return node.children.map(textOf).join('');
}

function allText(nodes: TreeChild[]): string {
  return nodes.map(textOf).join(' ');
}

test('I2: default view is 我的工作 with current-work anchor, hides other views, and shows review option only when N > 0', async () => {
  const nowItem = makeWorkItem('now-1', '進行中工作');
  const nextItem = makeWorkItem('next-1', '接下來工作');
  const catalogItem = makeWorkItem('cat-1', '社群工作甲');
  const gainedItem = makeGain('gain-1', '成果甲');

  // N = 0: review option hidden
  const emptyReviewApp = mountWorkbench({
    dashboard: { summary: { accepted_count: 1 }, now: [nowItem], next: [nextItem], review_queue: [], gained: [gainedItem] },
    pages: [{ items: [catalogItem], next_cursor: '1' }],
  });
  await emptyReviewApp.settle();

  const tree0 = emptyReviewApp.getTree();
  const picker0 = collectNodes(tree0, (n) => n.tag === 'select' && n.props['aria-label'] === '工作檢視')[0];
  assert.ok(picker0, 'view picker <select aria-label="工作檢視"> must exist');
  const pickerLabels0 = collectNodes(tree0, (n) => n.tag === 'label' && String(n.props.className ?? '').includes('place-view-picker'));
  assert.equal(pickerLabels0.length, 1);
  assert.match(textOf(pickerLabels0[0]), /^檢視/);

  const options0 = collectNodes(picker0.children, (n) => n.tag === 'option').map((o) => textOf(o));
  assert.deepEqual(options0, ['我的工作', '社群工作', '我的成果']);
  assert.equal(options0.some((t) => t.includes('待你回饋')), false);

  const text0 = allText(tree0);
  assert.equal(text0.includes('現在進行'), true);
  assert.equal(text0.includes('接下來'), true);
  assert.equal(text0.includes('進行中工作'), true);
  assert.equal(text0.includes('其他社群工作'), false);
  assert.equal(text0.includes('待你回饋'), false);
  assert.equal(text0.includes('已獲得的成果'), false);
  assert.equal(text0.includes('已接受成果'), false);
  assert.equal(collectNodes(tree0, (n) => n.props['data-guide-anchor'] === 'workbench:current-work').length, 1);

  // Switch to 社群工作
  (picker0.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'community' } });
  await emptyReviewApp.settle();
  const textComm = allText(emptyReviewApp.getTree());
  assert.equal(textComm.includes('其他社群工作'), true);
  assert.equal(textComm.includes('社群工作甲'), true);
  assert.equal(textComm.includes('載入較早的社群工作'), true);
  assert.equal(textComm.includes('現在進行'), false);
  assert.equal(textComm.includes('已獲得的成果'), false);

  // Switch to 我的成果
  const pickerComm = collectNodes(emptyReviewApp.getTree(), (n) => n.tag === 'select' && n.props['aria-label'] === '工作檢視')[0];
  (pickerComm.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'outcomes' } });
  await emptyReviewApp.settle();
  const treeOut = emptyReviewApp.getTree();
  const textOut = allText(treeOut);
  assert.equal(textOut.includes('已接受成果'), true);
  assert.equal(textOut.includes('已獲得的成果'), true);
  assert.equal(textOut.includes('成果甲'), true);
  assert.equal(collectNodes(treeOut, (n) => 'data-benefit-obs' in n.props).length, 1);
  assert.equal(collectNodes(treeOut, (n) => 'data-contrib-roles' in n.props).length, 1);
  assert.equal(textOut.includes('現在進行'), false);
  assert.equal(textOut.includes('其他社群工作'), false);
});

test('I2: empty 我的工作 shows 看社群工作 button that switches view, and empty review queue returns to 我的工作', async () => {
  const reviewEntry = makeReviewEntry('claim-1', '待審工作');
  const app = mountWorkbench({
    dashboard: { summary: { accepted_count: 0 }, now: [], next: [], review_queue: [reviewEntry], gained: [] },
    pages: [{ items: [makeWorkItem('cat-1', '社群工作甲')], next_cursor: null }],
  });
  await app.settle();

  // Empty 我的工作 shows both empty lines + secondary 看社群工作
  const treeMine = app.getTree();
  const textMine = allText(treeMine);
  assert.equal(textMine.includes('目前沒有進行中的工作。'), true);
  assert.equal(textMine.includes('接下來沒有待辦。'), true);
  const goCommunityBtn = collectNodes(treeMine, (n) => n.tag === 'button' && textOf(n) === '看社群工作')[0];
  assert.ok(goCommunityBtn, '看社群工作 button must exist when 我的工作 is empty');
  assert.match(String(goCommunityBtn.props.className ?? ''), /\bbtn-secondary\b/);

  // Review option shows count
  const pickerMine = collectNodes(treeMine, (n) => n.tag === 'select' && n.props['aria-label'] === '工作檢視')[0];
  const optionsWithReview = collectNodes(pickerMine.children, (n) => n.tag === 'option').map((o) => textOf(o));
  assert.deepEqual(optionsWithReview, ['我的工作', '社群工作', '待你回饋（1）', '我的成果']);

  // Clicking 看社群工作 switches to 社群工作
  (goCommunityBtn.props.onClick as () => void)();
  await app.settle();
  const textAfterClick = allText(app.getTree());
  assert.equal(textAfterClick.includes('其他社群工作'), true);
  assert.equal(textAfterClick.includes('現在進行'), false);

  // Switch to 待你回饋（1）
  const pickerComm = collectNodes(app.getTree(), (n) => n.tag === 'select' && n.props['aria-label'] === '工作檢視')[0];
  (pickerComm.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: 'review' } });
  await app.settle();
  const textReview = allText(app.getTree());
  assert.equal(textReview.includes('待你回饋'), true);
  assert.equal(textReview.includes('待審工作'), true);
  assert.equal(textReview.includes('現在進行'), false);

  // Simulate review queue becoming empty on reload -> view returns to 我的工作
  app.setData({
    dashboard: { summary: { accepted_count: 1 }, now: [], next: [], review_queue: [], gained: [] },
  });
  const decideForm = collectNodes(app.getTree(), (n) => n.tag === 'button' && textOf(n) === '開始回饋')[0];
  assert.ok(decideForm);
  (decideForm.props.onClick as () => void)();
  await app.settle();

  const textAfterEmptyReview = allText(app.getTree());
  assert.equal(textAfterEmptyReview.includes('現在進行'), true);
  assert.equal(textAfterEmptyReview.includes('待審工作'), false);
  const pickerAfter = collectNodes(app.getTree(), (n) => n.tag === 'select' && n.props['aria-label'] === '工作檢視')[0];
  const optionsAfter = collectNodes(pickerAfter.children, (n) => n.tag === 'option').map((o) => textOf(o));
  assert.deepEqual(optionsAfter, ['我的工作', '社群工作', '我的成果']);
});

test('I2: selected-item view (#workbench/<uuid>) stays unchanged without view picker', async () => {
  const item = makeWorkItem('11111111-1111-1111-1111-111111111111', '指定工作');
  const app = mountWorkbench({
    selectedId: '11111111-1111-1111-1111-111111111111',
    dashboard: { summary: { accepted_count: 0 }, now: [], next: [], review_queue: [], gained: [] },
    pages: [{ items: [item], next_cursor: null }],
  });
  await app.settle();
  const tree = app.getTree();
  assert.equal(allText(tree).includes('指定工作'), true);
  assert.equal(collectNodes(tree, (n) => n.tag === 'select' && n.props['aria-label'] === '工作檢視').length, 0);
});

test('I3: after + 新增工作卡 creates a card, view switches to 社群工作 and status line shows 已新增工作卡「<title>」', async () => {
  const app = mountWorkbench({
    dashboard: { summary: { accepted_count: 0 }, now: [], next: [], review_queue: [], gained: [] },
    pages: [{ items: [], next_cursor: null }],
  });
  await app.settle();

  const openBtn = collectNodes(app.getTree(), (n) => n.tag === 'button' && textOf(n) === '+ 新增工作卡')[0];
  assert.ok(openBtn, '+ 新增工作卡 button must exist');
  (openBtn.props.onClick as () => void)();
  await app.settle();

  const form = collectNodes(app.getTree(), (n) => n.tag === 'form')[0];
  assert.ok(form, 'create work form must open');
  const titleInput = collectNodes(form.children, (n) => n.tag === 'input' && !n.props.type && !n.props.inputMode)[0];
  const textareas = collectNodes(form.children, (n) => n.tag === 'textarea');
  assert.ok(titleInput && textareas.length === 3);

  (titleInput.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '  新建立的工作卡  ' } });
  (textareas[0].props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '問題說明' } });
  (textareas[1].props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '完成標準' } });
  (textareas[2].props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '實戰經驗' } });
  await app.settle();

  const latestForm = collectNodes(app.getTree(), (n) => n.tag === 'form')[0];
  await (latestForm.props.onSubmit as (e: { preventDefault: () => void }) => Promise<void>)({ preventDefault() {} });
  await app.settle();

  assert.equal(app.postCalls.some((c) => c.path === '/work-items'), true);
  const tree = app.getTree();
  const picker = collectNodes(tree, (n) => n.tag === 'select' && n.props['aria-label'] === '工作檢視')[0];
  assert.equal(picker.props.value, 'community');
  const statuses = collectNodes(tree, (n) => n.props.role === 'status').map((n) => textOf(n));
  assert.equal(statuses.includes('已新增工作卡「新建立的工作卡」'), true);
  const text = allText(tree);
  assert.equal(text.includes('其他社群工作'), true);
  assert.equal(text.includes('新建立的工作卡'), true);
});
