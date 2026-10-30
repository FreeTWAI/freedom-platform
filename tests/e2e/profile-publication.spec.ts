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
  const {confirm_public,...body}=route.request().postDataJSON();stored={...body,avatar_url:null,aggregate_version:'1'};return route.fulfill({json:stored});
 });
 await login(page);await page.goto('/#profile?view=settings');await expect(page.getByRole('heading',{name:'對外個人頁',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'前往資料與帳號設定，管理分享名片'})).toHaveAttribute('href','#account');
 await page.getByRole('button',{name:'深夜星空'}).click();await expect(page.locator('.profile-preview [data-profile-theme="night"]')).toBeVisible();await expect(page.locator('.profile-preview').getByRole('heading',{name:'主題外觀示意'})).toBeVisible();expect(attempts).toHaveLength(0);
 await page.getByLabel('顯示名稱',{exact:true}).fill('我的公開名稱');await page.getByLabel('一句話介紹',{exact:true}).fill('預覽中的自介');await page.getByText('編輯我的連結（0/5）',{exact:true}).click();await page.getByRole('button',{name:'新增連結'}).click();await page.getByLabel('連結名稱 1',{exact:true}).fill('我的作品連結');await page.getByLabel('HTTPS 網址 1',{exact:true}).fill('https://example.test/my-work');await page.getByRole('radio',{name:'任何人（免登入）'}).check();
 await expect(page.getByRole('heading',{name:'草稿即時預覽'})).toBeVisible();await expect(page.getByRole('heading',{name:'我的公開名稱'})).toBeVisible();await expect(page.locator('.profile-preview').getByText('預覽中的自介',{exact:true})).toBeVisible();await expect(page.locator('.profile-preview').getByRole('link',{name:'我的作品連結'})).toHaveAttribute('href','https://example.test/my-work');expect(attempts).toHaveLength(0);
 await expect(page.getByRole('button',{name:'確認公開',exact:true})).toBeDisabled();await page.getByRole('checkbox',{name:'我確認公開以上文字、連結與已勾選的封面'}).check();await page.getByRole('button',{name:'確認公開',exact:true}).click();
 await expect(page.getByRole('button',{name:'確認原儲存結果'})).toBeVisible();await expect(page.getByRole('button',{name:'深夜星空'})).toBeDisabled();await expect(page.getByRole('button',{name:'取消修改',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'返回本人空間',exact:true})).toBeDisabled();await page.getByRole('button',{name:'確認原儲存結果'}).click();
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

