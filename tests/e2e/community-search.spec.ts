import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import { test, expect, type Browser, type Page } from './fixtures.js';
import { navigate } from './navigation.js';
import { DEMO_COMMUNITY, DEMO_PASSWORD, DEMO_USERS } from '../../packages/testing/seed.js';
import { communityCatalog } from '../../modules/community/catalog.js';

// SQL supplies synthetic fixtures; all sign-in, search, topic writes and navigation
// below use the actual HTTP app. The harness owns and drops the whole test schema.
async function person(db: Pool, community = DEMO_COMMUNITY) {
  const id = randomUUID(), email = `search-browser-${id}@local.test`;
  await db.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    SELECT $1,$2,$3,'搜尋瀏覽器會員',password_hash,$4,false FROM users WHERE user_id=$5`,
  [id, community, email, randomUUID(), DEMO_USERS[0].user_id]);
  return { id, email, community };
}
async function signedIn(browser: Browser, baseURL: string, email: string) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill(email);
  await page.getByLabel('密碼', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.shell')).toBeVisible();
  return { context, page };
}
async function post(page: Page, path: string, body: unknown, expected = 201) {
  const session = await (await page.request.get('/api/v1/session')).json();
  const response = await page.request.post(`/api/v1${path}`, { data: body, headers: {
    Origin: new URL(page.url()).origin, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': randomUUID(),
  } });
  expect(response.status(), await response.text()).toBe(expected);
  return response;
}
async function search(page: Page, query: string) {
  await navigate(page, '搜尋社群內容');
  await expect(page.getByRole('heading', { level: 1, name: '搜尋社群內容', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '關鍵字', exact: true }).fill(query);
  await expect(page.getByRole('region', { name: '社群內容搜尋結果' })).toHaveAttribute('aria-busy', 'false');
}
const results = (page: Page) => page.getByRole('region', { name: '社群內容搜尋結果' });

test('SEARCH-001 actual anonymous and member HTTP search keep public and same-community audiences separate', async ({ browser, page, baseURL, e2eAuthPool }) => {
  const token = `搜尋範圍${randomUUID().slice(0, 8)}`;
  const foreignCommunity = randomUUID();
  let logged: Awaited<ReturnType<typeof signedIn>> | undefined;
  try {
    const member = await person(e2eAuthPool);
    await e2eAuthPool.query('INSERT INTO communities VALUES($1,$2)', [foreignCommunity, '搜尋外部合成社群']);
    const foreign = await person(e2eAuthPool, foreignCommunity);
    const event = randomUUID();
    await e2eAuthPool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
      VALUES($1,$2,$3,$4,'公開摘要',now()+interval '1 day',now()+interval '2 days','online','私人位置','published','open','other')`,
    [event, DEMO_COMMUNITY, member.id, `${token}公開活動`]);
    await e2eAuthPool.query(`INSERT INTO community_social_posts(post_id,community_id,author_user_id,kind,url,platform,title,note,state)
      VALUES($1,$2,$3,'note',NULL,'other',$4,$4,'active')`, [randomUUID(), foreignCommunity, foreign.id, `${token}外社群貼文`]);
    logged = await signedIn(browser, baseURL!, member.email);
    await post(logged.page, '/social-posts/notes', { text: `${token}會員貼文` });
    const site = await page.request.get('/api/v1/site');
    expect((await site.json()).community_search_enabled).toBe(true);
    await page.goto(`/#community-search?q=${encodeURIComponent(token)}`);
    await expect(results(page).getByRole('link', { name: `${token}公開活動`, exact: true })).toBeVisible();
    await expect(results(page).getByRole('link', { name: `${token}會員貼文`, exact: true })).toHaveCount(0);
    await expect(results(page)).not.toContainText('外社群貼文');
    await expect(page.getByRole('button', { name: '編輯我的內容主題', exact: true })).toHaveCount(0);
    expect(await results(page).innerText()).not.toContain('私人位置');
    await search(logged.page, token);
    await expect(results(logged.page).getByRole('link', { name: `${token}會員貼文`, exact: true })).toBeVisible();
    await expect(results(logged.page).getByRole('link', { name: `${token}公開活動`, exact: true })).toBeVisible();
    await expect(results(logged.page)).not.toContainText('外社群貼文');
  } finally {
    try { await logged?.context.close(); }
    finally {
      // Other tests share this schema. Keep local registration's single-community
      // fallback usable, including when this test fails partway through setup.
      const cleanup = await e2eAuthPool.connect();
      try {
        await cleanup.query('BEGIN');
        await cleanup.query('DELETE FROM community_social_posts WHERE community_id=$1', [foreignCommunity]);
        await cleanup.query('DELETE FROM users WHERE community_id=$1', [foreignCommunity]);
        await cleanup.query('DELETE FROM communities WHERE community_id=$1', [foreignCommunity]);
        await cleanup.query('COMMIT');
      } catch (error) {
        await cleanup.query('ROLLBACK');
        throw error;
      } finally { cleanup.release(); }
    }
  }
});

