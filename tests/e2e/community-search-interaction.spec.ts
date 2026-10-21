import {test,expect,type Page} from './fixtures.js';

const endpoint='/api/v1/community-search';
const results=(page:Page)=>page.getByRole('region',{name:'社群內容搜尋結果',exact:true});
const input=(page:Page)=>page.getByRole('searchbox',{name:'關鍵字',exact:true});
const conditions=(page:Page)=>page.getByRole('region',{name:'社群內容搜尋條件',exact:true});
const resultPage=(title:string,next_cursor:string|null=null)=>({items:[{
  kind:'skill_book',id:'synthetic-search-book',title,summary:'合成搜尋摘要',path:'#skills',
  label:null,author_id:null,media_path:null,topics:[],
}],next_cursor});
function barrier(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function open(page:Page,query=''){
  await page.goto(`/#community-search${query?`?${query}`:''}`);
  await expect(conditions(page)).toBeVisible();
}
async function pause(page:Page){
  await page.clock.install({time:new Date('2026-10-21T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-21T00:00:01Z'));
}

// Requires the existing FREEDOM_E2E_COMMUNITY_SEARCH=1 mode. These intercepts
// exercise the UI only; existing community-search.spec.ts covers real API ACLs.
test('search text debounces while Enter submits without waiting for the timer',async({page})=>{
  const requests:string[]=[];
  await page.route(url=>url.pathname===endpoint,route=>{
    const q=new URL(route.request().url()).searchParams.get('q')??'';requests.push(q);
    return route.fulfill({json:resultPage(q||'初始結果')});
  });
  await open(page);await expect(results(page)).toHaveAttribute('aria-busy','false');await pause(page);
  const baseline=requests.length;
  await input(page).fill('設');await page.clock.runFor(80);
  await input(page).fill('設計');await page.clock.runFor(179);
  expect(requests.length).toBe(baseline);
  await input(page).press('Enter');
  await expect(results(page).getByRole('link',{name:'設計',exact:true})).toBeVisible();
  await page.clock.runFor(500);
  expect(requests.slice(baseline)).toEqual(['設計']);
});

test('IME input is not searched or placed in history until composition completes',async({page})=>{
  const requests:string[]=[];
  await page.route(url=>url.pathname===endpoint,route=>{
    const q=new URL(route.request().url()).searchParams.get('q')??'';requests.push(q);
    return route.fulfill({json:resultPage(q||'初始結果')});
  });
  await open(page,'q=before');await expect(results(page)).toHaveAttribute('aria-busy','false');await pause(page);
  const baseline=requests.length;
  await input(page).dispatchEvent('compositionstart');
  await input(page).fill('ㄕ');await page.clock.runFor(300);
  await input(page).fill('設計');await input(page).press('Enter');await page.clock.runFor(300);
  expect(requests.length).toBe(baseline);expect(new URL(page.url()).hash).toBe('#community-search?q=before');
  await expect(results(page).getByText('選字完成後會自動搜尋。',{exact:true})).toBeVisible();
  await input(page).dispatchEvent('compositionend',{data:'設計'});
  await page.clock.runFor(180);
  await expect(results(page).getByRole('link',{name:'設計',exact:true})).toBeVisible();
  expect(requests.slice(baseline)).toEqual(['設計']);
  expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('q')).toBe('設計');
});

test('changing a filter starts immediately with the latest text and resets paging',async({page})=>{
  const requests:string[]=[];
  await page.route(url=>url.pathname===endpoint,route=>{
    requests.push(new URL(route.request().url()).search);
    return route.fulfill({json:resultPage('篩選結果')});
  });
  await open(page,'q=old&cursor=synthetic-next');await expect(results(page)).toHaveAttribute('aria-busy','false');await pause(page);
  const baseline=requests.length;
  await input(page).fill('new');
  await conditions(page).getByRole('checkbox',{name:'作品',exact:true}).check();
  await expect.poll(()=>requests.length).toBe(baseline+1);
  const query=new URLSearchParams(requests.at(-1));
  expect(query.get('q')).toBe('new');expect(query.get('kinds')).toBe('work');expect(query.has('cursor')).toBe(false);
  await page.clock.runFor(500);expect(requests.length).toBe(baseline+1);
});

test('paging focuses the results and browser Back restores query and checked filters',async({page})=>{
  await page.route(url=>url.pathname===endpoint,route=>{
    const next=new URL(route.request().url()).searchParams.has('cursor');
    return route.fulfill({json:resultPage(next?'第二頁結果':'第一頁結果',next?null:'synthetic-next')});
  });
  await open(page,'q=hello&kinds=skill_book&topics=tools');
  await results(page).getByRole('button',{name:'下一頁',exact:true}).click();
  await expect(results(page).getByRole('link',{name:'第二頁結果',exact:true})).toBeVisible();
  await expect(results(page)).toBeFocused();
  await page.goBack();
  await expect(results(page).getByRole('link',{name:'第一頁結果',exact:true})).toBeVisible();
  await expect(input(page)).toHaveValue('hello');
  await expect(conditions(page).getByRole('checkbox',{name:'技能書',exact:true})).toBeChecked();
  await expect(conditions(page).getByRole('checkbox',{name:'工具資源',exact:true})).toBeChecked();
  expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).has('cursor')).toBe(false);
});

