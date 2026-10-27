import {test,expect,type Page,type Locator} from './fixtures.js';
import {navigate,openPageTools,openChat,closeChat,signOut} from './navigation.js';
import {pageHelp} from '../../apps/portal-web/src/page-help.js';
import {PORTAL_FEATURE_METADATA} from '../../apps/portal-web/src/features/metadata.js';

const launcher=(page:Page)=>page.locator('.platform-helper-host').getByRole('button',{name:'問路助手',exact:true});
const helper=(page:Page)=>page.getByRole('dialog',{name:'站內問路助手・非生成式 AI',exact:true});
const question=(page:Page)=>helper(page).getByLabel('你想做什麼？（最多 240 字）');
async function login(page:Page){
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/login'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'登入',exact:true}).click();expect((await response).status()).toBe(200);await expect(page.locator('.home-timeline')).toBeVisible();
}
test('member helper host uses current canonical help without new writes or raw query echo',async({page})=>{
  await page.goto('/');await expect(launcher(page)).toHaveCount(0);await login(page);await navigate(page,'技能書架');
  await expect(page.getByRole('heading',{name:'技能書架',level:1,exact:true})).toBeVisible();
  const writes:string[]=[];page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push(new URL(request.url()).pathname);});
  await launcher(page).click();await expect(question(page)).toBeFocused();await question(page).fill('請問我要怎麼學AI？');await question(page).press('Enter');
  await expect(helper(page).getByRole('heading',{name:PORTAL_FEATURE_METADATA.skills.title,exact:true})).toBeVisible();
  await expect(helper(page)).toContainText(pageHelp.skills.summary);await expect(helper(page)).toContainText(pageHelp.skills.steps[0]);
  await expect(question(page)).toHaveValue('');await expect(helper(page)).not.toContainText('請問我要怎麼學AI？');expect(writes).toEqual([]);
  await page.keyboard.press('Escape');await expect(launcher(page)).toBeFocused();await launcher(page).click();await expect(question(page)).toHaveValue('');
});
test('member helper host yields to page tools, share dialog and messages without closing their UI',async({page})=>{
  await login(page);await openPageTools(page);await expect(launcher(page)).toHaveCount(0);
  await page.getByRole('button',{name:'頁面說明',exact:true}).click();
  const help=page.getByRole('dialog',{name:'會員首頁：頁面說明',exact:true});await expect(help).toBeVisible();await expect(launcher(page)).toHaveCount(0);
  await help.getByRole('button',{name:'關閉',exact:true}).click();await expect(launcher(page)).toBeVisible();
  await page.getByRole('button',{name:'分享或提交',exact:true}).click();await expect(launcher(page)).toHaveCount(0);
  await page.getByRole('button',{name:'關閉分享選單',exact:true}).click();await expect(launcher(page)).toBeVisible();
  await openChat(page);await expect(launcher(page)).toHaveCount(0);await closeChat(page);await expect(launcher(page)).toBeVisible();
});
test('member helper host respects real page-leave refusal and retains an unsaved event draft',async({page})=>{
  await login(page);await navigate(page,'社群活動');await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  const form=page.locator('form').filter({has:page.getByRole('heading',{name:'提交活動',exact:true})});await form.getByLabel('活動名稱',{exact:true}).fill('助手導航不可丟掉的合成草稿');
  let accept=false,prompts=0;page.on('dialog',async dialog=>{prompts++;await(accept?dialog.accept():dialog.dismiss());});
  await launcher(page).click();await helper(page).getByRole('button',{name:'學 AI',exact:true}).click();
  await helper(page).getByRole('button',{name:'前往技能書架',exact:true}).click();
  await expect(page).toHaveURL(/#events$/);await expect(helper(page)).toBeVisible();await expect(form.getByLabel('活動名稱',{exact:true})).toHaveValue('助手導航不可丟掉的合成草稿');expect(prompts).toBe(1);
  accept=true;await helper(page).getByRole('button',{name:'前往技能書架',exact:true}).click();await expect(page).toHaveURL(/#skills$/);await expect(helper(page)).not.toBeVisible();await expect(page.locator('#main-content')).toBeFocused();
});
test('member helper host resets accepted same-tab routes and a fresh login generation',async({page})=>{
  await login(page);await navigate(page,'我的商店');await launcher(page).click();await question(page).fill('舊路由問題');
  // External history change models an accepted same-tab deep link, not a helper action.
  await page.evaluate(()=>{location.hash='#stores/supply';});await expect(page).toHaveURL(/#stores\/supply$/);await expect(helper(page)).not.toBeVisible();
  await launcher(page).click();await expect(question(page)).toHaveValue('');await page.keyboard.press('Escape');await signOut(page);
  await expect(launcher(page)).toHaveCount(0);await login(page);await launcher(page).click();await expect(question(page)).toHaveValue('');
});
test('member helper host transfers focus after accepted same-tab helper navigation',async({page})=>{
  await login(page);await navigate(page,'供貨商品管理');await expect(page).toHaveURL(/#stores\/supply$/);
  await launcher(page).click();await helper(page).getByRole('button',{name:'開店／賣東西',exact:true}).click();
  await helper(page).getByRole('button',{name:'前往我的商店',exact:true}).click();
  await expect(page).toHaveURL(/#stores$/);await expect(helper(page)).not.toBeVisible();await expect(page.locator('#main-content')).toBeFocused();
});
for(const flag of [false,undefined])test(`member helper host hides stores when capability is ${String(flag)}`,async({page})=>{
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();const data=await response.json();if(flag===undefined)delete data.guild_launchpad_enabled;else data.guild_launchpad_enabled=flag;await route.fulfill({response,json:data});});
  await login(page);await launcher(page).click();await helper(page).getByRole('button',{name:'開店／賣東西',exact:true}).click();
  await expect(helper(page).getByRole('button',{name:'前往我的商店',exact:true})).toHaveCount(0);
  await expect(helper(page).getByRole('button',{name:`前往${PORTAL_FEATURE_METADATA.supplier.title}`,exact:true})).toBeVisible();
});
for(const width of [320,390])test(`member helper host remains normal-flow and keyboard usable at ${width}px across base themes`,async({page})=>{
  await page.setViewportSize({width,height:560});await login(page);
  for(const theme of ['light','dark','versefolk']){
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;document.documentElement.style.fontSize='200%';},theme);
    await launcher(page).click();await expect(question(page)).toBeFocused();await expect(helper(page)).toBeVisible();
    const box=await helper(page).getByRole('button',{name:'關閉',exact:true}).boundingBox();expect(box).not.toBeNull();expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(560);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.keyboard.press('Escape');await expect(launcher(page)).toBeFocused();
  }
});

for(const profile of ['guide-dragon','guide-ai-sister'])test(`member helper character shortcut shares one dialog and returns focus in ${profile}`,async({page})=>{
  await page.addInitScript(value=>localStorage.setItem('freedom-theme',value),profile);await login(page);await navigate(page,'技能書架');
  const companion=page.locator('.page-spirit-widget'),shortcut=companion.getByRole('button',{name:'問路助手',exact:true});
  await expect(shortcut).toBeVisible();await expect(launcher(page)).toBeVisible();
  const id=await launcher(page).getAttribute('aria-controls');expect(id).toBeTruthy();await expect(shortcut).toHaveAttribute('aria-controls',id!);
  await companion.getByRole('button',{name:'問本頁',exact:true}).click();await expect(companion).toHaveAttribute('data-open','true');
  await shortcut.click();await expect(helper(page)).toHaveCount(1);await expect(helper(page)).toBeVisible();await expect(question(page)).toBeFocused();
  await expect(companion).toHaveAttribute('data-mode','closed');await expect(shortcut).toBeDisabled();await expect(shortcut).toHaveAttribute('aria-expanded','true');
  await expect(companion.getByRole('button',{name:'問本頁',exact:true})).toBeDisabled();await expect(companion.getByRole('button',{name:'帶我看',exact:true})).toBeDisabled();
  await question(page).fill('角色入口不保存原問題');await page.keyboard.press('Escape');await expect(shortcut).toBeEnabled();await expect(shortcut).toBeFocused();
  await launcher(page).click();await expect(helper(page)).toHaveAttribute('id',id!);await expect(question(page)).toHaveValue('');
  await page.keyboard.press('Escape');await expect(launcher(page)).toBeFocused();
  await companion.getByRole('button',{name:'帶我看',exact:true}).click();await expect(companion.locator('.page-spirit-guide-directory')).toBeVisible();
  await shortcut.click();await helper(page).getByRole('button',{name:'從哪裡開始',exact:true}).click();
  await helper(page).getByRole('button',{name:`前往${PORTAL_FEATURE_METADATA.todos.title}`,exact:true}).click();
  await expect(page).toHaveURL(/#todos$/);await expect(helper(page)).not.toBeVisible();await expect(page.locator('#main-content')).toBeFocused();
});
for(const width of [320,390])test(`member character helper at ${width}px retains toolbar fallback after theme teardown`,async({page})=>{
  await page.setViewportSize({width,height:420});await page.addInitScript(()=>localStorage.setItem('freedom-theme','guide-dragon'));await login(page);
  const shortcut=page.locator('.page-spirit-widget').getByRole('button',{name:'問路助手',exact:true});await expect(shortcut).toBeVisible();await shortcut.click();
  await expect(question(page)).toBeFocused();await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'freedom-theme',newValue:'light'})));
  await expect(page.locator('.page-spirit-widget')).toHaveCount(0);await page.keyboard.press('Escape');
  await expect(launcher(page)).toBeVisible();await launcher(page).click();await expect(question(page)).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('member toolbar helper remains available when selected character release is OFF',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('freedom-theme','guide-dragon'));
  await page.route('**/api/v1/guide-packs/release',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,enabled:false}});});
  await login(page);await expect(page.locator('.page-spirit-widget')).toHaveCount(0);await launcher(page).click();await expect(question(page)).toBeFocused();
});