test('customization preview, reorder, cancel and reset are local until explicit save; private cover staging needs consent',async({page})=>{
 const {defaultProfileLayout}=await import('../../packages/shared/member-profile.js');
 let stored={...settings,display_name:'我的個人頁',layout:structuredClone(defaultProfileLayout),include_cover:false,cover_version:null as string|null,cover:null,aggregate_version:'1'};
 const writes:Record<string,unknown>[]=[];let coverWrites=0;
 await page.route('**/api/v1/me/profile-publication',route=>{if(route.request().method()==='GET')return route.fulfill({json:stored});const {confirm_public,...body}=route.request().postDataJSON();writes.push(body);stored={...stored,...body,aggregate_version:String(Number(stored.aggregate_version)+1)};return route.fulfill({json:stored});});
 await page.route('**/api/v1/me/profile-cover',route=>{if(route.request().method()==='GET')return route.fulfill({json:{version:coverWrites?'2':'1',present:!!coverWrites,upload_available:true,reason:null,draft_versions:coverWrites?['2']:[]}});coverWrites++;return route.fulfill({json:{version:'2',present:true}});});
 await page.route('**/api/v1/me/profile-cover/image?*',route=>route.fulfill({status:404}));
 await login(page);await page.goto('/#profile?view=settings');await page.getByRole('button',{name:'深夜星空'}).click();await page.getByText('關於我與精選作品',{exact:true}).click();await page.getByRole('textbox',{name:'關於我',exact:true}).fill('自己的空間\n第二行');await page.getByRole('button',{name:'新增精選作品'}).click();await page.getByLabel('作品名稱 1',{exact:true}).fill('我的手作');await page.getByLabel('作品 HTTPS 網址 1',{exact:true}).fill('https://example.test/handmade');await page.getByLabel('作品 HTTPS 網址 1',{exact:true}).fill('http://example.test/invalid');await page.getByText('關於我與精選作品',{exact:true}).click();await page.getByRole('button',{name:'儲存',exact:true}).click();await expect(page.getByLabel('作品 HTTPS 網址 1',{exact:true})).toBeFocused();expect(writes).toHaveLength(0);await page.getByLabel('作品 HTTPS 網址 1',{exact:true}).fill('https://example.test/handmade');
 await page.getByText('顯示哪些區塊、先後順序',{exact:true}).click();await page.getByRole('button',{name:'上移精選作品',exact:true}).click();const preview=page.locator('.profile-preview');await expect(preview.locator('[data-profile-theme="night"]')).toBeVisible();await expect(preview.getByRole('link',{name:'我的手作'})).toHaveAttribute('href','https://example.test/handmade');expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'取消修改',exact:true}).click();await expect(page.getByRole('button',{name:'明亮紙頁'})).toHaveAttribute('aria-pressed','true');expect(writes).toHaveLength(0);
 await page.getByText('上傳自己的封面圖片',{exact:true}).click();await page.getByLabel('選擇封面圖片',{exact:true}).setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from('synthetic upload; server decoding covered separately')});await page.getByRole('button',{name:'上傳並預覽封面'}).click();await expect(page.getByText('封面已存成私人草稿。確認預覽並勾選使用後，再按儲存個人頁。')).toBeVisible();expect(coverWrites).toBe(1);expect(writes).toHaveLength(0);
 const consent=page.getByRole('checkbox',{name:'使用這張封面，依個人頁可見範圍展示'});await expect(consent).not.toBeChecked();await consent.check();await page.getByRole('button',{name:'儲存',exact:true}).click();await expect(page.getByText('個人頁與可見範圍已儲存。')).toBeVisible();expect(writes[0]).toMatchObject({visibility:'private',include_cover:true,cover_version:'2'});
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'恢復預設外觀'}).click();expect(writes).toHaveLength(1);await page.getByRole('button',{name:'儲存',exact:true}).click();await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toMatchObject({visibility:'private',include_cover:false,cover_version:null});
});

test('cover ambiguous upload keeps identical file key and CAS through a later conflict',async({page})=>{
 let releaseFirst:()=>void=()=>{};const holdFirst=new Promise<void>(resolve=>{releaseFirst=resolve;});
 const attempts:{body:string|null;key:string|undefined;version:string|undefined}[]=[];
 await page.route('**/api/v1/me/profile-publication',route=>route.fulfill({json:{...settings,display_name:'封面測試'}}));
 await page.route('**/api/v1/me/profile-cover',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{version:'1',present:false,upload_available:true,reason:null,draft_versions:[]}});
  const request=route.request();attempts.push({body:request.postData(),key:request.headers()['idempotency-key'],version:request.headers()['if-match']});
  if(attempts.length===1){await holdFirst;return route.abort('failed');}
  if(attempts.length===2)return route.fulfill({status:412,json:{title:'版本已更新',status:412,code:'version_conflict'}});
  return route.fulfill({json:{version:'2',present:true}});
 });
 await page.route('**/api/v1/me/profile-cover/image?*',route=>route.fulfill({status:404}));
 await login(page);await page.goto('/#profile?view=settings');await page.getByText('上傳自己的封面圖片',{exact:true}).click();await page.getByLabel('選擇封面圖片',{exact:true}).setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from('synthetic unchanged cover bytes')});await page.getByRole('button',{name:'上傳並預覽封面'}).click();
 try{await expect.poll(()=>attempts.length).toBe(1);await page.getByText('上傳自己的封面圖片',{exact:true}).click();await expect(page.getByText('封面處理中，請稍候。',{exact:true})).toBeVisible();}finally{releaseFirst();}
 const recover=page.getByRole('button',{name:'確認原封面操作',exact:true});await expect(recover).toBeVisible();await page.getByText('上傳自己的封面圖片',{exact:true}).click();await expect(page.getByText('封面結果尚未確認；請確認原封面操作後再離開。',{exact:true})).toBeVisible();await page.getByRole('button',{name:'查看封面操作',exact:true}).click();await expect(recover).toBeVisible();await expect(page.getByRole('button',{name:'返回本人空間',exact:true})).toBeDisabled();await recover.click();await expect(recover).toBeEnabled();await expect(page.getByRole('button',{name:'返回本人空間',exact:true})).toBeDisabled();await expect(page.getByLabel('選擇封面圖片',{exact:true})).toBeDisabled();await recover.click();
 await expect(page.getByText('封面已存成私人草稿。確認預覽並勾選使用後，再按儲存個人頁。')).toBeVisible();expect(attempts).toHaveLength(3);expect(attempts[1]).toEqual(attempts[0]);expect(attempts[2]).toEqual(attempts[0]);await expect(page.getByRole('button',{name:'返回本人空間',exact:true})).toBeEnabled();
});

