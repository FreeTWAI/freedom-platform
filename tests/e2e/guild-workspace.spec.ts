import { navigate } from './navigation.js';
import {test,expect,type Page,type Route} from './fixtures.js';

const caps={managed_guilds:[{guild_key:'synthetic-guild',name:'測試公會'}],managed_books:[{book_id:'video-autopilot',title:'測試剪輯技能'}],can_discuss:true};
const announcement={announcement_id:'synthetic-announcement',guild_key:'synthetic-guild',title:'週末共創',body:'帶一段合成素材一起測試。',state:'published',aggregate_version:2,created_at:'2026-09-23T10:00:00Z',updated_at:'2026-09-23T10:00:00Z'};
async function login(page:Page){await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();}
// Observe only one synthetic write. The next task runs after the response-body
// promise and its synchronous await continuations, not after an arbitrary sleep.
function installGrantAckProbe({path,title}:{path:string;title:string}){
 const root=window as any,originalFetch=window.fetch,originalBroadcast=BroadcastChannel.prototype.postMessage;
 const channels:MessageChannel[]=[];let active=true;
 const probe={settled:false,reads:0,events:0,restore:()=>{active=false;window.fetch=originalFetch;BroadcastChannel.prototype.postMessage=originalBroadcast;for(const channel of channels){channel.port1.close();channel.port2.close();}}};
 root.__guildGrantAckProbe=probe;
 BroadcastChannel.prototype.postMessage=function(message){if(message?.type==='event'&&message.event?.message===title)probe.events++;return originalBroadcast.call(this,message);};
 window.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.href),method=init?.method??(input instanceof Request?input.method:'GET');
  const matches=url.origin===location.origin&&url.pathname===path;
  if(matches&&method==='GET')probe.reads++;
  let selected=false;if(matches&&method==='POST'&&typeof init?.body==='string'){try{selected=JSON.parse(init.body).title===title;}catch{/* Not the synthetic fixture. */}}
  const response=await originalFetch(input,init);if(!selected)return response;
  const read=response.text.bind(response);response.text=async()=>{
   const text=await read();let fixture=false;try{const value=JSON.parse(text);fixture=response.ok&&value.announcement_id==='synthetic-announcement'&&value.title===title;}catch{/* No valid ACK; never signal settlement. */}
   if(fixture&&active){const channel=new MessageChannel();channels.push(channel);channel.port1.onmessage=()=>{if(active)probe.settled=true;channel.port1.close();channel.port2.close();};channel.port2.postMessage(null);}
   return text;
  };return response;
 };
}
test.beforeEach(async({page})=>{
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:caps}));
  await page.route('**/api/v1/me/github',route=>route.fulfill({json:{configured:false,connected:false,github_user:null}}));
});
test('guild leaders edit announcements with version checks and retain their draft on a conflict',async({page})=>{
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>route.fulfill({json:{items:[announcement]}}));
  let writes=0;await page.route('**/api/v1/guild-announcements/synthetic-announcement/edit',route=>{writes++;expect(route.request().headers()['if-match']).toBe('"2"');expect(route.request().headers()['x-csrf-token']).toBeTruthy();expect(route.request().postDataJSON()).toMatchObject({title:'週末共創更新',state:'published'});return route.fulfill({status:412,json:{detail:'公告已由另一位會長更新，請重新載入。'}});});
  await login(page);await navigate(page, '公會管理');await page.getByRole('button',{name:'編輯公告',exact:true}).click();await page.getByLabel('公告標題',{exact:true}).fill('週末共創更新');await page.getByRole('button',{name:'保存公告',exact:true}).click();await expect(page.getByRole('alert')).toContainText('另一位會長更新');await expect(page.getByLabel('公告標題',{exact:true})).toHaveValue('週末共創更新');expect(writes).toBe(1);await expect(page.getByText('公告已保存。',{exact:true})).toHaveCount(0);
});
test('skill maintainers publish structured tasks and milestones without a raw JSON editor',async({page})=>{
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>route.fulfill({json:{items:[]}}));
  const draft={book_id:'video-autopilot',summary:'一起製作剪輯工具。',collaboration_intro:'補上可重跑的合成素材測試。',milestones:[],tasks:[],aggregate_version:0,updated_at:null};let saved:any;
  await page.route('**/api/v1/skill-books/video-autopilot/editor',route=>{if(route.request().method()==='POST'){saved=route.request().postDataJSON();expect(route.request().headers()['if-match']).toBeUndefined();expect(route.request().headers()['idempotency-key']).toBeTruthy();return route.fulfill({json:{...draft,...saved,aggregate_version:1,updated_at:'2026-09-23T12:00:00Z'}});}return route.fulfill({json:draft});});
  await login(page);await navigate(page, '公會管理');await page.getByRole('button',{name:'技能書編輯',exact:true}).click();await expect(page.getByRole('textbox',{name:'一句話摘要',exact:true})).toHaveValue(draft.summary);
  await page.getByRole('button',{name:'新增里程碑',exact:true}).click();await page.getByLabel('里程碑 1',{exact:true}).fill('第一組剪輯回歸');await page.getByRole('button',{name:'新增協作任務',exact:true}).click();await page.getByLabel('任務標題',{exact:true}).fill('加入合成字幕素材');await page.getByLabel('修改範圍',{exact:true}).fill('在 fixtures 加入十秒片段。');await page.getByLabel('完成條件（每行一項）',{exact:true}).fill('可重跑產生相同時長\n字幕位置有斷言');await page.getByRole('combobox',{name:'所屬里程碑',exact:true}).selectOption({label:'第一組剪輯回歸'});await page.getByRole('button',{name:'保存技能書',exact:true}).click();await expect(page.locator('.guild-workspace').getByRole('status')).toContainText('分享頁同步更新');expect(saved.tasks[0].acceptance).toEqual(['可重跑產生相同時長','字幕位置有斷言']);expect(saved.tasks[0].milestone_id).toBe(saved.milestones[0].id);expect(saved.tasks[0].status).toBe('todo');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('private council posts a reply with member CSRF and renders plain text safely',async({page})=>{
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>route.fulfill({json:{items:[]}}));
  const thread={thread_id:'synthetic-thread',title:'跨公會共創安排',body:'<script>window.fake=true</script>',author_name:'測試會長',created_at:'2026-09-23T10:00:00Z',replies:[] as any[]};
  await page.route('**/api/v1/guild-council/threads',route=>route.fulfill({json:{items:[{...thread,replies:undefined,reply_count:thread.replies.length}]}}));
  await page.route('**/api/v1/guild-council/threads/synthetic-thread',route=>route.fulfill({json:thread}));
  await page.route('**/api/v1/guild-council/threads/synthetic-thread/replies',route=>{expect(route.request().headers()['x-csrf-token']).toBeTruthy();expect(route.request().postDataJSON()).toEqual({body:'我會整理測試素材。'});thread.replies.push({reply_id:'synthetic-reply',body:'我會整理測試素材。',author_name:'測試成員',created_at:'2026-09-23T11:00:00Z'});return route.fulfill({json:thread});});
  await login(page);await navigate(page, '公會管理');await page.getByRole('button',{name:'公會長議事區',exact:true}).click();await page.getByRole('button',{name:/跨公會共創安排/}).click();await expect(page.locator('.guild-workspace-body')).toHaveText(thread.body);expect(await page.evaluate(()=>(window as any).fake)).toBeUndefined();await page.getByLabel('回覆討論',{exact:true}).fill('我會整理測試素材。');await page.getByRole('button',{name:'發布回覆',exact:true}).click();await expect(page.locator('.guild-workspace').getByRole('status')).toContainText('回覆已發布');await expect(page.locator('.guild-council-reply')).toContainText('我會整理測試素材。');
});
test('Access admins assign and revoke a skill maintainer with a reason and admin CSRF',async({page})=>{
  let maintainers:{user_id:string;display_name:string;active:boolean;aggregate_version:number}[]=[];const writes:any[]=[];
  await page.route('**/admin/api/**',route=>{
    const path=new URL(route.request().url()).pathname.replace('/admin/api','');
    if(path==='/bootstrap')return route.fulfill({json:{admin:{admin_id:'synthetic-admin',display_name:'管理員',email:'admin@example.test',role:'super_admin',community_id:'synthetic-community'},csrf_token:'synthetic-csrf',summary:{members:1,active_members:1,pending_guild_applications:0,guilds:1,admins:1},available_skill_books:[],pending_guild_appointments:[]}});
    if(path==='/members')return route.fulfill({json:{items:[{user_id:'synthetic-member',display_name:'測試維護者',email:'member@example.test',active:true,onboarding_required:false,onboarding_completed_at:null,aggregate_version:1,guilds:[]}],next_offset:null}});
    if(path==='/skill-maintainers')return route.fulfill({json:{items:[{book_id:'video-autopilot',title:'測試剪輯技能',maintainers}]}});
    if(path==='/skill-maintainers/video-autopilot'){expect(route.request().headers()['x-admin-csrf']).toBe('synthetic-csrf');const body=route.request().postDataJSON();if(maintainers.length)expect(route.request().headers()['if-match']).toBe(`"${maintainers[0].aggregate_version}"`);else expect(route.request().headers()['if-match']).toBeUndefined();writes.push(body);maintainers=[{user_id:'synthetic-member',display_name:'測試維護者',active:body.active,aggregate_version:(maintainers[0]?.aggregate_version??0)+1}];return route.fulfill({json:{book_id:'video-autopilot',maintainers}});}
    return route.fulfill({status:404,json:{detail:'unexpected fixture'}});
  });
  await page.goto('/admin');await page.getByRole('button',{name:'會長與維護者',exact:true}).click();await page.getByLabel('任命或解除原因',{exact:true}).fill('負責這一輪剪輯共創');await page.getByLabel('搜尋姓名或 E-mail',{exact:true}).fill('測試維護者');await page.getByRole('button',{name:'搜尋會員',exact:true}).click();await page.getByRole('combobox',{name:'選擇會員',exact:true}).selectOption('synthetic-member');await page.getByRole('button',{name:'任命為技能書維護者',exact:true}).click();await expect(page.locator('.guild-workspace').getByRole('status')).toContainText('已任命技能書維護者');await page.getByLabel('任命或解除原因',{exact:true}).fill('交接完成解除職務');await page.getByRole('button',{name:'解除維護職務',exact:true}).click();await expect(page.locator('.guild-workspace').getByRole('status')).toContainText('已解除技能書維護職務');await expect(page.getByText('尚未任命維護者。',{exact:true})).toBeVisible();await page.getByLabel('任命或解除原因',{exact:true}).fill('重新承接維護工作');await page.getByRole('button',{name:'搜尋會員',exact:true}).click();await page.getByRole('combobox',{name:'選擇會員',exact:true}).selectOption('synthetic-member');await page.getByRole('button',{name:'任命為技能書維護者',exact:true}).click();await expect(page.locator('.guild-workspace').getByRole('status')).toContainText('已任命技能書維護者');expect(writes.map(value=>value.active)).toEqual([true,false,true]);expect(writes.every(value=>value.user_id==='synthetic-member'&&value.reason.length>0)).toBe(true);
});

