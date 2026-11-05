import {test,expect,type Page} from './fixtures.js';

// Real chat UI and read POSTs, synthetic DTOs and visualViewport only. This is
// not a real mobile keyboard/pinch-zoom test or API/database authorization test.
const peer='30000000-0000-4000-8000-00000000000a';
const incoming='50000000-0000-4000-8000-000000000001';
const later='50000000-0000-4000-8000-000000000002';
const channel={kind:'guild',channel_key:'viewport-room',name:'可視範圍公會'};
const participant={user_id:peer,display_name:'可視範圍夥伴',avatar_url:null,last_seen_at:null,is_online:false};
function deferred(){let release=()=>{};const promise=new Promise<void>(resolve=>{release=resolve});return {promise,release};}
async function frames(page:Page){await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}

for(const kind of ['guild','direct'] as const)test(`${kind}: clipped incoming history stays unread until a visual-viewport-only reveal`,async({page})=>{
  await page.setViewportSize({width:1100,height:900});
  await page.addInitScript(()=>{
    const viewport=Object.assign(new EventTarget(),{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0,scale:1});
    Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
  });
  await page.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
  await page.route('**/api/v1/me/skill-books',route=>route.fulfill({json:{items:[]}}));
  await page.route(/\/api\/v1\/me\/notifications(\?.*)?$/,route=>route.fulfill({json:{items:[],unread_count:0,next_offset:null}}));
  const gate=deferred(),arrived=deferred(),reads:{path:string;through:string;key:string;csrf:string}[]=[];
  let read=false,newArrival=false;
  const first={message_id:incoming,sender_ref:peer,sender_name:participant.display_name,recipient_ref:'20000000-0000-4000-8000-000000000001',body:'合成未讀可視範圍測試',created_at:'2026-09-24T10:00:00.000000Z',read_at:null,retracted_at:null,...channel,sequence:'1'};
  const newer={...first,message_id:later,sequence:'2',body:'尚未顯示的新訊息',created_at:'2026-09-24T10:01:00.000000Z'};
  const unread=()=>Number(!read)+Number(newArrival);
  const base=kind==='guild'?'/api/v1/me/channels/guild/viewport-room':`/api/v1/me/conversations/${peer}`;
  await page.route(/\/api\/v1\/me\/channels\?/,route=>{
    const selected=kind==='guild'&&new URL(route.request().url()).searchParams.get('kind')==='guild';
    return route.fulfill({json:{items:selected?[{...channel,unread_count:unread(),last_message_at:first.created_at}]:[],unread_count:selected?unread():0,next_offset:null}});
  });
  await page.route(/\/api\/v1\/me\/conversations(\?.*)?$/,route=>route.fulfill({json:{items:kind==='direct'?[{participant,can_send:true,last_message:first,unread_count:unread()}]:[],unread_count:kind==='direct'?unread():0,next_offset:null}}));
  await page.route(`**${base}/**`,async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path.endsWith('/messages')&&request.method()==='GET'){
      // Snapshot before the hold. A newer server-side message must not be swept
      // into the read boundary for the one bubble this response actually draws.
      const snapshot={items:[{...first}],unread_count:unread(),next_offset:null,...(kind==='guild'?{channel}:{participant,can_send:true})};
      arrived.release();await gate.promise;return route.fulfill({json:snapshot});
    }
    if(path.endsWith('/activity'))return route.fulfill({json:kind==='guild'?{latest_sequence:newArrival?'2':'1',unread_count:unread()}:{last_message_id:newArrival?later:incoming,unread_count:unread(),can_send:true,last_outgoing:null}});
    if(path.endsWith('/read')&&request.method()==='POST'){
      reads.push({path,through:request.postDataJSON().through_message_id,key:request.headers()['idempotency-key'],csrf:request.headers()['x-csrf-token']});
      read=true;return route.fulfill({json:kind==='guild'?{...channel,read_sequence:'1',read_at:'2026-09-24T10:02:00Z'}:{user_id:peer,read_at:'2026-09-24T10:02:00Z',updated_count:1}});
    }
    return route.fulfill({status:404,json:{}});
  });
  try{
    await page.goto('/#messages');
    await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
    await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('button',{name:'設定',exact:true})).toBeVisible();
    const panel=page.getByRole('tabpanel',{name:kind==='guild'?/^公會閒聊/:/^私人訊息/});
    if(kind==='guild')await page.locator('.messages-categories').getByRole('tab',{name:/^公會閒聊/}).click();
    await panel.getByRole('button',{name:kind==='guild'?'可視範圍公會':/可視範圍夥伴/,exact:kind==='guild'}).click();
    await arrived.promise;
    // Keep normal layout dimensions. Only the visual rectangle excludes the
    // pending bubble, horizontally for a pan and vertically for a keyboard.
    await page.evaluate(axis=>{
      Object.assign(window.visualViewport!,axis==='guild'?{offsetLeft:0,width:1}:{offsetTop:0,height:1});
      window.visualViewport!.dispatchEvent(new Event(axis==='guild'?'scroll':'resize'));
    },kind);
    gate.release();
    const log=panel.getByRole('log'),bubble=log.locator(`[data-message-id="${incoming}"]`);
    await expect(bubble).toContainText(first.body);await log.evaluate(node=>{node.scrollTop=node.scrollHeight;node.dispatchEvent(new Event('scroll'));});
    await frames(page);
    const clipped=await bubble.evaluate((node,axis)=>{
      const box=node.getBoundingClientRect(),v=window.visualViewport!;
      return {layout:box.bottom>0&&box.top<innerHeight&&box.right>0&&box.left<innerWidth,excluded:axis==='guild'?box.left>=v.offsetLeft+v.width:box.top>=v.offsetTop+v.height};
    },kind);
    expect(clipped).toEqual({layout:true,excluded:true});expect(reads).toEqual([]);
    newArrival=true;
    const response=page.waitForResponse(result=>new URL(result.url()).pathname===`${base}/read`&&result.request().method()==='POST');
    await page.evaluate(event=>{
      Object.assign(window.visualViewport!,{offsetTop:0,offsetLeft:0,width:innerWidth,height:innerHeight});
      window.visualViewport!.dispatchEvent(new Event(event));
    },kind==='guild'?'scroll':'resize');
    expect(await (await response).finished()).toBeNull();
    await expect.poll(()=>reads.length).toBe(1);
    expect(reads[0].path).toBe(`${base}/read`);expect(reads[0].through).toBe(incoming);
    expect(reads[0].through).not.toBe(newer.message_id);expect(reads[0].key).toBeTruthy();expect(reads[0].csrf).toBeTruthy();
    await page.evaluate(()=>{window.visualViewport!.dispatchEvent(new Event('resize'));window.visualViewport!.dispatchEvent(new Event('scroll'));});
    await frames(page);expect(reads).toHaveLength(1);
  }finally{gate.release();}
});
