import { randomUUID } from 'node:crypto';
import { test as base, expect, type BrowserContext, type Page } from './fixtures.js';
import { DEMO_COMMUNITY, DEMO_PASSWORD, DEMO_USERS } from '../../packages/testing/seed.js';
import { e2eOrigin } from '../../packages/testing/e2e-origin.js';
import { navigate, signOut } from './navigation.js';

type MemberFixture = {
  id: string;
  email: string;
  name: string;
  context: BrowserContext;
  page: Page;
};

const test = base.extend<{ creator: MemberFixture }>({
  creator: async ({ browser, e2eAuthPool }, use) => {
    const id = randomUUID();
    const email = `work-public-${id}@example.test`;
    const name = `公開作品測試者 ${id.slice(0, 6)}`;
    await e2eAuthPool.query(
      `INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
       SELECT $1,$2,$3,$4,password_hash,$5,false FROM users WHERE user_id=$6`,
      [id, DEMO_COMMUNITY, email, name, randomUUID(), DEMO_USERS[0].user_id],
    );
    const context = await browser.newContext({ baseURL: e2eOrigin() });
    const page = await context.newPage();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: e2eOrigin() });
    try {
      await use({ id, email, name, context, page });
    } finally {
      await context.close();
      await e2eAuthPool.query(`UPDATE showcases SET status='withdrawn', visibility='private', aggregate_version=aggregate_version+1 WHERE owner_ref=$1`, [id]);
      await e2eAuthPool.query('UPDATE users SET active=false WHERE user_id=$1', [id]);
    }
  },
});

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill(email);
  await page.getByLabel('密碼', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.getByRole('heading', { name: '動態', exact: true })).toBeVisible();
}

