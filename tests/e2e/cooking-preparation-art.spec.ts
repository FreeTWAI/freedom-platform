import {test,expect} from './fixtures.js';
import type {Locator,TestInfo} from '@playwright/test';
import {createHash} from 'node:crypto';
import {COOKING_RULES,recipeOf} from '../../apps/portal-web/src/games/cooking/catalog.js';
import {ingredientVisual,ingredientLayers,ingredientPolygonPoints} from '../../apps/portal-web/src/games/cooking/ingredient-visuals.js';
import {COOKING_RUN_KEY} from '../../apps/portal-web/src/games/cooking/storage.js';
import type {CookingRun} from '../../apps/portal-web/src/games/cooking/domain.js';

// Successful pinned runs discard outputPath files. Buffer attachments survive
// in the JSON report carried by the existing default-shard artifact.
export async function capturePreparationScreenshot(target:Pick<Locator,'screenshot'>,testInfo:Pick<TestInfo,'attach'>,name:string){
  const body=await target.screenshot({type:'png'});
  await testInfo.attach(name,{body,contentType:'image/png'});
  return body;
}

// The browser fixture cannot claim physical notch/home-indicator emulation.
// Override production env-backed properties to stress actual CSS deterministically.
const kitchenInsets={top:28,right:24,bottom:32,left:40};
async function setKitchenInsets(root:Locator,enabled:boolean){await root.evaluate((el,values)=>{for(const [side,value] of Object.entries(values.insets)){if(values.enabled)(el as HTMLElement).style.setProperty(`--game-safe-${side}`,`${value}px`);else (el as HTMLElement).style.removeProperty(`--game-safe-${side}`);}},{insets:kitchenInsets,enabled});}
async function kitchenInsetViolations(root:Locator,paused=false){return root.evaluate((el,settings)=>{
 const r=el.getBoundingClientRect(),limits={left:r.left+settings.insets.left,right:r.right-settings.insets.right,top:r.top+settings.insets.top,bottom:r.bottom-settings.insets.bottom},issues:string[]=[];
 const contains=(b:DOMRect)=>b.left>=limits.left-1&&b.right<=limits.right+1&&b.top>=limits.top-1&&b.bottom<=limits.bottom+1;
 const overlap=(a:DOMRect,b:DOMRect)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
 const controls=[...el.querySelectorAll<HTMLElement>('.fullscreen-game__button,.ck-console-toolbar button,.ck-visual-tools button,'+(settings.paused?'.ck-scene-overlay>button':'.ck-tool-action'))].filter(n=>n.getClientRects().length&&!n.closest('[inert]'));
 for(const control of controls){const b=control.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);if(!contains(b)||b.width<44||b.height<44||!(hit===control||control.contains(hit)))issues.push(`control:${control.getAttribute('aria-label')||control.textContent}`);}
 for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)if(overlap(controls[i].getBoundingClientRect(),controls[j].getBoundingClientRect()))issues.push('controls overlap');
 if(settings.paused){if(!contains(el.querySelector('.ck-scene-overlay')!.getBoundingClientRect()))issues.push('pause overlay');}
 else{const scene=el.querySelector('.ck-live-scene')!.getBoundingClientRect(),dock=el.querySelector('.ck-game-controls')!.getBoundingClientRect(),mode=el.querySelector('.ck-visual-tools')!.getBoundingClientRect();if(!contains(scene)||scene.width<=0||scene.height<=0)issues.push('food');if(!contains(dock))issues.push('dock');if(overlap(scene,dock)||overlap(mode,dock))issues.push('scene/dock overlap');}
 return issues;
 },{insets:kitchenInsets,paused});}

