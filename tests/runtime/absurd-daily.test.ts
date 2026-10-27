import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import {GAMES,seconds} from '../../apps/portal-web/src/games/domain.js';
import {beginStamps,cashDeck,challengeUrl,gradePhoto,newCash,newStamps,pause,photoPose,resume,RULES,seedOf,sortCash,stamp,stampTarget,tick} from '../../apps/portal-web/src/games/domain.js';
import {GAME_HANDOFF_KEY,HANDOFF_TTL,parseGameDraft,readGameDraft,saveGameDraft,clearGameDraft} from '../../apps/portal-web/src/games/result-bridge.js';
test('AD-2 validates seed and emits a public challenge without result or identity',()=>{for(const bad of [0,-1,Infinity,NaN,'1x','0x12','4294967296',null,{},1.5])assert.equal(seedOf(bad),20261023);assert.equal(seedOf('4294967295'),4294967295);const u=new URL(challengeUrl('https://example.org','photo',12));assert.equal(u.pathname,'/play');assert.deepEqual([...u.searchParams],[['game','photo'],['seed','12']]);});
test('AD-5 every seeded deck contains exactly one million and six unique decoys; last note is fixed',()=>{for(let seed=1;seed<=400;seed++){const d=cashDeck(seed);assert.equal(d.length,30);assert.equal(new Set(d.map(c=>c.id)).size,30);assert.equal(d.reduce((sum,c)=>sum+c.amount,0),RULES.targetCash);assert.equal(d.filter(c=>c.valid).length,24);assert.equal(new Set(d.filter(c=>!c.valid).map(c=>c.label)).size,6);assert.equal(d.at(-1)?.amount,100000);assert.deepEqual(d,cashDeck(seed));}assert.notDeepEqual(cashDeck(1),cashDeck(2));});
test('AD-5 wrong sort changes neither progress nor money; stale and rapid actions do not consume a card',()=>{let s=newCash(9);const valid=cashDeck(9)[0].valid;let out=sortCash(s,0,!valid,0);assert.equal(out.kind,'wrong');assert.equal(out.state.index,0);assert.equal(out.state.amount,0);assert.equal(out.state.mistakes,1);s=out.state;assert.equal(sortCash(s,0,valid,20).state,s);s=sortCash(s,0,valid,200).state;assert.equal(s.index,1);assert.equal(sortCash(s,0,valid,400).state,s);for(const now of [NaN,Infinity,-1])assert.equal(sortCash(s,1,true,now).state,s);});
test('AD-5 a full run settles once with exact original facts',()=>{let s=newCash(100);for(const card of cashDeck(100))s=sortCash(s,s.index,card.valid,s.index*250).state;assert.equal(s.amount,1_000_000);assert.equal(s.index,30);assert.equal(s.rejected,6);assert.equal(s.endedAt,7250);assert.equal(sortCash(s,30,true,9000).state,s);});
test('AD-4 fixed seeded target, finite bounds, miss marks and completed clock',()=>{for(let seed=1;seed<100;seed++)for(let i=0;i<12;i++){const t=stampTarget(seed,i);assert.ok(Math.abs(t.x)<.7&&Math.abs(t.y)<.6);assert.deepEqual(t,stampTarget(seed,i));}let s=newStamps(42,false);assert.equal(stamp(s,0,{x:NaN,y:0},0).state,s);assert.equal(stamp(s,0,{x:2,y:0},0).state,s);s=beginStamps(s,0);s=stamp(s,0,{x:1.1,y:1.1},250).state;assert.equal(s.index,0);assert.equal(s.misses,1);assert.equal(s.marks.length,1);for(let i=0;i<12;i++){const prev=s;s=stamp(s,i,stampTarget(42,i),500+i*250).state;assert.equal(prev.index,i);assert.equal(s.index,i+1);assert.equal(stamp(s,i,stampTarget(42,i),9000).state,s);}assert.equal(s.endedAt,3250);assert.equal(s.startedAt,0);assert.equal(s.misses,1);assert.equal(stamp(s,12,{x:0,y:0},5000).state,s);});
test('AD-4 practice is uncounted; its stale pointer cannot stamp the first real document',()=>{const initial=newStamps(3);const p=stamp(initial,-1,stampTarget(3,0),200);assert.equal(p.kind,'practice');assert.equal(p.state.index,0);assert.equal(p.state.practice,false);assert.equal(p.state.startedAt,null);assert.equal(stamp(p.state,0,stampTarget(3,0),250).kind,'ignored');assert.equal(stamp(p.state,-1,stampTarget(3,0),1000).state,p.state);});
test('AD-3 actual visible anchors and occlusion drive objective and funny captions',()=>{assert.equal(gradePhoto('pigeons',['bird0','bird2'],5).stars,2);assert.equal(gradePhoto('pigeons',['bird0','bird1','bird2'],5).stars,3);assert.match(gradePhoto('backdrop',['board'],5,true).caption,/背景出席/);assert.equal(gradePhoto('umbrella',['feet','head','umbrella'],5).stars,3);assert.match(gradePhoto('umbrella',['feet'],5).caption,/兩隻鞋/);assert.equal(photoPose('pigeons',0,1).birds.filter(x=>x>0).length,0);assert.equal(photoPose('pigeons',6,1).birds.filter(x=>x>0).length,3);assert.ok(photoPose('umbrella',5,1).lift>2);});
test('AD-2 foreground clock counts elapsed time, pauses, and never charges the background interval',()=>{let c={elapsed:0,last:null as number|null,running:true};c=tick(c,100);c=tick(c,450);assert.equal(c.elapsed,350);c=pause(c);c=tick(c,10000);assert.equal(c.elapsed,350);c=resume(c);c=tick(c,20000);c=tick(c,20100);assert.equal(c.elapsed,450);assert.equal(tick(c,NaN),c);});
function storage(){const map=new Map<string,string>();return {getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};}
test('AD-2 an input timestamp ahead of a queued render cannot double count foreground time',()=>{
  let clock={elapsed:0,last:100,running:true};clock=tick(clock,350) as typeof clock;
  assert.equal(tick(clock,330),clock);clock=tick(clock,400) as typeof clock;assert.equal(clock.elapsed,300);
});
test('AD-7 bounded guest draft survives reload, reads are pure, and stale clearing cannot delete a newer result',()=>{const s=storage(),now=Date.now(),draft={version:1 as const,createdAt:now,game:'photo' as const,seed:7,title:'這張能交嗎？',text:'真的拍到了。',image:'data:image/jpeg;base64,YWJjZA=='};saveGameDraft(s,draft,now);const before=s.getItem(GAME_HANDOFF_KEY);assert.deepEqual(readGameDraft(s,now),draft);assert.equal(s.getItem(GAME_HANDOFF_KEY),before);clearGameDraft(s,now-1);assert.equal(s.getItem(GAME_HANDOFF_KEY),before);clearGameDraft(s,now);assert.equal(readGameDraft(s,now),null);});
test('AD-7 malformed, expired, future, oversized and unavailable storage cannot falsely succeed',()=>{const now=Date.now(),draft={version:1,createdAt:now,game:'cash',seed:7,title:'盤點',text:'道具鈔',image:'data:image/jpeg;base64,YWJjZA=='};for(const changed of [{version:2},{createdAt:now-HANDOFF_TTL-1},{createdAt:now+61000},{seed:NaN},{seed:0},{image:'data:text/html;base64,AAAA'},{title:''},{text:'x'.repeat(2001)}])assert.equal(parseGameDraft(JSON.stringify({...draft,...changed}),now),null);assert.equal(parseGameDraft('{bad',now),null);assert.equal(readGameDraft({getItem(){throw Error('denied');},setItem(){},removeItem(){}},now),null);assert.throws(()=>saveGameDraft({getItem(){return null;},setItem(){throw Error('quota');},removeItem(){}},draft as any,now),/quota/);});