async function assertUnavailable(page: Page, showcaseId: string, secretText: string) {
  const response = await page.goto(`${e2eOrigin()}/works/${showcaseId}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: '找不到公開作品' })).toBeVisible();
  expect(await page.content()).not.toContain(secretText);
  const api = await page.request.get(`${e2eOrigin()}/api/v1/public/works/${showcaseId}`);
  expect(api.status()).toBe(404);
}

test('PUBLIC-WORK-01 owner opt-in, mobile responsiveness, tracked /go credit, edit invalidation, and toggle off', async ({
  creator,
  browser,
}) => {
  await creator.page.setViewportSize({ width: 390, height: 844 });
  await signIn(creator.page, creator.email);
  await navigate(creator.page, '作品與合作');

  const title = `公開瀏覽作品 ${randomUUID().slice(0, 6)}`;
  const summary = '只有本人明確開啟「開放公開閱讀」的當前版本才會出現在 /works/:id。';
  await creator.page.getByLabel('作品標題', { exact: true }).fill(title);
  await creator.page.getByLabel('一句話介紹', { exact: true }).fill(summary);
  await creator.page.getByLabel('作品連結（選填）', { exact: true }).fill('https://example.com/p2-work');
  await creator.page.getByLabel('我同意以社群可見方式分享這件作品').check();
  await creator.page.getByRole('button', { name: '發布作品', exact: true }).click();
  await expect(creator.page.getByRole('region', { name: '作品發布成功' })).toBeFocused();
  await creator.page.getByRole('button', { name: '查看剛分享的作品' }).click();

  const card = creator.page.getByRole('article').filter({ has: creator.page.getByRole('heading', { name: title, exact: true }) });
  await expect(card).toBeVisible();
  const cardId = await card.getAttribute('id');
  expect(cardId).toMatch(/^showcase-/);
  const showcaseId = cardId!.replace(/^showcase-/, '');

  const toggle = card.getByRole('switch', { name: /開放公開閱讀/ });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  expect(await creator.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  // Anonymous visitor gets 404 before owner opts in.
  const visitorCtx = await browser.newContext({ baseURL: e2eOrigin(), javaScriptEnabled: false });
  const visitorPage = await visitorCtx.newPage();
  await visitorPage.setViewportSize({ width: 390, height: 844 });
  try {
    await assertUnavailable(visitorPage, showcaseId, title);

    // Owner enables public reading and shares a tracked /go link.
    await toggle.click();
    await expect(toggle).toBeChecked();
    const publicLink = card.locator(`a[href="/works/${showcaseId}"]`);
    await expect(publicLink).toBeVisible();
    await card.getByRole('button', { name: '分享', exact: true }).click();
    const shareDialog = creator.page.locator('.skill-share-dialog');
    await expect(shareDialog).toBeVisible();
    const urlText = shareDialog.locator('.skill-share-url');
    await expect(urlText).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
    const trackedHref = (await urlText.innerText()).trim();
    expect(trackedHref).toMatch(/\/go\/[A-Za-z0-9_-]{10}$/);
    await shareDialog.getByRole('button', { name: '關閉分享', exact: true }).click();
    await expect(shareDialog).toHaveCount(0);
    const code = trackedHref!.split('/').pop()!;
    expect(await creator.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Anonymous no-JS visitor opens /go/:code -> /works/:id?via=:code and sees the work + sharer attribution cleanly on mobile.
    const goResp = await visitorPage.goto(trackedHref!);
    expect(goResp?.status()).toBe(200);
    await expect(visitorPage.locator(`a[href*="/works/${showcaseId}?via=${code}"]`)).toBeVisible();

    const pubResp = await visitorPage.goto(`${e2eOrigin()}/works/${showcaseId}?via=${code}`);
    expect(pubResp?.status()).toBe(200);
    await expect(visitorPage.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(visitorPage.getByText(summary)).toBeVisible();
    await expect(visitorPage.getByText(creator.name, { exact: true })).toBeVisible();
    await expect(visitorPage.getByText(`由 ${creator.name} 推薦分享`)).toBeVisible();
    await expect(visitorPage.locator('a[href="https://example.com/p2-work"]')).toBeVisible();
    expect(await visitorPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Non-owner logged-in member does not see the owner toggle on someone else's work.
    await signOut(creator.page);
    await signIn(creator.page, DEMO_USERS[1].email);
    await navigate(creator.page, '作品與合作');
    const otherCard = creator.page.getByRole('article').filter({ has: creator.page.getByRole('heading', { name: title, exact: true }) });
    await expect(otherCard).toBeVisible();
    await expect(otherCard.getByRole('switch', { name: /開放公開閱讀/ })).toHaveCount(0);

    // Owner signs back in, edits & re-publishes via My Content -> old opt-in stays revoked until re-confirmed.
    await signOut(creator.page);
    await signIn(creator.page, creator.email);
    await navigate(creator.page, '我的內容');
    const myCard = creator.page.getByRole('article').filter({ has: creator.page.getByRole('heading', { name: title, exact: true }) });
    await myCard.locator('.personal-space-more > summary').click();await myCard.getByRole('link', { name: '撤下', exact: true }).click();
    const editorToggle = creator.page.getByRole('switch', { name: /開放公開閱讀/ });
    await expect(editorToggle).toBeChecked();

    await creator.page.getByRole('button', { name: '撤下作品', exact: true }).click();
    await expect(creator.page.getByRole('button', { name: '儲存私人草稿', exact: true })).toBeVisible();
    await assertUnavailable(visitorPage, showcaseId, title);
    expect((await visitorPage.goto(trackedHref!))?.status()).toBe(404);

    const updatedTitle = `${title} v2`;
    await creator.page.getByLabel('作品標題', { exact: true }).fill(updatedTitle);
    await creator.page.getByRole('button', { name: '儲存私人草稿', exact: true }).click();
    await expect(creator.page.getByRole('button', { name: '確認發布範圍', exact: true })).toBeEnabled();
    await creator.page.getByRole('button', { name: '確認發布範圍', exact: true }).click();
    await creator.page.getByLabel('我同意將已儲存版本分享給本社群會員').check();
    await creator.page.getByRole('button', { name: '確認發布', exact: true }).click();

    // Re-publishing alone MUST keep the public page 404 until the owner flips the toggle on again.
    await assertUnavailable(visitorPage, showcaseId, updatedTitle);
    await expect(editorToggle).not.toBeChecked();
    await expect(creator.page.getByText('作品更新後已自動關閉公開閱讀，請重新確認開啟。')).toBeVisible();

    await editorToggle.click();
    await expect(editorToggle).toBeChecked();
    const v2Resp = await visitorPage.goto(`${e2eOrigin()}/works/${showcaseId}`);
    expect(v2Resp?.status()).toBe(200);
    await expect(visitorPage.getByRole('heading', { name: updatedTitle, exact: true })).toBeVisible();

    // Toggling off hides it immediately.
    await editorToggle.click();
    await expect(editorToggle).not.toBeChecked();
    await assertUnavailable(visitorPage, showcaseId, updatedTitle);
  } finally {
    await visitorCtx.close();
  }
});

for (const screen of ['card', 'editor'] as const) {
  test(`PUBLIC-WORK-02 stale ${screen} reloads all content before renewed consent`, async ({ creator }) => {
    const page = creator.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, creator.email);
    const csrf = (await (await page.request.get('/api/v1/session')).json()).csrf_token;
    const headers = { Origin: e2eOrigin(), 'X-CSRF-Token': csrf };
    const command = async (path: string, data: object, version?: string | number, method = 'POST') => {
      const response = await page.request.fetch(`/api/v1/${path}`, { method, data, headers: {
        ...headers, 'Idempotency-Key': randomUUID(), ...(version ? { 'If-Match': `"${version}"` } : {}),
      } });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    const title = `版本核對 ${randomUUID().slice(0, 6)}`;
    const first = await command('showcases', { title, description: '第一版摘要', public_url: 'https://example.com/version-one', consent_to_share: true });
    if (screen === 'card') await navigate(page, '作品與合作');
    else {
      await navigate(page, '我的內容');
      const own=page.getByRole('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });await own.locator('.personal-space-more > summary').click();await own.getByRole('link', { name: '撤下', exact: true }).click();
    }
    const scope = screen === 'card'
      ? page.locator(`#showcase-${first.showcase_id}`)
      : page.getByRole('region', { name: '私人作品編輯' });
    const toggle = scope.getByRole('switch', { name: /開放公開閱讀/ });
    await expect(toggle).toBeEnabled();

    // A second tab changes the authoritative work while this screen still shows v1.
    const otherTab = await page.context().newPage();
    await otherTab.goto('/');
    const revised = await otherTab.evaluate(async ({ id, csrf, version }) => {
      async function send(suffix: string, method: string, data: object, expected: string | number) {
        const response = await fetch(`/api/v1/me/showcases/${id}${suffix}`, { method, headers: {
          'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': crypto.randomUUID(), 'If-Match': `"${expected}"`,
        }, body: JSON.stringify(data) });
        if (!response.ok) throw Error(`fixture mutation failed: ${response.status}`);
        return response.json();
      }
      const withdrawn = await send('/withdraw', 'POST', {}, version);
      const edited = await send('', 'PATCH', { title: '新版公開作品', description: '新版完整摘要', public_url: 'https://example.com/version-two' }, withdrawn.aggregate_version);
      return send('/publish', 'POST', { consent_to_share: true }, edited.aggregate_version);
    }, { id: first.showcase_id, csrf, version: first.aggregate_version });
    await otherTab.close();

    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const reloadPath = screen === 'card' ? '**/api/v1/showcases?*' : `**/api/v1/me/showcases/${first.showcase_id}`;
    await page.route(reloadPath, async route => { await held; await route.continue(); });
    const attempts: string[] = [];
    page.on('request', request => {
      if (request.method() === 'PUT' && request.url().endsWith(`/showcases/${first.showcase_id}/sharing`)) attempts.push(String(request.postDataJSON().work_version));
    });
    try {
      const conflict = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/sharing'));
      await toggle.click();
      expect((await conflict).status()).toBe(412);
      if (screen === 'card') {
        await expect(scope.getByText('作品已更新，請重新檢視後再開放')).toBeVisible();
        await expect(toggle).toBeDisabled();
        await expect(scope.getByRole('heading', { name: title, exact: true })).toBeVisible();
      } else {
        // The editor hides its old form throughout the full-content reload.
        await expect(scope.getByText('載入作品…')).toBeVisible();
        await expect(toggle).toHaveCount(0);
      }
      expect(attempts).toEqual([String(first.aggregate_version)]);
      release();
      if (screen === 'card') {
        await expect(scope.getByRole('heading', { name: revised.title, exact: true })).toBeVisible();
        await expect(scope.getByText(revised.description, { exact: true })).toBeVisible();
        await expect(scope.locator('a[href="https://example.com/version-two"]')).toBeVisible();
      } else {
        await expect(scope.getByLabel('作品標題', { exact: true })).toHaveValue(revised.title);
        await expect(scope.getByRole('textbox', { name: '一句話介紹', exact: true })).toHaveValue(revised.description);
        await expect(scope.getByLabel('作品外部連結（選填）')).toHaveValue(revised.public_url);
      }
      await expect(toggle).toBeEnabled();
      await expect(toggle).not.toBeChecked();
      await toggle.click();
      await expect(toggle).toBeChecked();
      expect(attempts).toEqual([String(first.aggregate_version), String(revised.aggregate_version)]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      release();
      await page.unroute(reloadPath);
    }
  });
}

