import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {test, expect, type Page} from './fixtures.js';
import {navigate, selectSocialFeed} from './navigation.js';

async function login(page: Page, email = 'maker@local.test') {
  await page.goto('/');
  await page.getByLabel('電子郵件', {exact: true}).fill(email);
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo');
  await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.locator('.shell')).toBeVisible();
  await navigate(page, '社群分享');
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
}
function card(page: Page, text: string) { return page.locator('.social-card').filter({has: page.locator('.social-note').filter({hasText: text})}); }

async function loginCommentAuthor(page: Page, pool: Pool) {
  const id = randomUUID(), email = `comment-race-${id}@example.test`;
  // Each regression owns its publishing quota; never reset the shared maker's posts or limits.
  const inserted = await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
    SELECT $1,community_id,$2,'留言交錯測試會員',password_hash,$3,false FROM users WHERE email='maker@local.test'`, [id, email, randomUUID()]);
  expect(inserted.rowCount).toBe(1);
  await login(page, email);
}

test('the phone homepage starts with member posts and one clear composer, with extra controls out of the wall',async({page,e2eAuthPool})=>{
  await page.setViewportSize({width:390,height:844});await login(page);
  const text=`E2E 清楚的動態牆 ${Date.now()}：分享我的新作品，歡迎一起討論。`;
  await page.getByLabel('貼文內容',{exact:true}).fill(text);await page.getByRole('button',{name:'發布貼文',exact:true}).click();
  const post=card(page,text);await expect(post).toBeVisible();
  const postId=(await post.getAttribute('id'))!.replace('social-post-','');
  const externalTitle=`E2E 外部連結 ${Date.now()}`;
  const inserted=await e2eAuthPool.query(`INSERT INTO community_social_posts(community_id,author_user_id,kind,url,platform,title,note,state)
    SELECT community_id,author_user_id,'link',$2,'other',$3,'外部內容仍可透過動態選項查看。','active'
    FROM community_social_posts WHERE post_id=$1 RETURNING post_id`,[postId,`https://example.com/feed-${postId}`,externalTitle]);
  try{
    await page.goto('/#home');const feed=page.getByRole('region',{name:'首頁社群動態'});
    await expect(feed.locator('.social-zone')).toHaveAttribute('data-feed','note');await expect(card(page,text)).toBeVisible();
    await expect(feed.getByRole('heading',{name:externalTitle,exact:true})).toHaveCount(0);
    await expect(feed.getByRole('combobox')).toHaveCount(0);
    await expect(feed.locator('details.social-composer')).toHaveCount(0);
    await expect(post.locator('.social-platform-badge')).toHaveCount(0);
    await expect(post.getByRole('button',{name:'刪除',exact:true})).toBeHidden();
    const trigger=feed.getByRole('button',{name:'建立貼文',exact:true}),options=feed.getByRole('button',{name:'動態選項',exact:true}),linkEntry=feed.getByRole('button',{name:'分享外部連結',exact:true});
    await expect(trigger).toContainText('想分享什麼？');
    for(const theme of ['light','dark','versefolk'])for(const width of [320,390]){
      await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));
      await expect(trigger).toBeInViewport();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await post.getByRole('button',{name:'讚 · 0',exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({path:`test-results/social-postwall-${theme}-${width}.png`});
    }
    await options.click();await page.keyboard.press('Escape');await expect(options).toBeFocused();
    await selectSocialFeed(page,'全部動態');await expect(feed.getByRole('heading',{name:externalTitle,exact:true})).toBeVisible();
    await selectSocialFeed(page,'社群貼文');await expect(feed.getByRole('heading',{name:externalTitle,exact:true})).toHaveCount(0);
    await linkEntry.click();
    const link=page.getByRole('dialog',{name:'分享外部連結',exact:true});await expect(link.getByLabel('連結',{exact:true})).toBeFocused();
    await link.getByLabel('連結',{exact:true}).fill('https://example.com/unpublished-draft');await page.keyboard.press('Escape');
    await expect(link).toBeHidden();await expect(linkEntry).toBeFocused();
    await linkEntry.click();
    await expect(link.getByLabel('連結',{exact:true})).toHaveValue('https://example.com/unpublished-draft');await page.keyboard.press('Escape');
  }finally{await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id=$1',[inserted.rows[0].post_id]);}
});

