import { syntheticSkillPage } from './skill-page-content-fixture.js';
import { navigate } from './navigation.js';
import { test, expect, type Page, type Request } from './fixtures.js';

// Synthetic credentials only; the browser endpoints are mocked so no real grant is minted.
const GRANT = 'fsu_synthetic_grant_token_for_e2e_only';
const KEY = 'fsk_synthetic_cli_key_for_e2e_only';
const blurbs = Array.from({ length: 100 }, (_, index) => `第 ${index + 1} 則：這個專案幫你把重複工作整理成可重用的流程。`);
type Status = 'awaiting_upload' | 'ready_for_review' | 'published' | 'revoked';
type Recorded = { method: string; path: string; headers: Record<string, string>; body: unknown };

function submission(id: string, status: Status, version: number, withPayload = false) {
  return {
    submission_id: id, status, aggregate_version: version, project_id: status === 'published' ? 'project-1' : null,
    public_path: status === 'published' ? '/opensource' : null, created_at: '2026-09-23T01:00:00Z', updated_at: '2026-09-23T01:00:00Z',
    illustration_url: withPayload ? `/api/v1/me/skill-submissions/${id}/illustration` : null,
    grant_expires_at: status === 'awaiting_upload' ? new Date(Date.now() + 60 * 60_000).toISOString() : null,
    grant_consumed_at: withPayload ? '2026-09-23T01:00:00Z' : null,
    grant_revoked_at: status === 'revoked' ? '2026-09-23T01:00:00Z' : null,
    payload: withPayload ? {
      repository_url: 'https://github.com/example/skill-demo', title: '流程整理技能', description: '讀取 README 後整理出的真實介紹。',
      use_notes: '安裝 Node.js 後執行第一個範例。', demo_url: 'javascript:alert(1)', relationship: 'maintainer', share_introductions: blurbs, page_content: syntheticSkillPage,
    } : null,
  };
}

async function mockUploads(page: Page, options: { grant?: (path: string) => Record<string, string> | undefined } = {}) {
  const requests: Recorded[] = [];
  const items = new Map([
    ['sub-ready', submission('sub-ready', 'ready_for_review', 3, true)],
    ['sub-waiting', submission('sub-waiting', 'awaiting_upload', 2)],
    ['sub-revoked', submission('sub-revoked', 'revoked', 5)],
  ]);
  const keys = [{ key_id: 'key-old', label: '舊筆電', scope: 'skill:submit', expires_at: new Date(Date.now() + 40 * 86_400_000).toISOString(), revoked_at: null as string | null }];
  let keyFailures = 1;
  const grant = options.grant ?? (() => ({ token: GRANT, expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), submit_url: '/agent-api/v1/skill-submissions/sub-new' }));
  const record = (request: Request) => {
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    requests.push({ method: request.method(), path, headers: request.headers(), body: request.postDataJSON() });
    return path;
  };
  await page.route('**/api/v1/me/skill-submissions**', async route => {
    const request = route.request(), path = record(request), id = path.split('/')[3];
    if (path.endsWith('/illustration')) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
    if (request.method() === 'GET' && path === '/me/skill-submissions') return route.fulfill({ json: { items: [...items.values()] } });
    if (request.method() === 'GET') return route.fulfill({ json: items.get(id) });
    if (path === '/me/skill-submissions') {
      const created = submission('sub-new', 'awaiting_upload', 1); items.set(created.submission_id, created);
      return route.fulfill({ status: 201, json: { submission: created, upload_grant: grant(path) } });
    }
    const current = items.get(id)!, action = path.split('/')[4];
    const next = { ...current, aggregate_version: current.aggregate_version + 1, status: action === 'revoke' ? 'revoked' : action === 'publish' ? 'published' : current.status } as ReturnType<typeof submission>;
    if (action === 'publish') Object.assign(next, { project_id: 'project-1', public_path: '/opensource' });
    items.set(id, next);
    return route.fulfill({ json: action === 'grant' ? { submission: next, upload_grant: grant(path) } : next });
  });
  await page.route('**/api/v1/me/skill-upload-keys**', async route => {
    const request = route.request(), path = record(request);
    if (request.method() === 'GET') return route.fulfill({ json: { items: keys } });
    if (path.endsWith('/revoke')) { keys[0].revoked_at = '2026-09-23T02:00:00Z'; items.get('sub-waiting')!.grant_revoked_at = '2026-09-23T02:00:00Z'; return route.fulfill({ json: keys[0] }); }
    if (keyFailures-- > 0) return route.fulfill({ status: 403, json: { title: '需要重新確認', detail: '請重新登入後再建立金鑰。' } });
    const body = request.postDataJSON() as { label: string; expires_in_days: number };
    const key = { key_id: 'key-new', label: body.label, scope: 'skill:submit', expires_at: new Date(Date.now() + body.expires_in_days * 86_400_000).toISOString(), revoked_at: null };
    keys.unshift(key);
    return route.fulfill({ status: 201, json: { key, token: KEY } });
  });
  return requests;
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill('maker@local.test');
  await page.getByLabel('密碼', { exact: true }).fill('freedom-local-demo');
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST'),
    page.getByRole('button', { name: '登入', exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(page.getByLabel('電子郵件', { exact: true })).toHaveCount(0);
}

async function openAgentUpload(page: Page, repo = 'https://github.com/example/skill-demo') {
  await page.getByLabel('GitHub 專案網址', { exact: true }).fill(repo);
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  const trigger = page.getByRole('button', { name: '用我的 Agent 上傳', exact: true });
  await trigger.click();
  return trigger;
}

async function expectNoStoredSecret(page: Page, secret: string) {
  const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, location.href]));
  expect(stored).not.toContain(secret);
}

