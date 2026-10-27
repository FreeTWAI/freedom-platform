import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { navigate, expandHomeSections, selectSocialFeed } from './navigation.js';
import { test, expect, type Browser, type Page } from './fixtures.js';

const GUEST_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SHOTS = process.env.AUDIT_EVIDENCE_DIR ?? 'test-results/share-promotion';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const EVENT_TITLE = 'E2E 推廣點擊活動';
const YOUTUBE = 'https://www.youtube.com/watch?v=e2eDemo0001';
const LAYOUT = 'https://example.com/e2e-layout-thumb';
const PLACEHOLDER = 'https://example.com/e2e-placeholder';
const INSTAGRAM = 'https://www.instagram.com/p/E2E0001/';
const FACEBOOK = 'https://www.facebook.com/share/e2eDemoPost';
const MAKER = '20000000-0000-4000-8000-000000000001';
const COMMUNITY = '10000000-0000-4000-8000-000000000001';

test.use({ userAgent: GUEST_UA });
mkdirSync(SHOTS, { recursive: true });

let eventId = '';
let eventGo = '';
let platformGo = '';

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.addInitScript(() => {
    try { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); } catch { /* The click still falls through to copy. */ }
  });
});

test.afterAll(async ({ e2eAuthPool }) => {
  await e2eAuthPool.query(`DELETE FROM community_event_rsvps WHERE event_id IN (SELECT event_id FROM community_events WHERE title=$1)`, [EVENT_TITLE]);
  await e2eAuthPool.query(`DELETE FROM community_event_bulletins WHERE event_id IN (SELECT event_id FROM community_events WHERE title=$1)`, [EVENT_TITLE]);
  await e2eAuthPool.query(`DELETE FROM community_events WHERE title=$1`, [EVENT_TITLE]);
  await e2eAuthPool.query(`DELETE FROM community_social_posts WHERE url IN ($1,$2,$3,$4,$5) OR url LIKE 'https://www.youtube.com/watch?v=e2eDemo%'`, [YOUTUBE, PLACEHOLDER, INSTAGRAM, FACEBOOK, LAYOUT]);
  await e2eAuthPool.query(`DELETE FROM users WHERE email LIKE 'event-report-%@example.test'`);
});

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill('maker@local.test');
  await page.getByLabel('密碼', { exact: true }).fill('freedom-local-demo');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.shell')).toBeVisible({ timeout: 20_000 });
  await page.locator('.home-personal > summary').click();
}

