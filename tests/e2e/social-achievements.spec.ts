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
