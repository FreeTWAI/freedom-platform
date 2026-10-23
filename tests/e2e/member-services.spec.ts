import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { navigate, signOut } from './navigation.js';
import { test, expect, type Browser, type Page } from './fixtures.js';
import { DEMO_COMMUNITY, DEMO_USERS } from '../../packages/testing/seed.js';

const GUEST_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SHOTS = process.env.AUDIT_EVIDENCE_DIR ?? 'test-results/member-services';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const COVER_TITLE = 'E2E 假髮造型';
const PLACEHOLDER_TITLE = 'E2E 語言課';
const CATEGORIES = ['hair_beauty', 'courses', 'language', 'design', 'photo_video', 'tech', 'consulting', 'handmade', 'other'];

test.use({ userAgent: GUEST_UA });
test.describe.configure({ mode: 'serial' });
mkdirSync(SHOTS, { recursive: true });

let servicePath = '';
let goUrl = '';

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.addInitScript(() => {
    try { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); } catch { /* Copy stays available. */ }
  });
});

test.afterAll(async ({ e2eAuthPool }) => {
  await e2eAuthPool.query(`DELETE FROM promotion_clicks WHERE link_id IN (SELECT link_id FROM promotion_links WHERE kind='member_service')`);
  await e2eAuthPool.query(`DELETE FROM promotion_links WHERE kind='member_service'`);
  await e2eAuthPool.query(`DELETE FROM member_services WHERE title LIKE 'E2E %'`);
});

async function login(page: Page, email = 'maker@local.test') {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill(email);
  await page.getByLabel('密碼', { exact: true }).fill('freedom-local-demo');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.shell')).toBeVisible({ timeout: 20_000 });
}

async function themeOf(page: Page, theme: 'light' | 'dark' | 'versefolk') {
  await page.evaluate(value => {
    localStorage.setItem('freedom-theme', value);
    document.documentElement.dataset.theme = value;
    window.dispatchEvent(new Event('freedom-theme-changed'));
  }, theme);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function publicLogoFits(page: Page) {
  const logo = page.locator('header.service-top a[href="/"] img.service-logo');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('alt', '自由工坊');
  const box = (await logo.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(52);
  expect(box.height).toBeLessThanOrEqual(68);
  expect(box.width).toBeGreaterThan(0);
  await noOverflow(page);
}

function channel(value: number) {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}
function parseColor(value: string) {
  const srgb = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) return srgb.slice(1, 4).map(channel => Number(channel) * 255);
  const rgb = value.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return rgb.slice(1, 4).map(Number);
  throw new Error(`unparsed colour ${value}`);
}
function contrast(foreground: string, background: string) {
  const luminance = (value: string) => {
    const [r, g, b] = parseColor(value).map(channel);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const left = luminance(foreground), right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

function card(page: Page, title: string) {
  return page.locator('article.service-card').filter({ has: page.getByRole('heading', { name: title, level: 3 }) });
}

async function fillService(page: Page, title: string, category: string, summary: string, file = false) {
  await page.getByRole('button', { name: '新增服務', exact: true }).click();
  const form = page.locator('form.service-form');
  await expect(form).toBeVisible();
  await expect(form.getByText('服務頁會公開，任何拿到連結的人都看得到。')).toBeVisible();
  await form.getByLabel('標題', { exact: true }).fill(title);
  await form.locator('select').selectOption({ label: category });
  await form.getByLabel('簡介', { exact: true }).fill(summary);
  await form.getByLabel('說明', { exact: true }).fill('到府討論，也可以線上。');
  await form.getByLabel('價格', { exact: true }).fill('每堂 NT$800 起');
  await form.getByLabel('地區', { exact: true }).fill('台北・線上');
  await form.getByLabel('聯絡名稱', { exact: true }).fill('官方網站');
  await form.getByLabel('https 連結', { exact: true }).fill('https://example.com/wig');
  if (file) await form.locator('input[type="file"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  return form;
}

test('a member lists a service with a cover and one with a placeholder', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await navigate(page, '社員服務');
  await expect(page.getByText('還沒有社員分享服務。你可以先新增自己的服務。')).toBeVisible();
  const form = await fillService(page, COVER_TITLE, '美髮造型・假髮', '客製假髮與造型調整', true);
  await themeOf(page, 'light');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'form-light-1280');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'form-light-390');
  const formBox = (await form.boundingBox())!;
  const urlBox = (await form.getByLabel('https 連結', { exact: true }).boundingBox())!;
  for (const name of ['移除', '再加一個聯絡方式']) {
    const box = (await form.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.width).toBeLessThan(formBox.width * 0.6);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(box.x - urlBox.x)).toBeLessThanOrEqual(2);
  }
  const removeBox = (await form.getByRole('button', { name: '移除', exact: true }).boundingBox())!;
  expect(removeBox.y).toBeGreaterThan(urlBox.y + urlBox.height - 1);
  await themeOf(page, 'versefolk');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'form-versefolk-1280');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'form-versefolk-390');
  await form.getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(page.getByText('已新增服務。')).toBeVisible();
  await expect(page.locator('li.service-mine-row').filter({ hasText: COVER_TITLE })).toBeVisible();
  await expect(card(page, COVER_TITLE).locator('img.service-cover')).toBeVisible();
  await fillService(page, PLACEHOLDER_TITLE, '語言教學', '一對一對話練習');
  await page.locator('form.service-form').getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(card(page, PLACEHOLDER_TITLE).locator('.service-placeholder')).toContainText('語言教學');
  await expect(page.locator('li.service-mine-row').filter({ hasText: PLACEHOLDER_TITLE })).toBeVisible();
  await expect(page.locator('section.service-mine h2')).toHaveText('我的服務 2／5');
  servicePath = (await card(page, COVER_TITLE).getByRole('link', { name: '服務頁 ↗' }).getAttribute('href'))!;
  for (const theme of ['light', 'versefolk'] as const) {
    await themeOf(page, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await shot(page, `services-${theme}-${width}`);
      await noOverflow(page);
    }
  }
});

test('the create button says when the 5-service limit is reached, and an oversized cover is refused before upload', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/member-services/mine', async route => {
    const real = await (await route.fetch()).json() as { items: { service_id: string }[]; limit: number };
    const items = Array.from({ length: real.limit }, (_, index) => ({ ...real.items[0], service_id: `00000000-0000-4000-8000-00000000000${index}` }));
    await route.fulfill({ json: { ...real, items } });
  });
  await navigate(page, '社員服務');
  const mine = page.getByRole('region', { name: '我的服務', exact: true });
  await expect(mine.locator('h2')).toHaveText('我的服務 5／5');
  await expect(mine.getByRole('button', { name: '新增服務', exact: true })).toBeDisabled();
  await expect(mine).toContainText('已達 5 項上限（含暫停中的服務）。刪除一項後才能再新增。');
  await page.unroute('**/api/v1/member-services/mine');
  await page.reload();
  await navigate(page, '社員服務');
  await expect(mine.locator('h2')).toHaveText('我的服務 2／5');
  await mine.getByRole('button', { name: '新增服務', exact: true }).click();
  const form = page.locator('form.service-form');
  const cover = form.locator('input[type="file"]');
  let uploads = 0;
  await page.route('**/api/v1/member-services/*/cover', route => { uploads += 1; return route.continue(); });
  await cover.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
  await expect(form.getByText('封面需為 4 MiB 以下，請換一張較小的圖片。')).toBeVisible();
  await expect(cover).toHaveAttribute('aria-invalid', 'true');
  expect(await cover.evaluate(input => (input as HTMLInputElement).files?.length ?? 0)).toBe(0);
  await cover.setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  await expect(form.getByText('封面需為 4 MiB 以下，請換一張較小的圖片。')).toHaveCount(0);
  await form.getByRole('button', { name: '取消', exact: true }).click();
  expect(uploads).toBe(0);
});

