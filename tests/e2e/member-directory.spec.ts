import { navigate } from './navigation.js';
import {test,expect,type Page} from './fixtures.js';

const guilds=[{guild_key:'engineering',name:'平台工程公會'},{guild_key:'media',name:'媒體自動化公會'}];
function member(index:number,extra:Record<string,unknown>={}){return {user_id:`20000000-0000-4000-8000-${String(index).padStart(12,'0')}`,nickname:`夥伴 ${String(index).padStart(2,'0')}`,positioning_title:'共同創作者',primary_guild:{...guilds[0],joined_at:'2026-09-22T10:00:00Z'},secondary_guilds:[{...guilds[1],joined_at:'2026-09-23T10:00:00Z'}],capabilities:['typescript','react','node','python'],featured_capabilities:['typescript','react','node'],custom_capabilities:['活動企劃'],equipment:['codex'],custom_equipment:[],contacts:{},is_self:false,friendship:{state:'none'},joined_at:'2026-09-23T10:00:00Z',...extra};}
async function openDirectory(page:Page){await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await navigate(page, '工坊夥伴');return page.locator('.members-panel');}
test.beforeEach(async({page})=>{
  await page.route('**/api/v1/guilds/directory',route=>route.fulfill({json:{items:guilds}}));
  await page.route('**/api/v1/friends/directory?*',route=>route.fulfill({json:{items:[],total:0,next_offset:null}}));
  await page.route('**/api/v1/me/github',route=>route.fulfill({json:{configured:false,connected:false,github_user:null}}));
  await page.route('**/api/v1/members/*/social-links?*',route=>route.fulfill({json:{items:[],total:0,next_offset:null}}));
});

test('member filters and pagination keep the server query together and reset to newest',async({page})=>{
  const requests:URLSearchParams[]=[];
  await page.route('**/api/v1/members?*',route=>{
    const q=new URL(route.request().url()).searchParams;requests.push(q);const offset=Number(q.get('offset'));
    if(q.get('search')==='企劃'&&q.get('capability')==='typescript'&&q.get('guild_key')==='media'&&q.get('primary_guild_key')==='media'&&q.get('sort')==='oldest')return route.fulfill({json:{items:offset?[member(21,{nickname:'第 21 位企劃夥伴'})]:Array.from({length:20},(_,index)=>member(index+1)),next_offset:offset?null:20,total:21}});
    return route.fulfill({json:{items:[member(1)],next_offset:null,total:1}});
  });
  const panel=await openDirectory(page);await expect(panel.locator('.directory-result-count')).toHaveText('顯示 1–1 / 1 位夥伴');expect(requests[0].get('sort')).toBe('newest');
  await panel.locator('.directory-advanced > summary').click();await panel.getByRole('searchbox',{name:'搜尋夥伴',exact:true}).fill('企劃');await expect(panel.getByRole('combobox',{name:'依專長篩選',exact:true}).locator('option[value="typescript"]')).toHaveCount(1);await panel.getByRole('combobox',{name:'依專長篩選',exact:true}).selectOption('typescript');await panel.getByRole('combobox',{name:'依公會篩選',exact:true}).selectOption('media');await panel.getByRole('combobox',{name:'依主要定位篩選',exact:true}).selectOption('media');await panel.getByRole('combobox',{name:'排序方式',exact:true}).selectOption('oldest');await panel.getByRole('button',{name:'搜尋',exact:true}).click();
  await expect(panel.locator('.directory-member')).toHaveCount(20);await expect(panel.locator('.directory-result-count')).toHaveText('顯示 1–20 / 21 位夥伴');await panel.getByRole('button',{name:'下一頁',exact:true}).click();await expect(panel.getByRole('heading',{name:'第 21 位企劃夥伴',exact:true})).toBeVisible();await expect(panel.locator('.directory-result-count')).toHaveText('顯示 21–21 / 21 位夥伴');await expect(panel.getByRole('button',{name:'下一頁',exact:true})).toBeDisabled();
  const continuation=requests.find(q=>q.get('offset')==='20')!;expect(continuation.get('search')).toBe('企劃');expect(continuation.get('capability')).toBe('typescript');expect(continuation.get('guild_key')).toBe('media');expect(continuation.get('primary_guild_key')).toBe('media');expect(continuation.get('sort')).toBe('oldest');expect(continuation.get('limit')).toBe('20');
  await panel.getByRole('button',{name:'重設篩選',exact:true}).click();await expect(panel.getByRole('searchbox',{name:'搜尋夥伴',exact:true})).toHaveValue('');await expect(panel.getByRole('combobox',{name:'依專長篩選',exact:true})).toHaveValue('');await expect(panel.getByRole('combobox',{name:'依公會篩選',exact:true})).toHaveValue('');await expect(panel.getByRole('combobox',{name:'依主要定位篩選',exact:true})).toHaveValue('');await expect(panel.getByRole('combobox',{name:'排序方式',exact:true})).toHaveValue('newest');await expect(panel.locator('.directory-member')).toHaveCount(1);
  expect(requests.at(-1)!.has('search')).toBe(false);expect(requests.at(-1)!.has('capability')).toBe(false);expect(requests.at(-1)!.has('guild_key')).toBe(false);expect(requests.at(-1)!.has('primary_guild_key')).toBe(false);
  await panel.getByRole('combobox',{name:'每頁顯示',exact:true}).selectOption('10');await expect.poll(()=>requests.at(-1)!.get('limit')).toBe('10');
  await panel.getByRole('combobox',{name:'排序方式',exact:true}).selectOption('positioning');await expect.poll(()=>requests.at(-1)!.get('sort')).toBe('positioning');
  await panel.getByRole('combobox',{name:'排序方式',exact:true}).selectOption('guild');await expect.poll(()=>requests.at(-1)!.get('sort')).toBe('guild');
});

