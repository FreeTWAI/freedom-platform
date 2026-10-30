import {test,expect,type Page} from './fixtures.js';
import {navigate} from './navigation.js';

const directoryPath='/api/v1/friends/directory';
const memberId='30000000-0000-4000-8000-000000000001';
const person=(nickname='測試好友',state='accepted')=>({user_id:memberId,nickname,last_seen_at:null,is_online:false,
  positioning_title:null,primary_guild:null,secondary_guilds:[],joined_guilds:[],capabilities:[],equipment:[],contacts:{},
  is_self:false,friendship:{state,requester_ref:memberId,aggregate_version:7}});
const result=(items:ReturnType<typeof person>[]=[],total=items.length,next_offset:number|null=null)=>({items,total,next_offset});
const list=(page:Page)=>page.getByRole('region',{name:'好友名單結果',exact:true});
function barrier(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
async function login(page:Page){
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('heading',{name:'會員首頁',level:1,exact:true})).toBeVisible();
}
async function freeze(page:Page){
  const time=new Date('2026-10-21T12:00:00Z');
  await page.clock.install({time});await page.clock.pauseAt(new Date(time.getTime()+1000));
}

// Read-only synthetic directory projections; mutation cases stub only their exact target.
test('friend scope changes and pagination dispatch immediately even with a search term',async({page})=>{
  await login(page);
  const reads:{scope:string|null;search:string|null;offset:string|null}[]=[];
  await page.route(url=>url.pathname===directoryPath,route=>{
    const q=new URL(route.request().url()).searchParams;
    reads.push({scope:q.get('scope'),search:q.get('search'),offset:q.get('offset')});
    return route.fulfill({json:result([person()],21,q.get('offset')==='0'?20:null)});
  });
  await navigate(page,'我的好友');await expect(list(page)).toHaveAttribute('aria-busy','false');await freeze(page);
  await page.getByLabel('搜尋好友名稱',{exact:true}).fill('測試');await page.clock.runFor(250);
  await expect.poll(()=>reads.at(-1)?.search).toBe('測試');await expect(list(page)).toHaveAttribute('aria-busy','false');
  await page.getByRole('button',{name:'收到的邀請',exact:true}).click();
  // No clock advance: the old implementation would still be waiting 250ms.
  await expect.poll(()=>reads.at(-1)?.scope).toBe('incoming');await expect(list(page)).toHaveAttribute('aria-busy','false');
  await page.getByRole('button',{name:'下一頁好友',exact:true}).click();
  await expect.poll(()=>reads.at(-1)?.offset).toBe('20');await expect(list(page)).toBeFocused();
  expect(reads.at(-1)?.search).toBe('測試');
});

test('Chinese friend-name composition never queries incomplete input',async({page})=>{
  await login(page);const searches:string[]=[];
  await page.route(url=>url.pathname===directoryPath,route=>{searches.push(new URL(route.request().url()).searchParams.get('search')??'');return route.fulfill({json:result()});});
  await navigate(page,'我的好友');await expect(list(page)).toHaveAttribute('aria-busy','false');await freeze(page);
  const input=page.getByLabel('搜尋好友名稱',{exact:true});
  await input.dispatchEvent('compositionstart');await input.fill('ㄇ');await page.clock.runFor(300);
  await input.fill('小明');await page.clock.runFor(300);
  expect(searches).not.toContain('ㄇ');expect(searches).not.toContain('小明');
  await expect(page.getByText('選字完成後會自動搜尋。',{exact:true})).toBeVisible();
  await input.dispatchEvent('compositionend',{data:'小明'});await page.clock.runFor(250);
  await expect.poll(()=>searches.filter(value=>value==='小明').length).toBe(1);
});

