import {shawarmaPresentation} from '../../apps/portal-web/src/games/cooking/shawarma-presentation.js';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {advanceMarket,applyMarket,canServe,marketGrade,marketMass,newMarket,parseMarket,readMarket,saveMarket,MARKET_SAVE_KEY,type MarketRun,type MarketAction} from '../../apps/portal-web/src/games/cooking/market-domain.js';
import {emptyCookbook,updateCookbook} from '../../apps/portal-web/src/games/cooking/storage.js';
import {Float32BufferAttribute,Group,Mesh,Raycaster,Vector3} from 'three';
import {FoodKit} from '../../apps/portal-web/src/games/cooking/food-kit.js';
import {marketFood,displayMarket} from '../../apps/portal-web/src/games/cooking/market-food.js';
import {marketHitPortion} from '../../apps/portal-web/src/games/cooking/market-stage.js';
import {cornDogPresentation} from '../../apps/portal-web/src/games/cooking/corn-dog-presentation.js';
import {createCornDogStall} from '../../apps/portal-web/src/games/cooking/corn-dog-stall.js';
const time=(r:MarketRun,ms:number)=>{while(ms>0){const n=Math.min(ms,1000);r=advanceMarket(r,n);ms-=n;}return r;};
const act=(r:MarketRun,a:MarketAction)=>applyMarket(time(r,400),a).run;
function begin(id:MarketRun['recipe']){return applyMarket(newMarket(id,42),{kind:'start'}).run;}
test('UX-9 thermal cooking: sides, heat, pause and foreground caps are actual state, not animation',()=>{
 let r=act(begin('steak-dinner'),{kind:'add',ingredient:'steak'});r=time(r,25000);assert.ok(r.portions[0].a>.3);assert.equal(r.portions[0].b,0);const a=r.portions[0].a;r=act(r,{kind:'flip',index:0});r=time(r,12000);assert.ok(r.portions[0].b>.2);assert.ok(r.portions[0].a>=a);r=applyMarket(r,{kind:'pause'}).run;assert.equal(advanceMarket(r,999999),r);assert.equal(applyMarket(r,{kind:'flip',index:0}).run,r);assert.equal(advanceMarket(begin('corn-dog'),Infinity).elapsed,0);assert.equal(advanceMarket(begin('corn-dog'),99999).elapsed,1000);
});
test('UX-9 corn dog: coating, two sides, lift, drainage, hand drawn sauce and immutable completion',()=>{
 let r=act(begin('corn-dog'),{kind:'add',ingredient:'sausage'});r=act(r,{kind:'coat'});r=time(r,24000);r=act(r,{kind:'flip',index:0});r=time(r,24000);r=act(r,{kind:'lift'});const before=r.portions[0].a;assert.equal(r.portions[0].coated,true);r=time(r,4000);assert.equal(r.portions[0].a,before);assert.ok(r.portions[0].drain>=3000);r=act(r,{kind:'sauce',line:{sauce:'ketchup',points:[{x:.2,y:.2},{x:.5,y:.6}]}});assert.equal(r.sauces.length,1);assert.ok(canServe(r));r=act(r,{kind:'serve'});assert.equal(r.status,'done');assert.ok(marketGrade(r).score>=80);assert.equal(advanceMarket(r,1000),r);assert.equal(applyMarket(r,{kind:'serve'}).run,r);assert.deepEqual(parseMarket(r),r);
 const raw=act(act(begin('corn-dog'),{kind:'add',ingredient:'sausage'}),{kind:'serve'});assert.ok(marketGrade(raw).score<marketGrade(r).score-25);
});
test('UX-9 shawarma: a finite roast, bread before shaving, actual fillings and ordered closure',()=>{
 let r=begin('shawarma');assert.equal(applyMarket(r,{kind:'shave'}).run,r);r=act(r,{kind:'add',ingredient:'bread'});r=time(r,6000);for(let i=0;i<3;i++)r=act(r,{kind:'shave'});assert.equal(r.shaves,3);assert.equal(r.portions.filter(p=>p.kind==='meat').length,3);assert.equal(canServe(r),false);r=act(r,{kind:'add',ingredient:'lettuce'});for(let i=0;i<3;i++)r=act(r,{kind:'fold'});assert.ok(canServe(r));assert.equal(applyMarket(time(r,400),{kind:'add',ingredient:'tomato'}).run.recipe,'shawarma');assert.equal(applyMarket(time(r,400),{kind:'add',ingredient:'tomato'}).run.portions.length,r.portions.length);r=act(r,{kind:'serve'});assert.ok(parseMarket(r));
});
test('UX-9 rice: overfilling and high heat spill food, burn and seasoning change the result',()=>{
 let r=act(begin('egg-fried-rice'),{kind:'add',ingredient:'rice'});for(let i=0;i<12;i++)r=act(r,{kind:'add',ingredient:'rice'});r=act(r,{kind:'heat',value:3});r=time(r,60000);const mass=marketMass(r);for(let i=0;i<8;i++)r=act(r,{kind:'toss'});assert.ok(r.spilled>=36);assert.ok(marketMass(r)<mass);const burned=marketGrade(r);assert.ok(burned.metrics[0].value<30);for(let i=0;i<8;i++)r=act(r,{kind:'salt'});assert.ok(marketGrade(r).metrics[2].value<burned.metrics[2].value);const before=r.portions.length;for(let i=0;i<30;i++)r=act(r,{kind:'add',ingredient:'rice'});assert.equal(r.portions.length,16);assert.ok(before<=16);
});
test('UX-9 invalid saves, future timestamps, stale data, unknown fields and failed writes cannot resume or erase a run',()=>{
 const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)},now=1000000000,r=act(begin('corn-dog'),{kind:'add',ingredient:'sausage'});assert.equal(saveMarket(storage,r,now),true);assert.equal(readMarket(storage,now)!.status,'paused');assert.equal(readMarket(storage,now+604800001),null);assert.equal(readMarket(storage,now-61000),null);assert.equal(parseMarket({...r,unknown:true}),null);assert.equal(parseMarket({...r,temperature:NaN}),null);assert.equal(parseMarket({...r,sauces:[{sauce:'ketchup',points:[{x:Infinity,y:.5}]}]}),null);assert.equal(saveMarket({getItem(){return null;},setItem(){throw Error('quota');}},r),false);assert.ok(values.has(MARKET_SAVE_KEY));
});
test('UX-9 completion updates the existing cookbook only from a validated finished run, once at its actual score',()=>{
 const values=new Map<string,string>(),s={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};let r=act(begin('corn-dog'),{kind:'add',ingredient:'sausage'});let b=updateCookbook(s,emptyCookbook(),{kind:'market-complete',run:r});assert.deepEqual(b.book.best,{});r=act(r,{kind:'serve'});b=updateCookbook(s,b.book,{kind:'market-complete',run:r});assert.equal(b.book.best['corn-dog'].score,marketGrade(r).score);const first=b.book.best['corn-dog'];b=updateCookbook(s,b.book,{kind:'market-complete',run:r});assert.deepEqual(b.book.best['corn-dog'],first);
});


