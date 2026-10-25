import {test,expect} from './fixtures.js';
import {COMMUNITY_GROUPS, COMMUNITY_WORK} from '../../modules/community-hub/index.js';

test('COMMUNITY-HUB-001 signed-out visitors can browse all groups and safe external links',async({page})=>{
  await page.goto('/#community-hub');
  await expect(page.getByRole('heading',{level:1,name:'社群入口總覽',exact:true})).toBeVisible();
  const hub=page.locator('.community-hub');
  for(const group of COMMUNITY_GROUPS){
    const row=hub.locator(`[data-group-id="${group.id}"]`);
    await expect(row).toBeVisible();
    if(group.platform==='LINE')await expect(row).toContainText(group.name);
    if(group.url===null){
      await expect(row).toContainText('連結待提供');
      await expect(row.getByRole('link')).toHaveCount(0);
    }else{
      const link=row.getByRole('link');
      await expect(link).toHaveAttribute('href',group.url);
      await expect(link).toHaveAttribute('target','_blank');
      await expect(link).toHaveAttribute('rel','noopener noreferrer');
      await expect(link).toHaveAttribute('referrerpolicy','no-referrer');
    }
  }
  await expect(hub.locator('[data-group-id^="line-"]')).toHaveCount(4);
  for(const item of COMMUNITY_WORK)await expect(hub.locator(`a[href="#${item.tab}"]`)).toBeVisible();
  await page.getByRole('link',{name:'返回登入',exact:true}).click();
  await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();
});

test('COMMUNITY-HUB-002 mobile public hub has no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#community-hub');
  await expect(page.getByRole('heading',{level:1,name:'社群入口總覽',exact:true})).toBeVisible();
  await expect(page.locator('[data-group-id="line-meta"]')).toContainText('連結待提供');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('COMMUNITY-HUB-003 public hub follows the interface language',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('freedom-interface-language-v1','en'));
  await page.goto('/#community-hub');
  await expect(page.getByRole('heading',{level:1,name:'Community hub',exact:true})).toBeVisible();
  await expect(page.locator('[data-group-id="line-meta"]')).toContainText('Link pending');
});
