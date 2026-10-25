import {test,expect} from './fixtures.js';
import {CLASSES_V2,CAREER_GUILDS,calculateResult,QUESTIONS_V2,STORAGE_KEY} from '../../modules/newbie-village/index.js';

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
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('每週只投入三小時，不熬夜。');
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

test('NEWBIE-004 quiz result offers first-week actions, guilds and a coaching preview',async({page})=>{
  await page.goto('/#newbie-village');
  await expect(page.getByTestId('nv-next-step')).toHaveCount(0);
  const answers=QUESTIONS_V2.map(()=>[0]);
  for(let i=0;i<QUESTIONS_V2.length;i++){
    await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[i].q);
    await page.locator('#nv-quiz input').first().check();
    await page.locator('#nv-quiz').getByRole('button',{name:i===14?'查看結果':'下一題',exact:true}).click();
  }
  const career=calculateResult(answers).primary;
  const card=page.getByTestId('nv-next-step');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading',{name:'下一步',exact:true})).toBeVisible();
  await expect(card.locator('ol')).toHaveAttribute('lang','zh-Hant');
  await expect(card.locator('ol > li')).toHaveCount(3);
  await expect(card.locator('ol > li')).toHaveText(CLASSES_V2[career].actions);
  const [primary,secondary]=CAREER_GUILDS[career];
  const primaryLink=card.getByRole('link',{name:/主公會/});
  await expect(primaryLink).toHaveAttribute('href',/^#guilds\/guild_/);
  await expect(primaryLink).toHaveAttribute('href',`#guilds/${primary.guildId}`);
  if(secondary)await expect(card.getByRole('link',{name:/副公會/})).toHaveAttribute('href',`#guilds/${secondary.guildId}`);
  await expect(card.locator('p')).toHaveText('陪跑服務即將推出：之後可以找人陪你一起走第一週。');
  await expect(card.locator('p a, p button, input, form')).toHaveCount(0);
});
