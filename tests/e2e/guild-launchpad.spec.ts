import {openGuildSection} from './navigation.js';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {test, expect, type Browser, type Page} from './fixtures.js';
import {navigate} from './navigation.js';
import {DEMO_COMMUNITY, DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {hashPassword} from '../../modules/identity-membership/service.js';
import {convertV1, type ConfigView} from '../../contracts/guild-launchpad/v2/config.js';

const music = 'guild_music_mv';
const space = 'guild_event_space';
const edited = 'guild_human_design';

async function seed(db: Pool, appointLeader = true) {
  const run = randomUUID().slice(0, 8);
  const userId = randomUUID();
  // Delegation candidates exclude verification accounts; the ordinary member fixture uses .test.
  const email = `launchpad-${run}@${appointLeader ? 'example.invalid' : 'example.test'}`;
  const names = await db.query('SELECT guild_key, name FROM positioning_guild_catalog WHERE guild_key=ANY($1::text[])', [[music, space, edited]]);
  const nameOf = (key: string) => names.rows.find(row => row.guild_key === key).name as string;
  const previous = await db.query('SELECT user_id FROM positioning_guild_officers WHERE community_id=$1 AND guild_key=$2', [DEMO_COMMUNITY, edited]);
  await db.query(`INSERT INTO users(user_id, community_id, email, display_name, password_hash, profession_membership_ref, onboarding_required)
    VALUES($1,$2,$3,$4,$5,$6,false)`, [userId, DEMO_COMMUNITY, email, `啟動台會員 ${run}`, hashPassword(DEMO_PASSWORD), randomUUID()]);
  for (const key of [music, space, edited]) {
    await db.query(`INSERT INTO positioning_profession_memberships(membership_id, community_id, user_id, guild_key, state, member_tier)
      VALUES($1,$2,$3,$4,'active','full')`, [randomUUID(), DEMO_COMMUNITY, userId, key]);
  }
  await db.query(`INSERT INTO guild_member_preferences(community_id, user_id, primary_guild_key) VALUES($1,$2,$3)`, [DEMO_COMMUNITY, userId, space]);
  if (appointLeader) await db.query(`INSERT INTO positioning_guild_officers(community_id, guild_key, user_id) VALUES($1,$2,$3)
    ON CONFLICT (community_id, guild_key) DO UPDATE SET user_id=$3`, [DEMO_COMMUNITY, edited, userId]);
  return {userId, email, displayName: `啟動台會員 ${run}`, musicName: nameOf(music), spaceName: nameOf(space), editedName: nameOf(edited), previousOfficer: previous.rows[0]?.user_id as string | undefined};
}
async function cleanup(db: Pool, userId: string, previousOfficer: string | undefined) {
  // Delegation history is append-only. Keep it in the isolated schema until the
  // suite drops that schema; disable only this fixture account during cleanup.
  await db.query('UPDATE users SET active=false WHERE user_id=$1', [userId]);
  await db.query('DELETE FROM command_receipts WHERE user_id=$1', [userId]);
  await db.query('DELETE FROM outbox WHERE transition_id IN (SELECT transition_id FROM transition_journal WHERE actor_ref=$1)', [userId]);
  await db.query('DELETE FROM transition_journal WHERE actor_ref=$1', [userId]);
  await db.query('DELETE FROM guild_member_preferences WHERE community_id=$1 AND user_id=$2', [DEMO_COMMUNITY, userId]);
  await db.query('DELETE FROM positioning_profession_memberships WHERE community_id=$1 AND user_id=$2', [DEMO_COMMUNITY, userId]);
  await db.query('DELETE FROM member_skill_book_grants WHERE community_id=$1 AND user_id=$2', [DEMO_COMMUNITY, userId]);
  await db.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
  if (previousOfficer) await db.query('UPDATE positioning_guild_officers SET user_id=$3 WHERE community_id=$1 AND guild_key=$2', [DEMO_COMMUNITY, edited, previousOfficer]);
  else await db.query('DELETE FROM positioning_guild_officers WHERE community_id=$1 AND guild_key=$2 AND user_id=$3', [DEMO_COMMUNITY, edited, userId]);
  await db.query('DELETE FROM users WHERE user_id=$1', [userId]).catch(() => undefined);
}
async function login(browser: Browser, baseURL: string, email: string) {
  const context = await browser.newContext({baseURL, viewport: {width: 1280, height: 900}});
  await context.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill(email);
  await page.getByLabel('密碼', {exact: true}).fill(DEMO_PASSWORD);
  const loggedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST', {timeout: 25_000});
  await page.getByRole('button', {name: '登入', exact: true}).click();
  expect((await loggedIn).status()).toBe(200);
  await expect(page.getByRole('button', {name: '設定', exact: true})).toBeVisible();
  return {context, page};
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function tallEnough(page: Page) {
  const heights = await page.locator('.guild-launchpad .checkbox-row:visible, .guild-launchpad button:visible, .guild-launchpad input:not([type=checkbox]):visible, .guild-launchpad select:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
}

type ClipboardWindow = Window & {guildCopies: {value: string; active: boolean; resolve: () => void; reject: (error: Error) => void}[]};
async function holdGuildClipboard(page: Page) {
  // Controlled browser capability: no OS clipboard or external social post.
  await page.addInitScript(() => {
    const host = window as unknown as ClipboardWindow;
    host.guildCopies = [];
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
      writeText: (value: string) => new Promise<void>((resolve, reject) => host.guildCopies.push({value, active: navigator.userActivation.isActive, resolve, reject})),
    }});
  });
}
async function finishGuildCopy(page: Page, index: number, denied = false) {
  await page.evaluate(({index, denied}) => {
    const copy = (window as unknown as ClipboardWindow).guildCopies[index];
    if (denied) copy.reject(new DOMException('blocked', 'NotAllowedError'));
    else copy.resolve();
  }, {index, denied});
}