// Real production renderer and user controls. No injected run, replacement
// server, skipped native rendering, screenshot baseline update or fake geometry.
// Captures are review artifacts, not automatic human-art acceptance or FPS proof.
for(const fixture of [
  {id:'fish-and-chips',width:320,motion:'reduce'},
  {id:'pumpkin-soup',width:1440,motion:'no-preference'},
  {id:'baked-sweet-potato',width:320,motion:'reduce'},
  {id:'cream-risotto',width:1440,motion:'no-preference'},
  {id:'plant-burger',width:320,motion:'reduce'},
] as const)test(`preparation art: ${fixture.id} native cuts survive pause and SVG fallback`,async({page},testInfo)=>{
  const recipe=recipeOf(fixture.id)!,step=recipe.steps[0],visual=ingredientVisual(step.ingredient,step.shape)!;
  expect(step.kind).toBe('slice');expect(visual.cutLayers).toBeDefined();
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:fixture.width,height:900});await page.emulateMedia({reducedMotion:fixture.motion});
  const started=new Date('2026-11-07T12:00:00Z');await page.clock.install({time:started});
  await page.goto(`/play?game=kitchen&practice=1&recipe=${recipe.id}&seed=42`);
  await expect(page.locator('.ck-visual-3d')).toBeVisible();
  const game=page.locator('.ck-game'),meter=page.locator('.ck-meter-copy'),canvas=page.locator('.ck-kitchen-canvas canvas'),host=page.locator('.ck-kitchen-canvas');
  await expect(canvas).toHaveCount(1);
  await page.clock.pauseAt(new Date(started.getTime()+60_000));
  await page.getByRole('button',{name:'開始料理',exact:true}).click();
  // #1305 can enter fullscreen on Begin. Use its real control to restore the
  // requested viewport before reviewing artwork; never force the browser API.
  const fullscreen=page.locator('.fullscreen-game__button[aria-pressed]');
  const exit=page.getByRole('button',{name:'退出全螢幕',exact:true});
  // requestFullscreen can resolve before fullscreenchange updates the button.
  // Wait for the actual entered presentation, rather than skipping a late exit.
  await expect(exit).toBeVisible();await expect(fullscreen).toHaveAttribute('aria-pressed','true');
  await expect(exit).toHaveAttribute('aria-disabled','false');await exit.click();
  await expect(fullscreen).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('dialog',{name:'遊戲全螢幕',exact:true})).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>({width:innerWidth,height:innerHeight}))).toEqual({width:fixture.width,height:900});
  async function expectLayout(){
    const layout=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,page:document.documentElement.scrollWidth,parts:['.ck-live-scene','.ck-game-controls','.ck-tool-action'].map(selector=>{const element=document.querySelector<HTMLElement>(selector)!,box=element.getBoundingClientRect();return {selector,left:box.left,right:box.right,width:box.width,scroll:element.scrollWidth,client:element.clientWidth};})}));
    expect(layout.viewport).toBeGreaterThan(0);expect(layout.viewport).toBeLessThanOrEqual(fixture.width);expect(layout.page).toBeLessThanOrEqual(layout.viewport+1);
    for(const part of layout.parts){expect(part.width,part.selector).toBeGreaterThan(0);expect(part.left,part.selector).toBeGreaterThanOrEqual(-1);expect(part.right,part.selector).toBeLessThanOrEqual(layout.viewport+1);expect(part.scroll,part.selector).toBeLessThanOrEqual(part.client+1);}
  }
  await expectLayout();
  await expect(game).toHaveAttribute('data-cooking-state','playing');await expect(meter).toHaveText(`0 / ${step.goal}`);
  // Advance the actual game clock by its cooldown plus one 30fps render interval,
  // rather than sleeping and hoping that React or the GPU has caught up.
  const advance=()=>page.clock.runFor(COOKING_RULES.actionCooldownMs+1000/30);
  await advance();await expect(host).toHaveAttribute('data-render-calls',/^[1-9]\d*$/);
  const whole=await capturePreparationScreenshot(canvas,testInfo,`${recipe.id}-native-whole.png`);
  await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await advance();
  await expect(meter).toHaveText(`1 / ${step.goal}`);
  const cut=await capturePreparationScreenshot(canvas,testInfo,`${recipe.id}-native-cut.png`);
  expect(createHash('sha256').update(cut).digest('hex')).not.toBe(createHash('sha256').update(whole).digest('hex'));
  const stats=await host.evaluate(element=>({calls:Number((element as HTMLElement).dataset.renderCalls),geometries:Number((element as HTMLElement).dataset.renderGeometries),textures:Number((element as HTMLElement).dataset.renderTextures)}));
  expect(stats.calls).toBeGreaterThan(0);expect(stats.calls).toBeLessThanOrEqual(100);
  expect(stats.geometries).toBeGreaterThan(0);expect(stats.geometries).toBeLessThan(100);expect(stats.textures).toBeGreaterThanOrEqual(0);expect(stats.textures).toBeLessThanOrEqual(3);
  await testInfo.attach('native-preparation-diagnostics',{body:JSON.stringify({recipe:recipe.id,step:0,scope:'observed draw/resource counts, not FPS or human visual acceptance',...stats}),contentType:'application/json'});

  await page.getByRole('button',{name:'暫停',exact:true}).click();await expect(game).toHaveAttribute('data-cooking-state','paused');
  const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run as CookingRun,COOKING_RUN_KEY);
  expect(saved.active.count).toBe(1);expect(saved.step).toBe(0);expect(saved.reports).toEqual([]);
  await advance();await expect(meter).toHaveText(`1 / ${step.goal}`);
  await page.getByRole('button',{name:'繼續料理',exact:true}).click();await expect(game).toHaveAttribute('data-cooking-state','playing');
  await expect(meter).toHaveText(`1 / ${step.goal}`);
  await page.getByRole('button',{name:'輕量插畫',exact:true}).click();
  await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(canvas).toHaveCount(0);
  const food=page.locator('.ck-visual-light [data-ingredient]');
  async function expectFaces(count:number){
    const actual=await food.evaluateAll(groups=>groups.map(group=>({id:group.getAttribute('data-ingredient'),state:group.getAttribute('data-preparation'),layers:[...group.querySelectorAll('polygon')].map(p=>({points:p.getAttribute('points'),color:p.getAttribute('fill')}))})));
    expect(actual).toEqual(Array.from({length:step.goal},(_,i)=>({id:visual.id,state:i<count?'cut':'whole',layers:ingredientLayers(visual,i<count).map(layer=>({points:ingredientPolygonPoints(layer.points),color:layer.color}))})));
  }
  await expectFaces(1);await expect(meter).toHaveText(`1 / ${step.goal}`);
  await advance();await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();
  await expect(meter).toHaveText(`2 / ${step.goal}`);await expectFaces(2);
  await expectLayout();
  await capturePreparationScreenshot(page.locator('.ck-visual-light'),testInfo,`${recipe.id}-svg-two-cuts.png`);
  // Return through the real renderer control and progress to the last intact
  // piece. This exposes late-count support/knife errors hidden by a first cut.
  await page.getByRole('button',{name:'立體料理台',exact:true}).click();
  await expect(canvas).toHaveCount(1);await expect(page.locator('.ck-visual-3d')).toBeVisible();
  for(let count=2;count<step.goal-1;count++){
    await advance();await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();
    await expect(meter).toHaveText(`${count+1} / ${step.goal}`);
  }
  await advance();await capturePreparationScreenshot(canvas,testInfo,`${recipe.id}-native-late-cut.png`);
  await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();
  await expect(game).toHaveCount(0);await expect(canvas).toHaveCount(0);expect(errors).toEqual([]);
});

