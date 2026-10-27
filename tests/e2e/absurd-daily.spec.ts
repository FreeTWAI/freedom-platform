import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import type {RunResult} from '../../apps/portal-web/src/games/result-card.js';
import {test,expect,type Page,type Route} from './fixtures.js';
import {navigate} from './navigation.js';
import {cashDeck,stampTarget} from '../../apps/portal-web/src/games/domain.js';
import {chairWave,holidayTargets} from '../../apps/portal-web/src/games/party/domain.js';
import {PARTY_GAMES,PARTY_RULES as PT,type PartyGameId} from '../../apps/portal-web/src/games/party/catalog.js';
import {GAME_HANDOFF_EVENT,GAME_HANDOFF_KEY,type GameDraft} from '../../apps/portal-web/src/games/result-bridge.js';
import {marketGrade,MARKET_SAVE_KEY,type MarketRun,type MarketId} from '../../apps/portal-web/src/games/cooking/market-domain.js';
const {PerspectiveCamera,Vector3}=createRequire(new URL('../../apps/portal-web/package.json',import.meta.url))('three');

// Proposed E2E-only injection; no product module imports or production telemetry.
// Records timing/category/dimensions only, never image contents or user strings.
function installExportTimingProbe(){
  type Event={phase:string;at:number;id?:number;width?:number;height?:number;kind?:string};
  const events:Event[]=[];let dropped=0,sequence=0;
  const record=(event:Omit<Event,'at'>)=>{if(events.length<128)events.push({...event,at:performance.now()});else dropped++;};
  Object.defineProperty(window,'__exportTimingProbe',{value:{events,get dropped(){return dropped;}}});
  const imageSrc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')!;
  Object.defineProperty(HTMLImageElement.prototype,'src',{...imageSrc,set(value:string){
    const id=++sequence,kind=value.startsWith('data:image/')?'data-image':value.startsWith('blob:')?'blob-image':'other-image';
    record({phase:'image-src',id,kind});
    const finish=(phase:string)=>{this.removeEventListener('load',loaded);this.removeEventListener('error',failed);record({phase,id,width:this.naturalWidth,height:this.naturalHeight,kind});};
    const loaded=()=>finish('image-load'),failed=()=>finish('image-error');
    this.addEventListener('load',loaded);this.addEventListener('error',failed);imageSrc.set!.call(this,value);
  }});
  const toBlob=HTMLCanvasElement.prototype.toBlob,toDataURL=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){
    const id=++sequence;record({phase:'blob-start',id,width:this.width,height:this.height,kind:type??'image/png'});
    return toBlob.call(this,function(blob){record({phase:blob?'blob-done':'blob-null',id});callback(blob);},type,quality);
  };
  HTMLCanvasElement.prototype.toDataURL=function(type,quality){
    const id=++sequence;record({phase:'data-url-start',id,width:this.width,height:this.height,kind:type??'image/png'});
    try{return toDataURL.call(this,type,quality);}finally{record({phase:'data-url-end',id});}
  };
  let dish='',download=false;
  const observer=new MutationObserver(()=>{
    const next=document.querySelector('[data-dish-view]')?.getAttribute('data-dish-view')??'';
    if(next!==dish){dish=next;record({phase:`dish-${next||'absent'}`});}
    const available=!!document.querySelector('.ad-result a[download][href^="blob:"]');
    if(available!==download){download=available;record({phase:available?'download-published':'download-removed'});}
  });
  observer.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-dish-view','href']});
}

test.afterEach(async({page},testInfo)=>{
  if(testInfo.title!=='UX-15c: completed guided export survives development StrictMode replay and production cold reload')return;
  const probe=await page.evaluate(()=>{
    const value=(window as unknown as {__exportTimingProbe?:{events:unknown[];dropped:number}}).__exportTimingProbe;
    return value?{events:value.events,dropped:value.dropped,scope:'current production document only; DOM times are observer delivery, not exact mutation time'}:null;
  }).catch(()=>null);
  if(probe)await testInfo.attach('export-phase-timings',{body:JSON.stringify(probe),contentType:'application/json'});
});

async function checkResultRetryOwnership(page:Page,result:RunResult){
  // Bundle the complete actual module, exposing its private Result only inside
  // this existing isolated fixture. Product exports and production build stay unchanged.
  const source=readFileSync(new URL('../../apps/portal-web/src/games/AbsurdDaily.tsx',import.meta.url),'utf8');
  const script=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../../apps/portal-web/src/games/',import.meta.url)),loader:'tsx',contents:source+`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    const NativeImage=window.Image,loads=[],jpegLoads=[],createdUrls=[],revokedUrls=[],shared=[];
    const oldCanShare=Object.getOwnPropertyDescriptor(navigator,'canShare'),oldShare=Object.getOwnPropertyDescriptor(navigator,'share');
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{shared.push(payload);}});
    const nativeToBlob=HTMLCanvasElement.prototype.toBlob,nativeCreate=URL.createObjectURL,nativeRevoke=URL.revokeObjectURL;
    URL.createObjectURL=function(blob){const url=nativeCreate.call(URL,blob);createdUrls.push(url);return url;};
    URL.revokeObjectURL=function(url){revokedUrls.push(url);return nativeRevoke.call(URL,url);};
    HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){
      if(type!=='image/jpeg')return nativeToBlob.call(this,callback,type,quality);
      const entry={ready:false,released:false,blob:null,deliver:null,fail:null};jpegLoads.push(entry);
      return nativeToBlob.call(this,blob=>{entry.ready=!!blob;entry.blob=blob;entry.deliver=()=>{if(!entry.ready||entry.released)throw Error('JPEG not pending');entry.released=true;callback(blob);};entry.fail=()=>{if(!entry.ready||entry.released)throw Error('JPEG cannot fail');entry.released=true;callback(null);};},type,quality);
    };
    function HeldImage(width,height){
      const image=new NativeImage(width,height),entry={ready:false,released:false,cancelled:false,deliver:null,fail:null};
      loads.push(entry);let loaded=null,failed=null;
      Object.defineProperty(image,'onload',{configurable:true,get:()=>loaded,set:value=>{if(value===null&&loaded&&!entry.released)entry.cancelled=true;loaded=value;}});
      Object.defineProperty(image,'onerror',{configurable:true,get:()=>failed,set:value=>{failed=value;if(value)entry.fail=()=>{entry.released=true;value.call(image,new Event('error'));};}});
      image.addEventListener('load',event=>{
        entry.ready=image.naturalWidth>0&&image.naturalHeight>0;
        entry.deliver=()=>{if(!entry.ready||entry.released||!loaded)throw Error('Result image is not pending');entry.released=true;loaded.call(image,event);};
        // Deliberate error delivery tests rejection ownership, not failed native decoding.
        const failure=failed;entry.fail=()=>{if(!entry.ready||entry.released||!failure)throw Error('Result image cannot reject');entry.released=true;failure.call(image,new Event('error'));};
      });return image;
    }
    HeldImage.prototype=NativeImage.prototype;Object.setPrototypeOf(HeldImage,NativeImage);window.Image=HeldImage;
    const root=createRoot(document.getElementById('root'));let mounted=true;
    const original=${JSON.stringify(result)},fixture={...original,game:'photo',photos:[
      {image:original.image,stars:1,caption:'第一張',details:'原始成果'},
      {image:original.image,stars:2,caption:'第二張',details:'另一個選擇'}]};
    window.resultRetryProbe={loads,jpegLoads,createdUrls,revokedUrls,shared,release:index=>loads[index].deliver(),fail:index=>loads[index].fail(),
      releaseJpeg:index=>jpegLoads[index].deliver(),failJpeg:index=>jpegLoads[index].fail(),
      unmount:()=>{if(!mounted)return;mounted=false;root.unmount();},
      restore:()=>{window.Image=NativeImage;HTMLCanvasElement.prototype.toBlob=nativeToBlob;URL.createObjectURL=nativeCreate;URL.revokeObjectURL=nativeRevoke;if(oldCanShare)Object.defineProperty(navigator,'canShare',oldCanShare);else delete navigator.canShare;if(oldShare)Object.defineProperty(navigator,'share',oldShare);else delete navigator.share;}};
    root.render(<React.StrictMode><Result result={fixture} onBack={()=>{}} onReplay={()=>{}} onNext={()=>{}}/></React.StrictMode>);
  `},bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
  await page.addScriptTag({content:script});
  type Probe={shared:{files:File[]}[];loads:{ready:boolean;released:boolean;cancelled:boolean}[];jpegLoads:{ready:boolean;released:boolean;blob:Blob|null}[];createdUrls:string[];revokedUrls:string[];releaseJpeg:(index:number)=>void;failJpeg:(index:number)=>void;release:(index:number)=>void;fail:(index:number)=>void;unmount:()=>void;restore:()=>void};
  const loads=()=>page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.loads.map(x=>({ready:x.ready,released:x.released,cancelled:x.cancelled})));
  const retry=page.getByRole('button',{name:'重試產生成果圖',exact:true});
  try{
    await expect.poll(loads).toEqual([{ready:false,released:false,cancelled:true},{ready:true,released:false,cancelled:false}]);
    await expect(retry).toBeDisabled();
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.fail(0));
    await expect(retry).toBeDisabled();
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.fail(1));
    await expect(retry).toBeEnabled();
    await retry.evaluate(button=>{button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
    await expect.poll(loads).toEqual([{ready:false,released:true,cancelled:true},{ready:true,released:true,cancelled:false},{ready:true,released:false,cancelled:false}]);
    await expect(retry).toBeDisabled();
    await page.locator('.ad-photo-choices button').nth(1).click();
    await expect.poll(async()=>(await loads()).length).toBe(4);
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.fail(2));
    await expect(retry).toBeDisabled();
    await expect.poll(async()=>(await loads())[3]).toEqual({ready:true,released:false,cancelled:false});
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.release(3));
    const download=page.getByRole('link',{name:'下載完整成果 PNG',exact:true});await expect(download).toBeVisible();
    const event=page.waitForEvent('download');await download.click();
    const downloaded=readFileSync((await (await event).path())!);const metadata=await sharp(downloaded).metadata();expect([metadata.format,metadata.width,metadata.height]).toEqual(['png',960,1200]);
    const workshop=page.getByRole('button',{name:'發到自由工坊',exact:true});await expect(workshop).toBeDisabled();
    await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();
    const shared=await page.evaluate(async()=>{const file=(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.shared[0].files[0];return {name:file.name,type:file.type,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))};});
    expect([shared.name,shared.type]).toEqual([`離譜日常-photo-${result.seed}.png`,'image/png']);expect(Buffer.from(shared.bytes).equals(downloaded)).toBe(true);

    const jpegReady=(index:number)=>page.evaluate(i=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.jpegLoads[i]?.ready,index);
    await expect.poll(()=>jpegReady(0)).toBe(true);
    // Change ownership while a real encoded JPEG callback is held. The old PNG
    // URL is revoked and late JPEG completion must not enable the new workshop.
    const oldUrl=await download.getAttribute('href');
    await page.locator('.ad-photo-choices button').nth(0).click();await expect(download).toHaveCount(0);await expect(workshop).toBeDisabled();
    await expect.poll(async()=>(await loads())[4]).toEqual({ready:true,released:false,cancelled:false});
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.releaseJpeg(0));
    await expect(workshop).toBeDisabled();await expect(download).toHaveCount(0);
    expect(await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.jpegLoads.length)).toBe(1);
    expect(await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.revokedUrls)).toContain(oldUrl);
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.release(4));
    await expect(download).toBeVisible();await expect.poll(()=>jpegReady(1)).toBe(true);
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.failJpeg(1));
    await expect(download).toBeVisible();await expect(workshop).toBeDisabled();
    const jpegRetry=page.getByRole('button',{name:'重試準備工坊圖片',exact:true});await expect(jpegRetry).toBeEnabled();
    await jpegRetry.evaluate(button=>{button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
    await expect.poll(()=>jpegReady(2)).toBe(true);
    expect(await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.jpegLoads.length)).toBe(3);
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.releaseJpeg(2));
    await expect.poll(()=>jpegReady(3)).toBe(true);await expect(workshop).toBeDisabled();
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.releaseJpeg(3));
    await expect(workshop).toBeEnabled();await expect(download).toBeVisible();
    const jpegBytes=await page.evaluate(async()=>{const p=(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe;return Promise.all(p.jpegLoads.slice(2,4).map(async e=>Array.from(new Uint8Array(await e.blob!.arrayBuffer()))));});
    const metas=await Promise.all(jpegBytes.map(bytes=>sharp(Buffer.from(bytes)).metadata()));expect(metas.map(m=>[m.format,m.width,m.height])).toEqual([['jpeg',1200,675],['jpeg',960,1200]]);
    // Unmount another owner during its JPEG phase. Its already encoded callback
    // may arrive, but cannot create another JPEG, publish UI or leak a live URL.
    await page.locator('.ad-photo-choices button').nth(1).click();
    await expect.poll(async()=>(await loads())[5]).toEqual({ready:true,released:false,cancelled:false});
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.release(5));
    await expect(download).toBeVisible();await expect.poll(()=>jpegReady(4)).toBe(true);
    await page.evaluate(async()=>{const p=(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe;p.unmount();p.releaseJpeg(4);await Promise.resolve();await Promise.resolve();});
    await expect(page.locator('.ad-result')).toHaveCount(0);
    expect(await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.jpegLoads.length)).toBe(5);
    expect(await loads()).toHaveLength(6);
    const urls=await page.evaluate(()=>{const p=(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe;return {created:p.createdUrls,revoked:p.revokedUrls};});expect(urls.created.length).toBeGreaterThan(0);expect([...urls.revoked].sort()).toEqual([...urls.created].sort());
  }finally{await page.evaluate(()=>{const p=(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe;p.unmount();p.restore();});}
}

test('UX-15c: completed guided export survives development StrictMode replay and production cold reload',async({page,browser,baseURL})=>{
  await page.addInitScript(installExportTimingProbe);
  test.setTimeout(60000);const f=kitchenCheckpoint('result'),errors:string[]=[];let posts=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts++;});
  // Same ordinary browser pass, actual component and development React; no new host.
  // Pause only this temporary context's clock so native decoded images can be held
  // across cleanup without consuming the product's 8s deadline. This tests
  // deterministic completion order, not real-time timeout or GPU performance.
  const replayContext=await browser.newContext({baseURL});
  try{
    const replay=await replayContext.newPage();
    replay.on('pageerror',e=>errors.push(e.message));replay.on('request',r=>{if(r.method()==='POST')posts++;});
    await replay.clock.install({time:new Date('2026-01-01T00:00:00Z')});await replay.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await replay.route('**/__cooking-replay-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}));
    await replay.goto('/__cooking-replay-fixture');
    await replay.evaluate(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);
    const script=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../..',import.meta.url)),loader:'tsx',contents:`
      import React,{useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {CookingGame} from './apps/portal-web/src/games/cooking/CookingGame';
      import {recipeOf} from './apps/portal-web/src/games/cooking/catalog';
      const run=JSON.parse(sessionStorage.getItem('freedom.cooking.run.v1')).run;
      const effects=[],loads=[],results=[],completed=[],NativeImage=window.Image;
      // Return actual native images. Only delivery of their real load event to
      // cookingResult is gated; decoding, dimensions and canvas pixels are real.
      function GatedImage(width,height){
        const image=new NativeImage(width,height),entry={ready:false,released:false,deliver:null};
        loads.push(entry);let onload=null;
        Object.defineProperty(image,'onload',{configurable:true,get:()=>onload,set:value=>{onload=value;}});
        image.addEventListener('load',event=>{
          entry.ready=image.naturalWidth>0&&image.naturalHeight>0;
          entry.deliver=()=>{if(!entry.ready||entry.released||!onload)throw Error('Export image is not pending');entry.released=true;onload.call(image,event);};
        });return image;
      }
      GatedImage.prototype=NativeImage.prototype;Object.setPrototypeOf(GatedImage,NativeImage);window.Image=GatedImage;
      function ReplaySentinel(){useEffect(()=>{effects.push('setup');return()=>effects.push('cleanup');},[]);return null;}
      const root=createRoot(document.getElementById('root'));
      window.cookingReplay={effects,loads,results,completed,
        release:async index=>{loads[index].deliver();await Promise.resolve();await Promise.resolve();},
        unmount:()=>{root.unmount();window.Image=NativeImage;}};
      root.render(<React.StrictMode><ReplaySentinel/><CookingGame recipe={recipeOf(run.recipeId)} seed={run.seed}
        onBack={()=>{}} onComplete={value=>completed.push(value.id)} onResult={value=>results.push(value)}/></React.StrictMode>);
    `},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"development"'}}).outputFiles[0].text;
    await replay.addScriptTag({content:script});
    type Probe={effects:string[];loads:{ready:boolean;released:boolean}[];results:RunResult[];completed:string[];release:(index:number)=>Promise<void>;unmount:()=>void};
    const snapshot=()=>replay.evaluate(()=>{const p=(window as unknown as {cookingReplay:Probe}).cookingReplay;return {effects:p.effects,loads:p.loads.map(x=>({ready:x.ready,released:x.released})),results:p.results,completed:p.completed};});
    await expect.poll(async()=>{const s=await snapshot();return {effects:s.effects,loads:s.loads};}).toEqual({effects:['setup','cleanup','setup'],loads:[{ready:true,released:false},{ready:true,released:false}]});
    // The sentinel alone is insufficient: two real export loads belong to the
    // actual CookingGame, and only its replacement may publish a result.
    await replay.evaluate(()=> (window as unknown as {cookingReplay:Probe}).cookingReplay.release(0));
    let observed=await snapshot();expect(observed.results).toEqual([]);expect(observed.completed).toEqual([f.run.id]);
    expect(observed.loads).toEqual([{ready:true,released:true},{ready:true,released:false}]);
    await replay.evaluate(()=> (window as unknown as {cookingReplay:Probe}).cookingReplay.release(1));
    await expect.poll(async()=>(await snapshot()).results.length).toBe(1);
    observed=await snapshot();expect(observed.completed).toEqual([f.run.id]);
    expect(observed.results[0]).toMatchObject({game:'kitchen',cookingMode:'guided',recipe:f.recipe.id,seed:f.run.seed,title:f.recipe.name,caption:`${cookingScore(f.run)}分`});
    const native=await sharp(Buffer.from(observed.results[0].image.split(',')[1],'base64')).metadata();expect([native.format,native.width,native.height]).toEqual(['jpeg',960,720]);
    // DOM ownership only: the first lazy setup can be invalidated before it
    // creates a renderer. Do not require two contexts or claim GPU reclamation.
    await expect(replay.locator('[data-cooking-visual]')).toHaveAttribute('data-cooking-visual','3d',{timeout:15000});
    await expect(replay.locator('.ck-kitchen-canvas canvas')).toHaveCount(1);
    await replay.evaluate(()=> (window as unknown as {cookingReplay:Probe}).cookingReplay.unmount());
    await expect(replay.locator('.ck-kitchen-canvas canvas')).toHaveCount(0);
    observed=await snapshot();expect(observed.results).toHaveLength(1);expect(observed.effects).toEqual(['setup','cleanup','setup','cleanup']);
    await checkResultRetryOwnership(replay,observed.results[0]);
  }finally{await replayContext.close();}
  // Preserve the real production-dist restore/reload and downloaded PNG checks.
  await page.addInitScript(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);
  for(let visit=0;visit<2;visit++){
    if(!visit)await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`);else await page.reload();
    const download=page.getByRole('link',{name:'下載完整成果 PNG',exact:true});await expect(download).toBeVisible();
    await expect(page.locator('.ad-result')).toHaveCount(1);await expect(page.getByText('正在端出你的拿手菜…',{exact:true})).toHaveCount(0);
    const exporting=page.waitForEvent('download');await download.click();const meta=await sharp((await (await exporting).path())!).metadata();expect([meta.format,meta.width,meta.height]).toEqual(['png',960,1200]);
  }
  expect(posts).toBe(0);expect(errors).toEqual([]);
});

