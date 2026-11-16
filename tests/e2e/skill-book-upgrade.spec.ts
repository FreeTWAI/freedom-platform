import { fillSkillPageContent, syntheticSkillPage } from './skill-page-content-fixture.js';
import { navigate, openAccountSettings } from './navigation.js';
import { test, expect, type Locator, type Page } from './fixtures.js';
import { DEMO_PASSWORD, DEMO_USERS } from '../../packages/testing/seed.js';
import { mountSharingFixture } from './sharing-authoring-fixture.js';

const GRANT = 'fsu_synthetic_grant_token_for_e2e_only';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const blurbs = Array.from({ length: 100 }, (_, index) => `第 ${index + 1} 則：這個專案幫你把重複工作整理成可重用的流程。`);

function submission(id: string, status: 'awaiting_upload' | 'ready_for_review' | 'published', extra: Record<string, unknown> = {}) {
  const ready = status !== 'awaiting_upload';
  return {
    submission_id: id, status, aggregate_version: ready ? 3 : 1,
    project_id: status === 'published' ? 'project-1' : null,
    public_path: status === 'published' ? '/development/submissions/project-1' : null,
    created_at: '2026-09-23T01:00:00Z', updated_at: '2026-09-23T01:00:00Z',
    illustration_url: ready ? `/api/v1/me/skill-submissions/${id}/illustration` : null,
    grant_expires_at: null, grant_consumed_at: ready ? '2026-09-23T01:00:00Z' : null, grant_revoked_at: null,
    payload: ready ? {
      repository_url: 'https://github.com/example/skill-demo', title: '流程整理技能', description: '讀取 README 後整理出的真實介紹。',
      use_notes: '安裝 Node.js 後執行第一個範例。', demo_url: null, relationship: 'curator', share_introductions: blurbs,
    } : null,
    seed: null, upgrades_submission_id: null, catalog_book: null,
    ...extra,
  };
}

const seed = {
  repository_url: 'https://github.com/example/seeded-book', title: '種子技能', description: '登錄時寫的介紹。',
  use_notes: '先閱讀 README。', demo_url: null, relationship: 'curator',
};

async function openAgentUpload(page: Page, repo = 'https://github.com/example/skill-demo') {
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  const backToUrl = panel.getByRole('button', { name: '返回', exact: true });
  if (await backToUrl.isVisible().catch(() => false)) await backToUrl.click();
  const backToChoice = panel.getByRole('button', { name: '返回選擇方式', exact: true });
  if (await backToChoice.isVisible().catch(() => false)) await backToChoice.click();
  const agentBtn = panel.getByRole('button', { name: '用我的 Agent 上傳', exact: true });
  if (await agentBtn.isVisible().catch(() => false)) {
    await panel.getByRole('button', { name: '修改網址', exact: true }).click();
  }
  await panel.getByLabel('GitHub 專案網址', { exact: true }).fill(repo);
  await panel.getByRole('button', { name: '下一步', exact: true }).click();
  await agentBtn.click();
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill(DEMO_USERS[0].email);
  await page.getByLabel('密碼', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '動態', exact: true })).toBeVisible({ timeout: 20_000 });
}

async function settleIllustration(container: Locator) {
  const image = container.locator('.skill-upload-illustration');
  if (await image.count() === 0) return;
  await image.evaluate(element => element instanceof HTMLImageElement && element.complete ? undefined : new Promise<void>(resolve => {
    element.addEventListener('load', () => resolve(), { once: true });
    element.addEventListener('error', () => resolve(), { once: true });
  }));
}

async function expectInView(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate(element => {
    if (!element.isConnected) return false;
    const box = element.getBoundingClientRect();
    return box.height > 0 && box.top >= -1 && box.bottom <= window.innerHeight + 1 && box.left >= -1 && box.right <= window.innerWidth + 1;
  }), 'element was not inside the viewport').toBe(true);
}

function contrastOf(element: Element) {
  const style = getComputedStyle(element);
  const read = (value: string) => {
    const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
    return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts.length > 3 ? parts[3] : 1 };
  };
  const channel = (value: number) => { const s = value / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const luminance = (color: { r: number; g: number; b: number }) => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  const background = read(style.backgroundColor), foreground = read(style.color);
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return { alpha: background.a, ratio: (lighter + 0.05) / (darker + 0.05) };
}

