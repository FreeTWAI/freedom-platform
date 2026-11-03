import {randomUUID} from 'node:crypto';
import {test,expect} from './fixtures.js';
import {test as featureTest} from './member-feature-fixture.js';
import {navigate} from './navigation.js';
import {quickJoin} from './quick-join.js';

const id='10000000-0000-4000-8000-000000000001',code='abcdefghijklmnopqrstuvwx';
const future=new Date(Date.now()+86400000).toISOString();
const publicEvent={event_id:id,title:'公開共學活動',description:'一起討論並交流。',starts_at:future,ends_at:new Date(Date.parse(future)+3600000).toISOString(),mode:'online',location:'線上參與資料將寄至報名信箱',online_url:null,event_kind:'reading_group',topic:'共學',visibility:'referral',capacity:20,attending_count:0,organizer_name:'活動夥伴',banner_url:null,video_url:null,video_mime:null};

test.beforeEach(async({page})=>{
  // Legacy guest cases retain inline event login; member-policy cases below cover both discovery modes.
  await page.route('**/api/v1/site',async route=>{
    const response=await route.fetch(),site=await response.json();
    await route.fulfill({response,json:{...site,community_discovery_enabled:false,event_participation_enabled:false}});
  });
});

test('public referral event keeps its share code when the URL query loses it',async({page})=>{
  let registered:string|null=null;
  await page.route(`**/api/v1/public/events/${id}`,route=>route.fulfill({json:publicEvent}));
  await page.route(`**/api/v1/public/events/${id}/register`,async route=>{registered=route.request().postDataJSON().referral_code;await route.fulfill({json:{registered:true}})});
  await page.goto(`/events/${id}?ref=${code}`);
  await expect(page.getByRole('heading',{name:'公開共學活動'})).toBeVisible();
  await expect(page.getByText('線上參與資料將寄至報名信箱')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/event-public-phone.png',fullPage:true});
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'test-results/event-public-desktop.png',fullPage:true});
  await page.goto(`/events/${id}`);
  await expect(page.getByRole('button',{name:'報名並寄送參與資料'})).toBeEnabled();
  await page.getByLabel('你的名字').fill('訪客');
  await page.getByLabel('接收參與資料的 Email').fill('guest@example.org');
  await page.getByRole('button',{name:'報名並寄送參與資料'}).click();
  await expect(page.getByText('報名已確認；Email 服務已接受參與資訊郵件，不代表郵件已送達。請檢查收件匣。')).toBeVisible();
  expect(registered).toBe(code);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'會員登入'}).click();
  await expect(page.getByRole('button',{name:'登入',exact:true})).toBeVisible();
  expect(page.url()).toContain(`/events/${id}`);
});

for(const routeKind of ['path','hash'] as const)test(`public event ${routeKind} login preserves only the referral and keeps browser history intact`,async({page})=>{
  await page.route(`**/api/v1/public/events/${id}`,route=>route.fulfill({json:publicEvent}));
  await page.goto('/#home');
  const eventPath=routeKind==='path'?`/events/${id}?ref=${code}&utm_campaign=return-test`:`/?utm_campaign=return-test#events/${id}?ref=${code}`;
  await page.goto(eventPath);
  const safePath=routeKind==='path'?`/events/${id}?ref=${code}`:`/#events/${id}?ref=${code}`;
  const eventUrl=new URL(safePath,page.url()).href,heading=page.getByRole('heading',{name:publicEvent.title,exact:true});
  const memberLogin=page.getByRole('button',{name:'會員登入',exact:true}),returnButton=page.getByRole('button',{name:'返回活動',exact:true});
  await expect(heading).toBeVisible();
  await memberLogin.click();
  await expect(returnButton).toBeVisible();await expect(page).toHaveURL(eventUrl);
  await page.reload();await expect(returnButton).toBeVisible();await expect(page).toHaveURL(eventUrl);
  await page.getByLabel('電子郵件',{exact:true}).fill('not-submitted@example.org');
  await returnButton.click();
  await expect(heading).toBeVisible();await expect(page).toHaveURL(eventUrl);
  await memberLogin.click();await expect(returnButton).toBeVisible();
  await page.goBack();await expect(heading).toBeVisible();await expect(page).toHaveURL(eventUrl);
  await page.goForward();await expect(returnButton).toBeVisible();await expect(page).toHaveURL(eventUrl);
  // A newer destination must not inherit the same-URL event login marker.
  await page.evaluate(()=>{window.location.hash='home';});
  await expect(page.getByRole('button',{name:'登入',exact:true})).toBeVisible();
  await expect(returnButton).toHaveCount(0);
  await page.goBack();await expect(returnButton).toBeVisible();
  await returnButton.click();await expect(heading).toBeVisible();await expect(page).toHaveURL(eventUrl);
});

