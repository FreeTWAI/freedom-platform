import {test,expect} from './fixtures.js';
import {person,login,launchStore,post,open} from './hosted-store-fixture.js';
import {randomUUID} from 'node:crypto';

test('gallery defaults OFF and the editor makes no gallery request',async({page,e2eAuthPool})=>{
 const site=await(await page.request.get('/api/v1/site')).json();expect(site.store_gallery_enabled).toBe(false);
 const requests:string[]=[];page.on('request',r=>{if(/product-galleries|\/gallery(?:\/|$)/.test(new URL(r.url()).pathname))requests.push(r.url());});
 const member=await person(e2eAuthPool);await login(page,member.email);const store=await launchStore(page,'合成關閉圖組工作室');await post(page,store.root+'/setup',{name:'合成關閉圖組商店',slug:'gallery-off-'+randomUUID().slice(0,8),currency:'TWD'},201);await post(page,store.root+'/products',{title:'合成商品',price_minor:100,stock:1},201);await open(page,store.hash);
 await expect(page.locator('.hosted-store-product')).toBeVisible();await expect(page.locator('.hosted-gallery')).toHaveCount(0);expect(requests).toEqual([]);
 expect((await page.request.get('/api/v1'+store.root+'/product-galleries')).status()).toBe(404);
});
test('gallery media suffixes keep the exact host SPA fallback while OFF',async({request})=>{
 const base=await request.get('/synthetic-gallery-fallback');expect(base.status()).toBe(200);const html=await base.body();
 for(const path of ['/shops/synthetic-gallery/media/1/P0001/1','/shops/synthetic-gallery/media/1/P0001/9','/shops/synthetic-gallery/media/1/P0001/unknown/suffix']){
  const response=await request.get(path);expect(response.status()).toBe(200);expect(await response.body()).toEqual(html);expect(response.headers()['content-type']).toContain('text/html');
 }
});
