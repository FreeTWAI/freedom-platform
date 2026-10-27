import {openSettingsPanel,closeSettingsMenu} from './settings-menu-helpers.js';
import {DEFAULT_LAUNCHER_PLACEMENT,LAUNCHER_PLACEMENT_KEY,parseLauncherPlacement,launcherBounds,launcherPoint,snapLauncher,launcherDragPoint,launcherDragStarted} from '../../modules/member-communications/portal/floating-message-placement.js';
import {randomUUID} from 'node:crypto';
import {test,expect,type Page} from './fixtures.js';

const isChatReadPath=(pathname:string)=>/^\/api\/v1\/me\/(?:conversations\/[^/]+|channels\/(?:guild|squad|world)\/[^/]+)\/read$/.test(pathname);

test('idle request counter includes chat receipts but excludes social and notification reads',()=>{
  for(const pathname of ['/api/v1/me/conversations/peer/read','/api/v1/me/channels/world/world/read','/api/v1/me/channels/guild/guild_ai_vibe/read','/api/v1/me/channels/squad/squad-id/read'])expect(isChatReadPath(pathname)).toBe(true);
  for(const pathname of ['/api/v1/social-posts/post-id/read','/api/v1/me/notifications/notice-id/read','/api/v1/me/channels/world/world/messages','/api/v1/me/channels/world/world/read/extra'])expect(isChatReadPath(pathname)).toBe(false);
});

async function login(page:Page){
  await page.goto('/');await expect(page.locator('.floating-messages')).toHaveCount(0);
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('button',{name:'設定',exact:true})).toBeVisible();
}

