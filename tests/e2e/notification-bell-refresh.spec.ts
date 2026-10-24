import {test,expect,type Page,type Route} from './fixtures.js';
import {navigate,signOut} from './navigation.js';

const preview='**/api/v1/me/notifications?limit=6&offset=0';
const notice={notification_id:'synthetic-notice',title:'測試通知',body:'只有目前登入會員可見的合成提醒',created_at:'2026-01-01T00:00:00Z',read_at:null as string|null,action:null};
const payload=(read=false)=>({items:[{...notice,read_at:read?'2026-01-02T00:00:00Z':null}],unread_count:read?0:1});
async function login(page:Page,email='maker@local.test',navigate=true){
  if(navigate)await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(email);
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
}
const frameBarrier=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));

test('bell overlap uses one transport and collapse makes no additional request',async({page},info)=>{
  let requests=0,completed=0,hold=false;
  const waiting:Route[]=[];
  await page.route(preview,async route=>{requests++;if(hold){waiting.push(route);return;}await route.fulfill({json:payload()});completed++;});
  await login(page);const bell=page.locator('.notification-bell-trigger');
  await expect(bell).toHaveAccessibleName('通知，1 則未讀');
  const initial=requests;hold=true;
  const updated=page.waitForResponse(value=>value.url().endsWith('/me/notifications?limit=6&offset=0'));
  try{
    await bell.click();await expect(page.getByRole('region',{name:'最近通知'})).toBeVisible();
    await expect.poll(()=>waiting.length).toBeGreaterThanOrEqual(1);
    await bell.click();await expect(page.getByRole('region',{name:'最近通知'})).toBeHidden();
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await frameBarrier(page);
    const measured={initial,overlap_requests:requests-initial,collapsed:true,completed_before_release:completed};
    await info.attach('notification-overlap-count',{body:JSON.stringify(measured),contentType:'application/json'});
    expect(measured.overlap_requests).toBe(1);
    // A confirmed inbox change is a separate snapshot boundary, not a normal overlapping read.
    await page.evaluate(()=>{window.dispatchEvent(new Event('freedom-inbox-updated'));window.dispatchEvent(new Event('focus'));});
    await expect.poll(()=>waiting.length).toBe(2);await frameBarrier(page);
    expect(requests-initial).toBe(2);
  }finally{hold=false;for(const route of waiting)await route.fulfill({json:payload()});await (await updated).finished();await frameBarrier(page);}
  // A settled response is never a freshness cache: the next opening re-reads.
  const settled=requests;await bell.click();await expect.poll(()=>requests).toBe(settled+1);
  await expect(page.locator('.notification-bell-item')).toContainText(notice.body);
  await page.getByRole('heading',{name:'會員首頁',exact:true}).click();
  await expect(page.getByRole('region',{name:'最近通知'})).toBeHidden();
});

test('confirmed single read refreshes once without automatically resending the write',async({page},info)=>{
  let reads=0,writes=0,read=false;
  await page.route(preview,async route=>{reads++;await route.fulfill({json:payload(read)});});
  await page.route('**/api/v1/me/notifications/synthetic-notice/read',async route=>{writes++;read=true;await route.fulfill({json:{read_at:'2026-01-02T00:00:00Z'}});});
  await login(page);await page.locator('.notification-bell-trigger').click();
  await expect(page.locator('.notification-bell-item.is-unread')).toHaveCount(1);
  const before=reads;const response=page.waitForResponse(value=>value.url().endsWith('/me/notifications?limit=6&offset=0'));
  await page.locator('.notification-bell-item').click();await response;await frameBarrier(page);
  await expect(page.locator('.notification-bell-item.is-unread')).toHaveCount(0);
  await info.attach('notification-read-count',{body:JSON.stringify({refreshes:reads-before,writes,controlled_ack:true}),contentType:'application/json'});
  expect(reads-before).toBe(1);expect(writes).toBe(1);
});

