import {canonicalHash} from '../../apps/portal-web/src/portal-route';
const canonicalUrl=(value:string)=>{const url=new URL(value);if(url.hash)url.hash=canonicalHash(url.hash);return url.href;};
import {randomUUID} from 'node:crypto';
import {test,expect,type Page,type Request,type Route} from './fixtures.js';
import {quickJoin} from './quick-join.js';
import type {CommunityEvent} from '../../apps/portal-web/src/modules/EventsPanel.js';

type Entry='path'|'hash';
type DetailStatus=200|403|404|503;
const deferred=()=>{
  let resolve!:()=>void;
  const promise=new Promise<void>(done=>{resolve=done;});
  return {promise,resolve};
};
const frameBarrier=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
const detail=(page:Page)=>page.getByRole('region',{name:'活動專頁',exact:true});
const entryPath=(entry:Entry,id:string)=>entry==='path'?`/events/${id}`:`/#events/${id}`;

function makeEvent(letter:string):CommunityEvent{
  const id=randomUUID(),starts=Date.now()+2*86400000;
  return {
    event_id:id,title:`路由報名活動 ${letter} ${id.slice(0,8)}`,description:`活動 ${letter} 的獨立說明。`,
    organizer_ref:'20000000-0000-4000-8000-000000000002',organizer_name:'合成活動夥伴',
    starts_at:new Date(starts).toISOString(),ends_at:new Date(starts+3600000).toISOString(),
    mode:'online',location:`合成教室 ${letter}`,event_kind:'other',topic:null,online_url:null,
    visibility:'workshop',registration_policy:'community_member',capacity:20,state:'published',
    aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,
    can_review:false,review_reason:null,banner_url:null,banner_orientation:null,video_url:null,video_mime:null,
  };
}

// Real built App, normal login, NotificationBell and EventsPanel. Only these
// synthetic event resources and the exact notification-preview read are mocked.
// This controls HTTP ordering, not server authorization or persisted RSVP facts.
class EventRoutes{
  readonly a=makeEvent('A');
  readonly b=makeEvent('B');
  readonly c=makeEvent('C');
  readonly events=[this.a,this.b,this.c];
  readonly releaseB=deferred();
  readonly requestedB=deferred();
  readonly settledB=deferred();
  readonly notices=this.events.map(event=>({
    notification_id:randomUUID(),title:`前往 ${event.title}`,body:'開啟這場活動並自行確認報名。',
    created_at:new Date().toISOString(),read_at:new Date().toISOString(),
    action:{tab:'events',resource_id:event.event_id},
  }));
  readonly writes:Array<{eventId:string;body:unknown}>=[];
  readonly notificationWrites:string[]=[];
  listAvailable=false;
  listReads=0;
  private readonly routes:Array<{matches:(url:URL)=>boolean;handle:(route:Route)=>Promise<void>}>=[];
  private readonly tasks=new Set<Promise<void>>();
  private readonly routeFailures:unknown[]=[];
  private readonly observe=(request:Request)=>{
    const url=new URL(request.url());
    if(url.origin!==this.origin||url.search||request.method()!=='POST')return;
    const event=this.events.find(value=>url.pathname===`/api/v1/events/${value.event_id}/rsvp`);
    if(event)this.writes.push({eventId:event.event_id,body:request.postDataJSON()});
    if(this.notices.some(value=>url.pathname===`/api/v1/me/notifications/${value.notification_id}/read`))this.notificationWrites.push(url.pathname);
  };
  constructor(private readonly page:Page,readonly origin:string,private readonly bStatus:DetailStatus=200){}
  url(path:string){return new URL(path,this.origin).href;}
  private async route(path:string,method:'GET'|'POST',run:(route:Route)=>Promise<void>){
    const expected=new URL(path,this.origin);
    const matches=(url:URL)=>url.origin===expected.origin&&url.pathname===expected.pathname&&url.search===expected.search;
    const handle=(route:Route)=>{
      const task=(async()=>{
        if(route.request().method()!==method){await route.fallback();return;}
        await run(route);
      })();
      this.tasks.add(task);
      // Keep the original rejection observable to Playwright and to cleanup.
      void task.then(()=>this.tasks.delete(task),error=>{this.tasks.delete(task);this.routeFailures.push(error);});
      return task;
    };
    this.routes.push({matches,handle});
    await this.page.route(matches,handle);
  }
  async install(){
    this.page.on('request',this.observe);
    await this.route('/api/v1/me/notifications?limit=6&offset=0','GET',async route=>{
      await route.fulfill({json:{items:this.notices,unread_count:0}});
    });
    await this.route('/api/v1/events','GET',async route=>{
      this.listReads++;
      await route.fulfill(this.listAvailable?{json:{items:this.events}}:{status:503,json:{code:'temporarily_unavailable',detail:'合成活動列表暫時無法載入。'}});
    });
    for(const event of this.events){
      await this.route(`/api/v1/events/${event.event_id}`,'GET',async route=>{
        if(event===this.b){
          this.requestedB.resolve();
          try{
            await this.releaseB.promise;
            await route.fulfill(this.bStatus===200?{json:event}:{status:this.bStatus,json:{code:this.bStatus===403?'forbidden':this.bStatus===404?'not_found':'temporarily_unavailable',detail:'合成活動目前無法查看。'}});
          }finally{this.settledB.resolve();}
        }else await route.fulfill({json:event});
      });
      await this.route(`/api/v1/events/${event.event_id}/rsvp`,'POST',async route=>{
        expect(route.request().postDataJSON()).toEqual({going:true,referral_code:null});
        event.my_rsvp='going';event.attending_count=1;event.aggregate_version++;
        await route.fulfill({json:event});
      });
    }
  }
  async cleanup(){
    this.releaseB.resolve();
    try{
      while(this.tasks.size)await Promise.allSettled([...this.tasks]);
      for(const {matches,handle} of this.routes)await this.page.unroute(matches,handle);
      while(this.tasks.size)await Promise.allSettled([...this.tasks]);
    }finally{this.page.off('request',this.observe);}
    if(this.routeFailures.length)throw new AggregateError(this.routeFailures,'Event route fixture failed.');
  }
}

