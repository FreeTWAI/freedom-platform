import * as kitchenPresentation from '../../apps/portal-web/src/games/cooking/kitchen-presentation';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {buildSync,transformSync} from 'esbuild';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as ingredients from '../../apps/portal-web/src/games/cooking/ingredient-visuals';
import * as cues from '../../apps/portal-web/src/games/cooking/cues';
import * as domain from '../../apps/portal-web/src/games/cooking/domain';
import {ingredientVisual,ingredientLayers,ingredientPolygonPoints} from '../../apps/portal-web/src/games/cooking/ingredient-visuals';
import {RECIPES,type Shape} from '../../apps/portal-web/src/games/cooking/catalog';

const cases=[['香蕉','fruit','banana'],['檸檬','fruit','citrus'],['柚子片','fruit','citrus'],['番茄','fruit','tomato'],['芒果','fruit','mango'],['芒果丁','fruit','mango'],['酪梨','greens','avocado'],['馬鈴薯','carrot','potato'],['南瓜','carrot','pumpkin'],['地瓜','carrot','sweet-potato'],['蘑菇','dough','mushroom']] as const;
test('ingredient visuals match only explicit labels and their existing shape',()=>{
  for(const [label,shape,id] of cases){
    assert.equal(ingredientVisual(label,shape)?.id,id);
    for(const other of ['greens','carrot','meat','rice','dough','noodle','egg','fruit','cream','chocolate','fish'] as const)if(other!==shape)assert.equal(ingredientVisual(label,other),null,`${label}/${other}`);
    assert.equal(ingredientVisual(label,'cream'),null);
    assert.equal(ingredientVisual(label,shape==='greens'?'fruit':'greens'),null);
    for(const changed of [` ${label}`,`${label} `,`${label}醬`,`${label}與生菜`])assert.equal(ingredientVisual(changed,shape),null);
  }
  for(const label of ['__proto__','constructor','toString','','番茄醬','香蕉奶昔','酪梨與番茄','新鮮蔬菜']){
    for(const shape of ['fruit','greens','meat','dough'] as Shape[])assert.equal(ingredientVisual(label,shape),null);
  }
});
test('actual catalog adds only five preparation steps and preserves the original seven',()=>{
  const covered=RECIPES.flatMap(recipe=>recipe.steps.flatMap((step,index)=>ingredientVisual(step.ingredient,step.shape)?[`${recipe.id}/${index}`]:[]));
  assert.deepEqual(covered,['cream-risotto/0','fish-and-chips/0','fish-and-chips/3','seafood-paella/0','yuzu-soda/0','banana-smoothie/0','mango-shaved-ice/0','mango-shaved-ice/1','pumpkin-soup/0','baked-sweet-potato/0','avocado-toast/0','plant-burger/0']);
  assert.equal(RECIPES.length,66);
});
test('shared original contours are finite, nondegenerate, bounded and modest',()=>{
  for(const [label,shape] of cases){
    const visual=ingredientVisual(label,shape)!;
    assert.ok(new Set([...visual.layers,...(visual.cutLayers??[])].map(layer=>layer.color)).size<=4,'both states share at most four opaque materials');
    for(const layers of [visual.layers,...(visual.cutLayers?[visual.cutLayers]:[])]){
    assert.ok(layers.length>=2&&layers.length<=7,label);
    for(const layer of layers){
      assert.match(layer.color,/^#[0-9a-f]{6}$/);
      assert.ok(layer.points.length>=3&&layer.points.length<=16);
      let area=0;
      layer.points.forEach(([x,y],i)=>{
        assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x)<=1&&Math.abs(y)<=1);
        const [nextX,nextY]=layer.points[(i+1)%layer.points.length];area+=x*nextY-y*nextX;
      });
      assert.ok(Math.abs(area)>.01,'each filled contour has area');
      const svg=ingredientPolygonPoints(layer.points).split(' ').map(pair=>pair.split(',').map(Number));
      assert.deepEqual(svg,layer.points.map(([x,y])=>[x*26,y*26]),'SVG uses the same complete contour, not an independent glyph');
    }
    }
  }
});
test('contours have no self intersections and concave banana remains a crescent',()=>{
  const cross=(a:readonly number[],b:readonly number[],c:readonly number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(const [label,shape] of cases)for(const {points} of [...ingredientVisual(label,shape)!.layers,...(ingredientVisual(label,shape)!.cutLayers??[])]){
    for(let i=0;i<points.length;i++)for(let j=i+2;j<points.length;j++){
      if(i===0&&j===points.length-1)continue;
      const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
      assert.ok(!(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0),`${label}: crossing edges ${i}/${j}`);
    }
  }
  const banana=ingredientVisual('香蕉','fruit')!.layers[0].points;
  const turns=banana.map((p,i)=>cross(p,banana[(i+1)%banana.length],banana[(i+2)%banana.length]));
  assert.ok(turns.some(n=>n>0)&&turns.some(n=>n<0),'banana is not another oval or berry');
});
test('shared visual data is deeply immutable and calls reuse the same definitions',()=>{
  for(const [label,shape] of cases){
    const visual=ingredientVisual(label,shape)!;
    assert.equal(ingredientVisual(label,shape),visual);
    assert.ok(Object.isFrozen(visual)&&Object.isFrozen(visual.layers));
    if(visual.cutLayers)assert.ok(Object.isFrozen(visual.cutLayers));
    for(const layer of [...visual.layers,...(visual.cutLayers??[])]){assert.ok(Object.isFrozen(layer)&&Object.isFrozen(layer.points));for(const point of layer.points)assert.ok(Object.isFrozen(point));}
    const before=JSON.stringify(visual);ingredientPolygonPoints(visual.layers[0].points);assert.equal(JSON.stringify(visual),before);
  }
});

test('preparation states have different actual contours and leave old visuals unchanged',()=>{
  for(const [label,shape] of cases){
    const visual=ingredientVisual(label,shape)!;
    assert.equal(ingredientLayers(visual),visual.layers);
    if(visual.cutLayers){
      assert.equal(ingredientLayers(visual,true),visual.cutLayers);
      assert.notDeepEqual(visual.layers.map(l=>l.points),visual.cutLayers.map(l=>l.points),'a cut is not a palette swap');
    }else assert.equal(ingredientLayers(visual,true),visual.layers);
  }
  for(const label of ['馬鈴薯與紅蘿蔔','南瓜濃湯','奶油地瓜','野菇','野菇與洋蔥','蘑菇醬'])for(const shape of ['carrot','dough','greens','cream'] as const)assert.equal(ingredientVisual(label,shape),null);
  assert.equal(ingredientVisual('地瓜','dough'),null,'the baking stage is outside this five-step slice');
});

function svgScene(){
  const module={exports:{} as {CookingScene:React.ComponentType<any>}};
  const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/CookingIllustration.tsx',import.meta.url),'utf8');
  runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,require:(id:string)=>{
    if(id==='react/jsx-runtime')return jsxRuntime;if(id==='./ingredient-visuals')return ingredients;
    if(id==='./cues')return cues;if(id==='./domain')return domain;throw Error(id);
  }});
  return (run:domain.CookingRun)=>renderToStaticMarkup(React.createElement(module.exports.CookingScene,{run,point:null,onPointerDown(){},onPointerMove(){},onPointerUp(){},onPointerCancel(){}}));
}
test('production SVG reveals only actual cut progress, including pause, resume and restart',()=>{
  const render=svgScene();
  for(const recipe of RECIPES){
    const step=recipe.steps[0],visual=ingredientVisual(step.ingredient,step.shape);if(!visual?.cutLayers)continue;
    const run={...domain.newCookingRun(recipe,42,'preparation_svg'),status:'playing' as const};
    for(const status of ['playing','paused'] as const)for(const count of [0,1,step.goal,0]){
      const frame={...run,status,elapsed:5000,active:{...run.active,count}},before=JSON.stringify(frame),html=render(frame);
      const groups=[...html.matchAll(/data-ingredient="([^"]+)" data-preparation="(whole|cut)">([\s\S]*?)<\/g>/g)];
      assert.equal(groups.length,step.goal);
      groups.forEach((group,i)=>{
        assert.equal(group[1],visual.id);assert.equal(group[2],i<count?'cut':'whole');
        const polygons=[...group[3].matchAll(/<polygon points="([^"]*)" fill="([^"]*)"/g)],layers=ingredientLayers(visual,i<count);
        assert.equal(polygons.length,layers.length);
        polygons.forEach((polygon,j)=>{assert.equal(polygon[1],ingredientPolygonPoints(layers[j].points));assert.equal(polygon[2],layers[j].color);});
      });
      assert.equal(JSON.stringify(frame),before,'render does not advance or mutate the run');
      assert.ok(html.includes(`${step.title}操作區`));
      assert.equal(html,render({...frame,elapsed:15000}),'elapsed time alone cannot reveal a cut');
    }
  }
});