import {CATEGORIES,RECIPES,recipeOf,recipeSearch,TECHNIQUES} from '../../apps/portal-web/src/games/cooking/catalog.js';
import {actCooking,advanceCooking,cookingProgress,cookingScore,currentStep,cutGuide,newCookingRun,parseCookingRun,plateTarget,type CookingRun,type CookingAction} from '../../apps/portal-web/src/games/cooking/domain.js';
import {COOKBOOK_KEY,COOKBOOK_BACKUP,COOKING_RUN_KEY,RUN_TTL,emptyCookbook,parseCookbook,readCookbook,updateCookbook,readCookingRun,saveCookingRun,clearCookingRun} from '../../apps/portal-web/src/games/cooking/storage.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {PARTY_GAMES,PARTY_RULES as PT,partyOf} from '../../apps/portal-web/src/games/party/catalog.js';
import {actParty,advanceParty,chairWave,holidayTargets,newParty,pauseParty,resumeParty,startParty,tofuAxis,tofuPosition,type PartyRun,type ChairRun,type TofuRun,type HolidayRun} from '../../apps/portal-web/src/games/party/domain.js';
import {DISH_DESIGNS,dishDesign} from '../../apps/portal-web/src/games/cooking/dish-designs.js';
import {displayMarket} from '../../apps/portal-web/src/games/cooking/market-food.js';
import {createDishModel,type DishMesh} from '../../apps/portal-web/src/games/cooking/dish-model.js';
import {createRequire} from 'node:module';
import {coverOf} from '../../apps/portal-web/src/games/GameCover.js';
import {syncDiagnostics} from '../../apps/portal-web/src/games/diagnostics.js';
const {Box3}=createRequire(new URL('../../apps/portal-web/package.json',import.meta.url))('three');
import {GAME_SHARE_PLATFORMS,gameShareText,gameSocialLink} from '../../apps/portal-web/src/games/result-share.js';

test('CK-6: all result kinds encode social handoffs as text/link intents without credentials or publish instructions',()=>{
  for(const game of ['photo','stamp','cash','kitchen'] as const){const link=`https://example.org/play?game=${game}&seed=42${game==='kitchen'?'&recipe=egg-fried-rice':''}`,result={game,title:'黃金蛋炒飯 & <作品>',caption:'這局真的很香！',details:'3 顆星 · 99 分',seed:42,image:'data:image/jpeg;base64,YWJjZA=='};const text=gameShareText(result,link);
    assert.ok(text.includes(link));assert.ok(text.includes(result.details));
    for(const platform of GAME_SHARE_PLATFORMS){const u=new URL(gameSocialLink(platform.id,link,text));assert.equal(u.protocol,'https:');assert.equal(u.username,'');assert.equal(u.password,'');if(platform.id==='facebook'){assert.equal(u.searchParams.get('u'),link);assert.equal(u.searchParams.get('text'),null);}else if(platform.id==='instagram'){assert.equal(u.origin,'https://www.instagram.com');assert.equal(u.search,'');}else assert.equal(u.searchParams.get('text'),text);}
  }
});

test('CK-7: a failed favorite write survives completion against an older valid primary, then retries with fresh score maxima',()=>{
  const base=storage(),now=Date.now(),r=cook('egg-fried-rice').run;let saved=updateCookbook(base,emptyCookbook(),{kind:'complete',run:r},now);
  const denied={...base,setItem(){throw Error('quota');}};saved=updateCookbook(denied,saved.book,{kind:'favorite',id:'rice-balls'},now+1);assert.equal(saved.available,false);assert.deepEqual(saved.book.favorites,['rice-balls']);
  saved=updateCookbook(base,saved.book,{kind:'complete',run:cook('rice-balls').run},now+2,true);assert.equal(saved.available,true);assert.deepEqual(readCookbook(base,now+2).book.favorites,['rice-balls']);assert.equal(Object.keys(saved.book.best).length,2);
});

test('UX-8: every recipe has an explicit 3D design, with closed identities and no implicit dish',()=>{
  assert.deepEqual(Object.keys(DISH_DESIGNS).sort(),RECIPES.map(r=>r.id).sort());assert.ok(new Set(Object.values(DISH_DESIGNS).map(d=>d.family)).size>=30);
  for(const r of RECIPES){assert.equal(dishDesign(r.id),DISH_DESIGNS[r.id]);for(const c of [dishDesign(r.id).base,dishDesign(r.id).top,dishDesign(r.id).accent])assert.match(c,/^#[a-f0-9]{6}$/);}
  for(const id of ['unknown','__proto__','constructor','../../private'])assert.throws(()=>dishDesign(id),/Unknown 3D recipe/);
});
test('UX-8: all 66 native assemblies have finite bounded geometry, distinct real shapes/palettes and one-time disposal',()=>{
  const signatures=new Set<string>();for(const r of RECIPES){const model=createDishModel(r.id),bounds=new Box3().setFromObject(model.root);assert.ok(bounds.min.y>=-.3,r.id);assert.ok(bounds.max.y<3.7,r.id);assert.ok(bounds.min.x>-3.5&&bounds.max.x<3.5&&bounds.min.z>-3.5&&bounds.max.z<3.5,r.id);assert.ok(model.geometries.size<80,r.id);const hash=createHash('sha256');model.root.traverse(o=>{if((o as DishMesh).isMesh){const mesh=o as DishMesh,p=mesh.geometry.getAttribute('position');assert.ok(p.count>0);for(const n of p.array)assert.ok(Number.isFinite(n),r.id);hash.update(Buffer.from(p.array.buffer,p.array.byteOffset,p.array.byteLength));const m=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;hash.update((m as any).color.getHexString());}});signatures.add(hash.digest('hex'));let disposed=0;for(const g of model.geometries)g.addEventListener('dispose',()=>disposed++);model.dispose();model.dispose();assert.equal(disposed,model.geometries.size);assert.equal(model.root.children.length,0);}
  assert.equal(signatures.size,66);
});
test('UX-8: all 66 3D previews bind to the real model factory, native dimensions and immutable bytes',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../modules/absurd-daily/cooking-3d-art.json',import.meta.url),'utf8'));assert.equal(manifest.format,'freedom.cooking-3d-art/v1');assert.equal(manifest.previews.length,66);assert.deepEqual(manifest.previews.map((p:{recipe:string})=>p.recipe).sort(),RECIPES.map(r=>r.id).sort());
  for(const input of manifest.source_inputs)assert.equal(createHash('sha256').update(await readFile(new URL(`../../${input.path}`,import.meta.url))).digest('hex'),input.sha256);
  let bytes=0;for(const r of RECIPES){const entry=manifest.previews.find((p:{recipe:string})=>p.recipe===r.id),raw=await readFile(new URL(`../../${entry.path}`,import.meta.url)),info=await sharp(raw).metadata();assert.deepEqual([info.width,info.height],[512,384]);assert.equal(raw.length,entry.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),entry.sha256);assert.ok(entry.native.calls>0&&entry.native.calls<=100);assert.ok(entry.native.geometries<100);bytes+=raw.length;}assert.ok(bytes<=2.5*1024*1024);assert.equal(bytes,manifest.total_bytes);
});

