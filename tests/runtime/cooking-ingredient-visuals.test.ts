import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
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

function preparationCapture(){
  type Capture=(target:{screenshot(options:{type:'png'}):Promise<Buffer>},info:{attach(name:string,options:{body:Buffer;contentType:string}):Promise<void>},name:string)=>Promise<Buffer>;
  const module={exports:{} as {capturePreparationScreenshot:Capture}};
  const source=readFileSync(new URL('../e2e/cooking-preparation-art.spec.ts',import.meta.url),'utf8'),registered:string[]=[];
  runInNewContext(transformSync(source,{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require:(id:string)=>{
    if(id==='./fixtures.js')return {test(name:string){registered.push(name);}};
    if(['node:crypto','../../apps/portal-web/src/games/cooking/catalog.js','../../apps/portal-web/src/games/cooking/ingredient-visuals.js','../../apps/portal-web/src/games/cooking/storage.js'].includes(id))return {};
    throw Error(id);
  }});
  assert.equal(registered.filter(name=>name.startsWith('preparation art:')).length,5,'preserve the five original real cases; do not run a fake browser');
  assert.deepEqual(registered.filter(name=>!name.startsWith('preparation art:')),[...['native','rejected'].map(mode=>`preparation art fullscreen: pumpkin-soup keeps native cuts through ${mode} presentation at 667x375`),...['320x568','390x844','667x375','1440x900'].map(size=>`immersive kitchen: canvas and controls share ${size} stage`),'immersive kitchen: 320x568 viewport fallback keeps controls separate']);
  return module.exports.capturePreparationScreenshot;
}
test('preparation capture attaches each exact PNG buffer instead of a temporary path',async()=>{
  const capture=preparationCapture(),body=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4P9P4PwAHMQLLfnZo0AAAAABJRU5ErkJggg==','base64');
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
  const capture=preparationCapture(),body=Buffer.from('synthetic transport fixture'),failure=Error('capture_or_attach_failed');let attached=false;
  await assert.rejects(capture({async screenshot(){throw failure;}},{async attach(){attached=true;}},'failed-capture.png'),error=>error===failure);assert.equal(attached,false);
  await assert.rejects(capture({async screenshot(){return body;}},{async attach(){throw failure;}},'failed-attach.png'),error=>error===failure);
  let release!:()=>void,entered!:()=>void,resolved=false;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const pending=capture({async screenshot(){return body;}},{async attach(){entered();await gate;}},'pending.png').then(()=>{resolved=true;});
  await started;assert.equal(resolved,false,'capture must not resolve before attach finishes');release();await pending;assert.equal(resolved,true);
});
