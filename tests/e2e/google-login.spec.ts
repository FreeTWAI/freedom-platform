import {randomUUID} from 'node:crypto';
import {test,expect,type Page} from './fixtures.js';

// Browser contracts use synthetic provider responses. They do not authenticate with Google.
const ENTRY_KEY='freedom-google-entry-v1',IDENTITY='22222222-2222-4222-8222-222222222222';
const STATE='s'.repeat(43),CODE='synthetic-authorization-code',CHALLENGE='c'.repeat(43),ACTIVATION='a'.repeat(43);
const PROOF={activation_required:true,activation:ACTIVATION};
const SESSION={user:{user_id:'11111111-1111-4111-8111-111111111111',display_name:'Synthetic member',email:'synthetic@example.test',profession_membership_ref:'synthetic'},csrf_token:'synthetic-csrf'};
const SKILL_ENTRY='/?skill_acquisition=1&return_to=%2Fdevelopment%2Fskills%2Fgoogle-test&skill_intro=2';

async function remember(page:Page,entry=SKILL_ENTRY,intent:'login'|'link'='login'){
  await page.goto('/');await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();
  await page.evaluate(({key,entry,intent})=>sessionStorage.setItem(key,JSON.stringify({entry,intent,startedAt:Date.now()})),{key:ENTRY_KEY,entry,intent});
}
async function callback(page:Page,query=`state=${STATE}&code=${CODE}`){await page.goto(`/google/callback?${query}`);}
async function mockActivation(page:Page,registered=false){
  let activated=false;
  await page.route('**/api/v1/auth/google/activate',async route=>{expect(route.request().postDataJSON()).toEqual({activation:ACTIVATION});activated=true;await route.fulfill({json:{...SESSION,registered}})});
  await page.route('**/api/v1/session',route=>activated?route.fulfill({json:SESSION}):route.continue());
}
async function skillReturn(page:Page,registered=false){
  await mockActivation(page,registered);
  await page.route('**/development/skills/google-test',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Skill return</title><h1 id="skill-use-title">Synthetic skill</h1>'}));
}
async function loginAccount(page:Page){
  await page.goto('/#account');await page.getByLabel('電子郵件',{exact:true}).fill('client@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('heading',{name:'登入與安全',exact:true})).toBeVisible();
}

test('OFF hides Google controls and preserves ordinary password login',async({page})=>{
  await page.route('**/api/v1/auth/google/config',route=>route.fulfill({json:{enabled:false}}));
  await page.route('**/api/v1/me/google',route=>route.fulfill({json:{enabled:false,linked:false}}));
  await page.goto('/');await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'使用 Google 繼續'})).toHaveCount(0);
  await loginAccount(page);await expect(page.getByRole('form',{name:'修改密碼'})).toBeVisible();await expect(page.locator('.google-account')).toHaveCount(0);
});

test('ON starts a full-page Google redirect and stores only non-secret continuity',async({page})=>{
  await page.route('**/api/v1/auth/google/config',route=>route.fulfill({json:{enabled:true}}));
  let body:unknown=null;
  await page.route('**/api/v1/auth/google/start',async route=>{body=route.request().postDataJSON();await route.fulfill({json:{url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic-provider-state'}})});
  await page.route('https://accounts.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Synthetic Google authorization</h1>'}));
  await page.goto(SKILL_ENTRY);await page.getByRole('button',{name:'使用 Google 繼續'}).click();
  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);expect(body).toEqual({});
  await page.goBack();
  const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)??'null'),ENTRY_KEY);
  expect(saved).toMatchObject({intent:'login',entry:SKILL_ENTRY});expect(Object.keys(saved).sort()).toEqual(['entry','intent','startedAt']);
});