test('write a native post, like, comment, remove and reload without duplicate effects', async ({page}) => {
  await login(page);
  const text = `E2E 工坊作品 ${Date.now()}\n想找夥伴一起完成`;
  await page.getByLabel('貼文內容', {exact: true}).fill(text);
  await page.getByRole('button', {name: '發布貼文', exact: true}).click();
  const post = card(page, text);
  await expect(post).toBeVisible();
  await expect(page.getByRole('dialog',{name:'建立貼文',exact:true})).toBeHidden();
  await expect(post.getByRole('link', {name: '開啟原文 ↗'})).toHaveCount(0);
  await post.getByRole('button', {name: '讚 · 0', exact: true}).click();
  await expect(post.getByRole('button', {name: '已讚 · 1', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await post.getByRole('button', {name: '留言 · 0', exact: true}).click();
  await post.getByLabel('寫留言', {exact: true}).fill('<script>window.bad=true</script>\n一起合作');
  await post.getByRole('button', {name: '送出留言', exact: true}).click();
  await expect(post.locator('.social-comment')).toContainText('<script>window.bad=true</script>');
  await expect(post.locator('.social-comment script')).toHaveCount(0);
  await expect(post.getByRole('button', {name: '留言 · 1', exact: true})).toBeVisible();
  await page.screenshot({path: 'test-results/social-feed-desktop.png', fullPage: true});
  await post.getByLabel('留言選項',{exact:true}).click();
  await post.getByRole('button', {name: '刪除留言', exact: true}).click();
  await post.getByRole('button', {name: '確定刪除留言', exact: true}).click();
  await expect(post.getByRole('button', {name: '留言 · 0', exact: true})).toBeVisible();
  await page.reload();
  await expect(card(page, text)).toHaveCount(1);
  await expect(card(page, text).getByRole('button', {name: '已讚 · 1', exact: true})).toBeVisible();
  await card(page, text).getByText('⋯',{exact:true}).click();
  await card(page, text).getByRole('button', {name: '刪除', exact: true}).click();
  await page.getByRole('dialog', {name: '刪除貼文？', exact: true}).getByRole('button', {name: '確定刪除', exact: true}).click();
  await expect(card(page, text)).toHaveCount(0);
});

test('a note publishes with its image, unusable files are refused before upload, and deleting confirms in a dialog', async ({page}) => {
  await login(page);
  const text = `E2E 附圖貼文 ${Date.now()}`;
  const composer = page.getByRole('dialog', {name: '建立貼文', exact: true}), picker = composer.getByLabel('貼文圖片（選填）');
  await composer.getByLabel('貼文內容', {exact: true}).fill(text);
  await picker.setInputFiles({name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(20 * 1024 * 1024 + 1, 1)});
  await expect(composer.getByRole('alert')).toContainText('這張圖片超過 20 MB');
  await picker.setInputFiles({name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a')});
  await expect(composer.getByRole('alert')).toContainText('請選擇 JPEG、PNG 或 WebP 圖片。');
  await expect(composer.getByRole('img', {name: '待發布圖片預覽'})).toHaveCount(0);
  await expect(picker).toHaveValue('');
  const work = {name: 'work.png', mimeType: 'image/png', buffer: await sharp({create: {width: 800, height: 450, channels: 3, background: '#2a6f4b'}}).png().toBuffer()};
  await picker.setInputFiles(work);
  await expect(composer.getByRole('img', {name: '待發布圖片預覽'})).toBeVisible();
  await expect(picker).toHaveValue(/work\.png$/);
  await composer.getByRole('button', {name: '移除圖片', exact: true}).click();
  await expect(composer.getByRole('img', {name: '待發布圖片預覽'})).toHaveCount(0);
  await expect(picker).toHaveValue('');
  await picker.setInputFiles(work);
  await expect(composer.getByRole('img', {name: '待發布圖片預覽'})).toBeVisible();
  await expect(composer.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path: 'test-results/social-compose-image-desktop.png'});
  await composer.getByRole('button', {name: '發布貼文', exact: true}).click();
  const post = card(page, text);
  await expect(post).toBeVisible();
  await expect(composer).toBeHidden();
  await expect(post.locator('img.social-thumb')).toHaveJSProperty('naturalWidth', 640);
  await post.getByText('⋯', {exact: true}).click();
  await expect(post.locator('.social-post-menu-actions')).toBeVisible();
  await expect(post.getByText('加入圖片')).toHaveCount(0);
  await expect(post.getByText('換圖片')).toHaveCount(0);
  await post.getByRole('button', {name: '刪除', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '刪除貼文？', exact: true});
  await expect(dialog).toContainText('刪除後無法復原');
  await expect(dialog.getByRole('button', {name: '取消', exact: true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(post.locator('summary')).toBeFocused();
  await expect(card(page, text)).toHaveCount(1);
  await page.setViewportSize({width: 390, height: 844});
  await post.getByRole('button', {name: '刪除', exact: true}).click();
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.screenshot({path: 'test-results/social-delete-dialog-390.png'});
  await dialog.getByRole('button', {name: '取消', exact: true}).click();
  await expect(dialog).toBeHidden();
  await post.getByRole('button', {name: '刪除', exact: true}).click();
  await dialog.getByRole('button', {name: '確定刪除', exact: true}).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, text)).toHaveCount(0);
  await page.reload();
  await expect(card(page, text)).toHaveCount(0);
});

test('lost publication response keeps the same command and recovers exactly one post', async ({page, e2eAuthPool}) => {
  await login(page);
  const text = `E2E 不確定結果 ${Date.now()}`;
  const keys: string[] = [];
  await page.route('**/api/v1/social-posts/notes', async route => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) { await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByLabel('貼文內容', {exact: true}).fill(text);
  await page.getByRole('button', {name: '發布貼文', exact: true}).click();
  await expect(page.getByRole('button', {name: '重試發布', exact: true})).toBeVisible();
  await expect(page.getByLabel('貼文內容', {exact: true})).toHaveValue(text);
  await expect(page.getByLabel('貼文內容', {exact: true})).toBeDisabled();
  await page.getByRole('button', {name: '重試發布', exact: true}).click();
  await expect(card(page, text)).toHaveCount(1);
  expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_posts WHERE note=$1', [text])).rows[0].n).toBe(1);
});

test('mobile native feed uses readable text, 44px controls and no horizontal overflow', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await login(page);
  const text = `E2E 手機發文 ${Date.now()}\n${Array.from({length:8},(_,index)=>`第 ${index+1} 段：分享作品和合作想法。`).join('\n')}`;
  await page.getByLabel('貼文內容', {exact: true}).fill(text);
  expect(await page.getByLabel('貼文內容').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  expect((await page.getByRole('button',{name:'發布貼文',exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:'test-results/social-publish-mobile.png'});
  await page.getByRole('button', {name: '發布貼文', exact: true}).click();
  const post = card(page, text);
  await expect(post).toBeVisible();
  const expand=post.getByRole('button',{name:'顯示全文',exact:true});
  await expect(expand).toHaveAttribute('aria-expanded','false');
  const summaryHeight=(await post.locator('.social-note').boundingBox())!.height;
  await expand.click();
  await expect(post.getByRole('button',{name:'收合',exact:true})).toHaveAttribute('aria-expanded','true');
  expect((await post.locator('.social-note').boundingBox())!.height).toBeGreaterThan(summaryHeight);
  await post.getByRole('button',{name:'收合',exact:true}).click();
  await expect(expand).toHaveAttribute('aria-expanded','false');
  await post.getByRole('button', {name: '留言 · 0', exact: true}).click();
  await post.getByLabel('寫留言', {exact: true}).fill('手機也能直接留言');
  await post.getByRole('button', {name: '送出留言', exact: true}).click();
  await expect(post.locator('.social-comment')).toContainText('手機也能直接留言');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of [page.getByRole('button', {name: '建立貼文', exact: true}), post.getByRole('button', {name: '讚 · 0', exact: true})]) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path: 'test-results/social-feed-mobile.png', fullPage: true});
});

test('home shows the timeline immediately and the composer keeps a draft when closed',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  const feed=page.getByRole('region',{name:'首頁社群動態'});
  await expect(feed).toBeVisible();
  const trigger=feed.getByRole('button',{name:'建立貼文',exact:true});await expect(trigger).toBeInViewport();
  expect(await feed.locator('xpath=ancestor::details').count()).toBe(0);
  const feedBox=(await feed.boundingBox())!,contextBox=(await page.locator('.home-context').boundingBox())!;
  expect(contextBox.x+contextBox.width).toBeLessThanOrEqual(feedBox.x);
  await trigger.click();const dialog=page.getByRole('dialog',{name:'建立貼文',exact:true});
  await expect(dialog.getByLabel('貼文內容')).toBeFocused();
  const text=`測試貼文 ${Date.now()}：完成 AI 作品，想找設計與行銷夥伴一起合作。`;
  await dialog.getByLabel('貼文內容').fill(text);await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
  await trigger.click();await expect(dialog.getByLabel('貼文內容')).toHaveValue(text);await dialog.getByRole('button',{name:'發布貼文',exact:true}).click();
  await expect(feed.locator('.social-card').filter({hasText:text})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/social-home-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
  await expect(trigger).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/social-home-mobile.png'});
  await page.reload();await expect(feed.locator('.social-card').filter({hasText:text})).toHaveCount(1);
});

test('a failed comment keeps its draft and reuses the command after the server committed', async ({page, e2eAuthPool}) => {
  await login(page);
  const text = `E2E 留言重試 ${Date.now()}`;
  await page.getByLabel('貼文內容').fill(text); await page.getByRole('button', {name: '發布貼文', exact: true}).click();
  const post = card(page, text); await expect(post).toBeVisible();
  await post.getByRole('button', {name: '留言 · 0', exact: true}).click();
  const keys: string[] = [];
  await page.route('**/api/v1/social-posts/*/comments', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) { await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await post.getByLabel('寫留言').fill('重試只留一則'); await post.getByRole('button', {name: '送出留言', exact: true}).click();
  await expect(post.getByRole('button', {name: '重試留言', exact: true})).toBeVisible();
  await expect(post.getByLabel('寫留言')).toHaveValue('重試只留一則');
  await post.getByRole('button', {name: '重試留言', exact: true}).click();
  await expect(post.locator('.social-comment')).toHaveCount(1);
  expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
  expect((await e2eAuthPool.query("SELECT count(*)::int AS n FROM community_social_comments WHERE body='重試只留一則'")).rows[0].n).toBe(1);
});

test('a late publication ACK preserves the newer filter and focus without hiding the saved post',async({page,e2eAuthPool})=>{
  await login(page);
  const text=`E2E 分類切換 ${Date.now()}`;
  let release!:()=>void,committed!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),saved=new Promise<void>(resolve=>committed=resolve);
  await page.route('**/api/v1/social-posts/notes',async route=>{
    const response=await route.fetch();committed();await gate;await route.fulfill({response});
  });
  try{
    await page.getByLabel('貼文內容',{exact:true}).fill(text);
    await page.getByRole('button',{name:'發布貼文',exact:true}).click();await saved;
    await page.getByRole('button',{name:'關閉發文',exact:true}).click();
    const filter=page.getByRole('button',{name:'動態選項',exact:true});
    const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/social-posts'&&new URL(response.url()).searchParams.get('platform')==='youtube'&&response.request().method()==='GET');
    await selectSocialFeed(page,'YouTube');await loaded;
    await expect(page.getByText('正在載入貼文…',{exact:true})).toBeHidden();await filter.focus();
    release();await expect(page.getByText('貼文已發布。',{exact:true})).toBeVisible();
    await expect(page.locator('.social-zone')).toHaveAttribute('data-feed','youtube');await expect(filter).toBeFocused();
    await expect(card(page,text)).toHaveCount(0);
    await selectSocialFeed(page,'社群貼文');await expect(card(page,text)).toHaveCount(1);
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_posts WHERE note=$1',[text])).rows[0].n).toBe(1);

    // An unchanged external filter still switches to the saved native post.
    await selectSocialFeed(page,'YouTube');await page.getByRole('button',{name:'建立貼文',exact:true}).click();
    const next=`E2E 原分類發文 ${Date.now()}`;await page.getByLabel('貼文內容',{exact:true}).fill(next);
    await page.getByRole('button',{name:'發布貼文',exact:true}).click();
    await expect(page.locator('.social-zone')).toHaveAttribute('data-feed','note');await expect(card(page,next)).toHaveCount(1);
    await expect(page.getByRole('button',{name:'建立貼文',exact:true})).toBeFocused();
  }finally{release();}
});

test('sending during the first comment page keeps its snapshot, cursor and one copy of the new comment',async({page,e2eAuthPool})=>{
  await login(page);
  const text=`E2E 留言分頁交錯 ${Date.now()}`;await page.getByLabel('貼文內容',{exact:true}).fill(text);
  await page.getByRole('button',{name:'發布貼文',exact:true}).click();const post=card(page,text);await expect(post).toBeVisible();
  const postId=(await post.getAttribute('id'))!.replace('social-post-','');
  await e2eAuthPool.query(`INSERT INTO community_social_comments(post_id,community_id,author_user_id,body,created_at)
    SELECT p.post_id,p.community_id,p.author_user_id,'既有留言 '||lpad(i::text,2,'0'),now()-interval '1 minute'+i*interval '1 second'
    FROM community_social_posts p CROSS JOIN generate_series(1,26) i WHERE p.post_id=$1`,[postId]);
  await page.getByRole('button',{name:'更新動態',exact:true}).click();
  await expect(post.getByRole('button',{name:'留言 · 26',exact:true})).toBeVisible();
  let release!:()=>void,captured!:()=>void,held=false;
  const gate=new Promise<void>(resolve=>release=resolve),snapshot=new Promise<void>(resolve=>captured=resolve);
  let firstPage:{items:unknown[];next_cursor:string|null}|undefined;
  await page.route(`**/api/v1/social-posts/${postId}/comments*`,async route=>{
    const request=route.request();
    if(request.method()!=='GET'||new URL(request.url()).searchParams.has('cursor')||held)return route.continue();
    held=true;const response=await route.fetch();firstPage=await response.json();captured();await gate;await route.fulfill({response});
  });
  try{
    await post.getByRole('button',{name:'留言 · 26',exact:true}).click();await snapshot;
    expect(firstPage!.items).toHaveLength(24);expect(firstPage!.next_cursor).toBeTruthy();
    await post.getByLabel('寫留言',{exact:true}).fill('新留言必須和既有內容一起保留');
    await post.getByRole('button',{name:'送出留言',exact:true}).click();
    await expect(post.getByRole('button',{name:'留言 · 27',exact:true})).toBeVisible();
    await expect(post.locator('.social-comment')).toHaveCount(1);
    release();await expect(post.locator('.social-comment')).toHaveCount(25);
    await expect(post.getByText('既有留言 01',{exact:true})).toBeVisible();
    await post.getByRole('button',{name:'載入更多留言',exact:true}).click();
    await expect(post.locator('.social-comment')).toHaveCount(27);
    await expect(post.getByText('既有留言 26',{exact:true})).toBeVisible();
    await expect(post.getByText('新留言必須和既有內容一起保留',{exact:true})).toHaveCount(1);
    await expect(post.getByRole('button',{name:'載入更多留言',exact:true})).toHaveCount(0);
    expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_comments WHERE post_id=$1',[postId])).rows[0].n).toBe(27);
  }finally{release();}
});

for (const {action, target} of [{action: 'edit', target: 1}, {action: 'delete', target: 1}, {action: 'edit', target: 26}] as const) test(`a delayed comment refresh cannot undo a confirmed ${action} of comment ${target} or reset pagination`, async ({page, e2eAuthPool}) => {
  await loginCommentAuthor(page, e2eAuthPool);
  const text = `E2E 留言更新交錯 ${action} ${target} ${Date.now()}`;
  await page.getByLabel('貼文內容', {exact: true}).fill(text);
  await page.getByRole('button', {name: '發布貼文', exact: true}).click();
  const post = card(page, text); await expect(post).toBeVisible();
  const postId = (await post.getAttribute('id'))!.replace('social-post-', '');
  await e2eAuthPool.query(`INSERT INTO community_social_comments(post_id,community_id,author_user_id,body,created_at)
    SELECT p.post_id,p.community_id,p.author_user_id,'更新前留言 '||lpad(i::text,2,'0'),now()-interval '2 days'+i*interval '1 second'
    FROM community_social_posts p CROSS JOIN generate_series(1,26) i WHERE p.post_id=$1`, [postId]);
  await page.getByRole('button', {name: '更新動態', exact: true}).click();
  const toggle = post.getByRole('button', {name: /^留言 · /});
  await expect(toggle).toHaveText('留言 · 26'); await toggle.click();
  await expect(post.locator('.social-comment')).toHaveCount(24);
  if (target === 26) {
    await post.getByRole('button', {name: '載入更多留言', exact: true}).click();
    await expect(post.locator('.social-comment')).toHaveCount(26);
  }
  const originalBody = `更新前留言 ${String(target).padStart(2, '0')}`;
  const targetId = (await e2eAuthPool.query('SELECT comment_id FROM community_social_comments WHERE post_id=$1 AND body=$2', [postId, originalBody])).rows[0].comment_id;
  await post.getByLabel('寫留言', {exact: true}).fill('尚未送出的草稿不能改變');
  await toggle.click();

  let release!: () => void, captured!: () => void, held = false;
  const gate = new Promise<void>(resolve => release = resolve), snapshot = new Promise<void>(resolve => captured = resolve);
  let firstPage: {items: {comment_id: string; body: string}[]; next_cursor: string | null} | undefined;
  const requestedCursors: (string | null)[] = [];
  await page.route(`**/api/v1/social-posts/${postId}/comments*`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const cursor = new URL(route.request().url()).searchParams.get('cursor'); requestedCursors.push(cursor);
    if (cursor || held) return route.continue();
    held = true; const response = await route.fetch(); firstPage = await response.json(); captured();
    await gate; await route.fulfill({response});
  });
  try {
    await toggle.click(); await snapshot;
    expect(firstPage!.items).toHaveLength(24); expect(firstPage!.next_cursor).toBeTruthy();
    expect(firstPage!.items[0].body).toBe('更新前留言 01');
    const comment = post.locator('.social-comment').filter({hasText: originalBody});
    await comment.getByLabel('留言選項', {exact: true}).click();
    if (action === 'edit') {
      await comment.getByRole('button', {name: '編輯留言', exact: true}).click();
      // Editing replaces the original body. Locate the one active editor, not its old text.
      await post.getByLabel('編輯留言', {exact: true}).fill('已確認的新版留言');
      await post.getByRole('button', {name: '儲存留言', exact: true}).click();
      await expect(post.getByText('已確認的新版留言', {exact: true})).toBeVisible();
    } else {
      await comment.getByRole('button', {name: '刪除留言', exact: true}).click();
      await comment.getByRole('button', {name: '確定刪除留言', exact: true}).click();
      await expect(comment).toHaveCount(0);
    }
    const count = action === 'edit' ? 26 : 25;
    await expect(toggle).toHaveText(`留言 · ${count}`);
    release(); await expect(post.getByText('正在載入留言…', {exact: true})).toHaveCount(0);
    await expect(post.getByText(originalBody, {exact: true})).toHaveCount(0);
    await expect(post.locator('.social-comment')).toHaveCount(target === 26 ? 25 : count - 2);
    if (action === 'edit') await expect(post.getByText('已確認的新版留言', {exact: true})).toHaveCount(1);
    await expect(post.getByText('更新前留言 24', {exact: true})).toBeVisible();
    await post.getByRole('button', {name: '載入更多留言', exact: true}).click();
    await expect(post.locator('.social-comment')).toHaveCount(count);
    expect(requestedCursors).toEqual([null, firstPage!.next_cursor]);
    await expect(post.getByRole('button', {name: '載入更多留言', exact: true})).toHaveCount(0);
    await expect(toggle).toHaveText(`留言 · ${count}`);
    await expect(post.getByLabel('寫留言', {exact: true})).toHaveValue('尚未送出的草稿不能改變');
    const row = (await e2eAuthPool.query('SELECT body,state FROM community_social_comments WHERE comment_id=$1', [targetId])).rows[0];
    expect(row).toEqual(action === 'edit' ? {body: '已確認的新版留言', state: 'active'} : {body: originalBody, state: 'deleted'});
    // A new read after the ACK must still accept later authoritative changes.
    if (action === 'edit') await e2eAuthPool.query('UPDATE community_social_comments SET body=$2,edit_revision=edit_revision+1 WHERE comment_id=$1', [targetId, '其他分頁更新的留言']);
    await toggle.click(); await toggle.click();
    await expect(post.getByText('正在載入留言…', {exact: true})).toHaveCount(0);
    await expect(post.getByText(originalBody, {exact: true})).toHaveCount(0);
    if (target === 26) await post.getByRole('button', {name: '載入更多留言', exact: true}).click();
    if (action === 'edit') {
      await expect(post.getByText('其他分頁更新的留言', {exact: true})).toHaveCount(1);
      await expect(post.getByText('已確認的新版留言', {exact: true})).toHaveCount(0);
    }
  } finally { release(); }
});

test('a comment read that captures a newer server revision does not roll back to an earlier local ACK', async ({page, e2eAuthPool}) => {
  await loginCommentAuthor(page, e2eAuthPool);
  const text = `E2E 留言新版回應 ${Date.now()}`;
  await page.getByLabel('貼文內容', {exact: true}).fill(text);
  await page.getByRole('button', {name: '發布貼文', exact: true}).click();
  const post = card(page, text); await expect(post).toBeVisible();
  const postId = (await post.getAttribute('id'))!.replace('social-post-', '');
  const toggle = post.getByRole('button', {name: /^留言 · /}); await toggle.click();
  await post.getByLabel('寫留言', {exact: true}).fill('原始留言');
  await post.getByRole('button', {name: '送出留言', exact: true}).click();
  await expect(post.getByText('原始留言', {exact: true})).toBeVisible(); await toggle.click();
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => release = resolve), started = new Promise<void>(resolve => requested = resolve);
  await page.route(`**/api/v1/social-posts/${postId}/comments`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    requested(); await gate;
    // The request started first, but its database snapshot is taken after both edits.
    const response = await route.fetch(); await route.fulfill({response});
  });
  try {
    await toggle.click(); await started;
    const comment = post.locator('.social-comment'); await comment.getByLabel('留言選項', {exact: true}).click();
    await comment.getByRole('button', {name: '編輯留言', exact: true}).click();
    await comment.getByLabel('編輯留言', {exact: true}).fill('本頁已確認的修改');
    await comment.getByRole('button', {name: '儲存留言', exact: true}).click();
    await expect(post.getByText('本頁已確認的修改', {exact: true})).toBeVisible();
    await e2eAuthPool.query('UPDATE community_social_comments SET body=$2,edit_revision=edit_revision+1 WHERE post_id=$1', [postId, '伺服器的更新版本']);
    release();
    await expect(post.getByText('伺服器的更新版本', {exact: true})).toBeVisible();
    await expect(post.getByText('本頁已確認的修改', {exact: true})).toHaveCount(0);
    await expect(post.locator('.social-comment')).toHaveCount(1);
    await expect(toggle).toHaveText('留言 · 1');
  } finally { release(); }
});

test('a failed comment read does not claim there are no comments and can retry without losing the draft', async ({page, e2eAuthPool}) => {
  await loginCommentAuthor(page, e2eAuthPool);
  const text = `E2E 留言讀取失敗 ${Date.now()}`;
  await page.getByLabel('貼文內容', {exact: true}).fill(text);
  await page.getByRole('button', {name: '發布貼文', exact: true}).click();
  const post = card(page, text); await expect(post).toBeVisible();
  const postId = (await post.getAttribute('id'))!.replace('social-post-', '');
  let reads = 0;
  await page.route(`**/api/v1/social-posts/${postId}/comments`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    if (++reads === 1) return route.fulfill({status: 503, contentType: 'application/problem+json', body: JSON.stringify({detail: '留言讀取暫時失敗'})});
    await route.continue();
  });
  await post.getByRole('button', {name: '留言 · 0', exact: true}).click();
  await expect(post.getByRole('alert')).toBeVisible();
  await expect(post.getByText('還沒有留言，聊聊你的想法。', {exact: true})).toHaveCount(0);
  await post.getByLabel('寫留言', {exact: true}).fill('讀取失敗也保留這份草稿');
  await post.getByRole('button', {name: '重新載入留言', exact: true}).click();
  await expect(post.getByRole('alert')).toHaveCount(0);
  await expect(post.getByText('還沒有留言，聊聊你的想法。', {exact: true})).toBeVisible();
  await expect(post.getByLabel('寫留言', {exact: true})).toHaveValue('讀取失敗也保留這份草稿');
  expect(reads).toBe(2);
});

test('an author edits a post and a comment in place; the feed marks both as edited (#399)',async({page})=>{
  await login(page);
  const text=`E2E 編輯前 ${Date.now()}`;
  await page.getByLabel('貼文內容',{exact:true}).fill(text);await page.getByRole('button',{name:'發布貼文',exact:true}).click();
  const post=card(page,text);await expect(post).toBeVisible();
  await post.getByRole('button',{name:'讚 · 0',exact:true}).click();
  await post.getByRole('button',{name:/^留言/}).click();
  await post.getByLabel('寫留言',{exact:true}).fill('第一版留言');await post.getByRole('button',{name:'送出留言',exact:true}).click();
  await expect(post.locator('.social-comment')).toContainText('第一版留言');

  const menu=post.getByLabel('貼文選項',{exact:true});await menu.click();
  await post.getByRole('button',{name:'編輯',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'編輯貼文'});await expect(dialog).toBeVisible();
  const save=dialog.getByRole('button',{name:'儲存變更',exact:true});await expect(save).toBeDisabled();
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(menu).toBeFocused();
  await menu.click();await post.getByRole('button',{name:'編輯',exact:true}).click();
  const edited=`${text} 已修正錯字`;
  await dialog.getByLabel('貼文內容',{exact:true}).fill(edited);await save.click();
  await expect(dialog).toBeHidden();
  const updated=card(page,edited);
  await expect(updated.locator('.social-note')).toHaveText(edited);
  await expect(updated.locator('.social-byline .social-edited')).toHaveText('已編輯');
  await expect(updated.getByRole('button',{name:/^已讚 · 1$/})).toBeVisible();
  await expect(updated.getByRole('button',{name:/^留言 · 1$/})).toBeVisible();

  await updated.getByLabel('留言選項',{exact:true}).click();
  await updated.getByRole('button',{name:'編輯留言',exact:true}).click();
  await updated.getByLabel('編輯留言',{exact:true}).fill('第二版留言');await updated.getByRole('button',{name:'儲存留言',exact:true}).click();
  const comment=updated.locator('.social-comment');
  await expect(comment.locator('p')).toHaveText('第二版留言');await expect(comment.locator('.social-edited')).toHaveText('已編輯');
  await updated.screenshot({path:'test-results/social-post-edit-card.png'});

  await page.reload();await navigate(page,'社群分享');
  const reloaded=card(page,edited);await expect(reloaded).toBeVisible();await expect(reloaded.locator('.social-byline .social-edited')).toBeVisible();

  await page.setViewportSize({width:390,height:844});
  await reloaded.getByLabel('貼文選項',{exact:true}).click();await reloaded.getByRole('button',{name:'編輯',exact:true}).click();
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:'test-results/social-post-edit-390.png'});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await expect(dialog).toBeHidden();
});