test('UX-15c: preview back and an initial renderer failure preserve another unfinished market checkpoint',async({page})=>{
  test.setTimeout(90000);await marketOpen(page,'corn-dog');await marketAdd(page,'熱狗');await marketButton(page,'裹麵糊');
  await page.getByRole('button',{name:'← 大廳',exact:true}).click();
  const saved=await page.evaluate(k=>sessionStorage.getItem(k),MARKET_SAVE_KEY);expect(JSON.parse(saved!).run.recipe).toBe('corn-dog');
  await page.getByRole('button',{name:'開始製作香煎牛排',exact:true}).click();await expect(page.getByRole('button',{name:'開火，開始做！',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'← 大廳',exact:true}).click();expect(await page.evaluate(k=>sessionStorage.getItem(k),MARKET_SAVE_KEY)).toBe(saved);
  await page.route('**/assets/market-stage-*.js',r=>r.abort());await page.goto('/play?game=kitchen&recipe=steak-dinner&seed=42');
  await expect(page.locator('.mk-error')).toContainText('3D暫時無法開啟');expect(await page.evaluate(k=>sessionStorage.getItem(k),MARKET_SAVE_KEY)).toBe(saved);
  await page.getByRole('button',{name:'← 大廳',exact:true}).click();expect(await page.evaluate(k=>sessionStorage.getItem(k),MARKET_SAVE_KEY)).toBe(saved);
});

test('UX-15c: releasing a held native holiday target in the next round cannot hit its replacement',async({page})=>{
  test.setTimeout(60000);await page.setViewportSize({width:390,height:844});await openParty(page,'holiday');
  await partyAdvance(page,250);await page.locator('.pt-canvas').press(String(holidayTargets(42,0).good+1));await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
  await partyAdvance(page,4600);const canvas=page.locator('.pt-canvas');await canvas.scrollIntoViewIfNeeded();
  const anchor=JSON.parse((await canvas.getAttribute('data-anchors'))!)[0],b=(await canvas.boundingBox())!;
  await page.mouse.move(b.x+b.width*anchor.x,b.y+b.height*anchor.y);await page.mouse.down();await partyAdvance(page,4930);await page.mouse.up();
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
  const next=JSON.parse((await canvas.getAttribute('data-anchors'))!)[0],box=(await canvas.boundingBox())!;await page.mouse.click(box.x+box.width*next.x,box.y+box.height*next.y);
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','40');
});

test('UX-15c: a real steak tap selects its original portion after a side dish and flips only that steak',async({page})=>{
  test.setTimeout(60000);await marketOpen(page,'steak-dinner');await marketAdd(page,'薯條');await marketAdd(page,'牛排');await marketAdd(page,'牛排');
  const selected=page.getByRole('combobox',{name:'目前操作的食材'});await expect(selected).toHaveValue('2');await marketTime(page,400);
  const camera=new PerspectiveCamera(38,6/5,.1,45);camera.position.set(5,8.6,8);camera.lookAt(0,.1,-.25);camera.updateMatrixWorld();
  const p=new Vector3(-.85,.6,0).project(camera),surface=page.locator('.mk-surface');await surface.scrollIntoViewIfNeeded();const b=(await surface.boundingBox())!,scale=Math.min(b.width/768,b.height/640),w=768*scale,h=640*scale;
  await page.mouse.click(b.x+(b.width-w)/2+(p.x+1)*w/2,b.y+(b.height-h)/2+(1-p.y)*h/2);
  await expect(selected).toHaveValue('1');const saved=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);
  expect(saved.portions.map(p=>p.side)).toEqual([0,1,0]);
});

test('UX-1: returning to the playroom restores the expanded recipe card, focus and scroll, including browser Back',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/play');await page.getByRole('button',{name:'料理小遊戲 66',exact:true}).click();await page.getByRole('button',{name:'再看看 8 道料理',exact:true}).click();const card=page.locator('.ck-recipe-open').nth(15);await card.evaluate(e=>e.scrollIntoView({block:'center'}));const before=await page.evaluate(()=>scrollY),key=await card.getAttribute('data-arcade-open');await card.click();await expect(page.locator('.ck-game')).toBeVisible();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await expect(page.locator('.ck-recipe-open')).toHaveCount(16);await expect(page.locator(`[data-arcade-open="${key}"]`)).toBeFocused();expect(Math.abs(await page.evaluate(()=>scrollY)-before)).toBeLessThan(32);
  await page.locator(`[data-arcade-open="${key}"]`).click();await page.goBack();await expect(page.locator(`[data-arcade-open="${key}"]`)).toBeFocused();expect(Math.abs(await page.evaluate(()=>scrollY)-before)).toBeLessThan(32);expect(await page.locator('.ad-skip').evaluate(e=>e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);await page.locator('.ad-skip').focus();expect(await page.locator('.ad-skip').evaluate(e=>e.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
});

test('UX-2: a whole stirring gesture inside one animation frame still shows the completed step immediately on release',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openKitchen(page,'rice-balls');const svg=page.locator('.ck-scene'),p=await scenePoint(page,.8,.52);await page.mouse.move(p.x,p.y);await page.mouse.down();await svg.evaluate(el=>{const r=el.getBoundingClientRect();for(let i=1;i<=64;i++){const a=i*Math.PI/16;el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,isPrimary:true,button:0,buttons:1,clientX:r.left+(.5+.3*Math.cos(a))*r.width,clientY:r.top+(.52+.3*Math.sin(a))*r.height}));}});await page.mouse.up();await expect(page.locator('.ck-game')).toHaveAttribute('data-cooking-state','step-result');await expect(page.getByRole('button',{name:/^下一步：/})).toBeVisible();await page.getByRole('button',{name:/^下一步：/}).click();await expect(svg).toHaveAttribute('data-cooking-scene','knead');
});

