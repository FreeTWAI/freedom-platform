import {test,expect,type Page} from './fixtures';
import {navigate,openHomeGuide,openFeatureSearch,setHomeViewport} from './navigation';
async function login(page:Page){
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/login'&&r.request().method()==='POST',{timeout:25_000});
  await page.getByRole('button',{name:'登入',exact:true}).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('.home-timeline')).toBeVisible();
}

test('home and global navigation reach the same supply catalog and preserve history on a phone',async({page})=>{
  await page.setViewportSize({width:390,height:844});await login(page);
  await openHomeGuide(page);
  await page.locator('.home-destinations').getByRole('button',{name:'我的供貨商品庫 管理商品與合作條件',exact:true}).click();
  await expect(page).toHaveURL(/#stores\/supply$/);
  await expect(page.getByRole('heading',{name:'我的供貨商品庫',level:1,exact:true})).toBeVisible();
  await navigate(page,'我的商店');await expect(page).toHaveURL(/#stores$/);
  const navigation=page.getByRole('navigation',{name:'主要工作區'});
  await page.getByRole('button',{name:'開啟選單',exact:true}).click();await expect(navigation).toBeVisible();
  await page.goBack();await expect(page).toHaveURL(/#stores\/supply$/);
  await expect(navigation).toBeHidden();await expect(page.locator('#main-content')).toBeFocused();
  await page.getByRole('button',{name:'開啟選單',exact:true}).click();await expect(navigation).toBeVisible();
  await page.goForward();await expect(page).toHaveURL(/#stores$/);
  await expect(navigation).toBeHidden();await expect(page.locator('#main-content')).toBeFocused();
  await page.goBack();await expect(page).toHaveURL(/#stores\/supply$/);
  await page.reload();await expect(page.getByRole('heading',{name:'我的供貨商品庫',level:1,exact:true})).toBeVisible();
  await navigate(page,'我的供貨商品庫');
  await expect(page.getByRole('navigation',{name:'主要工作區'})).toBeHidden();
  await expect(page.locator('#main-content')).toBeFocused();
  await navigate(page,'我的內容');await expect(page).toHaveURL(/#my-content$/);
  await expect(page.getByRole('heading',{name:'草稿與已發布內容',exact:true})).toBeVisible();
  // Old feed links and feature search continue to reach their existing destination.
  await navigate(page,'社群分享');await expect(page).toHaveURL(/#social$/);
});

test('disabled content and catalog capabilities do not advertise their entry points',async({page})=>{
  await page.route('**/api/v1/site',async route=>{
    const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),personal_content_enabled:false,guild_launchpad_enabled:false}});
  });
  await login(page);await openHomeGuide(page);
  await expect(page.locator('.home-destinations').getByRole('button',{name:/我的供貨商品庫|我的商店/})).toHaveCount(0);
  await expect(page.locator('.nav-primary').getByRole('button',{name:'我的內容',exact:true})).toHaveCount(0);
  await openFeatureSearch(page);await page.getByLabel('搜尋功能').fill('我的內容');
  await expect(page.getByRole('navigation',{name:'主要工作區'}).getByRole('button',{name:'我的內容',exact:true})).toHaveCount(0);
});

test('member hierarchy keeps one feed, distinct destinations and readable controls in each theme and viewport',async({page,e2eAuthPool},testInfo)=>{
  await page.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
  await login(page);
  await expect(page.locator('.home-next-step')).toBeAttached();
  const createdPosts:{id:string;text:string}[]=[];
  let primaryError:unknown;
  try {
  for (const text of [
    '合成示範｜把開源筆記工具整理成可分享的作品。這週補上用途、授權與操作畫面，讓第一次看到的人知道如何試用。',
    '合成示範｜週末一起交流商品攝影。想練習的人可以先整理自己的商品照片；正式活動資訊以活動頁為準。',
  ]) {
    await page.getByRole('button',{name:'建立貼文',exact:true}).click();
    const composer=page.getByRole('dialog',{name:'建立貼文',exact:true});
    await composer.getByLabel('貼文內容',{exact:true}).fill(text);
    const [response]=await Promise.all([
      page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/social-posts/notes'&&r.request().method()==='POST',{timeout:25_000}),
      composer.getByRole('button',{name:'發布貼文',exact:true}).click(),
    ]);
    expect(response.status(),await response.text()).toBe(201);
    const created=await response.json();
    expect(created.post_id).toMatch(/^[0-9a-f-]{36}$/);
    createdPosts.push({id:created.post_id,text});
    await expect(composer).not.toBeVisible();
    await expect(page.getByText(text,{exact:true})).toBeVisible();
  }

  for(const theme of ['light','dark','versefolk'])for(const width of [390,768,1440]){
    await setHomeViewport(page,{width,height:width===1440?900:844});
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;document.documentElement.dataset.experienceProfile=value;window.dispatchEvent(new Event('freedom-theme-changed'));},theme);
    await expect(page.locator('.home-timeline')).toBeVisible();
    await openHomeGuide(page);
    const destinations=page.locator('.home-destinations');
    await expect(destinations.getByRole('heading')).toHaveText(['商品與供貨','作品與活動']);
    await expect(destinations.getByRole('button')).toHaveCount(4);
    await expect(page.locator('.platform-purpose--member,.home-module-card')).toHaveCount(0);
    for(const button of await destinations.getByRole('button').all())expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    // The guide click scrolls on phones; capture the sticky header at the actual page top.
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    const header=await page.locator('.community-header').boundingBox();
    const title=await page.locator('.workspace-topbar').boundingBox();
    expect(header!.y).toBeGreaterThanOrEqual(0);
    expect(header!.y+header!.height).toBeLessThanOrEqual(title!.y);
    await page.screenshot({path:testInfo.outputPath(`home-${theme}-${width}.png`),fullPage:true});
    await openFeatureSearch(page);
    await expect(page.locator('.nav-primary > button')).toHaveText(['會員首頁','我的個人空間','職業公會','技能書架','搜尋社群內容']);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:testInfo.outputPath(`navigation-${theme}-${width}.png`)});
    await page.keyboard.press('Escape');
    const close=page.getByRole('button',{name:'關閉選單',exact:true});if(await close.isVisible())await close.click();
  }
  } catch(error) { primaryError=error; throw error; } finally {
    const cleanupErrors:unknown[]=[];
    // Text-only rows owned by this case, inside the run-specific E2E schema.
    // Soft deletion still consumes the shared author's daily post allowance.
    for(const post of createdPosts){
      try {
      const removed=await e2eAuthPool.query(`DELETE FROM community_social_posts
        WHERE post_id=$1 AND kind='note' AND note=$2
          AND author_user_id=(SELECT user_id FROM users WHERE email='maker@local.test')
        RETURNING post_id`,[post.id,post.text]);
      expect(removed.rowCount).toBe(1);
      } catch(error) { cleanupErrors.push(error); }
    }
    if(cleanupErrors.length)throw new AggregateError(primaryError?[primaryError,...cleanupErrors]:cleanupErrors,
      'Member hierarchy fixture cleanup failed');
  }
});

