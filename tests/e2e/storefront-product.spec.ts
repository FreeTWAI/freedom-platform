import {LIVE_PUBLIC_ORIGIN} from '../../apps/platform-api/src/routes/published-skills.js';
import {test, expect} from './fixtures.js';
import {fixtureStore, apiLogin, enableStore} from './hosted-order-fixture.js';
import {post} from './hosted-store-fixture.js';
import {DEMO_PASSWORD} from '../../packages/testing/seed.js';
import {StoreViewSchema} from '../../contracts/guild-launchpad/v1/storefront.js';

// All people, brand copy and products in these cases are explicitly synthetic.
test('published product link preserves selection through login, review, reservation and a fresh return', async ({page, browser, baseURL, e2eAuthPool}, info) => {
  const s = await fixtureStore(e2eAuthPool, browser, baseURL!);
  await enableStore(e2eAuthPool, s.instance);
  const detail = `/shops/${s.slug}/products/${s.product.sku}`, selected = `#reservations/${s.slug}/product/${s.product.sku}`;
  const mutations: string[] = [];
  page.on('request', request => {if (request.method() === 'POST' && /\/reservation-(quotes|orders)$/.test(new URL(request.url()).pathname)) mutations.push(new URL(request.url()).pathname);});
  await page.goto('/shops/' + s.slug);
  await expect(page.getByRole('heading', {level: 1})).toHaveText('山邊小店');
  await page.getByRole('link', {name: '查看商品：手作茶杯', exact: true}).click();
  await expect(page).toHaveURL(new URL(detail, baseURL!).href);
  await expect(page.getByRole('heading', {level: 1})).toHaveText('手作茶杯');
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', new URL(detail, LIVE_PUBLIC_ORIGIN).href);
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', '杯口手工成形。');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: info.outputPath(`synthetic-product-${width}.png`), fullPage: true});
  }
  await page.getByRole('link', {name: '登入確認預留條件', exact: true}).click();
  await expect(page).toHaveURL(new URL('/' + selected, baseURL!).href);
  await page.getByLabel('電子郵件', {exact: true}).fill(s.buyer.email);
  await page.getByLabel('密碼', {exact: true}).fill(DEMO_PASSWORD);
  await page.getByRole('button', {name: '登入', exact: true}).click();
  const surface = page.locator('.hosted-store'), quantity = surface.getByLabel('手作茶杯數量');
  await expect(quantity).toHaveValue('1');
  await expect(surface).toContainText('從商品頁選擇的商品');
  expect(mutations).toEqual([]);
  await quantity.fill('2');
  for (const theme of ['light', 'dark', 'versefolk']) for (const width of [390, 768, 1440]) {
    await page.evaluate(value => {localStorage.setItem('freedom-theme', value); document.documentElement.dataset.theme = value; document.documentElement.dataset.experienceProfile = value; window.dispatchEvent(new Event('freedom-theme-changed'));}, theme);
    await page.setViewportSize({width, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: info.outputPath(`product-selection-${theme}-${width}.png`), fullPage: true});
  }
  await surface.getByRole('button', {name: '查看預留內容', exact: true}).click();
  await expect(page.getByRole('region', {name: '確認預留內容'})).toContainText('非應付金額');
  expect(mutations).toHaveLength(1);
  expect((await e2eAuthPool.query('SELECT reserved FROM commerce_items WHERE item_id=$1', [s.product.product_id])).rows[0].reserved).toBe(0);
  await surface.getByRole('button', {name: '確認預留 30 分鐘', exact: true}).click();
  await expect(page.getByRole('region', {name: '我的預留'})).toContainText('預留中');
  expect(mutations).toHaveLength(2);
  const hash = new URL(page.url()).hash;
  expect((await e2eAuthPool.query('SELECT reserved FROM commerce_items WHERE item_id=$1', [s.product.product_id])).rows[0].reserved).toBe(2);
  const fresh = await browser.newContext({baseURL});
  try {
    await apiLogin(fresh, baseURL!, s.buyer.email);
    const returned = await fresh.newPage(); await returned.goto('/' + hash);
    await expect(returned.getByRole('region', {name: '我的預留'})).toContainText('預留中');
    returned.once('dialog', dialog => dialog.accept());
    await returned.getByRole('button', {name: '取消預留', exact: true}).click();
    await expect(returned.getByRole('region', {name: '我的預留'})).toContainText('已取消');
    expect((await e2eAuthPool.query('SELECT reserved FROM commerce_items WHERE item_id=$1', [s.product.product_id])).rows[0].reserved).toBe(0);
  } finally {await fresh.close();}
});

