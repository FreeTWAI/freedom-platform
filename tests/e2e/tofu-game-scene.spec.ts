import {test,expect,type Page,type Route} from './fixtures.js';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {actParty,advanceParty,newParty,startParty,tofuAxis,tofuPosition,type TofuRun} from '../../apps/portal-web/src/games/party/domain.js';
import {PARTY_RULES as PT} from '../../apps/portal-web/src/games/party/catalog.js';
import {partyElapsed,partyAdvance,blockPartyWebGL,socialEntries,holidayControlHit,partyPaintedContentFailures,partyFullViewportComposition,partyCoveredToolsBounds,partyScrollPaintedStageIntoView,holidayModalTextScale} from './helpers/party-scene.js';

// PT-TOFU-SCENE: the same real domain runs inside the bounded party shell.
async function tofuFullscreen(page:Page,rejected:boolean){
  const stage=page.locator('.fullscreen-game--tofu[data-game-stage]');
  await expect(stage).toHaveAttribute('role','dialog');
  if(rejected){await expect(stage).toHaveClass(/fullscreen-game--viewport/);expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();}
  else await expect.poll(()=>stage.evaluate(el=>document.fullscreenElement===el)).toBe(true);
}
// Read-only frame clock for pre-pause aiming; tests never use it after a pause.
// Recovery tests inspect retained production state instead of advancing this mirror.
const tofuClocks=new WeakMap<Page,{state:TofuRun;elapsed:()=>Promise<number>}>();
async function openTofuScene(page:Page,light:boolean,rejected:boolean){
  if(rejected)await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Synthetic fullscreen rejection','NotAllowedError'));});
  if(light)await blockPartyWebGL(page);
  await page.clock.install({time:new Date('2026-10-25T00:00:00Z')});await page.goto('/play?game=tofu&seed=42');
  if(light){await expect(page.getByRole('alert')).toContainText('無法開啟 3D 場景');await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();}
  await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','ready');
  await page.clock.pauseAt(new Date('2026-10-25T00:01:00Z'));await page.getByRole('button',{name:'開始派對！',exact:true}).click();
  const probe=await page.evaluateHandle(()=>{const record={first:null as number|null,at:0};const sample=(at:number)=>{record.first??=at;record.at=at;requestAnimationFrame(sample);};requestAnimationFrame(sample);return record;});
  tofuClocks.set(page,{state:startParty(newParty('tofu',42)) as TofuRun,elapsed:()=>probe.evaluate(r=>r.first===null?0:r.at-r.first)});
  await tofuFullscreen(page,rejected);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-mode',light?'light':'3d');
  await expect(page.locator('.pt-canvas canvas')).toHaveCount(light?0:1);
  if(!light)expect(Number(await page.locator('.pt-canvas').getAttribute('data-render-triangles'))).toBeGreaterThan(0);
  expect(await page.locator('.pt-tofu-controls').evaluate(el=>!el.closest('.pt-canvas')&&!!el.closest('.pt-tofu-stage'))).toBe(true);
}
async function tofuTextScale(page:Page,scale:number){
  const stage=page.locator('.fullscreen-game--tofu[data-game-stage]');
  await stage.evaluate((root,factor)=>{
    const el=root as HTMLElement;for(const [side,value]of Object.entries({top:12,right:16,bottom:18,left:14}))el.style.setProperty(`--tofu-safe-${side}`,`${value}px`);
    // Text-only enlargement is deliberate; this does not claim browser zoom.
    const nodes=[root,...root.querySelectorAll('*')].filter((n):n is HTMLElement=>n instanceof HTMLElement).map(n=>({n,font:parseFloat(getComputedStyle(n).fontSize),line:parseFloat(getComputedStyle(n).lineHeight)}));
    for(const {n,font,line}of nodes){n.style.fontSize=`${font*factor}px`;if(Number.isFinite(line))n.style.lineHeight=`${line*factor}px`;}
  },scale);
}
async function tofuStageBounds(page:Page,scale=1){
  const stage=page.locator('.fullscreen-game--tofu[data-game-stage]');
  expect(await stage.evaluate(root=>{
    const outer=root.getBoundingClientRect(),bad:string[]=[];
    if(outer.left<0||outer.top<0||outer.right>innerWidth+1||outer.bottom>innerHeight+1)bad.push('owner');
    for(const selector of ['.fullscreen-game__bar','.pt-tofu-stage','.pt-scoreboard','.pt-holiday-field','.pt-tofu-controls']){
      const el=root.querySelector<HTMLElement>(selector);if(el&&getComputedStyle(el).display==='contents')continue;if(!el||!el.checkVisibility()){bad.push(`missing:${selector}`);continue;}const b=el.getBoundingClientRect();
      if(b.left<outer.left-1||b.top<outer.top-1||b.right>outer.right+1||b.bottom>outer.bottom+1)bad.push(selector);
    }return bad;
  })).toEqual([]);
  // Before scrolling, prove full-owner render coverage and an independently
  // unobscured canonical gameplay core; retain real safe-area control hit tests.
  expect(await stage.evaluate(partyFullViewportComposition,scale)).toEqual([]);
  expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
  const box=await page.locator('.pt-gameplay-core').boundingBox(),diagnostic=`Tofu gameplay core actual rect: ${JSON.stringify(box)}`;
  expect(box,diagnostic).not.toBeNull();
  // A 4:3 sliver is not a usable world. This floor prevents near-disappearance,
  // but does not establish art quality or human playability acceptance.
  expect(box!.width,`${diagnostic}; minimum width is 128 CSS px`).toBeGreaterThanOrEqual(128);
  expect(box!.height,`${diagnostic}; minimum height is 96 CSS px`).toBeGreaterThanOrEqual(96);
  expect(box!.width/box!.height,`${diagnostic}; gameplay core must remain 4:3`).toBeCloseTo(4/3,2);
  if(scale===2&&page.viewportSize()?.width===667&&page.viewportSize()?.height===375&&await stage.getAttribute('role')==='dialog'){
    // d141 / run 42533847998 original Tofu JSON: 128×96 CSS px in both modes.
    // Require >=50% more height (>=125% more area), not the old token-size floor.
    expect(box!.height,`${diagnostic}; reclaim the historical Tofu status lane`).toBeGreaterThanOrEqual(96*1.5);
  }
  for(const owner of [stage,page.locator('.pt-holiday-world')]){
    const bounds=(await owner.boundingBox())!;expect(box!.x,diagnostic).toBeGreaterThanOrEqual(bounds.x-1);expect(box!.y,diagnostic).toBeGreaterThanOrEqual(bounds.y-1);expect(box!.x+box!.width,diagnostic).toBeLessThanOrEqual(bounds.x+bounds.width+1);expect(box!.y+box!.height,diagnostic).toBeLessThanOrEqual(bounds.y+bounds.height+1);
  }
  const lightWorld=page.locator('[data-light-world=tofu]');
  if(await lightWorld.count()){const svg=(await lightWorld.boundingBox())!,host=(await page.locator('.pt-canvas').boundingBox())!;for(const key of ['x','y','width','height'] as const)expect(svg[key],`light world ${key} must map to the empty pointer host`).toBeCloseTo(host[key],1);}
  expect(await page.locator('.pt-canvas').evaluate(host=>host.querySelectorAll('button,a,svg').length)).toBe(0);
}
async function tofuWaitOffset(page:Page,accept:(offset:number)=>boolean){
 const clock=tofuClocks.get(page)!;
 for(let i=0;i<500;i++){const elapsed=await clock.elapsed();while(clock.state.elapsed<elapsed&&clock.state.status==='playing')clock.state=advanceParty(clock.state,elapsed-clock.state.elapsed) as TofuRun;expect(clock.state.status).toBe('playing');const axis=tofuAxis(clock.state),offset=Math.abs(tofuPosition(clock.state)[axis]-clock.state.layers.at(-1)![axis]);if(accept(offset))return;await page.clock.runFor(16);}
 throw Error('Actual moving tofu did not reach the requested timing window');
}
async function tofuDrop(page:Page,method:'pointer'|'keyboard'|'host'='pointer'){
 const drop=page.getByRole('button',{name:'豆腐落下！',exact:true});
 if(method==='host'){const b=(await page.locator('.pt-gameplay-core').boundingBox())!;await page.mouse.click(b.x+b.width/2,b.y+b.height/2);}else if(method==='keyboard')await drop.press('Space');else await drop.click();
 const clock=tofuClocks.get(page)!;clock.state=actParty(clock.state,{kind:'drop'}) as TofuRun;expect(clock.state.fall).not.toBeNull();
 await expect(page.getByRole('button',{name:'豆腐降落中…',exact:true})).toBeDisabled();
}
for(const light of [false,true])for(const rejected of [false,true])test(`PT-TOFU-SCENE: ${light?'light':'native'} complete twelve earned layers in ${rejected?'rejected':'native'} fullscreen, retry real capture and replay same seed`,async({page},testInfo)=>{
  // Full native RAF/input/capture/replay measured ~54–56s; keep light unchanged.
  if(!light)test.setTimeout(150_000);
  const errors:string[]=[],writes:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  await page.setViewportSize({width:390,height:844});await openTofuScene(page,light,rejected);
  const evidence=async(phase:string)=>{
    const name=`tofu-${light?'light':'native'}-${rejected?'rejected':'fullscreen'}-${phase}`;
    await testInfo.attach(`${name}.json`,{body:JSON.stringify({ciSourceSha:process.env.GITHUB_SHA??null,phase,world:await page.locator('.pt-canvas').boundingBox(),gameplayCore:await page.locator('.pt-gameplay-core').boundingBox(),score:await page.locator('.pt-root').getAttribute('data-party-score'),elapsed:await partyElapsed(page)},null,2),contentType:'application/json'});
    await testInfo.attach(`${name}.png`,{body:await page.screenshot(),contentType:'image/png'});
  };
  await evidence('early');await tofuStageBounds(page);
  for(let layer=0;layer<PT.tofuGoal;layer++){
    if(layer===10||layer===11){
      // Reuse this earned twelve-layer journey. Enlarge its late HUD and inspect
      // both real X/Z travel extremes before the original perfect timing action.
      if(layer===10)await tofuTextScale(page,2);
      await tofuWaitOffset(page,offset=>offset>2.6);await evidence(`layer-${layer}-extreme-200-percent`);await tofuStageBounds(page,2);
    }
    await tofuWaitOffset(page,offset=>offset<.055);const before=await page.locator('.pt-root').getAttribute('data-party-score');await tofuDrop(page,layer%3===0?'pointer':layer%3===1?'keyboard':'host');
    await page.locator('.pt-canvas').press('Space');await page.clock.runFor(250);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',before!);await expect(page.locator(`.pt-scoreboard strong[aria-label^="完成 ${layer} / 12 層，"]`)).toBeVisible();
    if(light){const progress=Number(await page.locator('[data-light-world=tofu]').getAttribute('data-fall-progress'));expect(progress).toBeGreaterThan(.4);expect(progress).toBeLessThan(.7);}
    if(layer===10||layer===11){await evidence(`layer-${layer+1}-falling-200-percent`);await tofuStageBounds(page,2);}
    await page.clock.runFor(280);await expect(page.locator(`.pt-scoreboard strong[aria-label^="完成 ${layer+1} / 12 層，"]`)).toBeVisible();await tofuFullscreen(page,rejected);
  }
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','done');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','2925');
  await evidence('completed-200-percent');
  const result=page.getByRole('button',{name:'查看這局成果',exact:true});await holidayControlHit(result);await tofuFullscreen(page,rejected);
  if(light){const downloading=page.waitForEvent('download');const svgLink=page.getByRole('link',{name:'下載本局成果 SVG',exact:true});await holidayControlHit(svgLink);await svgLink.click();const svg=readFileSync((await(await downloading).path())!,'utf8');for(const text of ['2925 分','疊了 12 層','12 次完美貼齊','同題 #42'])expect(svg).toContain(text);}
  else{
    await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...args){HTMLCanvasElement.prototype.toDataURL=original;throw Error('Synthetic tofu capture failure');};});
    await result.click();await expect(page.locator('.pt-feedback')).toContainText('圖片還沒產生');await expect(page.locator('.fw-arcade-result')).toHaveCount(0);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','2925');await evidence('capture-failure-200-percent');await partyCoveredToolsBounds(page);
  }
  await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toBlob,failed=new Set<string>();HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){const kind=type??'image/png';if(!failed.has(kind)){failed.add(kind);callback(null);return;}return original.call(this,callback,type,quality);};});
  await result.click();await expect(page.locator('.fw-arcade-result-heading')).toContainText('2925 分');await tofuFullscreen(page,rejected);
  await page.getByRole('button',{name:'重試產生成果圖',exact:true}).click();const jpegRetry=page.getByRole('button',{name:'重試準備工坊圖片',exact:true});await expect(jpegRetry).toBeEnabled();await jpegRetry.click();await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  const png=page.getByRole('link',{name:'下載完整成果 PNG',exact:true});await holidayControlHit(png);const downloading=page.waitForEvent('download');await png.click();const meta=await sharp((await(await downloading).path())!).metadata();expect([meta.format,meta.width,meta.height]).toEqual(['png',960,1200]);
  await page.getByRole('button',{name:'分享成果',exact:true}).click();await expect(page.locator('[data-game-share]')).toBeFocused();await socialEntries(page,'tofu');
  const replay=page.getByRole('button',{name:'同一題再來一次',exact:true});await holidayControlHit(replay);await replay.press('Enter');expect(new URL(page.url()).searchParams.get('seed')).toBe('42');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','ready');expect(writes).toEqual([]);expect(errors).toEqual([]);
});


