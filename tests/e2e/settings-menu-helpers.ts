import {expect,type Page} from './fixtures.js';

/** Navigate visible controls only. Also works against the pre-panel menu while integrating branches. */
export async function openSettingsPanel(page:Page,panel:'language'|'appearance'){
  const toggle=page.locator('.settings-menu-button').first();
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  const menu=page.locator('.settings-menu [role="menu"]');
  await expect(menu).toBeVisible();
  const view=await menu.getAttribute('data-settings-view');
  if(view===null||view===panel)return;
  if(view!=='main')await page.keyboard.press('Escape');
  await menu.locator(`[data-settings-panel="${panel}"]`).click();
  await expect(menu).toHaveAttribute('data-settings-view',panel);
}
export async function closeSettingsMenu(page:Page){
  const menu=page.locator('.settings-menu [role="menu"]');
  if(!await menu.isVisible())return;
  if(['appearance','language'].includes(await menu.getAttribute('data-settings-view')??''))await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}
