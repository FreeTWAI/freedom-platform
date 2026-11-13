import {eventAppPath} from './navigation.js';
import {randomUUID} from 'node:crypto';
import {hashPassword} from '../../modules/identity-membership/service.js';
import {test as base,expect,type Page,type Locator} from './fixtures.js';
import {Pool} from 'pg';
import {serve} from '@hono/node-server';
import {serveStatic} from '@hono/node-server/serve-static';
import {LOCAL_DATABASE_URL} from '../../packages/db/index.js';
import {migrate} from '../../scripts/database.js';
import {seedLocal,DEMO_COMMUNITY} from '../../packages/testing/seed.js';
import {e2eSchema,resetE2eAuthState} from '../../packages/testing/e2e-auth-isolation.js';
import {createApp} from '../../apps/platform-api/src/app.js';
import {TENANT_CURSOR_TEST_KEY} from '../runtime/tenant-cursor-fixture.js';
import {navigate,signOut} from './navigation.js';

// Authoring only: execute through the official isolated local/CI E2E harness.
// Never point this journey or its synthetic fixture at a production database.
// Publication retains immutable credit facts. Own the entire schema so those
// identities never leak into another file's single-community guild catalog.
const test=base.extend({
  e2eAuthPool:[async({},use,workerInfo)=>{
    if(workerInfo.config.workers!==1)throw Error('The event fixture requires one worker.');
    const schema=e2eSchema(`fp_e2e_${randomUUID().replaceAll('-','')}`);
    const connectionString=process.env.TEST_DATABASE_URL??LOCAL_DATABASE_URL;
    const admin=new Pool({connectionString,max:1});
    const pool=new Pool({connectionString,options:`-c search_path=${schema}`,application_name:schema});
    try{
      await admin.query(`CREATE SCHEMA ${schema}`);
      await migrate(pool);await seedLocal(pool);
      await use(pool);
    }finally{
      await pool.end();
      try{await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await admin.end();}
    }
  },{scope:'worker'}],
  isolateAuth:async({e2eAuthPool},use)=>{
    const schema=e2eSchema((await e2eAuthPool.query('SELECT current_schema() AS schema')).rows[0].schema);
    await resetE2eAuthState(e2eAuthPool,schema);await use();
  },
  baseURL:async({e2eAuthPool},use)=>{
    let app:ReturnType<typeof createApp>|undefined;
    const server=serve({hostname:'127.0.0.1',port:0,fetch:request=>app?app.fetch(request):new Response(null,{status:503})});
    try{
      if(!server.listening)await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
      const address=server.address();if(!address||typeof address==='string')throw Error('Event fixture listener unavailable.');
      const origin=`http://127.0.0.1:${address.port}`;
      app=createApp(e2eAuthPool,origin,'local',{registrationCommunityId:DEMO_COMMUNITY,tenantCursorSigningKey:TENANT_CURSOR_TEST_KEY});
      app.use('/*',serveStatic({root:'./apps/portal-web/dist'}));
      app.get('*',serveStatic({path:'./apps/portal-web/dist/index.html'}));
      await use(origin);
    }finally{
      if('closeAllConnections' in server)server.closeAllConnections();
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  },
});
test.use({timezoneId:'Asia/Taipei'});
const eventTest=test.extend<{eventFixture:{user:string;email:string;reviewerEmail:string}}>({
  eventFixture:async({page,e2eAuthPool},use,info)=>{
    const community=randomUUID(),user=randomUUID(),email=`event-fixture-${user}@example.test`;
    const reviewer=randomUUID(),reviewerEmail=`prize-reviewer-${reviewer}@example.test`;
    const before=Number((await e2eAuthPool.query('SELECT count(*) FROM communities')).rows[0].count);
    let setupFailed=false;
    try{
      await e2eAuthPool.query("INSERT INTO communities(community_id,name) VALUES($1,'合成活動隔離社群')",[community]);
      await e2eAuthPool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
        VALUES($1,$2,$3,'合成活動會員',$4,$5,false)`,[user,community,email,hashPassword('freedom-local-demo'),randomUUID()]);
      await e2eAuthPool.query(`INSERT INTO users(user_id,community_id,email,display_name,password_hash,profession_membership_ref,onboarding_required)
        VALUES($1,$2,$3,'合成獎品審核員',$4,$5,false)`,[reviewer,community,reviewerEmail,hashPassword('freedom-local-demo'),randomUUID()]);
      await e2eAuthPool.query(`INSERT INTO positioning_profession_memberships(membership_id,community_id,user_id,guild_key,state)
        VALUES($1,$2,$3,'guild_member_operations','active')`,[randomUUID(),community,reviewer]);
      await e2eAuthPool.query(`INSERT INTO positioning_guild_officers(community_id,guild_key,user_id)
        VALUES($1,'guild_member_operations',$2)`,[community,reviewer]);
      await use({user,email,reviewerEmail});
    }catch(error){setupFailed=true;throw error;}
    finally{
      // Test finally blocks release the gates before fixture teardown. Settle
      // their handlers and close the page before deleting any application data.
      const results=await Promise.allSettled([page.unrouteAll({behavior:'wait'})]);
      results.push(...await Promise.allSettled([page.close()]));
      results.push(...await Promise.allSettled([(async()=>{
        const q=await e2eAuthPool.connect();let retainedCreditFacts=0,retainedShares=0;
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
          // Remove only diagnostics belonging to this synthetic community.
          await q.query('DELETE FROM member_client_errors WHERE community_id=$1',[community]);
          await q.query('DELETE FROM outbox WHERE transition_id IN (SELECT transition_id FROM transition_journal WHERE community_id=$1)',[community]);
          await q.query('DELETE FROM transition_journal WHERE community_id=$1',[community]);
          await q.query('DELETE FROM command_receipts WHERE user_id IN (SELECT user_id FROM users WHERE community_id=$1)',[community]);
          await q.query('DELETE FROM positioning_guild_officers WHERE community_id=$1',[community]);
          for(const table of ['member_accounts','member_notification_preferences','member_first_participation','guild_preference_sets','guild_member_preferences','member_skill_book_grants','positioning_profession_memberships']){
            await q.query(`DELETE FROM ${table} WHERE community_id=$1`,[community]);
          }
          await q.query('DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE community_id=$1)',[community]);
          retainedCreditFacts=Number((await q.query('SELECT count(*) FROM share_credit_events WHERE community_id=$1',[community])).rows[0].count);
          retainedShares=Number((await q.query('SELECT count(*) FROM shares WHERE community_id=$1',[community])).rows[0].count);
          if(retainedShares){
            // Instant publication creates immutable credit facts. Keep their FK
            // identities until the harness drops its schema; disable all access.
            await q.query('UPDATE users SET active=false WHERE community_id=$1',[community]);
            await q.query('UPDATE promotion_links SET revoked_at=COALESCE(revoked_at,now()) WHERE community_id=$1',[community]);
          }else{
            await q.query('DELETE FROM users WHERE community_id=$1',[community]);
            await q.query('DELETE FROM communities WHERE community_id=$1',[community]);
          }
          await q.query('COMMIT');
        }catch(error){await q.query('ROLLBACK');throw error;}
        finally{q.release();}
        const remaining=Number((await e2eAuthPool.query('SELECT count(*) FROM communities WHERE community_id=$1',[community])).rows[0].count);
        const after=Number((await e2eAuthPool.query('SELECT count(*) FROM communities')).rows[0].count);
        expect(remaining).toBe(retainedShares?1:0);expect(after).toBe(before+(retainedShares?1:0));
        expect(Number((await e2eAuthPool.query('SELECT count(*) FROM users WHERE community_id=$1 AND active',[community])).rows[0].count)).toBe(0);
        expect(Number((await e2eAuthPool.query('SELECT count(*) FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE community_id=$1)',[community])).rows[0].count)).toBe(0);
        expect(Number((await e2eAuthPool.query('SELECT count(*) FROM community_events WHERE community_id=$1',[community])).rows[0].count)).toBe(0);
        expect(Number((await e2eAuthPool.query('SELECT count(*) FROM share_credit_events WHERE community_id=$1',[community])).rows[0].count)).toBe(retainedCreditFacts);
        await info.attach('event-fixture-cleanup',{body:JSON.stringify({community,before,after,remaining,retainedShares,retainedCreditFacts}),contentType:'application/json'});
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
async function login(page:Page,email:string){
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

const prize={name:'合成入門書',description:'一起完成練習後使用的合成教材。',quantity:3,icon_id:'book',completion_rule:'完成現場練習，由主辦者依作品評選三位。',claim_note:'主辦者於活動結束前公布結果，得獎者當場領取。'};
async function openComposer(page:Page,email:string,title:string){
  await login(page,email);await navigate(page,'社群活動');
  await page.getByRole('button',{name:'辦活動',exact:true}).click();
  const form=page.locator('form').filter({has:page.getByRole('heading',{name:'辦一場活動',exact:true})});
  await form.getByLabel('活動名稱',{exact:true}).fill(title);
  await form.getByText('選填設定',{exact:true}).click();
  await form.getByLabel('活動說明',{exact:true}).fill('合成活動：只有獎品說明，沒有真實發獎或付款。');
  await form.getByLabel('地點',{exact:true}).fill('合成教室');
  return form;
}
async function fillPrize(form:Locator){
  await form.getByRole('button',{name:'加入獎品',exact:true}).click();
  await expect(form.getByLabel('獎品名稱',{exact:true})).toBeFocused();
  await form.getByLabel('獎品名稱',{exact:true}).fill(prize.name);
  await form.getByLabel('獎品介紹（選填）',{exact:true}).fill(prize.description);
  await form.getByLabel('準備幾份',{exact:true}).fill(String(prize.quantity));
  await form.getByLabel('要做到什麼',{exact:true}).fill(prize.completion_rule);
  await form.getByLabel('怎麼領取',{exact:true}).fill(prize.claim_note);
  await form.getByRole('radio',{name:'書本',exact:true}).check();
}
async function save(page:Page,form:Locator,id?:string){
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===(id?`/api/v1/events/${id}/update`:'/api/v1/events'));
  await form.getByRole('button',{name:id?'儲存修改':'發布',exact:true}).click();
  const result=await response;expect(result.status()).toBe(id?200:201);
  const body=await result.json();await expect(form).toHaveCount(0);return body;
}
// Existing pending records remain editable after instant publication was added.
// Clone only the event fields into a distinct legacy fixture; never downgrade the
// newly published event or alter its share/credit history. The legacy draft uses
// the fixture officer’s review guild, as pending records did before publication.
async function legacyDraft(pool:Pool,publishedId:string){
  const id=randomUUID();
  await pool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,guild_key,title,description,starts_at,ends_at,mode,location,capacity,event_kind,topic,online_url,review_guild_key,visibility,help_need,registration_policy,prize_details,state)
    SELECT $1,community_id,organizer_ref,guild_key,title||'（既有草稿）',description,starts_at,ends_at,mode,location,capacity,event_kind,topic,online_url,'guild_member_operations',visibility,help_need,registration_policy,prize_details,'pending'
    FROM community_events WHERE event_id=$2 AND state='published'`,[id,publishedId]);
  expect((await pool.query('SELECT state FROM community_events WHERE event_id=$1',[publishedId])).rows[0].state).toBe('published');
  expect((await pool.query('SELECT state FROM community_events WHERE event_id=$1',[id])).rows[0].state).toBe('pending');
  return id;
}
async function expectPrize(region:Locator,name=prize.name,canManagePhoto=false){
  await expect(region).toBeVisible();
  for(const text of [name,prize.description,'共 3 份',prize.completion_rule,prize.claim_note,'不代表已發獎'])await expect(region).toContainText(text);
  await expect(region.locator('input,textarea')).toHaveCount(0);
  await expect(region.getByRole('button')).toHaveCount(canManagePhoto?1:0);
  if(canManagePhoto)await expect(region.getByRole('button',{name:`管理 ${name} 的照片`,exact:true})).toBeEnabled();
  await expect(region.locator('svg')).toHaveAttribute('aria-hidden','true');
}
async function approve(page:Page,reviewerEmail:string,id:string){
  await logout(page);await login(page,reviewerEmail);await page.goto(eventAppPath(`/events/${id}`));
  const card=page.locator('.experience-card');
  await card.getByRole('button',{name:'審核活動',exact:true}).click();
  await card.getByLabel('審核理由',{exact:true}).fill('合成審核：核對活動及獎品說明，不代表已選出得獎者。');
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===`/api/v1/events/${id}/review`);
  await card.getByRole('button',{name:'核准並公告',exact:true}).click();
  const result=await response;expect(result.status()).toBe(200);expect((await result.json()).state).toBe('published');
  await expect(card).toContainText('開放報名');
}

for(const width of [320,390])eventTest(`prize description survives create, reload, edit and real publication at ${width}px`,async({page,browser,e2eAuthPool,eventFixture},info)=>{
  await page.setViewportSize({width,height:844});
  const form=await openComposer(page,eventFixture.email,`合成獎品活動 ${eventFixture.user}`);
  await form.getByRole('combobox',{name:/^參與範圍/}).selectOption('open');
  await fillPrize(form);
  await form.getByText('送出前預覽活動',{exact:true}).click();
  await expect(form.getByRole('region',{name:'獎品預覽',exact:true})).toContainText(prize.name);
  const created=await save(page,form);
  expect(created.state).toBe('published');
  const id=await legacyDraft(e2eAuthPool,created.event_id);expect(created.prize_details).toHaveLength(1);
  expect(created.prize_details[0]).toMatchObject(prize);
  const stableId=created.prize_details[0].prize_id as string;
  expect(stableId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const immediateGuest=await browser.newContext({viewport:{width,height:844}});
  try{
    const publicPage=await immediateGuest.newPage();
    await publicPage.goto(new URL(eventAppPath(`/events/${created.event_id}`),page.url()).href);
    await expectPrize(publicPage.getByRole('region',{name:'活動獎品說明',exact:true}));
    await expect(publicPage.getByRole('button',{name:'編輯草稿',exact:true})).toHaveCount(0);
  }finally{await immediateGuest.close();}
  await page.goto(eventAppPath(`/events/${id}`));await page.reload();
  const card=page.locator('.experience-card'),details=card.getByRole('region',{name:'活動獎品說明',exact:true});
  await expectPrize(details,prize.name,true);
  await card.getByRole('button',{name:'編輯草稿',exact:true}).click();
  const editor=card.locator('form.experience-editor');
  for(const [label,value] of [['獎品名稱',prize.name],['獎品介紹（選填）',prize.description],['準備幾份','3'],['要做到什麼',prize.completion_rule],['怎麼領取',prize.claim_note]])await expect(editor.getByLabel(label,{exact:true})).toHaveValue(value);
  await expect(editor.getByRole('radio',{name:'書本',exact:true})).toBeChecked();
  const renamed='合成入門書（更新版）';await editor.getByLabel('獎品名稱',{exact:true}).fill(renamed);
  const edited=await save(page,editor,id);
  expect(edited.prize_details).toEqual([{...prize,name:renamed,prize_id:stableId}]);
  await page.reload();await expectPrize(details,renamed,true);
  const guest=await browser.newContext({viewport:{width,height:844}});
  try{
    const publicPage=await guest.newPage();
    await publicPage.goto(new URL(eventAppPath(`/events/${id}`),page.url()).href);
    await expect(publicPage.getByRole('heading',{name:'活動目前無法公開查看',exact:true})).toBeVisible();
    await expect(publicPage.getByRole('region',{name:'活動獎品說明',exact:true})).toHaveCount(0);
    await approve(page,eventFixture.reviewerEmail,id);
    await publicPage.reload();
    const publicDetails=publicPage.getByRole('region',{name:'活動獎品說明',exact:true});
    await expectPrize(publicDetails,renamed);
    expect(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await publicPage.evaluate(()=>window.scrollTo(0,0));
    await publicPage.screenshot({path:info.outputPath(`public-prize-${width}.png`),fullPage:true});
    // Published promises are not silently editable, including by the organizer.
    await logout(page);await login(page,eventFixture.email);await page.goto(eventAppPath(`/events/${id}`));
    await expectPrize(details,renamed);await expect(card.getByRole('button',{name:'編輯草稿',exact:true})).toHaveCount(0);
    const durable=(await e2eAuthPool.query('SELECT state,prize_details FROM community_events WHERE event_id=$1 AND organizer_ref=$2',[id,eventFixture.user])).rows[0];
    expect(durable).toEqual({state:'published',prize_details:[{...prize,name:renamed,prize_id:stableId}]});
    await expect(publicDetails).toContainText('報名、活動結束或分享成果也不代表已符合條件');
  }finally{await guest.close();}
});

for(const width of [320,390])eventTest(`prize keyboard, errors, removal and enlarged text remain usable at ${width}px`,async({page,eventFixture},info)=>{
  await page.setViewportSize({width,height:844});
  const form=await openComposer(page,eventFixture.email,`合成操作檢查 ${eventFixture.user}`);
  await fillPrize(form);
  const field=form.getByRole('group',{name:'獎品 1',exact:true});
  const radios=field.getByRole('group',{name:'選擇獎品插圖',exact:true});
  await expect(radios.getByRole('radio')).toHaveCount(6);
  await radios.getByRole('radio',{name:'禮物',exact:true}).focus();await page.keyboard.press('Space');
  for(const label of ['獎盃','獎牌','書本','入場券','禮券','禮物']){
    await page.keyboard.press('ArrowRight');
    await expect(radios.getByRole('radio',{name:label,exact:true})).toBeFocused();
    await expect(radios.getByRole('radio',{name:label,exact:true})).toBeChecked();
  }
  await page.keyboard.press('Tab');await expect(field.getByRole('button',{name:'移除獎品 1',exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(radios.getByRole('radio',{name:'禮物',exact:true})).toBeFocused();
  expect(await radios.locator('label').filter({has:page.getByRole('radio',{name:'禮物',exact:true})}).evaluate(node=>getComputedStyle(node).outlineStyle)).not.toBe('none');
  for(const target of [field.getByLabel('獎品名稱',{exact:true}),field.getByLabel('準備幾份',{exact:true}),field.getByLabel('要做到什麼',{exact:true}),field.getByRole('button',{name:'移除獎品 1',exact:true})]){
    await target.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(target).toBeFocused();
    const outline=await target.evaluate(node=>({style:getComputedStyle(node).outlineStyle,width:parseFloat(getComputedStyle(node).outlineWidth)}));
    expect(outline.style).not.toBe('none');expect(outline.width).toBeGreaterThanOrEqual(2);
  }
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/v1/events')writes++;});
  for(const [label,valid] of [['要做到什麼',prize.completion_rule],['怎麼領取',prize.claim_note]]){
    const input=field.getByLabel(label,{exact:true});
    for(const invalid of ['', '   ']){
      await input.fill(invalid);await form.getByRole('button',{name:'發布',exact:true}).click();
      await expect(input).toBeFocused();await expect(input).toHaveAttribute('aria-invalid','true');
      await expect(input).toHaveAccessibleDescription(`請填寫${label}。`);
      await expect(field.getByRole('alert').filter({hasText:`請填寫${label}。`})).toBeVisible();
      expect(writes).toBe(0);
    }
    await input.fill(valid);await input.blur();await expect(input).not.toHaveAttribute('aria-invalid','true');
  }
  for(const invalid of ['0','501','1.5']){
    const quantity=field.getByLabel('準備幾份',{exact:true});await quantity.fill(invalid);
    await form.getByRole('button',{name:'發布',exact:true}).click();
    await expect(quantity).toBeFocused();await expect(quantity).toHaveAccessibleDescription('請填寫 1 到 500 的整數份數。');expect(writes).toBe(0);
  }
  await field.getByLabel('準備幾份',{exact:true}).fill('3');
  await field.getByRole('button',{name:'移除獎品 1',exact:true}).click();
  await expect(field.getByRole('button',{name:'保留獎品',exact:true})).toBeFocused();
  await field.getByRole('button',{name:'保留獎品',exact:true}).click();
  await expect(field.getByRole('button',{name:'移除獎品 1',exact:true})).toBeFocused();
  await expect(field.getByLabel('獎品名稱',{exact:true})).toHaveValue(prize.name);
  await expect(field.getByLabel('要做到什麼',{exact:true})).toHaveValue(prize.completion_rule);
  await expect(field.getByLabel('怎麼領取',{exact:true})).toHaveValue(prize.claim_note);
  // Text enlargement (not browser zoom): preserve the actual computed baseline.
  const base=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize));
  const calendarText=page.locator('.event-calendar-heading h2,.event-calendar-nav strong,.event-calendar-nav button,.event-calendar-weekday,.event-calendar-day>time');
  const calendarBaseFonts=await calendarText.evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)));
  expect(calendarBaseFonts.length).toBeGreaterThan(9);
  for(const scale of [1,2]){
    await page.evaluate(size=>{document.documentElement.style.fontSize=`${size}px`;},base*scale);
    // Retain the actual enlarged layout before any failing geometry assertion.
    const layout=await page.evaluate(()=>({rootFont:getComputedStyle(document.documentElement).fontSize,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      overflow:[...document.querySelectorAll('body *')].flatMap(node=>{const r=node.getBoundingClientRect();if(!node.getClientRects().length||!r.width||r.left>=0&&r.right<=innerWidth+1)return [];const css=getComputedStyle(node);return [{tag:node.tagName,className:node.getAttribute('class'),left:r.left,right:r.right,width:r.width,minWidth:css.minWidth,fontSize:css.fontSize,gridTemplateColumns:css.gridTemplateColumns}];})}));
    await info.attach(`prize-layout-${width}-${scale}x`,{body:JSON.stringify(layout),contentType:'application/json'});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:info.outputPath(`prize-fields-${width}-${scale}x.png`),fullPage:true});
    expect(parseFloat(layout.rootFont)).toBeCloseTo(base*scale,2);
    const calendarFonts=await calendarText.evaluateAll(nodes=>nodes.map(node=>parseFloat(getComputedStyle(node).fontSize)));
    expect(calendarFonts).toHaveLength(calendarBaseFonts.length);
    for(const [index,size] of calendarFonts.entries())expect(size).toBeCloseTo(calendarBaseFonts[index]*scale,2);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const calendar=await page.locator('.event-calendar').evaluate(node=>[node,...node.querySelectorAll('.event-calendar-heading,h2,.event-calendar-nav,.event-calendar-nav button,.event-calendar-nav strong,.event-calendar-grid')].map(item=>{const r=item.getBoundingClientRect();return {tag:item.tagName,left:r.left,right:r.right,width:r.width,height:r.height};}));
    for(const item of calendar){expect(item.left).toBeGreaterThanOrEqual(0);expect(item.right).toBeLessThanOrEqual(width+1);if(item.tag==='BUTTON'){expect(item.width).toBeGreaterThanOrEqual(44);expect(item.height).toBeGreaterThanOrEqual(44);}}
    const geometry=await form.locator('.event-prize-editor').evaluate(node=>({
      targets:[...node.querySelectorAll('button,input:not([type="radio"]),textarea,label.event-prize-icon-option')].map(item=>{const r=item.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right};}),
      fonts:[...node.querySelectorAll('input:not([type="radio"]),textarea')].map(item=>parseFloat(getComputedStyle(item).fontSize)),
    }));
    for(const target of geometry.targets){expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);expect(target.left).toBeGreaterThanOrEqual(0);expect(target.right).toBeLessThanOrEqual(width+1);}
    for(const size of geometry.fonts)expect(size).toBeGreaterThanOrEqual(16*scale);
  }
  await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
  await field.getByRole('button',{name:'移除獎品 1',exact:true}).click();await field.getByRole('button',{name:'確認移除',exact:true}).click();
  await expect(form.getByRole('button',{name:'加入獎品',exact:true})).toBeFocused();await expect(field).toHaveCount(0);
  const result=await save(page,form);expect(result.prize_details).toEqual([]);expect(writes).toBe(1);
});