test('UX-9 rice spillage is monotonic and cannot recreate food when the pan becomes nearly empty',()=>{
 let r=act(act(begin('egg-fried-rice'),{kind:'add',ingredient:'rice'}),{kind:'add',ingredient:'carrot'});
 r=time(act(r,{kind:'heat',value:3}),10000);const original=marketMass(r);
 for(let i=0;i<20;i++){const previousMass=marketMass(r),previousSpill=r.spilled;r=act(r,{kind:'toss'});assert.ok(marketMass(r)<=previousMass,'spilled food cannot return to the pan');assert.ok(r.spilled>=previousSpill,'spill total cannot decrease');assert.equal(marketMass(r)+r.spilled,original);}
 assert.equal(marketMass(r),0);assert.equal(r.spilled,original);assert.ok(parseMarket(r));
});


// Exercise the production assembly after batching, without a renderer or fake DOM.
// Resolve the real triangle with the same production function as MarketStage.hit.
function portionAt(food:ReturnType<typeof marketFood>,x:number,z:number){
 food.root.updateWorldMatrix(true,true);
 const closest=new Raycaster(new Vector3(x,10,z),new Vector3(0,-1,0)).intersectObject(food.root,true)[0];
 assert.ok(closest,'ray must hit the actual food');
 const index=marketHitPortion(closest,food.root);
 return {index,closest};
}
function cookedSteaks(){
 let r=begin('steak-dinner');
 for(const ingredient of ['potato','steak','broccoli','steak'] as const)r=act(r,{kind:'add',ingredient});
 r=time(r,25000);r=act(r,{kind:'flip',index:1});r=act(r,{kind:'flip',index:3});
 return time(r,12000);
}
test('UX-15c cooked butter retains original steak ownership after batching, not the selected other steak',()=>{
 const run=cookedSteaks(),kit=new FoodKit(),food=marketFood(run,kit);
 try{
  for(const [x,index,other] of [[-.55,1,3],[1.15,3,1]] as const){
   const hit=portionAt(food,x,0);
   assert.ok(hit.closest.object instanceof Mesh);
   assert.equal((hit.closest.object.material as any).color.getHexString(),'e8c77f','nearest hit must be butter, not bare meat');
   const flipped=applyMarket(run,{kind:'flip',index:hit.index??other}).run;
   assert.equal(flipped.portions[index].flips,run.portions[index].flips+1,'tapping butter must flip that steak despite another dropdown selection');
   assert.deepEqual(flipped.portions[other],run.portions[other],'other steak must not change');
   assert.equal(hit.index,index,'interleaved garnishes must not renumber the meat');
  }
 }finally{food.dispose();kit.dispose();}
});

test('UX-15c triangle ownership validates attributes and falls back to existing mesh ancestry',()=>{
 const kit=new FoodKit(),food=marketFood(cookedSteaks(),kit);
 try{
  const {closest}=portionAt(food,-.55,0),mesh=closest.object as Mesh,attribute=mesh.geometry.getAttribute('marketPortion');
  assert.ok(attribute);assert.equal(marketHitPortion(closest,food.root),1);
  mesh.userData.portion=3;
  assert.equal(marketHitPortion(closest,food.root),1,'valid face ownership precedes ancestor ownership');
  assert.equal(marketHitPortion({...closest,face:null},food.root),3);
  assert.equal(marketHitPortion({...closest,face:{...closest.face!,a:-1}},food.root),3);
  assert.equal(marketHitPortion({...closest,face:{...closest.face!,a:attribute.count}},food.root),3);
  mesh.geometry.deleteAttribute('marketPortion');assert.equal(marketHitPortion(closest,food.root),3);
  for(const value of [-1,16,1.5,NaN,Infinity]){
   mesh.geometry.setAttribute('marketPortion',new Float32BufferAttribute(new Float32Array(attribute.count).fill(value),1));
   assert.equal(marketHitPortion(closest,food.root),3);
  }
  const mixed=new Float32BufferAttribute(new Float32Array(attribute.count).fill(1),1);mixed.setX(closest.face!.b,2);
  mesh.geometry.setAttribute('marketPortion',mixed);assert.equal(marketHitPortion(closest,food.root),3);
  mesh.geometry.setAttribute('marketPortion',new Float32BufferAttribute(new Float32Array(attribute.count*2).fill(1),2));assert.equal(marketHitPortion(closest,food.root),3);
  delete mesh.userData.portion;food.root.userData.portion=7;
  assert.equal(marketHitPortion(closest,food.root),null,'unowned hits keep existing null fallback and stop at the boundary');
  const parent=new Group();food.root.add(parent);parent.add(mesh);parent.userData.portion=1;
  assert.equal(marketHitPortion(closest,food.root),1,'unbatched parent ownership remains supported');
 }finally{food.dispose();kit.dispose();}
});

test('UX-15c bare and single topped steaks retain selection',()=>{
 const kit=new FoodKit();
 try{
  let run=act(begin('steak-dinner'),{kind:'add',ingredient:'steak'});
  let food=marketFood(run,kit);
  try{assert.equal(portionAt(food,-.28,-.1).index,0);}finally{food.dispose();}
  run=time(run,25000);run=act(run,{kind:'flip',index:0});food=marketFood(run,kit);
  try{assert.equal(portionAt(food,.02,-.1).index,0);}finally{food.dispose();}
 }finally{kit.dispose();}
});

