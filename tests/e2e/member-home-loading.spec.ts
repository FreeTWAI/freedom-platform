import {test, expect, type Page} from './fixtures.js';
import {openHomeGuide} from './navigation.js';

const memberId = '20000000-0000-4000-8000-000000000001';
const guild = {guild_key: 'guild_security', name: '測試資安公會'};
const book = {id: 'home-loading-book', book_id: 'home-loading-book', title: '分段載入技能書',
  description: '合成測試內容', repository_url: 'https://github.com/example/home-loading'};

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return {promise, release};
}
async function stub(page: Page, pathname: string, json: unknown) {
  await page.route(url => url.pathname === pathname, route => route.request().method() === 'GET'
    ? route.fulfill({json}) : route.fallback());
}
async function prepare(page: Page) {
  await stub(page, `/api/v1/members/${memberId}`, {
    user_id: memberId, nickname: '首頁分段載入測試', last_seen_at: null, is_online: false,
    positioning_title: null, primary_guild: guild, secondary_guilds: [], joined_guilds: [],
    capabilities: [], equipment: [], contacts: {}, is_self: true, friendship: {state: 'self'},
  });
  await page.route(url => url.pathname === '/api/v1/guilds/directory', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const data = await response.json() as {items?: {guild_key: string; skill_books?: unknown[]}[]};
    const items = Array.isArray(data.items) ? data.items : [];
    const match = items.find(item => item.guild_key === guild.guild_key);
    if (match) match.skill_books = [book];
    else items.push({guild_key: guild.guild_key, skill_books: [book]});
    await route.fulfill({json: {...data, items}});
  });
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill('maker@local.test');
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
  const authenticated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login'
    && response.request().method() === 'POST');
  await page.getByRole('button', {name: '登入', exact: true}).click();
  expect((await authenticated).status()).toBe(200);
  await expect(page.getByRole('heading', {name: '會員首頁', level: 1, exact: true})).toBeVisible();
  await openHomeGuide(page);
}
const guidance = (page: Page) => page.getByRole('region', {name: '公會與技能書建議', exact: true});

test('home shows the granted book while work and task requests remain held', async ({page}) => {
  const held = barrier();
  let waiting = 0;
  await prepare(page);
  await stub(page, '/api/v1/me/skill-books', {items: [{book_id: book.book_id}]});
  for (const path of ['/api/v1/dashboard', '/api/v1/task-board/preview']) {
    await page.route(url => url.pathname === path, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      waiting++;
      await held.promise;
      await route.fulfill({json: path.endsWith('/dashboard') ? {now: []} : {items: []}});
    });
  }
  try {
    await login(page);
    await expect.poll(() => waiting).toBeGreaterThanOrEqual(2);
    await expect(guidance(page).getByRole('button', {name: '閱讀第一本技能書', exact: true})).toBeVisible();
    await expect(guidance(page).getByRole('button', {name: '分享作品與需求', exact: true})).toHaveCount(0);
  } finally { held.release(); }
  await expect(guidance(page).getByRole('button', {name: '分享作品與需求', exact: true})).toBeVisible();
});

test('home resumes unfinished work without waiting for grants or task board', async ({page}) => {
  const held = barrier();
  let waiting = 0;
  await prepare(page);
  await stub(page, '/api/v1/dashboard', {now: [{work_item_id: 'synthetic-unfinished'}]});
  for (const path of ['/api/v1/me/skill-books', '/api/v1/task-board/preview']) {
    await page.route(url => url.pathname === path, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      waiting++;
      await held.promise;
      await route.fulfill({json: {items: []}});
    });
  }
  try {
    await login(page);
    await expect.poll(() => waiting).toBeGreaterThanOrEqual(2);
    await expect(guidance(page).getByRole('button', {name: '回到我的工作', exact: true})).toBeVisible();
    await expect(guidance(page).getByRole('button', {name: '閱讀第一本技能書', exact: true})).toHaveCount(0);
  } finally { held.release(); }
  await expect(guidance(page).getByRole('button', {name: '回到我的工作', exact: true})).toBeVisible();
});

test('failed grant lookup leaves ordinary navigation and confirmed tasks available', async ({page}) => {
  await prepare(page);
  await page.route(url => url.pathname === '/api/v1/me/skill-books', route => route.fulfill({status: 503, body: ''}));
  await stub(page, '/api/v1/dashboard', {now: []});
  await stub(page, '/api/v1/task-board/preview', {items: [{work_item_id: 'synthetic-open'}]});
  await login(page);
  await expect(guidance(page).getByRole('button', {name: '前往技能書架', exact: true})).toBeVisible();
  await expect(guidance(page).getByRole('button', {name: '查看社群任務', exact: true})).toBeVisible();
  await expect(guidance(page).getByRole('button', {name: '閱讀第一本技能書', exact: true})).toHaveCount(0);
});
