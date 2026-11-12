import {GAME_HANDOFF_KEY} from '../../apps/portal-web/src/games/result-bridge.js';
import {test,expect,type Page,type Route} from './fixtures.js';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {holidayTargets,actParty,advanceParty,newParty,startParty} from '../../apps/portal-web/src/games/party/domain.js';
import {partyViewport} from '../../apps/portal-web/src/games/party/viewport.js';
import {PARTY_RULES as PT} from '../../apps/portal-web/src/games/party/catalog.js';
import {partyElapsed,partyAdvance,blockPartyWebGL,socialEntries,holidayControlHit,partyPaintedContentFailures,partyFullViewportComposition,partyCoveredToolsBounds,partyScrollPaintedStageIntoView,holidayModalTextScale} from './helpers/party-scene.js';

// PT-HOLIDAY-SCENE: sustained fullscreen journeys, separate from openParty's
// intentional exit coverage. Browser execution is required to validate these cases.
async function openHolidayScene(page:Page,light:boolean,rejected:boolean){
  if(rejected)await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Synthetic fullscreen rejection','NotAllowedError'));});
  if(light)await blockPartyWebGL(page);
  await page.clock.install({time:new Date('2026-10-25T00:00:00Z')});await page.goto('/play?game=holiday&seed=42');
  if(light){await expect(page.getByRole('alert')).toContainText('無法開啟 3D 場景');await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();}
  await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','ready');
  await page.clock.pauseAt(new Date('2026-10-25T00:01:00Z'));await page.getByRole('button',{name:'開始派對！',exact:true}).click();
  await holidayFullscreen(page,rejected);
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-mode',light?'light':'3d');
  await expect(page.locator('.pt-canvas canvas')).toHaveCount(light?0:1);
  expect(await page.locator('.pt-hole-controls').evaluate(el=>!el.closest('.pt-canvas')&&!!el.closest('.pt-holiday-stage'))).toBe(true);
}
async function holidayFullscreen(page:Page,rejected:boolean){
  const stage=page.locator('.fullscreen-game--holiday[data-game-stage]');
  await expect(stage).toHaveAttribute('role','dialog');
  if(rejected){await expect(stage).toHaveClass(/fullscreen-game--viewport/);expect(await page.evaluate(()=>document.fullscreenElement===null)).toBe(true);}
  else await expect.poll(()=>stage.evaluate(el=>document.fullscreenElement===el)).toBe(true);
}
async function holidayHitPoint(page:Page,hole:number){
  const canvas=page.locator('.pt-canvas'),box=(await canvas.boundingBox())!;
  const anchor=JSON.parse((await canvas.getAttribute('data-anchors'))!)[hole];
  const point={x:box.x+anchor.x*box.width,y:box.y+anchor.y*box.height};
  expect(await canvas.evaluate((el,p)=>{const hit=document.elementFromPoint(p.x,p.y);return !!hit&&el.contains(hit);},point)).toBe(true);
  return point;
}
test('PT-BOUNDS: painted content detects glyph and ancestor clipping without treating contents wrappers as paint',async({page})=>{
  await page.setContent(`<div data-game-stage style="position:relative;width:320px;height:160px"><header class="pt-holiday-heading"><h1 style="position:absolute;left:8px;bottom:8px;margin:0;font:14px/20px system-ui">測試遊戲</h1></header><section class="pt-holiday-stage" style="display:contents"><div class="pt-tools"><button style="display:grid;place-items:center;width:80px;height:64px;padding:0;font:40px/1.4 system-ui"><span aria-hidden="true">動</span></button></div><div class="pt-scoreboard"><small style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap">本局得分</small><strong style="display:block;font:18px/1.4 system-ui">0<span>分</span></strong></div></section></div>`);
  const stage=page.locator('[data-game-stage]'),button=stage.locator('button');
  expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
  await button.evaluate(el=>{el.style.height='16px';el.style.overflow='hidden';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('painted content outside owner:'))).toBe(true);
  await button.evaluate(el=>{el.style.height='64px';el.style.width='8px';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('painted content outside owner:'))).toBe(true);
  await button.evaluate(el=>{el.style.width='80px';});
  await stage.locator('.pt-tools').evaluate(el=>{el.style.height='16px';el.style.overflow='hidden';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('painted content clipped by ancestor:'))).toBe(true);
});
for(const selector of ['.pt-scoreboard small','.pt-live-label'])test(`PT-BOUNDS: ${selector} checks visible text without mistaking responsive hidden labels for clipping`,async({page})=>{
  const label=selector.endsWith('small')?'<div class="pt-scoreboard"><small>本局得分</small></div>':'<p class="pt-live-label">假日 3</p>';
  await page.setContent(`<style>small,.pt-live-label{display:block;width:160px;height:40px;padding:0;margin:0;font:20px/1.4 system-ui}</style><div data-game-stage style="position:relative;width:320px;height:240px"><header class="pt-holiday-heading"><h1 style="position:absolute;left:8px;bottom:8px;margin:0;font:14px/20px system-ui">測試遊戲</h1></header><section style="display:contents"><div data-label-clip style="width:240px;height:180px">${label}</div></section></div>`);
  const stage=page.locator('[data-game-stage]'),text=stage.locator(selector),parent=stage.locator('[data-label-clip]');
  expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
  await text.evaluate(el=>{el.style.height='8px';el.style.overflow='hidden';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('painted content outside owner:'))).toBe(true);
  await text.evaluate(el=>{el.style.height='40px';el.style.width='8px';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('painted content outside owner:'))).toBe(true);
  await text.evaluate(el=>{el.style.width='160px';el.style.height='0';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('unpainted required content:'))).toBe(true);
  await text.evaluate(el=>{el.style.height='40px';el.style.overflow='visible';});
  await parent.evaluate(el=>{el.style.height='8px';el.style.overflow='hidden';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('painted content clipped by ancestor:'))).toBe(true);
  await parent.evaluate(el=>{el.style.height='180px';el.style.overflow='visible';});
  await text.evaluate(el=>{el.style.display='none';});
  expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
  await text.evaluate(el=>{el.style.display='block';});
  await parent.evaluate(el=>{el.style.display='none';});
  expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
  await parent.evaluate(el=>{el.style.display='block';el.style.visibility='hidden';});
  expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
  // A visible descendant can override inherited visibility:hidden and must be checked.
  await text.evaluate(el=>{el.style.visibility='visible';el.style.width='8px';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('painted content outside owner:'))).toBe(true);
  await text.evaluate(el=>{el.style.width='160px';el.style.clipPath='inset(25%)';});
  await parent.evaluate(el=>{el.style.visibility='visible';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('painted label uses clipping:'))).toBe(true);
  await text.evaluate(el=>{el.style.clipPath='none';});
  await parent.evaluate(el=>{el.style.clipPath='inset(25%)';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('painted label clipped by ancestor shape:'))).toBe(true);
  await parent.evaluate(el=>{el.style.clipPath='none';});
  await text.evaluate(el=>{el.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';});
  expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
  await text.evaluate(el=>{el.style.clipPath='inset(25%)';});
  expect((await stage.evaluate(partyPaintedContentFailures)).some(x=>x.startsWith('painted label uses clipping:'))).toBe(true);
});
test('PT-HOLIDAY-SCENE: compact enlarged HUD and two-line feedback retain every reachable value and target',async({page})=>{
  // Layout-only fixture with the real shell/theme/Party CSS, not a renderer or
  // controller acceptance claim. Existing native/light journeys remain intact.
  const css=['arcade.css','fullscreen-game.css','toy-theme.css','illustration-theme.css','toy-console.css','shotengai.css','party/party.css'].map(path=>readFileSync(new URL(`../../apps/portal-web/src/games/${path}`,import.meta.url),'utf8')).join('\n');
  let earned=startParty(newParty('holiday',42));const samples=[[0,24,0]];
  for(let round=0;round<20;round++){const at=round*PT.holidayRoundMs+250;while(earned.elapsed<at)earned=advanceParty(earned,at-earned.elapsed);earned=actParty(earned,{kind:'pick',round,hole:holidayTargets(42,round).good});samples.push([earned.score,Math.ceil((PT.holidayMs-earned.elapsed)/1000),earned.bestCombo]);}
  expect(earned.score).toBe(5100);expect(earned.bestCombo).toBe(20);expect(samples).toContainEqual([2100,13,10]);expect(samples).toContainEqual([3000,10,13]);
  const score=(label:string,value:number,unit:string)=>`<div><small>${label}</small><strong>${value}<span>${unit}</span></strong></div>`;
  const controls=Array.from({length:6},(_,i)=>`<button class="${i===0?'pt-good':i===1?'pt-boss':''}"><b>${i+1}</b><span class="pt-target-label">${i===0?'休':i===1?'會':'空'}</span></button>`).join('');
  const tools=['Ⅱ','↻','?',null,'動'].map((text,i)=>`<button class="fw-arcade-secondary" aria-label="fixture tool ${i}"${i>=3?' aria-pressed="true"':''}>${text===null?'<svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em"><path d="M4 9h4l5-4v14l-5-4H4z"/></svg>':`<span aria-hidden="true">${text}</span>`}</button>`).join('');
  await page.setViewportSize({width:320,height:568});
  for(const scale of [1,2]){
    await page.setContent(`<style>body{margin:0}:root{text-autospace:normal}${css}</style><div class="fw-arcade-root fw-arcade-toy-console fw-arcade-shotengai"><div data-game-stage class="fullscreen-game fullscreen-game--holiday fullscreen-game--viewport" style="--holiday-safe-top:12px;--holiday-safe-right:16px;--holiday-safe-bottom:18px;--holiday-safe-left:14px"><div class="fullscreen-game__bar"><button class="fullscreen-game__button" aria-label="fixture fullscreen"><span>↙</span></button><button class="fullscreen-game__button"><span>↗</span></button></div><section class="pt-root pt-holiday pt-holiday-stage pt-holiday-composition" data-party-state="playing"><header class="pt-holiday-heading"><h1>假日保衛戰</h1><button class="fw-arcade-secondary">↩</button></header><div class="pt-scoreboard">${score('本局得分',0,'分')}${score('剩餘時間',24,'秒')}${score('最長連擊',0,'連')}</div><div class="pt-holiday-field pt-play-area" data-light="false"><div class="pt-holiday-world"><div class="pt-canvas" tabindex="0"></div></div><div class="pt-controls"><div class="pt-hole-controls">${controls}</div></div><div class="pt-holiday-footer"><div class="pt-holiday-feedback"><p class="pt-live-label">已守住 20 個假日 · 20 / 20 波</p><p class="pt-feedback">假日搶救成功！20 連擊！</p></div><div class="pt-holiday-tools-viewport"><div class="pt-tools">${tools}</div></div></div></div></section></div></div>`);
    const stage=page.locator('[data-game-stage]'),hud=stage.locator('.pt-scoreboard');
    await stage.evaluate((root,factor)=>{
      const styles=[root,...root.querySelectorAll('*')].filter((n):n is HTMLElement=>n instanceof HTMLElement).map(n=>({n,font:parseFloat(getComputedStyle(n).fontSize),line:parseFloat(getComputedStyle(n).lineHeight)}));
      for(const {n,font,line} of styles){n.style.fontSize=`${font*factor}px`;if(Number.isFinite(line))n.style.lineHeight=`${line*factor}px`;}
    },scale);
    const values=async(numbers:number[])=>hud.locator('strong').evaluateAll((els,values)=>els.forEach((el,i)=>{el.firstChild!.textContent=String(values[i]);}),numbers);
    for(const mode of ['native','viewport','normal']){
      await stage.evaluate((el,mode)=>el.classList.toggle('fullscreen-game--viewport',mode==='viewport'),mode);
      if(mode==='native'){
        await stage.locator('[aria-label="fixture fullscreen"]').evaluate(button=>button.addEventListener('click',()=>void button.closest<HTMLElement>('[data-game-stage]')!.requestFullscreen(),{once:true}));
        await stage.locator('[aria-label="fixture fullscreen"]').click();await expect.poll(()=>stage.evaluate(el=>document.fullscreenElement===el)).toBe(true);
      }
      let initialHeight=0;
      for(const numbers of samples){
        await values(numbers);
        const bounds=await hud.evaluate(el=>{const row=el.getBoundingClientRect(),boxes=[...el.querySelectorAll<HTMLElement>('strong')].map(value=>({width:value.clientWidth,scrollWidth:value.scrollWidth,height:value.clientHeight,scrollHeight:value.scrollHeight,rect:value.getBoundingClientRect().toJSON()}));return {height:row.height,inside:boxes.every(({rect})=>rect.left>=row.left-1&&rect.right<=row.right+1),boxes};});
        expect(bounds.inside).toBe(true);for(const b of bounds.boxes){expect(b.scrollWidth).toBeLessThanOrEqual(b.width+1);expect(b.scrollHeight).toBeLessThanOrEqual(b.height+1);}
        expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
        if(initialHeight)expect(bounds.height).toBeCloseTo(initialHeight,2);else initialHeight=bounds.height;
      }
      // This isolated CSS/HUD fixture has no React observer. Measure its real
      // chrome and feed the same projection contract; live journeys below must
      // instead expose the renderer's actual .pt-gameplay-core.
      const geometry=await stage.evaluate(root=>{
        const host=root.querySelector('.pt-canvas')!.getBoundingClientRect(),owner=root.getBoundingClientRect(),css=getComputedStyle(root.querySelector('.pt-root')!);
        const top=Math.max(...['.pt-holiday-heading','.pt-scoreboard','.fullscreen-game__bar'].map(selector=>root.querySelector(selector)!.getBoundingClientRect().bottom-host.top),0)+8;
        const bottom=Math.max(0,...['.pt-controls','.pt-holiday-footer'].map(selector=>host.bottom-root.querySelector(selector)!.getBoundingClientRect().top))+8;
        return {host:host.toJSON(),owner:owner.toJSON(),top,bottom,left:parseFloat(css.paddingLeft),right:parseFloat(css.paddingRight)};
      });
      for(const key of ['x','y','width','height']as const)expect(geometry.host[key]).toBeCloseTo(geometry.owner[key],1);
      const world=partyViewport(geometry.host.width,geometry.host.height,geometry.top,geometry.bottom,geometry.left,geometry.right).core;
      expect(world.width).toBeGreaterThanOrEqual(128);expect(world.height).toBeGreaterThanOrEqual(96);expect(world.width/world.height).toBeCloseTo(4/3,2);
      const feedback=await stage.locator('.pt-feedback').evaluate(el=>({height:el.clientHeight,line:parseFloat(getComputedStyle(el).lineHeight)}));if(scale===2)expect(feedback.height).toBeGreaterThanOrEqual(2*feedback.line-1);
      for(const button of await stage.locator('.pt-hole-controls button,.pt-tools button').all()){
        const content=await button.evaluate(el=>({label:el.textContent,width:el.clientWidth,height:el.clientHeight,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight}));
        expect(content.scrollWidth,JSON.stringify(content)).toBeLessThanOrEqual(content.width+1);expect(content.scrollHeight,JSON.stringify(content)).toBeLessThanOrEqual(content.height+1);
        await holidayControlHit(button);
      }
      // Covered states keep full notices in their panels and tools outside them.
      for(const [state,notice] of [['ready','葉子是休假，領帶是開會。'],['paused','看完玩法後，按繼續回到這一局。'],['paused','場景暫時沒有回應，已幫你暫停。請重建場景或改用輕量玩法，這局進度會保留。'],['done','這局已完成，圖片還沒產生。可以重試查看成果。']]){
        await stage.evaluate((root,{state,notice,scale})=>{root.querySelector<HTMLElement>('.pt-holiday-stage')!.dataset.partyState=state;root.querySelector('.pt-feedback')!.textContent=notice;const overlay=document.createElement('div');overlay.className='pt-holiday-overlay';const panel=document.createElement('div');panel.className='pt-panel';const text=document.createElement('p');text.textContent=notice;panel.append(text);overlay.append(panel);root.querySelector('.pt-holiday-field')!.append(overlay);const css=getComputedStyle(text);text.style.fontSize=`${parseFloat(css.fontSize)*scale}px`;text.style.lineHeight=`${parseFloat(css.lineHeight)*scale}px`;},{state,notice,scale});
        await partyCoveredToolsBounds(page);expect((await stage.locator('.pt-canvas').boundingBox())!.height).toBeGreaterThanOrEqual(96);
        await stage.locator('.pt-holiday-overlay').evaluate(el=>el.remove());
      }
      await stage.evaluate(root=>{root.querySelector<HTMLElement>('.pt-holiday-stage')!.dataset.partyState='playing';root.querySelector('.pt-feedback')!.textContent='假日搶救成功！20 連擊！';});
      if(scale===2){
        // Restore the exact former allocation/inline units: this must overflow.
        await values([0,24,0]);await hud.evaluate(el=>{el.style.gridTemplateColumns='minmax(0,1fr) minmax(0,.75fr) minmax(0,1.25fr)';for(const value of el.querySelectorAll<HTMLElement>('strong'))value.style.display='block';for(const unit of el.querySelectorAll<HTMLElement>('strong>span'))unit.style.marginLeft='3px';});
        expect(await hud.locator('strong').nth(1).evaluate(el=>el.scrollWidth>el.clientWidth+1)).toBe(true);
        await hud.evaluate(el=>{el.style.removeProperty('grid-template-columns');for(const value of el.querySelectorAll<HTMLElement>('strong'))value.style.removeProperty('display');for(const unit of el.querySelectorAll<HTMLElement>('strong>span'))unit.style.removeProperty('margin-left');});
        expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
      }
      if(mode==='native')await page.evaluate(()=>document.exitFullscreen());
    }
  }
});
async function holidayStageBounds(page:Page,scale=1){
  const stage=page.locator('.fullscreen-game--holiday[data-game-stage]');
  const failures=await stage.evaluate(root=>{
    const outer=root.getBoundingClientRect(),bad:string[]=[];
    if(outer.left<0||outer.top<0||outer.right>innerWidth+1||outer.bottom>innerHeight+1)bad.push('stage outside viewport');
    for(const selector of ['.fullscreen-game__bar','.pt-holiday-stage','.pt-scoreboard','.pt-holiday-field','.pt-hole-controls']){
      const el=root.querySelector<HTMLElement>(selector);if(el&&getComputedStyle(el).display==='contents')continue;if(!el||!el.checkVisibility()){bad.push(`missing:${selector}`);continue;}const b=el.getBoundingClientRect();
      if(b.left<outer.left-1||b.top<outer.top-1||b.right>outer.right+1||b.bottom>outer.bottom+1)bad.push(selector);
    }
    return bad;
  });expect(failures).toEqual([]);
  // Before scrolling, prove full-owner render coverage and an independently
  // unobscured canonical gameplay core; retain real safe-area control hit tests.
  expect(await stage.evaluate(partyFullViewportComposition,scale)).toEqual([]);
  expect(await stage.evaluate(partyPaintedContentFailures)).toEqual([]);
  { // The light scene must preserve the same minimum playable core as native.
    const box=(await page.locator('.pt-gameplay-core').boundingBox())!,diagnostic=`Holiday gameplay core actual rect: ${JSON.stringify(box)}`;
    expect(box.width,`${diagnostic}; minimum width is 128 CSS px`).toBeGreaterThanOrEqual(128);expect(box.height,`${diagnostic}; minimum height is 96 CSS px`).toBeGreaterThanOrEqual(96);expect(box.width/box.height).toBeCloseTo(4/3,2);
    if(scale===2&&page.viewportSize()?.width===667&&page.viewportSize()?.height===375&&await stage.getAttribute('role')==='dialog'){
      // d141 / run 42533847998 original Holiday JSON: 173.84375×130.390625.
      // Demand >=25% more height (>=56% more area), not just the old 96px floor.
      expect(box.height,`${diagnostic}; reclaim the historical Holiday status lane`).toBeGreaterThanOrEqual(130.390625*1.25);
    }
  }
}
for(const light of [false,true])for(const rejected of [false,true])test(`PT-HOLIDAY-SCENE: ${light?'light':'native'} twenty waves retain ${rejected?'rejected':'native'} fullscreen through real results and same-seed replay`,async({page})=>{
  // Native RAFs plus capture/replay take ~49–50s under SwiftShader. Match the
  // existing finite native Party journey budget; light keeps the 45s default.
  if(!light)test.setTimeout(150_000);
  const errors:string[]=[],writes:string[]=[],social:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());if(/^https:\/\/(x\.com|www\.(threads\.com|facebook\.com|instagram\.com))\//.test(r.url()))social.push(r.url());});
  await page.setViewportSize({width:390,height:844});await openHolidayScene(page,light,rejected);await holidayStageBounds(page);
  for(let round=0;round<20;round++){
    await partyAdvance(page,round*PT.holidayRoundMs+250);const hole=holidayTargets(42,round).good,good=page.locator('.pt-hole-controls button').nth(hole);
    await expect(good).toHaveAttribute('aria-label',`第 ${hole+1} 格：休假`);
    if(!light&&round%3===0){const p=await holidayHitPoint(page,hole);await page.mouse.click(p.x,p.y);}
    else if(round%3===1)await page.locator('.pt-canvas').press(String(hole+1));
    else {await holidayControlHit(good);if(round%2)await good.press('Enter');else await good.click();}
    await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',String(round<10?(round+1)*100+10*(round+1)*(round+2):2100+(round-9)*300));
    if(!light)await expect(page.locator('.pt-live-label')).toContainText(`已守住 ${round+1} 個假日`);
    await holidayFullscreen(page,rejected);if(round===9||round===19)await holidayStageBounds(page);
  }
  await partyAdvance(page,PT.holidayMs);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','done');await holidayFullscreen(page,rejected);await holidayControlHit(page.getByRole('button',{name:'查看這局成果',exact:true}));
  if(light){const download=page.waitForEvent('download');await page.getByRole('link',{name:'下載本局成果 SVG',exact:true}).click();const svg=readFileSync((await(await download).path())!,'utf8');expect(svg).toContain('5100 分');expect(svg).toContain('搶救 20 個假日');expect(svg).toContain('同題 #42');}
  else {
    // Fail the real canvas export once; no saved-result or scoring injection.
    await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toDataURL;HTMLCanvasElement.prototype.toDataURL=function(...args){HTMLCanvasElement.prototype.toDataURL=original;throw Error('Synthetic holiday capture failure');};});
    await page.getByRole('button',{name:'查看這局成果',exact:true}).click();await expect(page.locator('.pt-feedback')).toContainText('圖片還沒產生');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','5100');await expect(page.locator('.fw-arcade-result')).toHaveCount(0);await partyCoveredToolsBounds(page);
  }
  // Both actual holiday result sources exercise the shared encoder's retries.
  await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toBlob,failed=new Set<string>();HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){const kind=type??'image/png';if(!failed.has(kind)){failed.add(kind);callback(null);return;}return original.call(this,callback,type,quality);};});
  await page.getByRole('button',{name:'查看這局成果',exact:true}).click();await expect(page.locator('.fw-arcade-result-heading')).toContainText('5100 分');await holidayFullscreen(page,rejected);
  const pngRetry=page.getByRole('button',{name:'重試產生成果圖',exact:true});await expect(pngRetry).toBeEnabled();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toHaveCount(0);await pngRetry.click();
  const jpegRetry=page.getByRole('button',{name:'重試準備工坊圖片',exact:true});await expect(jpegRetry).toBeEnabled();await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeDisabled();await jpegRetry.click();await expect(page.getByRole('button',{name:'發到自由工坊',exact:true})).toBeEnabled();await holidayFullscreen(page,rejected);
  const png=page.getByRole('link',{name:'下載完整成果 PNG',exact:true});await expect(png).toBeVisible();const download=page.waitForEvent('download');await png.click();const meta=await sharp((await(await download).path())!).metadata();expect([meta.format,meta.width,meta.height]).toEqual(['png',960,1200]);
  await page.getByRole('button',{name:'分享成果',exact:true}).click();await expect(page.locator('[data-game-share]')).toBeFocused();await socialEntries(page,'holiday');
  expect(writes).toEqual([]);expect(social).toEqual([]);expect(await page.evaluate(key=>sessionStorage.getItem(key),GAME_HANDOFF_KEY)).toBeNull();
  await page.getByRole('button',{name:'同一題再來一次',exact:true}).click();expect(new URL(page.url()).searchParams.get('seed')).toBe('42');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','ready');expect(errors).toEqual([]);
});