test('PUBLIC-WORK-03 /works/:id visitor sign-in returns to page and member creates share link via one link API', async ({ browser, creator, e2eAuthPool }) => {
  await signIn(creator.page, creator.email);
  const sess = await (await creator.page.request.get(`${e2eOrigin()}/api/v1/session`)).json() as { csrf_token: string };
  const apiHeaders = { Origin: e2eOrigin(), 'Content-Type': 'application/json', 'X-CSRF-Token': sess.csrf_token };
  const title = `公開頁分享入口 ${randomUUID().slice(0, 6)}`;
  const created = await (await creator.page.request.post(`${e2eOrigin()}/api/v1/showcases`, {
    headers: { ...apiHeaders, 'Idempotency-Key': randomUUID() },
    data: { title, description: '公開作品頁直接提供分享連結入口。', consent_to_share: true },
  })).json() as { showcase_id: string };
  const sharing0 = await (await creator.page.request.get(`${e2eOrigin()}/api/v1/me/showcases/${created.showcase_id}/sharing`)).json() as { version: string; work_version: string };
  const pubRes = await creator.page.request.put(`${e2eOrigin()}/api/v1/me/showcases/${created.showcase_id}/sharing`, {
    headers: { ...apiHeaders, 'Idempotency-Key': randomUUID(), 'If-Match': `"${sharing0.version}"` },
    data: { enabled: true, work_version: sharing0.work_version },
  });
  expect(pubRes.status()).toBe(200);

  const visitorCtx = await browser.newContext({ baseURL: e2eOrigin() });
  const visitor = await visitorCtx.newPage();
  const guestCtx = await browser.newContext({ baseURL: e2eOrigin() });
  const guest = await guestCtx.newPage();
  try {
    await visitor.goto(`/works/${created.showcase_id}`);
    const loginLink = visitor.getByRole('link', { name: '登入取得分享連結', exact: true });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', `/?return_to=${encodeURIComponent(`/works/${created.showcase_id}`)}`);
    await expect(visitor.locator('#work-share')).toBeHidden();

    await loginLink.click();
    await visitor.getByLabel('電子郵件', { exact: true }).fill(DEMO_USERS[1].email);
    await visitor.getByLabel('密碼', { exact: true }).fill(DEMO_PASSWORD);
    await visitor.getByRole('button', { name: '登入', exact: true }).click();
    await visitor.waitForURL(new RegExp(`/works/${created.showcase_id}$`));

    const shareBtn = visitor.getByRole('button', { name: '我也要分享', exact: true });
    await expect(shareBtn).toBeVisible();
    await expect(loginLink).toBeHidden();
    await visitor.setViewportSize({ width: 390, height: 844 });
    await shareBtn.click();
    const shareInput = visitor.getByLabel('我的分享連結', { exact: true });
    await expect(shareInput).toHaveValue(/\/go\/[A-Za-z0-9_-]{10}$/);
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const shareUrl = await shareInput.inputValue();
    const code = shareUrl.split('/').pop()!;

    await guest.goto(shareUrl);
    await guest.waitForURL(new RegExp(`/works/${created.showcase_id}\\?via=${code}$`));
    await expect(guest.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(guest.getByText(`由 ${DEMO_USERS[1].display_name} 推薦分享`)).toBeVisible();

    // When the work already has a share, clicking #work-share calls POST /api/v1/shares/:id/links directly without POST /api/v1/shares.
    let shareCreateCalls = 0;
    let linkCreateCalls = 0;
    creator.page.on('request', req => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/v1/shares') shareCreateCalls += 1;
      if (req.method() === 'POST' && /^\/api\/v1\/shares\/[^/]+\/links$/.test(new URL(req.url()).pathname)) linkCreateCalls += 1;
    });
    await creator.page.goto(`/works/${created.showcase_id}`);
    const ownerShareBtn = creator.page.getByRole('button', { name: '我也要分享', exact: true });
    await expect(ownerShareBtn).toBeVisible();
    await ownerShareBtn.click();
    await expect(creator.page.getByLabel('我的分享連結', { exact: true })).toHaveValue(/\/go\/[A-Za-z0-9_-]{10}$/);
    expect(shareCreateCalls).toBe(0);
    expect(linkCreateCalls).toBe(1);
  } finally {
    await visitorCtx.close();
    await guestCtx.close();
    await e2eAuthPool.query(`DELETE FROM promotion_clicks WHERE link_id IN (SELECT link_id FROM promotion_links WHERE kind='share' AND target_key IN (SELECT share_id::text FROM shares WHERE kind='work' AND ref_id=$1))`, [created.showcase_id]);
    await e2eAuthPool.query(`DELETE FROM promotion_links WHERE kind='share' AND target_key IN (SELECT share_id::text FROM shares WHERE kind='work' AND ref_id=$1)`, [created.showcase_id]);
    await e2eAuthPool.query(`UPDATE shares SET state='retracted' WHERE kind='work' AND ref_id=$1`, [created.showcase_id]);
  }
});
