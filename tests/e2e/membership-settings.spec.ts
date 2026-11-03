import {test,expect,type Page} from './fixtures.js';
import {openAccountSettings} from './navigation.js';

async function login(page:Page){
  await page.goto('/#account');
  await page.getByLabel('電子郵件',{exact:true}).fill('client@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByLabel('社群顯示名稱',{exact:true})).toBeVisible();
}

test('account puts share settings first, keeps three account groups, and disclosures preserve drafts without writes',async({page})=>{
  const recommendations:string[]=[],writes:string[]=[];
  page.on('request',request=>{if(request.url().includes('/members/recommendations'))recommendations.push(request.url());if(request.method()==='POST'&&request.url().includes('/api/v1/me/'))writes.push(request.url());});
  await login(page);
  const sections=page.locator('.account-settings-section');
  await expect(sections.locator(':scope > summary strong')).toHaveText(['分享名片設定（免登入）','個人資料','誰能看到我','帳號與安全']);
  const section=(label:string)=>sections.getByText(label,{exact:true}).locator('xpath=ancestor::details[1]');
  const share=section('分享名片設定（免登入）'),personal=section('個人資料'),privacy=section('誰能看到我'),securitySection=section('帳號與安全');
  await expect(share).toHaveJSProperty('open',false);
  await expect(personal).toHaveJSProperty('open',true);
  await expect(privacy).toHaveJSProperty('open',false);
  await expect(securitySection).toHaveJSProperty('open',false);
  const shareToggle=share.locator(':scope > summary');
  await expect(shareToggle).toBeVisible();await shareToggle.focus();await page.keyboard.press('Enter');
  await expect(share).toHaveJSProperty('open',true);await expect(shareToggle).toBeFocused();
  await expect(privacy).toHaveJSProperty('open',false);
  await page.keyboard.press('Enter');await expect(share).toHaveJSProperty('open',false);
  await expect(page.getByRole('region',{name:'認識一位工坊夥伴'})).toHaveCount(0);
  const name=page.getByLabel('社群顯示名稱',{exact:true});await name.fill('尚未儲存的測試名字');
  await personal.locator(':scope > summary').click();
  await openAccountSettings(page,'誰能看到我');
  await page.getByRole('group',{name:'聯絡 E-mail可見範圍',exact:true}).getByRole('checkbox',{name:'不公開',exact:true}).check();
  await page.getByRole('group',{name:'聯絡 E-mail可見範圍',exact:true}).getByRole('checkbox',{name:'平台好友',exact:true}).check();
  await privacy.locator(':scope > summary').click();
  await openAccountSettings(page,'個人資料');await expect(name).toHaveValue('尚未儲存的測試名字');
  await openAccountSettings(page,'誰能看到我');
  await expect(page.getByRole('group',{name:'聯絡 E-mail可見範圍',exact:true}).getByRole('checkbox',{name:'平台好友',exact:true})).toBeChecked();
  expect(recommendations).toEqual([]);expect(writes).toEqual([]);
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const summary of await sections.locator(':scope > summary').all())expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const security=securitySection.locator(':scope > summary');await security.focus();await page.keyboard.press('Enter');
  await expect(securitySection).toHaveJSProperty('open',true);await expect(security).toBeFocused();
  await expect(page.getByRole('heading',{name:'登入與安全',exact:true})).toBeVisible();
  expect(writes).toEqual([]);
});

test('cancelled navigation keeps account edits and accepted back discards only local drafts',async({page})=>{
  await login(page);
  // Establish a real prior history entry without changing account settings.
  await page.getByRole('button',{name:'返回我的個人空間',exact:true}).click();
  await page.goto('/#account');
  const name=page.getByLabel('社群顯示名稱',{exact:true});await name.fill('保留中的草稿');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'返回我的個人空間',exact:true}).click();
  await expect(page).toHaveURL(/#account$/);await expect(name).toHaveValue('保留中的草稿');
  page.once('dialog',dialog=>dialog.dismiss());await page.goBack();
  await expect(page).toHaveURL(/#account$/);await expect(name).toHaveValue('保留中的草稿');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'返回我的個人空間',exact:true}).click();
  await expect(page).toHaveURL(/#profile$/);
});

test('uncertain profile save locks edits and retries the exact body, version and idempotency key',async({page})=>{
  await login(page);
  await page.getByRole('button',{name:'返回我的個人空間',exact:true}).click();
  await page.goto('/#account');
  await expect(page.getByLabel('社群顯示名稱',{exact:true})).toBeVisible();
  const original=await (await page.request.get('/api/v1/me/account')).json();
  const requests:{body:unknown;key:string;version:string}[]=[];
  // All writes in this case are intercepted; no actual member setting is changed.
  await page.route('**/api/v1/me/account',async route=>{
    if(route.request().method()!=='POST'){await route.fulfill({json:original});return;}
    const request=route.request();requests.push({body:request.postDataJSON(),key:request.headers()['idempotency-key'],version:request.headers()['if-match']});
    if(requests.length===1)await route.abort('failed');
    else await route.fulfill({json:{...original,nickname:'測試儲存'}});
  });
  await page.getByLabel('社群顯示名稱',{exact:true}).fill('測試儲存');
  await page.getByRole('button',{name:'儲存修改',exact:true}).click();
  await expect(page.getByRole('button',{name:'確認儲存結果',exact:true})).toBeVisible();
  await expect(page.getByLabel('社群顯示名稱',{exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'返回我的個人空間',exact:true})).toBeDisabled();
  await page.goBack();await expect(page).toHaveURL(/#account$/);
  await page.getByRole('button',{name:'確認儲存結果',exact:true}).click();
  await expect(page.getByText('修改已儲存。',{exact:true})).toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
  await expect(page.getByLabel('社群顯示名稱',{exact:true})).toBeEnabled();
});
