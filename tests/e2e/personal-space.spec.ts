import {test,expect,type Page} from './fixtures.js';
import {openSettingsPanel,closeSettingsMenu} from './settings-menu-helpers.js';
import {e2eSchema} from '../../packages/testing/e2e-auth-isolation.js';
const owner='20000000-0000-4000-8000-000000000001';
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const inventory=(n:number)=>({kind:'social_post',id:id(n),title:`我的創作 ${n}`,status:'active',version:null,path:`/?social-post=${id(n)}#social`,visibility:'community',actions:['view','withdraw']});
const preview=(n:number)=>({post_id:id(n),title:`我的創作 ${n}`,note:`本人貼文正文 ${n}\n這一段保留原本的換行。`,created_at:'2026-10-24T08:00:00Z',thumbnail_url:null,mine:true,author:{user_id:owner}});
async function login(page:Page,email='maker@local.test'){
 await page.goto('/#profile');await page.getByLabel('電子郵件',{exact:true}).fill(email);await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.settings-menu-button')).toBeVisible();
 if(!page.url().endsWith('#profile'))await page.goto('/#profile');
 await expect(page.getByRole('heading',{level:1})).toHaveText('我的個人空間');
}
async function synthetic(page:Page,count=8){
 const reads:string[]=[];
 await page.route('**/api/v1/me/content',route=>route.fulfill({json:{items:Array.from({length:count},(_,n)=>inventory(n+1))}}));
 await page.route('**/api/v1/social-posts?post_id=*',route=>{const value=new URL(route.request().url()).searchParams.get('post_id')!;reads.push(value);return route.fulfill({json:{items:[preview(Number(value.slice(-2)))]}});});
 return reads;
}

test('PERSONAL-SPACE-UI-01: compact owner hero, genuine post body, bounded page requests and exact source links',async({page})=>{
 await page.setViewportSize({width:390,height:844});const reads=await synthetic(page);await login(page);
 await expect(page.locator('.personal-space-entry')).toHaveCount(6);await expect(page.getByText('本人貼文正文 1',{exact:false})).toBeVisible();
 expect(reads).toHaveLength(6);expect(new Set(reads).size).toBe(6);
 await expect(page.locator('.personal-space-entry').first().getByRole('link',{name:'開啟貼文與留言'})).toHaveAttribute('href',`/?social-post=${id(1)}#social`);
 const hero=(await page.locator('.personal-space-hero').boundingBox())!,first=(await page.locator('.personal-space-entry').first().boundingBox())!;
 expect(hero.height).toBeLessThan(260);expect(first.y).toBeLessThan(844);
 await page.getByRole('button',{name:'下一頁',exact:true}).click();await expect(page.locator('.personal-space-entry')).toHaveCount(2);await expect(page.getByText('本人貼文正文 7',{exact:false})).toBeVisible();expect(reads).toHaveLength(8);
 await page.getByRole('button',{name:'作品',exact:true}).click();await expect(page.getByRole('heading',{name:'這裡還沒有作品'})).toBeVisible();expect(reads).toHaveLength(8);
 await page.getByRole('button',{name:'貼文',exact:true}).click();await expect(page.getByText('本人貼文正文 1',{exact:false})).toBeVisible();expect(reads).toHaveLength(14);
 await page.screenshot({path:'test-results/personal-space-owner-390.png',fullPage:true});
});

test('PERSONAL-SPACE-UI-02: one failed or unavailable post stays local and hidden/deleted entries never fetch or link',async({page})=>{
 const reads=await synthetic(page,6);
 await page.route('**/api/v1/me/content',route=>route.fulfill({json:{items:[inventory(1),inventory(2),inventory(3),{...inventory(4),status:'hidden',actions:['withdraw']},{...inventory(5),status:'deleted',actions:[]}]}}));
 await page.route(`**/api/v1/social-posts?post_id=${id(1)}`,route=>route.fulfill({status:503,json:{}}));
 await page.route(`**/api/v1/social-posts?post_id=${id(2)}`,route=>route.fulfill({json:{items:[]}}));await login(page);
 await expect(page.getByText('本人貼文正文 3',{exact:false})).toBeVisible();await expect(page.getByText('這則貼文目前無法查看，可能已隱藏或撤下。')).toBeVisible();
 await expect(page.getByText('這則貼文暫時讀取不到。其他內容仍可瀏覽，或重新整理後再試。')).toBeVisible();
 for(const n of [1,2,4,5])await expect(page.getByRole('article',{name:`貼文：我的創作 ${n}`,exact:true}).getByRole('link')).toHaveCount(0);
 expect(reads).toEqual([id(3)]);
});