function preparationContract(environment:Record<string,unknown>={}){
  type Capture=(target:{screenshot(options:{type:'png'}):Promise<Buffer>},info:{attach(name:string,options:{body:Buffer;contentType:string}):Promise<void>},name:string)=>Promise<Buffer>;
  const module={exports:{} as {capturePreparationScreenshot:Capture;preparationGuideProblems:(paint:any)=>string[];observePreparationGuide:(path:any,probe?:any)=>any}};
  const source=readFileSync(new URL('../e2e/cooking-preparation-art.spec.ts',import.meta.url),'utf8'),registered:string[]=[];
  runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require:(id:string)=>{
    if(id==='./fixtures.js')return {test(name:string){registered.push(name);}};
    if(['node:crypto','../../apps/portal-web/src/games/cooking/catalog.js','../../apps/portal-web/src/games/cooking/ingredient-visuals.js','../../apps/portal-web/src/games/cooking/storage.js'].includes(id))return {};
    throw Error(id);
  },...environment});
  assert.equal(registered.filter(name=>name.startsWith('preparation art:')).length,5,'preserve the five original real cases; do not run a fake browser');
  assert.deepEqual(registered.filter(name=>!name.startsWith('preparation art:')),[...['native','rejected'].map(mode=>`preparation art fullscreen: pumpkin-soup keeps native cuts through ${mode} presentation at 667x375`),...['320x568','390x844','667x375','1440x900'].map(size=>`immersive kitchen: canvas and controls share ${size} stage`),'immersive kitchen: 320x568 viewport fallback keeps controls separate',...['390x844','667x375','1440x900'].flatMap(size=>['rice-balls','margherita-pizza','pearl-milk-tea','egg-fried-rice'].map(id=>`front kitchen journey: ${id} at ${size}`)),...['390x844','667x375','1440x900'].map(size=>`native rice scoop intermediate evidence at ${size}`)]);
  return module.exports;
}
test('preparation capture attaches each exact PNG buffer instead of a temporary path',async()=>{
  const capture=preparationContract().capturePreparationScreenshot,body=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4P9P4PwAHMQLLfnZo0AAAAABJRU5ErkJggg==','base64');
  const names:string[]=[];
  for(const recipe of ['fish-and-chips','pumpkin-soup','baked-sweet-potato','cream-risotto','plant-burger'])for(const state of ['native-whole','native-cut','svg-two-cuts']){
    const name=`${recipe}-${state}.png`;let screenshots=0,attachments=0;
    const actual=await capture({async screenshot(options){assert.equal(options.type,'png');assert.deepEqual(Object.keys(options),['type']);screenshots++;return body;}},{async attach(actualName,options){
      assert.equal(actualName,name);assert.equal(options.body,body);assert.equal(options.contentType,'image/png');assert.equal('path' in options,false);attachments++;names.push(actualName);
    }},name);
    assert.equal(actual,body,'hash comparison uses the same bytes as the attachment');assert.equal(screenshots,1);assert.equal(attachments,1);
  }
  assert.equal(new Set(names).size,15);
});
test('preparation capture awaits attachment completion and propagates capture or attachment failures',async()=>{
  const capture=preparationContract().capturePreparationScreenshot,body=Buffer.from('synthetic transport fixture'),failure=Error('capture_or_attach_failed');let attached=false;
  await assert.rejects(capture({async screenshot(){throw failure;}},{async attach(){attached=true;}},'failed-capture.png'),error=>error===failure);assert.equal(attached,false);
  await assert.rejects(capture({async screenshot(){return body;}},{async attach(){throw failure;}},'failed-attach.png'),error=>error===failure);
  let release!:()=>void,entered!:()=>void,resolved=false;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const pending=capture({async screenshot(){return body;}},{async attach(){entered();await gate;}},'pending.png').then(()=>{resolved=true;});
  await started;assert.equal(resolved,false,'capture must not resolve before attach finishes');release();await pending;assert.equal(resolved,true);
});