test('clear conditions resets filters and cursor, keeps the searchbox focused on mobile',async({page})=>{
  const requests:string[]=[];
  await page.setViewportSize({width:390,height:844});
  await page.route(url=>url.pathname===endpoint,route=>{
    requests.push(new URL(route.request().url()).search);
    return route.fulfill({json:resultPage('可閱讀內容')});
  });
  await open(page,'q=hello&kinds=work&topics=tools&cursor=synthetic-next');
  await expect(results(page)).toHaveAttribute('aria-busy','false');
  await conditions(page).getByRole('button',{name:'清除搜尋條件',exact:true}).click();
  await expect(input(page)).toHaveValue('');await expect(input(page)).toBeFocused();
  await expect(results(page)).toHaveAttribute('aria-busy','false');
  await expect(conditions(page).getByRole('checkbox',{name:'作品',exact:true})).not.toBeChecked();
  await expect(conditions(page).getByRole('checkbox',{name:'工具資源',exact:true})).not.toBeChecked();
  expect(new URL(page.url()).hash).toBe('#community-search');expect(requests.at(-1)).toBe('');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('replaced requests are cancelled and cannot overwrite newer results',async({page})=>{
  const held=barrier(),started=barrier(),finished=barrier();
  await page.route(url=>url.pathname===endpoint,async route=>{
    if(new URL(route.request().url()).searchParams.get('q')!=='held')return route.fulfill({json:resultPage('目前結果')});
    started.release();await held.promise;
    try{await route.fulfill({json:resultPage('不應出現的舊結果')});}
    catch(cause){if(!route.request().failure())throw cause;}
    finally{finished.release();}
  });
  try{
    await open(page,'q=held');await started.promise;
    const aborted=page.waitForEvent('requestfailed',request=>new URL(request.url()).pathname===endpoint&&new URL(request.url()).searchParams.get('q')==='held');
    await input(page).fill('current');await input(page).press('Enter');
    expect((await aborted).failure()?.errorText).toMatch(/abort|cancel/i);
    await expect(results(page).getByRole('link',{name:'目前結果',exact:true})).toBeVisible();
    held.release();await finished.promise;
    await expect(results(page).getByRole('link',{name:'不應出現的舊結果',exact:true})).toHaveCount(0);
  }finally{held.release();}
});

test('failed search is not presented as empty and retry does not have a debounce delay',async({page})=>{
  let fail=true;
  await page.route(url=>url.pathname===endpoint,route=>fail
    ?route.fulfill({status:503,body:''}):route.fulfill({json:resultPage('重試結果')}));
  await open(page);await expect(results(page).getByRole('alert')).toBeVisible();
  await expect(results(page).getByText(/沒有符合條件的內容/)).toHaveCount(0);
  await pause(page);fail=false;
  await results(page).getByRole('button',{name:'重試搜尋',exact:true}).click();
  await expect(results(page).getByRole('link',{name:'重試結果',exact:true})).toBeVisible();
});

test('overlapping return events share one read and clear earlier results before revalidation',async({page})=>{
  let returning=false,count=0;const held=barrier(),started=barrier();
  await page.route(url=>url.pathname===endpoint,async route=>{
    count++;
    if(!returning)return route.fulfill({json:resultPage('原本可閱讀的合成結果')});
    started.release();await held.promise;
    await route.fulfill({status:403,json:{code:'forbidden',detail:'目前無法讀取搜尋結果。'}});
  });
  try{
    await open(page);await expect(results(page).getByRole('link',{name:'原本可閱讀的合成結果',exact:true})).toBeVisible();
    const baseline=count;returning=true;
    await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));});
    await started.promise;
    await expect(results(page).getByRole('link',{name:'原本可閱讀的合成結果',exact:true})).toHaveCount(0);
    expect(count).toBe(baseline+1);held.release();
    await expect(results(page).getByRole('alert')).toBeVisible();
    await expect(results(page)).toHaveAttribute('aria-busy','false');
    await expect(results(page).getByText(/沒有符合條件的內容/)).toHaveCount(0);
  }finally{held.release();}
});
