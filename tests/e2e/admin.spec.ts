import {test,expect,type Page,type Route} from './fixtures.js';
import {openFeatureSearch} from './navigation.js';

// The real-database admin test creates fp_admin_browser_*. A timed-out body never reaches its finally.
async function workspaceFixture(page:Page,onStatus?:(route:Route)=>Promise<void>){
  await page.setViewportSize({width:1280,height:900});
  let owner='synthetic-admin-a';
  const requests:{path:string;state:string|null;query:string|null;includeTest:string|null;method:string}[]=[];
  const pending={application_id:'00000000-0000-4000-8000-000000000071',name:'合成待審公會',profession:'協作測試',reason:'合成申請內容，僅供隔離測試',state:'pending',applicant_name:'合成申請人',applicant_email:'applicant@example.test',aggregate_version:1};
  await page.route('**/admin/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname.replace('/admin/api','');requests.push({path,state:url.searchParams.get('state'),query:url.searchParams.get('q'),includeTest:url.searchParams.get('include_test'),method:route.request().method()});
    if(route.request().method()==='POST'&&path.endsWith('/status')&&onStatus)return onStatus(route);
    if(path==='/bootstrap')return route.fulfill({json:{admin:{admin_id:owner,community_id:'synthetic-community',email:`${owner}@example.test`,display_name:'合成管理員',role:'super_admin'},csrf_token:'synthetic-csrf',summary:{members:42,active_members:40,pending_guild_applications:1,guilds:18,admins:2},available_skill_books:[{id:'synthetic-book',title:'合成入門技能書'}],pending_guild_appointments:[]}});
    if(path==='/credentials')return route.fulfill({json:{items:['github_metrics_token','cloudflare_deploy_token'].map((key,index)=>({credential_key:key,label:index?'Cloudflare 部署權杖':'GitHub 讀取權杖',status:'ok',level:'ok',expires_at:'2027-10-01T00:00:00Z',days_left:340,checked_at:'2026-10-18T00:00:00Z',renewable:Boolean(index),open_request:null,last_request:null,renew_hint:'合成狀態'}))}});
    if(path==='/guild-applications')return route.fulfill({json:{items:owner==='synthetic-admin-a'?(url.searchParams.get('state')==='pending'?[pending]:url.searchParams.get('state')==='approved'?[{...pending,application_id:'00000000-0000-4000-8000-000000000072',name:'合成歷史公會',state:'approved',review_reason:'合成已完成審核'}]:[]):[],next_offset:null}});
    if(path==='/members')return route.fulfill({json:{items:[{user_id:'00000000-0000-4000-8000-000000000073',email:'member@example.test',display_name:'合成會員',active:true,onboarding_required:false,onboarding_completed_at:null,aggregate_version:1,guilds:[]}],next_offset:null}});
    return route.fulfill({json:{items:[]}});
  });
  return {requests,changeOwner:()=>{owner='synthetic-admin-b';}};
}

let dropAdminBrowserSchema:(()=>Promise<void>)|undefined;