// StrictMode/export probes bundle the real component directly without a CSS
// output target. Presentation CSS belongs to the arcade entry, not this module.
test('guided kitchen retains its JavaScript-only component bundle boundary',()=>{
  const bundle=buildSync({entryPoints:['apps/portal-web/src/games/cooking/CookingGame.tsx'],bundle:true,write:false,platform:'browser',format:'iife'});
  assert.equal(bundle.outputFiles.length,1);assert.ok(bundle.outputFiles[0].contents.length>0);
});

test('only explicit mushroom slice guides move, with independent coordinates and unchanged cut scoring',()=>{
 for(const recipe of RECIPES)for(let index=0;index<recipe.steps.length;index++){
  const step=recipe.steps[index],mushroom=step.kind==='slice'&&step.ingredient==='蘑菇'&&step.shape==='dough';
  let run=domain.actCooking({...domain.newCookingRun(recipe,42,'mushroom-scale'),step:index},{kind:'start',step:index},1000);
  for(let count=0;count<step.goal;count++){
   const expected=mushroom?.30+.40*(count+1)/(step.goal+1):.22+.56*(count+1)/(step.goal+1);
   assert.equal(domain.cutGuide({...run,active:{...run.active,count}}),expected,`${recipe.id}/${index}/${count}`);
   if(mushroom){
    const now=1500+count*500;
    const missed=domain.actCooking(run,{kind:'cut',step:index,x1:0,y1:.23,x2:0,y2:.78},now);assert.equal(missed.active.count,count);
    run=domain.actCooking(run,{kind:'cut',step:index,x1:expected,y1:.23,x2:expected,y2:.78},now);assert.equal(run.active.count,count+1);
   }
  }
  if(mushroom){assert.equal(run.status,'step-result');assert.equal(run.reports.length,1);assert.equal(run.reports[0].score,100);assert.equal(run.active.mistakes,0);}
 }
});


