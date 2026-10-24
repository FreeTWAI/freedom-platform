import {openSettingsPanel} from './settings-menu-helpers.js';
import { mkdirSync } from 'node:fs';
import type { MemberCardData } from '../../apps/portal-web/src/modules/Membership.js';
import { test, expect, type Page } from './fixtures.js';
import { navigate, openHomeGuide } from './navigation.js';
import { resolveHomeJournalUrl } from '../../apps/portal-web/src/modules/member-home-loading.js';

const shots = 'test-results/home-next-step';
mkdirSync(shots, { recursive: true });
const memberId = '20000000-0000-4000-8000-000000000001';
const memberCardUrl = (url: URL) => url.pathname === `/api/v1/members/${memberId}`;
const guild = { guild_key: 'guild_security', name: '測試資安公會' };
const noGuildMessage = '加入感興趣的公會，再選擇主要公會。';
const choosePrimaryMessage = '從已加入的公會選擇主要公會。';
const skillsMessage = '到技能書架選一本技能書閱讀，開始練習。';

// Synthetic card facts affect only this read. Real membership, grants and work records stay in the isolated fixture.
function memberCard(overrides: Partial<MemberCardData> = {}): MemberCardData {
  return {
    user_id: memberId, nickname: '首頁提示測試', last_seen_at: null, is_online: false,
    positioning_title: null, primary_guild: null, secondary_guilds: [], joined_guilds: [],
    capabilities: [], equipment: [], contacts: {}, is_self: true, friendship: { state: 'self' },
    ...overrides,
  };
}

async function stubCard(page: Page, card: MemberCardData) {
  await page.route(memberCardUrl, route => route.request().method() === 'GET'
    ? route.fulfill({ json: card }) : route.fallback());
}

async function stubJson(page: Page, pathname: string, json: unknown) {
  await page.route(url => url.pathname === pathname, route => route.request().method() === 'GET'
    ? route.fulfill({ json }) : route.fallback());
}

async function login(page: Page, expand = true, email = 'maker@local.test') {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill(email);
  await page.getByLabel('密碼', { exact: true }).fill('freedom-local-demo');
  const authResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST', {timeout: 25_000});
  await page.getByRole('button', { name: '登入', exact: true }).click();
  expect((await authResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: '會員首頁', level: 1, exact: true })).toBeVisible();
  // These cases inspect the optional member summary, reached through its visible disclosure.
  if (expand) {
    await openParticipation(page);
    await openHomeGuide(page);
    await page.locator('.home-personal > summary').click();
  }
}

