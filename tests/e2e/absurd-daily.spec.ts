import sharp from 'sharp';
import {test,expect,type Page,type Route} from './fixtures.js';
import {navigate} from './navigation.js';
import {cashDeck,stampTarget} from '../../apps/portal-web/src/games/domain.js';
import {GAME_HANDOFF_EVENT,GAME_HANDOFF_KEY,type GameDraft} from '../../apps/portal-web/src/games/result-bridge.js';

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
  await expect(page).toHaveTitle('離譜日常 · 自由工坊');
  await expect(page.locator('.fw-arcade-root')).toBeVisible();
  await expect(page.locator('.fw-arcade-header')).toBeVisible();
  await expect(page.locator('.fw-arcade-footer')).toBeVisible();
  await expect(page.locator('.fw-arcade-game-card')).toHaveCount(3);
  // Negative control proves the filter is effective, not silently absent.
  await page.evaluate(()=>{const el=document.createElement('div');el.className='ad-root';el.id='cosmetic-control';el.textContent='synthetic filter control';document.body.append(el);});
  await expect(page.locator('#cosmetic-control')).toBeHidden();
  await page.locator('#cosmetic-control').evaluate(el=>el.remove());
  {
    await page.getByRole('button',{name:action+' →',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`[?]game=${game}&seed=`));
    await expect(page.locator('[data-game-stage="ready"]')).toBeVisible({timeout:15_000});
    await expect(page.locator('.fw-arcade-controls')).toBeVisible();
    await expect(page.getByRole('dialog',{name:'遊戲全螢幕'})).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'← 遊樂場',exact:true}).click();
    await expect(page.locator('.fw-arcade-game-card')).toHaveCount(3);
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
    await expect(page.locator('.fw-arcade-welcome h1')).toBeFocused();
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  }
  expect(writes).toEqual([]);
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
async function expectResultInNativeFullscreen(page:Page){
  for (const name of ['系統分享圖片／連結','複製同題挑戰連結']) {
    const control=page.getByRole('button',{name,exact:true});
    await expect(control).toBeVisible();
    expect(await control.evaluate(el => !!document.fullscreenElement?.contains(el))).toBe(true);
  }
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
  await page.locator('.fw-arcade-photo-choices button').first().click();
  await expect(page.locator('.fw-arcade-photo-choices [aria-pressed="true"]')).toHaveCount(1);
  await page.getByRole('button',{name:'退出全螢幕'}).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.evaluate(() => Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false}));
  await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
  const viewportResult=page.getByRole('dialog',{name:'遊戲全螢幕'});
  await expect(viewportResult.getByRole('button',{name:'系統分享圖片／連結'})).toBeVisible();
  await expect(viewportResult.getByRole('button',{name:'複製同題挑戰連結'})).toBeVisible();
  await viewportResult.getByRole('button',{name:'退出全螢幕'}).click();
  await expect(page.locator('.fw-arcade-photo-choices [aria-pressed="true"]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'下載完整成果 PNG'}).click();
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
    if(i<11)await expect(page.locator('.fw-arcade-counter')).toHaveText(`${i+1}/12`);
  }
  await expect(page.locator('.fw-arcade-result-heading')).toContainText('完成 12 份文件');
  await expect(page.getByRole('region',{name:'遊戲成果'})).toBeFocused();
  await expectResultInNativeFullscreen(page);
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.fullscreenElement?.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(page.getByRole('button',{name:'系統分享圖片／連結'})).toBeVisible();
  await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.getByRole('button',{name:'同一題再來一次'}).click();
  await expect(page.locator('.fw-arcade-board')).toBeFocused();
  expect(await page.evaluate(() => !!document.fullscreenElement?.contains(document.activeElement))).toBe(true);
});