test('lightweight mushroom glyph bounds remain separate and each real guide intersects its own whole polygon',()=>{
 const render=svgScene(),contains=(points:readonly (readonly number[])[],x:number,y:number)=>{
  let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
   const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
 };
 for(const recipe of RECIPES)for(let stepIndex=0;stepIndex<recipe.steps.length;stepIndex++){
  const step=recipe.steps[stepIndex],visual=ingredientVisual(step.ingredient,step.shape);if(step.kind!=='slice'||!visual)continue;
  const run={...domain.newCookingRun(recipe,42,'svg-mushroom-guides'),step:stepIndex,status:'playing' as const};
  for(let count=0;count<=step.goal;count++){
   const html=render({...run,active:{...run.active,count}});
   const groups=[...html.matchAll(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(([-\d.]+)\)" data-ingredient="([^"]+)" data-preparation="(whole|cut)"/g)];
   if(!visual.cutLayers)continue;
   assert.equal(groups.length,Math.min(step.goal,8));
   type GlyphBox={minX:number;maxX:number;minY:number;maxY:number};
   const boxes:GlyphBox[]=groups.map((g,i):GlyphBox=>{
    const [x,y,angle,scale]=g.slice(1,5).map(Number);const mushroom:boolean=visual.id==='mushroom';
    assert.equal(x,mushroom?(.30+.40*(i+1)/(step.goal+1))*800:235+i*330/(step.goal-1));
    assert.equal(scale,i<count?42/70:(mushroom?Math.min(65,(320/(step.goal+1)-4)*70/52):65)/70);
    const radians=angle*Math.PI/180;const points:number[][]=ingredientLayers(visual,i<count).flatMap(l=>l.points.map(([px,py])=>[x+26*scale*(px*Math.cos(radians)-py*Math.sin(radians)),y+26*scale*(px*Math.sin(radians)+py*Math.cos(radians))]));
    const box={minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))};
    if(mushroom){
     assert.ok(box.minX>=240&&box.maxX<=560,'all actual polygon vertices stay within the new span');
     if(i>=count){assert.equal(angle,0);assert.equal(y,276);assert.ok(contains(ingredientLayers(visual)[0].points,0,0),'guide at the glyph centre intersects filled whole food, not air');}
    }
    return box;
   });
   if(visual.id==='mushroom')for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
    const a=boxes[i],b=boxes[j];assert.ok(b.minX-a.maxX>=4||b.minY-a.maxY>=4||a.minY-b.maxY>=4,'whole and cut glyphs leave an independently measured visible gap');
   }
  }
 }
});

test('painted vertical guide accepts a zero-width geometric path only through its real stroke contract',()=>{
  const check=preparationContract().preparationGuideProblems;
  // Browser measurement expands the zero-width centerline by its visible stroke.
  // This fixture validates the diagnostic contract, not browser rendering.
  const paint={paintIssues:[],stroke:'rgb(255, 240, 196)',strokeWidth:6,strokeOpacity:1,opacity:1,visible:true,length:189,bounds:{left:107,right:113,top:172,bottom:367,width:6,height:195},owner:{left:0,right:800,top:0,bottom:560,width:800,height:560},viewport:{width:800,height:560},samples:Array.from({length:3},()=>({painted:true,inputOwned:true}))};
  assert.deepEqual([...check(paint)],[]);
  for(const patch of [{visible:false},{opacity:0},{strokeOpacity:0},{stroke:'none'},{stroke:'transparent'},{strokeWidth:0}])assert.ok(check({...paint,...patch}).includes('unpainted guide'));
  assert.ok(check({...paint,length:0}).includes('guide length'));
  assert.ok(check({...paint,bounds:{...paint.bounds,width:0}}).includes('empty painted bounds'));
  assert.ok(check({...paint,bounds:{...paint.bounds,right:802}}).includes('outside owner'));
  assert.ok(check({...paint,viewport:{width:112,height:560}}).includes('outside viewport'));
  for(const samples of [[],[{painted:true,inputOwned:true}],paint.samples.map((sample,i)=>({...sample,painted:i!==1})),paint.samples.map((sample,i)=>({...sample,inputOwned:i!==1}))])assert.ok(check({...paint,samples}).includes('unpainted dash or wrong input owner'));
  for(const value of [NaN,Infinity,-Infinity])assert.deepEqual([...check({...paint,length:value})],['non-finite guide geometry']);
});

