import {test,expect,type Page,type Route} from './fixtures.js';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {chairWave} from '../../apps/portal-web/src/games/party/domain.js';
import {PARTY_RULES as PT} from '../../apps/portal-web/src/games/party/catalog.js';
import {partyElapsed,partyAdvance,blockPartyWebGL,socialEntries,holidayControlHit,partyPaintedContentFailures,partyCoveredToolsBounds,partyScrollPaintedStageIntoView,holidayModalTextScale} from './helpers/party-scene.js';

// PT-CHAIR-SCENE: keep fullscreen for the entire journey. openParty and
// openLightAction deliberately exit after Start and do not prove this contract.
async function chairFullscreen(page:Page,rejected:boolean){
  const stage=page.locator('.fullscreen-game--chair[data-game-stage]');
  await expect(stage).toHaveAttribute('role','dialog');
  if(rejected){await expect(stage).toHaveClass(/fullscreen-game--viewport/);expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();}
  else await expect.poll(()=>stage.evaluate(el=>document.fullscreenElement===el)).toBe(true);
}
async function openChairScene(page:Page,light:boolean,rejected:boolean){
  if(rejected)await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Synthetic fullscreen rejection','NotAllowedError'));});
  if(light)await blockPartyWebGL(page);
  await page.clock.install({time:new Date('2026-10-25T00:00:00Z')});await page.goto('/play?game=chair&seed=42');
  if(light){await expect(page.getByRole('alert')).toContainText('無法開啟 3D 場景');await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();}
  await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','ready');
  await page.clock.pauseAt(new Date('2026-10-25T00:01:00Z'));await page.getByRole('button',{name:'開始派對！',exact:true}).click();
  await chairFullscreen(page,rejected);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-mode',light?'light':'3d');
  await expect(page.locator('.pt-canvas canvas')).toHaveCount(light?0:1);
  if(!light)expect(Number(await page.locator('.pt-canvas').getAttribute('data-render-triangles'))).toBeGreaterThan(0);
  expect(await page.locator('.pt-chair-controls').evaluate(el=>!el.closest('.pt-canvas')&&!!el.closest('.pt-chair-stage'))).toBe(true);
}
async function chairLane(page:Page,target:number,method:'pointer'|'keyboard'|'assistive'='keyboard'){
  const host=page.locator('.pt-canvas');let lane=Number(await host.getAttribute('data-lane'));
  while(lane!==target){
    const direction=lane<target?1:-1,button=page.getByRole('button',{name:direction===1?'往右換路':'往左換路',exact:true});
    if(method==='pointer')await button.click();else if(method==='assistive')await button.evaluate(el=>(el as HTMLButtonElement).click());else await host.press(direction===1?'ArrowRight':'ArrowLeft');
    lane+=direction;await expect(host).toHaveAttribute('data-lane',String(lane));await partyAdvance(page,await partyElapsed(page)+160);
  }
}
async function chairTextScale(page:Page,scale:number){
  const stage=page.locator('.fullscreen-game--chair[data-game-stage]');
  await stage.evaluate((root,factor)=>{
    const el=root as HTMLElement;for(const [side,value]of Object.entries({top:12,right:16,bottom:18,left:14}))el.style.setProperty(`--chair-safe-${side}`,`${value}px`);
    // Text-only enlargement is deliberate; this does not claim browser zoom.
    const nodes=[root,...root.querySelectorAll('*')].filter((n):n is HTMLElement=>n instanceof HTMLElement).map(n=>({n,font:parseFloat(getComputedStyle(n).fontSize),line:parseFloat(getComputedStyle(n).lineHeight)}));
    for(const {n,font,line}of nodes){n.style.fontSize=`${font*factor}px`;if(Number.isFinite(line))n.style.lineHeight=`${line*factor}px`;}
  },scale);
}
async function chairStageBounds(page:Page,scale=1){
  const stage=page.locator('.fullscreen-game--chair[data-game-stage]');
  expect(await stage.evaluate(root=>{
    const outer=root.getBoundingClientRect(),bad:string[]=[];
    if(outer.left<0||outer.top<0||outer.right>innerWidth+1||outer.bottom>innerHeight+1)bad.push('owner');
    for(const selector of ['.fullscreen-game__bar','.pt-chair-stage','.pt-scoreboard','.pt-holiday-field','.pt-chair-controls']){
      const el=root.querySelector<HTMLElement>(selector);if(el&&getComputedStyle(el).display==='contents')continue;if(!el||!el.checkVisibility()){bad.push(`missing:${selector}`);continue;}const b=el.getBoundingClientRect();
      if(b.left<outer.left-1||b.top<outer.top-1||b.right>outer.right+1||b.bottom>outer.bottom+1)bad.push(selector);
    }return bad;
  })).toEqual([]);
  // Measure before any scrollIntoView: no partly clipped tool strip may pass by
  // scrolling one button at a time. Whole native pixels remain outside all HUD
  // and control rectangles, with the same exact light/native input rectangle.
  const composition=await stage.evaluate((root,textScale)=>{
    const outer=root.getBoundingClientRect(),style=getComputedStyle(root),bad:string[]=[];
    const safe={left:outer.left+parseFloat(style.paddingLeft),top:outer.top+parseFloat(style.paddingTop),right:outer.right-parseFloat(style.paddingRight),bottom:outer.bottom-parseFloat(style.paddingBottom)};
    const contains=(a:typeof safe,b:DOMRect)=>b.left>=a.left-1&&b.top>=a.top-1&&b.right<=a.right+1&&b.bottom<=a.bottom+1;
    const overlap=(a:DOMRect,b:DOMRect)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
    for(const selector of ['.fullscreen-game__bar','.pt-scoreboard','.pt-holiday-tools-viewport','.pt-tools']){
      const el=root.querySelector<HTMLElement>(selector)!;if(getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)')bad.push(`opaque chrome band: ${selector}`);
    }
    if(getComputedStyle(root.querySelector('.pt-holiday-field')!).backgroundColor!==style.backgroundColor)bad.push('disconnected game surface');
    const controls=[...root.querySelectorAll<HTMLElement>('.fullscreen-game__button,.fullscreen-game__mode-help summary,.pt-holiday-heading button,.pt-chair-controls button,.pt-tools button')];
    const boxes=controls.map(el=>({el,b:el.getBoundingClientRect()}));
    for(const {el,b} of boxes){
      const name=el.getAttribute('aria-label')??el.textContent;
      if(!el.checkVisibility()||!contains(safe,b))bad.push(`control outside safe surface: ${name}`);
      if(b.width<44||b.height<44)bad.push(`small control: ${name}`);
      if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)bad.push(`clipped control content: ${name}`);
      const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(!hit||!el.contains(hit))bad.push(`covered control: ${name}`);
    }
    const chrome=[...boxes.map(item=>item.b),...Array.from(root.querySelectorAll('.pt-scoreboard,.pt-holiday-heading h1,.pt-holiday-feedback')).map(el=>el.getBoundingClientRect())];
    for(let i=0;i<chrome.length;i++)for(let j=i+1;j<chrome.length;j++)if(overlap(chrome[i],chrome[j]))bad.push(`overlapping chrome: ${i}/${j}`);
    for(const el of root.querySelectorAll<HTMLElement>('.pt-holiday-heading h1,.pt-scoreboard strong,.pt-scoreboard strong>span,.pt-tools button')){
      const b=el.getBoundingClientRect();if(!contains(safe,b))bad.push(`text outside safe surface: ${el.textContent}`);
      if(parseFloat(getComputedStyle(el).fontSize)<14*textScale-.1)bad.push(`small text: ${el.textContent}`);
      if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)bad.push(`clipped text: ${el.textContent}`);
    }
    const host=root.querySelector<HTMLElement>('.pt-canvas')!,world=root.querySelector<HTMLElement>('.pt-holiday-world')!,canvas=host.querySelector('canvas');
    if(host.querySelector('button,a,svg'))bad.push('controls inside renderer host');
    const b=host.getBoundingClientRect();
    if(!contains(safe,b)||!contains(world.getBoundingClientRect(),b))bad.push('world clipped');
    if(chrome.some(rect=>overlap(b,rect)))bad.push('world obscured by HUD or controls');
    for(const x of [b.left+1,b.right-1])for(const y of [b.top+1,b.bottom-1])if(!host.contains(document.elementFromPoint(x,y)))bad.push('world corner not hit-testable');
    if(canvas){
      const pixels=canvas.getBoundingClientRect();
      for(const key of ['x','y','width','height'] as const)if(Math.abs(b[key]-pixels[key])>1)bad.push(`unaligned native pixels: ${key}`);
    }else if(host.children.length)bad.push('light hit host is not empty');
    for(const selector of ['.pt-holiday-tools-viewport','.pt-tools']){const el=root.querySelector<HTMLElement>(selector)!;if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)bad.push(`scrolling tool strip: ${selector}`);}
    return bad;
  },scale);expect(composition).toEqual([]);
  expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
  const box=await page.locator('.pt-canvas').boundingBox(),diagnostic=`Chair world actual rect: ${JSON.stringify(box)}`;
  expect(box,diagnostic).not.toBeNull();
  // A 4:3 sliver is not a usable world. This floor prevents near-disappearance,
  // but does not establish art quality or human playability acceptance.
  expect(box!.width,`${diagnostic}; minimum width is 128 CSS px`).toBeGreaterThanOrEqual(128);
  expect(box!.height,`${diagnostic}; minimum height is 96 CSS px`).toBeGreaterThanOrEqual(96);
  expect(box!.width/box!.height,`${diagnostic}; world must remain 4:3`).toBeCloseTo(4/3,2);
  if(scale===2&&page.viewportSize()?.width===667&&page.viewportSize()?.height===375&&await stage.getAttribute('role')==='dialog'){
    // d141 / run 42533847998 original Chair JSON: 173.84375×130.390625 CSS px in both modes.
    // Require >=25% more height (>=56% more area), not the old token-size floor.
    expect(box!.height,`${diagnostic}; reclaim the historical Chair status lane`).toBeGreaterThanOrEqual(130.390625*1.25);
  }
  for(const owner of [stage,page.locator('.pt-holiday-world')]){
    const bounds=(await owner.boundingBox())!;expect(box!.x,diagnostic).toBeGreaterThanOrEqual(bounds.x-1);expect(box!.y,diagnostic).toBeGreaterThanOrEqual(bounds.y-1);expect(box!.x+box!.width,diagnostic).toBeLessThanOrEqual(bounds.x+bounds.width+1);expect(box!.y+box!.height,diagnostic).toBeLessThanOrEqual(bounds.y+bounds.height+1);
  }
  const lightWorld=page.locator('[data-light-world=chair]');
  if(await lightWorld.count()){const svg=(await lightWorld.boundingBox())!;for(const key of ['x','y','width','height'] as const)expect(svg[key],`light world ${key} must map to the empty pointer host`).toBeCloseTo(box![key],1);}
  expect(await page.locator('.pt-canvas').evaluate(host=>host.querySelectorAll('button,a,svg').length)).toBe(0);
}
for(const light of [false,true])for(const rejected of [false,true])test(`PT-CHAIR-SCENE: ${light?'light':'native'} complete thirty seconds in ${rejected?'rejected':'native'} fullscreen, retry real capture and replay same seed`,async({page},testInfo)=>{
  // Full native RAF/input/capture/replay measured ~58–59s; keep light unchanged.
  if(!light)test.setTimeout(150_000);
  const errors:string[]=[],writes:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  await page.setViewportSize({width:390,height:844});await openChairScene(page,light,rejected);
  let scale=1;
  const inspectRun=async(phase:string)=>{
    const name=`chair-${light?'light':'native'}-${rejected?'rejected':'fullscreen'}-${phase}`;
    await testInfo.attach(`${name}.json`,{body:JSON.stringify({phase,textScale:scale,world:await page.locator('.pt-canvas').boundingBox(),score:await page.locator('.pt-root').getAttribute('data-party-score'),elapsed:await partyElapsed(page)},null,2),contentType:'application/json'});
    await testInfo.attach(`${name}.png`,{body:await page.screenshot(),contentType:'image/png'});await chairStageBounds(page,scale);
  };
  await inspectRun('early');
  for(let index=0;index<PT.chairWaves;index++){
    const wave=chairWave(42,index);await chairLane(page,wave.ticketLane,index%3===0?'pointer':index%3===1?'keyboard':'assistive');
    if(index===10||index===20){
      if(index===10){scale=2;await chairTextScale(page,scale);}
      // Earned later scores and a real jump, without changing the wave schedule
      // or moving onto the obstacle lane. No run or renderer state is injected.
      await partyAdvance(page,wave.at-425);await page.getByRole('button',{name:'跳一下！',exact:true}).press('Enter');await partyAdvance(page,wave.at-200);
      if(light)expect(Number(await page.locator('[data-light-world=chair]').getAttribute('data-jump'))).toBeGreaterThan(0);
      await inspectRun(`wave-${index+1}-jump`);
    }
    await partyAdvance(page,wave.at+20);
    await chairFullscreen(page,rejected);
    if(light)await expect(page.locator('[data-light-world=chair]')).toHaveAttribute('data-actual-x',String(wave.ticketLane));
  }
  await partyAdvance(page,PT.chairMs);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','done');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','4280');expect(await partyElapsed(page)).toBe(30000);
  const result=page.getByRole('button',{name:'查看這局成果',exact:true});await holidayControlHit(result);await chairFullscreen(page,rejected);
  if(light){const downloading=page.waitForEvent('download');const svgLink=page.getByRole('link',{name:'下載本局成果 SVG',exact:true});await holidayControlHit(svgLink);await svgLink.click();const svg=readFileSync((await(await downloading).path())!,'utf8');for(const text of ['4280 分','22 張假日票','剩餘 3 顆心','同題 #42'])expect(svg).toContain(text);}
  else{
    await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...args){HTMLCanvasElement.prototype.toDataURL=original;throw Error('Synthetic chair capture failure');};});
    await result.click();await expect(page.locator('.pt-feedback')).toContainText('圖片還沒產生');await expect(page.locator('.fw-arcade-result')).toHaveCount(0);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','4280');await partyCoveredToolsBounds(page);
  }
  await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toBlob,failed=new Set<string>();HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){const kind=type??'image/png';if(!failed.has(kind)){failed.add(kind);callback(null);return;}return original.call(this,callback,type,quality);};});
  await result.click();await expect(page.locator('.fw-arcade-result-heading')).toContainText('4280 分');await chairFullscreen(page,rejected);
  await page.getByRole('button',{name:'重試產生成果圖',exact:true}).click();const jpegRetry=page.getByRole('button',{name:'重試準備工坊圖片',exact:true});await expect(jpegRetry).toBeEnabled();await jpegRetry.click();await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();
  const png=page.getByRole('link',{name:'下載完整成果 PNG',exact:true});await holidayControlHit(png);const downloading=page.waitForEvent('download');await png.click();const meta=await sharp((await(await downloading).path())!).metadata();expect([meta.format,meta.width,meta.height]).toEqual(['png',960,1200]);
  await page.getByRole('button',{name:'分享成果',exact:true}).click();await expect(page.locator('[data-game-share]')).toBeFocused();await socialEntries(page,'chair');
  const replay=page.getByRole('button',{name:'同一題再來一次',exact:true});await holidayControlHit(replay);await replay.press('Enter');expect(new URL(page.url()).searchParams.get('seed')).toBe('42');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','ready');expect(writes).toEqual([]);expect(errors).toEqual([]);
});

