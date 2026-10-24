import {randomUUID} from 'node:crypto';
import {test, expect, type Page} from './fixtures.js';
import {quickJoin} from './quick-join.js';
import {navigate, openHomeGuide} from './navigation.js';

async function login(page:Page) {
  await page.getByRole('button',{name:'會員登入',exact:true}).click();
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
}
const entries = [
  {button:'供貨商：展示商品、找合作', target:'supplier', label:'展示商品與供貨條件', heading:'我有東西要賣'},
  {button:'創作者：找案件與推廣合作', target:'showcase', label:'作品與合作案件', heading:'作品與需求'},
  {button:'開發者：找專案與夥伴', target:'tasks', label:'社群專案與任務', heading:'社群任務'},
];

for (const entry of entries) test(`${entry.target} entry survives registration and refresh, retains guild gate and opens the actual module`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:entry.button,exact:true}).click();
  await expect(page.getByRole('heading',{name:'加入自由工坊',exact:true})).toBeVisible();
  await expect(page.getByLabel('電子郵件',{exact:true})).toBeFocused();
  await expect(page.locator('.purpose-next-destination')).toHaveText(`加入後前往：${entry.label}。`);
  await page.getByLabel('電子郵件',{exact:true}).fill(`entry-${randomUUID()}@example.test`);
  await page.getByLabel('密碼',{exact:true}).fill('freedom-entry-e2e-password');
  await page.getByRole('button',{name:'建立帳號，先逛工坊',exact:true}).click();
  await expect(page.getByRole('region',{name:'快速加入公會'})).toBeVisible();
  await page.reload();
  await expect(page.locator('.welcome-hero')).toContainText(`完成加入後，直接前往「${entry.label}」。`);
  expect((await page.request.get('/api/v1/retail/catalog')).status()).toBe(403);
  await expect(page.getByRole('navigation',{name:'主要工作區'})).toHaveCount(0);
  await quickJoin(page);
  await expect(page).toHaveURL(new RegExp(`#${entry.target}$`));
  await expect(page.getByRole('heading',{name:entry.heading,exact:true,level:1})).toBeVisible();
});

test('existing members reach their chosen entry and all six collaboration destinations without selecting a permanent role',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:entries[0].button,exact:true}).click();await login(page);
  await expect(page).toHaveURL(/#supplier$/);
  const actions=[['展示我的商品','supplier','我有東西要賣'],['找合作夥伴','members','工坊夥伴'],['找合作案件','showcase','作品與需求'],['挑商品推廣','retail','我可以賣東西'],['找專案任務','tasks','社群任務'],['分享開發作品','showcase','作品與需求']];
  for(const [label,target,heading] of actions){
    await page.goto('/#home');
    await openHomeGuide(page);
    const entry=page.getByRole('navigation',{name:'商品、作品與活動',exact:true});
    await expect(entry).toBeVisible();
    await expect(entry.getByRole('heading')).toHaveText(['商品與供貨','作品與活動']);
    await expect(entry.getByRole('button')).toHaveCount(4);
    await expect(page.getByRole('button',{name:'建立貼文',exact:true})).toBeVisible();
    // The legacy intent remains reachable through its canonical global entry,
    // rather than duplicating six role-oriented buttons on the member home.
    await test.step(label, () => navigate(page, heading));
    await expect(page).toHaveURL(new RegExp(`#${target}$`));
    await expect(page.getByRole('heading',{name:heading,exact:true,level:1})).toBeVisible();
  }
});

test('public purpose is visible before the form on 320px in every theme, keeps original artwork and touch targets',async({page})=>{
  await page.setViewportSize({width:320,height:800});
  for(const theme of ['light','rpg','versefolk']){
    await page.goto('/');await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
    const entry=page.getByRole('region',{name:'商品、創作與開發合作入口'});
    await expect(entry).toBeVisible();
    for(const role of entries){const button=entry.getByRole('button',{name:role.button,exact:true});await expect(button).toBeVisible();expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);}
    expect((await entry.boundingBox())!.y).toBeLessThan((await page.locator('.login-form-area').boundingBox())!.y);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(page.locator('.login-story .brand-poster img')).toHaveAttribute('src','/brand/freedom-workshop.webp');
    await page.screenshot({path:`test-results/platform-purpose-${theme}-320.png`,fullPage:true});
  }
});

