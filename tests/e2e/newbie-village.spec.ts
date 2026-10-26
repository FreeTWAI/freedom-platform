import {test,expect,type Page,type Locator} from './fixtures.js';
import {navigate} from './navigation.js';
import {QUESTIONS_V2,STORAGE_KEY,freshProgress} from '../../modules/newbie-village/index.js';

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
      outline:style.outlineStyle,width:parseFloat(style.outlineWidth),opacity:Number(style.opacity),
      focusVisible:element.matches(':focus-visible'),height:element.getBoundingClientRect().height};
  });
  // Disabled controls are exempt from WCAG text contrast. These checks concern
  // their uncomposited theme colors and retained disabled styling, not a WCAG claim.
  expect(observed.text).toBeGreaterThanOrEqual(4.5);
  expect(observed.height).toBeGreaterThanOrEqual(44);
  if(await action.isDisabled())expect(observed.opacity).toBeLessThan(1);
  else expect(observed.opacity).toBe(1);
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

// This supplements action coverage; it does not modify product styles or simulate
// an iOS keyboard. Only real page/ancestor colors are used, not assumed theme tokens.
async function sampleNewbieContent(target:Locator){
  return target.evaluate(element=>{
    type RGBA=[number,number,number,number];
    const parse=(value:string):RGBA=>{
      const values=value.match(/[\d.]+/g)?.map(Number);
      if(!values||values.length<3||!value.startsWith('rgb'))throw Error('Unsupported computed color: '+value);
      return [values[0],values[1],values[2],values[3]??1];
    };
    const over=(top:RGBA,bottom:RGBA):RGBA=>{
      const alpha=top[3]+bottom[3]*(1-top[3]);
      return [0,1,2].map(i=>(top[i]*top[3]+bottom[i]*bottom[3]*(1-top[3]))/alpha).concat(alpha) as RGBA;
    };
    const luminance=(rgb:RGBA)=>{const c=rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
    const ratio=(a:RGBA,b:RGBA)=>{const v=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (v[1]+.05)/(v[0]+.05);};
    const layers:RGBA[]=[];let opaque=false;
    for(let ancestor:Element|null=element;ancestor;ancestor=ancestor.parentElement){
      const style=getComputedStyle(ancestor);
      // One traversal owns both transition settlement and surface composition.
      // Even above an opaque surface, ancestor opacity affects the whole subtree.
      void style.color;
      const colors=ancestor.getAnimations().filter(animation=>animation instanceof CSSTransition&&/^(?:color|background-color|outline-color|border(?:-(?:top|right|bottom|left))?-color)$/.test(animation.transitionProperty));
      if(colors.some(animation=>animation.playState==='paused'))throw Error('Content color transition is paused');
      if(colors.some(animation=>animation.pending||!['finished','idle'].includes(animation.playState)))return {settled:false as const};
      if(Number(style.opacity)!==1)throw Error('Content probe must not ignore ancestor opacity');
      if(!opaque){
        if(style.backgroundImage!=='none')throw Error('Content probe needs image/gradient-aware evidence');
        const layer=parse(style.backgroundColor);layers.push(layer);opaque=layer[3]===1;
      }
    }
    if(layers.at(-1)?.[3]!==1)throw Error('No opaque page surface found');
    let background=layers.pop()!;while(layers.length)background=over(layers.pop()!,background);
    const style=getComputedStyle(element),rect=element.getBoundingClientRect();
    const placeholder=element.getAttribute('placeholder');
    return {settled:true as const,text:ratio(over(parse(style.color),background),background),left:rect.left,right:rect.right,viewport:innerWidth,
      clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,
      isField:element instanceof HTMLTextAreaElement,isPre:element.tagName==='PRE',fontSize:parseFloat(style.fontSize),
      placeholder:placeholder?ratio(over(parse(getComputedStyle(element,'::placeholder').color),background),background):null};
  });
}
async function expectNewbieContent(target:Locator){
  await expect(target).toBeVisible();
  let observed!:Awaited<ReturnType<typeof sampleNewbieContent>>;
  await expect.poll(async()=>{observed=await sampleNewbieContent(target);return observed.settled;}).toBe(true);
  if(!observed.settled)throw Error('Content colors did not settle');
  expect(observed.text).toBeGreaterThanOrEqual(4.5);
  expect(observed.left).toBeGreaterThanOrEqual(-1);expect(observed.right).toBeLessThanOrEqual(observed.viewport+1);
  if(observed.isField||observed.isPre)expect(observed.scrollWidth).toBeLessThanOrEqual(observed.clientWidth+1);
  if(observed.isField)expect(observed.fontSize).toBeGreaterThanOrEqual(16);
  if(observed.placeholder!==null)expect(observed.placeholder).toBeGreaterThanOrEqual(4.5);
}
async function expectNewbieLowerContent(page:Page,completed:boolean){
  const lower=page.locator('#nv-card, #nv-guild, #nv-checkin');
  await expect(lower).toHaveCount(3);
  await expect(lower.locator('textarea')).toHaveCount(3);
  await expect(lower.locator('pre')).toHaveCount(completed?1:0);
  const content=lower.locator('h2, label, p, pre, textarea, strong, span, em, b, small, a:not(.btn)');
  const resultLinks=page.locator('#nv-quiz a:not(.btn)');
  if(completed)expect(await resultLinks.count()).toBeGreaterThan(0);
  else await expect(resultLinks).toHaveCount(0);
  const targets=await content.all();targets.push(...await resultLinks.all());
  if(completed){
    const resultText=page.locator('#nv-quiz :is(h3,h4,p,li,strong,span,em,b,small):visible');
    expect(await resultText.count()).toBeGreaterThan(0);targets.push(...await resultText.all());
  }
  expect(targets.length).toBeGreaterThanOrEqual(10);
  // Measure only an element's direct nonblank text, not a container color as a
  // proxy for differently styled child text. Child spans/strong/em are separate.
  // This does not cover generated pseudo-content, SVG/canvas or font rasterization.
  let measured=0;
  for(const target of targets){
    if(await target.evaluate(element=>element instanceof HTMLTextAreaElement||Array.from(element.childNodes).some(node=>node.nodeType===Node.TEXT_NODE&&!!node.textContent?.trim()))){await expectNewbieContent(target);measured++;}
  }
  expect(measured).toBeGreaterThanOrEqual(10);
  for(const link of await resultLinks.all()){await link.hover();await expectNewbieContent(link);}

  // Focus the actual lower-page controls after scrolling, not only offscreen DOM.
  for(const control of [...await lower.locator('textarea').all(),...await resultLinks.all()]){
    await control.scrollIntoViewIfNeeded();await control.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    await expect(control).toBeFocused();await expectNewbieContent(control);
    const focus=await control.evaluate(element=>{const s=getComputedStyle(element),r=element.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {visible:element.matches(':focus-visible'),outline:s.outlineStyle,width:parseFloat(s.outlineWidth),top:r.top,bottom:r.bottom,height:innerHeight,uncovered:hit===element||!!hit&&element.contains(hit)};});
    expect(focus.visible).toBe(true);expect(focus.outline).not.toBe('none');expect(focus.width).toBeGreaterThanOrEqual(2);
    expect(focus.top).toBeGreaterThanOrEqual(0);expect(focus.bottom).toBeLessThanOrEqual(focus.height);expect(focus.uncovered).toBe(true);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}
for(const profile of ['light','dark','versefolk','guide-dragon','guide-ai-sister'])for(const audience of ['anonymous','member'])for(const width of [320,390])test(`NEWBIE-005 ${audience} ${profile} ${width}px lower content restores long local drafts`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.addInitScript(value=>localStorage.setItem('freedom-theme',value),profile);
  if(audience==='member'){
    await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/auth/login'&&r.request().method()==='POST');
    await page.getByRole('button',{name:'登入',exact:true}).click();expect((await response).status()).toBe(200);
    await expect(page.locator('.home-timeline')).toBeVisible();await navigate(page,'新手村任務');
    await expect(page.locator('.app-frame.social-layout .newbie-village')).toBeVisible();
  }else await page.goto('/#newbie-village');
  await expect(page.locator('html')).toHaveAttribute('data-experience-profile',profile);
  await expect(page.locator('#nv-quiz legend')).toHaveText(QUESTIONS_V2[0].q);
  await expectNewbieLowerContent(page,false);
  // Restoration fixture for this public, local-only progress structure, not an
  // auth/server-result bypass. NEWBIE-001/004 retain the actual 15-question flow.
  const progress={...freshProgress(),answers:QUESTIONS_V2.map(()=>[0]),done:['quiz']};
  await page.evaluate(({key,progress})=>localStorage.setItem(key,JSON.stringify(progress)),{key:STORAGE_KEY,progress});
  await page.reload();
  await expect(page.getByRole('heading',{name:'我的定位草稿',exact:true})).toBeVisible();
  // Local synthetic input only; the long URL is text, never opened or requested.
  const longText=('合成草稿 🌱\nhttps://example.invalid/'+ 'a'.repeat(180)+'\n').repeat(20).slice(0,4000);
  const fields=page.locator('#nv-card textarea, #nv-checkin textarea');await expect(fields).toHaveCount(3);
  for(const field of await fields.all()){await field.fill(longText);await expect(field).toHaveValue(longText);}
  await expect(page.locator('#nv-card pre')).toContainText(longText);
  await expectNewbieLowerContent(page,true);
  await page.reload();await expect(page.locator('#nv-quiz h3')).toHaveText('我的定位草稿');
  for(const field of await fields.all())await expect(field).toHaveValue(longText);
});
