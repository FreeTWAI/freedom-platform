import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import * as esbuild from 'esbuild';
import {chromium, type Page} from 'playwright';

// Exercise the real hooks with React in the same isolated browser style as photo state tests.
test('store page data and dirty hooks', {timeout:60_000}, async t => {
  const base=join(process.cwd(),'.rd');await mkdir(base,{recursive:true});
  const dir=await mkdtemp(join(base,'store-page-state-'));
  const entry=join(dir,'harness.tsx'),bundle=join(dir,'harness.js');
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try {
    await writeFile(entry,`import {createRoot} from 'react-dom/client';
import {useStorePageData} from '../../apps/portal-web/src/modules/hosted-store-page-state';
import {useStoreDirtyForms} from '../../apps/portal-web/src/modules/hosted-store-dirty-state';
import {ApiError} from '../../apps/portal-web/src/api';
import {emptySellerPolicies} from '../../contracts/guild-launchpad/v1/storefront-policies';
import {z} from 'zod';
const w=window,root='/store',id='10000000-0000-4000-8000-000000000001';
const preview={projection:{slug:'test-store',name:'Test',brand:null,description:'',currency:'TWD',products:[],revision:'1',published_at:'2026-10-24T00:00:00Z',transaction_state:'not_enabled'},dirty:true,current_revision:null};
w.fixture={
 '':{tenant_id:id,instance_id:id,instance_status:'active',setup_state:'ready',store:{slug:'test-store',name:'Test',brand:null,description:'',currency:'TWD',slug_locked:false},publication:{state:'never_published',current_revision:null,published_at:null,public_path:null},product_count:0,product_limit:200,transaction_state:'not_enabled',writable:true,capabilities:['store:publish'],version:'1'},
 '/products':{items:[],limit:200},'/preview':preview,
 '/appearance':{profile:'freedom.hosted-store-presentation/v1',template_id:'catalog-grid-v1',published_template_id:null,version:'1'},
 '/product-media':{profile:'freedom.hosted-store-media/v1',items:[]},
 '/appearance-settings':{profile:'freedom.hosted-store-appearance/v1',version:'1',template_id:'catalog-grid-v1',accent_preset:'lime',announcement:'',featured_product_ids:[],featured_products:[],eligible_products:[],has_supplied_products:false,cover:null,logo:null,media_installed:true,uploads_enabled:true,published_revision:null,dirty:true},
 '/seller-policies':{...emptySellerPolicies(),profile:'freedom.hosted-store-policies/v1',version:'1',dirty:true,has_supplied_products:false},
 '/product-galleries':{profile:'freedom.hosted-store-gallery/v1',items:[]},
 '/publication-review':{profile:'freedom.hosted-store-publication/v1',store_version:'1',preview,template_id:'catalog-grid-v1',photo_count:0,photos:[],review_digest:'a'.repeat(64)},
 '/reservation-setting':{reservation_enabled:false,admission_enabled:false,version:'1'}
};
w.signals=[];w.calls=[];w.errors={};w.gates={};w.writes=[];w.writeErrors=[];w.notices=[];w.conflicts=0;w.confirmResult=false;w.confirmations=[];
w.confirm=message=>{w.confirmations.push(message);return w.confirmResult;};
const failure=e=>e==='plain'?Error('synthetic'):new ApiError(e);
const client={get:async(path,options)=>{const key=path.slice(root.length);w.calls.push({key,aborted:options.signal.aborted});w.signals.push(options.signal);if(w.gates[key])await new Promise(resolve=>w.gates[key]=resolve);if(w.errors[key])throw failure(w.errors[key]);return structuredClone(w.fixture[key]);},
 patch:async(path,body,options)=>{w.writes.push({path,body,key:options.idempotencyKey,version:options.ifMatch});const e=w.writeErrors.shift();if(e)throw failure(e);return w.writeResult??{ok:true};}};
if(w.setup)new Function('w',w.setup)(w);
w.options={photosEnabled:true,appearanceEnabled:true,policiesEnabled:true,galleryEnabled:true,...w.initialOptions};
const registerLeave=guard=>{w.guard=guard;};
function Screen(){
 const data=useStorePageData({client,root,...w.options,onConflict:()=>w.conflicts++});
 const dirty=useStoreDirtyForms({client,root,registerLeave,...data,announce:text=>w.notices.push(text)});
 w.state={...data,...dirty};
 w.send=()=>data.command({method:'patch',path:root+'/products',body:{title:'same draft'},version:'1',schema:z.object({ok:z.literal(true)}),success:()=>w.successes=(w.successes??0)+1,notice:'saved',product:true});
 return null;
}
const app=createRoot(document.getElementById('root'));w.unmount=()=>app.unmount();app.render(<Screen/>);`);
    await esbuild.build({entryPoints:[entry],outfile:bundle,bundle:true,format:'iife',platform:'browser',jsx:'automatic'});
    const script=await readFile(bundle,'utf8');
    browser=await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{});
    async function screen(initialOptions:Record<string,boolean>={},init?:string) {
      const page=await browser!.newPage();
      await page.route('http://127.0.0.1:14326/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
      await page.goto('http://127.0.0.1:14326/');
      await page.evaluate(({options,setup})=>{(window as any).initialOptions=options;(window as any).setup=setup;},{options:initialOptions,setup:init});
      // Test configuration is applied before effects begin, after the fixture exists.
      await page.addScriptTag({content:script});
      await page.waitForFunction(()=>!!(window as any).state);
      return page;
    }
    const settled=(page:Page)=>page.waitForFunction(()=>!(window as any).state.loading);
    const snapshot=(page:Page)=>page.evaluate(()=>{const s=(window as any).state;return {error:s.error,missing:s.missing,loading:s.loading,view:s.view,appearanceDraft:s.appearanceDraft,policiesDraft:s.policiesDraft,appearanceError:s.appearanceError,policiesError:s.policiesError,review:s.publicationReview,refresh:s.distributionRefresh};});
    await t.test('load keeps root first, parallel reads in order, reservation last and one shared signal',async()=>{
      const page=await screen({},"w.gates['/products']=true");try {
        await page.waitForFunction(()=>(window as any).calls.length===9);
        assert.deepEqual(await page.evaluate(()=>(window as any).calls.map((c:any)=>c.key)),['','/products','/preview','/appearance','/product-media','/appearance-settings','/seller-policies','/product-galleries','/publication-review']);
        assert.equal((await snapshot(page)).loading,true);
        await page.evaluate(()=>(window as any).gates['/products']());await settled(page);
        const s=await snapshot(page);assert.equal(s.error,'');assert.equal(s.refresh,1);assert.ok(s.review);assert.ok(s.appearanceDraft);assert.ok(s.policiesDraft);
        assert.equal(await page.evaluate(()=>(window as any).calls.at(-1).key),'/reservation-setting');
        assert.equal(await page.evaluate(()=>new Set((window as any).signals).size),1);
        await page.evaluate(()=>(window as any).unmount());assert.equal(await page.evaluate(()=>(window as any).signals.every((signal:AbortSignal)=>signal.aborted)),true);
      }finally{await page.close();}
    });
    await t.test('flags off and no publish capability omit only their conditional reads',async()=>{
      const page=await screen({photosEnabled:false,appearanceEnabled:false,policiesEnabled:false,galleryEnabled:false},"w.fixture[''].capabilities=[]");try{await settled(page);assert.equal((await snapshot(page)).error,'');
        assert.deepEqual(await page.evaluate(()=>(window as any).calls.map((c:any)=>c.key)),['','/products','/preview','/appearance','/reservation-setting']);
      }finally{await page.close();}
    });
    await t.test('setup required reads only root and clears optional drafts',async()=>{
      const page=await screen({},"w.fixture[''].setup_state='setup_required';w.fixture[''].store=null");try{await settled(page);assert.equal((await snapshot(page)).error,'');assert.equal(await page.evaluate(()=>(window as any).calls.length),1);assert.equal((await snapshot(page)).policiesDraft,null);}finally{await page.close();}
    });
    await t.test('sidecar failures retain saved drafts; reservation 403/404 are optional',async()=>{
      const page=await screen();try{await settled(page);const before=await snapshot(page);
        for(const status of [403,404]){await page.evaluate(async status=>{const w=window as any;w.errors={'/appearance-settings':{status:500},'/seller-policies':'plain','/reservation-setting':{status}};await w.state.load();},status);await settled(page);
          const after=await snapshot(page);assert.equal(after.error,'');assert.equal(after.appearanceError,true);assert.equal(after.policiesError,true);assert.deepEqual(after.appearanceDraft,before.appearanceDraft);assert.deepEqual(after.policiesDraft,before.policiesDraft);}
      }finally{await page.close();}
    });
    await t.test('404 mapping respects immediate photo blockers; validation and generic errors preserve messages and throwOnError',async()=>{
      const page=await screen();try{await settled(page);
        await page.evaluate(async()=>{const w=window as any;w.state.setPhotoBlocking('p',true);w.errors['']={status:404,message:'Missing'};await w.state.load();});
        assert.equal((await snapshot(page)).missing,false);assert.match((await snapshot(page)).error,/Missing 請重新載入後再試一次。/);
        await page.evaluate(async()=>{const w=window as any;w.errors['']={status:422,code:'validation_failed'};await w.state.load();});assert.equal((await snapshot(page)).error,'有欄位格式不符，請檢查後再送出。');
        const thrown=await page.evaluate(async()=>{const w=window as any;w.errors['']='plain';try{await w.state.load({throwOnError:true});return false;}catch{return true;}});assert.equal(thrown,true);assert.equal((await snapshot(page)).error,'暫時無法確認回應。請重新載入後再試一次。');
        await page.evaluate(async()=>{const w=window as any;w.state.setPhotoBlocking('p',false);w.errors['']={status:404};await w.state.load();});assert.equal((await snapshot(page)).missing,true);
      }finally{await page.close();}
    });
    await t.test('failed load can retry, and an older load never replaces a newer one',async()=>{
      const page=await screen({},"w.errors['']={status:500,message:'Unavailable',code:'capability_denied'}");try{await settled(page);assert.equal((await snapshot(page)).error,'Unavailable 請聯絡業務空間擁有者確認你的權限。');
        await page.evaluate(async()=>{const w=window as any;w.errors={};await w.state.load();});assert.equal((await snapshot(page)).error,'');
        await page.evaluate(()=>{const w=window as any;w.gates['']=true;w.oldLoad=w.state.load();});await page.waitForFunction(()=>typeof (window as any).gates['']==='function');
        await page.evaluate(async()=>{const w=window as any;const release=w.gates[''];delete w.gates[''];await w.state.load();w.fixture[''].store.name='stale';release();await w.oldLoad;});assert.equal((await snapshot(page)).view.store.name,'Test');
      }finally{await page.close();}
    });
    await t.test('unknown write and malformed ACK retain original retry key/body/version, then refresh after success',async()=>{
      for(const malformed of [false,true]){const page=await screen();try{await settled(page);
        await page.evaluate(async malformed=>{const w=window as any;if(malformed)w.writeResult={};else w.writeErrors=[{network:true}];await w.send();},malformed);
        assert.equal(await page.evaluate(()=>(window as any).state.retry!==null),true);assert.equal(await page.evaluate(()=>(window as any).state.held.current!==null),true);
        assert.equal(await page.evaluate(()=>(window as any).state.busy),false);
        await page.evaluate(async()=>{const w=window as any;w.writeResult={ok:true};await w.state.send(w.state.retry);});
        const writes=await page.evaluate(()=>(window as any).writes);assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
        assert.equal(await page.evaluate(()=>(window as any).state.retry),null);assert.equal(await page.evaluate(()=>(window as any).successes),1);assert.equal((await snapshot(page)).refresh,2);
      }finally{await page.close();}}
    });
    await t.test('known version conflict clears editors through callback and reloads without retaining retry',async()=>{
      const page=await screen();try{await settled(page);await page.evaluate(async()=>{const w=window as any;w.writeErrors=[{status:412}];await w.send();});assert.equal(await page.evaluate(()=>(window as any).conflicts),1);assert.equal((await snapshot(page)).refresh,2);assert.equal(await page.evaluate(()=>(window as any).state.retry),null);}finally{await page.close();}
    });
    await t.test('dirty tracking, registered guard and beforeunload follow current refs and clean up on unmount',async()=>{
      const page=await screen();try{await settled(page);
        assert.equal(await page.evaluate(()=>(window as any).guard(null)),true);
        await page.evaluate(()=>{const w=window as any;w.state.markDirty('photo/p',true);w.state.markDirty('settings',true);});
        await page.waitForFunction(()=>(window as any).state.hasFormDraft);
        assert.equal(await page.evaluate(()=>(window as any).guard(null)),false);
        assert.deepEqual(await page.evaluate(()=>(window as any).confirmations),['還有尚未儲存的內容，要離開嗎？']);
        assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
        await page.evaluate(()=>{const w=window as any;w.confirmResult=true;w.state.markDirty('settings',false);});await page.waitForFunction(()=>!(window as any).state.hasFormDraft);
        assert.equal(await page.evaluate(()=>(window as any).state.hasDraft),true);assert.equal(await page.evaluate(()=>(window as any).guard(null)),true);
        for(const [key,text] of [['policies','賣方資訊與商店政策操作尚未確認，請先重試原操作。'],['appearance','外觀操作尚未確認，請先重試原操作。'],['variants','規格操作尚未確認，請先重試原操作。'],['categories','暫時無法確認儲存結果，請用原操作重試。'],['p','照片操作尚未確認，請先重試原照片操作。']]){
          assert.equal(await page.evaluate(key=>{const w=window as any;w.state.photoBlockRef.current={[key]:true};return w.guard(null);},key),false);assert.equal(await page.evaluate(()=>(window as any).notices.at(-1)),text);
        }
        for(const busy of [true,false]){assert.equal(await page.evaluate(busy=>{const w=window as any;w.state.photoBlockRef.current={};w.state.busyRef.current=busy;w.state.held.current={};return w.guard(null);},busy),false);assert.equal(await page.evaluate(()=>(window as any).notices.at(-1)),busy?'正在確認原操作，請等候完成後再離開。':'尚未確認原操作的結果，請按「重試」確認後再離開。');}
        await page.evaluate(()=>{const w=window as any;w.state.busyRef.current=false;w.state.held.current=null;w.state.markDirty('photo/p',false);});await page.waitForFunction(()=>!(window as any).state.hasDraft);
        assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),false);
        await page.evaluate(()=>(window as any).unmount());assert.equal(await page.evaluate(()=>(window as any).guard),null);
        assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),false);
      }finally{await page.close();}
    });
  } finally {await browser?.close();await rm(dir,{recursive:true,force:true});}
});
