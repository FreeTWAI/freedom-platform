import {installExportTimingProbe} from './helpers/export-phase-timing.js';
import {partyElapsed,partyAdvance,blockPartyWebGL,openDailyResultShare,socialEntries} from './helpers/party-scene.js';
import {cutGuideAt} from '../../apps/portal-web/src/games/cooking/domain.js';
import {withBoundedCpuProfile} from './helpers/bounded-cpu-profile.js';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import type {RunResult} from '../../apps/portal-web/src/games/result-card.js';
import {test,expect,type Page,type Route} from './fixtures.js';
import {navigate} from './navigation.js';
import {cashDeck,stampTarget} from '../../apps/portal-web/src/games/domain.js';
import {chairWave,holidayTargets,actParty,advanceParty,newParty,startParty,tofuAxis,tofuPosition,type TofuRun} from '../../apps/portal-web/src/games/party/domain.js';
import {PARTY_GAMES,PARTY_RULES as PT,type PartyGameId} from '../../apps/portal-web/src/games/party/catalog.js';
import {GAME_HANDOFF_EVENT,GAME_HANDOFF_KEY,type GameDraft} from '../../apps/portal-web/src/games/result-bridge.js';
import {marketGrade,MARKET_SAVE_KEY,type MarketRun,type MarketId} from '../../apps/portal-web/src/games/cooking/market-domain.js';
const {PerspectiveCamera,Vector3}=createRequire(new URL('../../apps/portal-web/package.json',import.meta.url))('three');

test.afterEach(async({page},testInfo)=>{
  if(testInfo.title!=='UX-15c: completed guided export survives development StrictMode replay and production cold reload'
    &&testInfo.title!=='CK-5: egg-fried-rice completes through real scene gestures and keyboard cooking controls')return;
  const probe=await page.evaluate(()=>{
    const value=(window as unknown as {__exportTimingProbe?:{events:unknown[];dropped:number}}).__exportTimingProbe;
    return value?{events:value.events,dropped:value.dropped,scope:'current production document only; DOM times are observer delivery, not exact mutation time'}:null;
  }).catch(()=>null);
  if(probe)await testInfo.attach('export-phase-timings',{body:JSON.stringify(probe),contentType:'application/json'});
});

async function checkResultRetryOwnership(page:Page,result:RunResult){
  // The development IIFE has no import.meta URL. Serve the actual worker bundle
  // at a same-origin fixture URL; production continues to use Vite's emitted worker.
  const workerEntry=new URL('/__dish-preview-fixture.js',page.url()).href;
  const workerScript=buildSync({entryPoints:[fileURLToPath(new URL('../../apps/portal-web/src/games/cooking/dish-worker.ts',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser'}).outputFiles[0].text;
  await page.context().route('**/dish-worker.ts',route=>route.fulfill({contentType:'text/javascript',body:workerScript}));
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
  `},bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"development"','import.meta.url':JSON.stringify(workerEntry)}}).outputFiles[0].text;
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
    await page.locator('.fw-arcade-photo-choices button').nth(1).click();
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
    await page.locator('.fw-arcade-photo-choices button').nth(0).click();await expect(download).toHaveCount(0);await expect(workshop).toBeDisabled();
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
    await page.locator('.fw-arcade-photo-choices button').nth(1).click();
    await expect.poll(async()=>(await loads())[5]).toEqual({ready:true,released:false,cancelled:false});
    await page.evaluate(()=>(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe.release(5));
    await expect(download).toBeVisible();await expect.poll(()=>jpegReady(4)).toBe(true);
    await page.evaluate(async()=>{const p=(window as unknown as {resultRetryProbe:Probe}).resultRetryProbe;p.unmount();p.releaseJpeg(4);await Promise.resolve();await Promise.resolve();});
    await expect(page.locator('.fw-arcade-result')).toHaveCount(0);
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
    // A restored completed run intentionally avoids rebuilding the kitchen.
    await expect(replay.locator('[data-cooking-visual]')).toHaveAttribute('data-cooking-visual','light');
    await expect(replay.getByRole('button',{name:'料理已完成',exact:true})).toBeDisabled();
    await expect(replay.locator('.ck-kitchen-canvas canvas')).toHaveCount(0);
    // Exercise real restart before retaining the native DOM-ownership checks.
    // Do not require two contexts or claim GPU reclamation.
    await replay.getByRole('button',{name:'重新做',exact:true}).click();
    await replay.getByRole('button',{name:'確定重新做',exact:true}).click();
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
    await expect(page.locator('.fw-arcade-result')).toHaveCount(1);await expect(page.getByText('正在端出你的拿手菜…',{exact:true})).toHaveCount(0);
    const exporting=page.waitForEvent('download');await download.click();const meta=await sharp((await (await exporting).path())!).metadata();expect([meta.format,meta.width,meta.height]).toEqual(['png',960,1200]);
  }
  expect(posts).toBe(0);expect(errors).toEqual([]);
});

test('UX-15c: preview back and an initial renderer failure preserve another unfinished market checkpoint',async({page})=>{
  test.setTimeout(90000);await marketOpen(page,'corn-dog');await marketAdd(page,'熱狗');await marketButton(page,'裹麵糊');
  await page.getByRole('button',{name:'← 大廳',exact:true}).click();
  const saved=await page.evaluate(k=>sessionStorage.getItem(k),MARKET_SAVE_KEY);expect(JSON.parse(saved!).run.recipe).toBe('corn-dog');
  await page.getByRole('button',{name:'開始製作香煎牛排',exact:true}).click();await expectNativeMarketReady(page);
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
  await page.locator(`[data-arcade-open="${key}"]`).click();await page.goBack();await expect(page.locator(`[data-arcade-open="${key}"]`)).toBeFocused();expect(Math.abs(await page.evaluate(()=>scrollY)-before)).toBeLessThan(32);expect(await page.locator('.fw-arcade-skip').evaluate(e=>e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);await page.locator('.fw-arcade-skip').focus();expect(await page.locator('.fw-arcade-skip').evaluate(e=>e.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
});

test('UX-2: a whole stirring gesture inside one animation frame still shows the completed step immediately on release',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openKitchen(page,'rice-balls');const svg=page.locator('.ck-scene'),p=await scenePoint(page,.8,.52);await page.mouse.move(p.x,p.y);await page.mouse.down();await svg.evaluate(el=>{const r=el.getBoundingClientRect();for(let i=1;i<=64;i++){const a=i*Math.PI/16;el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,isPrimary:true,button:0,buttons:1,clientX:r.left+(.5+.3*Math.cos(a))*r.width,clientY:r.top+(.52+.3*Math.sin(a))*r.height}));}});await page.mouse.up();await expect(page.locator('.ck-game')).toHaveAttribute('data-cooking-state','step-result');await expect(page.getByRole('button',{name:/^下一步：/})).toBeVisible();await page.getByRole('button',{name:/^下一步：/}).click();await expect(svg).toHaveAttribute('data-cooking-scene','knead');
});

test('UX-2: secondary pointers cannot release or cancel a real cooking hold, and restart confirmation freezes progress',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openKitchen(page,'margherita-pizza');const hold=page.getByRole('button',{name:'按住揉壓，適時放開',exact:true});await hold.scrollIntoViewIfNeeded();const b=(await hold.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.clock.runFor(750);await hold.dispatchEvent('pointerup',{pointerId:99,isPrimary:false,button:0});await expect(page.locator('.ck-meter-copy')).toHaveText('0 / 4');await page.mouse.up();await expect(page.locator('.ck-meter-copy')).toHaveText('1 / 4');
  await page.locator('.ck-scene').scrollIntoViewIfNeeded();const p=await scenePoint(page,.5,.5);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.clock.runFor(750);await page.locator('.ck-scene').dispatchEvent('pointercancel',{pointerId:99,isPrimary:false,button:0});await page.mouse.up();await expect(page.locator('.ck-meter-copy')).toHaveText('2 / 4');await page.getByRole('button',{name:'重新做',exact:true}).click();await expect(page.locator('.ck-game')).toHaveAttribute('data-cooking-state','paused');const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);await page.clock.runFor(6000);await expect(page.locator('.ck-meter-copy')).toHaveText('2 / 4');expect(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run.elapsed,COOKING_RUN_KEY)).toBe(saved.run.elapsed);await page.getByRole('button',{name:'繼續這一盤',exact:true}).click();await expect(page.getByRole('button',{name:'繼續料理',exact:true})).toBeVisible();
});

for(const width of [320,1440])for(const kind of ['knead','pour'] as const)test(`UX-2: native Tab cancels the keyboard ${kind} hold without scoring or losing the dish at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await openKitchen(page,'margherita-pizza');
  const game=page.locator('.ck-game'),recipe=recipeOf('margherita-pizza')!;
  if(kind==='pour'){
    const knead=recipe.steps[0];for(let i=0;i<knead.goal;i++){await game.focus();await page.keyboard.down('Space');await page.clock.runFor(knead.holdMs);await page.keyboard.up('Space');}
    await page.getByRole('button',{name:/^下一步：/}).click();
  }
  const step=recipe.steps[kind==='knead'?0:1],hold=page.getByRole('button',{name:kind==='knead'?'按住揉壓，適時放開':'按住倒入，適時放開',exact:true});
  const checkpoint=()=>page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run as CookingRun,COOKING_RUN_KEY);
  const initial=await checkpoint();
  for(const input of [{origin:'game',key:'Space'},{origin:'button',key:'Space'},{origin:'button',key:'Enter'}]){
    const owner=input.origin==='game'?game:hold;await owner.focus();await page.keyboard.down(input.key);await page.clock.runFor(300);
    await page.keyboard.press('Tab');await expect(owner).not.toBeFocused();
    await expect(input.origin==='game'?page.getByRole('button',{name:'← 遊戲大廳',exact:true}):page.locator('.ck-help > summary')).toBeFocused();
    await expect(page.locator('.ck-game-reaction')).toHaveText('已取消這次按住操作，重新按住可繼續。');
    const cancelled=await checkpoint();expect(cancelled.active.holdAt).toBeNull();expect(cancelled.active.count).toBe(0);expect(cancelled.reports).toEqual(initial.reports);expect(cancelled.status).toBe('playing');
    await page.keyboard.up(input.key);await page.clock.runFor(4000);
    // Re-focusing and receiving a delayed keyup must not settle the old hold.
    await owner.focus();await page.keyboard.up(input.key);
    const after=await checkpoint();expect(after.id).toBe(initial.id);expect(after.active.amount).toBe(cancelled.active.amount);expect(after.active.count).toBe(0);expect(after.reports).toEqual(initial.reports);expect(after.status).toBe('playing');
    expect(await page.locator('.ck-help').evaluate(el=>(el as HTMLDetailsElement).open)).toBe(false);
    await expect(page.locator('.fw-arcade-result')).toHaveCount(0);
  }
  const before=await checkpoint();await hold.focus();await page.keyboard.down('Space');
  await page.clock.runFor(kind==='knead'?step.holdMs:(step.target-before.active.amount)*step.durationMs);await page.keyboard.up('Space');
  const completed=await checkpoint();expect(completed.id).toBe(initial.id);expect(completed.active.holdAt).toBeNull();
  if(kind==='knead'){expect(completed.active.count).toBe(1);await expect(page.locator('.ck-meter-copy')).toHaveText(`1 / ${step.goal}`);}
  else{expect(completed.status).toBe('step-result');expect(completed.reports).toHaveLength(initial.reports.length+1);expect(completed.reports.at(-1)!.score).toBeGreaterThanOrEqual(85);await expect(page.getByRole('button',{name:/^下一步：/})).toBeVisible();}
});
for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375},{width:1440,height:900}])for(const phase of ['playing','step-result'] as const)for(const presentation of ['normal','viewport'] as const){
  test(`UX-2 guided restart is modal and cancellable at ${viewport.width}px from ${phase} in ${presentation}`,async({page})=>{
    await page.setViewportSize(viewport);await page.clock.install();
    if(presentation==='viewport')await page.addInitScript(()=>{Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});Element.prototype.requestFullscreen=async()=>{throw new DOMException('denied','NotAllowedError');};});
    await page.route('**/assets/kitchen-stage-*.js',route=>route.abort());
    await page.goto('/play');const f=kitchenCheckpoint('slice');
    await page.evaluate(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);
    await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`);
    await expect(page.locator('.ck-visual-light')).toBeVisible();
    await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));
    const fullscreen=page.locator('.fullscreen-game');
    if(presentation==='viewport'){await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await expect(fullscreen).toHaveClass(/fullscreen-game--viewport/);expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();}
    await page.getByRole('button',{name:'繼續料理',exact:true}).click();
    if(presentation==='normal')await exitStartedFullscreen(page);
    for(let i=0;i<(phase==='playing'?1:currentStep(f.run).goal);i++){await page.clock.runFor(160);await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();}
    const game=page.locator('.ck-game'),restart=page.getByRole('button',{name:'重新做',exact:true}),dialog=page.getByRole('dialog',{name:'重新做這盤料理',exact:true});
    await expect(game).toHaveAttribute('data-cooking-state',phase);
    await restart.focus();await page.keyboard.press('Enter');await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el=>el.matches(':modal'))).toBe(true);
    // Match the existing large-text fixture through CSSOM without injecting a CSP-blocked stylesheet.
    if(viewport.width===320)await dialog.evaluate(el=>{for(const node of el.querySelectorAll<HTMLElement>('p,button')){const line=parseFloat(getComputedStyle(node).lineHeight);node.style.fontSize=node.tagName==='BUTTON'?'30px':'28px';if(Number.isFinite(line))node.style.lineHeight=`${line*2}px`;}});
    if(viewport.width===320){await expect(dialog.locator('p')).toHaveCSS('font-size','28px');for(const button of await dialog.getByRole('button').all())await expect(button).toHaveCSS('font-size','30px');}
    const keep=dialog.getByRole('button',{name:'繼續這一盤',exact:true});await expect(keep).toBeFocused();
    const pausedPhase=phase==='playing'?'paused':'step-result',background=page.getByRole('button',{name:phase==='playing'?'繼續料理':/^下一步：/,exact:phase==='playing',includeHidden:true});
    await expect(game).toHaveAttribute('data-cooking-state',pausedPhase);
    // Native inertness prevents even programmatic focus from escaping to a live background control.
    await background.evaluate(el=>el.focus());await expect(keep).toBeFocused();
    for(let i=0;i<5;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
    const confirm=dialog.getByRole('button',{name:'確定重新做',exact:true});await expect(confirm).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(keep).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(confirm).toBeFocused();
    const saved=await page.evaluate(key=>sessionStorage.getItem(key),COOKING_RUN_KEY),book=await page.evaluate(key=>localStorage.getItem(key),COOKBOOK_KEY);
    await page.clock.runFor(6000);expect(await page.evaluate(key=>sessionStorage.getItem(key),COOKING_RUN_KEY)).toBe(saved);
    const bounds=(await dialog.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(restart).toBeFocused();await expect(game).toHaveAttribute('data-cooking-state',pausedPhase);
    expect(await page.evaluate(key=>sessionStorage.getItem(key),COOKING_RUN_KEY)).toBe(saved);
    if(presentation==='viewport'){
      await expect(fullscreen).toHaveClass(/fullscreen-game--viewport/);
      // Neither a native non-modal dialog nor ARIA dialog markup owns fullscreen Escape.
      await fullscreen.evaluate(el=>{const nonmodal=document.createElement('dialog');nonmodal.dataset.restartControl='nonmodal';nonmodal.textContent='非模態控制';el.append(nonmodal);nonmodal.show();const role=document.createElement('div');role.dataset.restartControl='role';role.setAttribute('role','dialog');role.setAttribute('aria-label','角色標記控制');el.append(role);});
      const nonmodal=fullscreen.locator('dialog[data-restart-control]');await expect(nonmodal).toHaveAttribute('open','');expect(await nonmodal.evaluate(el=>el.matches(':modal'))).toBe(false);await expect(fullscreen.locator('[data-restart-control=role]')).toHaveAttribute('role','dialog');
      await restart.focus();await page.keyboard.press('Escape');await expect(fullscreen).not.toHaveClass(/fullscreen-game--viewport/);await expect(game).toHaveAttribute('data-cooking-state',pausedPhase);expect(await page.evaluate(key=>sessionStorage.getItem(key),COOKING_RUN_KEY)).toBe(saved);
      await fullscreen.evaluate(el=>{for(const node of el.querySelectorAll('[data-restart-control]'))node.remove();});
    }
    await page.keyboard.press('Enter');await expect(keep).toBeFocused();await keep.click();await expect(dialog).toHaveCount(0);await expect(restart).toBeFocused();
    expect(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run as CookingRun,COOKING_RUN_KEY)).toEqual(JSON.parse(saved!).run);
    await page.reload();await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(game).toHaveAttribute('data-cooking-state',pausedPhase);
    const restored=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run as CookingRun,COOKING_RUN_KEY);expect(restored).toEqual(JSON.parse(saved!).run);
    await restart.click();await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'確定重新做',exact:true}).click();
    await expect(dialog).toHaveCount(0);await expect(restart).toBeFocused();await expect(game).toHaveAttribute('data-cooking-state','ready');
    expect(await page.evaluate(key=>sessionStorage.getItem(key),COOKING_RUN_KEY)).toBeNull();expect(await page.evaluate(key=>localStorage.getItem(key),COOKBOOK_KEY)).toBe(book);
    await expect(page.locator('.fw-arcade-result')).toHaveCount(0);
    // Ready cancellation must not start cooking; a subsequent explicit start remains usable.
    await restart.click();await expect(keep).toBeFocused();await page.keyboard.press('Escape');await expect(game).toHaveAttribute('data-cooking-state','ready');
    await page.getByRole('button',{name:'開始料理',exact:true}).click();await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toHaveText(`1 / ${currentStep(f.run).goal}`);
    await page.getByRole('button',{name:'暫停',exact:true}).click();const fresh=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run as CookingRun,COOKING_RUN_KEY);expect(fresh.id).not.toBe(restored.id);expect(fresh.reports).toHaveLength(0);expect(fresh.active.count).toBe(1);
    await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await expect(game).toHaveCount(0);await expect(page.locator('dialog:modal')).toHaveCount(0);
  });
}

test('UX-1/5: a completed cooking run can replay the same seed or move to the next real recipe',async({page})=>{
  test.setTimeout(120000);await openKitchen(page,'egg-fried-rice');await playRecipe(page,recipeOf('egg-fried-rice')!);await page.getByRole('button',{name:'同一題再來一次',exact:true}).click();expect(new URL(page.url()).searchParams.get('seed')).toBe('42');await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();await page.getByRole('button',{name:'開始料理',exact:true}).click();await playRecipe(page,recipeOf('egg-fried-rice')!);await page.getByRole('button',{name:'換一道料理 →',exact:true}).click();await expect(page.locator('.ck-game h1')).toHaveText('滷肉飯');expect(new URL(page.url()).searchParams.get('recipe')).toBe('braised-pork-rice');await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();
});

test('UX-4: all six 3D scenes keep bounded real draw calls and avoid unchanged diagnostic mutations',async({page})=>{
  test.setTimeout(120000);await page.setViewportSize({width:1440,height:900});await page.clock.install({time:new Date('2026-10-25T06:00:00Z')});
  for(const [game,budget]of [['photo',95],['stamp',75],['cash',70],['chair',100],['tofu',56],['holiday',100]] as const){const party=['chair','tofu','holiday'].includes(game);await page.goto(`/play?game=${game}&seed=42`);await expect(page.locator(party?'[data-party-stage="ready"]':'[data-game-stage="ready"]')).toBeVisible();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));await page.getByRole('button',{name:party?'開始派對！':game==='stamp'?'先蓋一張練習紙':'開始這一局',exact:true}).click();const host=page.locator(party?'.pt-canvas':'.fw-arcade-stage'),counter=await host.evaluateHandle(el=>{const record={count:0};new MutationObserver(records=>{record.count+=records.length;}).observe(el,{attributes:true});return record;});await page.clock.runFor(1000);expect(Number(await host.getAttribute('data-render-calls'))).toBeLessThanOrEqual(budget);expect(await counter.evaluate(c=>c.count)).toBeLessThan(party?160:12);await counter.dispose();}
});

test('UX-4: a real legacy UI draw failure is contained and retries with practice progress preserved',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.install({time:new Date('2026-10-25T09:00:00Z')});await page.goto('/play?game=stamp&seed=42');await expect(page.locator('[data-game-stage="ready"]')).toBeVisible();await page.clock.pauseAt(new Date('2026-10-25T09:01:00Z'));await page.getByRole('button',{name:'先蓋一張練習紙',exact:true}).click();await page.getByRole('button',{name:'啪！蓋章',exact:true}).click();await page.clock.runFor(300);const clear=await page.evaluateHandle(()=>WebGL2RenderingContext.prototype.clear);await page.evaluate(()=>{WebGL2RenderingContext.prototype.clear=function(){throw Error('Synthetic UX draw fault');};});await page.locator('.fw-arcade-board').press('ArrowLeft');await expect(page.getByRole('alert')).toContainText('按重試恢復這一局');expect(errors).toEqual([]);await page.evaluate(original=>{WebGL2RenderingContext.prototype.clear=original;},clear);await clear.dispose();await page.getByRole('button',{name:'重試場景',exact:true}).click();await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();await expect(page.locator('.fw-arcade-counter')).toContainText('0/12');
});

async function exitStartedFullscreen(page:Page){
  // Like openGame, keep ordinary gameplay cases in their original normal presentation.
  // Verify the real start entered fullscreen, then respect the player's real exit.
  const exit=page.getByRole('button',{name:'退出全螢幕',exact:true});
  await expect(exit).toBeVisible();await expect(exit).toHaveAttribute('aria-disabled','false');
  await exit.click();await expect(page.getByRole('button',{name:'⛶ 全螢幕',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
}

async function openParty(page:Page,game:PartyGameId){
  await page.clock.install({time:new Date('2026-10-25T00:00:00Z')});await page.goto(`/play?game=${game}&seed=42`);
  await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();await page.clock.pauseAt(new Date('2026-10-25T00:01:00Z'));
  await page.getByRole('button',{name:'開始派對！',exact:true}).click();await exitStartedFullscreen(page);
}
async function partyResult(page:Page,game:PartyGameId){
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','done');const score=Number(await page.locator('.pt-root').getAttribute('data-party-score'));expect(score).toBeGreaterThan(0);
  await page.getByRole('button',{name:'查看這局成果',exact:true}).click();await expect(page.locator('.fw-arcade-result-heading')).toContainText(`${score} 分`);await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();await socialEntries(page,game);return score;
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
    const drop=page.getByRole('button',{name:'豆腐落下！',exact:true});await expect(drop).toHaveText('落下');if(layer===0)await page.locator('.pt-canvas').click();else if(layer===1)await page.locator('.pt-canvas').press('Space');else await drop.click();await expect(page.getByRole('button',{name:'豆腐降落中…',exact:true})).toHaveText('降落中');await expect(page.getByRole('button',{name:'豆腐降落中…',exact:true})).toBeDisabled();await page.locator('.pt-canvas').press('Space');await page.clock.runFor(510);
  }
  await expect(page.locator('.pt-scoreboard strong[aria-label^="完成 12 / 12 層，"]')).toBeVisible();expect(await partyResult(page,'tofu')).toBe(2925);
});

test('PT-5/7: holiday raycasts a real 3D character, accepts keyboard targets, and carries the result to confirmed site sharing',async({page})=>{
  test.setTimeout(150000);await page.setViewportSize({width:390,height:844});await openParty(page,'holiday');
  for(let round=0;round<20;round++){
    await partyAdvance(page,round*PT.holidayRoundMs+250);const good=page.getByRole('button',{name:/第 [1-6] 格：休假/}),label=(await good.getAttribute('aria-label'))!,hole=Number(label.match(/第 (\d)/)![1])-1;
    if(!round){const anchor=JSON.parse((await page.locator('.pt-canvas').getAttribute('data-anchors'))!)[hole],b=(await page.locator('.pt-canvas').boundingBox())!;await page.mouse.click(b.x+anchor.x*b.width,b.y+anchor.y*b.height);}else await page.locator('.pt-canvas').press(String(hole+1));
    await expect(page.locator('.pt-live-label')).toContainText(`已守住 ${round+1} 個假日`);
  }
  await partyAdvance(page,PT.holidayMs);expect(await partyResult(page,'holiday')).toBe(5100);await page.getByRole('button',{name:'發到自由工坊',exact:true}).click();await expect(page.getByLabel('電子郵件',{exact:true})).toBeVisible();
  const draft=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),GAME_HANDOFF_KEY);expect(draft.game).toBe('holiday');expect(draft.text).toContain('5100 分');expect(draft.text).toContain('game=holiday');expect(draft.autoPublish).toBeUndefined();await page.clock.resume();await login(page);await expect(page.getByRole('textbox',{name:'貼文內容'})).toHaveValue(/5100 分/);await expect(page.getByRole('button',{name:'發布貼文',exact:true})).toBeVisible();
});

test('PT-2/6: blur freezes the round, genuine context loss rebuilds it, and restart needs an explicit choice',async({page})=>{
  test.setTimeout(90000);await openParty(page,'holiday');await partyAdvance(page,300);await page.getByRole('button',{name:/第 [1-6] 格：休假/}).click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');const at=await partyElapsed(page),score=await page.locator('.pt-root').getAttribute('data-party-score');await page.clock.runFor(6000);expect(await partyElapsed(page)).toBe(at);
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();const lost=await page.locator('.pt-canvas canvas').evaluate(c=>{const gl=(c as HTMLCanvasElement).getContext('webgl2');const ext=gl?.getExtension('WEBGL_lose_context');ext?.loseContext();return !!ext;});expect(lost).toBe(true);await expect(page.getByRole('alert')).toContainText('本局已暫停');await page.getByRole('button',{name:'重建 3D 場景',exact:true}).click();await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await partyAdvance(page,at+200);
  await page.getByRole('button',{name:'重新開始',exact:true}).click();await expect(page.getByRole('group',{name:'確認重新開始'})).toBeVisible();await page.getByRole('button',{name:'保留這局',exact:true}).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);await page.getByRole('button',{name:'重新開始',exact:true}).click();await page.getByRole('button',{name:'確定重來',exact:true}).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','ready');expect(await partyElapsed(page)).toBe(0);
});

test('PT-2/6: a render exception from a paused UI action is contained, with the same score restored after retry',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openParty(page,'holiday');await partyAdvance(page,300);await page.getByRole('button',{name:/第 [1-6] 格：休假/}).click();await page.getByRole('button',{name:'暫停',exact:true}).click();const clear=await page.evaluateHandle(()=>WebGL2RenderingContext.prototype.clear);await page.evaluate(()=>{WebGL2RenderingContext.prototype.clear=function(){throw Error('Synthetic PT render fault');};});await page.getByRole('button',{name:'減少動態關',exact:true}).click();await expect(page.getByRole('alert')).toContainText('本局仍保留');await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','failed');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');expect(errors).toEqual([]);await page.evaluate(original=>{WebGL2RenderingContext.prototype.clear=original;},clear);await clear.dispose();await page.getByRole('button',{name:'重建 3D 場景',exact:true}).click();await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await partyAdvance(page,500);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
});

test('PT-6: compact and landscape 200% text preserves the start/control owners for every party game',async({page},testInfo)=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const viewport of [{width:320,height:568},{width:667,height:375}])for(const g of PARTY_GAMES){
    await page.setViewportSize(viewport);await page.goto(`/play?game=${g.id}&seed=42`);await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();
    await page.evaluate(()=>{const styles=[...document.querySelectorAll('.fw-arcade-root,.fw-arcade-root *')].filter(e=>e instanceof HTMLElement).map(e=>({e:e as HTMLElement,font:parseFloat(getComputedStyle(e).fontSize),line:parseFloat(getComputedStyle(e).lineHeight)}));for(const {e,font,line}of styles){e.style.fontSize=`${font*2}px`;if(Number.isFinite(line))e.style.lineHeight=`${line*2}px`;}});
    await page.locator('.pt-root').evaluate(el=>{for(const [side,value]of Object.entries({top:12,right:8,bottom:16,left:8}))(el as HTMLElement).style.setProperty(`--game-safe-${side}`,`${value}px`);});
    const narrative=page.getByLabel('本局說明',{exact:true});await narrative.focus();await expect(narrative).toBeFocused();
    await narrative.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    expect(await narrative.evaluate(el=>el.clientHeight>0&&el.scrollTop+el.clientHeight>=el.scrollHeight-1)).toBe(true);
    const start=page.getByRole('button',{name:'開始派對！',exact:true});
    expect(await start.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
    const owners=()=>page.locator('.pt-root').evaluate(root=>{const problems:string[]=[];for(const b of root.querySelectorAll('button')){if(!b.checkVisibility())continue;const r=b.getBoundingClientRect();if(r.width<44||r.height<44)problems.push(`small:${b.textContent}`);const owner=b.closest('.pt-panel,.pt-controls,.pt-tools,.pt-heading');if(owner){const o=owner.getBoundingClientRect();if(r.left<o.left-1||r.right>o.right+1||r.top<o.top-1||r.bottom>o.bottom+1)problems.push(`owner:${b.textContent}`);}}return problems;});expect(await owners()).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'開始派對！',exact:true}).click();await expectPartyFullViewport(page);await testInfo.attach(`party-${g.id}-${viewport.width}x${viewport.height}-200pct-safe-insets.jpg`,{body:await page.locator('.fullscreen-game').screenshot({type:'jpeg',quality:85}),contentType:'image/jpeg'});await exitStartedFullscreen(page);expect(await owners()).toEqual([]);await page.getByRole('button',{name:'暫停',exact:true}).click();await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();
  }expect(errors).toEqual([]);
});

test('PT-6: a failed lazy 3D renderer offers retry and a working return to the lobby',async({page})=>{
  await page.route('**/assets/stage-*.js',route=>route.abort());await page.goto('/play?game=chair&seed=42');await expect(page.getByRole('alert')).toContainText('無法開啟 3D 場景');await expect(page.getByRole('button',{name:'重建 3D 場景',exact:true})).toBeVisible();await page.getByRole('button',{name:'先回遊戲大廳',exact:true}).click();await expect(page.getByRole('button',{name:'全部遊戲 72',exact:true})).toBeVisible();
});

test('PT-6: landscape play keeps the real canvas and every primary control in the same viewport',async({page})=>{
  await page.setViewportSize({width:667,height:375});for(const g of PARTY_GAMES){await page.goto(`/play?game=${g.id}&seed=42`);await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();await page.getByRole('button',{name:'開始派對！',exact:true}).click();await expect(page.getByRole('dialog',{name:'遊戲全螢幕',exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.classList.contains('fullscreen-game'))).toBe(true);const boxes=await page.locator('.pt-canvas,.pt-controls button').evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};}));for(const r of boxes){expect(r.left).toBeGreaterThanOrEqual(0);expect(r.top).toBeGreaterThanOrEqual(0);expect(r.right).toBeLessThanOrEqual(667);expect(r.bottom).toBeLessThanOrEqual(375);}await expectPartyFullViewport(page);await exitStartedFullscreen(page);}
});

test('PT-6: lobby previews fail gracefully, keep Three cold and release the context on return',async({page})=>{
  const code:string[]=[];page.on('request',r=>{if(/\/(?:PartyGame|stage|three)-[^/]+\.js/.test(r.url()))code.push(r.url());});await page.route('**/games/absurd-daily/illustrated/tofu.webp',route=>route.abort());await page.goto('/play');await page.getByRole('button',{name:'反應手速 5',exact:true}).click();await expect(page.locator('.pt-party-card')).toHaveCount(3);await page.getByRole('button',{name:'豆腐開工',exact:true}).scrollIntoViewIfNeeded();await expect(page.locator('[data-cover-id=tofu] .sg-cover-fallback')).toContainText('豆腐疊高高');expect(code).toEqual([]);
  await page.locator('[data-cover-id=tofu] .sg-cover-fallback').evaluate(e=>{(e as HTMLElement).style.fontSize='40px';(e as HTMLElement).style.lineHeight='64px';});expect(await page.locator('[data-cover-id=tofu] .sg-cover-fallback').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBe(40);const fallback=await page.locator('[data-cover-id=tofu] .sg-cover-fallback').boundingBox(),owner=await page.locator('.pt-party-art:has([data-cover-id=tofu])').boundingBox();expect(fallback!.y+fallback!.height).toBeLessThanOrEqual(owner!.y+owner!.height);
  await page.getByRole('button',{name:'豆腐開工',exact:true}).click();await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();const gl=await page.locator('.pt-canvas canvas').evaluateHandle(c=>(c as HTMLCanvasElement).getContext('webgl2'));await page.getByRole('button',{name:'回遊戲大廳',exact:true}).click();await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);await expect.poll(()=>gl.evaluate(g=>g?.isContextLost())).toBe(true);await expect(page.getByRole('button',{name:'反應手速 5',exact:true})).toHaveAttribute('aria-pressed','true');await gl.dispose();
});

test.describe('PT-6 touchscreen input',()=>{
  test.use({hasTouch:true});
  for(const viewport of [{width:390,height:844},{width:667,height:375},{width:320,height:568}])test(`PT-6: a real touch tap raycasts the visible holiday character at ${viewport.width}x${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);await openParty(page,'holiday');await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await partyAdvance(page,250);await expectPartyFullViewport(page);const label=(await page.getByRole('button',{name:/第 [1-6] 格：休假/}).getAttribute('aria-label'))!,hole=Number(label.match(/第 (\d)/)![1])-1;const anchor=JSON.parse((await page.locator('.pt-canvas').getAttribute('data-anchors'))!)[hole],b=(await page.locator('.pt-canvas').boundingBox())!;await page.touchscreen.tap(b.x+anchor.x*b.width,b.y+anchor.y*b.height);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');await expect(page.locator('.pt-live-label')).toContainText('已守住 1 個假日');
  });
});
async function openLightHoliday(page:Page){
  await blockPartyWebGL(page);await page.clock.install({time:new Date('2026-10-25T00:00:00Z')});
  await page.goto('/play?game=holiday&seed=42');await expect(page.getByRole('alert')).toContainText('無法開啟 3D 場景');
  await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-mode','light');
  await page.clock.pauseAt(new Date('2026-10-25T00:01:00Z'));await page.getByRole('button',{name:'開始派對！',exact:true}).click();await exitStartedFullscreen(page);
}

