import { expect, type Page, type Locator } from './fixtures.js';

/** Member tools are secondary; open their visible disclosure before choosing one.
 * Sign-in and the admin header use the same disclosure. */
export async function openPageTools(page:Page){
  // Wait for the actual toolbar to mount before inspecting its disclosure.
  // page.goto can finish while the first session/site reads are still pending.
  await expect(page.locator('.page-tools').first()).toBeVisible();
  const menu=page.locator('.page-tools-menu');
  if(await menu.count()){
    if(!await menu.evaluate(element=>(element as HTMLDetailsElement).open))await menu.locator(':scope > summary').click();
    await expect(menu).toHaveJSProperty('open',true);
  }
}

/** Resize an already mounted home and wait for its responsive disclosure update. */
export async function setHomeViewport(page:Page,size:{width:number;height:number}){
  const guide=page.locator('.home-guide-disclosure');
  await expect(guide).toBeAttached();
  const wasWide=await page.evaluate(()=>window.matchMedia('(min-width:861px)').matches);
  await page.setViewportSize(size);
  const wide=size.width>=861;
  // React applies the media change after the viewport changes. Wait before a
  // native open click, but preserve member-opened state within the same range.
  if(wasWide!==wide)await expect(guide).toHaveJSProperty('open',wide);
}

/** Open the optional home guide through its visible mobile disclosure. */
export async function openHomeGuide(page:Page){
  // Lazy home content may mount after the shell title becomes visible.
  const guide=page.locator('.home-guide-disclosure');
  await expect(guide).toBeAttached();
  if(!await guide.evaluate(element=>(element as HTMLDetailsElement).open))await guide.locator(':scope > summary').click();
  await expect(guide).toHaveJSProperty('open',true);
}

/** Learning is optional at every width; exercise the visible native disclosure. */
export async function openHomeLearning(page:Page){
  const exploration=page.locator('.home-participation-disclosure');
  await expect(exploration).toBeAttached();
  if(!await exploration.evaluate(element=>(element as HTMLDetailsElement).open))await exploration.locator(':scope > summary').click();
  await expect(exploration).toHaveJSProperty('open',true);
}

/** Reach the original profile/recommendation and module cards on the simple home. */
export async function expandHomeSections(page:Page){
  await openHomeLearning(page);
  await openHomeGuide(page);
  await expect(page.locator('.home-personal')).toBeVisible();
  for(const selector of ['.home-personal']){
    const section=page.locator(selector);
    if(await section.count()&&!await section.evaluate(element=>(element as HTMLDetailsElement).open))await section.locator(':scope > summary').click();
  }
}

export async function openFeatureSearch(page:Page){
  await closeChat(page);
  const menu=page.getByRole('button',{name:'開啟選單',exact:true});
  if(await menu.isVisible())await menu.click();
  const more=page.locator('.nav-more');
  if(!await more.evaluate(element=>(element as HTMLDetailsElement).open))await more.locator(':scope > summary').click();
}

/** Follow the same visible navigation a member uses, including phone menus and groups. */
export async function navigate(page: Page, name: string) {
  await expect(page.locator('.shell')).toBeVisible();
  if (name === '我的訊息') {
    await openChat(page);
    return;
  }
  await closeChat(page);
  if (['我的名片', '入門指南'].includes(name)) {
    const settings = page.getByRole('button', { name: '設定', exact: true });
    if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
    await page.getByRole('menuitem', { name:name==='我的名片'?'資料與帳號設定':name, exact: true }).click();
    return;
  }
  const menu = page.getByRole('button', { name: '開啟選單', exact: true });
  if (await menu.isVisible()) await menu.click();
  const navigation = page.getByRole('navigation', { name: '主要工作區', includeHidden: true });
  await expect(navigation).toBeVisible();
  const target = navigation.getByRole('button', { name, exact: true, includeHidden: true });
  if (await target.count() === 0) {
    const more = navigation.locator('.nav-more');
    if (!await more.evaluate(element => (element as HTMLDetailsElement).open)) await more.locator(':scope > summary').click();
    await navigation.getByRole('searchbox').fill(name);
  }
  await expect(target).toHaveCount(1);
  const groups = target.locator('xpath=ancestor::details');
  // Open the outer disclosure before its nested group, using visible controls.
  for (let index = 0; index < await groups.count(); index++) {
    const group = groups.nth(index);
    if (!await group.evaluate(element => (element as HTMLDetailsElement).open)) await group.locator(':scope > summary').click();
  }
  await target.click();
}