test('a ready draft callout opens the preview with 送出技能 already in view', async ({ page }) => {
  const ready = submission('sub-ready', 'ready_for_review');
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (route.request().method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [ready] } });
    if (route.request().method() === 'GET') return route.fulfill({ json: ready });
    return route.fulfill({ json: ready });
  });
  await login(page);
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await navigate(page, '技能書架');
    const callout = page.locator('.skill-draft-callout');
    await expect(callout).toContainText('1 份技能草稿待你送出：流程整理技能');
    await callout.getByRole('button', { name: '預覽並送出', exact: true }).click();
    await expect(page.getByRole('heading', { name: '確認這樣分享，好嗎？', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '流程整理技能', exact: true })).toBeVisible();
    await expect(page.getByText('分享短文 100 則', { exact: true })).toBeVisible();
    const publishBtn = page.getByRole('button', { name: '重試公開投稿', exact: true });
    await expect(publishBtn).toBeVisible();
    expect((await publishBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('a seeded draft is completed in chat, and a different repository does not reuse it', async ({ page }) => {
  const seeded = submission('sub-seed', 'awaiting_upload', { seed, upgrades_submission_id: 'project-seed', aggregate_version: 1 });
  const seededReady = submission('sub-seed', 'ready_for_review', { seed, upgrades_submission_id: 'project-seed' });
  const grants: string[] = [];
  const uploads: string[] = [];
  let seedUploaded = false;
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (request.method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [seeded] } });
    if (request.method() === 'GET') return route.fulfill({ json: path.endsWith('/sub-seed') ? (seedUploaded ? seededReady : seeded) : submission('sub-new', 'ready_for_review') });
    if (path === '/me/skill-submissions' && request.method() === 'POST') {
      const created = submission('sub-new', 'awaiting_upload', { aggregate_version: 1 });
      return route.fulfill({ status: 201, json: { submission: created, upload_grant: { token: GRANT, expires_at: '2099-01-01T00:00:00Z', submit_url: '/agent-api/v1/skill-submissions/sub-new' } } });
    }
    if (path.endsWith('/grant')) {
      grants.push(path);
      const id = path.split('/')[3];
      return route.fulfill({ json: { submission: { ...(id === 'sub-seed' ? seeded : submission('sub-new', 'awaiting_upload')), aggregate_version: 2 }, upload_grant: { token: GRANT, expires_at: '2099-01-01T00:00:00Z', submit_url: `/agent-api/v1/skill-submissions/${id}` } } });
    }
    if (path.endsWith('/publish')) return route.fulfill({ json: submission('sub-seed', 'published', { seed, upgrades_submission_id: 'project-seed' }) });
    return route.fulfill({ json: seeded });
  });
  await page.route('**/agent-api/v1/skill-submissions/**', async route => {
    const path = new URL(route.request().url()).pathname;
    uploads.push(path);
    const id = path.split('/').pop();
    if (id === 'sub-seed') seedUploaded = true;
    return route.fulfill({ json: id === 'sub-seed' ? seededReady : submission('sub-new', 'ready_for_review') });
  });
  await login(page);
  await navigate(page, '開源投稿');
  await openAgentUpload(page, 'https://github.com/example/other-book');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await panel.locator('details.skill-upload-cli > summary').click();
  const paste = panel.getByRole('textbox', { name: '貼上 JSON', exact: true });
  await paste.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await paste.fill(JSON.stringify({ repository_url: 'https://github.com/example/other-book', title: '另一件', page_content: syntheticSkillPage }));
  await panel.getByRole('button', { name: '用這份 JSON 建立草稿', exact: true }).click();
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0]).toContain('/sub-new');
  expect(grants.some(path => path.includes('sub-seed'))).toBe(false);

  await navigate(page, '技能書架');
  const callout = page.locator('.skill-draft-callout');
  await expect(callout).toContainText('「種子技能」需補齊 100 則分享介紹，示意圖選填；完成後由你預覽並公開。');
  await callout.getByRole('button', { name: '補上分享介紹', exact: true }).click();
  await expect(panel.getByText('正在補完：種子技能', { exact: true }).first()).toBeVisible();
  await expect(panel.getByText('升級：種子技能', { exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: '交給我的 agent', exact: true })).toBeFocused();
  await panel.locator('details.skill-upload-cli > summary').click();
  await expect(panel.getByLabel('給聊天 AI 的說明', { exact: true })).toHaveValue(/種子技能/);
  await expect(panel.getByLabel('公開儲存庫網址', { exact: true })).toHaveValue(seed.repository_url);
  await paste.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await paste.fill(JSON.stringify({ repository_url: 'https://github.com/Example/Seeded-Book', title: '種子技能', page_content: syntheticSkillPage }));
  await panel.getByRole('button', { name: '用這份 JSON 建立草稿', exact: true }).click();
  await expect.poll(() => grants.some(path => path.includes('sub-seed'))).toBe(true);
  await expect.poll(() => uploads.some(path => path.endsWith('/sub-seed'))).toBe(true);
  await expect(panel.getByRole('heading', { name: '確認這樣分享，好嗎？', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: '流程整理技能', exact: true })).toBeVisible();
  await expect(panel.getByText('送出後會取代簡易版；原本的作品連結會自動轉到完整版。', { exact: true })).toBeVisible();
  await panel.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
  await panel.getByRole('button', { name: '重試公開投稿', exact: true }).click();
  await expect(panel.getByRole('region', { name: '投稿完成', exact: true })).toContainText('已公開為社群技能書');
});

test('an agent upload while the private instruction is open opens the preview', async ({ page }) => {
  let flip = false;
  const waiting = submission('sub-poll', 'awaiting_upload');
  const ready = submission('sub-poll', 'ready_for_review');
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    const current = flip ? ready : waiting;
    if (request.method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [current] } });
    if (request.method() === 'GET') return route.fulfill({ json: current });
    if (path === '/me/skill-submissions') {
      return route.fulfill({ status: 201, json: { submission: waiting, upload_grant: { token: GRANT, expires_at: '2099-01-01T00:00:00Z', submit_url: '/agent-api/v1/skill-submissions/sub-poll' } } });
    }
    return route.fulfill({ json: current });
  });
  await login(page);
  await navigate(page, '開源投稿');
  await page.clock.install();
  await openAgentUpload(page);
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await expect(panel.getByText('尚未上傳內容').first()).toBeVisible();
  await expect(panel.getByLabel('給 Agent 的私人上傳指令', { exact: true })).toBeVisible();
  flip = true;
  await page.clock.fastForward(10_000);
  await expect(panel.getByText('Agent 已上傳「流程整理技能」，請在下方草稿預覽並公開。', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('給 Agent 的私人上傳指令', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '預覽並公開：流程整理技能', exact: true }).click();
  await expect(panel.getByRole('heading', { name: '確認這樣分享，好嗎？', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: '流程整理技能', exact: true })).toBeVisible();
});