test('CK-3: 66 original recipes have eight complete categories, unique art identities and real operation plans',()=>{
  assert.equal(RECIPES.length,66);assert.equal(new Set(RECIPES.map(r=>r.id)).size,66);assert.equal(new Set(RECIPES.map(r=>`${r.category}/${r.art}`)).size,66);
  for(const c of CATEGORIES)assert.equal(RECIPES.filter(r=>r.category===c.id).length,['taiwan','world'].includes(c.id)?9:8);
  for(const r of RECIPES){assert.ok(r.steps.length>=3&&r.steps.length<=4);assert.ok(r.ingredients.length>=3);assert.ok(r.estimatedSeconds>=20);assert.ok(r.art>=0&&r.art<9);assert.equal(recipeOf(r.id),r);assert.ok(r.steps.every(s=>TECHNIQUES[s.kind]));}
  assert.deepEqual([...new Set(RECIPES.flatMap(r=>r.steps.map(s=>s.kind)))].sort(),Object.keys(TECHNIQUES).sort());assert.ok(recipeSearch(recipeOf('strawberry-cake')!,'草莓 烘烤'));assert.equal(recipeSearch(RECIPES[0],'不存在的食材'),false);assert.equal(recipeOf('__proto__'),null);
});
function cook(recipeId:string){let run=newCookingRun(recipeOf(recipeId)!,42,`run_${recipeId}`),now=0;const send=(action:Omit<CookingAction,'step'>)=>{now+=150;run=actCooking(run,{...action,step:run.step} as CookingAction,now);};send({kind:'start'});
  let guard=0;while(run.status!=='done'&&guard++<2000){if(run.status==='step-result'){send({kind:'next'});continue;}const s=currentStep(run),a=run.active;
    if(s.kind==='slice'){const x=cutGuide(run);send({kind:'cut',x1:x,y1:.23,x2:x,y2:.78} as CookingAction);}
    if(s.kind==='mix'){for(let i=0;i<=48&&run.status==='playing';i++){const angle=i*Math.PI/12;now+=35;run=actCooking(run,{kind:'stir',step:run.step,x:.5+.3*Math.cos(angle),y:.52+.3*Math.sin(angle)},now);}}
    if(s.kind==='knead'){send({kind:'hold-start'});now+=s.holdMs;run=actCooking(run,{kind:'hold-end',step:run.step},now);}
    if(['pan','boil','bake'].includes(s.kind)){send({kind:'heat',value:s.heat} as CookingAction);now+=100;run=advanceCooking(run,now);if(s.kind==='pan'&&run.active.amount>.5&&!run.active.flipped)send({kind:'flip'});if(s.kind==='boil'&&run.active.foam>=.2)send({kind:'skim'});if(s.kind==='bake'&&run.active.amount>=.79)send({kind:'take-out'});}
    if(s.kind==='pour'){send({kind:'hold-start'});while(run.active.amount<s.target&&run.status==='playing'){now+=50;run=advanceCooking(run,now);}send({kind:'hold-end'});}
    if(s.kind==='fold')send({kind:'fold',index:a.count,direction:s.directions[a.count]} as CookingAction);
    if(s.kind==='plate')send({kind:'place',index:a.count,...plateTarget(run)} as CookingAction);
  }
  assert.equal(run.status,'done',recipeId);return {run,now};
}
test('CK-4/5: actual pointer coordinates, holds, heat and ordered gestures complete all 66 dishes once',()=>{
  for(const recipe of RECIPES){const {run,now}=cook(recipe.id);assert.equal(run.reports.length,recipe.steps.length);assert.ok(cookingScore(run)>=85,`${recipe.id}: ${cookingScore(run)}`);assert.equal(cookingProgress(run),1);assert.deepEqual(parseCookingRun(JSON.parse(JSON.stringify(run))),run);assert.deepEqual(actCooking(run,{kind:'next',step:run.step},now+100),run);assert.deepEqual(advanceCooking(run,now+99999),run);}
});
test('CK-5: wrong cut, stale step, rapid input, invalid coordinates and rewind cannot fabricate progress',()=>{
  let r=newCookingRun(RECIPES[0],42,'gesture_case');r=actCooking(r,{kind:'start',step:0},100);assert.equal(actCooking(r,{kind:'cut-key',step:1},200),r);assert.equal(actCooking(r,{kind:'cut-key',step:0},99),r);
  r=actCooking(r,{kind:'cut',step:0,x1:.2,y1:.5,x2:.8,y2:.5},300);assert.equal(r.active.count,0);assert.equal(r.active.mistakes,1);r=actCooking(r,{kind:'cut-key',step:0},500);const count=r.active.count;r=actCooking(r,{kind:'cut-key',step:0},510);assert.equal(r.active.count,count);
  for(const bad of [NaN,Infinity,-1,2]){const before=r.active.count;r=actCooking(r,{kind:'cut',step:0,x1:bad,y1:.1,x2:bad,y2:.8},700);assert.equal(r.active.count,before);}
});
test('CK-5/7: background time, cancelled holds, reversed mixing and out-of-bowl motion add no work',()=>{
  const dish=recipeOf('rice-balls')!;let r=newCookingRun(dish,42,'hold_case');r=actCooking(r,{kind:'start',step:0},0);const before=r.active.amount;
  for(let i=0;i<30;i++)r=actCooking(r,{kind:'stir',step:0,x:.5+.3*Math.cos(-i*.3),y:.52+.3*Math.sin(-i*.3)},i*20);assert.equal(r.active.amount,before);r=actCooking(r,{kind:'stir',step:0,x:1,y:1},700);assert.equal(r.active.angle,null);
  r=actCooking(r,{kind:'pause',step:0},750);const paused=JSON.stringify(r);assert.equal(JSON.stringify(advanceCooking(r,999999)),paused);r=actCooking(r,{kind:'resume',step:0},999999);assert.equal(r.elapsed,750);r=advanceCooking(r,1999999);assert.equal(r.elapsed,1000750);
  const knead=recipeOf('italian-meatballs')!;let k=newCookingRun(knead,42,'cancel_case');k={...k,step:2,status:'playing',reports:[{step:0,score:100,elapsed:0,mistakes:0},{step:1,score:100,elapsed:0,mistakes:0}],lastNow:0};k=actCooking(k,{kind:'hold-start',step:2},20);k=actCooking(k,{kind:'cancel',step:2},400);k=actCooking(k,{kind:'hold-end',step:2},800);assert.equal(k.active.count,0);
});
test('CK-5: flip and skimming are required; over-baking has a reachable low-score ending',()=>{
  const source=cook('egg-fried-rice').run;let r={...newCookingRun(RECIPES[0],42,'pan_case'),step:1,status:'playing' as const,lastNow:0,reports:[source.reports[0]]};r=actCooking(r,{kind:'heat',step:1,value:58},0) as typeof r;for(let t=500;t<=8500;t+=500)r=advanceCooking(r,t) as typeof r;assert.equal(r.status,'playing');assert.equal(r.active.amount>=1,true);r=actCooking(r,{kind:'flip',step:1},9000) as typeof r;assert.equal(r.status,'step-result');
  const recipe=recipeOf('chocolate-brownie')!;let b:CookingRun={...newCookingRun(recipe,42,'bake_case'),step:2,status:'playing',lastNow:0,reports:[{step:0,score:100,elapsed:0,mistakes:0},{step:1,score:100,elapsed:0,mistakes:0}]};for(let t=500;t<=12000&&b.status==='playing';t+=500)b=advanceCooking(b,t);assert.equal(b.status,'done');assert.ok(b.reports.at(-1)!.score<30);
});
test('CK-7: pure checkpoint reads restore a paused run; malformed, future and expired data fail closed',()=>{
  const s=storage(),now=Date.now();let r=newCookingRun(RECIPES[0],42,'checkpoint');r=actCooking(r,{kind:'start',step:0},1);r=actCooking(r,{kind:'cut-key',step:0},150);assert.equal(saveCookingRun(s,r,now),true);const raw=s.getItem(COOKING_RUN_KEY);const restored=readCookingRun(s,now).run!;assert.equal(restored.status,'paused');assert.equal(restored.active.count,1);assert.equal(s.getItem(COOKING_RUN_KEY),raw);clearCookingRun(s,'another-run');assert.equal(s.getItem(COOKING_RUN_KEY),raw);assert.equal(readCookingRun(s,now+RUN_TTL+1).run,null);
  for(const change of [{version:2},{step:99},{elapsed:Infinity},{status:'ready'},{reports:[]}])assert.equal(parseCookingRun({...cook('egg-fried-rice').run,...change}),null);
  s.setItem(COOKING_RUN_KEY,JSON.stringify({version:1,savedAt:now+61000,run:r}));assert.equal(readCookingRun(s,now).run,null);clearCookingRun(s,r.id);
});
test('CK-7: cookbook preserves best score, backs up only valid primary and recovers without any read-side writes',()=>{
  const s=storage(),now=Date.now(),first=cook('egg-fried-rice').run;let saved=updateCookbook(s,emptyCookbook(),{kind:'complete',run:first},now);assert.equal(saved.book.best[first.recipeId].score,cookingScore(first));saved=updateCookbook(s,saved.book,{kind:'favorite',id:first.recipeId},now);const good=s.getItem(COOKBOOK_BACKUP);assert.ok(good);
  const worse={...first,id:'other_run',reports:first.reports.map(r=>({...r,score:20}))};saved=updateCookbook(s,saved.book,{kind:'complete',run:worse},now);assert.equal(saved.book.best[first.recipeId].score,cookingScore(first));s.setItem(COOKBOOK_KEY,'{broken');const backup=s.getItem(COOKBOOK_BACKUP),read=readCookbook(s,now);assert.match(read.notice,/備份/);assert.equal(s.getItem(COOKBOOK_KEY),'{broken');assert.equal(s.getItem(COOKBOOK_BACKUP),backup);updateCookbook(s,read.book,{kind:'retry'},now);assert.equal(s.getItem(COOKBOOK_BACKUP),backup);
  for(const raw of ['{}','{broken',JSON.stringify({...saved.book,version:2}),JSON.stringify({...saved.book,favorites:['unknown']}),JSON.stringify({...saved.book,best:{unknown:{score:90}}})])assert.equal(parseCookbook(raw,now),null);
});
test('CK-7: denied/quota storage keeps a truthful in-memory book, with an explicit retry path',()=>{
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('quota');},removeItem(){throw Error('denied');}};assert.equal(readCookbook(denied).available,false);assert.equal(readCookingRun(denied).run,null);assert.equal(saveCookingRun(denied,newCookingRun(RECIPES[0],42,'denied')),false);const saved=updateCookbook(denied,emptyCookbook(),{kind:'complete',run:cook('egg-fried-rice').run});assert.equal(saved.available,false);assert.equal(Object.keys(saved.book.best).length,1);assert.match(saved.notice,/尚未保存/);
});
test('CK-6: cooking handoff remains bounded v1 and contains a recipe, never a publish command',()=>{
  const now=Date.now(),draft={version:1 as const,createdAt:now,game:'kitchen' as const,recipe:'egg-fried-rice',seed:42,title:'黃金蛋炒飯',text:'我的料理成果',image:'data:image/jpeg;base64,YWJjZA=='};assert.deepEqual(parseGameDraft(JSON.stringify({...draft,autoPublish:true}),now),draft);assert.equal(parseGameDraft(JSON.stringify({...draft,recipe:'../../private'}),now),null);assert.equal(parseGameDraft(JSON.stringify({...draft,recipe:undefined}),now),null);
});

