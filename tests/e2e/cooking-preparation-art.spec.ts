import {test,expect} from './fixtures.js';
import {createHash} from 'node:crypto';
import {COOKING_RULES,recipeOf} from '../../apps/portal-web/src/games/cooking/catalog.js';
import {ingredientVisual,ingredientLayers,ingredientPolygonPoints} from '../../apps/portal-web/src/games/cooking/ingredient-visuals.js';
import {COOKING_RUN_KEY} from '../../apps/portal-web/src/games/cooking/storage.js';
import type {CookingRun} from '../../apps/portal-web/src/games/cooking/domain.js';

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
  await expect(fullscreen).toHaveAttribute('aria-disabled','false');
  const exit=page.getByRole('button',{name:'退出全螢幕',exact:true});
  if(await exit.count())await exit.click();
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
  const whole=await canvas.screenshot({path:testInfo.outputPath(`${recipe.id}-native-whole.png`)});
  await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();await advance();
  await expect(meter).toHaveText(`1 / ${step.goal}`);
  const cut=await canvas.screenshot({path:testInfo.outputPath(`${recipe.id}-native-cut.png`)});
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
  await page.locator('.ck-visual-light').screenshot({path:testInfo.outputPath(`${recipe.id}-svg-two-cuts.png`)});
  await page.getByRole('button',{name:'← 遊戲大廳',exact:true}).click();
  await expect(game).toHaveCount(0);await expect(canvas).toHaveCount(0);expect(errors).toEqual([]);
});