test('PERSONAL-SPACE-UI-03: feature off makes no inventory or post request and does not expose contact fields',async({page})=>{
 let inventoryReads=0,postReads=0;
 await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),personal_content_enabled:false}});});
 await page.route(`**/api/v1/members/${owner}`,async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),contacts:{email:'PRIVATE_CONTACT_SENTINEL'},login_email:'PRIVATE_LOGIN_SENTINEL',mfa_secret:'PRIVATE_MFA_SENTINEL'}});});
 await page.route('**/api/v1/me/content',route=>{inventoryReads++;return route.fulfill({json:{items:[]}});});
 await page.route('**/api/v1/social-posts?post_id=*',route=>{postReads++;return route.fulfill({json:{items:[]}});});await login(page);
 await expect(page.getByText(/目前未開放個人內容瀏覽/)).toBeVisible();await expect(page.locator('.personal-space')).not.toContainText('PRIVATE_');expect(inventoryReads).toBe(0);expect(postReads).toBe(0);
 await page.locator('.settings-menu-button').click();await expect(page.getByRole('menuitem',{name:'我的內容',exact:true})).toHaveCount(0);await expect(page.getByRole('menuitem',{name:'我的個人空間',exact:true})).toBeVisible();
});

test('PERSONAL-SPACE-UI-04: page change cancels late body; failed inventory has retry rather than an empty-state claim',async({page})=>{
 await synthetic(page);let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});
 await page.route(`**/api/v1/social-posts?post_id=${id(1)}`,async route=>{await held;await route.fulfill({json:{items:[{...preview(1),note:'LATE_OLD_PAGE_BODY'}]}}).catch(()=>{});});
 try{await login(page);await page.getByRole('button',{name:'下一頁',exact:true}).click();await expect(page.getByText('本人貼文正文 7',{exact:false})).toBeVisible();release();await expect(page.locator('.personal-space')).not.toContainText('LATE_OLD_PAGE_BODY');
 await page.route('**/api/v1/me/content',route=>route.fulfill({status:503,json:{}}));await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect(page.locator('.personal-space [role="alert"]')).toContainText('未取得資料不代表沒有內容');await expect(page.locator('.personal-space-entry')).toHaveCount(0);
 await page.unroute('**/api/v1/me/content');await page.route('**/api/v1/me/content',route=>route.fulfill({json:{items:[]}}));await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect(page.getByRole('heading',{name:'這裡還沒有內容'})).toBeVisible();
 }finally{release();}
});

test('PERSONAL-SPACE-UI-05: owner switch clears pending previews and the former account cannot flash back',async({page})=>{
 await synthetic(page,2);let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});
 await page.route(`**/api/v1/social-posts?post_id=${id(2)}`,async route=>{await held;await route.fulfill({json:{items:[{...preview(2),note:'OLD_ACCOUNT_BODY_SENTINEL'}]}}).catch(()=>{});});
 await page.route(`**/api/v1/social-posts?post_id=${id(1)}`,route=>route.fulfill({json:{items:[{...preview(1),thumbnail_url:`/api/v1/social-posts/${id(1)}/thumbnail`}]}}));
 await page.route(`**/api/v1/social-posts/${id(1)}/thumbnail`,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#406040"/></svg>'}));
 try{await login(page);await expect(page.locator('.personal-space-photo')).toBeVisible();await expect(page.getByText('正在讀取這則貼文…')).toBeVisible();await page.locator('.settings-menu-button').click();await page.getByRole('menuitem',{name:'登出',exact:true}).click();await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();
 await page.unroute('**/api/v1/me/content');await page.route('**/api/v1/me/content',route=>route.fulfill({json:{items:[]}}));await login(page,'reviewer@local.test');release();await expect(page.getByRole('heading',{name:'這裡還沒有內容'})).toBeVisible();await expect(page.locator('body')).not.toContainText('OLD_ACCOUNT_BODY_SENTINEL');await expect(page.locator('.personal-space-photo')).toHaveCount(0);
 }finally{release();}
});