test('a visitor can read a guild launchpad without a session', async ({browser, baseURL}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({baseURL, viewport: {width: 360, height: 800}});
  await context.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  const page = await context.newPage();
  const privateReads: string[] = [];
  page.on('request', request => {if (new URL(request.url()).pathname.startsWith('/api/v1/guilds/')) privateReads.push(request.url());});
  let releaseChunk: () => void = () => undefined;
  const chunkReleased = new Promise<void>(resolve => { releaseChunk = resolve; });
  await page.route(/\/assets\/GuildLaunchpadPage-[^/]+\.js$/, async route => {
    await chunkReleased;
    await route.continue();
  });
  try {
    const payload = await (await page.request.get(`/api/v1/public/guilds/${music}/launchpad`)).json() as {guild: {name: string; purpose: string}; config: {body: {mission_override: string | null}}};
    const mission = payload.config.body.mission_override ?? payload.guild.purpose;
    await page.goto(`/#guilds/${music}`, {waitUntil: 'domcontentloaded'});
    await expect(page.locator('.page-loading[role="status"]')).toBeVisible();
    await expect(page.locator('.guild-launchpad')).toHaveCount(0);
    releaseChunk();
    await expect(page.getByRole('heading', {level: 1, name: payload.guild.name})).toBeVisible();
    await expect(page.getByText(mission, {exact: true}).first()).toBeVisible();
    await expect(page.getByRole('button', {name: '會員登入', exact: true})).toBeVisible();
    const readBooks = page.getByRole('button', {name: '查看公會技能書', exact: true});
    await readBooks.focus();
    await readBooks.press('Enter');
    await expect(page.getByRole('heading', {level: 2, name: '技能書', exact: true})).toBeFocused();
    const source = page.getByRole('link', {name: /查看原始專案/}).first();
    await expect(source).toBeVisible();
    await expect(source).toHaveAttribute('href', /^https:\/\//);
    await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    expect(privateReads).toEqual([]);
    await openGuildSection(page, '我的工作');
    const myWork = page.locator('.guild-launchpad-block').filter({has: page.getByRole('heading', {level: 2, name: '我的工作', exact: true})});
    await expect(myWork.locator('p').filter({hasText: /^登入並加入公會後，可以在這裡看到自己的工作。$/})).toBeVisible();
    await expect(page.locator('body')).not.toContainText('業務空間尚未在此環境啟用');
    await expect(page.getByRole('button', {name: '儲存草稿', exact: true})).toHaveCount(0);
    await noOverflow(page);
    await page.getByLabel('頁面工具', {exact: true}).click();
    await page.getByRole('button', {name: '頁面說明', exact: true}).click();
    const help = page.getByRole('dialog');
    await expect(help).toContainText('職業公會依工作領域聚集會員與技能書');
    await help.getByRole('button', {name: '關閉', exact: true}).click();
    await page.getByRole('button', {name: '會員登入', exact: true}).click();
    await expect(page.getByLabel('電子郵件', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '返回公會啟動台', exact: true}).click();
    await expect(page.getByRole('heading', {level: 1, name: payload.guild.name})).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#guilds/${music}$`));
    await expect(page.getByRole('button', {name: '儲存草稿', exact: true})).toHaveCount(0);
    await noOverflow(page);
  } finally { releaseChunk(); await context.close(); }
});

test('public guild sharing copies a clean permalink and stays usable across themes and widths', async ({browser, baseURL}, testInfo) => {
  const context = await browser.newContext({baseURL, viewport: {width: 390, height: 844}});
  await context.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  const page = await context.newPage();
  await holdGuildClipboard(page);
  try {
    await page.goto(`/?utm_source=fixture&private_hint=do-not-share#guilds/${music}`);
    await page.getByRole('button', {name: '複製公會連結', exact: true}).click();
    await expect(page.getByRole('button', {name: '複製中…', exact: true})).toBeDisabled();
    expect(await page.evaluate(() => (window as unknown as ClipboardWindow).guildCopies.map(({value, active}) => ({value, active})))).toEqual([
      {value: `${new URL(baseURL!).origin}/#guilds/${music}`, active: true},
    ]);
    await finishGuildCopy(page, 0);
    await expect(page.getByRole('status').filter({hasText: '已複製公會連結'})).toBeVisible();
    await page.getByRole('button', {name: '查看公會技能書', exact: true}).click();
    for (const theme of ['light', 'dark', 'versefolk']) {
      await page.evaluate(value => {document.documentElement.dataset.theme = value; document.documentElement.dataset.experienceProfile = value; window.dispatchEvent(new Event('freedom-theme-changed'));}, theme);
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({width, height: 900});
        await noOverflow(page);
        const targets = await page.locator('.guild-launchpad-entry :is(button,a):visible, .guild-launchpad-book a:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
        expect(targets.length).toBeGreaterThan(0);
        expect(Math.min(...targets)).toBeGreaterThanOrEqual(44);
        if (width !== 390) await page.screenshot({path: testInfo.outputPath(`public-guild-${theme}-${width}.png`), fullPage: true, animations: 'disabled'});
      }
    }
  } finally {await context.close();}
});

test('a denied guild copy exposes a selected manual permalink without a false success', async ({browser, baseURL}) => {
  const context = await browser.newContext({baseURL, viewport: {width: 320, height: 800}});
  await context.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  const page = await context.newPage();
  await holdGuildClipboard(page);
  try {
    await page.goto(`/?private_hint=do-not-share#guilds/${music}`);
    await page.getByRole('button', {name: '複製公會連結', exact: true}).click();
    await finishGuildCopy(page, 0, true);
    const field = page.getByRole('textbox', {name: '公會公開連結', exact: true});
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(`${new URL(baseURL!).origin}/#guilds/${music}`);
    expect(await field.evaluate(element => {const input = element as HTMLInputElement; return [input.selectionStart, input.selectionEnd];})).toEqual([0, `${new URL(baseURL!).origin}/#guilds/${music}`.length]);
    await expect(page.getByText('已複製公會連結', {exact: true})).toHaveCount(0);
    await expect(page.getByRole('status').filter({hasText: '無法自動複製'})).toBeVisible();
    await noOverflow(page);
    // Missing clipboard support has the same usable fallback, including on retry.
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined}));
    await page.getByRole('button', {name: '複製公會連結', exact: true}).click();
    await expect(field).toBeFocused();
  } finally {await context.close();}
});