test('chat size controls preserve drafts and fit resized desktop and mobile viewports',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await login(page);
  const panel=page.locator('.floating-message-panel'),bubble=page.locator('.floating-messages');
  await bubble.click();expect((await panel.boundingBox())!.width).toBe(560);
  await panel.getByLabel('搜尋會員',{exact:true}).fill('示範需求者');
  await panel.getByRole('button',{name:'搜尋會員',exact:true}).click();
  await panel.getByRole('button',{name:'傳訊給 示範需求者',exact:true}).click();
  const draft=panel.getByRole('textbox',{name:'寫給 示範需求者 的訊息'});await draft.fill('調整聊天室大小仍保留的草稿');
  await panel.getByRole('button',{name:'調整大小',exact:true}).click();
  const width=panel.getByRole('slider',{name:'聊天室寬度'}),height=panel.getByRole('slider',{name:'聊天室高度'});
  await width.fill('800');await height.fill('700');
  expect((await panel.boundingBox())!.width).toBe(800);expect((await panel.boundingBox())!.height).toBe(700);
  await width.focus();await width.press('ArrowLeft');await expect(width).toHaveValue('780');
  await expect(draft).toHaveValue('調整聊天室大小仍保留的草稿');
  await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();await bubble.click();expect((await panel.boundingBox())!.width).toBe(780);
  await page.setViewportSize({width:768,height:650});
  const box=(await panel.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(768);expect(box.y).toBeGreaterThanOrEqual(0);
  await page.setViewportSize({width:390,height:844});await expect(width).toBeHidden();await expect(height).toBeHidden();
  await expect(panel.getByRole('button',{name:'調整大小',exact:true})).toBeHidden();
  await expect.poll(async()=>Math.round((await panel.boundingBox())!.height)).toBe(844);
  expect((await panel.boundingBox())!.width).toBe(390);await expect(bubble).toBeHidden();
  await expect(draft).toHaveValue('調整聊天室大小仍保留的草稿');await expect(draft).toBeInViewport();
  const send=panel.getByRole('button',{name:'送出',exact:true}),close=panel.getByRole('button',{name:'收合聊天室',exact:true});
  const position=panel.getByRole('button',{name:'入口位置',exact:true});
  await send.focus();await page.keyboard.press('Tab');await expect(position).toBeFocused();
  await page.keyboard.press('Tab');await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(position).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(send).toBeFocused();
  await page.screenshot({path:'test-results/chat-size-controls-phone.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1440,height:900});await expect(width).toHaveValue('780');await expect(height).toHaveValue('700');
  await panel.getByRole('button',{name:'恢復預設大小'}).click();expect((await panel.boundingBox())!.width).toBe(560);
  await page.screenshot({path:'test-results/chat-size-controls-desktop.png'});
});

test('chat launcher counts chat sources only, does not open history or mark anything read, and refreshes after confirmed inbox changes',async({page})=>{
  let unread=1,fail=false,history=0,writes=0;const counted=new Set<string>();
  page.on('request',request=>{const url=new URL(request.url());if(request.method()==='POST'&&/conversations|channels.*read/.test(url.pathname))writes++;if(/\/conversations\/[^/]+\/messages|\/channels\/[^/]+\/[^/]+\/messages/.test(url.pathname))history++;});
  await page.route(/\/api\/v1\/me\/conversations\?limit=1&offset=0$/,route=>{counted.add('direct');return route.fulfill({json:{items:[],unread_count:unread,next_offset:null}})});
  await page.route(/\/api\/v1\/me\/channels\?kind=(guild|squad|world)&limit=1&offset=0$/,route=>{const kind=new URL(route.request().url()).searchParams.get('kind')!;counted.add(kind);return fail&&kind==='world'?route.fulfill({status:503,json:{}}):route.fulfill({json:{items:[],unread_count:unread*({guild:2,squad:3,world:4}[kind as 'guild'|'squad'|'world']),next_offset:null}})});
  await page.route(/\/api\/v1\/me\/notifications\?/,route=>route.fulfill({json:{items:[],unread_count:99,next_offset:null}}));
  await login(page);const launcher=page.locator('.floating-messages');await expect(launcher).toHaveAccessibleName('開啟聊天室，10 則未讀');expect([...counted].sort()).toEqual(['direct','guild','squad','world']);expect(history).toBe(0);expect(writes).toBe(0);
  unread=0;await page.evaluate(()=>window.dispatchEvent(new Event('freedom-inbox-updated')));await expect(launcher).toHaveAccessibleName('開啟聊天室');await expect(launcher.locator('.floating-messages-badge')).toHaveCount(0);
  fail=true;await page.evaluate(()=>window.dispatchEvent(new Event('freedom-inbox-updated')));await expect(launcher).toHaveAccessibleName('開啟聊天室，未讀數尚未確認');await expect(launcher.locator('.floating-messages-badge')).toHaveText('?');expect(writes).toBe(0);expect(history).toBe(0);
  await launcher.click();await expect(page.locator('.messages-categories')).toBeVisible();await expect(launcher).toBeHidden();await expect(launcher).toHaveAttribute('aria-expanded','true');await expect(page.locator('.game-console')).toHaveCount(0);
});

test('launcher and panel close preserve the persistent inbox across pages and themes at phone, tablet and desktop widths',async({page})=>{
  await login(page);const homeUrl=page.url(),bubble=page.locator('.floating-messages'),panel=page.locator('.floating-message-panel');
  for(const [name,theme] of [['自由工坊－明亮','light'],['自由工坊－夜航','dark'],['自由工坊－敘生','versefolk']]){
    await page.getByRole('button',{name:'設定',exact:true}).click();await openSettingsPanel(page,'appearance');await page.getByRole('menuitemradio',{name,exact:true}).click();await closeSettingsMenu(page);
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});await expect(bubble).toBeVisible();await expect(bubble).toBeInViewport();await bubble.click();await expect(panel).toBeVisible();await expect(bubble).toHaveAttribute('aria-expanded','true');
      const inbox=(await panel.boundingBox())!;
      if(width<=760){
        await expect(bubble).toBeHidden();await expect(panel).toHaveAttribute('aria-modal','true');
        expect(inbox.x).toBe(0);expect(inbox.y).toBe(0);expect(inbox.width).toBe(width);expect(inbox.height).toBe(900);
        await expect(page.locator('.shell')).toHaveJSProperty('inert',true);
        const close=panel.getByRole('button',{name:'收合聊天室',exact:true}),control=(await close.boundingBox())!;
        expect(control.width).toBeGreaterThanOrEqual(44);expect(control.height).toBeGreaterThanOrEqual(44);await expect(close).toBeInViewport();
      }else{
        await expect(bubble).toBeHidden();
        const close=panel.getByRole('button',{name:'收合聊天室',exact:true}),box=(await close.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);await expect(close).toBeInViewport();
        await expect(page.locator('.shell')).toHaveJSProperty('inert',false);
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect(panel.getByRole('tab')).toHaveCount(4);await expect(panel.getByRole('tab',{name:/^通知/})).toHaveCount(0);await expect(page.locator('.nav-primary').getByRole('button',{name:'我的訊息'})).toHaveCount(0);
      if([390,768,1440].includes(width))await page.screenshot({path:`test-results/unified-messages-${theme}-${width}.png`});
      await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(bubble).toBeFocused();await expect(page.locator('.shell')).toHaveJSProperty('inert',false);await expect(page).toHaveURL(homeUrl);
    }
  }
  await page.setViewportSize({width:1440,height:900});await bubble.click();
  await panel.getByLabel('搜尋會員',{exact:true}).fill('示範需求者');await panel.getByRole('button',{name:'搜尋會員',exact:true}).click();await panel.getByRole('button',{name:'傳訊給 示範需求者',exact:true}).click();
  const draft=panel.getByRole('textbox',{name:'寫給 示範需求者 的訊息'});await draft.fill('跨頁與收合後保留的草稿');await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();await expect(panel).toBeHidden();
  await page.getByRole('button',{name:'技能書架',exact:true}).click();await bubble.click();await expect(draft).toHaveValue('跨頁與收合後保留的草稿');
  await page.setViewportSize({width:390,height:844});await expect(bubble).toBeHidden();await expect(draft).toBeVisible();await page.screenshot({path:'test-results/unified-messages-draft-phone.png'});
  await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();await expect(panel).toBeHidden();await expect(bubble).toBeFocused();await expect(page.locator('.community-header')).toBeVisible();
});