test('a slower council detail cannot replace the thread selected more recently',async({page})=>{
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>route.fulfill({json:{items:[]}}));
  const first={thread_id:'first',title:'第一個討論',body:'第一份內容',author_name:'測試會長',created_at:'2026-09-23T10:00:00Z',replies:[]},second={...first,thread_id:'second',title:'第二個討論',body:'第二份內容'};
  await page.route('**/api/v1/guild-council/threads',route=>route.fulfill({json:{items:[first,second].map(({replies,...item})=>({...item,reply_count:0}))}}));
  let release!:()=>void,requested!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{requested=resolve;});
  await page.route('**/api/v1/guild-council/threads/first',async route=>{requested();await gate;await route.fulfill({json:first});});
  await page.route('**/api/v1/guild-council/threads/second',route=>route.fulfill({json:second}));
  await login(page);await navigate(page, '公會管理');await page.getByRole('button',{name:'公會長議事區',exact:true}).click();await page.getByRole('button',{name:/第一個討論/}).click();await started;await page.getByRole('button',{name:/第二個討論/}).click();await expect(page.locator('.guild-workspace-body')).toHaveText('第二份內容');const delivered=page.waitForResponse(response=>response.url().endsWith('/guild-council/threads/first'));release();await delivered;await expect(page.locator('.guild-workspace-body')).toHaveText('第二份內容');await expect(page.getByRole('heading',{name:'第一個討論',exact:true})).toHaveCount(0);
});

test('retry after an unknown announcement result retains the idempotency key',async({page})=>{
  const keys:string[]=[],items:any[]=[];
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{items}});
    keys.push(route.request().headers()['idempotency-key']);
    if(keys.length===1){items.push({...announcement,...route.request().postDataJSON()});return route.fulfill({status:503,json:{detail:'回應中斷，保存結果尚未確認。'}});}
    return route.fulfill({json:items[0]});
  });
  await login(page);await navigate(page, '公會管理');await page.getByLabel('公告標題',{exact:true}).fill('安排下一場共創');await page.getByLabel('公告內容',{exact:true}).fill('帶一份可以公開的合成測試素材。');await page.getByRole('button',{name:'保存公告',exact:true}).click();await expect(page.getByRole('alert')).toContainText('尚未確認');await expect(page.getByLabel('公告標題',{exact:true})).toHaveValue('安排下一場共創');await page.getByRole('button',{name:'保存公告',exact:true}).click();await expect(page.locator('.guild-workspace').getByRole('status')).toContainText('公告已保存');expect(keys).toHaveLength(2);expect(keys[0]).toBeTruthy();expect(keys[1]).toBe(keys[0]);expect(items).toHaveLength(1);
});

