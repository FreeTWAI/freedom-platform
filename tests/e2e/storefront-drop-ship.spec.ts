import {randomUUID} from 'node:crypto';
import {test,expect,type Page,type Browser} from './fixtures.js';
import type {Pool} from 'pg';
import {setupCartFixtureStore,assertCartResponsiveLayout} from './storefront-cart-fixture.js';
import {person,launchStore,post,storeArea} from './hosted-store-fixture.js';
import {apiLogin,member} from './hosted-order-fixture.js';
import {DropShipOrdersSchema,DropShipAgreementSchema,DropShipAgreementsSchema} from '../../contracts/guild-launchpad/v1/hosted-drop-ship.js';
import {PlaceOrderResponseSchema} from '../../contracts/guild-launchpad/v1/hosted-checkout.js';
const notice='由供應商直接寄出；收件人姓名、手機、地址會提供給供應商，只用於寄送';
async function patch(page:Page,path:string,body:unknown,version:string){
 const session=await (await page.request.get('/api/v1/session')).json();
 const r=await page.request.patch('/api/v1'+path,{data:body,headers:{Origin:new URL(page.url()).origin,'X-CSRF-Token':session.csrf_token,'Idempotency-Key':randomUUID(),'If-Match':`"${version}"`}});
 const value=await r.json();expect(r.status(),JSON.stringify(value)).toBe(200);return value;
}
async function go(page:Page,origin:string,hash:string){await page.goto(origin+'/#'+hash);}

async function agreementFixture(db:Pool,browser:Browser) {
 const store=await setupCartFixtureStore(db,browser,true,true,{commerceSelfShipEnabled:true,commerceDropShipEnabled:true,supplierConsoleEnabled:true,storePoliciesEnabled:true});
 const seller=await browser.newContext({baseURL:store.origin}),supplier=await browser.newContext({baseURL:store.origin});
 const close=async()=>{try{await Promise.all([seller.close(),supplier.close()]);}finally{await store.close();}};
 try {
  await apiLogin(seller,store.origin,store.seller.email);const sp=await seller.newPage();await sp.goto(store.origin);
  const user=await person(db);await apiLogin(supplier,store.origin,user.email);const fp=await supplier.newPage();await fp.goto(store.origin);
  const supply=await launchStore(fp,'合成提案恢復供應商');await post(fp,supply.root+'/supply-profile',{name:'合成提案恢復供應商',currency:'TWD'},201);
  const product=await post(fp,supply.root+'/supply-products',{title:'合成提案商品',cost_minor:400,stock:20},201);
  const terms=await patch(fp,supply.root+'/products/'+product.product_id+'/supply-terms',{cost_minor:400,shipping_minor:0,shipping_terms:'合成寄送條件',return_terms:'合成退換條件'},product.version);
  const offer=await post(fp,supply.root+'/products/'+product.product_id+'/supply-offer',{},200,terms.version);
  const selection=await store.sellerPost(store.root+'/distribution-selections',{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:1200},201);
  await post(fp,supply.root+'/supply-requests/'+selection.selection_id+'/decision',{decision:'accepted',listing_sha256:selection.listing_sha256},200,selection.version);
  const body={supplier_instance_id:supply.hash.split('/')[2],selection_ids:[selection.selection_id],fee_per_order_minor:7000,promise_working_days:4};
  const proposal=DropShipAgreementSchema.parse(await store.sellerPost(store.root+'/drop-ship/agreements',body,201));
  const base=DropShipAgreementSchema.parse(await post(fp,supply.root+'/supplier-console/drop-ship/agreements/'+proposal.agreement_id+'/accept',{terms_sha256:proposal.terms_sha256},200,proposal.version));
  return {store,sp,fp,supply,base,body,close,hash:`stores/${store.tenant}/${store.instance}`};
 } catch(error) {await close();throw error;}
}

