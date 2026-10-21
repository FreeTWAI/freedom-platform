import {test, expect, type Page} from './member-feature-fixture.js';
import {navigate, selectSocialFeed} from './navigation.js';

/**
 * The player commands are recorded at the boundary the page uses (contentWindow.postMessage), and the player
 * origin is answered locally, so these cases check what is actually sent and when, not just a button label.
 * Video ids are fake: this covers the lifecycle, not whether YouTube plays a given video.
 */
type Command = {id: string; func: string};
const IDS = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];

test.use({memberFeatures: {shortVideosEnabled: true, memberReportingEnabled: true}});

async function recordCommands(page: Page) {
  await page.addInitScript(() => {
    const log: {id: string; func: string}[] = [];
    (window as unknown as {__cmds: typeof log}).__cmds = log;
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')!;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get(this: HTMLIFrameElement) {
        const target = original.get!.call(this) as Window | null;
        if (!target) return target;
        return {postMessage: (message: string, origin: string) => {
          try { log.push({id: new URL(this.src).pathname.split('/').pop()!, func: JSON.parse(message).func}); } catch { /* not a command */ }
          target.postMessage(message, origin);
        }};
      },
    });
  });
}
const commands = (page: Page) => page.evaluate(() => [...(window as unknown as {__cmds: Command[]}).__cmds]);
const clearCommands = (page: Page) => page.evaluate(() => { (window as unknown as {__cmds: Command[]}).__cmds.length = 0; });
const played = async (page: Page, id: string) => (await commands(page)).some(command => command.id === id && command.func === 'playVideo');
const setHidden = (page: Page, hidden: boolean) => page.evaluate(value => {
  if (value) Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
  else delete (document as unknown as {hidden?: boolean}).hidden;
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

/** The player origin answers a blank page, optionally only once `gate` opens. */
async function answerPlayers(page: Page, gate?: Promise<void>) {
  await page.route('https://www.youtube-nocookie.com/**', async route => {
    if (gate) await gate;
    await route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>'});
  });
}

async function openShortFeed(page: Page) {
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill('maker@local.test');
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.locator('.shell')).toBeVisible();
}

async function seed(pool: import('pg').Pool, authors: string[], titles: string[]) {
  const maker = (await pool.query('SELECT community_id, user_id FROM users WHERE email=$1', ['maker@local.test'])).rows[0];
  const ids: string[] = [];
  for (const [index, title] of titles.entries()) {
    const author = authors[index] === 'maker' ? maker.user_id : (await pool.query('SELECT user_id FROM users WHERE email=$1', [`${authors[index]}@local.test`])).rows[0].user_id;
    ids.push((await pool.query(`INSERT INTO community_social_posts(community_id,author_user_id,kind,url,platform,title,state,created_at)
      VALUES($1,$2,'link',$3,'youtube',$4,'active',now() + ($5 || ' seconds')::interval) RETURNING post_id`,
    [maker.community_id, author, `https://www.youtube.com/shorts/${IDS[index]}`, title, String(-index)])).rows[0].post_id);
  }
  return ids;
}

async function showFeed(page: Page) {
  await page.reload();
  await navigate(page, '社群分享');
  await selectSocialFeed(page, 'Short');
  const feed = page.getByRole('region', {name: '短影音', exact: true});
  await expect(feed).toBeVisible();
  return feed;
}

test('a player that finishes loading late never overrides a pause or a hidden tab', async ({page, e2eAuthPool}) => {
  let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  await recordCommands(page);
  await answerPlayers(page, gate);
  await openShortFeed(page);
  const stamp = Date.now();
  const ids = await seed(e2eAuthPool, ['maker', 'maker'], [`延遲載入一 ${stamp}`, `延遲載入二 ${stamp}`]);
  try {
    const feed = await showFeed(page);
    // The viewer pauses while the player is still loading.
    await feed.getByRole('button', {name: '暫停', exact: true}).click();
    await expect(feed.getByRole('button', {name: '繼續播放', exact: true})).toBeVisible();
    await clearCommands(page);
    open();
    await expect.poll(async () => (await commands(page)).some(command => command.id === IDS[0] && command.func === 'pauseVideo')).toBe(true);
    expect(await played(page, IDS[0])).toBe(false);
    await feed.getByRole('button', {name: '繼續播放', exact: true}).click();
    await expect.poll(() => played(page, IDS[0])).toBe(true);
    // Hidden tab: playback stops and nothing starts again until the viewer is back and the list is confirmed.
    await setHidden(page, true);
    await expect.poll(async () => (await commands(page)).filter(command => command.id === IDS[0]).at(-1)?.func).toBe('pauseVideo');
    await clearCommands(page);
    await feed.getByRole('button', {name: '下一支短影音', exact: true}).click();
    await expect(feed.locator('article.short-video-slide').nth(1)).toBeInViewport({ratio: 0.6});
    await page.waitForTimeout(500);
    expect(await played(page, IDS[1])).toBe(false);
    expect(await played(page, IDS[0])).toBe(false);
  } finally {
    await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]);
  }
});