async function creditVisit(browser: Browser, url: string, expected: (url: URL) => boolean, pool: Pool, intercept?: string) {
  const context = await browser.newContext({ userAgent: GUEST_UA });
  const guest = await context.newPage();
  if (intercept) await guest.route(intercept, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>intercepted</title>' }));
  const clicked = guest.waitForRequest(request => request.url().includes('/api/v1/promotion/clicks') && request.method() === 'POST');
  const landed = guest.waitForURL(expected);
  await guest.goto(url, { waitUntil: 'commit' });
  await clicked;
  // The source document may be discarded before a keepalive response event; await persisted credit before closing it.
  await expect.poll(() => destinationPoints(pool, new URL(url).pathname.split('/').at(-1)!)).toBeGreaterThan(0);
  if (intercept) await guest.locator('[data-go-destination]').click();
  await landed;
  await context.close();
}

function board(page: Page, name: string) {
  return page.getByRole('article', { name, exact: true });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

function channel(value: number) {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}
function contrast(foreground: string, background: string) {
  const parse = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const luminance = (value: string) => {
    const [r, g, b] = parse(value).map(channel);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const left = luminance(foreground), right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

test('a skill-book share link credits one guest click on the weekly board', async ({ page, browser, e2eAuthPool }) => {
  test.setTimeout(60_000);
  await login(page);
  await navigate(page, '技能書架');
  await page.getByRole('button', { name: '未解鎖', exact: true }).click();
  const library = page.locator('.community-library');
  await library.getByLabel('搜尋技能書', { exact: true }).fill('社群貼文');
  const card = library.locator('article[data-book-id="social-post"]');
  await card.getByRole('button', { name: '分享技能', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '分享「Hao 社群貼文技能書」', exact: true });
  const url = dialog.locator('.skill-share-url');
  await expect(url).toHaveText(/\/go\/[A-Za-z0-9_-]{10}(\?intro=\d+)?$/);
  await expect(dialog.locator('.promotion-share-points')).toHaveText(/這個連結：本週 \d+ 分・累計 \d+ 分/);
  const before = await dialog.locator('.promotion-share-points').innerText();
  const weekBefore = Number(/本週 (\d+) 分/.exec(before)![1]);
  const go = (await url.innerText()).trim();
  await page.keyboard.press('Escape');

  await creditVisit(browser, go, url => url.pathname === '/development/skills/social-post', e2eAuthPool);
  await page.goto('/');
  await navigate(page, '推廣排行榜');
  const skill = board(page, '技能推廣排行榜');
  await expect(skill).toContainText('示範創作者');
  await expect(skill).toContainText(`我的名次：第 1 名・${weekBefore + 1} 分`);
  await expect(skill.locator('li').filter({ hasText: '示範創作者' }).locator('.promotion-rank')).toHaveText('第 1 名');

  await creditVisit(browser, go, url => url.pathname === '/development/skills/social-post', e2eAuthPool);
  await page.goto(go);
  await expect(page).toHaveURL(/\/development\/skills\/social-post/);
  await page.goto('/');
  await navigate(page, '推廣排行榜');
  await expect(board(page, '技能推廣排行榜')).toContainText(`我的名次：第 1 名・${weekBefore + 1} 分`);
});

test('an event share link lands on the public page and shows the click', async ({ page, browser, e2eAuthPool }) => {
  test.setTimeout(60_000);
  eventId = randomUUID();
  await e2eAuthPool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
    VALUES($1,$2,$3,$4,'用來確認活動分享點擊。',now()-interval '29 days',now()+interval '2 days','online','線上','published','open','other')`,
  [eventId, COMMUNITY, MAKER, EVENT_TITLE]);
  await e2eAuthPool.query(`WITH source AS (SELECT password_hash FROM users WHERE user_id=$1)
    INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref)
    SELECT ('91000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid,$2,'event-report-'||value||'@example.test',
      '分頁分享者 '||lpad(value::text,2,'0'),source.password_hash,('92000000-0000-4000-8000-'||lpad(value::text,12,'0'))::uuid
    FROM generate_series(0,20) value CROSS JOIN source`, [MAKER, COMMUNITY]);
  await e2eAuthPool.query(`INSERT INTO community_event_share_codes(event_id,user_id,code)
    SELECT $1,user_id,replace(user_id::text,'-','') FROM users WHERE email LIKE 'event-report-%@example.test'`, [eventId]);
  await e2eAuthPool.query(`INSERT INTO community_event_guest_rsvps(event_id,email,name,referred_by_user_id,email_sent_at)
    VALUES($1,'event-report-guest@example.test','分享訪客',$2,now())`, [eventId, MAKER]);
  await login(page);
  await navigate(page, '社群活動');
  const card = page.locator('article.experience-card').filter({ has: page.getByRole('heading', { name: EVENT_TITLE, level: 3 }) });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: '分享活動', exact: true }).click();
  const field = card.getByLabel('分享連結');
  await expect(field).toHaveValue(/\/go\/[A-Za-z0-9_-]{10}$/);
  await expect(card.getByText('推薦碼已包含在連結內；訪客每天點開算 1 分（活動推廣排行榜）。')).toBeVisible();
  eventGo = await field.inputValue();
  await creditVisit(browser, eventGo, url => url.pathname === `/events/${eventId}` && url.searchParams.has('ref'), e2eAuthPool);
  await card.getByRole('button', { name: '分享報名統計', exact: true }).click();
  const report = card.locator('.event-referral-report');
  await expect(report.getByRole('listitem')).toHaveCount(20);
  await expect(report).toContainText('示範創作者：點擊 1・報名 1 人');
  await expect(report).toContainText('目前顯示 20 / 22 位分享會員。');
  await e2eAuthPool.query("UPDATE users SET display_name='分頁分享者 00（已更新）' WHERE user_id='91000000-0000-4000-8000-000000000000'");
  await page.route(`**/api/v1/events/${eventId}/referrals?limit=20&offset=0`,route=>route.fulfill({
    status:503,contentType:'application/problem+json',body:JSON.stringify({detail:'測試暫停第一頁刷新'}),
  }),{times:1});
  await card.getByRole('button',{name:'分享報名統計',exact:true}).click();
  await expect(report.getByRole('alert')).toContainText('服務暫時無法回應（503）');
  await expect(report.getByRole('listitem')).toHaveCount(20);
  const refreshed=page.waitForResponse(response=>response.status()===200&&new URL(response.url()).pathname===`/api/v1/events/${eventId}/referrals`&&new URL(response.url()).searchParams.get('offset')==='0');
  await report.getByRole('button',{name:'重試',exact:true}).click();await refreshed;
  await expect(report.getByRole('listitem')).toHaveCount(20);
  await expect(report).toContainText('分頁分享者 00（已更新）：點擊 0・報名 0 人');
  await expect(report.getByText('分頁分享者 00：點擊 0・報名 0 人',{exact:true})).toHaveCount(0);
  await page.route(`**/api/v1/events/${eventId}/referrals?limit=20&offset=20`, route => route.fulfill({
    status: 503, contentType: 'application/problem+json', body: JSON.stringify({ detail: '測試暫停分享統計' }),
  }), { times: 1 });
  await report.getByRole('button', { name: '載入更多', exact: true }).click();
  await expect(report.getByRole('alert')).toContainText('服務暫時無法回應（503）');
  await expect(report.getByRole('listitem')).toHaveCount(20);
  await report.getByRole('button', { name: '重試', exact: true }).click();
  await expect(report.getByRole('listitem')).toHaveCount(22);
  await expect(report).toContainText('目前顯示 22 / 22 位分享會員。');
  await expect(report.getByRole('button', { name: '載入更多', exact: true })).toHaveCount(0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await noOverflow(page);
  }
});

test('sharing the workshop from home and the leaderboard uses one personal link', async ({ page, browser, e2eAuthPool }) => {
  test.setTimeout(60_000);
  await login(page);
  await expandHomeSections(page); await page.getByRole('button', { name: '分享自由工坊', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '分享「自由工坊」', exact: true });
  await expect(dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
  await expect(dialog).toContainText('自由工坊：加入公會、領取 Repo 技能書，和夥伴一起供貨、開店與做開源作品。');
  await expect(dialog).toContainText('訪客每天點開算 1 分，自己點不算。');
  const points = dialog.locator('.promotion-share-points');
  await expect(points).toHaveText(/這個連結：本週 \d+ 分・累計 \d+ 分/);
  const weekBefore = Number(/本週 (\d+) 分/.exec(await points.innerText())![1]);
  platformGo = (await dialog.locator('.skill-share-url').innerText()).trim();
  await dialog.getByRole('button', { name: '關閉分享', exact: true }).click();

  await creditVisit(browser, platformGo, url => url.pathname === '/' && url.search === '', e2eAuthPool);
  await page.goto(platformGo);
  await expect(page).toHaveURL(url => url.pathname === '/' && url.search === '');
  await navigate(page, '推廣排行榜');
  await expect(board(page, '平台推廣排行榜')).toContainText(`我的名次：第 1 名・${weekBefore + 1} 分`);
  await page.getByRole('button', { name: '分享自由工坊', exact: true }).click();
  const again = page.getByRole('dialog', { name: '分享「自由工坊」', exact: true });
  await expect(again.locator('.skill-share-url')).toHaveText(platformGo);
  await again.getByRole('button', { name: '關閉分享', exact: true }).click();
  await creditVisit(browser, platformGo, url => url.pathname === '/' && url.search === '', e2eAuthPool);
  await page.reload();
  await expect(board(page, '平台推廣排行榜')).toContainText(`我的名次：第 1 名・${weekBefore + 1} 分`);
});

// Controlled capabilities: this case never opens LINE/Telegram or sends a message.
type PromotionTestWindow = Window & {
  promotionOpens: { url: string; target: string | undefined; features: string | undefined; active: boolean }[];
  promotionCapabilities: { kind: 'share' | 'copy'; value: ShareData | string; resolve: () => void; reject: (error: Error) => void }[];
  promotionOpenThrows: boolean;
};
async function controlPromotionCapabilities(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as PromotionTestWindow;
    w.promotionOpens = []; w.promotionCapabilities = []; w.promotionOpenThrows = false;
    window.open = (url, target, features) => {
      w.promotionOpens.push({ url: String(url), target, features, active: navigator.userActivation.isActive });
      if (w.promotionOpenThrows) throw new DOMException('Controlled browser denial', 'NotAllowedError');
      // noopener can return null even when a window opens; it is not a delivery receipt.
      return null;
    };
    const hold = (kind: 'share' | 'copy', value: ShareData | string) => new Promise<void>((resolve, reject) => {
      w.promotionCapabilities.push({ kind, value, resolve, reject });
    });
    Object.defineProperty(navigator, 'share', { configurable: true, value: (value: ShareData) => hold('share', value) });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (value: string) => hold('copy', value) } });
  });
}

test('platform choices hand the canonical referral URL to LINE and Telegram only after an explicit click', async ({ page, context }) => {
  const externalRequests: string[] = [];
  await context.route(/https:\/\/(social-plugins\.line\.me|t\.me)\//, async route => {
    externalRequests.push(route.request().url()); await route.abort();
  });
  await login(page);
  await controlPromotionCapabilities(page);
  await navigate(page, '推廣排行榜');
  await page.evaluate(() => {
    const address = new URL(location.href); address.searchParams.set('private-share', 'never-export');
    history.replaceState(history.state, '', address);
  });
  let release!: () => void, arrived!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { arrived = resolve; });
  const bodies: unknown[] = [];
  await page.route('**/api/v1/promotion/links', async route => {
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch(); arrived(); await held; await route.fulfill({ response });
  }, { times: 1 });
  expect(bodies).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as PromotionTestWindow).promotionOpens)).toEqual([]);
  await page.getByRole('button', { name: '分享自由工坊', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '分享「自由工坊」', exact: true });
  try {
    await requested;
    await expect(dialog.getByRole('button', { name: 'LINE 分享 ↗', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Telegram 分享 ↗', exact: true })).toBeDisabled();
    expect(externalRequests).toEqual([]);
  } finally { release(); }
  await expect(dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
  expect(bodies).toEqual([{ kind: 'platform', target: 'workshop' }]);
  const url = await dialog.locator('.skill-share-url').innerText();
  const text = await dialog.locator('.skill-share-text').innerText();
  expect(new URL(url).search).toBe(''); expect(new URL(url).hash).toBe('');
  expect(url).not.toContain('never-export');
  expect(await page.evaluate(() => (window as unknown as PromotionTestWindow).promotionOpens)).toEqual([]);
  for (const [index, name, endpoint] of [
    [0, 'LINE', 'https://social-plugins.line.me/lineit/share'],
    [1, 'Telegram', 'https://t.me/share/url'],
  ] as const) {
    const button = dialog.getByRole('button', { name: `${name} 分享 ↗`, exact: true });
    await button.focus(); await page.keyboard.press('Enter');
    const calls = await page.evaluate(() => (window as unknown as PromotionTestWindow).promotionOpens);
    expect(calls).toHaveLength(index + 1);
    expect(calls[index]).toEqual({ url: `${endpoint}?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, target: '_blank', features: 'noopener,noreferrer', active: true });
    await expect(dialog.getByRole('status')).toHaveText(`請在 ${name} 完成分享；若未開啟，可複製連結。`);
    await expect(dialog).not.toContainText('分享已送出');
  }
  expect(externalRequests).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as PromotionTestWindow).promotionCapabilities)).toEqual([]);
  await page.setViewportSize({ width: 320, height: 900 }); await noOverflow(page);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.evaluate(() => { (window as unknown as PromotionTestWindow).promotionOpenThrows = true; });
  await dialog.getByRole('button', { name: 'LINE 分享 ↗', exact: true }).click();
  const manual = dialog.getByLabel('手動複製分享內容', { exact: true });
  await expect(manual).toHaveValue(`${text}\n${url}`); await expect(manual).toBeFocused();
  await expect(dialog.getByRole('status')).toHaveText('無法開啟 LINE 分享，請選取並複製下方內容');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden(); await expect(page.getByRole('button', { name: '分享自由工坊', exact: true })).toBeFocused();
});