test('callback scrubs query before POST and reuses validated skill return',async({page})=>{
  await skillReturn(page,true);let calls=0;
  await page.route('**/api/v1/auth/google/complete',async route=>{
    calls++;expect(new URL(page.url()).search).not.toContain('code=');expect(new URL(page.url()).pathname).toBe('/');
    expect(route.request().postDataJSON()).toEqual({state:STATE,code:CODE});expect(route.request().headers()['x-csrf-token']).toBeUndefined();
    await route.fulfill({json:PROOF});
  });
  await remember(page);await callback(page);
  await expect(page).toHaveURL(/\/development\/skills\/google-test\?intro=2#skill-use-title$/);expect(calls).toBe(1);
  expect(await page.evaluate(key=>sessionStorage.getItem(key),ENTRY_KEY)).toBeNull();
});

test('Google TOTP remains required and neither challenge nor codes enter browser storage',async({page})=>{
  await skillReturn(page);let factorCalls=0;
  await page.route('**/api/v1/auth/google/complete',route=>route.fulfill({json:{totp_required:true,challenge:CHALLENGE}}));
  await page.route('**/api/v1/auth/google/totp',async route=>{
    factorCalls++;expect(route.request().postDataJSON()).toEqual({challenge:CHALLENGE,code:factorCalls===1?'000000':'123456'});
    if(factorCalls===1)await route.fulfill({status:401,json:{code:'invalid_totp',detail:'驗證碼不正確或已使用。'}});
    else await route.fulfill({json:PROOF});
  });
  await remember(page);await callback(page);
  const factor=page.getByLabel('驗證器代碼或備用碼',{exact:true});await expect(factor).toBeFocused();
  expect(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))).not.toContain(CHALLENGE);
  await factor.fill('000000');await page.getByRole('button',{name:'完成登入',exact:true}).click();await expect(page.getByRole('alert')).toContainText('不正確');
  await factor.fill('123456');await page.getByRole('button',{name:'完成登入',exact:true}).click();await expect(page).toHaveURL(/\/development\/skills\/google-test\?intro=2#skill-use-title$/);expect(factorCalls).toBe(2);
});

test('MFA cancellation uses same-origin cancel and clears the factor form',async({page})=>{
  let cancelled=0;await page.route('**/api/v1/auth/google/complete',route=>route.fulfill({json:{totp_required:true,challenge:CHALLENGE}}));
  await page.route('**/api/v1/auth/google/cancel',async route=>{cancelled++;expect(route.request().postDataJSON()).toEqual({state:STATE});await route.fulfill({json:{cancelled:true}})});
  await remember(page);await callback(page);await page.getByRole('button',{name:'取消 Google 登入'}).click();
  const result=page.getByRole('region',{name:'完成 Google 登入',exact:true});
  await expect(result.getByRole('button',{name:'返回登入入口',exact:true})).toBeVisible();
  await expect(result.getByRole('status')).toContainText('已取消 Google 登入');await expect(page.getByLabel('驗證器代碼或備用碼',{exact:true})).toHaveCount(0);expect(cancelled).toBe(1);
});

test('provider cancellation consumes state without completing login or reflecting provider text',async({page})=>{
  let completed=0,cancelled=0;
  await page.route('**/api/v1/auth/google/complete',async route=>{completed++;await route.fulfill({json:PROOF})});
  await page.route('**/api/v1/auth/google/cancel',async route=>{cancelled++;await route.fulfill({json:{cancelled:true}})});
  await remember(page);await callback(page,`state=${STATE}&error=access_denied&error_description=UNTRUSTED_PROVIDER_TEXT`);
  const result=page.getByRole('region',{name:'完成 Google 登入',exact:true});
  await expect(result.getByRole('button',{name:'返回登入入口',exact:true})).toBeVisible();
  await expect(result.getByRole('status')).toContainText('已取消這次 Google 授權');expect(completed).toBe(0);expect(cancelled).toBe(1);expect(page.url()).not.toContain('error');await expect(page.getByText('UNTRUSTED_PROVIDER_TEXT')).toHaveCount(0);
});

for(const [entry,heading] of [['/#newbie-village','新手村任務'],['/#community-hub','社群入口總覽'],['/#tester-map','測試員地圖']])test(`provider cancellation takes precedence over anonymous entry ${entry}`,async({page})=>{
  let cancelled=0;
  await page.route('**/api/v1/auth/google/cancel',async route=>{cancelled++;await route.fulfill({json:{cancelled:true}})});
  await remember(page,entry);await callback(page,`state=${STATE}&error=access_denied`);
  const result=page.getByRole('region',{name:'完成 Google 登入',exact:true});
  await expect(result).toBeVisible();await expect(result.getByRole('status')).toContainText('已取消這次 Google 授權');
  await expect(page.getByRole('heading',{name:heading,exact:true})).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe(new URL(entry,'http://localhost').hash);expect(cancelled).toBe(1);
});