test('SEARCH-002 real showcase links focus the existing card and browser back retains the query in light/dark layouts', async ({ browser, baseURL, e2eAuthPool }, testInfo) => {
  const member = await person(e2eAuthPool), title = `搜尋作品${randomUUID().slice(0, 8)}`;
  const logged = await signedIn(browser, baseURL!, member.email);
  try {
    const made = await (await post(logged.page, '/showcases', { title, description: '這是本人分享的合成作品摘要。', consent_to_share: true })).json();
    await search(logged.page, title);
    const link = results(logged.page).getByRole('link', { name: title, exact: true });
    await expect(link).toHaveAttribute('href', `#showcase/${made.showcase_id}`);
    for (const skin of ['light', 'dark'] as const) for (const width of [390, 1440]) {
      await logged.page.evaluate(value => {
        localStorage.setItem('freedom-theme', value);
        document.documentElement.dataset.theme = value;
        document.documentElement.dataset.experienceProfile = value;
        window.dispatchEvent(new Event('freedom-theme-changed'));
      }, skin);
      await logged.page.setViewportSize({ width, height: 900 });
      expect(await logged.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await logged.page.getByRole('searchbox', { name: '關鍵字', exact: true }).evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
      const controls = logged.page.locator('.community-content-search fieldset label');
      for (const control of await controls.all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await logged.page.locator('.community-content-search').screenshot({ path: testInfo.outputPath(`search-${skin}-${width}.png`) });
    }
    await link.click();
    const card = logged.page.locator(`#showcase-${made.showcase_id}`);
    await expect(card).toBeVisible(); await expect(card).toBeFocused();
    await logged.page.goBack();
    await expect(logged.page.getByRole('searchbox', { name: '關鍵字', exact: true })).toHaveValue(title);
    await expect(results(logged.page).getByRole('link', { name: title, exact: true })).toBeVisible();
  } finally { await logged.context.close(); }
});

test('SEARCH-003 current full-guild maintainer saves topics through HTTP while an ordinary member cannot see or forge that editor', async ({ browser, baseURL, e2eAuthPool }) => {
  const maintainer = await person(e2eAuthPool), ordinary = await person(e2eAuthPool), admin = randomUUID();
  const occupied = new Set((await e2eAuthPool.query('SELECT book_id FROM skill_editorial_ownership')).rows.map(row => row.book_id));
  const book = communityCatalog.skill_books.find(item => !occupied.has(item.id));
  expect(book).toBeTruthy();
  await e2eAuthPool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier)
    VALUES($1,$2,$3,'guild_ai_vibe','active','full')`, [randomUUID(), DEMO_COMMUNITY, maintainer.id]);
  await e2eAuthPool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)', [admin, DEMO_COMMUNITY, `search-admin-${admin}@local.test`, '合成管理員']);
  await e2eAuthPool.query('INSERT INTO skill_editorial_ownership(book_id,community_id) VALUES($1,$2)', [book!.id, DEMO_COMMUNITY]);
  await e2eAuthPool.query('INSERT INTO skill_book_maintainers(book_id,community_id,user_id,appointed_by,active) VALUES($1,$2,$3,$4,true)', [book!.id, DEMO_COMMUNITY, maintainer.id, admin]);
  const logged = await signedIn(browser, baseURL!, maintainer.email), denied = await signedIn(browser, baseURL!, ordinary.email);
  try {
    await search(logged.page, book!.title);
    await logged.page.getByRole('button', { name: '編輯我的內容主題', exact: true }).click();
    const editor = logged.page.locator('.community-content-search h3').filter({ hasText: book!.title }).locator('..');
    await expect(editor).toHaveCount(1);
    await editor.getByRole('checkbox', { name: '工具資源', exact: true }).check();
    const saved = logged.page.waitForResponse(response => response.url().endsWith('/api/v1/community-search/topics') && response.request().method() === 'POST');
    await editor.getByRole('button', { name: '儲存主題', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(logged.page.getByText('主題已儲存。', { exact: true })).toBeVisible();
    expect((await e2eAuthPool.query("SELECT topics,aggregate_version FROM community_content_topic_sets WHERE content_kind='skill_book' AND content_id=$1", [book!.id])).rows[0]).toMatchObject({ topics: ['tools'], aggregate_version: '1' });
    await search(denied.page, book!.title);
    await denied.page.getByRole('button', { name: '編輯我的內容主題', exact: true }).click();
    await expect(denied.page.getByText('目前沒有可編輯主題的內容。', { exact: true })).toBeVisible();
    await expect(denied.page.locator('.community-content-search h3').filter({ hasText: book!.title })).toHaveCount(0);
    await post(denied.page, '/community-search/topics', { kind: 'skill_book', id: book!.id, topics: ['help'] }, 403);
    await e2eAuthPool.query("UPDATE positioning_profession_memberships SET member_tier='intern' WHERE user_id=$1 AND guild_key='guild_ai_vibe'", [maintainer.id]);
    await logged.page.reload();
    await logged.page.getByRole('button', { name: '編輯我的內容主題', exact: true }).click();
    await expect(logged.page.getByText('目前沒有可編輯主題的內容。', { exact: true })).toBeVisible();
    await post(logged.page, '/community-search/topics', { kind: 'skill_book', id: book!.id, topics: ['help'] }, 403);
  } finally {
    await logged.context.close(); await denied.context.close();
    await e2eAuthPool.query("DELETE FROM community_content_topic_sets WHERE content_kind='skill_book' AND content_id=$1", [book!.id]);
    await e2eAuthPool.query('DELETE FROM skill_book_maintainers WHERE book_id=$1 AND user_id=$2', [book!.id, maintainer.id]);
    await e2eAuthPool.query('DELETE FROM skill_editorial_ownership WHERE book_id=$1 AND community_id=$2', [book!.id, DEMO_COMMUNITY]);
  }
});

test('SEARCH-004 a long pinned repository label stays inside a 390px work card', async ({ page, e2eAuthPool }) => {
  const owner = randomUUID(), project = randomUUID(), version = randomUUID(), submission = randomUUID();
  const digest = 'e'.repeat(64);
  const repository = `example/${'communitysearchpinnedsourcelabel'.repeat(3)}`;
  const title = `長來源${randomUUID().slice(0, 8)}`;
  const email = `search-label-card-${owner}@local.test`, name = '搜尋卡片私人會員名稱';
  try {
    await e2eAuthPool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
      SELECT $1,$2,$3,$4,password_hash,$5,false FROM users WHERE user_id=$6`,
    [owner, DEMO_COMMUNITY, email, name, randomUUID(), DEMO_USERS[0].user_id]);
    await e2eAuthPool.query(`INSERT INTO oss_projects(project_id,community_id,owner_ref,title,description,use_notes,repository_id,repository_full_name,repository_url,relationship)
      VALUES($1,$2,$3,$4,'公開摘要','公開用法','88014402',$5,$6,'curator')`,
    [project, DEMO_COMMUNITY, owner, title, repository, `https://github.com/${repository}`]);
    await e2eAuthPool.query(`INSERT INTO oss_project_versions(version_id,project_id,repository_id,commit_sha,default_branch,repository_full_name,repository_url,readme_url,license_spdx,is_fork,archived,source_snapshot,source_sha256,facts_sha256,inspected_at)
      VALUES($1,$2,'88014402',$3,'main',$4,$5,$6,'MIT',false,false,'{}',$7,$7,now())`,
    [version, project, 'f'.repeat(40), repository, `https://github.com/${repository}`, `https://github.com/${repository}#readme`, digest]);
    await e2eAuthPool.query('UPDATE oss_projects SET current_version_id=$2,repository_full_name=$3 WHERE project_id=$1', [project, version, 'example/current-project-name']);
    await e2eAuthPool.query(`INSERT INTO skill_submissions(submission_id,community_id,owner_ref,status,payload,payload_sha256,consent_to_share,project_id,project_version_id,published_at,grant_consumed_at)
      VALUES($1,$2,$3,'published',$4,$5,true,$6,$7,'2026-01-01T12:00:00.123Z',now())`,
    [submission, DEMO_COMMUNITY, owner, JSON.stringify({ title, description: '長來源名稱不應把卡片撐出視窗', relationship: 'curator', share_introductions: [], use_notes: '公開用法' }), digest, project, version]);
    await page.goto(`/#community-search?q=${encodeURIComponent(title)}`);
    const card = results(page).locator('article').filter({ has: page.getByRole('link', { name: title, exact: true }) });
    await expect(card.locator('p.field-hint').first()).toContainText(`${repository} · 發布 2026-01-01 12:00:00.123 UTC`);
    await expect(card.locator('p.field-hint').first()).not.toContainText('example/current-project-name');
    await expect(results(page)).not.toContainText(name);
    await expect(results(page)).not.toContainText(email);
    for (const skin of ['light', 'dark'] as const) {
      await page.evaluate(value => {
        localStorage.setItem('freedom-theme', value);
        document.documentElement.dataset.theme = value;
        document.documentElement.dataset.experienceProfile = value;
        window.dispatchEvent(new Event('freedom-theme-changed'));
      }, skin);
      await page.setViewportSize({ width: 390, height: 900 });
      await expect(card).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
  } finally {
    await e2eAuthPool.query('DELETE FROM skill_submissions WHERE submission_id=$1', [submission]);
    await e2eAuthPool.query('UPDATE oss_projects SET current_version_id=NULL WHERE project_id=$1', [project]);
    await e2eAuthPool.query('DELETE FROM oss_project_versions WHERE project_id=$1', [project]);
    await e2eAuthPool.query('DELETE FROM oss_projects WHERE project_id=$1', [project]);
    await e2eAuthPool.query('DELETE FROM users WHERE user_id=$1', [owner]);
  }
});