async function login(page:Page){
  await page.goto('/');
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  const home=page.getByRole('heading',{name:'動態',exact:true});
  const join=page.getByRole('region',{name:'快速加入公會',exact:true});
  await expect(home.or(join)).toBeVisible();
  if(await join.isVisible())await quickJoin(page);
  await expect(home).toBeVisible();
}

async function startAtA(page:Page,routes:EventRoutes,entry:Entry){
  await login(page);
  await page.goto(entryPath(entry,routes.a.event_id));
  await expect(page).toHaveURL(canonicalUrl(routes.url(entryPath(entry,routes.a.event_id))));
  await expect(detail(page).getByRole('heading',{name:routes.a.title,exact:true})).toBeVisible();
  await expect(detail(page).getByRole('button',{name:'我要參加',exact:true})).toBeEnabled();
  await expect.poll(()=>routes.listReads).toBeGreaterThan(0);
  expect(routes.writes).toEqual([]);
  return page.evaluate(()=>performance.timeOrigin);
}

async function openNotification(page:Page,routes:EventRoutes,event:CommunityEvent){
  await page.locator('.notification-bell-trigger').click();
  const panel=page.getByRole('region',{name:'最近通知',exact:true});
  await expect(panel).toBeVisible();
  await panel.getByRole('button').filter({has:page.getByText(`前往 ${event.title}`,{exact:true})}).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(canonicalUrl(routes.url(`/#events/${event.event_id}`)));
}

async function expectPendingB(page:Page,routes:EventRoutes,timeOrigin:number){
  await routes.requestedB.promise;
  await frameBarrier(page);
  expect(await page.evaluate(()=>performance.timeOrigin)).toBe(timeOrigin);
  await expect(detail(page).getByRole('heading',{name:routes.a.title,exact:true})).toHaveCount(0);
  await expect(detail(page).getByRole('heading',{name:routes.b.title,exact:true})).toHaveCount(0);
  await expect(detail(page).getByRole('button',{name:/^(我要參加|取消報名|分享活動)$/})).toHaveCount(0);
  expect(routes.writes).toEqual([]);
  expect(routes.notificationWrites).toEqual([]);
}

async function releaseDetailB(page:Page,routes:EventRoutes,status:DetailStatus){
  const received=page.waitForResponse(response=>response.url()===routes.url(`/api/v1/events/${routes.b.event_id}`)&&response.request().method()==='GET');
  routes.releaseB.resolve();
  const response=await received;
  expect(response.status()).toBe(status);
  await response.finished();
  await routes.settledB.promise;
  await frameBarrier(page);
}

async function joinCurrentEvent(page:Page,routes:EventRoutes,event:CommunityEvent){
  await expect(detail(page).getByRole('heading',{name:event.title,exact:true})).toBeVisible();
  routes.listAvailable=true;
  await detail(page).getByRole('button',{name:'我要參加',exact:true}).click();
  await expect(detail(page).getByRole('button',{name:'取消報名',exact:true})).toBeEnabled();
  expect(routes.writes).toEqual([{eventId:event.event_id,body:{going:true,referral_code:null}}]);
  expect(routes.notificationWrites).toEqual([]);
}