test('real API journey: cover recovery, edit, pause, the 5-service cap, delete and re-login', async ({ page, e2eAuthPool }) => {
  test.setTimeout(240_000);
  const owner = '20000000-0000-4000-8000-000000000003';
  const mineTitles = async () => (await e2eAuthPool.query(`SELECT title,state FROM member_services WHERE owner_user_id=$1 AND state IN ('active','paused') ORDER BY title`, [owner])).rows as { title: string; state: string }[];
  let csrf = '';
  const coverPuts: string[] = [];
  page.on('request', request => {
    csrf = request.headers()['x-csrf-token'] ?? csrf;
    if (request.method() === 'PUT' && /\/api\/v1\/member-services\/[^/]+\/cover$/.test(request.url())) coverPuts.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'client@local.test');
  await navigate(page, '社員服務');
  const mine = page.getByRole('region', { name: '我的服務', exact: true });
  await expect(mine.locator('h2')).toHaveText('我的服務 0／5');

  // Oversized cover is refused in the browser. A legal one then meets two injected transport faults on the real API:
  // first the request never reaches the server, then the server commits it (200 checked) but the response is lost.
  // Each explicit retry resends only the cover with the original key, If-Match and bytes; the service is not rewritten.
  const form = await fillService(page, 'E2E 旅程 1', '設計', '封面與恢復');
  const cover = form.locator('input[type="file"]');
  await cover.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
  await expect(form.getByText('封面需為 4 MiB 以下，請換一張較小的圖片。')).toBeVisible();
  expect(coverPuts).toHaveLength(0);
  await cover.setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  const faults = ['before-server', 'response-lost'];
  const sent: { key: string; ifMatch: string; sha: string; status: number | null }[] = [];
  await page.route('**/api/v1/member-services/*/cover', async route => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.continue();
    const fault = faults.shift();
    const entry = { key: request.headers()['idempotency-key'], ifMatch: request.headers()['if-match'], sha: createHash('sha256').update(request.postDataBuffer() ?? Buffer.alloc(0)).digest('hex'), status: null as number | null };
    sent.push(entry);
    if (fault === 'before-server') return route.abort('failed');
    const response = await route.fetch();
    entry.status = response.status();
    return fault === 'response-lost' ? route.abort('failed') : route.fulfill({ response });
  });
  const unknownCover = '封面上傳結果還沒確認，服務已儲存。按「重試封面」會用同一張圖片和同一個請求再送一次。';
  await form.getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(unknownCover);
  await expect(page.getByText('已新增服務。')).toHaveCount(0);
  await expect(form.getByRole('heading', { name: '編輯服務', exact: true })).toBeVisible();
  await expect(form.getByRole('textbox', { name: /^標題/ })).toHaveValue('E2E 旅程 1');
  await expect(form.getByRole('textbox', { name: /^標題/ })).toBeDisabled();
  expect(await mineTitles()).toEqual([{ title: 'E2E 旅程 1', state: 'active' }]);
  await form.getByRole('button', { name: '重試封面', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText(unknownCover);
  await form.getByRole('button', { name: '重試封面', exact: true }).click();
  await expect(page.getByText('已更新服務。')).toBeVisible();
  await page.unroute('**/api/v1/member-services/*/cover');
  expect(sent.map(item => item.status)).toEqual([null, 200, 200]);
  expect(new Set(sent.map(item => `${item.key}|${item.ifMatch}|${item.sha}`)).size).toBe(1);
  expect(sent[0].ifMatch).toBe('"1"');
  expect(coverPuts).toHaveLength(3);
  expect(await mineTitles()).toEqual([{ title: 'E2E 旅程 1', state: 'active' }]);
  await expect(card(page, 'E2E 旅程 1').locator('img.service-cover')).toBeVisible();
  const journeyRow = (await e2eAuthPool.query(`SELECT s.service_id::text AS id, s.aggregate_version::int AS v FROM member_services s JOIN member_service_covers c USING(service_id) WHERE s.owner_user_id=$1 AND s.title='E2E 旅程 1'`, [owner])).rows;
  expect(journeyRow).toHaveLength(1);
  expect(journeyRow[0].v).toBe(2);
  expect((await e2eAuthPool.query(`SELECT count(*)::int AS n FROM command_receipts WHERE user_id=$1 AND operation LIKE $2`, [owner, `%/member-services/${journeyRow[0].id}/cover`])).rows[0].n).toBe(1);

  // Edit, pause and resume the same service.
  const row = mine.locator('li.service-mine-row').filter({ hasText: 'E2E 旅程 1' });
  await row.getByRole('button', { name: '編輯', exact: true }).click();
  await form.getByRole('textbox', { name: /^簡介/ }).fill('封面與恢復（已編輯）');
  await form.getByRole('button', { name: '儲存變更', exact: true }).click();
  await expect(page.getByText('已更新服務。')).toBeVisible();
  await row.getByRole('button', { name: '暫停', exact: true }).click();
  await expect(row.locator('.service-state')).toHaveText('暫停中');
  await row.getByRole('button', { name: '恢復', exact: true }).click();
  await expect(row.locator('.service-state')).toHaveCount(0);

  // Fill the quota through the UI; a paused service still counts.
  for (const n of [2, 3, 4, 5]) {
    await (await fillService(page, `E2E 旅程 ${n}`, '設計', `第 ${n} 項`)).getByRole('button', { name: '建立服務', exact: true }).click();
    await expect(mine.locator('li.service-mine-row').filter({ hasText: `E2E 旅程 ${n}` })).toBeVisible();
  }
  await row.getByRole('button', { name: '暫停', exact: true }).click();
  await expect(row.locator('.service-state')).toHaveText('暫停中');
  await expect(mine.locator('h2')).toHaveText('我的服務 5／5');
  const create = mine.getByRole('button', { name: '新增服務', exact: true });
  await expect(create).toBeDisabled();
  await expect(mine).toContainText('已達 5 項上限（含暫停中的服務）。刪除一項後才能再新增。');
  for (const theme of ['light', 'dark', 'versefolk'] as const) {
    await themeOf(page, theme);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await mine.scrollIntoViewIfNeeded();
      await mine.screenshot({ path: `${SHOTS}/quota-full-${theme}-${width}.png` });
      await noOverflow(page);
    }
  }
  await themeOf(page, 'light');
  await page.setViewportSize({ width: 390, height: 844 });

  // The server, not only the disabled button, refuses a sixth service.
  const sixth = await page.evaluate(async token => {
    const response = await fetch('/api/v1/member-services', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ title: 'E2E 第六項', category: 'design', summary: '不該建立', service_mode: 'online', contacts: [{ label: '官網', url: 'https://example.com/six' }] }) });
    return { status: response.status, code: (await response.json()).code };
  }, csrf);
  expect(sixth).toEqual({ status: 409, code: 'member_service_limit' });
  expect(await mineTitles()).toHaveLength(5);

  // Deleting one frees a slot; the button is usable again from the keyboard.
  const last = mine.locator('li.service-mine-row').filter({ hasText: 'E2E 旅程 5' });
  await last.getByRole('button', { name: '刪除', exact: true }).click();
  await last.getByRole('button', { name: '確定刪除', exact: true }).click();
  await expect(page.getByText('服務已刪除。')).toBeVisible();
  await expect(mine.locator('h2')).toHaveText('我的服務 4／5');
  await expect(create).toBeEnabled();
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('form.service-form')).toBeVisible();
  await page.locator('form.service-form').getByRole('button', { name: '取消', exact: true }).click();
  await (await fillService(page, 'E2E 旅程 6', '設計', '刪除後再建')).getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(mine.locator('li.service-mine-row').filter({ hasText: 'E2E 旅程 6' })).toBeVisible();

  // A fresh session reads the same five services, including the paused one.
  await signOut(page);
  await login(page, 'client@local.test');
  await navigate(page, '社員服務');
  await expect(mine.locator('h2')).toHaveText('我的服務 5／5');
  await expect(mine.locator('li.service-mine-row')).toHaveCount(5);
  await expect(mine.locator('li.service-mine-row').filter({ hasText: 'E2E 旅程 1' }).locator('.service-state')).toHaveText('暫停中');
  expect((await mineTitles()).map(item => item.title)).toEqual(['E2E 旅程 1', 'E2E 旅程 2', 'E2E 旅程 3', 'E2E 旅程 4', 'E2E 旅程 6']);
  await expect(create).toBeDisabled();
});

