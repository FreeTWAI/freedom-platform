import {test, expect, type Page} from './member-feature-fixture.js';
import {navigate, selectSocialFeed} from './navigation.js';

/**
 * Keyboard focus in the full-screen Short dialog. The controls of slides that are not on screen are inert, so focus
 * has to survive the current slide changing underneath it (wheel, swipe, smooth scroll) and may never escape the
 * dialog. Players are answered locally; video ids are fake.
 */
test.use({memberFeatures: {shortVideosEnabled: true}});

async function openFullScreen(page: Page, pool: import('pg').Pool, label: string) {
  await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>'}));
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill('maker@local.test');
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.locator('.shell')).toBeVisible();
  const base = (await pool.query('SELECT community_id, user_id FROM users WHERE email=$1', ['maker@local.test'])).rows[0];
  const ids: string[] = [];
  for (const [index, id] of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].entries())
    ids.push((await pool.query(`INSERT INTO community_social_posts(community_id,author_user_id,kind,url,platform,title,state,created_at)
      VALUES($1,$2,'link',$3,'youtube',$4,'active',now() - ($5 || ' seconds')::interval) RETURNING post_id`,
    [base.community_id, base.user_id, `https://www.youtube.com/shorts/${id}`, `${label} ${index} ${Date.now()}`, String(index)])).rows[0].post_id);
  await page.setViewportSize({width: 390, height: 844});
  await page.reload();
  await navigate(page, '社群分享');
  await selectSocialFeed(page, 'Short');
  const feed = page.getByRole('region', {name: '短影音', exact: true});
  await expect(feed).toBeVisible();
  await feed.getByRole('button', {name: '全螢幕', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '短影音', exact: true});
  await expect(dialog).toBeVisible();
  return {dialog, ids};
}
const inside = (dialog: ReturnType<Page['locator']>) => dialog.evaluate(element => element.contains(document.activeElement));

test('focus stays in the dialog when the current slide changes under a focused control', async ({page, e2eAuthPool}) => {
  const {dialog, ids} = await openFullScreen(page, e2eAuthPool, '焦點換頁');
  try {
    await dialog.getByRole('button', {name: /^按讚/}).first().focus();
    await dialog.locator('.short-video-scroller').evaluate(element => element.scrollTo({top: element.clientHeight, behavior: 'instant'}));
    await expect(dialog.locator('article.short-video-slide').nth(1)).toBeInViewport({ratio: 0.9});
    await expect.poll(() => inside(dialog)).toBe(true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      expect(await inside(dialog), `key ${i}`).toBe(true);
    }
  } finally { await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]); }
});

test('focus that was dropped on the page comes back into the dialog on Tab and Shift+Tab', async ({page, e2eAuthPool}) => {
  const {dialog, ids} = await openFullScreen(page, e2eAuthPool, '焦點掉落');
  try {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await inside(dialog)).toBe(true);
    await expect(dialog.getByRole('button', {name: '離開全螢幕', exact: true})).toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Shift+Tab');
    expect(await inside(dialog)).toBe(true);
  } finally { await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]); }
});

test('only the slide on screen offers focusable controls, and long Tab runs never leave the dialog under a slow CPU', async ({page, e2eAuthPool}) => {
  const {dialog, ids} = await openFullScreen(page, e2eAuthPool, '焦點長按');
  try {
    // Links and buttons of slides that are not on screen cannot take focus, so Tab never scrolls the feed by itself.
    const offered = await dialog.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>('article.short-video-slide')).map(slide =>
      Array.from(slide.querySelectorAll<HTMLElement>('a[href], button:not(:disabled):not([tabindex="-1"])')).filter(control => !control.closest('[inert]')).length));
    expect(offered[0]).toBeGreaterThan(0);
    expect(offered.slice(1)).toEqual(offered.slice(1).map(() => 0));
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', {rate: 6});
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
      expect(await inside(dialog), `key ${i}`).toBe(true);
    }
    await session.send('Emulation.setCPUThrottlingRate', {rate: 1});
  } finally { await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]); }
});

test('focus on "next" survives the feed reaching the last slide, where that button becomes disabled', async ({page, e2eAuthPool}) => {
  const {dialog, ids} = await openFullScreen(page, e2eAuthPool, '焦點下一支');
  try {
    const next = dialog.getByRole('button', {name: '下一支短影音', exact: true});
    await next.focus();
    await expect(next).toBeFocused();
    // The feed moves on to the last slide while "next" has focus, so "next" is disabled from here on (the CI trace of #903).
    await dialog.locator('.short-video-scroller').evaluate(element => element.scrollTo({top: element.clientHeight * 2, behavior: 'instant'}));
    await expect(dialog.locator('article.short-video-slide').nth(2)).toBeInViewport({ratio: 0.9});
    await expect(next).toBeDisabled();
    await expect.poll(() => inside(dialog)).toBe(true);
    // Focus is handed on, not left sitting on a button that can no longer take it.
    await expect.poll(() => dialog.evaluate(() => document.activeElement instanceof HTMLButtonElement && document.activeElement.disabled)).toBe(false);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i % 4 === 3 ? 'Shift+Tab' : 'Tab');
      expect(await inside(dialog), `key ${i}`).toBe(true);
    }
    // The same at the other end: "previous" is disabled on the first slide.
    await dialog.getByRole('button', {name: '上一支短影音', exact: true}).focus();
    await dialog.locator('.short-video-scroller').evaluate(element => element.scrollTo({top: 0, behavior: 'instant'}));
    await expect(dialog.locator('article.short-video-slide').nth(0)).toBeInViewport({ratio: 0.9});
    await expect.poll(() => inside(dialog)).toBe(true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      expect(await inside(dialog), `key ${i} at the first slide`).toBe(true);
    }
  } finally { await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]); }
});
