import {test,expect} from './fixtures.js';
import {CLASSES_V2,CAREER_GUILDS,DIMENSIONS,calculateResult,QUESTIONS_V2,STORAGE_KEY,freshProgress} from '../../modules/newbie-village/index.js';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('freedom-interface-language-v1','zh-Hant'));
});
test('NEWBIE-001 complete quiz, write direction card, local quests persist and mobile stays within viewport',async({page})=>{
  await page.goto('/#newbie-village');
  await expect(page.getByRole('heading',{name:'新手村任務',exact:true})).toBeVisible();
  await expect(page.getByText('這不是診斷測驗。',{exact:false})).toBeVisible();
  await page.locator('.nv-step-nav').getByRole('button',{name:'1. 閱讀三維度框架'}).click();
  await page.locator('#nv-framework').getByRole('button',{name:'已閱讀，開始作答'}).click();
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
  await page.getByText('展開完整結果與計分說明',{exact:true}).click();
  await expect(page.locator('.nv-dimensions')).toContainText('做自己');
  await expect(page.locator('.nv-radar')).toBeVisible();
  // First option everywhere plus a second pick on question 14 ranks AI 平台架構師 first; it suggests a primary and a secondary guild.
  await expect(page.locator('#nv-quiz')).toContainText('我的定位草稿AI 平台架構師');
  await page.getByRole('button',{name:'把想法寫成方向卡',exact:true}).click();
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
  await page.locator('#nv-card').getByRole('button',{name:'完成方向卡，繼續探索'}).click();
  await expect(page.locator('#nv-guild a[href="#guilds/guild_platform_engineering"]').first()).toBeVisible();
  await page.locator('#nv-guild').getByRole('button',{name:'我已看過，之後再決定'}).click();
  await page.locator('#nv-checkin textarea').fill('已完成小工具；下週請一位朋友試用。');
  await page.locator('#nv-checkin').getByRole('button',{name:'記下回顧，返回清單'}).click();
  await expect(page.getByRole('status').filter({hasText:'本機進度'})).toHaveText('本機進度 5 / 5');
  await page.reload();
  await expect(page.locator('.nv-quests .badge')).toHaveCount(5);
  await page.locator('.nv-step-nav').getByRole('button',{name:/3. 寫方向卡/}).click();
  await expect(page.locator('#nv-card textarea').first()).toHaveValue('每週只投入三小時，不熬夜。');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'清除本機作答與進度'}).click();
  await page.getByRole('button',{name:'確認清除紀錄',exact:true}).click();
  await expect(page.locator('.nv-quests .badge')).toHaveCount(0);
  await page.reload();
  expect(await page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY)).toBeNull();
  await page.getByRole('button',{name:'開始探索 · 15 題',exact:true}).click();
  await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[0].q);
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
      await page.locator('.nv-step-nav button').nth(2).click();
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
  await page.getByRole('button',{name:'開始探索 · 15 題',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'無法保存到本機'})).toBeVisible();
  await page.locator('#nv-quiz input').first().check();
  await page.getByRole('button',{name:'下一題',exact:true}).click();
  await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[1].q);
});