test('coming back keeps a withdrawn post stopped until the current list confirms it, and a failed check stays stopped', async ({page, e2eAuthPool}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await recordCommands(page);
  await answerPlayers(page);
  await openShortFeed(page);
  const stamp = Date.now();
  const titles = [`返回確認一 ${stamp}`, `返回確認二 ${stamp}`, `返回確認三 ${stamp}`];
  const ids = await seed(e2eAuthPool, ['maker', 'maker', 'maker'], titles);
  try {
    const feed = await showFeed(page);
    const slides = feed.locator('article.short-video-slide');
    await expect.poll(() => played(page, IDS[0])).toBe(true);
    // Hidden elsewhere while the viewer is away; the list answers late.
    await e2eAuthPool.query("UPDATE community_social_posts SET state='hidden' WHERE post_id=$1", [ids[0]]);
    let release!: () => void;
    const late = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/v1/social-posts?*', async route => { await late; await route.continue(); });
    await setHidden(page, true);
    await clearCommands(page);
    await setHidden(page, false);
    await expect(feed.getByRole('button', {name: '正在確認影片狀態', exact: true})).toBeVisible();
    await page.waitForTimeout(600);
    expect(await played(page, IDS[0])).toBe(false);
    release();
    // Confirmed: the withdrawn post is gone, its player is unmounted, and the neighbour takes over.
    await expect(slides.filter({hasText: titles[0]})).toHaveCount(0);
    await expect.poll(() => played(page, IDS[1])).toBe(true);
    expect(await played(page, IDS[0])).toBe(false);
    await expect(feed.locator(`iframe[src*="${IDS[0]}"]`)).toHaveCount(0);
    await page.unroute('**/api/v1/social-posts?*');

    // A failed check never resumes playback.
    await page.route('**/api/v1/social-posts?*', route => route.abort());
    await setHidden(page, true);
    await clearCommands(page);
    await setHidden(page, false);
    await expect(feed.getByRole('button', {name: '無法確認影片狀態，重試', exact: true})).toBeVisible();
    await page.waitForTimeout(600);
    expect(await played(page, IDS[1])).toBe(false);
    await page.unroute('**/api/v1/social-posts?*');
    await feed.getByRole('button', {name: '無法確認影片狀態，重試', exact: true}).click();
    await expect(feed.getByRole('button', {name: '暫停', exact: true})).toBeVisible();
    await expect.poll(() => played(page, IDS[1])).toBe(true);

    // A late answer after the viewer has left the page changes nothing.
    let leave!: () => void;
    const slow = new Promise<void>(resolve => { leave = resolve; });
    await page.route('**/api/v1/social-posts?*', async route => { await slow; await route.continue(); });
    await setHidden(page, true);
    await setHidden(page, false);
    await navigate(page, '技能書架');
    await clearCommands(page);
    leave();
    await page.waitForTimeout(600);
    expect(await commands(page)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]);
  }
});