for (const width of [1440, 390]) {
  test(`journal entry opens the native platform journal at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await login(page,false);await openHomeGuide(page);
    const entry=page.getByRole('region',{name:'共創日誌',exact:true});
    await expect(entry).toBeVisible();
    const destination=resolveHomeJournalUrl(process.env.VITE_COMMUNITY_JOURNAL_URL);
    if(destination){
      const link=entry.getByRole('link',{name:'閱讀共創誌',exact:true});
      await expect(link).toHaveAttribute('href','/journal');
      await link.click();await expect(page).toHaveURL(/\/journal$/);
      await expect(page.getByRole('heading',{name:'還沒有日誌。'})).toBeVisible();
      await expect(page.locator('iframe')).toHaveCount(0);
    }else await expect(entry.getByRole('status')).toHaveText('日誌尚未公開');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`${shots}/journal-entry-${width}.png`,fullPage:true});
  });
}

function suggestion(page: Page) {
  return page.getByRole('region', { name: '公會與技能書建議', exact: true });
}

async function openParticipation(page: Page) {
  const disclosure = page.locator('.home-participation-disclosure');
  await expect(disclosure).toBeAttached();
  if (!await disclosure.evaluate(element => (element as HTMLDetailsElement).open))
    await disclosure.locator(':scope > summary').click();
  await expect(disclosure).toHaveJSProperty('open', true);
}

async function checkGuidance(page: Page, message: string, _destination: 'guilds' | 'skills') {
  await expect(suggestion(page)).toContainText(message);
  await expect(page.locator('.game-console')).toHaveCount(0);
  await expect(page.locator('.floating-messages')).toBeVisible();
}

const scenarios = [
  { name: 'no joined guild', card: memberCard(), message: noGuildMessage, button: '探索職業公會', destination: 'guilds' },
  { name: 'another joined guild without a primary', card: memberCard({ joined_guilds: [guild] }), message: choosePrimaryMessage, button: '設定主要公會', destination: 'guilds' },
  { name: 'a secondary guild in a legacy card without joined_guilds', card: (() => {
    const card = memberCard({ secondary_guilds: [guild] });
    delete card.joined_guilds;
    return card;
  })(), message: choosePrimaryMessage, button: '設定主要公會', destination: 'guilds' },
  { name: 'a primary guild without assuming book grants', card: memberCard({ primary_guild: guild, positioning_title: '測試探索者' }), message: skillsMessage, button: '前往技能書架', destination: 'skills' },
] as const;

for (const scenario of scenarios) {
  test(`home next action follows card facts for ${scenario.name}`, async ({ page }) => {
    await stubCard(page, scenario.card);
    if (scenario.card.primary_guild) await stubJson(page, '/api/v1/me/skill-books', { items: [] });
    await login(page);
    const prompt = suggestion(page);
    await expect(prompt).toHaveCount(1);
    await expect(page.locator('.guild-next-steps')).toHaveCount(0);
    await expect(prompt.getByText(scenario.message, { exact: true })).toBeVisible();
    await expect(prompt).not.toContainText('已解鎖');
    if (!scenario.card.primary_guild) await expect(prompt.getByRole('button')).toHaveCount(1);
    if (scenario.card.primary_guild) {
      const summary = page.getByRole('region', { name: '我的會員摘要', exact: true });
      await expect(summary).toContainText('主要公會 · 測試資安公會');
      await expect(summary).toContainText('測試探索者');
    }
    await checkGuidance(page, scenario.message, scenario.destination);
    const button = prompt.getByRole('button', { name: scenario.button, exact: true });
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#${scenario.destination}$`));
    await expect(page.getByRole('heading', { name: scenario.destination === 'guilds' ? '職業公會' : '技能書架', level: 1, exact: true })).toBeVisible();
  });
}

test('a changed guild fact updates the home guidance when home is revisited', async ({ page }) => {
  let card = memberCard();
  await page.route(memberCardUrl, route => route.request().method() === 'GET'
    ? route.fulfill({ json: card }) : route.fallback());
  await login(page);
  await expect(suggestion(page)).toContainText(noGuildMessage);
  await checkGuidance(page, noGuildMessage, 'guilds');
  await suggestion(page).getByRole('button', { name: '探索職業公會', exact: true }).click();
  await expect(page.getByRole('heading', { name: '職業公會', level: 1, exact: true })).toBeVisible();
  card = memberCard({ joined_guilds: [guild] });
  await navigate(page, '會員首頁');
  await openParticipation(page);
  await expect(suggestion(page)).toContainText(choosePrimaryMessage);
  await checkGuidance(page, choosePrimaryMessage, 'guilds');
  await suggestion(page).getByRole('button', { name: '設定主要公會', exact: true }).click();
  await expect(page.getByRole('heading', { name: '職業公會', level: 1, exact: true })).toBeVisible();
  // Leaving the only joined guild returns to an earlier state in this same login.
  card = memberCard();
  await navigate(page, '會員首頁');
  await openParticipation(page);
  await expect(suggestion(page)).toContainText(noGuildMessage);
  await checkGuidance(page, noGuildMessage, 'guilds');
});

