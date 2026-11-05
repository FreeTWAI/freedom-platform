import {test,expect,type Page,type Route} from './fixtures.js';

// These are simulated lifecycle events on the actual launcher. They do not claim
// real tab suspension, bfcache restoration, OS resume or Safari device coverage.
const countPath=/\/api\/v1\/me\/(?:conversations\?limit=1&offset=0|channels\?kind=(?:guild|squad|world)&limit=1&offset=0)$/;
const payload=(count:number)=>({items:[],unread_count:count,next_offset:null});
const frameBarrier=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
async function login(page:Page){
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.getByRole('button',{name:'設定',exact:true})).toBeVisible();
}
async function simulatedVisibility(page:Page,state:'hidden'|'visible'){
  await page.evaluate(value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'));},state);
}
function watchSideEffects(page:Page){
  const unexpected:string[]=[];
  page.on('request',request=>{const path=new URL(request.url()).pathname;
    if(!/^\/api\/v1\/me\/(conversations|channels|inbox|notifications)(?:\/|$)/.test(path))return;
    if(request.method()!=='GET'||/\/(messages|activity|receipts)$/.test(path))unexpected.push(`${request.method()} ${path}`);
  });
  return unexpected;
}

for(const resume of ['visibility-only','pageshow'] as const)test(`simulated ${resume} restore refreshes the floating badge without focus or opening history`,async({page},info)=>{
  let count=1,reads=0;
  const unexpected=watchSideEffects(page);
  await page.route(countPath,async route=>{reads++;await route.fulfill({json:payload(count)});});
  await login(page);const launcher=page.locator('.floating-messages');
  await expect(launcher).toHaveAccessibleName('開啟聊天室，4 則未讀');await frameBarrier(page);
  const before=reads;count=2;
  if(resume==='visibility-only'){await simulatedVisibility(page,'hidden');await simulatedVisibility(page,'visible');}
  else await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('pageshow'));});
  await expect(launcher).toHaveAccessibleName('開啟聊天室，8 則未讀');await frameBarrier(page);
  expect(reads-before).toBe(4);expect(unexpected).toEqual([]);await expect(page.locator('.floating-message-panel')).toBeHidden();
  await info.attach('simulated-resume-read-count',{body:JSON.stringify({simulation:resume,focus_dispatched:false,count_requests:reads-before,unexpected,real_bfcache_test:false}),contentType:'application/json'});
});

test('simulated hide/resume bypasses a held old snapshot and rejects its late count',async({page},info)=>{
  let reads=0,hold=false,count=1;
  const waiting:Route[]=[],unexpected=watchSideEffects(page);
  await page.route(countPath,async route=>{reads++;if(hold){waiting.push(route);return;}await route.fulfill({json:payload(count)});});
  await login(page);const launcher=page.locator('.floating-messages');await expect(launcher).toHaveAccessibleName('開啟聊天室，4 則未讀');
  hold=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>waiting.length).toBe(4);
  const before=reads;count=2;
  try{
    await simulatedVisibility(page,'hidden');
    await page.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));
    });
    await expect.poll(()=>waiting.length).toBe(8);
    // A later event task must share the new epoch, not subscribe to the old held read.
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await frameBarrier(page);expect(reads-before).toBe(4);
    hold=false;for(const route of waiting.splice(4))await route.fulfill({json:payload(2)});
    await expect(launcher).toHaveAccessibleName('開啟聊天室，8 則未讀');
    for(const route of waiting.splice(0))await route.fulfill({json:payload(9)});
    await frameBarrier(page);await expect(launcher).toHaveAccessibleName('開啟聊天室，8 則未讀');expect(unexpected).toEqual([]);
    await info.attach('simulated-late-snapshot',{body:JSON.stringify({simulation:'visibility/pageshow event burst',fresh_requests:reads-before,stale_total_rejected:36,confirmed_total:8,unexpected}),contentType:'application/json'});
  }finally{hold=false;for(const route of waiting)await route.fulfill({json:payload(9)}).catch(()=>{});}
});
