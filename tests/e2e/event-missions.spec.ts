import {test,expect,type Page} from './fixtures.js';
import {navigate} from './navigation.js';
const id='70000000-0000-4000-8000-000000000007';
const maker='20000000-0000-4000-8000-000000000001';
const other='20000000-0000-4000-8000-000000000003';
function event(organizer=other){return {event_id:id,organizer_ref:organizer,organizer_name:'合成主辦',title:'合成活動幫手',description:'只用合成資料測試',help_need:null,starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'online',location:'合成線上場地',event_kind:'other',topic:null,online_url:null,visibility:'workshop',banner_url:null,video_url:null,banner_orientation:null,video_mime:null,capacity:null,state:'published',aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null};}
async function open(page:Page,organizer=other){
  const value=event(organizer);
  await page.route('**/api/v1/events',route=>route.request().method()==='GET'?route.fulfill({json:{items:[value]}}):route.continue());
  await page.route(`**/api/v1/events/${id}`,route=>route.fulfill({json:value}));
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await navigate(page,'社群活動');await page.getByRole('link',{name:'活動專頁',exact:true}).click();
}

const templateIds=['read_intro','think_question','notice_interest'];
function progress(enabled=true,version=2){return {policy:'personal_self_exercises_v1',version,enabled,editable:true,slots:enabled?templateIds.map((template_id,slot)=>({id:template_id,template_id,slot,state:'active',title:`合成練習 ${slot+1}`,description:'自願的私人練習'})):[]};}
test('private tasks require opt-in, survive reload through API and never reserve RSVP',async({page})=>{
 let state=progress(false,1),writes=0,rsvp=0;
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/rsvp'))rsvp++;});
 await page.route(`**/api/v1/events/${id}/my-missions`,async route=>{
  const req=route.request();if(req.method()==='GET'){await route.fulfill({json:state});return;}
  const body=req.postDataJSON();writes++;state=body.action==='clear'?progress(false,state.version+1):progress(true,state.version+1);
  if(body.action==='mark_done')state.slots[body.slot].state='self_reported';
  await route.fulfill({json:{acknowledged:true,event_id:id,action:body.action,command_key:req.headers()['idempotency-key']}});
 });
 await open(page);const panel=page.getByRole('region',{name:'我的活動小任務',exact:true});await expect(panel.getByRole('button',{name:'自願開始 3 個小任務'})).toBeVisible();expect(writes).toBe(0);
 await panel.getByRole('button',{name:'自願開始 3 個小任務'}).click();await expect(panel.getByRole('listitem')).toHaveCount(3);
 await panel.getByRole('button',{name:'我已完成',exact:true}).first().click();await expect(panel).toContainText('已自行記錄完成');await page.reload();await expect(panel).toContainText('已自行記錄完成');expect(writes).toBe(2);expect(rsvp).toBe(0);
 page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'關閉並清除小任務'}).click();await expect(panel.getByRole('listitem')).toHaveCount(0);expect(writes).toBe(3);
});
test('uncertain command preserves exact tuple through read and later refusal',async({page})=>{
 const writes:{key:string;version:string;body:string|null}[]=[];let resolve=false;
 await page.route(`**/api/v1/events/${id}/my-missions`,async route=>{
  const req=route.request();if(req.method()==='GET'){await route.fulfill({json:progress()});return;}
  writes.push({key:req.headers()['idempotency-key'],version:req.headers()['if-match'],body:req.postData()});
  if(!resolve){await route.fulfill({status:writes.length===1?503:403,contentType:'application/problem+json',json:{code:'unavailable',detail:'合成拒絕'}});return;}
  await route.fulfill({json:{acknowledged:true,event_id:id,action:req.postDataJSON().action,command_key:req.headers()['idempotency-key']}});
 });
 await open(page);const panel=page.getByRole('region',{name:'我的活動小任務',exact:true});await panel.getByRole('button',{name:'略過',exact:true}).first().click();await expect(panel.getByRole('button',{name:'重試原操作'})).toBeVisible();await panel.getByRole('button',{name:'重新讀取'}).click();await expect(panel.getByRole('button',{name:'換一個',exact:true}).first()).toBeDisabled();
 await page.getByRole('button',{name:'返回活動列表與行事曆'}).click();await expect(page).toHaveURL(new RegExp(`#events/${id}$`));await panel.getByRole('button',{name:'重試原操作'}).click();await expect(panel.getByRole('button',{name:'重試原操作'})).toBeVisible();expect(writes[1]).toEqual(writes[0]);
 resolve=true;await panel.getByRole('button',{name:'重試原操作'}).click();await expect(panel.getByRole('button',{name:'重試原操作'})).toHaveCount(0);expect(writes[2]).toEqual(writes[0]);
});
test('inaccessible source shows no tasks but retains private clear control',async({page})=>{
 let enabled=true;
 await page.route(`**/api/v1/events/${id}/my-missions`,async route=>{const req=route.request();if(req.method()==='GET'){await route.fulfill({json:{...progress(enabled,2),editable:false,slots:[]}});return;}enabled=false;await route.fulfill({json:{acknowledged:true,event_id:id,action:'clear',command_key:req.headers()['idempotency-key']}});});
 await open(page);const panel=page.getByRole('region',{name:'我的活動小任務',exact:true});await expect(panel.getByRole('listitem')).toHaveCount(0);await expect(panel).toContainText('活動目前無法存取');page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'關閉並清除小任務'}).click();await expect(panel.getByRole('button',{name:'關閉並清除小任務'})).toHaveCount(0);
});
for(const width of [320,390])test(`task controls remain readable and touchable at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await page.route(`**/api/v1/events/${id}/my-missions`,route=>route.fulfill({json:progress()}));await open(page);const panel=page.getByRole('region',{name:'我的活動小任務',exact:true});await expect(panel.getByRole('listitem')).toHaveCount(3);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const box=await panel.getByRole('button',{name:'換一個',exact:true}).first().boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);
});