// Hosted #1044 exhausted 120s after ~108s in the first 29 input/clock pairs.
// Budget both full cash rounds for recovery/share assertions before teardown;
// retain desktop rendering, real inputs, and all individual assertion deadlines.
test('AD-5 sort exact million, recover denied storage, cancel system share, and hand off without a post',async({page})=>{
  test.setTimeout(180_000);await installCosmeticFilters(page);await openGame(page,'cash');await enterNativeFullscreen(page);const posts:string[]=[];
  page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  const deck=cashDeck(42);await page.keyboard.press(deck[0].valid?'ArrowLeft':'ArrowRight');
  await expect(page.getByText('這張分錯了，退回來重新看看。',{exact:true})).toBeVisible();await page.clock.fastForward(180);
  for(const card of deck){await page.keyboard.press(card.valid?'ArrowRight':'ArrowLeft');await page.clock.fastForward(175);}
  await expect(page.locator('.fw-arcade-result')).toBeVisible();
  await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible();
  await expect(page.locator('.fw-arcade-result-heading')).toContainText('100 萬道具鈔 · 退回 6 張票券');
  await expect(page.getByRole('region',{name:'遊戲成果'})).toBeFocused();
  await expectResultInNativeFullscreen(page);
  await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:async(payload:ShareData)=>{(window as unknown as {sharePayload:unknown}).sharePayload={text:payload.text,type:payload.files?.[0]?.type};throw new DOMException('cancel','AbortError');}});
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});
  });
  await page.getByRole('button',{name:'系統分享圖片／連結',exact:true}).click();
  await expect(page.getByText('已取消分享，成果仍在這裡。',{exact:true})).toBeVisible();
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
  await expect(page.locator('.fw-arcade-notice')).toContainText('完成次數不會重算');
  await expect(page.locator('.fw-arcade-controls .fw-arcade-meta')).toContainText('已分類 30 / 30');
  await expect(page.locator('.fw-arcade-result-heading')).toHaveCount(0);
  await page.getByRole('button',{name:'重試產生成果圖片',exact:true}).click();
  await expect(page.locator('.fw-arcade-result-heading')).toContainText('100 萬道具鈔 · 退回 6 張票券');
  const image=page.locator('.fw-arcade-result-photo > img');
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
  await page.route(/\/assets\/stage-[^/]+\.js(?:\?.*)?$/,route=>{capture(route);});
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
  await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();
  await page.getByRole('button',{name:'← 遊樂場',exact:true}).click();await expect(page.locator('.fw-arcade-stage canvas')).toHaveCount(0);
  await expect(page.locator('.fw-arcade-game-card')).toHaveCount(3);
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
    if (game === 'cash') await page.getByRole('button',{name:cashDeck(42)[0].valid?'收道具鈔 →':'← 退票券'}).click();
    const before = await counter.textContent();
    const progress = game === 'photo' ? page.getByRole('button',{name:'拍照快門'}) : game === 'stamp' ? counter : page.locator('.fw-arcade-controls .fw-arcade-meta');
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
  await page.getByRole('button',{name:'開始這一局'}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'下一位客人 →'}).click();
  await page.getByRole('button',{name:'下一位客人 →'}).click();
  await page.getByRole('button',{name:'挑選照片'}).click();
  await expect(page.getByText('這局還沒拍到照片。再開一次照相館，按快門留下怪事。')).toBeVisible();
  await page.getByRole('button',{name:'開始這一局'}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'← 遊樂場'}).click();
  await expect(page.locator('.fw-arcade-game-card')).toHaveCount(3);
  await expect(page.locator('.fw-arcade-welcome h1')).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('fallback keeps keyboard focus inside game, result and replay', async ({page}) => {
  test.setTimeout(120_000);
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
  const last=dialog.getByRole('button',{name:'回遊樂場'});
  await last.focus(); await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button',{name:'退出全螢幕'})).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(last).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(result).toBeVisible();
  await page.getByRole('button',{name:'⛶ 全螢幕'}).click();
  await page.getByRole('button',{name:'同一題再來一次'}).click();
  await expect(page.locator('.fw-arcade-board')).toBeFocused();
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
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
    await page.getByRole('button',{name:'開始這一局'}).click();
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
    await page.getByRole('button',{name:'← 遊樂場',exact:true}).click();
    await expect(page.locator('.fw-arcade-game-card')).toHaveCount(3);
    await page.evaluate(()=>(window as unknown as {releaseFullscreen:()=>void}).releaseFullscreen());
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
    await expect(page.getByRole('dialog',{name:'遊戲全螢幕'})).toHaveCount(0);
    await expect(page.locator('.fw-arcade-welcome h1')).toBeFocused();
    expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
    await expect(page.locator('.fw-arcade-game-card').first()).toBeVisible();
  });
}