test('returning from event login never restores a private participation fragment',async({page})=>{
  // This synthetic token is not issued by the server and is never submitted.
  const token='t'.repeat(43),safePath=`/events/${id}`;
  await page.route(`**/api/v1/public/events/${id}`,route=>route.fulfill({json:publicEvent}));
  await page.goto(`${safePath}?utm_campaign=private-return-test#participation=${token}`);
  await page.getByRole('button',{name:'會員登入',exact:true}).click();
  await expect(page.getByRole('button',{name:'返回活動',exact:true})).toBeVisible();
  const safeUrl=new URL(safePath,page.url()).href;
  await expect(page).toHaveURL(safeUrl);
  expect(await page.evaluate(()=>JSON.stringify(window.history.state))).not.toContain(token);
  await page.goBack();await expect(page.getByRole('heading',{name:publicEvent.title,exact:true})).toBeVisible();
  await expect(page).toHaveURL(safeUrl);
  await page.goForward();await expect(page.getByRole('button',{name:'返回活動',exact:true})).toBeVisible();
  await expect(page).toHaveURL(safeUrl);
  expect(await page.evaluate(()=>JSON.stringify(window.history.state))).not.toContain(token);
});

test('the member calendar opens a future event on its dedicated page',async({page})=>{
  const starts=new Date(Date.now()+2*86400000),ends=new Date(starts.getTime()+3600000),title='未來的共學活動';
  const event={event_id:id,organizer_ref:'20000000-0000-4000-8000-000000000002',organizer_name:'活動夥伴',title,description:'一起做一個小作品。',starts_at:starts.toISOString(),ends_at:ends.toISOString(),mode:'in_person',location:'台北市',event_kind:'meetup',topic:null,online_url:null,visibility:'workshop',banner_url:null,banner_orientation:null,video_url:null,video_mime:null,capacity:null,state:'published',aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null};
  await page.route('**/api/v1/events',route=>route.fulfill({json:{items:[event]}}));
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await navigate(page,'社群活動');
  if(starts.getMonth()!==new Date().getMonth())await page.getByRole('button',{name:'下個月'}).click();
  await page.getByRole('button',{name:title}).click();
  await expect(page).toHaveURL(new RegExp(`#events/${id}$`));
  await expect(page.getByRole('region',{name:'活動專頁'}).getByRole('heading',{name:title})).toBeVisible();
});