// Keep the five viewport art reviews above intact. These two integration cases
// retain the actual WebGL renderer while exercising the fullscreen owner, with
// only the rejected case replacing requestFullscreen (never the native case).
for(const mode of ['native','rejected'] as const)test(`preparation art fullscreen: pumpkin-soup keeps native cuts through ${mode} presentation at 667x375`,async({page},testInfo)=>{
  const viewport={width:667,height:375},recipe=recipeOf('pumpkin-soup')!,step=recipe.steps[0],visual=ingredientVisual(step.ingredient,step.shape)!;
  expect(step.kind).toBe('slice');expect(visual.cutLayers).toBeDefined();
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});
  if(mode==='rejected')await page.addInitScript(()=>{
    Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});
    Element.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Synthetic fullscreen rejection','NotAllowedError'));
  });
  const started=new Date('2026-11-07T12:00:00Z');await page.clock.install({time:started});
  await page.goto(`/play?game=kitchen&practice=1&recipe=${recipe.id}&seed=42`);
  const presentation=page.locator('.fullscreen-game'),game=page.locator('.ck-game'),meter=page.locator('.ck-meter-copy'),canvas=page.locator('.ck-kitchen-canvas canvas'),host=page.locator('.ck-kitchen-canvas');
  await expect(page.locator('.ck-visual-3d')).toBeVisible();await expect(canvas).toHaveCount(1);
  const originalCanvas=await canvas.elementHandle();
  const advance=()=>page.clock.runFor(COOKING_RULES.actionCooldownMs+1000/30);
  async function expectPresentation(){
    await expect(presentation).toHaveAttribute('role','dialog');
    await expect(page.getByRole('button',{name:'退出全螢幕',exact:true})).toHaveAttribute('aria-disabled','false');
    if(mode==='native'){
      await expect.poll(()=>presentation.evaluate(element=>document.fullscreenElement===element)).toBe(true);
      await expect(presentation).not.toHaveClass(/fullscreen-game--viewport/);
    }else{
      await expect(presentation).toHaveClass(/fullscreen-game--viewport/);
      expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();
    }
    await expect.poll(()=>page.evaluate(()=>({width:innerWidth,height:innerHeight}))).toEqual(viewport);
  }
  async function expectLandscape(stage:string){
    await expectPresentation();
    const layout=await presentation.evaluate(element=>({width:innerWidth,height:innerHeight,scroll:element.scrollWidth,client:element.clientWidth,page:document.documentElement.scrollWidth,
      parts:['.ck-live-scene','.ck-game-controls','.ck-tool-action'].map(selector=>{const node=element.querySelector<HTMLElement>(selector)!,box=node.getBoundingClientRect();return {selector,left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height,scroll:node.scrollWidth,client:node.clientWidth};})}));
    await testInfo.attach(`${mode}-${stage}-landscape-geometry`,{body:JSON.stringify(layout),contentType:'application/json'});
    expect(layout.scroll).toBeLessThanOrEqual(layout.client+1);expect(layout.page).toBeLessThanOrEqual(viewport.width+1);
    for(const part of layout.parts){
      expect(part.width,part.selector).toBeGreaterThan(0);expect(part.left,part.selector).toBeGreaterThanOrEqual(-1);expect(part.right,part.selector).toBeLessThanOrEqual(viewport.width+1);expect(part.scroll,part.selector).toBeLessThanOrEqual(part.client+1);
      // The live scene and direct action must fit together. The remaining tool
      // tray may use the existing outer vertical scroll for secondary controls.
      if(part.selector!=='.ck-game-controls'){expect(part.top,part.selector).toBeGreaterThanOrEqual(-1);expect(part.bottom,part.selector).toBeLessThanOrEqual(viewport.height+1);expect(part.height,part.selector).toBeGreaterThanOrEqual(44);}
    }
  }
  async function expectNativeResources(stage:string){
    await expect(canvas).toHaveCount(1);
    expect(await canvas.evaluate(element=>{const gl=(element as HTMLCanvasElement).getContext('webgl2');return !!gl&&!gl.isContextLost();})).toBe(true);
    await expect(host).toHaveAttribute('data-render-calls',/^[1-9]\d*$/);
    const stats=await host.evaluate(element=>({calls:Number((element as HTMLElement).dataset.renderCalls),geometries:Number((element as HTMLElement).dataset.renderGeometries),textures:Number((element as HTMLElement).dataset.renderTextures)}));
    await testInfo.attach(`${mode}-${stage}-native-resources`,{body:JSON.stringify({recipe:recipe.id,scope:'actual WebGL draw/resource counts, not FPS or human art acceptance',...stats}),contentType:'application/json'});
    expect(stats.calls).toBeGreaterThan(0);expect(stats.calls).toBeLessThanOrEqual(100);expect(stats.geometries).toBeGreaterThan(0);expect(stats.geometries).toBeLessThan(100);expect(stats.textures).toBeGreaterThanOrEqual(0);expect(stats.textures).toBeLessThanOrEqual(3);
  }
  const savedRun=()=>page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run as CookingRun,COOKING_RUN_KEY);
  await page.clock.pauseAt(new Date(started.getTime()+60_000));
  await page.getByRole('button',{name:'開始料理',exact:true}).click();await expectPresentation();
  await expect(game).toHaveAttribute('data-cooking-state','playing');await expect(game).toBeFocused();await expect(meter).toHaveText(`0 / ${step.goal}`);
  await advance();await expectNativeResources('whole');await expectLandscape('started');
  const whole=await capturePreparationScreenshot(canvas,testInfo,`pumpkin-soup-${mode}-fullscreen-native-whole.png`);
  await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await advance();
  await expectPresentation();await expect(meter).toHaveText(`1 / ${step.goal}`);await expectNativeResources('cut');await expectLandscape('cut');
  const cut=await capturePreparationScreenshot(canvas,testInfo,`pumpkin-soup-${mode}-fullscreen-native-cut.png`);
  expect(createHash('sha256').update(cut).digest('hex')).not.toBe(createHash('sha256').update(whole).digest('hex'));
  await testInfo.attach(`pumpkin-soup-${mode}-fullscreen-landscape.png`,{body:await page.screenshot({type:'png'}),contentType:'image/png'});
  await page.getByRole('button',{name:'暫停',exact:true}).click();await expect(game).toHaveAttribute('data-cooking-state','paused');await expectPresentation();
  const paused=await savedRun();expect(paused.active.count).toBe(1);expect(paused.step).toBe(0);expect(paused.reports).toEqual([]);
  await advance();expect(await savedRun()).toEqual(paused);await expect(meter).toHaveText(`1 / ${step.goal}`);
  await page.getByRole('button',{name:'繼續料理',exact:true}).click();await advance();
  await expect(game).toHaveAttribute('data-cooking-state','playing');await expect(game).toBeFocused();await expectPresentation();await expect(meter).toHaveText(`1 / ${step.goal}`);await expectLandscape('resumed');
  expect(await originalCanvas!.evaluate(element=>element.isConnected&&element===document.querySelector('.ck-kitchen-canvas canvas'))).toBe(true);
  await page.getByRole('button',{name:'輕量插畫',exact:true}).click();await expectPresentation();
  await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(canvas).toHaveCount(0);
  expect(await originalCanvas!.evaluate(element=>element.isConnected)).toBe(false);await originalCanvas!.dispose();
  async function expectFaces(count:number){
    const actual=await page.locator('.ck-visual-light [data-ingredient]').evaluateAll(groups=>groups.map(group=>({id:group.getAttribute('data-ingredient'),state:group.getAttribute('data-preparation'),layers:[...group.querySelectorAll('polygon')].map(p=>({points:p.getAttribute('points'),color:p.getAttribute('fill')}))})));
    expect(actual).toEqual(Array.from({length:step.goal},(_,i)=>({id:visual.id,state:i<count?'cut':'whole',layers:ingredientLayers(visual,i<count).map(layer=>({points:ingredientPolygonPoints(layer.points),color:layer.color}))})));
  }
  await expectFaces(1);await advance();await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();
  await expect(meter).toHaveText(`2 / ${step.goal}`);await expectFaces(2);await expectLandscape('svg');
  await capturePreparationScreenshot(page.locator('.ck-visual-light'),testInfo,`pumpkin-soup-${mode}-fullscreen-svg-two-cuts.png`);
  await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();
  await expect(page.getByRole('button',{name:'⛶ 全螢幕',exact:true})).toHaveAttribute('aria-disabled','false');
  await expect(page.getByRole('dialog',{name:'遊戲全螢幕',exact:true})).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');await expect(meter).toHaveText(`2 / ${step.goal}`);await expectFaces(2);
  await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();await expectPresentation();
  await expect(meter).toHaveText(`2 / ${step.goal}`);await expectFaces(2);
  await page.getByRole('button',{name:'立體料理台',exact:true}).click();await expect(page.locator('.ck-visual-3d')).toBeVisible();await advance();
  await expectPresentation();await expectNativeResources('reentered');await expect(meter).toHaveText(`2 / ${step.goal}`);
  await capturePreparationScreenshot(canvas,testInfo,`pumpkin-soup-${mode}-fullscreen-reentered-native-two-cuts.png`);
  await page.getByRole('button',{name:'暫停',exact:true}).click();const restored=await savedRun();
  expect(restored.id).toBe(paused.id);expect(restored.step).toBe(0);expect(restored.active.count).toBe(2);expect(restored.reports).toEqual([]);
  await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();await expect(game).toHaveCount(0);await expect(canvas).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');expect(errors).toEqual([]);
});

