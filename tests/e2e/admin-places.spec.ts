import {randomUUID} from 'node:crypto';
import {test,expect,type Page} from './fixtures.js';
const labels={'guild-applications':'公會申請','community-certifications':'社群認證審核','author-claims':'作者認領審核','organizer-claims':'主辦認領','held-shares':'檢舉處理','store-admissions':'商店准入','tool-reports':'工具檢舉',events:'公開活動審核','review-center':'PR 審核'};
async function fixture(page:Page,missing=false){
 const adminId=randomUUID();const ids=Object.fromEntries(Object.keys(labels).map(key=>[key,randomUUID()]));const calls:{path:string;body:any;headers:Record<string,string>}[]=[];let resolved=false;
 const date=(n:number)=>`2026-01-${String(n).padStart(2,'0')}T00:00:00.000Z`;
 await page.route('**/admin/api/**',route=>{
  const request=route.request(),u=new URL(request.url()),path=u.pathname.replace('/admin/api','');
  if(request.method()==='POST'){calls.push({path,body:request.postDataJSON(),headers:request.headers()});resolved=true;return route.fulfill({json:{state:'verified',version:2}});}
  if(path==='/bootstrap')return route.fulfill({json:{admin:{admin_id:adminId,community_id:'same-community',email:'admin@example.test',display_name:'合成管理員',role:'super_admin'},csrf_token:'synthetic-csrf',community_certification_enabled:!missing,store_admissions_enabled:!missing,tool_reports_enabled:!missing,github_setup_enabled:!missing,available_skill_books:[],summary:{members:1,active_members:1,pending_guild_applications:1,guilds:1,admins:1}}});
  if(path==='/credentials')return route.fulfill({json:{items:[]}});
  if(path==='/guild-applications')return route.fulfill({json:{items:[{application_id:ids['guild-applications'],name:'申請物件',created_at:date(1)}],next_offset:null}});
  if(path==='/community-certifications')return route.fulfill({json:{items:[{user_id:ids['community-certifications'],display_name:'認證物件',submitted_at:date(2)}],next_offset:null}});
  if(path==='/author-claims')return route.fulfill({json:{items:[{claim_id:ids['author-claims'],repo:{full_name:'作者物件'},submitted_at:date(3)}]}});
  if(path==='/event-organizer-claims')return route.fulfill({json:{items:[{claim_id:ids['organizer-claims'],event_id:randomUUID(),statement:'主辦物件的合成來源說明。',evidence_url:'https://example.com/proof',state:resolved?'verified':'pending',version:resolved?2:1,created_at:date(4)}]}});
  if(path==='/shares/held')return route.fulfill({json:{items:[{share_id:ids['held-shares'],kind:'link',title:'檢舉物件',public_url:null,open_reports:1,reasons:['合成檢舉原因'],hidden_at:date(5)}]}});
  if(path==='/commerce/store-readiness')return route.fulfill({json:{items:[{instance_id:ids['store-admissions'],store:{name:'商店物件'},admission:{active:null},instance_status:'active',tenant_status:'active',admin_is_member:false,created_at:date(6)}],next_offset:null}});
  if(path==='/guild-tools')return route.fulfill({json:{items:[{id:ids['tool-reports'],title:'工具物件',state:'enabled',report_count:1,first_reported_at:date(7)}]}});
  if(path==='/events')return route.fulfill({json:{items:[{event_id:ids.events,title:'活動物件',created_at:date(8)}]}});
  if(path==='/review-center/pulls')return route.fulfill({json:{items:u.searchParams.get('queue')==='awaiting_review'?[{pull_id:ids['review-center'],title:'PR 物件',created_at:date(9)}]:[],next_offset:null}});
  return route.fulfill({json:{items:[]}});
 });return {ids,calls};
}
test('direct admin views open their requested screen without manage or object',async({page})=>{
 await fixture(page);
 for(const [view,heading] of [['members','會員管理'],['admins','管理員名單'],['guilds','公會管理'],['guild-applications','公會申請']] as const){
  await page.goto(`/admin?view=${view}`);await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
 }
});
test('inbox shows pending appointments and exposes history; guild detail keeps settings',async({page})=>{
 await fixture(page);await page.route('**/admin/api/bootstrap',route=>route.fulfill({json:{admin:{admin_id:'admin',community_id:'same-community',email:'admin@example.test',display_name:'合成管理員',role:'super_admin'},csrf_token:'synthetic-csrf',available_skill_books:[],pending_guild_appointments:[{guild_key:'guild_test',name:'合成公會',state:'pending',bound_user_id:null}],summary:{members:1,active_members:1,pending_guild_applications:1,guilds:1,admins:1}}}));
 await page.goto('/admin');await expect(page.getByRole('heading',{name:'我的公會長任命',exact:true})).toBeVisible();
 await page.getByText('紀錄與設定',{exact:true}).click();await expect(page.getByLabel('工作區',{exact:true})).toBeVisible();
 await page.goto('/admin?view=guilds&object=guild_test');await expect(page.getByText('公會設定',{exact:true})).toBeVisible();
});
test('member-report and achievement review queues are reachable in admin inbox',async({page})=>{
 await fixture(page);await page.route('**/api/v1/session',route=>route.fulfill({json:{user:{user_id:'00000000-0000-4000-8000-000000000001'},csrf_token:'member-csrf'}}));
 await page.route('**/api/v1/admin/reports?*',route=>route.fulfill({json:{items:[],next_cursor:null}}));
 await page.route('**/api/v1/me/social-achievements',route=>route.fulfill({json:{can_moderate:true}}));
 await page.route('**/api/v1/admin/social-achievements',route=>route.fulfill({json:{items:[],next_after:null}}));
 await page.goto('/admin');await expect(page.getByRole('button',{name:'平台檢舉案件',exact:true})).toBeVisible();
 await page.getByText('管理成就限制與申訴',{exact:true}).click();await page.getByRole('button',{name:'讀取待處理名單',exact:true}).click();
 await expect(page.getByRole('button',{name:'讀取待處理名單',exact:true})).toBeEnabled();
 await page.goto('/admin?view=member-reports');await expect(page.getByRole('heading',{name:'平台檢舉案件',exact:true})).toBeVisible();
 await page.goto('/admin?view=social-achievements');await expect(page.getByRole('button',{name:'讀取待處理名單',exact:true})).toBeVisible();
});
test('legacy admin queue paths retain their view and navigation after reload',async({page})=>{
 await fixture(page);await page.route('**/api/v1/session',route=>route.fulfill({json:{user:{user_id:'00000000-0000-4000-8000-000000000001'},csrf_token:'member-csrf'}}));
 await page.route('**/api/v1/admin/reports?*',route=>route.fulfill({json:{items:[],next_cursor:null}}));
 await page.route('**/api/v1/me/social-achievements',route=>route.fulfill({json:{can_moderate:true}}));
 await page.route('**/api/v1/admin/social-achievements',route=>route.fulfill({json:{items:[],next_after:null}}));
 for(const [path,role,control] of [['/admin/reports','heading','平台檢舉案件'],['/admin/social-achievements','button','讀取待處理名單']] as const){
  await page.goto(path);await expect(page.getByRole(role,{name:control,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回待處理',exact:true}).click();await expect(page).toHaveURL(/\/admin\?view=inbox$/);
  await page.reload();await expect(page.getByRole('heading',{name:'待處理',exact:true})).toBeVisible();
 }
});
test('achievement review keeps an uncertain operation when switching admin places',async({page})=>{
 await fixture(page);const id='00000000-0000-4000-8000-000000000002',row={user_id:id,display_name:'合成審核會員',status:'paused',moderation_reason:null,appeal:'請再核對',appeal_state:'pending',aggregate_version:'1'};const attempts:{body:string|null;key:string|undefined;version:string|undefined}[]=[];
 // Background feeds are unavailable to this synthetic member session; avoid a real 401 clearing its CSRF token.
 for(const path of ['/me/notifications','/me/guild-announcements','/co-creation/projects','/events/bulletins','/community/accepted-work'])await page.route(`**/api/v1${path}*`,route=>route.fulfill({status:403,json:{code:'forbidden'}}));
 await page.route('**/api/v1/session',route=>route.fulfill({json:{user:{user_id:'00000000-0000-4000-8000-000000000001'},csrf_token:'member-csrf'}}));
 await page.route('**/api/v1/me/social-achievements',route=>route.fulfill({json:{can_moderate:true}}));
 await page.route('**/api/v1/admin/reports?*',route=>route.fulfill({json:{items:[],next_cursor:null}}));
 await page.route('**/api/v1/admin/social-achievements',route=>route.fulfill({json:{items:[row],next_after:null}}));
 await page.route('**/api/v1/admin/social-achievements/*',route=>{if(route.request().method()==='GET')return route.fulfill({json:row});const request=route.request();attempts.push({body:request.postData(),key:request.headers()['idempotency-key'],version:request.headers()['if-match']});return attempts.length===1?route.abort('failed'):route.fulfill({json:{updated:true}});});
 await page.goto('/admin?view=social-achievements');await page.getByRole('button',{name:'讀取待處理名單',exact:true}).click();await page.getByRole('button',{name:'合成審核會員 · paused · pending',exact:true}).click();
 await page.getByLabel('具體理由',{exact:true}).fill('已核對申訴');await page.getByRole('button',{name:'保存處理',exact:true}).click();await expect(page.getByRole('button',{name:'重試原處理',exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'平台管理選單'}).getByRole('button',{name:'人員與公會',exact:true}).click();await expect(page.getByRole('alert')).toContainText('請先確認尚未完成的審核結果');await expect(page).toHaveURL(/view=social-achievements/);
 await page.getByRole('button',{name:'重試原處理',exact:true}).click();await expect(page.getByText('處理已保存，請重新讀取案件。',{exact:true})).toBeVisible();expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);expect(attempts[0].key).toBeTruthy();
});
test('admin access alone does not reveal member-only moderation queues',async({page})=>{
 await fixture(page);await page.route('**/api/v1/session',route=>route.fulfill({json:{user:{user_id:'00000000-0000-4000-8000-000000000001'},csrf_token:'member-csrf'}}));
 await page.route('**/api/v1/admin/reports?*',route=>route.fulfill({status:403,json:{code:'admin_required'}}));
 await page.route('**/api/v1/me/social-achievements',route=>route.fulfill({json:{can_moderate:false}}));
 await page.goto('/admin');await expect(page.getByRole('heading',{name:'待處理',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'平台檢舉案件',exact:true})).toHaveCount(0);
 await expect(page.getByText('管理成就限制與申訴',{exact:true})).toHaveCount(0);
});
test('one oldest-first list includes every available kind and a filter opens one organizer decision',async({page})=>{
 const {ids,calls}=await fixture(page);await page.goto('/admin');const list=page.locator('.admin-place-list');await expect(list.getByRole('button')).toHaveCount(9);
 await expect(list.locator('strong')).toHaveText(['申請物件','認證物件','作者物件','主辦物件的合成來源說明。','檢舉物件','商店物件','工具物件','活動物件','PR 物件']);
 await page.getByLabel('種類',{exact:true}).selectOption('organizer-claims');await expect(list.getByRole('button')).toHaveCount(1);await list.getByRole('button').click();await expect(page).toHaveURL(new RegExp(`object=${ids['organizer-claims']}`));
 await expect(page.getByText('核實只記錄署名與貢獻，不移轉活動所有權。')).toBeVisible();await expect(page.getByRole('button',{name:'確認',exact:true})).toBeDisabled();await page.getByLabel('審核理由',{exact:true}).fill('來源佐證已核對');await page.getByRole('button',{name:'確認',exact:true}).click();
 await expect.poll(()=>calls.length).toBe(1);expect(calls[0].body).toEqual({decision:'verify',reason:'來源佐證已核對'});expect(calls[0].headers['if-match']).toBe('"1"');expect(calls[0].headers['x-admin-csrf']).toBe('synthetic-csrf');expect(calls[0].headers['idempotency-key']).toBeTruthy();
});
test('organizer rejection uses the same reason and version protected API',async({page})=>{
 const {calls}=await fixture(page);await page.goto('/admin?view=organizer-claims');await page.getByLabel('決定',{exact:true}).selectOption('reject');await page.getByLabel('審核理由',{exact:true}).fill('佐證不足，駁回申請');await page.getByRole('button',{name:'確認',exact:true}).click();await expect.poll(()=>calls.length).toBe(1);expect(calls[0].body.decision).toBe('reject');
});
test('capabilities and absent endpoints hide unavailable kinds and GitHub setup',async({page})=>{
 await fixture(page,true);await page.route('**/admin/api/author-claims?*',route=>route.fulfill({status:404,json:{detail:'not found'}}));await page.goto('/admin');await expect(page.locator('.admin-place-list button')).toHaveCount(5);
 for(const kind of ['store-admissions','community-certifications','tool-reports','author-claims'])await expect(page.getByLabel('種類',{exact:true}).locator(`option[value="${kind}"]`)).toHaveCount(0);
 await page.getByRole('button',{name:'系統',exact:true}).click();await expect(page.getByLabel('系統項目').locator('option[value="github"]')).toHaveCount(0);await expect(page.locator('.admin-summary-strip')).toHaveCount(0);
});
for(const key of [...Object.keys(labels),'members','admins','guilds','guild-workspace','github','audit','errors','credentials'])test(`old view ${key} lands in its matching place`,async({page})=>{
 await fixture(page);await page.goto(`/admin?view=${key}`);const place=key in labels?'待處理':['members','admins','guilds','guild-workspace'].includes(key)?'人員與公會':'系統';await expect(page.getByRole('navigation',{name:'平台管理選單'}).getByRole('button',{name:place,exact:true})).toHaveAttribute('aria-current','page');
 if(place==='系統')await expect(page.getByLabel('系統項目')).toHaveValue(key);else await expect(page.getByRole('button',{name:`返回${place}`,exact:true})).toBeVisible();
});
test('the mobile first screen has at most eight controls and fits the viewport',async({page},testInfo)=>{
 await fixture(page);await page.setViewportSize({width:390,height:844});await page.goto('/admin');await expect(page.locator('.admin-place-list button')).toHaveCount(3);
 const controls=await page.evaluate(()=>[...document.querySelectorAll<HTMLElement>('button,input,select,textarea,a,summary')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('dialog:not([open]),details:not([open]) > :not(summary)');}).map(el=>el.textContent?.trim()||el.getAttribute('aria-label')));expect(controls.length,JSON.stringify(controls)).toBeLessThanOrEqual(8);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('admin-places-mobile.png')});
 await page.route('**/admin/api/credentials',route=>route.fulfill({json:{items:[{credential_key:'github_metrics_token',label:'GitHub 讀取權杖',level:'expired',days_left:-1,status:'expired',expires_at:null,checked_at:null,renewable:false,open_request:null,last_request:null,renew_hint:''}]}}));await page.reload();await expect(page.locator('.admin-place-list button')).toHaveCount(2);await expect(page.getByRole('link',{name:'GitHub 讀取權杖 已過期'})).toHaveAttribute('href','/admin?view=credentials&object=github_metrics_token');
 expect(await page.evaluate(()=>[...document.querySelectorAll<HTMLElement>('button,input,select,textarea,a,summary')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&getComputedStyle(el).visibility!=='hidden'&&!el.closest('dialog:not([open]),details:not([open]) > :not(summary)');}).length)).toBeLessThanOrEqual(8);

});
test('people search covers members, guilds and skill books and opens a single member with separate authority controls',async({page})=>{
 await fixture(page);const id=randomUUID();
 await page.route('**/admin/api/members?*',route=>route.fulfill({json:{items:[{user_id:id,display_name:'合成搜尋會員',email:'member@example.test',active:true,is_test_account:false,onboarding_required:false,onboarding_completed_at:null,aggregate_version:1,guilds:[]}],next_offset:null}}));
 await page.route('**/admin/api/guilds',route=>route.fulfill({json:{items:[{guild_key:'guild_games',name:'合成搜尋公會'}]}}));
 await page.route('**/admin/api/skill-maintainers',route=>route.fulfill({json:{items:[{book_id:randomUUID(),title:'合成搜尋技能書'}]}}));
 await page.goto('/admin?view=people');await page.getByRole('searchbox',{name:'搜尋',exact:true}).fill('合成搜尋');await page.getByRole('button',{name:'搜尋',exact:true}).click();
 await expect(page.locator('.admin-place-list strong')).toHaveText(['合成搜尋會員','合成搜尋公會','合成搜尋技能書']);await page.locator('.admin-place-list button').first().click();await expect(page).toHaveURL(new RegExp(`view=members&object=${id}`));await expect(page.locator('.admin-member-row')).toHaveCount(1);await page.getByText('管理操作',{exact:true}).click();await expect(page.getByRole('region',{name:'平台權限',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'會員資格',exact:true})).toBeVisible();
});
test('the inbox follows every source page and a deep link finds an organizer beyond page one',async({page})=>{
 await fixture(page);const id=randomUUID();
 await page.route('**/admin/api/event-organizer-claims?*',route=>{const offset=Number(new URL(route.request().url()).searchParams.get('offset'));return route.fulfill({json:{items:offset?[{claim_id:id,event_id:randomUUID(),statement:'第二頁合成主辦來源說明。',evidence_url:'https://example.com/proof',state:'pending',version:1,created_at:'2025-01-01T00:00:00Z'}]:[],next_offset:offset?null:100}});});
 await page.goto('/admin');await expect(page.locator('.admin-place-list strong').first()).toHaveText('第二頁合成主辦來源說明。');await page.locator('.admin-place-list button').first().click();await expect(page.getByText('第二頁合成主辦來源說明。',{exact:true})).toBeVisible();await expect(page.getByLabel('決定',{exact:true})).toBeVisible();
});
test('a missing GitHub endpoint hides setup even when the capability was advertised',async({page})=>{
 await fixture(page);await page.route('**/admin/api/github-app',route=>route.fulfill({status:404,json:{detail:'not found'}}));await page.goto('/admin?view=system');await expect(page.getByLabel('系統項目')).toBeVisible();await expect(page.getByLabel('系統項目').locator('option[value="github"]')).toHaveCount(0);
});
test('UX-G-03: people workspaces are directly reachable on mobile with 44px summaries and open inbox items',async({page})=>{
 await fixture(page);await page.setViewportSize({width:390,height:844});
 await page.goto('/admin');await expect(page.locator('.admin-place-list button').first()).toBeVisible();
 expect((await page.getByText('紀錄與設定',{exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await page.goto('/admin?view=people');
 expect((await page.getByText('管理設定',{exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
 for(const label of ['會員管理','管理員名單','公會管理','技能書維護者']){
  const button=page.getByRole('button',{name:label,exact:true});
  await expect(button).toBeVisible();expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 }
 await page.getByRole('button',{name:'會員管理',exact:true}).click();
 await expect(page.getByRole('heading',{name:'會員管理',exact:true})).toBeVisible();
});
test('UX-G-04: view=system opens its first section with credentials and account inside admin-content',async({page})=>{
 await fixture(page);
 await page.goto('/admin');await expect(page.locator('.admin-account')).toBeHidden();
 await page.goto('/admin?view=system');
 const select=page.getByLabel('系統項目',{exact:true});
 await expect(select).toHaveValue('credentials');
 await expect(select.locator('option[value=""]')).toHaveCount(0);
 await expect(page.locator('footer.admin-system-details')).toHaveCount(0);
 const content=page.locator('.admin-content');
 await expect(content.locator('#admin-credentials')).toBeVisible();
 await expect(content.locator('#admin-credentials')).toHaveAttribute('open','');
 await expect(content.locator('.admin-account')).toBeVisible();
});
test('UX-G-09: people shows 5 rows and guilds shows 20 rows with 更多, and guild row actions stay behind 管理',async({page})=>{
 await fixture(page);
 const members=Array.from({length:4},(_,index)=>({user_id:randomUUID(),display_name:`合成會員 ${index+1}`,email:`member-${index+1}@example.test`,active:true,is_test_account:false,onboarding_required:false,onboarding_completed_at:null,aggregate_version:1,guilds:[]}));
 const makeGuilds=(count:number)=>Array.from({length:count},(_,index)=>({guild_key:`guild_${index+1}`,name:`合成公會 ${index+1}`,purpose:`合成宗旨 ${index+1}`,guild_master:null,officer_version:null,guild_experts:[]}));
 await page.route('**/admin/api/members?*',route=>route.fulfill({json:{items:members,next_offset:null}}));
 await page.route('**/admin/api/guilds',route=>route.fulfill({json:{items:makeGuilds(3)}}));
 await page.setViewportSize({width:390,height:844});
 await page.goto('/admin?view=people');
 await expect(page.locator('.admin-place-list button')).toHaveCount(5);
 const peopleMore=page.getByRole('button',{name:'更多',exact:true});
 await expect(peopleMore).toBeVisible();
 expect((await peopleMore.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await peopleMore.click();
 await expect(page.locator('.admin-place-list button')).toHaveCount(7);
 await expect(peopleMore).toHaveCount(0);
 await page.route('**/admin/api/guilds',route=>route.fulfill({json:{items:makeGuilds(22)}}));
 await page.goto('/admin?view=guilds');
 await expect(page.locator('.admin-guild-card')).toHaveCount(20);
 expect((await page.getByText('公會設定',{exact:true}).boundingBox())!.height).toBeGreaterThanOrEqual(44);
 const firstCard=page.locator('.admin-guild-card').first();
 await expect(firstCard.getByRole('button',{name:'編輯名稱與別名',exact:true})).toBeHidden();
 await expect(firstCard.getByRole('button',{name:'設定公會長',exact:true})).toBeHidden();
 await expect(firstCard.getByRole('button',{name:'新增公會專家',exact:true})).toBeHidden();
 const manage=firstCard.locator('summary',{hasText:'管理'});
 await expect(manage).toBeVisible();
 expect((await manage.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await manage.click();
 await expect(firstCard.getByRole('button',{name:'編輯名稱與別名',exact:true})).toBeVisible();
 await expect(firstCard.getByRole('button',{name:'設定公會長',exact:true})).toBeVisible();
 await expect(firstCard.getByRole('button',{name:'新增公會專家',exact:true})).toBeVisible();
 const guildsMore=page.getByRole('button',{name:'更多',exact:true});
 await expect(guildsMore).toBeVisible();
 expect((await guildsMore.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await guildsMore.click();
 await expect(page.locator('.admin-guild-card')).toHaveCount(22);
 await expect(guildsMore).toHaveCount(0);
});
test('UX-G-10: errors view groups repeated entries, translates error codes, caps at 20, and hides raw details in details',async({page})=>{
 await fixture(page);
 const uid1='20000000-0000-4000-8000-000000000001',uid2='20000000-0000-4000-8000-000000000002';
 const items=[
  {error_id:'e1',user_id:uid1,display_name:'合成甲',action:'GET /events',error_code:'network_error',http_status:0,created_at:'2026-02-01T10:03:00.000Z'},
  {error_id:'e2',user_id:uid2,display_name:'合成乙',action:'GET /events',error_code:'network_error',http_status:0,created_at:'2026-02-01T10:02:00.000Z'},
  {error_id:'e3',user_id:uid1,display_name:'合成甲',action:'GET /events',error_code:'network_error',http_status:0,created_at:'2026-02-01T10:01:00.000Z'},
  {error_id:'e4',user_id:uid1,display_name:'合成甲',action:'GET /profile',error_code:'profile_not_found',http_status:404,created_at:'2026-02-01T09:50:00.000Z'},
  {error_id:'e5',user_id:uid1,display_name:'合成甲',action:'POST /opensource/projects',error_code:'github_repository_unavailable',http_status:502,created_at:'2026-02-01T09:40:00.000Z'},
  {error_id:'e6',user_id:uid1,display_name:'合成甲',action:'GET /members',error_code:'not_found',http_status:404,created_at:'2026-02-01T09:30:00.000Z'},
  ...Array.from({length:18},(_,i)=>({error_id:`ex-${i}`,user_id:uid2,display_name:'合成乙',action:`GET /items/${i}`,error_code:'not_found',http_status:404,created_at:`2026-02-01T08:${String(59-i).padStart(2,'0')}:00.000Z`}))
 ];
 await page.route('**/admin/api/client-errors',route=>route.fulfill({json:{items}}));
 await page.setViewportSize({width:390,height:844});
 await page.goto('/admin?view=errors');
 await expect(page.getByRole('heading',{name:'系統錯誤日誌',exact:true})).toBeVisible();
 const cards=page.locator('.admin-content article.card');
 await expect(cards).toHaveCount(20);
 await expect(page.locator('.admin-content .btn-primary')).toHaveCount(0);
 const first=cards.first();
 await expect(first).toContainText('網路連線異常');
 await expect(first).toContainText('3 次');
 await expect(cards.nth(1)).toContainText('找不到個人檔案');
 await expect(cards.nth(2)).toContainText('GitHub 儲存庫無法存取');
 await expect(cards.nth(3)).toContainText('找不到資料');
 for(const raw of ['GET /events','network_error','profile_not_found','github_repository_unavailable','not_found','HTTP 0',uid1]){
  expect(await page.locator('.admin-content').innerText()).not.toContain(raw);
 }
 const detailSummary=first.locator('summary',{hasText:'技術詳情'});
 await expect(detailSummary).toBeVisible();
 expect((await detailSummary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await detailSummary.click();
 await expect(first).toContainText('GET /events');
 await expect(first).toContainText('network_error');
 await expect(first).toContainText('HTTP 0');
 await expect(first).toContainText(uid1);
 const more=page.getByRole('button',{name:'更多',exact:true});
 await expect(more).toBeVisible();
 await more.click();
 await expect(cards).toHaveCount(22);
 await expect(more).toHaveCount(0);
});
test('UX-G-11: store-admissions removes English tags and hides preamble, receipt note, and provider profile behind 准入與收據說明',async({page})=>{
 await fixture(page);
 await page.route('**/admin/api/commerce/store-readiness*',route=>route.fulfill({json:{environment:'sandbox',checked_at:'2026-02-01T00:00:00.000Z',release_sha:'abc1234',platform:{checkout_enabled:true,quarantine:false,provider_profiles:['ecpay.aio.credit.v1']},summary:{stores:0,active_admissions:0,accepting_orders:0},items:[],next_offset:null}}));
 await page.setViewportSize({width:390,height:844});
 await page.goto('/admin?view=store-admissions&manage=1');
 await expect(page.getByRole('heading',{name:'商店准入',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'測試環境',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'下載範圍收據',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'下載範圍收據（JSON）',exact:true})).toHaveCount(0);
 const visible=await page.locator('.admin-content').innerText();
 for(const hidden of ['sandbox','live','JSON','ecpay.aio.credit.v1','abc1234','准入是開放接單的最後一項條件','收據含租戶與商店名稱']){
  expect(visible).not.toContain(hidden);
 }
 const guide=page.locator('summary',{hasText:'准入與收據說明'});
 await expect(guide).toBeVisible();
 expect((await guide.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await guide.click();
 await expect(page.locator('.admin-content')).toContainText('准入是開放接單的最後一項條件');
 await expect(page.locator('.admin-content')).toContainText('收據含租戶與商店名稱');
 await expect(page.locator('.admin-content')).toContainText('ecpay.aio.credit.v1');
});
test('UX-G-13: members view uses Chinese placeholder, 44px test-toggle label, and filters only via 顯示測試資料',async({page})=>{
 await fixture(page);
 const requests:string[]=[];
 await page.route('**/admin/api/members?*',route=>{
  requests.push(new URL(route.request().url()).search);
  return route.fulfill({json:{items:[{user_id:randomUUID(),display_name:'合成會員',email:'fresh-synthetic@example.com',active:true,is_test_account:false,onboarding_required:false,onboarding_completed_at:null,aggregate_version:1,guilds:[]}],next_offset:null}});
 });
 await page.setViewportSize({width:390,height:844});
 await page.goto('/admin?view=members&manage=1');
 await expect(page.getByRole('heading',{name:'會員管理',exact:true})).toBeVisible();
 await expect(page.getByPlaceholder('暱稱或電子信箱')).toBeVisible();
 await expect(page.getByText('fresh-synthetic@example.com')).toBeVisible();
 const toggleLabel=page.locator('.admin-test-toggle');
 expect((await toggleLabel.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 expect(requests.at(-1)).toContain('include_test=false');
 await page.getByRole('checkbox',{name:'顯示測試資料'}).check();
 await expect.poll(()=>requests.at(-1)).toContain('include_test=true');
});
test('UX-G-14 / UX-F-11: pending views conditionally mount guild-applications, move preambles behind 說明, style author-claim tabs with aria-pressed, size held link >=44px, and expose h2 工具檢舉',async({page})=>{
 await fixture(page);
 await page.route('**/admin/api/shares/held?*',route=>route.fulfill({json:{items:[{share_id:randomUUID(),kind:'event',title:'待處理檢舉測試活動',public_url:'https://example.test/e',open_reports:1,reasons:['合成檢舉原因'],hidden_at:'2026-02-01T00:00:00.000Z'}]}}));
 await page.route('**/admin/api/author-claims?*',route=>route.fulfill({json:{queue:'review',items:[],identity_changes:[]}}));
 await page.route('**/admin/api/guild-applications?*',route=>route.fulfill({json:{items:[],next_offset:null}}));
 await page.route('**/admin/api/events?*',route=>route.fulfill({json:{items:[]}}));
 await page.route('**/admin/api/guild-tools?*',route=>route.fulfill({json:{items:[],next_offset:null}}));
 await page.setViewportSize({width:390,height:844});

 await page.goto('/admin?view=held-shares&manage=1');
 await expect(page.locator('.admin-content h2').first()).toHaveText('檢舉處理');
 const heldLink=page.getByRole('link',{name:'待處理檢舉測試活動'});
 await expect(heldLink).toBeVisible();
 expect((await heldLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);

 await page.goto('/admin?view=guild-applications&manage=1');
 await expect(page.getByRole('heading',{name:'公會申請',exact:true})).toBeVisible();
 expect(await page.locator('.admin-content').innerText()).not.toContain('先處理待審申請');
 await page.locator('.admin-content summary',{hasText:'說明'}).click();
 await expect(page.locator('.admin-content')).toContainText('先處理待審申請');

 await page.goto('/admin?view=events&manage=1');
 await expect(page.getByRole('heading',{name:'公開活動審核',exact:true})).toBeVisible();
 expect(await page.locator('.admin-content').innerText()).not.toContain('所有會員都能提交');
 await page.locator('.admin-content summary',{hasText:'說明'}).click();
 await expect(page.locator('.admin-content')).toContainText('所有會員都能提交');

 await page.goto('/admin?view=author-claims&manage=1');
 await expect(page.getByRole('heading',{name:'作者認領審核',exact:true})).toBeVisible();
 expect(await page.locator('.admin-content').innerText()).not.toContain('平台管理員審核原作者');
 await expect(page.locator('.admin-content .btn-primary')).toHaveCount(0);
 const pendingTab=page.getByRole('button',{name:'待審核',exact:true});
 const verifiedTab=page.getByRole('button',{name:'已核實',exact:true});
 await expect(pendingTab).toHaveAttribute('aria-pressed','true');
 await expect(verifiedTab).toHaveAttribute('aria-pressed','false');
 await page.locator('.admin-content summary',{hasText:'說明'}).click();
 await expect(page.locator('.admin-content')).toContainText('平台管理員審核原作者');

 await page.goto('/admin?view=tool-reports&manage=1');
 await expect(page.getByRole('heading',{name:'工具檢舉',level:2,exact:true})).toBeVisible();
 await expect(page.locator('.admin-content details summary',{hasText:'工具檢舉'})).toHaveCount(0);
});
test('UX-G-15: mobile admin navigation dialog traps Tab/Shift+Tab focus cleanly and keeps 44px close button',async({page})=>{
 await fixture(page);
 await page.setViewportSize({width:390,height:844});
 await page.goto('/admin?view=inbox');
 const trigger=page.getByRole('button',{name:'開啟管理選單',exact:true});
 await trigger.click();
 const dialog=page.getByRole('dialog',{name:'切換管理功能',exact:true});
 await expect(dialog).toBeVisible();
 const closeBtn=dialog.getByRole('button',{name:'關閉管理選單',exact:true});
 const lastLink=dialog.getByRole('link',{name:'返回自由工坊',exact:true});
 await expect(closeBtn).toBeFocused();
 const closeBox=(await closeBtn.boundingBox())!;
 expect(closeBox.width).toBeGreaterThanOrEqual(44);
 expect(closeBox.height).toBeGreaterThanOrEqual(44);
 await page.keyboard.press('Shift+Tab');
 await expect(lastLink).toBeFocused();
 await page.keyboard.press('Tab');
 await expect(closeBtn).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(dialog).toBeHidden();
 await expect(trigger).toBeFocused();
});