const acceptedMail:{to:string;subject:string;body:string}[]=[];
let rejectedRecipient='';
featureTest.describe('event-scoped public registration lifetime',()=>{
  featureTest.use({memberFeatures:{eventEmailSender:async(to,subject,body)=>{
    if(to===rejectedRecipient)throw new Error('local_provider_rejected');
    acceptedMail.push({to,subject,body});
  }}});

  featureTest('same-document A -> B -> A navigation scopes public event registration state while preserving committed registrations',async({page,e2eAuthPool})=>{
    await page.unroute('**/api/v1/site');
    acceptedMail.length=0;
    const eventA=randomUUID(),eventB=randomUUID();
    const titleA=`公開活動甲 ${eventA.slice(0,8)}`,titleB=`公開活動乙 ${eventB.slice(0,8)}`;
    const firstEmail=`guest-a1-${eventA.slice(0,8)}@example.org`,secondEmail=`guest-a2-${eventA.slice(0,8)}@example.org`,failEmailB=`guest-b-${eventB.slice(0,8)}@example.org`;
    rejectedRecipient=failEmailB;
    const starts=new Date(Date.now()+2*86400000).toISOString(),ends=new Date(Date.parse(starts)+3600000).toISOString();
    let registerCallsA=0,release!:()=>void,started!:()=>void,done!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;}),requested=new Promise<void>(resolve=>{started=resolve;}),settled=new Promise<void>(resolve=>{done=resolve;});
    await e2eAuthPool.query(
      `INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind,capacity)
       SELECT $1::uuid,community_id,user_id,$2,'第一場公開活動說明',$5::timestamptz,$6::timestamptz,'online','線上教室甲','published','open','other',20 FROM users WHERE email='maker@local.test'
       UNION ALL
       SELECT $3::uuid,community_id,user_id,$4,'第二場公開活動說明',$5::timestamptz,$6::timestamptz,'online','線上教室乙','published','open','other',20 FROM users WHERE email='maker@local.test'`,
      [eventA,titleA,eventB,titleB,starts,ends],
    );
    try {
      await page.route(`**/api/v1/public/events/${eventA}/register`,async route=>{
        registerCallsA+=1;
        if(registerCallsA===1){
          const committed=await route.fetch();expect(committed.status()).toBe(200);
          expect(await committed.json()).toEqual({registered:true,provider_status:'provider_accepted'});
          started();await pending;
          await route.fulfill({response:committed});done();return;
        }
        return route.continue();
      });

      await page.goto(`/#events/${eventA}`);
      const nameInput=page.getByLabel('你的名字',{exact:true}),emailInput=page.getByLabel('接收參與資料的 Email',{exact:true});
      const submitButton=page.getByRole('button',{name:'報名並寄送參與資料',exact:true});
      const confirmation=page.getByRole('status').filter({hasText:'報名已確認'});
      await expect(page.getByRole('heading',{name:titleA,exact:true})).toBeVisible();
      await nameInput.fill('第一位訪客');
      await emailInput.fill(firstEmail);
      await submitButton.click();await requested;
      await expect(page.getByRole('button',{name:'寄送中…',exact:true})).toBeDisabled();
      await expect(confirmation).toHaveCount(0);

      await page.evaluate(nextId=>{window.location.hash=`events/${nextId}`;},eventB);
      await expect(page.getByRole('heading',{name:titleB,exact:true})).toBeVisible();
      await expect(nameInput).toHaveValue('');
      await expect(emailInput).toHaveValue('');
      await expect(submitButton).toBeEnabled();
      await expect(confirmation).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await nameInput.fill('活動乙暫存訪客');
      await emailInput.fill(failEmailB);
      const failedRegistration=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/v1/public/events/${eventB}/register`&&response.request().method()==='POST');
      await submitButton.click();
      expect((await failedRegistration).status()).toBe(503);
      await expect(page.getByRole('alert')).toHaveText('服務暫時無法回應（503）。尚未確認結果，請稍後重試。');
      await expect(nameInput).toHaveValue('活動乙暫存訪客');
      await expect(emailInput).toHaveValue(failEmailB);
      await expect(submitButton).toBeEnabled();

      await page.goBack();
      await expect(page.getByRole('heading',{name:titleA,exact:true})).toBeVisible();
      await expect(nameInput).toHaveValue('');
      await expect(emailInput).toHaveValue('');
      await expect(submitButton).toBeEnabled();
      await expect(confirmation).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await nameInput.fill('第二位目前訪客');
      await emailInput.fill(secondEmail);

      release();await settled;
      await expect(nameInput).toHaveValue('第二位目前訪客');
      await expect(emailInput).toHaveValue(secondEmail);
      await expect(submitButton).toBeEnabled();
      await expect(confirmation).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);

      const firstRow=(await e2eAuthPool.query(
        'SELECT name,state,email_sent_at IS NOT NULL AS email_accepted FROM community_event_guest_rsvps WHERE event_id=$1 AND email=$2',
        [eventA,firstEmail],
      )).rows[0];
      expect(firstRow).toEqual({name:'第一位訪客',state:'going',email_accepted:true});
      expect(acceptedMail.map(item=>item.to)).toEqual([firstEmail]);

      await submitButton.click();
      await expect(confirmation).toHaveText('報名已確認；Email 服務已接受參與資訊郵件，不代表郵件已送達。請檢查收件匣。');
      await expect(submitButton).toBeDisabled();
      expect(registerCallsA).toBe(2);
      expect(acceptedMail.map(item=>item.to)).toEqual([firstEmail,secondEmail]);

      const committedRows=(await e2eAuthPool.query(
        'SELECT email,name,state,email_sent_at IS NOT NULL AS email_accepted FROM community_event_guest_rsvps WHERE event_id=$1 ORDER BY email',
        [eventA],
      )).rows;
      expect(committedRows).toEqual([
        {email:firstEmail,name:'第一位訪客',state:'going',email_accepted:true},
        {email:secondEmail,name:'第二位目前訪客',state:'going',email_accepted:true},
      ]);

      await page.goForward();
      await expect(page.getByRole('heading',{name:titleB,exact:true})).toBeVisible();
      await expect(nameInput).toHaveValue('');
      await expect(emailInput).toHaveValue('');
      await expect(submitButton).toBeEnabled();
      await expect(confirmation).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
    } finally {
      rejectedRecipient='';
      release?.();
      await page.unrouteAll({behavior:'ignoreErrors'});
      await e2eAuthPool.query('DELETE FROM community_event_guest_rsvps WHERE event_id=ANY($1::uuid[])',[[eventA,eventB]]);
      await e2eAuthPool.query('DELETE FROM community_events WHERE event_id=ANY($1::uuid[])',[[eventA,eventB]]);
      await e2eAuthPool.query('DELETE FROM auth_rate_limits');
    }
  });
});


for(const discovery of [false,true])for(const routeKind of ['path','hash'] as const)test(`member-only ${routeKind} event returns to explicit member RSVP with discovery ${discovery?'ON':'OFF'}`,async({page},info)=>{
  await page.unroute('**/api/v1/site');
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),community_discovery_enabled:discovery,event_participation_enabled:false}})});
  await page.setViewportSize({width:390,height:844});
  const memberEvent={...publicEvent,registration_policy:'community_member',organizer_ref:'20000000-0000-4000-8000-000000000002',state:'published',aggregate_version:1,my_rsvp:null as string|null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,banner_orientation:null};
  let writes=0,guestWrites=0;
  await page.route(`**/api/v1/public/events/${id}`,route=>route.fulfill({json:memberEvent}));
  await page.route(`**/api/v1/public/events/${id}/register`,async route=>{guestWrites++;await route.fulfill({status:403,json:{code:'event_member_required',detail:'請登入本社群帳號後報名。'}})});
  await page.route('**/api/v1/events',route=>route.fulfill({json:{items:[memberEvent]}}));
  await page.route(`**/api/v1/events/${id}`,route=>route.fulfill({json:memberEvent}));
  await page.route(`**/api/v1/events/${id}/rsvp`,async route=>{
    writes++;expect(route.request().postDataJSON()).toEqual({going:true,referral_code:code});
    memberEvent.my_rsvp='going';memberEvent.attending_count=1;memberEvent.aggregate_version++;
    await route.fulfill({json:memberEvent});
  });
  const eventPath=routeKind==='path'?`/events/${id}?ref=${code}`:`/#events/${id}?ref=${code}`;
  const missingReferralEntry=!discovery&&routeKind==='path';
  await page.goto(missingReferralEntry?`/events/${id}`:eventPath);await expect(page.getByRole('heading',{name:publicEvent.title,exact:true})).toBeVisible();
  if(missingReferralEntry)await expect(page.getByText('這場活動須從會員分享的連結報名，請向分享者取得連結。',{exact:true})).toBeVisible();
  await expect(page.getByLabel('你的名字',{exact:true})).toHaveCount(0);await expect(page.getByLabel('接收參與資料的 Email')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'建立帳號後報名',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('member-event-phone.png'),fullPage:true});
  await page.getByRole('button',{name:'登入後報名',exact:true}).click();
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  const detail=page.getByRole('region',{name:'活動專頁',exact:true});await expect(detail).toContainText(publicEvent.title);
  if(missingReferralEntry){await expect(detail.getByRole('button',{name:'我要參加',exact:true})).toBeDisabled();await expect(detail).toContainText('登入不會取代分享碼');await page.goto(eventPath);}
  await expect(detail.getByRole('button',{name:'我要參加',exact:true})).toBeEnabled();expect(writes).toBe(0);expect(guestWrites).toBe(0);
  await detail.getByRole('button',{name:'我要參加',exact:true}).click();await expect(detail.getByRole('button',{name:'取消報名',exact:true})).toBeVisible();
  expect(writes).toBe(1);expect(guestWrites).toBe(0);await expect(page).toHaveURL(new URL(eventPath,page.url()).href);
  await page.reload();await expect(page.getByRole('button',{name:'取消報名',exact:true})).toBeVisible();expect(writes).toBe(1);
});

