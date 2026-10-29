/** Authored browser coverage; route fixtures test UI, not SQL/Access authority. */
import {test,expect,type Page} from './fixtures.js';
const subject='30000000-0000-4000-8000-000000000001';
const initial={state:'unrequested',aggregate_version:1,show_community_certification:false,statement:'',policy_version:'community_certification_v1'};
async function enable(page:Page){await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),community_certification_enabled:true}});});}
async function login(page:Page){await page.goto('/#account?view=recognition');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('heading',{name:'社群認證（藍勾）'})).toBeVisible();}
test('application requires acknowledgment, never displays an unreviewed badge, and display is independent',async({page})=>{
 await enable(page);let stored={...initial};const writes:any[]=[];
 await page.route('**/api/v1/me/community-certification**',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:stored});const body=route.request().postDataJSON();writes.push({body,version:route.request().headers()['if-match']});
  if(route.request().url().endsWith('/display'))stored={...stored,...body,aggregate_version:stored.aggregate_version+1};
  else stored={...stored,state:'pending',statement:body.statement,aggregate_version:stored.aggregate_version+1};return route.fulfill({json:stored});
 });
 await login(page);const panel=page.locator('.community-certification-panel');await expect(panel.locator('.community-certification-badge')).toHaveCount(0);
 await panel.getByRole('textbox',{name:'社群參與說明'}).fill('這是一段合成的社群參與說明，供人工審核。');await expect(panel.getByRole('button',{name:'送出人工審核申請'})).toBeDisabled();
 await panel.getByRole('checkbox',{name:'我了解這不是實名查驗，申請不保證核准，認證可被撤銷。'}).check();await panel.getByRole('button',{name:'送出人工審核申請'}).click();
 await expect(panel.getByText('等待人工審核',{exact:true})).toBeVisible();await expect(panel.locator('.community-certification-badge')).toHaveCount(0);expect(writes).toHaveLength(1);expect(writes[0].version).toBe('"1"');expect('show_community_certification' in writes[0].body).toBe(false);
 await panel.getByRole('checkbox',{name:'向可閱讀我個人空間的同社群登入會員顯示認證'}).check();await panel.getByRole('button',{name:'保存展示偏好'}).click();await expect(panel.getByText('認證展示偏好已保存。')).toBeVisible();expect(stored.state).toBe('pending');await expect(panel.locator('.community-certification-badge')).toHaveCount(0);
});
test('unknown outcome retries identical operation; withdraw is explicit and cancel does not write',async({page})=>{
 await enable(page);let stored={...initial},lost=true;const attempts:any[]=[];
 await page.route('**/api/v1/me/community-certification**',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:stored});attempts.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key'],version:route.request().headers()['if-match']});
  if(lost){lost=false;return route.abort('failed');}
  stored={...stored,state:route.request().url().endsWith('/withdraw')?'withdrawn':'pending',aggregate_version:stored.aggregate_version+1,statement:'這是一段合成的社群參與說明，供人工審核。'};return route.fulfill({json:stored});
 });
 await login(page);const panel=page.locator('.community-certification-panel');await panel.getByRole('textbox',{name:'社群參與說明'}).fill('這是一段合成的社群參與說明，供人工審核。');await panel.getByRole('checkbox',{name:'我了解這不是實名查驗，申請不保證核准，認證可被撤銷。'}).check();await panel.getByRole('button',{name:'送出人工審核申請'}).click();
 await expect(panel.getByRole('button',{name:'重新確認目前狀態'})).toBeDisabled();await expect(panel.getByRole('button',{name:'送出人工審核申請'})).toBeDisabled();await panel.getByRole('button',{name:'重試同一筆操作'}).click();await expect(panel.getByText('等待人工審核',{exact:true})).toBeVisible();expect(attempts[0]).toEqual(attempts[1]);
 await panel.getByRole('button',{name:'撤回申請',exact:true}).click();await panel.getByRole('button',{name:'取消',exact:true}).click();expect(attempts).toHaveLength(2);
 await panel.getByRole('button',{name:'撤回申請',exact:true}).click();await panel.getByRole('button',{name:'確認撤回',exact:true}).click();await expect(panel.getByText('已撤回',{exact:true})).toBeVisible();expect(attempts).toHaveLength(3);
});
async function adminFixture(page:Page,unknownAck=false){
 let item={...initial,user_id:subject,display_name:'合成申請人',state:'pending',statement:'這是供瀏覽器測試的合成社群參與說明。',aggregate_version:2};const writes:any[]=[];
 await page.route('**/admin/api/**',async route=>{const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/bootstrap'))return route.fulfill({json:{community_certification_enabled:true,admin:{admin_id:'synthetic-admin',community_id:'synthetic-community',role:'super_admin',email:'admin@example.test',display_name:'合成審核員'},csrf_token:'synthetic-csrf',summary:{members:1,active_members:1,pending_guild_applications:0,guilds:0,admins:1},available_skill_books:[]}});
  if(path.endsWith('/review')){writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key'],version:route.request().headers()['if-match']});if(writes.length===1||writes.at(-1).key!==writes.at(-2).key)item={...item,state:writes.at(-1).body.decision==='approve'?'active':'revoked',aggregate_version:item.aggregate_version+1};return route.fulfill({json:unknownAck&&writes.length===1?{}:{updated:true}});}
  if(path.endsWith('/community-certifications')){const filter=new URL(route.request().url()).searchParams.get('state');return route.fulfill({json:{items:filter==='all'||filter===item.state?[item]:[],next_offset:null}});}
  return route.fulfill({json:{items:[]}});
 });return {writes};
}
test('admin review explicitly approves and revokes, refreshes current state and preserves small-screen layout',async({page})=>{
 const fixture=await adminFixture(page);await page.setViewportSize({width:320,height:740});await page.goto('/admin?view=community-certifications');await expect(page.getByRole('heading',{name:'社群認證審核',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'審核這筆申請'}).click();await page.getByRole('textbox',{name:'私人稽核理由'}).fill('已人工檢視此合成案例。');await expect(page.getByRole('button',{name:'確認保存審核'})).toBeDisabled();await page.getByRole('checkbox',{name:'我已人工檢視此申請，確認上述決定；這不代表實名查驗。'}).check();await page.getByRole('button',{name:'確認保存審核'}).click();await expect(page.getByText('目前沒有這個狀態的申請。')).toBeVisible();
 expect(fixture.writes[0].body.decision).toBe('approve');expect(fixture.writes[0].version).toBe('"2"');await page.getByRole('combobox',{name:'審核狀態'}).selectOption('active');await page.getByRole('button',{name:'審核這筆申請'}).click();await page.getByRole('textbox',{name:'私人稽核理由'}).fill('撤銷合成測試認證。');await page.getByRole('checkbox',{name:'我已人工檢視此申請，確認上述決定；這不代表實名查驗。'}).check();await page.getByRole('button',{name:'確認保存審核'}).click();await expect(page.getByText('目前沒有這個狀態的申請。')).toBeVisible();expect(fixture.writes[1].body.decision).toBe('revoke');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('default-off site does not mount or fetch the certification owner panel',async({page})=>{
 const calls:string[]=[];page.on('request',request=>{if(request.url().includes('/community-certification'))calls.push(request.url());});await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),community_certification_enabled:false}});});
 await page.goto('/#account');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.account-panel')).toBeVisible();await expect(page.getByRole('heading',{name:'社群認證（藍勾）'})).toHaveCount(0);expect(calls).toEqual([]);
});