test('NEWBIE-005 quiz result shows next-step actions and suggested guild links once',async({page})=>{
  await page.goto('/#newbie-village');
  await expect(page.getByTestId('nv-next-step')).toHaveCount(0);
  await page.getByRole('button',{name:'開始探索 · 15 題',exact:true}).click();
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
  await expect(card.locator('ol > li > p')).toHaveText(CLASSES_V2[career].actions);
  for(const action of CLASSES_V2[career].actions)await expect(screen.getByText(action,{exact:true})).toHaveCount(1);
  await page.locator('.nv-step-nav').getByRole('button',{name:/4\./}).click();
  const guildScreen=page.locator('#nv-guild');
  for(const c of suggestedCareers)for(const guild of CAREER_GUILDS[c]){
    await expect(guildScreen.getByRole('link',{name:guild.name,exact:true})).toHaveCount(1);
    await expect(guildScreen.getByRole('link',{name:guild.name,exact:true})).toHaveAttribute('href',`#guilds/${guild.guildId}`);
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
  const actions=page.locator('.newbie-village .btn:visible');
  await expect.poll(()=>actions.count()).toBeGreaterThanOrEqual(9);
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
  await expectNewbieActions(page);
  await page.getByRole('button',{name:'開始探索 · 15 題',exact:true}).click();
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
  await expectNewbieActions(page);
  await page.getByRole('button',{name:'把想法寫成方向卡',exact:true}).click();
  await page.locator('#nv-card').getByLabel('過生活底線',{exact:true}).fill('合成測試：每週三小時');
  await page.locator('#nv-card').getByLabel('第一週行動',{exact:true}).fill('合成測試：寫一份筆記');
  await expect(page.getByRole('button',{name:'複製方向卡草稿',exact:true})).toBeVisible();
  await expectNewbieActions(page);
  await page.setViewportSize({width:320,height:640});await expectNewbieActions(page);
  // Reset remains the existing local-only action and restores real disabled states.
  await page.getByRole('button',{name:'清除本機作答與進度',exact:true}).click();
  await page.getByRole('button',{name:'確認清除紀錄',exact:true}).click();
  await page.getByRole('button',{name:'開始探索 · 15 題',exact:true}).click();
  await expect(quiz.locator('legend')).toHaveText(QUESTIONS_V2[0].q);
  await expect(quiz.getByRole('button',{name:'下一題',exact:true})).toBeDisabled();
});

test('NEWBIE-006 optional card path, browser back/forward and reload preserve drafts without quiz',async({page})=>{
  await page.goto('/#newbie-village');
  await expect(page.locator('#nv-quiz')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'先逛公會，不做測驗'})).toHaveAttribute('href','#guilds');
  await page.locator('.nv-step-nav').getByRole('button',{name:/3\. 寫方向卡/}).click();
  const card=page.locator('#nv-card');
  await card.getByRole('textbox',{name:'過生活底線',exact:true}).fill('只投入週末');
  await card.getByRole('textbox',{name:'第一週行動',exact:true}).fill('完成一份筆記');
  await card.getByRole('button',{name:'完成方向卡，繼續探索'}).click();
  await expect(page.locator('#nv-guild')).toBeVisible();
  await expect(page.locator('#nv-guild a[href^="#guilds/"]')).toHaveCount(0);
  await page.goBack();
  await expect(card.getByRole('textbox',{name:'第一週行動',exact:true})).toHaveValue('完成一份筆記');
  await page.goForward();
  await expect(page.locator('#nv-guild')).toBeVisible();
  await page.reload();
  await expect(page.locator('#nv-guild')).toBeVisible();
  await page.locator('.nv-step-nav').getByRole('button',{name:/3\. 寫方向卡/}).click();
  await expect(card.getByRole('textbox',{name:'過生活底線',exact:true})).toHaveValue('只投入週末');
  const history=await page.evaluate(()=>JSON.stringify(window.history.state));
  expect(history).not.toContain('只投入週末');expect(history).not.toContain('完成一份筆記');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).answers.every((a:number[])=>a.length===0),STORAGE_KEY)).toBe(true);
});

test('NEWBIE-007 legacy answers continue at first gap; edit, reload and previous keep selected answers',async({page})=>{
  const progress={...freshProgress(),answers:QUESTIONS_V2.map((_,i)=>i<4?[0]:[]),baseline:'保留原卡片'};
  await page.goto('/#newbie-village');
  await page.evaluate(({key,progress})=>localStorage.setItem(key,JSON.stringify(progress)),{key:STORAGE_KEY,progress});
  await page.reload();
  await page.getByRole('button',{name:'繼續上次作答'}).click();
  await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[4].q);
  await page.locator('#nv-quiz input').nth(1).check();
  await page.getByRole('button',{name:'下一題',exact:true}).click();
  await expect(page.locator('#nv-quiz legend')).toBeFocused();
  await page.reload();
  await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[5].q);
  await page.getByRole('button',{name:'上一題',exact:true}).click();
  await expect(page.locator('#nv-quiz input').nth(1)).toBeChecked();
  await page.locator('.nv-step-nav').getByRole('button',{name:/3\. 寫方向卡/}).click();
  await expect(page.locator('#nv-card textarea').first()).toHaveValue('保留原卡片');
});

