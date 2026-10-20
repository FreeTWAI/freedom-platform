import {createHash,randomUUID} from 'node:crypto';
import type {Locator,Page} from '@playwright/test';
import {test,expect} from './fixtures.js';
import {person,login,post,launchStore,storeArea,photoSource,captureOffer} from './hosted-store-fixture.js';

test.skip(process.env.FREEDOM_E2E_STORE_PHOTO_FIXTURE!=='1','Requires the isolated product-photo fixture.');
const caption='供應商提供的商品照片，只供評估，不屬於供貨條件。';
async function decoded(image:Locator) {
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}
async function confirm(page:Page,block:Locator,label:string) {
  await block.getByRole('button',{name:label,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:label,exact:true});
  await expect(dialog).toContainText('同社群、可以查看這份供貨方案的店主都看得到這張照片，只供評估。');
  await dialog.getByRole('button',{name:'確認'+label,exact:true}).click();
  await expect(dialog).toBeHidden();
}

test('supplier explicitly shares, replaces and stops an evaluation photo for another shop owner',async({browser,baseURL,e2eAuthPool},info)=>{
  const contexts=await Promise.all([browser.newContext({baseURL}),browser.newContext({baseURL})]);
  try {
    const [a,b]=await Promise.all(contexts.map(c=>c.newPage()));
    const [supplier,seller]=await Promise.all([person(e2eAuthPool),person(e2eAuthPool)]);
    const suffix=randomUUID().slice(0,6),title='青禾合成陶杯 '+suffix;
    await login(a,supplier.email);const sa=await launchStore(a,'青禾供貨空間');
    await post(a,sa.root+'/setup',{name:'青禾陶器供應商',slug:'offer-photo-'+suffix,currency:'TWD'},201);
    const product=await post(a,sa.root+'/products',{title,description:'合成測試陶杯，紙盒包裝。',price_minor:9800,stock:73491},201);
    await a.evaluate(hash=>{location.hash=hash;},sa.hash+'/supply/products/'+product.product_id);
    const active=a.locator('.supplier-console [data-sc-active="true"]');
    await expect(active.getByRole('heading',{name:'商品詳情：'+title,exact:true})).toBeVisible();
    const photo=active.locator('.hosted-store-photo');
    await photo.getByLabel('商品照片',{exact:true}).setInputFiles(await photoSource('synthetic-offer-a.png','#e8a45c'));
    await photo.getByRole('button',{name:'儲存照片',exact:true}).click();
    await expect(photo.getByRole('status')).toContainText('已儲存照片變更');
    await decoded(photo.locator(':scope > img'));
    await active.getByRole('button',{name:'公開供貨版本',exact:true}).click();
    await a.getByRole('dialog',{name:'公開供貨版本的影響',exact:true}).getByRole('button',{name:'確認公開供貨版本',exact:true}).click();
    const block=active.getByRole('region',{name:'方案照片',exact:true});
    await expect(block).toContainText('未提供照片');
    await confirm(a,block,'提供目前的商品照片');
    await expect(block).toContainText('已提供目前的商品照片');
    await active.locator('.supply-offer-preview > summary').click();
    const preview=active.locator('.supply-offer-preview');
    await decoded(preview.locator('.supply-offer-photo img'));await expect(preview).toContainText(caption);
    await login(b,seller.email);const sb=await launchStore(b,'海風評估空間');
    await post(b,sb.root+'/setup',{name:'海風選物店',slug:'offer-seller-'+suffix,currency:'TWD'},201);
    await b.evaluate(hash=>{location.hash=hash;},sb.hash);
    await storeArea(b,'供貨合作');
    const catalog=b.locator('.hosted-distribution details').filter({has:b.locator('summary').filter({hasText:'選用其他商店的商品'})});
    await catalog.locator('summary').click();await catalog.getByRole('searchbox',{name:'搜尋供貨商品',exact:true}).fill(title);
    await expect(catalog.locator('article').filter({hasText:title}).locator('img')).toHaveCount(0);
    await catalog.locator('article').filter({hasText:title}).getByRole('link',{name:'查看供貨方案',exact:true}).click();
    const detail=b.locator('.hosted-supply-offer'),image=detail.locator('.supply-offer-photo img');
    await decoded(image);await expect(detail).toContainText(caption);
    const firstPath=await image.getAttribute('src'),firstHash=createHash('sha256').update(await(await b.request.get(firstPath!)).body()).digest('hex');
    const supplierTenant=sa.hash.split('/')[1],supplierInstance=sa.hash.split('/')[2];
    async function privateFieldsAbsent() {
      // Supplier management legitimately shows its own inventory; the evaluation
      // projections must exclude that stock and every private supplier identity.
      for(const text of [supplier.email,seller.email,supplierTenant,supplierInstance,'73491','銀行帳號']) {
        await expect(detail).not.toContainText(text);await expect(preview).not.toContainText(text);
      }
    }
    await privateFieldsAbsent();
    for(const width of [390,768,1440]) {
      await a.setViewportSize({width,height:900});await b.setViewportSize({width,height:900});
      for(const page of [a,b]) {
        await expect(page.locator('html')).toHaveAttribute('data-theme','light');
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      }
      const sizes=await block.locator(':scope > .actions > button').evaluateAll(nodes=>nodes.map(el=>({width:el.getBoundingClientRect().width,parent:el.parentElement!.getBoundingClientRect().width})));
      for(const size of sizes)expect(size.width).toBeLessThan(size.parent);
      const colours=await active.locator('.badge').first().evaluate(el=>{
        const style=getComputedStyle(el),lum=(rgb:string)=>rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(n=>n/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const text=lum(style.color),background=lum(style.backgroundColor);
        return {text:style.color,background:style.backgroundColor,contrast:(Math.max(text,background)+.05)/(Math.min(text,background)+.05)};
      });
      console.log('Offer photo light badge',width,colours);expect(colours.contrast).toBeGreaterThanOrEqual(4.5);
      await captureOffer(b,detail,info.outputPath(`seller-photo-light-${width}.png`));
      await captureOffer(a,block,info.outputPath(`supplier-photo-light-${width}.png`));
    }
    await photo.getByLabel('商品照片',{exact:true}).setInputFiles(await photoSource('synthetic-offer-b.png','#387362'));
    await photo.getByRole('button',{name:'儲存替換照片',exact:true}).click();
    await expect(photo.getByRole('status')).toContainText('已儲存照片變更');
    await expect(block).toContainText('已提供的照片不是目前的商品照片');
    await confirm(a,block,'改用目前的商品照片');await expect(block).toContainText('已提供目前的商品照片');
    await b.reload();await decoded(image);expect(await image.getAttribute('src')).not.toBe(firstPath);
    const secondHash=createHash('sha256').update(await(await b.request.get((await image.getAttribute('src'))!)).body()).digest('hex');
    expect(secondHash).not.toBe(firstHash);await privateFieldsAbsent();
    const secondPath=(await image.getAttribute('src'))!;
    await b.route('**'+secondPath,route=>route.abort());await b.reload();
    await expect(detail.getByText('照片暫時無法顯示',{exact:true})).toBeVisible();
    await expect(detail.locator('.supply-offer-photo img')).toHaveCount(0);
    await b.unroute('**'+secondPath);await b.reload();await decoded(image);
    await confirm(a,block,'停止提供照片');await expect(block).toContainText('未提供照片');
    await b.reload();await expect(detail.getByRole('heading',{name:'商品',exact:true})).toBeVisible();
    await expect(detail.locator('.supply-offer-photo')).toHaveCount(0);await privateFieldsAbsent();
  } finally {await Promise.allSettled(contexts.map(c=>c.close()));}
});