for(const light of [false,true])for(const rejected of [false,true])test(`PT-TOFU-SCENE: ${light?'light':'native'} clipped overlap and three real misses finish and restart in ${rejected?'rejected':'native'} fullscreen`,async({page})=>{
 await openTofuScene(page,light,rejected);
 for(let i=0;i<2;i++){
  await tofuWaitOffset(page,o=>o>2.3&&o<2.4);await tofuDrop(page,i?'keyboard':'pointer');await page.clock.runFor(550);await expect(page.locator(`.pt-scoreboard strong[aria-label^="完成 ${i+1} / 12 層，"]`)).toBeVisible();
  await tofuStageBounds(page);
  if(light){const layer=page.locator(`[data-tofu-layer="${i+1}"]`);const size=Number(await layer.getAttribute(i?'data-depth':'data-width'));expect(size).toBeGreaterThan(.45);expect(size).toBeLessThan(.85);}
 }
 const score=await page.locator('.pt-root').getAttribute('data-party-score');expect(Number(score)).toBeGreaterThan(0);expect(Number(score)).toBeLessThan(100);
 for(let i=0;i<3;i++){await tofuWaitOffset(page,o=>o>1.3);await tofuDrop(page);await page.clock.runFor(250);await tofuStageBounds(page);await page.clock.runFor(300);await expect(page.locator('.pt-scoreboard strong[aria-label^="完成 2 / 12 層，"]')).toBeVisible();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);await tofuFullscreen(page,rejected);}
 await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','done');const at=await partyElapsed(page);await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);
 await page.getByRole('button',{name:'重新開始',exact:true}).click();await expect(page.getByRole('button',{name:'確定重來',exact:true})).toBeFocused();await page.getByRole('button',{name:'確定重來',exact:true}).press('Enter');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','ready');await expect(page.locator('.pt-scoreboard strong[aria-label^="完成 0 / 12 層，"]')).toBeVisible();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');await tofuFullscreen(page,rejected);
});
for(const light of [false,true])test(`PT-TOFU-SCENE: ${light?'light':'native'} cancelled secondary and held contacts cannot drop a later turn`,async({page})=>{
 await openTofuScene(page,light,true);const host=page.locator('.pt-canvas'),drop=page.getByRole('button',{name:'豆腐落下！',exact:true});await partyAdvance(page,250);
 await drop.click({button:'right'});await drop.dispatchEvent('pointerdown',{pointerId:91,isPrimary:false,button:0});await drop.dispatchEvent('pointerup',{pointerId:91,isPrimary:false,button:0});await drop.dispatchEvent('click',{detail:1});await expect(drop).toBeEnabled();
 await drop.dispatchEvent('pointerdown',{pointerId:92,isPrimary:true,button:0});await drop.dispatchEvent('pointercancel',{pointerId:92,isPrimary:true});await drop.dispatchEvent('pointerup',{pointerId:92,isPrimary:true,button:0});await drop.dispatchEvent('click',{detail:1});await expect(drop).toBeEnabled();
 await tofuWaitOffset(page,o=>o<.055);await tofuDrop(page);const box=(await page.locator('.pt-gameplay-core').boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.clock.runFor(550);await page.mouse.up();await expect(drop).toBeEnabled();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','165');
 // Tab from the host reaches the actual sibling drop button. Holding it while
 // opening help must never replay that old press after the explicit resume.
 await host.press('Tab');await expect(drop).toBeFocused();await page.keyboard.down('Space');const help=page.getByRole('button',{name:'玩法與設定',exact:true});await help.click();await page.keyboard.up('Space');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');const at=await partyElapsed(page);await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);await page.keyboard.press('Escape');await expect(help).toBeFocused();await tofuFullscreen(page,true);
 await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await expect(host).toBeFocused();await page.keyboard.up('Space');await expect(drop).toBeEnabled();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','165');
});
for(const rejected of [false,true])test(`PT-TOFU-SCENE: genuine context loss during landing preserves tower and explicit resume in ${rejected?'rejected':'native'} fullscreen`,async({page})=>{
 await openTofuScene(page,false,rejected);await tofuWaitOffset(page,o=>o<.055);await tofuDrop(page);await page.clock.runFor(200);
 const lost=await page.locator('.pt-canvas canvas').evaluate(c=>{const ext=(c as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context');ext?.loseContext();return !!ext;});expect(lost).toBe(true);await expect(page.getByRole('alert')).toContainText('本局已暫停');const at=await partyElapsed(page);await tofuFullscreen(page,rejected);
 await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);const view=page.locator('[data-light-world=tofu]');expect(Number(await view.getAttribute('data-fall-progress'))).toBeGreaterThan(0);await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);
 await page.getByRole('button',{name:'重試 3D，保留這局',exact:true}).click();await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','ready');await expect(page.locator('.pt-canvas canvas')).toHaveCount(1);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');expect(await partyElapsed(page)).toBe(at);await tofuFullscreen(page,rejected);await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await expect(page.locator('.pt-canvas')).toBeFocused();await page.clock.runFor(550);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','165');await expect(page.locator('.pt-scoreboard strong[aria-label^="完成 1 / 12 層，"]')).toBeVisible();
});

for(const light of [false,true])for(const rejected of [false,true])for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375},{width:1440,height:900}])for(const scale of [1,1.25,2])test(`PT-TOFU-SCENE: ${light?'light':'native'} ${rejected?'rejected':'native'} ${viewport.width}x${viewport.height} ${scale*100}% text safe insets, real controls and modal reachability`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);await openTofuScene(page,light,rejected);const stage=page.locator('.fullscreen-game--tofu[data-game-stage]');
  const attachWorldEvidence=async(phase:'playing'|'resumed'|'normal')=>{
    if(scale!==2||viewport.width===1440)return;
    const name=`tofu-${light?'light':'native'}-${rejected?'rejected':'fullscreen'}-${viewport.width}x${viewport.height}-200-percent-${phase}`;
    // Capture before bounds assertions so a failing world retains its real
    // dimensions and viewport pixels. These are browser artifacts, not mocks.
    await testInfo.attach(`${name}.json`,{body:JSON.stringify({ciSourceSha:process.env.GITHUB_SHA??null,viewport:page.viewportSize(),textScale:scale,phase,mode:light?'light':'native',fullscreen:phase==='normal'?'normal':rejected?'rejected':'native',minimumWorldCssPx:{width:128,height:96},world:await page.locator('.pt-canvas').boundingBox(),gameplayCore:await page.locator('.pt-gameplay-core').boundingBox(),stage:await stage.boundingBox()},null,2),contentType:'application/json'});
    await testInfo.attach(`${name}.png`,{body:await page.screenshot(),contentType:'image/png'});
  };
  await tofuTextScale(page,scale);
  await partyAdvance(page,250);await attachWorldEvidence('playing');await tofuStageBounds(page,scale);expect(await stage.evaluate(root=>{const style=getComputedStyle(root.querySelector('.pt-root')!);return ['top','right','bottom','left'].map(side=>parseFloat(style.getPropertyValue(`padding-${side}`)));})).toEqual([20,24,26,22]);
  const buttons=page.locator('.pt-tofu-controls button');await expect(buttons).toHaveCount(1);for(const button of await buttons.all())await holidayControlHit(button);
  await tofuWaitOffset(page,offset=>offset<.055);await tofuDrop(page,'pointer');await page.clock.runFor(550);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','165');
  if(light&&viewport.width<560){
    const retry=page.getByRole('button',{name:'重試 3D，保留這局',exact:true});await holidayControlHit(retry);
    const retryBox=(await retry.boundingBox())!,header=(await stage.locator('.pt-holiday-heading').boundingBox())!;
    expect(retryBox.y).toBeGreaterThanOrEqual(header.y-1);expect(retryBox.y+retryBox.height).toBeLessThanOrEqual(header.y+header.height+1);
    for(const button of await stage.locator('.fullscreen-game__bar button,.fullscreen-game__bar summary,.pt-holiday-heading button').all())await holidayControlHit(button);
  }
  const help=page.getByRole('button',{name:'玩法與設定',exact:true});await holidayControlHit(help);await help.click();const close=page.getByRole('button',{name:'回到遊戲',exact:true});await expect(close).toBeFocused();await holidayModalTextScale(page,scale);await holidayControlHit(close);const overlay=page.locator('.pt-holiday-overlay').filter({has:close});
  const at=await partyElapsed(page);await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);
  for(let i=0;i<8;i++){await page.keyboard.press(i<4?'Tab':'Shift+Tab');expect(await overlay.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
  await page.keyboard.press('Escape');await expect(help).toBeFocused();await tofuFullscreen(page,rejected);await partyCoveredToolsBounds(page);
  // Keep the original first/last reachability journey after the stricter no-scroll checks.
  const restart=page.getByRole('button',{name:'重新開始',exact:true}),last=page.getByRole('button',{name:light?'重試 3D，保留這局':'減少動態關',exact:true});await holidayControlHit(last);await holidayControlHit(restart);await restart.click();await holidayModalTextScale(page,scale);
  const confirm=page.getByRole('button',{name:'確定重來',exact:true}),keep=page.getByRole('button',{name:'保留這局',exact:true});await expect(confirm).toBeFocused();await holidayControlHit(confirm);await holidayControlHit(keep);await keep.press('Enter');await expect(restart).toBeFocused();await tofuFullscreen(page,rejected);
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await attachWorldEvidence('resumed');await tofuStageBounds(page,scale);await expect(page.locator('.pt-canvas')).toBeFocused();
  for(let i=0;i<16;i++){await page.keyboard.press(i<8?'Tab':'Shift+Tab');expect(await stage.evaluate(el=>el.contains(document.activeElement)&&!document.activeElement?.closest('[inert]'))).toBe(true);}
  await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();await expect(stage).not.toHaveAttribute('role','dialog');await partyScrollPaintedStageIntoView(stage);await attachWorldEvidence('normal');await tofuStageBounds(page,scale);
});