test('admin mobile navigation is searchable, returns focus on Escape and supports browser history',async({page},testInfo)=>{
  const fixture=await workspaceFixture(page);await page.setViewportSize({width:390,height:844});
  await page.goto('/admin?view=guild-applications');
  await expect(page.getByRole('heading',{name:'公會申請',exact:true})).toBeVisible();await expect(page.locator('.admin-content')).toHaveAttribute('aria-busy','false');
  expect(fixture.requests.find(request=>request.path==='/guild-applications')?.state).toBe('pending');
  await expect(page.locator('#admin-credentials')).not.toHaveAttribute('open','');
  expect((await page.getByRole('heading',{name:'公會申請',exact:true}).boundingBox())!.y).toBeLessThan(500);
  await expect(page.getByRole('textbox',{name:'公會宗旨',exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('admin-mobile-pending.png'),fullPage:true});
  for(const [width,height] of [[320,720],[768,1024],[1440,900]]){
    await page.setViewportSize({width,height});await expect(page.getByRole('heading',{name:'公會申請',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px workspace overflow`).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`admin-pending-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  const trigger=page.getByRole('button',{name:'開啟管理選單',exact:true});await trigger.click();
  const dialog=page.getByRole('dialog',{name:'切換管理功能',exact:true});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'關閉管理選單',exact:true})).toBeFocused();await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
  await trigger.click();await dialog.getByRole('searchbox',{name:'搜尋管理功能',exact:true}).fill('操作');
  await expect(dialog.getByRole('button',{name:'會員管理',exact:true})).toHaveCount(0);await dialog.getByRole('button',{name:'操作紀錄',exact:true}).click();
  await expect(page).toHaveURL(/view=audit/);await expect(page.locator('.admin-content')).toBeFocused();await page.goBack();
  await expect(page.getByRole('heading',{name:'公會申請',exact:true})).toBeVisible();await expect(dialog).not.toBeVisible();
  await trigger.click();await dialog.getByRole('button',{name:'系統憑證',exact:true}).click();
  await expect(page.locator('#admin-credentials')).toHaveAttribute('open','');await expect(page.getByRole('heading',{name:'憑證到期',exact:true})).toBeInViewport();await expect(dialog).not.toBeVisible();
  expect(fixture.requests.filter(request=>request.method==='POST')).toHaveLength(0);
});

test('admin application filters use server states and preserve an unfinished review across workspace switches',async({page})=>{
  const fixture=await workspaceFixture(page);await page.goto('/admin?view=guild-applications');
  const row=page.locator('.admin-application-card');await row.getByText('開始審核',{exact:true}).click();
  await page.getByRole('textbox',{name:'公會宗旨',exact:true}).fill('尚未送出的合成審核草稿');
  await page.getByRole('textbox',{name:'審核說明',exact:true}).fill('先保存於目前頁面，稍後繼續');
  await page.getByRole('button',{name:'會員管理',exact:true}).click();await expect(page.getByRole('heading',{name:'會員管理',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'公會申請',exact:true}).click();await expect(page.locator('.admin-content')).toHaveAttribute('aria-busy','false');
  await expect(page.getByRole('textbox',{name:'公會宗旨',exact:true})).toHaveValue('尚未送出的合成審核草稿');
  await expect(page.getByRole('textbox',{name:'審核說明',exact:true})).toHaveValue('先保存於目前頁面，稍後繼續');
  await page.getByRole('group',{name:'公會申請篩選'}).getByRole('button',{name:'已核准',exact:true}).click();
  await expect(page.getByRole('heading',{name:'合成歷史公會',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'合成待審公會',exact:true})).toHaveCount(0);
  await row.getByText('查看申請與審核紀錄',{exact:true}).click();await expect(row).toContainText('合成已完成審核');
  expect(fixture.requests.filter(request=>request.path==='/guild-applications').map(request=>request.state)).toEqual(['pending','pending','approved']);
  expect(fixture.requests.filter(request=>request.method==='POST')).toHaveLength(0);
});

test('admin change of verified principal discards earlier private rows and unfinished review fields',async({page})=>{
  const fixture=await workspaceFixture(page);await page.goto('/admin');
  await page.getByRole('textbox',{name:'搜尋會員',exact:true}).fill('private-owner-a@example.test');await page.getByRole('button',{name:'搜尋',exact:true}).click();
  await expect.poll(()=>fixture.requests.filter(request=>request.path==='/members').at(-1)?.query).toBe('private-owner-a@example.test');await page.getByRole('checkbox',{name:'顯示測試資料'}).check();
  await page.getByRole('button',{name:'公會申請',exact:true}).click();await page.getByText('開始審核',{exact:true}).click();
  await page.getByRole('textbox',{name:'公會宗旨',exact:true}).fill('先前管理身分的私人草稿');
  fixture.changeOwner();await page.locator('.admin-account > summary').click();await page.getByRole('button',{name:'重新確認管理身分',exact:true}).click();
  await expect(page.getByText('待審申請已處理完畢',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'合成待審公會',exact:true})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'公會宗旨',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'會員管理',exact:true}).click();await expect(page.getByRole('textbox',{name:'搜尋會員',exact:true})).toHaveValue('');await expect(page.getByRole('checkbox',{name:'顯示測試資料'})).not.toBeChecked();
  await expect.poll(()=>fixture.requests.filter(request=>request.path==='/members').at(-1)?.query).toBe('');expect(fixture.requests.filter(request=>request.path==='/members').at(-1)?.includeTest).toBe('false');
});

test('a delayed member command refreshes the current workspace and cannot restore the previous member view',async({page})=>{
  let finish!:()=>void;const delayed=new Promise<void>(resolve=>{finish=resolve;});
  const fixture=await workspaceFixture(page,async route=>{await delayed;await route.fulfill({json:{saved:true}});});
  await page.goto('/admin');await page.getByText('管理操作',{exact:true}).click();await page.getByRole('button',{name:'停用這位會員',exact:true}).click();
  await page.getByRole('textbox',{name:'操作理由',exact:true}).fill('合成操作，驗證延遲結果仍留在目前工作區');await page.getByRole('button',{name:'確認停用這位會員',exact:true}).click();
  await expect.poll(()=>fixture.requests.some(request=>request.method==='POST')).toBe(true);await page.getByRole('button',{name:'公會申請',exact:true}).click();
  await expect(page.getByRole('heading',{name:'合成待審公會',exact:true})).toBeVisible();finish();
  await expect(page.getByText('管理操作已保存，並留下操作紀錄。',{exact:true})).toBeVisible();await expect(page).toHaveURL(/view=guild-applications/);
  expect(fixture.requests.filter(request=>request.path==='/members')).toHaveLength(1);await expect(page.getByRole('heading',{name:'會員管理',exact:true})).toHaveCount(0);
});

test('an optional admin module load failure leaves navigation and the member workspace usable',async({page})=>{
  await workspaceFixture(page);await page.route(/\/assets\/AdminGuildManagement-[^/]+\.js$/,route=>route.abort('failed'));
  await page.goto('/admin');await page.getByRole('button',{name:'公會管理',exact:true}).click();await expect(page.locator('.admin-content').getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'會員管理',exact:true}).click();await expect(page.getByRole('heading',{name:'會員管理',exact:true})).toBeVisible();await expect(page.getByText('合成會員',{exact:true})).toBeVisible();
});
test.afterEach(async()=>{const drop=dropAdminBrowserSchema;dropAdminBrowserSchema=undefined;if(drop)await drop();});

