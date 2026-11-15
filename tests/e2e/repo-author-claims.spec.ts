import {adminNavigate} from './admin-navigation.js';
import {randomUUID} from 'node:crypto';
import type {Page} from '@playwright/test';
import {navigate} from './navigation.js';
import {test, expect} from './fixtures.js';
import {DEMO_COMMUNITY, DEMO_USERS} from '../../packages/testing/seed.js';
import {E2E_AUTHOR_CLAIM_ADMIN_EMAIL, E2E_AUTHOR_CLAIM_ADMIN_TOKEN} from '../../packages/testing/e2e-admin.js';

const STATEMENT = '我是這份影片工具包的原創作者，請核對 GitHub 歷史。';
const EVIDENCE = 'https://github.com/Hao0321/video-autopilot-kit';

/** A fresh schema has no unlocked books, so the search box appears only after the locked shelf. A member who already has unlocked books sees the search box and the 未解鎖 toggle together. */
async function videoCard(page: Page) {
  await navigate(page, '技能書架');
  const library = page.locator('.community-library');
  const search = page.getByLabel('搜尋技能書', {exact: true});
  const locked = page.getByRole('button', {name: '未解鎖', exact: true});
  const preview = page.getByRole('button', {name: '免費預覽技能書', exact: true});
  // One of these three is the shelf entry. More than one can be visible at once, so match a single visible element.
  await expect(search.or(locked).or(preview).filter({visible: true}).first()).toBeVisible();
  if (!(await search.isVisible())) {
    if (await preview.isVisible()) await preview.click();
    else await locked.click();
  }
  await expect(search).toBeVisible();
  await search.fill('影片自動化');
  const card = library.locator('article[data-book-id="video-autopilot"]');
  const onShelf = await card.waitFor({state: 'visible', timeout: 8000}).then(() => true, () => false);
  if (!onShelf) {
    await locked.click();
    await expect(search).toBeVisible();
    await search.fill('影片自動化');
    await expect(card).toBeVisible();
  }
  return card;
}