test('a paste still reaches a seeded draft after its grant expired', async ({ page }) => {
  const seeded = submission('sub-seed', 'awaiting_upload', { seed, upgrades_submission_id: 'project-seed', aggregate_version: 4, grant_expires_at: '2020-01-01T00:00:00Z' });
  const plain = submission('sub-plain', 'awaiting_upload', { aggregate_version: 2, grant_expires_at: '2099-01-01T00:00:00Z' });
  const seededReady = submission('sub-seed', 'ready_for_review', { seed, upgrades_submission_id: 'project-seed' });
  const grants: string[] = [];
  const created: string[] = [];
  const uploads: string[] = [];
  let seedUploaded = false;
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (request.method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [seeded, plain] } });
    if (request.method() === 'GET') return route.fulfill({ json: path.endsWith('/sub-seed') ? (seedUploaded ? seededReady : seeded) : plain });
    if (request.method() === 'POST' && path === '/me/skill-submissions') { created.push(path); return route.fulfill({ status: 201, json: { submission: submission('sub-new', 'awaiting_upload'), upload_grant: { token: GRANT, expires_at: '2099-01-01T00:00:00Z', submit_url: '/agent-api/v1/skill-submissions/sub-new' } } }); }
    if (path.endsWith('/grant')) {
      grants.push(path);
      const id = path.split('/')[3];
      return route.fulfill({ json: { submission: id === 'sub-seed' ? seeded : plain, upload_grant: { token: GRANT, expires_at: '2099-01-01T00:00:00Z', submit_url: `/agent-api/v1/skill-submissions/${id}` } } });
    }
    return route.fulfill({ json: seeded });
  });
  await page.route('**/agent-api/v1/skill-submissions/**', async route => {
    uploads.push(new URL(route.request().url()).pathname);
    seedUploaded = true;
    return route.fulfill({ json: seededReady });
  });
  await login(page);
  await navigate(page, '技能書架');
  const callout = page.locator('.skill-draft-callout');
  await expect(callout).toContainText('「種子技能」需補齊 100 則分享介紹，示意圖選填；完成後由你預覽並公開。');
  await callout.getByRole('button', { name: '補上分享介紹', exact: true }).click();
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await expect(panel.getByText('正在補完：種子技能', { exact: true }).first()).toBeVisible();
  await panel.locator('details.skill-upload-cli > summary').click();
  const paste = panel.getByRole('textbox', { name: '貼上 JSON', exact: true });
  await paste.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await paste.fill(JSON.stringify({ repository_url: 'https://github.com/Example/Seeded-Book', title: '種子技能', page_content: syntheticSkillPage }));
  await panel.getByRole('button', { name: '用這份 JSON 建立草稿', exact: true }).click();
  await expect.poll(() => grants).toEqual(['/me/skill-submissions/sub-seed/grant']);
  await expect.poll(() => uploads.some(path => path.endsWith('/sub-seed'))).toBe(true);
  expect(uploads.some(path => path.endsWith('/sub-plain') || path.endsWith('/sub-new'))).toBe(false);
  expect(created).toEqual([]);
});

test('publishing the last ready draft keeps the drafts section above the agent instructions', async ({ page }) => {
  const ready = submission('sub-ready', 'ready_for_review');
  const published = submission('sub-ready', 'published');
  let sent = false;
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (request.method() === 'POST' && path.endsWith('/publish')) { sent = true; return route.fulfill({ json: published }); }
    const current = sent ? published : ready;
    if (request.method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [current] } });
    return route.fulfill({ json: current });
  });
  await login(page);
  await navigate(page, '開源投稿');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await panel.getByRole('button', { name: '預覽並公開：流程整理技能', exact: true }).click();
  await panel.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
  await panel.getByRole('button', { name: '重試公開投稿', exact: true }).click();
  const completed = panel.getByRole('region', { name: '投稿完成', exact: true });
  await expect(completed).toContainText('已公開為社群技能書');
  await expect(panel.getByRole('region', { name: '我的投稿草稿', exact: true })).toHaveCount(0);
  await expect(panel.getByLabel('給 Agent 的私人上傳指令', { exact: true })).toHaveCount(0);
});

test('completing a seeded draft keeps the target line and copy button in view', async ({ page }) => {
  const seeded = submission('sub-seed', 'awaiting_upload', { seed, upgrades_submission_id: 'project-seed' });
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (route.request().method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [seeded] } });
    if (route.request().method() === 'GET') return route.fulfill({ json: seeded });
    return route.fulfill({ json: seeded });
  });
  await login(page);
  const callout = page.locator('.skill-draft-callout');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await navigate(page, '技能書架');
    await callout.getByRole('button', { name: '補上分享介紹', exact: true }).click();
    const target = panel.getByText('正在補完：種子技能', { exact: true }).first();
    await expect(panel.getByRole('heading', { name: '交給我的 agent', exact: true })).toBeFocused();
    await expectInView(target);
    await panel.locator('details.skill-upload-cli > summary').click();
    const copy = panel.getByRole('button', { name: '交給聊天 AI', exact: true });
    await copy.scrollIntoViewIfNeeded();
    await expectInView(copy);
  }
  await page.setViewportSize({ width: 390, height: 520 });
  await navigate(page, '技能書架');
  await callout.getByRole('button', { name: '補上分享介紹', exact: true }).click();
  await expect(panel.getByRole('heading', { name: '交給我的 agent', exact: true })).toBeFocused();
  await expectInView(panel.getByText('正在補完：種子技能', { exact: true }).first());
});