test('definitive CAS rejection releases pending operation but requires a fresh owner read',async({page})=>{
 await enable(page);let reads=0;
 await page.route('**/api/v1/me/community-certification**',async route=>{
  if(route.request().method()==='GET'){reads++;return route.fulfill({json:{...initial,aggregate_version:reads}});}
  return route.fulfill({status:412,contentType:'application/problem+json',json:{type:'about:blank',title:'Conflict',status:412,detail:'請重新讀取最新版本。'}});
 });
 await login(page);const panel=page.locator('.community-certification-panel');await panel.getByRole('textbox',{name:'社群參與說明'}).fill('這是一段合成的社群參與說明，供人工審核。');await panel.getByRole('checkbox',{name:'我了解這不是實名查驗，申請不保證核准，認證可被撤銷。'}).check();await panel.getByRole('button',{name:'送出人工審核申請'}).click();
 await expect(panel.getByRole('alert')).toBeVisible();await expect(panel.getByRole('button',{name:'重試同一筆操作'})).toHaveCount(0);await expect(panel.getByRole('button',{name:'重新確認目前狀態'})).toBeEnabled();await expect(panel.getByRole('textbox',{name:'社群參與說明'})).toHaveCount(0);await panel.getByRole('button',{name:'重新確認目前狀態'}).click();await expect(panel.getByRole('textbox',{name:'社群參與說明'})).toBeVisible();expect(reads).toBe(2);
});
for(const status of [412,422])for(const first of ['malformed','lost','invalid_json_success'] as const)test(`unknown ${first} then ${status} retains original operation until success`,async({page})=>{
 await enable(page);const attempts:any[]=[];
 await page.route('**/api/v1/me/community-certification**',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:initial});
  attempts.push({key:route.request().headers()['idempotency-key'],version:route.request().headers()['if-match'],body:route.request().postDataJSON()});
  if(attempts.length===1)return first==='lost'?route.abort('failed'):first==='invalid_json_success'?route.fulfill({json:{}}):route.fulfill({status,contentType:'text/html',body:'<html>Incomplete upstream response</html>'});
  if(attempts.length===2)return route.fulfill({status,contentType:'application/problem+json',json:{type:'about:blank',title:'Rejected',status,detail:'請稍後確認。'}});
  return route.fulfill({json:{...initial,state:'pending',aggregate_version:2,statement:attempts[0].body.statement}});
 });
 await login(page);const panel=page.locator('.community-certification-panel');await panel.getByRole('textbox',{name:'社群參與說明'}).fill('這是一段合成的社群參與說明，供人工審核。');await panel.getByRole('checkbox',{name:'我了解這不是實名查驗，申請不保證核准，認證可被撤銷。'}).check();await panel.getByRole('button',{name:'送出人工審核申請'}).click();
 const retry=panel.getByRole('button',{name:'重試同一筆操作'});await expect(retry).toBeVisible();await expect(panel.getByRole('button',{name:'重新確認目前狀態'})).toBeDisabled();await retry.click();await expect(retry).toBeEnabled();await expect(panel.getByRole('button',{name:'重新確認目前狀態'})).toBeDisabled();await expect(panel.getByRole('button',{name:'送出人工審核申請'})).toBeDisabled();await retry.click();await expect(panel.getByText('等待人工審核',{exact:true})).toBeVisible();expect(attempts).toHaveLength(3);expect(attempts[1]).toEqual(attempts[0]);expect(attempts[2]).toEqual(attempts[0]);
});

