import { randomUUID } from 'node:crypto';
import { test as base, expect, type BrowserContext, type Locator, type Page } from './fixtures.js';
import { navigate, expandHomeSections } from './navigation.js';
import { DEMO_COMMUNITY, DEMO_PASSWORD, DEMO_USERS } from '../../packages/testing/seed.js';
import { e2eOrigin } from '../../packages/testing/e2e-origin.js';

const GUEST_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const PHONE = { width: 390, height: 844 };

type MemberFixture = {
  id: string;
  email: string;
  context: BrowserContext;
  page: Page;
};

const test = base.extend<{ member: MemberFixture }>({
  member: async ({ browser, e2eAuthPool }, use) => {
    const id = randomUUID();
    const email = `share-dialog-${id}@example.test`;
    await e2eAuthPool.query(
      `INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
       SELECT $1,$2,$3,'統一分享測試員',password_hash,$4,false FROM users WHERE user_id=$5`,
      [id, DEMO_COMMUNITY, email, randomUUID(), DEMO_USERS[0].user_id],
    );
    const context = await browser.newContext({ baseURL: e2eOrigin(), viewport: PHONE });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: e2eOrigin() }).catch(() => {});
    const page = await context.newPage();
    try {
      await use({ id, email, context, page });
    } finally {
      await context.close();
      await e2eAuthPool.query(`UPDATE showcases SET status='withdrawn', visibility='private', aggregate_version=aggregate_version+1 WHERE owner_ref=$1`, [id]);
      await e2eAuthPool.query(`DELETE FROM community_social_posts WHERE author_user_id=$1`, [id]);
      await e2eAuthPool.query(`DELETE FROM member_services WHERE owner_user_id=$1`, [id]);
      await e2eAuthPool.query(`DELETE FROM promotion_clicks WHERE link_id IN (SELECT link_id FROM promotion_links WHERE user_id=$1)`, [id]);
      await e2eAuthPool.query(`DELETE FROM promotion_links WHERE user_id=$1`, [id]);
      await e2eAuthPool.query(`UPDATE users SET active=false WHERE user_id=$1`, [id]);
    }
  },
});

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('電子郵件', { exact: true }).fill(email);
  await page.getByLabel('密碼', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page.locator('.shell')).toBeVisible({ timeout: 20_000 });
}

async function assertShareDialogWithQr(page: Page, expectedTitle?: string, target?: Locator) {
  const dialog = target ?? (expectedTitle
    ? page.getByRole('dialog', { name: `分享「${expectedTitle}」`, exact: true })
    : page.locator('.skill-share-dialog'));
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
  await expect(dialog.locator('.share-credit-note')).toHaveText('有人點開，會記在你名下。');
  const url = (await dialog.locator('.skill-share-url').innerText()).trim();
  const qrBtn = dialog.getByRole('button', { name: 'QR 碼', exact: true });
  await qrBtn.click();
  await expect(qrBtn).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('img', { name: '分享連結的 QR Code', exact: true })).toBeVisible();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  return { dialog, url };
}

