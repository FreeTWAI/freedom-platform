import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test,expect} from './member-feature-fixture.js';
import type {Page,Route} from './fixtures.js';
import {quickJoin} from './quick-join.js';
import type {CommunityEvent} from '../../apps/portal-web/src/modules/EventsPanel.js';
import type {EventParticipationDTO,EventReminderDTO} from '../../apps/portal-web/src/modules/EventParticipation.js';
import {DEMO_COMMUNITY,DEMO_USERS} from '../../packages/testing/seed.js';

test.describe('enabled event participation',()=>{
  test.use({memberFeatures:{eventParticipationEnabled:true}});
test('member privately downloads ICS and opts into and cancels reminders',async({page,request,e2eAuthPool})=>{
  const id=randomUUID(),title=`私人行事曆 ${id}`;
  await e2eAuthPool.query(`INSERT INTO community_events(event_id,community_id,organizer_ref,title,description,starts_at,ends_at,mode,location,state,visibility,event_kind)
    VALUES($1,$2,$3,$4,'私人活動說明',now()+interval '2 days',now()+interval '2 days 1 hour','in_person','合成活動地點','published','workshop','other')`,[id,DEMO_COMMUNITY,DEMO_USERS[0].user_id,title]);
  await page.context().route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
  expect((await request.get(`/api/v1/events/${id}/calendar`)).status()).toBe(401);
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.locator('.shell')).toBeVisible();
  await page.goto(`/#events/${id}`);
  const panel=page.getByRole('region',{name:'本人活動參與設定',exact:true});
  await expect(panel.getByText('你的報名：尚未報名。',{exact:false})).toBeVisible();
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
  const downloadReady=page.waitForEvent('download');
  const downloadButton=panel.getByRole('button',{name:'下載行事曆 .ics',exact:true});
  await downloadButton.focus();await page.keyboard.press('Enter');
  const download=await downloadReady;
  expect(download.suggestedFilename()).toBe(`event-${id}.ics`);
  const calendar=await readFile((await download.path())!,'utf8');
  expect(calendar).toContain(`UID:${id}@freetwai.com\r\n`);
  expect(calendar).toMatch(/DTSTART:\d{8}T\d{6}Z\r\n/);
  expect(calendar).not.toMatch(/ATTENDEE|participation=|maker@local\.test/);
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
  expect((await page.request.get(`/api/v1/events/${id}/participation`).then(r=>r.json())).rsvp_state).toBeNull();
  const card=page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await card.getByRole('button',{name:'我要參加',exact:true}).click();
  await expect(panel).toContainText('你的報名：已報名');
  await panel.getByRole('checkbox').check();
  await panel.getByLabel('開始前幾分鐘',{exact:true}).fill('30');
  await panel.getByLabel('通知方式',{exact:true}).selectOption('in_app');
  await panel.getByRole('button',{name:'儲存提醒選擇',exact:true}).click();
  await expect(panel).toContainText('目前狀態：等待提醒時間');
  for(const theme of ['light','dark','versefolk']){
    await page.evaluate(value=>{localStorage.setItem('freedom-theme',value);document.documentElement.dataset.theme=value;},theme);
    for(const width of [1280,320,390]){
      await page.setViewportSize({width,height:900});
      await expect(downloadButton).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
  }
  await panel.getByRole('checkbox').uncheck();
  await panel.getByRole('button',{name:'儲存提醒選擇',exact:true}).click();
  await expect(panel).toContainText('未寄出的提醒已取消');
  await panel.getByRole('checkbox').check();
  await panel.getByRole('button',{name:'儲存提醒選擇',exact:true}).click();
  await expect(panel).toContainText('目前狀態：等待提醒時間');
  await card.getByRole('button',{name:'取消報名',exact:true}).click();
  await expect(panel).toContainText('你的報名：已取消');
  const reminder=await page.request.get(`/api/v1/events/${id}/reminder`).then(r=>r.json());
  expect(reminder).toMatchObject({enabled:false,status:'cancelled'});
});

});
test.describe('default-off event participation',()=>{
  test.use({memberFeatures:{}});
  test('calendar, reminder and participation routes reject requests before authentication',async({page,request})=>{
    const id=randomUUID();
    expect((await (await request.get('/api/v1/site')).json()).event_participation_enabled).toBe(false);
    for(const prefix of ['events','public/events'])for(const suffix of ['participation','calendar','reminder']){
      const response=await request.get(`/api/v1/${prefix}/${id}/${suffix}`);
      expect(response.status()).toBe(404);
      expect(response.headers()['cache-control']).toContain('no-store');
      expect(response.headers()['x-robots-tag']).toContain('noindex');
    }
    await page.goto('/');
    await expect(page.getByRole('region',{name:'本人活動參與設定',exact:true})).toHaveCount(0);
  });
});