test('member row opens a private conversation with the selected person',async({page})=>{
  const peer='20000000-0000-4000-8000-000000000002',reads:string[]=[];
  await page.route('**/api/v1/members?*',route=>route.fulfill({json:{items:[member(1,{user_id:peer,nickname:'私訊目標'})],next_offset:null,total:1}}));
  await page.route('**/api/v1/me/conversations?*',route=>route.fulfill({json:{items:[],unread_count:0,next_offset:null}}));
  await page.route(`**/api/v1/me/conversations/${peer}/activity`,route=>route.fulfill({json:{last_message_id:null,unread_count:0,can_send:true}}));
  await page.route(/\/api\/v1\/me\/conversations\/[^/]+\/messages\?/,route=>{reads.push(route.request().url());return route.fulfill({json:{participant:{user_id:peer,display_name:'私訊目標',avatar_url:null},can_send:true,items:[],next_offset:null,unread_count:0}});});
  const panel=await openDirectory(page);
  await panel.getByRole('button',{name:'私訊使用者',exact:true}).click();
  await expect(page).toHaveURL(/#members$/);await expect(page.locator('.floating-message-panel')).toBeVisible();
  await expect(page.getByRole('tab',{name:/私人訊息/})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('heading',{name:'與 私訊目標 的對話'})).toBeVisible();
  expect(reads).toHaveLength(1);expect(reads[0]).toContain(peer);
});

test('older filter responses never overwrite a newer guild selection',async({page})=>{
  let release!:()=>void,requested!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{requested=resolve;});
  await page.route('**/api/v1/members?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('guild_key')==='media')return route.fulfill({json:{items:[member(2,{nickname:'目前選取的公會夥伴'})],next_offset:null,total:1}});
    requested();await pending;await route.fulfill({json:{items:[member(1,{nickname:'過期回應的夥伴'})],next_offset:null,total:1}});
  });
  const panel=await openDirectory(page);await started;await panel.locator('.directory-advanced > summary').click();await panel.getByRole('combobox',{name:'依公會篩選',exact:true}).selectOption('media');await expect(panel.getByRole('heading',{name:'目前選取的公會夥伴',exact:true})).toBeVisible();const delivered=page.waitForResponse(response=>response.url().includes('/api/v1/members?')&&!new URL(response.url()).searchParams.has('guild_key'));release();await delivered;await expect(panel.getByRole('heading',{name:'目前選取的公會夥伴',exact:true})).toBeVisible();await expect(panel.getByRole('heading',{name:'過期回應的夥伴',exact:true})).toHaveCount(0);
});

test('an old page response cannot replace members after the search changes',async({page})=>{
  let release!:()=>void,requested!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{requested=resolve;});
  await page.route('**/api/v1/members?*',async route=>{
    const query=new URL(route.request().url()).searchParams;
    if(query.get('search')==='剪輯')return route.fulfill({json:{items:[member(30,{nickname:'剪輯夥伴'})],next_offset:null,total:1}});
    if(query.get('offset')==='20'){requested();await pending;return route.fulfill({json:{items:[member(21,{nickname:'舊頁尾夥伴'})],next_offset:null,total:21}});}
    return route.fulfill({json:{items:Array.from({length:20},(_,index)=>member(index+1)),next_offset:20,total:21}});
  });
  const panel=await openDirectory(page);await panel.getByRole('button',{name:'下一頁',exact:true}).click();await started;await panel.getByRole('searchbox',{name:'搜尋夥伴',exact:true}).fill('剪輯');await expect(panel.getByRole('heading',{name:'剪輯夥伴',exact:true})).toBeVisible();const delivered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/members'&&new URL(response.url()).searchParams.get('offset')==='20');release();await delivered;await expect(panel.locator('.directory-member')).toHaveCount(1);await expect(panel.getByRole('heading',{name:'舊頁尾夥伴',exact:true})).toHaveCount(0);await expect(panel.locator('.directory-result-count')).toHaveText('顯示 1–1 / 1 位夥伴');
});