test('a slow preview shows immediate local feedback, closes by Escape and recovers after failure',async({page},info)=>{
  await page.setViewportSize({width:320,height:800});await page.emulateMedia({reducedMotion:'reduce'});
  let next='ok',held:Route|undefined;
  await page.route(preview,async route=>{if(next==='hold'){held=route;return;}await route.fulfill(next==='fail'?{status:503,json:{code:'upstream_unavailable'}}:{json:payload()});});
  await login(page);const bell=page.locator('.notification-bell-trigger');
  await expect(bell).toHaveAccessibleName('通知，1 則未讀');next='hold';
  await page.evaluate(()=>{
    const state=window as typeof window&{noticeStart:number;noticeLatency:number|null};state.noticeLatency=null;
    document.querySelector('.notification-bell-trigger')!.addEventListener('click',()=>{state.noticeStart=performance.now();},{once:true,capture:true});
    const observer=new MutationObserver(()=>{if(document.querySelector('.notification-bell-popover [role="status"]')){observer.disconnect();requestAnimationFrame(()=>{state.noticeLatency=performance.now()-state.noticeStart;});}});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
  });
  try{
    await bell.click();const panel=page.getByRole('region',{name:'最近通知'});
    await expect(panel.getByRole('status')).toHaveText('正在更新通知…');await expect.poll(()=>held!==undefined).toBe(true);
    await expect.poll(()=>page.evaluate(()=>(window as typeof window&{noticeLatency:number|null}).noticeLatency)).not.toBeNull();
    const latency=await page.evaluate(()=>(window as typeof window&{noticeLatency:number}).noticeLatency);
    await info.attach('notice-click-to-feedback-frame-ms',{body:JSON.stringify({sample_count:1,ms:latency,scope:'controlled local preview, not production p95'}),contentType:'application/json'});
    expect(latency).toBeLessThan(100);await expect(page.locator('.request-feedback')).toHaveCount(0);
    await page.screenshot({path:'test-results/notification-loading-320.png'});
    await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(bell).toBeFocused();
  }finally{if(held)await held.fulfill({json:payload()});}
  next='fail';await bell.click();const panel=page.getByRole('region',{name:'最近通知'});
  await expect(panel.getByRole('alert')).toContainText('通知暫時無法載入');await expect(bell).toHaveAccessibleName('通知，未讀數未確認');
  const retry=panel.getByRole('button',{name:'再試一次',exact:true});await expect(retry).toBeVisible();
  const box=await retry.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:'test-results/notification-error-320.png'});next='ok';await retry.click();
  await expect(panel.getByRole('alert')).toHaveCount(0);await expect(bell).toHaveAccessibleName('通知，1 則未讀');
  await expect(panel.locator('.notification-bell-item')).toContainText(notice.body);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a same-login bulk-read acknowledgement refreshes the bell after closing the notification bell',async({page})=>{
  let held:Route|undefined,read=false,previewReads=0;
  await page.route(preview,async route=>{previewReads++;await route.fulfill({json:payload(read)});});
  await page.route('**/api/v1/me/inbox/read-all',route=>{held=route;});
  await login(page);
  const bell=page.locator('.notification-bell-trigger');
  await expect(bell).toHaveAccessibleName('通知，1 則未讀');
  await page.locator('.notification-bell-trigger').click();
  await page.getByRole('button',{name:'全部標為已讀',exact:true}).click();
  await expect.poll(()=>held!==undefined).toBe(true);
  await page.keyboard.press('Escape');await navigate(page,'技能書架');
  await page.evaluate(()=>{
    const state=window as typeof window&{noticeEvents:number;allReadEvents:number};
    state.noticeEvents=0;state.allReadEvents=0;
    window.addEventListener('freedom-inbox-updated',()=>state.noticeEvents++);
    window.addEventListener('freedom-notifications-read',()=>state.allReadEvents++);
  });
  const before=previewReads,currentUrl=page.url();
  const acknowledgement=page.waitForResponse(response=>response.url().endsWith('/me/inbox/read-all'));
  try{
    read=true;await held!.fulfill({json:{read_at:'2026-01-02T00:00:00Z'}});
    await (await acknowledgement).finished();await frameBarrier(page);
    await expect(bell).toHaveAccessibleName('通知');
    expect(previewReads-before).toBe(1);
    expect(await page.evaluate(()=>{
      const state=window as typeof window&{noticeEvents:number;allReadEvents:number};
      return {updated:state.noticeEvents,allRead:state.allReadEvents};
    })).toEqual({updated:1,allRead:1});
    await expect(page).toHaveURL(currentUrl);
  }finally{if(held)await held.fulfill({json:{read_at:'2026-01-02T00:00:00Z'}}).catch(()=>{});}
});