for(const entry of ['https://attacker.example/','//attacker.example/','/google/callback?code=secret','/?return_to=https%3A%2F%2Fattacker.example%2F','/#reset-password/'+STATE])test(`rejects unsafe saved continuity: ${entry}`,async({page})=>{
  let completed=0;await page.route('**/api/v1/auth/google/complete',async route=>{completed++;await route.fulfill({json:PROOF})});
  await remember(page,entry);await callback(page);await expect(page.getByRole('alert')).toContainText('未完成或已失效');expect(new URL(page.url()).pathname).toBe('/');expect(new URL(page.url()).search).toBe('');expect(completed).toBe(0);
});

test('an existing session never bypasses a login-intent callback conflict',async({page})=>{
  await remember(page,'/#account');let completed=0;
  await page.route('**/api/v1/session',route=>route.fulfill({json:SESSION}));
  await page.route('**/api/v1/auth/google/complete',async route=>{completed++;await route.fulfill({status:409,json:{code:'google_session_changed',detail:'已有登入中的帳號'}})});
  await callback(page);await expect(page.getByRole('alert')).toContainText('未完成或已失效');expect(completed).toBe(1);await expect(page.getByRole('heading',{name:'登入與安全'})).toHaveCount(0);
});

test('link callback reads current session and uses member CSRF without logging in',async({page})=>{
  await remember(page,'/#account','link');let linked=0,login=0;
  await page.route('**/api/v1/session',route=>route.fulfill({json:SESSION}));
  await page.route('**/api/v1/auth/google/complete',async route=>{login++;await route.fulfill({json:PROOF})});
  await page.route('**/api/v1/me/google/complete',async route=>{linked++;expect(route.request().headers()['x-csrf-token']).toBe(SESSION.csrf_token);expect(route.request().postDataJSON()).toEqual({state:STATE,code:CODE});await route.fulfill({status:409,json:{code:'google_session_changed',detail:'原登入已變更'}})});
  await callback(page);await expect(page.getByRole('alert')).toContainText('未完成或已失效');expect(linked).toBe(1);expect(login).toBe(0);
});

test('passwordless recovery remains available while Google is OFF and session list stays usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/v1/me/account',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),has_password:false}})});
  await page.route('**/api/v1/me/google',route=>route.fulfill({json:{enabled:false,linked:true,identity_id:IDENTITY}}));
  let requests=0;await page.route('**/api/v1/auth/reset/request',async route=>{requests++;expect(route.request().postDataJSON()).toEqual({email:'client@local.test'});await route.fulfill({json:{requested:true}})});
  await loginAccount(page);await expect(page.getByRole('heading',{name:'設定工坊密碼',exact:true})).toBeVisible();
  await expect(page.getByRole('form',{name:'修改密碼'})).toHaveCount(0);await expect(page.getByRole('form',{name:'停用帳號'})).toHaveCount(0);await expect(page.getByRole('heading',{name:'變更登入 Email',exact:true})).toHaveCount(0);await expect(page.locator('.totp-settings')).toHaveCount(0);
  await expect(page.locator('.account-security .session-row')).not.toHaveCount(0);await expect(page.getByRole('button',{name:'解除 Google 連結'})).toHaveCount(0);
  await page.getByRole('button',{name:'寄送設定密碼連結'}).click();await expect(page.locator('.password-setup [role=status]')).toContainText('30 分鐘');expect(requests).toBe(1);
  await expect(page.locator('html')).toHaveJSProperty('scrollWidth',390);
});

test('leaving a callback entry prevents a late completion from applying or redirecting',async({page})=>{
  await skillReturn(page);let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});
  await page.route('**/api/v1/auth/google/complete',async route=>{await gate;await route.fulfill({json:PROOF})});
  await remember(page);const requested=page.waitForRequest('**/api/v1/auth/google/complete');
  try{
    await callback(page);await requested;await page.evaluate(()=>{window.location.hash='tasks'});
    await expect(page.getByRole('alert')).toContainText('頁面已變更');
    const response=page.waitForResponse('**/api/v1/auth/google/complete');release();await response;
    await page.getByRole('heading',{name:'完成 Google 登入',exact:true}).click();
    await expect(page).toHaveURL(/#tasks$/);await expect(page.getByRole('alert')).toContainText('頁面已變更');
  }finally{release();}
});