test('UX-2: secondary pointers cannot release or cancel a real cooking hold, and restart confirmation freezes progress',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openKitchen(page,'margherita-pizza');const hold=page.getByRole('button',{name:'按住揉壓，適時放開',exact:true});await hold.scrollIntoViewIfNeeded();const b=(await hold.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.clock.runFor(750);await hold.dispatchEvent('pointerup',{pointerId:99,isPrimary:false,button:0});await expect(page.locator('.ck-meter-copy')).toHaveText('0 / 4');await page.mouse.up();await expect(page.locator('.ck-meter-copy')).toHaveText('1 / 4');
  await page.locator('.ck-scene').scrollIntoViewIfNeeded();const p=await scenePoint(page,.5,.5);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.clock.runFor(750);await page.locator('.ck-scene').dispatchEvent('pointercancel',{pointerId:99,isPrimary:false,button:0});await page.mouse.up();await expect(page.locator('.ck-meter-copy')).toHaveText('2 / 4');await page.getByRole('button',{name:'重新做',exact:true}).click();await expect(page.locator('.ck-game')).toHaveAttribute('data-cooking-state','paused');const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);await page.clock.runFor(6000);await expect(page.locator('.ck-meter-copy')).toHaveText('2 / 4');expect(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run.elapsed,COOKING_RUN_KEY)).toBe(saved.run.elapsed);await page.getByRole('button',{name:'繼續這一盤',exact:true}).click();await expect(page.getByRole('button',{name:'繼續料理',exact:true})).toBeVisible();
});

test('UX-1/5: a completed cooking run can replay the same seed or move to the next real recipe',async({page})=>{
  test.setTimeout(120000);await openKitchen(page,'egg-fried-rice');await playRecipe(page,recipeOf('egg-fried-rice')!);await page.getByRole('button',{name:'同一題再來一次',exact:true}).click();expect(new URL(page.url()).searchParams.get('seed')).toBe('42');await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();await page.getByRole('button',{name:'開始料理',exact:true}).click();await playRecipe(page,recipeOf('egg-fried-rice')!);await page.getByRole('button',{name:'換一道料理 →',exact:true}).click();await expect(page.locator('.ck-game h1')).toHaveText('滷肉飯');expect(new URL(page.url()).searchParams.get('recipe')).toBe('braised-pork-rice');await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();
});

test('UX-4: all six 3D scenes keep bounded real draw calls and avoid unchanged diagnostic mutations',async({page})=>{
  test.setTimeout(120000);await page.setViewportSize({width:1440,height:900});await page.clock.install({time:new Date('2026-10-25T06:00:00Z')});
  for(const [game,budget]of [['photo',95],['stamp',75],['cash',70],['chair',100],['tofu',56],['holiday',100]] as const){const party=['chair','tofu','holiday'].includes(game);await page.goto(`/play?game=${game}&seed=42`);await expect(page.locator(party?'[data-party-stage="ready"]':'[data-game-stage="ready"]')).toBeVisible();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));await page.getByRole('button',{name:party?'開始派對！':game==='stamp'?'先蓋一張練習紙':'開始這一局',exact:true}).click();const host=page.locator(party?'.pt-canvas':'.ad-stage'),counter=await host.evaluateHandle(el=>{const record={count:0};new MutationObserver(records=>{record.count+=records.length;}).observe(el,{attributes:true});return record;});await page.clock.runFor(1000);expect(Number(await host.getAttribute('data-render-calls'))).toBeLessThanOrEqual(budget);expect(await counter.evaluate(c=>c.count)).toBeLessThan(party?160:12);await counter.dispose();}
});

test('UX-4: a real legacy UI draw failure is contained and retries with practice progress preserved',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-25T09:00:00Z')});await page.goto('/play?game=stamp&seed=42');await expect(page.locator('[data-game-stage="ready"]')).toBeVisible();await page.clock.pauseAt(new Date('2026-10-25T09:01:00Z'));await page.getByRole('button',{name:'先蓋一張練習紙',exact:true}).click();await page.getByRole('button',{name:'啪！蓋章',exact:true}).click();await page.clock.runFor(300);const clear=await page.evaluateHandle(()=>WebGL2RenderingContext.prototype.clear);await page.evaluate(()=>{WebGL2RenderingContext.prototype.clear=function(){throw Error('Synthetic UX draw fault');};});await page.locator('.ad-board').press('ArrowLeft');await expect(page.getByRole('alert')).toContainText('按重試恢復這一局');expect(errors).toEqual([]);await page.evaluate(original=>{WebGL2RenderingContext.prototype.clear=original;},clear);await clear.dispose();await page.getByRole('button',{name:'重試場景',exact:true}).click();await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();await expect(page.locator('.ad-counter')).toContainText('0/12');
});

async function openParty(page:Page,game:PartyGameId){
  await page.clock.install({time:new Date('2026-10-25T00:00:00Z')});await page.goto(`/play?game=${game}&seed=42`);
  await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();await page.clock.pauseAt(new Date('2026-10-25T00:01:00Z'));
  await page.getByRole('button',{name:'開始派對！',exact:true}).click();
}
async function partyElapsed(page:Page){return Number(await page.locator('.pt-canvas').getAttribute('data-elapsed'));}
async function partyAdvance(page:Page,target:number){
  for(let i=0;i<80;i++){const at=await partyElapsed(page);if(at>=target||await page.locator('.pt-root').getAttribute('data-party-state')==='done')return;await page.clock.runFor(Math.min(1000,target-at+17));}throw Error('party clock did not advance');
}
async function partyResult(page:Page,game:PartyGameId){
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','done');const score=Number(await page.locator('.pt-root').getAttribute('data-party-score'));expect(score).toBeGreaterThan(0);
  await page.getByRole('button',{name:'查看這局成果',exact:true}).click();await expect(page.locator('.ad-result-heading')).toContainText(`${score} 分`);await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();await socialEntries(page,game);return score;
}

test('PT-3/7: chair escape uses real swipes and keyboard lanes, ends once, then exports the actual score and challenge',async({page})=>{
  test.setTimeout(150000);await page.setViewportSize({width:390,height:844});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openParty(page,'chair');
  const canvas=page.locator('.pt-canvas'),b=(await canvas.boundingBox())!;await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.75,b.y+b.height*.5);await page.mouse.up();await expect(canvas).toHaveAttribute('data-lane','1');await partyAdvance(page,160);await canvas.press('ArrowLeft');await expect(canvas).toHaveAttribute('data-lane','0');await partyAdvance(page,320);let lane=0;
  for(let i=0;i<PT.chairWaves;i++){const w=chairWave(42,i);while(lane!==w.ticketLane){await canvas.press(lane<w.ticketLane?'ArrowRight':'ArrowLeft');lane+=lane<w.ticketLane?1:-1;await expect(canvas).toHaveAttribute('data-lane',String(lane));await partyAdvance(page,await partyElapsed(page)+160);}await partyAdvance(page,w.at+20);}
  await partyAdvance(page,PT.chairMs);expect(await partyResult(page,'chair')).toBe(4280);
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG',exact:true}).click();const metadata=await sharp((await (await download).path())!).metadata();expect([metadata.width,metadata.height]).toEqual([960,1200]);expect(errors).toEqual([]);
});

test('PT-4: tofu uses actual moving-block timing, rejects an in-flight second drop and reaches all twelve layers',async({page})=>{
  test.setTimeout(180000);await openParty(page,'tofu');
  for(let layer=0;layer<PT.tofuGoal;layer++){
    let aligned=false;for(let t=0;t<180;t++){const offset=Math.abs(Number(await page.locator('.pt-canvas').getAttribute('data-tofu-offset')));if(offset<.105){aligned=true;break;}await page.clock.runFor(offset>.7?90:10);}expect(aligned).toBe(true);
    const drop=page.getByRole('button',{name:'豆腐落下！',exact:true});if(layer===0)await page.locator('.pt-canvas').press('Space');else await drop.click();await expect(page.getByRole('button',{name:'豆腐降落中…',exact:true})).toBeDisabled();await page.locator('.pt-canvas').press('Space');await page.clock.runFor(510);
  }
  await expect(page.locator('.pt-scoreboard')).toContainText('12 / 12');expect(await partyResult(page,'tofu')).toBe(2925);
});

test('PT-5/7: holiday raycasts a real 3D character, accepts keyboard targets, and carries the result to confirmed site sharing',async({page})=>{
  test.setTimeout(150000);await page.setViewportSize({width:390,height:844});await openParty(page,'holiday');
  for(let round=0;round<20;round++){
    await partyAdvance(page,round*PT.holidayRoundMs+250);const good=page.getByRole('button',{name:/第 [1-6] 格：休假/}),label=(await good.getAttribute('aria-label'))!,hole=Number(label.match(/第 (\d)/)![1])-1;
    if(!round){const anchor=JSON.parse((await page.locator('.pt-canvas').getAttribute('data-anchors'))!)[hole],b=(await page.locator('.pt-canvas').boundingBox())!;await page.mouse.click(b.x+anchor.x*b.width,b.y+anchor.y*b.height);}else await page.locator('.pt-canvas').press(String(hole+1));
    await expect(page.locator('.pt-live-label')).toContainText(`已守住 ${round+1} 個假日`);
  }
  await partyAdvance(page,PT.holidayMs);expect(await partyResult(page,'holiday')).toBe(5100);await page.getByRole('button',{name:'發到自由工坊',exact:true}).click();await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();
  const draft=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),GAME_HANDOFF_KEY);expect(draft.game).toBe('holiday');expect(draft.text).toContain('5100 分');expect(draft.text).toContain('game=holiday');expect(draft.autoPublish).toBeUndefined();await login(page);await expect(page.getByRole('textbox',{name:'貼文內容'})).toHaveValue(/5100 分/);await expect(page.getByRole('button',{name:'發布貼文',exact:true})).toBeVisible();
});

test('PT-2/6: blur freezes the round, genuine context loss rebuilds it, and restart needs an explicit choice',async({page})=>{
  test.setTimeout(90000);await openParty(page,'holiday');await partyAdvance(page,300);await page.getByRole('button',{name:/第 [1-6] 格：休假/}).click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');const at=await partyElapsed(page),score=await page.locator('.pt-root').getAttribute('data-party-score');await page.clock.runFor(6000);expect(await partyElapsed(page)).toBe(at);
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();const lost=await page.locator('.pt-canvas canvas').evaluate(c=>{const gl=(c as HTMLCanvasElement).getContext('webgl2');const ext=gl?.getExtension('WEBGL_lose_context');ext?.loseContext();return !!ext;});expect(lost).toBe(true);await expect(page.getByRole('alert')).toContainText('本局已暫停');await page.getByRole('button',{name:'重建 3D 場景',exact:true}).click();await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await partyAdvance(page,at+200);
  await page.getByRole('button',{name:'重新開始',exact:true}).click();await expect(page.getByRole('group',{name:'確認重新開始'})).toBeVisible();await page.getByRole('button',{name:'保留這局',exact:true}).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);await page.getByRole('button',{name:'重新開始',exact:true}).click();await page.getByRole('button',{name:'確定重來',exact:true}).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','ready');expect(await partyElapsed(page)).toBe(0);
});

test('PT-2/6: a render exception from a paused UI action is contained, with the same score restored after retry',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openParty(page,'holiday');await partyAdvance(page,300);await page.getByRole('button',{name:/第 [1-6] 格：休假/}).click();await page.getByRole('button',{name:'暫停',exact:true}).click();const clear=await page.evaluateHandle(()=>WebGL2RenderingContext.prototype.clear);await page.evaluate(()=>{WebGL2RenderingContext.prototype.clear=function(){throw Error('Synthetic PT render fault');};});await page.getByRole('button',{name:'減少動態關',exact:true}).click();await expect(page.getByRole('alert')).toContainText('本局仍保留');await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','failed');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');expect(errors).toEqual([]);await page.evaluate(original=>{WebGL2RenderingContext.prototype.clear=original;},clear);await clear.dispose();await page.getByRole('button',{name:'重建 3D 場景',exact:true}).click();await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await partyAdvance(page,500);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
});

