import {test,expect} from './fixtures.js';
import {DEMO_PASSWORD} from '../../packages/testing/seed.js';
const state={policy_version:'social_days_v1',counting_enabled:false,show_title:false,selected_title:null,aggregate_version:null,status:'active',moderation_reason:null,appeal_state:'none',can_moderate:false,chat:{days:0,next_days:1,remaining:1},participation:{days:0,next_days:1,remaining:1},titles:[{title_id:'chat_1',label:'話題接上了',days:1,track:'chat',unlocked:false}]};
async function open(page:import('@playwright/test').Page){await page.route('**/api/v1/site',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),social_achievements_enabled:true}});});await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill(DEMO_PASSWORD);await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('heading',{name:'會員首頁',level:1})).toBeVisible();await page.goto('/#account?view=recognition');}
test('explicit defaults, keyboard consent and title selector do not invent progress',async({page})=>{
 let saved={...state};await page.route('**/api/v1/me/social-achievements',async route=>{if(route.request().method()==='POST')saved={...saved,...route.request().postDataJSON(),aggregate_version:'1'};await route.fulfill({json:saved});});await open(page);
 const panel=page.getByRole('region',{name:'我的社群稱號'});await expect(panel.getByRole('heading',{name:'我的社群稱號'})).toBeVisible();const consent=panel.getByLabel(/我已閱讀計入/);await expect(consent).not.toBeChecked();await expect(panel.getByLabel(/在已允許同社群/)).not.toBeChecked();await consent.focus();await page.keyboard.press('Space');await panel.getByRole('button',{name:'保存選擇'}).click();await expect(panel.getByRole('status')).toContainText('已保存');await expect(panel.getByText('尚未解鎖 · 話題接上了（1 日）')).toBeVisible();
 for(const theme of ['light','dark','versefolk']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width:320,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
});
test('unknown write retries exact key/body and freezes edits, then current response wins',async({page})=>{
 const calls:{key:string|null;body:unknown}[]=[];await page.route('**/api/v1/me/social-achievements',async route=>{if(route.request().method()==='GET'){await route.fulfill({json:state});return;}calls.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});if(calls.length===1)await route.abort();else await route.fulfill({json:{...state,counting_enabled:true,aggregate_version:'1'}});});await open(page);const panel=page.getByRole('region',{name:'我的社群稱號'});await panel.getByLabel(/我已閱讀計入/).check();await panel.getByRole('button',{name:'保存選擇'}).click();await expect(panel.getByRole('button',{name:'重試原操作'})).toBeVisible();await expect(panel.getByLabel(/我已閱讀計入/)).toBeDisabled();await panel.getByRole('button',{name:'重試原操作'}).click();await expect(panel.getByRole('status')).toContainText('已保存');expect(calls.length).toBe(2);expect(calls[0]).toEqual(calls[1]);
});

test('unknown then generic rejection or malformed success keeps the original command',async({page})=>{
 const calls:{key:string|null;body:unknown}[]=[];
 await page.route('**/api/v1/me/social-achievements',async route=>{
  if(route.request().method()==='GET'){await route.fulfill({json:state});return;}
  calls.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});
  if(calls.length===1)await route.abort();
  else if(calls.length===2)await route.fulfill({status:403,json:{error:{code:'forbidden',message:'Denied'}}});
  else if(calls.length===3)await route.fulfill({json:{}});
  else await route.fulfill({json:{...state,counting_enabled:true,aggregate_version:'1'}});
 });
 await open(page);const panel=page.getByRole('region',{name:'我的社群稱號'});
 await panel.getByLabel(/我已閱讀計入/).check();await panel.getByRole('button',{name:'保存選擇'}).click();
 for(let i=0;i<3;i++){
  const retry=panel.getByRole('button',{name:'重試原操作'});await expect(retry).toBeVisible();await expect(retry).toBeEnabled();
  await expect(panel.getByRole('button',{name:'重新讀取進度'})).toBeDisabled();await retry.click();
 }
 await expect(panel.getByRole('status')).toContainText('已保存');expect(calls).toHaveLength(4);
 for(const call of calls)expect(call).toEqual(calls[0]);
});

// Runs the real PlatformClient + owner panel against malformed HTTP responses.
// These hosted-browser regressions are authored, not locally executed.
for(const status of [412,422])for(const malformed of ['<html>proxy error</html>','', '{}','[]',JSON.stringify({type:'about:blank',title:'Mismatch',status:409})]){
 test(`first malformed ${status} (${malformed||'empty'}) preserves exact command`,async({page})=>{
  const calls:{key:string|null;body:unknown}[]=[];
  await page.route('**/api/v1/me/social-achievements',async route=>{
   if(route.request().method()==='GET'){await route.fulfill({json:state});return;}
   calls.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});
   if(calls.length===1)await route.fulfill({status,contentType:malformed.startsWith('<')?'text/html':'application/json',body:malformed});
   else await route.fulfill({json:{...state,counting_enabled:true,aggregate_version:'1'}});
  });
  await open(page);const panel=page.getByRole('region',{name:'我的社群稱號'});
  await panel.getByLabel(/我已閱讀計入/).check();await panel.getByRole('button',{name:'保存選擇'}).click();
  const retry=panel.getByRole('button',{name:'重試原操作'});await expect(retry).toBeVisible();
  await expect(panel.getByLabel(/我已閱讀計入/)).toBeDisabled();await expect(panel.getByRole('button',{name:'重新讀取進度'})).toBeDisabled();
  await retry.click();await expect(panel.getByRole('status')).toContainText('已保存');expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);
 });
}