test('share dialog works across all 6 targets, skill intros, note public toggle and QR at 390x844', async ({
  member,
  browser,
  e2eAuthPool,
}) => {
  test.setTimeout(120_000);
  const { page, id } = member;
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());

  const eventId = randomUUID();
  const eventTitle = `統一分享活動 ${id.slice(0, 6)}`;
  await e2eAuthPool.query(
    `INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
     VALUES($1,$2,$3,$4,'統一分享視窗測試活動',now()-interval '1 day',now()+interval '2 days','online','線上','published','open','other')`,
    [eventId, DEMO_COMMUNITY, id, eventTitle],
  );

  try {
    await signIn(page, member.email);

    // 1. Repository share page (#shares/:id) — publish from #explore since publishing from #home stays on #home
    await page.goto('/#explore');
    await expect(page).toHaveURL(/#explore$/);
    await expect(page.locator('.shell')).toBeVisible();
    await page.getByRole('button', { name: '分享或提交', exact: true }).click();
    const createBox = page.getByRole('dialog', { name: '分享', exact: true });
    await createBox.getByLabel('貼上連結', { exact: true }).fill('https://github.com/freetwai-test/shared-repo');
    await expect(createBox.getByText('freetwai-test/shared-repo', { exact: true })).toBeVisible();
    await createBox.getByRole('button', { name: '發布', exact: true }).click();
    await expect(page).toHaveURL(/#shares\/[0-9a-f-]+$/);
    const repoBtn = page.getByRole('button', { name: '我也要分享', exact: true });
    expect((await repoBtn.boundingBox())!.width).toBeLessThan(PHONE.width * 0.5);
    await repoBtn.click();
    const repoShare = await assertShareDialogWithQr(page);
    await repoShare.dialog.getByRole('button', { name: '關閉分享', exact: true }).click();

    // 2. Event card (leave #shares/:id via home link first so workspace subnav resets)
    await page.getByRole('link', { name: '自由工坊 · 會員首頁', exact: true }).click();
    await navigate(page, '社群活動');
    const eventCard = page.locator('article.experience-card').filter({ has: page.getByRole('heading', { name: eventTitle, level: 3 }) });
    await eventCard.scrollIntoViewIfNeeded();
    const eventBtn = eventCard.getByRole('button', { name: '分享活動', exact: true });
    expect((await eventBtn.boundingBox())!.width).toBeLessThan(PHONE.width * 0.6);
    await eventBtn.click();
    const eventShare = await assertShareDialogWithQr(page, eventTitle);
    await eventShare.dialog.getByRole('button', { name: '關閉分享', exact: true }).click();

    // 3. Member service
    await navigate(page, '社員服務');
    const serviceTitle = `統一分享服務 ${id.slice(0, 6)}`;
    await page.getByRole('button', { name: '新增服務', exact: true }).click();
    const serviceForm = page.locator('form.service-form');
    await serviceForm.getByLabel('標題', { exact: true }).fill(serviceTitle);
    await serviceForm.locator('select').selectOption({ label: '美髮造型・假髮' });
    await serviceForm.getByLabel('簡介', { exact: true }).fill('統一分享對話測試簡介');
    await serviceForm.getByLabel('說明', { exact: true }).fill('線上討論');
    await serviceForm.getByLabel('價格', { exact: true }).fill('NT$500');
    await serviceForm.getByLabel('地區', { exact: true }).fill('線上');
    await serviceForm.getByLabel('聯絡名稱', { exact: true }).fill('官方頁面');
    await serviceForm.getByLabel('https 連結', { exact: true }).fill('https://example.com/service');
    await serviceForm.getByRole('button', { name: '建立服務', exact: true }).click();
    await expect(page.getByText('已新增服務。')).toBeVisible();
    const serviceCard = page.locator('article.service-card').filter({ has: page.getByRole('heading', { name: serviceTitle, exact: true }) });
    const serviceBtn = serviceCard.getByRole('button', { name: '分享', exact: true });
    expect((await serviceBtn.boundingBox())!.width).toBeLessThan(PHONE.width * 0.5);
    await serviceBtn.click();
    const serviceShare = await assertShareDialogWithQr(page, serviceTitle);
    await serviceShare.dialog.getByRole('button', { name: '關閉分享', exact: true }).click();

    // 4. Skill book + picking introduction (?intro=)
    await page.route('**/api/v1/skills/social-post/share-content', route =>
      route.fulfill({ json: { introductions: ['精選推薦一：先寫下想法再分享。', '精選推薦二：整理好再送出。'], illustration_url: '', illustration_alt: '' } }),
    );
    await navigate(page, '技能書架');
    await page.getByRole('button', { name: '未解鎖', exact: true }).click();
    const library = page.locator('.community-library');
    await library.getByLabel('搜尋技能書', { exact: true }).fill('社群貼文');
    const skillCard = library.locator('article[data-book-id="social-post"]');
    const skillBtn = skillCard.getByRole('button', { name: '分享技能', exact: true });
    expect((await skillBtn.boundingBox())!.width).toBeLessThan(PHONE.width * 0.5);
    await skillBtn.click();
    const skillShare = await assertShareDialogWithQr(page, 'Hao 社群貼文技能書');
    await skillShare.dialog.locator('.share-intros > summary').click();
    await skillShare.dialog.getByRole('radio').first().check();
    await expect(skillShare.dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}\?intro=1$/);
    await skillShare.dialog.getByRole('button', { name: '關閉分享', exact: true }).click();

    // 5. Platform share (MemberHome)
    await navigate(page, '會員首頁');
    await expandHomeSections(page);
    const homeBtn = page.getByRole('button', { name: '分享自由工坊', exact: true });
    expect((await homeBtn.boundingBox())!.width).toBeLessThan(PHONE.width * 0.5);
    await homeBtn.click();
    const homeShare = await assertShareDialogWithQr(page, '自由工坊');
    await homeShare.dialog.getByRole('button', { name: '關閉分享', exact: true }).click();

    // 6. Owner's public work
    await navigate(page, '作品與合作');
    const workTitle = `統一分享作品 ${id.slice(0, 6)}`;
    await page.getByLabel('作品標題', { exact: true }).fill(workTitle);
    await page.getByLabel('一句話介紹', { exact: true }).fill('用於驗證公開作品分享對話。');
    await page.getByLabel('作品連結（選填）', { exact: true }).fill('https://example.com/work');
    await page.getByLabel('我同意以社群可見方式分享這件作品').check();
    await page.getByRole('button', { name: '發布作品', exact: true }).click();
    await expect(page.getByRole('region', { name: '作品發布成功' })).toBeFocused();
    await page.getByRole('button', { name: '查看剛分享的作品' }).click();
    const workCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: workTitle, exact: true }) });
    const showcaseId = (await workCard.getAttribute('id'))!.replace(/^showcase-/, '');
    const workToggle = workCard.getByRole('switch', { name: /開放公開閱讀/ });
    await workToggle.click();
    await expect(workToggle).toBeChecked();
    const workShareBtn = workCard.getByRole('button', { name: '分享', exact: true });
    await expect(workShareBtn).toBeVisible();
    expect((await workShareBtn.boundingBox())!.width).toBeLessThan(PHONE.width * 0.5);
    await workShareBtn.click();
    const workShare = await assertShareDialogWithQr(page, workTitle);
    await workShare.dialog.getByRole('button', { name: '關閉分享', exact: true }).click();
    const guestCtx = await browser.newContext({ baseURL: e2eOrigin(), userAgent: GUEST_UA, viewport: PHONE });
    try {
      const guest = await guestCtx.newPage();
      await guest.goto(workShare.url);
      await expect(guest).toHaveURL(new RegExp(`/works/${showcaseId}\\?via=`));
    } finally {
      await guestCtx.close();
    }

    // 7. Note post: member-only gives untracked in-site link; public page gives tracked /go/:code opening /posts/:id
    await navigate(page, '社群分享');
    const noteText = `統一分享筆記貼文 ${id.slice(0, 6)}`;
    await page.locator('.social-composer-start').getByRole('button', { name: '建立貼文', exact: true }).click();
    const composer = page.getByRole('dialog', { name: '建立貼文', exact: true });
    await composer.getByLabel('貼文內容', { exact: true }).fill(noteText);
    await composer.getByRole('button', { name: '發布貼文', exact: true }).click();
    const postCard = page.locator('.social-card').filter({ has: page.locator('.social-note').filter({ hasText: noteText }) });
    await expect(postCard).toBeVisible();
    const postId = (await postCard.getAttribute('id'))!.slice('social-post-'.length);
    const postShareBtn = postCard.getByRole('button', { name: '分享貼文連結', exact: true });
    await postShareBtn.click();
    const postShareDialog = page.getByRole('dialog', { name: '分享貼文連結', exact: true });
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await expect(postShareDialog.locator('.skill-share-url')).toHaveText(new RegExp(`/\\?social-post=${postId}#social$`));
    await expect(postShareDialog.locator('.share-credit-note')).toHaveText('這是一般連結，不會記在你名下。');

    await postShareDialog.locator('.social-sharing-consent > summary').click();
    await postShareDialog.getByRole('button', { name: '開放免登入閱讀', exact: true }).click();
    await expect(postShareDialog.getByRole('status')).toHaveText('已開放免登入閱讀，可以分享連結了。');
    const publicNoteShare = await assertShareDialogWithQr(page, undefined, postShareDialog);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('.social-share-dialog')).toHaveCount(0);
    await expect(postShareBtn).toBeFocused();
    await postShareBtn.click();
    await expect(postShareDialog.locator('.skill-share-url')).toHaveText(publicNoteShare.url);
    await postShareDialog.getByRole('button', { name: '關閉分享', exact: true }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('.social-share-dialog')).toHaveCount(0);
    await expect(postShareBtn).toBeFocused();

    const postGuestCtx = await browser.newContext({ baseURL: e2eOrigin(), userAgent: GUEST_UA, viewport: PHONE });
    try {
      const postGuest = await postGuestCtx.newPage();
      await postGuest.goto(publicNoteShare.url);
      await expect(postGuest).toHaveURL(new RegExp(`/posts/${postId}$`));
    } finally {
      await postGuestCtx.close();
    }
  } finally {
    await e2eAuthPool.query(`DELETE FROM community_events WHERE event_id=$1`, [eventId]);
  }
});