test('skill shelf issues a private scoped Agent instruction only on request and drops it when leaving', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const logs: string[] = []; page.on('console', message => logs.push(message.text()));
  const requests = await mockUploads(page);
  await login(page); await navigate(page, '技能書架');
  await expect(page.getByRole('button', { name: '上傳技能', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '投稿開源工具', exact: true }).click();
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  expect(requests.filter(request => request.method === 'POST')).toEqual([]);
  await expect(panel.locator('textarea[data-private]')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '用我的 Agent 上傳', exact: true })).toHaveCount(0);

  await openAgentUpload(page);
  const instruction = panel.getByLabel('給 Agent 的私人上傳指令', { exact: true });
  await expect(instruction).toBeVisible();
  await expect(panel.locator('details.skill-upload-cli')).not.toHaveAttribute('open');
  await expect(panel.getByText('Agent 只會上傳一份私人草稿，回到這裡預覽並確認後才會公開。', { exact: true })).toBeVisible();
  const create = requests.find(request => request.method === 'POST' && request.path === '/me/skill-submissions')!;
  expect(create.headers['x-csrf-token']).toBeTruthy();
  expect(create.headers['idempotency-key']).toBeTruthy();
  expect(create.body).toEqual({});

  const origin = new URL(page.url()).origin, text = await instruction.inputValue();
  expect(text).toContain(`POST ${origin}/agent-api/v1/skill-submissions/sub-new\nAuthorization: Bearer ${GRANT}`);
  expect(text).toContain(`${origin}/development/skill-upload/SKILL.md`);
  expect(text).toContain('https://github.com/example/skill-demo');
  expect(text).toContain('目前工作目錄');
  expect(text).toContain('剛好 100 則彼此不同');
  expect(text).toContain('"share_introductions"');
  expect(text.split(GRANT)).toHaveLength(2);
  await panel.getByRole('button', { name: '交給我的 Agent', exact: true }).click();
  await expect(panel.getByText('已複製，貼給你的 Agent。', { exact: true })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.replace(/\r\n/g, '\n')).toBe(text.replace(/\r\n/g, '\n'));
  for (const cookie of await context.cookies()) expect(clipboard).not.toContain(cookie.value);
  expect(clipboard).not.toMatch(/^cookie:/im);
  await expectNoStoredSecret(page, GRANT);

  await panel.getByRole('button', { name: '返回選擇方式', exact: true }).click();
  await expect(panel.locator('textarea[data-private]')).toHaveCount(0);
  expect(await page.content()).not.toContain(GRANT);
  await expectNoStoredSecret(page, GRANT);
  expect(logs.join('\n')).not.toContain(GRANT);
});

test('leaving the agent step clears the secret DOM immediately and re-entering issues cleanly', async ({ page }) => {
  await mockUploads(page);
  await login(page); await navigate(page, '開源投稿');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await openAgentUpload(page);
  await expect(panel.getByLabel('給 Agent 的私人上傳指令', { exact: true })).toHaveValue(new RegExp(GRANT));

  await panel.getByRole('button', { name: '返回選擇方式', exact: true }).click();
  await expect(panel.locator('textarea[data-private]')).toHaveCount(0);
  expect(await page.content()).not.toContain(GRANT);
  await panel.getByRole('button', { name: '用我的 Agent 上傳', exact: true }).click();
  await expect(panel.getByLabel('給 Agent 的私人上傳指令', { exact: true })).toHaveValue(new RegExp(GRANT));
});