test('SEARCH-005 only published showcases enter the topic editor and republishing restores saved topics', async ({ browser, baseURL, e2eAuthPool }) => {
  const member = await person(e2eAuthPool), title = `主題作品${randomUUID().slice(0, 8)}`;
  const logged = await signedIn(browser, baseURL!, member.email);
  const record = z.object({ showcase_id: z.string().uuid(), aggregate_version: z.coerce.number() });
  try {
    const draft = record.parse(await (await post(logged.page, '/me/showcases', { title, description: '合成私人作品' })).json());
    const editor = logged.page.locator('.community-content-search h3').filter({ hasText: title }).locator('..');
    const openEditor = async () => {
      await logged.page.reload();
      await search(logged.page, title);
      await logged.page.getByRole('button', { name: '編輯我的內容主題', exact: true }).click();
    };
    const transition = async (action: 'publish' | 'withdraw', version: number) => {
      const session = z.object({ csrf_token: z.string() }).parse(await (await logged.page.request.get('/api/v1/session')).json());
      const response = await logged.page.request.post(`/api/v1/me/showcases/${draft.showcase_id}/${action}`, {
        data: action === 'publish' ? { consent_to_share: true } : {},
        headers: { Origin: new URL(logged.page.url()).origin, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': randomUUID(), 'If-Match': `"${version}"` },
      });
      expect(response.status(), await response.text()).toBe(200);
      return record.parse(await response.json());
    };
    await openEditor();
    await expect(editor).toHaveCount(0);
    const published = await transition('publish', draft.aggregate_version);
    await openEditor();
    await expect(editor).toBeVisible();
    await editor.getByRole('checkbox', { name: '工具資源', exact: true }).check();
    const saved = logged.page.waitForResponse(response => response.url().endsWith('/api/v1/community-search/topics') && response.request().method() === 'POST');
    await editor.getByRole('button', { name: '儲存主題', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(logged.page.getByText('主題已儲存。', { exact: true })).toBeVisible();
    const withdrawn = await transition('withdraw', published.aggregate_version);
    await openEditor();
    await expect(editor).toHaveCount(0);
    await transition('publish', withdrawn.aggregate_version);
    await openEditor();
    await expect(editor.getByRole('checkbox', { name: '工具資源', exact: true })).toBeChecked();
    expect((await e2eAuthPool.query("SELECT topics,aggregate_version FROM community_content_topic_sets WHERE content_kind='work' AND content_id=$1", [draft.showcase_id])).rows[0]).toMatchObject({ topics: ['tools'], aggregate_version: '1' });
  } finally { await logged.context.close(); }
});

const privateList = (page: Page) => page.getByRole('region', { name: '我的私人書籤與追蹤', exact: true });
async function followedShowcase(browser: Browser, baseURL: string, db: Pool) {
  const member = await person(db), title = `返回追蹤${randomUUID().slice(0, 8)}`;
  const logged = await signedIn(browser, baseURL, member.email);
  try {
    const made = z.object({ showcase_id: z.string().uuid() }).parse(await (await post(logged.page, '/showcases', {
      title, description: '只供目前社群閱讀的合成內容', consent_to_share: true,
    })).json());
    await post(logged.page, '/community-relations/bookmarks', { kind: 'work', id: made.showcase_id, selected: true }, 200);
    await post(logged.page, '/community-relations/follows', { kind: 'author', id: member.id, selected: true }, 200);
    await post(logged.page, '/community-search/topics', { kind: 'work', id: made.showcase_id, topics: ['tools'] }, 200);
    await search(logged.page, title);
    await expect(privateList(logged.page).getByRole('link', { name: title, exact: true })).toBeVisible();
    return { ...logged, member, title, id: made.showcase_id };
  } catch (error) { await logged.context.close(); throw error; }
}

for (const width of [390, 1440]) test(`SEARCH-006 private-list Back/Forward recovery preserves search controls at ${width}px without subscribing`, async ({ browser, baseURL, e2eAuthPool }) => {
  const logged = await followedShowcase(browser, baseURL!, e2eAuthPool), page = logged.page;
  const reads: string[] = [], writes: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/community-relations/updates') reads.push(url.search);
    if (url.pathname.startsWith('/api/v1/community-relations/') && request.method() !== 'GET') writes.push(request.method());
  });
  try {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => history.replaceState({ ...history.state, navigationProbe: 'unchanged' }, ''));
    const historyLength = await page.evaluate(() => history.length);
    const updates = privateList(page).getByRole('button', { name: '追蹤更新', exact: true });
    await updates.focus(); await updates.press('Enter');
    await expect(updates).toHaveAttribute('aria-pressed', 'true');
    await expect(privateList(page).getByRole('link', { name: logged.title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    const conditions = page.getByRole('region', { name: '社群內容搜尋條件', exact: true });
    await conditions.getByRole('checkbox', { name: '作品', exact: true }).check();
    await conditions.getByRole('checkbox', { name: '工具資源', exact: true }).check();
    await expect(results(page).getByRole('link', { name: logged.title, exact: true })).toBeVisible();
    expect(await page.evaluate(() => history.state.navigationProbe)).toBe('unchanged');
    const before = reads.length;
    await privateList(page).getByRole('link', { name: logged.title, exact: true }).click();
    await expect(page.locator(`#showcase-${logged.id}`)).toBeVisible();
    await page.goBack();
    await expect(updates).toHaveAttribute('aria-pressed', 'true');
    await expect(privateList(page).getByRole('link', { name: logged.title, exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: '關鍵字', exact: true })).toHaveValue(logged.title);
    await expect(conditions.getByRole('checkbox', { name: '作品', exact: true })).toBeChecked();
    await expect(conditions.getByRole('checkbox', { name: '工具資源', exact: true })).toBeChecked();
    expect(reads.length).toBe(before + 1);
    await page.goForward(); await expect(page.locator(`#showcase-${logged.id}`)).toBeVisible();
    await page.goBack();
    await expect(updates).toHaveAttribute('aria-pressed', 'true');
    await expect(privateList(page).getByRole('link', { name: logged.title, exact: true })).toBeVisible();
    expect(reads.length).toBe(before + 2);
    await conditions.getByRole('button', { name: '清除搜尋條件', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: '關鍵字', exact: true })).toBeFocused();
    await expect(updates).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => history.state.navigationProbe)).toBe('unchanged');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(writes).toEqual([]);
    const ownState = await page.evaluate(() => history.state.freedomCommunityList);
    expect(Object.keys(ownState).sort()).toEqual(['epoch', 'tab', 'version']);
    expect(JSON.stringify(ownState)).not.toContain(logged.member.id);
    expect(JSON.stringify(ownState)).not.toContain(logged.title);
  } finally { await logged.context.close(); }
});

