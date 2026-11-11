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
for(const light of [false,true])test(`PT-TOFU-SCENE: ${light?'light':'native'} sixty-second idle expiry keeps zero score and no invented tower`,async({page})=>{
 // Every native RAF for the real 60s round took ~106s locally; hosted traces
 // spent ~2.23s per simulated second (~134s before setup). Match the existing
 // native Tofu 180s allowance without changing game, draw or light budgets.
 if(!light)test.setTimeout(180_000);
 await openTofuScene(page,light,true);await partyAdvance(page,PT.tofuMs);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','done');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');await expect(page.locator('.pt-scoreboard strong[aria-label^="完成 0 / 12 層，"]')).toBeVisible();expect(await partyElapsed(page)).toBe(PT.tofuMs);await tofuFullscreen(page,true);
});