for(const rejected of [false,true])test(`PT-TOFU-SCENE: explicit light choice owns late native import in ${rejected?'rejected':'native'} fullscreen`,async({page})=>{
 if(rejected)await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Synthetic fullscreen rejection','NotAllowedError'));});
 const now=new Date('2026-10-25T00:00:00Z');await page.clock.install({time:now});await page.clock.pauseAt(new Date(now.getTime()+60_000));
 let capture!:(route:Route)=>void;const requested=new Promise<Route>(resolve=>{capture=resolve;});await page.route(/\/assets\/stage-(?!batch-)[^/]+\.js(?:\?.*)?$/,route=>{capture(route);});
 await page.goto('/play?game=tofu&seed=42',{waitUntil:'domcontentloaded'});const route=await requested,response=await route.fetch(),url=route.request().url();await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','loading');
 await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();await page.getByRole('button',{name:'開始派對！',exact:true}).click();await tofuFullscreen(page,rejected);await partyAdvance(page,300);const at=await partyElapsed(page),offset=await page.locator('[data-light-world=tofu]').getAttribute('data-offset');
 await route.fulfill({response});await page.evaluate(async moduleUrl=>{await import(moduleUrl);},url);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-mode','light');await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);expect(await partyElapsed(page)).toBe(at);await expect(page.locator('[data-light-world=tofu]')).toHaveAttribute('data-offset',offset!);await tofuFullscreen(page,rejected);
 await page.getByRole('button',{name:'豆腐落下！',exact:true}).press('Enter');await expect(page.getByRole('button',{name:'豆腐降落中…',exact:true})).toBeDisabled();await page.clock.runFor(550);await expect(page.locator('[data-light-world=tofu]')).toHaveAttribute('data-turn','1');await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);
});
// Bounded browser-process evidence only. No frame skipping, readback or GPU flush.
async function traceNativeTofuClockChunk(page:Page,prefix='tofu-idle-first-second'){
 const session=await page.context().browser()!.newBrowserCDPSession();
 const failures:unknown[]=[],parts:Buffer[]=[];let handle:string|undefined,started=false,guardStopped=false,bytes=0;
 let timer:ReturnType<typeof setTimeout>|undefined,stop:Promise<void>|undefined;
 const completed=new Promise<{stream?:string;dataLossOccurred:boolean}>(resolve=>session.once('Tracing.tracingComplete',resolve));
 const bounded=async<T,>(operation:Promise<T>,label:string,ms=5000)=>{let timeout:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(Error(`Native trace ${label} deadline`)),ms);})]);}finally{if(timeout)clearTimeout(timeout);}};
 const end=()=>stop??=(async()=>{if(started)await bounded(session.send('Tracing.end'),'stop');})();
 const wanted=['gpu','viz','cc','renderer.scheduler','devtools.timeline','toplevel','disabled-by-default-gpu.service'];
 let categories:string[]=[],complete=false,dataLoss=false,clockCompleted=false;const begin=process.hrtime.bigint();
 try{
  const available=(await session.send('Tracing.getCategories')).categories;categories=wanted.filter(c=>available.includes(c));
  if(!categories.length)throw Error('Native tracing categories unavailable');
  await session.send('Tracing.start',{transferMode:'ReturnAsStream',streamFormat:'json',traceConfig:{recordMode:'recordUntilFull',traceBufferSizeInKb:8192,enableArgumentFilter:true,includedCategories:categories}});started=true;
  timer=setTimeout(()=>{guardStopped=true;void end().catch(error=>failures.push(error));},12000);
  try{await page.clock.runFor(1000);clockCompleted=true;}catch(error){failures.push(error);}
  finally{if(timer)clearTimeout(timer);await end();}
  const result=await bounded(completed,'completion');handle=result.stream;dataLoss=result.dataLossOccurred;
  if(!handle)throw Error('Native trace stream missing');
  await bounded((async()=>{for(;;){
   const chunk=await session.send('IO.read',{handle,size:65536});
   const data=Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8');bytes+=data.length;
   if(bytes>32*1024*1024)throw Error('Native trace exceeded bounded 32MiB output');
   parts.push(data);if(chunk.eof){complete=true;break;}
  }})(),'stream drain',5000);
  await test.info().attach(`${prefix}-browser-trace.json`,{body:Buffer.concat(parts),contentType:'application/json'});
 }catch(error){failures.push(error);}
 finally{
  if(timer)clearTimeout(timer);
  try{await end();}catch(error){failures.push(error);}
  if(handle)try{await bounded(session.send('IO.close',{handle}),'stream close',2000);}catch(error){failures.push(error);}
  try{await bounded(session.detach(),'detach',2000);}catch(error){failures.push(error);}
 }
 try{await test.info().attach(`${prefix}-browser-trace-status.json`,{body:Buffer.from(JSON.stringify({
  scope:'Bounded instrumented browser trace; not GPU-time, FPS or performance acceptance',
  head:process.env.HEAD_SHA??null,run:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null,
  categories,diagnostic_total_wall_ms:Number(process.hrtime.bigint()-begin)/1e6,bytes,complete,dataLoss,guardStopped,clockCompleted,wholeWindow:clockCompleted&&complete&&!dataLoss&&!guardStopped&&failures.length===0,errors:failures.map(String),
 })),contentType:'application/json'});}catch(error){failures.push(error);}
 if(failures.length)throw failures[0];
 return {wholeWindow:clockCompleted&&complete&&!dataLoss&&!guardStopped,complete,dataLoss,guardStopped,clockCompleted,bytes};
}