test('mushroom browser journeys retain real pointer cuts and measure both native and SVG paint at early and late counts',()=>{
  const source=readFileSync(new URL('../e2e/cooking-preparation-art.spec.ts',import.meta.url),'utf8');
  assert.ok(source.includes('await expect(owner).toBeVisible()'));
  assert.ok(source.includes("await expect(path).toHaveCSS('visibility','visible')"));
  assert.ok(source.includes('path.isPointInStroke(point)')&&source.includes('document.elementFromPoint(screen.x,screen.y)'));
  assert.ok(source.includes('getScreenCTM()')&&source.includes('getTotalLength()')&&source.includes('preparationGuideProblems(paint)'));
  assert.ok(source.includes("await mushroomStroke('native',0)")&&source.includes("await mushroomStroke('svg',1)"));
  assert.ok(source.includes("await mushroomGuide('native',step.goal-1)")&&source.includes("await mushroomGuide('svg',step.goal-1)"));
  assert.ok(source.includes('await page.mouse.down()')&&source.includes('await page.mouse.up()'));
  assert.ok(source.includes("await path.evaluate(observePreparationGuide)"));
  for(const label of ['clip-path','mask-image','filter','ancestor-overflow'])assert.ok(source.includes(`label:'${label}'`));
  assert.ok(source.includes("probeTarget.setAttribute('style',previous)"));
  for(const state of ['native-whole-stage','native-cut-stage','native-late-cut-stage','svg-late-cut-stage'])assert.ok(source.includes(`\${recipe.id}-${state}.png`),state);
});

function guideObserverFixture(){
  type Style=Record<string,string>;
  const defaults:Style={stroke:'rgb(255, 240, 196)',strokeWidth:'6px',strokeOpacity:'1',opacity:'1',display:'block',visibility:'visible',contentVisibility:'visible',strokeDasharray:'15px, 12px',clipPath:'none',maskImage:'none',webkitMaskImage:'none',filter:'none',backdropFilter:'none',perspective:'none',vectorEffect:'none',clip:'auto',mixBlendMode:'normal',transform:'none',rotate:'none',scale:'none',zoom:'1',contain:'none',overflowX:'visible',overflowY:'visible',overflowClipMargin:'0px',borderTopLeftRadius:'0px',borderTopRightRadius:'0px',borderBottomRightRadius:'0px',borderBottomLeftRadius:'0px'};
  const box=(left:number,top:number,width:number,height:number)=>({left,top,width,height,right:left+width,bottom:top+height});
  const propertyName=(property:string)=>property.replace(/^-webkit-/,'webkit-').replace(/-([a-z])/g,(_,letter:string)=>letter.toUpperCase());
  const make=(name:string,rect:ReturnType<typeof box>,initial:Style={})=>{
    const style={...defaults,...initial};
    Object.defineProperty(style,'setProperty',{value:(property:string,value:string)=>{style[propertyName(property)]=value;}});
    return {tagName:name.startsWith('svg')?'svg':'DIV',style,parentElement:null as any,clientLeft:0,clientTop:0,clientWidth:rect.width,clientHeight:rect.height,getAttribute:(attribute:string)=>attribute==='style'?JSON.stringify(style):name,setAttribute:(_attribute:string,value:string)=>{for(const key of Object.keys(style))delete style[key];Object.assign(style,JSON.parse(value));},removeAttribute:()=>{for(const key of Object.keys(style))delete style[key];Object.assign(style,defaults,initial);},getBoundingClientRect:()=>rect};
  };
  const root=make('fullscreen-game',box(0,0,600,420),{overflowX:'hidden',overflowY:'hidden',borderTopLeftRadius:'20px',borderTopRightRadius:'20px',borderBottomRightRadius:'20px',borderBottomLeftRadius:'20px'});
  const host=make('ck-live-scene',box(20,50,440,320),{overflowX:'hidden',overflowY:'hidden',transform:'matrix(1, 0, 0, 1, -220, -160)'});host.parentElement=root;
  const svg=make('svg.ck-toy-guides',box(40,70,400,280),{overflowX:'hidden',overflowY:'hidden'});svg.parentElement=host;
  const scene={tagName:'svg',getAttribute:()=> 'ck-scene',contains:(node:unknown)=>node===path};
  const matrix={a:.5,b:0,c:0,d:.5,e:40,f:70};
  const path={...make('guide',box(95,157.5,0,94.5)),parentElement:svg,ownerSVGElement:svg,closest:(selector:string)=>selector==='.ck-scene-wrap'?host:({querySelector:()=>scene}),getScreenCTM:()=>matrix,getBBox:()=>({x:110,y:175,width:0,height:189}),getTotalLength:()=>189,getPointAtLength:(s:number)=>({x:110,y:175+s}),isPointInStroke:(p:{x:number;y:number})=>{const [dash,gap]=path.style.strokeDasharray.split(/[, ]+/).map(parseFloat);return p.x===110&&(p.y-175)%(dash+gap)<dash;}};
  let hit:unknown=scene;
  const environment={DOMPoint:class {constructor(public x:number,public y:number){}matrixTransform(m:typeof matrix){return {x:this.x*m.a+this.y*m.c+m.e,y:this.x*m.b+this.y*m.d+m.f};}},document:{documentElement:root,elementFromPoint:()=>hit},innerHeight:420,getComputedStyle:(element:typeof root)=>({...element.style,getPropertyValue:(property:string)=>element.style[propertyName(property)]??''})};
  const contract=preparationContract(environment);
  return {path,svg,host,root,matrix,setHit:(value:unknown)=>{hit=value;},observe:()=>contract.observePreparationGuide(path),probe:(probe:any)=>contract.observePreparationGuide(path,probe),problems:()=>contract.preparationGuideProblems(contract.observePreparationGuide(path))};
}