test('PERSONAL-SPACE-UI-06: real owner inventory/exact post respects hidden, deleted and anonymous non-public boundaries',async({page,browser,e2eAuthPool})=>{
 await login(page);const session=await(await page.request.get('/api/v1/session')).json(),origin=new URL(page.url()).origin;
 const created=await page.request.post('/api/v1/social-posts/notes',{headers:{Origin:origin,'X-CSRF-Token':session.csrf_token,'Idempotency-Key':crypto.randomUUID()},data:{text:'PERSONAL_SPACE_REAL_PRIVATE_NOTE\n真實來源的本人正文'}});expect(created.status()).toBe(201);const post=await created.json();
 const guest=await browser.newContext();
 try{await page.getByRole('button',{name:'重新整理',exact:true}).click();const card=page.getByRole('article',{name:'貼文：PERSONAL_SPACE_REAL_PRIVATE_NOTE',exact:true});await expect(card).toContainText('真實來源的本人正文');await expect(card.getByRole('link',{name:'開啟貼文與留言'})).toHaveAttribute('href',`/?social-post=${post.post_id}#social`);
 const anon=await guest.newPage();await anon.goto(`${origin}/posts/${post.post_id}`);await expect(anon.locator('body')).not.toContainText('PERSONAL_SPACE_REAL_PRIVATE_NOTE');
 for(const state of ['hidden','deleted']){await e2eAuthPool.query('UPDATE community_social_posts SET state=$1 WHERE post_id=$2',[state,post.post_id]);await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect(card).toBeVisible();await expect(card.getByRole('link')).toHaveCount(0);await expect(card).not.toContainText('真實來源的本人正文');}
 }finally{
  try{await guest.close();}finally{
   // Deleted posts still consume the daily budget. Remove only this case's row
   // from the validated disposable Playwright schema, never reset global limits.
   const schema=e2eSchema(process.env.FREEDOM_E2E_SCHEMA);
   expect((await e2eAuthPool.query('SELECT current_schema() AS schema')).rows[0].schema).toBe(schema);
   const removed=await e2eAuthPool.query(`DELETE FROM "${schema}".community_social_posts WHERE post_id=$1 AND author_user_id=$2 AND note=$3 RETURNING post_id`,[post.post_id,session.user.user_id,'PERSONAL_SPACE_REAL_PRIVATE_NOTE\n真實來源的本人正文']);
   expect(removed.rows.map(row=>row.post_id)).toEqual([post.post_id]);
  }
 }
});

for(const width of [320,390,1280])test(`PERSONAL-SPACE-UI-07: ${width}px owner content and menu remain reachable in all themes with reduced motion`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:640});await page.emulateMedia({reducedMotion:'reduce'});await synthetic(page,1);await login(page);
 for(const [theme,label] of [['light','自由工坊－明亮'],['dark','自由工坊－夜航'],['versefolk','自由工坊－敘生'],['dragon','新手導覽－龍娘'],['ai-sister','新手導覽－AI Sister']]){
  await openSettingsPanel(page,'appearance');const choice=page.getByRole('menuitemradio',{name:label,exact:true});await choice.click();await expect(choice).toBeFocused();await closeSettingsMenu(page);await expect(page.locator('.settings-menu-button')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const selector of ['.personal-space-private','.personal-space-entry-meta']){
   const ratio=await page.locator(selector).first().evaluate(element=>{
    const rgb=(value:string)=>value.match(/[\d.]+/g)!.map(Number);
    const luminance=(c:number[])=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    let node:Element|null=element,bg=[255,255,255];while(node){const c=rgb(getComputedStyle(node).backgroundColor);if(c.length===3||c[3]===1){bg=c;break;}node=node.parentElement;}
    const a=luminance(rgb(getComputedStyle(element).color)),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   });expect(ratio,`${theme} ${selector} contrast`).toBeGreaterThanOrEqual(4.5);
  }
  await page.locator('.settings-menu-button').click();const logout=page.getByRole('menuitem',{name:'登出',exact:true});await logout.scrollIntoViewIfNeeded();const box=(await logout.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);expect(box.y+box.height).toBeLessThanOrEqual(640);await closeSettingsMenu(page);
  const screenshot=testInfo.outputPath(`personal-space-${theme}-${width}.png`);
  await page.screenshot({path:screenshot,fullPage:true});
  await testInfo.attach(`personal-space-${theme}-${width}`,{path:screenshot,contentType:'image/png'});
 }
});