for(const light of [false,true])test(`PT-TOFU-SCENE: ${light?'light':'native'} sixty-second idle expiry keeps zero score and no invented tower`,async({page})=>{
 // Keep the original native idle deadline. Hosted 0e95383e trace took about
 // 7.87s per simulated second; profiling below diagnoses, not relaxes, that
 // workload. Game, draw rate, light budget and terminal assertions stay intact.
 if(!light)test.setTimeout(180_000);
 await openTofuScene(page,light,true);
 if(!light){
  // Measure the first three ordinary clock chunks, not extra game time. Save
  // diagnostics before the existing deadline can close the page. CPU samples
  // distinguish JS work from waiting; they do not establish GPU performance.
  const session=await page.context().newCDPSession(page);const failures:unknown[]=[];
  try{
   await session.send('Performance.enable');await session.send('Profiler.enable');
   const before=await session.send('Performance.getMetrics');
   await session.send('Profiler.start');const start=process.hrtime.bigint();
   try{await traceNativeTofuClockChunk(page);for(let i=1;i<3;i++)await page.clock.runFor(1000);}catch(error){failures.push(error);}
   const wall_ms=Number(process.hrtime.bigint()-start)/1e6;
   try{
    const {profile}=await session.send('Profiler.stop');
    await test.info().attach('tofu-idle-first-three-seconds.cpuprofile',{body:Buffer.from(JSON.stringify(profile)),contentType:'application/json'});
    const after=await session.send('Performance.getMetrics');
    await test.info().attach('tofu-idle-first-three-seconds-metrics.json',{body:Buffer.from(JSON.stringify({
     scope:'First three scheduled native idle chunks; first chunk includes browser tracing setup/drain; see actual elapsed. Includes all diagnostic overhead, not performance acceptance',
     wall_ms,before:before.metrics,after:after.metrics,
     elapsed:await partyElapsed(page),render:await page.locator('.pt-canvas').evaluate(el=>({...((el as HTMLElement).dataset)})),
    })),contentType:'application/json'});
   }catch(error){failures.push(error);}
  }catch(error){failures.push(error);}
  finally{try{await session.detach();}catch(error){failures.push(error);}}
  // Preserve the original clock/setup error instead of replacing it with a
  // later evidence/cleanup failure; diagnostic failures are never a pass.
  if(failures.length)throw failures[0];
 }
 await partyAdvance(page,PT.tofuMs);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','done');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');await expect(page.locator('.pt-scoreboard strong[aria-label^="完成 0 / 12 層，"]')).toBeVisible();expect(await partyElapsed(page)).toBe(PT.tofuMs);await tofuFullscreen(page,true);
});