test('admin entry never grants access through a member login or onboarding',async({page})=>{
  await page.goto('/admin');
  await expect(page.getByRole('heading',{name:'需要管理員驗證',exact:true})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'平台管理選單'})).toHaveCount(0);
  await expect(page.getByLabel('電子郵件',{exact:true})).toHaveCount(0);
  const anonymous=await page.request.get('/admin/api/bootstrap');expect([401,403,503]).toContain(anonymous.status());
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.locator('.shell')).toBeVisible();
  await openFeatureSearch(page);
  await page.getByRole('navigation',{name:'主要工作區'}).locator('details > summary').filter({hasText:/^管理/}).click();
  await page.getByRole('link',{name:/^平台管理/}).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading',{name:'需要管理員驗證',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'會員管理',exact:true})).toHaveCount(0);
});

test('admin member toggle reveals classified test accounts without changing summary totals',async({page})=>{
 const queries:string[]=[];
 await page.route('**/admin/api/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/bootstrap'))return route.fulfill({json:{admin:{admin_id:'fixture-admin',community_id:'fixture-community',email:'admin@example.test',display_name:'管理員',role:'super_admin'},csrf_token:'fixture-csrf',summary:{members:1,active_members:1,pending_guild_applications:0,guilds:1,admins:1},available_skill_books:[],pending_guild_appointments:[]}});
  if(url.pathname.endsWith('/members')){
   queries.push(url.searchParams.get('include_test')??'');
   return route.fulfill({json:{items:url.searchParams.get('include_test')==='true'?[{user_id:'fixture-test',email:'verifier@example.invalid',display_name:'Synthetic verifier',active:false,is_test_account:true,onboarding_required:false,onboarding_completed_at:null,aggregate_version:1,guilds:[]}]:[],next_offset:null}});
  }
  return route.fulfill({json:{items:[]}});
 });
 await page.goto('/admin');
 await expect(page.getByRole('heading',{name:'會員管理',exact:true})).toBeVisible();
 const memberTotal=page.locator('.admin-summary > div').filter({has:page.getByText('會員',{exact:true})}).locator('dd');
 await expect(memberTotal.getByRole('button')).toHaveAccessibleName('會員 1，開啟會員管理');
 await expect(page.getByText('Synthetic verifier')).toHaveCount(0);
 await page.getByRole('checkbox',{name:'顯示測試資料'}).check();
 await expect(page.getByText('Synthetic verifier')).toBeVisible();
 await expect(page.getByText('測試帳號')).toBeVisible();
 await expect(memberTotal.getByRole('button')).toHaveAccessibleName('會員 1，開啟會員管理');
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('checkbox',{name:'顯示測試資料'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/admin-test-data-mobile.png'});
 await page.setViewportSize({width:820,height:900});
 await expect(page.getByRole('checkbox',{name:'顯示測試資料'})).toBeVisible();
 await expect(page.getByText('測試帳號')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1440,height:900});
 await page.screenshot({path:'test-results/admin-test-data-desktop.png'});
 expect(queries).toEqual(['false','true']);
 await page.getByRole('checkbox',{name:'顯示測試資料'}).uncheck();
 await expect(page.getByText('Synthetic verifier')).toHaveCount(0);
 expect(queries.at(-1)).toBe('false');
});

