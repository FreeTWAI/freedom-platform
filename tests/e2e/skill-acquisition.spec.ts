import {randomUUID} from 'node:crypto';
import {test,expect,type Page} from './fixtures.js';

const path='/development/skills/social-post';
const account=(register=true)=>`/?${register?'join=1&':''}return_to=${encodeURIComponent(path)}&skill_intro=7`;
const panel=(page:Page)=>page.getByRole('region',{name:'這本直接看，更多資源一起探索',exact:true});
async function siteWithoutDiscovery(page:Page,registration=true){
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),registration_enabled:registration,community_discovery_enabled:false}});});
}
async function signIn(page:Page){
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.locator('.login-card form').getByRole('button',{name:'登入',exact:true}).click();
}

test('external readers can read and reach signup without running JavaScript',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,javaScriptEnabled:false,viewport:{width:320,height:844}});
  try{
    const page=await context.newPage();await page.goto(path+'?intro=7');
    await expect(page.getByRole('heading',{name:'Hao 社群貼文技能書',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'用途與適用範圍',exact:true})).toBeVisible();
    await expect(panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true})).toHaveAttribute('href',account());
    await expect(page.getByRole('link',{name:'到 GitHub 看原始碼 ↗',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const box=await panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true}).boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);
  }finally{await context.close();}
});

test('join opens the registration form even when general discovery is off, with a reading exit',async({page})=>{
  await siteWithoutDiscovery(page);await page.goto(path+'?intro=7');
  await panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true}).click();
  await expect(page.getByRole('heading',{name:'加入自由工坊',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'返回技能書繼續閱讀',exact:true})).toHaveAttribute('href',path+'?intro=7#skill-use-title');
  await page.getByRole('link',{name:'返回技能書繼續閱讀',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('/development/skills/social-post\\?intro=7#skill-use-title$'));
});

test('successful registration returns to the same public book without forcing guild selection',async({page})=>{
  await siteWithoutDiscovery(page);await page.goto(account());
  await expect(page.getByRole('heading',{name:'加入自由工坊',exact:true})).toBeVisible();
  await page.getByLabel('電子郵件',{exact:true}).fill(`skill-${randomUUID()}@local.test`);
  await page.getByLabel('密碼',{exact:true}).fill('synthetic-skill-reader-password');
  await page.locator('.login-card form button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp('/development/skills/social-post\\?intro=7#skill-use-title$'));
  await expect(panel(page).getByRole('link',{name:'前往技能書架',exact:true})).toBeVisible();
  await expect(panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true})).toBeHidden();
});

test('existing-account login retains the book and introduction too',async({page})=>{
  await siteWithoutDiscovery(page);await page.goto(account(false));await signIn(page);
  await expect(page).toHaveURL(new RegExp('/development/skills/social-post\\?intro=7#skill-use-title$'));
  await expect(panel(page).getByRole('link',{name:'前往技能書架',exact:true})).toHaveAttribute('href','/#skills');
});

test('an already authenticated reader can follow an old account link without landing on the home page',async({page})=>{
  await siteWithoutDiscovery(page);await page.goto('/');await signIn(page);
  await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
  await page.goto(account());await expect(page).toHaveURL(new RegExp('/development/skills/social-post\\?intro=7#skill-use-title$'));
});

test('closed registration leaves public reading and existing-account login available',async({page})=>{
  await siteWithoutDiscovery(page,false);await page.goto(path);
  await expect(panel(page).getByText(/目前暫停新帳號註冊/)).toBeVisible();
  await expect(panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true})).toBeHidden();
  await expect(panel(page).getByRole('link',{name:'已有帳號，登入',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'用途與適用範圍',exact:true})).toBeVisible();
});

test('unavailable original content does not turn successful login into a repeat registration',async({page})=>{
  await siteWithoutDiscovery(page);await page.goto(account(false));
  let reads=0;await page.route(url=>url.pathname===path,route=>{reads++;return route.fulfill({status:404,body:'not published'});});
  await signIn(page);await expect(page.getByText('登入成功。原本的技能書目前無法確認或已停止公開，你仍可繼續探索工坊。',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();expect(reads).toBe(1);
});

test('a broken enhancement script never hides the reading content or plain account links',async({page})=>{
  await page.route('**/skill-acquisition.js',route=>route.abort());await page.goto(path+'?intro=7');
  await expect(page.getByRole('heading',{name:'用途與適用範圍',exact:true})).toBeVisible();
  await expect(panel(page).getByRole('link',{name:'免費加入，探索更多資源',exact:true})).toHaveAttribute('href',account());
  await panel(page).getByRole('link',{name:'繼續閱讀這本技能書',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('#skill-use-title$'));
});