test('UX-15c all steak garnish materials remain batch-compatible and owned geometries dispose once',()=>{
 const kit=new FoodKit(),shared=new Map([...kit.geometries].map(g=>[g,0]));
 for(const g of shared.keys())g.addEventListener('dispose',()=>shared.set(g,shared.get(g)!+1));
 try{
  // Every allowed garnish, repeated and together at the 16-portion limit.
  for(const kinds of [
   ['steak','steak',...Array(14).fill('potato')],
   ['steak','steak',...Array(14).fill('broccoli')],
   ['steak','steak',...Array(14).fill('egg')],
   Array.from({length:16},(_,i)=>['potato','steak','broccoli','egg'][i%4]),
   Array(16).fill('steak'),
  ])for(const status of ['playing','paused','done'] as const){
   const run=newMarket('steak-dinner',42);run.status=status;
   run.portions=kinds.map(kind=>({kind,a:.7,b:.7,side:0,flips:1,coated:false,lifted:false,drain:0}));
   const food=marketFood(run,kit),owned=new Map(food.geometries.map(g=>[g,0]));
   try{
    for(const g of owned.keys())g.addEventListener('dispose',()=>owned.set(g,owned.get(g)!+1));
    const attributed:Mesh[]=[];food.root.traverse(o=>{if(o instanceof Mesh&&o.geometry.hasAttribute('marketPortion'))attributed.push(o);});
    assert.equal(attributed.length,status==='done'?0:1,'interactive butter stays one compatible merged mesh; completed plates are unchanged');
    if(status!=='done'){
     const attribute=attributed[0].geometry.getAttribute('marketPortion');
     assert.deepEqual([...new Set(Array.from({length:attribute.count},(_,i)=>attribute.getX(i)))].sort((a,b)=>a-b),kinds.flatMap((kind,i)=>kind==='steak'?[i]:[]));
     assert.equal([...owned.keys()].filter(g=>g.hasAttribute('marketPortion')).length,kinds.filter(k=>k==='steak').length+1,'every butter clone and final merged geometry is owned');
    }
   }finally{food.dispose();food.dispose();}
   assert.equal(food.root.children.length,0);assert.ok([...owned.values()].every(n=>n===1));
   assert.ok([...shared.values()].every(n=>n===0),'assembly disposal cannot dispose shared kit geometry');
  }
 }finally{kit.dispose();kit.dispose();}
 assert.ok([...shared.values()].every(n=>n===1));
});


test('UX-17 corn-dog presentation follows real heat, submerged portions and pause without changing the run',()=>{
 let r=act(begin('corn-dog'),{kind:'add',ingredient:'sausage'});
 const before=JSON.stringify(r),cold=cornDogPresentation({...r,temperature:120});
 assert.equal(cold.bubbleCount,0);assert.equal(cold.bubbleOpacity,0);
 const warm=cornDogPresentation({...r,temperature:145}),hot=cornDogPresentation({...r,temperature:185});
 assert.equal(hot.bubbleCount,6);assert.ok(hot.bubbleOpacity>warm.bubbleOpacity);
 assert.equal(cornDogPresentation({...r,status:'paused',temperature:185}).heaterGlow,0);
 assert.equal(cornDogPresentation({...r,heat:0,temperature:185}).heaterGlow,0);
 assert.equal(cornDogPresentation({...r,heat:3,temperature:185}).heaterGlow,1);
 assert.equal(cornDogPresentation({...r,status:'done',temperature:185}).bubbleCount,0);
 assert.equal(cornDogPresentation({...r,portions:r.portions.map(p=>({...p,lifted:true})),temperature:185}).bubbleCount,0);
 assert.equal(cornDogPresentation({...r,recipe:'steak-dinner',temperature:185}).bubbleCount,0);
 assert.equal(cornDogPresentation({...r,temperature:NaN}).bubbleCount,0);
 assert.equal(cornDogPresentation({...r,portions:Array.from({length:16},()=>({...r.portions[0]})),temperature:235}).bubbleCount,24);
 assert.equal(JSON.stringify(r),before);assert.ok(Object.isFrozen(hot));
});

test('UX-17 fryer batches static geometry, updates only its dial/lamp and releases owned resources',()=>{
 const kit=new FoodKit(),stall=createCornDogStall(kit),r=begin('corn-dog');
 const geometries=kit.geometries.size,materials=kit.materials.size,children=stall.root.children.length;
 let staticMeshes=0;stall.root.children[0].traverse(node=>{if(node instanceof Mesh)staticMeshes++;});
 assert.ok(staticMeshes<24,'the 24 static parts must be merged, not left as independent draws');
 stall.update({...r,heat:0});const initial=stall.dial.rotation.z;
 for(let i=0;i<100;i++)stall.update({...r,heat:3,temperature:185});
 assert.notEqual(stall.dial.rotation.z,initial);assert.equal(stall.lamp.material.emissiveIntensity,1);
 stall.update({...r,status:'paused',heat:3});assert.equal(stall.lamp.material.emissiveIntensity,0);
 assert.equal(kit.geometries.size,geometries);assert.equal(kit.materials.size,materials);assert.equal(stall.root.children.length,children);
 let disposed=0,disposedMaterials=0;for(const geometry of kit.geometries)geometry.addEventListener('dispose',()=>disposed++);
 for(const material of kit.materials.values())material.addEventListener('dispose',()=>disposedMaterials++);
 kit.dispose();assert.equal(disposed,geometries);assert.equal(disposedMaterials,materials);assert.equal(kit.geometries.size,0);assert.equal(kit.materials.size,0);
});

// Pure presentation regression: temperature updates do not depend on portions/rebuilds.
test('UX-17 shawarma heat follows temperature and reduced motion freezes spit rotation',()=>{
 const run=begin('shawarma'),before=JSON.stringify(run);
 const cold=shawarmaPresentation({...run,temperature:25,elapsed:1200},false),hot=shawarmaPresentation({...run,temperature:235,elapsed:2400},false);
 assert.equal(cold.cooked,0);assert.ok(hot.cooked>cold.cooked);assert.equal(cold.rotation,1);assert.equal(hot.rotation,2);
 assert.equal(shawarmaPresentation({...run,elapsed:1200},true).rotation,0);
 assert.equal(shawarmaPresentation({...run,elapsed:9600,status:'paused'},true).rotation,0);
 assert.equal(shawarmaPresentation({...run,elapsed:2400,status:'paused'},false).rotation,2);
 assert.deepEqual(shawarmaPresentation({...run,temperature:NaN,elapsed:NaN},false),{cooked:0,rotation:0});
 assert.equal(shawarmaPresentation({...run,temperature:999},false).cooked,1);assert.equal(JSON.stringify(run),before);
});