test('two tabs: a cover committed before its lost response is replayed with its original key and never overwrites the other tab', async ({ page, context, e2eAuthPool }) => {
  test.setTimeout(180_000);
  const owner = '20000000-0000-4000-8000-000000000002';
  await login(page, 'reviewer@local.test');
  await navigate(page, '社員服務');
  const mine = page.getByRole('region', { name: '我的服務', exact: true });
  await (await fillService(page, 'E2E 兩分頁', '設計', '原始簡介')).getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(mine.locator('li.service-mine-row').filter({ hasText: 'E2E 兩分頁' })).toBeVisible();
  const id = (await e2eAuthPool.query(`SELECT service_id::text AS id FROM member_services WHERE owner_user_id=$1 AND title='E2E 兩分頁'`, [owner])).rows[0].id as string;

  // Tab A: the cover PUT reaches the real server and commits (status and response identity checked), then its response is dropped.
  const attempts: { key: string; ifMatch: string; sha: string; status: number; service: string; version: number }[] = [];
  let drop = true;
  await page.route(`**/api/v1/member-services/${id}/cover`, async route => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    const body = await response.json() as { service_id: string; aggregate_version: number };
    attempts.push({ key: request.headers()['idempotency-key'], ifMatch: request.headers()['if-match'], sha: createHash('sha256').update(request.postDataBuffer() ?? Buffer.alloc(0)).digest('hex'), status: response.status(), service: body.service_id, version: body.aggregate_version });
    if (drop) { drop = false; return route.abort('failed'); }
    return route.fulfill({ response });
  });
  const servicePuts: string[] = [];
  page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith(`/api/v1/member-services/${id}`)) servicePuts.push(request.headers()['idempotency-key']); });
  // Tab A's recovery read of its own list is held until tab B has saved (the window where a fresh version would
  // let the old draft overwrite B), and then fails with 500; the pending cover must survive both.
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let holdMine = false;
  await page.route('**/api/v1/member-services/mine', async route => {
    if (!holdMine || route.request().method() !== 'GET') return route.continue();
    holdMine = false;
    await gate;
    return route.fulfill({ status: 500, json: { detail: '暫時無法讀取。' } });
  });
  await mine.locator('li.service-mine-row').filter({ hasText: 'E2E 兩分頁' }).getByRole('button', { name: '編輯', exact: true }).click();
  const form = page.locator('form.service-form');
  await form.getByRole('textbox', { name: /^簡介/ }).fill('A 分頁的簡介');
  await form.locator('input[type="file"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  holdMine = true;
  await form.getByRole('button', { name: '儲存變更', exact: true }).click();
  await expect.poll(() => attempts.length).toBe(1);
  expect(attempts[0]).toMatchObject({ ifMatch: '"2"', status: 200, service: id, version: 3 });

  // Tab B edits the same service after the cover commit, while tab A is still recovering.
  const other = await context.newPage();
  await other.goto('/');
  await navigate(other, '社員服務');
  const otherMine = other.getByRole('region', { name: '我的服務', exact: true });
  await otherMine.locator('li.service-mine-row').filter({ hasText: 'E2E 兩分頁' }).getByRole('button', { name: '編輯', exact: true }).click();
  const otherForm = other.locator('form.service-form');
  await expect(otherForm.getByRole('textbox', { name: /^簡介/ })).toHaveValue('A 分頁的簡介');
  await otherForm.getByRole('textbox', { name: /^簡介/ }).fill('B 分頁的簡介');
  await otherForm.getByRole('button', { name: '儲存變更', exact: true }).click();
  await expect(other.getByText('已更新服務。')).toBeVisible();
  expect((await e2eAuthPool.query('SELECT aggregate_version::int AS v FROM member_services WHERE service_id=$1', [id])).rows[0].v).toBe(4);
  expect(holdMine).toBe(false);
  release();
  await expect(form.getByRole('alert')).toHaveText('封面上傳結果還沒確認，服務已儲存。按「重試封面」會用同一張圖片和同一個請求再送一次。');

  // Tab A retries explicitly: same key, If-Match and bytes; the server replays the committed result.
  await form.getByRole('button', { name: '重試封面', exact: true }).click();
  await expect(page.getByText('已更新服務。')).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(servicePuts).toHaveLength(1);
  expect((await e2eAuthPool.query('SELECT summary, aggregate_version::int AS v FROM member_services WHERE service_id=$1', [id])).rows[0]).toEqual({ summary: 'B 分頁的簡介', v: 4 });
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_service_covers WHERE service_id=$1', [id])).rows[0].n).toBe(1);
  expect((await e2eAuthPool.query(`SELECT idempotency_key FROM command_receipts WHERE user_id=$1 AND operation LIKE $2`, [owner, `%/member-services/${id}/cover`])).rows.map(row => row.idempotency_key)).toEqual([attempts[0].key]);
  expect((await e2eAuthPool.query(`SELECT count(*)::int AS n FROM command_receipts WHERE user_id=$1 AND idempotency_key=$2`, [owner, servicePuts[0]])).rows[0].n).toBe(1);

  // Both tabs and the public page read the other tab's content with the cover.
  const publicPage = await page.request.get(`/services/${id}`);
  expect(publicPage.status()).toBe(200);
  expect(await publicPage.text()).toContain('B 分頁的簡介');
  await page.reload();
  await navigate(page, '社員服務');
  await expect(card(page, 'E2E 兩分頁')).toContainText('B 分頁的簡介');
  await expect(card(page, 'E2E 兩分頁').locator('img.service-cover')).toBeVisible();
  await other.close();
});