function partyTime<T extends PartyRun>(initial:T,target:number):T {
  let s=initial;while(s.elapsed<target&&s.status==='playing')s=advanceParty(s,Math.min(100,target-s.elapsed)) as T;return s;
}
test('PT-1/2: three original catalogs and deterministic bounded clocks reject inactive and malformed time',()=>{
  assert.equal(PARTY_GAMES.length,3);assert.equal(partyOf('mario'),null);assert.equal(partyOf('tofu'),'tofu');
  assert.deepEqual(Array.from({length:22},(_,i)=>chairWave(42,i)),Array.from({length:22},(_,i)=>chairWave(42,i)));
  assert.notDeepEqual(chairWave(42,0),chairWave(43,0));
  for(const g of PARTY_GAMES){const ready=newParty(g.id,42);assert.equal(advanceParty(ready,500),ready);let s=startParty(ready);assert.equal(startParty(s),s);for(const d of [NaN,Infinity,-1,0])assert.equal(advanceParty(s,d),s);s=advanceParty(s,50000);assert.equal(s.elapsed,1000);const paused=pauseParty(s);assert.equal(advanceParty(paused,1000),paused);assert.equal(actParty(paused,{kind:'jump'}),paused);assert.equal(resumeParty(paused).status,'playing');}
});
test('PT-3: all 22 actual lane decisions collect tickets, avoid collisions and settle the same seeded course once',()=>{
  let s=startParty(newParty('chair',42)) as ChairRun;
  for(let i=0;i<PT.chairWaves;i++){
    const w=chairWave(42,i);assert.notEqual(w.lane,w.ticketLane);
    while(s.lane!==w.ticketLane){s=actParty(s,{kind:'lane',direction:w.ticketLane>s.lane?1:-1}) as ChairRun;s=partyTime(s,s.elapsed+140);}
    s=partyTime(s,w.at);assert.equal(s.lives,3);assert.equal(s.tickets,i+1);assert.equal(s.resolved,i+1);
  }
  s=partyTime(s,PT.chairMs);assert.equal(s.status,'done');assert.equal(s.score,4280);assert.equal(s.bestCombo,22);assert.equal(advanceParty(s,1000),s);assert.equal(actParty(s,{kind:'jump'}),s);
});
test('PT-3: collision uses arrival position, carts can be jumped, meeting tables cannot',()=>{
  const base=startParty(newParty('chair',42)) as ChairRun,w=chairWave(42,0);
  let late:ChairRun={...base,elapsed:w.at-1,resolved:0,lane:w.lane,x:w.lane};late=actParty(late,{kind:'lane',direction:w.lane===1?-1:1}) as ChairRun;
  assert.equal((advanceParty(late,30) as ChairRun).lives,2,'a new target lane cannot teleport across the collision');
  for(const kind of ['cart','meeting']){const i=Array.from({length:22},(_,j)=>j).find(j=>chairWave(42,j).kind===kind)!,wave=chairWave(42,i);let s:ChairRun={...base,elapsed:wave.at-400,resolved:i,lane:wave.lane,x:wave.lane};s=actParty(s,{kind:'jump'}) as ChairRun;assert.equal((advanceParty(s,400) as ChairRun).lives,kind==='cart'?3:2);}
  const locked=actParty(base,{kind:'lane',direction:1}) as ChairRun;assert.equal(actParty(locked,{kind:'lane',direction:-1}),locked);const jump=actParty(base,{kind:'jump'});assert.equal(actParty(jump,{kind:'jump'}),jump);
});
function tofuReady(s:TofuRun,perfect:boolean):TofuRun {
  const started=s.elapsed;while(s.status==='playing'&&s.elapsed-started<5000){const axis=tofuAxis(s),offset=Math.abs(tofuPosition(s)[axis]-s.layers[s.layers.length-1][axis]);if(perfect?offset<.06:offset>2.6)return s;s=advanceParty(s,5) as TofuRun;}throw Error('no reachable seeded tofu timing');
}
test('PT-4: twelve real timed drops build twelve immutable layers, with a single landing per fall',()=>{
  let s=startParty(newParty('tofu',42)) as TofuRun;
  for(let i=0;i<PT.tofuGoal;i++){s=tofuReady(s,true);const old=s;const falling=actParty(s,{kind:'drop'}) as TofuRun;assert.equal(actParty(falling,{kind:'drop'}),falling);assert.equal(falling.layers.length,i+1);s=advanceParty(falling,PT.tofuFallMs-1) as TofuRun;assert.equal(s.layers.length,i+1);s=advanceParty(s,1) as TofuRun;assert.equal(s.layers.length,i+2);assert.equal(old.layers.length,i+1);assert.equal(s.perfects,i+1);}
  assert.equal(s.status,'done');assert.equal(s.layers.length,13);assert.equal(s.score,2925);assert.equal(advanceParty(s,500),s);
});
test('PT-4: clipped overlap narrows the real tower and three misses end the game without extra layers',()=>{
  let s=startParty(newParty('tofu',42)) as TofuRun;
  for(let i=0;i<8&&s.status==='playing';i++){s=tofuReady(s,false);s=advanceParty(actParty(s,{kind:'drop'}),PT.tofuFallMs) as TofuRun;}
  assert.equal(s.status,'done');assert.equal(s.misses,3);assert.ok(s.layers.some(l=>l.width<1||l.depth<1));assert.ok(s.layers.every(l=>l.width>=PT.tofuMinimum&&l.depth>=PT.tofuMinimum));
});
test('PT-5: all twenty real target windows work, stale rounds and repeated holes never score twice',()=>{
  let s=startParty(newParty('holiday',42)) as HolidayRun;
  for(let i=0;i<20;i++){s=partyTime(s,i*PT.holidayRoundMs+PT.holidayOpenMs);const {good,boss}=holidayTargets(42,i);assert.notEqual(good,boss);const before=s;s=actParty(s,{kind:'pick',hole:good,round:i}) as HolidayRun;assert.equal(s.saved,i+1);assert.equal(actParty(s,{kind:'pick',hole:good,round:i}),s);assert.equal(actParty(s,{kind:'pick',hole:boss,round:i-1}),s);assert.equal(before.saved,i);}
  s=partyTime(s,PT.holidayMs);assert.equal(s.status,'done');assert.equal(s.score,5100);assert.equal(s.bestCombo,20);assert.equal(s.mistakes,0);
});
test('PT-5: missed windows, bosses and empty holes break combos with a nonnegative score floor',()=>{
  let s=startParty(newParty('holiday',42)) as HolidayRun;const {good,boss}=holidayTargets(42,0);assert.equal(actParty(s,{kind:'pick',hole:good,round:0}),s);s=partyTime(s,PT.holidayOpenMs);s=actParty(s,{kind:'pick',hole:good,round:0}) as HolidayRun;assert.equal(s.combo,1);s=actParty(s,{kind:'pick',hole:boss,round:0}) as HolidayRun;assert.equal(s.combo,0);assert.equal(s.score,40);const empty=Array.from({length:6},(_,i)=>i).filter(i=>i!==good&&i!==boss);for(const hole of empty)s=actParty(s,{kind:'pick',hole,round:0}) as HolidayRun;assert.equal(s.score,0);assert.equal(actParty(s,{kind:'pick',hole:NaN,round:0}),s);s=partyTime(s,1200+120);s=actParty(s,{kind:'pick',hole:holidayTargets(42,1).good,round:1}) as HolidayRun;assert.equal(s.combo,1);s=partyTime(s,3*1200);assert.equal(s.combo,0);
});
test('PT-7: party results extend the bounded v1 whitelist and strip untrusted publishing fields',()=>{
  const now=Date.now();for(const g of PARTY_GAMES){const draft={version:1,createdAt:now,game:g.id,seed:42,title:g.title,text:'本局 120 分',image:'data:image/jpeg;base64,YWJjZA=='};assert.deepEqual(parseGameDraft(JSON.stringify({...draft,recipe:'extra',autoPublish:true,score:999999}),now),draft);assert.equal(parseGameDraft(JSON.stringify({...draft,game:'../../private'}),now),null);}
});
test('PT-6: each tiny lobby preview binds to the actual procedural renderer, dimensions and immutable bytes',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../modules/absurd-daily/party-art.json',import.meta.url),'utf8'));
  assert.equal(manifest.format,'freedom.party-art/v1');assert.equal(manifest.previews.length,3);assert.equal(createHash('sha256').update(await readFile(new URL(`../../${manifest.source}`,import.meta.url))).digest('hex'),manifest.source_sha256);
  for(const input of manifest.source_inputs??[])assert.equal(createHash('sha256').update(await readFile(new URL(`../../${input.path}`,import.meta.url))).digest('hex'),input.sha256);
  let bytes=0;for(const g of PARTY_GAMES){const a=manifest.previews.find((p:{game:string})=>p.game===g.id);assert.ok(a);const raw=await readFile(new URL(`../../${a.path}`,import.meta.url)),info=await sharp(raw).metadata();assert.deepEqual([info.width,info.height],[640,480]);assert.equal(raw.length,a.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),a.sha256);bytes+=raw.length;}assert.ok(bytes<100000);
});