for(const mode of ['single','all'] as const)test(`an old account ${mode} read acknowledgement cannot navigate or refresh the new login`,async({page})=>{
  let readRequest:Route|undefined,inboxEvents=0,previewReads=0;
  const readPath=mode==='single'?'/me/notifications/synthetic-notice/read':'/me/inbox/read-all';
  await page.route(preview,async route=>{previewReads++;await route.fulfill({json:payload()});});
  await page.route('**/api/v1'+readPath,route=>{readRequest=route;});
  await login(page);await page.locator('.notification-bell-trigger').click();
  if(mode==='single')await page.locator('.notification-bell-item').click();else await page.getByRole('button',{name:'全部標為已讀',exact:true}).click();
  await expect.poll(()=>readRequest!==undefined).toBe(true);
  await signOut(page);await expect(page.getByRole('heading',{name:'登入',exact:true})).toBeVisible();
  await login(page,'reviewer@local.test',false);await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，1 則未讀');
  await page.evaluate(()=>{(window as typeof window&{noticeEvents:number}).noticeEvents=0;window.addEventListener('freedom-inbox-updated',()=>{(window as typeof window&{noticeEvents:number}).noticeEvents++;});});
  const before=previewReads,currentUrl=page.url();
  const acknowledgement=page.waitForResponse(response=>response.url().endsWith(readPath));
  try{await readRequest!.fulfill({json:{read_at:'2026-01-02T00:00:00Z'}});await (await acknowledgement).finished();await frameBarrier(page);
    inboxEvents=await page.evaluate(()=>(window as typeof window&{noticeEvents:number}).noticeEvents);
    expect(inboxEvents).toBe(0);expect(previewReads).toBe(before);
    await expect(page).toHaveURL(currentUrl);await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
  }finally{if(readRequest)await readRequest.fulfill({json:{read_at:'2026-01-02T00:00:00Z'}}).catch(()=>{});}
});

for(const [id,recent,title,loading] of [['zh-Hant','最近通知','通知','正在更新通知…'],['en','Recent notifications','Notifications','Updating notifications…'],['ja','最近の通知','通知','通知を更新中…'],['ko','최근 알림','알림','알림 업데이트 중…'],['es','Notificaciones recientes','Notificaciones','Actualizando notificaciones…']] as const){
  test(`notification chrome follows ${id} without translating member content or refetching for language only`,async({page})=>{
    let reads=0,hold=false;const waiting:Route[]=[];
    await page.route(preview,async route=>{reads++;if(hold){waiting.push(route);return;}await route.fulfill({json:payload()});});
    await login(page);await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，1 則未讀');
    const before=reads;await page.evaluate(value=>{localStorage.setItem('freedom-interface-language-v1',value);window.dispatchEvent(new StorageEvent('storage',{key:'freedom-interface-language-v1',newValue:value}));},id);
    await expect(page.locator('html')).toHaveAttribute('lang',id);await frameBarrier(page);expect(reads).toBe(before);
    hold=true;
    try{await page.locator('.notification-bell-trigger').click();const panel=page.getByRole('region',{name:recent});await expect(panel.locator('.notification-bell-head strong')).toHaveText(title);await expect(panel.getByRole('status')).toHaveText(loading);await expect(panel.locator('.notification-bell-item')).toContainText(notice.body);await expect.poll(()=>waiting.length).toBe(1);
      for(const width of [320,390,820,1280]){await page.setViewportSize({width,height:width<500?800:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const box=await panel.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);}
      await page.setViewportSize({width:320,height:800});await page.screenshot({path:`test-results/notification-${id}-320.png`});
    }
    finally{hold=false;for(const route of waiting)await route.fulfill({json:payload()});}
  });
}

test('an unconfirmed single read remains visible after navigation and retries only that command',async({page})=>{
  const target={...notice,notification_id:'10000000-0000-4000-8000-000000000001',action:{tab:'guilds',resource_id:null}};
  const keys:string[]=[],paths:string[]=[];let confirmed=false,retryRequest:Route|undefined;
  await page.route(preview,route=>route.fulfill({json:{items:[{...target,read_at:confirmed?'2026-01-02T00:00:00Z':null}],unread_count:confirmed?1:2}}));
  await page.route(`**/api/v1/me/notifications/${target.notification_id}/read`,async route=>{
    keys.push(route.request().headers()['idempotency-key']);paths.push(route.request().url());
    if(keys.length===1)return route.abort();retryRequest=route;
  });
  await login(page);await page.locator('.notification-bell-trigger').click();await page.locator('.notification-bell-item').click();
  await expect(page).toHaveURL(/#guilds$/);await expect(page.getByRole('region',{name:'最近通知'})).toBeHidden();
  const alert=page.locator('.notification-bell-read-error');await expect(alert).toBeVisible();await expect(alert).toContainText('尚未確認這則通知已讀');
  await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，2 則未讀');
  await navigate(page,'技能書架');const destination=page.url();await alert.getByRole('button',{name:'再試一次',exact:true}).focus();await page.keyboard.press('Enter');
  await expect.poll(()=>Boolean(retryRequest)).toBe(true);const retry=alert.getByRole('button',{name:'標記中…',exact:true});await expect(retry).toBeDisabled();await expect(retry).toBeFocused();
  confirmed=true;await retryRequest!.fulfill({json:{notification_id:target.notification_id,read_at:'2026-01-02T00:00:00Z'}});
  await expect(alert).toHaveCount(0);await expect(page.locator('.notification-bell-trigger')).toBeFocused();await expect(page).toHaveURL(destination);
  await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，1 則未讀');
  expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0]);expect(new Set(paths).size).toBe(1);
});