test('home does not guess a next action while the member read waits or fails and recovers on retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let mode: 'hold' | 'fail' | 'pass' = 'hold', release!: () => void, requests = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(memberCardUrl, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    requests++;
    if (mode === 'hold') await held;
    return mode === 'fail' ? route.fulfill({ status: 503, body: '' }) : route.fulfill({ json: memberCard({ secondary_guilds: [guild] }) });
  });
  await login(page);
  const summary = page.getByRole('region', { name: '我的會員摘要', exact: true });
  await expect(summary).toHaveAttribute('aria-busy', 'true');
  await expect(summary).toContainText('正在載入名片');
  await expect(suggestion(page)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '常用入口', exact: true }).getByRole('button')).toHaveCount(2);
  mode = 'fail'; release();
  const alert = page.getByRole('alert').filter({ hasText: '名片暫時無法載入' });
  await expect(alert).toBeVisible();
  await expect(suggestion(page)).toHaveCount(0);
  await expect(summary).not.toContainText('尚未設定主要公會');
  await expect(page.locator('.game-console')).toHaveCount(0);
  await page.screenshot({ path: `${shots}/phone-read-failed.png`, fullPage: true });
  const baseline = requests;
  mode = 'pass';
  await alert.getByRole('button', { name: '重新載入名片', exact: true }).click();
  await expect(suggestion(page)).toContainText(choosePrimaryMessage);
  await expect(alert).toHaveCount(0);
  await expect(summary).toBeFocused();
  expect(requests).toBe(baseline + 1);
  await checkGuidance(page, choosePrimaryMessage, 'guilds');
});

test('a granted primary-guild book opens from the same next-step region', async ({ page }) => {
  const skipped = { id: 'book-locked', book_id: 'book-locked', title: '尚未授權的技能書', description: '主要公會有這本，但還沒授權。', repository_url: 'https://github.com/example/locked' };
  const granted = { id: 'book-home-first', book_id: 'book-home-first', title: '首頁第一本技能書', description: '從主要公會開始的練習。', repository_url: 'https://github.com/example/first-book' };
  await stubCard(page, memberCard({ primary_guild: guild }));
  await page.route(url => url.pathname === '/api/v1/guilds/directory', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const data = await response.json() as { items?: { guild_key: string; skill_books?: unknown[] }[] };
    const items = Array.isArray(data.items) ? data.items : [];
    const match = items.find(item => item.guild_key === guild.guild_key);
    if (match) match.skill_books = [skipped, granted];
    else items.push({ guild_key: guild.guild_key, skill_books: [skipped, granted] });
    await route.fulfill({ json: { ...data, items } });
  });
  await stubJson(page, '/api/v1/me/skill-books', { items: [{ book_id: 'book-other', id: 'book-other' }, { book_id: granted.book_id }] });
  await stubJson(page, '/api/v1/task-board/preview', { items: [] });
  await stubJson(page, '/api/v1/dashboard', { now: [] });
  await login(page);
  const prompt = suggestion(page);
  await expect(prompt.getByText(skillsMessage, { exact: true })).toBeVisible();
  await expect(prompt.getByRole('button', { name: '前往技能書架', exact: true })).toHaveCount(0);
  await expect(prompt.getByRole('button', { name: '進入測試資安公會聊天室', exact: true })).toBeVisible();
  await expect(prompt.getByRole('button', { name: '分享作品與需求', exact: true })).toBeVisible();
  await expect(prompt).not.toContainText('尚未授權的技能書');
  const open = prompt.getByRole('button', { name: '閱讀技能書', exact: true });
  await expect(open).toHaveAttribute('aria-describedby', 'home-next-step-description');
  await open.click();
  const dialog = page.locator('dialog.skill-intro-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-book-id', granted.book_id);
  await expect(dialog.getByRole('heading', { name: granted.title, exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '關閉技能書介紹', exact: true }).click();
  await expect(dialog).toBeHidden();
  await prompt.getByRole('button', { name: '分享作品與需求', exact: true }).click();
  await expect(page).toHaveURL(/#showcase$/);
  await expect(page.getByRole('heading', { name: '作品與需求', level: 1, exact: true })).toBeVisible();
  await navigate(page, '會員首頁');
  await openParticipation(page);
  await page.evaluate(() => {
    const seen: { kind: string; key: string }[] = [];
    window.addEventListener('freedom-open-channel', event => seen.push((event as CustomEvent<{ kind: string; key: string }>).detail));
    (window as unknown as { __openedChat?: typeof seen }).__openedChat = seen;
  });
  await suggestion(page).getByRole('button', { name: '進入測試資安公會聊天室', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __openedChat?: { kind: string; key: string }[] }).__openedChat)).toEqual([{ kind: 'guild', key: guild.guild_key }]);
});

