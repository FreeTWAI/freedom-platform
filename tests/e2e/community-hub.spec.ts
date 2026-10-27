import {test,expect} from './fixtures.js';
import {COMMUNITY_GROUPS, COMMUNITY_WORK} from '../../modules/community-hub/index.js';

test('COMMUNITY-HUB-001 signed-out visitors can browse all groups and safe external links',async({page})=>{
  await page.goto('/#community-hub');
  await expect(page.getByRole('heading',{level:1,name:'社群入口總覽',exact:true})).toBeVisible();
  const hub=page.locator('.community-hub');
  for(const group of COMMUNITY_GROUPS){
    const row=hub.locator(`[data-group-id="${group.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(group.name);
    const link=row.getByRole('link');
    await expect(link).toHaveAttribute('href',group.url);
    await expect(link).toHaveAttribute('target','_blank');
    await expect(link).toHaveAttribute('rel','noopener noreferrer');
    await expect(link).toHaveAttribute('referrerpolicy','no-referrer');
  }
  for(const item of COMMUNITY_WORK)await expect(hub.locator(`a[href="#${item.tab}"]`)).toBeVisible();
  await page.getByRole('link',{name:'返回登入',exact:true}).click();
  await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();
});