async function readFixture(page:Page,kind:'world'|'direct',hold=false){
  const peer='20000000-0000-4000-8000-000000000099',id='30000000-0000-4000-8000-000000000099';
  const participant={user_id:peer,display_name:'合成已讀夥伴',avatar_url:null,last_seen_at:null,is_online:false};
  const message={message_id:id,sender_ref:peer,recipient_ref:'20000000-0000-4000-8000-000000000001',sender_name:participant.display_name,body:'合成已讀邊界',sequence:'1',kind:'world',channel_key:'world',created_at:'2026-10-01T00:00:00Z',read_at:null};
  let release!:()=>void,acknowledged!:()=>void,unread=1,reads=0,histories=0;
  const gate=new Promise<void>(resolve=>{release=resolve}),ack=new Promise<void>(resolve=>{acknowledged=resolve});
  if(!hold)release();
  const root=kind==='world'?'/api/v1/me/channels/world/world':`/api/v1/me/conversations/${peer}`;
  await page.route(url=>url.pathname===root+'/messages',async route=>{
    histories++;
    await route.fulfill({json:kind==='world'?{channel:{kind:'world',channel_key:'world',name:'世界聊天'},items:[message],unread_count:unread,next_offset:null}:{participant,can_send:true,items:[message],unread_count:unread,next_offset:null}});
  });
  await page.route(url=>url.pathname===root+'/activity',route=>route.fulfill({json:kind==='world'?{latest_sequence:'1',unread_count:unread}:{last_message_id:id,unread_count:unread,can_send:true}}));
  if(kind==='direct')await page.route(url=>url.pathname==='/api/v1/me/conversations',route=>route.fulfill({json:{items:[{participant,can_send:true,last_message:message,unread_count:unread}],unread_count:unread,next_offset:null}}));
  await page.route(url=>url.pathname===root+'/read',async route=>{
    reads++;await gate;unread=0;
    await route.fulfill({json:kind==='world'?{read_sequence:'1',read_at:'2026-10-01T00:00:01Z'}:{user_id:peer,read_at:'2026-10-01T00:00:01Z',updated_count:1}});acknowledged();
  });
  return {release,ack,counts:()=>({reads,histories})};
}

