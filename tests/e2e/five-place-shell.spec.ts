import {test,expect} from './fixtures';
test('five places preserve aliases, browser history and the existing share composer',async({page})=>{
 await page.goto('/');
 await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
 await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
 await page.getByRole('button',{name:'登入',exact:true}).click();
 await expect(page.locator('.home-timeline')).toBeVisible();
 await expect(page.locator('.nav-primary button')).toHaveText(['動態','探索','公會','自動化','我的']);
 await expect(page.locator('.nav-more')).toHaveCount(0);
 await page.getByRole('navigation',{name:'主要工作區'}).getByRole('button',{name:'探索',exact:true}).click();
 await expect(page).toHaveURL(/#explore$/);
 await page.getByLabel('探索檢視',{exact:true}).selectOption('#explore/resources');
 await expect(page).toHaveURL(/#explore\/resources$/);
 await page.goBack();await expect(page).toHaveURL(/#explore$/);
 await page.evaluate(()=>{window.location.hash='social';});
 await expect(page).toHaveURL(/#home$/);await expect(page.locator('.home-timeline')).toBeVisible();
 await page.getByRole('button',{name:'分享或提交',exact:true}).click();
 await page.getByRole('button',{name:'發文',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'建立貼文',exact:true})).toBeVisible();
});
test('guest games and optional village stay inside guild context',async({page})=>{
 await page.goto('/#guilds/guild_games/tools/arcade');
 await expect(page.getByRole('heading',{name:'小遊戲公會',exact:true})).toBeVisible();
 await expect(page.getByLabel('公會功能',{exact:true})).toBeVisible();
 await page.goto('/#newbie-village');
 await expect(page).toHaveURL(/#guilds\/guild_talent_direction\/tools\/village$/);
 await expect(page.getByRole('heading',{name:'人才與方向公會',exact:true})).toBeVisible();
});
test('guest owner routes retain login and never mount private settings',async({page})=>{
 const privateReads:string[]=[];
 page.on('request',request=>{if(/\/api\/v1\/me\/(?:profile|content|client-connections)/.test(new URL(request.url()).pathname))privateReads.push(request.url());});
 for(const hash of ['account','profile?view=settings','my-content','private-ai']){
  await page.goto('/#'+hash);
  await expect(page.getByRole('heading',{name:'登入',exact:true})).toBeVisible();
  await expect(page.locator('.account-panel,.personal-space-content,.private-ai-panel')).toHaveCount(0);
 }
 expect(privateReads).toEqual([]);
});
