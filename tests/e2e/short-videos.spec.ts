import {test, expect, type Page} from './member-feature-fixture.js';
import {navigate, selectSocialFeed} from './navigation.js';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill('maker@local.test');
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.locator('.shell')).toBeVisible();
  await navigate(page, '社群分享');
}

test.describe('Short feed ON',()=>{
test.use({memberFeatures:{shortVideosEnabled:true}});
test('members swipe through shared YouTube links in a scrollbar-free feed; players come only from the allowed origin and other sources never get one', async ({page, e2eAuthPool}) => {
  const violations: string[] = [];
  page.on('console', message => { if (/Content Security Policy|Refused to frame/i.test(message.text())) violations.push(message.text()); });
  await login(page);
  const base = (await e2eAuthPool.query('SELECT community_id, user_id AS author_user_id FROM users WHERE email=$1', ['maker@local.test'])).rows[0];
  expect(base).toBeTruthy();
  const stamp = Date.now();
  const titles = [`E2E 短影音一 ${stamp}`, `E2E 短影音二 ${stamp}`, `E2E 非 YouTube ${stamp}`, `E2E 橫式影片 ${stamp}`];
  const urls = ['https://www.youtube.com/shorts/aaaaaaaaaaa', 'https://www.youtube.com/shorts/bbbbbbbbbbb', 'https://www.instagram.com/reel/CcCcCcCc/', 'https://www.youtube.com/watch?v=ddddddddddd'];
  const platforms = ['youtube', 'youtube', 'instagram', 'youtube'];
  const ids: string[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      ids.push((await e2eAuthPool.query(`INSERT INTO community_social_posts(community_id,author_user_id,kind,url,platform,title,state,created_at)
        VALUES($1,$2,'link',$3,$4,$5,'active',now() + ($6 || ' seconds')::interval) RETURNING post_id`, [base.community_id, base.author_user_id, urls[i], platforms[i], titles[i], String(-i)])).rows[0].post_id);
    }
    await page.reload();
    await navigate(page, '社群分享');
    await selectSocialFeed(page, 'Short');
    const feed = page.getByRole('region', {name: '短影音', exact: true});
    await expect(feed).toBeVisible();
    const slides = feed.locator('article.short-video-slide');
    await expect(slides.filter({hasText: titles[0]})).toHaveCount(1);
    await expect(slides.filter({hasText: titles[1]})).toHaveCount(1);
    await expect(slides.filter({hasText: titles[2]})).toHaveCount(0);
    // A watch link may be any shape, so it never reaches the vertical feed.
    await expect(slides.filter({hasText: titles[3]})).toHaveCount(0);
    // The current slide and its neighbour hold a player; every player comes from the allowed origin and an 11-character id.
    const players = feed.locator('iframe');
    await expect(players).toHaveCount(2);
    for (const src of await players.evaluateAll(frames => frames.map(frame => (frame as HTMLIFrameElement).src))) {
      expect(src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?/);
    }
    // No native scrollbar, and the player never takes the touch away from the feed.
    const scroller = feed.locator('.short-video-scroller');
    expect(await scroller.evaluate(element => (element as HTMLElement).offsetWidth - element.clientWidth)).toBe(0);
    expect(await players.first().evaluate(frame => getComputedStyle(frame).pointerEvents)).toBe('none');
    const down = feed.getByRole('button', {name: '下一支短影音', exact: true}), up = feed.getByRole('button', {name: '上一支短影音', exact: true});
    await expect(up).toBeDisabled();
    await down.click();
    await expect(slides.nth(1)).toBeInViewport({ratio: 0.6});
    await expect(down).toBeDisabled();
    await expect(up).toBeEnabled();
    await feed.getByRole('button', {name: '暫停', exact: true}).click();
    await expect(feed.getByRole('button', {name: '繼續播放', exact: true})).toBeVisible();
    await feed.getByRole('button', {name: '開啟聲音', exact: true}).click();
    await expect(feed.getByRole('button', {name: '關閉聲音', exact: true})).toBeVisible();
    await up.click();
    await expect(slides.nth(0)).toBeInViewport({ratio: 0.6});
    // Full screen covers the whole viewport, keeps the same slide, locks the page behind it and Escape leaves it.
    for (const [width, height] of [[1280, 800], [390, 844]]) {
      await page.setViewportSize({width, height});
      await feed.scrollIntoViewIfNeeded();
      await feed.getByRole('button', {name: '全螢幕', exact: true}).click();
      const full = page.getByRole('dialog', {name: '短影音', exact: true});
      await expect(full).toBeVisible();
      await expect(full.getByRole('button', {name: '離開全螢幕', exact: true})).toBeFocused();
      const covered = (await full.boundingBox())!;
      expect(covered.width).toBe(width);
      expect(covered.height).toBe(height);
      const openSlides = full.locator('article.short-video-slide');
      expect(Math.round((await full.locator('.short-video-scroller').boundingBox())!.height)).toBe(height);
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
      await expect(openSlides.nth(0)).toBeInViewport({ratio: 0.9});
      await full.getByRole('button', {name: '下一支短影音', exact: true}).click();
      await expect(openSlides.nth(1)).toBeInViewport({ratio: 0.9});
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', {name: '短影音', exact: true})).toHaveCount(0);
      await expect(feed.getByRole('button', {name: '全螢幕', exact: true})).toBeFocused();
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
      await expect(slides.nth(1)).toBeInViewport({ratio: 0.9});
      await up.click();
      await expect(slides.nth(0)).toBeInViewport({ratio: 0.6});
    }
    // Back leaves full screen first and keeps the page; Tab stays inside the full-screen dialog.
    await page.setViewportSize({width: 390, height: 844});
    await feed.scrollIntoViewIfNeeded();
    const here = page.url();
    await feed.getByRole('button', {name: '全螢幕', exact: true}).click();
    const back = page.getByRole('dialog', {name: '短影音', exact: true});
    await expect(back).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await back.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await page.goBack();
    await expect(page.getByRole('dialog', {name: '短影音', exact: true})).toHaveCount(0);
    expect(page.url()).toBe(here);
    await expect(feed).toBeVisible();
    // A post hidden elsewhere stops being offered when the viewer returns to the tab.
    await e2eAuthPool.query("UPDATE community_social_posts SET state='hidden' WHERE post_id=$1", [ids[1]]);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(slides.filter({hasText: titles[1]})).toHaveCount(0);
    await expect(slides.filter({hasText: titles[0]})).toHaveCount(1);
    // Phones: the feed fits the screen, never scrolls the page sideways, and keeps 44px touch targets.
    for (const [width, height] of [[320, 568], [390, 844], [820, 1180]]) {
      await page.setViewportSize({width, height});
      await feed.scrollIntoViewIfNeeded();
      const box = (await scroller.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeLessThanOrEqual(height);
      expect(box.height).toBeGreaterThan(Math.min(height * 0.5, 300));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await scroller.evaluate(element => (element as HTMLElement).offsetWidth - element.clientWidth)).toBe(0);
      for (const control of await feed.locator('.short-video-controls button').all()) {
        const size = (await control.boundingBox())!;
        expect(size.width).toBeGreaterThanOrEqual(44);
        expect(size.height).toBeGreaterThanOrEqual(44);
        expect(size.x + size.width).toBeLessThanOrEqual(width);
      }
    }
    // The homepage admits only the journal and the enabled Short player.
    const csp = (await page.request.get('/')).headers()['content-security-policy'];
    expect(csp.split(';').map(part=>part.trim()).filter(part=>part.split(/\s+/)[0]==='frame-src')).toEqual(['frame-src https://aisns.evitina.tw https://www.youtube-nocookie.com']);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    if (ids.length) await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]);
  }
});
});

test.describe('Short feed OFF (default)',()=>{
test.use({memberFeatures:{}});
test('no Short option or player, and only the journal frame origin when the host did not enable it',async({page,baseURL})=>{
  await login(page);
  await page.getByRole('button',{name:'動態選項',exact:true}).click();
  const options=page.getByRole('dialog',{name:'動態選項',exact:true});
  await expect(options.getByRole('button',{name:'YouTube',exact:true})).toBeVisible();
  await expect(options.getByRole('button',{name:'Short',exact:true})).toHaveCount(0);
  expect(await (await page.request.get(`${baseURL}/api/v1/site`)).json()).toMatchObject({short_videos_enabled:false});
  const csp=(await page.request.get(`${baseURL}/`)).headers()['content-security-policy']??'';
  expect(csp.split(';').map(part=>part.trim()).filter(part=>part.split(/\s+/)[0]==='frame-src')).toEqual(['frame-src https://aisns.evitina.tw']);
  expect(csp).toContain("frame-ancestors 'none'");
  await expect(page.locator('iframe')).toHaveCount(0);
});
});