const taskHint = '社群任務板有開放中的任務，可自行挑選一件參與。';

test('the task hint appears only when the board has open tasks and keeps the skill-book guidance', async ({ page }) => {
  await stubCard(page, memberCard({ primary_guild: guild }));
  await stubJson(page, '/api/v1/me/skill-books', { items: [] });
  await stubJson(page, '/api/v1/task-board/preview', { items: [{ work_item_id: 'preview-1', title: '不應顯示的任務標題' }] });
  await stubJson(page, '/api/v1/dashboard', { now: [] });
  await login(page);
  const prompt = suggestion(page);
  await expect(prompt.getByText(taskHint, { exact: true })).toBeVisible();
  await expect(prompt.locator('.home-next-copy #home-next-task-hint')).toHaveText(taskHint);
  await expect(prompt.getByText(skillsMessage, { exact: true })).toBeVisible();
  await expect(prompt).not.toContainText('不應顯示的任務標題');
  await expect(prompt.getByRole('button', { name: '查看社群任務', exact: true })).toHaveAccessibleDescription(`${skillsMessage} ${taskHint}`);
  await checkGuidance(page, skillsMessage, 'skills');
});

for (const [name, mock] of [
  ['an empty board', (page: Page) => stubJson(page, '/api/v1/task-board/preview', { items: [] })],
  ['a failed board read', (page: Page) => page.route(url => url.pathname === '/api/v1/task-board/preview', route => route.fulfill({ status: 503, body: '' }))],
] as const) {
  test(`the task hint stays hidden for ${name}`, async ({ page }) => {
    await stubCard(page, memberCard({ primary_guild: guild }));
    await stubJson(page, '/api/v1/me/skill-books', { items: [] });
    await mock(page);
    await stubJson(page, '/api/v1/dashboard', { now: [] });
    await login(page);
    const prompt = suggestion(page);
    await expect(prompt.getByText(skillsMessage, { exact: true })).toBeVisible();
    await expect(prompt.getByRole('button', { name: '進入測試資安公會聊天室', exact: true })).toBeVisible();
    await expect(prompt.getByText(taskHint, { exact: true })).toHaveCount(0);
    if (name === 'an empty board') {
      await expect(prompt.getByRole('button', { name: '分享作品與需求', exact: true })).toHaveAccessibleDescription(skillsMessage);
    } else await expect(prompt.getByRole('button', { name: /社群任務|分享作品與需求/ })).toHaveCount(0);
  });
}

const workHint = '你有認領中的工作還沒結案，可以回到「我的工作」繼續。';
// Only `now` matters to home; the shape mirrors work.ts dashboard() for a claim that is still in progress.
const unfinishedClaim = { work_item_id: 'claim-1', title: '不應顯示的工作標題', state: 'claiming_closed', my_claim: { claim_id: 'claim-1', state: 'in_progress' } };

test('an unfinished claim replaces the open-task hint with a return to my work', async ({ page }) => {
  await stubCard(page, memberCard({ primary_guild: guild }));
  await stubJson(page, '/api/v1/me/skill-books', { items: [] });
  await stubJson(page, '/api/v1/task-board/preview', { items: [{ work_item_id: 'preview-1', title: '不應顯示的任務標題' }] });
  await stubJson(page, '/api/v1/dashboard', { now: [unfinishedClaim] });
  await login(page);
  const prompt = suggestion(page);
  await expect(prompt.locator('.home-next-copy #home-next-task-hint')).toHaveText(workHint);
  await expect(prompt.getByText(skillsMessage, { exact: true })).toBeVisible();
  await expect(prompt.getByText(taskHint, { exact: true })).toHaveCount(0);
  await expect(prompt.getByRole('button', { name: /社群任務|分享作品與需求/ })).toHaveCount(0);
  await expect(prompt).not.toContainText('不應顯示的');
  const resume = prompt.getByRole('button', { name: '回到我的工作', exact: true });
  await expect(resume).toHaveAccessibleDescription(`${skillsMessage} ${workHint}`);
  await checkGuidance(page, skillsMessage, 'skills');
  await resume.focus();
  await expect(resume).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#workbench$/);
  await expect(page.getByRole('heading', { name: '我的工作', level: 1, exact: true })).toBeVisible();
});