// PT-action-light: no renderer, real controls, unchanged domain and real exports.
async function openLightAction(page:Page,game:'chair'|'tofu'){
  await blockPartyWebGL(page);await page.clock.install({time:new Date('2026-10-25T00:00:00Z')});
  await page.goto(`/play?game=${game}&seed=42`);await expect(page.getByRole('alert')).toContainText('無法開啟 3D 場景');
  await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-mode','light');
  await page.clock.pauseAt(new Date('2026-10-25T00:01:00Z'));await page.getByRole('button',{name:'開始派對！',exact:true}).click();await exitStartedFullscreen(page);
  await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);
}

test('PT-action-light: chair without WebGL completes all real ticket waves under reduced motion and exports true totals',async({page})=>{
  test.setTimeout(150000);await page.setViewportSize({width:320,height:568});await page.emulateMedia({reducedMotion:'reduce'});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openLightAction(page,'chair');
  await expect(page.getByRole('button',{name:'減少動態開',exact:true})).toHaveAttribute('aria-pressed','true');
  const controls=await page.locator('.pt-controls button').evaluateAll(bs=>bs.map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,font:parseFloat(getComputedStyle(b).fontSize)})));for(const b of controls){expect(b.w).toBeGreaterThanOrEqual(44);expect(b.h).toBeGreaterThanOrEqual(44);expect(b.font).toBeGreaterThanOrEqual(14);}
  let lane=0;for(let i=0;i<PT.chairWaves;i++){const wave=chairWave(42,i);while(lane!==wave.ticketLane){const direction=lane<wave.ticketLane?1:-1;if(i%2)await page.getByRole('button',{name:`第 ${lane+direction+2} 道`,exact:true}).press('Enter');else await page.locator('.pt-canvas').press(direction===1?'ArrowRight':'ArrowLeft');lane+=direction;await partyAdvance(page,await partyElapsed(page)+160);await expect(page.locator('[data-light-world=chair]')).toHaveAttribute('data-actual-x',String(lane));}await partyAdvance(page,wave.at+20);}
  await partyAdvance(page,PT.chairMs);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','4280');
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'下載本局成果 SVG',exact:true}).press('Enter');const svg=readFileSync((await(await download).path())!,'utf8');expect(svg).toContain('4280 分');expect(svg).toContain('22 張假日票');expect(svg).toContain('沒有保存逐波路線');expect(await partyResult(page,'chair')).toBe(4280);expect(errors).toEqual([]);
});

test('PT-action-light: tofu uses the actual RAF clock, twelve timed drops, one landing each and true tower SVG/PNG',async({page})=>{
  test.setTimeout(180000);await page.emulateMedia({reducedMotion:'reduce'});await openLightAction(page,'tofu');
  // Start's game RAF is already queued. A read-only probe sees those same frame
  // timestamps, not the 30fps SVG's previous render. No production state writes.
  const probe=await page.evaluateHandle(()=>{const record={first:null as number|null,at:0,frame:0};const sample=(at:number)=>{record.first??=at;record.at=at;record.frame=requestAnimationFrame(sample);};record.frame=requestAnimationFrame(sample);return record;});
  let model=startParty(newParty('tofu',42)) as TofuRun;const history=new Map<number,TofuRun>([[0,model]]);
  const frame=async()=>{await page.clock.runFor(16);const elapsed=await probe.evaluate(r=>r.first===null?0:r.at-r.first);model=advanceParty(model,elapsed-model.elapsed) as TofuRun;expect(model.elapsed).toBe(elapsed);history.set(model.elapsed,model);};
  const assertProjection=async()=>{
    const view=await page.locator('[data-light-world=tofu]').evaluate(el=>{const moving=el.querySelector('[data-tofu-layer=moving]');return {elapsed:Number(el.getAttribute('data-view-elapsed')),axis:el.getAttribute('data-axis'),offset:Number(el.getAttribute('data-offset')),progress:Number(el.getAttribute('data-fall-progress')),active:moving?['x','z','width','depth'].map(k=>Number(moving.getAttribute(`data-${k}`))):null};});
    const snapshot=history.get(view.elapsed);expect(snapshot).toBeDefined();const state=snapshot!,axis=state.fall?.axis??tofuAxis(state),active=state.fall?.from??tofuPosition(state),offset=active[axis]-state.layers.at(-1)![axis];
    expect(view.axis).toBe(axis);expect(view.offset).toBeCloseTo(offset,8);expect(view.progress).toBeCloseTo(state.fall?Math.min(1,(state.elapsed-state.fall.at)/PT.tofuFallMs):0,8);expect(view.active).toEqual(state.status==='done'?null:[active.x,active.z,active.width,active.depth]);return view;
  };
  await frame();
  for(let layer=0;layer<PT.tofuGoal;layer++){
    let aligned=false;for(let i=0;i<400;i++){const axis=tofuAxis(model);if(Math.abs(tofuPosition(model)[axis]-model.layers.at(-1)![axis])<.06){aligned=true;break;}await frame();}expect(aligned).toBe(true);await assertProjection();
    const drop=page.getByRole('button',{name:'豆腐落下！',exact:true});await expect(drop).toHaveText('落下');if(layer===0)await page.locator('.pt-canvas').click();else if(layer%2)await drop.press('Space');else await drop.click();await expect(page.getByRole('button',{name:'豆腐降落中…',exact:true})).toHaveText('降落中');
    model=actParty(model,{kind:'drop'}) as TofuRun;history.set(model.elapsed,model);expect(model.fall?.perfect).toBe(true);expect(await partyElapsed(page)).toBe(model.elapsed);await expect(page.getByRole('button',{name:'豆腐降落中…',exact:true})).toBeDisabled();
    await page.locator('.pt-canvas').press('Space');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',String(model.score));
    for(let i=0;i<16;i++)await frame();const middle=await assertProjection();expect(middle.progress).toBeGreaterThan(.4);expect(middle.progress).toBeLessThan(.7);await expect(page.locator('[data-tofu-layer]')).toHaveCount(layer+2);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',String(model.score));
    while(model.fall)await frame();
    // Let the bounded 30fps presentation publish the real landing. The model
    // keeps advancing with the same frame timestamps, never a timeout/retry.
    if(model.status==='playing'){await frame();await frame();}await assertProjection();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',String(model.score));await expect(page.locator(`.pt-scoreboard strong[aria-label^="完成 ${layer+1} / 12 層，"]`)).toBeVisible();
  }
  await probe.evaluate(r=>cancelAnimationFrame(r.frame));await probe.dispose();expect(model.score).toBe(2925);await expect(page.locator('[data-tofu-layer]')).toHaveCount(13);
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'下載本局成果 SVG',exact:true}).click();const svg=readFileSync((await(await download).path())!,'utf8');expect(svg).toContain('2925 分');expect(svg).toContain('疊了 12 層');expect((svg.match(/<polygon /g)??[]).length).toBe(39);expect(await partyResult(page,'tofu')).toBe(2925);
  const pngDownload=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG',exact:true}).click();const png=await sharp((await(await pngDownload).path())!).metadata();expect([png.width,png.height]).toEqual([960,1200]);
});

for(const game of ['chair','tofu'] as const)test(`PT-action-light: ${game} retry, cancel and fullscreen Escape retain the run and cancel held controls`,async({page})=>{
  await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new Error('Synthetic unavailable fullscreen'));});await openLightAction(page,game);await partyAdvance(page,400);
  await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await expect(page.locator('.fullscreen-game')).toHaveClass(/fullscreen-game--viewport/);
  const control=page.getByRole('button',{name:game==='chair'?'跳一下！':'豆腐落下！',exact:true});await control.focus();await page.keyboard.down('Space');await page.keyboard.press('Escape');await page.keyboard.up('Space');await expect(page.locator('.fullscreen-game')).not.toHaveClass(/fullscreen-game--viewport/);
  if(game==='tofu')await expect(control).toBeEnabled();else await expect(page.locator('[data-light-world=chair]')).toHaveAttribute('data-jump','0');
  await page.getByRole('button',{name:'重新開始',exact:true}).click();const at=await partyElapsed(page),score=await page.locator('.pt-root').getAttribute('data-party-score');await expect(page.getByRole('button',{name:'確定重來',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'重新開始',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'重試 3D，保留這局',exact:true}).click();await expect(page.getByRole('alert')).toContainText('無法開啟 3D 場景');await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await page.locator('.pt-canvas').press('Space');await partyAdvance(page,at+500);
  if(game==='tofu')await expect(page.locator('[data-light-world=tofu]')).toHaveAttribute('data-turn','1');else expect(Number(await page.locator('[data-light-world=chair]').getAttribute('data-jump'))).toBeGreaterThan(0);
  await page.getByRole('button',{name:'回遊戲大廳',exact:true}).click();await page.clock.runFor(16000);await expect(page.locator('.pt-root')).toHaveCount(0);
});

test('PT-action-light: a tofu scene hold during a fall cannot drop the next moving block',async({page})=>{
  await openLightAction(page,'tofu');await partyAdvance(page,400);await page.getByRole('button',{name:'豆腐落下！',exact:true}).click();
  const host=page.locator('.pt-canvas'),box=(await host.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/3);await page.mouse.down();await partyAdvance(page,1000);await page.mouse.up();
  await expect(page.locator('[data-light-world=tofu]')).toHaveAttribute('data-turn','1');await expect(page.getByRole('button',{name:'豆腐落下！',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'豆腐落下！',exact:true}).press('Enter');await expect(page.getByRole('button',{name:'豆腐降落中…',exact:true})).toBeDisabled();
});

for(const key of ['Space','Enter','pointer'])test(`PT-action-light: chair ${key} release across a wave cannot trigger a new jump`,async({page})=>{
  await openLightAction(page,'chair');await partyAdvance(page,2000);const jump=page.getByRole('button',{name:'跳一下！',exact:true});
  if(key==='pointer'){const b=(await jump.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();}else{await jump.focus();await page.keyboard.down(key);}
  await partyAdvance(page,2300);if(key==='pointer')await page.mouse.up();else await page.keyboard.up(key);await partyAdvance(page,2400);await expect(page.locator('[data-light-world=chair]')).toHaveAttribute('data-jump','0');
  await jump.press('Enter');await partyAdvance(page,2600);expect(Number(await page.locator('[data-light-world=chair]').getAttribute('data-jump'))).toBeGreaterThan(0);
});

test('PT-light: without WebGL, the six real cells complete all waves and export this run as SVG and PNG',async({page})=>{
  test.setTimeout(150000);await page.setViewportSize({width:320,height:568});await page.emulateMedia({reducedMotion:'reduce'});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openLightHoliday(page);
  await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);await expect(page.locator('.pt-light-grid button')).toHaveCount(6);
  await expect(page.getByRole('button',{name:'減少動態開',exact:true})).toHaveAttribute('aria-pressed','true');
  const geometry=await page.locator('.pt-light-grid button').evaluateAll(buttons=>buttons.map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,font:parseFloat(getComputedStyle(b).fontSize)})));
  for(const b of geometry){expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);expect(b.font).toBeGreaterThanOrEqual(14);}
  for(let round=0;round<20;round++){
    await partyAdvance(page,round*PT.holidayRoundMs+250);const good=page.getByRole('button',{name:/第 [1-6] 格：休假/});
    if(round%3===0)await good.click();else if(round%3===1)await good.press('Space');else await good.press('Enter');
    await expect(good).toHaveCount(0);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',String(round<10?(round+1)*100+20*(round+1)*(round+2)/2:2100+(round-9)*300));
  }
  await partyAdvance(page,PT.holidayMs);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','5100');
  const svgDownload=page.waitForEvent('download');await page.getByRole('link',{name:'下載本局成果 SVG',exact:true}).press('Enter');
  const svg=readFileSync((await (await svgDownload).path())!,'utf8');expect(svg).toContain('5100 分');expect(svg).toContain('搶救 20 個假日');expect(svg).toContain('輕量成果卡');expect(svg).toContain('同題 #42');
  expect(await partyResult(page,'holiday')).toBe(5100);
  const pngDownload=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG',exact:true}).click();const png=await sharp((await (await pngDownload).path())!).metadata();expect([png.width,png.height]).toEqual([960,1200]);expect(errors).toEqual([]);
});

test('PT-light: context loss pauses the same run, fallback is explicit, retry preserves progress, and cancel restores focus',async({page})=>{
  await openParty(page,'holiday');await partyAdvance(page,300);await page.getByRole('button',{name:/第 [1-6] 格：休假/}).click();
  await page.locator('.pt-canvas canvas').evaluate(c=>(c as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext());
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();
  const at=await partyElapsed(page);await page.clock.runFor(4000);expect(await partyElapsed(page)).toBe(at);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await partyAdvance(page,at+200);
  await page.getByRole('button',{name:'重新開始',exact:true}).click();await expect(page.getByRole('button',{name:'確定重來',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'重新開始',exact:true})).toBeFocused();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
  const pausedAt=await partyElapsed(page);await page.getByRole('button',{name:'重試 3D，保留這局',exact:true}).click();await expect(page.locator('[data-party-stage=ready]')).toBeVisible();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-mode','3d');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');expect(await partyElapsed(page)).toBe(pausedAt);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');
  await page.getByRole('button',{name:'回遊戲大廳',exact:true}).click();await expect(page.locator('.pt-root')).toHaveCount(0);await page.clock.runFor(16000);await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);
});

for(const light of [false,true])test(`PT-light: ${light?'light':'native'} cells reject held pointer/Space/Enter across waves and retain assistive clicks`,async({page})=>{
  if(light)await openLightHoliday(page);else await openParty(page,'holiday');
  for(const [index,key]of ['Space','Enter','pointer'].entries()){
    const round=index*3;await partyAdvance(page,round*PT.holidayRoundMs+300);
    const good=page.getByRole('button',{name:/第 [1-6] 格：休假/}),hole=Number((await good.getAttribute('aria-label'))!.match(/第 (\d)/)![1]);
    const button=page.locator('.pt-hole-controls button').nth(hole-1),score=await page.locator('.pt-root').getAttribute('data-party-score');
    if(key==='pointer'){const box=(await button.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();}else{await button.focus();await page.keyboard.down(key);}
    await partyAdvance(page,(round+1)*PT.holidayRoundMs+250);if(key==='pointer')await page.mouse.up();else await page.keyboard.up(key);
    await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);
    const fresh=page.getByRole('button',{name:/第 [1-6] 格：休假/});if(key==='pointer')await fresh.click();else await fresh.press(key);await expect(page.locator('.pt-root')).not.toHaveAttribute('data-party-score',score!);
    await partyAdvance(page,(round+2)*PT.holidayRoundMs+250);const beforeAt=await page.locator('.pt-root').getAttribute('data-party-score');await page.getByRole('button',{name:/第 [1-6] 格：休假/}).evaluate(b=>(b as HTMLButtonElement).click());await expect(page.locator('.pt-root')).not.toHaveAttribute('data-party-score',beforeAt!);
  }
});

test('PT-light: fullscreen capture cannot turn an Escape-cancelled hold into a hit, and restart cancellation returns focus',async({page})=>{
  await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new Error('Synthetic unavailable fullscreen'));});
  await openLightHoliday(page);await partyAdvance(page,300);
  await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await expect(page.locator('.fullscreen-game')).toHaveClass(/fullscreen-game--viewport/);
  const good=page.getByRole('button',{name:/第 [1-6] 格：休假/});await good.focus();await page.keyboard.down('Space');await page.keyboard.press('Escape');await page.keyboard.up('Space');
  await expect(page.locator('.fullscreen-game')).not.toHaveClass(/fullscreen-game--viewport/);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');
  await good.press('Enter');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
  await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await expect(page.locator('.fullscreen-game')).toHaveClass(/fullscreen-game--viewport/);
  await page.getByRole('button',{name:'重新開始',exact:true}).click();await expect(page.getByRole('button',{name:'確定重來',exact:true})).toBeFocused();await page.keyboard.press('Escape');
  // The inner confirmation owns the first Escape; the next one exits fullscreen.
  await expect(page.getByRole('group',{name:'確認重新開始'})).toHaveCount(0);await expect(page.getByRole('button',{name:'重新開始',exact:true})).toBeFocused();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');await expect(page.locator('.fullscreen-game')).toHaveClass(/fullscreen-game--viewport/);
  const pausedAt=await partyElapsed(page);await page.clock.runFor(500);expect(await partyElapsed(page)).toBe(pausedAt);await page.keyboard.press('Escape');
  await expect(page.locator('.fullscreen-game')).not.toHaveClass(/fullscreen-game--viewport/);await expect(page.getByRole('group',{name:'確認重新開始'})).toHaveCount(0);await expect(page.getByRole('button',{name:'重新開始',exact:true})).toBeFocused();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');expect(await partyElapsed(page)).toBe(pausedAt);
});