test('an existing password account can unlink while Google is OFF only after password submission',async({page})=>{
  let calls=0;await page.route('**/api/v1/me/google',route=>route.fulfill({json:calls<2?{enabled:false,linked:true,identity_id:IDENTITY}:{enabled:false,linked:false,identity_id:null}}));
 await page.route('**/api/v1/me/google/unlink',async route=>{
    calls++;expect(route.request().headers()['x-csrf-token']).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({password:calls===1?'wrong-password':'freedom-local-demo',identity_id:IDENTITY});
    await route.fulfill(calls===1?{status:403,json:{code:'password_verification_failed',detail:'密碼不正確'}}:{json:{unlinked:true}});
  });
  await loginAccount(page);const panel=page.locator('.google-account');
  await panel.getByLabel('目前工坊密碼').fill('wrong-password');await panel.getByRole('button',{name:'解除 Google 連結'}).click();await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.getByText('已連結 Google。',{exact:false})).toBeVisible();
  await panel.getByLabel('目前工坊密碼').fill('freedom-local-demo');await panel.getByRole('button',{name:'解除 Google 連結'}).click();await expect(panel).toHaveCount(0);expect(calls).toBe(2);
});


async function registerNewcomer(page:Page){
  const email=`google-passwordless-${randomUUID()}@example.test`;
  await page.goto('/');await page.getByRole('button',{name:'建立帳號',exact:true}).click();
  const form=page.locator('.login-card form');await form.locator('[name=email]').fill(email);await form.locator('[name=password]').fill('synthetic-google-recovery-2026');await form.locator('[name=nickname]').fill('Google recovery member');
  await form.getByRole('button',{name:'建立帳號，先逛工坊',exact:true}).click();await expect(page.locator('.welcome-preview')).toBeVisible();return email;
}
async function openNewcomerDeactivation(page:Page){
  const menu=page.locator('.preview-profile-menu');await menu.locator(':scope > summary').click();await menu.getByRole('button',{name:'停用帳號',exact:true}).click();return menu;
}
for(const surface of ['preview','onboarding'] as const)test(`passwordless ${surface} deactivation offers mailbox setup instead of an impossible password form`,async({page})=>{
  await page.setViewportSize({width:surface==='preview'?390:320,height:844});
  await page.route('**/api/v1/me/account',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),has_password:false}})});
  const email=await registerNewcomer(page);
  if(surface==='onboarding'){
    await page.locator('.welcome-optional > summary').click();await page.locator('.welcome-optional .experience-actions button').first().click();await expect(page.locator('.onboarding-layout')).toBeVisible();
  }
  let requested=0;await page.route('**/api/v1/auth/reset/request',async route=>{requested++;expect(route.request().postDataJSON()).toEqual({email});await route.fulfill({json:{requested:true}})});
  const menu=await openNewcomerDeactivation(page);
  await expect(menu.getByRole('heading',{name:'設定工坊密碼',exact:true})).toBeVisible();await expect(menu.locator('.password-setup')).toContainText(email);
  await expect(menu.getByRole('form',{name:'停用帳號',exact:true})).toHaveCount(0);await expect(menu.locator('input[type=password]')).toHaveCount(0);
  await menu.getByRole('button',{name:'寄送設定密碼連結',exact:true}).click();await expect(menu.locator('.password-setup [role=status]')).toContainText('30 分鐘');expect(requested).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const surface of ['preview','onboarding'] as const)test(`late passwordless account read from ${surface} cannot expose the prior email after session change`,async({page})=>{
  const previousEmail=await registerNewcomer(page);
  if(surface==='onboarding'){
    await page.locator('.welcome-optional > summary').click();await page.locator('.welcome-optional .experience-actions button').first().click();await expect(page.locator('.onboarding-layout')).toBeVisible();
  }
  let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve});let held=()=>{};const started=new Promise<void>(resolve=>{held=resolve});let first=true;
  await page.route('**/api/v1/me/account',async route=>{
    if(route.request().method()!=='GET'||!first)return route.continue();first=false;
    const response=await route.fetch(),account=await response.json();held();await gate;await route.fulfill({response,json:{...account,has_password:false}});
  });
  try{
    const menu=await openNewcomerDeactivation(page);await started;
    await expect(menu.locator('input[type=password]')).toHaveCount(0);
    await menu.getByRole('button',{name:'登出',exact:true}).click();await expect(page.locator('.login-card')).toBeVisible();
    // Sign into a different existing account without reloading this document.
    await page.getByLabel('電子郵件',{exact:true}).fill('client@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
    await expect(page.locator('.workspace-main')).toBeVisible();const response=page.waitForResponse(response=>response.url().endsWith('/me/account')&&response.request().method()==='GET');release();await response;
    await expect(page.getByText(previousEmail,{exact:false})).toHaveCount(0);await expect(page.locator('.password-setup')).toHaveCount(0);await expect(page.locator('.preview-profile-menu')).toHaveCount(0);
  }finally{release();}
});


