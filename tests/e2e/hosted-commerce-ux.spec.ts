import {test,expect} from './fixtures.js';
import {person,login,launchStore,post,open,storeArea} from './hosted-store-fixture.js';
import {randomUUID} from 'node:crypto';

test('one-click listing publishes all saved products from the product area and blocks unsaved drafts',async({page,e2eAuthPool},info)=>{
  const member=await person(e2eAuthPool);await login(page,member.email);
  const store=await launchStore(page,'Synthetic one-click listing'),slug='listing-'+member.id.slice(0,8);
  await post(page,store.root+'/setup',{name:'一起開店',slug,currency:'TWD'},201);
  await post(page,store.root+'/products',{title:'陶瓷茶杯',description:'手工製作',price_minor:35000,stock:10},201);
  await post(page,store.root+'/products',{title:'手作購物袋',price_minor:20000,stock:5},201);
  await open(page,store.hash);
  const listing=page.locator('.hosted-store-publication'),publish=listing.getByRole('button',{name:'一鍵上架商品',exact:true});
  await expect(publish).toBeEnabled();
  await expect(listing).toContainText('本次會公開全部 2 件商品、0 張已儲存照片，以及店面更新。');
  const form=page.getByRole('form',{name:'新增商品',exact:true});
  await form.getByLabel('商品名稱',{exact:true}).fill('尚未儲存的商品');await expect(publish).toBeDisabled();
  await form.getByLabel('商品名稱',{exact:true}).fill('');await expect(publish).toBeEnabled();
  await listing.getByText('查看本次上架內容',{exact:true}).click();
  await expect(listing).toContainText('陶瓷茶杯');await expect(listing).toContainText('手作購物袋');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('one-click-listing-mobile.png'),fullPage:true});
  await publish.click();await expect(listing.getByRole('button',{name:'商品已全部上架',exact:true})).toBeDisabled();
  const response=await page.request.get('/api/v1/public/stores/'+slug);expect(response.status()).toBe(200);
  const published=await response.json();expect(published.products.map((item:{title:string})=>item.title)).toEqual(['陶瓷茶杯','手作購物袋']);
  await expect(page.getByRole('navigation',{name:'商店工作區'}).getByRole('button',{name:'商品',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('a changed product requires a new visible review and another click before publication',async({page,e2eAuthPool})=>{
  const member=await person(e2eAuthPool);await login(page,member.email);
  const store=await launchStore(page,'Synthetic reviewed listing'),slug='review-'+member.id.slice(0,8);
  await post(page,store.root+'/setup',{name:'確認更新的店',slug,currency:'TWD'},201);
  const product=await post(page,store.root+'/products',{title:'原商品名稱',price_minor:35000,stock:10},201);
  await open(page,store.hash);
  const listing=page.locator('.hosted-store-publication'),publish=listing.getByRole('button',{name:'一鍵上架商品',exact:true});
  await expect(publish).toBeEnabled();
  const session=await (await page.request.get('/api/v1/session')).json();
  const changed=await page.request.patch(`/api/v1${store.root}/products/${product.product_id}`,{data:{title:'另一位管理員更新的名稱',price_minor:38000},headers:{Origin:new URL(page.url()).origin,'X-CSRF-Token':session.csrf_token,'Idempotency-Key':randomUUID(),'If-Match':`"${product.version}"`}});
  expect(changed.status()).toBe(200);
  await publish.click();await expect(page.locator('.hosted-store > [role="status"]')).toContainText('請確認後再按一次上架');
  expect((await page.request.get('/api/v1/public/stores/'+slug)).status()).toBe(404);
  await expect(publish).toBeEnabled();await listing.getByText('查看本次上架內容',{exact:true}).click();
  await expect(listing).toContainText('另一位管理員更新的名稱');
  await publish.click();await expect(listing.getByRole('button',{name:'商品已全部上架',exact:true})).toBeVisible();
  const published=await (await page.request.get('/api/v1/public/stores/'+slug)).json();expect(published.products[0].title).toBe('另一位管理員更新的名稱');
});

test('an unknown listing response keeps its original request and publishes only one revision',async({page,e2eAuthPool})=>{
  const member=await person(e2eAuthPool);await login(page,member.email);
  const store=await launchStore(page,'Synthetic listing recovery');
  await post(page,store.root+'/setup',{name:'上架恢復店',slug:'recovery-'+member.id.slice(0,8),currency:'TWD'},201);
  await post(page,store.root+'/products',{title:'可恢復上架商品',price_minor:35000,stock:10},201);
  const attempts:Array<{key:string;version:string;body:string|null}>=[];
  await page.route(`**/api/v1${store.root}/publish-reviewed`,async route=>{
    const request=route.request(),headers=request.headers();attempts.push({key:headers['idempotency-key'],version:headers['if-match'],body:request.postData()});
    const response=await route.fetch();expect(response.status()).toBe(200);
    if(attempts.length===1)await route.abort('failed');else await route.fulfill({response});
  });
  await open(page,store.hash);await page.getByRole('button',{name:'一鍵上架商品',exact:true}).click();
  const retry=page.locator('.hosted-store > .actions').getByRole('button',{name:'重試',exact:true});
  await expect(retry).toBeVisible();await expect(page.getByRole('button',{name:'一鍵上架商品',exact:true})).toBeDisabled();
  await retry.click();await expect(page.getByRole('button',{name:'商品已全部上架',exact:true})).toBeVisible();
  expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);
  const instance=store.hash.split('/')[2];
  expect((await e2eAuthPool.query('SELECT count(*)::int AS count FROM commerce_storefront_publications WHERE instance_id=$1',[instance])).rows[0].count).toBe(1);
});

test('supplier finds own goods, retains the conditions draft across work areas and publishes directly after save',async({page,e2eAuthPool})=>{
  const member=await person(e2eAuthPool);await login(page,member.email);const store=await launchStore(page,'Synthetic supply UX');
  await post(page,store.root+'/supply-profile',{name:'Synthetic 供貨商品庫',currency:'TWD'},201);
  await post(page,store.root+'/supply-products',{title:'陶瓷茶杯',cost_minor:18000,stock:10},201);
  await post(page,store.root+'/supply-products',{title:'手作購物袋',cost_minor:10000,stock:5},201);
  await open(page,store.hash+'/supply');await page.getByLabel('搜尋商品',{exact:true}).fill('茶杯');
  await expect(page.locator('.hosted-store-product:visible')).toHaveCount(1);await page.getByRole('button',{name:'供貨條件',exact:true}).click();
  const form=page.getByRole('form',{name:'陶瓷茶杯供貨條件',exact:true});
  await form.getByRole('textbox',{name:'出貨條件',exact:true}).fill('確認供貨後三天出貨');await form.getByRole('textbox',{name:'退貨條件',exact:true}).fill('瑕疵可換貨');
  const areas=page.getByRole('navigation',{name:'供貨工作區',exact:true});await areas.getByRole('button',{name:'供貨合作',exact:true}).click();await areas.getByRole('button',{name:'商品',exact:true}).click();
  await expect(form.getByRole('textbox',{name:'出貨條件',exact:true})).toHaveValue('確認供貨後三天出貨');await expect(page.getByLabel('搜尋商品',{exact:true})).toBeDisabled();
  await form.getByRole('button',{name:'儲存供貨條件',exact:true}).click();await expect(form.getByRole('button',{name:'公開供貨版本',exact:true})).toBeEnabled();
  await form.getByRole('button',{name:'公開供貨版本',exact:true}).click();await expect(page.locator('.hosted-supply-catalog > [role="status"]')).toContainText('已公開供貨版本');
  await page.getByRole('button',{name:'清除搜尋',exact:true}).click();await expect(page.locator('.hosted-store-product:visible')).toHaveCount(2);
});

test('retail work areas preserve a draft, prevent another area overwriting it, and remain reachable across themes and widths',async({page,e2eAuthPool})=>{
  const member=await person(e2eAuthPool);await login(page,member.email);const store=await launchStore(page,'Synthetic retail UX');
  await post(page,store.root+'/setup',{name:'Synthetic 選物店',slug:'ux-'+member.id.slice(0,8),currency:'TWD'},201);
  await post(page,store.root+'/products',{title:'陶瓷茶杯',price_minor:35000,stock:10},201);
  await post(page,store.root+'/products',{title:'手作購物袋',price_minor:20000,stock:5},201);
  await open(page,store.hash);await page.getByLabel('搜尋商品',{exact:true}).fill('茶杯');await expect(page.locator('.hosted-store-product:visible')).toHaveCount(1);
  await page.getByRole('button',{name:'清除搜尋',exact:true}).click();await storeArea(page,'商店資料');
  const settings=page.getByRole('form',{name:'商店資料',exact:true});await settings.getByLabel('商店名稱',{exact:true}).fill('我的未儲存店名');
  await storeArea(page,'商品');await expect(page.getByRole('form',{name:'新增商品',exact:true}).getByRole('button',{name:'新增商品',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'回到未儲存的工作區',exact:true}).click();await expect(settings.getByLabel('商店名稱',{exact:true})).toHaveValue('我的未儲存店名');
  await settings.getByRole('button',{name:'儲存商店資料',exact:true}).click();await storeArea(page,'店面與發布');await expect(page.getByRole('button',{name:'發布展示頁',exact:true})).toBeEnabled();
  for(const theme of ['light','dark','versefolk'])for(const width of [320,390,1280]){
    await page.evaluate(theme=>{localStorage.setItem('freedom-theme',theme);dispatchEvent(new StorageEvent('storage',{key:'freedom-theme',newValue:theme}));},theme);await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const button of await page.getByRole('navigation',{name:'商店工作區',exact:true}).getByRole('button').all())expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({path:`.rd/commerce/retail-${theme}-${width}.png`,fullPage:true});
  }
});

test('read-only cooperation stays explicit after an active writer loses permission and after reopening',async({page,browser,baseURL,e2eAuthPool})=>{
  test.setTimeout(90000);
  const owner=await person(e2eAuthPool),operator=await person(e2eAuthPool);
  await login(page,owner.email);const store=await launchStore(page,'Synthetic permission UX');
  await post(page,store.root+'/setup',{name:'Synthetic 權限店面',slug:'permission-'+owner.id.slice(0,8),currency:'TWD'},201);
  const [,tenant,instance]=store.hash.split('/'),context=await browser.newContext({baseURL});
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  let entered!:()=>void;const committed=new Promise<void>(resolve=>entered=resolve);
  try{
    const operatorPage=await context.newPage();await login(operatorPage,operator.email);
    const candidate=await (await page.request.get(`/api/v1/tenants/invite-candidates?user_id=${operator.id}`)).json();
    const invitation=await post(page,`/tenants/${tenant}/invitations`,{
      invitee_principal_id:candidate.principal_id,role:'operator',
      instance_capabilities:[{instance_id:instance,capabilities:['store:read','store:write']}],
      expires_at:new Date(Date.now()+86400000).toISOString(),
    },201);
    await post(operatorPage,`/tenants/${tenant}/invitations/${invitation.invitation_id}/accept`,{},200,invitation.version);
    await open(operatorPage,store.hash);
    await operatorPage.route(`**/api/v1${store.root}/products`,async route=>{
      if(route.request().method()!=='POST')return route.continue();
      const response=await route.fetch();expect(response.status()).toBe(201);entered();await held;await route.fulfill({response});
    });
    const form=operatorPage.getByRole('form',{name:'新增商品',exact:true});
    await form.getByLabel('商品名稱',{exact:true}).fill('已合法儲存的商品');
    await form.getByLabel(/^價格（/).fill('350');
    await form.getByLabel('庫存',{exact:true}).fill('2');
    await form.getByRole('button',{name:'新增商品',exact:true}).click();await committed;
    await storeArea(operatorPage,'供貨合作');
    const members=await (await page.request.get(`/api/v1/tenants/${tenant}/members`)).json();
    const membership=members.items.find((item:{principal_id:string})=>item.principal_id===candidate.principal_id);
    await post(page,`/tenants/${tenant}/members/${candidate.principal_id}/change`,{
      role:'operator',status:'active',instance_capabilities:[{instance_id:instance,capabilities:['store:read']}],reason:'Synthetic review of revoked editing permission',
    },200,membership.version);
    release();
    await expect(operatorPage.getByText('你可以檢視這間商店，但不能修改。',{exact:true})).toBeVisible();
    for(const width of [390,768,1440]){
      await operatorPage.setViewportSize({width,height:900});await operatorPage.screenshot({path:`.rd/commerce-review/read-only-${width}.png`,fullPage:true});
      expect(await operatorPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await expect(operatorPage.locator('#store-cooperation-panel')).toContainText('你沒有供貨合作的管理權限');
    await expect(operatorPage.locator('#store-cooperation-panel .hosted-distribution')).toHaveCount(0);
    await expect(operatorPage.getByRole('link',{name:'預留訂單',exact:true})).toHaveCount(0);
    await expect(operatorPage.getByRole('link',{name:'供貨訂單',exact:true})).toHaveCount(0);
    await storeArea(operatorPage,'商品');await expect(operatorPage.getByRole('heading',{name:'已合法儲存的商品',exact:true})).toBeVisible();
    await operatorPage.reload();await storeArea(operatorPage,'供貨合作');
    await expect(operatorPage.locator('#store-cooperation-panel')).toContainText('你沒有供貨合作的管理權限');
    await open(page,store.hash);await storeArea(page,'供貨合作');await expect(page.locator('#store-cooperation-panel .hosted-distribution')).toBeVisible();
  }finally{release();await context.close();}
});

test('late owner order-link admission keeps store navigation stable during a pointer click',async({page,e2eAuthPool},info)=>{
  const owner=await person(e2eAuthPool);await login(page,owner.email);
  const store=await launchStore(page,'Synthetic stable navigation');
  await post(page,store.root+'/setup',{name:'Synthetic 導覽店面',slug:'navigation-'+owner.id.slice(0,8),currency:'TWD'},201);
  const ordersPath=(url:URL)=>url.pathname===`/api/v1${store.root}/reservations`&&url.searchParams.get('limit')==='1';
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});
    let release!:()=>void,started!:()=>void;
    const held=new Promise<void>(resolve=>release=resolve),entered=new Promise<void>(resolve=>started=resolve);
    await page.route(ordersPath,async route=>{
      const response=await route.fetch();expect(response.status()).toBe(200);
      started();await held;await route.fulfill({response});
    });
    try{
      if(width===1440)await open(page,store.hash);else await page.reload();
      await entered;
      const navigation=page.getByRole('navigation',{name:'商店工作區',exact:true});
      const cooperation=navigation.getByRole('button',{name:'供貨合作',exact:true});
      await cooperation.scrollIntoViewIfNeeded();
      await expect(page.getByRole('link',{name:'預留訂單',exact:true})).toHaveCount(0);
      await expect(page.getByRole('link',{name:'供貨訂單',exact:true})).toHaveCount(0);
      const before=await navigation.boundingBox(),button=await cooperation.boundingBox();
      expect(before).not.toBeNull();expect(button).not.toBeNull();
      await page.screenshot({path:info.outputPath(`orders-pending-${width}.png`),fullPage:true,animations:'disabled'});
      await page.mouse.move(button!.x+button!.width/2,button!.y+button!.height/2);
      await page.mouse.down();
      // Admit the owner-only links between pointer down/up: the navigation must
      // stay under the original pointer instead of silently losing the click.
      release();
      await expect(page.getByRole('link',{name:'預留訂單',exact:true})).toBeVisible();
      await expect(page.getByRole('link',{name:'供貨訂單',exact:true})).toBeVisible();
      expect(await navigation.boundingBox()).toEqual(before);
      await page.mouse.up();
      await expect(cooperation).toHaveAttribute('aria-pressed','true');
      await expect(page.locator('#store-cooperation-panel .hosted-distribution')).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:info.outputPath(`orders-admitted-${width}.png`),fullPage:true,animations:'disabled'});
    }finally{
      release();await page.mouse.up();await page.unroute(ordersPath);
    }
  }
});