// Fixed minimal cosmetic-filter excerpt, not a live network dependency.
// EasyList https://easylist.to/easylist/easylist.txt, version 202611021446.
// Download SHA256 e7d918a3a427f4d6ce3141c298f5c41e5d014b5c3dd2192845b0d448f68c729a.
// These names describe game UI, not advertising; do not override user filters.
const cosmeticSelectors='.ad-root,.ad-header,.ad-footer,.ad-button,.ad-notice,.ad-result,.ad-main';
async function installCosmeticFilters(page:Page){
  // Append to an actual same-origin stylesheet so the test respects style-src 'self'.
  await page.route(/\/assets\/[^/]+\.css(?:\?.*)?$/,async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:`${await response.text()}\n${cosmeticSelectors}{display:none!important}`});
  });
}

for(const [width,height] of [[320,900],[1440,900],[1920,1080]])for(const [game,action] of [['photo','開照相館'],['stamp','拿起印章'],['cash','開始盤點']])test(`AD-6 cosmetic filters keep the anonymous lobby and ${game} entry visible at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height});
  await installCosmeticFilters(page);
  const writes:string[]=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
  await page.goto('/play');
  await expect(page).toHaveTitle('遊戲大廳 · 自由工坊');
  await expect(page.locator('.fw-arcade-root')).toBeVisible();
  await expect(page.locator('.fw-arcade-header')).toBeVisible();
  await expect(page.locator('.fw-arcade-footer')).toBeVisible();
  await expect(page.locator('.fw-arcade-game-card')).toHaveCount(3);
  // Negative control proves the filter is effective, not silently absent.
  await page.evaluate(()=>{const el=document.createElement('div');el.className='ad-root';el.id='cosmetic-control';el.textContent='synthetic filter control';document.body.append(el);});
  await expect(page.locator('#cosmetic-control')).toBeHidden();
  await page.locator('#cosmetic-control').evaluate(el=>el.remove());
  {
    await page.getByRole('button',{name:action,exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`[?]game=${game}&seed=`));
    await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
    await expect(page.locator('.fw-arcade-controls')).toBeVisible();
    await expect(page.getByRole('dialog',{name:'遊戲全螢幕'})).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'回遊樂場',exact:true}).click();
    await expect(page.locator('.fw-arcade-game-card')).toHaveCount(3);
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
    await expect(page.locator(`[data-arcade-open="game:${game}"]`)).toBeFocused();
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  }
  expect(writes).toEqual([]);
});

for(const width of [320,390,1440])test(`AD-brand public lobby preserves the latest logo and native home navigation at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/play');
  const logo=page.getByRole('img',{name:'自由工坊',exact:true});
  const header=page.locator('header').filter({has:logo}),brand=logo.locator('..');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src','/brand/freedom-workshop-compact-transparent.png');
  await expect(logo).toHaveJSProperty('naturalWidth',396);await expect(logo).toHaveJSProperty('naturalHeight',132);
  await expect(logo).toHaveCSS('object-fit','contain');await expect(logo).toHaveCSS('width','132px');await expect(logo).toHaveCSS('height','44px');
  await expect(header).toHaveCSS('flex-wrap','wrap');
  await expect(brand).toHaveAttribute('href','/');
  const home=header.getByRole('link',{name:'回自由工坊 ↗',exact:true});await expect(home).toBeVisible();
  for(const link of [brand,home]){
    const box=await link.boundingBox();expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x+box!.width).toBeLessThanOrEqual(width);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await testInfo.attach(`lobby-brand-${width}`,{body:await header.screenshot(),contentType:'image/png'});
  await brand.focus();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url=>url.pathname==='/');
  await page.goBack();await expect(page).toHaveURL(url=>url.pathname==='/play');
  await expect(logo).toHaveJSProperty('naturalWidth',396);await expect(logo).toHaveCSS('width','132px');
  await home.click();await expect(page).toHaveURL(url=>url.pathname==='/');
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
  // Starting a deep-linked game is a gesture and enters fullscreen (or its
  // viewport fallback). Existing gameplay checks continue in normal mode.
  const exit=page.getByRole('button',{name:'退出全螢幕'});
  await expect(exit).toBeVisible();
  await expect(exit).toHaveAttribute('aria-disabled','false');
  await exit.click();
  await expect(page.getByRole('button',{name:'⛶ 全螢幕'})).toBeVisible();
  await page.locator('.fw-arcade-board').focus();
}
async function enterNativeFullscreen(page:Page){
  await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  const exit=page.getByRole('button',{name:'退出全螢幕'});
  await expect(exit).toHaveAttribute('aria-pressed','true');
  await expect(exit).toHaveAttribute('aria-disabled','false');
  await page.locator('.fw-arcade-board').focus();
  await expect(page.locator('.fw-arcade-board')).toBeFocused();
}
async function closeDailyResultShare(page:Page){
  const dialog=page.locator('[data-daily-result-share]');
  if(await dialog.isVisible())await dialog.getByRole('button',{name:'關閉分享',exact:true}).click();
}
async function expectResultInNativeFullscreen(page:Page){
  await closeDailyResultShare(page);
  const primary=page.getByRole('button',{name:'系統分享圖片／連結',exact:true});
  await expect(primary).toBeVisible();expect(await primary.evaluate(el=>!!document.fullscreenElement?.contains(el))).toBe(true);
  const dialog=await openDailyResultShare(page),copy=dialog.getByRole('button',{name:'複製同題挑戰連結',exact:true});
  await expect(copy).toBeVisible();expect(await copy.evaluate(el=>!!document.fullscreenElement?.contains(el))).toBe(true);
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

test('AD-3 photo action status distinguishes repeated capture failures and saved film without frame announcements',async({page})=>{
  await openGame(page,'photo');const notice=page.locator('.fw-arcade-notice'),shutter=page.getByRole('button',{name:'拍照快門',exact:true});
  await expect(notice).toHaveAttribute('role','status');await expect(notice).toHaveAttribute('aria-atomic','true');
  const original=await page.evaluateHandle(()=>HTMLCanvasElement.prototype.toDataURL);
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toDataURL=function(){throw Error('Synthetic repeated capture failure');};});
  try{
    for(let attempt=1;attempt<=2;attempt++){
      await shutter.click();await expect(notice).toHaveText(`本局第 ${attempt} 次拍照未保存。Synthetic repeated capture failure 第 1 / 3 位客人，已保存 0 / 2 張，還可拍 2 張。`);
      await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(0);await expect(shutter).toBeEnabled();await expect(page.locator('[data-photo-film]')).toBeVisible();await expect(page.locator('[data-photo-film]')).toHaveText('2 張');
    }
  }finally{await page.evaluate(fn=>{HTMLCanvasElement.prototype.toDataURL=fn;},original);await original.dispose();}
  await shutter.click();await expect(notice).toContainText('第 1 / 3 位客人，已保存 1 / 2 張，還可拍 1 張。');await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(1);
  const changes=await notice.evaluateHandle(el=>{const record={count:0};const observer=new MutationObserver(records=>{record.count+=records.length;});observer.observe(el,{childList:true,subtree:true,characterData:true});return {record,observer};});
  await page.clock.runFor(500);expect(await changes.evaluate(({record})=>record.count)).toBe(0);
  await shutter.click();await expect(notice).toContainText('第 1 / 3 位客人，已保存 2 / 2 張，還可拍 0 張。');await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(2);await expect(shutter).toBeDisabled();
  expect(await changes.evaluate(({record})=>record.count)).toBeGreaterThan(0);await changes.evaluate(({observer})=>observer.disconnect());await changes.dispose();
  await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();await shutter.click();await expect(notice).toContainText('第 2 / 3 位客人，已保存 1 / 2 張，還可拍 1 張。');
});

test('AD-3 public photo studio captures real frames, enforces film, and exports a complete poster',async({page})=>{
  test.setTimeout(120_000);await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openGame(page,'photo');await enterNativeFullscreen(page);
  const shutter=page.getByRole('button',{name:'拍照快門',exact:true});
  await shutter.click();await shutter.click();await expect(shutter).toBeDisabled();
  await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'鏡頭往上',exact:true}).click();
  await page.getByRole('slider').focus();await page.getByRole('slider').press('End');
  await page.clock.runFor(160);
  await shutter.click();await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();
  await page.clock.fastForward(3500);await shutter.click();
  await page.getByRole('button',{name:'挑選照片',exact:true}).click();
  await expect(page.getByRole('region',{name:'遊戲成果'})).toBeFocused();
  await expectResultInNativeFullscreen(page);
  await expect(page.locator('.fw-arcade-photo-choices button')).toHaveCount(4);
  await socialEntries(page,'photo');
  await page.locator('.fw-arcade-photo-choices button').first().click();
  await expect(page.locator('.fw-arcade-photo-choices [aria-pressed="true"]')).toHaveCount(1);
  await closeDailyResultShare(page);await page.getByRole('button',{name:'退出全螢幕'}).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.evaluate(() => Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false}));
  await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
  const viewportResult=page.getByRole('dialog',{name:'遊戲全螢幕'});
  await expect(viewportResult.getByRole('button',{name:'系統分享圖片／連結'})).toBeVisible();
  await viewportResult.getByRole('button',{name:'分享成果',exact:true}).click();
  await expect(viewportResult.getByRole('button',{name:'複製同題挑戰連結'})).toBeVisible();
  await expect(viewportResult.locator('[data-daily-result-share]')).toBeVisible();
  await expect(viewportResult.locator('[data-daily-result-share]').getByRole('button',{name:'關閉分享',exact:true})).toBeFocused();
  await expect(viewportResult.getByRole('button',{name:'發到自由工坊',exact:true})).toBeInViewport();
  await closeDailyResultShare(page);await viewportResult.getByRole('button',{name:'退出全螢幕'}).click();
  await openDailyResultShare(page);
  await expect(page.locator('.fw-arcade-photo-choices [aria-pressed="true"]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  await closeDailyResultShare(page);const download=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG'}).click();
  const file=await download,path=await file.path();expect(path).toBeTruthy();
  const info=await sharp(path!).metadata();expect([info.width,info.height]).toEqual([960,1200]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('AD-4 twelve real documents finish once after practice; blur pauses until explicit resume',async({page})=>{
  test.setTimeout(120_000);await page.setViewportSize({width:390,height:844});await openGame(page,'stamp');await enterNativeFullscreen(page);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();
  await page.keyboard.press('Space');await expect(page.locator('.fw-arcade-counter')).toHaveText('練習中');
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
  await page.keyboard.press('Space');await expect(page.getByText('練習完成。十二張正式公文，開始！',{exact:true})).toBeVisible();
  let point=stampTarget(42,0);
  for(let i=0;i<12;i++){
    const target=stampTarget(42,i),x=Math.round((target.x-point.x)/.06),y=Math.round((target.y-point.y)/.06);
    for(let k=0;k<Math.abs(x);k++)await page.keyboard.press(x>0?'ArrowRight':'ArrowLeft');
    for(let k=0;k<Math.abs(y);k++)await page.keyboard.press(y>0?'ArrowDown':'ArrowUp');
    point={x:point.x+x*.06,y:point.y+y*.06};await page.clock.fastForward(230);await page.keyboard.press('Space');
    if(i<11){await expect(page.locator('.fw-arcade-counter')).toHaveText(`${i+1}/12`);await expect(page.locator('.fw-arcade-notice')).toHaveText(`啪！已閱，但看不懂。 已完成 ${i+1} / 12 份 · 多蓋 0 次。`);}
  }
  await expect(page.locator('[data-daily-result-share]')).toContainText('完成 12 份文件');
  await expect(page.getByRole('region',{name:'遊戲成果'})).toBeFocused();
  await socialEntries(page,'stamp');
  await expectResultInNativeFullscreen(page);
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.fullscreenElement?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-daily-result-share]')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(page.getByRole('button',{name:'系統分享圖片／連結'})).toBeVisible();
  await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.getByRole('button',{name:'同一題再來一次'}).click();
  await expect(page.locator('.fw-arcade-board')).toBeFocused();
  expect(await page.evaluate(() => !!document.fullscreenElement?.contains(document.activeElement))).toBe(true);
});

test('AD-4 repeated practice misses stay uncounted and ignored rapid inputs leave status unchanged',async({page})=>{
  await openGame(page,'stamp');const board=page.locator('.fw-arcade-board'),notice=page.locator('.fw-arcade-notice');
  for(let i=0;i<6;i++)await board.press('ArrowRight');
  for(let attempt=1;attempt<=2;attempt++){
    await board.press('Space');await expect(notice).toHaveText(`章歪了。墨跡留下，這張再蓋一次。 練習失手 ${attempt} 次，不計入正式文件。`);
    await board.press('Space');await expect(notice).toHaveText(`章歪了。墨跡留下，這張再蓋一次。 練習失手 ${attempt} 次，不計入正式文件。`);await expect(page.locator('.fw-arcade-counter')).toHaveText('練習中');await page.clock.fastForward(230);
  }
  for(let i=0;i<6;i++)await board.press('ArrowLeft');await board.press('Space');
  await expect(notice).toHaveText('練習完成。十二張正式公文，開始！');await expect(page.locator('.fw-arcade-meta')).toContainText('多蓋 0 次');await expect(page.locator('.fw-arcade-counter')).toHaveText('0/12');
});

test('AD-5 repeated wrong sorts report real mistakes without consuming cards or announcing clock ticks',async({page})=>{
  await openGame(page,'cash');const board=page.locator('.fw-arcade-board'),notice=page.locator('.fw-arcade-notice'),deck=cashDeck(42),wrong=deck[0].valid?'ArrowLeft':'ArrowRight';
  for(let attempt=1;attempt<=2;attempt++){
    await board.press(wrong);await expect(notice).toHaveText(`這張分錯了，退回來重新看看。 已分類 0 / 30 張 · 分錯 ${attempt} 次。`);
    await board.press(wrong);await expect(notice).toHaveText(`這張分錯了，退回來重新看看。 已分類 0 / 30 張 · 分錯 ${attempt} 次。`);await expect(page.locator('.fw-arcade-counter')).toHaveText('0 / 100 萬');await page.clock.fastForward(175);
  }
  for(let i=0;i<2;i++){
    await board.press(deck[i].valid?'ArrowRight':'ArrowLeft');await expect(notice).toContainText(`已分類 ${i+1} / 30 張 · 分錯 2 次。`);
    const accepted=await notice.textContent();await page.clock.runFor(200);await expect(notice).toHaveText(accepted!);
  }
});

// Hosted #1044 exhausted 120s after ~108s in the first 29 input/clock pairs.
// Budget both full cash rounds for recovery/share assertions before teardown;
// retain desktop rendering, real inputs, and all individual assertion deadlines.
test('AD-5 sort exact million, recover denied storage, cancel system share, and hand off without a post',async({page})=>{
  test.setTimeout(180_000);await installCosmeticFilters(page);await openGame(page,'cash');await enterNativeFullscreen(page);const posts:string[]=[];
  page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  const deck=cashDeck(42);await page.keyboard.press(deck[0].valid?'ArrowLeft':'ArrowRight');
  await expect(page.getByText('這張分錯了，退回來重新看看。 已分類 0 / 30 張 · 分錯 1 次。',{exact:true})).toBeVisible();await page.clock.fastForward(180);
  for(const card of deck){await page.keyboard.press(card.valid?'ArrowRight':'ArrowLeft');await page.clock.fastForward(175);}
  await expect(page.locator('[data-daily-result-share]')).toContainText('100 萬道具鈔 · 退回 6 張票券');
  await expect(page.getByRole('region',{name:'遊戲成果'})).toBeFocused();
  await socialEntries(page,'cash');
  await expectResultInNativeFullscreen(page);
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:async(payload:ShareData)=>{(window as unknown as {sharePayload:unknown}).sharePayload={text:payload.text,type:payload.files?.[0]?.type};throw new DOMException('cancel','AbortError');}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});
  });
  await closeDailyResultShare(page);await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();
  await openDailyResultShare(page);
  await expect(page.locator('[data-daily-result-share]').getByText('已取消分享，成果仍在這裡。',{exact:true})).toBeVisible();
  await expectResultInNativeFullscreen(page);
  expect(await page.evaluate(()=>(window as unknown as {sharePayload:{text:string;type:string}}).sharePayload)).toEqual({text:expect.stringContaining('/play?game=cash&seed=42'),type:'image/png'});
  await page.getByRole('button',{name:'複製同題挑戰連結',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'同題連結',exact:true})).toHaveValue(/\/play\?game=cash&seed=42$/);
  await page.evaluate(key=>{
    const original=Storage.prototype.setItem;
    (window as unknown as {restoreStorage:()=>void}).restoreStorage=()=>{Storage.prototype.setItem=original;};
    Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('quota','QuotaExceededError');return original.call(this,k,v);};
  },GAME_HANDOFF_KEY);
  await page.getByRole('button',{name:'發到自由工坊',exact:true}).click();
  await expect(page.locator('[data-daily-result-share]').getByText('成果還沒保存，請重試「發到自由工坊」，或先下載圖片。',{exact:true})).toBeVisible();
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
    const original=HTMLCanvasElement.prototype.toDataURL;let failures=0;
    HTMLCanvasElement.prototype.toDataURL=function(...args){
      if(this.width===960&&this.height===720&&args[0]==='image/jpeg'){
        if(++failures===2)HTMLCanvasElement.prototype.toDataURL=original;
        throw Error('Synthetic final capture failure');
      }
      return original.apply(this,args);
    };
  });
  await page.keyboard.press(deck[29].valid?'ArrowRight':'ArrowLeft');
  await expect(page.locator('.fw-arcade-notice')).toContainText('完成次數不會重算');
  await expect(page.locator('.fw-arcade-controls .fw-arcade-meta')).toContainText('已分類 30 / 30');
  await expect(page.locator('[data-daily-result-share]')).toHaveCount(0);
  await expect(page.locator('.fw-arcade-notice')).toContainText('第 1 次產生成果圖片失敗。');
  await page.getByRole('button',{name:'重試產生成果圖片',exact:true}).click();
  await expect(page.locator('.fw-arcade-notice')).toContainText('第 2 次產生成果圖片失敗。');
  await expect(page.locator('.fw-arcade-controls .fw-arcade-meta')).toContainText('已分類 30 / 30');await expect(page.locator('[data-daily-result-share]')).toHaveCount(0);
  await page.getByRole('button',{name:'重試產生成果圖片',exact:true}).click();
  await expect(page.locator('[data-daily-result-share]')).toContainText('100 萬道具鈔 · 退回 6 張票券');
  await openDailyResultShare(page);const image=page.locator('.fw-arcade-result-photo > img');
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
  await installCosmeticFilters(page);
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
  const alert=page.getByRole('alert'),canvas=page.locator('.fw-arcade-stage canvas');
  await expect(page.locator('.fw-arcade-stage-cover').getByRole('status')).toHaveText('正在佈置現場…');
  await page.clock.fastForward(14_999);
  await expect(alert).toHaveCount(0);await expect(retry).toHaveCount(0);
  await expect(start).toHaveCount(0);await expect(canvas).toHaveCount(0);
  await page.clock.fastForward(1);
  await expect(alert).toBeVisible();
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
  await expect(page.locator('.fw-arcade-controls .fw-arcade-meta')).toContainText('已分類 1 / 30');
});

test('AD-6 render exception recovers paused, keeps progress and resumes action cooldowns only on Continue',async({page})=>{
  test.setTimeout(120_000);await openGame(page,'cash');
  const deck=cashDeck(42),progress=page.locator('.fw-arcade-controls .fw-arcade-meta');
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
  await expect(resume).toBeVisible();await expect(page.locator('.fw-arcade-stage canvas')).toHaveCount(1);
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
      if(document.querySelector('.fw-arcade-stage canvas')){
        prototype.compileShader=original;
        (window as unknown as {failedStageContext:WebGL2RenderingContext}).failedStageContext=this;
        throw Error('Synthetic pre-return environment failure');
      }
      return original.apply(this,args);
    };
  });
  await page.goto('/play?game=cash&seed=42');
  await expect(page.getByRole('alert')).toContainText('此瀏覽器暫時無法開啟 3D 場景');
  await expect(page.locator('.fw-arcade-stage canvas')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {failedStageContext:WebGL2RenderingContext}).failedStageContext.isContextLost())).toBe(true);
  await page.getByRole('button',{name:'重試場景',exact:true}).click();
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
  await expect(page.locator('.fw-arcade-stage canvas')).toHaveCount(1);
  await page.getByRole('button',{name:'開始這一局',exact:true}).click();
  await page.keyboard.press(cashDeck(42)[0].valid?'ArrowRight':'ArrowLeft');
  await expect(page.locator('.fw-arcade-controls .fw-arcade-meta')).toContainText('已分類 1 / 30');
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
  await page.locator('.fw-arcade-stage canvas').evaluate(c=>c.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  await expect(page.getByRole('button',{name:'重試場景',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'重試場景',exact:true}).click();
  // Reconstruction has the same bounded readiness phase as initial load and import retry.
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.fw-arcade-stage canvas')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
  await page.getByRole('button',{name:'回遊樂場',exact:true}).click();await expect(page.locator('.fw-arcade-stage canvas')).toHaveCount(0);
  await expect(page.locator('.fw-arcade-game-card')).toHaveCount(3);
});

import {RECIPES,recipeOf,type Recipe,type Technique} from '../../apps/portal-web/src/games/cooking/catalog.js';
import {actCooking,advanceCooking,cookingScore,currentStep,newCookingRun,type CookingAction,type CookingRun} from '../../apps/portal-web/src/games/cooking/domain.js';
import {COOKBOOK_KEY,COOKING_RUN_KEY} from '../../apps/portal-web/src/games/cooking/storage.js';
async function openKitchen(page:Page,id:string){
  await page.clock.install({time:new Date('2026-10-25T02:00:00Z')});await page.goto(`/play?game=kitchen&practice=1&recipe=${id}&seed=42`);
  await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();await expect(page.locator('.ck-visual-3d')).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-25T02:01:00Z'));await page.getByRole('button',{name:'開始料理',exact:true}).click();await exitStartedFullscreen(page);
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

for(const width of [320,1440])for(const kind of ['slice','knead'] as const)test(`UX-2: recipe help owns repeated native keys without cooking at ${width}px (${kind})`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width,height:900});await page.clock.install();
  // The supported illustration fallback uses the same controls without a GPU dependency.
  await page.route('**/assets/kitchen-stage-*.js',route=>route.abort());
  await page.goto(`/play?game=kitchen&practice=1&recipe=${kind==='slice'?'egg-fried-rice':'margherita-pizza'}&seed=42`);
  await expect(page.locator('.ck-visual-light')).toBeVisible();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));
  await page.getByRole('button',{name:'開始料理',exact:true}).click();await exitStartedFullscreen(page);
  const game=page.locator('.ck-game'),help=page.locator('.ck-help'),summary=help.locator('summary'),meter=page.locator('.ck-meter-copy');
  const tool=page.getByRole('button',{name:kind==='slice'?'沿線切一刀':'按住揉壓，適時放開',exact:true});
  await tool.focus();await page.keyboard.press('Tab');await expect(summary).toBeFocused();
  await page.keyboard.down('Space');await page.keyboard.down('Space');await page.clock.runFor(750);await page.keyboard.up('Space');
  await expect(help).toHaveAttribute('open','');await expect(summary).toBeFocused();
  let opened=true;for(const key of ['Space','Enter','Space','Enter']){
    await page.keyboard.press(key);opened=!opened;expect(await help.evaluate(el=>(el as HTMLDetailsElement).open)).toBe(opened);
    await expect(summary).toBeFocused();await expect(meter).toHaveText(kind==='slice'?'0 / 6':'0 / 4');
  }
  await expect(game).toHaveAttribute('data-cooking-state','playing');await expect(page.locator('.fw-arcade-result')).toHaveCount(0);
  await game.focus();await page.keyboard.down('Space');if(kind==='knead')await page.clock.runFor(750);await page.keyboard.up('Space');
  await expect(meter).toHaveText(kind==='slice'?'1 / 6':'1 / 4');await game.press('Escape');
  const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run as CookingRun,COOKING_RUN_KEY);
  expect(saved.status).toBe('paused');expect(saved.active.count).toBe(1);expect(saved.active.holdAt).toBeNull();expect(saved.reports).toEqual([]);
  await page.reload();await expect(page.getByRole('button',{name:'繼續料理',exact:true})).toBeEnabled();await expect(meter).toHaveText(kind==='slice'?'1 / 6':'1 / 4');
  await summary.focus();await page.keyboard.press('Space');await expect(help).toHaveAttribute('open','');await expect(game).toHaveAttribute('data-cooking-state','paused');
  await page.getByRole('button',{name:'繼續料理',exact:true}).click();await expect(game).toHaveAttribute('data-cooking-state','playing');await expect(meter).toHaveText(kind==='slice'?'1 / 6':'1 / 4');expect(errors).toEqual([]);
});