test('UX-12 sauce follows the cooked surface and falls onto the plate without mutating the saved run',()=>{
  const run=displayMarket('steak-dinner');run.portions=run.portions.slice(0,1);run.sauces=[{sauce:'garlic',points:[{x:.05,y:.5},{x:.4,y:.5},{x:.95,y:.5}]}];const saved=JSON.stringify(run),model=createDishModel('steak-dinner',run);let found=0;
  try{model.root.traverse(o=>{if(!(o as DishMesh).isMesh)return;const mesh=o as DishMesh;if(Array.isArray(mesh.material)||(mesh.material as any).color?.getHexString()!=='e9dfbd')return;found++;const bounds=new Box3().setFromObject(mesh);assert.ok(bounds.min.y<.2,'sauce must reach the plate outside the cutlet');assert.ok(bounds.max.y<.85,'sauce must not float over the cooked meal');});assert.equal(found,1);assert.equal(JSON.stringify(run),saved);}finally{model.dispose();}
});

test('UX-14: a steak sits on exposed cast iron, with open ear holes and a separate wooden trivet',()=>{
  const {Raycaster,Vector3}=createRequire(new URL('../../apps/portal-web/package.json',import.meta.url))('three');
  const run=displayMarket('steak-dinner');run.portions=run.portions.slice(0,1);const saved=JSON.stringify(run),model=createDishModel('steak-dinner',run);
  try{
    model.root.updateWorldMatrix(true,true);
    const ray=new Raycaster(new Vector3(1.9,5,0),new Vector3(0,-1,0));
    const exposed=ray.intersectObject(model.root,true)[0];assert.ok(exposed,'there is a serving surface');assert.equal((exposed.object as DishMesh).material instanceof Array,false);assert.equal(((exposed.object as DishMesh).material as any).color.getHexString(),'25272a','the wooden trivet cannot cover the iron well');
    ray.ray.origin.set(2.65,5,0);const throughEar=ray.intersectObject(model.root,true)[0];assert.ok(throughEar);assert.equal(((throughEar.object as DishMesh).material as any).color.getHexString(),'af7d4d','the ear is a real hole with wood below');
    const meat=model.root.children.find(o=>(o as DishMesh).isMesh&&Array.isArray((o as DishMesh).material))!;assert.ok(meat);const bounds=new Box3().setFromObject(meat);assert.ok(bounds.min.y>=.14&&bounds.min.y<=.16,'the steak rests on the iron well');assert.equal(JSON.stringify(run),saved);
  }finally{model.dispose();}
});

