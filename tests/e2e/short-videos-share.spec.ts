import {test, expect, type Page} from './member-feature-fixture.js';
import {navigate, selectSocialFeed} from './navigation.js';

/**
 * Sharing around the Short feed: actions on the slide, the home timeline, in-card playback of ordinary YouTube
 * links, and what the link composer says. Video ids are fake and the player origin is answered locally, so these
 * check wiring and lifecycle, not whether YouTube plays a given video.
 */
const SHORT = 'aaaaaaaaaaa', WATCH = 'bbbbbbbbbbb';
const ORIGIN = 'https://www.youtube-nocookie.com';
/** Compares the parsed origin, never a string prefix, so a look-alike host such as <origin>.example.net cannot match. */
const isPlayer = (raw: string) => { try { return new URL(raw).origin === ORIGIN; } catch { return false; } };

async function prepare(page: Page) {
  // A system share sheet would block a headless run; the permalink dialog is the fallback under test.
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'share', {value: undefined, configurable: true}); });
  await page.route(`${ORIGIN}/**`, route => route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>'}));
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill('maker@local.test');
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.locator('.shell')).toBeVisible();
}

async function seed(pool: import('pg').Pool, rows: {title: string; url: string; author?: string}[]) {
  const maker = (await pool.query('SELECT community_id, user_id FROM users WHERE email=$1', ['maker@local.test'])).rows[0];
  const ids: string[] = [];
  for (const [index, row] of rows.entries()) {
    const author = row.author ? (await pool.query('SELECT user_id FROM users WHERE email=$1', [`${row.author}@local.test`])).rows[0].user_id : maker.user_id;
    ids.push((await pool.query(`INSERT INTO community_social_posts(community_id,author_user_id,kind,url,platform,title,state,created_at)
      VALUES($1,$2,'link',$3,'youtube',$4,'active',now() + ($5 || ' seconds')::interval) RETURNING post_id`, [maker.community_id, author, row.url, row.title, String(-index)])).rows[0].post_id);
  }
  return ids;
}
const cleanup = (pool: import('pg').Pool, ids: string[]) => pool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]);

