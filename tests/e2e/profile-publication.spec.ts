import {test,expect,type Page} from './fixtures.js';
const target='30000000-0000-4000-8000-000000000001';
const profile={display_name:'訪客可讀名稱',bio:'只顯示本人確認的介紹',links:[{label:'作品',url:'https://example.test/work'}],avatar_url:null};
const settings={visibility:'private',display_name:'',bio:'',links:[],avatar_url:null,aggregate_version:null};
async function login(page:Page){
 await page.goto('/#profile');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.settings-menu-button')).toBeVisible();
}
test('guest profile is one public read, no authenticated profile/inventory or mutation; login cancel returns target',async({page})=>{
 const calls:string[]=[];page.on('request',request=>{if(request.url().includes('/api/v1/'))calls.push(request.method()+' '+new URL(request.url()).pathname);});
 await page.route(`**/api/v1/public/member-profiles/${target}`,route=>route.fulfill({json:profile}));
 await page.goto(`/#profile?member=${target}`);await expect(page.getByRole('heading',{name:profile.display_name})).toBeVisible();
 expect(calls.filter(value=>value.includes('/public/member-profiles/'))).toHaveLength(1);
 expect(calls.some(value=>value.includes('/me/content')||value.includes(`/members/${target}/profile`)||value.startsWith('POST'))).toBe(false);
 await page.getByRole('button',{name:'登入後加好友或私訊'}).click();await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'取消登入，返回個人頁'}).click();await expect(page.getByRole('heading',{name:profile.display_name})).toBeVisible();expect(page.url()).toContain(`#profile?member=${target}`);
});
test('owner preview does not save, public needs explicit consent, unknown result retries exact body and key',async({page})=>{
 let stored={...settings},attempts: {body:unknown;key:string|null}[]=[];
 await page.route('**/api/v1/me/profile-publication',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:stored});
  attempts.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']??null});
  if(attempts.length===1)return route.abort('failed');
  const body=route.request().postDataJSON();stored={...body,avatar_url:null,aggregate_version:'1'};return route.fulfill({json:stored});
 });
 await login(page);await page.goto('/#profile?view=settings');await expect(page.getByRole('heading',{name:'對外個人頁',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'前往資料與帳號設定，管理分享名片'})).toHaveAttribute('href','#account');
 await page.getByLabel('顯示名稱',{exact:true}).fill('我的公開名稱');await page.getByLabel('一句話介紹',{exact:true}).fill('預覽中的自介');await page.getByRole('button',{name:'新增連結'}).click();await page.getByLabel('連結名稱 1',{exact:true}).fill('我的作品連結');await page.getByLabel('HTTPS 網址 1',{exact:true}).fill('https://example.test/my-work');await page.getByRole('radio',{name:'任何人（免登入）'}).check();
 await page.getByRole('button',{name:'草稿外觀預覽'}).click();await expect(page.getByRole('heading',{name:'尚未儲存的草稿預覽'})).toBeVisible();await expect(page.getByRole('heading',{name:'我的公開名稱'})).toBeVisible();await expect(page.locator('.profile-preview').getByText('預覽中的自介',{exact:true})).toBeVisible();await expect(page.locator('.profile-preview').getByRole('link',{name:'我的作品連結'})).toHaveAttribute('href','https://example.test/my-work');expect(attempts).toHaveLength(0);
 await expect(page.getByRole('button',{name:'確認公開',exact:true})).toBeDisabled();await page.getByRole('checkbox',{name:'我確認公開以上文字與連結'}).check();await page.getByRole('button',{name:'確認公開',exact:true}).click();
 await expect(page.getByRole('button',{name:'確認原儲存結果'})).toBeVisible();await page.getByRole('button',{name:'確認原儲存結果'}).click();
 await expect(page.getByText('個人頁與可見範圍已儲存。')).toBeVisible();expect(attempts).toHaveLength(2);expect(attempts[0]).toEqual(attempts[1]);
});
test('member incoming action is explicit; profile view does not write',async({page})=>{
 let writes=0;
 const member={profile,actions:{is_self:false,friendship:{state:'pending',requester_ref:target,aggregate_version:'4'},can_request:false,can_accept:true,can_message:true}};
 await page.route(`**/api/v1/members/${target}/profile`,route=>route.fulfill({json:member}));
 await page.route(`**/api/v1/friends/${target}/accept`,route=>{writes++;return route.fulfill({json:{state:'accepted'}});});
 await login(page);await page.goto(`/#profile?member=${target}`);await expect(page.getByRole('button',{name:'接受好友邀請'})).toBeVisible();expect(writes).toBe(0);
 await page.getByRole('button',{name:'接受好友邀請'}).click();await expect(page.getByText('好友關係已更新。')).toBeVisible();expect(writes).toBe(1);
});
for(const width of [320,390])test(`profile editor ${width}px keeps fields within viewport`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.route('**/api/v1/me/profile-publication',route=>route.fulfill({json:settings}));await login(page);await page.goto('/#profile?view=settings');await expect(page.getByLabel('顯示名稱',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
