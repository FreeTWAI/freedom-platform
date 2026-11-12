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

type GuideBox={left:number;right:number;top:number;bottom:number;width:number;height:number};
type GuidePaint={paintIssues:string[];stroke:string;strokeWidth:number;strokeOpacity:number;opacity:number;visible:boolean;length:number;bounds:GuideBox;owner:GuideBox;viewport:{width:number;height:number};samples:{painted:boolean;inputOwned:boolean}[]};
// SVG geometry boxes exclude stroke. A vertical Mx yVh path has zero geometric
// width even when its dashes are visibly painted. Check the actual paint contract
// instead, including inherited visibility, transformed stroke and hit ownership.
export function preparationGuideProblems(paint:GuidePaint):string[]{
  const issues:string[]=[...paint.paintIssues];
  const numbers=[paint.strokeWidth,paint.strokeOpacity,paint.opacity,paint.length,...Object.values(paint.bounds),...Object.values(paint.owner),...Object.values(paint.viewport)];
  if(!numbers.every(Number.isFinite))return ['non-finite guide geometry'];
  if(!paint.visible||paint.opacity<.99||paint.strokeOpacity<.99||paint.stroke==='none'||paint.stroke==='transparent'||paint.strokeWidth<=0)issues.push('unpainted guide');
  if(Math.abs(paint.length-189)>.01)issues.push('guide length');
  const b=paint.bounds,o=paint.owner;
  if(b.width<1||b.height<1||o.width<=0||o.height<=0)issues.push('empty painted bounds');
  if(b.left<o.left-1||b.right>o.right+1||b.top<o.top-1||b.bottom>o.bottom+1)issues.push('outside owner');
  if(b.left<0||b.right>paint.viewport.width||b.top<0||b.bottom>paint.viewport.height)issues.push('outside viewport');
  if(paint.samples.length!==3||paint.samples.some(sample=>!sample.painted||!sample.inputOwned))issues.push('unpainted dash or wrong input owner');
  return issues;
}