test.describe('sharing around Short, feature ON', () => {
  test.use({memberFeatures: {shortVideosEnabled: true, memberReportingEnabled: true}});

  test('a slide offers like, comments, share and post options without leaving the feed', async ({page, e2eAuthPool}) => {
    await prepare(page);
    const stamp = Date.now();
    const ids = await seed(e2eAuthPool, [{title: `互動短影音 ${stamp}`, url: `https://www.youtube.com/shorts/${SHORT}`, author: 'reviewer'}]);
    try {
      await page.reload();
      await navigate(page, '社群分享');
      const shortEntry=page.locator('.social-feed-navigation').getByRole('button',{name:'Short',exact:true});
      await shortEntry.focus();await page.keyboard.press('Enter');
      await expect(shortEntry).toHaveAttribute('aria-pressed','true');await expect(shortEntry).toBeFocused();
      const feed = page.getByRole('region', {name: '短影音', exact: true});
      await expect(feed).toBeVisible();
      for (const control of await feed.locator('.short-video-actions button').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // Like and unlike with one tap; the count follows and survives a reload.
      await feed.getByRole('button', {name: '按讚 · 0', exact: true}).click();
      await expect(feed.getByRole('button', {name: '收回讚 · 1', exact: true})).toHaveAttribute('aria-pressed', 'true');
      await page.reload();
      await navigate(page, '社群分享');
      await selectSocialFeed(page, 'Short');
      await expect(feed.getByRole('button', {name: '收回讚 · 1', exact: true})).toBeVisible();
      await feed.getByRole('button', {name: '收回讚 · 1', exact: true}).click();
      await expect(feed.getByRole('button', {name: '按讚 · 0', exact: true})).toHaveAttribute('aria-pressed', 'false');
      // Comments open in the existing comment panel, already expanded; the slide's count follows.
      const trigger = feed.getByRole('button', {name: /^留言 · \d+$/});
      await expect(trigger).toHaveAccessibleName('留言 · 0');
      await trigger.click();
      const sheet = page.getByRole('dialog', {name: '貼文留言', exact: true});
      await expect(sheet).toBeVisible();
      await sheet.getByLabel('寫留言').fill('從 Short 留言');
      await sheet.getByRole('button', {name: '送出留言', exact: true}).click();
      await expect(sheet.getByText('從 Short 留言')).toBeVisible();
      await sheet.getByRole('button', {name: '關閉', exact: true}).click();
      await expect(sheet).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(feed.getByRole('button', {name: '留言 · 1', exact: true})).toBeVisible();
      // Share hands off the permalink; options keep the report entry.
      await feed.getByRole('button', {name: '分享貼文連結', exact: true}).click();
      const share = page.getByRole('dialog', {name: '分享貼文連結', exact: true});
      await expect(share.getByLabel('貼文連結')).toHaveValue(new RegExp(`social-post=${ids[0]}`));
      await share.getByRole('button', {name: '關閉分享', exact: true}).click();
      await feed.getByRole('button', {name: '貼文選項與檢舉', exact: true}).click();
      await expect(page.getByRole('dialog', {name: '貼文選項與檢舉', exact: true}).getByRole('button', {name: '檢舉貼文', exact: true})).toBeVisible();
    } finally {
      await e2eAuthPool.query('DELETE FROM community_social_comments WHERE post_id = ANY($1::uuid[])', [ids]).catch(() => undefined);
      await cleanup(e2eAuthPool, ids);
    }
  });

  test('an uncertain Short like explicitly confirms its original intent after refresh and a later rejection',async({page,e2eAuthPool})=>{
    await page.setViewportSize({width:320,height:760});await prepare(page);
    const ids=await seed(e2eAuthPool,[{title:`Short retry ${Date.now()}`,url:`https://www.youtube.com/shorts/${SHORT}?retry=${Date.now()}`}]);
    const path=`/api/v1/social-posts/${ids[0]}/like`,matchesLike=(url:URL)=>url.pathname===path;
    const writes:{key:string|undefined;body:unknown}[]=[];
    await page.route(matchesLike,async route=>{
      const request=route.request();if(request.method()!=='POST'){await route.continue();return;}
      writes.push({key:request.headers()['idempotency-key'],body:request.postDataJSON()});
      if(writes.length===1){const response=await route.fetch();expect(response.status()).toBe(200);expect(await response.json()).toMatchObject({post_id:ids[0],liked:true,like_count:1});await route.abort('failed');}
      else if(writes.length===2)await route.fulfill({status:403,contentType:'application/problem+json',body:JSON.stringify({status:403,code:'onboarding_required',detail:'原按讚確認暫時被拒絕。'})});
      else if(writes.length===4){const response=await route.fetch();expect(response.status()).toBe(200);expect(await response.json()).toMatchObject({post_id:ids[0],liked:false,like_count:0});await route.abort('failed');}
      else await route.continue();
    });
    try{
      await navigate(page,'社群分享');await selectSocialFeed(page,'Short');
      const slide=page.locator(`.short-video-slide[data-post-id="${ids[0]}"]`);
      await slide.getByRole('button',{name:'按讚 · 0',exact:true}).click();
      await expect(slide.getByRole('button',{name:'確認上次按讚 · 0',exact:true})).toBeEnabled();
      // This remounts the Short feed but must retain the parent-owned uncertain command.
      await page.getByRole('button',{name:'更新動態',exact:true}).click();
      const retry=slide.getByRole('button',{name:'確認上次按讚 · 1',exact:true});await expect(retry).toBeEnabled();await expect(retry).toHaveAttribute('aria-pressed','true');
      await retry.click();await expect(page.locator('.social-feedback')).toHaveText('原按讚確認暫時被拒絕。');await expect(retry).toBeEnabled();
      await retry.click();await expect(slide.getByRole('button',{name:'收回讚 · 1',exact:true})).toBeEnabled();
      expect(writes).toHaveLength(3);expect(writes[0].key).toBeTruthy();expect(writes[0].body).toEqual({liked:true});expect(writes[1]).toEqual(writes[0]);expect(writes[2]).toEqual(writes[0]);
      expect(Number((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_likes WHERE post_id=$1',[ids[0]])).rows[0].n)).toBe(1);
      await slide.getByRole('button',{name:'收回讚 · 1',exact:true}).click();
      await expect(slide.getByRole('button',{name:'確認上次收回讚 · 1',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'更新動態',exact:true}).click();
      const confirmUnlike=slide.getByRole('button',{name:'確認上次收回讚 · 0',exact:true});await expect(confirmUnlike).toBeVisible();await expect(confirmUnlike).toBeEnabled();
      const box=(await confirmUnlike.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      const otherControls=slide.locator('.short-video-actions button').filter({hasNotText:'確認上次收回讚'});
      for(const control of [...await otherControls.all(),...await page.locator('.short-video-controls button').all()]){const other=(await control.boundingBox())!;const overlapX=Math.min(box.x+box.width,other.x+other.width)-Math.max(box.x,other.x),overlapY=Math.min(box.y+box.height,other.y+other.height)-Math.max(box.y,other.y);expect(overlapX>0&&overlapY>0).toBe(false);}
      await confirmUnlike.click();await expect(slide.getByRole('button',{name:'按讚 · 0',exact:true})).toBeEnabled();
      expect(writes).toHaveLength(5);expect(writes[3].key).not.toBe(writes[0].key);expect(writes[3].body).toEqual({liked:false});expect(writes[4]).toEqual(writes[3]);
      expect(Number((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_likes WHERE post_id=$1',[ids[0]])).rows[0].n)).toBe(0);
    }finally{try{await page.unroute(matchesLike);}finally{await cleanup(e2eAuthPool,ids);}}
  });

  test('keys pressed on the action buttons and inside the share dialog keep their meaning; Space on the feed itself still pauses', async ({page, e2eAuthPool}) => {
    await prepare(page);
    const stamp = Date.now();
    const ids = await seed(e2eAuthPool, [{title: `鍵盤短影音 ${stamp}`, url: `https://www.youtube.com/shorts/${SHORT}`, author: 'reviewer'}]);
    try {
      await page.reload();
      await navigate(page, '社群分享');
      await selectSocialFeed(page, 'Short');
      const feed = page.getByRole('region', {name: '短影音', exact: true});
      await expect(feed.getByRole('button', {name: '暫停', exact: true})).toBeVisible();
      // Space activates the focused like button; the video keeps playing.
      const like = feed.getByRole('button', {name: '按讚 · 0', exact: true});
      await like.focus();
      await page.keyboard.press('Space');
      await expect(feed.getByRole('button', {name: '收回讚 · 1', exact: true})).toHaveAttribute('aria-pressed', 'true');
      await expect(feed.getByRole('button', {name: '暫停', exact: true})).toBeVisible();
      // Inside the share dialog, Space closes it with its own button and does not reach the player.
      await feed.getByRole('button', {name: '分享貼文連結', exact: true}).click();
      const share = page.getByRole('dialog', {name: '分享貼文連結', exact: true});
      await expect(share).toBeVisible();
      await share.getByRole('button', {name: '關閉分享', exact: true}).focus();
      await page.keyboard.press('Space');
      await expect(share).toHaveCount(0);
      await expect(feed.getByRole('button', {name: '暫停', exact: true})).toBeVisible();
      // On the feed itself the shortcut still works.
      await feed.locator('.short-video-scroller').focus();
      await page.keyboard.press('Space');
      await expect(feed.getByRole('button', {name: '繼續播放', exact: true})).toBeVisible();
      await page.keyboard.press('Space');
      await expect(feed.getByRole('button', {name: '暫停', exact: true})).toBeVisible();
    } finally { await cleanup(e2eAuthPool, ids); }
  });

  test('returning to the tab refreshes the same hashtag-filtered list, across pages, and never swaps it for all YouTube posts', async ({page, e2eAuthPool}) => {
    test.setTimeout(90000);
    await prepare(page);
    const stamp = Date.now();
    const maker = (await e2eAuthPool.query('SELECT community_id, user_id FROM users WHERE email=$1', ['maker@local.test'])).rows[0];
    const mark = `標籤${stamp}`;
    // 27 tagged Shorts (more than one page) and one untagged Short that must never appear while the tag is active.
    const tagged = (await e2eAuthPool.query(`INSERT INTO community_social_posts(community_id,author_user_id,kind,url,platform,title,note,tags,state,created_at)
      SELECT $1,$2,'link','https://www.youtube.com/shorts/'||substr(md5(n::text),1,11),'youtube','標籤影片 '||n||' ${stamp}','#'||$3,ARRAY[lower($3)],'active',now()-n*interval '1 second'
      FROM generate_series(1,27) n RETURNING post_id`, [maker.community_id, maker.user_id, mark])).rows.map(row => row.post_id as string);
    const plain = (await e2eAuthPool.query(`INSERT INTO community_social_posts(community_id,author_user_id,kind,url,platform,title,state,created_at)
      VALUES($1,$2,'link','https://www.youtube.com/shorts/zzzzzzzzzzz',$4,$3,'active',now()) RETURNING post_id`, [maker.community_id, maker.user_id, `未標籤影片 ${stamp}`, 'youtube'])).rows[0].post_id as string;
    const listRequests: string[] = [];
    page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/v1/social-posts' && request.method() === 'GET') listRequests.push(url.search); });
    try {
      await page.reload();
      await navigate(page, '社群分享');
      await selectSocialFeed(page, 'YouTube');
      await page.locator('article.social-card').filter({hasText: `標籤影片 1 ${stamp}`}).getByRole('button', {name: `#${mark.toLowerCase()}`, exact: true}).click();
      await expect(page.locator('.social-active-tag')).toContainText(`#${mark.toLowerCase()}`);
      await selectSocialFeed(page, 'Short');
      const feed = page.getByRole('region', {name: '短影音', exact: true});
      const slides = feed.locator('article.short-video-slide');
      await expect(slides.first()).toBeVisible();
      await expect(slides.filter({hasText: `未標籤影片 ${stamp}`})).toHaveCount(0);
      // Reach the end of the first page so the next page loads (with the tag).
      await feed.locator('.short-video-scroller').evaluate(element => element.scrollTo({top: element.clientHeight * 24, behavior: 'instant'}));
      await expect(slides).toHaveCount(27);
      // Return to the tab: every refresh request carries the tag, and the list is still the tagged one.
      listRequests.length = 0;
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', {configurable: true, get: () => true}); document.dispatchEvent(new Event('visibilitychange')); });
      await page.evaluate(() => { delete (document as unknown as {hidden?: boolean}).hidden; document.dispatchEvent(new Event('visibilitychange')); });
      await expect.poll(() => listRequests.length).toBeGreaterThanOrEqual(2);
      await expect(feed.getByRole('button', {name: '暫停', exact: true})).toBeVisible();
      for (const search of listRequests) expect(new URLSearchParams(search).get('tag')).toBe(mark.toLowerCase());
      await expect(slides).toHaveCount(27);
      await expect(slides.filter({hasText: `未標籤影片 ${stamp}`})).toHaveCount(0);
      await expect(page.locator('.social-active-tag')).toContainText(`#${mark.toLowerCase()}`);
    } finally { await cleanup(e2eAuthPool, [...tagged, plain]); }
  });

  test('the home timeline offers the same Short feed', async ({page, e2eAuthPool}) => {
    await prepare(page);
    const stamp = Date.now();
    const ids = await seed(e2eAuthPool, [{title: `首頁短影音 ${stamp}`, url: `https://www.youtube.com/shorts/${SHORT}`}]);
    try {
      await page.reload();
      await navigate(page, '會員首頁');
      await selectSocialFeed(page, 'Short');
      const feed = page.getByRole('region', {name: '短影音', exact: true});
      await expect(feed.locator('article.short-video-slide').filter({hasText: `首頁短影音 ${stamp}`})).toHaveCount(1);
    } finally { await cleanup(e2eAuthPool, ids); }
  });

  test('an ordinary YouTube link plays inside its card only after the viewer asks, and a Short carries a badge', async ({page, e2eAuthPool}) => {
    const contacted: string[] = [];
    page.on('request', request => { if (isPlayer(request.url())) contacted.push(request.url()); });
    await prepare(page);
    const stamp = Date.now();
    const titles = [`一般影片 ${stamp}`, `標示短影音 ${stamp}`];
    const ids = await seed(e2eAuthPool, [{title: titles[0], url: `https://www.youtube.com/watch?v=${WATCH}&list=PLx&si=tracking`}, {title: titles[1], url: `https://www.youtube.com/shorts/${SHORT}`}]);
    try {
      await page.reload();
      await navigate(page, '社群分享');
      await selectSocialFeed(page, 'YouTube');
      const card = page.locator('article.social-card').filter({hasText: titles[0]});
      await expect(card).toBeVisible();
      await expect(card.locator('iframe')).toHaveCount(0);
      expect(contacted).toEqual([]);
      await expect(page.locator('article.social-card').filter({hasText: titles[1]}).getByText('Short', {exact: true})).toBeVisible();
      await expect(card.getByText('Short', {exact: true})).toHaveCount(0);
      const play = card.getByRole('button', {name: '▶ 站內播放', exact: true});
      expect((await play.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await play.click();
      const frame = card.locator('iframe');
      await expect(frame).toHaveCount(1);
      const src = (await frame.getAttribute('src'))!;
      const player = new URL(src);
      expect(player.origin).toBe(ORIGIN);
      expect(player.pathname).toBe(`/embed/${WATCH}`);
      expect(player.search).not.toBe('');
      expect(src).not.toContain('tracking');
      expect(src).not.toContain('PLx');
      await card.getByRole('button', {name: '收起影片', exact: true}).click();
      await expect(card.locator('iframe')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await cleanup(e2eAuthPool, ids); }
  });

  test('the link composer says what it recognised before the member shares', async ({page}) => {
    await prepare(page);
    await navigate(page, '社群分享');
    await page.locator('.social-composer-start').getByRole('button', {name: '建立貼文', exact: true}).click();
    await page.getByRole('checkbox', {name: '加入連結預覽（選填）', exact: true}).check();
    const dialog = page.getByRole('dialog', {name: '建立貼文', exact: true});
    const field = dialog.getByLabel('預覽連結', {exact: true});
    await field.fill('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    await expect(dialog.getByRole('status').filter({hasText: 'Short 動態'})).toBeVisible();
    await field.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await expect(dialog.getByRole('status').filter({hasText: '直接播放'})).toBeVisible();
    await field.fill('https://www.youtube.com/@someone');
    await expect(dialog.getByRole('status').filter({hasText: '不是單支影片'})).toBeVisible();
    await field.fill('https://example.com/video');
    await expect(dialog.getByRole('status').filter({hasText: 'YouTube'})).toHaveCount(0);
  });
});

test.describe('sharing around Short, feature OFF (default)', () => {
  test.use({memberFeatures: {}});

  test('no in-card player, badge, hint promise or Short on the home timeline', async ({page, e2eAuthPool}) => {
    const contacted: string[] = [];
    page.on('request', request => { if (isPlayer(request.url())) contacted.push(request.url()); });
    await prepare(page);
    const stamp = Date.now();
    const ids = await seed(e2eAuthPool, [{title: `關閉狀態 ${stamp}`, url: `https://www.youtube.com/shorts/${SHORT}`}, {title: `關閉狀態影片 ${stamp}`, url: `https://www.youtube.com/watch?v=${WATCH}`}]);
    try {
      await page.reload();
      await navigate(page, '社群分享');
      await selectSocialFeed(page, 'YouTube');
      await expect(page.locator('article.social-card').filter({hasText: `關閉狀態影片 ${stamp}`})).toBeVisible();
      await expect(page.getByRole('button', {name: '▶ 站內播放'})).toHaveCount(0);
      await expect(page.locator('.social-short-badge')).toHaveCount(0);
      await page.getByRole('button', {name: '動態選項', exact: true}).click();
      const options = page.getByRole('dialog', {name: '動態選項', exact: true});
      await expect(options.getByRole('button', {name: 'Short', exact: true})).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.locator('.social-feed-navigation').getByRole('button', {name: 'Short', exact: true})).toHaveCount(0);
      await page.locator('.social-composer-start').getByRole('button', {name: '建立貼文', exact: true}).click();
      await page.getByRole('checkbox', {name: '加入連結預覽（選填）', exact: true}).check();
      const dialog = page.getByRole('dialog', {name: '建立貼文', exact: true});
      await dialog.getByLabel('預覽連結', {exact: true}).fill('https://www.youtube.com/shorts/dQw4w9WgXcQ');
      await expect(dialog.getByRole('status')).toHaveText('這是 YouTube Short 連結。');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await navigate(page, '會員首頁');
      await page.getByRole('button', {name: '動態選項', exact: true}).click();
      await expect(page.getByRole('dialog', {name: '動態選項', exact: true}).getByRole('button', {name: 'Short', exact: true})).toHaveCount(0);
      expect(contacted).toEqual([]);
    } finally { await cleanup(e2eAuthPool, ids); }
  });
});