test('member-only public event does not offer guest management intake when participation is enabled',async({page})=>{
  await page.unroute('**/api/v1/site');
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),community_discovery_enabled:false,event_participation_enabled:true}})});
  await page.route(`**/api/v1/public/events/${id}`,route=>route.fulfill({json:{...publicEvent,registration_policy:'community_member'}}));
  await page.goto(`/events/${id}`);await expect(page.getByText('這場活動須從會員分享的連結報名，請向分享者取得連結。',{exact:true})).toBeVisible();
  await page.goto(`/events/${id}?ref=${code}`);await expect(page.getByRole('button',{name:'登入後報名',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'寄送私人管理連結',exact:true})).toHaveCount(0);await expect(page.getByLabel('你的名字',{exact:true})).toHaveCount(0);
});

featureTest.describe('member-only event registration',()=>{
  const memberMail:{to:string;subject:string;body:string}[]=[];
  // Capture the existing referral-mail requirement locally; never contact a provider.
  featureTest.use({memberFeatures:{eventEmailSender:async(to,subject,body)=>{memberMail.push({to,subject,body});}}});
featureTest('new member keeps referral through required guild joining and explicitly confirms the original event',async({page,e2eAuthPool},info)=>{
  memberMail.length=0;
  await page.unroute('**/api/v1/site');
  await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),community_discovery_enabled:true}})});
  const eventId=randomUUID(),shareCode=randomUUID().replaceAll('-','').slice(0,24),email=`event-newcomer-${randomUUID()}@example.test`;
  const title=`社群帳號活動 ${eventId.slice(0,8)}`;
  await e2eAuthPool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind,registration_policy)
    SELECT $1,community_id,user_id,$2,'合成活動：完成加入後自行確認報名',now()+interval '2 days',now()+interval '2 days 1 hour','online','合成教室','published','referral','other','community_member' FROM users WHERE email='maker@local.test'`,[eventId,title]);
  await e2eAuthPool.query(`INSERT INTO community_event_share_codes(event_id,user_id,code) SELECT $1,user_id,$2 FROM users WHERE email='maker@local.test'`,[eventId,shareCode]);
  let writes=0;page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname===`/api/v1/events/${eventId}/rsvp`)writes++;});
  const destination=`/events/${eventId}?ref=${shareCode}`;
  try{
    await page.goto(destination);await page.getByRole('button',{name:'建立帳號後報名',exact:true}).click();
    await page.getByLabel('社群顯示名稱',{exact:true}).fill('活動新夥伴');await page.getByLabel('電子郵件',{exact:true}).fill(email);await page.getByLabel('密碼',{exact:true}).fill('synthetic-event-newcomer-2026');
    await page.getByRole('button',{name:'建立帳號，先逛工坊',exact:true}).click();await expect(page.locator('.welcome-preview')).toBeVisible();
    await expect(page.getByText('完成加入公會後會返回這場活動，完整定位可稍後補做。返回後仍需自行確認報名，不會自動參加。',{exact:true})).toBeVisible();
    expect(writes).toBe(0);await page.reload();await expect(page.locator('.welcome-preview')).toBeVisible();
    await quickJoin(page);await expect(page.getByRole('region',{name:'活動專頁',exact:true})).toContainText(title);
    await expect(page.getByRole('button',{name:'我要參加',exact:true})).toBeVisible();expect(writes).toBe(0);
    await expect(page).toHaveURL(new URL(destination,page.url()).href);
    const confirmation=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/v1/events/${eventId}/rsvp`);
    await page.getByRole('button',{name:'我要參加',exact:true}).click();expect((await confirmation).status()).toBe(200);
    await expect(page.getByRole('button',{name:'取消報名',exact:true})).toBeVisible();expect(writes).toBe(1);
    expect(memberMail).toHaveLength(1);expect(memberMail[0]).toMatchObject({to:email,subject:'自由工坊：活動參與資料'});
    expect(memberMail[0].body).toContain(title);expect(memberMail[0].body).toContain(`/events/${eventId}`);
    const rows=(await e2eAuthPool.query(`SELECT r.state,u.email,ref.email AS referrer FROM community_event_rsvps r JOIN users u ON u.user_id=r.user_id LEFT JOIN users ref ON ref.user_id=r.referred_by_user_id WHERE r.event_id=$1`,[eventId])).rows;
    expect(rows).toEqual([{state:'going',email,referrer:'maker@local.test'}]);
    expect(Number((await e2eAuthPool.query('SELECT count(*) FROM community_event_guest_rsvps WHERE event_id=$1',[eventId])).rows[0].count)).toBe(0);
    await page.reload();await expect(page.getByRole('button',{name:'取消報名',exact:true})).toBeVisible();expect(writes).toBe(1);
    expect(memberMail).toHaveLength(1);
    await info.attach('member-registration-evidence',{body:JSON.stringify({eventId,memberRegistrations:rows.length,guestRegistrations:0,explicitRsvpWrites:writes}),contentType:'application/json'});
  }finally{
    await page.unrouteAll({behavior:'wait'});await page.close();
    // The successful member RSVP has a restrictive event FK. Remove only this
    // synthetic event's RSVP rows before its parent; keep production FKs intact.
    await e2eAuthPool.query('DELETE FROM community_event_rsvps WHERE event_id=$1',[eventId]);
    await e2eAuthPool.query('DELETE FROM community_events WHERE event_id=$1',[eventId]);
  }
});

});
