import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {test, expect, type Page} from './fixtures.js';
import {navigate} from './navigation.js';

async function openOwnPost(page: Page, pool: Pool) {
  const userId = randomUUID(), postId = randomUUID(), email = `like-feedback-${userId}@example.test`;
  const inserted = await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    SELECT $1,community_id,$2,'按讚互動測試會員',password_hash,$3,false FROM users WHERE email='maker@local.test'`, [userId, email, randomUUID()]);
  expect(inserted.rowCount).toBe(1);
  await pool.query(`INSERT INTO community_social_posts(post_id,community_id,author_user_id,kind,platform,title,note,state)
    SELECT $1,community_id,user_id,'note','other','按讚互動測試','每個案例有自己的會員與貼文，不占用其他人的額度。','active' FROM users WHERE user_id=$2`, [postId, userId]);
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill(email);
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.locator('.shell')).toBeVisible();
  await navigate(page, '社群分享');
  const post = page.locator(`#social-post-${postId}`);
  await expect(post).toBeVisible();
  return {post, postId, userId, like: post.locator('button.social-post-like')};
}

for (const width of [390, 1440]) test(`like feedback is immediate but pending, duplicate taps do not write twice, and unlike persists at ${width}px`, async ({page, e2eAuthPool}) => {
  await page.setViewportSize({width, height: 844});
  await page.emulateMedia({reducedMotion: 'reduce'});
  const {post, postId, like} = await openOwnPost(page, e2eAuthPool);
  let release!: () => void, captured!: () => void, requests = 0;
  const gate = new Promise<void>(r => release = r), seen = new Promise<void>(r => captured = r);
  await page.route(`**/api/v1/social-posts/${postId}/like`, async route => {
    requests++;
    if (requests === 1) { captured(); await gate; }
    await route.continue();
  });
  try {
    const before = await like.boundingBox();
    await like.focus(); await page.keyboard.press('Space'); await seen;
    await expect(like).toHaveText('已讚 · 1'); await expect(like).toHaveAttribute('aria-pressed', 'true');
    expect(await like.locator('.social-like-pulse').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    await expect(like).toHaveAttribute('aria-busy', 'true'); await expect(like).toBeDisabled();
    await expect(post.getByRole('button', {name: '查看按讚名單', exact: true})).toContainText('0 人按讚');
    await like.dispatchEvent('click'); await page.keyboard.press('Enter'); expect(requests).toBe(1);
    const pending = await like.boundingBox(); expect(pending!.width).toBe(before!.width); expect(pending!.height).toBeGreaterThanOrEqual(44);
    release(); await expect(like).toBeEnabled(); await expect(like).not.toHaveAttribute('aria-busy', 'true');
    await expect(post.getByRole('button', {name: '查看按讚名單', exact: true})).toContainText('1 人按讚');
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_likes WHERE post_id=$1', [postId])).rows[0].n).toBe(1);
    await like.click(); await expect(like).toHaveText('讚 · 0'); await expect(like).toBeEnabled();
    await page.reload(); await expect(like).toHaveAttribute('aria-pressed', 'false'); await expect(like).toHaveText('讚 · 0');
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_likes WHERE post_id=$1', [postId])).rows[0].n).toBe(0);
    expect(requests).toBe(2);
    await page.emulateMedia({reducedMotion: 'reduce'});
    expect(await like.locator('.social-like-icon').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); }
});

for (const failure of ['lost', 'malformed', 'server-error'] as const) test(`an ${failure} like response rolls back the preview and manually replays the same command`, async ({page, e2eAuthPool}) => {
  const {post, postId, like} = await openOwnPost(page, e2eAuthPool);
  const attempts: {key: string; body: unknown}[] = [];
  await page.route(`**/api/v1/social-posts/${postId}/like`, async route => {
    attempts.push({key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON()});
    if (attempts.length !== 1) return route.continue();
    if (failure === 'server-error') return route.fulfill({status: 503, contentType: 'application/problem+json', body: JSON.stringify({detail: '服務暫時無法回應'})});
    const response = await route.fetch(); expect(response.status()).toBe(200);
    if (failure === 'lost') return route.abort('failed');
    return route.fulfill({response, json: {post_id: postId, liked: true, like_count: '1'}});
  });
  await like.click(); await expect(like).toHaveText('重試按讚 · 0'); await expect(like).toHaveAttribute('aria-pressed', 'false');
  await expect(post.getByRole('alert')).toContainText('最後確認的狀態'); expect(attempts).toHaveLength(1);
  await like.click(); await expect(like).toHaveText('已讚 · 1'); await expect(like).toBeEnabled();
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_likes WHERE post_id=$1', [postId])).rows[0].n).toBe(1);
  await expect(post.locator('.social-like-error')).toHaveCount(0);
});

test('a known initial rejection restores the original button and a new explicit attempt uses a fresh key', async ({page, e2eAuthPool}) => {
  const {postId, like} = await openOwnPost(page, e2eAuthPool);
  const keys: string[] = [];
  await page.route(`**/api/v1/social-posts/${postId}/like`, async route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) return route.fulfill({status: 429, contentType: 'application/problem+json', body: JSON.stringify({detail: '操作太頻繁，請稍後再試。'})});
    return route.continue();
  });
  await like.click(); await expect(like).toBeEnabled(); await expect(like).toHaveText('讚 · 0');
  await like.click(); await expect(like).toHaveText('已讚 · 1'); await expect(like).toBeEnabled();
  expect(keys).toHaveLength(2); expect(keys[1]).not.toBe(keys[0]);
});