for(const light of [false,true])for(const rejected of [false,true])test(`PT-CHAIR-SCENE: ${light?'light':'native'} three actual collisions end once in ${rejected?'rejected':'native'} fullscreen`,async({page})=>{
  await openChairScene(page,light,rejected);
  for(let index=0;index<3;index++){const wave=chairWave(42,index);await chairLane(page,wave.lane,'pointer');await partyAdvance(page,wave.at+20);await chairFullscreen(page,rejected);if(index<2)await chairStageBounds(page);}
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','done');expect(await partyElapsed(page)).toBe(chairWave(42,2).at);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');
  const at=await partyElapsed(page);await page.clock.runFor(2000);expect(await partyElapsed(page)).toBe(at);await page.getByRole('button',{name:'查看這局成果',exact:true}).click();await expect(page.locator('.fw-arcade-result-heading')).toContainText('0 分');await chairFullscreen(page,rejected);
});

for(const light of [false,true])test(`PT-CHAIR-SCENE: ${light?'light':'native'} secondary cancelled duplicate and stale holds cannot move a later wave`,async({page})=>{
  await openChairScene(page,light,true);await partyAdvance(page,300);const host=page.locator('.pt-canvas'),right=page.getByRole('button',{name:'往右換路',exact:true});
  await right.click({button:'right'});await expect(host).toHaveAttribute('data-lane','0');
  await right.dispatchEvent('pointerdown',{pointerId:91,isPrimary:false,button:0});await right.dispatchEvent('pointerup',{pointerId:91,isPrimary:false,button:0});await right.dispatchEvent('click',{detail:1});await expect(host).toHaveAttribute('data-lane','0');
  await right.dispatchEvent('pointerdown',{pointerId:92,isPrimary:true,button:0});await right.dispatchEvent('pointercancel',{pointerId:92,isPrimary:true});await right.dispatchEvent('pointerup',{pointerId:92,isPrimary:true,button:0});await right.dispatchEvent('click',{detail:1});await expect(host).toHaveAttribute('data-lane','0');
  await right.click();await expect(host).toHaveAttribute('data-lane','1');await partyAdvance(page,500);await chairLane(page,0);await right.dispatchEvent('click',{detail:1});await expect(host).toHaveAttribute('data-lane','0');
  for(const [index,key] of ['Space','Enter','pointer'].entries()){
    const wave=chairWave(42,index);await partyAdvance(page,wave.at-200);
    if(key==='pointer'){const b=(await right.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();}else{await right.focus();await page.keyboard.down(key);}
    await partyAdvance(page,wave.at+20);if(key==='pointer')await page.mouse.up();else await page.keyboard.up(key);await expect(host).toHaveAttribute('data-lane','0');await chairFullscreen(page,true);
  }
  // A native host swipe is owned by the down-time wave too.
  await partyAdvance(page,chairWave(42,3).at-200);const rect=(await host.boundingBox())!;await page.mouse.move(rect.x+rect.width*.4,rect.y+rect.height*.5);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.5);await partyAdvance(page,chairWave(42,3).at+20);await page.mouse.up();await expect(host).toHaveAttribute('data-lane','0');
  await right.evaluate(el=>(el as HTMLButtonElement).click());await expect(host).toHaveAttribute('data-lane','1');await partyAdvance(page,await partyElapsed(page)+160);await chairLane(page,0);
  await right.focus();await page.keyboard.down('Space');const help=page.getByRole('button',{name:'玩法與設定',exact:true});await help.click();await page.keyboard.up('Space');await expect(host).toHaveAttribute('data-lane','0');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');const at=await partyElapsed(page);await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);
  await page.keyboard.press('Escape');await expect(help).toBeFocused();await chairFullscreen(page,true);
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await page.getByRole('button',{name:'暫停',exact:true}).click();await page.getByRole('button',{name:'重新開始',exact:true}).click();await expect(page.getByRole('button',{name:'確定重來',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'重新開始',exact:true})).toBeFocused();await chairFullscreen(page,true);
  await page.getByRole('button',{name:'重新開始',exact:true}).click();await page.getByRole('button',{name:'確定重來',exact:true}).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','ready');expect(await partyElapsed(page)).toBe(0);await page.getByRole('button',{name:'開始派對！',exact:true}).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','playing');
  // Presentation owns fullscreen Escape, not the game's pause action. Pause
  // explicitly, then prove exiting presentation preserves that frozen run.
  await page.getByRole('button',{name:'暫停',exact:true}).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');const exitAt=await partyElapsed(page);await expect(page.getByRole('button',{name:'繼續這一局',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('.fullscreen-game')).not.toHaveClass(/fullscreen-game--viewport/);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(exitAt);
});