test('admin malformed JSON success ACK retains original review and leave lock until same-key ACK',async({page})=>{
 const fixture=await adminFixture(page,true);await page.goto('/admin?view=community-certifications');await page.getByRole('button',{name:'審核這筆申請'}).click();await page.getByRole('textbox',{name:'私人稽核理由'}).fill('已人工檢視此合成案例。');await page.getByRole('checkbox',{name:'我已人工檢視此申請，確認上述決定；這不代表實名查驗。'}).check();await page.getByRole('button',{name:'確認保存審核'}).click();
 const retry=page.getByRole('button',{name:'重試同一筆審核'});await expect(retry).toBeVisible();await expect(page.getByRole('button',{name:'重新確認審核清單'})).toBeDisabled();await expect(page.getByRole('combobox',{name:'審核狀態'})).toBeDisabled();await expect(page.getByRole('button',{name:'確認保存審核'})).toBeDisabled();await retry.click();await expect(page.getByText('目前沒有這個狀態的申請。')).toBeVisible();expect(fixture.writes).toHaveLength(2);expect(fixture.writes[0]).toEqual(fixture.writes[1]);
});

test('recognition is an optional personal-data disclosure, direct entry focuses it, and security stays closed',async({page})=>{
 await enable(page);let writes=0;await page.route('**/api/v1/me/community-certification**',route=>{if(route.request().method()!=='GET')writes++;return route.fulfill({json:initial});});
 await login(page);const section=page.locator('[data-profile-recognition]'),summary=section.locator(':scope > summary');
 await expect(section).toHaveAttribute('open','');await expect(summary).toBeFocused();
 await expect(section.locator('xpath=ancestor::details[contains(@class,"account-settings-section")]').locator(':scope > summary')).toContainText('個人資料');
 const security=page.locator('.account-settings-section').filter({has:page.locator('summary',{hasText:'帳號與安全'})});await expect(security).not.toHaveAttribute('open');
 await page.goto('/#account');await page.reload();await expect(section).not.toHaveAttribute('open');await expect(page.getByRole('heading',{name:'社群認證（藍勾）'})).not.toBeVisible();
 await summary.focus();await page.keyboard.press('Enter');await expect(section).toHaveAttribute('open','');await expect(page.getByRole('heading',{name:'社群認證（藍勾）'})).toBeVisible();expect(writes).toBe(0);
 const personal=section.locator('xpath=ancestor::details[contains(@class,"account-settings-section")]');await personal.locator(':scope > summary').click();await expect(personal).not.toHaveAttribute('open');await page.evaluate(()=>{location.hash='#account?view=recognition';});await expect(personal).toHaveAttribute('open','');await expect(section).toHaveAttribute('open','');await summary.click();await expect(section).not.toHaveAttribute('open');await page.getByLabel('社群顯示名稱',{exact:true}).fill('只改草稿');await expect(section).not.toHaveAttribute('open');expect(writes).toBe(0);
});

