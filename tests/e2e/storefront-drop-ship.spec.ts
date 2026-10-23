import {randomUUID} from 'node:crypto';
import {test,expect,type Page} from './fixtures.js';
import {setupCartFixtureStore,assertCartResponsiveLayout} from './storefront-cart-fixture.js';
import {person,launchStore,post} from './hosted-store-fixture.js';
import {apiLogin,member} from './hosted-order-fixture.js';
import {DropShipOrdersSchema} from '../../contracts/guild-launchpad/v1/hosted-drop-ship.js';
import {PlaceOrderResponseSchema} from '../../contracts/guild-launchpad/v1/hosted-checkout.js';
const notice='由供應商直接寄出；收件人姓名、手機、地址會提供給供應商，只用於寄送';
async function patch(page:Page,path:string,body:unknown,version:string){
 const session=await (await page.request.get('/api/v1/session')).json();
 const r=await page.request.patch('/api/v1'+path,{data:body,headers:{Origin:new URL(page.url()).origin,'X-CSRF-Token':session.csrf_token,'Idempotency-Key':randomUUID(),'If-Match':`"${version}"`}});
 const value=await r.json();expect(r.status(),JSON.stringify(value)).toBe(200);return value;
}
async function go(page:Page,origin:string,hash:string){await page.goto(origin+'/#'+hash);}
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
  await bp.reload();await expect(bp.getByRole('heading',{name:'由供應商寄出',exact:true})).toBeVisible();await expect(bp.getByText('物流單號：SYNTHETIC-123',{exact:true})).toBeVisible();await assertCartResponsiveLayout(bp,[1280,768,390],w=>info.outputPath(`buyer-shipped-${w}.png`));
  await go(sp,store.origin,storeHash+'/orders/'+order.order_ref);await expect(sp.getByText('出貨者：合成代出貨供應商（代出貨）',{exact:true})).toBeVisible();await expect(sp.getByText(/供應成本/).first()).toBeVisible();await expect(sp.getByText('SYNTHETIC-123',{exact:true})).toBeVisible();await assertCartResponsiveLayout(sp,[1280,768,390],w=>info.outputPath(`store-shipped-${w}.png`));
  // A fresh cart with one store-owned item and one covered item asks the buyer to split it.
  for(const sku of [selection.sku,store.products[0].sku]){await bp.goto(store.origin+`/shops/${store.slug}/products/${sku}`);await bp.getByRole('button',{name:'加入購物車',exact:true}).click();}
  await bp.getByRole('link',{name:'查看購物車',exact:true}).click();await bp.getByRole('link',{name:'前往結帳',exact:true}).click();await expect(bp.getByText('這些商品由不同出貨者寄送，請分開下單。').first()).toBeVisible();
 }finally{await seller.close();await supplier.close();await buyer.close();await store.close();}
});