test('management tabs retain announcement and skill drafts without opening unvisited private panels',async({page})=>{
  let skillReads=0,councilReads=0;
  let permissions=caps;
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:permissions}));
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/skill-books/video-autopilot/editor',route=>{skillReads++;return route.fulfill({json:{book_id:'video-autopilot',summary:'原技能摘要',collaboration_intro:'原協作說明',milestones:[],tasks:[],aggregate_version:4,updated_at:null}});});
  await page.route('**/api/v1/guild-council/threads',route=>{councilReads++;return route.fulfill({json:{items:[]}});});
  await login(page);await navigate(page,'公會管理');
  const workspace=page.locator('.guild-workspace'),tabs=workspace.getByRole('navigation',{name:'公會管理功能'});
  const title=workspace.getByLabel('公告標題',{exact:true}),body=workspace.getByLabel(/^公告內容/);
  await title.fill('尚未保存的公告');await body.fill('仍屬於原公會的公告草稿');
  expect(skillReads).toBe(0);expect(councilReads).toBe(0);
  await tabs.getByRole('button',{name:'技能書編輯',exact:true}).click();
  const summary=workspace.getByLabel('一句話摘要',{exact:true});
  await expect(summary).toHaveValue('原技能摘要');await summary.fill('尚未保存的技能摘要');
  await expect(title).toBeHidden();await expect(title).toHaveValue('尚未保存的公告');
  await tabs.getByRole('button',{name:'公會公告',exact:true}).click();
  await expect(title).toBeVisible();await expect(title).toHaveValue('尚未保存的公告');
  await expect(body).toHaveValue('仍屬於原公會的公告草稿');await expect(summary).toBeHidden();
  permissions={...caps,managed_guilds:[...caps.managed_guilds,{guild_key:'another-guild',name:'另一公會'}],managed_books:[...caps.managed_books,{book_id:'another-book',title:'另一技能書'}]};
  await page.evaluate(()=>window.dispatchEvent(new Event('freedom-profile-updated')));
  await expect(workspace.getByLabel(/^管理公會/).locator('option')).toHaveCount(2);
  await expect(title).toHaveValue('尚未保存的公告');await expect(body).toHaveValue('仍屬於原公會的公告草稿');
  await title.focus();await page.keyboard.press('Tab');await expect(body).toBeFocused();
  await tabs.getByRole('button',{name:'技能書編輯',exact:true}).click();
  await expect(summary).toHaveValue('尚未保存的技能摘要');expect(skillReads).toBe(1);expect(councilReads).toBe(0);
});

test('a pending announcement save survives tab changes and retries an unknown result with its original body version and key',async({page})=>{
  const writes:{body:unknown;version:string|undefined;key:string|undefined}[]=[];
  let saved=announcement,release=()=>{};
  let permissions=caps;
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:permissions}));
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>route.fulfill({json:{items:[saved]}}));
  await page.route('**/api/v1/skill-books/video-autopilot/editor',route=>route.fulfill({json:{book_id:'video-autopilot',summary:'技能摘要',collaboration_intro:'協作說明',milestones:[],tasks:[],aggregate_version:4,updated_at:null}}));
  await page.route('**/api/v1/guild-announcements/synthetic-announcement/edit',async route=>{
    writes.push({body:route.request().postDataJSON(),version:route.request().headers()['if-match'],key:route.request().headers()['idempotency-key']});
    if(writes.length===1){await gate;return route.fulfill({status:503,json:{detail:'保存結果尚未確認。'}});}
    saved={...announcement,...route.request().postDataJSON(),aggregate_version:3};return route.fulfill({json:saved});
  });
  try{
    await login(page);await navigate(page,'公會管理');
    const workspace=page.locator('.guild-workspace'),tabs=workspace.getByRole('navigation',{name:'公會管理功能'});
    await workspace.getByRole('button',{name:'編輯公告',exact:true}).click();
    await workspace.getByLabel('公告標題',{exact:true}).fill('保留原操作的公告');
    await workspace.getByLabel(/^公告內容/).fill('原公告正文與版本');
    await workspace.getByRole('button',{name:'保存公告',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);
    await tabs.getByRole('button',{name:'技能書編輯',exact:true}).click();
    await expect(workspace.getByLabel('公告標題',{exact:true})).toBeHidden();
    permissions={...caps,managed_guilds:[...caps.managed_guilds,{guild_key:'another-guild',name:'另一公會'}]};
    await page.evaluate(()=>window.dispatchEvent(new Event('freedom-profile-updated')));
    await expect(workspace.getByLabel(/^管理公會/).locator('option')).toHaveCount(2);
    await expect(workspace.getByLabel('公告標題',{exact:true})).toHaveValue('保留原操作的公告');
    await expect(workspace.getByLabel('公告標題',{exact:true})).toBeDisabled();
    const failed=page.waitForResponse(response=>response.url().endsWith('/guild-announcements/synthetic-announcement/edit'));
    release();expect((await failed).status()).toBe(503);
    await tabs.getByRole('button',{name:'公會公告',exact:true}).click();
    await expect(workspace.getByRole('alert')).toContainText('尚未確認');
    await expect(workspace.getByLabel('公告標題',{exact:true})).toHaveValue('保留原操作的公告');
    await expect(workspace.getByLabel(/^公告內容/)).toHaveValue('原公告正文與版本');
    await workspace.getByRole('button',{name:'保存公告',exact:true}).click();
    await expect(workspace.getByRole('status')).toContainText('公告已保存');
    expect(writes).toHaveLength(2);expect(writes[0].key).toBeTruthy();expect(writes[0].version).toBe('"2"');
    expect(writes[0].body).toEqual({title:'保留原操作的公告',body:'原公告正文與版本',state:'published'});expect(writes[1]).toEqual(writes[0]);
    await tabs.getByRole('button',{name:'技能書編輯',exact:true}).click();await tabs.getByRole('button',{name:'公會公告',exact:true}).click();
    await expect(workspace.getByRole('heading',{name:'保留原操作的公告',exact:true})).toBeVisible();expect(writes).toHaveLength(2);
  }finally{release();}
});

