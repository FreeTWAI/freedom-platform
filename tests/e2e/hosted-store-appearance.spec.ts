import {createHash,randomUUID} from 'node:crypto';
import {test,expect} from './fixtures.js';
import {person,login,launchStore,post,open,storeArea,captureOffer} from './hosted-store-fixture.js';

// Runs and passes in the trusted default pass, without any fixture-only flag.
test('APPEARANCE-OFF editor and public page ignore retained appearance and preserve the legacy template form',async({page,browser,baseURL,e2eAuthPool},info)=>{
  const site=await(await page.request.get('/api/v1/site')).json();expect(site.store_appearance_enabled).toBe(false);
  const member=await person(e2eAuthPool);await login(page,member.email);const s=await launchStore(page,'合成預設外觀工作室'),slug='appearance-off-'+randomUUID().slice(0,8);
  await post(page,s.root+'/setup',{name:'合成預設外觀商店',description:'保持目前公開樣式。',slug,currency:'TWD'},201);
  const product=await post(page,s.root+'/products',{title:'合成手作杯',description:'合成展示商品',price_minor:12000,stock:5},201);
  const newRequests:string[]=[];page.on('request',request=>{if(/\/appearance-(?:settings|media)(?:\/|$)/.test(new URL(request.url()).pathname))newRequests.push(request.method());});
  await open(page,s.hash);await storeArea(page,'店面與發布');await expect(page.locator('.hosted-store-appearance')).toHaveCount(0);
  await page.getByRole('radio',{name:'直列目錄',exact:false}).check();await page.getByRole('button',{name:'儲存版型',exact:true}).click();
  await expect(page.locator('.hosted-store')).toContainText('已儲存版型');await page.getByRole('button',{name:'發布展示頁',exact:true}).click();await expect(page.locator('.hosted-store')).toContainText('已發布・第 1 版');
  const tenantId=s.hash.split('/')[1],instanceId=s.hash.split('/')[2],pub=(await e2eAuthPool.query('SELECT current_publication_id FROM commerce_storefront_profiles WHERE instance_id=$1',[instanceId])).rows[0].current_publication_id;
  const before=await page.request.get('/shops/'+slug),originalHtml=await before.text(),jsonBefore=await(await page.request.get('/api/v1/public/stores/'+slug)).text();
  const frozenDocument={profile:'freedom.hosted-store-appearance/v1',accent_preset:'rose',announcement:'旗標關閉時不應顯示的合成公告',
    featured_product_ids:[product.product_id],featured_skus:[product.sku],cover:null,logo:null};
  const q=await e2eAuthPool.connect();try{
    await q.query('BEGIN');await q.query(`INSERT INTO commerce_storefront_appearance_drafts(tenant_id,instance_id,accent_preset,announcement,featured_product_ids)
      VALUES($1,$2,'rose',$3,$4)`,[tenantId,instanceId,frozenDocument.announcement,frozenDocument.featured_product_ids]);
    await q.query(`INSERT INTO commerce_publication_appearances(publication_id,tenant_id,instance_id,document,appearance_sha256) VALUES($1,$2,$3,$4,$5)`,
      [pub,tenantId,instanceId,frozenDocument,createHash('sha256').update(JSON.stringify(frozenDocument)).digest('hex')]);await q.query('COMMIT');
  }finally{await q.query('ROLLBACK');q.release();}
  expect(await(await page.request.get('/shops/'+slug)).text()).toBe(originalHtml);expect(await(await page.request.get('/api/v1/public/stores/'+slug)).text()).toBe(jsonBefore);
  await page.reload();await storeArea(page,'店面與發布');await expect(page.locator('.hosted-store-appearance')).toHaveCount(0);expect(newRequests).toEqual([]);
  expect((await page.request.get('/api/v1'+s.root+'/appearance-settings')).status()).toBe(404);
  const anonymous=await browser.newContext({baseURL});try{
    const pubPage=await anonymous.newPage();await pubPage.goto('/shops/'+slug);await expect(pubPage.locator('body')).not.toHaveAttribute('data-store-appearance');
    await expect(pubPage.locator('.shop-announcement,.shop-merchant-logo,.shop-featured,.shop-cover')).toHaveCount(0);
    await expect(pubPage.locator('.shop-products-list')).toHaveCount(1);await expect(pubPage.locator('footer .shop-logo')).toHaveAttribute('src','/brand/freedom-workshop.webp');
    for(const width of [390,768,1440]){
      await page.setViewportSize({width,height:900});await captureOffer(page,page.locator('.hosted-store'),info.outputPath('appearance-off-editor-'+width+'.png'));
      await pubPage.setViewportSize({width,height:900});await pubPage.screenshot({path:info.outputPath('appearance-off-public-'+width+'.png'),fullPage:true});
      expect(await pubPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      for(const [target,label] of [[page.locator('.hosted-store'),'editor'],[pubPage.locator('body'),'public']] as const){
        const controls=await target.locator('.btn,.shop-button').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {
          text:node.textContent?.trim(),width:box.width,height:box.height,parentWidth:node.parentElement!.getBoundingClientRect().width,primary:node.classList.contains('btn-primary')};
        }).filter(box=>box.width>0&&box.height>0));
        for(const box of controls){expect(box.height,box.text).toBeGreaterThanOrEqual(44);if(!box.primary)expect(box.width,box.text).toBeLessThan(box.parentWidth-1);}
        await info.attach('appearance-off-'+label+'-'+width+'-geometry',{body:JSON.stringify({width,controls}),contentType:'application/json'});
      }
    }
    await pubPage.setViewportSize({width:320,height:900});expect(await pubPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await anonymous.close();}
  expect((await e2eAuthPool.query('SELECT count(*)::int n FROM commerce_publication_appearances WHERE publication_id=$1',[pub])).rows[0].n).toBe(1);
});