test('closed history stays idle and legacy inbox/popout links open the same panel',async({page,request,baseURL})=>{
  const sender=await request.post('/api/v1/auth/login',{data:{email:'reviewer@local.test',password:'freedom-local-demo'},headers:{Origin:baseURL!}});
  expect(sender.status()).toBe(200);const {csrf_token}=await sender.json();
  const body=`收合前可見的未讀訊息 ${randomUUID()}`;
  const sent=await request.post('/api/v1/me/channels/world/world/messages',{data:{body},headers:{Origin:baseURL!,'X-CSRF-Token':csrf_token,'Idempotency-Key':randomUUID()}});
  expect(sent.status()).toBe(201);
  const message=await sent.json();
  let history=0,reads=0;
  page.on('request',request=>{const url=new URL(request.url());if(/channels\/world\/world\/messages$/.test(url.pathname))history++;if(request.method()==='POST'&&isChatReadPath(url.pathname))reads++;});
  await login(page);const bubble=page.locator('.floating-messages'),panel=page.locator('.floating-message-panel');
  // The visible initial read and its count refresh must finish before measuring
  // closed-panel idleness; the textbox can render before history/read settles.
  const initialRead=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/channels/world/world/read'));
  await bubble.click();await panel.getByRole('tab',{name:/世界聊天/}).click();
  await expect(panel.getByRole('log')).toContainText(body);
  const acknowledged=await initialRead;expect(acknowledged.status()).toBe(200);
  expect(acknowledged.request().postDataJSON()).toEqual({through_message_id:message.message_id});
  await expect(panel.getByText('正在同步已讀…',{exact:true})).toBeHidden();
  await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();await expect(panel).toBeHidden();const before={history,reads};
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(1300);expect({history,reads}).toEqual(before);
  await page.goto('/#messages');await expect(panel).toBeVisible();await expect(bubble).toBeHidden();await expect(page.locator('.member-messages')).toHaveCount(1);
  await page.goto('/?game-console=popout&scope=legacy-fixture');await expect(panel).toBeVisible();await expect(page).toHaveURL(/\/#messages$/);await expect(page.locator('.game-console')).toHaveCount(0);
});

for(const kind of ['world','direct'] as const)test(`a delayed ${kind} read acknowledgement after collapse starts no hidden history refresh`,async({page})=>{
  const fixture=await readFixture(page,kind,true);
  try{
    await login(page);const bubble=page.locator('.floating-messages'),panel=page.locator('.floating-message-panel');
    await bubble.click();
    if(kind==='world')await panel.getByRole('tab',{name:/世界聊天/}).click();
    else await panel.getByRole('list',{name:'對話列表'}).getByRole('button',{name:/合成已讀夥伴/}).click();
    await expect.poll(()=>fixture.counts().reads).toBe(1);
    await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();await expect(panel).toBeHidden();const before=fixture.counts();
    fixture.release();await fixture.ack;
    await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(1300);expect(fixture.counts()).toEqual(before);
    await bubble.click();await expect(panel).toBeVisible();
    await expect.poll(()=>fixture.counts().histories).toBeGreaterThan(before.histories);
    expect(fixture.counts().reads).toBe(1);
  }finally{fixture.release();}
});

test('a direct read ACK refreshes list totals after a newer manual thread read',async({page})=>{
  const fixture=await readFixture(page,'direct',true);
  try{
    await login(page);const panel=page.locator('.floating-message-panel');
    await page.locator('.floating-messages').click();
    await panel.getByRole('list',{name:'對話列表'}).getByRole('button',{name:/合成已讀夥伴/}).click();
    await expect.poll(()=>fixture.counts().reads).toBe(1);
    const draft=panel.getByRole('textbox',{name:'寫給 合成已讀夥伴 的訊息'});
    await draft.fill('讀取競態保留草稿');
    const before=fixture.counts().histories;
    await panel.getByRole('button',{name:'重新讀取訊息',exact:true}).click();
    await expect.poll(()=>fixture.counts().histories).toBeGreaterThan(before);
    await expect(panel.getByRole('button',{name:'重新讀取訊息',exact:true})).toHaveAttribute('aria-disabled','false');
    fixture.release();await fixture.ack;
    await expect(panel.getByRole('tab',{name:/私人訊息/})).toContainText('沒有未讀');
    await expect(draft).toHaveValue('讀取競態保留草稿');
    expect(fixture.counts().reads).toBe(1);
  }finally{fixture.release();}
});

test('legacy loaded history is reread at microsecond precision before quiet refresh replaces it',async({page})=>{
  const peer='20000000-0000-4000-8000-000000000099',owner='20000000-0000-4000-8000-000000000001';
  const root=`/api/v1/me/conversations/${peer}`,participant={user_id:peer,display_name:'合成精度夥伴',avatar_url:null,last_seen_at:null,is_online:false};
  const message=(message_id:string,created_at:string)=>({message_id,sender_ref:peer,recipient_ref:owner,body:`合成精度訊息 ${message_id}`,created_at,read_at:'2026-10-05T00:00:00.000Z',retracted_at:null});
  const rows=[...Array.from({length:20},(_,index)=>message(`30000000-0000-4000-8000-${String(20-index).padStart(12,'0')}`,`2026-10-04T00:01:${String(19-index).padStart(2,'0')}.000000Z`)),
    message('00000000-0000-4000-8000-000000000001','2026-10-04T00:00:00.123999Z'),
    message('ffffffff-ffff-4fff-8fff-ffffffffffff','2026-10-04T00:00:00.123001Z')];
  // Simulate a producer cutover: old wire dates have already lost their microseconds.
  // Both affected rows are outside the latest page, so replacing that page alone cannot repair them.
  let precise=false;
  const project=(item:typeof rows[number])=>precise?item:{...item,created_at:new Date(item.created_at).toISOString()};
  await page.route(url=>url.pathname===root+'/messages',route=>{
    const query=new URL(route.request().url()).searchParams,offset=Number(query.get('offset')??0),limit=Number(query.get('limit')??20);
    return route.fulfill({json:{participant,can_send:true,items:rows.slice(offset,offset+limit).map(project),unread_count:0,next_offset:offset+limit<rows.length?offset+limit:null,retraction_count:'0'}});
  });
  await page.route(url=>url.pathname===root+'/activity',route=>route.fulfill({json:{last_message_id:rows[0].message_id,unread_count:0,can_send:true,last_outgoing:null,retraction_count:'0'}}));
  await page.route(url=>url.pathname==='/api/v1/me/conversations',route=>route.fulfill({json:{items:[{participant,can_send:true,last_message:project(rows[0]),unread_count:0}],unread_count:0,next_offset:null}}));
  await login(page);
  await page.locator('.floating-messages').click();
  const panel=page.locator('.floating-message-panel');
  await panel.getByRole('list',{name:'對話列表'}).getByRole('button',{name:new RegExp(participant.display_name)}).click();
  await panel.getByRole('button',{name:'載入較早訊息',exact:true}).click();
  const shown=panel.locator('[data-message-id]'),expected=rows.toReversed().map(item=>item.message_id);
  await expect.poll(()=>shown.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-message-id')).sort())).toEqual([...expected].sort());
  precise=true;
  await panel.getByRole('button',{name:'重新讀取訊息',exact:true}).click();
  await expect.poll(()=>shown.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-message-id')))).toEqual(expected);
});

for(const order of ['refresh-first','older-first'] as const)test(`precision refresh and older paging preserve every row and cursor (${order})`,async({page})=>{
  const peer='20000000-0000-4000-8000-000000000099',owner='20000000-0000-4000-8000-000000000001';
  const root=`/api/v1/me/conversations/${peer}`,participant={user_id:peer,display_name:'合成分頁精度夥伴',avatar_url:null,last_seen_at:null,is_online:false};
  const rows=Array.from({length:60},(_,index)=>({message_id:`30000000-0000-4000-8000-${String(60-index).padStart(12,'0')}`,sender_ref:peer,recipient_ref:owner,body:`合成分頁訊息 ${index}`,
    created_at:new Date(Date.UTC(2026,9,4,0,1,59-index)).toISOString().replace('.000Z','.000000Z'),read_at:'2026-10-05T00:00:00.000Z',retracted_at:null}));
  Object.assign(rows[20],{message_id:'00000000-0000-4000-8000-000000000001',created_at:'2026-10-04T00:01:39.123999Z'});
  Object.assign(rows[21],{message_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',created_at:'2026-10-04T00:01:39.123001Z'});
  let precise=false,refreshHeld=false,olderHeld=false,activeRoutes=0;
  let releaseRefresh!:()=>void,releaseOlder!:()=>void;
  const refreshGate=new Promise<void>(resolve=>{releaseRefresh=resolve;}),olderGate=new Promise<void>(resolve=>{releaseOlder=resolve;});
  const reads:{offset:number;precise:boolean}[]=[];
  const project=(item:typeof rows[number])=>precise?item:{...item,created_at:new Date(item.created_at).toISOString()};
  await page.route(url=>url.pathname===root+'/messages',async route=>{
    const query=new URL(route.request().url()).searchParams,offset=Number(query.get('offset')??0),limit=Number(query.get('limit')??20);
    const items=rows.slice(offset,offset+limit).map(project),wasPrecise=precise;reads.push({offset,precise:wasPrecise});activeRoutes++;
    try{
      if(offset===40&&!wasPrecise&&order==='older-first'){olderHeld=true;await olderGate;}
      if(offset===20&&wasPrecise){refreshHeld=true;await refreshGate;}
      await route.fulfill({json:{participant,can_send:true,items,unread_count:0,next_offset:offset+limit<rows.length?offset+limit:null,retraction_count:'0'}});
    }finally{activeRoutes--;}
  });
  await page.route(url=>url.pathname===root+'/activity',route=>route.fulfill({json:{last_message_id:rows[0].message_id,unread_count:0,can_send:true,last_outgoing:null,retraction_count:'0'}}));
  await page.route(url=>url.pathname==='/api/v1/me/conversations',route=>route.fulfill({json:{items:[{participant,can_send:true,last_message:project(rows[0]),unread_count:0}],unread_count:0,next_offset:null}}));
  try{
    await login(page);await page.locator('.floating-messages').click();const panel=page.locator('.floating-message-panel');await panel.getByRole('list',{name:'對話列表'}).getByRole('button',{name:new RegExp(participant.display_name)}).click();
    const older=panel.getByRole('button',{name:'載入較早訊息',exact:true}),reload=panel.getByRole('button',{name:'重新讀取訊息',exact:true}),shown=panel.locator('[data-message-id]');
    await older.click();await expect(shown).toHaveCount(40);const draft=panel.locator('textarea');await draft.fill('分頁與精度刷新都保留這份草稿');
    if(order==='older-first'){
      await older.click();await expect.poll(()=>olderHeld).toBe(true);precise=true;await reload.click();
      expect(reads.filter(read=>read.precise)).toHaveLength(0);await expect(shown).toHaveCount(40);
      releaseOlder();
    }else{precise=true;await reload.click();}
    await expect.poll(()=>refreshHeld).toBe(true);
    await expect(reload).toHaveAttribute('aria-disabled','true');
    if(order==='refresh-first'){
      await expect(older).toBeEnabled();await older.click();
      await expect(panel.getByRole('button',{name:'正在讀取…',exact:true})).toBeDisabled();
      expect(reads.some(read=>read.offset===40)).toBe(false);await expect(shown).toHaveCount(40);
    }else await expect(shown).toHaveCount(60);
    releaseRefresh();await expect(reload).toHaveAttribute('aria-disabled','false');
    await expect.poll(()=>shown.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-message-id')))).toEqual(rows.toReversed().map(row=>row.message_id));
    await expect(older).toHaveCount(0);await expect(draft).toHaveValue('分頁與精度刷新都保留這份草稿');
    expect(reads).toContainEqual({offset:40,precise:true});
    if(order==='refresh-first')expect(reads.filter(read=>read.offset===40)).toEqual([{offset:40,precise:true}]);
  }finally{releaseOlder();releaseRefresh();await expect.poll(()=>activeRoutes).toBe(0);}
});


test('launcher placement validates persisted values and clamps drag geometry to safe visual bounds',()=>{
  for(const raw of [null,'broken','null','[]','{}','{"side":"top","vertical":0.5}','{"side":"left","vertical":-1}','{"side":"left","vertical":2}','{"side":"right","vertical":"0.5"}','{"side":"right","vertical":1e999}'])expect(parseLauncherPlacement(raw)).toEqual(DEFAULT_LAUNCHER_PLACEMENT);
  expect(parseLauncherPlacement('{"side":"left","vertical":0.25,"account":"ignored"}')).toEqual({side:'left',vertical:0.25});
  const bounds=launcherBounds({left:10,top:36,width:390,height:480},60,{left:12,right:20,top:30,bottom:24},20);
  expect(bounds).toEqual({left:30,right:312,top:94,bottom:416});
  expect(launcherPoint({side:'right',vertical:1},bounds)).toEqual({x:312,y:416});
  expect(snapLauncher(-100,-100,bounds)).toEqual({side:'left',vertical:0});
  expect(snapLauncher(999,999,bounds)).toEqual({side:'right',vertical:1});
  const start={x:312,y:416,pointerX:348,pointerY:452};
  expect(launcherDragStarted(start,{x:351,y:455})).toBe(false);
  expect(launcherDragStarted(start,{x:354,y:452})).toBe(true);
  expect(launcherDragPoint(start,{x:-100,y:999},bounds)).toEqual({x:30,y:416});
  expect(snapLauncher(0,0,{left:16,right:16,top:16,bottom:16})).toEqual({side:'left',vertical:1});
  expect(launcherBounds({left:5,top:10,width:80,height:60},60,{left:30,right:30,top:40,bottom:40},50)).toEqual({left:25,right:25,top:10,bottom:10});
  expect(launcherBounds({left:5,top:10,width:30,height:30},60,{left:0,right:0,top:0,bottom:0})).toEqual({left:5,right:5,top:10,bottom:10});
});

test('full-size launcher snaps after dragging, cancels without opening and retains accessible keyboard placement after reload',async({page})=>{
  await page.setViewportSize({width:390,height:844});await login(page);
  const bubble=page.locator('.floating-messages'),panel=page.locator('.floating-message-panel');
  await expect(bubble).toHaveAccessibleName(/開啟聊天室/);await expect(bubble.locator('.floating-messages-label')).toBeVisible();
  const initial=(await bubble.boundingBox())!;expect(initial.width).toBe(60);expect(initial.height).toBe(60);
  await page.mouse.move(initial.x+30,initial.y+30);await page.mouse.down();await page.mouse.move(30,260,{steps:10});await page.mouse.up();
  await expect(panel).toBeHidden();await expect.poll(async()=>Math.round((await bubble.boundingBox())!.x)).toBe(16);
  const moved=(await bubble.boundingBox())!;expect(moved.y).toBeLessThan(initial.y);
  await page.reload();await expect.poll(async()=>Math.round((await bubble.boundingBox())!.y)).toBe(Math.round(moved.y));
  const restored=(await bubble.boundingBox())!;
  await page.mouse.move(restored.x+30,restored.y+30);await page.mouse.down();await page.mouse.move(350,180,{steps:5});
  await bubble.dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',isPrimary:true});await page.mouse.up();
  await expect(panel).toBeHidden();await expect.poll(async()=>Math.round((await bubble.boundingBox())!.x)).toBe(16);
  await bubble.click();await expect(panel).toBeVisible();
  const position=panel.getByRole('button',{name:'入口位置',exact:true});await position.focus();await position.press('Enter');
  await panel.getByLabel('訊息入口側邊').selectOption('right');
  const vertical=panel.getByRole('slider',{name:'訊息入口高度'});await vertical.focus();await vertical.press('Home');await expect(vertical).toHaveValue('0');
  await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();await expect(bubble).toBeFocused();
  expect((await bubble.boundingBox())!.x).toBe(314);expect((await bubble.boundingBox())!.y).toBe(12);
  await bubble.press('Enter');await expect(panel).toBeVisible();
  await panel.getByRole('button',{name:'重設入口位置',exact:true}).click();
  await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),LAUNCHER_PLACEMENT_KEY)).toEqual(DEFAULT_LAUNCHER_PLACEMENT);
  expect(Math.round((await bubble.boundingBox())!.y)).toBe(768);
});

test('launcher stays in simulated keyboard and safe-area bounds and remains usable when its storage is blocked',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(key=>{
    const viewport=Object.assign(new EventTarget(),{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0,scale:1});
    Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
    Storage.prototype.getItem=function(name){if(name===key)throw new DOMException('Blocked','SecurityError');return get.call(this,name);};
    Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException('Blocked','SecurityError');return set.call(this,name,value);};
  },LAUNCHER_PLACEMENT_KEY);
  await login(page);const bubble=page.locator('.floating-messages'),panel=page.locator('.floating-message-panel');
  await page.evaluate(()=>{
    for(const [side,value] of Object.entries({top:30,bottom:24,left:12,right:20}))document.documentElement.style.setProperty(`--app-safe-${side}`,`${value}px`);
    Object.assign(window.visualViewport!,{height:320,offsetTop:36});window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async()=>Math.round((await bubble.boundingBox())!.y)).toBe(256);
  const start=(await bubble.boundingBox())!;await page.mouse.move(start.x+30,start.y+30);await page.mouse.down();await page.mouse.move(0,0,{steps:8});await page.mouse.up();
  await expect(panel).toBeHidden();const moved=(await bubble.boundingBox())!;expect(moved.x).toBe(20);expect(moved.y).toBe(74);
  await bubble.click();await expect(panel).toBeVisible();await panel.getByRole('button',{name:'入口位置',exact:true}).click();
  await panel.getByRole('button',{name:'重設入口位置',exact:true}).click();await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();await expect(bubble).toBeVisible();
  await page.setViewportSize({width:844,height:390});
  await page.evaluate(()=>{Object.assign(window.visualViewport!,{width:844,height:390,offsetTop:0});window.visualViewport!.dispatchEvent(new Event('resize'));});
  await expect.poll(async()=>(await bubble.boundingBox())!.width).toBe(60);
  const landscape=(await bubble.boundingBox())!;expect(landscape.width).toBe(60);expect(landscape.x+landscape.width).toBeLessThanOrEqual(824);expect(landscape.y+landscape.height).toBeLessThanOrEqual(366);
});


test('desktop dragged launcher stays hidden while the panel is open and restores its saved position on close',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await login(page);
  const bubble=page.locator('.floating-messages'),panel=page.locator('.floating-message-panel');
  await bubble.click();const originalPanel=(await panel.boundingBox())!;await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();
  const initial=(await bubble.boundingBox())!;
  await page.mouse.move(initial.x+30,initial.y+30);await page.mouse.down();
  await page.mouse.move(1400,originalPanel.y+30,{steps:10});await page.mouse.up();
  const saved=(await bubble.boundingBox())!,preference=await page.evaluate(key=>localStorage.getItem(key),LAUNCHER_PLACEMENT_KEY);
  expect(saved.y).toBeLessThan(originalPanel.y+originalPanel.height);expect(saved.y+saved.height).toBeGreaterThan(originalPanel.y);
  await bubble.click();await expect(panel).toBeVisible();
  await expect(bubble).toBeHidden();
  const close=panel.getByRole('button',{name:'收合聊天室',exact:true}),search=panel.getByLabel('搜尋會員',{exact:true});
  for(const control of [close,search])expect(await control.evaluate(node=>{
    const box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return hit===node||node.contains(hit);
  })).toBe(true);
  await search.fill('可操作搜尋');await expect(search).toHaveValue('可操作搜尋');
  await close.click();await expect(panel).toBeHidden();await expect(bubble).toBeFocused();
  expect(await page.evaluate(key=>localStorage.getItem(key),LAUNCHER_PLACEMENT_KEY)).toBe(preference);
  expect((await bubble.boundingBox())!.y).toBe(saved.y);
  await bubble.click();await panel.getByRole('button',{name:'收合聊天室',exact:true}).click();await expect(panel).toBeHidden();expect((await bubble.boundingBox())!.y).toBe(saved.y);
  for(const viewport of [{width:1440,height:360},{width:780,height:400}]){
    await page.setViewportSize(viewport);
    // This online desktop fixture has a 60px launcher and zero safe-area insets.
    const expectedY=launcherPoint(parseLauncherPlacement(preference),launcherBounds({left:0,top:0,...viewport},60,{left:0,right:0,top:0,bottom:0})).y;
    // Wait for resize handling before the baseline; Chromium quantizes layout to 1/64px.
    await expect.poll(async()=>Math.abs((await bubble.boundingBox())!.y-expectedY)).toBeLessThan(1/64);
    const before=(await bubble.boundingBox())!;
    await bubble.focus();await bubble.press('Enter');await expect(panel).toBeVisible();
    await expect(bubble).toBeHidden();
    expect(await close.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    await close.focus();await close.press('Enter');await expect(bubble).toBeFocused();
    expect((await bubble.boundingBox())!.y).toBe(before.y);
    expect(await page.evaluate(key=>localStorage.getItem(key),LAUNCHER_PLACEMENT_KEY)).toBe(preference);
  }
});

test('desktop layout with a reduced visual viewport hides launcher and keeps panel close operable',async({page})=>{
  await page.setViewportSize({width:1024,height:768});
  await page.addInitScript(()=>{
    const viewport=Object.assign(new EventTarget(),{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0,scale:1});
    Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
  });
  await login(page);const bubble=page.locator('.floating-messages'),panel=page.locator('.floating-message-panel');
  const initial=(await bubble.boundingBox())!;
  await page.mouse.move(initial.x+30,initial.y+30);await page.mouse.down();await page.mouse.move(980,280,{steps:10});await page.mouse.up();
  const preference=await page.evaluate(key=>localStorage.getItem(key),LAUNCHER_PLACEMENT_KEY);
  await page.evaluate(()=>{Object.assign(window.visualViewport!,{width:1024,height:400,offsetTop:0});window.visualViewport!.dispatchEvent(new Event('resize'));});
  await expect.poll(async()=>(await bubble.boundingBox())!.y).toBeLessThan(340);
  const before=(await bubble.boundingBox())!;await bubble.click();await expect(panel).toBeVisible();await expect(bubble).toBeHidden();
  expect(await page.evaluate(()=>({layoutWidth:innerWidth,layoutHeight:innerHeight,visualHeight:visualViewport!.height}))).toEqual({layoutWidth:1024,layoutHeight:768,visualHeight:400});
  const close=panel.getByRole('button',{name:'收合聊天室',exact:true});
  expect(await close.evaluate(node=>{const r=node.getBoundingClientRect();return r.y>=0&&r.bottom<=visualViewport!.height&&node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  await close.click();await expect(bubble).toBeFocused();expect((await bubble.boundingBox())!.y).toBe(before.y);
  expect(await page.evaluate(key=>localStorage.getItem(key),LAUNCHER_PLACEMENT_KEY)).toBe(preference);
  await bubble.press('Enter');await expect(bubble).toBeHidden();await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(bubble).toBeFocused();
  expect(await page.evaluate(key=>localStorage.getItem(key),LAUNCHER_PLACEMENT_KEY)).toBe(preference);
});