// This function is serialized unchanged into the browser and invoked directly by
// CPU boundary fixtures. Input ownership is not a compositing/occlusion proof.
export function observePreparationGuide(path:SVGPathElement,probe?:{target:'owner'|'ancestor';styles:Record<string,string>}){
  // A negative fixture must measure and restore in one JS task. In particular,
  // ResizeObserver must never consume the temporary one-pixel stage geometry.
  const probeTarget=probe?(probe.target==='ancestor'?path.closest('.ck-scene-wrap'):path.ownerSVGElement):null;
  if(probe&&!probeTarget)throw Error('Missing guide probe target');
  const previous=probeTarget?.getAttribute('style')??null;
  try{
    if(probe&&probeTarget)for(const [property,value] of Object.entries(probe.styles))(probeTarget as HTMLElement|SVGElement).style.setProperty(property,value);
    const svg=path.ownerSVGElement!,scene=path.closest('.ck-live-scene')!.querySelector('.ck-scene')!;
    const style=getComputedStyle(path),matrix=path.getScreenCTM()!,box=path.getBBox(),half=parseFloat(style.strokeWidth)/2;
    const corners=[[box.x-half,box.y-half],[box.x+box.width+half,box.y-half],[box.x-half,box.y+box.height+half],[box.x+box.width+half,box.y+box.height+half]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
    const left=Math.min(...corners.map(p=>p.x)),right=Math.max(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y)),bottom=Math.max(...corners.map(p=>p.y));
    const paintIssues:string[]=[],clips:{owner:string;left:number;right:number;top:number;bottom:number;clipX:boolean;clipY:boolean}[]=[];
    let visible=true,opacity=1;
    if(matrix.b!==0||matrix.c!==0||matrix.a<=0||matrix.d<=0)paintIssues.push('unsupported stroke transform');
    for(let ancestor:Element|null=path;ancestor;ancestor=ancestor.parentElement){
      const css=getComputedStyle(ancestor),owner=`${ancestor.tagName}.${ancestor.getAttribute('class')??''}`;
      visible&&=css.display!=='none'&&css.visibility==='visible'&&css.contentVisibility!=='hidden';opacity*=Number(css.opacity);
      // Current guide ancestry has no filters or masks. The existing viewfinder
      // drop-shadow is unrelated; do not erase its source or broadly allow filters.
      for(const property of ['clip-path','mask-image','-webkit-mask-image','mask-border-source','-webkit-mask-box-image-source','filter','backdrop-filter','-webkit-backdrop-filter','perspective','vector-effect']){
        const value=css.getPropertyValue(property).trim();
        if(value&&value!=='none')paintIssues.push(`unsupported ${property} on ${owner}`);
      }
      if(css.clip&&css.clip!=='auto')paintIssues.push(`unsupported clip on ${owner}`);
      if(css.mixBlendMode&&css.mixBlendMode!=='normal')paintIssues.push(`unsupported mix-blend-mode on ${owner}`);
      // Client clip rectangles below support unscaled CSS boxes, including the
      // production translate(-50%,-50%). SVG viewBox scaling is handled by CTM.
      if(css.transform&&css.transform!=='none'){
        const parts=/^matrix\(([^)]+)\)$/.exec(css.transform)?.[1].split(',').map(Number);
        if(!parts||parts.length!==6||!parts.every(Number.isFinite)||parts[0]!==1||parts[1]!==0||parts[2]!==0||parts[3]!==1)paintIssues.push(`unsupported CSS transform on ${owner}`);
      }
      for(const property of ['rotate','scale','zoom']){
        const value=css.getPropertyValue(property).trim(),allowed=property==='rotate'?['','none','0deg']:property==='scale'?['','none','1','1 1']:['','normal','1'];
        if(!allowed.includes(value))paintIssues.push(`unsupported ${property} on ${owner}`);
      }
      const contained=/(^|\s)(paint|strict|content)(\s|$)/.test(css.contain),clipsAxis=(value:string)=>['hidden','clip','auto','scroll'].includes(value);
      const clipX=contained||clipsAxis(css.overflowX),clipY=contained||clipsAxis(css.overflowY);
      if(!clipX&&!clipY)continue;
      const margin=css.getPropertyValue('overflow-clip-margin').trim();
      if(margin&&margin!=='0px')paintIssues.push(`unsupported overflow-clip-margin on ${owner}`);
      const rect=ancestor.getBoundingClientRect(),root=ancestor===document.documentElement;
      const width=root?document.documentElement.clientWidth:ancestor.clientWidth,height=root?innerHeight:ancestor.clientHeight;
      const clipLeft=root?0:rect.left+ancestor.clientLeft,clipTop=root?0:rect.top+ancestor.clientTop;
      // A central rectangle inset by the largest corner radii is conservative:
      // it never treats a rounded-off corner as visible. Unknown radii fail closed.
      const radius=(value:string)=>{
        const values=value.trim().split(/\s+/);if(values.length<1||values.length>2)return [NaN,NaN];
        return [values[0],values[1]??values[0]].map((part,index)=>/^\d*\.?\d+(px|%)$/.test(part)?parseFloat(part)*(part.endsWith('%')?(index?height:width)/100:1):NaN);
      };
      const [tl,tr,br,bl]=[css.borderTopLeftRadius,css.borderTopRightRadius,css.borderBottomRightRadius,css.borderBottomLeftRadius].map(radius);
      const clip={owner,left:clipLeft+Math.max(tl[0],bl[0]),right:clipLeft+width-Math.max(tr[0],br[0]),top:clipTop+Math.max(tl[1],tr[1]),bottom:clipTop+height-Math.max(bl[1],br[1]),clipX,clipY};
      clips.push(clip);
      if(![width,height,clip.left,clip.right,clip.top,clip.bottom].every(Number.isFinite)||width<=0||height<=0)paintIssues.push(`invalid ancestor clip on ${owner}`);
      else if((clipX&&(left<clip.left-1||right>clip.right+1))||(clipY&&(top<clip.top-1||bottom>clip.bottom+1)))paintIssues.push(`clipped by ancestor ${owner}`);
    }
    const dash=style.strokeDasharray.split(/[ ,]+/).map(value=>parseFloat(value)),period=dash[0]+dash[1],length=path.getTotalLength();
    if(dash.length!==2||!dash.every(value=>Number.isFinite(value)&&value>0))paintIssues.push('unsupported dash pattern');
    const last=Math.floor((length-dash[0])/period),samples=[0,Math.floor(last/2),last].map(index=>{
      const point=path.getPointAtLength(index*period+dash[0]/2),screen=new DOMPoint(point.x,point.y).matrixTransform(matrix),hit=document.elementFromPoint(screen.x,screen.y);
      return {local:{x:point.x,y:point.y},screen:{x:screen.x,y:screen.y},hit:hit?`${hit.tagName}.${hit.getAttribute('class')??''}`:null,painted:path.isPointInStroke(point),inputOwned:hit!==null&&(hit===scene||scene.contains(hit))};
    });
    const rect=svg.getBoundingClientRect();
    return {paintIssues,clips,centerline:{width:box.width,height:box.height},dash,stroke:style.stroke,strokeWidth:parseFloat(style.strokeWidth),strokeOpacity:Number(style.strokeOpacity),opacity,visible,length,bounds:{left,right,top,bottom,width:right-left,height:bottom-top},owner:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height},viewport:{width:document.documentElement.clientWidth,height:innerHeight},samples};
  }finally{
    if(probeTarget){
      // Flush SVG's lazily serialized CSSOM mutation before removing the
      // attribute, otherwise Chromium can recreate an empty style attribute.
      probeTarget.getAttribute('style');
      if(previous===null)probeTarget.removeAttribute('style');else probeTarget.setAttribute('style',previous);
    }
  }
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
  const mushroom=visual.id==='mushroom';
  async function mushroomGuide(mode:'native'|'svg',count:number){
    // Independent expected span, not the implementation helper under test.
    const x=.30+.40*(count+1)/(step.goal+1),path=page.locator(mode==='native'?'.ck-toy-guides path[stroke-dasharray="15 12"]':'.ck-visual-light path[stroke-dasharray="12 9"]');
    const owner=page.locator(mode==='native'?'.ck-toy-guides':'.ck-visual-light .ck-scene');
    await expect(owner).toBeVisible();
    await expect(path).toHaveAttribute('d',`M${x*800} 175V364`);
    await expect(path).toHaveCSS('visibility','visible');
    await expect(path).toHaveCSS('stroke',mode==='native'?'rgb(255, 240, 196)':'rgb(156, 77, 54)');
    await expect(path).toHaveCSS('stroke-width',mode==='native'?'6px':'4px');
    const paint=await path.evaluate(observePreparationGuide);
    expect(paint.centerline).toEqual({width:0,height:189});
    expect(preparationGuideProblems(paint)).toEqual([]);
    await testInfo.attach(`${recipe.id}-${mode}-guide-${count}-paint`,{body:JSON.stringify(paint),contentType:'application/json'});
    if(mode==='native'&&count===0||mode==='svg'&&count===1){
      // Formal CI exercises this same observer against mutations on the actual
      // production guide/ancestor, then restores them before any real gesture.
      const fixtures:{label:string;target:'owner'|'ancestor';styles:Record<string,string>;failure:string}[]=[
        {label:'clip-path',target:'owner',styles:{'clip-path':'inset(100%)'},failure:'unsupported clip-path'},
        {label:'mask-image',target:'owner',styles:{'mask-image':'linear-gradient(transparent, transparent)'},failure:'unsupported mask-image'},
        {label:'filter',target:'owner',styles:{filter:'opacity(0)'},failure:'unsupported filter'},
        {label:'ancestor-overflow',target:'ancestor',styles:{height:'1px','min-height':'0px','max-height':'1px',overflow:'hidden'},failure:'clipped by ancestor'},
      ];
      for(const fixture of fixtures)await test.step(`${mode} guide rejects ${fixture.label}`,async()=>{
        const target=fixture.target==='owner'?owner:page.locator('.ck-scene-wrap'),previous=await target.getAttribute('style');
        const rejected=await path.evaluate(observePreparationGuide,{target:fixture.target,styles:fixture.styles}),issues=preparationGuideProblems(rejected);
        expect(issues.some(issue=>issue.startsWith(fixture.failure))).toBe(true);
        expect(await target.getAttribute('style')).toBe(previous);
        expect(preparationGuideProblems(await path.evaluate(observePreparationGuide))).toEqual([]);
        await testInfo.attach(`${recipe.id}-${mode}-${fixture.label}-rejected`,{body:JSON.stringify({issues,observation:rejected}),contentType:'application/json'});
      });
    }
    if(mode==='svg'){
      const geometry=await page.locator('.ck-visual-light .ck-scene').evaluate((node,input)=>{
        const svg=node as SVGSVGElement,screen=svg.getScreenCTM()!;
        const groups=[...svg.querySelectorAll<SVGGElement>('[data-ingredient="mushroom"]')];
        const boxes=groups.map(group=>{const b=group.getBBox(),matrix=screen.inverse().multiply(group.getScreenCTM()!),corners=[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));return {left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))};});
        const target=new DOMPoint(input.x*800,276).matrixTransform(screen),whole=groups[input.count];
        const intersects=whole.getAttribute('data-preparation')==='whole'&&[...whole.querySelectorAll('polygon')].some(p=>p.isPointInFill(target.matrixTransform(p.getScreenCTM()!.inverse())));
        return {boxes,intersects};
      },{x,count});
      expect(geometry.intersects).toBe(true);expect(geometry.boxes).toHaveLength(step.goal);
      geometry.boxes.forEach(box=>{expect(box.left).toBeGreaterThanOrEqual(240);expect(box.right).toBeLessThanOrEqual(560);});
      for(let i=0;i<geometry.boxes.length;i++)for(let j=i+1;j<geometry.boxes.length;j++){
        const a=geometry.boxes[i],b=geometry.boxes[j];expect(b.left-a.right>=2||b.top-a.bottom>=2||a.top-b.bottom>=2).toBe(true);
      }
      await testInfo.attach(`${recipe.id}-svg-guide-${count}-geometry`,{body:JSON.stringify(geometry),contentType:'application/json'});
    }
    return x;
  }
  async function mushroomStroke(mode:'native'|'svg',count:number){
    const x=await mushroomGuide(mode,count),box=await page.locator('.ck-scene').boundingBox();expect(box).not.toBeNull();
    await page.mouse.move(box!.x+x*box!.width,box!.y+.23*box!.height);await page.mouse.down();
    await page.mouse.move(box!.x+x*box!.width,box!.y+.78*box!.height,{steps:5});await page.mouse.up();
  }
  const whole=await capturePreparationScreenshot(canvas,testInfo,`${recipe.id}-native-whole.png`);
  if(mushroom){await capturePreparationScreenshot(game,testInfo,`${recipe.id}-native-whole-stage.png`);await mushroomStroke('native',0);}
  else await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();
  await advance();
  await expect(meter).toHaveText(`1 / ${step.goal}`);
  const cut=await capturePreparationScreenshot(canvas,testInfo,`${recipe.id}-native-cut.png`);
  if(mushroom)await capturePreparationScreenshot(game,testInfo,`${recipe.id}-native-cut-stage.png`);
  expect(createHash('sha256').update(cut).digest('hex')).not.toBe(createHash('sha256').update(whole).digest('hex'));
  const stats=await host.evaluate(element=>({calls:Number((element as HTMLElement).dataset.renderCalls),geometries:Number((element as HTMLElement).dataset.renderGeometries),textures:Number((element as HTMLElement).dataset.renderTextures)}));
  expect(stats.calls).toBeGreaterThan(0);expect(stats.calls).toBeLessThanOrEqual(100);
  expect(stats.geometries).toBeGreaterThan(0);expect(stats.geometries).toBeLessThan(100);expect(stats.textures).toBeGreaterThanOrEqual(0);expect(stats.textures).toBeLessThanOrEqual(3);
  await testInfo.attach('native-preparation-diagnostics',{body:JSON.stringify({recipe:recipe.id,step:0,scope:'observed draw/resource counts, not FPS or human visual acceptance',...stats}),contentType:'application/json'});

  await page.getByRole('button',{name:'暫停',exact:true}).click();await expect(game).toHaveAttribute('data-cooking-state','paused');
  if(mushroom)await expect(page.locator('.ck-toy-guides')).toHaveCount(0);
  const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run as CookingRun,COOKING_RUN_KEY);
  expect(saved.active.count).toBe(1);expect(saved.step).toBe(0);expect(saved.reports).toEqual([]);
  await advance();await expect(meter).toHaveText(`1 / ${step.goal}`);
  await page.getByRole('button',{name:'繼續料理',exact:true}).click();await expect(game).toHaveAttribute('data-cooking-state','playing');
  await expect(meter).toHaveText(`1 / ${step.goal}`);
  if(mushroom)await mushroomGuide('native',1);
  await page.getByRole('button',{name:'輕量插畫',exact:true}).click();
  await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(canvas).toHaveCount(0);
  const food=page.locator('.ck-visual-light [data-ingredient]');
  async function expectFaces(count:number){
    const actual=await food.evaluateAll(groups=>groups.map(group=>({id:group.getAttribute('data-ingredient'),state:group.getAttribute('data-preparation'),layers:[...group.querySelectorAll('polygon')].map(p=>({points:p.getAttribute('points'),color:p.getAttribute('fill')}))})));
    expect(actual).toEqual(Array.from({length:step.goal},(_,i)=>({id:visual.id,state:i<count?'cut':'whole',layers:ingredientLayers(visual,i<count).map(layer=>({points:ingredientPolygonPoints(layer.points),color:layer.color}))})));
  }
  await expectFaces(1);await expect(meter).toHaveText(`1 / ${step.goal}`);
  await advance();
  if(mushroom)await mushroomStroke('svg',1);else await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();
  await expect(meter).toHaveText(`2 / ${step.goal}`);await expectFaces(2);
  if(mushroom)await mushroomGuide('svg',2);
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
  await advance();
  if(mushroom){await mushroomGuide('native',step.goal-1);await capturePreparationScreenshot(game,testInfo,`${recipe.id}-native-late-cut-stage.png`);}
  const late=await capturePreparationScreenshot(canvas,testInfo,`${recipe.id}-native-late-cut.png`);
  expect(createHash('sha256').update(late).digest('hex')).not.toBe(createHash('sha256').update(whole).digest('hex'));
  expect(createHash('sha256').update(late).digest('hex')).not.toBe(createHash('sha256').update(cut).digest('hex'));
  if(mushroom){
    await page.getByRole('button',{name:'輕量插畫',exact:true}).click();
    await expect(page.locator('.ck-visual-light')).toBeVisible();await expect(canvas).toHaveCount(0);
    await expectFaces(step.goal-1);await mushroomGuide('svg',step.goal-1);
    await capturePreparationScreenshot(game,testInfo,`${recipe.id}-svg-late-cut-stage.png`);
    await page.getByRole('button',{name:'立體料理台',exact:true}).click();
    await expect(page.locator('.ck-visual-3d')).toBeVisible();await expect(canvas).toHaveCount(1);
    await advance();await expect(meter).toHaveText(`${step.goal-1} / ${step.goal}`);
  }
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