// Execute the actual TSX event closures with a deterministic React hook boundary.
// This is not a browser, native focus, layout, WebGL or visual acceptance test.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as marketDomain from '../../apps/portal-web/src/games/cooking/market-domain.js';
import {recipeOf} from '../../apps/portal-web/src/games/cooking/catalog.js';
import {MarketIllustration} from '../../apps/portal-web/src/games/cooking/MarketIllustration.js';
type UiNode={type:unknown;props:Record<string,any>};
function marketUi(id:MarketRun['recipe']='corn-dog',bookNotice?:UiNode){
 const hooks:any[]=[],effects:(()=>unknown)[]=[],layouts:(()=>unknown)[]=[],saved=new Map<string,string>(),frames=new Map<number,(time:number)=>void>();let cursor=0,serial=0;
 const element=(type:unknown,props:Record<string,any>)=>({type,props}),refHooks={useRef:(value:unknown)=>{const index=cursor++;return hooks[index]??=( {current:value});},useState:(initial:unknown)=>{const index=cursor++;if(!(index in hooks))hooks[index]=typeof initial==='function'?(initial as ()=>unknown)():initial;return [hooks[index],(next:unknown)=>{hooks[index]=typeof next==='function'?(next as (v:unknown)=>unknown)(hooks[index]):next;}];},useEffect:(effect:()=>unknown)=>{effects.push(effect);},useLayoutEffect:(effect:()=>unknown)=>{layouts.push(effect);}};
 const document={activeElement:null as unknown,body:{isConnected:true}};
 const module={exports:{} as {MarketGame:(props:unknown)=>UiNode}};
 const code=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/cooking/MarketGame.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
 runInNewContext(code,{module,exports:module.exports,require:(name:string)=>{if(name==='react')return refHooks;if(name==='react/jsx-runtime')return {jsx:element,jsxs:element,Fragment:'fragment'};if(name==='./market-domain')return marketDomain;if(name==='./CoatingHold')return {CoatingHold:()=>null};if(name==='./MarketIllustration')return {MarketIllustration};if(name==='./IngredientIcon')return {IngredientIcon:()=>null};if(name==='../diagnostics')return {syncDiagnostics(){}};throw Error(`Uncovered UI import ${name}`);},sessionStorage:{getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>saved.set(k,v)},requestAnimationFrame:(fn:(time:number)=>void)=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:(id:number)=>frames.delete(id),document,console});
 const nodes=(node:any):UiNode[]=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
 const text=(node:any):string=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
 const render=()=>{cursor=0;effects.length=0;layouts.length=0;return module.exports.MarketGame({recipe:recipeOf(id)!,seed:42,fresh:true,bookNotice,onBack(){},onResult(){},onComplete(){}});};
 let tree=render();const mode=hooks.findIndex(value=>value==='loading');assert.notEqual(mode,-1);hooks[mode]='fallback';tree=render();
 const find=(predicate:(node:UiNode)=>boolean)=>{const node=nodes(tree).find(predicate);assert.ok(node,'actual production UI node must exist');return node;};
 const click=(name:string)=>{const b=find(n=>n.type==='button'&&(n.props['aria-label']??text(n))===name);assert.notEqual(b.props.disabled,true,`${name} is enabled`);b.props.onClick();tree=render();};
 const state=()=>JSON.parse(saved.get(MARKET_SAVE_KEY)!).run as MarketRun;
 const tick=(time:number)=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(time);tree=render();};
 return {click,state,tick,nodes:()=>nodes(tree),find,text,render:()=>{tree=render();return tree;},saved,effects,layouts,hooks,document};
}
test('market scene keeps gameplay controls inside the stage and covered controls inert',()=>{
 for(const id of marketDomain.MARKET_IDS){const ui=marketUi(id),stage=ui.find(n=>n.props['data-market-stage']!==undefined),play=ui.find(n=>n.props.className==='mk-play-space');assert.equal(play.props.inert,true);assert.equal(ui.nodes().filter(n=>n.type==='button'&&ui.text(n)==='開火，開始做！').length,1);assert.ok(stage.props.children);ui.click('開火，開始做！');assert.equal(ui.state().status,'playing');assert.equal(ui.find(n=>n.props.className==='mk-play-space').props.inert,false);ui.click('暫停');assert.equal(ui.state().status,'paused');assert.equal(ui.find(n=>n.props.className==='mk-play-space').props.inert,true);ui.click('食譜與操作提示');assert.ok(ui.find(n=>n.type==='dialog'&&n.props['aria-label']==='食譜與操作提示'));ui.click('關閉操作提示');assert.equal(ui.state().status,'paused');ui.click('繼續這一盤');assert.equal(ui.state().status,'playing');}
});
test('market palettes retain free-cooking selection and authoritative actions, pause and restart',()=>{
 const ui=marketUi();ui.click('開火，開始做！');ui.tick(0);ui.tick(400);ui.click('熱狗＋70g');ui.tick(800);ui.click('熱狗＋70g');
 const select=ui.find(n=>n.type==='select');select.props.onChange({target:{value:'0'}});ui.render();ui.tick(1200);ui.click('工具');ui.click('裹麵糊');assert.equal(ui.state().portions[0].coated,true);assert.equal(ui.state().portions[1].coated,false);
 ui.tick(1600);ui.click('調味醬線');ui.click('番茄醬');ui.click('擠一條波浪醬線');assert.equal(ui.state().sauces.length,1);ui.click('暫停');const snapshot=JSON.stringify(ui.state());ui.tick(50000);assert.equal(JSON.stringify(ui.state()),snapshot);
 ui.click('繼續這一盤');ui.tick(50400);ui.tick(50800);ui.click('翻這一面');assert.equal(ui.state().portions[0].side,1);assert.equal(ui.state().portions[1].side,0);assert.equal(ui.state().sauces.length,1);
 ui.click('重新做這一道');ui.click('保留這一盤');assert.equal(ui.state().portions.length,2);assert.equal(ui.state().status,'paused');ui.click('重新做這一道');ui.click('重新開攤');assert.equal(ui.state().status,'ready');assert.deepEqual(ui.state().portions,[]);assert.deepEqual(ui.state().sauces,[]);
});
test('market actual modal Tab handler traps focus without invoking gameplay/fullscreen keys',()=>{
 const ui=marketUi();ui.click('食譜與操作提示');const dialog=ui.find(n=>n.type==='dialog'),focus:string[]=[];const first={focus:()=>focus.push('first')},last={focus:()=>focus.push('last')};
 // The VM document is intentionally null-active; non-edge Tab is left to native
 // dialog focus navigation and propagation is still stopped at the modal.
 let stopped=0,prevented=0;dialog.props.onKeyDown({key:'Tab',shiftKey:false,currentTarget:{querySelectorAll:()=>[first,last]},stopPropagation:()=>stopped++,preventDefault:()=>prevented++});assert.equal(stopped,1);assert.equal(prevented,0);assert.deepEqual(focus,[]);ui.document.activeElement=last;dialog.props.onKeyDown({key:'Tab',shiftKey:false,currentTarget:{querySelectorAll:()=>[first,last]},stopPropagation:()=>stopped++,preventDefault:()=>prevented++});ui.document.activeElement=first;dialog.props.onKeyDown({key:'Tab',shiftKey:true,currentTarget:{querySelectorAll:()=>[first,last]},stopPropagation:()=>stopped++,preventDefault:()=>prevented++});assert.deepEqual(focus,['first','last']);assert.equal(prevented,2);
 let canceled=0;dialog.props.onCancel({preventDefault:()=>canceled++});ui.render();assert.equal(canceled,1);assert.equal(ui.nodes().filter(n=>n.type==='dialog').length,0);
});
test('market SVG follows only actual portions, sides, selection and sauce without mutating domain',()=>{
 for(const id of marketDomain.MARKET_IDS){let run=begin(id);for(const ingredient of marketDomain.MARKET_MENUS[id])run=act(run,{kind:'add',ingredient});run=time(run,10000);const before=JSON.stringify(run),html=renderToStaticMarkup(React.createElement(MarketIllustration,{run,selected:0}));assert.equal((html.match(/data-market-portion=/g)??[]).length,run.portions.length);assert.match(html,/viewBox="0 0 600 500"/);assert.doesNotMatch(html,/NaN|Infinity/);assert.equal(JSON.stringify(run),before);assert.notEqual(html,renderToStaticMarkup(React.createElement(MarketIllustration,{run:{...run,portions:[]},selected:0})));}
 let run=act(begin('corn-dog'),{kind:'add',ingredient:'sausage'});const raw=renderToStaticMarkup(React.createElement(MarketIllustration,{run,selected:0}));run=act(run,{kind:'coat'});run=time(run,24000);run=act(run,{kind:'sauce',line:{sauce:'garlic',points:[{x:.2,y:.3},{x:.6,y:.7}]}});const cooked=renderToStaticMarkup(React.createElement(MarketIllustration,{run,selected:0}));assert.notEqual(cooked,raw);assert.match(cooked,/points="120,150 360,350"/);assert.equal((cooked.match(/<polyline/g)??[]).length,1);
});