test('a failed work dashboard read keeps the open-task hint', async ({ page }) => {
  await stubCard(page, memberCard({ primary_guild: guild }));
  await stubJson(page, '/api/v1/me/skill-books', { items: [] });
  await stubJson(page, '/api/v1/task-board/preview', { items: [{ work_item_id: 'preview-1', title: '不應顯示的任務標題' }] });
  await page.route(url => url.pathname === '/api/v1/dashboard', route => route.fulfill({ status: 503, body: '' }));
  await login(page);
  const prompt = suggestion(page);
  await expect(prompt.getByText(taskHint, { exact: true })).toBeVisible();
  await expect(prompt.getByRole('button', { name: '查看社群任務', exact: true })).toBeVisible();
  await expect(prompt.getByText(workHint, { exact: true })).toHaveCount(0);
});

for (const width of [320, 390]) test(`phone ${width}px keeps the composer in view and opens participation before the optional workshop`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await stubCard(page, memberCard({ primary_guild: guild }));
  await stubJson(page, '/api/v1/me/skill-books', { items: [] });
  await stubJson(page, '/api/v1/task-board/preview', { items: [] });
  await stubJson(page, '/api/v1/dashboard', { now: [unfinishedClaim] });
  await stubJson(page, '/api/v1/engagements/summary', { has_engagements: true, needs_response: true });
  // Other journeys retain this shared member's cooperation records; this layout case owns its empty-history read.
  await stubJson(page, '/api/v1/engagements', { items: [] });
  await login(page, false);
  await expect(page.locator('.home-guide-disclosure')).toHaveJSProperty('open', false);
  const disclosure = page.locator('.home-participation-disclosure');
  const toggle = disclosure.locator('summary');
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(toggle).toContainText('探索學習與公會');
  await expect(toggle).toBeInViewport();
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(disclosure.locator('.home-participation')).toBeHidden();
  await expect(page.locator('.home-next-step')).toBeHidden();
  const composer = page.getByRole('region', { name: '首頁社群動態', exact: true }).getByRole('button', { name: '建立貼文', exact: true });
  await page.evaluate(() => scrollTo(0, 0));
  await expect(composer).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveJSProperty('open', true);
  await expect(toggle).toBeFocused();
  const entries = page.getByRole('navigation', { name: '參與自由工坊', exact: true });
  await expect(entries).toBeVisible();
  await expect(entries.getByRole('button')).toHaveCount(4);
  await expect(entries.getByRole('button')).toHaveText(['技能與工具找一本技能書，開始練習', '社群活動看看聚會，一起交流', '合作夥伴認識不同專長的人', '作品交流分享作品、提出需求']);
  await expect(suggestion(page).getByRole('button', { name: '回到我的工作', exact: true })).toBeVisible();
  const progress = page.getByRole('region', { name: '我的合作與內容', exact: true });
  await expect(progress).toContainText('有合作等你接續處理');
  await expect(progress.getByRole('button', { name: '接續我的內容', exact: true })).toBeVisible();
  const entryBox = await entries.boundingBox(), feedBox = await page.locator('.home-timeline').boundingBox();
  expect(entryBox!.y + entryBox!.height).toBeLessThan(feedBox!.y);
  const nextBox = await suggestion(page).boundingBox();
  expect(nextBox!.y + nextBox!.height).toBeLessThan(feedBox!.y);
  await entries.getByRole('button', { name: '技能與工具', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#skills$/);
  await expect(page.getByRole('heading', { name: '技能書架', level: 1, exact: true })).toBeVisible();
  await page.goBack();
  await expect(disclosure).toHaveJSProperty('open', false);
  await openParticipation(page);
  await expect(entries).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(toggle).toBeFocused();
  await expect(disclosure.locator('.home-participation')).toBeHidden();
  await page.evaluate(() => scrollTo(0, 0));
  await expect(composer).toBeInViewport();
  await openParticipation(page);
  await progress.getByRole('button', { name: '查看合作紀錄', exact: true }).click();
  await expect(page).toHaveURL(/#engagement$/);
  await expect(page.getByText('還沒有合作紀錄', { exact: true })).toBeVisible();
});

test('cooperation summary distinguishes a failed read from empty data and retries once without commands', async ({ page }) => {
  let mode: 'fail' | 'malformed' | 'hold' | 'ready' = 'fail', calls = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const commands: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/v1/engagements')) commands.push(request.url()); });
  await page.route(url => url.pathname === '/api/v1/engagements/summary', async route => {
    calls++;
    if (mode === 'fail') return route.fulfill({ status: 503, json: { title: '暫時無法讀取' } });
    if (mode === 'malformed') return route.fulfill({ json: { has_engagements: false, needs_response: true } });
    if (mode === 'hold') await held;
    return route.fulfill({ json: { has_engagements: true, needs_response: false } });
  });
  await login(page, false);
  await openParticipation(page);
  const progress = page.getByRole('region', { name: '我的合作與內容', exact: true });
  await expect(progress).toContainText('合作進度暫時無法載入');
  await expect(progress).not.toContainText('還沒有合作紀錄');
  await expect(progress.getByRole('button', { name: '查看合作紀錄', exact: true })).toBeEnabled();
  mode = 'malformed';
  await progress.getByRole('button', { name: '重試合作進度', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await expect(progress.getByRole('button', { name: '重試合作進度', exact: true })).toBeVisible();
  mode = 'hold';
  await progress.getByRole('button', { name: '重試合作進度', exact: true }).click();
  const updating = progress.getByRole('button', { name: '正在更新…', exact: true });
  await expect(updating).toHaveAttribute('aria-disabled', 'true');
  await expect.poll(() => calls).toBe(3);
  await updating.focus();
  await page.keyboard.press('Enter');
  expect(calls).toBe(3);
  await expect(page.getByRole('navigation', { name: '參與自由工坊', exact: true })).toBeVisible();
  mode = 'ready'; release();
  await expect(progress).toContainText('合作紀錄已更新');
  await expect(progress.getByRole('button', { name: '更新合作進度', exact: true })).toBeFocused();
  expect(commands).toEqual([]);
});

test('leaving home cancels its late summary and returning reads current facts with disabled content hidden', async ({ page }) => {
  let calls = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === '/api/v1/site', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), personal_content_enabled: false } });
  });
  await page.route(url => url.pathname === '/api/v1/engagements/summary', async route => {
    calls++;
    if (calls === 1) { await held; await route.fulfill({ json: { has_engagements: true, needs_response: true } }).catch(() => {}); }
    else await route.fulfill({ json: { has_engagements: false, needs_response: false } });
  });
  try {
    await login(page, false);
    await openParticipation(page);
    const progress = page.getByRole('region', { name: '我的合作與內容', exact: true });
    await expect(progress).toContainText('正在讀取合作進度');
    await expect(progress.getByRole('button', { name: '接續我的內容', exact: true })).toHaveCount(0);
    await page.getByRole('navigation', { name: '參與自由工坊', exact: true }).getByRole('button', { name: '合作夥伴', exact: true }).click();
    await expect(page).toHaveURL(/#members$/);
    await page.goBack();
    await openParticipation(page);
    await expect(progress).toContainText('還沒有合作紀錄');
    release();
    await expect(progress).not.toContainText('有合作等你接續處理');
    expect(calls).toBe(2);
  } finally { release(); }
});

