import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {test,expect,type Page,type Download,type Route} from './fixtures.js';
import {navigate,openAccountSettings} from './navigation.js';
import {quickJoin} from './quick-join.js';

// These journeys use the shared disposable-schema fixture and synthetic accounts.
// No direct API/DB writes, clipboard writes or OS sharing stand in for UI actions.
async function signup(page:Page,name:string){
  await page.goto('/');
  await page.getByRole('button',{name:'建立帳號',exact:true}).click();
  await page.getByLabel('社群顯示名稱',{exact:true}).fill(name);
  await page.getByLabel('電子郵件',{exact:true}).fill(`download-stability-${randomUUID()}@example.test`);
  await page.getByLabel('密碼',{exact:true}).fill('freedom-download-stability-password');
  await page.getByRole('button',{name:'建立帳號，先逛工坊',exact:true}).click();
  await quickJoin(page);
  await expect(page.locator('.shell')).toBeVisible();
}
async function enableShare(page:Page){
  await navigate(page,'我的名片');
  await openAccountSettings(page,'分享名片設定（免登入）');
  const settings=page.getByRole('region',{name:'分享我的工坊名片'});
  const editorial=settings.getByRole('button',{name:'工坊誌',exact:true});
  await expect(editorial).toBeVisible();
  if(await editorial.getAttribute('aria-pressed')!=='true'){
    await editorial.click();
    await expect(settings.locator('.ecard-save-status')).toContainText('已自動儲存');
  }
  await expect(editorial).toHaveAttribute('aria-pressed','true');
  await settings.getByRole('button',{name:'建立分享連結',exact:true}).click();
  const link=settings.getByRole('link',{name:'開啟名片',exact:true});
  await expect(link).toHaveAttribute('href',/\/member-cards\//);
  return new URL((await link.getAttribute('href'))!,page.url()).href;
}
function deferred(){
  let resolve!:()=>void;
  const promise=new Promise<void>(done=>{resolve=done;});
  return {promise,resolve};
}
async function holdLabels(page:Page,origin:string,fail:boolean){
  const arrived=deferred(),release=deferred();
  const pending=new Set<Promise<void>>();
  const matches=(url:URL)=>url.origin===origin&&url.pathname==='/api/v1/assessment-definition'&&url.search==='';
  const handler=async(route:Route)=>{
    if(route.request().method()!=='GET'){await route.continue();return;}
    const work=(async()=>{
      // Preserve the real successful payload; only its delivery timing changes.
      const response=await route.fetch();
      expect(response.status()).toBe(200);
      arrived.resolve();
      await release.promise;
      if(fail)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'labels_temporarily_unavailable'})});
      else await route.fulfill({response});
    })();
    pending.add(work);
    try{await work;}finally{pending.delete(work);}
  };
  await page.route(matches,handler);
  return {
    arrived:arrived.promise,
    async finish(){
      const delivered=page.waitForResponse(response=>matches(new URL(response.url()))&&response.request().method()==='GET');
      release.resolve();
      const response=await delivered;
      expect(response.status()).toBe(fail?503:200);
      await response.finished();
      await paint(page);
    },
    async dispose(){
      release.resolve();
      await Promise.allSettled([...pending]);
      if(!page.isClosed())await page.unroute(matches,handler);
    },
  };
}
async function paint(page:Page){
  // Let fetch continuations and React's resulting commit pass before assertions.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}
type CanvasGate={pending:number;released:number;release:()=>void;restore:()=>void};
type GateWindow=Window&{__cardCanvasGate?:CanvasGate};
async function holdRealPng(page:Page){
  await page.evaluate(()=>{
    const target=window as GateWindow;
    const original=HTMLCanvasElement.prototype.toBlob;
    const callbacks:Array<()=>void>=[];
    let open=false;
    const gate:CanvasGate={
      pending:0,released:0,
      release(){
        open=true;
        for(const deliver of callbacks.splice(0)){gate.pending--;gate.released++;deliver();}
      },
      restore(){gate.release();HTMLCanvasElement.prototype.toBlob=original;delete target.__cardCanvasGate;},
    };
    target.__cardCanvasGate=gate;
    HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){
      // Native canvas still encodes the actual rendered card. Hold only its
      // callback so html-to-image's real promise is pending at the race boundary.
      original.call(this,blob=>{
        if(open){callback(blob);return;}
        gate.pending++;
        callbacks.push(()=>callback(blob));
      },type,quality);
    };
  });
  return {
    async wait(){await expect.poll(()=>page.evaluate(()=>(window as GateWindow).__cardCanvasGate?.pending??0)).toBe(1);},
    async release(){
      await page.evaluate(()=>(window as GateWindow).__cardCanvasGate!.release());
      await paint(page);
      expect(await page.evaluate(()=>(window as GateWindow).__cardCanvasGate!.released)).toBe(1);
    },
    async dispose(){if(!page.isClosed())await page.evaluate(()=>(window as GateWindow).__cardCanvasGate?.restore());},
  };
}
async function checkPng(download:Download,url:string){
  expect(download.suggestedFilename()).toBe('freedom-workshop-card.png');
  expect(await download.failure()).toBeNull();
  const path=await download.path();
  expect(path).not.toBeNull();
  const bytes=readFileSync(path!);
  expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  expect(info.width).toBeGreaterThan(0);expect(info.height).toBeGreaterThan(0);
  expect(jsQR(new Uint8ClampedArray(data),info.width,info.height)?.data).toBe(url);
}