test('PERSONAL-SPACE-UI-08: language/theme panels preserve an account form draft, focus and browser history',async({page})=>{
 await login(page);await page.getByRole('link',{name:'編輯資料與分享設定',exact:true}).click();await expect(page).toHaveURL(/#account$/);const input=page.getByLabel('社群顯示名稱',{exact:true});await input.fill('尚未儲存的本人草稿');
 for(const label of ['English','日本語','한국어','Español','繁體中文']){await openSettingsPanel(page,'language');const option=page.getByRole('menuitemradio',{name:label,exact:true});await option.click();await expect(option).toBeFocused();await expect(input).toHaveValue('尚未儲存的本人草稿');await closeSettingsMenu(page);}
 await openSettingsPanel(page,'appearance');await page.getByRole('menuitemradio',{name:'自由工坊－夜航',exact:true}).click();await closeSettingsMenu(page);await expect(input).toHaveValue('尚未儲存的本人草稿');
 await page.locator('.settings-menu-button').click();await page.goBack();await expect(page).toHaveURL(/#profile$/);await expect(page.getByRole('menu')).toHaveCount(0);
});

test('PERSONAL-SPACE-UI-09: long post clamps to four lines, expands and collapses with keyboard, and the photo stays bounded',async({page})=>{
 await page.setViewportSize({width:320,height:640});await synthetic(page,1);
 const text=Array.from({length:24},(_,i)=>`第 ${i+1} 段：這是真正長文，用來核對手機首屏不會被單一貼文吃滿。`).join('\n');
 await page.route(`**/api/v1/social-posts?post_id=${id(1)}`,route=>route.fulfill({json:{items:[{...preview(1),note:text,thumbnail_url:`/api/v1/social-posts/${id(1)}/thumbnail`}]}}));
 await page.route(`**/api/v1/social-posts/${id(1)}/thumbnail`,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="1200"><rect width="640" height="1200" fill="#406040"/></svg>'}));
 await login(page);const body=page.locator('.personal-space-body'),more=page.getByRole('button',{name:'顯示全文',exact:true});await expect(more).toBeVisible();
 const lines=await body.evaluate(element=>element.clientHeight/parseFloat(getComputedStyle(element).lineHeight));expect(lines).toBeLessThanOrEqual(4.1);
 await more.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'收合',exact:true})).toHaveAttribute('aria-expanded','true');await expect(body).toHaveText(text);
 expect(await body.evaluate(element=>element.clientHeight/parseFloat(getComputedStyle(element).lineHeight))).toBeGreaterThan(4);
 await page.keyboard.press('Enter');await expect(more).toBeFocused();await expect(more).toHaveAttribute('aria-expanded','false');
 expect((await page.locator('.personal-space-photo').boundingBox())!.height).toBeLessThanOrEqual(420);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('PERSONAL-SPACE-UI-10: a failed exact thumbnail has local fallback; foreign image URLs never enter the DOM or network',async({page})=>{
 await synthetic(page,2);let foreignRequests=0;
 await page.route('https://untrusted-image.invalid/**',route=>{foreignRequests++;return route.abort();});
 await page.route(`**/api/v1/social-posts?post_id=${id(1)}`,route=>route.fulfill({json:{items:[{...preview(1),thumbnail_url:`/api/v1/social-posts/${id(1)}/thumbnail`}]}}));
 await page.route(`**/api/v1/social-posts/${id(1)}/thumbnail`,route=>route.fulfill({status:404,body:''}));
 await page.route(`**/api/v1/social-posts?post_id=${id(2)}`,route=>route.fulfill({json:{items:[{...preview(2),thumbnail_url:'https://untrusted-image.invalid/tracker'}]}}));
 await login(page);await expect(page.getByText('圖片暫時讀取不到；仍可閱讀貼文，或開啟原始討論。')).toBeVisible();await expect(page.getByText('本人貼文正文 2',{exact:false})).toBeVisible();
 await expect(page.locator('.personal-space-photo')).toHaveCount(0);expect(foreignRequests).toBe(0);
});

test('PERSONAL-SPACE-UI-11: all five interface languages preserve the selected page, original post text and read/write boundaries',async({page})=>{
 const reads=await synthetic(page,8);await login(page);await page.getByRole('button',{name:'下一頁',exact:true}).click();await expect(page.getByText('本人貼文正文 7',{exact:false})).toBeVisible();expect(reads).toHaveLength(8);
 const writes:string[]=[];page.on('request',request=>{if(request.method()!=='GET'&&/\/api\/v1\/(me\/content|social-posts|me\/share|me\/account)/.test(request.url()))writes.push(request.url());});
 for(const [label,language,title,pagination] of [
  ['English','en','My space','Page 2 of 2'],['日本語','ja','マイスペース','2 ページ中 2 ページ'],['한국어','ko','내 공간','2페이지 중 2페이지'],['Español','es','Mi espacio','Página 2 de 2'],['繁體中文','zh-Hant','我的個人空間','第 2 / 2 頁'],
 ]){
  await openSettingsPanel(page,'language');const option=page.getByRole('menuitemradio',{name:label,exact:true});await option.click();await expect(option).toBeFocused();await closeSettingsMenu(page);
  await expect(page.locator('html')).toHaveAttribute('lang',language);await expect(page.getByRole('heading',{level:1})).toHaveText(title);await expect(page.locator('.personal-space-pagination span')).toHaveText(pagination);
  await expect(page.getByText('本人貼文正文 7',{exact:false})).toBeVisible();await expect(page.locator('.personal-space-entry')).toHaveCount(2);expect(reads).toHaveLength(8);expect(writes).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});