test('actual guide observer accepts current clipping ancestry and transforms native/SVG dash samples',()=>{
  // These source checks bind the fixture's allowed effects to actual production
  // rules. This CPU fixture is not a DOM layout or browser-rendering substitute.
  const immersive=readFileSync(new URL('../../apps/portal-web/src/games/cooking/immersive-kitchen.css',import.meta.url),'utf8');
  assert.match(immersive,/\.fullscreen-game\.fullscreen-game--integrated\s*\{[^}]*overflow: hidden;[^}]*border-radius: 20px;/s);
  assert.match(immersive,/\.ck-live-scene\s*\{[^}]*transform: translate\(-50%, -50%\);[^}]*border-radius: 0;[^}]*overflow: hidden;/s);
  const toy=readFileSync(new URL('../../apps/portal-web/src/games/toy-console.css',import.meta.url),'utf8');
  assert.match(toy,/\.ck-toy-guides\{[^}]*pointer-events:none/);
  const source=readFileSync(new URL('../../apps/portal-web/src/games/toy-theme.css',import.meta.url),'utf8');
  assert.match(source,/\.fw-arcade-viewfinder i\{[^}]*filter:drop-shadow\(/,'the existing unrelated viewfinder shadow is preserved');
  for(const [strokeDasharray,expected] of [['15px, 12px',[182.5,263.5,344.5]],['12px, 9px',[181,265,349]]] as const){
    const f=guideObserverFixture();f.path.style.strokeDasharray=strokeDasharray;
    const observed=f.observe();assert.deepEqual([...f.problems()],[]);assert.equal(observed.clips.length,3);
    assert.deepEqual(Array.from(observed.samples,(sample:any)=>sample.local.y),[...expected]);
    for(const sample of observed.samples){assert.equal(sample.screen.x,95);assert.equal(sample.screen.y,sample.local.y*.5+70);assert.equal(sample.painted,true);assert.equal(sample.inputOwned,true);}
  }
});

test('actual guide observer fails closed for masks, filters, clip effects and unsupported transforms',()=>{
  for(const location of ['path','svg','host','root'] as const)for(const patch of [{clipPath:'inset(100%)'},{maskImage:'linear-gradient(transparent, transparent)'},{webkitMaskImage:'url(#transparent)'},{maskBorderSource:'url(#transparent)'},{webkitMaskBoxImageSource:'url(#transparent)'},{filter:'opacity(0)'},{filter:'drop-shadow(0px 1px 2px black)'},{filter:'url(#empty)'},{backdropFilter:'blur(5px)'},{clip:'rect(0px, 0px, 0px, 0px)'},{mixBlendMode:'multiply'},{vectorEffect:'non-scaling-stroke'},{transform:'matrix(0, 1, -1, 0, 0, 0)'},{perspective:'100px'},{scale:'0.5'},{rotate:'90deg'},{zoom:'2'}]){
    const f=guideObserverFixture();Object.assign(f[location].style,patch);
    assert.ok(f.problems().some((issue:string)=>issue.startsWith('unsupported ')),`${location}: ${JSON.stringify(patch)}`);
  }
  const f=guideObserverFixture();f.matrix.c=1;assert.ok(f.problems().includes('unsupported stroke transform'));
});

