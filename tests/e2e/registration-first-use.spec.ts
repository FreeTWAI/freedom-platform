import {randomUUID} from 'node:crypto';
import {test,expect,type Page} from './fixtures.js';

async function registration(page:Page){
  await page.goto('/');await page.getByRole('button',{name:'建立帳號',exact:true}).click();
  return page.locator('.login-card form');
}
async function createAccount(page:Page){
  const form=await registration(page);
  await form.getByLabel('電子郵件',{exact:true}).fill(`first-use-${randomUUID()}@example.test`);
  await form.getByLabel('密碼',{exact:true}).fill('synthetic-first-use-password');
  await form.getByRole('button',{name:'建立帳號，先逛工坊',exact:true}).click();
  await expect(page.locator('.welcome-preview')).toBeVisible();
}
function barrier(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

test('mobile signup keeps two required fields and offers accessible password visibility',async({page})=>{
  await page.setViewportSize({width:320,height:844});const form=await registration(page);
  const password=form.getByLabel('密碼',{exact:true}),email=form.getByLabel('電子郵件',{exact:true});
  await expect(form.locator('input[required]')).toHaveCount(2);
  await expect(form.getByLabel('社群顯示名稱',{exact:true})).not.toHaveAttribute('required','');
  await expect(email).toHaveAttribute('inputmode','email');await expect(email).toHaveAttribute('autocapitalize','none');
  await expect(password).toHaveAttribute('autocomplete','new-password');
  await expect(password).toHaveAttribute('minlength','12');await expect(password).toHaveAttribute('maxlength','128');
  await password.fill('short');await password.press('Tab');
  await expect(password).toHaveAttribute('aria-invalid','true');
  const hintId=await password.getAttribute('aria-describedby');expect(hintId).toBeTruthy();
  await expect(form.locator(`[id="${hintId}"]`)).toContainText('密碼至少 12 個字元');
  const show=form.getByRole('button',{name:'顯示密碼',exact:true});await show.press('Enter');
  await expect(password).toHaveAttribute('type','text');await expect(password).toHaveValue('short');
  await form.getByRole('button',{name:'隱藏密碼',exact:true}).click();await expect(password).toHaveAttribute('type','password');
  await password.fill('synthetic-first-use-password');await expect(password).not.toHaveAttribute('aria-invalid','true');
  await show.click();await page.getByRole('button',{name:'會員登入',exact:true}).click();
  await expect(password).toHaveAttribute('type','password');await expect(password).toHaveAttribute('autocomplete','current-password');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('submitting masks a revealed password and a failed response keeps editable input',async({page})=>{
  const held=barrier(),started=barrier();let writes=0;
  await page.route('**/api/v1/auth/register',async route=>{
    writes++;started.release();await held.promise;
    await route.fulfill({status:503,json:{code:'registration_unavailable',detail:'註冊暫時無法使用，請稍後重試。'}});
  });
  try{
    const form=await registration(page),password=form.getByLabel('密碼',{exact:true});
    await form.getByLabel('電子郵件',{exact:true}).fill(`held-${randomUUID()}@example.test`);
    await password.fill('synthetic-first-use-password');await form.getByRole('button',{name:'顯示密碼',exact:true}).click();
    await form.getByRole('button',{name:'建立帳號，先逛工坊',exact:true}).click();await started.promise;
    await expect(password).toHaveAttribute('type','password');await expect(password).toBeDisabled();
    await expect(form.getByRole('button',{name:'顯示密碼',exact:true})).toBeDisabled();
    held.release();await expect(password).toBeEnabled();await expect(password).toHaveValue('synthetic-first-use-password');
    await expect(page.locator('.login-card').getByRole('alert')).toBeVisible();expect(writes).toBe(1);
  }finally{held.release();}
});

test('newcomer sections arrive independently and reuse one guild-directory read',async({page})=>{
  const held=barrier();let directories=0,events=0,books=0,failEvents=true;
  await page.route(url=>url.pathname==='/api/v1/guilds/directory',route=>{directories++;return route.continue();});
  await page.route(url=>url.pathname==='/api/v1/community',route=>{books++;return route.continue();});
  await page.route(url=>url.pathname==='/api/v1/events',async route=>{
    if(route.request().method()!=='GET')return route.continue();
    events++;await held.promise;
    if(failEvents)return route.fulfill({status:503,json:{code:'temporarily_unavailable'}});
    return route.continue();
  });
  try{
    await createAccount(page);const preview=page.locator('.welcome-preview');
    const eventSection=preview.getByRole('region',{name:'近期活動',exact:true});
    await expect(preview.locator('.quick-guild-option').first()).toBeVisible();
    await expect(preview.getByRole('region',{name:'免費技能書',exact:true}).locator('article').first()).toBeVisible();
    await expect(eventSection.getByRole('status')).toBeVisible();expect(directories).toBe(1);
    const selected=preview.locator('.quick-guild-option input').first();await selected.check();
    const bookReads=books;held.release();await expect(eventSection.getByRole('alert')).toBeVisible();
    await expect(eventSection.getByText('目前沒有即將舉辦的活動。',{exact:true})).toHaveCount(0);
    failEvents=false;await eventSection.getByRole('button',{name:'重新載入 · 近期活動',exact:true}).click();
    await expect(eventSection.getByRole('alert')).toHaveCount(0);await expect(eventSection).toHaveAttribute('aria-busy','false');
    expect(events).toBe(2);expect(directories).toBe(1);expect(books).toBe(bookReads);await expect(selected).toBeChecked();
  }finally{held.release();}
});

test('a guild directory failure can retry without refetching confirmed resource sections',async({page})=>{
  let fail=true,directories=0,books=0;
  await page.route(url=>url.pathname==='/api/v1/guilds/directory',route=>{
    directories++;return fail?route.fulfill({status:503,json:{code:'temporarily_unavailable'}}):route.continue();
  });
  await page.route(url=>url.pathname==='/api/v1/community',route=>{books++;return route.continue();});
  await createAccount(page);const preview=page.locator('.welcome-preview'),quick=preview.getByRole('region',{name:'快速加入公會',exact:true});
  await expect(quick.getByRole('alert')).toBeVisible();
  await expect(preview.getByRole('region',{name:'免費技能書',exact:true}).locator('article').first()).toBeVisible();
  const before=books;fail=false;await quick.getByRole('button',{name:'重讀公會',exact:true}).click();
  await expect(quick.locator('.quick-guild-option').first()).toBeVisible();
  expect(directories).toBe(2);expect(books).toBe(before);
});