test('activation ACK is sent once only after complete body and never stored',async({page})=>{
  await skillReturn(page);await remember(page);let completeReceived=()=>{},release=()=>{};const received=new Promise<void>(resolve=>{completeReceived=resolve}),gate=new Promise<void>(resolve=>{release=resolve});
  let bodyDelivered=false,acks=0,sessionReads=0;
  await page.route('**/api/v1/auth/google/complete',async route=>{completeReceived();await gate;bodyDelivered=true;await route.fulfill({json:PROOF})});
  await page.route('**/api/v1/auth/google/activate',async route=>{
    acks++;expect(bodyDelivered).toBe(true);expect(route.request().postDataJSON()).toEqual({activation:ACTIVATION});expect(route.request().headers()['x-csrf-token']).toBeUndefined();
    expect(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))).not.toContain(ACTIVATION);expect(page.url()).not.toContain(ACTIVATION);
    await route.fulfill({json:{...SESSION,registered:true}});
  });
  await page.route('**/api/v1/session',async route=>{sessionReads++;expect(acks).toBe(1);await route.fulfill({json:SESSION})});
  try{
    await callback(page);await received;expect(acks).toBe(0);expect(sessionReads).toBe(0);
    release();await expect(page).toHaveURL(/\/development\/skills\/google-test\?intro=2#skill-use-title$/);expect(acks).toBe(1);expect(sessionReads).toBe(1);
  }finally{release();}
});

for(const mismatch of ['different-user','new-csrf'] as const)test(`activation rejects current session ${mismatch} rather than installing stale ACK`,async({page})=>{
  await skillReturn(page);await remember(page);let acks=0;
  await page.route('**/api/v1/auth/google/complete',route=>route.fulfill({json:PROOF}));
  await page.route('**/api/v1/auth/google/activate',async route=>{acks++;await route.fulfill({json:SESSION})});
  const changed=mismatch==='different-user'?{...SESSION,user:{...SESSION.user,user_id:'22222222-2222-4222-8222-222222222222'}}:{...SESSION,csrf_token:'newer-current-csrf'};
  await page.route('**/api/v1/session',route=>route.fulfill({json:changed}));
  await callback(page);await expect(page.getByRole('alert')).toContainText('目前登入的帳號或登入狀態已變更');await expect(page.getByRole('button',{name:'返回登入入口'})).toBeVisible();
  expect(acks).toBe(1);expect(new URL(page.url()).pathname).toBe('/');await expect(page.locator('.workspace-main')).toHaveCount(0);
});

for(const outcome of ['rejected','lost-response'] as const)test(`activation ${outcome} never claims login or resubmits ACK`,async({page})=>{
  await skillReturn(page);await remember(page);let acks=0,reads=0;
  await page.route('**/api/v1/auth/google/complete',route=>route.fulfill({json:PROOF}));
  await page.route('**/api/v1/auth/google/activate',async route=>{acks++;if(outcome==='lost-response')await route.abort('failed');else await route.fulfill({status:409,json:{code:'google_activation_expired',detail:'確認已失效'}})});
  await page.route('**/api/v1/session',async route=>{reads++;await route.fulfill({json:SESSION})});
  await callback(page);await expect(page.getByRole('alert')).toContainText(outcome==='lost-response'?'尚未確認 Google 登入結果':'未完成或已失效');await expect(page.getByRole('button',{name:'返回登入入口'})).toBeVisible();
  expect(acks).toBe(1);expect(reads).toBe(outcome==='lost-response'?1:0);expect(new URL(page.url()).pathname).toBe('/');await expect(page.locator('.workspace-main')).toHaveCount(0);
});