// Execute the actual cash/settlement closures with a controlled stage. Browser
// coverage remains responsible for real WebGL, image export and input dispatch.
function cashBoard(completedCards:number, failure?:'update'|'capture') {
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/AbsurdDaily.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm'}).code;
  const names=['draw','render','stop','finish','settle','syncClock','applyCash'];
  const functions=names.map(name=>{
    const start=new RegExp(`^( *)function ${name}\\(`,'m').exec(source);assert.ok(start,name);
    const tail=source.slice(start.index),end=new RegExp(`^${start[1]}}`,'m').exec(tail);assert.ok(end,`${name} end`);
    return tail.slice(0,end.index+end[0].length);
  }).join('\n');
  let cash=newCash(42);
  for(const card of cashDeck(42).slice(0,completedCards))cash=sortCash(cash,cash.index,card.valid,cash.index*250).state;
  const live={current:{game:'cash',seed:42,cash,clock:{elapsed:7500,last:7500,running:true},started:true,paused:false,done:false,pointer:{id:1},raised:true}};
  const events:{kind:string;index:number;running:boolean;raised:boolean;pointer:unknown}[]=[];
  const results:any[]=[],notices:string[]=[];
  let fail=failure,captureError=false;
  const record=(kind:string)=>events.push({kind,index:live.current.cash.index,running:live.current.clock.running,raised:live.current.raised,pointer:live.current.pointer});
  const stage={current:{
    update(){record('update');if(fail==='update'){fail=undefined;throw Error('render failed');}},
    stats(){return {calls:1,triangles:1,textures:1};},
    capture(){record('capture');if(fail==='capture'){fail=undefined;throw Error('capture failed');}return 'data:image/jpeg;base64,frame';},
  }};
  const pendingResult={current:null as any};
  const api=runInNewContext(`${functions};({applyCash,settle})`,{
    live,stage,pendingResult,view:()=>({cash:live.current.cash}),host:{current:{dataset:{}}},frame:{current:7},motionRef:{current:true},game:'cash',seed:42,
    performance:{now:()=>7500},tick,pause,sortCash,seconds,GAMES,cancelAnimationFrame:()=>record('stop'),
    syncDiagnostics,audio:{current:null},setReady:()=>{},setError:()=>{},
    sfx:()=>{},setNotice:(text:string)=>notices.push(text),updateUi:()=>{},onResult:(result:any)=>results.push(result),setCaptureError:(value:boolean)=>{captureError=value;},
  }) as {applyCash:(accept:boolean,index?:number)=>void;settle:(summary:any)=>void};
  return {...api,live,events,results,pendingResult,notices,get captureError(){return captureError;}};
}

test('AD-5 nonterminal cash inputs still render; wrong and stale inputs retain their rules',()=>{
  const h=cashBoard(0),first=cashDeck(42)[0];
  h.applyCash(!first.valid);
  assert.equal(h.live.current.cash.index,0);assert.equal(h.live.current.cash.mistakes,1);
  assert.deepEqual(h.events.map(e=>e.kind),['update']);assert.equal(h.results.length,0);
  const correct=cashBoard(0);correct.applyCash(first.valid);
  assert.equal(correct.live.current.cash.index,1);assert.deepEqual(correct.events.map(e=>e.kind),['update']);
  correct.applyCash(first.valid,0);assert.equal(correct.events.length,1);
});

test('AD-5 terminal cash input stops before its sole update and publishes the complete result once',()=>{
  const h=cashBoard(29);h.applyCash(true);
  assert.deepEqual(h.events.map(e=>e.kind),['stop','update','capture','stop']);
  const update=h.events[1];assert.equal(update.index,30);assert.equal(update.running,false);assert.equal(update.raised,false);assert.equal(update.pointer,null);
  assert.equal(h.live.current.cash.amount,1_000_000);assert.equal(h.live.current.cash.rejected,6);
  assert.equal(h.results.length,1);assert.match(h.results[0].details,/100 萬道具鈔 · 退回 6 張票券/);
  assert.equal(h.results[0].image,'data:image/jpeg;base64,frame');
  h.applyCash(true);assert.equal(h.results.length,1);assert.equal(h.events.length,4);
});

for(const failure of ['update','capture'] as const)test(`AD-5 terminal ${failure} failure retains completed facts for explicit capture retry`,()=>{
  const h=cashBoard(29,failure);h.applyCash(true);
  assert.equal(h.captureError,true);assert.equal(h.results.length,0);assert.equal(h.live.current.done,false);
  assert.equal(h.live.current.clock.running,false);assert.equal(h.live.current.cash.index,30);
  assert.match(h.notices.at(-1)!,/完成次數不會重算/);
  const completed=h.live.current.cash,summary=h.pendingResult.current;
  h.events.length=0;h.settle(summary);
  assert.deepEqual(h.events.map(e=>e.kind),['stop','update','capture','stop']);
  assert.equal(h.live.current.cash,completed);assert.equal(h.pendingResult.current,summary);
  assert.equal(h.results.length,1);assert.equal(h.live.current.done,true);
});

test('UX-15c: a held holiday canvas gesture retains its original round across a target change',()=>{
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/party/PartyGame.tsx',import.meta.url),'utf8'),{loader:'tsx',target:'es2023',format:'esm'}).code;
  const closures=['down','up'].map(name=>{
    const start=new RegExp(`^( *)function ${name}\\(`,'m').exec(source);assert.ok(start,name);
    const tail=source.slice(start.index),end=new RegExp(`^${start[1]}}`,'m').exec(tail);assert.ok(end,`${name} end`);
    return tail.slice(0,end.index+end[0].length);
  }).join('\n');
  const live={current:partyTime(startParty(newParty('holiday',42)) as HolidayRun,4600)},gesture={current:null as null|{id:number;x:number;y:number;round:number}};
  assert.equal(holidayTargets(42,live.current.round).good,0);
  const actions:unknown[]=[],target={setPointerCapture(){},hasPointerCapture(){return true;},releasePointerCapture(){},focus(){}};
  const h=runInNewContext(`${closures}\n({down,up})`,{live,gesture,game:'holiday',R:PT,stage:{current:{pick:()=>0}},action:(a:any)=>{actions.push(a);live.current=actParty(live.current,a) as HolidayRun;}});
  const event={button:0,isPrimary:true,pointerId:1,clientX:100,clientY:100,preventDefault(){},currentTarget:target};
  h.down(event);assert.equal(gesture.current?.round,3);
  live.current=partyTime(live.current,4930);const nextRound=live.current;
  assert.equal(nextRound.round,4);assert.equal(holidayTargets(42,4).boss,0);
  h.up(event);assert.equal(live.current,nextRound,'release cannot penalize or score the newly appeared target');assert.equal((actions[0] as any).round,3);
  h.down(event);h.up(event);assert.equal(live.current.mistakes,nextRound.mistakes+1,'a fresh gesture still acts on the current target');
});

test('UX-15c: selectable steak geometry retains original portion indices after an interleaved side dish',()=>{
  const run=displayMarket('steak-dinner'),side=run.portions.find(p=>p.kind==='potato')!;
  run.portions=[side,run.portions[0],side,run.portions[1]];const before=JSON.stringify(run),model=createDishModel(run.recipe,run);
  try{const indices:number[]=[];model.root.traverse(o=>{if(typeof o.userData.portion==='number')indices.push(o.userData.portion);});assert.deepEqual(indices.sort(),[1,3]);assert.equal(JSON.stringify(run),before);}finally{model.dispose();}
});

test('UX-15e: all 72 menu covers have distinct immutable local assets, bounded bytes and recorded prompts',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../modules/absurd-daily/illustrated-art.json',import.meta.url),'utf8'));
  const ids=[...RECIPES.map(r=>r.id),...PARTY_GAMES.map(g=>g.id),...GAMES.map(g=>g.id)];
  assert.equal(manifest.format,'freedom.illustrated-game-covers/v1');assert.equal(manifest.previews.length,ids.length);
  assert.equal(new Set(manifest.previews.map((p:any)=>p.sha256)).size,72);
  assert.equal(coverOf('../../private'),null);assert.equal(coverOf('not-a-game'),null);let bytes=0;
  for(const id of ids){
    const p=manifest.previews.find((p:any)=>p.id===id);assert.ok(p,id);assert.equal(coverOf(id)?.src,`/games/absurd-daily/illustrated/${id}.webp`);
    const raw=await readFile(new URL(`../../${p.path}`,import.meta.url)),info=await sharp(raw).metadata();
    assert.deepEqual([info.width,info.height],[512,340]);assert.equal(raw.length,p.bytes);assert.equal(createHash('sha256').update(raw).digest('hex'),p.sha256);assert.ok(raw.length<=102400);bytes+=raw.length;
    assert.ok(manifest.atlases.some((a:any)=>a.id===p.atlas));
  }
  for(const atlas of manifest.atlases){const prompt=await readFile(new URL(`../../${atlas.prompt}`,import.meta.url));assert.equal(createHash('sha256').update(prompt).digest('hex'),atlas.prompt_sha256);}
  assert.equal(bytes,manifest.total_bytes);assert.ok(bytes<=5*1024*1024);
});

