import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {test,expect,type Page} from './fixtures.js';
import {openCartListener} from './storefront-cart-fixture.js';
import {apiLogin} from './hosted-order-fixture.js';
import {person,launchStore,post,storeArea} from './hosted-store-fixture.js';
import {verifyPassword} from './seller-console-fixture.js';
import {E2E_AUTHOR_CLAIM_ADMIN_TOKEN,E2E_AUTHOR_CLAIM_ADMIN_EMAIL} from '../../packages/testing/e2e-admin.js';
import {assertCommerceReadinessPrivacy} from '../../packages/testing/commerce-readiness-privacy.js';
import {EXPERIENCE_PROFILES} from '../../apps/portal-web/src/experience-profiles.js';
import {DEMO_PASSWORD} from '../../packages/testing/seed.js';

async function screenshots(page:Page,selector:string,path:(width:number)=>string){
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 for(const width of [390,768,1440]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const metrics=await page.locator(selector+' .actions > .btn:visible').evaluateAll(buttons=>buttons.map(button=>({height:button.getBoundingClientRect().height,width:button.getBoundingClientRect().width,parent:button.parentElement!.getBoundingClientRect().width})));
  for(const metric of metrics){expect(metric.height).toBeGreaterThanOrEqual(44);expect(metric.width).toBeLessThanOrEqual(metric.parent+1);}
  await expect(page.locator(selector+' .readiness-state:visible').first()).toBeVisible();
  if(selector==='.admin-store-admissions'){
   expect(await page.locator(selector+' .readiness-state').evaluateAll(elements=>elements.every(element=>{
    element.scrollIntoView({block:'center'});const box=element.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);return !!hit&&element.contains(hit);
   }))).toBe(true);
   // Keep the real 900px viewport checks above; fit the isolated tab capture
   // above the legacy fixed message dock without hiding any page elements.
   const height=await page.locator(selector).evaluate(element=>Math.ceil(element.getBoundingClientRect().height)+100);
   await page.setViewportSize({width,height:Math.max(900,height)});
   await page.locator(selector).screenshot({path:path(width)});
  }else await page.screenshot({path:path(width),fullPage:true});
 }
}