test('actual guide observer rejects ancestor clipping, rounded corners and invalid geometry without pretending hit ownership proves occlusion',()=>{
  for(const overflow of ['hidden','clip','auto','scroll']){
    const f=guideObserverFixture();f.host.style.overflowY=overflow;f.host.clientHeight=1;
    assert.ok(f.problems().some((issue:string)=>issue.startsWith('clipped by ancestor')));
  }
  for(const contain of ['paint','strict','content','layout paint']){
    const f=guideObserverFixture();f.host.style.overflowX='visible';f.host.style.overflowY='visible';f.host.style.contain=contain;f.host.clientHeight=1;
    assert.ok(f.problems().some((issue:string)=>issue.startsWith('clipped by ancestor')));
  }
  const rounded=guideObserverFixture();rounded.svg.style.borderTopLeftRadius='50%';assert.ok(rounded.problems().some((issue:string)=>issue.startsWith('clipped by ancestor')));
  const asymmetric=guideObserverFixture();asymmetric.svg.style.borderTopLeftRadius='9999px';assert.ok(asymmetric.problems().some((issue:string)=>issue.startsWith('clipped by ancestor')));
  const invalid=guideObserverFixture();invalid.svg.style.borderTopLeftRadius='calc(20% + 1px)';assert.ok(invalid.problems().some((issue:string)=>issue.startsWith('invalid ancestor clip')));
  const margin=guideObserverFixture();margin.host.style.overflowClipMargin='2px';assert.ok(margin.problems().some((issue:string)=>issue.includes('overflow-clip-margin')));
  const hidden=guideObserverFixture();hidden.svg.style.opacity='0';assert.ok(hidden.problems().includes('unpainted guide'));
  const obstructed=guideObserverFixture();obstructed.setHit({tagName:'BUTTON',getAttribute:()=> 'blocking-control'});assert.ok(obstructed.problems().includes('unpainted dash or wrong input owner'));
});

test('actual guide negative probe restores styles synchronously on success and measurement errors',()=>{
  for(const target of ['owner','ancestor'] as const){
    const f=guideObserverFixture(),element=target==='owner'?f.svg:f.host,before=element.getAttribute('style');
    const rejected=f.probe({target,styles:{'clip-path':'inset(100%)'}});
    assert.ok(rejected.paintIssues.some((issue:string)=>issue.startsWith('unsupported clip-path')));
    assert.equal(element.getAttribute('style'),before);assert.deepEqual([...f.problems()],[]);
    f.path.getBBox=()=>{throw Error('measurement failed');};
    assert.throws(()=>f.probe({target,styles:{filter:'opacity(0)'}}),/measurement failed/);
    assert.equal(element.getAttribute('style'),before);
  }
});


test('pan scoop requires finite on-pan origin and a deliberate upward stroke, not a tap',()=>{
 const {kitchenPanStart:start,kitchenPanStroke:stroke}=kitchenPresentation;
 assert.equal(stroke({x:.5,y:.65},{x:.5,y:.42}),true);
 for(const end of [{x:.5,y:.65},{x:.5,y:.6},{x:.7,y:.65},{x:.5,y:.85},{x:.9,y:.2},{x:NaN,y:.4}])assert.equal(stroke({x:.5,y:.65},end),false);
 for(const origin of [{x:.1,y:.7},{x:.9,y:.7},{x:.5,y:.9},{x:Infinity,y:.5},{x:.5,y:NaN}]){assert.equal(start(origin),false);assert.equal(stroke(origin,{x:.5,y:.4}),false);}
});