test('an acknowledged read keeps the badge honest while a fresh count waits and older reads arrive',async({page})=>{
  const target={...notice,notification_id:'10000000-0000-4000-8000-000000000002',action:{tab:'guilds',resource_id:null}};
  let phase='initial',old:Route|undefined,fresh:Route|undefined,writes=0;
  await page.route(preview,async route=>{
    if(phase==='old'){old=route;return;}if(phase==='fresh'){fresh=route;return;}
    await route.fulfill({json:{items:[target],unread_count:1}});
  });
  await page.route(`**/api/v1/me/notifications/${target.notification_id}/read`,async route=>{writes++;phase='fresh';await route.fulfill({json:{notification_id:target.notification_id,read_at:'2026-01-02T00:00:00Z'}});});
  await login(page);await page.locator('.notification-bell-trigger').click();await expect(page.locator('.notification-bell-item')).toBeVisible();
  phase='old';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>Boolean(old)).toBe(true);
  try{
    await page.locator('.notification-bell-item').click();await expect.poll(()=>Boolean(fresh)).toBe(true);
    await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，1 則未讀');
    // Two newer notices arrived while the one clicked notification was acknowledged.
    phase='settled';await fresh!.fulfill({json:{items:[{...target,read_at:'2026-01-02T00:00:00Z'}],unread_count:2}});fresh=undefined;
    await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，2 則未讀');
    await old!.fulfill({json:{items:[target],unread_count:1}});old=undefined;await frameBarrier(page);
    await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，2 則未讀');expect(writes).toBe(1);
  }finally{phase='settled';if(old)await old.fulfill({json:{items:[target],unread_count:1}});if(fresh)await fresh.fulfill({json:{items:[],unread_count:2}});}
});

