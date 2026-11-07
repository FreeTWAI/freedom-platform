import {test,expect,type Page} from './fixtures.js';

const path='/development/skills/social-post';
const original='https://github.com/Hao0321/claude-skill-social-post';
const social=(page:Page)=>page.locator('[data-skill-social="social-post"]');
const widgetChunk=(url:string)=>/\/assets\/skill-social-widget-[^/]+\.js$/.test(new URL(url).pathname);
async function entryReady(page:Page){
  // Importing the same module awaits its existing evaluation; it does not run it twice.
  await page.evaluate(async href=>{await import(href);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));},'/assets/skill-social.js');
}
const metrics={book_id:'social-post',repository_url:original,stargazers_count:127,forks_count:18,open_issues_count:4,subscribers_count:6,pushed_at:'2026-09-20T10:00:00Z',language:'TypeScript',archived:false,checked_at:'2026-09-23T10:00:00Z',stale:false,error:null};
for(const width of [390,1280])test(`public skill reading defers the GitHub bundle until its section approaches (${width}px)`,async({page})=>{
  await page.setViewportSize({width,height:844});const chunks:string[]=[],writes:string[]=[];
  page.on('request',request=>{if(widgetChunk(request.url()))chunks.push(request.url());if(request.method()==='POST')writes.push(request.url());});
  await page.route('**/api/v1/github/books/social-post/metrics',route=>route.fulfill({json:metrics}));
  await page.goto(path);await entryReady(page);
  await expect(page.getByRole('heading',{name:'Hao 社群貼文技能書',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'免費加入，探索更多資源',exact:true})).toHaveAttribute('href',/skill_acquisition=1/);
  await expect(social(page)).toBeHidden();
  expect(chunks).toEqual([]);
  await expect(social(page).locator('[data-github-book]')).toHaveCount(0);
  const fallback=social(page).getByRole('link',{name:'Fork 專案 ↗',exact:true,includeHidden:true});await expect(fallback).toHaveAttribute('href',original+'/fork');
  await page.getByText('作者、版本與參與開發',{exact:true}).click();
  await social(page).scrollIntoViewIfNeeded();await expect(social(page).locator('[data-github-book="social-post"]')).toBeVisible();
  expect(chunks).toHaveLength(1);await expect(social(page).getByRole('link',{name:'到 GitHub Star ↗',exact:true})).toHaveAttribute('href',original);
  await expect(social(page).getByRole('link',{name:'追蹤專案（Watch）↗',exact:true})).toHaveAttribute('href',original);
  await page.evaluate(()=>scrollTo(0,0));await social(page).scrollIntoViewIfNeeded();expect(chunks).toHaveLength(1);expect(writes).toEqual([]);
});

test('a failed deferred chunk preserves reading, signup and native GitHub links',async({page})=>{
  let attempts=0;await page.route(url=>widgetChunk(url.href),route=>{attempts++;return route.abort();});await page.goto(path);await entryReady(page);
  await page.getByText('作者、版本與參與開發',{exact:true}).click();
  await social(page).scrollIntoViewIfNeeded();await expect.poll(()=>attempts).toBe(1);
  await expect(social(page).getByRole('link',{name:'Fork 專案 ↗',exact:true})).toHaveAttribute('href',original+'/fork');
  await expect(social(page).getByRole('link',{name:'追蹤專案（Watch）↗',exact:true})).toHaveAttribute('href',original);
  await expect(social(page).locator('[data-github-book]')).toHaveCount(0);
  await page.getByRole('link',{name:'免費加入，探索更多資源',exact:true}).click();
  await expect(page.getByRole('heading',{name:'加入自由工坊',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'返回技能書繼續閱讀',exact:true})).toHaveAttribute('href',path+'#skill-use-title');
});

test('a member still explicitly Stars and unstars after the public widget loads',async({page})=>{
  let starred=false;const writes:{starred:boolean;confirmed:boolean}[]=[];
  await page.route('**/api/v1/me/github',route=>route.fulfill({json:{configured:true,connected:true,github_user:{id:'synthetic-reader',login:'synthetic-reader'}}}));
  await page.route('**/api/v1/github/books/social-post/metrics',route=>route.fulfill({json:metrics}));
  await page.route('**/api/v1/me/github/books/social-post/star',route=>{
    if(route.request().method()==='POST'){
      const body=route.request().postDataJSON();writes.push(body);starred=body.starred;
      expect(route.request().headers()['x-csrf-token']).toBeTruthy();expect(route.request().headers()['idempotency-key']).toBeTruthy();
    }
    return route.fulfill({json:{book_id:'social-post',connected:true,starred,confirmed:true}});
  });
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('button',{name:'設定',exact:true})).toBeVisible();
  await page.goto(path);await entryReady(page);expect(writes).toEqual([]);
  await page.getByText('作者、版本與參與開發',{exact:true}).click();
  await social(page).scrollIntoViewIfNeeded();const star=social(page).getByRole('button',{name:'Star',exact:true});await expect(star).toBeEnabled();expect(writes).toEqual([]);
  await star.click();const unstar=social(page).getByRole('button',{name:'取消 Star',exact:true});await expect(unstar).toHaveAttribute('aria-pressed','true');
  await unstar.click();await expect(star).toHaveAttribute('aria-pressed','false');
  expect(writes).toEqual([{starred:true,confirmed:true},{starred:false,confirmed:true}]);await expect(social(page).locator('.github-star-count')).toHaveText('127');
});

test('loading a widget does not remove a focused public link while the reader tabs through it',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(url=>widgetChunk(url.href),async route=>{await gate;await route.continue();});
  try{
    await page.goto(path);await entryReady(page);
    const requested=page.waitForRequest(request=>widgetChunk(request.url()));await page.getByText('作者、版本與參與開發',{exact:true}).click();await social(page).scrollIntoViewIfNeeded();await requested;
    const fallback=social(page).getByRole('link',{name:'到 GitHub Star ↗',exact:true});await fallback.focus();
    const chunk=page.waitForResponse(response=>widgetChunk(response.url()));release();await (await chunk).finished();
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await expect(fallback).toBeFocused();await expect(social(page).locator('[data-github-book]')).toHaveCount(0);
    await page.keyboard.press('Tab');await expect(social(page).getByRole('link',{name:'Fork 專案 ↗',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');await expect(social(page).getByRole('link',{name:'追蹤專案（Watch）↗',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');await expect(social(page).getByRole('link',{name:'Follow 原作者 ↗',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');await expect(social(page).locator('[data-github-book="social-post"]')).toBeVisible();
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