test('UX-7: the real pan, boiling pot and oven accept direct scene taps with the same persisted rules',async({page},testInfo)=>{
  test.setTimeout(120000);await page.setViewportSize({width:390,height:844});await page.clock.install();await page.goto('/play');
  for(const kind of ['pan','boil','bake'] as const){await page.goto('/play');const f=kitchenCheckpoint(kind);await page.evaluate(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`);await expect(page.locator('.ck-visual-3d')).toBeVisible();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));await page.getByRole('button',{name:'繼續料理',exact:true}).click();await exitStartedFullscreen(page);await page.getByRole('button',{name:'中火',exact:true}).click();const advance=()=>page.clock.runFor(currentStep(f.run).durationMs*(kind==='bake'?.8:.55));if(kind==='pan')await withBoundedCpuProfile(page,testInfo,advance);else await advance();await page.locator('.ck-scene').scrollIntoViewIfNeeded();const p=await scenePoint(page,.5,.5);await page.mouse.click(p.x,p.y);await page.locator('.ck-game').press('Escape');const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run as CookingRun,COOKING_RUN_KEY);if(kind==='pan')expect(saved.active.flipped).toBe(true);if(kind==='boil'){expect(saved.active.count).toBe(1);expect(saved.active.foam).toBe(0);}if(kind==='bake'){expect(saved.reports).toHaveLength(f.run.step+1);expect(saved.reports.at(-1)!.score).toBeGreaterThanOrEqual(85);}}
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
    if(s.kind==='slice')for(let i=0;i<s.goal;i++){await page.clock.runFor(160);const x=cutGuideAt(s,i),from=await scenePoint(page,x,.23),to=await scenePoint(page,x,.78);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();}
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
  // Native PNG encoding has a 6.7s idle fallback in Chromium 153; wait only for that artifact.
  await expect(page.locator('.fw-arcade-result')).toBeVisible();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible({timeout:10_000});await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15000});await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();await expect(page.locator('.fw-arcade-result-heading')).toContainText(recipe.name);
  await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+100));
}
test('UX-7: a real-clock 3D cooking journey completes mixing, timed kneading and folding into a shareable result',async({page})=>{
  const recipe=recipeOf('rice-balls')!,errors:string[]=[];let posts=0;page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts++;});await page.setViewportSize({width:390,height:844});await page.goto('/play?game=kitchen&practice=1&recipe=rice-balls&seed=42');await expect(page.locator('.ck-visual-3d')).toBeVisible();await page.getByRole('button',{name:'開始料理',exact:true}).click();
  for(const [index,s]of recipe.steps.entries()){
    if(s.kind==='mix'){const first=await scenePoint(page,.8,.52);await page.mouse.move(first.x,first.y);await page.mouse.down();for(let i=1;i<=s.goal*32;i++){const a=i*Math.PI/16,p=await scenePoint(page,.5+.3*Math.cos(a),.52+.3*Math.sin(a));await page.mouse.move(p.x,p.y);}await page.mouse.up();}
    // One native key press owns the real hold interval. Separate traced down/up
    // calls also hold the key during the intervening trace snapshots.
    if(s.kind==='knead')for(let i=0;i<s.goal;i++){await page.locator('.ck-game').focus();await page.keyboard.press('Space',{delay:s.holdMs});await page.waitForTimeout(160);}
    if(s.kind==='fold')for(const direction of s.directions){await page.waitForTimeout(160);await page.locator('.ck-game').focus();await page.keyboard.press(`Arrow${direction[0].toUpperCase()+direction.slice(1)}`);}
    if(index<recipe.steps.length-1)await page.getByRole('button',{name:/^下一步：/}).click();
  }
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toHaveAttribute('href',/^blob:/);const book=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),COOKBOOK_KEY);expect(book.best['rice-balls'].score).toBeGreaterThanOrEqual(85);expect(posts).toBe(0);expect(errors).toEqual([]);
});

for(const id of ['egg-fried-rice','rice-balls','chocolate-brownie','pearl-milk-tea'])test(`CK-5: ${id} completes through real scene gestures and keyboard cooking controls`,async({page})=>{
  // Retain encoder-phase observations for the hosted PNG failure.
  if(id==='egg-fried-rice')await page.addInitScript(installExportTimingProbe);
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
  await expect(page.locator('.fw-arcade-result-heading h1')).toHaveText(recipeOf('egg-fried-rice')!.name);await expect(page.locator('.fw-arcade-result-heading [aria-label="料理分數"]')).toHaveText(/^\d+分$/);await expect(page.locator('.fw-arcade-result')).not.toContainText('顆星');
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
  const popupPromise=context.waitForEvent('page');await page.getByRole('link',{name:'開啟 X 分享 ↗',exact:true}).click();const popup=await popupPromise;await popup.waitForURL('https://x.com/intent/tweet?**');expect(new URL(popup.url()).searchParams.get('text')).toContain('recipe=egg-fried-rice');await popup.close();await expect(page.locator('.fw-arcade-result')).toBeVisible();
  await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();await expect(page.getByRole('textbox',{name:'同題連結',exact:true})).toHaveValue(/recipe=egg-fried-rice/);await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();
});

test('CK-7: previewing another recipe preserves the unfinished dish and returning keeps lobby filters',async({page})=>{
  await page.goto('/play');await page.getByRole('button',{name:/日式料理/}).click();await page.getByRole('button',{name:'開始製作海苔飯糰',exact:true}).click();await page.getByRole('button',{name:'開始料理',exact:true}).click();await page.getByRole('button',{name:'攪拌一圈 ↻',exact:true}).click();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(8);
  const before=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);await page.getByRole('button',{name:'開始製作蝦子天婦羅',exact:true}).click();await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();
  const after=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!),COOKING_RUN_KEY);expect(after.run.id).toBe(before.run.id);await page.getByRole('button',{name:'開始製作海苔飯糰',exact:true}).click();await expect(page.getByRole('button',{name:'繼續料理',exact:true})).toBeVisible();await expect(page.locator('.ck-meter-copy')).toContainText('1.0 / 2 圈');
});
test('CK-2/7: unavailable artwork and storage have usable fallbacks, while an unknown recipe returns the lobby',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Synthetic quota','QuotaExceededError');};});
  await page.route('**/games/absurd-daily/cooking/3d/*.webp',route=>route.abort());await page.route('**/games/absurd-daily/illustrated/*.webp',route=>route.abort());
  await page.route('**/assets/kitchen-stage-*.js',route=>route.abort());
  await page.goto('/play?game=kitchen&practice=1&recipe=unknown&seed=42');await expect(page.getByRole('status').filter({hasText:'這道料理連結無法辨識'})).toBeVisible();
  const fallback=await page.locator('.ck-recipe-card').first().locator('.sg-cover-fallback').boundingBox(),owner=await page.locator('.ck-recipe-card').first().locator('.ck-recipe-visual').boundingBox();expect(fallback!.y+fallback!.height).toBeLessThanOrEqual(owner!.y+owner!.height);
  await page.getByRole('button',{name:'收藏黃金蛋炒飯',exact:true}).click();await expect(page.getByRole('button',{name:'重試保存食譜本',exact:true})).toBeVisible();
  await page.goto('/play?game=kitchen&practice=1&recipe=egg-fried-rice&seed=42');
  // The guided ready screen is the live kitchen, no longer a decorative cover.
  await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(page.locator('.ck-scene')).toBeVisible();
  await page.getByRole('button',{name:'開始料理',exact:true}).click();
  await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(page.locator('.ck-kitchen-canvas canvas')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'重試保存',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'沿線切一刀',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toHaveText('1 / 6');
});

test('CK-8: enlarged real recipe text keeps the start/resume action inside its owner on compact and landscape screens',async({page},testInfo)=>{
  for(const viewport of [{width:320,height:568},{width:667,height:375}]){
    await page.setViewportSize(viewport);await page.goto('/play?game=kitchen&practice=1&recipe=strawberry-cake&seed=42');await expect(page.getByRole('button',{name:'開始料理',exact:true})).toBeVisible();
    await page.evaluate(()=>{const styles=[...document.querySelectorAll('.fw-arcade-root,.fw-arcade-root *')].filter(e=>e instanceof HTMLElement).map(e=>({e:e as HTMLElement,font:parseFloat(getComputedStyle(e).fontSize),line:parseFloat(getComputedStyle(e).lineHeight)}));for(const {e,font,line}of styles){e.style.fontSize=`${font*2}px`;if(Number.isFinite(line))e.style.lineHeight=`${line*2}px`;}});
    const contained=()=>page.locator('.ck-scene-overlay').evaluate(e=>{const button=e.querySelector('button')!.getBoundingClientRect(),owner=e.getBoundingClientRect();return button.top>=owner.top&&button.bottom<=owner.bottom&&button.left>=owner.left&&button.right<=owner.right;});
    expect(await contained()).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'開始料理',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>{const mode=document.querySelector('.ck-visual-tools button')!.getBoundingClientRect(),bar=document.querySelector('.fullscreen-game__bar')!.getBoundingClientRect(),toolbar=document.querySelector('.ck-console-toolbar')!.getBoundingClientRect(),mission=document.querySelector('.ck-stage-mission')!.getBoundingClientRect();return (mode.right<=bar.left||mode.top>=bar.bottom)&&toolbar.bottom<=mission.top;})).toBe(true);
    await testInfo.attach(`immersive-${viewport.width}x${viewport.height}-double-text.png`,{body:await page.screenshot(),contentType:'image/png'});
    await exitStartedFullscreen(page);await page.getByRole('button',{name:'暫停',exact:true}).click();
    // Pause creates a fresh overlay; only those new nodes need the 200% style.
    await page.locator('.ck-scene-overlay').evaluate(owner=>{const styles=[owner,...owner.querySelectorAll('*')].filter(e=>e instanceof HTMLElement).map(e=>({e:e as HTMLElement,font:parseFloat(getComputedStyle(e).fontSize),line:parseFloat(getComputedStyle(e).lineHeight)}));for(const {e,font,line}of styles){e.style.fontSize=`${font*2}px`;if(Number.isFinite(line))e.style.lineHeight=`${line*2}px`;}});
    await expect.poll(contained).toBe(true);await page.locator('.ck-scene-overlay .ck-help summary').click();
    await expect(page.locator('.ck-help')).toHaveAttribute('open','');await expect.poll(contained).toBe(true);
    await testInfo.attach(`immersive-${viewport.width}x${viewport.height}-double-text-paused-help.png`,{body:await page.screenshot(),contentType:'image/png'});
    await page.getByRole('button',{name:'繼續料理',exact:true}).click();await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await page.evaluate(()=>sessionStorage.removeItem('freedom.cooking.run.v1'));
  }
});

test('CK-3: the playroom browses all game types, pages dishes and separates favorite hit areas from starting a game',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/play');await expect(page.locator('.ck-recipe-card')).toHaveCount(8);await page.getByRole('button',{name:'再看看 8 道料理',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(16);
  const open=await page.getByRole('button',{name:'開始製作黃金蛋炒飯',exact:true}).boundingBox(),favorite=await page.getByRole('button',{name:'收藏黃金蛋炒飯',exact:true}).boundingBox();expect(open!.y+open!.height).toBeLessThanOrEqual(favorite!.y);await page.getByRole('button',{name:'收藏黃金蛋炒飯',exact:true}).click();await expect(page).toHaveURL(/\/play$/);
  await page.getByRole('button',{name:'觀察攝影 1',exact:true}).click();await expect(page.locator('.fw-arcade-game-card')).toHaveCount(1);await expect(page.locator('.ck-recipe-card')).toHaveCount(0);
  await page.getByRole('button',{name:'反應手速 5',exact:true}).click();await expect(page.locator('.fw-arcade-game-card')).toHaveCount(2);await expect(page.locator('.pt-party-card')).toHaveCount(3);await page.getByRole('button',{name:'料理小遊戲 66',exact:true}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(16);
  await page.getByRole('button',{name:/♡ 我的收藏/}).click();await expect(page.locator('.ck-recipe-card')).toHaveCount(1);await page.getByRole('button',{name:'這道我來做',exact:true}).click();await expectNativeMarketReady(page);await page.getByRole('button',{name:'← 大廳',exact:true}).click();await expect(page.getByRole('combobox',{name:'食譜篩選',exact:true})).toHaveValue('favorite');await expect(page.locator('.ck-recipe-card')).toHaveCount(1);
});


test('UX-8: the native completed meal rotates with pointer and keyboard, keeps score through context loss and releases on return',async({page})=>{
  await page.route('**/assets/dish-worker-*.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:`const nativeGetContext=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(...args){const gl=nativeGetContext.apply(this,args);if(args[0]==='webgl2')self.__dishTestContext=gl;return gl;};\n`+await response.text()});});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const f=kitchenCheckpoint('result');await page.addInitScript(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);await page.setViewportSize({width:390,height:844});await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`);await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15_000});await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();
  const canvas=page.locator('.ck-dish-canvas canvas'),surface=page.locator('.ck-dish-surface'),score=await page.locator('.fw-arcade-result-heading').innerText();await surface.scrollIntoViewIfNeeded();const before=await canvas.screenshot(),box=(await surface.boundingBox())!;await page.mouse.move(box.x+box.width*.35,box.y+box.height*.5);await page.mouse.down();await surface.dispatchEvent('pointercancel',{pointerId:99,isPrimary:false});await page.mouse.move(box.x+box.width*.72,box.y+box.height*.5,{steps:8});await page.mouse.up();await expect(page.locator('.ck-dish-canvas')).toHaveAttribute('data-render-pending','0');expect((await canvas.screenshot()).equals(before)).toBe(false);await page.getByRole('button',{name:'回正',exact:true}).click();await expect(page.locator('.ck-dish-canvas')).toHaveAttribute('data-render-pending','0');expect((await canvas.screenshot()).equals(before)).toBe(true);await surface.focus();await page.keyboard.press('ArrowLeft');await expect(page.locator('.ck-dish-canvas')).toHaveAttribute('data-render-pending','0');expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole('button',{name:'回正',exact:true}).click();await surface.scrollIntoViewIfNeeded();const touchBox=(await surface.boundingBox())!,cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});const cy=touchBox.y+touchBox.height*.5,cx=touchBox.x+touchBox.width*.5;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-25,y:cy,id:1},{x:cx+25,y:cy,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-65,y:cy,id:1},{x:cx+65,y:cy,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.locator('.ck-dish-canvas')).toHaveAttribute('data-render-pending','0');expect((await canvas.screenshot()).equals(before)).toBe(false);await page.getByRole('button',{name:'回正',exact:true}).click();await expect(page.locator('.ck-dish-canvas')).toHaveAttribute('data-render-pending','0');expect((await canvas.screenshot()).equals(before)).toBe(true);await cdp.detach();
  const worker=page.workers().find(w=>w.url().includes('/dish-worker-'))!;expect(worker).toBeTruthy();const closed=new Promise<void>(resolve=>worker.once('close',()=>resolve()));await worker.evaluate(()=>(self as unknown as {__dishTestContext:WebGL2RenderingContext}).__dishTestContext.getExtension('WEBGL_lose_context')!.loseContext());await expect(page.locator('[data-dish-view="fallback"]')).toBeVisible();await expect(canvas).toHaveCount(0);expect(await page.locator('.fw-arcade-result-heading').innerText()).toBe(score);await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();await page.getByRole('button',{name:'重試3D成品',exact:true}).click();await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15_000});await closed;
  const current=page.workers().find(w=>w.url().includes('/dish-worker-'))!;const returned=new Promise<void>(resolve=>current.once('close',()=>resolve()));await page.getByRole('button',{name:'回遊樂場',exact:true}).click();await expect(canvas).toHaveCount(0);await returned;expect(errors).toEqual([]);
});

