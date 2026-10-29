import {test,expect} from './fixtures.js';
import {CLASSES_V2,CAREER_GUILDS,DIMENSIONS,calculateResult,QUESTIONS_V2,STORAGE_KEY} from '../../modules/newbie-village/index.js';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('freedom-interface-language-v1','zh-Hant'));
});
test('NEWBIE-001 complete quiz, write direction card, local quests persist and mobile stays within viewport',async({page})=>{
  await page.goto('/#newbie-village');
  await expect(page.getByRole('heading',{name:'新手村任務',exact:true})).toBeVisible();
  await expect(page.getByText('這不是診斷測驗。',{exact:false})).toBeVisible();
  await page.locator('#nv-framework').getByRole('button',{name:'完成這一步'}).click();
  for(let i=0;i<15;i++){
    await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[i].q);
    await page.locator('#nv-quiz input').first().check();
    if(i===13){
      await page.locator('#nv-quiz input').nth(1).check();
      await expect(page.locator('#nv-quiz input').nth(2)).toBeDisabled();
    }
    await page.locator('#nv-quiz').getByRole('button',{name:i===14?'查看結果':'下一題',exact:true}).click();
  }
  await expect(page.getByRole('heading',{name:'我的定位草稿',exact:true})).toBeVisible();
  await expect(page.locator('.nv-dimensions')).toContainText('做自己');
  await expect(page.locator('.nv-radar')).toBeVisible();
  // First option everywhere plus a second pick on question 14 ranks AI 平台架構師 first; it suggests a primary and a secondary guild.
  await expect(page.locator('#nv-quiz')).toContainText('我的定位草稿AI 平台架構師');
  await expect(page.locator('#nv-quiz a[href="#guilds/guild_platform_engineering"]').first()).toBeVisible();
  await expect(page.locator('#nv-quiz a[href="#guilds/guild_commerce_settlement"]').first()).toBeVisible();
  await expect(page.locator('#nv-quiz')).toContainText('僅供建議，由你選擇');
  await page.locator('#nv-card').getByLabel('過生活底線',{exact:true}).fill('每週只投入三小時，不熬夜。');
  await page.locator('#nv-card').getByLabel('第一週行動',{exact:true}).fill('週六完成一個小工具，留下使用筆記。');
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.getByRole('button',{name:'複製方向卡草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'已複製到剪貼簿'})).toBeVisible();
  const draft=await page.evaluate(()=>navigator.clipboard.readText());
  expect(draft).toContain('每週只投入三小時，不熬夜。');
  expect(draft).toContain('主公會：');
  expect(draft).toContain('https://freetwai.com/#guilds/guild_');
  await expect(page.locator('#nv-card pre')).toHaveText(draft);
  await page.locator('#nv-card').getByRole('button',{name:'完成這一步'}).click();
  await page.locator('#nv-guild').getByRole('button',{name:'完成這一步'}).click();
  await page.locator('#nv-checkin textarea').fill('已完成小工具；下週請一位朋友試用。');
  await page.locator('#nv-checkin').getByRole('button',{name:'完成這一步'}).click();
  await expect(page.getByRole('status').filter({hasText:'本機進度'})).toHaveText('本機進度 5 / 5');
  await page.reload();
  await expect(page.getByRole('heading',{name:'我的定位草稿',exact:true})).toBeVisible();
  await expect(page.locator('#nv-card textarea').first()).toHaveValue('每週只投入三小時，不熬夜。');
  await expect(page.locator('.nv-quests .badge')).toHaveCount(5);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'清除本機作答與進度'}).click();
  await expect(page.locator('.nv-quests .badge')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[0].q);
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).done.length,STORAGE_KEY)).toBe(0);
});

test('NEWBIE-002 all five interface languages preserve original question text',async({browser,baseURL})=>{
  const languages=[['en','Newbie Village Quests'],['ja','はじめの村クエスト'],['ko','초보 마을 퀘스트'],['es','Misiones de la aldea inicial']];
  for(const [language,title] of languages){
    const context=await browser.newContext({baseURL});
    try{
      await context.addInitScript(value=>localStorage.setItem('freedom-interface-language-v1',value),language);
      const page=await context.newPage();
      await page.goto('/#newbie-village');
      await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
      await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[0].q);
    }finally{await context.close()}
  }
});

test('NEWBIE-003 blocked storage stays usable and reports that progress cannot persist',async({page})=>{
  await page.addInitScript(()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='freedom-newbie-village-v1')throw new DOMException('Blocked','QuotaExceededError');original.call(this,key,value)};
  });
  await page.goto('/#newbie-village');
  await expect(page.getByRole('alert').filter({hasText:'無法保存到本機'})).toBeVisible();
  await page.locator('#nv-quiz input').first().check();
  await page.getByRole('button',{name:'下一題',exact:true}).click();
  await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[1].q);
});

test('NEWBIE-005 quiz result shows next-step actions and suggested guild links once',async({page})=>{
  await page.goto('/#newbie-village');
  await expect(page.getByTestId('nv-next-step')).toHaveCount(0);
  const answers=QUESTIONS_V2.map(()=>[0]);
  for(let i=0;i<QUESTIONS_V2.length;i++){
    await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[i].q);
    await page.locator('#nv-quiz input').first().check();
    await page.locator('#nv-quiz').getByRole('button',{name:i===14?'查看結果':'下一題',exact:true}).click();
  }
  const result=calculateResult(answers),career=result.primary;
  const suggestedCareers=[...new Set([career,...DIMENSIONS.map(d=>result.dimensionWinners[d])])];
  const screen=page.locator('#nv-quiz');
  const card=page.getByTestId('nv-next-step');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading',{name:'下一步',exact:true})).toBeVisible();
  await expect(card.locator('ol > li')).toHaveCount(3);
  await expect(card.locator('ol > li')).toHaveText(CLASSES_V2[career].actions);
  for(const action of CLASSES_V2[career].actions)await expect(screen.getByText(action,{exact:true})).toHaveCount(1);
  for(const c of suggestedCareers)for(const guild of CAREER_GUILDS[c]){
    await expect(screen.getByRole('link',{name:guild.name,exact:true})).toHaveCount(1);
    await expect(card.getByRole('link',{name:guild.name,exact:true})).toHaveAttribute('href',`#guilds/${guild.guildId}`);
  }
});