test('SEARCH-007 reload, another account and the same user signing in again reject old list markers', async ({ browser, baseURL, e2eAuthPool }) => {
  const logged = await followedShowcase(browser, baseURL!, e2eAuthPool), other = await person(e2eAuthPool), page = logged.page;
  try {
    await privateList(page).getByRole('button', { name: '追蹤更新', exact: true }).click();
    await expect(privateList(page).getByRole('link', { name: logged.title, exact: true })).toBeVisible();
    await page.reload();
    await expect(privateList(page).getByRole('button', { name: '私人書籤', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const documentMarker = randomUUID();
    await page.evaluate(value => Object.defineProperty(window, 'searchHistoryDocumentMarker', { value }), documentMarker);
    for (const email of [logged.member.email, other.email]) {
      // Issue a marker in this document immediately before each session change.
      // The first pass is a direct same-user logout/login, not an account switch.
      await privateList(page).getByRole('button', { name: '追蹤更新', exact: true }).click();
      await expect(privateList(page).getByRole('link', { name: logged.title, exact: true })).toBeVisible();
      const old = await page.evaluate(() => history.state);
      // Public search remains available after logout. Do not use the shared
      // signOut helper, which expects the login screen immediately.
      await page.getByRole('button', { name: '設定', exact: true }).click();
      const signedOut = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/logout' && response.request().method() === 'POST');
      await page.getByRole('menu', { name: '個人檔案' }).getByRole('menuitem', { name: '登出', exact: true }).click();
      expect((await signedOut).status()).toBe(200);
      await expect(privateList(page)).toHaveCount(0);
      expect((await page.request.get('/api/v1/session')).status()).toBe(401);
      await expect(page.getByRole('heading', { level: 1, name: '搜尋社群內容', exact: true })).toBeVisible();
      await expect(results(page)).toHaveAttribute('aria-busy', 'false');
      await expect(results(page)).not.toContainText(logged.title);
      await page.getByRole('link', { name: '返回登入', exact: true }).click();
      await expect(page.getByRole('heading', { name: '登入', exact: true })).toBeVisible();
      await page.getByLabel('電子郵件', { exact: true }).fill(email);
      await page.getByLabel('密碼', { exact: true }).fill(DEMO_PASSWORD);
      await page.getByRole('button', { name: '登入', exact: true }).click();
      await expect(page.locator('.shell')).toBeVisible();
      await search(page, logged.title);
      expect(await page.evaluate(() => Reflect.get(window, 'searchHistoryDocumentMarker'))).toBe(documentMarker);
      await page.evaluate(value => {
        history.replaceState(value, ''); window.dispatchEvent(new PopStateEvent('popstate', { state: value }));
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }, old);
      await expect(privateList(page).getByRole('button', { name: '私人書籤', exact: true })).toHaveAttribute('aria-pressed', 'true');
      if (email === other.email) {
        await expect(privateList(page).getByText('尚未儲存書籤。可從搜尋結果儲存。', { exact: true })).toBeVisible();
        await expect(privateList(page)).not.toContainText(logged.title);
      }
    }
  } finally { await logged.context.close(); }
});

test('SEARCH-008 returning to updates rechecks withdrawn content instead of restoring its title or summary', async ({ browser, baseURL, e2eAuthPool }) => {
  const logged = await followedShowcase(browser, baseURL!, e2eAuthPool), page = logged.page;
  try {
    await privateList(page).getByRole('button', { name: '追蹤更新', exact: true }).click();
    await privateList(page).getByRole('link', { name: logged.title, exact: true }).click();
    await expect(page.locator(`#showcase-${logged.id}`)).toBeVisible();
    await e2eAuthPool.query("UPDATE showcases SET status='withdrawn',visibility='private',aggregate_version=aggregate_version+1 WHERE showcase_id=$1", [logged.id]);
    const reread = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/community-relations/updates');
    await page.goBack();
    expect((await reread).status()).toBe(200);
    await expect(privateList(page).getByRole('button', { name: '追蹤更新', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(privateList(page).getByText('目前沒有可閱讀的追蹤更新。可先選擇作者或主題。', { exact: true })).toBeVisible();
    await expect(privateList(page)).not.toContainText(logged.title);
    await expect(privateList(page)).not.toContainText('只供目前社群閱讀的合成內容');
    expect(JSON.stringify(await (await reread).json())).not.toContain(logged.title);
  } finally { await logged.context.close(); }
});

test('SEARCH-009 delayed updates cannot replace a newer list, and failed revalidation remains retryable', async ({ browser, baseURL, e2eAuthPool }) => {
  const logged = await followedShowcase(browser, baseURL!, e2eAuthPool), page = logged.page;
  let release!: () => void, started!: () => void, finished!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const done = new Promise<void>(resolve => { finished = resolve; });
  let first = true, fail = false;
  await page.route(url => url.pathname === '/api/v1/community-relations/updates', async route => {
    if (first) {
      first = false;
      const response = await route.fetch(); started(); await held;
      try { await route.fulfill({ response }); }
      catch (error) { if (!route.request().failure()) throw error; }
      finally { finished(); }
    } else if (fail) await route.fulfill({ status: 503, json: { code: 'unavailable', detail: '合成暫時失敗' } });
    else await route.continue();
  });
  try {
    await privateList(page).getByRole('button', { name: '追蹤更新', exact: true }).click(); await waiting;
    await privateList(page).getByRole('button', { name: '追蹤清單', exact: true }).click();
    release(); await done;
    await expect(privateList(page).getByRole('button', { name: '追蹤清單', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(privateList(page)).not.toContainText(logged.title);
    fail = true;
    await privateList(page).getByRole('button', { name: '追蹤更新', exact: true }).click();
    await expect(privateList(page).getByRole('alert')).toBeVisible();
    await expect(privateList(page).getByText('目前沒有可閱讀的追蹤更新。可先選擇作者或主題。', { exact: true })).toHaveCount(0);
    await expect(privateList(page)).not.toContainText(logged.title);
    fail = false;
    await privateList(page).getByRole('button', { name: '重試追蹤更新', exact: true }).click();
    await expect(privateList(page).getByRole('link', { name: logged.title, exact: true })).toBeVisible();
  } finally { release(); await logged.context.close(); }
});

test('SEARCH-010 list selection belongs to its own search history entry without duplicate navigation reads', async ({ browser, baseURL, e2eAuthPool }) => {
  const logged = await followedShowcase(browser, baseURL!, e2eAuthPool), page = logged.page;
  const reads: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/community-relations/updates') reads.push(request.url()); });
  // Synthetic search pagination isolates history behavior; private lists still
  // use the actual authenticated HTTP app, as do the neighboring ACL cases.
  await page.route(url => url.pathname === '/api/v1/community-search', route => {
    const second = new URL(route.request().url()).searchParams.has('cursor');
    return route.fulfill({ json: { items: [{ kind: 'skill_book', id: 'history-book', title: second ? '合成第二頁' : '合成第一頁',
      summary: '搜尋分頁', path: '#skills', label: null, author_id: null, media_path: null, topics: [] }], next_cursor: second ? null : 'synthetic-next' } });
  });
  try {
    await privateList(page).getByRole('button', { name: '追蹤清單', exact: true }).click();
    await page.getByRole('searchbox', { name: '關鍵字', exact: true }).fill('history');
    await expect(results(page).getByRole('link', { name: '合成第一頁', exact: true })).toBeVisible();
    await results(page).getByRole('button', { name: '下一頁', exact: true }).click();
    await expect(results(page).getByRole('link', { name: '合成第二頁', exact: true })).toBeVisible();
    await expect(results(page)).toBeFocused();
    await privateList(page).getByRole('button', { name: '追蹤更新', exact: true }).click();
    await expect(privateList(page).getByRole('link', { name: logged.title, exact: true })).toBeVisible();
    await page.goBack();
    await expect(results(page).getByRole('link', { name: '合成第一頁', exact: true })).toBeVisible();
    await expect(privateList(page).getByRole('button', { name: '追蹤清單', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goForward();
    await expect(results(page).getByRole('link', { name: '合成第二頁', exact: true })).toBeVisible();
    await expect(privateList(page).getByRole('button', { name: '追蹤更新', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(privateList(page).getByRole('link', { name: logged.title, exact: true })).toBeVisible();
    const before = reads.length;
    await page.evaluate(async () => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(reads.length).toBe(before);
    await expect(page.getByRole('searchbox', { name: '關鍵字', exact: true })).toHaveValue('history');
  } finally { await logged.context.close(); }
});