// Test-only one-pixel readback, NOT a pure raster fence. Chromium 153's
// WebGL finish() intentionally only flushes. A synchronous readPixels includes
// preceding work, any required resolve and a small copy; compare its time with
// the subsequent compositor readback, without adding nested/overlapping spans.
// https://chromium.googlesource.com/chromium/src/+/refs/tags/153.0.8010.12/third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc
function installTofuReadbackProbe(options:boolean|{suppressShadow:boolean}){
 const shadowExperiment=typeof options==='object',suppressShadow=shadowExperiment&&options.suppressShadow,readback=!shadowExperiment&&options===true;
 const host=document.querySelector('.pt-canvas')!,canvas=host.querySelector('canvas')!;
 const gl=canvas.getContext('webgl2')!;
 if(!gl)throw Error('Paired diagnostic requires the existing native WebGL2 context');
 const now=performance.now.bind(performance); // capture before Playwright clock installation
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 const device={vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),
  unmaskedVendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,unmaskedRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,
  attributes:gl.getContextAttributes(),hardwareConcurrency:navigator.hardwareConcurrency,dpr:devicePixelRatio,width:canvas.width,height:canvas.height,visibility:document.visibilityState};
 const packNames:number[]=[gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS];
 // Queries happen outside the measured window: querying GL error/state in
 // every callback could itself synchronize the command stream in BOTH arms.
 const readState=()=>({framebuffer:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),packBuffer:gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),readBuffer:gl.getParameter(gl.READ_BUFFER),pack:packNames.map(name=>gl.getParameter(name))});
 const state=readState(),describe=(value:typeof state)=>({defaultFramebuffer:value.framebuffer===null,unboundPackBuffer:value.packBuffer===null,defaultReadBuffer:value.readBuffer===gl.BACK,pack:value.pack.slice()});
 const valid=()=>state.framebuffer===null&&state.packBuffer===null&&state.readBuffer===gl.BACK&&state.pack[0]===4&&state.pack.slice(1).every(value=>value===0);
 const readBuffers=new Map<unknown,unknown>([[state.framebuffer,state.readBuffer]]);
 const initialGlError=gl.getError();if(initialGlError!==gl.NO_ERROR)throw Error(`Pre-existing diagnostic GL error ${initialGlError}`);
 const drawNames=['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'] as const;
 const names=[...drawNames,'bindFramebuffer','bindBuffer','pixelStorei','readBuffer','viewport'] as const;
 const originals=names.map(name=>({name,own:Object.getOwnPropertyDescriptor(gl,name),fn:gl[name]}));
 const drawState={framebuffer:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),viewport:Array.from(gl.getParameter(gl.VIEWPORT)??[]) as number[]};
 let rafToken=0,frameWork:null|{token:number;offscreenAttempted:number;offscreenExecuted:number;mainDraws:number;targets:Set<unknown>;segments:number}=null;
 const samples:{work?:{token:number;offscreenAttempted:number;offscreenExecuted:number;mainDraws:number;targets:number;segments:number};frame:number;drawCalls:number;probeWallMs:number|null;pixel:number[]|null;validReadState:boolean}[]=[];
 const pixel=new Uint8Array(4);let baseline={...device},baselineState=describe(state);
 let draws=0,frames=0,overflow=false,active=false,originalRaf:typeof requestAnimationFrame|undefined;
 const errors:string[]=[];
 for(const {name,fn} of originals)Object.defineProperty(gl,name,{configurable:true,writable:true,value:function(...args:unknown[]){
  if(shadowExperiment&&active&&(drawNames as readonly string[]).includes(name)){
   if(!frameWork){errors.push('Draw outside wrapped RAF');throw Error(errors.at(-1));}
   if(drawState.framebuffer!==null){
    if(JSON.stringify(drawState.viewport)!=='[0,0,512,512]'){errors.push('Unexpected offscreen viewport');throw Error(errors.at(-1));}
    frameWork.offscreenAttempted++;frameWork.targets.add(drawState.framebuffer);
    if(suppressShadow){draws++;return;}
    frameWork.offscreenExecuted++;
   }else frameWork.mainDraws++;
  }
  const result=Reflect.apply(fn,gl,args);
  if(name==='bindFramebuffer'&&(args[0]===gl.FRAMEBUFFER||args[0]===gl.DRAW_FRAMEBUFFER)){
   if(frameWork&&drawState.framebuffer===null&&args[1]!==null)frameWork.segments++;
   drawState.framebuffer=args[1];
  }
  if(name==='viewport')drawState.viewport=args as number[];
  if((drawNames as readonly string[]).includes(name)){if(active)draws++;}
  else if(name==='bindFramebuffer'&&(args[0]===gl.FRAMEBUFFER||args[0]===gl.READ_FRAMEBUFFER)){state.framebuffer=args[1];state.readBuffer=readBuffers.get(args[1]);}
  else if(name==='bindBuffer'&&args[0]===gl.PIXEL_PACK_BUFFER)state.packBuffer=args[1];
  else if(name==='pixelStorei'){const index=packNames.indexOf(args[0] as number);if(index>=0)state.pack[index]=args[1];}
  else if(name==='readBuffer'){state.readBuffer=args[0];readBuffers.set(state.framebuffer,args[0]);}
  return result;
 }});
 const api={device,start(){
  if(originalRaf)throw Error('Diagnostic already started');
  originalRaf=window.requestAnimationFrame;active=true;
  window.requestAnimationFrame=function(callback){return originalRaf!.call(window,time=>{
   const before=draws;const work={token:++rafToken,offscreenAttempted:0,offscreenExecuted:0,mainDraws:0,targets:new Set<unknown>(),segments:0};
   frameWork=work;try{callback.call(window,time);}finally{frameWork=null;}const count=draws-before;
   if(active&&count){
    frames++;let probeWallMs:number|null=null,copy:number[]|null=null;const validReadState=valid();
    try{
     if(!validReadState)throw Error('Diagnostic read framebuffer or pixel-pack state is not the expected default');
     if(readback){const begin=now();try{gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);copy=Array.from(pixel);}finally{probeWallMs=now()-begin;}}
    }catch(error){errors.push(String(error));throw error;}
    finally{if(samples.length<120)samples.push({work:shadowExperiment?{...work,targets:work.targets.size}:undefined,frame:frames,drawCalls:count,probeWallMs,pixel:copy,validReadState});else overflow=true;}
   }
  });};
 },mark(){draws=0;frames=0;samples.length=0;baseline={...device,dpr:devicePixelRatio,width:canvas.width,height:canvas.height,visibility:document.visibilityState};baselineState=describe(state);
 },read(){
  active=false;const actualState=readState(),glError=gl.getError(),stateTrackingMatches=JSON.stringify(describe(state))===JSON.stringify(describe(actualState));
  if(glError!==gl.NO_ERROR)errors.push(`Diagnostic GL error ${glError}`);if(!stateTrackingMatches)errors.push('Diagnostic GL state tracking mismatch');
  return {readback,shadowExperiment,suppressShadow,frames,draws,samples,unwrappedDraws:draws-samples.reduce((total,sample)=>total+sample.drawCalls,0),overflow,errors,glError,stateTrackingMatches,baselineState,finalState:describe(actualState),contextLost:gl.isContextLost(),device:baseline,
   after:{dpr:devicePixelRatio,width:canvas.width,height:canvas.height,visibility:document.visibilityState}};
 },restore(){active=false;if(originalRaf)window.requestAnimationFrame=originalRaf;for(const {name,own} of originals){if(own)Object.defineProperty(gl,name,own);else delete (gl as unknown as Record<string,unknown>)[name];}}};
 (window as unknown as {__tofuReadbackProbe:typeof api}).__tofuReadbackProbe=api;
}

