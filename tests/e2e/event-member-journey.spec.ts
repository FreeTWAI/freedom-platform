import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {hashPassword} from '../../modules/identity-membership/service.js';
import sharp from 'sharp';
import {test,expect,type Page} from './fixtures.js';
import {navigate,signOut} from './navigation.js';
import {DEMO_COMMUNITY,DEMO_USERS} from '../../packages/testing/seed.js';

test.use({timezoneId:'America/New_York'});
const eventTest=test.extend<{eventFixture:{user:string;email:string}}>({
  eventFixture:async({page,e2eAuthPool},use,info)=>{
    const community=randomUUID(),user=randomUUID(),email=`event-fixture-${user}@example.test`;
    const before=Number((await e2eAuthPool.query('SELECT count(*) FROM communities')).rows[0].count);
    let setupFailed=false;
    try{
      await e2eAuthPool.query("INSERT INTO communities(community_id,name) VALUES($1,'合成活動隔離社群')",[community]);
      await e2eAuthPool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
        VALUES($1,$2,$3,'合成活動會員',$4,$5,false)`,[user,community,email,hashPassword('freedom-local-demo'),randomUUID()]);
      await use({user,email});
    }catch(error){setupFailed=true;throw error;}
    finally{
      // Test finally blocks release the gates before fixture teardown. Settle
      // their handlers and close the page before deleting any application data.
      const results=await Promise.allSettled([page.unrouteAll({behavior:'wait'})]);
      results.push(...await Promise.allSettled([page.close()]));
      results.push(...await Promise.allSettled([(async()=>{
        const q=await e2eAuthPool.connect();
        try{
          await q.query('BEGIN');
          // Match member-command lock order; pending writes finish before the
          // owned user is removed, and later requests cannot recreate fixtures.
          await q.query('SELECT user_id FROM users WHERE community_id=$1 FOR UPDATE',[community]);
          // This harness uses legacy event media, not the immutable Asset/R2
          // lifecycle. Fail explicitly if that contract changes; never disable
          // its preservation triggers to make fixture cleanup pass.
          expect(Number((await q.query('SELECT count(*) FROM assets WHERE owner_user_id=$1 OR community_ref=$2',[user,community])).rows[0].count)).toBe(0);
          await q.query('DELETE FROM community_event_bulletins WHERE community_id=$1',[community]);
          for(const table of ['community_event_banners','community_event_videos']){
            await q.query(`DELETE FROM ${table} WHERE event_id IN (SELECT event_id FROM community_events WHERE community_id=$1)`,[community]);
          }
          await q.query('DELETE FROM community_events WHERE community_id=$1',[community]);
          await q.query('DELETE FROM member_notifications WHERE community_id=$1',[community]);
          // Injected 503/415 and lost ACKs also write bounded client diagnostics.
          await q.query('DELETE FROM member_client_errors WHERE community_id=$1',[community]);
          await q.query('DELETE FROM outbox WHERE transition_id IN (SELECT transition_id FROM transition_journal WHERE community_id=$1)',[community]);
          await q.query('DELETE FROM transition_journal WHERE community_id=$1',[community]);
          await q.query('DELETE FROM command_receipts WHERE user_id=$1',[user]);
          for(const table of ['member_accounts','member_notification_preferences','member_first_participation','guild_preference_sets','guild_member_preferences','member_skill_book_grants','positioning_profession_memberships']){
            await q.query(`DELETE FROM ${table} WHERE community_id=$1`,[community]);
          }
          await q.query('DELETE FROM sessions WHERE user_id=$1',[user]);
          await q.query('DELETE FROM users WHERE community_id=$1',[community]);
          await q.query('DELETE FROM communities WHERE community_id=$1',[community]);
          await q.query('COMMIT');
        }catch(error){await q.query('ROLLBACK');throw error;}
        finally{q.release();}
        const remaining=Number((await e2eAuthPool.query('SELECT count(*) FROM communities WHERE community_id=$1',[community])).rows[0].count);
        const after=Number((await e2eAuthPool.query('SELECT count(*) FROM communities')).rows[0].count);
        expect(remaining).toBe(0);expect(after).toBe(before);
        await info.attach('event-fixture-cleanup',{body:JSON.stringify({community,before,after,remaining}),contentType:'application/json'});
      })()]));
      for(const result of results)if(result.status==='rejected'){
        // Keep the journey/setup error primary, but retain cleanup failures in
        // the report. A cleanup failure alone must still fail the test.
        if(setupFailed||info.errors.length)info.annotations.push({type:'fixture-cleanup-failed',description:String(result.reason)});
        else throw result.reason;
      }
    }
  },
});
async function login(page:Page,email='maker@local.test'){
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill(email);
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('button',{name:'設定',exact:true})).toBeVisible();
}
async function logout(page:Page){
  // Public event pages remain readable after logout; use the member shell to verify the login transition.
  await page.goto('/');
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/auth/logout');
  await signOut(page);const result=await response;expect(result.status()).toBe(200);await result.finished();
}

test('member previews an event, an authorized officer approves it, and participants can return and cancel',async({page,context,browser,e2eAuthPool})=>{
  // Synthetic preassigned reviewer. Every event, publication, share and RSVP
  // transition below uses the member UI and the real domain API.
  await e2eAuthPool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state)
    VALUES($1,$2,$3,'guild_member_operations','active') ON CONFLICT(community_id,user_id,guild_key) DO UPDATE SET state='active'`,[randomUUID(),DEMO_COMMUNITY,DEMO_USERS[1].user_id]);
  await e2eAuthPool.query(`INSERT INTO positioning_guild_officers(community_id,guild_key,user_id)
    VALUES($1,'guild_member_operations',$2) ON CONFLICT DO NOTHING`,[DEMO_COMMUNITY,DEMO_USERS[1].user_id]);
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.setViewportSize({width:390,height:844});await login(page);await navigate(page,'社群活動');
  await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  const title='合成活動：共同整理開源工具',form=page.locator('form').filter({has:page.getByRole('heading',{name:'提交活動',exact:true})});
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/v1/events')writes++;});
  await form.getByLabel('活動名稱',{exact:true}).fill(title);
  await form.getByLabel('活動說明',{exact:true}).fill('這是合成內容；一起用範例資料整理工具，沒有付款或真實招募。');
  await form.getByLabel('線上場地',{exact:true}).fill('合成線上工作室');
  await form.getByLabel('線上參與連結',{exact:true}).fill('https://example.com/synthetic-event');
  await form.getByRole('combobox',{name:/^參與範圍/}).selectOption('open');
  await expect(form).toContainText('America/New_York');
  const start=await form.getByLabel('開始時間',{exact:true}).inputValue();
  const expectedIso=await page.evaluate(value=>new Date(value).toISOString(),start);
  const photo=await sharp({create:{width:700,height:1050,channels:3,background:'#366177'}}).png().toBuffer();
  await form.getByLabel('活動海報（選填）').setInputFiles({name:'synthetic-event.png',mimeType:'image/png',buffer:photo});
  await expect(form.getByRole('button',{name:'送出審核',exact:true})).toBeEnabled();
  await form.getByText('送出前預覽活動',{exact:true}).click();
  const preview=form.getByRole('region',{name:'活動送審預覽',exact:true});
  await expect(preview).toContainText(title);await expect(preview).toContainText('活動頁公開，所有人可查看及報名');
  await expect(preview.getByRole('img',{name:'活動海報預覽',exact:true})).toBeVisible();
  expect(writes).toBe(0);
  for(const theme of ['light','dark','versefolk']){
    await page.evaluate(value=>{localStorage.setItem('freedom-theme',value);document.documentElement.dataset.theme=value;window.dispatchEvent(new Event('freedom-theme-changed'));},theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/event-member-journey/preview-${theme}-390.png`,fullPage:true});
  }
  const creating=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/events');
  await form.getByRole('button',{name:'送出審核',exact:true}).click();
  const created=await creating;expect(created.status()).toBe(201);const event=await created.json();
  expect(event.starts_at).toBe(expectedIso);expect(event.state).toBe('pending');
  let card=page.locator('.experience-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await expect(card).toContainText('待審核');await expect(card.locator('.experience-banner-image')).toBeVisible();
  await logout(page);await login(page,'reviewer@local.test');await navigate(page,'社群活動');
  card=page.locator('.experience-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await card.getByRole('button',{name:'審核活動',exact:true}).click();
  await card.getByLabel('審核理由',{exact:true}).fill('合成驗收：介紹、時間及公開範圍已核對。');
  await card.getByRole('button',{name:'核准並公告',exact:true}).click();await expect(card).toContainText('開放報名');
  await card.getByRole('button',{name:'分享活動',exact:true}).click();
  await expect(page.getByText('活動專頁連結已複製，分享碼已包含在連結中。',{exact:true})).toBeVisible();
  const shared=await page.evaluate(()=>navigator.clipboard.readText());
  expect(new URL(shared).origin).toBe(new URL(page.url()).origin);
  const guest=await browser.newContext({timezoneId:'Asia/Taipei'});
  try{
    const publicPage=await guest.newPage();await publicPage.goto(shared);
    // This real local journey requires the inline-login mode, rather than the discovery join redirect.
    const site=await publicPage.request.get(new URL('/api/v1/site',shared).href);
    expect((await site.json()).community_discovery_enabled).toBe(false);
    await expect(publicPage.getByRole('heading',{name:title,exact:true})).toBeVisible();
    // /go/ replaces itself with the event page. Login has to stay on that page, query included.
    const eventUrl=publicPage.url();
    const eventLocation=new URL(eventUrl);
    expect(eventLocation.origin).toBe(new URL(shared).origin);
    expect(eventLocation.pathname).toMatch(/^\/events\/[0-9a-f-]{36}\/?$/);
    await publicPage.getByRole('button',{name:'會員登入',exact:true}).click();
    await expect(publicPage.getByRole('button',{name:'返回活動',exact:true})).toBeVisible();
    await publicPage.getByLabel('電子郵件',{exact:true}).fill('client@local.test');
    await publicPage.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
    await publicPage.getByRole('button',{name:'登入',exact:true}).click();
    await expect(publicPage.getByRole('region',{name:'活動專頁',exact:true})).toContainText(title);
    await expect(publicPage).toHaveURL(eventUrl);
    expect(await publicPage.evaluate(()=>window.history.state?.freedomEventLogin)).toBeUndefined();
    await publicPage.goBack();await publicPage.goForward();
    await expect(publicPage.getByRole('region',{name:'活動專頁',exact:true})).toContainText(title);
    await expect(publicPage.getByRole('button',{name:'返回活動',exact:true})).toHaveCount(0);
  }
  finally{await guest.close();}
  await logout(page);await login(page,'client@local.test');await page.goto(shared);
  await page.getByRole('button',{name:'我要參加',exact:true}).click();await expect(page.getByRole('button',{name:'取消報名',exact:true})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'取消報名',exact:true}).click();await expect(page.getByRole('button',{name:'我要參加',exact:true})).toBeVisible();
  await logout(page);await login(page);await navigate(page,'我的內容');
  const own=page.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await own.getByRole('link',{name:'查看',exact:true}).click();await expect(page.getByRole('region',{name:'活動專頁',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'報名名單',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'關閉',exact:true}).click();
  await page.getByRole('button',{name:'取消活動',exact:true}).click();await expect(page.getByRole('region',{name:'活動專頁',exact:true})).toContainText('已取消');
});

for(const width of [1440,390])test(`unsaved event input survives rejected navigation and explicit discard at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:844});await login(page);await navigate(page,'社群活動');
  let discard=false;const prompts:string[]=[];let writes=0;
  page.on('dialog',async dialog=>{prompts.push(dialog.message());await(discard?dialog.accept():dialog.dismiss());});
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/events')writes++;});
  await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  // An untouched form has no work to discard.
  await navigate(page,'我的內容');expect(prompts).toEqual([]);await navigate(page,'社群活動');
  await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  const form=page.locator('form').filter({has:page.getByRole('heading',{name:'提交活動',exact:true})});
  await form.getByLabel('活動名稱',{exact:true}).fill('尚未送出的活動草稿');
  await form.getByLabel('活動說明',{exact:true}).fill('切換頁面、返回與關閉編輯都不能默默丟掉這段文字。');
  await form.getByLabel('開始時間',{exact:true}).fill('2030-06-10T14:30');
  await navigate(page,'我的內容');await expect(page).toHaveURL(/#events$/);expect(prompts).toHaveLength(1);
  const closeMenu=page.getByRole('button',{name:'關閉選單',exact:true});if(await closeMenu.isVisible())await closeMenu.click();
  await expect(form.getByLabel('活動名稱',{exact:true})).toHaveValue('尚未送出的活動草稿');
  await page.goBack();await expect.poll(()=>prompts.length).toBe(2);await expect(page).toHaveURL(/#events$/);
  await page.evaluate(()=>{window.location.hash='events/00000000-0000-4000-8000-000000000001';});
  await expect.poll(()=>prompts.length).toBe(3);await expect(page).toHaveURL(/#events$/);
  await expect(form.getByLabel('開始時間',{exact:true})).toHaveValue('2030-06-10T14:30');
  await form.getByRole('button',{name:'返回',exact:true}).click();expect(prompts).toHaveLength(4);
  await expect(form.getByRole('textbox',{name:'活動說明',exact:true})).toHaveValue('切換頁面、返回與關閉編輯都不能默默丟掉這段文字。');
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
  await page.screenshot({path:info.outputPath(`event-draft-retained-${width}.png`),fullPage:true});
  discard=true;await navigate(page,'我的內容');await expect(page).toHaveURL(/#my-content$/);
  await navigate(page,'社群活動');await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  await expect(form.getByLabel('活動名稱',{exact:true})).toHaveValue('');expect(writes).toBe(0);
});

test('event submission blocks departure while pending and saved edits require explicit discard',async({page})=>{
  await login(page);await navigate(page,'社群活動');await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  const title='離開保護 '+randomUUID().slice(0,8),form=page.locator('form').filter({has:page.getByRole('heading',{name:'提交活動',exact:true})});
  await form.getByLabel('活動名稱',{exact:true}).fill(title);await form.getByLabel('活動說明',{exact:true}).fill('隔離資料，驗證送出與返回編輯。');await form.getByLabel('線上場地',{exact:true}).fill('合成場地');
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let reached=false,writes=0;
  const createdResponse=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/v1/events');
  await page.route('**/api/v1/events',async route=>{if(route.request().method()!=='POST')return route.continue();reached=true;writes++;await held;await route.continue();});
  try{
    await form.getByRole('button',{name:'送出審核',exact:true}).click();await expect.poll(()=>reached).toBe(true);
    await expect(form.getByLabel('活動名稱',{exact:true})).toBeDisabled();
    await navigate(page,'我的內容');await expect(page).toHaveURL(/#events$/);await expect(page.getByRole('status').filter({hasText:'正在處理活動'})).toBeVisible();
  }finally{release();}
  await expect(page.getByText('活動已送出審核，核准後開放報名。',{exact:true})).toBeVisible();expect(writes).toBe(1);
  const createdEvent=await(await createdResponse).json();
  await navigate(page,'我的內容');await expect(page).toHaveURL(/#my-content$/);await navigate(page,'社群活動');
  const card=page.locator('.experience-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await card.getByRole('button',{name:'編輯草稿',exact:true}).click();
  let discard=false;let prompts=0;page.on('dialog',async dialog=>{prompts++;await(discard?dialog.accept():dialog.dismiss());});
  // Opening a saved draft alone does not make it dirty.
  await card.getByRole('button',{name:'返回',exact:true}).click();expect(prompts).toBe(0);
  await card.getByRole('button',{name:'編輯草稿',exact:true}).click();await card.getByLabel('活動名稱',{exact:true}).fill(title+' 修改中');
  await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();expect(prompts).toBe(1);await expect(card.getByLabel('活動名稱',{exact:true})).toHaveValue(title+' 修改中');
  await navigate(page,'我的內容');await expect(page).toHaveURL(/#events$/);expect(prompts).toBe(2);
  discard=true;await card.getByRole('button',{name:'返回',exact:true}).click();await expect(card.getByLabel('活動名稱',{exact:true})).toHaveCount(0);
  await card.getByRole('button',{name:'編輯草稿',exact:true}).click();await expect(card.getByLabel('活動名稱',{exact:true})).toHaveValue(title);expect(writes).toBe(1);
  await page.goto(`/events/${createdEvent.event_id}`);await card.getByRole('button',{name:'編輯草稿',exact:true}).click();
  await card.getByLabel('活動名稱',{exact:true}).fill(title+' 專頁修改');discard=false;
  await page.getByRole('button',{name:'返回活動列表與行事曆',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/events/${createdEvent.event_id}$`));await expect(card.getByLabel('活動名稱',{exact:true})).toHaveValue(title+' 專頁修改');
  discard=true;await page.getByRole('button',{name:'返回活動列表與行事曆',exact:true}).click();await expect(page).toHaveURL(/\/#events$/);
});

for(const width of [1440,390])test(`an unknown event submission keeps its original retry key and cannot be abandoned at ${width}px`,async({page,e2eAuthPool},info)=>{
  await page.setViewportSize({width,height:844});await login(page,width===390?'client@local.test':'maker@local.test');await navigate(page,'社群活動');await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  const title='不明結果 '+randomUUID().slice(0,8),form=page.locator('form').filter({has:page.getByRole('heading',{name:'提交活動',exact:true})});
  const otherTitle='其他活動 '+randomUUID().slice(0,8);
  await form.getByLabel('活動名稱',{exact:true}).fill(otherTitle);await form.getByLabel('活動說明',{exact:true}).fill('合成案例：原操作未決時不可插入取消其他活動。');await form.getByLabel('線上場地',{exact:true}).fill('合成場地');
  await form.getByRole('button',{name:'送出審核',exact:true}).click();await expect(page.getByText('活動已送出審核，核准後開放報名。',{exact:true})).toBeVisible();
  const other=page.locator('.experience-card').filter({has:page.getByRole('heading',{name:otherTitle,exact:true})});
  await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  await form.getByLabel('活動名稱',{exact:true}).fill(title);await form.getByLabel('活動說明',{exact:true}).fill('合成案例，原請求已完成但回應遺失。');await form.getByLabel('線上場地',{exact:true}).fill('合成場地');
  const attempts:{body:string|null;key:string|undefined}[]=[];
  let releaseRefresh!:()=>void,reachedRefresh!:()=>void;
  const heldRefresh=new Promise<void>(resolve=>{releaseRefresh=resolve;}),refreshReached=new Promise<void>(resolve=>{reachedRefresh=resolve;});
  await page.route('**/api/v1/events',async route=>{
    if(route.request().method()==='GET'&&attempts.length===2){
      const response=await route.fetch();expect(response.status()).toBe(200);reachedRefresh();
      await heldRefresh;await route.fulfill({response});return;
    }
    if(route.request().method()!=='POST')return route.continue();
    attempts.push({body:route.request().postData(),key:route.request().headers()['idempotency-key']});
    if(attempts.length===1){const response=await route.fetch();expect(response.status()).toBe(201);await route.abort('failed');}
    else await route.continue();
  });
  await form.getByRole('button',{name:'送出審核',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  const titleInput=form.getByLabel('活動名稱',{exact:true});await expect(titleInput).toBeDisabled();
  await titleInput.evaluate(input=>(input as HTMLInputElement).focus());await page.keyboard.type('不能改成另一筆活動');await expect(titleInput).toHaveValue(title);
  await expect(form.getByLabel('開始時間',{exact:true})).toBeDisabled();await expect(form.locator('input[type="file"]')).toHaveCount(2);
  for(const input of await form.locator('input[type="file"]').all())await expect(input).toBeDisabled();
  await expect(other.getByRole('button',{name:'取消活動',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();await expect(titleInput).toHaveValue(title);expect(attempts).toHaveLength(1);
  let prompts=0;page.on('dialog',async dialog=>{prompts++;await dialog.accept();});
  await navigate(page,'我的內容');await expect(page).toHaveURL(/#events$/);expect(prompts).toBe(0);
  await expect(page.getByRole('status').filter({hasText:'尚未確認原操作的結果'})).toBeVisible();
  await form.getByRole('button',{name:'返回',exact:true}).click();await expect(form).toBeVisible();
  try{
    await form.getByRole('button',{name:'送出審核',exact:true}).click();await expect(page.getByText('活動已送出審核，核准後開放報名。',{exact:true})).toBeVisible();await refreshReached;
    expect(attempts).toHaveLength(2);expect(attempts[0].key).toBeTruthy();expect(attempts[1]).toEqual(attempts[0]);
    expect(Number((await e2eAuthPool.query('SELECT count(*) FROM community_events WHERE title=$1',[title])).rows[0].count)).toBe(1);
    // A confirmed save can close a fresh untouched composer and leave while its
    // real list response is still held. Waiting for that read would hide the race.
    const closeMenu=page.getByRole('button',{name:'關閉選單',exact:true});if(await closeMenu.isVisible())await closeMenu.click();
    await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();await expect(form.getByLabel('活動名稱',{exact:true})).toHaveValue('');
    await form.getByRole('button',{name:'返回',exact:true}).click();await expect(form).toHaveCount(0);
    expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(false);
    await navigate(page,'我的內容');await expect(page).toHaveURL(/#my-content$/);expect(prompts).toBe(0);
    await info.attach('ack-lost-original-command',{body:JSON.stringify({width,attempts,title,durable_count:1,departed_while_get200_held:true}),contentType:'application/json'});
    await page.screenshot({path:info.outputPath(`event-retry-left-${width}.png`),fullPage:true});
  }finally{releaseRefresh();}
});

test('a known event rejection unlocks the draft for correction and a new submission',async({page,e2eAuthPool})=>{
  await login(page);await navigate(page,'社群活動');await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  const title='修正時間 '+randomUUID().slice(0,8),form=page.locator('form').filter({has:page.getByRole('heading',{name:'提交活動',exact:true})});
  await form.getByLabel('活動名稱',{exact:true}).fill(title);await form.getByLabel('活動說明',{exact:true}).fill('結束時間早於開始時間，已知拒絕後可修正。');await form.getByLabel('線上場地',{exact:true}).fill('合成場地');
  await form.getByLabel('開始時間',{exact:true}).fill('2030-06-10T14:30');await form.getByLabel('結束時間',{exact:true}).fill('2030-06-10T13:30');
  const rejected=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/events');
  await form.getByRole('button',{name:'送出審核',exact:true}).click();expect((await rejected).status()).toBe(422);await expect(page.getByRole('alert')).toBeVisible();
  await expect(form.getByLabel('活動名稱',{exact:true})).toBeEnabled();await form.getByLabel('結束時間',{exact:true}).fill('2030-06-10T15:30');
  await form.getByRole('button',{name:'送出審核',exact:true}).click();await expect(page.getByText('活動已送出審核，核准後開放報名。',{exact:true})).toBeVisible();
  expect(Number((await e2eAuthPool.query('SELECT count(*) FROM community_events WHERE title=$1',[title])).rows[0].count)).toBe(1);
});

for(const width of [1440,390])eventTest(`confirmed event versions and partial media survive held refreshes at ${width}px`,async({page,e2eAuthPool,eventFixture:{user,email}},info)=>{
  await page.setViewportSize({width,height:844});await login(page,email);await navigate(page,'社群活動');
  await expect(page.getByText('目前沒有即將舉辦的活動。你可以提交第一場。',{exact:true})).toBeVisible();
  const form=page.locator('form').filter({has:page.getByRole('heading',{name:'提交活動',exact:true})});
  const titles=[`刷新甲 ${user}`,`刷新乙 ${user}`];
  const snapshots:{release:()=>void;done:Promise<void>;body:unknown}[]=[];
  const writes:{path:string;version:string|undefined;status:number;body:unknown}[]=[];
  let hold=false;
  await page.route('**/api/v1/events',async route=>{
    if(route.request().method()!=='GET'||!hold)return route.continue();
    const response=await route.fetch();expect(response.status()).toBe(200);
    if(!hold)return route.fulfill({response});
    let release!:()=>void,complete!:()=>void;
    const wait=new Promise<void>(resolve=>{release=resolve;}),done=new Promise<void>(resolve=>{complete=resolve;});
    snapshots.push({release,done,body:await response.json()});
    await wait;await route.fulfill({response});complete();
  });
  try{
    hold=true;
    for(const title of titles){
      await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
      await form.getByLabel('活動名稱',{exact:true}).fill(title);
      await form.getByLabel('活動說明',{exact:true}).fill('合成內容：核對已確認版本與較新草稿。');
      await form.getByLabel('線上場地',{exact:true}).fill('合成場地');
      await form.getByRole('button',{name:'送出審核',exact:true}).click();
      await expect(form).toHaveCount(0);
    }
    await expect.poll(()=>snapshots.length).toBe(2);
    await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
    await form.getByLabel('活動名稱',{exact:true}).fill('較新的未送出草稿');
    snapshots[1].release();await snapshots[1].done;
    await expect(page.getByRole('heading',{name:titles[1],exact:true})).toBeVisible();
    snapshots[0].release();await snapshots[0].done;
    await expect(page.getByRole('status').filter({hasText:'正在載入活動…'})).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading',{name:titles[1],exact:true})).toBeVisible();
    await expect(form.getByLabel('活動名稱',{exact:true})).toHaveValue('較新的未送出草稿');
    page.once('dialog',dialog=>dialog.accept());await form.getByRole('button',{name:'返回',exact:true}).click();
    hold=false;
    const id=(await e2eAuthPool.query('SELECT event_id FROM community_events WHERE organizer_ref=$1 AND title=$2',[user,titles[1]])).rows[0].event_id as string;
    await page.goto(`/events/${id}`);
    const card=page.locator('.experience-card'),editor=card.locator('form');
    await expect(card.getByRole('heading',{name:titles[1],exact:true})).toBeVisible();
    await page.route(`**/api/v1/events/${id}/update`,async route=>{
      const response=await route.fetch();
      writes.push({path:'update',version:route.request().headers()['if-match'],status:response.status(),body:await response.json()});
      await route.fulfill({response});
    });
    hold=true;
    for(const suffix of [' 修改一',' 修改二']){
      await card.getByRole('button',{name:'編輯草稿',exact:true}).click();
      await editor.getByLabel('活動名稱',{exact:true}).fill(titles[1]+suffix);
      await editor.getByRole('button',{name:'儲存修改',exact:true}).click();
      await expect(editor).toHaveCount(0);
    }
    expect(writes.map(write=>write.version)).toEqual(['"1"','"2"']);
    expect(writes.map(write=>write.status)).toEqual([200,200]);
    await card.getByRole('button',{name:'編輯草稿',exact:true}).click();
    const photo=await sharp({create:{width:700,height:1050,channels:3,background:'#366177'}}).png().toBuffer();
    const video=await readFile('tests/media-fixtures/event-video-160x90.mp4');
    await editor.getByLabel('活動海報（選填）').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:photo});
    await editor.getByLabel('活動影片（選填）').setInputFiles({name:'synthetic.mp4',mimeType:'video/mp4',buffer:video});
    const media:{path:string;version:string|undefined;status:number;bytes:string}[]=[];
    let rejectVideo=true;
    await page.route(`**/api/v1/events/${id}/banner`,async route=>{
      const response=await route.fetch();
      media.push({path:'banner',version:route.request().headers()['if-match'],status:response.status(),bytes:route.request().postDataBuffer()!.toString('base64')});
      await route.fulfill({response});
    });
    await page.route(`**/api/v1/events/${id}/video`,async route=>{
      // Real server rejection; selected File bytes remain untouched for recovery.
      const response=await route.fetch(rejectVideo?{headers:{...route.request().headers(),'content-type':'image/gif'}}:{});
      media.push({path:'video',version:route.request().headers()['if-match'],status:response.status(),bytes:route.request().postDataBuffer()!.toString('base64')});
      await route.fulfill({response});
    });
    await editor.getByRole('button',{name:'儲存修改',exact:true}).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(media.map(entry=>[entry.path,entry.version,entry.status])).toEqual([['banner','"4"',200],['video','"5"',415]]);
    await expect(editor.getByLabel('活動名稱',{exact:true})).toHaveValue(titles[1]+' 修改二');
    page.once('dialog',dialog=>dialog.dismiss());await navigate(page,'我的內容');
    await expect(page).toHaveURL(new RegExp(`/events/${id}$`));
    await editor.getByRole('button',{name:'重試保存',exact:true}).click();
    rejectVideo=false;await editor.getByRole('button',{name:'儲存修改',exact:true}).click();
    await expect(editor).toHaveCount(0);
    expect(writes.map(write=>write.version)).toEqual(['"1"','"2"','"3"','"5"']);
    expect(media.map(entry=>[entry.path,entry.version,entry.status])).toEqual([['banner','"4"',200],['video','"5"',415],['video','"6"',200]]);
    expect(media[2].bytes).toBe(media[1].bytes);
    const durable=(await e2eAuthPool.query('SELECT title,aggregate_version FROM community_events WHERE organizer_ref=$1 ORDER BY title',[user])).rows;
    expect(durable).toHaveLength(2);expect(Number(durable.find(row=>row.title===titles[1]+' 修改二')!.aggregate_version)).toBe(7);
    await info.attach('held-refresh-version-media',{body:JSON.stringify({width,snapshots:snapshots.map(value=>value.body),writes,media,durable}),contentType:'application/json'});
    await page.screenshot({path:info.outputPath(`confirmed-media-${width}.png`),fullPage:true});
  }finally{hold=false;for(const snapshot of snapshots)snapshot.release();}
});

for(const kind of ['banner','video'] as const)for(const ack of ['lost','malformed'] as const)eventTest(`${kind} committed with ${ack} ACK reconciles before another mutation`,async({page,e2eAuthPool,eventFixture:{user,email}},info)=>{
  const title=`媒體對帳 ${user}`;
  await login(page,email);await navigate(page,'社群活動');
  await expect(page.getByText('目前沒有即將舉辦的活動。你可以提交第一場。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
  const composer=page.locator('form').filter({has:page.getByRole('heading',{name:'提交活動',exact:true})});
  await composer.getByLabel('活動名稱',{exact:true}).fill(title);await composer.getByLabel('活動說明',{exact:true}).fill('已提交但 ACK 遺失或格式不符，不可再次產生媒體效果。');await composer.getByLabel('線上場地',{exact:true}).fill('合成場地');
  const created=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/events');
  await composer.getByRole('button',{name:'送出審核',exact:true}).click();const id=(await(await created).json()).event_id as string;
  await expect(composer).toHaveCount(0);await page.goto(`/events/${id}`);
  const card=page.locator('.experience-card'),editor=card.locator('form');
  await card.getByRole('button',{name:'編輯草稿',exact:true}).click();
  const photo=await sharp({create:{width:700,height:1050,channels:3,background:'#366177'}}).png().toBuffer();
  await editor.getByLabel('活動海報（選填）').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:photo});
  await editor.getByLabel('活動影片（選填）').setInputFiles({name:'synthetic.mp4',mimeType:'video/mp4',buffer:await readFile('tests/media-fixtures/event-video-160x90.mp4')});
  await expect(editor.getByRole('button',{name:'儲存修改',exact:true})).toBeEnabled();
  const updates:string[]=[],commands:{kind:string;key:string|undefined;version:string|undefined;bytes:string;status:number}[]=[];
  await page.route(`**/api/v1/events/${id}/update`,async route=>{updates.push(route.request().headers()['if-match']);await route.continue();});
  for(const media of ['banner','video'])await page.route(`**/api/v1/events/${id}/${media}`,async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const response=await route.fetch();expect(response.status()).toBe(200);
    commands.push({kind:media,key:route.request().headers()['idempotency-key'],version:route.request().headers()['if-match'],bytes:route.request().postDataBuffer()!.toString('base64'),status:response.status()});
    if(media===kind&&commands.filter(entry=>entry.kind===kind).length===1){
      if(ack==='lost')await route.abort('failed');else await route.fulfill({response,body:'{}'});
    }else await route.fulfill({response});
  });
  let release!:()=>void,releaseList!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),heldList=new Promise<void>(resolve=>{releaseList=resolve;});
  let reads=0,reached=false,listReached=false,failRead=kind==='banner'&&ack==='lost';
  await page.route('**/api/v1/events',async route=>{
    if(route.request().method()!=='GET')return route.continue();
    const response=await route.fetch();expect(response.status()).toBe(200);
    listReached=true;await heldList;await route.fulfill({response});
  });
  await page.route(`**/api/v1/events/${id}`,async route=>{
    if(route.request().method()!=='GET'||!commands.length)return route.continue();
    reads++;
    if(failRead){failRead=false;await route.fulfill({status:503,contentType:'application/problem+json',body:JSON.stringify({detail:'合成對帳讀取失敗'})});return;}
    const response=await route.fetch();expect(response.status()).toBe(200);reached=true;await held;await route.fulfill({response});
  });
  try{
    await editor.getByRole('button',{name:'儲存修改',exact:true}).click();
    if(kind==='banner'&&ack==='lost'){
      await expect(page.getByRole('alert').filter({hasText:'尚未確認媒體保存結果'})).toBeVisible();
      await expect(editor.getByRole('button',{name:'儲存修改',exact:true})).toBeDisabled();
      expect(commands.filter(entry=>entry.kind===kind)).toHaveLength(1);expect(updates).toEqual(['"1"']);
      await editor.getByRole('button',{name:'重試確認保存',exact:true}).click();
    }
    await expect.poll(()=>reached).toBe(true);
    await expect(editor.getByLabel('活動名稱',{exact:true})).toBeDisabled();
    for(const input of await editor.locator('input[type="file"]').all())await expect(input).toBeDisabled();
    for(const name of ['儲存修改','重試確認保存'])await expect(editor.getByRole('button',{name,exact:true})).toBeDisabled();
    for(const name of ['編輯草稿','取消活動'])await expect(card.getByRole('button',{name,exact:true})).toBeDisabled();
    if(kind==='video')await expect(card.getByRole('button',{name:'移除海報',exact:true})).toBeDisabled();
    // Even direct form submission cannot bypass the unknown-outcome guard.
    await editor.evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    await navigate(page,'我的內容');await expect(page).toHaveURL(new RegExp(`/events/${id}$`));
    expect(updates).toEqual(['"1"']);expect(commands.filter(entry=>entry.kind===kind)).toHaveLength(1);
    expect(commands.filter(entry=>entry.kind==='video')).toHaveLength(kind==='banner'?0:1);
    const committed=(await e2eAuthPool.query('SELECT command FROM transition_journal WHERE aggregate_id=$1 AND command=$2',[id,`save_${kind}`])).rows;
    expect(committed).toHaveLength(1);
    release();await expect(editor).toHaveCount(0);await expect.poll(()=>listReached).toBe(true);
    const replay=commands.filter(entry=>entry.kind===kind);expect(replay).toHaveLength(2);expect(replay[0].key).toBeTruthy();expect(replay[1]).toEqual(replay[0]);
    expect(updates).toEqual(['"1"']);
    const durable=(await e2eAuthPool.query("SELECT command,count(*)::int AS n FROM transition_journal WHERE aggregate_id=$1 AND command IN ('save_banner','save_video') GROUP BY command ORDER BY command",[id])).rows;
    expect(durable).toEqual([{command:'save_banner',n:1},{command:'save_video',n:1}]);
    expect(Number((await e2eAuthPool.query('SELECT aggregate_version FROM community_events WHERE event_id=$1',[id])).rows[0].aggregate_version)).toBe(4);
    // Confirmed recovery also releases departure without waiting for a list refresh.
    await navigate(page,'我的內容');await expect(page).toHaveURL(/#my-content$/);
    await info.attach('media-reconciliation',{body:JSON.stringify({kind,ack,reads,updates,commands,durable}),contentType:'application/json'});
  }finally{release();releaseList();}
});

eventTest('superseded event reads cannot replace the newest loading or error state',async({page,eventFixture:{user,email}})=>{
  await login(page,email);await navigate(page,'社群活動');
  await expect(page.getByText('目前沒有即將舉辦的活動。你可以提交第一場。',{exact:true})).toBeVisible();
  const snapshots:{release:(failure:boolean)=>void;done:Promise<void>}[]=[];
  let closing=false;
  await page.route('**/api/v1/events',async route=>{
    if(route.request().method()!=='GET')return route.continue();
    const response=await route.fetch();expect(response.status()).toBe(200);
    if(closing)return route.fulfill({response});
    let release!:(failure:boolean)=>void,complete!:()=>void;
    const wait=new Promise<boolean>(resolve=>{release=resolve;}),done=new Promise<void>(resolve=>{complete=resolve;});
    const index=snapshots.length;snapshots.push({release,done});
    const failure=await wait;
    await route.fulfill(failure?{status:503,contentType:'application/problem+json',body:JSON.stringify({detail:`合成刷新失敗 ${index}`})}:{response});complete();
  });
  async function create(index:number){
    await page.getByRole('button',{name:'＋ 提交活動',exact:true}).click();
    const form=page.locator('form').filter({has:page.getByRole('heading',{name:'提交活動',exact:true})});
    await form.getByLabel('活動名稱',{exact:true}).fill(`讀取狀態 ${index} ${user}`);await form.getByLabel('活動說明',{exact:true}).fill('合成列表競態');await form.getByLabel('線上場地',{exact:true}).fill('合成場地');
    await form.getByRole('button',{name:'送出審核',exact:true}).click();await expect(form).toHaveCount(0);
  }
  const loading=page.getByRole('status').filter({hasText:'正在載入活動…'});
  try{
    await create(1);await expect.poll(()=>snapshots.length).toBe(1);
    await create(2);await expect.poll(()=>snapshots.length).toBe(2);
    snapshots[1].release(true);await snapshots[1].done;
    await expect(page.getByRole('alert').filter({hasText:'服務暫時無法回應（503）。請稍後重試。'})).toBeVisible();await expect(loading).toHaveCount(0);
    snapshots[0].release(false);await snapshots[0].done;
    await expect(page.getByRole('alert').filter({hasText:'服務暫時無法回應（503）。請稍後重試。'})).toBeVisible();await expect(loading).toHaveCount(0);
    await page.getByRole('button',{name:'重試',exact:true}).click();await expect.poll(()=>snapshots.length).toBe(3);
    await create(3);await expect.poll(()=>snapshots.length).toBe(4);
    snapshots[2].release(true);await snapshots[2].done;
    await expect(loading).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
    snapshots[3].release(false);await snapshots[3].done;
    await expect(loading).toHaveCount(0);await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading',{name:`讀取狀態 3 ${user}`,exact:true})).toBeVisible();
  }finally{closing=true;for(const snapshot of snapshots)snapshot.release(false);}
});
