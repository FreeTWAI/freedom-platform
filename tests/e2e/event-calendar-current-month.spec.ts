import {test,expect} from './fixtures.js';
import {navigate,reachByKeyboard} from './navigation.js';

// This journey exercises the mounted EventsPanel and native keyboard/layout behavior.
// The event list is deliberately empty; the existing events-past journey retains its
// database-backed event opening, ended-state and twelve-month navigation assertions.
for(const width of [320,390,1280])test(`calendar returns to this month by keyboard at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/v1/events',route=>route.request().method()==='GET'?route.fulfill({json:{items:[]}}):route.continue());
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await navigate(page,'社群活動');
  const calendar=page.getByRole('region',{name:'活動行事曆',exact:true});
  const previous=calendar.getByRole('button',{name:'上個月',exact:true});
  const next=calendar.getByRole('button',{name:'下個月',exact:true});
  const current=calendar.getByRole('button',{name:'回到本月',exact:true});
  const currentLabel=await page.evaluate(()=>new Date().toLocaleDateString('zh-TW',{year:'numeric',month:'long'}));
  await expect(calendar.getByRole('grid')).toHaveAccessibleName(currentLabel);
  await expect(current).toBeEnabled();
  await expect(current).toHaveAttribute('type','button');
  await expect(current).not.toHaveAttribute('aria-pressed');
  await expect(calendar.getByText('目前顯示本月',{exact:true})).toBeVisible();
  for(let step=0;step<12;step++)await previous.click();
  await expect(previous).toBeDisabled();
  await expect(calendar.getByText('目前顯示本月',{exact:true})).toHaveCount(0);
  await reachByKeyboard(page,current);
  for(const theme of ['light','dark','versefolk']){
    await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
    expect(await current.evaluate(element=>{
      const style=getComputedStyle(element),probe=document.createElement('span');
      probe.style.color='var(--focus)';element.append(probe);
      const expected=getComputedStyle(probe).color;probe.remove();
      return style.outlineStyle==='solid'&&parseFloat(style.outlineWidth)>=3&&style.outlineColor===expected&&style.outlineColor!=='rgba(0, 0, 0, 0)';
    })).toBe(true);
  }
  await page.keyboard.press('Enter');
  await expect(calendar.getByRole('grid')).toHaveAccessibleName(currentLabel);
  await expect(current).toBeFocused();
  await expect(current).toBeEnabled();
  await expect(previous).toBeEnabled();
  await expect(calendar.getByText('目前顯示本月',{exact:true})).toBeVisible();
  await page.keyboard.press('Space');
  await expect(current).toBeFocused();
  await expect(calendar.getByRole('grid')).toHaveAccessibleName(currentLabel);
  for(let step=0;step<15;step++)await next.click();
  // The next-month button is immediately before the new action in DOM tab order.
  await page.keyboard.press('Tab');
  await expect(current).toBeFocused();
  await page.keyboard.press('Space');
  await expect(calendar.getByRole('grid')).toHaveAccessibleName(currentLabel);
  await expect(current).toBeFocused();
  for(const name of ['上個月','下個月','下個月','上個月','下個月'])await calendar.getByRole('button',{name,exact:true}).click();
  await current.click();
  await expect(calendar.getByRole('grid')).toHaveAccessibleName(currentLabel);
  const bounds=await current.boundingBox();expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(await calendar.evaluate(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&element.scrollWidth<=element.clientWidth;})).toBe(true);
  expect(await current.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  // Only the new row's large-text fit is asserted. Main's pre-existing 2x nav
  // overflow is separately owned by #1261 and is not repaired by this feature.
  await current.evaluate(element=>(element as HTMLElement).style.fontSize='200%');
  expect(await current.evaluate(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&element.scrollWidth<=element.clientWidth;})).toBe(true);
  await expect(current).toHaveAccessibleName('回到本月');
});