// Exercise the actual input closures and domain. This is not native focus,
// pointer capture, touchscreen or visual evidence; those stay in browser tests.
function panInputHarness(){
 const recipe=RECIPES.find(r=>r.id==='egg-fried-rice')!,step=recipe.steps.findIndex(s=>s.kind==='pan');
 const live={current:{...domain.newCookingRun(recipe,42,'pan-input'),step,status:'playing' as const,lastNow:1000,active:{...domain.newCookingRun(recipe,42,'pan-input').active,amount:.5}}};
 const gesture={current:null as any},holdOwner={current:null},pointFrame={current:0},pendingPoint={current:null},points:any[]=[];
 let prevented=0,focused=0,captured=false;
 const target={getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),setPointerCapture:()=>{captured=true;},hasPointerCapture:()=>captured,releasePointerCapture:()=>{captured=false;},focus:()=>{focused++;}};
 const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/CookingGame.tsx',import.meta.url),'utf8');
 const from=source.indexOf('  const currentZoom='),to=source.indexOf('  const holdButton=');assert.ok(from>=0&&to>from);
 const env={...kitchenPresentation,live,gesture,holdOwner,pointFrame,pendingPoint,visualMode:'3d',currentStep:domain.currentStep,selectedIngredient:false,
  setPoint:(p:any)=>points.push(p),paintPoint:(p:any)=>points.push(p),setSelectedIngredient(){},setNotice(){},flush(){},cancelAnimationFrame(){},
  command:(action:any,at=live.current.step)=>{live.current=domain.actCooking(live.current,{...action,step:at},1000) as typeof live.current;},pause:()=>{gesture.current=null;live.current.status='paused' as any;},holdStart(){},holdEnd(){}};
 const clearing=source.slice(source.indexOf('  const clearGesture='),source.indexOf('  const paintPoint='))+source.slice(source.indexOf('  const cancel=()=>'),source.indexOf('  const sameHold='));
 const handlers=runInNewContext(transformSync(clearing+source.slice(from,to)+';module.exports={down,move,up,key,cancelPointer}',{loader:'ts',format:'cjs'}).code,{...env,module:{exports:{}}});
 // transform's module.exports assignment is the last expression.
 const h=handlers as {down:(e:any)=>void;move:(e:any)=>void;up:(e:any)=>void;key:(e:any,release?:boolean)=>void;cancelPointer:(e:any)=>void};
 const event=(x=.5,y=.65,id=1)=>({clientX:x*100,clientY:y*100,pointerId:id,button:0,isPrimary:true,currentTarget:target,preventDefault:()=>prevented++});
 return {...h,live,gesture,points,event,target,prevented:()=>prevented,focused:()=>focused};
}
test('actual pan pointer handlers reject taps, foreign pointers, outside starts and stale steps',()=>{
 for(const type of ['mouse','touch']){
  const h=panInputHarness(),e=(x:number,y:number,id=1)=>({...h.event(x,y,id),pointerType:type});
  h.down(e(.1,.7));assert.equal(h.gesture.current,null);h.up(e(.5,.4));assert.equal(h.live.current.active.flipped,false);
  h.down(e(.5,.65));h.up(e(.5,.65));assert.equal(h.live.current.active.flipped,false);
  h.down(e(.5,.65));h.down(e(.55,.65,2));assert.equal((h.gesture.current as {id:number}|null)?.id,1);h.up(e(.5,.42,2));assert.equal(h.live.current.active.flipped,false);
  h.up(e(.5,.42));assert.equal(h.live.current.active.flipped,true);assert.equal(h.gesture.current,null);assert.ok(h.focused()>0);
  assert.equal(JSON.stringify(h.points.at(-1)),JSON.stringify({x:.5,y:.42}),'release keeps the actual spatula endpoint instead of snapping to default');
  const last=h.live.current.active.lastAt;h.up(e(.5,.42));assert.equal(h.live.current.active.lastAt,last);
 }
 const stale=panInputHarness();stale.down(stale.event());stale.live.current.step++;stale.up(stale.event(.5,.42));assert.equal(stale.live.current.active.flipped,false);
});
test('actual pan keyboard remains accessible without a separate button and does not hijack fields',()=>{
 for(const shortcut of [' ','f','F']){
  const h=panInputHarness(),event=(tag='svg',repeat=false)=>({key:shortcut,repeat,target:{closest:()=>tag==='svg'?null:{}},preventDefault(){}});
  h.key(event('svg',true));assert.equal(h.live.current.active.flipped,false);
  h.key(event('input'));assert.equal(h.live.current.active.flipped,false);
  h.key({...event(),ctrlKey:true});assert.equal(h.live.current.active.flipped,false);
  h.key(event());assert.equal(h.live.current.active.flipped,true);
 }
 const source=readFileSync(new URL('../../apps/portal-web/src/games/cooking/CookingGame.tsx',import.meta.url),'utf8');
 assert.ok(!source.includes("{s.kind==='pan'&&<button"));
 const svg=readFileSync(new URL('../../apps/portal-web/src/games/cooking/CookingIllustration.tsx',import.meta.url),'utf8');
 assert.ok(svg.includes("tabIndex={s.kind==='pan'&&run.status==='playing'?0:undefined}"));
});

test('actual pan cancellation clears the captured owner before reentry',()=>{
 for(const type of ['mouse','touch']){
  const h=panInputHarness(),e=(id=1)=>({...h.event(.5,.65,id),pointerType:type});
  h.down(e());h.cancelPointer(e(2));assert.equal((h.gesture.current as {id:number}|null)?.id,1);
  h.cancelPointer(e());assert.equal(h.gesture.current,null);h.up(h.event(.5,.42));assert.equal(h.live.current.active.flipped,false);
  h.down(e());h.up(h.event(.5,.42));assert.equal(h.live.current.active.flipped,true);
 }
});