for(const shadowExperiment of [false,true])for(const order of ['AB','BA'] as const)test(`PT-TOFU-DIAGNOSTIC: paired ${shadowExperiment?'shadow-draw suppression':'one-pixel readback'} ${order} is not performance acceptance`,async({browser,baseURL,viewport,deviceScaleFactor},testInfo)=>{
 // Two short arms fit the existing default deadline; no timeout/launch changes.
 // Fresh isolated contexts for every arm, identical source/seed/viewport/DPR.
 const prefix=shadowExperiment?'tofu-shadow-suppression':'tofu-readback';
 const rows:Record<string,unknown>[]=[];const failures:unknown[]=[];
 const diagnosticViewport=viewport??{width:1280,height:720},diagnosticDpr=deviceScaleFactor??1;
 for(const arm of order){
  const context=await browser.newContext({baseURL,viewport:diagnosticViewport,deviceScaleFactor:diagnosticDpr,reducedMotion:'no-preference'});
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let installed=false;const row:Record<string,unknown>={arm,shadowExperiment,suppressShadow:shadowExperiment&&arm==='B',readback:!shadowExperiment&&arm==='B'};rows.push(row);
  try{
   await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Synthetic fullscreen rejection','NotAllowedError'));});
   await page.goto('/play?game=tofu&seed=42');await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','ready');
   await page.evaluate(installTofuReadbackProbe,shadowExperiment?{suppressShadow:arm==='B'}:arm==='B');installed=true;
   await page.clock.install({time:new Date('2026-10-25T00:00:00Z')});await page.clock.pauseAt(new Date('2026-10-25T00:01:00Z'));
   await page.evaluate(()=>{(window as any).__tofuReadbackProbe.start();});
   await page.getByRole('button',{name:'開始派對！',exact:true}).click();await tofuFullscreen(page,true);
   await expect(page.locator('.pt-root')).toHaveAttribute('data-party-mode','3d');
   const snapshot=async()=>({elapsed:await partyElapsed(page),state:await page.locator('.pt-root').getAttribute('data-party-state'),score:await page.locator('.pt-root').getAttribute('data-party-score'),render:await page.locator('.pt-canvas').evaluate(el=>({...((el as HTMLElement).dataset)}))});
   row.before=await snapshot();await page.evaluate(()=>{(window as any).__tofuReadbackProbe.mark();});
   const begin=process.hrtime.bigint();row.trace=await traceNativeTofuClockChunk(page,`${prefix}-${order}-${arm}`);row.instrumentedWallMs=Number(process.hrtime.bigint()-begin)/1e6;
   row.measurement=await page.evaluate(()=>{return (window as any).__tofuReadbackProbe.read();});row.after=await snapshot();
   const measurement=row.measurement as any,before=row.before as any,after=row.after as any;
   const works=measurement.samples.map((sample:any)=>sample.work);
   const shadowValid=!shadowExperiment||(new Set(works.map((w:any)=>w?.token)).size===measurement.frames&&works.every((w:any,i:number)=>w&&w.targets===1&&w.segments===1&&w.offscreenAttempted>0&&w.mainDraws>0&&w.offscreenAttempted+w.mainDraws===measurement.samples[i].drawCalls&&w.offscreenExecuted===(arm==='B'?0:w.offscreenAttempted)));
   row.eligible=shadowValid&&(row.trace as {wholeWindow:boolean}).wholeWindow&&measurement.frames>=28&&measurement.frames<=32&&measurement.samples.length===measurement.frames&&measurement.unwrappedDraws===0&&!measurement.overflow&&measurement.glError===0&&measurement.stateTrackingMatches&&JSON.stringify(measurement.baselineState)===JSON.stringify(measurement.finalState)&&measurement.samples.every((sample:{validReadState:boolean;pixel:number[]|null})=>sample.validReadState&&(!measurement.readback?sample.pixel===null:sample.pixel?.length===4))&&!measurement.contextLost&&!measurement.errors.length&&!errors.length&&
    measurement.device.visibility==='visible'&&measurement.after.visibility==='visible'&&measurement.device.dpr===diagnosticDpr&&measurement.after.dpr===diagnosticDpr&&
    measurement.samples.reduce((total:number,sample:{drawCalls:number})=>total+sample.drawCalls,0)===measurement.draws&&measurement.device.width===measurement.after.width&&measurement.device.height===measurement.after.height&&
    before.state==='playing'&&after.state==='playing'&&before.score==='0'&&after.score==='0'&&after.elapsed-before.elapsed>=900&&after.elapsed-before.elapsed<=1000;
   // Eligibility is diagnostic validity only; no speed threshold or product pass.
   expect(row.eligible,'paired diagnostic window incomplete or altered').toBe(true);
  }catch(error){row.error=String(error);row.eligible=false;failures.push(error);}
  finally{
   if(installed)try{if(!row.measurement)row.measurement=await page.evaluate(()=>{return (window as any).__tofuReadbackProbe.read();});await page.evaluate(()=>{(window as any).__tofuReadbackProbe.restore();});}catch(error){row.cleanupError=String(error);row.eligible=false;failures.push(error);}
   row.pageErrors=errors;if(errors.length)row.eligible=false;
   try{await context.close();}catch(error){row.closeError=String(error);row.eligible=false;failures.push(error);}
   await testInfo.attach(`${prefix}-${order}-${arm}-measurement.json`,{body:JSON.stringify({shadowExperiment,scope:'Shadow suppression changes image, executed workload and potentially main-pass PCF cost: total intervention effect, NOT isolated shadow raster time; never product/visual/performance acceptance. Other mode one-pixel readback includes preceding work, resolve and copy, not a pure raster fence or native FPS/GPU-time/acceptance; do not add nested trace spans',head:process.env.HEAD_SHA??null,run:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null,browserVersion:browser.version(),viewport:diagnosticViewport,deviceScaleFactor:diagnosticDpr,seed:42,setupDivergence:'Clock installed after ready to retain native performance.now; unlike original idle clock-before-navigation. Paired diagnostic only, not interchangeable acceptance evidence',row},null,2),contentType:'application/json'});
  }
 }
 const [a,b]=rows.map(row=>row.measurement as any);
 const sameState=(key:'before'|'after')=>JSON.stringify(rows[0]?.[key])===JSON.stringify(rows[1]?.[key]);
 const matchingAttemptedWork=!shadowExperiment||JSON.stringify(a?.samples.map((s:any)=>[s.work?.offscreenAttempted,s.work?.mainDraws,s.work?.targets,s.work?.segments]))===JSON.stringify(b?.samples.map((s:any)=>[s.work?.offscreenAttempted,s.work?.mainDraws,s.work?.targets,s.work?.segments]));
 const pairEligible=matchingAttemptedWork&&rows.length===2&&rows.every(row=>row.eligible===true)&&a.frames===b.frames&&a.draws===b.draws&&JSON.stringify(a.device)===JSON.stringify(b.device)&&sameState('before')&&sameState('after');
 await testInfo.attach(`${prefix}-${order}-pair.json`,{body:JSON.stringify({order,pairEligible,scope:'Diagnostic comparability only; no product/performance acceptance',errors:failures.map(String)}),contentType:'application/json'});
 if(failures.length)throw failures[0];
 // Match attempted render work/state; suppression intentionally changes executed work and pixels.
 expect(pairEligible,'paired windows differ in device, state, attempted work or validity').toBe(true);
});
