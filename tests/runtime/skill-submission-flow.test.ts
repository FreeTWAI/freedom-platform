import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { PortalClient, requireItems } from '../../apps/portal-web/src/api.js';
import { formatIsoLocal } from '../../apps/portal-web/src/format.js';
import { authoringDraftState, setSharingDraftAccount, sharingMutationState } from '../../apps/portal-web/src/modules/authoring-drafts.js';
import { performModuleMutation } from '../../apps/portal-web/src/modules/shared.js';
import { skillPublicationPath } from '../../apps/portal-web/src/modules/SkillPublication.js';
import * as pageDraft from '../../modules/skill-submissions/page-draft.js';
import * as pageContent from '../../modules/community/skill-page-content.js';
import * as pageFields from '../../apps/portal-web/src/modules/SkillSubmissionPageFields.js';
import * as skillUploadChat from '../../apps/portal-web/src/modules/skill-upload-chat.js';
import { agentInstruction, SKILL_UPLOAD_GUIDE } from '../../apps/portal-web/src/modules/skill-upload-instruction.js';

type VNode = { type: unknown; props: Record<string, any> };
function isVNode(value: unknown): value is VNode {
  return Boolean(value && typeof value === 'object' && 'type' in value && 'props' in value);
}
function walk(node: unknown, out: VNode[] = []): VNode[] {
  if (!node || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return out;
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
  if (isVNode(node)) {
    if (typeof node.type === 'function') { walk((node.type as (props: any) => unknown)(node.props), out); return out; }
    out.push(node);
    walk(node.props.children, out);
  }
  return out;
}
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isVNode(node)) {
    if (typeof node.type === 'function') return textOf((node.type as (props: any) => unknown)(node.props));
    return textOf(node.props.children);
  }
  return '';
}

let session = 0;
beforeEach(() => setSharingDraftAccount('owner', ++session));