test('draft changes cannot change public product metadata; closed and missing products cannot start a reservation', async ({page, browser, baseURL, e2eAuthPool}) => {
  const s = await fixtureStore(e2eAuthPool, browser, baseURL!);
  const detail = `/shops/${s.slug}/products/${s.product.sku}`;
  await apiLogin(page.context(), baseURL!, s.buyer.email);
  const writes: string[] = [];
  page.on('request', request => {if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);});
  await page.goto(`/#reservations/${s.slug}/product/${s.product.sku}`);
  await expect(page.locator('.hosted-store')).toContainText('商品僅供展示');
  await expect(page.getByLabel('手作茶杯數量')).toHaveCount(0);
  await expect(page.getByRole('button', {name: '查看預留內容', exact: true})).toHaveCount(0);
  await enableStore(e2eAuthPool, s.instance);
  await page.goto(`/#reservations/${s.slug}/product/P999999`);
  await expect(page.locator('.hosted-store')).toContainText('分享的商品目前沒有公開');
  await expect(page.getByRole('button', {name: '查看預留內容', exact: true})).toHaveCount(0);
  expect(writes).toEqual([]);
  const owner = await browser.newContext({baseURL});
  try {
    const session = await apiLogin(owner, baseURL!, s.seller.email);
    const editor = await owner.newPage(); await editor.goto('/');
    const response = await editor.request.patch('/api/v1' + s.root + '/products/' + s.product.product_id, {data: {title: '未發布草稿：新的茶杯'}, headers: {Origin: baseURL!, 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': crypto.randomUUID(), 'If-Match': `"${s.product.version}"`}});
    expect(response.status()).toBe(200);
    await page.goto(detail);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', '手作茶杯｜山邊小店');
    const preview = await editor.request.get('/api/v1' + s.root + '/preview-page');
    expect(preview.status()).toBe(200); const html = await preview.text();
    expect(html).toContain('未發布草稿：新的茶杯'); expect(html).not.toContain('property="og:'); expect(html).not.toContain('rel="canonical"');
    const current = StoreViewSchema.parse(await (await editor.request.get('/api/v1' + s.root)).json());
    await post(editor, s.root + '/unpublish', {}, 200, current.version!);
    const missing = await page.goto(detail); expect(missing!.status()).toBe(404);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('找不到這項商品');
    await expect(page.locator('meta[property^="og:"]')).toHaveCount(0);
    await expect(page.getByRole('link', {name: '登入確認預留條件', exact: true})).toHaveCount(0);
  } finally {await owner.close();}
});

test('VARIANTS-E2E editor recovers the original command and SKU links work with and without JavaScript',async({browser,e2eAuthPool},info)=>{
 const {setupCartFixtureStore}=await import('./storefront-cart-fixture.js');
 const store=await setupCartFixtureStore(e2eAuthPool,browser,false,false,{storeVariantsEnabled:true}),owner=await browser.newContext({baseURL:store.origin}),buyer=await browser.newContext({baseURL:store.origin}),plain=await browser.newContext({baseURL:store.origin,javaScriptEnabled:false});
 try{
  const prefilled={title:'原始\u202e名稱',description:'原始\u0081介紹'},prefilledProduct=await store.sellerPatch(store.root+'/products/'+store.products[0].product_id,prefilled,store.products[0].version);
  await apiLogin(owner,store.origin,store.seller.email);const page=await owner.newPage();await page.goto('/#stores/'+store.tenant+'/'+store.instance);
  const editor=page.locator('.store-variants-editor');await expect(editor.getByLabel('商品組名稱',{exact:true})).toHaveValue(prefilled.title);
  async function measureButtons(state:string,width:number){
   const metrics=await page.locator('.btn').evaluateAll(buttons=>buttons.map(button=>({label:button.textContent?.trim()??'',width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height,editorWidth:button.closest('.store-variants-editor')?.getBoundingClientRect().width??null,primary:button.classList.contains('btn-primary')})));
   await (await import('node:fs/promises')).writeFile(info.outputPath('variants-buttons-'+state+'-'+width+'.json'),JSON.stringify(metrics,null,2)+'\n');
   for(const button of metrics.filter(b=>b.width>0&&b.editorWidth!==null&&!b.primary))expect(button.width,button.label).toBeLessThan(button.editorWidth!*.95);
  }

  await editor.getByLabel('商品組介紹',{exact:true}).fill(prefilled.description+' ');
  await editor.getByRole('button',{name:'儲存規格',exact:true}).click();
  await expect(editor.getByRole('alert')).toBeFocused();
  for(const label of ['商品組名稱','商品組介紹']){
   await expect(editor.getByLabel(label,{exact:true})).toHaveAttribute('aria-invalid','true');
   await expect(editor.getByLabel(label,{exact:true})).toHaveAttribute('aria-describedby',/errors$/);
   await editor.getByRole('link',{name:label,exact:true}).click();await expect(editor.getByLabel(label,{exact:true})).toBeFocused();
  }
  await editor.getByRole('button',{name:'取消變更',exact:true}).click();
  await store.sellerPatch(store.root+'/products/'+store.products[0].product_id,{title:store.products[0].title,description:store.products[0].description},prefilledProduct.version);
  await page.reload();await expect(editor.getByLabel('商品組名稱',{exact:true})).toHaveValue(store.products[0].title);
  await editor.getByLabel('商品組名稱',{exact:true}).fill('');await editor.getByRole('button',{name:'儲存規格',exact:true}).click();await expect(editor.getByRole('alert')).toBeFocused();await expect(editor.getByLabel('商品組名稱',{exact:true})).toHaveAttribute('aria-invalid','true');await editor.getByRole('link',{name:'商品組名稱',exact:true}).click();await expect(editor.getByLabel('商品組名稱',{exact:true})).toBeFocused();await editor.getByLabel('商品組名稱',{exact:true}).fill('經典 T 恤');await editor.getByLabel('商品組介紹',{exact:true}).fill('合成商品組介紹，原本商品內容會保留。');
  await editor.getByRole('button',{name:'新增選項',exact:true}).click();await expect(editor.getByRole('textbox',{name:'選項名稱（選項 1）',exact:true})).toBeVisible();await editor.getByLabel('選項名稱（選項 1）',{exact:true}).fill('顏色');await editor.getByLabel('選項值（選項 1，值 1）',{exact:true}).fill('白');await editor.getByRole('button',{name:'新增選項值',exact:true}).click();await editor.getByLabel('選項值（選項 1，值 2）',{exact:true}).fill('黑');
  await editor.getByRole('button',{name:'新增選項',exact:true}).click();await editor.getByLabel('選項名稱（選項 2）',{exact:true}).fill('尺寸');await editor.getByLabel('選項值（選項 2，值 1）',{exact:true}).fill('M');await editor.getByRole('button',{name:'新增選項值',exact:true}).last().click();await editor.getByLabel('選項值（選項 2，值 2）',{exact:true}).fill('L');
  for(const product of [store.products[1],store.soldOutProduct]){await editor.getByLabel('加入現有商品',{exact:true}).selectOption(product.product_id);await editor.getByRole('button',{name:'加入商品組',exact:true}).click();}
  await editor.getByLabel(store.products[1].sku+' 顏色',{exact:true}).selectOption({label:'黑'});await editor.getByLabel(store.products[1].sku+' 尺寸',{exact:true}).selectOption({label:'L'});await editor.getByLabel(store.soldOutProduct.sku+' 尺寸',{exact:true}).selectOption({label:'L'});
  const signatures:{key:string|undefined;version:string|undefined;body:string|null}[]=[],pattern='**/product-groups/'+store.products[0].sku;
  page.on('request',request=>{if(request.method()==='PUT'&&new URL(request.url()).pathname.endsWith('/product-groups/'+store.products[0].sku))signatures.push({key:request.headers()['idempotency-key'],version:request.headers()['if-match'],body:request.postData()});});
  await page.route(pattern,async route=>{if(route.request().method()==='PUT'){await route.fetch();await route.abort('failed');}else await route.continue();});
  await editor.getByRole('button',{name:'儲存規格',exact:true}).click();await expect(editor.getByRole('status')).toContainText('暫時無法確認儲存結果');await expect(editor.getByLabel('商品組名稱',{exact:true})).toBeDisabled();
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});await editor.getByRole('button',{name:'重試原操作',exact:true}).focus();await page.screenshot({path:info.outputPath('variants-editor-retry-'+width+'.png'),fullPage:true});await measureButtons('retry',width);}
  await page.unroute(pattern);await editor.getByRole('button',{name:'重試原操作',exact:true}).click();await expect(editor.getByRole('status')).toContainText('已儲存規格');expect(signatures).toHaveLength(2);expect(signatures[1]).toEqual(signatures[0]);
  await editor.getByRole('button',{name:'移除選項：顏色',exact:true}).click();
  await expect(editor.getByLabel(store.products[0].sku+' 尺寸',{exact:true}).locator('option:checked')).toHaveText('M');
  await expect(editor.getByLabel(store.products[1].sku+' 尺寸',{exact:true}).locator('option:checked')).toHaveText('L');
  await expect(editor.getByLabel(store.soldOutProduct.sku+' 尺寸',{exact:true}).locator('option:checked')).toHaveText('L');
  await editor.getByRole('button',{name:'取消變更',exact:true}).click();
  await editor.getByLabel(store.products[0].sku+' 售價',{exact:true}).fill('333');
  await editor.getByLabel(store.products[1].sku+' 售價',{exact:true}).fill('444');
  await editor.getByLabel(store.products[1].sku+' 庫存',{exact:true}).fill('5');
  await editor.getByRole('button',{name:'儲存商品：'+store.products[0].sku,exact:true}).click();
  await expect(editor.getByRole('button',{name:'儲存商品：'+store.products[0].sku,exact:true})).toBeDisabled();
  await expect(editor.getByLabel(store.products[1].sku+' 售價',{exact:true})).toBeEnabled();
  await expect(editor.getByLabel(store.products[1].sku+' 售價',{exact:true})).toHaveValue('444');
  await expect(editor.getByLabel(store.products[1].sku+' 庫存',{exact:true})).toHaveValue('5');
  await expect(editor.getByLabel('規格商品',{exact:true})).toBeDisabled();
  await editor.getByRole('button',{name:'儲存商品：'+store.products[1].sku,exact:true}).click();
  await expect(editor.getByLabel('規格商品',{exact:true})).toBeEnabled();
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});await editor.getByLabel('商品組名稱',{exact:true}).focus();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('variants-editor-'+width+'.png'),fullPage:true});await measureButtons('saved',width);}
  await store.republish();const detail=await buyer.newPage();await detail.goto('/shops/'+store.slug);await expect(detail.getByRole('link',{name:'查看商品：經典 T 恤',exact:true})).toHaveCount(1);await expect(detail.locator('.shop-catalog')).toContainText('部分規格售完');
  for(const width of [390,768,1440]){await detail.setViewportSize({width,height:900});expect(await detail.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await detail.screenshot({path:info.outputPath('variants-grid-'+width+'.png'),fullPage:true});}
  await detail.goto('/shops/'+store.slug+'/products/'+store.products[0].sku);const length=await detail.evaluate(()=>history.length);await detail.getByRole('link',{name:/^顏色：黑/}).click();await expect(detail).toHaveURL(store.origin+'/shops/'+store.slug+'/products/'+store.products[1].sku);expect(await detail.evaluate(()=>history.length)).toBe(length);await expect(detail.getByRole('link',{name:/^顏色：黑/})).toBeFocused();await expect(detail.locator('#shop-variant-status')).toContainText('黑／L');await expect(detail.locator('#shop-add-to-cart')).toHaveAttribute('data-title','經典 T 恤（黑／L）');
  const noJs=await plain.newPage();await noJs.goto('/shops/'+store.slug+'/products/'+store.soldOutProduct.sku);await expect(noJs.locator('.shop-availability')).toHaveText('此規格已售完，請選擇其他規格。');await expect(noJs.locator('#shop-add-to-cart')).toHaveCount(0);await expect(noJs.getByRole('link',{name:/^尺寸：L/})).toHaveAttribute('aria-current','true');await expect(noJs.getByRole('link',{name:/^顏色：白/})).toHaveAttribute('href','/shops/'+store.slug+'/products/'+store.soldOutProduct.sku);
  for(const width of [390,768,1440]){await noJs.setViewportSize({width,height:900});expect(await noJs.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await noJs.screenshot({path:info.outputPath('variants-no-js-sold-out-'+width+'.png'),fullPage:true});}
  await noJs.getByRole('link',{name:/^顏色：黑/}).click();await expect(noJs).toHaveURL(store.origin+'/shops/'+store.slug+'/products/'+store.products[1].sku);await expect(noJs.locator('#shop-add-to-cart')).toHaveAttribute('data-sku',store.products[1].sku);await expect(noJs).toHaveTitle('經典 T 恤（黑／L）｜山邊小店｜自由工坊');
 }finally{await owner.close();await buyer.close();await plain.close();await store.close();}
});

