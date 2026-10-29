import {test,expect,type Page} from './fixtures.js';
import {reachByKeyboard} from './navigation.js';

// The headless-shell trace loaded the background document without publishing its
// page event. Use the installed full Chromium only for this native new-tab case.
test.use({channel:'chromium'});

async function login(page:Page){
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('heading',{name:'會員首頁',level:1})).toBeVisible();
}

test('the wordmark is a guarded native home link and exploration never forces itself open',async({page,context})=>{
  await page.setViewportSize({width:320,height:844});
  await page.goto('/');
  const original=page.locator('img[src="/brand/freedom-workshop.webp"]').first();
  await expect(original).toBeVisible();
  await expect(page.locator('.brand-home')).toHaveCount(0);
  await login(page);
  const home=page.locator('.brand-home'), exploration=page.locator('.home-participation-disclosure');
  await expect(home).toHaveAccessibleName('自由工坊 · 會員首頁');
  await expect(home).toHaveAttribute('href','/#home');
  expect((await home.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(exploration).toHaveJSProperty('open',false);
  await expect(page.getByRole('button',{name:'建立貼文',exact:true})).toBeInViewport();
  const logo=home.locator('.brand-home-logo');
  await expect(logo).toHaveJSProperty('naturalWidth',1536);
  await expect(logo).toHaveJSProperty('naturalHeight',512);
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:844});
    const box=(await logo.boundingBox())!;
    expect(box.width).toBe(132);expect(box.height).toBe(44);
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    await expect(home).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(exploration).toHaveJSProperty('open',false);
    await expect(exploration.locator(':scope > summary')).toBeVisible();
  }
  await exploration.locator(':scope > summary').press('Enter');
  await expect(exploration).toHaveJSProperty('open',true);
  await page.setViewportSize({width:1280,height:844});
  await expect(exploration).toHaveJSProperty('open',true);
  await page.goto('/?from=home-entry-test#skills');
  await expect(page.getByRole('heading',{name:'技能書架',level:1,exact:true})).toBeVisible();
  await expect(page).toHaveURL(/\?from=home-entry-test#skills$/);
  const originalUrl=page.url();
  const popupPromise=context.waitForEvent('page');
  await home.click({modifiers:['ControlOrMeta']});
  const popup=await popupPromise;
  await expect(popup).toHaveURL(/\/#home$/);
  await expect(popup.getByRole('heading',{name:'會員首頁',level:1,exact:true})).toBeVisible();
  await expect(page).toHaveURL(originalUrl);
  await popup.close();
  await reachByKeyboard(page,home);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/#home$/);
  await expect(exploration).toHaveJSProperty('open',false);
  await page.goBack();await expect(page).toHaveURL(/\?from=home-entry-test#skills$/);
  await page.goForward();await expect(page).toHaveURL(/#home$/);
  await expect(exploration).toHaveJSProperty('open',false);
  await page.reload();
  await expect(exploration).toHaveJSProperty('open',false);
  await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
  await home.click();
  await expect(page.getByRole('heading',{name:'會員首頁',level:1,exact:true})).toBeInViewport();
});

test('compact header reserves its image space while loading and when the asset fails',async({page})=>{
  await page.setViewportSize({width:320,height:844});
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/brand/freedom-workshop-compact.jpeg',async route=>{await held;await route.continue();});
  try{
    await login(page);
    const home=page.locator('.brand-home'),logo=home.locator('img');
    const before=(await logo.boundingBox())!;
    expect(before.width).toBe(132);expect(before.height).toBe(44);
    release();
    await expect(logo).toHaveJSProperty('naturalWidth',1536);
    expect(await logo.boundingBox()).toEqual(before);
    await page.unroute('**/brand/freedom-workshop-compact.jpeg');
    await page.route('**/brand/freedom-workshop-compact.jpeg',route=>route.abort());
    await page.reload();
    await expect(home).toHaveAccessibleName('自由工坊 · 會員首頁');
    for(const theme of ['light','dark','versefolk']){
      await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      const box=(await logo.boundingBox())!;
      expect(box.width).toBe(132);expect(box.height).toBe(44);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await home.press('Enter');
    await expect(page).toHaveURL(/\/#home$/);
  }finally{release();}
});