test('removing selected management targets clears their hidden drafts without reviving them when grants return',async({page})=>{
  const otherGuild={guild_key:'another-guild',name:'另一公會'},otherBook={book_id:'another-book',title:'另一技能書'};
  let permissions={...caps,managed_guilds:[...caps.managed_guilds,otherGuild],managed_books:[...caps.managed_books,otherBook]},release=()=>{},saving=false,failed=false;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:permissions}));
  await page.route('**/api/v1/guilds/*/announcements',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{items:[]}});
    saving=true;await gate;return route.fulfill({json:{...announcement,...route.request().postDataJSON(),aggregate_version:3}});
  });
  await page.route('**/api/v1/skill-books/*/editor',route=>route.fulfill({json:{book_id:new URL(route.request().url()).pathname.split('/').at(-2),summary:'目前授權的摘要',collaboration_intro:'協作說明',milestones:[],tasks:[],aggregate_version:4,updated_at:null}}));
  await page.route('**/api/v1/guild-council/threads',route=>route.fulfill({json:{items:[]}}));
  try{
  await login(page);await navigate(page,'公會管理');
  const workspace=page.locator('.guild-workspace'),tabs=workspace.getByRole('navigation',{name:'公會管理功能'});
  await page.evaluate(installGrantAckProbe,{path:'/api/v1/guilds/synthetic-guild/announcements',title:'撤權後不可保留的公告'});
  await workspace.getByLabel('公告標題',{exact:true}).fill('撤權後不可保留的公告');
  await workspace.getByLabel(/^公告內容/).fill('原公會待確認的正文');
  await workspace.getByRole('combobox',{name:'發布狀態',exact:true}).selectOption('published');
  await workspace.getByRole('button',{name:'保存公告',exact:true}).click();await expect.poll(()=>saving).toBe(true);
  await tabs.getByRole('button',{name:'技能書編輯',exact:true}).click();
  await workspace.getByLabel('一句話摘要',{exact:true}).fill('撤權後不可保留的技能草稿');
  permissions={...caps,managed_guilds:[otherGuild],managed_books:[otherBook]};
  await page.evaluate(()=>window.dispatchEvent(new Event('freedom-profile-updated')));
  await expect(workspace.getByLabel(/^管理技能書/)).toHaveValue(otherBook.book_id);
  await expect(workspace.getByLabel('一句話摘要',{exact:true})).toHaveValue('目前授權的摘要');
  await tabs.getByRole('button',{name:'公會公告',exact:true}).click();
  await expect(workspace.getByLabel(/^管理公會/)).toHaveValue(otherGuild.guild_key);
  await expect(workspace.getByLabel('公告標題',{exact:true})).toHaveValue('');
  await workspace.getByLabel('公告標題',{exact:true}).fill('新公會尚未保存的公告');
  const completed=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/guilds/synthetic-guild/announcements'));
  const oldReads=await page.evaluate(()=>(window as any).__guildGrantAckProbe.reads);
  release();const completedResponse=await completed;expect(completedResponse.status()).toBe(200);await completedResponse.finished();
  await page.waitForFunction(()=>(window as any).__guildGrantAckProbe.settled===true);
  expect(await page.evaluate(()=>(window as any).__guildGrantAckProbe.reads)).toBe(oldReads);
  expect(await page.evaluate(()=>(window as any).__guildGrantAckProbe.events)).toBe(0);
  await expect(workspace.getByLabel('公告標題',{exact:true})).toHaveValue('新公會尚未保存的公告');
  await expect(workspace.getByLabel('公告標題',{exact:true})).toBeEnabled();
  await expect(workspace.getByText('公告已保存。',{exact:true})).toHaveCount(0);
  permissions={...caps,managed_guilds:[...caps.managed_guilds,otherGuild],managed_books:[...caps.managed_books,otherBook]};
  await page.evaluate(()=>window.dispatchEvent(new Event('freedom-profile-updated')));
  await expect(workspace.getByLabel(/^管理公會/).locator('option')).toHaveCount(2);
  await expect(workspace.getByLabel(/^管理公會/)).toHaveValue(otherGuild.guild_key);
  await workspace.getByLabel(/^管理公會/).selectOption('synthetic-guild');
  await expect(workspace.getByLabel('公告標題',{exact:true})).toHaveValue('');
  await tabs.getByRole('button',{name:'技能書編輯',exact:true}).click();
  await expect(workspace.getByLabel(/^管理技能書/)).toHaveValue(otherBook.book_id);
  await workspace.getByLabel(/^管理技能書/).selectOption('video-autopilot');
  await expect(workspace.getByLabel('一句話摘要',{exact:true})).toHaveValue('目前授權的摘要');
  permissions={...caps,managed_guilds:[],managed_books:[]};
  await page.evaluate(()=>window.dispatchEvent(new Event('freedom-profile-updated')));
  await expect(tabs.getByRole('button',{name:'技能書編輯',exact:true})).toHaveCount(0);
  await expect(workspace.getByLabel('公告標題',{exact:true})).toHaveCount(0);await expect(workspace.getByLabel('一句話摘要',{exact:true})).toHaveCount(0);
  }catch(error){failed=true;throw error;}
  finally{release();try{if(!page.isClosed())await page.evaluate(()=>{const root=window as any;root.__guildGrantAckProbe?.restore();delete root.__guildGrantAckProbe;});}catch(error){if(!failed)throw error;}}
});
test('a removed skill editor cannot lock its replacement with a late guild-required save rejection',async({page})=>{
  const otherBook={book_id:'another-book',title:'另一技能書'};
  let permissions={...caps,managed_books:[...caps.managed_books,otherBook]},release=()=>{},saving=false,failRefresh=false,permissionReads=0;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/v1/guild-workspace',route=>{
    permissionReads++;
    return failRefresh?route.fulfill({status:503,json:{detail:'重新核對暫時不可用。'}}):route.fulfill({json:permissions});
  });
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/skill-books/*/editor',async route=>{
    const book=new URL(route.request().url()).pathname.split('/').at(-2);
    if(route.request().method()==='GET')return route.fulfill({json:{book_id:book,summary:`目前摘要 ${book}`,collaboration_intro:'協作說明',milestones:[],tasks:[],aggregate_version:4,updated_at:null}});
    expect(book).toBe('video-autopilot');saving=true;await gate;
    return route.fulfill({status:403,contentType:'application/problem+json',json:{code:'skill_editor_guild_required',detail:'原技能書已失去編輯資格。'}});
  });
  try{
    await login(page);await navigate(page,'公會管理');
    const workspace=page.locator('.guild-workspace'),tabs=workspace.getByRole('navigation',{name:'公會管理功能'});
    await tabs.getByRole('button',{name:'技能書編輯',exact:true}).click();
    await workspace.getByLabel('一句話摘要',{exact:true}).fill('原技能書待確認草稿');
    await workspace.getByRole('button',{name:'保存技能書',exact:true}).click();await expect.poll(()=>saving).toBe(true);
    permissions={...caps,managed_books:[otherBook]};await page.evaluate(()=>window.dispatchEvent(new Event('freedom-profile-updated')));
    await expect(workspace.getByLabel(/^管理技能書/)).toHaveValue(otherBook.book_id);
    await expect(workspace.getByLabel('一句話摘要',{exact:true})).toHaveValue(`目前摘要 ${otherBook.book_id}`);
    await workspace.getByLabel('一句話摘要',{exact:true}).fill('另一技能書仍可編輯的草稿');
    const reads=permissionReads;failRefresh=true;
    const rejected=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/skill-books/video-autopilot/editor'));
    release();const response=await rejected;expect(response.status()).toBe(403);await response.finished();
    // Settle the completed response's rejection and React updates, rather than
    // asserting the replacement's pre-response enabled state.
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await expect(workspace.getByLabel('一句話摘要',{exact:true})).toHaveValue('另一技能書仍可編輯的草稿');
    await expect(workspace.getByRole('button',{name:'保存技能書',exact:true})).toBeEnabled();
    await expect(workspace.getByRole('region',{name:'技能書編輯資格',exact:true})).toHaveCount(0);expect(permissionReads).toBe(reads);
  }finally{release();}
});

test('council starts with one create action, retains a closed draft and clears it when permission is revoked',async({page})=>{
  let permissions={...caps,can_review_pulls:true},writes=0;
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:permissions}));
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/guild-council/threads',route=>{if(route.request().method()==='POST')writes++;return route.fulfill({json:{items:[]}});});
  await page.route('**/api/v1/guild-reviews?*',route=>route.fulfill({json:{guilds:[],viewer:{github_login:null,reason:null},items:[],next_offset:null}}));
  await login(page);await navigate(page,'公會管理');
  const root=page.locator('.guild-workspace'),tabs=root.getByRole('navigation',{name:'公會管理功能'});
  await expect(root.locator('.guild-workspace-purpose')).toContainText('發布給會員或封存');
  await tabs.getByRole('button',{name:'PR 審核',exact:true}).click();
  await expect(root.locator('.guild-workspace-purpose')).toContainText('認領不等於核准或合併');
  await tabs.getByRole('button',{name:'公會長議事區',exact:true}).click();
  const council=root.locator('.guild-council'),title=council.getByLabel('討論標題',{exact:true}),body=council.getByLabel('討論內容',{exact:true});
  await expect(root.locator('.guild-workspace-purpose')).toContainText('跨公會安排');
  await expect(council.getByText('僅正式公會長與平台管理員可見。',{exact:true})).toBeVisible();
  await expect(title).toHaveCount(0);await expect(council.locator('.btn-primary')).toHaveCount(1);
  const create=council.getByRole('button',{name:'新增討論',exact:true});
  await create.focus();await page.keyboard.press('Enter');await expect(title).toBeFocused();
  await title.fill('未送出的跨公會議題');await body.fill('仍是草稿，不可自動建立。');
  await council.getByRole('button',{name:'收合，保留草稿',exact:true}).click();
  const resume=council.getByRole('button',{name:'繼續草稿',exact:true});await expect(resume).toBeFocused();await expect(title).toHaveCount(0);
  await tabs.getByRole('button',{name:'公會公告',exact:true}).click();await tabs.getByRole('button',{name:'公會長議事區',exact:true}).click();
  await resume.click();await expect(title).toHaveValue('未送出的跨公會議題');await expect(body).toHaveValue('仍是草稿，不可自動建立。');expect(writes).toBe(0);
  permissions={...permissions,can_discuss:false};await page.evaluate(()=>window.dispatchEvent(new Event('freedom-profile-updated')));
  await expect(tabs.getByRole('button',{name:'公會長議事區',exact:true})).toHaveCount(0);await expect(title).toHaveCount(0);
  permissions={...permissions,can_discuss:true};await page.evaluate(()=>window.dispatchEvent(new Event('freedom-profile-updated')));
  await tabs.getByRole('button',{name:'公會長議事區',exact:true}).click();await expect(title).toHaveCount(0);await create.click();await expect(title).toHaveValue('');await expect(body).toHaveValue('');expect(writes).toBe(0);
});