test('reviewed one-click publication keeps variants and categories, blocks editor drafts and refreshes their saved review', async ({browser,e2eAuthPool}) => {
  const {setupCartFixtureStore} = await import('./storefront-cart-fixture.js');
  const {randomUUID} = await import('node:crypto');
  const store = await setupCartFixtureStore(e2eAuthPool,browser,false,false,{storeVariantsEnabled:true,storeCategoriesEnabled:true});
  const owner = await browser.newContext({baseURL:store.origin}), buyer = await browser.newContext({baseURL:store.origin});
  let releaseSave = () => {};
  try {
    const axis = {key:randomUUID(),name:'顏色',values:[{key:randomUUID(),name:'白'},{key:randomUUID(),name:'黑'}]};
    await store.sellerPut(store.root+'/product-groups/'+store.products[0].sku, {
      title:'共用規格商品',description:'合成上架驗收',axes:[axis],default_product_id:store.products[0].product_id,order:0,
      members:store.products.slice(0,2).map((product,index)=>({product_id:product.product_id,product_version:product.version,value_keys:[axis.values[index].key]})),
    },'1');
    await apiLogin(owner,store.origin,store.seller.email);
    const page = await owner.newPage();
    await page.goto('/#stores/'+store.tenant+'/'+store.instance);
    const listing = page.locator('.hosted-store-publication'), publish = listing.getByRole('button',{name:'一鍵上架商品',exact:true});
    const variants = page.locator('.store-variants-editor'), categories = page.locator('.store-categories-editor');
    await expect(publish).toBeEnabled();
    await expect(variants.getByLabel('商品組名稱',{exact:true})).toHaveValue('共用規格商品');
    const original = await store.sellerGet(store.root+'/publication-review');
    await variants.getByLabel('商品組名稱',{exact:true}).fill('上架規格商品');
    await expect(publish).toBeDisabled();
    const variantReview = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1'+store.root+'/publication-review');
    await variants.getByRole('button',{name:'儲存規格',exact:true}).click();
    const afterVariant = await (await variantReview).json();
    expect(afterVariant.review_digest).not.toBe(original.review_digest);
    expect(afterVariant.variants_changed).toBe(true);
    await expect(publish).toBeEnabled();
    await categories.getByLabel('分類名稱',{exact:true}).fill('精選規格');
    await expect(publish).toBeDisabled();
    await categories.getByRole('button',{name:'新增分類',exact:true}).click();
    await expect(categories.getByRole('status')).toContainText('已新增分類');
    await expect(categories.getByRole('checkbox',{name:'上架規格商品 · 2 個規格',exact:true})).toBeEnabled();
    await categories.getByRole('checkbox',{name:'上架規格商品 · 2 個規格',exact:true}).check();
    await expect(publish).toBeDisabled();
    let started!:()=>void;
    const saving = new Promise<void>(resolve=>{started=resolve;}), gate = new Promise<void>(resolve=>{releaseSave=resolve;});
    await page.route('**/api/v1'+store.root+'/categories/*/groups', async route=>{started();await gate;await route.continue();});
    const categoryReview = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1'+store.root+'/publication-review');
    await categories.getByRole('button',{name:'儲存分類商品',exact:true}).click();
    await saving;
    await expect(publish).toBeDisabled();
    releaseSave();
    const afterCategory = await (await categoryReview).json();
    expect(afterCategory.review_digest).not.toBe(afterVariant.review_digest);
    expect(afterCategory.categories_changed).toBe(true);
    await expect(publish).toBeEnabled();
    await listing.getByText('查看本次上架內容',{exact:true}).click();
    for (const label of ['規格','商品分類']) await expect(listing.locator('dl div').filter({hasText:label})).toContainText('有尚未發布的變更');
    const publication = page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/v1'+store.root+'/publish-reviewed');
    await publish.click();
    const published = await publication;
    expect(published.status()).toBe(200);
    expect(published.request().postDataJSON()).toEqual({review_digest:afterCategory.review_digest});
    await expect(listing.getByRole('button',{name:'商品已全部上架',exact:true})).toBeDisabled();
    const publicPage = await buyer.newPage();
    await publicPage.goto('/shops/'+store.slug);
    const nav = publicPage.getByRole('navigation',{name:'商品分類',exact:true});
    await expect(nav.getByRole('link',{name:'精選規格',exact:true})).toBeVisible();
    await nav.getByRole('link',{name:'精選規格',exact:true}).click();
    await publicPage.getByRole('link',{name:'查看商品：上架規格商品',exact:true}).click();
    await expect(publicPage.getByRole('link',{name:/^顏色：白/})).toBeVisible();
    await publicPage.getByRole('link',{name:/^顏色：黑/}).click();
    await expect(publicPage).toHaveURL(store.origin+'/shops/'+store.slug+'/products/'+store.products[1].sku);
    await expect(publicPage.locator('#shop-variant-status')).toContainText('黑');
  } finally {releaseSave();await owner.close();await buyer.close();await store.close();}
});
