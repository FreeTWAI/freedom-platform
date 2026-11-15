import {randomUUID} from 'node:crypto';
import {test,expect,type Page} from './fixtures.js';
import {quickJoin} from './quick-join.js';
const owner='20000000-0000-4000-8000-000000000001';
const other='20000000-0000-4000-8000-000000000002';
const draft='30000000-0000-4000-8000-000000000001';
const published='30000000-0000-4000-8000-000000000002';
async function login(page:Page,email='maker@local.test') {
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(email);await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.settings-menu-button')).toBeVisible();
}
async function go(page:Page,hash:string){await page.evaluate(hash=>{location.hash=hash;},hash);}
async function primary(page:Page){expect(await page.locator('main .btn-primary:visible').count()).toBeLessThanOrEqual(1);}

test('another member address never mounts the owner inventory or editor',async({page})=>{
 await login(page,'reviewer@local.test');
 const reads:string[]=[];page.on('request',r=>{if(/\/api\/v1\/me\/(content|showcases|profile-publication)/.test(r.url()))reads.push(r.url());});
 await page.route(`**/api/v1/members/${owner}/profile`,r=>r.fulfill({json:{profile:{display_name:'公開訪客投影',bio:'訪客介紹',links:[],avatar_url:null},actions:{is_self:false,friendship:{state:'none',requester_ref:null,aggregate_version:null},can_request:true,can_accept:false,can_message:false}}}));
 await go(page,`#me?member=${owner}`);
 await expect(page.getByRole('heading',{name:'公開訪客投影',exact:true})).toBeVisible();
 await expect(page.locator('.personal-space,.account-panel,.personal-content')).toHaveCount(0);
 expect(reads).toEqual([]);
});