for(const width of [390,1280])test(`profile theme choices and progressive controls preserve edits at ${width}px`,async({page})=>{
 const {defaultProfileLayout}=await import('../../packages/shared/member-profile.js');
 const stored={...settings,display_name:'自己的個人頁',layout:structuredClone(defaultProfileLayout),include_cover:false,cover_version:null,cover:null,aggregate_version:'1'};
 let writes=0;
 await page.setViewportSize({width,height:900});
 await page.route('**/api/v1/me/profile-publication',route=>{if(route.request().method()!=='GET')writes++;return route.fulfill({json:stored});});
 await page.route('**/api/v1/me/profile-cover',route=>route.fulfill({json:{version:'1',present:false,upload_available:true,reason:null,draft_versions:[]}}));
 await login(page);await page.goto('/#profile?view=settings');
 await expect(page.getByRole('heading',{name:'草稿即時預覽'})).toBeVisible();
 await expect(page.getByRole('radio',{name:'不公開（僅自己）'})).toBeChecked();
 await expect(page.getByLabel('重點顏色',{exact:true})).not.toBeVisible();
 await expect(page.getByLabel('選擇封面圖片',{exact:true})).not.toBeVisible();
 const night=page.getByRole('button',{name:'深夜星空'});
 await night.click();await night.click();
 await expect(night).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.profile-preview [data-profile-theme="night"]')).toBeVisible();
 await page.getByLabel('一句話介紹',{exact:true}).fill('不因收合而消失');
 await page.getByText('微調顏色與背景',{exact:true}).click();await page.getByLabel('重點顏色',{exact:true}).selectOption('teal');await page.getByText('微調顏色與背景',{exact:true}).click();
 await expect(page.locator('.profile-preview [data-profile-accent="teal"]')).toBeVisible();
 await page.getByText('上傳自己的封面圖片',{exact:true}).click();
 await page.getByLabel('選擇封面圖片',{exact:true}).setInputFiles({name:'retained.png',mimeType:'image/png',buffer:Buffer.from('synthetic retained selection')});
 await page.getByText('上傳自己的封面圖片',{exact:true}).click();await expect(page.getByText('封面已選擇但尚未上傳；請上傳或取消選檔後再儲存個人頁。',{exact:true})).toBeVisible();await page.getByRole('button',{name:'查看封面操作',exact:true}).click();
 await expect(page.getByText('已選擇：retained.png（尚未上傳）')).toBeVisible();
 await expect(page.getByRole('button',{name:'儲存',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'取消選檔',exact:true}).click();
 await page.getByRole('button',{name:'取消修改',exact:true}).click();
 await expect(page.getByRole('button',{name:'明亮紙頁'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByLabel('一句話介紹',{exact:true})).toHaveValue('');
 await expect(page.getByRole('radio',{name:'不公開（僅自己）'})).toBeChecked();
 await page.getByText('編輯我的連結（0/5）',{exact:true}).click();await page.getByRole('button',{name:'新增連結'}).click();
 await page.getByLabel('連結名稱 1',{exact:true}).fill('未填網址');await page.getByText('編輯我的連結（1/5）',{exact:true}).click();
 await page.getByRole('button',{name:'儲存',exact:true}).click();await expect(page.getByLabel('HTTPS 網址 1',{exact:true})).toBeVisible();
 await page.getByLabel('HTTPS 網址 1',{exact:true}).fill('http://example.test/invalid');await page.getByText('編輯我的連結（1/5）',{exact:true}).click();await page.getByRole('button',{name:'儲存',exact:true}).click();
 await expect(page.getByLabel('HTTPS 網址 1',{exact:true})).toBeVisible();await expect(page.getByLabel('HTTPS 網址 1',{exact:true})).toBeFocused();await expect(page.getByLabel('HTTPS 網址 1',{exact:true})).toHaveValue('http://example.test/invalid');
 expect(writes).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