test('switching accounts cannot apply the prior account cooperation response', async ({ page }) => {
  let calls = 0, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === '/api/v1/engagements/summary', async route => {
    calls++;
    if (calls === 1) { await held; await route.fulfill({ json: { has_engagements: true, needs_response: true } }).catch(() => {}); }
    else await route.fulfill({ json: { has_engagements: false, needs_response: false } });
  });
  try {
    await login(page, false);
    await openParticipation(page);
    const progress = page.getByRole('region', { name: '我的合作與內容', exact: true });
    await expect(progress).toContainText('正在讀取合作進度');
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await page.getByRole('menuitem', { name: '登出', exact: true }).click();
    await expect(page.getByRole('button', { name: '登入', exact: true })).toBeVisible();
    await login(page, false, 'client@local.test');
    await expect(page.locator('.home-participation-disclosure')).toHaveJSProperty('open', false);
    await openParticipation(page);
    await expect(progress).toContainText('還沒有合作紀錄');
    release();
    await expect(progress).not.toContainText('有合作等你接續處理');
    expect(calls).toBe(2);
  } finally { release(); }
});

test('the home action stays compact, readable and reachable in all themes on desktop and phones', async ({ page }) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubCard(page, memberCard({ primary_guild: guild, positioning_title: '測試探索者' }));
  await stubJson(page, '/api/v1/me/skill-books', { items: [] });
  await stubJson(page, '/api/v1/task-board/preview', { items: [{ work_item_id: 'preview-1', title: '不應顯示的任務標題' }] });
  await stubJson(page, '/api/v1/dashboard', { now: [] });
  await login(page);
  const prompt = suggestion(page);
  const names = ['前往技能書架', '進入測試資安公會聊天室', '查看社群任務'] as const;
  for (const name of names) await expect(prompt.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(prompt).not.toContainText('不應顯示的任務標題');
  for (const [theme, label] of [['light', '自由工坊－明亮'], ['dark', '自由工坊－夜航'], ['versefolk', '自由工坊－敘生']] as const) {
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await openSettingsPanel(page,'appearance');await page.getByRole('menuitemradio', { name: label, exact: true }).click();
    await page.getByRole('button', { name: '設定', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1440, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('.home-participation-disclosure')).toHaveJSProperty('open', true);
      await expect(page.locator('.home-participation-disclosure > summary')).toBeVisible();
      await openParticipation(page);
      const entries = page.getByRole('navigation', { name: '參與自由工坊', exact: true });
      for (const button of await entries.getByRole('button').all()) {
        await expect(button).toBeVisible();
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await button.locator('strong').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
      }
      await openHomeGuide(page);
      await expect(prompt.getByText(skillsMessage, { exact: true })).toBeVisible();
      const region = await prompt.boundingBox();
      for (const name of names) {
        const button = prompt.getByRole('button', { name, exact: true });
        await expect(button).toHaveAttribute('aria-describedby', name === '查看社群任務' ? 'home-next-step-description home-next-task-hint' : 'home-next-step-description');
        await button.focus();
        await expect(button).toBeFocused();
        const box = await button.boundingBox();
        expect(box!.height, `${theme} ${width}px ${name} height`).toBeGreaterThanOrEqual(44);
        expect(box!.width, `${theme} ${width}px ${name} width`).toBeGreaterThanOrEqual(44);
        if (width >= 820) expect(box!.width, `${theme} ${width}px ${name} is not full width`).toBeLessThan(region!.width - 8);
        expect(await button.evaluate(element => parseFloat(getComputedStyle(element).fontSize)), `${theme} ${width}px ${name} font`).toBeGreaterThanOrEqual(14);
      }
      expect(await prompt.getByText(skillsMessage, { exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}px horizontal overflow`).toBe(true);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      const nextBox = await prompt.boundingBox(), feedBox = await page.locator('.home-timeline').boundingBox();
      expect(nextBox!.y + nextBox!.height).toBeLessThan(feedBox!.y);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: `${shots}/${theme}-${width}.png`, fullPage: true });
    }
  }
});