test('member submits an original-author claim and an admin verification changes the public status', async ({page, browser, e2eAuthPool}) => {
  test.setTimeout(120_000);
  await e2eAuthPool.query(`INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)
    ON CONFLICT(email) DO UPDATE SET active=true, community_id=EXCLUDED.community_id, display_name=EXCLUDED.display_name`, [randomUUID(), DEMO_COMMUNITY, E2E_AUTHOR_CLAIM_ADMIN_EMAIL, '認領審核員']);
  await e2eAuthPool.query('DELETE FROM github_social_connections WHERE user_id=$1 OR github_user_id=$2', [DEMO_USERS[0].user_id, '9900112233']);
  await e2eAuthPool.query("INSERT INTO github_social_connections(user_id,community_id,github_user_id,github_login,encrypted_tokens) VALUES($1,$2,'9900112233','maker-claims-demo','e2e-not-a-token')", [DEMO_USERS[0].user_id, DEMO_COMMUNITY]);
  try {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/');
    await page.getByLabel('電子郵件', {exact: true}).fill('maker@local.test');
    await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
    await page.getByRole('button', {name: '登入', exact: true}).click();
    const card = await videoCard(page);
    await card.getByRole('button', {name: /^(閱讀|預覽)技能書$/}).click();
    const dialog = page.getByRole('dialog', {name: '影片自動化工具包', exact: true});
    const notes = dialog.locator('.skill-intro-usage-notes');
    await notes.locator('summary').click();
    await expect(dialog.getByRole('heading', {name: '認領這件原作', exact: true})).toBeVisible();
    await dialog.getByRole('textbox', {name: '聲明', exact: true}).fill(STATEMENT);
    await dialog.getByLabel('證據網址（建議提供）').fill(EVIDENCE);
    await notes.locator('summary').click();
    await expect(notes).not.toHaveAttribute('open');
    await notes.locator('summary').click();
    await expect(dialog.getByRole('textbox', {name: '聲明', exact: true})).toHaveValue(STATEMENT);
    await expect(dialog.getByLabel('證據網址（建議提供）')).toHaveValue(EVIDENCE);
    await dialog.getByRole('checkbox', {name: '我聲明這是本人提出的角色與說明，並了解審核完成前不會顯示為已核實。'}).check();
    await dialog.getByRole('button', {name: '送出認領', exact: true}).click();
    await expect(dialog.getByText('已送出認領，等待審核。審核完成前不會顯示為已核實。')).toBeVisible();
    await expect(dialog.locator('.skill-book-badges [data-author-claim-status="pending"]')).toHaveText('認領審核中');
    await expect(dialog.locator('p[data-author-claim-status="pending"]')).toHaveText('認領審核中');
    await expect(card.locator('.skill-library-description [data-author-claim-status="pending"]')).toHaveText('認領審核中');
    for (const width of [820, 390]) {
      await page.setViewportSize({width, height: width === 820 ? 1100 : 844});
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }

    const adminContext = await browser.newContext({viewport: {width: 1280, height: 900}});
    const adminPage = await adminContext.newPage();
    await adminPage.route('**/admin/api/**', async route => {
      const headers = {...route.request().headers(), 'cf-access-jwt-assertion': E2E_AUTHOR_CLAIM_ADMIN_TOKEN};
      await route.continue({headers});
    });
    await adminPage.goto('/admin');
    await adminNavigate(adminPage,'author-claims');
    const claim = adminPage.locator('article', {hasText: STATEMENT});
    await expect(claim).toBeVisible();
    await expect(claim).toContainText('88001122');
    await expect(adminPage.getByText('1382968090')).toHaveCount(0);
    for (const width of [1280, 820, 390]) {
      await adminPage.setViewportSize({width, height: 900});
      expect(await claim.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await adminPage.setViewportSize({width: 1280, height: 900});
    await claim.getByLabel('審核理由').fill('已核對公開的原作紀錄。');
    await claim.getByRole('button', {name: '確認', exact: true}).click();
    await expect(adminPage.getByText('管理操作已保存，並留下操作紀錄。')).toBeVisible();
    await adminContext.close();

    await page.setViewportSize({width: 1280, height: 900});
    await page.goto('/');
    const verifiedCard = await videoCard(page);
    const verified = verifiedCard.locator('[data-author-claim-status="verified_original_author"]');
    await expect(verified).toHaveText('已核實原作者');
    await page.setViewportSize({width: 390, height: 844});
    await expect(verified).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/development/skills/video-autopilot');
    await expect(page.locator('[data-author-claim-status="verified_original_author"]')).toHaveText('已核實原作者');
    await expect(page.locator('body')).toContainText('@maker-claims-demo');
    const html = await page.content();
    expect(html).not.toContain(STATEMENT);
    expect(html).not.toContain('已驗證');
    await page.setViewportSize({width: 820, height: 1100});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await e2eAuthPool.query("UPDATE repo_credit_claims SET state='revoked', version=version+1 WHERE state IN ('pending','verified','disputed')");
    await e2eAuthPool.query('DELETE FROM github_social_connections WHERE user_id=$1', [DEMO_USERS[0].user_id]);
  }
});

test('author claim review clears retained decision so switching to verified revokes cleanly', async ({page}) => {
  const claimId = randomUUID();
  let state: 'pending' | 'verified' | 'revoked' = 'pending';
  let version = 1;
  const reviews: {decision: string; reason: string}[] = [];
  await page.route('**/admin/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/admin/api', '');
    if (path === '/bootstrap') {
      return route.fulfill({json: {
        admin: {admin_id: 'synthetic-admin', display_name: '認領審核員', email: 'admin@example.test', role: 'super_admin', community_id: DEMO_COMMUNITY},
        csrf_token: 'synthetic-csrf',
        community_certification_enabled: false,
        store_admissions_enabled: false,
        tool_reports_enabled: false,
        github_setup_enabled: false,
        available_skill_books: [],
        summary: {members: 1, active_members: 1, pending_guild_applications: 0, guilds: 0, admins: 1},
      }});
    }
    if (path === '/credentials') return route.fulfill({json: {items: []}});
    if (path === '/author-claims') {
      const queue = url.searchParams.get('queue') === 'verified' ? 'verified' : 'review';
      const matches = (queue === 'review' && state === 'pending') || (queue === 'verified' && state === 'verified');
      return route.fulfill({json: {
        queue,
        identity_changes: [],
        items: matches ? [{
          claim_id: claimId,
          display_name: '合成申請者',
          github_login: 'synthetic-author',
          github_user_id: '88001122',
          role_label: '原創作者',
          state,
          state_label: state === 'verified' ? '已核實' : '認領審核中',
          evidence_url: null,
          statement: '合成原作認領測試說明。',
          appeal_text: null,
          appeal_count: 0,
          reason: null,
          version,
          submitted_at: '2026-01-01T00:00:00.000Z',
          source_snapshot: {book_id: 'video-autopilot'},
          repo: {full_name: 'FreeTWAI/synthetic-repo', current_url: 'https://github.com/FreeTWAI/synthetic-repo', provider_repo_id: '88001122'},
          related_claims: [],
        }] : [],
      }});
    }
    if (path === `/author-claims/${claimId}/review` && request.method() === 'POST') {
      const body = request.postDataJSON() as {decision: string; reason: string};
      reviews.push(body);
      if (state === 'verified' && body.decision !== 'revoke') {
        return route.fulfill({status: 409, json: {code: 'claim_transition_invalid', detail: '這筆認領目前的狀態不能做這個決定。'}});
      }
      if (state === 'pending' && body.decision === 'verify') {
        state = 'verified';
        version += 1;
        return route.fulfill({json: {claim_id: claimId, state, version}});
      }
      if (state === 'verified' && body.decision === 'revoke') {
        state = 'revoked';
        version += 1;
        return route.fulfill({json: {claim_id: claimId, state, version}});
      }
      return route.fulfill({status: 409, json: {code: 'claim_transition_invalid', detail: '這筆認領目前的狀態不能做這個決定。'}});
    }
    return route.fulfill({json: {items: []}});
  });

  await page.goto('/admin?view=author-claims&manage=1');
  const card = page.locator('article', {hasText: '合成原作認領測試說明。'});
  await expect(card).toBeVisible();
  await card.getByLabel('決定', {exact: true}).selectOption('reject');
  await card.getByLabel('決定', {exact: true}).selectOption('verify');
  await card.getByLabel('審核理由', {exact: true}).fill('已核對合成認領紀錄');
  await card.getByRole('button', {name: '確認', exact: true}).click();
  await expect(page.getByText('管理操作已保存，並留下操作紀錄。')).toBeVisible();
  await expect(card).toHaveCount(0);

  await page.getByRole('button', {name: '已核實', exact: true}).click();
  await expect(card).toBeVisible();
  await expect(card.getByLabel('決定', {exact: true})).toHaveValue('revoke');
  await card.getByLabel('審核理由', {exact: true}).fill('撤銷核實狀態');
  await card.getByRole('button', {name: '確認', exact: true}).click();
  await expect(page.getByText('管理操作已保存，並留下操作紀錄。')).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(reviews).toEqual([
    {decision: 'verify', reason: '已核對合成認領紀錄'},
    {decision: 'revoke', reason: '撤銷核實狀態'},
  ]);
});
