import { test, expect, type Page } from './fixtures.js';
import { navigate } from './navigation.js';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill('maker@local.test');
  await page.getByLabel('密碼', { exact: true }).fill('freedom-local-demo');
  const authResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST', {timeout: 25_000});
  await page.getByRole('button', { name: '登入', exact: true }).click();
  expect((await authResponse).status()).toBe(200);
  await expect(page.locator('.shell')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/me/github', route => route.fulfill({ json: { configured: false, connected: false, github_user: null } }));
});

test('navigation separates collaboration, commerce and management without granting a member a guild role', async ({ page }) => {
  await page.route('**/api/v1/guild-workspace', route => route.fulfill({ json: { managed_guilds: [], managed_books: [], can_discuss: false } }));
  await login(page);
  const nav = page.getByRole('navigation', { name: '主要工作區' });
  await expect(nav.locator('.nav-primary button')).toHaveText(['動態', '探索', '公會', '自動化', '我的']);
  await expect(nav.locator('.nav-more,.nav-search')).toHaveCount(0);
  await nav.getByRole('button', {name:'我的',exact:true}).click();
  await expect(page.getByRole('link', {name:'管理',exact:true})).toHaveCount(0);
  await navigate(page, '職業公會');
  await expect(page.getByRole('button', {name:'公會管理',exact:true})).toHaveCount(0);
  await expect(nav.getByText('參與平台', {exact:true})).toHaveCount(0);
  await expect(nav.getByText('我的協作', {exact:true})).toHaveCount(0);
  await navigate(page, '開源投稿');
  await expect(page.getByRole('heading', { name: '動態', level: 1, exact: true })).toBeVisible();
  await expect(page.locator('.community-library')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '投稿你的開源工具', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '上傳技能', exact: true })).toBeHidden();
  await page.getByText('使用 Agent 或聊天 AI 協助整理（進階）', { exact: true }).click();
  await expect(page.getByRole('button', { name: '上傳技能', exact: true })).toBeVisible();
  // Platform catalogs, orders and the two AI tools now have distinct visible
  // place/view/tool entries instead of aliases in the removed feature search.
  for (const [label, hash, heading] of [
    ['供貨商品管理', '#guilds/guild_product_quality_supply/tools/catalog', '供貨商品庫'],
    ['購買與預留紀錄', '#me/orders', '我的'],
    ['AI 製作銷售網站', '#guilds/guild_commerce_sales/tools/retail-kit', '零售工具'],
    ['AI 整理供貨商品', '#guilds/guild_product_quality_supply/tools/supplier-kit', '供貨工具'],
  ]) {
    await navigate(page, label);
    await expect.poll(() => new URL(page.url()).hash).toBe(hash);
    await expect(page.getByRole('heading', {name:heading,level:1,exact:true})).toBeVisible();
  }
  await expect(page.getByLabel('公會功能', {exact:true})).toHaveValue('tools');
  await expect(page.getByRole('button', {name:'工具列表',exact:true})).toBeVisible();
  await expect(nav.getByRole('button', {name:'公會',exact:true})).toHaveAttribute('aria-current', 'page');

});

test('a synthetic maintainer permission projection reveals guild management without platform management', async ({ page }) => {
  await page.route('**/api/v1/guild-workspace', route => route.fulfill({ json: { managed_guilds: [], managed_books: [{ book_id: 'social-post', title: '測試維護技能' }], can_discuss: false } }));
  await page.route('**/api/v1/skill-books/social-post/editor', route => route.fulfill({ json: { book_id: 'social-post', summary: '測試技能摘要', collaboration_intro: '從公開任務開始', tasks: [], milestones: [], aggregate_version: 1 } }));
  await login(page); await navigate(page, '公會管理');
  const nav = page.getByRole('navigation', { name: '主要工作區' });
  await expect(nav.getByRole('button', {name:'公會',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('button', {name:'公會管理',exact:true})).toBeVisible();
  await expect(nav.getByRole('link', {name:/平台管理/,includeHidden:true})).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '公會', level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '技能書編輯', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '公會長議事區', exact: true })).toHaveCount(0);
  await navigate(page, '我的個人空間');
  await expect(page.getByRole('link', {name:'管理',exact:true})).toHaveCount(0);
});

