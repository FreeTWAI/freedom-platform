import {openPageTools} from './navigation.js';
import { navigate } from './navigation.js';
import {test,expect} from './fixtures.js';
import {submittedSkillHtml} from '../../apps/platform-api/src/routes/published-skills.js';

test('development tools follow the current page on desktop and phone without a duplicate footer',async({page})=>{
 await page.goto('/');
 await expect(page.locator('.development-context')).toHaveCount(0);
 await openPageTools(page); await page.locator('.login-card-heading').getByRole('button',{name:'參與編修'}).click();
 let guide=page.getByRole('dialog',{name:/參與編修/});
 await expect(guide.getByRole('link',{name:'給 Agent 的文字版 ↗'})).toHaveAttribute('href','/development/registration.md');
 await guide.getByRole('button',{name:'關閉'}).click();
 await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
 await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
 await page.getByRole('button',{name:'登入',exact:true}).click();
 await expect(page.getByRole('heading',{name:'會員首頁',level:1})).toBeVisible();
 await openPageTools(page); await page.locator('.topbar').getByRole('button',{name:'參與編修'}).click();
 guide=page.getByRole('dialog',{name:/參與編修/});
 await expect(guide.getByRole('link',{name:'給 Agent 的文字版 ↗'})).toHaveAttribute('href','/development/home.md');
 await guide.getByRole('button',{name:'關閉'}).click();
 await navigate(page, '職業公會');
 await page.setViewportSize({width:390,height:844});
 await openPageTools(page); await page.locator('.topbar').getByRole('button',{name:'參與編修'}).click();
 guide=page.getByRole('dialog',{name:/參與編修/});
 await expect(guide.getByRole('link',{name:'查看這一頁的開發指引 ↗'})).toHaveAttribute('href','/development/guilds');
 await expect(page.locator('.development-context')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a visitor without JavaScript can follow real repo links and read a complete skill guide',async({browser,baseURL})=>{
 const context=await browser.newContext({baseURL,javaScriptEnabled:false,viewport:{width:390,height:844}});
 try{
  const page=await context.newPage();await page.goto('/');
  await page.getByRole('link',{name:'公開開發導覽',exact:true}).click();
  await page.getByRole('link',{name:'我有東西要賣',exact:true}).click();
  await expect(page.getByRole('heading',{name:'要 Fork 哪一個 Repo？'})).toBeVisible();
  await expect(page.getByRole('link',{name:'https://github.com/FreeTWAI/freedom-supplier-client',exact:false}).first()).toBeVisible();
  await page.goto('/development/skills/security-scanner');
  await expect(page.locator('.public-skill-entry .public-skill-actions a').first()).toHaveAttribute('href','#skill-use-title');
  await expect(page.getByRole('link',{name:'前往作者網站 ↗',exact:true})).toHaveAttribute('href','https://teddashh.github.io/ai-security-scanner/');
  await expect(page.getByRole('link',{name:'閱讀收錄版本說明 ↗',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'開始使用',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'到 GitHub 看原始碼 ↗',exact:true})).toHaveAttribute('href','https://github.com/teddashh/ai-security-scanner');
  await expect(page.locator('.public-skill-destination').first()).toHaveText('目的地：github.com/teddashh/ai-security-scanner');
  await expect(page.getByRole('heading',{name:'一起開發',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'從原作開始共創 ↗',exact:true})).toHaveAttribute('href','https://github.com/teddashh/ai-security-scanner/fork');
  await expect(page.locator('.collaboration-repository')).toHaveText('預設 PR → teddashh/ai-security-scanner:main');
  await expect(page.getByRole('link',{name:'查看原作 PR ↗',exact:true})).toHaveAttribute('href','https://github.com/teddashh/ai-security-scanner/pulls');
  await expect(page.getByText('工坊整合與任務來源',{exact:true})).toBeVisible();
  await page.getByText('工坊整合與任務來源',{exact:true}).click();
  await expect(page.getByRole('link',{name:'查看工坊整合版本',exact:true})).toHaveAttribute('href','https://github.com/FreeTWAI/ai-security-scanner');
  await expect(page.getByRole('link',{name:'下載 Agent SKILL.md',exact:true}).first()).toBeVisible();
  await page.getByText('完整指南與來源',{exact:true}).click();
  await expect(page.getByRole('heading',{name:'第一個練習'})).toBeVisible();
  await expect(page.getByRole('link',{name:'https://github.com/FreeTWAI/ai-security-scanner/fork',exact:true}).first()).toBeVisible();
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   const dimensions=await page.locator('body').evaluate(element=>({scroll:element.scrollWidth,viewport:window.innerWidth}));
   expect(dimensions.scroll,`guide body overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
  }
  await page.screenshot({path:'test-results/development-guide-phone.png',fullPage:true});
 }finally{await context.close();}
});


test('public skill share previews and copies the chosen introduction with its persistent URL on a phone',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'share',{configurable:true,value:undefined});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as any).__sharedSkillUrl=value;}}});
 });
 await page.setViewportSize({width:390,height:844});
 await page.goto('/development/skills/video-autopilot');
 await expect(page.getByRole('heading',{name:'一起開發',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'建立可重現的剪輯測試素材',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'分享技能書',exact:true}).click();
 const preview=page.locator('[data-share-dialog]');
 await expect(preview).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__sharedSkillUrl)).toBeUndefined();
 const first=await preview.locator('[data-share-text]').innerText();
 await preview.getByRole('button',{name:'換一句',exact:true}).click();
 await expect(preview.locator('[data-share-text]')).not.toHaveText(first);
 const introduction=await preview.locator('[data-share-text]').innerText(),url=await preview.locator('[data-share-url]').innerText();
 expect(url).toMatch(/^https:\/\/freetwai\.com\/development\/skills\/video-autopilot\?intro=([1-9][0-9]?|100)$/);
 await preview.getByRole('button',{name:'複製介紹與連結',exact:true}).click();
 await expect(preview.getByRole('status')).toHaveText('已複製介紹與連結');
 expect(await page.evaluate(()=>(window as any).__sharedSkillUrl)).toBe(introduction+'\n'+url);
 expect(await preview.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await preview.getByRole('button',{name:'關閉分享預覽',exact:true}).click();
 await expect(page.getByRole('button',{name:'分享技能書',exact:true})).toBeFocused();
 await expect(page.getByRole('link',{name:'下載 Agent SKILL.md',exact:true}).first()).toHaveAttribute('href','/development/skills/video-autopilot/SKILL.md');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/skill-collaboration-share-phone.png',fullPage:true});
});


test('an anonymous community introduction shows plain usage, real destinations and persistent sharing on desktop and phone',async({page,baseURL})=>{
 // Renderer fixture only; real publication/consent/withdrawal is exercised by runtime/skill-submissions.
 const id='58bfdb02-3618-4dd8-aeb0-83a699af17dd',path='/development/submissions/'+id;
 const skill:Parameters<typeof submittedSkillHtml>[0]={submission_id:id,title:'合成示範：團隊筆記整理',description:'將會議筆記整理成待辦清單；此頁為隔離的測試內容。',use_notes:'先閱讀 README，準備一份不含私人資料的筆記。\n保留原始檔案。\n\n在自己的環境完成原作範例，再核對輸出。',demo_url:'https://example.com/notes-demo',repository_url:'https://github.com/example/notes',relationship:'curator',relationship_verification:'self_declared',official:false,project_id:'75cfd385-7910-45d2-b37f-58dc56ba723e',public_path:path,cover_url:'/art/community-skills/default.webp',illustration_url:null,share_introductions:['合成介紹：整理會議筆記。'],source:{repository_full_name:'example/notes',repository_url:'https://github.com/example/notes',commit_sha:'b'.repeat(40),license_spdx:'MIT',license_evidence_url:null,is_fork:false,archived:false},published_at:'2026-10-19T12:00:00Z'};
 await page.route('**'+path,route=>route.fulfill({contentType:'text/html',body:submittedSkillHtml(skill,undefined,new URL(baseURL!).origin)}));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as any).__copiedIntroduction=value;}}});});
 await page.goto(path);
 await expect(page.getByRole('heading',{name:skill.title,exact:true})).toBeVisible();
 await expect(page.locator('.public-skill-notes')).toHaveCount(2);
 await expect(page.getByRole('heading',{name:'開始使用',exact:true})).toBeVisible();
 await expect(page.getByText('整理推薦者（自行聲明，尚未核實作者身分）',{exact:true})).toBeVisible();
 const source=page.getByRole('link',{name:'到 GitHub 看原始碼 ↗',exact:true}),demo=page.getByRole('link',{name:'開啟專案線上示範 ↗',exact:true});
 await expect(source).toHaveAttribute('href',skill.repository_url);await expect(demo).toHaveAttribute('href',skill.demo_url!);
 await expect(source).toHaveAttribute('target','_blank');await expect(source).toHaveAttribute('rel','noopener noreferrer');
 await expect(page.locator('.public-skill-destination')).toHaveText(['目的地：github.com/example/notes','目的地：example.com/notes-demo']);
 await expect(page.getByRole('link',{name:/立即啟動|下載應用/})).toHaveCount(0);
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const link of [source,demo])expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`test-results/public-submitted-introduction-${width}.png`,fullPage:true});
 }
 await source.focus();await expect(source).toBeFocused();
 await page.getByRole('button',{name:'分享技能書',exact:true}).click();
 const dialog=page.locator('[data-share-dialog]');await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'複製介紹與連結',exact:true}).click();
 await expect(dialog.getByRole('status')).toHaveText('已複製介紹與連結');
 expect(await page.evaluate(()=>(window as any).__copiedIntroduction)).toBe(skill.share_introductions[0]+'\n'+new URL(baseURL!).origin+path+'?intro=1');
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'分享技能書',exact:true})).toBeFocused();
});