for(const entry of ['path','hash'] as const)test(`notification changes ${entry} event identity before a delayed detail resolves`,async({page,baseURL})=>{
  const routes=new EventRoutes(page,new URL(baseURL!).origin);
  try{
    await page.setViewportSize({width:entry==='hash'?390:1440,height:900});
    await routes.install();
    const timeOrigin=await startAtA(page,routes,entry);
    await openNotification(page,routes,routes.b);
    await expectPendingB(page,routes,timeOrigin);
    await releaseDetailB(page,routes,200);
    await expect(detail(page).getByRole('heading',{name:routes.a.title,exact:true})).toHaveCount(0);
    await joinCurrentEvent(page,routes,routes.b);
    await expect(page).toHaveURL(canonicalUrl(routes.url(`/#events/${routes.b.event_id}`)));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await routes.cleanup();}
});

for(const entry of ['path','hash'] as const)for(const status of [403,404,503] as const)test(`a ${status} ${entry} event detail cannot expose the previous event and list retry recovers`,async({page,baseURL})=>{
  const routes=new EventRoutes(page,new URL(baseURL!).origin,status);
  try{
    await routes.install();
    const timeOrigin=await startAtA(page,routes,entry);
    await openNotification(page,routes,routes.b);
    await expectPendingB(page,routes,timeOrigin);
    await releaseDetailB(page,routes,status);
    await expect(detail(page).getByText(status===503?'活動暫時無法載入，請重新讀取。':'找不到這場活動，或目前無法查看。',{exact:status!==503})).toBeVisible();
    await expect(detail(page).getByRole('heading',{name:routes.a.title,exact:true})).toHaveCount(0);
    await expect(detail(page).getByRole('button',{name:/^(我要參加|取消報名)$/})).toHaveCount(0);
    expect(routes.writes).toEqual([]);
    await detail(page).getByRole('button',{name:'返回活動列表與行事曆',exact:true}).click();
    await expect(page).toHaveURL(canonicalUrl(routes.url('/#events')));
    const list=page.getByRole('region',{name:'活動發佈區',exact:true});
    await expect(list.getByRole('alert')).toContainText('服務暫時無法回應（503）。請稍後重試。');
    const before=routes.listReads;
    routes.listAvailable=true;
    await list.getByRole('alert').getByRole('button',{name:'重試',exact:true}).click();
    await expect.poll(()=>routes.listReads).toBeGreaterThan(before);
    const card=list.locator('article').filter({has:page.getByRole('heading',{name:routes.b.title,exact:true})});
    await expect(card).toBeVisible();
    await expect(list.getByRole('alert')).toHaveCount(0);
    await card.getByRole('link',{name:'活動專頁',exact:true}).click();
    await expect(page).toHaveURL(canonicalUrl(routes.url(`/#events/${routes.b.event_id}`)));
    await joinCurrentEvent(page,routes,routes.b);
  }finally{await routes.cleanup();}
});

for(const entry of ['path','hash'] as const)for(const status of [200,503] as const)test(`late B ${status} cannot replace C after ${entry} A to B to C notification navigation`,async({page,baseURL})=>{
  const routes=new EventRoutes(page,new URL(baseURL!).origin,status);
  try{
    await routes.install();
    const timeOrigin=await startAtA(page,routes,entry);
    await openNotification(page,routes,routes.b);
    await expectPendingB(page,routes,timeOrigin);
    await openNotification(page,routes,routes.c);
    await expect(detail(page).getByRole('heading',{name:routes.c.title,exact:true})).toBeVisible();
    await expect(detail(page).getByRole('button',{name:'我要參加',exact:true})).toBeEnabled();
    await releaseDetailB(page,routes,status);
    await expect(page).toHaveURL(canonicalUrl(routes.url(`/#events/${routes.c.event_id}`)));
    expect(await page.evaluate(()=>performance.timeOrigin)).toBe(timeOrigin);
    await expect(detail(page).getByRole('heading',{name:routes.c.title,exact:true})).toBeVisible();
    await expect(detail(page).getByRole('heading',{name:routes.a.title,exact:true})).toHaveCount(0);
    await expect(detail(page).getByRole('heading',{name:routes.b.title,exact:true})).toHaveCount(0);
    await joinCurrentEvent(page,routes,routes.c);
  }finally{await routes.cleanup();}
});
