import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceMarket,applyMarket,canServe,marketGrade,marketMass,newMarket,parseMarket,readMarket,saveMarket,MARKET_SAVE_KEY,type MarketRun,type MarketAction} from '../../apps/portal-web/src/games/cooking/market-domain.js';
import {emptyCookbook,updateCookbook} from '../../apps/portal-web/src/games/cooking/storage.js';
import {Float32BufferAttribute,Group,Mesh,Raycaster,Vector3} from 'three';
import {FoodKit} from '../../apps/portal-web/src/games/cooking/food-kit.js';
import {marketFood} from '../../apps/portal-web/src/games/cooking/market-food.js';
import {marketHitPortion} from '../../apps/portal-web/src/games/cooking/market-stage.js';
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