const waitlistGate=()=>{
  let resolve!:()=>void;
  const promise=new Promise<void>(done=>{resolve=done;});
  return {promise,resolve};
};
const waitlistPanel=(page:Page)=>page.getByRole('region',{name:'本人活動參與設定',exact:true});
const waitlistDetail=(page:Page)=>page.getByRole('region',{name:'活動專頁',exact:true});
const waitlistFrames=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));

function invitedEvent(letter:string):CommunityEvent{
  const id=randomUUID(),starts=Date.now()+2*86400000;
  return {
    event_id:id,title:`候補離頁活動 ${letter} ${id.slice(0,8)}`,description:`合成活動 ${letter} 說明`,
    organizer_ref:DEMO_USERS[1].user_id,organizer_name:'合成活動主辦者',
    starts_at:new Date(starts).toISOString(),ends_at:new Date(starts+3600000).toISOString(),
    mode:'online',location:'合成教室',event_kind:'other',topic:null,online_url:null,
    visibility:'workshop',registration_policy:'community_member',capacity:1,state:'published',
    aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,
    can_review:false,review_reason:null,banner_url:null,banner_orientation:null,video_url:null,video_mime:null,
  };
}

// Actual App/member session and feature-enabled host. Only exact synthetic event,
// participation, reminder and read-notification resources are intercepted. These
// cases establish browser lifecycle behavior, not durable server command facts.
class WaitlistNavigationRoutes{
  readonly a=invitedEvent('A');
  readonly b=invitedEvent('B');
  readonly events=[this.a,this.b];
  readonly first=waitlistGate();
  readonly fresh=waitlistGate();
  readonly refresh=waitlistGate();
  readonly refreshStarted=waitlistGate();
  readonly writes:Array<{path:string;body:string|null;key:string|undefined;version:string|undefined}>=[];
  readonly notices=this.events.map(event=>({notification_id:randomUUID(),title:`候補前往 ${event.title}`,
    body:'查看這場活動。',created_at:new Date().toISOString(),read_at:new Date().toISOString(),
    action:{tab:'events',resource_id:event.event_id}}));
  readonly values=new Map<string,EventParticipationDTO>(this.events.map(event=>[event.event_id,{
    event_id:event.event_id,event_version:1,event_state:'published',starts_at:event.starts_at,
    waitlist_enabled:true,response_window_minutes:60,rsvp_state:null,available_seats:0,
    waitlist:{status:'invited',aggregate_version:1,joined_at:new Date().toISOString(),
      invited_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),delivery_status:'recorded'},
  }]));
  readonly reminder:EventReminderDTO={version:1,enabled:false,minutes_before_start:null,channel:null,status:null};
  holdRefresh=false;
  refreshFinished=false;
  notificationWrites=0;
  private readonly routes:Array<{matches:(url:URL)=>boolean;handle:(route:Route)=>Promise<void>}>=[];
  private readonly tasks=new Set<Promise<void>>();
  private readonly failures:unknown[]=[];
  constructor(private readonly page:Page,readonly origin:string,readonly firstStatus:'network'|412,readonly refreshStatus:200|503=200){}
  url(path:string){return new URL(path,this.origin).href;}
  private async route(path:string,method:string,run:(route:Route)=>Promise<void>){
    const expected=new URL(path,this.origin);
    const matches=(url:URL)=>url.origin===expected.origin&&url.pathname===expected.pathname&&url.search===expected.search;
    const handle=(route:Route)=>{
      const task=(async()=>{if(route.request().method()!==method){await route.fallback();return;}await run(route);})();
      this.tasks.add(task);
      void task.then(()=>this.tasks.delete(task),error=>{this.tasks.delete(task);this.failures.push(error);});
      return task;
    };
    this.routes.push({matches,handle});await this.page.route(matches,handle);
  }
  async install(){
    await this.route('/api/v1/events','GET',async route=>{await route.fulfill({json:{items:this.events}});});
    await this.route('/api/v1/events/bulletins','GET',async route=>{await route.fulfill({json:{items:[]}});});
    await this.route('/api/v1/me/notifications?limit=6&offset=0','GET',async route=>{await route.fulfill({json:{items:this.notices,unread_count:0}});});
    for(const notice of this.notices)await this.route(`/api/v1/me/notifications/${notice.notification_id}/read`,'POST',async route=>{
      this.notificationWrites++;await route.abort('failed');
    });
    for(const event of this.events){
      await this.route(`/api/v1/events/${event.event_id}`,'GET',async route=>{await route.fulfill({json:event});});
      await this.route(`/api/v1/events/${event.event_id}/reminder`,'GET',async route=>{await route.fulfill({json:this.reminder});});
      await this.route(`/api/v1/events/${event.event_id}/participation`,'GET',async route=>{
        if(event===this.a&&this.holdRefresh){
          this.refreshStarted.resolve();await this.refresh.promise;
          await route.fulfill(this.refreshStatus===200?{json:this.values.get(event.event_id)}:{status:503,json:{code:'temporarily_unavailable',detail:'合成讀回暫時失敗。'}});
          // This records route-handler completion, not delivery: leaving A aborts
          // its GET. Do not swallow fulfill errors or treat cancellation as an ACK.
          this.refreshFinished=true;
        }else await route.fulfill({json:this.values.get(event.event_id)});
      });
      await this.route(`/api/v1/events/${event.event_id}/waitlist`,'POST',async route=>{
        const request=route.request(),headers=request.headers();
        this.writes.push({path:new URL(request.url()).pathname,body:request.postData(),key:headers['idempotency-key'],version:headers['if-match']});
        expect(request.postDataJSON()).toEqual({action:'accept'});
        if(this.writes.length===1){
          await this.first.promise;
          if(this.firstStatus==='network'){await route.abort('failed');return;}
          const value=this.values.get(event.event_id)!;value.event_version=2;event.aggregate_version=2;
          await route.fulfill({status:412,contentType:'application/problem+json',json:{
            type:'https://freetwai.com/problems/version-conflict',title:'Version conflict',status:412,
            code:'version_conflict',detail:'合成版本已更新。',
          }});return;
        }
        if(event===this.b)await this.fresh.promise;
        const value=this.values.get(event.event_id)!;
        const confirmed:EventParticipationDTO={...value,event_version:value.event_version+1,rsvp_state:'going',
          waitlist:{...value.waitlist!,status:'accepted',aggregate_version:value.waitlist!.aggregate_version+1}};
        this.values.set(event.event_id,confirmed);
        event.aggregate_version=confirmed.event_version;event.my_rsvp='going';event.attending_count=1;
        if(event===this.a)this.holdRefresh=true;
        await route.fulfill({json:confirmed});
      });
    }
  }
  async cleanup(){
    this.first.resolve();this.fresh.resolve();this.refresh.resolve();
    while(this.tasks.size)await Promise.allSettled([...this.tasks]);
    for(const {matches,handle} of this.routes)await this.page.unroute(matches,handle);
    while(this.tasks.size)await Promise.allSettled([...this.tasks]);
    if(this.failures.length)throw new AggregateError(this.failures,'Waitlist navigation routes failed.');
  }
}