for(const deniedRetry of [false,true])test(`pending and unknown council creation retains its payload and key${deniedRetry?' through a denied replay':''}`,async({page})=>{
  const writes:{body:unknown;key:string|undefined}[]=[],items:any[]=[];let release=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/guild-council/threads',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{items}});
    writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});
    expect(route.request().headers()['x-csrf-token']).toBeTruthy();
    if(writes.length===1){items.push({thread_id:'created',...route.request().postDataJSON(),author_name:'測試會長',created_at:'2026-10-25T10:00:00Z',reply_count:0});await gate;return route.fulfill({status:503,json:{detail:'建立結果尚未確認。'}});}
    if(deniedRetry&&writes.length===2)return route.fulfill({status:403,json:{detail:'目前沒有議事權限。'}});
    return route.fulfill({json:items[0]});
  });
  try{
    await login(page);await navigate(page,'公會管理');const root=page.locator('.guild-workspace'),tabs=root.getByRole('navigation',{name:'公會管理功能'});
    await tabs.getByRole('button',{name:'公會長議事區',exact:true}).click();const council=root.locator('.guild-council');
    await council.getByRole('button',{name:'新增討論',exact:true}).click();
    const title=council.getByLabel('討論標題',{exact:true}),body=council.getByLabel('討論內容',{exact:true}),close=council.getByRole('button',{name:'收合，保留草稿',exact:true}),submit=council.getByRole('button',{name:'建立討論',exact:true});
    await title.fill('只建立一次');await body.fill('未知結果必須重試同一筆。');await submit.click();await expect.poll(()=>writes.length).toBe(1);
    await expect(close).toBeDisabled();await expect(title).toBeDisabled();await expect(body).toBeDisabled();await expect(submit).toBeDisabled();
    await tabs.getByRole('button',{name:'公會公告',exact:true}).click();release();
    await tabs.getByRole('button',{name:'公會長議事區',exact:true}).click();await expect(council.getByRole('alert')).toContainText('尚未確認');
    await expect(close).toBeDisabled();await expect(title).toBeDisabled();await expect(body).toHaveValue('未知結果必須重試同一筆。');await expect(submit).toBeEnabled();
    if(deniedRetry){
      await submit.click();await expect(council.getByRole('alert')).toContainText('沒有議事權限');
      await expect(close).toBeDisabled();await expect(title).toBeDisabled();await expect(body).toBeDisabled();
      await expect(title).toHaveValue('只建立一次');await expect(body).toHaveValue('未知結果必須重試同一筆。');
      await council.getByRole('button',{name:'重讀討論',exact:true}).click();
      await expect(council.getByRole('button',{name:/只建立一次/})).toBeDisabled();
      await tabs.getByRole('button',{name:'公會公告',exact:true}).click();await tabs.getByRole('button',{name:'公會長議事區',exact:true}).click();
      await expect(close).toBeDisabled();await expect(body).toHaveValue('未知結果必須重試同一筆。');
    }
    await submit.click();await expect(council.getByRole('status')).toContainText('討論已建立');await expect(title).toHaveCount(0);
    expect(writes).toHaveLength(deniedRetry?3:2);expect(writes[0].key).toBeTruthy();for(const write of writes)expect(write).toEqual(writes[0]);expect(items).toHaveLength(1);
    await expect(council.getByRole('button',{name:/只建立一次/})).toBeVisible();
  }finally{release();}
});

test('a rejected council draft remains editable and may be closed without discarding its text',async({page})=>{
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/v1/guild-council/threads',route=>route.request().method()==='GET'?route.fulfill({json:{items:[]}}):route.fulfill({status:400,json:{detail:'請補充議題內容。'}}));
  await login(page);await navigate(page,'公會管理');await page.getByRole('button',{name:'公會長議事區',exact:true}).click();const council=page.locator('.guild-council');
  await council.getByRole('button',{name:'新增討論',exact:true}).click();await council.getByLabel('討論標題',{exact:true}).fill('待補充');await council.getByLabel('討論內容',{exact:true}).fill('原內容');
  await council.getByRole('button',{name:'建立討論',exact:true}).click();await expect(council.getByRole('alert')).toContainText('補充');
  await council.getByLabel('討論內容',{exact:true}).fill('補充後仍未送出的內容');await council.getByRole('button',{name:'收合，保留草稿',exact:true}).click();await council.getByRole('button',{name:'繼續草稿',exact:true}).click();
  await expect(council.getByLabel('討論內容',{exact:true})).toHaveValue('補充後仍未送出的內容');
});