for(const scenario of [
  {viewer:'self',fail:false},
  {viewer:'peer',fail:false},
  {viewer:'self',fail:true},
] as const){
  test(`public PNG stays busy and downloads real QR when delayed labels ${scenario.fail?'fail':'arrive'} (${scenario.viewer})`,async({page,browser})=>{
    test.setTimeout(120000);
    await signup(page,'Synthetic Download Owner');
    const url=await enableShare(page);
    const peerContext=scenario.viewer==='peer'?await browser.newContext({baseURL:new URL(url).origin}):null;
    const viewer=await (peerContext??page.context()).newPage();
    let labels:Awaited<ReturnType<typeof holdLabels>>|undefined;
    let png:Awaited<ReturnType<typeof holdRealPng>>|undefined;
    const downloads:Download[]=[];
    const onDownload=(download:Download)=>downloads.push(download);
    viewer.on('download',onDownload);
    try{
      if(scenario.viewer==='peer')await signup(viewer,'Synthetic Download Peer');
      if(scenario.viewer==='self'&&!scenario.fail)await viewer.setViewportSize({width:390,height:844});
      labels=await holdLabels(viewer,new URL(url).origin,scenario.fail);
      await viewer.goto(url);
      await labels.arrived;
      // These controls are only rendered after BOTH public and private reads.
      if(scenario.viewer==='self')await expect(viewer.getByRole('button',{name:'編輯名片',exact:true})).toBeVisible();
      else await expect(viewer.getByRole('button',{name:'邀請成為好友',exact:true})).toBeVisible();
      const publicCard=viewer.locator('.public-member-page > .ecard-download');
      await expect(publicCard.locator('.ecard')).toHaveAttribute('data-design','editorial');
      await expect(publicCard.locator('.ecard-name')).toHaveText('Synthetic Download Owner');
      await expect(publicCard.locator('.ecard-qr')).toHaveAttribute('href',url);
      png=await holdRealPng(viewer);
      await publicCard.getByRole('button',{name:'下載名片 PNG',exact:true}).click();
      await png.wait();
      await expect(publicCard.getByRole('button',{name:'正在產生圖片…',exact:true})).toBeDisabled();
      await labels.finish();
      // Regression: an unrelated labels commit must not reset the generation,
      // unlock a second click or silently discard this already-started PNG.
      await expect(publicCard.getByRole('button',{name:'正在產生圖片…',exact:true})).toBeDisabled();
      expect(downloads).toHaveLength(0);
      const downloaded=viewer.waitForEvent('download');
      await png.release();
      await checkPng(await downloaded,url);
      await expect(publicCard.getByRole('status')).toContainText('名片圖片已產生');
      await expect(publicCard.getByRole('button',{name:'下載名片 PNG',exact:true})).toBeEnabled();
      expect(downloads).toHaveLength(1);
    }finally{
      // Unmount first, so releasing a gate after a failed assertion cannot export.
      if(!viewer.isClosed())await viewer.close();
      if(labels)await labels.dispose();
      if(png)await png.dispose();
      viewer.off('download',onDownload);
      if(peerContext)await peerContext.close();
    }
  });
}

test('leaving a public card still discards a late real PNG after labels settle',async({page})=>{
  test.setTimeout(120000);
  await signup(page,'Synthetic Leaving Owner');
  const url=await enableShare(page);
  const viewer=await page.context().newPage();
  let labels:Awaited<ReturnType<typeof holdLabels>>|undefined;
  let png:Awaited<ReturnType<typeof holdRealPng>>|undefined;
  const downloads:Download[]=[];
  const onDownload=(download:Download)=>downloads.push(download);
  viewer.on('download',onDownload);
  try{
    labels=await holdLabels(viewer,new URL(url).origin,false);
    await viewer.goto(url);await labels.arrived;
    await expect(viewer.getByRole('button',{name:'編輯名片',exact:true})).toBeVisible();
    png=await holdRealPng(viewer);
    await viewer.getByRole('button',{name:'下載名片 PNG',exact:true}).click();
    await png.wait();await labels.finish();
    await expect(viewer.getByRole('button',{name:'正在產生圖片…',exact:true})).toBeDisabled();
    // App.returnToWorkshop uses history.replaceState and React state, not a
    // document navigation. Assert the held callback survives that UI transition.
    await viewer.getByRole('button',{name:'返回會員首頁',exact:true}).click();
    await expect(viewer.locator('.public-member-page')).toHaveCount(0);
    await expect(viewer.locator('.shell')).toBeVisible();
    expect(await viewer.evaluate(()=>(window as GateWindow).__cardCanvasGate?.pending)).toBe(1);
    await png.release();
    expect(downloads).toHaveLength(0);
    await expect(viewer.getByText('名片圖片已產生。更新連結後，請重新下載。',{exact:true})).toHaveCount(0);
  }finally{
    if(!viewer.isClosed())await viewer.close();
    if(labels)await labels.dispose();
    if(png)await png.dispose();
    viewer.off('download',onDownload);
  }
});