for(const light of [false,true])test(`PT-HOLIDAY-SCENE: ${light?'light':'native'} input rejects secondary, duplicate, cancelled and stale contacts with honest wrong-cell penalties`,async({page})=>{
  await openHolidayScene(page,light,true);await partyAdvance(page,250);
  const cells=page.locator('.pt-hole-controls button'),targets=holidayTargets(42,0),good=cells.nth(targets.good);
  await good.click({button:'right'});await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');
  // Synthetic dispatch is narrowly used for browser cancellation/secondary
  // sequences; successful scoring below always uses ordinary physical inputs.
  await good.dispatchEvent('pointerdown',{pointerId:71,isPrimary:false,button:0});await good.dispatchEvent('pointerup',{pointerId:71,isPrimary:false,button:0});await good.dispatchEvent('click',{detail:1});
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');
  await good.dispatchEvent('pointerdown',{pointerId:72,isPrimary:true,button:0});await good.dispatchEvent('pointercancel',{pointerId:72,isPrimary:true});await good.dispatchEvent('pointerup',{pointerId:72,isPrimary:true,button:0});await good.dispatchEvent('click',{detail:1});await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','0');
  await good.click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');await page.locator('.pt-canvas').press(String(targets.good+1));await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
  await cells.nth(targets.boss).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','40');const empty=[0,1,2,3,4,5].find(i=>i!==targets.good&&i!==targets.boss)!;await cells.nth(empty).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','25');
  for(const [index,key] of ['Space','Enter','pointer'].entries()){
    const round=1+index*2;await partyAdvance(page,round*PT.holidayRoundMs+250);const target=cells.nth(holidayTargets(42,round).good),score=await page.locator('.pt-root').getAttribute('data-party-score');
    if(key==='pointer'){const b=(await target.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();}else{await target.focus();await page.keyboard.down(key);}
    await partyAdvance(page,(round+1)*PT.holidayRoundMs+250);if(key==='pointer')await page.mouse.up();else await page.keyboard.up(key);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);
    await cells.nth(holidayTargets(42,round+1).good).click();await expect(page.locator('.pt-root')).not.toHaveAttribute('data-party-score',score!);
  }
  if(!light){
    await partyAdvance(page,8*PT.holidayRoundMs+250);const p=await holidayHitPoint(page,holidayTargets(42,8).good),score=await page.locator('.pt-root').getAttribute('data-party-score');
    await page.mouse.move(p.x,p.y);await page.mouse.down();await partyAdvance(page,9*PT.holidayRoundMs+250);await page.mouse.up();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',score!);
  }
  await partyAdvance(page,10*PT.holidayRoundMs+250);const assistive=cells.nth(holidayTargets(42,10).good),beforeAT=Number(await page.locator('.pt-root').getAttribute('data-party-score'));
  // AT activation supplies a detail-zero click without pointer/key down.
  await assistive.evaluate(button=>(button as HTMLButtonElement).click());await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',String(beforeAT+120));await expect(assistive).toBeDisabled();await holidayFullscreen(page,true);
  await partyAdvance(page,11*PT.holidayRoundMs+250);const held=cells.nth(holidayTargets(42,11).good);await held.focus();await page.keyboard.down('Space');
  const before=await page.locator('.pt-root').getAttribute('data-party-score');await page.getByRole('button',{name:'玩法與設定',exact:true}).click();await page.keyboard.up('Space');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',before!);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');const at=await partyElapsed(page);await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);
  await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'玩法與設定',exact:true})).toBeFocused();await holidayFullscreen(page,true);
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await page.getByRole('button',{name:'暫停',exact:true}).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',before!);
  await page.getByRole('button',{name:'重新開始',exact:true}).click();await expect(page.getByRole('button',{name:'確定重來',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'重新開始',exact:true})).toBeFocused();await holidayFullscreen(page,true);await page.keyboard.press('Escape');await expect(page.locator('.fullscreen-game')).not.toHaveClass(/fullscreen-game--viewport/);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score',before!);
});