for(const [width,height] of [[390,844],[320,568]])test(`one place navigation at ${width} × ${height}`,async({page},info)=>{
 await page.setViewportSize({width,height});
 await page.route('**/api/v1/me/content',r=>r.fulfill({json:{items:[
  {kind:'showcase',id:draft,title:'合成草稿',status:'draft',version:1,path:'#showcase/'+draft,visibility:'private',actions:['edit','publish']},
  {kind:'showcase',id:published,title:'合成已發布',status:'published',version:2,path:'#showcase/'+published,visibility:'community',actions:['view','withdraw']},
 ]}}));
 await login(page);await go(page,'#me');
 await expect(page.locator('.personal-space-entry')).toHaveCount(2);
 await expect(page.locator('.personal-space-hero-actions a')).toHaveText(['編輯個人頁']);await primary(page);
 await page.locator('.personal-space-filters-disclosure > summary').click();
 await page.getByRole('button',{name:'草稿',exact:true}).click();await expect(page.locator('.personal-space-entry')).toHaveCount(1);await expect(page.locator('.personal-space-entry')).toContainText('合成草稿');
 await page.getByRole('button',{name:'已發布',exact:true}).click();await expect(page.locator('.personal-space-entry')).toHaveCount(1);await expect(page.locator('.personal-space-entry')).toContainText('合成已發布');
 await page.locator('.personal-space-more summary').click();await expect(page.locator('.personal-space-more').getByRole('link',{name:'撤下',exact:true})).toBeVisible();
 await go(page,'#my-content?x=1');await expect(page).toHaveURL(/#me\?x=1$/);await expect(page.getByRole('heading',{name:'我的內容',exact:true})).toBeVisible();
 await go(page,'#my-content');await expect(page).toHaveURL(/#me$/);
 await page.getByRole('link',{name:'新增作品草稿'}).click();await expect(page).toHaveURL(/#me\/content\/showcases\/new$/);await expect(page.getByRole('heading',{name:'私人作品草稿'})).toBeVisible();await primary(page);
 await page.goBack();await expect(page).toHaveURL(/#me$/);
 await page.getByRole('link',{name:'新增作品草稿'}).click();await page.getByLabel('作品標題',{exact:true}).fill('合成導覽新稿 '+width);await page.getByLabel('一句話介紹',{exact:true}).fill('只驗證草稿儲存與路由');await page.getByRole('button',{name:'儲存私人草稿',exact:true}).click();await expect(page).toHaveURL(/#me\/content\/showcases\/[0-9a-f-]{36}$/);await page.goBack();await expect(page).toHaveURL(/#me$/);
 await page.screenshot({path:info.outputPath('owner.png'),fullPage:true});
 await go(page,'#me?view=settings');await expect(page).toHaveURL(/#me\/settings\?view=page$/);
 await expect(page.locator('[data-public-page]')).toHaveAttribute('open','');
 await page.getByLabel('顯示名稱',{exact:true}).fill('合成公開頁');
 await page.getByRole('button',{name:'儲存',exact:true}).click();await expect(page.getByText('個人頁與可見範圍已儲存。',{exact:true})).toBeVisible();await primary(page);
 await page.locator('[data-public-page]').getByLabel('一句話介紹',{exact:true}).fill('尚未儲存的介紹');
 await page.locator('[data-public-page] > summary').click();await expect(page.locator('[data-public-page]')).not.toHaveAttribute('open','');
 const dialog=page.waitForEvent('dialog').then(async prompt=>{expect(prompt.message()).toContain('未儲存');await prompt.dismiss();});await go(page,'#home');await dialog;await expect(page).toHaveURL(/#me\/settings\?view=page$/);
 await page.locator('[data-public-page] > summary').click();await expect(page.locator('[data-public-page]').getByLabel('一句話介紹',{exact:true})).toHaveValue('尚未儲存的介紹');
 await page.getByRole('button',{name:'取消修改',exact:true}).click();await go(page,'#home');
 await expect(page.locator('.home-timeline')).toBeVisible();await primary(page);
 for(const text of ['遊戲大廳','技能與工具','社群活動','合作夥伴','作品交流','商品與供貨','作品與活動','常用入口'])await expect(page.locator('.member-home').getByText(text,{exact:true})).toHaveCount(0);
 await page.getByText('我的名片與推薦夥伴',{exact:true}).click();await page.getByRole('link',{name:'編輯個人頁',exact:true}).click();await expect(page).toHaveURL(/#me\/settings$/);
 await go(page,'#explore/people');await expect(page.getByRole('region',{name:'社群內容搜尋條件',exact:true})).toHaveCount(0);await primary(page);
 await go(page,'#explore');await page.getByRole('searchbox',{name:'關鍵字',exact:true}).fill('技能');await expect(page.getByRole('region',{name:'功能搜尋結果',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'功能搜尋結果',exact:true}).getByRole('button',{name:'技能書架',exact:true})).toHaveCount(0);await primary(page);
 for(const hash of ['#guilds/guild_games/start','#guilds/guild_games/tools']){
  await go(page,'#guilds');await expect(page.locator('.guilds-panel')).toBeVisible();await go(page,hash);await expect(page).toHaveURL(/#guilds\/guild_games\/tools\/arcade$/);await expect(page.locator('.fw-arcade-root')).toBeVisible();await expect(page.getByRole('button',{name:'工具列表',exact:true})).toHaveCount(0);await primary(page);await page.goBack();await expect(page).toHaveURL(/#guilds$/);
 }
 await page.route('**/api/v1/me/skill-books',r=>r.fulfill({json:{items:[]}}));
 await go(page,'#explore/resources');await expect(page.locator('.skills-panel')).toBeVisible();await expect(page.getByRole('button',{name:'免費預覽技能書',exact:true})).toBeVisible();await expect(page.locator('main .btn-primary:visible')).toHaveCount(1);await primary(page);
});

for(const [width,height] of [[390,844],[320,568]])test(`event actions have one owner at ${width} × ${height}`,async({page},info)=>{
 await page.setViewportSize({width,height});await login(page);
 const event={event_id:published,title:'合成導覽活動',description:'合成測試活動',organizer_ref:other,organizer_name:'合成主辦者',starts_at:'2099-03-01T10:00:00Z',ends_at:'2099-03-01T11:00:00Z',mode:'online',location:'合成線上場地',event_kind:'other',topic:null,online_url:null,visibility:'workshop',registration_policy:'community_member',capacity:20,state:'published',aggregate_version:1,attending_count:0,my_rsvp:null as string|null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,banner_url:null,banner_orientation:null,video_url:null,video_mime:null,help_need:'合成協助需求'};
 await page.route('**/api/v1/events',r=>r.fulfill({json:{items:[event]}}));
 let joins=0;await page.route(`**/api/v1/events/${published}/rsvp`,r=>{joins++;event.my_rsvp='going';event.attending_count=1;return r.fulfill({json:{...event}});});
 await go(page,'#explore/events');await expect(page.getByRole('link',{name:'查看並報名',exact:true})).toBeVisible();await expect(page.locator('main .btn-primary:visible')).toHaveCount(1);
 await page.getByRole('button',{name:'辦活動',exact:true}).click();await expect(page.getByRole('button',{name:'辦活動',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'找幫手',exact:true})).toHaveCount(0);await primary(page);
 await page.locator('form.experience-editor').getByRole('button',{name:'返回',exact:true}).click();
 await page.getByRole('link',{name:'查看並報名',exact:true}).click();await expect(page.getByRole('button',{name:'我要參加',exact:true})).toBeVisible();await primary(page);
 await expect(page.getByRole('link',{name:'參與設定',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'我要參加',exact:true}).click();await expect(page.getByRole('button',{name:'取消報名',exact:true})).toBeVisible();expect(joins).toBe(1);await primary(page);
 event.organizer_ref=owner;await go(page,'#home');await go(page,`#explore/events/${published}/manage`);await expect(page.getByRole('link',{name:'活動專頁',exact:true})).toHaveAttribute('href',`/events/${published}`);await primary(page);
});

test('settings show one open section and at most one primary across pairs, dirty guard, loading/error, and deep links',async({page})=>{
 await login(page,'reviewer@local.test');
 await go(page,'#me/settings');
 const section=(label:string)=>page.locator('.account-settings-section').filter({has:page.locator(':scope > summary strong',{hasText:label})});
 const labels=['個人資料','公開個人頁','分享名片設定（免登入）','誰能看到我','帳號與安全'] as const;
 await expect(page.locator('.account-settings-section[open]')).toHaveCount(1);
 await expect(section('個人資料')).toHaveAttribute('open','');
 await expect(page.locator('main .btn-primary:visible')).toHaveCount(1);

 // Every ordered pair of sections keeps exactly one open section and at most one primary button.
 for(const from of labels){
  for(const to of labels){
   if(from===to)continue;
   if((await section(from).getAttribute('open'))===null)await section(from).locator(':scope > summary').click();
   await expect(section(from)).toHaveAttribute('open','');
   await expect(page.locator('.account-settings-section[open]')).toHaveCount(1);
   await section(to).locator(':scope > summary').click();
   await expect(section(to)).toHaveAttribute('open','');
   await expect(section(from)).not.toHaveAttribute('open','');
   await expect(page.locator('.account-settings-section[open]')).toHaveCount(1);
   await primary(page);
  }
 }

 // Nested disclosures inside open sections must not introduce a second primary button.
 await section('個人資料').locator(':scope > summary').click();
 await section('個人資料').getByText('更換頭像',{exact:true}).click();
 await expect(section('個人資料').locator('.avatar-editor')).toBeVisible();
 await primary(page);
 await section('個人資料').getByText('個人網站與社群連結',{exact:true}).click();
 await expect(section('個人資料').locator('.social-links-editor')).toBeVisible();
 await primary(page);
 await section('個人資料').getByRole('button',{name:'＋ 新增連結',exact:true}).click();
 await expect(section('個人資料').getByRole('button',{name:'保存連結',exact:true})).toBeVisible();
 await primary(page);
 await section('個人資料').getByRole('button',{name:'取消',exact:true}).click();
 const certSummary=section('個人資料').getByText('我的稱號與社群認證',{exact:true});
 if(await certSummary.count()){
  await certSummary.click();
  await primary(page);
 }
 await section('帳號與安全').locator(':scope > summary').click();
 const notifSummary=section('帳號與安全').getByText('通知設定',{exact:true});
 if(await notifSummary.count()){
  await notifSummary.click();
  await primary(page);
 }
 await section('帳號與安全').getByText('連結 GitHub 與其他工具',{exact:true}).click();
 await primary(page);

 // Dirty guard when switching from 個人資料 -> 誰能看到我: stay keeps open & draft, leave switches.
 await section('個人資料').locator(':scope > summary').click();
 const nicknameInput=page.getByLabel('社群顯示名稱',{exact:true});
 await nicknameInput.fill('尚未儲存的設定草稿');
 let sawConfirm=false;
 page.once('dialog',async d=>{sawConfirm=true;expect(d.message()).toContain('未儲存');await d.dismiss();});
 await section('誰能看到我').locator(':scope > summary').click();
 expect(sawConfirm).toBe(true);
 await expect(section('個人資料')).toHaveAttribute('open','');
 await expect(section('誰能看到我')).not.toHaveAttribute('open','');
 await expect(nicknameInput).toHaveValue('尚未儲存的設定草稿');

 page.once('dialog',async d=>{await d.accept();});
 await section('誰能看到我').locator(':scope > summary').click();
 await expect(section('誰能看到我')).toHaveAttribute('open','');
 await expect(section('個人資料')).not.toHaveAttribute('open','');

 // Dirty guard from 誰能看到我 -> 公開個人頁: stay keeps 誰能看到我 & draft, leave switches cleanly.
 const discordInput=section('誰能看到我').getByLabel('Discord 帳號',{exact:true});
 await discordInput.fill('unsaved-discord');
 sawConfirm=false;
 page.once('dialog',async d=>{sawConfirm=true;expect(d.message()).toContain('未儲存');await d.dismiss();});
 await section('公開個人頁').locator(':scope > summary').click();
 expect(sawConfirm).toBe(true);
 await expect(section('誰能看到我')).toHaveAttribute('open','');
 await expect(section('公開個人頁')).not.toHaveAttribute('open','');
 await expect(discordInput).toHaveValue('unsaved-discord');

 page.once('dialog',async d=>{await d.accept();});
 await section('公開個人頁').locator(':scope > summary').click();
 await expect(section('公開個人頁')).toHaveAttribute('open','');
 await expect(section('誰能看到我')).not.toHaveAttribute('open','');

 // Dirty guard from 公開個人頁 -> 個人資料: stay keeps 公開個人頁 & draft, leave switches cleanly with no stale guard.
 const bioInput=page.locator('[data-public-page]').getByLabel('一句話介紹',{exact:true});
 await expect(bioInput).toBeVisible();
 await bioInput.fill('尚未儲存的公開自介');
 sawConfirm=false;
 page.once('dialog',async d=>{sawConfirm=true;expect(d.message()).toContain('未儲存');await d.dismiss();});
 await section('個人資料').locator(':scope > summary').click();
 expect(sawConfirm).toBe(true);
 await expect(section('公開個人頁')).toHaveAttribute('open','');
 await expect(section('個人資料')).not.toHaveAttribute('open','');
 await expect(bioInput).toHaveValue('尚未儲存的公開自介');

 page.once('dialog',async d=>{await d.accept();});
 await section('個人資料').locator(':scope > summary').click();
 await expect(section('個人資料')).toHaveAttribute('open','');
 await expect(section('公開個人頁')).not.toHaveAttribute('open','');
 // Switching again after confirming leave must not prompt again for the abandoned draft.
 await section('分享名片設定（免登入）').locator(':scope > summary').click();
 await expect(section('分享名片設定（免登入）')).toHaveAttribute('open','');

 // Deep links open only their target top-level section.
 await go(page,'#me/settings?view=page');
 await expect(section('公開個人頁')).toHaveAttribute('open','');
 await expect(section('個人資料')).not.toHaveAttribute('open','');
 await expect(page.locator('.account-settings-section[open]')).toHaveCount(1);
 await primary(page);

 await go(page,'#me/settings?view=connections');
 await expect(section('帳號與安全')).toHaveAttribute('open','');
 await expect(section('個人資料')).not.toHaveAttribute('open','');
 await expect(page.locator('.account-settings-section[open]')).toHaveCount(1);
 await primary(page);

 // Loading and failed sections show zero primary buttons.
 let releasePub!:()=>void;
 const pubGate=new Promise<void>(resolve=>{releasePub=resolve;});
 await page.route('**/api/v1/me/profile-publication',async route=>{await pubGate;await route.fulfill({status:500,json:{detail:'err'}});});
 await go(page,'#home');
 await go(page,'#me/settings?view=page');
 await expect(page.getByText('正在讀取設定…',{exact:true})).toBeVisible();
 await expect(page.locator('main .btn-primary:visible')).toHaveCount(0);
 releasePub();
 await expect(page.getByRole('button',{name:'重讀設定',exact:true})).toBeVisible();
 await expect(page.locator('main .btn-primary:visible')).toHaveCount(0);
 await page.unroute('**/api/v1/me/profile-publication');

 let releaseShare!:()=>void;
 const shareGate=new Promise<void>(resolve=>{releaseShare=resolve;});
 await page.route('**/api/v1/me/member-card-share',async route=>{await shareGate;await route.fulfill({status:500,json:{detail:'err'}});});
 await go(page,'#home');
 await go(page,'#me/settings');
 await section('分享名片設定（免登入）').locator(':scope > summary').click();
 await expect(page.getByText('正在載入分享設定…',{exact:true})).toBeVisible();
 await expect(page.locator('main .btn-primary:visible')).toHaveCount(0);
 releaseShare();
 await expect(page.getByRole('button',{name:'重讀分享設定',exact:true})).toBeVisible();
 await expect(page.locator('main .btn-primary:visible')).toHaveCount(0);
 await page.unroute('**/api/v1/me/member-card-share');

 let releaseAccount!:()=>void;
 const accountGate=new Promise<void>(resolve=>{releaseAccount=resolve;});
 await page.route('**/api/v1/me/account',async route=>{await accountGate;await route.fulfill({status:500,json:{detail:'err'}});});
 await go(page,'#home');
 await go(page,'#me/settings');
 await expect(page.getByText('載入會員資料…',{exact:true})).toBeVisible();
 await expect(page.locator('main .btn-primary:visible')).toHaveCount(0);
 releaseAccount();
 await expect(page.getByRole('button',{name:'重新載入我的資料',exact:true})).toBeVisible();
 await expect(page.locator('main .btn-primary:visible')).toHaveCount(0);
 await section('誰能看到我').locator(':scope > summary').click();
 await expect(page.locator('main .btn-primary:visible')).toHaveCount(0);
 await section('帳號與安全').locator(':scope > summary').click();
 await expect(page.locator('main .btn-primary:visible')).toHaveCount(0);
 await page.unroute('**/api/v1/me/account');
});

test('guild join shows unlocked skill-books link to explore, dismisses on next click, and opens #explore/resources',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'免費加入',exact:true}).click();
 await page.getByLabel('社群顯示名稱',{exact:true}).fill('技能書連結');
 await page.getByLabel('電子郵件',{exact:true}).fill(`oneplace-join-${randomUUID()}@example.test`);
 await page.getByLabel('密碼',{exact:true}).fill('freedom-oneplace-join-password');
 await page.getByRole('button',{name:'建立帳號，先逛工坊',exact:true}).click();
 await quickJoin(page);
 await expect(page.getByRole('heading',{name:'動態',level:1})).toBeVisible();

 await go(page,'#guilds');
 await expect(page.locator('.guilds-panel')).toBeVisible();
 const unjoined=page.getByRole('region',{name:'未加入公會',exact:true});
 await unjoined.locator('.guild-card').first().getByRole('button',{name:/^加入/}).click();
 const notice=page.locator('.guild-join-notice');
 const link=notice.getByRole('link',{name:'看已解鎖的技能書',exact:true});
 await expect(notice).toBeVisible();
 await expect(link).toBeVisible();
 await expect(link).toHaveAttribute('href','#explore/resources');

 await page.getByRole('button',{name:'已加入',exact:true}).click();
 await expect(notice).toBeVisible();
 await expect(link).toHaveCount(0);

 await page.getByRole('button',{name:'全部公會',exact:true}).click();
 await unjoined.locator('.guild-card').first().getByRole('button',{name:/^加入/}).click();
 await expect(link).toBeVisible();
 await link.click();
 await expect(page).toHaveURL(/#explore\/resources$/);
 await expect(page.locator('.skills-panel')).toBeVisible();
});