test('a legacy session-shaped completion cannot skip dormant-session activation',async({page})=>{
  await remember(page);let acks=0;
  await page.route('**/api/v1/auth/google/complete',route=>route.fulfill({json:SESSION}));
  await page.route('**/api/v1/auth/google/activate',async route=>{acks++;await route.fulfill({json:SESSION})});
  await callback(page);await expect(page.getByRole('alert')).toContainText('登入確認資料不完整');expect(acks).toBe(0);await expect(page.locator('.workspace-main')).toHaveCount(0);
});

for(const outcome of ['stale-409','unknown'] as const)test(`unlink ${outcome} never retries automatically and an explicit retry uses freshly read identity`,async({page})=>{
  const newerIdentity='33333333-3333-4333-8333-333333333333';let calls=0,statusReads=0;
  await page.route('**/api/v1/me/google',async route=>{
    statusReads++;await route.fulfill({json:{enabled:true,linked:true,identity_id:calls===0?IDENTITY:newerIdentity}});
  });
  await page.route('**/api/v1/me/google/unlink',async route=>{
    calls++;expect(route.request().postDataJSON()).toEqual({password:'freedom-local-demo',identity_id:calls===1?IDENTITY:newerIdentity});
    if(calls===1&&outcome==='unknown')await route.abort('failed');
    else await route.fulfill({status:409,json:{code:'google_identity_changed',detail:'Google 連結已變更，請重新讀取目前連結。'}});
  });
  await loginAccount(page);const panel=page.locator('.google-account');
  await panel.getByLabel('目前工坊密碼').fill('freedom-local-demo');const readsBefore=statusReads;
  await panel.getByRole('button',{name:'解除 Google 連結',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('操作尚未確認');await expect(panel.getByLabel('目前工坊密碼')).toHaveValue('');
  await expect(panel.getByRole('status')).toHaveCount(0);await expect(panel.getByRole('button',{name:'連結 Google 帳號',exact:true})).toHaveCount(0);
  // Ordinary interactions do not replay either a rejected or an unknown write.
  await panel.getByRole('heading',{name:'Google 登入',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  expect(calls).toBe(1);expect(statusReads).toBe(readsBefore);
  // Reopen the account and read B. The next write requires a new explicit
  // password submission and targets B, never a replay of the old A command.
  await page.reload();await expect(panel.getByLabel('目前工坊密碼')).toBeVisible();expect(calls).toBe(1);expect(statusReads).toBeGreaterThan(readsBefore);
  await panel.getByLabel('目前工坊密碼').fill('freedom-local-demo');await panel.getByRole('button',{name:'解除 Google 連結',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('操作尚未確認');expect(calls).toBe(2);
});

test('successful unlink A reads fresh status and keeps a newer link B rather than marking it unlinked',async({page})=>{
  const newerIdentity='33333333-3333-4333-8333-333333333333';let calls=0,statusReads=0,refreshAfterUnlink=0;
  await page.route('**/api/v1/me/google',async route=>{
    statusReads++;if(calls>0)refreshAfterUnlink++;
    await route.fulfill({json:{enabled:true,linked:true,identity_id:calls===0?IDENTITY:newerIdentity}});
  });
  await page.route('**/api/v1/me/google/unlink',async route=>{
    calls++;expect(route.request().postDataJSON()).toEqual({password:'freedom-local-demo',identity_id:calls===1?IDENTITY:newerIdentity});
    if(calls===1)await route.fulfill({json:{unlinked:true}});
    else await route.fulfill({status:409,json:{code:'google_identity_changed',detail:'Google 連結已變更。'}});
  });
  await loginAccount(page);const panel=page.locator('.google-account');
  await expect(panel.getByText('已連結 Google。',{exact:false})).toBeVisible();
  await expect(panel.getByRole('button',{name:'解除 Google 連結',exact:true})).toBeEnabled();
  const readsBefore=statusReads;
  await panel.getByLabel('目前工坊密碼').fill('freedom-local-demo');await panel.getByRole('button',{name:'解除 Google 連結',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Google 連結已再次變更');await expect(panel.getByText('已連結 Google。',{exact:false})).toBeVisible();
  await expect(panel.getByRole('button',{name:'解除 Google 連結',exact:true})).toBeEnabled();await expect(panel.getByRole('button',{name:'連結 Google 帳號',exact:true})).toHaveCount(0);
  expect(calls).toBe(1);expect(statusReads).toBe(readsBefore+1);expect(refreshAfterUnlink).toBe(1);
  // B is only a fresh displayed status until the user explicitly authorizes
  // another password-confirmed unlink. The response from A cannot revoke B.
  await panel.getByLabel('目前工坊密碼').fill('freedom-local-demo');await panel.getByRole('button',{name:'解除 Google 連結',exact:true}).click();
  await expect(panel.getByRole('alert')).toContainText('操作尚未確認');expect(calls).toBe(2);expect(refreshAfterUnlink).toBe(1);
});

// The callback has already scrubbed its URL to /#account. Returning to that same
// fragment must still end this document; it must never replay a completed POST.
test('successful Google link reloads the scrubbed account entry and leaves callback UI',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  let linked=0,logins=0;
  await page.route('**/api/v1/me/google',route=>route.fulfill({json:{enabled:true,linked:linked>0,identity_id:linked>0?IDENTITY:null}}));
  await loginAccount(page);
  await page.evaluate(key=>sessionStorage.setItem(key,JSON.stringify({intent:'link',entry:'/#account',startedAt:Date.now()})),ENTRY_KEY);
  await page.route('**/api/v1/me/google/complete',async route=>{
    linked++;expect(route.request().headers()['x-csrf-token']).toBeTruthy();
    expect(route.request().postDataJSON()).toEqual({state:STATE,code:CODE});
    await route.fulfill({json:{linked:true}});
  });
  await page.route('**/api/v1/auth/google/complete',async route=>{logins++;await route.fulfill({status:409,json:{code:'unexpected_login'}})});
  await callback(page);
  await expect(page.getByRole('heading',{name:'登入與安全',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'連結 Google',exact:true})).toHaveCount(0);
  await expect(page.locator('.google-account')).toContainText('已連結 Google。');
  await expect(page).toHaveURL(/\/#account$/);
  expect(await page.evaluate(()=>(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type)).toBe('reload');
  expect(await page.evaluate(key=>sessionStorage.getItem(key),ENTRY_KEY)).toBeNull();
  expect(linked).toBe(1);expect(logins).toBe(0);
  await page.reload();await expect(page.getByRole('heading',{name:'登入與安全',exact:true})).toBeVisible();
  expect(linked).toBe(1);expect(logins).toBe(0);
});

for(const intent of ['login','link'] as const)for(const outcome of ['error','cancel'] as const)test(`Google ${intent} ${outcome} return ends the callback document without replay`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  if(intent==='link')await loginAccount(page);else await page.goto('/');
  await page.evaluate(({key,intent})=>sessionStorage.setItem(key,JSON.stringify({intent,entry:'/#account',startedAt:Date.now()})),{key:ENTRY_KEY,intent});
  let calls=0;
  const endpoint=intent==='link'?'/me/google':'/auth/google';
  await page.route(`**/api/v1${endpoint}/${outcome==='cancel'?'cancel':'complete'}`,async route=>{
    calls++;
    await route.fulfill(outcome==='cancel'?{json:{cancelled:true}}:{status:409,json:{code:'google_session_changed',detail:'Synthetic conflict'}});
  });
  await callback(page,outcome==='cancel'?`state=${STATE}&error=access_denied`:`state=${STATE}&code=${CODE}`);
  const result=page.getByRole('region',{name:intent==='link'?'連結 Google':'完成 Google 登入',exact:true});
  const back=result.getByRole('button',{name:intent==='link'?'返回我的名片':'返回登入入口',exact:true});
  await expect(back).toBeVisible();
  if(outcome==='cancel')await expect(result.getByRole('status')).toContainText('已取消這次 Google 授權');
  else await expect(result.getByRole('alert')).toContainText('未完成或已失效');
  await back.focus();await back.press('Enter');
  if(intent==='link')await expect(page.getByRole('heading',{name:'登入與安全',exact:true})).toBeVisible();
  else await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:intent==='link'?'連結 Google':'完成 Google 登入',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type)).toBe('reload');
  expect(await page.evaluate(key=>sessionStorage.getItem(key),ENTRY_KEY)).toBeNull();
  expect(new URL(page.url()).search).toBe('');expect(calls).toBe(1);
  await page.reload();expect(calls).toBe(1);
});