test('capability fallbacks, anonymous share, my-credit results and public event-page actions at 390x844', async ({
  member,
  browser,
  e2eAuthPool,
}) => {
  test.setTimeout(120_000);
  const { page, id } = member;

  // Seed one share + link + click + star_confirmed credit, plus one public event + registration + share code
  const repoId = randomUUID();
  const shareId = randomUUID();
  const repoFull = `freetwai-test/credit-${id.slice(0, 6)}`;
  const shareCode = `s${id.replace(/-/g, '').slice(0, 9)}`;
  const shareLinkId = randomUUID();
  const eventId = randomUUID();
  const eventShareId = randomUUID();
  const eventTitle = `貢獻活動 ${id.slice(0, 6)}`;
  const eventCode = `e${id.replace(/-/g, '').slice(0, 9)}`;
  const eventRefCode = randomUUID().replace(/-/g, '');
  const eventLinkId = randomUUID();

  try {
    await e2eAuthPool.query(
      `INSERT INTO canonical_repositories(repo_id,provider,provider_repo_id,full_name,current_url)
       VALUES($1,'github',$2,$3,$4)`,
      [repoId, `${parseInt(id.slice(0, 8), 16)}`, repoFull, `https://github.com/${repoFull}`],
    );
    await e2eAuthPool.query(
      `INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,repo_id,title,first_sharer_user_id,state)
       VALUES($1,$2,'repository',$3,$4,$5,$6,$7,'published')`,
      [shareId, DEMO_COMMUNITY, `github:${repoFull}`, `https://github.com/${repoFull}`, repoId, repoFull, id],
    );
    await e2eAuthPool.query(
      `INSERT INTO promotion_links(link_id,community_id,user_id,kind,target_key,code) VALUES($1,$2,$3,'share',$4,$5)`,
      [shareLinkId, DEMO_COMMUNITY, id, shareId, shareCode],
    );
    await e2eAuthPool.query(
      `INSERT INTO promotion_clicks(link_id,click_day,visitor_key,network_key,community_id,user_id,kind,created_at)
       VALUES($1,current_date,$2,$3,$4,$5,'share',now()),($1,current_date-1,$6,$7,$4,$5,'share',now()-interval '1 day')`,
      [shareLinkId, `v:${'a'.repeat(64)}`, 'b'.repeat(64), DEMO_COMMUNITY, id, `v:${'c'.repeat(64)}`, 'd'.repeat(64)],
    );
    await e2eAuthPool.query(
      `INSERT INTO share_endorsements(share_id,user_id) VALUES($1,$2)`,
      [shareId, id],
    );
    await e2eAuthPool.query(
      `INSERT INTO share_credit_events(share_id,community_id,user_id,role,basis,units,source_ref,actor_user_id)
       VALUES($1,$2,$3,'sharer','star_confirmed',1,$4,$5)`,
      [shareId, DEMO_COMMUNITY, id, `star:${id}`, DEMO_USERS[0].user_id],
    );
    await e2eAuthPool.query(
      `INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
       VALUES($1,$2,$3,$4,'公開活動按鈕測試',now()-interval '1 day',now()+interval '2 days','online','線上','published','open','other')`,
      [eventId, DEMO_COMMUNITY, id, eventTitle],
    );
    await e2eAuthPool.query(
      `INSERT INTO shares(share_id,community_id,kind,canonical_key,canonical_url,ref_table,ref_id,title,first_sharer_user_id,state)
       VALUES($1,$2,'event',$3,$4,'community_events',$5,$6,$7,'published')`,
      [eventShareId, DEMO_COMMUNITY, `event:${eventId}`, `/events/${eventId}`, eventId, eventTitle, id],
    );
    await e2eAuthPool.query(
      `INSERT INTO community_event_share_codes(event_id,user_id,code) VALUES($1,$2,$3)`,
      [eventId, id, eventRefCode],
    );
    await e2eAuthPool.query(
      `INSERT INTO promotion_links(link_id,community_id,user_id,kind,target_key,code) VALUES($1,$2,$3,'event',$4,$5)`,
      [eventLinkId, DEMO_COMMUNITY, id, eventId, eventCode],
    );
    await e2eAuthPool.query(
      `INSERT INTO community_event_guest_rsvps(event_id,email,name,referred_by_user_id,email_sent_at,confirmed_at)
       VALUES($1,$2,'測試報名者',$3,now(),now())`,
      [eventId, `guest-${id.slice(0, 8)}@example.test`, id],
    );
    // 1. Anonymous visitor can view SSR public share page /s/:shareId
    const anonCtx = await browser.newContext({ baseURL: e2eOrigin(), userAgent: GUEST_UA, viewport: PHONE });
    try {
      const anon = await anonCtx.newPage();
      await anon.goto(`/s/${shareId}`);
      await expect(anon.getByRole('heading', { name: repoFull })).toBeVisible();
    } finally {
      await anonCtx.close();
    }

    // 2. navigator.share absent + clipboard denied -> primary button is 複製連結, manual textarea selected, no 已複製。
    const deniedCtx = await browser.newContext({ baseURL: e2eOrigin(), viewport: PHONE });
    try {
      const p = await deniedCtx.newPage();
      await p.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
        });
      });
      await signIn(p, member.email);
      await expandHomeSections(p);
      await p.getByRole('button', { name: '分享自由工坊', exact: true }).click();
      const dialog = p.locator('.skill-share-dialog');
      await expect(dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
      const primary = dialog.locator('.skill-share-actions > button.btn-primary');
      await expect(primary).toHaveText('複製連結');
      await primary.click();
      await expect(dialog.getByText('已複製。', { exact: true })).toHaveCount(0);
      const manual = dialog.getByLabel('手動複製分享內容', { exact: true });
      await expect(manual).toBeVisible();
      await expect(manual).toBeFocused();
      expect(await manual.evaluate(el => {
        const area = el as HTMLTextAreaElement;
        return area.selectionStart === 0 && area.selectionEnd === area.value.length;
      })).toBe(true);
    } finally {
      await deniedCtx.close();
    }

    // 3. navigator.share rejecting AbortError stays silent
    const abortCtx = await browser.newContext({ baseURL: e2eOrigin(), viewport: PHONE });
    try {
      const p = await abortCtx.newPage();
      await p.addInitScript(() => {
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: () => Promise.reject(new DOMException('cancelled', 'AbortError')),
        });
      });
      await signIn(p, member.email);
      await expandHomeSections(p);
      await p.getByRole('button', { name: '分享自由工坊', exact: true }).click();
      const dialog = p.locator('.skill-share-dialog');
      await expect(dialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
      await dialog.getByRole('button', { name: '分享', exact: true }).click();
      await expect(dialog.getByRole('status')).toHaveCount(0);
      await expect(dialog.getByRole('textbox')).toHaveCount(0);
    } finally {
      await abortCtx.close();
    }

    // 4. Signed-in member: #me/credit (MyCredit + collapsed legacy-promotion) & public event-page.js
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {} });
    });
    await signIn(page, member.email);
    await page.goto('/#me/credit');
    const credit = page.getByRole('region', { name: '我的貢獻', exact: true });
    await expect(credit).toBeVisible();
    const repoRow = credit.getByRole('article').filter({ hasText: repoFull });
    await expect(repoRow.locator('.share-result-kind')).toHaveText('GitHub 專案');
    await expect(repoRow).toContainText('點閱 2 · 加星 1');
    const eventRow = credit.getByRole('article').filter({ hasText: eventTitle });
    await expect(eventRow.locator('.share-result-kind')).toHaveText('活動');
    await expect(eventRow).toContainText('還沒有人點開');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // 「再分享」 opens ShareButton dialog cleanly and keeps inline size on narrow viewports
    const creditReshare = repoRow.getByRole('button', { name: '再分享', exact: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect((await creditReshare.boundingBox())!.width).toBeLessThan(width * 0.5);
      expect((await repoRow.locator('.skill-share').boundingBox())!.width).toBeLessThan(width * 0.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize(PHONE);
    await creditReshare.click();
    const reshare = await assertShareDialogWithQr(page, repoFull);
    await reshare.dialog.getByRole('button', { name: '關閉分享', exact: true }).click();

    // 「舊的推廣紀錄」 is collapsed by default
    const legacy = page.locator('details.legacy-promotion');
    await expect(legacy).toBeVisible();
    await expect(legacy.locator('> summary')).toHaveText('舊的推廣紀錄');
    await expect(legacy).not.toHaveAttribute('open');

    // TesterMap keeps inline share trigger compact at 390px and 320px
    await page.goto('/#tester-map');
    const testerShare = page.locator('.tester-map').getByRole('button', { name: '分享', exact: true });
    await expect(testerShare).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect((await testerShare.boundingBox())!.width).toBeLessThan(width * 0.5);
      expect((await page.locator('.tester-map .actions .skill-share').boundingBox())!.width).toBeLessThan(width * 0.5);
    }
    await page.setViewportSize(PHONE);

    // Public /events/:id (event-page.js): 我也要分享 -> 複製連結 & 分享
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/v1/session')),
      page.goto(`/events/${eventId}`),
    ]);
    await page.getByRole('button', { name: '我也要分享', exact: true }).click();
    const box = page.locator('#event-share-result');
    await expect(box.getByLabel('我的分享連結', { exact: true })).toHaveValue(new RegExp(`/go/${eventCode}$`));
    await expect(box).toContainText('0 個有效點閱日 · 1 人報名');
    const evCopy = box.getByRole('button', { name: '複製連結', exact: true });
    const evShare = box.getByRole('button', { name: '分享', exact: true });
    await expect(evCopy).toBeVisible();
    await expect(evShare).toBeVisible();
    expect((await evCopy.boundingBox())!.width).toBeLessThan(PHONE.width * 0.5);
    expect((await evShare.boundingBox())!.width).toBeLessThan(PHONE.width * 0.5);
    await evCopy.click();
    await expect(page.getByText('已複製。', { exact: true })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
      });
    });
    await evCopy.click();
    await expect(page.getByText('請手動複製上面的連結。', { exact: true })).toBeVisible();
  } finally {
    await e2eAuthPool.query(`DELETE FROM community_event_guest_rsvps WHERE event_id=$1`, [eventId]);
    await e2eAuthPool.query(`DELETE FROM community_event_share_codes WHERE event_id=$1`, [eventId]);
    await e2eAuthPool.query(`DELETE FROM community_events WHERE event_id=$1`, [eventId]);
    await e2eAuthPool.query(`DELETE FROM share_endorsements WHERE share_id IN ($1,$2)`, [shareId, eventShareId]);
    await e2eAuthPool.query(`DELETE FROM promotion_clicks WHERE link_id IN ($1,$2)`, [shareLinkId, eventLinkId]);
    await e2eAuthPool.query(`DELETE FROM promotion_links WHERE link_id IN ($1,$2)`, [shareLinkId, eventLinkId]);
    await e2eAuthPool.query(`UPDATE shares SET state='retracted' WHERE share_id IN ($1,$2)`, [shareId, eventShareId]);
  }
});