// A fullscreen viewport is the stage itself, not a taller document containing
// an illustration followed by an unrelated controls card. Keep every normal
// gameplay action in this one screen. Enlarged text may scroll the tool dock.
for(const viewport of [{width:320,height:568},{width:390,height:844},{width:667,height:375},{width:1440,height:900}])test(`immersive kitchen: canvas and controls share ${viewport.width}x${viewport.height} stage`,async({page},testInfo)=>{
  const step=recipeOf('fish-and-chips')!.steps[0];
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize(viewport);
  const started=new Date('2026-11-08T12:00:00Z');await page.clock.install({time:started});
  await page.goto('/play?game=kitchen&practice=1&recipe=fish-and-chips&seed=42');
  await expect(page.locator('.ck-visual-3d')).toBeVisible();
  await page.clock.pauseAt(new Date(started.getTime()+60_000));
  await page.getByRole('button',{name:'開始料理',exact:true}).click();
  const fullscreen=page.locator('.fullscreen-game'),stage=page.locator('[data-game-stage]');
  await expect(fullscreen).toHaveAttribute('role','dialog');
  await expect(page.getByRole('button',{name:'退出全螢幕',exact:true})).toHaveAttribute('aria-disabled','false');
  await expect(stage.getByRole('button',{name:'沿線切一刀',exact:true})).toBeVisible();
  const geometry=await fullscreen.evaluate(element=>{
    const area=element.querySelector('[data-game-stage]')!.getBoundingClientRect();
    const rect=(node:Element)=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    return {viewport:{width:innerWidth,height:innerHeight},stage:rect(element.querySelector('[data-game-stage]')!),scroll:element.scrollHeight,height:element.clientHeight,
      controls:[...element.querySelectorAll('.fullscreen-game__button,.ck-console-toolbar button,.ck-tool-action,.ck-visual-tools button')].map(node=>({text:node.textContent,...rect(node)})),
      canvas:rect(element.querySelector('.ck-live-scene')!),inside:!!element.querySelector('[data-game-stage] .ck-game-controls'),area:area.width*area.height};
  });
  expect(geometry.inside).toBe(true);expect(geometry.area).toBeGreaterThan(0);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.height+1);
  expect(geometry.stage.width).toBeCloseTo(geometry.viewport.width,0);expect(geometry.stage.height).toBeCloseTo(geometry.viewport.height,0);
  for(const control of geometry.controls){expect(control.width,control.text??'').toBeGreaterThanOrEqual(44);expect(control.height,control.text??'').toBeGreaterThanOrEqual(44);expect(control.left).toBeGreaterThanOrEqual(-1);expect(control.top).toBeGreaterThanOrEqual(-1);expect(control.right).toBeLessThanOrEqual(geometry.viewport.width+1);expect(control.bottom).toBeLessThanOrEqual(geometry.viewport.height+1);}
  expect(geometry.canvas.left).toBeGreaterThanOrEqual(-1);expect(geometry.canvas.right).toBeLessThanOrEqual(geometry.viewport.width+1);expect(geometry.canvas.top).toBeGreaterThanOrEqual(-1);expect(geometry.canvas.bottom).toBeLessThanOrEqual(geometry.viewport.height+1);
  await testInfo.attach('immersive-stage-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});
  if(viewport.height<520){
    await page.locator('.ck-help summary').click();
    const panels=await page.evaluate(()=>{const a=document.querySelector('.ck-visual-tools')!.getBoundingClientRect(),b=document.querySelector('.ck-game-controls')!.getBoundingClientRect();return {modeBottom:a.bottom,dockTop:b.top};});
    expect(panels.modeBottom).toBeLessThanOrEqual(panels.dockTop);
    await page.locator('.ck-help summary').click();
  }
  await page.clock.runFor(COOKING_RULES.actionCooldownMs+1000/30);
  // Use the real pointer path across the guide, rather than an injected run.
  const surface=page.locator('.ck-scene'),box=(await surface.boundingBox())!;
  const path=page.locator('.ck-toy-guides path').first(),guide=await path.getAttribute('d'),x=Number(guide!.match(/^M([\d.]+)/)![1])/800;
  await page.mouse.move(box.x+box.width*x,box.y+box.height*.2);await page.mouse.down();
  await page.mouse.move(box.x+box.width*x,box.y+box.height*.8,{steps:8});await page.mouse.up();
  await expect(page.locator('.ck-meter-copy')).toHaveText(`1 / ${step.goal}`);
  await page.clock.runFor(COOKING_RULES.actionCooldownMs+1000/30);
  await capturePreparationScreenshot(fullscreen,testInfo,`immersive-${viewport.width}x${viewport.height}-cut.png`);
  await setKitchenInsets(fullscreen,true);await page.clock.runFor(1000/30);
  await expect.poll(()=>kitchenInsetViolations(fullscreen)).toEqual([]);
  await capturePreparationScreenshot(fullscreen,testInfo,`immersive-${viewport.width}x${viewport.height}-insets-native.png`);
  await page.getByRole('button',{name:'暫停',exact:true}).click();await expect.poll(()=>kitchenInsetViolations(fullscreen,true)).toEqual([]);
  const insetHelp=page.locator('.ck-scene-overlay .ck-help summary');await insetHelp.focus();await insetHelp.press('Space');await expect(page.locator('.ck-help')).toHaveAttribute('open','');
  await expect.poll(()=>kitchenInsetViolations(fullscreen,true)).toEqual([]);
  await capturePreparationScreenshot(fullscreen,testInfo,`immersive-${viewport.width}x${viewport.height}-insets-paused-help.png`);
  await page.getByRole('button',{name:'繼續料理',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toHaveText(`1 / ${step.goal}`);
  await setKitchenInsets(fullscreen,false);await page.clock.runFor(1000/30);
  if(viewport.width===320){
    await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();
    await page.locator('.ck-help summary').click();await page.clock.runFor(1000/30);
    await expect.poll(()=>page.evaluate(()=>{const canvas=document.querySelector('.ck-live-scene')!.getBoundingClientRect(),dock=document.querySelector('.ck-game-controls')!.getBoundingClientRect();return canvas.bottom<=dock.top;})).toBe(true);
    await capturePreparationScreenshot(fullscreen,testInfo,'immersive-320x568-windowed-help.png');
    await page.locator('.ck-help summary').click();
    await page.getByRole('button',{name:'⛶ 全螢幕',exact:true}).click();
    await expect(fullscreen).toHaveAttribute('role','dialog');
  }
  await page.getByRole('button',{name:'暫停',exact:true}).click();await expect(page.locator('.ck-game')).toHaveAttribute('data-cooking-state','paused');
  await expect(page.locator('.ck-game-controls')).toHaveJSProperty('inert',true);
  await page.getByRole('button',{name:'繼續料理',exact:true}).focus();await page.keyboard.press('Tab');
  await expect(page.locator('.ck-scene-overlay .ck-help summary')).toBeFocused();
  expect(await page.locator('.ck-help summary').evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  await page.keyboard.press('Space');await expect(page.locator('.ck-help')).toHaveAttribute('open','');
  await expect(page.locator('.ck-game')).toHaveAttribute('data-cooking-state','paused');
  await expect(page.locator('.ck-meter-copy')).toHaveText(`1 / ${step.goal}`);
  await capturePreparationScreenshot(fullscreen,testInfo,`immersive-${viewport.width}x${viewport.height}-paused-help.png`);
  await page.getByRole('button',{name:'繼續料理',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toHaveText(`1 / ${step.goal}`);
  await page.getByRole('button',{name:'輕量插畫',exact:true}).click();await expect(page.locator('.ck-visual-light')).toBeVisible();
  await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toHaveText(`2 / ${step.goal}`);
  await expect(page.locator('.ck-kitchen-canvas canvas')).toHaveCount(0);
  await capturePreparationScreenshot(fullscreen,testInfo,`immersive-${viewport.width}x${viewport.height}-fallback.png`);
  await setKitchenInsets(fullscreen,true);await page.clock.runFor(1000/30);await expect.poll(()=>kitchenInsetViolations(fullscreen)).toEqual([]);
  await capturePreparationScreenshot(fullscreen,testInfo,`immersive-${viewport.width}x${viewport.height}-insets-svg.png`);
  await setKitchenInsets(fullscreen,false);
  await page.getByRole('button',{name:'重新做',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'重新做這盤料理',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'繼續這一盤',exact:true}).click();
  await expect(page.locator('.ck-meter-copy')).toHaveText(`2 / ${step.goal}`);
  await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();
  await expect(fullscreen).toHaveCount(0);expect(errors).toEqual([]);
});


test('immersive kitchen: 320x568 viewport fallback keeps controls separate',async({page},testInfo)=>{
  const step=recipeOf('fish-and-chips')!.steps[0];
  await page.setViewportSize({width:320,height:568});
  await page.addInitScript(()=>{Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:true});Element.prototype.requestFullscreen=()=>Promise.reject(new DOMException('Synthetic fullscreen rejection','NotAllowedError'));});
  await page.goto('/play?game=kitchen&practice=1&recipe=fish-and-chips&seed=42');
  await expect(page.locator('.ck-visual-3d')).toBeVisible();
  await page.getByRole('button',{name:'開始料理',exact:true}).click();
  await expect(page.locator('.fullscreen-game--viewport')).toBeVisible();
  const geometry=await page.evaluate(()=>{const a=document.querySelector('.ck-visual-tools button')!.getBoundingClientRect(),b=document.querySelector('.fullscreen-game__bar')!.getBoundingClientRect();return {modeRight:a.right,barLeft:b.left,barRight:b.right,width:innerWidth};});
  expect(geometry.modeRight).toBeLessThanOrEqual(geometry.barLeft);expect(geometry.barRight).toBeLessThanOrEqual(geometry.width);
  await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await expect(page.locator('.ck-meter-copy')).toHaveText(`1 / ${step.goal}`);
  await capturePreparationScreenshot(page.locator('.fullscreen-game'),testInfo,'immersive-320x568-viewport.png');
  await page.getByRole('button',{name:'退出全螢幕',exact:true}).click();
  await expect(page.locator('.fullscreen-game--viewport')).toHaveCount(0);
});