for(const viewport of [{width:320,height:640},{width:390,height:844},{width:844,height:390}])test(`mobile navigation fits the measured header and visible viewport at ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);await login(page);
  const navigation=page.getByRole('navigation',{name:'主要工作區'});
  for(const fontSize of ['16px','32px']){
    await page.evaluate(value=>document.documentElement.style.fontSize=value,fontSize);
    await page.getByRole('button',{name:'開啟選單',exact:true}).click();
    await expect(navigation).toBeVisible();
    await expect(navigation.locator('.nav-primary [aria-current]')).toBeFocused();
    await expect.poll(async()=>{
      const header=(await page.locator('.community-header').boundingBox())!;
      const panel=(await navigation.boundingBox())!;
      return Math.abs(panel.y-(header.y+header.height));
    }).toBeLessThanOrEqual(1);
    const panel=(await navigation.boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(viewport.width);
    expect(panel.y+panel.height).toBeLessThanOrEqual(viewport.height+1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await navigation.locator('.nav-more > summary').click();
    await expect(navigation.getByRole('searchbox')).toBeFocused();
    await page.keyboard.press('Escape');await expect(navigation.locator('.nav-more > summary')).toBeFocused();
    await expect(navigation).toBeVisible();
    await page.keyboard.press('Escape');await expect(navigation).toBeHidden();
    await expect(page.getByRole('button',{name:'開啟選單',exact:true})).toBeFocused();
  }
  await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
  await page.getByRole('button',{name:'開啟選單',exact:true}).click();
  await navigation.getByRole('button',{name:'收合導覽',exact:true}).click();
  await expect(navigation).toBeHidden();await expect(page.getByRole('button',{name:'開啟選單',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'開啟選單',exact:true}).click();
  const beforeDismiss=page.url();
  await page.locator('.mobile-nav-backdrop').click({position:{x:2,y:2}});
  await expect(navigation).toBeHidden();await expect(page.getByRole('button',{name:'開啟選單',exact:true})).toBeFocused();
  expect(page.url()).toBe(beforeDismiss);
  await page.getByRole('button',{name:'開啟選單',exact:true}).click();
  await page.getByRole('button',{name:'設定',exact:true}).focus();
  await expect(navigation).toBeHidden();await expect(page.getByRole('button',{name:'設定',exact:true})).toBeFocused();
});

test('personal space is the only account content entry and legacy management returns there',async({page})=>{
  await page.setViewportSize({width:390,height:844});await login(page);
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:'我的內容',exact:true})).toHaveCount(0);
  await page.getByRole('menuitem',{name:'我的個人空間',exact:true}).click();
  await expect(page).toHaveURL(/#profile$/);
  await expect(page.locator('.personal-space-content')).toBeVisible();
  await page.getByRole('link',{name:'管理草稿與發布',exact:true}).click();
  await expect(page).toHaveURL(/#my-content$/);
  await page.reload();await expect(page.getByRole('heading',{name:'草稿與已發布內容',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'返回我的個人空間',exact:true}).click();await expect(page).toHaveURL(/#profile$/);
  await page.goBack();await expect(page).toHaveURL(/#my-content$/);
});

test('creation navigation keeps three task choices and all child routes discoverable on a phone',async({page})=>{
  await page.setViewportSize({width:390,height:844});await login(page);
  await navigate(page,'作品與合作');
  await expect(page.getByRole('heading',{name:'作品與合作',level:1,exact:true})).toBeVisible();
  const links=page.getByRole('navigation',{name:'作品與合作',exact:true});
  await links.getByRole('link',{name:'投稿開源工具',exact:true}).click();await expect(page).toHaveURL(/#opensource$/);
  await expect(page.getByRole('heading',{name:'開源投稿',level:1,exact:true})).toBeVisible();
  await links.getByRole('link',{name:'合作紀錄',exact:true}).click();await expect(page).toHaveURL(/#engagement$/);
  await expect(page.getByRole('heading',{name:'合作紀錄',level:1,exact:true})).toBeVisible();
  await openFeatureSearch(page);
  const group=page.getByRole('navigation',{name:'主要工作區'}).locator('.nav-more-content > .nav-section').filter({has:page.locator('summary').filter({hasText:/^創作與合作(?:⌄)?$/})});
  await expect(group).toHaveCount(1);
  await expect(group.locator('.nav-section-items > button')).toHaveText(['任務協作','作品與合作','私人 AI 工作室']);
  await expect(group.getByRole('button',{name:'作品與合作',exact:true})).toHaveAttribute('aria-current','page');
  // Old member vocabulary remains searchable even though the main group is simpler.
  await page.getByLabel('搜尋功能').fill('我的工作');
  await page.getByRole('navigation',{name:'主要工作區'}).getByRole('button',{name:'任務協作',exact:true}).click();
  await expect(page).toHaveURL(/#workbench$/);await expect(page.getByRole('heading',{name:'任務協作',level:1,exact:true})).toBeVisible();
  await navigate(page,'私人 AI 工作室');await expect(page).toHaveURL(/#private-ai$/);
  await expect(page.getByRole('heading',{name:'私人 AI 工作室',level:1,exact:true})).toBeVisible();
  await expect(links).toHaveCount(0);
  await page.goBack();await expect(page).toHaveURL(/#workbench$/);
});