test('drop-ship proposal uses the saved terms when agreements arrive after products',async({browser,e2eAuthPool})=>{
 const f=await agreementFixture(e2eAuthPool,browser);let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});let productsRead=false;
 try {
  await f.sp.route('**/drop-ship/agreements',async route=>{
   if(route.request().method()!=='GET')return route.fallback();
   const response=await route.fetch();expect(response.status()).toBe(200);await gate;await route.fulfill({response});
  });
  f.sp.on('response',r=>{if(r.url().endsWith('/drop-ship/suppliers')&&r.status()===200)productsRead=true;});
  await go(f.sp,f.store.origin,f.hash+'/drop-ship');await expect.poll(()=>productsRead).toBe(true);
  const form=f.sp.getByRole('form',{name:'代出貨提案：合成提案恢復供應商'});
  await expect(form.getByLabel('每單代出貨費（元，含郵資）')).toBeDisabled();
  release();await expect(f.sp.getByText('已生效',{exact:true})).toBeVisible();
  await expect(form.getByLabel('每單代出貨費（元，含郵資）')).toHaveValue('70');
  await expect(form.getByLabel('寄送承諾（工作天）')).toHaveValue('4');
  await expect(form.getByRole('checkbox',{name:'合成提案商品',exact:true})).toBeChecked();
 } finally {release();await f.close();}
});

test('drop-ship proposal keeps an edited draft on its original agreement version after refresh',async({browser,e2eAuthPool},info)=>{
 const f=await agreementFixture(e2eAuthPool,browser);
 try {
  await go(f.sp,f.store.origin,f.hash+'/drop-ship');await expect(f.sp.getByText('已生效',{exact:true})).toBeVisible();
  const form=f.sp.getByRole('form',{name:'代出貨提案：合成提案恢復供應商'}),fee=form.getByLabel('每單代出貨費（元，含郵資）');
  await fee.fill('75');await form.getByLabel('寄送承諾（工作天）').fill('5');await form.getByRole('checkbox',{name:'合成提案商品',exact:true}).check();
  const newer=DropShipAgreementSchema.parse(await f.store.sellerPost(f.store.root+'/drop-ship/agreements',{...f.body,fee_per_order_minor:9000,promise_working_days:6},201,f.base.version));
  let writes=0;f.sp.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/drop-ship/agreements'))writes++;});
  await f.sp.getByRole('button',{name:/^更新資料\s*：代出貨同意$/}).click();
  await expect(f.sp.getByRole('heading',{name:new RegExp('第 '+newer.version+' 版.*等待供應商決定')})).toBeVisible();
  await expect(fee).toHaveValue('75');await expect(form.getByLabel('寄送承諾（工作天）')).toHaveValue('5');
  await expect(form.getByRole('button',{name:'提出新版本',exact:true})).toBeDisabled();
  await expect(form.getByRole('alert')).toContainText('輸入仍保留');
  await assertCartResponsiveLayout(f.sp,[1280,390],w=>info.outputPath(`proposal-conflict-${w}.png`));
  expect(writes).toBe(0);
  await form.getByRole('button',{name:'捨棄草稿並載入最新提案',exact:true}).click();
  await expect(fee).toHaveValue('90');await expect(form.getByLabel('寄送承諾（工作天）')).toHaveValue('6');
  await expect(form.getByRole('button',{name:'提出新版本',exact:true})).toBeEnabled();
  expect(writes).toBe(0);
  const rows=DropShipAgreementsSchema.parse(await(await f.sp.request.get('/api/v1'+f.store.root+'/drop-ship/agreements')).json());
  expect(rows.items).toHaveLength(2);expect(rows.items.find(a=>a.agreement_id===f.base.agreement_id)?.state).toBe('accepted');
  await fee.fill('95');
  const submitted=f.sp.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/drop-ship/agreements'));
  await form.getByRole('button',{name:'提出新版本',exact:true}).click();
  const request=await submitted;expect(request.headers()['if-match']).toBe('"'+newer.version+'"');expect(request.postDataJSON()).toMatchObject({fee_per_order_minor:9500,promise_working_days:6});
  await expect(f.sp.locator('.seller-announcement')).toHaveText('已保存：提出新版本。');
  const saved=DropShipAgreementsSchema.parse(await(await f.sp.request.get('/api/v1'+f.store.root+'/drop-ship/agreements')).json());expect(saved.items).toHaveLength(3);expect(saved.items.find(a=>a.version==='3')).toMatchObject({fee_per_order_minor:9500,promise_working_days:6,state:'proposed'});
 } finally {await f.close();}
});

