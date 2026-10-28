import {test,expect,type Page} from './fixtures.js';
import {openSettingsPanel} from './settings-menu-helpers.js';

async function login(page:Page){
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
 await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('heading',{name:'會員首頁',level:1})).toBeVisible();
}
async function selectSeason(page:Page,label:string){
 await openSettingsPanel(page,'appearance');await page.locator('[data-settings-panel="seasonal"]').click();
 const menu=page.locator('.settings-menu [role="menu"]');await expect(menu).toHaveAttribute('data-settings-view','seasonal');
 await menu.getByRole('menuitemradio',{name:label,exact:true}).click();await expect(menu.getByRole('menuitemradio',{name:label,exact:true})).toHaveAttribute('aria-checked','true');
 await page.keyboard.press('Escape');await expect(menu).toHaveAttribute('data-settings-view','appearance');
 await expect(page.locator('[data-settings-panel="seasonal"]')).toBeFocused();await page.keyboard.press('Escape');await page.keyboard.press('Escape');await expect(menu).toBeHidden();
}
for(const base of ['light','dark','versefolk'])for(const width of [390,1280]){
 test(`seasonal before-after on same candidate: ${base} ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.install({time:new Date('2026-10-28T00:00:00Z')});
  await page.addInitScript(base=>{localStorage.setItem('freedom-theme',base);localStorage.setItem('freedom-seasonal-theme','off');},base);
  const requested:string[]=[];page.on('request',request=>{if(request.url().includes('/art/seasonal/'))requested.push(request.url());});
  await login(page);await expect(page.locator('.seasonal-welcome')).toHaveCount(0);expect(requested).toEqual([]);
  const home=page.locator('.brand-home');await expect(home).toHaveAccessibleName('自由工坊 · 會員首頁');const baseline=await home.boundingBox();
  await testInfo.attach(`${base}-${width}-off-same-candidate`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  for(const [id,label] of [['halloween','萬聖節'],['christmas','聖誕節'],['newyear','新年']]){
   const requestStart=requested.length;await selectSeason(page,label);const hero=page.locator('.seasonal-welcome');await expect(hero).toBeVisible();
   await expect(page.locator('.seasonal-hero-art')).toHaveJSProperty('complete',true);await expect(page.locator('.seasonal-hero-art')).not.toHaveJSProperty('naturalWidth',0);
   expect(requested.slice(requestStart).every(url=>new URL(url).pathname.split('/').at(-1)?.startsWith(id))).toBe(true);
   await expect(home).toHaveAccessibleName('自由工坊 · 會員首頁');expect((await home.boundingBox())!.width).toBe(baseline!.width);expect((await home.boundingBox())!.height).toBeGreaterThanOrEqual(44);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await expect(page.locator('.seasonal-art-column')).toHaveAttribute('aria-hidden','true');await expect(page.locator('.seasonal-hero-art')).toHaveCSS('pointer-events','none');
   const heroBox=(await hero.boundingBox())!;expect(heroBox.height).toBeLessThanOrEqual(width<=600?120:144);
   const copyBox=(await page.locator('.seasonal-welcome-copy').boundingBox())!,artBox=(await page.locator('.seasonal-art-column').boundingBox())!;expect(artBox.x).toBeGreaterThanOrEqual(copyBox.x+copyBox.width);
   await expect(page.locator('.seasonal-share')).toBeInViewport();
   await testInfo.attach(`${base}-${width}-${id}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  }
  await selectSeason(page,'關閉節日主題');await expect(page.locator('.seasonal-welcome')).toHaveCount(0);await expect(home).toHaveAttribute('href','/#home');
 });
}
test('seasonal sharing reuses composer; auto expires at Taipei midnight and failed art stays optional',async({page})=>{
 await page.setViewportSize({width:320,height:844});await page.clock.install({time:new Date('2026-10-31T15:00:00Z')});await page.clock.pauseAt(new Date('2026-10-31T15:01:00Z'));
 await page.addInitScript(()=>localStorage.setItem('freedom-seasonal-theme','auto'));
 await page.route('**/art/seasonal/*',route=>route.abort());await login(page);
 await expect(page.locator('.seasonal-welcome')).toBeVisible();await expect(page.locator('.seasonal-share')).toBeEnabled();
 await page.locator('.seasonal-share').click();await expect(page.locator('.social-publish-dialog')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('.social-publish-dialog')).toBeHidden();await expect(page.locator('.social-write-trigger')).toBeFocused();
 await page.clock.fastForward(59*60*1000+1);await expect(page.locator('.seasonal-welcome')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