test('UX-8: a delayed real dish-view module has a finite fallback, ignores late completion and retries without losing the poster',async({page})=>{
  test.setTimeout(60000);const f=kitchenCheckpoint('result');await page.addInitScript(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);await page.clock.install();let capture!:(route:Route)=>void;const requested=new Promise<Route>(resolve=>{capture=resolve;});await page.route('**/assets/dish-preview-worker-*.js',route=>capture(route));await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`,{waitUntil:'domcontentloaded'});const route=await requested,response=await route.fetch(),url=route.request().url();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+100));await page.clock.fastForward(15000);await expect(page.locator('[data-dish-view="fallback"]')).toBeVisible();await expect(page.locator('.ck-dish-canvas canvas')).toHaveCount(0);await route.fulfill({response});await page.evaluate(async u=>{await import(u);},url);await expect(page.locator('[data-dish-view="fallback"]')).toBeVisible();await page.clock.resume();await page.getByRole('button',{name:'重試3D成品',exact:true}).click();await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15_000});await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();
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
async function marketOpen(page:Page,id:MarketId){await page.clock.install();await page.setViewportSize({width:390,height:844});await page.goto(`/play?game=kitchen&recipe=${id}&seed=42`);await expectNativeMarketReady(page);await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));await page.getByRole('button',{name:'開火，開始做！',exact:true}).click();await expect(page.locator('.mk-surface')).toBeFocused();await exitStartedFullscreen(page);await page.clock.runFor(20);}
async function marketPanel(page:Page,panel:'ingredients'|'tools'|'sauces'){await page.locator('.mk-palette-switch').getByRole('button',{name:panel==='ingredients'?/^食材/:panel==='tools'?'工具':'調味醬線'}).click();}
// Exercise the production env-backed inset values; this is not device-notch emulation.
async function marketInsets(page:Page,enabled:boolean){await page.locator('.fullscreen-game').evaluate((el,on)=>{for(const [side,value] of Object.entries({top:28,right:24,bottom:32,left:40})){if(on)(el as HTMLElement).style.setProperty(`--game-safe-${side}`,`${value}px`);else (el as HTMLElement).style.removeProperty(`--game-safe-${side}`);}},enabled);}
// Read geometry and real hit targets before clicking. A 44px box that is clipped
// by a scroll container or covered by another row is not an accessible control.
async function marketSceneBounds(page:Page,fullscreen=true){
 const root=page.locator('.fullscreen-game');// Normal mode is a full-height document-flow stage. Align its border box,
 // before checking whole-stage viewport bounds. Nearest scrolling left the
 // stage partially outside at 195px in CI. This only positions the page;
 // all game controls still use ordinary clicks and the unchanged hit checks.
 if(!fullscreen)await root.evaluate(el=>el.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'}));
 const geometry=await root.evaluate(el=>{const r=el.getBoundingClientRect(),s=el.querySelector('.mk-surface')!.getBoundingClientRect(),d=el.querySelector('.mk-tray')!.getBoundingClientRect(),style=getComputedStyle(el),safe=(side:string)=>parseFloat(style.getPropertyValue(`--game-safe-${side}`))||0;return {rects:{root:r.toJSON(),surface:s.toJSON(),tray:d.toJSON()},viewport:{width:innerWidth,height:innerHeight},insets:Object.fromEntries(['top','right','bottom','left'].map(side=>[side,safe(side)])),columns:['.mk-game','.mk-workbench','.mk-play-space','.mk-tray'].map(selector=>({selector,value:getComputedStyle(el.querySelector(selector)!).gridTemplateColumns})),within:r.x>=-1&&r.y>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,contained:s.x>=r.x+safe('left')-1&&s.y>=r.y+safe('top')-1&&s.right<=r.right-safe('right')+1&&s.bottom<=r.bottom-safe('bottom')+1&&d.x>=r.x+safe('left')-1&&d.right<=r.right-safe('right')+1&&d.bottom<=r.bottom-safe('bottom')+1,overlap:s.x<d.right&&s.right>d.x&&s.y<d.bottom&&s.bottom>d.y,ratio:s.width/s.height,height:s.height,horizontal:el.scrollWidth<=el.clientWidth};});
 expect(geometry.within,JSON.stringify(geometry)).toBe(true);expect(geometry.contained,JSON.stringify(geometry)).toBe(true);expect(geometry.overlap).toBe(false);expect(geometry.ratio).toBeCloseTo(6/5,2);expect(geometry.height).toBeGreaterThan(44);expect(geometry.horizontal).toBe(true);

 const paletteContrast=await root.locator('.mk-palette-switch button').evaluateAll(buttons=>{
  const rgb=(value:string)=>value.match(/[\d.]+/g)!.map(Number);
  const luminance=(color:number[])=>color.slice(0,3).map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
  return buttons.map(button=>{const style=getComputedStyle(button),foreground=rgb(style.color),background=rgb(style.backgroundColor),a=luminance(foreground),b=luminance(background);return {label:button.textContent,color:style.color,background:style.backgroundColor,opaque:(foreground[3]??1)===1&&(background[3]??1)===1&&Number(style.opacity)===1,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
 });
 expect(paletteContrast).toHaveLength(3);
 for(const palette of paletteContrast){expect(palette.opaque,JSON.stringify(palette)).toBe(true);expect(palette.contrast,JSON.stringify(palette)).toBeGreaterThanOrEqual(4.5);}
 for(const control of await root.locator('.mk-heading button,.mk-primary button,.mk-heat button,.fullscreen-game__bar button').all()){
  const metrics=await control.evaluate(el=>{
   const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2),root=el.closest('.fullscreen-game')!,r=root.getBoundingClientRect(),style=getComputedStyle(root),safe=(side:string)=>parseFloat(style.getPropertyValue(`--game-safe-${side}`))||0;
   const name=(node:Element)=>node.getAttribute('aria-label')||node.textContent?.trim()||node.tagName;
   const viewportContained=b.x>=Math.max(-1,r.left+safe('left')-1)&&b.y>=Math.max(-1,r.top+safe('top')-1)&&b.right<=Math.min(innerWidth+1,r.right-safe('right')+1)&&b.bottom<=Math.min(innerHeight+1,r.bottom-safe('bottom')+1);
   const clippingAncestors=[];let contained=viewportContained;
   for(let p=el.parentElement;p;p=p.parentElement){
    const style=getComputedStyle(p),r=p.getBoundingClientRect();if(style.display==='contents')continue;
    const clipX=/hidden|auto|scroll|clip/.test(style.overflowX),clipY=/hidden|auto|scroll|clip/.test(style.overflowY);
    const withinX=!clipX||(b.left>=r.left-1&&b.right<=r.right+1),withinY=!clipY||(b.top>=r.top-1&&b.bottom<=r.bottom+1);
    contained&&=withinX&&withinY;
    if(clipX||clipY)clippingAncestors.push({tag:p.tagName,className:p.className,rect:r.toJSON(),overflowX:style.overflowX,overflowY:style.overflowY,rows:style.gridTemplateRows,withinX,withinY});
   }
   const controlStyle=getComputedStyle(el);
   return {control:name(el),rect:b.toJSON(),rootRect:r.toJSON(),viewport:{width:innerWidth,height:innerHeight},insets:Object.fromEntries(['top','right','bottom','left'].map(side=>[side,safe(side)])),mode:root.matches(':fullscreen')?'native':root.classList.contains('fullscreen-game--viewport')?'viewport':'normal',fontSize:controlStyle.fontSize,lineHeight:controlStyle.lineHeight,viewportContained,clippingAncestors,width:b.width,height:b.height,contained,hit:hit===el||el.contains(hit),hitTarget:hit?{tag:hit.tagName,className:hit.getAttribute('class'),name:name(hit).slice(0,120)}:null};
  });
  const diagnostic=JSON.stringify({expectedMode:fullscreen?'presentation':'normal',...metrics});
  expect(metrics.width,diagnostic).toBeGreaterThanOrEqual(44);expect(metrics.height,diagnostic).toBeGreaterThanOrEqual(44);expect(metrics.contained,diagnostic).toBe(true);expect(metrics.hit,diagnostic).toBe(true);
 }
}
async function marketButton(page:Page,name:string){await marketTime(page,400);const button=page.getByRole('button',{name,exact:true});if(!await button.isVisible())await marketPanel(page,/醬/.test(name)?'sauces':'tools');await button.click();}
async function marketAdd(page:Page,name:string){await marketTime(page,400);await marketPanel(page,'ingredients');await page.locator('.mk-ingredients').getByRole('button',{name:new RegExp(`^${name} `)}).click();await marketPanel(page,'tools');}
// These gesture-ownership tests sample real RAF callbacks at the hold boundaries;
// do not spend the whole test rendering every software-WebGL frame in virtual time.
for(const [first,second] of [['Space','Enter'],['Enter','Space']])test(`UX-9: coating hold keeps ${first} ownership after ${second} releases`,async({page})=>{
 await marketOpen(page,'corn-dog');await marketAdd(page,'熱狗');const hold=page.getByRole('button',{name:'按住裹麵糊',exact:true}),progress=page.getByRole('progressbar',{name:'這次裹糊進度'});
 await hold.focus();await page.keyboard.down(first);await page.clock.fastForward(450);await page.keyboard.press(second);expect(Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
 await page.clock.fastForward(500);expect(await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.portions[0].coated,MARKET_SAVE_KEY)).toBe(true);await page.keyboard.up(first);await expect(hold).toBeDisabled();
});

test('UX-9: optional corn dog coating hold cancels early, completes once and keeps keyboard fallback reachable on phone',async({page})=>{
 // This checks continuous gesture ownership, not frame cadence. Advance the
 // installed clock once per boundary while retaining the actual RAF controller.
 await marketOpen(page,'corn-dog');await marketAdd(page,'熱狗');
 const hold=page.getByRole('button',{name:'按住裹麵糊',exact:true}),progress=page.getByRole('progressbar',{name:'這次裹糊進度'});
 const coated=()=>page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.portions.map((p:{coated:boolean})=>p.coated),MARKET_SAVE_KEY);
 await hold.scrollIntoViewIfNeeded();const box=(await hold.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.clock.fastForward(450);expect(Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(0);await page.mouse.up();await page.clock.fastForward(1000);expect(await coated()).toEqual([false]);await expect(progress).toHaveAttribute('aria-valuenow','0');
 await page.evaluate(()=>Object.defineProperty(document.documentElement,'requestFullscreen',{configurable:true,value:undefined}));await page.evaluate(()=>Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:undefined}));await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await expect(page.getByRole('dialog',{name:'遊戲全螢幕',exact:true})).toBeVisible();await hold.focus();await page.keyboard.down('Space');await page.clock.fastForward(450);await page.keyboard.press('Escape');await page.clock.fastForward(1000);expect(await coated()).toEqual([false]);await expect(progress).toHaveAttribute('aria-valuenow','0');await expect(page.getByRole('dialog',{name:'遊戲全螢幕',exact:true})).toHaveCount(0);await page.keyboard.up('Space');await hold.focus();
 await page.keyboard.down('Enter');await page.clock.fastForward(1000);await page.keyboard.up('Enter');expect(await coated()).toEqual([true]);await expect(hold).toBeDisabled();await page.clock.fastForward(1000);expect(await coated()).toEqual([true]);
 await marketAdd(page,'熱狗');const fallback=page.getByRole('button',{name:'裹麵糊',exact:true});await marketTime(page,400);await fallback.focus();await page.keyboard.press('Enter');expect(await coated()).toEqual([true,true]);
});

test('UX-9: corn dog coating cancels native animation frames on touch release and Escape',async({page},testInfo)=>{
 // Keep the browser clock native: clock.install wraps cancelAnimationFrame and
 // would hide an invalid receiver when the real Window method is passed around.
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
 await page.setViewportSize({width:390,height:844});
 await page.goto('/play?game=kitchen&recipe=corn-dog&seed=42');
 await expectNativeMarketReady(page);
 // This regression exercises the real Window API, not continuous WebGL cost.
 // Keep the production game and native RAF, then enter its supported context-loss
 // mode so software rendering cannot delay the input; native gameplay is covered below.
 const native=await page.locator('.mk-canvas canvas').evaluateHandle(c=>(c as HTMLCanvasElement).getContext('webgl2')!);
 await native.evaluate(gl=>gl.getExtension('WEBGL_lose_context')!.loseContext());
 await expect(page.locator('.mk-fallback')).toBeVisible();
 await expect(page.locator('.mk-canvas canvas')).toHaveCount(0);
 expect(await native.evaluate(gl=>gl.isContextLost())).toBe(true);await native.dispose();
 await page.getByRole('button',{name:'開火，開始做！',exact:true}).click();await exitStartedFullscreen(page);
 await page.locator('.mk-ingredients').getByRole('button',{name:/^熱狗 /}).click();await marketPanel(page,'tools');
 const hold=page.getByRole('button',{name:'按住裹麵糊',exact:true});
 const progress=page.getByRole('progressbar',{name:'這次裹糊進度'});
 const coated=()=>page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.portions.map((p:{coated:boolean})=>p.coated),MARKET_SAVE_KEY);
 await hold.scrollIntoViewIfNeeded();
 const box=(await hold.boundingBox())!,cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 const startTouch=()=>cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});
 // Queue the short press in protocol order without turning the start ACK into
 // hold duration. Both events still travel through Chromium's native input path.
 await Promise.all([startTouch(),cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})]);
 expect(errors).toEqual([]);
 await expect(progress).toHaveAttribute('aria-valuenow','0');
 expect(await coated()).toEqual([false]);
 await hold.focus();await page.keyboard.down('Space');
 await page.keyboard.press('Escape');await page.keyboard.up('Space');
 await expect(progress).toHaveAttribute('aria-valuenow','0');
 expect(await coated()).toEqual([false]);
 await startTouch();await expect.poll(coated).toEqual([true]);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
 await expect(hold).toBeDisabled();
 await testInfo.attach('native-browser-errors',{body:JSON.stringify(errors,null,2),contentType:'application/json'});
 expect(errors).toEqual([]);
});

for(const id of ['egg-fried-rice','steak-dinner','shawarma','corn-dog'] as MarketId[])test(`UX-9: ${id} cooks through actual controls to its own inspectable, downloadable and shareable result`,async({page},testInfo)=>{
 test.setTimeout(120000);const errors:string[]=[];let posts=0;page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts++;});await marketOpen(page,id);
 if(id==='corn-dog'){await marketAdd(page,'熱狗');await marketButton(page,'裹麵糊');await marketTime(page,24000);await marketButton(page,'翻這一面');await marketTime(page,24000);await marketButton(page,'起鍋瀝油');await marketTime(page,4000);}
 if(id==='steak-dinner'){await marketAdd(page,'牛排');await marketAdd(page,'薯條');await page.getByRole('combobox',{name:'目前操作的食材'}).selectOption('0');await marketTime(page,23000);await marketButton(page,'翻這一面');await marketTime(page,23000);}
 if(id==='shawarma'){await marketAdd(page,'餅皮');await marketTime(page,6000);for(let i=0;i<4;i++)await marketButton(page,'削一刀');await marketAdd(page,'生菜');await marketAdd(page,'番茄');for(let i=0;i<3;i++)await marketButton(page,`包一折 · ${i}/3`);}
 if(id==='egg-fried-rice'){await marketAdd(page,'白飯');await marketAdd(page,'雞蛋');await marketAdd(page,'蝦仁');for(let i=0;i<10;i++){await marketTime(page,2000);await marketButton(page,'拋鍋！');}}
 await marketButton(page,'一撮鹽 · 0');await marketPanel(page,'sauces');await page.getByRole('button',{name:'蒜味醬',exact:true}).click();const surface=page.locator('.mk-surface');await surface.scrollIntoViewIfNeeded();const b=(await surface.boundingBox())!;await page.mouse.move(b.x+b.width*.35,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.6,{steps:10});await page.mouse.up();await marketTime(page,400);const before=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(before.sauces).toHaveLength(1);if(id==='steak-dinner')await page.evaluate(key=>{const original=Storage.prototype.setItem;(window as unknown as {restoreMarketBook:()=>void}).restoreMarketBook=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('Synthetic cookbook quota','QuotaExceededError');return original.call(this,k,v);};},COOKBOOK_KEY);await page.getByRole('button',{name:'上桌，看看我的手藝！ ↗',exact:true}).click();await page.clock.resume();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15000});const completed=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(completed.status).toBe('done');if(id==='steak-dinner'){const warning=page.locator('.fullscreen-game .ck-save-warning');await expect(warning).toBeVisible();expect(await warning.evaluate(el=>!!el.closest('[data-game-stage]'))).toBe(true);await page.evaluate(()=>(window as unknown as {restoreMarketBook:()=>void}).restoreMarketBook());await warning.getByRole('button',{name:'重試保存食譜本',exact:true}).click();await expect(warning).toHaveCount(0);}await expect(page.locator('.mk-score>div>strong')).toHaveText(`${marketGrade(completed).score}分`);await expect(page.getByRole('region',{name:'料理分數',exact:true})).toHaveText(`${marketGrade(completed).score}分`);await expect(page.locator('.fw-arcade-result-heading h1')).toHaveText(recipeOf(id)!.name);await expect(page.locator('.fw-arcade-result')).not.toContainText(marketGrade(completed).title);await expect(page.locator('.mk-score svg,.mk-score dl,.mk-score blockquote')).toHaveCount(0);expect(completed.portions).toHaveLength(before.portions.length);await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();const canvas=page.locator('.ck-dish-canvas canvas'),original=await canvas.screenshot();await page.getByRole('button',{name:'放大料理',exact:true}).click();await expect(page.locator('.ck-dish-canvas')).toHaveAttribute('data-render-pending','0');expect((await canvas.screenshot()).equals(original)).toBe(false);await page.getByRole('button',{name:'回正',exact:true}).click();await expect(page.locator('.ck-dish-canvas')).toHaveAttribute('data-render-pending','0');expect((await canvas.screenshot()).equals(original)).toBe(true);await testInfo.attach(`${id}-result.png`,{body:await page.locator('.fullscreen-game').screenshot(),contentType:'image/png'});await page.getByRole('button',{name:'分享成果',exact:true}).click();await expect(page.locator('[data-game-share]')).toBeFocused();const downloading=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG',exact:true}).click();await (await downloading).saveAs(testInfo.outputPath(`${id}-share.png`));
 if(id==='steak-dinner'){await page.setViewportSize({width:390,height:844});await testInfo.attach('steak-dinner-phone.png',{body:await page.locator('.fullscreen-game').screenshot(),contentType:'image/png'});await page.setViewportSize({width:667,height:375});await testInfo.attach('steak-dinner-landscape.png',{body:await page.locator('.fullscreen-game').screenshot(),contentType:'image/png'});}
 await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();const link=await page.getByRole('textbox',{name:'同題連結',exact:true}).inputValue();expect(new URL(link).searchParams.get('practice')).toBeNull();expect(new URL(link).searchParams.get('recipe')).toBe(id);expect(posts).toBe(0);expect(errors).toEqual([]);
});

test('UX-9: WebGL loss, reload and restart confirmation preserve the exact unfinished corn dog and pause its clock',async({page})=>{
 test.setTimeout(90000);await marketOpen(page,'corn-dog');await marketAdd(page,'熱狗');await marketButton(page,'裹麵糊');await marketTime(page,8000);const gl=await page.locator('.mk-canvas canvas').evaluateHandle(c=>(c as HTMLCanvasElement).getContext('webgl2')!);await gl.evaluate(g=>g.getExtension('WEBGL_lose_context')!.loseContext());await page.clock.runFor(40);await expect(page.locator('[data-market-status="paused"]')).toBeVisible();const saved=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);await marketTime(page,10000);expect(await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.elapsed,MARKET_SAVE_KEY)).toBe(saved.elapsed);await page.getByRole('button',{name:'重試3D料理台',exact:true}).click();await expectNativeMarketReady(page,'繼續這一盤');expect(await gl.evaluate(g=>g.isContextLost())).toBe(true);await gl.dispose();await page.reload();await expectNativeMarketReady(page,'繼續這一盤');const restored=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(restored.portions).toEqual(saved.portions);await page.getByRole('button',{name:'食譜與操作提示',exact:true}).click();await page.getByRole('button',{name:'關閉操作提示',exact:true}).click();await page.getByRole('button',{name:'重新做這一道',exact:true}).click();await expect(page.getByRole('dialog',{name:'重新做這道料理'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'重新做這一道'})).toBeFocused();await page.getByRole('button',{name:'重新做這一道',exact:true}).click();await page.getByRole('button',{name:'重新開攤',exact:true}).click();const reset=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(reset.status).toBe('ready');expect(reset.portions).toEqual([]);await page.reload();await expectNativeMarketReady(page);await page.getByRole('button',{name:'開火，開始做！',exact:true}).click();await expect(page.locator('.mk-surface')).toBeFocused();
});

test('UX-9: delayed native cooking module falls back after 15 seconds and rejects its late scene before explicit retry',async({page})=>{
 // Resume real frames for the explicit native retry, then require the same
 // complete readiness contract as cold-open/context-loss recovery (15 seconds).
 test.setTimeout(60000);await page.clock.install();let take!:(r:Route)=>void;const request=new Promise<Route>(resolve=>{take=resolve;});await page.route('**/assets/market-stage-*.js',r=>take(r));await page.goto('/play?game=kitchen&recipe=corn-dog&seed=42',{waitUntil:'domcontentloaded'});const route=await request,response=await route.fetch(),url=route.request().url();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+100));await page.clock.fastForward(15000);await expect(page.locator('.mk-fallback')).toBeVisible();await expect(page.locator('.mk-canvas canvas')).toHaveCount(0);await page.getByRole('button',{name:'開火，開始做！',exact:true}).click();await page.clock.runFor(20);await marketAdd(page,'熱狗');await route.fulfill({response});await page.evaluate(async u=>{await import(u);},url);await expect(page.locator('.mk-canvas canvas')).toHaveCount(0);await page.clock.resume();await page.getByRole('button',{name:'畫面與保存狀態',exact:true}).click();await page.getByRole('button',{name:'重試3D料理台',exact:true}).click();await expectNativeMarketReady(page,'繼續這一盤');const saved=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(saved.portions).toHaveLength(1);await expect(page.getByRole('button',{name:'繼續這一盤',exact:true})).toBeVisible();
});

test('UX-1/9: lobby can cold-open both a legacy game and a free kitchen without a cooking checkpoint',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/play');await page.locator('.fw-arcade-game-card').first().getByRole('button').click();await expect(page.locator('[data-game-stage="ready"]')).toBeVisible();expect(new URL(page.url()).searchParams.get('game')).toBe('photo');await page.goto('/play');await page.getByRole('button',{name:'開始製作酥炸熱狗',exact:true}).click();await expectNativeMarketReady(page);expect(new URL(page.url()).searchParams.get('recipe')).toBe('corn-dog');expect(errors).toEqual([]);
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
 await expect(page.locator('[data-market-view="dressing"]')).toBeVisible();await expect(page.locator('.mk-surface-hint')).toContainText('起鍋了');await marketTime(page,4000);await marketPanel(page,'sauces');await page.getByRole('button',{name:'番茄醬',exact:true}).click();await surface.scrollIntoViewIfNeeded();const tray=(await surface.boundingBox())!;
 await page.mouse.move(tray.x+tray.width*.35,tray.y+tray.height*.46);await page.mouse.down();await page.mouse.move(tray.x+tray.width*.47,tray.y+tray.height*.56,{steps:12});await page.mouse.up();await marketTime(page,400);
 const dressed=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(dressed.portions.every(p=>p.lifted&&p.coated&&p.drain>=3000)).toBe(true);expect(dressed.sauces).toHaveLength(1);expect(dressed.sauces[0].points.length).toBeGreaterThan(2);await page.screenshot({path:testInfo.outputPath('corn-dog-dressing.png'),fullPage:true});
 await page.getByRole('button',{name:'上桌，看看我的手藝！ ↗',exact:true}).click();await page.clock.resume();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15000});expect(errors).toEqual([]);
});

// Real PNG encoding with only callback delivery held. Native rendering remains
// required; these tests do not replace the unchanged five-second download test.
for(const outcome of ['success','error','late'] as const)test(`UX-15d: dish preview defers for primary PNG (${outcome})`,async({page})=>{
  test.setTimeout(60000);const f=kitchenCheckpoint('result');
  await page.addInitScript(run=>{
    sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run}));
    const original=HTMLCanvasElement.prototype.toBlob;
    const held:Array<()=>void>=[];let fail=false;
    (window as unknown as {pngGate:{pending:()=>number;release:(error:boolean)=>void}}).pngGate={pending:()=>held.length,release(error){fail=error;held.splice(0).forEach(fn=>fn());}};
    HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){
      if(type==='image/png'&&this.width===960&&this.height===1200){original.call(this,blob=>held.push(()=>callback(fail?null:blob)),type,quality);return;}
      original.call(this,callback,type,quality);
    };
  },f.run);
  await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {pngGate:{pending:()=>number}}).pngGate.pending())).toBeGreaterThan(0);
  await expect(page.locator('[data-dish-view="waiting"]')).toBeVisible();
  await expect(page.locator('.ck-dish-canvas canvas')).toHaveCount(0);
  const download=page.getByRole('link',{name:'下載完整成果 PNG',exact:true});await expect(download).toHaveCount(0);
  if(outcome==='late'){
    // Only the optional view has a maximum defer. PNG stays pending, not failed.
    await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:30000});
    await expect(download).toHaveCount(0);await expect(page.getByRole('button',{name:'重試產生成果圖',exact:true})).toBeDisabled();
  }
  const old=outcome==='late'?await page.locator('.ck-dish-canvas canvas').elementHandle():null;
  await page.evaluate(error=>(window as unknown as {pngGate:{release:(error:boolean)=>void}}).pngGate.release(error),outcome==='error');
  if(outcome!=='error')await expect(download).toBeVisible();
  else {await expect(download).toHaveCount(0);await expect(page.getByRole('button',{name:'重試產生成果圖',exact:true})).toBeEnabled();}
  await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15000});
  if(old){expect(await old.evaluate(canvas=>canvas===document.querySelector('.ck-dish-canvas canvas'))).toBe(true);await old.dispose();}
});

// The unchanged UX-15c five-second real download assertion remains the primary
// responsiveness acceptance. These cases also execute the actual emitted worker.
// E2E-only instrumentation of the actual emitted worker; no product command or mocked rendering.
const dishWorkerEvidence=new WeakMap<Page,unknown[]>();
async function probeDishWorkerBoundary(page:Page){
 const records:unknown[]=[];dishWorkerEvidence.set(page,records);
 page.on('console',message=>{const text=message.text();if(!text.startsWith('dish-worker-probe ')||text.length>512||records.length>=64)return;try{records.push(JSON.parse(text.slice(18)));}catch{/* diagnostic only */}});
 await page.route('**/assets/dish-worker-*.js',async route=>{
  const response=await route.fetch();
  const probe=`;(()=>{let count=0;const emit=(phase,data,started)=>{if(count++>=64)return;const row={phase,at:performance.now()};if(started!==undefined)row.duration=performance.now()-started;if(data&&['init','view','ready','rendered','failed'].includes(data.kind))row.kind=data.kind;for(const k of ['owner','sequence'])if(Number.isSafeInteger(data?.[k]))row[k]=data[k];console.debug('dish-worker-probe '+JSON.stringify(row));};let proto=self,descriptor;while(proto&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(proto,'onmessage');proto=Object.getPrototypeOf(proto);}if(descriptor?.set){let handler=null;Object.defineProperty(self,'onmessage',{configurable:true,get:()=>handler,set(fn){handler=fn;descriptor.set.call(self,typeof fn==='function'?function(event){const start=performance.now();emit('received',event.data);try{return fn.call(this,event);}finally{emit('task-ended',event.data,start);}}:fn);}});}else emit('probe-unavailable');const post=self.postMessage.bind(self);self.postMessage=(data,...args)=>{emit('reply',data);return post(data,...args);};self.addEventListener('error',()=>emit('worker-error'));})();\n`;
  await route.fulfill({response,body:probe+await response.text()});
 });
}
test.afterEach(async({page},testInfo)=>{const records=dishWorkerEvidence.get(page);if(records)await testInfo.attach('dish-worker-boundary',{body:JSON.stringify({scope:'test-only actual worker event/task boundaries, not GPU completion',records}),contentType:'application/json'});});
function observeDishWorkers(){
 const NativeWorker=window.Worker,records:{worker:Worker;terminated:number;messages:unknown[]}[]=[];
 Object.defineProperty(window,'dishWorkers',{value:records});
 window.Worker=class extends NativeWorker{
  constructor(url:string|URL,options?:WorkerOptions){super(url,options);const record={worker:this,terminated:0,messages:[] as unknown[]};records.push(record);const send=this.postMessage.bind(this),stop=this.terminate.bind(this);this.postMessage=((message:unknown,transfer?:Transferable[])=>{record.messages.push(message);send(message,transfer??[]);}) as Worker['postMessage'];this.terminate=()=>{record.terminated++;stop();};}
 };
}
test('UX-15f native background dish rendering preserves download, controls and exact worker cleanup',async({page})=>{
 test.setTimeout(60000);const f=kitchenCheckpoint('result');
 await probeDishWorkerBoundary(page);await page.addInitScript(observeDishWorkers);
 await page.addInitScript(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);
 await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`);
 const download=page.getByRole('link',{name:'下載完整成果 PNG',exact:true});await expect(download).toBeVisible();
 // A real user action remains available while the independently owned worker prepares.
 await page.getByRole('button',{name:'複製同題挑戰連結',exact:true}).click();
 await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15000});
 await expect(page.locator('.ck-dish-canvas canvas')).toHaveCount(1);
 const posted=()=>page.evaluate(()=>(window as unknown as {dishWorkers:{messages:{kind:string;sequence?:number;angle?:number;zoom?:number}[]}[]}).dishWorkers[0].messages);
 await page.getByRole('button',{name:'放大料理',exact:true}).click();await page.getByRole('button',{name:'向右旋轉料理',exact:true}).click();await page.getByRole('button',{name:'回正',exact:true}).click();
 await expect.poll(async()=>{const messages=await posted();return messages.filter(x=>x.kind==='view').at(-1);}).toMatchObject({angle:-.12,zoom:f.recipe.id==='steak-dinner'?1.26:1.38});
 expect((await posted()).filter(x=>x.kind==='init')).toHaveLength(1);
 await page.getByRole('button',{name:'回遊樂場',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {dishWorkers:{terminated:number}[]}).dishWorkers.map(x=>x.terminated))).toEqual([1]);
 await expect(page.locator('.ck-dish-canvas canvas')).toHaveCount(0);
});