// Use the real main.tsx theme imports and persisted profiles, not an isolated CSS fixture.
async function expectNewbieActionColors(action:import('@playwright/test').Locator,focused=false){
  const observed=await action.evaluate(element=>{
    const style=getComputedStyle(element);
    function luminance(value:string){
      const parts=value.match(/[\d.]+/g)!.map(Number);
      if(parts.length>3&&parts[3]!==1)throw Error('Expected opaque action colors');
      const rgb=parts.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
    }
    function ratio(a:string,b:string){const values=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (values[1]+.05)/(values[0]+.05);}
    return {text:ratio(style.color,style.backgroundColor),focus:ratio(style.outlineColor,style.backgroundColor),
      outline:style.outlineStyle,width:parseFloat(style.outlineWidth),opacity:Number(style.opacity),border:style.borderStyle,cursor:style.cursor,
      focusVisible:element.matches(':focus-visible'),height:element.getBoundingClientRect().height};
  });
  // Disabled controls are exempt from WCAG text contrast. These checks concern
  // their uncomposited theme colors and retained disabled styling, not a WCAG claim.
  expect(observed.text).toBeGreaterThanOrEqual(4.5);
  expect(observed.height).toBeGreaterThanOrEqual(44);
  expect(observed.opacity).toBe(1);
  if(await action.isDisabled()){
    await expect(action).toBeDisabled();expect(observed.border).toBe('dashed');expect(observed.cursor).toBe('not-allowed');
    expect(await action.evaluate(element=>{let clicks=0;const count=()=>{clicks++;};element.addEventListener('click',count);(element as HTMLButtonElement).click();element.removeEventListener('click',count);return clicks;})).toBe(0);
  }
  if(focused){expect(observed.focusVisible).toBe(true);expect(observed.outline).not.toBe('none');expect(observed.width).toBeGreaterThanOrEqual(2);expect(observed.focus).toBeGreaterThanOrEqual(3);}
}
async function expectNewbieActions(page:import('@playwright/test').Page){
  const actions=page.locator('.newbie-village .btn');
  expect(await actions.count()).toBeGreaterThanOrEqual(9);
  for(const action of await actions.all()){
    await action.scrollIntoViewIfNeeded();await expect(action).toBeVisible();await expectNewbieActionColors(action);
    if(await action.isEnabled()){
      await action.hover();await expectNewbieActionColors(action);
      await action.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
      await expect(action).toBeFocused();await expectNewbieActionColors(action,true);
    }
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}
for(const profile of ['light','dark','versefolk','guide-dragon','guide-ai-sister'])test(`NEWBIE-004 actual ${profile} actions retain contrast across quiz, results and disabled states`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(value=>localStorage.setItem('freedom-theme',value),profile);
  await page.goto('/#newbie-village');
  await expect(page.locator('html')).toHaveAttribute('data-experience-profile',profile);
  await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[0].q);
  const quiz=page.locator('#nv-quiz');
  await expect(quiz.getByRole('button',{name:'上一題',exact:true})).toBeDisabled();
  await expect(quiz.getByRole('button',{name:'下一題',exact:true})).toBeDisabled();
  await expectNewbieActions(page);
  await quiz.locator('input').first().check();
  const next=quiz.getByRole('button',{name:'下一題',exact:true});
  await expect(next).toBeEnabled();await expectNewbieActionColors(next);await next.hover();await expectNewbieActionColors(next);
  await next.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(next).toBeFocused();await expectNewbieActionColors(next,true);
  await next.press('Enter');await expect(quiz.locator('legend')).toHaveText(QUESTIONS_V2[1].q);
  const previous=quiz.getByRole('button',{name:'上一題',exact:true});await expect(previous).toBeEnabled();await expectNewbieActionColors(previous);
  await previous.click();await expect(quiz.locator('legend')).toHaveText(QUESTIONS_V2[0].q);
  // Complete real UI flow; no production data, fabricated server result or storage bypass.
  for(let i=0;i<15;i++){
    await quiz.locator('input').first().check();
    const advance=quiz.getByRole('button',{name:i===14?'查看結果':'下一題',exact:true});
    await expectNewbieActionColors(advance);await advance.click();
  }
  await expect(page.getByRole('heading',{name:'我的定位草稿',exact:true})).toBeVisible();
  await page.locator('#nv-card').getByLabel('過生活底線',{exact:true}).fill('合成測試：每週三小時');
  await page.locator('#nv-card').getByLabel('第一週行動',{exact:true}).fill('合成測試：寫一份筆記');
  await page.locator('#nv-checkin textarea').fill('合成測試回顧');
  await expect(page.getByRole('button',{name:'複製方向卡草稿',exact:true})).toBeVisible();
  await expectNewbieActions(page);
  await page.setViewportSize({width:320,height:640});await expectNewbieActions(page);
  // Reset remains the existing local-only action and restores real disabled states.
  await page.getByRole('button',{name:'清除本機作答與進度',exact:true}).click();
  await expect(quiz.locator('legend')).toHaveText(QUESTIONS_V2[0].q);
  await expect(quiz.getByRole('button',{name:'下一題',exact:true})).toBeDisabled();
});