test('admin header and navigation cards keep their content inside the card border on desktop and phones',async({page})=>{
  await page.route('**/admin/api/**',route=>new URL(route.request().url()).pathname.endsWith('/bootstrap')
    ?route.fulfill({json:{admin:{admin_id:'fixture-admin',community_id:'fixture-community',email:'admin@example.test',display_name:'管理員',role:'super_admin'},csrf_token:'fixture-csrf',summary:{members:1,active_members:1,pending_guild_applications:0,guilds:1,admins:1},available_skill_books:[],pending_guild_appointments:[]}})
    :route.fulfill({json:{items:[]}}));
  for(const [width,height] of [[1440,900],[390,844],[320,720]]){
    await page.setViewportSize({width,height});
    await page.goto('/admin');
    await expect(page.getByRole('heading',{name:'會員管理',exact:true})).toBeVisible();
    if(width<961)await page.getByRole('button',{name:'開啟管理選單',exact:true}).click();
    // Every theme paints both blocks as cards; the logo, page tools and nav buttons must not touch their border.
    for(const theme of ['light','dark','versefolk']){
      await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
      const insets=await page.evaluate(()=>[['.admin-header','.brand,.admin-page-actions'],['.admin-tabs','.admin-nav-label,.admin-nav-link,.admin-nav-search']].map(([card,content])=>{
        const box=document.querySelector<HTMLElement>(card)!,style=getComputedStyle(box),edge=box.getBoundingClientRect();
        const items=[...box.querySelectorAll<HTMLElement>(content)].map(node=>node.getBoundingClientRect()).filter(item=>item.width>0&&item.height>0);
        return Math.min(Math.min(...items.map(item=>item.left))-edge.left-parseFloat(style.borderLeftWidth),Math.min(...items.map(item=>item.top))-edge.top-parseFloat(style.borderTopWidth),edge.right-parseFloat(style.borderRightWidth)-Math.max(...items.map(item=>item.right)));
      }));
      for(const inset of insets)expect(inset,`${theme} ${width}px card inset`).toBeGreaterThanOrEqual(11.5);
    }
    if(width>960){
      const last=page.getByRole('navigation',{name:'平台管理選單'}).getByRole('button',{name:'系統憑證',exact:true});
      await last.scrollIntoViewIfNeeded();await expect(last).toBeInViewport();
    }
    if(width<961)await page.getByRole('button',{name:'關閉管理選單',exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px overflow`).toBe(true);
  }
});

test('verified admin UI keeps member, guild, nomination and audit operations separate from member onboarding',async({page})=>{
  // Browser-only API response fixtures exercise UI wiring. Runtime tests verify signed Access JWTs and real DB commands.
  const csrf='browser-only-csrf-fixture',user='00000000-0000-4000-8000-000000000099';
  let active=true,version=7,reviewed=false,master=false,linked=false;const calls:{path:string;body:any;headers:Record<string,string>}[]=[];
  let memberSessionRequests=0;page.on('request',request=>{if(request.url().endsWith('/api/v1/session'))memberSessionRequests++;});
  await page.route('**/admin/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/admin/api','');
    if(request.method()==='POST'){
      const body=request.postDataJSON();calls.push({path,body,headers:request.headers()});
      if(path.includes('/status')){active=body.active;version++;}
      if(path.includes('/review'))reviewed=true;
      if(path.includes('/master'))master=true;
      if(path==='/link-member')linked=true;
      await route.fulfill({json:{saved:true}});return;
    }
    const member={user_id:user,email:'member@example.test',display_name:'待管理夥伴',active,onboarding_required:true,onboarding_completed_at:null,aggregate_version:version,guilds:[{guild_key:'guild_testing',name:'測試公會'}]};
    const payload=path==='/bootstrap'?{admin:{admin_id:'fixture-admin',display_name:'測試管理員',email:'admin@example.test',role:'super_admin',community_id:'community-fixture'},csrf_token:csrf,summary:{members:1,active_members:active?1:0,pending_guild_applications:reviewed?0:1,guilds:1,admins:1},available_skill_books:[{id:'testing-book',title:'協作入門技能書'}],pending_guild_appointments:[{guild_key:'guild_pending',name:'預定公會',state:linked?'bound':'pending',bound_user_id:linked?user:null}]}:path==='/members'?{items:[member],next_offset:null}:path==='/guild-applications'?{items:[{application_id:'application-fixture',name:'專業測試公會',profession:'軟體測試',reason:'一起練習測試與分享測試技巧',state:reviewed?'approved':'pending',applicant_name:'申請夥伴',applicant_email:'applicant@example.test',aggregate_version:3,review_reason:reviewed?'已有明確學習方向':null}],next_offset:null}:path==='/guilds'?{items:[{guild_key:'guild_testing',name:'測試公會',purpose:'一起測試實用的作品',guild_master:master?{user_id:user,display_name:'待管理夥伴'}:null,officer_version:master?33:28}]}:path==='/guilds/guild_testing/master-candidates'?{items:[{user_id:user,display_name:member.display_name,email:member.email,active,joined:true,eligible:active,eligibility_reason:active?null:'inactive',is_current:master,is_expert:false,expert_version:null}],total:1,next_offset:null}:path==='/admins'?{items:[{admin_id:'fixture-admin',display_name:'測試管理員',email:'admin@example.test',role:'super_admin',active:true,identity_binding:'unverified_email_match'}]}:{items:[{audit_id:'audit-fixture',admin_name:'測試管理員',action:'member_status',reason:'配合會員本人提出的停用要求',created_at:'2026-09-23T12:00:00Z',target_type:'member',target_ref:user}]};
    await route.fulfill({json:payload});
  });
  await page.goto('/admin');await expect(page.getByRole('heading',{name:'會員管理',exact:true})).toBeVisible();
  await expect(page.locator('.admin-member-positioning')).toHaveText('尚未完成加入');
  expect(memberSessionRequests).toBe(1);
  await expect(page.getByText('預定公會 · 等待本人確認連結',{exact:true})).toBeVisible();
  await page.locator('.admin-member-row').getByText('管理操作',{exact:true}).click();
  await page.getByRole('button',{name:'停用這位會員',exact:true}).click();await page.getByLabel('操作理由',{exact:true}).fill('配合會員本人提出的停用要求');await page.getByRole('button',{name:'確認停用這位會員',exact:true}).click();await expect(page.getByText('已停用',{exact:true})).toBeVisible();
  expect(calls[0].headers['x-admin-csrf']).toBe(csrf);expect(calls[0].headers['if-match']).toBe('"7"');expect(calls[0].headers['idempotency-key']).toBeTruthy();expect(calls[0].body.active).toBe(false);
  await page.getByRole('button',{name:'重新啟用會員',exact:true}).click();await page.getByLabel('操作理由',{exact:true}).fill('會員本人確認重新啟用');await page.getByRole('button',{name:'確認重新啟用會員',exact:true}).click();await expect(page.getByText('啟用中',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'公會申請',exact:true}).click();await page.getByText('開始審核',{exact:true}).click();await page.getByLabel('公會宗旨',{exact:true}).fill('一起練習軟體測試並分享經驗');await page.getByLabel('新成員的第一步',{exact:true}).fill('閱讀入門技能書並完成第一個測試');await page.getByLabel('審核說明',{exact:true}).fill('已有明確學習方向');
  await expect(page.getByRole('button',{name:'保存審核決定',exact:true})).toBeDisabled();await page.getByLabel('協作入門技能書',{exact:true}).check();await page.getByRole('button',{name:'保存審核決定',exact:true}).click();await page.getByRole('group',{name:'公會申請篩選'}).getByRole('button',{name:'已核准',exact:true}).click();await expect(page.locator('.admin-application-card .badge')).toHaveText('已核准');expect(calls.find(call=>call.path.includes('/review'))?.body.guild.skill_book_ids).toEqual(['testing-book']);
  await page.getByRole('button',{name:'公會管理',exact:true}).click();await page.getByRole('button',{name:'設定公會長',exact:true}).click();await page.getByRole('radio',{name:'待管理夥伴 · member@example.test',exact:true}).check();await page.getByLabel('任命理由',{exact:true}).fill('具備帶領公會的經驗並同意任命');await page.getByRole('button',{name:'確認任命',exact:true}).click();await expect(page.getByText('公會長：待管理夥伴',{exact:true})).toBeVisible();expect(calls.find(call=>call.path.includes('/master'))?.headers['if-match']).toBe('"28"');
  await page.getByRole('button',{name:'管理員名單',exact:true}).click();await expect(page.getByText(/同信箱會員尚未驗證，不視為身分綁定/)).toBeVisible();
  await page.getByRole('button',{name:'操作紀錄',exact:true}).click();await expect(page.getByText('操作人：測試管理員',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'連結我的會員帳號並確認會長任命',exact:true}).click();await expect(page.getByText('預定公會 · 已連結會員並確認任命',{exact:true})).toBeVisible();expect(calls.find(call=>call.path==='/link-member')?.headers['x-admin-csrf']).toBe(csrf);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('admin appointment, access sync, revocation and reactivation use real isolated records',async({page,browser})=>{
  const [{Pool},{serve},{serveStatic},{createPool,LOCAL_DATABASE_URL},{migrate},{seedLocal,DEMO_COMMUNITY,DEMO_USERS},{createApp},{Problem},{randomUUID}]=await Promise.all([
    import('pg'),import('@hono/node-server'),import('@hono/node-server/serve-static'),import('../../packages/db/index'),import('../../scripts/database'),import('../../packages/testing/seed'),import('../../apps/platform-api/src/app'),import('../../packages/shared/problem'),import('node:crypto'),
  ]);
  const database=process.env.TEST_DATABASE_URL??LOCAL_DATABASE_URL,schema=`fp_admin_browser_${process.pid}_${Date.now()}`;
  const dbAdmin=createPool(database),pool=new Pool({connectionString:database,options:`-c search_path=${schema}`,application_name:schema});
  dbAdmin.on('error',()=>{});pool.on('error',()=>{});
  const ownerEmail='admin-owner@example.test',targetEmail='appointed-admin@example.test',ownerId=randomUUID(),targetId=DEMO_USERS[0].user_id;
  const identities={owner:{email:ownerEmail,subject:'verified-synthetic-owner',csrfToken:'synthetic-owner-csrf'},target:{email:targetEmail,subject:'verified-synthetic-target',csrfToken:'synthetic-target-csrf'}};
  let server:ReturnType<typeof serve>|undefined,second:Awaited<ReturnType<typeof browser.newContext>>|undefined;
  // Playwright's test timeout abandons the body via Promise.race, so this must also run from afterEach.
  let dropping:Promise<void>|undefined;
  const dropSchema=()=>dropping??=(async()=>{
    const fixtureServer=server;
    if(fixtureServer)await new Promise<void>(resolve=>{
      fixtureServer.close(()=>resolve());
      // Assertions have finished. Release only this fixture's HTTP connections
      // before dropping its schema; browser/API keep-alive can otherwise hang close.
      if('closeAllConnections' in fixtureServer)fixtureServer.closeAllConnections();
    });
    try{await pool.end();}catch{/* still drop */}
    await dbAdmin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid()',[schema]).catch(()=>{});
    try{await dbAdmin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await dbAdmin.end();}
  })();
  dropAdminBrowserSchema=dropSchema;
  try{
    await dbAdmin.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);await seedLocal(pool);
    await pool.query('INSERT INTO platform_admins(admin_id,community_id,email,display_name) VALUES($1,$2,$3,$4)',[ownerId,DEMO_COMMUNITY,ownerEmail,'測試現任管理員']);
    await pool.query('UPDATE users SET email=$2,display_name=$3,email_verified_at=now() WHERE user_id=$1',[targetId,targetEmail,'測試新管理員']);
    let app:ReturnType<typeof createApp>;
    server=serve({fetch:request=>app.fetch(request),hostname:'127.0.0.1',port:0});
    await new Promise<void>(resolve=>server!.listening?resolve():server!.once('listening',resolve));
    const address=server.address();expect(address&&typeof address!=='string').toBeTruthy();
    const origin=`http://127.0.0.1:${(address as {port:number}).port}`;
    app=createApp(pool,origin,'local',{adminVerifier:async request=>{
      const identity=request.headers.get('X-Synthetic-Admin');
      if(identity!=='owner'&&identity!=='target')throw new Problem(401,'admin_identity_required','請先通過管理員信箱驗證。');
      return identities[identity];
    }});
    app.use('/*',serveStatic({root:'./apps/portal-web/dist'}));app.get('*',serveStatic({path:'./apps/portal-web/dist/index.html'}));
    await page.context().setExtraHTTPHeaders({'X-Synthetic-Admin':'owner'});
    second=await browser.newContext({extraHTTPHeaders:{'X-Synthetic-Admin':'target'}});
    const targetPage=await second.newPage();
    await targetPage.goto(origin+'/admin');
    await expect(targetPage.getByRole('heading',{name:'需要管理員驗證',exact:true})).toBeVisible();
    await page.goto(origin+'/admin');
    const member=page.locator('.admin-member-row').filter({has:page.getByRole('heading',{name:'測試新管理員',exact:true})});
    await member.getByText('管理操作',{exact:true}).click();
    await member.getByRole('button',{name:'任命管理員',exact:true}).click();
    const review=member.getByRole('form',{name:'任命管理員',exact:true});
    await expect(review).toContainText(targetEmail);await expect(review).toContainText('平台全部管理權限');
    await expect(review.getByRole('button',{name:'確認任命',exact:true})).toBeDisabled();
    await review.getByLabel('任命理由',{exact:true}).fill('測試本人同意承擔平台管理工作');
    const grant=page.waitForResponse(response=>response.url().endsWith(`/admin/api/members/${targetId}/admin`)&&response.request().method()==='POST');
    await review.getByRole('button',{name:'確認任命',exact:true}).click();
    const granted=await grant;expect(granted.status()).toBe(200);expect(granted.request().postDataJSON()).toEqual({reason:'測試本人同意承擔平台管理工作',confirmed:true});
    expect(granted.request().headers()['if-match']).toBe('"1"');expect(granted.request().headers()['x-admin-csrf']).toBe(identities.owner.csrfToken);expect(granted.request().headers()['idempotency-key']).toBeTruthy();
    await expect(member.getByText('平台管理員',{exact:true})).toBeVisible();
    await expect(member.getByText('登入權限同步中',{exact:true})).toBeVisible();
    const row=(await pool.query('SELECT * FROM platform_admins WHERE email=$1',[targetEmail])).rows[0];expect(row.active).toBe(true);
    await member.getByRole('link',{name:'前往管理員名單 ↗',exact:true}).click();
    const listed=page.locator('article.admin-permission-card').filter({has:page.getByRole('heading',{name:'測試新管理員',exact:true})});
    const self=page.locator('article.admin-permission-card').filter({has:page.getByRole('heading',{name:'測試現任管理員',exact:true})});
    await expect(self.getByRole('button',{name:'停用管理權限',exact:true})).toHaveCount(0);
    // Acknowledge the isolated fixture's Access sync, without contacting Cloudflare.
    await pool.query('UPDATE platform_admins SET access_synced_version=aggregate_version,access_synced_at=now() WHERE admin_id=$1',[row.admin_id]);
    await page.getByRole('button',{name:'更新登入狀態',exact:true}).click();
    await expect(listed.getByText('可登入管理頁',{exact:true})).toBeVisible();
    await targetPage.getByRole('button',{name:'重新確認管理身分',exact:true}).click();
    await expect(targetPage.getByRole('navigation',{name:'平台管理選單'})).toBeVisible();
    await listed.getByRole('button',{name:'停用管理權限',exact:true}).click();
    await listed.getByLabel('管理權限調整理由',{exact:true}).fill('測試管理任務結束，停止管理權限');
    await listed.getByRole('button',{name:'確認停用管理權限',exact:true}).click();
    await expect(listed.getByText('管理權限已停用',{exact:true})).toBeVisible();
    await expect(listed.getByText('停用同步中',{exact:true})).toBeVisible();
    expect((await pool.query('SELECT active FROM users WHERE user_id=$1',[targetId])).rows[0].active).toBe(true);
    expect((await targetPage.request.get(origin+'/admin/api/bootstrap')).status()).toBe(403);
    await targetPage.reload();await expect(targetPage.getByRole('heading',{name:'需要管理員驗證',exact:true})).toBeVisible();
    await pool.query('UPDATE platform_admins SET access_synced_version=aggregate_version,access_synced_at=now() WHERE admin_id=$1',[row.admin_id]);
    await page.getByRole('button',{name:'更新登入狀態',exact:true}).click();
    await expect(listed.getByText('登入權限已停用',{exact:true})).toBeVisible();
    await listed.getByRole('button',{name:'重新啟用管理權限',exact:true}).click();
    await listed.getByLabel('管理權限調整理由',{exact:true}).fill('測試新一輪管理任務，確認重新啟用');
    await listed.getByRole('button',{name:'確認重新啟用',exact:true}).click();
    await expect(listed.getByText('登入權限同步中',{exact:true})).toBeVisible();
    await pool.query('UPDATE platform_admins SET access_synced_version=aggregate_version,access_synced_at=now() WHERE admin_id=$1',[row.admin_id]);
    await page.getByRole('button',{name:'更新登入狀態',exact:true}).click();
    await expect(listed.getByText('可登入管理頁',{exact:true})).toBeVisible();
    await targetPage.getByRole('button',{name:'重新確認管理身分',exact:true}).click();
    await expect(targetPage.getByRole('navigation',{name:'平台管理選單'})).toBeVisible();
    expect((await pool.query('SELECT active FROM users WHERE user_id=$1',[targetId])).rows[0].active).toBe(true);
    // The intended leader is an active platform member beyond the first 25 rows,
    // and has not joined this guild. Explicit appointment must admit them atomically.
    const guildKey='guild_event_space',leaderName='Zulu 實際公會長候選';
    for(let i=0;i<30;i++)await pool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref)
      SELECT $1,$2,$3,$4,password_hash,$5 FROM users WHERE user_id=$6`,[randomUUID(),DEMO_COMMUNITY,`candidate-${i}@example.test`,`A${String(i).padStart(2,'0')} 尚未入會`,randomUUID(),targetId]);
    await pool.query('UPDATE users SET display_name=$2 WHERE user_id=$1',[targetId,leaderName]);
    const beforeAppointment=(await pool.query('SELECT onboarding_required,onboarding_completed_at FROM users WHERE user_id=$1',[targetId])).rows[0];
    expect((await pool.query('SELECT count(*)::int AS n FROM positioning_profession_memberships WHERE user_id=$1 AND guild_key=$2',[targetId,guildKey])).rows[0].n).toBe(0);
    const firstGeneral=await (await page.request.get(origin+'/admin/api/members?limit=25&offset=0')).json();expect(firstGeneral.items.some((item:any)=>item.user_id===targetId)).toBe(false);
    const guildName=(await pool.query('SELECT name FROM positioning_guild_catalog WHERE guild_key=$1',[guildKey])).rows[0].name;
    await page.getByRole('button',{name:'公會管理',exact:true}).click();await page.getByRole('searchbox',{name:'搜尋公會',exact:true}).fill(guildName);
    const guildCard=page.getByRole('article',{name:guildName,exact:true});await guildCard.getByRole('button',{name:'設定公會長',exact:true}).click();
    const picker=guildCard.getByRole('region',{name:`${guildName}公會長人選`,exact:true}),choice=picker.getByRole('radio',{name:`${leaderName} · ${targetEmail}`,exact:true});
    await picker.getByRole('searchbox',{name:'搜尋公會長人選',exact:true}).fill('Zulu');await picker.getByRole('button',{name:'查詢人選',exact:true}).click();await expect(choice).toBeVisible();
    await picker.getByRole('searchbox',{name:'搜尋公會長人選',exact:true}).fill(targetEmail);await picker.getByRole('button',{name:'查詢人選',exact:true}).click();await choice.check();await picker.getByLabel('任命理由',{exact:true}).fill('本人同意帶領讀書會與活動安排');
    const appointment=page.waitForResponse(response=>response.url().endsWith(`/admin/api/guilds/${guildKey}/master`)&&response.request().method()==='POST');await picker.getByRole('button',{name:'確認任命',exact:true}).click();
    const assigned=await appointment;expect(assigned.status()).toBe(200);expect(assigned.request().headers()['x-admin-csrf']).toBe(identities.owner.csrfToken);expect(assigned.request().postDataJSON()).toEqual({user_id:targetId,reason:'本人同意帶領讀書會與活動安排'});
    const leader=guildCard.locator('p.admin-guild-current').filter({hasText:`公會長：${leaderName}`});
    await expect(leader).toBeVisible();await expect(leader.getByText('正式成員',{exact:true})).toBeVisible();await expect(guildCard.getByText(`已任命 ${leaderName} 為${guildName}會長。`,{exact:true})).toBeVisible();
    expect((await pool.query('SELECT user_id FROM positioning_guild_officers WHERE community_id=$1 AND guild_key=$2',[DEMO_COMMUNITY,guildKey])).rows[0].user_id).toBe(targetId);
    expect((await pool.query('SELECT state FROM positioning_profession_memberships WHERE user_id=$1 AND guild_key=$2',[targetId,guildKey])).rows[0].state).toBe('active');
    expect((await pool.query('SELECT book_id FROM member_skill_book_grants WHERE user_id=$1 AND guild_key=$2',[targetId,guildKey])).rows.map(item=>item.book_id).sort()).toEqual(['event-space','freedom-party-guild-lounge']);
    expect((await pool.query('SELECT onboarding_required,onboarding_completed_at FROM users WHERE user_id=$1',[targetId])).rows[0]).toEqual(beforeAppointment);
    const appointmentAudit=(await pool.query("SELECT reason,after_state FROM platform_admin_audit WHERE community_id=$1 AND action='appoint_guild_master' AND target_ref=$2",[DEMO_COMMUNITY,guildKey])).rows;
    expect(appointmentAudit).toHaveLength(1);expect(appointmentAudit[0].after_state.user_id).toBe(targetId);expect(appointmentAudit[0].after_state.membership_joined).toBe(true);expect(appointmentAudit[0].reason).toBe('本人同意帶領讀書會與活動安排');
    await page.getByRole('button',{name:'操作紀錄',exact:true}).click();
    await expect(page.getByText('任命平台管理員',{exact:true})).toBeVisible();
    await expect(page.getByText('調整管理權限',{exact:true})).toHaveCount(2);
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{
    try{await second?.close();await page.goto('about:blank');}
    finally{await dropSchema();}
  }
});