test('visible feed categories keep keyboard focus and drafts while failed reads retry the selected query',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:320,height:844});await login(page);
  const draft='保留原生草稿，不因閱讀分類或分享連結而發布';
  await page.getByLabel('貼文內容',{exact:true}).fill(draft);await page.keyboard.press('Escape');
  const feed=page.locator('.social-zone'),categories=feed.getByRole('group',{name:'動態分類',exact:true});
  const notes=categories.getByRole('button',{name:'社群貼文',exact:true}),all=categories.getByRole('button',{name:'全部動態',exact:true});
  await expect(feed).toHaveAttribute('aria-busy','false');await expect(notes).toHaveAttribute('aria-pressed','true');
  const queries:string[]=[],writes:string[]=[];let failNext=true;
  page.on('request',request=>{if(request.method()==='POST'&&['/api/v1/social-posts','/api/v1/social-posts/notes'].includes(new URL(request.url()).pathname))writes.push(request.url());});
  await page.route('**/api/v1/social-posts*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=='GET'||url.pathname!=='/api/v1/social-posts'){await route.continue();return;}
    queries.push(url.search);
    if(failNext&&!url.searchParams.has('kind')&&!url.searchParams.has('platform')){failNext=false;await route.fulfill({status:503,contentType:'application/problem+json',body:JSON.stringify({title:'Service unavailable',status:503,detail:'分類讀取測試失敗，請重試。'})});return;}
    await route.continue();
  });
  await notes.focus();await page.keyboard.press('Space');await expect(notes).toBeFocused();expect(queries).toEqual([]);
  await all.focus();await page.keyboard.press('Enter');
  await expect(all).toBeFocused();await expect(all).toHaveAttribute('aria-pressed','true');await expect(notes).toHaveAttribute('aria-pressed','false');
  await expect(feed.getByRole('alert')).toContainText('服務暫時無法回應（503）。請稍後重試。');
  await expect(feed.getByRole('alert')).not.toContainText('分類讀取測試失敗');
  await feed.getByRole('alert').getByRole('button',{name:'重試',exact:true}).click();
  await expect(feed.getByRole('alert')).toHaveCount(0);await expect(feed).toHaveAttribute('aria-busy','false');
  expect(queries).toEqual(['','']);await expect(all).toHaveAttribute('aria-pressed','true');
  await notes.focus();await page.keyboard.press('Enter');await expect(feed).toHaveAttribute('aria-busy','false');
  await expect(notes).toBeFocused();await expect(notes).toHaveAttribute('aria-pressed','true');expect(queries.at(-1)).toBe('?kind=note');
  const linkEntry=feed.locator('.social-composer-start').getByRole('button',{name:'分享外部連結',exact:true});
  await linkEntry.focus();await page.keyboard.press('Enter');
  const link=page.getByRole('dialog',{name:'分享外部連結',exact:true});
  await expect(link.getByLabel('連結',{exact:true})).toBeFocused();await link.getByLabel('連結',{exact:true}).fill('https://example.com/retained-link');
  await page.keyboard.press('Escape');await expect(linkEntry).toBeFocused();
  await feed.getByRole('button',{name:'建立貼文',exact:true}).click();await expect(page.getByLabel('貼文內容',{exact:true})).toHaveValue(draft);await page.keyboard.press('Escape');
  await linkEntry.click();await expect(link.getByLabel('連結',{exact:true})).toHaveValue('https://example.com/retained-link');await page.keyboard.press('Escape');
  expect(writes).toEqual([]);
  await page.unrouteAll({behavior:'wait'});
});