test('market actual dialog effects open once, prefer Keep and restore their own trigger without initial focus theft',()=>{
 const ui=marketUi(),events:string[]=[];assert.equal(ui.effects.length,5);assert.equal(ui.effects[3](),undefined);assert.equal(ui.effects[4](),undefined);
 for(const [name,label,index] of [['食譜與操作提示','食譜與操作提示',4],['重新做這一道','重新做這道料理',3]] as const){ui.click(name);const node=ui.find(n=>n.type==='dialog'&&n.props['aria-label']===label),trigger=ui.find(n=>n.type==='button'&&n.props['aria-label']===name);node.props.ref.current={showModal:()=>events.push('open'),close:()=>events.push('close'),querySelector:()=>({focus:()=>events.push('keep')})};trigger.props.ref.current={focus:(options:unknown)=>{assert.equal((options as {preventScroll:boolean}).preventScroll,true);events.push('trigger');}};const cleanup=ui.effects[index]() as ()=>void;assert.equal(typeof cleanup,'function');cleanup();if(index===4)ui.click('關閉操作提示');else ui.click('保留這一盤');}
 assert.deepEqual(events,['open','close','trigger','open','keep','close','trigger']);
});

test('market SVG pointer selects the actual portion and preserves pointer ownership before the domain flip',()=>{
 const ui=marketUi('steak-dinner');ui.click('開火，開始做！');ui.tick(0);ui.tick(400);ui.click('牛排＋180g');ui.tick(800);ui.click('牛排＋180g');ui.tick(1200);
 const events:string[]=[],surface=ui.find(n=>n.props.className==='mk-surface'),currentTarget={getBoundingClientRect:()=>({left:0,top:0,width:600,height:500}),focus:()=>events.push('focus'),setPointerCapture:(id:number)=>events.push(`capture:${id}`)},target={closest:()=>({getAttribute:()=> '0'})};
 const event={isPrimary:true,button:0,pointerId:7,clientX:180,clientY:220,currentTarget,target,preventDefault:()=>events.push('prevent')};
 surface.props.onPointerDown({...event,isPrimary:false});assert.deepEqual(events,[]);surface.props.onPointerDown(event);ui.render();assert.deepEqual(events,['prevent','focus','capture:7']);
 const active=ui.find(n=>n.props.className==='mk-surface');active.props.onPointerUp({...event,pointerId:8});assert.deepEqual(ui.state().portions.map(p=>p.flips),[0,0]);active.props.onPointerUp(event);ui.render();assert.deepEqual(ui.state().portions.map(p=>p.flips),[1,0]);
 ui.tick(1600);ui.find(n=>n.props.className==='mk-surface').props.onPointerDown(event);ui.render();ui.find(n=>n.props.className==='mk-surface').props.onPointerCancel(event);ui.find(n=>n.props.className==='mk-surface').props.onPointerUp(event);assert.deepEqual(ui.state().portions.map(p=>p.flips),[1,0]);
});


test('market keeps cookbook save errors in its paused stage without nested warning buttons',()=>{
 const notice={type:'div',props:{className:'ck-save-warning',children:{type:'button',props:{children:'重試保存食譜本'}}}},ui=marketUi('corn-dog',notice);
 assert.ok(ui.find(n=>n.props.className==='ck-save-warning'));ui.click('開火，開始做！');assert.equal(ui.nodes().filter(n=>n.props.className==='ck-save-warning').length,0);const warning=ui.find(n=>n.type==='button'&&n.props['aria-label']==='畫面與保存狀態');assert.ok(!ui.text(warning).includes('重試保存食譜本'));ui.click('畫面與保存狀態');assert.equal(ui.state().status,'paused');assert.ok(ui.find(n=>n.props.className==='ck-save-warning'));
});