test('UX-8 preview operator: dry plan and pure receipt validation never imply native execution',async()=>{
  const tool=await import(new URL('../../modules/absurd-daily/tools/native-previews.mjs',import.meta.url).href);
  const planned=await tool.plan();assert.equal(planned.mode,'dry-plan');assert.deepEqual([...planned.recipes].sort(),RECIPES.map(r=>r.id).sort());
  // Synthetic validator fixture ONLY: no browser, DOM or fabricated native evidence is saved.
  const receipt=()=>({status:'captured',errors:[],environment:{browser:'validator-fixture',renderer:'not-native',dpr:1},source_inputs:structuredClone(planned.source_inputs),
    build:{factory:'assets/dish.js',inputs:[planned.source_inputs[0]],chunks:[{file:'assets/dish.js',sha256:'a'.repeat(64),imports:[],modules:['apps/portal-web/src/games/cooking/dish-stage.ts']}]},
    total_bytes:66,previews:RECIPES.map(r=>({recipe:r.id,path:`apps/portal-web/public/games/absurd-daily/cooking/3d/${r.id}.webp`,width:512,height:384,bytes:1,sha256:'b'.repeat(64),source_png_sha256:'c'.repeat(64),native:{calls:1,geometries:1,triangles:1,textures:1},canvas_after_dispose:0}))});
  assert.equal(tool.validateCapture(receipt(),planned),true);
  for(const mutate of [
    (r:any)=>{r.status='failed';},(r:any)=>{r.errors.push('decode failure');},(r:any)=>{r.environment.renderer=null;},
    (r:any)=>{r.previews.pop();},(r:any)=>{r.previews[1]=r.previews[0];},(r:any)=>{r.previews[0].width=511;},
    (r:any)=>{r.previews[0].sha256='bad';},(r:any)=>{r.previews[0].bytes=-1;},(r:any)=>{r.total_bytes++;},
    (r:any)=>{r.previews[0].native.calls=101;},(r:any)=>{r.previews[0].native.geometries=100;},(r:any)=>{r.previews[0].native.textures=-1;},(r:any)=>{r.previews[0].native.textures=NaN;},(r:any)=>{r.previews[0].canvas_after_dispose=1;},
    (r:any)=>{r.source_inputs[0].sha256='d'.repeat(64);},(r:any)=>{r.build.chunks[0].imports=['assets/missing.js'];},
    (r:any)=>{r.build.chunks[0].modules=[];},(r:any)=>{r.previews[0].path='../escape.webp';},
  ]){const r=receipt();mutate(r);assert.throws(()=>tool.validateCapture(r,planned));}
  for(const path of ['../escape','/absolute','a/../b','a\\b','a//b'])assert.throws(()=>tool.safeRelative(path));
});