test('drop-ship proposal retries a committed unknown response with its original key body and version',async({browser,e2eAuthPool})=>{
 const f=await agreementFixture(e2eAuthPool,browser);
 try {
  await go(f.sp,f.store.origin,f.hash+'/drop-ship');await expect(f.sp.getByText('已生效',{exact:true})).toBeVisible();
  const form=f.sp.getByRole('form',{name:'代出貨提案：合成提案恢復供應商'}),fee=form.getByLabel('每單代出貨費（元，含郵資）');
  await fee.fill('85');await form.getByLabel('寄送承諾（工作天）').fill('5');
  const attempts:{key:string;version:string;body:string|null}[]=[],ids:string[]=[];
  await f.sp.route('**/drop-ship/agreements',async route=>{
   if(route.request().method()!=='POST')return route.fallback();
   const request=route.request();attempts.push({key:request.headers()['idempotency-key'],version:request.headers()['if-match'],body:request.postData()});
   const response=await route.fetch();expect(response.status()).toBe(201);ids.push(DropShipAgreementSchema.parse(await response.json()).agreement_id);
   if(attempts.length===1)await route.fulfill({status:502,json:{code:'synthetic_lost_ack'}});else await route.fulfill({response});
  });
  await form.getByRole('button',{name:'提出新版本',exact:true}).click();
  const retry=f.sp.locator('.seller-console').getByRole('button',{name:'重試',exact:true});await expect(retry).toBeEnabled();
  await f.sp.getByRole('button',{name:/^更新資料\s*：代出貨同意$/}).click();
  await expect(f.sp.getByRole('heading',{name:/第 2 版.*等待供應商決定/})).toBeVisible();
  await expect(fee).toHaveValue('85');await expect(fee).toBeDisabled();
  await expect(form.getByRole('button',{name:'捨棄草稿並載入最新提案',exact:true})).toBeDisabled();
  await retry.click();await expect(f.sp.locator('.seller-announcement')).toHaveText('已保存：提出新版本。');
  await expect(form.getByRole('button',{name:'捨棄草稿並載入最新提案',exact:true})).toHaveCount(0);
  await expect(fee).toBeEnabled();await expect(fee).toHaveValue('85');
  expect(attempts).toHaveLength(2);expect(attempts[0].key).toBeTruthy();expect(attempts[0].version).toBe('"'+f.base.version+'"');expect(attempts[1]).toEqual(attempts[0]);expect(ids[1]).toBe(ids[0]);
  const rows=DropShipAgreementsSchema.parse(await(await f.sp.request.get('/api/v1'+f.store.root+'/drop-ship/agreements')).json());expect(rows.items).toHaveLength(2);
  // A pristine form follows a subsequent real version, without creating a draft or a write.
  const newer=DropShipAgreementSchema.parse(await f.store.sellerPost(f.store.root+'/drop-ship/agreements',{...f.body,fee_per_order_minor:9500,promise_working_days:7},201,'2'));
  await f.sp.getByRole('button',{name:/^更新資料\s*：代出貨同意$/}).click();
  await expect(form).toContainText('最新提案：第 '+newer.version+' 版');await expect(fee).toHaveValue('95');await expect(form.getByLabel('寄送承諾（工作天）')).toHaveValue('7');expect(attempts).toHaveLength(2);
 } finally {await f.close();}
});