async function openWaitlistMember(page:Page,routes:WaitlistNavigationRoutes){
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  const home=page.getByRole('heading',{name:'會員首頁',exact:true});
  const join=page.getByRole('region',{name:'快速加入公會',exact:true});
  await expect(home.or(join)).toBeVisible();if(await join.isVisible())await quickJoin(page);
  await expect(home).toBeVisible();
  await page.goto(`/#events/${routes.a.event_id}`);
  await expect(waitlistDetail(page).getByRole('heading',{name:routes.a.title,exact:true})).toBeVisible();
  await expect(waitlistPanel(page).getByRole('button',{name:'接受邀請並報名',exact:true})).toBeEnabled();
  return page.evaluate(()=>performance.timeOrigin);
}
async function clickWaitlistNotice(page:Page,routes:WaitlistNavigationRoutes,event:CommunityEvent){
  const bell=page.locator('.notification-bell-trigger');
  const notices=page.getByRole('region',{name:'最近通知',exact:true});
  if(!await notices.isVisible())await bell.click();
  await notices.getByRole('button').filter({has:page.getByText(`候補前往 ${event.title}`,{exact:true})}).click();
  // Rejected navigation may keep the bell open. Closing it is not navigation.
  if(await notices.isVisible())await bell.click();
}
async function expectWaitlistRetained(page:Page,routes:WaitlistNavigationRoutes,event:CommunityEvent,timeOrigin:number){
  await waitlistFrames(page);
  await expect(page).toHaveURL(routes.url(`/#events/${event.event_id}`));
  await expect(waitlistDetail(page).getByRole('heading',{name:event.title,exact:true})).toBeVisible();
  await expect(waitlistPanel(page)).toBeVisible();
  expect(await page.evaluate(()=>performance.timeOrigin)).toBe(timeOrigin);
  expect(routes.notificationWrites).toBe(0);
}