test('market start hands focus over after inert removal, without stealing a newer focus or surviving pause',()=>{
 const ui=marketUi(),events:string[]=[],target={isConnected:true,closest:()=>null,scrollIntoView:()=>events.push('scroll'),focus:(options:{preventScroll:boolean})=>{assert.equal(options.preventScroll,true);events.push('focus');ui.document.activeElement=target;}},trigger={isConnected:true};
 ui.find(n=>n.props.className==='mk-surface').props.ref.current=target;ui.document.activeElement=trigger;ui.click('開火，開始做！');assert.deepEqual(events,[],'start never focuses while the old inert DOM may still be committed');trigger.isConnected=false;ui.document.activeElement=ui.document.body;ui.layouts.forEach(effect=>effect());assert.equal(ui.document.activeElement,target);assert.deepEqual(events,['scroll','focus']);
 ui.click('暫停');const resume={isConnected:true};ui.document.activeElement=resume;ui.click('繼續這一盤');const newer={isConnected:true};ui.document.activeElement=newer;ui.layouts.forEach(effect=>effect());assert.equal(ui.document.activeElement,newer);assert.deepEqual(events,['scroll','focus'],'a newer connected focus owner wins');
 ui.click('暫停');ui.document.activeElement=resume;ui.click('繼續這一盤');ui.click('暫停');ui.layouts.forEach(effect=>effect());assert.equal(ui.document.activeElement,resume);assert.deepEqual(events,['scroll','focus'],'pause cancels an unconsumed handoff');
 ui.click('繼續這一盤');target.isConnected=false;ui.layouts.forEach(effect=>effect());assert.deepEqual(events,['scroll','focus'],'a detached target cannot claim focus');
});

// Production camera and actual Three matrix/ray math, not native browser evidence.
test('front market camera stays level through portrait, landscape and desktop resizing',async()=>{
 const {marketFrontCamera,createMarketWorktop}=await import('../../apps/portal-web/src/games/cooking/market-stage.js');
 const {Vector2,Plane}=await import('three');
 for(const [width,height] of [[296,514],[1180,614],[667,175],[768,640],[320,1000]]){
  const camera=marketFrontCamera(width,height),surface=createMarketWorktop(),direction=camera.getWorldDirection(new Vector3());
  assert.ok(Math.abs(direction.x)<1e-12&&Math.abs(direction.y)<1e-12&&direction.z<-.999999,'camera must be horizontal and centered');
  const plane=new Plane(new Vector3(0,1,0),-.5).applyMatrix4(surface.matrixWorld);
  for(const x of [-1.7,0,1.7])for(const z of [-1.25,0,1.25]){
   const point=new Vector3(x,.5,z),world=surface.localToWorld(point.clone()),projected=world.clone().project(camera);
   assert.ok(Math.abs(projected.x)<1&&Math.abs(projected.y)<1,'entire actionable plane remains visible');
   const ray=new Raycaster();ray.setFromCamera(new Vector2(projected.x,projected.y),camera);
   const hit=ray.ray.intersectPlane(plane,new Vector3());assert.ok(hit,'front view must not make the interaction plane parallel');
   const local=surface.worldToLocal(hit);assert.ok(local.distanceTo(point)<1e-10,'same world-to-domain inverse retains sauce coordinates');
  }
 }
});
test('front market rays hit the rendered tilted food without changing portion ownership',async()=>{
 const {marketFrontCamera,createMarketWorktop}=await import('../../apps/portal-web/src/games/cooking/market-stage.js');
 const {Vector2}=await import('three');
 for(const id of ['egg-fried-rice','steak-dinner','shawarma','corn-dog'] as const){
  const ingredient=({ 'egg-fried-rice':'rice','steak-dinner':'steak',shawarma:'bread','corn-dog':'sausage'} as const)[id];
  const run=act(begin(id),{kind:'add',ingredient}),kit=new FoodKit(),food=marketFood(run,kit),surface=createMarketWorktop();
  surface.add(food.root);food.root.position.y=.25;surface.updateMatrixWorld(true);
  try{
   let hits=0;const camera=marketFrontCamera(390,440),ray=new Raycaster();
   for(let y=-.8;y<=.8;y+=.02)for(let x=-.8;x<=.8;x+=.02){
    ray.setFromCamera(new Vector2(x,y),camera);const hit=ray.intersectObject(food.root,true)[0];if(hit&&(id==='egg-fried-rice'||id==='shawarma'||marketHitPortion(hit,food.root)===0))hits++;
   }
   assert.ok(hits>0,`${id}: actual front-facing geometry retains a directly selectable portion`);
  }finally{food.dispose();kit.dispose();}
 }
});

// UX-9: a single plated dog remains on the left, not at the generic dish center.
// Use real batched food triangles and production camera/worktop; no browser claim.
for(const [width,height] of [[296,514],[1180,614],[600,500]])test(`plated single corn dog sauce starts on its actual triangle at ${width}x${height}`,async()=>{
 const {marketFrontCamera,createMarketWorktop}=await import('../../apps/portal-web/src/games/cooking/market-stage.js');
 const {Box3,Vector2}=await import('three');
 let run=act(begin('corn-dog'),{kind:'add',ingredient:'sausage'});run=act(run,{kind:'coat'});run=time(run,24000);run=act(run,{kind:'flip',index:0});run=time(run,24000);run=time(act(run,{kind:'lift'}),4000);
 assert.equal(run.status,'playing');assert.equal(run.portions.length,1);assert.ok(run.portions[0].lifted&&run.portions[0].coated&&run.portions[0].drain>=3000);
 const kit=new FoodKit(),food=marketFood(run,kit),foodRoot=new Group(),surface=createMarketWorktop(),camera=marketFrontCamera(width,height);
 try{
  const bottom=new Box3().setFromObject(food.root).min.y;
  foodRoot.add(food.root);foodRoot.position.y=-.225-bottom;surface.add(foodRoot);surface.updateMatrixWorld(true);camera.zoom=1.15;camera.updateProjectionMatrix();
  const hitAt=(point:Vector3)=>{
   const projected=surface.localToWorld(point.clone()).project(camera);assert.ok(Math.abs(projected.x)<1&&Math.abs(projected.y)<1);
   const ray=new Raycaster();ray.setFromCamera(new Vector2(projected.x,projected.y),camera);
   const closest=ray.intersectObjects(foodRoot.children,true)[0];assert.ok(closest,'actual triangle must be hit, not a synthetic interaction plane');
   const local=surface.worldToLocal(closest.point.clone()),domain={x:local.x/3.4+.5,y:local.z/2.5+.5};
   return {index:marketHitPortion(closest,foodRoot),domain,accepted:domain.x>=0&&domain.x<=1&&domain.y>=0&&domain.y<=1};
  };
  const oldStart=hitAt(new Vector3(-.6,.5,-.35));assert.equal(oldStart.index,null,'generic dish start hits unowned paper tray, not the left dog');assert.ok(oldStart.domain.y<0,'tray hit lies beyond the sauce domain');assert.equal(oldStart.accepted,false,'production domain bounds reject the old UX-9 start');
  const points=[];
  for(let step=0;step<=10;step++){
   const hit=hitAt(new Vector3(-1.15+step*.01,.5,-.4+step*.08));assert.equal(hit.index,0,'every drag sample must hit the sole food portion');assert.equal(hit.accepted,true);points.push(hit.domain);
  }
  const dressed=applyMarket(run,{kind:'sauce',line:{sauce:'garlic',points}}).run;
  assert.equal(dressed.sauces.length,1);assert.deepEqual(dressed.sauces[0].points,points);assert.deepEqual(dressed.portions,run.portions);
 }finally{food.dispose();kit.dispose();}
});