test('compact rows keep three skills visible and fold permitted contact and guild dates on desktop and phone',async({page})=>{
  await page.route('**/api/v1/members?*',route=>route.fulfill({json:{items:[member(1,{nickname:'一位有很長暱稱的影音與活動共創夥伴',contacts:{discord:'visible-handle'},login_email:'private@example.test',joined_at:'2026-09-22T16:00:00.000Z',joined_at_source:'launch_day'}),member(2,{nickname:'隱私夥伴',joined_at:null})],next_offset:null,total:2}}));
  const panel=await openDirectory(page),row=panel.locator('.directory-member').first();await expect(row.locator('.directory-member-skills .pill')).toHaveCount(3);const details=row.locator('.directory-member-details');await expect(details).not.toHaveAttribute('open');await expect(row.getByText('visible-handle',{exact:true})).not.toBeVisible();await expect(row.locator('.directory-member-meta time')).toHaveText('2026/09/23');await expect(panel).not.toContainText('private@example.test');
  await details.locator(':scope > summary').click();await expect(row.getByText('visible-handle',{exact:true})).toBeVisible();await expect(row.getByRole('heading',{name:'公會加入紀錄',exact:true})).toBeVisible();await expect(row.locator('.directory-guild-dates time')).toHaveText(['2026/09/22','2026/09/23']);await expect(row.getByText('活動企劃',{exact:true})).toBeVisible();
  const privateRow=panel.getByRole('article',{name:'隱私夥伴',exact:true});await privateRow.getByText('更多資料',{exact:true}).click();await expect(privateRow).toContainText('沒有對你公開的聯絡方式');await expect(privateRow.locator('.directory-member-meta')).toContainText('加入日期未記錄');
  await details.locator(':scope > summary').click();await privateRow.getByText('更多資料',{exact:true}).click();
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/member-directory-desktop.png',fullPage:true});
  await page.setViewportSize({width:768,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/member-directory-tablet.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/member-directory-phone.png',fullPage:true});
  await page.setViewportSize({width:320,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await navigate(page, '我的名片');await expect(page.locator('.account-panel .member-card')).toHaveCount(1);await expect(page.locator('.account-panel .directory-member')).toHaveCount(0);await expect(page.getByLabel('社群顯示名稱',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'儲存修改',exact:true})).toBeVisible();
});

test('empty search and retry states remain distinct and keep the selected filters',async({page})=>{
  let broken=false;const queries:URLSearchParams[]=[];
  await page.route('**/api/v1/members?*',route=>{const query=new URL(route.request().url()).searchParams;queries.push(query);return broken?route.fulfill({status:503,json:{detail:'夥伴清單暫時無法讀取。'}}):route.fulfill({json:{items:query.has('search')?[]:[member(1)],next_offset:null,total:query.has('search')?0:1}});});
  const panel=await openDirectory(page);await panel.getByRole('searchbox',{name:'搜尋夥伴',exact:true}).fill('不存在的專長');await expect(panel.getByText('沒有符合的夥伴。換個關鍵字、專長或公會試試。',{exact:true})).toBeVisible();broken=true;await panel.locator('.directory-advanced > summary').click();await panel.getByRole('combobox',{name:'排序方式',exact:true}).selectOption('nickname');await expect(panel.getByRole('alert')).toContainText('服務暫時無法回應（503）。請稍後重試。');await expect(panel.getByText('沒有符合的夥伴。換個關鍵字、專長或公會試試。',{exact:true})).toHaveCount(0);broken=false;await panel.getByRole('button',{name:'重新載入夥伴',exact:true}).click();await expect(panel.getByRole('alert')).toHaveCount(0);await expect(panel.locator('.directory-result-count')).toHaveText('顯示 0–0 / 0 位夥伴');expect(queries.at(-1)!.get('sort')).toBe('nickname');expect(queries.at(-1)!.get('search')).toBe('不存在的專長');await panel.getByRole('button',{name:'查看全部夥伴',exact:true}).click();await expect(panel.locator('.directory-member')).toHaveCount(1);
});


test('search starts compact and advanced settings stay visible as removable chips when folded',async({page})=>{
  const queries:URLSearchParams[]=[];
  await page.route('**/api/v1/members?*',route=>{queries.push(new URL(route.request().url()).searchParams);return route.fulfill({json:{items:[member(1)],next_offset:null,total:1}});});
  const panel=await openDirectory(page),advanced=panel.locator('.directory-advanced'),summary=advanced.locator('summary'),search=panel.getByRole('searchbox',{name:'搜尋夥伴',exact:true});
  await expect(panel.getByRole('heading',{name:'找夥伴',exact:true})).toBeVisible();
  await expect(panel.locator('.directory-member')).toHaveCount(1);
  await expect(advanced).not.toHaveAttribute('open');
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  const beforeToggle=queries.length;
  await summary.focus();await page.keyboard.press('Enter');await expect(advanced).toHaveAttribute('open','');
  await expect(panel.getByRole('combobox')).toHaveCount(5);
  await summary.press('Enter');await expect(advanced).not.toHaveAttribute('open');
  expect(queries).toHaveLength(beforeToggle);
  await summary.press('Enter');
  await panel.getByRole('combobox',{name:'依公會篩選',exact:true}).selectOption('media');
  await panel.getByRole('combobox',{name:'排序方式',exact:true}).selectOption('nickname');
  await panel.getByRole('combobox',{name:'每頁顯示',exact:true}).selectOption('10');
  await search.fill('  企劃  ');await search.press('Enter');
  await expect.poll(()=>queries.at(-1)?.get('search')).toBe('企劃');
  await summary.click();await expect(advanced).not.toHaveAttribute('open');
  await expect(summary.locator('.directory-filter-count')).toContainText('3');
  await expect(panel.locator('.directory-filter-chip')).toHaveCount(4);
  await panel.getByRole('button',{name:'清除條件：公會：媒體自動化公會',exact:true}).click();
  await expect(search).toBeFocused();
  await expect.poll(()=>queries.at(-1)?.has('guild_key')).toBe(false);
  expect(queries.at(-1)?.get('search')).toBe('企劃');expect(queries.at(-1)?.get('sort')).toBe('nickname');expect(queries.at(-1)?.get('limit')).toBe('10');
  await panel.getByRole('button',{name:'重設篩選',exact:true}).click();
  await expect(search).toBeFocused();await expect(search).toHaveValue('');
  await expect(panel.locator('.directory-filter-chip')).toHaveCount(0);
  await expect(summary.locator('.directory-filter-count')).toHaveCount(0);
  await expect.poll(()=>queries.at(-1)?.toString()).toBe('limit=20&offset=0&sort=newest');
});

test('clearing a pending search keeps the current results after the older response arrives',async({page})=>{
  let release!:()=>void,requested!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{requested=resolve;});
  const queries:URLSearchParams[]=[];
  await page.route('**/api/v1/members?*',async route=>{
    const query=new URL(route.request().url()).searchParams;queries.push(query);
    if(query.get('search')==='舊條件'){requested();await held;return route.fulfill({json:{items:[member(2,{nickname:'舊搜尋夥伴'})],next_offset:null,total:1}});}
    return route.fulfill({json:{items:[member(1,{nickname:'全部夥伴'})],next_offset:null,total:1}});
  });
  const panel=await openDirectory(page),search=panel.getByRole('searchbox',{name:'搜尋夥伴',exact:true});
  await expect(panel.getByRole('heading',{name:'全部夥伴',exact:true})).toBeVisible();
  // Freeze browser time only after the initial reads; the existing debounce remains 250 ms.
  await page.clock.install();await page.clock.pauseAt(new Date());
  const initialCount=queries.length;
  await search.fill('舊條件');await expect(panel.locator('.directory-result-count')).toHaveText('正在套用搜尋…');
  await page.clock.runFor(249);expect(queries).toHaveLength(initialCount);
  await page.clock.runFor(1);await started;
  await panel.getByRole('button',{name:'清除搜尋',exact:true}).click();
  await expect(search).toBeFocused();await expect(panel.getByRole('heading',{name:'全部夥伴',exact:true})).toBeVisible();
  const delivered=page.waitForResponse(response=>new URL(response.url()).searchParams.get('search')==='舊條件');release();await delivered;
  await page.clock.runFor(300);
  await expect(panel.getByRole('heading',{name:'舊搜尋夥伴',exact:true})).toHaveCount(0);
  await expect(panel.getByRole('heading',{name:'全部夥伴',exact:true})).toBeVisible();
  await expect(panel.locator('.directory-result-count')).toHaveText('顯示 1–1 / 1 位夥伴');
  expect(queries.at(-1)?.has('search')).toBe(false);
});

for(const theme of ['light','dark','versefolk'])test(`compact member search fits narrow screens in ${theme}`,async({page})=>{
  await page.addInitScript(value=>localStorage.setItem('freedom-theme',value),theme);
  await page.setViewportSize({width:320,height:844});
  await page.route('**/api/v1/members?*',route=>route.fulfill({json:{items:[member(1)],next_offset:null,total:1}}));
  const panel=await openDirectory(page),form=panel.getByRole('search',{name:'尋找工坊夥伴'}),advanced=panel.locator('.directory-advanced');
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await expect(panel.locator('.directory-member')).toHaveCount(1);
  expect((await form.boundingBox())!.height).toBeLessThan(180);
  await panel.getByRole('searchbox',{name:'搜尋夥伴',exact:true}).fill('很長的關鍵字'.repeat(10));
  await panel.getByRole('searchbox',{name:'搜尋夥伴',exact:true}).press('Enter');
  await expect(panel.locator('.directory-filter-chip')).toHaveCount(1);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const open of [true,false]){
      if(await advanced.evaluate(element=>(element as HTMLDetailsElement).open)!==open)await advanced.locator('summary').click();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      for(const control of await form.locator('input,select,button,summary').all()){
        if(await control.isVisible())expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:`test-results/member-search-${theme}-phone.png`,fullPage:true});
});

test('directory keeps search after viewing another page and waits for Chinese composition',async({page})=>{
  const queries:string[]=[];
  await page.route('**/api/v1/members?*',route=>{queries.push(new URL(route.request().url()).searchParams.get('search')??'');return route.fulfill({json:{items:[member(1)],next_offset:null,total:1}});});
  const panel=await openDirectory(page),search=panel.getByRole('searchbox',{name:'搜尋夥伴',exact:true});
  await expect(panel.locator('.directory-member')).toHaveCount(1);
  await search.dispatchEvent('compositionstart');await search.fill('設計');
  await expect(search).toHaveValue('設計');
  await panel.getByRole('button',{name:'搜尋',exact:true}).click();expect(queries).not.toContain('設計');
  await search.dispatchEvent('compositionend');await expect.poll(()=>queries.at(-1)).toBe('設計');
  await navigate(page,'我的定位');await navigate(page,'工坊夥伴');
  await expect(search).toHaveValue('設計');await expect.poll(()=>queries.at(-1)).toBe('設計');
  await panel.getByRole('button',{name:'重設篩選',exact:true}).click();await expect(search).toHaveValue('');await expect(search).toBeFocused();
});

test('directory unknown friend operation remains recoverable when its row is filtered out',async({page})=>{
  await page.route('**/api/v1/members?*',route=>route.fulfill({json:{items:new URL(route.request().url()).searchParams.has('search')?[]:[member(1)],next_offset:null,total:1}}));
  const panel=await openDirectory(page);const session=await (await page.request.get('/api/v1/session')).json();
  const pair=[session.user.user_id,member(1).user_id].sort(),attempts:string[]=[];
  await page.route(`**/api/v1/friends/${member(1).user_id}/request`,route=>{
    const request=route.request();attempts.push(JSON.stringify([request.postData(),request.headers()['idempotency-key'],request.headers()['if-match']]));
    if(attempts.length===1)return route.abort('failed');
    if(attempts.length===2)return route.fulfill({status:403,contentType:'application/problem+json',json:{type:'about:blank',title:'Forbidden',status:403,detail:'暫時無法操作'}});
    return route.fulfill({json:{low_ref:pair[0],high_ref:pair[1],state:'pending',aggregate_version:1}});
  });
  await panel.getByRole('button',{name:'邀請成為好友',exact:true}).click();
  const retry=panel.getByRole('button',{name:'重試原好友操作',exact:true});await expect(retry).toBeEnabled();
  await panel.getByRole('button',{name:'查看好友與邀請',exact:true}).click();await expect(page).toHaveURL(/#members$/);
  await expect(retry).toBeVisible();
  const protectedReload=await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});expect(protectedReload).toBe(true);
  await panel.getByRole('searchbox',{name:'搜尋夥伴',exact:true}).fill('其他人');await expect(panel.locator('.directory-member')).toHaveCount(0);
  await retry.click();await expect(retry).toBeEnabled();await retry.click();
  await expect(panel.getByText('好友邀請已送出，等待對方接受。',{exact:true})).toBeVisible();
  expect(attempts).toHaveLength(3);expect(new Set(attempts).size).toBe(1);
});