test('existing report, withdraw and hide actions stay reachable from a Short, and removal stops the player', async ({page, e2eAuthPool}) => {
  await recordCommands(page);
  await answerPlayers(page);
  await openShortFeed(page);
  const stamp = Date.now();
  const titles = [`他人的短影音 ${stamp}`, `我的短影音 ${stamp}`];
  const ids = await seed(e2eAuthPool, ['reviewer', 'maker'], titles);
  try {
    const feed = await showFeed(page);
    // Someone else's post: the ordinary report entry is offered, with focus returning to the button afterwards.
    const manage = feed.getByRole('button', {name: '貼文選項與檢舉', exact: true});
    await manage.first().click();
    const sheet = page.getByRole('dialog', {name: '貼文選項與檢舉', exact: true});
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', {name: '檢舉貼文', exact: true})).toBeVisible();
    await expect(sheet.getByText(titles[0])).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(manage.first()).toBeFocused();

    // My own post, in full screen: withdrawing it stops and unmounts its player, and the last video leaves full screen.
    await feed.getByRole('button', {name: '下一支短影音', exact: true}).click();
    await expect(feed.locator('article.short-video-slide').nth(1)).toBeInViewport({ratio: 0.6});
    await e2eAuthPool.query("UPDATE community_social_posts SET state='hidden' WHERE post_id=$1", [ids[0]]);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(feed.locator('article.short-video-slide')).toHaveCount(1);
    await feed.getByRole('button', {name: '全螢幕', exact: true}).click();
    const full = page.getByRole('dialog', {name: '短影音', exact: true});
    await expect(full).toBeVisible();
    await full.getByRole('button', {name: '貼文選項與檢舉', exact: true}).click();
    const mine = page.getByRole('dialog', {name: '貼文選項與檢舉', exact: true});
    await mine.locator('summary[aria-label="貼文選項"]').click();
    await mine.getByRole('button', {name: '刪除', exact: true}).click();
    await page.getByRole('button', {name: '確定刪除', exact: true}).click();
    await expect(page.getByRole('dialog', {name: '短影音', exact: true})).toHaveCount(0);
    await expect(page.getByText('還沒有短影音。', {exact: false})).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    await expect(page.locator('iframe')).toHaveCount(0);
    ids.length = 0;
  } finally {
    if (ids.length) await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]);
    await e2eAuthPool.query('DELETE FROM community_social_posts WHERE title = ANY($1::text[])', [titles]);
  }
});

test('an older refresh answer that arrives after a newer one never brings a withdrawn post back', async ({page, e2eAuthPool}) => {
  await recordCommands(page);
  await answerPlayers(page);
  await openShortFeed(page);
  const stamp = Date.now();
  const titles = [`亂序回應一 ${stamp}`, `亂序回應二 ${stamp}`, `亂序回應三 ${stamp}`];
  const ids = await seed(e2eAuthPool, ['maker', 'maker', 'maker'], titles);
  try {
    const feed = await showFeed(page);
    const slides = feed.locator('article.short-video-slide');
    await expect.poll(() => played(page, IDS[0])).toBe(true);
    // Request A is answered by the server now (the post still exists) but delivered to the page only later.
    let firstSeen = false;
    let deliverOld!: () => Promise<void>;
    const oldAnswerHeld = new Promise<void>(resolve => { deliverOld = async () => resolve(); });
    let oldDelivered!: () => void;
    const oldDone = new Promise<void>(resolve => { oldDelivered = resolve; });
    let snapshotCaptured!: (body: string) => void;
    const captured = new Promise<string>(resolve => { snapshotCaptured = resolve; });
    await page.route('**/api/v1/social-posts?*', async route => {
      if (firstSeen) { await route.continue(); return; }
      firstSeen = true;
      const snapshot = await route.fetch();
      snapshotCaptured(await snapshot.text());
      await oldAnswerHeld;
      await route.fulfill({response: snapshot});
      oldDelivered();
    });
    await setHidden(page, true);
    await setHidden(page, false);
    await expect(feed.getByRole('button', {name: '正在確認影片狀態', exact: true})).toBeVisible();
    // A's snapshot is complete, and it still lists the post, before the withdrawal happens.
    expect(await captured).toContain(titles[0]);
    // The post is withdrawn; a newer refresh (B) completes first and removes it.
    await e2eAuthPool.query("UPDATE community_social_posts SET state='hidden' WHERE post_id=$1", [ids[0]]);
    await setHidden(page, true);
    await setHidden(page, false);
    await expect(slides.filter({hasText: titles[0]})).toHaveCount(0);
    await expect.poll(() => played(page, IDS[1])).toBe(true);
    await clearCommands(page);
    // Now the old answer A is delivered: it must change nothing.
    await deliverOld();
    await oldDone;
    await page.waitForTimeout(800);
    await expect(slides.filter({hasText: titles[0]})).toHaveCount(0);
    await expect(feed.locator(`iframe[src*="${IDS[0]}"]`)).toHaveCount(0);
    expect(await played(page, IDS[0])).toBe(false);
  } finally {
    await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]);
  }
});