test('inline preview stays unobstructed and keeps use notes readable in light and dark themes', async ({ page }) => {
  const ready = submission('sub-ready', 'ready_for_review');
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (route.request().method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [ready] } });
    return route.fulfill({ json: ready });
  });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate(page, '開源投稿');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await panel.getByRole('button', { name: '預覽並公開：流程整理技能', exact: true }).click();
  await settleIllustration(panel);
  await panel.getByText('使用說明與展示網址', { exact: true }).click();
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(panel.getByText('安裝 Node.js 後執行第一個範例。', { exact: true })).toBeVisible();
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  const submit = panel.getByRole('button', { name: '重試公開投稿', exact: true });
  await panel.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeVisible();
  const submitOnTop = await submit.evaluate(element => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === element && box.height >= 44;
  });
  expect(submitOnTop).toBe(true);
});

test('inline preview submit button fits inside a phone viewport without horizontal overflow', async ({ page }) => {
  const ready = submission('sub-ready', 'ready_for_review');
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (route.request().method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [ready] } });
    return route.fulfill({ json: ready });
  });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate(page, '開源投稿');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await panel.getByRole('button', { name: '預覽並公開：流程整理技能', exact: true }).click();
  await settleIllustration(panel);
  const submit = panel.getByRole('button', { name: '重試公開投稿', exact: true });
  await submit.scrollIntoViewIfNeeded();
  await expectInView(submit);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

const resultViewports = [{ width: 1280, height: 800 }, { width: 390, height: 844 }];

test('publish, revoke, and chat upload show their results inside SkillSubmission', async ({ page }) => {
  const ready = submission('sub-ready', 'ready_for_review');
  const waiting = submission('sub-waiting', 'awaiting_upload', { aggregate_version: 2 });
  const published = submission('sub-ready', 'published');
  const revoked = submission('sub-waiting', 'awaiting_upload', { status: 'revoked', aggregate_version: 3 });
  const chatReady = submission('sub-chat', 'ready_for_review');
  let publishedSent = false;
  let revokedSent = false;
  let uploaded = false;
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (request.method() === 'POST' && path.endsWith('/publish')) { publishedSent = true; return route.fulfill({ json: published }); }
    if (request.method() === 'POST' && path.endsWith('/revoke')) { revokedSent = true; return route.fulfill({ json: revoked }); }
    if (request.method() === 'POST' && path === '/me/skill-submissions') {
      const created = submission('sub-chat', 'awaiting_upload', { aggregate_version: 1 });
      return route.fulfill({ status: 201, json: { submission: created, upload_grant: { token: GRANT, expires_at: '2099-01-01T00:00:00Z', submit_url: '/agent-api/v1/skill-submissions/sub-chat' } } });
    }
    if (request.method() === 'POST' && path.endsWith('/grant')) {
      const target = path.includes('/sub-chat/') ? submission('sub-chat', 'awaiting_upload', { aggregate_version: 1 }) : waiting;
      return route.fulfill({ json: { submission: target, upload_grant: { token: GRANT, expires_at: '2099-01-01T00:00:00Z', submit_url: `/agent-api/v1/skill-submissions/${target.submission_id}` } } });
    }
    if (request.method() === 'GET' && path === '/me/skill-submissions') {
      if (uploaded) return route.fulfill({ json: { items: [chatReady] } });
      if (publishedSent) return route.fulfill({ json: { items: [published] } });
      if (revokedSent) return route.fulfill({ json: { items: [ready] } });
      return route.fulfill({ json: { items: [ready, waiting] } });
    }
    if (path.endsWith('/sub-chat')) return route.fulfill({ json: chatReady });
    if (path.endsWith('/sub-waiting')) return route.fulfill({ json: uploaded ? chatReady : revokedSent ? revoked : waiting });
    return route.fulfill({ json: publishedSent ? published : ready });
  });
  await page.route('**/agent-api/v1/skill-submissions/**', async route => {
    uploaded = true;
    return route.fulfill({ json: chatReady });
  });
  await login(page);
  for (const viewport of resultViewports) {
    publishedSent = false; revokedSent = false; uploaded = false;
    await page.setViewportSize(viewport);
    if (viewport !== resultViewports[0]) await page.reload();
    await navigate(page, '技能書架');
    await navigate(page, '開源投稿');
    const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
    await panel.getByRole('button', { name: '預覽並公開：流程整理技能', exact: true }).click();
    await settleIllustration(panel);
    await panel.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
    await panel.getByRole('button', { name: '重試公開投稿', exact: true }).click();
    await expectInView(panel.getByRole('region', { name: '投稿完成', exact: true }).getByText('已公開為社群技能書', { exact: false }));
    await expect(panel.getByRole('alert')).toHaveCount(0);

    publishedSent = false; revokedSent = false; uploaded = false;
    await navigate(page, '技能書架');
    await navigate(page, '開源投稿');
    await panel.getByRole('button', { name: '繼續：尚未上傳內容', exact: true }).click();
    await panel.getByRole('button', { name: '撤銷這份草稿', exact: true }).click();
    await expectInView(panel.getByText('草稿已撤銷，憑證無法再上傳。', { exact: true }));
    await expect(panel.getByRole('alert')).toHaveCount(0);

    publishedSent = false; revokedSent = false; uploaded = false;
    await navigate(page, '技能書架');
    await navigate(page, '開源投稿');
    await openAgentUpload(page);
    await panel.locator('details.skill-upload-cli > summary').click();
    const paste = panel.getByRole('textbox', { name: '貼上 JSON', exact: true });
    await paste.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await paste.fill(JSON.stringify({ repository_url: 'https://github.com/example/skill-demo', title: '流程整理技能', page_content: syntheticSkillPage }));
    await panel.getByRole('button', { name: '用這份 JSON 建立草稿', exact: true }).click();
    await expectInView(panel.getByRole('heading', { name: '確認這樣分享，好嗎？', exact: true }));
    await expect(panel.getByRole('heading', { name: '流程整理技能', exact: true })).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
  }
});