test('phone navigation opens, escapes and closes after selection while keeping every destination reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  const menu = page.getByRole('button', { name: /^(開啟|關閉)選單$/ });
  const nav = page.getByRole('navigation', { name: '主要工作區', includeHidden: true });
  await expect(menu).toHaveAttribute('aria-expanded', 'false'); await expect(nav).toBeHidden();
  await menu.click(); await expect(menu).toHaveAttribute('aria-expanded', 'true'); await expect(nav).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden(); await expect(menu).toBeFocused();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [label, heading] of [['技能書架', '探索'], ['一起開發', '作品共創'], ['AI 整理供貨商品', '供貨工具'], ['工坊夥伴', '探索'], ['活動集錦', '探索'], ['自由工坊社群', '公會'], ['會員首頁', '動態']]) {
      await navigate(page, label);
      await expect(page.getByRole('heading', { name: heading, level: 1, exact: true })).toBeVisible();
      await expect(nav).toBeHidden(); await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await expect(menu).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      // Selecting the current page still closes the menu and releases hidden navigation focus.
      await navigate(page, label);
      await expect(nav).toBeHidden();
      await expect(page.locator('#main-content')).toBeFocused();
    }
  }
});

test('skip navigation preserves the module, and deep links plus browser history preserve selected destinations', async ({ page }) => {
  await login(page); await page.goto('/#positioning');
  await expect(page.getByRole('heading', { name: '定位測驗', level: 1, exact: true })).toBeVisible();
  const skip = page.getByRole('link', { name: '跳到主要內容', exact: true });
  await skip.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#guilds\/guild_talent_direction\/tools\/assessment$/); await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.locator('.positioning-heading')).toHaveCount(0);
  await navigate(page, '技能書架'); await navigate(page, '開源投稿');
  await page.goBack(); await expect(page).toHaveURL(/#home$/);
  await page.goBack(); await expect(page).toHaveURL(/#explore\/resources$/);
  await expect(page.getByRole('heading', { name: '探索', level: 1, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '探索', level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await navigate(page, '自由工坊社群');
  await expect(page.locator('.community-library')).toHaveCount(0);
  await page.getByRole('button', { name: '前往技能書架', exact: true }).click();
  await expect(page).toHaveURL(/#explore\/resources$/);
  await navigate(page, '我的名片');
  await expect(page.locator('.member-bookshelf,.community-library')).toHaveCount(0);
});

test('unlocked and locked shelves partition the authoritative catalog and free previews do not grant a book', async ({ page }) => {
  await login(page);
  const catalog = await (await page.request.get('/api/v1/community')).json();
  const chosen = ['social-post', 'video-autopilot'];
  // The scope tabs partition the guild-designated books; 社群技能書 have their own shelf and are never locked.
  const allIds = catalog.skill_books.filter((book: { official_guild_keys: string[] }) => book.official_guild_keys.length > 0).map((book: { id: string }) => book.id).sort();
  const communityIds = catalog.skill_books.filter((book: { official_guild_keys: string[] }) => book.official_guild_keys.length === 0).map((book: { id: string }) => book.id).sort();
  const actualGrants = await (await page.request.get('/api/v1/me/skill-books')).json();
  await page.route('**/api/v1/me/skill-books', route => route.fulfill({ json: { items: chosen.map(book_id => ({ book_id })) } }));
  await navigate(page, '技能書架');
  const library = page.locator('.community-library'), cards = library.locator('article[data-book-id]');
  const tabs = page.getByRole('group', { name: '技能書範圍', exact: true });
  const unlocked = tabs.getByRole('button', { name: /^已解鎖(?: · \d+)?$/ }), locked = tabs.getByRole('button', { name: '未解鎖', exact: true });
  const ids = () => cards.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-book-id')!).sort());
  await expect(unlocked).toHaveAttribute('aria-pressed', 'true');
  await expect(cards).toHaveCount(2); expect(await ids()).toEqual(chosen);
  await expect(cards.getByRole('button', { name: '閱讀技能書', exact: true })).toHaveCount(2);
  await expect(cards.getByRole('button', { name: '預覽技能書', exact: true })).toHaveCount(0);
  await locked.click(); await expect(locked).toHaveAttribute('aria-pressed', 'true');
  await expect(cards).toHaveCount(allIds.length - chosen.length);
  const lockedIds = await ids();
  expect(lockedIds.filter(id => chosen.includes(id))).toEqual([]);
  expect([...chosen, ...lockedIds].sort()).toEqual(allIds);
  const shared = page.locator('.community-skill-library article[data-book-id]');
  await expect(shared).toHaveCount(communityIds.length);
  expect(await shared.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-book-id')!).sort())).toEqual(communityIds);
  await expect(shared.getByRole('button', { name: '預覽技能書', exact: true })).toHaveCount(0);
  await expect(cards.getByRole('button', { name: '預覽技能書', exact: true })).toHaveCount(lockedIds.length);
  await expect(cards.getByRole('button', { name: '閱讀技能書', exact: true })).toHaveCount(0);
  // A category absent from the unlocked subset must not leave that subset empty.
  const category = library.getByRole('combobox', { name: '依工坊用途篩選', exact: true });
  await category.selectOption({ label: '資訊安全' }); await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute('data-book-id', 'security-scanner');
  await cards.getByRole('button', { name: '預覽技能書', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'AI Security Scanner', exact: true });
  await expect(preview).toBeVisible(); await expect(preview.getByRole('link', { name: '閱讀技能書 ↗', exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '關閉技能書介紹', exact: true }).click();
  await unlocked.click(); await expect(cards).toHaveCount(2); expect(await ids()).toEqual(chosen);
  await expect(category).toHaveValue(''); await expect(category.locator('option').filter({ hasText: /^資訊安全$/ })).toHaveCount(0);
  await locked.click(); await expect(cards).toHaveCount(lockedIds.length); expect(await ids()).toEqual(lockedIds);
  expect(await (await page.request.get('/api/v1/me/skill-books')).json()).toEqual(actualGrants);
});

test('an unavailable grant list never classifies all books as locked and retry preserves the selected scope', async ({ page }) => {
  await login(page);
  const catalog = await (await page.request.get('/api/v1/community')).json();
  let failing = true;
  await page.route('**/api/v1/me/skill-books', route => failing
    ? route.fulfill({ status: 503, json: { detail: 'Synthetic shelf read failure' } })
    : route.fulfill({ json: { items: [{ book_id: 'social-post' }] } }));
  await navigate(page, '技能書架');
  const tabs = page.getByRole('group', { name: '技能書範圍' });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.community-library article[data-book-id]')).toHaveCount(0);
  await tabs.getByRole('button', { name: '未解鎖', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.community-library article[data-book-id]')).toHaveCount(0);
  failing = false;
  await page.getByRole('button', { name: '重新載入解鎖紀錄', exact: true }).click();
  await expect(page.locator('.community-library article[data-book-id]')).toHaveCount(catalog.skill_books.filter((book: { official_guild_keys: string[] }) => book.official_guild_keys.length > 0).length - 1);
  await expect(page.locator('.community-library article[data-book-id="social-post"]')).toHaveCount(0);
  await expect(tabs.getByRole('button', { name: '未解鎖', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await tabs.getByRole('button', { name: /^已解鎖(?: · \d+)?$/ }).click();
  await expect(page.locator('.community-library article[data-book-id]')).toHaveCount(1);
  await expect(page.locator('.community-library article[data-book-id]')).toHaveAttribute('data-book-id', 'social-post');
});