test.describe('member waitlist navigation lifetime',()=>{
  test.use({memberFeatures:{eventParticipationEnabled:true}});
  for(const width of [1440,390])for(const refreshStatus of [200,503] as const){
    test(`waitlist pending and unknown retain A; ACK releases before ${refreshStatus} readback at ${width}px`,async({page,baseURL})=>{
      const routes=new WaitlistNavigationRoutes(page,new URL(baseURL!).origin,'network',refreshStatus);
      try{
        await page.setViewportSize({width,height:900});await routes.install();
        const timeOrigin=await openWaitlistMember(page,routes);
        await waitlistPanel(page).getByRole('button',{name:'接受邀請並報名',exact:true}).click();
        await expect.poll(()=>routes.writes.length).toBe(1);
        await expect(waitlistPanel(page).getByRole('button',{name:'接受邀請並報名',exact:true})).toBeDisabled();
        await waitlistDetail(page).getByRole('button',{name:'返回活動列表與行事曆',exact:true}).click();
        await expectWaitlistRetained(page,routes,routes.a,timeOrigin);
        await clickWaitlistNotice(page,routes,routes.b);
        await expectWaitlistRetained(page,routes,routes.a,timeOrigin);
        routes.first.resolve();
        const retry=waitlistPanel(page).getByRole('button',{name:'重試原操作（保留原內容）',exact:true});
        await expect(retry).toBeEnabled();
        await waitlistDetail(page).getByRole('button',{name:'返回活動列表與行事曆',exact:true}).click();
        await expectWaitlistRetained(page,routes,routes.a,timeOrigin);
        await clickWaitlistNotice(page,routes,routes.b);
        await expectWaitlistRetained(page,routes,routes.a,timeOrigin);
        await expect(retry).toBeEnabled();expect(routes.writes).toHaveLength(1);
        await retry.click();await routes.refreshStarted.promise;
        expect(routes.writes).toHaveLength(2);
        expect(routes.writes[0].key).toMatch(/^[\w-]{8,128}$/);
        expect(routes.writes[0].version).toBe('"1"');
        expect(routes.writes[1]).toEqual(routes.writes[0]);
        expect(routes.refreshFinished).toBe(false);
        // Leave while the authoritative write is confirmed but its GET is held.
        await clickWaitlistNotice(page,routes,routes.b);
        await expectWaitlistRetained(page,routes,routes.b,timeOrigin);
        expect(routes.refreshFinished).toBe(false);
        await expect(waitlistPanel(page).getByRole('button',{name:'接受邀請並報名',exact:true})).toBeEnabled();
        await waitlistPanel(page).getByRole('button',{name:'接受邀請並報名',exact:true}).click();
        await expect.poll(()=>routes.writes.length).toBe(3);
        expect(routes.writes[2].key).not.toBe(routes.writes[0].key);
        expect(routes.writes[2]).toMatchObject({path:`/api/v1/events/${routes.b.event_id}/waitlist`,body:routes.writes[0].body,version:'"1"'});
        // A's late success/failure must not release the fresh pending B command.
        routes.refresh.resolve();await expect.poll(()=>routes.refreshFinished).toBe(true);
        await waitlistDetail(page).getByRole('button',{name:'返回活動列表與行事曆',exact:true}).click();
        await expectWaitlistRetained(page,routes,routes.b,timeOrigin);
        routes.fresh.resolve();
        await expect(waitlistPanel(page)).toContainText('已接受邀請');
        await waitlistDetail(page).getByRole('button',{name:'返回活動列表與行事曆',exact:true}).click();
        await expect(page).toHaveURL(routes.url('/#events'));
        expect(routes.writes).toHaveLength(3);expect(routes.notificationWrites).toBe(0);
      }finally{await routes.cleanup();}
    });
  }
  test('a definitive first waitlist 412 blocks another command but permits leaving',async({page,baseURL})=>{
    const routes=new WaitlistNavigationRoutes(page,new URL(baseURL!).origin,412);
    try{
      await routes.install();await openWaitlistMember(page,routes);
      await waitlistPanel(page).getByRole('button',{name:'接受邀請並報名',exact:true}).click();
      await expect.poll(()=>routes.writes.length).toBe(1);routes.first.resolve();
      await expect(waitlistPanel(page).getByRole('button',{name:'載入最新狀態並保留輸入',exact:true})).toBeVisible();
      await expect(waitlistPanel(page).getByRole('button',{name:'接受邀請並報名',exact:true})).toBeDisabled();
      await expect(waitlistPanel(page).getByRole('button',{name:'重試原操作（保留原內容）',exact:true})).toHaveCount(0);
      await waitlistDetail(page).getByRole('button',{name:'返回活動列表與行事曆',exact:true}).click();
      await expect(page).toHaveURL(routes.url('/#events'));
      await clickWaitlistNotice(page,routes,routes.b);
      await expect(page).toHaveURL(routes.url(`/#events/${routes.b.event_id}`));
      await expect(waitlistPanel(page).getByRole('button',{name:'接受邀請並報名',exact:true})).toBeEnabled();
      expect(routes.writes).toHaveLength(1);expect(routes.notificationWrites).toBe(0);
    }finally{await routes.cleanup();}
  });
});
