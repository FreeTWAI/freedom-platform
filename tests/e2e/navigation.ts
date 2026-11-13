import {TAB_TITLES} from '../../apps/portal-web/src/features/metadata';
import {resolvePortalRoute,portalHash,PORTAL_PLACES} from '../../apps/portal-web/src/portal-route';
import {GUILD_TOOLS} from '../../apps/portal-web/src/guild-tools/catalog';
import type {TabId} from '../../apps/portal-web/src/types';
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
}
/** Compatibility names describe the existing task; navigation uses the five visible places. */
export async function navigate(page:Page,name:string) {
 await expect(page.locator('.shell')).toBeVisible();
 if(name==='我的訊息'){await openChat(page);return;}
 await closeChat(page);
 const automation:Record<string,string>={'模型設定':'#automation/models','工具連線':'#automation/connections','裝置連線':'#automation/devices'};
 const aliases:Record<string,TabId>={'AI 整理供貨商品':'supplier','AI 製作銷售網站':'retail','我的定位':'positioning','供貨商品管理':'stores','我的名片':'account','私人 AI 工作室':'private-ai','會員首頁':'home','我的內容':'my-content'};
 const tab=(automation[name]?'private-ai':aliases[name])??Object.entries(TAB_TITLES).find(([,title])=>title===name)?.[0] as TabId;
 if(!tab)throw new Error('Unmapped navigation task: '+name);
 const hash=automation[name]??(name==='供貨商品管理'?portalHash('stores','/supply'):portalHash(tab));
 const route=resolvePortalRoute(hash),place=PORTAL_PLACES.find(p=>p.id===route.place)!;
 const current=resolvePortalRoute(new URL(page.url()).hash);
 // Stay in the current place when its view picker is already available. A declined
 // leave guard keeps the current place: do not search for controls in the rejected
 // destination or issue a second navigation attempt.
 if(current.place!==route.place||route.toolId||route.place==='home'||route.place==='guilds'){
  await openFeatureSearch(page);
  const destination=page.locator('#workspace-navigation').getByRole('button',{name:place.title,exact:true,includeHidden:true});
  await destination.click();
  if(await destination.getAttribute('aria-current')!=='page')return;
 }
 if(route.toolId){
  await page.getByLabel('公會工具',{exact:true}).selectOption(route.guildKey!);
  const tool=GUILD_TOOLS.find(t=>t.guild_key===route.guildKey&&t.tool_id===route.toolId)!;
  await page.getByRole('button',{name:tool.title,exact:true}).click();
  if(tab==='tasks')await page.getByLabel('工作檢視',{exact:true}).selectOption('discovery');
 }else if(tab==='opensource'){
  await openHomeGuide(page);
  await page.locator('.home-destinations button').filter({has:page.getByText('開源投稿',{exact:true})}).click();
 }else if(tab==='community'||tab==='community-hub')await page.getByRole('button',{name:'社群',exact:true}).click();
 else if(['me','explore','automation'].includes(route.place))await page.getByLabel(place.title+'檢視',{exact:true}).selectOption(hash);
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

/** Open only the account settings needed by this journey, through visible controls. */
export async function openAccountSettings(page:Page,...labels:string[]){
  await expect(page.locator('.account-panel')).toBeVisible();
  for(const label of labels){
    const text=page.locator('.account-panel').getByText(label,{exact:true});
    const target=text.locator('xpath=ancestor-or-self::summary/parent::details');
    await expect(target).toHaveCount(1);
    const parents=target.locator('xpath=ancestor::details');
    for(let index=0;index<await parents.count();index++){
      const parent=parents.nth(index);
      if(!await parent.evaluate(element=>(element as HTMLDetailsElement).open))await parent.locator(':scope > summary').click();
    }
    if(!await target.evaluate(element=>(element as HTMLDetailsElement).open))await target.locator(':scope > summary').click();
  }
}

/** Remove the new per-member feed rows before deleting synthetic fixture users. */
export async function clearMemberAgentEvents(db: import('pg').Pool | import('pg').PoolClient, ids: string[]) {
  await db.query('DELETE FROM agent_change_events WHERE user_id=ANY($1::uuid[])', [ids]);
}

/** Reveal the retained event fields through the current optional-settings disclosure. */
export async function openEventOptions(page: Page) {
  const options=page.locator('form.experience-editor details').filter({has:page.getByText('選填設定',{exact:true}).or(page.getByText('更多設定：活動類型、人數、公會與參與範圍',{exact:true}))});
  await expect(options).toHaveCount(1);
  if(!await options.evaluate(element=>(element as HTMLDetailsElement).open))await options.locator(':scope > summary').click();
}

/** Reconstruct a pre-revamp pending event for the retained draft-editing tests.
 * New publication is asserted separately; this SQL is fixture setup, not a UI transition. */
export async function seedLegacyEventDraft(db: import('pg').Pool, eventId: string) {
  const result=await db.query("UPDATE community_events SET state='pending' WHERE event_id=$1 AND state='published' RETURNING event_id",[eventId]);
  expect(result.rowCount).toBe(1);
}

/** Open feature lookup in Explore; keep its current content-query history. */
export async function openExploreFeatureSearch(page: Page) {
  await closeChat(page);
  if(resolvePortalRoute(new URL(page.url()).hash).place!=='explore'){
    await openFeatureSearch(page);
    const explore=page.locator('#workspace-navigation').getByRole('button',{name:'探索',exact:true,includeHidden:true});
    await explore.click();
    if(await explore.getAttribute('aria-current')!=='page')return;
  }
  const lookup=page.locator('.place-feature-search');
  await expect(lookup).toBeVisible();
  if(!await lookup.evaluate(element=>(element as HTMLDetailsElement).open))await lookup.locator(':scope > summary').click();
}

/** Assert an existing task's canonical address and its current place/tool heading. */
export async function expectDestination(page: Page, legacy: string) {
  const route=resolvePortalRoute(legacy.startsWith('#')?legacy:'#'+legacy);
  const title=route.toolId?GUILD_TOOLS.find(tool=>tool.guild_key===route.guildKey&&tool.tool_id===route.toolId)!.title:PORTAL_PLACES.find(place=>place.id===route.place)!.title;
  await expect.poll(()=>new URL(page.url()).hash).toBe(route.hash);
  await expect(page.getByRole('heading',{level:1})).toHaveText(title);
}

/** Public event URLs retain their member tools behind the visible management link. */
export async function openEventManagement(page: Page, eventId?: string) {
  if(eventId)await page.goto(`/events/${eventId}`);
  const detail=page.getByRole('region',{name:'活動專頁',exact:true}),management=page.getByRole('link',{name:'活動管理',exact:true});
  await expect(detail.or(management)).toBeVisible();
  if(!await detail.isVisible())await management.click();
  await expect(detail).toBeVisible();
  if(eventId)expect(new URL(page.url()).hash).toBe(`#explore/events/${eventId}`);
}
