import {test,expect,type Page} from './fixtures.js';
import {navigate} from './navigation.js';
import {FEATURE_SEARCH_EXAMPLES,TESTER_AREAS} from '../../modules/tester-map/index.js';
import {interfaceMessages} from '../../apps/portal-web/src/interface-messages.js';

const areaName=(page:Page,name:string)=>page.getByRole('region',{name,exact:true});
const noHorizontalOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);

test('TESTER-001 signed-out visitors read the static tester map with owners, statuses and the GitHub reporting path',async({page})=>{
  await page.goto('/#tester-map');
  await expect(page.getByRole('heading',{level:1,name:'測試員地圖',exact:true})).toBeVisible();
  await expect(page.getByText('由人才與方向公會（公會長：我不是JasonC）協調',{exact:false})).toBeVisible();
  for(const area of TESTER_AREAS)await expect(areaName(page,area.name[0])).toBeVisible();
  const entry=areaName(page,'入口、註冊與加入');
  await expect(entry.getByText('A · 新朋友・手機',{exact:true})).toBeVisible();
  await expect(entry.locator('[data-feature-id="entry.preview"]')).toContainText('改版優先 · #1004');
  await expect(entry.locator('[data-feature-id="entry.demo"]')).toContainText('預設關閉');
  await expect(entry.locator('[data-feature-id="entry.preview"]')).toContainText('未測');
  await expect(entry.locator('[data-feature-id="entry.newbie-village"]')).toContainText('未測');
  await expect(entry.locator('[data-feature-id="entry.newbie-village"] a')).toHaveAttribute('href','#newbie-village');
  await expect(areaName(page,'管理與權限').locator('[data-feature-id="admin.console"]')).toContainText('需平台管理員');
  const report=page.getByRole('region',{name:'怎麼回報',exact:true});
  await expect(report).toContainText('「想法」');
  await expect(report).toContainText('站內檢舉目前未開放');
  // The arrow is decorative; the accessible name states that the link opens a new tab.
  const issues=report.getByRole('link',{name:'搜尋 GitHub Issues （在新分頁開啟）',exact:true});
  await expect(issues).toHaveAttribute('href','https://github.com/FreeTWAI/freedom-platform/issues');
  await expect(issues).toHaveAttribute('target','_blank');
  await expect(issues).toHaveAttribute('rel','noopener noreferrer');
  await expect(issues).toContainText('↗');
  await expect(page.getByRole('region',{name:'怎麼加入',exact:true}).getByRole('link',{name:'人才與方向公會頁',exact:true})).toHaveAttribute('href','#guilds/guild_talent_direction');
  // Group E owns commerce and contribution; the filter only hides other areas.
  await page.getByLabel('顯示小組',{exact:true}).selectOption('E');
  await expect(areaName(page,'供貨、商店與訂單')).toBeVisible();
  await expect(areaName(page,'入口、註冊與加入')).toHaveCount(0);
  await page.getByLabel('只看改版優先',{exact:true}).check();
  await expect(page.getByText('這個篩選沒有項目。',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.getByRole('link',{name:'返回登入',exact:true}).click();
  await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();
});

test('TESTER-002 the tester map follows the selected interface language',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL});
  await context.addInitScript(()=>localStorage.setItem('freedom-interface-language-v1','en'));
  const page=await context.newPage();
  try{
    await page.goto('/#tester-map');
    await expect(page.getByRole('heading',{level:1,name:'Tester map',exact:true})).toBeVisible();
    await expect(areaName(page,'Entry, sign-up and joining')).toContainText('Redesign priority · #1004');
    await expect(page.getByRole('region',{name:'How to report',exact:true})).toContainText('In-site reporting is not enabled');
  }finally{await context.close()}
});