eventTest('no-prize minimal submission stays optional and reads back empty',async({page,eventFixture,e2eAuthPool})=>{
  const form=await openComposer(page,eventFixture.email,`無獎品活動 ${eventFixture.user}`);
  await expect(form.getByLabel('獎品名稱',{exact:true})).toHaveCount(0);
  const result=await save(page,form);expect(result.prize_details).toEqual([]);expect(result.state).toBe('published');
  const id=await legacyDraft(e2eAuthPool,result.event_id);
  await page.goto(eventAppPath(`/events/${id}`));await page.reload();
  await expect(page.getByRole('region',{name:'活動獎品說明',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'編輯草稿',exact:true}).click();
  await expect(page.getByRole('button',{name:'加入獎品',exact:true})).toBeVisible();
  await expect(page.getByLabel('獎品名稱',{exact:true})).toHaveCount(0);
  expect((await e2eAuthPool.query('SELECT prize_details FROM community_events WHERE event_id=$1 AND organizer_ref=$2',[id,eventFixture.user])).rows[0].prize_details).toEqual([]);
});

eventTest('published workshop-only prize descriptions stay private to members',async({page,browser,eventFixture})=>{
  const form=await openComposer(page,eventFixture.email,`會員獎品活動 ${eventFixture.user}`);
  // Preserve this scenario's member-only scope through the new optional settings.
  await form.getByRole('combobox',{name:'參與範圍',exact:true}).selectOption('workshop');
  await fillPrize(form);const result=await save(page,form),id=result.event_id as string;
  expect(result.visibility).toBe('workshop');expect(result.state).toBe('published');
  await logout(page);await login(page,eventFixture.reviewerEmail);await page.goto(eventAppPath(`/events/${id}`));
  await expect(page.locator('.experience-card')).toContainText('開放報名');
  await expectPrize(page.getByRole('region',{name:'活動獎品說明',exact:true}));
  const guest=await browser.newContext();
  try{
    const publicPage=await guest.newPage();await publicPage.goto(new URL(eventAppPath(`/events/${id}`),page.url()).href);
    await expect(publicPage.getByRole('heading',{name:'活動目前無法公開查看',exact:true})).toBeVisible();
    await expect(publicPage.getByRole('region',{name:'活動獎品說明',exact:true})).toHaveCount(0);
    await expect(publicPage.getByText(prize.name,{exact:true})).toHaveCount(0);
    const response=await publicPage.request.get(new URL(`/api/v1/public/events/${id}`,page.url()).href);
    expect(response.status()).toBe(404);expect(await response.text()).not.toContain(prize.claim_note);
  }finally{await guest.close();}
});

eventTest('prize item limit and quantity bounds do not imply eligibility or inventory',async({page,eventFixture})=>{
  const form=await openComposer(page,eventFixture.email,`獎品輸入界線 ${eventFixture.user}`);
  await fillPrize(form);
  const quantity=form.getByLabel('準備幾份',{exact:true});
  for(const value of ['1','500']){
    await quantity.fill(value);await quantity.blur();
    expect(await quantity.evaluate(input=>(input as HTMLInputElement).checkValidity())).toBe(true);
    await expect(quantity).not.toHaveAttribute('aria-invalid','true');
  }
  for(let i=2;i<=5;i++)await form.getByRole('button',{name:'再加一項獎品',exact:true}).click();
  await expect(form.getByLabel('獎品名稱',{exact:true})).toHaveCount(5);
  await expect(form.getByRole('button',{name:'再加一項獎品',exact:true})).toBeDisabled();
  await expect(form.getByText('一場活動最多可填 5 項獎品。',{exact:true})).toBeVisible();
  await expect(form).toContainText('不會自動選出得獎者或發獎');
  // Removing a blank item needs no confirmation and makes room again.
  await form.getByRole('button',{name:'移除獎品 5',exact:true}).click();
  await expect(form.getByLabel('獎品名稱',{exact:true})).toHaveCount(4);
  await expect(form.getByRole('button',{name:'再加一項獎品',exact:true})).toBeEnabled();
  await expect(form.getByRole('button',{name:'確認移除',exact:true})).toHaveCount(0);
});