test('a delayed all-posts response cannot replace a newer direct category selection',async({page,e2eAuthPool})=>{
  await login(page);await page.keyboard.press('Escape');
  const feed=page.locator('.social-zone'),categories=feed.getByRole('group',{name:'動態分類',exact:true});
  await expect(feed).toHaveAttribute('aria-busy','false');
  const lateTitle=`E2E 晚到外連 ${Date.now()}`;
  const inserted=await e2eAuthPool.query(`INSERT INTO community_social_posts(community_id,author_user_id,kind,url,platform,title,state) SELECT community_id,user_id,'link',$1,'other',$2,'active' FROM users WHERE email='maker@local.test' RETURNING post_id`,[`https://example.com/late-feed-${Date.now()}`,lateTitle]);
  const lateId=inserted.rows[0].post_id as string;
  // Observe the application's actual response-body consumption, then let React paint;
  // route.fulfill alone does not establish that a stale response was handled.
  await page.evaluate(()=>{
    const state=window as unknown as {lateFeedReadPainted?:boolean};state.lateFeedReadPainted=false;
    const read=Response.prototype.text;
    Response.prototype.text=async function(){
      const value=await read.call(this);
      if(this.url===new URL('/api/v1/social-posts',location.href).href)requestAnimationFrame(()=>requestAnimationFrame(()=>{state.lateFeedReadPainted=true;}));
      return value;
    };
  });
  let release!:()=>void,held!:(error?:unknown)=>void,finished!:(error?:unknown)=>void;
  const gate=new Promise<void>(resolve=>release=resolve),waiting=new Promise<unknown>(resolve=>held=resolve),done=new Promise<unknown>(resolve=>finished=resolve);
  await page.route('**/api/v1/social-posts',async route=>{
    try{const response=await route.fetch();expect((await response.json()).items.some((post:{post_id:string})=>post.post_id===lateId)).toBe(true);held();await gate;await route.fulfill({response});finished();}
    catch(error){held(error);finished(error);}
  });
  try{
    await categories.getByRole('button',{name:'全部動態',exact:true}).click();expect(await waiting).toBeUndefined();
    const notes=categories.getByRole('button',{name:'社群貼文',exact:true});await notes.focus();await page.keyboard.press('Enter');
    await expect(feed).toHaveAttribute('data-feed','note');await expect(feed).toHaveAttribute('aria-busy','false');
    const visibleIds=await feed.locator('.social-card').evaluateAll(cards=>cards.map(card=>card.id));
    release();expect(await done).toBeUndefined();await page.waitForFunction(()=>(window as unknown as {lateFeedReadPainted?:boolean}).lateFeedReadPainted===true);
    await expect(notes).toHaveAttribute('aria-pressed','true');await expect(notes).toBeFocused();
    expect(await feed.locator('.social-card').evaluateAll(cards=>cards.map(card=>card.id))).toEqual(visibleIds);
    await expect(feed).toHaveAttribute('data-feed','note');await expect(feed.getByRole('heading',{name:lateTitle,exact:true})).toHaveCount(0);
  }finally{release();await page.unrouteAll({behavior:'wait'});await e2eAuthPool.query('DELETE FROM community_social_posts WHERE post_id=$1',[lateId]);}
});