test('a delayed site flag reveals and focuses recognition in the existing account page without a mutation',async({page})=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let writes=0;
 await page.route('**/api/v1/site',async route=>{const response=await route.fetch(),site=await response.json();await gate;await route.fulfill({json:{...site,community_certification_enabled:true}});});
 await page.route('**/api/v1/me/community-certification**',route=>{if(route.request().method()!=='GET')writes++;return route.fulfill({json:initial});});
 try{
  await page.goto('/#account?view=recognition');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.locator('.account-panel')).toBeVisible();await expect(page.locator('[data-profile-recognition]')).toHaveCount(0);
  const personal=page.locator('.account-settings-section').filter({has:page.locator(':scope > summary',{hasText:'個人資料'})});await personal.locator(':scope > summary').click();await expect(personal).not.toHaveAttribute('open');
  release();const section=page.locator('[data-profile-recognition]');await expect(personal).toHaveAttribute('open','');await expect(section).toHaveAttribute('open','');await expect(section.locator(':scope > summary')).toBeFocused();expect(writes).toBe(0);
 }finally{release();}
});

for(const width of [320,390])test(`private space keeps all three explicit profile entries reachable at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await enable(page);let writes=0;
 await page.route('**/api/v1/me/community-certification**',route=>{if(route.request().method()!=='GET')writes++;return route.fulfill({json:initial});});await login(page);
 await page.goto('/#profile');const actions=page.locator('.personal-space-hero-actions');
 for(const [name,href] of [['編輯資料與分享設定','#account'],['佈置主頁','#profile?view=settings'],['我的稱號與認證','#account?view=recognition']]){
  const link=actions.getByRole('link',{name,exact:true});await expect(link).toBeVisible();await expect(link).toHaveAttribute('href',href);const box=(await link.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await actions.getByRole('link',{name:'我的稱號與認證',exact:true}).click();await expect(page.locator('[data-profile-recognition]')).toHaveAttribute('open','');expect(writes).toBe(0);
});