// Additive native evidence for all nine operations. These recipes cover every
// operation using normal controls; no saved-run injection or test-only renderer.
for(const viewport of [{width:390,height:844},{width:667,height:375},{width:1440,height:900}])for(const id of ['rice-balls','margherita-pizza','pearl-milk-tea','egg-fried-rice'])test(`front kitchen journey: ${id} at ${viewport.width}x${viewport.height}`,async({page},testInfo)=>{
 const recipe=recipeOf(id)!,errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize(viewport);await page.clock.install();
 await page.goto(`/play?game=kitchen&practice=1&recipe=${id}&seed=42`);await expect(page.locator('.ck-visual-3d')).toBeVisible();
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));
 await page.getByRole('button',{name:'開始料理',exact:true}).click();
 const game=page.locator('.ck-game'),stage=page.locator('.fullscreen-game');
 await expect.poll(()=>page.evaluate(()=>({width:innerWidth,height:innerHeight}))).toEqual(viewport);
 const shot=async(kind:string,state:string)=>{await page.clock.runFor(40);await capturePreparationScreenshot(stage,testInfo,`front-${id}-${kind}-${state}-${viewport.width}x${viewport.height}.png`);};
 const scenePoint=async(x:number,y:number)=>{const b=(await page.locator('.ck-scene').boundingBox())!;return {x:b.x+x*b.width,y:b.y+y*b.height};};
 for(const [index,s] of recipe.steps.entries()){
  await expect(page.locator('[data-cooking-scene]')).toHaveAttribute('data-cooking-scene',s.kind);await expect(page.locator('.ck-visual-3d')).toBeVisible();
  await page.clock.runFor(160);
  if(viewport.width===390){
   const spacing=await game.evaluate(el=>{const scene=el.querySelector('.ck-live-scene')!.getBoundingClientRect(),dock=el.querySelector('.ck-game-controls')!.getBoundingClientRect(),mission=el.querySelector('.ck-stage-mission')!.getBoundingClientRect();return {above:scene.top-mission.bottom,below:dock.top-scene.bottom,bottom:dock.bottom,viewport:innerHeight};});
   expect(spacing.above).toBeGreaterThanOrEqual(10);expect(spacing.above).toBeLessThanOrEqual(14);expect(spacing.below).toBeGreaterThanOrEqual(10);expect(spacing.below).toBeLessThanOrEqual(14);expect(spacing.bottom).toBeLessThanOrEqual(spacing.viewport);
  }
  await shot(s.kind,'start');
  if(s.kind==='slice')for(let i=0;i<s.goal;i++){await page.clock.runFor(160);await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();if(i===0)await shot(s.kind,'cut');}
  if(s.kind==='mix'){
   const first=await scenePoint(.8,.52);await page.mouse.move(first.x,first.y);await page.mouse.down();
   for(let i=1;i<=s.goal*32;i++){const angle=i*Math.PI/16,p=await scenePoint(.5+.3*Math.cos(angle),.52+.3*Math.sin(angle));await page.mouse.move(p.x,p.y);if(i===16)await shot(s.kind,'stir');}await page.mouse.up();
  }
  if(s.kind==='knead')for(let i=0;i<s.goal;i++){await game.focus();await page.keyboard.down('Space');await page.clock.runFor(s.holdMs/2);if(i===0)await shot(s.kind,'press');await page.clock.runFor(s.holdMs/2);await page.keyboard.up('Space');await page.clock.runFor(160);}
  if(s.kind==='pan'||s.kind==='boil'||s.kind==='bake'){
   const slider=page.getByRole('slider'),b=(await slider.boundingBox())!;await slider.click({position:{x:8+(b.width-16)*s.heat/100,y:b.height/2}});
   if(s.kind==='pan'){await page.clock.runFor(s.durationMs*.55);await shot(s.kind,'heated');await page.getByRole('button',{name:'翻面！',exact:true}).click();await page.clock.runFor(s.durationMs*.65);}
   if(s.kind==='boil'){for(let i=0;i<3;i++){await page.clock.runFor(2300);if(i===0)await shot(s.kind,'foam');const skim=page.getByRole('button',{name:/撈掉泡沫/});if(await skim.isEnabled())await skim.click();}await page.clock.runFor(3000);}
   if(s.kind==='bake'){await page.clock.runFor(s.durationMs*.8);await shot(s.kind,'baked');await page.getByRole('button',{name:'出爐！',exact:true}).click();}
  }
  if(s.kind==='pour'){await game.focus();await page.keyboard.down('Space');await page.clock.runFor(s.durationMs*s.target/2);await shot(s.kind,'pouring');await page.clock.runFor(s.durationMs*s.target/2);await page.keyboard.up('Space');}
  if(s.kind==='fold')for(const [i,direction] of s.directions.entries()){await page.clock.runFor(160);await game.focus();await page.keyboard.press(`Arrow${direction[0].toUpperCase()+direction.slice(1)}`);if(i===0)await shot(s.kind,'folded');}
  if(s.kind==='plate')for(let i=0;i<s.goal;i++){await page.clock.runFor(160);await page.getByRole('button',{name:'放到提示位置',exact:true}).click();if(i===0)await shot(s.kind,'placed');}
  if(index<recipe.steps.length-1){const next=page.getByRole('button',{name:/^下一步：/});await expect(next).toBeVisible();await next.click();}
 }
 expect(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)!).run.status,COOKING_RUN_KEY)).toBe('done');await page.clock.resume();
 await expect(page.locator('.fw-arcade-result')).toBeVisible();await expect(page.getByRole('link',{name:'下載完整成果 PNG',exact:true})).toBeVisible({timeout:10_000});
 await capturePreparationScreenshot(page.locator('.fw-arcade-result'),testInfo,`front-${id}-completed-${viewport.width}x${viewport.height}.png`);expect(errors).toEqual([]);
});

