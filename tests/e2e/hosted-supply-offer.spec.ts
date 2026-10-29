import {randomUUID} from 'node:crypto';
import {test,expect} from './member-feature-fixture.js';
import {person,login,open,post,launchStore,storeArea,captureOffer} from './hosted-store-fixture.js';
import {SHIPPING_TERMS_HINT,RETURN_TERMS_HINT,SELLABLE_LABEL} from '../../modules/agent-commerce/hosted-ui/SupplyOfferText.js';

test.use({memberFeatures:{guildLaunchpadEnabled:true,hostedReservationsEnabled:true,supplierConsoleEnabled:true}});

test('a shop owner understands a saved supply version, its approval and its honest sale paths',async({browser,baseURL,e2eAuthPool},info)=>{
  const contexts=await Promise.all([browser.newContext({baseURL}),browser.newContext({baseURL})]);
  const title='山林陶杯 '+randomUUID().slice(0,6),description='霧面陶杯，適合日常選物。\n每盒一件，附紙盒。';
  const shipping='確認後三個工作天出貨，最低一件。\n紙盒包裝，每件運費另計 15 元。';
  const returns='瑕疵品七日內可換貨。\n退貨運費由供應商負擔。';
  const reason='請將售價調整到適合這份包裝的金額。';
  try{
    const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
    const supplier=await person(e2eAuthPool),seller=await person(e2eAuthPool);
    await login(a,supplier.email);const sa=await launchStore(a,'山林供貨空間');
    await post(a,sa.root+'/setup',{name:'山林陶器供應商',slug:'supply-'+randomUUID().slice(0,12),currency:'TWD'},201);
    const product=await post(a,sa.root+'/products',{title,description,price_minor:9800,stock:73491},201);
    await open(a,sa.hash);
    await a.getByRole('button',{name:'供貨條件',exact:true}).click();
    let form=a.getByRole('form',{name:title+'供貨條件',exact:true});
    await expect(form.getByText(SHIPPING_TERMS_HINT,{exact:true})).toBeVisible();
    await expect(form.getByText(RETURN_TERMS_HINT,{exact:true})).toBeVisible();
    await form.getByLabel('供貨單價（TWD）',{exact:true}).fill('60');
    await form.getByLabel('每件運費（TWD）',{exact:true}).fill('15');
    await form.getByRole('textbox',{name:'出貨條件',exact:true}).fill(shipping);
    await form.getByRole('textbox',{name:'退貨條件',exact:true}).fill(returns);
    await form.getByRole('button',{name:'儲存供貨條件',exact:true}).click();
    await expect(a.locator('.hosted-store > [role="status"]')).toContainText('已儲存供貨條件');
    form=a.getByRole('form',{name:title+'供貨條件',exact:true});
    await form.locator('summary').filter({hasText:'預覽店主會看到的供貨方案'}).click();
    await expect(form.locator('.supply-offer-preview')).toContainText('目前保存的條件（尚未公開）');
    await expect(form.locator('.supply-offer-presentation')).toContainText(shipping);
    await form.getByRole('button',{name:'公開供貨版本',exact:true}).click();
    await expect(a.locator('.hosted-store > [role="status"]')).toContainText('已公開供貨版本');
    // The supplier console renders the identical component from the published
    // immutable offer; its own inventory editor is outside this preview.
    await a.evaluate(hash=>{location.hash=hash;},sa.hash+'/supply/products/'+product.product_id);
    const active=a.locator('.supplier-console [data-sc-active="true"]');
    await expect(active.getByRole('heading',{name:'商品詳情：'+title,exact:true})).toBeVisible();
    await expect(active.getByText(SHIPPING_TERMS_HINT,{exact:true})).toBeVisible();
    await active.locator('.supply-offer-preview > summary').click();
    const preview=active.locator('.supply-offer-preview');
    await expect(preview).toContainText('公開中的版本');
    const sharedText=await preview.locator('.supply-offer-presentation').innerText();
    for(const width of [390,768,1440]){
      await a.setViewportSize({width,height:900});
      expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await captureOffer(a,preview,info.outputPath(`supplier-preview-light-${width}.png`));
    }
    await login(b,seller.email);const sb=await launchStore(b,'海風零售空間');
    await post(b,sb.root+'/setup',{name:'海風選物店',slug:'retail-'+randomUUID().slice(0,12),currency:'TWD'},201);
    await open(b,sb.hash);await storeArea(b,'供貨合作');
    const catalog=b.locator('.hosted-distribution details').filter({has:b.locator('summary').filter({hasText:'選用其他商店的商品'})});
    await catalog.locator('summary').click();
    const search=catalog.getByRole('searchbox',{name:'搜尋供貨商品',exact:true});
    await search.fill('完全沒有的商品');await expect(catalog).toContainText('找到 0／');
    await search.fill('  山林陶器供應商  ');await expect(catalog.locator('article').filter({hasText:title})).toHaveCount(1);
    await search.fill('霧面陶杯');await expect(catalog.locator('article').filter({hasText:title})).toHaveCount(1);
    let failRead=true;
    await b.route('**/supply-catalog/*',async route=>{
      if(!failRead)return route.continue();
      failRead=false;
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({type:'about:blank',title:'unavailable',status:503,code:'unavailable',detail:'暫時無法讀取這份供貨方案。'})});
    });
    await search.fill(title);await catalog.locator('article').filter({hasText:title}).getByRole('link',{name:'查看供貨方案',exact:true}).click();
    const detail=b.locator('.hosted-supply-offer');
    await expect(detail.getByRole('heading',{name:'供貨方案',exact:true})).toBeVisible();
    // The shared client intentionally hides raw 5xx details.
    await expect(detail.getByRole('alert')).toHaveText('目前無法讀取供貨方案。');
    await expect(detail.locator('.supply-offer-presentation')).toHaveCount(0);
    await detail.getByRole('button',{name:'重試讀取供貨方案',exact:true}).click();
    await expect(detail.locator('.supply-offer-presentation')).toHaveText(sharedText,{useInnerText:true});
    for(const heading of ['商品','價格','出貨與退貨','合作方式','供應商同意的範圍','目前可以怎麼賣'])await expect(detail.getByRole('heading',{name:heading,exact:true})).toBeVisible();
    await expect(detail).toContainText('每件成本合計');await expect(detail).toContainText('$75.00');
    await expect(detail).toContainText('幣別：新臺幣（TWD）');
    await expect(detail.getByRole('heading',{name:'展示：供應商同意後可加入',exact:true})).toBeVisible();
    await expect(detail.getByRole('heading',{name:'結帳購買：目前無法結帳購買',exact:true})).toBeVisible();
    await expect(detail).toContainText('供貨商品需要有效的供應商代出貨同意，目前尚不能結帳購買。');
    await expect(detail).toContainText('自行持有商品');
    for(const width of [390,768,1440]){
      await b.setViewportSize({width,height:900});
      expect(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const link=detail.getByRole('link',{name:'返回供貨合作',exact:true});
      const box=await link.boundingBox();expect(box!.width).toBeLessThan(width-50);
      await captureOffer(b,detail,info.outputPath(`seller-offer-light-${width}.png`));
    }
    for(const text of [supplier.email,seller.email,'73491','銀行帳號']){
      await expect(detail).not.toContainText(text);await expect(preview).not.toContainText(text);
    }
    await detail.getByRole('button',{name:'設定我的售價',exact:true}).click();
    await detail.getByLabel('我的零售價（TWD）',{exact:true}).fill('120');
    await detail.getByRole('button',{name:'送出供貨申請',exact:true}).click();
    await expect(detail).toContainText('等待供應商確認');
    await expect(detail.getByRole('heading',{name:'展示：目前無法加入展示頁',exact:true})).toBeVisible();
    // Review both decisions in the real supplier console UI.
    await a.evaluate(hash=>{location.hash=hash;},sa.hash+'/supply/terms');
    await active.getByRole('link',{name:title+' · 海風選物店',exact:true}).click();
    await expect(active.getByRole('heading',{name:'審核售價申請',exact:true})).toBeVisible();
    await active.getByRole('button',{name:'不同意',exact:true}).click();
    const dialog=a.getByRole('dialog');await dialog.getByLabel('原因（選填）',{exact:true}).fill(reason);
    await dialog.getByRole('button',{name:'確認不同意',exact:true}).click();
    await expect(active.locator('.badge')).toHaveText('未同意');
    await b.reload();await expect(detail).toContainText(reason);
    await expect(detail.getByRole('heading',{name:'展示：目前無法加入展示頁',exact:true})).toBeVisible();
    await detail.getByRole('link',{name:'返回供貨合作',exact:true}).click();
    const own=b.locator('.hosted-distribution details').filter({has:b.locator('summary').filter({hasText:'我的選品'})});
    await own.locator('summary').click();await expect(own).toContainText(reason);
    await own.getByRole('link',{name:'查看供貨方案',exact:true}).click();
    await detail.getByRole('button',{name:'送出供貨申請',exact:true}).click();
    await expect(detail).toContainText('等待供應商確認');
    await a.reload();await active.getByRole('button',{name:'同意',exact:true}).click();
    await expect(active.locator('.badge')).toHaveText(SELLABLE_LABEL);
    const colours=await active.locator('.badge').evaluate(el=>{
      const s=getComputedStyle(el);
      const luminance=(rgb:string)=>rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const a=luminance(s.color),b=luminance(s.backgroundColor);
      return {text:s.color,background:s.backgroundColor,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
    console.log('Supply decision badge colours:',colours);
    expect(colours.contrast).toBeGreaterThanOrEqual(4.5);
    await b.reload();await expect(detail).toContainText(SELLABLE_LABEL);
    await expect(detail.getByRole('heading',{name:'展示：可加入展示頁',exact:true})).toBeVisible();
    await expect(detail.getByRole('heading',{name:'結帳購買：目前無法結帳購買',exact:true})).toBeVisible();
    for(const text of [supplier.email,'73491','銀行帳號'])await expect(detail).not.toContainText(text);
    await detail.getByRole('button',{name:'停止採用',exact:true}).click();
    await expect(detail).toContainText('已撤回供貨');
    await expect(detail.getByRole('heading',{name:'展示：目前無法加入展示頁',exact:true})).toBeVisible();
  }finally{await Promise.allSettled(contexts.map(c=>c.close()));}
});

test('structured references are optional information throughout supplier editing, seller pricing and publication',async({browser,baseURL,e2eAuthPool},info)=>{
 const contexts=await Promise.all([browser.newContext({baseURL}),browser.newContext({baseURL})]);
 const title='參考條件陶杯 '+randomUUID().slice(0,6),slug='terms-'+randomUUID().slice(0,12);
 try{
  const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
  await login(a,(await person(e2eAuthPool)).email);await expect(a.locator('html')).toHaveAttribute('data-theme','light');const sa=await launchStore(a,'結構化供貨空間');
  await post(a,sa.root+'/setup',{name:'山林參考條件供應商',slug:'supplier-'+randomUUID().slice(0,12),currency:'TWD'},201);
  const product=await post(a,sa.root+'/products',{title,description:'手作陶杯，紙盒包裝。',price_minor:9800,stock:78},201);
  await open(a,sa.hash);await a.getByRole('button',{name:'供貨條件',exact:true}).click();
  const legacy=a.getByRole('form',{name:title+'供貨條件',exact:true});
  await legacy.getByLabel('供貨單價（TWD）',{exact:true}).fill('60');await legacy.getByLabel('每件運費（TWD）',{exact:true}).fill('15');
  await legacy.getByLabel('建議售價（TWD）',{exact:true}).fill('65');await legacy.getByLabel('最低訂量（件）',{exact:true}).fill('2');await legacy.getByLabel('交期（天）',{exact:true}).fill('3');
  await legacy.getByRole('textbox',{name:'出貨條件',exact:true}).fill('紙盒包裝，以郵寄寄送；偏遠地區另議。');await legacy.getByRole('textbox',{name:'退貨條件',exact:true}).fill('瑕疵品七日內聯絡換貨，運費由供應商負擔。');
  const note='建議售價低於每件成本合計，店主照這個售價會虧損。';await expect(legacy.getByRole('note')).toHaveText(note);
  await expect(legacy.locator('.supply-reference-fields legend')).toHaveText('給店主的參考（選填）');
  const referenceHints=['只供店主參考，店主可以自行決定售價；系統不會依建議售價限制上架、供貨或結帳。','你建議店主每次至少訂幾件。只供店主參考；系統不會依最低訂量限制預留或結帳。','你預估收到訂單後幾天內出貨；當天出貨請填 0。只供店主參考，系統不保證出貨時間。'];
  for(const hint of referenceHints)await expect(legacy.getByText(hint,{exact:true})).toBeVisible();
  await legacy.getByLabel('最低訂量（件）',{exact:true}).fill('1.5');await expect(legacy.getByRole('alert')).toHaveText('最低訂量須為 1 至 10,000 的整數。');await legacy.getByLabel('最低訂量（件）',{exact:true}).fill('2');
  for(const width of [390,768,1440]){
   await a.setViewportSize({width,height:900});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await captureOffer(a,legacy,info.outputPath(`structured-supplier-editor-light-${width}.png`));
  }
  const saved=a.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname.endsWith('/supply-terms'));
  await legacy.getByRole('button',{name:'儲存供貨條件',exact:true}).click();expect((await saved).status()).toBe(200);
  await expect(a.locator('.hosted-store > [role="status"]')).toContainText('已儲存供貨條件');
  await expect(legacy.getByRole('button',{name:'公開供貨版本',exact:true})).toBeEnabled();
  await legacy.getByRole('textbox',{name:'出貨條件',exact:true}).fill('紙盒包裝，以郵寄寄送；偏遠地區另議，節慶安排另行確認。');
  const proseSaved=a.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname.endsWith('/supply-terms'));
  await legacy.getByRole('button',{name:'儲存供貨條件',exact:true}).click();const proseResponse=await proseSaved;expect(proseResponse.status()).toBe(200);
  for(const key of ['msrp_minor','minimum_order_quantity','lead_time_days'])expect(proseResponse.request().postDataJSON()).not.toHaveProperty(key);
  expect(await proseResponse.json()).toMatchObject({msrp_minor:6500,minimum_order_quantity:2,lead_time_days:3});
  await expect(legacy.getByRole('button',{name:'公開供貨版本',exact:true})).toBeEnabled();
  await a.evaluate(hash=>{location.hash=hash;},sa.hash+'/supply/products/'+product.product_id);
  const active=a.locator('.supplier-console [data-sc-active="true"]'),editor=active.getByRole('form',{name:'儲存供貨條件',exact:true});
  await expect(editor.getByLabel('建議售價（TWD）',{exact:true})).toHaveValue('65.00');await expect(editor.getByRole('note')).toHaveText(note);
  for(const hint of referenceHints)await expect(editor.getByText(hint,{exact:true})).toBeVisible();
  await expect(editor.getByLabel('最低訂量（件）',{exact:true})).toHaveValue('2');await expect(editor.getByLabel('交期（天）',{exact:true})).toHaveValue('3');
  const consoleTerms=active.locator('.sc-section').filter({has:a.getByRole('heading',{name:'供貨條件',exact:true})});
  for(const width of [390,1440]){
   await a.setViewportSize({width,height:900});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await expect(consoleTerms.getByRole('note')).toHaveText(note);
   await captureOffer(a,consoleTerms,info.outputPath(`structured-console-editor-light-${width}.png`));
  }
  await editor.getByLabel('建議售價（TWD）',{exact:true}).fill('450');
  const consoleSaved=a.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname.endsWith('/supply-terms'));
  await editor.getByRole('button',{name:'儲存供貨條件',exact:true}).click();const savedResponse=await consoleSaved;expect(savedResponse.status()).toBe(200);
  const sent=savedResponse.request().postDataJSON();expect(sent.msrp_minor).toBe(45000);expect(sent).not.toHaveProperty('minimum_order_quantity');expect(sent).not.toHaveProperty('lead_time_days');
  await expect(editor.getByRole('button',{name:'儲存供貨條件',exact:true})).toBeDisabled();
  await active.locator('.supply-offer-preview > summary').click();const preview=active.locator('.supply-offer-presentation');
  await expect(preview).toContainText('供應商建議售價');await expect(preview).toContainText('$450.00');await expect(preview).toContainText('建議最低訂量：每次 2 件');await expect(preview).toContainText('預估交期：收到訂單後約 3 天內出貨');
  const referenceNote='這些是供應商提供的參考資訊。系統不會依最低訂量限制預留或結帳，也不保證出貨時間。';
  await expect(preview.getByText(referenceNote,{exact:true})).toBeVisible();
  await active.getByRole('button',{name:'公開供貨版本',exact:true}).click();
  await a.getByRole('dialog',{name:'公開供貨版本的影響',exact:true}).getByRole('button',{name:'確認公開供貨版本',exact:true}).click();
  await expect(active.getByText('公開中的版本已是目前保存的條件；保存新的內容或供貨條件後才需要重新公開。',{exact:true})).toBeVisible();
  await login(b,(await person(e2eAuthPool)).email);const sb=await launchStore(b,'結構化零售空間');
  await post(b,sb.root+'/setup',{name:'海風參考選物店',slug,currency:'TWD'},201);await open(b,sb.hash);await storeArea(b,'供貨合作');
  const catalog=b.locator('.hosted-distribution details').filter({has:b.locator('summary').filter({hasText:'選用其他商店的商品'})});await catalog.locator('summary').click();
  await catalog.getByRole('searchbox',{name:'搜尋供貨商品',exact:true}).fill(title);const card=catalog.locator('article').filter({hasText:title});
  await expect(card).toContainText('供應商參考：建議售價 $450.00・建議最低 2 件・預估 3 天內出貨');
  for(const width of [390,768,1440]){await b.setViewportSize({width,height:900});expect(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await captureOffer(b,card,info.outputPath(`structured-catalog-card-light-${width}.png`));}
  await card.getByRole('link',{name:'查看供貨方案',exact:true}).click();const detail=b.locator('.hosted-supply-offer');
  await expect(detail).toContainText('供應商建議售價');await expect(detail).toContainText('建議售價只供參考，你可以自行決定零售價。');await expect(detail).toContainText('建議最低訂量：每次 2 件');await expect(detail).toContainText('預估交期：收到訂單後約 3 天內出貨');
  await expect(detail.getByText(referenceNote,{exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'設定我的售價',exact:true}).click();const retail=detail.getByLabel('我的零售價（TWD）',{exact:true});await expect(retail).toHaveValue('');
  const fill=detail.getByRole('button',{name:'填入建議售價',exact:true});await fill.click();await expect(retail).toHaveValue('450.00');await expect(detail.getByText('等待供應商確認',{exact:true})).toHaveCount(0);
  for(const width of [390,768,1440]){
   await b.setViewportSize({width,height:900});expect(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   const box=await fill.boundingBox();expect(box!.width).toBeLessThan(width-70);expect(await fill.getAttribute('type')).toBe('button');
   await captureOffer(b,detail,info.outputPath(`structured-seller-offer-light-${width}.png`));
  }
  await retail.fill('100');await detail.getByRole('button',{name:'送出供貨申請',exact:true}).click();await expect(detail).toContainText('等待供應商確認');
  await a.evaluate(hash=>{location.hash=hash;},sa.hash+'/supply/terms');await active.getByRole('link',{name:title+' · 海風參考選物店',exact:true}).click();
  await expect(active.getByRole('heading',{name:'審核售價申請',exact:true})).toBeVisible();await expect(active).not.toContainText('供應商建議售價');await expect(active).not.toContainText('$450.00');
  await active.getByRole('button',{name:'同意',exact:true}).click();await expect(active.locator('.badge')).toHaveText(SELLABLE_LABEL);
  const colours=await active.locator('.badge').evaluate(el=>({text:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));
  console.log('Structured terms badge colours',colours);expect(colours.text).not.toBe(colours.background);
  await b.reload();await expect(detail).toContainText(SELLABLE_LABEL);await detail.getByRole('link',{name:'返回供貨合作',exact:true}).click();await storeArea(b,'店面與發布');
  await b.getByRole('button',{name:'發布展示頁',exact:true}).click();await expect(b.locator('.hosted-store > [role="status"]')).toContainText('已上架 1 件商品，公開頁已更新。');
  for(const path of ['/api/v1/public/stores/'+slug,'/shops/'+slug]){const response=await b.request.get(path);expect(response.status()).toBe(200);const text=await response.text();for(const key of ['msrp_minor','minimum_order_quantity','lead_time_days','供應商建議售價','最低訂量','交期'])expect(text).not.toContain(key);}
  await a.evaluate(hash=>{location.hash=hash;},sa.hash+'/supply/products/'+product.product_id);await editor.getByLabel('交期（天）',{exact:true}).fill('');
  const cleared=a.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname.endsWith('/supply-terms'));
  await editor.getByRole('button',{name:'儲存供貨條件',exact:true}).click();const clearedResponse=await cleared;expect(clearedResponse.request().postDataJSON()).toMatchObject({lead_time_days:null});expect(clearedResponse.request().postDataJSON()).not.toHaveProperty('msrp_minor');
  await expect(active.getByText('需要重新公開',{exact:true})).toBeVisible();await active.getByRole('button',{name:'公開供貨版本',exact:true}).click();
  const republished=a.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/supply-offer'));
  await a.getByRole('dialog',{name:'公開供貨版本的影響',exact:true}).getByRole('button',{name:'確認公開供貨版本',exact:true}).click();const newOffer=await (await republished).json();expect(newOffer.terms).not.toHaveProperty('lead_time_days');
  await expect(active.getByText('公開中的版本已是目前保存的條件；保存新的內容或供貨條件後才需要重新公開。',{exact:true})).toBeVisible();
  await b.evaluate(hash=>{location.hash=hash;},sb.hash+'/supply-offers/'+newOffer.offer_id);await expect(detail).toContainText('建議最低訂量：每次 2 件');await expect(detail).not.toContainText('預估交期：收到訂單後約 3 天內出貨');await expect(detail).toContainText('供應商建議售價');
 }finally{await Promise.allSettled(contexts.map(c=>c.close()));}
});

for(const failedRead of ['offer','store'] as const){
 test(`confirmed withdrawal keeps sale paths unconfirmed after the ${failedRead} read fails, without losing the price draft`,async({browser,baseURL,e2eAuthPool})=>{
  const contexts=await Promise.all([browser.newContext({baseURL}),browser.newContext({baseURL})]);
  let releaseRead=()=>{};
  try{
   const [a,b]=await Promise.all(contexts.map(context=>context.newPage()));
   const title='狀態重讀陶杯 '+randomUUID().slice(0,6);
   await login(a,(await person(e2eAuthPool)).email);const sa=await launchStore(a,'狀態重讀供應商');
   await post(a,sa.root+'/setup',{name:'狀態重讀供應商',slug:'read-supplier-'+randomUUID().slice(0,12),currency:'TWD'},201);
   const product=await post(a,sa.root+'/products',{title,description:'已公開且保留的商品介紹',price_minor:9800,stock:5},201);
   await open(a,sa.hash);await a.getByRole('button',{name:'供貨條件',exact:true}).click();
   const terms=a.getByRole('form',{name:title+'供貨條件',exact:true});
   await terms.getByLabel('供貨單價（TWD）',{exact:true}).fill('60');
   await terms.getByLabel('每件運費（TWD）',{exact:true}).fill('15');
   await terms.getByRole('textbox',{name:'出貨條件',exact:true}).fill('紙盒包裝，三個工作天出貨。');
   await terms.getByRole('textbox',{name:'退貨條件',exact:true}).fill('瑕疵品七日內聯絡換貨。');
   await terms.getByRole('button',{name:'儲存供貨條件',exact:true}).click();
   await expect(a.locator('.hosted-store > [role="status"]')).toContainText('已儲存供貨條件');
   const published=a.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/v1${sa.root}/products/${product.product_id}/supply-offer`);
   await terms.getByRole('button',{name:'公開供貨版本',exact:true}).click();
   const publishedResponse=await published;expect(publishedResponse.status()).toBe(200);const offer=await publishedResponse.json();
   await login(b,(await person(e2eAuthPool)).email);const sb=await launchStore(b,'狀態重讀選物店');
   await post(b,sb.root+'/setup',{name:'狀態重讀選物店',slug:'read-seller-'+randomUUID().slice(0,12),currency:'TWD'},201);
   const selection=await post(b,sb.root+'/distribution-selections',{offer_id:offer.offer_id,terms_sha256:offer.terms_sha256,retail_price_minor:12000},201);
   await post(a,sa.root+`/supply-requests/${selection.selection_id}/decision`,{decision:'accepted',listing_sha256:selection.listing_sha256},200,selection.version);
   await open(b,sb.hash+'/supply-offers/'+offer.offer_id);
   const detail=b.locator('.hosted-supply-offer'),price=detail.getByLabel('我的零售價（TWD）',{exact:true});
   await expect(detail.getByRole('heading',{name:'展示：可加入展示頁',exact:true})).toBeVisible();
   const presentation=await detail.locator('.supply-offer-presentation').innerText();
   await price.fill('137');const priceNode=await price.elementHandle();
   const offerPath=`/api/v1${sb.root}/supply-catalog/${offer.offer_id}`,storePath=`/api/v1${sb.root}`;
   const withdrawalPath=`/api/v1${sb.root}/distribution-selections/${selection.selection_id}/withdraw`;
   let failing=true,holdRead=false,storeReads=0;
   const writes:{method:string;path:string;body:string|null}[]=[];
   b.on('request',request=>{
    const path=new URL(request.url()).pathname;
    if(request.method()==='GET'&&path===storePath)storeReads++;
    if(['POST','PATCH'].includes(request.method())&&path.startsWith(`/api/v1${sb.root}/distribution-selections`))writes.push({method:request.method(),path,body:request.postData()});
   });
   const blockedRead=new Promise<void>(resolve=>{releaseRead=resolve;});
   let readStarted=()=>{};const pendingRead=new Promise<void>(resolve=>{readStarted=resolve;});
   await b.route(url=>url.pathname===offerPath||url.pathname===storePath,async route=>{
    if(route.request().method()!=='GET')return route.continue();
    const path=new URL(route.request().url()).pathname;
    if(failing&&path===(failedRead==='offer'?offerPath:storePath))return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({type:'about:blank',title:'unavailable',status:503,code:'unavailable'})});
    if(holdRead&&path===offerPath){readStarted();await blockedRead;}
    await route.continue();
   });
   const receipt=b.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===withdrawalPath);
   await detail.getByRole('button',{name:'停止採用',exact:true}).click();expect((await receipt).status()).toBe(200);
   await expect(b.locator('.hosted-store > [role="status"]')).toContainText('已停止採用這項選品');
   if(failedRead==='offer')await expect(detail.getByRole('alert')).toHaveText('目前無法讀取供貨方案。');
   else await expect(b.locator('.hosted-store > [role="alert"]')).toBeVisible();
   const unconfirmed=async()=>{
    for(const name of ['展示：尚未確認','預留：尚未確認','結帳購買：尚未確認'])await expect(detail.getByRole('heading',{name,exact:true})).toBeVisible();
    await expect(detail.getByText('選品狀態尚未確認',{exact:true})).toBeVisible();
    await expect(detail.getByText(SELLABLE_LABEL,{exact:true})).toHaveCount(0);
    await expect(detail.locator('.supply-offer-presentation')).toHaveText(presentation,{useInnerText:true});
    await expect(price).toHaveValue('137');expect(await price.evaluate((node,previous)=>node===previous,priceNode)).toBe(true);
    await expect(price).toBeDisabled();await expect(detail.getByRole('button',{name:'停止採用',exact:true})).toBeDisabled();
    await expect(detail.getByRole('button',{name:'送出供貨申請',exact:true})).toBeDisabled();
   };
   await unconfirmed();expect(writes).toEqual([{method:'POST',path:withdrawalPath,body:'{}'}]);
   const parentReadsBeforeRetry=storeReads;
   failing=false;holdRead=true;
   await detail.getByRole('button',{name:'重試讀取供貨方案',exact:true}).click();await pendingRead;
   await unconfirmed();expect(writes).toHaveLength(1);expect(storeReads).toBe(parentReadsBeforeRetry);
   releaseRead();
   await expect(detail.getByText('已撤回供貨',{exact:true})).toBeVisible();
   await expect(detail.getByRole('heading',{name:'展示：目前無法加入展示頁',exact:true})).toBeVisible();
   await expect(detail.getByRole('heading',{name:'預留：目前無法預留',exact:true})).toBeVisible();
   await expect(detail.getByRole('heading',{name:'結帳購買：目前無法結帳購買',exact:true})).toBeVisible();
   await expect(detail.getByRole('button',{name:'停止採用',exact:true})).toHaveCount(0);
   await expect(price).toBeEnabled();expect(writes).toHaveLength(1);expect(storeReads).toBe(parentReadsBeforeRetry);
  }finally{releaseRead();await Promise.allSettled(contexts.map(context=>context.close()));}
 });
}
