import {randomBytes} from 'node:crypto';
import {test,expect,openSeller,verifyPassword,expireNextSettingsProof} from './seller-console-fixture.js';
import {fixtureStore} from './hosted-order-fixture.js';
import {DEMO_PASSWORD} from '../../packages/testing/seed.js';

for(const width of [390,1280])test(`missing verification policy preserves the bank draft and identifies the platform blocker (${width}px)`,async({page,browser,baseURL,e2eAuthPool})=>{
 await page.setViewportSize({width,height:900});
 const s=await fixtureStore(e2eAuthPool,browser,baseURL!);
 await openSeller(page,baseURL!,s.seller.email,`#stores/${s.tenant}/${s.instance}/settings/payments`);
 const seller=page.locator('.seller-console'),form=seller.getByRole('form',{name:'線下收款設定'});
 await seller.getByRole('button',{name:'編輯線下收款設定',exact:true}).click();
 await form.getByLabel('提供銀行匯款',{exact:true}).check();
 for(const [label,value] of [['銀行代碼','808'],['銀行名稱','合成測試銀行'],['收款帳號','123456789012'],['戶名','合成測試店主']])await form.getByLabel(label,{exact:true}).fill(value);
 const before=await (await page.request.get('/api/v1'+s.root+'/offline-payment-settings')).json();
 let writes=0;page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/offline-payment-settings'))writes++;});
 // Retire only this run's synthetic policy, preserving the production immutability trigger.
 const policy=(await e2eAuthPool.query("UPDATE tenant_authority_policies SET status='retired' WHERE status='active' RETURNING *")).rows[0];
 expect(policy).toBeTruthy();let restored=false;
 const restore=async()=>{
  await e2eAuthPool.query(`INSERT INTO tenant_authority_policies(revision,status,fresh_auth_ttl_seconds,transfer_ttl_seconds,recovery_approval_ttl_seconds,max_open_recovery_cases_per_tenant)
   VALUES($1,'active',$2,$3,$4,$5)`,[String(BigInt(policy.revision)+1n),policy.fresh_auth_ttl_seconds,policy.transfer_ttl_seconds,policy.recovery_approval_ttl_seconds,policy.max_open_recovery_cases_per_tenant]);
  restored=true;
 };
 try{
  await form.getByRole('button',{name:'儲存線下收款設定',exact:true}).click();
  const blocked=page.waitForResponse(r=>r.url().endsWith('/me/high-risk-verifications'));
  await verifyPassword(page,DEMO_PASSWORD);
  const response=await blocked;expect(response.status()).toBe(403);expect((await response.json()).code).toBe('policy_unconfigured');
  const dialog=page.getByRole('dialog',{name:'驗證身分'});
  await expect(dialog.getByRole('alert')).toHaveText('平台尚未完成身分驗證設定，請聯絡平台管理員處理。');
  await expect(dialog.getByLabel('密碼',{exact:true})).toHaveValue('');
  expect(writes).toBe(0);expect(await (await page.request.get('/api/v1'+s.root+'/offline-payment-settings')).json()).toEqual(before);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM tenant_high_risk_verifications WHERE user_id=$1',[s.seller.id])).rows[0].n).toBe(0);
  await dialog.getByRole('button',{name:'關閉',exact:true}).click();
  await expect(form.getByLabel('收款帳號',{exact:true})).toHaveValue('123456789012');
  await expect(form.getByLabel('戶名',{exact:true})).toHaveValue('合成測試店主');
  await expect(form.getByRole('button',{name:'儲存線下收款設定',exact:true})).toBeFocused();
  await restore();
  await form.getByRole('button',{name:'儲存線下收款設定',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);
  await expect(seller.getByText('已保存：線下收款設定。',{exact:true})).toBeVisible();
  expect(writes).toBe(1);
  const saved=await (await page.request.get('/api/v1'+s.root+'/offline-payment-settings')).json();expect(saved.settings.bank_transfer.account_number).toBe('123456789012');
 }finally{if(!restored)await restore();}
});

test('stale CSRF during payment verification keeps the provider draft and requests a page refresh',async({page,browser,baseURL,e2eAuthPool})=>{
 const s=await fixtureStore(e2eAuthPool,browser,baseURL!);
 await openSeller(page,baseURL!,s.seller.email,`#stores/${s.tenant}/${s.instance}/settings/payments`);
 const seller=page.locator('.seller-console');await seller.getByLabel('特店編號',{exact:true}).fill('1234567');
 await page.route('**/me/high-risk-verifications',route=>route.continue({headers:{...route.request().headers(),'x-csrf-token':'synthetic-stale-token'}}));
 await seller.getByRole('button',{name:'新增綠界帳戶',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);
 const dialog=page.getByRole('dialog',{name:'驗證身分'});
 await expect(dialog.getByRole('alert')).toHaveText('登入狀態已變更，請先保留尚未儲存的內容，再重新整理頁面驗證。');
 await expect(dialog.getByLabel('密碼',{exact:true})).toHaveValue('');
 expect((await (await page.request.get('/api/v1'+s.root+'/provider-accounts')).json()).items).toEqual([]);
 await dialog.getByRole('button',{name:'關閉',exact:true}).click();await expect(seller.getByLabel('特店編號',{exact:true})).toHaveValue('1234567');
 await page.unroute('**/me/high-risk-verifications');
 await seller.getByRole('button',{name:'新增綠界帳戶',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);
 await expect(seller.getByRole('heading',{name:'特店 1234567',exact:true})).toBeVisible();
});

test('E11 account, one-use fresh auth, write-only key replacement, activation, suspend and resume',async({page,browser,baseURL,e2eAuthPool})=>{
 test.setTimeout(180000);const s=await fixtureStore(e2eAuthPool,browser,baseURL!),hash=`#stores/${s.tenant}/${s.instance}/settings/payments`,logs:string[]=[];page.on('console',m=>logs.push(m.text()));await openSeller(page,baseURL!,s.seller.email,hash);const console=page.locator('.seller-console');await expect(console.getByText('storefront@1.1.0',{exact:true})).toBeVisible();await expect(console.getByText('目前版本已無可用升級。',{exact:true})).toBeVisible();
 await console.getByLabel('特店編號',{exact:true}).fill('1234567');await console.getByRole('button',{name:'新增綠界帳戶',exact:true}).click();await verifyPassword(page,'synthetic-wrong-password');await expect(page.getByRole('dialog',{name:'驗證身分'}).getByRole('alert')).toBeVisible();await expect(page.getByRole('dialog').getByLabel('密碼',{exact:true})).toHaveValue('');expect((await (await page.request.get('/api/v1'+s.root+'/provider-accounts')).json()).items).toEqual([]);await verifyPassword(page,DEMO_PASSWORD);await expect(console.getByRole('heading',{name:'特店 1234567',exact:true})).toBeVisible();const accounts=async()=>(await (await page.request.get('/api/v1'+s.root+'/provider-accounts')).json()).items;expect((await accounts())[0].environment).toBe('sandbox');
 const materials=[{key:randomBytes(8).toString('hex'),iv:randomBytes(8).toString('hex')},{key:randomBytes(8).toString('hex'),iv:randomBytes(8).toString('hex')}];
 for(const [index,material] of materials.entries()){await console.getByLabel('HashKey',{exact:true}).fill(material.key);await console.getByLabel('HashIV',{exact:true}).fill(material.iv);await console.getByRole('button',{name:'儲存收款金鑰',exact:true}).click();if(index===0){const dialog=page.getByRole('dialog',{name:'驗證身分'});await expect(dialog.getByLabel('密碼',{exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(console.getByRole('button',{name:'儲存收款金鑰',exact:true})).toBeFocused();await console.getByRole('button',{name:'儲存收款金鑰',exact:true}).click();}await verifyPassword(page,DEMO_PASSWORD);await expect(console.getByText(`已更新（第 ${index+1} 版）`,{exact:false})).toBeVisible();await expect(console.getByLabel('HashKey',{exact:true})).toHaveValue('');await expect(console.getByLabel('HashIV',{exact:true})).toHaveValue('');for(const secret of [material.key,material.iv]){expect(await page.content()).not.toContain(secret);expect(page.url()).not.toContain(secret);expect(logs.join('\n')).not.toContain(secret);}}
 let handed:string|undefined;page.on('response',async response=>{if(response.url().endsWith('/activation-payments')&&response.ok())handed=(await response.json()).handoff_url;});await console.getByRole('button',{name:'進行驗證付款',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);await expect(page.getByRole('heading',{name:'本機付款測試',exact:true})).toBeVisible();expect(handed).toMatch(/^\/pay\/ecpay\//);const activation=(await accounts())[0].payment_activation;expect(activation.state).toBe('awaiting_result');await page.getByRole('button',{name:'付款成功',exact:true}).click();const work=await page.request.post('/__e2e/commerce/run-due-work',{data:{targets:[activation.attempt_ref]}});expect(work.status()).toBe(200);await page.goto('/'+hash);await expect(console.getByText('驗證付款已確認',{exact:false})).toBeVisible();await expect(console.getByText('使用中',{exact:true})).toBeVisible();
 // A consumed verification must be replaced, rather than replayed. The route failure simulates expiry after password verification.
 let refusals=0;const ids:string[]=[];await page.route('**/services/payment/suspend',async route=>{ids.push(route.request().postDataJSON().fresh_auth_verification_id);if(refusals++===0)await route.fulfill({status:403,contentType:'application/problem+json',json:{type:'about:blank',title:'Fresh authentication required',status:403,code:'fresh_auth_required',detail:'請重新驗證'}});else await route.continue();});
 await console.getByRole('button',{name:'暫停',exact:true}).click();await page.getByRole('dialog',{name:'暫停',exact:true}).getByRole('button',{name:'確認暫停'}).click();await verifyPassword(page,DEMO_PASSWORD);await expect(page.getByRole('dialog',{name:'驗證身分'})).toBeVisible();await verifyPassword(page,DEMO_PASSWORD);await expect(console.getByText('已暫停',{exact:true})).toBeVisible();expect(ids).toHaveLength(2);expect(ids[0]).not.toBe(ids[1]);
 await console.getByRole('button',{name:'恢復',exact:true}).click();await page.getByRole('dialog',{name:'恢復',exact:true}).getByRole('button',{name:'確認恢復'}).click();await verifyPassword(page,DEMO_PASSWORD);await expect(console.getByText('使用中',{exact:true})).toBeVisible();
 await console.getByRole('button',{name:'停用',exact:true}).click();const retire=page.getByRole('dialog',{name:'停用',exact:true});await expect(retire).toContainText('無法復原');await retire.getByRole('button',{name:'確認停用'}).click();await verifyPassword(page,DEMO_PASSWORD);await expect(console.getByText('已停用',{exact:true})).toBeVisible();await expect(console.getByLabel('HashKey',{exact:true})).toHaveCount(0);expect((await accounts())[0].services.find((s:{purpose:string})=>s.purpose==='payment').state).toBe('retired');
});


for(const committed of [true,false])test(`provider key recovery with expired proof: ${committed?'committed':'never committed'}`,async({page,browser,baseURL,e2eAuthPool})=>{
 const s=await fixtureStore(e2eAuthPool,browser,baseURL!);await openSeller(page,baseURL!,s.seller.email,`#stores/${s.tenant}/${s.instance}/settings/payments`);
 const console=page.locator('.seller-console');await console.getByLabel('特店編號',{exact:true}).fill('1234567');await console.getByRole('button',{name:'新增綠界帳戶',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);await expect(console.getByRole('heading',{name:'特店 1234567',exact:true})).toBeVisible();
 const expired=await expireNextSettingsProof(page,e2eAuthPool),requests:{key:string;body:string|null;version:string|undefined;recovery:string|undefined}[]=[];
 await page.route('**/services/payment',async route=>{
  const r=route.request(),h=r.headers();requests.push({key:h['idempotency-key'],body:r.postData(),version:h['if-match'],recovery:h['commerce-recovery-verification']});
  if(requests.length===1&&!committed){await route.abort('failed');return;}
  const response=await route.fetch();if(requests.length===1){expect(response.status(),await response.text()).toBe(200);await route.abort('failed');}else await route.fulfill({response});
 });
 const key=randomBytes(8).toString('hex'),iv=randomBytes(8).toString('hex');await console.getByLabel('HashKey',{exact:true}).fill(key);await console.getByLabel('HashIV',{exact:true}).fill(iv);await console.getByRole('button',{name:'儲存收款金鑰',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);
 await expect(page.getByText('正在確認結果',{exact:true})).toBeVisible();await expired();await console.getByRole('button',{name:'重試',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);
 await expect(console.getByText('已更新（第 1 版）',{exact:false})).toBeVisible();await expect(console.getByLabel('HashKey',{exact:true})).toHaveValue('');await expect(console.getByLabel('HashIV',{exact:true})).toHaveValue('');
 expect(requests).toHaveLength(3);for(const r of requests)expect({key:r.key,body:r.body,version:r.version}).toEqual({key:requests[0].key,body:requests[0].body,version:requests[0].version});expect(requests[2].recovery).toBeTruthy();
 expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM commerce_provider_credentials WHERE instance_id=$1',[s.instance])).rows[0].n).toBe(1);
 expect(await page.content()).not.toContain(key);expect(await page.content()).not.toContain(iv);
});