test('PT-6: compact and landscape 200% text preserves the start/control owners for every party game',async({page})=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const viewport of [{width:320,height:568},{width:667,height:375}])for(const g of PARTY_GAMES){
    await page.setViewportSize(viewport);await page.goto(`/play?game=${g.id}&seed=42`);await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();
    await page.evaluate(()=>{const styles=[...document.querySelectorAll('.ad-root,.ad-root *')].filter(e=>e instanceof HTMLElement).map(e=>({e:e as HTMLElement,font:parseFloat(getComputedStyle(e).fontSize),line:parseFloat(getComputedStyle(e).lineHeight)}));for(const {e,font,line}of styles){e.style.fontSize=`${font*2}px`;if(Number.isFinite(line))e.style.lineHeight=`${line*2}px`;}});
    const owners=()=>page.locator('.pt-root').evaluate(root=>{const problems:string[]=[];for(const b of root.querySelectorAll('button')){if(!b.checkVisibility())continue;const r=b.getBoundingClientRect();if(r.width<44||r.height<44)problems.push(`small:${b.textContent}`);const owner=b.closest('.pt-panel,.pt-controls,.pt-tools,.pt-heading');if(owner){const o=owner.getBoundingClientRect();if(r.left<o.left-1||r.right>o.right+1||r.top<o.top-1||r.bottom>o.bottom+1)problems.push(`owner:${b.textContent}`);}}return problems;});expect(await owners()).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'開始派對！',exact:true}).click();expect(await owners()).toEqual([]);await page.getByRole('button',{name:'暫停',exact:true}).click();await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();
  }expect(errors).toEqual([]);
});

test('PT-6: a failed lazy 3D renderer offers retry and a working return to the lobby',async({page})=>{
  await page.route('**/assets/stage-*.js',route=>route.abort());await page.goto('/play?game=chair&seed=42');await expect(page.getByRole('alert')).toContainText('無法開啟 3D 場景');await expect(page.getByRole('button',{name:'重建 3D 場景',exact:true})).toBeVisible();await page.getByRole('button',{name:'先回遊戲大廳',exact:true}).click();await expect(page.getByRole('button',{name:'全部遊戲 72',exact:true})).toBeVisible();
});

test('PT-6: landscape play keeps the real canvas and every primary control in the same viewport',async({page})=>{
  await page.setViewportSize({width:667,height:375});for(const g of PARTY_GAMES){await page.goto(`/play?game=${g.id}&seed=42`);await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();await page.getByRole('button',{name:'開始派對！',exact:true}).click();const boxes=await page.locator('.pt-canvas,.pt-controls button').evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};}));for(const r of boxes){expect(r.left).toBeGreaterThanOrEqual(0);expect(r.top).toBeGreaterThanOrEqual(0);expect(r.right).toBeLessThanOrEqual(667);expect(r.bottom).toBeLessThanOrEqual(375);}}
});

test('PT-6: lobby previews fail gracefully, keep Three cold and release the context on return',async({page})=>{
  const code:string[]=[];page.on('request',r=>{if(/\/(?:PartyGame|stage|three)-[^/]+\.js/.test(r.url()))code.push(r.url());});await page.route('**/games/absurd-daily/illustrated/tofu.webp',route=>route.abort());await page.goto('/play');await page.getByRole('button',{name:'反應手速 5',exact:true}).click();await expect(page.locator('.pt-party-card')).toHaveCount(3);await page.getByRole('button',{name:'豆腐開工',exact:true}).scrollIntoViewIfNeeded();await expect(page.locator('[data-cover-id=tofu] .sg-cover-fallback')).toContainText('豆腐疊高高');expect(code).toEqual([]);
  await page.locator('[data-cover-id=tofu] .sg-cover-fallback').evaluate(e=>{(e as HTMLElement).style.fontSize='40px';(e as HTMLElement).style.lineHeight='64px';});expect(await page.locator('[data-cover-id=tofu] .sg-cover-fallback').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBe(40);const fallback=await page.locator('[data-cover-id=tofu] .sg-cover-fallback').boundingBox(),owner=await page.locator('.pt-party-art:has([data-cover-id=tofu])').boundingBox();expect(fallback!.y+fallback!.height).toBeLessThanOrEqual(owner!.y+owner!.height);
  await page.getByRole('button',{name:'豆腐開工',exact:true}).click();await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();const gl=await page.locator('.pt-canvas canvas').evaluateHandle(c=>(c as HTMLCanvasElement).getContext('webgl2'));await page.getByRole('button',{name:'回遊戲大廳',exact:true}).click();await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);await expect.poll(()=>gl.evaluate(g=>g?.isContextLost())).toBe(true);await expect(page.getByRole('button',{name:'反應手速 5',exact:true})).toHaveAttribute('aria-pressed','true');await gl.dispose();
});

test.describe('PT-6 touchscreen input',()=>{
  test.use({hasTouch:true});
  test('PT-6: a real touch tap raycasts the visible holiday character',async({page})=>{
    await page.setViewportSize({width:390,height:844});await openParty(page,'holiday');await partyAdvance(page,250);const label=(await page.getByRole('button',{name:/第 [1-6] 格：休假/}).getAttribute('aria-label'))!,hole=Number(label.match(/第 (\d)/)![1])-1;const anchor=JSON.parse((await page.locator('.pt-canvas').getAttribute('data-anchors'))!)[hole],b=(await page.locator('.pt-canvas').boundingBox())!;await page.touchscreen.tap(b.x+anchor.x*b.width,b.y+anchor.y*b.height);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');await expect(page.locator('.pt-live-label')).toContainText('已守住 1 個假日');
  });
});

async function openGame(page:Page,game:'photo'|'stamp'|'cash'){
  // Keep lazy Three startup on a running clock, then freeze gameplay time.
  // Continuous RAF + trace readback on software WebGL can consume a whole
  // photo round between clicks and starve keyboard actions on the other games.
  await page.clock.install({time:new Date('2026-10-23T00:00:00Z')});
  await page.goto(`/play?game=${game}&seed=42`);
  // Functional synchronization allows the existing 15s product import bound;
  // this is not a startup performance assertion. Never auto-retry a failed load.
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
  await page.clock.pauseAt(new Date('2026-10-23T00:01:00Z'));
  await page.getByRole('button',{name:game==='stamp'?'先蓋一張練習紙':'開始這一局',exact:true}).click();
}
async function login(page:Page){
  await page.getByLabel('電子郵件',{exact:true}).fill('maker@local.test');
  await page.getByLabel('密碼',{exact:true}).fill('freedom-local-demo');
  await page.getByRole('button',{name:'登入',exact:true}).click();
  await expect(page.locator('.shell')).toBeVisible();
}
async function artifact():Promise<GameDraft>{
  const image=await sharp({create:{width:1200,height:675,channels:3,background:'#ba9bdf'}}).jpeg().toBuffer();
  return {version:1,createdAt:Date.now(),game:'photo',seed:42,title:'這張能交嗎？',text:`背景出席，本人缺席。\n${Date.now()} #離譜日常`,image:`data:image/jpeg;base64,${image.toString('base64')}`};
}
async function putArtifact(page:Page,draft:GameDraft){
  await page.evaluate(({key,event,draft})=>{sessionStorage.setItem(key,JSON.stringify(draft));window.dispatchEvent(new Event(event));},{key:GAME_HANDOFF_KEY,event:GAME_HANDOFF_EVENT,draft});
}
async function socialEntries(page:Page,game:string){
  const requests:string[]=[];const record=(r:{url:()=>string})=>{if(/^https:\/\/(x\.com|www\.(threads\.com|facebook\.com|instagram\.com))\//.test(r.url()))requests.push(r.url());};page.on('request',record);
  for(const label of ['X','Threads','Facebook','Instagram']){
    const button=page.getByRole('button',{name:`分享到 ${label}`,exact:true});await button.click();await expect(button).toHaveAttribute('aria-pressed','true');await expect(page.locator('.ad-social-targets [aria-pressed=true]')).toHaveCount(1);
    const entry=page.getByRole('link',{name:new RegExp(`^開啟 ${label}`)}),url=new URL((await entry.getAttribute('href'))!);expect(url.protocol).toBe('https:');expect(await entry.getAttribute('rel')).toContain('noopener');
    if(label==='X'||label==='Threads')expect(url.searchParams.get('text')).toContain(`game=${game}`);
    if(label==='Facebook')expect(url.searchParams.get('u')).toContain(`game=${game}`);
    if(label==='Instagram')expect(url.href).toBe('https://www.instagram.com/');
  }
  expect(requests).toEqual([]);page.off('request',record);
}

test('AD-3 public photo studio captures real frames, enforces film, and exports a complete poster',async({page})=>{
  test.setTimeout(120_000);await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openGame(page,'photo');
  const shutter=page.getByRole('button',{name:'拍照快門',exact:true});
  await shutter.click();await shutter.click();await expect(shutter).toBeDisabled();
  await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'鏡頭往上',exact:true}).click();
  await page.getByRole('slider').focus();await page.getByRole('slider').press('End');
  await page.clock.runFor(160);
  await shutter.click();await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();
  await page.clock.fastForward(3500);await shutter.click();
  await page.getByRole('button',{name:'挑選照片',exact:true}).click();
  await expect(page.locator('.ad-photo-choices button')).toHaveCount(4);
  await socialEntries(page,'photo');
  await page.locator('.ad-photo-choices button').first().click();
  await expect(page.locator('.ad-photo-choices [aria-pressed="true"]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG'}).click();
  const file=await download,path=await file.path();expect(path).toBeTruthy();
  const info=await sharp(path!).metadata();expect([info.width,info.height]).toEqual([960,1200]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('AD-4 twelve real documents finish once after practice; blur pauses until explicit resume',async({page})=>{
  test.setTimeout(120_000);await page.setViewportSize({width:390,height:844});await openGame(page,'stamp');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();
  await page.keyboard.press('Space');await expect(page.locator('.ad-counter')).toHaveText('練習中');
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
  await page.keyboard.press('Space');await expect(page.getByText('練習完成。十二張正式公文，開始！',{exact:true})).toBeVisible();
  let point=stampTarget(42,0);
  for(let i=0;i<12;i++){
    const target=stampTarget(42,i),x=Math.round((target.x-point.x)/.06),y=Math.round((target.y-point.y)/.06);
    for(let k=0;k<Math.abs(x);k++)await page.keyboard.press(x>0?'ArrowRight':'ArrowLeft');
    for(let k=0;k<Math.abs(y);k++)await page.keyboard.press(y>0?'ArrowDown':'ArrowUp');
    point={x:point.x+x*.06,y:point.y+y*.06};await page.clock.fastForward(230);await page.keyboard.press('Space');
    if(i<11)await expect(page.locator('.ad-counter')).toHaveText(`${i+1}/12`);
  }
  await expect(page.locator('.ad-result-heading')).toContainText('完成 12 份文件');
  await socialEntries(page,'stamp');
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
});

// Hosted #1044 exhausted 120s after ~108s in the first 29 input/clock pairs.
// Budget both full cash rounds for recovery/share assertions before teardown;
// retain desktop rendering, real inputs, and all individual assertion deadlines.
test('AD-5 sort exact million, recover denied storage, cancel system share, and hand off without a post',async({page})=>{
  test.setTimeout(180_000);await openGame(page,'cash');const posts:string[]=[];
  page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  const deck=cashDeck(42);await page.keyboard.press(deck[0].valid?'ArrowLeft':'ArrowRight');
  await expect(page.getByText('這張分錯了，退回來重新看看。',{exact:true})).toBeVisible();await page.clock.fastForward(180);
  for(const card of deck){await page.keyboard.press(card.valid?'ArrowRight':'ArrowLeft');await page.clock.fastForward(175);}
  await expect(page.locator('.ad-result-heading')).toContainText('100 萬道具鈔 · 退回 6 張票券');
  await socialEntries(page,'cash');
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('cancel','AbortError');}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});
  });
  await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();
  await expect(page.getByText('已取消分享，成果仍在這裡。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'複製同題挑戰連結',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'同題連結',exact:true})).toHaveValue(/\/play\?game=cash&seed=42$/);
  await page.evaluate(key=>{
    const original=Storage.prototype.setItem;
    (window as unknown as {restoreStorage:()=>void}).restoreStorage=()=>{Storage.prototype.setItem=original;};
    Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('quota','QuotaExceededError');return original.call(this,k,v);};
  },GAME_HANDOFF_KEY);
  await page.getByRole('button',{name:'發到自由工坊',exact:true}).click();
  await expect(page.getByText('成果還沒保存，請重試「發到自由工坊」，或先下載圖片。',{exact:true})).toBeVisible();
  await page.evaluate(()=>(window as unknown as {restoreStorage:()=>void}).restoreStorage());
  await page.getByRole('button',{name:'發到自由工坊',exact:true}).click();
  await page.waitForURL('**/?game-share=1#home');
  const draft=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),GAME_HANDOFF_KEY);
  expect(draft.game).toBe('cash');expect(draft.image).toMatch(/^data:image\/jpeg;base64,/);expect(draft.text).toContain('/play?game=cash&seed=42');
  expect(posts).toEqual([]);
});

