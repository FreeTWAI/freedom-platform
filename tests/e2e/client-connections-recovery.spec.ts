import { navigate, openAccountSettings } from './navigation.js';
import {test,expect,type Page} from './fixtures.js';

// Synthetic route fixtures only: they prove loading, error and recovery display, not a real client or member.
const active={connection_id:'30000000-0000-4000-8000-0000000000c1',kind:'supplier',client_name:'合成供應端客戶端',store_id:null,scope:'supplier:read',expires_at:'2099-01-01T00:00:00Z',revoked_at:null as string|null,created_at:'2026-09-24T00:00:00Z',aggregate_version:1};
const problem=(status:number,title:string,detail:string)=>({status,contentType:'application/problem+json',body:JSON.stringify({type:'about:blank',title,status,detail})});

async function openConnections(page:Page){
  await page.goto('/');await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await navigate(page, '工具連線');
  const heading=page.getByRole('heading',{name:'連接我的客戶端（讀取）',exact:true});
  await expect(heading).toBeVisible();
  return heading.locator('xpath=ancestor::section[1]');
}

test('pairing destination opens connections and the old account address still opens settings',async({page})=>{
  await page.route('**/api/v1/me/client-connections',route=>route.fulfill({json:{items:[]}}));
  const section=await openConnections(page);await expect(page).toHaveURL(/#automation\/connections$/);await expect(section).toBeVisible();
  await page.goto('/#account');await expect(page).toHaveURL(/#me\/settings$/);await expect(page.getByLabel('我的檢視')).toHaveValue('#me/settings');
});

test('client connection list separates loading, load failure and retry from a failed code lookup',async({page})=>{
  let lists=0,releaseFirst=()=>{};const firstHeld=new Promise<void>(resolve=>{releaseFirst=resolve;});
  await page.route('**/api/v1/me/client-connections',async route=>{
    lists++;
    if(lists===1){await firstHeld;return route.fulfill(problem(503,'Service Unavailable','upstream'));}
    return route.fulfill({json:{items:[active]}});
  });
  await page.route('**/api/v1/client-connections/*',route=>{
    const code=decodeURIComponent(route.request().url().split('/').at(-1)!);
    if(code==='GOOD-CODE')return route.fulfill({json:{user_code:code,kind:'supplier',client_name:'合成待核准客戶端',scope:'supplier:read',expires_at:'2099-01-01T00:00:00Z',state:'pending'}});
    return route.fulfill(problem(404,'找不到連線代碼','這組代碼不存在或已過期。'));
  });
  const section=await openConnections(page);
  const empty=section.getByText('目前沒有客戶端連線。',{exact:true});

  // While the first list request is held, the member sees loading, never an empty list.
  await expect(section.getByRole('status').filter({hasText:'正在載入讀取連線…'})).toBeVisible();
  await expect(empty).toHaveCount(0);
  releaseFirst();
  await expect(section.getByRole('alert')).toContainText('服務暫時無法回應（503）');
  await expect(empty).toHaveCount(0);

  await section.getByRole('button',{name:'重新載入讀取連線',exact:true}).click();
  const row=section.locator('.connection-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('合成供應端客戶端');await expect(row).toContainText('供應端 · 已授權讀取');
  await expect(section.getByRole('alert')).toHaveCount(0);
  await expect(section.getByRole('button',{name:'重新載入讀取連線',exact:true})).toHaveCount(0);
  expect(lists).toBe(2);

  // A valid preview is cleared when another code is looked up, and a bad code leaves the list intact.
  const input=section.getByLabel('客戶端一次性代碼',{exact:true});
  await input.fill('GOOD-CODE');await section.getByRole('button',{name:'查看連線請求',exact:true}).click();
  await expect(section.getByText('合成待核准客戶端',{exact:true})).toBeVisible();
  await input.fill('WRONG-CODE');await input.press('Enter');
  await expect(section.getByRole('alert')).toContainText('這組代碼不存在或已過期。');
  await expect(section.getByRole('button',{name:'確認並允許這次讀取連線',exact:true})).toHaveCount(0);
  await expect(section.getByText('合成待核准客戶端',{exact:true})).toHaveCount(0);
  await expect(row).toHaveCount(1);await expect(row).toContainText('已授權讀取');
  await expect(empty).toHaveCount(0);
  await expect(section.getByRole('button',{name:'重新載入讀取連線',exact:true})).toHaveCount(0);
  expect(lists).toBe(2);
});

test('revoking an existing client connection sends its version and reloads the revoked state',async({page})=>{
  const connection={...active};let revokes=0;
  await page.route('**/api/v1/me/client-connections',route=>route.fulfill({json:{items:[connection]}}));
  await page.route('**/api/v1/me/client-connections/*/revoke',route=>{
    const request=route.request();expect(request.method()).toBe('POST');
    expect(request.headers()['x-csrf-token']).toBeTruthy();expect(request.headers()['if-match']).toContain('1');
    revokes++;Object.assign(connection,{revoked_at:'2026-09-24T01:00:00Z',aggregate_version:2});
    return route.fulfill({json:connection});
  });
  const section=await openConnections(page);
  const row=section.locator('.connection-row');
  await expect(row).toContainText('供應端 · 已授權讀取');
  await row.getByRole('button',{name:'撤銷連線',exact:true}).click();
  await expect(section.getByRole('status').filter({hasText:'讀取連線已撤銷。'})).toBeVisible();
  await expect(row).toContainText('供應端 · 已撤銷');
  await expect(row.getByRole('button',{name:'撤銷連線',exact:true})).toHaveCount(0);
  await expect(section.getByText('目前沒有客戶端連線。',{exact:true})).toHaveCount(0);
  expect(revokes).toBe(1);
});

test('a storefront code keeps its preview while creating and selecting the first store',async({page})=>{
 const code=crypto.randomUUID(),store={store_id:crypto.randomUUID(),name:'合成預覽商店',description:'合成介紹',support_contact:'合成聯絡方式'};
 let created=false,lookups=0,reads=0;const writes:unknown[]=[];
 await page.route('**/api/v1/me/client-connections',r=>r.fulfill({json:{items:[]}}));
 await page.route(`**/api/v1/client-connections/${code}`,r=>{lookups++;return r.fulfill({json:{user_code:code,kind:'storefront',client_name:'合成商店客戶端',scope:'storefront:read',expires_at:'2099-01-01T00:00:00Z',state:'pending'}});});
 await page.route('**/api/v1/retail/stores',r=>{
  if(r.request().method()==='GET'){reads++;return r.fulfill({json:{items:created?[store]:[]}});}
  expect(r.request().method()).toBe('POST');expect(r.request().headers()['x-csrf-token']).toBeTruthy();expect(r.request().headers()['idempotency-key']).toBeTruthy();writes.push(r.request().postDataJSON());created=true;return r.fulfill({status:201,json:store});
 });
 const section=await openConnections(page);await section.getByLabel('客戶端一次性代碼',{exact:true}).fill(code);await section.getByRole('button',{name:'查看連線請求',exact:true}).click();
 const form=section.getByRole('form',{name:'建立自己的商店'});await expect(form).toBeVisible();
 await form.getByLabel('商店名稱',{exact:true}).fill(store.name);await form.getByLabel('商店介紹',{exact:true}).fill(store.description);await form.getByLabel('客服聯絡方式',{exact:true}).fill(store.support_contact);
 await form.getByRole('button',{name:'建立預覽商店',exact:true}).click();
 await expect(section.getByRole('combobox',{name:'允許讀取哪一家商店',exact:true})).toHaveValue(store.store_id);await expect(section.getByLabel('客戶端一次性代碼',{exact:true})).toHaveValue(code);await expect(section.getByText('合成商店客戶端',{exact:true})).toBeVisible();
 await expect(section.getByRole('button',{name:'確認並允許這次讀取連線',exact:true})).toBeEnabled();expect(lookups).toBe(1);expect(reads).toBe(2);expect(writes).toEqual([{name:store.name,description:store.description,support_contact:store.support_contact}]);
});

test('a late store creation cannot select a store for a replacement code preview',async({page})=>{
 const first=crypto.randomUUID(),second=crypto.randomUUID();let reads=0,writes=0,release=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/v1/me/client-connections',r=>r.fulfill({json:{items:[]}}));
 await page.route('**/api/v1/client-connections/*',r=>{const code=r.request().url().split('/').at(-1);return r.fulfill({json:{user_code:code,kind:code===first?'storefront':'supplier',client_name:code===first?'合成商店客戶端':'合成替代客戶端',scope:'read',expires_at:'2099-01-01T00:00:00Z',state:'pending'}});});
 await page.route('**/api/v1/retail/stores',async r=>{if(r.request().method()==='GET'){reads++;return r.fulfill({json:{items:[]}});}writes++;await held;await r.fulfill({status:201,json:{store_id:crypto.randomUUID(),name:'合成商店'}});});
 const section=await openConnections(page),code=section.getByLabel('客戶端一次性代碼',{exact:true});await code.fill(first);await section.getByRole('button',{name:'查看連線請求',exact:true}).click();
 const form=section.getByRole('form',{name:'建立自己的商店'});await form.getByLabel('商店名稱',{exact:true}).fill('合成商店');await form.getByLabel('商店介紹',{exact:true}).fill('合成介紹');await form.getByLabel('客服聯絡方式',{exact:true}).fill('合成聯絡方式');await form.getByRole('button',{name:'建立預覽商店',exact:true}).click();
 const saved=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/retail/stores'));
 try{await expect.poll(()=>writes).toBe(1);await code.fill(second);await section.getByRole('button',{name:'查看連線請求',exact:true}).click();await expect(section.getByText('合成替代客戶端',{exact:true})).toBeVisible();}finally{release();}
 await (await saved).finished();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await expect(section.getByRole('combobox',{name:'允許讀取哪一家商店',exact:true})).toHaveCount(0);await expect(code).toHaveValue(second);await expect(section.getByRole('button',{name:'確認並允許這次讀取連線',exact:true})).toBeEnabled();expect(reads).toBe(1);
});