test('the skill shelf and open-source page keep shelf typography consistent without the old dialog', async ({ page }) => {
  await login(page);
  for (const viewport of resultViewports) {
    await page.setViewportSize(viewport);
    await navigate(page, '技能書架');
    await expect(page.getByRole('heading', { name: '公會指定技能書', level: 2, exact: true })).toHaveCSS('font-size', '18px');
    await expect(page.getByRole('heading', { name: '社群技能書', level: 2, exact: true })).toHaveCSS('font-size', '18px');
    const guide = page.locator('details.skills-guide');
    if (!await guide.evaluate(element => (element as HTMLDetailsElement).open)) await guide.locator(':scope > summary').click();
    for (const index of [0, 1]) {
      await expect(guide.locator('p.muted').nth(index)).toHaveCSS('font-size', '14px');
    }
    await expect(page.getByRole('button', { name: '上傳技能', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '投稿開源工具', exact: true }).click();
    await openAgentUpload(page);
    const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
    await expect(panel.getByRole('heading', { name: '交給我的 agent', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await navigate(page, '技能書架');
    await expect(page.getByRole('heading', { name: '公會指定技能書', level: 2, exact: true })).toHaveCSS('font-size', '18px');
    await expect(page.getByRole('heading', { name: '社群技能書', level: 2, exact: true })).toHaveCSS('font-size', '18px');
  }
});

test('member card headings keep their margin outside the upload dialog', async ({ page }) => {
  await login(page);
  await navigate(page, '我的名片');
  await openAccountSettings(page, '查看目前的會員名片');
  const heading = page.locator('.account-panel .member-card-body h4').first();
  await expect(heading).toBeVisible();
  await expect(heading).toHaveCSS('margin-top', '0px');
  await navigate(page, 'AI 製作銷售網站');
  await expect(page.getByRole('heading', { name: '挑選這次想賣的商品', exact: true })).toBeVisible();
  const photo = page.locator('.shop-product img');
  if (await photo.count()) await expect(photo.first()).toHaveCSS('object-fit', 'contain');
});

test('a loading draft refresh stays readable and distinctly disabled', async ({ page }) => {
  const ready = submission('sub-ready', 'ready_for_review');
  let gate: Promise<void> | null = null;
  let release = () => {};
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (route.request().method() === 'GET' && path === '/me/skill-submissions') {
      if (gate) await gate;
      return route.fulfill({ json: { items: [ready] } });
    }
    return route.fallback();
  });
  await login(page);
  await navigate(page, '開源投稿');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  const refresh = panel.getByRole('button', { name: '重新整理', exact: true });
  await expect(refresh).toBeEnabled();
  gate = new Promise(resolve => { release = resolve; });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveCSS('opacity', '1');
  await expect(refresh).toHaveCSS('border-style', 'dashed');
  await expect(refresh).toHaveCSS('cursor', 'not-allowed');
  const disabled=await refresh.evaluate(element=>{
    let clicks=0;const count=()=>{clicks++;};element.addEventListener('click',count);(element as HTMLButtonElement).click();element.removeEventListener('click',count);
    const style=getComputedStyle(element);
    const lum=(rgb:string)=>{const parts=rgb.match(/[\d.]+/g)!.map(Number);if(parts.length>3&&parts[3]!==1)throw Error('Expected opaque disabled colors');const v=parts.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
    const a=lum(style.color),b=lum(style.backgroundColor);return {clicks,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),height:element.getBoundingClientRect().height};
  });
  expect(disabled.clicks).toBe(0);expect(disabled.contrast).toBeGreaterThanOrEqual(4.5);expect(disabled.height).toBeGreaterThanOrEqual(44);
  release();
  gate = null;
  await expect(refresh).toBeEnabled();
});

test('a phone shows a publish conflict in SkillSubmission', async ({ page }) => {
  const ready = submission('sub-ready', 'ready_for_review');
  const problem = { title: '草稿已變更', detail: '這份草稿已在別處更新，請重新整理後再送出。' };
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (request.method() === 'POST' && path.endsWith('/publish')) return route.fulfill({ status: 409, contentType: 'application/problem+json', json: problem });
    if (request.method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [ready] } });
    return route.fulfill({ json: ready });
  });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate(page, '開源投稿');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await panel.getByRole('button', { name: '預覽並公開：流程整理技能', exact: true }).click();
  await settleIllustration(panel);
  await panel.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
  await panel.getByRole('button', { name: '重試公開投稿', exact: true }).click();
  const alert = panel.getByRole('alert');
  await expect(alert).toHaveText(`${problem.title}：${problem.detail}`);
  await expect(alert).toHaveClass('banner banner-error');
  await alert.scrollIntoViewIfNeeded();
  await expectInView(alert);
  await expect(panel.getByRole('region', { name: '投稿完成', exact: true })).toHaveCount(0);
});