test('two tabs: a cover that never reached the server stops at the version conflict and keeps the chosen file', async ({ page, context, e2eAuthPool }) => {
  test.setTimeout(180_000);
  const owner = '20000000-0000-4000-8000-000000000002';
  await login(page, 'reviewer@local.test');
  await navigate(page, '社員服務');
  const mine = page.getByRole('region', { name: '我的服務', exact: true });
  await (await fillService(page, 'E2E 衝突', '設計', '原始簡介')).getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(mine.locator('li.service-mine-row').filter({ hasText: 'E2E 衝突' })).toBeVisible();
  const id = (await e2eAuthPool.query(`SELECT service_id::text AS id FROM member_services WHERE owner_user_id=$1 AND title='E2E 衝突'`, [owner])).rows[0].id as string;
  const keys: string[] = [];
  let lose = true;
  await page.route(`**/api/v1/member-services/${id}/cover`, route => {
    if (route.request().method() !== 'PUT') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (lose) { lose = false; return route.abort('failed'); }
    return route.continue();
  });
  await mine.locator('li.service-mine-row').filter({ hasText: 'E2E 衝突' }).getByRole('button', { name: '編輯', exact: true }).click();
  const form = page.locator('form.service-form');
  await form.locator('input[type="file"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  await form.getByRole('button', { name: '儲存變更', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('封面上傳結果還沒確認，服務已儲存。按「重試封面」會用同一張圖片和同一個請求再送一次。');

  const other = await context.newPage();
  await other.goto('/');
  await navigate(other, '社員服務');
  await other.getByRole('region', { name: '我的服務', exact: true }).locator('li.service-mine-row').filter({ hasText: 'E2E 衝突' }).getByRole('button', { name: '編輯', exact: true }).click();
  const otherForm = other.locator('form.service-form');
  await otherForm.getByRole('textbox', { name: /^簡介/ }).fill('B 分頁先改');
  await otherForm.getByRole('button', { name: '儲存變更', exact: true }).click();
  await expect(other.getByText('已更新服務。')).toBeVisible();
  await other.close();

  // The original operation is retried unchanged; the server refuses it and nothing is overwritten.
  await form.getByRole('button', { name: '重試封面', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('這項服務已在其他地方更新，這次的封面沒有換上。你選的圖片還在；按「載入最新內容」確認後，再儲存一次即可換上。');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect((await e2eAuthPool.query('SELECT summary FROM member_services WHERE service_id=$1', [id])).rows[0].summary).toBe('B 分頁先改');
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_service_covers WHERE service_id=$1', [id])).rows[0].n).toBe(0);
  expect((await e2eAuthPool.query(`SELECT count(*)::int AS n FROM command_receipts WHERE user_id=$1 AND operation LIKE $2`, [owner, `%/member-services/${id}/cover`])).rows[0].n).toBe(0);
  await expect(form.getByRole('button', { name: '儲存變更', exact: true })).toBeDisabled();
  for (const theme of ['light', 'dark', 'versefolk'] as const) {
    await themeOf(page, theme);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await form.screenshot({ path: `${SHOTS}/cover-conflict-${theme}-${width}.png` });
      await noOverflow(page);
    }
  }
  await themeOf(page, 'light');

  // Loading the latest content is the explicit choice. A failed read is not "gone": the form, conflict and file stay, nothing is written.
  const writes: string[] = [];
  page.on('request', request => { if (['POST', 'PUT', 'DELETE'].includes(request.method()) && request.url().includes('/api/v1/member-services')) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  let failRead = true;
  await page.route('**/api/v1/member-services/mine', route => {
    if (failRead && route.request().method() === 'GET') { failRead = false; return route.fulfill({ status: 500, json: { detail: '暫時無法讀取。' } }); }
    return route.continue();
  });
  await form.getByRole('button', { name: '載入最新內容', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('暫時無法讀取最新內容。你的輸入和選好的圖片都還在；請稍後再按「載入最新內容」。');
  expect(failRead).toBe(false);
  await expect(form).toBeVisible();
  await expect(form.getByRole('textbox', { name: /^簡介/ })).toHaveValue('原始簡介');
  expect(await form.locator('input[type="file"]').evaluate(input => (input as HTMLInputElement).files?.[0]?.name)).toBe('cover.png');
  await expect(form.getByRole('button', { name: '儲存變更', exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
  await form.getByRole('button', { name: '載入最新內容', exact: true }).click();
  await expect(form.getByRole('textbox', { name: /^簡介/ })).toHaveValue('B 分頁先改');
  expect(writes).toEqual([]);
  await form.getByRole('button', { name: '儲存變更', exact: true }).click();
  await expect(page.getByText('已更新服務。')).toBeVisible();
  expect(keys).toHaveLength(3);
  expect(keys[2]).not.toBe(keys[0]);
  expect((await e2eAuthPool.query('SELECT summary FROM member_services WHERE service_id=$1', [id])).rows[0].summary).toBe('B 分頁先改');
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_service_covers WHERE service_id=$1', [id])).rows[0].n).toBe(1);
});

test('a create whose response is lost is retried with its original key and body, and creates one service', async ({ page, e2eAuthPool }) => {
  const owner = '20000000-0000-4000-8000-000000000002';
  await login(page, 'reviewer@local.test');
  await navigate(page, '社員服務');
  const posts: { key: string; body: string; status: number }[] = [];
  let lose = true;
  await page.route('**/api/v1/member-services', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const response = await route.fetch();
    posts.push({ key: request.headers()['idempotency-key'], body: request.postData() ?? '', status: response.status() });
    if (lose) { lose = false; return route.abort('failed'); }
    return route.fulfill({ response });
  });
  const form = await fillService(page, 'E2E 建立未確認', '設計', '回應遺失');
  await form.getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('儲存結果還沒確認。按「重試儲存」會用同一份內容和同一個請求再送一次，不會重複建立，也不會覆蓋別人的修改。');
  await expect(form.getByRole('textbox', { name: /^標題/ })).toBeDisabled();
  for (const theme of ['light', 'dark', 'versefolk'] as const) {
    await themeOf(page, theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await form.screenshot({ path: `${SHOTS}/save-pending-${theme}-390.png` });
    await noOverflow(page);
  }
  await themeOf(page, 'light');
  await form.getByRole('button', { name: '重試儲存', exact: true }).click();
  await expect(page.getByText('已新增服務。')).toBeVisible();
  expect(posts.map(post => post.status)).toEqual([201, 201]);
  expect(posts[1].key).toBe(posts[0].key);
  expect(posts[1].body).toBe(posts[0].body);
  expect((await e2eAuthPool.query(`SELECT count(*)::int AS n FROM member_services WHERE owner_user_id=$1 AND title='E2E 建立未確認'`, [owner])).rows[0].n).toBe(1);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM command_receipts WHERE user_id=$1 AND idempotency_key=$2', [owner, posts[0].key])).rows[0].n).toBe(1);
});

test('a create and a cover whose results are unknown survive a real 429 before the receipt and finish with one service and one receipt each', async ({ page, e2eAuthPool }) => {
  test.setTimeout(180_000);
  const owner = '20000000-0000-4000-8000-000000000002';
  const bucket = (scope: string) => createHash('sha256').update(`${scope}/${owner}`).digest('hex');
  const limit = async (scope: string, attempts: number) => e2eAuthPool.query(`INSERT INTO auth_rate_limits(bucket,attempts,window_start) VALUES($1,$2,now())
    ON CONFLICT(bucket) DO UPDATE SET attempts=$2,window_start=now()`, [bucket(scope), attempts]);
  await login(page, 'reviewer@local.test');
  await navigate(page, '社員服務');
  const seen: { method: string; path: string; key: string; body: string; status: number; code?: string }[] = [];
  let lose: 'POST' | 'PUT' | null = null;
  await page.route(/\/api\/v1\/member-services(\/[0-9a-f-]+\/cover)?$/, async route => {
    const request = route.request();
    if (!['POST', 'PUT'].includes(request.method())) return route.continue();
    const response = await route.fetch();
    const body = await response.json().catch(() => ({})) as { code?: string };
    seen.push({ method: request.method(), path: new URL(request.url()).pathname, key: request.headers()['idempotency-key'], body: createHash('sha256').update(request.postDataBuffer() ?? Buffer.alloc(0)).digest('hex'), status: response.status(), code: body.code });
    if (lose === request.method()) { lose = null; return route.abort('failed'); }
    return route.fulfill({ response });
  });
  const form = await fillService(page, 'E2E 限流恢復', '設計', '429 之前的回放');
  await form.locator('input[type="file"]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });

  // 1) The create commits (201) and its response is lost.
  lose = 'POST';
  await form.getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(form.getByRole('button', { name: '重試儲存', exact: true })).toBeVisible();
  expect(seen.map(item => [item.method, item.status])).toEqual([['POST', 201]]);
  // 2) The retry meets the real create rate limit, which runs before the receipt lookup; the operation is kept.
  await limit('member-service-create', 40);
  await form.getByRole('button', { name: '重試儲存', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('操作次數過多，請稍後再試。儲存結果還沒確認。稍後按「重試儲存」會用同一份內容和同一個請求再送一次，不會重複建立，也不會覆蓋別人的修改。');
  expect(seen[1]).toMatchObject({ method: 'POST', status: 429, code: 'auth_rate_limited' });
  await expect(form.getByRole('textbox', { name: /^標題/ })).toBeDisabled();
  // 3) After the window, the same key and body replay the committed create; then the cover is sent once and its response is lost.
  await limit('member-service-create', 0);
  lose = 'PUT';
  await form.getByRole('button', { name: '重試儲存', exact: true }).click();
  await expect(form.getByRole('button', { name: '重試封面', exact: true })).toBeVisible();
  expect(seen.slice(0, 3).map(item => item.status)).toEqual([201, 429, 201]);
  expect(new Set(seen.slice(0, 3).map(item => `${item.key}|${item.body}`)).size).toBe(1);
  expect(seen[3]).toMatchObject({ method: 'PUT', status: 200 });
  // 4) The cover retry meets the real cover rate limit; it is kept, then the same cover operation replays.
  await limit('member-service-cover', 20);
  await form.getByRole('button', { name: '重試封面', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('操作次數過多，請稍後再試。封面上傳結果還沒確認，服務已儲存。稍後按「重試封面」會用同一張圖片和同一個請求再送一次。');
  expect(seen[4]).toMatchObject({ method: 'PUT', status: 429, code: 'auth_rate_limited' });
  await limit('member-service-cover', 0);
  await form.getByRole('button', { name: '重試封面', exact: true }).click();
  await expect(page.getByText('已更新服務。')).toBeVisible();
  expect(seen.slice(3).map(item => item.status)).toEqual([200, 429, 200]);
  expect(new Set(seen.slice(3).map(item => `${item.key}|${item.body}`)).size).toBe(1);

  const rows = (await e2eAuthPool.query(`SELECT service_id::text AS id, aggregate_version::int AS v FROM member_services WHERE owner_user_id=$1 AND title='E2E 限流恢復'`, [owner])).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].v).toBe(2);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM command_receipts WHERE user_id=$1 AND idempotency_key=$2', [owner, seen[0].key])).rows[0].n).toBe(1);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM command_receipts WHERE user_id=$1 AND idempotency_key=$2', [owner, seen[3].key])).rows[0].n).toBe(1);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_service_covers WHERE service_id=$1', [rows[0].id])).rows[0].n).toBe(1);
});

test('another member shares it and a signed-out visitor lands on the public page', async ({ page, browser, e2eAuthPool }) => {
  test.setTimeout(120_000);
  await login(page, 'reviewer@local.test');
  await navigate(page, '社員服務');
  const target = card(page, COVER_TITLE);
  await target.getByRole('button', { name: '分享', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `分享「${COVER_TITLE}」` });
  await expect(dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
  await expect(dialog).toContainText(`${COVER_TITLE}｜示範創作者：客製假髮與造型調整`);
  goUrl = (await dialog.locator('.skill-share-url').innerText()).trim();
  for (const theme of ['light', 'versefolk'] as const) {
    await themeOf(page, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await dialog.screenshot({ path: `${SHOTS}/share-${theme}-${width}.png` });
    }
  }
  await dialog.getByRole('button', { name: '關閉分享', exact: true }).click();

  const context = await browser.newContext({ userAgent: GUEST_UA });
  const guest = await context.newPage();
  const code = new URL(goUrl).pathname.split('/').at(-1)!;
  const points = async () => Number((await e2eAuthPool.query('SELECT count(*)::int AS n FROM promotion_clicks c JOIN promotion_links l ON l.link_id=c.link_id WHERE l.code=$1', [code])).rows[0].n);
  const before = await points();
  const clicked = guest.waitForRequest(request => request.url().includes('/api/v1/promotion/clicks') && request.method() === 'POST');
  const landed = guest.waitForURL(/\/services\/[0-9a-f-]{36}$/i);
  await guest.goto(goUrl, { waitUntil: 'commit' });
  await clicked;
  // Navigation can discard the old document's keepalive response event; verify the saved credit.
  await expect.poll(points).toBe(before + 1);
  await landed;
  await expect(guest.getByRole('heading', { name: COVER_TITLE, level: 1 })).toBeVisible();
  await expect(guest.locator('meta[property="og:title"]')).toHaveAttribute('content', `${COVER_TITLE}｜示範創作者 的服務｜自由工坊`);
  await expect(guest.locator('meta[property="og:description"]')).toHaveAttribute('content', '客製假髮與造型調整');
  await expect(guest.locator('a.service-contact')).toHaveAttribute('href', 'https://example.com/wig');
  await expect(guest.locator('a.service-contact')).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  expect(await guest.content()).not.toContain('maker@local.test');
  const origin = new URL(guest.url()).origin;
  await guest.goto(`${origin}/services`);
  await expect(guest.getByRole('heading', { name: COVER_TITLE, level: 2 })).toBeVisible();
  await expect(guest.getByRole('heading', { name: PLACEHOLDER_TITLE, level: 2 })).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await guest.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 390]) {
      await guest.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await guest.screenshot({ path: `${SHOTS}/public-list-${scheme}-${width}.png`, fullPage: true });
      if (width === 390) await publicLogoFits(guest);
      else await noOverflow(guest);
    }
  }
  await guest.goto(`${origin}${servicePath}`);
  for (const scheme of ['light', 'dark'] as const) {
    await guest.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 390]) {
      await guest.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await guest.screenshot({ path: `${SHOTS}/public-detail-${scheme}-${width}.png`, fullPage: true });
      if (width === 390) await publicLogoFits(guest);
      else await noOverflow(guest);
    }
  }
  await context.close();
});

test('the click shows on the business board for the sharer', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, 'reviewer@local.test');
  await navigate(page, '推廣排行榜');
  const business = page.getByRole('article', { name: '業務推廣排行榜', exact: true });
  await expect(business).toContainText('在社員服務分享區分享社員的服務，每次點擊 +1。');
  await expect(page.getByRole('button', { name: '本週', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(business.locator('li').filter({ hasText: '示範需求者' }).locator('strong')).toHaveText('1');
  await expect(business).toContainText('我的名次：第 1 名・1 分');
  for (const theme of ['light', 'versefolk'] as const) {
    await themeOf(page, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await business.scrollIntoViewIfNeeded();
      await shot(page, `leaderboard-${theme}-${width}`);
      await noOverflow(page);
    }
  }
});

test('chips, covers and colours stay readable at phone, tablet and desktop', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page);
  await navigate(page, '社員服務');
  await page.getByRole('button', { name: '語言教學', exact: true }).click();
  await expect(page.getByRole('button', { name: '語言教學', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, PLACEHOLDER_TITLE)).toBeVisible();
  await expect(card(page, COVER_TITLE)).toHaveCount(0);
  await page.getByRole('button', { name: '美髮造型・假髮', exact: true }).click();
  await expect(card(page, COVER_TITLE)).toBeVisible();
  await expect(card(page, PLACEHOLDER_TITLE)).toHaveCount(0);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.getByLabel('標題', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新增服務', exact: true }).click();
  await expect(page.getByLabel('標題', { exact: true })).toHaveCSS('font-size', '16px');
  await page.getByRole('button', { name: '關閉表單', exact: true }).click();

  for (const width of [390, 820, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await noOverflow(page);
    const cover = card(page, COVER_TITLE).locator('img.service-cover');
    const box = (await cover.boundingBox())!;
    expect(Math.abs(box.height - box.width * 9 / 16)).toBeLessThanOrEqual(2);
    const avatar = card(page, COVER_TITLE).locator('.service-avatar');
    expect((await avatar.boundingBox())!.width).toBeLessThanOrEqual(36);
    if (width === 390) {
      const open = await card(page, COVER_TITLE).getByRole('link', { name: '服務頁 ↗' }).boundingBox();
      const share = await card(page, COVER_TITLE).getByRole('button', { name: '分享', exact: true }).boundingBox();
      expect(Math.abs(open!.y - share!.y)).toBeLessThanOrEqual(1);
      expect(open!.height).toBeGreaterThanOrEqual(44);
    }
  }

  for (const theme of ['light', 'dark', 'versefolk'] as const) {
    await themeOf(page, theme);
    const swatches = await page.locator('.service-badge').first().evaluate((element, categories) => {
      const parent = element.parentElement!;
      return (categories as string[]).map(category => {
        const clone = element.cloneNode(true) as HTMLElement;
        clone.dataset.category = category;
        parent.appendChild(clone);
        const style = getComputedStyle(clone);
        const colors = { backgroundColor: style.backgroundColor, color: style.color };
        clone.remove();
        return colors;
      });
    }, CATEGORIES);
    expect(new Set(swatches.map(item => item.backgroundColor)).size, theme).toBe(CATEGORIES.length);
    swatches.forEach((colors, index) => expect(contrast(colors.color, colors.backgroundColor), `${theme} ${CATEGORIES[index]} ${colors.color} on ${colors.backgroundColor}`).toBeGreaterThanOrEqual(3));
    const placeholder = card(page, PLACEHOLDER_TITLE).locator('.service-placeholder');
    const placeholderColors = await placeholder.evaluate(element => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, color: style.color };
    });
    const cardColor = await card(page, PLACEHOLDER_TITLE).evaluate(element => getComputedStyle(element).backgroundColor);
    expect(placeholderColors.backgroundColor, theme).not.toBe(cardColor);
    expect(contrast(placeholderColors.color, placeholderColors.backgroundColor), theme).toBeGreaterThanOrEqual(3);
    const pressed = page.getByRole('button', { name: '全部', exact: true });
    const resting = page.getByRole('button', { name: '其他', exact: true });
    const on = await pressed.evaluate(element => { const style = getComputedStyle(element); return { backgroundColor: style.backgroundColor, color: style.color }; });
    const off = await resting.evaluate(element => getComputedStyle(element).backgroundColor);
    expect(on.backgroundColor, theme).not.toBe(off);
    expect(contrast(on.color, on.backgroundColor), theme).toBeGreaterThanOrEqual(3);
  }

  const origin = new URL(page.url()).origin;
  const context = await browser.newContext({ userAgent: GUEST_UA });
  const guest = await context.newPage();
  await guest.goto(`${origin}${servicePath}`);
  for (const width of [390, 820, 1280]) {
    await guest.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await noOverflow(guest);
    const cover = guest.locator('img.service-cover');
    const box = (await cover.boundingBox())!;
    expect(Math.abs(box.height - box.width * 9 / 16)).toBeLessThanOrEqual(2);
    expect((await guest.locator('a.service-contact').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  for (const scheme of ['light', 'dark'] as const) {
    await guest.emulateMedia({ colorScheme: scheme });
    const chip = guest.locator('.service-chips a[aria-current="page"]');
    await guest.goto(`${origin}/services`);
    const on = await chip.evaluate(element => { const style = getComputedStyle(element); return { backgroundColor: style.backgroundColor, color: style.color }; });
    const off = await guest.locator('.service-chips a:not([aria-current="page"])').first().evaluate(element => getComputedStyle(element).backgroundColor);
    expect(on.backgroundColor, scheme).not.toBe(off);
    expect(contrast(on.color, on.backgroundColor), scheme).toBeGreaterThanOrEqual(3);
    const placeholder = guest.locator('.service-placeholder').first();
    const colors = await placeholder.evaluate(element => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, color: style.color, card: getComputedStyle(element.closest('article')!).backgroundColor };
    });
    expect(colors.backgroundColor, scheme).not.toBe(colors.card);
    expect(contrast(colors.color, colors.backgroundColor), scheme).toBeGreaterThanOrEqual(3);
  }
  await context.close();
});

test('the owner can pause, resume and delete a service', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page);
  await navigate(page, '社員服務');
  await card(page, COVER_TITLE).getByRole('button', { name: '暫停', exact: true }).click();
  await expect(page.locator('li.service-mine-row').filter({ hasText: COVER_TITLE })).toContainText('暫停中');
  await expect(card(page, COVER_TITLE)).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  const context = await browser.newContext({ userAgent: GUEST_UA });
  const guest = await context.newPage();
  const missing = await guest.goto(`${origin}${servicePath}`);
  expect(missing?.status()).toBe(404);
  await expect(guest.getByRole('heading', { name: '找不到這項服務' })).toBeVisible();
  await guest.setViewportSize({ width: 390, height: 844 });
  await publicLogoFits(guest);
  const withdrawn = await guest.goto(goUrl);
  expect(withdrawn?.status()).toBe(404);
  await expect(guest).toHaveURL(goUrl);
  await expect(guest.getByRole('heading', { name: '分享連結目前無法開啟', exact: true })).toBeVisible();
  await expect(guest.locator('body')).not.toContainText(COVER_TITLE);
  await expect(guest.locator('meta[property="og:title"], [data-go-destination]')).toHaveCount(0);
  await context.close();

  await page.locator('li.service-mine-row').filter({ hasText: COVER_TITLE }).getByRole('button', { name: '恢復', exact: true }).click();
  await expect(card(page, COVER_TITLE)).toBeVisible();
  const restored = await page.request.get(servicePath);
  expect(restored.status()).toBe(200);

  await card(page, PLACEHOLDER_TITLE).getByRole('button', { name: '刪除', exact: true }).click();
  await card(page, PLACEHOLDER_TITLE).getByRole('button', { name: '確定刪除', exact: true }).click();
  await expect(page.getByText('服務已刪除。')).toBeVisible();
  await expect(card(page, PLACEHOLDER_TITLE)).toHaveCount(0);
  await expect(page.locator('li.service-mine-row').filter({ hasText: PLACEHOLDER_TITLE })).toHaveCount(0);
  await signOut(page);
});

test('admin hide requires confirmation and cancelling never changes the service', async ({ page, e2eAuthPool: db }) => {
  test.setTimeout(120_000);
  const userId = randomUUID(), adminId = randomUUID(), ids = [randomUUID(), randomUUID()];
  const email = `service-admin-${userId}@example.test`;
  const titles = ids.map((id, index) => `E2E 確認隱藏 ${index} ${id}`);
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && ids.some(id => new URL(request.url()).pathname.startsWith(`/api/v1/member-services/${id}`))) writes.push(request.url());
  });
  try {
    await db.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required,email_verified_at)
      SELECT $1,$2,$3,'合成服務管理員',password_hash,$4,false,now() FROM users WHERE user_id=$5`,
    [userId, DEMO_COMMUNITY, email, randomUUID(), DEMO_USERS[0].user_id]);
    await db.query("INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state) VALUES($1,$2,$3,'guild_ai_vibe','active')", [randomUUID(), DEMO_COMMUNITY, userId]);
    await db.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)', [adminId, DEMO_COMMUNITY, email, '合成服務管理員']);
    for (const [index, id] of ids.entries()) await db.query(`INSERT INTO member_services(service_id,community_id,owner_user_id,title,category,summary,service_mode,contacts,state,created_at,updated_at)
      VALUES($1,$2,$3,$4,'other','確認前仍公開的合成服務','online','[{"label":"網站","url":"https://example.com/"}]'::jsonb,'active',now(),now())`,
    [id, DEMO_COMMUNITY, index === 0 ? DEMO_USERS[0].user_id : userId, titles[index]]);
    await login(page, email);
    await navigate(page, '社員服務');
    const ownCard = card(page, titles[1]);
    const ownRow = page.locator('li.service-mine-row').filter({ hasText: titles[1] });
    for (const origin of [ownRow, ownCard]) {
      const trigger = origin.getByRole('button', { name: '隱藏', exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const controlled = await trigger.getAttribute('aria-controls');
      expect(controlled).toBeTruthy();
      const group = origin.getByRole('group', { name: `隱藏「${titles[1]}」` });
      await expect(group).toHaveAttribute('id', controlled!);
      await expect(group).toHaveAccessibleDescription(/服務主人也看不到.*目前無法復原/);
      await expect((origin === ownRow ? ownCard : ownRow).getByRole('button', { name: '確定隱藏', exact: true })).toBeHidden();
      await page.keyboard.press('Tab');
      await expect(group.getByRole('button', { name: '確定隱藏', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(group.getByRole('button', { name: '取消', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }
    await ownRow.getByRole('button', { name: '隱藏', exact: true }).press('Enter');
    await ownCard.getByRole('button', { name: '刪除', exact: true }).press('Enter');
    await expect(ownRow.getByRole('button', { name: '確定隱藏', exact: true })).toBeHidden();
    await card(page, titles[0]).getByRole('button', { name: '隱藏', exact: true }).press('Enter');
    await expect(ownCard.getByRole('button', { name: '確定刪除', exact: true })).toBeHidden();
    await card(page, titles[0]).getByRole('button', { name: '取消', exact: true }).press('Enter');
    expect(writes).toEqual([]);
    for (const [index, id] of ids.entries()) {
      const target = card(page, titles[index]);
      const trigger = target.getByRole('button', { name: '隱藏', exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(trigger).toBeFocused();
      await expect(target.getByRole('button', { name: '確定隱藏', exact: true })).toHaveAccessibleDescription(/目前無法復原/);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(target.getByRole('button', { name: '取消', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(trigger).toBeFocused();
      await expect(target.getByRole('button', { name: '確定隱藏', exact: true })).toBeHidden();
      expect(writes).toEqual(ids.slice(0, index).map(previous => `${new URL(page.url()).origin}/api/v1/member-services/${previous}/hide`));
      expect((await db.query('SELECT state,aggregate_version::text AS version FROM member_services WHERE service_id=$1', [id])).rows).toEqual([{ state: 'active', version: '1' }]);
      expect((await page.request.get(`/services/${id}`)).status()).toBe(200);
      if (index === 1) {
        await target.getByRole('button', { name: '刪除', exact: true }).press('Enter');
        await expect(target.getByRole('button', { name: '確定刪除', exact: true })).toBeVisible();
      }
      await trigger.press('Enter');
      await expect(target.getByRole('button', { name: '確定刪除', exact: true })).toBeHidden();
      const hidden = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/member-services/${id}/hide` && response.request().method() === 'POST');
      await page.keyboard.press('Tab');
      await expect(target.getByRole('button', { name: '確定隱藏', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      expect((await hidden).status()).toBe(200);
      await expect(target).toHaveCount(0);
      await expect(page.locator('li.service-mine-row').filter({ hasText: titles[index] })).toHaveCount(0);
      expect((await db.query('SELECT state,aggregate_version::text AS version FROM member_services WHERE service_id=$1', [id])).rows).toEqual([{ state: 'hidden', version: '2' }]);
      expect((await page.request.get(`/services/${id}`)).status()).toBe(404);
    }
    expect(writes).toEqual(ids.map(id => `${new URL(page.url()).origin}/api/v1/member-services/${id}/hide`));
    await signOut(page);
    for (const account of [email, 'maker@local.test']) {
      await login(page, account);
      await navigate(page, '社員服務');
      for (const [index, id] of ids.entries()) {
        await expect(card(page, titles[index])).toHaveCount(0);
        await expect(page.locator('li.service-mine-row').filter({ hasText: titles[index] })).toHaveCount(0);
        const mine = await page.request.get('/api/v1/member-services/mine');
        expect(mine.status()).toBe(200);
        expect((await mine.json()).items.some((service: {service_id: string}) => service.service_id === id)).toBe(false);
        // Native HTTP is independent of an existing browser max-age=60 cache entry.
        expect((await page.request.get(`/services/${id}`, {headers: {'Cache-Control': 'no-cache'}})).status()).toBe(404);
        expect(await page.evaluate(async path => (await fetch(path, {cache: 'no-store'})).status, `/services/${id}`)).toBe(404);
      }
      await signOut(page);
    }
  } finally {
    await db.query('DELETE FROM member_services WHERE service_id=ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM platform_admins WHERE admin_id=$1', [adminId]);
    for (const table of ['positioning_profession_memberships', 'member_accounts', 'sessions', 'member_client_errors', 'command_receipts']) await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
    await db.query('DELETE FROM users WHERE user_id=$1', [userId]);
  }
});

test('closing the form keeps the unsent create and edit drafts apart until they are saved or cleared', async ({ page, context, e2eAuthPool }) => {
  test.setTimeout(180_000);
  const owner = '20000000-0000-4000-8000-000000000002';
  await e2eAuthPool.query('DELETE FROM member_services WHERE owner_user_id=$1', [owner]);
  const writes: string[] = [];
  page.on('request', request => { if (['POST', 'PUT', 'DELETE'].includes(request.method()) && request.url().includes('/api/v1/member-services')) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await login(page, 'reviewer@local.test');
  await navigate(page, '社員服務');
  const mine = page.getByRole('region', { name: '我的服務', exact: true });
  const form = page.locator('form.service-form');
  const toggle = mine.getByRole('button', { name: /^(新增服務|關閉表單)$/ });
  const field = (name: string) => form.getByRole('textbox', { name: new RegExp(`^${name}`) });
  const note = form.getByRole('status').filter({ hasText: '已還原上次未送出的內容' });

  // An unsent create draft, including the chosen file, survives 關閉表單 and 取消; nothing is written.
  await toggle.click();
  await field('標題').fill('E2E 草稿服務');
  await field('簡介').fill('還沒送出的簡介');
  await form.locator('input[type="file"]').setInputFiles({ name: 'draft-cover.png', mimeType: 'image/png', buffer: PNG });
  await toggle.click();
  await expect(form).toHaveCount(0);
  await toggle.click();
  await expect(field('標題')).toHaveValue('E2E 草稿服務');
  await expect(field('簡介')).toHaveValue('還沒送出的簡介');
  await expect(form.getByText('已選圖片：draft-cover.png')).toBeVisible();
  await expect(note).toBeVisible();
  await form.getByRole('button', { name: '取消', exact: true }).click();
  await toggle.click();
  await expect(field('標題')).toHaveValue('E2E 草稿服務');
  expect(writes).toEqual([]);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_services WHERE owner_user_id=$1', [owner])).rows[0].n).toBe(0);

  // 清除重填 is the explicit way to drop it.
  await note.getByRole('button', { name: '清除重填', exact: true }).click();
  await expect(field('標題')).toHaveValue('');
  await expect(form.getByText('已選圖片：draft-cover.png')).toHaveCount(0);
  await toggle.click();
  await toggle.click();
  await expect(field('標題')).toHaveValue('');
  await expect(note).toHaveCount(0);

  // Two saved services to edit.
  for (const title of ['E2E 草稿甲', 'E2E 草稿乙']) {
    if (!await form.isVisible()) await toggle.click();
    await field('標題').fill(title);
    await form.locator('select').selectOption({ label: '設計' });
    await field('簡介').fill(`${title} 原始簡介`);
    await form.getByLabel('聯絡名稱', { exact: true }).fill('官網');
    await form.getByLabel('https 連結', { exact: true }).fill('https://example.com/draft');
    await form.getByRole('button', { name: '建立服務', exact: true }).click();
    await expect(mine.locator('li.service-mine-row').filter({ hasText: title })).toBeVisible();
  }
  // A saved create leaves no draft behind.
  await toggle.click();
  await expect(field('標題')).toHaveValue('');
  await expect(note).toHaveCount(0);
  await toggle.click();

  // Edit drafts are kept per service and never leak into a new service or another service.
  const row = (title: string) => mine.locator('li.service-mine-row').filter({ hasText: title });
  await row('E2E 草稿甲').getByRole('button', { name: '編輯', exact: true }).click();
  await field('簡介').fill('甲的未存修改');
  await toggle.click();
  await toggle.click();
  await expect(field('標題')).toHaveValue('');
  await toggle.click();
  await row('E2E 草稿乙').getByRole('button', { name: '編輯', exact: true }).click();
  await expect(field('簡介')).toHaveValue('E2E 草稿乙 原始簡介');
  await expect(note).toHaveCount(0);
  await row('E2E 草稿甲').getByRole('button', { name: '編輯', exact: true }).click();
  await expect(field('簡介')).toHaveValue('甲的未存修改');
  await expect(note).toBeVisible();
  await toggle.click();

  // If the service changes elsewhere, the old edit draft is dropped instead of being applied to newer content.
  const other = await context.newPage();
  await other.goto('/');
  await navigate(other, '社員服務');
  await other.getByRole('region', { name: '我的服務', exact: true }).locator('li.service-mine-row').filter({ hasText: 'E2E 草稿甲' }).getByRole('button', { name: '編輯', exact: true }).click();
  await other.locator('form.service-form').getByRole('textbox', { name: /^簡介/ }).fill('別的分頁存的簡介');
  await other.locator('form.service-form').getByRole('button', { name: '儲存變更', exact: true }).click();
  await expect(other.getByText('已更新服務。')).toBeVisible();
  await other.close();
  await row('E2E 草稿乙').getByRole('button', { name: '暫停', exact: true }).click();
  await expect(row('E2E 草稿乙').locator('.service-state')).toHaveText('暫停中');
  await row('E2E 草稿甲').getByRole('button', { name: '編輯', exact: true }).click();
  await expect(field('簡介')).toHaveValue('別的分頁存的簡介');
  await expect(note).toHaveCount(0);
  await toggle.click();

  // Abandoning a create whose outcome is unknown drops its draft, so it cannot be submitted again under a new key.
  let lose = true;
  await page.route(/\/api\/v1\/member-services$/, async route => {
    if (route.request().method() !== 'POST' || !lose) return route.continue();
    lose = false;
    await route.fetch();
    return route.abort('failed');
  });
  await toggle.click();
  await field('標題').fill('E2E 草稿未確認');
  await form.locator('select').selectOption({ label: '設計' });
  await field('簡介').fill('結果不明');
  await form.getByLabel('聯絡名稱', { exact: true }).fill('官網');
  await form.getByLabel('https 連結', { exact: true }).fill('https://example.com/unknown');
  await form.getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(form.getByRole('button', { name: '重試儲存', exact: true })).toBeVisible();
  await form.getByRole('button', { name: '放棄並關閉', exact: true }).click();
  await toggle.click();
  await expect(field('標題')).toHaveValue('');
  await expect(note).toHaveCount(0);
  expect((await e2eAuthPool.query(`SELECT count(*)::int AS n FROM member_services WHERE owner_user_id=$1 AND title='E2E 草稿未確認'`, [owner])).rows[0].n).toBe(1);
  await toggle.click();

  for (const theme of ['light', 'dark', 'versefolk'] as const) {
    await themeOf(page, theme);
    await row('E2E 草稿乙').getByRole('button', { name: '編輯', exact: true }).click();
    await field('簡介').fill('截圖用的未存修改');
    await toggle.click();
    await row('E2E 草稿乙').getByRole('button', { name: '編輯', exact: true }).click();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await note.screenshot({ path: `${SHOTS}/draft-restored-${theme}-${width}.png` });
      await noOverflow(page);
    }
    await note.getByRole('button', { name: '清除重填', exact: true }).click();
    await toggle.click();
  }
  await themeOf(page, 'light');
});

test('a definitive cover rejection keeps the created service draft under its saved id', async ({ page, e2eAuthPool }) => {
  const owner = '20000000-0000-4000-8000-000000000002';
  await e2eAuthPool.query('DELETE FROM member_services WHERE owner_user_id=$1', [owner]);
  await login(page, 'reviewer@local.test');
  await navigate(page, '社員服務');
  const mine = page.getByRole('region', { name: '我的服務', exact: true });
  const toggle = mine.getByRole('button', { name: /^(新增服務|關閉表單)$/ });
  const form = await fillService(page, 'E2E 封面明確拒絕', '設計', '已建立的服務只重試封面', true);
  const writes: string[] = [];
  page.on('request', request => {
    if (['POST', 'PUT'].includes(request.method()) && /\/api\/v1\/member-services(?:\/[^/]+(?:\/cover)?)?$/.test(new URL(request.url()).pathname)) writes.push(request.method());
  });
  let reject = true;
  const coverStatuses: number[] = [];
  await page.route('**/api/v1/member-services/*/cover', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    if (reject) {
      reject = false;
      coverStatuses.push(400);
      return route.fulfill({ status: 400, json: { code: 'validation_failed', detail: '這張封面未通過驗證。' } });
    }
    const response = await route.fetch();
    coverStatuses.push(response.status());
    return route.fulfill({ response });
  });
  await form.getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('這張封面未通過驗證。服務已儲存。');
  const services = async () => (await e2eAuthPool.query('SELECT service_id::text AS id, title FROM member_services WHERE owner_user_id=$1', [owner])).rows;
  const saved = await services();
  expect(saved).toHaveLength(1);
  expect(saved[0].title).toBe('E2E 封面明確拒絕');
  await form.getByRole('button', { name: '取消', exact: true }).click();
  await toggle.click();
  await expect(form.getByRole('heading', { name: '新增服務', exact: true })).toBeVisible();
  await expect(form.getByRole('textbox', { name: /^標題/ })).toHaveValue('');
  await expect(form.getByRole('textbox', { name: /^簡介/ })).toHaveValue('');
  await expect(form.getByText('已選圖片：cover.png')).toHaveCount(0);
  await expect(form.getByText('已還原上次未送出的內容', { exact: false })).toHaveCount(0);
  expect(await services()).toEqual(saved);
  await mine.locator('li.service-mine-row').filter({ hasText: saved[0].title }).getByRole('button', { name: '編輯', exact: true }).click();
  await expect(form.getByRole('textbox', { name: /^標題/ })).toHaveValue(saved[0].title);
  await expect(form.getByText('已選圖片：cover.png')).toBeVisible();
  await expect(form.getByText('已還原上次未送出的內容', { exact: false })).toBeVisible();
  await form.getByRole('button', { name: '儲存變更', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(card(page, saved[0].title).locator('img.service-cover')).toBeVisible();
  expect(await services()).toEqual(saved);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_service_covers WHERE service_id=$1', [saved[0].id])).rows[0].n).toBe(1);
  expect(coverStatuses).toEqual([400, 200]);
  expect(writes).toEqual(['POST', 'PUT', 'PUT', 'PUT']);
});

test('a delayed edit completion clears only its own draft while the new draft text and image survive', async ({ page, e2eAuthPool }) => {
  const owner = '20000000-0000-4000-8000-000000000002';
  await e2eAuthPool.query('DELETE FROM member_services WHERE owner_user_id=$1', [owner]);
  await login(page, 'reviewer@local.test');
  await navigate(page, '社員服務');
  const mine = page.getByRole('region', { name: '我的服務', exact: true });
  const toggle = mine.getByRole('button', { name: /^(新增服務|關閉表單)$/ });
  const form = await fillService(page, 'E2E 延遲編輯甲', '設計', '甲原始簡介');
  await form.getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(form).toHaveCount(0);
  const id = (await e2eAuthPool.query('SELECT service_id::text AS id FROM member_services WHERE owner_user_id=$1', [owner])).rows[0].id as string;
  await fillService(page, 'E2E 保留新增 N', '設計', 'N 未送出的簡介');
  await form.locator('input[type="file"]').setInputFiles({ name: 'new-N.png', mimeType: 'image/png', buffer: PNG });
  await toggle.click();
  const row = mine.locator('li.service-mine-row').filter({ hasText: 'E2E 延遲編輯甲' });
  await row.getByRole('button', { name: '編輯', exact: true }).click();
  await form.getByRole('textbox', { name: /^簡介/ }).fill('甲已儲存的簡介');
  // Retain A once first, so successful completion must remove an existing draft entry.
  await toggle.click();
  await row.getByRole('button', { name: '編輯', exact: true }).click();
  await expect(form.getByText('已還原上次未送出的內容', { exact: false })).toBeVisible();
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let committed = false;
  await page.route(`**/api/v1/member-services/${id}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed = true;
    await gate;
    return route.fulfill({ response });
  });
  await form.getByRole('button', { name: '儲存變更', exact: true }).click();
  try {
    await expect.poll(() => committed).toBe(true);
    await toggle.click();
    await toggle.click();
    await expect(form.getByRole('heading', { name: '新增服務', exact: true })).toBeVisible();
    await expect(form.getByRole('textbox', { name: /^標題/ })).toHaveValue('E2E 保留新增 N');
    await expect(form.getByText('已選圖片：new-N.png')).toBeVisible();
  } finally { release(); }
  await expect(form).toHaveAttribute('aria-busy', 'false');
  await expect(form.getByRole('heading', { name: '新增服務', exact: true })).toBeVisible();
  await expect(form.getByRole('textbox', { name: /^標題/ })).toHaveValue('E2E 保留新增 N');
  await expect(form.getByRole('textbox', { name: /^簡介/ })).toHaveValue('N 未送出的簡介');
  await expect(form.getByText('已選圖片：new-N.png')).toBeVisible();
  expect((await e2eAuthPool.query('SELECT summary FROM member_services WHERE service_id=$1', [id])).rows[0].summary).toBe('甲已儲存的簡介');
  await toggle.click();
  await toggle.click();
  await expect(form.getByRole('textbox', { name: /^標題/ })).toHaveValue('E2E 保留新增 N');
  await expect(form.getByText('已選圖片：new-N.png')).toBeVisible();
  await row.getByRole('button', { name: '編輯', exact: true }).click();
  await expect(form.getByRole('textbox', { name: /^簡介/ })).toHaveValue('甲已儲存的簡介');
  await expect(form.getByText('已還原上次未送出的內容', { exact: false })).toHaveCount(0);
  await expect(form.getByText('已選圖片：new-N.png')).toHaveCount(0);
  await toggle.click();
  await toggle.click();
  const uploads: string[] = [];
  await page.route('**/api/v1/member-services/*/cover', route => {
    uploads.push(createHash('sha256').update(route.request().postDataBuffer()!).digest('hex'));
    return route.continue();
  });
  await form.getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(card(page, 'E2E 保留新增 N').locator('img.service-cover')).toBeVisible();
  expect(uploads).toEqual([createHash('sha256').update(PNG).digest('hex')]);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_services WHERE owner_user_id=$1', [owner])).rows[0].n).toBe(2);
});

test('clearing a restored draft resets the native picker and allows the same image to be selected and saved', async ({ page, e2eAuthPool }) => {
  const owner = '20000000-0000-4000-8000-000000000002';
  await e2eAuthPool.query('DELETE FROM member_services WHERE owner_user_id=$1', [owner]);
  await login(page, 'reviewer@local.test');
  await navigate(page, '社員服務');
  const mine = page.getByRole('region', { name: '我的服務', exact: true });
  const toggle = mine.getByRole('button', { name: /^(新增服務|關閉表單)$/ });
  const form = await fillService(page, 'E2E 清除原生選檔', '設計', '清除前的草稿');
  await form.locator('input[type="file"]').setInputFiles({ name: 'image-A.png', mimeType: 'image/png', buffer: PNG });
  await toggle.click();
  await toggle.click();
  await expect(form.getByText('已選圖片：image-A.png')).toBeVisible();
  const picker = form.locator('input[type="file"]');
  await picker.evaluate(input => {
    input.dataset.changes = '0';
    input.addEventListener('change', () => { input.dataset.changes = String(Number(input.dataset.changes) + 1); });
  });
  const imageB = { name: 'image-B.png', mimeType: 'image/png', buffer: PNG };
  await picker.setInputFiles(imageB);
  await expect(form.getByText('已選圖片：image-B.png')).toBeVisible();
  expect(await picker.evaluate(input => (input as HTMLInputElement).files?.[0]?.name)).toBe('image-B.png');
  await form.getByRole('button', { name: '清除重填', exact: true }).click();
  expect(await picker.evaluate(input => (input as HTMLInputElement).files?.length ?? 0)).toBe(0);
  await expect(picker).toHaveValue('');
  await expect(form.getByText('已選圖片：image-B.png')).toHaveCount(0);
  await picker.setInputFiles(imageB);
  await expect(picker).toHaveAttribute('data-changes', '2');
  await expect(form.getByText('已選圖片：image-B.png')).toBeVisible();
  await form.getByRole('textbox', { name: /^標題/ }).fill('E2E 重選同一張封面');
  await form.locator('select').selectOption({ label: '設計' });
  await form.getByRole('textbox', { name: /^簡介/ }).fill('清除後重新選擇 B');
  await form.getByLabel('聯絡名稱', { exact: true }).fill('官網');
  await form.getByLabel('https 連結', { exact: true }).fill('https://example.com/reselect');
  await form.getByRole('button', { name: '建立服務', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(card(page, 'E2E 重選同一張封面').locator('img.service-cover')).toBeVisible();
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_services WHERE owner_user_id=$1', [owner])).rows[0].n).toBe(1);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM member_service_covers c JOIN member_services s USING (service_id) WHERE s.owner_user_id=$1', [owner])).rows[0].n).toBe(1);
});
