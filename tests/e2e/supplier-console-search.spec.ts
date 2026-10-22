import {randomUUID} from 'node:crypto';
import {test,expect} from './member-feature-fixture.js';
import {person,login,post,launchStore} from './hosted-store-fixture.js';

test.use({memberFeatures:{guildLaunchpadEnabled:true,hostedReservationsEnabled:true,supplierConsoleEnabled:true}});

test('supplier local searches handle width, case, IME, partial lists and clear focus without requests or writes',async({browser,baseURL,e2eAuthPool})=>{
 test.setTimeout(120000);
 const contexts=await Promise.all([0,1].map(()=>browser.newContext({baseURL})));
 let supplierId:string|undefined;
 try{
  const supplier=await person(e2eAuthPool);supplierId=supplier.id;
  const retailer=await person(e2eAuthPool),a=await contexts[0].newPage(),b=await contexts[1].newPage();
  await login(a,supplier.email);await login(b,retailer.email);
  const supply=await launchStore(a,'合成供貨搜尋'),store=await launchStore(b,'合成店家搜尋');
  await post(a,supply.root+'/supply-profile',{name:'合成供貨',currency:'TWD'},201);
  const product=await post(a,supply.root+'/supply-products',{title:'Tea 茶杯',description:'synthetic search fixture',cost_minor:400,stock:10},201);
  const session=await (await a.request.get('/api/v1/session')).json();
  const prepared=await a.request.patch('/api/v1'+supply.root+`/products/${product.product_id}/supply-terms`,{
   data:{cost_minor:400,shipping_minor:0,shipping_terms:'合成測試三天出貨',return_terms:'合成測試退貨'},
   headers:{Origin:new URL(a.url()).origin,'X-CSRF-Token':session.csrf_token,'Idempotency-Key':randomUUID(),'If-Match':`"${product.version}"`},
  });expect(prepared.status(),await prepared.text()).toBe(200);
  const terms=await prepared.json();
  const offer=await post(a,supply.root+`/products/${product.product_id}/supply-offer`,{},200,terms.version);
  await post(b,store.root+'/setup',{name:'Tea Shop 茶店',slug:'search-'+randomUUID().slice(0,8),currency:'TWD'},201);
  const proposal=await post(b,store.root+'/distribution-selections',{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:1100},201);
  // Use real authorized rows. Marking the read as partial exercises truthful, loaded-only feedback.
  await a.route('**/supplier-console/partners',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),truncated:true}});});
  await a.evaluate(hash=>{window.location.hash=hash+'/supply/partners';},supply.hash);
  const active=a.locator('[data-sc-active="true"]'),rows=active.locator('.sc-list li');
  await expect(active.getByRole('heading',{name:'合作店家',exact:true})).toBeVisible();await expect(rows).toHaveCount(1);
  const partner=active.getByLabel('搜尋合作店家',{exact:true});
  await expect(active.getByText(/搜尋結果不代表全部紀錄/)).toBeVisible();
  let reads=0,writes=0;
  const observe=(request:import('@playwright/test').Request)=>{
   const path=new URL(request.url()).pathname;
   if(path.endsWith('/supplier-console/partners')||path.endsWith('/supply-requests'))reads++;
   if(path.startsWith('/api/v1/')&&request.method()!=='GET')writes++;
  };
  a.on('request',observe);
  await partner.fill('ｔｅａ SHOP');await expect(rows).toHaveCount(1);
  await partner.fill('不存在的店家');await expect(rows).toHaveCount(0);
  await expect(active.getByText('已載入的合作店家沒有符合搜尋條件，請清除搜尋或調整關鍵字。',{exact:true})).toBeVisible();
  await partner.press('Escape');await expect(partner).toHaveValue('');await expect(partner).toBeFocused();await expect(rows).toHaveCount(1);
  await partner.dispatchEvent('compositionstart');await partner.fill('不');
  await partner.dispatchEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true});
  await expect(rows).toHaveCount(1);await expect(partner).toHaveValue('不');
  await partner.dispatchEvent('compositionend',{data:'不'});await expect(rows).toHaveCount(0);
  await active.getByRole('button',{name:'清除搜尋',exact:true}).click();
  await expect(partner).toBeFocused();await expect(rows).toHaveCount(1);
  a.off('request',observe);expect(reads).toBe(0);expect(writes).toBe(0);

  await a.evaluate(hash=>{window.location.hash=hash+'/supply/terms';},supply.hash);
  const request=active.locator(`[data-sc-item="${proposal.selection_id}"]`),search=active.getByLabel('搜尋申請',{exact:true});
  await expect(request).toBeVisible();await search.fill(`ｔｅａ ${proposal.selection_id.toUpperCase()}`);await expect(request).toBeVisible();
  await search.fill('完全不相符的搜尋');await expect(request).toHaveCount(0);
  await expect(active.getByText('已載入的申請沒有符合搜尋條件，請清除搜尋或調整關鍵字。',{exact:true})).toBeVisible();
  await active.getByRole('button',{name:'清除搜尋',exact:true}).click();await expect(search).toBeFocused();await expect(request).toBeVisible();
  await search.fill('Tea 茶杯');await request.click();
  await expect(active.getByRole('heading',{name:'審核售價申請',exact:true})).toBeVisible();
  await active.getByRole('link',{name:'返回供貨條件與審核',exact:true}).click();
  await expect(search).toHaveValue('Tea 茶杯');await expect(request).toBeFocused();
  for(const width of [320,390,1280]){
   await a.setViewportSize({width,height:900});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
 }finally{
  await Promise.allSettled(contexts.map(context=>context.close()));
  if(supplierId)await e2eAuthPool.query(`UPDATE commerce_hosted_supply_offers o SET state='withdrawn',version=o.version+1
   FROM commerce_storefront_profiles p JOIN commerce_shops s ON s.shop_id=p.supply_shop_id
   WHERE o.instance_id=p.instance_id AND o.tenant_id=p.tenant_id AND s.owner_id=$1 AND o.state='offered'`,[supplierId]);
 }
});