// Exercise the canonical numeric HTTP response, not only legacy string fixtures.
// Browser execution still requires the ordinary isolated E2E environment.
for(const action of ['first save','update','erase','appeal'] as const){
 test(`numeric wire versions confirm ${action} without a false unknown result`,async({page})=>{
  const initial=action==='first save'?null:4;
  let saved={...state,aggregate_version:initial,status:action==='appeal'?'paused':'active',moderation_reason:action==='appeal'?'Synthetic review':null};
  const calls:{path:string;key:string|null;version:string|null;body:unknown}[]=[];
  await page.route(/\/api\/v1\/me\/social-achievements(?:\/(?:erase|appeal))?$/,async route=>{
   const request=route.request();
   if(request.method()==='POST'){
    calls.push({path:new URL(request.url()).pathname,key:request.headers()['idempotency-key']??null,version:request.headers()['if-match']??null,body:request.postDataJSON()});
    saved={...saved,aggregate_version:(initial??0)+1,appeal_state:action==='appeal'?'pending':'none',counting_enabled:action==='erase'?false:true};
   }
   await route.fulfill({json:saved});
  });
  await open(page);const panel=page.getByRole('region',{name:'我的社群稱號'});
  await expect(panel.getByRole('button',{name:'保存選擇',exact:true})).toBeEnabled();
  if(action==='erase'){
   await panel.getByText('清除我的進度與稱號',{exact:true}).click();
   await panel.getByLabel(/我了解無法復原/).check();
   await panel.getByRole('button',{name:'清除並退出',exact:true}).click();
  }else if(action==='appeal'){
   await panel.getByRole('textbox',{name:'說明',exact:true}).fill('Synthetic appeal');
   await panel.getByRole('button',{name:'送出申訴',exact:true}).click();
  }else{
   await panel.getByLabel(/我已閱讀計入/).check();
   await panel.getByRole('button',{name:'保存選擇',exact:true}).click();
  }
  await expect(panel.getByText('已保存。進度以伺服器實際成立的合格日為準。',{exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'重試原操作',exact:true})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'重新讀取進度',exact:true})).toBeEnabled();
  expect(calls).toHaveLength(1);expect(calls[0].key).toBeTruthy();expect(calls[0].version).toBe(initial===null?null:'"4"');
  expect(calls[0].path).toBe('/api/v1/me/social-achievements'+(action==='erase'?'/erase':action==='appeal'?'/appeal':''));
  if(action==='erase')expect(calls[0].body).toEqual({confirm:true});
  else if(action==='appeal')expect(calls[0].body).toEqual({reason:'Synthetic appeal'});
  else expect(calls[0].body).toEqual({policy_version:'social_days_v1',counting_enabled:true,show_title:false,selected_title:null});
 });
}

test('maximum safe numeric version can be read without losing its If-Match value',async({page})=>{
 let captured:string|undefined;
 await page.route('**/api/v1/me/social-achievements',async route=>{
  if(route.request().method()==='POST')captured=route.request().headers()['if-match'];
  await route.fulfill({json:{...state,aggregate_version:Number.MAX_SAFE_INTEGER}});
 });
 await open(page);const panel=page.getByRole('region',{name:'我的社群稱號'});
 await panel.getByRole('button',{name:'保存選擇',exact:true}).click();
 await expect(panel.getByText('已保存。進度以伺服器實際成立的合格日為準。',{exact:true})).toBeVisible();
 expect(captured).toBe('"9007199254740991"');
});

test('unsafe numeric success after an unknown write retains the exact original command',async({page})=>{
 const calls:{key:string|undefined;version:string|undefined;body:unknown}[]=[];let reads=0;
 await page.route('**/api/v1/me/social-achievements',async route=>{
  const request=route.request();
  if(request.method()==='GET'){reads++;await route.fulfill({json:{...state,aggregate_version:4}});return;}
  calls.push({key:request.headers()['idempotency-key'],version:request.headers()['if-match'],body:request.postDataJSON()});
  if(calls.length===1)await route.abort();
  else await route.fulfill({json:{...state,counting_enabled:true,aggregate_version:calls.length===2?Number.MAX_SAFE_INTEGER+1:5}});
 });
 await open(page);const panel=page.getByRole('region',{name:'我的社群稱號'});
 await panel.getByLabel(/我已閱讀計入/).check();await panel.getByRole('button',{name:'保存選擇',exact:true}).click();
 for(let i=0;i<2;i++){
  const retry=panel.getByRole('button',{name:'重試原操作',exact:true});await expect(retry).toBeVisible();await expect(retry).toBeEnabled();
  await expect(panel.getByLabel(/我已閱讀計入/)).toBeDisabled();await expect(panel.getByRole('button',{name:'重新讀取進度',exact:true})).toBeDisabled();
  await retry.click();
 }
 await expect(panel.getByText('已保存。進度以伺服器實際成立的合格日為準。',{exact:true})).toBeVisible();
 expect(calls).toHaveLength(3);expect(reads).toBe(1);expect(calls[0].version).toBe('"4"');expect(calls[0].key).toBeTruthy();
 for(const call of calls)expect(call).toEqual(calls[0]);
});