for(const rejected of [false,true])test(`PT-CHAIR-SCENE: real context loss preserves position, score and clock through light and native recovery in ${rejected?'rejected':'native'} fullscreen`,async({page})=>{
  await openChairScene(page,false,rejected);await partyAdvance(page,2300);await chairLane(page,1);const score=await page.locator('.pt-root').getAttribute('data-party-score');
  const lost=await page.locator('.pt-canvas canvas').evaluate(c=>{const ext=(c as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context');ext?.loseContext();return !!ext;});expect(lost).toBe(true);
  await expect(page.getByRole('alert')).toContainText('本局已暫停');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');const at=await partyElapsed(page);await chairFullscreen(page,rejected);
  const light=page.getByRole('button',{name:'改用輕量玩法',exact:true});await holidayControlHit(light);await light.click();await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);await expect(page.locator('[data-light-world=chair]')).toHaveAttribute('data-actual-x','1');await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);
  const retry=page.getByRole('button',{name:'重試 3D，保留這局',exact:true});await holidayControlHit(retry);await retry.click();await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','ready');await expect(page.locator('.pt-canvas canvas')).toHaveCount(1);await expect(page.locator('.pt-canvas')).toHaveAttribute('data-lane','1');expect(await partyElapsed(page)).toBe(at);await chairFullscreen(page,rejected);
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await chairLane(page,-1);await partyAdvance(page,chairWave(42,1).at+20);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','260');await chairFullscreen(page,rejected);
});

for(const rejected of [false,true])test(`PT-CHAIR-SCENE: explicit light choice owns late native import in ${rejected?'rejected':'native'} fullscreen`,async({page})=>{
  if(rejected)await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Synthetic fullscreen rejection','NotAllowedError'));});
  const now=new Date('2026-10-25T00:00:00Z');await page.clock.install({time:now});await page.clock.pauseAt(new Date(now.getTime()+60_000));
  let capture!:(route:Route)=>void;const requested=new Promise<Route>(resolve=>{capture=resolve;});await page.route(/\/assets\/stage-(?!batch-)[^/]+\.js(?:\?.*)?$/,route=>{capture(route);});
  await page.goto('/play?game=chair&seed=42',{waitUntil:'domcontentloaded'});const route=await requested,response=await route.fetch(),url=route.request().url();await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','loading');
  await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();await page.getByRole('button',{name:'開始派對！',exact:true}).click();await chairFullscreen(page,rejected);await partyAdvance(page,300);await chairLane(page,1,'pointer');const at=await partyElapsed(page);
  await route.fulfill({response});await page.evaluate(async moduleUrl=>{await import(moduleUrl);},url);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-mode','light');await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);await expect(page.locator('[data-light-world=chair]')).toHaveAttribute('data-actual-x','1');expect(await partyElapsed(page)).toBe(at);await chairFullscreen(page,rejected);
  await page.getByRole('button',{name:'跳一下！',exact:true}).press('Enter');await partyAdvance(page,at+200);expect(Number(await page.locator('[data-light-world=chair]').getAttribute('data-jump'))).toBeGreaterThan(0);await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);
});