test('UX-15f unsupported background rendering keeps a truthful usable static result without a main-thread renderer',async({page})=>{
 const f=kitchenCheckpoint('result');await page.addInitScript(run=>{
  sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run}));
  Object.defineProperty(HTMLCanvasElement.prototype,'transferControlToOffscreen',{configurable:true,value:undefined});
 },f.run);
 await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`);
 await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();
 await expect(page.locator('[data-dish-view="unsupported"]')).toBeVisible();
 await expect(page.getByText('此瀏覽器不支援背景3D預覽，仍可下載與分享本局成果。',{exact:true})).toBeVisible();
 await expect(page.locator('.ck-dish-canvas canvas')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
});

test('UX-15f malformed native worker commands fail closed, preserve PNG and retry with a fresh owner',async({page})=>{
 test.setTimeout(60000);const f=kitchenCheckpoint('result');await probeDishWorkerBoundary(page);await page.addInitScript(observeDishWorkers);
 await page.addInitScript(run=>sessionStorage.setItem('freedom.cooking.run.v1',JSON.stringify({version:1,savedAt:Date.now(),run})),f.run);
 await page.goto(`/play?game=kitchen&practice=1&recipe=${f.recipe.id}&seed=42`);
 await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15000});
 const download=page.getByRole('link',{name:'下載完整成果 PNG',exact:true}),href=await download.getAttribute('href');
 await page.evaluate(()=>(window as unknown as {dishWorkers:{worker:Worker}[]}).dishWorkers[0].worker.postMessage({version:1,kind:'view',owner:-1,sequence:1,angle:0,zoom:1}));
 await expect(page.locator('[data-dish-view="fallback"]')).toBeVisible();expect(await download.getAttribute('href')).toBe(href);
 await expect(page.locator('.ck-dish-canvas canvas')).toHaveCount(0);
 await page.getByRole('button',{name:'重試3D成品',exact:true}).click();await expect(page.locator('[data-dish-view="ready"]')).toBeVisible({timeout:15000});
 await expect(page.locator('.ck-dish-canvas canvas')).toHaveCount(1);
 expect(await page.evaluate(()=>(window as unknown as {dishWorkers:{terminated:number}[]}).dishWorkers.map(x=>x.terminated))).toEqual([1,0]);
});
for (const {game,width,height} of [
  {game:'photo',width:320,height:568},
  {game:'stamp',width:667,height:375},
  {game:'cash',width:1440,height:900},
] as const) {
  test(`fullscreen fallback keeps ${game} progress at ${width}x${height}`, async ({page}) => {
    test.setTimeout(120_000);
    await installCosmeticFilters(page);
    await page.setViewportSize({width,height});
    await page.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', {configurable:true, value:false}));
    await openGame(page, game);
    const counter = page.locator('.fw-arcade-counter');
    if (game === 'photo') await page.getByRole('button',{name:'拍照快門'}).click();
    if (game === 'stamp') await page.getByRole('button',{name:'啪！蓋章'}).click();
    if (game === 'cash') await page.getByRole('button',{name:cashDeck(42)[0].valid?'收鈔→（收取道具鈔）':'←退券（退回票券）'}).click();
    const before = await counter.textContent();
    const progress = game === 'photo' ? page.locator('[data-photo-film]') : game === 'stamp' ? counter : page.locator('.fw-arcade-controls .fw-arcade-meta');
    const progressBefore = await progress.textContent();
    const canvas = page.locator('[data-game-stage] canvas');
    await expect(canvas).toHaveCount(1);
    await canvas.evaluate(el => { (el as HTMLCanvasElement & {testIdentity?:boolean}).testIdentity = true; });
    await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
    const dialog = page.getByRole('dialog',{name:'遊戲全螢幕'});
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('全視窗模式');
    await expect(page.getByRole('button',{name:'退出全螢幕'})).toBeVisible();
    expect(await dialog.evaluate(el => { const r=el.getBoundingClientRect(); return [Math.round(r.width),Math.round(r.height)]; })).toEqual([width,height]);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.locator('.fw-arcade-board').focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(counter).toHaveText(before!);
    await expect(canvas).toHaveCount(1);
    await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
    await page.getByRole('button',{name:'退出全螢幕'}).click();
    await expect(counter).toHaveText(before!);
    await expect(canvas).toHaveCount(1);
    expect(await canvas.evaluate(el => (el as HTMLCanvasElement & {testIdentity?:boolean}).testIdentity)).toBe(true);
    await expect(progress).toHaveText(progressBefore!);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });
}

test('native fullscreen enters on click and escape keeps the game mounted', async ({page}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({width:1440,height:900});
  await openGame(page,'cash');
  const counter=page.locator('.fw-arcade-counter'), before=await counter.textContent();
  await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.getByRole('button',{name:'退出全螢幕'})).toBeVisible();
  await page.locator('.fw-arcade-board').focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(counter).toHaveText(before!);
  await expect(page.locator('[data-game-stage] canvas')).toHaveCount(1);
});

for (const mode of ['native','unsupported','rejected'] as const) {
  test(`${mode} fullscreen re-entry returns to gameplay through real forward and reverse Tab`, async ({page}) => {
    if (mode !== 'native') await page.addInitScript(mode => {
      Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:mode==='rejected'});
      if (mode === 'rejected') Element.prototype.requestFullscreen=async()=>{throw new DOMException('denied','NotAllowedError');};
    },mode);
    // Do not use openGame/enterNativeFullscreen: their explicit board.focus()
    // would conceal the missing tab stop on the manual exit/re-entry path.
    await page.clock.install({time:new Date('2026-10-23T00:00:00Z')});
    await page.goto('/play?game=cash&seed=42');
    await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
    await page.clock.pauseAt(new Date('2026-10-23T00:01:00Z'));
    const board=page.locator('.fw-arcade-board'),dialog=page.getByRole('dialog',{name:'遊戲全螢幕'});
    const exit=page.getByRole('button',{name:'退出全螢幕',exact:true});
    const enter=page.getByRole('button',{name:'⛶ 全螢幕',exact:true});
    const back=page.getByRole('button',{name:'回遊樂場',exact:true});
    const progress=page.locator('.fw-arcade-controls .fw-arcade-meta'),deck=cashDeck(42);
    const canvas=page.locator('[data-game-stage] canvas');
    await canvas.evaluate(el=>{(el as HTMLCanvasElement & {testIdentity?:boolean}).testIdentity=true;});
    async function expectFullscreen() {
      await expect(dialog).toBeVisible();
      await expect(exit).toHaveAttribute('aria-disabled','false');
      await expect(exit).toHaveAttribute('aria-pressed','true');
      if (mode === 'native') {
        await expect.poll(()=>dialog.evaluate(el=>document.fullscreenElement===el)).toBe(true);
        await expect(dialog).not.toHaveClass(/fullscreen-game--viewport/);
      } else {
        await expect(dialog).toHaveClass(/fullscreen-game--viewport/);
        await expect(dialog).toContainText('全視窗模式');
        expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();
      }
    }
    async function crossViewportHelp(key:'Tab'|'Shift+Tab') {
      if(mode==='native')return;
      const help=page.locator('.fullscreen-game__mode-help summary');
      await expect(help).toBeFocused();
      await expect(help).toHaveText('全視窗說明');
      await page.keyboard.press(key);
    }
    async function classify(index:number) {
      await expect(board).toBeFocused();
      // Advance the input cooldown without rendering every intervening RAF.
      // This is a keyboard/focus regression, not an animation-frame test.
      await page.clock.fastForward(250);
      await page.keyboard.press(deck[index].valid?'ArrowRight':'ArrowLeft');
      await expect(progress).toContainText(`已分類 ${index+1} / 30 · 分錯 0 次`);
    }
    await page.getByRole('button',{name:'開始這一局',exact:true}).click();
    await expectFullscreen();
    await classify(0);
    await page.keyboard.press('Shift+Tab');
    await crossViewportHelp('Shift+Tab');
    await expect(exit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(enter).toBeFocused();
    await expect(enter).toHaveAttribute('aria-disabled','false');
    await expect(progress).toContainText('已分類 1 / 30');

    await page.keyboard.press('Enter');
    await expectFullscreen();
    await expect(exit).toBeFocused();
    // A control must not classify a card; only Tab returning to the board
    // restores game shortcuts, without a click or programmatic focus there.
    await page.clock.fastForward(250);
    await page.keyboard.press(deck[1].valid?'ArrowRight':'ArrowLeft');
    await expect(progress).toContainText('已分類 1 / 30');
    await page.keyboard.press('Tab');
    await crossViewportHelp('Tab');
    await classify(1);
    await page.keyboard.press('Tab');
    await expect(back).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await classify(2);
    // Both edges still wrap inside the fullscreen container. The renderer
    // switch now follows the cash actions, and remains a real keyboard stop.
    const renderer=page.getByRole('button',{name:'3D · 改用輕量插畫',exact:true});
    await page.keyboard.press('Shift+Tab');
    await crossViewportHelp('Shift+Tab');
    await expect(exit).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(renderer).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button',{name:'收鈔→（收取道具鈔）',exact:true})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(renderer).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(exit).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(enter).toBeFocused();
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
    await expect(progress).toContainText('已分類 3 / 30');
    await page.keyboard.press('Tab');
    await classify(3);
    await page.getByRole('button',{name:'暫停',exact:true}).click();
    await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
    await expect(board).toBeFocused();
    await expect(dialog).toHaveCount(0);
    await expect(progress).toContainText('已分類 4 / 30 · 分錯 0 次');
    await expect(canvas).toHaveCount(1);
    expect(await canvas.evaluate(el=>(el as HTMLCanvasElement & {testIdentity?:boolean}).testIdentity)).toBe(true);
  });
}

test('rejected fullscreen request falls back and restores keyboard access', async ({page}) => {
  await installCosmeticFilters(page);
  await page.addInitScript(() => {
    Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});
    Element.prototype.requestFullscreen = async () => { throw new DOMException('denied','NotAllowedError'); };
  });
  await page.goto('/play?game=photo&seed=42');
  const button=page.getByRole('button',{name:'⛶ 全螢幕'});
  await button.click();
  await expect(page.getByRole('dialog',{name:'遊戲全螢幕'})).toContainText('瀏覽器工具列可能仍會顯示');
  await page.getByRole('button',{name:'退出全螢幕'}).focus();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
});


test('leaving fullscreen before starting is respected through a zero-photo retry', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-23T00:00:00Z')});
  await page.addInitScript(() => Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false}));
  await page.goto('/play');
  await page.locator('.fw-arcade-game-card').first().getByRole('button').click();
  const dialog=page.getByRole('dialog',{name:'遊戲全螢幕'});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('全視窗模式');
  await dialog.getByRole('button',{name:'退出全螢幕'}).click();
  await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
  await page.clock.pauseAt(new Date('2026-10-23T00:01:00Z'));
  await page.getByRole('button',{name:'開始這一局',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'下一位客人 →'}).click();
  await page.getByRole('button',{name:'下一位客人 →'}).click();
  await page.getByRole('button',{name:'挑選照片'}).click();
  await expect(page.getByText('這局還沒拍到照片。再開一次照相館，按快門留下怪事。')).toBeVisible();
  await page.getByRole('button',{name:'開始這一局',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'回遊樂場',exact:true}).click();
  await expect(page.locator('.fw-arcade-game-card')).toHaveCount(3);
  await expect(page.locator('[data-arcade-open="game:photo"]')).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('fallback keeps keyboard focus inside game, result and replay', async ({page},testInfo) => {
  test.setTimeout(120_000);
  const focusObservations:unknown[]=[];let checkpoint='open-game',failed=false;
  async function observeFocus(label:string){
    checkpoint=label;
    focusObservations.push({checkpoint,...await page.evaluate(()=>{
      const share=document.querySelector('[data-daily-result-share]'),owner=document.querySelector('.fullscreen-game'),active=document.activeElement;
      const describe=(el:Element|null)=>{
        if(!el)return null;const style=getComputedStyle(el),r=el.getBoundingClientRect();
        return {tag:el.tagName,name:el.getAttribute('aria-label')??el.textContent?.trim().slice(0,100),connected:el.isConnected,
          tabIndex:el instanceof HTMLElement?el.tabIndex:null,disabled:el.matches(':disabled'),inert:!!el.closest('[inert]'),
          display:style.display,visibility:style.visibility,bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};
      };
      return {documentHasFocus:document.hasFocus(),active:describe(active),insideShare:!!share?.contains(active),insideOwner:!!owner?.contains(active),
        shareOpen:share instanceof HTMLDialogElement&&share.open,modal:!!share?.matches(':modal'),
        controls:[...share?.querySelectorAll('a[href],summary,button,input,select,textarea,[tabindex]')??[]].map(describe)};
    })});
  }
  try{
  await page.addInitScript(() => Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false}));
  await openGame(page,'photo');
  await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
  const dialog=page.getByRole('dialog',{name:'遊戲全螢幕'});
  await page.getByRole('button',{name:'拍照快門'}).click();
  await page.getByRole('button',{name:'下一位客人 →'}).click();
  await page.getByRole('button',{name:'下一位客人 →'}).click();
  await page.getByRole('button',{name:'挑選照片'}).click();
  const result=page.getByRole('region',{name:'遊戲成果'});
  await expect(result).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  // The compact result ends at More. Back belongs to its closed secondary
  // dialog and must not participate in the outer fullscreen focus loop.
  const last=result.getByRole('button',{name:'更多分享方式',exact:true});
  const share=page.getByRole('dialog',{name:'分享這局成果',exact:true});
  await expect(share).toBeHidden();
  await expect(dialog.getByRole('button',{name:'回遊樂場',exact:true})).toHaveCount(0);
  await last.focus(); await page.keyboard.press('Tab');await observeFocus('outer-forward-wrap');
  await expect(dialog.getByRole('button',{name:'退出全螢幕'})).toBeFocused();
  await page.keyboard.press('Shift+Tab');await observeFocus('outer-reverse-wrap');await expect(last).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(share).toBeVisible();
  expect(await share.evaluate(el=>el.matches(':modal'))).toBe(true);
  const close=share.getByRole('button',{name:'關閉分享',exact:true});
  const back=share.getByRole('button',{name:'回遊樂場',exact:true});
  await observeFocus('inner-initial-focus');await expect(close).toBeFocused();
  await testInfo.attach('fallback-result-share-focused.png',{body:await page.screenshot(),contentType:'image/png'});
  await back.focus();await observeFocus('before-inner-forward-wrap');
  await page.keyboard.press('Tab');await observeFocus('after-inner-forward-wrap');await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');await observeFocus('after-inner-reverse-wrap');await expect(back).toBeFocused();
  await page.keyboard.press('Escape');
  await observeFocus('inner-escape-return');
  await expect(share).toBeHidden(); await expect(last).toBeFocused();
  await testInfo.attach('fallback-result-share-returned.png',{body:await page.screenshot(),contentType:'image/png'});
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');await observeFocus('outer-escape');
  await expect(dialog).toHaveCount(0);
  await expect(result).toBeVisible();
  await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
  await page.getByRole('button',{name:'同一題再來一次'}).click();
  await observeFocus('replay-focus');
  await expect(page.locator('.fw-arcade-board')).toBeFocused();
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  checkpoint='complete';
  }catch(error){failed=true;throw error;}finally{
    let observationError:string|undefined;
    try{await observeFocus(`${checkpoint}:finally`);}catch(error){observationError=String(error);}
    try{await testInfo.attach('fallback-result-focus.json',{body:JSON.stringify({checkpoint,focusObservations,observationError}),contentType:'application/json'});}
    catch(error){if(!failed)throw error;}
  }
});


for (const outcome of ['resolve','reject'] as const) {
  test(`delayed fullscreen ${outcome} preserves a started game's keyboard focus`, async ({page}) => {
    test.setTimeout(120_000);
    await page.addInitScript((outcome) => {
      let current:Element|null=null;
      Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});
      Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>current});
      Element.prototype.requestFullscreen=function(){
        const target=this;
        return new Promise<void>((resolve,reject)=>{
          (window as unknown as {releaseFullscreen:()=>void}).releaseFullscreen=()=>{
            if(outcome==='reject'){reject(new DOMException('denied','NotAllowedError'));return;}
            current=target;document.dispatchEvent(new Event('fullscreenchange'));resolve();
          };
        });
      };
    },outcome);
    await page.goto('/play');
    await page.locator('.fw-arcade-game-card').nth(2).getByRole('button').click();
    await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
    await page.getByRole('button',{name:'開始這一局',exact:true}).click();
    await expect(page.locator('.fw-arcade-board')).toBeFocused();
    await page.evaluate(() => (window as unknown as {releaseFullscreen:()=>void}).releaseFullscreen());
    await expect(page.getByRole('dialog',{name:'遊戲全螢幕'})).toBeVisible();
    await expect(page.locator('.fw-arcade-board')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    // Either a correct or wrong classification changes the notice.
    await expect(page.locator('.fw-arcade-notice')).not.toHaveText('道具鈔往右滑，怪票券往左滑。左右方向鍵也可以。');
  });
}


for (const outcome of ['resolve','reject'] as const) {
  test(`fullscreen ${outcome} after leaving the game cannot cover the lobby`, async ({page}) => {
    await installCosmeticFilters(page);
    await page.addInitScript((outcome) => {
      let current:Element|null=null;
      Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});
      Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>current});
      document.exitFullscreen=async()=>{current=null;document.dispatchEvent(new Event('fullscreenchange'));};
      Element.prototype.requestFullscreen=function(){
        const target=this;
        return new Promise<void>((resolve,reject)=>{
          (window as unknown as {releaseFullscreen:()=>void}).releaseFullscreen=()=>{
            if(outcome==='reject'){reject(new DOMException('denied','NotAllowedError'));return;}
            current=target;document.dispatchEvent(new Event('fullscreenchange'));resolve();
          };
        });
      };
    },outcome);
    await page.goto('/play');
    await page.locator('.fw-arcade-game-card').nth(2).getByRole('button').click();
    await expect(page.getByRole('button',{name:'⛶ 全螢幕'})).toHaveAttribute('aria-disabled','true');
    await page.getByRole('button',{name:'回遊樂場',exact:true}).click();
    await expect(page.locator('.fw-arcade-game-card')).toHaveCount(3);
    await page.evaluate(()=>(window as unknown as {releaseFullscreen:()=>void}).releaseFullscreen());
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
    await expect(page.getByRole('dialog',{name:'遊戲全螢幕'})).toHaveCount(0);
    await expect(page.locator('[data-arcade-open="game:cash"]')).toBeFocused();
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
    await expect(page.locator('.fw-arcade-game-card').first()).toBeVisible();
  });
}


for (const id of ['egg-fried-rice','steak-dinner','shawarma','corn-dog'] as MarketId[]) {
  test(`UX-16: ${id} viewport controls keep the cooking surface usable without sharing an unfinished run`,async({page},testInfo)=>{
    await page.addInitScript(()=>Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false}));
    await marketOpen(page,id);
    await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();
    const game=page.getByRole('dialog',{name:'遊戲全螢幕',exact:true});
    await expect(game).toHaveClass(/fullscreen-game--viewport/);
    await expect(game.getByRole('button',{name:'完成後分享',exact:true})).toBeDisabled();
    await expect(game.locator('[data-game-share]')).toHaveCount(0);
    await game.locator('.fullscreen-game__mode-help summary').click();
    await expect(game.locator('.fullscreen-game__mode-help p')).toContainText('瀏覽器工具列可能仍會顯示');
    await game.locator('.fullscreen-game__mode-help summary').click();
    expect(await game.locator('.fullscreen-game__bar').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(72);
    const canvas=await game.locator('.mk-canvas canvas').elementHandle();
    const surface=game.locator('.mk-surface');
    expect(await surface.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(120);
    expect(await surface.evaluate(el=>{const b=el.getBoundingClientRect();return Math.abs(b.width/b.height-6/5);})).toBeLessThan(.01);
    for(const button of await game.locator('.fullscreen-game__bar button').all()){
      const metrics=await button.evaluate(el=>({height:el.getBoundingClientRect().height,font:parseFloat(getComputedStyle(el).fontSize)}));
      expect(metrics.height).toBeGreaterThanOrEqual(44);expect(metrics.font).toBeGreaterThanOrEqual(14);
    }
    const tray=game.getByRole('complementary',{name:'食材與工具',exact:true});
    expect(await tray.evaluate(el=>!!el.closest('[data-game-stage]')&&getComputedStyle(el).overflowY==='hidden')).toBe(true);
    await marketAdd(page,({'egg-fried-rice':'白飯','steak-dinner':'牛排',shawarma:'餅皮','corn-dog':'熱狗'} as const)[id]);
    for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375},{width:1280,height:800}]){await page.setViewportSize(viewport);await marketSceneBounds(page);await marketPanel(page,'tools');await testInfo.attach(`market-native-${id}-${viewport.width}x${viewport.height}-tools.png`,{body:await game.screenshot(),contentType:'image/png'});if(viewport.width===390||viewport.width===667){await marketInsets(page,true);await marketSceneBounds(page);await marketButton(page,'小');expect(await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.heat,MARKET_SAVE_KEY)).toBe(1);await marketButton(page,'中');await testInfo.attach(`market-native-${id}-${viewport.width}x${viewport.height}-insets.png`,{body:await game.screenshot(),contentType:'image/png'});await marketInsets(page,false);}}
    await game.getByRole('button',{name:'食譜與操作提示',exact:true}).click();
    await expect(game.getByRole('dialog',{name:'食譜與操作提示',exact:true})).toBeVisible();
    await testInfo.attach(`market-native-${id}-help.png`,{body:await game.screenshot(),contentType:'image/png'});
    await page.keyboard.press('Escape');
    await testInfo.attach(`market-native-${id}-paused.png`,{body:await game.screenshot(),contentType:'image/png'});
    await expect(game.getByRole('button',{name:'食譜與操作提示',exact:true})).toBeFocused();
    await expect(game.getByRole('button',{name:'重新做這一道',exact:true})).toBeVisible();
    await game.getByRole('button',{name:'繼續這一盤',exact:true}).click();await expect(surface).toBeFocused();
    await game.getByRole('button',{name:'退出全螢幕',exact:true}).click();
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
    expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);
    await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();
    await expect(game.getByRole('button',{name:'完成後分享',exact:true})).toBeDisabled();
    expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);
    await page.setViewportSize({width:667,height:375});
    expect(await game.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await game.getByRole('button',{name:'退出全螢幕',exact:true}).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog',{name:'遊戲全螢幕',exact:true})).toHaveCount(0);
    expect(await canvas!.evaluate(el=>el.isConnected)).toBe(true);
    await canvas!.dispose();
  });
}
for(const width of [320,1440])test(`community game draft is explicit, bounded and retained without uploads (${width}px)`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const external:string[]=[];page.on('request',request=>{if(new URL(request.url()).hostname==='github.com')external.push(request.url());});
 await page.goto('/play');
 const section=page.getByRole('region',{name:'社群遊戲投稿'}),toggle=section.locator('summary');
 await toggle.focus();await toggle.press('Enter');
 await expect(section.getByText('這個 GitHub 選項不會上傳檔案到站內',{exact:false})).toBeVisible();
 await section.getByLabel('遊戲名稱（最多 60 字元）').fill('合成測試遊戲');
 await section.getByLabel('玩法介紹（最多 200 字元）').fill('<img src=x onerror=alert(1)>');
 await section.getByLabel('操作與啟動方式（最多 200 字元）').fill('方向鍵，瀏覽器開啟 index.html');
 await section.getByLabel('作者與素材授權（最多 160 字元）').fill('合成作者；MIT；原創素材');
 await section.getByLabel('GitHub 原始碼網址',{exact:true}).fill('https://github.com/example/game');
 await section.getByLabel('完整 commit SHA',{exact:true}).fill('main');
 await section.getByRole('button',{name:'準備投稿預覽'}).click();await expect(section.getByRole('alert')).toContainText('40 字元');
 await section.getByLabel('完整 commit SHA',{exact:true}).fill('a'.repeat(40));
 await section.getByRole('button',{name:'準備投稿預覽'}).click();
 await expect(section.getByRole('status')).toContainText('尚未送出');await expect(section.getByRole('link',{name:'到 GitHub 預覽投稿 ↗'})).toHaveCount(0);
 await section.getByRole('checkbox').check();const link=section.getByRole('link',{name:'到 GitHub 預覽投稿 ↗'});
 const url=new URL((await link.getAttribute('href'))!);expect(url.origin).toBe('https://github.com');expect(url.searchParams.get('body')).toContain('    <img src=x onerror=alert(1)>');
 await expect(link).toHaveAttribute('rel','noopener noreferrer');await expect(link).toHaveAttribute('referrerpolicy','no-referrer');
 await toggle.click();await toggle.click();await expect(link).toBeVisible();
 await section.getByLabel('提供原始碼的方式').selectOption('attachment');await expect(link).toHaveCount(0);await expect(section.getByRole('checkbox')).toHaveCount(0);
 await section.getByRole('button',{name:'準備投稿預覽'}).click();await expect(section.getByLabel('將傳給 GitHub 的投稿內容')).not.toHaveValue(/example\/game/);
 await expect(section.getByLabel('將傳給 GitHub 的投稿內容')).toHaveValue(/尚未附檔/);
 await page.locator('[data-arcade-open="game:photo"]').click();await expect(section).toBeHidden();
 await page.goBack();await expect(section).toBeVisible();await expect(section.getByLabel('遊戲名稱（最多 60 字元）')).toHaveValue('合成測試遊戲');
 for(const theme of ['light','dark','versefolk']){
  await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 }
 expect(external).toEqual([]);await expect(section.locator('iframe,input[type=file]')).toHaveCount(0);
 // Deliberately do not click the external link or submit a real Issue.
 await page.reload();await section.locator('summary').click();await expect(section.getByLabel('遊戲名稱（最多 60 字元）')).toHaveValue('');
});