test('UX-8 preview operator: refuses output reuse, symlinks and changed image/source bytes',async()=>{
  const tool=await import(new URL('../../modules/absurd-daily/tools/native-previews.mjs',import.meta.url).href);
  const {mkdtemp,mkdir,writeFile,symlink,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'native-preview-validator-'));
  try{
    const root=join(dir,'source'),out=join(dir,'evidence');await mkdir(root);await tool.freshOutput(root,out);
    await assert.rejects(tool.freshOutput(root,out));await assert.rejects(tool.freshOutput(root,join(root,'nested')));
    await writeFile(join(root,'source.js'),'source');await symlink(join(root,'source.js'),join(root,'link.js'));await assert.rejects(tool.regularFile(root,'link.js'));
    const png=await sharp({create:{width:640,height:480,channels:3,background:'#888'}}).png().toBuffer(),webp=await sharp(png).resize(512,384).webp().toBuffer();
    await mkdir(join(out,'portal'));await mkdir(join(out,'portal/assets'));await writeFile(join(out,'portal/assets/dish.js'),'chunk');
    const source_inputs=[{path:'source.js',sha256:tool.digest(Buffer.from('source'))}],expected={recipes:RECIPES.map(r=>r.id),source_inputs};
    const receipt={status:'captured',errors:[],environment:{browser:'validator-fixture',renderer:'not-native',dpr:1},source_inputs,
      build:{factory:'assets/dish.js',inputs:source_inputs,chunks:[{file:'assets/dish.js',sha256:tool.digest(Buffer.from('chunk')),imports:[],modules:['apps/portal-web/src/games/cooking/dish-stage.ts']}]},
      total_bytes:66*webp.length,previews:RECIPES.map(r=>({recipe:r.id,path:`apps/portal-web/public/games/absurd-daily/cooking/3d/${r.id}.webp`,width:512,height:384,bytes:webp.length,sha256:tool.digest(webp),source_png_sha256:tool.digest(png),native:{calls:1,geometries:1,triangles:1,textures:1},canvas_after_dispose:0}))};
    for(const r of RECIPES){await writeFile(join(out,r.id+'.png'),png);await writeFile(join(out,r.id+'.webp'),webp);}
    await tool.validateFiles(root,out,receipt,expected,sharp);
    await writeFile(join(out,RECIPES[0].id+'.webp'),'corrupt');await assert.rejects(tool.validateFiles(root,out,receipt,expected,sharp));
    await writeFile(join(out,RECIPES[0].id+'.webp'),webp);
    const wrong=await sharp(png).resize(511,384).webp().toBuffer();const bad=structuredClone(receipt);bad.previews[0].sha256=tool.digest(wrong);bad.previews[0].bytes=wrong.length;bad.total_bytes+=wrong.length-webp.length;
    await writeFile(join(out,RECIPES[0].id+'.webp'),wrong);await assert.rejects(tool.validateFiles(root,out,bad,expected,sharp),/output_bytes_or_dimensions/);
    await writeFile(join(out,RECIPES[0].id+'.webp'),webp);await writeFile(join(out,'portal/assets/dish.js'),'wrong');await assert.rejects(tool.validateFiles(root,out,receipt,expected,sharp),/compiled_drift/);await writeFile(join(out,'portal/assets/dish.js'),'chunk');
    await writeFile(join(root,'source.js'),'changed');await assert.rejects(tool.validateFiles(root,out,receipt,expected,sharp),/source_drift/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

// Controlled Image/canvas/FileReader callbacks test ownership and ordering only.
// This does NOT establish native PNG/JPEG pixels, browser performance or GPU readiness.
test('AD-7 phased export ownership and encoding contract (non-native)',async t=>{
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/result-card.ts',import.meta.url),'utf8'),{loader:'ts',target:'es2023',format:'esm'}).code.replace(/^import .*;\n/gm,'').replace(/^export \{[\s\S]*?\};?\n?/gm,'');
  const harness=String.raw`// NON-NATIVE: controlled Image/canvas/FileReader doubles, not PNG/rendering evidence.
let encodes=[], readers=[], canvases=[];
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
class FakeImage {width=960;height=720;set src(value){this.value=value;if(value)queueMicrotask(()=>this.onload?.());}}
class FakeReader {readAsDataURL(blob){this.blob=blob;readers.push(this);} abort(){this.aborted=true;this.onabort?.();}}
globalThis.Image=FakeImage;globalThis.FileReader=FakeReader;
globalThis.document={createElement(tag){assert.equal(tag,'canvas');const c={width:0,height:0,getContext(){return new Proxy({measureText:()=>({width:1})},{get:(o,k)=>o[k]??(()=>{})});},toBlob(cb,type,quality){encodes.push({canvas:c,cb,type,quality});}};canvases.push(c);return c;}};
const input={game:'kitchen',seed:42,title:'飯糰',caption:'95分',details:'原始結果',image:'data:image/jpeg;base64,a'};
function reset(){encodes=[];readers=[];canvases=[];}
async function png(signal){const p=resultExports(input,null,signal);await tick();assert.equal(encodes.length,1);const job=encodes.shift();assert.deepEqual([job.canvas.width,job.canvas.height,job.type,job.quality],[960,1200,'image/png',undefined]);const bytes=new Blob(['exact-png'],{type:'image/png'});job.cb(bytes);const value=await p;assert.equal(value.png,bytes);assert.equal(await value.file.text(),'exact-png');assert.equal(value.file.name,'離譜日常-kitchen-42.png');assert.equal(value.file.type,'image/png');assert.equal(encodes.length,0);assert.equal('site' in value,false);return value;}
function completeEncode(type='image/jpeg'){const j=encodes.shift();j.cb(new Blob(['jpeg'],{type}));return j;}
function completeReader(value='data:image/jpeg;base64,am9i'){const r=readers.shift();r.result=value;r.onload();return r;}
let passed=0;async function check(name,fn){await t.test(name,async()=>{reset();await fn();passed++;});}
await check('PNG resolves independently; exact File payload; JPEG dimensions/quality',async()=>{const v=await png();const p=v.prepareJpegs();let j=completeEncode();assert.deepEqual([j.canvas.width,j.canvas.height,j.quality],[1200,675,.87]);await tick();completeReader();await tick();j=completeEncode();assert.deepEqual([j.canvas.width,j.canvas.height,j.quality],[960,1200,.85]);await tick();completeReader();assert.deepEqual(await p,{site:'data:image/jpeg;base64,am9i',preview:'data:image/jpeg;base64,am9i'});});
await check('pre-aborted owner never creates image/canvas',async()=>{const a=new AbortController();a.abort();await assert.rejects(resultExports(input,null,a.signal),{name:'AbortError'});assert.equal(canvases.length,0);});
await check('abort pending image decode suppresses work',async()=>{const a=new AbortController();const p=resultExports(input,null,a.signal);a.abort();await assert.rejects(p,{name:'AbortError'});await tick();assert.equal(encodes.length,0);});
await check('abort pending PNG ignores late native callback',async()=>{const a=new AbortController();const p=resultExports(input,null,a.signal);await tick();const j=encodes.shift();a.abort();await assert.rejects(p,{name:'AbortError'});j.cb(new Blob(['late'],{type:'image/png'}));assert.equal(readers.length,0);});
await check('JPEG MIME mismatch rejects without invalidating PNG; retry possible',async()=>{const v=await png();const p=v.prepareJpegs();completeEncode('image/png');await assert.rejects(p);assert.equal(await v.file.text(),'exact-png');const a=new AbortController();const retry=v.prepareJpegs(a.signal);assert.equal(encodes.length,1);a.abort();await assert.rejects(retry,{name:'AbortError'});});
await check('JPEG reader abort cancels reader; no subsequent encoding',async()=>{const v=await png();const a=new AbortController();const p=v.prepareJpegs(a.signal);completeEncode();await tick();const reader=readers[0];a.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(reader.aborted,true);assert.equal(reader.onload,null);assert.equal(encodes.length,0);});
await check('original owner abort also invalidates phase2',async()=>{const a=new AbortController();const v=await png(a.signal);a.abort();await assert.rejects(v.prepareJpegs(),{name:'AbortError'});assert.equal(encodes.length,0);});
await check('null PNG rejects original error path',async()=>{const p=resultExports(input);await tick();encodes.shift().cb(null);await assert.rejects(p,/圖片未能產生/);});
await check('invalid JPEG data URL rejects; keeps PNG',async()=>{const v=await png();const p=v.prepareJpegs();completeEncode();await tick();completeReader('data:image/png;base64,bad');await assert.rejects(p,/成果預覽未能產生/);assert.equal(v.png.type,'image/png');});
await check('original image decode rejection preserved',async()=>{const Image=globalThis.Image;globalThis.Image=class {set src(v){if(v)queueMicrotask(()=>this.onerror?.());}};try{await assert.rejects(resultExports(input),/成果照片未能讀取/);assert.equal(encodes.length,0);}finally{globalThis.Image=Image;}});
await check('FileReader native error propagates and preserves PNG',async()=>{const v=await png();const p=v.prepareJpegs();completeEncode();await tick();const r=readers.shift();r.error=new Error('read failed');r.onerror();await assert.rejects(p,/read failed/);assert.equal(v.png.type,'image/png');});
await check('canvas synchronous encode failure rejects',async()=>{const create=document.createElement;document.createElement=(tag)=>{const c=create(tag);c.toBlob=()=>{throw new Error('encode failed');};return c;};try{await assert.rejects(resultExports(input),/encode failed/);}finally{document.createElement=create;}});
assert.equal(passed,12);
`;
  await runInNewContext(`${source}\n(async()=>{${harness}})()`,{assert,t,partyOf,Blob,File,DOMException,AbortController,queueMicrotask});
});

test('UX-15d optional dish scheduling waits for primary settlement, bounds only its own wait, and cleans stale owners',()=>{
  const source=transformSync(readFileSync(new URL('../../apps/portal-web/src/games/deferred-preview.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code;
  const timers=new Map<number,{fn:()=>void;ms:number}>(),frames=new Map<number,()=>void>();let id=0,starts=0;
  const context={exports:{},module:{exports:{} as {deferOptionalPreview:(start:()=>void)=>{release:()=>void;dispose:()=>void}}},window:{setTimeout(fn:()=>void,ms:number){timers.set(++id,{fn,ms});return id;},clearTimeout(key:number){timers.delete(key);}},requestAnimationFrame(fn:()=>void){frames.set(++id,fn);return id;},cancelAnimationFrame(key:number){frames.delete(key);}};
  runInNewContext(source,context);const create=()=>context.module.exports.deferOptionalPreview(()=>starts++);
  const flushFrame=()=>{const jobs=[...frames.values()];frames.clear();jobs.forEach(fn=>fn());};
  const flushTask=()=>{const jobs=[...timers.entries()].filter(([,job])=>job.ms===0);jobs.forEach(([key,job])=>{timers.delete(key);job.fn();});};
  for(const settlement of ['PNG success','PNG error']){const owner=create();assert.equal(timers.size,1,settlement);assert.equal(frames.size,0);const before=starts;owner.release();assert.equal(starts,before);assert.equal(timers.size,0);flushFrame();assert.equal(starts,before);flushTask();assert.equal(starts,before+1);owner.release();flushFrame();flushTask();assert.equal(starts,before+1);owner.dispose();}
  const held=create(),deadline=[...timers.values()][0];assert.equal(deadline.ms,15000);deadline.fn();flushFrame();flushTask();const started=starts;held.release();flushFrame();flushTask();assert.equal(starts,started,'late PNG does not rebuild the stage or change PNG state');held.dispose();
  const stale=create(),staleDeadline=[...timers.values()][0];stale.dispose();staleDeadline.fn();stale.release();assert.equal(frames.size,0);assert.equal(timers.size,0);
  const beforeFrame=create();beforeFrame.release();const staleFrame=[...frames.values()][0];beforeFrame.dispose();staleFrame();assert.equal(timers.size,0);assert.equal(frames.size,0);
  const beforeTask=create();beforeTask.release();flushFrame();const staleTask=[...timers.values()][0];beforeTask.dispose();staleTask.fn();assert.equal(starts,started);assert.equal(timers.size,0);
  const replacement=create();replacement.release();flushFrame();flushTask();assert.equal(starts,started+1);replacement.dispose();
});