for(const outcome of ['ack','failure'] as const)test(`full notification history ignores an old login's late ${outcome}`,async({page})=>{
  const target={...notice,notification_id:'10000000-0000-4000-8000-000000000003',kind:'guild_approved',action:{tab:'guilds',resource_id:null}};
  let pending:Route|undefined;
  await page.route(/\/api\/v1\/me\/notifications\?/,route=>route.fulfill({json:{items:[target],unread_count:1,next_offset:null}}));
  const path=`/me/notifications/${target.notification_id}/read`;
  await page.route('**/api/v1'+path,route=>{pending=route;});
  await login(page);await page.locator('.notification-bell-trigger').click();await page.getByRole('button',{name:'查看所有通知',exact:true}).click();
  await page.getByRole('button',{name:'前往職業公會',exact:true}).click();await expect.poll(()=>Boolean(pending)).toBe(true);
  await signOut(page);await expect(page.getByRole('heading',{name:'登入',exact:true})).toBeVisible();await login(page,'reviewer@local.test',false);
  await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，1 則未讀');
  await page.evaluate(()=>{const w=window as typeof window&{oldHistoryEvents:number};w.oldHistoryEvents=0;window.addEventListener('freedom-inbox-updated',()=>w.oldHistoryEvents++);});
  const url=page.url();
  if(outcome==='ack')await pending!.fulfill({json:{notification_id:target.notification_id,read_at:'2026-01-02T00:00:00Z'}});else await pending!.fulfill({status:503,json:{title:'Old account failure'}});
  await frameBarrier(page);expect(await page.evaluate(()=>(window as typeof window&{oldHistoryEvents:number}).oldHistoryEvents)).toBe(0);
  await expect(page).toHaveURL(url);await expect(page.locator('.notification-bell-read-error')).toHaveCount(0);await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，1 則未讀');
});

 test('a full-history response started earlier cannot replace a newer bell count',async({page})=>{
  let history:Route|undefined,count=1;
  await page.route(preview,route=>route.fulfill({json:{items:[notice],unread_count:count}}));
  await page.route('**/api/v1/me/notifications?limit=20&offset=0',route=>{history=route;});
  await login(page);await page.locator('.notification-bell-trigger').click();await page.getByRole('button',{name:'查看所有通知',exact:true}).click();await expect.poll(()=>Boolean(history)).toBe(true);
  try{
    count=2;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，2 則未讀');
    await history!.fulfill({json:{items:[notice],unread_count:1,next_offset:null}});history=undefined;await expect(page.getByRole('heading',{name:'最新通知',exact:true})).toBeVisible();
    await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知，2 則未讀');
  }finally{if(history)await history.fulfill({json:{items:[],unread_count:1,next_offset:null}});}
});

test('a fresh server record resolves a lost read acknowledgement without another manual read',async({page})=>{
  const target={...notice,notification_id:'10000000-0000-4000-8000-000000000004',action:{tab:'guilds',resource_id:null}};
  let committed=false,writes=0;
  await page.route(preview,route=>route.fulfill({json:{items:[{...target,read_at:committed?'2026-01-02T00:00:00Z':null}],unread_count:committed?0:1}}));
  await page.route(`**/api/v1/me/notifications/${target.notification_id}/read`,route=>{writes++;committed=true;return route.abort();});
  await login(page);await page.locator('.notification-bell-trigger').click();await page.locator('.notification-bell-item').click();
  await expect(page).toHaveURL(/#guilds$/);await expect(page.locator('.notification-bell-read-error')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.notification-bell-read-error')).toHaveCount(0);await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知');expect(writes).toBe(1);
});

test('opening a full-history notification keeps the shell count producer after the list closes',async({page})=>{
  const target={...notice,notification_id:'10000000-0000-4000-8000-000000000005',kind:'guild_approved',action:{tab:'guilds',resource_id:null}};
  let committed=false,writes=0,shell:Route|undefined,history:Route|undefined;
  await page.route(preview,route=>{if(committed){shell=route;return;}return route.fulfill({json:{items:[target],unread_count:1}});});
  await page.route('**/api/v1/me/notifications?limit=20&offset=0',route=>route.fulfill({json:{items:[target],unread_count:1,next_offset:null}}));
  await page.route('**/api/v1/me/notifications?limit=1&offset=0',route=>{history=route;});
  await page.route(`**/api/v1/me/notifications/${target.notification_id}/read`,route=>{writes++;committed=true;return route.fulfill({json:{notification_id:target.notification_id,read_at:'2026-01-02T00:00:00Z'}});});
  await login(page);await page.locator('.notification-bell-trigger').click();await page.getByRole('button',{name:'查看所有通知',exact:true}).click();
  try{
    await page.getByRole('button',{name:'前往職業公會',exact:true}).click();await expect(page).toHaveURL(/#guilds$/);
    await expect(page.getByRole('region',{name:'最近通知'})).toBeHidden();await expect.poll(()=>Boolean(shell)&&Boolean(history)).toBe(true);
    await shell!.fulfill({json:{items:[{...target,read_at:'2026-01-02T00:00:00Z'}],unread_count:0}});shell=undefined;
    await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知');
    await history!.fulfill({json:{items:[],unread_count:99,next_offset:null}});history=undefined;await frameBarrier(page);
    await expect(page.locator('.notification-bell-trigger')).toHaveAccessibleName('通知');expect(writes).toBe(1);
  }finally{if(shell)await shell.fulfill({json:{items:[],unread_count:0}});if(history)await history.fulfill({json:{items:[],unread_count:0,next_offset:null}});}
});