for(const rejected of [false,true])test(`PT-HOLIDAY-SCENE: genuine context loss, explicit light fallback and native retry retain ${rejected?'rejected':'native'} fullscreen ownership`,async({page})=>{
  await openHolidayScene(page,false,rejected);await partyAdvance(page,250);await page.locator('.pt-canvas').press(String(holidayTargets(42,0).good+1));
  const lost=await page.locator('.pt-canvas canvas').evaluate(c=>{const ext=(c as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context');ext?.loseContext();return !!ext;});expect(lost).toBe(true);
  await expect(page.getByRole('alert')).toContainText('本局已暫停');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-state','paused');const at=await partyElapsed(page);await holidayFullscreen(page,rejected);
  await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();await expect(page.locator('.pt-light-grid button')).toHaveCount(6);await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);
  await page.getByRole('button',{name:'重試 3D，保留這局',exact:true}).click();await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','ready');await expect(page.locator('.pt-canvas canvas')).toHaveCount(1);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');expect(await partyElapsed(page)).toBe(at);await holidayFullscreen(page,rejected);
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await partyAdvance(page,PT.holidayRoundMs+250);const p=await holidayHitPoint(page,holidayTargets(42,1).good);await page.mouse.click(p.x,p.y);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','260');
});

for(const light of [false,true])for(const rejected of [false,true])for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375},{width:1440,height:900}])for(const scale of [1,1.25,2])test(`PT-HOLIDAY-SCENE: ${light?'light':'native'} ${rejected?'rejected':'native'} fullscreen ${viewport.width}x${viewport.height} ${scale*100}% text keeps safe bounds, true targets and modal Tab access`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);await openHolidayScene(page,light,rejected);
  const stage=page.locator('.fullscreen-game--holiday[data-game-stage]');
  const attachWorldEvidence=async(phase:'playing'|'resumed'|'normal')=>{
    if(scale!==2||viewport.width===1440)return;
    const name=`holiday-${light?'light':'native'}-${rejected?'rejected':'fullscreen'}-${viewport.width}x${viewport.height}-200-percent-${phase}`;
    await testInfo.attach(`${name}.json`,{body:JSON.stringify({ciSourceSha:process.env.GITHUB_SHA??null,viewport:page.viewportSize(),textScale:scale,phase,world:await page.locator('.pt-canvas').boundingBox(),gameplayCore:await page.locator('.pt-gameplay-core').boundingBox(),stage:await stage.boundingBox()},null,2),contentType:'application/json'});
    await testInfo.attach(`${name}.png`,{body:await page.screenshot(),contentType:'image/png'});
  };
  await stage.evaluate((root,factor)=>{
    const el=root as HTMLElement;for(const [side,value] of Object.entries({top:12,right:16,bottom:18,left:14}))el.style.setProperty(`--holiday-safe-${side}`,`${value}px`);
    // Text-only enlargement, not a claim that browser page zoom was automated.
    const styles=[root,...root.querySelectorAll('*')].filter((n):n is HTMLElement=>n instanceof HTMLElement).map(n=>({n,font:parseFloat(getComputedStyle(n).fontSize),line:parseFloat(getComputedStyle(n).lineHeight)}));
    for(const {n,font,line} of styles){n.style.fontSize=`${font*factor}px`;if(Number.isFinite(line))n.style.lineHeight=`${line*factor}px`;}
  },scale);
  await partyAdvance(page,250);await attachWorldEvidence('playing');await holidayStageBounds(page,scale);
  expect(await stage.evaluate(root=>{const style=getComputedStyle(root.querySelector('.pt-root')!);return ['top','right','bottom','left'].map(side=>parseFloat(style.getPropertyValue(`padding-${side}`)));})).toEqual([20,24,26,22]);
  const cells=page.locator('.pt-hole-controls button');for(let i=0;i<6;i++)await holidayControlHit(cells.nth(i));
  // Reverse traversal catches controls stranded before a centered scroll origin.
  await cells.last().focus();await holidayControlHit(cells.last());await cells.first().focus();await holidayControlHit(cells.first());await expect(cells.first()).toBeFocused();
  const good=cells.nth(holidayTargets(42,0).good);await good.click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
  if(!light){await partyAdvance(page,PT.holidayRoundMs+250);const p=await holidayHitPoint(page,holidayTargets(42,1).good);await page.mouse.click(p.x,p.y);await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','260');}
  const help=page.getByRole('button',{name:'玩法與設定',exact:true});await holidayControlHit(help);await help.click();
  const close=page.getByRole('button',{name:'回到遊戲',exact:true});await expect(close).toBeFocused();await holidayModalTextScale(page,scale);await holidayControlHit(close);
  const narrative=page.getByLabel('完整玩法說明',{exact:true});await narrative.focus();await expect(narrative).toBeFocused();
  await narrative.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  expect(await narrative.evaluate(el=>el.clientHeight>0&&el.scrollTop+el.clientHeight>=el.scrollHeight-1)).toBe(true);
  await holidayControlHit(close);
  const modal=page.locator('.pt-holiday-overlay').filter({has:close});await expect(modal).toBeVisible();
  const at=await partyElapsed(page);await page.clock.runFor(1000);expect(await partyElapsed(page)).toBe(at);
  for(let i=0;i<12;i++){await page.keyboard.press(i<6?'Tab':'Shift+Tab');expect(await modal.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
  await close.click();await expect(help).toBeFocused();await holidayFullscreen(page,rejected);await partyCoveredToolsBounds(page);
  const sound=page.getByRole('button',{name:'音效關',exact:true});await holidayControlHit(sound);await sound.click();await expect(page.getByRole('button',{name:'音效開',exact:true})).toHaveAttribute('aria-pressed','true');
  const motion=page.getByRole('button',{name:'減少動態關',exact:true});await holidayControlHit(motion);await motion.click();await expect(page.getByRole('button',{name:'減少動態開',exact:true})).toHaveAttribute('aria-pressed','true');
  const restart=page.getByRole('button',{name:'重新開始',exact:true});await holidayControlHit(restart);await restart.click();await holidayModalTextScale(page,scale);const group=page.getByRole('group',{name:'確認重新開始'});await expect(page.getByRole('button',{name:'確定重來',exact:true})).toBeFocused();
  for(let i=0;i<4;i++){await page.keyboard.press('Tab');expect(await group.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
  await page.keyboard.press('Escape');await expect(restart).toBeFocused();await holidayFullscreen(page,rejected);
  await page.getByRole('button',{name:'繼續這一局',exact:true}).click();await attachWorldEvidence('resumed');await holidayStageBounds(page,scale);
  await page.locator('.pt-canvas').focus();
  for(let i=0;i<16;i++){await page.keyboard.press('Tab');expect(await stage.evaluate(el=>el.contains(document.activeElement)&&!document.activeElement?.closest('[inert]'))).toBe(true);}
  await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();await expect(stage).not.toHaveAttribute('role','dialog');
  await partyScrollPaintedStageIntoView(stage);await attachWorldEvidence('normal');await holidayStageBounds(page,scale);
});

for(const rejected of [false,true])test(`PT-HOLIDAY-SCENE: explicit light selection rejects a late native module in ${rejected?'rejected':'native'} fullscreen`,async({page})=>{
  if(rejected)await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Synthetic fullscreen rejection','NotAllowedError'));});
  const now=new Date('2026-10-25T00:00:00Z');await page.clock.install({time:now});await page.clock.pauseAt(new Date(now.getTime()+60_000));
  let capture!:(route:Route)=>void;const requested=new Promise<Route>(resolve=>{capture=resolve;});
  await page.route(/\/assets\/stage-(?!batch-)[^/]+\.js(?:\?.*)?$/,route=>{capture(route);});
  await page.goto('/play?game=holiday&seed=42',{waitUntil:'domcontentloaded'});const route=await requested,response=await route.fetch(),url=route.request().url();
  await expect(page.locator('.pt-canvas')).toHaveAttribute('data-party-stage','loading');await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);
  await page.getByRole('button',{name:'改用輕量玩法',exact:true}).click();await page.getByRole('button',{name:'開始派對！',exact:true}).click();await holidayFullscreen(page,rejected);
  await partyAdvance(page,250);await page.locator('.pt-hole-controls button').nth(holidayTargets(42,0).good).click();await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');
  await route.fulfill({response});await page.evaluate(async moduleUrl=>{await import(moduleUrl);},url);
  await expect(page.locator('.pt-root')).toHaveAttribute('data-party-mode','light');await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','120');await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);await holidayFullscreen(page,rejected);
  await partyAdvance(page,PT.holidayRoundMs+250);await page.locator('.pt-canvas').press(String(holidayTargets(42,1).good+1));await expect(page.locator('.pt-root')).toHaveAttribute('data-party-score','260');await expect(page.locator('.pt-canvas canvas')).toHaveCount(0);
});
