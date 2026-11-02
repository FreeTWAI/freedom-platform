import {test,expect,type Page} from './fixtures.js';
async function login(page:Page) {
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('reviewer@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
}
async function clear(page:Page) {
  const session=await (await page.request.get('/api/v1/session')).json();
  const view=await (await page.request.get('/api/v1/me/tester-map')).json();
  const r=await page.request.post('/api/v1/me/tester-map',{headers:{Origin:new URL(page.url()).origin,'X-CSRF-Token':session.csrf_token,'Idempotency-Key':crypto.randomUUID(),'If-Match':`"${view.version}"`},data:{action:'clear'}});
  expect(r.status()).toBe(200);
}
test('TESTER-ACCOUNT-001 login imports guest progress before opening map; feedback stays private and Issue draft requires confirmation',async({page,browser,baseURL})=>{
  await login(page);await clear(page);
  const context=await browser.newContext({baseURL});
  const device=await context.newPage();
  try {
    await device.goto('/#tester-map');
    await device.locator('[data-step-id="arrival.preview"]').getByRole('button',{name:'完成這一步',exact:true}).click();
    await device.getByRole('link',{name:'返回登入',exact:true}).click();
    await device.getByLabel('電子郵件',{exact:true}).fill('reviewer@local.test');await device.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await device.getByRole('button',{name:'登入',exact:true}).click();
    await expect(device.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
    await expect.poll(async()=>((await (await device.request.get('/api/v1/me/tester-map')).json()).progress.done)).toContain('arrival.preview');
    expect(await device.evaluate(()=>localStorage.getItem('freedom-tester-map-progress-v1'))).toBeNull();
    await device.goto('/#tester-map');
    await expect(device.locator('[data-step-id="arrival.preview"]').getByRole('button',{name:'取消完成',exact:true})).toBeEnabled();
    const step=device.locator('[data-step-id="arrival.preview"]');
    await step.getByRole('button',{name:'通過',exact:true}).click();
    await expect(step.getByText('謝謝你幫忙測試！',{exact:true})).toBeVisible();
    await expect(step.getByRole('status').first()).toContainText('已送出');
    await step.getByRole('button',{name:'有問題',exact:true}).click();
    await step.getByRole('textbox').fill('Synthetic button did not open');await step.getByRole('button',{name:'儲存回饋',exact:true}).click();
    await expect(step.getByRole('status').first()).toContainText('回饋已保存');
    await step.getByRole('button',{name:'轉成公開 Issue（先確認）',exact:true}).click();
    const dialog=device.getByRole('dialog');await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('標題',{exact:true})).toHaveValue('不登入先看看');
    await expect(dialog.getByRole('textbox',{name:'想法與期待',exact:true})).toHaveValue(/Synthetic button did not open/);
    await expect(dialog.getByText('已發布',{exact:true})).toHaveCount(0);
    await dialog.getByRole('button',{name:'關閉',exact:true}).click();
    await device.reload();await expect(step.getByRole('button',{name:'取消完成',exact:true})).toBeEnabled();
    await step.locator('details > summary').click();await expect(step.getByRole('textbox')).toHaveValue('Synthetic button did not open');
    await device.setViewportSize({width:390,height:844});expect(await device.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await device.screenshot({path:'test-results/tester-map-account-mobile.png',fullPage:true});
    // A fresh device has the same private medals without a local copy.
    await page.goto('/#tester-map');await expect(page.locator('[data-medal-id="first-step"]')).toContainText('已獲得');
    expect(await page.evaluate(()=>localStorage.getItem('freedom-tester-map-progress-v1'))).toBeNull();
    await clear(device);
  } finally {await context.close();}
});

test('TESTER-ACCOUNT-002 failed import retains guest progress and retries the immutable union',async({page})=>{
  await login(page);await clear(page);
  // Separate anonymous browser storage after the authenticated reset.
  await page.context().clearCookies();await page.goto('/#tester-map');
  await page.locator('[data-step-id="arrival.preview"]').getByRole('button',{name:'完成這一步',exact:true}).click();
  let fail=true;
  await page.route('**/api/v1/me/tester-map',async route=>{
    if(fail&&route.request().method()==='POST')return route.abort('failed');
    return route.continue();
  });
  await page.getByRole('link',{name:'返回登入',exact:true}).click();await page.getByLabel('電子郵件',{exact:true}).fill('reviewer@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('heading',{name:'會員首頁',exact:true})).toBeVisible();
  await page.goto('/#tester-map');await expect(page.getByRole('alert')).toContainText('尚未確認儲存結果');
  expect(await page.evaluate(()=>localStorage.getItem('freedom-tester-map-progress-v1'))).toContain('arrival.preview');
  fail=false;await page.getByRole('button',{name:'重試',exact:true}).click();
  await expect(page.locator('[data-step-id="arrival.preview"]').getByRole('button',{name:'取消完成',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>localStorage.getItem('freedom-tester-map-progress-v1'))).toBeNull();
  await clear(page);
});


test('TESTER-ACCOUNT-003 current builders read anonymous feature reports; revocation blocks a refresh',async({page,e2eAuthPool})=>{
  await login(page);await clear(page);
  const session=await (await page.request.get('/api/v1/session')).json(),user=session.user;
  const membership=crypto.randomUUID();
  await e2eAuthPool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state,member_tier)
    SELECT $1,community_id,user_id,'guild_platform_engineering','active','full' FROM users WHERE user_id=$2`,[membership,user.user_id]);
  try {
    const view=await (await page.request.get('/api/v1/me/tester-map')).json();
    const feedback=await page.request.post('/api/v1/me/tester-map',{headers:{Origin:new URL(page.url()).origin,'X-CSRF-Token':session.csrf_token,'Idempotency-Key':crypto.randomUUID(),'If-Match':`"${view.version}"`},data:{action:'feedback',step_id:'arrival.preview',result:'problem',note:'Synthetic report issue'}});
    expect(feedback.status()).toBe(200);await page.goto('/#tester-map');
    const report=page.locator('section').filter({has:page.getByRole('heading',{name:'測試報告',exact:true})}).last();
    await expect(report.getByRole('link',{name:'測試報告',exact:true})).toBeVisible();
    await report.getByRole('button',{name:'重新讀取',exact:true}).click();
    await expect(report.getByText('Synthetic report issue',{exact:true}).first()).toBeVisible();
    await expect(report).toContainText('測試人數／通過率: 1 / 0%');
    const module=report.locator('[data-report-module="portal-shell"]');
    const item=module.locator('li').filter({has:page.getByText('Synthetic report issue',{exact:true})}).first();
    await item.getByRole('button',{name:'儲存回饋',exact:true}).click();
    await expect(item.locator('.chip')).toHaveText('建造者已看到');
    await expect(report).not.toContainText(user.user_id);await expect(report).not.toContainText(user.email);
    await page.screenshot({path:'test-results/tester-map-report-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await e2eAuthPool.query("UPDATE positioning_profession_memberships SET state='left' WHERE membership_id=$1",[membership]);
    await report.getByRole('button',{name:'重新讀取',exact:true}).click();
    await expect(report.getByRole('alert')).toHaveText('無法讀取測試報告。');
    await expect(report.getByText('Synthetic report issue',{exact:true})).toHaveCount(0);
    await clear(page);
  } finally {await e2eAuthPool.query('DELETE FROM positioning_profession_memberships WHERE membership_id=$1',[membership]);}
});

test('TESTER-ACCOUNT-004 empty map shows the optional start card and opens the first step',async({page})=>{
 await page.goto('/#tester-map');
 const card=page.locator('section[aria-labelledby="tester-start-title"]');
 await expect(card.getByRole('heading',{name:'從這裡開始',exact:true})).toBeVisible();
 await expect(card.locator('ol > li')).toHaveCount(3);
 await expect(card).toContainText('參與完全自願，不計分、不排名。');
 await page.locator('[data-stage-id="arrival"] > summary').click();
 await card.getByRole('button',{name:'試第一步',exact:true}).click();
 await expect(page.locator('[data-stage-id="arrival"]')).toHaveAttribute('open','');
 await expect(page.locator('[data-step-id="arrival.preview"] a').first()).toBeFocused();
});