function skillFlowHost(options: {
  resumeId?: string | null;
  listItems?: unknown[];
  byId?: Record<string, unknown>;
  withdrawnProjectIds?: string[];
  onPublished?: () => Promise<void>;
  grantResult?: unknown;
  keyItems?: any[];
} = {}) {
  const slots: any[] = [];
  let cursor = 0;
  let dirty = false;
  let tree: unknown = null;
  let resumeId = options.resumeId ?? null;
  let withdrawnProjectIds = options.withdrawnProjectIds ?? [];
  const effects: (() => void)[] = [];
  const copiedTexts: string[] = [];
  const intervals: (() => void)[] = [];
  const fetchCalls: { url: string; init: RequestInit }[] = [];
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useRef: (initial: unknown) => { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useState: (initial: unknown) => {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[i];
      return [slot.value, (next: unknown) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      }];
    },
    useEffect: (effect: () => undefined | (() => void), deps: unknown[]) => {
      const i = cursor++;
      const prev = slots[i];
      if (prev && same(prev.deps, deps)) return;
      const slot = { deps, cleanup: undefined as undefined | (() => void) };
      slots[i] = slot;
      effects.push(() => { prev?.cleanup?.(); slot.cleanup = effect(); });
    },
  };
  const postCalls: { path: string; body: unknown }[] = [];
  const listItems: any[] = [...(options.listItems ?? [])];
  const byId: Record<string, any> = { ...(options.byId ?? {}) };
  const keyItems: any[] = [...(options.keyItems ?? [])];
  let nextKeySeq = 2;
  const client = {
    sessionGeneration: 1,
    get: async (path: string) => {
      if (path === '/me/skill-submissions') return { items: [...listItems] };
      if (path === '/me/skill-upload-keys') return { items: [...keyItems] };
      const prefix = '/me/skill-submissions/';
      if (path.startsWith(prefix)) {
        const id = decodeURIComponent(path.slice(prefix.length));
        if (byId[id]) return byId[id];
        const found = listItems.find((item: any) => item.submission_id === id);
        if (found) return found;
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    post: async (path: string, body: unknown) => {
      postCalls.push({ path, body });
      if (path === '/me/skill-submissions') {
        const result = (options.grantResult ?? {
          submission: {
            submission_id: 'agent-draft-1',
            status: 'awaiting_upload',
            aggregate_version: 1,
            public_path: null,
            grant_expires_at: '2030-01-01T00:00:00Z',
            grant_revoked_at: null,
            created_at: '2026-11-14T00:00:00Z',
            payload: null,
          },
          upload_grant: {
            token: 'fpg_synthetic_token',
            expires_at: '2030-01-01T00:00:00Z',
            submit_url: 'https://example.test/agent-api/v1/skill-submissions/agent-draft-1',
          },
        }) as any;
        if (result?.submission && !listItems.some((item: any) => item.submission_id === result.submission.submission_id)) {
          listItems.unshift(result.submission);
        }
        return result;
      }
      if (path.endsWith('/grant')) {
        const id = path.split('/')[3];
        const existing = listItems.find((item: any) => item.submission_id === id);
        const updated = {
          ...(existing ?? { submission_id: id, status: 'awaiting_upload', public_path: null, created_at: '2026-11-14T00:00:00Z', payload: null }),
          aggregate_version: Number(existing?.aggregate_version ?? 1) + 1,
          grant_expires_at: '2030-01-01T00:00:00Z',
          grant_revoked_at: null,
        };
        const idx = listItems.findIndex((item: any) => item.submission_id === id);
        if (idx >= 0) listItems[idx] = updated;
        return {
          submission: updated,
          upload_grant: {
            token: 'fpg_rotated_token',
            expires_at: '2030-01-01T00:00:00Z',
            submit_url: `https://example.test/agent-api/v1/skill-submissions/${id}`,
          },
        };
      }
      if (path === '/me/skill-upload-keys') {
        const payload = body as { label: string; expires_in_days: number };
        const key = {
          key_id: `key-${nextKeySeq++}`,
          label: payload.label,
          scope: 'skill:submit',
          expires_at: '2030-02-01T00:00:00Z',
          revoked_at: null,
        };
        keyItems.unshift(key);
        return { key, token: 'fpk_synthetic_secret' };
      }
      if (path.startsWith('/me/skill-upload-keys/') && path.endsWith('/revoke')) {
        const id = path.split('/')[3];
        const key = keyItems.find(item => item.key_id === id);
        const revoked = { ...(key ?? { key_id: id, label: 'Key', scope: 'skill:submit', expires_at: '2030-02-01T00:00:00Z' }), revoked_at: '2026-11-14T01:00:00Z' };
        const idx = keyItems.findIndex(item => item.key_id === id);
        if (idx >= 0) keyItems[idx] = revoked;
        return revoked;
      }
      if (path.endsWith('/upgrade')) {
        const id = path.split('/')[3];
        const upgraded = {
          submission_id: `upgrade-${id}`,
          status: 'awaiting_upload',
          aggregate_version: 1,
          public_path: null,
          upgrades_submission_id: id,
          created_at: '2026-11-14T00:00:00Z',
          payload: null,
          seed: {
            repository_url: 'https://github.com/example/upgrade-target',
            title: 'Upgraded Skill',
            description: 'Existing desc',
            use_notes: 'Existing notes',
            demo_url: null,
            relationship: 'curator',
          },
        };
        listItems.unshift(upgraded);
        byId[upgraded.submission_id] = upgraded;
        return upgraded;
      }
      if (path.endsWith('/revoke')) {
        const id = path.split('/')[3];
        const idx = listItems.findIndex((item: any) => item.submission_id === id);
        const revoked = { ...(idx >= 0 ? listItems[idx] : { submission_id: id }), status: 'revoked', aggregate_version: 9, payload: null };
        if (idx >= 0) listItems[idx] = revoked;
        byId[id] = revoked;
        return revoked;
      }
      if (path.endsWith('/publish')) {
        const id = path.split('/')[3];
        return { submission_id: id, status: 'published', aggregate_version: 9, public_path: '/skills/published-1', project_id: 'proj-1', payload: null };
      }
      throw new Error(`Unexpected POST ${path}`);
    },
  } as unknown as PortalClient;
  const source = readFileSync(new URL('../../apps/portal-web/src/modules/SkillSubmission.tsx', import.meta.url), 'utf8');
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', target: 'es2023', jsx: 'automatic' }).code;
  const mod = { exports: {} as any };
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props: props ?? {} });
  runInNewContext(compiled, {
    module: mod,
    exports: mod.exports,
    AbortController,
    URL,
    fetch: async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      const id = url.split('/').pop()!;
      const parsedPayload = JSON.parse(String(init.body ?? '{}'));
      const uploaded = {
        submission_id: id,
        status: 'ready_for_review',
        can_edit: false,
        aggregate_version: 3,
        public_path: null,
        created_at: '2026-11-14T00:00:00Z',
        payload: parsedPayload,
      };
      const idx = listItems.findIndex((item: any) => item.submission_id === id);
      if (idx >= 0) listItems[idx] = uploaded;
      else listItems.unshift(uploaded);
      byId[id] = uploaded;
      return { ok: true, status: 200, json: async () => uploaded };
    },
    window: {
      location: { origin: 'https://example.test' },
      setInterval: (fn: () => void) => { intervals.push(fn); return intervals.length; },
      clearInterval: () => {},
    },
    document: { visibilityState: 'visible' },
    navigator: { clipboard: { writeText: async (text: string) => { copiedTexts.push(text); } } },
    require: (name: string) => {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === '../api') return { requireItems };
      if (name === '../format') return { formatIsoLocal: (v: string) => v };
      if (name === '../game-console-core') return { logConsoleEvent: () => {} };
      if (name === '../game-console-routing') return { consoleChannel: (c: string) => c };
      if (name === './WorkSharing.css' || name === './SkillUpload.css') return {};
      if (name === './skill-upload-instruction') return { agentInstruction, SKILL_UPLOAD_GUIDE };
      if (name === './skill-upload-chat') return skillUploadChat;
      if (name === './SkillPublication') return { skillPublicationPath, PublishedSkillLinks: () => null };
      if (name === '../../../../modules/skill-submissions/page-draft.js') return pageDraft;
      if (name === '../../../../modules/community/skill-page-content.js') return pageContent;
      if (name === './SkillSubmissionPageFields') return pageFields;
      if (name === './SkillSubmissionPagePreview') return { SkillSubmissionPagePreview: () => null };
      if (name === './authoring-drafts') return {
        authoringDraftState,
        sharingMutationState,
        useAuthoringDraft: (userId: string, key: string, initial: unknown) => {
          const draft = authoringDraftState(userId, key, initial);
          return [draft.read(), (value: unknown) => {
            const prev = draft.read();
            draft.write(value);
            if (!Object.is(prev, draft.read())) dirty = true;
          }, draft.live];
        },
      };
      if (name === './shared') return {
        useModuleMutation: (_client: PortalClient, scope: { userId: string; type: string }) => {
          const mutation = sharingMutationState(scope);
          return { ...mutation.snapshot, setError: () => {}, mutate: (path: string, body: unknown, version?: number) => performModuleMutation(client, mutation, path, body, version) };
        },
      };
      throw new Error('Unexpected dependency ' + name);
    },
  });
  function render() {
    cursor = 0;
    dirty = false;
    tree = mod.exports.SkillSubmission({ client, userId: 'owner', resumeId, withdrawnProjectIds, onPublished: options.onPublished ?? (async () => {}) });
    while (effects.length) effects.shift()!();
  }
  async function flush() {
    await new Promise<void>(resolve => setImmediate(resolve));
    let renders = 0;
    while (dirty) {
      assert(++renders < 20, 'effects must settle');
      render();
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
  function nodes() { return walk(tree); }
  return {
    render, flush, nodes, postCalls, copiedTexts, intervals, listItems, fetchCalls,
    setWithdrawnProjectIds: (ids: string[]) => { withdrawnProjectIds = ids; },
    text: () => textOf(tree),
    dispose: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function submitUrlForm(form: VNode, valid = true) {
  let prevented = false;
  const repoInput = walk(form).find(n => n.type === 'input' && n.props.name === 'repository_url');
  const fakeField = {
    value: String(repoInput?.props.value ?? ''),
    required: Boolean(repoInput?.props.required),
    setCustomValidity: () => {},
    checkValidity: () => valid,
  };
  form.props.onSubmit({
    preventDefault: () => { prevented = true; },
    nativeEvent: {},
    currentTarget: {
      querySelectorAll: () => [fakeField],
      reportValidity: () => valid,
    },
  });
  return prevented;
}

const validPage = {
  headline: '把散落的會議紀錄整理成行動清單。',
  problem: '團隊開會後常各自記筆記，無法快速確認誰負責什麼待辦事項。',
  mechanism: '讀取會議逐字稿並擷取決策與待辦事項，輸出成有條理的摘要與清單。',
  outcomes: ['整理好的會議摘要', '可指派的行動清單', '保留來源的決策紀錄'] as [string, string, string],
  flow: {
    title: '從會議筆記到行動清單',
    lead: '需先準備純文字或 Markdown 格式的會議紀錄檔案。',
    steps: [
      { icon: 'doc' as const, title: '準備輸入', note: '提供單場會議的純文字紀錄或重點筆記。' },
      { icon: 'sliders' as const, title: '執行處理', note: '擷取決策結論、行動項目與對應負責人。' },
      { icon: 'check' as const, title: '取得成果', note: '輸出可分享的摘要與行動待辦清單。' },
    ],
    caption: '操作條件與限制請一起閱讀下方的使用說明。',
  },
};

test('I1: step 1 collects repository URL (required, max 300) then step 2 offers 我自己填 or 交給我的 agent', async () => {
  const host = skillFlowHost();
  try {
    host.render();
    await host.flush();
    const repoInput = host.nodes().find(n => n.type === 'input' && n.props.name === 'repository_url');
    assert.ok(repoInput, 'step 1 renders repository_url input');
    assert.equal(repoInput.props.required, true);
    assert.equal(repoInput.props.maxLength, 300);
    assert.equal(host.text().includes('我自己填'), false);
    assert.equal(host.text().includes('用我的 Agent 上傳'), false);
    assert.equal(host.text().includes('作品名稱'), false);

    // Invalid/blank URL stays on step 1
    const form = host.nodes().find(n => n.type === 'form')!;
    submitUrlForm(form, false);
    host.render();
    assert.equal(host.text().includes('我自己填'), false);

    // Valid URL advances to step 2
    repoInput.props.onChange({ target: { value: 'https://github.com/example/skill' } });
    host.render();
    submitUrlForm(host.nodes().find(n => n.type === 'form')!, true);
    host.render();
    assert.equal(host.text().includes('我自己填'), true);
    assert.equal(host.text().includes('用我的 Agent 上傳'), true);
    assert.equal(host.text().includes('作品名稱'), false);

    // Clicking 用我的 Agent 上傳 creates a draft inside SkillSubmission and shows agentInstruction + 交給我的 Agent
    const agentBtn = host.nodes().find(n => n.type === 'button' && textOf(n).includes('用我的 Agent 上傳'));
    assert.ok(agentBtn, 'renders 用我的 Agent 上傳 button');
    await agentBtn.props.onClick();
    await host.flush();
    host.render();
    host.nodes();
    assert.equal(host.nodes().some(n => n.type === 'dialog'), false, 'does not render SkillUpload dialog');
    assert.equal(host.postCalls.some(c => c.path === '/me/skill-submissions'), true, 'posts /me/skill-submissions');
    assert.equal(host.text().includes('私人草稿'), true, 'states in one line that agent makes a private draft');
    assert.equal(host.text().includes('公開'), true, 'states member publishes here');
    const instructionBox = host.nodes().find(n => n.type === 'textarea' && n.props['data-private'] === 'true');
    assert.ok(instructionBox, 'renders private instruction textarea');
    const instr = String(instructionBox.props.value ?? '');
    assert.equal(instr.includes('POST https://example.test/agent-api/v1/skill-submissions/agent-draft-1\n'), true);
    assert.equal(instr.includes('fpg_synthetic_token'), true);
    assert.equal(instr.includes(formatIsoLocal('2030-01-01T00:00:00Z')), true);
    assert.equal(instr.includes('目標專案網址：https://github.com/example/skill\n'), true);
    const copyAgentBtns = host.nodes().filter(n => n.type === 'button' && String(n.props.className ?? '').includes('btn-primary'));
    assert.equal(copyAgentBtns.length, 1, 'has one primary button in agent step');
    assert.equal(textOf(copyAgentBtns[0]).includes('交給我的 Agent'), true);
    await copyAgentBtns[0].props.onClick();
    await host.flush();
    assert.equal(host.copiedTexts[0], instr);

    // The draft uploaded by the agent appears in the one draft list and uses the same preview + publish flow
    host.listItems[0] = {
      submission_id: 'agent-draft-1',
      status: 'ready_for_review',
      can_edit: false,
      aggregate_version: 2,
      public_path: null,
      created_at: '2026-11-14T00:00:00Z',
      payload: {
        repository_url: 'https://github.com/example/skill',
        title: 'Agent Uploaded Tool',
        description: 'Uploaded via agent grant',
        use_notes: 'Run cli',
        demo_url: null,
        relationship: 'curator',
        share_introductions: Array.from({ length: 100 }, (_, i) => `Intro line ${i + 1} for tool`),
        page_content: validPage,
      },
    };
    const refreshBtn = host.nodes().find(n => n.type === 'button' && textOf(n).includes('重新整理'));
    assert.ok(refreshBtn, 'draft list renders refresh button');
    await refreshBtn.props.onClick();
    await host.flush();
    host.render();
    const draftSection = host.nodes().find(n => n.type === 'section' && n.props['aria-label'] === '我的投稿草稿');
    assert.ok(draftSection, 'agent draft appears in the one draft list');
    assert.equal(textOf(draftSection).includes('Agent Uploaded Tool'), true);
    const previewBtn = walk(draftSection).find(n => n.type === 'button' && textOf(n).includes('預覽並公開'));
    assert.ok(previewBtn, 'ready agent draft offers 預覽並公開');
    previewBtn.props.onClick();
    host.render();
    assert.equal(host.text().includes('確認這樣分享，好嗎？'), true);
    assert.equal(host.text().includes('Agent Uploaded Tool'), true);
    const consentBox = host.nodes().find(n => n.type === 'input' && n.props.type === 'checkbox')!;
    consentBox.props.onChange({ target: { checked: true } });
    host.render();
    await host.nodes().find(n => n.type === 'form')!.props.onSubmit({ preventDefault: () => {} });
    await host.flush();
    assert.equal(host.postCalls.some(c => c.path === '/me/skill-submissions/agent-draft-1/publish'), true);

    // Resetting / starting another tool and choosing 我自己填 still works
    const againBtn = host.nodes().find(n => n.type === 'button' && textOf(n).includes('再投稿一個工具'))!;
    againBtn.props.onClick();
    host.render();
    host.nodes().find(n => n.type === 'input' && n.props.name === 'repository_url')!.props.onChange({ target: { value: 'https://github.com/example/skill' } });
    host.render();
    submitUrlForm(host.nodes().find(n => n.type === 'form')!, true);
    host.render();
    const manualBtn = host.nodes().find(n => n.type === 'button' && textOf(n).includes('我自己填'));
    assert.ok(manualBtn, 'renders 我自己填 button');
    manualBtn.props.onClick();
    host.render();
    assert.equal(host.text().includes('作品名稱'), true);
    const manualRepo = host.nodes().find(n => n.type === 'input' && n.props.name === 'repository_url');
    assert.equal(manualRepo?.props.value, 'https://github.com/example/skill');
  } finally {
    host.dispose();
  }
});

test('I1: resumeId opens a ready_for_review manual draft directly without stopping at step 1', async () => {
  const host = skillFlowHost({
    resumeId: 'draft-1',
    byId: {
      'draft-1': {
        submission_id: 'draft-1',
        status: 'ready_for_review',
        can_edit: true,
        aggregate_version: 2,
        public_path: null,
        payload: {
          repository_url: 'https://github.com/example/resumed',
          title: 'Resumed Skill',
          description: 'Resumed description',
          use_notes: 'Run step one',
          demo_url: null,
          relationship: 'curator',
          page_content_draft: pageFields.blankSkillPageFields(),
        },
      },
    },
  });
  try {
    host.render();
    await host.flush();
    assert.equal(host.text().includes('作品名稱'), true);
    const repoInput = host.nodes().find(n => n.type === 'input' && n.props.name === 'repository_url');
    assert.equal(repoInput?.props.value, 'https://github.com/example/resumed');
  } finally {
    host.dispose();
  }
});

test('I3: upgrade and seeded draft continuation happen inline in SkillSubmission agent path without SkillUpload dialog', async () => {
  const seededDraft = {
    submission_id: 'seeded-wait-1',
    status: 'awaiting_upload',
    aggregate_version: 2,
    public_path: null,
    created_at: '2026-11-14T00:00:00Z',
    payload: null,
    seed: {
      repository_url: 'https://github.com/example/seeded-repo',
      title: 'Seeded Tool',
      description: 'Saved description',
      use_notes: 'Saved notes',
      demo_url: null,
      relationship: 'curator',
    },
  };
  const host = skillFlowHost({ listItems: [seededDraft] });
  try {
    host.render();
    await host.flush();
    const continueSeedBtn = host.nodes().find(n => n.type === 'button' && n.props['aria-label'] === '繼續：升級：Seeded Tool')!;
    assert.ok(continueSeedBtn, 'renders 繼續 button for seeded draft');
    await continueSeedBtn.props.onClick();
    await host.flush();
    host.render();
    assert.equal(host.text().includes('正在補完：Seeded Tool'), true, 'opens inline agent chat target for seeded draft');
    assert.equal(host.text().includes('交給聊天 AI'), true);

    // Revoking waiting draft removes it from active draft list without SkillUpload dialog
    const revokeWaitingBtn = host.nodes().find(n => n.type === 'button' && textOf(n).includes('撤銷這份草稿'));
    assert.ok(revokeWaitingBtn, 'renders 撤銷這份草稿 for active awaiting_upload draft');
    await revokeWaitingBtn.props.onClick();
    await host.flush();
    host.render();
    assert.equal(host.postCalls.some(c => c.path === '/me/skill-submissions/seeded-wait-1/revoke'), true);
    assert.equal(host.text().includes('正在補完：Seeded Tool'), false);
  } finally {
    host.dispose();
  }
});

test('I3: resumeId on awaiting_upload opens inline agent view without POSTing a new draft', async () => {
  const awaiting = {
    submission_id: 'awaiting-resume-1',
    status: 'awaiting_upload',
    aggregate_version: 3,
    public_path: null,
    created_at: '2026-11-14T00:00:00Z',
    payload: null,
    seed: {
      repository_url: 'https://github.com/example/awaiting-repo',
      title: 'Resumed Seeded Tool',
      description: 'Saved description',
      use_notes: 'Saved notes',
      demo_url: null,
      relationship: 'curator',
    },
  };
  const host = skillFlowHost({ resumeId: 'awaiting-resume-1', listItems: [], byId: { 'awaiting-resume-1': awaiting } });
  try {
    host.render();
    await host.flush();
    host.render();
    assert.equal(host.postCalls.length, 0, 'does not POST on resumeId awaiting_upload load');
    assert.equal(host.text().includes('正在補完：Resumed Seeded Tool'), true);
    assert.equal(host.nodes().find(n => n.type === 'input' && n.props.placeholder === 'https://github.com/擁有者/儲存庫')?.props.value, 'https://github.com/example/awaiting-repo');
    const issueBtn = host.nodes().find(n => n.type === 'button' && textOf(n).includes('建立上傳指令'))!;
    await issueBtn.props.onClick();
    await host.flush();
    host.render();
    assert.equal(host.postCalls.some(c => c.path === '/me/skill-submissions/awaiting-resume-1/grant'), true, 'regrants existing draft rather than creating another');
    assert.equal(host.nodes().some(n => n.type === 'textarea' && n.props['data-private'] === 'true' && String(n.props.value ?? '').includes('fpg_rotated_token')), true);
  } finally {
    host.dispose();
  }
});

test('I2: one draft list shows all member drafts with state and one action per row across manual and agent paths', async () => {
  const items = [
    {
      submission_id: 'agent-waiting',
      status: 'awaiting_upload',
      aggregate_version: 1,
      public_path: null,
      grant_expires_at: '2099-01-01T00:00:00.000Z',
      grant_revoked_at: null,
      created_at: '2026-11-14T09:00:00.000Z',
      payload: null,
    },
    {
      submission_id: 'manual-incomplete',
      status: 'ready_for_review',
      can_edit: true,
      aggregate_version: 2,
      public_path: null,
      payload: {
        repository_url: 'https://github.com/example/incomplete',
        title: 'Incomplete Manual Draft',
        description: 'WIP',
        use_notes: '',
        demo_url: null,
        relationship: 'curator',
        page_content_draft: pageFields.blankSkillPageFields(),
      },
    },
    {
      submission_id: 'agent-ready',
      status: 'ready_for_review',
      can_edit: false,
      aggregate_version: 3,
      public_path: null,
      payload: {
        repository_url: 'https://github.com/example/agent-ready',
        title: 'Agent Ready Skill',
        description: 'Uploaded by agent',
        use_notes: 'Run cli',
        demo_url: null,
        relationship: 'curator',
        share_introductions: ['短文一'],
        page_content: validPage,
      },
    },
    {
      submission_id: 'already-published',
      status: 'published',
      aggregate_version: 4,
      public_path: '/skills/already-published',
      payload: null,
    },
    {
      submission_id: 'already-revoked',
      status: 'revoked',
      aggregate_version: 4,
      public_path: null,
      payload: null,
    },
  ];
  const host = skillFlowHost({ listItems: items });
  try {
    host.render();
    await host.flush();
    const draftSection = host.nodes().find(n => n.type === 'section' && n.props['aria-label'] === '我的投稿草稿');
    assert.ok(draftSection, 'renders visible draft list section under the flow');
    const rows = walk(draftSection).filter(n => n.type === 'li');
    assert.equal(rows.length, 3, 'lists awaiting_upload + ready_for_review drafts only');
    assert.equal(textOf(draftSection).includes('already-published'), false);

    // Each draft row has exactly one action button
    for (const row of rows) {
      const buttons = walk(row).filter(n => n.type === 'button');
      assert.equal(buttons.length, 1, 'each draft row has exactly one action button');
    }

    // Row 0: awaiting_upload -> 繼續 opens inline agent step with fresh instruction
    assert.equal(textOf(rows[0]).includes('等待 Agent 上傳'), true);
    const continueAgentBtn = walk(rows[0]).find(n => n.type === 'button')!;
    assert.equal(textOf(continueAgentBtn).includes('繼續'), true);
    await continueAgentBtn.props.onClick();
    await host.flush();
    host.render();
    assert.equal(host.postCalls.some(c => c.path === '/me/skill-submissions/agent-waiting/grant'), true);
    assert.equal(host.nodes().some(n => n.type === 'textarea' && n.props['data-private'] === 'true' && String(n.props.value ?? '').includes('fpg_rotated_token')), true);

    // Row 1: manual incomplete -> 繼續 opens manual form with draft filled
    assert.equal(textOf(rows[1]).includes('草稿未完成'), true);
    const continueManualBtn = walk(rows[1]).find(n => n.type === 'button')!;
    assert.equal(textOf(continueManualBtn).includes('繼續'), true);
    continueManualBtn.props.onClick();
    host.render();
    assert.equal(host.text().includes('作品名稱'), true);
    assert.equal(host.nodes().find(n => n.type === 'input' && n.props.name === 'repository_url')?.props.value, 'https://github.com/example/incomplete');

    // Row 2: agent-uploaded ready_for_review -> 預覽並公開 opens preview + consent + publish
    const draftSection2 = host.nodes().find(n => n.type === 'section' && n.props['aria-label'] === '我的投稿草稿');
    const row2 = walk(draftSection2).filter(n => n.type === 'li')[2];
    assert.equal(textOf(row2).includes('待預覽公開'), true);
    const previewBtn = walk(row2).find(n => n.type === 'button')!;
    assert.equal(textOf(previewBtn).includes('預覽並公開'), true);
    previewBtn.props.onClick();
    host.render();
    assert.equal(host.text().includes('Agent Ready Skill'), true);
    assert.equal(host.text().includes('修改內容'), false);
    const consentBox = host.nodes().find(n => n.type === 'input' && n.props.type === 'checkbox')!;
    consentBox.props.onChange({ target: { checked: true } });
    host.render();
    const publishForm = host.nodes().find(n => n.type === 'form')!;
    await publishForm.props.onSubmit({ preventDefault: () => {} });
    await host.flush();
    assert.equal(host.postCalls.some(c => c.path === '/me/skill-submissions/agent-ready/publish' && (c.body as any).consent_to_share === true), true);
  } finally {
    host.dispose();
  }
});

test('I3: SkillUpload.tsx is deleted, nothing mounts it, and instruction/chat helpers stay in place', () => {
  const openSourceSrc = readFileSync(new URL('../../apps/portal-web/src/modules/OpenSourcePanels.tsx', import.meta.url), 'utf8');
  const skillsPanelSrc = readFileSync(new URL('../../apps/portal-web/src/modules/SkillsPanel.tsx', import.meta.url), 'utf8');
  const skillSubSrc = readFileSync(new URL('../../apps/portal-web/src/modules/SkillSubmission.tsx', import.meta.url), 'utf8');
  const booksSrc = readFileSync(new URL('../../apps/portal-web/src/modules/CommunitySkillBooks.tsx', import.meta.url), 'utf8');
  const fixtureSrc = readFileSync(new URL('../../tests/e2e/sharing-authoring-fixture.ts', import.meta.url), 'utf8');
  assert.equal(existsSync(new URL('../../apps/portal-web/src/modules/SkillUpload.tsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../apps/portal-web/src/modules/skill-upload-instruction.ts', import.meta.url)), true);
  assert.equal(existsSync(new URL('../../apps/portal-web/src/modules/skill-upload-chat.ts', import.meta.url)), true);
  assert.equal(openSourceSrc.includes('SimpleSkillSubmission'), false);
  assert.equal(openSourceSrc.includes('SkillUpload'), false);
  assert.equal(openSourceSrc.includes('SkillSubmission'), true);
  assert.equal(skillsPanelSrc.includes('SkillUpload'), false);
  assert.equal(skillsPanelSrc.includes('投稿開源工具'), true);
  assert.equal(/\bSkillUpload\b(?!\.css)/.test(skillSubSrc), false);
  assert.equal(booksSrc.includes('SkillUpload'), false);
  assert.equal(fixtureSrc.includes('SimpleSkillSubmission'), false);
  assert.equal(fixtureSrc.includes('SkillSubmission'), true);
});

test('republishing a withdrawn project keeps the completion panel visible while withdrawnProjectIds refreshes, and clears it on a later withdrawal', async () => {
  const readyDraft = {
    submission_id: 'withdrawn-draft',
    status: 'ready_for_review',
    aggregate_version: 3,
    can_edit: true,
    project_id: 'proj-1',
    payload: {
      repository_url: 'https://github.com/example/managed-work',
      relationship: 'author',
      title: '重新整理的工具',
      description: '幫創作者把零散想法整理成合作提案。',
      use_notes: '執行工具並檢查輸出。',
      demo_url: null,
    },
  };
  let host!: ReturnType<typeof skillFlowHost>;
  let resolveRefresh!: () => void;
  const refreshPending = new Promise<void>(resolve => { resolveRefresh = resolve; });
  host = skillFlowHost({
    resumeId: 'withdrawn-draft',
    byId: { 'withdrawn-draft': readyDraft },
    listItems: [readyDraft],
    withdrawnProjectIds: ['proj-1'],
    onPublished: async () => {
      await refreshPending;
      host.setWithdrawnProjectIds([]);
      host.render();
    },
  });
  try {
    host.render();
    await host.flush();
    const consentBox = host.nodes().find(n => n.type === 'input' && n.props.type === 'checkbox')!;
    consentBox.props.onChange({ target: { checked: true } });
    host.render();
    const publishForm = host.nodes().find(n => n.type === 'form')!;
    const publishing = publishForm.props.onSubmit({ preventDefault: () => {} });
    await host.flush();
    assert.equal(host.text().includes('你的工具已分享！'), true);
    resolveRefresh();
    await publishing;
    await host.flush();
    assert.equal(host.text().includes('你的工具已分享！'), true);
    host.setWithdrawnProjectIds(['proj-1']);
    host.render();
    await host.flush();
    assert.equal(host.text().includes('你的工具已分享！'), false);
  } finally {
    host.dispose();
  }
});

test('I2 (p3-l3b): 更多 in the agent path is closed by default and provides durable upload keys and 用聊天機器人產生', async () => {
  const host = skillFlowHost({
    keyItems: [{
      key_id: 'key-1',
      label: 'Existing Key',
      scope: 'skill:submit',
      expires_at: '2030-03-01T00:00:00Z',
      revoked_at: null,
    }],
  });
  try {
    host.render();
    await host.flush();
    host.nodes().find(n => n.type === 'input' && n.props.name === 'repository_url')!
      .props.onChange({ target: { value: 'https://github.com/example/chat-skill' } });
    host.render();
    submitUrlForm(host.nodes().find(n => n.type === 'form')!, true);
    host.render();
    await host.nodes().find(n => n.type === 'button' && textOf(n).includes('用我的 Agent 上傳'))!.props.onClick();
    await host.flush();
    host.render();

    // Closed by default <details><summary>更多</summary>
    const moreDetails = host.nodes().find(n => n.type === 'details' && walk(n).some(c => c.type === 'summary' && textOf(c).trim() === '更多'));
    assert.ok(moreDetails, 'renders 更多 disclosure inside agent step');
    assert.equal(Boolean(moreDetails.props.open), false, '更多 is closed by default');

    // Opening 更多 loads keys and shows durable upload keys + 用聊天機器人產生
    moreDetails.props.onToggle?.({ currentTarget: { open: true } });
    await host.flush();
    host.render();
    assert.equal(host.text().includes('Existing Key'), true, 'lists existing durable upload keys');
    assert.equal(host.text().includes('用聊天機器人產生'), true, 'renders 用聊天機器人產生');

    // Create a durable upload key (label + expiry 1-90)
    const labelInput = host.nodes().find(n => n.type === 'input' && n.props.placeholder === '例如：我的筆電')!;
    const daysInput = host.nodes().find(n => n.type === 'input' && n.props.type === 'number')!;
    assert.equal(daysInput.props.min, 1);
    assert.equal(daysInput.props.max, 90);
    labelInput.props.onChange({ target: { value: 'My Laptop' } });
    host.render();
    host.nodes().find(n => n.type === 'input' && n.props.type === 'number')!.props.onChange({ target: { value: '14' } });
    host.render();
    const keyForm = host.nodes().find(n => n.type === 'form' && textOf(n).includes('建立金鑰'))!;
    await keyForm.props.onSubmit({ preventDefault: () => {} });
    await host.flush();
    host.render();
    const keyCreate = host.postCalls.find(c => c.path === '/me/skill-upload-keys');
    assert.ok(keyCreate, 'posts /me/skill-upload-keys');
    assert.equal((keyCreate.body as any).label, 'My Laptop');
    assert.equal((keyCreate.body as any).expires_in_days, 14);
    const keyBox = host.nodes().find(n => n.type === 'textarea' && n.props['data-private'] === 'true' && n.props.value === 'fpk_synthetic_secret');
    assert.ok(keyBox, 'shows newly issued key once');
    assert.equal(host.text().includes('My Laptop'), true, 'lists newly issued key');

    // Revoke the newly created key
    const revokeBtn = host.nodes().find(n => n.type === 'button' && n.props['aria-label'] === '撤銷金鑰：My Laptop')!;
    await revokeBtn.props.onClick();
    await host.flush();
    host.render();
    assert.equal(host.postCalls.some(c => c.path === '/me/skill-upload-keys/key-2/revoke'), true);
    assert.equal(host.nodes().some(n => n.type === 'textarea' && n.props.value === 'fpk_synthetic_secret'), false, 'clears revoked issued key');
    assert.equal(host.text().includes('已撤銷'), true, 'marks revoked key');
    assert.equal(host.text().includes('也可以只用一把 Agent 金鑰：到 自動化 → 我的 Agent 建立時勾「分享」，Agent 就能交私人草稿，也能附封面圖和分享介紹；發布仍由你按。'), true, 'shows one-key agent hint next to upload keys');
    assert.ok(host.nodes().some(n => n.type === 'a' && n.props.href === '#automation/agent' && textOf(n).includes('自動化 → 我的 Agent')), 'links one-key hint to #automation/agent');

    // Chat bot prompt + file load + upload to preview
    const chatPromptBox = host.nodes().find(n => n.type === 'textarea' && n.props.readOnly && String(n.props.value ?? '').includes('repository_url：https://github.com/example/chat-skill') && !String(n.props.value ?? '').includes('Bearer'));
    assert.ok(chatPromptBox, 'renders chatSkillInstruction prompt with repo URL and without credentials');
    const copyChatBtn = host.nodes().find(n => n.type === 'button' && textOf(n).includes('交給聊天 AI'))!;
    await copyChatBtn.props.onClick();
    await host.flush();
    assert.equal(host.copiedTexts.at(-1), chatPromptBox.props.value);

    const chatPayload = JSON.stringify({
      repository_url: 'https://github.com/example/chat-skill',
      title: 'Chat Bot Skill',
      description: 'Generated from chat reply JSON.',
      use_notes: 'Install and run.',
      demo_url: null,
      relationship: 'curator',
      page_content: validPage,
      share_introductions: Array.from({ length: 100 }, (_, i) => `Chat skill blurb ${i + 1} for team`),
    });
    const fileInput = host.nodes().find(n => n.type === 'input' && n.props.type === 'file')!;
    await fileInput.props.onChange({
      target: {
        files: [{ name: 'skill.json', type: 'application/json', size: chatPayload.length, text: async () => chatPayload }],
        value: 'skill.json',
      },
    });
    await host.flush();
    host.render();
    const chatForm = host.nodes().find(n => n.type === 'form' && textOf(n).includes('用這份 JSON 建立草稿'))!;
    await chatForm.props.onSubmit({ preventDefault: () => {} });
    await host.flush();
    host.render();
    assert.equal(host.fetchCalls.length, 1, 'posts parsed JSON to private upload URL');
    assert.equal(host.text().includes('確認這樣分享，好嗎？'), true, 'opens inline preview after chat JSON upload');
    assert.equal(host.text().includes('Chat Bot Skill'), true);
  } finally {
    host.dispose();
  }
});