// Synthetic owner API responses exercise the real page/client, not deployed quarantine storage.
for(const width of [320,1440])test(`member game upload keeps exact retry, keyboard and cold-read boundaries (${width}px)`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const id='10000000-0000-4000-8000-000000000001',source=Buffer.from('\ufeff<!doctype html>\r\n<script>globalThis.uploadedGameRan=true</script>');
 let current={game_id:id,title:'會員合成遊戲',description:'測試來源',version:'1',state:'draft',source_revision:'0',trust:'unreviewed',visibility:'private',upload_available:true};
 const ack=()=>{const {upload_available,...value}=current;return value;};
 let sessions=0,creates=0;const uploads:{body:Buffer;key:string;version:string;mime:string}[]=[],requests:string[]=[];
 await page.route('**/api/v1/session',route=>{sessions++;return route.fulfill({json:{user:{user_id:'30000000-0000-4000-8000-000000000001'},csrf_token:'synthetic-upload-session'}});});
 await page.route('**/api/v1/me/game-drafts**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;requests.push(request.method()+' '+path);
  if(path.endsWith('/source')){
   uploads.push({body:request.postDataBuffer()!,key:request.headers()['idempotency-key'],version:request.headers()['if-match'],mime:request.headers()['content-type']});
   expect(request.headers()['x-csrf-token']).toBe('synthetic-upload-session');
   if(uploads.length===1){current={...current,version:'2',source_revision:'1',state:'quarantined'};return route.abort('failed');}
   const historical=ack();current={...current,version:'3',state:'withdrawn',upload_available:false};return route.fulfill({json:historical});
  }
  if(request.method()==='POST'){creates++;return route.fulfill({status:201,json:ack()});}
  return route.fulfill({json:current});
 });
 await page.goto('/play');expect(sessions).toBe(0);
 const area=page.getByRole('region',{name:'會員私有遊戲來源'}),summary=area.locator('summary');await summary.focus();await summary.press('Enter');
 const open=area.getByRole('button',{name:'使用目前會員帳號開啟'});await open.focus();await open.press('Enter');
 await area.getByLabel('私人遊戲名稱',{exact:true}).fill('會員合成遊戲');await area.getByLabel('私人玩法介紹').fill('測試來源');
 await area.getByRole('button',{name:'建立私人草稿（不含檔案）'}).click();await expect(area.getByLabel('請保留這個草稿編號')).toHaveValue(id);expect(creates).toBe(1);
 const input=area.getByLabel('選擇單一 HTML 遊戲檔案');await input.setInputFiles({name:'index.html',mimeType:'text/html',buffer:source});
 await expect(area.getByText('檔案僅留在本頁記憶體，尚未傳送。',{exact:true})).toBeVisible();expect(uploads).toHaveLength(0);
 await expect(area.getByRole('button',{name:'傳送檔案到私有保存'})).toBeDisabled();
 const consent=area.getByRole('checkbox');await consent.focus();await consent.press('Space');
 const send=area.getByRole('button',{name:'傳送檔案到私有保存'});await send.focus();await send.press('Enter');
 await expect(area.getByRole('button',{name:'重試原操作（不建立新操作）'})).toBeVisible();
 await expect(area.getByRole('button',{name:'建立私人草稿（不含檔案）'})).toBeDisabled();await expect(area.getByRole('button',{name:'重新讀取目前狀態'})).toBeDisabled();
 await area.getByRole('button',{name:'重試原操作（不建立新操作）'}).click();await expect(area.getByText('狀態：已撤回；版本 3，來源版本 1。',{exact:true})).toBeVisible();
 expect(uploads).toHaveLength(2);expect(uploads[0]).toEqual(uploads[1]);expect(uploads[0].body).toEqual(source);expect(uploads[0].mime).toBe('text/html');expect(uploads[0].version).toBe('"1"');
 expect(requests.filter(r=>r.startsWith('GET')&&r.endsWith('/source'))).toEqual([]);expect(await page.evaluate(()=>(window as any).uploadedGameRan)).toBeUndefined();
 expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('uploadedGameRan');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await page.reload();await summary.click();await area.getByRole('button',{name:'使用目前會員帳號開啟'}).click();await expect(area.getByLabel('請保留這個草稿編號')).toHaveCount(0);
 await area.getByLabel('已有草稿編號').fill(id);await area.getByRole('button',{name:'讀取這份私人草稿'}).click();await expect(area.getByText('狀態：已撤回；版本 3，來源版本 1。',{exact:true})).toBeVisible();expect(creates).toBe(1);
});
test('member game upload shows policy unavailable and confirms withdrawal without any source transfer',async({page})=>{
 const id='10000000-0000-4000-8000-000000000001';let writes=0,current={game_id:id,title:'關閉測試',description:'',version:'1',state:'draft',source_revision:'0',trust:'unreviewed',visibility:'private',upload_available:false};
 await page.route('**/api/v1/session',route=>route.fulfill({json:{user:{user_id:'30000000-0000-4000-8000-000000000001'},csrf_token:'synthetic'}}));
 await page.route('**/api/v1/me/game-drafts**',route=>{const request=route.request();if(request.method()==='POST'){writes++;expect(request.url()).toContain('/withdraw');expect(request.postDataJSON()).toEqual({});expect(request.headers()['if-match']).toBe('"1"');current={...current,state:'withdrawn',version:'2'};const {upload_available,...ack}=current;return route.fulfill({json:ack});}return route.fulfill({json:current});});
 await page.goto('/play');const area=page.getByRole('region',{name:'會員私有遊戲來源'});await area.locator('summary').click();await area.getByRole('button',{name:'使用目前會員帳號開啟'}).click();
 await area.getByLabel('已有草稿編號').fill(id);await area.getByRole('button',{name:'讀取這份私人草稿'}).click();await expect(area.getByLabel('選擇單一 HTML 遊戲檔案')).toBeDisabled();await expect(area.getByRole('button',{name:'傳送檔案到私有保存'})).toBeDisabled();await expect(area.getByText('來源保存尚未開放或暫時無法使用，目前不能上傳。',{exact:true})).toBeVisible();
 await area.getByRole('button',{name:'撤回這份私人草稿',exact:true}).click();await expect(area.getByText('撤回後不能再上傳，這個階段不能恢復。來源歷史與已用容量會保留，不是刪除檔案。',{exact:true})).toBeVisible();await area.getByRole('button',{name:'取消撤回'}).click();await expect(area.getByRole('button',{name:'撤回這份私人草稿',exact:true})).toBeFocused();expect(writes).toBe(0);
 await area.getByRole('button',{name:'撤回這份私人草稿',exact:true}).click();await area.getByRole('button',{name:'確認撤回',exact:true}).click();await expect(area.getByText('狀態：已撤回；版本 2，來源版本 0。',{exact:true})).toBeVisible();expect(writes).toBe(1);
});
test('member game upload clears selected source on account change and does not adopt replacement session',async({page})=>{
 let token='first-session',sessionUnavailable=false;const id='10000000-0000-4000-8000-000000000001';let writes=0;
 await page.route('**/api/v1/session',route=>sessionUnavailable?route.fulfill({status:503,json:{type:'unavailable',title:'Unavailable',status:503}}):route.fulfill({json:{user:{user_id:token==='first-session'?'30000000-0000-4000-8000-000000000001':'40000000-0000-4000-8000-000000000001'},csrf_token:token}}));
 await page.route('**/api/v1/me/game-drafts**',route=>{if(route.request().method()!=='GET')writes++;return route.fulfill({json:{game_id:id,title:'清除測試',description:'',version:'1',state:'draft',source_revision:'0',trust:'unreviewed',visibility:'private',upload_available:true}});});
 await page.goto('/play');const area=page.getByRole('region',{name:'會員私有遊戲來源'});await area.locator('summary').click();await area.getByRole('button',{name:'使用目前會員帳號開啟'}).click();await area.getByLabel('已有草稿編號').fill(id);await area.getByRole('button',{name:'讀取這份私人草稿'}).click();await area.getByLabel('選擇單一 HTML 遊戲檔案').setInputFiles({name:'index.html',mimeType:'text/html',buffer:Buffer.from('<html>private-synthetic</html>')});await expect(area.getByRole('checkbox')).toBeVisible();
 sessionUnavailable=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(area.getByRole('button',{name:'重新確認會員登入'})).toBeVisible();await expect(area.getByLabel('請保留這個草稿編號')).toBeHidden();await expect(area.getByRole('checkbox')).toBeHidden();sessionUnavailable=false;await area.getByRole('button',{name:'重新確認會員登入'}).click();await expect(area.getByRole('checkbox')).toBeVisible();expect(writes).toBe(0);
 token='replacement-session';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(area.getByRole('button',{name:'使用目前會員帳號開啟'})).toBeVisible();await expect(area.getByRole('checkbox')).toHaveCount(0);await expect(area.getByLabel('請保留這個草稿編號')).toHaveCount(0);expect(writes).toBe(0);
 await area.getByRole('button',{name:'使用目前會員帳號開啟'}).click();await expect(area.getByLabel('已有草稿編號')).toHaveValue('');await expect(area.getByLabel('請保留這個草稿編號')).toHaveCount(0);
});

for(const mode of ['native','rejected','unsupported'] as const)for(const family of ['guided','market','party'] as const){
  test(`fullscreen start: cold ${family} uses the real first gesture in ${mode} mode and respects exit through resume/restart`,async({page})=>{
    await page.setViewportSize({width:390,height:844});await page.clock.install();
    await page.addInitScript(mode=>{
      const request=Element.prototype.requestFullscreen;
      (window as any).__startFullscreenRequests=0;
      if(mode==='unsupported')Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false});
      Element.prototype.requestFullscreen=function(){
        (window as any).__startFullscreenRequests++;
        if(mode==='rejected')return Promise.reject(new DOMException('Synthetic fullscreen rejection','NotAllowedError'));
        return request.call(this);
      };
    },mode);
    // Exercise actual supported renderer fallbacks without requiring a GPU.
    await blockPartyWebGL(page);
    const url=family==='party'?'/play?game=holiday&seed=42':`/play?game=kitchen&recipe=${family==='guided'?'rice-balls&practice=1':'corn-dog'}&seed=42`;
    await page.goto(url);
    const root=page.locator(family==='party'?'.pt-root':family==='guided'?'.ck-game':'.mk-game'),attribute=family==='party'?'data-party-state':family==='guided'?'data-cooking-state':'data-market-status';
    if(family==='party'){await expect(page.getByRole('alert')).toContainText('無法開啟 3D 場景');await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();}
    else await expect(page.locator(family==='guided'?'.ck-visual-light':'.mk-fallback')).toBeVisible();
    const start=family==='party'?'開始派對！':family==='guided'?'開始料理':'開火，開始做！',resume=family==='party'?'繼續這一局':family==='guided'?'繼續料理':'繼續這一盤';
    await expect(root.getByRole('button',{name:start,exact:true})).toBeEnabled();
    await expect(root).toHaveAttribute(attribute,'ready');
    expect(await page.evaluate(()=>(window as any).__startFullscreenRequests)).toBe(0);
    await expect(page.getByRole('button',{name:'⛶ 全螢幕',exact:true})).toBeVisible();
    await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));
    await root.getByRole('button',{name:start,exact:true}).click();
    const presentation=page.locator('.fullscreen-game'),exit=page.getByRole('button',{name:'退出全螢幕',exact:true});
    await expect(exit).toBeVisible();await expect(exit).toHaveAttribute('aria-disabled','false');
    if(mode==='native')await expect.poll(()=>presentation.evaluate(el=>document.fullscreenElement===el)).toBe(true);
    else {await expect(presentation).toHaveClass(/fullscreen-game--viewport/);expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();}
    await page.clock.runFor(300);await expect(root).toHaveAttribute(attribute,'playing');
    await root.getByRole('button',{name:/^暫停/,exact:false}).click();await expect(root).toHaveAttribute(attribute,'paused');
    const snapshot=await page.evaluate(family=>family==='party'?document.querySelector('.pt-canvas')?.getAttribute('data-elapsed'):sessionStorage.getItem(family==='guided'?'freedom.cooking.run.v1':'freedom.cooking.market.v1'),family);
    expect(snapshot).toBeTruthy();if(family==='party')expect(Number.isFinite(Number(snapshot))).toBe(true);
    await exit.click();await expect(page.getByRole('button',{name:'⛶ 全螢幕',exact:true})).toBeVisible();
    await page.clock.runFor(1000);
    expect(await page.evaluate(family=>family==='party'?document.querySelector('.pt-canvas')?.getAttribute('data-elapsed'):sessionStorage.getItem(family==='guided'?'freedom.cooking.run.v1':'freedom.cooking.market.v1'),family)).toBe(snapshot);
    await root.getByRole('button',{name:resume,exact:true}).click();await expect(root).toHaveAttribute(attribute,'playing');
    await expect(page.getByRole('button',{name:'⛶ 全螢幕',exact:true})).toBeVisible();
    await root.getByRole('button',{name:family==='party'?'重新開始':family==='guided'?'重新做':'重新做這一道',exact:true}).click();
    await page.getByRole('button',{name:family==='party'?'確定重來':family==='guided'?'確定重新做':'重新開攤',exact:true}).click();
    await expect(root).toHaveAttribute(attribute,'ready');await root.getByRole('button',{name:start,exact:true}).click();await expect(root).toHaveAttribute(attribute,'playing');
    await expect(page.getByRole('button',{name:'⛶ 全螢幕',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();
    expect(await page.evaluate(()=>(window as any).__startFullscreenRequests)).toBe(mode==='unsupported'?0:1);
  });
}

// Market-family integration acceptance is separate from native art acceptance.
// These cases deliberately exercise the supported SVG fallback; UX-9/UX-16 above
// continue to exercise the production WebGL renderer and its original budgets.
for(const id of ['egg-fried-rice','steak-dinner','shawarma','corn-dog'] as MarketId[])test(`MK-1: ${id} bounded scene, enlarged text, palettes and modal isolation`,async({page},testInfo)=>{
 await page.addInitScript(()=>Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false}));
 await blockPartyWebGL(page);await page.clock.install();await page.setViewportSize({width:320,height:568});
 await page.goto(`/play?game=kitchen&recipe=${id}&seed=42`);
 await expect(page.locator('.mk-fallback svg.mk-illustration')).toBeVisible();
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));
 await page.getByRole('button',{name:'開火，開始做！',exact:true}).click();
 const root=page.locator('.fullscreen-game'),game=page.locator('.mk-game'),surface=page.locator('.mk-surface'),tray=page.locator('.mk-tray');
 await expect(root).toHaveClass(/fullscreen-game--market/);await expect(root).toHaveClass(/fullscreen-game--viewport/);
 await expect(game).toHaveAttribute('data-market-status','playing');await expect(surface).toBeFocused();
 await marketAdd(page,({'egg-fried-rice':'白飯','steak-dinner':'牛排',shawarma:'餅皮','corn-dog':'熱狗'} as const)[id]);
 await marketTime(page,6000);
 const primary=({'egg-fried-rice':'拋鍋！','steak-dinner':'翻這一面',shawarma:'削一刀','corn-dog':'翻這一面'} as const)[id];
 await marketButton(page,primary);const progress=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);
 expect(id==='egg-fried-rice'?progress.tosses:id==='shawarma'?progress.shaves:progress.portions[0].flips).toBe(1);
 await marketTime(page,400);await page.locator('.mk-illustration [data-market-portion="0"]').click();
 const touched=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(id==='egg-fried-rice'?touched.stirs-progress.stirs:id==='shawarma'?touched.shaves-progress.shaves:touched.portions[0].flips-progress.portions[0].flips).toBe(1);
 for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375},{width:1280,height:800}]){
  await page.setViewportSize(viewport);
  await expect.poll(()=>surface.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(44);
  await marketSceneBounds(page);
  await marketPanel(page,'ingredients');await expect(tray.locator('.mk-ingredients')).toBeVisible();
  await marketPanel(page,'sauces');await page.getByRole('button',{name:'蒜味醬',exact:true}).click();
  await testInfo.attach(`market-${id}-${viewport.width}x${viewport.height}.png`,{body:await root.screenshot(),contentType:'image/png'});
  if(viewport.width===390||viewport.width===667){
   await marketInsets(page,true);await marketSceneBounds(page);await marketButton(page,'小');expect(await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.heat,MARKET_SAVE_KEY)).toBe(1);await marketButton(page,'中');
   await game.getByRole('button',{name:'食譜與操作提示',exact:true}).click();const insetDialog=game.getByRole('dialog',{name:'食譜與操作提示',exact:true});
   expect(await insetDialog.evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=40&&b.top>=28&&b.right<=innerWidth-24&&b.bottom<=innerHeight-32;})).toBe(true);
   await expect(insetDialog.getByRole('button',{name:'關閉操作提示',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(game.getByRole('button',{name:'食譜與操作提示',exact:true})).toBeFocused();
   await testInfo.attach(`market-${id}-${viewport.width}x${viewport.height}-insets-paused.png`,{body:await root.screenshot(),contentType:'image/png'});
   await game.getByRole('button',{name:'繼續這一盤',exact:true}).click();await expect(surface).toBeFocused();await marketSceneBounds(page);await marketInsets(page,false);
  }
 }
 // 195x422 is the CSS-layout size of a 390x844 viewport at 200% page zoom.
 // This is a reflow proxy, not a claim that browser zoom was automated.
 await page.setViewportSize({width:195,height:422});await marketSceneBounds(page);
 await testInfo.attach(`market-${id}-zoom-reflow.png`,{body:await root.screenshot(),contentType:'image/png'});
 await root.getByRole('button',{name:'退出全螢幕',exact:true}).click();await marketSceneBounds(page,false);
 await page.setViewportSize({width:667,height:375});await marketInsets(page,true);await marketSceneBounds(page,false);await marketInsets(page,false);
 await root.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();
 await page.setViewportSize({width:320,height:568});
 await root.evaluate(el=>{const styles=[el,...el.querySelectorAll('*')].filter(n=>n instanceof HTMLElement).map(n=>({n:n as HTMLElement,font:parseFloat(getComputedStyle(n).fontSize),line:parseFloat(getComputedStyle(n).lineHeight)}));for(const {n,font,line} of styles){n.style.fontSize=`${font*2}px`;if(Number.isFinite(line))n.style.lineHeight=`${line*2}px`;}});
 await expect(root.getByRole('button',{name:'退出全螢幕',exact:true})).toHaveCSS('font-size','28px');
 await expect.poll(()=>surface.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(44);
 await marketPanel(page,'tools');await marketButton(page,primary);await marketSceneBounds(page);
 await testInfo.attach(`market-${id}-200-percent-tools.png`,{body:await root.screenshot(),contentType:'image/png'});
 await page.getByRole('button',{name:'暫停',exact:true}).click();
 const paused=await page.evaluate(k=>sessionStorage.getItem(k),MARKET_SAVE_KEY);await marketTime(page,5000);expect(await page.evaluate(k=>sessionStorage.getItem(k),MARKET_SAVE_KEY)).toBe(paused);
 await expect(game.locator('.mk-play-space')).toHaveAttribute('inert','');
 const help=game.getByRole('button',{name:'食譜與操作提示',exact:true});await help.focus();await page.keyboard.press('Space');
 const dialog=game.getByRole('dialog',{name:'食譜與操作提示',exact:true});await expect(dialog).toBeVisible();
 const close=dialog.getByRole('button',{name:'關閉操作提示',exact:true});await expect(close).toBeFocused();await page.keyboard.press('Tab');await expect(close).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(close).toBeFocused();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(help).toBeFocused();await expect(root).toHaveClass(/fullscreen-game--viewport/);
 await help.press('Enter');await close.click();await expect(help).toBeFocused();
 await testInfo.attach(`market-${id}-200-percent-paused.png`,{body:await root.screenshot(),contentType:'image/png'});
 await game.getByRole('button',{name:'繼續這一盤',exact:true}).click();await expect(game).toHaveAttribute('data-market-status','playing');await expect(surface).toBeFocused();
 await root.getByRole('button',{name:'退出全螢幕',exact:true}).click();await expect(root).not.toHaveClass(/fullscreen-game--viewport/);
 await page.setViewportSize({width:667,height:375});
 // Insets were cleared above. This combines 200% text with landscape, not a nonzero-inset stress.
 await test.step('200% landscape: normal-stage controls remain fully inside their rows',async()=>{
  await marketSceneBounds(page,false);
  await marketButton(page,'關');expect(await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.heat,MARKET_SAVE_KEY)).toBe(0);
  await marketButton(page,'中');expect(await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.heat,MARKET_SAVE_KEY)).toBe(2);
  await testInfo.attach(`market-${id}-200-percent-landscape-normal.png`,{body:await root.screenshot(),contentType:'image/png'});
 });
 await root.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();
 await test.step('200% landscape: presentation controls remain fully inside their rows',async()=>{
  await marketSceneBounds(page);
  await marketButton(page,'關');expect(await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.heat,MARKET_SAVE_KEY)).toBe(0);
  await marketButton(page,'中');expect(await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run.heat,MARKET_SAVE_KEY)).toBe(2);
  await testInfo.attach(`market-${id}-200-percent-landscape.png`,{body:await root.screenshot(),contentType:'image/png'});
 });
 await expect.poll(()=>surface.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(44);
 await root.getByRole('button',{name:'退出全螢幕',exact:true}).focus();await page.keyboard.press('Escape');
 await expect(root).not.toHaveClass(/fullscreen-game--viewport/);await expect(game).toHaveAttribute('data-market-status','playing');
 await game.getByRole('button',{name:'重新做這一道',exact:true}).click();const restart=game.getByRole('dialog',{name:'重新做這道料理',exact:true});
 await expect(restart.getByRole('button',{name:'保留這一盤',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(game.getByRole('button',{name:'重新做這一道',exact:true})).toBeFocused();
 const kept=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)!).run as MarketRun,MARKET_SAVE_KEY);expect(kept.portions.length).toBeGreaterThan(0);expect(kept.status).toBe('paused');
 await game.getByRole('button',{name:'重新做這一道',exact:true}).click();await restart.getByRole('button',{name:'重新開攤',exact:true}).click();await expect(game).toHaveAttribute('data-market-status','ready');
 await game.getByRole('button',{name:'開火，開始做！',exact:true}).click();await expect(surface).toBeFocused();await expect(game).toHaveAttribute('data-market-status','playing');
});

// Daily scene integration: authored browser journeys, not evidence of a browser run.
// Real input/domain transitions only. No injected scores, saved completed runs or forced clicks.
async function openDailyScene(page:Page,game:'photo'|'stamp'|'cash',light:boolean){
  await openGame(page,game);
  await expect(page.locator('.fw-arcade-stage')).toHaveAttribute('data-daily-renderer','native');
  if(light){
    await page.getByRole('button',{name:'3D · 改用輕量插畫',exact:true}).click();
    await expect(page.locator('.fw-arcade-stage')).toHaveAttribute('data-daily-renderer','light');
    await expect(page.locator('[data-game-stage="ready"]')).toBeVisible();
    await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
  }
  await expect(page.locator('.fw-arcade-board')).toBeFocused();
}
async function dailyWorldPoint(page:Page,game:'stamp'|'cash',world:number[]){
  const host=page.locator('.fw-arcade-stage');await host.scrollIntoViewIfNeeded();
  const box=(await host.boundingBox())!;
  const aspect=box.width/box.height;
  // Full-height STAMP keeps the original pose and paper, but fits its
  // portrait FOV; independently construct the actual projection for clicks.
  const stampFov=2*Math.atan(Math.tan(20*Math.PI/180)*(aspect<1?Math.max(1.7,.90/aspect):1))*180/Math.PI;
  const cashFov=2*Math.atan(Math.tan(21*Math.PI/180)*(aspect<1?Math.max(2.2,.95/aspect):1))*180/Math.PI;
  const camera=new PerspectiveCamera(game==='stamp'?stampFov:cashFov,aspect,.1,60);
  camera.position.set(0,5.3,2.7);camera.lookAt(0,0,.23);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const p=new Vector3(...world).project(camera),point={x:box.x+(p.x+1)*box.width/2,y:box.y+(1-p.y)*box.height/2};
  // Check the exact contact pixel, not just visibility of a broad parent box.
  expect(await host.evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return !!hit&&el.contains(hit);},point)).toBe(true);
  return point;
}
async function dailyStampPoint(page:Page,index:number){
  const t=stampTarget(42,index);return dailyWorldPoint(page,'stamp',[t.x*1.2,.086,t.y*1.5]);
}
async function dailySortDrag(page:Page,right:boolean,distance=72){
  const p=await dailyWorldPoint(page,'cash',[0,.33,0]);
  await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+(right?distance:-distance),p.y,{steps:6});await page.mouse.up();
}
async function dailyPoster(page:Page){
  await openDailyResultShare(page);const image=page.locator('.fw-arcade-result-photo > img');
  await expect(image).toHaveJSProperty('naturalWidth',960);await expect(image).toHaveJSProperty('naturalHeight',720);
  await closeDailyResultShare(page);const event=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG',exact:true}).click();
  const bytes=readFileSync((await(await event).path())!),metadata=await sharp(bytes).metadata();
  expect([metadata.format,metadata.width,metadata.height]).toEqual(['png',960,1200]);
  expect((await sharp(bytes).stats()).channels.some(c=>c.stdev>10)).toBe(true);
  await openDailyResultShare(page);await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  await closeDailyResultShare(page);
}
for(const light of [false,true]){
  const mode=light?'light':'native';
  test(`AD-scene ${mode}: photo completes three real clients, six distinct frames and a real poster`,async({page},testInfo)=>{
    await page.setViewportSize({width:390,height:844});await openDailyScene(page,'photo',light);
    const shutter=page.getByRole('button',{name:'拍照快門',exact:true});
    for(let client=0;client<3;client++){
      await expect(page.locator('.fw-arcade-counter')).toContainText(`${client+1}/3`);
      await shutter.click();await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(client*2+1);
      if(client===0)await testInfo.attach(`daily-${mode}-photo-first-shot.png`,{body:await page.locator('.fullscreen-game').screenshot(),contentType:'image/png'});
      await page.getByRole('button',{name:'鏡頭往上',exact:true}).click();await page.getByRole('slider',{name:'鏡頭廣角',exact:true}).press('End');await page.clock.runFor(160);
      await shutter.click();await expect(shutter).toBeDisabled();await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(client*2+2);
      const frames=await page.locator('.fw-arcade-contact-sheet img').evaluateAll(es=>es.map(e=>(e as HTMLImageElement).src));
      expect(frames[client*2]).not.toBe(frames[client*2+1]);
      if(client<2)await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();
    }
    await page.getByRole('button',{name:'挑選照片',exact:true}).click();await openDailyResultShare(page);await expect(page.locator('.fw-arcade-photo-choices button')).toHaveCount(6);
    await page.locator('.fw-arcade-photo-choices button').last().click();await expect(page.locator('.fw-arcade-photo-choices button').last()).toHaveAttribute('aria-pressed','true');await dailyPoster(page);
    await openDailyResultShare(page);await page.getByRole('button',{name:'回遊樂場',exact:true}).click();await expect(page.locator('#fw-arcade-main')).toBeFocused();await expect(page.locator('.fw-arcade-stage canvas')).toHaveCount(0);
  });
  test(`AD-scene ${mode}: pointer lands on practice and all twelve visible paper targets`,async({page},testInfo)=>{
    await page.setViewportSize({width:390,height:844});await openDailyScene(page,'stamp',light);
    const practice=await dailyStampPoint(page,0);await page.mouse.click(practice.x,practice.y);await expect(page.locator('.fw-arcade-counter')).toHaveText('0/12');
    for(let index=0;index<12;index++){
      await page.clock.fastForward(230);const point=await dailyStampPoint(page,index);await page.mouse.click(point.x,point.y);
      if(index<11){await expect(page.locator('.fw-arcade-counter')).toHaveText(`${index+1}/12`);await expect(page.locator('.fw-arcade-controls .fw-arcade-meta')).toContainText('多蓋 0 次');}
      if(index===0)await testInfo.attach(`daily-${mode}-stamp-first-document.png`,{body:await page.locator('.fullscreen-game').screenshot(),contentType:'image/png'});
    }
    await expect(page.locator('[data-daily-result-share]')).toContainText('完成 12 份文件');await dailyPoster(page);
    await page.getByRole('button',{name:'同一題再來一次',exact:true}).click();await expect(page.locator('.fw-arcade-counter')).toHaveText('練習中');await expect(page.locator('.fw-arcade-board')).toBeFocused();
  });
  test(`AD-scene ${mode}: visible cash drag rejects wrong and short swipes then completes all thirty cards`,async({page},testInfo)=>{
    // The hosted software renderer exceeded 45s while replaying the 30 real drags.
    if(!light)test.setTimeout(90_000);
    await openDailyScene(page,'cash',light);const deck=cashDeck(42),progress=page.locator('.fw-arcade-controls .fw-arcade-meta');
    await dailySortDrag(page,deck[0].valid,47);await expect(progress).toContainText('已分類 0 / 30 · 分錯 0 次');
    await dailySortDrag(page,!deck[0].valid);await expect(progress).toContainText('已分類 0 / 30 · 分錯 1 次');await page.clock.fastForward(180);
    for(const [index,card]of deck.entries()){
      await expect(page.locator('.fw-arcade-instruction')).toContainText(card.label);await dailySortDrag(page,card.valid);await page.clock.fastForward(180);
      if(index<29)await expect(progress).toContainText(`已分類 ${index+1} / 30 · 分錯 1 次`);
      if(index===2)await testInfo.attach(`daily-${mode}-cash-three-cards.png`,{body:await page.locator('.fullscreen-game').screenshot(),contentType:'image/png'});
    }
    await expect(page.locator('[data-daily-result-share]')).toContainText('100 萬道具鈔 · 退回 6 張票券');await dailyPoster(page);
    await openDailyResultShare(page);await page.getByRole('button',{name:'回遊樂場',exact:true}).click();await expect(page.locator('#fw-arcade-main')).toBeFocused();
  });
  test(`AD-scene ${mode}: cancelled paper contacts, secondary input and stale cash subjects never consume the next item`,async({page})=>{
    await openDailyScene(page,'stamp',light);const point=await dailyStampPoint(page,0),host=page.locator('.fw-arcade-stage');
    await page.mouse.click(point.x,point.y,{button:'right'});await expect(page.locator('.fw-arcade-counter')).toHaveText('練習中');
    await page.mouse.move(point.x,point.y);await page.mouse.down();
    await host.evaluate(el=>el.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1,isPrimary:true})));await page.mouse.up();await expect(page.locator('.fw-arcade-counter')).toHaveText('練習中');
    await page.mouse.move(point.x,point.y);await page.mouse.down();const box=(await host.boundingBox())!;await page.mouse.move(box.x+2,box.y+2);await page.mouse.up();await expect(page.locator('.fw-arcade-counter')).toHaveText('練習中');
    await page.getByRole('button',{name:'回遊樂場',exact:true}).click();
    // Reuse the same installed clock while starting a different real game.
    await page.goto('/play?game=cash&seed=42');await expect(page.locator('[data-game-stage="ready"]')).toBeVisible();
    if(light){await page.getByRole('button',{name:'3D · 改用輕量插畫',exact:true}).click();await expect(page.locator('[data-game-stage="ready"]')).toHaveAttribute('data-daily-renderer','light');}
    await page.getByRole('button',{name:'開始這一局',exact:true}).click();await exitStartedFullscreen(page);
    const center=await dailyWorldPoint(page,'cash',[0,.33,0]),deck=cashDeck(42),progress=page.locator('.fw-arcade-controls .fw-arcade-meta');
    await page.mouse.move(center.x,center.y);await page.mouse.down();await page.locator('.fw-arcade-board').press(deck[0].valid?'ArrowRight':'ArrowLeft');await expect(progress).toContainText('已分類 1 / 30');
    await page.clock.fastForward(180);await page.mouse.move(center.x+(deck[1].valid?80:-80),center.y);await page.mouse.up();await expect(progress).toContainText('已分類 1 / 30 · 分錯 0 次');
    const sort=page.getByRole('button',{name:deck[1].valid?'收鈔→（收取道具鈔）':'←退券（退回票券）',exact:true});await sort.focus();await page.keyboard.down('Enter');await page.clock.fastForward(500);await page.keyboard.down('Enter');await page.keyboard.up('Enter');
    await expect(progress).toContainText('已分類 2 / 30 · 分錯 0 次');
    await page.clock.fastForward(180);await sort.focus();await page.keyboard.down('Space');await page.keyboard.press('Escape');await page.keyboard.up('Space');await expect(progress).toContainText('已分類 2 / 30 · 分錯 0 次');
    await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await expect(page.locator('.fw-arcade-board')).toBeFocused();
    await page.getByRole('button',{name:'重新開始這一局',exact:true}).click();await page.getByRole('button',{name:'確認重新開始',exact:true}).click();await expect(progress).toContainText('已分類 0 / 30 · 分錯 0 次');await expect(page.getByRole('button',{name:'開始這一局',exact:true})).toBeVisible();
  });
  test(`AD-scene ${mode}: held shutter across the actual twelve-second client boundary cannot spend the next film`,async({page})=>{
    await openDailyScene(page,'photo',light);const shutter=page.getByRole('button',{name:'拍照快門',exact:true});
    await shutter.focus();await page.keyboard.down('Enter');await page.clock.fastForward(12016);await page.keyboard.up('Enter');
    await expect(page.locator('.fw-arcade-counter')).toContainText('2/3');await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(0);await expect(page.locator('[data-photo-film]')).toBeVisible();await expect(page.locator('[data-photo-film]')).toHaveText('2 張');
    await shutter.press('Enter');await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(1);await expect(page.locator('.fw-arcade-notice')).toContainText('第 2 / 3 位客人，已保存 1 / 2 張');
  });
}