test('handing a seeded draft to an agent brings the instruction into view', async ({ page }) => {
  const seeded = submission('sub-seed', 'awaiting_upload', { seed, upgrades_submission_id: 'project-seed' });
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (request.method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [seeded] } });
    if (request.method() === 'GET') return route.fulfill({ json: seeded });
    if (path.endsWith('/grant')) return route.fulfill({ json: { submission: { ...seeded, aggregate_version: 2 }, upload_grant: { token: GRANT, expires_at: '2099-01-01T00:00:00Z', submit_url: '/agent-api/v1/skill-submissions/sub-seed' } } });
    return route.fulfill({ json: seeded });
  });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate(page, '開源投稿');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await panel.getByRole('button', { name: '繼續：升級：種子技能', exact: true }).click();
  await panel.getByRole('button', { name: '建立上傳指令', exact: true }).click();
  const instruction = panel.getByLabel('給 Agent 的私人上傳指令', { exact: true });
  const copy = panel.getByRole('button', { name: '交給我的 Agent', exact: true });
  await expect(instruction).toBeVisible();
  await expect(copy).toBeVisible();
  await copy.scrollIntoViewIfNeeded();
  await expectInView(copy);
});

for (const theme of ['light', 'dark', 'versefolk'] as const) {
  test(`draft callout and preview publish action stay opaque in ${theme}`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('freedom-theme', value), theme);
    const ready = submission('sub-ready', 'ready_for_review');
    await page.route('**/api/v1/me/skill-submissions**', async route => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (route.request().method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [ready] } });
      return route.fulfill({ json: ready });
    });
    await login(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await navigate(page, '技能書架');
    const callout = page.locator('.skill-draft-callout');
    await expect(callout).toBeVisible();
    const calloutContrast = await callout.evaluate(contrastOf);
    expect(calloutContrast.alpha).toBe(1);
    expect(calloutContrast.ratio).toBeGreaterThanOrEqual(4.5);
    await navigate(page, '開源投稿');
    const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
    await panel.getByRole('button', { name: '預覽並公開：流程整理技能', exact: true }).click();
    await panel.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
    const submitBtn = panel.getByRole('button', { name: '重試公開投稿', exact: true });
    await expect(submitBtn).toBeVisible();
    const submitContrast = await submitBtn.evaluate(contrastOf);
    expect(submitContrast.alpha).toBe(1);
    expect(submitContrast.ratio).toBeGreaterThanOrEqual(4.5);
  });
}

function fullBook(title: string) {
  const blurbs = Array.from({ length: 100 }, (_, index) => `第 ${index + 1} 則：${title} 把重複工作整理成可重用的流程。`);
  return JSON.stringify({
    repository_url: 'https://github.com/freetwai-test/simple-work',
    title,
    description: '讀取 README 後整理出的完整介紹。',
    use_notes: '安裝後先閱讀 README，再執行第一個範例。',
    demo_url: null,
    relationship: 'curator',
    share_introductions: blurbs, page_content: syntheticSkillPage,
  });
}

async function publishSimple(page: Page, title: string) {
  await navigate(page, '開源投稿');
  await expect(page.getByRole('button', { name: '上傳技能', exact: true })).toHaveCount(0);
  await page.getByLabel('GitHub 專案網址', { exact: true }).fill('https://github.com/freetwai-test/simple-work');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '我自己填', exact: true }).click();
  await page.getByLabel('作品名稱', { exact: true }).fill(title);
  await page.getByLabel('一句話介紹', { exact: true }).fill('幫創作者把零散想法整理成合作提案。');
  await fillSkillPageContent(page);
  await page.getByRole('button', { name: '預覽投稿', exact: true }).click();
  await page.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
  await page.getByRole('button', { name: '確認並公開', exact: true }).click();
  const completed = page.getByRole('region', { name: '投稿完成' });
  await expect(completed).toBeVisible();
  const path = await completed.getByRole('link', { name: '閱讀已公開技能書 ↗' }).getAttribute('href');
  await expect(completed.getByRole('link', { name: '前往技能書架', exact: true })).toHaveAttribute('href', '/#skills');
  await expect(completed).toContainText('已公開為社群技能書');
  return { completed, path: path! };
}