for(const light of [false,true])for(const rejected of [false,true])for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375},{width:1440,height:900}])for(const scale of [1,1.25,2])test(`PT-CHAIR-SCENE: ${light?'light':'native'} ${rejected?'rejected':'native'} ${viewport.width}x${viewport.height} ${scale*100}% text safe insets, real controls and modal reachability`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);await openChairScene(page,light,rejected);const stage=page.locator('.fullscreen-game--chair[data-game-stage]');
  const attachWorldEvidence=async(phase:'playing'|'resumed'|'normal')=>{
    if(scale!==2||viewport.width===1440)return;
    const name=`chair-${light?'light':'native'}-${rejected?'rejected':'fullscreen'}-${viewport.width}x${viewport.height}-200-percent-${phase}`;
    // Capture before bounds assertions so a failing world retains its real
    // dimensions and viewport pixels. These are browser artifacts, not mocks.
    await testInfo.attach(`${name}.json`,{body:JSON.stringify({viewport:page.viewportSize(),textScale:scale,phase,mode:light?'light':'native',fullscreen:phase==='normal'?'normal':rejected?'rejected':'native',minimumWorldCssPx:{width:128,height:96},world:await page.locator('.pt-canvas').boundingBox(),stage:await stage.boundingBox()},null,2),contentType:'application/json'});
    await testInfo.attach(`${name}.png`,{body:await page.screenshot(),contentType:'image/png'});
  };
  await chairTextScale(page,scale);
  await partyAdvance(page,250);await attachWorldEvidence('playing');await chairStageBounds(page,scale);expect(await stage.evaluate(root=>{const style=getComputedStyle(root);return ['top','right','bottom','left'].map(side=>parseFloat(style.getPropertyValue(`padding-${side}`)));})).toEqual([12,16,18,14]);
  const buttons=page.locator('.pt-chair-controls button');await expect(buttons).toHaveCount(3);for(const button of await buttons.all())await holidayControlHit(button);
  await chairLane(page,1,'pointer');await chairLane(page,0,'keyboard');await page.getByRole('button',{name:'跳一下！',exact:true}).press('Enter');await partyAdvance(page,await partyElapsed(page)+200);
  if(light)expect(Number(await page.locator('[data-light-world=chair]').getAttribute('data-jump'))).toBeGreaterThan(0);
  const help=page.getByRole('button',{name:'玩法與設定',exact:true});await holidayControlHit(help);await help.click();const close=page.getByRole('button',{name:'回到遊戲',exact:true});await expect(close).toBeFocused();await holidayModalTextScale(page,scale);await holidayControlHit(close);const overlay=page.locator('.pt-holiday-overlay').filter({has:close});
  const at=await partyElapsed(page);await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);
  for(let i=0;i<8;i++){await page.keyboard.press(i<4?'Tab':'Shift+Tab');expect(await overlay.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
  await page.keyboard.press('Escape');await expect(help).toBeFocused();await chairFullscreen(page,rejected);await partyCoveredToolsBounds(page);
  // Keep original first/last reachability after the stricter no-scroll checks.
  const restart=page.getByRole('button',{name:'重新開始',exact:true}),last=page.getByRole('button',{name:light?'重試 3D，保留這局':'減少動態關',exact:true});await holidayControlHit(last);await holidayControlHit(restart);await restart.click();await holidayModalTextScale(page,scale);
  const confirm=page.getByRole('button',{name:'確定重來',exact:true}),keep=page.getByRole('button',{name:'保留這局',exact:true});await expect(confirm).toBeFocused();await holidayControlHit(confirm);await holidayControlHit(keep);await keep.press('Enter');await expect(restart).toBeFocused();await chairFullscreen(page,rejected);
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await attachWorldEvidence('resumed');await chairStageBounds(page,scale);await expect(page.locator('.pt-canvas')).toBeFocused();
  for(let i=0;i<16;i++){await page.keyboard.press(i<8?'Tab':'Shift+Tab');expect(await stage.evaluate(el=>el.contains(document.activeElement)&&!document.activeElement?.closest('[inert]'))).toBe(true);}
  await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();await expect(stage).not.toHaveAttribute('role','dialog');await partyScrollPaintedStageIntoView(stage);await attachWorldEvidence('normal');await chairStageBounds(page,scale);
});
