import {eventAppPath} from './navigation.js';
import {randomUUID} from 'node:crypto';
import {test,expect,type Page,type Request,type Route} from './fixtures.js';
import {quickJoin} from './quick-join.js';
import type {CommunityEvent} from '../../apps/portal-web/src/modules/EventsPanel.js';

const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};};
const detail=(page:Page)=>page.getByRole('region',{name:'活動專頁',exact:true});
function event(letter:string):CommunityEvent{
 const id=randomUUID(),start=Date.now()+2*86400000;
 return{event_id:id,title:`活動重試 ${letter} ${id.slice(0,8)}`,description:`合成活動 ${letter}`,organizer_ref:'20000000-0000-4000-8000-000000000002',organizer_name:'合成活動夥伴',starts_at:new Date(start).toISOString(),ends_at:new Date(start+3600000).toISOString(),mode:'online',location:'合成線上場地',event_kind:'other',topic:null,online_url:null,visibility:'workshop',registration_policy:'community_member',capacity:20,state:'published',aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,banner_url:null,banner_orientation:null,video_url:null,video_mime:null};
}
async function login(page:Page){
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
 const home=page.getByRole('heading',{name:'動態',exact:true}),join=page.getByRole('region',{name:'快速加入公會',exact:true});await expect(home.or(join)).toBeVisible();if(await join.isVisible())await quickJoin(page);await expect(home).toBeVisible();
}
// Real login/session/site and the built App. Synthetic read resources only;
// this suite does not claim server authorization, history retention or DB facts.
class ReadRoutes{
 readonly a=event('A');readonly b=event('B');readonly released=deferred();readonly requested=deferred();readonly writes:string[]=[];
 readonly notification={notification_id:randomUUID(),title:'開啟需要重新讀取的活動',body:'查看活動內容',created_at:new Date().toISOString(),read_at:new Date().toISOString(),action:{tab:'events',resource_id:this.b.event_id}};
 allowRetry=false;listReads=0;detailReads=0;
 private readonly tasks=new Set<Promise<void>>();private readonly failures:unknown[]=[];
 private readonly installed:Array<{matches:(url:URL)=>boolean;handle:(route:Route)=>Promise<void>}>=[];
 private readonly observe=(request:Request)=>{const url=new URL(request.url());if(url.origin===this.origin&&url.pathname.startsWith('/api/v1/events')&&request.method()!=='GET')this.writes.push(url.pathname);};
 constructor(readonly page:Page,readonly origin:string,readonly failure:'network'|403|404|503){}
 private async route(path:string,run:(route:Route)=>Promise<void>){
  const expected=new URL(path,this.origin);const matches=(url:URL)=>url.origin===expected.origin&&url.pathname===expected.pathname&&url.search===expected.search;
  const handle=(route:Route)=>{const task=(async()=>{if(route.request().method()!=='GET'){await route.fallback();return;}await run(route);})();this.tasks.add(task);void task.then(()=>this.tasks.delete(task),error=>{this.tasks.delete(task);this.failures.push(error);});return task;};
  this.installed.push({matches,handle});await this.page.route(matches,handle);
 }
 async install(){
  this.page.on('request',this.observe);
  await this.route('/api/v1/events',async route=>{this.listReads++;await route.fulfill({json:{items:[this.a]}});});
  await this.route(`/api/v1/events/${this.a.event_id}`,async route=>{await route.fulfill({json:this.a});});
  await this.route(`/api/v1/events/${this.b.event_id}`,async route=>{
   this.detailReads++;
   if(!this.allowRetry){if(this.failure==='network')await route.abort('internetdisconnected');else await route.fulfill({status:this.failure,json:{code:this.failure===403?'forbidden':this.failure===404?'not_found':'temporarily_unavailable',detail:'PRIVATE diagnostic is not UI text'}});return;}
   this.requested.resolve();await this.released.promise;await route.fulfill({json:this.b});
  });
  await this.route('/api/v1/me/notifications?limit=6&offset=0',async route=>{await route.fulfill({json:{items:[this.notification],unread_count:0}});});
 }
 async cleanup(){
  this.released.resolve();try{while(this.tasks.size)await Promise.allSettled([...this.tasks]);for(const {matches,handle}of this.installed)await this.page.unroute(matches,handle);}finally{this.page.off('request',this.observe);}
  expect(this.failures,'route handlers finish and cleanup without swallowed failures').toEqual([]);expect(this.writes,'read retry cannot send an event command').toEqual([]);
 }
}
for(const width of [1280,390])for(const entry of ['path','notification'] as const)test(`${width}px ${entry} detail failure recovers without leaving the event or refreshing the list`,async({page,baseURL})=>{
 await page.setViewportSize({width,height:900});const routes=new ReadRoutes(page,new URL(baseURL!).origin,entry==='path'?503:'network');
 try{
  await routes.install();await login(page);
  if(entry==='path')await page.goto(eventAppPath(`/events/${routes.b.event_id}`));
  else{
   await page.goto(`/#events/${routes.a.event_id}`);await expect(detail(page).getByRole('heading',{name:routes.a.title,exact:true})).toBeVisible();await page.locator('.notification-bell-trigger').click();const notifications=page.getByRole('region',{name:'最近通知',exact:true});await notifications.getByRole('button').filter({has:page.getByText(routes.notification.title,{exact:true})}).click();await expect(notifications).toBeHidden();
  }
  const url=page.url(),timeOrigin=await page.evaluate(()=>performance.timeOrigin);await expect(detail(page).getByText('活動暫時無法載入，請重新讀取。',{exact:false})).toBeVisible();await expect(detail(page)).not.toContainText('找不到這場活動');await expect(detail(page)).not.toContainText('PRIVATE');await expect(detail(page).getByRole('heading',{name:routes.a.title,exact:true})).toHaveCount(0);
  const listReads=routes.listReads,detailReads=routes.detailReads;routes.allowRetry=true;await detail(page).getByRole('button',{name:'重新讀取活動',exact:true}).click();await routes.requested.promise;
  await expect(detail(page).getByText('正在載入活動…',{exact:true})).toBeVisible();await expect(detail(page).getByRole('button',{name:'重新讀取活動',exact:true})).toHaveCount(0);await expect(detail(page).getByRole('button',{name:'我要參加',exact:true})).toHaveCount(0);
  expect(routes.detailReads).toBe(detailReads+1);expect(routes.listReads).toBe(listReads);routes.released.resolve();await expect(detail(page).getByRole('heading',{name:routes.b.title,exact:true})).toBeVisible();await expect(page).toHaveURL(url);expect(await page.evaluate(()=>performance.timeOrigin)).toBe(timeOrigin);await expect(detail(page).getByRole('button',{name:'我要參加',exact:true})).toBeEnabled();expect(routes.writes).toEqual([]);
 }finally{await routes.cleanup();}
});
for(const width of [1280,390])for(const status of [403,404] as const)test(`${width}px detail ${status} stays ambiguous instead of claiming the event exists`,async({page,baseURL})=>{
 await page.setViewportSize({width,height:900});const routes=new ReadRoutes(page,new URL(baseURL!).origin,status);
 try{await routes.install();await login(page);await page.goto(`/#events/${routes.b.event_id}`);await expect(detail(page).getByText('找不到這場活動，或目前無法查看。',{exact:true})).toBeVisible();await expect(detail(page)).not.toContainText('PRIVATE');await expect(detail(page)).not.toContainText(routes.a.title);await expect(detail(page)).not.toContainText(routes.b.title);await expect(detail(page).getByRole('button',{name:'重新讀取活動',exact:true})).toHaveCount(0);await expect(detail(page).getByRole('button',{name:'我要參加',exact:true})).toHaveCount(0);}finally{await routes.cleanup();}
});