test('store privacy explanation remains accurate with an accepted drop-ship agreement',async({browser,e2eAuthPool})=>{
 const f=await agreementFixture(e2eAuthPool,browser);
 try {
  await go(f.sp,f.store.origin,f.hash);await storeArea(f.sp,'商店資料');
  const policies=f.sp.locator('.hosted-store-policies'),privacy=policies.locator('details').filter({has:f.sp.locator('summary').filter({hasText:'隱私政策'})});
  await privacy.locator('summary').click();
  await expect(privacy).toContainText('代出貨需店家與供應商另行確認同意');
  await expect(privacy).not.toContainText('目前尚無代出貨同意');
  await expect(privacy).toContainText('這個勾選不會開啟或阻擋結帳');
  const rows=DropShipAgreementsSchema.parse(await(await f.sp.request.get('/api/v1'+f.store.root+'/drop-ship/agreements')).json());expect(rows.items).toEqual([f.base]);
 } finally {await f.close();}
});
test('standing consent, bank checkout and supplier shipment keep recipient data limited to shipping',async({browser,e2eAuthPool},info)=>{
 const store=await setupCartFixtureStore(e2eAuthPool,browser,true,true,{commerceSelfShipEnabled:true,commerceDropShipEnabled:true,supplierConsoleEnabled:true,commerceOrderNotificationsEnabled:true});
 const seller=await browser.newContext({baseURL:store.origin}),supplier=await browser.newContext({baseURL:store.origin}),buyer=await browser.newContext({baseURL:store.origin});
 try{
  await apiLogin(seller,store.origin,store.seller.email);const sp=await seller.newPage();await sp.goto(store.origin);
  const supplierMember=await person(e2eAuthPool);await apiLogin(supplier,store.origin,supplierMember.email);const fp=await supplier.newPage();await fp.goto(store.origin);
  const supply=await launchStore(fp,'合成代出貨供應商');await post(fp,supply.root+'/supply-profile',{name:'合成代出貨供應商',currency:'TWD'},201);
  const product=await post(fp,supply.root+'/supply-products',{title:'供應商茶壺',description:'合成代出貨商品',cost_minor:400,stock:20},201);
  const terms=await patch(fp,supply.root+'/products/'+product.product_id+'/supply-terms',{cost_minor:400,shipping_minor:0,shipping_terms:'依代出貨同意寄送',return_terms:'請聯絡店家'},product.version);
  const offer=await post(fp,supply.root+'/products/'+product.product_id+'/supply-offer',{},200,terms.version);
  const selection=await store.sellerPost(store.root+'/distribution-selections',{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:1200},201);
  await post(fp,supply.root+'/supply-requests/'+selection.selection_id+'/decision',{decision:'accepted',listing_sha256:selection.listing_sha256},200,selection.version);
  await store.sellerPut(store.root+'/shipping-profile',{schema:'freedom.shipping-profile/v1',working_days:[1,2,3,4,5],services:[],delivery_options:[{method:'self_ship',fee_per_order_minor:6000,handling_days:2,note:null},{method:'meetup',note:'合成面交'}],drop_ship:null},'1');
  await store.republish();
  const storeHash=`stores/${store.tenant}/${store.instance}`;
  await go(sp,store.origin,storeHash+'/drop-ship');
  const form=sp.getByRole('form',{name:'代出貨提案：合成代出貨供應商'});
  await form.getByRole('checkbox',{name:'供應商茶壺',exact:true}).check();await form.getByLabel('每單代出貨費（元，含郵資）').fill('70');await form.getByLabel('寄送承諾（工作天）').fill('4');await form.getByRole('button',{name:'提出代出貨',exact:true}).click();
  await expect(sp.getByText('等待供應商決定',{exact:true})).toBeVisible();
  await assertCartResponsiveLayout(sp,[1280,768,390],w=>info.outputPath(`store-agreement-${w}.png`));
  await go(fp,store.origin,supply.hash+'/supply/drop-ship-agreements');await fp.getByRole('button',{name:'同意這一版',exact:true}).click();await fp.getByRole('dialog',{name:'同意這一版',exact:true}).getByRole('button',{name:'確認同意這一版',exact:true}).click();await expect(fp.getByText('已生效',{exact:true})).toBeVisible();
  await assertCartResponsiveLayout(fp,[1280,768,390],w=>info.outputPath(`supplier-agreement-${w}.png`));
  const buyerMember=await member(e2eAuthPool);await apiLogin(buyer,store.origin,buyerMember.email);const bp=await buyer.newPage();
  await bp.goto(store.origin+`/shops/${store.slug}/products/${selection.sku}`);await bp.getByRole('button',{name:'加入購物車',exact:true}).click();await bp.getByRole('link',{name:'查看購物車',exact:true}).click();await bp.getByRole('link',{name:'前往結帳',exact:true}).click();
  await bp.getByLabel('收件人姓名',{exact:true}).fill('合成收件人');await bp.getByLabel('收件人手機',{exact:true}).fill('0912345678');await bp.getByLabel('Email',{exact:true}).fill('recipient-hidden@example.test');await bp.getByRole('radio',{name:'宅配（供應商代出貨）',exact:true}).check();await bp.getByLabel('郵遞區號',{exact:true}).fill('100');await bp.getByLabel('收件地址',{exact:true}).fill('合成路1號');await expect(bp.getByText(notice,{exact:true})).toBeVisible();
  await expect(bp.locator('#shop-checkout')).toHaveAttribute('aria-busy','false');await assertCartResponsiveLayout(bp,[1280,768,390],w=>info.outputPath(`buyer-checkout-${w}.png`));
  await bp.getByRole('button',{name:'核對訂單',exact:true}).click();await expect(bp.getByRole('heading',{name:'3. 付款方式',exact:true})).toBeVisible();await bp.getByRole('radio',{name:'銀行匯款',exact:true}).check();
  let capture!:(v:unknown)=>void;const placed=new Promise<unknown>(r=>capture=r);
  await bp.route('**/checkouts/*/orders',async route=>{const response=await route.fetch();expect(response.status()).toBe(201);capture(await response.json());await route.fulfill({response});});await bp.getByRole('button',{name:'確認下單',exact:true}).click();const order=PlaceOrderResponseSchema.parse(await placed).order;await expect(bp.getByRole('heading',{level:1})).toHaveText('訂單 '+order.display_number);
  const today=(await e2eAuthPool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM-DD') AS date")).rows[0].date;
  await store.sellerPost(`${store.root}/checkout-orders/${order.order_ref}/offline-payments`,{amount_minor:order.total_minor,received_on:today},200,'1');
  const read=fp.waitForResponse(r=>r.url().includes('/supplier-console/drop-ship/orders?')&&r.request().method()==='GET');await go(fp,store.origin,supply.hash+'/supply/drop-ship-orders');const visible=DropShipOrdersSchema.parse(await (await read).json());expect(visible.items).toHaveLength(1);expect(Object.keys(visible.items[0]).sort()).toEqual(['currency','display_number','drop_ship_fee_minor','items','order_ref','payment_confirmed_at','recipient','ship_by','shipment','store_name','supply_cost_minor','unable','version'].sort());expect(Object.keys(visible.items[0].recipient!).sort()).toEqual(['address','mobile','name','postal_code']);
  await expect(fp.getByText('合成收件人 · 0912345678',{exact:true})).toBeVisible();await expect(fp.locator('.supplier-console')).not.toContainText('recipient-hidden@example.test');await expect(fp.locator('.supplier-console')).not.toContainText('零售價');
  await assertCartResponsiveLayout(fp,[1280,768,390],w=>info.outputPath(`supplier-waiting-${w}.png`));
  await fp.getByRole('button',{name:'登記出貨',exact:true}).click();const dialog=fp.getByRole('dialog',{name:'登記出貨',exact:true});await dialog.getByLabel('物流業者',{exact:true}).selectOption('post');await dialog.getByLabel('物流單號',{exact:true}).fill('SYNTHETIC-123');await dialog.getByLabel('寄出日期',{exact:true}).fill(today);await dialog.getByRole('button',{name:'確認登記出貨',exact:true}).click();await expect(dialog).not.toBeVisible();await fp.getByRole('button',{name:'已出貨',exact:true}).click();await expect(fp.getByText(/SYNTHETIC-123/)).toBeVisible();
  await bp.reload();await expect(bp.getByRole('heading',{name:'由供應商寄出',exact:true})).toBeVisible();await expect(bp.getByText('物流單號：SYNTHETIC-123',{exact:true})).toBeVisible();await expect(bp.getByText('只記錄供應商填寫的資訊，工坊不追蹤物流、不核實簽收。',{exact:true})).toBeVisible();await assertCartResponsiveLayout(bp,[1280,768,390],w=>info.outputPath(`buyer-shipped-${w}.png`));
  await go(sp,store.origin,storeHash+'/orders/'+order.order_ref);await expect(sp.getByText('出貨者：合成代出貨供應商（代出貨）',{exact:true})).toBeVisible();await expect(sp.getByText(/供應成本/).first()).toBeVisible();await expect(sp.getByText('SYNTHETIC-123',{exact:true})).toBeVisible();await expect(sp.getByText('只記錄供應商填寫的資訊，工坊不追蹤物流、不核實簽收。',{exact:true})).toBeVisible();await assertCartResponsiveLayout(sp,[1280,768,390],w=>info.outputPath(`store-shipped-${w}.png`));
  // A fresh cart with one store-owned item and one covered item asks the buyer to split it.
  for(const sku of [selection.sku,store.products[0].sku]){await bp.goto(store.origin+`/shops/${store.slug}/products/${sku}`);await bp.getByRole('button',{name:'加入購物車',exact:true}).click();}
  await bp.getByRole('link',{name:'查看購物車',exact:true}).click();await bp.getByRole('link',{name:'前往結帳',exact:true}).click();await expect(bp.getByText('這些商品由不同出貨者寄送，請分開下單。').first()).toBeVisible();
 }finally{await seller.close();await supplier.close();await buyer.close();await store.close();}
});