for(const [width,height] of [[296,514],[1180,614],[600,500]])test(`fallback sauce follows SVG meet coordinates and rejects letterbox at ${width}x${height}`,()=>{
 const ui=marketUi();ui.click('開火，開始做！');ui.tick(0);ui.tick(400);ui.click('熱狗＋70g');ui.click('調味醬線');ui.click('番茄醬');
 const scale=Math.min(width/600,height/500),left=13,top=27,ox=(width-600*scale)/2,oy=(height-500*scale)/2;
 const svg={viewBox:{baseVal:{x:0,y:0,width:600,height:500}},getScreenCTM:()=>({inverse:()=>({a:1/scale,b:0,c:0,d:1/scale,e:-(left+ox)/scale,f:-(top+oy)/scale})})};
 const currentTarget={getBoundingClientRect:()=>({left,top,width,height}),querySelector:()=>svg,focus(){},setPointerCapture(){}},target={closest:()=>null};
 const event=(x:number,y:number,id=7)=>({isPrimary:true,button:0,pointerId:id,clientX:left+ox+x*600*scale,clientY:top+oy+y*500*scale,currentTarget,target,preventDefault(){}});
 const handlers=()=>ui.find(n=>n.props.className==='mk-surface').props;
 handlers().onPointerDown(event(.4,.4));handlers().onPointerMove(event(.6,.6,8));handlers().onPointerMove(event(.6,.6));handlers().onPointerUp(event(.6,.6));ui.render();
 const points=ui.state().sauces[0].points;assert.equal(points.length,2);for(const [i,n] of [.4,.6].entries()){assert.ok(Math.abs(points[i].x-n)<1e-12);assert.ok(Math.abs(points[i].y-n)<1e-12);}
 const outside=ox>0?{...event(0,.4),clientX:left+ox/2}:{...event(.4,0),clientY:top+oy/2-1};
 handlers().onPointerDown(outside);handlers().onPointerMove(event(.5,.5));handlers().onPointerUp(event(.5,.5));ui.render();assert.equal(ui.state().sauces.length,1,'letterbox must not start a stroke');
 handlers().onPointerDown(event(.4,.4));handlers().onPointerMove(outside);handlers().onPointerCancel(event(.4,.4));handlers().onPointerUp(event(.4,.4));ui.render();assert.equal(ui.state().sauces.length,1,'cancelled stroke remains cancelled');
 svg.getScreenCTM=()=>null as any;handlers().onPointerDown(event(.4,.4));handlers().onPointerUp(event(.4,.4));ui.render();assert.equal(ui.state().sauces.length,1,'unmeasurable SVG must not guess its coordinates');
});

// Measured on a105c57331, before the market-only geometry redesign. These are
// the old assembly costs, not new relaxed rendering budgets or browser evidence.
for(const [id,triangles,draws] of [['egg-fried-rice',116508,8],['steak-dinner',42132,30],['shawarma',16560,8],['corn-dog',72064,36]] as const)test(`market art ${id}: deterministic 16-portion geometry stays within previous cost and disposes once`,()=>{
 const run=displayMarket(id);run.portions=Array.from({length:16},(_,i)=>({...run.portions[i%run.portions.length]}));
 const before=JSON.stringify(run),kit=new FoodKit(),shared=new Map([...kit.geometries].map(g=>[g,0]));
 for(const g of shared.keys())g.addEventListener('dispose',()=>shared.set(g,shared.get(g)!+1));
 let expected:string|undefined,materialCount:number|undefined;
 try{
  for(const elapsed of [run.elapsed,run.elapsed+16,run.elapsed+32000]){
   const food=marketFood({...run,elapsed},kit),owned=new Map(food.geometries.map(g=>[g,0])),hash=createHash('sha256');let actualTriangles=0,actualDraws=0;
   for(const g of owned.keys())g.addEventListener('dispose',()=>owned.set(g,owned.get(g)!+1));
   try{
    food.root.updateMatrixWorld(true);food.root.traverse(o=>{
     if(!(o instanceof Mesh))return;
     const geometry=o.geometry;actualTriangles+=(geometry.index?.count??geometry.getAttribute('position').count)/3;actualDraws+=Array.isArray(o.material)?geometry.groups.length:1;
     hash.update(JSON.stringify([o.matrixWorld.elements,geometry.groups,o.userData]));
     for(const name of Object.keys(geometry.attributes).sort())hash.update(JSON.stringify([name,Array.from(geometry.getAttribute(name).array)]));
     if(geometry.index)hash.update(JSON.stringify(Array.from(geometry.index.array)));
     const position=geometry.getAttribute('position');for(let i=0;i<position.count;i++)assert.ok(Number.isFinite(position.getX(i))&&Number.isFinite(position.getY(i))&&Number.isFinite(position.getZ(i)));
    });
    assert.ok(actualTriangles<=triangles,`${actualTriangles} triangles must not exceed old ${triangles}`);assert.ok(actualDraws<=draws,`${actualDraws} draws must not exceed old ${draws}`);
    const digest=hash.digest('hex');if(expected)assert.equal(digest,expected,'elapsed frames must not randomize or accumulate decorative geometry');else expected=digest;
    if(materialCount!==undefined)assert.equal(kit.materials.size,materialCount,'rebuilding unchanged food must not grow the material cache');else materialCount=kit.materials.size;
   }finally{food.dispose();food.dispose();}
   assert.ok([...owned.values()].every(count=>count===1),'all temporary originals, clones and batch outputs dispose exactly once');assert.equal(food.root.children.length,0);assert.ok([...shared.values()].every(count=>count===0),'assembly must never dispose shared kit geometry');
  }
  assert.equal(JSON.stringify(run),before,'art cannot mutate the recipe, portions or sauce');
 }finally{kit.dispose();kit.dispose();}
 assert.ok([...shared.values()].every(count=>count===1));
});