test('NEWBIE-008 clear cancel, failure, retry and back never resurrect answers',async({page})=>{
  await page.goto('/#newbie-village');
  await page.getByRole('button',{name:'開始探索 · 15 題',exact:true}).click();
  await page.locator('#nv-quiz input').first().check();
  const clear=page.getByRole('button',{name:'清除本機作答與進度',exact:true});
  await clear.click();
  await expect(page.getByRole('button',{name:'取消，保留紀錄'})).toBeFocused();
  await page.keyboard.press('Escape');await expect(clear).toBeFocused();
  await expect(page.locator('#nv-quiz input').first()).toBeChecked();
  await page.evaluate(()=>{
    const original=Storage.prototype.removeItem;
    Storage.prototype.removeItem=function(key){if(key==='freedom-newbie-village-v1')throw new DOMException('Blocked','SecurityError');original.call(this,key)};
    (window as any).restoreVillageRemoval=()=>{Storage.prototype.removeItem=original};
  });
  const before=await page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY);
  await clear.click();await page.getByRole('button',{name:'確認清除紀錄',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'清除失敗'})).toBeVisible();
  await expect(page.locator('#nv-quiz input').first()).toBeChecked();
  expect(await page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY)).toBe(before);
  await page.evaluate(()=>(window as any).restoreVillageRemoval());
  await page.getByRole('button',{name:'確認清除紀錄',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'已清除這個瀏覽器'})).toBeVisible();
  expect(await page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY)).toBeNull();
  await page.goBack();await page.goForward();
  await page.locator('.nv-step-nav').getByRole('button',{name:/2\. 完成 15 題測驗/}).click();
  await expect(page.locator('#nv-quiz input').first()).not.toBeChecked();
  await expect(page.getByRole('button',{name:'下一題',exact:true})).toBeDisabled();
});

test('NEWBIE-009 unreadable storage never overwrites old answers while in-memory editing remains usable',async({page})=>{
  const progress={...freshProgress(),baseline:'舊卡片不可被覆蓋'};
  await page.goto('/#newbie-village');
  await page.evaluate(({key,progress})=>localStorage.setItem(key,JSON.stringify(progress)),{key:STORAGE_KEY,progress});
  await page.addInitScript(()=>{
    const get=Storage.prototype.getItem;
    Storage.prototype.getItem=function(key){if(key==='freedom-newbie-village-v1')throw new DOMException('Blocked','SecurityError');return get.call(this,key)};
    (window as any).readOriginalVillage=()=>get.call(localStorage,'freedom-newbie-village-v1');
  });
  await page.reload();
  await expect(page.getByRole('alert').filter({hasText:'無法讀取本機紀錄'})).toBeVisible();
  await page.locator('.nv-step-nav').getByRole('button',{name:/3\. 寫方向卡/}).click();
  await page.locator('#nv-card textarea').first().fill('本輪暫存');
  await page.locator('.nv-step-nav').getByRole('button',{name:/5\./}).click();
  await page.locator('.nv-step-nav').getByRole('button',{name:/3\./}).click();
  await expect(page.locator('#nv-card textarea').first()).toHaveValue('本輪暫存');
  expect(await page.evaluate(()=>JSON.parse((window as any).readOriginalVillage()).baseline)).toBe('舊卡片不可被覆蓋');
  await expect(page.getByText('已保存到這個瀏覽器',{exact:true})).toHaveCount(0);
});

test('NEWBIE-010 result actions never replace an existing card and clipboard failure keeps a manual copy',async({page})=>{
  const progress={...freshProgress(),answers:QUESTIONS_V2.map(()=>[0]),done:['quiz'],baseline:'我的底線',action:'我原本的行動',journey:{step:'quiz',index:14,result:true}};
  await page.goto('/#newbie-village');
  await page.evaluate(({key,progress})=>localStorage.setItem(key,JSON.stringify(progress)),{key:STORAGE_KEY,progress});
  await page.reload();
  await page.getByTestId('nv-next-step').locator('ol button').first().click();
  await expect(page.locator('#nv-card textarea').nth(1)).toHaveValue('我原本的行動');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))}}));
  await page.getByRole('button',{name:'複製方向卡草稿',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'無法複製'})).toBeVisible();
  await expect(page.locator('#nv-card pre')).toContainText('我原本的行動');
});