// Separate evidence cases: never replace, shorten or relax the complete journeys
// above. Record real intermediate frames through normal controls, not injected
// run state. Frame times are requested virtual offsets, not a claimed video FPS.
for(const viewport of [{width:390,height:844},{width:667,height:375},{width:1440,height:900}])test(`native rice scoop intermediate evidence at ${viewport.width}x${viewport.height}`,async({page},testInfo)=>{
 const recipe=recipeOf('egg-fried-rice')!,slice=recipe.steps[0],pan=recipe.steps.find(s=>s.kind==='pan')!,errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize(viewport);await page.clock.install();
 await page.goto('/play?game=kitchen&practice=1&recipe=egg-fried-rice&seed=42');await expect(page.locator('.ck-visual-3d')).toBeVisible();
 await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())+1000));await page.getByRole('button',{name:'開始料理',exact:true}).click();
 await expect(page.locator('[data-cooking-scene]')).toHaveAttribute('data-cooking-scene','slice');
 for(let i=0;i<slice.goal;i++){await page.clock.runFor(160);await page.getByRole('button',{name:'沿線切一刀',exact:true}).click();}
 await page.getByRole('button',{name:/^下一步：/}).click();await expect(page.locator('[data-cooking-scene]')).toHaveAttribute('data-cooking-scene','pan');
 const slider=page.getByRole('slider'),bounds=(await slider.boundingBox())!;await slider.click({position:{x:8+(bounds.width-16)*pan.heat/100,y:bounds.height/2}});await page.clock.runFor(pan.durationMs*.55);
 const stage=page.locator('.fullscreen-game'),native=page.locator('.ck-kitchen-canvas canvas');await expect(page.locator('.ck-visual-3d')).toBeVisible();await expect(native).toBeVisible();
 const frames:Array<{name:string;requestedVirtualMs:number;pageClockMs:number;sha256:string;nativeSha256:string}>=[];
 const capture=async(name:string,requestedVirtualMs:number)=>{await expect(native).toBeVisible();const pageClockMs=await page.evaluate(()=>performance.now());const prefix=`scoop-${viewport.width}x${viewport.height}-${name}`;
  const body=await capturePreparationScreenshot(stage,testInfo,`${prefix}.png`),canvas=await capturePreparationScreenshot(native,testInfo,`${prefix}-native.png`);
  frames.push({name,requestedVirtualMs,pageClockMs,sha256:createHash('sha256').update(body).digest('hex'),nativeSha256:createHash('sha256').update(canvas).digest('hex')});
 };
 await capture('before',0);await page.getByRole('button',{name:'翻面！',exact:true}).click();const strokeClockMs=await page.evaluate(()=>performance.now());
 let previous=0;for(const [name,offset] of [['push',100],['lift',225],['settled',500]] as const){await page.clock.runFor(offset-previous);await capture(name,offset);previous=offset;}
 await testInfo.attach(`scoop-${viewport.width}x${viewport.height}-timeline.json`,{body:Buffer.from(JSON.stringify({recipe:recipe.id,seed:42,viewport,strokeClockMs,frames,note:'Native screenshots at requested virtual offsets; no synthesized frames, not a measured real-time video.'},null,2)),contentType:'application/json'});
 expect(new Set(frames.map(f=>f.nativeSha256)).size).toBeGreaterThan(1);expect(frames[2].pageClockMs).toBeGreaterThan(frames[1].pageClockMs);expect(frames[3].pageClockMs-strokeClockMs).toBeGreaterThanOrEqual(450);
 await expect(page.locator('[data-cooking-scene]')).toHaveAttribute('data-cooking-scene','pan');expect(errors).toEqual([]);
});