for (const denied of [false, true]) test(`a late clipboard ${denied ? 'failure' : 'success'} cannot reappear after a public guild change`, async ({browser, baseURL}) => {
  const context = await browser.newContext({baseURL});
  await context.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  const page = await context.newPage();
  await holdGuildClipboard(page);
  try {
    const next = await (await page.request.get(`/api/v1/public/guilds/${space}/launchpad`)).json();
    await page.goto(`/#guilds/${music}`);
    await page.getByRole('button', {name: '複製公會連結', exact: true}).click();
    await page.evaluate(key => {window.location.hash = `guilds/${key}`;}, space);
    await expect(page.getByRole('heading', {level: 1, name: next.guild.name, exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: '複製公會連結', exact: true})).toBeEnabled();
    await finishGuildCopy(page, 0, denied);
    await expect(page.getByRole('textbox', {name: '公會公開連結', exact: true})).toHaveCount(0);
    await expect(page.getByText(/無法自動複製|已複製公會連結/)).toHaveCount(0);
    await page.getByRole('button', {name: '複製公會連結', exact: true}).click();
    expect(await page.evaluate(() => (window as unknown as ClipboardWindow).guildCopies[1].value)).toBe(`${new URL(baseURL!).origin}/#guilds/${space}`);
    await finishGuildCopy(page, 1);
    await expect(page.getByText('已複製公會連結', {exact: true})).toBeVisible();
  } finally {await context.close();}
});

test('public guild shortcuts follow published contact settings and respect disabled resource blocks', async ({browser, baseURL, e2eAuthPool}) => {
  test.setTimeout(180_000);
  const fixture = await seed(e2eAuthPool);
  const leader = await login(browser, baseURL!, fixture.email);
  const context = await browser.newContext({baseURL, viewport: {width: 390, height: 844}});
  await context.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  const visitor = await context.newPage();
  const path = `/api/v1/guilds/${edited}/launchpad-config`;
  const auth = await (await leader.page.request.get('/api/v1/session')).json();
  async function command(suffix: string, data: unknown, version: string) {
    const response = await leader.page.request.post(path + suffix, {data, headers: {
      Origin: new URL(baseURL!).origin, 'X-CSRF-Token': auth.csrf_token,
      'Idempotency-Key': randomUUID(), 'If-Match': `"${version}"`,
    }});
    expect(response.ok()).toBe(true);
    return await response.json() as ConfigView;
  }
  let original: ConfigView | undefined;
  let originalPublished: ConfigView['body'] | undefined;
  try {
    original = await (await leader.page.request.get(path)).json() as ConfigView;
    // The authenticated member read exposes the complete published config;
    // the public projection intentionally filters recommendations/extensions.
    const publishedBefore = await (await leader.page.request.get(`/api/v1/guilds/${edited}/launchpad`)).json() as {config: ConfigView};
    originalPublished = structuredClone(publishedBefore.config.body);
    const body = original.body.schema_version === 'guild-launchpad.config/v1' ? convertV1(original.body) : structuredClone(original.body);
    body.support = {kind: 'guild_public_contact', public_url: 'https://community.example.test/join'};
    for (const block of body.blocks) if (['skill_books', 'support'].includes(block.kind)) block.enabled = true;
    let draft = await command('/drafts', {body}, original.pointer_version);
    let published = await command(`/${draft.config_id}/publish`, {expected_body_sha256: draft.body_sha256}, draft.pointer_version);
    await visitor.goto(`/#guilds/${edited}`);
    const contact = visitor.getByRole('link', {name: /聯絡這個公會/});
    await expect(contact).toHaveAttribute('href', 'https://community.example.test/join');
    await expect(contact).toContainText('community.example.test · 另開分頁');
    await expect(contact).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(visitor.getByRole('button', {name: '查看公會技能書', exact: true})).toBeVisible();
    body.support.public_url = 'https://draft.example.test/not-published';
    draft = await command('/drafts', {body}, published.pointer_version);
    await visitor.reload();
    await expect(contact).toHaveAttribute('href', 'https://community.example.test/join');
    await expect(visitor.locator('body')).not.toContainText('draft.example.test');
    await expect(visitor.locator('a[href*="draft.example.test"]')).toHaveCount(0);
    // Publishing a platform help URL must not describe it as a guild contact.
    body.support = {kind: 'platform_help', public_url: 'https://help.example.test/platform'};
    draft = await command('/drafts', {body}, draft.pointer_version);
    published = await command(`/${draft.config_id}/publish`, {expected_body_sha256: draft.body_sha256}, draft.pointer_version);
    await visitor.reload();
    await expect(visitor.getByRole('button', {name: '複製公會連結', exact: true})).toBeVisible();
    await expect(contact).toHaveCount(0);
    body.support = {kind: 'guild_public_contact', public_url: 'https://hidden.example.test/contact'};
    for (const block of body.blocks) if (['skill_books', 'support'].includes(block.kind)) block.enabled = false;
    draft = await command('/drafts', {body}, published.pointer_version);
    await command(`/${draft.config_id}/publish`, {expected_body_sha256: draft.body_sha256}, draft.pointer_version);
    await visitor.reload();
    await expect(visitor.getByRole('button', {name: '複製公會連結', exact: true})).toBeVisible();
    await expect(visitor.getByRole('button', {name: '查看公會技能書', exact: true})).toHaveCount(0);
    await expect(contact).toHaveCount(0);
    await expect(visitor.locator('body')).not.toContainText('hidden.example.test');
    await expect(visitor.locator('a[href*="hidden.example.test"]')).toHaveCount(0);
    await noOverflow(visitor);
  } finally {
    try {
      // Restore both visible bodies through normal versioned commands;
      // immutable history remains in this disposable schema. A later published
      // revision does not remove earlier drafts, so also restore the editor.
      // Never publish a pre-existing member draft during cleanup.
      if (original && originalPublished) {
        const latest = await (await leader.page.request.get(path)).json() as ConfigView;
        const restoredDraft = await command('/drafts', {body: originalPublished}, latest.pointer_version);
        const restored = await command(`/${restoredDraft.config_id}/publish`, {expected_body_sha256: restoredDraft.body_sha256}, restoredDraft.pointer_version);
        await command('/drafts', {body: original.body}, restored.pointer_version);
      }
    } finally {await context.close(); await leader.context.close(); await cleanup(e2eAuthPool, fixture.userId, fixture.previousOfficer);}
  }
});