async function badgeContrast(page:Page,selector:string){
 const measurements=await page.evaluate(({selector,profiles})=>{
  const root=document.documentElement,original={theme:root.dataset.theme,experienceProfile:root.dataset.experienceProfile,guideSkin:root.dataset.guideSkin};
  const host=document.querySelector(selector+' .commerce-readiness')??document.querySelector(selector)!;
  const probes=document.createElement('div');host.append(probes);
  const luminance=(rgb:string)=>rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(channel=>{const s=channel/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const result=[];
  try{
   for(const profile of profiles){
    root.dataset.theme=profile.baseTheme;root.dataset.experienceProfile=profile.id;if(profile.skin)root.dataset.guideSkin=profile.skin;else delete root.dataset.guideSkin;
    for(const state of ['done','missing','upgrade_required','not_offered','not_admitted','revoked','paused']){
     const badge=document.createElement('span');badge.className='badge readiness-state';badge.dataset.state=state;badge.textContent='完成';probes.append(badge);
     const style=getComputedStyle(badge),color=style.color,background=style.backgroundColor,a=luminance(color),b=luminance(background);
     result.push({theme:profile.id,state,color,background,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});badge.remove();
    }
   }
  }finally{probes.remove();for(const [key,value] of Object.entries(original)){if(value===undefined)delete root.dataset[key];else root.dataset[key]=value;}}
  return result;
 },{selector,profiles:Object.values(EXPERIENCE_PROFILES)});
 for(const measurement of measurements)expect(measurement.contrast,`${selector} ${measurement.theme} ${measurement.state}`).toBeGreaterThanOrEqual(4.5);
 return measurements;
}

test('owner setup, independent admin admission, safe scope receipt and immediate revocation through the normal UI',async({browser,e2eAuthPool},info)=>{
 const listener=await openCartListener(e2eAuthPool,true,{realAdmission:true,adminAccess:true,supplierConsoleEnabled:false});
 const ownerContext=await browser.newContext({baseURL:listener.origin,viewport:{width:1440,height:900}}),adminContext=await browser.newContext({baseURL:listener.origin,extraHTTPHeaders:{'Cf-Access-Jwt-Assertion':E2E_AUTHOR_CLAIM_ADMIN_TOKEN}}),buyerContext=await browser.newContext({baseURL:listener.origin});
 try{
  for(const context of [ownerContext,adminContext,buyerContext]){
   await context.route('**/*',route=>new URL(route.request().url()).origin===listener.origin?route.fallback():route.abort());
   await context.addInitScript(()=>localStorage.setItem('freedom-theme','light'));
  }
  const owner=await person(e2eAuthPool),page=await ownerContext.newPage(),admin=await adminContext.newPage(),buyer=await buyerContext.newPage();
  await apiLogin(ownerContext,listener.origin,owner.email);await page.goto('/#stores');
  // Fixture establishes only the store and own-stock product. Publication,
  // public information, payment, delivery and admission are the UI actions below.
  const store=await launchStore(page,'合成開店準備空間'),slug='ready-'+randomUUID().slice(0,12);
  await post(page,store.root+'/setup',{name:'合成開店準備商店',slug,currency:'TWD'},201);
  const product=await post(page,store.root+'/products',{title:'合成自有商品',price_minor:10000,stock:5},201);
  const coordinates=store.hash.split('/'),tenant=coordinates[1],instance=coordinates[2],overview='#'+store.hash+'/overview';
  await page.goto('/'+overview);
  const readiness=page.locator('.commerce-readiness'),row=(key:string)=>readiness.locator(`[data-readiness="${key}"]`);
  await expect(readiness.getByRole('heading',{name:'開店準備',exact:true})).toBeVisible();
  for(const key of ['storefront','products','store_information','payment','delivery'])await expect(row(key).getByText('待完成',{exact:true})).toBeVisible();
  await expect(row('admission')).toContainText('不需要另外申請');
  await expect(row('payment').getByRole('link',{name:'前往收款設定',exact:true})).toHaveAttribute('href','#'+store.hash+'/settings/payments');
  await row('store_information').getByRole('link',{name:'前往商店首頁',exact:true}).click();
  await storeArea(page,'商店資料');const form=page.getByRole('form',{name:'商店資料',exact:true});
  await form.getByRole('textbox',{name:'商店介紹',exact:true}).fill('合成公開服務說明：請先約定面交時間；交付與售後由店主處理。');
  await form.getByRole('button',{name:'儲存商店資料',exact:true}).click();
  await expect(page.locator('.hosted-store').getByRole('status')).toContainText('已儲存。');
  await storeArea(page,'店面與發布');await page.getByRole('button',{name:'發布展示頁',exact:true}).click();
  await expect(page.locator('.hosted-store').getByRole('status')).toContainText('已發布・第 1 版');
  await page.getByRole('link',{name:'開店準備',exact:true}).click();
  for(const key of ['storefront','products','store_information'])await expect(row(key).getByText('完成',{exact:true})).toBeVisible();
  await row('payment').getByRole('link',{name:'前往收款設定',exact:true}).click();
  await page.getByRole('button',{name:'編輯線下收款設定',exact:true}).click();const payment=page.getByRole('form',{name:'線下收款設定',exact:true});
  const account='000000123456',accountName='合成測試商店',branch='合成測試分行';
  await payment.getByLabel('提供銀行匯款',{exact:true}).check();await payment.getByLabel('銀行代碼',{exact:true}).fill('000');await payment.getByLabel('銀行名稱',{exact:true}).fill('合成測試銀行');await payment.getByLabel('收款帳號',{exact:true}).fill(account);await payment.getByLabel('戶名',{exact:true}).fill(accountName);await payment.getByLabel('提供面交現金付款',{exact:true}).check();
  await payment.getByLabel('分行（選填）',{exact:true}).fill(branch);
  await payment.getByRole('button',{name:'儲存線下收款設定',exact:true}).click();await verifyPassword(page,DEMO_PASSWORD);await expect(payment).toHaveCount(0);
  await page.getByRole('button',{name:'編輯面交取貨設定',exact:true}).click();const delivery=page.getByRole('form',{name:'面交取貨設定',exact:true});
  await delivery.getByLabel('提供面交取貨',{exact:true}).check();await delivery.getByLabel('面交地區與時段',{exact:true}).fill('請先約定面交時間。');await delivery.getByRole('button',{name:'儲存面交取貨設定',exact:true}).click();await expect(delivery).toHaveCount(0);
  await page.goto('/'+overview);for(const key of ['payment','delivery'])await expect(row(key).getByText('完成',{exact:true})).toBeVisible();
  await expect(row('admission').getByText('等待平台',{exact:true})).toBeVisible();await expect(readiness).toContainText('開店設定已備妥，等待平台確認後才能接受結帳訂單。');
  await buyer.goto(`/shops/${slug}/products/${product.sku}`);await expect(buyer.getByRole('button',{name:'加入購物車',exact:true})).toHaveCount(0);
  await screenshots(page,'.seller-console',width=>info.outputPath(`overview-light-${width}.png`));
  const sellerContrast=await badgeContrast(page,'.seller-console');
  await admin.goto('/admin');await admin.getByRole('button',{name:'商店准入',exact:true}).click();
  const card=admin.locator(`[data-store-instance="${instance}"]`);await expect(card).toContainText('合成開店準備商店');
  await card.getByRole('button',{name:'准入',exact:true}).click();await expect(card).toContainText('准入後，只要其他條件都成立，這間店就能接受新訂單。');await card.getByLabel('操作理由',{exact:true}).fill('合成範圍核對與獨立管理員確認');await card.getByRole('button',{name:'確認准入',exact:true}).click();await expect(card.getByText('准入：有效',{exact:true})).toBeVisible();
  const admitted=(await e2eAuthPool.query('SELECT admission_id FROM commerce_store_admissions WHERE tenant_id=$1 AND instance_id=$2 AND revoked_at IS NULL',[tenant,instance])).rows;expect(admitted).toHaveLength(1);
  expect((await e2eAuthPool.query("SELECT 1 FROM platform_admin_audit WHERE target_type='commerce_store_admission' AND target_ref=$1",[admitted[0].admission_id])).rowCount).toBe(1);
  await page.getByRole('button',{name:/更新資料\s*：開店準備/}).click();await expect(readiness).toContainText('目前已開放接單；買家可依商店設定結帳。');await buyer.reload();await expect(buyer.getByRole('button',{name:'加入購物車',exact:true})).toBeVisible();
  await expect(admin.getByText('收據含租戶與商店名稱、准入與撤銷理由、識別碼、版本與設定狀態；不含聯絡資料、會員信箱、銀行帳號／戶名或憑證狀態。這是內部管理紀錄，請勿公開分享。',{exact:true})).toBeVisible();
  const downloaded=admin.waitForEvent('download');await admin.getByRole('button',{name:'下載範圍收據（JSON）',exact:true}).click();const download=await downloaded;expect(download.suggestedFilename()).toMatch(/^commerce-scope-sandbox-\d{8}T\d{6}Z\.json$/);await download.saveAs(info.outputPath('scope-receipt.json'));
  const stream=await download.createReadStream();expect(stream).not.toBeNull();let json='';for await(const chunk of stream!)json+=chunk.toString();const receipt=JSON.parse(json);
  expect(receipt.schema).toBe('freedom.commerce-scope-receipt/v1');const entry=receipt.items.find((item:{instance_id:string})=>item.instance_id===instance);expect(entry.tenant_id).toBe(tenant);expect(entry.admission.active.admission_id).toBe(admitted[0].admission_id);
  const memberEmails=(await e2eAuthPool.query('SELECT u.email FROM tenant_memberships m JOIN principals p ON p.principal_id=m.principal_id JOIN users u ON u.user_id=p.user_ref WHERE m.tenant_id=$1',[tenant])).rows.map(row=>row.email as string);
  assertCommerceReadinessPrivacy(json,[account,accountName,branch,owner.email,E2E_AUTHOR_CLAIM_ADMIN_EMAIL,...memberEmails]);
  await screenshots(admin,'.admin-store-admissions',width=>info.outputPath(`admin-admissions-light-${width}.png`));
  await writeFile(info.outputPath('badge-contrast.json'),JSON.stringify({seller:sellerContrast,admin:await badgeContrast(admin,'.admin-store-admissions')},null,2));
  await card.getByRole('button',{name:'撤銷准入',exact:true}).click();await expect(card).toContainText('撤銷後立即停止新訂單；已成立的訂單照常完成。');await card.getByLabel('操作理由',{exact:true}).fill('合成撤銷驗證');await card.getByRole('button',{name:'確認撤銷准入',exact:true}).click();await expect(card.getByText('准入：已撤銷',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/更新資料\s*：開店準備/}).click();await expect(row('admission')).toContainText('平台已暫停這間店接受新訂單；已成立的訂單照常處理。');await buyer.reload();await expect(buyer.getByRole('button',{name:'加入購物車',exact:true})).toHaveCount(0);
  const rejected=await buyer.request.post(`/api/v1/public/stores/${slug}/checkouts`,{headers:{Origin:listener.origin,'Idempotency-Key':randomUUID()},data:{publication_revision:'1',lines:[{sku:product.sku,quantity:1}],contact:{name:'合成買家',email:'synthetic@example.invalid',phone:'0900000000'},delivery:{method:'meetup',name:'合成買家',mobile:'0900000000'},invoice:null,consents:[]}});expect(rejected.status()).toBe(409);expect((await rejected.json()).code).toBe('checkout_not_enabled');
 }finally{await ownerContext.close();await adminContext.close();await buyerContext.close();await listener.close();}
});
