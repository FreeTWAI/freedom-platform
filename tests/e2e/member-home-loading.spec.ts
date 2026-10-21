import {test, expect, type Page} from './fixtures.js';
import {expandHomeSections, openHomeGuide} from './navigation.js';

const memberId = '20000000-0000-4000-8000-000000000001';
const guild = {guild_key: 'guild_security', name: '測試資安公會'};
const book = {id: 'home-loading-book', book_id: 'home-loading-book', title: '分段載入技能書',
  description: '合成測試內容', repository_url: 'https://github.com/example/home-loading'};
const memberCard = {
  user_id: memberId, nickname: '首頁分段載入測試', last_seen_at: null, is_online: false,
  positioning_title: null, primary_guild: guild, secondary_guilds: [], joined_guilds: [],
  capabilities: [], equipment: [], contacts: {}, is_self: true, friendship: {state: 'self'},
};

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return {promise, release};
}
async function stub(page: Page, pathname: string, json: unknown) {
  await page.route(url => url.pathname === pathname, route => route.request().method() === 'GET'
    ? route.fulfill({json}) : route.fallback());
}
async function prepare(page: Page, currentBook = () => book) {
  await stub(page, `/api/v1/members/${memberId}`, memberCard);
  await page.route(url => url.pathname === '/api/v1/guilds/directory', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const data = await response.json() as {items?: {guild_key: string; skill_books?: unknown[]}[]};
    const items = Array.isArray(data.items) ? data.items : [];
    const match = items.find(item => item.guild_key === guild.guild_key);
    if (match) match.skill_books = [currentBook()];
    else items.push({guild_key: guild.guild_key, skill_books: [currentBook()]});
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
async function returnAfterStale(page: Page) {
  await page.clock.fastForward(61_000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

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

test('automatic same-guild refresh keeps the open book, claim draft, focus and work button mounted', async ({page}) => {
  await page.clock.install();
  const held = barrier();
  let refreshed = false, bookReads = 0, workReads = 0;
  await prepare(page, () => refreshed ? {...book, title: '更新後的分段載入技能書'} : book);
  await page.route(url => url.pathname === `/api/v1/members/${memberId}`, route => route.fulfill({json: {
    ...memberCard, nickname: refreshed ? '背景更新完成' : memberCard.nickname,
  }}));
  await page.route(url => url.pathname === '/api/v1/me/skill-books', async route => {
    bookReads++;
    if (refreshed) await held.promise;
    await route.fulfill({json: {items: [{book_id: book.book_id}]}});
  });
  await page.route(url => url.pathname === '/api/v1/dashboard', async route => {
    workReads++;
    if (refreshed) await held.promise;
    await route.fulfill({json: {now: [{work_item_id: 'synthetic-unfinished'}]}});
  });
  await stub(page, '/api/v1/task-board/preview', {items: []});
  await stub(page, `/api/v1/me/skill-books/${book.book_id}/author-claim`, {
    book_id: book.book_id, github_connected: true, github_login: 'synthetic-author', claims: [],
    public: {book_id: book.book_id, status: 'unclaimed', label: '尚未認領', verified: [], attributed_author: null},
  });
  await login(page);
  const resume = guidance(page).getByRole('button', {name: '回到我的工作', exact: true});
  await expect(resume).toBeVisible();
  const originalResume = await resume.elementHandle();
  await guidance(page).getByRole('button', {name: '閱讀第一本技能書', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: book.title, exact: true});
  const statement = dialog.getByLabel('聲明', {exact: true});
  const draft = '這是尚未送出的原作認領聲明，返回分頁後應保留。';
  await statement.fill(draft);
  await expect(statement).toBeFocused();
  refreshed = true;
  try {
    await returnAfterStale(page);
    await expect(page.locator('.home-member-name')).toHaveText('背景更新完成');
    await expect.poll(() => bookReads).toBe(2);
    await expect.poll(() => workReads).toBe(2);
    await expect(dialog).toHaveJSProperty('open', true);
    await expect(statement).toHaveValue(draft);
    await expect(statement).toBeFocused();
    expect(await originalResume!.evaluate(element => element.isConnected)).toBe(true);
  } finally { held.release(); }
  const updatedDialog = page.getByRole('dialog', {name: '更新後的分段載入技能書', exact: true});
  await expect(updatedDialog).toHaveJSProperty('open', true);
  await expect(updatedDialog.getByLabel('聲明', {exact: true})).toHaveValue(draft);
  await expect(updatedDialog.getByLabel('聲明', {exact: true})).toBeFocused();
  expect(await originalResume!.evaluate(element => element.isConnected)).toBe(true);
  await updatedDialog.getByRole('button', {name: '關閉技能書介紹', exact: true}).click();
  expect(await resume.evaluate((element, original) => element === original, originalResume)).toBe(true);
});

test('automatic same-guild refresh to a different guide book discards the old claim draft', async ({page}) => {
  await page.clock.install();
  const held = barrier();
  const nextBook = {...book, id: 'home-loading-book-b', book_id: 'home-loading-book-b', title: '背景更新後的公會技能書'};
  let refreshed = false, bookReads = 0, claimReads = 0;
  const submitted: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/author-claims')) submitted.push(path);
  });
  await prepare(page, () => refreshed ? nextBook : book);
  await page.route(url => url.pathname === '/api/v1/me/skill-books', route => {
    bookReads++;
    return route.fulfill({json: {items: [{book_id: refreshed ? nextBook.book_id : book.book_id}]}});
  });
  await stub(page, '/api/v1/dashboard', {now: []});
  await stub(page, '/api/v1/task-board/preview', {items: []});
  for (const item of [book, nextBook]) {
    await page.route(url => url.pathname === `/api/v1/me/skill-books/${item.book_id}/author-claim`, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      if (item === nextBook) { claimReads++; await held.promise; }
      await route.fulfill({json: {
        book_id: item.book_id, github_connected: true, github_login: 'synthetic-author', claims: [],
        public: {book_id: item.book_id, status: 'unclaimed', label: '尚未認領', verified: [], attributed_author: null},
      }});
    });
  }
  await login(page);
  const trigger = guidance(page).getByRole('button', {name: '閱讀第一本技能書', exact: true});
  await trigger.click();
  const dialog = page.getByRole('dialog', {name: book.title, exact: true});
  const draft = '這是只屬於第一本技能書、尚未送出的原作認領聲明。';
  const evidence = 'https://example.com/first-book-evidence';
  await dialog.getByLabel('聲明', {exact: true}).fill(draft);
  await dialog.getByLabel('證據網址（建議提供）', {exact: true}).fill(evidence);
  await dialog.getByRole('checkbox').check();
  await expect(dialog.getByRole('button', {name: '送出認領', exact: true})).toBeEnabled();
  refreshed = true;
  const nextDialog = page.getByRole('dialog', {name: nextBook.title, exact: true});
  try {
    await returnAfterStale(page);
    await expect.poll(() => bookReads).toBe(2);
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await trigger.click();
    await expect(nextDialog).toHaveJSProperty('open', true);
    await expect.poll(() => claimReads).toBe(1);
    const panel = nextDialog.getByRole('region', {name: '認領這件原作', exact: true});
    await expect(panel.getByRole('status')).toHaveText('正在讀取認領狀態…');
    await expect(panel.getByRole('button', {name: '送出認領', exact: true})).toHaveCount(0);
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    await expect(nextDialog).not.toContainText(book.title);
    await expect(nextDialog).not.toContainText(draft);
    await expect(nextDialog).not.toContainText(evidence);
    expect(submitted).toEqual([]);
  } finally { held.release(); }
  await expect(nextDialog.getByLabel('聲明', {exact: true})).toHaveValue('');
  await expect(nextDialog.getByLabel('證據網址（建議提供）', {exact: true})).toHaveValue('');
  await expect(nextDialog.getByRole('checkbox')).not.toBeChecked();
  await expect(nextDialog.getByRole('button', {name: '送出認領', exact: true})).toBeDisabled();
  expect(submitted).toEqual([]);
});

test('failed automatic card and onboarding reads keep good values quiet and retry missing labels', async ({page}) => {
  await page.clock.install();
  let failing = false, labelReads = 0;
  const reported: string[] = [];
  await prepare(page);
  await page.route(url => url.pathname === `/api/v1/members/${memberId}`, route => failing
    ? route.fulfill({status: 503, json: {}}) : route.fulfill({json: {...memberCard, capabilities: ['synthetic-skill']}}));
  await page.route(url => url.pathname === '/api/v1/me/onboarding', route => failing
    ? route.fulfill({status: 503, json: {}})
    : route.fulfill({json: {required: false, completed: true, entry_mode: 'quick', assessment_completed: false}}));
  await page.route(url => url.pathname === '/api/v1/assessment-definition', route => {
    labelReads++;
    return failing ? route.fulfill({json: {
      capability_categories: [{options: [{id: 'synthetic-skill', label: '重試取得的能力標籤'}]}], equipment_categories: [],
    }}) : route.fulfill({status: 503, json: {}});
  });
  await page.route(url => url.pathname === '/api/v1/me/client-errors', async route => {
    reported.push((route.request().postDataJSON() as {action: string}).action);
    await route.fulfill({json: {ok: true}});
  });
  await stub(page, '/api/v1/me/skill-books', {items: []});
  await stub(page, '/api/v1/dashboard', {now: []});
  await stub(page, '/api/v1/task-board/preview', {items: []});
  await login(page);
  await expandHomeSections(page);
  const summary = page.getByRole('region', {name: '我的會員摘要', exact: true});
  const assessment = summary.getByRole('button', {name: '補做定位測驗', exact: true});
  await expect(summary).toHaveAttribute('aria-busy', 'false');
  await expect(assessment).toBeVisible();
  await expect(summary).toContainText('synthetic-skill');
  await expect.poll(() => labelReads).toBe(1);
  failing = true;
  await returnAfterStale(page);
  await expect.poll(() => reported).toContain('GET /me/onboarding');
  await expect.poll(() => reported.some(action => action.startsWith('GET /members/'))).toBe(true);
  await expect.poll(() => labelReads).toBe(2);
  await expect(summary).toHaveAttribute('aria-busy', 'false');
  await expect(summary).toContainText(memberCard.nickname);
  await expect(summary).toContainText('重試取得的能力標籤');
  await expect(assessment).toBeVisible();
  await expect(page.locator('.home-load-error')).toHaveCount(0);
});

test('initial and manual retry card failures still show the home alert', async ({page}) => {
  await prepare(page);
  let reads = 0;
  await page.route(url => url.pathname === `/api/v1/members/${memberId}`, route => {
    reads++;
    return route.fulfill({status: 503, json: {}});
  });
  await login(page);
  const alert = page.getByRole('alert').filter({hasText: '名片暫時無法載入'});
  await expect(alert).toBeVisible();
  const before = reads;
  await alert.getByRole('button', {name: '重新載入名片', exact: true}).click();
  await expect.poll(() => reads).toBe(before + 1);
  await expect(alert.getByRole('button', {name: '重新載入名片', exact: true})).toHaveAttribute('aria-disabled', 'false');
  await expect(alert).toBeVisible();
});

test('leaving and returning to the primary guild discards the old suggestions until new reads land', async ({page}) => {
  await page.clock.install();
  const held = barrier();
  let primary: typeof guild | null = guild, nickname = memberCard.nickname, refreshed = false, waiting = 0;
  await prepare(page);
  await page.route(url => url.pathname === `/api/v1/members/${memberId}`, route => route.fulfill({json: {
    ...memberCard, primary_guild: primary, nickname,
  }}));
  for (const path of ['/api/v1/me/skill-books', '/api/v1/dashboard']) {
    await page.route(url => url.pathname === path, async route => {
      if (refreshed) { waiting++; await held.promise; }
      await route.fulfill({json: path.endsWith('/dashboard')
        ? {now: [{work_item_id: 'synthetic-unfinished'}]} : {items: [{book_id: book.book_id}]}});
    });
  }
  await stub(page, '/api/v1/task-board/preview', {items: []});
  await login(page);
  const openBook = guidance(page).getByRole('button', {name: '閱讀第一本技能書', exact: true});
  const resume = guidance(page).getByRole('button', {name: '回到我的工作', exact: true});
  await expect(openBook).toBeVisible();
  await expect(resume).toBeVisible();
  const oldBook = await openBook.elementHandle(), oldResume = await resume.elementHandle();
  try {
    refreshed = true; primary = null; nickname = '沒有主要公會';
    await returnAfterStale(page);
    await expect(page.locator('.home-member-name')).toHaveText(nickname);
    await expect(guidance(page).getByRole('button', {name: '探索職業公會', exact: true})).toBeVisible();
    expect(await oldBook!.evaluate(element => element.isConnected)).toBe(false);
    expect(await oldResume!.evaluate(element => element.isConnected)).toBe(false);
    primary = guild; nickname = '回到原公會';
    await returnAfterStale(page);
    await expect(page.locator('.home-member-name')).toHaveText(nickname);
    await expect.poll(() => waiting).toBe(2);
    await expect(openBook).toHaveCount(0);
    await expect(resume).toHaveCount(0);
  } finally { held.release(); }
  await expect(openBook).toBeVisible();
  await expect(resume).toBeVisible();
});