test('AD-5 final cash capture failure retries the completed scene without replaying classification',async({page})=>{
  test.setTimeout(180_000);await openGame(page,'cash');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const deck=cashDeck(42);
  for(const card of deck.slice(0,29)){
    await page.keyboard.press(card.valid?'ArrowRight':'ArrowLeft');
    await page.clock.fastForward(175);
  }
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL=function(...args){
      if(this.width===960&&this.height===720&&args[0]==='image/jpeg'){
        HTMLCanvasElement.prototype.toDataURL=original;
        throw Error('Synthetic final capture failure');
      }
      return original.apply(this,args);
    };
  });
  await page.keyboard.press(deck[29].valid?'ArrowRight':'ArrowLeft');
  await expect(page.locator('.ad-notice')).toContainText('完成次數不會重算');
  await expect(page.locator('.ad-controls .ad-meta')).toContainText('已分類 30 / 30');
  await expect(page.locator('.ad-result-heading')).toHaveCount(0);
  await page.getByRole('button',{name:'重試產生成果圖片',exact:true}).click();
  await expect(page.locator('.ad-result-heading')).toContainText('100 萬道具鈔 · 退回 6 張票券');
  const image=page.locator('.ad-result-photo > img');
  await expect(image).toHaveJSProperty('naturalWidth',960);
  await expect(image).toHaveJSProperty('naturalHeight',720);
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  expect(errors).toEqual([]);
});

test('AD-7 guest result survives login, shows current author, and publishes only after confirmation',async({page,e2eAuthPool})=>{
  await page.goto('/?game-share=1#home');const draft=await artifact();await putArtifact(page,draft);
  try {
  const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/social-posts/notes'))writes.push(r.url());});
  await login(page);
  const dialog=page.getByRole('dialog',{name:'建立貼文',exact:true});
  await expect(dialog).toBeVisible();await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue(draft.text);
  await expect(dialog.locator('.social-publish-identity')).toContainText('示範創作者');
  const preview=dialog.getByRole('img',{name:'待發布圖片預覽'});await expect(preview).toHaveJSProperty('naturalWidth',1200);
  await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();expect(writes).toEqual([]);
  expect(await page.evaluate(key=>sessionStorage.getItem(key),GAME_HANDOFF_KEY)).not.toBeNull();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await dialog.getByRole('button',{name:'發布貼文',exact:true}).click();await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(1);
  expect((await e2eAuthPool.query('SELECT count(*)::int AS n FROM community_social_posts WHERE note=$1',[draft.text])).rows[0].n).toBe(1);
  expect(await page.evaluate(key=>sessionStorage.getItem(key),GAME_HANDOFF_KEY)).toBeNull();
  } finally {
    // AD-7: this alphabetically early test must not leave a post that later
    // synthetic chat members read, creating foreign keys into their fixtures.
    await page.close();
    await e2eAuthPool.query(`DELETE FROM community_social_posts WHERE note=$1
      AND author_user_id IN (SELECT user_id FROM users WHERE email='maker@local.test')`,[draft.text]);
  }
});

test('AD-6 stage import times out, ignores late completion, and recovers only after explicit Retry',async({page})=>{
  const now=new Date('2026-10-23T00:00:00Z');
  await page.clock.install({time:now});
  await page.clock.pauseAt(new Date(now.getTime()+60_000));
  let capture!:(route:Route)=>void;
  const requested=new Promise<Route>(resolve=>{capture=resolve;});
  // Hold the real production stage chunk, not a fake renderer. Returning from
  // the handler leaves the route pending until the explicit fulfill below.
  await page.route(/\/assets\/stage-(?!batch-)[^/]+\.js(?:\?.*)?$/,route=>{capture(route);});
  // A pending module can delay load; DOMContentLoaded does not await this lazy import.
  await page.goto('/play?game=cash&seed=42',{waitUntil:'domcontentloaded'});
  const route=await requested,response=await route.fetch(),stageUrl=route.request().url();
  const start=page.getByRole('button',{name:'開始這一局',exact:true});
  const retry=page.getByRole('button',{name:'重試場景',exact:true});
  const alert=page.getByRole('alert'),canvas=page.locator('.ad-stage canvas');
  await expect(page.locator('.ad-stage-cover').getByRole('status')).toHaveText('正在佈置現場…');
  await page.clock.fastForward(14_999);
  await expect(alert).toHaveCount(0);await expect(retry).toHaveCount(0);
  await expect(start).toHaveCount(0);await expect(canvas).toHaveCount(0);
  await page.clock.fastForward(1);
  await expect(alert).toHaveText('遊戲場景載入較久。請重試，或回遊樂場。');
  await expect(retry).toBeVisible();await expect(start).toHaveCount(0);
  await route.fulfill({response});
  // Await evaluation of the same module, not merely its HTTP response, before
  // checking that the expired generation cannot create a scene or expose Start.
  await page.evaluate(async url=>{await import(url);},stageUrl);
  await expect(alert).toHaveText('遊戲場景載入較久。請重試，或回遊樂場。');
  await expect(retry).toBeVisible();await expect(start).toHaveCount(0);
  await expect(canvas).toHaveCount(0);
  await expect(page.locator('[data-game-stage="ready"]')).toHaveCount(0);
  await retry.click();
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
  await expect(alert).toHaveCount(0);await expect(retry).toHaveCount(0);
  await expect(canvas).toHaveCount(1);await expect(start).toBeVisible();
  await start.click();
  await page.keyboard.press(cashDeck(42)[0].valid?'ArrowRight':'ArrowLeft');
  await expect(page.locator('.ad-controls .ad-meta')).toContainText('已分類 1 / 30');
});

test('AD-6 render exception recovers paused, keeps progress and resumes action cooldowns only on Continue',async({page})=>{
  test.setTimeout(120_000);await openGame(page,'cash');
  const deck=cashDeck(42),progress=page.locator('.ad-controls .ad-meta');
  await page.keyboard.press(deck[0].valid?'ArrowRight':'ArrowLeft');
  await expect(progress).toContainText('已分類 1 / 30');
  // Expire the first action's cooldown so it cannot mask a broken pause guard.
  await page.clock.fastForward(180);
  // Throw from a real render call after initialization, rather than dispatching
  // contextlost (which has its own, already-paused callback).
  await page.evaluate(()=>{
    const prototype=WebGL2RenderingContext.prototype,original=prototype.drawElements;
    prototype.drawElements=function(...args){prototype.drawElements=original;throw Error('Synthetic active-render failure');};
  });
  await page.clock.fastForward(16);
  await expect(page.getByRole('alert')).toHaveText('3D 畫面暫時中斷。按重試恢復這一局。');
  await page.getByRole('button',{name:'重試場景',exact:true}).click();
  // Reconstruction has the same bounded readiness phase as initial load and import retry.
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
  const resume=page.getByRole('button',{name:'繼續這一局',exact:true});
  await expect(resume).toBeVisible();await expect(page.locator('.ad-stage canvas')).toHaveCount(1);
  await page.keyboard.press(deck[1].valid?'ArrowRight':'ArrowLeft');
  await expect(progress).toContainText('已分類 1 / 30');
  await resume.click();
  for(let i=1;i<3;i++){
    await page.clock.fastForward(180);
    await page.keyboard.press(deck[i].valid?'ArrowRight':'ArrowLeft');
    await expect(progress).toContainText(`已分類 ${i+1} / 30`);
  }
});

test('AD-6 factory failure releases an unreturned stage and retry creates exactly one healthy canvas',async({page})=>{
  test.setTimeout(120_000);
  await page.addInitScript(()=>{
    const prototype=WebGL2RenderingContext.prototype,original=prototype.compileShader;
    prototype.compileShader=function(...args){
      if(document.querySelector('.ad-stage canvas')){
        prototype.compileShader=original;
        (window as unknown as {failedStageContext:WebGL2RenderingContext}).failedStageContext=this;
        throw Error('Synthetic pre-return environment failure');
      }
      return original.apply(this,args);
    };
  });
  await page.goto('/play?game=cash&seed=42');
  await expect(page.getByRole('alert')).toContainText('此瀏覽器暫時無法開啟 3D 場景');
  await expect(page.locator('.ad-stage canvas')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {failedStageContext:WebGL2RenderingContext}).failedStageContext.isContextLost())).toBe(true);
  await page.getByRole('button',{name:'重試場景',exact:true}).click();
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
  await expect(page.locator('.ad-stage canvas')).toHaveCount(1);
  await page.getByRole('button',{name:'開始這一局',exact:true}).click();
  await page.keyboard.press(cashDeck(42)[0].valid?'ArrowRight':'ArrowLeft');
  await expect(page.locator('.ad-controls .ad-meta')).toContainText('已分類 1 / 30');
});

test('AD-7 importing preserves an existing draft and refuses to overwrite its image',async({page})=>{
  await page.goto('/');await login(page);await navigate(page,'社群分享');
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'建立貼文',exact:true});await dialog.getByLabel('貼文內容',{exact:true}).fill('原本的作品草稿');
  const image=await sharp({create:{width:24,height:24,channels:3,background:'#ed624a'}}).png().toBuffer();
  await dialog.getByLabel('貼文圖片（選填）').setInputFiles({name:'原圖.png',mimeType:'image/png',buffer:image});
  await expect(dialog.getByRole('img',{name:'待發布圖片預覽'})).toHaveJSProperty('naturalWidth',24);
  const draft=await artifact();await putArtifact(page,draft);await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();
  const notice=page.getByRole('complementary',{name:'剛才的遊戲成果'});
  await expect(notice.getByRole('button',{name:'帶圖建立貼文',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'建立貼文',exact:true}).click();
  await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue('原本的作品草稿');
  await dialog.getByRole('button',{name:'移除圖片',exact:true}).click();await dialog.getByRole('button',{name:'關閉發文',exact:true}).click();
  await notice.getByRole('button',{name:'帶圖建立貼文',exact:true}).click();
  await expect(dialog.getByLabel('貼文內容',{exact:true})).toHaveValue(`原本的作品草稿\n\n${draft.text}`);
  await expect(dialog.getByRole('img',{name:'待發布圖片預覽'})).toHaveJSProperty('naturalWidth',1200);
});