test('Enter flushes a pending search and clear restores the input focus on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});await login(page);const searches:string[]=[];
  await page.route(url=>url.pathname===directoryPath,route=>{searches.push(new URL(route.request().url()).searchParams.get('search')??'');return route.fulfill({json:result()});});
  await navigate(page,'我的好友');await expect(list(page)).toHaveAttribute('aria-busy','false');await freeze(page);
  const input=page.getByLabel('搜尋好友名稱',{exact:true});
  await input.fill('朋友');await input.press('Enter');await expect.poll(()=>searches.at(-1)).toBe('朋友');
  await page.clock.runFor(250);expect(searches.filter(value=>value==='朋友')).toHaveLength(1);
  await page.getByRole('button',{name:'清除好友搜尋',exact:true}).click();
  await expect(input).toHaveValue('');await expect(input).toBeFocused();await expect.poll(()=>searches.at(-1)).toBe('');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('changing friend scope aborts old requests and ignores a delayed response',async({page})=>{
  await login(page);const held=barrier(),started=barrier(),finished=barrier();
  await page.route(url=>url.pathname===directoryPath,async route=>{
    if(new URL(route.request().url()).searchParams.get('scope')!=='accepted')return route.fulfill({json:result([person('新範圍邀請','pending')])});
    started.release();await held.promise;
    try{await route.fulfill({json:result([person('過期好友結果')])});}catch(cause){if(!route.request().failure())throw cause;}finally{finished.release();}
  });
  try{
    await navigate(page,'我的好友');await started.promise;
    const aborted=page.waitForEvent('requestfailed',request=>new URL(request.url()).pathname===directoryPath&&new URL(request.url()).searchParams.get('scope')==='accepted');
    await page.getByRole('button',{name:'收到的邀請',exact:true}).click();
    expect((await aborted).failure()?.errorText).toMatch(/abort|cancel/i);
    await expect(list(page).getByRole('heading',{name:'新範圍邀請',exact:true})).toBeVisible();
    held.release();await finished.promise;await expect(list(page)).not.toContainText('過期好友結果');
  }finally{held.release();}
});

test('read failure is not displayed as zero friends and explicit retry succeeds',async({page})=>{
  await login(page);let fail=true;
  await page.route(url=>url.pathname===directoryPath,route=>fail?route.fulfill({status:503,body:''}):route.fulfill({json:result([person()])}));
  await navigate(page,'我的好友');await expect(list(page).getByRole('alert')).toBeVisible();
  await expect(list(page)).not.toContainText('共 0');await expect(list(page)).not.toContainText('還沒有好友');
  fail=false;await list(page).getByRole('button',{name:'重讀好友名單',exact:true}).click();
  await expect(list(page).getByRole('heading',{name:'測試好友',exact:true})).toBeVisible();
});

test('accepting an invitation preserves the command version and refreshes confirmed results',async({page})=>{
  await login(page);let accepted=false;const commands:Record<string,string>[]=[];
  await page.route(url=>url.pathname===directoryPath,route=>route.fulfill({json:result(accepted?[]:[person('邀請夥伴','pending')])}));
  await page.route(url=>url.pathname===`/api/v1/friends/${memberId}/accept`,route=>{
    commands.push(route.request().headers());accepted=true;return route.fulfill({json:{state:'accepted',aggregate_version:8}});
  });
  await navigate(page,'我的好友');await page.getByRole('button',{name:'收到的邀請',exact:true}).click();
  await list(page).getByRole('button',{name:'接受邀請',exact:true}).click();
  await expect(page.getByText('已和邀請夥伴成為好友。',{exact:true})).toBeVisible();
  await expect(list(page).getByRole('heading',{name:'沒有等你回覆的邀請',exact:true})).toBeVisible();
  expect(commands).toHaveLength(1);expect(commands[0]['if-match']).toBe('"7"');expect(commands[0]['idempotency-key']).toBeTruthy();
});

test('removing the last invitation on a later page recovers to a valid page without losing the query',async({page})=>{
  await login(page);let removed=false;const reads:string[]=[];
  await page.route(url=>url.pathname===directoryPath,route=>{
    const q=new URL(route.request().url()).searchParams;reads.push(q.toString());
    const later=q.get('offset')==='20';
    return route.fulfill({json:later?result(removed?[]:[person('待回覆朋友','pending')],removed?20:21)
      :result([person('第一頁朋友','pending')],removed?20:21,removed?null:20)});
  });
  await page.route(url=>url.pathname===`/api/v1/friends/${memberId}/remove`,route=>{removed=true;return route.fulfill({json:{state:'removed',aggregate_version:8}});});
  await navigate(page,'我的好友');await page.getByRole('button',{name:'收到的邀請',exact:true}).click();
  const input=page.getByLabel('搜尋好友名稱',{exact:true});await input.fill('朋友');await input.press('Enter');
  await expect(list(page)).toHaveAttribute('aria-busy','false');await list(page).getByRole('button',{name:'下一頁好友',exact:true}).click();
  await expect(list(page).getByRole('heading',{name:'待回覆朋友',exact:true})).toBeVisible();
  await list(page).getByRole('button',{name:'婉拒',exact:true}).click();
  await list(page).getByRole('button',{name:'確定婉拒',exact:true}).click();
  await expect(list(page).getByRole('heading',{name:'第一頁朋友',exact:true})).toBeVisible();
  await expect(input).toHaveValue('朋友');expect(new URLSearchParams(reads.at(-1)).get('offset')).toBe('0');
});

test('permission errors after a refresh remove previously loaded private results',async({page})=>{
  await login(page);let forbidden=false;
  await page.route(url=>url.pathname===directoryPath,route=>forbidden?route.fulfill({status:403,json:{code:'forbidden',detail:'目前無法讀取好友名單。'}}):route.fulfill({json:result([person('私人朋友姓名')])}));
  await navigate(page,'我的好友');await expect(list(page).getByRole('heading',{name:'私人朋友姓名',exact:true})).toBeVisible();
  forbidden=true;await page.getByRole('button',{name:'搜尋好友',exact:true}).click();
  await expect(list(page).getByRole('alert')).toBeVisible();await expect(list(page)).not.toContainText('私人朋友姓名');
  await expect(list(page)).not.toContainText('共 0');
});


test('friend list states explain who is waiting and recover empty searches without sending invitations',async({page})=>{
  await page.setViewportSize({width:390,height:844});await login(page);
  const writes:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&/\/api\/v1\/friends\//.test(request.url()))writes.push(request.url());});
  await page.route(url=>url.pathname===directoryPath,route=>route.fulfill({json:result()}));
  await navigate(page,'我的好友');
  await expect(list(page).getByRole('heading',{name:'還沒有好友',exact:true})).toBeVisible();
  await expect(list(page).getByRole('button',{name:'認識工坊夥伴',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'收到的邀請',exact:true}).click();
  await expect(page.locator('.friends-scope-hint')).toContainText('等你回覆');
  await expect(list(page).getByRole('heading',{name:'沒有等你回覆的邀請',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'送出的邀請',exact:true}).click();
  await expect(page.locator('.friends-scope-hint')).toContainText('等對方回覆');
  await expect(list(page)).toContainText('共 0 則邀請等對方回覆');
  const input=page.getByLabel('搜尋好友名稱',{exact:true});
  await input.fill('找不到的名字');await input.press('Enter');
  await expect(list(page).getByRole('heading',{name:'沒有符合的名字',exact:true})).toBeVisible();
  await list(page).getByRole('button',{name:'查看這份完整名單',exact:true}).click();
  await expect(input).toHaveValue('');await expect(input).toBeFocused();
  await expect(page.getByRole('button',{name:'送出的邀請',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(list(page).getByRole('heading',{name:'沒有等待回覆的邀請',exact:true})).toBeVisible();
  expect(writes).toEqual([]);
});

test('collapse during removal keeps unknown-result recovery visible and retries the original command',async({page})=>{
  await login(page);const commands:Record<string,string>[]=[];const held=barrier(),started=barrier();let removed=false;
  await page.route(url=>url.pathname===directoryPath,route=>route.fulfill({json:result(removed?[]:[person()])}));
  await page.route(url=>url.pathname===`/api/v1/friends/${memberId}/remove`,async route=>{
    commands.push(route.request().headers());
    if(commands.length===1){started.release();await held.promise;return route.abort('failed');}
    if(commands.length===2)return route.fulfill({status:412,json:{code:'version_conflict',detail:'版本已變更。'}});
    removed=true;return route.fulfill({json:{state:'removed',aggregate_version:8}});
  });
  try{
    await navigate(page,'我的好友');
    const row=list(page).locator('.directory-member'),settings=row.locator('.friends-manage');
    await expect(row.getByRole('button',{name:'移除好友',exact:true})).toBeHidden();
    await settings.locator('summary').click();
    await row.getByRole('button',{name:'移除好友',exact:true}).click();
    await row.getByRole('button',{name:'確定移除',exact:true}).click();await started.promise;
    await settings.locator('summary').click();await expect(settings).toHaveJSProperty('open',false);
    await expect(page.getByText('正在更新好友關係，請稍候…',{exact:true})).toBeVisible();
    held.release();
    const retry=page.getByRole('button',{name:'確認原操作結果',exact:true});
    await expect(retry).toBeVisible();expect(commands).toHaveLength(1);
    await settings.locator('summary').click();
    await expect(row.getByRole('button',{name:'移除好友',exact:true})).toBeDisabled();
    await retry.focus();await page.keyboard.press('Enter');
    await expect(retry).toBeVisible();expect(commands).toHaveLength(2);
    await expect(row.getByRole('button',{name:'移除好友',exact:true})).toBeDisabled();
    await retry.click();
    await expect(page.getByText('好友關係或邀請已移除。',{exact:true})).toBeVisible();
    expect(commands).toHaveLength(3);
    expect(commands[2]['idempotency-key']).toBe(commands[0]['idempotency-key']);expect(commands[0]['idempotency-key']).toBeTruthy();
    expect(commands[1]['idempotency-key']).toBe(commands[0]['idempotency-key']);
    expect(commands[1]['if-match']).toBe(commands[0]['if-match']);
    await expect(retry).toHaveCount(0);
  }finally{held.release();}
});