// Instrument the renderer boundary only: real scene, food, camera and transforms
// still execute. This proves eliminated duplicate work, not GPU/browser timing.
test('market viewport allocates and renders once per size, reuses shadows only for camera resize and restores capture',async()=>{
 const three=await import('three'),deps:Record<string,unknown>={three:null};
 for(const name of ['food-kit','market-food','corn-dog-stall','corn-dog-presentation','shawarma-presentation'])deps[`./${name}`]=await import(`../../apps/portal-web/src/games/cooking/${name}.js`);
 deps['../stage-batch']=await import('../../apps/portal-web/src/games/stage-batch.js');deps['./food-studio']={foodStudio:()=>({dispose(){}})};
 const allocations:number[][]=[],renders:Array<{shadow:boolean;aspect:number;zoom:number}>=[];
 let box={width:390,height:447},notifyResize=()=>{},windowResize=()=>{},disconnected=false,failCapture=false;
 class Renderer{
  shadowMap={enabled:false,autoUpdate:true,needsUpdate:false};info={render:{calls:1,triangles:1},memory:{geometries:1,textures:1}};
  domElement={setAttribute(){},addEventListener(){},removeEventListener(){},remove(){},toDataURL(){if(failCapture)throw Error('capture failed');return 'data:image/png;native-boundary';}};
  setDrawingBufferSize(w:number,h:number,dpr:number){allocations.push([w,h,dpr]);}
  setPixelRatio(){assert.fail('pixel-ratio setter would resize a second time');}setSize(){assert.fail('use one atomic drawing-buffer resize');}
  render(_scene:unknown,camera:{aspect:number;zoom:number}){renders.push({shadow:this.shadowMap.autoUpdate||this.shadowMap.needsUpdate,aspect:camera.aspect,zoom:camera.zoom});this.shadowMap.needsUpdate=false;}
  dispose(){}forceContextLoss(){}
 }
 deps.three={...three,WebGLRenderer:Renderer};
 const module={exports:{} as {createMarketStage:typeof import('../../apps/portal-web/src/games/cooking/market-stage.js').createMarketStage}};
 runInNewContext(transformSync(readFileSync(new URL('../../apps/portal-web/src/games/cooking/market-stage.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{
  module,exports:module.exports,devicePixelRatio:1.5,require:(id:string)=>{assert.ok(id in deps,id);return deps[id];},
  matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
  ResizeObserver:class{constructor(callback:()=>void){notifyResize=callback;}observe(){}disconnect(){disconnected=true;}},
  window:{addEventListener(_name:string,callback:()=>void){windowResize=callback;},removeEventListener(){}}
 });
 const stage=module.exports.createMarketStage({append(){},getBoundingClientRect:()=>box} as unknown as HTMLElement,()=>{});
 try{
  assert.equal(allocations.length,1);assert.equal(renders.length,0);
  const paused={...begin('corn-dog'),status:'paused' as const};stage.update(paused);assert.equal(renders.length,1);assert.equal(renders.at(-1)!.shadow,true);
  notifyResize();windowResize();assert.equal(allocations.length,1);assert.equal(renders.length,1,'initial observer and duplicate window notifications must not redraw');
  box={width:1180,height:614};windowResize();notifyResize();
  assert.equal(allocations.length,2);assert.equal(renders.length,2);assert.equal(renders.at(-1)!.shadow,false,'light-space shadow map is independent of camera aspect');assert.equal(renders.at(-1)!.aspect,1180/614);
  for(const [w,h,dpr]of allocations){assert.equal(dpr,1);assert.ok(w*h<=768*640*2.25);}
  for(const run of [begin('shawarma'),time(begin('shawarma'),1000),act(begin('egg-fried-rice'),{kind:'toss'}),{...paused,status:'done' as const}]){stage.update(run);assert.equal(renders.at(-1)!.shadow,true,'all scene updates, including motion, return/reset and plated transitions, refresh shadows');}
  stage.update(paused);const start=renders.length,allocationStart=allocations.length;
  assert.equal(stage.capture(),'data:image/png;native-boundary');assert.equal(renders.length,start+2,'capture renders completed and restored states, without an extra resize render');assert.equal(allocations.length,allocationStart+2);assert.equal(renders.at(-1)!.aspect,1180/614);assert.equal(renders.at(-1)!.zoom,1);assert.ok(renders.slice(start).every(r=>r.shadow));
  failCapture=true;assert.throws(()=>stage.capture(),/capture failed/);assert.equal(renders.at(-1)!.aspect,1180/614);assert.equal(renders.at(-1)!.zoom,1);assert.equal(renders.at(-1)!.shadow,true);
 }finally{stage.dispose();}
 assert.equal(disconnected,true);const before=renders.length;notifyResize();windowResize();assert.equal(renders.length,before);
});

// Retain the actual pre-batch meshes to measure contacts after the production
// assembly transforms them. No synthetic screenshot or renderer acceptance.
test('fried rice grains and garnish follow the real mound surface rather than a floating height plane',async()=>{
 const {Box3}=await import('three'),kit=new FoodKit(),mesh=kit.mesh.bind(kit),garnishes=new Map<Group,Mesh[]>();let mound:Mesh|undefined,grains=0;
 kit.mesh=((...args:Parameters<FoodKit['mesh']>)=>{const m=mesh(...args);if(args[9]==='rice'){if(args[1]===kit.sphere)assert.fail('mound must own its sculpted geometry');if(!mound)mound=m;else grains++;}else if(args[2]==='#e7bd52'){const list=garnishes.get(args[0])??[];list.push(m);garnishes.set(args[0],list);}return m;}) as FoodKit['mesh'];
 const run=displayMarket('egg-fried-rice');run.portions=run.portions.filter(p=>p.kind==='rice'||p.kind==='egg');const food=marketFood(run,kit);
 try{
  assert.ok(mound);assert.equal(grains,420);assert.equal(garnishes.size,5);const ray=new Raycaster(new Vector3(),new Vector3(0,-1,0),0,20);
  for(const [group,parts]of garnishes){
   const center=new Vector3().setFromMatrixPosition(group.matrixWorld);ray.ray.origin.set(center.x,10,center.z);const hit:import('three').Intersection|undefined=ray.intersectObject(mound,false)[0];assert.ok(hit,'garnish center must be supported by mound');
   const bounds=new Box3();for(const part of parts){part.geometry.computeBoundingBox();bounds.union(part.geometry.boundingBox!.clone().applyMatrix4(part.matrixWorld));}
   assert.ok(Math.abs(bounds.min.y-hit.point.y+.012)<1e-6,'garnish underside must contact the real local surface with bounded embed');
  }
 }finally{food.dispose();kit.dispose();}
});