test('an unavailable public guild never offers a successful public entry', async ({browser, baseURL}) => {
  const context = await browser.newContext({baseURL});
  await context.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  const page = await context.newPage();
  await page.route(`**/api/v1/public/guilds/${music}/launchpad`, route => route.fulfill({status: 503, json: {code: 'service_unavailable', detail: '公會資料暫時無法讀取。'}}));
  try {
    await page.goto(`/#guilds/${music}`);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('region', {name: '公會公開入口', exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: '會員登入', exact: true})).toBeVisible();
  } finally {await context.close();}
});

test('a late response from guild A never renders inside guild B', async ({browser, baseURL, e2eAuthPool}) => {
  test.setTimeout(180_000);
  const fixture = await seed(e2eAuthPool);
  const session = await login(browser, baseURL!, fixture.email);
  let seen = false;
  let release: () => void = () => undefined;
  const delivered = new Promise<void>(resolve => { release = resolve; });
  await session.page.route('**/api/v1/guilds/guild_event_space/launchpad', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    seen = true;
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      const response = await route.fetch();
      const json = await response.json();
      json.guild.name = 'LAUNCHPAD_A_MARKER';
      await route.fulfill({status: response.status(), contentType: 'application/json', json});
    } finally { release(); }
  });
  try {
    await session.page.evaluate(() => { window.location.hash = 'guilds/guild_event_space'; });
    await expect.poll(() => seen).toBe(true);
    await session.page.evaluate(() => { window.location.hash = 'guilds/guild_music_mv'; });
    await expect(session.page.getByRole('heading', {level: 1, name: fixture.musicName})).toBeVisible();
    await delivered;
    await expect(session.page.getByText('LAUNCHPAD_A_MARKER')).toHaveCount(0);
    await expect(session.page.getByRole('heading', {level: 1})).toHaveText(fixture.musicName);
  } finally { await session.context.close(); await cleanup(e2eAuthPool, fixture.userId, fixture.previousOfficer); }
});