/** Choose an optional feed through the same secondary dialog a member opens. */
export async function selectSocialFeed(page: Page, name: string) {
  await page.getByRole('button', {name: '動態選項', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '動態選項', exact: true});
  await dialog.getByRole('button', {name, exact: true}).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.social-zone')).toHaveAttribute('aria-busy', 'false');
}

/** Sign out from the profile menu: 設定 in the workspace, or the profile menu shown before onboarding is done. */
export async function signOut(page: Page) {
  const settings = page.getByRole('button', { name: '設定', exact: true });
  const preview = page.locator('.preview-profile-menu');
  await expect(settings.or(preview)).toBeVisible();
  if (await preview.isVisible()) {
    if (!await preview.evaluate(element => (element as HTMLDetailsElement).open)) await preview.locator(':scope > summary').click();
    await preview.getByRole('button', { name: '登出', exact: true }).click();
  } else {
    if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
    await page.getByRole('menu', { name: '個人檔案' }).getByRole('menuitem', { name: '登出', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: '登入', exact: true })).toBeVisible();
}

/** Notification history is owned by the bell, separately from chats. */
export async function openNotifications(page:Page){
  await closeChat(page);
  const bell=page.locator('.notification-bell-trigger');
  if(await bell.getAttribute('aria-expanded')!=='true')await bell.click();
  const all=page.getByRole('button',{name:'查看所有通知',exact:true});
  if(await all.isVisible())await all.click();
}
export async function openChat(page:Page){
  const bubble=page.locator('.floating-messages');
  if(await bubble.getAttribute('aria-expanded')!=='true')await bubble.click();
  await expect(page.locator('#floating-message-panel')).toBeVisible();
}
export async function closeChat(page:Page){
  const panel=page.locator('#floating-message-panel');
  if(await panel.isVisible()){
    // The phone launcher is hidden while its modal is open. Its own collapse
    // button remains reachable; wait for the panel to close before another action.
    // The accessible name is translated; the last header button is the
    // universal collapse control in all five supported languages.
    const collapse=panel.locator('.floating-message-header > button').last();
    await expect(collapse).toHaveAttribute('aria-label',/\S/);
    await collapse.click();
    await expect(panel).toBeHidden();
  }
}

/** Select one complete guild workspace through the visible desktop or phone navigation. */
export async function openGuildSection(page: Page, label: string) {
  const mobile = page.getByRole('combobox', {name: '公會功能', exact: true});
  await expect(mobile.or(page.getByRole('navigation', {name: '公會功能', exact: true}))).toBeVisible();
  if (await mobile.isVisible()) await mobile.selectOption({label});
  else await page.getByRole('navigation', {name: '公會功能', exact: true}).getByRole('button', {name: label, exact: true}).click();
}

/** Admin workspaces use a sidebar on desktop and the same menu in a phone dialog. */
export async function openAdminNavigation(page:Page){
  const mobile=await page.evaluate(()=>window.matchMedia('(max-width: 960px)').matches);
  if(mobile){
    const dialog=page.getByRole('dialog',{name:'切換管理功能',exact:true});
    if(!await dialog.isVisible())await page.getByRole('button',{name:'開啟管理選單',exact:true}).click();
    await expect(dialog).toBeVisible();
  }
  const navigation=page.getByRole('navigation',{name:'平台管理選單',exact:true});
  await expect(navigation).toBeVisible();
  return navigation;
}
export async function navigateAdmin(page:Page,name:string){
  const navigation=await openAdminNavigation(page);
  const button=navigation.getByRole('button',{name,exact:true});
  const changed=await button.getAttribute('aria-current')!=='page';
  await button.click();
  const workspace=page.getByRole('region',{name:`${name}工作區`,exact:true});
  await expect(workspace).toBeVisible();
  if(changed)await expect(workspace).toBeFocused();
  await expect(page.getByRole('dialog',{name:'切換管理功能',exact:true})).toBeHidden();
}

/** Traverse real tab stops rather than programmatically forcing focus-visible. */
export async function reachByKeyboard(page:Page,target:Locator){
  await page.getByRole('link',{name:'跳到主要內容',exact:true}).focus();
  for(let steps=0;steps<40;steps++){
    await page.keyboard.press('Tab');
    if(await target.evaluate(element=>element===document.activeElement))break;
  }
  await expect(target).toBeFocused();
  expect(await target.evaluate(element=>element.matches(':focus-visible'))).toBe(true);
  expect(await target.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
  expect(await target.evaluate(element=>parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThan(0);
}