test('replayed, expired and off-origin grants never display a token and offer a replacement grant', async ({ page }) => {
  const responses = [
    undefined,
    { token: GRANT, expires_at: '2026-01-01T00:00:00Z', submit_url: '/agent-api/v1/skill-submissions/sub-waiting' },
    { token: GRANT, expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), submit_url: 'https://attacker.example/agent-api/v1/skill-submissions/sub-waiting' },
  ];
  const requests = await mockUploads(page, { grant: () => responses.shift() });
  await login(page); await navigate(page, '開源投稿');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await openAgentUpload(page);
  await expect(panel.getByRole('alert')).toContainText('重新產生指令');
  await panel.getByRole('button', { name: '重新建立指令', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('已過期');
  const regrant = requests.find(request => request.path.endsWith('/grant'))!;
  expect(regrant.headers['if-match']).toMatch(/^"\d+"$/);
  expect(regrant.headers['x-csrf-token']).toBeTruthy();
  await panel.getByRole('button', { name: '重新建立指令', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('不是本站位址');
  await expect(panel.locator('textarea[data-private]')).toHaveCount(0);
  expect(await page.content()).not.toContain(GRANT);
  await expect(panel.locator('.skill-upload-item[data-status="revoked"]')).toHaveCount(0);
});

test('owner previews all 100 share introductions and explicitly sends with CSRF, If-Match and consent', async ({ page }) => {
  const requests = await mockUploads(page);
  let published = 0;
  await login(page); await navigate(page, '開源投稿');
  await page.route('**/api/v1/opensource/projects', route => { if (route.request().method() === 'GET') published++; return route.fallback(); });
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await panel.getByRole('button', { name: '預覽並公開：流程整理技能', exact: true }).click();
  await expect(panel.getByRole('heading', { name: '確認這樣分享，好嗎？', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: '流程整理技能', exact: true })).toBeVisible();
  await expect(panel.getByText('讀取 README 後整理出的真實介紹。')).toBeVisible();
  await panel.getByText('使用說明與展示網址', { exact: true }).click();
  await expect(panel.getByText('安裝 Node.js 後執行第一個範例。')).toBeVisible();
  await expect(panel.getByText('維護者（自行聲明）')).toBeVisible();
  await expect(panel.getByRole('img', { name: '流程整理技能的投稿插圖', exact: true })).toHaveAttribute('src', '/api/v1/me/skill-submissions/sub-ready/illustration');
  await expect(panel.getByText('https://github.com/example/skill-demo', { exact: true })).toBeVisible();
  await expect(panel.locator('a[href^="javascript:"]')).toHaveCount(0);
  const list = panel.locator('.skill-upload-blurbs');
  await expect(list).not.toHaveAttribute('open');
  await list.getByText('分享短文 100 則', { exact: true }).click();
  const texts = await list.locator('li').allTextContents();
  expect(texts).toHaveLength(100); expect(new Set(texts).size).toBe(100);
  expect(await list.locator('ol').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(panel).toContainText('確認後即公開為社群技能書');

  await panel.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
  await panel.getByRole('button', { name: '重試公開投稿', exact: true }).click();
  const completed = panel.getByRole('region', { name: '投稿完成', exact: true });
  await expect(completed).toBeVisible();
  await expect(completed).toContainText('已公開為社群技能書');
  const send = requests.find(request => request.path === '/me/skill-submissions/sub-ready/publish')!;
  expect(send.body).toEqual({ consent_to_share: true });
  expect(send.headers['if-match']).toBe('"3"');
  expect(send.headers['x-csrf-token']).toBeTruthy();
  expect(send.headers['idempotency-key']).toBeTruthy();
  await expect.poll(() => published).toBeGreaterThan(0);
});

test('CLI keys keep typed fields on auth errors, show the token once and revoke without If-Match', async ({ page }) => {
  const requests = await mockUploads(page);
  await login(page); await navigate(page, '技能書架');
  // The guild shelf above the upload button must finish expanding before the pointer click.
  const unlocked = page.getByRole('button', { name: /^已解鎖 · \d+$/ });
  await expect(unlocked).toBeVisible();
  if ((await unlocked.innerText()).endsWith(' · 0')) {
    await expect(page.getByText('尚未解鎖，加入公會即可領取。', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('region', { name: '已解鎖技能書', exact: true }).locator('article[data-book-id]').first()).toBeVisible();
  }
  await page.getByRole('button', { name: '投稿開源工具', exact: true }).click();
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await openAgentUpload(page);
  const more = panel.locator('details.skill-upload-cli');
  await expect(more).not.toHaveAttribute('open');
  await more.locator('> summary').click();
  await expect(panel.getByRole('link', { name: '下載上傳工具', exact: true })).toHaveAttribute('href', '/downloads/freedom-skill-client.tgz');
  await expect(panel.getByRole('link', { name: '安裝說明 ↗', exact: true })).toHaveAttribute('href', '/development/skill-upload');
  await expect(panel).toContainText('不能送出公開');
  await expect(panel.getByLabel('有效天數', { exact: true })).toHaveValue('30');
  await panel.getByLabel('金鑰名稱', { exact: true }).fill('工作桌機');
  await panel.getByLabel('有效天數', { exact: true }).fill('45');
  await panel.getByRole('button', { name: '建立金鑰', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('請重新登入後再建立金鑰。');
  await expect(panel.getByLabel('金鑰名稱', { exact: true })).toHaveValue('工作桌機');
  await expect(panel.getByLabel('有效天數', { exact: true })).toHaveValue('45');
  await panel.getByRole('button', { name: '建立金鑰', exact: true }).click();
  await expect(panel.getByLabel('金鑰：工作桌機', { exact: true })).toHaveValue(KEY);
  await expect(panel).toContainText('只顯示這一次');
  const issue = requests.filter(request => request.method === 'POST' && request.path === '/me/skill-upload-keys').at(-1)!;
  expect(issue.body).toEqual({ label: '工作桌機', expires_in_days: 45 });
  expect(issue.headers['x-csrf-token']).toBeTruthy();
  await expectNoStoredSecret(page, KEY);

  await panel.getByRole('button', { name: '撤銷金鑰：工作桌機', exact: true }).click();
  const revoke = requests.find(request => request.path.endsWith('/revoke') && request.path.startsWith('/me/skill-upload-keys'))!;
  expect(revoke.headers['idempotency-key']).toBeTruthy();
  expect(revoke.headers['if-match']).toBeUndefined();
  await expect(panel.getByLabel('金鑰：工作桌機', { exact: true })).toHaveCount(0);
  await expect(panel.getByText(/上傳憑證已撤銷/)).toBeVisible();
  await panel.getByRole('button', { name: '返回選擇方式', exact: true }).click();
  expect(await page.content()).not.toContain(KEY);
});

for (const mode of ['draft', 'key'] as const) {
  test(`closing during ${mode} issuance never restores its secret after reopening`, async ({ page }) => {
    await mockUploads(page);
    const endpoint = mode === 'draft' ? '/me/skill-submissions' : '/me/skill-upload-keys';
    let release!: () => void, pending = false;
    const responseGate = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/v1${endpoint}`, async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      pending = true; await responseGate;
      await route.fulfill({ status: 201, json: mode === 'draft'
        ? { submission: submission('sub-delayed', 'awaiting_upload', 1), upload_grant: { token: GRANT, expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), submit_url: '/agent-api/v1/skill-submissions/sub-delayed' } }
        : { key: { key_id: 'key-delayed', label: '延遲金鑰', scope: 'skill:submit', expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), revoked_at: null }, token: KEY } });
    });
    await login(page); await navigate(page, '開源投稿');
    const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
    if (mode === 'key') {
      await openAgentUpload(page);
      await panel.locator('details.skill-upload-cli > summary').click();
      await panel.getByLabel('金鑰名稱', { exact: true }).fill('延遲金鑰');
      await panel.getByRole('button', { name: '建立金鑰', exact: true }).click();
      await expect.poll(() => pending).toBe(true);
      await panel.getByRole('button', { name: '返回選擇方式', exact: true }).click();
      await panel.getByRole('button', { name: '用我的 Agent 上傳', exact: true }).click();
      const response = page.waitForResponse(value => value.url().endsWith(`/api/v1${endpoint}`) && value.request().method() === 'POST');
      release(); await response;
      await panel.locator('details.skill-upload-cli > summary').click();
      await expect(panel.getByRole('button', { name: '建立金鑰', exact: true })).toBeEnabled();
      await expect(panel.getByLabel('金鑰：延遲金鑰', { exact: true })).toHaveCount(0);
      expect(await page.content()).not.toContain(KEY);
      await expectNoStoredSecret(page, KEY);
    } else {
      await page.getByLabel('GitHub 專案網址', { exact: true }).fill('https://github.com/example/skill-demo');
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByRole('button', { name: '用我的 Agent 上傳', exact: true }).click();
      await expect.poll(() => pending).toBe(true);
      await navigate(page, '技能書架');
      const response = page.waitForResponse(value => value.url().endsWith(`/api/v1${endpoint}`) && value.request().method() === 'POST');
      release(); await response;
      await navigate(page, '開源投稿');
      await expect(panel.locator('textarea[data-private]')).toHaveCount(0);
      expect(await page.content()).not.toContain(GRANT);
      await expectNoStoredSecret(page, GRANT);
    }
  });
}

test('open-source panel shows a simple form, folds advanced upload and fits a 320px phone', async ({ page }) => {
  await mockUploads(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page); await navigate(page, '開源投稿');
  const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
  await expect(page.getByRole('heading', { name: '投稿你的開源工具', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '預覽投稿', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '上傳技能', exact: true })).toHaveCount(0);
  await page.getByLabel('GitHub 專案網址', { exact: true }).fill('https://github.com/example/skill-demo');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByRole('button', { name: '我自己填', exact: true })).toBeVisible();
  const trigger = page.getByRole('button', { name: '用我的 Agent 上傳', exact: true });
  await expect(trigger).toHaveCount(1);
  await trigger.click();
  await expect(panel.getByLabel('給 Agent 的私人上傳指令', { exact: true })).toBeVisible();
  const more = panel.locator('details.skill-upload-cli');
  await expect(more).not.toHaveAttribute('open');
  await more.locator('> summary').click();
  await page.screenshot({ path: 'test-results/skill-upload-phone.png' });
  const layout = await panel.evaluate(element => ({
    fits: element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().right <= window.innerWidth,
    page: document.documentElement.scrollWidth <= window.innerWidth,
    small: [...element.querySelectorAll<HTMLElement>('button, a.btn, summary')].filter(control => control.offsetParent && control.getBoundingClientRect().height < 44).map(control => control.textContent),
    fonts: [...element.querySelectorAll<HTMLElement>('input, textarea')].map(field => parseFloat(getComputedStyle(field).fontSize)),
  }));
  expect(layout.fits).toBe(true);
  expect(layout.page).toBe(true);
  expect(layout.small).toEqual([]);
  expect(Math.min(...layout.fonts)).toBeGreaterThanOrEqual(16);
});

for (const viewport of [
  { width: 390, height: 844, name: 'phone' },
  { width: 820, height: 900, name: 'tablet' },
  { width: 1280, height: 800, name: 'desktop' },
]) {
  test(`chat JSON upload explains invalid text, rotates a grant once, and publish says the draft is saved (${viewport.name})`, async ({ page, context }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    let uploaded = false, agentCalls = 0;
    const agentBodies: unknown[] = [];
    const requests = await mockUploads(page, {
      grant: path => {
        const id = path.split('/')[3] ?? 'sub-new';
        return { token: GRANT, expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), submit_url: `/agent-api/v1/skill-submissions/${id}` };
      },
    });
    await page.route('**/agent-api/v1/skill-submissions/**', async route => {
      agentCalls += 1;
      agentBodies.push(route.request().postDataJSON());
      if (agentCalls === 1) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'validation_failed', detail: 'title: 太短; share_introductions: 需要剛好 100 則' }) });
      if (agentCalls === 2) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'upload_grant_invalid', detail: '上傳授權已過期。請按「重新產生指令」重新產生授權。' }) });
      uploaded = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ submission_id: 'sub-waiting', status: 'ready_for_review' }) });
    });
    await page.route('**/api/v1/me/skill-submissions/sub-waiting', async route => {
      if (route.request().method() !== 'GET' || !uploaded) return route.fallback();
      return route.fulfill({ json: submission('sub-waiting', 'ready_for_review', 9, true) });
    });
    await page.route('**/api/v1/me/skill-submissions/*/publish', route => route.fulfill({
      status: 503, headers: { 'content-type': 'application/json', 'retry-after': '45' },
      body: JSON.stringify({ code: 'github_rate_limited', detail: '草稿已保留，尚未公開。GitHub 暫時限制查詢，請稍後重試。約 45 秒後可再按「發佈」。' }),
    }));
    await login(page); await navigate(page, '開源投稿');
    await openAgentUpload(page);
    const panel = page.getByRole('region', { name: '投稿開源工具', exact: true });
    await expect(panel.getByText('尚未上傳內容').first()).toBeVisible();
    await panel.locator('details.skill-upload-cli > summary').click();
    await expect(panel.getByLabel('公開儲存庫網址', { exact: true })).toHaveValue('https://github.com/example/skill-demo');
    await panel.getByRole('button', { name: '交給聊天 AI', exact: true }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('https://github.com/example/skill-demo');
    expect(clip).toContain('README');
    expect(clip).not.toContain(GRANT);
    expect(clip).not.toMatch(/fpg_|fpk_|agent-api|Bearer/);
    await expect(panel.getByLabel('給聊天 AI 的說明', { exact: true })).toHaveValue(/https:\/\/github.com\/example\/skill-demo/);

    await panel.getByLabel('選擇 JSON 檔', { exact: true }).setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('這不是 JSON') });
    await expect(panel.getByRole('alert').filter({ hasText: '這段不是 JSON' })).toBeVisible();
    expect(agentCalls).toBe(0);

    const paste = panel.getByRole('textbox', { name: '貼上 JSON', exact: true });
    await paste.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await paste.fill(JSON.stringify({repository_url:'https://github.com/example/skill-demo',title:'缺少介紹頁'}));
    await panel.getByRole('button', { name: '用這份 JSON 建立草稿', exact: true }).click();
    await expect(panel.getByRole('alert').filter({hasText:'補齊 page_content'})).toBeVisible();
    expect(agentCalls).toBe(0);expect(requests.filter(request=>request.path.endsWith('/grant'))).toHaveLength(0);
    await paste.fill('```json\n' + JSON.stringify({ repository_url: 'https://github.com/example/skill-demo', title: '流程', page_content: syntheticSkillPage }) + '\n```');
    await panel.getByRole('button', { name: '用這份 JSON 建立草稿', exact: true }).click();
    await expect(panel.getByRole('alert').filter({ hasText: 'share_introductions' })).toBeVisible();
    expect(agentBodies[0]).toEqual({ repository_url: 'https://github.com/example/skill-demo', title: '流程', page_content: syntheticSkillPage });
    expect(requests.filter(request => request.path.endsWith('/grant'))).toHaveLength(1);

    await panel.getByRole('button', { name: '用這份 JSON 建立草稿', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '確認這樣分享，好嗎？', exact: true })).toBeVisible();
    await expect(panel.getByRole('heading', { name: '流程整理技能', exact: true })).toBeVisible();
    expect(agentCalls).toBe(3);
    const grants = requests.filter(request => request.path.endsWith('/grant'));
    expect(grants).toHaveLength(2);
    expect(grants[0].headers['if-match']).toBe('"2"');
    expect(grants[1].headers['if-match']).toBe('"3"');
    expect(grants[0].headers['authorization']).toBeUndefined();

    const reported = page.waitForRequest(request => request.url().includes('/me/client-errors') && request.method() === 'POST');
    await panel.getByLabel('我同意公開這份作品介紹與來源關係', { exact: true }).check();
    await panel.getByRole('button', { name: '重試公開投稿', exact: true }).click();
    const failure = panel.getByRole('alert').filter({ hasText: '草稿已保留' });
    await expect(failure).toContainText('發佈');
    await expect(failure).toContainText('45');
    await expect(failure).not.toContainText('服務暫時無法回應');
    expect((await reported).postDataJSON()).toMatchObject({ error_code: 'github_rate_limited' });

    const layout = await panel.evaluate(element => ({
      fits: element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().right <= window.innerWidth + 1,
      small: [...element.querySelectorAll<HTMLElement>('button, a.btn, summary')].filter(control => control.offsetParent && control.getBoundingClientRect().height < 44).map(control => (control.textContent ?? '').trim()),
      fonts: [...element.querySelectorAll<HTMLElement>('input, textarea')].map(field => parseFloat(getComputedStyle(field).fontSize)),
    }));
    expect(layout.fits).toBe(true);
    expect(layout.small).toEqual([]);
    expect(Math.min(...layout.fonts)).toBeGreaterThanOrEqual(16);
  });
}


// Controlled API responses verify the browser bridge and explicit owner action;
// this case does not stand in for the backend's ownership/transaction tests.
test('320px registered project resumes its exact off-list draft, then explicitly publishes and opens the real book', async ({page}) => {
  await page.setViewportSize({width:320,height:900});
  await mockUploads(page);await login(page);
  const sessionResponse=await page.request.get('/api/v1/session');
  expect(sessionResponse.status()).toBe(200);
  const session=await sessionResponse.json();
  const id='10000000-0000-4000-8000-000000000041',projectId='10000000-0000-4000-8000-000000000042';
  const publicPath=`/development/submissions/${id}`;
  let current={...submission(id,'ready_for_review',3,true),illustration_url:null,can_edit:false};
  current.payload!.share_introductions=['一則已足夠開始分享的介紹。'];
  let attached=false;
  const writes:Recorded[]=[];
  const project={project_id:projectId,owner_ref:session.user.user_id,owner_name:'作品登錄者',title:'原有開源作品',description:'已登錄而尚未成書。',use_notes:'先閱讀文件。',demo_url:null,repository_url:'https://github.com/example/skill-demo',repository_full_name:'example/skill-demo',repository_id:'42',relationship:'curator',aggregate_version:7,current_version:{version_id:'v',commit_sha:'a'.repeat(40),license_spdx:'MIT',license_evidence_url:null,is_fork:false,archived:false,readme_url:'https://github.com/example/skill-demo/blob/main/README.md',inspected_at:'2026-10-09T00:00:00Z'}};
  await page.route('**/api/v1/opensource/projects**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');
    if(request.method()==='GET')return route.fulfill({json:{items:[
      {...project,skill_book:attached?{status:current.status,submission_id:id,public_path:current.status==='published'?publicPath:null,catalog_book:null,can_edit:false}:null},
      {...project,project_id:'foreign',owner_ref:'another-member',title:'別人的開源作品',skill_book:null},
      {...project,project_id:'catalog',owner_ref:'another-member',title:'既有指定技能書',skill_book:{status:'published',submission_id:null,public_path:'/development/skills/video-autopilot',catalog_book:{book_id:'video-autopilot',title:'指定書',public_path:'/development/skills/video-autopilot'},can_edit:false}},
    ]}});
    writes.push({method:request.method(),path,headers:request.headers(),body:request.postDataJSON()});
    expect(path).toBe(`/opensource/projects/${projectId}/skill-submission`);
    attached=true;return route.fulfill({status:200,json:{submission:current,created:false}});
  });
  await page.route('**/api/v1/me/skill-submissions**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname.replace('/api/v1','');
    // Omit the requested draft as a bounded list can do; the exact-ID GET must work.
    if(request.method()==='GET')return route.fulfill({json:path==='/me/skill-submissions'?{items:[]}:current});
    writes.push({method:request.method(),path,headers:request.headers(),body:request.postDataJSON()});
    expect(path).toBe(`/me/skill-submissions/${id}/publish`);
    current={...current,status:'published',aggregate_version:4,public_path:publicPath};
    return route.fulfill({json:current});
  });
  await navigate(page,'開源投稿');
  const owner=page.getByRole('article',{name:'開源作品：原有開源作品',exact:true});
  const foreign=page.getByRole('article',{name:'開源作品：別人的開源作品',exact:true});
  await expect(foreign.getByRole('button',{name:'製作技能書',exact:true})).toHaveCount(0);
  await expect(page.getByRole('article',{name:'開源作品：既有指定技能書',exact:true}).getByRole('link',{name:'閱讀已公開技能書 ↗',exact:true})).toHaveAttribute('href','/development/skills/video-autopilot');
  expect(writes).toEqual([]);
  await owner.getByRole('button',{name:'製作技能書',exact:true}).click();
  await expect(page.getByRole('heading',{name:'確認這樣分享，好嗎？',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'流程整理技能',exact:true})).toBeVisible();
  await expect(page.getByText('分享短文 1 則',{exact:true})).toBeVisible();
  await expect(page.locator('.skill-upload-illustration')).toHaveCount(0);
  expect(writes).toHaveLength(1);expect(writes[0].body).toEqual({});expect(writes[0].headers['if-match']).toBe('"7"');expect(writes[0].headers['x-csrf-token']).toBeTruthy();
  await owner.getByRole('button',{name:'繼續製作技能書',exact:true}).click();
  await expect(page.getByRole('heading',{name:'流程整理技能',exact:true})).toBeVisible();expect(writes).toHaveLength(1);
  await page.getByLabel('我同意公開這份作品介紹與來源關係',{exact:true}).check();
  await page.getByRole('button',{name:'重試公開投稿',exact:true}).click();
  const completed=page.getByRole('region',{name:'投稿完成'});
  await expect(completed).toBeVisible();
  await expect(completed.getByRole('link',{name:'閱讀已公開技能書 ↗',exact:true})).toHaveAttribute('href',publicPath);
  expect(writes).toHaveLength(2);expect(writes[1].headers['if-match']).toBe('"3"');expect(writes[1].body).toEqual({consent_to_share:true});
  await expect(owner.getByRole('link',{name:'閱讀已公開技能書 ↗',exact:true})).toHaveAttribute('href',publicPath);
  await expect(owner.getByRole('button',{name:'製作技能書',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/registered-project-skill-book-320.png',fullPage:true});
});


test('registered project continues an awaiting Agent draft through an exact-ID GET without creating another draft',async({page})=>{
  await mockUploads(page);await login(page);
  const sessionResponse=await page.request.get('/api/v1/session');
  expect(sessionResponse.status()).toBe(200);
  const session=await sessionResponse.json();
  const id='10000000-0000-4000-8000-000000000051',repo='https://github.com/example/skill-demo';
  const draft={...submission(id,'awaiting_upload',2),seed:{repository_url:repo,title:'已修改的草稿',description:'保留會員修改',use_notes:'先讀文件',relationship:'curator',demo_url:null},can_edit:false};
  const reads:string[]=[],writes:string[]=[];
  await page.route('**/api/v1/me/skill-submissions**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()!=='GET'){writes.push(path);return route.fulfill({status:500,json:{detail:'此步不應寫入'}});}
    reads.push(path);return route.fulfill({json:path.endsWith('/skill-submissions')?{items:[]}:draft});
  });
  await page.route('**/api/v1/opensource/projects',route=>route.fulfill({json:{items:[{project_id:'legacy-awaiting',owner_ref:session.user.user_id,owner_name:'本人',title:'待補內容作品',description:'原作品介紹',use_notes:'閱讀文件',demo_url:null,repository_url:repo,repository_full_name:'example/skill-demo',repository_id:'51',relationship:'curator',aggregate_version:9,current_version:{commit_sha:'a'.repeat(40),license_spdx:'MIT',is_fork:false,archived:false,readme_url:repo+'/blob/main/README.md'},skill_book:{status:'awaiting_upload',submission_id:id,public_path:null,catalog_book:null,can_edit:false}}]}}));
  await navigate(page,'開源投稿');
  const card=page.getByRole('article',{name:'開源作品：待補內容作品',exact:true});
  await card.getByRole('button',{name:'繼續製作技能書',exact:true}).click();
  const panel=page.getByRole('region',{name:'投稿開源工具',exact:true});
  await expect(panel.getByText('正在補完：已修改的草稿',{exact:true}).first()).toBeVisible();
  await panel.locator('details.skill-upload-cli > summary').click();
  await expect(panel.getByLabel('公開儲存庫網址',{exact:true})).toHaveValue(repo);
  expect(reads).toContain(`/api/v1/me/skill-submissions/${id}`);expect(writes).toEqual([]);
  await expect(panel.getByRole('button',{name:'確認並公開',exact:true})).toHaveCount(0);
});


test('an unfinished manual page opens its original form without an advanced publish action',async({page})=>{
 await mockUploads(page);
 const draft={...submission('sub-partial','ready_for_review',2,true),payload:{...submission('sub-partial','ready_for_review',2,true).payload!,page_content:undefined,page_content_draft:{...syntheticSkillPage,outcomes:syntheticSkillPage.outcomes.join('\n'),mechanism:''}}};
 await page.route('**/api/v1/me/skill-submissions',route=>route.fulfill({json:{items:[draft]}}));
 await page.route('**/api/v1/me/skill-submissions/sub-partial',route=>route.fulfill({json:draft}));
 await login(page);await navigate(page,'開源投稿');
 const panel=page.getByRole('region',{name:'投稿開源工具',exact:true});
 await panel.getByRole('button',{name:'繼續：流程整理技能',exact:true}).click();
 await expect(panel.getByLabel('作品名稱',{exact:true})).toHaveValue('流程整理技能');
 await expect(panel.getByRole('button',{name:'預覽投稿',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'確認並公開',exact:true})).toHaveCount(0);
});
