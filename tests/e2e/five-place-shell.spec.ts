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
 await page.getByRole('dialog',{name:'分享',exact:true}).getByRole('button',{name:'貼文',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'分享',exact:true}).getByLabel('內容',{exact:true})).toBeVisible();
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

test('legacy credit and private-work links retain queries and the selected object inside their place',async({page})=>{
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
 const works=ids.map((id,i)=>({work_item_id:id,title:`合成私人工作 ${i+1}`,objective:'只測試路由選取',state:'draft',aggregate_version:1}));
 await page.route('**/api/v1/me/private-work**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/v1/me/private-work')return route.fulfill({json:{items:works}});
  if(path.endsWith('/results/current'))return route.fulfill({json:null});
  if(path.endsWith('/results'))return route.fulfill({json:{items:[]}});
  return route.fulfill({json:works.find(w=>path.endsWith('/'+w.work_item_id))});
 });
 await page.route('**/api/v1/me/model-step-overview',route=>route.fulfill({json:{persistenceAvailable:true,configuration:'unavailable',runs:[],models:[],connections:[],grants:[],approvals:[],steps:[],allowedSelections:[]}}));
 await page.goto('/');
 await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
 await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
 await page.getByRole('button',{name:'登入',exact:true}).click();
 await expect(page.locator('.shell')).toBeVisible();
 await page.evaluate(hash=>{window.location.hash=hash;},`#private-ai/${ids[0]}?source=a%2Bb`);
 await expect.poll(()=>new URL(page.url()).hash).toBe(`#automation/work/${ids[0]}?source=a%2Bb`);
 await expect(page.getByLabel('自動化檢視')).toHaveValue('#automation/work');
 await expect(page.getByRole('combobox',{name:'選擇私人工作',exact:true})).toHaveValue(ids[0]);
 await expect(page.getByLabel('工作標題',{exact:true})).toHaveValue(works[0].title);
 await page.evaluate(hash=>{window.location.hash=hash;},`#private-ai?work=${ids[1]}&source=a%2Bb`);
 await expect.poll(()=>new URL(page.url()).hash).toBe(`#automation/work?work=${ids[1]}&source=a%2Bb`);
 await expect(page.getByRole('combobox',{name:'選擇私人工作',exact:true})).toHaveValue(ids[1]);
 await expect(page.getByLabel('工作標題',{exact:true})).toHaveValue(works[1].title);
 await page.evaluate(()=>{window.location.hash='#promotion?period=month&source=a%2Bb';});
 await expect.poll(()=>new URL(page.url()).hash).toBe('#me/credit?period=month&source=a%2Bb');
 await expect(page.getByLabel('我的檢視')).toHaveValue('#me/credit');
 await expect(page.getByRole('region',{name:'我的貢獻'})).toBeVisible();
 await expect(page.locator('.nav-primary [aria-current]')).toHaveText('我的');
});