test('closed registration offers login and does not create an extra registration path',async({page})=>{
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),registration_enabled:false}});});
  await page.goto('/');await page.getByRole('button',{name:entries[2].button,exact:true}).click();
  await expect(page.getByRole('heading',{name:'登入',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'建立帳號',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('電子郵件',{exact:true})).toBeFocused();
});

for(const width of [320,390])test(`phone login error separates submit and recovery, keeps tools collapsed and fits all themes (${width}px)`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),password_recovery_enabled:true}});});
  for(const theme of ['light','rpg','versefolk']){
    await page.goto('/');await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
    const card=page.locator('.login-card');
    await expect(card.getByRole('button',{name:'提出想法',exact:true})).toHaveCount(0);
    await page.getByLabel('電子郵件',{exact:true}).fill('mobile-login-error@example.test');
    await page.getByLabel('密碼',{exact:true}).fill('invalid-mobile-password');
    const submit=card.getByRole('button',{name:'登入',exact:true}),recovery=card.getByRole('button',{name:'忘記密碼？',exact:true});
    await submit.click();await expect(card.getByRole('alert')).toBeVisible();
    const primary=(await submit.boundingBox())!,secondary=(await recovery.boundingBox())!;
    expect(secondary.y-primary.y-primary.height).toBeGreaterThanOrEqual(12);
    expect(primary.height).toBeGreaterThanOrEqual(44);expect(secondary.height).toBeGreaterThanOrEqual(44);
    expect(secondary.width).toBeLessThan(primary.width);
    expect(await card.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const label of ['電子郵件','密碼'])expect(await page.getByLabel(label,{exact:true}).evaluate(element=>parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    await card.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/mobile-login-error-${theme}-${width}.png`});
    await recovery.click();await expect(page.getByRole('heading',{name:'忘記密碼',exact:true})).toBeVisible();
    await card.getByRole('button',{name:'返回登入',exact:true}).click();await expect(page.getByRole('heading',{name:'登入',exact:true})).toBeVisible();
    const trigger=card.locator('.page-tools-menu > summary');await trigger.click();
    await card.getByRole('button',{name:'頁面說明',exact:true}).click();
    const help=page.getByRole('dialog');await expect(help).toBeVisible();await help.getByRole('button',{name:'關閉',exact:true}).click();
    await expect(trigger).toBeFocused();
  }
});

for(const viewport of [{width:390,height:844},{width:1280,height:800}])for(const theme of ['light','dark','versefolk']){
  test(`visitor first step stays above the artwork and form while the brand image loads (${viewport.width}px ${theme})`,async({page})=>{
    await page.setViewportSize(viewport);
    let releaseImage!:()=>void;
    const imageGate=new Promise<void>(resolve=>{releaseImage=resolve;});
    await page.route('**/brand/freedom-workshop.webp',async route=>{await imageGate;await route.continue();});
    try{
      await page.goto('/',{waitUntil:'domcontentloaded'});
      await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
      const first=page.locator('.visitor-first-step'),toggle=first.locator('.entry-resources > details > summary');
      await expect(first.getByRole('heading',{level:1})).toHaveText('讓你的商品、作品和技術，找到合作夥伴。');
      await expect(page.getByRole('heading',{level:1})).toHaveCount(1);
      await expect(toggle).toContainText('先看免費資源，不用註冊');
      const before=(await toggle.boundingBox())!,art=page.locator('.login-story .brand-poster img');
      expect(before.y).toBeGreaterThanOrEqual(0);expect(before.y+before.height).toBeLessThanOrEqual(viewport.height);
      expect(before.height).toBeGreaterThanOrEqual(44);
      expect(before.y+before.height).toBeLessThan((await art.boundingBox())!.y);
      expect(before.y+before.height).toBeLessThan((await page.locator('.login-form-area').boundingBox())!.y);
      expect(await art.evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBe(0);
      releaseImage();await expect.poll(()=>art.evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const after=(await toggle.boundingBox())!;
      expect(Math.abs(after.y-before.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.height-before.height)).toBeLessThanOrEqual(1);
      await expect(art).toHaveAttribute('src','/brand/freedom-workshop.webp');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`test-results/visitor-first-${theme}-${viewport.width}.png`,fullPage:true});
    }finally{releaseImage();}
  });
}

test('visitor preview is keyboard accessible, remains anonymous and returns focus to its book trigger',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const writes:string[]=[];page.on('request',request=>{if(request.method()!=='GET'&&request.url().includes('/api/v1/'))writes.push(request.url());});
  await page.goto('/');const before=page.url(),first=page.locator('.visitor-first-step');
  const toggle=first.locator('.entry-resources > details > summary');
  await toggle.focus();await page.keyboard.press('Enter');
  const preview=first.getByRole('button',{name:'免費預覽',exact:true}).first();
  await expect(preview).toBeVisible();await preview.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(preview).toBeFocused();
  await toggle.focus();await page.keyboard.press('Space');
  await expect(first.locator('.entry-resources > details')).not.toHaveAttribute('open','');
  await expect(toggle).toBeFocused();expect(page.url()).toBe(before);expect(writes).toEqual([]);
  expect((await page.request.get('/api/v1/session')).status()).toBe(401);
});

test('visitor account choices reuse the existing keyboard-operable form without losing its draft',async({page})=>{
  await page.goto('/');const originalUrl=page.url(),email=page.getByLabel('電子郵件',{exact:true});
  const switcher=page.getByRole('group',{name:'登入或建立帳號',exact:true});
  await email.fill('visitor-draft@example.test');
  await switcher.getByRole('button',{name:'建立帳號',exact:true}).focus();await page.keyboard.press('Space');
  await expect(page.getByRole('heading',{name:'加入自由工坊',exact:true})).toBeVisible();await expect(email).toHaveValue('visitor-draft@example.test');
  await page.keyboard.press('Tab');await expect(page.getByLabel('頁面工具',{exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(email).toBeFocused();
  await switcher.getByRole('button',{name:'會員登入',exact:true}).click();
  await expect(page.getByRole('heading',{name:'登入',exact:true})).toBeVisible();await expect(email).toHaveValue('visitor-draft@example.test');
  expect(page.url()).toBe(originalUrl);
});

test('dedicated skill returns keep the original reading exit and do not become a visitor landing page',async({page})=>{
  const path='/development/skills/social-post',account=`/?join=1&skill_acquisition=1&return_to=${encodeURIComponent(path)}&skill_intro=7`;
  await page.goto(account);await expect(page.locator('.visitor-first-step')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'加入自由工坊',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'返回技能書繼續閱讀',exact:true})).toHaveAttribute('href',path+'?intro=7#skill-use-title');
  expect(new URL(page.url()).search).toBe(new URL(account,'https://example.test').search);
});

test('the visitor first step uses all five existing interface languages at phone width',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  const languages=[
    ['zh-Hant','先看免費資源，不用註冊','會員登入','建立帳號'],
    ['en','Explore free resources without signing up','Sign in','Create account'],
    ['ja','登録せずに無料教材を見る','ログイン','アカウント作成'],
    ['ko','가입 없이 무료 자료 둘러보기','로그인','계정 만들기'],
    ['es','Explora recursos gratuitos sin registrarte','Iniciar sesión','Crear cuenta'],
  ];
  for(const [language,explore,login,register] of languages){
    await page.getByRole('combobox',{name:'Language',exact:true}).selectOption(language);
    const first=page.locator('.visitor-first-step'),toggle=first.locator('.entry-resources > details > summary');
    await expect(toggle).toContainText(explore);
    await expect(page.locator('.auth-switch').getByRole('button',{name:login,exact:true})).toBeVisible();
    await expect(page.locator('.auth-switch').getByRole('button',{name:register,exact:true})).toBeVisible();
    const box=(await toggle.boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});
