import {eventAppPath} from './navigation.js';
import {randomUUID} from 'node:crypto';
import {test,expect,type Page} from './fixtures.js';
import {quickJoin} from './quick-join.js';
import type {CommunityEvent} from '../../apps/portal-web/src/modules/EventsPanel.js';

// Authoring/discovery only for this delivery. The future native run must use a
// fresh official build and isolated E2E harness. These routes control the HTTP
// lifecycle to test the real UI; they do not prove Asset storage, DB or policy.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
async function login(page:Page){
 await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
 const home=page.getByRole('heading',{name:'動態',exact:true}),join=page.getByRole('region',{name:'快速加入公會',exact:true});await expect(home.or(join)).toBeVisible();if(await join.isVisible())await quickJoin(page);await expect(home).toBeVisible();
 const session=await page.evaluate(async()=>{const response=await fetch('/api/v1/session');if(!response.ok)throw Error('Synthetic session unavailable');return response.json();});return session.user.user_id as string;
}
async function routes(page:Page,owner:string,lostFirst=false){
 const eventId=randomUUID(),prizeId=randomUUID(),origin=new URL(page.url()).origin;
 const event:CommunityEvent={event_id:eventId,organizer_ref:owner,organizer_name:'合成主辦者',title:'合成照片活動',description:'純 UI 邊界驗證',starts_at:'2099-01-01T12:00:00Z',ends_at:'2099-01-01T13:00:00Z',mode:'online',location:'合成教室',event_kind:'other',topic:null,online_url:null,visibility:'open',banner_url:null,banner_orientation:null,video_url:null,video_mime:null,capacity:null,state:'pending',aggregate_version:3,attending_count:0,my_rsvp:null,guild_key:null,review_guild_key:null,can_review:false,review_reason:null,registration_policy:'community_member',prize_details:[{prize_id:prizeId,name:'合成獎品',description:'保持完整比例',quantity:1,completion_rule:'由主辦者依公開條件確認',claim_note:'活動現場領取',icon_id:'gift'}],prize_photos:[]};
 const imageReads:string[]=[],writes:{body:Buffer|null;key:string;version:string;operation:string}[]=[],receipts=new Map<string,unknown>();let failImage=false,uploadAvailable=true;
 const exact=(path:string)=>(url:URL)=>url.origin===origin&&url.pathname===path;
 await page.route(exact('/api/v1/events'),async route=>{if(route.request().method()!=='GET')return route.fallback();await route.fulfill({json:{items:[event]}});});
 await page.route(exact(`/api/v1/events/${eventId}/prizes/${prizeId}/photo/availability`),async route=>{if(route.request().method()!=='GET')return route.fallback();await route.fulfill({json:{event_id:eventId,prize_id:prizeId,organizer_ref:owner,upload_available:uploadAvailable}});});
 await page.route(exact(`/api/v1/events/${eventId}`),async route=>{if(route.request().method()!=='GET')return route.fallback();await route.fulfill({json:event});});
 await page.route(url=>url.origin===origin&&new RegExp(`^/api/v1/(?:public/)?events/${eventId}/prizes/${prizeId}/photo(?:/remove)?$`).test(url.pathname),async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='GET'){imageReads.push(url.pathname+url.search);if(failImage){await route.fulfill({status:503,body:'Unavailable'});return;}await route.fulfill({contentType:'image/png',headers:{'Cache-Control':'no-store'},body:png});return;}
  if(request.method()!=='POST')return route.fallback();
  const operation=url.pathname.endsWith('/remove')?'remove':'replace',headers=request.headers(),key=headers['idempotency-key'];writes.push({body:request.postDataBuffer(),key,version:headers['if-match'],operation});
  expect(headers['x-csrf-token']).toBeTruthy();expect(key).toBeTruthy();
  if(operation==='remove')expect(request.postDataBuffer()?.length??0).toBe(0);else{expect(headers['content-type']).toBe('image/png');expect(request.postDataBuffer()).toEqual(png);}
  if(!receipts.has(key)){
   const version=Number(headers['if-match'].replaceAll('"',''));expect(version).toBe(event.aggregate_version);event.aggregate_version++;
   const photo={prize_id:prizeId,photo_version:event.aggregate_version,url:`/api/v1/events/${eventId}/prizes/${prizeId}/photo?v=${event.aggregate_version}`};event.prize_photos=operation==='replace'?[photo]:[];
   receipts.set(key,{acknowledged:true,event_id:eventId,prize_id:prizeId,organizer_ref:owner,command_key:key,operation,completed_version:event.aggregate_version,photo:operation==='replace'?photo:null});
  }
  if(lostFirst&&writes.length===1){await route.abort('connectionfailed');return;}
  await route.fulfill({json:receipts.get(key)});
 });
 return {event,writes,imageReads,setImageFailure:(value:boolean)=>{failImage=value;},setAvailability:(value:boolean)=>{uploadAvailable=value;}};
}
for(const width of [320,390,1440])for(const theme of ['light','dark','versefolk'])test(`prize photo native selection, explicit saves, cancel and fallback ${width}px ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});await page.addInitScript(theme=>{localStorage.setItem('freedom-theme',theme);localStorage.setItem('freedom-seasonal-theme','off');},theme);
 const owner=await login(page),state=await routes(page,owner,true);
 try{
  await page.goto('/#events');await page.getByRole('button',{name:'管理 合成獎品 的照片',exact:true}).click();
  const editor=page.getByRole('region',{name:'合成獎品 的照片設定',exact:true}),input=editor.getByLabel('選擇獎品照片');
  await expect(editor.getByRole('heading',{name:'合成獎品 的照片',exact:true})).toBeFocused();await expect(input).toBeEnabled();await input.setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});await expect(editor.getByText('尚未儲存的預覽',{exact:false})).toBeVisible();expect(state.writes).toHaveLength(0);
  await expect(input).toHaveCSS('font-size','16px');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const button of await editor.getByRole('button').all()){if(await button.isVisible())expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);}
  const manage=page.getByRole('button',{name:'管理 合成獎品 的照片',exact:true});await expect(manage).toBeDisabled();
  page.once('dialog',dialog=>dialog.accept());await editor.getByRole('button',{name:'返回活動',exact:true}).click();await expect(editor).toHaveCount(0);await expect(manage).toBeEnabled();await expect(manage).toBeFocused();expect(state.writes).toHaveLength(0);
  await manage.click();await expect(input).toBeEnabled();await input.setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});
  await editor.getByRole('button',{name:'取消這張預覽',exact:true}).click();expect(state.writes).toHaveLength(0);await expect(input).toBeFocused();
  await expect(input).toBeEnabled();await input.setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});await editor.getByRole('button',{name:'儲存照片',exact:true}).click();await expect(editor.getByRole('button',{name:'確認原照片操作',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'取消活動',exact:true})).toBeDisabled();
  await editor.getByRole('button',{name:'重新讀取目前照片',exact:true}).click();await expect(editor.getByRole('button',{name:'確認原照片操作',exact:true})).toBeEnabled();expect(state.writes).toHaveLength(1);
  await editor.getByRole('button',{name:'確認原照片操作',exact:true}).click();await expect(editor.getByText('已保存的照片',{exact:true})).toBeVisible();expect(state.writes).toHaveLength(2);expect(state.writes[1]).toEqual(state.writes[0]);
  const remove=editor.getByRole('button',{name:'移除已保存照片',exact:true});await remove.click();await expect(remove).toBeDisabled();await page.keyboard.press('Escape');await expect(remove).toBeEnabled();await expect(remove).toBeFocused();expect(state.writes).toHaveLength(2);
  state.setImageFailure(true);
  const oldPhoto=state.event.prize_photos![0],nextVersion=++state.event.aggregate_version;
  const nextPhoto={...oldPhoto,photo_version:nextVersion,url:`/api/v1/events/${state.event.event_id}/prizes/${oldPhoto.prize_id}/photo?v=${nextVersion}`};
  state.event.prize_photos=[nextPhoto];
  await editor.getByRole('button',{name:'重新讀取目前照片',exact:true}).click();await expect(editor.getByRole('button',{name:'重試載入照片',exact:true})).toBeVisible();expect(state.imageReads).toContain(nextPhoto.url);state.setImageFailure(false);await editor.getByRole('button',{name:'重試載入照片',exact:true}).click();await expect(editor.getByRole('img',{name:'合成獎品 的獎品照片',exact:true})).toHaveJSProperty('naturalWidth',1);
  await remove.click();await expect(remove).toBeDisabled();await editor.getByRole('button',{name:'返回，不移除',exact:true}).click();await expect(remove).toBeEnabled();await expect(remove).toBeFocused();expect(state.writes).toHaveLength(2);await remove.click();await editor.getByRole('button',{name:'確定移除照片',exact:true}).click();await expect(editor.getByText(/目前沒有已保存照片/)).toBeVisible();expect(state.writes.at(-1)?.operation).toBe('remove');
  await info.attach(`prize-photo-${width}-${theme}`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
 }finally{await page.unrouteAll({behavior:'wait'});}
});
test('default OFF native management prevents selection but retains explicit remove without any upload',async({page})=>{
 const owner=await login(page),state=await routes(page,owner);state.setAvailability(false);
 const prize=state.event.prize_details![0];state.event.aggregate_version=4;state.event.prize_photos=[{prize_id:prize.prize_id,photo_version:4,url:`/api/v1/events/${state.event.event_id}/prizes/${prize.prize_id}/photo?v=4`}];
 try{
  await page.goto('/#events');await page.getByRole('button',{name:'管理 合成獎品 的照片',exact:true}).click();const editor=page.getByRole('region',{name:'合成獎品 的照片設定',exact:true});await expect(editor.getByText(/照片上傳尚未開放或暫時無法使用/)).toBeVisible();await expect(editor.getByLabel('選擇獎品照片')).toBeDisabled();expect(state.writes).toHaveLength(0);
  await editor.getByRole('button',{name:'移除已保存照片',exact:true}).click();await editor.getByRole('button',{name:'返回，不移除',exact:true}).click();expect(state.writes).toHaveLength(0);
  await editor.getByRole('button',{name:'移除已保存照片',exact:true}).click();await editor.getByRole('button',{name:'確定移除照片',exact:true}).click();await expect(editor.getByText(/目前沒有已保存照片/)).toBeVisible();expect(state.writes).toHaveLength(1);expect(state.writes[0].operation).toBe('remove');
  state.setAvailability(true);await editor.getByRole('button',{name:'重新確認照片上傳狀態',exact:true}).click();await expect(editor.getByLabel('選擇獎品照片')).toBeEnabled();expect(state.writes).toHaveLength(1);
 }finally{await page.unrouteAll({behavior:'wait'});}
});
test('anonymous native page reads only its exact public version and retries image failure without upload controls',async({page})=>{
 const eventId=randomUUID(),prizeId=randomUUID(),path=`/api/v1/public/events/${eventId}/prizes/${prizeId}/photo?v=4`;
 const event={event_id:eventId,title:'合成公開獎品活動',description:'唯讀獎品說明',starts_at:'2099-01-01T12:00:00Z',ends_at:'2099-01-01T13:00:00Z',mode:'online',location:'合成教室',online_url:null,event_kind:'other',topic:null,visibility:'open',registration_policy:'community_member',capacity:null,attending_count:0,organizer_name:'合成主辦者',banner_url:null,video_url:null,video_mime:null,prize_details:[{prize_id:prizeId,name:'公開合成獎品',description:'示意測試',quantity:1,completion_rule:'依公開條件確認',claim_note:'現場領取',icon_id:'gift'}],prize_photos:[{prize_id:prizeId,photo_version:4,url:path}]};let fail=true;const writes:string[]=[];
 await page.route(`**/api/v1/public/events/${eventId}`,route=>route.fulfill({json:event}));
 await page.route(`**${path}`,async route=>{expect(route.request().method()).toBe('GET');if(fail)await route.fulfill({status:503,body:'Unavailable'});else await route.fulfill({contentType:'image/png',headers:{'Cache-Control':'no-store'},body:png});});
 page.on('request',request=>{if(new URL(request.url()).pathname.includes(eventAppPath(`/events/${eventId}`))&&request.method()!=='GET')writes.push(request.url());});
 try{await page.goto(eventAppPath(`/events/${eventId}`));await expect(page.getByRole('heading',{name:event.title,exact:true})).toBeVisible();await expect(page.getByText(/照片暫時無法載入/)).toBeVisible();expect(await page.locator('.event-prize-heading svg').count()).toBe(1);await expect(page.getByRole('button',{name:/管理 .* 的照片/})).toHaveCount(0);fail=false;await page.getByRole('button',{name:'重試載入照片',exact:true}).click();await expect(page.getByRole('img',{name:'公開合成獎品 的獎品照片',exact:true})).toHaveJSProperty('naturalWidth',1);expect(writes).toEqual([]);}
 finally{await page.unrouteAll({behavior:'wait'});}
});