test('AD-6 WebGL loss has a recoverable boundary and public layouts fit narrow, wide and landscape viewports',async({page})=>{
  await openGame(page,'cash');
  for(const [width,height] of [[320,568],[667,375],[768,1024],[1440,900]]){
    await page.setViewportSize({width,height});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.locator('.ad-stage canvas').evaluate(c=>c.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  await expect(page.getByRole('button',{name:'重試場景',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重試場景',exact:true}).click();
  // Reconstruction has the same bounded readiness phase as initial load and import retry.
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.ad-stage canvas')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
  await page.getByRole('button',{name:'← 遊樂場',exact:true}).click();await expect(page.locator('.ad-stage canvas')).toHaveCount(0);
  await expect(page.locator('.ad-game-card')).toHaveCount(3);
});

import {RECIPES,recipeOf,type Recipe,type Technique} from '../../apps/portal-web/src/games/cooking/catalog.js';
import {actCooking,advanceCooking,cookingScore,currentStep,newCookingRun,type CookingAction,type CookingRun} from '../../apps/portal-web/src/games/cooking/domain.js';
import {COOKBOOK_KEY,COOKING_RUN_KEY} from '../../apps/portal-web/src/games/cooking/storage.js';
async function openKitchen(page:Page,id:string){
  await page.clock.install({time:new Date('2026-10-25T02:00:00Z')});await page.goto(`/play?game=kitchen&practice=1&recipe=${id}&seed=42`);
  await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();await expect(page.locator('.ck-visual-3d')).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-25T02:01:00Z'));await page.getByRole('button',{name:'開始料理',exact:true}).click();
}

// UX-7: derive checkpoints by actually completing every previous domain step.
// No invented score, report, elapsed time or privileged application endpoint.
function kitchenCheckpoint(kind:Technique|'result'){
  const recipe=kind==='result'?recipeOf('rice-balls')!:RECIPES.find(r=>r.steps.some((s,i)=>s.kind===kind&&(kind!=='bake'||i<r.steps.length-1)))!,target=kind==='result'?recipe.steps.length:recipe.steps.findIndex(s=>s.kind===kind);let run=newCookingRun(recipe,42,'toy_checkpoint'),now=0;
  const act=(action:Omit<CookingAction,'step'>)=>{run=actCooking(run,{...action,step:run.step} as CookingAction,now);};
  const time=(ms:number)=>{const end=now+ms;while(now<end){now=Math.min(end,now+50);run=advanceCooking(run,now);}};
  act({kind:'start'});
  for(let i=0;i<target;i++){
    const s=currentStep(run);
    if(['slice','mix','plate','fold'].includes(s.kind))for(let j=0;j<s.goal;j++){time(160);if(s.kind==='fold')run=actCooking(run,{kind:'fold',index:run.active.count,direction:s.directions[j],step:run.step},now);else act({kind:s.kind==='slice'?'cut-key':s.kind==='mix'?'stir-key':'place-key'});}
    if(s.kind==='knead')for(let j=0;j<s.goal;j++){act({kind:'hold-start'});time(s.holdMs);act({kind:'hold-end'});time(160);}
    if(s.kind==='pour'){act({kind:'hold-start'});time(s.durationMs*s.target);act({kind:'hold-end'});}
    if(['pan','boil','bake'].includes(s.kind)){run=actCooking(run,{kind:'heat',value:s.heat,step:run.step},now);for(let t=0;t<400&&run.status==='playing';t++){time(50);if(s.kind==='pan'&&run.active.amount>=.55)act({kind:'flip'});if(s.kind==='boil'&&run.active.foam>=.2)act({kind:'skim'});if(s.kind==='bake'&&run.active.amount>=.8)act({kind:'take-out'});}}
    if(run.status==='step-result')act({kind:'next'});else expect(run.status).toBe('done');
  }
  if(kind!=='result')act({kind:'pause'});return {recipe,run};
}

test('UX-7: the real pan, boiling pot and oven accept direct scene taps with the same persisted rules',async({page})=>{
  test.setTimeout(120000);await page.setViewportSize({width:390,height:844});await page.clock.install();await page.goto('/play');
  for(const kind of ['pan','boil','bake'] as const){await page.goto('/play');const f=kitchenCheckpoint(kind);await page.evaluate(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`);await expect(page.locator('.ck-visual-3d')).toBeVisible();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));await page.getByRole('button',{name:'繼續料理',exact:true}).click();await page.getByRole('button',{name:'中火',exact:true}).click();await page.clock.runFor(currentStep(f.run).durationMs*(kind==='bake'?.8:.55));await page.locator('.ck-scene').scrollIntoViewIfNeeded();const p=await scenePoint(page,.5,.5);await page.mouse.click(p.x,p.y);await page.locator('.ck-game').press('Escape');const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run as CookingRun,COOKING_RUN_KEY);if(kind==='pan')expect(saved.active.flipped).toBe(true);if(kind==='boil'){expect(saved.active.count).toBe(1);expect(saved.active.foam).toBe(0);}if(kind==='bake'){expect(saved.reports).toHaveLength(f.run.step+1);expect(saved.reports.at(-1)!.score).toBeGreaterThanOrEqual(85);}}
});

test('UX-7: loading never starts the clock; late completion requires retry and real context loss keeps the same dish',async({page})=>{
  test.setTimeout(90000);await page.clock.install();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));
  let capture!:(route:Route)=>void;const requested=new Promise<Route>(resolve=>{capture=resolve;});await page.route('**/assets/kitchen-stage-*.js',route=>{capture(route);});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/play?game=kitchen&practice=1&recipe=egg-fried-rice&seed=42',{waitUntil:'domcontentloaded'});const route=await requested,response=await route.fetch(),url=route.request().url();
  await expect(page.locator('.ck-visual-loading')).toBeVisible();await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeDisabled();expect(await page.evaluate(key=>sessionStorage.getItem(key),COOKING_RUN_KEY)).toBeNull();await page.clock.fastForward(14999);await expect(page.locator('.ck-visual-loading')).toBeVisible();await page.clock.fastForward(1);await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(page.locator('.ck-kitchen-canvas canvas')).toHaveCount(0);
  await page.getByRole('button',{name:'開始料理',exact:true}).click();await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toHaveText('1 / 6');await route.fulfill({response});await page.evaluate(async value=>{await import(value);},url);await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(page.locator('.ck-kitchen-canvas canvas')).toHaveCount(0);
  await page.getByRole('button',{name:'立體料理台',exact:true}).click();await expect(page.locator('.ck-visual-3d')).toBeVisible();await expect(page.locator('.ck-meter-copy')).toHaveText('1 / 6');
  const old=await page.locator('.ck-kitchen-canvas canvas').evaluateHandle(c=>(c as HTMLCanvasElement).getContext('webgl2')!);await old.evaluate(gl=>gl.getExtension('WEBGL_lose_context')!.loseContext());await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(page.locator('.ck-kitchen-canvas canvas')).toHaveCount(0);await page.clock.runFor(160);await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toHaveText('2 / 6');await page.getByRole('button',{name:'立體料理台',exact:true}).click();await expect(page.locator('.ck-visual-3d')).toBeVisible();await expect(page.locator('.ck-kitchen-canvas canvas')).toHaveCount(1);await expect(page.locator('.ck-meter-copy')).toHaveText('2 / 6');expect(await old.evaluate(gl=>gl.isContextLost())).toBe(true);await old.dispose();
  const active=await page.locator('.ck-kitchen-canvas canvas').evaluateHandle(c=>(c as HTMLCanvasElement).getContext('webgl2')!);await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await expect(page.locator('.ck-kitchen-canvas canvas')).toHaveCount(0);expect(await active.evaluate(gl=>gl.isContextLost())).toBe(true);await active.dispose();expect(errors).toEqual([]);
});

test.describe('UX-7 real touch cooking',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
  test('the rendered dough receives a native touch hold and releases once at the real timing target',async({page})=>{
    await openKitchen(page,'margherita-pizza');await expect(page.locator('.ck-visual-3d')).toBeVisible();const p=await scenePoint(page,.5,.5),cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await page.clock.runFor(750);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.locator('.ck-meter-copy')).toHaveText('1 / 4');const canvas=page.locator('.ck-kitchen-canvas canvas');expect(await canvas.evaluate(c=>(c as HTMLCanvasElement).width)).toBeLessThanOrEqual(960);expect(await canvas.evaluate(c=>(c as HTMLCanvasElement).height)).toBeLessThanOrEqual(672);const stats=await page.locator('.ck-kitchen-canvas').evaluate(el=>({...el.dataset}));expect(Number(stats.renderCalls)).toBeGreaterThan(0);expect(Number(stats.renderCalls)).toBeLessThanOrEqual(100);expect(Number(stats.renderGeometries)).toBeLessThan(100);expect(Number(stats.renderTextures)).toBeLessThanOrEqual(3);await cdp.detach();
  });
});

test('UX-7: a failed kitchen renderer loads the usable illustration, and a draw fault preserves the same dish',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/assets/kitchen-stage-*.js',route=>route.abort());await page.goto('/play?game=kitchen&practice=1&recipe=egg-fried-rice&seed=42');await expect(page.locator('.ck-visual-light')).toBeVisible();await page.getByRole('button',{name:'開始料理',exact:true}).click();await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toHaveText('1 / 6');await page.unroute('**/assets/kitchen-stage-*.js');await page.reload();await expect(page.locator('.ck-visual-3d')).toBeVisible();await page.getByRole('button',{name:'繼續料理',exact:true}).click();
  const clear=await page.evaluateHandle(()=>WebGL2RenderingContext.prototype.clear);await page.evaluate(()=>{WebGL2RenderingContext.prototype.clear=function(){throw Error('Synthetic toy kitchen draw fault');};});await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(page.locator('.ck-kitchen-canvas canvas')).toHaveCount(0);await expect(page.locator('.ck-meter-copy')).toHaveText('1 / 6');await page.evaluate(original=>{WebGL2RenderingContext.prototype.clear=original;},clear);await clear.dispose();await page.getByRole('button',{name:'立體料理台',exact:true}).click();await expect(page.locator('.ck-visual-3d')).toBeVisible();await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toHaveText('2 / 6');expect(errors).toEqual([]);
});
async function scenePoint(page:Page,x:number,y:number){const box=await page.locator('.ck-scene').boundingBox();expect(box).toBeTruthy();return {x:box!.x+x*box!.width,y:box!.y+y*box!.height};}
async function playRecipe(page:Page,recipe:Recipe){
  for(let index=0;index<recipe.steps.length;index++){
    const s=recipe.steps[index];await expect(page.locator('[data-cooking-scene]')).toHaveAttribute('data-cooking-scene',s.kind);
    if(['knead','pan','boil','bake','pour'].includes(s.kind)){await expect(page.getByRole('meter')).toBeVisible();await expect(page.getByRole('meter')).toHaveAttribute('aria-valuetext',/目標/);}
    if(s.kind==='slice')for(let i=0;i<s.goal;i++){await page.clock.runFor(160);const x=.22+.56*(i+1)/(s.goal+1),from=await scenePoint(page,x,.23),to=await scenePoint(page,x,.78);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();}
    if(s.kind==='mix'){const first=await scenePoint(page,.8,.52);await page.mouse.move(first.x,first.y);await page.mouse.down();for(let i=1;i<=s.goal*32;i++){const angle=i*Math.PI/16,p=await scenePoint(page,.5+.3*Math.cos(angle),.52+.3*Math.sin(angle));await page.mouse.move(p.x,p.y);}await page.mouse.up();}
    if(s.kind==='knead')for(let i=0;i<s.goal;i++){await page.locator('.ck-game').focus();await page.keyboard.down('Space');await page.clock.runFor(s.holdMs);await page.keyboard.up('Space');await page.clock.runFor(160);}
    if(s.kind==='pan'||s.kind==='boil'||s.kind==='bake'){const slider=page.getByRole('slider'),box=await slider.boundingBox();await slider.click({position:{x:8+(box!.width-16)*s.heat/100,y:box!.height/2}});
      if(s.kind==='pan'){await page.clock.runFor(s.durationMs*.55);await page.getByRole('button',{name:'翻面！',exact:true}).click();await page.clock.runFor(s.durationMs*.65);}
      if(s.kind==='boil'){for(let i=0;i<3;i++){await page.clock.runFor(2300);const skim=page.getByRole('button',{name:/撈掉泡沫/});if(await skim.isEnabled())await skim.click();}await page.clock.runFor(3000);}
      if(s.kind==='bake'){await page.clock.runFor(s.durationMs*.8);await page.getByRole('button',{name:'出爐！',exact:true}).click();}}
    if(s.kind==='pour'){await page.locator('.ck-game').focus();await page.keyboard.down('Space');await page.clock.runFor(s.durationMs*s.target);await page.keyboard.up('Space');}
    if(s.kind==='fold')for(const direction of s.directions){await page.clock.runFor(160);await page.locator('.ck-game').focus();await page.keyboard.press(`Arrow${direction[0].toUpperCase()+direction.slice(1)}`);}
    if(s.kind==='plate')for(let i=0;i<s.goal;i++){await page.clock.runFor(160);const start=await scenePoint(page,.1275,.535),angle=-Math.PI/2+i*2*Math.PI/s.goal,target=await scenePoint(page,.5+.23*Math.cos(angle),.53+.18*Math.sin(angle));await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:6});await page.mouse.up();}
    if(index<recipe.steps.length-1){await expect(page.getByRole('button',{name:/^下一步：/})).toBeVisible();await page.getByRole('button',{name:/^下一步：/}).click();}
  }
  // UX-T3: only after persisted settlement, let native WebP decoding/toBlob run on real frames.
  expect(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run.status,COOKING_RUN_KEY)).toBe('done');await page.clock.resume();
  await expect(page.locator('.ad-result')).toBeVisible();await expect(page.locator('[data-dish-view="ready"]')).toBeVisible();await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();await expect(page.locator('.ad-result-heading')).toContainText(recipe.name);
  await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+100));
}
test('UX-7: a real-clock 3D cooking journey completes mixing, timed kneading and folding into a shareable result',async({page})=>{
  const recipe=recipeOf('rice-balls')!,errors:string[]=[];let posts=0;page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts++;});await page.setViewportSize({width:390,height:844});await page.goto('/play?game=kitchen&practice=1&recipe=rice-balls&seed=42');await expect(page.locator('.ck-visual-3d')).toBeVisible();await page.getByRole('button',{name:'開始料理',exact:true}).click();
  for(const [index,s]of recipe.steps.entries()){
    if(s.kind==='mix'){const first=await scenePoint(page,.8,.52);await page.mouse.move(first.x,first.y);await page.mouse.down();for(let i=1;i<=s.goal*32;i++){const a=i*Math.PI/16,p=await scenePoint(page,.5+.3*Math.cos(a),.52+.3*Math.sin(a));await page.mouse.move(p.x,p.y);}await page.mouse.up();}
    if(s.kind==='knead')for(let i=0;i<s.goal;i++){await page.locator('.ck-game').focus();await page.keyboard.down('Space');await page.waitForTimeout(s.holdMs);await page.keyboard.up('Space');await page.waitForTimeout(160);}
    if(s.kind==='fold')for(const direction of s.directions){await page.waitForTimeout(160);await page.locator('.ck-game').focus();await page.keyboard.press(`Arrow${direction[0].toUpperCase()+direction.slice(1)}`);}
    if(index<recipe.steps.length-1)await page.getByRole('button',{name:/^下一步：/}).click();
  }
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toHaveAttribute('href',/^blob:/);const book=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COOKBOOK_KEY);expect(book.best['rice-balls'].score).toBeGreaterThanOrEqual(85);expect(posts).toBe(0);expect(errors).toEqual([]);
});

for(const id of ['egg-fried-rice','rice-balls','chocolate-brownie','pearl-milk-tea'])test(`CK-5: ${id} completes through real scene gestures and keyboard cooking controls`,async({page})=>{
  test.setTimeout(120_000);await page.setViewportSize({width:390,height:844});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openKitchen(page,id);await playRecipe(page,recipeOf(id)!);
  await socialEntries(page,'kitchen');
  const book=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COOKBOOK_KEY);expect(book.best[id].score).toBeGreaterThanOrEqual(60);expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('CK-3/7: categories, favorites, empty results, history and a real paused checkpoint survive reload',async({page})=>{
  await page.goto('/play');await expect(page.locator('.ck-recipe-card')).toHaveCount(8);await page.getByRole('button',{name:/日式料理/}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(8);await page.getByRole('button',{name:'收藏海苔飯糰',exact:true}).click();await page.getByRole('combobox',{name:'食譜篩選',exact:true}).selectOption('favorite');await expect(page.locator('.ck-recipe-card')).toHaveCount(1);
  await page.getByRole('searchbox').fill('不存在的料理');await expect(page.getByRole('heading',{name:'把喜歡的菜，留在這一頁。'})).toBeVisible();await page.getByRole('searchbox').fill('');await page.getByRole('button',{name:'開始製作海苔飯糰',exact:true}).click();await page.getByRole('button',{name:'開始料理',exact:true}).click();await page.getByRole('button',{name:'攪拌一圈 ↻',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toContainText('1.0 / 2 圈');await page.getByRole('button',{name:'暫停',exact:true}).click();
  const before=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);await page.reload();await expect(page.getByRole('button',{name:'繼續料理',exact:true})).toBeVisible();expect(await page.locator('.ck-meter-copy').innerText()).toContain('1.0 / 2 圈');await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(8);await page.goBack();await expect(page.getByRole('button',{name:'繼續料理',exact:true})).toBeVisible();const after=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);expect(after.run.id).toBe(before.run.id);
});
test('CK-6: a real cooking result opens a confirmed platform draft without automatically publishing',async({page})=>{
  test.setTimeout(120_000);let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/social-posts/notes'))writes++;});await openKitchen(page,'egg-fried-rice');await playRecipe(page,recipeOf('egg-fried-rice')!);await page.getByRole('button',{name:'發到自由工坊',exact:true}).click();await page.clock.resume();await expect(page).toHaveURL(/game-share=1/);await login(page);const draft=page.getByRole('dialog',{name:'建立貼文',exact:true});await expect(draft.getByRole('img',{name:'待發布圖片預覽'})).toHaveJSProperty('naturalWidth',1200);expect(await draft.getByLabel('貼文內容',{exact:true}).inputValue()).toContain('recipe=egg-fried-rice');expect(writes).toBe(0);await draft.getByRole('button',{name:'關閉發文',exact:true}).click();
});

test('CK-6: native file/link payloads, denied clipboard and external intent preserve the actual cooking result',async({page,context})=>{
  test.setTimeout(120_000);await openKitchen(page,'egg-fried-rice');await playRecipe(page,recipeOf('egg-fried-rice')!);
  await expect(page.locator('.ad-result-heading h1')).toHaveText(recipeOf('egg-fried-rice')!.name);await expect(page.locator('.ad-result-heading [aria-label="料理分數"]')).toHaveText(/^\d+分$/);await expect(page.locator('.ad-result')).not.toContainText('顆星');
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:async(data:ShareData)=>{(window as any).shared={text:data.text,url:data.url,files:data.files?.map(f=>({name:f.name,type:f.type,size:f.size}))};}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});
  });
  await page.getByRole('button',{name:'分享到 Instagram',exact:true}).click();await page.getByRole('button',{name:'用系統選單選 Instagram',exact:true}).click();await expect(page.getByText('已交給系統分享選單。',{exact:true})).toBeVisible();
  const file=await page.evaluate(()=>(window as any).shared);expect(file.text).toContain('recipe=egg-fried-rice');expect(file.files).toHaveLength(1);expect(file.files[0].type).toBe('image/png');expect(file.files[0].size).toBeGreaterThan(10000);
  await page.getByRole('button',{name:'複製分享文案',exact:true}).click();await expect(page.getByRole('textbox',{name:'分享文案',exact:true})).toHaveValue(/recipe=egg-fried-rice/);
  await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();
  const link=await page.evaluate(()=>(window as any).shared);expect(link.url).toContain('recipe=egg-fried-rice');expect(link.files).toBeUndefined();
  await context.route('https://x.com/**',route=>route.fulfill({status:200,contentType:'text/plain',body:'Isolated share destination fixture'}));await page.getByRole('button',{name:'分享到 X',exact:true}).click();
  const popupPromise=context.waitForEvent('page');await page.getByRole('link',{name:'開啟 X 分享 ↗',exact:true}).click();const popup=await popupPromise;await popup.waitForURL('https://x.com/intent/tweet?**');expect(new URL(popup.url()).searchParams.get('text')).toContain('recipe=egg-fried-rice');await popup.close();await expect(page.locator('.ad-result')).toBeVisible();
  await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();await expect(page.getByRole('textbox',{name:'同題連結',exact:true})).toHaveValue(/recipe=egg-fried-rice/);await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();
});

test('CK-7: previewing another recipe preserves the unfinished dish and returning keeps lobby filters',async({page})=>{
  await page.goto('/play');await page.getByRole('button',{name:/日式料理/}).click();await page.getByRole('button',{name:'開始製作海苔飯糰',exact:true}).click();await page.getByRole('button',{name:'開始料理',exact:true}).click();await page.getByRole('button',{name:'攪拌一圈 ↻',exact:true}).click();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(8);
  const before=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);await page.getByRole('button',{name:'開始製作蝦子天婦羅',exact:true}).click();await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();
  const after=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);expect(after.run.id).toBe(before.run.id);await page.getByRole('button',{name:'開始製作海苔飯糰',exact:true}).click();await expect(page.getByRole('button',{name:'繼續料理',exact:true})).toBeVisible();await expect(page.locator('.ck-meter-copy')).toContainText('1.0 / 2 圈');
});
test('CK-2/7: unavailable artwork and storage have usable fallbacks, while an unknown recipe returns the lobby',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Synthetic quota','QuotaExceededError');};});await page.route('**/games/absurd-daily/cooking/3d/*.webp',route=>route.abort());await page.route('**/games/absurd-daily/illustrated/*.webp',route=>route.abort());await page.goto('/play?game=kitchen&practice=1&recipe=unknown&seed=42');await expect(page.getByRole('status').filter({hasText:'這道料理連結無法辨識'})).toBeVisible();const fallback=await page.locator('.ck-recipe-card').first().locator('.sg-cover-fallback').boundingBox(),owner=await page.locator('.ck-recipe-card').first().locator('.ck-recipe-visual').boundingBox();expect(fallback!.y+fallback!.height).toBeLessThanOrEqual(owner!.y+owner!.height);await page.getByRole('button',{name:'收藏黃金蛋炒飯',exact:true}).click();await expect(page.getByRole('button',{name:'重試保存食譜本',exact:true})).toBeVisible();await page.goto('/play?game=kitchen&practice=1&recipe=egg-fried-rice&seed=42');await expect(page.locator('.sg-cover-fallback')).toBeVisible();await page.getByRole('button',{name:'開始料理',exact:true}).click();await expect(page.locator('.ck-art-fallback')).toBeVisible();await expect(page.getByRole('button',{name:'重試保存',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'沿線切一刀',exact:true})).toBeEnabled();
});

test('CK-8: enlarged real recipe text keeps the start/resume action inside its owner on compact and landscape screens',async({page})=>{
  for(const viewport of [{width:320,height:568},{width:667,height:375}]){
    await page.setViewportSize(viewport);await page.goto('/play?game=kitchen&practice=1&recipe=strawberry-cake&seed=42');await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();
    await page.evaluate(()=>{const styles=[...document.querySelectorAll('.ad-root,.ad-root *')].filter(e=>e instanceof HTMLElement).map(e=>({e:e as HTMLElement,font:parseFloat(getComputedStyle(e).fontSize),line:parseFloat(getComputedStyle(e).lineHeight)}));for(const {e,font,line}of styles){e.style.fontSize=`${font*2}px`;if(Number.isFinite(line))e.style.lineHeight=`${line*2}px`;}});
    const contained=()=>page.locator('.ck-scene-overlay').evaluate(e=>{const button=e.querySelector('button')!.getBoundingClientRect(),owner=e.getBoundingClientRect();return button.top>=owner.top&&button.bottom<=owner.bottom&&button.left>=owner.left&&button.right<=owner.right;});
    expect(await contained()).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'開始料理',exact:true}).click();await page.getByRole('button',{name:'暫停',exact:true}).click();expect(await contained()).toBe(true);await page.getByRole('button',{name:'繼續料理',exact:true}).click();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await page.evaluate(()=>sessionStorage.removeItem('freedom.cooking.run.v1'));
  }
});

test('CK-3: the playroom browses all game types, pages dishes and separates favorite hit areas from starting a game',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/play');await expect(page.locator('.ck-recipe-card')).toHaveCount(8);await page.getByRole('button',{name:'再看看 8 道料理',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(16);
  const open=await page.getByRole('button',{name:'開始製作黃金蛋炒飯',exact:true}).boundingBox(),favorite=await page.getByRole('button',{name:'收藏黃金蛋炒飯',exact:true}).boundingBox();expect(open!.y+open!.height).toBeLessThanOrEqual(favorite!.y);await page.getByRole('button',{name:'收藏黃金蛋炒飯',exact:true}).click();await expect(page).toHaveURL(/\/play$/);
  await page.getByRole('button',{name:'觀察攝影 1',exact:true}).click();await expect(page.locator('.ad-game-card')).toHaveCount(1);await expect(page.locator('.ck-recipe-card')).toHaveCount(0);
  await page.getByRole('button',{name:'反應手速 5',exact:true}).click();await expect(page.locator('.ad-game-card')).toHaveCount(2);await expect(page.locator('.pt-party-card')).toHaveCount(3);await page.getByRole('button',{name:'料理小遊戲 66',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(16);
  await page.getByRole('button',{name:/♡ 我的收藏/}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(1);await page.getByRole('button',{name:'這道我來做',exact:true}).click();await expectNativeMarketReady(page);await page.getByRole('button',{name:'← 大廳',exact:true}).click();await expect(page.getByRole('combobox',{name:'食譜篩選',exact:true})).toHaveValue('favorite');await expect(page.locator('.ck-recipe-card')).toHaveCount(1);
});


test('UX-8: the native completed meal rotates with pointer and keyboard, keeps score through context loss and releases on return',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const f=kitchenCheckpoint('result');await page.addInitScript(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);await page.setViewportSize({width:390,height:844});await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`);await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15_000});await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();
  const canvas=page.locator('.ck-dish-canvas canvas'),surface=page.locator('.ck-dish-surface'),score=await page.locator('.ad-result-heading').innerText();await surface.scrollIntoViewIfNeeded();const before=await canvas.screenshot(),box=(await surface.boundingBox())!;await page.mouse.move(box.x+box.width*.35,box.y+box.height*.5);await page.mouse.down();await surface.dispatchEvent('pointercancel',{pointerId:99,isPrimary:false});await page.mouse.move(box.x+box.width*.72,box.y+box.height*.5,{steps:8});await page.mouse.up();expect((await canvas.screenshot()).equals(before)).toBe(false);await page.getByRole('button',{name:'回正',exact:true}).click();expect((await canvas.screenshot()).equals(before)).toBe(true);await surface.focus();await page.keyboard.press('ArrowLeft');expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole('button',{name:'回正',exact:true}).click();await surface.scrollIntoViewIfNeeded();const touchBox=(await surface.boundingBox())!,cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});const cy=touchBox.y+touchBox.height*.5,cx=touchBox.x+touchBox.width*.5;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-25,y:cy,id:1},{x:cx+25,y:cy,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-65,y:cy,id:1},{x:cx+65,y:cy,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});expect((await canvas.screenshot()).equals(before)).toBe(false);await page.getByRole('button',{name:'回正',exact:true}).click();expect((await canvas.screenshot()).equals(before)).toBe(true);await cdp.detach();
  const old=await canvas.evaluateHandle(c=>(c as HTMLCanvasElement).getContext('webgl2')!);await old.evaluate(gl=>gl.getExtension('WEBGL_lose_context')!.loseContext());await expect(page.locator('[data-dish-view="fallback"]')).toBeVisible();await expect(canvas).toHaveCount(0);expect(await page.locator('.ad-result-heading').innerText()).toBe(score);await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();await page.getByRole('button',{name:'重試3D成品',exact:true}).click();await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15_000});expect(await old.evaluate(gl=>gl.isContextLost())).toBe(true);await old.dispose();
  const current=await canvas.evaluateHandle(c=>(c as HTMLCanvasElement).getContext('webgl2')!);await page.getByRole('button',{name:'回遊樂場',exact:true}).click();await expect(canvas).toHaveCount(0);expect(await current.evaluate(gl=>gl.isContextLost())).toBe(true);await current.dispose();expect(errors).toEqual([]);
});

