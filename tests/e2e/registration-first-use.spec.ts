import {randomUUID} from 'node:crypto';
import {test,expect,type Page} from './fixtures.js';
import {answerGuildQuestions} from './quick-join.js';

async function registration(page:Page){
  await page.goto('/');await page.getByRole('button',{name:'免費加入',exact:true}).click();
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
  const held=barrier();let directories=0,events=0,tasks=0,books=0;
  await page.route(url=>url.pathname==='/api/v1/guilds/directory',async route=>{directories++;await held.promise;return route.continue();});
  await page.route(url=>url.pathname==='/api/v1/events',route=>{if(route.request().method()==='GET')events++;return route.continue();});
  await page.route(url=>url.pathname==='/api/v1/task-board/preview',route=>{if(route.request().method()==='GET')tasks++;return route.continue();});
  await page.route(url=>url.pathname==='/api/v1/community',route=>{if(route.request().method()==='GET')books++;return route.continue();});
  try{
    await createAccount(page);const preview=page.locator('.welcome-preview'),quick=preview.getByRole('region',{name:'快速加入公會',exact:true});
    await expect(quick.getByRole('status')).toHaveText('正在載入全部公會…');
    await expect(preview.locator('.welcome-optional summary')).toHaveText('想先探索其他參與方式？');
    await preview.locator('.welcome-optional summary').click();
    await expect(preview.getByRole('button',{name:'提交公開活動',exact:true})).toBeVisible();
    for(const title of ['近期活動','可參與的工作','免費技能書'])await expect(preview.getByRole('region',{name:title,exact:true})).toHaveCount(0);
    held.release();
    await expect(quick.locator('.quick-guild-option').first()).toBeVisible();
    const selected=quick.locator('.quick-guild-option input').first();await selected.check();
    await preview.getByRole('button',{name:'提交公開活動',exact:true}).click();
    await expect(preview.getByRole('heading',{name:'提交公開活動',exact:true})).toBeVisible();
    await preview.getByRole('button',{name:'返回',exact:true}).click();
    expect(directories).toBe(1);expect(events).toBe(0);expect(tasks).toBe(0);expect(books).toBe(0);await expect(selected).toBeChecked();
  }finally{held.release();}
});

test('a guild directory failure can retry without refetching confirmed resource sections',async({page})=>{
  let fail=true,directories=0,events=0,tasks=0,books=0;
  await page.route(url=>url.pathname==='/api/v1/guilds/directory',route=>{
    directories++;return fail?route.fulfill({status:503,json:{code:'temporarily_unavailable'}}):route.continue();
  });
  await page.route(url=>url.pathname==='/api/v1/events',route=>{if(route.request().method()==='GET')events++;return route.continue();});
  await page.route(url=>url.pathname==='/api/v1/task-board/preview',route=>{if(route.request().method()==='GET')tasks++;return route.continue();});
  await page.route(url=>url.pathname==='/api/v1/community',route=>{if(route.request().method()==='GET')books++;return route.continue();});
  await createAccount(page);const preview=page.locator('.welcome-preview'),quick=preview.getByRole('region',{name:'快速加入公會',exact:true});
  await expect(quick.getByRole('alert')).toBeVisible();
  for(const title of ['近期活動','可參與的工作','免費技能書'])await expect(preview.getByRole('region',{name:title,exact:true})).toHaveCount(0);
  await preview.locator('.welcome-optional summary').click();
  await expect(preview.getByRole('button',{name:'開始／繼續定位 →',exact:true})).toBeVisible();
  fail=false;await quick.getByRole('button',{name:'重讀公會',exact:true}).click();
  await expect(quick.locator('.quick-guild-option').first()).toBeVisible();
  expect(directories).toBe(2);expect(events).toBe(0);expect(tasks).toBe(0);expect(books).toBe(0);
});

async function chooseQuickGuild(page:Page){
  await createAccount(page);
  const quick=page.getByRole('region',{name:'快速加入公會',exact:true});
  await quick.locator('input[value="guild_ai_vibe"]').check();
  await quick.getByRole('button',{name:/下一步：回答 \d+ 個小問題/}).click();
  await answerGuildQuestions(quick);
  return quick;
}

for(const outcome of ['incomplete','failed','malformed'] as const){
  test(`quick-start recovery stays visible on the question step: ${outcome}`,async({page})=>{
    await page.setViewportSize({width:390,height:844});
    const quick=await chooseQuickGuild(page),held=barrier(),started=barrier();let writes=0,reads=0;
    const answers=await quick.locator('.guild-question input:checked').evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).value));
    await page.route('**/api/v1/me/onboarding/quick-start',route=>{
      writes++;return route.fulfill({status:503,json:{code:'temporarily_unavailable',detail:'暫時無法完成加入。'}});
    });
    await quick.getByRole('button',{name:'加入公會，開始參與',exact:true}).click();
    await expect(quick.getByRole('alert')).toBeVisible();
    // Install after initial onboarding has loaded; this isolates the recovery GET.
    await page.route('**/api/v1/me/onboarding',async route=>{
      reads++;started.release();await held.promise;
      return outcome==='failed'?route.fulfill({status:503,json:{code:'temporarily_unavailable'}})
        :route.fulfill({json:outcome==='malformed'?{completed:'unknown'}:{completed:false}});
    });
    try{
      const recover=quick.getByRole('button',{name:'重讀加入狀態',exact:true});
      await recover.evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
      await started.promise;
      await expect(quick.getByText('正在確認加入狀態…',{exact:true})).toBeVisible();
      await expect(recover).toBeDisabled();
      await expect(quick.getByRole('button',{name:'加入公會，開始參與',exact:true})).toBeDisabled();
      held.release();
      await expect(quick.getByText(outcome==='incomplete'
        ?'尚未完成加入，你的公會選擇與答案仍保留。請按「加入公會，開始參與」繼續。'
        :'暫時無法確認加入狀態，請再試一次。你的公會選擇與答案仍保留。',{exact:true})).toBeVisible();
      await expect(recover).toBeEnabled();
      expect(reads).toBe(1);expect(writes).toBe(1);
      expect(await quick.locator('.guild-question input:checked').evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).value))).toEqual(answers);
      await quick.getByRole('button',{name:'換一個公會',exact:true}).click();
      await expect(quick.locator('input[value="guild_ai_vibe"]')).toBeChecked();
      await expect(quick.getByRole('button',{name:'重讀公會',exact:true})).toHaveCount(0);
    }finally{held.release();}
  });
}

