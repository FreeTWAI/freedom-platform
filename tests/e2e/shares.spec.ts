import {test,expect} from './fixtures.js';
import {openFeatureSearch} from './navigation.js';
import {DEMO_PASSWORD,DEMO_USERS} from '../../packages/testing/seed.js';
test('one share box publishes recorded original README, star action and member contribution at mobile width',async({page,context})=>{
 await page.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.setViewportSize({width:390,height:844});
 await page.goto('/#home');
 await page.getByLabel('電子郵件',{exact:true}).fill(DEMO_USERS[0].email);
 await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
 await page.getByRole('button',{name:'登入',exact:true}).click();
 await page.route('**/api/v1/shares/*',async route=>{
  if(route.request().method()!=='GET')return route.continue();
  const response=await route.fetch(),data=await response.json();
  if(data.repository)Object.assign(data.repository,{license_spdx:'MIT',homepage:'https://example.org/project',pushed_at:'2026-01-02T03:04:05Z',forks_count:0,open_issues_count:12,subscribers_count:5,topics:['one','two','three','four','five','six']});
  await route.fulfill({response,json:data});
 });
 await page.getByRole('button',{name:'分享或提交',exact:true}).click();
 const box=page.getByRole('dialog',{name:'分享',exact:true});await expect(box).toBeVisible();
 await box.getByLabel('貼上連結',{exact:true}).fill('https://github.com/freetwai-test/shared-repo');
 await expect(box.getByText('freetwai-test/shared-repo',{exact:true})).toBeVisible();
 await box.getByRole('button',{name:'發布',exact:true}).click();
 await expect(page).toHaveURL(/#home$/);
 const item=page.locator('.home-timeline > article').first();
 await expect(item).toBeFocused();
 await expect(item).toContainText('freetwai-test/shared-repo');
 await expect(item).toContainText('開源專案');
 await item.getByRole('link',{name:'看分享頁',exact:true}).click();
 await expect(page).toHaveURL(/#shares\/[0-9a-f-]+$/);
 await expect(page.getByRole('heading',{name:'README',exact:true})).toBeVisible();
 const facts=page.locator('.share-page .share-facts');await expect(facts).toContainText('MIT');await expect(facts).toContainText('Fork：0');await expect(facts).toContainText('Issues：12');await expect(facts).toContainText('Watchers：5');
 expect(await page.locator('.share-page').evaluate(element=>{
  const action=element.querySelector('.share-actions'),description=element.querySelector('.share-description');
  return Boolean(action&&description&&(action.compareDocumentPosition(description)&Node.DOCUMENT_POSITION_FOLLOWING));
 })).toBe(true);
 await expect(facts.getByRole('link',{name:'網站'})).toHaveAttribute('href','https://example.org/project');
 await expect(page.locator('.share-page .share-topics .pill')).toHaveText(['one','two','three','four','five']);
 await expect(page.getByText('這是原作 README 的合成錄製內容。')).toBeVisible();
 await expect(page.getByRole('link',{name:'在 GitHub 查看',exact:true})).toHaveAttribute('href','https://github.com/freetwai-test/shared-repo');
 await expect(page.locator('.share-readme script,.share-readme svg,.share-readme [onerror],.share-readme iframe')).toHaveCount(0);
 expect(await page.evaluate(()=>Boolean((window as unknown as {shareXss?:boolean}).shareXss))).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await expect(page.locator('.nav-primary [aria-current]')).toHaveText('探索');
 const shareHash=new URL(page.url()).hash;
 await page.evaluate(hash=>{window.location.hash=hash+'?via=fixture%2Bcode';},shareHash);
 await page.reload();await expect(page).toHaveURL(/#shares\/[0-9a-f-]+\?via=fixture%2Bcode$/);
 await expect(page.getByRole('heading',{name:'README',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'我也要分享',exact:true}).click();
 const shareDialog=page.locator('.skill-share-dialog');
 await expect(shareDialog.locator('.skill-share-url')).toHaveText(/\/go\/[A-Za-z0-9_-]{10}$/);
 await shareDialog.getByRole('button',{name:'複製連結',exact:true}).click();
 await expect(shareDialog.getByRole('status')).toHaveText('已複製。');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toMatch(/\/go\/[A-Za-z0-9_-]{10}/);
 await shareDialog.getByRole('button',{name:'關閉分享',exact:true}).click();
 await openFeatureSearch(page);
 await page.getByRole('navigation',{name:'主要工作區'}).getByRole('button',{name:'我的',exact:true}).click();
 await page.getByLabel('我的檢視').selectOption({label:'我的貢獻'});
 await expect(page).toHaveURL(/#me\/credit$/);
 await expect(page.getByLabel('我的檢視').locator('option').filter({hasText:'分享成效'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'交給我的 Agent',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'我的貢獻'}).getByRole('link',{name:'freetwai-test/shared-repo'})).toBeVisible();
 // Scope to this repository's card: other specs on the same server may have given this member other shares.
 await expect(page.getByRole('region',{name:'我的貢獻'}).getByRole('article').filter({has:page.getByRole('link',{name:'freetwai-test/shared-repo',exact:true})}).getByText('還沒有人點開',{exact:true})).toBeVisible();
 await page.locator('.legacy-promotion > summary').click();
 await expect(page.getByRole('region',{name:'我的推廣連結'})).toHaveCount(0);
 await expect(page.getByText('查看推廣排行榜',{exact:true})).toBeVisible();
});

async function signInHome(page:import('@playwright/test').Page){
 await page.goto('/#home');
 await page.getByLabel('電子郵件',{exact:true}).fill(DEMO_USERS[0].email);
 await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);
 await page.getByRole('button',{name:'登入',exact:true}).click();
 await expect(page.locator('.shell')).toBeVisible();
}
async function openBox(page:import('@playwright/test').Page){
 await page.getByRole('button',{name:'分享或提交',exact:true}).click();
 return page.getByRole('dialog',{name:'分享',exact:true});
}
const previewProblem={type:'about:blank',title:'Unprocessable Entity',status:422,detail:'無法讀取這個公開網址。',code:'share_fetch_rejected'};
const githubProblem={type:'about:blank',title:'Service Unavailable',status:503,detail:'GitHub 暫時無法回覆。',code:'github_unavailable'};

test('an unreadable link can be titled and appears focused at the top of home',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/v1/shares/preview',route=>route.fulfill({status:422,contentType:'application/problem+json',json:previewProblem}));
 await signInHome(page);
 const box=await openBox(page);
 await box.getByLabel('貼上連結',{exact:true}).fill('https://example.com/unreadable');
 await expect(box.getByLabel('分享標題',{exact:true})).toBeVisible();
 await box.getByLabel('分享標題',{exact:true}).fill('手動分享標題');
 const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/shares'&&response.request().method()==='POST');
 await box.getByRole('button',{name:'發布',exact:true}).click();
 expect((await created).status()).toBe(200);
 await expect(page).toHaveURL(/#home$/);
 const item=page.locator('.home-timeline > article').first();
 await expect(item).toBeFocused();
 await expect(item).toContainText('手動分享標題');
 await expect(item).toContainText('網址');
 const link=item.getByRole('link',{name:'看分享頁',exact:true});
 await expect(link).toHaveAttribute('href',/#shares\/[0-9a-f-]+$/);
 await link.click();
 await expect(page.getByRole('heading',{name:'手動分享標題',exact:true})).toBeVisible();
 await expect(page.locator('.share-page').getByText('example.com',{exact:true})).toBeVisible();
});

test('work and service links preserve the draft and the event chip keeps dialog focus',async({page})=>{
 await signInHome(page);
 let box=await openBox(page);
 await box.getByLabel('貼上連結',{exact:true}).fill('尚未完成的分享');
 await box.getByRole('button',{name:'更多',exact:true}).click();
 await box.getByRole('link',{name:'作品',exact:true}).click();
 await expect(page).toHaveURL(/#explore\/works$/);
 await page.goBack();await expect(page).toHaveURL(/#home$/);
 box=await openBox(page);await expect(box.getByLabel('貼上連結',{exact:true})).toHaveValue('尚未完成的分享');
 await box.getByRole('button',{name:'更多',exact:true}).click();
 await box.getByRole('link',{name:'服務',exact:true}).click();
 await expect(page).toHaveURL(/#explore\/services$/);
 await page.goBack();await expect(page).toHaveURL(/#home$/);
 box=await openBox(page);await expect(box.getByLabel('貼上連結',{exact:true})).toHaveValue('尚未完成的分享');
 await box.getByRole('button',{name:'活動',exact:true}).click();
 await expect(box.getByRole('button',{name:'活動',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(box.getByLabel('活動連結（選填）',{exact:true})).toBeFocused();
 await box.getByRole('button',{name:'網址',exact:true}).click();
 await expect(box.getByLabel('貼上連結',{exact:true})).toHaveValue('尚未完成的分享');
});

test('an unknown share offers a way back to home',async({page})=>{
 await signInHome(page);
 await page.evaluate(()=>{window.location.hash='#shares/00000000-0000-4000-8000-000000009999';});
 await expect(page.getByText('找不到分享',{exact:true})).toBeVisible();
 const back=page.getByRole('link',{name:'回到動態',exact:true});
 await expect(back).toHaveClass(/btn-primary/);await back.click();await expect(page).toHaveURL(/#home$/);
});

test('GitHub preview and publish failures keep the repository draft and allow retry',async({page,e2eAuthPool})=>{
 let previews=0,publishes=0;
 await page.route('**/api/v1/shares/preview',route=>{
  previews++;return previews===1?route.fulfill({status:503,contentType:'application/problem+json',json:githubProblem}):route.continue();
 });
 await page.route('**/api/v1/shares',route=>{
  if(route.request().method()!=='POST')return route.continue();
  publishes++;return publishes===1?route.fulfill({status:503,contentType:'application/problem+json',json:githubProblem}):route.continue();
 });
 await signInHome(page);
 const box=await openBox(page),url='https://github.com/freetwai-test/shared-repo';
 // An earlier case may already have shared this URL; the failed publish must add nothing.
 const shareRows=async()=>(await e2eAuthPool.query("SELECT count(*)::int AS n FROM shares WHERE canonical_url=$1",[url])).rows[0].n as number;
 const before=await shareRows();
 await box.getByLabel('貼上連結',{exact:true}).fill(url);
 await expect(box.getByText('GitHub 暫時無法確認，請再試一次。',{exact:true})).toBeVisible();
 await expect(box.getByLabel('分享標題',{exact:true})).toHaveCount(0);
 await expect(box.getByRole('button',{name:'發布',exact:true})).toBeDisabled();
 await box.getByRole('button',{name:'再試一次',exact:true}).click();
 await expect(box.getByText('freetwai-test/shared-repo',{exact:true})).toBeVisible();
 await box.getByRole('button',{name:'發布',exact:true}).click();
 await expect(box.getByText('GitHub 暫時無法確認，請再試一次。',{exact:true})).toBeVisible();
 await expect(box.getByLabel('貼上連結',{exact:true})).toHaveValue(url);
 expect(await shareRows()).toBe(before);
 await box.getByRole('button',{name:'再試一次',exact:true}).click();
 await expect(page).toHaveURL(/#home$/);
 await expect(page.locator('.home-timeline > article').first()).toBeFocused();
 expect(previews).toBe(2);expect(publishes).toBe(2);
});

test('repository stars use the platform only when GitHub is available to this member',async({page})=>{
 let configured=false,connected=false,starDenied=true;
 await page.route('**/api/v1/me/github',route=>route.fulfill({json:{configured,connected,github_user:connected?{id:'123',login:'fixture'}:null}}));
 await page.route('**/api/v1/me/github/connect',route=>route.fulfill({status:409,contentType:'application/problem+json',json:{type:'about:blank',title:'Conflict',status:409,code:'github_connect_required',detail:'測試連結'}}));
 await page.route('**/api/v1/shares/*/star',route=>starDenied?route.fulfill({status:403,contentType:'application/problem+json',json:{type:'about:blank',title:'Forbidden',status:403,code:'github_permission_required',detail:'無法使用此權限。'}}):route.fulfill({json:{starred:true,confirmed:true}}));
 await signInHome(page);
 const box=await openBox(page);
 await box.getByLabel('貼上連結',{exact:true}).fill('https://github.com/freetwai-test/shared-repo');
 await expect(box.getByText('freetwai-test/shared-repo',{exact:true})).toBeVisible();
 await box.getByRole('button',{name:'發布',exact:true}).click();
 const item=page.locator('.home-timeline > article').first();
 await expect(item).toContainText('freetwai-test/shared-repo');
 await item.getByRole('link',{name:'看分享頁',exact:true}).click();
 const external=page.getByRole('link',{name:'在 GitHub 查看',exact:true});
 await expect(external).toHaveAttribute('href','https://github.com/freetwai-test/shared-repo');
 await expect(external).toHaveAttribute('target','_blank');
 await expect(page.getByRole('button',{name:/加星/})).toHaveCount(0);
 configured=true;await page.reload();
 const connect=page.getByRole('button',{name:'連結 GitHub 加星',exact:true});await expect(connect).toBeVisible();
 const connectRequest=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/v1/me/github/connect'&&request.method()==='POST');
 await connect.click();expect((await connectRequest).postDataJSON().return_to).toMatch(/^#shares\//);
 connected=true;await page.reload();
 await page.getByRole('button',{name:'☆ 加星',exact:true}).click();
 await expect(page.getByRole('link',{name:'在 GitHub 查看',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/加星/})).toHaveCount(0);
 starDenied=false;await page.reload();
 await page.getByRole('button',{name:'☆ 加星',exact:true}).click();
 await expect(page.getByRole('button',{name:'★ 已加星',exact:true})).toBeVisible();
});

test('title-only share succeeds from preview 422 and renders title and host on share page',async({page})=>{
 await page.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/v1/shares/preview',route=>route.fulfill({status:422,contentType:'application/problem+json',json:previewProblem}));
 await signInHome(page);
 await page.goto('/#explore');
 await expect(page).toHaveURL(/#explore$/);
 const box=await openBox(page);
 const url=`https://example.com/unreadable-${Date.now()}`;
 await box.getByLabel('貼上連結',{exact:true}).fill(url);
 await expect(box.getByRole('alert')).toHaveText('無法讀取預覽，填入標題即可分享。');
 await expect(box.getByLabel('貼上連結',{exact:true})).toHaveValue(url);
 const titleInput=box.getByLabel('分享標題',{exact:true});
 await expect(titleInput).toBeVisible();
 const publishBtn=box.getByRole('button',{name:'發布',exact:true});
 await expect(publishBtn).toBeDisabled();
 await titleInput.fill('純標題手動分享');
 await expect(publishBtn).toBeEnabled();
 const createdPromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/shares'&&response.request().method()==='POST');
 await publishBtn.click();
 const createdResponse=await createdPromise;
 expect(createdResponse.status()).toBe(200);
 const created=await createdResponse.json() as {share_id:string};
 await expect(page).toHaveURL(new RegExp(`#shares/${created.share_id}$`));
 await expect(page.locator('.share-page').getByRole('heading',{name:'純標題手動分享',exact:true})).toBeVisible();
 await page.goto(`/s/${created.share_id}`);
 await expect(page.getByRole('heading',{name:'純標題手動分享',exact:true})).toBeVisible();
 await expect(page.getByText('example.com',{exact:true})).toBeVisible();
});