for(const member of [false,true])test(`NEWBIE-011 ${member?'member shell':'anonymous'} external guild visit then older history entry restores its own workspace, not latest cursor`,async({page})=>{
  if(member){
    await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
    await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
    await page.getByRole('button',{name:'登入',exact:true}).click();
    await expect(page.locator('.shell')).toBeVisible();
  }
  await page.goto('/#newbie-village');
  await page.locator('.nv-step-nav').getByRole('button',{name:/3\. 寫方向卡/}).click();
  await page.locator('#nv-card textarea').first().fill('跨頁保留');
  await page.locator('.nv-step-nav').getByRole('button',{name:/4\./}).click();
  await page.locator('#nv-guild a[href="#guilds"]').click();
  await expect(page).toHaveURL(/#guilds$/);
  await page.goBack();await expect(page.locator('#nv-guild')).toBeVisible();
  await page.goBack();await expect(page.locator('#nv-card')).toBeVisible();
  await expect(page.locator('#nv-card textarea').first()).toHaveValue('跨頁保留');
  await page.reload();await expect(page.locator('#nv-card')).toBeVisible();
  await page.goForward();await expect(page.locator('#nv-guild')).toBeVisible();
  await page.goForward();await expect(page).toHaveURL(/#guilds$/);
  await page.goBack();await expect(page.locator('#nv-guild')).toBeVisible();
});

for(const member of [false,true])test(`NEWBIE-012 ${member?'member shell':'anonymous owned links'} confirms unsaved departure and offers a copyable backup`,async({page})=>{
  await page.addInitScript(()=>{
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='freedom-newbie-village-v1')throw new DOMException('Blocked','QuotaExceededError');return set.call(this,key,value)};
  });
  if(member){
    await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
    await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
    await page.getByRole('button',{name:'登入',exact:true}).click();
    await expect(page.locator('.shell')).toBeVisible();
  }
  await page.goto('/#newbie-village');
  await page.locator('.nv-step-nav').getByRole('button',{name:/3\./}).click();
  await page.locator('#nv-card textarea').first().fill('未保存的生活安排');
  await page.getByText('複製備份：展開後選取文字自行保存',{exact:true}).click();
  await expect(page.getByRole('textbox',{name:'複製備份：展開後選取文字自行保存'})).toHaveValue(/未保存的生活安排/);
  await page.locator('.nv-step-nav').getByRole('button',{name:/4\./}).click();
  page.once('dialog',dialog=>{expect(dialog.type()).toBe('confirm');expect(dialog.message()).toContain('尚未保存');void dialog.dismiss()});
  await page.locator('#nv-guild a[href="#guilds"]').click();
  await expect(page.locator('#nv-guild')).toBeVisible();
  await expect(page).toHaveURL(/#newbie-village$/);
  expect(await page.evaluate(()=>history.state.freedomNewbieView.step)).toBe('guild');
  // Repeated cancellation must retain the accepted cursor and the same draft.
  page.once('dialog',dialog=>{expect(dialog.type()).toBe('confirm');void dialog.dismiss()});
  await page.locator('#nv-guild a[href="#guilds"]').click();
  await expect(page.locator('#nv-guild')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'複製備份：展開後選取文字自行保存'})).toHaveValue(/未保存的生活安排/);
  expect(await page.evaluate(()=>history.state.freedomNewbieView.step)).toBe('guild');
  // Reload uses the browser's native beforeunload safeguard, not a fake saved result.
  const unload=page.waitForEvent('dialog');
  // A cancelled reload has no load event: do not await navigation completion.
  await page.evaluate(()=>{setTimeout(()=>window.location.reload(),0)});
  const dialog=await unload;expect(dialog.type()).toBe('beforeunload');await dialog.dismiss();
  await expect(page.locator('#nv-guild')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'複製備份：展開後選取文字自行保存'})).toHaveValue(/未保存的生活安排/);
  await expect(page).toHaveURL(/#newbie-village$/);
  page.once('dialog',dialog=>{expect(dialog.type()).toBe('confirm');void dialog.accept()});
  await page.locator('#nv-guild a[href="#guilds"]').click();
  await expect(page).toHaveURL(/#guilds$/);
});
