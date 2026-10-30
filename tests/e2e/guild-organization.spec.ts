import { test, expect, type Locator, type Page, type Route } from './fixtures.js';
import { navigate } from './navigation.js';
import { communityCatalog } from '../../modules/community/catalog.js';

async function openGuildSetting(button: Locator) {
  const settings = button.locator('xpath=ancestor::details[contains(@class,"guild-membership-settings")]');
  await expect(settings).toBeAttached();
  if (!await settings.evaluate(node => (node as HTMLDetailsElement).open)) await settings.locator(':scope > summary').click();
  await expect(button).toBeVisible();
}
async function chooseGuildSetting(button: Locator) { await openGuildSetting(button); await button.click(); }

const names = ['測試平台公會', '測試影像與自動剪輯公會', '測試資安公會', '測試音樂公會', '測試活動與空間規劃公會', '測試光雕公會'];
const keys = names.map((_, index) => `synthetic-guild-${index}`);
const books = ['social-post', 'video-autopilot', 'security-scanner'].map(id => communityCatalog.skill_books.find(book => book.id === id)!);

type Preferences = { primary_guild_key: string; secondary_guild_keys: string[]; aggregate_version: number };
async function setupGuilds(page: Page, masterId?: string) {
  let preferences: Preferences = { primary_guild_key: keys[0], secondary_guild_keys: [keys[1], keys[2]], aggregate_version: 7 };
  const writes: { body: unknown; headers: Record<string, string> }[] = [];
  let memberReads = 0, announcementReads = 0;
  const directory = () => names.map((name, index) => ({
    guild_key: keys[index], name, purpose: index === 1 ? '把很長的協作專業說明、不同人數的公會幹部與技能書排成一致的卡片。' : '交流專長，一起完成作品。',
    first_step: '閱讀入門技能', track_count: 1, tags: [index % 2 === 0 ? 'technology' : 'creation'],
    is_primary: keys[index] === preferences.primary_guild_key,
    is_secondary: preferences.secondary_guild_keys.includes(keys[index]),
    secondary_position: preferences.secondary_guild_keys.indexOf(keys[index]) + 1,
    membership: index < 5 ? { membership_id: `membership-${index}`, state: 'active', aggregate_version: 1 } : null,
    guild_master: index === 5 ? null : { user_id: index === 0 && masterId ? masterId : `master-${index}`, display_name: index === 1 ? '一位名字很長的影像自動剪輯公會長' : `測試會長 ${index}`, avatar_url: null },
    guild_experts: Array.from({ length: [0, 3, 1, 2, 3, 0][index] }, (_, expert) => ({ user_id: `expert-${index}-${expert}`, display_name: expert === 2 ? '專注跨領域音樂影像與內容共創的測試專家' : `測試專家 ${index}-${expert}`, avatar_url: null })),
    skill_books: index === 0 ? books : [books[index % books.length]],
  }));
  await page.route('**/api/v1/guilds/directory', async route => {
    if(writes.length)await new Promise(resolve=>setTimeout(resolve,120));
    await route.fulfill({ json: { items: directory() } });
  });
  await page.route('**/api/v1/me/guild-preferences', route => route.fulfill({ json: preferences }));
  await page.route('**/api/v1/me/guild-preferences/secondary', route => {
    const body = route.request().postDataJSON();
    writes.push({ body, headers: route.request().headers() });
    preferences = { ...preferences, secondary_guild_keys: body.secondary_guild_keys, aggregate_version: preferences.aggregate_version + 1 };
    return route.fulfill({ json: preferences });
  });
  await page.route('**/api/v1/guild-applications', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/me/skill-books', route => route.fulfill({ json: { items: books.map(book => ({ book_id: book.id })) } }));
  await page.route('**/api/v1/me/github', route => route.fulfill({ json: { configured: false, connected: false, github_user: null } }));
  await page.route('**/api/v1/github/books/*/metrics', route => route.fulfill({ json: { book_id: route.request().url().split('/').at(-2), repository_url: null, stargazers_count: null, forks_count: null, open_issues_count: null, subscribers_count: null, pushed_at: null, language: null, archived: null, checked_at: null, stale: false, error: 'synthetic_unavailable' } }));
  await page.route('**/api/v1/members?*', route => { memberReads++; return route.fulfill({ json: { items: [], total: 0, next_offset: null } }); });
  await page.route('**/api/v1/guilds/*/announcements', route => {
    announcementReads++;
    return route.fulfill({ json: { items: [{ announcement_id: 'synthetic-announcement', title: '測試共創日', body: '帶一份可以公開的合成素材。', state: 'published', updated_at: '2026-09-23T00:00:00Z' }] } });
  });
  return { writes, directory, reads: () => ({ memberReads, announcementReads }) };
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill('maker@local.test');
  await page.getByLabel('密碼', { exact: true }).fill('freedom-local-demo');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await navigate(page, '職業公會');
}
const group = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const guildIds = (page: Page, name: string) => group(page, name).locator('.guild-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-guild-key')));