test('the simple form upgrades into a full skill book and the old link follows it', async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().repeatEachIndex}`;
  const simpleTitle = `簡易工具 ${stamp}`;
  const fullTitle = `完整技能書 ${stamp}`;
  await login(page);
  const { completed, path } = await publishSimple(page, simpleTitle);
  await expect(completed).toContainText('這本技能書已可使用。可再補上 100 則分享介紹，示意圖選填；新版公開前，現在的版本保持不變。');
  await expect(page.getByRole('button', { name: '上傳技能', exact: true })).toHaveCount(0);
  await completed.getByRole('button', { name: '補充分享介紹（示意圖選填）', exact: true }).click();
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await expect(panel.getByText(`正在補完：${simpleTitle}`, { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole('heading', { name: '交給我的 agent', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: '上傳技能', exact: true })).toHaveCount(0);
  await panel.locator('details.skill-upload-cli > summary').click();
  const paste = panel.getByRole('textbox', { name: '貼上 JSON', exact: true });
  await paste.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await paste.fill(fullBook(fullTitle));
  await panel.getByRole('button', { name: '用這份 JSON 建立草稿', exact: true }).click();
  await expect(panel.getByRole('heading', { name: '確認這樣分享，好嗎？', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: fullTitle, exact: true })).toBeVisible();
  await expect(panel.getByText('送出後會取代簡易版；原本的作品連結會自動轉到完整版。', { exact: true })).toBeVisible();
  await panel.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
  await panel.getByRole('button', { name: '重試公開投稿', exact: true }).click();
  await expect(panel.getByRole('region', { name: '投稿完成', exact: true })).toContainText('已公開為社群技能書');
  await navigate(page, '技能書架');
  const library = page.locator('.community-skill-library');
  await expect(library.getByRole('heading', { name: fullTitle, exact: true })).toBeVisible();
  await expect(library.getByRole('heading', { name: simpleTitle, exact: true })).toHaveCount(0);
  const redirected = await page.request.get(`${path}?intro=7`, { maxRedirects: 0 });
  expect(redirected.status()).toBe(302);
  const location = redirected.headers().location ?? '';
  expect(location).toContain('?intro=7');
  expect(location).not.toContain(path);
  await page.goto(path!);
  await expect(page.getByText(fullTitle).first()).toBeVisible();
  expect(new URL(page.url()).pathname).not.toBe(path);
});

test('the shelf callout upgrades a published simple submission into a new draft', async ({ page }) => {
  const stamp = `${Date.now()}-${test.info().repeatEachIndex}`;
  const title = `簡易書架 ${stamp}`;
  await login(page);
  await publishSimple(page, title);
  await navigate(page, '技能書架');
  const callout = page.locator('.skill-draft-callout');
  await expect(callout).toContainText(`「${title}」已公開為社群技能書。可再補充 100 則分享介紹，示意圖選填。`);
  const upgrading=page.waitForResponse(response=>response.request().method()==='POST'&&/\/api\/v1\/me\/skill-submissions\/[^/]+\/upgrade$/.test(new URL(response.url()).pathname));
  await callout.getByRole('button', { name: '補充分享介紹', exact: true }).click();
  const upgraded=await upgrading;expect(upgraded.status()).toBe(201);await upgraded.finished();
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await expect(panel.getByText(`正在補完：${title}`, { exact: true }).first()).toBeVisible();
  await expect(panel.getByText(`升級：${title}`, { exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: '交給我的 agent', exact: true })).toBeFocused();
  await panel.getByRole('button', { name: '撤銷這份草稿', exact: true }).click();
  await expect(panel.getByText('草稿已撤銷，憑證無法再上傳。', { exact: true })).toBeVisible();
});

// Real authoring components and stores; deferred synthetic transport isolates
// navigation/mutation ordering without claiming database/publication evidence.
const skillFixture = <T,>(page: Page, run: (fixture: any) => T) => page.evaluate(
  source => new Function('f', 'return (' + source + ')(f)')((window as any).sharingFixture), run.toString(),
);
function manualResumeItem(id: string, title: string) {
  return {
    submission_id: id, status: 'ready_for_review', can_edit: true, aggregate_version: 7, public_path: null,
    payload: { repository_url: 'https://github.com/synthetic/repo', title, description: 'Saved description', use_notes: 'Saved notes', demo_url: null, relationship: 'curator' },
  };
}
async function resolveManualResume(page: Page, index: number, id: string, title: string) {
  await page.evaluate(({ index, item }) => (window as any).sharingFixture.resolveRead(index, item), { index, item: manualResumeItem(id, title) });
}
async function requestManualResume(page: Page, id: string) {
  await page.evaluate(id => { const fixture = (window as any).sharingFixture; fixture.deferReads(true); fixture.resume(id); }, id);
}

test('private submission resume waits through create and publication across remount and uses the newest URL', async ({ page }) => {
  await mountSharingFixture(page, 'resume');
  await page.getByLabel('GitHub 專案網址', { exact: true }).fill('https://github.com/synthetic/repo');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '我自己填', exact: true }).click();
  await page.getByLabel('作品名稱', { exact: true }).fill('Original operation');
  await page.getByLabel('一句話介紹', { exact: true }).fill('Original description');
  await fillSkillPageContent(page);
  await page.getByRole('button', { name: '預覽投稿', exact: true }).click();
  await page.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
  await page.getByRole('button', { name: '確認並公開', exact: true }).click();
  await requestManualResume(page, 'next-draft');
  await expect(page.getByRole('region', { name: '載入私人投稿' })).toBeVisible();
  expect(await skillFixture(page, f => f.pendingReads.length)).toBe(0);
  await page.getByRole('button', { name: 'Toggle form', exact: true }).click();
  await page.getByRole('button', { name: 'Toggle form', exact: true }).click();
  expect(await skillFixture(page, f => f.pendingReads.length)).toBe(0);
  await skillFixture(page, f => f.resolve(0, { submission_id: 'original-draft', status: 'ready_for_review', can_edit: true, aggregate_version: 3, public_path: null, payload: f.calls[0].body }));
  await expect.poll(() => skillFixture(page, f => f.calls.length)).toBe(2);
  expect(await skillFixture(page, f => ({ path: f.calls[1].path, version: f.calls[1].options.ifMatch, reads: f.pendingReads.length }))).toEqual({ path: '/me/skill-submissions/original-draft/publish', version: 3, reads: 0 });
  await requestManualResume(page, 'newest-draft');
  expect(await skillFixture(page, f => f.pendingReads.length)).toBe(0);
  await skillFixture(page, f => f.resolve(1, { submission_id: 'original-draft', status: 'published', aggregate_version: 4, public_path: '/development/submissions/10000000-0000-4000-8000-000000000098' }));
  await expect.poll(() => skillFixture(page, f => f.pendingReads.map((read: { path: string }) => read.path))).toEqual(['/me/skill-submissions/newest-draft']);
  await resolveManualResume(page, 0, 'newest-draft', 'Newest saved draft');
  await expect(page.getByRole('heading', { name: 'Newest saved draft', exact: true })).toBeVisible();
  expect(await skillFixture(page, f => f.readDraft('skill:saved').submission_id)).toBe('newest-draft');
});

test('private submission consumed resume preserves unknown retry identity CAS and canonical success', async ({ page }) => {
  await mountSharingFixture(page, 'resume');
  await requestManualResume(page, 'saved-draft');
  await expect.poll(() => skillFixture(page, f => f.pendingReads.length)).toBe(1);
  await resolveManualResume(page, 0, 'saved-draft', 'Saved draft');
  await page.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
  await page.getByRole('button', { name: '重試公開投稿', exact: true }).click();
  await skillFixture(page, f => f.reject(0));
  await expect(page.getByRole('button', { name: '重試公開投稿', exact: true })).toBeEnabled();
  expect(await skillFixture(page, f => f.pendingReads.length)).toBe(1);
  await expect(page.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '重試公開投稿', exact: true }).click();
  expect(await skillFixture(page, f => JSON.stringify(f.calls[0]) === JSON.stringify(f.calls[1]))).toBe(true);
  expect(await skillFixture(page, f => f.calls[1].options.ifMatch)).toBe(7);
  await skillFixture(page, f => f.resolve(1, { submission_id: 'saved-draft', status: 'published', aggregate_version: 8, public_path: '/development/submissions/10000000-0000-4000-8000-000000000099' }));
  await expect(page.getByRole('region', { name: '投稿完成' })).toBeVisible();
  await expect(page.getByRole('link', { name: '閱讀已公開技能書 ↗' })).toHaveAttribute('href', '/development/submissions/10000000-0000-4000-8000-000000000099');
  expect(await skillFixture(page, f => f.pendingReads.length)).toBe(1);
});

for (const operation of ['revoke', 'upgrade'] as const) {
  test(`private submission resume waits for ${operation} before applying the requested draft`, async ({ page }) => {
    await mountSharingFixture(page, 'resume');
    await requestManualResume(page, 'saved-draft');
    await expect.poll(() => skillFixture(page, f => f.pendingReads.length)).toBe(1);
    await resolveManualResume(page, 0, 'saved-draft', 'Saved draft');
    if (operation === 'upgrade') {
      await page.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
      await page.getByRole('button', { name: '重試公開投稿', exact: true }).click();
      await skillFixture(page, f => f.resolve(0, { submission_id: 'saved-draft', status: 'published', aggregate_version: 8, public_path: '/development/submissions/10000000-0000-4000-8000-000000000099' }));
      await page.getByRole('button', { name: '補充分享介紹（示意圖選填）', exact: true }).click();
    } else await page.getByRole('button', { name: '撤銷這份私人投稿', exact: true }).click();
    await requestManualResume(page, 'next-draft');
    await expect(page.getByRole('region', { name: '載入私人投稿' })).toBeVisible();
    expect(await skillFixture(page, f => f.pendingReads.length)).toBe(1);
    await skillFixture(page, f => f.resolve(f.calls.length - 1, { submission_id: 'operation-result', status: 'awaiting_upload', aggregate_version: 9 }));
    await expect.poll(() => skillFixture(page, f => f.pendingReads.length)).toBe(2);
    await resolveManualResume(page, 1, 'next-draft', 'Next saved draft');
    await expect(page.getByRole('heading', { name: 'Next saved draft', exact: true })).toBeVisible();
    expect(await skillFixture(page, f => f.readDraft('skill:saved').submission_id)).toBe('next-draft');
  });
}

for (const scope of ['skill', 'skill:upgrade']) {
  test(`private submission late resume response is fenced when ${scope} begins before it arrives`, async ({ page }) => {
    await mountSharingFixture(page, 'resume');
    await page.getByLabel('GitHub 專案網址', { exact: true }).fill('https://github.com/synthetic/repo');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: '我自己填', exact: true }).click();
    await page.getByLabel('作品名稱', { exact: true }).fill('Keep local input');
    await requestManualResume(page, 'next-draft');
    await expect.poll(() => skillFixture(page, f => f.pendingReads.length)).toBe(1);
    // Begin the real shared mutation and resolve the old read in one browser
    // turn, without relying on a completed render/effect cleanup to fence it.
    await page.evaluate(({ scope, item }) => {
      const fixture = (window as any).sharingFixture;
      fixture.startSkillMutation(scope);
      fixture.resolveRead(0, item);
    }, { scope, item: manualResumeItem('next-draft', 'Stale pre-operation draft') });
    await expect(page.getByRole('region', { name: '載入私人投稿' })).toBeVisible();
    expect(await skillFixture(page, f => f.readDraft('skill:draft').title)).toBe('Keep local input');
    expect(await skillFixture(page, f => f.readDraft('skill:saved'))).toBeNull();
    await skillFixture(page, f => f.resolve(0, { complete: true }));
    await expect.poll(() => skillFixture(page, f => f.pendingReads.length)).toBe(2);
    await resolveManualResume(page, 1, 'next-draft', 'Fresh post-operation draft');
    await expect(page.getByRole('heading', { name: 'Fresh post-operation draft', exact: true })).toBeVisible();
    await expect(page.getByText('Stale pre-operation draft', { exact: true })).toHaveCount(0);
  });
}