test('checking a committed join after a lost reply continues without a second write',async({page})=>{
  const quick=await chooseQuickGuild(page);let writes=0;
  await page.route('**/api/v1/me/onboarding/quick-start',async route=>{
    writes++;
    const response=await route.fetch();expect(response.ok()).toBe(true);
    // Commit to the isolated fixture, but lose the response seen by the browser.
    await route.fulfill({status:503,json:{code:'temporarily_unavailable',detail:'加入結果暫時無法確認。'}});
  });
  await quick.getByRole('button',{name:'加入公會，開始參與',exact:true}).click();
  await expect(quick.getByRole('alert')).toBeVisible();
  await quick.getByRole('button',{name:'重讀加入狀態',exact:true}).click();
  await expect(page.getByRole('heading',{name:'動態',level:1,exact:true})).toBeVisible();
  expect(writes).toBe(1);
});

// UX-V-04 removed the welcome screen's task preview this used to check; the guild directory is the welcome screen's remaining list.
for(const malformed of ['null-row','non-text-title'] as const){
  test(`malformed guild directory is a local retryable error: ${malformed}`,async({page})=>{
    await page.setViewportSize({width:390,height:844});
    const paths=['/api/v1/events','/api/v1/task-board/preview','/api/v1/community','/api/v1/guilds/directory'];
    const reads=new Map<string,number>(),pageErrors:string[]=[];let invalid=true;
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.route(url=>paths.includes(url.pathname),async route=>{
      if(route.request().method()!=='GET')return route.continue();
      const path=new URL(route.request().url()).pathname;
      reads.set(path,(reads.get(path)??0)+1);
      if(path==='/api/v1/guilds/directory'&&invalid){
        const response=await route.fetch();
        const body=await response.json() as {items:Record<string,unknown>[]};
        const first=malformed==='null-row'?null:{...body.items[0],name:{unexpected:'object'}};
        return route.fulfill({response,status:200,json:{...body,items:[first,...body.items.slice(1)]}});
      }
      return route.continue();
    });
    await createAccount(page);
    const preview=page.locator('.welcome-preview'),quick=preview.getByRole('region',{name:'快速加入公會',exact:true});
    await expect(quick.getByRole('alert')).toBeVisible();
    await expect(quick.locator('.quick-guild-option')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    const before=new Map(reads);
    invalid=false;
    await quick.getByRole('button',{name:'重讀公會',exact:true}).click();
    await expect(quick.getByRole('alert')).toHaveCount(0);
    await expect(quick.locator('.quick-guild-option').first()).toBeVisible();
    expect(reads.get('/api/v1/guilds/directory')??0,'read budget: /api/v1/guilds/directory').toBe((before.get('/api/v1/guilds/directory')??0)+1);
    for(const path of ['/api/v1/events','/api/v1/task-board/preview','/api/v1/community'])expect(reads.get(path)??0,`read budget: ${path}`).toBe(0);
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}

for(const malformed of ['null-row','non-text-title'] as const){
  test(`malformed skill_books is a local retryable error: ${malformed}`,async({page})=>{
    await page.setViewportSize({width:390,height:844});
    const paths=['/api/v1/community/preview','/api/v1/public/events'];
    const reads=new Map<string,number>(),pageErrors:string[]=[];let invalid=true;
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.route(url=>paths.includes(url.pathname),route=>{
      if(route.request().method()!=='GET')return route.continue();
      const path=new URL(route.request().url()).pathname;
      reads.set(path,(reads.get(path)??0)+1);
      if(path==='/api/v1/community/preview'&&invalid)return route.fulfill({json:{skill_books:[
        malformed==='null-row'?null:{id:'synthetic-book',title:{unexpected:'object'},description:'測試說明',repository_url:'https://github.com/example/fixture'},
      ]}});
      return route.continue();
    });
    const form=await registration(page);
    await form.getByLabel('電子郵件',{exact:true}).fill('entry-resources@example.test');
    await page.locator('details.login-more > summary').click();
    const resources=page.locator('.entry-resources');
    await resources.locator('details > summary').click();
    await expect(resources.getByRole('alert')).toHaveText('資源暫時無法載入。');
    await expect(resources.getByText('目前沒有可預覽的技能書。',{exact:true})).toHaveCount(0);
    await expect(resources.locator('.entry-resource-list')).toHaveAttribute('aria-busy','false');
    await expect(form.getByLabel('電子郵件',{exact:true})).toHaveValue('entry-resources@example.test');
    const before=new Map(reads);
    invalid=false;
    await resources.getByRole('button',{name:'重新讀取資源',exact:true}).click();
    await expect(resources.locator('.entry-resource-list')).toHaveAttribute('aria-busy','false');
    await expect(resources.getByRole('alert')).toHaveCount(0);
    await expect(resources.locator('.entry-resource-list article').first()).toBeVisible();
    for(const path of paths)expect(reads.get(path)??0,`read budget: ${path}`).toBe((before.get(path)??0)+(path==='/api/v1/community/preview'?1:0));
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