for(const width of [320,390,768,1440])test(`council disclosure remains readable and keyboard reachable at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:{managed_guilds:[],managed_books:[],can_discuss:true}}));
  await page.route('**/api/v1/guild-council/threads',route=>route.fulfill({json:{items:[]}}));
  await login(page);await navigate(page,'公會管理');const root=page.locator('.guild-workspace'),council=root.locator('.guild-council');
  for(const fontSize of [16,32]){
    await page.evaluate(value=>{document.documentElement.style.fontSize=`${value}px`;},fontSize);
    await expect.poll(()=>page.evaluate(()=>getComputedStyle(document.documentElement).fontSize)).toBe(`${fontSize}px`);
    const create=council.getByRole('button',{name:'新增討論',exact:true});await expect(create).toBeVisible();await expect(council.getByLabel('討論標題',{exact:true})).toHaveCount(0);
    expect(await root.locator('.guild-workspace-purpose').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
    await create.focus();await page.keyboard.press('Enter');await expect(council.getByLabel('討論標題',{exact:true})).toBeFocused();
    for(const button of await council.getByRole('button').all())expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await council.getByRole('button',{name:'收合，保留草稿',exact:true}).click();await expect(create).toBeFocused();
  }
});

for(const deniedRetry of [false,true])test(`an unknown council reply retains its thread and payload${deniedRetry?' through a denied replay':''}`,async({page})=>{
  const thread={thread_id:'original',title:'原討論',body:'討論內容',author_name:'測試會長',created_at:'2026-10-25T10:00:00Z',replies:[] as any[]},other={...thread,thread_id:'other',title:'另一討論'};
  const writes:{body:unknown;key:string|undefined}[]=[];
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:{managed_guilds:[],managed_books:[],can_discuss:true}}));
  await page.route('**/api/v1/guild-council/threads',route=>route.fulfill({json:{items:[thread,other]}}));
  await page.route('**/api/v1/guild-council/threads/original',route=>route.fulfill({json:thread}));
  await page.route('**/api/v1/guild-council/threads/original/replies',route=>{
    writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});
    if(writes.length===1){thread.replies.push({reply_id:'once',body:'原本的回覆',author_name:'測試會長',created_at:thread.created_at});return route.fulfill({status:503,json:{detail:'回覆結果尚未確認。'}});}
    if(deniedRetry&&writes.length===2)return route.fulfill({status:403,json:{detail:'目前沒有議事權限。'}});
    return route.fulfill({json:thread});
  });
  await login(page);await navigate(page,'公會管理');const council=page.locator('.guild-council');await council.getByRole('button',{name:/原討論/}).click();
  const reply=council.getByLabel('回覆討論',{exact:true});await reply.fill('原本的回覆');await council.getByRole('button',{name:'發布回覆',exact:true}).click();
  await expect(council.getByRole('alert')).toContainText('尚未確認');await expect(reply).toBeDisabled();await expect(reply).toHaveValue('原本的回覆');
  await expect(council.getByRole('button',{name:'新增討論',exact:true})).toBeDisabled();await expect(council.getByRole('button',{name:/另一討論/})).toBeDisabled();
  if(deniedRetry){
    await council.getByRole('button',{name:'發布回覆',exact:true}).click();await expect(council.getByRole('alert')).toContainText('沒有議事權限');
    await expect(reply).toBeDisabled();await expect(reply).toHaveValue('原本的回覆');
    await expect(council.getByRole('button',{name:'新增討論',exact:true})).toBeDisabled();await expect(council.getByRole('button',{name:/另一討論/})).toBeDisabled();
    await council.getByRole('button',{name:'重讀討論',exact:true}).click();await expect(reply).toBeDisabled();await expect(reply).toHaveValue('原本的回覆');
  }
  await council.getByRole('button',{name:'發布回覆',exact:true}).click();await expect(council.getByRole('status')).toContainText('回覆已發布');
  await expect(reply).toHaveValue('');await expect(reply).toBeEnabled();await expect(council.locator('.guild-council-reply')).toHaveCount(1);
  expect(writes).toHaveLength(deniedRetry?3:2);expect(writes[0].key).toBeTruthy();for(const write of writes)expect(write).toEqual(writes[0]);
});

test('announcement read retry distinguishes unavailable from empty and preserves the unsaved draft',async({page})=>{
  let reads=0;
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>{
    reads++;return reads===1?route.fulfill({status:503,json:{detail:'公告讀取暫時失敗。'}}):route.fulfill({json:{items:[]}});
  });
  await login(page);await navigate(page,'公會管理');const workspace=page.locator('.guild-workspace');
  await expect(workspace.getByRole('alert')).toBeVisible();await expect(workspace.getByText('尚未建立公告。',{exact:true})).toHaveCount(0);
  const title=workspace.getByRole('textbox',{name:'公告標題',exact:true}),body=workspace.getByRole('textbox',{name:'公告內容',exact:true});
  await title.fill('仍未儲存的標題');await body.fill('重新讀取不可清除的內容');
  await workspace.getByRole('button',{name:'重新載入列表',exact:true}).click();
  await expect(workspace.getByText('尚未建立公告。',{exact:true})).toBeVisible();await expect(workspace.getByRole('alert')).toHaveCount(0);
  await expect(title).toHaveValue('仍未儲存的標題');await expect(body).toHaveValue('重新讀取不可清除的內容');
});

test('announcement refresh recovery retains old data and an unresolved write error independently',async({page})=>{
  let reads=0,writes=0;
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>{
    if(route.request().method()==='POST'){writes++;return route.fulfill({status:503,json:{detail:'寫入結果未知。'}});}
    reads++;return reads===2?route.fulfill({status:503,json:{detail:'列表重讀失敗。'}}):route.fulfill({json:{items:[announcement]}});
  });
  await login(page);await navigate(page,'公會管理');const workspace=page.locator('.guild-workspace');
  await expect(workspace.getByRole('heading',{name:announcement.title,exact:true})).toBeVisible();
  const title=workspace.getByRole('textbox',{name:'公告標題',exact:true}),body=workspace.getByRole('textbox',{name:'公告內容',exact:true});
  await title.fill('等待確認的公告');await body.fill('原本未確認的內容');await workspace.getByRole('button',{name:'保存公告',exact:true}).click();
  await expect(workspace.getByRole('alert')).toBeVisible();const writeError=await workspace.getByRole('alert').innerText();
  await workspace.getByRole('button',{name:'重新載入列表',exact:true}).click();
  await expect(workspace.getByRole('alert')).toHaveCount(2);await expect(workspace.getByText('目前顯示上次成功讀取的公告，請重新載入列表。',{exact:true})).toBeVisible();
  await expect(workspace.getByRole('heading',{name:announcement.title,exact:true})).toBeVisible();
  await workspace.getByRole('button',{name:'重新載入列表',exact:true}).click();
  await expect(workspace.getByRole('alert')).toHaveCount(1);await expect(workspace.getByRole('alert')).toHaveText(writeError);
  await expect(title).toHaveValue('等待確認的公告');await expect(body).toHaveValue('原本未確認的內容');expect(writes).toBe(1);
});

test('council unavailable list is not an empty list and recovery keeps an unsaved discussion',async({page})=>{
  let reads=0;
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:{managed_guilds:[],managed_books:[],can_discuss:true}}));
  await page.route('**/api/v1/guild-council/threads',route=>{reads++;return reads===1?route.fulfill({status:503,json:{detail:'討論列表讀取失敗。'}}):route.fulfill({json:{items:[]}});});
  await login(page);await navigate(page,'公會管理');const council=page.locator('.guild-council');
  await expect(council.getByRole('alert')).toBeVisible();await expect(council.getByText('討論列表尚未載入，請重讀討論。',{exact:true})).toBeVisible();
  await expect(council.getByText('目前沒有討論。有跨公會的安排需要協調時，可以新增討論。',{exact:true})).toHaveCount(0);
  await council.getByRole('button',{name:'新增討論',exact:true}).click();
  await council.getByLabel('討論標題',{exact:true}).fill('尚未送出的標題');await council.getByLabel('討論內容',{exact:true}).fill('重讀後仍保留的內容');
  await council.getByRole('button',{name:'重讀討論',exact:true}).click();
  await expect(council.getByText('目前沒有討論。有跨公會的安排需要協調時，可以新增討論。',{exact:true})).toBeVisible();await expect(council.getByRole('alert')).toHaveCount(0);
  await expect(council.getByLabel('討論標題',{exact:true})).toHaveValue('尚未送出的標題');await expect(council.getByLabel('討論內容',{exact:true})).toHaveValue('重讀後仍保留的內容');
});

for(const mode of ['create','reply'] as const)test(`council list refresh recovery preserves an unknown ${mode} and its original retry`,async({page})=>{
  const thread={thread_id:'read-recovery',title:'已載入的討論',body:'合成內容',author_name:'測試會長',created_at:'2026-10-25T10:00:00Z',replies:[]};
  let reads=0;const writes:{body:unknown;key:string|undefined}[]=[];
  const write=async(route:Route)=>{writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});return writes.length===1?route.fulfill({status:503,json:{detail:'議事寫入結果尚未確認。'}}):route.fulfill({json:thread});};
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:{managed_guilds:[],managed_books:[],can_discuss:true}}));
  await page.route('**/api/v1/guild-council/threads',route=>{if(route.request().method()==='POST')return write(route);reads++;return reads===2?route.fulfill({status:503,json:{detail:'討論列表重讀失敗。'}}):route.fulfill({json:{items:[thread]}});});
  await page.route('**/api/v1/guild-council/threads/read-recovery',route=>route.fulfill({json:thread}));
  await page.route('**/api/v1/guild-council/threads/read-recovery/replies',write);
  await login(page);await navigate(page,'公會管理');const council=page.locator('.guild-council');
  await expect(council.getByRole('button',{name:/已載入的討論/})).toBeVisible();
  if(mode==='create'){await council.getByRole('button',{name:'新增討論',exact:true}).click();await council.getByLabel('討論標題',{exact:true}).fill('原本的議題');}else await council.getByRole('button',{name:/已載入的討論/}).click();
  const field=council.getByLabel(mode==='create'?'討論內容':'回覆討論',{exact:true}),submit=council.getByRole('button',{name:mode==='create'?'建立討論':'發布回覆',exact:true});
  await field.fill('必須保留的原內容');await submit.click();await expect(council.getByRole('alert')).toBeVisible();
  const writeError=await council.getByRole('alert').innerText();await expect(field).toBeDisabled();
  await council.getByRole('button',{name:'重讀討論',exact:true}).click();await expect(council.getByRole('alert')).toHaveCount(2);
  await expect(council.getByText('目前顯示上次成功讀取的討論列表，請重讀討論。',{exact:true})).toBeVisible();
  await expect(council.getByRole('button',{name:/已載入的討論/})).toBeDisabled();await expect(field).toHaveValue('必須保留的原內容');await expect(field).toBeDisabled();
  await council.getByRole('button',{name:'重讀討論',exact:true}).click();await expect(council.getByRole('alert')).toHaveCount(1);await expect(council.getByRole('alert')).toHaveText(writeError);
  await expect(field).toHaveValue('必須保留的原內容');await expect(field).toBeDisabled();expect(writes).toHaveLength(1);
  await submit.click();await expect(council.getByRole('status')).toContainText(mode==='create'?'討論已建立':'回覆已發布');
  expect(writes).toHaveLength(2);expect(writes[0].key).toBeTruthy();expect(writes[1]).toEqual(writes[0]);
});

test('council detail recovery clears its read error without losing an unknown reply or its original retry',async({page})=>{
  const thread={thread_id:'detail-recovery',title:'詳情重讀測試',body:'合成議題',author_name:'測試會長',created_at:'2026-10-25T10:00:00Z',replies:[] as {reply_id:string;body:string;author_name:string;created_at:string}[]};
  let detailReads=0;const writes:{body:unknown;key:string|undefined}[]=[];
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:{managed_guilds:[],managed_books:[],can_discuss:true}}));
  await page.route('**/api/v1/guild-council/threads',route=>route.fulfill({json:{items:[thread]}}));
  await page.route('**/api/v1/guild-council/threads/detail-recovery',route=>{detailReads++;return detailReads===2?route.fulfill({status:503,json:{detail:'討論詳情暫時無法讀取。'}}):route.fulfill({json:thread});});
  await page.route('**/api/v1/guild-council/threads/detail-recovery/replies',route=>{
    writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});
    if(writes.length===1){thread.replies.push({reply_id:'once',body:'未確認的原回覆',author_name:'測試會長',created_at:thread.created_at});return route.fulfill({status:503,json:{detail:'回覆結果尚未確認。'}});}
    return route.fulfill({json:thread});
  });
  await login(page);await navigate(page,'公會管理');const council=page.locator('.guild-council');await council.getByRole('button',{name:/詳情重讀測試/}).click();
  const reply=council.getByLabel('回覆討論',{exact:true});await reply.fill('未確認的原回覆');await council.getByRole('button',{name:'發布回覆',exact:true}).click();
  await expect(council.getByRole('alert')).toBeVisible();const writeError=await council.getByRole('alert').innerText();await expect(reply).toBeDisabled();
  await council.getByRole('button',{name:'重讀討論',exact:true}).click();await expect(council.getByRole('alert')).toHaveCount(2);
  expect(await council.getByRole('alert').allTextContents()).toContain(writeError);await expect(council.getByText('內容暫時無法載入，請重讀討論。',{exact:true})).toBeVisible();
  await expect(council.getByText('上次送出的結果尚未確認。請用原內容重試，確認前不能收合、切換討論或另開新討論。',{exact:true})).toBeVisible();
  await council.getByRole('button',{name:'重讀討論',exact:true}).click();await expect(reply).toHaveValue('未確認的原回覆');await expect(reply).toBeDisabled();
  await expect(council.getByRole('alert')).toHaveCount(1);await expect(council.getByRole('alert')).toHaveText(writeError);expect(writes).toHaveLength(1);
  await council.getByRole('button',{name:'發布回覆',exact:true}).click();await expect(council.getByRole('status')).toContainText('回覆已發布');await expect(reply).toBeEnabled();await expect(reply).toHaveValue('');
  expect(writes).toHaveLength(2);expect(writes[0].key).toBeTruthy();expect(writes[1]).toEqual(writes[0]);await expect(council.locator('.guild-council-reply')).toHaveCount(1);
});

for(const mode of ['create','edit'] as const)for(const denied of [403,412])test(`announcement ${mode} keeps its original tuple after unknown then ${denied} until ACK`,async({page})=>{
  await page.route('**/api/v1/guild-workspace',route=>route.fulfill({json:{...caps,managed_guilds:[...caps.managed_guilds,{guild_key:'other-synthetic-guild',name:'另一測試公會'}]}}));
  const calls:{path:string;body:unknown;key:string|undefined;version:string|undefined}[]=[];let reads=0;
  const respond=async(route:Route)=>{
    const request=route.request();calls.push({path:new URL(request.url()).pathname,body:request.postDataJSON(),key:request.headers()['idempotency-key'],version:request.headers()['if-match']});
    if(calls.length===1)return route.fulfill({status:503,json:{detail:'Synthetic committed response lost.'}});
    if(calls.length===2)return route.fulfill({status:denied,json:{detail:'Synthetic replay denial.'}});
    return route.fulfill({json:{...announcement,aggregate_version:3}});
  };
  await page.route('**/api/v1/guilds/synthetic-guild/announcements',route=>{
    if(route.request().method()==='POST')return respond(route);
    reads++;return route.fulfill({json:{items:[{...announcement,aggregate_version:reads>1?99:2}]}});
  });
  await page.route('**/api/v1/guild-announcements/synthetic-announcement/edit',respond);
  await login(page);await navigate(page,'公會管理');const workspace=page.locator('.guild-workspace');
  await expect(workspace.getByRole('heading',{name:announcement.title,exact:true})).toBeVisible();
  if(mode==='edit')await workspace.getByRole('button',{name:'編輯公告',exact:true}).click();
  const title=workspace.getByRole('textbox',{name:'公告標題',exact:true}),body=workspace.getByRole('textbox',{name:'公告內容',exact:true});
  await title.fill('尚待確認的原公告');await body.fill('只重試這份原內容。');
  await workspace.getByRole('button',{name:'保存公告',exact:true}).click();
  await expect(workspace.getByText('上次保存的結果尚未確認。請用原內容重試，確認前不能修改公告或切換公會。',{exact:true})).toBeVisible();
  for(const field of [title,body,workspace.getByRole('combobox',{name:'管理公會',exact:true}),workspace.getByRole('combobox',{name:'發布狀態',exact:true})])await expect(field).toBeDisabled();
  await expect(workspace.getByRole('button',{name:'編輯公告',exact:true})).toBeDisabled();
  if(mode==='edit')await expect(workspace.getByRole('button',{name:'新增另一則',exact:true})).toBeDisabled();
  await workspace.getByRole('button',{name:'重新載入列表',exact:true}).click();
  await expect(workspace.getByRole('heading',{name:announcement.title,exact:true})).toBeVisible();
  await workspace.getByRole('button',{name:'保存公告',exact:true}).click();
  await expect(workspace.getByRole('alert')).toContainText('Synthetic replay denial.');await expect(title).toBeDisabled();
  await workspace.getByRole('button',{name:'保存公告',exact:true}).click();await expect(workspace.getByText('公告已保存。',{exact:true})).toBeVisible();
  expect(calls).toHaveLength(3);expect(calls[0].key).toBeTruthy();expect(calls.every(call=>JSON.stringify(call)===JSON.stringify(calls[0]))).toBe(true);
  expect(calls[0].version).toBe(mode==='edit'?'"2"':undefined);await expect(title).toBeEnabled();await expect(title).toHaveValue('');
  await title.fill('確認後的新意圖');await body.fill('第二則獨立公告。');await workspace.getByRole('button',{name:'保存公告',exact:true}).click();
  await expect(workspace.getByText('公告已保存。',{exact:true})).toBeVisible();expect(calls).toHaveLength(4);expect(calls[3].key).not.toBe(calls[0].key);
});

test('a held announcement ACK after logout cannot enter the replacement session console or start its reads',async({page})=>{
  const syntheticTitle='Synthetic old-session announcement';let held:Route|undefined,captured!:()=>void,reads=0,writes=0;
  const requested=new Promise<void>(resolve=>captured=resolve),pattern='**/api/v1/guilds/synthetic-guild/announcements';
  const handler=(route:Route)=>{if(route.request().method()==='POST'){writes++;if(writes===1){held=route;captured();return;}return route.fulfill({json:{...announcement,...route.request().postDataJSON()}});}reads++;return route.fulfill({json:{items:[]}});};
  await page.route(pattern,handler);
  try{
    await login(page);await navigate(page,'公會管理');const original=await (await page.request.get('/api/v1/session')).json();
    const workspace=page.locator('.guild-workspace');await workspace.getByRole('textbox',{name:'公告標題',exact:true}).fill(syntheticTitle);await workspace.getByRole('textbox',{name:'公告內容',exact:true}).fill('Synthetic content from the previous session.');await workspace.getByRole('combobox',{name:'發布狀態',exact:true}).selectOption('published');
    await workspace.getByRole('button',{name:'保存公告',exact:true}).click();await requested;
    await page.getByRole('button',{name:'設定',exact:true}).click();await page.getByRole('menuitem',{name:'登出',exact:true}).click();await expect(page.locator('.login-card')).toBeVisible();
    // No page.goto: the old callback must survive in this same document.
    await page.getByLabel('電子郵件',{exact:true}).fill('client@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.locator('.shell')).toBeVisible();
    const replacement=await (await page.request.get('/api/v1/session')).json();expect(replacement.user.user_id).not.toBe(original.user.user_id);expect(replacement.csrf_token).not.toBe(original.csrf_token);
    await navigate(page,'公會管理');await expect(workspace.getByText('尚未建立公告。',{exact:true})).toBeVisible();const settledReads=reads;
    // Observe only this synthetic event's count, never store other console data.
    await page.evaluate(title=>{const root=window as any;if(typeof BroadcastChannel==='undefined')throw new Error('BroadcastChannel is required for this console delivery assertion');const original=BroadcastChannel.prototype.postMessage;root.__guildLifetimeProbe={events:0,restore:()=>{BroadcastChannel.prototype.postMessage=original;}};BroadcastChannel.prototype.postMessage=function(message){if(message?.type==='event'&&message.event?.message===title)root.__guildLifetimeProbe.events++;return original.call(this,message);};},syntheticTitle);
    const oldWrite=held!;const finished=page.waitForEvent('requestfinished',request=>request===oldWrite.request());await oldWrite.fulfill({json:{...announcement,title:syntheticTitle}});held=undefined;await finished;
    await workspace.getByRole('textbox',{name:'公告標題',exact:true}).fill('Replacement session draft');
    await expect(workspace.getByRole('textbox',{name:'公告標題',exact:true})).toHaveValue('Replacement session draft');expect(reads).toBe(settledReads);
    expect(await page.evaluate(()=>(window as any).__guildLifetimeProbe.events)).toBe(0);
    await workspace.getByRole('textbox',{name:'公告內容',exact:true}).fill('Replacement session body');
    await workspace.getByRole('button',{name:'保存公告',exact:true}).click();
    await expect(workspace.getByText('公告已保存。',{exact:true})).toBeVisible();
    await expect(workspace.getByRole('textbox',{name:'公告標題',exact:true})).toHaveValue('');expect(writes).toBe(2);
  }finally{
    if(held){try{await held.abort();}catch{/* Already completed or fixture teardown. */}}
    await page.unroute(pattern,handler);
    if(!page.isClosed())await page.evaluate(()=>{const root=window as any;root.__guildLifetimeProbe?.restore();delete root.__guildLifetimeProbe;});
  }
});