test('six synthetic guilds partition featured, other joined and unjoined memberships with lazy detail dialogs', async ({ page }) => {
  const fixture = await setupGuilds(page); await login(page);
  await expect(group(page, '主要與次要公會').locator('.guild-card')).toHaveCount(3);
  await expect(group(page, '其他已加入公會').locator('.guild-card')).toHaveCount(2);
  await expect(group(page, '未加入公會').locator('.guild-card')).toHaveCount(1);
  expect(await guildIds(page, '主要與次要公會')).toEqual(keys.slice(0, 3));
  expect(await guildIds(page, '其他已加入公會')).toEqual(keys.slice(3, 5));
  expect(await guildIds(page, '未加入公會')).toEqual([keys[5]]);
  expect(await page.locator('.guild-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-guild-key')))).toEqual(keys);
  expect(fixture.reads()).toEqual({ memberReads: 0, announcementReads: 0 });
  const primary = page.getByRole('article', { name: names[0], exact: true });
  await expect(primary.locator('.guild-book-list')).toContainText('入門技能');
  await expect(primary.locator('.guild-book-list .skill-intro-trigger')).toHaveCount(1);
  await expect(primary.locator('.guild-book-list').getByRole('button', { name: books[0].title, exact: true })).toBeVisible();
  await expect(primary.locator('.guild-book-list').getByRole('button', { name: books[1].title, exact: true })).toHaveCount(0);
  const openBooks = primary.getByRole('button', { name: '公會技能書庫 · 3', exact: true });
  const initialHeight = (await primary.boundingBox())!.height;
  await openBooks.click();
  const library = primary.getByRole('dialog', { name: `${names[0]}技能書庫`, exact: true });
  await expect(library).toBeVisible(); await expect(library.locator('.guild-library-entry')).toHaveCount(3);
  await library.getByRole('button', { name: books[1].title, exact: true }).click();
  const introduction = page.getByRole('dialog', { name: books[1].title, exact: true });
  await expect(introduction).toBeVisible(); await expect(introduction.getByRole('link', { name: '閱讀技能書 ↗', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(introduction).toBeHidden(); await expect(library).toBeVisible();
  await library.getByRole('button', { name: '關閉公會視窗', exact: true }).click();
  await expect(library).toBeHidden(); await expect(openBooks).toBeFocused();
  expect(Math.abs((await primary.boundingBox())!.height - initialHeight)).toBeLessThanOrEqual(2);
  await primary.getByRole('button', { name: '查看成員', exact: true }).click();
  const members = primary.getByRole('dialog', { name: `${names[0]}成員`, exact: true });
  await expect(members.getByRole('region', { name: `${names[0]}成員`, exact: true })).toContainText('目前沒有可顯示的公會成員。');
  await members.getByRole('button', { name: '關閉公會視窗', exact: true }).click();
  await primary.getByRole('button', { name: '公會公告', exact: true }).click();
  const announcements = primary.getByRole('dialog', { name: `${names[0]}公告`, exact: true });
  await expect(announcements.locator('.guild-announcements')).toHaveAttribute('open'); await expect(announcements).toContainText('帶一份可以公開的合成素材。');
  await announcements.getByRole('button', { name: '關閉公會視窗', exact: true }).click();
  expect(fixture.reads()).toEqual({ memberReads: 1, announcementReads: 1 });
  expect(Math.abs((await primary.boundingBox())!.height - initialHeight)).toBeLessThanOrEqual(2);
});

for (const collapseTools of [false, true]) {
  test(`canceling secondary-guild settings returns keyboard focus with tools ${collapseTools ? 'collapsed' : 'open'}`, async ({ page }) => {
    const fixture = await setupGuilds(page); await login(page);
    const membershipsBefore = fixture.directory().map(guild => guild.membership);
    const tools = page.locator('.guild-tools-disclosure');
    const summary = tools.locator(':scope > summary');
    const trigger = tools.getByRole('button', { name: '設定次要公會', exact: true });
    await summary.click(); await trigger.click();
    const editor = page.locator('#secondary-guild-editor');
    await editor.getByRole('checkbox', { name: new RegExp(`^${names[2]}`) }).uncheck();
    if (collapseTools) await summary.click();
    await expect(editor).toBeVisible();
    const cancel = editor.getByRole('button', { name: '取消', exact: true });
    await cancel.focus(); await page.keyboard.press('Enter');
    await expect(editor).toHaveCount(0);
    await expect(collapseTools ? summary : trigger).toBeFocused();
    expect(await tools.evaluate(element => (element as HTMLDetailsElement).open)).toBe(!collapseTools);
    expect(fixture.writes).toHaveLength(0);
    expect(fixture.directory().map(guild => guild.membership)).toEqual(membershipsBefore);
    if (collapseTools) await summary.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(editor.getByRole('checkbox', { name: new RegExp(`^${names[2]}`) })).toBeChecked();
  });
}

test('the secondary-guild editor sends a versioned command and reloads the synthetic saved preference without changing memberships', async ({ page }) => {
  const fixture = await setupGuilds(page); await login(page);
  const membershipsBefore = fixture.directory().map(guild => guild.membership);
  await page.locator('.guild-tools-disclosure > summary').click();
  await page.getByRole('button', { name: '設定次要公會', exact: true }).click();
  const editor = page.locator('#secondary-guild-editor');
  await page.locator('.guild-tools-disclosure > summary').click();
  await expect(editor).toBeVisible(); // Closing optional tools must not hide an active editor.
  await expect(editor.getByRole('checkbox')).toHaveCount(4);
  const choice = (index: number) => editor.getByRole('checkbox', { name: new RegExp(`^${names[index]}`) });
  await expect(choice(1)).toBeChecked(); await expect(choice(2)).toBeChecked();
  await expect(choice(3)).toBeDisabled(); await expect(choice(4)).toBeDisabled();
  await expect(editor.getByRole('checkbox', { name: names[0], exact: true })).toHaveCount(0);
  await expect(editor.getByRole('checkbox', { name: names[5], exact: true })).toHaveCount(0);
  await choice(2).uncheck(); await expect(choice(3)).toBeEnabled(); await choice(3).check();
  await expect(choice(2)).toBeDisabled(); await expect(choice(4)).toBeDisabled();
  await editor.getByRole('button', { name: '儲存次要公會', exact: true }).click();
  await expect(editor).toHaveCount(0); await expect(page.getByRole('region', { name: '公會目錄', exact: true }).getByRole('status').filter({ hasText: '次要公會已儲存。' })).toBeVisible();
  expect(fixture.writes).toHaveLength(1);
  expect(fixture.writes[0].body).toEqual({ secondary_guild_keys: [keys[1], keys[3]] });
  expect(fixture.writes[0].headers['if-match']).toBe('"7"');
  expect(fixture.writes[0].headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(fixture.writes[0].headers['x-csrf-token']).toBeTruthy();
  await expect(group(page, '主要與次要公會').locator('.guild-card')).toHaveCount(3);
  expect(await guildIds(page, '主要與次要公會')).toEqual([keys[0], keys[1], keys[3]]);
  expect(await guildIds(page, '其他已加入公會')).toEqual([keys[2], keys[4]]);
  await page.reload(); await expect(group(page, '主要與次要公會').locator('.guild-card')).toHaveCount(3);
  await expect(group(page, '主要與次要公會').locator('.guild-card')).toHaveCount(3);
  expect(await guildIds(page, '主要與次要公會')).toEqual([keys[0], keys[1], keys[3]]);
  expect(fixture.directory().map(guild => guild.membership)).toEqual(membershipsBefore);
  await page.locator('.guild-tools-disclosure > summary').click();
  await page.getByRole('button', { name: '設定次要公會', exact: true }).click();
  await choice(1).uncheck(); await choice(3).uncheck();
  await editor.getByRole('button', { name: '儲存次要公會', exact: true }).click();
  await expect(editor).toHaveCount(0); await expect(group(page, '主要與次要公會').locator('.guild-card')).toHaveCount(1);
  await expect(group(page, '其他已加入公會').locator('.guild-card')).toHaveCount(4);
  expect(fixture.writes[1].body).toEqual({ secondary_guild_keys: [] });
  expect(fixture.writes[1].headers['if-match']).toBe('"8"');
  expect(fixture.writes[1].headers['idempotency-key']).not.toBe(fixture.writes[0].headers['idempotency-key']);
});

test('guild cards stay equal across all groups and keep every leader and expert readable at desktop and narrow phone widths', async ({ page }) => {
  const fixture = await setupGuilds(page); await login(page);
  const cards = page.locator('.guild-card'); await expect(cards).toHaveCount(6);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    // Content must still fit before a new shared-height measurement arrives.
    expect(await cards.evaluateAll(nodes => nodes.every(node => node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1))).toBe(true);
    // ResizeObserver may update the common intrinsic height on the next frame.
    await expect.poll(async () => cards.evaluateAll(nodes => {
      const heights = nodes.map(node => node.getBoundingClientRect().height); return Math.max(...heights) - Math.min(...heights);
    })).toBeLessThanOrEqual(2);
    for (const guild of fixture.directory()) {
      const card = page.locator(`.guild-card[data-guild-key="${guild.guild_key}"]`);
      const rows = card.locator('.guild-leadership-row'); await expect(rows).toHaveCount(1 + guild.guild_experts.length);
      await expect(rows.first()).toHaveClass(/guild-master/);
      for (const row of await rows.all()) {
        await expect(row).toBeVisible(); await expect(row.locator('.guild-leadership-avatar')).toBeVisible();
        const fits = await row.evaluate(node => {
          const box = node.getBoundingClientRect(), name = node.querySelector<HTMLElement>('.guild-leadership-name')!, role = node.querySelector('.guild-leadership-role')!.getBoundingClientRect();
          return name.scrollHeight <= name.clientHeight + 1 && name.getBoundingClientRect().right <= box.right + 1 && role.bottom <= box.bottom + 1;
        }); expect(fits).toBe(true);
      }
      expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1)).toBe(true);
      const bounds = await card.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await group(page, '主要與次要公會').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/guild-partitions-${width}.png`, fullPage: true });
  }
});

test('a joined guild card sets or clears a secondary guild with the existing preference command', async ({ page }) => {
  const fixture = await setupGuilds(page); await login(page);
  const full = page.getByRole('article', { name: names[3], exact: true });
  await openGuildSetting(full.getByRole('button', { name: '設為次要公會', exact: true, includeHidden: true }));
  await expect(full.getByRole('button', { name: '設為次要公會', exact: true, includeHidden: true })).toBeDisabled();
  await expect(full).toContainText('次要公會已滿 2 個。先取消其中一個。');
  const primary = page.getByRole('article', { name: names[0], exact: true });
  await expect(primary.getByRole('button', { name: '設為次要公會', exact: true, includeHidden: true })).toHaveCount(0);
  await expect(primary.getByRole('button', { name: '取消次要公會', exact: true, includeHidden: true })).toHaveCount(0);
  const unjoined = page.getByRole('article', { name: names[5], exact: true });
  await expect(unjoined.getByRole('button', { name: '設為次要公會', exact: true, includeHidden: true })).toHaveCount(0);
  const current = page.getByRole('article', { name: names[2], exact: true });
  await chooseGuildSetting(current.getByRole('button', { name: '取消次要公會', exact: true, includeHidden: true }));
  await expect(page.getByRole('region', { name: '公會目錄', exact: true }).getByRole('status').filter({ hasText: `已取消${names[2]}的次要公會。` })).toBeVisible();
  expect(fixture.writes).toHaveLength(1);
  expect(fixture.writes[0].body).toEqual({ secondary_guild_keys: [keys[1]] });
  expect(fixture.writes[0].headers['if-match']).toBe('"7"');
  expect(fixture.writes[0].headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(fixture.writes[0].headers['x-csrf-token']).toBeTruthy();
  await chooseGuildSetting(full.getByRole('button', { name: '設為次要公會', exact: true, includeHidden: true }));
  await expect(page.getByRole('region', { name: '公會目錄', exact: true }).getByRole('status').filter({ hasText: `已將${names[3]}設為次要公會。` })).toBeVisible();
  expect(fixture.writes[1].body).toEqual({ secondary_guild_keys: [keys[1], keys[3]] });
  expect(fixture.writes[1].headers['if-match']).toBe('"8"');
  expect(fixture.writes[1].headers['idempotency-key']).not.toBe(fixture.writes[0].headers['idempotency-key']);
  await expect(group(page, '主要與次要公會').locator('.guild-card')).toHaveCount(3);
  expect(await guildIds(page, '主要與次要公會')).toEqual([keys[0], keys[1], keys[3]]);
  expect(await guildIds(page, '其他已加入公會')).toEqual([keys[2], keys[4]]);
});

test('the joined guild overview connects existing sections lazily and keeps roster search across navigation', async ({ page }) => {
  const fixture = await setupGuilds(page); await login(page);
  const card = page.getByRole('article', { name: names[0], exact: true });
  const entry = card.getByRole('button', { name: '查看公會介紹', exact: true });
  await entry.focus(); await page.keyboard.press('Enter');
  const dialog = card.locator('.guild-detail-dialog');
  await expect(dialog).toHaveAccessibleName(`${names[0]} · 社群總覽`);
  await expect(dialog.getByRole('heading', { name: '我們一起做什麼' })).toBeVisible();
  await expect(dialog).toContainText('交流專長，一起完成作品。');
  expect(fixture.reads()).toEqual({ memberReads: 0, announcementReads: 0 });
  const nav = dialog.getByRole('navigation', { name: '公會內容' });
  await nav.getByRole('button', { name: '公告', exact: true }).click();
  await expect(dialog).toContainText('帶一份可以公開的合成素材。');
  expect(fixture.reads()).toEqual({ memberReads: 0, announcementReads: 1 });
  await nav.getByRole('button', { name: '成員', exact: true }).click();
  await expect(dialog).toContainText('目前沒有可顯示的公會成員。');
  const search = dialog.getByRole('searchbox', { name: '搜尋公會成員' });
  await search.fill('合成專長');
  await expect(dialog).toContainText('沒有符合的公會成員。');
  const reads = fixture.reads().memberReads;
  await nav.getByRole('button', { name: '社群總覽', exact: true }).click();
  await expect(search).toBeHidden();
  await nav.getByRole('button', { name: '成員', exact: true }).click();
  await expect(search).toHaveValue('合成專長');
  expect(fixture.reads().memberReads).toBe(reads);
  await nav.getByRole('button', { name: '技能書庫', exact: true }).click();
  await expect(dialog.locator('.guild-library-entry')).toHaveCount(3);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(entry).toBeFocused();
  expect(fixture.writes).toHaveLength(0);
});

test('guild overview chat hands off the exact guild after closing the modal; unjoined cards keep public detail only', async ({ page }) => {
  const fixture = await setupGuilds(page); await login(page);
  const unjoined = page.getByRole('article', { name: names[5], exact: true });
  await expect(unjoined.getByRole('button', { name: '查看公會介紹', exact: true })).toHaveCount(0);
  await expect(unjoined.getByRole('button', { name: '公會公告', exact: true })).toHaveCount(0);
  await unjoined.getByRole('button', { name: /公會技能書庫/ }).click();
  await expect(unjoined.getByRole('navigation', { name: '公會內容' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(fixture.reads()).toEqual({ memberReads: 0, announcementReads: 0 });
  await page.evaluate(() => {
    (window as unknown as { guildEntries: unknown[] }).guildEntries = [];
    window.addEventListener('freedom-open-channel', event => {
      (window as unknown as { guildEntries: unknown[] }).guildEntries.push({
        detail: (event as CustomEvent).detail,
        guildModalOpen: Boolean(document.querySelector('.guild-detail-dialog[open]')),
      });
    });
  });
  const card = page.getByRole('article', { name: names[0], exact: true });
  await card.getByRole('button', { name: '查看公會介紹', exact: true }).click();
  await card.locator('.guild-detail-dialog').getByRole('button', { name: '進入公會聊天室', exact: true }).click();
  await expect(card.locator('.guild-detail-dialog')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { guildEntries: unknown[] }).guildEntries)).toEqual([
    { detail: { kind: 'guild', key: keys[0] }, guildModalOpen: false },
  ]);
  expect(fixture.writes).toHaveLength(0);
});

test('guild overview navigation translates without remounting and fits narrow screens in every experience', async ({ page }) => {
  await setupGuilds(page); await login(page);
  const card = page.getByRole('article', { name: names[1], exact: true });
  await card.getByRole('button', { name: '查看公會介紹', exact: true }).click();
  const dialog = card.locator('.guild-detail-dialog');
  for (const [language, overview] of [['en', 'Community overview'], ['ja', 'コミュニティ概要'], ['ko', '커뮤니티 개요'], ['es', 'Vista de la comunidad'], ['zh-Hant', '社群總覽']]) {
    await page.evaluate(value => {
      localStorage.setItem('freedom-interface-language-v1', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'freedom-interface-language-v1', newValue: value }));
    }, language);
    await expect(dialog).toHaveAccessibleName(`${names[1]} · ${overview}`);
    await expect(dialog.getByRole('button', { name: overview, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog).toContainText('把很長的協作專業說明、不同人數的公會幹部與技能書排成一致的卡片。');
  }
  for (const theme of ['light', 'dark', 'versefolk', 'guide-dragon', 'guide-ai-sister']) {
    await page.evaluate(value => {
      localStorage.setItem('freedom-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'freedom-theme', newValue: value }));
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-experience-profile', theme);
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      for (const button of await dialog.getByRole('button').all()) {
        const box = await button.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `test-results/guild-community-${theme}-${width}.png` });
    }
  }
});

test('switching guild sections preserves a pending roster command and its unknown-result retry key', async ({ page }) => {
  await setupGuilds(page, '20000000-0000-4000-8000-000000000001');
  let full = false, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const commands: { key: string; body: unknown; version: string }[] = [];
  await page.route('**/api/v1/members?*', route => route.fulfill({ json: { items: [{
    user_id: '20000000-0000-4000-8000-000000000099', nickname: '合成測試夥伴', last_seen_at: null, is_online: false,
    positioning_title: null, primary_guild: null, secondary_guilds: [], capabilities: [], equipment: [], contacts: {}, is_self: false,
    friendship: { state: 'none' }, guild_roster: { member_tier: full ? 'full' : 'intern', aggregate_version: full ? 2 : 1, expert_aggregate_version: null, expert_active: false },
  }], total: 1, next_offset: null } }));
  await page.route('**/api/v1/guilds/*/members/*/tier', async route => {
    commands.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON(), version: route.request().headers()['if-match'] });
    if (commands.length === 1) { await pending; await route.abort('failed'); }
    else { full = true; await route.fulfill({ json: { aggregate_version: 2 } }); }
  });
  await login(page);
  const card = page.getByRole('article', { name: names[0], exact: true });
  await card.getByRole('button', { name: '查看公會介紹', exact: true }).click();
  const dialog = card.locator('.guild-detail-dialog');
  const nav = dialog.getByRole('navigation', { name: '公會內容' });
  await nav.getByRole('button', { name: '成員', exact: true }).click();
  const promote = dialog.getByRole('button', { name: '設為正式成員', exact: true });
  await promote.click(); await expect.poll(() => commands.length).toBe(1);
  await nav.getByRole('button', { name: '社群總覽', exact: true }).click();
  await nav.getByRole('button', { name: '成員', exact: true }).click();
  await expect(promote).toBeDisabled();
  release(); await expect(promote).toBeEnabled();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await nav.getByRole('button', { name: '社群總覽', exact: true }).click();
  await nav.getByRole('button', { name: '成員', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await promote.click();
  await expect(dialog.getByRole('button', { name: '改回實習成員', exact: true })).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[0].key).toMatch(/^[0-9a-f-]{36}$/);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0].body).toEqual({ member_tier: 'full' });
  expect(commands[0].version).toBe('"1"');
});

test('directory disclosures preserve filters, joined totals and the visible create guide anchor without writes', async ({ page }) => {
  const fixture = await setupGuilds(page); await login(page);
  const directory = group(page, '公會目錄');
  const topics = directory.locator('.guild-topic-disclosure');
  const summary = topics.locator('summary');
  const tools = directory.locator('.guild-tools-disclosure');
  await expect(topics).not.toHaveAttribute('open');
  await expect(tools).not.toHaveAttribute('open');
  await expect(directory.getByRole('group', { name: '公會主題', exact: true })).toBeHidden();
  await expect(directory.getByRole('button', { name: '前往技能書架', exact: true })).toBeHidden();
  await expect(directory.locator('[data-guide-anchor="guilds:create-application"]')).toBeVisible();
  await expect(directory.locator('.guild-filter-result')).toHaveText('符合篩選：6 個公會');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(topics).toHaveAttribute('open');
  await topics.getByRole('button', { name: 'AI 與技術', exact: true }).click();
  await summary.focus(); await page.keyboard.press('Space');
  await expect(topics).not.toHaveAttribute('open');
  await expect(summary).toHaveText('主題篩選 · AI 與技術');
  await expect(directory.locator('.guild-filter-result')).toHaveText('符合篩選：3 個公會');
  await expect(group(page, '未加入公會').locator('.guild-card')).toHaveCount(0);
  await expect(group(page, '未加入公會')).toContainText('沒有符合篩選的公會。');
  await expect(directory).not.toContainText('所有公會都已加入。');
  await expect(directory.getByLabel('我的公會概況', { exact: true })).toContainText('已加入 5 個公會');
  await directory.getByRole('searchbox', { name: '搜尋公會' }).fill(names[4]);
  await directory.getByRole('button', { name: '已加入', exact: true }).click();
  await expect(directory.locator('.guild-card')).toHaveCount(1);
  await tools.locator('summary').click();
  await expect(tools.getByRole('button', { name: '前往技能書架', exact: true })).toBeVisible();
  await expect(tools).toContainText('主要 1 個・次要最多 2 個');
  await tools.locator('summary').click();
  await expect(directory.getByRole('searchbox', { name: '搜尋公會' })).toHaveValue(names[4]);
  await expect(directory.getByRole('button', { name: '已加入', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await summary.click();
  await expect(topics.getByRole('button', { name: 'AI 與技術', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await topics.getByRole('button', { name: '全部主題', exact: true }).click();
  await directory.getByRole('searchbox', { name: '搜尋公會' }).fill('');
  await directory.getByRole('button', { name: '全部公會', exact: true }).click();
  await expect(group(page, '未加入公會').locator('.guild-card')).toHaveCount(1);
  await expect(directory.locator('.guild-filter-result')).toHaveText('符合篩選：6 個公會');
  await directory.getByRole('searchbox', { name: '搜尋公會' }).fill('沒有這個合成公會');
  await expect(directory.locator('.guild-filter-result')).toHaveText('符合篩選：0 個公會');
  await expect(directory.getByLabel('我的公會概況', { exact: true })).toContainText('已加入 5 個公會');
  expect(fixture.writes).toHaveLength(0);
  expect(fixture.reads()).toEqual({ memberReads: 0, announcementReads: 0 });
});

test('an unfiltered directory says all joined only when every guild is joined', async ({ page }) => {
  const fixture = await setupGuilds(page);
  await page.route('**/api/v1/guilds/directory', route => route.fulfill({ json: { items: fixture.directory().map((guild, index) => ({ ...guild, membership: { membership_id: `all-joined-${index}`, state: 'active', aggregate_version: 1 } })) } }));
  await login(page);
  await expect(group(page, '未加入公會')).toContainText('所有公會都已加入。');
  await expect(group(page, '公會目錄').getByLabel('我的公會概況', { exact: true })).toContainText('已加入 6 個公會');
  expect(fixture.writes).toHaveLength(0);
});

test('directory discovery precedes optional controls with readable wrapping and 44px targets', async ({ page }) => {
  await setupGuilds(page); await login(page);
  const directory = group(page, '公會目錄');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    for (const fontSize of ['16px', '32px']) {
      await page.evaluate(value => { document.documentElement.style.fontSize = value; }, fontSize);
      expect(await directory.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      for (const control of await directory.locator('.guild-hub-heading button, .guild-directory-tools button, .guild-directory-tools input, .guild-directory-options summary').all()) {
        const box = await control.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      if (fontSize === '16px') {
        const top = (await directory.boundingBox())!.y;
        const firstCard = (await directory.locator('.guild-card').first().boundingBox())!.y;
        expect(firstCard - top).toBeLessThan(480);
      }
    }
  }
});

for(const kind of ['set','leave'] as const)for(const denied of [403,412])test(`unknown category ${kind} retains its original command through ${denied} and a newer board read`,async({page})=>{
  const fixture=await setupGuilds(page);
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),guild_launchpad_enabled:true}});});
  const categories=['internal','external','professional_industry'];
  let committed=false;
  const view=()=>({aggregate_version:committed?99:7,migration_state:'switched',invalidated:[],legacy:null,primaries:categories.map((category,index)=>({category,guild_key:kind==='leave'&&committed?null:index===0?keys[0]:kind==='set'&&committed&&index===1?keys[1]:null}))});
  await page.route('**/api/v1/me/guild-preferences/v2',route=>route.fulfill({json:view()}));
  await page.route('**/api/v1/guild-categories',route=>route.fulfill({json:{catalog_revision:'1',pending:[],categories:categories.map((category,index)=>({category,items:fixture.directory().filter((_,i)=>i%3===index).map(guild=>({guild_key:guild.guild_key,name:guild.name,category,category_review:'approved',catalog_revision:'1'}))}))}}));
  await page.route('**/api/v1/guilds/directory',route=>route.fulfill({json:{items:fixture.directory().map((guild,index)=>kind==='leave'&&committed&&index===0?{...guild,membership:{...guild.membership,state:'left',aggregate_version:2}}:guild)}}));
  const writes:{path:string;body:unknown;key:string|undefined;version:string|undefined;preferenceVersion:string|undefined}[]=[];
  const commandPath=kind==='set'?'/me/guild-preferences/v2/set':`/guilds/${keys[0]}/leave-v2`;
  await page.route(`**/api/v1${commandPath}`,route=>{
    const headers=route.request().headers();writes.push({path:new URL(route.request().url()).pathname,body:route.request().postDataJSON(),key:headers['idempotency-key'],version:headers['if-match'],preferenceVersion:headers['x-preference-version']});
    if(writes.length===1){committed=true;return route.fulfill({status:503,json:{detail:'回應中斷，結果尚未確認。'}});}
    if(writes.length===2)return route.fulfill({status:denied,json:{detail:'目前無法確認這次重試。'}});
    return route.fulfill({json:kind==='set'?{...view(),aggregate_version:8}:{membership:{aggregate_version:2},preferences:view()}});
  });
  await login(page);const root=page.getByRole('region',{name:'公會目錄',exact:true});
  const card=(index:number)=>root.locator(`.guild-card[data-guild-key="${keys[index]}"]`);
  await openGuildSetting(card(0).getByRole('button',{name:'取消本類主力',exact:true, includeHidden: true}));
  if(kind==='set')await chooseGuildSetting(card(1).getByRole('button',{name:'設為本類主力',exact:true, includeHidden: true}));
  else{await chooseGuildSetting(card(0).getByRole('button',{name:`退出${names[0]}`,exact:true, includeHidden: true}));await root.getByRole('button',{name:'確認退出',exact:true}).click();}
  const retry=root.getByRole('button',{name:kind==='set'?'再試一次':'重試原退出',exact:true});
  await expect(retry).toBeVisible();await expect(card(2).getByRole('button',{name:'設為本類主力',exact:true, includeHidden: true})).toBeDisabled();
  const booksButton=card(2).getByRole('button',{name:/^公會技能書庫/});await expect(booksButton).toBeEnabled();await booksButton.click();await card(2).getByRole('button',{name:'關閉公會視窗',exact:true}).click();
  await retry.click();await expect(root.getByRole('alert')).toBeVisible();await expect(retry).toBeVisible();
  await expect(root.getByRole('button',{name:'用新版本送出草稿',exact:true})).toHaveCount(0);
  await root.getByRole('alert').getByRole('button',{name:'重新載入公會',exact:true}).click();
  await expect(root.getByText('正在載入職業公會…',{exact:true})).toHaveCount(0);await expect(retry).toBeVisible();
  await expect(card(2).getByRole('button',{name:'設為本類主力',exact:true, includeHidden: true})).toBeDisabled();await retry.click();
  await expect(retry).toHaveCount(0);await expect(card(2).getByRole('button',{name:'設為本類主力',exact:true, includeHidden: true})).toBeEnabled();
  expect(writes).toHaveLength(3);expect(writes[0].key).toBeTruthy();for(const write of writes)expect(write).toEqual(writes[0]);
  expect(writes[0].version).toBe(kind==='set'?'"7"':'"1"');if(kind==='leave')expect(writes[0].preferenceVersion).toBe('7');
});


test('a held fresh-version guild read cannot submit the old draft after logout and another login',async({page})=>{
  const fixture=await setupGuilds(page);
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),guild_launchpad_enabled:true}});});
  const categories=['internal','external','professional_industry'];
  const view={aggregate_version:7,migration_state:'switched',invalidated:[],legacy:null,primaries:categories.map((category,index)=>({category,guild_key:index===0?keys[0]:null}))};
  let holdNext=false,held:Route|undefined,captured!:()=>void;
  const requested=new Promise<void>(resolve=>captured=resolve);
  const readPattern='**/api/v1/me/guild-preferences/v2';
  const readHandler=(route:Route)=>{if(holdNext){holdNext=false;held=route;captured();return;}return route.fulfill({json:view});};
  await page.route(readPattern,readHandler);
  await page.route('**/api/v1/guild-categories',route=>route.fulfill({json:{catalog_revision:'1',pending:[],categories:categories.map((category,index)=>({category,items:fixture.directory().filter((_,i)=>i%3===index).map(guild=>({guild_key:guild.guild_key,name:guild.name,category,category_review:'approved',catalog_revision:'1'}))}))}}));
  const writes:unknown[]=[];
  await page.route('**/api/v1/me/guild-preferences/v2/set',route=>{writes.push(route.request().postDataJSON());return route.fulfill({status:412,json:{detail:'Synthetic version conflict.'}});});
  try{
  await login(page);const initial=await (await page.request.get('/api/v1/session')).json();const root=group(page,'公會目錄');
  await chooseGuildSetting(root.locator(`.guild-card[data-guild-key="${keys[1]}"]`).getByRole('button',{name:'設為本類主力',exact:true, includeHidden: true}));
  await expect(root.getByRole('button',{name:'用新版本送出草稿',exact:true})).toBeVisible();holdNext=true;
  await root.getByRole('button',{name:'用新版本送出草稿',exact:true}).click();await requested;
  await page.getByRole('button',{name:'設定',exact:true}).click();await page.getByRole('menuitem',{name:'登出',exact:true}).click();await expect(page.locator('.login-card')).toBeVisible();
  // Keep this document: the old async closure and its captured response survive.
  await page.getByLabel('電子郵件',{exact:true}).fill('client@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.locator('.shell')).toBeVisible();const replacement=await (await page.request.get('/api/v1/session')).json();
  expect(replacement.user.user_id).not.toBe(initial.user.user_id);expect(replacement.csrf_token).not.toBe(initial.csrf_token);
  const oldRead=held!;const finished=page.waitForEvent('requestfinished',request=>request===oldRead.request());await oldRead.fulfill({json:{...view,aggregate_version:8}});held=undefined;await finished;
  await navigate(page,'職業公會');await expect(group(page,'公會目錄').locator('.guild-card')).toHaveCount(6);
  expect(writes).toHaveLength(1);await expect(group(page,'公會目錄').getByRole('button',{name:'用新版本送出草稿',exact:true})).toHaveCount(0);
  }finally{if(held){try{await held.abort();}catch{/* Route may already be finished during fixture teardown. */}}await page.unroute(readPattern,readHandler);}
});


test('guild landing names the next step while membership settings stay optional and keyboard accessible', async ({page}) => {
  const fixture = await setupGuilds(page);
  await page.route('**/api/v1/site', async route => {
    const response = await route.fetch();
    await route.fulfill({response, json: {...await response.json(), guild_launchpad_enabled: false}});
  });
  await login(page);
  const hero = page.getByRole('region', {name: '找到同路人，一起把專長做成作品。', exact: true});
  await expect(hero).toContainText(names[0]);
  await expect(hero).toContainText('閱讀入門技能');
  const card = page.getByRole('article', {name: names[1], exact: true});
  const settings = card.locator('.guild-membership-settings');
  const summary = settings.locator(':scope > summary');
  await expect(settings).not.toHaveAttribute('open');
  await expect(card.getByRole('button', {name: '設為主要公會', exact: true})).toBeHidden();
  await expect(card.getByText('次要公會', {exact: true})).toBeVisible();
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(settings).toHaveJSProperty('open', true);
  await expect(card.getByRole('button', {name: '設為主要公會', exact: true})).toBeVisible();
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(settings).toHaveJSProperty('open', false);
  await expect(summary).toBeFocused();
  expect(fixture.writes).toEqual([]);
  for (const theme of ['light', 'dark', 'versefolk']) {
    await page.evaluate(value => {localStorage.setItem('freedom-theme', value); window.dispatchEvent(new StorageEvent('storage', {key: 'freedom-theme', newValue: value}));}, theme);
    for (const width of [320, 1280]) {
      await page.setViewportSize({width, height: 900});
      await expect(hero).toBeVisible();
      expect(await hero.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      expect(await summary.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await hero.getByRole('button', {name: '查看我的公會', exact: true}).click();
  await expect(page.getByRole('searchbox', {name: '搜尋公會', exact: true})).toHaveValue(names[0]);
  await expect(page.getByRole('article', {name: names[0], exact: true})).toBeFocused();
  expect(fixture.writes).toEqual([]);
});