test('a non-primary guild leader edits, publishes, and reverts the launchpad', async ({browser, baseURL, e2eAuthPool}) => {
  test.setTimeout(180_000);
  const fixture = await seed(e2eAuthPool);
  const session = await login(browser, baseURL!, fixture.email);
  const first = `使命甲 ${randomUUID().slice(0, 8)}`;
  const second = `使命乙 ${randomUUID().slice(0, 8)}`;
  await holdGuildClipboard(session.page);
  try {
    await session.page.reload();
    await navigate(session.page, '職業公會');
    await session.page.setViewportSize({width: 360, height: 800});
    const card = session.page.getByRole('article', {name: fixture.editedName, exact: true});
    await card.scrollIntoViewIfNeeded();
    const open = card.getByRole('button', {name: '進入公會工作區', exact: true});
    await expect(open).toBeVisible();
    expect(await open.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await noOverflow(session.page);
    await session.page.setViewportSize({width: 1280, height: 900});
    await open.click();
    await expect(session.page.getByRole('heading', {level: 1, name: fixture.editedName})).toBeVisible();
    const guide = session.page.getByRole('region', {name: '公會工作區導覽', exact: true});
    await expect(guide).toBeVisible();
    const launchpadResponse = await session.page.request.get(`/api/v1/guilds/${edited}/launchpad`);
    expect(launchpadResponse.status()).toBe(200);
    const launchpadData = await launchpadResponse.json();
    await expect(guide).toContainText(launchpadData.config.body.mission_override ?? launchpadData.guild.purpose);
    if (launchpadData.config.body.blocks.some((block: {kind: string; enabled: boolean}) => block.kind === 'skill_books' && block.enabled) && launchpadData.skill_books.length) await expect(guide).toContainText(launchpadData.skill_books[0].title);
    const back = session.page.getByRole('button', {name: '返回公會列表', exact: true});
    await expect(back).toBeVisible();
    const backBox = await back.boundingBox();
    expect(backBox).not.toBeNull();
    expect(backBox!.width).toBeLessThan(400);
    await expect(session.page.getByRole('link', {name: '前往業務空間', exact: true})).toBeVisible();
    await expect(session.page.locator('.guild-launchpad-editor')).toBeHidden();
    const managementWrites: string[] = [];
    session.page.on('request', request => {if (/\/launchpad-(config|delegations)(?:\/|$)/.test(new URL(request.url()).pathname) && request.method() === 'POST') managementWrites.push(request.url());});
    await openGuildSection(session.page, '管理啟動台');
    await session.page.getByRole('button', {name: '成員授權', exact: true}).click();
    await expect(session.page.getByText('目前沒有授權。', {exact: true})).toBeVisible();
    await session.page.getByRole('button', {name: '工具與提示', exact: true}).click();
    await expect(session.page.getByRole('button', {name: '儲存草稿', exact: true})).toHaveClass(/btn-ghost/);
    await expect(session.page.getByRole('button', {name: '發布', exact: true})).toHaveClass(/btn-primary/);
    await session.page.locator('#launchpad-support-url').fill('http://example.com/help');
    await session.page.getByRole('button', {name: '版面與使命', exact: true}).click();
    await expect(session.page.locator('#launchpad-support-url')).toBeHidden();
    expect(managementWrites).toEqual([]);
    await session.page.getByRole('button', {name: '儲存草稿', exact: true}).click();
    const urlError = session.page.locator('#launchpad-support-url-error');
    await expect(session.page.getByRole('heading', {name: '工具與提示', exact: true})).toBeFocused();
    await expect(session.page.locator('#launchpad-support-url')).toBeVisible();
    await expect(session.page.locator('#launchpad-support-url')).toHaveValue('http://example.com/help');
    await expect(urlError).toHaveText('只接受 https:// 開頭、不含帳號密碼的網址');
    await expect(session.page.locator('#launchpad-support-url')).toHaveAttribute('aria-describedby', /launchpad-support-url-error/);
    await expect(session.page.getByText('unsupported_url')).toHaveCount(0);
    await expect(session.page.getByText('blocks.')).toHaveCount(0);
    await session.page.locator('#launchpad-support-url').fill('');
    await session.page.getByRole('button', {name: '版面與使命', exact: true}).click();
    await session.page.locator('#launchpad-mission').fill(first);
    await session.page.getByRole('button', {name: '工具與提示', exact: true}).click();
    await expect(session.page.getByRole('button', {name: '發布', exact: true})).toBeDisabled();
    await session.page.getByRole('button', {name: '版面與使命', exact: true}).click();
    await expect(session.page.locator('#launchpad-mission')).toHaveValue(first);
    // Sharing works while signed in and leaves the active editor/draft intact.
    await session.page.getByRole('button', {name: '複製公會連結', exact: true}).click();
    await finishGuildCopy(session.page, 0, true);
    await expect(session.page.getByRole('textbox', {name: '公會公開連結', exact: true})).toHaveValue(`${new URL(baseURL!).origin}/#guilds/${edited}`);
    await expect(session.page.locator('#launchpad-mission')).toBeVisible();
    await expect(session.page.locator('#launchpad-mission')).toHaveValue(first);
    await session.page.getByRole('button', {name: '複製公會連結', exact: true}).click();
    await finishGuildCopy(session.page, 1);
    await expect(session.page.getByText('已複製公會連結', {exact: true})).toBeVisible();
    await expect(session.page.locator('#launchpad-mission')).toHaveValue(first);
    const moveAnnouncements = session.page.getByRole('button', {name: '上移公告', exact: true});
    for (let step = 0; step < 7; step += 1) {
      if (await session.page.locator('.guild-launchpad-content > section > h2').first().innerText() === '公告') break;
      await moveAnnouncements.click();
    }
    await expect(session.page.locator('.guild-launchpad-content > section > h2').first()).toHaveText('公告');
    await session.page.getByRole('button', {name: '預覽公開', exact: true}).click();
    const preview = session.page.getByRole('dialog');
    await expect(preview.getByRole('heading', {name: '合成預覽'})).toBeVisible();
    await expect(preview.getByText('合成資料')).toBeVisible();
    await preview.getByRole('button', {name: '關閉', exact: true}).click();
    await session.page.getByRole('button', {name: '儲存草稿', exact: true}).click();
    await expect(session.page.getByText(/已儲存草稿版本/)).toBeVisible();
    await session.page.getByRole('button', {name: '發布', exact: true}).click();
    await session.page.getByRole('button', {name: '確認發布', exact: true}).click();
    const published = session.page.getByText(/已發布版本 \d+/);
    await expect(published).toBeVisible();
    const revision = /已發布版本 (\d+)/.exec(await published.innerText())?.[1];
    expect(revision).toBeTruthy();
    await openGuildSection(session.page, '公會資訊');
    await expect(session.page.getByText(first).first()).toBeVisible();
    await openGuildSection(session.page, '管理啟動台');
    await session.page.locator('#launchpad-mission').fill(second);
    await session.page.getByRole('button', {name: '儲存草稿', exact: true}).click();
    await expect(session.page.getByText(/已儲存草稿版本/)).toBeVisible();
    await session.page.getByRole('button', {name: '發布', exact: true}).click();
    await session.page.getByRole('button', {name: '確認發布', exact: true}).click();
    await openGuildSection(session.page, '公會資訊');
    await expect(session.page.getByText(second).first()).toBeVisible();
    await openGuildSection(session.page, '管理啟動台');
    await session.page.getByRole('button', {name: '版本紀錄', exact: true}).click();
    await session.page.getByRole('listitem').filter({hasText: `版本 ${revision}`}).getByRole('button', {name: '回復到此版本', exact: true}).click();
    await session.page.getByRole('dialog').getByLabel('回復原因').fill('回復這次測試的第一個發布');
    await session.page.getByRole('button', {name: '確認回復', exact: true}).click();
    await expect(session.page.getByText(/已發布版本 \d+/)).toBeVisible();
    await expect(session.page.locator('#launchpad-mission')).toHaveValue(first);
    await openGuildSection(session.page, '公會資訊');
    await expect(session.page.getByText(first).first()).toBeVisible();
    await openGuildSection(session.page, '管理啟動台');
    const writesBeforePanelTour = managementWrites.length;
    for (const width of [320, 390, 1280]) {
      await session.page.setViewportSize({width, height: 800});
      for (const name of ['版面與使命', '工具與提示', '版本紀錄', '成員授權']) {
        await session.page.getByRole('button', {name, exact: true}).click();
        await expect(session.page.getByRole('heading', {name, exact: true})).toBeVisible();
        await expect(session.page.locator('.guild-editor-panel:visible')).toHaveCount(1);
        await expect(session.page.locator('.guild-editor-panel[hidden]')).toHaveCount(3);
        for (const hidden of await session.page.locator('.guild-editor-panel[hidden]').all()) {
          await expect(hidden).toBeHidden();
          expect(await hidden.evaluate(element => getComputedStyle(element).display)).toBe('none');
        }
        await noOverflow(session.page);
        await tallEnough(session.page);
      }
    }
    expect(managementWrites).toHaveLength(writesBeforePanelTour);
  } finally { await session.context.close(); await cleanup(e2eAuthPool, fixture.userId, fixture.previousOfficer); }
});

test('a chair delegates editing and preview only, then revokes access from a stale editor', async ({browser, baseURL, e2eAuthPool}) => {
  test.setTimeout(180_000);
  const chair = await seed(e2eAuthPool);
  const member = await seed(e2eAuthPool, false);
  // Existing active membership and person identity are fixture data; grants,
  // drafts, previews and revocation all go through the real authenticated API.
  await e2eAuthPool.query('INSERT INTO principals(user_ref) VALUES($1) ON CONFLICT (user_ref) DO NOTHING', [member.userId]);
  const sessions: Awaited<ReturnType<typeof login>>[] = [];
  const path = `/api/v1/guilds/${edited}`;
  const mission = `委派草稿 ${randomUUID().slice(0, 8)}`;
  try {
    const leader = await login(browser, baseURL!, chair.email);
    sessions.push(leader);
    const delegate = await login(browser, baseURL!, member.email);
    sessions.push(delegate);
    const publicBefore = await leader.page.request.get(`/api/v1/public/guilds/${edited}/launchpad`);
    expect(publicBefore.status()).toBe(200);
    const publicConfig = (await publicBefore.json()).config;
    await leader.page.goto(`/#guilds/${edited}`);
    await expect(leader.page.getByRole('heading', {level: 1, name: chair.editedName})).toBeVisible();
    await openGuildSection(leader.page, '管理啟動台');
    await leader.page.getByRole('button', {name: '成員授權', exact: true}).click();
    await leader.page.getByRole('combobox', {name: '成員', exact: true}).selectOption({label: member.displayName});
    await leader.page.getByLabel('編輯內容', {exact: true}).check();
    await leader.page.getByLabel('預覽配置', {exact: true}).check();
    await leader.page.getByLabel('發布配置', {exact: true}).uncheck();
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
    await leader.page.getByLabel('到期時間', {exact: true}).fill(expiry);
    const granted = leader.page.waitForResponse(response => response.url().endsWith(`${path}/launchpad-delegations`) && response.request().method() === 'POST');
    await leader.page.getByRole('button', {name: '授權', exact: true}).click();
    const grantResponse = await granted;
    expect(grantResponse.status()).toBe(201);
    const grant = await grantResponse.json();
    expect(grant.capabilities).toEqual(['guild.content.edit', 'guild.config.preview']);
    await expect(leader.page.getByText('已新增授權。', {exact: true})).toBeVisible();

    await delegate.page.goto(`/#guilds/${edited}`);
    await openGuildSection(delegate.page, '管理啟動台');
    await expect(delegate.page.locator('#launchpad-mission')).toBeVisible();
    await expect(delegate.page.getByRole('button', {name: '版本紀錄', exact: true})).toHaveCount(0);
    await expect(delegate.page.getByRole('button', {name: '成員授權', exact: true})).toHaveCount(0);
    await expect(delegate.page.getByRole('button', {name: '發布', exact: true})).toHaveCount(0);
    await expect(delegate.page.getByRole('button', {name: '授權', exact: true})).toHaveCount(0);
    await expect(delegate.page.getByRole('button', {name: '撤銷', exact: true})).toHaveCount(0);
    await expect(delegate.page.getByRole('combobox', {name: '成員', exact: true})).toHaveCount(0);
    await delegate.page.locator('#launchpad-mission').fill(mission);
    const saved = delegate.page.waitForResponse(response => response.url().endsWith(`${path}/launchpad-config/drafts`) && response.request().method() === 'POST');
    await delegate.page.getByRole('button', {name: '儲存草稿', exact: true}).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(201);
    const draft = await savedResponse.json();
    expect(draft.body.mission_override).toBe(mission);
    await expect(delegate.page.getByText(/已儲存草稿版本/)).toBeVisible();
    const previewed = delegate.page.waitForResponse(response => response.url().endsWith(`${path}/launchpad-config/preview`) && response.request().method() === 'POST');
    await delegate.page.getByRole('button', {name: '預覽公開', exact: true}).click();
    const previewResponse = await previewed;
    expect(previewResponse.status()).toBe(200);
    expect(await previewResponse.json()).toMatchObject({effective_config: {mission_override: mission}, preview_data_origin: 'synthetic_fixture'});
    const preview = delegate.page.getByRole('dialog', {name: '合成預覽', exact: true});
    await expect(preview).toBeVisible();
    await preview.getByRole('button', {name: '關閉', exact: true}).click();

    // Hidden controls are not the permission boundary: correctly formed direct
    // requests must still be rejected by the server while this grant is active.
    const auth = await (await delegate.page.request.get('/api/v1/session')).json();
    for (const attempt of [
      {url: `${path}/launchpad-config/${draft.config_id}/publish`, body: {expected_body_sha256: draft.body_sha256}, version: draft.pointer_version},
      {url: `${path}/launchpad-delegations`, body: {principal_id: grant.principal_id, capabilities: ['guild.config.publish'], expires_at: grant.expires_at}, version: '1'},
      {url: `${path}/launchpad-delegations/${grant.delegation_id}/revoke`, body: {reason: '委派者不能管理授權'}, version: grant.version},
    ]) {
      const response = await delegate.page.request.post(attempt.url, {data: attempt.body, headers: {
        Origin: new URL(delegate.page.url()).origin, 'X-CSRF-Token': auth.csrf_token,
        'Idempotency-Key': randomUUID(), 'If-Match': `"${attempt.version}"`,
      }});
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({code: 'guild_leader_required'});
    }
    const publicAfterSave = await leader.page.request.get(`/api/v1/public/guilds/${edited}/launchpad`);
    expect(publicAfterSave.status()).toBe(200);
    expect((await publicAfterSave.json()).config).toEqual(publicConfig);

    // Keep the delegate's loaded form open while the chair revokes in another
    // session, so the denial cannot be explained by simply hiding the editor.
    await delegate.page.locator('#launchpad-mission').fill(`${mission} 撤權後修改`);
    await leader.page.getByRole('listitem').filter({hasText: member.displayName}).getByRole('button', {name: '撤銷', exact: true}).click();
    await leader.page.getByRole('dialog', {name: '撤銷授權', exact: true}).getByLabel('撤銷原因', {exact: true}).fill('結束本次編輯委派');
    const revoked = leader.page.waitForResponse(response => response.url().endsWith(`${path}/launchpad-delegations/${grant.delegation_id}/revoke`) && response.request().method() === 'POST');
    await leader.page.getByRole('button', {name: '確認撤銷', exact: true}).click();
    expect((await revoked).status()).toBe(200);
    await expect(leader.page.getByText('已撤銷授權。', {exact: true})).toBeVisible();
    for (const action of [
      {label: '儲存草稿', endpoint: 'drafts'},
      {label: '預覽公開', endpoint: 'preview'},
    ]) {
      const denied = delegate.page.waitForResponse(response => response.url().endsWith(`${path}/launchpad-config/${action.endpoint}`) && response.request().method() === 'POST');
      await delegate.page.getByRole('button', {name: action.label, exact: true}).click();
      const response = await denied;
      expect(response.status()).toBe(403);
      expect(await response.json()).toMatchObject({code: 'guild_leader_required'});
      await expect(delegate.page.getByRole('alert')).toHaveText('此操作限目前在任的公會長。');
    }
    await expect(delegate.page.getByRole('dialog', {name: '合成預覽', exact: true})).not.toBeVisible();
    const latest = await leader.page.request.get(`${path}/launchpad-config`);
    expect(latest.status()).toBe(200);
    expect(await latest.json()).toMatchObject({config_id: draft.config_id, revision: draft.revision, pointer_version: draft.pointer_version, body: {mission_override: mission}});
    const publicAfterRevoke = await leader.page.request.get(`/api/v1/public/guilds/${edited}/launchpad`);
    expect(publicAfterRevoke.status()).toBe(200);
    expect((await publicAfterRevoke.json()).config).toEqual(publicConfig);
    await delegate.page.reload();
    await expect(delegate.page.getByRole('heading', {level: 1, name: chair.editedName})).toBeVisible();
    await expect(delegate.page.locator('#launchpad-mission')).toHaveCount(0);
    await expect(delegate.page.getByRole('button', {name: '預覽公開', exact: true})).toHaveCount(0);
  } finally {
    for (const session of sessions) await session.context.close();
    await cleanup(e2eAuthPool, member.userId, undefined);
    await cleanup(e2eAuthPool, chair.userId, chair.previousOfficer);
  }
});

test('a member who left can rejoin from the launchpad', async ({browser, baseURL, e2eAuthPool}) => {
  test.setTimeout(120_000);
  const run = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const email = `launchpad-rejoin-${run}@example.invalid`;
  const names = await e2eAuthPool.query('SELECT name FROM positioning_guild_catalog WHERE guild_key=$1', [music]);
  const musicName = names.rows[0].name as string;
  await e2eAuthPool.query(`INSERT INTO users(user_id, community_id, email, display_name, password_hash, profession_membership_ref, onboarding_required)
    VALUES($1,$2,$3,$4,$5,$6,false)`, [userId, DEMO_COMMUNITY, email, `再加入會員 ${run}`, hashPassword(DEMO_PASSWORD), randomUUID()]);
  await e2eAuthPool.query(`INSERT INTO positioning_profession_memberships(membership_id, community_id, user_id, guild_key, state, member_tier)
    VALUES($1,$2,$3,$4,'active','full')`, [randomUUID(), DEMO_COMMUNITY, userId, space]);
  await e2eAuthPool.query(`INSERT INTO positioning_profession_memberships(membership_id, community_id, user_id, guild_key, state, member_tier, aggregate_version)
    VALUES($1,$2,$3,$4,'left','full',4)`, [randomUUID(), DEMO_COMMUNITY, userId, music]);
  await e2eAuthPool.query(`INSERT INTO guild_member_preferences(community_id, user_id, primary_guild_key) VALUES($1,$2,$3)`, [DEMO_COMMUNITY, userId, space]);
  const session = await login(browser, baseURL!, email);
  let ifMatch = '';
  await session.page.route('**/api/v1/guilds/guild_music_mv/join', async route => {
    ifMatch = route.request().headers()['if-match'] ?? '';
    await route.continue();
  });
  try {
    await session.page.goto(`/#guilds/${music}`);
    await session.page.getByRole('button', {name: `加入${musicName}`, exact: true}).click();
    await expect(session.page.getByText('成員身分：實習成員')).toBeVisible();
    expect(ifMatch).toBe('"4"');
  } finally { await session.context.close(); await cleanup(e2eAuthPool, userId, undefined); }
});

test('a failed public launchpad chunk can return home and recover after reload', async ({browser, baseURL}) => {
  const context = await browser.newContext({baseURL, viewport: {width: 360, height: 800}});
  await context.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  const page = await context.newPage();
  const chunk = /\/assets\/GuildLaunchpadPage-[^/]+\.js$/;
  await page.route(chunk, route => route.abort());
  try {
    await page.goto(`/#guilds/${music}`);
    await expect(page.getByRole('alert')).toContainText('自由工坊暫時無法開啟');
    await page.getByRole('link', {name: '返回首頁', exact: true}).click();
    await expect(page).toHaveURL(/\/#home$/);
    await expect(page.getByLabel('電子郵件', {exact: true})).toBeVisible();
    await expect(page.getByRole('alert').filter({hasText: '自由工坊暫時無法開啟'})).toHaveCount(0);
    // React.lazy caches its rejected promise; recovery deliberately offers a
    // document reload rather than pretending a second route visit retries it.
    await page.goto(`/#guilds/${music}`);
    await expect(page.getByRole('alert')).toContainText('自由工坊暫時無法開啟');
    await page.unroute(chunk);
    await page.getByRole('button', {name: '重新載入頁面', exact: true}).click();
    await expect(page.locator('.guild-launchpad')).toBeVisible();
    await expect(page.getByRole('button', {name: '會員登入', exact: true})).toBeVisible();
  } finally { await context.close(); }
});

test('resource previews focus the actual destination on mobile, including same-section and empty custom layouts', async ({browser, baseURL, e2eAuthPool}) => {
  test.setTimeout(120_000);
  const fixture = await seed(e2eAuthPool, false);
  const session = await login(browser, baseURL!, fixture.email);
  type Scenario = {books: boolean; information: boolean; announcements: boolean; booksEnabled: boolean};
  let scenario: Scenario = {books: true, information: true, announcements: true, booksEnabled: true};
  const marker = `合成資源 ${randomUUID().slice(0, 8)}`;
  await session.page.route(`**/api/v1/guilds/${music}/launchpad`, async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const member = await response.json();
    const original = member.config.body;
    const body = original.schema_version === 'guild-launchpad.config/v1' ? convertV1(original) : structuredClone(original);
    body.blocks = [
      {id: 'mission', kind: 'mission', order: 0, enabled: scenario.information, title: null},
      {id: 'announcements', kind: 'announcements', order: 1, enabled: scenario.announcements, title: null},
      {id: 'skill_books', kind: 'skill_books', order: 2, enabled: scenario.booksEnabled, title: null},
    ];
    body.application_refs = [];
    await route.fulfill({response, json: {...member, config: {...member.config, body}, applications: [],
      viewer_can_edit_config: false, viewer_can_preview_config: false, viewer_can_publish_config: false, viewer_can_manage_delegations: false,
      skill_books: scenario.books ? [{book_id: 'synthetic-book', title: marker, introduction_url: 'https://example.invalid/intro', upstream_url: 'https://example.invalid/source'}] : [],
      announcements: scenario.announcements ? [{announcement_id: 'synthetic-announcement', title: `${marker}公告`, body: '這是隔離的導覽測試內容。', published_at: '2026-10-30T00:00:00Z'}] : [],
    }});
  });
  const guide = session.page.getByRole('region', {name: '公會工作區導覽', exact: true});
  const books = guide.getByRole('button', {name: /^入門技能書/});
  const announcements = guide.getByRole('button', {name: /^公會公告/});
  const destination = (kind: string) => session.page.locator(`[data-launchpad-kind="${kind}"] > h2`);
  const inView = async (kind: string) => {
    const heading = destination(kind);
    await expect(heading).toBeFocused();
    await expect(heading).toBeVisible();
    await expect.poll(async () => heading.evaluate(node => {const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight;})).toBe(true);
  };
  try {
    await session.page.goto(`/#guilds/${music}`);
    for (const width of [360, 1280]) {
      await session.page.setViewportSize({width, height: 800});
      await expect(guide).toContainText(marker);
      await announcements.click(); await inView('announcements'); // Information may already be selected.
      await announcements.click(); await inView('announcements'); // Repeating is not a no-op.
      await books.click(); await inView('skill_books');
      await books.click(); await inView('skill_books');
      await announcements.click(); await inView('announcements');
      await noOverflow(session.page);
    }
    await session.page.setViewportSize({width: 360, height: 800});
    scenario = {books: false, information: true, announcements: false, booksEnabled: true};
    await session.page.reload(); await expect(books).toContainText('先閱讀公會資訊');
    await books.click(); await inView('mission');
    scenario = {...scenario, information: false};
    await session.page.reload(); await expect(books).toBeDisabled();
    await expect(books).toContainText('目前沒有可顯示的入門資源');
    await expect(guide).not.toContainText('先閱讀公會資訊');
    scenario = {books: true, information: true, announcements: false, booksEnabled: false};
    await session.page.reload(); await expect(guide).toBeVisible();
    await expect(books).toHaveCount(0);
    await expect(guide).not.toContainText(marker);
    await noOverflow(session.page);
  } finally {
    await session.context.close();
    await cleanup(e2eAuthPool, fixture.userId, fixture.previousOfficer);
  }
});
