import {test,expect,type Page} from './fixtures.js';
import {navigate} from './navigation.js';
const id='70000000-0000-4000-8000-000000000007';
const maker='20000000-0000-4000-8000-000000000001';
const other='20000000-0000-4000-8000-000000000003';
function event(organizer=other){return {event_id:id,organizer_ref:organizer,organizer_name:'合成主辦',title:'合成活動幫手',description:'只用合成資料測試',help_need:'需要夥伴協助報到',starts_at:new Date(Date.now()+86400000).toISOString(),ends_at:new Date(Date.now()+90000000).toISOString(),mode:'online',location:'合成線上場地',event_kind:'other',topic:null,online_url:null,visibility:'workshop',banner_url:null,video_url:null,banner_orientation:null,video_mime:null,capacity:null,state:'published',aggregate_version:1,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null};}
async function open(page:Page,organizer=other){
  const value=event(organizer);
  await page.route('**/api/v1/events',route=>route.request().method()==='GET'?route.fulfill({json:{items:[value]}}):route.continue());
  await page.route(`**/api/v1/events/${id}`,route=>route.fulfill({json:value}));
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await navigate(page,'社群活動');await page.getByRole('link',{name:'活動專頁',exact:true}).click();
}

test('helper offers stay separate from RSVP and a historical ACK is followed by a current read',async({page})=>{
  let state:string|null=null,version=1,reads=0;const writes:string[]=[];let rsvp=0,listReads=0;
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/rsvp'))rsvp++;if(new URL(request.url()).pathname.endsWith('/helpers'))listReads++;});
  await page.route(`**/api/v1/events/${id}/helpers/me`,async route=>{
    if(route.request().method()==='GET'){reads++;await route.fulfill({json:{state,version,event_closed:false}});return;}
    writes.push(route.request().postData()!);const body=route.request().postDataJSON();state=body.action==='offer'?'accepted':'withdrawn';version++;
    // Offer receipt is applied, but another current decision already accepted it.
    await route.fulfill({json:{state:body.action==='offer'?'applied':'withdrawn',version,event_closed:false}});
  });
  await open(page);const panel=page.getByRole('region',{name:'申請幫忙',exact:true});
  await panel.getByRole('button',{name:'我要幫忙，送出申請'}).click();await expect(panel).toContainText('主辦已接受');
  await panel.getByRole('button',{name:'撤回幫忙申請'}).click();await expect(panel).toContainText('已撤回');
  expect(writes.map(value=>JSON.parse(value).action)).toEqual(['offer','withdraw']);expect(reads).toBeGreaterThanOrEqual(3);expect(rsvp).toBe(0);expect(listReads).toBe(0);
});

test('unknown helper ACK survives read and later 403, preserving key body version and departure guard',async({page})=>{
  const writes:{key:string;match:string;body:string|null}[]=[];let resolve=false;
  await page.route(`**/api/v1/events/${id}/helpers/me`,async route=>{
    if(route.request().method()==='GET'){await route.fulfill({json:{state:'applied',version:2,event_closed:false}});return;}
    const req=route.request();writes.push({key:req.headers()['idempotency-key'],match:req.headers()['if-match'],body:req.postData()});
    if(writes.length===1){await route.fulfill({status:503,contentType:'application/problem+json',json:{code:'unavailable',detail:'合成不明結果'}});return;}
    if(!resolve){await route.fulfill({status:403,contentType:'application/problem+json',json:{code:'forbidden',detail:'合成資格已變更'}});return;}
    await route.fulfill({json:{state:'withdrawn',version:3,event_closed:false}});
  });
  await open(page);const panel=page.getByRole('region',{name:'申請幫忙',exact:true});
  await panel.getByRole('button',{name:'撤回幫忙申請'}).click();await expect(panel.getByRole('button',{name:'重試原幫忙操作'})).toBeVisible();
  await panel.getByRole('button',{name:'重新讀取幫忙狀態'}).click();await expect(panel.getByRole('button',{name:'撤回幫忙申請'})).toBeDisabled();
  await page.getByRole('button',{name:'返回活動列表與行事曆'}).click();await expect(page).toHaveURL(new RegExp(`#events/${id}$`));
  await panel.getByRole('button',{name:'重試原幫忙操作'}).click();await expect(panel.getByRole('button',{name:'重試原幫忙操作'})).toBeVisible();
  expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
  resolve=true;await panel.getByRole('button',{name:'重試原幫忙操作'}).click();await expect(panel.getByRole('button',{name:'重試原幫忙操作'})).toHaveCount(0);expect(writes[2]).toEqual(writes[0]);
});

test('organizer sees private helper applications and decides using application version',async({page})=>{
  let state='applied';const commands:{body:unknown;version:string}[]=[];let ownReads=0;
  page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/helpers/me'))ownReads++;});
  await page.route(`**/api/v1/events/${id}/helpers?*`,route=>route.fulfill({json:{items:[{user_id:other,nickname:'合成幫手',state,version:7}],total:1,next_offset:null,event_closed:false}}));
  await page.route(`**/api/v1/events/${id}/helpers/${other}/decision`,async route=>{commands.push({body:route.request().postDataJSON(),version:route.request().headers()['if-match']});state='accepted';await route.fulfill({json:{state,version:8,event_closed:false}});});
  await open(page,maker);const panel=page.getByRole('region',{name:'管理幫手',exact:true});
  await panel.getByRole('button',{name:'接受 合成幫手',exact:true}).click();await expect(panel).toContainText('主辦已接受');expect(commands).toEqual([{body:{decision:'accept'},version:'"7"'}]);expect(ownReads).toBe(0);
});

for(const width of [320,390])test(`simple event form keeps scope visible and opens invalid advanced fields at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});await open(page);await page.getByRole('button',{name:'返回活動列表與行事曆'}).click();
  await page.getByRole('button',{name:'辦活動',exact:true}).click();const form=page.locator('form').filter({has:page.getByRole('heading',{name:'辦一場活動'})});
  await expect(form.getByLabel('活動名稱',{exact:true})).toBeFocused();await expect(form).toContainText('核准後的參與範圍：僅自由工坊會員');
  await form.getByLabel('活動名稱',{exact:true}).fill('合成手機活動');await form.getByLabel('活動說明',{exact:true}).fill('合成活動');await form.getByLabel('線上場地',{exact:true}).fill('合成場地');
  const options=form.getByText('更多設定：活動類型、人數、公會與參與範圍',{exact:true});await options.click();await form.getByLabel('活動類型').selectOption('reading_group');await options.click();
  await form.getByRole('button',{name:'送出審核'}).click();await expect(form.getByLabel('讀書會主題')).toBeVisible();await expect(form.getByLabel('讀書會主題')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const box=await form.getByRole('button',{name:'送出審核'}).boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);
});