test('TESTER-003 members open the tester map from the community page and the feature search',async({page})=>{
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('heading',{name:'會員首頁',level:1,exact:true})).toBeVisible();
  await navigate(page,'自由工坊社群');
  await page.getByRole('region',{name:'社群測試週',exact:true}).getByRole('button',{name:'查看測試員地圖',exact:true}).click();
  await expect(page.getByRole('heading',{level:1,name:'測試員地圖',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/#tester-map$/);
  await expect(areaName(page,'訊息與聊天').locator('[data-feature-id="chat.stickers"]')).toContainText('改版優先 · #1013');
  await navigate(page,'會員首頁');
  await navigate(page,'測試員地圖');
  await expect(page.getByRole('heading',{level:1,name:'測試員地圖',exact:true})).toBeVisible();
});

test('TESTER-004 a tester follows the guided path, completes a step, keeps progress after reload and can reset it',async({page})=>{
  await page.goto('/#tester-map');
  const quest=page.getByRole('region',{name:'測試任務路線',exact:true});
  await expect(quest).toContainText('未登入時，進度與勳章只存在這台裝置');
  await expect(page.getByText('排行榜：規劃中，需團隊協調',{exact:false})).toHaveCount(0);
  const total=await page.locator('[data-step-id]').count();
  await expect(quest.getByText(`整體進度：0／${total} 步`,{exact:true})).toBeVisible();
  await quest.getByRole('radio',{name:/^A · 新朋友・手機/}).check();
  await expect(quest.getByRole('heading',{name:'建議路線',exact:true})).toBeVisible();
  await expect(quest.getByText('這組請用手機測試。',{exact:true})).toBeVisible();
  const stage=quest.locator('[data-stage-id="arrival"]');
  await expect(stage).toHaveJSProperty('open',true);
  const step=stage.locator('[data-step-id="arrival.preview"]');
  await expect(step).toContainText('試試看');await expect(step).toContainText('確認');await expect(step).toContainText('「想法」');
  const done=step.getByRole('button',{name:'完成這一步',exact:true});
  await expect(done).toHaveAttribute('aria-pressed','false');
  await done.click();
  await expect(quest.getByText(`整體進度：1／${total} 步`,{exact:true})).toBeVisible();
  await expect(stage.locator('summary')).toContainText('1／6 步');
  const village=stage.locator('[data-step-id="arrival.newbie-village"]');
  await expect(village.getByRole('link')).toHaveAttribute('href','#newbie-village');
  await expect(village).toContainText('本機進度與勳章不是官方完成或入會紀錄。');
  await expect(quest.getByRole('status')).toContainText('已完成「不登入先看看」');
  await expect(quest.getByRole('status')).toContainText('獲得勳章：第一步');
  const medal=page.locator('[data-medal-id="first-step"]');
  await expect(medal).toContainText('已獲得');
  await page.reload();
  await expect(page.getByRole('heading',{level:1,name:'測試員地圖',exact:true})).toBeVisible();
  await expect(quest.getByText(`整體進度：1／${total} 步`,{exact:true})).toBeVisible();
  await expect(quest.getByRole('radio',{name:/^A · 新朋友・手機/})).toBeChecked();
  await expect(step.getByRole('button',{name:'取消完成',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(medal).toContainText('已獲得');
  // Keyboard only: opening the confirmation moves focus into it; dismissing returns it.
  const resetButton=page.getByRole('button',{name:'清除本機進度',exact:true});
  await resetButton.focus();
  await page.keyboard.press('Enter');
  const cancel=page.getByRole('button',{name:'取消',exact:true}),confirm=page.getByRole('button',{name:'確定清除',exact:true});
  await expect(cancel).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('確定清除這台裝置上的進度與勳章？');
  await page.keyboard.press('Enter');
  await expect(resetButton).toBeFocused();
  await expect(quest.getByText(`整體進度：1／${total} 步`,{exact:true})).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(quest.getByText(`整體進度：0／${total} 步`,{exact:true})).toBeVisible();
  await expect(medal).toContainText('未獲得');
  await expect(resetButton).toBeFocused();
  expect(await page.evaluate(()=>localStorage.getItem('freedom-tester-map-progress-v1'))).toBeNull();
  await page.setViewportSize({width:390,height:844});
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('TESTER-005 the feature-search words in the quest find their pages in all five languages',async({page})=>{
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('heading',{name:'會員首頁',level:1,exact:true})).toBeVisible();
  const languages=['zh-Hant','en','ja','ko','es'] as const;
  for(const [index,language] of languages.entries()){
    await page.evaluate(value=>localStorage.setItem('freedom-interface-language-v1',value),language);
    await page.reload();
    const navigation=page.getByRole('navigation',{name:interfaceMessages['nav.main'][index],exact:true});
    await expect(navigation).toBeVisible();
    for(const {tab,term} of FEATURE_SEARCH_EXAMPLES){
      const more=navigation.locator('.nav-more');
      if(!await more.evaluate(element=>(element as HTMLDetailsElement).open))await more.locator(':scope > summary').click();
      const search=navigation.getByRole('searchbox',{name:interfaceMessages['nav.search'][index],exact:true});
      await search.fill(term[index]);
      const results=navigation.getByRole('region',{name:interfaceMessages['nav.results'][index],exact:true});
      await expect(results.getByRole('button',{name:interfaceMessages[`nav.${tab}`][index],exact:true}),`${language}: ${term[index]}`).toBeVisible();
      // Esc clears the query first, as the step tells testers to check.
      await search.press('Escape');
      await expect(search).toHaveValue('');
    }
  }
});
