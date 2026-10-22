import {test,expect,openSeller,type Request} from './seller-console-fixture.js';
import {createE2ePaymentOrder} from './hosted-payment-fixture.js';
import {person,login,post,launchStore} from './hosted-store-fixture.js';

function barrier(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
const hash=(store:{tenant:string;instance:string},page:string)=>`#stores/${store.tenant}/${store.instance}/${page}`;

// Synthetic owned stores, real read schemas and real commands. No production data.
test('changing seller filters cancels the old list instead of waiting for its response',async({page,browser,baseURL,e2eAuthPool})=>{
 const p=await createE2ePaymentOrder(e2eAuthPool,browser,baseURL!,page.context());
 const held=barrier(),started=barrier();let first:Request|undefined,firstPending=true;
 await page.route('**/checkout-orders?*',async route=>{
  if(!firstPending)return route.continue();firstPending=false;first=route.request();
  const response=await route.fetch();started.release();await held.promise;
  try{await route.fulfill({response});}catch(cause){if(!route.request().failure())throw cause;}
 });
 try{
  await openSeller(page,baseURL!,p.store.seller.email,hash(p.store,'orders'));await started.promise;
  const console=page.locator('.seller-console');
  const cancelled=page.waitForEvent('requestfailed',request=>request===first);
  await console.getByLabel('狀態',{exact:true}).selectOption('cancelled');
  await console.getByRole('button',{name:'套用篩選',exact:true}).click();
  expect((await cancelled).failure()?.errorText).toMatch(/abort|cancel/i);
  await expect(console.getByText('沒有符合條件的結帳訂單。請清除篩選，或稍後更新清單。',{exact:true})).toBeVisible();
  held.release();await expect(console.locator('[data-seller-order]')).toHaveCount(0);
 }finally{held.release();}
});

test('a confirmed seller command replaces the list read that began before the write',async({page,browser,baseURL,e2eAuthPool})=>{
 const p=await createE2ePaymentOrder(e2eAuthPool,browser,baseURL!,page.context());
 await openSeller(page,baseURL!,p.store.seller.email,hash(p.store,'orders'));
 const console=page.locator('.seller-console'),link=console.getByRole('link',{name:p.order.display_number,exact:true});
 await expect(link).toBeVisible();
 const held=barrier(),started=barrier();let old:Request|undefined,reads=0;
 await page.route('**/checkout-orders?*',async route=>{
  reads++;if(reads!==1)return route.continue();old=route.request();
  const response=await route.fetch();started.release();await held.promise;
  try{await route.fulfill({response});}catch(cause){if(!route.request().failure())throw cause;}
 });
 try{
  await console.getByRole('button',{name:/更新資料\s*：訂單清單/}).click();await started.promise;
  await expect(console.getByText(/正在更新訂單清單；以下為上次讀取的資料/)).toBeVisible();
  await link.click();await expect(console.getByRole('heading',{name:'訂單詳情：'+p.order.display_number})).toBeVisible();
  const cancelled=page.waitForEvent('requestfailed',request=>request===old);
  await console.getByRole('button',{name:'取消訂單',exact:true}).click();
  await page.getByRole('dialog',{name:'取消訂單',exact:true}).getByRole('button',{name:'確認取消訂單',exact:true}).click();
  expect((await cancelled).failure()?.errorText).toMatch(/abort|cancel/i);
  await expect.poll(()=>reads).toBe(2);
  await expect(console.getByRole('region',{name:'訂單',exact:true})).toContainText('已取消');
  held.release();await console.getByRole('link',{name:'返回訂單',exact:true}).click();
  await expect(link.locator('xpath=ancestor::li[1]')).toContainText('已取消');
  await expect(link).toBeFocused();
 }finally{held.release();}
});

test('supplier capability completion does not restart an already-running product read',async({page,e2eAuthPool})=>{
 const member=await person(e2eAuthPool);await login(page,member.email);
 const store=await launchStore(page,'合成讀取協調供貨空間');
 await post(page,store.root+'/supply-profile',{name:'合成讀取商品庫',currency:'TWD'},201);
 const product=await post(page,store.root+'/supply-products',{title:'讀取協調測試茶杯',description:'合成資料',cost_minor:400,stock:10},201);
 const owner=barrier(),products=barrier(),ownerStarted=barrier(),productsStarted=barrier();
 let reads=0,productRequest:Request|undefined,aborted=false;
 page.on('requestfailed',request=>{if(request===productRequest)aborted=true;});
 await page.route(url=>url.pathname==='/api/v1'+store.root+'/reservation-setting',async route=>{
  const response=await route.fetch();ownerStarted.release();await owner.promise;await route.fulfill({response});
 });
 await page.route(url=>url.pathname==='/api/v1'+store.root+'/supplier-console/products',async route=>{
  reads++;if(!productRequest)productRequest=route.request();const response=await route.fetch();productsStarted.release();await products.promise;
  try{await route.fulfill({response});}catch(cause){if(!route.request().failure())throw cause;}
 });
 try{
  await page.goto('/'+store.hash+'/supply/products');await Promise.all([ownerStarted.promise,productsStarted.promise]);
  owner.release();
  await expect(page.getByRole('navigation',{name:'營運中心',exact:true}).getByRole('link',{name:'預留與訂單',exact:true})).toBeAttached();
  products.release();await expect(page.locator('.supplier-console').locator(`[data-sc-item="${product.product_id}"]`)).toBeVisible();
  expect(reads).toBe(1);expect(aborted).toBe(false);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{owner.release();products.release();}
});