test('the home share button stays as compact as the profile button', async ({ page }) => {
  await login(page);
  await themeOf(page, 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const edit = page.getByRole('button', { name: '編輯我的名片', exact: true });
  const share = page.getByRole('button', { name: '分享自由工坊', exact: true });
  const row = page.locator('.home-member-actions');
  await expect(edit).toBeVisible();
  await expect(share).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expandHomeSections(page);
  const phoneShare = (await share.boundingBox())!;
  const phoneEdit = (await edit.boundingBox())!;
  const phoneRow = (await row.boundingBox())!;
  expect(phoneShare.height).toBeGreaterThanOrEqual(44);
  expect(phoneShare.width).toBeLessThan(phoneRow.width * 0.6);
  expect(phoneShare.width).toBeLessThanOrEqual(phoneEdit.width + 16);
  await noOverflow(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  const deskShare = (await share.boundingBox())!;
  const deskEdit = (await edit.boundingBox())!;
  // The compact left rail may wrap actions; both controls must fit their container.
  expect(deskShare.width).toBeLessThanOrEqual((await row.boundingBox())!.width);
  expect(deskShare.height).toBeGreaterThanOrEqual(44);
  expect(deskEdit.height).toBeGreaterThanOrEqual(44);
  await noOverflow(page);

  await shot(page, 'home-light-1280');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'home-light-390');
  await themeOf(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shot(page, 'home-dark-390');
  await noOverflow(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'home-dark-1280');
});

async function sharePost(page: Page, url: string, title?: string) {
  await selectSocialFeed(page,'全部動態');
  await page.locator('.social-composer-start').getByRole('button',{name:'建立貼文',exact:true}).click();
  await page.getByRole('checkbox', {name: '加入連結預覽（選填）', exact: true}).check();
  await page.getByLabel('預覽連結',{exact:true}).fill(url);
  await page.getByLabel('預覽標題（選填）').fill(title ?? '');
  const before = await page.locator('article.social-card').count();
  await page.getByRole('button', { name: '發布貼文', exact: true }).click();
  await expect(page.locator('article.social-card')).toHaveCount(before + 1);
}

test('the social zone previews, shares, replaces and keeps a thumbnail', async ({ page, browser, e2eAuthPool }) => {
  test.setTimeout(90_000);
  await login(page);
  await navigate(page, '社群分享');
  await sharePost(page, YOUTUBE);
  const youtube = page.locator('article.social-card').filter({ has: page.getByRole('heading', { name: 'E2E 示範影片', level: 3 }) });
  await expect(youtube.locator('img.social-thumb')).toBeVisible();
  await expect(youtube).toContainText('推廣點擊 0');
  await sharePost(page, PLACEHOLDER, '沒有縮圖的貼文');
  const placeholder = page.locator('article.social-card').filter({ has: page.getByRole('heading', { name: '沒有縮圖的貼文', level: 3 }) });
  await expect(placeholder.locator('.social-placeholder')).toContainText('example.com');
  await expect(placeholder.locator('img')).toHaveCount(0);
  await sharePost(page, INSTAGRAM);
  await sharePost(page, FACEBOOK, 'Facebook 示範');

  await youtube.getByRole('button', { name: '推廣原文', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '分享「E2E 示範影片」', exact: true });
  await expect(dialog.getByRole('button', { name: 'LINE 分享 ↗', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Telegram 分享 ↗', exact: true })).toHaveCount(0);
  await expect(dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
  const go = (await dialog.locator('.skill-share-url').innerText()).trim();
  await dialog.getByRole('button', { name: '關閉分享', exact: true }).click();
  await creditVisit(browser, go, url => url.href === YOUTUBE, e2eAuthPool, 'https://www.youtube.com/**');
  await page.reload();
  await selectSocialFeed(page,'全部動態');
  await expect(page.locator('article.social-card').filter({ has: page.getByRole('heading', { name: 'E2E 示範影片', level: 3 }) })).toContainText('推廣點擊 1');

  await youtube.getByText('⋯',{exact:true}).click();
  await youtube.locator('input[type="file"]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('縮圖已更新。')).toBeVisible();
  await expect(youtube.locator('img.social-thumb')).toBeVisible();
  await youtube.getByRole('link', { name: '開啟原文 ↗', exact: true }).getAttribute('href').then(href => expect(href).toBe(YOUTUBE));
  await expect(youtube.getByRole('link', { name: '開啟原文 ↗' })).toHaveAttribute('rel', 'noopener noreferrer');
});

test('social cards keep a 16:9 thumbnail, a small byline and actions on one row', async ({ page, browser, e2eAuthPool }) => {
  test.setTimeout(60_000);
  await login(page);
  await navigate(page, '社群分享');
  await sharePost(page, LAYOUT, '版面縮圖');
  const card = page.locator('article.social-card').filter({ has: page.getByRole('heading', { name: '版面縮圖', level: 3 }) });
  await card.getByText('⋯',{exact:true}).click();
  await card.locator('input[type="file"]').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('縮圖已更新。')).toBeVisible();
  const thumb = card.locator('img.social-thumb');
  await expect(thumb).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const box = await thumb.boundingBox();
    expect(box?.width).toBeGreaterThan(120);
    expect(Math.abs(box!.height - box!.width * 9 / 16)).toBeLessThanOrEqual(2);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  const avatar = await card.locator('.social-byline .social-avatar').boundingBox();
  expect(avatar!.width).toBeLessThanOrEqual(40);
  const open = await card.getByRole('link', { name: '開啟原文 ↗', exact: true }).boundingBox();
  const share = await card.getByRole('button', { name: '推廣原文', exact: true }).boundingBox();
  expect(Math.abs(open!.y - share!.y)).toBeLessThanOrEqual(1);

  await navigate(page, '推廣排行榜');
  await page.getByRole('button', { name: '分享自由工坊', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '分享「自由工坊」' });
  await expect(dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
  const go = (await dialog.locator('.skill-share-url').innerText()).trim();
  await dialog.getByRole('button', { name: '關閉分享', exact: true }).click();
  await creditVisit(browser, go, url => url.pathname === '/', e2eAuthPool);
  await page.reload();
  await navigate(page, '推廣排行榜');
  const leader = page.locator('.promotion-person .promotion-avatar').first();
  await expect(leader).toBeVisible();
  expect((await leader.boundingBox())!.width).toBeLessThanOrEqual(36);
});

test('all six boards render, and a board with no clicks says so', async ({ page }) => {
  await login(page);
  await navigate(page, '推廣排行榜');
  for (const name of ['名片點擊排行榜', '平台推廣排行榜', '技能推廣排行榜', '社群推廣排行榜', '業務推廣排行榜', '活動推廣排行榜']) {
    await expect(board(page, name)).toBeVisible();
  }
  const cards = board(page, '名片點擊排行榜');
  await expect(cards).toContainText('在我的名片分享名片連結，每次點擊 +1。');
  await expect(cards).toContainText('你在這個排行榜還沒有分數。');
  await expect(board(page, '業務推廣排行榜')).toContainText('還沒有人得分，分享第一個連結吧。');
  await expect(page.getByText('計分規則', { exact: true })).toBeVisible();
  const note = page.locator('.promotion-period-note');
  const mine = page.getByRole('region', { name: '我的推廣連結', exact: true });
  await expect(note).toHaveText(/^本週：從 \d{1,2}\/\d{1,2}（週一） 00:00（台北時間）起算。每塊榜列出前 10 名，同分同名次。$/);
  await expect(mine).toContainText('右側數字是本週的點擊分數。');
  await page.getByRole('button', { name: '本月', exact: true }).click();
  await expect(note).toHaveText(/^本月：從 \d{1,2}\/1（週.） 00:00（台北時間）起算。/);
  await expect(mine).toContainText('右側數字是本月的點擊分數。');
  await page.getByRole('button', { name: '累計', exact: true }).click();
  await expect(note).toHaveText('累計：開站以來的全部點擊。每塊榜列出前 10 名，同分同名次。');
  await expect(mine).toContainText('右側數字是累計的點擊分數。');
});

test('計分規則 shows a disclosure marker and opens from a click or Enter', async ({ page }) => {
  await login(page);
  await navigate(page, '推廣排行榜');
  const rules = page.locator('details.promotion-rules');
  const summary = rules.locator('summary');
  const copy = '同一位訪客每天點同一個連結只算 1 分';
  await expect(summary).toBeVisible();
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const marker = () => summary.evaluate(element => getComputedStyle(element, '::before').content.replaceAll('"', ''));
  expect(await marker()).toBe('▸');
  await expect(rules.getByText(copy)).toBeHidden();
  await summary.click();
  await expect(rules).toHaveJSProperty('open', true);
  await expect(rules.getByText(copy)).toBeVisible();
  expect(await marker()).toBe('▾');
  await summary.click();
  await expect(rules).toHaveJSProperty('open', false);
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(rules).toHaveJSProperty('open', true);
  await expect(rules.getByText(copy)).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(value => { localStorage.setItem('freedom-theme', value); document.documentElement.dataset.theme = value; }, theme);
    for (const width of [1280, 390] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await rules.scrollIntoViewIfNeeded();
      await expect(rules.getByText(copy)).toBeVisible();
      await rules.screenshot({ path: `${SHOTS}/promotion-rules-${theme}-${width}.png` });
    }
  }
});

test('share pages stay inside the viewport and stay readable in every theme', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await navigate(page, '社群分享');
  await selectSocialFeed(page,'全部動態');
  await page.locator('.social-composer-start').getByRole('button',{name:'建立貼文',exact:true}).click();
  await page.getByRole('checkbox', {name: '加入連結預覽（選填）', exact: true}).check();
  await expect(page.getByLabel('預覽連結',{exact:true})).toHaveCSS('font-size', '16px');
  await page.getByRole('button',{name:'關閉發文',exact:true}).click();
  for (const width of [390, 820, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    const open = page.locator('article.social-card').filter({ has: page.getByRole('heading', { name: 'E2E 示範影片' }) }).getByRole('link', { name: '開啟原文 ↗' });
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  for (const theme of ['light', 'dark', 'versefolk'] as const) {
    await page.evaluate(value => { localStorage.setItem('freedom-theme', value); document.documentElement.dataset.theme = value; }, theme);
    if (theme !== 'light') await navigate(page, '社群分享');
    await selectSocialFeed(page,'全部動態');
    const backgrounds: string[] = [];
    for (const platform of ['youtube', 'instagram', 'facebook', 'other']) {
      const badge = page.locator(`.social-card-body .social-platform-badge[data-platform="${platform}"]`).first();
      await expect(badge).toBeVisible();
      const colors = await badge.evaluate(element => {
        const style = getComputedStyle(element);
        return { backgroundColor: style.backgroundColor, color: style.color };
      });
      expect(contrast(colors.color, colors.backgroundColor), `${theme} ${platform}`).toBeGreaterThanOrEqual(3);
      backgrounds.push(colors.backgroundColor);
    }
    expect(new Set(backgrounds).size, theme).toBe(4);
    const placeholder = page.locator('.social-placeholder').first();
    const placeholderColors = await placeholder.evaluate(element => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, color: style.color };
    });
    const cardColors = await placeholder.locator('xpath=ancestor::article[1]').evaluate(element => getComputedStyle(element).backgroundColor);
    expect(placeholderColors.backgroundColor, theme).not.toBe(cardColors);
    expect(contrast(placeholderColors.color, placeholderColors.backgroundColor), theme).toBeGreaterThanOrEqual(3);
    await navigate(page, '推廣排行榜');
    const pressed = page.getByRole('button', { name: '本週', exact: true });
    const resting = page.getByRole('button', { name: '累計', exact: true });
    const on = await pressed.evaluate(element => { const style = getComputedStyle(element); return { backgroundColor: style.backgroundColor, color: style.color }; });
    const off = await resting.evaluate(element => getComputedStyle(element).backgroundColor);
    expect(on.backgroundColor, theme).not.toBe(off);
    expect(contrast(on.color, on.backgroundColor), theme).toBeGreaterThanOrEqual(3);
    expect((await pressed.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  for (const width of [390, 820, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
  }
});

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function themeOf(page: Page, theme: 'light' | 'dark' | 'versefolk') {
  await page.evaluate(value => { localStorage.setItem('freedom-theme', value); document.documentElement.dataset.theme = value; }, theme);
}

test('screenshots cover the boards, social zone, dialogs and interstitial', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page);
  for (const theme of ['light', 'versefolk'] as const) {
    await navigate(page, '推廣排行榜');
    await themeOf(page, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await shot(page, `leaderboard-${theme}-${width}`);
      await noOverflow(page);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: '分享自由工坊', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '分享「自由工坊」' });
    await expect(dialog.locator('.skill-share-url')).toBeVisible();
    await dialog.screenshot({ path: `${SHOTS}/share-dialog-${theme}-1280.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.screenshot({ path: `${SHOTS}/share-dialog-${theme}-390.png` });
    await dialog.getByRole('button', { name: '關閉分享', exact: true }).click();

    await navigate(page, '社群分享');
    await themeOf(page, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await shot(page, `social-${theme}-${width}`);
      await noOverflow(page);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await navigate(page, '社群活動');
    const card = page.locator('article.experience-card').filter({ has: page.getByRole('heading', { name: EVENT_TITLE, level: 3 }) });
    await card.scrollIntoViewIfNeeded();
    if (!await card.getByLabel('分享連結').count()) await card.getByRole('button', { name: '分享活動', exact: true }).click();
    await expect(card.getByLabel('分享連結')).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await card.screenshot({ path: `${SHOTS}/event-share-${theme}-${width}.png` });
    }
  }

  const context = await browser.newContext({ userAgent: GUEST_UA, javaScriptEnabled: false });
  const guest = await context.newPage();
  await guest.setViewportSize({ width: 1280, height: 900 });
  await guest.goto(eventGo || platformGo);
  await expect(guest.getByRole('link', { name: '開啟站內內容', exact: true })).toBeVisible();
  await guest.screenshot({ path: `${SHOTS}/interstitial-light-1280.png`, fullPage: true });
  await guest.setViewportSize({ width: 390, height: 844 });
  await guest.screenshot({ path: `${SHOTS}/interstitial-light-390.png`, fullPage: true });
  await guest.setViewportSize({ width: 1280, height: 900 });
  await guest.emulateMedia({ colorScheme: 'dark' });
  await guest.screenshot({ path: `${SHOTS}/interstitial-dark-1280.png`, fullPage: true });
  await guest.setViewportSize({ width: 390, height: 844 });
  await guest.screenshot({ path: `${SHOTS}/interstitial-dark-390.png`, fullPage: true });
  await context.close();
});

test('the author can delete their social post', async ({ page }) => {
  await login(page);
  await navigate(page, '社群分享');
  await selectSocialFeed(page,'全部動態');
  const youtube = page.locator('article.social-card').filter({ has: page.getByRole('heading', { name: 'E2E 示範影片', level: 3 }) });
  await youtube.getByText('⋯',{exact:true}).click();
  await youtube.getByRole('button', { name: '刪除', exact: true }).click();
  await page.getByRole('dialog', { name: '刪除貼文？', exact: true }).getByRole('button', { name: '確定刪除', exact: true }).click();
  await expect(youtube).toHaveCount(0);
});

async function destinationLink(page: Page, kind = 'platform', target = 'workshop') {
  const signed = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: new URL(test.info().project.use.baseURL as string).origin },
    data: { email: 'maker@local.test', password: 'freedom-local-demo' },
  });
  expect(signed.status()).toBe(200);
  const auth = await signed.json();
  const created = await page.request.post('/api/v1/promotion/links', {
    headers: { Origin: new URL(test.info().project.use.baseURL as string).origin, 'X-CSRF-Token': auth.csrf_token }, data: { kind, target },
  });
  expect(created.status()).toBe(200);
  return await created.json() as { code: string; path: string };
}

async function destinationPoints(pool: Pool, code: string) {
  return (await pool.query('SELECT count(*)::int AS n FROM promotion_clicks c JOIN promotion_links l ON l.link_id=c.link_id WHERE l.code=$1', [code])).rows[0].n as number;
}

test('share destination keeps Strict-cookie self exclusion after a cross-site entry without waiting for counting', async ({ page, context, e2eAuthPool, baseURL }) => {
  const link = await destinationLink(page);
  const before = await destinationPoints(e2eAuthPool, link.code);
  const cookies = await context.cookies();
  const strict = cookies.find(cookie => cookie.sameSite === 'Strict');
  expect(strict).toBeDefined();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let arrived!: (cookie: string) => void;
  const countingCookie = new Promise<string>(resolve => { arrived = resolve; });
  await context.route('**/api/v1/promotion/clicks', async route => {
    arrived((await route.request().allHeaders()).cookie ?? '');
    await held;
    await route.continue();
  });
  const entry = 'https://share-entry.example/';
  await context.route(entry, route => route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><a href="${baseURL}${link.path}">開啟會員分享</a>` }));
  await page.goto(entry);
  const topRequest = page.waitForRequest(request => new URL(request.url()).pathname === link.path && request.isNavigationRequest());
  try {
    await page.getByRole('link', { name: '開啟會員分享' }).click();
    expect((await (await topRequest).allHeaders()).cookie ?? '').not.toContain(strict!.name + '=');
    expect(await countingCookie).toContain(strict!.name + '=');
    await expect(page).toHaveURL(baseURL + '/');
  } finally { release(); }
  expect(await destinationPoints(e2eAuthPool, link.code)).toBe(before);
});

test('share destination finishes a delayed guest count after internal navigation', async ({ page, browser, e2eAuthPool, baseURL }) => {
  const link = await destinationLink(page);
  const before = await destinationPoints(e2eAuthPool, link.code);
  const guest = await browser.newContext({ userAgent: GUEST_UA + ' DestinationGuest/1' });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await guest.route('**/api/v1/promotion/clicks', async route => { await held; await route.continue(); });
  const visitor = await guest.newPage();
  const requested = guest.waitForEvent('request', { predicate: request => request.url().endsWith('/api/v1/promotion/clicks') });
  try {
    await visitor.goto(baseURL + link.path, { waitUntil: 'commit' });
    await requested;
    await expect(visitor).toHaveURL(baseURL + '/');
  } finally { release(); }
  // Chromium may detach the old document's response event; the database proves native keepalive delivery.
  await expect.poll(() => destinationPoints(e2eAuthPool, link.code)).toBe(before + 1);
  await guest.close();

});

test('share destination opens internal content when counting fails or fetch is unavailable', async ({ page, browser, baseURL }) => {
  const link = await destinationLink(page, 'skill_book', 'book:social-post');
  for (const mode of ['network', 'unavailable'] as const) {
    const context = await browser.newContext({ userAgent: GUEST_UA });
    if (mode === 'network') await context.route('**/api/v1/promotion/clicks', route => route.abort());
    else await context.addInitScript(() => {
      const original = window.fetch;
      window.fetch = (...args) => {
        if (String(args[0]).includes('/api/v1/promotion/clicks')) throw Error('Counting unavailable');
        return original(...args);
      };
    });
    const visitor = await context.newPage();
    await visitor.goto(baseURL + link.path, { waitUntil: 'commit' });
    await expect(visitor).toHaveURL(baseURL + '/development/skills/social-post');
    await expect(visitor.getByRole('heading', { level: 1 })).toContainText('社群貼文');
    await context.close();
  }
});

test('share destination shows the external address until an explicit action, works without JavaScript and hides withdrawn content', async ({ page, browser, e2eAuthPool, baseURL }) => {
  const postId = randomUUID();
  const target = 'https://example.com/member-project/a-clear-destination-with-a-long-path?version=2';
  const title = '會員作品：用真實範例理解工作流程';
  await e2eAuthPool.query(`INSERT INTO community_social_posts(post_id,community_id,author_user_id,url,platform,title,state)
    VALUES($1,$2,$3,$4,'other',$5,'active')`, [postId, COMMUNITY, MAKER, target, title]);
  try {
    const link = await destinationLink(page, 'social_post', postId);
    const guest = await browser.newContext({ userAgent: GUEST_UA });
    const visitor = await guest.newPage();
    const counted = visitor.waitForResponse(response => response.url().endsWith('/api/v1/promotion/clicks'));
    await visitor.goto(baseURL + link.path + '?url=https://evil.example/');
    expect((await counted).status()).toBe(200);
    // The former 1.2-second timer must never send a visitor to an external site.
    await visitor.waitForTimeout(1400);
    await expect(visitor).toHaveURL(baseURL + link.path + '?url=https://evil.example/');
    await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(visitor.locator('dd')).toHaveText(target.slice('https://'.length));
    await expect(visitor.getByText('這是外部網站。帳號、費用與資料處理，請依目的地網站說明核對。')).toBeVisible();
    const action = visitor.getByRole('link', { name: '前往 example.com ↗', exact: true });
    await expect(action).toHaveAttribute('href', target);
    await expect(visitor.locator('body')).not.toContainText('evil.example');
    for (const width of [1280, 390, 320]) {
      await visitor.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
      await noOverflow(visitor);
      expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await shot(visitor, 'share-destination-external-' + width);
    }
    await visitor.route(target, route => route.fulfill({ contentType: 'text/html', body: '<title>Destination fixture</title><h1>外部作品</h1>' }));
    await action.focus();
    await visitor.keyboard.press('Enter');
    await expect(visitor).toHaveURL(target);
    await guest.close();

    const beforeBot = await destinationPoints(e2eAuthPool, link.code);
    const bot = await browser.newContext({ userAgent: 'facebookexternalhit/1.1' });
    const botPage = await bot.newPage();
    const botCounted = botPage.waitForResponse(response => response.url().endsWith('/api/v1/promotion/clicks'));
    await botPage.goto(baseURL + link.path);
    expect((await botCounted).status()).toBe(200);
    expect(await destinationPoints(e2eAuthPool, link.code)).toBe(beforeBot);
    await bot.close();

    const noScript = await browser.newContext({ javaScriptEnabled: false });
    const plain = await noScript.newPage();
    await plain.goto(baseURL + link.path);
    await expect(plain.locator('dd')).toHaveText(target.slice('https://'.length));
    await plain.route(target, route => route.fulfill({ contentType: 'text/html', body: '<h1>外部作品</h1>' }));
    await plain.getByRole('link', { name: '前往 example.com ↗', exact: true }).click();
    await expect(plain).toHaveURL(target);
    await e2eAuthPool.query("UPDATE community_social_posts SET state='hidden' WHERE post_id=$1", [postId]);
    const unavailable = await plain.goto(baseURL + link.path);
    expect(unavailable!.status()).toBe(404);
    await expect(plain.getByRole('heading', { level: 1 })).toHaveText('分享連結目前無法開啟');
    await expect(plain.locator('body')).not.toContainText(title);
    await expect(plain.locator('[data-target],meta[property^="og:"]')).toHaveCount(0);
    await noScript.close();
  } finally { await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id=$1', [postId]); }
});

test('share destination rejects tampered executable and off-origin DOM targets and preserves replacement history', async ({ page, browser, baseURL }) => {
  const link = await destinationLink(page, 'skill_book', 'book:social-post');
  const go = baseURL + link.path;
  // Bypass CSP only in this adversarial fixture, so a broken URL guard cannot hide behind CSP.
  const context = await browser.newContext({ bypassCSP: true });
  let target = '';
  await context.route(go, async route => {
    const response = await route.fetch();
    const escaped = target.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const html = (await response.text()).replace(/data-target="[^"]*"/, `data-target="${escaped}"`);
    await route.fulfill({ response, body: html });
  });
  await context.route('**/api/v1/promotion/clicks', route => route.fulfill({ json: { ok: true } }));
  await context.route('https://outside.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Unexpected external navigation</h1>' }));
  const visitor = await context.newPage();
  try {
    for (const unsafe of [
      "javascript:document.documentElement.dataset.executed='yes'",
      "data:text/html,<script>document.documentElement.dataset.executed='yes'</script>",
      '//outside.example/work', '/\\outside.example/work', '/\n/outside.example/work',
      'https://outside.example/work', baseURL + '/development/skills/social-post',
    ]) {
      target = unsafe;
      const counted = visitor.waitForResponse(response => response.url().endsWith('/api/v1/promotion/clicks'));
      await visitor.goto(go);
      await counted;
      await expect(visitor).toHaveURL(go);
      await expect(visitor.locator('html')).not.toHaveAttribute('data-executed', 'yes');
      await expect(visitor.getByRole('link', { name: '開啟站內內容', exact: true })).toHaveAttribute('href', '/development/skills/social-post');
    }
    const previous = baseURL + '/development/skills/social-post?intro=1';
    await visitor.goto(previous);
    target = '/development/skills/../skills/social-post?intro=2';
    await visitor.goto(go, { waitUntil: 'commit' });
    await expect(visitor).toHaveURL(baseURL + '/development/skills/social-post?intro=2');
    await visitor.goBack();
    await expect(visitor).toHaveURL(previous);
  } finally { await context.close(); }
});
