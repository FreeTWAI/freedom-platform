import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceMarket,applyMarket,canServe,marketGrade,marketMass,newMarket,parseMarket,readMarket,saveMarket,MARKET_SAVE_KEY,type MarketRun,type MarketAction} from '../../apps/portal-web/src/games/cooking/market-domain.js';
import {emptyCookbook,updateCookbook} from '../../apps/portal-web/src/games/cooking/storage.js';
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