for(const game of ['photo','stamp','cash'] as const)for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375}])test(`AD-scene layout ${game} ${viewport.width}: bounded owner, 200% text, safe insets and modal focus`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);await page.addInitScript(()=>{Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false});});
  await openDailyScene(page,game,true);await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();
  const fullscreen=page.getByRole('dialog',{name:'遊戲全螢幕',exact:true});await expect(fullscreen).toBeVisible();
  // Simulate text scaling (not CSS zoom) and nonzero safe-inset padding on the
  // real owner. The test does not shrink, remove, scroll-hide or force controls.
  await page.locator('[data-daily-stage]').evaluate(el=>{
    const nodes=[el,...el.querySelectorAll('*')].filter(e=>e instanceof HTMLElement).map(e=>({el:e as HTMLElement,font:parseFloat(getComputedStyle(e).fontSize)}));
    for(const {el,font}of nodes)el.style.fontSize=`${font*2}px`;
    for(const [side,value]of Object.entries({top:12,right:8,bottom:16,left:8}))(el as HTMLElement).style.setProperty(`--game-safe-${side}`,`${value}px`);
  });
  const stage=page.locator('[data-daily-stage]');
  const controls=stage.locator('button:visible,input:visible');
  for(let i=0;i<await controls.count();i++){
    const control=controls.nth(i);await control.scrollIntoViewIfNeeded();
    expect(await control.evaluate(el=>{const r=el.getBoundingClientRect(),o=el.closest('[data-daily-stage]')!.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>=44&&r.height>=44&&r.left>=o.left-1&&r.right<=o.right+1&&r.top>=o.top-1&&r.bottom<=o.bottom+1&&!!hit&&(el===hit||el.contains(hit));})).toBe(true);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await testInfo.attach(`daily-light-${game}-${viewport.width}x${viewport.height}-200pct-insets.png`,{body:await fullscreen.screenshot(),contentType:'image/png'});
  const help=page.getByRole('button',{name:'玩法說明',exact:true});await help.click();const dialog=page.getByRole('dialog',{name:'玩法說明',exact:true});await expect(dialog).toBeVisible();
  for(const key of ['Tab','Shift+Tab','Tab']){await page.keyboard.press(key);expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(help).toBeFocused();await expect(fullscreen).toBeVisible();
  const resume=page.getByRole('button',{name:'繼續這一局',exact:true});await resume.click();await expect(page.locator('.fw-arcade-board')).toBeFocused();await expect(page.locator('.fw-arcade-action-area')).not.toHaveAttribute('inert','');
  const restart=page.getByRole('button',{name:'重新開始這一局',exact:true});await restart.click();await expect(page.getByRole('dialog',{name:'重新開始同一題？',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(restart).toBeFocused();
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await page.keyboard.press('Escape');await expect(fullscreen).toHaveCount(0);
  await page.getByRole('button',{name:'回遊樂場',exact:true}).click();await expect(page.locator('#fw-arcade-main')).toBeFocused();
});

test('AD-scene light: no WebGL requires explicit fallback, failed capture preserves film and real PNG/JPEG retries recover',async({page})=>{
  await blockPartyWebGL(page);await page.clock.install({time:new Date('2026-10-23T00:00:00Z')});await page.goto('/play?game=photo&seed=42');
  await expect(page.getByRole('alert')).toContainText('此瀏覽器暫時無法開啟 3D 場景');await expect(page.locator('.fw-arcade-stage canvas')).toHaveCount(0);
  await page.getByRole('button',{name:'用輕量畫面繼續',exact:true}).click();await expect(page.locator('[data-game-stage="ready"]')).toHaveAttribute('data-daily-renderer','light');
  await page.clock.pauseAt(new Date('2026-10-23T00:01:00Z'));await page.getByRole('button',{name:'開始這一局',exact:true}).click();await exitStartedFullscreen(page);
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...args){HTMLCanvasElement.prototype.toDataURL=original;throw Error('Synthetic light capture failure');};
  });
  const shutter=page.getByRole('button',{name:'拍照快門',exact:true});await shutter.click();await expect(page.locator('.fw-arcade-notice')).toContainText('已保存 0 / 2 張');await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(0);
  await shutter.click();await expect(page.locator('.fw-arcade-contact-sheet img')).toHaveCount(1);
  // Fail encoding, not the game model. Each format fails once and then the
  // user's actual retry invokes the original native encoder.
  await page.evaluate(()=>{
    const original=HTMLCanvasElement.prototype.toBlob,failed=new Set<string>();
    HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){const kind=type??'image/png';if(!failed.has(kind)){failed.add(kind);callback(null);return;}return original.call(this,callback,type,quality);};
  });
  await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();await shutter.click();await page.getByRole('button',{name:'下一位客人 →',exact:true}).click();await shutter.click();await page.getByRole('button',{name:'挑選照片',exact:true}).click();
  await expect(page.getByRole('button',{name:'重試產生成果圖',exact:true})).toBeEnabled();await page.getByRole('button',{name:'重試產生成果圖',exact:true}).click();
  await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();await openDailyResultShare(page);await expect(page.getByRole('button',{name:'重試準備工坊圖片',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'重試準備工坊圖片',exact:true}).click();await dailyPoster(page);
  await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await page.getByRole('button',{name:'分享成果',exact:true}).click();const share=page.locator('[data-daily-result-share]');await expect(share).toBeVisible();await expect(share.getByRole('button',{name:'關閉分享',exact:true})).toBeFocused();
  expect(await share.evaluate(el=>{const owner=el.closest('.fullscreen-game');return !!owner&&owner.contains(el)&&getComputedStyle(owner).overflowY!=='visible';})).toBe(true);
  await page.getByRole('button',{name:'回遊樂場',exact:true}).click();await expect(page.locator('#fw-arcade-main')).toBeFocused();
});

// Actual production WebGL captures, never illustration/mockup substitutes.
for(const game of ['chair','tofu','holiday'] as const)test(`PT-art: ${game} authored scene preserves native budgets and records real pixels`,async({page},testInfo)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:390,height:844});await openParty(page,game);
  await partyAdvance(page,game==='chair'?1800:game==='holiday'?300:700);
  const host=page.locator('.pt-canvas');await expect(host.locator('canvas')).toBeVisible();
  const stats=await host.evaluate(el=>({calls:Number(el.getAttribute('data-render-calls')),triangles:Number(el.getAttribute('data-render-triangles')),geometries:Number(el.getAttribute('data-render-geometries')),textures:Number(el.getAttribute('data-render-textures'))}));
  expect(stats.calls).toBeGreaterThan(0);expect(stats.calls).toBeLessThan(400);expect(stats.triangles).toBeGreaterThan(0);expect(stats.triangles).toBeLessThan(150000);
  await testInfo.attach(`${game}-native-stats`,{body:JSON.stringify(stats),contentType:'application/json'});
  await testInfo.attach(`${game}-native-scene.png`,{body:await host.screenshot(),contentType:'image/png'});
  await testInfo.attach(`${game}-phone-page.png`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await page.setViewportSize({width:1440,height:900});await testInfo.attach(`${game}-desktop-page.png`,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  expect(errors).toEqual([]);
});

// Exercise the existing source-bound operator on the normal browser runner.
// Body attachments survive the pinned JSON report without a new CI/upload lane.
// Nothing here updates product previews or changes capture admission/budgets.
test('PT-art: native catalog capture binds real pixels to compiled sources and releases WebGL',async({},testInfo)=>{
  const require=createRequire(import.meta.url);
  const {mkdtemp,readFile,readdir,rm}=require('node:fs/promises');
  const {join}=require('node:path');
  const {tmpdir}=require('node:os');
  const {chromium}=require('playwright');
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const {capture}=await import(new URL('../../modules/absurd-daily/tools/native-party-previews.mjs',import.meta.url).href);
  const parent=await mkdtemp(join(tmpdir(),'party-native-evidence-')),out=join(parent,'capture');
  // Keep emitted chunks as well as images, so validateFiles can independently
  // recheck exact compiled bytes instead of trusting a manifest-only claim.
  const attach=async(dir:string,prefix='')=>{
    const entries=await readdir(dir,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
    for(const entry of entries){
      const name=prefix+entry.name,path=join(dir,entry.name);
      if(entry.isDirectory())await attach(path,name+'/');
      else if(entry.isFile())await testInfo.attach('party-capture/'+name,{body:await readFile(path),contentType:name.endsWith('.png')?'image/png':name.endsWith('.webp')?'image/webp':name.endsWith('.json')?'application/json':'text/javascript'});
    }
  };
  try{
    const receipt=await capture(root,out,chromium.executablePath());
    expect(receipt.status).toBe('captured_pending_visual_review');
    expect(receipt.errors).toEqual([]);
    expect(receipt.previews.map((p:{game:string})=>p.game).sort()).toEqual(['chair','holiday','tofu']);
  }finally{
    try{await attach(out);}finally{await rm(parent,{recursive:true,force:true});}
  }
});

// A full scene may sit behind HUD chrome; only its projected gameplay core
// must remain unmasked. Check rendered DOM geometry and actual hit targets,
// rather than accepting a painted margin around the old 4:3 canvas.
async function expectPartyFullViewport(page:Page,hitCore=true){
  await expect.poll(()=>page.locator('.pt-root').evaluate((root,hitCore)=>{
    const errors:string[]=[],owner=root.closest('.fullscreen-game')!,host=root.querySelector<HTMLElement>('.pt-canvas')!,world=root.querySelector<HTMLElement>('.pt-holiday-world')!,core=root.querySelector<HTMLElement>('.pt-gameplay-core');
    if(!core)return ['missing gameplay core'];
    const o=owner.getBoundingClientRect(),r=root.getBoundingClientRect(),h=host.getBoundingClientRect(),c=core.getBoundingClientRect();
    for(const [name,rect]of [['root',r],['host',h]] as const)for(const edge of ['left','top','right','bottom'] as const)if(Math.abs(rect[edge]-o[edge])>1)errors.push(`${name} not full-owner: ${edge}`);
    if(Math.abs(o.left)>1||Math.abs(o.top)>1||Math.abs(o.width-innerWidth)>1||Math.abs(o.height-innerHeight)>1)errors.push('owner not full viewport');
    if(c.width<128||c.height<96||c.left<h.left-1||c.top<h.top-1||c.right>h.right+1||c.bottom>h.bottom+1)errors.push('core outside playable bounds');
    const canvas=host.querySelector('canvas');
    if(canvas){const b=canvas.getBoundingClientRect();for(const edge of ['left','top','right','bottom'] as const)if(Math.abs(b[edge]-h[edge])>1)errors.push(`native canvas letterboxed: ${edge}`);if(canvas.width*canvas.height>640*480*1.5**2||!canvas.width||!canvas.height)errors.push('native pixel budget');if(Math.abs(canvas.width/canvas.height-h.width/h.height)>.02)errors.push('native projection aspect mismatch');}
    const svg=world.querySelector<SVGSVGElement>('.pt-light-world,.pt-paper-scenery');if(svg){const b=svg.getBoundingClientRect();if(Math.abs(svg.viewBox.baseVal.width/svg.viewBox.baseVal.height-h.width/h.height)>.02)errors.push('light projection aspect mismatch');for(const edge of ['left','top','right','bottom'] as const)if(Math.abs(b[edge]-h[edge])>1)errors.push(`light scene letterboxed: ${edge}`);}
    if(hitCore){
      for(const [x,y]of [[c.left+4,c.top+4],[c.right-4,c.top+4],[c.left+4,c.bottom-4],[c.right-4,c.bottom-4],[(c.left+c.right)/2,(c.top+c.bottom)/2]]){const hit=document.elementFromPoint(x,y);if(!hit||!world.contains(hit))errors.push('gameplay core obscured');}
      for(const el of root.querySelectorAll<HTMLElement>('.pt-holiday-heading,.pt-scoreboard,.pt-controls,.pt-holiday-footer')){if(!el.checkVisibility())continue;const b=el.getBoundingClientRect();if(Math.min(c.right,b.right)-Math.max(c.left,b.left)>1&&Math.min(c.bottom,b.bottom)-Math.max(c.top,b.top)>1)errors.push(`chrome overlaps core: ${el.className}`);}
      for(const button of root.querySelectorAll<HTMLButtonElement>('button')){if(!button.checkVisibility()||button.closest('[inert]'))continue;const b=button.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(b.width<44||b.height<44)errors.push(`small control: ${button.getAttribute('aria-label')}`);if(!hit||!button.contains(hit))errors.push(`control obscured: ${button.getAttribute('aria-label')}`);}
      if(root.classList.contains('pt-holiday')&&canvas){const anchors=JSON.parse(host.dataset.anchors??'[]') as {x:number;y:number}[];if(anchors.length!==6)errors.push('missing native targets');for(const a of anchors){const x=h.left+a.x*h.width,y=h.top+a.y*h.height,hit=document.elementFromPoint(x,y);if(x<c.left||x>c.right||y<c.top||y>c.bottom||!hit||!world.contains(hit))errors.push('native target outside unmasked core');}}
    }
    if(document.documentElement.scrollWidth>innerWidth)errors.push('horizontal document overflow');
    return errors;
  },hitCore)).toEqual([]);
}

for(const game of ['chair','tofu','holiday'] as const)for(const light of [false,true])for(const viewport of [{name:'compact',width:320,height:568},{name:'phone',width:390,height:844},{name:'landscape',width:667,height:375},{name:'desktop',width:1440,height:900}] as const)test(`PT-art: ${game} ${light?'light':'native'} ${viewport.name} composition owns its palette and whole-screen evidence`,async({page},testInfo)=>{
  const expected={chair:{world:'rgb(20, 32, 57)',surface:[36,52,80],ink:'rgb(245, 232, 201)'},tofu:{world:'rgb(219, 227, 216)',surface:[251,247,234],ink:'rgb(53, 79, 70)'},holiday:{world:'rgb(244, 223, 177)',surface:[255,247,228],ink:'rgb(103, 69, 37)'}}[game];
  // Set the window size before entering native fullscreen; browsers reject resizing it there.
  await page.setViewportSize({width:viewport.width,height:viewport.height});
  if(light){if(game==='holiday')await openLightHoliday(page);else await openLightAction(page,game);}else await openParty(page,game);
  await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();
  const owner=page.locator(`.fullscreen-game--${game}`);
  try{
  await expect(owner).toHaveCSS('background-color',expected.world);
  // Read the actual compositing owners, not an unused custom property or a
  // low-specificity rule. Canvas2D normalizes browser color-mix serialization.
  for(const [selector,opacity]of [['.pt-scoreboard',.92],['.pt-holiday-feedback',.94]] as const){
    const rgba=await owner.locator(selector).evaluate(el=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;ctx.fillStyle=getComputedStyle(el).backgroundColor;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data);});
    for(let channel=0;channel<3;channel++)expect(Math.abs(rgba[channel]-expected.surface[channel])).toBeLessThanOrEqual(1);
    expect(Math.abs(rgba[3]-Math.round(255*opacity))).toBeLessThanOrEqual(1);
  }
  await expect(owner.locator('.pt-scoreboard strong').first()).toHaveCSS('color',expected.ink);
  await expect(owner.locator('.pt-feedback')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(owner.locator('.pt-feedback')).toHaveCSS('color',expected.ink);
  await expectPartyFullViewport(page);
  }finally{
  // Preserve the original phone/desktop PNG evidence; new sizes are actual
  // JPEG screenshots to avoid duplicating large pixels in the bounded report.
  if(viewport.name==='phone'||viewport.name==='desktop')await testInfo.attach(`${game}-${light?'light':'native'}-fullscreen-${viewport.name}.png`,{body:await owner.screenshot(),contentType:'image/png'});
  else await testInfo.attach(`${game}-${light?'light':'native'}-fullscreen-${viewport.name}.jpg`,{body:await owner.screenshot({type:'jpeg',quality:85}),contentType:'image/jpeg'});
  }
});


for(const light of [false,true])test(`PT-fullview: ${light?'light':'native'} holiday projection resizes while paused without spending time or losing target hits`,async({page},testInfo)=>{
  // Use the existing viewport fallback so resizing tests the real layout owner,
  // not a browser's restriction on resizing an active native fullscreen window.
  await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new Error('Synthetic unavailable fullscreen'));});
  await page.setViewportSize({width:390,height:844});
  if(light)await openLightHoliday(page);else await openParty(page,'holiday');
  await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();
  for(const [index,viewport]of [{width:667,height:375},{width:1440,height:900},{width:320,height:568}].entries()){
    await partyAdvance(page,index*PT.holidayRoundMs+250);
    await page.getByRole('button',{name:'暫停',exact:true}).click();
    const elapsed=await partyElapsed(page),score=await page.locator('.pt-root').getAttribute('data-party-score');
    await page.setViewportSize(viewport);await page.clock.runFor(160);
    await expectPartyFullViewport(page,false);
    expect(await partyElapsed(page)).toBe(elapsed);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);
    await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await page.clock.runFor(16);
    await expectPartyFullViewport(page);
    const good=page.getByRole('button',{name:/第 [1-6] 格：休假/});
    if(light)await good.click();else{
      const hole=Number((await good.getAttribute('aria-label'))!.match(/第 (\d)/)![1])-1;
      const point=await page.locator('.pt-canvas').evaluate((host,hole)=>{const a=JSON.parse((host as HTMLElement).dataset.anchors!)[hole],b=host.getBoundingClientRect();return {x:b.x+a.x*b.width,y:b.y+a.y*b.height};},hole);
      await page.mouse.click(point.x,point.y);
    }
    await expect(page.locator('.pt-live-label')).toContainText(`已守住 ${index+1} 個假日`);
    await testInfo.attach(`holiday-${light?'light':'native'}-resized-${viewport.width}x${viewport.height}.jpg`,{body:await page.locator('.fullscreen-game').screenshot({type:'jpeg',quality:85}),contentType:'image/jpeg'});
  }
});


for(const game of ['chair','tofu','holiday'] as const)test(`PT-fullview: ${game} ready and paused tools remain real pointer targets while modal tools are isolated`,async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.clock.install({time:new Date('2026-10-25T00:00:00Z')});
  await page.goto(`/play?game=${game}&seed=42`);await expect(page.locator('[data-party-stage="ready"]')).toBeVisible();
  // The ready screen is already full-viewport, even before a user gesture can
  // request native fullscreen. Its footer must not fall below site navigation.
  const readyBounds=await page.locator('.fullscreen-game').boundingBox();
  expect(readyBounds).not.toBeNull();
  expect(readyBounds!.x).toBeCloseTo(0,0);expect(readyBounds!.y).toBeCloseTo(0,0);
  expect(readyBounds!.width).toBeCloseTo(390,0);expect(readyBounds!.height).toBeCloseTo(844,0);
  const tools=page.locator('.pt-tools');
  const hit=async(label:string)=>{
    const button=tools.getByRole('button',{name:label,exact:true});
    await expect(button).toBeVisible();
    expect(await button.evaluate(el=>{const b=el.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return b.width>=44&&b.height>=44&&!!hit&&el.contains(hit);})).toBe(true);
    await button.click();
  };
  await hit('減少動態關');await expect(tools.getByRole('button',{name:'減少動態開',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','ready');
  await page.clock.pauseAt(new Date('2026-10-25T00:01:00Z'));
  await page.getByRole('button',{name:'開始派對！',exact:true}).click();await page.clock.runFor(16);await page.getByRole('button',{name:'暫停',exact:true}).click();
  const elapsed=await partyElapsed(page),score=await page.locator('.pt-root').getAttribute('data-party-score');
  await hit('玩法與設定');await expect(page.getByRole('dialog',{name:'玩法與設定',exact:true})).toBeVisible();
  expect(await tools.evaluate(el=>!!el.closest('[inert]'))).toBe(true);
  await page.getByRole('button',{name:'回到遊戲',exact:true}).click();await expect(tools.getByRole('button',{name:'玩法與設定',exact:true})).toBeFocused();
  await hit('重新開始');await expect(page.getByRole('button',{name:'確定重來',exact:true})).toBeFocused();
  expect(await tools.evaluate(el=>!!el.closest('[inert]'))).toBe(true);
  await page.getByRole('button',{name:'保留這局',exact:true}).click();await expect(tools.getByRole('button',{name:'重新開始',exact:true})).toBeFocused();
  await hit('減少動態開');await expect(tools.getByRole('button',{name:'減少動態關',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);expect(await partyElapsed(page)).toBe(elapsed);
});


// Frontal composition is verified from the real mounted renderer and real input.
test('PT-front: holiday presents aligned non-overlapping rows and ray-picks the live reward',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await openParty(page,'holiday');await partyAdvance(page,300);
  const host=page.locator('.pt-canvas');await expect(host.locator('canvas')).toHaveAttribute('data-party-projection','front');
  const anchors=JSON.parse((await host.getAttribute('data-anchors'))!) as {x:number;y:number}[];
  expect(anchors).toHaveLength(6);
  for(let i=0;i<3;i++){expect(Math.abs(anchors[i].x-anchors[i+3].x)).toBeLessThan(.00001);expect(anchors[i+3].y-anchors[i].y).toBeGreaterThan(.05);}
  const label=(await page.getByRole('button',{name:/第 [1-6] 格：休假/}).getAttribute('aria-label'))!,hole=Number(label.match(/第 (\d)/)![1])-1;
  const box=(await host.boundingBox())!,a=anchors[hole];await page.mouse.click(box.x+a.x*box.width,box.y+a.y*box.height);
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
  await testInfo.attach('holiday-front-real-input.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});