async function expectHelperContrast(button:Locator){
  const ratio=await button.evaluate(element=>{
    const style=getComputedStyle(element);
    function luminance(value:string){
      const parts=value.match(/[\d.]+/g)!.map(Number);
      if(parts.length>3&&parts[3]!==1)throw Error('Expected opaque helper colors');
      const rgb=parts.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
    }
    const values=[luminance(style.color),luminance(style.backgroundColor)].sort((a,b)=>a-b);
    return (values[1]+.05)/(values[0]+.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}
for(const profile of ['light','dark','versefolk','guide-dragon','guide-ai-sister'])test(`member homepage helper contrast uses actual ${profile} profile`,async({page})=>{
  await page.setViewportSize({width:390,height:640});
  await page.addInitScript(value=>localStorage.setItem('freedom-theme',value),profile);await login(page);
  await expect(page.locator('html')).toHaveAttribute('data-experience-profile',profile);
  await expectHelperContrast(launcher(page));await launcher(page).hover();await expectHelperContrast(launcher(page));
  await launcher(page).focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(launcher(page)).toBeFocused();await expectHelperContrast(launcher(page));
  await launcher(page).press('Enter');await expect(question(page)).toBeFocused();
  expect(await helper(page).getByRole('button').count()).toBeGreaterThanOrEqual(6);
  for(const button of await helper(page).getByRole('button').all())await expectHelperContrast(button);
  await helper(page).getByRole('button',{name:'學 AI',exact:true}).click();
  await expect(helper(page).getByRole('button',{name:'前往技能書架',exact:true})).toBeVisible();
  for(const button of await helper(page).getByRole('button').all())await expectHelperContrast(button);
  await page.keyboard.press('Escape');await expect(launcher(page)).toBeFocused();
});