test('a feed that mounts while the tab is hidden stays silent until the viewer is back and the list is confirmed', async ({page, e2eAuthPool}) => {
  await recordCommands(page);
  await answerPlayers(page);
  await page.addInitScript(() => {
    Object.defineProperty(document, 'hidden', {configurable: true, get: () => !(window as unknown as {__visible?: boolean}).__visible});
  });
  await openShortFeed(page);
  const stamp = Date.now();
  const ids = await seed(e2eAuthPool, ['maker'], [`背景載入 ${stamp}`]);
  try {
    const feed = await showFeed(page);
    await expect(feed.locator('iframe')).toHaveCount(1);
    await page.waitForTimeout(1000);
    expect(await played(page, IDS[0])).toBe(false);
    await page.evaluate(() => { (window as unknown as {__visible: boolean}).__visible = true; document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => played(page, IDS[0])).toBe(true);
  } finally {
    await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]);
  }
});

test('a report submitted from a Short reaches the existing reporting command for that post', async ({page, e2eAuthPool}) => {
  await recordCommands(page);
  await answerPlayers(page);
  await openShortFeed(page);
  const stamp = Date.now();
  const title = `檢舉送出 ${stamp}`;
  const ids = await seed(e2eAuthPool, ['reviewer'], [title]);
  try {
    const feed = await showFeed(page);
    await feed.getByRole('button', {name: '貼文選項與檢舉', exact: true}).click();
    const sheet = page.getByRole('dialog', {name: '貼文選項與檢舉', exact: true});
    await sheet.getByRole('button', {name: '檢舉貼文', exact: true}).click();
    const report = page.getByRole('dialog', {name: /檢舉/}).last();
    await expect(report).toBeVisible();
    await report.getByLabel('檢舉原因').selectOption('harassment');
    await report.getByRole('button', {name: '送出檢舉', exact: true}).click();
    await expect(report.getByRole('status')).toContainText('已收到檢舉');
    const rows = (await e2eAuthPool.query("SELECT target_kind, target_id FROM member_reports WHERE target_id=$1", [ids[0]])).rows;
    expect(rows).toEqual([{target_kind: 'post', target_id: ids[0]}]);
  } finally {
    await e2eAuthPool.query('DELETE FROM member_reports WHERE target_id = ANY($1::uuid[])', [ids]);
    await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]);
  }
});

test('a platform moderator can hide someone else\'s post from a Short, which stops and unmounts its player', async ({page, e2eAuthPool}) => {
  await recordCommands(page);
  await answerPlayers(page);
  await openShortFeed(page);
  const stamp = Date.now();
  const titles = [`版主隱藏 ${stamp}`, `版主保留 ${stamp}`];
  const maker = (await e2eAuthPool.query('SELECT community_id, user_id, display_name, email_verified_at FROM users WHERE email=$1', ['maker@local.test'])).rows[0];
  const adminId = (await e2eAuthPool.query("INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES(gen_random_uuid(),$1,'maker@local.test',$2) RETURNING admin_id", [maker.community_id, maker.display_name])).rows[0].admin_id;
  await e2eAuthPool.query('UPDATE users SET email_verified_at=COALESCE(email_verified_at, now()) WHERE user_id=$1', [maker.user_id]);
  const ids = await seed(e2eAuthPool, ['reviewer', 'reviewer'], titles);
  try {
    const feed = await showFeed(page);
    const slides = feed.locator('article.short-video-slide');
    await expect(slides).toHaveCount(2);
    await expect.poll(() => played(page, IDS[0])).toBe(true);
    await feed.getByRole('button', {name: '貼文選項與檢舉', exact: true}).first().click();
    const sheet = page.getByRole('dialog', {name: '貼文選項與檢舉', exact: true});
    await sheet.locator('summary[aria-label="貼文選項"]').click();
    await clearCommands(page);
    await sheet.getByRole('button', {name: '隱藏', exact: true}).click();
    await expect(sheet).toHaveCount(0);
    await expect(slides.filter({hasText: titles[0]})).toHaveCount(0);
    await expect(feed.locator(`iframe[src*="${IDS[0]}"]`)).toHaveCount(0);
    expect(await played(page, IDS[0])).toBe(false);
    expect((await e2eAuthPool.query('SELECT state FROM community_social_posts WHERE post_id=$1', [ids[0]])).rows[0].state).toBe('hidden');
    await expect.poll(() => played(page, IDS[1])).toBe(true);
  } finally {
    await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id = ANY($1::uuid[])', [ids]);
    await e2eAuthPool.query('DELETE FROM platform_admins WHERE admin_id=$1', [adminId]);
    await e2eAuthPool.query('UPDATE users SET email_verified_at=$2 WHERE user_id=$1', [maker.user_id, maker.email_verified_at]);
  }
});