test('UX-8: a delayed real dish-view module has a finite fallback, ignores late completion and retries without losing the poster',async({page})=>{
  test.setTimeout(60000);const f=kitchenCheckpoint('result');await page.addInitScript(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);await page.clock.install();let capture!:(route:Route)=>void;const requested=new Promise<Route>(resolve=>{capture=resolve;});await page.route('**/assets/dish-stage-*.js',route=>capture(route));await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`,{waitUntil:'domcontentloaded'});const route=await requested,response=await route.fetch(),url=route.request().url();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+100));await page.clock.fastForward(15000);await expect(page.locator('[data-dish-view="fallback"]')).toBeVisible();await expect(page.locator('.ck-dish-canvas canvas')).toHaveCount(0);await route.fulfill({response});await page.evaluate(async u=>{await import(u);},url);await expect(page.locator('[data-dish-view="fallback"]')).toBeVisible();await page.getByRole('button',{name:'重試3D成品',exact:true}).click();await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15_000});await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();
});

// UX-9: drive the production UI. Virtual foreground frames shorten cooking, never seed a finished score.
async function marketTime(page:Page,ms:number){while(ms>0){const delta=Math.min(ms,1000);await page.clock.fastForward(delta);ms-=delta;}}
async function expectNativeMarketReady(page:Page,name:'開火，開始做！'|'繼續這一盤'='開火，開始做！'){
  const game=page.locator('.mk-game');
  await expect(game.getByRole('button',{name,exact:true})).toBeVisible({timeout:15_000});
  await expect(game.locator('.mk-fallback')).toHaveCount(0);
  await expect(game.locator('.mk-canvas canvas')).toHaveCount(1);
  await expect(game.getByRole('status').filter({hasText:'正在準備料理台…'})).toHaveCount(0);
}
async function marketOpen(page:Page,id:MarketId){await page.clock.install();await page.setViewportSize({width:390,height:844});await page.goto(`/play?game=kitchen&recipe=${id}&seed=42`);await expectNativeMarketReady(page);await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));await page.getByRole('button',{name:'開火，開始做！',exact:true}).click();await page.clock.runFor(20);}
async function marketButton(page:Page,name:string){await marketTime(page,400);await page.getByRole('button',{name,exact:true}).click();}
async function marketAdd(page:Page,name:string){await marketTime(page,400);await page.locator('.mk-ingredients').getByRole('button',{name:new RegExp(`^${name} `)}).click();}
for(const id of ['egg-fried-rice','steak-dinner','shawarma','corn-dog'] as MarketId[])test(`UX-9: ${id} cooks through actual controls to its own inspectable, downloadable and shareable result`,async({page},testInfo)=>{
 test.setTimeout(120000);const errors:string[]=[];let posts=0;page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts++;});await marketOpen(page,id);
 if(id==='corn-dog'){await marketAdd(page,'熱狗');await marketButton(page,'裹麵糊');await marketTime(page,24000);await marketButton(page,'翻這一面');await marketTime(page,24000);await marketButton(page,'起鍋瀝油');await marketTime(page,4000);}
 if(id==='steak-dinner'){await marketAdd(page,'牛排');await marketAdd(page,'薯條');await page.getByRole('combobox',{name:'目前操作的食材'}).selectOption('0');await marketTime(page,23000);await marketButton(page,'翻這一面');await marketTime(page,23000);}
 if(id==='shawarma'){await marketAdd(page,'餅皮');await marketTime(page,6000);for(let i=0;i<4;i++)await marketButton(page,'削一刀');await marketAdd(page,'生菜');await marketAdd(page,'番茄');for(let i=0;i<3;i++)await marketButton(page,`包一折 · ${i}/3`);}
 if(id==='egg-fried-rice'){await marketAdd(page,'白飯');await marketAdd(page,'雞蛋');await marketAdd(page,'蝦仁');for(let i=0;i<10;i++){await marketTime(page,2000);await marketButton(page,'拋鍋！');}}
 await marketButton(page,'一撮鹽 · 0');await page.getByRole('button',{name:'蒜味醬',exact:true}).click();const surface=page.locator('.mk-surface');await surface.scrollIntoViewIfNeeded();const b=(await surface.boundingBox())!;await page.mouse.move(b.x+b.width*.35,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.6,{steps:10});await page.mouse.up();await marketTime(page,400);const before=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(before.sauces).toHaveLength(1);await page.getByRole('button',{name:'上桌，看看我的手藝！ ↗',exact:true}).click();await page.clock.resume();await expect(page.locator('[data-dish-view="ready"]')).toBeVisible();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();const completed=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(completed.status).toBe('done');await expect(page.locator('.mk-score>div>strong')).toHaveText(`${marketGrade(completed).score}分`);await expect(page.getByRole('region',{name:'料理分數',exact:true})).toHaveText(`${marketGrade(completed).score}分`);await expect(page.locator('.ad-result-heading h1')).toHaveText(recipeOf(id)!.name);await expect(page.locator('.ad-result')).not.toContainText(marketGrade(completed).title);await expect(page.locator('.mk-score svg,.mk-score dl,.mk-score blockquote')).toHaveCount(0);expect(completed.portions).toHaveLength(before.portions.length);await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();const canvas=page.locator('.ck-dish-canvas canvas'),original=await canvas.screenshot();await page.getByRole('button',{name:'放大料理',exact:true}).click();expect((await canvas.screenshot()).equals(original)).toBe(false);await page.getByRole('button',{name:'回正',exact:true}).click();expect((await canvas.screenshot()).equals(original)).toBe(true);await page.screenshot({path:testInfo.outputPath(`${id}-result.png`),fullPage:true});const downloading=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG',exact:true}).click();await (await downloading).saveAs(testInfo.outputPath(`${id}-share.png`));
 if(id==='steak-dinner'){await page.setViewportSize({width:390,height:844});await page.screenshot({path:testInfo.outputPath('steak-dinner-phone.png'),fullPage:true});await page.setViewportSize({width:667,height:375});await page.screenshot({path:testInfo.outputPath('steak-dinner-landscape.png'),fullPage:true});}
 await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();const link=await page.getByRole('textbox',{name:'同題連結',exact:true}).inputValue();expect(new URL(link).searchParams.get('practice')).toBeNull();expect(new URL(link).searchParams.get('recipe')).toBe(id);expect(posts).toBe(0);expect(errors).toEqual([]);
});

test('UX-9: WebGL loss, reload and restart confirmation preserve the exact unfinished corn dog and pause its clock',async({page})=>{
 test.setTimeout(90000);await marketOpen(page,'corn-dog');await marketAdd(page,'熱狗');await marketButton(page,'裹麵糊');await marketTime(page,8000);const gl=await page.locator('.mk-canvas canvas').evaluateHandle(c=>(c as HTMLCanvasElement).getContext('webgl2')!);await gl.evaluate(g=>g.getExtension('WEBGL_lose_context')!.loseContext());await page.clock.runFor(40);await expect(page.locator('[data-market-status="paused"]')).toBeVisible();const saved=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);await marketTime(page,10000);expect(await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.elapsed,MARKET_SAVE_KEY)).toBe(saved.elapsed);await page.getByRole('button',{name:'重試3D料理台',exact:true}).click();await expect(page.locator('.mk-canvas canvas')).toBeVisible();expect(await gl.evaluate(g=>g.isContextLost())).toBe(true);await gl.dispose();await page.reload();await expectNativeMarketReady(page,'繼續這一盤');const restored=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(restored.portions).toEqual(saved.portions);await page.locator('.mk-help summary').click();await page.getByRole('button',{name:'重新做這一道',exact:true}).click();await expect(page.getByRole('dialog',{name:'重新做這道料理'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'重新做這一道'})).toBeFocused();await page.getByRole('button',{name:'重新做這一道',exact:true}).click();await page.getByRole('button',{name:'重新開攤',exact:true}).click();const reset=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(reset.status).toBe('ready');expect(reset.portions).toEqual([]);await page.reload();await expectNativeMarketReady(page);
});

test('UX-9: delayed native cooking module falls back after 15 seconds and rejects its late scene before explicit retry',async({page})=>{
 test.setTimeout(60000);await page.clock.install();let take!:(r:Route)=>void;const request=new Promise<Route>(resolve=>{take=resolve;});await page.route('**/assets/market-stage-*.js',r=>take(r));await page.goto('/play?game=kitchen&recipe=corn-dog&seed=42',{waitUntil:'domcontentloaded'});const route=await request,response=await route.fetch(),url=route.request().url();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+100));await page.clock.fastForward(15000);await expect(page.locator('.mk-fallback')).toBeVisible();await expect(page.locator('.mk-canvas canvas')).toHaveCount(0);await page.getByRole('button',{name:'開火，開始做！',exact:true}).click();await page.clock.runFor(20);await marketAdd(page,'熱狗');await route.fulfill({response});await page.evaluate(async u=>{await import(u);},url);await expect(page.locator('.mk-canvas canvas')).toHaveCount(0);await page.getByRole('button',{name:'重試3D料理台',exact:true}).click();await expect(page.locator('.mk-canvas canvas')).toBeVisible();const saved=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(saved.portions).toHaveLength(1);await expect(page.getByRole('button',{name:'繼續這一盤',exact:true})).toBeVisible();
});

test('UX-1/9: lobby can cold-open both a legacy game and a free kitchen without a cooking checkpoint',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/play');await page.locator('.ad-game-card').first().getByRole('button').click();await expect(page.locator('[data-game-stage="ready"]')).toBeVisible();expect(new URL(page.url()).searchParams.get('game')).toBe('photo');await page.goto('/play');await page.getByRole('button',{name:'開始製作酥炸熱狗',exact:true}).click();await expectNativeMarketReady(page);expect(new URL(page.url()).searchParams.get('recipe')).toBe('corn-dog');expect(errors).toEqual([]);
});


// UX-11: the visible food, rather than a stale selected dropdown, owns a direct touch.
test('UX-11: touching a real corn dog selects and flips that piece; lifted food moves to the dressing tray with its own sauce',async({page},testInfo)=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await marketOpen(page,'corn-dog');
 for(let i=0;i<2;i++){await marketAdd(page,'熱狗');await marketButton(page,'裹麵糊');}
 await marketTime(page,22000);await page.getByRole('combobox',{name:'目前操作的食材'}).selectOption('1');
 const surface=page.locator('.mk-surface');await surface.scrollIntoViewIfNeeded();const b=(await surface.boundingBox())!,cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 // The left food's actual camera-projected location at the production 6:5 aspect.
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width*.395,y:b.y+b.height*.433,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 await expect(page.getByRole('combobox',{name:'目前操作的食材'})).toHaveValue('0');const touched=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(touched.portions[0].side).toBe(1);expect(touched.portions[1].side).toBe(0);
 await page.getByRole('combobox',{name:'目前操作的食材'}).selectOption('1');await marketButton(page,'翻這一面');await marketTime(page,22000);
 for(const i of ['0','1']){await page.getByRole('combobox',{name:'目前操作的食材'}).selectOption(i);await marketButton(page,'起鍋瀝油');}
 await expect(page.locator('[data-market-view="dressing"]')).toBeVisible();await expect(page.locator('.mk-surface-hint')).toContainText('起鍋了');await marketTime(page,4000);await page.getByRole('button',{name:'番茄醬',exact:true}).click();await surface.scrollIntoViewIfNeeded();const tray=(await surface.boundingBox())!;
 await page.mouse.move(tray.x+tray.width*.35,tray.y+tray.height*.46);await page.mouse.down();await page.mouse.move(tray.x+tray.width*.47,tray.y+tray.height*.56,{steps:12});await page.mouse.up();await marketTime(page,400);
 const dressed=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(dressed.portions.every(p=>p.lifted&&p.coated&&p.drain>=3000)).toBe(true);expect(dressed.sauces).toHaveLength(1);expect(dressed.sauces[0].points.length).toBeGreaterThan(2);await page.screenshot({path:testInfo.outputPath('corn-dog-dressing.png'),fullPage:true});
 await page.getByRole('button',{name:'上桌，看看我的手藝！ ↗',exact:true}).click();await page.clock.resume();await expect(page.locator('[data-dish-view="ready"]')).toBeVisible();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();expect(errors).toEqual([]);
});