for(const language of [
  {id:'zh-Hant',name:'繁體中文',note:'社群貼文',all:'全部動態',group:'動態分類',link:'分享外部連結',options:'動態選項'},
  {id:'en',name:'English',note:'Community posts',all:'All posts',group:'Feed categories',link:'Share an external link',options:'Feed options'},
  {id:'ja',name:'日本語',note:'コミュニティ投稿',all:'すべての投稿',group:'フィードの分類',link:'外部リンクを共有',options:'フィード設定'},
  {id:'ko',name:'한국어',note:'커뮤니티 게시물',all:'모든 게시물',group:'피드 분류',link:'외부 링크 공유',options:'피드 옵션'},
  {id:'es',name:'Español',note:'Comunidad',all:'Todas las publicaciones',group:'Categorías del feed',link:'Compartir un enlace externo',options:'Opciones del feed'},
])test(`${language.id}: feed entry labels fit narrow screens and retain accessible selection`,async({page})=>{
  await login(page);await page.keyboard.press('Escape');
  await page.locator('.settings-menu-button').click();await page.getByRole('menuitemradio',{name:language.name,exact:true}).click();await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('lang',language.id);
  const feed=page.locator('.social-zone'),categories=feed.getByRole('group',{name:language.group,exact:true}),linkEntry=feed.locator('.social-composer-start').getByRole('button',{name:language.link,exact:true});
  const notes=categories.getByRole('button',{name:language.note,exact:true}),all=categories.getByRole('button',{name:language.all,exact:true});
  await expect(notes).toHaveAttribute('aria-pressed','true');await expect(all).toHaveAttribute('aria-pressed','false');
  expect(await feed.evaluate(element=>{const composer=element.querySelector('.social-composer-start')!,categories=element.querySelector('.social-feed-navigation')!,cards=element.querySelector('.social-grid')!;return Boolean(composer.compareDocumentPosition(categories)&Node.DOCUMENT_POSITION_FOLLOWING)&&Boolean(categories.compareDocumentPosition(cards)&Node.DOCUMENT_POSITION_FOLLOWING);})).toBe(true);
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:900});
    for(const control of [notes,all,linkEntry,feed.getByRole('button',{name:language.options,exact:true})]){
      await expect(control).toBeVisible();const box=(await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const options=feed.getByRole('button',{name:language.options,exact:true});await options.click();
  const dialog=page.getByRole('dialog',{name:language.options,exact:true});await expect(dialog.getByRole('button',{name:language.note,exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(dialog.getByRole('button',{name:language.link,exact:true})).toHaveCount(0);await page.keyboard.press('Escape');await expect(options).toBeFocused();
  await linkEntry.click();await expect(page.getByRole('dialog',{name:language.link,exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(linkEntry).toBeFocused();
});
